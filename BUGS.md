# Clip+ bug sweep — pass 1 (bug hunt + red tests only, no fixes)

Worktree: `/tmp/bugsweep/clipplus-2` on branch `bugsweep/clipplus-pass1-2`
(the un-suffixed path/branch `bugsweep/clipplus-pass1` already existed when this pass
started, so the sanctioned `-2` suffix was used; base commit 66fea67).
Scope read: AGENTS.md section 29 only, plus Clip+"s own src (`clipplus_curve.js`,
`clipplus_core.genexpr`, `clipplus_dsp.js`, `clipplus_meters.js`, `clipplus_ui.js`),
`scripts/build_clipplus.py`, and `tests/test_clipplus.js`.

## Bug 1 — True Peak can never be enabled in the shipped device (UI binding / param wiring)

**What:** The true-peak limiter is fully implemented but unreachable. Nothing in
`devices/Clip+.amxd` can ever send the gen its `tpeak` parameter, so the feature is
dead in the device even though AGENTS.md section 29 describes it as device behaviour
("True Peak measures the 4x reconstruction and turns the delayed signal down until
that peak sits on Ceiling") and its 24-sample delay is part of the fixed 1047 latency.

**Evidence:**
- Gen: `Param tpeak(0)` in `src/clipplus_core.genexpr`, and the main loop runs
  `cp_tp_store(ch, tmpIn, tmpOut, tpUp, fir)`, computes `tpHold` / `gTp = cLin / tpHold`
  and applies it to the 24-sample-delayed signal — all gated on `smTp > 0.001`, and
  `smTp` slews toward the `tpeak` Param, which starts and stays 0.
- JS reference (`src/clipplus_curve.js`): `cpDefaultParams()` has `tpeak: 0` and
  `cpChannelStep` implements the same stage; the existing suite tests it only through
  this JS engine (`tpeak: 1` render), never through the device.
- Face (`src/clipplus_ui.js`): `set_tpeak(v)` exists, `cpTp` defaults to 0, and
  `cpResend()` sends `outlet(1, "tpeak", cpTp)` — but nothing in the patcher ever
  calls `set_tpeak` (there is no `obj-ui-tpeak`), so `cpTp` can never become 1.
- Build (`scripts/build_clipplus.py`): every other gen parameter is created as a live
  control plus an `obj-prep-<param>` object (`prepend ingain`, `prepend drive`, …,
  `prepend hlim`, `prepend autog`, …). There is no tpeak entry in the toggles list or
  NUMS, no `obj-ctrl-tpeak`, and no `prepend tpeak` object. The only Peak-labelled
  control is Hard Limit: gen message `hlim`, help text "Brickwall sample clip at the
  ceiling, after the detail crossfade" — that is the hard limiter, not True Peak.
- The existing suite even asserts the removal side: `!boxes.some(b => b.id ===
  "obj-ctrl-tpeak")` ("old True Peak button is removed") — the button went away and
  no replacement path was wired.

**Red test:** `tests/test_clipplus_bugsweep.js` — asserts the feature exists in gen
and face (pass), then asserts the built `.amxd` contains a `prepend tpeak` prep object
fed by a patchline (fails).

**Command / result (current code):**
```
$ node tests/test_clipplus_bugsweep.js
AssertionError [ERR_ASSERTION]: BUG: Clip+.amxd has no obj-prep-tpeak ("prepend tpeak")
  — no control can send the gen its tpeak parameter, so True Peak can never be enabled
  in the shipped device
    at Object.<anonymous> (/private/tmp/bugsweep/clipplus-2/tests/test_clipplus_bugsweep.js:38:12)
exit code 1
```
Fix direction (not done in pass 1): give True Peak a control again in
`scripts/build_clipplus.py` (toggle with gen message `tpeak` + `obj-prep-tpeak` +
`obj-ui-tpeak`), rebuild the device, and the test goes green.

## Checked and cleared (no bug claimed)

Verified by reading plus a numeric probe script run against the transpiled gen
functions and the JS engine (probe kept outside the repo at /tmp/probe_clipplus.js):
- `cp_curve` / `cp_body` / `cp_fir_coef` / `cp_clip_gr` gen-vs-JS twins: exact (existing suite).
- `cp_os_store` vs `cpOsProcess` and `cp_tp_store` vs `cpTpPeak` twins over 200 samples: worst diff 0.
- Emphasis shelf (gen `cp_pre_emp`): gain at fc is exactly -Emphasis/4 dB for Q = 0.1,
  0.707, 2, 10 (measured -3.000 dB at Emphasis 12); asymptotes -12 dB low / +6 dB high
  at Emphasis 12; pre/post pair cancels (existing suite). Low Cut at fc measures
  exactly 20*log10(Q).
- Latency: JS engine impulse peak at sample 1047 in base, oversampled, true-peak and
  Detail-100 modes. Delta at Drive 0 nulls exactly (max 0 after latency).
- Parameter ranges/defaults agree across build NUMS/toggles, gen Params + History
  initials, JS `cpDefaultParams`, and face variable defaults (Drive 0-24/0, Detail
  0-100/100, Shape 0-100/0, Sym -100-100/0, Ceiling -12-0/0, In -24-24/0, Out -24-12/0,
  filt 20-12000/250, Emphasis 0-24/6, Q 0.1-10/0.707, hlim 1, autog 1). All `set_*`
  handlers named by the build exist in the face. Scope slot indices (0-20, wave 32,
  scatter 288, spectrum 320, meter ring 400) match between gen pokes, face poll and
  meter drain. Baseline existing suite: `node tests/test_clipplus.js` → `test_clipplus: ok`
  (`npm run typecheck` could not run here: no local `tsc` binary on this Mac).

## Noted, not claimed (no test written)

- Gen scope `inPk`/`inPkL`/`inPkR` are accumulated from the pre-emphasis signal
  (`ch0In`/`ch1In`) while section 29 and the gen"s own `inSq` comment describe the
  input peak as the same post-shelf signal as the input RMS (`xsL`/`xsR`). Every
  current face display path prefers `drvPk` (post-shelf) and only falls back to
  `inPk` when the driven peak is 0, so user impact is negligible today; recorded
  here in case a future consumer reads those scope slots directly.
- Gen `tpHold` only decays while `smTp > 0.001` (the JS engine decays it every
  sample), so a stale hold could briefly dip the gain if True Peak were toggled
  off and back on. Currently moot because of Bug 1 (tpeak cannot be toggled at all);
  worth re-checking if Bug 1 is fixed by adding a toggle.
