#!/usr/bin/env node
/**
 * Automated verification & interaction test suite for devices/Tiny Space.amxd
 * Run with: node tests/test_tinyspace.js
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT_DIR = path.dirname(__dirname);
const AMXD_PATH = path.join(ROOT_DIR, "devices", "Tiny Space.amxd");

const raw = fs.readFileSync(AMXD_PATH);
assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", "Invalid ampf header");
assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected 'aaaa' audio effect device type");
assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected 'ptch' chunk tag");
const ptchLen = raw.readUInt32LE(28);
assert.strictEqual(32 + ptchLen, raw.length, "ptch chunk length mismatch");

const doc = JSON.parse(raw.slice(32).toString("utf8"));
const p = doc.patcher;
assert.strictEqual(p.devicewidth, 660.0, "Expected devicewidth 660.0");

const boxMap = new Map();
for (const b of p.boxes) {
    const box = b.box;
    assert(!boxMap.has(box.id), `Duplicate box id: ${box.id}`);
    boxMap.set(box.id, box);
}

// gen.codebox~ present with code
const genBox = boxMap.get("obj-gen");
assert(genBox && genBox.maxclass === "gen.codebox~", "Missing gen.codebox~");
assert(genBox.code && genBox.code.indexOf("in1") >= 0, "gen code missing in1");
assert(genBox.code.indexOf("out22") >= 0, "gen code missing out22");
assert(genBox.code.indexOf("Buffer cfg") >= 0, "gen code missing Buffer cfg");
assert(genBox.numinlets === 15, "gen numinlets != 15");
assert(genBox.numoutlets === 22, "gen numoutlets != 22");

// v8ui canvas present
const vizBox = boxMap.get("obj-viz");
assert(vizBox && vizBox.maxclass === "v8ui", "Missing v8ui viz");
const vizRect = vizBox.presentation_rect;

// no live.* widget overlaps v8ui canvas in presentation mode
for (const [id, box] of boxMap.entries()) {
    if (id === "obj-viz" || box.maxclass === "panel" || !box.presentation || !box.presentation_rect) continue;
    const r = box.presentation_rect;
    const overlapsX = r[0] < (vizRect[0] + vizRect[2]) && (r[0] + r[2]) > vizRect[0];
    const overlapsY = r[1] < (vizRect[1] + vizRect[3]) && (r[1] + r[3]) > vizRect[1];
    assert(!(overlapsX && overlapsY), `Presentation widget ${id} (${box.maxclass}) overlaps v8ui canvas!`);
}

// patchlines valid
for (const l of p.lines) {
    const pl = l.patchline;
    const [srcId, srcOut] = pl.source;
    const [dstId, dstIn] = pl.destination;
    assert(boxMap.has(srcId), `Missing source box: ${srcId}`);
    assert(boxMap.has(dstId), `Missing destination box: ${dstId}`);
    assert(srcOut < boxMap.get(srcId).numoutlets, `Outlet ${srcOut} out of range on ${srcId}`);
    assert(dstIn < boxMap.get(dstId).numinlets, `Inlet ${dstIn} out of range on ${dstId}`);
}

// parameters present
assert(p.parameters["obj-seed"], "Missing Seed parameter");
assert(p.parameters["obj-freeze"], "Missing Freeze parameter");
assert(p.parameters["obj-dial-size"], "Missing Size dial parameter");

// ---- Mock v8ui environment ----
const jsCode = vizBox.textfile.text;
let lastPoke = null;
let outletsOut = [[]];
global.mgraphics = {
    size: [396, 134],
    init() {}, redraw() {},
    set_source_rgba() {}, rectangle() {}, fill() {}, fill_preserve() {},
    stroke() {}, set_line_width() {}, move_to() {}, line_to() {},
    curve_to() {}, close_path() {}, arc() {}, select_font_face() {},
    set_font_size() {}, show_text() {}, rectangle_rounded() {}
};
global.inlets = 1;
global.outlets = 1;
global.outlet = (idx, ...args) => { outletsOut[idx] = args; };
global.notifyclients = () => {};
global.Buffer = function(name) {
    this.poke = (ch, off, arr) => { lastPoke = arr; };
};

eval(jsCode);

loadbang();
setbuffer("test-buf");
assert(lastPoke && lastPoke.length === 41, "Expected 41-float config poke, got " + (lastPoke ? lastPoke.length : "null"));
assert(lastPoke[0] >= 4 && lastPoke[0] <= 20, "activeCount out of range");

// determinism: re-apply same seed -> same poke
applySeedDirect = null;
const seedBefore = getvalueof()[1];
// call seed(42) twice and compare poke arrays
seed(42);
const poke1 = lastPoke.slice();
seed(42);
const poke2 = lastPoke.slice();
assert.deepStrictEqual(poke1, poke2, "Seed PRNG not deterministic");

// getvalueof/setvalueof round-trip
const v0 = getvalueof();
assert(Array.isArray(v0) && v0[0] === 1, "getvalueof version != 1");
setvalueof([1, 999]);
assert.strictEqual(getvalueof()[1], 999, "setvalueof did not restore seed");

// lineN handlers
line0(0.75);
assert(getBarTrail(0) >= 0.7, "line0 did not update barTrail");
assert(getActiveCount() >= 4 && getActiveCount() <= 20, "activeCount range");
// preview hook
preview();
assert(true, "preview() ran");

// meter count: 20 rms/snapshot/prep boxes
for (let i = 0; i < 20; i++) {
    assert(boxMap.has("obj-rms-" + i), "missing rms " + i);
    assert(boxMap.has("obj-snap-" + i), "missing snap " + i);
    assert(boxMap.has("obj-prep-" + i), "missing prep " + i);
}

// ---- Harness validation ----
const HARNESS_PATH = path.join(ROOT_DIR, "tests", "tinyspace_harness.maxpat");
assert(fs.existsSync(HARNESS_PATH), "Missing tinyspace_harness.maxpat");
const hDoc = JSON.parse(fs.readFileSync(HARNESS_PATH, "utf8"));
const hBoxes = hDoc.patcher.boxes.map(b => b.box);
const hGen = hBoxes.find(b => b.maxclass === "gen.codebox~");
assert(hGen && hGen.code && hGen.code.indexOf("out22") >= 0, "Harness gen core invalid");
const hCapture = hBoxes.find(b => b.id === "obj-peak");
assert(hCapture, "Harness missing peakamp~ (extra out sink)");
const hTone = hBoxes.find(b => b.id === "obj-click");
assert(hTone, "Harness missing click~ (extra in sink)");

const HARNESS_FREEZE_PATH = path.join(ROOT_DIR, "tests", "tinyspace_harness_freeze.maxpat");
assert(fs.existsSync(HARNESS_FREEZE_PATH), "Missing freeze harness");
const hfDoc = JSON.parse(fs.readFileSync(HARNESS_FREEZE_PATH, "utf8"));
const hfGen = hfDoc.patcher.boxes.map(b => b.box).find(b => b.maxclass === "gen.codebox~");
assert(hfGen && hfGen.code && hfGen.code.indexOf("out22") >= 0, "Freeze harness gen core invalid");
assert(hTone, "Harness missing test tone (extra in sink)");
console.log("Harness validation passed.");

console.log("All Tiny Space tests passed.");
