// Scatter — host tests for src/scatter_config.js (draw math, mapping, onset).
// The gen core (src/scatter_core.genexpr) must mirror this reference exactly;
// the VM audio suite checks the device end to end.
"use strict";
const assert = require("assert");
const cfg = require("../src/scatter_config.js");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log("ok - " + name); }
  catch (e) { failures++; console.log("FAIL - " + name + ": " + e.message); }
}

check("contract constants", () => {
  assert.strictEqual(cfg.SCATTER_LATENCY, 5120);
  assert.strictEqual(cfg.SCATTER_FFT, 1024);
  assert.strictEqual(cfg.SCATTER_HOP, 256);
});

check("macro defaults match the locked contract", () => {
  const want = { snap: [50, 25], body: [50, 25], metal: [30, 25], motion: [35, 25], space: [30, 20], grit: [20, 15], warp: [25, 20], ring: [40, 20] };
  assert.deepStrictEqual(cfg.SCATTER_MACRO_KEYS, ["snap", "body", "metal", "motion", "space", "grit", "warp", "ring"]);
  for (const k of cfg.SCATTER_MACRO_KEYS) {
    assert.strictEqual(cfg.SCATTER_MACRO_DEFS[k].centre, want[k][0], k + " centre");
    assert.strictEqual(cfg.SCATTER_MACRO_DEFS[k].depth, want[k][1], k + " depth");
  }
  assert.strictEqual(cfg.SCATTER_UNDERLYING.length, 21);
});

check("draw is deterministic in (seed, hit)", () => {
  const a = cfg.scatterDraw(7, 3, null, null, 0.5);
  const b = cfg.scatterDraw(7, 3, null, null, 0.5);
  assert.deepStrictEqual(a, b);
  const c = cfg.scatterDraw(7, 4, null, null, 0.5);
  assert.notDeepStrictEqual(c.params, a.params);
  const d = cfg.scatterDraw(8, 3, null, null, 0.5);
  assert.notDeepStrictEqual(d.params, a.params);
});

check("depth 0 holds centres and mapped params", () => {
  const centres = { snap: 10, body: 90, metal: 0, motion: 100, space: 55, grit: 33, warp: 77, ring: 100 };
  const depths = { snap: 0, body: 0, metal: 0, motion: 0, space: 0, grit: 0, warp: 0, ring: 0 };
  const out = cfg.scatterDraw(42, 9, centres, depths, 1);
  assert.deepStrictEqual(out.macros, centres);
  assert.deepStrictEqual(out.params, cfg.scatterMap(centres));
});

check("master 0 holds centres regardless of depth", () => {
  const out = cfg.scatterDraw(42, 9, null, null, 0);
  const centres = {};
  for (const k of cfg.SCATTER_MACRO_KEYS) centres[k] = cfg.SCATTER_MACRO_DEFS[k].centre;
  assert.deepStrictEqual(out.macros, centres);
  assert.deepStrictEqual(out.params, cfg.scatterMap(centres));
});

check("ring decay always within 0.05..2.0 s", () => {
  for (let seed = 0; seed < 50; seed++) {
    for (let hit = 0; hit < 20; hit++) {
      const out = cfg.scatterDraw(seed * 37.5, hit, { ring: 100 }, { ring: 100 }, 1);
      assert.ok(out.ringDecayS >= 0.05 && out.ringDecayS <= 2.0, "seed " + seed + " hit " + hit + " -> " + out.ringDecayS);
    }
  }
  const lo = cfg.scatterDraw(1, 1, { ring: 0 }, { ring: 0 }, 1);
  assert.strictEqual(lo.ringDecayS, 0.05);
  const hi = cfg.scatterDraw(1, 1, { ring: 100 }, { ring: 0 }, 1);
  assert.strictEqual(hi.ringDecayS, 2.0);
});

check("every underlying param stays in [lo, hi]", () => {
  for (let seed = 0; seed < 30; seed++) {
    for (let hit = 0; hit < 10; hit++) {
      const out = cfg.scatterDraw(seed * 91.25, hit, null, null, 1);
      for (const p of cfg.SCATTER_UNDERLYING) {
        const v = out.params[p.key];
        assert.ok(v >= p.lo && v <= p.hi, p.key + " = " + v + " outside " + p.lo + ".." + p.hi);
      }
    }
  }
});

check("scatterMap endpoints", () => {
  const at0 = cfg.scatterMap({ snap: 0, body: 0, metal: 0, motion: 0, space: 0, grit: 0, warp: 0, ring: 0 });
  assert.strictEqual(at0.ringDecayS, 0.05);
  assert.strictEqual(at0.snapDrive, 1);
  const at100 = cfg.scatterMap({ snap: 100, body: 100, metal: 100, motion: 100, space: 100, grit: 100, warp: 100, ring: 100 });
  assert.strictEqual(at100.ringDecayS, 2.0);
  assert.strictEqual(at100.snapDrive, 4);
});

check("onset: holdoff, sens scaling", () => {
  const sr = 48000;
  assert.strictEqual(cfg.scatterOnset(1, 0.1, 1, 100, sr), 0);
  assert.strictEqual(cfg.scatterOnset(1, 0.1, 1, 4800, sr), 1);
  assert.strictEqual(cfg.scatterOnset(0.2, 0.1, 0, 4800, sr), 0);
  assert.strictEqual(cfg.scatterOnset(0.5, 0.1, 0, 4800, sr), 1);
  assert.strictEqual(cfg.scatterOnset(0, 0, 1, 4800, sr), 0);
});

if (failures) { console.log(failures + " scatter test(s) FAILED"); process.exit(1); }
console.log("All Scatter tests passed");
