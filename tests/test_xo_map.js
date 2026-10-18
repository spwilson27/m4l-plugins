#!/usr/bin/env node
/**
 * Automated verification, regression & interaction test suite for devices/XO Sample Map.amxd
 * Run with: node tests/test_xo_map.js
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");

const ROOT_DIR = path.dirname(__dirname);
const AMXD_PATH = path.join(ROOT_DIR, "devices", "XO Sample Map.amxd");

// ============================================================================
// 1. Validate binary .amxd header, patcher topology & split presentation panels
// ============================================================================

const raw = fs.readFileSync(AMXD_PATH);
assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", "Invalid ampf header");
assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected 'aaaa' audio effect device type");
assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected 'ptch' chunk tag");

const ptchLen = raw.readUInt32LE(28);
assert.strictEqual(32 + ptchLen, raw.length, "ptch chunk length mismatch");

const doc = JSON.parse(raw.slice(32).toString("utf8"));
const p = doc.patcher;
assert.strictEqual(p.devicewidth, 680.0, "Expected devicewidth 680.0");
assert.strictEqual(p.openinpresentation, 1, "Expected openinpresentation = 1");
assert.deepStrictEqual(p.openrect, [0.0, 0.0, 680.0, 169.0], "Expected 680x169 openrect");

const boxMap = new Map();
for (const b of p.boxes) {
  const box = b.box;
  assert(!boxMap.has(box.id), `Duplicate box id: ${box.id}`);
  boxMap.set(box.id, box);
}

// Verify core objects exist, mono-safe right channel selector exists, and drop-folder / Simpler loader are removed
for (const reqId of [
  "obj-plugin", "obj-plugout", "obj-sfplay", "obj-r-chan-sel", "obj-speed-reg",
  "obj-node", "obj-minimap", "obj-map-window", "obj-open-map-btn",
  "obj-save-sample-btn", "obj-search-box", "obj-search-clear-btn",
  "obj-panel-left", "obj-panel-filters", "obj-panel-playback",
  "obj-scan-msg", "obj-scan-line", "obj-prep-playhead", "obj-key"
]) {
  assert(boxMap.has(reqId), `Missing required box: ${reqId}`);
}
assert(!boxMap.has("obj-drop-folder"), "Drop Sample Folder box should be removed");
assert(!boxMap.has("obj-load-simpler-btn"), "Simpler loader button should be removed");

// Verify Mono-to-Stereo audio routing on obj-sfplay and obj-r-chan-sel (selector~ 2 1)
const linesFromPort = (srcId, srcOut) =>
  p.lines
    .map((l) => l.patchline)
    .filter((pl) => pl.source[0] === srcId && pl.source[1] === srcOut)
    .map((pl) => `${pl.destination[0]}:${pl.destination[1]}`);

assert(
  linesFromPort("obj-sfplay", 0).includes("obj-env-mul-l:0") &&
  linesFromPort("obj-sfplay", 0).includes("obj-r-chan-sel:1"),
  "Regression: sfplay~ Left/Mono outlet 0 must feed BOTH Left multiplier AND selector~ inlet 1 for Mono-to-Stereo playback"
);
assert(
  linesFromPort("obj-sfplay", 1).includes("obj-r-chan-sel:2"),
  "Regression: sfplay~ Right outlet 1 must feed selector~ inlet 2 for true stereo playback"
);
assert(
  linesFromPort("obj-r-chan-sel", 0).includes("obj-env-mul-r:0"),
  "Regression: selector~ outlet 0 must feed Right channel multiplier"
);

// Verify Filters panel and Playback panel are visibly separate (non-overlapping)
const filterPanelRect = boxMap.get("obj-panel-filters").presentation_rect;
const playbackPanelRect = boxMap.get("obj-panel-playback").presentation_rect;
assert(
  filterPanelRect[0] + filterPanelRect[2] <= playbackPanelRect[0],
  "Expected FILTERS panel and PLAYBACK panel to be visibly separate"
);

// Regression Check: Verify obj-maxlen-dial and obj-tone-dial connect directly to strip_filter_*
const linesFrom = (srcId) =>
  p.lines.map((l) => l.patchline).filter((pl) => pl.source[0] === srcId).map((pl) => pl.destination[0]);

assert(
  linesFrom("obj-maxlen-dial").includes("obj-prep-sf-maxlen"),
  "Regression: obj-maxlen-dial must connect directly to obj-prep-sf-maxlen"
);
assert(
  !linesFrom("obj-prep-maxlen").includes("obj-prep-sf-maxlen"),
  "Regression: obj-prep-maxlen must NOT feed obj-prep-sf-maxlen"
);
assert(
  linesFrom("obj-tone-dial").includes("obj-prep-sf-tone"),
  "Regression: obj-tone-dial must connect directly to obj-prep-sf-tone"
);
assert(
  !linesFrom("obj-prep-tone").includes("obj-prep-sf-tone"),
  "Regression: obj-prep-tone must NOT feed obj-prep-sf-tone"
);

// Verify #0- instance isolation on all send/receive objects
const mapWinSub = boxMap.get("obj-map-window").patcher;
const subBoxes = mapWinSub.boxes.map((b) => b.box);
for (const b of [...boxMap.values(), ...subBoxes]) {
  if (b.maxclass === "newobj" && typeof b.text === "string") {
    if (/^(s|r|send|receive|buffer~)\s+/.test(b.text)) {
      assert(b.text.includes("#0-"), `Object ${b.id} (${b.text}) must use #0- prefix for instance isolation`);
    }
  }
}

// Verify no presentation widget overlaps v8ui or any other widget
const minimapRect = boxMap.get("obj-minimap").presentation_rect;
const presWidgets = [];
for (const [id, box] of boxMap.entries()) {
  if (box.maxclass === "panel" || !box.presentation || !box.presentation_rect || box.hidden) continue;
  presWidgets.push({ id, maxclass: box.maxclass, r: box.presentation_rect });
  if (id === "obj-minimap") continue;
  const r = box.presentation_rect;
  const overlapsX = r[0] < (minimapRect[0] + minimapRect[2]) && (r[0] + r[2]) > minimapRect[0];
  const overlapsY = r[1] < (minimapRect[1] + minimapRect[3]) && (r[1] + r[3]) > minimapRect[1];
  assert(!(overlapsX && overlapsY), `Presentation widget ${id} (${box.maxclass}) overlaps v8ui canvas!`);
}

for (let i = 0; i < presWidgets.length; i++) {
  for (let j = i + 1; j < presWidgets.length; j++) {
    const a = presWidgets[i];
    const b = presWidgets[j];
    const ox = a.r[0] < (b.r[0] + b.r[2]) && (a.r[0] + a.r[2]) > b.r[0];
    const oy = a.r[1] < (b.r[1] + b.r[3]) && (a.r[1] + a.r[3]) > b.r[1];
    assert(!(ox && oy), `Presentation widgets ${a.id} and ${b.id} overlap!`);
  }
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

// ============================================================================
// 2. Test Node Engine: Mono vs Stereo Playback, OS File Links, Edited Stereo WAV & Reorder/Delete
// ============================================================================

const nodeOutletLog = [];
global.__MAX_API_MOCK__ = {
  post: () => {},
  outlet: (...args) => { nodeOutletLog.push(args); },
  addHandler: () => {}
};

const engine = require("../src/xo_node_engine.js");

function makeSynthWav(freqHz, noiseAmt, durationSec, channels = 1, sampleRate = 44100) {
  const numFrames = Math.floor(durationSec * sampleRate);
  const dataSize = numFrames * channels * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, 4, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, 4, "ascii");
  buf.write("fmt ", 12, 4, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, 4, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numFrames; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * (noiseAmt > 0.5 ? 18 : 6));
    const tone = Math.sin(2 * Math.PI * freqHz * t);
    const n = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    const noise = (n - Math.floor(n)) * 2 - 1;
    const val = ((1 - noiseAmt) * tone + noiseAmt * noise) * env;
    const s16 = Math.max(-32768, Math.min(32767, Math.round(val * 30000)));
    for (let c = 0; c < channels; c++) {
      buf.writeInt16LE(s16, 44 + (i * channels + c) * 2);
    }
  }
  return buf;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xo_test_"));
const kickMonoPath = path.join(tmpDir, "Kick_Mono_808.wav");
const hatStereoPath = path.join(tmpDir, "Hihat_Stereo_Closed.wav");
const snareLongPath = path.join(tmpDir, "Snare_Long_Tail.wav");

fs.writeFileSync(kickMonoPath, makeSynthWav(55, 0.02, 0.50, 1));    // 1-channel Mono
fs.writeFileSync(hatStereoPath, makeSynthWav(8000, 0.92, 0.08, 2)); // 2-channel Stereo
fs.writeFileSync(snareLongPath, makeSynthWav(220, 0.55, 6.50, 1));  // 6500ms (> 5000ms for Infinite MaxLen test)

const scanRes = engine.scanDirectories([tmpDir], 50);
assert.strictEqual(scanRes.samples.length, 3, "Expected 3 scanned synthetic samples");
engine.engineState.samples = scanRes.samples;

const monoSampleIdx = scanRes.samples.findIndex((s) => s.name === "Kick_Mono_808");
const stereoSampleIdx = scanRes.samples.findIndex((s) => s.name === "Hihat_Stereo_Closed");
const longSampleIdx = scanRes.samples.findIndex((s) => s.name === "Snare_Long_Tail");

assert.strictEqual(scanRes.samples[monoSampleIdx].channels, 1, "Expected 1 channel detected for Mono kick");
assert.strictEqual(scanRes.samples[stereoSampleIdx].channels, 2, "Expected 2 channels detected for Stereo hat");

// Regression Test: Mono sample playback emits play_mono = 1 (duplicates L to R) & untouched unity envelope
nodeOutletLog.length = 0;
engine.engineState.decayMs = 2500;
engine.emitSelectedToMax(monoSampleIdx, true);
const playMonoMsg1 = nodeOutletLog.find((m) => m[0] === "play_mono");
const playEnvMsg1 = nodeOutletLog.find((m) => m[0] === "play_env");
assert.deepStrictEqual(playMonoMsg1, ["play_mono", 1], "Mono sample must emit play_mono 1 for dual-channel output");
assert.strictEqual(playEnvMsg1[3], 1.0, "Untrimmed sample must stay at unity gain 1.0 (no unwanted fade filter)");

// Stereo sample playback emits play_mono = 2 (true stereo R channel)
nodeOutletLog.length = 0;
engine.emitSelectedToMax(stereoSampleIdx, true);
const playMonoMsg2 = nodeOutletLog.find((m) => m[0] === "play_mono");
assert.deepStrictEqual(playMonoMsg2, ["play_mono", 2], "Stereo sample must emit play_mono 2 for true stereo output");

// Test MaxLen Infinite filter in Node engine (6500ms sample passes when maxLenMs = 5000 / Inf, blocked when 1000ms)
engine.engineState.maxLenMs = 5000; // Infinite
assert(engine.isSamplePassingFilters(scanRes.samples[longSampleIdx]), "6500ms sample must pass when MaxLen is at max (Infinite)");
engine.engineState.maxLenMs = 1000;
assert(!engine.isSamplePassingFilters(scanRes.samples[longSampleIdx]), "6500ms sample must be filtered out when MaxLen = 1000ms");
engine.engineState.maxLenMs = 5000;

// Test Edited WAV Re-Rendering outputs 2-channel stereo WAV with Pitch & Trim applied
const editedWavPath = engine.renderEditedSampleWav(kickMonoPath, { pitchSt: 12, decayMs: 120, gainDb: -3.0 }, tmpDir);
assert(editedWavPath && fs.existsSync(editedWavPath), "Expected rendered edited WAV file to exist on disk");
const editedBuf = fs.readFileSync(editedWavPath);
const decEdited = engine.parseAudioBuffer(editedBuf, editedBuf.length);
assert.strictEqual(decEdited.channels, 2, "Expected rendered edited WAV to be 2-channel stereo");
assert(Math.abs(decEdited.durationMs - 120) <= 5, `Expected trimmed duration ~120ms, got ${decEdited.durationMs}ms`);

// Test OS File Link for Raw & Edited Drag-Out + Reorder & Delete in Node engine
engine.clearSavedSamples();
engine.engineState.pitchSt = 5;
engine.engineState.decayMs = 180;
const savedA = engine.saveSampleToList(0);
engine.engineState.pitchSt = -4;
engine.engineState.decayMs = 90;
const savedB = engine.saveSampleToList(1);
engine.engineState.pitchSt = 0;
engine.engineState.decayMs = 400;
const savedC = engine.saveSampleToList(2);

assert(fs.existsSync(savedA.rawPath), "Expected OS file link for Raw sample to exist on disk");
assert(fs.existsSync(savedA.editedPath), "Expected rendered WAV for Edited sample to exist on disk");

// Reorder saved sample 2 to index 0
engine.reorderSavedSample(2, 0);
assert.strictEqual(engine.engineState.savedList[0].id, savedC.id, "Expected savedC moved to index 0 after reorder");

// Delete saved sample at index 1
engine.removeSavedSample(1);
assert.strictEqual(engine.engineState.savedList.length, 2, "Expected 2 saved samples after deleting index 1");

// ============================================================================
// 3. Test In-Device Mini Editor v8ui (src/xo_strip_ui.js)
//    - Audition Filters (50ms..Infinite, Tone, Search, Category)
//    - Scrollable Saved List, Selectable, Drag-to-Reorder, Delete ('x' & Backspace/Delete key)
//    - Hover arm_drag & 4 Drag-Out zones
// ============================================================================

const stripJs = boxMap.get("obj-minimap").textfile.text;
let stripOutlets = [[], []];
const paintCommands = [];

global.mgraphics = {
  size: [372, 134],
  init() {},
  redraw() {},
  set_source_rgba(r, g, b, a) { paintCommands.push({ op: "rgba", r, g, b, a }); },
  rectangle(x, y, w, h) { paintCommands.push({ op: "rect", x, y, w, h }); },
  rectangle_rounded(x, y, w, h) { paintCommands.push({ op: "rrect", x, y, w, h }); },
  fill() {},
  fill_preserve() {},
  stroke() { paintCommands.push({ op: "stroke" }); },
  set_line_width(w) { paintCommands.push({ op: "lw", w }); },
  move_to(x, y) { paintCommands.push({ op: "move_to", x, y }); },
  line_to(x, y) { paintCommands.push({ op: "line_to", x, y }); },
  curve_to() {},
  close_path() {},
  arc() {},
  select_font_face() {},
  set_font_size() {},
  show_text(t) { paintCommands.push({ op: "text", t }); }
};
global.inlets = 1;
global.outlets = 2;
global.outlet = (idx, ...args) => { stripOutlets[idx] = args; };
global.notifyclients = () => {};

eval(stripJs);

loadbang();
const lay = getLayout();
const pts = getPoints();

// --- Test A: MaxLen Filter from 50ms to Infinite ---
// Point 79 in default constellation has durationMs = 8500ms (> 5000ms)
strip_filter_maxlen(5000); // Infinite at max
assert(isPointVisible(pts[79]), "8500ms sample must be visible when MaxLen is at 5000 (Infinite)");
strip_filter_maxlen("inf");
assert(isPointVisible(pts[79]), "8500ms sample must be visible when MaxLen is 'inf'");
strip_filter_maxlen(250);
assert(!isPointVisible(pts[79]), "8500ms sample must be hidden when MaxLen = 250ms");
for (let i = 0; i < pts.length; i++) {
  if (isPointVisible(pts[i])) {
    assert(pts[i].durationMs <= 250, `Point ${i} (${pts[i].durationMs}ms) must be <= 250ms`);
  }
}
strip_filter_maxlen(5000);

// --- Test B: Scrollable, Selectable, Reorderable & Deletable Saved List ---
clearSavedList();
assert.strictEqual(getSavedList().length, 0);

// Save 6 samples (> savedMaxRows = 4) with distinct pitch settings
for (let i = 0; i < 6; i++) {
  set_pitch(i + 1);
  set_decay(200 + i * 50);
  key("S");
}
assert.strictEqual(getSavedList().length, 6, "Expected 6 saved samples");
assert.strictEqual(getSavedScrollOffset(), 2, "Expected auto-scroll to offset 2 when 6 items are saved");

// Scroll back to top (offset 0)
scrollSavedList(-2);
assert.strictEqual(getSavedScrollOffset(), 0, "Expected scroll offset 0 after scrolling up");

// Click row 0 title area to select it, then drag down to row 2 to reorder!
const rowTitleX = lay.savedX + 20;
const row0Y = lay.savedRowY0 + 8;
const row2Y = lay.savedRowY0 + 2 * lay.savedRowH + 8;
const firstItemPitch = getSavedList()[0].pitchSt;

onclick(rowTitleX, row0Y, 1, 0, 0, 0, 0, 0);
assert.strictEqual(getSelectedSavedIndex(), 0, "Expected row 0 selected on click");
ondrag(rowTitleX, row2Y, 1, 0, 0, 0, 0, 0);
ondrag(rowTitleX, row2Y, 0, 0, 0, 0, 0, 0);

assert.strictEqual(getSavedList()[2].pitchSt, firstItemPitch, "Expected dragged item moved from index 0 to index 2");
assert.strictEqual(getSelectedSavedIndex(), 2, "Expected selectedSavedIndex to follow reordered item to index 2");

// Delete selected item (index 2) via Backspace/Delete key
key("Backspace");
assert.strictEqual(getSavedList().length, 5, "Expected 5 saved samples after pressing Backspace");

// Delete row 0 via per-row [x] delete button
const delBtnX = lay.savedX + lay.savedW - 12;
onclick(delBtnX, row0Y, 1, 0, 0, 0, 0, 0);
assert.strictEqual(getSavedList().length, 4, "Expected 4 saved samples after clicking per-row [x] delete button");

// --- Test C: Hover Arming & Click Drag-Out for Raw vs Edited (Individual & All) ---
const rawZoneX = lay.savedX + lay.savedW - 46;
const editZoneX = lay.savedX + lay.savedW - 28;

// Hover over [R] on row 0 arms native OS file drag
onidle(rawZoneX, row0Y, 0, 0, 0, 0, 0, 0);
assert.deepStrictEqual(stripOutlets[0], ["arm_drag", "raw", 0], "Hovering [R] must arm native Raw OS drag");

// Hover over [E] on row 0 arms native Edited OS file drag
onidle(editZoneX, row0Y, 0, 0, 0, 0, 0, 0);
assert.deepStrictEqual(stripOutlets[0], ["arm_drag", "edited", 0], "Hovering [E] must arm native Edited OS drag");

// Click & drag on [R], [E], [Drag Raw], [Drag Edit]
onclick(rawZoneX, row0Y, 1, 0, 0, 0, 0, 0);
assert.deepStrictEqual(stripOutlets[0], ["drag_out", "raw", 0]);
ondrag(rawZoneX, row0Y, 0, 0, 0, 0, 0, 0);

onclick(editZoneX, row0Y, 1, 0, 0, 0, 0, 0);
assert.deepStrictEqual(stripOutlets[0], ["drag_out", "edited", 0]);
ondrag(editZoneX, row0Y, 0, 0, 0, 0, 0, 0);

onclick(lay.savedX + 20, lay.savedBottomY + 10, 1, 0, 0, 0, 0, 0);
assert.deepStrictEqual(stripOutlets[0], ["drag_out", "all_raw", -1]);
ondrag(lay.savedX + 20, lay.savedBottomY + 10, 0, 0, 0, 0, 0, 0);

onclick(lay.savedX + lay.savedW - 20, lay.savedBottomY + 10, 1, 0, 0, 0, 0, 0);
assert.deepStrictEqual(stripOutlets[0], ["drag_out", "all_edited", -1]);
ondrag(lay.savedX + lay.savedW - 20, lay.savedBottomY + 10, 0, 0, 0, 0, 0, 0);

// Verify paint() executes cleanly with scrollbar, selection, and waveform playhead
set_playhead(0.5);
paint();

// Cleanup temp directory
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("SUCCESS: All mono/stereo audio routing, OS file drag-out, scrollable/reorderable/deletable saved list, and Infinite MaxLen filter tests passed!");
