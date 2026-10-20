"use strict";
// Node (CommonJS) reference for src/timbre_core.genexpr (Timbre Follower).
// Same constants, same sample-by-sample structure: tests/test_timbre.js uses it on
// synthetic signals, and scripts/run_timbre_audio_tests.py compares real Max against it.
//
// Pipeline per hop (every 256 samples, N = 1024, mono = (L + R) / 2):
//   Hann frame -> FFT -> power -> 24 triangular mel bands -> ln (relative floor)
//   -> orthonormal DCT-II -> c1..c13   (c0 is DROPPED: a gain adds a constant to
//   every ln band energy, and DCT rows k >= 1 sum to zero, so c1..c13 do not
//   change with level. That is the loudness invariance.)
//   novelty d = sqrt(sum w_k (c_k - h_k)^2), h = EMA of past frames (tau 100 ms),
//   w from Focus (sum 1). nov = 1 - exp(-max(d - DFLOOR, 0) / D0)  in 0..1.
//   Gate: frame RMS above -60 dBFS (closes below -66). Gate closed -> nov 0 and
//   the history is forgotten, so a note onset after silence does not self-trigger.

const ref = require("./cepstrum_ref.js");

const K = {
    N: 1024,
    HOP: 256,
    BANDS: 24,
    NC: 13,
    FMIN: 70,
    FMAX: 14000,
    REL_FLOOR: 1e-3,
    ABS_FLOOR: 1e-12,
    HIST_TAU: 0.1,
    CUR_A: 0.5,
    D0: 1.3,
    DFLOOR: 0.6,
    GATE_OPEN_DB: -60,
    GATE_CLOSE_DB: -66,
    IDLE_PEAK: 3e-5,
    IDLE_HOPS: 200,
    REFRACTORY_S: 0.04,
    THR_BASE: 0.02,
    THR_SPAN: 0.6,
};

const MEL_NORM = 0.4342944819032518;

function hzToMel(f) {
    return 2595 * Math.log(1 + f / 700) * MEL_NORM;
}

function melToHz(m) {
    return 700 * (Math.pow(10, m / 2595) - 1);
}

// Triangular mel filters on integer FFT bins: {lo, ctr, hi, inv} per band.
function melTable(sr) {
    const binHz = sr / K.N;
    const fmax = Math.min(K.FMAX, sr * 0.45);
    const m0 = hzToMel(K.FMIN);
    const m1 = hzToMel(fmax);
    const out = [];
    for (let b = 0; b < K.BANDS; b++) {
        const fl = melToHz(m0 + ((m1 - m0) * b) / (K.BANDS + 1)) / binHz;
        const fc = melToHz(m0 + ((m1 - m0) * (b + 1)) / (K.BANDS + 1)) / binHz;
        const fh = melToHz(m0 + ((m1 - m0) * (b + 2)) / (K.BANDS + 1)) / binHz;
        let ctr = Math.round(fc);
        let lo = Math.min(Math.floor(fl), ctr - 1);
        let hi = Math.max(Math.ceil(fh), ctr + 1);
        lo = Math.max(lo, 0);
        let sw = 0;
        for (let k = lo; k <= hi; k++) sw += k < ctr ? (k - lo) / (ctr - lo) : (hi - k) / (hi - ctr);
        out.push({ lo, ctr, hi, inv: 1 / sw });
    }
    return out;
}

// Orthonormal DCT-II rows k = 1..13 over 24 bands, index (k - 1) * 24 + band.
function dctTable() {
    const t = new Float64Array(K.NC * K.BANDS);
    const sc = Math.sqrt(2 / K.BANDS);
    for (let k = 1; k <= K.NC; k++) {
        for (let b = 0; b < K.BANDS; b++) {
            t[(k - 1) * K.BANDS + b] = sc * Math.cos((Math.PI * k * (b + 0.5)) / K.BANDS);
        }
    }
    return t;
}

// Focus -100..100 % -> 13 weights summing to 1. Negative leans on c1..c6
// (brightness, body), positive on c8..c13 (texture, noisiness).
function focusWeights(focusPct) {
    const f = Math.max(-1, Math.min(1, focusPct * 0.01));
    const w = new Float64Array(K.NC);
    let s = 0;
    for (let k = 0; k < K.NC; k++) {
        w[k] = Math.pow(2, (2.5 * f * (k - 6)) / 6);
        s += w[k];
    }
    for (let k = 0; k < K.NC; k++) w[k] /= s;
    return w;
}

// Sens 0..100 % -> threshold on the 0..1 novelty scale (higher Sens = lower threshold).
function sensToThreshold(sensPct) {
    return K.THR_BASE + K.THR_SPAN * (1 - Math.max(0, Math.min(100, sensPct)) * 0.01);
}

function thresholdToSens(thr) {
    return Math.max(0, Math.min(100, (1 - (thr - K.THR_BASE) / K.THR_SPAN) * 100));
}

// mel energies -> ln -> MFCC c1..c13 of one windowed frame spectrum.
function mfccFromSpectrum(re, im, mel, dct) {
    const e = new Float64Array(K.BANDS);
    let sum = 0;
    for (let b = 0; b < K.BANDS; b++) {
        const m = mel[b];
        let acc = 0;
        for (let k = m.lo; k <= m.hi; k++) {
            const w = k < m.ctr ? (k - m.lo) / (m.ctr - m.lo) : (m.hi - k) / (m.hi - m.ctr);
            acc += (re[k] * re[k] + im[k] * im[k]) * w;
        }
        e[b] = acc * m.inv;
        sum += e[b];
    }
    const floor = (K.REL_FLOOR * sum) / K.BANDS + K.ABS_FLOOR;
    for (let b = 0; b < K.BANDS; b++) e[b] = Math.log(e[b] + floor);
    const c = new Float64Array(K.NC);
    for (let k = 0; k < K.NC; k++) {
        let s = 0;
        for (let b = 0; b < K.BANDS; b++) s += e[b] * dct[k * K.BANDS + b];
        c[k] = s;
    }
    return c;
}

class TimbreFollower {
    // params: sens (0..100), attack ms, release ms, focus (-100..100), mode (0 Env, 1 Trig)
    constructor(sr, params) {
        this.sr = sr;
        this.p = Object.assign({ sens: 50, attack: 8, release: 250, focus: 0, mode: 0 }, params || {});
        this.mel = melTable(sr);
        this.dct = dctTable();
        this.win = ref.hann(K.N);
        this.ring = new Float64Array(K.N);
        this.wp = 0;
        this.cnt = 0;
        this.re = new Float64Array(K.N);
        this.im = new Float64Array(K.N);
        this.hist = new Float64Array(K.NC);
        this.cur = new Float64Array(K.NC);
        this.hv = 0;
        this.gate = 0;
        this.quiet = 0;
        this.hopmax = 0;
        this.nprev = 0;
        this.nprev2 = 0;
        this.refr = 0;
        this.tgt = 0;
        this.envs = 0;
        this.pv = 0;
        this.pst = 0;
        this.ca = 0;
        this.cr = 0;
        this.atkinc = 0;
        this.decc = 0;
        this.nov = 0;
        this.mfcc = new Float64Array(K.NC);
        this.lvl = -200;
        this.asleep = false;
        this.hops = 0;
        this.trigCount = 0;
        this.onHop = null; // optional callback(hop) with {mfcc, nov, ctrl, trig, gate, lvl}
    }

    threshold() {
        return sensToThreshold(this.p.sens);
    }

    // One input sample (already the mono mix). Returns the 0..1 control value.
    push(x) {
        const n = K.N;
        const sr = this.sr;
        this.ring[this.wp] = x;
        this.wp = (this.wp + 1) % n;
        this.cnt++;
        const ax = Math.abs(x);
        if (ax > this.hopmax) this.hopmax = ax;
        let rdy = false;
        if (this.cnt >= K.HOP) {
            this.cnt = 0;
            rdy = true;
        }
        let fireNow = false;
        if (rdy) fireNow = this.hop();
        // per-sample shaping
        if (fireNow && this.p.mode > 0.5) this.pst = 1;
        if (this.pst === 1) {
            this.pv += this.atkinc;
            if (this.pv >= 1) {
                this.pv = 1;
                this.pst = 2;
            }
        } else if (this.pst === 2) {
            this.pv *= this.decc;
            if (this.pv < 1e-4) {
                this.pv = 0;
                this.pst = 0;
            }
        }
        const c = this.tgt > this.envs ? this.ca : this.cr;
        this.envs += c * (this.tgt - this.envs);
        if (Math.abs(this.envs) < 1e-9) this.envs = 0;
        return Math.min(1, Math.max(0, this.envs + this.pv));
    }

    hop() {
        const n = K.N;
        const sr = this.sr;
        const p = this.p;
        this.quiet = this.hopmax < K.IDLE_PEAK ? this.quiet + 1 : 0;
        this.hopmax = 0;
        this.asleep = this.quiet > K.IDLE_HOPS;
        let lvl = -200;
        if (!this.asleep) {
            let e = 0;
            for (let i = 0; i < n; i++) {
                const v = this.ring[(this.wp + i) % n] * this.win[i];
                this.re[i] = v;
                this.im[i] = 0;
                e += v * v;
            }
            lvl = 10 * Math.log10(e / (0.375 * n) + 1e-20);
        }
        this.lvl = lvl;
        if (this.gate < 0.5) this.gate = lvl > K.GATE_OPEN_DB ? 1 : 0;
        else this.gate = lvl < K.GATE_CLOSE_DB ? 0 : 1;
        let d = 0;
        if (this.gate > 0.5) {
            ref.fft(this.re, this.im, false);
            this.mfcc = mfccFromSpectrum(this.re, this.im, this.mel, this.dct);
            const wt = focusWeights(p.focus);
            const ha = 1 - Math.exp(-K.HOP / (K.HIST_TAU * sr));
            if (this.hv > 0.5) {
                for (let k = 0; k < K.NC; k++) this.cur[k] += K.CUR_A * (this.mfcc[k] - this.cur[k]);
                let s = 0;
                for (let k = 0; k < K.NC; k++) {
                    const dl = this.cur[k] - this.hist[k];
                    s += wt[k] * dl * dl;
                }
                d = Math.sqrt(s);
                for (let k = 0; k < K.NC; k++) this.hist[k] += ha * (this.cur[k] - this.hist[k]);
            } else {
                for (let k = 0; k < K.NC; k++) {
                    this.cur[k] = this.mfcc[k];
                    this.hist[k] = this.mfcc[k];
                }
            }
            this.hv = 1;
        } else {
            this.hv = 0;
            this.mfcc = new Float64Array(K.NC);
        }
        const nov = 1 - Math.exp(-Math.max(d - K.DFLOOR, 0) / K.D0);
        this.nov = nov;
        const thr = this.threshold();
        // peak picking one hop late: the previous hop is a local maximum above thr
        let fire = false;
        if (this.refr > 0) this.refr -= 1;
        if (this.nprev > thr && this.nprev >= this.nprev2 && this.nprev > nov && this.refr <= 0 && p.mode > 0.5) {
            fire = true;
            this.refr = Math.ceil((K.REFRACTORY_S * sr) / K.HOP);
            this.trigCount++;
        }
        this.nprev2 = this.nprev;
        this.nprev = nov;
        // Env target and smoothing coefficients (time to 90 % = the stated ms)
        this.tgt = p.mode > 0.5 ? 0 : Math.min(1, Math.max(0, (nov - thr) / (1 - thr)));
        const atkMs = Math.max(p.attack, 0.5);
        const relMs = Math.max(p.release, 1);
        this.ca = 1 - Math.exp(-2.3 / (atkMs * 0.001 * sr));
        this.cr = 1 - Math.exp(-2.3 / (relMs * 0.001 * sr));
        this.atkinc = 1 / Math.max(atkMs * 0.001 * sr, 1);
        this.decc = Math.exp(-2.3 / Math.max(relMs * 0.001 * sr, 1));
        this.hops++;
        if (this.onHop) {
            this.onHop({
                mfcc: this.mfcc,
                nov,
                d,
                gate: this.gate,
                lvl,
                fire,
                asleep: this.asleep,
                ctrl: Math.min(1, this.envs + this.pv),
            });
        }
        return fire;
    }

    run(signal) {
        const out = new Float64Array(signal.length);
        for (let i = 0; i < signal.length; i++) out[i] = this.push(signal[i]);
        return out;
    }
}

// ---- deterministic test signals (shared by tests/test_timbre.js and the Max probe) ----
function lcg(seed) {
    let s = seed >>> 0;
    return function () {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 2147483648 - 1;
    };
}

// Fill `len` samples starting at phase 0 of the given kind at amplitude `amp`.
function synth(kind, len, sr, amp, f0, rnd) {
    const out = new Float64Array(len);
    let ph = 0;
    const inc = f0 / sr;
    for (let i = 0; i < len; i++) {
        if (kind === "sine") out[i] = amp * Math.sin(2 * Math.PI * ph);
        else if (kind === "saw") out[i] = amp * (2 * ph - 1);
        else if (kind === "square") out[i] = amp * (ph < 0.5 ? 1 : -1);
        else out[i] = amp * (rnd ? rnd() : 0);
        ph += inc;
        if (ph >= 1) ph -= 1;
    }
    return out;
}

module.exports = {
    K,
    melTable,
    dctTable,
    focusWeights,
    sensToThreshold,
    thresholdToSens,
    mfccFromSpectrum,
    TimbreFollower,
    lcg,
    synth,
};
