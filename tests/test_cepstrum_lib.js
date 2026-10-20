#!/usr/bin/env node
"use strict";
// Node tests for the shared cepstrum/STFT engine: src/cepstrum_ref.js is the
// reference, src/cepstrum_lib.genexpr gets a lint. Real Max audio checks live in
// scripts/run_cepstrum_lib_audio_tests.py.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ref = require("../src/cepstrum_ref.js");

const ROOT = path.join(__dirname, "..");

// Deterministic noise in [-1, 1).
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    };
}
function noise(n, seed) {
    const r = rng(seed);
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = r();
    return x;
}
function maxAbsDiff(a, b) {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
}
function centroid(x) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < x.length; i++) {
        num += i * x[i] * x[i];
        den += x[i] * x[i];
    }
    return num / den;
}

// --- FFT against a naive DFT, and the round trip --------------------------
for (const n of [2, 8, 64, 256]) {
    const re = noise(n, n);
    const im = noise(n, n + 1);
    const want = ref.dft(re, im, -1);
    const gr = Float64Array.from(re);
    const gi = Float64Array.from(im);
    ref.fft(gr, gi, false);
    assert.ok(maxAbsDiff(gr, want.re) < 1e-9 && maxAbsDiff(gi, want.im) < 1e-9, `fft == dft at ${n}`);
    ref.fft(gr, gi, true);
    assert.ok(maxAbsDiff(gr, re) < 1e-12 && maxAbsDiff(gi, im) < 1e-12, `ifft(fft(x)) == x at ${n}`);
}
for (const n of [512, 1024, 2048, 4096]) {
    const re = noise(n, 7);
    const im = noise(n, 8);
    const gr = Float64Array.from(re);
    const gi = Float64Array.from(im);
    ref.fft(gr, gi, false);
    ref.fft(gr, gi, true);
    assert.ok(maxAbsDiff(gr, re) < 1e-11 && maxAbsDiff(gi, im) < 1e-11, `round trip at ${n}`);
}
assert.deepStrictEqual([100, 512, 1000, 3000, 9999].map(ref.snapN), [512, 512, 1024, 4096, 4096]);

// --- OLA identity: unity gain and latency n - 1 -----------------------------
for (const n of [512, 1024, 2048, 4096]) {
    const x = noise(n * 6, 40 + n);
    const stft = new ref.Stft(n);
    const y = stft.run(x);
    const lat = ref.Stft.latency(n);
    assert.strictEqual(lat, n - 1);
    // Output index t carries input t - lat once the first frames have filled in.
    let err = 0;
    for (let t = lat + n; t < x.length; t++) err = Math.max(err, Math.abs(y[t] - x[t - lat]));
    assert.ok(err < 1e-12, `OLA identity at ${n}: max error ${err}`);
    // A constant input is a unity-gain DC check.
    const dc = new ref.Stft(n).run(new Float64Array(n * 4).fill(0.5));
    assert.ok(Math.abs(dc[dc.length - 1] - 0.5) < 1e-12, `DC unity at ${n}`);
}

// --- Cepstrum chain: remag with the cepstral log magnitude is identity ------
{
    const n = 1024;
    const re = noise(n, 3);
    const im = new Float64Array(n);
    ref.fft(re, im, false);
    const eps = 1e-9;
    const ls = ref.cepToLogSpec(ref.realCepstrum(re, im, eps));
    const back = ref.remag(re, im, ls.re, eps);
    assert.ok(maxAbsDiff(back.re, re) < 1e-8 && maxAbsDiff(back.im, im) < 1e-8, "remag(cepstrum) restores the spectrum");
    // The cepstrum of a real signal is real and even.
    const c = ref.realCepstrum(re, im, eps);
    for (let i = 1; i < n / 2; i++) assert.ok(Math.abs(c[i] - c[n - i]) < 1e-9, "cepstrum is even");
}

// --- Minimum phase: same magnitude, energy toward the start -----------------
for (const n of [512, 1024, 4096]) {
    // Maximum-phase signal: a decaying exponential played backwards, so the
    // energy sits at the END of the frame.
    const x = new Float64Array(n);
    for (let i = 0; i < 200; i++) x[n - 1 - i] = Math.pow(0.97, i);
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    ref.fft(re, im, false);
    const eps = 1e-9;
    const mp = ref.minPhaseSpectrum(re, im, eps);
    let magErr = 0;
    for (let i = 0; i < n; i++) {
        magErr = Math.max(magErr, Math.abs(Math.hypot(mp.re[i], mp.im[i]) - Math.hypot(re[i], im[i])));
    }
    assert.ok(magErr < 1e-6, `min-phase keeps the magnitude at ${n} (err ${magErr})`);
    const tr = Float64Array.from(mp.re);
    const ti = Float64Array.from(mp.im);
    ref.fft(tr, ti, true);
    assert.ok(maxAbsDiff(ti, new Float64Array(n)) < 1e-9, "min-phase signal is real");
    assert.ok(centroid(tr) < centroid(x) * 0.5, `min-phase moves energy to the start at ${n}: ${centroid(x)} -> ${centroid(tr)}`);
    assert.ok(centroid(tr) < 100, "min-phase energy is near the start");
    // Same energy per sample is not required, but total energy matches (Parseval).
    let e0 = 0;
    let e1 = 0;
    for (let i = 0; i < n; i++) { e0 += x[i] * x[i]; e1 += tr[i] * tr[i]; }
    assert.ok(Math.abs(e1 / e0 - 1) < 1e-6, "min-phase energy matches");
    // Max-phase fold mirrors it back to the end with the same magnitude.
    const mx = ref.cepToLogSpec(ref.foldMaxPhase(ref.realCepstrum(re, im, eps)));
    const xs = ref.expSpec(mx.re, mx.im, eps);
    const xr = Float64Array.from(xs.re);
    const xi = Float64Array.from(xs.im);
    ref.fft(xr, xi, true);
    assert.ok(centroid(xr) > n * 0.8, `max-phase puts energy at the end at ${n}`);
}

// --- Streaming min-phase: finite, magnitude kept per frame -------------------
{
    const n = 1024;
    let worst = 0;
    let frames = 0;
    const stft = new ref.Stft(n, (re, im) => {
        const mag = Float64Array.from(re, (v, i) => Math.hypot(v, im[i]));
        const mp = ref.minPhaseSpectrum(re, im, 1e-9);
        for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(Math.hypot(mp.re[i], mp.im[i]) - mag[i]));
        re.set(mp.re);
        im.set(mp.im);
        frames++;
    });
    const y = stft.run(noise(n * 8, 11));
    assert.ok(frames > 20 && y.every(Number.isFinite), "streaming min-phase stays finite");
    assert.ok(worst < 1e-6, `streaming min-phase magnitude error ${worst}`);
}

// --- Pitch peak on a known pulse train ---------------------------------------
for (const [n, period] of [[2048, 150], [4096, 300], [2048, 97]]) {
    const sr = 44100;
    const x = new Float64Array(n * 2);
    for (let i = 0; i < x.length; i += period) x[i] = 0.5;
    const frame = x.slice(n / 2, n / 2 + n);
    const w = ref.hann(n);
    const re = Float64Array.from(frame, (v, i) => v * w[i]);
    const im = new Float64Array(n);
    ref.fft(re, im, false);
    const c = ref.realCepstrum(re, im, 1e-9);
    const lo = Math.floor(sr * 0.002);
    const hi = Math.floor(sr * 0.02);
    const p = ref.pitchPeak(c, lo, hi);
    assert.ok(Math.abs(p.qFrac - period) < 0.6, `pitch peak ${p.qFrac} vs ${period} at ${n}`);
    assert.strictEqual(p.q, period);
    assert.ok(p.conf > 0.5, `pitch confidence ${p.conf}`);
    // White noise has no cepstral peak.
    const nr = Float64Array.from(noise(n, 5), (v, i) => v * w[i]);
    const ni = new Float64Array(n);
    ref.fft(nr, ni, false);
    assert.ok(ref.pitchPeak(ref.realCepstrum(nr, ni, 1e-9), lo, hi).conf < 0.5, "noise has low confidence");
}

// --- GenExpr lint -------------------------------------------------------------
function lintGen(name, code) {
    assert.ok(!/\be\d/.test(code), `${name}: e0..e9 identifiers are Euler's number in GenExpr`);
    assert.ok(!/\bdelay\(/.test(code), `${name}: delay() is not valid GenExpr`);
    const open = (code.match(/\{/g) || []).length;
    const close = (code.match(/\}/g) || []).length;
    assert.strictEqual(open, close, `${name}: unbalanced braces`);
}
function stripComments(code) {
    return code.replace(/\/\/[^\n]*/g, "");
}
const libCode = fs.readFileSync(path.join(ROOT, "src", "cepstrum_lib.genexpr"), "utf8");
const coreCode = fs.readFileSync(path.join(ROOT, "tests", "cepstrum_lib_core.genexpr"), "utf8");
lintGen("lib", libCode);
lintGen("test core", coreCode);

const lib = stripComments(libCode);
const declRe = /^(Param|Buffer|History|Delay|Data)\b/m;
assert.ok(!declRe.test(lib), "lib has no top-level Param/Buffer/History/Delay/Data (the core declares them)");
const defRe = /^([A-Za-z_]\w*)\(([^)]*)\)\s*\{/gm;
const defs = [];
let m;
while ((m = defRe.exec(lib)) !== null) defs.push({ name: m[1], at: m.index });
assert.ok(defs.length >= 17, `lib defines its functions (${defs.length})`);
const names = new Set(defs.map((d) => d.name));
for (const need of [
    "cep_n", "fft_init", "fft_run", "stft_win", "stft_in", "stft_frame", "stft_ola", "stft_out",
    "cep_from_spec", "cep_to_logmag", "cep_fold_minphase", "cep_fold_maxphase", "cep_exp_spec",
    "cep_remag", "cep_peak", "cep_peak_conf", "cep_peak_refine",
]) assert.ok(names.has(need), `lib defines ${need}`);
// A function may only call functions defined above it.
defs.forEach((d, i) => {
    const end = i + 1 < defs.length ? defs[i + 1].at : lib.length;
    const body = lib.slice(d.at, end);
    const later = defs.slice(i).map((x) => x.name);
    for (const callee of later) {
        const calls = body.split(callee + "(").length - 1 - (callee === d.name ? 1 : 0);
        assert.ok(calls <= 0, `${d.name} calls ${callee} before it is defined`);
    }
});
// Function-local History/Data-free: declarations inside functions must be indented.
for (const ln of libCode.split("\n")) {
    if (/^\s*(Param|Buffer|Delay|Data)\b/.test(ln) && !/^\s*\/\//.test(ln)) {
        assert.fail(`lib declares ${ln.trim()}: only History is allowed inside functions`);
    }
}

// Lib + core: every function precedes the first declaration or statement of the core.
const full = stripComments(libCode + "\n" + coreCode);
const firstDecl = full.search(/^(Param|Buffer|History|Delay|Data)\b/m);
const lastDef = Math.max(...[...full.matchAll(/^[A-Za-z_]\w*\([^)]*\)\s*\{/gm)].map((x) => x.index));
assert.ok(firstDecl > lastDef, "all functions come before every Param/History/Data declaration");
// The core declares the Data the library documents, at full size.
for (const decl of ["Data tab(4096, 3)", "Data win(4096)", "Data fx(4096, 2)", "Data fc(4096, 2)", "Data ring(4096)", "Data acc(4096)", "Data st(4)"]) {
    assert.ok(coreCode.includes(decl), `test core declares ${decl}`);
}
assert.ok(libCode.includes("Data tab(4096, 3);") && libCode.includes("Data st(4);"), "lib documents the Data it needs");

console.log("test_cepstrum_lib: ok");
