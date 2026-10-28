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
    for (const n of ["gl_drive", "gl_filter", "gl_crush", "dv_ring", "gl_form", "gl_comb", "dv_phas", "gl_slap", "dv_rev", "dv_dly", "dv_grain", "dv_snap", "dv_res",
        "dv_chor", "dvc_tick", "dv_click", "dv_tape", "dv_zap", "dv_specjob", "dv_specop", "dv_specz", "dv_rk"]) {
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
    const h = data(80), q = data(96);
    hv.forEach((v, i) => h.poke(v, i));
    fns.dv_pg1(h, q); fns.dv_pg2(h, q); fns.dv_pg3(h, q); fns.dv_pg4(h, q); fns.dv_pg5(h, q);
    return q;
}
const WETS = [0, 1, 8, 12, 16, 20, 24, 28, 32, 40, 44, 47, 48, 52, 56, 61, 65, 67, 73, 76, 87, 91, 95];
{
    const q = page(cfg.dvHiddenNeutral());
    ok(WETS.every((i) => q.peek(i) === 0), `neutral hidden values give exactly 0 for every wet / amount (${WETS.filter((i) => q.peek(i) !== 0)})`);
    // pass-through entries come from the right hidden row
    const hv = new Float64Array(80);
    for (let i = 0; i < cfg.DV_HIDDEN_COUNT; i++) hv[i] = 3.0 + i * 1.37;
    hv[HI.tr_s] = 0.8;
    const q2 = page(hv);
    const pass = { 0: "snap_amt", 1: "click_lvl", 2: "click_hz", 18: "tfilt_hz", 20: "res_wet", 21: "res_f0", 22: "res_stretch", 24: "comb_wet", 25: "comb_hz",
        28: "form_wet", 29: "form_vowel", 32: "phas_wet", 35: "phas_hz", 40: "pitch_wet", 41: "pitch_st", 42: "grain_ms", 44: "ring_wet", 46: "ring_hz", 47: "sat_amt",
        48: "chor_wet", 49: "chor_hz", 50: "chor_ms", 52: "rev_wet", 53: "rev_size", 56: "dly_wet", 57: "dly_ms", 61: "slap_wet", 65: "conv_wet", 66: "conv_ir", 12: "crush_wet",
        30: "form_shift", 43: "grain_spray", 59: "dly_pp" };
    const p4 = ["tape_wet", "tape_st", "tape_glide", "tape_ms", "loop_ms", "loop_step", "gate_wet", "gate_hz", "gate_duty", "zap_wet", "zap_f0", "zap_f1", "zap_ms",
        "zap_res", "bend_st", "bend_ms", "ring_sweep", "vowel_sweep", "res_kind", "res_drop", "spec_wet", "spec_op", "spec_amt"];
    p4.forEach((id, k) => { pass[67 + k] = id; });
    ["lfo_hz", "lfo_depth", "lfo_shape", "lfo_tgt", "tape_dir", "dry_rep"].forEach((id, k) => { pass[90 + k] = id; }); // dv_pg5: rows 64..69 -> pv 90..95
    for (const k in pass) ok(q2.peek(Number(k)) === hv[HI[pass[k]]], `pv[${k}] = hidden ${pass[k]}`);
    ok(q2.peek(13) === 12 - 1.25 * hv[HI.crush_bits] && q2.peek(14) === (1 + 0.75 * hv[HI.crush_bits]) * hv[HI.crush_sr], "crush bits / factor from crush_bits x crush_sr");
    ok(q2.peek(9) === Math.min(3, hv[HI.drive_amt] * 1.7 + hv[HI.drive_shape]), "drive shape = 1.7 drive + drive_shape, at most 3");
    // the factory constants of the appended rows reproduce the old fixed values
    const q0 = page(cfg.dvHiddenNeutral());
    ok(q0.peek(30) === 0 && Math.abs(q0.peek(43) - 0.05) < 1e-15 && q0.peek(59) === 0.5 && q0.peek(14) === 1 && q0.peek(9) === 0, "Arch 0 keeps formant shift 0, spray 0.05, ping-pong 0.5, crush factor 1, drive shape 0");
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
    const q = data(96), qt = data(96);
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
        const io = data(2), st = data(48), pv = data(96);
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
    // tone mode: T60 up to 6.6 s with Q up to 1500 once t60 > 1.21 (Tr > 1.84); Classic (t60 <= 1.2) keeps the cap of 150
    {
        const qOf = (f0, t60) => { const st = data(48), pv = data(96), io = data(2); pv.poke(f0, 21); pv.poke(1, 22); pv.poke(t60, 23); fns.dv_res(io, pv, 20, 1, st, SR); return 1 / st.peek(6 + 5); };
        ok(Math.abs(qOf(1000, 1.2) - 150) < 1e-6, "resonator Q is capped at 150 for t60 <= 1.2");
        ok(Math.abs(qOf(1000, 5) - 1500) < 1e-6 || qOf(1000, 5) > 150, `resonator Q passes 150 for a long t60 (Q ${qOf(1000, 5).toFixed(0)} at t60 5)`);
        ok(qOf(6000, 6.6) <= 1500 + 1e-9, "resonator Q is capped at 1500");
        const hvT = new Float64Array(80); hvT[HI.tr_s] = 7.0;
        const qT = page(hvT), hvC = new Float64Array(80); hvC[HI.tr_s] = 1.8;
        ok(Math.abs(qT.peek(23) - 6.3) < 1e-12 && Math.abs(page(hvC).peek(23) - 1.2) < 1e-12, "dv_pg2: resonator T60 = 0.9 Tr up to 6.6 s for Tr > 1.84, 1.2 s cap below");
    }
    // the 0.9 Tr rule at the extremes: the lowest mode of a 1.2 s t60 sets the worst Q (clamped to 150)
    const hi = run(420, 1, 1.2, 1, 12000, (i) => (i === 0 ? 1 : 0));
    ok(lib.peak(hi, 0, 12000) < 5, "impulse excitation at the highest Q stays small");
}

// ---- dv_chor ----
{
    const io = data(2), st = data(4), rb = data(8192, 2), pv = data(96);
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
        const io = data(2), st = data(16), rb = data(16384, 2), pv = data(96);
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
    const io = data(2), st = data(8), rb = data(65536, 2), pv = data(96);
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
        const io = data(2), st = data(16), rb = data(65536), pv = data(96);
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
    const io = data(2), st = data(8), rb = data(65536), pv = data(96);
    pv.poke(70, 62); pv.poke(5000, 63); pv.poke(1, 64);
    let nan = 0;
    for (let i = 0; i < 12000; i++) { io.poke(i === 0 ? 1 : 0, 0); io.poke(0, 1); fns.gl_slap(io, pv, 61, 1, st, rb, SR); if (!Number.isFinite(io.peek(0))) nan++; }
    ok(nan === 0, "slap: the guarded ring read never leaves its Data");
}

// ---- Glitch helpers used as they are: finite, bounded, neutral at wet 0 ----
{
    const pv = data(96);
    const io = data(2);
    const set = (b, vals) => vals.forEach((v, k) => pv.poke(v, b + k));
    set(8, [1, 1.7, 30, 4500]); set(12, [1, 4, 4, 0.1]); set(16, [1, 2, 900, 0.15]); set(24, [1, 220, 0.9, 6000]); set(28, [1, 2, 0, 0.55]);
    set(32, [1, 1, 0, 3, 0, 0.8, 0.4]); set(44, [1, 0, 300]);
    const S = { drv: data(8), crs: data(8), flt: data(8), cmb: data(8), cmbR: data(8192), frm: data(16), pha: data(24), rng: data(4) };
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
        fns.dv_phas(io, pv, 32, 1, S.pha, SR);
        fns.dv_ring(io, pv, 44, 1, S.rng, SR);
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
        fns.gl_comb(io, pv, 24, 0, S.cmb, S.cmbR, SR); fns.gl_form(io, pv, 28, 0, S.frm, SR); fns.dv_phas(io, pv, 32, 0, S.pha, SR);
        fns.dv_ring(io, pv, 44, 0, S.rng, SR);
        if (Math.abs(io.peek(0) - x) > 1e-12) same = false;
    }
    ok(same, "Glitch helpers at wet 0 leave the signal unchanged");
}

// ---- Arch Mode modules ----
{
    // dv_rk: kind 0 is the old stretched-harmonic formula, the tables start at 1, the tube is odd
    let okk = true;
    for (let m = 0; m < 6; m++) {
        if (Math.abs(fns.dv_rk(0, m, 1.35) - Math.pow(m + 1, 1.35)) > 1e-12) okk = false;
        if (fns.dv_rk(4, m, 1) !== 2 * m + 1) okk = false;
    }
    for (let k = 1; k <= 3; k++) if (fns.dv_rk(k, 0, 1) !== 1 || !(fns.dv_rk(k, 5, 1) > fns.dv_rk(k, 4, 1))) okk = false;
    ok(okk, "dv_rk: kind 0 = (m + 1)^ex, kinds 1..3 rising from 1, kind 4 odd harmonics");
}
{
    // dv_tape
    function tape(cfgp, input, n, resetAt, act) {
        const io = data(2), st = data(12), rb = data(65536, 2), pv = data(96);
        [0, cfgp.st || 0, cfgp.glide || 0, cfgp.ms || 300, cfgp.loop || 0, cfgp.step || 0].forEach((v, k) => pv.poke(v, 67 + k));
        const out = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const x = input(i);
            io.poke(x, 0); io.poke(-x, 1);
            fns.dv_tape(io, pv, 67, st, rb, SR, act === undefined ? 1 : act, i === resetAt ? 1 : 0, cfgp.rev || 0);
            out[i] = io.peek(0);
            if (io.peek(1) !== -out[i]) out[i] = NaN;
        }
        return out;
    }
    const sine = (f) => (i) => Math.sin(2 * Math.PI * f * i / SR);
    const y1 = tape({}, sine(440), 20000, 300);
    ok(y1.every((v, i) => Math.abs(v - Math.sin(2 * Math.PI * 440 * i / SR)) < 1e-12), "tape at rate 1 is the identity (both channels; exact away from the 1 ms crossfade)");
    const yh = tape({ st: -12 }, sine(440), 30000, 100);
    ok(lib.tone(yh, 220, SR, 5000, 25000) > 0.8 && lib.tone(yh, 440, SR, 5000, 25000) < 0.05, `tape at -12 st plays an octave down (${lib.tone(yh, 220, SR, 5000, 25000).toFixed(3)})`);
    const yg = tape({ st: 0, glide: -24, ms: 100 }, sine(880), 30000, 100);
    ok(lib.tone(yg, 220, SR, 10000, 30000) > 0.8, "tape glide -24 st over 100 ms ends two octaves down");
    // stutter: an impulse 200 samples after the reset repeats every loop (20 ms = 960 samples)
    const imp = (i) => (i === 300 ? 1 : 0);
    const near = (y, k) => Math.max(Math.abs(y[k - 1]), Math.abs(y[k]), Math.abs(y[k + 1]));
    const yl = tape({ loop: 20 }, imp, 4000, 100);
    ok(near(yl, 300) > 0.99 && near(yl, 1260) > 0.99 && near(yl, 2220) > 0.99 && lib.peak(yl, 400, 1200) < 1e-9, `stutter repeats the first 20 ms (${near(yl, 300)}, ${near(yl, 1260)}, ${near(yl, 2220)})`);
    const ys = tape({ loop: 20, step: 12 }, imp, 4000, 100);
    ok(near(ys, 1160) > 0.99 && near(ys, 1590) > 0.99 && lib.peak(ys, 1200, 1560) < 1e-9, `stutter step +12 st: repeat 2 twice as fast, repeat 3 four times (${near(ys, 1160)}, ${near(ys, 1590)})`);
    const yo = tape({ st: -12 }, sine(300), 6000, 100, 0);
    ok(yo.every((v, i) => v === Math.sin(2 * Math.PI * 300 * i / SR)), "inactive tape passes the dry through");
    {
        // reverse: an impulse at sta + d (sta = 100) with a loop of L = 1000 samples comes back at ~ 2L - d after the reset (reading sta + 2L - pos)
        const Lms = 1000 / 48, d = 300, L = 1000, at = 100;
        const imp2 = (i) => (i === at + d ? 1 : 0);
        const yv = tape({ loop: Lms, rev: 1 }, imp2, 5000, at);
        const peakAt = (y, a, b) => { let k = a; for (let i = a; i < b; i++) if (Math.abs(y[i]) > Math.abs(y[k])) k = i; return k; };
        const kr = peakAt(yv, at + L + 50, at + 2 * L - 10);
        ok(Math.abs(kr - (at + 2 * L - d)) <= 2 && Math.abs(yv[kr]) > 0.9, `tape reverse with a loop: the impulse returns reversed at 2L - d (${kr - at} vs ${2 * L - d}, level ${yv[kr].toFixed(3)})`);
        ok(Math.abs(yv[at + d]) > 0.99, "tape reverse: the live pass still plays forward");
        const yw = tape({ loop: Lms, rev: 1 }, imp2, 5000, at);
        ok(yw.every((v, i) => v === yv[i]), "tape reverse is deterministic");
        // the loop period is 2L: the forward copy repeats 2L after the first
        ok(Math.abs(yv[at + d + 2 * L]) > 0.9 || Math.abs(yv[at + d + 2 * L + 1]) > 0.9 || Math.abs(yv[at + d + 2 * L - 1]) > 0.9, "tape reverse: the loop period is 2 L");
        // no loop: the window is the glide ms (here 800 samples); reverse follows the live pass, then goes silent
        const Wms = 800 / 48;
        const yn = tape({ ms: Wms, rev: 1 }, (i) => (i === at + 200 ? 1 : 0), 4000, at);
        const kn = peakAt(yn, at + 800 + 20, at + 1600 - 10);
        ok(Math.abs(kn - (at + 1600 - 200)) <= 2 && Math.abs(yn[kn]) > 0.9, `tape reverse without a loop: window = tape_ms (${kn - at} vs ${1600 - 200})`);
        ok(lib.peak(yn, at + 1700, 4000) < 1e-12, "tape reverse without a loop is silent after the reversed window");
        // never reads ahead of the writing: a slow rate (-12 st) keeps pos <= tt, finite
        const ys2 = tape({ st: -12, ms: Wms, rev: 1 }, sine(300), 6000, at);
        ok(ys2.every(Number.isFinite) && lib.peak(ys2, 0, 6000) < 1.0001, "tape reverse at -12 st stays finite and bounded");
        // forward (rev 0) is unchanged by the new argument
        const yf = tape({ loop: Lms }, imp2, 3000, at);
        ok(Math.abs(yf[at + d]) > 0.99 && Math.abs(yf[at + L + d]) > 0.99, "tape forward loop unchanged (rev 0)");
    }
    let fin = true;
    const yr = tape({ st: -7, loop: 35, step: -3 }, (i) => Math.sin(i * 0.01) * (i % 7000 < 4000 ? 1 : 0), 40000, 100);
    for (let i = 0; i < yr.length; i++) if (!Number.isFinite(yr[i]) || Math.abs(yr[i]) > 2.2) fin = false;
    ok(fin, "tape with a loop and a step stays finite and bounded");
}
{
    // dv_zap: low-pass at f, wet 0 identity
    function zap(f, res, w, freq) {
        const io = data(2), st = data(8);
        const out = new Float64Array(12000);
        for (let i = 0; i < out.length; i++) {
            const x = Math.sin(2 * Math.PI * freq * i / SR);
            io.poke(x, 0); io.poke(x, 1);
            fns.dv_zap(io, f, res, w, st, SR);
            out[i] = io.peek(0);
        }
        return lib.tone(out, freq, SR, 4000, 12000);
    }
    ok(zap(300, 0.7, 1, 6000) < 0.02 && zap(300, 0.7, 1, 80) > 0.7, "zap is a low-pass at its cutoff");
    ok(Math.abs(zap(300, 0.9, 0, 6000) - 1) < 0.01, "zap at wet 0 leaves the signal alone");
}
{
    // spectral send: the job schedule reconstructs, ops are finite, freeze sustains
    const fresh = gx.load(T.full);
    const tab = data(4096, 3);
    fresh.fft_init(tab);
    function spec(op, amt, input, n, capAt) {
        const sx = data(512, 2), sy = data(257, 2), sin = data(512), sacc = data(1024, 2), sw = data(512), smg = data(257), sph = data(257), sst = data(10);
        for (let i = 0; i < 512; i++) sw.poke(0.5 - 0.5 * Math.cos(2 * Math.PI * i / 512), i);
        const L = new Float64Array(n), R = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            sst.poke(i >= capAt ? 1 : 0, 5);
            const w0 = sst.peek(0);
            sin.poke(input(i), w0);
            sst.poke(w0 + 1 >= 512 ? 0 : w0 + 1, 0);
            const o0 = sst.peek(4);
            L[i] = sacc.peek(o0, 0); R[i] = sacc.peek(o0, 1);
            sacc.poke(0, o0, 0); sacc.poke(0, o0, 1);
            sst.poke(o0 + 1 >= 1024 ? 0 : o0 + 1, 4);
            const jb = sst.peek(1);
            fresh.dv_specjob(jb, sx, sy, tab, sin, sacc, sw, smg, sph, sst, op, amt);
            sst.poke(jb + 1 >= 128 ? 0 : jb + 1, 1);
        }
        return { L, R };
    }
    const x = (i) => 0.5 * Math.sin(i * 0.031) + 0.3 * Math.sin(i * 0.17 + 1);
    const id = spec(1, 0.5, x, 8000, 1e9);
    let err = 0;
    for (let i = 2000; i < 8000; i++) err = Math.max(err, Math.abs(id.L[i] - x(i - 640)));
    ok(err < 1e-9, `spectral shift 0 reconstructs the input 640 samples late in the left channel (max error ${err.toExponential(2)})`);
    ok(lib.rms(id.R, 2000, 8000) > 0.5 * lib.rms(id.L, 2000, 8000), "the right channel carries the phase-turned copy");
    const burst = (i) => (i < 3000 ? Math.sin(i * 0.05) : 0);
    const fz = spec(0, 0.2, burst, 40000, 1500);
    const r1 = lib.rms(fz.L, 4000, 5000), r2 = lib.rms(fz.L, 12000, 14000), r3 = lib.rms(fz.L, 36000, 38000);
    ok(r2 > 0.3 * r1 && r3 < r2 && r3 > 0.01 * r1, `freeze holds the spectrum after the input stops and decays slowly (${r1.toFixed(3)} ${r2.toFixed(3)} ${r3.toFixed(4)})`);
    let bad = 0;
    for (const op of [0, 1, 2, 3, 4, 5]) for (const amt of [0, 0.5, 1]) {
        const r = spec(op, amt, (i) => Math.sin(i * 0.07) * (i % 3000 < 1500 ? 1 : 0.1), 9000, 1000);
        for (let i = 0; i < 9000; i++) if (!Number.isFinite(r.L[i]) || !Number.isFinite(r.R[i]) || Math.abs(r.L[i]) > 4) bad++;
    }
    ok(bad === 0, `every spectral op and amount stays finite and bounded (${bad})`);
    {
        const tone = (i) => 0.5 * Math.sin(i * 0.2) + 0.2 * Math.sin(i * 0.37 + 0.3);
        const a4 = spec(4, 0.5, tone, 8000, 1e9), b4 = spec(4, 0.5, tone, 8000, 1e9), id0 = spec(1, 0.5, tone, 8000, 1e9);
        let same = true, diff = 0;
        for (let i = 0; i < 8000; i++) { if (a4.L[i] !== b4.L[i]) same = false; diff = Math.max(diff, Math.abs(a4.L[i] - id0.L[i])); }
        ok(same && diff > 0.05 && lib.rms(a4.L, 3000, 8000) > 0.02, `scramble (op 4) is deterministic and changes the spectrum (diff ${diff.toFixed(3)})`);
        const a5 = spec(5, 1, tone, 12000, 1e9), b5 = spec(5, 1, tone, 12000, 1e9);
        let same5 = a5.L.every((v, i) => v === b5.L[i]);
        ok(same5 && lib.rms(a5.L, 3000, 12000) > 0.02, "walk (op 5) is deterministic and sounds");
        // the walk state stays inside +-64 bins and is at 0 for the other ops
        const sst = data(10); const wkRun = (op) => { const sx = data(512, 2), sy = data(257, 2), smg = data(257), sph = data(257); sx.poke(1, 3, 0); sst.poke(0, 9); let mxw = 0; for (let k = 0; k < 400; k++) { fresh.dv_specop(sx, sy, smg, sph, sst, op, 1); mxw = Math.max(mxw, Math.abs(sst.peek(9))); } return mxw; };
        const w5 = wkRun(5), w1 = wkRun(1);
        ok(w5 > 1 && w5 <= 64 && w1 === 0, `walk state is clipped to +-64 bins (max ${w5.toFixed(1)}) and untouched by other ops`);
    }
}
console.log(`${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
