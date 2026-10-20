"use strict";
// Node reference for src/qcrush_core.genexpr (same math, same order of operations), built on
// src/cepstrum_ref.js. Used by tests/test_qcrush.js and shared with the UI helpers by name.

const ref = require("./cepstrum_ref.js");

const EPS = 1e-9;
const NC = 96; // coefficients in the telemetry
const UP_NEPERS = 3.45;
const DOWN_NEPERS = 8;
const HOLD_RATES = ["Off", "1/32", "1/16", "1/8", "1/4", "1/2", "1 bar"];
const SCRAMBLE_MODES = ["Off", "Rev", "Shuf", "Rot"];

function clip(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// Formant quefrency (2 ms) in samples, 16..96.
function formantQ(sr) {
    return clip(Math.round(sr * 0.002), 16, 96);
}

// Coefficients kept for Coeffs 0..1 at FFT size n: 2 .. Qs logarithmically over the first 75 % of the knob, Qs .. n/2
// linearly over the last 25 % (the pitch comb returns there). 1 = all of them (neutral).
function coeffsKept(cf, n, sr) {
    const c = clip(cf, 0, 1);
    const qs = formantQ(sr || 44100);
    if (c >= 0.995) return n / 2;
    return c < 0.75 ? 2 * Math.pow(qs / 2, c / 0.75) : qs + ((n / 2 - qs) * (c - 0.75)) / 0.25;
}

function quantStep(bits) {
    return 1.5 * Math.pow(2, -(bits - 1) * 0.75);
}

function holdBeats(idx) {
    return idx < 0.5 ? 1 : Math.pow(2, Math.round(idx) - 4);
}

// Smooth 0..1 crossover between envelope (q well below qs) and excitation (q well above).
function hi(q, qs) {
    const w = Math.max(qs * 0.25, 1);
    const t = clip((q - (qs - w)) / (2 * w), 0, 1);
    return t * t * (3 - 2 * t);
}

// Seeded Fisher-Yates permutation of 1..r (pm[1..r]), the same hash as qc_perm.
function perm(r, seed) {
    const pm = new Float64Array(r + 2);
    for (let i = 1; i <= r; i++) pm[i] = i;
    for (let t = 0; t < r - 1; t++) {
        const i = r - t;
        const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
        let j = 1 + Math.floor((v - Math.floor(v)) * i);
        j = Math.min(j, i);
        const a = pm[i];
        pm[i] = pm[j];
        pm[j] = a;
    }
    return pm;
}

function isNeutral(o) {
    const n = o.n;
    const kq = coeffsKept(o.coeffs, n, o.sr);
    const scr = o.smode > 0.5 && o.samt > 0.001;
    return kq >= n / 2 - 0.5 && o.bits >= 15.5 && !scr && Math.abs(o.shift) < 0.005 && !o.useHold;
}

// The crusher. c: real cepstrum (length n, even). hold: {env: Float64Array(256), valid} state shared across frames.
// o: {n, sr, coeffs, bits, smode, samt, shift (st), useHold, capture, roll}.
// Returns the crushed, mirrored cepstrum (length n).
function crushCepstrum(c, o, hold) {
    const n = o.n;
    const half = n / 2;
    const qs = formantQ(o.sr);
    const w = Math.max(qs * 0.25, 1);
    const qe = Math.min(Math.floor(qs + w) + 1, half - 1);
    const kq = coeffsKept(o.coeffs, n, o.sr);
    const rr = Math.max(2, Math.min(Math.floor(kq), Math.floor(qs)));
    const smode = Math.round(clip(o.smode, 0, 3));
    const samt = clip(o.samt, 0, 1);
    const rho = Math.pow(2, clip(o.shift, -12, 12) / 12);
    const bits = clip(Math.round(o.bits), 1, 16);
    const cn = new Float64Array(half + 2);
    cn[0] = c[0];
    for (let q = 1; q <= qe; q++) {
        let ev = c[q] * (1 - hi(q, qs));
        if (o.capture) hold.env[q] = ev;
        if (o.useHold) ev = hold.env[q];
        cn[q] = ev;
    }
    if (smode > 0.5 && samt > 0.001) {
        const us = new Float64Array(rr + 2);
        for (let q = 1; q <= rr; q++) us[q] = cn[q] * q;
        const pm = smode > 1.5 && smode < 2.5 ? perm(rr, o.roll === undefined ? 1 : o.roll) : null;
        for (let q = 1; q <= rr; q++) {
            const u0 = us[q];
            let u1 = u0;
            if (smode < 1.5) {
                u1 = us[rr + 1 - q];
            } else if (smode < 2.5) {
                u1 = us[pm[q]];
            } else {
                let p0 = q - 1 - samt * rr * 0.5;
                p0 -= rr * Math.floor(p0 / rr);
                const i0 = Math.floor(p0) + 1;
                const fr = p0 - Math.floor(p0);
                let i1 = i0 + 1;
                if (i1 > rr) i1 = 1;
                u1 = us[i0] * (1 - fr) + us[i1] * fr;
            }
            if (smode < 2.5) u1 = u0 + (u1 - u0) * samt;
            cn[q] = u1 / q;
        }
    }
    const shifting = Math.abs(rho - 1) > 0.0002;
    for (let q = qe + 1; q <= half; q++) cn[q] = 0;
    if (shifting) {
        const inr = 1 / rho;
        for (let s = 1; s <= half; s++) {
            const ex = c[s] * hi(s, qs);
            const dq = s * inr;
            if (dq >= 1) {
                const i0 = Math.floor(dq);
                const fr = dq - i0;
                if (i0 <= half) cn[i0] += ex * (1 - fr);
                if (i0 + 1 <= half) cn[i0 + 1] += ex * fr;
            }
        }
    } else {
        for (let q = 1; q <= half; q++) cn[q] += c[q] * hi(q, qs);
    }
    if (kq < half - 0.5) {
        const tw = Math.max(2, kq * 0.2);
        for (let q = 1; q <= half; q++) {
            let g = 0;
            if (q <= kq) {
                g = 1;
                if (q > kq - tw) g = 0.5 + 0.5 * Math.cos((Math.PI * (q - (kq - tw))) / tw);
            }
            cn[q] *= g;
        }
    }
    if (bits < 15.5) {
        const stp = quantStep(bits);
        const inv = 1 / stp;
        for (let q = 1; q <= half; q++) cn[q] = Math.round(cn[q] * inv) * stp;
    }
    const out = new Float64Array(n);
    out[0] = cn[0];
    for (let q = 1; q < half; q++) {
        out[q] = cn[q];
        out[n - q] = cn[q];
    }
    out[half] = cn[half];
    return out;
}

// Apply a crushed cepstrum to a spectrum: magnitude from exp(FFT(c')), original phase, per-bin gain limited, then the
// frame is scaled back to the input frame's energy.
function remagLimited(xr, xi, logRe, eps) {
    const n = xr.length;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    let ein = 0;
    let eout = 0;
    for (let i = 0; i < n; i++) {
        const mag = Math.hypot(xr[i], xi[i]);
        let g = 1;
        if (mag > 1e-20) {
            const d = clip(logRe[i] - Math.log(mag + eps), -DOWN_NEPERS, UP_NEPERS);
            g = Math.max(((mag + eps) * Math.exp(d) - eps) / mag, 0);
        }
        re[i] = xr[i] * g;
        im[i] = xi[i] * g;
        ein += mag * mag;
        eout += mag * mag * g * g;
    }
    let gn = 1;
    if (eout > 1e-30 && ein > 1e-30) gn = clip(Math.sqrt(ein / eout), 0.05, 20);
    if (Math.abs(gn - 1) > 1e-6) {
        for (let i = 0; i < n; i++) {
            re[i] *= gn;
            im[i] *= gn;
        }
    }
    return { re, im, gn };
}

// Process one spectrum frame in place (the Stft callback). Neutral settings leave it alone.
function processSpectrum(re, im, o, hold, force) {
    if (!force && isNeutral(o)) return null;
    const c = ref.realCepstrum(re, im, EPS);
    const cn = crushCepstrum(c, o, hold);
    const ls = ref.cepToLogSpec(cn);
    const out = remagLimited(re, im, ls.re, EPS);
    re.set(out.re);
    im.set(out.im);
    return { c, cn };
}

// Mono streaming crusher: push(x) returns the output sample, delayed n - 1 samples.
class Crusher {
    constructor(o) {
        this.o = Object.assign({ n: 1024, sr: 44100, coeffs: 1, bits: 16, smode: 0, samt: 0.5, shift: 0, useHold: false, capture: false, roll: 1 }, o);
        this.hold = { env: new Float64Array(256) };
        this.frames = [];
        this.force = !!this.o.force;
        this.stft = new ref.Stft(this.o.n, (re, im) => {
            const r = processSpectrum(re, im, this.o, this.hold, this.force);
            if (r) this.frames.push(r);
            this.o.capture = false;
        });
    }

    run(signal) {
        return this.stft.run(signal);
    }
}

// The hold clock of the gen core: free-runs on the tempo, locks to the host position whenever it changes.
class HoldClock {
    constructor() {
        this.beat = 0;
        this.ppqPrev = 0;
        this.lastIdx = 0;
    }

    // One sample. Returns 1 on a tick.
    step(sr, bpm, ppq, hidx) {
        const per = holdBeats(hidx);
        if (ppq !== this.ppqPrev) {
            this.beat = ppq;
            this.ppqPrev = ppq;
        } else {
            this.beat += Math.max(bpm, 20) / (60 * sr);
        }
        const cidx = Math.floor(this.beat / per);
        let tick = 0;
        if (cidx > this.lastIdx) {
            tick = 1;
            this.lastIdx = cidx;
        } else if (cidx < this.lastIdx - 1) {
            this.lastIdx = cidx;
        }
        return tick;
    }
}

module.exports = {
    HoldClock,
    EPS,
    NC,
    HOLD_RATES,
    SCRAMBLE_MODES,
    clip,
    formantQ,
    coeffsKept,
    quantStep,
    holdBeats,
    hi,
    perm,
    isNeutral,
    crushCepstrum,
    remagLimited,
    processSpectrum,
    Crusher,
};
