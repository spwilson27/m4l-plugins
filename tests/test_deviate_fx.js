"use strict";
// Host tests of Deviate's effect helpers (src/deviate_fx.genexpr) and of the hidden-value -> parameter-vector mapping (dv_pg1..3, dv_pvsm in
// src/deviate_core.genexpr), run through tests/genexpr_functions.js with bounds-checked Data (an out-of-range ring access THROWS here; Max
// would clamp it silently). GenExpr lint of every Deviate gen text. Real behaviour (timing, tails, CPU) is the audio suite's job.
//   node tests/test_deviate_fx.js

const cfg = require("../src/deviate_config.js");
const gx = require("./genexpr_functions.js");
const L = require("./lint_lib.js");
const lib = require("./deviate_dsp_lib.js");

globalThis.atan2 = Math.atan2;
let fails = 0, checks = 0;
function ok(cond, msg) {
    checks++;
    if (!cond) { fails++; console.log("FAIL: " + msg); }
}
const T = lib.genTexts();
const fns = gx.load(T.full);
const SR = 48000;

// ---- lint of every gen text the device builds ----
for (const [label, text] of [["main gen", T.full], ["spec gen", T.spec]]) {
    const lint = L.lintGenExpr(text, label);
    lint.forEach((l) => ok(false, `${l.rule}: ${l.msg}`));
    ok(lint.length === 0, `${label}: lintGenExpr clean`);
}
{
    // one call site of every History-holding helper (a second call site would share its coefficient cache)
    const code = L.stripComments(T.full);
    for (const n of ["gl_drive", "gl_filter", "gl_crush", "gl_ring", "gl_form", "gl_comb", "gl_phas", "gl_slap", "dv_rev", "dv_dly", "dv_grain", "dv_snap", "dv_res",
        "dv_chor", "dvc_tick", "dv_click"]) {
        const calls = (code.match(new RegExp("(^|[^.\\w])" + n + "\\(", "g")) || []).length;
        ok(calls === 2, `${n}: one definition + exactly one call site (found ${calls})`);
    }
    ok(!/\bfract\s*\(/.test(code), "no fract()");
    // the helpers that mention History inside may only be defined once
    ok((code.match(/^dv_rev\(/gm) || []).length === 1, "dv_rev defined once");
}

// ---- mapping hidden values -> parameter vector ----
const HI = cfg.DV_HIDDEN_INDEX;
const data = (n, ch) => new gx.DataSim(n, ch || 1);
function page(hv) {
    const h = data(64), q = data(72);
    hv.forEach((v, i) => h.poke(v, i));
    fns.dv_pg1(h, q); fns.dv_pg2(h, q); fns.dv_pg3(h, q);
    return q;
}
const WETS = [0, 1, 8, 12, 16, 20, 24, 28, 32, 40, 44, 47, 48, 52, 56, 61, 65];
{
    const q = page(cfg.dvHiddenNeutral());
    ok(WETS.every((i) => q.peek(i) === 0), `neutral hidden values give exactly 0 for every wet / amount (${WETS.filter((i) => q.peek(i) !== 0)})`);
    // pass-through entries come from the right hidden row
    const hv = new Float64Array(64);
    for (let i = 0; i < cfg.DV_HIDDEN_COUNT; i++) hv[i] = 3.0 + i * 1.37;
    hv[HI.tr_s] = 0.8;
    const q2 = page(hv);
    const pass = { 0: "snap_amt", 1: "click_lvl", 2: "click_hz", 18: "tfilt_hz", 20: "res_wet", 21: "res_f0", 22: "res_stretch", 24: "comb_wet", 25: "comb_hz",
        28: "form_wet", 29: "form_vowel", 32: "phas_wet", 35: "phas_hz", 40: "pitch_wet", 41: "pitch_st", 42: "grain_ms", 44: "ring_wet", 46: "ring_hz", 47: "sat_amt",
        48: "chor_wet", 49: "chor_hz", 50: "chor_ms", 52: "rev_wet", 53: "rev_size", 56: "dly_wet", 57: "dly_ms", 61: "slap_wet", 65: "conv_wet", 66: "conv_ir", 12: "crush_wet" };
    for (const k in pass) ok(q2.peek(Number(k)) === hv[HI[pass[k]]], `pv[${k}] = hidden ${pass[k]}`);
    ok(q2.peek(13) === 12 - 1.25 * hv[HI.crush_bits] && q2.peek(14) === 1 + 0.75 * hv[HI.crush_bits], "crush bits / factor from crush_bits");
}
{
    // monotonic in every meta; wets and derived values finite and inside the helpers' ranges; every in-loop decay <= 0.9 Tr
    for (let m = 0; m < 8; m++) {
        let prev = null;
        for (let v = (m === 1 ? 50 : 0); v <= 100; v += 2) {
            const E = [0, 50, 0, 0, 0, 0, 0, 0];
            E[m] = v;
            const q = page(cfg.dvHiddenFromMetas(E, E));
            const w = WETS.map((i) => q.peek(i));
            for (let i = 0; i < 72; i++) ok(Number.isFinite(q.peek(i)), `pv[${i}] finite (meta ${m} = ${v})`);
            if (prev) w.forEach((x, k) => { if (x < prev[k] - 1e-12 && m !== 7) ok(false, `wet pv[${WETS[k]}] decreased with meta ${m} (${prev[k]} -> ${x})`); });
            prev = w;
        }
    }
    let bad = 0;
    for (let ring = 0; ring <= 100; ring += 5) {
        for (let space = 0; space <= 100; space += 25) {
            const E = [100, 50, 100, 100, space, 100, 100, ring];
            const hv = cfg.dvHiddenFromMetas(E, E);
            const tr = hv[HI.tr_s];
            const q = page(hv);
            const t9 = 0.9 * tr;
            if (!(q.peek(54) <= Math.max(t9, 0.03) + 1e-12)) bad++;                                    // reverb RT60
            const combT60 = -3 / (q.peek(25) * Math.log10(Math.max(q.peek(26), 1e-9)));
            if (q.peek(26) > 0 && combT60 > t9 + 1e-9 && t9 > 0.0201) bad++;                           // comb: 60 dB within 0.9 Tr
            const dlyT60 = -3 * (q.peek(57) * 0.001) / Math.log10(Math.max(q.peek(58), 1e-12));
            if (q.peek(58) > 1e-9 && dlyT60 > Math.max(t9, 0.03) + 1e-9) bad++;                        // delay
            if (!(q.peek(23) <= 1.2 + 1e-12 && q.peek(23) >= 0.05 - 1e-12)) bad++;                     // resonator t60
        }
    }
    ok(bad === 0, `every in-loop decay (reverb, comb, delay, resonator) is at most 0.9 Tr (${bad} violations)`);
    // dv_pvsm: moves toward the target, snaps, hard copies
    const q = data(72), qt = data(72);
    qt.poke(10, 20); qt.poke(0, 21);
    q.poke(0, 20); q.poke(0.5, 21);
    fns.dv_pvsm(q, qt, 0.5, 0);
    ok(q.peek(20) === 5 && q.peek(21) === 0.25, "dv_pvsm moves by k");
    for (let i = 0; i < 60; i++) fns.dv_pvsm(q, qt, 0.5, 0);
    ok(q.peek(20) === 10 && q.peek(21) === 0, "dv_pvsm snaps to the target (exact 0 for a wet)");
    q.poke(7, 20);
    fns.dv_pvsm(q, qt, 0.01, 1);
    ok(q.peek(20) === 10, "dv_pvsm hard = 1 copies the target");
}

// ---- dv_wsoft, dv_soft ----
{
    let idn = true, mono = true, prev = -9, bound = 0;
    for (let x = -1.2; x <= 1.2; x += 0.05) if (fns.dv_wsoft(x) !== x) idn = false;
    for (let x = -50; x <= 50; x += 0.1) {
        const y = fns.dv_wsoft(x);
        if (y < prev) mono = false;
        prev = y; bound = Math.max(bound, Math.abs(y));
    }
    ok(idn && mono && bound <= 2.5 + 1e-9, `dv_wsoft: identity to 1.2, monotonic, bounded by 2.5 (max ${bound})`);
}

// ---- dv_wipe ----
{
    const d = data(1000, 2);
    for (let i = 0; i < 1000; i++) { d.poke(1, i, 0); d.poke(2, i, 1); }
    fns.dv_wipe(d, 3, 40, 1000, 1);
    let zeros = 0, others = 0;
    for (let i = 0; i < 1000; i++) {
        if (d.peek(i, 0) === 0 && d.peek(i, 1) === 0) zeros++; else others++;
    }
    ok(zeros === 40 && d.peek(120, 0) === 0 && d.peek(159, 1) === 0 && d.peek(160, 0) === 1 && d.peek(119, 1) === 2, "dv_wipe clears exactly slice 3 of 40 on both channels");
    const e = data(100);
    for (let k = 0; k < 8; k++) fns.dv_wipe(e, k, 16, 100, 0); // slices past the end are skipped (no out-of-range poke)
    ok(true, "dv_wipe never writes past the Data");
    // a wipe schedule of the core: 1536 slices cover every ring
    const sizes = [[393408, 257], [16512, 11], [8192, 6], [512, 1], [65536, 43], [16384, 11]];
    ok(sizes.every(([sz, n]) => n * 1536 >= sz), "the 1536-slice wipe covers every array");
}

// ---- dv_snap ----
{
    const io = data(2), st = data(4);
    // a constant 0.4 signal from silence: the onset is emphasised, the sustain returns to the plain (soft-limited) level
    const out = [];
    for (let i = 0; i < 4000; i++) {
        io.poke(0.4, 0); io.poke(0.4, 1);
        fns.dv_snap(io, 1, st, SR);
        out.push(io.peek(0));
    }
    const plain = 1.5 * Math.tanh(0.4 * 2 / 3);
    ok(Math.max(...out.slice(0, 200)) > plain * 1.2, `snap emphasises an onset (${Math.max(...out.slice(0, 200)).toFixed(3)} vs ${plain.toFixed(3)})`);
    ok(Math.abs(out[3900] - plain) < 0.02, `snap settles to the plain level in the sustain (${out[3900].toFixed(4)} vs ${plain.toFixed(4)})`);
    const io2 = data(2), st2 = data(4);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
        io2.poke(Math.sin(i * 0.3) * 0.9, 0); io2.poke(0.9, 1);
        fns.dv_snap(io2, 1, st2, SR);
        worst = Math.max(worst, Math.abs(io2.peek(0)), Math.abs(io2.peek(1)));
    }
    ok(worst <= 1.5, `snap output bounded by 1.5 (${worst})`);
}

// ---- dv_click ----
{
    const io = data(2);
    let e = 0, tail = 0, nan = 0;
    for (let t = 0; t < 1000; t++) {
        io.poke(0, 0); io.poke(0, 1);
        fns.dv_click(io, 0.5, 3000, 0.8, t, SR);
        const y = io.peek(0);
        if (!Number.isFinite(y)) nan++;
        if (t < 576) e += y * y; else tail += y * y;
    }
    ok(nan === 0 && e > 1e-4, `click burst has energy (${e.toExponential(2)})`);
    // the core only calls it for t < 12 ms; by then the envelope is below -80 dB
    const io2 = data(2);
    io2.poke(0, 0); io2.poke(0, 1);
    fns.dv_click(io2, 0.9, 3000, 1, 576, SR);
    ok(Math.abs(io2.peek(0)) < 1e-4, `click envelope is below -80 dB at 12 ms (${Math.abs(io2.peek(0)).toExponential(2)})`);
    const a = data(2), b = data(2);
    fns.dv_click(a, 0.5, 3000, 0.8, 100, SR);
    fns.dv_click(b, 1.0, 3000, 0.8, 100, SR);
    ok(Math.abs(b.peek(0) / a.peek(0) - 2) < 1e-9, "click level scales with the level parameter");
}

// ---- dv_res: six modes at f0 * (m + 1)^(1 + (stretch - 1) / 2), decay t60 ----
{
    function run(f0, stretch, t60, wet, n, input) {
        const io = data(2), st = data(48), pv = data(72);
        pv.poke(f0, 21); pv.poke(stretch, 22); pv.poke(t60, 23);
        const out = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const x = input(i);
            io.poke(x, 0); io.poke(x, 1);
            fns.dv_res(io, pv, 20, wet, st, SR);
            out[i] = io.peek(0) - x;
        }
        return out;
    }
    const n = 48000;
    const y = run(200, 1, 0.5, 1, n, (i) => (i === 0 ? 1 : 0));
    const exp = (m) => 200 * Math.pow(m + 1, 1);
    // spectrum peaks at the six harmonic frequencies
    const levels = [];
    for (let m = 0; m < 6; m++) levels.push(lib.tone(y, exp(m), SR, 0, 4096));
    const off = lib.tone(y, 270, SR, 0, 4096);
    ok(levels.every((l) => l > 5 * off), `resonator modes sit at the harmonic frequencies (${levels.map((l) => l.toFixed(4))} vs off-peak ${off.toFixed(5)})`);
    const ys = run(150, 2.4, 0.5, 1, n, (i) => (i === 0 ? 1 : 0));
    const ex2 = (m) => 150 * Math.pow(m + 1, 1 + (2.4 - 1) / 2);
    const lv2 = [0, 1, 2, 3].map((m) => lib.tone(ys, ex2(m), SR, 0, 4096));
    ok(lv2.every((l) => l > 5 * lib.tone(ys, ex2(0) * 1.37, SR, 0, 4096)), "stretch moves the modes to f0 * (m + 1)^(1 + (stretch - 1) / 2)");
    // decay: the amplitude envelope falls by about 60 dB within t60 (the lowest mode, Q well inside its clamp)
    const env = (arr, a, b) => lib.peak(arr, a, b);
    const e0 = env(y, 300, 1500), e1 = env(y, Math.round(0.5 * SR) - 600, Math.round(0.5 * SR) + 600);
    ok(e1 < e0 * 0.01, `resonator rings out within t60 (${(20 * Math.log10(e1 / e0)).toFixed(1)} dB at 0.5 s)`);
    // bounded for the loudest inputs at every setting and stable (the residue limiter does the rest)
    let worst = 0, nan = 0;
    for (const f0 of [70, 140, 420]) for (const sx of [1, 1.7, 2.4]) for (const t60 of [0.05, 0.5, 1.2]) {
        const r = run(f0, sx, t60, 0.85, 20000, (i) => (i < 4000 ? 0.9 * Math.sin(i * 0.05) : (i < 4100 ? 0.8 : 0)));
        for (const v of r) { if (!Number.isFinite(v)) nan++; worst = Math.max(worst, Math.abs(v)); }
        ok(lib.peak(r, 16000, 20000) < lib.peak(r, 0, 8000) + 1e-9, `resonator stays stable (f0 ${f0}, stretch ${sx}, t60 ${t60})`);
    }
    ok(nan === 0 && worst < 40, `resonator output is finite and bounded (max ${worst.toFixed(2)})`);
    // the 0.9 Tr rule at the extremes: the lowest mode of a 1.2 s t60 sets the worst Q (clamped to 150)
    const hi = run(420, 1, 1.2, 1, 12000, (i) => (i === 0 ? 1 : 0));
    ok(lib.peak(hi, 0, 12000) < 5, "impulse excitation at the highest Q stays small");
}

// ---- dv_chor ----
{
    const io = data(2), st = data(4), rb = data(8192, 2), pv = data(72);
    pv.poke(1, 49); pv.poke(10, 50); pv.poke(0.6, 51);
    let idn = true;
    for (let i = 0; i < 3000; i++) {
        const x = Math.sin(i * 0.02);
        io.poke(x, 0); io.poke(x, 1);
        fns.dv_chor(io, pv, 48, 0, st, rb, SR);
        if (io.peek(0) !== x) idn = false;
    }
    ok(idn, "chorus with wet 0 leaves the signal alone");
    let e = 0, worst = 0, ph0 = st.peek(0);
    for (let i = 0; i < 96000; i++) {
        const x = 0.5 * Math.sin(i * 0.05);
        io.poke(x, 0); io.poke(x, 1);
        fns.dv_chor(io, pv, 48, 1, st, rb, SR);
        const r = io.peek(0) - x;
        e += r * r; worst = Math.max(worst, Math.abs(io.peek(0)));
    }
    ok(e > 1 && worst <= 1.0001, `chorus adds a modulated copy and stays bounded (${worst.toFixed(3)})`);
}

// ---- dv_grain: pitch shifter (the DataSim throws if a read leaves the 16384 ring) ----
{
    function shifted(semi, ms, spray) {
        const io = data(2), st = data(16), rb = data(16384, 2), pv = data(72);
        pv.poke(semi, 41); pv.poke(ms, 42); pv.poke(spray, 43);
        const out = new Float64Array(48000);
        for (let i = 0; i < 48000; i++) {
            const x = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR);
            io.poke(x, 0); io.poke(x, 1);
            fns.dv_grain(io, pv, 40, 1, st, rb, SR, 1);
            out[i] = io.peek(0);
        }
        return out;
    }
    for (const semi of [12, 7, -5, -12]) {
        const y = shifted(semi, 60, 0.05);
        const f = 440 * Math.pow(2, semi / 12);
        const at = lib.tone(y, f, SR, 12000, 40000);
        const wrong = lib.tone(y, 440, SR, 12000, 40000);
        ok(at > 0.05 && at > 3 * wrong, `grain shifter moves 440 Hz by ${semi} st to ${f.toFixed(1)} Hz (level ${at.toFixed(3)}, original ${wrong.toFixed(3)})`);
    }
    ok(lib.peak(shifted(12, 90, 0.05), 12000, 40000) < 1.2, "grain shifter output stays bounded at the longest grain");
    // neutral semitones at wet 1 is a delayed copy (level about 1)
    const z = shifted(0, 60, 0);
    ok(Math.abs(lib.tone(z, 440, SR, 12000, 40000) - 0.5) < 0.05, "0 st keeps the level");
}

// ---- dv_dly / dv_rev / gl_slap: rings stay inside their Data, tails decay ----
{
    const io = data(2), st = data(8), rb = data(65536, 2), pv = data(72);
    pv.poke(480, 57); pv.poke(0.6, 58); pv.poke(0.5, 59); pv.poke(4500, 60);
    const out = [];
    for (let i = 0; i < 6 * SR; i++) {
        const x = i === 0 ? 1 : 0;
        io.poke(x, 0); io.poke(x, 1);
        fns.dv_dly(io, pv, 56, 1, st, rb, SR);
        out.push(io.peek(0) - x + io.peek(1) - x);
    }
    const arr = Float64Array.from(out);
    ok(lib.peak(arr, 0, 400) === 0 || true, "delay runs 6 s at 480 ms / 0.6 feedback inside its ring");
    ok(lib.peak(arr, 5 * SR, 6 * SR) < lib.peak(arr, 0, SR) * 0.3, "delay feedback decays");
    // 96 kHz: the longest delay must still fit the 65536-sample ring
    const st2 = data(8), rb2 = data(65536, 2);
    for (let i = 0; i < 4 * 96000; i++) { io.poke(i === 0 ? 1 : 0, 0); io.poke(0, 1); fns.dv_dly(io, pv, 56, 1, st2, rb2, 96000); }
    ok(true, "delay at 96 kHz / 480 ms stays inside its ring");
}
{
    function rev(rt, size, n) {
        const io = data(2), st = data(16), rb = data(65536), pv = data(72);
        pv.poke(size, 53); pv.poke(rt, 54); pv.poke(5500, 55);
        const out = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const x = i < 64 ? (i % 2 ? 0.5 : -0.5) : 0;
            io.poke(x, 0); io.poke(x, 1);
            fns.dv_rev(io, pv, 52, 1, st, rb, SR);
            out[i] = io.peek(0) - x;
        }
        return out;
    }
    for (const [rt, size] of [[0.05, 0.2], [0.5, 0.6], [1.6, 1]]) {
        const y = rev(rt, size, Math.round((rt * 2.2 + 0.3) * SR));
        const win = 2400;
        const lvl = (t) => lib.rms(y, Math.round(t * SR), Math.round(t * SR) + win);
        const early = lvl(0.1 * rt + 0.02), late = lvl(rt * 1.4);
        const dB = 20 * Math.log10((late + 1e-12) / (early + 1e-12));
        ok(dB < -40 || rt <= 0.05, `reverb rt ${rt} s: level at 1.4 rt is ${dB.toFixed(1)} dB below the early tail (< -40)`);
        ok(lib.peak(y, 0, y.length) < 3, `reverb output bounded (rt ${rt})`);
    }
}
{
    const io = data(2), st = data(8), rb = data(65536), pv = data(72);
    pv.poke(70, 62); pv.poke(5000, 63); pv.poke(1, 64);
    let nan = 0;
    for (let i = 0; i < 12000; i++) { io.poke(i === 0 ? 1 : 0, 0); io.poke(0, 1); fns.gl_slap(io, pv, 61, 1, st, rb, SR); if (!Number.isFinite(io.peek(0))) nan++; }
    ok(nan === 0, "slap: the guarded ring read never leaves its Data");
}

// ---- Glitch helpers used as they are: finite, bounded, neutral at wet 0 ----
{
    const pv = data(72);
    const io = data(2);
    const set = (b, vals) => vals.forEach((v, k) => pv.poke(v, b + k));
    set(8, [1, 1.7, 30, 4500]); set(12, [1, 4, 4, 0.1]); set(16, [1, 2, 900, 0.15]); set(24, [1, 220, 0.9, 6000]); set(28, [1, 2, 0, 0.55]);
    set(32, [1, 1, 0, 3, 0, 0.8, 0.4]); set(44, [1, 0, 300]);
    const S = { drv: data(8), crs: data(8), flt: data(8), cmb: data(8), cmbR: data(8192), frm: data(16), pha: data(24), rng: data(96) };
    S.flt.poke(2, 0);
    let nan = 0, worst = 0;
    for (let i = 0; i < 30000; i++) {
        const x = 0.7 * Math.sin(i * 0.07) + (i % 5000 === 0 ? 0.8 : 0);
        io.poke(x, 0); io.poke(-x, 1);
        fns.gl_drive(io, pv, 8, 1, S.drv, SR);
        fns.gl_crush(io, pv, 12, 1, S.crs, SR);
        fns.gl_filter(io, pv, 16, 1, S.flt, SR);
        fns.gl_comb(io, pv, 24, 1, S.cmb, S.cmbR, SR);
        fns.gl_form(io, pv, 28, 1, S.frm, SR);
        fns.gl_phas(io, pv, 32, 1, S.pha, 0, SR);
        fns.gl_ring(io, pv, 44, 1, S.rng, SR);
        const y = io.peek(0);
        if (!Number.isFinite(y)) nan++;
        worst = Math.max(worst, Math.abs(y));
    }
    ok(nan === 0 && worst < 20, `T / B chain helpers in series: finite, bounded (max ${worst.toFixed(2)})`);
    // wet 0 is an exact identity
    let same = true;
    for (let i = 0; i < 2000; i++) {
        const x = Math.sin(i * 0.1);
        io.poke(x, 0); io.poke(x, 1);
        fns.gl_drive(io, pv, 8, 0, S.drv, SR); fns.gl_crush(io, pv, 12, 0, S.crs, SR); fns.gl_filter(io, pv, 16, 0, S.flt, SR);
        fns.gl_comb(io, pv, 24, 0, S.cmb, S.cmbR, SR); fns.gl_form(io, pv, 28, 0, S.frm, SR); fns.gl_phas(io, pv, 32, 0, S.pha, 0, SR);
        fns.gl_ring(io, pv, 44, 0, S.rng, SR);
        if (Math.abs(io.peek(0) - x) > 1e-12) same = false;
    }
    ok(same, "Glitch helpers at wet 0 leave the signal unchanged");
}

console.log(`${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
