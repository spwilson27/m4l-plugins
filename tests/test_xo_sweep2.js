// XO Sample Map — sweep2 red tests (stage A+B). Every check names the finding in sweep/xo_map.md.
// Run: node tests/test_xo_sweep2.js   (exit 1 while any finding is open)
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log("ok - " + name); }
  catch (e) { failures++; console.log("FAIL - " + name + ": " + e.message); }
}

process.env.XO_CACHE_DIR = fs.mkdtempSync(path.join(require("os").tmpdir(), "xo-sweep2-"));
const engine = require("../src/xo_node_engine.js");

function builtDevice() {
  const b = fs.readFileSync(path.join(__dirname, "..", "devices", "XO Sample Map.amxd"));
  return JSON.parse(b.slice(32).toString("utf8").replace(/\0+$/, "")).patcher;
}
function builtStripScript() {
  const box = builtDevice().boxes.map((x) => x.box).find((x) => x.id === "obj-minimap");
  return box.textfile.text;
}

function loadStrip() {
  const stripJs = builtStripScript(); // the device's real v8ui script (palette, layout and search code prepended by the build)
  const out = [];
  const mgraphics = {
    init() {}, redraw() {}, size: [608, 169],
    setfont() {}, setrgba() {}, setcolor() {}, move_to() {}, line_to() {},
    stroke() {}, fill() {}, rectangle() {}, select_font_face() {}, set_font_size() {},
    get_font_extents() { return { ascent: 8, descent: 2, height: 10 }; },
    text_width() { return 10; }
  };
  const ctx = vm.createContext({
    mgraphics, inlets: 1, outlets: 2,
    outlet: (i, ...a) => out.push([i, ...a]),
    notifyclients() {}, post() {},
    Task: function () { this.schedule = function () {}; this.cancel = function () {}; this.freepeer = function () {}; },
    LiveAPI: function () {}, Global: function () { return {}; },
    Dict: function () {},
    setinletassist() {}, setoutletassist() {},
    Math, Number, String, Date, JSON, Object, Array, Map, Set, console
  });
  vm.runInContext(stripJs, ctx, { filename: "xo_strip_ui.js" });
  if (ctx.loadbang) ctx.loadbang();
  ctx.__out = out;
  return ctx;
}

// ---------------------------------------------------------------------------
// XO-S2-01: a Saved row keeps only a map INDEX, and recalling it selects `samples[index]`. A Re-Seed / Map Samples change /
// folder change replaces engineState.samples, so the row then recalls (and auditions) a DIFFERENT sample than the one saved.
// ---------------------------------------------------------------------------
check("XO-S2-01 recalling a Saved row after a Re-Seed selects the saved sample", () => {
  const st = engine.engineState;
  const mk = (i) => ({
    name: "Kick" + i, path: "/nonexistent/xo/kick" + i + ".wav", rootFolder: "/nonexistent/xo", durationMs: 300 + i,
    centroid: 0.3 + 0.01 * (i % 50), flatness: 0.4, druminess: 70, category: "kick",
    vector: [i / 300, (i * 7 % 300) / 300, 0.3, 0.2, 0.3, 0.1, 0.2, 0.3, 0.4, 0.5, 0.2, 0.5], peaks: [], neighbors: []
  });
  const corpus = [];
  for (let i = 0; i < 300; i++) corpus.push(mk(i));
  const saved = { corpusSamples: st.corpusSamples, samples: st.samples, savedList: st.savedList, maxDisplaySamples: st.maxDisplaySamples, knownFolders: st.knownFolders, selectedIndex: st.selectedIndex };
  try {
    st.knownFolders = [];
    st.corpusSamples = corpus;
    st.maxDisplaySamples = 100;
    st.savedList = [];
    engine.rebuildActiveMapSubset(1, false);
    const want = st.samples[5];
    engine.saveSampleToList(5, null);
    assert.strictEqual(st.savedList.length, 1, "setup: one saved row");
    engine.reseedMapSubset(false);
    assert.notStrictEqual(st.samples[5].path, want.path, "setup: the re-seeded map must put another sample at index 5");
    engine.recallSavedSample(0, false);
    const got = st.samples[st.selectedIndex];
    assert.strictEqual(got && got.path, want.path, "recall selected " + (got && got.name) + " instead of the saved " + want.name);
  } finally {
    Object.assign(st, saved);
  }
});

// ---------------------------------------------------------------------------
// XO-S2-02: the XOStateData blob stores a saved row as (index, cat, pitch, decay, gain) only. Reverse / Speed / Grain / Mode are lost
// when the Set is saved and reopened (getvalueof -> setvalueof), so the row's Edited drag and recall differ from what was saved.
// ---------------------------------------------------------------------------
check("XO-S2-02 Saved row Reverse / Speed / Grain / Mode survive getvalueof -> setvalueof", () => {
  const a = loadStrip();
  a.minimap_clear();
  const flat = [];
  for (let i = 0; i < 4; i++) flat.push(0.1 * i, 0.2, 16, 300, 50, 60, 50, "S" + i);
  a.minimap_batch(0, ...flat);
  a.saved_list_sync(1, 7, 2, "S2", 0, 3, 800, -2, 1, 50, 120, 2);
  const blob = a.getvalueof();
  const b = loadStrip();
  b.minimap_clear();
  b.minimap_batch(0, ...flat);
  b.setvalueof(blob);
  const items = vm.runInContext("savedList", b);
  assert.strictEqual(items.length, 1, "setup: one saved row restored");
  const it = items[0];
  assert.strictEqual(!!it.reverse, true, "reverse lost");
  assert.strictEqual(it.speedPct, 50, "speedPct " + it.speedPct + " (saved 50)");
  assert.strictEqual(it.grainMs, 120, "grainMs " + it.grainMs + " (saved 120)");
  assert.strictEqual(it.stretchMode, 2, "stretchMode " + it.stretchMode + " (saved 2)");
});

// ---------------------------------------------------------------------------
// XO-S2-03: extractAudioFeatures reads `samples[onsetIdx + n]` for n < specWin = min(1024, max(64, activeLen)) without checking the
// array length. A decoded window shorter than 64 samples, or an onset within specWin of the end, reads undefined -> NaN spectrum ->
// centroid / flatness / band ratios / vector NaN (stored as null in the cache, NaN in kNN and the 2D map).
// ---------------------------------------------------------------------------
check("XO-S2-03 extractAudioFeatures returns finite features for very short / late-onset files", () => {
  const bad = [];
  const cases = [];
  for (const n of [32, 40, 63]) cases.push(["sine" + n, Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.3) * 0.8)]);
  cases.push(["late-onset 2000", Float32Array.from({ length: 2000 }, (_, i) => (i >= 1990 ? 0.9 : 0))]);
  cases.push(["late-onset 100", Float32Array.from({ length: 100 }, (_, i) => (i >= 90 ? 0.9 * (i % 2 ? 1 : -1) : 0))]);
  for (const [tag, samples] of cases) {
    const f = engine.extractAudioFeatures({ sampleRate: 44100, durationMs: samples.length / 44.1, samples });
    if (!f) continue;
    const nums = Object.entries(f).filter(([, v]) => typeof v === "number" && !isFinite(v)).map(([k]) => k);
    if ((f.vector || []).some((v) => !isFinite(v))) nums.push("vector");
    if (nums.length) bad.push(tag + ": " + nums.join(","));
  }
  assert.strictEqual(bad.length, 0, "non-finite features: " + bad.join(" | "));
});

// ---------------------------------------------------------------------------
// XO-S2-04: `scripts/vm_xo.sh max` fails ("obj-node produced no result in 3 launches"). The harness patch sends key 115 ('s'), but the
// `key` hotkeys are gated on hotkeyAllowed() (this device must be the selected device, from the LOM; standalone Max has none), so
// the hotkey saves nothing, the Saved list stays empty and only the 2 batch drags (not the 2 row drags) reach the node: the node
// waits for 4 drag_out messages and never writes its result. The harness must force the selection (`test_selected 1`).
// ---------------------------------------------------------------------------
check("XO-S2-04 Max runtime harness selects the instance before sending the 's' hotkey", () => {
  const hp = path.join(__dirname, "out", "xo_runtime", "xo_m4l_runtime_harness.maxpat");
  { // always regenerate: a stale tests/out harness from an older build hides the fix
    const r = require("child_process").spawnSync(process.execPath, [path.join(__dirname, "test_xo_map.js")], { env: Object.assign({}, process.env, { XO_RUN_MAX_RUNTIME: "1" }), encoding: "utf8" });
    assert.strictEqual(r.status, 0, "could not generate the harness patch");
  }
  const doc = JSON.parse(fs.readFileSync(hp, "utf8"));
  const sends = doc.patcher.boxes.map((b) => b.box).filter((b) => b.maxclass === "message" && /^test_selected\b/.test(String(b.text || "")));
  assert(sends.length > 0, "runtime harness never sends test_selected, so hotkeyAllowed() is false and the 's' hotkey is ignored");
});

// ---------------------------------------------------------------------------
// helpers for the render tests
// ---------------------------------------------------------------------------
function writeWav16(file, sr, chans, frames, fn) {
  const n = frames * chans;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(chans, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * chans * 2, 28);
  b.writeUInt16LE(chans * 2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < chans; c++) b.writeInt16LE(Math.round(fn(i, c) * 32767), 44 + (i * chans + c) * 2);
  fs.writeFileSync(file, b);
}
function peakOf(file) {
  const d = engine.parseWavBuffer(fs.readFileSync(file), fs.statSync(file).size, 5.0, true);
  let pk = 0;
  for (const v of d.samples) pk = Math.max(pk, Math.abs(v));
  return pk;
}

// ---------------------------------------------------------------------------
// XO-S2-05: the offline render (Edited export, and every audition with Pitch / Speed / Reverse / Texture) decodes ONE channel
// (parseAudioBuffer(..., peakChannels false) = channel 0) and writes it to both outputs. A stereo sample loses its image, and
// a sample whose content is only on the right channel renders as silence.
// ---------------------------------------------------------------------------
check("XO-S2-05 edited render keeps right-channel-only content", () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "xo-s205-"));
  const f = path.join(dir, "rightonly.wav");
  writeWav16(f, 44100, 2, 22050, (i, c) => (c === 1 ? 0.7 * Math.sin(2 * Math.PI * 220 * i / 44100) : 0));
  const out = engine.renderEditedSampleWav(f, { pitchSt: 0, decayMs: 20000, gainDb: 0, reverse: 1, speedPct: 100, grainMs: 45, stretchMode: 1 }, path.join(dir, "out"));
  assert(out && fs.existsSync(out), "setup: render produced a file");
  const pk = peakOf(out);
  assert(pk > 0.1, "the right-only sample renders with peak " + pk.toFixed(4) + " (silence)");
});

// ---------------------------------------------------------------------------
// XO-S2-06: rendered file names are built from the source BASENAME + settings only. Two different samples with the same file name
// (Kick.wav in two folders) rendered with the same settings write the SAME path, so the second render overwrites the first one while
// the first one's cache entry / Saved row still points at it: the [E] drag of the first sample delivers the second sample's audio.
// ---------------------------------------------------------------------------
check("XO-S2-06 same-named samples from two folders render to different edited files", () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "xo-s206-"));
  fs.mkdirSync(path.join(dir, "a")); fs.mkdirSync(path.join(dir, "b"));
  const fa = path.join(dir, "a", "Kick.wav"), fb = path.join(dir, "b", "Kick.wav");
  writeWav16(fa, 44100, 1, 8000, (i) => 0.8 * Math.sin(2 * Math.PI * 100 * i / 44100));
  writeWav16(fb, 44100, 1, 8000, (i) => 0.8 * Math.sin(2 * Math.PI * 900 * i / 44100));
  const settings = { pitchSt: 0, decayMs: 2500, gainDb: 0, reverse: 0, speedPct: 100, grainMs: 45, stretchMode: 1 };
  const outDir = path.join(dir, "out");
  const pa = engine.renderEditedSampleWav(fa, settings, outDir);
  const pb = engine.renderEditedSampleWav(fb, settings, outDir);
  assert.notStrictEqual(pa, pb, "both samples render to " + pa + " (the second overwrites the first)");
});

// ---------------------------------------------------------------------------
// XO-S2-07: scanDirectories with >= 4 sub-folders only collects files INSIDE the sub-folders; audio files lying directly in the
// added folder are never indexed (the per-sub-folder budget branch skips the root level).
// ---------------------------------------------------------------------------
check("XO-S2-07 scan of a folder with 4+ sub-folders also indexes the files in the folder itself", () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "xo-s207-"));
  const tone = (i) => 0.6 * Math.sin(2 * Math.PI * 300 * i / 44100) * Math.exp(-i / 4000);
  writeWav16(path.join(dir, "loose_root.wav"), 44100, 1, 6000, tone);
  for (const d of ["a", "b", "c", "d"]) { fs.mkdirSync(path.join(dir, d)); writeWav16(path.join(dir, d, d + "_x.wav"), 44100, 1, 6000, tone); }
  const r = engine.scanDirectories([dir], 1000, 1, 1500);
  const names = r.corpusSamples.map((x) => x.name).sort();
  assert(names.includes("loose_root"), "indexed " + JSON.stringify(names) + " - the loose file in the root folder is missing");
});

console.log(failures ? failures + " FAILED" : "all passed");
process.exit(failures ? 1 : 0);
