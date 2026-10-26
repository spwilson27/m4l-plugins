// XO Sample Map — bugsweep pass 1 red tests (Pass 1: tests only, no src fixes).
// Each check names the bug it files in BUGS.md; dropped leads (pitchFilter,
// grainMs=0) are recorded there as checked-no-bug and intentionally have no test.
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

// ---------------------------------------------------------------------------
// Bug: engine acoustic similarity tour cache ignores the drum filter.
// buildAcousticSimilarityTour (src/xo_node_engine.js) keys its cache on
// vis.length/activeCategory/maxLenMs/toneFilter/pitchFilter/tonalFilter/
// searchQuery/sampleSeed/searchVer/folders — but NOT drumFilter, even though
// isSamplePassingFilters applies drumFilter, and the set_filter_drum handler
// never clears acousticSimTourKey. A drum change that preserves the visible
// count serves the stale tour through step_similar.
// ---------------------------------------------------------------------------
const engine = require("../src/xo_node_engine.js");

check("engine acoustic tour rebuilds when the drum filter changes", () => {
  const st = engine.engineState;
  const saved = {
    samples: st.samples, anchorIndex: st.anchorIndex, selectedIndex: st.selectedIndex,
    drumFilter: st.drumFilter, tonalFilter: st.tonalFilter, toneFilter: st.toneFilter,
    activeCategory: st.activeCategory, maxLenMs: st.maxLenMs, searchQuery: st.searchQuery,
    knownFolders: st.knownFolders
  };
  try {
    const mk = (name, druminess, x) => ({
      name, path: "/tmp/" + name + ".wav", rootFolder: "", durationMs: 300,
      centroid: 0.5, flatness: 0.5, druminess, category: "kick",
      vector: [x, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    });
    st.samples = [mk("A", 100, 0), mk("B", 100, 0.01), mk("C", 0, 0.5), mk("D", 0, 0.51)];
    st.knownFolders = [];
    st.activeCategory = "ALL";
    st.maxLenMs = 5000; // infinite
    st.toneFilter = 0;
    st.tonalFilter = 0;
    st.searchQuery = "";
    st.selectedIndex = 0;
    st.anchorIndex = 0;
    st.drumFilter = 90; // only A and B pass
    const first = engine.stepSimilarSample(1);
    assert.strictEqual(first, 1, "setup: first step should land on B");
    assert(engine.isSamplePassingFilters(st.samples[first]), "setup: B passes at drumFilter +90");
    st.drumFilter = -90; // only C and D pass; visible count is still 2
    const second = engine.stepSimilarSample(1);
    assert(second >= 0, "a passing sample exists to step to");
    assert(
      engine.isSamplePassingFilters(st.samples[second]),
      "stepped to sample " + second + " (druminess " + st.samples[second].druminess +
      ") which drumFilter -90 hides — stale acoustic tour"
    );
  } finally {
    Object.assign(st, saved);
  }
});

// ---------------------------------------------------------------------------
// Bug: strip local similarity tour cache ignores the tonal and drum filters.
// buildLocalSimilarityTour (src/xo_strip_ui.js) keys simTourCache on
// startIdx/vis.length/activeCategory/maxLenMs/toneFilter/searchQuery/localSeed
// — but NOT tonalFilter or drumFilter, even though isPointVisible applies
// both (the neighbouring group-cache key at the paint layer includes them),
// and strip_filter_tonal/strip_filter_drum never clear simTourKey.
// ---------------------------------------------------------------------------
function loadStrip() {
  const stripJs = fs.readFileSync(path.join(__dirname, "..", "src", "xo_strip_ui.js"), "utf8");
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "xo_search.js"), "utf8"), ctx, { filename: "xo_search.js" });
  vm.runInContext(stripJs, ctx, { filename: "xo_strip_ui.js" });
  if (ctx.loadbang) ctx.loadbang();
  return ctx;
}

function stripTourScenario(filterFn, field) {
  const ctx = loadStrip();
  // Points: anchor (50, passes +/-40 and is the first visible point in both
  // states), a 100 neighbour (visible only at +40), a 0 neighbour (visible
  // only at -40), and a far 50 point — the visible count is 3 in both states.
  const specs = [
    [0.10, 0.10, 50, "P0"],
    [0.11, 0.10, 100, "P1"],
    [0.12, 0.10, 10, "P2"],
    [0.60, 0.60, 50, "P3"]
  ];
  const flat = [];
  for (const [x, y, v, name] of specs) {
    const druminess = field === "drum" ? v : 65;
    const tonalPct = field === "tonal" ? v : 50;
    flat.push(x, y, 16, 300, 50, druminess, tonalPct, name);
  }
  ctx.minimap_clear();
  ctx.minimap_batch(0, ...flat);
  ctx[filterFn](40);
  ctx.stepLocalNeighbor(1);
  assert.strictEqual(ctx.getSelectedIndex(), 1, "setup: first step should land on P1");
  ctx[filterFn](-40);
  ctx.stepLocalNeighbor(1);
  return ctx.getSelectedIndex();
}

check("strip local tour rebuilds when the drum filter changes", () => {
  const sel = stripTourScenario("strip_filter_drum", "drum");
  assert.strictEqual(sel, 2,
    "stepped to point " + sel + " after the drum filter flipped to -40; P1 is hidden there — stale local tour (want P2)");
});

check("strip local tour rebuilds when the tonal filter changes", () => {
  const sel = stripTourScenario("strip_filter_tonal", "tonal");
  assert.strictEqual(sel, 2,
    "stepped to point " + sel + " after the tonal filter flipped to -40; P1 is hidden there — stale local tour (want P2)");
});

// ---------------------------------------------------------------------------
// Bug: pitchSt is not clamped in stretchAudioEx (src/xo_stretch.js).
// Every other numeric option is clamped there (speed 0.1..4, grainMs 5..250,
// amount 0..1), and renderEditedAudioSamples (src/xo_node_engine.js) clamps
// decayMs/speedPct/grainMs but not pitchSt. The Pitch parameter range is
// -24..+24; beyond it, complex mode sizes its intermediate by
// lenIn * 2^(pitchSt/12) / speed, so an out-of-range stored pitch (the strip
// and engine state parsers never clamp it) becomes a huge allocation.
// ---------------------------------------------------------------------------
const X = require("../src/xo_stretch.js");

check("stretchAudioEx clamps pitchSt to the +/-24 range", () => {
  const SR = 44100;
  const n = 2048;
  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = Math.sin(2 * Math.PI * 220 * i / SR) * 0.5;
  for (const mode of ["granular", "complex"]) {
    for (const extreme of [96, -96]) {
      const clamped = extreme > 0 ? 24 : -24;
      const a = X.stretchAudio([src], SR, { mode, speed: 1, pitchSt: extreme });
      const b = X.stretchAudio([src], SR, { mode, speed: 1, pitchSt: clamped });
      assert.strictEqual(a[0].length, b[0].length, mode + ": output length differs");
      let maxDiff = 0;
      for (let i = 0; i < a[0].length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[0][i] - b[0][i]));
      assert(maxDiff < 1e-6,
        mode + ": pitchSt " + extreme + " should render exactly as the " + clamped + " clamp (max diff " + maxDiff + ")");
    }
  }
});

// ---------------------------------------------------------------------------
// Bug (i1 pass 1): minimap_batch parses druminess / tonalPct / brightness
// with || defaults (src/xo_strip_ui.js), so a value of exactly 0 sent by the
// engine becomes the mid default: druminess 0 -> 65, tonalPct 0 -> 50,
// brightness 0 -> 50. The engine sends real zeros (syncMiniMapToMax in
// src/xo_node_engine.js): drumPct = round(computeSampleDruminessPct) is 0
// for tonal samples and tonalPct = round((1 - flatness) * 100) is 0 for
// noise-like samples. The strip then disagrees with the engine about
// visibility, because isPointVisible filters on the invented values.
// ---------------------------------------------------------------------------
check("minimap batch preserves zero druminess tonal and brightness", () => {
  const ctx = loadStrip();
  ctx.minimap_clear();
  ctx.minimap_batch(0, 0.5, 0.5, 16, 300, 0, 0, 0, "Zero");
  const p = ctx.getPoints()[0];
  assert.strictEqual(p.druminess, 0, "druminess 0 became " + p.druminess);
  assert.strictEqual(p.tonalPct, 0, "tonalPct 0 became " + p.tonalPct);
  assert.strictEqual(p.brightness, 0, "brightness 0 became " + p.brightness);
});

// Bug (i1 pass 1): same || default pattern for durationMs in minimap_batch:
// a 0 ms duration (an empty file; the engine sends round(durationMs))
// becomes 200 in the strip, so the maxLen filter verdict differs per side.
check("minimap batch preserves zero durationMs", () => {
  const ctx = loadStrip();
  ctx.minimap_clear();
  ctx.minimap_batch(0, 0.5, 0.5, 16, 0, 40, 40, 40, "ZeroDur");
  const p = ctx.getPoints()[0];
  assert.strictEqual(p.durationMs, 0, "durationMs 0 became " + p.durationMs);
});

// ---------------------------------------------------------------------------
// Bug (i1 pass 1): ensureValidSelection (src/xo_strip_ui.js) moves the
// selection to the first visible point when a filter hides it, but when the
// filter hides EVERY point it falls through with selectedIndex (and
// anchorIndex) still pointing at a hidden point and nothing announced. The
// rest of the strip treats -1 as no selection (ensureSelectedInView and
// the map draw guards), so the all-hidden case should clear it to -1.
// ---------------------------------------------------------------------------
check("selection clears when a filter hides every point", () => {
  const ctx = loadStrip();
  ctx.minimap_clear();
  const flat = [];
  const names = ["P0", "P1", "P2"];
  for (let i = 0; i < 3; i++) flat.push(0.10 + i * 0.01, 0.10, 16, 300, 50, 50, 50, names[i]);
  ctx.minimap_batch(0, ...flat);
  assert.strictEqual(ctx.getSelectedIndex(), 0, "setup: first point selected");
  ctx.strip_filter_drum(90);
  assert.strictEqual(ctx.getSelectedIndex(), -1,
    "selection stayed on hidden point " + ctx.getSelectedIndex() + " after drum filter +90 hid all points (druminess 50)");
});

console.log(failures ? failures + " failing" : "all passed");
process.exit(failures ? 1 : 0);
