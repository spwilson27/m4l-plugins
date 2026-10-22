"use strict";
/**
 * Multiband Split paint bounds: builds the face as scripts/build_mbsplit.py does (config + spectral_theme + ui), drives it through
 * extreme crossover / gain / band-count / slope / link-badge states and spectrum edge cases (NaN, infinite, huge, silent), and asserts with
 * tests/paint_bounds_lib.js that everything stays inside the top strip or the plot, that handles are fully inside the canvas, that every
 * path starts with a fresh move_to and that no two text labels overlap.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const { makeRecorder, loadFace, checkRecording, grid } = require("./paint_bounds_lib.js");

const SRC = path.join(__dirname, "..", "src");
const rd = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
const code = [rd("mbsplit_config.js"), rd("spectral_theme.js"), rd("mbsplit_ui.js")].join("\n\n");

const W = 256, H = 136;
const rec = makeRecorder(W, H);
rec.mgraphics.size = [W, H];
const bus = { groups: {}, peers: {} };
const sb = loadFace(code, rec, {
    Date, Boolean, global: { __mbsplit_shared_bus: bus }, Global: function () { return bus; },
    LiveAPI: function () { this.path = ""; this.id = "0"; }
});
const ev = (s) => vm.runInContext(s, sb);
sb.setbuffer("x");

const regions = [{ x: 0, y: 0, w: W, h: 15 }, { x: 0, y: 16, w: W, h: H - 16 }];
const fullCanvasFill = (s) => s.kind === "fill" && s.x0 <= 0.01 && s.y0 <= 0.01 && s.x1 >= W - 0.01 && s.y1 >= H - 0.01;
let paints = 0;
function paintOnce(label) {
    rec.begin(label);
    sb.paint();
    rec.end();
    rec.shapes = rec.shapes.filter((s) => !fullCanvasFill(s));     // the canvas background
    const tx = rec.shapes.filter((q) => q.kind === "text");
    for (let i = 0; i < tx.length; i++) for (let j = i + 1; j < tx.length; j++) {
        const A = tx[i], B = tx[j];
        if (A.x0 < B.x1 - 0.5 && B.x0 < A.x1 - 0.5 && A.y0 < B.y1 - 0.5 && B.y0 < A.y1 - 0.5) rec.bad.push(`${label}: text "${A.text}" overlaps text "${B.text}"`);
    }
    // collect per scenario so a failure names its state
    const found = checkRecording(rec, { regions });
    rec.bad = [];
    rec.shapes = [];
    paints++;
    return found;
}
const failures = [];
const run = (label) => { const f = paintOnce(label); for (const x of f) failures.push(x); };

const FS = [20, 50, 5000, 19900, 20000, NaN, -5, 1e9];
const longLabels = ["RACK #1 CH1", "TRACK CH1", "RACK #12 CH16 NESTED LONGLABEL", "LOCAL"];

// 1. crossovers x bands x slope x phase x link badge
// every crossover value pair at the range ends, bands / slope / phase / badge / set order rotated through the grid (full product is too slow)
let gi = 0;
for (const g of grid({ f1: FS, f2: [20, 800, 20000, NaN], f3: [20, 4500, 19900, 20000, NaN], nb: [1, 2, 3, 4], slope: [0, 1, 2], phase: [0, 1], show: [0, 1], order: [0, 1] })) {
    if (gi++ % 7 !== 0) continue;
    if (g.order) { sb.set_f3(g.f3); sb.set_f2(g.f2); sb.set_f1(g.f1); } else { sb.set_f1(g.f1); sb.set_f2(g.f2); sb.set_f3(g.f3); }
    sb.set_numbands(g.nb); sb.set_slope(g.slope); sb.set_phasemode(g.phase); sb.set_show_link(g.show);
    ev(`rackContext = { parentRackPath: "x", chainIndex: 0, nestingDepth: 1, isInRack: true, shortLabel: ${JSON.stringify(longLabels[paints % longLabels.length])} }`);
    run("xover " + JSON.stringify(g));
}

// 2. gain / band mode / link group / hover + drag state / peaks
sb.set_numbands(4); sb.set_f1(20); sb.set_f2(800); sb.set_f3(20000);
let gj = 0;
for (const g of grid({ gain: [-1e9, -70, -69.5, -0.04, 0, 18, 1e9, NaN], bm: [0, 1, 2, 3, 4, 5], mask: [0, 5, 15], lg: [0, 1, 5], peak: [0, 1, 2, NaN, 1e9, -3], drag: [-1, 0, 2], show: [0, 1] })) {
    if (gj++ % 11 !== 0) continue;
    sb.set_gain(g.gain); sb.set_bandmode(g.bm); ev(`curCustomMask = ${g.mask}; curLinkGroup = ${g.lg}; dragHandleIdx = ${g.drag}; hoverHandleIdx = ${g.drag};`);
    sb.set_show_link(g.show);
    ev(`bandPeaks = [${[g.peak, g.peak, g.peak, g.peak]}]; hoverLinkBadge = ${g.show ? "true" : "false"}; dragVolume = ${g.drag === 0}; hoverVolSlider = ${g.drag === 2};`);
    run("controls " + JSON.stringify(g));
}
ev("curLinkGroup = 0; dragHandleIdx = -1; hoverHandleIdx = -1; bandPeaks = [0,0,0,0]; dragVolume = false; hoverVolSlider = false;");

// 3. spectrum edge cases (through the real update path, so smoothing state is exercised too)
const N = ev("MBSPLIT_FFT_SIZE");
const rings = {
    silent: new Array(N).fill(0),
    saw: Array.from({ length: N }, (_, i) => ((i * 110 / 48000) % 1) * 2 - 1),
    huge: Array.from({ length: N }, (_, i) => (i % 2 ? 1e9 : -1e9)),
    nan: new Array(N).fill(NaN),
    inf: new Array(N).fill(Infinity),
    loud: Array.from({ length: N }, (_, i) => (i % 2 ? 40 : -40))
};
for (const nb of [1, 3, 4]) for (const bm of [0, 5]) for (const k of Object.keys(rings)) for (const rep of [1, 20]) {
    sb.set_numbands(nb); sb.set_bandmode(bm); ev("curCustomMask = 15;");
    for (let i = 0; i < rep; i++) sb.updateSpectrogramFrom8192Samples(rings[k], 48000, true);
    run(`spectrum ${k} nb ${nb} bm ${bm} rows ${rep}`);
}
// direct garbage in the spectrum arrays (telemetry that bypassed the update path)
for (const v of [-1e9, -300, 300, 1e9]) {
    ev(`for (var i = 0; i < SPEC_COLS; i++) { specColDb[i] = ${v}; specColPeaks[i] = ${v}; } specColHistory = [specColDb.slice(), specColDb.slice()];`);
    run("raw spectrum " + v);
}
sb.preview();
run("preview");

assert.strictEqual(failures.length, 0, "Multiband Split face drawing out of bounds:\n" + [...new Set(failures)].slice(0, 20).join("\n"));
console.log(`[paint bounds] Multiband Split face (${paints} paints) stays inside the top strip / plot`);
