# Mega Modulator bug sweep — pass 1 (hunt + red tests, no fixes)

Worktree: `/tmp/bugsweep/megamod` on branch `bugsweep/megamod`
Baseline: `69699f7` (pre-bugsweep)
Tests: `tests/test_megamod_bugsweep.js` — run with `node tests/test_megamod_bugsweep.js`
Result: **2 bugs found.** 5 checks passed, 4 failed — every failure is one of the bugs below, failing for the stated reason. Nothing in `src/` was changed in this pass (fixes are pass 3).

Note: this file replaces a pre-existing BUGS.md at the worktree root that documented a different device (Clip+, pass 3); it was not part of this sweep.

## Bug 1 — `sanitizeMod` resurrects a disabled modulator whose saved `enabled` flag is boolean `false`

- **Where:** `src/megamod_config.js:949` (`sanitizeMod`)
- **What's wrong:** `base.enabled = m.enabled === 0 ? 0 : 1;` — only the number `0` counts as disabled, so a saved state carrying JSON `false` for `enabled` is sanitized back to `1` (enabled). The sibling sanitizer in the same file disagrees: `sanitizeMapping` at `src/megamod_config.js:911` computes `m.enabled === 0 || m.enabled === false ? 0 : 1`. The device itself writes `0`/`1`, but hand-written or externally generated preset states can carry `false`, and `normalizeState` runs every saved state through `sanitizeMod`, so such a state loses the off flag on load.
- **User-visible effect:** A modulator that was off in the saved state comes back ON after the state is loaded/reloaded, audibly modulating again even though it was saved disabled — while a mapping with the same `false` flag in the same state stays disabled.
- **Catching tests:** `BUG1: sanitizeMod treats enabled false as disabled` and `BUG1: normalizeState keeps a boolean-false modulator disabled` in `tests/test_megamod_bugsweep.js` (with sanity checks that `sanitizeMapping` treats `false` as `0`, and that `sanitizeMod` keeps `0` at `0` and `1` at `1`).
- **Observed failure output:**
  ```
  FAIL: BUG1: sanitizeMod treats enabled false as disabled (got 1, want 0)
  FAIL: BUG1: normalizeState keeps a boolean-false modulator disabled (got 1, want 0)
  ```

## Bug 2 — Mouse wheel over a strip knob turns it backwards

- **Where:** `src/megamod_ui.js:1148` (strip-knob branch of `onwheel`)
- **What's wrong:** The knob branch computes `ubKnobNorm(spec, mod.p[spec.key]) + (dy > 0 ? 1 : -1) * 0.03`, the opposite sign to the wheel convention used by every other control in the same file — the convention pinned by `tests/test_megamod_ui.js`, where `dy = -1` (wheel up) RAISES the value (Options rate dial steps up, the Smooth bar rises, the Depth pill grows) and the mapping list scrolls forward. Over a strip knob, wheel up lowers the value and wheel down raises it.
- **User-visible effect:** Scrolling up on any strip knob (e.g. an LFO's Depth) turns it DOWN, while scrolling up over the Options dials, Smooth bar or Depth pill turns them UP — the same gesture does opposite things depending on which control is under the pointer.
- **Catching tests:** `BUG2: wheel up over a strip knob raises its value, like every other control` and `BUG2: wheel down over a strip knob lowers its value` in `tests/test_megamod_bugsweep.js` (vm harness from `tests/test_megamod_ui.js`; one LFO, Depth set to 0.5, real `onwheel` calls at the Depth knob's centre).
- **Observed failure output:**
  ```
  FAIL: BUG2: wheel up over a strip knob raises its value, like every other control (got 0.47)
  FAIL: BUG2: wheel down over a strip knob lowers its value (got 0.5)
  ```
  (Wheel up moved Depth 0.5 → 0.47; the following wheel down moved it back UP to 0.5 — both backwards.)

## Full test run (pre-fix code)

```
$ node tests/test_megamod_bugsweep.js
FAIL: BUG1: sanitizeMod treats enabled false as disabled (got 1, want 0)
FAIL: BUG1: normalizeState keeps a boolean-false modulator disabled (got 1, want 0)
FAIL: BUG2: wheel up over a strip knob raises its value, like every other control (got 0.47)
FAIL: BUG2: wheel down over a strip knob lowers its value (got 0.5)
bugsweep: 5 passed, 4 failed
EXIT=1
```

## Checked and not promoted

- JS reference implementations in `src/megamod_config.js` vs `src/megamod_engine.genexpr` (hash01/LFO shapes/glide, sync beats, ADSR detector/stages, follower, Random hash cache, Steps/MSEG one-shot + loop, XY/Buttons slew): no divergence found.
- UI knob specs vs `MOD_PARAM_RANGE` / `AUTO_LOG` for every modulator type, and the ADSR time conversions in `src/megamod_ui_newmods.js`: verified as mutual inverses / in range.
- `SYNC_BEATS` ordering (dotted values before triplets) and the `depthFactorTable` / `mappingTable` last-sample pin at u=1: documented and intentional.
- MSEG `loopEnd` fix `min(1, loopStart + 0.05)`: `loopStart` caps at 0.95, so the +0.05 gap is always exactly satisfiable — borderline but not a bug.
- Remote negative-polarity limits from `remoteLimitsFromV4` (min > max): an intentionally inverted window; `mappingOutput` handles lo/hi as given.
- A stale genexpr header comment citing switch descriptors at 414 (the code uses 490, matching config's `INT_SW_AT`): text only, no functional effect.
