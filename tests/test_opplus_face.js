"use strict";
// Operator+ face in Node (no Max): the two v8ui scripts of the built device painted with a recording mgraphics mock, fed with
// fake ---opscope telemetry (src/opplus_config.js OP_SCOPE): every section / view / oscillator type paints inside its canvas,
// the telemetry parser finds the sounding voices, the spectrum of the filter display reads a sine at its frequency, and the
// paint cost stays small (the main face repaints at ~15 fps while notes sound).
//   node tests/test_opplus_face.js        (after python3 scripts/build_opplus.py)
const fs = require("fs");
const path = require("path");
const PB = require("./paint_bounds_lib.js");

const ROOT = path.join(__dirname, "..");
globalThis.OP_PARAMS = require("../scripts/opplus_params.json");
const C = require("../src/opplus_config.js");
let failed = 0, passed = 0;
function ok(c, m) { if (c) passed++; else { failed++; console.log("FAIL " + m); } }

const buf = fs.readFileSync(path.join(ROOT, "devices", "Operator+.amxd"));
const boxes = JSON.parse(buf.slice(32).toString("utf8")).patcher.boxes.map((b) => b.box);
const code = (id) => boxes.find((b) => b.id === id).textfile.text;

// fake scope: 3 sounding voices (0, 4, 9), voice 9 the newest; spectrum rings = a 1 kHz sine (pre) and a quieter one (post)
const S = C.OP_SCOPE, scope = new Float32Array(C.OP_SCOPE_SIZE);
function voice(v, stg, lph, fc, amp) {
    const b = S.V + v * S.VS;
    for (let e = 0; e < 7; e++) { scope[b + S.LVL + e] = 0.6; scope[b + S.STG + e] = stg; }
    scope[b + S.LFO] = 0.3; scope[b + S.FC] = fc; scope[b + S.LPH] = lph; scope[b + S.ON] = 1; scope[b + S.NOTE] = 60; scope[b + S.K] = 0.7;
    for (let k = 0; k < 4; k++) scope[b + S.AMP + k] = amp[k];
}
voice(0, 1.4, 0.1, 400, [1, 0.1, 0, 0]);
voice(4, 3.0, 0.5, 2000, [0.5, 0.2, 0, 0]);
voice(9, 4.6, 0.8, 9000, [0.05, 0, 0, 0.3]);
scope[0] = 77; scope[1] = 48000; scope[2] = 3; scope[4] = 100;
for (let i = 0; i < S.SPECN; i++) { scope[S.SPEC + i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000); scope[S.SPEC + S.SPECN + i] = 0.05 * Math.sin(2 * Math.PI * 1000 * i / 48000); }
function Buffer() {
    this.peek = (ch, a, n) => Array.from(scope.subarray(a, a + n));
    this.poke = () => {};
}

function load(region, W, H) {
    const rec = PB.makeRecorder(W, H);
    const f = PB.loadFace(code(region === "main" ? "obj-face" : "obj-graph"), rec, { Buffer, File: function () { this.isopen = false; this.close = () => {}; }, LiveAPI: function () {}, arrayfromargs: (a) => Array.prototype.slice.call(a) });
    f.setnames("c", "v", "w", "s");
    return { f, rec };
}
const main = load("main", 725, 169), graph = load("graph", 294, 61);

// telemetry parsing (graph region follows the voice the main region announces)
graph.f.telvoice(9);
graph.f.opPollTel();
const tel = graph.f.opTel;
ok(tel.voices.length === 3 && tel.voices.map((v) => v.v).join() === "0,4,9", "parser: the three sounding voices");
ok(tel.voices[2].focus === 1 && Math.abs(tel.fc - 9000) < 1e-3 && Math.abs(tel.lph - 0.8) < 1e-6, "parser: the focus voice drives fc / LFO phase");
ok(tel.meter[0] > 0.99 && tel.meter[1] > 0.5 && tel.meter[2] === 0 && tel.meter[3] > 0.6, `meters: max over voices in dB (${tel.meter.map((m) => m.toFixed(2))})`);

// spectrum: computed only on the filter display
graph.f.pv("ui_section", 5);
graph.f.pv("ui_view_filter", 1);
graph.f.opPollTel();
const sp = graph.f.opTel.spec;
ok(sp && sp.pre.length === graph.f.OP_SPEC_PTS, "spectrum computed on the filter display");
if (sp) {
    const p1k = Math.round(Math.log(1000 / 20) / Math.log(1000) * graph.f.OP_SPEC_PTS);
    const best = sp.pre.indexOf(Math.max(...sp.pre));
    ok(Math.abs(best - p1k) <= 1, `spectrum peak at 1 kHz (point ${best}, want ${p1k})`);
    ok(Math.abs(sp.pre[best] - 20 * Math.log10(0.5)) < 1.5, `a 0.5 sine reads -6 dBFS (${sp.pre[best].toFixed(1)})`);
    ok(Math.abs(sp.pre[best] - sp.post[best] - 20) < 1, "post 20 dB under pre");
}

// paint every section / view / type in both regions, inside the canvas
function paintAll(R, label) {
    R.rec.begin(label);
    const t0 = process.hrtime.bigint();
    R.f.paint();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    R.rec.end();
    return ms;
}
let worstMain = 0, worstGraph = 0;
main.f.opPollTel();
for (let s = 0; s < 8; s++) for (let view = 0; view < 2; view++) for (let ty = 0; ty < 4; ty++) {
    for (const R of [main, graph]) {
        R.f.pv("ui_section", s);
        const k = ["a", "b", "c", "d", "lfo", "filter", "pitch"][s];
        if (k) R.f.pv("ui_view_" + k, view);
        for (const l of "abcd") R.f.pv("osc_" + l + "_type", ty);
        R.f.pv("lfo_on", 1); R.f.pv("filter_on", 1);
        R.f.pv("lfo_type", (s + ty) % 7);
    }
    graph.f.opPollTel();
    worstMain = Math.max(worstMain, paintAll(main, `main s${s} v${view} t${ty}`));
    worstGraph = Math.max(worstGraph, paintAll(graph, `graph s${s} v${view} t${ty}`));
}
for (const [nm, R] of [["main", main], ["graph", graph]]) {
    // text boxes use the mock's font metrics (0.2 size below the baseline): Operator's own value texts of the bottom row reach 2.5 px
    // past the canvas in the mock and fit in Live, so text gets 3 px of tolerance, shapes 0.5 px
    const bad = PB.checkRecording(R.rec, {}).filter((m) => !/text ".*" box/.test(m)).concat(
        R.rec.shapes.filter((sh) => sh.text !== undefined && (sh.x0 < -3 || sh.y0 < -3 || sh.x1 > R.rec.W + 3 || sh.y1 > R.rec.H + 3)).map((sh) => sh.label + " text " + sh.text));
    ok(bad.length === 0, `${nm}: everything inside the canvas, no open paths (${bad.length}: ${bad.slice(0, 3).join(" | ")})`);
}
// timing: measure again warm
let tm = 0, tg = 0;
for (let i = 0; i < 20; i++) { tm += paintAll(main, "t"); tg += paintAll(graph, "t"); }
ok(tm / 20 < 8, `main face paint ${(tm / 20).toFixed(2)} ms (budget 8 ms in Node)`);
ok(tg / 20 < 4, `graph paint ${(tg / 20).toFixed(2)} ms (budget 4 ms in Node)`);
console.log(`paint: main ${(tm / 20).toFixed(2)} ms, graph ${(tg / 20).toFixed(2)} ms (worst cold ${worstMain.toFixed(1)} / ${worstGraph.toFixed(1)})`);

// labels: the Shape field is named after the Type
main.f.pv("ui_section", 0); main.f.pv("ui_view_a", 1);
for (const [ty, lab] of [[1, "Position"], [2, "Detune"], [3, "Width"]]) {
    main.f.pv("osc_a_type", ty);
    main.rec.begin("lab");
    main.f.paint();
    ok(main.rec.shapes.some((sh) => sh.text === lab), `Shape field labelled ${lab} for type ${ty}`);
}
// graph: dragging sets the Shape of a non-Operator type
let sent = null;
graph.f.opSet = (k, v) => { sent = [k, v]; };
graph.f.pv("ui_section", 1); graph.f.pv("ui_view_b", 1); graph.f.pv("osc_b_type", 3);
graph.f.onclick(8 + 0.25 * (294 - 16), 30, 1, 0, 0);
ok(sent && sent[0] === "osc_b_shape" && Math.abs(sent[1] - 25) < 0.01, `graph drag sets Shape (${JSON.stringify(sent)})`);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
