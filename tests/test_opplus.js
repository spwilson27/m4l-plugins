"use strict";
// Operator+ host tests (no Max): parameter table and display strings against the real Operator's LOM dump, layout and
// device structure, algorithms, the voice allocator, and the gen core's functions run in Node (tests/genexpr_functions.js)
// as a one-voice synth, checked against measurements of Live's Operator (pitch, level, FM index, feedback).
//   node tests/test_opplus.js
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const G = require("./genexpr_functions.js");

const ROOT = path.join(__dirname, "..");
globalThis.OP_PARAMS = require("../scripts/opplus_params.json");
const C = require("../src/opplus_config.js");

let failed = 0, passed = 0;
function ok(cond, msg) {
    if (cond) passed++;
    else { failed++; console.log("FAIL " + msg); }
}
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`); }

// ---------- 1. parameters and display strings ----------
const ref = require("../scripts/opplus_ref_params.json");
const curves = require("../scripts/opplus_ref_curves.json");
const byName = {};
for (const p of C.OP_P) byName[p.name] = p;
for (const r of ref) {
    if (r.name === "Device On") continue;
    const p = byName[r.name];
    ok(!!p, "parameter " + r.name + " exists");
    if (!p) continue;
    ok(p.min === r.min && p.max === r.max, `${r.name} range`);
    ok(p.enum === !!r.q, `${r.name} quantised`);
    if (r.q) ok(JSON.stringify(p.items) === JSON.stringify(r.items), `${r.name} items`);
    ok(p.init === r.value, `${r.name} default`);
}
// order: Operator's parameters first, in Operator's order
const firstNames = C.OP_P.slice(0, ref.length - 1).map((p) => p.name);
ok(JSON.stringify(firstNames) === JSON.stringify(ref.slice(1).map((r) => r.name)), "Operator parameter order kept");
let bad = 0;
for (const p of C.OP_P) {
    if (p.enum || p.extra) continue;
    for (let i = 0; i < 65; i++) {
        const v = p.min + (p.max - p.min) * i / 64;
        if (C.opFormat(p, v).replace("∞", "inf") !== curves[p.name][i]) { bad++; if (bad < 6) console.log("  mismatch", p.name, i, C.opFormat(p, v), curves[p.name][i]); }
    }
}
ok(bad === 0, `display strings equal Operator's at 65 points of every parameter (${bad} mismatches)`);
for (const p of C.OP_P) ok(typeof p.info === "string" && p.info.length >= 12, `${p.key} has an Info View sentence`);
const keys = C.OP_P.map((p) => p.key);
ok(new Set(keys).size === keys.length, "unique keys");
ok(new Set(C.OP_P.map((p) => p.name.trim())).size === C.OP_P.length, "unique names");

// engineering curves (from the dump)
near(C.opAttackMs(0.5), 44.7, 0.1, "attack curve at 0.5");
near(C.opDecayMs(0.5), 245, 1, "decay curve at 0.5");
near(C.opFixHz(0.5), 141.4, 0.2, "fixed frequency curve");
near(C.opFilterHz(0.5), 745, 1, "filter frequency curve");
near(C.opAmp("osc_a_level", 1), 1, 1e-9, "level 0 dB = amplitude 1");
near(C.opAmp("osc_a_level", 0.5), 0.1, 1e-3, "level 0.5 = -20 dB");
ok(C.opAmp("osc_a_level", 0) === 0, "level 0 = -inf");
near(C.opAmp("volume", 0.4), Math.pow(10, -18 / 20), 0.002, "Volume default = -18 dB");

// ---------- 2. algorithms ----------
ok(C.OP_ALGOS.length === 11, "11 algorithms");
for (let a = 0; a < 11; a++) {
    const A = C.OP_ALGOS[a];
    ok(A.e.every(([f, t]) => f > t), `algorithm ${a + 1}: every edge goes from a higher to a lower operator`);
    ok(A.c.length >= 1 && A.c.every((k) => !A.e.some(([f]) => f === k)), `algorithm ${a + 1}: carriers modulate nothing`);
    const covered = new Set(A.c);
    for (const [f] of A.e) covered.add(f);
    ok(covered.size === 4, `algorithm ${a + 1}: every operator is a carrier or a modulator`);
}
ok(C.OP_ALGOS[10].c.length === 4 && C.OP_ALGOS[10].e.length === 0, "algorithm 11 = four carriers");

// ---------- 3. cfg ----------
const def = C.opCfg({});
ok(def.length === C.OP_CFG_SIZE, "cfg size");
near(def[C.OP_CFG.OSC + 1], 1, 1e-9, "A ratio 1");
near(C.opCfg({ a_coarse: 2, a_fine: 500 })[C.OP_CFG.OSC + 1], 3, 1e-9, "coarse 2 fine 500 = ratio 3 (measured 660 Hz on A3)");
near(C.opCfg({ a_coarse: 0, a_fine: 500 })[C.OP_CFG.OSC + 1], 0.75, 1e-9, "coarse 0.5 fine 500 = 0.75 (measured 165 Hz)");
ok(def[C.OP_CFG.OSC + 15] === 1 && def[C.OP_CFG.OSC + 32 + 15] === 0, "algorithm 1: A is the only carrier");
ok(def[C.OP_CFG.ALG + 1 * 4 + 0] === 1 && def[C.OP_CFG.ALG + 3 * 4 + 2] === 1, "algorithm 1 matrix B->A, D->C");
near(def[C.OP_CFG.ENV + 1], 1.0, 0.01, "A decay default 1.00 s");
near(def[C.OP_CFG.ENV + 2], 0.4, 0.005, "A release default 400 ms");

// ---------- 4. allocator ----------
{
    const a = C.opCreateAllocator();
    const v1 = a.noteOn(60, 100, 2, false, false)[0], v2 = a.noteOn(64, 100, 2, false, false)[0];
    ok(v1 !== v2, "two notes on two voices");
    const v3 = a.noteOn(67, 100, 2, false, false)[0];
    ok(v3 === v1, "third note steals the oldest voice when 2 voices are allowed");
    ok(a.noteOff(64, 2).length === 1, "note off releases its voice");
    const m = C.opCreateAllocator();
    m.noteOn(60, 100, 1, true, false);
    const t0 = m.voices[0].trig;
    m.noteOn(64, 90, 1, true, false);
    ok(m.voices[0].trig === t0 && m.voices[0].legato === 1 && m.voices[0].note === 64 && m.voices[0].from === 60, "mono legato: no retrigger, glides from the old note");
    m.noteOff(64, 1);
    ok(m.voices[0].note === 60 && m.voices[0].gate === 1, "mono: releasing the top note returns to the held one");
    m.noteOff(60, 1);
    ok(m.voices[0].gate === 0, "mono: last note off closes the gate");
    const r = C.opCreateAllocator();
    r.noteOn(60, 100, 1, false, true);
    const t1 = r.voices[0].trig;
    r.noteOn(62, 100, 1, false, true);
    ok(r.voices[0].trig === t1 + 1, "mono with Retrigger: a new note retriggers");
}

// ---------- 5. gen core in Node ----------
const coreSrc = fs.readFileSync(path.join(ROOT, "src", "opplus_core.genexpr"), "utf8");
const fns = G.functionsOf(coreSrc);
for (const f of fns) {
    const rets = f.body.filter((l) => /^\s*return\b/.test(l));
    ok(rets.length === 1 && /^\treturn\b/.test(rets[0]), `gen ${f.name}: one return, at function level`);
    ok(f.body.length <= 80, `gen ${f.name}: short enough for Max 9 (${f.body.length} lines)`);
}
ok(!/\be\d\b/.test(coreSrc.replace(/\/\/.*$/gm, "")), "no e<digit> identifiers");
ok(!/\b(gate|phi|mix)\s*=/.test(coreSrc.replace(/\/\/.*$/gm, "")), "no gate / phi / mix variables");
const core = G.load(coreSrc.replace("\treturn l, r;", "\treturn [l, r];"));

/** A one-voice Operator+ in Node: the same calls as the gen's main loop. vals = parameter overrides. */
function render(vals, opts) {
    opts = Object.assign({ note: 57, vel: 100, secs: 0.4, off: 1e9, sr: 48000 }, opts);
    const sr = opts.sr;
    const cfgArr = C.opCfg(vals, { bpm: 120 });
    const cf = new G.DataSim(448);
    cfgArr.forEach((v, i) => cf.poke(v, i));
    const vs = new G.DataSim(6144);
    const wt = new G.DataSim(C.OP_NTAB * 8 * 2049);
    const needed = new Set([0, 9, 19]);
    for (const k of ["a", "b", "c", "d"]) needed.add(Math.round(vals["osc_" + k + "_wave"] || 0));
    for (const w of needed) {
        if (w >= 21) continue;
        for (let m = 0; m < 8; m++) {
            const t = C.opWaveTable(w, m, sr, null, 1);
            for (let i = 0; i < t.length; i++) wt.poke(t[i], (w * 8 + m) * 2049 + i);
        }
    }
    core.op_on(vs, cf, 0, opts.note, opts.vel, 0.5, -1);
    const out = [];
    const n = Math.round(opts.secs * sr);
    for (let i = 0; i < n; i++) {
        const gt = i < opts.off * sr ? 1 : 0;
        if (i % 16 === 0) core.op_ctl(vs, cf, 0, gt, 16 / sr, 0, -1, sr, 1);
        const lr = core.op_voice(vs, cf, wt, 0, 0, 0, 1, 1);
        out.push(lr[0] / Math.SQRT1_2 * cfgArr[3]);   // centre pan -> mono, then Volume
    }
    return out;
}
function goertzel(x, f, sr) {
    const n = x.length, k = 2 * Math.cos(2 * Math.PI * f / sr);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
        const s0 = x[i] * w + k * s1 - s2;
        s2 = s1; s1 = s0;
    }
    return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / (n * 0.5);
}
function zcFreq(x, sr) {
    const z = [];
    for (let i = 0; i < x.length - 1; i++) if (x[i] <= 0 && x[i + 1] > 0) z.push(i + x[i] / (x[i] - x[i + 1]));
    return (z.length - 1) * sr / (z[z.length - 1] - z[0]);
}
const solo = { osc_b_level: 0, osc_c_level: 0, osc_d_level: 0, osc_a_lev_lt_vel: 0, filter_on: 0, algorithm: 10 };
{
    const x = render(solo);
    const seg = x.slice(4800, 4800 + 9600);
    near(zcFreq(seg, 48000), 220, 0.05, "A3 sine at 220 Hz");
    const pk = Math.max(...seg.map(Math.abs));
    near(pk, 0.1259, 0.003, "level: 0 dB oscillator at Volume -18 dB peaks at 0.126 (Operator in Live: 0.1259)");
    const x2 = render(Object.assign({}, solo, { a_coarse: 2, a_fine: 500 }));
    near(zcFreq(x2.slice(4800, 14400), 48000), 660, 0.1, "coarse 2 fine 500 -> 660 Hz (Operator: 660.0)");
}
{
    // FM: B at -20 dB modulating A (algorithm 1). Operator in Live: h1..h4 = 0.47 0.55 0.17 0.04 of the 0.1259 peak
    const vals = Object.assign({}, solo, { algorithm: 0, osc_b_level: 0.5, osc_b_lev_lt_vel: 0, be_sustain: 1, be_decay: 0.6 });
    const x = render(vals).slice(6000, 6000 + 9600);
    const h = [1, 2, 3, 4].map((k) => goertzel(x, 220 * k, 48000) / 0.1259);
    const want = [0.47, 0.55, 0.17, 0.04];
    for (let i = 0; i < 4; i++) near(h[i], want[i], 0.04, `FM B -20 dB -> A: harmonic ${i + 1}`);
    const vals2 = Object.assign({}, vals, { osc_b_level: 0.75 });
    const x2 = render(vals2).slice(6000, 6000 + 9600);
    const h2 = [1, 2, 3, 4].map((k) => goertzel(x2, 220 * k, 48000) / 0.1259);
    const want2 = [0.77, 0.37, 0.09, 0.56];
    for (let i = 0; i < 4; i++) near(h2[i], want2[i], 0.05, `FM B -10 dB -> A: harmonic ${i + 1}`);
}
{
    // feedback 50 %: Operator in Live h1..h4 = 0.61 0.29 0.19 0.14
    const x = render(Object.assign({}, solo, { osc_a_feedb: 50 })).slice(6000, 6000 + 9600);
    const h = [1, 2, 3, 4].map((k) => goertzel(x, 220 * k, 48000) / 0.1259);
    const want = [0.61, 0.29, 0.19, 0.14];
    for (let i = 0; i < 4; i++) near(h[i], want[i], 0.04, `feedback 50 %: harmonic ${i + 1}`);
}
{
    // envelope: attack 10 ms (x for 10 ms), decay 245 ms to -20 dB sustain, release 245 ms
    const xa = Math.log(10 / 0.1) / Math.log(200000), xd = 0.5;
    const vals = Object.assign({}, solo, { ae_attack: xa, ae_decay: xd, ae_sustain: 0.5, ae_release: xd });
    const x = render(vals, { secs: 1.2, off: 0.6 });
    const env = [];
    for (let i = 0; i + 480 <= x.length; i += 480) env.push(Math.max(...x.slice(i, i + 480).map(Math.abs)) / 0.1259);
    ok(env[0] > 0.3 && env[0] < 1.01, "attack reaches the peak within ~10 ms (block 0 = " + env[0].toFixed(2) + ")");
    near(env[5], 0.1 + 0.9 * 0.2, 0.25, "decay on its way at 50 ms");
    near(env[40], 0.1, 0.01, "sustain -20 dB at 400 ms");
    ok(env[Math.round((0.6 + 0.26) * 100)] < 0.01, "release done ~250 ms after note off");
    ok(env[env.length - 1] === 0, "silent after release");
}
{
    // pitch envelope: +12 st peak (on by default in the cfg only when Pe On)
    const vals = Object.assign({}, solo, { pe_on: 1, pe_amount: 1, pe_init: 12, pe_peak: 12, pe_sustain: 12, pe_end: 12, osc_a_lt_pe: 1 });
    near(zcFreq(render(vals).slice(4800, 14400), 48000), 440, 0.2, "pitch envelope +12 st doubles the frequency");
}
{
    // filter: lowpass 24 dB at 745 Hz (default) attenuates a 220 Hz saw's 8th harmonic
    const vals = Object.assign({}, solo, { osc_a_wave: 9, filter_on: 1, filter_freq: 0.5, filter_res: 0 });
    const x = render(vals).slice(6000, 15600);
    const dry = render(Object.assign({}, vals, { filter_on: 0 })).slice(6000, 15600);
    const r1 = goertzel(x, 220, 48000) / goertzel(dry, 220, 48000), r8 = goertzel(x, 1760, 48000) / goertzel(dry, 1760, 48000);
    ok(r1 > 0.85 && r8 < 0.12, `lowpass 745 Hz: 220 Hz kept (${r1.toFixed(2)}), 1760 Hz cut (${r8.toFixed(3)})`);
}

// ---------- 6. layout and device ----------
const layout = JSON.parse(execFileSync("python3", ["-c", "import sys,json;sys.path.insert(0,'scripts');import opplus_layout as L;print(json.dumps({'items':L.items(),'ub':L.ubuttons()}))"], { cwd: ROOT }).toString());
const P = {};
for (const p of C.OP_P) P[p.key] = p;
for (const it of layout.items) if (it.key) ok(!!P[it.key], `layout key ${it.key}`);
const dev = path.join(ROOT, "devices", "Operator+.amxd");
const buf = fs.readFileSync(dev);
ok(buf.slice(8, 12).toString() === "iiii", "instrument device type");
const doc = JSON.parse(buf.slice(32).toString("utf8"));
const pt = doc.patcher;
ok(pt.devicewidth === 725 && pt.openrect[3] === 169, "725 x 169");
const boxes = pt.boxes.map((b) => b.box);
ok(!boxes.some((b) => /^gen/.test(b.maxclass || "") || /^gen~/.test(b.text || "")), "no gen~ in the file (deferred DSP)");
const byVar = {};
for (const b of boxes) if (b.varname) byVar[b.varname] = b;
for (const p of C.OP_P) ok(!!byVar["op_" + p.key], `live object for ${p.key}`);
for (const n of ["op_face", "op_graph", "op_genin", "op_phasor", "op_plugout"]) ok(!!byVar[n], n + " present");
ok(byVar.op_face.ignoreclick === 1, "face v8ui ignores clicks (it only draws)");
const texts = boxes.map((b) => b.text || "").join("\n");
ok(!/#0/.test(texts), "no #0 names in a top-level device");
for (const nm of ["---opcfg", "---opvoices", "---opwaves", "---opscope"]) ok(texts.includes("buffer~ " + nm), nm + " buffer");
const longNames = boxes.filter((b) => b.saved_attribute_attributes && b.saved_attribute_attributes.valueof && b.saved_attribute_attributes.valueof.parameter_longname).map((b) => b.saved_attribute_attributes.valueof.parameter_longname);
ok(new Set(longNames).size === longNames.length, "unique long names");

function rectOf(it) {
    if (it.t === "dial") return [it.x - 13.5, it.y - 14, 27, 28];
    if (it.t === "lcd") return [it.x - 1, it.y - 7.5, it.w, 15];
    return [it.x, it.y, it.w, it.h];
}
function overlap(a, b) { return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]; }
// every section: the visible transparent objects never overlap each other or the interactive graph strip, and stay inside the device
for (let s = 0; s < 8; s++) {
    const vis = layout.items.filter((it) => it.key && (it.g === "shell" || it.g === "s" + s));
    const graph = [215, 0, 294, s === 7 ? 23 : 61];
    for (const it of vis) {
        const r = rectOf(it);
        ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= 725.5 && r[1] + r[3] <= 169, `section ${s}: ${it.key} inside the device`);
        ok(!overlap(r, graph), `section ${s}: ${it.key} clear of the interactive graph`);
    }
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i], b = vis[j];
        if (a.cond && b.cond && a.cond !== b.cond && (a.cond.replace(/^no/, "") === b.cond.replace(/^no/, "") ||
            /^(times|slopes)/.test(a.cond) && /^(times|slopes)/.test(b.cond) || /^m(loop|beat)/.test(a.cond) && /^m(loop|beat)/.test(b.cond) ||
            /^lfo(no)?sync$/.test(a.cond) && /^lfo(no)?sync$/.test(b.cond) || /^(morph|drive)$/.test(a.cond) && /^(morph|drive)$/.test(b.cond) ||
            /^(no)?lphp$/.test(a.cond) && /^(no)?lphp$/.test(b.cond))) continue;   // mutually exclusive: never shown together
        ok(!overlap(rectOf(a), rectOf(b)), `section ${s}: ${a.key} / ${b.key} do not overlap`);
    }
}
// background-free: the face v8ui is the first box (drawn behind), the parameter objects come later in z-order
const idxFace = pt.boxes.findIndex((b) => b.box.id === "obj-face");
const idxFirstParam = pt.boxes.findIndex((b) => /^obj-p-/.test(b.box.id));
ok(idxFace < idxFirstParam, "parameter objects are in front of the face");

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
