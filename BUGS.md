# Sand bug sweep — pass 1 (hunt + red tests, NO fixes)
# Loud Split — Pass 1 bugsweep

One credible bug found. Red tests: `tests/test_loudsplit_bugsweep.js` (run: `node tests/test_loudsplit_bugsweep.js`).
No `src/` files were changed.

## 1. Knee help text promises "0 = hard switch", but Knee 0 can never be set

- **Where:** `scripts/build_loudsplit.py:59` (`hiknee` help) and `scripts/build_loudsplit.py:60` (`loknee` help):
  - `"Higher Knee: width in dB of the crossfade between Mid and Loud around the Higher Threshold (0 = hard switch). ..."`
  - `"Lower Knee: width in dB of the crossfade between Quiet and Mid around the Lower Threshold (0 = hard switch)."`
- **What is wrong:** the Knee range is 1..24 dB in every place that defines it, so the value the help
  text describes does not exist on the device:
  - `src/loudsplit_config.js` — `LS_PARAMS.hiknee / loknee`: `[..., LS_MIN_KNEE (1.0), LS_MAX_KNEE (24.0), 6.0, ...]`, and `lsMasks` clips knees to `LS_MIN_KNEE..LS_MAX_KNEE`.
  - `scripts/build_loudsplit.py` — the `NUM` table itself gives `"hiknee": (..., 1.0, 24.0, 6.0, ...)` and `"loknee": (..., 1.0, 24.0, 6.0, ...)`.
  - `src/loudsplit_core.genexpr` — the ctl hook clips the gen parameters: `khH = clip(kneehi, 1, 24); klH = clip(kneelo, 1, 24);`
  - The hard-step branch does exist in the maths — `lsBandMasks` in `src/loudsplit_config.js` (and `ls_masks` in the core) use a hard step when `knee <= 0.01` — but no parameter value can reach it. At the minimum settable knee (1 dB) the band edge is still a smoothstep crossfade (50 / 50 at the threshold centre, verified in the test anchor).
- **User-visible effect:** in Live, the parameter help for Higher / Lower Knee tells the user to set
  Knee to 0 for a hard band edge; the control clamps at 1 dB, so a hard
  switch is impossible to dial in and the help sends the user after a value that does not exist.
  (The range 1..24 is the documented design in AGENTS.md section 24, so the stale part is most
  likely the help text left over from the pre-redesign knee range of 0..30 — Pass 3 can either fix
  the help or widen the range; the test accepts either.)
- **Test:** `tests/test_loudsplit_bugsweep.js` — "knee help text agrees with the knee range"
  (consistency assertion per knee key: the help must not claim `0 = hard switch` while the
  `LS_PARAMS` range excludes 0), plus a crossfade anchor documenting the shipped behaviour at the
  minimum knee.
- **Observed failure** (`node tests/test_loudsplit_bugsweep.js`, exit 1):

  ```
  AssertionError [ERR_ASSERTION]: hiknee: help text says "0 = hard switch" but the Knee range is 1..24 dB, so 0 can never be set
      at Object.<anonymous> (/private/tmp/bugsweep/loudsplit/tests/test_loudsplit_bugsweep.js:35:12)
  ```

## Checked and found clean (no bug filed)

- DSP mirror: `ls_masks` (core) vs `lsMasks` / `lsBandMasks` (config) — thresholds, crossed-threshold
  clamp (`lo = min(tlo, thi)`), knee smoothstep, Rise/Fall coefficients (`1 - exp(-1/blocks)`, clamped
  0.13..125), Tilt table (rebuilt on n / sample-rate change), Relative mode (loudest bin over
  1..N/2-1), telemetry slots 517 / 530 / 531 / 532 and effective thresholds.
- Shared DSP: `ss_mid` / `ss_mida` algebra (incl. DC / Nyquist bins), `ss_cols` bin edges,
  `ss_apply` symmetry, rack template `kShare` (dry share keyed on selection AND role, 1/3 in a rack),
  `sAge` resets on wake / restart, hook order (ctl, frame, tele).
- Face: threshold / knee / value drags, solo-dot press and release, double-click resets, Relative
  toggle, Post / Sono buttons — all probed in Node through `tests/paint_bounds_lib.js` `loadFace`
  with a recording outlet; drag maths, clamps and emitted edits are correct. `lsDotYs` / `lsLabelYs`
  separation at extremes is covered by the existing paint-bounds suite (10,823 paints, green).
- Link / DSP loading: `spectral_link.js` election, versioning, group reset and `displayScope`;
  `spectral_dsp.js` claim / confirm / retry flow; `spectral_theme.js` clipping helpers.
- Build / preset: `build_loudsplit.py` NUM / ENUM / GEN_MSG / LINKED tables match the config;
  scope buffer 544 floats; `.adg` chains Loud / Mid / Quiet with colours 21 / 1 / 55 as specified.
- Baseline: `node tests/test_loudsplit.js` passes in full at the pre-bugsweep baseline
  (ref / genexpr / lint / device / bitwig / rack / dsp / paint bounds).
# Clip+ bug sweep — pass 3 (fix)

Worktree: `/tmp/bugsweep/sand` on branch `bugsweep/sand`, pre-bugsweep baseline.
Files read in full: `src/sand_core.genexpr` (306 lines), `src/sand_ui.js` (765),
`scripts/build_sand.py` (852), `tests/test_sand.js`, `scripts/run_sand_audio_tests.py`,
AGENTS.md §6. Behavioural probes were run against the real `sand_ui.js` with the
existing suite mocking style (mock mgraphics / Buffer / Task, outlet capture).
Tests: `tests/test_sand_bugsweep.js` (new). Existing suite still green: `test_sand: ok`.

**Found: 4 bugs.**

## Bug 1 — `set_outmode` clamps to 0..3, but only output modes 0..2 exist

- **Where:** `src/sand_ui.js:185` — `curOutMode = clamp(Math.round(Number(v) || 0), 0, 3);`
- **What is wrong:** Every other definition of the mode agrees on three values: the UI comment (`sand_ui.js:35`, 0=Off, 1=Hard, 2=Limit), the build script enum (`scripts/build_sand.py`, `obj-out` = [Off, Hard, Limit], `parameter_mmax = len(enum)-1 = 2`), the gen (`sand_core.genexpr:282`, `clip(outmode, 0, 2)`), Sand own sibling setters (`set_ftype`/`set_fpos` clamp 0..2) and the identical setter in `src/reciprocator_ui.js:107` (clamps 0..2). Only this setter admits a fourth state.
- **User-visible effect:** A `set_outmode` value of 3 (or anything above 2, clamped to 3) is stored in the face state and re-sent verbatim to the gen on every deferred-DSP confirm/settle resend (`sandDspResend`, `sand_ui.js:638` sends `["outmode", curOutMode]`). The face then claims a mode that does not exist; the gen silently clips it to Limit, so face state and actual DSP mode disagree, and any future code trusting `curOutMode <= 2` inherits the lie.
- **Test:** `set_outmode clamps to the three real output modes (0..2)` — calls `set_outmode(99)`, captures the resend, asserts `outmode == 2`.
- **Observed failure:** `[bugsweep] FAIL set_outmode clamps to the three real output modes (0..2) — outmode resend must clamp to Limit (2)... 3 !== 2` (probe: `set_outmode(99)` resends `outmode = 3`).

## Bug 2 — Scope transfer curve (`compandEval`) does not model the gen compander

- **Where:** `src/sand_ui.js:272-288` (`compandEval`) vs `src/sand_core.genexpr:42-57` (`compand`).
- **What is wrong:** The inset is presented as the live multi-stage compander transfer curve, but none of its constants come from the DSP it draws. Gen: envelope-dependent gain `g = 1 + (maxG - 1) * knee / (knee + en)` with `maxG = exp(amt01 * 16.118)` (10^7 at Amount 140), hard path clipped at ±1.2, `shaped = mix(hard, tanh(y), soft)`, `mild = tanh(x * mix(8, 1.5, soft))`. UI: a fixed linear `drive = 1 + amt01 * 18` (max 19x at any Amount), hard clip at 1.0, `tanh(y * (0.85 - 0.35 * soft))`, and `mild = tanh(v * (2.4 - 1.1 * soft))`. No value of the UI parameters reproduces the gen curve.
- **User-visible effect:** The curve and its live operating-point dot misinform the user about the device core behaviour, worst exactly where the device matters: a quiet input (0.01) at Amount 140 is lifted to ≈1.13 by the gen (steady state) but the curve draws 0.17, suggesting almost no lift; at Soft 0 the gen hard path reaches 1.2 while the curve caps at 1.0.
- **Test:** `transfer curve (compandEval) matches the gen compand steady state` — compares `compandEval` against the gen formula at its settled envelope for four (input, Amount, Soft, Stages) cases, tolerance 0.05.
- **Observed failure:** `[bugsweep] FAIL transfer curve (compandEval) matches the gen compand steady state — x=0.01 amount=140 soft=35 stages=1: gen compand gives 1.130 but the scope transfer curve draws 0.172`. (Full probe: 0.2/18 dB → gen 0.796 vs UI 0.588; 0.5/60 dB/Soft 0 → 1.200 vs 1.000; 0.1/80 dB/2 stages → 1.100 vs 1.000.)

## Bug 3 — Scope ring read starts on the newest frame (off by one rotation)

- **Where:** `src/sand_ui.js:205,212` (`pullWave`) vs `src/sand_core.genexpr:295-305`.
- **What is wrong:** The gen hop block pokes the output frame at `wpos`, then pokes that same `wpos` value into telemetry frame 259, and only then increments `wpos`. So frame 259 holds the **last written** index, and the oldest frame in the 128-frame ring is `(value + 1) & 127`. `pullWave` instead treats the value as the first (oldest) index: `idx = (wpos + n) & 127`. The first sample drawn is the newest frame, followed immediately by a jump back 127 frames, then the rest in order.
- **User-visible effect:** Every scope trace (out L/R, dry ghost, wet grit — all four reads use the same `idx`) has a one-frame seam at its left edge: a spurious vertical step connecting the newest sample to the oldest, drawn on every 33 ms poll. The waveform is otherwise shifted one frame.
- **Test:** `scope ring starts at the oldest frame, not the last written one` — mocked Buffer with frame i = i/1000 and frame 259 = 5 (last written), asserts the first drawn frames are 6, 7.
- **Observed failure:** `[bugsweep] FAIL scope ring starts at the oldest frame... first drawn frames should be the oldest (6, 7, ...); got 5, 6, 7 — the trace starts on the newest frame and then jumps back 127 frames`.

## Bug 4 — Derivative stages that go inactive keep stale History (click on Order automation)

- **Where:** `src/sand_core.genexpr:108-152` (`channel()`).
- **What is wrong:** Each stage touches its `pN` (previous input) / `qN` (startup guard) History **only** inside `if (ord > N - 0.5)`. The guard `qN` suppresses the sample-0 impulse only once, ever. If Order is lowered (e.g. 15 → 1) and later raised again — Order is an automatable, parameter-enabled control — stages 2..15 have been frozen for the entire interval; on reactivation each one differentiates the current input against a sample from before the drop, unguarded. The wrong first samples cascade (stage N+1 differences stage N spike against its own stale `p`), are clipped at ±8 per stage, and are then companded like any other signal.
- **User-visible effect:** A one-sample click/spike in the wet path every time Order is raised again after being lowered, at any audio content — unrelated to the current signal.
- **Test:** `inactive derivative stages refresh or re-guard their history` — structural (this suite established style): for stages 2..15 the stage block must contain an inactive path that refreshes `pN` or re-arms `qN`. Currently no stage has an `else` at all.
- **Observed failure:** `[bugsweep] FAIL inactive derivative stages refresh or re-guard their history — stage 2 has no else path refreshing p2/q2 while ord <= 1; its History goes stale` (same for stages 3..15 — the aggregator reports the first).
- **Related, noted for pass 2:** `filt()` (pre/mid/post call sites) and the c2..c4 `compand()` call sites use the same execute-only-when-active pattern. Their frozen state is a smoothed envelope/filter state rather than a raw sample, so the reactivation transient is bounded and decays — not claimed here, but a fix pattern chosen for Bug 4 should be checked against them.

## Test run (pass 1, all red as intended)

```
$ node tests/test_sand_bugsweep.js
[bugsweep] FAIL set_outmode clamps to the three real output modes (0..2) — ... 3 !== 2
[bugsweep] FAIL transfer curve (compandEval) matches the gen compand steady state — x=0.01 amount=140 soft=35 stages=1: gen compand gives 1.130 but the scope transfer curve draws 0.172
[bugsweep] FAIL scope ring starts at the oldest frame, not the last written one — first drawn frames should be the oldest (6, 7, ...); got 5, 6, 7
[bugsweep] FAIL inactive derivative stages refresh or re-guard their history — stage 2 has no else path refreshing p2/q2 while ord <= 1; its History goes stale
test_sand_bugsweep: 4 failing   (exit 1)
$ node tests/test_sand.js
test_sand: ok
```

## Checked and cleared (no bug claimed)

- All `prepend` gen messages in `build_sand.py` match gen Param names (`dorder, stages, ftype, fpos, outmode, amount, ffreq, soft, debrick, mix` via DIAL_SPECS) and all `prepend set_*` UI messages match the `sand_ui.js` setters; patchlines for every control reach both the hub data inlet and the viz (existing suite + read-through).
- Control ranges/initials agree across build script, gen Param defaults and UI defaults: Order -1..15 init 1, Stages 1..4 init 1, Amount 0..140 init 18, Freq 20..18000 init 14000 (exponent 2), Soft 35, Debrick 0, Mix 50, Filt LP/BP/HP init 0, Place Pre/Diff/Post init 2, Out init 0.
- Gen maths spot-checked against AGENTS.md §6/comments: differentiator peaks at unity at Nyquist (nrm 0.5, clip ±8); `maxG = exp(amt01 * 16.118)` = 10^(Amount/20) (10^7 at 140 dB); equal-power mix cos/sin over Mix 0..100; limiter ceiling 0.89 ≈ -1 dB with always-running history; integrator leak coefficient `exp(-2pi*8/sr)` with DC gain 125 (saturates by design via clip ±8).
- Buffer map agreement: gen writes out ring 0..127, dry/wet ring 128..255, telemetry 256..259 on channel 0; `pullWave` peeks the correct channels/frames for L, R, dry and grit (only the starting index is wrong — Bug 3). `buffer~ #0-sandwave 100 2` comfortably holds 260 frames.
- Drag/reticle mapping: `ondrag` exactly inverts the painted reticles for both Amount and Freq (also covered by the existing suite reticle test, including 0 dB/20 Hz and 140 dB/18 kHz corners).
- `sandDspResend` sends all 10 gen Params plus the `wave` binding from face state whose defaults match the gen — no save/load or preset loss found; the deferred-DSP claim/confirm/retry flow (`sand_dspq` Global, claim expiry, counter via frame 259) matches the AGENTS.md §1d pattern used by sibling devices.
- L/R isolation: `channel()`, `filt()`, `compand()`, `integ()`, `limit()` Histories are per call site and L/R are separate call sites; the only shared Global is the deliberate compile queue.
- `obj-route-viz` declares `numinlets: 3` although `route` has one inlet — identical declaration in sibling builds (e.g. EnvTrig); Max rebuilds the object from its text. House pattern, not Sand.

## Noted, not claimed

**Touchpoints:**
- `scripts/build_clipplus.py:353` — `truepeak` toggle (`gen_msg=tpeak`, `ui_msg=set_tpeak`, y=132)
- `scripts/build_clipplus.py:354` — `meters` y moved 144 → 150
- `scripts/build_clipplus.py:357-363` / `:479-487` — existing loop builds prep/ui boxes and wires ctrl→prep→gen + ctrl→ui→viz (no new wiring code)
- `devices/Clip+.amxd` — rebuilt binary with reachable `prepend tpeak`
- Face already had `set_tpeak` / `cpResend` (`src/clipplus_ui.js:48`, `:238`, `:345`); unused until this control existed

**Host gate (green):**
```
npm run -s typecheck && python3 scripts/build_clipplus.py && node tests/test_clipplus.js && node tests/test_clipplus_bugsweep.js
→ Built devices/Clip+.amxd [406x169 px]
→ test_clipplus: ok
→ [bugsweep] true peak is reachable from a device control
→ test_clipplus_bugsweep: ok
```

Red test left intact (not weakened). Pass-2 tip `0915084` remains the parent; this pass-3 commit is the fix.

## Checked and cleared (no bug claimed) — pass 2 confirms; pass 3 did not reopen

Verified by pass 1 (reading plus numeric probe); pass 2 did not reopen these; pass 3 left them alone:
- `cp_curve` / `cp_body` / `cp_fir_coef` / `cp_clip_gr` gen-vs-JS twins: exact (existing suite).
- `cp_os_store` vs `cpOsProcess` and `cp_tp_store` vs `cpTpPeak` twins over 200 samples: worst diff 0.
- Emphasis shelf (gen `cp_pre_emp`): gain at fc is exactly -Emphasis/4 dB for Q = 0.1,
  0.707, 2, 10 (measured -3.000 dB at Emphasis 12); asymptotes -12 dB low / +6 dB high
  at Emphasis 12; pre/post pair cancels (existing suite). Low Cut at fc measures
  exactly 20*log10(Q).
- Latency: JS engine impulse peak at sample 1047 in base, oversampled, true-peak and
  Detail-100 modes. Delta at Drive 0 nulls exactly (max 0 after latency).
- Parameter ranges/defaults agree across build NUMS/toggles, gen Params + History
  initials, JS `cpDefaultParams`, and face variable defaults. All `set_*`
  handlers named by the build exist in the face. Scope slot indices match.
  Baseline: `node tests/test_clipplus.js` → `test_clipplus: ok`.

## Noted, not claimed (no test written) — pass 3 leaves as notes

- Gen scope `inPk`/`inPkL`/`inPkR` are accumulated from the pre-emphasis signal
  (`ch0In`/`ch1In`) while section 29 and the gen's own `inSq` comment describe the
  input peak as the same post-shelf signal as the input RMS (`xsL`/`xsR`). Every
  current face display path prefers `drvPk` (post-shelf) and only falls back to
  `inPk` when the driven peak is 0, so user impact is negligible today; recorded
  here in case a future consumer reads those scope slots directly.
- Gen `tpHold` only decays while `smTp > 0.001` (the JS engine decays it every
  sample), so a stale hold could briefly dip the gain if True Peak is toggled
  off and back on. Pass 3 made the toggle reachable; still not promoted to a bug
  (no red written) — worth a Live listen / optional follow-up if audible.

---

# Clip+ bug sweep — pass 4 (final review)

Worktree: `/private/tmp/bugsweep/clipplus-2` on branch `bugsweep/clipplus-pass1-2`
Pass-3 tip: `89725e0` — restore True Peak Options control
Pass-4 tip: (this commit) — APPROVED; no production code changes

## Pass 4 outcome

| Claim | Verdict | Notes |
|-------|---------|-------|
| Bug 1 — True Peak unreachable | **APPROVED** | Minimal Options toggle under key `truepeak` (not banned `tpeak` ids); generic loop wires `prepend tpeak` / `set_tpeak`; meters y 144→150 only layout side-effect; red assertions intact. |
| Checked-and-cleared items | Confirm | Untouched; host suite still green. |
| Noted (`inPk` vs post-shelf; `tpHold` decay while off) | Leave noted | Still not promoted; `tpHold` note remains valid now that the toggle exists. |

**Approved 1 / adjusted 0.**

## Review notes

- Production change is only `scripts/build_clipplus.py` (+3/−1): one `truepeak` Options row (`gen_msg=tpeak`, `ui_msg=set_tpeak`, y=132) and meters y 144→150. `devices/Clip+.amxd` is the rebuild artifact. No hand-edit of the binary (AGENTS.md).
- Deliberately avoids reviving banned `obj-ctrl-tpeak` / `obj-ui-tpeak`; red test still forbids those ids and green asserts a fed `prepend tpeak` exists — test not weakened.
- Reuses the existing generic toggle loop for prep/ui boxes and wiring; no bespoke patcher code; no drive-by refactors.
- Host gate re-run green in this pass (no Max/Live — host-side only per job rules):
# Delay+ — Bug Sweep Pass 1

Red tests only; no fixes in this pass (fixes are Pass 3). Tests live in
`tests/test_delayplus_bugsweep.js`; run with `node tests/test_delayplus_bugsweep.js`.
Baseline at sweep start: commit `69699f7` on `bugsweep/delayplus`, existing suite
`tests/test_delayplus.js` green (39 passed, 0 failed — still green after this pass).

## Bug 1: Spectrogram tilt steps down ~4.3 dB at 60 Hz and dips the whole 60–250 Hz band

- **Where:** `src/delayplus_spectrum.js:70`, in `dpFftDbBins`:
  `var tilt = f > 60 ? 2.2 * Math.log(f / 250) / Math.LN2 : 0;`
- **What's wrong:** the tilt is pivoted at 250 Hz (`f / 250`) but only switched on above
  60 Hz. `2.2 * log2(60 / 250)` is about −4.53 dB, not 0, so at the 60 Hz threshold the
  tilt jumps discontinuously from 0 dB to ≈ −4.5 dB (at 48 kHz the first bin above the
  threshold, 64.5 Hz, reads −4.30 dB). Above the threshold the value climbs back to 0 dB
  only at 250 Hz, so instead of a continuous tilt the low band gets a notch: everything
  between 60 and 250 Hz is displayed lower than it should be, deepest right at the bottom
  edge. This contradicts the function's own doc comment ("gentle pink tilt so upper
  harmonics stay readable") — a pink-style tilt anchored at 250 Hz should be 0 dB at its
  pivot and rise smoothly above it, never step or dip.
- **User-visible effect:** in the Filter Display spectrogram, any signal with low-end
  energy shows a fixed ≈4.3–4.5 dB cliff/notch around 60–65 Hz regardless of the actual
  audio — content just above 60 Hz looks ~4.5 dB quieter than identical content just
  below it, and the whole 60–250 Hz region reads low.
- **Catching tests** (`tests/test_delayplus_bugsweep.js`): both feed `dpFftDbBins` a
  perfectly flat spectrum (centre impulse under the Hann window), so every inter-bin
  difference is the tilt's doing:
  - `spectrum tilt: no step at 60 Hz (flat spectrum, neighbouring bins within 1 dB)`
  - `spectrum tilt: 60..250 Hz band is not dipped below the low band`
- **Observed failure output** (48 kHz and 44.1 kHz checked; first failure reported):
  ```
  FAIL spectrum tilt: no step at 60 Hz (flat spectrum, neighbouring bins within 1 dB): sr 48000: worst neighbouring-bin step 4.30 dB at bin 11 (64.5 Hz)
  FAIL spectrum tilt: 60..250 Hz band is not dipped below the low band: sr 48000: band dips -4.30 dB below the low band at bin 11 (64.5 Hz)

  0 passed, 2 failed
  ```

## Bug 1 — Pass 2 review verdict: KEPT

- **Verdict:** keep — no test changes, no `src/` changes in this pass; the bug stands as filed for the Pass 3 fix.
- **One-line evidence:** independently re-derived and re-run — `dpFftDbBins` steps 4.30 dB at bin 11 (64.5 Hz, 48 kHz) on a flat spectrum, nothing downstream compensates, and the Multiband Split original this was copied from explicitly holds the tilt at its 60 Hz value to avoid exactly this step.
- **Formula / bins re-derived:** `src/delayplus_spectrum.js` has `tilt = f > 60 ? 2.2 * Math.log(f / 250) / Math.LN2 : 0`; at 48 kHz the 8192-point FFT gives 5.859 Hz/bin, so bin 10 (58.6 Hz) gets tilt 0 while bin 11 (64.5 Hz) gets `2.2 * log2(64.5 / 250)` = −4.30 dB, and the tilt stays negative until the 250 Hz pivot (bin 42, 246 Hz: −0.05 dB).
- **Tests re-run (Pass 2):** `node tests/test_delayplus_bugsweep.js` → 0 passed, 2 failed, both failures exactly as filed (`worst neighbouring-bin step 4.30 dB at bin 11 (64.5 Hz)`, `band dips -4.30 dB below the low band at bin 11`); `node tests/test_delayplus.js` → 39 passed, 0 failed.
- **No downstream compensation:** the only caller is `src/delayplus_filter.js` (`fdLayerFrame`, plus the `preview()` path). `dpFftPixelDb` only interpolates (Catmull-Rom) or takes the loudest bin; the per-column smoothing in `fdLayerFrame` is temporal (attack/release against the previous frame) and converges to the stepped raw value; `preview()` adds the filter curve `fdMag` on top of the already-tilted dry spectrum — no per-frequency calibration, no matching step in the filter/reference curve.
- **Not intentional:** the function doc calls it a gentle pink tilt so upper harmonics stay readable (a tilt, not a notch), and the source it was copied from, `src/mbsplit_config.js` (`computeFft8192DbBins` tilt table), clamps `fTilt = freq < 60 ? 60 : freq` with the comment: Hold the tilt at the 60 Hz value so the slope does not step several dB between adjacent bins. The Delay+ copy dropped that hold and substituted 0 below 60 Hz, creating the step and the 60–250 Hz dip relative to the un-tilted low band.
- **Assertions checked for over-breadth:** none found. The 1 dB neighbouring-bin allowance is >3× the true per-bin tilt slope near 64 Hz (≈0.29 dB/bin), and the −0.5 dB dip allowance is loose; every reasonable fix (restore the 60 Hz hold, re-pivot the tilt at 60 Hz, or clamp the tilt at 0 dB) passes both tests.

## Bug 1 — Pass 3 fix: FIXED

- **Fix:** `src/delayplus_spectrum.js`, in `dpFftDbBins`: restored the Multiband Split original's 60 Hz hold. The tilt line `var tilt = f > 60 ? 2.2 * Math.log(f / 250) / Math.LN2 : 0;` is now `var fTilt = f < 60 ? 60 : f; var tilt = k > 0 ? 2.2 * Math.log(fTilt / 250) / Math.LN2 : 0;`, with the original's comment: 'Hold the tilt at the 60 Hz value so the slope does not step several dB between adjacent bins.' (mirrors `src/mbsplit_config.js`, `computeFft8192DbBins`). Bins below 60 Hz now share the constant 60 Hz tilt value (≈ −4.53 dB) instead of jumping from 0 dB, so there is no step at ~64.5 Hz and no dip in the 60–250 Hz band relative to the low band; the tilt at and above 60 Hz is unchanged. No tests were changed — the Pass 1 tests are the spec.
- **Green evidence (Pass 3):** `node tests/test_delayplus_bugsweep.js` → 2 passed, 0 failed (was 0 passed, 2 failed). `node tests/test_delayplus.js` → 39 passed, 0 failed, before and after the rebuild. Full Delay+ gate from AGENTS.md passed: `npm run -s typecheck` (all configs; required a one-time `npm install` in this worktree for `tsc`), `python3 scripts/build_delayplus.py` (rebuilt `devices/Delay+.amxd` 790116 bytes, `devices/Delay+ End.amxd` 79896 bytes, plus `devices/Delay+.adg` and `delayplus_test.als`, all committed with the source change), and `python3 scripts/render_preview.py` for both variants (`previews/delay.png`, `previews/delay_end.png`), both visually inspected — no truncation, overlap, or alignment defects (no UI/layout files changed).

## Bug 1 — Pass 4 review: APPROVED

- **Pass 4 review: APPROVED** — Diff of 493634e re-checked independently: minimal src/delayplus_spectrum.js hold restoration semantically identical to src/mbsplit_config.js (fTilt hold, incl. the k > 0 bin-0 guard), no test files or unrelated changes among the 6 committed files, the minified devices/Delay+.amxd embeds the hold (P = y < 60 ? 60 : y, tilt gated on S > 0), the BUGS.md Pass 3 record matches the commit, and both suites re-run green: bugsweep 2 passed / 0 failed, test_delayplus.js 39 passed / 0 failed.

## Checked and cleared

- PARAM_SPECS ranges and defaults against AGENTS.md section 7 and the gen clips and Param defaults: all match.
- Mirror against gen for the gate cubic, reciprocal targetScale, safeEnv floors, the 1000x gain cap, and the soft/hard/limiter ceiling formulas: match (aside from Bug 4 gateMix divergence — now aligned in pass 3).
- Build wiring: percent scaling, prepend chains, drag routing, scope buffer 32 / SCOPE_FLOATS 32, GEN_DSP embedding, panels last with background 1: consistent.
- Known rough edge Soft Clip real tanh: covered by pre-existing nested-return test and audiorate audio case.
- UI setters, scope slot indices, HUD gain text, deferred DSP re-bang list: consistent.

# Ableton MCP Bridge — Pass 1 bug sweep (red tests only, no fixes)

- Worktree: /tmp/bugsweep/mcp-bridge
- Branch: bugsweep/mcp-bridge-pass1 (base HEAD 66fea67)
- Scope read in full: AGENTS.md section 13 (Architecture of devices/Ableton MCP Bridge.amxd), src/ableton_mcp_node.js (297 lines), src/ableton_mcp_lom.js (799 lines), scripts/ableton_mcp_server.js (621 lines), scripts/build_ableton_mcp.py, tests/test_ableton_mcp.js.
- Baseline on unmodified HEAD: node tests/test_ableton_mcp.js -> PASS (exit 0).
- No production code was changed. No Live, Max, or MCP session was started on this machine; every test below is plain Node.

## BUG-MCP-1: delete_device with no target calls delete_device(-1) on live_set instead of erroring

- Where: src/ableton_mcp_lom.js, handleDeleteDevice (lines 422-445), with makeApi (line 79). The MCP tool schema in scripts/ableton_mcp_server.js (lines 214-235) declares no required fields for ableton_delete_device, so an empty-arguments call is valid at the MCP layer and reaches this handler.
- Evidence: with neither path nor parentPath/deviceIndex, parentPath stays empty and deviceIndex stays -1. makeApi on an empty target silently substitutes live_set, and the handler unconditionally runs parentApi.call("delete_device", -1) and returns deleted: true.
- Expected: a validation error (ok: false) and no delete_device call at all.
- Actual (red run): reply was {"ok":true,"result":{"deleted":true,"parent_path":"","device_index":-1,"result":"ok"}}.
- Red test: tests/test_ableton_mcp.js block 3, BUG-MCP-1 (vm sandbox with mock LiveAPI, same style as the existing LOM tests).

## BUG-MCP-2: set_device_parameter without a numeric value writes NaN to the parameter

- Where: src/ableton_mcp_lom.js, handleSetDeviceParameter (lines 380-420); the clamp is line 408: Math.max(targetParam.min, Math.min(targetParam.max, Number(p.value))).
- Evidence: the handler validates path but never validates value. With value missing or non-numeric, Number(p.value) is NaN, the clamp returns NaN, and paramApi.set("value", NaN) is executed. The HTTP /rpc surface in src/ableton_mcp_node.js performs no argument validation either, so the LOM executor is the last line of defense.
- Expected: a validation error (ok: false) and no set call.
- Actual (red run): reply was ok: true for a call with paramIndex 1 and no value; the captured set call received NaN (the reply re-read shows the old mock value because the mock get is static).
- Red test: tests/test_ableton_mcp.js block 3, BUG-MCP-2.

## BUG-MCP-3: transport with an unknown action reports success while doing nothing

- Where: src/ableton_mcp_lom.js, handleTransport (lines 447-466).
- Evidence: the action string is matched against play/stop/continue/undo/redo and every other value falls through silently; the handler then returns handleGetSessionInfo() as a successful result. A typo or bogus action sent over /rpc (where no tool schema enum applies) is indistinguishable from a real transport command.
- Expected: ok: false for an unrecognized action (a tempo-only call with no action remains legitimate).
- Actual (red run): action bogus_action returned ok: true with full session info.
- Red test: tests/test_ableton_mcp.js block 3, BUG-MCP-3.

## BUG-MCP-4: POST /rpc with a valid-JSON null body crashes the Node bridge

- Where: src/ableton_mcp_node.js, /rpc handler (lines 170-191), dereference at line 182: String(body.action || "ping") and line 183 body.params.
- Evidence: JSON.parse succeeds for the body null (and for other non-object JSON values), but the handler assumes an object. A null body throws TypeError: Cannot read properties of null (reading action) inside the async end handler; the unhandled rejection terminates the Node process, so the HTTP client gets no response at all and the bridge is down until Max restarts the codebox.
- Expected: an HTTP error response with ok: false (for example 400), and the bridge stays alive and healthy.
- Actual (red run): no HTTP response; child process stderr showed the TypeError at src/ableton_mcp_node.js:182 and the process exited.
- Red test: tests/test_ableton_mcp_stdio_http.js, BUG-MCP-4 (spawns the real bridge on test port 19931 via the global.__MAX_API_MOCK__ fallback; no Live needed).

## BUG-MCP-5: stdio MCP server silently swallows invalid JSON instead of returning a -32700 parse error

- Where: scripts/ableton_mcp_server.js, stdin loop (lines 556-569): both the Content-Length branch and the newline branch wrap JSON.parse plus handleJsonRpcMessage in try { } catch (_) { }.
- Evidence: a malformed line is consumed and dropped with no response. JSON-RPC 2.0 requires a parse error response with code -32700 and id null; without it, a client that sent a damaged frame waits forever for a reply that never comes.
- Expected: one JSON-RPC error message {"jsonrpc":"2.0","id":null,"error":{"code":-32700,...}} and the server keeps serving later valid messages.
- Actual (red run): after the invalid line, the only response seen was the later valid ping reply {"jsonrpc":"2.0","id":99,"result":{}}; no parse error was emitted.
- Red test: tests/test_ableton_mcp_stdio_http.js, BUG-MCP-5 (spawns the real stdio server as a child process).

## Red run summary (2026-10-24, this worktree)

- node tests/test_ableton_mcp.js -> exit 1. Pre-existing blocks 1-2 pass; new block 3 reports exactly 3 failures: BUG-MCP-1, BUG-MCP-2, BUG-MCP-3 (each: expected ok:false, got ok:true).
- node tests/test_ableton_mcp_stdio_http.js -> exit 1. Exactly 2 failures: BUG-MCP-4 (no HTTP response, TypeError crash at ableton_mcp_node.js:182) and BUG-MCP-5 (no -32700 response).
- No other failures. Nothing in src/ or scripts/ was modified.

## Pass 2 review (2026-10-25)

- Re-read production handlers: `handleDeleteDevice` / `handleSetDeviceParameter` / `handleTransport` in `src/ableton_mcp_lom.js`, POST `/rpc` in `src/ableton_mcp_node.js`, stdin loop in `scripts/ableton_mcp_server.js`.
- Re-ran host tests on unfixed code in this worktree:
  - `node tests/test_ableton_mcp.js` -> exit 1 (BUG-MCP-1, BUG-MCP-2, BUG-MCP-3; each expected ok:false, got ok:true).
  - `node tests/test_ableton_mcp_stdio_http.js` -> exit 1 (BUG-MCP-4 TypeError crash on null `/rpc` body; BUG-MCP-5 no -32700 after invalid JSON).
- Decision: **kept 5 / dropped 0**.
  - BUG-MCP-1: real — empty target becomes `delete_device(-1)` on `live_set` via `makeApi` fallback; unvalidated destructive op.
  - BUG-MCP-2: real — missing `value` → `Number(undefined)=NaN` through clamp into `paramApi.set`.
  - BUG-MCP-3: real — unknown transport action falls through and returns session info as success.
  - BUG-MCP-4: real — `JSON.parse('null')` then `body.action` TypeError downs the bridge.
  - BUG-MCP-5: real — `catch (_) {}` swallows parse errors; clients hang waiting for -32700.
- No test rewrites: reds already fail on the claimed symptoms. No production/src fixes (pass 3).

## Pass 3 fixes (2026-10-25)

- Host gate green: `npm run -s typecheck && node tests/test_ableton_mcp.js` pass; `node tests/test_ableton_mcp_stdio_http.js` also passes. All 5 kept reds are now green.
- BUG-MCP-1: `src/ableton_mcp_lom.js` `handleDeleteDevice` - added a guard `if (!parentPath || deviceIndex < 0) throw` before `parentApi.call(delete_device, ...)`, so an empty target returns ok:false and makes no delete call.
- BUG-MCP-2: `src/ableton_mcp_lom.js` `handleSetDeviceParameter` - reject a missing or non-numeric value (`typeof p.value !== "number" || !isFinite(p.value)`) before the clamp and `paramApi.set`, so NaN is never written.
- BUG-MCP-3: `src/ableton_mcp_lom.js` `handleTransport` - added `else if (act) throw Unknown transport action`; a tempo-only call with no action still succeeds.
- BUG-MCP-4: `src/ableton_mcp_node.js` POST `/rpc` - guard `body === null || typeof body !== "object" || Array.isArray(body)` returns 400 ok:false before dereferencing `body.action`, so the bridge stays alive; narrowed body via a reqBody cast to keep typecheck clean.
- BUG-MCP-5: `scripts/ableton_mcp_server.js` stdin loop - both the Content-Length and newline branches now emit a jsonrpc 2.0 id:null error with code -32700 (Parse error) on bad JSON and keep serving later valid messages.
- No red tests were weakened or deleted. Next step: commit on branch bugsweep/mcp-bridge-pass1 (no merge to main, worktree preserved).

## Pass 4 review (final) — APPROVED

Host gate re-run green on this worktree:
`npm run -s typecheck && node tests/test_ableton_mcp.js && node tests/test_ableton_mcp_stdio_http.js` all pass.

Reviewed git diff main...HEAD (src + scripts, not just tests). Each pass-3 fix is minimal, correct, and matches the AGENTS.md argument-validation / JSON-RPC error patterns; no tests were weakened and there are no drive-by refactors.

- BUG-MCP-1 delete_device with no target: APPROVED — errors instead of calling delete_device(-1) on live_set.
- BUG-MCP-2 missing numeric param -> NaN: APPROVED — value validated before use.
- BUG-MCP-3 unknown transport action reported success: APPROVED — now returns an error.
- BUG-MCP-4 POST /rpc with JSON null body: APPROVED — returns ok:false and the bridge stays alive/healthy.
- BUG-MCP-5 stdio invalid JSON: APPROVED — emits a -32700 parse error (id null) and the server survives.

Not merged to main; worktree retained for the coordinator's serial merge.

# EQ+ — Bug Sweep Pass 1 (bugs + red tests only, no fixes)

Worktree: `/tmp/bugsweep/eqplus` · Branch: `bugsweep/eqplus-pass1` · Base: `66fea67`
Scope: `devices/EQ+.amxd` — `src/eqplus_config.js`, `src/eqplus_core.genexpr`,
`src/eqplus_ui.js`, `scripts/build_eqplus.py`, `tests/test_eqplus.js`,
`scripts/run_eqplus_audio_tests.py` (case list skimmed; Max/Live not run in this pass).

## Bug 1 — Automating Tilt EQ leaves the phase kernel stale (Linear Phase ignores the tilt entirely)

**Severity:** audible wrong behaviour in Linear Phase; stale correction in Natural Phase.

### Mechanism

- `tilt_eq` is an automatable Live parameter (-24..+24 dB/decade) bound to the face
  inlet `set_tilt_eq` (`scripts/build_eqplus.py`, control spec `obj-ctrl-tilt-eq`).
- `set_tilt_eq` (`src/eqplus_ui.js`) only calls `emitTilt()` and redraws. It never calls
  `updateCoeffBuffer()` / `updatePhaseKernel()`. Every other design input does:
  `set_shift`, `set_adaptiveq`, all `set_band_*`, `set_route`, `sr()`, `applyStateArray`.
- The tilt is a *design input* of the phase kernel: `eqpDesignPhase(bands, sr, shiftSt,
  adaptiveQ, tiltEqDb)` (`src/eqplus_config.js`) folds the tilt cascade into the Linear
  IR magnitude (`magD`) and into the Natural correction ratio.
- In the gen (`src/eqplus_core.genexpr`), the Linear path convolves the **dry** input
  (`latRingL/R` fed from `dom0/dom1`) with that designed IR (`hre/him`, `hreB/himB`).
  The gen’s own tilt cascade feeds only the Zero-Latency output (`audL/audR`) and the
  Natural FIR input (`nfirL/nfirR` via `eqL/eqR`) — it never reaches the Linear output
  (`olaL/olaR`). So in Linear Phase an automated Tilt EQ change changes **nothing**
  audible until some unrelated edit happens to call `updateCoeffBuffer()`.
  In Natural Phase the biquad+tilt part updates live via `emitTilt`, but the 128-tap
  correction FIR is left designed for the old tilt (the tilt only approximately cancels
  in the analog/digital ratio because of the -12..-36 dB blend and the ±12 dB cap in
  `eqpDesignPhase`).
- Face drags mask the bug: the `tilteq` gesture ends in `finishGesture()`, which calls
  `updateCoeffBuffer()`. The exposed path is host automation / macro / preset-driven
  changes arriving through the `set_tilt_eq` inlet — exactly what the parameter exists for.

### Red test

`tests/test_eqplus.js`, new section 9 (`runBugSweepPass1`): fresh mock face, enter
Linear Phase (IR pokes counted on the stubbed `#0-eqplusir` Buffer), then
`ui.set_tilt_eq(6)` and require a further IR poke; same again in Natural Phase.

```
AssertionError [ERR_ASSERTION]: bug sweep: set_tilt_eq redesigns the phase kernel in Linear Phase (stale IR: the gen convolves dry audio with the IR, so an automated Tilt EQ change is inaudible until an unrelated coeff update)
    at ok (/private/tmp/bugsweep/eqplus/tests/test_eqplus.js:36:12)
    at runBugSweepPass1 (/private/tmp/bugsweep/eqplus/tests/test_eqplus.js:2665:5)
```

Commands: `python3 scripts/build_eqplus.py && node tests/test_eqplus.js` (worktree, host).
The three sanity checks before the failing one pass (phase engages, entering Linear
pokes a designed IR, the tilt value itself lands), so the red is the missing redesign,
not a harness artefact.

### Fix direction (NOT applied in Pass 1)

Route `set_tilt_eq` through `updateCoeffBuffer()` like the other design inputs
(it already re-emits the tilt via `emitTilt` inside `updateCoeffBuffer`).

## Audited, no credible bug found

- **Config math** (`eqplus_config.js`): RBJ coeffs for all 13 modes; analog prototypes
  in `eqpAnalogSection` (shelf ×A gives the correct A² plateau; bell centre ratio A²);
  `eqpTiltShelf1` is exactly A² at DC and unity at Nyquist; solo bandpass is the RBJ
  constant-0 dB-peak form; `eqpEffectiveFreq` / `eqpEffectiveQ` clamps.
- **Gen cascade** (`eqplus_core.genexpr`): DF2T section loop, `sections` repetition,
  cstate snap/slew (0.995/0.005), zstate clear on enable/disable per curve and channel,
  M/S encode/decode gains (1/√2 both ways), tilt snap/slew into `tiltC` (gain at 27),
  Natural delay `round(322·sr/44100)`, Linear latency constant 3072 = (2048-1)+1025,
  IR job split (unity / curve A at irspec ch 0 @0 / curve B @2048 / Natural taps ch 1 @0,128)
  vs the face’s `Buffer.poke` layout (JS channels are 1-based) — all consistent.
- **Spectrum path**: gen spec writes (ch 0 pre, ch 1 post, ch 2 metadata, ch 3 sidechain,
  all at 8+writeIdx) vs face reads (1-based channels 1/2/3/4, offset 8 with offset-0
  fallback) and the build’s `buffer~ #0-eqplusspec 200 4 @samps 8200` — consistent.
- **Solo**: `updateSoloState` uses `toScreenFreq(b.freq)`, which *does* apply the Global
  Shift (`eqpEffectiveFreq`), and effective Q — matches the existing test’s expectation.
- **Routes**: Stereo/Left/Right/Mid/Side semantics (`routeEditsB`, `focusRoute`, linked
  copy-back) match the gen’s curve A = dom0 / curve B = dom1 slot logic and the build help text.
- **State blob**: `getvalueof`/`applyStateArray` indices (curve A at 12, shelves at 52,
  phase at 58, route at 59, curve B at 60; length 100) round-trip, incl. legacy lengths.
- **Latency reporting**: `updateDeviceLatency` matches the gen (Natural formula, Linear 3072).

## Pass 2 review (reds only — no fixes)

- **Kept 1 — Bug 1 (stale phase kernel on `tilt_eq` automation).** Mechanism re-checked: `set_tilt_eq` only `emitTilt()` + redraw; `set_shift` / `set_adaptiveq` call `updateCoeffBuffer()`; `updatePhaseKernel` passes `tiltEqDb` into `eqpDesignPhase`. Host node red still fails on unfixed code at the Linear Phase IR-poke assertion (`node tests/test_eqplus.js`). No rewrite needed.
- **Dropped 0.**

## Pass 3 fix

- **Bug 1 fixed** — `set_tilt_eq` (`src/eqplus_ui.js`) now calls `updateCoeffBuffer()` instead of only `emitTilt()` + redraw. `updateCoeffBuffer` already re-emits tilt and redesigns the Linear/Natural phase kernel via `updatePhaseKernel` → `eqpDesignPhase(..., tiltEqDb)`, matching `set_shift` / `set_adaptiveq`.
- Touchpoint: `src/eqplus_ui.js` `set_tilt_eq` (was `emitTilt()`; now `updateCoeffBuffer()`).
- Rebuilt `devices/EQ+.amxd`.
- Host gate green: `npm run -s typecheck && python3 scripts/build_eqplus.py && node tests/test_eqplus.js` — EQ+ tests passed (2763 checks).
- Commit SHA: recorded in the Pass 3 commit on `bugsweep/eqplus-pass1` (see final summary / `git log -1`).

## Pass 4 review (approve)

- **Bug 1 — APPROVED.** Production fix is the one-line `set_tilt_eq` change (`emitTilt()` → `updateCoeffBuffer()`); no drive-bys. `updateCoeffBuffer` still `emitTilt()`s then `updatePhaseKernel()` → `eqpDesignPhase(..., tiltEqDb)` for curves A/B, matching `set_shift` / `set_adaptiveq`. Red test kept and still asserts Linear + Natural IR redesign on automation. Host gate re-run green: `npm run -s typecheck && python3 scripts/build_eqplus.py && node tests/test_eqplus.js` — EQ+ tests passed (2763 checks). Tip after this note: see `git log -1`.


# EQ+ — Bug Sweep (continuation) Pass 1 (bugs + red tests only)

Worktree: `/tmp/bugsweep/eqplus` · Branch: `bugsweep/eqplus` · Base: `69699f7`
Scope: face `ondblclick` tilt-EQ reset vs Linear/Natural phase kernel (sibling of prior Bug 1).

## Bug 2 — Double-click reset of Tilt EQ leaves the phase kernel stale

**Severity:** audible wrong behaviour in Linear Phase after a face double-click reset; stale Natural correction FIR.

### Mechanism

- Prior Bug 1 fixed `set_tilt_eq` → `updateCoeffBuffer()`. Face *drags* also redesign via `finishGesture()` → `updateCoeffBuffer()`.
- Face **double-click** on the Tilt EQ hitbox (`ondblclick`, `hit(L.tilt, …)`) only `emitTilt()` + redraw — same gap Bug 1 had on the automation inlet. Shift double-click correctly calls `updateCoeffBuffer()`.
- In Linear Phase the gen convolves dry audio with the designed IR; tilt lives only in that IR for the Linear path. Resetting the painted value without redesigning leaves the old tilt audible until some other coeff update.

### Red test

`tests/test_eqplus.js` `runBugSweepPass1`: after the automation checks, re-enter Linear Phase, `set_tilt_eq(9)`, double-click the tilt hitbox, assert value → 0 and a further IR poke.

```
AssertionError [ERR_ASSERTION]: bug sweep: tilt EQ double-click reset redesigns the Linear Phase IR (stale IR: ondblclick only emitTilt(), unlike shift dblclick which calls updateCoeffBuffer)
```

### Fix direction (NOT applied in Pass 1)

In the `ondblclick` tilt branch, call `updateCoeffBuffer()` instead of `emitTilt()` (mirrors shift dblclick / fixed `set_tilt_eq`).

## Pass 2 review (reds only — no fixes)

- **Kept 1 — Bug 2 (stale phase kernel on tilt EQ double-click reset).** Mechanism re-checked against `ondblclick` vs `finishGesture` / `set_tilt_eq`. Host node red fails on the new IR-poke assertion. No rewrite needed.
- **Dropped 0.**

## Pass 3 fix

- **Bug 2 fixed** — `ondblclick` tilt branch in `src/eqplus_ui.js` now calls `updateCoeffBuffer()` instead of only `emitTilt()`.
- Touchpoint: `src/eqplus_ui.js` `ondblclick` / `hit(L.tilt)` (was `emitTilt()`; now `updateCoeffBuffer()`).
- Host gate green: `python3 scripts/build_eqplus.py && node tests/test_eqplus.js`.

## Pass 4 review (approve)

- **Bug 2 — APPROVED.** One-line production change mirroring the shift dblclick / Bug 1 fix; red assertions kept; no drive-bys.

# Amp+ variants — Pass 1 bug hunt (bugsweep/ampplus-variants-pass1)

## Verdict

**1 credible bug found.** Red test added in `tests/test_ampplus_bugsweep.js`
(expect FAIL on current HEAD). Production code is intentionally untouched in
pass 1.

- Worktree: `/private/tmp/bugsweep/ampplus-variants`, branch
  `bugsweep/ampplus-variants-pass1`.
- Devices in scope: `devices/Amp+.amxd` plus the five locked-face variants
  (`Amp+ Wave/Pulse/Tiles/Strip/Mono.amxd`), all built by
  `scripts/build_ampplus.py`.

## Bug 1: Scope buffer uses `#0-ampscope` (not instance-isolated in Live)

### Symptom
Every Amp+ instance in a Live Set shares one scope ring / header. With
`scopeon 1` the gen pokes envelope, peak and the 24-sample waveform into
`buffer~ #0-ampscope`; the face polls it every 33 ms for meters, traces,
spokes, tiles and the level disc. Two (or more) Amp+ devices therefore
corrupt each other's meters and waveform displays.

### Evidence
- `scripts/build_ampplus.py:190` — `sc.message("obj-msg-buf", "#0-ampscope", ...)`
  (loadbang name fed to `prepend scope` / `prepend set_scope`).
- `scripts/build_ampplus.py:194` —
  `sc.newobj("obj-scope", "buffer~ #0-ampscope @samps 32", ...)`.
- `src/ampplus_core.genexpr` — `Buffer scope("ampscope")` rebound on loadbang
  via `scope <name>`; the collision is the patcher-side name, not the GenExpr
  external default.
- `AGENTS.md` §30 still documents `buffer~ #0-ampscope` as the contract.
- Same class already fixed elsewhere: Multiband Split migrated
  `#0-splitscope` → `---mbsplitscope` because "Live does not expand `#0` in a
  device's top-level patcher (AGENTS 15)"; Glitch / Delay+ / Spectral Split
  use `---` names and assert no literal `#0` in box text / v8ui script
  (`tests/test_glitch.js`, `tests/test_mbsplit.js`).
- `tests/test_ampplus.js` never asserts `---` isolation or rejects
  `#0-ampscope`.

### Red test
`tests/test_ampplus_bugsweep.js` — for each of the six `.amxd` files:
`obj-scope.text === "buffer~ ---ampscope @samps 32"`,
`obj-msg-buf.text === "---ampscope"`, and no box text matches `#0-ampscope`;
plus the same constraints on `scripts/build_ampplus.py`.

### Fix direction (do **not** apply in pass 1)
In `scripts/build_ampplus.py` replace `#0-ampscope` with `---ampscope` in the
`buffer~`, the loadbang message, and any bind strings; rebuild all six
devices; update `AGENTS.md` §30. GenExpr `Buffer scope("ampscope")` can stay
(rebound by `scope ---ampscope`, same pattern as Glitch).

## Audited and cleared

### Z-order / ignoreclick vs live.* controls
Hypothesis that `obj-viz-bg` (full-bleed `ignoreclick` drawing canvas) sat
after the `live.*` dials and covered them. Probe of all six `.amxd` files:
`obj-viz-bg` at `boxes[0]`, `obj-viz` at `[1]`, `bg.ignoreclick = 1`,
`bg.background` undefined, **zero** `live.*` boxes before `obj-viz-bg`. Per
AGENTS.md rule 4 (ignoreclick exception: later in `boxes` = in front), the
ordering is correct. Not a bug.

### GenExpr / tone-stack / cabinet core
`src/ampplus_core.genexpr` read in full. Existing `tests/test_ampplus.js`
covers single-return lint, no `e<digit>` identifiers, toneDb / volCurve,
flat/shelf biquad magnitudes, cab LP/HP/peak helpers, slew, and a short
biquad run. No new DSP defect found in pass 1.

### Presentation / look lock / overlap
Five looks (Wave/Pulse/Tiles/Strip/Mono) validated by `test_ampplus.js`
(`ampLookProblems`, baked `ampLookLock`, no `live.*` overlap with
`obj-viz`'s click target). Variant devices lock Look to one face. Cleared.

### Integer > 255 automatable params / theme / state
No `parameter_type` integer knobs above 255 spotted in the Amp+ build path;
theme menus come from `spectral_common`; no `getvalueof`/`setvalueof` blob
beyond the normal Live parameter set. Cleared for pass 1.

## Commands run (pass 1)
- `git merge --ff-only main` on `bugsweep/ampplus-variants-pass1` (clean).
- Host reads of `src/ampplus_{ui,looks,core,models}.*`,
  `scripts/build_ampplus.py`, `tests/test_ampplus.js`, `AGENTS.md` §30.
- Z-order probe script over all six `.amxd` (see above).
- `node tests/test_ampplus_bugsweep.js` — expected RED on current HEAD
  (run after this file lands).

## Pass 2 review — KEEP

**Kept 1 / dropped 0.**

Bug 1 is a real multi-instance functional bug (shared scope ring corrupts
meters/waveforms across Amp+ instances in one Set), not a nit or harness-only
issue. Pass-2 checks:

1. **Top-level patcher name** — `scripts/build_ampplus.py` emits
   `buffer~ #0-ampscope @samps 32` and loadbang message `#0-ampscope`, wired to
   gen (`prepend scope`) and face (`prepend set_scope`). Same class as devices
   that already migrated: Live does not expand `#0` in a top-level device
   patcher (AGENTS Multiband Split / Glitch / Delay+).
2. **Face + gen bind that name** — `src/ampplus_ui.js` `set_scope`,
   `src/ampplus_core.genexpr` `Buffer scope("ampscope")` rebound on loadbang;
   collision is the patcher-side name, not the GenExpr default.
3. **Red fails on HEAD** — `node tests/test_ampplus_bugsweep.js` →
   AssertionError: got `buffer~ #0-ampscope @samps 32`, expected
   `buffer~ ---ampscope @samps 32`.

Red test left as-is (already asserts all six `.amxd` + build source). Production
/ `src` / build untouched (pass 3 applies `---ampscope`). No new bugs found;
pass-1 cleared items stand.

### Commands run (pass 2)
- Re-read build scope wiring; grep Amp+/AGENTS for ampscope / `#0` / `---`.
- `node tests/test_ampplus_bugsweep.js` — RED (confirmed).
- Host gate: `npm run -s typecheck && python3 scripts/build_ampplus.py && node tests/test_ampplus.js` (in flight / next).

## Pass 3 fix

**Bug 1 fixed.** Renamed scope buffer `#0-ampscope` → `---ampscope` so each Amp+ instance gets its own ring (Live does not expand `#0` in a top-level M4L patcher).

### Touchpoints
- `scripts/build_ampplus.py` — `obj-msg-buf` loadbang message and `obj-scope` `buffer~` text (`#0-ampscope` → `---ampscope`).
- Rebuilt all six devices: `devices/Amp+.amxd` plus Wave/Pulse/Tiles/Strip/Mono.
- `AGENTS.md` §30 — contract updated to `buffer~ ---ampscope`.
- GenExpr `Buffer scope("ampscope")` left as-is (rebound on loadbang via `scope ---ampscope`, same pattern as Glitch).

### Host gate (green)
`npm run -s typecheck && python3 scripts/build_ampplus.py && node tests/test_ampplus.js && node tests/test_ampplus_bugsweep.js` → typecheck ok, six devices built, `ampplus ok`, `ampplus bugsweep ok`.

### Commit
`ccb8f79` fix(ampplus): isolate scope buffer with ---ampscope (bugsweep pass3) on `bugsweep/ampplus-variants-pass1`; no merge to main.

## Pass 4 review — APPROVED

**Approved 1 / adjusted 0.**

Bug 1 fix (`#0-ampscope` → `---ampscope`) is minimal, correct, and matches the AGENTS.md --- isolation precedent (Delay+/Glitch/Multiband Split). Review checks:

1. **Production diff** — `scripts/build_ampplus.py` is a pure two-site rename (`obj-msg-buf` + `obj-scope`); no drive-by refactors.
2. **AGENTS.md §30** — contract updated to `buffer~ ---ampscope`.
3. **GenExpr intentional** — `Buffer scope("ampscope")` left as-is; rebound on loadbang via `scope ---ampscope` (same pattern as Glitch).
4. **Tests not weakened** — `tests/test_ampplus_bugsweep.js` still requires `---ampscope` on all six `.amxd` + build source and still rejects `#0-ampscope`.

### Host gate (green)
`npm run -s typecheck && python3 scripts/build_ampplus.py && node tests/test_ampplus.js && node tests/test_ampplus_bugsweep.js` → typecheck ok, six devices built, `ampplus ok`, `ampplus bugsweep ok`.

### Tip
`d934a76` on `bugsweep/ampplus-variants-pass1` before this Pass-4 docs commit; no merge to main; worktree kept.

# Percipitator — Bug Sweep Pass 1 (red tests only, no fixes)

- Device: `devices/Percipitator.amxd`
- Branch: `bugsweep/percipitator-pass1` (from HEAD `66fea67`)
- Worktree: `/tmp/bugsweep/percipitator`
- Scope: read AGENTS.md §9 + all Percipitator src/scripts/tests; hunted logic, param
  range/default/mapping, state, gen-vs-JS mirror and UI-binding bugs. No production code changed.
- Baseline before adding tests: `node tests/test_percipitator.js` → `test_percipitator: ok` (exit 0).

## Bug 1 — Partial Sieve gains diverge between the gen core and its JS mirror (all non-All modes)

`src/percipitator_config.js:103` `computeSieveGain` is documented as matching the gen
(`Per-band Partial Sieve gain multiplier matching sieve_gain() in src/percipitator_core.genexpr`),
and the face uses the JS values to shade muted lanes (`src/percipitator_ui.js:626`, threshold
`sWeight < 0.25`) and to weight the demo state (`src/percipitator_ui.js:96`). The audio path uses
`sieve_one` in the gen. They do not match:

| Mode | Gen (`src/percipitator_core.genexpr:72-75`) | JS (`computeSieveGain`) |
|---|---|---|
| Odd (1), attenuated bands | 0.06 | 0.08 |
| Even (2), attenuated bands | 0.06 | 0.08 |
| Sprs (3), every-3rd boost | 1.18 | 1.15 |
| Sprs (3), attenuated bands | 0.03 | 0.04 |
| Rise (4) | `0.22 + 0.98 * (b / 15)` (0.22 → 1.20) | `0.25 + 0.95 * (b / 15)` (0.25 → 1.20) |

Effect: with any sieve mode except All, the partial gains the user hears differ from the gains
the face displays/uses (e.g. Rise band 0 is shaded as exactly at the 0.25 mute threshold in JS
while the gen applies 0.22; Sprs droplets are boosted 1.18x in audio but 1.15x in the mirror).
One side is wrong; pass 1 only proves the divergence. The pre-existing tests only asserted the
JS side loosely (`< 0.1` attenuation, Sprs band 0 exactly 1.15), so this escaped.

Red test: `tests/test_percipitator.js` block 7 (line 435) — extracts the constants from
`sieve_one` in the gen source, reconstructs the gen gains, and asserts
`cfg.computeSieveGain(b, m)` equals them for all 16 bands × 5 modes.

Red output (`node tests/test_percipitator.js`, exit 1):

```
AssertionError [ERR_ASSERTION]: Sieve mirror mismatch band 1 mode 1: JS 0.08 vs gen 0.06
    at Object.<anonymous> (/private/tmp/bugsweep/percipitator/tests/test_percipitator.js:462:20)
```

## Bug 2 — Gen procedural fallback triangle wave is inverted

When the wavetable buffer reads empty (`hasWt == 0`, `src/percipitator_core.genexpr:259-266` —
e.g. before the first wavetable poke lands), `voice_osc` synthesizes the four shapes
procedurally. Its triangle term (`src/percipitator_core.genexpr:262`)

```
pTri = 1.0 - 4.0 * abs(wrap(wPh - 0.25, 0, 1) - 0.5);
```

evaluates to **-1 at phase 0.25 and +1 at phase 0.75**. The canonical Triangle frame it
substitutes for peaks at +1 at 0.25 and troughs at -1 at 0.75
(`src/percipitator_config.js:167`: "phase-aligned with sine: rises 0..0.25, falls 0.25..0.75";
verified from `generateStandardWavetable()`: frame 1 sample 512 = +0.98, sample 1536 = -0.98).
The fallback sine and saw terms do align with their frames (saw starts high and ramps down,
matching the sine-series frame), so this is a one-sign error in the triangle term only:
any Wave morph position that blends through the Triangle frame is phase-flipped (half-cycle
shifted) whenever the fallback path is active. The fix direction is `wrap(wPh + 0.25, 0, 1)`
(not applied — pass 1 is red tests only).

Red test: `tests/test_percipitator.js` block 8 (line 470) — pins the canonical frame from
`generateStandardWavetable()`, extracts the `pTri` expression from the gen source, evaluates
it with a JS `wrap`/`abs`, and asserts 0 / +1 / 0 / -1 at phases 0 / 0.25 / 0.5 / 0.75.
The suite stops at Bug 1s assertion first; the identical extraction evaluated standalone gives:

```
pTri(0)=0 pTri(0.25)=-1 pTri(0.5)=0 pTri(0.75)=1
```

## Checked — no credible bug found

- Parameter ranges/defaults: build `PARAM_SPECS` (`scripts/build_percipitator.py:41-90`), gen
  `Param` defaults and `clip` ranges, UI setter clamps and UI defaults all agree with AGENTS.md
  §9 (Pitch ±24, Shift ±2000 Hz, Stretch 50–200%, Decay 1–1500 ms, Attack 0.2–100 ms,
  Wave init 0, Warp init 50, Tilt ±100%, Vol −36..+18 dB, Mix init 100 → `wet`).
- Mirrors that do match exactly: tilt (`pow(2, t * pos * 6.0)`, ±36 dB), scale quantizer
  (search ±11, strict-`<` tie-break, snap mix, mask-0 passthrough), warp Bend/Asym/Sync/Fold,
  band frequency table (`band_hz` vs `BAND_FREQS`).
- Enum wiring: Mode (Bend/Asym/Sync/Fold) and Sieve (All/Odd/Even/Sprs/Rise) reach the gen via
  `prepend wtmode`/`prepend sieve` unscaled and the face via `set_wtmode`/`set_sieve`; percent
  params are scaled exactly once (`* 0.01` boxes shared by the control and viz-route paths).
- Sidechain MIDI: `midiin → midiparse` outlet 0 → `prepend midi_in` → face; chord latch and
  `computeMidiChordState` behave as tested; scale-strip toggling, `set_scalemask` and
  `setvalueof` all refuse a zero mask (so the `0 → 0xFFF` case in `setvalueof` is a deliberate
  guard, not a round-trip bug).
- Gate: drag inversion `vis01ToDb` bisects the same `ampToVis01` curve the line is drawn with
  (already covered by the click-on-the-line test); `pcpDspResend` re-sends every gen parameter
  in gen units (freeze is hard-sent 0, consistent with the deliberately removed Freeze control).
- Build assembly order (config → GEN_DSP vars → dsp → ui), probe scope slots (33 active,
  16+3 MIDI), nested-`return` guard, and the Freeze/silence-sleep behaviour (covered by
  `run_percipitator_audio_tests.py` cases `freeze_hold`/`freeze_off`/`sleep_silent`/`sleep_wake`).

## Commands

```bash
node tests/test_percipitator.js   # baseline: ok (exit 0); with the new tests: exit 1, Bug 1 assertion above
git -C /tmp/bugsweep/percipitator status   # only tests/test_percipitator.js modified + BUGS.md added
```

## Pass 2 review

Reviewed both claimed reds against live source (`computeSieveGain` / `sieve_one`, `pTri` / `generateStandardWavetable` + UI call sites). Both are real functional bugs; neither dropped.

1. **Kept** — Partial Sieve gains diverge between gen audio path and JS mirror used for UI shading / demo weighting. Host test fails at block 7: `Sieve mirror mismatch band 1 mode 1: JS 0.08 vs gen 0.06` (exit 1).
2. **Kept** — Gen procedural fallback triangle (`pTri`) is phase-inverted vs the canonical Triangle wavetable frame (+1 at 0.25 / -1 at 0.75). Block 8 pins the frame and asserts the fallback; standalone evaluation gives `pTri(0.25)=-1`.

Dropped: 0. No production/src edits (pass 3). Strengthening not needed — both reds already fail on unfixed code.

## Pass 3 fixes

Host gate green: `npm run -s typecheck && python3 scripts/build_percipitator.py && node tests/test_percipitator.js` → `test_percipitator: ok (408x169 Concept 3 verified)` (exit 0).

1. **Bug 1 — Sieve mirror** — Aligned JS `computeSieveGain` (`src/percipitator_config.js`) to gen `sieve_one` constants: Odd/Even atten `0.08`→`0.06`, Sprs boost `1.15`→`1.18` / atten `0.04`→`0.03`, Rise `0.25+0.95*(b/15)`→`0.22+0.98*(b/15)`. Comment now says `sieve_one`. Updated the pre-existing Sprs band-0 pin in `tests/test_percipitator.js` from `1.15`→`1.18` (outdated mirror value; block 7 gen-extraction red left intact).
2. **Bug 2 — Inverted pTri** — `src/percipitator_core.genexpr` fallback triangle: `wrap(wPh - 0.25, 0, 1)` → `wrap(wPh + 0.25, 0, 1)` so phase 0.25 = +1 / 0.75 = −1 matching the wavetable frame.

Rebuild: `devices/Percipitator.amxd` regenerated (408×169). Commit SHA recorded in the pass-3 commit on `bugsweep/percipitator-pass1` (see git log; do not merge to main).

## Pass 4 review

APPROVED. Live re-check of gen `sieve_one` vs JS `computeSieveGain` and of `pTri` vs the Triangle wavetable frame; host gate green.

1. **Bug 1 — Sieve mirror** — APPROVED. JS constants match gen exactly (Odd/Even atten 0.06, Sprs 1.18/0.03, Rise 0.22+0.98*(b/15)); Sprs band-0 pin 1.15→1.18 is mirror-value sync only; Block 7 gen-extraction red left intact. Minimal — JS aligned TO gen, no drive-by.
2. **Bug 2 — Inverted pTri** — APPROVED. `wrap(wPh + 0.25, 0, 1)` yields +1 at phase 0.25 / −1 at 0.75, matching `generateStandardWavetable` frame 1. Minimal one-sign fix in the fallback path.

Host gate: `npm run -s typecheck && python3 scripts/build_percipitator.py && node tests/test_percipitator.js` → `test_percipitator: ok (408x169 Concept 3 verified)` (exit 0). Tip before this docs commit: `dd6880a` on `bugsweep/percipitator-pass1`. Do not merge to main; do not delete the worktree.

# Delay+ / Delay+ End — Bug Sweep (Pass 1 findings, Pass 2 review)

Worktree: `/tmp/bugsweep/delayplus` · Branch: `bugsweep/delayplus-pass1` · Base: `66fea67`
Scope: `devices/Delay+.amxd` + `devices/Delay+ End.amxd` — `src/delayplus_config.js`,
`src/delayplus_link.js`, `src/delayplus_start.genexpr`, `src/delayplus_end.genexpr`,
`src/delayplus_ui.js`, `src/delayplus_dsp.js`, `src/delayplus_end_ui.js`,
`src/delayplus_filter.js`, `src/delayplus_lfo.js`, `src/delayplus_spectrum.js`,
`src/delayplus_clipled.js`, `src/delayplus_clipcurve.js`, `src/delayplus_notedial.js`,
`src/delayplus_viz_b.js`, `scripts/build_delayplus.py` (parameter table),
`scripts/run_delayplus_audio_tests.py` (case list), `tests/test_delayplus.js`.
Max / Live were NOT run in this pass (the Node gate below is the only run; the two bugs
are in code paths the Max harness cases cannot see, see Bug 1).

## Pass 2 review — kept 2 / dropped 0

Re-read `delayplus_end.genexpr` (K calib), `delayplus_start.genexpr` (`pR`), and
`delayplus_lfo.js` `paint()`. Host gate: `node tests/test_delayplus.js` → 37 passed,
2 failed (only the two reds below). No production/src edits in this pass.

- **Kept Bug 1** — real DSP: comment requires the same K twice in a row; `kCand` is
  cleared only on `!alive`, so a failed window leaves a banked candidate and a later
  single accept adopts a wrong K (dry offset + feedback B).
- **Kept Bug 2** — real UI: gen advances R by Phase (`pR = wrap(lfo + phase/360)`);
  paint subtracts (`ph = … - off`). At Phase 90 the red test gets the exact sign-flipped
  y (73.4 vs 8.6); live dots plot real `LFO_R`, so they leave the drawn curve.

## Pass 3 — fixes applied (host gate now 39 passed, 0 failed)

Both Pass-2 kept reds fixed with minimal source changes; no tests weakened or deleted.
Host gate: `npm install && npm run -s typecheck && python3 scripts/build_delayplus.py && node tests/test_delayplus.js` -> 39 passed, 0 failed.

- **Bug 1 fixed** — `src/delayplus_end.genexpr`, K calibration window (the `if (cN >= 8192)` block): added an `else { kCand = 1e9; }` on the acceptance `if`, so any calibration window that does not adopt clears the pending candidate; adoption again requires two consecutive accepted windows with the same lag. Red "K calibration: a candidate must be seen twice in a row (a failed window clears it)" is now green.
- **Bug 2 fixed** — `src/delayplus_lfo.js` `paint()` per-point loop: changed the right-channel phase from `ph = k / N * cyc - off` to `ph = k / N * cyc + off`, matching the gen which advances R by Phase (`pR = wrap(lfo + phase/360)`); the drawn right waveform and the live `LFO_R` dot now agree at every Phase. Red "LFO display: the right waveform is drawn at the phase the gen applies (R = LFO + phase)" is now green.

## Pass 4 — final review (ADJUSTED)

Re-read Pass-3 diffs vs `main`, the K-calib window in `delayplus_end.genexpr`, gen `pR` in `delayplus_start.genexpr`, and `delayplus_lfo.js` `paint()`. Host gate after the follow-up: `npm run -s typecheck && python3 scripts/build_delayplus.py && node tests/test_delayplus.js` → 39 passed, 0 failed. No tests weakened. No merge to main.

- **Bug 1 — APPROVED** — `else { kCand = 1e9; }` on the acceptance `if` inside `if (cN >= 8192)` is minimal and correct: a rejected window clears the pending candidate so adoption again needs two consecutive accepted lags. (Note: `reverbplus_end.genexpr` still lacks this `else` clear — out of scope for this worktree; Delay+ is ahead.)
- **Bug 2 — ADJUSTED** — Pass-3 correctly flipped the main per-point phase to `+ off`, but left the discontinuity edge helper at `(k - 1) / N * cyc - off` (square/saw/noise vertical edges). Pass 4 changed that site to `+ off` as well so every paint path matches gen `pR = wrap(lfo + phase/360)`. Devices rebuilt.

## Bug 1 — End K calibration: a candidate does not have to be seen twice IN A ROW

**Severity:** wrong K, adopted silently and persistently: the dry signal is read at the
wrong Start offset in the End and Start re-inserts the feedback return at the wrong
position (B = Smax − K), so echoes drift off n · T and the dry/wet alignment shifts
until a later pair of agreeing windows happens to re-calibrate.

### Mechanism

- `src/delayplus_end.genexpr`, K calibration block: every 8192 samples the End
  cross-correlates its whitened chain output against the whitened tap (xfer ch4) for
  128 candidate lags around the counter anchor. The stated adoption rule, in the code
  comment and AGENTS.md §15, is: a peak is adopted only when it is strong
  (normalised > 0.4), unambiguous (1.5× the runner-up), inside the window — and
  **the same K twice in a row** (`if (cand == kCand) { kCal = cand; calOk = 1; }`,
  then `kCand = cand;`).
- `kCand` (the seen-once candidate) is cleared in exactly one place: the
  `if (!alive)` block, when the Start counter stops. A window that FAILS the
  acceptance criteria — silence (energies below threshold), tonal input (ambiguity
  check), or a peak at the window edge — leaves `kCand` untouched, and so does a
  window whose best lag is a different value that also fails.
- Consequence: one spurious accepted peak (a transient, a chain device being toggled,
  a burst of noise) is banked indefinitely. Minutes later, a single ordinary window
  whose best lag equals the banked value adopts it as K — not two in a row in any
  meaningful sense. `calOk` then keeps that K (`kk = calOk ? kCal : anchor`) until
  another value manages two consecutive accepted windows.
- The Max audio harness cannot catch this: its cases use a fixed `delay~ L` chain, so
  calibration succeeds immediately and stays put; no case injects a failing window
  between two agreeing ones.

### Red test

`tests/test_delayplus.js`, new test "K calibration: a candidate must be seen twice in
a row (a failed window clears it)": structural, in the style of the existing gen
source checks in the same file (frame counter position, CLIP_DB on the tick). It
slices the window-evaluation block (`if (cN >= 8192)` … `kk = calOk`) of
`src/delayplus_end.genexpr` and requires a `kCand = 1e9` reset inside it, i.e. a
window that does not adopt must drop the pending candidate.

# Reverb+ / Reverb+ End — Bug Sweep Pass 1

Worktree: `/private/tmp/bugsweep/reverbplus` · Branch: `bugsweep/reverbplus-pass1` · Base: `66fea67`
Scope: `devices/Reverb+.amxd` + `devices/Reverb+ End.amxd` — `src/reverbplus_engine.js`,
`src/reverbplus_end.genexpr`, `src/reverbplus_start.genexpr`, `src/reverbplus_config.js`,
`src/reverbplus_face*.js`, `src/reverbplus_link.js`, `src/reverbplus_dsp.js`,
`scripts/build_reverbplus.py`, `tests/test_reverbplus.js`, `tests/test_reverbplus_face.js`.
Max / Live were NOT run in this pass (host Node gate only).

## Bugs found (2)

### Bug 1 — `clear_ir` does not clear the saved IR File parameter; Live reload resurrects the IR

**Severity:** user-visible state bug. Clear IR appears to work until the set is reloaded (or the
device is duplicated / the Live.drop param is restored), at which point the previously cleared
impulse comes back.

#### Mechanism

- `browsed()` / `anydrop` → `rpDropRun()` store the path with `outlet(4, p)` into the IR File
  `live.drop` parameter so Live persists it (`src/reverbplus_engine.js` ~156, ~163).
- `clear_ir()` (`src/reverbplus_engine.js` 171–181) zeroes in-memory IR state and
  `rpLastDropped = ""`, bumps the header version, and broadcasts — but **never**
  `outlet(4, "")`.
- On the next load Live replays the still-saved path into `dropfile()`. Because
  `rpLastDropped` is `""`, the guard `p === rpLastDropped && rpIr.loaded` fails, so
  `rpIrLoad(p)` runs and the cleared IR is reloaded.

#### Red test

`tests/test_reverbplus.js`, "clear_ir: a cleared IR stays cleared when Live replays the saved IR File path on load":
vm-executes the real IR path helpers, loads via `browsed("/x/ir.wav")`, clears, then feeds
whatever Live would have saved back into `dropfile()`. Requires the IR to stay unloaded and
no `outlet(2, "replace", …)` to fire.

```
FAIL clear_ir: a cleared IR stays cleared when Live replays the saved IR File path on load: replaying the saved IR File value after clear_ir must not reload the IR
```

#### Fix direction (NOT applied in Pass 1)

In `clear_ir()`, also `outlet(4, "")` (clear the stored IR File parameter), matching how
`browsed`/`anydrop` write it. Alternatively suppress resurrect in `dropfile` after an explicit
clear; clearing outlet 4 is the direct fix already proven on a parallel bugfix branch.

---

### Bug 2 — End K calibration: a candidate does not have to be seen twice IN A ROW

**Severity:** wrong K, adopted silently and persistently: the dry signal is read at the wrong
Start offset in the End and Start re-inserts the feedback return at the wrong position
(B = Smax − K), so the outer loop drifts until a later pair of agreeing windows re-calibrates.
Identical defect to Delay+ End (bugsweep/delayplus-pass1 Bug 1).

#### Mechanism

- `src/reverbplus_end.genexpr` K calibration block (comment at ~151–158; window at
  `if (cN >= 8192)` … `kk = calOk`): every 8192 samples cross-correlates whitened chain
  output against the whitened tap (xfer ch4). Stated rule: adopt only when strong
  (norm > 0.4), unambiguous (1.5× runner-up), inside the window — **and the same K twice
  in a row** (`if (cand == kCand) { kCal = cand; calOk = 1; }`, then `kCand = cand`).
- `kCand` is cleared in exactly one place: the `if (!alive)` block. A window that fails
  acceptance leaves `kCand` untouched.
- Consequence: one spurious accepted peak is banked indefinitely; minutes later a single
  ordinary window whose best lag equals the banked value adopts it as K — not two in a row
  in any meaningful sense. `kk = calOk > 0.5 ? kCal : anchor` then keeps that K.

#### Red test

`tests/test_reverbplus.js`, "K calibration: a candidate must be seen twice in a row (a failed window clears it)":
structural slice of the `if (cN >= 8192)` … `kk = calOk` window; requires a `kCand = 1e9`
reset inside it (same shape as Delay+).

```
FAIL K calibration: a candidate must be seen twice in a row (a failed window clears it): a calibration window that does not adopt must clear the pending candidate (kCand)
```

### Fix direction (NOT applied in Pass 1)

Clear `kCand` at the end of every calibration window that did not adopt (an `else`
on the acceptance `if`, or an unconditional reset after the adoption check), so
adoption again requires two consecutive accepted windows with the same lag.

## Bug 2 — Modulation page draws the right LFO with the phase sign flipped

**Severity:** display-only, but the display contradicts the device: with Mod Phase
set to anything but 0 or the 180° default, the orange right-hand waveform on the
Modulation page is drawn 2 × phase away from the LFO the device is actually
applying, and the live dot (which plots the real value) does not sit on the drawn
curve.

### Mechanism

- Gen (authoritative, it makes the sound): `src/delayplus_start.genexpr` computes
  the right LFO phase as `pR = wrap(lfo + clip(phase, 0, 360) / 360, 0, 1)` — the
  right channel is ADVANCED by Phase — and pokes the resulting `lR` to scope
  `LFO_R` every 64 samples.
- Display: `src/delayplus_lfo.js` `paint()` builds the two channels as
  `chans = [[C_L, 0], [C_R, pOff]]` with `pOff = phase / 360`, then evaluates each
  point as `ph = k / N * cyc - off` — MINUS the offset for the right channel.
- At the default Phase 180 the error is invisible (`sin(θ + π) == sin(θ − π)`), and
  at Phase 0 there is no offset; at Phase 90 the drawn right curve is a full 180°
  from the applied LFO whose value the page live dot shows from `DP_SCOPE.LFO_R`.

### Red test

`tests/test_delayplus.js`, new test "LFO display: the right waveform is drawn at the
phase the gen applies (R = LFO + phase)": vm-executes the real scripts
(`delayplus_config.js` + `delayplus_lfo.js`, the Filter Display test pattern) with a
recording mgraphics stub, sets Phase 90 / sine / no mod depth, calls `paint()`, and
checks the recorded right waveform against `sin(2π(ph + 0.25))` through the script
own `lfoY` geometry (wh 80, amp 0.9: y = 41 − v · 32.4).

```
FAIL LFO display: the right waveform is drawn at the phase the gen applies (R = LFO + phase): right LFO at ph 0 sits at its +90 degree value expected 8.600000000000001 got 73.4
```

(73.4 is exactly the sign-flipped value, confirming the diagnosis rather than a
harness artefact.)

### Fix direction (NOT applied in Pass 1)

Draw the right channel with `ph = k / N * cyc + off` in `paint()` (equivalently pass
the offset with the gen sign), so the curve and the live dot agree at every Phase.

## Commands and results

```
cd /tmp/bugsweep/delayplus && node tests/test_delayplus.js
→ 37 passed, 2 failed — the only failures are the two new tests above.
```

(The build step of the AGENTS gate was not run: rebuilding would rewrite the
shipped `.amxd` files, and Pass 1 commits only tests + this file. The pre-existing
device-structure tests read the `.amxd` files from the checkout and pass.)

## Audited, no credible bug found

- **Config math** (`delayplus_config.js`), partly by Node property probes run during
  the sweep: `dpPitchFolded` agrees with the folding `dpSideMs` actually performs for
  all 128 notes × five tank minima; `dpSideWarn` printed MIN/MAX multipliers make the
  Sync time fit when applied, and its Pitch MAX note is the highest non-folding note
  across offset/cents combinations; `dpDivSnap` always returns an offered value and
  is idempotent for every Triplet/Dotted switch combination; division enum sorted,
  LFO sync beats match the build `LFO_DIVS` names.
- **Pairing and latency (LOM)**: `dpFindPartner` bracket matching, `dpChainLatency`
  strictly-between sum, `dpDeviceLatency` longest-chain recursion, registry staleness
  (3 s) and the link poll (partner rebind for the End, `hdr[30]` poke for the Start,
  unpaired rebind to own buffers) all match AGENTS.md §15.
- **Transfer protocol in the gens**: Smax held max over the current + 3 windows,
  B = clip(Smax − K, 1, 8192) with the unpaired fallback, return read at End index
  `cn − Smax`, reinsertion at `cn − B − L − dTot`, dry read at `cE + K − L`, the
  2048-sample duck on any L/B/K change — all as specified.
- **Feedback path**: diffusion allpasses are true Schroeder allpasses whose per-side
  lengths sum exactly to `dTot`; freeze latches whole-sample periods, fades the chain
  return out with `ig`, and at full freeze the return slot is written back unchanged
  (no clip, no drift); the feedback soft clip on the return and the tank clip laws
  (Soft linear to 0.8 T then tanh to T, Hard, linked Limit) match the Options page
  text and the clip-curve display formula.
- **Echo DSP additions**: M/S encode/decode of input, return and tap are consistent
  inverses; Ping Pong swaps the return and mono-feeds the left tank; ducking gain in
  the End simplifies to the documented 2 dB-per-dB, 24 dB-capped law (also covered by
  an existing test); equal-power Dry/Wet matches its spec.
- **Parameter mapping**: every `P` entry in `scripts/build_delayplus.py` maps to the
  gen Param of the same name with the correct scale (`/100` exactly for the percent
  parameters), and the UI-only parameters (times, LFO rate) are the ones the face
  pokes into `hdr[27/28/31]`; `DP_GEN_PARAMS` resend after deferred DSP load covers
  every hub prepend (also covered by an existing test).
- **Load / idle**: deferred-DSP claim queue, 150 ms resend until the scope frame
  counter moves, settle resend, and the ring sleep logic in `dpFrame` match AGENTS
  §15 / 1d. (One judgement call left alone: after a DSP confirm timeout the face
  never retries creation because `createdAt` stays set — it does surface DSP FAILED
  and matches the shared pattern, so it is recorded here, not filed as a bug.)
- **`dpMinTimeSamples` / `dpEffectiveTimes`** use a simplified B + L + mod + 4
  minimum that omits the gen terms for diffusion (`dTot`) and wobble — but nothing in
  the device calls them (the face folds and warns from the gen-reported scope TMIN),
  so the difference is test-model only and not user-visible. Not filed.
- **Filter Display / spectrum / clip LED / note display**: spectrogram ring is
  re-linearised oldest-first from the poked head, box-select and joint drag match the
  existing test, `fdMag` gives 1/k at each cutoff, the clip LED hold/fade via
  `dpClipStep` matches the ~1 s spec, and the MIDI note display is display-only as
  documented.

# Bug sweep — Transient Split (transplit), Pass 4 (review)

Worktree: `/tmp/bugsweep/transplit` · Branch: `bugsweep/transplit-pass1` · Base: `66fea67`
Pass 3: fixed 1 / remaining 0. Bug 1 fixed — GenExpr tilt-gain cache now keys on sample rate (`cgSr`), mirroring `twSr`. Host gate green.
Pass 4: **APPROVED** — no code changes. Fix is minimal, correct, and matches the existing History cache-key pattern; red test unchanged and green; no drive-by refactors.
Scope: `devices/Transient Split.amxd` + `.adg`, `src/transplit_*`, `src/spectral_*`,
`scripts/spectral_common.py`, `scripts/build_transplit.py`, and the transplit/spectral tests.
Method: applied the pass-2 fix direction in `ts_masks`; re-ran the host gate until green.

## Bug 1 — Tilt gains go stale on a sample-rate change (GenExpr only) — FIXED

**Where:** `src/transplit_core.genexpr`, `ts_masks()` — the per-bin tilt-gain cache in
`tw` channel 2, keyed on the function-local History `cgTl / cgMd / cgN / cgW` (and now `cgSr`).

**Mechanism:** The gains were rebuilt only when tilt, tilt mode, FFT size `n`, or `cgW`
changed, where `cgW` is compared against `tw.peek(1, md)` — the tilt weight at **bin 1**,
used as a cheap probe for "the tilt table changed". But bin 1 is in the clipped region of
the table for every common configuration: its frequency `max(sr/n, 20)` is below 100 Hz
for sample rates 44.1-96 kHz at `n >= 1024`, so
`u = clip(log(f/100)/log(100), 0, 1) = 0` and the weight is pinned at -1 (Standard) /
+1 (Contour) regardless of sample rate. A sample-rate change rebuilt the tilt *table*
(the ctl hook in the same file tracks `twSr` and re-runs `ts_tilttab` for exactly this
case) but did **not** invalidate the cached *gains*, which were computed from the old
table. The wrong gains persisted until tilt, mode or size happened to change.

**Effect:** With Tilt non-zero, switching Live's sample rate (e.g. 44.1 <-> 48 <-> 96 kHz)
left the Transients/Tones tilt gains computed for the previous rate indefinitely.
Worked example (n = 1024, bin 64, Tilt = +1, Standard): weight 0.440 at 44.1 kHz vs
0.778 at 96 kHz, i.e. gain 1.837 vs the correct 2.930. The JS reference
(`cfg.tsMasks`) recomputes `exp(tl * 12 * w[k])` from the fresh table every frame, so
this was also a JS-vs-GenExpr mirror divergence.

**Red test (now green):** `tests/test_transplit.js`, section 2, "tilt gains follow the sample rate"
(drives `ts_tilttab` at 44100, one `ts_masks` frame, `ts_tilttab` at 96000 — exactly what
the ctl hook does on a rate change — then asserts `tw` channel 2 at bin 64).

**Fix applied (pass 3):** Added `History cgSr(0)` alongside the other `ts_masks` cache-
history vars, and included `cgSr != sr` in the rebuild condition with `cgSr = sr` inside
the rebuild block — mirroring the existing `twSr` pattern in the ctl hook. Keying on `sr`
invalidates the gains when the sample rate changes even though bin 1 stays clipped.

Touchpoints:
- `src/transplit_core.genexpr` — `History cgSr(0)` next to `cgW` in `ts_masks`
- `src/transplit_core.genexpr` — rebuild condition `... || cgSr != sr`; assign `cgSr = sr` in the rebuild block
- `tests/test_transplit.js:415` — assertion now passes (test left unchanged)

Commit SHA: `17d4b1b1347fd049e909e0a41e83c3d16b022416`

## Examined, no credible bug found

- Mask maths constants and helpers: JS named constants vs GenExpr literals (history
  rise/fall 0.014/0.040 s, onset 4.5 + 5.5 dB with bias 12, deviation 0.10/0.30 with bias
  0.12/0.27, tilt 12 dB, blend `min(1,2b)` / `min(1,2(1-b))`, smoothstep) — identical.
  Tilt tables (`tsTiltTables` vs `ts_tilttab`) — identical, incl. `log(100)` literal.
- Rack template reader/writer: signed centred counter differences (`ss2_wd`), slot
  arithmetic (`ss2_slot`), gap fade (256 in / 512 out), follower validity window
  (64 < age < RS-64), underrun -> fbk 3, `muteLeft = n + 128` restart muting with ring
  writes continuing so followers stay aligned — coherent.
- Serve/election: JS serve mask `(1<<K)-1` in a rack, gen `eserveH` forcing the own bit
  (`2^(selH-1)`, or bit K for All), `sAllCh` counting only real channels, DERIVE gating,
  epoch-change resets, leader election excluding fb=1 peers and dead-reported incumbents
  — consistent between `spectral_link.js`, the template and the tests.
- Telemetry layout: template scalars at SCB+0..+17 with +5 deliberately left for the
  device mean-mask slot; `transplit_config.js` TS_SC_* constants, the core header comment
  and the face reads (`tsPoll`, wave ring `frame mod 64`) all agree. Scope buffer 800 >=
  TS_SCOPE_SAMPS 786; ring buffer = `rack_ring_samps(2)`.
- Latency: every functional use is `RACK_LATENCY` = 5120 (gen reader/dry delay, scope
  slot, build line 216, `TS_LATENCY` displayed by the face).
- Sleep path: `ZERO_COUNT = 512` clears exactly the four display arrays; scalars are
  handled by explicit pokes; the face stops drawing on `awake = 0`.
- Face interaction: slider/drag mappings for Bias, Blend, Tilt, Decay, Smoothing match
  the parameter ranges and defaults; `tsResolveSel` maps Auto/Transients/Tones/All as
  documented.

## Non-functional notes (not bugs, no tests)

- `scripts/build_transplit.py` line 8 (docstring) and line 69 (Size help text) still say
  the latency is/stays 4096; the device actually delays and reports 5120 (see above).
  Prose only — Live-facing help for Size contradicts the face's own "Latency 5120 smp".
- `src/transplit_config.js` line 133 comment describes Contour as "+1 at the mids"; the
  code (and every other comment) is -1 at the centre, +1 at the edges.

## Pass 4 review

**Verdict: APPROVED** (no production follow-up).

- **Bug 1 (`cgSr`):** Minimal three-line GenExpr change (`History cgSr(0)`, `|| cgSr != sr`,
  `cgSr = sr` in the rebuild block). Correctly mirrors ctl-hook `twSr` / `ts_tilttab`.
  Bin-1 `cgW` probe stays clipped across SR at common n, so the SR key is necessary and
  sufficient. JS `tsMasks` recomputes `exp(tl * … * w[k])` every frame (no cache) — no
  remaining mirror gap. Red test left unchanged from pass 1 and is green.
- Diff vs main is only: BUGS.md, the red test (+17), `src/transplit_core.genexpr` (+3/-1),
  and rebuilt device artifacts. No drive-by refactors; tests not weakened.
- Non-functional prose notes (latency 4096 vs 5120 help text; Contour comment sign) left
  as notes — out of scope for this bugsweep.

## Commands / results

```
npm run -s typecheck && python3 scripts/build_transplit.py && node tests/test_transplit.js
# GREEN (pass 4 re-run): All Transient Split tests passed (incl. "tilt gains follow the sample rate")
node tests/spectral_link_tests.js      # passed (via test_transplit suite)
node tests/test_spectral_rack.js       # passed
node tests/test_spectral_dsp.js        # passed
```

Pass 1 committed the red test + this file; pass 2 confirmed the bug; pass 3 applied the
`cgSr` cache-key fix in `src/transplit_core.genexpr` and turned the host gate green;
pass 4 reviewed and approved with no further code changes.

# Analyzer (+ Oscilloscope shared tap) — Bug sweep

Worktree: `/private/tmp/bugsweep/analyzer-scope` · Branch: `bugsweep/analyzer-scope-pass1` · Base: `d72ee17`
Scope: `devices/Analyzer.amxd` — `scripts/build_analyzer.py`, `src/analyzer_ui.js`, `src/analyzer_config.js`, `src/analyzer_core.genexpr`, `src/analyzer_dsp.js`, `tests/test_analyzer.js`.
Shared in-tree concern (same tap name): `scripts/build_oscilloscope.py`, `src/oscilloscope_ui.js`, `tests/test_oscilloscope.js`.
Max / Live were NOT run in these passes (Node host gate only).

## Pass 4 review — APPROVED

Reviewed Pass 3 production/build/UI/docs + red tests against AGENTS.md precedents (Multiband Split `---mbsplitscope` / harness `#0-splitscope`; Delay+ `---dpxfer`; Glitch `---` names). Fix is minimal and correct; tests were strengthened (require `---analyzerscope`, reject literal `#0` in buffer/scope/setbuffer and `#0-` in v8ui/source), not weakened. Harness probes (`analyzer_probe.js`, `oscilloscope_probe.js`) and `run_*_audio_tests.py` remaining on `#0-analyzerscope` is intentional (mbsplit precedent). No follow-up code change.

Host gate (Pass 4 re-run, tip `0c75da7`):
```
npm run -s typecheck
python3 scripts/build_analyzer.py && node tests/test_analyzer.js
python3 scripts/build_oscilloscope.py && node tests/test_oscilloscope.js
→ green (analyzer: 185580 checks; oscilloscope: 163559 checks passed)
```

Not merged to main; worktree kept for coordinator.

## Pass 3 fix — Bug 1 closed (host gate green)

Applied the Pass 1/2 fix direction: rename the shipped scope tap from literal `#0-analyzerscope` to M4L per-instance `---analyzerscope` in Analyzer and Oscilloscope production/build/UI (and AGENTS.md §28). Harness probes and `run_*_audio_tests.py` left on `#0-analyzerscope` (mbsplit precedent).

### Touchpoints

- `scripts/build_analyzer.py` — `obj-buf` / `obj-msg-scope` / `obj-msg-setbuf` → `---analyzerscope`
- `scripts/build_oscilloscope.py` — same three boxes
- `src/analyzer_ui.js` — `anBufName = "---analyzerscope"`
- `src/oscilloscope_ui.js` — `anBufName = "---analyzerscope"`
- `src/analyzer_config.js` / `src/oscilloscope_config.js` — header comments
- `AGENTS.md` §28 / Oscilloscope architecture — document `---` name
- Rebuilt `devices/Analyzer.amxd`, `devices/Oscilloscope.amxd`

### Host gate (Pass 3)

```
npm run -s typecheck
python3 scripts/build_analyzer.py && node tests/test_analyzer.js
python3 scripts/build_oscilloscope.py && node tests/test_oscilloscope.js
→ green (analyzer: 185580 checks; oscilloscope: 163559 checks passed)
```

Pass 3 fix commit: `0c75da7` on `bugsweep/analyzer-scope-pass1` (not merged to main).

## Pass 2 review — kept 1 / dropped 0

Reviewed Pass 1 reds against source, AGENTS.md precedents (Multiband Split `---mbsplitscope`, Delay+ `---dpxfer`, Glitch `---` names), and a fresh host gate run. Bug 1 is a real multi-instance isolation failure; the Analyzer red still FAILS on unfixed code. No Pass 1 claims were dropped.

**Pass 1 miss closed here:** Oscilloscope ships the same literal `#0-analyzerscope` tap but had no device-structure red. Pass 2 adds matching `---analyzerscope` / no-`#0` asserts in `tests/test_oscilloscope.js` (still under Bug 1 — same defect class, not a new root cause).

Host gate (Analyzer) before Pass 3 fix:
```
npm run -s typecheck && python3 scripts/build_analyzer.py && node tests/test_analyzer.js
→ FAIL Analyzer.amxd: scope buffer is ---analyzerscope @samps 17952
```

Oscilloscope red (after `python3 scripts/build_oscilloscope.py`):
```
node tests/test_oscilloscope.js
→ FAIL Oscilloscope.amxd: scope buffer is ---analyzerscope @samps 17952
```
(or matching scope / setbuffer / no-literal-#0 / no-#0-in-v8ui / no-#0-in-source asserts)

## Pass 1 findings — kept 1

### Bug 1 — Scope buffer ships as literal `#0-analyzerscope` (Live does not expand `#0` in a top-level device)

**Severity:** multi-instance isolation failure. Every Analyzer (and every Oscilloscope, which shares the same tap name) in a Live Set binds the same global `buffer~` / scope ring. Instances overwrite each other's header, packet ring, stereo scope ring, and FFT ring — meters, spectrogram, and scope flash or freeze incorrectly when more than one device is loaded.

### Mechanism

- `scripts/build_analyzer.py` lines 65 / 69 / 70 shipped (pre-fix):
  - `buffer~ #0-analyzerscope @samps 17952`
  - `scope #0-analyzerscope`
  - `setbuffer #0-analyzerscope`
- `src/analyzer_ui.js` line 20 defaulted `var anBufName = "#0-analyzerscope";` (embedded into the face).
- Oscilloscope mirrored the same literals: `scripts/build_oscilloscope.py` 62 / 66 / 67 and `src/oscilloscope_ui.js` line 13.
- AGENTS.md (Multiband Split §11 buffer isolation fix; Delay+ §15; Glitch / Reverb+): in Live, `#0` is **not** expanded in a device's top-level patcher (only in abstractions). Per-instance isolation requires the M4L `---` prefix (e.g. `---mbsplitscope`, `---dpxfer`).
- Harness probes (`tests/analyzer_probe.js`, `tests/oscilloscope_probe.js`, wavload) intentionally keep `#0-analyzerscope` — same pattern as `mbsplit_probe.js` using `#0-splitscope` while the device uses `---`. Those are not the bug.

### Red tests

`tests/test_analyzer.js`, device-structure block for `Analyzer.amxd`:

- Require `obj-buf` / `obj-msg-scope` / `obj-msg-setbuf` to use `---analyzerscope` (and `@samps 17952` on the buffer).
- Reject any literal `#0` in those box texts.
- Reject `#0-` in the embedded v8ui script (stripping `//` comments), so the face default cannot stay `#0-analyzerscope`.

`tests/test_oscilloscope.js` (added in Pass 2), built-device block for `Oscilloscope.amxd`:

- Same `---analyzerscope` / no-literal-`#0` / no-`#0-` in v8ui and `oscilloscope_ui.js` source asserts.

### Fix direction (applied in Pass 3)

Rename the shipped tap to `---analyzerscope` in `build_analyzer.py` (buffer / scope / setbuffer) and `analyzer_ui.js` (`anBufName`). Mirror the same rename in Oscilloscope's build + UI. Leave harness probes on `#0-analyzerscope`. Update AGENTS.md §28 which still documents the old `#0-` name.

## Audited, no credible bug found

- **AnalyzerState blob** (`anBlob` / `anFromBlob` in `analyzer_config.js` 550 / 564; `getvalueof` / `setvalueof` in `analyzer_ui.js` ~1521+): version-1 array (mask, order, specType, scopeMode, scopeTime, trigger, f1/f2/f3) with clamp/fallback; round-trip covered by existing paint/blob checks.
- **Deferred DSP**: hub `gate 1 1`, no static `gen~`, plugin~ → plugout~ pass-through, embedded `GEN_DSP_TEXT` / `GEN_DSP_HASH` — existing structure tests cover this.
- **Presentation**: 169 px height, body panel last, Live-native `max.getcolor` over stale theme bus — existing tests.
- **Config / genexpr / paint helpers**: no additional DSP or UI defects with file:line evidence beyond the `#0` isolation bug.

#### Fix direction (NOT applied in Pass 1)

Clear `kCand` at the end of every calibration window that did not adopt (an `else` on the
acceptance `if`, or an unconditional reset after the adoption check), so adoption again
requires two consecutive accepted windows with the same lag.

## Audited / not filed

- Buffer / send names use `---` (`---rpxfer`, `---rphdr`, `---rpscope`, `---rpir`, …); the
  intentional `#0-rptest` receive is documented for the MCP test hook.
- GenExpr lint already covered by existing `test_reverbplus.js` (functions-first, one return,
  no nested poke calls, Param/buffer/header slot contracts).
- Face overlap / 169 px / wiring covered by layout builds inside the same host suite.
- No additional credible bugs found in a pass-1 pass over engine IR path, End K calib, and
  the existing host suite surface. Production code was not modified.

## Commands (host gate only)

```
npm run -s typecheck && python3 scripts/build_reverbplus.py && node tests/test_reverbplus.js && node tests/test_reverbplus_face.js
```

Expect the two new tests above to FAIL on unmodified HEAD; all prior tests should still PASS.

## Pass 2 review

Date: 2026-10-25. Reviewed both Pass-1 reds against current `src/`; host gate re-run on this worktree. Production / `src/` not modified.

- **Kept Bug 1** (`clear_ir` resurrection): confirmed. `clear_ir` never `outlet(4, "")`; Live replay via `dropfile` reloads the IR. Behavioral red stays; FAIL as expected.
- **Kept Bug 2** (End K calib): confirmed. `kCand` is cleared only in the `!alive` block, not when an acceptance window fails. Structural red stays; FAIL as expected.
- **Dropped:** none.
- Host gate: `python3 scripts/build_reverbplus.py` OK; `node tests/test_reverbplus.js` → 29 passed, 2 failed (exactly the two reds); `node tests/test_reverbplus_face.js` → 20 passed.

## Pass 3 fix

Date: 2026-10-25. Both kept reds fixed in production; host gate green. Tests unchanged.

- **Fixed Bug 1** (`clear_ir` resurrection): In `src/reverbplus_engine.js` `clear_ir()`, after `rpLastDropped = ""`, added `outlet(4, "")` so the IR File `live.drop` param is cleared and Live cannot replay the path on reload.
- **Fixed Bug 2** (End K calib): In `src/reverbplus_end.genexpr`, the acceptance `if` inside `if (cN >= 8192)` gained `else { kCand = 1e9; }` so a failed window clears the pending candidate (same shape as Delay+ End).
- Host gate: `python3 scripts/build_reverbplus.py` OK; `node tests/test_reverbplus.js` → 31 passed, 0 failed; `node tests/test_reverbplus_face.js` → 20 passed.

## Pass 4 review

Date: 2026-10-25. Final review of Pass-3 fixes against production diffs, red-test bodies, Delay+ End pattern, and a fresh host gate. No production adjustments.

- **Approved Bug 1** (`clear_ir` resurrection): `outlet(4, "")` after `rpLastDropped = ""` in `clear_ir()` is minimal and correct; red test still asserts Live-replay must not reload (behavioral, not weakened).
- **Approved Bug 2** (End K calib): `else { kCand = 1e9; }` matches Delay+ End acceptance-window shape exactly; structural red still requires the clear inside the window.
- Host gate: `npm run -s typecheck` OK (reverbplus-* configs included); `python3 scripts/build_reverbplus.py` OK; `node tests/test_reverbplus.js` → 31 passed, 0 failed; `node tests/test_reverbplus_face.js` → 20 passed. Tests unchanged. No merge / no worktree delete.

# Harmonic Split — Pass 1 bug sweep (bugsweep/harmsplit-pass1)

Scope: bug hunt + red tests ONLY, no fixes. Worktree /tmp/bugsweep/harmsplit at HEAD 66fea67.
Method: AGENTS.md sections 22+25 read in full; src/harmsplit_config.js (JS reference hsFrame), src/harmsplit_core.genexpr, src/harmsplit_ui.js, src/spectral_split_lib.genexpr, the rack template (spectral_split_rack_main), scripts/build_harmsplit.py and all existing harmsplit tests audited; JS-vs-genexpr fuzzing over n in {1024,2048,4096}, sr in {44100,48000}, saw/square/triangle/pulse/noise, Sens/tilt/threshold extremes, Max Harm values, and a mid-stream parameter switch.

## Pass 2 review — kept 1 / dropped 0

Re-checked BUG-1 against production sources and re-ran the host gate. No production/src edits in this pass.

- **Kept BUG-1** — real mirror/device divergence: ctl hook (`harmsplit_core.genexpr:644`) and UI paint (`harmsplit_ui.js:341`) round `hmaxp`; JS `hsFrame` (`harmsplit_config.js:261`) does not. Fractional Max Harm (>= .5) is reachable via automation / typed entry on the float control. Red `tests/test_harmsplit_maxh.js` drives the gen chain WITH ctl rounding (the real device path) and still fails on unfixed code (`AssertionError hmaxp=9.5 maxMaskDiff=1`). No rewrite needed. Rounding is device-specific (not in `spectral_split_lib.genexpr` / rack template).
- **Dropped:** none.

Host gate (Pass 2): `npm run -s typecheck && python3 scripts/build_harmsplit.py && node tests/test_harmsplit.js && node tests/test_harmsplit_face.js && node tests/test_harmsplit_paint_bounds.js` green; `node tests/test_harmsplit_maxh.js` RED as expected for the kept bug.

## Pass 3 fix — BUG-1 green

- **Fixed BUG-1** in `src/harmsplit_config.js` `hsFrame` (line 261): `hmx` on the `hmaxp >= 0.5` branch is now `hsClip(Math.round(p.hmaxp), 1, HS_MAXH)`, matching ctl (`harmsplit_core.genexpr:644` `clip(round(hmaxp), 1, 404)`) and UI (`hsMaxHarm` / `harmsplit_ui.js:341`). The `< 0.5 -> HS_MAXH` full-range branch is unchanged. Device ctl and UI were left alone (single source of truth = device rounding).
- Red `tests/test_harmsplit_maxh.js` kept as-is; now green (`All Harmonic Split Max Harm rounding tests passed`, maxMaskDiff < 1e-9 for 9 / 9.4 / 9.5 / 9.6 / 10 / 2.5 / 3.5).
- Host gate (Pass 3): `npm run -s typecheck && python3 scripts/build_harmsplit.py && node tests/test_harmsplit.js && node tests/test_harmsplit_maxh.js` green. Rebuild wrote `devices/Harmonic Split.amxd` / `.adg`.

## Pass 4 review — APPROVED

Independent re-review of `git log main..HEAD` / `git diff main...HEAD` (production/src/build focus) and re-ran the host gate on tip `a431e7f`. No production adjustments needed.

- **BUG-1 APPROVED** — one-line `hsFrame` fix in `src/harmsplit_config.js:261` is minimal and correct: `hmx = p.hmaxp < 0.5 ? HS_MAXH : hsClip(Math.round(p.hmaxp), 1, HS_MAXH)` matches ctl (`harmsplit_core.genexpr:644` `clip(round(hmaxp), 1, 404)`) and UI (`hsMaxHarm` / `harmsplit_ui.js:341`). Device ctl/UI left alone (device rounding is source of truth). Red `tests/test_harmsplit_maxh.js` kept as-is (not weakened). Diff touches only BUGS.md, device binaries, that one config line, and the new red test — no drive-by refactors; `spectral_split_lib.genexpr` / rack template untouched.
- Adjustments: none.

Host gate (Pass 4, re-run on tip `a431e7f`): `npm run -s typecheck && python3 scripts/build_harmsplit.py && node tests/test_harmsplit.js && node tests/test_harmsplit_maxh.js` green.

## BUG-1 — Fractional Max Harm: JS reference mirror does not round, device and UI do (RED TEST)

Severity: real mirror/device divergence; affects any fractional Max Harm value with fraction >= .5 (e.g. 9.5, 9.6, 2.5, 3.5), reachable because Max Harm is a float control (0..404, integer unit style) and fractional values arrive via automation / typed entry.

Evidence:
- Device path: src/harmsplit_core.genexpr ctl hook computes mxH = hmaxp < 0.5 ? 404 : clip(round(hmaxp), 1, 404) before hs_masks — it ROUNDS.
- UI paint: hsMaxHarm in src/harmsplit_ui.js also returns Math.round(hsVals.maxh).
- JS mirror: src/harmsplit_config.js sets hmx = p.hmaxp < 0.5 ? HS_MAXH : p.hmaxp with NO rounding, and the mask test compares integer h-prime against that unrounded limit (hp2 <= hmx). So for hmaxp = 9.6 the device tracks harmonics up to h-prime 10 while the mirror stops at 9.
- hsGenMessages in harmsplit_config.js sends hmaxp raw (['hmaxp', v.maxh]), so the fractional value really reaches both sides unrounded.
- AGENTS.md section 25 contract: hsFrame mirrors the genexpr line-for-line. Two of three surfaces round; the mirror is the odd one out. Pass 2 may fix either side, but they must agree; the red test pins the device (ctl-rounded) behaviour.

Why the existing suite missed it: every existing test hmaxp is an integer (0, 4, 8, 12, 30, 40), and tests/test_harmsplit.js passes p.hmaxp raw straight into gx.hs_masks, bypassing the ctl hook that performs the rounding in the real device path.

Red test: tests/test_harmsplit_maxh.js (new, self-contained, existing harness idiom). It drives the gen chain WITH the ctl conversion applied and asserts mask equality (tolerance 1e-9) against cfg.hsFrame for hmaxp in {9, 9.4, 9.5, 9.6, 10, 2.5, 3.5} on a 220 Hz saw, n=2048, sr=48000. Fuzzing beforehand showed integers and 9.4 agree (~2.3e-14) while 9.5 / 9.6 / 2.5 / 3.5 diverge with maxMaskDiff = 1.0 (a full mask flip at the boundary harmonic).

Verbatim red output (node tests/test_harmsplit_maxh.js, workdir /tmp/bugsweep/harmsplit):

AssertionError [ERR_ASSERTION]: hmaxp=9.5: JS mirror vs device (ctl-rounded) masks diverge, maxMaskDiff=1
    at Object.<anonymous> (/private/tmp/bugsweep/harmsplit/tests/test_harmsplit_maxh.js:59:12)
    code: 'ERR_ASSERTION', actual: false, expected: true

Baseline (same worktree, unchanged): node tests/test_harmsplit.js passes ('All spectral rack function tests passed', 'All spectral deferred-DSP tests passed'); tests/test_harmsplit_face.js and tests/test_harmsplit_paint_bounds.js pass ('7506 extreme scenarios drawn inside their regions, no text overlap').

Shared-framework flag: none for BUG-1 — the rounding lives in the device-specific ctl hook and device-specific config/UI, not in spectral_split_lib.genexpr or the shared rack template.

## Checked and found NOT bugs (no red tests, for the record)

- hst slots 25..29 asymmetry: the genexpr hs_prep cache key (n, sr, flo, fhi, tilt) lives in hst[25..29]; the JS mirror never maintains those slots (hsNewState zeroes a Float64Array(32), hsFrame drives only indices 0..24) and keeps its prep state elsewhere. The only genexpr reader of slots 25..29 is hs_prep's own cache-validity check; no telemetry, decision, salience or mask path consumes them. Fuzz masks matched to <= 8.1e-13 across sr/n/parameter switches including a mid-stream switch, so the cache behaviour is functionally equivalent. Benign mirror asymmetry, by design; the existing suite comparing hst[0..24] is correct.
- Mask/frame math generally: 12-case JS-vs-genexpr fuzz (n 1024/2048/4096, sr 44100/48000, five waveforms, Sens 0 and 1, Max Harm 1, tilt/threshold extremes, C1-square band case, mid-stream parameter switch) showed maxMaskDiff <= 8.1e-13 apart from BUG-1's fractional-Max-Harm cases.
- Rack sharing / derived channel: sumOneH=1 is set unconditionally in the ctl hook and hs_masks does guarantee NH + A + B = 1 per bin (B clipped to 1 - A, NH = 1 - A - B), so the template deriving the last served channel as input minus the others, and the All row as pure input, is sound. spectral_link serve bits (peers > 1 -> serve 7 for the leader) match section 22/25.
- Mix: kdry 1/3 per chain in the rack, 1 for Output = All, dry delayed by the same 5120 samples; rack sum equals mix * wet + (1 - mix) * dry as documented.
- Telemetry: HS_SC_* device slots 512..520 and template scalars at 528+ agree between config, core and UI polling; build_harmsplit.py ZERO_COUNT = 528, so sleep zeroing clears columns + device slots without touching the scalars base.
- UI / face: hsGenMessages conversions (hpat = index + 1, fftn = 1024 * 2^i, sensamt = (v - 1) / 99, mixamt = v * 0.01), header-first polling, asleep-leader empty analysis, and follower-reads-leader behaviour are all covered by tests/test_harmsplit_face.js and pass.
- ss_mid / ss_apply / ss_ola / ss_cols in spectral_split_lib.genexpr: amplitude/phase algebra verified against the test reference mirror; Hermitian mask application and Hann^2 compensation consistent; column pooling never includes bin 0 or Nyquist, matching the JS side.

# Cepstra bugsweep — PASS-4 review (bugsweep/cepstra-pass1)

## PASS-4 outcome

**APPROVED** — no code adjustments. Tip before this note: `947a8b1` (fix `750abf8`).

| Bug | Verdict | One-line |
| --- | --- | --- |
| A — stale f0 / display ignores `voiced` | **APPROVE** | `job_lift` resets `voiced=0` each frame; Auto/MIDI else clear `f0v`; display `periodSamplesNow` Auto requires `voiced`; paint/Res use helper. |
| B — shared `#0-cepscope` | **APPROVE** | `---` rename in build/display/amxd + AGENTS/audio/probe; tests require `---` (not weakened). |

Host gate re-run green: `npm run -s typecheck && python3 scripts/build_cepstra.py && node tests/test_cepstra.js` → 1627; `node tests/test_cepstra_bugsweep.js` → 15. No merge to main.

---

# Cepstra bugsweep — PASS-3 fixes (bugsweep/cepstra-pass1)

Host gate green after PASS 3: `npm run -s typecheck && python3 scripts/build_cepstra.py && node tests/test_cepstra.js` → 1627 checks; `node tests/test_cepstra_bugsweep.js` → 15 checks.

**Fix commit:** `750abf8` — `fix(cepstra): PASS-3 — clear stale f0 + ---cepscope isolation`.

## PASS-3 outcome

**Fixed 2 / kept from PASS-2.**

| Bug | Status | Touchpoints |
| --- | --- | --- |
| A — stale f0 / display ignores `voiced` | **FIXED** | `src/cepstra_core.genexpr` `job_lift` Auto/MIDI `else { f0v = 0; }`; `src/cepstra_display.js` `periodSamplesNow` requires `voiced` in Auto |
| B — shared `#0-cepscope` | **FIXED** | `scripts/build_cepstra.py` + display defaults + gen comment → `---cepscope`; `tests/test_cepstra.js` asserts; rebuilt `devices/Cepstra.amxd` |

### Bug A fix notes
- Gen Auto arm: after `if (best > 0.06) { … voiced = 1; }`, add `else { f0v = 0; }` so unvoiced frames clear scope 257 while still holding `L` / `held`.
- Gen MIDI arm: after `if (midiNote >= 0) { … }`, add `else { f0v = 0; }` for note-off.
- Display: `periodSamplesNow()` Auto branch is now `curMode === 1 && voiced && f0Hz > 20`. Paint diamond / Hz label and Res drag both go through that helper, so unvoiced → period 0 → manual Res map.

### Bug B fix notes
- Renamed `buffer~` / `scope` / `setbuffer` from `#0-cepscope` to `---cepscope` (Live expands `---` per instance; `#0` does not in a top-level device).
- `tests/test_cepstra.js`: exact message asserts + buffer~ isolation check now require `---`; sandbox setbuffer/resend use `---cepscope`.
- `tests/test_cepstra_bugsweep.js`: display sandbox prepends `cepstra_config.js` (face script shape) so RED paint checks can run after genexpr is green.
- Also updated `scripts/run_cepstra_audio_tests.py` `SCOPE` (and probe/AGENTS comments) so VM audio tests bind the new name.

### Host gate
```
npm run -s typecheck && python3 scripts/build_cepstra.py && node tests/test_cepstra.js && node tests/test_cepstra_bugsweep.js
```
→ green (1627 + 15). No merge to main (PASS 4 reviews next).

## PASS-2 review outcome (historical)

**Kept 2 / dropped 0.** See git `7a55961`.

| Bug | Verdict | One-line |
| --- | --- | --- |
| A — stale f0 / display ignores `voiced` | **KEEP** | Verified in `job_lift` Auto/MIDI arms + `periodSamplesNow` + green diamond paint; RED fails first assert on unfixed code. |
| B — shared `#0-cepscope` | **KEEP** | Build still ships `buffer~`/`scope #0-cepscope`; Multiband/Glitch/Reverb+/Amp+ `---` migration is the correct precedent. |

## Bug A — Auto / MIDI leave a stale f0 in scope 257; display pitch marker ignores `voiced`

**Where (pre-fix)**
- `src/cepstra_core.genexpr` — `job_lift` (~L130–185)
- `src/cepstra_display.js` — `periodSamplesNow` (~L400–403) and the Auto/MIDI pitch diamond paint (~L619–625)

**Contract**
- Gen header: `257 : f0 estimate in Hz (0 = unvoiced / unknown)`; `261 : voiced flag`.
- AGENTS (Cepstra): Auto holds **L** when unvoiced (`L = k * period` held); it does **not** say f0 is held.

**RED**
`tests/test_cepstra_bugsweep.js` — genexpr static checks + display sandbox (Auto + unvoiced + stale f0).

## Bug B — `#0-cepscope` is shared across every Cepstra instance in Live

**Where (pre-fix)**
- `scripts/build_cepstra.py` — `buffer~ #0-cepscope`, `scope #0-cepscope`
- `src/cepstra_display.js` — default `#0-cepscope` binding path

**Contract / precedent**
AGENTS.md Multiband/Glitch/Reverb+/Amp+ `---` isolation.

**RED**
`tests/test_cepstra_bugsweep.js` — build/display/amxd must bind `---cepscope`.

# Envelope Trigger — bugsweep (PASS 4 APPROVED)

## Bug 1: Scope buffer uses `#0-trigscope` (not instance-isolated in Live) — FIXED

**PASS 4 decision:** APPROVED. Reviewed 2026-10-25 against tip `cf0b82f` (fix `aafec96`):
- Diff vs main is minimal and correct: production rename in `scripts/build_envtrig.py` (`buffer~` / `setbuffer` / `scope` `#0-trigscope` → `---trigscope`), matching comment updates in `src/envtrig_core.genexpr` / `src/envtrig_config.js` / `src/envtrig_dsp.js`, `tests/test_envtrig.js` name asserts flipped to `---trigscope` with a necessary (not weakened) exception in the generic `buffer~` loop for this shared scope buffer; `tests/test_envtrig_bugsweep.js` left strict (still rejects `#0-trigscope`).
- No leftover `#0-trigscope` in production/src/build (only this BUGS.md narrative and the out-of-scope `scripts/run_envtrig_audio_tests.py` harness).
- GenExpr still declares `Buffer scope("trigscope")` and binds via the `scope ---trigscope` message; UI `setbuffer ---trigscope` is the other consumer — matches AGENTS precedents (`---mbsplitscope` / `---glitchscope` / `---rpscope`).
- Host gate re-run green on Pass 4: `npm run -s typecheck && python3 scripts/build_envtrig.py && node tests/test_envtrig.js && node tests/test_envtrig_bugsweep.js` → Built `devices/Envelope Trigger.amxd` [228/342x169 px] (161476 bytes); both node suites ok.
- No drive-by refactors; dirty harness left untouched. No production follow-up.

**PASS 3 decision:** FIXED (was High). Verified 2026-10-25 against fixed production:
- `node tests/test_envtrig_bugsweep.js` → PASS (expects `buffer~ ---trigscope` / rejects `#0-trigscope`).
- `node tests/test_envtrig.js` → PASS (asserts `---trigscope`; generic `buffer~` loop allows `#0-` or `---trigscope`).
- Host gate green: `npm run -s typecheck && python3 scripts/build_envtrig.py && node tests/test_envtrig.js && node tests/test_envtrig_bugsweep.js`.
- Built `devices/Envelope Trigger.amxd` [228/342x169 px] (161476 bytes).
- AGENTS.md precedents (Multiband Split `---mbsplitscope`, Glitch `---glitchscope`, Reverb+ `---rpscope`): `#0` is not expanded in a top-level M4L device patcher in Live.

**Severity:** High (multi-instance correctness) — resolved.

**Fix:** Renamed the production scope telemetry buffer from `#0-trigscope` to M4L `---trigscope`. Kept GenExpr `Buffer scope("trigscope")` and bind with `scope ---trigscope`.

**Touchpoints:**
- `scripts/build_envtrig.py` (~421–424): `buffer~ ---trigscope @samps …`, `setbuffer ---trigscope`, `scope ---trigscope`.
- `src/envtrig_core.genexpr`: docs/comments → `---trigscope` (bind message `scope ---trigscope`).
- `src/envtrig_config.js` / `src/envtrig_dsp.js`: docs → `---trigscope`.
- `tests/test_envtrig.js`: name-specific asserts expect `---trigscope`; generic `buffer~` prefix loop allows `#0-` or `---trigscope` for the shared scope telemetry buffer.
- `tests/test_envtrig_bugsweep.js`: left unchanged (RED → green on fixed production).

**Out of scope (unchanged):** `scripts/run_envtrig_audio_tests.py` harness `#0-trigscope` (lives in an abstraction); AGENTS.md historical Envelope Trigger docs.

**Commit SHA:** aafec96 on `bugsweep/envelope-trigger-pass1` (Pass 4 review commit follows).

---

PASS 2 re-checked the pass-1 conclusion: no other credible production bugs confirmed in `src/envtrig_*.js`, `src/envtrig_core.genexpr`, `scripts/build_envtrig.py`, and `tests/test_envtrig.js` against AGENTS §1 / §12 (DSP/GenExpr rules, presentation overlap, int>255, getvalueof panel latch, theme) and the instance-isolation (`#0` vs `---` ) rule. The shared `receive envtrig-test` hook is intentional for the Max/Live harness and is left as-is.

# Loud Split — Pass 1 bug hunt (red tests only, no fixes)

Branch: `bugsweep/loudsplit-pass1` · Worktree: `/tmp/bugsweep/loudsplit`

## BUG 1 — Mix dry share is 1/3 for a standalone single-channel Output (should be full dry)

**Severity:** audible level error in a documented configuration.

**Symptom.** A standalone Loud Split (not in the `.adg` rack) with `Output` set to
Loud, Mid or Quiet and `Mix` below 100 % outputs `(1 - mix) * dry / 3` instead of
`(1 - mix) * dry`. The dry component is ~9.5 dB low; at `Mix = 0 %` the device
outputs `dry / 3` instead of passing the dry signal through. `Output = All` (or
`Auto` outside a rack) is unaffected.

**Contract (AGENTS.md §24, “Mix”).** “Each instance outputs
`mix * wet_own + (1 - mix) * dry / K` … `K = 3` when one chain of a rack
(outsel 1..3), `K = 1` for Output All / outside a rack, so the rack sum is
`mix * wet + (1 - mix) * dry`.” The JS reference agrees:
`lsMixOut(wetOwn, dry, mix, k) = mix * wetOwn + (1 - mix) * dry / k`
(`src/loudsplit_config.js:90`), with `k` = the number of summed outputs.

**Root cause.** `src/spectral_split_rack_main.genexpr:480`:

```
kShare = selH > 0.5 ? @@KSHARE@@ : 1;
ov1 = fixnan(fixdenorm(mixS * wetL + (1 - mixS) * kShare * dryL.read(@@LAT@@)));
```

`@@KSHARE@@` is substituted as `repr(1.0 / k)` (= 1/3 for K = 3) by
`scripts/spectral_common.py:256`. The share is keyed **only** on `selH`, the
resolved output selection (`selH = clip(floor(outsel + 0.5), 0, K)`, ctl hook
line 158). No rack-presence / peer term reaches the mix: the template does track
served channels (`serveH` / `eserveH` / `allc` → `sAllCh`), but `sAllCh` feeds
only the DERIVE shortcut (line 303). Inside the rack the behaviour is correct by
accident of summation — each of the three chains selects its own channel and
contributes `dry / 3`, summing to full dry. A lone device has nothing to sum
with, so the share must be 1.

**Shared-framework flag.** The fault lives in the shared rack template
(`src/spectral_split_rack_main.genexpr`) and the shared build substitution
(`scripts/spectral_common.py`), not in Loud Split–specific code. Every device
built on the same template (the spectral split suite: Transient Split, Harmonic
Split, Freq Split, Multiband Split, …) presumably has the same standalone
single-channel Mix bug and should be checked in its own pass.

**Red test.** `tests/test_loudsplit.js`, §5 (after the existing Mix sum identity):
a model anchor (`lsMixOut(..., 1)` keeps full dry — passes; the JS reference is
correct) plus the failing assertion that the expanded gen must not contain a
selection-only share of the form `kShare = selH > 0.5 ? …`. Pass 2 strengthened
the match from the exact float literal to `/kShare\s*=\s*selH\s*>\s*0\.5\s*\?/`
so a repr change cannot green the test without a real fix (still fails at :699).

```
$ node tests/test_loudsplit.js
[ref] … passed
[genexpr] transpiled lib + ls_* tests passed
[lint] genexpr lint and link module tests passed
[device] built device and rack preset checks passed
AssertionError [ERR_ASSERTION]: gen dry share keys on selH alone (kShare = 1/K
for any single-channel Output): a standalone device with Output Loud / Mid /
Quiet must keep K = 1
    at Object.<anonymous> (tests/test_loudsplit.js:699:12)
```

## Pass 2 review (kept 1 / dropped 0)

- **KEEP Bug 1** — real audible DSP bug: standalone single-channel Output wrongly
  gets dry / 3. Confirmed against AGENTS.md §24 Mix (`K = 1` outside a rack),
  `lsMixOut(..., k=1)`, and live `gen_code()` still emitting
  `kShare = selH > 0.5 ? 0.3333333333333333 : 1;` (`roleH` / `serveH` unused at
  Mix). Strengthened the red regex as above. Host gate
  `npm run -s typecheck && python3 scripts/build_loudsplit.py && node tests/test_loudsplit.js`
  still fails on this assert only (typecheck + build pass). No production/src
  edits this pass; dirty `devices/Loud Split.{amxd,adg}` left uncommitted.

## Pass 3 fix (Bug 1)

**Fix.** `src/spectral_split_rack_main.genexpr` Mix line: gate `@@KSHARE@@` on rack
role as well as channel selection:

```
kShare = (selH > 0.5 && roleH > 0.5) ? @@KSHARE@@ : 1;
```

`roleH > 0.5` is LEAD (1) or FOLLOW (2) — this instance is one chain of a rack.
`roleH` SELF (0) / pending (−1) keeps full dry even when Output is Loud / Mid /
Quiet, matching AGENTS.md §24 (`K = 1` outside a rack). Rack single-channel
Output still uses `1/K` so the three chains sum to full dry.

**Touchpoints.** `src/spectral_split_rack_main.genexpr` (Mix comment + `kShare`
expression). Rebuild refreshed `devices/Loud Split.{amxd,adg}`.

**Host gate.** `npm run -s typecheck && python3 scripts/build_loudsplit.py &&
node tests/test_loudsplit.js` — green (Mix red assert at
`tests/test_loudsplit.js:699` no longer matches the expanded gen; all Loud Split /
spectral rack / deferred-DSP / paint-bounds checks passed). Red test left
unchanged.

**Shared-framework note.** Same template is used by the other spectral-split
devices; their own passes should adopt / verify the same Mix gate (e.g.
`tests/test_freqsplit.js` still expects the old `selH`-only form).

## Pass 4 review (approved 1 / adjusted 0)

- **APPROVE Bug 1** — fix is minimal and correct. `roleH = clip(floor(role + 0.5), -1, 2)` with
  SELF=0 / LEAD=1 / FOLLOW=2 / pending=−1; `roleH > 0.5` therefore means LEAD or FOLLOW (in a
  rack). Combined with `selH > 0.5`, `kShare` is `1/K` only for a single-channel Output on a rack
  chain; Output All (`selH = 0`) and SELF/pending (outside a rack) keep full dry — matches
  AGENTS.md §22/§24 Mix and `lsMixOut(..., k=1)`. Red regex still forbids the old selH-only form;
  no drive-by refactors. Host gate green after rebuild.

## Checked and found correct (do not re-hunt)

- `lsMasks` (JS) vs `ls_masks` (genexpr) mirror: tilt table, lmax excluding bins
  0 and half, relative floor −150, Rise/Fall coefficient, smoothstep knees,
  `lo = min(tlo, thi)`, masks sum to 1 — identical.
- Latency: `LS_LATENCY` 5120 everywhere (patcher attribute, dry delay, tests);
  the “4096” in §22 is the suite’s generic hop wording, not this device.
- Parameter tables: build NUM/ENUM/GEN_MSG vs `LS_PARAMS` / `LS_ENUMS` /
  `LS_GEN_PARAMS` — ranges and initials all match; gen Param defaults match.
- Telemetry scope: channel rows (Loud 2, Mid 3, Quiet 4, sum 5), `LS_SC_*`
  offsets, 512 telemetry columns zeroed on sleep.
- `sAge` resets (template lines 266 / 296) match the documented restart
  semantics (“age = frames since the state was (re)started”); the JS model
  restarts age with a fresh state the same way.
- `ss_cols` bin-edge rounding vs `lsColBin`: documented as matching for the
  sizes used; covered by existing tests.
- UI maths: threshold / knee / Rise / Fall / Tilt drag mappings, `lsEffLo`
  clamp, solo override in `lsEmitSel`, UI defaults vs the parameter tables.

# Degrade — Bug Sweep (Pass 1 reds + Pass 2 review)

Device: `devices/Degrade.amxd` · Worktree: `/tmp/bugsweep/degrade` · Branch: `bugsweep/degrade-pass1`
Tests: `tests/test_degrade.js`, new section 5 ("BUGSWEEP PASS 1").
Command: `node tests/test_degrade.js`

## Pass 4 review (ADJUSTED)

Re-checked each Pass 3 fix against production sources, JS mirror, and section-5
reds. Host gate green after follow-up:
`npm run -s typecheck && python3 scripts/build_degrade.py && node tests/test_degrade.js`
→ `All Degrade unit, GenExpr, layout, patchline, and v8ui tests passed!`
No test rewrites. No merge to main.

| Bug | Verdict |
|-----|---------|
| **D1** | APPROVED — `ulaw_compand` / `alaw_compand` use `round(comp * qSteps) / qSteps`; `quant_steps` left for BIT |
| **D2** | ADJUSTED — logic already correct (soft-clip wet sans gain; `outGainSlew` on summed outs); synced stale L1209– comment that still described `tanh(sig * outGainSlew)` |
| **D3** | APPROVED — equal-power `sin`/`cos(asin)` mix matches PARAM_SPECS |
| **D4** | APPROVED — `set_mix` falsy default `0`, consistent with other percent setters |

## Pass 3 fixes (all 4 green)

Host gate green: `npm run -s typecheck && python3 scripts/build_degrade.py && node tests/test_degrade.js`
→ `All Degrade unit, GenExpr, layout, patchline, and v8ui tests passed!`
No test rewrites. Production/src + rebuilt `devices/Degrade.amxd` only.

| Bug | Fix | Touchpoints |
|-----|-----|-------------|
| **D1** | u-Law/A-Law now quantize with `round(comp * qSteps) / qSteps` (match JS mirror); leave `quant_steps` alone for BIT | `src/degrade_core.genexpr` `ulaw_compand` L58, `alaw_compand` L73 |
| **D2** | Soft-clip wet without master gain; apply `outGainSlew` on the summed dry+wet outs | `src/degrade_core.genexpr` L1217–1226 |
| **D3** | Equal-power mix: `cWetG = sin(clip(wet)·π/2)`, `cDryG = cos(asin(cWetG))` | `src/degrade_core.genexpr` L437–438 |
| **D4** | `set_mix` falsy default `100` → `0`, matching other percent setters | `src/degrade_ui.js` L312 |

Fix commit SHA: `1a0dc4c`.

## Pass 2 review (keep all 4 — no drops)

Re-checked each claim against production sources and re-ran the host suite.
Kept: **D1, D2, D3, D4**. Dropped: none. No test rewrites; reds already fail
on unfixed code. No production/src edits (pass 3).

Verified red (full suite, Pass 2):
`BUG D1: gen A-Law compand must match the JS mirror quantization step (qSteps=64, x=0.1): gen=0.10824942325064496 mirror=0.09937750651761865`

---

## Pass 1 notes

Verification method: the committed suite fails first at D1 (asserts run in order).
D2–D4 were each additionally captured red on their own in a throwaway scratch
copy (`/tmp/degrade-probe`) with only the preceding new asserts neutralized;
the committed test file was never altered by those probes. No production code
was changed in this pass.

---

## D1 — Gen telecom companders quantize 2× coarser than the JS mirror

- **Where:** `src/degrade_core.genexpr` — `quant_steps()` (lines 39–43),
  `ulaw_compand()` (53–62), `alaw_compand()` (64–80); mirror in
  `src/degrade_config.js` `processTelecomSample()` (157–187).
- **Root cause:** both sides compute the same `qSteps`
  (`max(4, round(64 − line·56))` in JS, line 162). The JS mirror quantizes the
  companded value with `round(comp * qSteps) / qSteps` (lines 168, 179). The
  gen helpers instead route through `quant_steps()`, which quantizes with
  `round(x * steps/2) / (steps/2)` — half the multiplier — so the shipped DSP
  staircase is twice as coarse as the mirror/UI simulation at every Line
  value. (The BIT caller is the one correct `quant_steps` user: there
  `steps = 2^bits` is a total level count across [−1, 1], matching the JS bit
  quantizer.)
- **Impact:** u-Law/A-Law telephone degradation in the real device is
  audibly coarser than designed/simulated; at coarse steps the gen grid can
  even round a companded value to full scale where the mirror does not.
- **Red test:** executes the actual gen helper functions (transpiled
  GenExpr→JS) against the mirror formulas, qSteps ∈ {64, 32, 8},
  x ∈ {0.42, −0.42, 0.1, 0.83}, tolerance 1e-6 (deliberately above the
  ~2.4e-8 noise from the gen helpers truncated decimal constants, far below
  any quantization-step gap).
- **Red output (full suite):**
  `BUG D1: gen A-Law compand must match the JS mirror quantization step (qSteps=64, x=0.1): gen=0.10824942325064496 mirror=0.09937750651761865`
  (companded 0.5793 rounds to 19/32 on the gen grid vs 37/64 on the mirror grid.)
- **Secondary observation (not separately red-tested):** the GSM branch has
  its own grid drift — gen `max(3, 22 − line·18)` vs JS `max(3, 24 − amt·20)`
  — on top of the same `quant_steps` halving.

## D2 — Master Output gain never reaches the dry path

- **Where:** `src/degrade_core.genexpr` lines 1217–1226;
  `scripts/build_degrade.py` documents `out_gain` as "Master output
  drive/trim in dB before final soft ceiling".
- **Root cause:** `outGainSlew` is applied only inside `wetOutL`/`wetOutR`.
  The summed outputs are `outL = in1 * cDryG + wetOutL * cWetG;` (and R) with
  no master gain.
- **Impact:** at Mix = 0% the Output knob does nothing at all; at Mix = 50%
  a +6 dB Output setting delivers only 0.5 + 0.5·2 = 1.5× (+3.5 dB).
- **Red output (scratch probe):**
  `BUG D2: master out_gain must scale the summed dry+wet output (L), got: outL = in1 * cDryG + wetOutL * cWetG;`

## D3 — Mix law is linear, not the documented equal-power law

- **Where:** `src/degrade_core.genexpr` lines 437–438;
  `scripts/build_degrade.py` `PARAM_SPECS` documents Mix as
  "Equal-power dry/wet mix".
- **Root cause:** the gen cache computes `cWetG = clip(wetSlew, 0.0, 1.0);`
  and `cDryG = 1.0 - cWetG;` — a linear crossfade, with no sin/cos anywhere.
- **Impact:** −3 dB dip for decorrelated wet content at Mix = 50%, contrary
  to the documented equal-power behaviour.
- **Red output (scratch probe):**
  `BUG D3: cWetG must be an equal-power (sin) gain, got: cWetG = clip(wetSlew, 0.0, 1.0);`

## D4 — `set_mix(0)` mirrors Mix as 100% wet in the v8ui

- **Where:** `src/degrade_ui.js` line 312.
- **Root cause:** `set_mix` uses `clamp((Number(v) || 100) / 100.0, 0, 1)`.
  Every other percent setter in the file uses `(Number(v) || 0) / 100`, so the
  legitimate in-range value Mix = 0% (fully dry) is falsy-coerced to 100.
- **Impact:** the UI mirror `curWet` becomes 1.0 at Mix = 0; change detection
  also breaks — after `set_mix(100)`, a following `set_mix(0)` reports no
  change and skips redraw.
- **Red output (scratch probe):** after `set_mix(100)` (curWet = 1.0, as
  expected), `set_mix(0)` fails with
  `BUG D4: set_mix(0) must mirror curWet = 0.0 (fully dry), not 1.0` — `1 !== 0`.

# Theme Editor — Pass 1 Bug Hunt

Branch: bugsweep/theme-editor-pass1. Worktree: /tmp/bugsweep/theme-editor (at main HEAD 66fea67, clean before this pass).
Scope: devices/Theme Editor.amxd plus src/theme_engine.js, src/theme_editor_node.js, src/theme_editor_ui.js, src/theme_editor_web.html, scripts/build_theme_editor.py, scripts/theme_common.py, tests/test_theme_editor.js.
Method: source audit, then one red test per credible bug in the existing suite style. No fixes in this pass.

Baseline: node tests/test_theme_editor.js — all 9 checks PASS, exit 0.
Red suite: node tests/test_theme_editor_bugs.js — 0 passed, 6 failed, exit 1.

## Bug 1 — m4lSetThemeState stores NaN for non-numeric satScale/contrast, and a JSON round trip decays it to 0

Location: src/theme_engine.js, m4lSetThemeState (macro parsing).

hueShift and brightness are parsed as Number(x) || 0, so bad input falls back to the default. satScale and contrast only special-case undefined and otherwise store Number(value) unchecked, so a non-numeric value (a string from a hand-edited state file or an API client, an object, null after a round trip) is stored as NaN.

Ingress paths are real: the node server loadStateFromDisk performs no sanitation of ~/.m4l_theme_state.json before broadcasting it, POST /api/state accepts arbitrary JSON, and the v8ui theme_sync handler feeds parsed JSON straight into m4lSetThemeState.

The damage compounds through serialisation: JSON.stringify writes NaN as null (bus stateJson, the getvalueof blob, the node disk file), and the next m4lSetThemeState computes Number(null) === 0. One bad Saturation value therefore becomes a permanent satScale of 0 in the saved state — every themed device renders fully desaturated until the state is repaired by hand.

Red evidence:
- satScale must fall back to 1.0, not NaN (NaN !== 1)
- satScale after a JSON round trip must be 1.0, not 0 (0 !== 1)

## Bug 2 — m4lApplyMacros maps a null alpha to fully transparent

Location: src/theme_engine.js, m4lApplyMacros.

When a colour array has a fourth element, alpha is m4lClamp(Number(col[3]), 0, 1). Number(null) is 0, so a token with an explicit null alpha (or a NaN alpha that JSON.stringify turned into null) comes out fully transparent. m4lColor and m4lMixColor treat a missing fourth element as opaque 1.0 and pass a present fourth element through without Number(); m4lMapRgba shares the same Number(a) coercion for a present null (`a === undefined ? 1.0 : Number(a)`), so the original "this one site" wording was slightly overstated. The functional defect still stands: a null alpha becoming fully invisible is a bad failure mode for JSON-revived or hand-edited colour tokens, and it contradicts the missing→opaque convention used by m4lColor / m4lMixColor. (Bug 1's NaN→null→0 chain is about satScale/contrast macros, not colour alphas; the two bugs share the JSON null decay pattern but are otherwise independent.)

Red evidence:
- a null alpha (what JSON produces from NaN) must fall back to opaque 1.0 (0 !== 1)

## Bug 3 — The node server replaces the whole theme state on update, dropping every field it was not sent

Location: src/theme_editor_node.js, the POST /api/state handler and the sync_state Max handler, persisted by saveStateToDisk.

Both ingress paths assign the parsed body wholesale (currentState = next / currentState = parsed) and immediately save and broadcast the result. A partial update therefore deletes the fields it does not mention: posting { preset: "Cyber Cyan" } — a shape the existing verification suite itself uses — silently removes abletonUi, customPresets and deviceOverrides from the served state and from ~/.m4l_theme_state.json, and posting { macros: { hueShift: 25 } } removes satScale, contrast and brightness from the macros object. loadStateFromDisk cannot heal this: it merges only at the top level on restart and replaces nested objects wholesale, so the loss is permanent. The engine-side m4lSetThemeState demonstrates the intended pattern — it merges the incoming state into defaults field by field. The node hub, which owns persistence, does not.

Red evidence:
- abletonUi must survive a partial POST
- satScale must not be dropped by a partial macros POST (undefined !== 1)
- the on-disk state file must keep abletonUi

## Investigated and not counted as bugs

- Preset switching clears token overrides in both the v8ui (onclick) and the WebUI (preset buttons): identical on both surfaces, treated as deliberate design.
- The candidate grids in m4lEstimateAbletonUiSettings (brightness, intensity, hue) are coarse by design and the function reports rmse.
- m4lRgbKey quantises to 1/1000; the comment documents this and the existing suite covers the no-double-mapping behaviour.
- WebUI hexToRgba always returns alpha 1.0, but its only caller is an input type=color element, which has no alpha channel; worth revisiting only if an alpha-capable editor is added.
- teBroadcastState republishes state (incrementing its version) on every macro drag frame: a batching and undo-granularity improvement for a future pass, not a correctness bug.

## Commands and results

- node tests/test_theme_editor_bugs.js → exit 0, 6 passed / 0 failed (green after Pass 3 fixes)
- npm run -s typecheck && node tests/test_theme_editor.js → exit 0, all 9 checks PASS (host gate)

## Pass 2 review (kept all three)

Reviewed against source on tip 3cb1c01. All three claims are real functional/state bugs; none dropped. No production/src fixes in this pass.

- Bug 1 KEEP — satScale/contrast store `Number(x)` with no NaN fallback while hueShift/brightness use `Number(x) || 0` (m4lSetThemeState ~3482–3483). JSON round-trip NaN→null→0 permanently desaturates themed devices.
- Bug 2 KEEP — m4lApplyMacros null alpha → 0 is a real failure mode. Softened the "one site" consistency claim above (m4lMapRgba also Number()-coerces a present null); the missing→opaque convention of m4lColor/m4lMixColor still makes this a bug. Bug 1 linkage is about macros, not colour alphas.
- Bug 3 KEEP — POST /api/state and sync_state assign `currentState` wholesale; partial bodies drop abletonUi/customPresets/sibling macros. Confirmed in theme_editor_node.js.

Red suite re-run on unfixed code: `node tests/test_theme_editor_bugs.js` → 0 passed, 6 failed, exit 1 (expected).

## Pass 3 fixes

Fixed all three kept bugs on `bugsweep/theme-editor-pass1`. Red suite and host gate green. Pass 3 commit: `d7aa9c2`.

- Bug 1 FIXED — `src/theme_engine.js` `m4lSetThemeState` (~3482–3483): satScale/contrast now fall back to 1.0 when the value is `undefined`, `null`, or non-finite after `Number(...)`, matching the hueShift/brightness defaulting style and blocking the NaN→null→0 desaturate path.
- Bug 2 FIXED — `src/theme_engine.js` `m4lApplyMacros` (~3604): alpha only Number/clamps when the fourth element is present, non-null, and finite; otherwise opaque 1.0 (same missing→opaque convention as `m4lColor` / `m4lMixColor`).
- Bug 3 FIXED — `src/theme_editor_node.js`: added `mergeThemeState(prev, patch)` (~330) that shallow-merges top-level fields and deep-merges `macros` / `tokens` / `deviceOverrides` / `customPresets` / `abletonUi`. Wired into `sync_state` (~355) and POST `/api/state` (~433) so partial updates no longer wipe sibling state or the on-disk file.

## Pass 4 review — APPROVED

Reviewed production diffs on tip `4839b74` (Pass 3 fix `d7aa9c2` + BUGS SHA note). Host gate re-run green: `npm run -s typecheck` + `node tests/test_theme_editor.js` (9/9) + `node tests/test_theme_editor_bugs.js` (6/6). No production adjustments.

- Bug 1 APPROVED — `m4lSetThemeState` satScale/contrast fall back to 1.0 on undefined/null/non-finite; blocks NaN→null→0 desaturate; keeps intentional 0.
- Bug 2 APPROVED — `m4lApplyMacros` treats null/non-finite alpha as opaque 1.0; matches m4lColor/m4lMixColor missing→opaque.
- Bug 3 APPROVED — `mergeThemeState` deep-merges nested theme fields on sync_state and POST /api/state; partial bodies no longer wipe siblings or disk state.

# XO Sample Map — Pass 1–4 bug sweep

Branch: `bugsweep/xo-map-pass1` · Worktree: `/private/tmp/bugsweep/xo-map`
Scope: `src/xo_node_engine.js`, `src/xo_strip_ui.js`, `src/xo_search.js`, `src/xo_stretch.js`,
`scripts/build_xo_map.py`, `tests/test_xo_*.js`. One credible bug found (Pass 1); Pass 2 kept it; Pass 3 fixed it; Pass 4 approved.

## Pass 4 — review (APPROVED)

- **Bug 1:** APPROVED. Fix is minimal and correct: `captureSnapshot` / `applySnapshot` now cover all seven
  playback fields that `recallSavedEntry` assigns (`pitchSt`, `decayMs`, `gainDb`, `reversePlayback`,
  `speedPct`, `grainMs`, `stretchMode`) with `!== undefined` defaults `0` / `100` / `45` / `1` matching recall.
  Red test left unchanged and still isolates the four previously-missing fields. No drive-by refactors;
  no test weakening. Host gate re-run green on tip `5ddf91c` (`npm run -s typecheck && python3 scripts/build_xo_map.py && node tests/test_xo_map.js`, including `OK: undo after recall restores all playback settings`). No production code changes in Pass 4.

## Pass 3 — fixed

### Bug 1 — FIXED (undo after saved-sample recall restores all 7 playback settings)

- **Touchpoints:** `src/xo_strip_ui.js` — `captureSnapshot()` (~649) and `applySnapshot()` (~666).
  Added `reversePlayback`, `speedPct`, `grainMs`, `stretchMode` to the snapshot object and restore
  them with `!== undefined` defaults `0` / `100` / `45` / `1` (matching `recallSavedEntry`).
- Red test left unchanged: `tests/test_xo_map.js` block "Undo after recalling a saved sample restores ALL playback settings".
- **Host gate green:** `npm run -s typecheck && python3 scripts/build_xo_map.py && node tests/test_xo_map.js`
  (includes `OK: undo after recall restores all playback settings`). Rebuilt `devices/XO Sample Map.amxd`.
- Commit SHA: `5ddf91c`.

## Bug 1 — Undo after recalling a saved sample only restores 3 of the 7 playback settings it changed (was KEEP; fixed in Pass 3)

**Where:** `src/xo_strip_ui.js`
- `captureSnapshot()` (~line 649) / `applySnapshot()` (~line 666) save and restore:
  `activeCategory, maxLenMs, toneFilter, searchQuery, pitchSt, decayMs, gainDb,
  selectedIndex, anchorIndex, selectedSavedIndex, savedScrollOffset, savedList`.
- `recallSavedEntry()` (~line 1378) assigns **seven** playback fields from the entry:
  `pitchSt, decayMs, gainDb, reversePlayback, speedPct, grainMs, stretchMode`
  and outlets them as `recalled_settings`.
- Clicking a saved row pushes an undo snapshot immediately before recalling
  (`onclick`, ~line 2011: `pushUndoState(); recallSavedEntry(actualIdx);`),
  so the recall is explicitly meant to be undoable.

**Effect:** Undo after a recall restores pitch/decay/gain to their pre-recall values but
silently leaves **Reverse, Speed, Grain and Stretch Mode** at the recalled sample values —
an inconsistent half-reverted state. (`save_selected()` entries capture all seven fields,
so the snapshot pair is the odd one out.)

**Red test:** `tests/test_xo_map.js`, block "Undo after recalling a saved sample restores
ALL playback settings" (inserted before the final SUCCESS log). It banks an entry with
state B on all seven axes, switches to a distinct state A, pushes undo, recalls
(asserting recall applied B), undoes, then probes the restored state via `save_selected()`.

**Command / result (current code, expected exit 1):**

```
$ node tests/test_xo_map.js
AssertionError [ERR_ASSERTION]: undo after recall restores reverse
1 !== 0
    at Object.<anonymous> (/private/tmp/bugsweep/xo-map/tests/test_xo_map.js:…)
```

The pitch, decay and gain undo assertions immediately before it pass, isolating the
failure to the four fields missing from the snapshot.

**Suggested fix (Pass 3, not applied):** add `reversePlayback, speedPct, grainMs, stretchMode`
to `captureSnapshot()` and restore them in `applySnapshot()` (with the same
`!== undefined` defaulting as the other fields).

## Pass 2 review — kept 1 / dropped 0

- **Kept Bug 1:** Real functional/UI/state bug. Verified `captureSnapshot`/`applySnapshot` omit
  the four fields while `recallSavedEntry` assigns all seven and the saved-row `onclick`
  calls `pushUndoState()` before recall. Host gate (typecheck + `build_xo_map.py` +
  `node tests/test_xo_map.js`) exits 1 only on
  `AssertionError: undo after recall restores reverse (1 !== 0)`; pitch/decay/gain undo
  asserts pass. Red test left as-is (already isolates the missing snapshot fields).
- **Dropped:** none. Cleared items below still stand; no additional bugs found.

## Checked and cleared (do not re-litigate in Pass 2/3)

- **`getvalueof` / Live dials:** top-level blob serializes pitch/decay/gain (plus filters/selection/saved list
  pitch-decay-gain); Reverse / Speed / Grain / Stretch Mode are live.* parameters Live persists separately.
  Not filed as a Set-reload bug here.
- **relative_coords:** strip UI init path looks correct for the presentation box.
- **`const max` in node engine:** local Array method, not Max global shadowing.
- **Pitch Int range:** Int −24..24 is within Max Int limits (not >255 enum hazard).
- Sibling `xo-sample-map` worktree already filed the same undo bug; this pass independently
  confirmed it in this fresh `xo-map` worktree and added the red test here.

# Multiband Split — Pass 1–4 bugsweep

Branch: `bugsweep/mbsplit-pass1` · Worktree: `/private/tmp/bugsweep/mbsplit` · base HEAD `d72ee17`

## Pass 4 review (ADJUSTED — docs only)

Production fixes at tip `e5ade72` reviewed and kept. Host gate re-run green:
`npm run -s typecheck && python3 scripts/build_mbsplit.py && MBSPLIT_SKIP_LIVE_MCP=1 node tests/test_mbsplit.js && node tests/test_mbsplit_pass1.js`
→ typecheck OK, amxd rebuilt, host suite passed, **All Pass 1 tests passed** (4/4).

| Bug | Verdict | Note |
|---|---|---|
| 1 Volume slider dead zone | **APPROVED** | Exact inverse at exp 1.5; only `n <= 0.0` → −70 dB; (−70, −62.4) reachable; round-trip ≤0.5 dB. Minimal touch in `src/mbsplit_ui.js`. Reds not weakened. |
| 2 FIR display approx > 0.1 | **APPROVED** | `computeFirLowpassMag` uses cached real DC-normalized half-kernel; max error ≤0.1 (rounding). Minimal touch in `src/mbsplit_config.js`. Reds not weakened. |

**Doc adjust:** AGENTS.md Dynamic Phase JS-mirror line still said "raised-cosine display approximation"; synced to describe the real-kernel evaluation. No production/code change beyond that docs line. Pass 4 tip = HEAD after this review commit. Do not merge; do not delete worktree.

## Pass 3 fix (both kept reds now green)

Production fixes landed on this branch. Host gate green with `MBSPLIT_SKIP_LIVE_MCP=1`.
`node tests/test_mbsplit_pass1.js` → **All Pass 1 tests passed.** Fix commit SHA = tip of
`bugsweep/mbsplit-pass1` after the Pass 3 commit (see `git log main..HEAD --oneline`).

| Bug | Fix | Touchpoints |
|---|---|---|
| 1 Volume slider dead zone | Matched `gainDbToSliderNorm` / `sliderNormToGainDb` exponents to **1.5** (exact inverse). Removed the `n <= 0.015` dead zone — only true zero (`n <= 0.0`) maps to −70 dB (−inf). Gains in (−70, −62.4) dB are reachable again and round-trip within 0.5 dB. | `src/mbsplit_ui.js:153` `gainDbToSliderNorm` (exponent 1.5 at :161); `:164` `sliderNormToGainDb` (`n <= 0.0` at :168, `1.0/1.5` at :172) |
| 2 FIR display approx > 0.1 | Replaced the raised-cosine guess with the real DC-normalized half-kernel (`designFirHalfKernel` + `evalFirHalfKernel`), cached per `fc@sr` in module-level `firLowpassMagCache`. Display curve tracks the actual FIR to within rounding; worst pre-fix errors 0.180@fc=40 and 0.113@DEFAULT_F1=120 are gone. | `src/mbsplit_config.js:277` `firLowpassMagCache`; `:278` `computeFirLowpassMag` |

Also rebuilt `devices/Multiband Split.amxd` via `scripts/build_mbsplit.py` (included in the fix commit).
Reds in `tests/test_mbsplit_pass1.js` were **not** weakened.

## Pass 2 review (kept 2 / dropped 0)

Reviewed Pass 1 claims against source, PARAM_SPECS, AGENTS.md, and host measurements.
**Both bugs kept.** No drops. Production code untouched at review time (tip `bfe14c4`).

| Bug | Decision | Why |
|---|---|---|
| 1 Volume slider dead zone | **KEEP** | `sliderNormToGainDb` snaps `norm <= 0.015` to −70 while `gainDbToSliderNorm` maps (−70, −62.4) into that zone. Wired as inverse pair on click→drag. Live param / gen allow −70…+18; gen silence floor is `gain <= -69.5`; `formatGainDb(-65)` prints `"-65.0 dB"`. Real functional UI bug. |
| 2 FIR display approx > 0.1 | **KEEP** | AGENTS.md states unqualified "within 0.1 of the real kernel". Face draws Dynamic Phase bands via `computeBandMagnitudesAtFreq` → `computeFirLowpassMag`. F2/F3 PARAM_SPECS allow 20…20000 Hz. Measured worst error **0.113 at fc=120** (default F1 / legal F2) and **0.180 at fc=40** (48k/96k). Host suite only checks fc∈{800,4500} where error≈0.05. Real display/architecture-contract bug. |

## Verdict (Pass 1)

**Two credible bugs found.** Both have RED tests in `tests/test_mbsplit_pass1.js`
(they fail on unmodified HEAD; no production code was changed in Pass 1). The host gate
(`node tests/test_mbsplit.js` + build) still passes on unfixed HEAD — its FIR display check only
covers fc ∈ {800, 4500} at 48 kHz, and its volume-slider checks only exercise
the endpoints (−70 / 0 / +18 dB).

## BUG 1 — Volume slider mapping is not invertible at low gains

**Severity:** functional UI — Chain Gain values in roughly (−70, −62.4) dB are
unreachable from the painted volume slider, and any legal gain in that range
(e.g. from the Live parameter or `set_gain`) snaps to −70 dB (−inf) on the next
slider drag seed / paint→drag round-trip.

**Symptom.** `gainDbToSliderNorm` (`src/mbsplit_ui.js:153`) and
`sliderNormToGainDb` were used as an inverse pair:

- `drawTopVolumeSlider` fills from `gainDbToSliderNorm(curGainDb)`
- onclick seeds `volDragNorm = gainDbToSliderNorm(curGainDb)`
- ondrag sets `curGainDb = sliderNormToGainDb(volDragNorm)`

They did not round-trip at low gains. `sliderNormToGainDb` mapped every
`norm <= 0.015` to −70 dB, while `gainDbToSliderNorm` mapped the whole audible
range −69.5 … ≈−62.3 dB onto norms below 0.015. Measured: 14 of 176 half-dB
steps from −69.5 to +18 failed a 0.5 dB round-trip. Dragging across the dead
zone jumped from −70 dB to about −62.4 dB with no intermediate values.

**Contract.** `set_gain` / build `PARAM_SPECS` / gen clamp Chain Gain to
−70 … +18 dB; only `gain <= -69.5` is treated as silence in the gen
(`cGainLin = (gain <= -69.5) ? 0.0 : …`). `formatGainDb(-65)` prints
`"-65.0 dB"`. The slider is the face's control for that same parameter, so the
mapping pair must be invertible across the full legal range.

**Red test.** `tests/test_mbsplit_pass1.js` — extracts the two functions from
`mbsplit_ui.js` and asserts (a) round-trip within 0.5 dB for every half-dB step
−69.5 … +18, and (b) no >1 dB jump when sweeping norm 0…1 in 0.001 steps.

**Pass 3 fix.** Exponents matched at 1.5; dead zone removed (`n <= 0.0` only). See Pass 3 table.

## BUG 2 — Dynamic Phase FIR display approximation exceeds its stated 0.1 tolerance

**Severity:** display / architecture contract — the band curves the face draws
in Dynamic Phase mode (via `computeBandMagnitudesAtFreq` →
`computeFirLowpassMag`) diverge from the real Kaiser kernel by up to ~0.18
linear magnitude at low crossovers, contradicting AGENTS.md.

**Symptom.** AGENTS.md (Multiband Split / Dynamic Phase) stated
`computeFirLowpassMag` is a raised-cosine display approximation of the real
Kaiser FIR kernel, "**within 0.1 of the real kernel**". Against
`evalFirHalfKernel(designFirHalfKernel(fc, sr, D))` with
`D = firLatencyForSampleRate(sr)`, the worst error on unfixed HEAD was
**0.180** (f ≈ 108.7 Hz, fc = 40, sr = 48000/96000; real ≈ 0.79 vs approx ≈ 0.61).
Error already exceeded 0.1 at the default F1 / legal F2 = 120 Hz (**0.113**).
The error grew when the crossover approached / fell below the transition
half-width `sr / D` (375 Hz at 48/96 kHz), where the `lo <= 0` normalization
branch in the old raised-cosine ran.

**Why the host suite stayed green on unfixed HEAD.** `tests/test_mbsplit.js` §1b only checks
fc ∈ {800, 4500} at 48 kHz — well above `sr/D = 375` Hz — so the lo≤0 branch
never ran and the 0.1 assert stayed satisfied (measured worst ≈ 0.05 there).

**Red test.** `tests/test_mbsplit_pass1.js` — sweeps fc ∈
{40, 120, 300, 800, 2000, 4500, 9000} at 48 kHz and 96 kHz over a log-frequency
grid and asserts max |real − approx| ≤ 0.1; also asserts explicitly at
`MBSPLIT_DEFAULT_F1` (120 Hz) so a default-only miss cannot hide behind the
low-fc worst case.

**Pass 3 fix.** `computeFirLowpassMag` now evaluates the real half-kernel (module cache).
Raised-cosine half-width sweeps (k=0.55..1.3) could not meet 0.1 — shape wrong, not just width.
See Pass 3 table.

## Audited and cleared (do not re-hunt)

- **Scope isolation:** `buffer~ ---mbsplitscope @samps 8224`, loadbang
  `scope ---mbsplitscope` / `setbuffer ---mbsplitscope` — no top-level `#0-`
  share among device instances (AGENTS pitfall; already asserted by host suite).
- **Deferred gen~ loader** (`src/mbsplit_dsp.js`): silence-until-ready, claim
  queue, retry, scope slot 23 confirm — looks sound; not the spectral-rack Mix
  share bug (mbsplit is the LR gen core, not `spectral_split_rack_main`).
- **getvalueof / setvalueof:** versioned snapshot; custom mask 0 preserved
  (`isNaN(cmRaw) ? 1 : clamp…`, not `|| 1`); phaseMode at ver ≥ 3.
- **GenExpr nested early-return:** no `if (…) { …; return …; }` pattern in
  `mbsplit_core.genexpr`.
- **No `var box` shadowing** in mbsplit sources.
- **Param `phase`:** gen exposes polarity `phaseSign` from `Param phase`, but
  the UI never emits `phase` (only `dynphase`). Always +1 at runtime. Dead
  control / leftover — not filed (no user-facing polarity UI; measure harness
  sends `phase 0` explicitly).
- **FIR rebuild on sr change:** `if (sr != firSr) { firSr = sr; firD = clamp(128 * round(sr/48000), 128, 512); …}` and UI reads scope[26] into
  `firLatencySamples` / `updateDeviceLatency()` — consistent with
  `firLatencyForSampleRate`.
- **Loud Split Mix /K standalone bug** does **not** apply here (different
  architecture).

## Commands

```
# Pass 1 reds (GREEN after Pass 3 fix):
node tests/test_mbsplit_pass1.js

# Host gate (must stay green):
npm run -s typecheck && python3 scripts/build_mbsplit.py && MBSPLIT_SKIP_LIVE_MCP=1 node tests/test_mbsplit.js
```

# Tiny Space bugsweep (bugsweep/tinyspace-pass1)

PASS-1 filed Bug A with a RED suite. PASS-2 reviewed that RED and **kept** it. PASS-3 fixed production: top-level buffers are now instance-unique `---tsconfig` / `---tsmeters`, `tsDspFrames` peeks `meterBuf` from `setbuffer`, and `tests/test_tinyspace.js` expects the `---` names. Host gate (`npm run -s typecheck && python3 scripts/build_tinyspace.py && node tests/test_tinyspace.js && node tests/test_tinyspace_bugsweep.js`) is green. RED coverage remains in `tests/test_tinyspace_bugsweep.js` as a regression guard.

## PASS-2 review

- **Kept 1 / dropped 0.**
- **KEEP Bug A** — real functional instance cross-talk: Live does not expand `#0` in a top-level device patcher, so every Tiny Space shares one config and one meter buffer. Precedent (Multiband / Delay+ / Glitch / Reverb+ `---` names) confirms the expected fix shape. RED asserts the right surfaces (build `buffer~` / bind / `setbuffer`, built `.amxd`, UI `new Buffer("#0-tsmeters")` hardcode in `tsDspFrames`) and fails on current code. No rewrite or strengthening needed.
- Pass-1 "reviewed and not filed" items re-checked; none elevated to a new RED. No additional tinyspace-specific top-level `#0-` buffers found beyond `tsconfig` / `tsmeters`.

## Bug A — `#0-tsconfig` / `#0-tsmeters` are shared across every Tiny Space instance in Live

**Where (pre-fix)**
- `scripts/build_tinyspace.py` — `buffer~ #0-tsconfig @samps 128` (~L434), `buffer~ #0-tsmeters @samps 32` (~L447), bind `cfg #0-tsconfig, meters #0-tsmeters` (~L513), face `setbuffer #0-tsconfig #0-tsmeters` (~L527)
- `src/tinyspace_ui.js` — `tsDspFrames()` hardcodes `new Buffer("#0-tsmeters")` (~L193) instead of using the `meterBuf` from `setbuffer` (~L44–47)
- `tests/test_tinyspace.js` (~L331–339) currently *requires* the `#0-` prefix on those boxes
- Comments / docs that teach the same names: `src/tinyspace_config.js` L2, `src/tinyspace_core.genexpr` L2/L6, `AGENTS.md` Tiny Space section (~L367 / L372), `scripts/run_tinyspace_audio_tests.py` L4–5 / L85–109

**Contract / precedent**
AGENTS.md (measured): `#0` is **not** expanded in a device's top-level patcher in Live (only in abstractions). Multiband Split migrated `#0-splitscope` → `---mbsplitscope`; Delay+ uses `---dpxfer` / `---dphdr`; Glitch uses `---glitchslots` / `---glitchscope` / `---glitchctl`; Reverb+ uses `---rpscope` / `---rpxfer`. Tiny Space is the same class of top-level audio effect and still ships `#0-tsconfig` / `#0-tsmeters`.

Gen itself is fine: `Buffer cfg("tsconfig")` / `Buffer meters("tsmeters")` are fixed external names bound on loadbang (Glitch pattern). The shared names are the patcher's `buffer~` objects and the messages that bind / `setbuffer` them.

**User-visible effect**
Two Tiny Space instances (second track, or Cmd+D) share one config buffer and one meter buffer:
1. Seed / Character (and any UI poke into `#0-tsconfig`) on instance A rewrites instance B's tank geometry.
2. String / meter viz crosses: each face reads the other's envelopes and frame counter.
3. `tsDspFrames` always peeks the literal `#0-tsmeters`, so even a future `setbuffer` of an expanded per-instance name would not fix DSP-ready detection until that hardcode is removed.

**Expected**
Rename to unique `---` buffers (e.g. `---tsconfig`, `---tsmeters`) in build (`buffer~`, gen bind message, face `setbuffer` message), have `tsDspFrames` use `meterBuf` (or the name passed through `setbuffer`), and update `tests/test_tinyspace.js` assertions. The audio harness may keep private `#0-` names for its own probe buffers if needed (Multiband precedent: device `---mbsplitscope`, harness `#0-splitscope`).

**RED**
`tests/test_tinyspace_bugsweep.js` — build script / built `devices/Tiny Space.amxd` / UI must use instance-unique `---` names (not `#0-tsconfig` / `#0-tsmeters`); UI must not hardcode `new Buffer("#0-tsmeters")`.

## PASS-3 fix

**Status:** FIXED (host gate + bugsweep suite green). Commit SHA filled after commit on `bugsweep/tinyspace-pass1`.

**Production touchpoints**
- `scripts/build_tinyspace.py` — `buffer~ ---tsconfig @samps 128` (~L434), `buffer~ ---tsmeters @samps 32` (~L447), bind `cfg ---tsconfig, meters ---tsmeters` (~L513), face `setbuffer ---tsconfig ---tsmeters` (~L527)
- `src/tinyspace_ui.js` — `tsDspFrames()` peeks `meterBuf` (from `setbuffer`); comments at ~L141 / ~L189 updated to `---tsmeters (meterBuf)`
- `tests/test_tinyspace.js` (~L331–339) — asserts `---tsconfig` / `---tsmeters` (required so the main suite stays green; not a weaken of the bugsweep RED)
- Comments / docs aligned with production: `src/tinyspace_config.js` L2, `src/tinyspace_core.genexpr` L2/L6, `AGENTS.md` Tiny Space section (~L367 / L372)
- `devices/Tiny Space.amxd` — rebuilt after the rename (intentional; include in the PASS-3 commit)

**Left unchanged (intentional)**
- GenExpr `Buffer cfg("tsconfig")` / `Buffer meters("tsmeters")` — external names, bound via loadbang
- Audio harness private `#0-` probe buffers: `scripts/run_tinyspace_audio_tests.py`, `tests/tinyspace_harness.maxpat`, `tests/tinyspace_probe.js` (self-consistent inside the harness patcher; Multiband precedent)
- `tests/test_tinyspace_bugsweep.js` — kept as regression guard (still asserts `#0-` absence / `---` presence)

## Reviewed and not filed

These were checked against AGENTS / source / tests and are **not** bugs (doc drift or intentional design):
- JS `fdnMix` / `house()` vs gen `house()` for models 0–7, n=1–10: 0 coefficient mismatches.
- Nested returns: every gen helper has a single function-level return; `dampCoef` if-block then return is OK.
- Presentation rects (title / seed / char / viz / dials): no mutual live.* overlap; all inside 292×169.
- Seed `parameter_type` 0 + steps 1001; Character enum; `%/100` dial scales; deferred DSP (no static `plugin~`→`plugout~`); silence-sleep zeroing wet when asleep — intentional and covered by existing tests.
- AGENTS "70-float" vs `CFG_FLOATS=72`, and "whole samples" vs `interp="linear"` + `round()`: doc drift / intentional, not RED material.
- `Global("tinyspace_dspq")`: shared create-queue like `mbsplit_dspq` — intentional.

## PASS-3 complete

Bug A production fix is in; harness `#0-` names and the bugsweep RED suite stay as documented above. Pass 4 reviews next — do not merge to main from this pass.

## PASS-4 review

**APPROVED — 1 bug, no adjustments.**

- Reviewed `git log main..HEAD` and `git diff main...HEAD` across production/src/build, not only tests.
- Bug A fix is minimal and correct: build creates `buffer~ ---tsconfig @samps 128` / `buffer~ ---tsmeters @samps 32`, binds `cfg ---tsconfig, meters ---tsmeters`, and sends the face `setbuffer ---tsconfig ---tsmeters`; `tsDspFrames()` now peeks `meterBuf` (from `setbuffer`) instead of a hardcoded `#0-tsmeters` Buffer. Matches the Multiband / Delay+ / Glitch / Reverb+ `---` top-level isolation precedent.
- GenExpr `Buffer cfg(tsconfig)` / `Buffer meters(tsmeters)` external names left unchanged (correct — bound on loadbang). Audio-harness private `#0-` probe buffers left alone (Multiband precedent).
- Comments/docs in tinyspace_config.js, tinyspace_core.genexpr and AGENTS.md aligned to the new names. tests/test_tinyspace.js updated to assert `---`; no test weakened — the bugsweep RED suite (8 checks) stays as a regression guard. No drive-by refactors.
- Host gate green: typecheck OK, Tiny Space.amxd built 292×169 / 120098 bytes, test_tinyspace: ok, tinyspace bugsweep RED 8 checks.

Not merged to main; worktree left in place for the coordinator. Next: commit this note on bugsweep/tinyspace-pass1.

# Oscilloscope — Bugsweep (Pass 1 findings, Pass 2 review, Pass 3 fix, Pass 4 review)

Branch: `bugsweep/oscilloscope-pass1`
Scope: Oscilloscope-specific UI/DSP/state bugs only. The shared `#0-analyzerscope` buffer-name collision is owned by analyzer-scope pass 2/3 and is **not** re-filed here.

## Pass 4 review — APPROVED

Re-read production blob path (`OSC_VERSION` 5; `oscBlob` / `oscFromBlob` / `oscDefaultState` / `getvalueof` / `setvalueof`), build `parameter_initial` seed, and section-5 / section-7 tests. Host gate re-run green: typecheck OK, `devices/Oscilloscope.amxd` rebuilt (460×169, 115643 bytes), `oscilloscope: 163552 checks passed`. No follow-up code changes.

- **Bug 1 — APPROVED** — blob v5 persists armed `trigLevel` as the 9th element; old v4 8-element blobs load with `trigLevel = 0`; v3/v2/v1 loaders unchanged; `oscFrozen` intentionally left unpersisted; `#0-analyzerscope` not re-touched.

## Pass 3 fix — Bug 1 green

Host gate green after the fix: `npm run -s typecheck && python3 scripts/build_oscilloscope.py && node tests/test_oscilloscope.js` → typecheck OK, `devices/Oscilloscope.amxd` rebuilt (460×169), `oscilloscope: 163552 checks passed` (section-7 `near(ctx.oscTrigLevel, 0.42, …)` now passes).

**Bug 1 fix (persist armed `oscTrigLevel` across getvalueof/setvalueof):**
- `src/oscilloscope_config.js` — bumped `OSC_VERSION` 4→5; `oscDefaultState()` adds `trigLevel: 0`; `oscBlob()` emits a 9th element (clamped −1..1, rounded to 1e-3); `oscFromBlob()` has a v5 branch (`length >= 9`) plus an explicit v4 backward-compat branch (`length >= 8`, `trigLevel` defaults to 0). v3/v2/v1 loaders unchanged.
- `src/oscilloscope_ui.js` — `getvalueof()` passes `trigLevel: oscTrigLevel`; `setvalueof()` restores `oscTrigLevel = saved.trigLevel`. `oscFrozen` intentionally left unpersisted.
- `scripts/build_oscilloscope.py` — `parameter_initial` seed is now `[5, …, 0.0]` (9 elems).
- `tests/test_oscilloscope.js` — section 5 asserts v5 round-trip (9 elems, `trigLevel` 0.42) and v4 back-compat (`trigLevel` defaults to 0). Section-7 RED left as-is and is now green.
- Rebuilt `devices/Oscilloscope.amxd` via the build script.

Parents for this tip: pass-2 `ac39c75`, pass-1 RED `4d65086`.

## Pass 2 review — kept 1 / dropped 0

Re-read `src/oscilloscope_ui.js` getvalueof/setvalueof (1078-1105), `src/oscilloscope_config.js` oscDefaultState/oscBlob/oscFromBlob (8-elem blob v4, no trigger slot), and the section-7 RED in `tests/test_oscilloscope.js`. Host gate: typecheck + build_oscilloscope green; `node tests/test_oscilloscope.js` fails only on `near(ctx.oscTrigLevel, 0.42, …)` (got 0, want 0.42). No production/src edits in this pass.

- **Kept Bug 1** — real user-facing serialization bug: armed `oscTrigLevel` is sticky (trig drag / dblclick clear / guide paint / trigLocked) but never round-trips through getvalueof/setvalueof, so Live save/reload silently resets it to 0. RED left as-is; still fails on unfixed code.
- **Dropped:** 0. `oscFrozen` stays intentional momentary live-display state (sand pass-1 precedent). `#0-analyzerscope` stays owned by analyzer-scope pass 2/3.

## Confirmed bugs

### 1. Trigger level is not persisted across save / reload — FIXED (pass 3)

**Severity:** User-facing state loss (armed trigger silently resets to 0 when a Live set is saved and reopened).

**Evidence (pre-fix):**
- `src/oscilloscope_ui.js` (`getvalueof`) serialized only `routingMode`, `editSub`, `chMode`, `viewMode`, `cycleMode`, `rateHz`, `gainDb`, `autoGain` via `oscBlob` — no trigger field.
- `setvalueof` never restored a trigger level.
- `src/oscilloscope_config.js` `oscDefaultState()` exposed the same 8 keys (no trigger).
- Blob v4 was fixed at 8 elements.
- Yet `oscTrigLevel` is a sticky user control: trig drag / dblclick clear / guide paint / `trigLocked`. Trig drag-end and freeze toggle call `notifyclients()`, so Live dirtied and saved a state blob that dropped the armed trigger.

**Probe** (pre-fix, vm sandbox of built `devices/Oscilloscope.amxd`):
```
oscTrigLevel = 0.42
getvalueof() → [4, 0, 0, 0, 1, 30, 0, 0]   // blobHasTrigField = false
setvalueof(blob) → oscTrigLevel === 0         // FAIL_trig_roundtrip = true
```

**Fix:** Blob v5 adds `trigLevel` as the 9th element; old v4 8-element blobs still load with `trigLevel = 0`. See Pass 3 section above for file touchpoints.

**Not filed:** `oscFrozen` is also unpersisted, but Freeze is momentary live-display state (sand pass 1 precedent: do not invent nits). Left unpersisted in pass 3.

**Test:** `tests/test_oscilloscope.js` section 7 — `"trigger level survives a getvalueof/setvalueof round-trip"` — green after the fix.

## Out of scope (owned elsewhere)

- Shared `buffer~ #0-analyzerscope` / `setbuffer #0-analyzerscope` name in a top-level device (`src/oscilloscope_ui.js:13`, `scripts/build_oscilloscope.py:62,66,67`) — already covered by analyzer-scope pass 2; fix in pass 3 of that device.

# BUGS.md — Better Shaper PASS 1

Branch: `bugsweep/shaper-pass1`
Worktree: `/private/tmp/bugsweep/shaper`
Rule: PASS 1 finds bugs and adds RED tests only — do not fix production code here.

## Confirmed bugs

### 1. Multi-select vertical drag deletes unselected points between the selection

- **Where**: `src/mseg_edit.js:83-89` (`msegMoveSelection`)
- **What**: After pushing per-point travel intervals, when `sweepIntervals.length >= 2` the code also pushes the bounding union `[minSpan, maxSpan]` of *all* intervals. Selecting two or more interior points always hits that branch (each interior still pushes two near-degenerate intervals even when `dx === 0`), so a pure vertical group move deletes every unselected point whose `x` lies between the leftmost and rightmost selected `x`.
- **Why it is wrong**: Contradicts the comment at `src/mseg_edit.js:41` (“An unselected point whose x lies on a selected point's travel is removed”). A pure vertical move has no horizontal travel, so intervening points must survive.
- **Repro (Node)**: five points at x=`0,0.25,0.5,0.75,1`; select ids `[2,4]`; call `msegMoveSelection(..., primaryId=2, targetX=0.25, targetY=0.55, ...)`. Point id `3` at x=`0.5` is removed; result ids `1,2,4,5`.
- **RED test**: `tests/test_shaper_bugsweep.js` (run: `node tests/test_shaper_bugsweep.js`; expected FAIL on current code). Verified RED on this branch (AssertionError: middle point 3 deleted).

## Notes

- No other credible bugs locked in this pass yet; further review may add entries and RED cases.
- Host gate (`npm run -s typecheck && python3 scripts/build_shaper.py && node tests/test_shaper.js`) does not run `tests/test_shaper_bugsweep.js`; run that file separately to see the RED failure.

## PASS 2 review

- **Kept 1 / Dropped 0.** Bug 1 confirmed real UI bug, not intentional sweep: L41 comment limits deletes to an unselected point on a selected point's travel; on `dx === 0` interiors still push near-degenerate intervals and L83-89 unions the whole selection span, so intervening points die. RED re-verified FAIL on unfixed code (`node tests/test_shaper_bugsweep.js` → AssertionError, ids `1,2,4,5`).
- Host gate green on unfixed code: `npm run -s typecheck && python3 scripts/build_shaper.py && node tests/test_shaper.js` (GATE_EXIT:0). Bugsweep remains RED (BUGSWEEP_EXIT:1).
- No strengthen needed; no additional bugs found in `src/mseg_edit.js` (104 lines; file ends at `msegMoveSelection`). Production/src untouched (pass 3).

## PASS 3 fix

- **Fixed 1 / Deferred 0.** Bug 1 fixed in `src/mseg_edit.js` `msegMoveSelection`: guarded the bounding-union sweepIntervals push with `dx !== 0`, so a pure vertical multi-select drag (dx === 0) no longer unions the whole selection span and no longer deletes intervening unselected points. Per-point travel intervals still apply, preserving intentional horizontal-sweep deletes for dx !== 0.
- **Red now green**: `node tests/test_shaper_bugsweep.js` passes (middle point id 3 survives; ids 1,2,3,4,5; selected points 2 and 4 keep x=0.25/0.75). Full host gate green end-to-end: `npm run -s typecheck && python3 scripts/build_shaper.py && node tests/test_shaper.js && node tests/test_shaper_bugsweep.js` (GATE_BUGSWEEP_EXIT:0). Rebuilt `devices/Better Shaper.amxd` (1383889 bytes).
- Commit: pending on `bugsweep/shaper-pass1`; not merged to main.

## PASS 4 review

- **APPROVED.** Bug 1 fix confirmed minimal and correct: `src/mseg_edit.js:85` gates the bounding-union push with `dx !== 0 && sweepIntervals.length >= 2`; per-point travel pushes (L79-80) and the filter (L93-103) are unchanged, so dx !== 0 horizontal-sweep deletes remain. RED test still asserts middle point id 3 survives a pure vertical multi-select of ids 2+4 (primary at x=0.25, y to 0.55), length stays 5, and selected points keep x=0.25/0.75. No drive-by refactors; no test weakening.
- Host gate re-verified green on tip 3c91f90: `npm run -s typecheck && python3 scripts/build_shaper.py && node tests/test_shaper.js && node tests/test_shaper_bugsweep.js` (GATE_BUGSWEEP_EXIT:0). Rebuilt `devices/Better Shaper.amxd` (1383889 bytes).
- No follow-up code changes in this pass; note-only commit next. Not merged to main.

# Theme Editor — Bugsweep Pass 1 (branch bugsweep/theme_editor)

Branch: bugsweep/theme_editor. Worktree: /tmp/bugsweep/theme_editor (pre-bugsweep baseline, clean before this pass).
Scope: src/theme_engine.js, src/theme_editor_node.js, src/theme_editor_ui.js, src/theme_editor_web.html, scripts/build_theme_editor.py; tests/test_theme_editor.js, tests/test_theme_editor_bugs.js.

Baselines on this tree: `node tests/test_theme_editor.js` — all 9 checks PASS, exit 0. `node tests/test_theme_editor_bugs.js` — 6 passed, 0 failed, exit 0: the three bugs from the earlier Theme Editor pass (m4lSetThemeState NaN satScale/contrast, m4lApplyMacros null alpha, node partial-POST state loss) are already fixed in this baseline and are NOT re-reported below; the bugs here are new.
Red suite: `node tests/test_theme_editor_bugsweep.js` — 0 passed, 11 failed, exit 1 (all 11 checks red, each for the stated reason).

## Bug 1 — Resolved-token cache ignores the device slug, so one devices override theme is served to every device in the same JS context

Location: src/theme_engine.js, `m4lResolvedTokens` (line 3672: `if (_m4lResolvedCache && !slug) return _m4lResolvedCache;`) and `m4lColor` (lines 3717-3721, which always resolves with no slug). The cache (and `_m4lIssuedRgbKeys`) is only invalidated by `m4lSetThemeState` / `m4lRefreshTheme`, never by a slug change.
What is wrong: the WebUI is exactly such a shared context — `renderDeviceCanvas` sets `window.M4L_DEVICE_SLUG = dev.slug` per device (src/theme_editor_web.html line 947) and `mapDevColor` sets it per widget, then calls `m4lColor(...)` with no refresh in between. The first device rendered populates the cache with its own device-override tokens; every later device is drawn with the first devices colours.
User-visible effect: in the Theme Studio gallery, per-device theme overrides do not preview per device — all device cards show the first-rendered devices override palette (or the global palette cached by the sidebar) instead of their own.
Test: "Resolved-token cache follows M4L_DEVICE_SLUG: a second device must not inherit the first devices override tokens".
Observed failure: dev_a (override live_lcd_bg [1,0,0,1]) resolves correctly, then after switching M4L_DEVICE_SLUG to dev_b (override [0,0,1,1]) `m4lColor("live_lcd_bg")` still returns [1, 0, 0, 1] instead of [0, 0, 1, 1]. (Control: `m4lEffectiveConfig()` for dev_b returns the correct blue token — only the cached resolution path is stale.)

## Bug 2 — Node mergeThemeState resurrects every deletion, so WebUI reset / token-delete / import can never remove anything

Location: src/theme_editor_node.js, `mergeThemeState` (lines 330-349) used by POST /api/state (lines 427-449) and the `sync_state` handler (lines 351-360), persisted by `saveStateToDisk`.
What is wrong: merge always unions the previous `tokens` / `deviceOverrides` / `customPresets` maps into the incoming state. That is right for field-absent partial posts (the earlier bug), but the WebUI only ever posts the FULL state (`schedulePush` sends `JSON.stringify(state)`), so a key the user deleted is indistinguishable from a key a partial post never mentioned — and is silently restored. The WebUI token reset button (`delete tgt.tokens[k]`, theme_editor_web.html), Reset Target (`delete state.deviceOverrides[currentTarget]`, and the global reset which posts a fresh default state), and Import JSON all rely on full-state replacement. Worse, the POST bumps `version`, so the SSE echo of the resurrected state is accepted by the WebUI (`msg.state.version > state.version`) and the deletion visibly reverts in the UI.
User-visible effect: token overrides, per-device overrides and custom presets can never be deleted or reset through the WebUI or the v8ui preset switch (which also posts `tokens: {}` via sync_state); they persist in the served state and in ~/.m4l_theme_state.json forever.
Tests: "A full-state POST (the WebUI schedulePush shape) that removes a token, a device override and a custom preset actually deletes them" and "Deletions from a full-state POST persist to the on-disk state file".
Observed failure: after seeding tokens {live_lcd_bg: [0.1,0.2,0.3,1]}, deviceOverrides {dev_x}, customPresets {Mine} and POSTing the same full state with those keys removed, GET /api/state still returns all three and the on-disk file still contains them ("deleted token override must stay deleted").
Note for the fix: the earlier partial-POST tests must keep passing — a field that is ABSENT from the body must still be preserved, while a field that is PRESENT must be allowed to shrink (macros keep their deep-merge, per the existing partial-macros test).

## Bug 3 — m4lApplyMacros treats null satScale/contrast as 0, and device-override macros are never sanitised

Location: src/theme_engine.js, `m4lApplyMacros` (lines 3607-3608: `ss = macros.satScale === undefined ? 1.0 : Number(macros.satScale)`, same for contrast); ingress via `m4lEffectiveConfig` (lines 3526-3530) and `m4lSetThemeState` (lines 3490-3492, which copies deviceOverrides verbatim while sanitising only the top-level macros).
What is wrong: `undefined` correctly falls back to the 1.0 identity, but `null` — precisely what JSON serialisation turns a NaN into, the decay path of the earlier Bug 1 — becomes `Number(null) === 0`: satScale 0 renders the colour fully desaturated and contrast 0 collapses it to flat mid-grey. A device override whose macros contain a null satScale (e.g. after a JSON save/load round trip of the state file) therefore greys every colour that device resolves, even though the global macros were repaired by the earlier fix.
User-visible effect: a single bad/null saturation or contrast value in a per-device override silently turns that device monochrome / flat grey instead of leaving the macro at its neutral value.
Tests: "m4lApplyMacros treats a null satScale as 1.0 (identity), not 0 (full desaturation)", "m4lApplyMacros treats a null contrast as 1.0 (identity), not 0 (flat mid-grey)", "Device-override macros with a null satScale survive: override colours must not render desaturated".
Observed failures: `m4lApplyMacros([0.2,0.4,0.6,1], {satScale: null, contrast: 1, ...})` returns [0.4, 0.4, 0.4, 1]; with `{contrast: null}` it returns [0.5, 0.5, 0.5, 1]; the integrated override case (override token [0.2,0.4,0.6,1], override macros {satScale: null}) resolves via `m4lColor` to [0.4, 0.4, 0.4, 1].

## Bug 4 — m4lMapRgba lets a null/NaN alpha through as transparent 0 / NaN (the un-fixed sibling of the earlier m4lApplyMacros alpha bug)

Location: src/theme_engine.js, `m4lMapRgba` (line 3759: `var alpha = a === undefined ? 1.0 : Number(a);`).
What is wrong: the earlier pass fixed this exact convention in `m4lApplyMacros` (missing/null/non-finite alpha → opaque 1.0, matching `m4lColor` / `m4lMixColor`), but `m4lMapRgba` — the function the mgraphics hook routes every `set_source_rgba` / `set_source_rgb` call in every themed device through — only special-cases `undefined`. A null alpha becomes 0 (fully transparent) and a NaN alpha propagates as NaN into `mgraphics.set_source_rgba`.
User-visible effect: any colour reaching the hook with a JSON-decayed (null) alpha renders invisible instead of opaque; a NaN alpha produces undefined drawing behaviour in Max.
Tests: "m4lMapRgba treats a null alpha as opaque 1.0, not transparent 0" and "m4lMapRgba treats a NaN alpha as opaque 1.0, not NaN".
Observed failures: with an active Cyber Cyan theme, `m4lMapRgba(0.2, 0.4, 0.6, null)[3]` is 0 (expected 1; control: undefined alpha correctly returns 1) and `m4lMapRgba(0.2, 0.4, 0.6, NaN)[3]` is NaN.

## Bug 5 — m4lEstimateAbletonUiSettings returns an RMSE of 8,063,808 when there is nothing to compare

Location: src/theme_engine.js, `m4lEstimateAbletonUiSettings` (best candidate initialised with `err: 1e9` at lines 3315-3321; the score loop counts compared components `n` at lines 3347-3357 and falls back to the sentinel when n === 0; `rmse: Math.sqrt(Math.max(0, best.err)) * 255` at line 3376).
What is wrong: with an empty/null observed-colour map (or one containing none of the comparison keys), no candidate ever beats the 1e9 sentinel, so the function returns the default settings together with `rmse = sqrt(1e9) * 255 ≈ 8,063,808` — in a field documented and displayed as an error in 0..255 sample units.
User-visible effect: the WebUI Detect Live flow prints `RMSE 8063808.0` in its banner (theme_editor_web.html, detectLiveBtn handler) whenever the host-colour map is empty, instead of a meaningful figure.
Test: "m4lEstimateAbletonUiSettings with no observations returns a sane RMSE (not the 1e9 sentinel scaled by 255)".
Observed failure: `m4lEstimateAbletonUiSettings({})` and `(null)` both return askName "Default Dark Neutral Medium" (correct) with rmse 8063808.0334293675.

## Bug 6 — m4lComputeAbletonUiTokens treats a null/NaN Ableton brightness as 0% instead of the 100% default

Location: src/theme_engine.js, `m4lComputeAbletonUiTokens` (lines 3175-3180: `Object.assign(m4lDefaultAbletonUi(), ui)` lets an explicit null overwrite the 100 default, then `brtPct = m4lClamp(Number(u.brightness === undefined ? 100 : u.brightness), 0, 200)` maps null to 0 and NaN (via m4lClamp) to the 0 floor).
What is wrong: a missing brightness correctly defaults to 100, but a present-but-null/NaN brightness — the same JSON NaN→null decay in a saved `abletonUi` block — computes the whole simulated Live palette at 0% brightness.
User-visible effect: with Ableton UI simulation enabled, one decayed brightness value makes every simulated Live colour render at minimum brightness (e.g. live_lcd_bg 0.039 instead of 0.094) across the WebUI preview and any device reading `m4lHostLiveColor` simulation.
Test: "m4lComputeAbletonUiTokens treats a null/NaN brightness as the 100% default, not 0%".
Observed failure: tokens for {brightness: null} differ from {brightness: 100} across the skin-tinted tokens (live_lcd_bg [0.0392, 0.0392, 0.0392, 1] vs [0.0941, 0.0941, 0.0941, 1], live_control_fg 0.3922 vs 0.7098, etc.); {brightness: NaN} fails the same way.

## Bug 7 — WebUI device preview draws a minimum-value dial at 50%

Location: src/theme_editor_web.html, renderDeviceBody dial branch (line 916: arc end angle `(0.75 + 1.5 * (wid.norm || 0.5)) * Math.PI`); the model side is src/theme_editor_node.js line 261, where `extractDevicePreviewModel` computes `norm` clamped to 0..1 from the saved parameter initial value.
What is wrong: `norm` 0 is a legitimate, common value (any live.dial whose saved initial value equals its parameter minimum). `0 || 0.5` evaluates to 0.5, so the preview arc is drawn half-full for a dial that is actually at minimum. (The `|| 0.5` default is only needed for a missing norm.)
User-visible effect: in the Theme Studio device gallery, every dial saved at its minimum value previews as if set to half.
Test: "WebUI device preview draws a minimum-value dial (norm 0) with an empty arc, not a half arc" (source check on the HTML, the node-testable surface for the in-page renderer, in line with the existing suites .amxd source checks).
Observed failure: the HTML still contains the `wid.norm || 0.5` expression at line 916.

## Checked and cleared (no bug claimed)

- HSL conversions (m4lRgbToHsl/m4lHslToRgb), macro drag math and ranges in theme_editor_ui.js (MACRO_DEFS vs the WebUI sliders agree: Hue -180..180, Sat 0..2, Contrast 0.5..1.6, Brightness -0.3..0.3), v8ui getvalueof/setvalueof blob round trip, preset-grid geometry, theme_common engine injection in the build script, and the estimator against the VM ground-truth cases in the main suite.
- colorHue NaN in m4lComputeAbletonUiTokens was probed as a candidate and cleared: it collapses through m4lClamp to the same output as the tested defaults, so no red test is claimed for it.
- The brightness >100% softScale curve for very light tokens and the theme fingerprint (which leans on the monotonically bumped state version) were examined; no wrong result could be confirmed, so neither is claimed.
- Already covered by tests/test_theme_editor_bugs.js (do not duplicate): m4lSetThemeState NaN satScale/contrast storage, the JSON round-trip decay of the global macros, m4lApplyMacros null alpha, and node partial-POST loss of abletonUi/customPresets/sibling macros. Bugs 3 and 4 above are the remaining un-fixed siblings of that family (ApplyMacros macro values and the MapRgba path), not repeats of the covered checks.

## Pass 2 review

Re-read all 11 reds against source and user-visible impact. Kept all 11 (real defects: cache cross-device leak, null→0 macro/alpha/brightness decay, sentinel RMSE, full-state POST resurrection, dial `||` falsy). No culls. Undo/pushUndoState gap noted earlier remains out of scope (cleared in Checked).

## Pass 3 fix

Commit `7ac4d5f` on bugsweep/theme_editor (baseline `69699f7`, reds `dcbcf8e`):

- `m4lResolvedTokens`: cache keyed by `activeSlug` (`slug || m4lDeviceSlug()`); clear `_m4lResolvedCacheSlug` with the cache.
- `mergeThemeState`: when `tokens` / `deviceOverrides` / `customPresets` are present, replace (allow shrink); macros and `abletonUi` stay deep-merge so partial POSTs keep working.
- `m4lApplyMacros`: null/non-finite satScale/contrast → 1.0.
- `m4lMapRgba`: null/non-finite alpha → 1.0.
- `m4lEstimateAbletonUiSettings`: rmse 0 when `best.err >= 1e9` (no compared samples).
- `m4lComputeAbletonUiTokens`: null/non-finite brightness → 100.
- WebUI dial arc: `wid.norm == null ? 0.5 : wid.norm`.

Host gate after fix: `npm run -s typecheck` OK; `python3 scripts/build_theme_editor.py` OK; `node tests/test_theme_editor_bugsweep.js` 11/11; `node tests/test_theme_editor_bugs.js` 6/6; `node tests/test_theme_editor.js` 9/9.

## Pass 4 review

Diffs are minimal and match the Pass 1 fix directions. No API renames, no Max/Live-only paths touched, no debug left. Residual risks: (1) v8ui still does not call `pushUndoState` on macro drag (cleared, not claimed); (2) deviceOverrides.macros still not sanitised at `m4lSetThemeState` ingress — ApplyMacros now tolerates null, but storing null in state remains possible until a later hygiene pass; (3) explicit-slug `m4lResolvedTokens(slug)` now also updates the global cache (previously skipped) — same activeSlug keying, low risk.
# Oscilloscope — Bugsweep Pass 1 (bugsweep/oscilloscope)

Fresh Pass 1 hunt on the pre-bugsweep baseline, distinct from the earlier `bugsweep/oscilloscope-pass1` sweep recorded above (its single bug — the armed trigger level not persisting across save/reload — was fixed in blob v5 and remains fixed and green). Two NEW credible bugs found. Both are caught by red tests in `tests/test_oscilloscope_bugsweep.js` (run: `node tests/test_oscilloscope_bugsweep.js`, exits 1). No `src/` files were changed in this pass.

---

## Bug 1: Armed trigger level is silently ignored in the pitch-locked cycle windows (1/2/4/8 Cyc)

- **File:line:** `src/oscilloscope_config.js`, `oscComputeFrame` — the cycle branch (phase lock at line 928) never reads `o.trigLevel`; only the fixed-ms branch (line 940) passes it to `oscFindTrigger`.
- **What is wrong:** The face (`src/oscilloscope_ui.js`, `oscRefreshFrame` line 182) passes the user-armed `trigLevel` into every frame, and the plot lets the user drag the trigger threshold and paints the guide in every Window mode. But for the four pitch-tracked cycle windows, `oscComputeFrame` phase-locks to the rising zero crossing via `oscPhaseLock` and discards the level entirely. The fixed 5/20/50 ms windows honor the same value correctly.
- **User-visible effect:** In 1 Cyc, 2 Cyc, 4 Cyc and 8 Cyc (4 of the 7 Window modes), dragging the trigger threshold moves the orange guide line but the waveform never re-triggers at that level — the trace always locks to the zero crossing. The persisted, animated control is a silent no-op. Probe: a 220 Hz sine in 1 Cyc with `trigLevel` 0 vs 0.5 produces byte-identical waves (max sample difference 0.0000, both start at 0.0074); the same signal in the 20 ms window starts at exactly 0.5000 with the level armed.
- **Tests that catch it:**
  - `cycle windows honor the armed trigger level (1 Cyc)`
  - `cycle windows honor the armed trigger level (2 Cyc)`
  - (Passing control, pins the intended semantics: `control: fixed-ms windows honor the armed trigger level (20 ms)`)
- **Observed failure output:**

  ```
  FAIL cycle windows honor the armed trigger level (1 Cyc): 1 Cyc wave must change when the trigger level is armed at 0.5
  FAIL cycle windows honor the armed trigger level (2 Cyc): 2 Cyc wave must change when the trigger level is armed at 0.5
  ```

## Bug 2: Pitch estimator reports one octave down above 3200 Hz, despite the documented 4000 Hz ceiling

- **File:line:** `src/oscilloscope_config.js:296` — `var minLag = Math.max(8, Math.floor(rate / 3200));` inside `oscEstimatePeriod`, whose own doc (line 245) states "Supports 24 Hz .. 4000 Hz".
- **What is wrong:** At 48 kHz the shortest period the NSDF search can return is `floor(48000 / 3200) = 15` samples, capping detection at 3200 Hz. A tone between 3200 and 4000 Hz (period 12-14 samples) has no searchable lag; the NSDF peak at twice the true period is just as strong, so peak picking confidently selects the sub-octave lag.
- **User-visible effect:** The tracked-frequency readout (and the note name, and the cycle-window length derived from the period) is exactly one octave low for any fundamental in the 3200-4000 Hz band, reported with full confidence: a 3500 Hz sine reads 1750.1 Hz (confidence 0.981) and a 4000 Hz sine reads 2000.0 Hz (confidence 1.000). The 24 Hz low end is exact, so only the top of the documented range is affected.
- **Tests that catch it:**
  - `pitch estimator detects 3500 Hz (documented ceiling is 4000 Hz)`
  - `pitch estimator detects 4000 Hz (documented ceiling is 4000 Hz)`
- **Observed failure output:**

  ```
  FAIL pitch estimator detects 3500 Hz (documented ceiling is 4000 Hz): Detected frequency at 3500 Hz (got 1750.129314815331, want 3500)
  FAIL pitch estimator detects 4000 Hz (documented ceiling is 4000 Hz): Detected frequency at 4000 Hz (got 1999.9999999999998, want 4000)
  ```

## Full run summary

```
FAIL cycle windows honor the armed trigger level (1 Cyc): 1 Cyc wave must change when the trigger level is armed at 0.5
FAIL cycle windows honor the armed trigger level (2 Cyc): 2 Cyc wave must change when the trigger level is armed at 0.5
PASS control: fixed-ms windows honor the armed trigger level (20 ms)
FAIL pitch estimator detects 3500 Hz (documented ceiling is 4000 Hz): Detected frequency at 3500 Hz (got 1750.129314815331, want 3500)
FAIL pitch estimator detects 4000 Hz (documented ceiling is 4000 Hz): Detected frequency at 4000 Hz (got 1999.9999999999998, want 4000)
oscilloscope bugsweep: 2 checks passed, 4 failing test(s)
exit=1
```

## Checked and cleared (no bug)

- **Auto-normalize headroom:** `oscComputeEffectiveGain` normalizes the peak to 1.0 (not 0.78) on purpose — `OSC_AMP_HEADROOM = 0.78` is the display Y mapping in `oscilloscope_ui.js` (`oscAmpY`), the existing suite asserts normalize-to-unity (`normGain` 4.0 for a 0.25 peak), and the split-lane painter reuses the same 1/peak clamp. The stale "0.80" wording in the config doc comment is a comment inaccuracy, not a behavior bug.
- **Blob quantization:** `oscBlob` rounds `rateHz` to an integer and `gainDb` to 0.1 dB; that matches the precision the face itself displays (slider texts show integer Hz / 0.1 dB), so no user-visible state is lost on save/load. v5 round-trip and the v4/v3/v2/v1 migrations were re-verified against the existing suite (all green: 163561 checks).
- **`oscStats` / `oscCorrelation` window:** both scan the newest 1024 of the 4096 ring samples — a consistent recent-window choice for the Pk/RMS readouts, not an off-by-one.
- **Routing/geometry/hit-testing:** `oscResolveRouting` and `oscRoutingFromChMode` are exact inverses for all 6 channel modes; geometry, menu hit order, slider X mappings (linear over 1..60 Hz and -18..+24 dB), double-click resets, and the guide-click level preservation all match the spec in AGENTS.md section 28 and are covered by the existing suite.
- **Build wiring:** `scripts/build_oscilloscope.py` concatenates config -> theme -> gen vars -> `analyzer_dsp.js` -> UI (matching the runtime), and its `parameter_initial` is a well-formed v5 blob. (Its help text still describes routing in stale v3 terms — cosmetic, build previews only.)

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
- `set_freq` (`sand_ui.js:160`): `Number(v) || 14000` maps an explicit 0 to 14000 instead of clamping to the 20 Hz floor the reticle/gen would use. No in-device sender can emit 0 (the Freq box minimum is 20 and the drag clamps to 20..18000), so it is unreachable from the shipped patcher.
- Gen coefficient cache (`sand_core.genexpr:220-272`) computes and stores `cAtk/cRel/cKnee/cMild` on refresh, but `compand()` recomputes attack/release/knee/mild from `soft01` internally and `channel()` never receives the cached copies — dead work once per parameter change, no behavioural effect.
# Better Sampler — Bug Sweep Pass 1 (bugs + red tests only, no fixes)

Red tests: `tests/test_sampler_bugsweep.js` (created this pass). No `src/` files were modified — fixes are Pass 3.

## Bug 1: State save/load drops slice markers past 32 and loads a number as the sample path

- **Where:** `src/sampler_ui.js` — `getvalueof()` lines 1361–1366 writes
  `sliceMarkers.length` uncapped, every marker, then the sample path;
  `setvalueof()` lines 1395–1406 clamps the restored count with
  `if (sCount > 32) sCount = 32;` and then reads the sample path at
  `pathAt = 11 + sCount` — the slot computed from the *clamped* count, not
  the count actually stored in the blob.
- **What's wrong:** With more than 32 markers in the blob, restore keeps
  only the first 32 markers and reads the 33rd marker value (a number,
  e.g. `5000`) as the sample path string: `sampleFilePath = "5000"`,
  `sampleFileName = "5000"`, and `outlet(0, "load_sample", "5000")`.
- **Reachable in normal use:** Slice Divisions `slice_div` is 1..64
  (`scripts/build_sampler.py:252`) and `sliceDivisions`
  (`src/sampler_config.js:371`) returns one marker per division, so 64
  divisions = 64 markers. Beats mode caps at 256 markers
  (`sliceBeats`, `src/sampler_config.js:384`). Manual markers via
  `addSliceMarker` (`src/sampler_config.js:705`) have no count cap.
- **User-visible effect:** Slice a sample into more than 32 slices, save
  the Live Set or a preset, reload — every slice after the 32nd is gone
  and the device tries to load a sample literally named e.g. "5000"
  instead of the real file, so the restored device plays the wrong (or
  no) sample with a truncated slice map.
- **Test:** `tests/test_sampler_bugsweep.js`, Bug 1 block —
  "round-trip keeps all 64 slice markers" and the three assertions after
  it (marker 40, sample path, `load_sample` emission). The test seeds the
  sandbox face with `sliceDivisions(0, 1, 64)` markers and the path
  `/Users/test/Drums/Loop 64.wav`, round-trips
  `getvalueof()` → `setvalueof()`, and asserts all 64 markers and the
  exact path survive.
- **Observed failure** (`node tests/test_sampler_bugsweep.js`, baseline):

  ```
  FAIL: round-trip keeps all 64 slice markers, got 32
  FAIL: marker 40 survives the round-trip (want 0.625, got undefined)
  FAIL: sample path survives the round-trip, got "5000"
  FAIL: restore emits load_sample with the real path, got [[0,"load_sample","5000"]]
  4 passed, 4 failed
  ```

  (The 4 passes are the setup checks: 64 markers generated, count and
  blob length stored in full, path stored last — proving the loss happens
  in `setvalueof`, not in what was saved.)

## Pass 2 review verdict — Bug 1: KEEP

- **Verdict: KEEP — the bug and all 4 red assertions are correct as filed; no test changes, no `src/` changes.**
- One-line evidence: `getvalueof` stores count uncapped at blob index 10 with markers at 11.. and the path last, while `setvalueof` clamps that count to 32 and reads the path at `11 + 32`, so a 64-marker round-trip returns 32 markers and `load_sample "5000"` (marker 33 = 0.5 x 10000).
- Blob trace (independent, `src/sampler_ui.js`): header indices 0-9, index 10 = `sliceMarkers.length` uncapped, indices 11..10+N = markers x 10000, index 11+N = `sampleFilePath`; restore clamps `sCount` (`if (sCount > 32) sCount = 32;`) before both the marker loop and `pathAt = 11 + sCount`.
- Reachability re-verified: `slice_div` is 1..64 (`scripts/build_sampler.py:252`); `sliceDivisions` clamps n to 1..64 and returns exactly n markers; `sliceBeats` loops to `SLICE_MAX_BEAT_MARKERS = 256` (`src/sampler_config.js:354`); `addSliceMarker` has no count cap (only [0,1) range + 0.002 dedupe). `recomputeSlices()` assigns the divisions/beats arrays directly to `sliceMarkers` with no truncation, and manual adds go through `src/sampler_face.js:1344`.
- No preventer found: the only other slice-related 32 caps are inside `detectTransientSlices` (transient/onset path, not claimed here) — nothing clamps divisions, beats, or manual markers before `getvalueof`.
- Re-run (Pass 2, clean tree at f03ed76): `tests/test_sampler_bugsweep.js` = 4 passed, 4 failed, with exactly the filed messages (`got 32`; marker 40 `want 0.625, got undefined`; path `got "5000"`; `load_sample "5000"`). Green: `test_sampler.js`, `test_sampler_slicing.js` (81 passed), `test_sampler_modmatrix.js`, `test_sampler_pitch.js` (51 passed), `test_sampler_designs.js`, `test_sampler_design_reactive2.js`. `test_sampler_theme.js` fails pre-existing at this baseline (TypeError at line 101: `var FACE_PARAMS = {...}` regex finds no match in the built device text) — unrelated to Bug 1 and not introduced by Pass 1, whose commit touched only BUGS.md and the new test file.

## Pass 3 fix — Bug 1: FIXED

- **Fix:** `src/sampler_ui.js`, `setvalueof()` — the 32 clamp `if (sCount > 32) sCount = 32;` is replaced by a bound on the entries actually present in the blob: `if (sCount > a.length - 11) sCount = Math.max(0, a.length - 11);`, with a comment explaining why. `getvalueof()` and the blob format/index layout are unchanged (count at index 10, markers at 11.., sample path last), so states with ≤32 markers load identically to before.
- **Effect:** a save/load round-trip now preserves every marker `getvalueof` can write — 64 Slice Divisions, up to 256 Beats markers, and uncapped manual markers — and `pathAt = 11 + sCount` again points at the real sample path, so restore emits `load_sample` with the real file instead of a marker value such as `"5000"`. A corrupt or truncated count still cannot read past the end of the blob or fire a bogus `load_sample`.
- **Verification (all green):** `npm run -s typecheck` (all configs) and `python3 scripts/build_sampler.py` (rebuilt `devices/Better Sampler.amxd` and `devices/Better Sampler Reactive 2.amxd`, so the committed devices carry the fixed source); `node tests/test_sampler_bugsweep.js` = **8 passed, 0 failed**; `node tests/test_sampler.js` = all passed; `node tests/test_sampler_slicing.js` = 81 passed, 0 failed; `node tests/test_sampler_modmatrix.js` = ok; `node tests/test_sampler_pitch.js` = 51 passed, 0 failed; `node tests/test_sampler_designs.js` and `node tests/test_sampler_design_reactive2.js` = passed. Gate preview: `python3 scripts/render_preview.py "devices/Better Sampler.amxd"` rendered `previews/better_sampler.png`, which was read and visually inspected — byte-identical to the committed preview, as expected for a serialization-only fix with no layout or drawing change.
- **Pre-existing, not fixed:** `tests/test_sampler_theme.js` fails at this baseline (TypeError at line 101, confirmed unrelated in Pass 2) — left untouched and not blocking.

## Pass 4 review — Better Sampler Bug 1: APPROVED

- Independent review of 74a0e6a: fix minimal and correct — truncated/corrupt counts clamp to the entries present (pathAt then equals a.length, so no marker is read as the path and no bogus load_sample fires), <=32-marker and legacy states load identically, getvalueof/blob layout unchanged, no test files changed, BUGS.md Pass 3 record matches the diff.
- Evidence re-run by this pass: test_sampler_bugsweep.js 8/8, test_sampler.js ok, test_sampler_slicing.js 81, test_sampler_modmatrix.js ok, test_sampler_pitch.js 51 — all green. A fresh python3 scripts/build_sampler.py rebuild left the tree clean, proving both committed devices are byte-identical builds of the fixed source. test_sampler_theme.js failure remains pre-existing and unrelated.

## Checked, no bug filed

- **Loop crossfade scaling chain** — genexpr `Param loop_xfade(0.05,
  min=0, max=0.45)`, UI `storeParam` converts percent via `n * 0.0045`
  clamped 0..0.45, `emitRegionParams` sends `(curXfade / 0.45)` as
  percent, face norm is `curXfade / 0.45` with setter `n * 0.45`, state
  blob clamps to 0.45 on restore. Consistent end to end.
- **`src/mseg_editor.js` `getvalueof`/`setvalueof`** — v2 point stride 4
  and v1 stride 3 bounds checks (`idx + 3 < arr.length` / `idx + 2 <
  arr.length`) are correct for the last point; header minimum lengths
  (14 for v2, 9 for v1) match the 2-point minimums.
- **`src/sampler_modmatrix.js`** — `modPack` code ranges, legacy-cell
  skipping, global-amount scaling (0% = no modulation) and
  `modEncode`/`modDecode` row persistence read consistently; the file is
  headed "for Better Sampler Reactive 2", so it was only checked for
  issues that would also affect the original device. None filed.
- **`src/sampler_config.js` slicers** — `sliceDivisions`, `sliceBeats`,
  `sliceOnsets`, `slicePitches`, `addSliceMarker`/`removeSliceMarker`,
  `activeSliceStarts`, `sliceIndexAt` are covered by
  `tests/test_sampler_slicing.js`; their counts/caps are the *input* to
  Bug 1, not a bug in themselves.
- **Face marker drag clamp** (`src/sampler_face.js:1288–1290`) — markers
  are created with ≥ 0.002 spacing (`addSliceMarker` dedupe), so the
  `lo`/`hi` drag window cannot invert through normal creation paths.
# Clip+ bug sweep — box global shadow (this worktree)

Worktree: `/tmp/bugsweep/clipplus` · Branch: `bugsweep/clipplus` · Base: `69699f7`
Pass-1 tip: `fc083ef` — test(clipplus): red bugsweep case for box global shadow in clipplus_ui.js
Pass-3 tip: `b82f1dc` — fix(clipplus): rename box local that shadowed Max global
Pass-4 tip: (this note) — APPROVED; no further production code changes

## Pass 4 outcome

| Claim | Verdict | Notes |
|-------|---------|-------|
| Bug 2 — `var box` shadows Max global | **APPROVED** | Minimal rename in `cpApplyEmphasisActive`: `box` → `filtGainBox`; red scans src/clipplus_{ui,dsp,meters,curve}.js for `var|let|const` of reserved Max globals; no drive-by refactors. |
| Bug 1 — True Peak unreachable (pre-existing) | Confirm | Untouched this session; host suite still green (`true peak is reachable from a device control`). |

**Approved 1 / adjusted 0.**

## Review notes

- Production change is only `src/clipplus_ui.js` (+4/−4): one local in `cpApplyEmphasisActive` renamed so Max's `box` accessor is not shadowed (Delay+ SIGTRAP precedent). `devices/Clip+.amxd` rebuild is gitignored; not hand-edited.
- Red left as-is after a one-line regex tighten (`\\b(?:var|let|const)\\s+name\\b`) so it actually fails on the unfixed source; not weakened.
- Host gate re-run green in this pass (no Max/Live):
  ```
  npm install && npm run -s typecheck && python3 scripts/build_clipplus.py && node tests/test_clipplus.js && node tests/test_clipplus_bugsweep.js
  → Built devices/Clip+.amxd [406x169 px] (651914 bytes)
  → test_clipplus: ok
  → [bugsweep] true peak is reachable from a device control
  → [bugsweep] clipplus scripts do not shadow Max globals
  → test_clipplus_bugsweep: ok
  ```
- Residual risk: Live pointer-event crash was never re-proven in the VM this pass (pure-Node red + Delay+ precedent only). Face paint / True Peak notes from prior clipplus-2 pass left as noted.
# Degrade - Bug Sweep Pass 1 (bugsweep/degrade, 2026-10-25) - red tests only, no fixes

Device: `devices/Degrade.amxd` - Worktree: `/tmp/bugsweep/degrade` - Branch: `bugsweep/degrade`
Tests: `tests/test_degrade_bugsweep.js` (new file; the first Degrade sweep's D1-D4 reds live in
`tests/test_degrade.js` section 5 and are already fixed in this baseline - see the earlier
"Degrade - Bug Sweep (Pass 1 reds + Pass 2 review)" section above. This is a second sweep on
that post-fix baseline, hunting beyond D1-D4.)
Command: `node tests/test_degrade_bugsweep.js`
Baseline check: `node tests/test_degrade.js` passes clean on this worktree before the new tests.

## Bug D5: FFT glitch helper is not neutral at Glitch = 0% (Denoise and Comb modes)

- **Where:** `src/degrade_config.js` `computeFftGlitchBands()` lines 204-233 (mode 0 boost at
  line 214, mode 3 boost at line 227).
- **What's wrong:** Scramble (mode 1) and Splat (mode 2) return the input bands unchanged at
  `glitchAmt = 0`, matching the real gen~ stage, which is bypassed at `fft_glitch = 0`
  (`fftActive` requires `fftGlitchVal > 0.001`, genexpr line 492, and the stage output is mixed
  in by `fftGlitchVal`, line 1197). But Denoise (mode 0) multiplies every band above 0.35 by
  1.35 regardless of the amount, and Comb (mode 3) multiplies every even band by 1.45
  regardless of the amount, so the shared UI/test simulation helper reports a degraded
  spectrum at the FFT stage's neutral setting.
- **User-visible effect:** Any simulation or preview driven by the helper shows boosted
  spectral bands with the FFT Glitch amount at 0%, i.e. the device appears to alter the
  spectrum when the stage should be transparent.
- **Test:** `D5 fft-glitch-neutral-at-zero` in `tests/test_degrade_bugsweep.js`.
- **Observed failure:** `mode 0 at glitchAmt=0 must return the bands unchanged, got [0.1,1.08,0.2,1.2,0.15,0.945,0.05,0.81]`

## Bug D6: Telecom ADPCM and GSM modes are not neutral at Line = 0%

- **Where:** `src/degrade_config.js` `processTelecomSample()` - ADPCM branch lines 188-196,
  GSM branch lines 198-201 (contrast the u-Law/A-Law blend at lines 170 and 186).
- **What's wrong:** u-Law and A-Law blend toward the companded signal by `amt * 0.85`, so at
  `lineAmt = 0` they return the input exactly. ADPCM and GSM have no amount blend at all:
  ADPCM returns `prev * 0.94 + qDiff` (a flat 6% level loss plus slew limiting even at
  amt = 0), and GSM always returns its tanh-plus-grid-quantized signal. The gen~ agrees with
  the neutral expectation: the TELE stage is gated off at `tele_line <= 0.001` (`telActive`,
  genexpr line 491) and mixed by `teleWet = clip(teleLine * 2.5)` (line 1012).
- **User-visible effect:** In the UI/test simulation, selecting ADPCM or GSM changes the
  signal (level drop, slew limiting, coarse quantization) with the Line amount at 0%, while
  u-Law/A-Law correctly do nothing.
- **Test:** `D6 telecom-neutral-at-zero` in `tests/test_degrade_bugsweep.js`.
- **Observed failure:** `mode 2 at lineAmt=0 must return the input 0.42 unchanged, got 0.3948`

## Bug D7: Wet/dry History defaults contradict the equal-power cache law (Mix 50% changes meaning after Mix is first touched)

- **Where:** `src/degrade_core.genexpr` - History defaults lines 348-350
  (`cWetLat(0.5)`, `cDryG(0.5)`, `cWetG(0.5)`), cache recompute lines 435-439, transparent
  output path lines 1216-1227, and the defaults comment lines 323-326.
- **What's wrong:** The cache computes the documented equal-power gains
  `cWetG = sin(clip(wetSlew, 0, 1) * pi/2)` and `cDryG = cos(asin(cWetG))`
  (`scripts/build_degrade.py` PARAM_SPECS documents Mix as "Equal-power dry/wet mix").
  But `cWetLat` defaults to 0.5 - exactly the slewed Mix default - so at load the cache block
  is skipped and the device runs with the linear History defaults 0.5/0.5. The first time Mix
  is moved and returned to 50%, the gains become 0.7071/0.7071. On the transparent path
  (`runDsp = 0`, `wetOut = in`) the summed output therefore jumps from exact unity
  (0.5 + 0.5 = 1.0) to +3.01 dB (0.7071 + 0.7071 = 1.414), contradicting the output-section
  comment (lines 1209-1213) promising exact 0.0 dB unity at default settings with Mix = 50%.
  Every other cache default in the file matches its formula at the default parameter value
  (`cBitSteps = 2^16`, `cOutLin = dbtoa(0) = 1`, `cOrd0..4 = 1234`); only the wet/dry gains
  disagree.
- **User-visible effect:** A fully neutral Degrade (all stages off/default) is unity gain at
  Mix 50% when first loaded, but +3 dB louder at the same settings after the Mix knob has
  been touched and put back.
- **Test:** `D7 wet-dry-defaults-match-equal-power-law` in `tests/test_degrade_bugsweep.js`.
- **Observed failure:** `cWetG History default 0.5 must equal the equal-power gain at Mix=50% (0.7071067811865475)`

## Bug D8: Undo does not restore stage-enable toggles made from the face

- **Where:** `src/degrade_ui.js` - `cloneState()` lines 60-66, `applySnapshot()` lines 76-84,
  `onclick()` lines 780-793 (undo push + LED toggle), `ondblclick()` lines 848-860.
- **What's wrong:** `onclick()` calls `pushUndoState()` for every pill click, including a
  power-LED click that toggles `stageEnabled[stId]`, so the click appears to be undoable.
  But the snapshot captures only `{ order, vizMode, selectedStage }` - not `stageEnabled` -
  so `undo()` restores an identical snapshot and the toggle silently survives, while still
  pushing a redo entry. (Asymmetry: `ondblclick()` toggles the same state with no undo push
  at all.)
- **User-visible effect:** Toggling a stage on/off from the face's pill LED and pressing undo
  does nothing - the stage stays toggled - even though a snapshot was taken for that click.
- **Test:** `D8 undo-restores-stage-enable-toggle` in `tests/test_degrade_bugsweep.js`
  (loads `src/degrade_config.js` + `src/degrade_dsp.js` + `src/degrade_ui.js` in a vm
  sandbox, clicks the pill-0 LED at (9, 12), then calls `undo()`).
- **Observed failure:** `undo() after an LED toggle must restore stageEnabled[0] to 0 ... 1 !== 0`

## Bug D9: Codec pre-echo taps overrun the 8192-sample delay lines at high sample rates

- **Where:** `src/degrade_core.genexpr` - `Delay codecDL(8192)` / `codecDR(8192)` lines
  358-359, `preDelaySamps = preechoVal * sr * 0.072` line 618, tap block lines 623-628
  (`tapPost = preDelaySamps * 1.35` line 626).
- **What's wrong:** The longest pre-echo smear tap requests `0.072 * 1.35 = 0.0972` seconds
  of history. That exceeds the 8192-sample delay line whenever the sample rate is above
  8192 / 0.0972 ~= 84.3 kHz, so at 88.2 / 96 / 176.4 / 192 kHz (100% Pre-Echo) the tap
  cannot read the sample it asks for and the smear cloud is built from aliased/wrong
  history instead of the documented 72 ms lookahead window. At 192 kHz the request is
  18,663 samples against an 8,192-sample line.
- **User-visible effect:** At high session sample rates the Codec stage's pre-echo smear
  taps read the wrong audio, so the pre-transient bloom is mistimed/corrupted exactly
  where long lookahead is dialled in.
- **Test:** `D9 codec-preecho-taps-fit-delay-line` in `tests/test_degrade_bugsweep.js`.
- **Observed failure:** `codecDL holds 8192 samples but the longest pre-echo tap at 192 kHz / 100% Pre-Echo requests 18663 samples`

## Red run (2026-10-25, this worktree)

```
$ node tests/test_degrade_bugsweep.js
RED  D5 fft-glitch-neutral-at-zero: mode 0 at glitchAmt=0 must return the bands unchanged, got [0.1,1.08,0.2,1.2,0.15,0.945,0.05,0.81]
RED  D6 telecom-neutral-at-zero: mode 2 at lineAmt=0 must return the input 0.42 unchanged, got 0.3948
RED  D7 wet-dry-defaults-match-equal-power-law: cWetG History default 0.5 must equal the equal-power gain at Mix=50% (0.7071067811865475)
RED  D8 undo-restores-stage-enable-toggle: undo() after an LED toggle must restore stageEnabled[0] to 0 (the state its own pushUndoState snapshot was taken from) - 1 !== 0
RED  D9 codec-preecho-taps-fit-delay-line: codecDL holds 8192 samples but the longest pre-echo tap at 192 kHz / 100% Pre-Echo requests 18663 samples
5 red check(s) - exit code 1
```

## Checked and cleared (no bug claimed)

- Order encode/decode/move (`encodeOrderCode` leading-zero code 1234, `decodeOrderCode`
  healing, genexpr sum-10 / product-120 permutation validation) - round-trips correctly.
- Gen u-Law/A-Law quantization vs the JS mirror (fixed as D1 in the first sweep) and the
  output-gain / equal-power / set_mix fixes (D2-D4) - verified still fixed in this baseline.
- Telemetry layout: genexpr poke slots 0/1/2-6/7/8-15/16-27/28-31 match the header comment
  and the UI `pullScope()` offsets, including the slot-7 frame counter.
- UI wiring: the patch routes the v8ui `order_code` / `toggle` / `macro` / `focus` /
  `dsp_resend` outlets (`route order_code toggle macro focus dsp_resend` in
  `scripts/build_degrade.py`); `bits` is a 1.0-16.0 parameter, so the `set_bits` falsy
  fallback never sees a legitimate 0.
- Other control-rate cache defaults (`cBitSteps`/`cBitRcp`, `cOutLin`, `cOrd*`,
  `orderLatch`) all match their formulas at the default parameter values.
- Codec stereo smear uses different tap ordering per channel (L: E1/E2/E3/Post,
  R: E2/E1/Post/E3) - read as intentional stereo decorrelation, not claimed.
- `computeCodecBandGain` neutrality at damage 0, `processBitSample` quantizer math, and
  `computeEffectiveSrRatio` clamping all behave as documented.
---

# Fill — Bug Sweep Pass 1 (bugs + red tests only, no fixes)

- Worktree: /tmp/bugsweep/fill — Branch: bugsweep/fill — Base: 69699f7 (pre-bugsweep baseline)
- Scope read in full: AGENTS.md section 31 (Fill spec), src/fill_config.js, src/fill_dsp.js, src/fill_ui.js, src/fill_core.genexpr, src/fill_conv.genexpr, scripts/build_fill.py; conventions from tests/test_fill.js and tests/test_fill_face.js.
- Baseline on unmodified HEAD: node tests/test_fill.js -> "fill math ok" (exit 0); node tests/test_fill_face.js -> "fill face ok" (exit 0). No production code was changed in this pass.
- Red suite: tests/test_fill_bugsweep.js (new). It collects all failures in one run: 6 of 9 checks FAILED, exit 1; the 3 control/setup checks pass, isolating each bug.

## Bug 1 — Seed 0 sounds exactly like Seed 1 in every JS draw, while the Normal page treats them as different seeds

- Where: src/fill_config.js:135 (fillHash: `Math.imul(Math.round(seed) || 1, 374761393)`), src/fill_config.js:375 (fillRenderAir: `fillBipolar(seed || 1, i, 4)`); contributing call sites src/fill_dsp.js:169, :220, :229-230 (`fillP.seed || 1` in fillPublishIr / fillPublishBank). Contrast: the gen draw fillUnit at src/fill_core.genexpr:26 uses `seedV` as passed, with no 0-to-1 collapse.
- What is wrong: Seed is a real parameter spanning 0..1000 (scripts/build_fill.py, parked Seed slider 0..1000, initial 1). Every JS-side seeded draw replaces seed 0 with seed 1 before hashing, so seed 0 is unreachable as its own seed in fillExperimentalPage, fillRenderAir, fillBodyRoll and fillAirRoll. The DSP call sites collapse it even earlier (`fillP.seed || 1`).
- User-visible effect: setting Seed to 0 on the Experimental page, and in the generated air IR, produces exactly the Seed 1 draw — two different Seed values, one sound — while the same Seed 0 on the Normal page produces the gen seed-0 held draws, so the two pages also disagree about what Seed 0 means.
- Evidence (probe + red run): fillBodyRoll(0, 1) == fillBodyRoll(1, 1) == 0.4753218947444111; fillAirRoll(0, 3) == fillAirRoll(1, 3) == 0.8932553546037525; fillRenderAir(..., seed 0) is byte-identical to seed 1; fillExperimentalPage seed 0 vs seed 1 differ in 0 of 408 slots.
- Red tests (tests/test_fill_bugsweep.js): "Bug A: fillBodyRoll seed 0 differs from seed 1", "Bug A: fillAirRoll seed 0 differs from seed 1", "Bug A: fillRenderAir seed 0 differs from seed 1", "Bug A: fillExperimentalPage seed 0 differs from seed 1" — all 4 FAIL on current code.
- Observed failure: `FAIL - Bug A: fillBodyRoll seed 0 differs from seed 1: Expected "actual" to be strictly unequal to: 0.4753218947444111` (and the equivalent failures for the other three checks).

## Bug 2 — Master Rand 0 does not hold the Experimental page: the allpass g values re-roll every hit when Air > 0

- Where: src/fill_config.js:569-574 (allpass stage g at :571: `g = fillBipolar(seed, hit, 110 + p) * 0.45 * airAmt`). Every meta draw in the same function goes through fillHitDraw with `rand` as master (src/fill_config.js:462-471), so Rand 0 holds every meta at its center; the allpass draw bypasses that master entirely.
- What is wrong: with Master Rand at 0 the page is supposed to be the held center draw — the contract the rest of the function implements and the existing suite pins for the metas ("rand 0 ignores meta ranges", tests/test_fill.js). But the 10 allpass g slots are drawn per hit regardless of rand, so the page still changes on every hit whenever the drawn Air amount is above 0. The gen even clears the resonator state on a new hit (header index 4) so this unintended new draw speaks immediately.
- User-visible effect: with Rand 0 and Air up, successive hits get audibly different allpass diffusion/reverb character even though the user asked for no per-hit variation at all.
- Evidence: fillExperimentalPage(metas{rand:0, air:50, airR:0}, seed 3, hit 1) vs hit 2 differ in exactly the 10 g slots (385, 387, 389, 391, 393, 395, 397, 399, 401, 403) and nowhere else; e.g. slot 385: -0.04176063995109871 (hit 1) vs -0.18523616921156646 (hit 2). Control with air:0 differs in 0 slots.
- Red test: "Bug B: rand 0 page is identical across hits when Air > 0" — FAILS on current code; the companion control "Bug B control: rand 0 page is identical across hits when Air is 0" passes, isolating the allpass draw.
- Observed failure: `FAIL - Bug B: rand 0 page is identical across hits when Air > 0: Expected values to be strictly deep-equal` (diff shows only the g slots, e.g. + -0.04176063995109871 / - -0.18523616921156646 at slot 385).

## Bug 3 — Experimental allpass delays outrun the gen delay lines at 192 kHz: the longest stages collapse to 4094 samples

- Where: JS side src/fill_config.js:560-568 (delays are `Math.pow(capI, p / 9)` with the cap from `0.040 * rate`, so up to 7680 samples at 192 kHz, matching the documented "delay in 1 .. min(40 ms, 0.04*sr)"); gen side src/fill_core.genexpr:295 (`d = clip(delay, 1, 4094);` in fillApPair) with 4096-sample allpass lines (src/fill_core.genexpr:418, Data apMem(81920) = 20 lines x 4096).
- What is wrong: the page generator and the gen disagree about the maximum allpass delay once the sample rate passes ~102.4 kHz. At 96 kHz the largest page delay is 3840 and fits; at 192 kHz the page emits delays up to 7680, which the gen silently clips to 4094, so the top allpass stages (about 5920 and 7680 samples) collapse onto the same 4094-sample delay and the documented 40 ms maximum becomes about 21.3 ms.
- User-visible effect: at 192 kHz (a Live-supported rate) the Experimental air diffusion loses its two longest, most widely spaced stages — a narrower, denser diffusion than the same settings produce at 48/96 kHz.
- Red tests: "Bug C: page delays fit the gen bound at 192 kHz" FAILS; "Bug C setup: gen allpass delay clip found in fill_core.genexpr" and "Bug C control: page delays fit the gen bound at 96 kHz" pass (the bound is parsed out of the gen source, not hard-coded in the test).
- Observed failure: `FAIL - Bug C: page delays fit the gen bound at 192 kHz: 7680 > 4094`.

## Caveat — uncommitted main-checkout changes not in this worktree

- The main checkout has uncommitted user changes to src/fill_core.genexpr and scripts/run_fill_audio_tests.py that are NOT in this worktree; everything above was hunted in the committed code as-is.
- Findings that touch fill_core.genexpr: Bug 3 (its gen side is the clip at fill_core.genexpr:295 and the apMem line length at :418 — those lines may differ in the user uncommitted version; the JS side of the mismatch is in fill_config.js) and Bug 1 only by contrast (fillUnit at fill_core.genexpr:26 uses the seed as passed). Bug 2 and the JS/DSP side of Bug 1 are entirely in src/fill_config.js and src/fill_dsp.js, which are not part of the uncommitted changes. scripts/run_fill_audio_tests.py was not touched or relied on.

## Checked and cleared (no bug claimed)

- Parameter ranges/defaults agree across scripts/build_fill.py (NORMAL / EXP / IR tables), fillP defaults in src/fill_ui.js, gen Param defaults in src/fill_core.genexpr, and the FILL_OUT scaling in src/fill_ui.js (percent knobs /100; tune/tuner/space/spacer native; beater/metal /100 so 200 -> 2). The gen held-tune clip of -48..48 vs the -24..24 knob is a harmless superset.
- Buffer geometry agrees everywhere: body/air IR buffers 65688 x 4 floats (bank stride 65688, head 16512 + tail 49176, tail spectra at offset 16512 in both JS fillWriteBank and gen fillIrBin/fillConv), scope buffer 64 with JS peeking 40, bank buffer 832 = header 16 + 408 + spare 408.
- Per AGENTS.md section 31, these are by design and were not claimed: the gen always reads the bank page at index 16 (header index 0 stays 0; the copy at 16+408 is a spare), pole input floor max(1 - r, 0.08), couple as the orthogonal mix, btos/btoe-style IR header messages, hit clearing while the transport is stopped (play comes from plugsync~).
- Experimental mode frequencies: probed over a 27-point grid of sample rates (44100 / 48000 / 192000) x mass x scatter — always strictly increasing with a minimum gap of 2 Hz, pole radii inside (0, 1) and at/under the RT60 cap, allpass g inside +-0.45, weights summing to 1. The 0.45 * Nyquist top-frequency cap in fillExperimentalPage looks deliberate and was not claimed.
- Onset: the JS fillOnset ratio (fillDbToLin((1 - sens) * 12)) matches the gen detector formula; 40 ms holdoff on both sides. Latency 1536 (256 + 1024 + 256) agrees across fill_config.js, the patcher, and the face report. Legacy helpers in fill_config.js that the current face never calls (fillWindow, fillStepU, link/morph-snap state, the 768-wide FILL_LAYOUT) were read but not claimed — no user-visible effect.

## Red run summary (this worktree)

```
node tests/test_fill.js          -> fill math ok (exit 0)
node tests/test_fill_face.js     -> fill face ok (exit 0)
node tests/test_fill_bugsweep.js -> exit 1
  FAIL - Bug A: fillBodyRoll seed 0 differs from seed 1 (0.4753218947444111 == seed 1)
  FAIL - Bug A: fillAirRoll seed 0 differs from seed 1 (0.8932553546037525 == seed 1)
  FAIL - Bug A: fillRenderAir seed 0 differs from seed 1 (air IR byte-identical to seed 1)
  FAIL - Bug A: fillExperimentalPage seed 0 differs from seed 1 (0 of 408 slots differ)
  FAIL - Bug B: rand 0 page is identical across hits when Air > 0 (only slots 385-403 odd differ)
  FAIL - Bug C: page delays fit the gen bound at 192 kHz (7680 > 4094)
  ok   - Bug B control (Air 0), Bug C setup (clip found), Bug C control (96 kHz fits)
  test_fill_bugsweep: 6 of 9 checks FAILED
```

3 bugs found. Fixes are a later pass, after a Pass 2 review culls false positives.
---

# Multiband Split — bugsweep pass 1 (new run)

Branch: `bugsweep/mbsplit` · Worktree: `/tmp/bugsweep/mbsplit` · Base: `69699f7` (pre-bugsweep baseline; the earlier Pass 1–4 section above was a previous sweep whose two fixes — volume-slider dead zone, FIR display approximation — are already in this baseline and pass: `node tests/test_mbsplit_pass1.js` is green).

**Four credible bugs found.** All have RED tests in `tests/test_mbsplit_bugsweep.js` (new file; the existing `tests/test_mbsplit.js` and `tests/test_mbsplit_pass1.js` are untouched, and none of these cases duplicate them). No `src/` files were modified — fixes are Pass 3.

Test run on the unfixed tree: `node tests/test_mbsplit_bugsweep.js` → **4 of 4 checks FAIL**, each for the reason stated below; exit code 1.

## Bug 1 — Auto Chain band mask clamps to the last band instead of wrapping

- **Where:** `src/mbsplit_config.js:184` `resolveEffectiveBandMask` (spec comment at `:176-183`, clamp at `:189-190`)
- **What's wrong:** The function's own header documents mode 0 (Auto Chain) as "solos Band (chainIndex % numBands) + 1", but the code computes `clamp(chainIndex, 0, nb - 1)`. For any chain index at or past the band count the mask sticks on the last band instead of wrapping around to Band 1.
- **User-visible effect:** In a rack with more chains than the current band layout wraps (or any caller passing a raw chain index ≥ numBands), the 4th/5th/… splitter keeps outputting the top band: the rack sum double-weights the high band and no chain wraps to the low band, contradicting the documented Auto Chain assignment.
- **Test:** "Auto Chain band mask wraps with chainIndex % numBands (defect: resolveEffectiveBandMask clamps to the last band instead of wrapping)"
- **Observed failure:** `Auto Chain mask does not wrap: chainIndex 3 / numBands 3 -> mask 4 (documented wrap gives 1); chainIndex 4 / numBands 3 -> mask 4 (documented wrap gives 2); chainIndex 5 / numBands 4 -> mask 8 (documented wrap gives 2); chainIndex 6 / numBands 2 -> mask 2 (documented wrap gives 1)` (in-range indices 0..numBands-1 are correct and asserted as sanity checks in the same test)

## Bug 2 — Volume (and handle) double-click is handled twice; the first undo after it is a no-op

- **Where:** `src/mbsplit_ui.js:1666-1679` (`onclick` volume double-click branch) together with `src/mbsplit_ui.js:1775-1787` (`ondblclick`); same pattern for crossover handles at `:1739-1749` and `:1788-1797`; `pushUndoState` at `:916`
- **What's wrong:** A double-click gesture is delivered as `onclick`, `onclick`, `ondblclick` — the sequence `onclick`'s own 320 ms `lastClickTarget`/`lastClickTime` detection is built for. Both the second `onclick` and `ondblclick` run the reset AND push an undo snapshot. The `ondblclick` snapshot is taken *after* the reset, so it lands on top of the undo stack; the user's first undo reapplies the post-reset state and appears to do nothing (a second undo is needed to get the pre-gesture value back).
- **User-visible effect:** Double-click the volume slider (or a crossover handle) to reset it, then press undo once: nothing happens. Undo history is also polluted with duplicate/phantom entries for a single gesture.
- **Test:** "one undo after a volume double-click reset restores the pre-gesture gain (defect: double-click handled twice, post-reset snapshot tops the undo stack)"
- **Observed failure:** `first undo after the double-click reset must restore 12.0 dB, got 0 dB (the top undo snapshot was taken after the reset, so undo is a no-op)` — `0 !== 12`

## Bug 3 — Undo cannot restore a manual band count (snapshot drops `manualBandsOverride`)

- **Where:** `src/mbsplit_ui.js:900-913` `snapshotState`, `:922-939` `applySnapshot`; `manualBandsOverride` declared at `:19`, set by `set_numbands` at `:1109-1121`, consumed by `computeDetectedBandCount` at `:530-538`
- **What's wrong:** The undo snapshot stores `numBands` but not `manualBandsOverride` — the flag/value that makes a manual count stick against auto-detection. `applySnapshot` writes `curNumBands` from the snapshot while the override stays `null`, so auto-detection recomputes the detected count over the restored one (this already happens inside `applySnapshot`'s own `broadcastLinkedState`, and again at the next 250 ms topology poll).
- **User-visible effect:** Set a manual band count, change it back to Auto, then undo: the face may briefly show the manual count but it silently reverts to the auto-detected count within a poll tick — the undo is lost. (Distinct from `setvalueof`, where ignoring the saved count in Auto mode is pinned as intended by the main suite's Cmd+D case.)
- **Test:** "undo restores a manual band count durably (defect: undo snapshot drops manualBandsOverride, auto-detection reverts the undo)"
- **Observed failure:** `undo must restore manualBandsOverride = 4, got null (snapshotState/applySnapshot never save or restore it)` — `null !== 4` (and after one `pullScope()` the count is back to the detected 1)

## Bug 4 — Band-pill hover highlight is tracked but never painted

- **Where:** `src/mbsplit_ui.js:1863-1870` (`onidle` maintains `hoverBandIdx`), `:1874-1877` (redraw on hover change), but `paint` at `:2204-2210` calls `mbControl(..., false, ...)` for every band pill — the `hot` argument (`src/mbsplit_ui.js:2133`) is hard-coded off
- **What's wrong:** Every other hoverable control renders its hover state (Auto button passes `hoverAutoBtn`, the volume slider and link badge and crossover handles all use theirs), and `onidle` goes to the trouble of tracking pill hover and forcing redraws when it changes — but the paint path never reads `hoverBandIdx`, so those redraws repaint a byte-identical frame.
- **User-visible effect:** Hovering a band pill gives no visual feedback, unlike every neighbouring control; the hover state and its redraws are dead work.
- **Test:** "paint renders the band-pill hover highlight (defect: hoverBandIdx is tracked but paint always passes hot=false for the pills)"
- **Observed failure:** `hovering band pill 3 produced a byte-identical paint to no hover: the pill hover highlight is never rendered` (draw-command streams compared with `hoverBandIdx = -1` vs `2` are deep-equal)

## Checked and cleared (no bug claimed)

- `sanitizeCrossovers` (all four activeIdx branches, incl. extremes at 20 Hz / 20 kHz): the gap invariant F1·r ≤ F2·r ≤ F3 survives every branch, including the un-clamped-looking assignments in branches 0 and 2 (their inputs are pre-clamped so the products stay in range).
- GenExpr vs JS reference twins: dynamic-phase band assembly (`mbsplit_core.genexpr:890-897` vs `createReferenceSplitterDsp.processSampleDynamic`), LR2/LR4/LR8 stage maths, mask-bit extraction, gain −69.5 dB mute threshold in gen / `formatGainDb` / slider pair — all consistent. Scope slot layout (16–21 peaks, 23 beat, 24 ringPos = next-write = oldest sample, 25 sr, 26 firD, 28 need bits, 29 asleep) matches the face's reads.
- `setvalueof` ignoring the saved `numBands` in Auto mode, solo selections seeding `curCustomMask`, and the right-edge pill multi-toggle: all pinned as intended by `tests/test_mbsplit.js` (§6b, §10/§11) — not re-claimed.
- The gen `phase` Param (phaseSign) has no sender in the face or the built patcher; it defaults to 0 (+1) and no control promises phase inversion — dead parameter, noted only.
- `firLowpassMagCache` (config) grows by one small kernel per distinct crossover value with no eviction; noted as a smell, not claimed — no node-observable failure could be pinned to it at the pass bar.
# Percipitator — bug sweep pass 1 (hunt + red tests)

Worktree: `/tmp/bugsweep/percipitator` on branch `bugsweep/percipitator` (pre-bugsweep baseline).
Scope: pass 1 only — hunt + failing tests, **no fixes in `src/`**.
Device files read in full: `src/percipitator_config.js`, `src/percipitator_core.genexpr`,
`src/percipitator_dsp.js`, `src/percipitator_ui.js`, `scripts/build_percipitator.py`,
plus the shipped patcher parameter ranges extracted from `devices/Percipitator.amxd`
and the conventions of `tests/test_percipitator.js`.

**Result: 3 credible bugs, each with a red test in `tests/test_percipitator_bugsweep.js`.**

Run: `node tests/test_percipitator_bugsweep.js` → exit 1, all 3 checks failing:

```
FAIL - gate setvalueof round-trip preserves -63 dB: gate round-trip is lossy: saved -63 dB, restored -60 dB
FAIL - volVisualScale is continuous across -35.5 dB: volVisualScale jumps 0 -> 0.13031667784522993 between -35.6 and -35.4 dB
FAIL - init_dsp can retry after final DSP load timeout: DSP load is permanently dead after final timeout: init_dsp scheduled 0 task(s), gen~ creates still 3
test_percipitator_bugsweep: 3 of 3 checks failing (RED pass 1)
```

---

## Bug 1 — Gate values below −60 dB are silently raised to −60 dB on preset/state restore

- **Where:** `src/percipitator_ui.js:322` (`setvalueof`), inconsistent with
  `src/percipitator_ui.js:227` (`set_gate`) and `src/percipitator_core.genexpr:360`.
- **What is wrong:** The gate's working range is −66…−6 dB everywhere except in
  state restore: `set_gate` clamps with `clamp(Number(db) || -42.0, -66.0, -6.0)`
  and the gen core slews `clip(gate, -66, -6)`. `getvalueof()` returns the stored
  gate verbatim (`[2, curScaleMask, curGateDb]`). But `setvalueof()` restores it
  with `clamp(Number(v[2]), -60.0, -6.0)` — the −60 floor appears nowhere else.
- **User-visible effect:** Any saved gate in [−66, −60) dB (e.g. −63 dB, settable
  through `set_gate` and honoured by the DSP) comes back as exactly −60 dB after a
  Live Set / preset reload: the resynthesis gate is audibly more open than the user
  saved, with no indication anything changed. Save/load is lossy for exactly the
  values the rest of the device treats as legal.
- **Test:** `gate setvalueof round-trip preserves -63 dB` in
  `tests/test_percipitator_bugsweep.js` — `set_gate(-63)`, `getvalueof()`,
  scramble, `setvalueof(saved)`, expect −63.
- **Observed failure:** `gate round-trip is lossy: saved -63 dB, restored -60 dB`.

## Bug 2 — `volVisualScale` pops the partial bars from 0 to ~13 % height at −35.5 dB Vol

- **Where:** `src/percipitator_ui.js:80-84` (`volVisualScale`).
- **What is wrong:** The function documents itself as a *smooth* visual height
  multiplier that is 0 at −36 dB and 1.0 at 0 dB. It special-cases
  `curVolDb <= -35.5` to return exactly 0, but immediately above the cutoff the
  formula branch `clamp(Math.pow(10, curVolDb / 40), 0.08, 1.45)` already yields
  ≈ 0.130 (at −35.4 dB). The multiplier is discontinuous: a 0.2 dB Vol change
  across −35.5 dB jumps the rendered bar height by 13 % of full scale.
- **User-visible effect:** Dragging Partials Vol through ≈ −35.5 dB makes all 16
  partial bars (and peak-hold caps, which use the same scale) visibly pop in/out
  instead of fading smoothly to zero at the bottom of the Vol range.
- **Test:** `volVisualScale is continuous across -35.5 dB` — samples the scale at
  −35.6 dB and −35.4 dB and requires the step to be ≤ 0.05.
- **Observed failure:** `volVisualScale jumps 0 -> 0.13031667784522993 between -35.6 and -35.4 dB`.

## Bug 3 — After the deferred-DSP load times out for the last time, the device can never load its DSP again

- **Where:** `src/percipitator_dsp.js:119-124` (final confirm-timeout branch),
  interacting with the guards at `src/percipitator_dsp.js:60` (`pcpDspLoad`) and
  `src/percipitator_dsp.js:133` (`pcpDspSchedule`).
- **What is wrong:** The retry branch (`src/percipitator_dsp.js:108-117`) cleans up
  correctly: it removes the dead `gen~`, resets `pcpDsp.createdAt = 0`, and loads
  again. The final-timeout branch does neither — it sets
  `pcpDsp.error = "not running"`, releases the create-queue claim, and returns,
  leaving `createdAt` non-zero and the never-started `gen~` in the patcher. Both
  entry points then refuse to run forever: `pcpDspSchedule()` returns early while
  `pcpDsp.createdAt` is set, and `pcpDspLoad()` has the same guard. A fresh
  `init_dsp` from `live.thisdevice` is a no-op.
- **User-visible effect:** If a gen~ creation attempt hits the known "first gen~ is
  never added to the DSP chain" failure on all three attempts (1 × 3.5 s + 2 × 6 s),
  the instance is permanently silent with only the "DSP failed: not running" pill —
  no later device re-enable, set reload event, or `init_dsp` can recover it; the
  user must delete and re-add the device. The exception path in `pcpDspLoad` does
  not have this problem (it never sets `createdAt` before the throw), so the two
  failure paths are also inconsistent.
- **Test:** `init_dsp can retry after final DSP load timeout` — drives the loader
  with a fake clock and a scope frame counter that never advances through all
  three attempts, asserts the "not running" error is recorded, then calls
  `init_dsp()` again and requires a new load attempt to be scheduled/started.
- **Observed failure:** `DSP load is permanently dead after final timeout: init_dsp scheduled 0 task(s), gen~ creates still 3`.

---

## Checked and cleared (no credible bug found)

- **JS ↔ GenExpr mirrors:** `computeSieveGain` vs `sieve_one`, `computeTiltGain`
  vs `tilt_one` (±36 dB / 64× endpoints exact), `warpPhase` vs `warp_phase`
  (Bend/Asym/Sync/Fold, incl. Bend neutrality at warp 0.5), `quantizeMidiToScale`
  vs `quant_midi` (±11 semitone search, same tie-breaking), `BAND_FREQS` vs
  `band_hz` (identical 16 centres), `evalWavetableSample` frame/phase
  interpolation vs `voice_osc`.
- **Wavetable generation:** frame construction (Sine/Triangle/Saw/Square),
  DC removal and 0.98 peak normalisation, sample bounds.
- **Sidechain MIDI latch:** `midi_in` writing the chord mask into `curScaleMask`
  on note-off is intentional — `tests/test_percipitator.js` explicitly asserts
  "MIDI note-off must latch last played chord mask". Not a bug.
- **`Number(x) || default` setters:** for Decay / Attack / Stretch the shipped
  controls never deliver 0 (`parameter_mmin` is 1 ms / 0.2 ms / 50 % in the
  `.amxd`), so the falsy-zero fallback is unreachable there; for the remaining
  setters 0 and the fallback coincide or clamp identically.
- **Parameter wiring & scaling:** every `PARAM_SPECS` entry's gen message and
  scale (×0.01 for percent-like params) matches the gen `Param` units;
  `pcpDspResend` correctly sends wtpos/warp as percents (the `route` scales them)
  and everything else in gen units; Mix uses the equal-power `cos/sin` law in gen.
- **Scope contract:** UI reads 36 slots of the 64-sample `#0-percipscope` buffer;
  gen writes amps 0–15, quantized notes 16–31, peak/active/gate/frame-counter at
  32–35 as documented.
- **Instance isolation:** audio buffers are `#0-`-prefixed per instance; the only
  shared global (`percipitator_dspq`) is the intentional create-serialisation
  queue, and the shared `/tmp` gen file is content-hashed and identical across
  instances.
---

# Reciprocator — Bug Sweep (pass 1 reds)

Branch: `bugsweep/reciprocator`
Worktree: `/tmp/bugsweep/reciprocator`
Baseline: `69699f7` (pre-bugsweep; prior Delay/linkAmt/gateMix/gate-curve fixes already present and green)

## Pass 1 outcome

| Claim | Verdict | Notes |
|-------|---------|-------|
| Bug A — `#0-recipscope` shared across instances | **CLAIMED (RED)** | Top-level Live device; `#0` not expanded. Same class as Amp+/EnvTrig/Cepstra/Tiny Space/mbsplit. |
| Prior bugs 1–4 (gate curve / lookahead / Detect link / gateMix) | Cleared | Already fixed at baseline; `node tests/test_reciprocator.js` → ok; section 9 green. |
| Gate/Ceiling viz drag undo | Noted, not claimed | Outlets `set` into live.dials with no `pushUndoState`; live.param undo path differs from blob MSEG rule — not promoted. |
| Gen vs JS gate/ceiling mirror | Cleared | `computeGateFactor` / `computeRecipGain` match `gate_smooth` / recip path; Amount-0 mute contract holds. |

**Claimed 1 / noted 1 / cleared prior 4.**

## Bug A (claimed): Scope buffer `#0-recipscope` is shared by every instance

- **Where:** `scripts/build_reciprocator.py` (`buffer~ #0-recipscope @samps 32`, `scope #0-recipscope`, `setbuffer #0-recipscope`); comments in `src/reciprocator_core.genexpr` / `src/reciprocator_config.js`; existing `tests/test_reciprocator.js` still requires `#0-`.
- **Evidence:** AGENTS.md documents that Live does not expand `#0` in a top-level device patcher (Multiband Split / Glitch / Delay+). Peer devices migrated to `---…`. Reciprocator is a top-level `.amxd`, so every instance writes the same 32-sample scope ring and faces paint each other's telemetry.
- **Impact:** Multi-instance sets show wrong ENV/OUT/gate meters; deferred DSP frame counter is also shared.
- **Red:** `tests/test_reciprocator_bugsweep.js` — asserts build + amxd use `---recipscope` and contain no `#0-recipscope`.
- **Host proof (pass 1):**
  ```
  node tests/test_reciprocator.js → test_reciprocator: ok
  node tests/test_reciprocator_bugsweep.js → AssertionError Bug A RED (exit 1)
  ```
- **Status:** RED. Pass 3 will flip build/bind messages to `---recipscope`, rebuild the amxd, update `test_reciprocator.js` `#0-` asserts, and clear gen/config comments.

## Pass 2 review (this sweep — kept 1 / dropped 0)

| Bug | Verdict | Why |
| --- | --- | --- |
| A `#0-recipscope` shared | KEEP | Top-level Reciprocator.amxd; Live does not expand `#0`. Same class as Amp+/EnvTrig/Cepstra. Face uses setbuffer(name) dynamically; only build/bind/amxd + comments + host suite asserts need flipping. Red reaches build + amxd; not weakened. |

## Pass 3 fixes (this sweep)

Host gate (worktree): `npm install && npm run -s typecheck && python3 scripts/build_reciprocator.py && node tests/test_reciprocator.js && node tests/test_reciprocator_bugsweep.js` → green.

### Bug A: `#0-recipscope` → `---recipscope`

- Fix: `scripts/build_reciprocator.py` — `buffer~ ---recipscope @samps 32`, `scope ---recipscope`, `setbuffer ---recipscope`.
- Comments: `src/reciprocator_core.genexpr`, `src/reciprocator_config.js`.
- Host suite: `tests/test_reciprocator.js` isolation asserts now require `---` (was `#0-`).
- Rebuild: `devices/Reciprocator.amxd`.
- Red left intact in `tests/test_reciprocator_bugsweep.js`.
- Harness keeps its own `#0-recipscope` (same pattern as mbsplit harness).

## Pass 4 review (this sweep — APPROVED)

Worktree: `/tmp/bugsweep/reciprocator` on `bugsweep/reciprocator`
Pass-3 tip: `a07e217` — isolate scope with `---recipscope`
Pass-4 tip: (this commit) — APPROVED; no production code changes

| Claim | Verdict | Why |
|-------|---------|-----|
| Bug A — `#0-recipscope` shared | **APPROVED** | Minimal rename `#0-recipscope` → `---recipscope` in build bind messages + comments; host suite flipped to require `---`; bugsweep red intact; harness keeps `#0-`. |
| Prior bugs 1–4 | Confirm | Untouched this sweep; still green at baseline. |
| Viz drag undo (noted) | Leave noted | Not promoted. |

**Approved 1 / adjusted 0.**

Host gate (pass 4): `npm run -s typecheck && python3 scripts/build_reciprocator.py && node tests/test_reciprocator.js && node tests/test_reciprocator_bugsweep.js` → green.
# Reverb+ — Bug sweep, Pass 1

Scope read for this pass: `src/reverbplus_config.js`, `src/reverbplus_dsp.js`,
`src/reverbplus_engine.js`, `src/reverbplus_link.js`, `src/reverbplus_face.js`,
`src/reverbplus_face_common.js`, `src/reverbplus_face_ir.js`, `src/reverbplus_face_math.js`,
`src/reverbplus_panels.js`, `src/reverbplus_end_ui.js`,
`src/reverbplus_start.genexpr`, `src/reverbplus_end.genexpr`, `src/reverbplus_conv.genexpr`,
the parameter table / `RP_GEN_PARAMS` generation in `scripts/build_reverbplus.py`, and
`AGENTS.md`. The existing suites were used as the coverage map: config math, the derived
outer loop, the IR pipeline functions, the convolution engine, pairing, face mappings and
the build's parameter table are all already pinned by `tests/test_reverbplus.js` /
`tests/test_reverbplus_face.js`, and every cross-check there (gen ↔ JS mirror formulas,
header/scope slots, gen-message divisors, defaults) agreed.

Baseline suite state in this worktree: `node tests/test_reverbplus.js` = 29 passed,
2 failed — both failures are the *build* step inside the layout tests failing with
`Cannot find module 'terser'` (node_modules not installed in this fresh worktree), not a
device-code failure; the same cause cascades into `tests/test_reverbplus_face.js`. All
pure source-level tests pass. The two bugs below are in the engine's IR lifecycle, which
the existing tests exercise only for the no-work-in-flight cases (anydrop, clear_ir
replay). Both share one root cause: **sliced IR work (`rpIr.work`, driven by the repeating
`rpIr.workTask`) is never invalidated when the IR it belongs to is cleared or replaced,
and `rpIrPublish` unconditionally writes its results into the live state.**

Tests: `tests/test_reverbplus_bugsweep.js` — run with
`node tests/test_reverbplus_bugsweep.js`. Result: **0 passed, 2 failed** (both red, each
for the reason stated). No `src/` files were modified in this pass.

---

## Bug 1 — Clearing an IR while it is still processing resurrects it as a phantom "loaded" IR in an error state

- **Where:** `src/reverbplus_engine.js` — `clear_ir` (lines 171–182) never touches
  `rpIr.work` / `rpIr.workTask`; `rpIrWork` / `rpIrPublish` (lines 280–348) then publish
  the stale work anyway.
- **What's wrong:** Processing a large IR is sliced over many Task ticks
  (`rpIrWork` runs ~6 ms of partition FFTs per 8 ms tick), so there is a window of up to
  seconds where the user can press the IR box's clear (×) button while
  `rpIr.status === "processing"`. `clear_ir` nulls `rpIr.src`, sets `loaded = false`,
  `status = "idle"` and pokes header `IR_LOADED = 0` — but the in-flight work keeps
  running. When it finishes, `rpIrPublish` executes against the cleared state: it flips
  the bank, sets `rpIr.loaded = true` (line 328) and `rpIr.len`, and then dereferences
  the nulled source at line 330 (`rpIr.sr = rpIr.src.sr`), which throws. Its own
  try/catch converts that into `rpIr.status = "error"`. The header writes at the end of
  `rpIrPublish` (bank / counts / `IR_LOADED`) are never reached, so JS state and gen
  state also disagree afterwards.
- **User-visible effect:** Clear an IR while it is still processing and, a moment later,
  the device reports **IR ERROR** and believes an IR is loaded (`state ir` broadcasts
  `loaded = 1` with an empty name) instead of the clean "no IR" state the user asked
  for. The face shows the IR-error pill, and the display's IR spectrogram path
  (`rcIrEnsure`) arms itself for an IR that does not exist.
- **Test:** `clear_ir during IR processing: the in-flight publish must not resurrect the cleared IR`
  in `tests/test_reverbplus_bugsweep.js`.
- **Observed failure:**
  ```
  FAIL clear_ir during IR processing: the in-flight publish must not resurrect the cleared IR: AssertionError [ERR_ASSERTION]: completing the in-flight work after clear_ir must not mark an IR loaded again

  true !== false
  ```

## Bug 2 — Dropping a new IR while the previous one is still processing silently loses the new file

- **Where:** `src/reverbplus_engine.js` — `rpIrLoad` (lines 184–200) does not invalidate
  in-flight work from the previous load; `rpIrPublish` sets `rpIr.status = "ready"`
  (line 333); `ir_loaded` ignores its notification unless `rpIr.status === "loading"`
  (lines 203–204); the `dropfile` de-dupe is at line 120.
- **What's wrong:** Drop IR **B** while IR **A** is still being processed (same sliced
  window as Bug 1). `rpIrLoad(B)` sets `status = "loading"` and hands B to `buffer~`,
  but A's sliced work is still running. It finishes first and `rpIrPublish` flips
  `status` to `"ready"` and `loaded` to `true`. When `buffer~` then finishes loading B
  and fires `ir_loaded`, the guard `if (rpIr.status !== "loading") return;` discards it:
  B is never read, never processed, and `rpIr.src` still holds A. The 8-second load
  watchdog does not fire either, because it only errors while the status is still
  `"loading"`. The state is now stuck: the UI shows B's file name with A's length and
  A's sound. Recovery by re-dropping B is blocked by the de-dupe in `dropfile`
  (`p === rpLastDropped && rpIr.loaded` — both now true for B), so the user must drop a
  different file, clear the IR, or reload the device.
- **User-visible effect:** Dropping a second IR in quick succession (e.g. correcting a
  wrong file drop while the first is still processing) leaves the device playing the
  *old* IR while displaying the *new* file's name, with no error shown, and the obvious
  retry — dropping the same file again — does nothing.
- **Test:** `dropping a new IR while the previous one is still processing: the new file must still load`
  in `tests/test_reverbplus_bugsweep.js`.
- **Observed failure:**
  ```
  FAIL dropping a new IR while the previous one is still processing: the new file must still load: AssertionError [ERR_ASSERTION]: ir_loaded for the new file must start its processing even though stale work published in between
  + actual - expected

  + 'ready'

  0 passed, 2 failed
  ```

---

### Notes for Pass 2 (things checked and deliberately NOT filed)

- The derived-loop / tank formulas in `reverbplus_start.genexpr` match the JS mirrors in
  `reverbplus_config.js` exactly (K table, `rpLoopApDelay` 0.75 × summed diffuser
  lengths, gain cap 0.97, bass shelf exponent, Convolution period/gain references), and
  the parameter table in `scripts/build_reverbplus.py` matches the gen on every range,
  default and divisor — consistent with the existing tests that pin them.
- `face_common`'s "keep animating for about 2 s after silence" comment understates the
  real window (90 poll ticks at the face's 20 fps = 4.5 s), but 4.5 s is what the
  28-row × 150 ms waterfall needs to scroll out, so the behaviour looks intended and
  only the comment is stale — not filed as a bug.

## Pass 2 review — kept 2 / dropped 0

Re-read `src/reverbplus_engine.js` IR lifecycle (`clear_ir`, `rpIrLoad`, `ir_loaded`,
`rpIrReprocess`, `rpIrWork`, `rpIrPublish`) against `tests/test_reverbplus_bugsweep.js`
and re-ran the suite on tip `c97d473` (after this worktree's `npm install` restored the
host gate: `node tests/test_reverbplus.js` green). Both reds still fail with the exact
messages claimed in Pass 1. Pass-1 commit only touched `BUGS.md` and the bugsweep test
file — no `src/` changes to re-review.

| Bug | Verdict | Why |
| --- | --- | --- |
| 1 — clear during processing resurrects a phantom loaded/error IR | **KEEP** | `clear_ir` (171–182) already clears the `live.drop` path (`outlet(4,"")`) but never cancels `rpIr.workTask` / `rpIr.reproTask` or nulls `rpIr.work`. Stale `rpIrWork` still calls `rpIrPublish`, which unconditionally sets `loaded = true` (328) then throws on `rpIr.src.sr` (330) → `status = "error"`. RED asserts unloaded + idle + no `IR_LOADED=1` header poke; fails on `true !== false` for `loaded`. Real user-visible race; test targets the right surfaces. No rewrite. |
| 2 — drop while processing silently loses the new file | **KEEP** | `rpIrLoad` (184–200) never invalidates in-flight work. Stale `rpIrPublish` flips `status` to `"ready"`; subsequent `ir_loaded` for B hits `if (rpIr.status !== "loading") return;` and is discarded. RED drops B during A's processing, lets A publish, then fires `ir_loaded`; fails with actual `'ready'` vs expected `'processing'`. Same root cause as Bug 1; distinct user path (replace, not clear). No rewrite. |

**Dropped:** none.

**Adjusted:** none — desired post-fix states match what a correct invalidate must produce
(null `work`, cancel the Task, and either stay idle after clear or re-enter processing for
the new file). Fix direction for Pass 3 (not applied here): one shared invalidate helper
called from `clear_ir` and `rpIrLoad` that cancels `workTask` / `reproTask` / `loadTask` as
appropriate and nulls `rpIr.work` (and, on clear, `rpIr.src`), so a late `rpIrPublish`
cannot run; optionally also guard `rpIrPublish` / `rpIrWork` so a generation token or a
null `work` short-circuits.

## Pass 3 — fixes applied (bugsweep 2/0, host 31/0)

Shared helper `rpIrInvalidateWork` in `src/reverbplus_engine.js` cancels `rpIr.workTask` /
`rpIr.reproTask` (`.cancel` guarded for Node Task stubs that only implement `schedule`)
and nulls `rpIr.work`. Both `clear_ir` and `rpIrLoad` call it after cancelling a pending
`loadTask`, so a late `rpIrWork` tick cannot reach `rpIrPublish` against cleared or
replaced state. Clear still nulls `src` / `loaded` / status as before; load still enters
`"loading"` for the new path. Bugsweep slice updated to grab the helper. Commit
`22a04c4` on `bugsweep/reverbplus`.

## Pass 4 — final review (APPROVED)

| Bug | Verdict | Why |
| --- | --- | --- |
| 1 — clear during processing resurrects a phantom loaded/error IR | **APPROVED** | Invalidate + loadTask cancel before the clear path mutates state; RED still asserts unloaded + idle + no `IR_LOADED=1` after forcing the stale publish. Minimal; no test weakening. |
| 2 — drop while processing silently loses the new file | **APPROVED** | Same helper at the top of `rpIrLoad` so stale A cannot flip status to `"ready"` before B's `ir_loaded`. RED still expects `"processing"` after B loads. No generation-token guard added — cancel + null `work` is enough for the reds. |

**Adjusted:** none. No follow-up code changes in this pass. Host gate re-verified green on tip `22a04c4` (`node tests/test_reverbplus_bugsweep.js` + `node tests/test_reverbplus.js`). Not merged to main.


---

# Bug sweep — Transient Split (transplit), Pass 1 (2026-10-25)

Worktree: `/tmp/bugsweep/transplit` · Branch: `bugsweep/transplit` · Base: `69699f7` (pre-bugsweep baseline)
Scope: `src/transplit_config.js`, `src/transplit_core.genexpr`, `src/transplit_ui.js`, shared `src/spectral_split_lib.genexpr` / `src/spectral_link.js` / `src/spectral_dsp.js` / `src/spectral_split_rack_main.genexpr`, `scripts/build_transplit.py`, `scripts/spectral_common.py`.
Method: full read of the device sources against AGENTS.md sections 22/23, the existing suite (`node tests/test_transplit.js`, incl. spectral rack / deferred-DSP / paint-bounds — all green), a rebuild check (`python3 scripts/build_transplit.py` reproduces the committed `.amxd` / `.adg` with no drift), and a diff against the previous transplit sweep's base `66fea67` (see the Pass 4 section above; its one bug — stale tilt gains on a sample-rate change — is fixed in this baseline via `cgSr` and its regression test is green, so it is not re-claimed).

**Found: 1 bug.**

## Bug 1 — Size parameter's Live help (and the build docstring) claim the latency stays 4096; the device reports and delays 5120

**Where:** `scripts/build_transplit.py:69` (`ENUM_HELP["size"]`) and `scripts/build_transplit.py:8` (module docstring). The help text is baked into the shipped device: `make_theme_tab` -> `make_tab` stores it as `parameter_info` on `obj-ctrl-size` in `devices/Transient Split.amxd`, so it is what Live's Info View shows for the Size parameter.

**What is wrong:** The help says "The latency stays 4096 samples at every size." and the docstring says the chains sum back "delayed by 4096 samples (`"latency": 4096`)". Every functional value in the device is 5120 (`RACK_LATENCY` = 4096 + the 1024 host-block margin of the rack machinery): the patcher's `latency` attribute is 5120, the gen dry delay is `Delay dryL(5121)` / `dryL.read(5120)`, `TS_LATENCY` = 5120 in `src/transplit_config.js`, the face footnote reads "Latency 5120 smp", and AGENTS.md section 23 specifies a constant latency of 5120. The three sibling suite builds all say it correctly (`build_loudsplit.py` / `build_harmsplit.py` / `build_freqsplit.py`: "The latency stays 5120 samples at every size."); Transient Split is the only one still carrying the pre-rack-machinery number.

**User-visible effect:** A user trusting the Size parameter's Info View text under-compensates by 1024 samples (or mis-sets a manual latency correction / utility delay) when aligning the split chains with parallel processing, and the help contradicts the device's own latency footnote on the same face.

**Test:** `tests/test_transplit_bugsweep.js` — two blocks: (1) source checks on `ENUM_HELP["size"]` and the build docstring; (2) built-device checks that `obj-ctrl-size`'s `parameter_info` mentions 5120 and does not claim 4096, against the patcher's own `latency` attribute.

**Observed failure** (`node tests/test_transplit_bugsweep.js`, exit 1; the run stops at the first assertion, the remaining assertions target the same root cause in the docstring and the built device):

```
AssertionError [ERR_ASSERTION]: BUG (pass 1, red): Size ENUM_HELP must mention TS_LATENCY=5120 (got "Analysis block size: 512 and 1k favour time resolution, 2k and 4k frequency resolution. The latency stays 4096 samples at every size.")
    at Object.<anonymous> (/private/tmp/bugsweep/transplit/tests/test_transplit_bugsweep.js:23:12)
```

## Examined, no other credible bug found

- Mask maths: JS reference `tsMasks` vs GenExpr `ts_masks` — constants, clips (Bias +-1, Decay 1..125, Smoothing 1..64), smoothstep edges (incl. the `max(t1, t0 + 0.02)` Noise guard at Bias +1), history rise/fall, phase-deviation wrap, Decay/Smoothing exponentials, leak term, Tilt tables and gains (incl. the `cgSr` sample-rate cache key fixed after the previous sweep), Blend gains, sum-to-1 at neutral — identical; the suite's frame-for-frame GenExpr-vs-reference comparisons pass.
- Parameters and wiring: `TS_PARAMS` / `TS_ENUMS` / `TS_GEN_PARAMS` vs `build_transplit.py` NUM / ENUM / GEN_MSG vs the built device's parameter table, scales (`* 0.01`, `expr 512 * pow(2, $f1)`), defaults, linked keys, canvas route and peer `prepend set` path (`wire_param` in `scripts/spectral_common.py`) — all consistent; `tsResolveSel` maps Auto / Transients / Tones / All as documented (chains >= 3 -> Tones is the documented rough edge in AGENTS.md).
- Shared lib (`spectral_split_lib.genexpr`): `ss_mid` conjugation algebra, `ss_apply` Hermitian symmetry, `ss_ola` 2/3 Hann factor, `ss_cols` bin edges, `ss_in` / `ss_out` ring handling — verified against the suite's direct-transform and identity checks.
- Rack template (`spectral_split_rack_main.genexpr`): reader/writer and gap fades (already covered by the previous sweep), derived-channel accumulation, `sAge` resets on restart and on silent hops, telemetry gating, and the Mix dry share: `kShare = (selH > 0.5 && roleH > 0.5) ? 1/K : 1` — the role condition is the template comment's documented rule (full dry for Output All and for role SELF/pending, i.e. a lone device; wet is `gRun`-gated to silence while role is -1), so it is intended behaviour, not a bug.
- Link and DSP (`spectral_link.js`, `spectral_dsp.js`): version/seen apply suppression, leader election (fb=1 exclusion, dead-report handling, epoch growth), `serve` mask vs the gen's `eserveH` own-bit forcing, DSP claim queue, file-hash path, resend-until-alive and the 3.5 s / 6 s retry ladder — consistent with AGENTS.md section 22 and the shared test files, which pass.
- Face (`transplit_ui.js`): slider/drag mappings and double-click resets vs the parameter ranges/defaults, `ssDevResend` scaling and `fftn`, `tsPoll` header-first reads and the waveform-ring delta across the 102400 frame wrap, sonogram pooling — no mismatch found. Display Post/Style toggles are real saved parameters (`make_state_toggle`), so they persist with the Set.
- Note (not claimed, comment only): `src/transplit_config.js:133` still describes Contour as "+1 at the mids" in one comment phrase; the code and every other comment are -1 at the centre / +1 at the edges. Already recorded as a non-functional note in the previous sweep's section above.

## Commands / results

```
node tests/test_transplit.js          # GREEN — All Transient Split tests passed (incl. spectral rack, deferred DSP, paint bounds)
node tests/test_transplit_bugsweep.js # RED — 1 failing assertion block, Bug 1 above (exit 1)
python3 scripts/build_transplit.py    # rebuild reproduces the committed .amxd/.adg (git status clean)
npx tsc -p tsconfig.transplit.json    # not runnable in this worktree (no node_modules); not a device finding
```

Pass 1 only: no `src/` or build changes; the fix (update the two 4096 strings to 5120 and rebuild) is for Pass 3.

## Pass 2 review verdict: KEPT (test unchanged)

Independent re-verification confirms 5120 is unambiguously the real latency and 4096 is purely stale text: `TS_LATENCY` = 5120 (`src/transplit_config.js:14`), `RACK_LATENCY` = 5120 (`scripts/spectral_common.py:242`, 4096 STFT + 1024 host-block margin), the built device's patcher `latency` attribute is 5120 while its baked `obj-ctrl-size` `parameter_info` and annotation both still read "The latency stays 4096 samples at every size.", the face footnote renders `TS_LATENCY`, the gen core comments state the dry path is delayed by 5120, and all three sibling Split builds advertise 5120. Re-runs: `node tests/test_transplit_bugsweep.js` still RED (exit 1, first assertion exactly as filed) and `node tests/test_transplit.js` GREEN. The test's assertions map one-to-one onto the two stale strings and the baked device help — not a nit (Live's Info View under-reports latency by 1024 samples) and not over-broad — so the test is kept as-is for the Pass 3 fix.

## Pass 3 fix - Bug 1 FIXED

**Adopted diff (Step A):** The uncommitted scripts/build_transplit.py modification disclosed by Pass 2 was inspected first with git diff: exactly the two intended string changes and nothing else - module docstring (line 8: delayed by 5120 samples, latency 5120) and ENUM_HELP size entry (line 69: The latency stays 5120 samples at every size.). Adopted as-is; not reverted, not redone.

**External commit:** While this pass was in flight, the worktree owner committed that adopted fix and the rebuilt devices directly as 761e63e (fix(transplit): Size Live help and docstring latency 4096 to 5120, 2026-10-25 23:02 PDT) - the same 2-line script diff. This pass does not re-commit the fix. Its own verification rebuild produced a byte-identical .amxd (MD5 b698283128a3d1f59e8f53b176981866 before and after the rebuild), and its .adg regeneration differed from the committed .adg only in the two FileRef LastModDate timestamps (6 bytes), so the working tree was left at the committed .adg. This commit therefore records only this Pass 3 entry in BUGS.md.

**Verification (Pass 3, this worktree):**

- npm run -s typecheck - rc 0 (all configs, incl. tsconfig.transplit.json)
- python3 scripts/build_transplit.py - rc 0 (wrote devices/Transient Split.amxd, 171376 bytes, and the .adg)
- node tests/test_transplit_bugsweep.js - GREEN: source Size-help checks and built-device Size-help checks both passed; all cases passed
- node tests/test_transplit.js - GREEN: All Transient Split tests passed (plus spectral rack, deferred-DSP, and paint-bounds suites)
- python3 scripts/render_preview.py devices/Transient Split.amxd - previews/transient_split.png (880x338) read back in-session; face unchanged, as expected for a help-text-only fix
- Built-device check after rebuild: obj-ctrl-size parameter_info and annotation both say the latency stays 5120 samples at every size; patcher latency = 5120
- git status after the fix commit and the .adg disposition above: only BUGS.md (this entry) modified

Bug 1 closed: fixed 1 / remaining 0.


## Pass 4 review: APPROVED

Pass 4 review: APPROVED - independently re-reviewed 761e63e (exactly the two 4096-to-5120 strings in scripts/build_transplit.py plus the rebuilt .amxd/.adg; baked device gained exactly the two 5120-samples strings, remaining 4096s are FFT/buffer/size values) and f2a1af6 (BUGS.md Pass 3 record only, matching reality, incl. the 761e63e/f2a1af6 split); no test files changed in either commit. Re-ran both suites green (test_transplit_bugsweep.js rc 0 both blocks; test_transplit.js rc 0) and verified the built device directly: obj-ctrl-size parameter_info and annotation say 5120, patcher latency = 5120, .amxd MD5 b698283128a3d1f59e8f53b176981866.



# Ableton MCP Bridge — Pass 1 Bugsweep

Device: Ableton MCP Bridge (`src/ableton_mcp_lom.js`, `src/ableton_mcp_node.js`, `scripts/ableton_mcp_server.js`; build `scripts/build_ableton_mcp.py`)
Pass: 1 only — hunt + red tests, NO fixes. All tests are in `tests/test_ableton_mcp_bugsweep.js` (new file). BUG-MCP-1..5 from the earlier round already live in `tests/test_ableton_mcp.js` / `tests/test_ableton_mcp_stdio_http.js` and are not duplicated here; both of those suites pass on this baseline.

Run: `node tests/test_ableton_mcp_bugsweep.js` → exit 1, `Bugsweep red tests FAILED (6)` — every test below fails for the stated reason (observed output quoted per bug).

---

## BUG-MCP-6 — `get_tracks_tree` with an out-of-range `trackIndex` silently returns the full tree

- **Where:** `src/ableton_mcp_lom.js:273-279` (`handleGetTracksTree`)
- **What is wrong:** The single-track branch only runs when `trackIndex >= 0 && trackIndex < nTracks`; any other numeric value (too large, or negative) falls into the `else` branch that returns *every* track, instead of no tracks or an error.
- **User-visible effect:** Asking to inspect track 5 of a 1-track set (or track -1) returns the whole set tree labelled as if it were the answer for that track — a client acting on `tracks[0]` then reads/edits the wrong track.
- **Test:** `testTrackIndexOutOfRange` in `tests/test_ableton_mcp_bugsweep.js`
- **Observed failure:** `trackIndex 5 on a 1-track set must error or return zero tracks, got ok=true tracks=1 (the full tree was returned for a track that does not exist)` (same for `trackIndex: -1`)

## BUG-MCP-7 — `maxParameters: 0` is ignored (falsy `||` defaults) and parameters are returned anyway

- **Where:** `src/ableton_mcp_lom.js:376` (`p.maxParameters || 128` in `handleGetDeviceParameters`), `src/ableton_mcp_lom.js:144` (`opts.maxParameters || 32` in `readDeviceTree`), backed by `src/ableton_mcp_lom.js:96` (`maxParams || 64` in `readParameterList`)
- **What is wrong:** An explicit `maxParameters` of 0 is falsy, so each layer substitutes its default (128 / 32 / 64) instead of honouring the requested cap of zero.
- **User-visible effect:** A caller asking for a cheap tree with `maxParameters: 0` (structure only, no parameter payloads) still gets full parameter lists for every device — the size/latency saving the option exists for is silently not delivered.
- **Test:** `testMaxParametersZero` in `tests/test_ableton_mcp_bugsweep.js`
- **Observed failure:** `maxParameters: 0 must return 0 parameters, got 2` (via `get_device_parameters`; the `get_tracks_tree` path with `includeParameters: true, maxParameters: 0` fails the same way)

## BUG-MCP-8 — `get_session_info` reports `loop_length: 4` when Live reports 0

- **Where:** `src/ableton_mcp_lom.js:221` (`var loopLength = Number(getScalar(setApi, "loop_length")) || 4.0;` in `handleGetSessionInfo`)
- **What is wrong:** A real `loop_length` of 0 beats is falsy, so the `|| 4.0` fallback fabricates a 4-beat loop length. (Neighbouring zero-valued fields such as `loop_start` and `current_song_time` use a `|| 0` fallback and are unaffected.)
- **User-visible effect:** Session info claims a 4-beat loop for a set whose loop length is actually 0, so any client reasoning about the loop bracket works from invented data.
- **Test:** `testLoopLengthZero` in `tests/test_ableton_mcp_bugsweep.js`
- **Observed failure:** `Live reports loop_length 0 but get_session_info returned 4`

## BUG-MCP-9 — Bridge crashes at startup on an out-of-range `ABLETON_MCP_PORT` instead of falling back

- **Where:** `src/ableton_mcp_node.js:34` (`const BASE_PORT = Number(process.env.ABLETON_MCP_PORT) || 9877;` — no range check), crashing at `src/ableton_mcp_node.js:280` (`srv.listen(...)` in `startListening`)
- **What is wrong:** The env port is never validated. The `set_port` handler in the same file validates `1024..65535` before rebinding (`src/ableton_mcp_node.js:61-62`), but the startup path passes e.g. 70000 straight to `Server.listen`, which throws `RangeError [ERR_SOCKET_BAD_PORT]` synchronously and kills the node process before it can scan/fall back or report `bridge_status`.
- **User-visible effect:** One bad env value (typo, stale config) takes the whole bridge down with a stack trace and no session is ever registered; the device just appears dead in Live.
- **Test:** `testInvalidEnvPort` in `tests/test_ableton_mcp_bugsweep.js` (spawns the real bridge with `ABLETON_MCP_PORT=70000`; expects it to stay alive and register on a fallback port)
- **Observed failure:** `bridge process exited (code 1) on ABLETON_MCP_PORT=70000 instead of falling back to a valid port; stderr: RangeError [ERR_SOCKET_BAD_PORT]: options.port should be >= 0 and < 65536. Received type number (70000). at Server.listen ... at startListening (src/ableton_mcp_node.js:280:9)`

## BUG-MCP-10 — Stdio server loses a `Content-Length` framed message whose header is split across chunks, and answers a spurious parse error

- **Where:** `scripts/ableton_mcp_server.js:546-572` (`startStdioMcpServer` stdin parser)
- **What is wrong:** The framing check requires the complete header terminator within the buffered bytes (`/^Content-Length:\s*(\d+)\r?\n\r?\n/`). If a chunk ends right after the header line (`Content-Length: N\r\n` sent, blank line still in flight), the regex does not match, so the parser falls through to newline-delimited mode and consumes the header line itself as a JSON line: it emits a `-32700` parse error, and the following body is left buffered without its header (no trailing newline), so the actual request is never dispatched.
- **User-visible effect:** An LSP-style MCP client whose writes are chunked at that boundary (normal TCP/stream behaviour) gets a bogus parse error and its request hangs forever with no response.
- **Test:** `testSplitContentLengthHeader` in `tests/test_ableton_mcp_bugsweep.js` (writes the header line, waits 400 ms, then writes the blank line + body of a `ping`)
- **Observed failure:** `no response to a Content-Length framed ping whose header was split across chunks; raw stdout: {"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}` (that parse error was the *only* output — the ping, id 42, was never answered)

## BUG-MCP-11 — One `tools/call` with an out-of-range `port` argument kills the whole MCP server, with no response

- **Where:** `scripts/ableton_mcp_server.js:330` + `:335` (`callBridgeHttp` passes the unvalidated port to `http.request`, which throws synchronously), reached via `executeMcpTool` (`:433-434`); the rejection is fatal because the stdio loop calls the async `handleJsonRpcMessage` without awaiting it (`:564`, `:582`), so the throw becomes an unhandled rejection.
- **What is wrong:** Neither the tool argument, the `--port` CLI value, nor the env default is range-checked before `http.request`, and there is no rejection guard around message handling. A single `port: 99999` raises `RangeError [ERR_SOCKET_BAD_PORT]` and terminates the server process (exit code 1).
- **User-visible effect:** One malformed tool call from any MCP client disconnects the entire Ableton MCP server session — no JSON-RPC error, no tool error result, every other in-flight call dropped.
- **Test:** `testInvalidToolPort` in `tests/test_ableton_mcp_bugsweep.js` (expects an `isError` tool result for id 7 and a live server that still answers a subsequent `ping`)
- **Observed failure:** `no JSON-RPC response to tools/call with port 99999 (server exit code: 1); stderr: RangeError [ERR_SOCKET_BAD_PORT]: Port should be >= 0 and < 65536. Received type number (99999). at lookupAndConnect ...`

---

### Checked and found clean (no credible bug)

- `delete_device` / `set_device_parameter` / `transport` argument validation and the `/rpc` null-body and stdio parse-error paths — already covered by BUG-MCP-1..5 and passing.
- `set_device_parameter` clamping (`Math.max(min, Math.min(max, value))`), exact-then-substring name matching, and not-found handling for negative/fractional indices.
- `delete_device` path parsing for nested rack paths (`... chains 1 devices 0` resolves parent/index correctly, as the existing suite asserts).
- Node bridge multi-session port scan: same-parent (`max_ppid`) shutdown/rebind vs different-parent increment, registry unregister guarded by `node_pid`, RPC pending-map timeout cleanup.
- `scripts/build_ableton_mcp.py` patchline helper and `route lom_rpc bridge_status` wiring (3 outlets: rpc, status, unmatched) match the LOM/node message contract.
- Transport tempo clamp (20..999) and the node `set_port` range check (1024..65535) are correct — which is what makes the unvalidated startup/CLI/tool port paths in BUG-MCP-9/11 stand out.

# Harmonic Split bug sweep — pass 1 (hunt + red tests)

Worktree: `/tmp/bugsweep/harmsplit` on branch `bugsweep/harmsplit`, baseline `69699f7`.
Scope read in full: `src/harmsplit_config.js`, `src/harmsplit_core.genexpr`, `src/harmsplit_ui.js`,
shared `src/spectral_split_lib.genexpr` / `src/spectral_link.js` / `src/spectral_dsp.js`,
`scripts/build_harmsplit.py`, and the existing suites `tests/test_harmsplit.js` /
`tests/test_harmsplit_face.js` (plus the link / paint-bounds suites they pull in).
No `src/` file was modified; no existing test file was modified.

**Found: 1 bug.** Red tests: `tests/test_harmsplit_bugsweep.js`.

## Bug 1 — Detection Threshold cannot be dragged or reset on the plot above ≈ −7.7 dB

- **File:** `src/harmsplit_ui.js`, `hsHandleDown` (the top-strip branch, lines 617–623);
  the handle is painted in `hsPaintAnalysis` (lines 493–496).
- **What's wrong:** `hsPaintAnalysis` draws the Threshold line and its `T` handle across the
  full plot width, and near the top it deliberately moves the handle left of the Post button
  (`tg.x - 22`) so it stays visible and clear of the L / H flags. But `hsHandleDown` treats
  every click with `y < HS_PLOT.y + 12` as flag-only territory: it forces the threshold
  distance `dT = 99` and gives the L / H flags a painted-position exception via `hsFlagX` —
  with no equivalent exception for the T handle or the Threshold line. The Threshold line
  sits in that strip whenever `thr > ≈ −7.7 dB` (`hsYOfDb(−7.7) ≈ 13 = HS_PLOT.y + 12`), so
  in that range no click on the line or on the painted handle can start a drag, and a
  double-click there cannot reset the threshold to Automatic either (`best > 5` → return).
- **User-visible effect:** With Detection Threshold set high (about −7 dB … 0 dB), the
  threshold is stuck as far as the spectrum plot is concerned: dragging the line / T handle
  does nothing and double-clicking it does not restore Automatic. The Threshold value row
  below the plot still drags and double-click-resets, so the parameter is not fully stuck —
  only the plot interaction is dead, in exactly the range where the handle was specially
  repositioned to remain usable.
- **Test:** `tests/test_harmsplit_bugsweep.js` — a passing control (thr −50 dB line click
  starts a `thr` drag), then: "thr −5 / −2 / 0 dB line click starts a thr drag" (first
  failing assert), "thr 0 dB: clicking the painted T handle starts a thr drag", and
  "thr −5 dB: double-click on the line resets to Automatic". The latter two were also
  probed individually before the file was written (same harness): T-handle click at
  (224, 7) left `hsDrag` null, and the double-click emitted no outlet message at all.
- **Observed failure** (`node tests/test_harmsplit_bugsweep.js`, exit 1):

```
AssertionError [ERR_ASSERTION]: thr -5 dB: clicking the threshold line (y 10.9, inside the top flag strip) starts a thr drag, got null
    at Object.<anonymous> (/private/tmp/bugsweep/harmsplit/tests/test_harmsplit_bugsweep.js:55:12)
```

## Checked and cleared (no bug claimed)

- `harmsplit_config.js` `hsFrame` vs `harmsplit_core.genexpr` `hs_prep`/`hs_sal`/`hs_decide`/
  `hs_harm`/`hs_post`/`hs_masks`: mirrored maths agree, including the ceil-by-negation `h0`,
  the root-hold bar `pr3` (2.5 / 7), the odd-only ripple index `rcN[i + 64]`, and array bounds
  (sal/rc 710 vs max index 705, per-harmonic arrays 406 vs h ≤ 404). The auto-threshold decay
  `dec = 3 * n / sr` is correct, not a units bug: the hop is `n / 4`, so 12 dB/s × hop = `3n/sr`.
  The lobe width `w1 = 0.7 + 1.3·s + 0.7 + 0.5·s` matches the documented `w0 + 0.7 + 0.5·s`,
  and `w0 = min(…, w1 − 0.3)` keeps the raised-cosine denominator ≥ 0.3.
- Parameter table / enums / gen messages: `HS_PARAMS`, `HS_ENUMS`, pattern ordinal suffixes,
  `hsGenMessages` conversions and `scripts/build_harmsplit.py` (`NUM`, `ENUM`, `GEN_EXPR`,
  `ZERO_COUNT` 528 = `HS_SC_FRAME`) all agree; gen `Param` defaults differ from device
  defaults but the face re-sends every value until the deferred gen is alive, by design.
- `hsResolveSel` / Auto clamping (channels ≥ 4 → Harmonics B), `hsMixOut` dry share,
  `hsIsA` for h′ < 1 (unreachable with weight; JS and gen agree), root numbering from the
  lowest present in-band partial — all match the AGENTS.md §25 contract and existing tests.
- UI conversions: `hsYOfDb`/`hsDbOfY` and `hsFreqX`/`hsXFreq` round-trip exactly (probed,
  max error ~1e-14); `hsPoll` header/slot reads, asleep/follower display, `hsPaintHarmonics`
  marker count (h′ ≤ Max, h ≤ 404) and the value-row drag maths (`hsDragTo`, `hsClampKey`,
  `hsRound`) are consistent.
- `spectral_link.js`: rack-context parsing (incl. nested racks), heartbeat/stale cleanup,
  join/adopt, leader election incl. dead-leader (fb 2) replacement and fb-1 privacy — covered
  by `tests/spectral_link_tests.js` and consistent with its header contract; a lone leader's
  `serve 0` is the documented "serves only its own channel".
- `spectral_split_lib.genexpr`: `ss_in`/`ss_frame`/`ss_mid`/`ss_apply`/`ss_ola`/`ss_out`/
  `ss_cols`/`ss_db01` match their documented contracts (incl. at-least-one-bin columns and
  n-change clearing).
- `spectral_dsp.js`: claim/confirm/retry/restart lifecycle matches its header; exhausting
  retries lands in the terminal "DSP failed: not running" pill state, by design.
- Documented rough edges in AGENTS.md §25 (pure sine not tracked, tracker limits at band
  edges, root renumbering with the band, > 3 chains clamping) are design tradeoffs, not bugs.
Everything below was read and verified against the code (and, where numeric, re-derived);
no bug found. Existing suite stays 39 passed, 0 failed.

- **Parameter wiring (`scripts/build_delayplus.py` `P` table → Start genexpr):** all 38
  gen-bound names are declared as genexpr Params; genexpr initials match the `P` initials
  after the /100 scaling (fb 0.5, wet 0.5, width 1, dsize 0.6, phase 180, hp 50, lp 5000,
  gaterel 50, duckrel 100, repsmooth 120). Start's extra Params (`lat`, `lforate`, `tmsL`,
  `tmsR`) are documented harness fallbacks overridden by hdr slots when positive.
- **End genexpr:** declares no Params by design; it peeks `wet`, `duckOn`, `width`,
  `duckThr`, `duckRel`, `outRaw` from hdr slots written by Start.
- **hdr slot map:** writers are disjoint (Start, End, JS), every peeked slot has a poker;
  scope slot maps match `DP_SCOPE` / `DP_ESCOPE` exactly.
- **State save/load:** no `getvalueof` / `setvalueof` anywhere in the Delay+ scripts, so
  there is no JS blob state to lose; parameters are `live.*` objects saved by Live.
- **Face defaults (`src/delayplus_ui.js` `st` block):** every default matches the `P`
  table, including `DP_TM.SYNC = 1`, `DP_NOTE_DEFAULT = 57` and
  `DP_DIV_DEFAULT = indexOf("1/8") = 10`.
- **Layout satellites (`scripts/delayplus_layouts/echo.py`):** the `v8uis` key lists match
  what the display scripts consume; `set_page` fans out to viz / LFO display / filter
  display; the `pak` show/hide inputs are fed (page, filter display, LFO sync) with
  initials matching the defaults; the page/filter/mod/hz/div/opt hidden-group expressions
  are the right way round; icons drive the filter-display and link controllers; the LFO
  display outlet reaches the LFO router; `midi_note` reaches both note dials.
- **Config helpers (`src/delayplus_config.js`):** dpNoteName, dpMaxNote, dpPitchFolded,
  dpSideWarn (Sync ceil/floor bounds, Pitch top-note), dpSideMs folding and side offset,
  dpDivSnap, dpLfoHz, dpEchoTaps gains, dpClipStep hold/fade timing (30 + 12 frames),
  dpFindPartner, dpExtractIds, dpFormatMs — all re-derived and correct.
- **Gen DSP:** soft-clip formula in the genexpr matches the `clipcurve.js` display curve
  exactly; Mid/Side encode (×0.5) / decode is an exact round trip; Ping-Pong return swap
  and freeze cross-copy are correct; the diffusion allpass is a true allpass with section
  lengths summing to the diffusion total; End width law (0 = mono, 1 = identity, 2 = wide)
  and ducking law (1/r², floor at −24 dB) are correct; mix caches use −999 sentinels
  correctly; gate, LFO, wobble, noise and per-side filter coefficient caches (fmL/fmR) are
  correct; LFO shapes in the genexpr match the JS display versions.
- **Filter Display:** drag factor `exp(dx / w * LOGR)` matches the `fdFx` log mapping; the
  magnitude curve uses the gen's SVF damping `k = 1.4142 * (1 − 0.95 * res)`; box-select
  precedence is correct; the spectrogram ring read starts at the write head (oldest first).
- **Link layer and deferred DSP loader** (`delayplus_link.js`, `delayplus_dsp.js`):
  resend / claim / confirm logic holds up; End UI meter and duck displays are correct;
  the build's gen-hub routing (`to_gen_hub`) is correct.

**Result: 1 bug found.**

# XO Sample Map bug sweep — pass 1 (hunt + red tests)

Worktree: /tmp/bugsweep/xo_map on branch bugsweep/xo_map, baseline f9e6404.
Scope read: src/xo_node_engine.js, src/xo_strip_ui.js, src/xo_stretch.js, src/xo_search.js, src/xo_folder_ui.js, src/xo_layouts/default.js, src/xo_palette.js, scripts/build_xo_map.py, and the existing suites tests/test_xo_map.js, tests/test_xo_layout.js, tests/test_xo_search.js, tests/test_xo_stretch.js.
No src/ file was modified; no existing test file was modified.

**Found: 3 bugs.** Red tests: tests/test_xo_bugsweep.js (4 checks, all failing, exit 1).

## Bug 1 — Engine acoustic similarity tour serves a stale tour after the drum filter changes

- **File:** src/xo_node_engine.js, buildAcousticSimilarityTour and the set_filter_drum handler.
- **What is wrong:** the tour cache key includes vis.length, activeCategory, maxLenMs, toneFilter, pitchFilter, tonalFilter, searchQuery, sampleSeed, searchVer and folders, but not drumFilter, even though isSamplePassingFilters applies drumFilter, and the set_filter_drum handler never clears the key. A drum change that preserves the visible count reuses the old tour.
- **User-visible effect:** step_similar can step to samples the current drum filter hides, and skips samples the filter now shows.
- **Test:** engine acoustic tour rebuilds when the drum filter changes — at drumFilter +90 the step lands on B; after flipping to -90 with the visible count still 2, the step must land on a passing sample.
- **Observed failure:** stepped to sample 0 (druminess 100) which drumFilter -90 hides — stale acoustic tour.

## Bug 2 — Strip local similarity tour serves a stale tour after the tonal or drum filter changes

- **File:** src/xo_strip_ui.js, buildLocalSimilarityTour (line 1894); the cache key (line 1900) is startIdx, vis.length, activeCategory, maxLenMs, toneFilter, searchQuery, localSeed.
- **What is wrong:** the key omits tonalFilter and drumFilter even though isPointVisible applies both, and strip_filter_tonal / strip_filter_drum (lines 899 and 905) never clear simTourKey. ensureValidSelection moves a hidden selection to the first visible point, but the following stepLocalNeighbor still walks the stale tour and lands on a hidden point. The neighbouring paint-layer group cache does include both filters in its key.
- **User-visible effect:** local neighbour stepping after a tonal or drum filter change can select a sample the filter hides.
- **Test:** strip local tour rebuilds when the drum filter changes, and the tonal variant — visible count held at 3 in both filter states. The scenario uses a low value of 10, not 0, because minimap_batch coerces a 0 druminess or tonalPct to the 65 / 50 defaults, which changes the visible count and masks the bug through the cache length guard.
- **Observed failure:** stepped to point 1 after the filter flipped to -40; P1 is hidden there — stale local tour (want P2); 1 !== 2, for both filters.

## Bug 3 — stretchAudioEx does not clamp pitchSt, so an out-of-range stored pitch becomes a huge allocation

- **File:** src/xo_stretch.js, stretchAudioEx; caller renderEditedAudioSamples in src/xo_node_engine.js.
- **What is wrong:** every other numeric option in stretchAudioEx is clamped (speed 0.1..4, grainMs 5..250, amount 0..1), and the caller clamps decayMs, speedPct and grainMs, but pitchSt is clamped nowhere — not in stretchAudioEx, not in the caller, and not in the strip or engine state parsers. The Pitch parameter range is -24..+24. In complex mode the intermediate buffer is sized lenIn * 2^(pitchSt/12) / speed, so a stored pitchSt of 96 sizes a 256x intermediate.
- **User-visible effect:** a corrupt or hand-edited state carrying an extreme pitch value can hang or exhaust memory on render instead of rendering as the ±24 clamp.
- **Test:** stretchAudioEx clamps pitchSt to the +/-24 range — pitchSt ±96 must render exactly as ±24 in both granular and complex modes.
- **Observed failure:** granular: pitchSt 96 should render exactly as the 24 clamp (max diff 1.8377479314804077).

## Checked and cleared (no bug claimed)

- Lead 1, pitchFilter wiring: the engine outlets strip_filter_pitch and engineState.pitchFilter exists, but there is no strip handler for pitch, and pitchFilter never reaches isSamplePassingFilters or any other actual filtering. Dead state — a nit, not a behaviour bug.
- Lead 2, tonal/drum undo exclusion: strip_filter_tonal and strip_filter_drum are engine/patcher-owned and only mirrored by the strip, so their exclusion from strip undo snapshots and the state blob is consistent design.
- grainMs=0 in stretchAudioEx: falls back to the 45 ms default rather than clamping to the 5 ms floor; checked and recorded as no-bug for pass 1 — a default substitution, consistent with the other falsy option defaults in the same function.
- The already-fixed undo-after-recall bug (5ddf91c) and saved-list onwheel bug (613d525) were not re-filed.

## Commands / results

- node tests/test_xo_bugsweep.js → 4 failing, exit 1 (all red, as intended for pass 1).

---

# XO Sample Map bug sweep — pass 2 (review, verdicts only, no fixes)

Worktree: /tmp/bugsweep/xo_map on branch bugsweep/xo_map, tip 0134f6b. No src/ or test files changed in this pass; this section is appended only.
Re-run: node tests/test_xo_bugsweep.js → 4 failing, exit 1, exactly as filed (engine acoustic tour stale on drum change; strip local tour stale on drum change; strip local tour stale on tonal change; stretchAudioEx pitchSt clamp).

**Kept 3 / dropped 0.**

## Bug 1 — KEPT (engine acoustic tour serves a stale tour after the drum filter changes)

- Cache key (src/xo_node_engine.js:2087, buildAcousticSimilarityTour) is vis.length|activeCategory|maxLenMs|toneFilter|pitchFilter|tonalFilter|searchQuery|sampleSeed|searchVer|folders — tonalFilter is keyed, drumFilter is not, and the cache-hit guard (:2088) checks only key equality, cache length and start-index membership, so a count-preserving drum flip reuses the old tour.
- isSamplePassingFilters does apply drumFilter (:1840-1848, drumPct against the df*0.85 bounds), so the tour contents genuinely depend on it.
- The set_filter_drum handler (:2984-2987) only sets engineState.drumFilter and outlets strip_filter_drum; it never clears acousticSimTourKey (contrast the clears on other state changes, e.g. :1809/:1930/:2251/:2856).
- Red check re-run fails as filed: after flipping drumFilter +90 → -90 with the visible count still 2, stepSimilarSample lands on sample 0 (druminess 100), which the -90 filter hides.

## Bug 2 — KEPT (strip local tour serves a stale tour after the tonal or drum filter changes)

- Cache key (src/xo_strip_ui.js:1900, buildLocalSimilarityTour) is startIdx|vis.length|activeCategory|maxLenMs|toneFilter|searchQuery|localSeed — neither tonalFilter nor drumFilter — and the hit guard (:1901) is key + length only.
- isPointVisible applies both filters: tonal at :398-405, drum at :406-413.
- strip_filter_tonal (:899-903) and strip_filter_drum (:905-909) only set the value, call ensureValidSelection() and redraw; neither clears simTourKey — and ensureValidSelection fixing the selection does not rebuild the tour that stepLocalNeighbor then walks.
- The neighbouring paint-layer group cache gets it right: groupsKey (:489) includes both tonalFilter and drumFilter, so the omission from the tour key is inconsistent with the file's own pattern.
- Both red checks re-run fail as filed: after the flip to -40 at a constant visible count of 3, stepping lands on hidden point 1 (want P2), for both the drum and tonal variants.

## Bug 3 — KEPT (stretchAudioEx does not clamp pitchSt)

- In stretchAudioEx (src/xo_stretch.js:813-819) speed is xsClamp(..., 0.1, 4), grainMs is xsClamp(..., 5, 250) and amount is xsClamp(..., 0, 1), but pitchSt (:817) is Number(opts.pitchSt) || 0 unclamped; pitchRatio = 2^(pitchSt/12) (:824) and complex mode sizes its intermediate as lenIn * pitchRatio / speed (:842), so pitchSt 96 allocates a 256x intermediate; granular mode passes the raw pitchSt to xsGranular (:835).
- The caller renderEditedAudioSamples (src/xo_node_engine.js:732) repeats the pattern: pitchSt raw at :733 and passed through at :812, while speedPct is clamped 10..400 (:737), grainMs 5..250 (:738) and decayMs floored (:734).
- No upstream clamp exists: the engine set_pitch handler (:2928-2930) and strip set_pitch (src/xo_strip_ui.js:923-925) store the raw number (their set_decay neighbours do clamp), and the strip state-blob parsers (:2436/:2445/:2462) likewise take Number(...) || 0 — so an out-of-range pitch is reachable from saved or hand-edited state and from plain set_pitch messages, not only from corruption.
- The ±24 target is the device's own spec: the Pitch live.dial in scripts/build_xo_map.py has parameter_mmin -24.0 / parameter_mmax 24.0 (:1581-1582; annotation "-24 st to +24 st").
- Red check re-run fails as filed (granular: pitchSt 96 should render exactly as the 24 clamp, max diff 1.8377). The check is not over-broad: it only requires out-of-range values to render exactly as the ±24 clamp in both modes, which a clamp at the stretchAudioEx entry (or in the caller) satisfies.

The pass 1 checked-and-cleared leads (pitchFilter dead state, tonal/drum undo exclusion, grainMs=0 default substitution) were not reopened.

---

# XO Sample Map bug sweep — pass 4 (review, verdict only, no fixes)

Worktree: /tmp/bugsweep/xo_map on branch bugsweep/xo_map, commit under review 60196e6 (fix(xo_map): bugsweep pass 3 fixes). No src/ or test files changed in this pass; this section is appended only. Note: BUGS.md contains no Pass 3 section for XO — the Pass 3 record is commit 60196e6 itself (3 files, 3 insertions, 3 deletions, one line per bug), reviewed here against the Pass 1 filings and Pass 2 KEPT verdicts above.

**Overall verdict: APPROVED.** All 3 fixes are correct, complete, and minimal, with no unintended behaviour change.

## Bug 1 — APPROVED (engine acoustic tour stale on drum filter)

- Diff (src/xo_node_engine.js, buildAcousticSimilarityTour): the cache key gains engineState.drumFilter, inserted between tonalFilter and searchQuery; nothing else changes.
- Completeness: Pass 2 established the key already contained every other filter the tour depends on (tonalFilter was keyed, drumFilter was the sole omission), isSamplePassingFilters applies drumFilter, and the set_filter_drum handler never clears the key — so keying drumFilter is the complete fix; a drum change now forces a rebuild even at constant visible count.
- No side effects: in an unchanged filter state the key is unchanged in effect (one extra stable component), so cache hits behave exactly as before.
- Evidence: ok - engine acoustic tour rebuilds when the drum filter changes (tests/test_xo_bugsweep.js).

## Bug 2 — APPROVED (strip local tour stale on tonal or drum filter)

- Diff (src/xo_strip_ui.js, buildLocalSimilarityTour): the cache key gains tonalFilter and drumFilter, inserted between toneFilter and searchQuery; nothing else changes.
- Completeness: Pass 2 established isPointVisible applies both filters, neither strip_filter_tonal nor strip_filter_drum clears simTourKey, and the neighbouring paint-layer groupsKey already keys both — the fix adds exactly the two missing components and matches the file pattern.
- No side effects: with filters unchanged, tour construction and cache reuse are identical.
- Evidence: ok - strip local tour rebuilds when the drum filter changes; ok - strip local tour rebuilds when the tonal filter changes (tests/test_xo_bugsweep.js).

## Bug 3 — APPROVED (stretchAudioEx pitchSt unclamped)

- Diff (src/xo_stretch.js, stretchAudioEx entry): pitchSt changes from Number(opts.pitchSt) || 0 to xsClamp(Number(opts.pitchSt) || 0, -24, 24), alongside the existing clamped speed, grainMs and amount.
- Completeness: the clamp sits on the single local variable at function entry, before pitchRatio and before both the granular and complex paths, so every downstream use sees the clamped value and no call site can bypass it through this function; the bounds are the device Pitch spec (-24..+24). xsClamp (src/xo_stretch.js:38) is a plain lo/hi clamp, NaN input is already coerced to 0 by the || 0, and in-range values pass through unchanged, so legitimate renders are bit-identical.
- Evidence: ok - stretchAudioEx clamps pitchSt to the +/-24 range (tests/test_xo_bugsweep.js), requiring +/-96 to render exactly as +/-24 in both modes.

## Commands / results (re-run in this pass)

- node tests/test_xo_bugsweep.js → 4 checks ok, all passed, exit 0 (was 4 failing, exit 1 in Passes 1-2).
- node tests/test_xo_map.js → SUCCESS, all tests passed, exit 0.
- node tests/test_xo_layout.js → OK device (414 x 169, 48 layout combinations), exit 0.
- node tests/test_xo_search.js → OK xo_search matcher, exit 0.
- node tests/test_xo_stretch.js → all xo_stretch tests passed, exit 0.
- git show 60196e6 → exactly the 3 one-line changes described above; no test files, no unrelated files.


# Mega Modulator bug sweep — Pass 2 / Pass 3 record (added on main)

This record was added directly on main: the bugsweep/megamod worktree and branch were removed externally after the fix merged, before these verdicts could land in BUGS.md. The Pass 1 filing is the "# Mega Modulator bug sweep — pass 1" section earlier in this file. Better Sampler, originally batched with this record, needed none: its Pass 2 / Pass 3 / Pass 4 records are already present in its own section on main.

## Pass 2 review verdicts — Bug 1: KEEP, Bug 2: KEEP

- Bug 1 (sanitizeMod boolean false): KEEP — real, reachable via saved states carrying JSON false, and inconsistent with sanitizeMapping in the same file.
- Bug 2 (strip-knob onwheel sign): KEEP — real, the opposite wheel convention to every other control in the same file.

## Pass 3 fix — both bugs: FIXED

- Fix commit 5c338e749203b503057dd901e047cc512ceddd50, "fix(megamod): sanitizeMod false enabled + strip-knob wheel sign" — two one-line src changes plus the rebuilt devices/Mega Modulator.amxd:
  - src/megamod_config.js (sanitizeMod): `m.enabled === 0 ? 0 : 1` -> `m.enabled === 0 || m.enabled === false ? 0 : 1`.
  - src/megamod_ui.js (strip-knob onwheel): `(dy > 0 ? 1 : -1) * 0.03` -> `(dy > 0 ? -1 : 1) * 0.03`.
- Verification on main (2026-10-26, at merge bd2bc7f): `node tests/test_megamod_bugsweep.js` = 9 passed, 0 failed (Pass 1 pre-fix run was 5 passed, 4 failed). The known pre-existing tests/test_megamod_ui.js failure ("click sets X: 0.2272 vs 0.25") is unrelated to these bugs and not blocking.
- No separate Pass 4 review was recorded for this device, so none is claimed here; this record is the Pass 2 verdicts, the Pass 3 fix, and the main-tree verification above.

# Freq Split bug sweep — record (added on main)

This record was added directly on main: the bugsweep/freqsplit branch was merged (fd40d31) and deleted before any section for this device landed in BUGS.md; greps for the device name and for the fix vocabulary (fsDryShare, limon, fvDragTo, role-gated) found no Freq Split record in this file.

## Cycle on main

- Pass 1: 7802dda, "test(freqsplit): bugsweep pass 1 red tests" — filed reds in tests/test_freqsplit_bugsweep.js covering the mix dry-share accounting against the role-gated gen and the limiter hit handling.
- Review: 2e0efe9, "test(freqsplit): review bugsweep reds (role-gated mix, limiter, limon hit)" — revised the suite against the shipped behaviour (that commit also restored this cumulative log, +2161 lines, without adding a section for this device).
- Fix: 3a95cdf, "fix(freqsplit): role-gated dry share docs and limiter hit targeting" — "Align fsDryShare and the suite with the shipped role-gated kShare. Gate limiter hits on limon (and mid-drag), hit-test the painted handle, and skip mousedown fvDragTo so out-of-plot thresholds do not jump." Devices rebuilt (298f459, 8379496).
- Merge: fd40d31, "merge(bugsweep/freqsplit): role-gated dry share docs and limiter hit targeting".
- Verification on main (2026-10-26): `node tests/test_freqsplit_bugsweep.js` = exit 0, all checks ok (mix dry share agrees with role-gated gen; limiter handle at -120 dB grabbable at its painted position; grabbing the limiter line at +12 dB does not jump the threshold; limon=0 invisible limiter does not steal plot hits).
- No separate Pass 4 review was recorded for this line, so none is claimed here.

## Parallel line (for the record)

- bugsweep/freqsplit-pass1 (7ecba2d pass 1, ff93799 pass 2) independently hunted this device and found no credible bugs (kept 0 / dropped 0, two nits rejected). That review covered its own hunt, not the filed reds above; the branch remains unmerged and is superseded by the merged cycle recorded here.

# Amp+ core - pass 2 review (drops)

Worktree: /tmp/bugsweep/ampplus-core, branch bugsweep/ampplus-core-pass1.
Unit: Amp+ core (src/ampplus_core.genexpr, src/ampplus_models.js, scripts/build_ampplus.py, face code as built at HEAD).
Post-merge HEAD includes main's face redesign (d72ee17) via merge commit on this branch.

Pass 2 reviewed the single Finding 1 from pass 1 and **dropped** it. No real device bugs kept. No production/src changes.

## Dropped

### Finding 1 - Node genexpr mirror shares History across call sites (DROPPED — harness-only / out of scope)

- Pass 1 claim: `tests/genexpr_functions.js` transpile hoists each function-local `History` to one global per function (`H_${fn}_${name}`), so every JS call of `slew` / `biq` shares state. Red tests in `tests/test_ampplus_pass1.js` asserted real gen per-call-site semantics against that mirror (second `slew` should prime to 80; a fresh `biq` fed 0 should output 0 after another was driven with DC).
- Pass 2 verification:
  - Branch touches only `BUGS.md` + `tests/test_ampplus_pass1.js`; `src/` untouched (device core equals main).
  - Shipping `src/ampplus_core.genexpr` has exactly 7 independent `slew(...)` call sites (bass/mid/treble/presence/volume/position/cab) and 7 independent `biq(...)` call sites (4 tone + 3 cab HP/LP/peak), with an explicit comment above the tone stack: each `biq()` call is its own filter; a wrapper would share one History across every band.
  - Mirror transpile confirmed: one `H_*` global per function name — cannot model per-site History.
  - Grounding runs: `node tests/test_ampplus_pass1.js` fails as documented (actual ~40.04 vs expected 80); `node tests/test_ampplus.js` prints `ampplus ok`.
- Why drop: not a functional/DSP/UI/state/serialization **device** bug. Gen correctly gives each call site its own History; the VM audio suite already exercises that. The reds encode correct device semantics but assert them against a known-broken Node mirror. Fix belongs in the harness (`tests/genexpr_functions.js`), not in `ampplus_core.genexpr`. Pass 2 scope is device bugs only.
- Action: remove `tests/test_ampplus_pass1.js`; leave this note so pass 3 / harness work can pick up the mirror fix separately.

## Kept

(none)

## Investigated and cleared (no bug) — inherited from pass 1, re-affirmed

- DSP math vs AGENTS.md section 30 and the RBJ cookbook: toneDb spans give exactly plus/minus 12 dB (bass, mid, treble) and plus/minus 8 dB (presence); shelf alpha uses sinW times 0.7071 (slope 1) as RBJ requires; peak, HP and LP coefficients match; volCurve is the specified 2.5-power law (0 at 0, 1 at 100); filt clamps freq to 15..0.45 sr and q to at least 0.05.
- Cabinet tables vs build help text: condenser is brighter (LP times 1.25, peak times 0.55), dynamic is darker with the presence bump (peak plus 2.2 dB), cone-edge position darkens the LP, raises the HP and fades the peak; speaker counts in the face (1, 2, 4, 4, 1, 8) match the six cab types.
- Param mapping and defaults: every gen Param default matches build NUM and ENUM (tone 50, volume 80, position 0, cab on, cabtype 1 = 2x12, mic 0 = Dynamic); GEN prepend routing covers bass, mid, treble, presence, volume, cab, cabtype, mic, position; gain stays in front of neural via scale 0..100 to -18..+18, dbtoa, sig, slide 960 (50 maps to 0 dB, per spec).
- Scope path: buffer #0-ampscope is 32 samples; the gen pokes slots 0, 1 and 2..25 (26 used), so it fits. Audio tests leave scopeon at 0.
- Buffer.peek channel in ampplus_ui.js pullMeter: peek(1, 0, 1) looks off by one but is correct. Max JS Buffer channels are 1-based, confirmed repo-wide. Slot 0 is the envelope the meter wants.
- ampStep wraparound and clampIndex bounds in the face; model list vs NOTICE.json is already asserted by the existing suite.

## Environment note

Host gate needs local npm install (typescript + terser); without node_modules, tsc and the amxd minify step fail. Baseline: `node tests/test_ampplus.js` prints `ampplus ok`.
