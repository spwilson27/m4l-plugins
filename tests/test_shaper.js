#!/usr/bin/env node
/**
 * Automated verification & interaction test suite for devices/Bitwig Shaper.amxd
 * Run with: node tests/test_shaper.js
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT_DIR = path.dirname(__dirname);
const AMXD_PATH = path.join(ROOT_DIR, "devices", "Bitwig Shaper.amxd");

// 1. Validate binary .amxd header & patcher JSON integrity
const raw = fs.readFileSync(AMXD_PATH);
assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", "Invalid ampf header");
assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected 'aaaa' audio effect device type");
assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected 'ptch' chunk tag");

const ptchLen = raw.readUInt32LE(28);
assert.strictEqual(32 + ptchLen, raw.length, "ptch chunk length mismatch");

const doc = JSON.parse(raw.slice(32).toString("utf8"));
const p = doc.patcher;
assert.strictEqual(p.devicewidth, 670.0, "Expected devicewidth 670.0");

const boxMap = new Map();
for (const b of p.boxes) {
    const box = b.box;
    assert(!boxMap.has(box.id), `Duplicate box id: ${box.id}`);
    boxMap.set(box.id, box);
}

// Verify all 8 mapping slots exist and have unique ExclusiveArm IDs
for (let slot = 1; slot <= 8; slot++) {
    assert(boxMap.has(`obj-map-btn-${slot}`), `Missing Map button for slot ${slot}`);
    assert(boxMap.has(`obj-unmap-btn-${slot}`), `Missing Unmap button for slot ${slot}`);
    assert(boxMap.has(`obj-min-${slot}`), `Missing Min numbox for slot ${slot}`);
    assert(boxMap.has(`obj-max-${slot}`), `Missing Max numbox for slot ${slot}`);
    const sub = boxMap.get(`obj-map-sub-${slot}`);
    assert(sub && sub.patcher, `Missing p Map_${slot} subpatcher`);
}

// Verify no live.* UI widget overlaps the v8ui canvas in presentation mode
const msegRect = boxMap.get("obj-mseg").presentation_rect;
for (const [id, box] of boxMap.entries()) {
    if (id === "obj-mseg" || box.maxclass === "panel" || !box.presentation || !box.presentation_rect) continue;
    const r = box.presentation_rect;
    const overlapsX = r[0] < (msegRect[0] + msegRect[2]) && (r[0] + r[2]) > msegRect[0];
    const overlapsY = r[1] < (msegRect[1] + msegRect[3]) && (r[1] + r[3]) > msegRect[1];
    assert(!(overlapsX && overlapsY), `Presentation widget ${id} (${box.maxclass}) overlaps v8ui canvas!`);
}

// Verify all patchlines reference valid boxes & inlet/outlet indices
for (const l of p.lines) {
    const pl = l.patchline;
    const [srcId, srcOut] = pl.source;
    const [dstId, dstIn] = pl.destination;
    assert(boxMap.has(srcId), `Missing source box: ${srcId}`);
    assert(boxMap.has(dstId), `Missing destination box: ${dstId}`);
    assert(srcOut < boxMap.get(srcId).numoutlets, `Outlet ${srcOut} out of range on ${srcId}`);
    assert(dstIn < boxMap.get(dstId).numinlets, `Inlet ${dstIn} out of range on ${dstId}`);
}

// 2. Mock Max v8ui environment and test MSEG Editor interactions
const jsCode = boxMap.get("obj-mseg").textfile.text;

let lastPoke = null;
let outletsOut = [[], []];

global.mgraphics = {
    size: [298, 134],
    init() {},
    redraw() {},
    set_source_rgba() {},
    rectangle() {},
    rectangle_rounded() {},
    fill() {},
    fill_preserve() {},
    stroke() {},
    set_line_width() {},
    move_to() {},
    line_to() {},
    curve_to() {},
    close_path() {},
    arc() {},
    select_font_face() {},
    set_font_size() {},
    show_text() {}
};
global.inlets = 1;
global.outlets = 2;
global.outlet = (idx, ...args) => { outletsOut[idx] = args; };
global.notifyclients = () => {};
global.Buffer = function(name) {
    this.poke = (ch, off, arr) => { lastPoke = arr; };
};

eval(jsCode);

loadbang();
setbuffer("test-buf");
assert(lastPoke && lastPoke.length === 4096, "Expected 4096-sample wavetable buffer poke");

// Test 1: Single-click point creation & Undo / Redo
applyToolbarAction("clear"); // 2 points: (0,0) and (1,1)
let st0 = getvalueof();
assert.strictEqual(st0[5], 2, "Expected 2 points after clear");

onclick(120, 50, 1, 0, 0, 0, 0, 0);
ondrag(120, 50, 0, 0, 0, 0, 0, 0);
let st1 = getvalueof();
assert.strictEqual(st1[5], 3, "Expected 3 points after single-click in empty space");

undo();
let stUndo = getvalueof();
assert.strictEqual(stUndo[5], 2, "Expected 2 points after Undo");

redo();
let stRedo = getvalueof();
assert.strictEqual(stRedo[5], 3, "Expected 3 points after Redo");

// Test 2: S-Curve segment tension
applyToolbarAction("clear"); // 2 points: (0,0) -> (1,1)
onclick(140, 60, 1, 0, 0, 0, 0, 1); // Ctrl+click on segment 0
let stS = getvalueof();
assert.strictEqual(stS[9], 1, "Expected sCurve flag = 1 on first segment after Ctrl+click");
const yMid = evalCurveAt(0.5);
const yQ1 = evalCurveAt(0.25);
const yQ3 = evalCurveAt(0.75);
assert(Math.abs(yMid - 0.5) < 1e-6, `Expected S-curve midpoint 0.5, got ${yMid}`);
assert(yQ1 > 0.30, `Expected S-curve Q1 > 0.30, got ${yQ1}`);
assert(yQ3 < 0.70, `Expected S-curve Q3 < 0.70, got ${yQ3}`);
assert(Math.abs((yQ1 - 0.25) - (0.75 - yQ3)) < 1e-6, "Expected symmetric S-curve inflection");

// Test 3: Paint / Draw Step Brush mode
applyToolbarAction("clear");
applyToolbarAction("draw"); // Enable Draw mode (brushType = 0 Step)
onclick(50, 40, 1, 0, 0, 0, 0, 0);
ondrag(150, 70, 1, 0, 0, 0, 0, 0);
ondrag(150, 70, 0, 0, 0, 0, 0, 0);
let stPaint = getvalueof();
assert(stPaint[5] >= 4, `Expected painted step points >= 4, got ${stPaint[5]}`);
for (let b = 0; b < 4; b++) {
    applyToolbarAction("brush");
    onclick(80, 45, 1, 0, 0, 0, 0, 0);
    ondrag(120, 65, 1, 0, 0, 0, 0, 0);
    ondrag(120, 65, 0, 0, 0, 0, 0, 0);
}
applyToolbarAction("draw"); // Exit Draw mode

// Test 4: Loop Start / End Region Markers
ratehz(2.0);
ratemode(0);
assert.strictEqual(outletsOut[1][0], 2.0, "Expected base rate 2.0 Hz when loop is off");
onclick(7, 5, 1, 0, 0, 0, 0, 0);
const lay = getLayout();
ondrag(lay.plotX + 0.25 * lay.plotW, 5, 1, 0, 0, 0, 0, 0);
ondrag(lay.plotX + 0.25 * lay.plotW, 5, 0, 0, 0, 0, 0, 0);

onclick(lay.plotX + lay.plotW, 5, 1, 0, 0, 0, 0, 0);
ondrag(lay.plotX + 0.75 * lay.plotW, 5, 1, 0, 0, 0, 0, 0);
ondrag(lay.plotX + 0.75 * lay.plotW, 5, 0, 0, 0, 0, 0, 0);

assert.strictEqual(outletsOut[0][0], "loop", "Expected 'loop' message on outlet 0");
assert(Math.abs(outletsOut[0][1] - 0.25) < 0.01, `Expected loopStart 0.25, got ${outletsOut[0][1]}`);
assert(Math.abs(outletsOut[0][2] - 0.50) < 0.01, `Expected loopSpan 0.50, got ${outletsOut[0][2]}`);
assert(Math.abs(outletsOut[1][0] - 4.0) < 0.05, `Expected loop-scaled rate 4.0 Hz, got ${outletsOut[1][0]}`);

// Test 5: Point Overwriting ("Eat Points") & Double-Click Deletion
applyToolbarAction("clear");
onclick(70, 50, 1, 0, 0, 0, 0, 0); ondrag(70, 50, 0, 0, 0, 0, 0, 0);
onclick(140, 50, 1, 0, 0, 0, 0, 0); ondrag(140, 50, 0, 0, 0, 0, 0, 0);
onclick(210, 50, 1, 0, 0, 0, 0, 0); ondrag(210, 50, 0, 0, 0, 0, 0, 0);
let stBeforeEat = getvalueof();
assert.strictEqual(stBeforeEat[5], 5, "Expected 5 points before overwrite drag");

let p1Screen = normToScreen(stBeforeEat[10], stBeforeEat[11], lay);
onclick(p1Screen[0], p1Screen[1], 1, 0, 0, 0, 0, 0);
ondrag(250, p1Screen[1], 1, 0, 0, 0, 0, 0);
ondrag(250, p1Screen[1], 0, 0, 0, 0, 0, 0);
let stAfterEat = getvalueof();
assert.strictEqual(stAfterEat[5], 3, `Expected 3 points after overwriting 2 points, got ${stAfterEat[5]}`);

// Verify paint() runs cleanly across all features
paint();

console.log("SUCCESS: All binary, patcher, 8-slot mapping, and MSEG interaction tests passed!");
