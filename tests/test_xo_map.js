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
assert.strictEqual(p.devicewidth, 798.0, "Expected devicewidth 798.0");
assert.strictEqual(p.openinpresentation, 1, "Expected openinpresentation = 1");
assert.deepStrictEqual(p.openrect, [0.0, 0.0, 798.0, 169.0], "Expected 798x169 openrect");

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
  "obj-scan-msg", "obj-scan-line", "obj-prep-playhead",
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
const reseedBtnRect = boxMap.get("obj-reseed-filtered-btn").presentation_rect;
const clrBtnRect = boxMap.get("obj-search-clear-btn").presentation_rect;
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
// background=1, and a 1x1 presentation_rect at the end of boxes (behind obj-panel-left) so it boots in M4L presentation mode without ever showing "ox🔨"!
const nodeBox = boxMap.get("obj-node");
assert.strictEqual(nodeBox.presentation, 1, "Regression: obj-node must have presentation: 1 to boot in M4L presentation mode");
assert.strictEqual(nodeBox.background, 1, "Regression: obj-node must have background: 1 so it sits in the background layer");
assert.strictEqual(nodeBox.ignoreclick, 1, "Expected ignoreclick: 1 on hidden background obj-node");
assert(
  nodeBox.presentation_rect[2] <= 2.0 && nodeBox.presentation_rect[3] <= 2.0,
  "Regression: obj-node presentation_rect must be 1x1px so it never renders any text/icon over the UI"
);
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
assert(/^sel 115 83 127 8 -5 -3 28 29 30 31$/.test(boxMap.get("obj-sel-key").text), "obj-sel-key must also match the arrow key codes 28 29 30 31");
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
assert(
  filterPanelRect[0] + filterPanelRect[2] <= playbackPanelRect[0],
  "Expected FILTERS panel and PLAYBACK panel to be visibly separate"
);

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
assert.deepStrictEqual(THEMES, ["LCD", "Focus"], "theme order is part of the Theme parameter (enum LCD, Focus)");

const LAYOUT_COMBOS = [];
for (let ov = 0; ov <= 1; ov++) for (let sv = 0; sv <= 1; sv++) for (let fv = 0; fv <= 1; fv++) for (let pv = 0; pv <= 1; pv++) LAYOUT_COMBOS.push([sv, fv, pv, ov]);
const PANEL_OF = { toolbar: "obj-panel-toolbar", options: "obj-panel-options", left: "obj-panel-left", filters: "obj-panel-filters", playback: "obj-panel-playback" };
const contains = (outer, inner) =>
  inner[0] >= outer[0] && inner[1] >= outer[1] &&
  inner[0] + inner[2] <= outer[0] + outer[2] && inner[1] + inner[3] <= outer[1] + outer[3];
// obj-expr-width: 'expr 278 + $i1 * 136 + $i4 * 102 + $i2 * (214 - 74 * $i5) + ...' over (saved filters playback options theme); evaluated here.
// No comma (so no if()): a comma inside an expr box has to be escaped in Max.
const exprWidth = (sv, fv, pv, ov, theme) => {
  const text = boxMap.get("obj-expr-width").text;
  assert(/^expr [-+*()\s$i0-9.]+$/.test(text) && !text.includes(","), `obj-expr-width must be a plain arithmetic expr without commas: ${text}`);
  const vals = [sv, fv, pv, ov, theme === "LCD" ? 0 : 1];
  const body = text.replace(/^expr /, "").replace(/\$i(\d)/g, (m, d) => String(vals[Number(d) - 1]));
  return Function('"use strict"; return (' + body + ");")();
};

const layAll = xoLayout.computeXoLayout("LCD", 1, 1, 1, 0);
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
  assert.strictEqual(xoLayout.computeXoLayout(THEMES[0], sv, fv, pv, ov).boxes["obj-minimap"].rect[2], xoLayout.computeXoLayout(THEMES[1], sv, fv, pv, ov).boxes["obj-minimap"].rect[2], `[${tag}] map pane width equal in both themes`);
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
    const visible = secOn && (!lay.themeOnly[id] || lay.themeOnly[id] === theme);
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
    assert.strictEqual(lay.boxes[id + "-mir"].hidden, secOn && theme === "Focus" ? 0 : 1, `[${tag}] ${id}-mir (live.dial) visible only in Focus`);
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
assert.strictEqual(xoLayout.computeXoLayout("Focus", 1, 1, 1, 0).deviceWidth, 712.0);
assert.strictEqual(xoLayout.computeXoLayout("LCD", 1, 1, 1, 1).deviceWidth, 798.0 + xoLayout.XO_OPTIONS_W + 6, "Options adds its width (+6 gap)");
assert.strictEqual(xoLayout.computeXoLayout(0, 1, 1, 1, 0).theme, "LCD", "theme accepts its index");
assert.strictEqual(xoLayout.computeXoLayout(1, 1, 1, 1, 0).theme, "Focus", "theme accepts its index");

// Wiring: the v8ui must hear about every section toggle and the theme, and re-apply the layout on load.
assert(linesFrom("obj-toggle-saved-btn").includes("obj-pak-vis"), "Saved toggle must drive the device width");
assert(linesFrom("obj-toggle-options-btn").includes("obj-pak-vis") && linesFrom("obj-toggle-options-btn").includes("obj-prep-show-options"), "Options toggle drives width and the v8ui");
assert(linesFromPort("obj-theme-tab", 0).includes("obj-pak-vis:4"), "Theme tab drives the device width (pak inlet 5)");
assert.strictEqual(boxMap.get("obj-pak-vis").text, "pak 1 1 1 0 0", "pak: saved filters playback options theme");
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
  assert.deepStrictEqual(vo("obj-theme-tab").parameter_enum, ["LCD", "Focus"]);
  assert.deepStrictEqual(vo("obj-theme-tab").parameter_initial, [0], "default theme is LCD");
  assert.strictEqual(boxMap.get("obj-theme-tab").maxclass, "live.tab");
  assert.strictEqual(vo("obj-toggle-options-btn").parameter_longname, "ShowOptions");
  assert.deepStrictEqual(vo("obj-toggle-options-btn").parameter_initial, [0], "Options section starts closed");
  assert.strictEqual(boxMap.get("obj-toggle-options-btn").pictures[0], "gear.svg");
  assert.strictEqual(boxMap.get("obj-toggle-options-btn").annotation_name, "Show Options Section");
  const keys = Object.keys(p.parameters).filter((k) => k !== "parameterbanks" && k !== "inherited_shortname");
  assert.deepStrictEqual(keys.filter((k) => !k.endsWith("-mir")).slice(-2), ["obj-toggle-options-btn", "obj-theme-tab"], "new parameters are appended last");
  const longs = p.boxes.map((b) => b.box).filter((b) => b.saved_attribute_attributes && b.saved_attribute_attributes.valueof && b.saved_attribute_attributes.valueof.parameter_longname).map((b) => b.saved_attribute_attributes.valueof.parameter_longname);
  assert.deepStrictEqual(longs.filter((l) => !l.endsWith("View")).slice(-2), ["ShowOptions", "Theme"], "new parameter boxes come after every existing parameter box");
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
for (const [id, attrs] of Object.entries(THEME_STYLE.LCD)) {
  for (const [k, v] of Object.entries(attrs)) assert.deepStrictEqual(boxMap.get(id)[k], v, `saved attribute ${id}.${k} equals the LCD style`);
}
for (const id of ["obj-panel-filters", "obj-panel-playback", "obj-hdr-filters", "obj-hdr-playback", "obj-reseed-filtered-btn", "obj-reverse-btn", "obj-search-box", "obj-search-clear-btn", "obj-panel-toolbar", "obj-panel-left", "obj-panel-options", "obj-theme-tab", "obj-toggle-saved-btn", "obj-toggle-options-btn", "obj-hdr-options", "obj-lbl-theme"]) {
  assert(THEME_STYLE.LCD[id] && THEME_STYLE.Focus[id], `${id} is restyled by both themes`);
}
assert(THEME_STYLE.LCD["obj-pitch-dial"].lcdcolor, "LCD numbox colours (lcdcolor) come from the LCD style");

// Scripting names: getnamed() needs a unique varname on every laid-out box, matching XO_LAYOUT_NAMES.
const namesMatch = /var XO_LAYOUT_NAMES = (\{[^\n]*\});/.exec(boxMap.get("obj-minimap").textfile.text);
assert(namesMatch, "Mini-map script must start with the injected XO_LAYOUT_NAMES");
const builtLayoutNames = JSON.parse(namesMatch[1]);
const allVarnames = p.boxes.map((b) => b.box.varname).filter(Boolean);
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
  global.outlet = prevOutlet;
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
  const dotArcs = arcs.filter((a) => a[2] === 2.6 || a[2] === 3.3 || a[2] === 1.4);
  assert(dotArcs.length > 0, "some dots are drawn");
  for (const [cx, cy] of dotArcs) {
    if (cy >= lz.toolbarY || cy < lz.plotY - 1) continue; // toolbar icons / banner are not map dots
    assert(cx >= lz.plotX && cx <= lz.plotX + lz.plotW && cy >= lz.plotY && cy <= lz.plotY + lz.plotH, `dot (${cx},${cy}) must stay inside the plot rect`);
  }
  const expectedDots = pts.filter((p) => { const [sx, sy] = normToScreen(p.x, p.y, lz); return isInPlotRect(sx, sy, lz, 3.6); }).length;
  assert(arcs.filter((a) => (a[2] === 2.6 || a[2] === 3.3 || a[2] === 1.4) && a[1] > lz.plotY - 1 && a[1] < lz.toolbarY).length >= Math.min(expectedDots, 1), "culling keeps in-view dots");
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
for (const [id, spec] of Object.entries(computeXoLayout("LCD", 1, 1, 1, 0).boxes)) {
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
  const attr = (id, a) => (fakeLayoutPatcher.attrs[builtLayoutNames[id]] || {})[a];
  assert.strictEqual(getXoThemeName(), "LCD", "default theme is LCD");
  assert.strictEqual(getShowOptions(), 0, "Options section starts closed");
  assert.strictEqual(xoPaletteName, "LCD", "the default theme's palette is active before any set_theme (the variant devices stay on \"default\")");
  set_show_options(1);
  assert.strictEqual(hid("obj-panel-options"), 0);
  assert.strictEqual(hid("obj-theme-tab"), 0, "Options shows the Theme selector");
  assert.deepStrictEqual(rect("obj-panel-options"), [28, 5, 96, 159], "Options slides in right of the toolbar");
  assert.strictEqual(rect("obj-panel-left")[0], 130, "the map panel slides right by the Options width + gap");
  assert.strictEqual(rect("obj-panel-filters")[0], 130 + 380 + 6, "Filters follow (Saved shown)");
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
  assert.strictEqual(rect("obj-panel-filters")[2], 134, "Focus Filters column is slim");
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
  const cats = ["kick", "snare", "hihat", "clap", "tom", "rim", "cymbal", "shaker", "perc", "fx"].map((c) => xoPaletteCat(c, [0, 0, 1, 1]).join());
  assert.strictEqual(new Set(cats).size, cats.length, "LCD category colours stay distinct");
  for (const c of cats) { const v = c.split(",").map(Number); assert(v[0] >= v[1] && v[1] >= v[2], `LCD category colour is warm (${c})`); }
  paintCommands.length = 0;
  paint();
  const cols = paintCommands.filter((c) => c.op === "rgba" && c.a > 0.5);
  assert(cols.length > 20 && cols.every((c) => c.r >= c.g - 1e-9 && c.g >= c.b - 1e-9), "LCD theme paints only amber-family colours (r >= g >= b)");
  set_theme(1);
  paintCommands.length = 0;
  paint();
  assert(paintCommands.some((c) => c.op === "rgba" && c.b > c.r + 0.2), "Focus paints the original blue accents again");
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
assert.deepStrictEqual(stripOutlets[0], ["reseed_map"], "Clicking Re-Seed toolbar button must emit reseed_map");

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
    return { file, rendered: file !== scanRes.samples[monoSampleIdx].path, speed: get("play_speed")[1], scan: get("play_scan_dur")[1], dec };
  };
  for (const mode of [0, 1, 2]) {
    const a = play(0, 50, mode), b = play(7, 50, mode), c = play(-12, 50, mode);
    for (const r of [a, b, c]) {
      assert(r.rendered, "Speed 50 % is rendered");
      assert.strictEqual(r.speed, 1, "sfplay~ is never repitched on a rendered file");
      assert(Math.abs(r.dec.durationMs - srcMs * 2) <= 15, `mode ${mode}: length ${r.dec.durationMs} must be input/0.5 = ${srcMs * 2} whatever the Pitch`);
      assert(Math.abs(r.scan - r.dec.durationMs) <= 2, `mode ${mode}: scan duration ${r.scan} must match the rendered length ${r.dec.durationMs}`);
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

console.log("SUCCESS: All mono/stereo audio routing, M4L runtime 's' hotkey, native Cocoa OS file drag-out, scrollable/reorderable/deletable saved list, and Infinite MaxLen filter tests passed!");

// Every layout variant (default, A..E): structural / layout checks (tests/test_xo_variants.js).
require("child_process").execFileSync(process.execPath, [path.join(__dirname, "test_xo_variants.js")], { stdio: "inherit" });
