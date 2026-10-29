"use strict";
// Analog engine of the Neural Amp: the circuit library (src/amp_analog_core.genexpr) run in Node through the twin
// (tests/amp_analog_sim.js), the tables and coefficients of src/amp_analog.js, and the GenExpr rules that silently kill
// a Max compile. The Max side (gen output = twin) is scripts/run_amp_audio_tests.py an_<circuit> (VM).
//   node tests/test_amp_analog.js
const fs = require("fs");
const path = require("path");
const S = require("./amp_analog_sim.js");
const A = require("../src/amp_config.js");
const G = require("./genexpr_functions");
const AA = S.AA;
global.ampFillHooks = A.ampFillHooks;

const ROOT = path.join(__dirname, "..");
const SR = 48000;
let passes = 0, fails = 0;
function check(ok, msg) { if (ok) passes++; else { fails++; console.log("FAIL " + msg); } }
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const strip = (s) => s.split("\n").map((l) => l.replace(/\/\/(?!@NAM_).*$/, "")).filter((l) => l.trim()).join("\n");

// 1. GenExpr lint (each of these silently compiled the whole gen to zeros in Max at some point, AGENTS.md)
{
    const src = read("src/amp_analog_core.genexpr");
    const code = strip(src);
    const fns = G.functionsOf(code);
    const names = new Set(fns.map((f) => f.name));
    check(!/&(?!&)/.test(code.replace(/&&/g, "")), "analog core: no bitwise &");
    check(!/\be\d+\b/.test(code), "analog core: no e<digit> identifiers");
    const banned = ["mix", "noise", "rise", "fall", "bias", "hold", "gate", "phi", "pi", "period", "ls", "eq", "gt", "lt", "neg", "not", "step", "delta", "change", "slide", "scale",
        "fold", "wrap", "mod", "sign", "sah", "train", "counter", "accum", "dim", "wave", "lookup", "sample", "cycle", "phasor", "triangle", "selector", "latch", "fract", "round", "trunc", "elapsed", "interp"];
    // globals of the template and of the analog declarations: a helper-local with one of these names breaks the compile
    const tmpl = strip(read("src/amp_core.genexpr"));
    const globals = new Set();
    for (const m of (tmpl + "\n" + AA.aaGenCode("", "").replace(/\\n/g, "\n")).matchAll(/^(?:Param|History|Data|Buffer|Delay)\s+(\w+)\(/gm)) globals.add(m[1]);
    for (const m of AA.aaGenCode(tmpl, "").matchAll(/^(?:Param|History|Data|Buffer|Delay)\s+(\w+)\(/gm)) globals.add(m[1]);
    const order = [];
    for (const f of fns) {
        const body = f.body.join("\n");
        const rets = body.match(/\breturn\b/g) || [];
        check(rets.length === 1 && /^\s*return [^;]+;\s*$/.test(f.body[f.body.length - 1]), `${f.name}: one return, at the end`);
        const stmts = f.body.filter((l) => /;\s*$/.test(l)).length;
        check(stmts <= 70, `${f.name}: ${stmts} statements (big functions failed to compile)`);
        const assigned = new Set([...body.matchAll(/(?:^|[;{(\s])([A-Za-z_]\w*)\s*=(?!=)/g)].map((m) => m[1]));
        for (const p of f.params.concat([...assigned])) {
            check(!banned.includes(p), `${f.name}: name ${p} shadows a GenExpr operator`);
            check(!globals.has(p), `${f.name}: name ${p} is also a global of the gen (silently breaks the compile)`);
        }
        // user-function calls: no peek() argument, not inside poke() / an if condition, defined before
        for (const m of body.matchAll(/\b(ac_\w+)\(([^;]*)\)/g)) {
            const callee = m[1], args = m[2];
            check(names.has(callee) && order.includes(callee), `${f.name}: ${callee} defined before use`);
            check(!/\bpeek\(/.test(args), `${f.name}: ${callee}(...) gets no peek() argument`);
        }
        check(!/poke\([^;]*\bac_\w+\(/.test(body), `${f.name}: no user call inside poke()`);
        check(!/\bif\s*\([^)]*\bac_\w+\(/.test(body), `${f.name}: no user call in an if condition`);
        // a work function whose result is unused must be a bare statement (an unused assignment is dead-code eliminated)
        for (const m of body.matchAll(/^\s*(\w+) = (ac_\w+)\(/gm)) check(new RegExp("\\b" + m[1] + "\\b").test(body.slice(body.indexOf(m[0]) + m[0].length)), `${f.name}: result of ${m[2]} is used`);
        order.push(f.name);
    }
    // every helper but the entry point has exactly one call site (gen inlines them: state / compile per site)
    const calls = {};
    for (const m of code.matchAll(/\b(ac_\w+)\(/g)) calls[m[1]] = (calls[m[1]] || 0) + 1;
    for (const f of fns) if (f.name !== "ac_sample") check((calls[f.name] || 0) - 1 >= 1, `${f.name}: called`);
    // assembled gen code: functions first, every hook filled
    const gen = AA.aaGenCode(tmpl, code);
    check(/^ac_hm\(/.test(gen) && !/@@|\/\/@NAM_/.test(gen) && /ac_sample\(nib, nob, nch, ninit, wd, cfd, anSt/.test(gen), "assembled analog gen code is clean");
    check(/^q0 = 4;$/m.test(gen) && /anDl\.read\(23\)/.test(gen), "analog gen: post biquads from 4, dry path delayed 23 samples");
}

// 1b. softplus / log softplus table (filled by ac_sample) against libm
{
    const f = S.fns(), sim = S.create(1), ft = sim.ft, rq = new S.FastData(32);
    let es = 0, eh = 0;
    for (let u = -29.98; u < 29.98; u += 0.0113) {
        const sp = Math.max(u, 0) + Math.log1p(Math.exp(-Math.abs(u)));
        es = Math.max(es, Math.abs(f.ac_hm(ft, rq, 12, u, 2) - sp) / Math.max(sp, 1e-12));
        eh = Math.max(eh, Math.abs(f.ac_hm(ft, rq, 12, u, 0) - Math.log(sp)));
    }
    check(es < 1e-6 && eh < 1e-6, `softplus / log softplus tables: ${es.toExponential(1)} / ${eh.toExponential(1)}`);
}

// 2. halfband 2x up / down: exactly 23 samples, flat
{
    const f = S.fns(), D = S.FastData, tb = new D(AA.AA_NW), rq = new D(32);
    AA.aaHalfband().forEach((v, i) => tb.poke(v, AA.AA_HB + i));
    for (const fr of [100, 3000, 15000, 19000]) {
        const hq = new D(384), y = [];
        for (let n = 0; n < 600; n++) { rq.poke(Math.sin(2 * Math.PI * fr * n / SR), 0); f.ac_up(rq, hq, 0, tb); const e = rq.peek(0), o = rq.peek(1); rq.poke(e, 2); rq.poke(o, 0); f.ac_dn(rq, hq, 0, tb); y.push(rq.peek(0)); }
        let err = 0;
        for (let n = 100; n < 600; n++) err = Math.max(err, Math.abs(y[n] - Math.sin(2 * Math.PI * fr * (n - 23) / SR)));
        check(err < 5e-4, `halfband ${fr} Hz: 23-sample delay, error ${err.toExponential(1)}`);
    }
}

// 3. single stages: textbook triode gains, DC operating point = the gen's settled state
function lone(stage, vref) {
    return { id: "t", vref: vref || 1, outDb: 0, toneRole: { bass: 0, mid: 0, treble: 0, presence: "none" }, stack: null, spk: null, cab: null,
        chain: [null, stage, null, null, null, null, null, null, null, null, null, null] };
}
function aaT(t, o) { return Object.assign({ k: "triode", tube: t, B: 270, Rp: 100, Rk: 1.5, Ck: 25, Cc: 22, Rg: 1000, Rs: 10, out: "plate", scale: 1, rail: 0.8, vg0: 0 }, o); }
function gainOf(rec, amp) {
    const m = S.create(0, { recipe: rec });
    let mx = -1e9, mn = 1e9;
    for (let n = 0; n < 24000; n++) { const y = m.raw(amp * Math.sin(2 * Math.PI * 1000 * n / SR))[0]; if (n > 12000) { mx = Math.max(mx, y); mn = Math.min(mn, y); } }
    return { g: (mx - mn) / 2 / amp, m };
}
for (const [nm, st, lo, hi] of [["12AX7 bypassed", aaT("12AX7", {}), 55, 66], ["12AX7 unbypassed", aaT("12AX7", { Ck: 0 }), 27, 35], ["12AT7", aaT("12AT7", {}), 37, 46]]) {
    const r = lone(st), { g, m } = gainOf(r, 0.01);
    check(g > lo && g < hi, `${nm}: gain ${g.toFixed(1)} (${lo}..${hi})`);
    const op = AA.aaTriodeOP(AA.AA_TRIODES[st.tube], st.B, st.Rp, st.Rk, 0);
    check(Math.abs(m.state(26) - op.ip) / op.ip < 0.02 && Math.abs(m.state(25) - op.vk) / op.vk < 0.02, `${nm}: operating point Ip ${op.ip.toFixed(3)} mA, Vk ${op.vk.toFixed(2)} V = the settled gen state`);
}

// 4. tone stacks: the polynomial nodal analysis and the digital sections against an independent complex nodal solve
function nodalDb(E, f) {
    const w = 2 * Math.PI * f, nodes = [];
    E.forEach((e) => [e[1], e[2]].forEach((n) => { if (n !== "in" && n !== "g" && !nodes.includes(n)) nodes.push(n); }));
    const N = nodes.length, M = [], bb = [];
    for (let i = 0; i < N; i++) { M.push(new Array(2 * N).fill(0)); bb.push([0, 0]); }
    const add = (i, j, y) => { M[i][2 * j] += y[0]; M[i][2 * j + 1] += y[1]; };
    E.forEach((e) => {
        const y = e[0] === "R" ? [1 / e[3], 0] : [0, w * e[3]];
        const ia = nodes.indexOf(e[1]), ib = nodes.indexOf(e[2]);
        if (ia >= 0) add(ia, ia, y); if (ib >= 0) add(ib, ib, y);
        if (ia >= 0 && ib >= 0) { add(ia, ib, [-y[0], -y[1]]); add(ib, ia, [-y[0], -y[1]]); }
        if (e[1] === "in" && ib >= 0) { bb[ib][0] += y[0]; bb[ib][1] += y[1]; }
        if (e[2] === "in" && ia >= 0) { bb[ia][0] += y[0]; bb[ia][1] += y[1]; }
    });
    // complex Gauss elimination
    const R = M.map((row, i) => row.concat(bb[i]));
    const cm = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]], cdv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
    const get = (r, j) => [R[r][2 * j], R[r][2 * j + 1]], set = (r, j, v) => { R[r][2 * j] = v[0]; R[r][2 * j + 1] = v[1]; };
    for (let c = 0; c < N; c++) {
        let p = c; for (let r = c + 1; r < N; r++) if (Math.hypot(...get(r, c)) > Math.hypot(...get(p, c))) p = r;
        [R[c], R[p]] = [R[p], R[c]];
        for (let r = 0; r < N; r++) {
            if (r === c) continue;
            const fct = cdv(get(r, c), get(c, c));
            for (let j = c; j <= N; j++) { const v = cm(fct, get(c, j)); set(r, j, [get(r, j)[0] - v[0], get(r, j)[1] - v[1]]); }
        }
    }
    const o = nodes.indexOf("out"), v = cdv(get(o, N), get(o, o));
    return 20 * Math.log10(Math.hypot(v[0], v[1]));
}
for (const st of Object.keys(AA.AA_STACKS)) {
    let worstA = 0, worstD = 0;
    for (const [b, m, t] of [[5, 5, 5], [0, 10, 0], [10, 0, 10], [10, 10, 10], [2, 7, 8]]) {
        const E = AA.aaStackNet(AA.AA_STACKS[st], b / 10, m / 10, t / 10);
        const c = AA.aaToneCoefs(st, b, m, t, SR);
        for (const f of [40, 100, 300, 1000, 3000, 8000]) {
            const ref = nodalDb(E, f);
            worstA = Math.max(worstA, Math.abs(AA.aaStackDb(st, b, m, t, f) - ref));
            worstD = Math.max(worstD, Math.abs(AA.aaToneDb(c, f, 2 * SR) - ref));
        }
    }
    check(worstA < 0.01 && worstD < 0.3, `tone stack ${st}: polynomial ${worstA.toExponential(1)} dB, digital ${worstD.toFixed(3)} dB from the nodal solve`);
}
{
    const lo = (b) => AA.aaToneDb(AA.aaToneCoefs("marshall", b, 5, 5, SR), 80, 2 * SR), hi = (t) => AA.aaToneDb(AA.aaToneCoefs("marshall", 5, 5, t, SR), 5000, 2 * SR);
    check(lo(10) - lo(0) > 10 && hi(10) - hi(0) > 6, `Marshall stack: Bass moves 80 Hz by ${(lo(10) - lo(0)).toFixed(1)} dB, Treble moves 5 kHz by ${(hi(10) - hi(0)).toFixed(1)} dB`);
}

// 5. every circuit: table layout, no NaN under abuse, bounded, quiet when idle, knobs reach the tone stack
for (let idx = 0; idx < AA.AMP_ANALOG.length; idx++) {
    const r = AA.AMP_ANALOG[idx];
    const t = AA.aaBank(idx, SR, 1);
    check(t.length === AA.AA_NW && t[0] === 1 && t.every(Number.isFinite), `${r.id}: table of ${AA.AA_NW} finite floats`);
    const m = S.create(idx, { gainDb: 24 });
    let idle = 0;
    for (let i = 0; i < 9600; i++) { const y = m.raw(0)[0]; if (i > 4800) idle += y * y; }
    let pk = 0, nan = 0, s = 12345;
    for (let i = 0; i < 24000; i++) { s = (s * 1664525 + 1013904223) >>> 0; const y = m.raw((s / 4294967296 - 0.5) * 2)[0]; if (!Number.isFinite(y)) nan++; else pk = Math.max(pk, Math.abs(y)); }
    check(nan === 0 && pk < 100, `${r.id}: full-scale noise at Gain +24 stays finite and bounded, no blow-up (peak ${pk.toFixed(2)}; a clean amp calibrated to -18 dB clean is that much louder at full drive)`);
    check(10 * Math.log10(idle / 4800 + 1e-30) < -55, `${r.id}: idle ${(10 * Math.log10(idle / 4800 + 1e-30)).toFixed(1)} dBFS`);
}

// 6. NFB margin: 3x the designed feedback stays stable (a one-sample-delayed loop with a 1-pole filter oscillated)
for (const id of ["twin", "hiwatt", "plexi"]) {
    const idx = AA.AMP_ANALOG.findIndex((r) => r.id === id), k = AA.aaRecipe(idx).chain.findIndex((s) => s && s.k === "pwr");
    const m = S.create(idx, { settle: false });
    m.tb.poke(m.tb.peek(64 + k * 32 + 24) * 3, 64 + k * 32 + 24);
    let r = 0;
    for (let i = 0; i < 48000; i++) { const y = m.raw(0)[0]; if (i > 24000) r += y * y; }
    check(10 * Math.log10(r / 24000 + 1e-30) < -50, `${id}: idle with 3x NFB ${(10 * Math.log10(r / 24000 + 1e-30)).toFixed(1)} dBFS (stable)`);
}

// 7. Sag: the tube circuits' own supply sees the current above idle up to 4x (ac_rail, state slot AA_SAG_SLOT),
// the others get the template's envelope sag (aaInfo().hasRail -> gen sagphys)
{
    const rail = AA.AMP_ANALOG.filter((r, i) => AA.aaInfo(i).hasRail).map((r) => r.id);
    check(rail.join() === "tweed,twin,ac30,plexi,jcm,modern,svt,hiwatt,ts,rat,fuzz,muff", `Sag: physical rail for the tube amps and the pedals into them (${rail.join(" ")})`);
    const src = read("src/amp_analog_core.genexpr");
    const used = [...strip(src).matchAll(/so \+ (\d+)/g)].map((m) => Number(m[1]));
    check(used.filter((v) => v === AA.AA_SAG_SLOT).length === 1 && used.every((v) => v < AA.AA_STATE) && AA.AA_SAG_SLOT >= 344 && AA.AA_SAG_SLOT < AA.AA_STATE,
        `Sag slot ${AA.AA_SAG_SLOT}: read once (ac_rail), inside the channel state, no other state there`);
    const tbl = AA.aaBank(3, SR, 1);
    check(tbl[1536 + AA.AA_SAG_SLOT] === 0, "Sag slot: the table's DC init leaves it 0");
    const gen = AA.aaGenCode(strip(read("src/amp_core.genexpr")), strip(src));
    check(gen.includes(`poke(anSt, sgA, ${AA.AA_SAG_SLOT});`) && gen.includes(`poke(anSt, sgA, ${AA.AA_STATE + AA.AA_SAG_SLOT});`)
        && gen.indexOf(`poke(anSt, sgA, ${AA.AA_SAG_SLOT});`) < gen.indexOf("ac_sample(nib, nob"), "gen body: the smoothed Sag goes into both channels' slot before the chain runs");
    const eng = read("src/amp_engine.js");
    check(/ampGenA\("sagphys", amp\.analog\.info && amp\.analog\.info\.hasRail \? 1 : 0\)/.test(eng), "engine: sagphys follows the circuit's rail");
    // Sag 0 is the circuit as designed (exact), idle B+ stays, the drop under load deepens
    const burst = (idx, sag) => {
        const m = S.create(idx, { sag }), n = Math.round(0.8 * SR), b0 = Math.round(0.2 * SR), y = new Float64Array(n);
        let idle = 0, mn = 1e9;
        for (let i = 0; i < n; i++) {
            y[i] = m.raw(i >= b0 ? 0.5 * Math.sin(2 * Math.PI * 110 * i / SR) : 0)[0];
            if (i < b0 && i >= b0 - 4800) idle += m.state(320) / 4800;
            if (i >= b0) mn = Math.min(mn, m.state(320));
        }
        return { y, idle, mn };
    };
    for (const id of ["tweed", "plexi", "svt"]) {
        const idx = AA.AMP_ANALOG.findIndex((r) => r.id === id);
        const plain = S.create(idx).run(new Float64Array(4800).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 110 * i / SR)), false);
        const s0 = S.create(idx, { sag: 0 }).run(new Float64Array(4800).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 110 * i / SR)), false);
        check(plain.every((v, i) => v === s0[i]), `${id}: Sag 0 = the circuit as designed (bit-exact)`);
        const a = burst(idx, 0), b = burst(idx, 1);
        check(Math.abs(b.idle - a.idle) < 0.02 * a.idle, `${id}: idle B+ ${a.idle.toFixed(0)} V -> ${b.idle.toFixed(0)} V at Sag 100 % (within 2 %)`);
        check(a.idle - b.mn > 1.4 * (a.idle - a.mn), `${id}: B+ drop under load ${(a.idle - a.mn).toFixed(0)} V -> ${(a.idle - b.mn).toFixed(0)} V at Sag 100 %`);
        check(b.y.every(isFinite), `${id}: Sag 100 % stays finite`);
    }
}

console.log(`test_amp_analog: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
