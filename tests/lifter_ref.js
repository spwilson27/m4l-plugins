"use strict";
// Node reference for src/lifter_core.genexpr (one channel, no telemetry): the same
// per-frame math on top of src/cepstrum_ref.js, so tests/test_lifter.js can predict
// what the gen code does. Also the harmonicity metric used by the Max audio test.
const ref = require("../src/cepstrum_ref.js");

const LIM = 4.6;
const EPS = 1e-9;

function interp(table, x) {
    const p = Math.min(1, Math.max(0, x)) * (table.length - 1);
    const i0 = Math.floor(p);
    const i1 = Math.min(i0 + 1, table.length - 1);
    const f = p - i0;
    return table[i0] * (1 - f) + table[i1] * f;
}

// scl = qref / q_pitch (1 when Track is off). depth in -1..1.
function gainTable(table, n, sr, scl, depth) {
    const g = new Float64Array(n / 2 + 1);
    const base = sr * 0.0002;
    for (let q = 0; q <= n / 2; q++) {
        const x = Math.log((Math.max(q, 0.5) * scl) / base) / Math.log(200);
        g[q] = Math.exp(interp(table, x) * depth * 0.11512925464970229);
    }
    return g;
}

// cep_peak plus the octave check from lft_proc: take the peak near half the
// period when its 3-bin mass is at least half of the strongest one's.
function pickPitch(c, lo, hi) {
    const main = ref.pitchPeak(c, lo, hi);
    let q = main.q;
    const qh = Math.floor(q * 0.5);
    let bq = qh;
    let bv = -1e30;
    for (let k = qh - 2; k <= qh + 2; k++) {
        const ms = c[k - 1] + c[k] + c[k + 1];
        if (k >= lo && ms > bv) {
            bv = ms;
            bq = k;
        }
    }
    const mi = c[q - 1] + c[q] + c[q + 1];
    if (qh >= lo && bv > 0 && bv > 0.5 * mi) q = bq;
    const conf = main.conf; // confidence of the strongest peak
    const a = c[q - 1];
    const d = c[q + 1];
    const den = a - 2 * c[q] + d;
    const frac = Math.abs(den) > 1e-20 ? Math.min(0.5, Math.max(-0.5, (0.5 * (a - d)) / den)) : 0;
    return { q, conf, qFrac: q + frac };
}

// smooth01: 0..1 (gen: Smooth % / 100). Returns { stft, state }.
function makeLifter(n, sr, table, opts) {
    const o = Object.assign({ depth: 1, smooth: 0, scl: 1 }, opts || {});
    const cs = new Float64Array(n / 2 + 1);
    const a = o.smooth < 0.001 ? 0 : Math.exp(-((n * 0.25) / sr) / (0.4 * o.smooth));
    const gt = gainTable(table, n, sr, o.scl, o.depth);
    const state = { pitch: [], conf: [] };
    const stft = new ref.Stft(n, (re, im) => {
        const c = ref.realCepstrum(re, im, EPS);
        const lo = Math.floor(sr * 0.002);
        const hi = Math.min(Math.floor(sr * 0.02), n / 2 - 2);
        if (hi - lo > 8) {
            const p = pickPitch(c, lo, hi);
            state.pitch.push(p.qFrac);
            state.conf.push(p.conf);
        }
        const d = new Float64Array(n);
        for (let q = 1; q <= n / 2; q++) {
            const sd = a * cs[q] + (1 - a) * (gt[q] - 1) * c[q];
            cs[q] = sd;
            d[q] = sd;
            if (q < n / 2) d[n - q] = sd;
        }
        const ls = ref.cepToLogSpec(d);
        for (let i = 0; i < n; i++) {
            const g = Math.exp(LIM * Math.tanh(ls.re[i] / LIM));
            re[i] *= g;
            im[i] *= g;
        }
    });
    return { stft, state };
}

// Mean (harmonic peak dB - valley dB) over harmonics 2..K of f0 in a Hann-windowed
// FFT of len samples starting at start. Higher = more harmonic.
function peakToValley(sig, start, len, f0, sr) {
    const re = new Float64Array(len);
    const im = new Float64Array(len);
    for (let i = 0; i < len; i++) re[i] = sig[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len));
    ref.fft(re, im, false);
    const db = (k) => 20 * Math.log10(Math.hypot(re[k], im[k]) + 1e-12);
    const df = sr / len;
    let sum = 0;
    let cnt = 0;
    for (let h = 2; h * f0 < 9000 && h <= 30; h++) {
        const kp = Math.round((h * f0) / df);
        const kv = Math.round(((h + 0.5) * f0) / df);
        let pk = -1e9;
        for (let k = kp - 2; k <= kp + 2; k++) pk = Math.max(pk, db(k));
        let vs = 0;
        for (let k = kv - 3; k <= kv + 3; k++) vs += db(k);
        sum += pk - vs / 7;
        cnt++;
    }
    return sum / cnt;
}

module.exports = { LIM, EPS, interp, gainTable, pickPitch, makeLifter, peakToValley };
