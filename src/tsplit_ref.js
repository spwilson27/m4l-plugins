"use strict";
// Node (CommonJS) reference for src/tsplit_core.genexpr (Timbre Split). Same constants, same sample-by-sample
// structure and order of operations: tests/test_tsplit.js drives it on synthetic drum signals, and
// scripts/run_tsplit_audio_tests.py compares real Max against it.
//
// TimbreSplitRef  : analysis + lookahead delay. push(l, r) returns the class gains g[0..3] (sum 1) and the audio
//                   delayed by 2048 samples. Centroids are set from outside (like the `tsplitcent` buffer).
// TsplitChain     : one Rack chain. Its class mask bits are smoothed like the gen core, gain is -inf..+18 dB.
//                   process(ref output) -> [outL, outR].
// synthDrumLoop   : deterministic kick / snare / hat style signals with ground-truth event spans.

const ref = require("./cepstrum_ref.js");
const T = require("./timbre_ref.js");
// tsplit_config.js is a global script (it is also concatenated into the v8ui), so TypeScript sees no module there.
/** @type {any} */
const C = require.call(null, "./tsplit_config.js");

const K = Object.assign({}, T.K, {
    LATENCY: C.TSPLIT_LATENCY,
    RING: 16,
    HALF: C.TSPLIT_SMOOTH_HALF,
});

// mel energies -> ln -> (c0, c1..c13). Same maths as timbre_ref.mfccFromSpectrum, which only returns c1..c13.
function mfccWithC0(re, im, mel, dct) {
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
    let lsum = 0;
    for (let b = 0; b < K.BANDS; b++) {
        e[b] = Math.log(e[b] + floor);
        lsum += e[b];
    }
    const c = new Float64Array(K.NC);
    for (let k = 0; k < K.NC; k++) {
        let s = 0;
        for (let b = 0; b < K.BANDS; b++) s += e[b] * dct[k * K.BANDS + b];
        c[k] = s;
    }
    return { c, c0: 0.20412414523193154 * lsum };
}

class TimbreSplitRef {
    // params: classes (1..4), sharp (0..100), smooth (ms). centroids: [4][13] (array of arrays).
    constructor(sr, params, centroids) {
        this.sr = sr;
        this.p = Object.assign({ classes: 3, sharp: 60, smooth: 8 }, params || {});
        this.cents = (centroids || C.TSPLIT_PRIOR_CENTROIDS).map((c) => Array.from(c));
        this.mel = T.melTable(sr);
        this.dct = T.dctTable();
        this.win = ref.hann(K.N);
        this.ring = new Float64Array(K.N);
        this.wp = 0;
        this.cnt = 0;
        this.re = new Float64Array(K.N);
        this.im = new Float64Array(K.N);
        this.hopmax = 0;
        this.quiet = 0;
        this.gate = 0;
        this.curw = 0;
        this.hopidx = 0;
        this.primed = false;
        this.hd = [0, 0, 0, 0];
        this.tr = new Float64Array(K.RING * 4);
        this.sw = new Float64Array(8);
        this.kern = new Float64Array(2 * K.HALF + 1);
        this.dlL = new Float64Array(4096);
        this.dlR = new Float64Array(4096);
        this.dw = 0;
        this.hops = 0;
        this.lvl = -200;
        this.asleep = false;
        this.lastFeat = null;
        this.onHop = null; // callback({feat, c0, p, winner, gate, asleep, lvl, jn})
    }

    setCentroids(cents) {
        this.cents = cents.map((c) => Array.from(c));
    }

    hop(hm) {
        const n = K.N;
        const p = this.p;
        const nk = Math.min(4, Math.max(1, Math.round(p.classes)));
        this.quiet = hm < K.IDLE_PEAK ? this.quiet + 1 : 0;
        const sl = this.quiet > K.IDLE_HOPS;
        this.asleep = sl;
        let lvl = -200;
        if (!sl) {
            let e = 0;
            for (let i = 0; i < n; i++) {
                const v = this.ring[(this.wp + i) % n] * this.win[i];
                this.re[i] = v;
                this.im[i] = 0;
                e += v * v;
            }
            const ms = e / (0.375 * n);
            lvl = 10 * Math.log10(ms + 1e-20);
        }
        this.lvl = lvl;
        this.gate = this.gate < 0.5 ? (lvl > K.GATE_OPEN_DB ? 1 : 0) : (lvl < K.GATE_CLOSE_DB ? 0 : 1);
        let op = false;
        let probs = null;
        let feat = null;
        let c0 = 0;
        let winner = this.curw;
        if (this.gate > 0.5) {
            ref.fft(this.re, this.im, false);
            const f = mfccWithC0(this.re, this.im, this.mel, this.dct);
            feat = Array.from(f.c);
            c0 = f.c0;
            const beta = C.sharpToBeta(p.sharp);
            const r = C.classifyFrame(feat, this.cents, nk, beta, this.curw);
            probs = r.p;
            winner = r.winner;
            this.curw = r.winner;
            op = true;
        }
        this.lastFeat = feat;
        // ts_push
        const jn = this.hopidx + 1 >= K.RING ? 0 : this.hopidx + 1;
        this.hopidx = jn;
        let s = 0;
        const v = [0, 0, 0, 0];
        for (let k = 0; k < 4; k++) {
            let x = op ? probs[k] : this.hd[k];
            x = k < nk ? x : 0;
            v[k] = x;
            s += x;
        }
        for (let k = 0; k < 4; k++) {
            const x = s > 1e-9 ? v[k] / s : (k === 0 ? 1 : 0);
            this.hd[k] = x;
            this.tr[jn * 4 + k] = x;
        }
        if (!this.primed) {
            for (let k = 0; k < 4; k++) {
                for (let r = 0; r < K.RING; r++) this.tr[r * 4 + k] = this.hd[k];
                this.sw[k] = this.hd[k];
                this.sw[4 + k] = this.hd[k];
            }
            this.primed = true;
        }
        // ts_kernel + ts_smooth
        const kw = C.smoothKernel(p.smooth, this.sr);
        for (let i = 0; i < kw.length; i++) this.kern[i] = kw[i];
        for (let k = 0; k < 4; k++) {
            this.sw[k] = this.sw[4 + k];
            let acc = 0;
            for (let i = 0; i < 2 * K.HALF + 1; i++) {
                let r = jn + K.RING - 2 * K.HALF + i;
                r = r >= K.RING ? r - K.RING : r;
                acc += this.kern[i] * this.tr[r * 4 + k];
            }
            this.sw[4 + k] = acc;
        }
        this.hops++;
        if (this.onHop) {
            this.onHop({ feat, c0, p: op ? probs : null, hold: Array.from(this.hd), winner, gate: this.gate, asleep: sl, lvl, jn });
        }
    }

    // One stereo sample in. Returns { g: [g1..g4], l, r } where l / r is the input delayed by LATENCY samples.
    push(xl, xr) {
        const n = K.N;
        const xm = 0.5 * (xl + xr);
        this.ring[this.wp] = xm;
        this.wp = (this.wp + 1) % n;
        this.cnt++;
        let rdy = false;
        if (this.cnt >= K.HOP) {
            this.cnt = 0;
            rdy = true;
        }
        const hm = Math.max(this.hopmax, Math.abs(xm));
        this.hopmax = rdy ? 0 : hm;
        if (rdy) this.hop(hm);
        const fr = this.cnt * 0.00390625;
        const g = [0, 0, 0, 0];
        for (let k = 0; k < 4; k++) g[k] = this.sw[k] + fr * (this.sw[4 + k] - this.sw[k]);
        this.dlL[this.dw] = xl;
        this.dlR[this.dw] = xr;
        const rp = (this.dw - K.LATENCY + 4096) % 4096;
        const l = this.dlL[rp];
        const r = this.dlR[rp];
        this.dw = (this.dw + 1) % 4096;
        return { g, l, r };
    }
}

class TsplitChain {
    // mask: 4-bit class mask, gainDb: -70..+18 (<= -69.5 is -inf)
    constructor(sr, mask, gainDb) {
        this.sr = sr;
        this.mask = mask;
        this.gainDb = gainDb === undefined ? 0 : gainDb;
        this.m = [0, 0, 0, 0];
        this.gls = 1;
    }

    process(o) {
        const cmk = Math.min(15, Math.max(0, Math.round(this.mask)));
        const tb = [
            cmk - 2 * Math.floor(cmk * 0.5),
            Math.floor(cmk * 0.5) - 2 * Math.floor(cmk * 0.25),
            Math.floor(cmk * 0.25) - 2 * Math.floor(cmk * 0.125),
            Math.floor(cmk * 0.125),
        ];
        const cm = 1 - Math.exp(-1 / (0.003 * this.sr));
        let gsum = 0;
        for (let k = 0; k < 4; k++) {
            let nn = this.m[k] + cm * (tb[k] - this.m[k]);
            nn = Math.abs(nn - tb[k]) < 1e-9 ? tb[k] : nn;
            this.m[k] = nn;
            gsum += o.g[k] * nn;
        }
        const glt = this.gainDb <= -69.5 ? 0 : Math.pow(10, this.gainDb * 0.05);
        let gn = this.gls + 0.002 * (glt - this.gls);
        gn = Math.abs(gn - glt) < 1e-9 ? glt : gn;
        this.gls = gn;
        return [o.l * gsum * gn, o.r * gsum * gn];
    }
}

// ---- deterministic drum-like test signals ----
function lcg(seed) {
    let s = seed >>> 0;
    return function () {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 2147483648 - 1;
    };
}

// Event kinds: 0 kick (pitch-swept decaying sine), 1 snare (band-limited noise + 190 Hz body), 2 hat (high-passed noise).
const DRUM = [
    { name: "kick", len: 0.30 },
    { name: "snare", len: 0.22 },
    { name: "hat", len: 0.12 },
];

function drumEvent(kind, sr, rnd) {
    const len = Math.round(DRUM[kind].len * sr);
    const out = new Float64Array(len);
    let ph = 0;
    let lp1 = 0;
    let lp2 = 0;
    let hp1 = 0;
    let prev = 0;
    for (let i = 0; i < len; i++) {
        const t = i / sr;
        let v = 0;
        if (kind === 0) {
            const f = 48 + 90 * Math.exp(-t / 0.03);
            ph += f / sr;
            v = 0.85 * Math.exp(-t / 0.09) * Math.sin(2 * Math.PI * ph);
        } else if (kind === 1) {
            const nz = rnd();
            lp1 += 0.55 * (nz - lp1);
            lp2 += 0.08 * (nz - lp2);
            const band = lp1 - lp2; // roughly 1 kHz .. 9 kHz
            v = 0.6 * Math.exp(-t / 0.055) * band * 1.4 + 0.35 * Math.exp(-t / 0.035) * Math.sin(2 * Math.PI * 190 * t);
        } else {
            const nz = rnd();
            hp1 = nz - prev; // first difference: +6 dB / oct high-pass
            prev = nz;
            v = 0.34 * Math.exp(-t / 0.02) * hp1;
        }
        out[i] = v;
    }
    return out;
}

// pattern: array of [kind, startSeconds]. Returns { L, R, events: [{kind, start, end}] } (sample indices).
function synthDrumLoop(sr, pattern, totalSeconds) {
    const total = Math.round(totalSeconds * sr);
    const L = new Float64Array(total);
    const R = new Float64Array(total);
    const rnd = lcg(777);
    const events = [];
    for (const [kind, st] of pattern) {
        const ev = drumEvent(kind, sr, rnd);
        const s0 = Math.round(st * sr);
        for (let i = 0; i < ev.length && s0 + i < total; i++) {
            L[s0 + i] += ev[i];
            R[s0 + i] += ev[i] * 0.97;
        }
        events.push({ kind, start: s0, end: Math.min(total, s0 + ev.length) });
    }
    return { L, R, events };
}

// Non-overlapping kick / snare / hat sequence used for learning and accuracy: 24 events 0.45 s apart.
function defaultDrumPattern() {
    const order = [0, 2, 1, 2, 0, 0, 1, 2];
    const pat = [];
    for (let i = 0; i < 24; i++) pat.push([order[i % order.length], 0.2 + i * 0.45]);
    return pat;
}

// Same events plus a hat on every off-beat 8th, which overlaps the other drums (a realistic loop).
function overlappedDrumPattern() {
    const pat = [];
    const order = [0, 1, 0, 1];
    for (let i = 0; i < 16; i++) {
        pat.push([order[i % 4], 0.2 + i * 0.5]);
        pat.push([2, 0.2 + i * 0.5 + 0.25]);
    }
    return pat;
}

// Run the whole stereo signal through a reference split; returns the chains' outputs for the given masks.
function renderChains(sr, params, centroids, L, R, masks, gainsDb) {
    const split = new TimbreSplitRef(sr, params, centroids);
    const chains = masks.map((m, i) => new TsplitChain(sr, m, gainsDb ? gainsDb[i] : 0));
    const outL = masks.map(() => new Float64Array(L.length));
    const outR = masks.map(() => new Float64Array(L.length));
    for (let i = 0; i < L.length; i++) {
        const o = split.push(L[i], R[i]);
        for (let c = 0; c < chains.length; c++) {
            const y = chains[c].process(o);
            outL[c][i] = y[0];
            outR[c][i] = y[1];
        }
    }
    return { outL, outR, split };
}

module.exports = {
    K,
    TimbreSplitRef,
    TsplitChain,
    mfccWithC0,
    lcg,
    DRUM,
    synthDrumLoop,
    defaultDrumPattern,
    overlappedDrumPattern,
    renderChains,
};
