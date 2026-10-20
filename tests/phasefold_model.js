"use strict";
// Node model of src/phasefold_core.genexpr. Same per-frame math on top of
// src/cepstrum_ref.js: 2x zero-padded cepstral fold with a relative log floor,
// signed pivot placement, a crest limiter that blends spiky frames back toward
// the input frame, and a smooth running Auto Gain. Used by tests/test_phasefold.js.
const ref = require("./../src/cepstrum_ref.js");

const EPS = 1e-9; // absolute floor of the log magnitude
const PAD = 2; // cepstral FFT size = PAD * N (no circular wrap of min/max-phase tails)
const FLOOR_DB = -50; // relative log floor: frame peak magnitude - 50 dB
const FLOOR_REL = Math.pow(10, FLOOR_DB / 20);
const LIM_DB = 8; // a sculpted frame may be at most this much spikier than the input frame
const LIM_STEPS = 8; // blend candidates 1/8 .. 8/8 toward the input frame
const AGC_FRAME = 0.25; // per-frame one-pole of the smoothed input / output frame energies
const AGC_SLEW = 1 / 882; // 20 ms one-pole (44.1 kHz) from the running gain to its target
const AGC_KC = 1.1; // +0.8 dB: re-phased frames add between incoherently (+3.1 dB needed) and coherently (0 dB)
const AGC_MAX = 4;
const AGC_MIN = 0.25;

// Signed moving-sum peak (window n/64 samples, centred). A signed profile keeps
// the landmark on the same side of a periodic waveform in every frame; the
// energy profile flipped between positive and negative peaks of a sine.
function findPivot(prof) {
    const n = prof.length;
    const L = Math.max(8, Math.round(n / 64));
    let s = 0;
    let best = -1e300;
    let bi = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
        s += prof[i];
        if (i >= L) s -= prof[i - L];
        if (i >= L - 1 && s > best) {
            best = s;
            bi = i - Math.floor(L / 2);
        }
    }
    return bi;
}

// crest = peak / rms of z over n samples
function crestOf(z, n) {
    let m = 0;
    let e = 0;
    for (let i = 0; i < n; i++) {
        const a = Math.abs(z[i]);
        if (a > m) m = a;
        e += z[i] * z[i];
    }
    return m / Math.sqrt(e / n + 1e-30);
}

// One frame. xw = Hann-windowed input frame (length n). phase -1..1.
// pivotOverride: use this pivot instead of the signed-peak one.
// Returns { y, yfull, z, g, cIn, cOut, pivot, eIn, eOut, blend, eps }:
//   yfull = the whole 2N inverse transform (before the tail past N is dropped),
//   y = time frame before the synthesis window, z = y * win after the crest limiter,
//   g = 1 (Auto Gain is a running gain applied in run()).
function processFrame(xw, win, phase, orig, autoGain, pivotOverride) {
    const n = xw.length;
    const m = n * PAD;
    const half = m / 2;
    let eIn = 0;
    let cIn = 0;
    for (let i = 0; i < n; i++) {
        const w2 = xw[i] * xw[i] * win[i] * win[i];
        eIn += w2;
        cIn += w2 * i;
    }
    cIn = eIn > 1e-24 ? cIn / eIn / n : 0.5;
    const pivot = pivotOverride !== undefined ? pivotOverride : findPivot(xw);
    const xr = new Float64Array(m);
    const xi = new Float64Array(m);
    xr.set(xw);
    ref.fft(xr, xi, false);
    let mx = 0;
    for (let k = 0; k < m; k++) mx = Math.max(mx, Math.hypot(xr[k], xi[k]));
    const eps = Math.max(mx * FLOOR_REL, EPS);
    const c = ref.realCepstrum(xr, xi, eps);
    const cw = new Float64Array(m);
    cw[0] = c[0];
    cw[half] = c[half];
    for (let i = 1; i < half; i++) {
        cw[i] = c[i] * (1 + phase);
        cw[m - i] = c[m - i] * (1 - phase);
    }
    const ls = ref.cepToLogSpec(cw);
    const sp = ref.expSpec(ls.re, ls.im, eps);
    const yr = new Float64Array(m);
    const yi = new Float64Array(m);
    for (let k = 0; k < m; k++) {
        const a = (-2 * Math.PI * ((k * pivot) % m)) / m;
        const cr = Math.cos(a);
        const ci = Math.sin(a);
        const pr = sp.re[k] * cr - sp.im[k] * ci;
        const pi = sp.re[k] * ci + sp.im[k] * cr;
        yr[k] = pr * (1 - orig) + xr[k] * orig;
        yi[k] = pi * (1 - orig) + xi[k] * orig;
    }
    ref.fft(yr, yi, true);
    // Crest limiter: the weighted frame z may be at most LIM_DB spikier than the
    // weighted input frame; otherwise blend it toward the input frame (a noise
    // frame collapses to a click under a rebuilt phase, a real click does not).
    const zo = new Float64Array(n);
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) zo[i] = xw[i] * win[i];
    const lim = crestOf(zo, n) * Math.pow(10, LIM_DB / 20);
    let blend = 0;
    for (let s = 0; s <= LIM_STEPS; s++) {
        blend = s / LIM_STEPS;
        for (let i = 0; i < n; i++) z[i] = (1 - blend) * yr[i] * win[i] + blend * zo[i];
        if (crestOf(z, n) <= lim) break;
    }
    let eOut = 0;
    let eZ = 0;
    let cn = 0;
    let cd = 0;
    for (let i = 0; i < n; i++) eZ += z[i] * z[i];
    for (let i = 0; i < n; i++) {
        const y2 = yr[i] * yr[i];
        eOut += y2 * win[i] * win[i];
        cn += y2 * (((i - pivot) % n + n) % n);
        cd += y2;
    }
    const cOut = cd > 1e-24 ? cn / cd / n : 0.5;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = yr[i];
    return { y, yfull: yr, z, g: 1, cIn, cOut, pivot, eIn, eOut, eZ, blend, eps };
}

// Whole-signal run, mono. Returns the output delayed by n - 1 like the lib.
// Auto Gain: sqrt(eiS / eoS), the one-poles (per processed frame) of the input
// frame energy and of the energy of the frame actually added. Frame energies
// share one time support, so a pre-ring or tail inside the frame does not
// count as a mismatch. The gain slews to its target per sample, fades out
// toward Orig 100 %.
function run(signal, n, phase, orig, autoGain, info) {
    const win = ref.hann(n);
    const ring = new Float64Array(n);
    const acc = new Float64Array(n);
    let wp = 0;
    let cnt = 0;
    let eiS = 0;
    let eoS = 0;
    let ge = 1;
    const out = new Float64Array(signal.length);
    for (let t = 0; t < signal.length; t++) {
        ring[wp] = signal[t];
        wp = (wp + 1) % n;
        cnt++;
        if (cnt >= n / 4) {
            cnt = 0;
            const xw = new Float64Array(n);
            let e = 0;
            for (let i = 0; i < n; i++) {
                xw[i] = ring[(wp + i) % n] * win[i];
                e += xw[i] * xw[i];
            }
            if (e > 1e-12) {
                const r = processFrame(xw, win, phase, orig, autoGain);
                if (info) info.push(r);
                for (let i = 0; i < n; i++) acc[(wp + i) % n] += r.z[i] * (2 / 3);
                eiS = eiS < 1e-20 ? r.eIn : eiS + (r.eIn - eiS) * AGC_FRAME;
                eoS = eoS < 1e-20 ? r.eZ : eoS + (r.eZ - eoS) * AGC_FRAME;
            }
        }
        const y = acc[wp];
        acc[wp] = 0;
        const target = autoGain ? agcGain(eiS, eoS, orig) : 1;
        ge += (target - ge) * AGC_SLEW;
        out[t] = y * ge;
    }
    return out;
}

// Gain target from the smoothed input / output frame energies (1 when either is empty).
function agcGain(ei, eo, orig) {
    let g = 1;
    if (ei > 1e-20 && eo > 1e-20) g = Math.min(AGC_MAX, Math.max(AGC_MIN, Math.sqrt(ei / eo) * AGC_KC));
    return 1 + (g - 1) * (1 - orig);
}

function frameEnergy(xw, win) {
    let s = 0;
    for (let i = 0; i < xw.length; i++) s += xw[i] * xw[i] * win[i] * win[i];
    return s;
}

function rms(x, a, b) {
    let s = 0;
    for (let i = a; i < b; i++) s += x[i] * x[i];
    return Math.sqrt(s / Math.max(1, b - a));
}

// Energy centroid (samples) of x^2 over [a, b).
function centroid(x, a, b) {
    let s = 0;
    let m = 0;
    for (let i = a; i < b; i++) {
        s += x[i] * x[i];
        m += x[i] * x[i] * i;
    }
    return s > 0 ? m / s : (a + b) / 2;
}

module.exports = {
    EPS, PAD, FLOOR_REL, LIM_DB, LIM_STEPS, AGC_FRAME, AGC_SLEW, AGC_KC, AGC_MAX, AGC_MIN,
    frameEnergy, findPivot, crestOf, processFrame, agcGain, run, rms, centroid,
};
