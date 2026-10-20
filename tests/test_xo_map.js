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
assert.strictEqual(p.devicewidth, 776.0, "Expected devicewidth 776.0");
assert.strictEqual(p.openinpresentation, 1, "Expected openinpresentation = 1");
assert.deepStrictEqual(p.openrect, [0.0, 0.0, 776.0, 169.0], "Expected 776x169 openrect");

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
  "obj-node", "obj-minimap", "obj-folder-list", "obj-map-window", "obj-open-map-btn",
  "obj-toggle-saved-btn", "obj-toggle-filters-btn", "obj-toggle-playback-btn",
  "obj-search-box", "obj-search-clear-btn",
  "obj-maxlen-dial", "obj-tone-dial", "obj-filter-tonal-dial", "obj-filter-drum-dial", "obj-reseed-filtered-btn",
  "obj-pitch-dial", "obj-speed-dial", "obj-grain-dial", "obj-decay-dial", "obj-spec-dial", "obj-gain-dial", "obj-reverse-btn",
  "obj-root-thispatcher", "obj-pak-vis", "obj-expr-width", "obj-prep-setwidth",
  "obj-panel-left", "obj-panel-filters", "obj-panel-playback",
  "obj-scan-msg", "obj-scan-line", "obj-prep-playhead",
  "obj-key", "obj-sel-key", "obj-msg-hotkey-save", "obj-msg-del-saved"
]) {
  assert(boxMap.has(reqId), `Missing required box: ${reqId}`);
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

// Verify Section Collapse/Show Toggles in the top toolbar next to Open Map
assert(linesFrom("obj-toggle-saved-btn").includes("obj-prep-show-saved"), "obj-toggle-saved-btn must route to obj-prep-show-saved");
assert(linesFrom("obj-prep-show-saved").includes("obj-minimap"), "obj-prep-show-saved must route to obj-minimap");
assert(linesFrom("obj-toggle-filters-btn").includes("obj-inv-filters"), "obj-toggle-filters-btn must route to obj-inv-filters");
assert(linesFrom("obj-prep-hide-filters").includes("obj-panel-filters"), "obj-prep-hide-filters must hide/show obj-panel-filters");
assert(linesFrom("obj-prep-hide-filters").includes("obj-folder-list"), "obj-prep-hide-filters must hide/show obj-folder-list");
assert(linesFrom("obj-toggle-playback-btn").includes("obj-inv-playback"), "obj-toggle-playback-btn must route to obj-inv-playback");
assert(linesFrom("obj-prep-hide-playback").includes("obj-panel-playback"), "obj-prep-hide-playback must hide/show obj-panel-playback");
assert(linesFrom("obj-prep-hide-playback").includes("obj-pitch-dial"), "obj-prep-hide-playback must hide/show obj-pitch-dial");

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

// Test Granular Time-Stretch (Speed & Grain Size) and Spectral Stretch
const kickDecoded = engine.parseAudioBuffer(fs.readFileSync(kickMonoPath), fs.statSync(kickMonoPath).size, 5.0);
const stretchedGranular = engine.renderEditedAudioSamples(kickDecoded, {
  pitchSt: 0,
  speedPct: 50, // 2x slower time-stretch at 0st pitch
  grainMs: 35,
  spectralPct: 0,
  decayMs: 5000,
  gainDb: 0
});
assert(
  Math.abs(stretchedGranular.durationMs - kickDecoded.durationMs * 2) <= 15,
  `Expected 50% speed granular stretch to double duration (~${kickDecoded.durationMs * 2}ms), got ${stretchedGranular.durationMs}ms`
);
const stretchedSpectral = engine.renderEditedAudioSamples(kickDecoded, {
  pitchSt: 0,
  speedPct: 50,
  grainMs: 45,
  spectralPct: 85, // 85% STFT spectral stretch blend
  decayMs: 5000,
  gainDb: 0
});
let specPeak = 0;
for (let i = 0; i < stretchedSpectral.samples.length; i++) {
  const a = Math.abs(stretchedSpectral.samples[i]);
  if (a > specPeak) specPeak = a;
}
assert(specPeak > 0.05, "Expected non-silent output from STFT spectral stretcher");

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

// Test Dynamic M4L Device Shrinking when Saved, Filters, or Playback sections collapse
// Verify live.thisdevice receives "setwidth <w>" from both pure Max (obj-prep-setwidth) and applyDynamicLayout()
assert(linesFrom("obj-prep-setwidth").includes("obj-thisdevice"), "obj-prep-setwidth ('prepend setwidth') must connect to obj-thisdevice (live.thisdevice) to shrink M4L device in Ableton");
nodeOutletLog.length = 0;
engine.engineState.showSaved = 0;
engine.applyDynamicLayout();
assert(nodeOutletLog.some((m) => m[0] === "setwidth_cmd" && m[1] === 660.0), "applyDynamicLayout must emit setwidth_cmd to shrink live.thisdevice in Ableton");
engine.engineState.showSaved = 1;
const layAllShown = engine.computeDynamicLayout(1, 1, 1);
const layNoSaved = engine.computeDynamicLayout(0, 1, 1);
const layNoFilters = engine.computeDynamicLayout(1, 0, 1);
const layNoPlayback = engine.computeDynamicLayout(1, 1, 0);
const layAllCollapsed = engine.computeDynamicLayout(0, 0, 0);
assert.strictEqual(layAllShown.deviceWidth, 776.0, "Expected 776px width when all sections shown");
assert(layNoSaved.deviceWidth < layAllShown.deviceWidth, "Device width must shrink when Saved list collapses");
assert(layNoFilters.deviceWidth < layAllShown.deviceWidth, "Device width must shrink when Filters section collapses");
assert.strictEqual(layNoFilters.playbackX, 392.0, "Playback panel must slide left into x=392 when Filters section collapses");
assert(layNoPlayback.deviceWidth < layAllShown.deviceWidth, "Device width must shrink when Playback section collapses");
assert.strictEqual(layAllCollapsed.deviceWidth, 276.0, "Expected compact 276px width when all 3 sections collapse");

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

// --- Test B: Scrollable, Selectable, Reorderable & Deletable Saved List (Starts Empty!) ---
assert.strictEqual(getSavedList().length, 0, "Regression: Saved list must always start empty on a new instance");
// Regression check: Double-clicking a sample on the map must NOT add it to savedList!
ondblclick(80, 60, 1, 0, 0, 0, 0, 0);
assert.strictEqual(getSavedList().length, 0, "Regression: Double-clicking on the map must NOT add samples to savedList");

// Test Saved List collapse/show toggle (set_show_saved)
set_show_saved(0);
assert.strictEqual(getShowSavedList(), 0);
assert.strictEqual(getLayout().savedW, 0, "When Saved List is collapsed, savedW must be 0");
assert.strictEqual(getLayout().mapW, 372, "When Saved List is collapsed, 2D map must expand to full 372px width");
paint();
set_show_saved(1);
assert.strictEqual(getShowSavedList(), 1);
assert.strictEqual(getLayout().savedW, 136, "When Saved List is shown, savedW must be 136");
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

// Cleanup temp directory
fs.rmSync(tmpDir, { recursive: true, force: true });

// ============================================================================
// 4. Live Max 9 M4L Presentation-Mode Runtime Test
//    Verifies inside the actual Max 9.1 runtime with openinpresentation = 1:
//    - obj-node (node.codebox) boots in Presentation Mode
//    - Pressing 's' (ASCII 115) through obj-sel-key triggers save_selected in v8ui & node.codebox
//    - Clicking [R] / [E] / [Drag Raw] / [Drag Edit] in v8ui triggers drag_out in node.codebox,
//      creates real OS files, spawns xo_drag_helper_v2_bin, populates macOS NSPasteboard,
//      and shows the native Cocoa NSDraggingSource window!
// ============================================================================

const { spawnSync, execFileSync } = require("child_process");
const MAX_BIN = "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Max/Max.app/Contents/MacOS/Max";

if (fs.existsSync(MAX_BIN)) {
  const harnessDoc = JSON.parse(raw.slice(32).toString("utf8"));
  const hp = harnessDoc.patcher;
  const helperStateFile = path.join(os.tmpdir(), "xo_sample_map_exports", "last_drag_helper_state.json");
  const runtimeResultFile = path.join(os.tmpdir(), "xo_m4l_runtime_test_result.json");
  if (fs.existsSync(helperStateFile)) fs.unlinkSync(helperStateFile);
  if (fs.existsSync(runtimeResultFile)) fs.unlinkSync(runtimeResultFile);

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
      fs.writeFileSync(${JSON.stringify(runtimeResultFile)}, JSON.stringify({
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

  const harnessPath = path.join(os.tmpdir(), "xo_m4l_runtime_harness.maxpat");
  fs.writeFileSync(harnessPath, JSON.stringify(harnessDoc));

  const crashRecDir = path.join(os.homedir(), "Library/Application Support/Cycling '74/Max 9/Crash Recovery");
  const { spawn } = require("child_process");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (fs.existsSync(crashRecDir)) {
        fs.rmSync(crashRecDir, { recursive: true, force: true });
      }
    } catch (_) {}

    // Wait if another Max test harness is currently holding the Max.app process lock
    const lockWait = Date.now();
    while (Date.now() - lockWait < 12000) {
      const ps = spawnSync("/bin/ps", ["aux"], { encoding: "utf8" });
      if (!ps.stdout || !ps.stdout.includes("Max.app/Contents/MacOS/Max ")) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }

    const maxProc = spawn(MAX_BIN, [harnessPath], {
      stdio: "ignore",
      env: { ...process.env, XO_CACHE_DIR: os.tmpdir() }
    });

    const waitStart = Date.now();
    while (Date.now() - waitStart < 9000) {
      if (fs.existsSync(runtimeResultFile) && fs.existsSync(helperStateFile)) {
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }

    try { maxProc.kill("SIGTERM"); } catch (_) {}
    if (fs.existsSync(runtimeResultFile) && fs.existsSync(helperStateFile)) {
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }

  assert(fs.existsSync(runtimeResultFile), "Regression: obj-node (node.codebox) failed to boot or receive v8ui messages in Max 9 Presentation Mode!");
  const rtRes = JSON.parse(fs.readFileSync(runtimeResultFile, "utf8"));
  assert(!rtRes.error, `Max 9 M4L runtime error: ${rtRes.error}`);
  assert.strictEqual(rtRes.bootedInPresentation, true);
  assert(rtRes.savedCountFromHotkey >= 1, `Expected 's' hotkey (115) through obj-sel-key -> v8ui -> node.codebox to save sample, got ${rtRes.savedCountFromHotkey}`);
  assert.strictEqual(rtRes.dragModesSeen.length, 4, "Expected all 4 v8ui drag-out buttons ([R], [E], [Drag Raw], [Drag Edit]) to reach node.codebox");
  for (const dm of rtRes.dragModesSeen) {
    assert(dm.count >= 1 && dm.exists0, `Expected existing OS audio file for drag mode ${dm.mode}, got ${JSON.stringify(dm)}`);
  }

  assert(fs.existsSync(helperStateFile), "Regression: Native Cocoa xo_drag_helper failed to arm NSDraggingSource window in M4L runtime!");
  const helperSt = JSON.parse(fs.readFileSync(helperStateFile, "utf8"));
  assert.strictEqual(helperSt.visible, true, "Expected native Cocoa drag source window to be visible (non-click-through)");
  assert(helperSt.count >= 1, "Expected native Cocoa drag helper to load >= 1 OS file URL onto NSPasteboard");
}

console.log("SUCCESS: All mono/stereo audio routing, M4L runtime 's' hotkey, native Cocoa OS file drag-out, scrollable/reorderable/deletable saved list, and Infinite MaxLen filter tests passed!");
