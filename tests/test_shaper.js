#!/usr/bin/env node
/**
 * Automated verification & interaction test suite for devices/Better Shaper.amxd
 * Run with: node tests/test_shaper.js
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT_DIR = path.dirname(__dirname);
const AMXD_PATH = path.join(ROOT_DIR, "devices", "Better Shaper.amxd");

function validatePatcherBoxesAndLines(patcher, label = "root") {
    const map = new Map();
    for (const b of patcher.boxes) {
        const box = b.box;
        assert(!map.has(box.id), `[${label}] Duplicate box id: ${box.id}`);
        map.set(box.id, box);
    }
    for (const l of patcher.lines) {
        const pl = l.patchline;
        const [srcId, srcOut] = pl.source;
        const [dstId, dstIn] = pl.destination;
        assert(map.has(srcId), `[${label}] Missing source box: ${srcId}`);
        assert(map.has(dstId), `[${label}] Missing destination box: ${dstId}`);
        assert(srcOut < map.get(srcId).numoutlets, `[${label}] Outlet ${srcOut} out of range on ${srcId}`);
        assert(dstIn < map.get(dstId).numinlets, `[${label}] Inlet ${dstIn} out of range on ${dstId}`);
    }
    return map;
}

// 1. Validate binary .amxd header & patcher JSON integrity
const raw = fs.readFileSync(AMXD_PATH);
assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", "Invalid ampf header");
assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected 'aaaa' audio effect device type");
assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected 'ptch' chunk tag");

const ptchLen = raw.readUInt32LE(28);
assert.strictEqual(32 + ptchLen, raw.length, "ptch chunk length mismatch");

const doc = JSON.parse(raw.slice(32).toString("utf8"));
const p = doc.patcher;
assert.strictEqual(p.devicewidth, 436.0, "Expected devicewidth 436.0");

const boxMap = validatePatcherBoxesAndLines(p, "root");

// Verify Multimap Show/Hide button is at top-right of Left Panel and hides MSEG + Grid/Snap when opened
assert(boxMap.has("obj-expand-map"), "Missing obj-expand-map button");
assert.deepStrictEqual(boxMap.get("obj-expand-map").presentation_rect, [255.0, 8.0, 15.0, 15.0], "Expected obj-expand-map at top-right of Left Panel");
assert(boxMap.has("obj-play-mode"), "Missing obj-play-mode [Loop / 1-Shot / Manual] tab");
assert(boxMap.has("obj-hide-mseg-msg"), "Missing obj-hide-mseg-msg");
assert(boxMap.has("obj-rate-line"), "Missing connecting tick line between Rate and Hz/Beat mode");

// Verify obj-hide-mseg-msg hides obj-mseg, obj-grid-lbl, obj-grid, and obj-snap-btn when switching to Mod view
const hiddenTargets = p.lines
    .filter(l => l.patchline.source[0] === "obj-hide-mseg-msg")
    .map(l => l.patchline.destination[0]);
for (const expectedTarget of ["obj-mseg", "obj-grid-lbl", "obj-grid", "obj-snap-btn"]) {
    assert(hiddenTargets.includes(expectedTarget), `Expected obj-hide-mseg-msg to hide ${expectedTarget} in Mod view`);
}

// Verify all 8 mapping slots have Map, Unmap, ModMode (Mod/Remote), Bipolar, ModAmount, Min, Max, and dual live.modulate~/live.remote~ subpatcher
for (let slot = 1; slot <= 8; slot++) {
    assert(boxMap.has(`obj-map-btn-${slot}`), `Missing Map button for slot ${slot}`);
    assert(boxMap.has(`obj-unmap-btn-${slot}`), `Missing Unmap button for slot ${slot}`);
    assert(boxMap.has(`obj-mod-mode-${slot}`), `Missing ModMode toggle for slot ${slot}`);
    assert(boxMap.has(`obj-bipolar-${slot}`), `Missing Bipolar toggle for slot ${slot}`);
    assert(boxMap.has(`obj-mod-amt-${slot}`), `Missing ModAmount numbox for slot ${slot}`);
    assert(boxMap.has(`obj-min-${slot}`), `Missing Min numbox for slot ${slot}`);
    assert(boxMap.has(`obj-max-${slot}`), `Missing Max numbox for slot ${slot}`);
    assert.strictEqual(boxMap.get(`obj-min-${slot}`).hidden, 1, `Expected Min numbox hidden initially in Mod mode for slot ${slot}`);
    assert.strictEqual(boxMap.get(`obj-max-${slot}`).hidden, 1, `Expected Max numbox hidden initially in Mod mode for slot ${slot}`);
    if (slot === 1) {
        assert.strictEqual(boxMap.get(`obj-map-btn-1`).hidden, 0, "Expected Slot 1 Map visible in MSEG view");
    } else {
        assert.strictEqual(boxMap.get(`obj-map-btn-${slot}`).hidden, 1, `Expected Slot ${slot} Map hidden initially in MSEG view`);
        const visSub = boxMap.get(`obj-slot-vis-${slot}`);
        assert(visSub && visSub.patcher, `Missing p SlotVis_${slot} subpatcher`);
        validatePatcherBoxesAndLines(visSub.patcher, `p SlotVis_${slot}`);
    }
    const sub = boxMap.get(`obj-map-sub-${slot}`);
    assert(sub && sub.patcher, `Missing p Map_${slot} subpatcher`);
    assert.strictEqual(sub.numinlets, 8, `Expected 8 inlets on p Map_${slot}`);
    const subMap = validatePatcherBoxesAndLines(sub.patcher, `p Map_${slot}`);
    assert(subMap.has("obj-modulate"), `Missing live.modulate~ in p Map_${slot}`);
    assert(subMap.has("obj-mod-scale"), `Missing mod scale~ in p Map_${slot}`);
    assert(subMap.has("obj-5"), `Missing live.remote~ in p Map_${slot}`);
    assert(subMap.has("obj-mode-gate"), `Missing gate 2 1 in p Map_${slot}`);
}

// Verify no visible presentation widget overlaps the v8ui canvas
const msegRect = boxMap.get("obj-mseg").presentation_rect;
for (const [id, box] of boxMap.entries()) {
    if (id === "obj-mseg" || box.maxclass === "panel" || !box.presentation || !box.presentation_rect || box.hidden === 1) continue;
    const r = box.presentation_rect;
    const overlapsX = r[0] < (msegRect[0] + msegRect[2]) && (r[0] + r[2]) > msegRect[0];
    const overlapsY = r[1] < (msegRect[1] + msegRect[3]) && (r[1] + r[3]) > msegRect[1];
    assert(!(overlapsX && overlapsY), `Presentation widget ${id} (${box.maxclass}) overlaps v8ui canvas!`);
}

// 2. Mock Max v8ui environment and test MSEG Editor interactions
const jsCode = boxMap.get("obj-mseg").textfile.text;

let lastPoke = null;
let outletsOut = [[], []];
let outletHistory0 = [];

global.mgraphics = {
    size: [262, 134],
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
global.outlet = (idx, ...args) => {
    outletsOut[idx] = args;
    if (idx === 0) outletHistory0.push(args);
};
global.notifyclients = () => {};
global.Buffer = function(name) {
    this.poke = (ch, off, arr) => { lastPoke = arr; };
};

eval(jsCode);

loadbang();
setbuffer("test-buf");
assert(lastPoke && lastPoke.length === 4096, "Expected 4096-sample wavetable buffer poke");
const lay = getLayout();

// Test 1: Single-click point creation & Undo / Redo
applyToolbarAction("clear");
let st0 = getvalueof();
assert.strictEqual(st0[5], 2, "Expected 2 points after clear");

onclick(120, 50, 1, 0, 0, 0, 0, 0);
ondrag(120, 50, 0, 0, 0, 0, 0, 0);
let st1 = getvalueof();
assert.strictEqual(st1[5], 3, "Expected 3 points after single-click in empty space");

undo();
assert.strictEqual(getvalueof()[5], 2, "Expected 2 points after Undo");
redo();
assert.strictEqual(getvalueof()[5], 3, "Expected 3 points after Redo");

// Test 1b: Toolbar items verification (Delete Selected, Double Saw, S-Curve, Exp Decay, Exp Ramp, Invert Vertically removed; Randomize Ramps & Randomize Steps added)
const toolbarIds = TOOLBAR_ITEMS.map(item => item.id);
assert(!toolbarIds.includes("clear"), "Expected 'clear' (Delete Selected) button removed from bottom toolbar");
assert(!toolbarIds.includes("saw2"), "Expected 'saw2' (Double Saw) button removed from bottom toolbar");
assert(!toolbarIds.includes("scurve"), "Expected 'scurve' button removed from bottom toolbar");
assert(!toolbarIds.includes("decay"), "Expected 'decay' (Exp Decay) button removed from bottom toolbar");
assert(!toolbarIds.includes("ramp"), "Expected 'ramp' (Exp Ramp) button removed from bottom toolbar");
assert(!toolbarIds.includes("flipy"), "Expected 'flipy' (Invert Vertically) button removed from bottom toolbar");
assert(toolbarIds.includes("rnd_ramps"), "Expected 'rnd_ramps' (Randomize Ramps) button in bottom toolbar");
assert(toolbarIds.includes("rnd_steps"), "Expected 'rnd_steps' (Randomize Steps) button in bottom toolbar");

// Test 2: S-Curve segment tension via Double Alt-Click (ondblclick with opt=1) & Single vs Multi-Selected Node Alt+Drag Curve Slope
applyToolbarAction("clear");
onclick(130, 50, 1, 0, 0, 0, 0, 0);
ondrag(130, 50, 0, 0, 0, 0, 0, 0);
assert.strictEqual(getvalueof()[5], 3, "Expected 3 points (2 segments)");
// Double Alt-click on Segment 0 (left half, x=60) to toggle S-Curve on Segment 0 only
onclick(60, 60, 1, 0, 0, 0, 1, 0);
ondrag(60, 60, 0, 0, 0, 0, 1, 0);
ondblclick(60, 60, 1, 0, 0, 0, 1, 0);
let stS = getvalueof();
assert.strictEqual(stS[9], 1, "Expected sCurve flag = 1 on Segment 0 after Double Alt-click");
assert.strictEqual(stS[13], 0, "Expected Segment 1 sCurve flag to remain 0 (each curve uniquely configurable)");

// Double Alt-click again on Segment 0 switches back to Exponential (sCurve=0)
ondblclick(60, 60, 1, 0, 0, 0, 1, 0);
assert.strictEqual(getvalueof()[9], 0, "Expected sCurve flag = 0 on Segment 0 after second Double Alt-click");

// Double Alt-click on Segment 1 (right half, x=200) toggles S-Curve on Segment 1 only
ondblclick(200, 60, 1, 0, 0, 0, 1, 0);
let stS2 = getvalueof();
assert.strictEqual(stS2[9], 0, "Expected Segment 0 sCurve flag to remain 0");
assert.strictEqual(stS2[13], 1, "Expected Segment 1 sCurve flag = 1 after Double Alt-click on Segment 1");

// Verify when only 1 node is selected, Alt-dragging Segment 0 curve leaves Segment 1 curve untouched
const seg1CurveSingleBefore = getvalueof()[12];
onclick(60, 60, 1, 0, 0, 0, 1, 0);
ondrag(60, 35, 1, 0, 0, 0, 1, 0);
ondrag(60, 35, 0, 0, 0, 0, 1, 0);
assert.strictEqual(getvalueof()[12], seg1CurveSingleBefore, "Expected Alt+drag on Segment 0 with 1 node selected to leave Segment 1 curve untouched");

// Verify when multiple nodes are selected (e.g., Cmd+A), Alt+drag adjusts the slope of EACH of their curves!
onfocus();
onkeydown(97, 97, 1, 1, 0, 0, 0, 0); // Cmd+A selects all 3 points
const seg0CurveMultiBefore = getvalueof()[8];
const seg1CurveMultiBefore = getvalueof()[12];
onclick(60, 60, 1, 0, 0, 0, 1, 0);
ondrag(60, 30, 1, 0, 0, 0, 1, 0);
ondrag(60, 30, 0, 0, 0, 0, 1, 0);
assert(Math.abs(getvalueof()[8] - seg0CurveMultiBefore) > 0.1, "Expected Segment 0 curve to adjust when multiple nodes are selected and Alt+drag is used");
assert(Math.abs(getvalueof()[12] - seg1CurveMultiBefore) > 0.1, "Expected Segment 1 curve to also adjust when multiple nodes are selected and Alt+drag is used");

// Test 2b: Randomize Ramps & Randomize Steps buttons and built-in Grid / Snap toolbar controls
grid(8);
applyToolbarAction("rnd_ramps");
let stRamps = getvalueof();
assert(stRamps[5] >= 4 && stRamps[5] <= 16, `Expected Randomize Ramps to create 2..8 ramps (4..16 points), got ${stRamps[5]}`);
assert(stRamps[8] > 0.3, `Expected positive exponential decay curve on first ramp segment, got ${stRamps[8]}`);

applyToolbarAction("rnd_steps");
let stSteps = getvalueof();
assert(stSteps[5] >= 4 && stSteps[5] <= 16, `Expected Randomize Steps to create 2..8 steps (4..16 points), got ${stSteps[5]}`);
assert.strictEqual(stSteps[7], stSteps[11], "Expected flat horizontal step (y0 === y1) on first step segment");

// Click built-in Snap button & Grid control in bottom-right of v8ui toolbar
outletHistory0 = [];
onclick(lay.w - 20, lay.toolbarY + 10, 1, 0, 0, 0, 0, 0);
assert(outletHistory0.some(m => m[0] === "snap_sync"), "Expected clicking Snap button in v8ui toolbar to emit snap_sync");
onclick(lay.w - 20, lay.toolbarY + 10, 1, 0, 0, 0, 0, 0); // restore snapEnabled = 1

outletHistory0 = [];
onclick(lay.toolbarW + 35, lay.toolbarY + 10, 1, 0, 0, 0, 0, 0);
ondrag(lay.toolbarW + 35, lay.toolbarY + 10, 0, 0, 0, 0, 0, 0);
assert(outletHistory0.some(m => m[0] === "grid_sync" && m[1] === 9), "Expected clicking Grid control in v8ui toolbar to increment grid to 9 and emit grid_sync");
ondblclick(lay.toolbarW + 35, lay.toolbarY + 10, 1, 0, 0, 0, 0, 0);
assert(outletHistory0.some(m => m[0] === "grid_sync" && m[1] === 8), "Expected double-clicking Grid control to reset grid to 8");

// Test 3 (Regression Bug #1): Ramp Brush left-to-right drag across cells 0, 1, 2, 3 must NOT flatten earlier cells!
applyToolbarAction("clear");
grid(8);
drawMode = 1;
brushType = 1; // Ramp Up brush (0 -> yVal in each cell)
const targetScreenY = normToScreen(0, 0.85, lay)[1];
const cell0X = normToScreen(0.06, 0.85, lay)[0];
const cell1X = normToScreen(0.18, 0.85, lay)[0];
const cell2X = normToScreen(0.31, 0.85, lay)[0];
const cell3X = normToScreen(0.43, 0.85, lay)[0];

onclick(cell0X, targetScreenY, 1, 0, 0, 0, 0, 0);
ondrag(cell1X, targetScreenY, 1, 0, 0, 0, 0, 0);
ondrag(cell2X, targetScreenY, 1, 0, 0, 0, 0, 0);
ondrag(cell3X, targetScreenY, 1, 0, 0, 0, 0, 0);
ondrag(cell3X, targetScreenY, 0, 0, 0, 0, 0, 0);

// Check near the top of each ramp in cell 0 (x=0.115), cell 1 (x=0.24), cell 2 (x=0.365), cell 3 (x=0.49)
for (const [cIdx, checkX] of [[0, 0.115], [1, 0.24], [2, 0.365], [3, 0.49]]) {
    const val = evalCurveAt(checkX);
    assert(val > 0.70, `Ramp brush flattened cell ${cIdx} at x=${checkX}: got y=${val}, expected > 0.70`);
}

// Test 4 (Regression Bug #2): Freehand Brush must create a continuous trail of points rather than a single point!
applyToolbarAction("clear");
drawMode = 1;
brushType = 4; // Freehand brush
onclick(30, 50, 1, 0, 0, 0, 0, 0);
for (let sx = 33; sx <= 245; sx += 3) {
    let sy = 55 + Math.sin(sx * 0.05) * 25;
    ondrag(sx, sy, 1, 0, 0, 0, 0, 0);
}
ondrag(245, 55, 0, 0, 0, 0, 0, 0);
let stFree = getvalueof();
assert(stFree[5] >= 12, `Freehand brush only created ${stFree[5]} points across full drag; expected >= 12!`);
drawMode = 0;

// Test 5 (Regression Bug #3): Sync mode aligns phase with timeline (1-PPQ ticks) instead of resetting to 0 on play
ratesync(12); // 1 Bar = 4.0 beats
ratemode(1);  // Sync mode
outletHistory0 = [];
ticks(2.0);   // Playhead is at Bar 1, Beat 3 (2.0 quarter-note beats)
transport(1); // Play starts
const syncMsg1 = outletHistory0.find(m => m[0] === "syncphase");
assert(syncMsg1, "Expected syncphase output when transport starts in Sync mode");
assert(Math.abs(syncMsg1[1] - 0.50) < 1e-5, `Expected timeline phase 0.50 at beat 2.0 of 4-beat bar, got ${syncMsg1[1]}`);

outletHistory0 = [];
ticks(5.0);   // User jumps timeline to Bar 2, Beat 2 (5.0 beats)
const syncMsg2 = outletHistory0.find(m => m[0] === "syncphase");
assert(syncMsg2 && Math.abs(syncMsg2[1] - 0.25) < 1e-5, `Expected timeline phase 0.25 at beat 5.0, got ${syncMsg2 ? syncMsg2[1] : "none"}`);
ratemode(0);

// Test 6: Keyboard Cmd+A (Select All) and Delete / Backspace to delete selected points
applyToolbarAction("clear");
onclick(80, 40, 1, 0, 0, 0, 0, 0);  ondrag(80, 40, 0, 0, 0, 0, 0, 0);
onclick(150, 60, 1, 0, 0, 0, 0, 0); ondrag(150, 60, 0, 0, 0, 0, 0, 0);
onclick(220, 35, 1, 0, 0, 0, 0, 0); ondrag(220, 35, 0, 0, 0, 0, 0, 0);
assert.strictEqual(getvalueof()[5], 5, "Expected 5 points before Cmd+A + Delete test");

onfocus();
const handledSelectAll = onkeydown(97, 97, 1, 1, 0, 0, 0, 0); // Cmd+A
assert.strictEqual(handledSelectAll, 1, "Expected Cmd+A to be handled");
assert.strictEqual(selectedIds.length, 5, "Expected all 5 points selected after Cmd+A");

const handledDelete = onkeydown(8, 8, 1, 0, 0, 0, 0, 0); // Backspace / Delete
assert.strictEqual(handledDelete, 1, "Expected Backspace/Delete to be handled");
assert.strictEqual(getvalueof()[5], 2, "Expected all 3 interior points deleted by Backspace, leaving 2 boundary points");

// Cmd+Z via keyboard restores the 5 points
onkeydown(122, 122, 1, 1, 0, 0, 0, 0);
assert.strictEqual(getvalueof()[5], 5, "Expected Cmd+Z to restore 5 points");

// Test 7: Loop Start / End Region Markers
ratehz(2.0);
ratemode(0);
outletHistory0 = [];
onclick(7, 5, 1, 0, 0, 0, 0, 0);
ondrag(lay.plotX + 0.25 * lay.plotW, 5, 1, 0, 0, 0, 0, 0);
ondrag(lay.plotX + 0.25 * lay.plotW, 5, 0, 0, 0, 0, 0, 0);

onclick(lay.plotX + lay.plotW, 5, 1, 0, 0, 0, 0, 0);
ondrag(lay.plotX + 0.75 * lay.plotW, 5, 1, 0, 0, 0, 0, 0);
ondrag(lay.plotX + 0.75 * lay.plotW, 5, 0, 0, 0, 0, 0, 0);

const loopMsgs = outletHistory0.filter(m => m[0] === "loop");
assert(loopMsgs.length > 0, "Expected 'loop' message on outlet 0");
const lastLoopMsg = loopMsgs[loopMsgs.length - 1];
assert(Math.abs(lastLoopMsg[1] - 0.25) < 0.01, `Expected loopStart 0.25, got ${lastLoopMsg[1]}`);
assert(Math.abs(lastLoopMsg[2] - 0.50) < 0.01, `Expected loopSpan 0.50, got ${lastLoopMsg[2]}`);
assert(Math.abs(outletsOut[1][0] - 4.0) < 0.05, `Expected loop-scaled rate 4.0 Hz, got ${outletsOut[1][0]}`);

// Verify paint() runs cleanly across all features
paint();

console.log("SUCCESS: All binary, patcher, 8-slot Mod/Rmt mapping, timeline sync, keyboard, and brush tests passed!");
