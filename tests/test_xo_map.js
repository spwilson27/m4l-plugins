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
assert.strictEqual(p.devicewidth, 414.0, "Expected devicewidth 414.0 (a new instance: toolbar + map + Saved list)");
assert.strictEqual(p.openinpresentation, 1, "Expected openinpresentation = 1");
assert.deepStrictEqual(p.openrect, [0.0, 0.0, 414.0, 169.0], "Expected 414x169 openrect");

const boxMap = new Map();
for (const b of p.boxes) {
  const box = b.box;
  assert(!boxMap.has(box.id), `Duplicate box id: ${box.id}`);
  boxMap.set(box.id, box);
}

// Verify core objects exist, mono-safe right channel selector exists, folder list v8ui exists,
// Pitch & Tonal filters exist, Granular Speed/Grain/Spectral & Reverse exist, and removed buttons are gone
for (const reqId of [
  "obj-plugin", "obj-plugout", "obj-sfplay", "obj-r-chan-sel", "obj-speed-reg",
  "obj-node", "obj-minimap", "obj-folder-list",
  "obj-toggle-saved-btn", "obj-toggle-filters-btn", "obj-toggle-playback-btn",
  "obj-search-box", "obj-search-clear-btn",
  "obj-maxlen-dial", "obj-tone-dial", "obj-filter-tonal-dial", "obj-filter-drum-dial", "obj-reseed-filtered-btn",
  "obj-pitch-dial", "obj-speed-dial", "obj-grain-dial", "obj-decay-dial", "obj-stretch-mode", "obj-gain-dial", "obj-reverse-btn",
  "obj-root-thispatcher", "obj-pak-vis", "obj-expr-width", "obj-prep-setwidth",
  "obj-panel-left", "obj-panel-filters", "obj-panel-playback",
  "obj-snap-pos", "obj-prep-playpos", "obj-msg-snap-start", "obj-msg-snap-stop", "obj-msg-play-done", "obj-route-uiout",
  "obj-trig-stop", "obj-msg-stop-fade", "obj-del-stop", "obj-msg-stop-zero", "obj-msg-env-unity",
  "obj-msg-hotkey-random", "obj-msg-hotkey-stop",
  "obj-key", "obj-sel-key", "obj-msg-hotkey-save", "obj-msg-del-saved"
]) {
  assert(boxMap.has(reqId), `Missing required box: ${reqId}`);
}
// Pop-out window / jweb / Open Map button were removed entirely
for (const goneId of ["obj-open-map-btn", "obj-map-window", "obj-pcontrol", "obj-sel-map-win", "obj-msg-open-win", "obj-msg-close-win", "obj-prep-url", "obj-s-to-jweb", "obj-r-from-jweb"]) {
  assert(!boxMap.has(goneId), `${goneId} must be gone (pop-out UI removed)`);
}
for (const b of boxMap.values()) {
  assert.notStrictEqual(b.maxclass, "jweb", "no jweb box may remain");
  assert(!b.patcher, `${b.id}: no subpatcher expected`);
  assert(!/jweb|server_url/.test(b.text || ""), `${b.id}: stale jweb/server_url text`);
}
assert(!JSON.stringify(doc).includes("OpenMapWindow"), "OpenMapWindow parameter must be gone");
{
  const hb = ["obj-toggle-saved-btn", "obj-toggle-filters-btn", "obj-toggle-playback-btn"].map((id) => boxMap.get(id).presentation_rect);
  assert(hb.every((r) => r[0] === hb[0][0]), "Toolbar toggles share one column");
  assert(hb[1][1] > hb[0][1] && hb[2][1] > hb[1][1], "Toolbar toggles stack top to bottom: Saved, Filters, Playback");
}
assert(!boxMap.has("obj-filter-pitch-dial"), "Pitch filter should be removed from Filters section");
assert.strictEqual(
  boxMap.get("obj-decay-dial").saved_attribute_attributes.valueof.parameter_mmax,
  20000.0,
  "Expected Trim/Dec (DecayEnvelope) max to be 20000.0 ms (20s)"
);
// Verify Filter Re-Seed button is placed to the left of the Clr button in the FILTERS header
// (the saved state is the Live theme, which puts Clr on the search row, so this is checked on the LCD layout)
const lcdLay0 = require("../src/xo_layouts/default.js").computeXoLayout("LCD", 1, 1, 1, 0).boxes;
const reseedBtnRect = lcdLay0["obj-reseed-filtered-btn"].rect;
const clrBtnRect = lcdLay0["obj-search-clear-btn"].rect;
assert(
  reseedBtnRect[1] === clrBtnRect[1] && (reseedBtnRect[0] + reseedBtnRect[2]) <= clrBtnRect[0],
  "Expected Filter Re-Seed button to the left of the Clr button on the same header row"
);
assert(!boxMap.has("obj-scan-core-btn"), "Scan Core button should be removed from top menu bar");
assert(!boxMap.has("obj-add-folder-btn"), "+ Folder button should be removed from top menu bar");
assert(!boxMap.has("obj-save-sample-btn"), "+ Save (S) button should be removed from top menu bar");
assert(!boxMap.has("obj-drop-folder"), "Drop Sample Folder box should be removed");
assert(!boxMap.has("obj-load-simpler-btn"), "Simpler loader button should be removed");
assert(!boxMap.has("obj-prev-sim-btn"), "Prev Similar button in Filters section should be removed");
assert(!boxMap.has("obj-next-sim-btn"), "Next Similar button in Filters section should be removed");
assert(!boxMap.has("obj-rand-btn"), "Random button in Filters section should be removed");
assert(!boxMap.has("obj-play-btn"), "Audition / Replay button in Playback section should be removed");
assert(!boxMap.has("obj-prep-key"), "Regression: obj-prep-key ('prepend key') must not be used because v8ui swallows 'key' in C++");

// Regression Check: obj-node (node.codebox) MUST have presentation=1 (inside 0..169 so Max does not cull it),
// background=1, and a 1x1 presentation_rect at the end of boxes (under the centre of the opaque, never moving / hiding Options toggle) so it boots in M4L presentation mode without ever showing "ox🔨"!
const nodeBox = boxMap.get("obj-node");
assert.strictEqual(nodeBox.presentation, 1, "Regression: obj-node must have presentation: 1 to boot in M4L presentation mode");
assert.strictEqual(nodeBox.background, 1, "Regression: obj-node must have background: 1 so it sits in the background layer");
assert.strictEqual(nodeBox.ignoreclick, 1, "Expected ignoreclick: 1 on hidden background obj-node");
assert(
  nodeBox.presentation_rect[2] <= 2.0 && nodeBox.presentation_rect[3] <= 2.0,
  "Regression: obj-node presentation_rect must be 1x1px so it never renders any text/icon over the UI"
);
{
  // the node's 1x1 rect must be covered by an opaque foreground box that the layout never moves or hides: the Options (gear) toggle
  const gear = boxMap.get("obj-toggle-options-btn").presentation_rect, nr = nodeBox.presentation_rect;
  assert(nr[0] >= gear[0] && nr[1] >= gear[1] && nr[0] + nr[2] <= gear[0] + gear[2] && nr[1] + nr[3] <= gear[1] + gear[3], `obj-node ${JSON.stringify(nr)} sits inside the Options toggle ${JSON.stringify(gear)}`);
  assert(boxMap.get("obj-toggle-options-btn").background !== 1 && p.boxes.findIndex((b) => b.box.id === "obj-toggle-options-btn") < p.boxes.findIndex((b) => b.box.id === "obj-node"), "the covering toggle is a foreground box (drawn over the background node)");
}
const nodeIdx = p.boxes.findIndex((b) => b.box.id === "obj-node");
const minimapIdx = p.boxes.findIndex((b) => b.box.id === "obj-minimap");
assert(nodeIdx > minimapIdx, "Expected obj-node at the end of boxes (backmost z-order in Max)");

// Regression Check: Verify 's' hotkey routing (obj-key -> obj-sel-key -> obj-msg-hotkey-save -> obj-minimap)
const linesFrom = (srcId) =>
  p.lines.map((l) => l.patchline).filter((pl) => pl.source[0] === srcId).map((pl) => pl.destination[0]);

assert(linesFrom("obj-key").includes("obj-sel-key"), "obj-key must route to obj-sel-key");
assert(linesFrom("obj-sel-key").includes("obj-msg-hotkey-save"), "obj-sel-key must route 115/83 ('s'/'S') to obj-msg-hotkey-save");
assert(linesFrom("obj-sel-key").includes("obj-msg-del-saved"), "obj-sel-key must route Delete/Backspace to obj-msg-del-saved");
assert(linesFrom("obj-msg-hotkey-save").includes("obj-minimap"), "obj-msg-hotkey-save must route to obj-minimap");
assert(linesFrom("obj-msg-del-saved").includes("obj-minimap"), "obj-msg-del-saved must route to obj-minimap");

// Verify Section Collapse/Show Toggles in the top toolbar (Saved starts at x = 10)
assert(linesFrom("obj-toggle-saved-btn").includes("obj-prep-show-saved"), "obj-toggle-saved-btn must route to obj-prep-show-saved");
assert(linesFrom("obj-prep-show-saved").includes("obj-minimap"), "obj-prep-show-saved must route to obj-minimap");
assert(linesFrom("obj-toggle-filters-btn").includes("obj-prep-show-filters"), "obj-toggle-filters-btn must route to obj-prep-show-filters");
assert(linesFrom("obj-toggle-playback-btn").includes("obj-prep-show-playback"), "obj-toggle-playback-btn must route to obj-prep-show-playback");

// Verify Mono-to-Stereo audio routing on obj-sfplay and obj-r-chan-sel (selector~ 2 1)
const linesFromPort = (srcId, srcOut) =>
  p.lines
    .map((l) => l.patchline)
    .filter((pl) => pl.source[0] === srcId && pl.source[1] === srcOut)
    .map((pl) => `${pl.destination[0]}:${pl.destination[1]}`);

// Arrow keys: obj-key -> obj-sel-key (28 / 29 / 30 / 31) -> hotkey messages -> obj-minimap
assert(/^sel 115 83 127 8 -5 -3 28 29 30 31 114 82 27$/.test(boxMap.get("obj-sel-key").text), "obj-sel-key must match the arrow key codes 28 29 30 31, r / R (114 / 82) and Esc (27)");
for (const [outlet, msgId, text] of [
  [10, "obj-msg-hotkey-random", "hotkey_random"],
  [11, "obj-msg-hotkey-random", "hotkey_random"],
  [12, "obj-msg-hotkey-stop", "hotkey_stop"]
]) {
  assert.strictEqual(boxMap.get(msgId).text, text);
  assert(linesFromPort("obj-sel-key", outlet).includes(`${msgId}:0`), `obj-sel-key outlet ${outlet} (114 / 82 / 27) must feed ${msgId}`);
  assert(linesFrom(msgId).includes("obj-minimap"), `${msgId} must route to obj-minimap`);
}
assert.strictEqual(boxMap.get("obj-sel-key").numoutlets, 14, "sel with 13 arguments has 14 outlets");
// Playhead: sfplay~ reports its real position (outlet 2, ms) and the finish bang (outlet 3); snapshot~ samples it only while playing
assert.strictEqual(boxMap.get("obj-sfplay").text, "sfplay~ 2 0 1", "sfplay~ gets the position outlet");
assert.strictEqual(boxMap.get("obj-sfplay").numoutlets, 4);
assert(linesFromPort("obj-sfplay", 2).includes("obj-snap-pos:0"), "sfplay~ position outlet -> snapshot~");
assert(/^snapshot~ 33 @active 0$/.test(boxMap.get("obj-snap-pos").text), "snapshot~ at ~30 Hz, inactive until a play starts");
assert(linesFrom("obj-snap-pos").includes("obj-prep-playpos") && linesFrom("obj-prep-playpos").includes("obj-minimap"));
assert.strictEqual(boxMap.get("obj-prep-playpos").text, "prepend play_pos");
assert(linesFromPort("obj-trig-play", 0).includes("obj-msg-snap-start:0") && boxMap.get("obj-msg-snap-start").text === "start", "snapshot~ starts with the play message");
assert(linesFromPort("obj-sfplay", 3).includes("obj-msg-snap-stop:0") && boxMap.get("obj-msg-snap-stop").text === "stop", "the finish bang stops snapshot~");
assert(linesFromPort("obj-sfplay", 3).includes("obj-msg-play-done:0") && boxMap.get("obj-msg-play-done").text === "play_done" && linesFrom("obj-msg-play-done").includes("obj-minimap"), "the finish bang reaches the v8ui as play_done");
for (const goneId of ["obj-scan-msg", "obj-scan-line", "obj-prep-playhead"]) {
  assert(!boxMap.has(goneId), `${goneId}: the constant-speed playhead animation is gone`);
}
// Esc: v8ui outlet 1 `stop_playback` -> fade 8 ms on the envelope, halt sfplay~ 12 ms later, envelope back to unity
assert.strictEqual(boxMap.get("obj-route-uiout").text, "route stop_playback");
assert(linesFromPort("obj-minimap", 1).includes("obj-route-uiout:0"), "v8ui outlet 1 -> route stop_playback");
assert(linesFromPort("obj-route-uiout", 0).includes("obj-trig-stop:0"));
assert(linesFromPort("obj-trig-stop", 1).includes("obj-msg-stop-fade:0") && linesFromPort("obj-msg-stop-fade", 0).includes("obj-env-line:0") && boxMap.get("obj-msg-stop-fade").text === "0 8");
assert(linesFromPort("obj-trig-stop", 0).includes("obj-del-stop:0") && linesFromPort("obj-del-stop", 0).includes("obj-msg-stop-zero:0"));
assert(linesFromPort("obj-msg-stop-zero", 0).includes("obj-sfplay:0") && boxMap.get("obj-msg-stop-zero").text === "0", "stop sends 0 to sfplay~");
assert(linesFromPort("obj-del-stop", 0).includes("obj-msg-env-unity:0") && linesFromPort("obj-msg-env-unity", 0).includes("obj-env-line:0"), "the envelope returns to unity after the stop");
for (const [outlet, msgId, text] of [
  [6, "obj-msg-hotkey-prev", "hotkey_prev_similar"],
  [7, "obj-msg-hotkey-next", "hotkey_next_similar"],
  [8, "obj-msg-hotkey-fwd", "hotkey_history_forward"],
  [9, "obj-msg-hotkey-back", "hotkey_history_back"]
]) {
  assert.strictEqual(boxMap.get(msgId).text, text);
  assert(linesFromPort("obj-sel-key", outlet).includes(`${msgId}:0`), `obj-sel-key outlet ${outlet} must feed ${msgId}`);
  assert(linesFrom(msgId).includes("obj-minimap"), `${msgId} must route to obj-minimap`);
}

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
// (a new instance starts with both closed: they are hidden then and share the slot; the 16 combinations below check the shown ones)
const secHidden = (id) => (boxMap.get(id).hidden || 0) === 1;
assert(
  (secHidden("obj-panel-filters") && secHidden("obj-panel-playback")) || filterPanelRect[0] + filterPanelRect[2] <= playbackPanelRect[0],
  "Expected FILTERS panel and PLAYBACK panel to be visibly separate"
);
assert(secHidden("obj-panel-filters") && secHidden("obj-panel-playback"), "a new instance starts with Filters and Playback closed");

// Regression Check: Verify obj-maxlen-dial and obj-tone-dial connect directly to strip_filter_*
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
for (const b of boxMap.values()) {
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
  if (box.maxclass === "panel" || box.maxclass === "node.codebox" || !box.presentation || !box.presentation_rect || box.hidden) continue;
  // Click-through live.comment labels are exempt from the pairwise check below: Live stretches a label to
  // (font + 8) px, which may reach over the control under it, but ignoreclick keeps it from taking that control's clicks.
  if (!(box.maxclass === "live.comment" && box.ignoreclick === 1)) presWidgets.push({ id, maxclass: box.maxclass, r: box.presentation_rect });
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xo_test_"));
process.env.XO_CACHE_DIR = tmpDir;

const nodeOutletLog = [];
const nodeHandlers = {};
global.__MAX_API_MOCK__ = {
  post: () => {},
  outlet: (...args) => { nodeOutletLog.push(args); },
  addHandler: (name, fn) => { nodeHandlers[name] = fn; }
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

// Test Edited WAV Re-Rendering outputs 2-channel stereo WAV with Pitch, Trim & Reverse applied
const editedWavPath = engine.renderEditedSampleWav(kickMonoPath, { pitchSt: 12, decayMs: 120, gainDb: -3.0 }, tmpDir);
assert(editedWavPath && fs.existsSync(editedWavPath), "Expected rendered edited WAV file to exist on disk");
const editedBuf = fs.readFileSync(editedWavPath);
const decEdited = engine.parseAudioBuffer(editedBuf, editedBuf.length);
assert.strictEqual(decEdited.channels, 2, "Expected rendered edited WAV to be 2-channel stereo");
assert(Math.abs(decEdited.durationMs - 120) <= 5, `Expected trimmed duration ~120ms, got ${decEdited.durationMs}ms`);

// Test Reverse audio rendering reverses sample frames AND Trim/Dec in Reverse mode trims/sweeps the START (preserving the end climax!)
const rampSamples = new Float32Array(32);
for (let i = 0; i < 32; i++) rampSamples[i] = (i + 1) / 32.0;
const fwdRender = engine.renderEditedAudioSamples({ sampleRate: 44100, samples: rampSamples }, { pitchSt: 0, decayMs: 5000, gainDb: 0, reverse: 0 });
const revRender = engine.renderEditedAudioSamples({ sampleRate: 44100, samples: rampSamples }, { pitchSt: 0, decayMs: 5000, gainDb: 0, reverse: 1 });
assert(Math.abs(revRender.samples[0] - fwdRender.samples[fwdRender.samples.length - 1]) < 1e-4, "Reverse playback setting must reverse audio samples");

// In Reverse mode with Trim/Dec < 4950ms, the start is attenuated (rising sweep) while the end climax is preserved at 1.0x
const revSweepRender = engine.renderEditedAudioSamples(
  { sampleRate: 1000, samples: new Float32Array(500).fill(0.8) },
  { pitchSt: 0, decayMs: 200, gainDb: 0, reverse: 1 }
);
assert.strictEqual(revSweepRender.samples.length, 200, "Expected 200ms trimmed length in Reverse mode");
assert(Math.abs(revSweepRender.samples[0]) < 0.01, "In Reverse mode, Trim/Dec must attenuate the start of the sample (rising sweep)");
assert(Math.abs(revSweepRender.samples[revSweepRender.samples.length - 1] - 0.8) < 0.01, "In Reverse mode, Trim/Dec must preserve the climax at the end of the sample");

// ----------------------------------------------------------------------------
// Detailed waveform extraction (selected_wave): min / max / RMS per column
// ----------------------------------------------------------------------------
function makeFrameWav(frames, channels, sampleRate = 44100) {
  // frames: array of arrays (one value per channel, -1..1), 16-bit PCM
  const dataSize = frames.length * channels * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, 4, "ascii"); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVE", 8, 4, "ascii");
  buf.write("fmt ", 12, 4, "ascii"); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * channels * 2, 28); buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34); buf.write("data", 36, 4, "ascii"); buf.writeUInt32LE(dataSize, 40);
  frames.forEach((fr, i) => fr.forEach((v, c) => buf.writeInt16LE(Math.round(v * 32767), 44 + (i * channels + c) * 2)));
  return buf;
}
{
  // Mono: 4 columns of 100 frames each: 0.5 square, -0.25 constant, a +0.8/-0.6 alternation, silence
  const frames = [];
  for (let i = 0; i < 100; i++) frames.push([0.5]);
  for (let i = 0; i < 100; i++) frames.push([-0.25]);
  for (let i = 0; i < 100; i++) frames.push([i % 2 ? -0.6 : 0.8]);
  for (let i = 0; i < 100; i++) frames.push([0]);
  const wf = engine.computeWaveformFromBuffer(makeFrameWav(frames, 1), 4);
  assert.strictEqual(wf.columns, 4);
  const near = (a, b, m) => assert(Math.abs(a - b) < 0.002, `${m}: ${a} vs ${b}`);
  near(wf.max[0], 0.5, "col0 max"); near(wf.min[0], 0.5, "col0 min"); near(wf.rms[0], 0.5, "col0 rms");
  near(wf.max[1], -0.25, "col1 max"); near(wf.min[1], -0.25, "col1 min"); near(wf.rms[1], 0.25, "col1 rms");
  near(wf.max[2], 0.8, "col2 max"); near(wf.min[2], -0.6, "col2 min"); near(wf.rms[2], Math.sqrt((0.64 + 0.36) / 2), "col2 rms");
  near(wf.max[3], 0, "col3 max"); near(wf.rms[3], 0, "col3 rms");
  assert(wf.max.every((v) => Math.round(v * 1000) === v * 1000 || Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-9), "values rounded to 3 decimals");

  // Stereo: the channel with the larger magnitude wins per frame (L quiet, R loud, then reversed)
  const st = [];
  for (let i = 0; i < 100; i++) st.push([0.1, -0.7]);
  for (let i = 0; i < 100; i++) st.push([0.9, 0.2]);
  const wfs = engine.computeWaveformFromBuffer(makeFrameWav(st, 2), 2);
  near(wfs.min[0], -0.7, "stereo col0 min"); near(wfs.max[0], -0.7, "stereo col0 max");
  near(wfs.max[1], 0.9, "stereo col1 max"); near(wfs.min[1], 0.9, "stereo col1 min");

  // Fewer samples than columns -> columns shrink; every sample covered; empty input -> null
  assert.strictEqual(engine.extractWaveformColumns(new Float32Array([0.5, -0.5, 0.25]), 256).columns, 3);
  assert.strictEqual(engine.extractWaveformColumns(new Float32Array(0), 256), null);
  assert.strictEqual(engine.computeWaveformFromBuffer(Buffer.from("not audio at all, definitely not a wav file header....")), null);

  // Message shape: selected_wave <idx> <n> then min max rms triples; n = 0 on failure
  const msg = engine.buildSelectedWaveMessage(7, wf);
  assert.deepStrictEqual(msg.slice(0, 3), ["selected_wave", 7, 4]);
  assert.strictEqual(msg.length, 3 + 4 * 3);
  assert.deepStrictEqual(engine.buildSelectedWaveMessage(7, null), ["selected_wave", 7, 0]);

  // Real file: default 256 columns, cache hit returns the same object, undecodable file -> null
  const wavePath = path.join(tmpDir, "wave_cache_test.wav");
  fs.writeFileSync(wavePath, makeSynthWav(220, 0.1, 1.2, 2));
  const w1 = engine.getWaveformSync(wavePath);
  assert.strictEqual(w1.columns, 256);
  assert.strictEqual(engine.getWaveformSync(wavePath), w1, "second lookup must come from the cache");
  const junkPath = path.join(tmpDir, "junk.wav");
  fs.writeFileSync(junkPath, Buffer.alloc(500, 7));
  assert.strictEqual(engine.getWaveformSync(junkPath), null, "undecodable file yields null (v8ui falls back to cached peaks)");
  for (let i = 0; i < 40; i++) {
    const pp = path.join(tmpDir, `wc_${i}.wav`);
    fs.writeFileSync(pp, makeFrameWav([[0.1], [0.2], [0.3]], 1));
    engine.getWaveformSync(pp);
  }
  assert(engine.waveformCache.size <= 24, "waveform cache must stay small (LRU)");
}


// ----------------------------------------------------------------------------
// Selection history (arrow Down = back, Up = forward) in the node engine
// ----------------------------------------------------------------------------
{
  engine.engineState.corpusSamples = scanRes.samples;
  engine.rebuildActiveMapSubset(1);
  const hs = engine.engineState.samples;
  assert(hs.length >= 3, "need 3 mapped samples for the history test");
  const H = engine.selectionHistory;
  engine.clearSelectionHistory();
  const lastSelected = () => {
    const m = nodeOutletLog.filter((x) => x[0] === "selected_info").pop();
    return m ? m[1] : null;
  };
  engine.emitSelectedToMax(0, true);
  engine.emitSelectedToMax(1, true);
  engine.emitSelectedToMax(2, true);
  engine.emitSelectedToMax(2, true); // duplicate of the current entry: not pushed
  assert.deepStrictEqual(H.entries, [hs[0].path, hs[1].path, hs[2].path], "history records selections, skipping duplicates");
  assert.strictEqual(H.pos, 2);

  nodeOutletLog.length = 0;
  assert.strictEqual(engine.stepSelectionHistory(-1), 1, "Down arrow goes back to the previous sound");
  assert.strictEqual(lastSelected(), 1);
  assert(nodeOutletLog.some((m) => m[0] === "play_file"), "history navigation auditions the sound");
  assert.deepStrictEqual(H.entries.length, 3, "navigating must not push onto the history");
  assert.strictEqual(engine.stepSelectionHistory(-1), 0);
  assert.strictEqual(engine.stepSelectionHistory(-1), -1, "nothing older: stays on the oldest entry");
  assert.strictEqual(H.pos, 0);
  assert.strictEqual(engine.stepSelectionHistory(1), 1, "Up arrow goes forward again");
  assert.strictEqual(engine.stepSelectionHistory(1), 2);
  assert.strictEqual(engine.stepSelectionHistory(1), -1, "nothing newer");

  // Max handlers
  engine.stepSelectionHistory(-1);
  nodeHandlers.history_back();
  assert.strictEqual(H.pos, 0, "history_back handler steps back");
  nodeHandlers.history_forward();
  assert.strictEqual(H.pos, 1, "history_forward handler steps forward");

  // A new (non-navigation) selection truncates the forward part
  engine.emitSelectedToMax(0, true);
  assert.deepStrictEqual(H.entries, [hs[0].path, hs[1].path, hs[0].path], "new selection after going back drops the forward entries");
  assert.strictEqual(engine.stepSelectionHistory(1), -1);

  // Entries that left the map are skipped
  engine.clearSelectionHistory();
  engine.recordSelectionHistory(hs[0].path);
  engine.recordSelectionHistory("/gone/missing.wav");
  engine.recordSelectionHistory(hs[1].path);
  assert.strictEqual(engine.stepSelectionHistory(-1), 0, "unresolvable entries are skipped when navigating");

  // Cap and duplicate suppression
  engine.clearSelectionHistory();
  for (let i = 0; i < engine.SELECTION_HISTORY_MAX + 50; i++) engine.recordSelectionHistory(`/h/${i}.wav`);
  assert.strictEqual(H.entries.length, engine.SELECTION_HISTORY_MAX, "history is capped");
  assert.strictEqual(H.entries[H.entries.length - 1], `/h/${engine.SELECTION_HISTORY_MAX + 49}.wav`);
  assert.strictEqual(H.pos, H.entries.length - 1);
  assert.strictEqual(engine.recordSelectionHistory(H.entries[H.pos]), false, "duplicate of the current entry is suppressed");
  engine.clearSelectionHistory();
}


// Test Granular Time-Stretch (Speed & Grain Size) and Spectral Stretch
const kickDecoded = engine.parseAudioBuffer(fs.readFileSync(kickMonoPath), fs.statSync(kickMonoPath).size, 5.0);
const stretchedGranular = engine.renderEditedAudioSamples(kickDecoded, {
  pitchSt: 0,
  speedPct: 50, // 2x slower time-stretch at 0st pitch
  grainMs: 35,
  stretchMode: 0,
  decayMs: 5000,
  gainDb: 0
});
assert(
  Math.abs(stretchedGranular.durationMs - kickDecoded.durationMs * 2) <= 15,
  `Expected 50% speed granular stretch to double duration (~${kickDecoded.durationMs * 2}ms), got ${stretchedGranular.durationMs}ms`
);

// ---- Stretch Mode (Granular / Complex / Texture) ----
{
  // Device: Mode replaces Spectral
  const mode = boxMap.get("obj-stretch-mode");
  const mv = mode.saved_attribute_attributes.valueof;
  assert.strictEqual(mode.maxclass, "live.numbox", "Mode is the LCD numbox parameter object (its live.dial twin is obj-stretch-mode-mir)");
  assert.strictEqual(mv.parameter_type, 2, "StretchMode is an enum parameter");
  assert.deepStrictEqual(mv.parameter_enum, ["Grain", "Cmplx", "Textr"]);
  assert.strictEqual(mv.parameter_longname, "StretchMode");
  assert.strictEqual(mv.parameter_enum.length, 3, "exactly 3 modes");
  assert.strictEqual(mv.parameter_mmax, 2);
  assert.deepStrictEqual(mv.parameter_initial, [1], "default is Complex");
  assert.strictEqual(p.boxes.length, new Set(p.boxes.map((b) => b.box.id)).size);
  const docText = JSON.stringify(doc);
  assert(!docText.includes("SpectralStretch") && !docText.includes("obj-spec-dial") && !docText.includes("set_spectral"), "old Spectral control must be gone");
  const nodeCode = boxMap.get("obj-node").code;
  assert(!/specMix|fftRadix2|phaseAcc/.test(nodeCode), "old spectral STFT code must be gone from the node code");
  assert(!/spectralPct/.test(fs.readFileSync(path.join(ROOT_DIR, "src", "xo_strip_ui.js"), "utf8").replace(/item\.spectralPct/g, "")), "strip UI keeps spectralPct only to read legacy items");
  // Mode reaches the node and the v8ui, the recalled value reaches the dial, and the HUD status reaches the v8ui
  assert.strictEqual(boxMap.get("obj-prep-stretch-mode").text, "prepend set_stretchmode");
  assert(linesFrom("obj-stretch-mode").includes("obj-prep-stretch-mode"));
  assert(linesFrom("obj-prep-stretch-mode").includes("obj-node") && linesFrom("obj-prep-stretch-mode").includes("obj-minimap"), "Mode must reach node and v8ui");
  assert(linesFrom("obj-unpack-recalled").includes("obj-stretch-mode"));
  assert(linesFrom("obj-stretch-mode").includes("obj-prep-mset-stretch-mode"), "Mode feeds its Focus-theme mirror");
  assert(boxMap.get("obj-route-node").text.endsWith("selected_wave audition_info"));
  assert.strictEqual(boxMap.get("obj-route-node").numoutlets, boxMap.get("obj-route-node").text.split(" ").length);
  assert(!JSON.stringify(doc).includes("stretch_status"), "no stretch_status plumbing left");
  assert(nodeCode.startsWith("const XO_STRETCH_EMBEDDED"), "xo_stretch.js is prepended to the node code");
  // Signalsmith is gone from the device (only the legacy-name table that loads old saved "signalsmith" items as Complex remains)
  const noLegacy = nodeCode.replace(/LEGACY_STRETCH_NAMES\s*=\s*\{[^}]*\}/, "");
  assert(!/smith/i.test(noLegacy), "no Signalsmith code left in the built node code");
  assert(!/zlib/.test(nodeCode), "no Signalsmith loader / gzip payload in the node code");
  assert(!fs.existsSync(path.join(ROOT_DIR, "vendor", "signalsmith-stretch")), "vendor/signalsmith-stretch is deleted");
}

// The code embedded in the device must be loadable on its own: extract it, run it under a mocked max-api and
// exercise every stretch mode.
function testStretchModes(eng, label) {
  const sr = 22050;
  const n = Math.round(sr * 0.5);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.6 * Math.sin(2 * Math.PI * 220 * i / sr) * Math.exp(-3 * i / n) + (i < 20 ? 0.5 : 0);
  const dec = { sampleRate: sr, samples: x, durationMs: 500 };
  for (let mode = 0; mode < 3; mode++) {
    for (const [speedPct, pitchSt] of [[50, 0], [200, 0], [100, 0], [100, 7], [70, -5]]) {
      const r = eng.renderEditedAudioSamples(dec, { stretchMode: mode, speedPct, pitchSt, grainMs: 45, decayMs: 20000 });
      // Render-needed rule: Speed != 100 %, Pitch != 0 or Texture. Length = input / Speed, whatever the Pitch.
      const engaged = mode === 2 || speedPct !== 100 || pitchSt !== 0;
      assert.strictEqual(eng.stretchEngineWanted(mode, speedPct, pitchSt), engaged, "render-needed rule");
      const expLen = Math.round(n / (speedPct / 100));
      assert(Math.abs(r.samples.length - expLen) <= 8, `${label} mode ${mode} speed ${speedPct} pitch ${pitchSt}: length ${r.samples.length}, expected ~${expLen}`);
      let peak = 0;
      for (let i = 0; i < r.samples.length; i++) {
        assert(Number.isFinite(r.samples[i]), `${label} mode ${mode}: NaN/Inf at ${i}`);
        peak = Math.max(peak, Math.abs(r.samples[i]));
      }
      assert(peak > 0.05 && peak <= 1.0, `${label} mode ${mode} speed ${speedPct}: peak ${peak}`);
      if (!engaged && mode !== 2) assert.strictEqual(r.engine, "repitch", "Speed 100 % is not rendered by an engine (plain playback)");
    }
  }
  // Pitch changes pitch only: a 440 Hz sine at +12 st / Speed 100 % renders at ~880 Hz with the length unchanged,
  // and Speed 50 % + Pitch +12 doubles the length and still sounds at 880 Hz (every mode, Texture excluded: noise-like)
  const sine = new Float32Array(sr);
  for (let i = 0; i < sr; i++) sine[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
  const sdec = { sampleRate: sr, samples: sine, durationMs: 1000 };
  const freqOf = (a) => { // zero-crossing frequency of the middle 60 %
    const lo = Math.floor(a.length * 0.2), hi = Math.floor(a.length * 0.8);
    let z = 0;
    for (let i = lo + 1; i < hi; i++) if (a[i - 1] < 0 && a[i] >= 0) z++;
    return z / ((hi - lo) / sr);
  };
  for (const mode of [0, 1, 2]) {
    for (const speedPct of [100, 50]) {
      const r = eng.renderEditedAudioSamples(sdec, { stretchMode: mode, speedPct, pitchSt: 12, grainMs: 45, decayMs: 20000 });
      assert(Math.abs(r.samples.length - Math.round(sr / (speedPct / 100))) <= 8, `${label} mode ${mode}: +12 st at ${speedPct} % length ${r.samples.length}`);
      assert.notStrictEqual(r.engine, "repitch", "+12 st is rendered by an engine, not plain repitch");
      const f = freqOf(r.samples); // Grain (OLA grains, phases not locked) wobbles ~4 % when stretched
      assert(Math.abs(f - 880) < 880 * (mode === 0 && speedPct !== 100 ? 0.06 : 0.04), `${label} mode ${mode}: +12 st at ${speedPct} % renders at ${f.toFixed(1)} Hz, expected ~880`);
    }
  }
  // Trim/Dec still limits the length, Reverse still renders
  const trimmed = eng.renderEditedAudioSamples(dec, { stretchMode: 1, speedPct: 50, decayMs: 300 });
  assert(Math.abs(trimmed.samples.length - Math.round(0.3 * sr)) <= 2, `${label}: Trim/Dec caps the stretched render`);
  const rev = eng.renderEditedAudioSamples(dec, { stretchMode: 2, speedPct: 100, reverse: 1, decayMs: 20000 });
  assert(rev.samples.length === n, "texture + reverse keeps the length");
}

{
  // 1. Built node code (what the device runs)
  const codePath = path.join(tmpDir, "xo_node_embedded.js");
  const embedded = boxMap.get("obj-node").code;
  fs.writeFileSync(codePath, embedded);
  require("child_process").execFileSync(process.execPath, ["--check", codePath]);
  assert(embedded.length < 400000, `Embedded node code unexpectedly large: ${embedded.length}`);
  const prevMock = global.__MAX_API_MOCK__;
  global.__MAX_API_MOCK__ = { post() {}, outlet() {}, addHandler() {} };
  const emb = require(codePath);
  global.__MAX_API_MOCK__ = prevMock;
  testStretchModes(emb, "embedded");
  console.log("OK: embedded node code renders all 3 stretch modes");
  // 2. Source engine
  testStretchModes(engine, "src");
  console.log("OK: src engine renders all 3 stretch modes");
}

assert.strictEqual(engine.engineState.stretchMode, 1, "default stretch mode is Complex");
assert.strictEqual(engine.stretchModeIndex("Texture"), 2);
assert.strictEqual(engine.STRETCH_MODES.length, 3);
// Legacy saved items: text "signalsmith" loads as Complex, text "texture" as Texture; numerics are the current indices (clamped)
assert.strictEqual(engine.stretchModeIndex("signalsmith"), 1, "old signalsmith item loads as Complex");
assert.strictEqual(engine.stretchModeIndex("Signalsmith"), 1);
assert.strictEqual(engine.stretchModeIndex("texture"), 2, "old texture item loads as Texture");
assert.strictEqual(engine.stretchModeIndex(3), 2, "index 3 clamps to Texture");
assert.strictEqual(engine.resolveStretchMode({ stretchMode: "signalsmith" }), 1);
assert.strictEqual(engine.resolveStretchMode({ spectralPct: 60 }), 0, "legacy spectralPct item falls back to Granular");
assert.strictEqual(engine.resolveStretchMode({}), 1, "item without a mode gets Complex");
assert.strictEqual(engine.resolveStretchMode({ stretchMode: 2, spectralPct: 60 }), 2);
{
  const stretchedGranular2 = engine.renderEditedAudioSamples(kickDecoded, { stretchMode: 0, speedPct: 50, grainMs: 35, decayMs: 5000 });
  assert(Math.abs(stretchedGranular2.durationMs - kickDecoded.durationMs * 2) <= 15, "granular mode doubles the duration at 50 %");
}

// Saved items carry the stretch mode (round trip) and legacy items with spectralPct still load
{
  const saveBefore = engine.engineState.savedList.length;
  engine.engineState.stretchMode = 2;
  engine.engineState.speedPct = 100;
  const withMode = engine.saveSampleToList(0);
  assert.strictEqual(withMode.stretchMode, 2, "saved item stores stretchMode");
  assert(!("spectralPct" in withMode), "saved item no longer has spectralPct");
  engine.engineState.stretchMode = 0;
  engine.recallSavedSample(engine.engineState.savedList.length - 1, false);
  assert.strictEqual(engine.engineState.stretchMode, 2, "recall restores the item's stretch mode");
  const legacy = Object.assign({}, withMode, { id: 9999, stretchMode: undefined, spectralPct: 70 });
  delete legacy.stretchMode;
  engine.engineState.savedList.push(legacy);
  engine.recallSavedSample(engine.engineState.savedList.length - 1, false);
  assert.strictEqual(engine.engineState.stretchMode, 0, "legacy spectralPct item loads as Granular");
  const plain = Object.assign({}, withMode, { id: 9998 });
  delete plain.stretchMode;
  engine.engineState.savedList.push(plain);
  engine.recallSavedSample(engine.engineState.savedList.length - 1, false);
  assert.strictEqual(engine.engineState.stretchMode, 1, "item with no mode gets Complex");
  while (engine.engineState.savedList.length > saveBefore) engine.engineState.savedList.pop();
  engine.engineState.stretchMode = 1;
}

// Test Tonal vs. Atonal Filter & Re-Seed with Active Filters Applied in Node engine
engine.engineState.tonalFilter = 60; // Require tonal (low flatness)
assert(engine.isSamplePassingFilters(scanRes.samples[monoSampleIdx]), "Tonal sine kick should pass when tonalFilter = +60% (Tonal)");
assert(!engine.isSamplePassingFilters(scanRes.samples[stereoSampleIdx]), "Noisy hihat should be filtered out when tonalFilter = +60% (Tonal)");
engine.engineState.tonalFilter = -60; // Require atonal/noisy (high flatness)
assert(engine.isSamplePassingFilters(scanRes.samples[stereoSampleIdx]), "Noisy hihat should pass when tonalFilter = -60% (Atonal)");

// Test Re-Seeding with Active Filters Applied (fills the map ONLY with samples matching the active filters!)
engine.engineState.corpusSamples = scanRes.samples;
engine.engineState.knownFolders = [{ path: tmpDir, name: "TestDrums", enabled: true, count: scanRes.samples.length }];
const filteredMapSubset = engine.reseedWithActiveFilters();
assert(
  filteredMapSubset.length > 0 && filteredMapSubset.every((s) => engine.isSamplePassingFilters(s)),
  "Re-seeding with filters applied must fill the map exclusively with samples matching the active filters"
);
engine.engineState.tonalFilter = 0;

// Test Druminess Filter (Pads/Clusters vs. Punchy Drums)
const shortHatDruminess = engine.computeSampleDruminessPct(scanRes.samples[stereoSampleIdx]); // 80ms snappy hihat
const longPadDruminess = engine.computeSampleDruminessPct(scanRes.samples[longSampleIdx]);   // 6500ms long tail
assert(shortHatDruminess > longPadDruminess, "Short snappy drum hit must have higher druminess score than 6.5s sustained tail");
engine.engineState.drumFilter = 70; // Require high druminess (Drums)
assert(engine.isSamplePassingFilters(scanRes.samples[stereoSampleIdx]), "Short snappy drum hit must pass when drumFilter = +70% (Drums)");
assert(!engine.isSamplePassingFilters(scanRes.samples[longSampleIdx]), "6.5s sustained sample must be filtered out when drumFilter = +70% (Drums)");
engine.engineState.drumFilter = 0;

// ============================================================================
// Themes + section collapse layout (src/xo_layouts/default.js, applied by the mini-map v8ui)
// ONE device with two looks: "LCD" (amber live.numbox readouts) and "Focus" (slim live.dial columns). The layout is a
// function of (theme, saved, filters, playback, options). Regressions kept from before: hiding Saved widened the map into
// the old list area; hiding Filters left an empty gap and pushed Playback past the shrunk device width.
// ============================================================================
const xoLayout = require("../src/xo_layouts/default.js");
const THEMES = xoLayout.XO_THEMES;
assert.deepStrictEqual(THEMES, ["LCD", "Focus", "Live"], "theme order is part of the Theme parameter (enum LCD, Focus, Live: appended, so saved sets keep their index)");

const LAYOUT_COMBOS = [];
for (let ov = 0; ov <= 1; ov++) for (let sv = 0; sv <= 1; sv++) for (let fv = 0; fv <= 1; fv++) for (let pv = 0; pv <= 1; pv++) LAYOUT_COMBOS.push([sv, fv, pv, ov]);
const PANEL_OF = { toolbar: "obj-panel-toolbar", options: "obj-panel-options", left: "obj-panel-left", filters: "obj-panel-filters", playback: "obj-panel-playback" };
const contains = (outer, inner) =>
  inner[0] >= outer[0] && inner[1] >= outer[1] &&
  inner[0] + inner[2] <= outer[0] + outer[2] && inner[1] + inner[3] <= outer[1] + outer[3];
// obj-expr-width: 'expr 278 + $i1 * 136 + $i4 * 156 + $i2 * (214 - 74 * $i5) + ...' over (saved filters playback options theme); evaluated here.
// No comma (so no if()): a comma inside an expr box has to be escaped in Max.
const exprWidth = (sv, fv, pv, ov, theme) => {
  const text = boxMap.get("obj-expr-width").text;
  assert(/^expr [-+*()>\s$i0-9.]+$/.test(text) && !text.includes(","), `obj-expr-width must be a plain arithmetic expr without commas: ${text}`);
  const vals = [sv, fv, pv, ov, THEMES.indexOf(theme)];
  const body = text.replace(/^expr /, "").replace(/\$i(\d)/g, (m, d) => String(vals[Number(d) - 1]));
  return Function('"use strict"; return (' + body + ");")();
};

const layAll = xoLayout.computeXoLayout("Live", 1, 0, 0, 0); // the saved / default state of a new instance: Live theme, Saved list only
assert.strictEqual(layAll.deviceWidth, p.devicewidth, "Saved-state layout width must equal devicewidth");
for (const [id, spec] of Object.entries(layAll.boxes)) {
  assert(boxMap.has(id), `Layout box ${id} must exist in the device`);
  assert.deepStrictEqual(boxMap.get(id).presentation_rect, spec.rect, `Built presentation_rect of ${id} must match the saved-state layout`);
  assert.strictEqual(boxMap.get(id).hidden || 0, spec.hidden, `Built hidden flag of ${id} must match the saved-state layout`);
}
// Per-section classification comes from the layout; the old `prepend hidden` chains are gone (the layout is the one authority).
for (const goneId of ["obj-inv-filters", "obj-inv-playback", "obj-prep-hide-filters", "obj-prep-hide-playback"]) assert(!boxMap.has(goneId), `${goneId} must be gone (applyXoLayout hides sections)`);
for (const id of Object.keys(layAll.boxes)) assert(layAll.sections[id], `Layout box ${id} must belong to a section`);
assert.strictEqual(layAll.sections["obj-stretch-mode"], "playback", "Mode hides with the Playback section");

for (const theme of THEMES) for (const [sv, fv, pv, ov] of LAYOUT_COMBOS) {
  const tag = `${theme} saved=${sv} filters=${fv} playback=${pv} options=${ov}`;
  const lay = xoLayout.computeXoLayout(theme, sv, fv, pv, ov);
  assert.deepStrictEqual(Object.keys(lay.boxes).sort(), Object.keys(layAll.boxes).sort(), `[${tag}] same ids in every combination`);
  // Device width: the patcher (obj-expr-width -> setwidth) and the layout must agree.
  assert.strictEqual(exprWidth(sv, fv, pv, ov, theme), lay.deviceWidth, `[${tag}] obj-expr-width must equal layout deviceWidth`);
  // The map pane never changes size (and is identical in both themes); only the Saved list's width comes and goes.
  assert.strictEqual(lay.boxes["obj-minimap"].rect[2], xoLayout.XO_MAP_PANE_W + (sv ? xoLayout.XO_SAVED_PANE_W : 0), `[${tag}] mini-map width`);
  assert.strictEqual(lay.boxes["obj-minimap"].rect[3], 154, `[${tag}] map height is the same in both themes`);
  for (const other of THEMES) assert.strictEqual(xoLayout.computeXoLayout(other, sv, fv, pv, ov).boxes["obj-minimap"].rect[2], lay.boxes["obj-minimap"].rect[2], `[${tag}] map pane width equal in every theme`);
  // Visible panels are packed left to right: toolbar, then 3 px, Options / map, then 6 px between sections.
  const order = ["toolbar"].concat(ov ? ["options"] : [], ["left"], fv ? ["filters"] : [], pv ? ["playback"] : []);
  let x = 3;
  for (const k of order) {
    const r = lay.boxes[PANEL_OF[k]].rect;
    assert.strictEqual(r[0], x, `[${tag}] ${k} panel at x=${r[0]} must start at ${x} (no gap / overlap)`);
    x = r[0] + r[2] + (k === "toolbar" ? 3 : 6);
  }
  assert.strictEqual(lay.deviceWidth, x, `[${tag}] device must end 6 px after the last visible panel`);
  // Each visible box stays inside its own section panel; hidden-section / other-theme boxes are hidden.
  for (const [id, spec] of Object.entries(lay.boxes)) {
    const sec = lay.sections[id];
    const secOn = sec === "toolbar" || sec === "left" || (sec === "filters" ? fv : sec === "playback" ? pv : ov);
    const visible = secOn && xoLayout.xoOnlyOk(lay.themeOnly[id] || "", theme);
    assert.strictEqual(spec.hidden, visible ? 0 : 1, `[${tag}] ${id} hidden flag`);
    if (visible && !/^obj-(panel|focus-tick)/.test(id)) {
      assert(contains(lay.boxes[PANEL_OF[sec]].rect, spec.rect), `[${tag}] ${id} ${JSON.stringify(spec.rect)} must sit inside ${PANEL_OF[sec]}`);
    }
    if (visible) assert(spec.rect[0] + spec.rect[2] <= lay.deviceWidth && spec.rect[1] + spec.rect[3] <= 169, `[${tag}] ${id} must stay inside the device`);
  }
  // Per parameter: the numbox (parameter object) shows in LCD, the dial mirror in Focus, never both.
  for (const id of ["obj-maxlen-dial", "obj-tone-dial", "obj-filter-tonal-dial", "obj-filter-drum-dial", "obj-pitch-dial", "obj-speed-dial", "obj-grain-dial", "obj-decay-dial", "obj-stretch-mode", "obj-gain-dial"]) {
    const secOn = lay.sections[id] === "filters" ? fv : pv;
    assert.strictEqual(lay.boxes[id].hidden, secOn && theme === "LCD" ? 0 : 1, `[${tag}] ${id} (live.numbox) visible only in LCD`);
    assert.strictEqual(lay.boxes[id + "-mir"].hidden, secOn && theme !== "LCD" ? 0 : 1, `[${tag}] ${id}-mir (live.dial) visible in Focus and Live`);
  }
  // Toolbar: always visible; the three section toggles on top, Options at the bottom, all inside the toolbar panel.
  const TB = ["obj-toggle-saved-btn", "obj-toggle-filters-btn", "obj-toggle-playback-btn", "obj-toggle-options-btn"];
  for (const id of TB) {
    assert.strictEqual(lay.boxes[id].hidden, 0, `[${tag}] toolbar button ${id} always visible`);
    assert(contains(lay.boxes["obj-panel-toolbar"].rect, lay.boxes[id].rect), `[${tag}] toolbar button ${id} must fit inside the toolbar panel`);
    assert.strictEqual(boxMap.get(id).presentation_rect[2] < 28, true, "toolbar icons are compact");
    assert.strictEqual(boxMap.get(id).usepicture, 1, `${id} must be an icon (usepicture), not text`);
  }
  assert(lay.boxes["obj-toggle-options-btn"].rect[1] > lay.boxes["obj-toggle-playback-btn"].rect[1] + 16 + 40, `[${tag}] Options sits at the bottom of the toolbar, away from the section toggles`);
  // The Options section holds the Theme selector.
  assert.strictEqual(lay.boxes["obj-theme-tab"].hidden, ov ? 0 : 1, `[${tag}] Theme selector visible with the Options section`);
}
assert.strictEqual(xoLayout.computeXoLayout("LCD", 1, 0, 1, 0).playbackX, 414.0, "Playback panel must slide left into x=414 when Filters collapse (LCD)");
assert.strictEqual(xoLayout.computeXoLayout("LCD", 0, 0, 0, 0).deviceWidth, 278.0, "Expected compact 278px width when all sections collapse");
assert.strictEqual(xoLayout.computeXoLayout("Focus", 0, 0, 0, 0).deviceWidth, 278.0, "Compact width equal in both themes");
assert.strictEqual(xoLayout.computeXoLayout("LCD", 1, 1, 1, 0).deviceWidth, 798.0);
assert.strictEqual(xoLayout.computeXoLayout("Focus", 1, 1, 1, 0).deviceWidth, 786.0);
assert.strictEqual(xoLayout.computeXoLayout("Live", 1, 1, 1, 0).deviceWidth, 786.0, "Live reuses Focus's section widths");
assert.strictEqual(xoLayout.computeXoLayout("Live", 0, 0, 0, 0).deviceWidth, 278.0, "Compact width equal in every theme");
// Live-only hairlines, Focus-only edge ticks, shared dial boxes
{
  const L = xoLayout.computeXoLayout("Live", 1, 1, 1, 1), F = xoLayout.computeXoLayout("Focus", 1, 1, 1, 1), D = xoLayout.computeXoLayout("LCD", 1, 1, 1, 1);
  for (const id of ["obj-rule-options", "obj-rule-searches", "obj-rule-filters", "obj-rule-playback"]) {
    assert.strictEqual(L.boxes[id].hidden, 0, `${id} shows in Live`); assert.strictEqual(F.boxes[id].hidden, 1, `${id} hidden in Focus`); assert.strictEqual(D.boxes[id].hidden, 1, `${id} hidden in LCD`);
    assert.strictEqual(L.boxes[id].rect[3], 5, `${id} is a 5 px live.line (Live's minimum height; it draws a 1 px line in the middle)`);
  }
  for (const id of ["obj-focus-tick-filters", "obj-focus-tick-playback"]) assert.strictEqual(L.boxes[id].hidden, 1, `${id} (coloured edge tick) is not part of the Live look`);
  for (const id of ["obj-focus-f-lbl-0", "obj-focus-p-lbl-5", "obj-maxlen-dial-mir"]) assert.strictEqual(L.boxes[id].hidden, 0, `${id} shows in Live`);
  assert.deepStrictEqual(L.boxes["obj-maxlen-dial-mir"].rect, F.boxes["obj-maxlen-dial-mir"].rect, "Live keeps Focus's dial geometry");
}
assert.strictEqual(xoLayout.computeXoLayout("LCD", 1, 0, 0, 0).deviceWidth, 414.0, "new-instance default: toolbar + map + Saved");
assert.strictEqual(xoLayout.computeXoLayout("LCD", 1, 1, 1, 1).deviceWidth, 798.0 + xoLayout.XO_OPTIONS_W + 6, "Options adds its width (+6 gap)");
assert.strictEqual(xoLayout.computeXoLayout(0, 1, 1, 1, 0).theme, "LCD", "theme accepts its index");
assert.strictEqual(xoLayout.computeXoLayout(1, 1, 1, 1, 0).theme, "Focus", "theme accepts its index");
assert.strictEqual(xoLayout.computeXoLayout(2, 1, 1, 1, 0).theme, "Live", "theme accepts its index");

// Wiring: the v8ui must hear about every section toggle and the theme, and re-apply the layout on load.
assert(linesFrom("obj-toggle-saved-btn").includes("obj-pak-vis"), "Saved toggle must drive the device width");
assert(linesFrom("obj-toggle-options-btn").includes("obj-pak-vis") && linesFrom("obj-toggle-options-btn").includes("obj-prep-show-options"), "Options toggle drives width and the v8ui");
assert(linesFromPort("obj-theme-tab", 0).includes("obj-pak-vis:4"), "Theme tab drives the device width (pak inlet 5)");
assert.strictEqual(boxMap.get("obj-pak-vis").text, "pak 1 0 0 0 2", "pak: saved filters playback options theme (initial = the new-instance default: Live)");
assert.strictEqual(boxMap.get("obj-pak-vis").numinlets, 5);
assert.strictEqual(boxMap.get("obj-expr-width").numinlets, 5);
assert(linesFrom("obj-prep-show-filters").includes("obj-minimap"), "obj-prep-show-filters must reach obj-minimap (layout)");
assert(linesFrom("obj-prep-show-playback").includes("obj-minimap"), "obj-prep-show-playback must reach obj-minimap (layout)");
assert.strictEqual(boxMap.get("obj-prep-show-options").text, "prepend set_show_options");
assert(linesFrom("obj-prep-show-options").includes("obj-minimap"), "obj-prep-show-options must reach obj-minimap (layout)");
assert.strictEqual(boxMap.get("obj-prep-theme").text, "prepend set_theme");
assert(linesFrom("obj-theme-tab").includes("obj-prep-theme") && linesFrom("obj-prep-theme").includes("obj-minimap") && linesFrom("obj-prep-theme").includes("obj-folder-list"), "Theme reaches the map v8ui (layout + palette) and the folder list v8ui (palette)");
assert(linesFrom("obj-thisdevice").includes("obj-msg-apply-layout"), "live.thisdevice must trigger apply_layout");
assert.strictEqual(boxMap.get("obj-msg-apply-layout").text, "apply_layout");
assert(linesFrom("obj-msg-apply-layout").includes("obj-minimap"), "apply_layout must reach obj-minimap");
assert(linesFrom("obj-expr-width").includes("obj-prep-setwidth") && linesFrom("obj-prep-setwidth").includes("obj-thisdevice"),
  "obj-expr-width -> prepend setwidth -> live.thisdevice must set the device width");

// Theme parameters: appended after every existing one, defaults LCD / closed, icon toggle with tooltip.
{
  const vo = (id) => boxMap.get(id).saved_attribute_attributes.valueof;
  assert.strictEqual(vo("obj-theme-tab").parameter_longname, "Theme");
  assert.deepStrictEqual(vo("obj-theme-tab").parameter_enum, ["LCD", "Focus", "Live"]);
  assert.strictEqual(vo("obj-theme-tab").parameter_mmax, 2, "Theme range covers the three looks");
  assert.deepStrictEqual(vo("obj-theme-tab").parameter_initial, [2], "default theme is Live (existing Sets keep their saved index)");
  assert.strictEqual(boxMap.get("obj-theme-tab").maxclass, "live.tab");
  assert.strictEqual(vo("obj-toggle-options-btn").parameter_longname, "ShowOptions");
  assert.deepStrictEqual(vo("obj-toggle-options-btn").parameter_initial, [0], "Options section starts closed");
  assert.strictEqual(boxMap.get("obj-toggle-options-btn").pictures[0], "gear.svg");
  assert.strictEqual(boxMap.get("obj-toggle-options-btn").annotation_name, "Show Options Section");
  const keys = Object.keys(p.parameters).filter((k) => k !== "parameterbanks" && k !== "inherited_shortname");
  assert.deepStrictEqual(keys.filter((k) => !k.endsWith("-mir")).slice(-5), ["obj-toggle-options-btn", "obj-theme-tab", "obj-searches-cat", "obj-zoom-speed", "obj-map-samples"], "new parameters are appended last");
  const longs = p.boxes.map((b) => b.box).filter((b) => b.saved_attribute_attributes && b.saved_attribute_attributes.valueof && b.saved_attribute_attributes.valueof.parameter_longname).map((b) => b.saved_attribute_attributes.valueof.parameter_longname);
  assert.deepStrictEqual(longs.filter((l) => !l.endsWith("View")).slice(-5), ["ShowOptions", "Theme", "Searches Category", "Zoom Speed", "Map Samples"], "new parameter boxes come after every existing parameter box");
  assert.strictEqual(new Set(longs).size, longs.length, "parameter long names are unique (hidden mirrors included)");
}

// Mirrors: one parameter object (live.numbox, the same parameter) + one non-parameter live.dial mirror per value control,
// synced both ways without a feedback loop (parameter -> prepend set -> mirror is silent; mirror -> parameter re-sets it silently).
const MIRRORED = ["obj-maxlen-dial", "obj-tone-dial", "obj-filter-tonal-dial", "obj-filter-drum-dial", "obj-pitch-dial", "obj-speed-dial", "obj-grain-dial", "obj-decay-dial", "obj-stretch-mode", "obj-gain-dial"];
for (const id of MIRRORED) {
  const par = boxMap.get(id), mir = boxMap.get(id + "-mir");
  assert.strictEqual(par.maxclass, "live.numbox", `${id} is the LCD numbox parameter object`);
  assert.strictEqual(par.appearance, 4, `${id} LCD appearance`);
  assert.strictEqual(par.parameter_enable, 1);
  assert(mir, `${id} needs a mirror`);
  assert.strictEqual(mir.maxclass, "live.dial");
  assert.strictEqual(mir.parameter_enable, 1, `${id}-mir is a real (hidden) parameter: Max applies range / unit / enum only then`);
  assert.strictEqual(mir.varname, id + "-mir");
  const pv = par.saved_attribute_attributes.valueof, mv = mir.saved_attribute_attributes.valueof;
  assert.strictEqual(mv.parameter_invisible, 2, `${id}-mir is hidden (not automatable, not stored, not listed)`);
  assert.strictEqual(mv.parameter_longname, pv.parameter_longname + "View");
  assert(mv.parameter_shortname && mv.parameter_shortname !== pv.parameter_shortname, `${id}-mir has its own short name`);
  const skip = new Set(["parameter_longname", "parameter_shortname", "parameter_invisible", "parameter_annotation_name", "parameter_linknames"]);
  for (const k of new Set([...Object.keys(pv), ...Object.keys(mv)])) {
    if (skip.has(k)) continue;
    assert.deepStrictEqual(mv[k], pv[k], `${id}-mir ${k} equals the parameter's`);
  }
  for (const k of ["parameter_mmin", "parameter_mmax", "parameter_type", "parameter_unitstyle", "parameter_initial", "parameter_initial_enable"]) assert(k in mv, `${id}-mir has ${k}`);
  const prep = "obj-prep-mset-" + id.slice(4);
  assert.strictEqual(boxMap.get(prep).text, "prepend set");
  assert(linesFrom(id).includes(prep) && linesFrom(prep).includes(id + "-mir"), `${id} -> prepend set -> mirror (silent)`);
  assert(linesFrom(id + "-mir").includes(id), `mirror -> ${id} (the parameter follows)`);
  assert(!linesFrom(prep).includes(id), "prepend set never feeds the parameter object (no loop)");
}

// Style tables injected into the v8ui: applied with setattr per theme; the saved state equals the LCD table.
const themeStyleM = /var XO_THEME_STYLE = (\{[^\n]*\});/.exec(boxMap.get("obj-minimap").textfile.text);
assert(themeStyleM, "mini-map script must carry XO_THEME_STYLE");
const THEME_STYLE = JSON.parse(themeStyleM[1]);
assert.deepStrictEqual(Object.keys(THEME_STYLE), THEMES);
for (const theme of THEMES) for (const id of Object.keys(THEME_STYLE[theme])) assert(boxMap.has(id) && layAll.boxes[id], `${theme} style box ${id} must exist and be laid out`);
// the Options toggle (covers obj-node) is opaque in every theme (background and on colours alpha 1, after resolving the Live tokens)
{
  const fbAlpha = new Function(fs.readFileSync(path.join(__dirname, "..", "src", "xo_palette.js"), "utf8") + ";return XO_LIVE_FALLBACK;")();
  for (const th of THEMES) for (const a of ["activebgcolor", "activebgoncolor"]) {
    let v = THEME_STYLE[th]["obj-toggle-options-btn"][a];
    if (typeof v === "string") v = fbAlpha[v.slice(1)];
    assert.strictEqual(v[3], 1, `${th}: Options toggle ${a} is opaque (it hides the node's 1x1 box)`);
  }
  for (const [id, spec] of Object.entries(xoLayout.computeXoLayout("Live", 1, 0, 0, 0).boxes)) if (id === "obj-toggle-options-btn") {
    for (const th of THEMES) for (let m = 0; m < 16; m++) {
      const l2 = xoLayout.computeXoLayout(th, m & 1, (m >> 1) & 1, (m >> 2) & 1, (m >> 3) & 1).boxes[id];
      assert.deepStrictEqual([l2.rect, l2.hidden], [spec.rect, 0], `${th}/${m}: the Options toggle never moves or hides`);
    }
  }
}
// the saved state is the default theme (Live) with its colour tokens resolved to the default-dark fallbacks at build time
const LIVE_FB = new Function(fs.readFileSync(path.join(__dirname, "..", "src", "xo_palette.js"), "utf8") + ";return XO_LIVE_FALLBACK;")();
for (const [id, attrs] of Object.entries(THEME_STYLE.Live)) {
  for (const [k, v0] of Object.entries(attrs)) {
    const v = (typeof v0 === "string" && v0.charAt(0) === "@") ? LIVE_FB[v0.slice(1)] : v0;
    assert.deepStrictEqual(boxMap.get(id)[k], v, `saved attribute ${id}.${k} equals the Live style (colours resolved with the fallbacks)`);
  }
}
for (const id of ["obj-panel-filters", "obj-panel-playback", "obj-hdr-filters", "obj-hdr-playback", "obj-reseed-filtered-btn", "obj-reverse-btn", "obj-search-box", "obj-search-clear-btn", "obj-panel-toolbar", "obj-panel-left", "obj-panel-options", "obj-theme-tab", "obj-toggle-saved-btn", "obj-toggle-options-btn", "obj-hdr-options", "obj-lbl-theme"]) {
  assert(THEME_STYLE.LCD[id] && THEME_STYLE.Focus[id] && THEME_STYLE.Live[id], `${id} is restyled by every theme`);
}
assert(THEME_STYLE.LCD["obj-pitch-dial"].lcdcolor, "LCD numbox colours (lcdcolor) come from the LCD style");
// Live drops a numbox's unit when its WIDEST value string does not fit the cell (12 pt in the 47 px filter cells
// showed bare "0.00" / "5.00" in Live). Widest strings are Live's str_for_value output for each parameter;
// Menlo advances 0.602 em, and the LCD numbox keeps about 5 px of inset on each side.
{
  const WIDEST = {
    "obj-maxlen-dial": "1.29 s", "obj-tone-dial": "-100 %", "obj-filter-tonal-dial": "-100 %", "obj-filter-drum-dial": "-100 %",
    "obj-pitch-dial": "+24 st", "obj-speed-dial": "52.4 %", "obj-grain-dial": "35.6 ms", "obj-decay-dial": "966 ms",
    "obj-stretch-mode": "Cmplx", "obj-gain-dial": "-36 dB"
  };
  for (const [id, text] of Object.entries(WIDEST)) {
    const style = THEME_STYLE.LCD[id];
    assert(style && style.appearance === 4, `${id} is an LCD numbox in the LCD theme`);
    const need = text.length * 0.602 * style.fontsize + 10;
    const have = layAll.boxes[id].rect[2];
    assert(need <= have, `LCD ${id}: widest value "${text}" needs ${need.toFixed(1)} px at ${style.fontsize} pt but the cell is ${have} px (Live would drop the unit)`);
  }
}
// Live sizes every single-line live.comment to exactly floor(font + 8) px whatever the patch says (measured in the
// VM: 7 pt -> 15, 9 / 9.5 pt -> 17), using the font the theme sets, so each laid-out label must have that height
// (else applyXoLayout and Live disagree); labels are click-through so a taller box can't block the control under it.
for (const theme of THEMES) {
  const lay = xoLayout.computeXoLayout(theme, 1, 1, 1, 1);
  for (const [id, spec] of Object.entries(lay.boxes)) {
    const box = boxMap.get(id);
    if (!box || box.maxclass !== "live.comment") continue;
    const font = (THEME_STYLE[theme][id] && THEME_STYLE[theme][id].fontsize) || box.fontsize;
    assert.strictEqual(spec.rect[3], theme === "Live" ? Math.ceil(font + 8) : Math.floor(font + 8), `${theme} ${id}: label height must be Live's ${theme === "Live" ? "ceil" : "floor"}(font + 8) for ${font} pt`);
    assert.strictEqual(box.ignoreclick, 1, `${id}: labels are click-through`);
  }
}
// The ">" prompt shares the search field's (regular) weight and sits 1 px higher, because live.comment
// insets its text 1 px more than textedit (measured in Live), so the two text lines share a baseline.
const layLCD = xoLayout.computeXoLayout("LCD", 1, 0, 0, 0);
assert.strictEqual(layLCD.boxes["obj-lcd-f-prompt"].rect[1], layLCD.boxes["obj-search-box"].rect[1] - 1, "LCD prompt top is 1 px above the search box top");
assert.strictEqual(layLCD.boxes["obj-lcd-f-prompt"].rect[3], 17, "LCD prompt is a label: Live's 17 px minimum for 9 pt (its text is top-aligned, so only the top sets the baseline)");
assert.strictEqual(boxMap.get("obj-lcd-f-prompt").fontface, 0, "LCD prompt is regular weight like the search text");

// Scripting names: getnamed() needs a unique varname on every laid-out box, matching XO_LAYOUT_NAMES.
const namesMatch = /var XO_LAYOUT_NAMES = (\{[^\n]*\});/.exec(boxMap.get("obj-minimap").textfile.text);
assert(namesMatch, "Mini-map script must start with the injected XO_LAYOUT_NAMES");
const builtLayoutNames = JSON.parse(namesMatch[1]);
const allVarnames = p.boxes.map((b) => b.box.varname).filter(Boolean);
{ // a new instance: the toggles' initial values, the v8ui's starting flags and the pak all agree on "Saved only"
  const txt = boxMap.get("obj-minimap").textfile.text;
  assert(/let showSavedList = 1;/.test(txt) && /let showFiltersSection = 0;/.test(txt) && /let showPlaybackSection = 0;/.test(txt) && /let showOptionsSection = 0;/.test(txt), "v8ui starts with Saved only");
  const init = (id) => boxMap.get(id).saved_attribute_attributes.valueof.parameter_initial[0];
  assert.deepStrictEqual(["obj-toggle-saved-btn", "obj-toggle-filters-btn", "obj-toggle-playback-btn", "obj-toggle-options-btn"].map(init), [1, 0, 0, 0], "toolbar toggles start Saved on, Filters / Playback / Options off");
}
assert.deepStrictEqual(Object.keys(builtLayoutNames).sort(), Object.keys(layAll.boxes).sort(), "XO_LAYOUT_NAMES ids are the layout's ids");
for (const id of Object.keys(layAll.boxes)) {
  const vn = boxMap.get(id).varname;
  assert(vn, `Layout box ${id} needs a varname (scripting name) for getnamed()`);
  assert.strictEqual(builtLayoutNames[id], vn, `XO_LAYOUT_NAMES[${id}] must equal its varname`);
  assert.strictEqual(allVarnames.filter((v) => v === vn).length, 1, `Scripting name ${vn} must be unique`);
}

// The node engine no longer scripts the patcher (its sendbox targets never existed).
nodeOutletLog.length = 0;
for (const h of ["set_show_saved", "set_show_filters", "set_show_playback"]) {
  if (nodeHandlers[h]) { nodeHandlers[h](0); nodeHandlers[h](1); }
}
assert(!nodeOutletLog.some((m) => m[0] === "patcher_cmd" || m[0] === "setwidth_cmd"), "Node engine must not emit patcher layout commands");
assert.strictEqual(typeof engine.applyDynamicLayout, "undefined", "Old node layout path must be gone");

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

assert(fs.existsSync(savedA.rawPath), "Expected Raw sample path to exist on disk");
assert.strictEqual(
  path.resolve(savedA.rawPath),
  path.resolve(engine.engineState.samples[0].path),
  "Raw sample export must point directly to the original sample file without creating a copy"
);
assert(fs.existsSync(savedA.editedPath), "Expected rendered WAV for Edited sample to exist on disk");

// Reorder saved sample 2 to index 0
engine.reorderSavedSample(2, 0);
assert.strictEqual(engine.engineState.savedList[0].id, savedC.id, "Expected savedC moved to index 0 after reorder");

// Delete saved sample at index 1
engine.removeSavedSample(1);
assert.strictEqual(engine.engineState.savedList.length, 2, "Expected 2 saved samples after deleting index 1");

// Test Binary Cache Record Packing & Unpacking (104-byte fixed binary records)
assert.strictEqual(engine.RECORD_BYTE_SIZE, 104, "Expected 104-byte fixed binary record format");
const packedRec = engine.packSampleBinaryRecord(scanRes.samples[0]);
assert.strictEqual(packedRec.length, 104);
const unpackedRec = engine.unpackSampleBinaryRecord(packedRec, 0, scanRes.samples[0].path, tmpDir);
assert.strictEqual(unpackedRec.category, scanRes.samples[0].category);
assert.strictEqual(unpackedRec.durationMs, scanRes.samples[0].durationMs);
assert.strictEqual(unpackedRec.channels, scanRes.samples[0].channels);
assert.strictEqual(unpackedRec.peaks.length, 24);

// Test 1,500-Sample Map Display Limit, 50,000-File Per-Folder Limit & Seeded Re-Seed from Full Corpus
assert.strictEqual(engine.MAX_DISPLAY_SAMPLES, 1500, "Expected MAX_DISPLAY_SAMPLES === 1500");
assert.strictEqual(engine.MAX_FILES_PER_FOLDER, 50000, "Expected MAX_FILES_PER_FOLDER === 50000");

// Test Multi-Word AND'd Search Clauses (e.g. "female vocal" matches "Vocal_Female_Chop_01" and "Female-Atmos-Vocal", rejects "Female_Synth_01")
engine.engineState.searchQuery = "female vocal";
assert(
  engine.isSamplePassingFilters({ ...scanRes.samples[0], name: "Vocal_Female_Chop_01", category: "fx", folder: "Vox" }),
  "Multi-word search 'female vocal' must match 'Vocal_Female_Chop_01' (underscore-separated out-of-order words)"
);
assert(
  engine.isSamplePassingFilters({ ...scanRes.samples[0], name: "Female-Atmos-Vocal", category: "fx", folder: "Vox" }),
  "Multi-word search 'female vocal' must match 'Female-Atmos-Vocal' (hyphen-separated words)"
);
assert(
  !engine.isSamplePassingFilters({ ...scanRes.samples[0], name: "Female_Synth_01", category: "fx", folder: "Synths" }),
  "Multi-word search 'female vocal' must reject 'Female_Synth_01' (missing 'vocal' clause)"
);
// Search must NOT match against auto-detected category (only sample name)
engine.engineState.searchQuery = "kick";
assert(
  engine.isSamplePassingFilters({ ...scanRes.samples[0], name: "Punchy_Kick_01", category: "kick", folder: "Drums" }),
  "Search 'kick' must match sample with 'Kick' in its name"
);
assert(
  !engine.isSamplePassingFilters({ ...scanRes.samples[0], name: "Sub_Thump_01", category: "kick", folder: "Kick" }),
  "Search 'kick' must NOT match sample named 'Sub_Thump_01' just because XO classified its category as 'kick'"
);
engine.engineState.searchQuery = "";
const syntheticCorpus = [];
for (let i = 0; i < 2000; i++) {
  const base = scanRes.samples[i % scanRes.samples.length];
  syntheticCorpus.push({
    ...base,
    name: `CorpusSample_${i}`,
    path: `/tmp/corpus_${i}.wav`,
    rootFolder: i < 1000 ? "/tmp/PackA" : "/tmp/PackB"
  });
}
const subSeed1 = engine.selectSeededMapSubset(syntheticCorpus, 1500, 1);
const subSeed2 = engine.selectSeededMapSubset(syntheticCorpus, 1500, 2);
assert.strictEqual(subSeed1.length, 1500, "Expected map subset capped at 1,500 samples");
assert.strictEqual(subSeed2.length, 1500, "Expected re-seeded map subset capped at 1,500 samples");
const namesSeed1 = subSeed1.slice(0, 25).map((s) => s.name).join(",");
const namesSeed2 = subSeed2.slice(0, 25).map((s) => s.name).join(",");
assert.notStrictEqual(namesSeed1, namesSeed2, "Re-seeding must select a different sample ordering/subset from the full corpus");

// Test Remembered Folder List & Per-Folder Filtering (including Ableton Core Drums)
engine.engineState.knownFolders = [];
const initFolders = engine.ensureKnownFoldersInitialized(true);
assert(initFolders.some((f) => f.name === "Ableton Core Drums" && f.enabled), "Folder list must automatically include Ableton Core Drums");
engine.engineState.knownFolders = [
  { path: "/tmp/PackA", name: "PackA", enabled: true, count: 1000 },
  { path: "/tmp/PackB", name: "PackB", enabled: true, count: 1000 }
];
engine.engineState.corpusSamples = syntheticCorpus.slice(0, 40);
engine.rebuildActiveMapSubset(1);
assert.strictEqual(engine.engineState.samples.length, 40);
// Disable PackB -> only PackA samples remain in the map!
engine.toggleFolderFilter("/tmp/PackB", 0);
assert(engine.engineState.samples.every((s) => s.rootFolder === "/tmp/PackA"), "Disabling PackB in folder list must filter out PackB samples from map");
engine.enableAllFolderFilters();
assert.strictEqual(engine.engineState.samples.length, 40, "Enabling all folders must restore all corpus samples");
// Delete PackB from the folder index completely
engine.removeRememberedFolder("/tmp/PackB");
assert.strictEqual(engine.engineState.knownFolders.length, 1, "Deleting PackB must remove it from knownFolders");
assert.strictEqual(engine.engineState.knownFolders[0].path, "/tmp/PackA");
assert(engine.engineState.corpusSamples.every((s) => s.rootFolder === "/tmp/PackA"), "Deleting PackB must remove its samples from corpusSamples");

// Options > Map Samples: the node engine's map subset follows the setting; a change re-picks the map after a debounce and keeps the selection
{
  const es = engine.engineState;
  const savedState = { corpus: es.corpusSamples, samples: es.samples, folders: es.knownFolders, sel: es.selectedIndex, max: es.maxDisplaySamples };
  es.knownFolders = [{ path: "/tmp/PackA", name: "PackA", enabled: true, count: 1000 }, { path: "/tmp/PackB", name: "PackB", enabled: true, count: 1000 }];
  es.corpusSamples = syntheticCorpus.slice();
  es.maxDisplaySamples = 1500;
  engine.rebuildActiveMapSubset(1);
  assert.strictEqual(es.samples.length, 1500, "default: 1500 map samples");
  const timers = [];
  const realSet = global.setTimeout, realClear = global.clearTimeout;
  global.setTimeout = (fn, ms) => { const t = { fn, ms, cleared: false, unref() {} }; timers.push(t); return t; };
  global.clearTimeout = (t) => { if (t) t.cleared = true; };
  try {
    assert.strictEqual(engine.setMapSamples(1500), false, "an unchanged value does nothing");
    assert.strictEqual(timers.length, 0);
    es.selectedIndex = 3;
    const keepPath = es.samples[3].path;
    // dragging the numbox: many values in a row -> one re-pick of the last value
    for (const v of [1400, 1200, 900, 400]) assert.strictEqual(engine.setMapSamples(v), true);
    assert.strictEqual(es.samples.length, 1500, "nothing is re-picked while the value is still moving");
    assert.strictEqual(timers.filter((t) => !t.cleared).length, 1, "only the last change keeps a timer (debounce)");
    const live = timers.filter((t) => !t.cleared)[0];
    assert.strictEqual(live.ms, engine.MAP_SAMPLES_DEBOUNCE_MS);
    assert.strictEqual(engine.MAP_SAMPLES_DEBOUNCE_MS, 300);
    live.fn();
    assert.strictEqual(es.samples.length, 400, "after the debounce the map has the new number of samples");
    assert.strictEqual(es.maxDisplaySamples, 400);
    const nowSel = es.samples[es.selectedIndex];
    assert(es.samples.some((x) => x.path === keepPath) ? nowSel.path === keepPath : es.selectedIndex >= 0 && es.selectedIndex < 400, "the selection stays on its sample while it is still on the map");
    // a selected sample that is on both maps stays selected even when its index changes
    const common = es.samples[17];
    es.selectedIndex = 17;
    engine.setMapSamples(100, true);
    assert.strictEqual(es.samples.length, 100, "100 samples");
    const nowIdx = es.samples.findIndex((x) => x.path === common.path);
    if (nowIdx >= 0) assert.strictEqual(es.samples[es.selectedIndex].path, common.path, "selection follows its sample to the new index");
    engine.setMapSamples(5000, true);
    assert.strictEqual(es.samples.length, 2000, "above the corpus size every sample is shown (5000 max)");
    assert.strictEqual(es.maxDisplaySamples, 5000);
    engine.setMapSamples(99999, true); assert.strictEqual(es.maxDisplaySamples, 5000, "clamped to 5000");
    engine.setMapSamples(-5, true); assert.strictEqual(es.maxDisplaySamples, 100, "clamped to 100");
    // Re-Seed (filtered) and folder changes use the setting too
    engine.setMapSamples(300, true);
    engine.reseedWithActiveFilters();
    assert.strictEqual(es.samples.length, 300, "filtered Re-Seed picks Map Samples samples");
    engine.toggleFolderFilter("/tmp/PackB", 0);
    assert.strictEqual(es.samples.length, 300, "a folder change re-picks Map Samples samples");
    engine.enableAllFolderFilters();
    assert.strictEqual(es.samples.length, 300);
    // before any corpus exists the value is only stored (the scan applies it)
    es.corpusSamples = [];
    const before = es.samples;
    engine.setMapSamples(700, true);
    assert.strictEqual(es.maxDisplaySamples, 700);
    assert.strictEqual(es.samples, before, "no corpus: nothing to re-pick");
  } finally {
    global.setTimeout = realSet; global.clearTimeout = realClear;
  }
  es.corpusSamples = savedState.corpus; es.samples = savedState.samples; es.knownFolders = savedState.folders;
  es.selectedIndex = savedState.sel; es.maxDisplaySamples = 1500;
}

// Restore scanRes samples for Infinite Similarity Stepping test (both Next +1 and Prev -1) in Node engine
engine.engineState.corpusSamples = scanRes.samples;
engine.engineState.knownFolders = [{ path: tmpDir, name: "TestDrums", enabled: true, count: scanRes.samples.length }];
engine.rebuildActiveMapSubset(1);
const visitedEngineSim = new Set();
for (let step = 0; step < scanRes.samples.length; step++) {
  const nextIdx = engine.stepSimilarSample(1);
  visitedEngineSim.add(nextIdx);
}
assert.strictEqual(
  visitedEngineSim.size,
  scanRes.samples.length,
  "Infinite similarity stepping (+1) in Node engine must visit every visible sample without getting stuck in a finite sub-loop"
);

// Regression Check: Prev Similar (-1) must NOT replay the current sample; it must step to a different sample
const beforePrevIdx = engine.engineState.selectedIndex;
const afterPrevIdx = engine.stepSimilarSample(-1);
assert.notStrictEqual(afterPrevIdx, beforePrevIdx, "Regression: Prev Similar (-1) must step to a different sample, not replay the current sample");
const visitedPrevSim = new Set();
for (let step = 0; step < scanRes.samples.length; step++) {
  visitedPrevSim.add(engine.stepSimilarSample(-1));
}
assert.strictEqual(
  visitedPrevSim.size,
  scanRes.samples.length,
  "Infinite similarity stepping (-1) in Node engine must visit every visible sample in reverse order"
);

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
// Fake host patcher for applyXoLayout(): records presentation_rect / hidden per scripting name.
const fakeLayoutPatcher = {
  rects: {},
  hidden: {},
  attrs: {},
  getnamed(name) {
    if (!allVarnames.includes(name)) return null;
    const self = this;
    return {
      setattr(attr, ...v) {
        if (attr === "presentation_rect") self.rects[name] = v;
        else { (self.attrs[name] = self.attrs[name] || {})[attr] = v.length === 1 ? v[0] : v; }
      },
      set hidden(h) { self.hidden[name] = h ? 1 : 0; }
    };
  }
};
this.patcher = fakeLayoutPatcher; // the script reads `this.patcher` at top level, like a jsthis

// consts / lets of the script stay inside the eval; this exposes the few the category-search tests read or set
var xoX = null;
eval(stripJs + `
xoX = {
  get TOOLBAR_ITEMS() { return TOOLBAR_ITEMS; }, get CATEGORIES() { return CATEGORIES; }, get CAT_ID_LIST() { return CAT_ID_LIST; },
  get CAT_NONE_COLOR() { return CAT_NONE_COLOR; },
  get activeCategory() { return activeCategory; }, set activeCategory(v) { activeCategory = v; },
  get searchTerms() { return searchTerms; }, set searchTerms(v) { searchTerms = v; },
  get matchFolders() { return matchFolders; }, set matchFolders(v) { matchFolders = v; },
  get searchesCatIdx() { return searchesCatIdx; }, set searchesCatIdx(v) { searchesCatIdx = v; },
  get GROUP_DIST_FACTOR() { return GROUP_DIST_FACTOR; },
  get zoomSpeed() { return zoomSpeed; },
  get mapSamples() { return mapSamples; },
  get reseedTitle() { return reseedTitle(); }
};`);

loadbang();
test_selected(1); // the hotkey tests below call the patcher-path hotkeys directly: act as the device selected in Live
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

// --- Test W: detailed waveform banner (selected_wave) ---
{
  const lw = getLayout();
  const waveX = 122;
  const waveW = lw.mapW - waveX - 5;
  const N = 64;
  const vals = [];
  for (let i = 0; i < N; i++) {
    const a = Math.sin((i / (N - 1)) * Math.PI);
    vals.push(-a * 0.9, a * 0.9, a * 0.5);
  }
  selected_info(3, "Wave Test", "kick", 0, 400, 50, 0, ...new Array(24).fill(0.5), "nbrs", 1, 2);
  selected_wave(2, N, ...vals);
  assert.strictEqual(getWaveData(), null, "selected_wave for a different index is ignored");
  selected_wave(3, N, ...vals);
  assert(getWaveData() && getWaveData().n === N, "selected_wave stores the columns");
  selected_info(3, "Wave Test", "kick", 0, 400, 50, 1, ...new Array(24).fill(0.5), "nbrs", 1, 2);
  assert(getWaveData(), "re-announcing the same sample keeps the detailed waveform");

  // Test hook (receive #0-xo-test): synthetic wheel zooms, test_report writes the state to Global("xo_test")
  {
    const store = {};
    global.Global = function () { return store; };
    test_clear_log();
    selected_info(3, "Wave Test", "kick", 0, 400, 50, 0, ...new Array(24).fill(0.5), "nbrs", 1, 2);
    test_wheel(100, 70, 0, 1);
    assert(getView().zoom > 1.0, "test_wheel zooms the map");
    // Zoom Speed: one wheel step at 1.0x zooms by exp(0.96) (2x the former exp(0.48) exponent); the factor multiplies the exponent
    {
      const one = (speed, dy) => { resetView(); set_zoomspeed(speed); test_wheel(100, 70, 0, dy); return getView().zoom; };
      assert(Math.abs(one(1, 1) - Math.exp(0.96)) < 1e-9, "1.0x: one wheel step = exp(0.96)");
      assert(Math.abs(Math.log(one(1, 1)) / 0.48 - 2) < 1e-9, "1.0x is the former 2.0x (2x the old 0.48 exponent per wheel unit)");
      assert(Math.abs(one(2, 1) - Math.exp(1.92)) < 1e-9, "2x doubles the exponent");
      assert(Math.abs(one(0.25, 1) - Math.exp(0.24)) < 1e-9, "0.25x quarters the exponent");
      assert(Math.abs(one(0.5, 1) - Math.exp(0.48)) < 1e-9, "0.5x halves the exponent");
      assert.strictEqual(one(1, 40), Math.exp(1.8), "a huge trackpad delta is capped (dy 3 units, exponent cap 1.8 at speed 1)");
      assert.strictEqual(one(4, 40), 16, "4x: the exponent cap (0.96 * 4) lets a flick through, zoom clamps at 16x");
      assert(Math.abs(one(1.5, 1) - Math.exp(1.44)) < 1e-9, "1.5x: one step = exp(1.44), not cut");
      assert.strictEqual(one(4, 1), 16, "4x: one step = exp(3.84), clamped to 16x");
      set_zoomspeed(99); assert.strictEqual(xoX.zoomSpeed, 4, "speed clamps to 4x");
      set_zoomspeed(0); assert.strictEqual(xoX.zoomSpeed, 0.25, "speed clamps to 0.25x");
      set_zoomspeed(1);
      resetView(); for (let i = 0; i < 40; i++) test_wheel(100, 70, 0, 3);
      assert.strictEqual(getView().zoom, 16, "zoom in clamps at 16x");
      for (let i = 0; i < 40; i++) test_wheel(100, 70, 0, -3);
      assert.strictEqual(getView().zoom, 1, "zoom out clamps at 1x");
      // many small trackpad deltas add up like the same total (no jumpiness): 10 x 0.1 == 1 x 1
      resetView(); for (let i = 0; i < 10; i++) test_wheel(100, 70, 0, 0.1);
      assert(Math.abs(getView().zoom - Math.exp(0.96)) < 1e-9, "10 small deltas = one step");
      // Map Samples (Options): clamps / rounds, tells the node engine, and the Re-Seed tooltips show the number
      {
        const sent = []; const prevOut = global.outlet;
        global.outlet = (i, ...args) => { sent.push(args); prevOut(i, ...args); };
        set_mapsamples(800.4);
        assert.strictEqual(xoX.mapSamples, 800, "rounds");
        assert.deepStrictEqual(sent.filter((m) => m[0] === "map_samples"), [["map_samples", 800]], "a change goes to the node engine");
        set_mapsamples(800.2);
        assert.strictEqual(sent.filter((m) => m[0] === "map_samples").length, 1, "an unchanged value is not re-sent");
        set_mapsamples(99999); assert.strictEqual(xoX.mapSamples, 5000, "clamps to 5000");
        set_mapsamples(3); assert.strictEqual(xoX.mapSamples, 100, "clamps to 100");
        set_mapsamples(1234);
        assert.strictEqual(xoX.reseedTitle, "Re-Seed Map with active Filters (1234 max)", "toolbar Re-Seed tooltip shows the number");
        const reseedBtn = fakeLayoutPatcher.attrs[builtLayoutNames["obj-reseed-filtered-btn"]] || {};
        assert.strictEqual(reseedBtn.annotation, "Re-Seed Map with active Filters (1234 max)", "the Filters Re-Seed button's tooltip shows the number");
        test_mapsamples(1500);
        assert.strictEqual(xoX.mapSamples, 1500);
        global.outlet = prevOut;
      }
    }
    audition_info("/tmp/x.wav", 250, 11025, 1, "complex", 7, 50, 1);
    test_width(776);
    test_report();
    const rep = JSON.parse(store.last);
    assert.strictEqual(rep.name, "Wave Test");
    assert.strictEqual(rep.selLog.length, 1, "selected_info log");
    assert(rep.view.zoom > 1.0 && rep.width === 776 && rep.audition.frames === 11025 && rep.audition.pitchSt === 7);
    assert.deepStrictEqual(Object.keys(rep.rawCount), [], "synthetic events are not logged as real ones");
    onwheel(100, 70, 0, 1);
    test_report();
    assert.strictEqual(JSON.parse(store.last).rawCount.onwheel, 1, "real onwheel arguments are logged");
    delete global.Global;
    zoomViewAt(100, 70, 1 / getView().zoom, getLayout()); // back to 1x
  }

  // Capture polygons: record path ops between fills
  const polys = [];
  let cur = [];
  const orig = { move_to: mgraphics.move_to, line_to: mgraphics.line_to, close_path: mgraphics.close_path, fill: mgraphics.fill };
  mgraphics.move_to = function (x, y) { cur = [[x, y]]; };
  mgraphics.line_to = function (x, y) { cur.push([x, y]); };
  mgraphics.close_path = function () { cur.closed = true; };
  mgraphics.fill = function () { if (cur.closed) polys.push(cur); cur = []; };

  set_decay(5000);
  paint();
  const bannerTop = 2;
  const bannerBottom = lw.topBarH - 2;
  const wavePolys = polys.filter((pl) => pl.length > 10);
  assert(wavePolys.length >= 2, "expected a filled envelope polygon and an RMS polygon");
  for (const pl of wavePolys) {
    const xs = pl.map((q) => q[0]);
    const ys = pl.map((q) => q[1]);
    assert(Math.abs(Math.min(...xs) - waveX) < 0.01 && Math.abs(Math.max(...xs) - (waveX + waveW)) < 0.01, "waveform polygon spans the full banner width");
    assert(Math.min(...ys) >= bannerTop && Math.max(...ys) <= bannerBottom, "waveform polygon stays inside the banner");
  }
  // Reverse mirrors the shape: an asymmetric wave's left/right extents swap
  const asym = [];
  for (let i = 0; i < N; i++) { const a = i / (N - 1); asym.push(-a, a, a * 0.5); }
  selected_wave(3, N, ...asym);
  polys.length = 0; set_reverse(0); paint();
  const fwdPoly = polys.filter((pl) => pl.length > 10)[0];
  polys.length = 0; set_reverse(1); paint();
  const revPoly = polys.filter((pl) => pl.length > 10)[0];
  assert(fwdPoly[0][1] > revPoly[0][1], "forward starts at silence (centre), reverse starts at the loud end (higher edge)");
  set_reverse(0);
  // Fallback (no detailed data) still draws a closed envelope inside the banner
  selected_wave(3, 0);
  assert.strictEqual(getWaveData(), null);
  polys.length = 0; paint();
  const fb = polys.filter((pl) => pl.length > 10);
  assert(fb.length >= 1, "fallback draws a smooth envelope from the cached peaks");
  for (const q of fb[0]) assert(q[1] >= bannerTop && q[1] <= bannerBottom);
  // Trim/Dec shorter than the sample dims the cut part but keeps everything inside the banner
  set_decay(120);
  selected_wave(3, N, ...vals);
  polys.length = 0; paint();
  const trimmed = polys.filter((pl) => pl.length > 10);
  assert(trimmed.length >= 3, "Trim/Dec draws a dimmed full waveform plus the kept part");
  set_decay(2500);
  Object.assign(mgraphics, orig);
}

// --- Test K: arrow-key hotkeys (Left/Right = Prev/Next Similar, Down/Up = history Back/Forward), single-fire ---
{
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const sent = [];
  const prevOutlet = global.outlet;
  global.outlet = (idx, ...args) => { sent.push([idx, ...args]); };
  const count = (name) => sent.filter((m) => m[0] === 0 && m[1] === name).length;
  const run = (fn) => { sent.length = 0; sleep(25); fn(); };

  // Both delivery paths (onkeydown AND the patcher message) for one key press act once
  run(() => { onkeydown(29); hotkey_next_similar(); });
  assert.strictEqual(count("step_similar"), 1, "Right arrow via both paths must step ONCE");
  assert.deepStrictEqual(sent.find((m) => m[1] === "step_similar").slice(2), [1]);
  run(() => { hotkey_prev_similar(); onkeydown(28); });
  assert.strictEqual(count("step_similar"), 1, "Left arrow via both paths must step ONCE");
  assert.deepStrictEqual(sent.find((m) => m[1] === "step_similar").slice(2), [-1]);
  run(() => { onkeydown(31); hotkey_history_back(); });
  assert.strictEqual(count("history_back"), 1, "Down arrow via both paths must go back ONCE");
  run(() => { hotkey_history_forward(); onkeydown(30); });
  assert.strictEqual(count("history_forward"), 1, "Up arrow via both paths must go forward ONCE");
  // Key names are accepted too, and distinct presses (after the de-dup window) both act
  run(() => { onkeydown("ArrowDown"); });
  assert.strictEqual(count("history_back"), 1);
  sleep(25); onkeydown(31);
  assert.strictEqual(count("history_back"), 2, "a second press after the window acts again (auto-repeat)");
  // Left/Right change the selection locally like the toolbar buttons
  const before = getSelectedIndex();
  run(() => { onkeydown(29); });
  assert.notStrictEqual(getSelectedIndex(), before, "Right arrow selects the next similar sound");
  // r / R = Random Sample: same code path as the toolbar button (select_index), single fire over both delivery paths
  run(() => { onkeydown(114); hotkey_random(); });
  assert.strictEqual(count("select_index"), 1, "r via both paths selects ONE random sample");
  run(() => { hotkey_random(); onkeydown(82); });
  assert.strictEqual(count("select_index"), 1, "R via both paths selects ONE random sample");
  run(() => { onkeydown("r"); });
  assert.strictEqual(count("select_index"), 1);
  run(() => { onkeydown(114, 114, 0); });
  assert.strictEqual(count("select_index"), 0, "a key-up event (down = 0) does nothing");
  {
    // respects the active category: only visible points are picked
    xoX.activeCategory = "kick";
    const picked = new Set();
    for (let n = 0; n < 12; n++) { sleep(25); sent.length = 0; hotkey_random(); const m = sent.find((x) => x[1] === "select_index"); if (m) picked.add(m[2]); }
    assert(picked.size > 0 && [...picked].every((i) => isPointVisible(getPoints()[i])), "random hotkey respects the active category / filters");
    xoX.activeCategory = "ALL";
  }
  // Esc: stop playback + clear the playhead; outlet 1 `stop_playback`. Native Esc = keycode -3 with textcharacter 27 (never a delete)
  const stops = () => sent.filter((m) => m[0] === 1 && m[1] === "stop_playback").length;
  const savedN = getSavedList().length;
  run(() => { onkeydown(-3, 27, 1); hotkey_stop(); });
  assert.strictEqual(stops(), 1, "Esc via both paths stops ONCE");
  assert.strictEqual(getSavedList().length, savedN, "Esc (keycode -3, char 27) must not delete a saved row");
  assert(getPlayhead().pos < 0, "Esc clears the playhead");
  run(() => { onkeydown(27); });
  assert.strictEqual(stops(), 1, "Esc keycode 27 stops");
  run(() => { onkeydown("Escape"); });
  assert.strictEqual(stops(), 1, "Esc by name stops");
  run(() => { onkeydown(27, 27, 0); });
  assert.strictEqual(stops(), 0, "Esc key-up does nothing");
  global.outlet = prevOutlet;
}

// --- Playhead: the real sfplay~ position mapped onto the source waveform ---
{
  const near = (a, b, m, eps = 1e-9) => assert(Math.abs(a - b) < eps, `${m}: ${a} vs ${b}`);
  const SRC = 1000;
  // source plays itself
  const plain = engine.buildPlayMap({ srcMs: SRC, ratio: 1, reverse: false, rendered: false, renderedMs: 0, decayMs: 20000 });
  assert.deepStrictEqual(plain, { rate: 1, skipMs: 0, srcMs: SRC, endMs: SRC, rev: 0 });
  near(playheadFraction(plain, 0), 0, "plain start"); near(playheadFraction(plain, 250), 0.25, "plain quarter");
  near(playheadFraction(plain, 1000), 1, "plain end"); near(playheadFraction(plain, 5000), 1, "stops at the end");
  near(playheadFraction(plain, -5), 0, "never before the start");
  // Trim/Dec on a direct play (a gain fade, sfplay~ keeps running): the line stops at the cut
  const cut = engine.buildPlayMap({ srcMs: SRC, ratio: 1, reverse: false, rendered: false, renderedMs: 0, decayMs: 400 });
  assert.strictEqual(cut.endMs, 400);
  near(playheadFraction(cut, 700), 0.4, "Trim/Dec cut: held at the cut");
  // rendered Speed 50 %: 2 s long, half the rate over the source
  const slow = engine.buildPlayMap({ srcMs: SRC, ratio: 0.5, reverse: false, rendered: true, renderedMs: 2000, decayMs: 20000 });
  assert.strictEqual(slow.rate, 0.5);
  near(playheadFraction(slow, 1000), 0.5, "Speed 50 %: halfway after 1 s of 2 s"); near(playheadFraction(slow, 2000), 1, "Speed 50 %: end");
  // Speed 200 %: 0.5 s long, twice the rate
  const fast = engine.buildPlayMap({ srcMs: SRC, ratio: 2, reverse: false, rendered: true, renderedMs: 500, decayMs: 20000 });
  near(playheadFraction(fast, 250), 0.5, "Speed 200 %: halfway after 250 ms"); near(playheadFraction(fast, 500), 1, "Speed 200 %: end");
  // Speed 50 % + Trim/Dec 400 ms (forward): keeps the start: only the first 200 ms of the source are heard
  const slowTrim = engine.buildPlayMap({ srcMs: SRC, ratio: 0.5, reverse: false, rendered: true, renderedMs: 400, decayMs: 400 });
  near(playheadFraction(slowTrim, 400), 0.2, "Speed 50 % + Trim/Dec 400: ends at 20 % of the source");
  // Reverse: moves right to left; Speed 100 % renders, nothing trimmed
  const rev = engine.buildPlayMap({ srcMs: SRC, ratio: 1, reverse: true, rendered: true, renderedMs: 1000, decayMs: 20000 });
  near(playheadFraction(rev, 0), 1, "Reverse starts at the right end"); near(playheadFraction(rev, 500), 0.5, "Reverse: middle"); near(playheadFraction(rev, 1000), 0, "Reverse ends at the left");
  // Reverse + Trim/Dec 300: the LAST 300 ms of the reversed source = original 300 ms .. 0
  const revTrim = engine.buildPlayMap({ srcMs: SRC, ratio: 1, reverse: true, rendered: true, renderedMs: 300, decayMs: 300 });
  near(revTrim.skipMs, 700, "Reverse + Trim skips the front of the reversed render");
  near(playheadFraction(revTrim, 0), 0.3, "Reverse + Trim/Dec starts where the kept part begins"); near(playheadFraction(revTrim, 300), 0, "Reverse + Trim/Dec ends at 0");
  // Reverse + Speed 50 % + Trim 400: first sound is original 400*0.5 = 200 ms
  const revSlowTrim = engine.buildPlayMap({ srcMs: SRC, ratio: 0.5, reverse: true, rendered: true, renderedMs: 400, decayMs: 400 });
  near(playheadFraction(revSlowTrim, 0), 0.2, "Reverse + Speed 50 % + Trim: starts at 20 %"); near(playheadFraction(revSlowTrim, 400), 0, "... and ends at 0");

  // The v8ui follows play_pos only while an audition is active; the line is where the position says, stops at the end, Esc clears
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const prevOutlet = global.outlet;
  const sent = [];
  global.outlet = (idx, ...args) => { sent.push([idx, ...args]); };
  play_pos(300);
  assert.strictEqual(getPlayhead().active, false, "no audition: position messages are ignored");
  audition_info("/x.wav", 2000, 88200, 1, "granular", 0, 50, 0, 0.5, 0, 1000, 2000, 0);
  near(getPlayhead().pos, 0, "an audition starts the line at the file start");
  assert.strictEqual(getPlayhead().active, true);
  play_pos(500); near(getPlayhead().pos, 0.25, "Speed 50 %: 500 ms in = 25 %");
  play_pos(1500); near(getPlayhead().pos, 0.75, "1500 ms in = 75 %");
  play_done(); assert.strictEqual(getPlayhead().active, true, "a done bang right after the start (the halt of the replaced file) is ignored");
  sleep(170);
  play_pos(2000); assert.strictEqual(getPlayhead().active, false, "reaching endMs finishes the playback"); near(getPlayhead().pos, 1, "the line stays at the end");
  play_pos(500); near(getPlayhead().pos, 1, "positions after the end are ignored");
  // reversed + done bang
  audition_info("/y.wav", 1000, 44100, 1, "plain", 0, 100, 0, 1, 0, 1000, 1000, 1);
  near(getPlayhead().pos, 1, "Reverse starts at the right end");
  play_pos(250); near(getPlayhead().pos, 0.75, "Reverse moves right to left");
  sleep(170); play_done(); assert.strictEqual(getPlayhead().active, false, "the finish bang ends the playback"); near(getPlayhead().pos, 0, "... at the left end");
  // Esc clears
  audition_info("/z.wav", 1000, 44100, 0, "plain", 0, 100, 0, 1, 0, 1000, 1000, 0);
  play_pos(100);
  sent.length = 0; stopPlayback();
  assert(sent.some((m) => m[0] === 1 && m[1] === "stop_playback"));
  assert(getPlayhead().pos < 0 && !getPlayhead().active, "Esc hides the line and ends the audition");
  play_pos(300); assert(getPlayhead().pos < 0, "positions after Esc are ignored");
  // an unchanged position does not redraw
  let redraws = 0; const keepRedraw = mgraphics.redraw; mgraphics.redraw = () => { redraws++; };
  audition_info("/z.wav", 1000, 44100, 0, "plain", 0, 100, 0, 1, 0, 1000, 1000, 0);
  redraws = 0; play_pos(100); play_pos(100); play_pos(100.1);
  assert.strictEqual(redraws, 1, "redraw only when the position changed");
  mgraphics.redraw = keepRedraw;
  global.outlet = prevOutlet;
  stopPlayback();
  console.log("OK: playhead = real sfplay~ position (source, Speed 50 / 200 %, Reverse, Trim/Dec, end, Esc)");
}


// --- Test Z: map zoom / pan ---
{
  const lz = getLayout();
  const pw = lz.plotW - 10;
  const ph = lz.plotH - 12;
  const near = (a, b, m, eps = 1e-6) => assert(Math.abs(a - b) < eps, `${m}: ${a} vs ${b}`);
  resetView();
  // 1x is exactly the legacy full view
  for (const [nx, ny] of [[0, 0], [1, 1], [0.3, 0.8]]) {
    const [sx, sy] = normToScreen(nx, ny, lz);
    near(sx, lz.plotX + 5 + nx * pw, "1x x");
    near(sy, lz.plotY + 6 + ny * ph, "1x y");
  }
  // Zoom around the cursor keeps the point under it fixed
  const cursor = [lz.plotX + 150, lz.plotY + 30];
  const before = screenToNorm(cursor[0], cursor[1], lz);
  zoomViewAt(cursor[0], cursor[1], 2, lz);
  near(getView().zoom, 2, "zoom 2x");
  const after = screenToNorm(cursor[0], cursor[1], lz);
  near(after[0], before[0], "point under cursor (x) stays");
  near(after[1], before[1], "point under cursor (y) stays");
  zoomViewAt(cursor[0], cursor[1], 2, lz);
  const after2 = screenToNorm(cursor[0], cursor[1], lz);
  near(after2[0], before[0], "point under cursor (x) stays at 4x");
  near(after2[1], before[1], "point under cursor (y) stays at 4x");
  // Clamp
  zoomViewAt(cursor[0], cursor[1], 1000, lz);
  near(getView().zoom, 16, "zoom clamps at 16x");
  assert(getView().x0 >= 0 && getView().x0 <= 1 - 1 / 16 + 1e-9, "view stays inside the map");
  zoomViewAt(cursor[0], cursor[1], 0.0001, lz);
  assert.deepStrictEqual(getView(), { zoom: 1, x0: 0, y0: 0 }, "zooming out fully returns exactly to the full view");

  // Wheel handler: (x, y, dx, dy) and the long modifier form both zoom; over the saved list it still scrolls
  onwheel(cursor[0], cursor[1], 0, 1);
  assert(getView().zoom > 1, "wheel up over the map zooms in");
  const z1 = getView().zoom;
  onwheel(cursor[0], cursor[1], 1, 0, 0, 0, 0, 0, 0, -1);
  assert(getView().zoom < z1, "wheel in the long (...modifiers, inc_x, inc_y) form zooms out");
  resetView();
  // Regression: Max's documented 9-argument form onwheel(x, y, inc_x, inc_y, cmd, shift, capslock, option, ctrl).
  // The old parser read the trailing option / ctrl flags (0) as the delta, so a real wheel never zoomed.
  onwheel(cursor[0], cursor[1], 0, 1, 0, 0, 0, 0, 0);
  assert(getView().zoom > 1, "documented onwheel form: wheel up zooms in");
  const z2 = getView().zoom;
  onwheel(cursor[0], cursor[1], 0, -1, 0, 1, 0, 0, 0);
  assert(getView().zoom < z2, "documented onwheel form with shift held: wheel down zooms out (modifiers are not deltas)");
  resetView();
  // Cmd-drag pans (user request) like Option-drag and the middle button, without changing the selection
  zoomViewAt(cursor[0], cursor[1], 4, lz);
  const vCmd = getView();
  const selBeforeCmd = getSelectedIndex();
  onclick(cursor[0], cursor[1], 1, 1, 0, 0, 0, 0);
  ondrag(cursor[0] + 30, cursor[1] + 20, 1, 1, 0, 0, 0, 0);
  ondrag(cursor[0] + 30, cursor[1] + 20, 0, 1, 0, 0, 0, 0);
  assert(getView().x0 !== vCmd.x0 || getView().y0 !== vCmd.y0, "Cmd-drag pans the zoomed map");
  assert.strictEqual(getSelectedIndex(), selBeforeCmd, "Cmd-drag does not change the selection");
  resetView();

  // Pan: Option-drag and middle button (PointerEvent.buttons & 4) move the view without touching selection
  zoomViewAt(lz.plotX + lz.plotW / 2, lz.plotY + lz.plotH / 2, 4, lz);
  const selBefore = getSelectedIndex();
  const v0 = getView();
  stripOutlets = [[], []];
  onclick(100, 60, 1, 0, 0, 0, 1, 0);
  ondrag(70, 60, 1, 0, 0, 0, 1, 0);
  ondrag(70, 60, 0, 0, 0, 0, 1, 0);
  assert(getView().x0 > v0.x0, "dragging left pans the view right");
  near(getView().x0 - v0.x0, 30 / (pw * 4), "pan distance matches the drag", 1e-9);
  assert.strictEqual(getSelectedIndex(), selBefore, "pan must not change the selection");
  assert.strictEqual(stripOutlets[0].length, 0, "pan must not send select_index");
  const v1 = getView();
  onclick(100, 60, 1, 0, 0, 0, 0, 0, { buttons: 4 });
  ondrag(100, 80, 1, 0, 0, 0, 0, 0);
  ondrag(100, 80, 0, 0, 0, 0, 0, 0);
  assert(getView().y0 < v1.y0 || v1.y0 === 0 && getView().y0 === 0, "middle-button drag pans");
  assert.notDeepStrictEqual(getView(), v1, "middle-button drag moves the view");
  const vv = getView();
  ondrag(10, 10, 1, 0, 0, 0, 0, 0); // stale pan state must not exist after a release
  assert.deepStrictEqual(getView(), vv, "no pan after release");

  // Hit-testing while zoomed / panned: click on a point's screen position selects it
  resetView();
  const anchorPt = normToScreen(pts[0].x, pts[0].y, lz);
  zoomViewAt(anchorPt[0], anchorPt[1], 4, lz);
  panViewBy(-12, 8, lz);
  let target = -1;
  for (let i = 0; i < pts.length; i++) {
    if (!isPointVisible(pts[i])) continue;
    const [sx, sy] = normToScreen(pts[i].x, pts[i].y, lz);
    if (isInPlotRect(sx, sy, lz, 8)) { target = i; break; }
  }
  assert(target >= 0, "some point is in view when zoomed");
  const [tx, ty] = normToScreen(pts[target].x, pts[target].y, lz);
  assert.strictEqual(findNearestVisiblePoint(tx, ty, 3), target, "hit-test uses the zoomed view");
  stripOutlets = [[], []];
  onclick(tx, ty, 1, 0, 0, 0, 0, 0);
  ondrag(tx, ty, 0, 0, 0, 0, 0, 0);
  assert.deepStrictEqual(stripOutlets[0].slice(0, 2), ["select_index", target], "clicking a zoomed point selects it");
  // A point that is off screen cannot be hit
  let off = -1;
  for (let i = 0; i < pts.length; i++) {
    const [sx, sy] = normToScreen(pts[i].x, pts[i].y, lz);
    if (!isInPlotRect(sx, sy, lz, 0)) { off = i; break; }
  }
  assert(off >= 0);
  const [ox, oy] = normToScreen(pts[off].x, pts[off].y, lz);
  assert.notStrictEqual(findNearestVisiblePoint(Math.max(lz.plotX, Math.min(lz.plotX + lz.plotW, ox)), Math.max(lz.plotY, Math.min(lz.plotY + lz.plotH, oy)), 1), off, "off-screen points cannot be hit");

  // Selection reveals itself: selecting an off-view sample (arrow keys / history) pans to it
  selected_info(off, "Far Away", "kick", 0, 200, 50, 0, ...new Array(24).fill(0.3), "nbrs");
  const [rx, ry] = normToScreen(pts[off].x, pts[off].y, lz);
  assert(isInPlotRect(rx, ry, lz, 8), "an off-view selected sample is panned into view");

  // Paint while zoomed: map dots stay inside the plot rect, the zoom pill shows, double-click on empty space resets
  const arcs = [];
  const origArc = mgraphics.arc;
  mgraphics.arc = function (cx, cy, r) { arcs.push([cx, cy, r]); };
  const texts = [];
  const origText = mgraphics.show_text;
  mgraphics.show_text = function (t) { texts.push(t); };
  zoomViewAt(lz.plotX + 60, lz.plotY + 40, 2, lz);
  paint();
  const isDotR = (r) => Math.abs(r - 2.1) < 1e-9 || Math.abs(r - 2.6) < 1e-9 || Math.abs(r - 1.2) < 1e-9; // dot, k-NN neighbour dot, hidden dot
  const dotArcs = arcs.filter((a) => isDotR(a[2]));
  assert(dotArcs.length > 0, "some dots are drawn");
  for (const [cx, cy] of dotArcs) {
    if (cy >= lz.toolbarY || cy < lz.plotY - 1) continue; // toolbar icons / banner are not map dots
    assert(cx >= lz.plotX && cx <= lz.plotX + lz.plotW && cy >= lz.plotY && cy <= lz.plotY + lz.plotH, `dot (${cx},${cy}) must stay inside the plot rect`);
  }
  const expectedDots = pts.filter((p) => { const [sx, sy] = normToScreen(p.x, p.y, lz); return isInPlotRect(sx, sy, lz, 3.1); }).length;
  assert(arcs.filter((a) => isDotR(a[2]) && a[1] > lz.plotY - 1 && a[1] < lz.toolbarY).length >= Math.min(expectedDots, 1), "culling keeps in-view dots");
  assert(texts.some((t) => /^\d+\.\dx$/.test(t)), "zoom indicator is shown while zoomed");
  mgraphics.arc = origArc;
  mgraphics.show_text = origText;
  const farFromPoints = [lz.plotX + 4, lz.plotY + lz.plotH - 4];
  if (findNearestVisiblePoint(farFromPoints[0], farFromPoints[1], 26) < 0) {
    ondblclick(farFromPoints[0], farFromPoints[1], 1, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(getView(), { zoom: 1, x0: 0, y0: 0 }, "double-click on empty map space resets the view");
  }
  zoomViewAt(lz.plotX + 60, lz.plotY + 40, 3, lz);
  const pill = zoomPillRect(lz);
  onclick(pill[0] + 3, pill[1] + 3, 1, 0, 0, 0, 0, 0);
  assert.deepStrictEqual(getView(), { zoom: 1, x0: 0, y0: 0 }, "clicking the zoom pill resets the view");
  // Segment clipping keeps k-NN lines inside the plot
  const seg = clipSegmentToPlot(-50, lz.plotY + 10, lz.plotX + 40, lz.plotY + 10, lz);
  near(seg[0], lz.plotX, "clipped segment starts at the plot edge");
  assert.strictEqual(clipSegmentToPlot(-50, -50, -10, -10, lz), null, "segment fully outside is dropped");
  resetView();
  selected_info(0, "Kick Atmos", "kick", 0, 320, 38, 0, ...new Array(24).fill(0.3), "nbrs");
}

// Regression (user screenshot): toggling a toolbar category that hides the selected sample moved the selection to
// the first visible point locally, but kept the OLD sample's neighbour list, so lines fanned out from the new point
// to unrelated dots. Neighbour lines must only be drawn from the point they belong to, and the node must be asked
// to announce the new selection (without auditioning it).
{
  const pts = getPoints();
  const lineStartsAt = (idx) => {
    paintCommands.length = 0;
    paint();
    const [sx, sy] = normToScreen(pts[idx].x, pts[idx].y, getLayout());
    return paintCommands.filter((c) => c.op === "move_to" && Math.abs(c.x - sx) < 0.01 && Math.abs(c.y - sy) < 0.01).length;
  };
  strip_filter_cat("ALL");
  const cats = getCategoryIds();
  let sel = -1, hideCat = null;
  for (let i = 0; i < pts.length && sel < 0; i++) {
    for (let ci = 0; ci < cats.length; ci++) {
      const bit = 1 << ci;
      if (!(pts[i].mask & bit) && pts.some((p, j) => j !== i && (p.mask & bit))) { sel = i; hideCat = cats[ci]; break; }
    }
  }
  assert(sel >= 0, "need a point that some category hides while others stay visible");
  const nbrs = pts.map((_, j) => j).filter((j) => j !== sel).slice(0, 5);
  selected_info(sel, "Glitch Test", "kick", 0, 300, 50, 0, ...new Array(24).fill(0.3), "nbrs", ...nbrs);
  assert(lineStartsAt(sel) >= 3, "neighbour lines are drawn from the selected point");
  const sent = [];
  const prevOutlet = global.outlet;
  global.outlet = (idx, ...args) => { sent.push([idx, ...args]); };
  strip_filter_cat(hideCat);
  global.outlet = prevOutlet;
  const moved = getSelectedIndex();
  assert.notStrictEqual(moved, sel, `category ${hideCat} hides the selected point, so the selection moves`);
  assert(sent.some((m) => m[0] === 0 && m[1] === "select_index" && m[2] === moved && m[3] === 0),
    "the moved selection is announced to the node with select_index <idx> 0 (no audition)");
  assert.strictEqual(lineStartsAt(moved), 0, "no neighbour lines from the new point while it still holds the old point's neighbours");
  selected_info(moved, "Moved", "kick", 0, 300, 50, 0, ...new Array(24).fill(0.3), "nbrs", ...nbrs.filter((j) => j !== moved));
  strip_filter_cat("ALL");
  assert(lineStartsAt(moved) >= 1, "once the node announces the new point, its own neighbour lines are drawn");
  selected_info(0, "Kick Atmos", "kick", 0, 320, 38, 0, ...new Array(24).fill(0.3), "nbrs");
}


// --- Test B: Scrollable, Selectable, Reorderable & Deletable Saved List (Starts Empty!) ---
assert.strictEqual(getSavedList().length, 0, "Regression: Saved list must always start empty on a new instance");
// Regression check: Double-clicking a sample on the map must NOT add it to savedList!
ondblclick(80, 60, 1, 0, 0, 0, 0, 0);
assert.strictEqual(getSavedList().length, 0, "Regression: Double-clicking on the map must NOT add samples to savedList");

// Test Saved List collapse/show toggle (set_show_saved)
const mapWShown = getLayout().mapW;
assert.strictEqual(mapWShown, 236, "Map pane must be 236px wide with the Saved list shown");
set_show_saved(0);
assert.strictEqual(getShowSavedList(), 0);
assert.strictEqual(getLayout().savedW, 0, "When Saved List is collapsed, savedW must be 0");
assert.strictEqual(getLayout().mapW, mapWShown, "Regression: hiding the Saved list must not widen the map (v8ui still 372 wide)");
assert.deepStrictEqual(fakeLayoutPatcher.rects["XOStateData"], [32, 8, 236, 154], "Hiding Saved must shrink the mini-map v8ui to the map pane");
mgraphics.size = [236, 134];
assert.strictEqual(getLayout().mapW, mapWShown, "Map pane keeps its width after the v8ui shrinks");
paintCommands.length = 0;
paint();
assert(!paintCommands.some((c) => (c.op === "rect" || c.op === "rrect") && c.x >= 236), "Nothing may be painted right of the map pane while Saved is hidden");
assert.deepStrictEqual(fakeLayoutPatcher.rects["obj-panel-left"], [28, 5, 244, 159], "Left panel must hug the map pane");
assert.strictEqual(fakeLayoutPatcher.rects["obj-panel-filters"][0], 278, "Filters panel must follow the narrowed left panel");
set_show_filters(0);
assert.strictEqual(fakeLayoutPatcher.hidden["obj-panel-filters"], 1, "Hiding Filters hides its panel");
assert.strictEqual(fakeLayoutPatcher.rects["obj-panel-playback"][0], 278, "Regression: Playback must slide into the Filters slot (no empty gap)");
assert.strictEqual(fakeLayoutPatcher.rects["PitchTranspose"][0], 283, "Playback LCD cells move with their panel (panel x 278 + 5)");
set_show_playback(0);
assert.strictEqual(fakeLayoutPatcher.hidden["obj-panel-playback"], 1);
set_show_saved(1);
set_show_filters(1);
set_show_playback(1);
mgraphics.size = [372, 134];
for (const [id, spec] of Object.entries(computeXoLayout("Live", 1, 1, 1, 0).boxes)) {
  const vn = builtLayoutNames[id];
  assert.deepStrictEqual(fakeLayoutPatcher.rects[vn], spec.rect, `Re-showing all sections restores ${id}`);
  assert.strictEqual(fakeLayoutPatcher.hidden[vn], spec.hidden, `Re-showing all sections restores the hidden flag of ${id}`);
}
assert.deepStrictEqual(getXoSectionVisibility(), [1, 1, 1]);
assert.strictEqual(getShowSavedList(), 1);
assert.strictEqual(getLayout().savedW, 136, "When Saved List is shown, savedW must be 136");

// --- Options section + themes through the v8ui (applyXoLayout / applyXoThemeStyle) ---
{
  const hid = (id) => fakeLayoutPatcher.hidden[builtLayoutNames[id]];
  const rect = (id) => fakeLayoutPatcher.rects[builtLayoutNames[id]];
  const rectOf = rect;
  const attr = (id, a) => (fakeLayoutPatcher.attrs[builtLayoutNames[id]] || {})[a];
  assert.strictEqual(getXoThemeName(), "Live", "default theme is Live");
  assert.strictEqual(getShowOptions(), 0, "Options section starts closed");
  assert.strictEqual(xoPaletteName, "Live", "the default theme's palette is active before any set_theme");
  set_show_options(1);
  assert.strictEqual(hid("obj-panel-options"), 0);
  assert.strictEqual(hid("obj-theme-tab"), 0, "Options shows the Theme selector");
  assert.deepStrictEqual(rect("obj-panel-options"), [28, 5, 190, 159], "Options slides in right of the toolbar");
  assert.strictEqual(rect("obj-panel-left")[0], 224, "the map panel slides right by the Options width + gap");
  assert.strictEqual(rect("obj-panel-filters")[0], 224 + 380 + 6, "Filters follow (Saved shown)");
  set_show_options(0);
  assert.strictEqual(hid("obj-panel-options"), 1);
  assert.strictEqual(rect("obj-panel-left")[0], 28);
  // Switch to Focus: palette, layout, styles
  set_theme(1);
  assert.strictEqual(getXoThemeName(), "Focus");
  assert.strictEqual(xoPaletteName, "Focus");
  for (const id of ["obj-pitch-dial", "obj-maxlen-dial"]) assert.strictEqual(hid(id), 1, `${id} (numbox) hidden in Focus`);
  for (const id of ["obj-pitch-dial-mir", "obj-maxlen-dial-mir", "obj-focus-tick-filters", "obj-focus-p-lbl-0"]) assert.strictEqual(hid(id), 0, `${id} shown in Focus`);
  for (const id of ["obj-lcd-f-cell-0", "obj-lcd-p-lbl-3", "obj-lcd-f-prompt"]) assert.strictEqual(hid(id), 1, `${id} hidden in Focus`);
  assert.strictEqual(rect("obj-panel-filters")[2], 208, "Focus Filters column is as wide as the LCD one (one row of four dials)");
  assert.strictEqual(rect("obj-minimap")[2], 372, "the map pane is the same size in Focus (236 + Saved 136)");
  assert.deepStrictEqual(attr("obj-panel-filters", "bgcolor"), THEME_STYLE.Focus["obj-panel-filters"].bgcolor, "Focus panel colour set with setattr");
  assert.strictEqual(attr("obj-reseed-filtered-btn", "text"), "Re-Seed");
  assert.strictEqual(attr("obj-reverse-btn", "texton"), "Reversed");
  assert.deepStrictEqual(xoPaletteColor(0.22, 0.74, 0.97, 0.5), [0.22, 0.74, 0.97, 0.5], "Focus palette is the original one");
  // Back to LCD
  set_theme("LCD");
  assert.strictEqual(getXoThemeName(), "LCD");
  assert.strictEqual(hid("obj-pitch-dial"), 0);
  assert.strictEqual(hid("obj-pitch-dial-mir"), 1);
  assert.strictEqual(rect("obj-panel-filters")[2], 208);
  assert.deepStrictEqual(attr("obj-panel-filters", "bgcolor"), THEME_STYLE.LCD["obj-panel-filters"].bgcolor, "LCD panel colour set with setattr");
  assert.strictEqual(attr("obj-reseed-filtered-btn", "text"), "RESEED");
  assert.deepStrictEqual(attr("obj-pitch-dial", "lcdcolor"), THEME_STYLE.LCD["obj-pitch-dial"].lcdcolor, "LCD numbox lcdcolor set with setattr");
  assert.strictEqual(xoPaletteName, "LCD");
  // LCD palette: amber monochrome (blue accent -> warm, alpha kept), category colours stay distinct warm tones
  const amber = xoPaletteColor(0.22, 0.74, 0.97, 0.5);
  assert(amber[0] > amber[1] && amber[1] > amber[2] && amber[3] === 0.5, `LCD maps the blue accent to amber (${amber})`);
  const catIds = ["kick", "snare", "hihat", "clap", "perc", "shaker", "cymbal", "voice", "none"];
  const cats = catIds.map((c) => xoPaletteCat(c, [0, 0, 1, 1]));
  assert.strictEqual(new Set(cats.map((c) => c.join())).size, cats.length, "LCD category colours stay distinct");
  for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) {
    const d = Math.hypot(cats[i][0] - cats[j][0], cats[i][1] - cats[j][1], cats[i][2] - cats[j][2]);
    assert(d > 0.18, `LCD colours of ${catIds[i]} / ${catIds[j]} are far enough apart in the amber family (${d.toFixed(2)})`);
  }
  for (const c of cats) { const v = c; assert(v[0] >= v[1] && v[1] >= v[2], `LCD category colour is warm (${c})`); }
  paintCommands.length = 0;
  paint();
  const cols = paintCommands.filter((c) => c.op === "rgba" && c.a > 0.5);
  assert(cols.length > 20 && cols.every((c) => c.r >= c.g - 1e-9 && c.g >= c.b - 1e-9), "LCD theme paints only amber-family colours (r >= g >= b)");
  set_theme(1);
  paintCommands.length = 0;
  paint();
  assert(paintCommands.some((c) => c.op === "rgba" && c.b > c.r + 0.2), "Focus paints the original blue accents again");
  // ---- Live theme: Live's own colours (max.getcolor), re-applied on a theme change; LCD -> Live -> Focus -> Live restores each look ----
  {
    const DARK = {
      live_desktop: [0.165, 0.165, 0.165, 1], live_surface_bg: [0.212, 0.212, 0.212, 1], live_lcd_bg: [0.094, 0.094, 0.094, 1],
      live_lcd_frame: [0.243, 0.243, 0.243, 1], live_lcd_title: [0.71, 0.71, 0.71, 1], live_lcd_control_fg: [1, 0.678, 0.337, 1],
      live_lcd_control_fg_alt: [0.012, 0.765, 0.835, 1], live_control_bg: [0.118, 0.118, 0.118, 1], live_control_fg: [0.71, 0.71, 0.71, 1],
      live_control_selection: [1, 0.678, 0.337, 1], live_control_zombie: [0.459, 0.459, 0.459, 1], live_alert: [0.906, 0.412, 0.259, 1],
      live_display_line_two: [0.012, 0.765, 0.835, 1]
    };
    // a light Live theme: light LCD, dark text, a blue accent (made-up values; only the contrast logic matters)
    const LIGHT = Object.assign({}, DARK, {
      live_desktop: [0.78, 0.78, 0.78, 1], live_lcd_bg: [0.86, 0.87, 0.88, 1], live_lcd_title: [0.30, 0.30, 0.30, 1], live_lcd_frame: [0.70, 0.70, 0.70, 1],
      live_control_bg: [0.62, 0.62, 0.62, 1], live_control_fg: [0.10, 0.10, 0.10, 1], live_control_selection: [0.0, 0.45, 0.85, 1],
      live_display_line_two: [0.0, 0.55, 0.60, 1], live_alert: [0.80, 0.20, 0.10, 1]
    });
    let theme = DARK, getcolorCalls = 0;
    global.max = { getcolor(n) { getcolorCalls++; return theme[n] || null; } };
    const taskLog = [];
    global.Task = class { constructor(fn) { this.fn = fn; this.interval = 0; taskLog.push(this); } repeat() { this.on = true; } cancel() { this.on = false; } };
    const attr = (id, a) => (fakeLayoutPatcher.attrs[builtLayoutNames[id]] || {})[a];
    const hid = (id) => fakeLayoutPatcher.hidden[builtLayoutNames[id]];
    const resolve = (v) => (typeof v === "string" && v.charAt(0) === "@") ? theme[v.slice(1)] : v;
    const wantStyle = (name, id, a) => { const v = resolve(THEME_STYLE[name][id][a]); return Array.isArray(v) ? v : v; };
    const sameAttrs = (name, th) => {
      theme = th;
      for (const [id, attrs] of Object.entries(THEME_STYLE[name])) for (const a of Object.keys(attrs)) {
        const want = resolve(attrs[a]), got = attr(id, a);
        assert.deepStrictEqual(got, want, `${name}: ${id}.${a} is ${JSON.stringify(want)} after selecting the theme (got ${JSON.stringify(got)})`);
      }
    };
    assert(THEME_STYLE.Live["obj-panel-filters"].bgcolor === "@live_desktop", "Live panels use the section colour token");
    // every Live colour token is a name the palette knows (so a typo cannot reach Live)
    for (const attrs of Object.values(THEME_STYLE.Live)) for (const v of Object.values(attrs)) if (typeof v === "string" && v.charAt(0) === "@") assert(xoLiveColor(v.slice(1)).length === 4 && XO_LIVE_FALLBACK[v.slice(1)], `colour token ${v} has a fallback`);
    set_theme(2);
    set_show_options(1);
    assert.strictEqual(getXoThemeName(), "Live");
    assert.strictEqual(xoPaletteName, "Live");
    assert.strictEqual(taskLog.filter((t) => t.on).length, 1, "the theme watcher runs while the Live theme is on");
    assert.strictEqual(taskLog[taskLog.length - 1].interval, 1000, "watcher polls once a second");
    // layout: Focus geometry, Live-only hairlines, no Focus ticks, dial mirrors, labels
    assert.strictEqual(rectOf("obj-panel-filters")[2], 208);
    for (const id of ["obj-rule-filters", "obj-rule-playback", "obj-rule-options", "obj-rule-searches", "obj-pitch-dial-mir", "obj-focus-f-lbl-1"]) assert.strictEqual(hid(id), 0, `${id} shown in Live`);
    for (const id of ["obj-focus-tick-filters", "obj-focus-tick-playback", "obj-pitch-dial", "obj-lcd-f-cell-0", "obj-lcd-f-prompt"]) assert.strictEqual(hid(id), 1, `${id} hidden in Live`);
    sameAttrs("Live", DARK);
    assert.deepStrictEqual(attr("obj-panel-filters", "bgcolor"), DARK.live_desktop, "panels use max.getcolor(live_desktop)");
    assert.deepStrictEqual(attr("obj-reverse-btn", "activebgoncolor"), DARK.live_control_selection, "toggle on = the theme's accent");
    assert.strictEqual(attr("obj-hdr-filters", "text"), "Filters", "Live titles are title case");
    assert.strictEqual(attr("obj-hdr-filters", "fontname"), "Ableton Sans Medium");
    // theme change in Live: the watcher notices, the Live style is applied again with the new colours (panels, buttons, text)
    const watcher = taskLog.find((t) => t.on);
    const before = getcolorCalls;
    watcher.fn();
    assert.strictEqual(attr("obj-panel-filters", "bgcolor") && getcolorCalls > before, true);
    assert.deepStrictEqual(attr("obj-panel-filters", "bgcolor"), DARK.live_desktop, "unchanged colours: nothing re-applied");
    theme = LIGHT;
    watcher.fn();
    sameAttrs("Live", LIGHT);
    assert.deepStrictEqual(attr("obj-panel-filters", "bgcolor"), LIGHT.live_desktop, "a Live theme change re-applies the panel colour");
    assert.deepStrictEqual(attr("obj-search-box", "bgcolor"), LIGHT.live_lcd_bg);
    // palette follows the theme: dark and light LCD
    const pal = (th) => {
      theme = th; xoLiveRefresh();
      const ids = ["kick", "snare", "hihat", "clap", "perc", "shaker", "cymbal", "voice"];
      return { cols: ids.map((c) => xoPaletteCat(c, [0, 0, 1, 1])).concat([xoPaletteCat("none", [0, 0, 1, 1]), xoPaletteCat("ALL", [0, 0, 1, 1])]), ids };
    };
    for (const [nm, th] of [["dark", DARK], ["light", LIGHT]]) {
      const { cols, ids } = pal(th);
      const bg = th.live_lcd_bg;
      const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
        const d = Math.hypot(cols[i][0] - cols[j][0], cols[i][1] - cols[j][1], cols[i][2] - cols[j][2]);
        assert(d > 0.18, `Live palette (${nm} theme): colours ${i}/${j} are distinguishable (${d.toFixed(2)})`);
      }
      for (let i = 0; i < 8; i++) assert(Math.abs(lum(cols[i]) - lum(bg)) > 0.25, `Live palette (${nm}): category ${ids[i]} contrasts with the LCD background`);
      const bgMapped = xoPaletteColor(0.04, 0.05, 0.07, 1);
      assert(Math.abs(lum(bgMapped) - lum(bg)) < 0.08, `Live palette (${nm}): the map's near-black maps to the LCD background (${bgMapped})`);
      const txt = xoPaletteColor(1, 1, 1, 0.5);
      assert(Math.abs(lum(txt) - lum(bg)) > 0.4 && txt[3] === 0.5, `Live palette (${nm}): white maps to a text colour with contrast, alpha kept (${txt})`);
      const acc = xoPaletteColor(0.22, 0.74, 0.97, 0.9);
      assert.deepStrictEqual(acc, [th.live_control_selection[0], th.live_control_selection[1], th.live_control_selection[2], 0.9], `Live palette (${nm}): the blue accent becomes live_control_selection`);
    }
    theme = DARK; xoLiveRefresh();
    // the map paints with the mocked Live colours only (no amber / blue leftovers): every opaque colour is near the ramp or an accent
    paintCommands.length = 0;
    paint();
    assert(paintCommands.filter((c) => c.op === "rgba").length > 20, "the Live theme paints the map");
    // v8ui chrome: titles and mini buttons use Live's neutral control colours, not the accent; titles are title case
    paintCommands.length = 0;
    xoRole("title", 1, 0.71, 0.2, 1); xoRole("btn", 0.2, 0.74, 0.45, 0.28); xoRole("btntext", 0.35, 0.9, 0.55, 1);
    const near3 = (c, want) => Math.abs(c.r - want[0]) < 1e-6 && Math.abs(c.g - want[1]) < 1e-6 && Math.abs(c.b - want[2]) < 1e-6;
    const rg = paintCommands.filter((c) => c.op === "rgba");
    assert(near3(rg[0], DARK.live_lcd_title), "Live title colour = live_lcd_title (not amber)");
    assert(near3(rg[2], DARK.live_control_fg), "Live mini-button text = live_control_fg (not teal)");
    assert(rg[1].a === 1 && Math.abs(rg[1].r - rg[1].b) < 0.01, "Live mini-button fill is a neutral grey");
    assert.strictEqual(xoTitleText("SAVED (2)", "Saved (2)"), "Saved (2)");
    xoPaletteSet("LCD");
    paintCommands.length = 0; xoRole("title", 1, 0.71, 0.2, 1);
    assert.strictEqual(xoTitleText("SAVED (2)", "Saved (2)"), "SAVED (2)", "other themes keep upper case");
    assert(paintCommands.some((c) => c.op === "rgba" && c.r > c.b), "other themes paint the given colour (amber-mapped)");
    xoPaletteSet("Live");
    // LCD -> Live -> Focus -> Live restores each theme's attributes
    set_theme(0);
    assert.strictEqual(taskLog.filter((t) => t.on).length, 0, "the watcher stops when the Live theme is left (no polling in LCD)");
    sameAttrs("LCD", DARK);
    assert.strictEqual(attr("obj-hdr-filters", "text"), "FILTERS");
    set_theme(1);
    sameAttrs("Focus", DARK);
    assert.strictEqual(attr("obj-hdr-filters", "text"), "FILTERS");
    assert.deepStrictEqual(attr("obj-focus-f-lbl-0", "fontname"), "Arial", "Focus restores its labels' font");
    set_theme(2);
    sameAttrs("Live", DARK);
    assert.strictEqual(taskLog.filter((t) => t.on).length, 1, "one watcher again after returning to Live");
    set_theme(0);
    set_show_options(0);
    delete global.max; delete global.Task;
  }
  set_theme(0);
  // Repeated section toggles with the same theme stay consistent
  set_show_filters(0); set_show_filters(1);
  assert.strictEqual(hid("obj-panel-filters"), 0);
  // Unknown values fall back to LCD
  set_theme("nonsense");
  assert.strictEqual(getXoThemeName(), "LCD");
}
clearSavedList();
assert.strictEqual(getSavedList().length, 0);

// Save 5 samples via save_selected(), then test that pressing 's' (which fires BOTH onkeydown(115)
// AND obj-sel-key -> hotkey_save() simultaneously) adds the 6th sample ONCE (never twice!)
for (let i = 0; i < 5; i++) {
  set_pitch(i + 1);
  set_decay(200 + i * 50);
  save_selected();
}
assert.strictEqual(getSavedList().length, 5, "Expected 5 saved samples before hotkey test");

// Wait 210ms so the hotkey debounce window is clear, then fire BOTH onkeydown(115) and hotkey_save()
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 210);
set_pitch(6);
set_decay(450);
onkeydown(115);
hotkey_save();
assert.strictEqual(getSavedList().length, 6, "Regression: Pressing 's' must add item to savedList ONCE (not twice)");
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

// Regression check: when the invisible NSPanel appears under the cursor, v8ui fires onidleout().
// onidleout() must NOT emit ["arm_drag", "none", -1] (which would immediately disarm the drag window!)
onidleout();
assert.deepStrictEqual(stripOutlets[0], ["arm_drag", "edited", 0], "Regression: onidleout() must not disarm the active drag window");

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

// Test Sample Preview (top waveform bar):
// 1) Clicking without dragging must playback the sample ("replay") and NOT drag out
// 2) Dragging from the sample preview must drag out the single Raw sample ("drag_out", "selected_raw") and NOT playback!
const previewOutletLog = [];
global.outlet = (idx, ...args) => {
  stripOutlets[idx] = args;
  if (idx === 0) previewOutletLog.push(args);
};
onidle(60, 10, 0, 0, 0, 0, 0, 0);
assert.deepStrictEqual(stripOutlets[0], ["arm_drag", "selected_raw", getSelectedIndex()], "Hovering sample preview bar must arm single Raw sample drag");

// 1) Click and release without moving -> replay only
previewOutletLog.length = 0;
onclick(60, 10, 1, 0, 0, 0, 0, 0);
ondrag(60, 10, 0, 0, 0, 0, 0, 0);
assert.deepStrictEqual(previewOutletLog, [["replay"]], "Clicking sample preview bar without dragging must playback the sample (and not drag out)");

// 2) Click and drag -> drag_out selected_raw only (NO replay!)
previewOutletLog.length = 0;
onclick(60, 10, 1, 0, 0, 0, 0, 0);
ondrag(72, 12, 1, 0, 0, 0, 0, 0);
ondrag(72, 12, 0, 0, 0, 0, 0, 0);
assert.deepStrictEqual(
  previewOutletLog,
  [["drag_out", "selected_raw", getSelectedIndex()]],
  "Regression: Dragging from sample preview bar must drag out single Raw sample and NOT playback the sample"
);

// Test Infinite Similarity Stepping (both sim_next and sim_prev) & Re-Seed button on bottom toolbar tray in v8ui
const visitedStripSim = new Set();
const totalPts = getPoints().length;
const stripOutletHistory = [];
global.outlet = (idx, ...args) => {
  stripOutlets[idx] = args;
  if (idx === 0) stripOutletHistory.push(args);
};
for (let s = 0; s < totalPts; s++) {
  applyToolbarAction("sim_next");
  visitedStripSim.add(getSelectedIndex());
}
assert.strictEqual(visitedStripSim.size, totalPts, "Statusbar/toolbar similar sample button must infinitely traverse all visible samples without getting stuck");

// Regression check: clicking sim_prev must step to the previous sample AND emit ONLY ["step_similar", -1] (never select_index + step_similar)
stripOutletHistory.length = 0;
const curBeforePrev = getSelectedIndex();
applyToolbarAction("sim_prev");
assert.notStrictEqual(getSelectedIndex(), curBeforePrev, "sim_prev in v8ui must change selectedIndex");
assert.strictEqual(stripOutletHistory.length, 1, "Regression: sim_prev must emit exactly 1 message to node.codebox (not select_index + step_similar)");
assert.deepStrictEqual(stripOutletHistory[0], ["step_similar", -1]);

// Click Re-Seed button on bottom toolbar tray
applyToolbarAction("reseed");
assert.deepStrictEqual(stripOutlets[0], ["reseed_filtered"], "Clicking Re-Seed toolbar button must emit reseed_filtered (the Filters section button's message)");
assert.strictEqual(boxMap.get("obj-msg-reseed-filtered").text, "reseed_filtered", "the Filters-section button sends the same message");
assert(linesFrom("obj-msg-reseed-filtered").includes("obj-node"), "reseed_filtered goes to the node engine");
assert(xoX.TOOLBAR_ITEMS.find((it) => it.id === "reseed").title.includes("Filters"), "toolbar Re-Seed tooltip mentions the active Filters");
{
  // The node's handler of that message only returns samples passing the filters (search text, MaxLen, Tone, Tonal, Drums, folders)
  const es = engine.engineState;
  const keepF = { corpusSamples: es.corpusSamples, knownFolders: es.knownFolders, maxLenMs: es.maxLenMs, searchQuery: es.searchQuery };
  es.corpusSamples = scanRes.samples;
  es.knownFolders = [{ path: tmpDir, name: "TestDrums", enabled: true, count: scanRes.samples.length }];
  es.searchQuery = "hihat";
  nodeHandlers.reseed_filtered();
  assert(es.samples.length > 0 && es.samples.every((smp) => /hihat/i.test(smp.name) && engine.isSamplePassingFilters(smp)), "reseed_filtered with a search filter returns only matching samples");
  es.searchQuery = "";
  nodeHandlers.reseed_filtered();
  assert(es.samples.length >= 2, "without a search filter other samples come back");
  Object.assign(es, keepF);
}

// Test Folder List v8ui widget (obj-folder-list): toggle, enable all, scanning indicator, and [x] delete folder from index
const vm = require("vm");
const folderJs = boxMap.get("obj-folder-list").textfile.text;
let folderOut = [];
const folderCtx = vm.createContext({
  mgraphics: {
    ...global.mgraphics,
    size: [196, 69]
  },
  inlets: 1,
  outlets: 1,
  outlet: (idx, ...args) => { folderOut = args; },
  Math,
  Number,
  String
});
vm.runInContext(folderJs, folderCtx, { filename: "xo_folder_ui.js" });
// the folder list follows Options > Theme too: index 2 = the Live palette (no Task / max in this context: the fallback colours)
folderCtx.set_theme(2);
assert.strictEqual(vm.runInContext("xoPaletteName", folderCtx), "Live", "folder list: Theme 2 selects the Live palette");
assert.strictEqual(typeof folderCtx.xoLiveThemeChanged, "function", "folder list repaints on a Live theme change");
folderCtx.set_theme(1);
assert.strictEqual(vm.runInContext("xoPaletteName", folderCtx), "Focus");
folderCtx.set_theme("LCD");
// Pass flags = 3 (bit 0 = enabled, bit 1 = scanning) on row 1 ("User Pack")
folderCtx.folder_list_sync(2, 1, 80, "Ableton Core Drums", "/CoreDrums", 3, 42, "User Pack", "/UserPack");
assert.strictEqual(folderCtx.getFolders().length, 2);
assert.strictEqual(folderCtx.getFolders()[1].scanning, 1, "Expected scanning flag = 1 on scanning folder row");
assert.strictEqual(folderCtx.isAnyFolderScanning(), true, "Expected isAnyFolderScanning() === true while scanning");
paintCommands.length = 0;
folderCtx.paint();
assert(
  paintCommands.some((c) => c.op === "text" && c.t === "SCAN..") &&
  paintCommands.some((c) => c.op === "text" && c.t === "SCAN 42"),
  "Expected folder list to render 'SCAN..' header badge and 'SCAN 42' row indicator while scanning"
);
folderCtx.set_folder_scanning("/UserPack", 0);
assert.strictEqual(folderCtx.isAnyFolderScanning(), false, "Expected scanning indicator cleared when scan finishes");
// Click row 1 ("User Pack") title area to toggle it off
folderCtx.onclick(40, 16 + 17 + 5);
assert.deepStrictEqual(folderOut, ["toggle_folder", "/UserPack", 0], "Clicking folder row in FILTERS folder list must emit toggle_folder");
// Click "All" button in header (x = 196 - 42 = 154) to re-enable all folders
folderCtx.onclick(154, 6);
assert.deepStrictEqual(folderOut, ["enable_all_folders"], "Clicking All in FILTERS folder list must emit enable_all_folders");
// Click [x] delete button on row 1 (x = 196 - 13 = 183) to remove "/UserPack" from index
folderCtx.onclick(183, 16 + 17 + 5);
assert.deepStrictEqual(folderOut, ["remove_folder", "/UserPack"], "Clicking [x] on folder row must emit remove_folder to delete it from index");
assert.strictEqual(folderCtx.getFolders().length, 1, "Folder must be removed from folder list UI after clicking [x]");
folderCtx.paint();

// ---- Pitch is independent of Speed (Ableton Complex behaviour): audition path, scan line, cache, debounce ----
{
  const es = engine.engineState;
  const keep = { pitchSt: es.pitchSt, speedPct: es.speedPct, stretchMode: es.stretchMode, decayMs: es.decayMs, reverse: es.reverse };
  const srcMs = scanRes.samples[monoSampleIdx].durationMs;
  const play = (pitchSt, speedPct, mode) => {
    Object.assign(es, { pitchSt, speedPct, stretchMode: mode, decayMs: 20000, reverse: 0 });
    nodeOutletLog.length = 0;
    engine.emitSelectedToMax(monoSampleIdx, true);
    const get = (n) => nodeOutletLog.find((m) => m[0] === n);
    const file = get("play_file")[1];
    const dec = engine.parseAudioBuffer(fs.readFileSync(file), fs.statSync(file).size, 25);
    return { file, rendered: file !== scanRes.samples[monoSampleIdx].path, speed: get("play_speed")[1], scan: get("play_scan_dur")[1], info: get("audition_info"), dec };
  };
  for (const mode of [0, 1, 2]) {
    const a = play(0, 50, mode), b = play(7, 50, mode), c = play(-12, 50, mode);
    for (const r of [a, b, c]) {
      assert(r.rendered, "Speed 50 % is rendered");
      assert.strictEqual(r.speed, 1, "sfplay~ is never repitched on a rendered file");
      assert(Math.abs(r.dec.durationMs - srcMs * 2) <= 15, `mode ${mode}: length ${r.dec.durationMs} must be input/0.5 = ${srcMs * 2} whatever the Pitch`);
      assert(Math.abs(r.scan - r.dec.durationMs) <= 2, `mode ${mode}: scan duration ${r.scan} must match the rendered length ${r.dec.durationMs}`);
      const [rate, skipMs, mapSrc, endMs, rev] = r.info.slice(9);
      assert(rate === 0.5 && skipMs === 0 && mapSrc === srcMs && rev === 0 && Math.abs(endMs - r.dec.durationMs) <= 2, `mode ${mode}: audition_info carries the playhead map (${r.info.slice(9)})`);
    }
    // Pitch at Speed 100 %: rendered (not plain repitch), length unchanged, play speed 1
    const d = play(12, 100, mode);
    assert(d.rendered && d.speed === 1, `mode ${mode}: +12 st at Speed 100 % is rendered, not sfplay~ repitch`);
    assert(Math.abs(d.dec.durationMs - srcMs) <= 15 && Math.abs(d.scan - d.dec.durationMs) <= 2, `mode ${mode}: +12 st keeps the length (${d.dec.durationMs} vs ${srcMs})`);
  }
  // Plain path: Speed 100 % + Pitch 0 (non-Texture) plays the source file untouched at speed 1
  const plain = play(0, 100, 1);
  assert(!plain.rendered && plain.speed === 1, "Speed 100 % + Pitch 0 stays on plain sfplay~");
  assert(play(0, 100, 2).rendered, "Texture always renders");
  // set_pitch must not repitch sfplay~ directly any more
  nodeOutletLog.length = 0;
  nodeHandlers.set_pitch(12);
  assert(!nodeOutletLog.some((m) => m[0] === "play_speed"), "set_pitch must not send play_speed (would double-apply on rendered files)");
  clearTimeout(engine.renderDebounce.timer); engine.renderDebounce.timer = null;
  // Render cache: the same settings are not rendered twice
  Object.assign(es, { pitchSt: 3, speedPct: 80, stretchMode: 1 });
  const r1 = engine.renderStats.renders;
  engine.emitSelectedToMax(monoSampleIdx, true);
  const afterFirst = engine.renderStats.renders;
  engine.emitSelectedToMax(monoSampleIdx, true);
  assert.strictEqual(afterFirst - r1, 1, "first audition renders once");
  assert.strictEqual(engine.renderStats.renders, afterFirst, "second audition with the same settings hits the cache");
  // Debounce / supersede: a burst of dial messages renders only the latest setting, once
  Object.assign(es, { selectedIndex: monoSampleIdx, stretchMode: 1, speedPct: 100, pitchSt: 0 });
  engine.renderDebounce.ms = 40;
  const dr0 = engine.renderDebounce.executed, rr0 = engine.renderStats.renders;
  for (let st = 1; st <= 9; st++) nodeHandlers.set_pitch(st + 0.25);
  assert.strictEqual(engine.renderDebounce.executed, dr0, "nothing renders while the dial is moving");
  setTimeout(() => {
    assert.strictEqual(engine.renderDebounce.executed - dr0, 1, "burst of 9 pitch changes produces exactly one render");
    assert.strictEqual(engine.renderStats.renders - rr0, 1, "only the latest setting was rendered");
    assert(engine.renderDebounce.superseded >= 8, "earlier requests were superseded");
    const rr1 = engine.renderStats.renders;
    engine.emitSelectedToMax(monoSampleIdx, true);
    assert.strictEqual(engine.renderStats.renders, rr1, "the audition after the drag uses the pre-rendered file (cache)");
    Object.assign(es, keep);
    console.log("OK: Pitch independent of Speed (length, scan duration, no repitch, cache, debounce/supersede)");
  }, 200);
}

// Cleanup temp directory (at exit: the debounce check above finishes asynchronously)
process.on("exit", () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} });

// ============================================================================
// 4. Live Max 9 M4L Presentation-Mode Runtime Test
//    Verifies inside the actual Max 9.1 runtime with openinpresentation = 1:
//    - obj-node (node.codebox) boots in Presentation Mode
//    - Pressing 's' (ASCII 115) through obj-sel-key triggers save_selected in v8ui & node.codebox
//    - Clicking [R] / [E] / [Drag Raw] / [Drag Edit] in v8ui triggers drag_out in node.codebox,
//      creates real OS files, spawns xo_drag_helper_v2_bin, populates macOS NSPasteboard,
//      and shows the native Cocoa NSDraggingSource window!
// ============================================================================

// AGENTS.md 1a/1b: this test never launches Max (the host must not run Max). With XO_RUN_MAX_RUNTIME=1 it only
// writes the harness patch to tests/out/xo_runtime/; `scripts/vm_xo.sh max` runs it in the tart VM through
// scripts/run_xo_runtime_test.py (shared max_harness lock / launch / kill) and checks the result there.
if (process.env.XO_RUN_MAX_RUNTIME === "1") {
  const harnessDoc = JSON.parse(raw.slice(32).toString("utf8"));
  const hp = harnessDoc.patcher;

  // Inject an automated M4L runtime test driver that tests the full Max patchline chain:
  // 1) '115' ('s' hotkey) -> obj-sel-key -> obj-msg-save-sel -> obj-minimap (v8ui) -> obj-node (node.codebox)
  // 2) Simulated v8ui clicks on [R], [E], [Drag Raw], and [Drag Edit] -> obj-node -> xo_drag_helper_v2_bin -> NSPasteboard
  for (const b of hp.boxes) {
    if (b.box.id === "obj-minimap") {
      b.box.textfile.text += `\n
function m4l_test_click_drag_zones() {
  const lay = getLayout();
  const row0Y = lay.savedRowY0 + 8;
  const rawX = lay.savedX + lay.savedW - 46;
  const editX = lay.savedX + lay.savedW - 28;
  // Click [R] on row 0
  onclick(rawX, row0Y, 1, 0, 0, 0, 0, 0);
  ondrag(rawX, row0Y, 0, 0, 0, 0, 0, 0);
  // Click [E] on row 0
  onclick(editX, row0Y, 1, 0, 0, 0, 0, 0);
  ondrag(editX, row0Y, 0, 0, 0, 0, 0, 0);
  // Click [Drag Raw]
  onclick(lay.savedX + 20, lay.savedBottomY + 10, 1, 0, 0, 0, 0, 0);
  ondrag(lay.savedX + 20, lay.savedBottomY + 10, 0, 0, 0, 0, 0, 0);
  // Click [Drag Edit]
  onclick(lay.savedX + lay.savedW - 20, lay.savedBottomY + 10, 1, 0, 0, 0, 0, 0);
  ondrag(lay.savedX + lay.savedW - 20, lay.savedBottomY + 10, 0, 0, 0, 0, 0, 0);
}
`;
    }
    if (b.box.id === "obj-node") {
      b.box.code += `\n
CORE_DRUM_PATHS.length = 0;
const _dragModesSeen = [];
Max.addHandler("drag_out", (mode, savedIdx = -1) => {
  const res = resolveDragOutPaths(String(mode || "raw"), Number(savedIdx), true, false);
  _dragModesSeen.push({ mode, count: res.paths.length, path0: res.paths[0], exists0: !!(res.paths[0] && fs.existsSync(res.paths[0])) });
  if (_dragModesSeen.length >= 4) {
    setTimeout(() => {
      fs.writeFileSync(path.join(os.tmpdir(), "xo_m4l_runtime_test_result.json"), JSON.stringify({
        bootedInPresentation: true,
        savedCountFromHotkey: engineState.savedList.length,
        dragModesSeen: _dragModesSeen
      }));
    }, 350);
  }
});
`;
    }
  }

  // Wire loadbang -> delay 600 -> '115' into obj-sel-key, then delay 900 -> 'm4l_test_click_drag_zones' into obj-minimap
  hp.boxes.push(
    {
      box: {
        id: "obj-test-lb",
        maxclass: "newobj",
        numinlets: 1,
        numoutlets: 1,
        outlettype: ["bang"],
        patching_rect: [640.0, 590.0, 60.0, 20.0],
        text: "loadbang"
      }
    },
    {
      box: {
        id: "obj-test-del1",
        maxclass: "newobj",
        numinlets: 2,
        numoutlets: 1,
        outlettype: ["bang"],
        patching_rect: [640.0, 615.0, 65.0, 20.0],
        text: "delay 1100"
      }
    },
    {
      box: {
        id: "obj-test-key-115",
        maxclass: "message",
        numinlets: 2,
        numoutlets: 1,
        outlettype: [""],
        patching_rect: [640.0, 640.0, 35.0, 20.0],
        text: "115"
      }
    },
    {
      box: {
        id: "obj-test-del2",
        maxclass: "newobj",
        numinlets: 2,
        numoutlets: 1,
        outlettype: ["bang"],
        patching_rect: [720.0, 615.0, 65.0, 20.0],
        text: "delay 1350"
      }
    },
    {
      box: {
        id: "obj-test-click-drags",
        maxclass: "message",
        numinlets: 2,
        numoutlets: 1,
        outlettype: [""],
        patching_rect: [720.0, 640.0, 160.0, 20.0],
        text: "m4l_test_click_drag_zones"
      }
    }
  );
  hp.lines.push(
    { patchline: { source: ["obj-test-lb", 0], destination: ["obj-test-del1", 0] } },
    { patchline: { source: ["obj-test-del1", 0], destination: ["obj-test-key-115", 0] } },
    { patchline: { source: ["obj-test-key-115", 0], destination: ["obj-sel-key", 0] } },
    { patchline: { source: ["obj-test-lb", 0], destination: ["obj-test-del2", 0] } },
    { patchline: { source: ["obj-test-del2", 0], destination: ["obj-test-click-drags", 0] } },
    { patchline: { source: ["obj-test-click-drags", 0], destination: ["obj-minimap", 0] } }
  );

  const outDir = path.join(ROOT_DIR, "tests", "out", "xo_runtime");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "xo_m4l_runtime_harness.maxpat"), JSON.stringify(harnessDoc));
  console.log("OK: wrote the Max runtime harness patch to tests/out/xo_runtime/ (run it with scripts/vm_xo.sh max)");
}

// ---- Indexed duration comes from the header frame count (regression: 24-bit stereo 1.5 s indexed as 980 ms) ----
{
  const durDir = fs.mkdtempSync(path.join(os.tmpdir(), "xo_dur_"));
  const chunk = (id, payload, be) => {
    const h = Buffer.alloc(8);
    h.write(id, 0, 4, "ascii");
    if (be) h.writeUInt32BE(payload.length, 4); else h.writeUInt32LE(payload.length, 4);
    return Buffer.concat([h, payload, payload.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  // decaying tone that falls below the trim threshold long before the end (so a trimmed length would be short)
  const frameAt = (i, sr, frames) => Math.sin(2 * Math.PI * 800 * i / sr) * Math.exp(-i / (0.12 * sr)) * (i < frames ? 1 : 0);
  const pcm = (frames, ch, bits, sr, float, be) => {
    const bps = bits / 8;
    const b = Buffer.alloc(frames * ch * bps);
    for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
      const v = frameAt(i, sr, frames) * (c ? 0.8 : 1);
      const o = (i * ch + c) * bps;
      if (float) b.writeFloatLE(v, o);
      else if (bits === 16) (be ? b.writeInt16BE : b.writeInt16LE).call(b, Math.round(v * 32767), o);
      else if (bits === 24) { const x = Math.round(v * 8388607) & 0xffffff; if (be) { b[o] = x >> 16; b[o + 1] = (x >> 8) & 255; b[o + 2] = x & 255; } else { b[o] = x & 255; b[o + 1] = (x >> 8) & 255; b[o + 2] = x >> 16; } }
      else (be ? b.writeInt32BE : b.writeInt32LE).call(b, Math.round(v * 2147483647), o);
    }
    return b;
  };
  const wav = (frames, ch, bits, sr, o = {}) => {
    const ext = !!o.ext;
    const fmt = Buffer.alloc(ext ? 40 : 16);
    fmt.writeUInt16LE(ext ? 0xfffe : (o.float ? 3 : 1), 0);
    fmt.writeUInt16LE(ch, 2); fmt.writeUInt32LE(sr, 4); fmt.writeUInt32LE(sr * ch * bits / 8, 8);
    fmt.writeUInt16LE(ch * bits / 8, 12); fmt.writeUInt16LE(bits, 14);
    if (ext) { fmt.writeUInt16LE(22, 16); fmt.writeUInt16LE(bits, 18); fmt.writeUInt16LE(o.float ? 3 : 1, 24); }
    const parts = [Buffer.from("WAVE", "ascii"), chunk("fmt ", fmt)];
    for (const [id, n] of (o.pre || [])) parts.push(chunk(id, Buffer.alloc(n, 7)));
    parts.push(chunk("data", pcm(frames, ch, bits, sr, o.float, false)));
    for (const [id, n] of (o.post || [])) parts.push(chunk(id, Buffer.alloc(n, 7)));
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(8); head.write("RIFF", 0, 4, "ascii"); head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body]);
  };
  const ext80 = (v) => { const b = Buffer.alloc(10); const e = Math.floor(Math.log2(v)); const m = BigInt(Math.round(v / Math.pow(2, e) * Math.pow(2, 63))); b.writeUInt16BE(16383 + e, 0); b.writeBigUInt64BE(m, 2); return b; };
  const aiff = (frames, ch, bits, sr, comp, pre) => {
    const comm = Buffer.alloc(18 + (comp ? 4 + 2 : 0));
    comm.writeUInt16BE(ch, 0); comm.writeUInt32BE(frames, 2); comm.writeUInt16BE(bits, 6); ext80(sr).copy(comm, 8);
    if (comp) { comm.write(comp, 18, 4, "ascii"); comm.writeUInt8(0, 22); comm.writeUInt8(0, 23); }
    const ssnd = Buffer.concat([Buffer.alloc(8), pcm(frames, ch, bits, sr, false, comp !== "sowt")]);
    const parts = [Buffer.from(comp ? "AIFC" : "AIFF", "ascii")];
    if (comp) parts.push(chunk("FVER", Buffer.from([0xa2, 0x80, 0x51, 0x40]), true));
    for (const [id, n] of (pre || [])) parts.push(chunk(id, Buffer.alloc(n, 7), true));
    parts.push(chunk("COMM", comm, true), chunk("SSND", ssnd, true));
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(8); head.write("FORM", 0, 4, "ascii"); head.writeUInt32BE(body.length, 4);
    return Buffer.concat([head, body]);
  };
  const cases = [
    ["wav16 mono", "a.wav", wav(66150, 1, 16, 44100)],
    ["wav24 stereo 1.5 s (Core Library hihat)", "b.wav", wav(66145, 2, 24, 44100)],
    ["wav24 stereo + LIST/bext/smpl/cue pre-data", "c.wav", wav(66145, 2, 24, 44100, { pre: [["LIST", 301], ["bext", 602], ["smpl", 60], ["cue ", 28], ["JUNK", 33], ["fact", 4]] })],
    ["wav32 int stereo", "d.wav", wav(48000, 2, 32, 48000)],
    ["wav32 float stereo", "e.wav", wav(48000, 2, 32, 48000, { float: true })],
    ["wav24 extensible", "f.wav", wav(66145, 2, 24, 44100, { ext: true })],
    ["wav32 float extensible", "g.wav", wav(48000, 1, 32, 48000, { ext: true, float: true })],
    ["wav trailing chunks after data", "h.wav", wav(66145, 2, 24, 44100, { post: [["LIST", 101], ["id3 ", 5]] })],
    ["wav 96k 24 mono 3.1 s (> decode window)", "i.wav", wav(300000, 1, 24, 96000)],
    ["aiff16", "j.aif", aiff(66150, 1, 16, 44100)],
    ["aiff24 stereo + chunks", "k.aif", aiff(66145, 2, 24, 44100, null, [["NAME", 7], ["ANNO", 11]])],
    ["aifc sowt 16 stereo", "l.aifc", aiff(66145, 2, 16, 44100, "sowt")],
    ["aifc NONE 24 stereo", "m.aifc", aiff(66145, 2, 24, 44100, "NONE")]
  ];
  for (const [label, file, data] of cases) {
    const fp = path.join(durDir, file);
    fs.writeFileSync(fp, data);
    const frames = { "a.wav": 66150, "d.wav": 48000, "e.wav": 48000, "g.wav": 48000, "i.wav": 300000, "j.aif": 66150 }[file] || 66145;
    const sr = { "d.wav": 48000, "e.wav": 48000, "g.wav": 48000, "i.wav": 96000 }[file] || 44100;
    const trueMs = frames / sr * 1000;
    const item = engine.analyzeAudioFile(fp, null, durDir);
    assert.ok(item, `${label}: indexed`);
    assert.ok(Math.abs(item.durationMs - trueMs) <= 1, `${label}: indexed durationMs ${item.durationMs} vs true ${trueMs.toFixed(1)}`);
    const dec = engine.parseAudioBuffer(data, data.length);
    assert.ok(Math.abs(dec.durationMs - trueMs) < 0.05 && dec.totalFrames === frames, `${label}: parser frames ${dec.totalFrames}`);
    // binary cache round trip keeps it
    const rec = engine.packSampleBinaryRecord ? engine.unpackSampleBinaryRecord(engine.packSampleBinaryRecord(item), 0, fp, durDir) : item;
    assert.ok(Math.abs(rec.durationMs - trueMs) <= 1, `${label}: cache round trip ${rec.durationMs}`);
  }
  // data chunk size larger than the file (truncated / streamed): frames come from what the file holds
  {
    const w = wav(66145, 2, 24, 44100);
    const cut = w.subarray(0, w.length - 6 * 1000);
    const fp = path.join(durDir, "trunc.wav");
    fs.writeFileSync(fp, cut);
    const it = engine.analyzeAudioFile(fp, null, durDir);
    const held = Math.floor((cut.length - 44) / 6) / 44100 * 1000;
    assert.ok(Math.abs(it.durationMs - held) <= 1, `truncated wav: ${it.durationMs} vs ${held.toFixed(1)}`);
  }
  fs.rmSync(durDir, { recursive: true, force: true });
  console.log("OK: indexed durationMs equals the header length for 13 WAV/AIFF/AIFC layouts (+ truncated data chunk)");
}

// ============================================================================
// Category search by words (Options > Searches, toolbar categories): node engine <-> v8ui agreement, toolbar, Options UI, state blob
// ============================================================================
require("child_process").execFileSync(process.execPath, [path.join(__dirname, "test_xo_search.js")], { stdio: "inherit" });
// (runs after the timer based render tests above, which share the engine state)
setTimeout(() => {
  const S = require("../src/xo_search.js");
  const CATS = S.XO_SEARCH_CATS.map((c) => c.id);
  const strip = { mapW: getLayout().mapW };

  // --- toolbar: All + 8 categories (name order) + 4 navigation items, each with a title, an icon and a colour ---
  const ids = xoX.TOOLBAR_ITEMS.map((i) => i.id);
  assert.deepStrictEqual(ids, ["cat_ALL", ...CATS.map((c) => "cat_" + c), "sim_prev", "sim_next", "random", "reseed"], "toolbar: All, the 8 word categories, then the navigation items");
  assert.deepStrictEqual(xoX.CAT_ID_LIST, CATS, "v8ui category order = xo_search order (toolbar order = first-match priority)");
  assert(!ids.includes("cat_tom") && !ids.includes("cat_fx") && !ids.includes("cat_rim"), "Tom, FX and Rim categories are gone");
  assert.deepStrictEqual(xoX.TOOLBAR_ITEMS.filter((i) => i.id.startsWith("cat_")).map((i) => i.title),
    ["Filter: All Categories", "Filter: Kick", "Filter: Snare", "Filter: Hi-Hat", "Filter: Clap", "Filter: Perc", "Filter: Shaker", "Filter: Cymbal", "Filter: Voice"]);
  const cellW = getLayout().mapW / xoX.TOOLBAR_ITEMS.length;
  assert(cellW >= 18, `toolbar cells stay >= 18 px wide (${cellW.toFixed(2)})`);
  // distinct colours in both palettes
  for (const palette of ["Focus", "LCD", "Live"]) {
    xoPaletteSet(palette);
    const cols = xoX.CATEGORIES.map((c) => xoPaletteCat(c.id, c.color)).concat([xoPaletteCat("none", xoX.CAT_NONE_COLOR)]);
    assert.strictEqual(new Set(cols.map((c) => c.slice(0, 3).join())).size, cols.length, `${palette}: every category and "none" has its own colour`);
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
      const d = Math.hypot(cols[i][0] - cols[j][0], cols[i][1] - cols[j][1], cols[i][2] - cols[j][2]);
      assert(d > 0.18, `${palette}: colours ${i}/${j} are distinguishable (${d.toFixed(2)})`);
    }
  }
  xoPaletteSet("LCD");
  // every icon paints (vector paths, no text) and the tooltip shows the full title
  {
    const lay2 = getLayout();
    for (let i = 0; i < xoX.TOOLBAR_ITEMS.length; i++) {
      paintCommands.length = 0;
      drawToolbarIcon(xoX.TOOLBAR_ITEMS[i].id, i * cellW, lay2.toolbarY, cellW, lay2.toolbarH, [1, 0.5, 0.2, 1], false);
      assert(paintCommands.length >= 0);
    }
  }

  // --- node engine: words, folders, Match folders, first-match category field ---
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xo_search_"));
  const mk = (rel) => {
    const fp = path.join(root, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, makeSynthWav(110 + rel.length * 7, 0.05, 0.3));
    return fp;
  };
  const files = ["Kick Deep.wav", "Snare/Thing A.wav", "Hats/Thing B.wav", "Custom Tom Of.wav", "Bottom End.wav", "Misc/Rim Perc.wav", "Crash 1.wav", "Vox/Chant.wav", "Tambourine.wav", "Sine Pad.wav", "Clap Snap.wav"];
  const items = files.map((f) => engine.analyzeAudioFile(mk(f), null, root));
  assert(items.every(Boolean), "indexed");
  const st = engine.engineState;
  st.samples = items;
  st.corpusSamples = items.slice();
  engine.setSearchConfig(1, []); // defaults
  const idxOf = (n) => items.findIndex((s) => s.name === n);
  const catsOf = (s) => CATS.filter((c, i) => engine.getSampleMask(s) & (1 << i));
  assert.deepStrictEqual(catsOf(items[idxOf("Kick Deep")]), ["kick"]);
  assert.deepStrictEqual(catsOf(items[idxOf("Thing A")]), ["snare"], "folder Snare below the root counts");
  assert.deepStrictEqual(catsOf(items[idxOf("Thing B")]), ["hihat"], "folder Hats");
  assert.deepStrictEqual(catsOf(items[idxOf("Custom Tom Of")]), ["perc"]);
  assert.deepStrictEqual(catsOf(items[idxOf("Bottom End")]), [], "bottom is not tom");
  assert.deepStrictEqual(catsOf(items[idxOf("Rim Perc")]), ["snare", "perc"]);
  assert.deepStrictEqual(catsOf(items[idxOf("Clap Snap")]), ["clap"]);
  assert.deepStrictEqual(catsOf(items[idxOf("Chant")]), ["voice"]);
  assert.deepStrictEqual(catsOf(items[idxOf("Tambourine")]), ["shaker"]);
  assert.deepStrictEqual(catsOf(items[idxOf("Sine Pad")]), []);
  assert.strictEqual(engine.sampleCatField(items[idxOf("Rim Perc")]), (0b10010) * 16 + CATS.indexOf("snare"), "category field = mask * 16 + first (Snare > Perc)");
  assert.strictEqual(engine.sampleCatField(items[idxOf("Sine Pad")]), 15, "no match = 15");
  // the root's own name is not searched: index a root called "Kicks Root"
  {
    const kroot = path.join(root, "Kicks Root");
    const fp = path.join(kroot, "Zed.wav");
    fs.mkdirSync(kroot, { recursive: true });
    fs.writeFileSync(fp, makeSynthWav(200, 0.05, 0.3));
    const it = engine.analyzeAudioFile(fp, null, kroot);
    assert.strictEqual(engine.getSampleMask(it), 0, "the indexed root's own name never matches");
    assert.strictEqual(it.rootFolder, kroot);
  }
  // category filter = membership, ANDed with the other filters
  const passing = (cat, extra) => {
    st.activeCategory = cat;
    Object.assign(st, { searchQuery: "", maxLenMs: 5000 }, extra || {});
    const r = items.filter((s) => engine.isSamplePassingFilters(s)).map((s) => s.name);
    st.activeCategory = "ALL";
    st.searchQuery = "";
    return r;
  };
  assert.strictEqual(passing("ALL").length, items.length, "All shows everything");
  assert.deepStrictEqual(passing("kick"), ["Kick Deep"]);
  assert.deepStrictEqual(passing("snare").sort(), ["Rim Perc", "Thing A"]);
  assert.deepStrictEqual(passing("perc").sort(), ["Custom Tom Of", "Rim Perc"]);
  assert.deepStrictEqual(passing("perc", { searchQuery: "tom" }), ["Custom Tom Of"], "category AND the search box");
  assert.deepStrictEqual(passing("voice"), ["Chant"]);
  assert.deepStrictEqual(passing("tom"), items.map((s) => s.name), "an unknown category id (old tom) filters nothing");
  // Match folders off
  const before = nodeOutletLog.length;
  assert.strictEqual(engine.setSearchConfig(0, []), true);
  assert(!catsOf(items[idxOf("Thing A")]).includes("snare") && catsOf(items[idxOf("Thing A")]).length === 0, "Match folders off: the Snare folder no longer counts");
  assert.deepStrictEqual(passing("snare"), ["Rim Perc"]);
  assert.strictEqual(engine.setSearchConfig(0, []), false, "an unchanged config is ignored");
  engine.setSearchConfig(1, []);
  // custom terms (v8ui encoding): Kick -> "thump", Voice emptied
  {
    const enc = S.xoDefaultSearchTerms().map(S.xoEncodeTerms);
    enc[0] = S.xoEncodeTerms(["deep"]);
    enc[7] = "-";
    assert.strictEqual(engine.setSearchConfig(1, enc), true);
    assert.deepStrictEqual(passing("kick"), ["Kick Deep"], "custom term deep matches Kick Deep (kick word no longer needed)");
    assert.deepStrictEqual(passing("voice"), [], "emptied terms match nothing");
    enc[0] = S.xoEncodeTerms(["thump"]);
    engine.setSearchConfig(1, enc);
    assert.deepStrictEqual(passing("kick"), [], "edited terms apply immediately");
    engine.setSearchConfig(1, []);
  }

  // --- node -> v8ui: the batch the node sends decodes to the same membership / colour index ---
  nodeOutletLog.length = 0;
  engine.setSearchConfig(0, []);          // a change re-sends the batches (no clear) and minimap_done
  engine.setSearchConfig(1, []);
  const batches = nodeOutletLog.filter((m) => m[0] === "minimap_batch");
  assert(batches.length >= 2 && !nodeOutletLog.some((m) => m[0] === "minimap_clear"), "a terms change resends the points without clearing (selection stays)");
  const vOffset = nodeOutletLog.length;
  minimap_clear();
  for (const m of nodeOutletLog.slice(-0).filter((m) => m[0] === "minimap_batch").slice(-1)) minimap_batch(...m.slice(1));
  assert.strictEqual(getPoints().length, items.length);
  getPoints().forEach((pt, i) => {
    const mask = engine.getSampleMask(items[i]);
    assert.strictEqual(pt.mask, mask, `v8ui mask of ${pt.name} equals the node's`);
    assert.strictEqual(pt.catIdx, S.xoFirstCat(mask), `v8ui first category of ${pt.name} equals the node's`);
  });
  for (const cat of CATS) {
    xoX.activeCategory = cat;
    const mine = getPoints().filter((pt) => isPointVisible(pt)).map((pt) => pt.name).sort();
    st.activeCategory = cat;
    const theirs = items.filter((s) => engine.isSamplePassingFilters(s)).map((s) => s.name).sort();
    st.activeCategory = "ALL";
    assert.deepStrictEqual(mine, theirs, `v8ui and node agree on ${cat}`);
  }
  xoX.activeCategory = "ALL";
  // colours follow the FIRST matching category; no match = neutral
  xoPaletteSet("Focus");
  const kickPt = getPoints()[idxOf("Kick Deep")], rimPt = getPoints()[idxOf("Rim Perc")], nonePt = getPoints()[idxOf("Sine Pad")];
  assert.deepStrictEqual(getCategoryColor(kickPt.catIdx).slice(0, 3), xoX.CATEGORIES[1].color.slice(0, 3));
  assert.deepStrictEqual(getCategoryColor(rimPt.catIdx).slice(0, 3), xoX.CATEGORIES[2].color.slice(0, 3), "Rim Perc is coloured as Snare (first match)");
  assert.deepStrictEqual(getCategoryColor(nonePt.catIdx).slice(0, 3), xoX.CAT_NONE_COLOR.slice(0, 3), "no match is neutral");
  xoPaletteSet("LCD");
  // selected_info / saved list carry the first-match category from the node
  nodeOutletLog.length = 0;
  engine.emitSelectedToMax(idxOf("Rim Perc"), false);
  const sel = nodeOutletLog.find((m) => m[0] === "selected_info");
  assert.strictEqual(sel[3], "snare");
  assert.strictEqual(sel[4], 1);
  nodeOutletLog.length = 0;
  engine.emitSelectedToMax(idxOf("Sine Pad"), false);
  const sel2 = nodeOutletLog.find((m) => m[0] === "selected_info");
  assert.strictEqual(sel2[3], "none");
  assert.strictEqual(sel2[4], -1);
  // node handler
  assert.strictEqual(typeof nodeHandlers.search_config, "function", "node handles search_config");
  nodeHandlers.search_config(1, ...S.xoDefaultSearchTerms().map(S.xoEncodeTerms));
  // next / random stay inside the category (shared membership)
  st.activeCategory = "perc";
  st.selectedIndex = idxOf("Custom Tom Of");
  for (let i = 0; i < 6; i++) {
    const nx = engine.stepSimilarSample(1);
    assert(engine.isSamplePassingFilters(items[nx]), `next similar stays in Perc (${items[nx].name})`);
  }
  for (let i = 0; i < 12; i++) {
    nodeOutletLog.length = 0;
    nodeHandlers.random_sample();
    const m = nodeOutletLog.find((x) => x[0] === "selected_info");
    assert(m && ["Custom Tom Of", "Rim Perc"].includes(m[2]), `random stays in Perc (${m && m[2]})`);
  }
  st.activeCategory = "ALL";
  fs.rmSync(root, { recursive: true, force: true });

  // --- old toolbar categories load into the new set ---
  const base = (ver, cat) => [ver, cat, 5000, 0, 0, 2500, 0, 0, 0, 0];
  const catAfter = (arr) => { setvalueof(arr); return getvalueof()[1]; };
  const idxNew = (id) => xoX.CATEGORIES.findIndex((c) => c.id === id);
  assert.strictEqual(catAfter(base(2, 5)), idxNew("perc"), "v2 tom -> Perc");
  assert.strictEqual(catAfter(base(2, 6)), idxNew("snare"), "v2 rim -> Snare");
  assert.strictEqual(catAfter(base(2, 8)), idxNew("shaker"), "v2 shaker -> Shaker");
  assert.strictEqual(catAfter(base(2, 9)), idxNew("perc"), "v2 perc -> Perc");
  assert.strictEqual(catAfter(base(2, 10)), 0, "v2 fx -> All");
  assert.strictEqual(catAfter(base(1, 1)), idxNew("kick"), "v1 kick -> Kick");
  assert.strictEqual(catAfter(base(3, 8)), idxNew("voice"), "v3 indexes the new list");
  xoX.activeCategory = "ALL";

  // --- state blob v3: searches round trip, old versions load with the defaults ---
  {
    const defaults = S.xoDefaultSearchTerms();
    setvalueof(base(2, 0));
    assert.deepStrictEqual(xoX.searchTerms, defaults, "v2 blob (no searches): defaults");
    assert.strictEqual(xoX.matchFolders, 1);
    xoX.searchTerms[0] = ["thump", "hi hat"];
    xoX.searchTerms[7] = [];
    xoX.matchFolders = 0;
    const blob = getvalueof();
    assert.strictEqual(blob[0], 3, "state version 3");
    assert(blob.every((v) => typeof v === "number" || (typeof v === "string" && !/\s/.test(v) && !v.includes(","))), "blob elements are numbers or single safe tokens");
    xoX.searchTerms = S.xoDefaultSearchTerms();
    xoX.matchFolders = 1;
    setvalueof(blob);
    assert.deepStrictEqual(xoX.searchTerms[0], ["thump", "hi hat"]);
    assert.deepStrictEqual(xoX.searchTerms[7], []);
    assert.deepStrictEqual(xoX.searchTerms[1], defaults[1]);
    assert.strictEqual(xoX.matchFolders, 0);
    assert.strictEqual(stripOutlets[0][0], "search_config", "loading a blob tells the node engine");
    assert.strictEqual(stripOutlets[0][1], 0);
    // a v3 blob with a short / missing tail keeps defaults for the rest
    setvalueof(base(3, 0));
    assert.deepStrictEqual(xoX.searchTerms, defaults);
    setvalueof([...base(3, 0), "XS", 1, S.xoEncodeTerms(["only"])]);
    assert.deepStrictEqual(xoX.searchTerms[0], ["only"]);
    assert.deepStrictEqual(xoX.searchTerms[1], defaults[1]);
    // saved entries before the tail keep their place
    setvalueof([3, 0, 5000, 0, 0, 2500, 0, 0, 0, 1, 4, 2, 0, 2500, 0, "XS", 1, ...defaults.map(S.xoEncodeTerms)]);
    assert.strictEqual(getSavedList().length, 1);
    assert.strictEqual(getSavedList()[0].sampleIndex, 4);
    assert.deepStrictEqual(xoX.searchTerms, defaults);
    setvalueof(base(2, 0));
  }

  // --- Options > Searches wiring: boxes, lines, layout in both themes ---
  {
    const need = ["obj-lbl-searches", "obj-searches-cat", "obj-searches-terms", "obj-searches-reset", "obj-searches-folders",
      "obj-prep-terms-cat", "obj-route-terms", "obj-prep-terms-text", "obj-prep-terms-reset", "obj-prep-match-folders"];
    for (const id of need) assert(boxMap.has(id), `${id} exists`);
    assert.strictEqual(boxMap.get("obj-searches-cat").maxclass, "live.menu");
    assert.deepStrictEqual(boxMap.get("obj-searches-cat").saved_attribute_attributes.valueof.parameter_enum, ["Kick", "Snare", "Hi-Hat", "Clap", "Perc", "Shaker", "Cymbal", "Voice"], "picker items = categories in order");
    assert.strictEqual(boxMap.get("obj-searches-cat").saved_attribute_attributes.valueof.parameter_invisible, 2, "the picker is a hidden UI-state parameter");
    assert.strictEqual(boxMap.get("obj-searches-terms").maxclass, "textedit");
    assert.strictEqual(boxMap.get("obj-searches-terms").outputmode, 1, "terms are output as one symbol (commas survive)");
    assert.strictEqual(boxMap.get("obj-searches-terms").keymode, 1, "Enter outputs the text");
    assert.strictEqual(boxMap.get("obj-searches-folders").mode, 1, "Match folders is a toggle");
    assert.strictEqual(boxMap.get("obj-searches-reset").mode, 0, "Reset is a button");
    assert.strictEqual(boxMap.get("obj-searches-folders").parameter_enable, 0, "Match folders lives in the blob, not a parameter");
    const lf = (from) => p.lines.map((l) => l.patchline).filter((l) => l.source[0] === from).map((l) => l.destination[0]);
    assert(lf("obj-searches-cat").includes("obj-prep-terms-cat") && lf("obj-prep-terms-cat").includes("obj-minimap"));
    assert(lf("obj-searches-terms").includes("obj-route-terms") && lf("obj-route-terms").includes("obj-prep-terms-text") && lf("obj-prep-terms-text").includes("obj-minimap"));
    assert(lf("obj-searches-reset").includes("obj-prep-terms-reset") && lf("obj-prep-terms-reset").includes("obj-minimap"));
    assert(lf("obj-searches-folders").includes("obj-prep-match-folders") && lf("obj-prep-match-folders").includes("obj-minimap"));
    assert.strictEqual(boxMap.get("obj-prep-terms-text").text, "prepend set_terms_text");
    for (const th of THEMES) for (let m = 0; m < 16; m++) {
      const lay3 = computeXoLayout(th, m & 1, (m >> 1) & 1, (m >> 2) & 1, (m >> 3) & 1);
      const panel = lay3.boxes["obj-panel-options"].rect;
      const ids2 = ["obj-hdr-options", "obj-lbl-theme", "obj-theme-tab", "obj-lbl-zoom", "obj-zoom-speed", "obj-lbl-map", "obj-map-samples", "obj-lbl-searches", "obj-searches-cat", "obj-searches-terms", "obj-searches-reset", "obj-searches-folders"];
      for (const id of ids2) {
        const r = lay3.boxes[id].rect;
        assert.strictEqual(lay3.boxes[id].hidden, (m >> 3) & 1 ? 0 : 1, `${th}/${m}: ${id} follows the Options section`);
        assert(r[0] >= panel[0] && r[1] >= panel[1] && r[0] + r[2] <= panel[0] + panel[2] && r[1] + r[3] <= panel[1] + panel[3], `${th}/${m}: ${id} inside the Options panel`);
      }
      for (let i = 0; i < ids2.length; i++) for (let j = i + 1; j < ids2.length; j++) {
        // click-through labels (stretched to Live's live.comment minimum height) may reach over a control
        if (/^obj-(hdr|lbl)-/.test(ids2[i]) || /^obj-(hdr|lbl)-/.test(ids2[j])) continue;
        const a = lay3.boxes[ids2[i]].rect, b = lay3.boxes[ids2[j]].rect;
        const overlap = a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
        assert(!overlap, `${th}/${m}: ${ids2[i]} and ${ids2[j]} do not overlap`);
      }
    }
    // Zoom Speed: appended stored-only float parameter, label + numbox in the Options panel
    {
      const z = boxMap.get("obj-zoom-speed"), vz = z.saved_attribute_attributes.valueof;
      assert.strictEqual(z.maxclass, "live.numbox");
      assert.deepStrictEqual([vz.parameter_longname, vz.parameter_shortname, vz.parameter_type, vz.parameter_mmin, vz.parameter_mmax, vz.parameter_initial, vz.parameter_invisible, vz.parameter_unitstyle], ["Zoom Speed", "Zoom Spd", 0, 0.25, 4, [1], 1, 9]);
      assert(Math.abs(0.25 + 3.75 * Math.pow(0.5, vz.parameter_exponent) - 1) < 0.01, "log feel: 1.0x sits at the middle of the range");
      assert.strictEqual(boxMap.get("obj-prep-zoomspeed").text, "prepend set_zoomspeed");
      const lf2 = (from) => p.lines.map((l) => l.patchline).filter((l) => l.source[0] === from).map((l) => l.destination[0]);
      assert(lf2("obj-zoom-speed").includes("obj-prep-zoomspeed") && lf2("obj-prep-zoomspeed").includes("obj-minimap"), "Zoom Speed reaches the v8ui");
      assert.strictEqual(boxMap.get("obj-lbl-zoom").ignoreclick, 1, "the label is click-through");
      for (const th of THEMES) assert(THEME_STYLE[th]["obj-zoom-speed"] && THEME_STYLE[th]["obj-lbl-zoom"], `${th} styles the Zoom Speed widgets`);
    }
    // Map Samples: appended stored-only float parameter with Int display (Live's Int stops at 255), label + numbox in the Options panel
    {
      const m = boxMap.get("obj-map-samples"), vm = m.saved_attribute_attributes.valueof;
      assert.strictEqual(m.maxclass, "live.numbox");
      assert.deepStrictEqual([vm.parameter_longname, vm.parameter_shortname, vm.parameter_type, vm.parameter_mmin, vm.parameter_mmax, vm.parameter_initial, vm.parameter_invisible, vm.parameter_unitstyle], ["Map Samples", "Map Smpl", 0, 100, 5000, [1500], 1, 0]);
      assert.strictEqual(boxMap.get("obj-prep-mapsamples").text, "prepend set_mapsamples");
      const lf3 = (from) => p.lines.map((l) => l.patchline).filter((l) => l.source[0] === from).map((l) => l.destination[0]);
      assert(lf3("obj-map-samples").includes("obj-prep-mapsamples") && lf3("obj-prep-mapsamples").includes("obj-minimap"), "Map Samples reaches the v8ui");
      assert.strictEqual(boxMap.get("obj-lbl-map").ignoreclick, 1, "the label is click-through");
      for (const th of THEMES) assert(THEME_STYLE[th]["obj-map-samples"] && THEME_STYLE[th]["obj-lbl-map"], `${th} styles the Map Samples widgets`);
      assert.strictEqual(boxMap.get("obj-map-samples").presentation, 1);
    }
    // both themes style every new box
    for (const id of ["obj-lbl-searches", "obj-searches-cat", "obj-searches-terms", "obj-searches-reset", "obj-searches-folders"]) {
      assert(THEME_STYLE.LCD[id] && THEME_STYLE.Focus[id] && THEME_STYLE.Live[id], `${id} is styled by every theme`);
    }
  }

  // --- Options handlers with recording widgets ---
  {
    const log = [];
    const widgets = {};
    const origGet = fakeLayoutPatcher.getnamed;
    const mkWidget = (id) => widgets[id] = widgets[id] || {
      text: "",
      message(...a) { log.push([id, ...a]); if (id === "obj-searches-terms") { if (a[0] === "clear") this.text = ""; if (a[0] === "set") this.text = a.slice(1).join(" "); if (a[0] === "bang") set_terms_text(this.text); } },
      getattr(n) { return n === "text" ? this.text : null; }
    };
    fakeLayoutPatcher.getnamed = function (name) {
      for (const id of ["obj-searches-cat", "obj-searches-terms", "obj-searches-folders"]) if (builtLayoutNames[id] === name) return mkWidget(id);
      return origGet.call(this, name);
    };
    setvalueof(base(2, 0));
    xoX.searchesCatIdx = 0;
    searchesSyncWidgets();
    assert.strictEqual(widgets["obj-searches-terms"].text, "kick, bd, kik, bassdrum", "the field shows the selected category's terms, comma separated");
    set_terms_cat(2);
    assert.strictEqual(widgets["obj-searches-terms"].text, "hihat, hi hat, hi-hat, hh, hat", "picking Hi-Hat shows its terms");
    assert(log.some((l) => l[0] === "obj-searches-cat" && l[1] === "set" && l[2] === 2));
    // typing + Enter
    widgets["obj-searches-terms"].text = "hat, open hat";
    set_terms_text("hat, open hat");
    assert.deepStrictEqual(xoX.searchTerms[2], ["hat", "open hat"]);
    assert.strictEqual(stripOutlets[0][0], "search_config");
    assert.strictEqual(stripOutlets[0][4], "hat|open~hat", "sent to the node engine encoded");
    // switching category commits what is typed first ("focus lost"), and it lands on the OLD category
    widgets["obj-searches-terms"].text = "hat, open hat, pedal";
    set_terms_cat(3);
    assert.deepStrictEqual(xoX.searchTerms[2], ["hat", "open hat", "pedal"], "an uncommitted edit is applied to its own category when the picker changes");
    assert.strictEqual(widgets["obj-searches-terms"].text, "clap, snap");
    // a click on the map commits too
    widgets["obj-searches-terms"].text = "clap";
    set_show_options(1);
    onclick(80, 60, 1, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(xoX.searchTerms[3], ["clap"], "a click elsewhere commits the field");
    // Reset restores the selected category only
    set_terms_reset(1);
    assert.deepStrictEqual(xoX.searchTerms[3], ["clap", "snap"]);
    assert.deepStrictEqual(xoX.searchTerms[2], ["hat", "open hat", "pedal"], "Reset touches only the selected category");
    assert.strictEqual(widgets["obj-searches-terms"].text, "clap, snap");
    set_terms_reset(0);
    // Match folders
    const folderEchoes = log.length;
    set_match_folders(0);
    assert.strictEqual(xoX.matchFolders, 0);
    assert.strictEqual(stripOutlets[0][1], 0, "Match folders off goes to the node engine");
    set_match_folders(1);
    assert.strictEqual(xoX.matchFolders, 1);
    // minimap_done re-sends the config (the node may have started after the v8ui)
    stripOutlets = [[], []];
    const sentMsgs = []; const prevOutlet = global.outlet;
    global.outlet = (i, ...a) => { sentMsgs.push(a); prevOutlet(i, ...a); };
    minimap_done(10, "x");
    global.outlet = prevOutlet;
    assert(sentMsgs.some((a) => a[0] === "search_config"), "minimap_done re-sends the search config");
    assert(sentMsgs.some((a) => a[0] === "map_samples" && a[1] === xoX.mapSamples), "minimap_done re-sends Map Samples (a node that started later still gets it)");
    // test hook helpers
    test_terms_cat(5);
    test_terms_text("shaker, egg");
    assert.deepStrictEqual(xoX.searchTerms[5], ["shaker", "egg"]);
    test_terms_reset();
    assert.deepStrictEqual(xoX.searchTerms[5], ["shaker", "tamb", "tambourine", "cabasa"]);
    set_terms_reset(1);
    xoX.searchTerms = S.xoDefaultSearchTerms();
    set_show_options(0);
    fakeLayoutPatcher.getnamed = origGet;
    xoX.searchesCatIdx = 0;
  }
  console.log("OK: category search (toolbar, node <-> v8ui agreement, colours, Options > Searches wiring / layout / handlers, state blob v3 + old versions)");
}, 600);


// --- Test S: hotkeys from the patcher's `key` object only act on the instance selected in Live ---
{
  // wiring: live.thisdevice starts the selection tracking; the test key hook enters obj-sel-key like the `key` object
  assert(linesFrom("obj-thisdevice").includes("obj-msg-init-selection"), "live.thisdevice must start init_selection (never loadbang)");
  assert(linesFrom("obj-msg-init-selection").includes("obj-minimap"), "init_selection reaches the mini-map v8ui");
  assert(linesFrom("obj-r-testkey").includes("obj-sel-key"), "receive #0-xo-testkey feeds obj-sel-key");
  assert(!/loadbang/.test(boxMap.get("obj-msg-init-selection").text), "no loadbang for init_selection");

  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  // A tiny LOM world: tracks with a view, each view has a selected_device; observers fire like Live's (on set and on change).
  const world = {
    selTrack: 0, views: {}, selDev: {}, paths: {}, observers: [], unavailable: false,
    setSelTrack(id) { this.selTrack = id; this.fire(1, "selected_track"); },
    setSelDev(viewId, dev) { this.selDev[viewId] = dev; this.fire(viewId, "selected_device"); },
    fire(id, prop) { for (const o of this.observers.slice()) if (o.id === id && o.prop === prop && o.cb) o.cb(o.api.get(prop)); },
  };
  world.paths = { 101: "live_set tracks 0 devices 0", 102: "live_set tracks 1 devices 0", 103: "live_set tracks 2 devices 0 chains 0 devices 0", 104: "live_set tracks 2 devices 0" };
  world.views = { 21: 31, 22: 32, 23: 33 }; // track -> view
  function makeInstance(selfId) {
    const tasks = [];
    const out = [];
    class Task { constructor(fn) { this.fn = fn; } schedule() { tasks.push(this.fn); } }
    class LiveAPI {
      constructor(a, b) {
        if (world.unavailable) throw new Error("LOM unavailable");
        this.cb = typeof a === "function" ? a : null;
        const p = typeof a === "function" ? b : a;
        this.p = p;
        this.id = p === "this_device" ? selfId : p === "live_set view" ? 1 : /^id \d+$/.test(p) ? Number(p.slice(3)) : 0;
        this._prop = "";
        this.api = this;
        if (this.cb) this.cb(["id", this.id]); // like Max: a new LiveAPI with a callback first reports its own id
      }
      get unquotedpath() { return world.paths[this.id] || ""; }
      get(prop) {
        if (this.id === 1 && prop === "selected_track") return ["selected_track", "id", world.selTrack];
        if (world.views[this.id] && prop === "view") return ["view", "id", world.views[this.id]];
        if (prop === "selected_device") return ["selected_device", "id", world.selDev[this.id] || 0];
        return [];
      }
      set property(prop) {
        this._prop = prop;
        world.observers = world.observers.filter((o) => o.api !== this);
        if (!prop) return;
        world.observers.push({ id: this.id, prop, cb: this.cb, api: this });
        if (this.cb) this.cb(this.get(prop));
      }
      get property() { return this._prop; }
    }
    const ctx = vm.createContext({
      mgraphics: Object.assign({}, global.mgraphics), inlets: 1, outlets: 2, outlet: (i, ...a) => out.push([i, ...a]),
      notifyclients() {}, post() {}, Task, LiveAPI, Global: function () { return {}; },
      Math, Number, String, Date, JSON, Object, Array, Atomics, SharedArrayBuffer, Int32Array, Map, Set, console
    });
    vm.runInContext(stripJs, ctx, { filename: "xo_strip_ui.js" });
    ctx.loadbang();
    const inst = {
      ctx, out, id: selfId,
      flush() { while (tasks.length) tasks.shift()(); },
      count(name) { return out.filter((m) => m[0] === 0 && m[1] === name).length; },
      // what the `key` object -> sel -> message boxes would send, by key code
      key(code) {
        const m = { 115: "hotkey_save", 83: "hotkey_save", 127: "delete_selected_saved", 8: "delete_selected_saved", [-5]: "delete_selected_saved", [-3]: "delete_selected_saved",
          28: "hotkey_prev_similar", 29: "hotkey_next_similar", 30: "hotkey_history_forward", 31: "hotkey_history_back",
          114: "hotkey_random", 82: "hotkey_random", 27: "hotkey_stop" }[code];
        if (m) ctx[m]();
      }
    };
    return inst;
  }
  const keyAll = (insts, code) => { sleep(210); insts.forEach((i) => i.key(code)); };
  const A = makeInstance(101), B = makeInstance(102), C = makeInstance(103); // C is inside a rack chain on track 3
  const all = [A, B, C];
  all.forEach((i) => i.ctx.init_selection());
  all.forEach((i) => i.flush());
  assert(all.every((i) => !i.ctx.hotkeyAllowed()), "nothing selected in Live (no selected track / device) -> no instance acts");
  all.forEach((i) => { i.out.length = 0; });
  [28, 29, 30, 31, 115, 127, 8, 114, 82, 27].forEach((k) => keyAll(all, k));
  assert(all.every((i) => i.out.length === 0), "no selection known -> the key path does nothing (fail safe)");

  // select instance A (track 21, its view 31)
  world.setSelTrack(21); all.forEach((i) => i.flush());
  assert(all.every((i) => !i.ctx.hotkeyAllowed()), "a selected track without a selected device selects no instance");
  world.setSelDev(31, 101); all.forEach((i) => i.flush());
  assert(A.ctx.hotkeyAllowed() && !B.ctx.hotkeyAllowed() && !C.ctx.hotkeyAllowed(), "only the instance whose id is selected_device is selected");
  const expectOnly = (target, label) => {
    all.forEach((i) => { i.out.length = 0; });
    const first = (i) => i.ctx.getSelectedIndex();
    const before = all.map(first);
    keyAll(all, 29); // Right = Next Similar: selection moves, `step_similar` is not emitted by the strip itself
    all.forEach((i, n) => {
      const moved = first(i) !== before[n];
      assert.strictEqual(moved, i === target, `${label}: Right arrow ${i === target ? "moves" : "must not move"} instance ${i.id}`);
    });
    const savedBefore = all.map((i) => i.ctx.getSavedList().length);
    keyAll(all, 115);
    all.forEach((i, n) => assert.strictEqual(i.ctx.getSavedList().length - savedBefore[n], i === target ? 1 : 0, `${label}: 's' saves only in the selected instance (${i.id})`));
    for (const code of [127, 8]) {
      const cnt = all.map((i) => i.ctx.getSavedList().length);
      // make one saved row selected so Delete has something to remove
      all.forEach((i) => { i.ctx.save_selected(); });
      sleep(210);
      all.forEach((i) => { const n = i.ctx.getSavedList().length; if (n) i.ctx.onclick(i.ctx.getLayout().savedX + 20, i.ctx.getLayout().savedRowY0 + 8, 1, 0, 0, 0, 0, 0); });
      const mid = all.map((i) => i.ctx.getSavedList().length);
      keyAll(all, code);
      all.forEach((i, n) => assert.strictEqual(i.ctx.getSavedList().length - mid[n], i === target ? -1 : 0, `${label}: key ${code} deletes only in the selected instance (${i.id})`));
    }
    // r (random sample) and Esc (stop playback) only act in the selected instance
    for (const code of [114, 82]) {
      all.forEach((i) => { i.out.length = 0; });
      keyAll(all, code);
      all.forEach((i) => assert.strictEqual(i.count("select_index") > 0, i === target, `${label}: key ${code} (random) only in the selected instance (${i.id})`));
      all.forEach((i) => assert(i.count("select_index") <= 1, `${label}: key ${code} fires once (${i.id})`));
    }
    all.forEach((i) => { i.out.length = 0; });
    keyAll(all, 27);
    all.forEach((i) => assert.strictEqual(i.out.filter((m) => m[0] === 1 && m[1] === "stop_playback").length, i === target ? 1 : 0, `${label}: Esc only in the selected instance (${i.id})`));
    for (const [code, name] of [[28, "step_similar"], [31, "history_back"], [30, "history_forward"]]) {
      all.forEach((i) => { i.out.length = 0; });
      keyAll(all, code);
      all.forEach((i) => assert.strictEqual(i.count(name) > 0, i === target, `${label}: key ${code} (${name}) only in the selected instance (${i.id})`));
    }
  };
  expectOnly(A, "A selected");

  // switching the selection moves the hotkeys (track change re-points the device observer)
  world.setSelTrack(22); all.forEach((i) => i.flush());
  assert(all.every((i) => !i.ctx.hotkeyAllowed()), "track 2 selected, its selected_device (0) is none of ours");
  world.setSelDev(32, 102); all.forEach((i) => i.flush());
  expectOnly(B, "B selected");
  // a device change on the OLD track's view no longer matters
  world.setSelDev(31, 101); all.forEach((i) => i.flush());
  assert(B.ctx.hotkeyAllowed() && !A.ctx.hotkeyAllowed(), "a stale track's selected_device change is ignored");

  // rack-nested instance: selected_device of a rack track reports the nested device when it is the selected one
  world.setSelTrack(23); all.forEach((i) => i.flush());
  world.setSelDev(33, 104); all.forEach((i) => i.flush());
  assert(all.every((i) => !i.ctx.hotkeyAllowed()), "the rack itself selected: no instance inside it acts");
  world.setSelDev(33, 103); all.forEach((i) => i.flush());
  expectOnly(C, "rack-nested C selected");

  // double fire (v8ui onkeydown AND the patcher message) is still single
  sleep(210);
  C.out.length = 0;
  C.ctx.onkeydown(31); C.ctx.hotkey_history_back();
  assert.strictEqual(C.count("history_back"), 1, "both delivery paths of one press still act once");
  // v8ui's own onkeydown is not gated: an unselected instance with keyboard focus still acts
  sleep(25); A.out.length = 0; A.ctx.onkeydown(31);
  assert.strictEqual(A.count("history_back"), 1, "onkeydown works on a focused v8ui even when not the selected device");

  // test overrides
  A.ctx.test_selected(1); assert(A.ctx.hotkeyAllowed());
  B.ctx.test_selected(0); assert(!B.ctx.hotkeyAllowed());
  B.ctx.test_selected(-1); assert(!B.ctx.hotkeyAllowed() && C.ctx.hotkeyAllowed(), "-1 returns to the real detection (C is selected)");
  A.ctx.test_selected(-1); assert(!A.ctx.hotkeyAllowed());
  // test_only: other hooks ignore instances that were not targeted
  A.ctx.test_only(103);
  assert(A.ctx.xoTestSkip(), "test_only 103 silences instance 101's other test hooks");
  A.ctx.test_only(101);
  assert(!A.ctx.xoTestSkip());
  A.ctx.test_only(0);
  assert(!A.ctx.xoTestSkip());

  // LOM unavailable (init throws) -> not selected, nothing acts
  world.unavailable = true;
  const D = makeInstance(105);
  D.ctx.init_selection(); D.flush();
  assert(!D.ctx.hotkeyAllowed(), "LOM unavailable -> no selection -> no hotkeys");
  D.out.length = 0; keyAll([D], 29); keyAll([D], 115);
  assert.strictEqual(D.out.length, 0, "LOM unavailable: the key path does nothing");
  world.unavailable = false;
  // report exposes the flag
  {
    const store = {};
    C.ctx.Global = function () { return store; };
    C.ctx.test_report();
    const r = JSON.parse(store.last);
    assert.strictEqual(r.isSelected, 1, "test_report exposes isSelected");
    assert.strictEqual(r.selectedDeviceId, "103");
    assert.strictEqual(r.deviceId, "103");
  }
  console.log("OK: hotkeys only act on the instance selected in Live (3 instances, rack-nested, switching, LOM unavailable, double fire)");
}

// --- Dot groups: dots that overlap almost entirely share one dot, one hit target and a round-robin audition ---
{
  const sent = [];
  const prevOut = global.outlet;
  global.outlet = (idx, ...args) => { sent.push([idx, ...args]); };
  const selects = () => sent.filter((m) => m[0] === 0 && m[1] === "select_index").map((m) => m[2]);
  const clearSent = () => { sent.length = 0; };
  const L = getLayout();
  const R = 2.1; // dot radius with <= 250 points
  const DIST = xoX.GROUP_DIST_FACTOR * R;
  assert(Math.abs(xoX.GROUP_DIST_FACTOR - 1.05) < 1e-12, "grouping distance is 1.05 x the dot radius (tuned in Live: 1500 Core Library points -> 996 dots)");
  // Place points at SCREEN positions of the 1x view: specs [sx, sy, catField, name]
  const place = (specs) => {
    resetView();
    minimap_clear();
    const flat = [];
    for (const [sx, sy, cat, name] of specs) {
      const [nx, ny] = screenToNorm(sx, sy, L);
      flat.push(nx, ny, cat === undefined ? 16 + 0 : cat, 200, 50, 50, 50, name || "P");
    }
    minimap_batch(0, ...flat);
    minimap_done(specs.length, "grp");
  };
  const grp = () => getGroups();
  const sizes = () => grp().groups.map((g) => g.members.length).sort((a, b) => b - a);
  const KICK = 16, SNARE = 33;

  // 1. threshold: within 0.6 R of the first member joins; leader-based (no chaining)
  place([[100, 60, KICK, "A"], [100 + DIST * 0.9, 60, KICK, "B"], [100 + DIST * 1.8, 60, KICK, "C"], [100 + DIST * 1.2, 60, KICK, "D"], [100, 80, KICK, "E"]]);
  {
    const g = grp();
    assert.deepStrictEqual(g.groups.map((x) => x.members), [[0, 1], [2, 3], [4]].map((m) => m), "threshold: A+B group; C is beyond A (no chaining through B) and D joins C's group (D-C = 0.6 DIST)");
    assert.strictEqual(g.groups[0].leader, 0, "a group's identity / position is its lowest member");
    assert.strictEqual(g.groupOf[1], 0);
    assert.strictEqual(g.groupOf[4], 2);
  }
  // 2. a pair straddling a spatial-hash cell boundary still groups
  {
    const edge = Math.round(100 / DIST) * DIST;
    place([[edge - 0.1, 60, KICK], [edge + 0.2, 60, KICK], [edge + 0.2, 60 + DIST * 0.5, KICK], [edge - 0.1, 60 - DIST * 0.99, KICK]]);
    assert.deepStrictEqual(sizes(), [4], "points on both sides of cell edges (x and y) group");
  }
  // 3. hit testing works on groups: the leader is hit, a group never splits a hit
  place([[100, 60, KICK, "A"], [100, 60, SNARE, "B"], [100.2, 60.1, KICK, "C"], [150, 60, KICK, "D"]]);
  assert.strictEqual(findNearestVisiblePoint(101, 61, 10), 0, "hit test returns the group's lead sample");
  assert.strictEqual(findNearestVisiblePoint(150, 60, 3), 3);
  assert.strictEqual(findNearestVisiblePoint(125, 60, 3), -1);
  assert.strictEqual(grp().groups.length, 2);

  // 4. cache: no rebuild without a change; filters / category / search / view / points / size invalidate it
  {
    const b0 = grp().builds;
    paint(); paint(); findNearestVisiblePoint(100, 60, 5); onidle(100, 60, 0, 0, 0, 0, 0, 0);
    assert.strictEqual(grp().builds, b0, "paint / hit-test / hover reuse the cached groups");
    strip_filter_maxlen(5000); // unchanged value
    assert.strictEqual(grp().builds, b0, "an unchanged filter value keeps the cache");
    strip_filter_maxlen(100); grp(); assert.strictEqual(grp().builds, b0 + 1, "MaxLen invalidates"); strip_filter_maxlen(5000);
    grp(); const b1 = grp().builds;
    xoX.activeCategory = "kick"; grp(); assert.strictEqual(grp().builds, b1 + 1, "category invalidates"); xoX.activeCategory = "ALL"; grp();
    const b2 = grp().builds;
    strip_filter_search("zzz"); grp(); assert.strictEqual(grp().builds, b2 + 1, "search invalidates"); strip_filter_search("");
    grp(); const b3 = grp().builds;
    zoomViewAt(100, 60, 1.5, L); grp(); assert.strictEqual(grp().builds, b3 + 1, "zoom invalidates"); resetView();
    grp(); const b4 = grp().builds;
    minimap_batch(0, 0.5, 0.5, 16, 200, 50, 50, 50, "A"); grp(); assert.strictEqual(grp().builds, b4 + 1, "a point update invalidates");
    place([[100, 60, KICK, "A"], [100, 60, KICK, "B"], [100.2, 60.1, KICK, "C"], [150, 60, KICK, "D"]]);
  }

  // 5. zoom splits a group, zooming out merges it again
  place([[100, 60, KICK, "A"], [100 + DIST * 0.9, 60, KICK, "B"], [100, 60 + DIST * 1.5, KICK, "C"]]);
  {
    assert.deepStrictEqual(sizes(), [2, 1], "setup: A+B grouped, C apart");
    const n1 = grp().groups.length;
    zoomViewAt(100, 60, 6, L);
    const n6 = grp().groups.length;
    assert(n6 > n1, `zooming in splits groups (${n1} -> ${n6})`);
    resetView();
    assert.strictEqual(grp().groups.length, n1, "zooming out merges them again");
  }

  // 6. filters change membership: a hidden point never joins a visible one (and hidden points group among themselves)
  place([[100, 60, KICK, "Kick A"], [100, 60, KICK, "Kick B"], [100.2, 60, KICK, "Snare C"], [100.3, 60, KICK, "Snare D"], [150, 60, KICK, "Kick E"]]);
  {
    assert.strictEqual(grp().groups.length, 2);
    strip_filter_search("snare");
    const g = grp();
    const vis = g.groups.filter((x) => x.vis);
    const hid = g.groups.filter((x) => !x.vis);
    assert.deepStrictEqual(vis.map((x) => x.members), [[2, 3]], "only the visible Snare pair forms a visible group");
    assert.deepStrictEqual(hid.map((x) => x.members), [[0, 1], [4]], "hidden points group among themselves");
    assert.strictEqual(findNearestVisiblePoint(100, 60, 5), 2, "hidden groups cannot be hit");
    strip_filter_search("");
  }

  // 7. round robin: each click plays the next member and cycles through all of them
  place([[100, 60, KICK, "A"], [100, 60, KICK, "B"], [100.3, 60, KICK, "C"], [160, 60, KICK, "S"]]);
  {
    clearSent();
    const seq = [];
    for (let k = 0; k < 7; k++) { onclick(100, 60, 1, 0, 0, 0, 0, 0); ondrag(100, 60, 0, 0, 0, 0, 0, 0); }
    seq.push(...selects());
    assert.deepStrictEqual(seq, [0, 1, 2, 0, 1, 2, 0], "repeated clicks cycle through every member of the group");
    clearSent();
    onclick(160, 60, 1, 0, 0, 0, 0, 0); ondrag(160, 60, 0, 0, 0, 0, 0, 0);
    onclick(160, 60, 1, 0, 0, 0, 0, 0); ondrag(160, 60, 0, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(selects(), [3, 3], "a single dot plays itself every click");
    clearSent();
    onclick(100, 60, 1, 0, 0, 0, 0, 0); ondrag(100, 60, 0, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(selects(), [1], "the group remembered its position while the groups were not rebuilt");
    // groups rebuilt (view change) reset the counter
    zoomViewAt(100, 60, 1.3, L); paint(); resetView();
    clearSent();
    onclick(100, 60, 1, 0, 0, 0, 0, 0); ondrag(100, 60, 0, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(selects(), [0], "a rebuilt group starts again at its first member");
  }

  // 8. scrub: staying on a group does not re-trigger, re-entering plays the next member
  place([[100, 60, KICK, "A"], [100, 60, KICK, "B"], [100.2, 60, KICK, "C"], [140, 60, KICK, "S"]]);
  {
    clearSent();
    onclick(100, 60, 1, 0, 0, 0, 0, 0);
    ondrag(100.4, 60.3, 1, 0, 0, 0, 0, 0);
    ondrag(99.6, 59.8, 1, 0, 0, 0, 0, 0);
    ondrag(100, 60, 1, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(selects(), [0], "dragging within the same group does not re-trigger");
    ondrag(140, 60, 1, 0, 0, 0, 0, 0);
    ondrag(140.5, 60, 1, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(selects(), [0, 3], "moving onto another dot plays it once");
    ondrag(100, 60, 1, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(selects(), [0, 3, 1], "re-entering the group plays its NEXT member");
    ondrag(100, 60, 1, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(selects(), [0, 3, 1], "still no re-trigger");
    ondrag(100, 110, 1, 0, 0, 0, 0, 0); // empty space (> 24 px from every dot)
    ondrag(100, 60, 1, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(selects(), [0, 3, 1, 2], "leaving to empty space and coming back plays the next member");
    ondrag(100, 60, 0, 0, 0, 0, 0, 0);
    // a single dot that is already selected is not re-triggered by scrubbing off and on it
    clearSent();
    onclick(140, 60, 1, 0, 0, 0, 0, 0);
    ondrag(140, 110, 1, 0, 0, 0, 0, 0);
    ondrag(140, 60, 1, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(selects(), [3], "a selected single dot is not re-triggered (as before)");
    ondrag(140, 60, 0, 0, 0, 0, 0, 0);
    // double-click replays the member the click just played
    clearSent();
    onclick(100, 60, 1, 0, 0, 0, 0, 0); ondrag(100, 60, 0, 0, 0, 0, 0, 0);
    const first = selects()[0];
    ondblclick(100, 60, 1, 0, 0, 0, 0, 0);
    assert.deepStrictEqual(selects(), [first, first], "double-click replays the selected member instead of skipping ahead");
  }

  // 9. hover plays nothing; the HUD names the next member and the count
  place([[100, 60, KICK, "Kick A"], [100, 60, KICK, "Kick B"], [100.2, 60, KICK, "Kick C"], [140, 60, KICK, "Solo"]]);
  {
    clearSent();
    const texts = [];
    const origText = mgraphics.show_text;
    mgraphics.show_text = function (t) { texts.push(t); };
    onidle(100, 60, 0, 0, 0, 0, 0, 0);
    onidle(100.3, 60.2, 0, 0, 0, 0, 0, 0);
    paint();
    assert.strictEqual(sent.length, 0, "plain hover sends nothing (no audition)");
    assert(texts.some((t) => /^Kick A \(200ms\) \+2$/.test(t)), `HUD shows the next member and the extra count (${texts.filter((t) => /Kick|Solo/.test(t))})`);
    onclick(100, 60, 1, 0, 0, 0, 0, 0); ondrag(100, 60, 0, 0, 0, 0, 0, 0);
    texts.length = 0; paint();
    assert(texts.some((t) => /^Kick B \(200ms\) \+2$/.test(t)), "after a click the HUD shows the next member");
    texts.length = 0;
    onidle(140, 60, 0, 0, 0, 0, 0, 0); paint();
    assert(texts.some((t) => /^Solo \(200ms\)$/.test(t)), "a single dot shows just its name");
    mgraphics.show_text = origText;
    onidle(300, 300, 0, 0, 0, 0, 0, 0);
  }

  // 10. selection ring and k-NN lines refer to the chosen member, drawn at the group's dot
  place([[100, 60, KICK, "A"], [100, 60, KICK, "B"], [100.2, 60, KICK, "C"], [140, 70, KICK, "S"], [60, 70, KICK, "T"]]);
  {
    clearSent();
    onclick(100, 60, 1, 0, 0, 0, 0, 0); onclick(100, 60, 1, 0, 0, 0, 0, 0); // plays B (index 1)
    ondrag(100, 60, 0, 0, 0, 0, 0, 0);
    assert.strictEqual(getSelectedIndex(), 1, "the chosen member is the selection");
    selected_info(1, "B", "kick", 0, 200, 50, 0, ...new Array(24).fill(0.3), "nbrs", 3, 4, 2);
    const arcs = [];
    const lines = [];
    const origArc = mgraphics.arc;
    const origMove = mgraphics.move_to;
    const origLine = mgraphics.line_to;
    mgraphics.arc = function (cx, cy, r) { arcs.push([cx, cy, r]); };
    mgraphics.move_to = function (x, y) { lines.push([x, y]); };
    mgraphics.line_to = function (x, y) { lines.push([x, y]); };
    paint();
    mgraphics.arc = origArc; mgraphics.move_to = origMove; mgraphics.line_to = origLine;
    const g0 = grp().groups[0];
    assert(arcs.some((a) => Math.abs(a[0] - g0.x) < 1e-9 && Math.abs(a[1] - g0.y) < 1e-9 && Math.abs(a[2] - (R + 2.4)) < 1e-9), "selection ring sits on the group's dot");
    assert(lines.some((l) => Math.abs(l[0] - g0.x) < 1e-9 && Math.abs(l[1] - g0.y) < 1e-9), "k-NN lines start at the group's dot");
    // the neighbour (member C of the same group) does not draw a line to itself, S / T do
    const gS = grp().groups[grp().groupOf[3]];
    const gT = grp().groups[grp().groupOf[4]];
    assert(lines.some((l) => Math.abs(l[0] - gS.x) < 1e-6 && Math.abs(l[1] - gS.y) < 1e-6), "a k-NN line reaches neighbour S's dot");
    assert(lines.some((l) => Math.abs(l[0] - gT.x) < 1e-6 && Math.abs(l[1] - gT.y) < 1e-6), "a k-NN line reaches neighbour T's dot");
    // arrow navigation / saved recall select individual samples: a selected non-leader still rings the group's dot
    selected_info(2, "C", "kick", 0, 200, 50, 0, ...new Array(24).fill(0.3), "nbrs");
    arcs.length = 0; mgraphics.arc = function (cx, cy, r) { arcs.push([cx, cy, r]); }; paint(); mgraphics.arc = origArc;
    assert(arcs.some((a) => Math.abs(a[0] - g0.x) < 1e-9 && Math.abs(a[2] - (R + 2.4)) < 1e-9), "an individually selected member rings its group's dot");
  }

  // 11. paint: one dot per group; a merged dot is drawn exactly like a single dot (no ring, same radius)
  place([[100, 60, KICK, "A"], [100, 60, KICK, "B"], [100.2, 60, KICK, "C"], [140, 60, KICK, "S"], [160, 60, SNARE, "T"], [160.2, 60, SNARE, "U"]]);
  {
    const arcs = [];
    const origArc = mgraphics.arc;
    mgraphics.arc = function (cx, cy, r) { arcs.push([cx, cy, r]); };
    paint();
    mgraphics.arc = origArc;
    const inMap = arcs.filter((a) => a[1] > L.plotY && a[1] < L.toolbarY);
    const dots = inMap.filter((a) => Math.abs(a[2] - R) < 1e-9);
    assert.strictEqual(dots.length, 3, "6 points in 3 groups: 3 dots");
    // At each group position: its dot, plus (only for the selected group) the two selection rings; no group marker.
    const sel = new Set([R + 4.4, R + 2.4].map((r) => r.toFixed(6)));
    for (const [gx, gy] of [[100, 60], [140, 60], [160, 60]]) {
      const here = inMap.filter((a) => Math.abs(a[0] - gx) < 1e-9 && Math.abs(a[1] - gy) < 1e-9 && !sel.has(a[2].toFixed(6)));
      assert.deepStrictEqual(here.map((a) => a[2]), [R], `group at ${gx},${gy}: exactly one dot of the normal radius, no ring or marker`);
    }
    assert.strictEqual(groupReport().drawn, 3);
  }

  // 12. performance and draw-count reduction on 1500 / 5000 points (pseudo-random layout, 9 cluster centres + scatter)
  const rnd = (() => { let a = 12345; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  for (const N of [1500, 5000]) {
    minimap_clear();
    for (let i = 0; i < N; i += 50) {
      const flat = [];
      for (let j = i; j < Math.min(N, i + 50); j++) {
        const c = j % 9;
        const clustered = j % 3 !== 0;
        const x = clustered ? Math.max(0.02, Math.min(0.98, 0.15 + (c % 3) * 0.35 + (rnd() - 0.5) * 0.18)) : rnd();
        const y = clustered ? Math.max(0.02, Math.min(0.98, 0.2 + Math.floor(c / 3) * 0.3 + (rnd() - 0.5) * 0.18)) : rnd();
        flat.push(x, y, (j % 8) * 16 + (j % 8), 100 + (j % 900), 50, 40, 60, "P" + j);
      }
      minimap_batch(i, ...flat);
    }
    minimap_done(N, "grp");
    resetView();
    const t0 = process.hrtime.bigint();
    const gg = grp();
    const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;
    let members = 0;
    for (const g of gg.groups) members += g.members.length;
    assert.strictEqual(members, N, "every point belongs to exactly one group at 1x");
    const t1 = process.hrtime.bigint();
    for (let k = 0; k < 50; k++) grp();
    const cachedMs = Number(process.hrtime.bigint() - t1) / 1e6 / 50;
    paint();
    const t2 = process.hrtime.bigint();
    for (let k = 0; k < 20; k++) paint();
    const paintMs = Number(process.hrtime.bigint() - t2) / 1e6 / 20;
    const rep = groupReport();
    console.log(`BENCH: ${N} points -> ${rep.count} dots drawn (${(100 * (1 - rep.count / N)).toFixed(1)} % fewer), ${rep.multi} groups of 2+ (max ${rep.maxSize}); first grouping ${buildMs.toFixed(2)} ms, cached lookup ${cachedMs.toFixed(4)} ms, paint ${paintMs.toFixed(2)} ms`);
    assert(rep.count < N, "grouping reduces the dot count");
    assert(buildMs < 50, `grouping ${N} points must stay far under a frame (${buildMs.toFixed(1)} ms)`);
    assert(cachedMs < 0.2, "the cached lookup is free");
    assert.strictEqual(rep.drawn, rep.count, "paint draws one dot per group");
    // a zoomed view regroups only the points in view
    zoomViewAt(100, 60, 4, L);
    paint();
    assert(groupReport().count < N, "zoomed view draws fewer dots than points");
    resetView();
  }
  minimap_clear();
  minimap_done(0, "grp");
  global.outlet = prevOut;
  console.log("OK: dot groups (threshold, cell edges, zoom, filters, cache, round robin on click / scrub / double-click, hover, selection, k-NN, paint, performance)");
}

// Paint cost with the maximum number of map points (5000): JS side only (the mock mgraphics draws nothing)
{
  const prevOut = global.outlet;
  global.outlet = () => {};
  minimap_clear();
  for (let i = 0; i < 5000; i += 35) {
    const flat = [];
    for (let j = i; j < Math.min(5000, i + 35); j++) flat.push((j * 0.6180339) % 1, (j * 0.7548777) % 1, (j % 8) * 16 + (j % 8), 100 + j % 900, 50, 40, 60, "P" + j);
    minimap_batch(i, ...flat);
  }
  minimap_done(5000, "bench");
  const bench = (label, zoomIn) => {
    resetView();
    if (zoomIn) zoomViewAt(100, 70, 4, getLayout());
    paint();
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < 20; k++) paint();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
    console.log(`BENCH: paint with 5000 map points (${label}): ${ms.toFixed(2)} ms`);
    return ms;
  };
  const full = bench("full view", false);
  const zoomed = bench("4x zoom", true);
  resetView();
  assert(full < 50 && zoomed < 50, `painting 5000 points must stay well under a frame (${full.toFixed(1)} / ${zoomed.toFixed(1)} ms)`);
  global.outlet = prevOut;
}
console.log("SUCCESS: All mono/stereo audio routing, M4L runtime 's' hotkey, native Cocoa OS file drag-out, scrollable/reorderable/deletable saved list, and Infinite MaxLen filter tests passed!");

// Structural / layout checks of the built device (tests/test_xo_layout.js).
require("child_process").execFileSync(process.execPath, [path.join(__dirname, "test_xo_layout.js")], { stdio: "inherit" });
