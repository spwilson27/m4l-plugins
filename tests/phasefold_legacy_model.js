"use strict";
// LEGACY model (before the crispiness fix): kept only so tests/test_phasefold.js and
// tests/render_phasefold_ab.js can compare the old and the new processing. Do not use for the device.
// Node model of the old src/phasefold_core.genexpr. Same per-frame math (cepstral
// asymmetric fold, pivot placement, Orig blend, frame energy gain) on top of
// src/cepstrum_ref.js. Used by tests/test_phasefold.js.
const ref = require("./../src/cepstrum_ref.js");

const EPS = 1e-9;
const KC = 0.43; // +3.1 dB: incoherent overlap-add compensation

// Moving-sum energy peak (length n/64 window, centred). ep = windowed energy profile.
function findPivot(ep) {
    const n = ep.length;
    const L = Math.max(8, Math.round(n / 64));
    let s = 0;
    let best = -1;
    let bi = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
        s += ep[i];
        if (i >= L) s -= ep[i - L];
        if (i >= L - 1 && s > best) {
            best = s;
            bi = i - Math.floor(L / 2);
        }
    }
    return bi;
}

// One frame. xw = Hann-windowed input frame (length n). phase -1..1.
// Returns { y, g, cIn, cOut, pivot, eIn, eOut } where y is the time frame
// before the synthesis window and the 2/3 scale.
function processFrame(xw, win, phase, orig, autoGain, pivotOverride) {
    const n = xw.length;
    const half = n / 2;
    const ep = new Float64Array(n);
    let eIn = 0;
    let cIn = 0;
    for (let i = 0; i < n; i++) {
        ep[i] = xw[i] * xw[i];
        const w2 = ep[i] * win[i] * win[i];
        eIn += w2;
        cIn += w2 * i;
    }
    cIn = eIn > 1e-24 ? cIn / eIn / n : 0.5;
    const pivot = pivotOverride !== undefined ? pivotOverride : findPivot(ep);
    const xr = Float64Array.from(xw);
    const xi = new Float64Array(n);
    ref.fft(xr, xi, false);
    const c = ref.realCepstrum(xr, xi, EPS);
    const cw = new Float64Array(n);
    cw[0] = c[0];
    cw[half] = c[half];
    for (let i = 1; i < half; i++) {
        cw[i] = c[i] * (1 + phase);
        cw[n - i] = c[n - i] * (1 - phase);
    }
    const ls = ref.cepToLogSpec(cw);
    const sp = ref.expSpec(ls.re, ls.im, EPS);
    const yr = new Float64Array(n);
    const yi = new Float64Array(n);
    for (let k = 0; k < n; k++) {
        const a = (-2 * Math.PI * ((k * pivot) % n)) / n;
        const cr = Math.cos(a);
        const ci = Math.sin(a);
        const pr = sp.re[k] * cr - sp.im[k] * ci;
        const pi = sp.re[k] * ci + sp.im[k] * cr;
        yr[k] = pr * (1 - orig) + xr[k] * orig;
        yi[k] = pi * (1 - orig) + xi[k] * orig;
    }
    ref.fft(yr, yi, true);
    let eOut = 0;
    let cn = 0;
    let cd = 0;
    for (let i = 0; i < n; i++) {
        const y2 = yr[i] * yr[i];
        eOut += y2 * win[i] * win[i];
        cn += y2 * (((i - pivot) % n + n) % n);
        cd += y2;
    }
    const cOut = cd > 1e-24 ? cn / cd / n : 0.5;
    let g = 1;
    if (autoGain && eOut > 1e-24) g = Math.min(4, Math.sqrt(eIn / eOut) * (1 + KC * (1 - orig)));
    for (let i = 0; i < n; i++) yr[i] *= g;
    return { y: yr, g, cIn, cOut, pivot, eIn, eOut };
}

// Whole-signal run, mono. Returns the output delayed by n - 1 like the lib.
function run(signal, n, phase, orig, autoGain, info) {
    const win = ref.hann(n);
    const ring = new Float64Array(n);
    const acc = new Float64Array(n);
    let wp = 0;
    let cnt = 0;
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
            if (frameEnergy(xw, win) > 1e-12) {
                const r = processFrame(xw, win, phase, orig, autoGain);
                if (info) info.push(r);
                for (let i = 0; i < n; i++) {
                    const j = (wp + i) % n;
                    acc[j] += r.y[i] * win[i] * (2 / 3);
                }
            }
        }
        out[t] = acc[wp];
        acc[wp] = 0;
    }
    return out;
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

module.exports = { EPS, KC, frameEnergy, findPivot, processFrame, run, rms, centroid };
