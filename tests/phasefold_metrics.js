"use strict";
// Artifact metrics and test signals for Phase Fold ("crispy" = crackly, gritty output).
// Shared by tests/test_phasefold.js and tests/render_phasefold_ab.js.
const ref = require("./../src/cepstrum_ref.js");

const SR = 44100;

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const db = (v) => 10 * Math.log10(v + 1e-30);

// ------------------------------------------------------------------ signals
function sine(len, f = 1000, amp = 0.5) {
    const x = new Float64Array(len);
    for (let i = 0; i < len; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / SR);
    return x;
}

// Full-band sawtooth (every harmonic up to Nyquist), 200 Hz by default.
function saw(len, f = 200, amp = 0.4) {
    const x = new Float64Array(len);
    for (let i = 0; i < len; i++) x[i] = amp * (2 * (((f * i) / SR) % 1) - 1);
    return x;
}

// Sustained chord of four sawtooth voices.
function chord(len) {
    const x = new Float64Array(len);
    for (const f of [110, 138.6, 164.8, 220]) {
        const s = saw(len, f, 0.2);
        for (let i = 0; i < len; i++) x[i] += s[i];
    }
    return x;
}

function whiteNoise(len, amp = 0.3, seed = 1) {
    const r = rng(seed);
    const x = new Float64Array(len);
    for (let i = 0; i < len; i++) x[i] = (r() * 2 - 1) * amp;
    return x;
}

// Paul Kellet's pink filter on white noise.
function pinkNoise(len, amp = 0.3, seed = 2) {
    const w = whiteNoise(len, 1, seed);
    const x = new Float64Array(len);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
        const v = w[i];
        b0 = 0.99886 * b0 + v * 0.0555179;
        b1 = 0.99332 * b1 + v * 0.0750759;
        b2 = 0.969 * b2 + v * 0.153852;
        b3 = 0.8665 * b3 + v * 0.3104856;
        b4 = 0.55 * b4 + v * 0.5329522;
        b5 = -0.7616 * b5 - v * 0.016898;
        x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + v * 0.5362) * 0.11 * amp * 3;
        b6 = v * 0.115926;
    }
    return x;
}

// 4-on-the-floor loop at 120 bpm: kick, snare on 2 and 4, closed hats on the 8ths.
function drums(len, seed = 7) {
    const r = rng(seed);
    const x = new Float64Array(len);
    const beat = Math.floor(SR * 0.5);
    for (let t = 0, b = 0; t < len; t += beat / 2, b++) {
        const i0 = Math.floor(t);
        if (b % 2 === 0) {
            for (let i = 0; i < 9000 && i0 + i < len; i++) {
                const ph = 2 * Math.PI * (45 * (i / SR) + 25 * (1 - Math.exp(-i / 900)) * 0.4) ;
                x[i0 + i] += 0.8 * Math.exp(-i / 2600) * Math.sin(ph);
            }
        }
        if (b % 4 === 2) {
            for (let i = 0; i < 9000 && i0 + i < len; i++) {
                x[i0 + i] += Math.exp(-i / 1800) * (0.5 * (r() * 2 - 1) + 0.3 * Math.sin((2 * Math.PI * 190 * i) / SR));
            }
        }
        for (let i = 0; i < 2000 && i0 + i < len; i++) x[i0 + i] += 0.25 * Math.exp(-i / 250) * (r() * 2 - 1);
    }
    return x;
}

// Simple two-biquad 4th-order lowpass, to make band-limited versions.
function lowpass(x, fc) {
    const y = Float64Array.from(x);
    for (let k = 0; k < 2; k++) {
        const w = (2 * Math.PI * fc) / SR;
        const al = Math.sin(w) / (2 * 0.707);
        const c = Math.cos(w);
        const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2;
        const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < y.length; i++) {
            const xi = y[i];
            const o = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
            x2 = x1; x1 = xi; y2 = y1; y1 = o;
            y[i] = o;
        }
    }
    return y;
}

// ------------------------------------------------------------------ metrics
// Power spectrum (Hann, N points) of x starting at a.
function powerSpectrum(x, a, N = 8192) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (x[a + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    ref.fft(re, im, false);
    const p = new Float64Array(N / 2);
    for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
    return p;
}

// Hop-rate amplitude modulation: standard deviation (dB) of the 256-sample block RMS.
// A stationary signal is below 1.5 dB; a click train at the hop rate is 4..6 dB.
function envRipple(y, a, b, B = 256) {
    const v = [];
    for (let i = a; i + B <= b; i += B) {
        let s = 0;
        for (let j = 0; j < B; j++) s += y[i + j] * y[i + j];
        v.push(db(s / B));
    }
    const m = v.reduce((p, q) => p + q, 0) / v.length;
    return Math.sqrt(v.reduce((p, q) => p + (q - m) * (q - m), 0) / v.length);
}

// Peak-to-peak (dB) of the 64-sample block RMS of a steady tone: its amplitude modulation.
function amRipple(y, a, b) {
    let mn = 1e9;
    let mx = 0;
    for (let i = a; i + 64 <= b; i += 64) {
        let s = 0;
        for (let j = 0; j < 64; j++) s += y[i + j] * y[i + j];
        mn = Math.min(mn, Math.sqrt(s / 64));
        mx = Math.max(mx, Math.sqrt(s / 64));
    }
    return db(mx * mx) - db(mn * mn);
}

// Crest factor in dB of y over [a, b).
function crestDb(y, a, b) {
    let s = 0;
    let m = 0;
    for (let i = a; i < b; i++) {
        s += y[i] * y[i];
        m = Math.max(m, Math.abs(y[i]));
    }
    return db((m * m) / (s / (b - a)));
}

function rmsDb(y, a, b) {
    let s = 0;
    for (let i = a; i < b; i++) s += y[i] * y[i];
    return db(s / (b - a));
}

// Noise floor between the harmonics of a periodic wave at f0, in dB below the harmonics
// (power per bin in the gaps / power per bin on the harmonics). Higher = grittier.
function interharmonicFloorDb(y, a, f0) {
    const N = 8192;
    const p = powerSpectrum(y, a, N);
    let h = 0, hc = 0, g = 0, gc = 0;
    for (let k = 2; k < N / 2; k++) {
        const fr = (k * SR) / N;
        const ph = (fr / f0) % 1;
        const d = Math.min(ph, 1 - ph) * f0;
        if (d < f0 * 0.04) { h += p[k]; hc++; } else if (d > f0 * 0.2) { g += p[k]; gc++; }
    }
    return db(g / gc) - db(h / hc);
}

// Share (dB) of the power outside +-60 Hz of f: spectral purity of a sine.
function sineImpurityDb(y, a, f) {
    const N = 8192;
    const p = powerSpectrum(y, a, N);
    let inside = 0;
    let total = 0;
    for (let k = 2; k < N / 2; k++) {
        const fr = (k * SR) / N;
        total += p[k];
        if (Math.abs(fr - f) < 60) inside += p[k];
    }
    return db((total - inside) / total);
}

// Power (dB) above f0 Hz, in a 8192-point spectrum starting at a.
function highBandDb(y, a, f0 = 10000) {
    const N = 8192;
    const p = powerSpectrum(y, a, N);
    let s = 0;
    for (let k = Math.floor((f0 / SR) * N); k < N / 2; k++) s += p[k];
    return db(s);
}

module.exports = {
    SR, rng, db,
    sine, saw, chord, whiteNoise, pinkNoise, drums, lowpass,
    powerSpectrum, envRipple, amRipple, crestDb, rmsDb, interharmonicFloorDb, sineImpurityDb, highBandDb,
};
