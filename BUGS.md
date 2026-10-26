# Freq Split bug sweep — pass 1 (hunt + red tests, no fixes)

Worktree: /tmp/bugsweep/freqsplit on branch bugsweep/freqsplit, baseline 69699f7.
Tests: tests/test_freqsplit_bugsweep.js (new). No src/ files were modified in this pass.

**Found 2 bugs (3 red checks).**

## Bug 1 — Mix dry share: the config reference, the suite and the shipped gen disagree for a standalone single-channel output

- **Where:** src/freqsplit_config.js:129-132 (fsDryShare) vs src/spectral_split_rack_main.genexpr:481 (the rack template the build expands into the Freq Split gen, via scripts/build_freqsplit.py:151).
- **What is wrong:** fsDryShare() is the device reference for the dry share one instance adds: 1 when it outputs everything, 1 / 4 whenever it outputs one channel, with no other condition. The shipped gen instead computes `kShare = (selH > 0.5 && roleH > 0.5) ? 0.25 : 1;` — the 1 / 4 share only applies while the instance also holds a rack role (leader / follower). For a standalone instance (no rack, role 0) with Output = Ch 1..4 the gen uses the FULL dry share where the reference says 1 / 4. The existing suite already encodes the reference rule and is red on it: tests/test_freqsplit.js:619 asserts the gen contains `kShare = selH > 0.5 ? 0.25 : 1;` and fails at baseline. A diagnostic run with only that one assert neutralised passes every other section (layout, masks, GenExpr pipeline, limiter, lint, built device, rack, deferred DSP, paint bounds), so this is the sole failure of the suite.
- **User-visible effect:** a lone Freq Split (not in a rack) set to Output Ch 1..4 with Mix below 100 % passes the dry component at full level; at Mix 0 it passes dry at unity, where the device reference model (fsDryShare) predicts a quarter share (-12 dB). In a rack of four the gen does apply 1 / 4 per chain, so the rack sum identity still holds there. The red suite also masks any future regression behind this failure.
- **Note for pass 2:** Loud Split deliberately adopted the role-keyed rule (tests/test_loudsplit.js:697-699 argues a standalone single-channel output must keep K = 1), so the resolution may be that fsDryShare and tests/test_freqsplit.js:619 are the stale side and the gen is right. Either way the Freq Split files are internally inconsistent — one side has to change in pass 3, and today nothing in the Freq Split files records the role condition.
- **Test:** "mix dry share: gen matches fsDryShare for standalone single-channel output" in tests/test_freqsplit_bugsweep.js.
- **Observed failure:**

```
[bugsweep] RED: mix dry share: gen matches fsDryShare for standalone single-channel output
    gen dry share follows the config reference (1/4 whenever one channel is selected); actual gen line: kShare = (selH > 0.5 && roleH > 0.5) ? 0.25 : 1;
```

(and the baseline suite: `node tests/test_freqsplit.js` -> AssertionError "Mix: the dry share is 1 / 4 per chain (1 for Output All)" at tests/test_freqsplit.js:619.)

## Bug 2 — Limiter handle is painted at one position but hit-tested at another; grabbing the line at an out-of-plot threshold rewrites it

- **Where:** src/freqsplit_ui.js:432-441 (fvLimLabel clamps the handle position py into the plot), :426 (fvPaintLimiter draws the handle at lb.py), :471-477 (fvHit hit-tests |y - fvLimY()| < 4 with the UNclamped fvLimY of :291-294), :531-535 (fvDragTo clamps the dragged value to the plot range).
- **What is wrong:** the limiter parameter range is -120..+12 dB (src/freqsplit_config.js:82) but the plot range is -80..+6 dB (FV_DB_LO / FV_DB_HI, src/freqsplit_ui.js:35-36). Three consequences of the paint / hit / drag scale mismatch:
  1. The painted T handle is clamped up to 8 px inside the plot (py in [plot.y + 8, plot.y + plot.h - 8]), while the hit band follows the unclamped line (fvLimY). At limthr = -120 dB the line sits at y = 83 (plot bottom) and the handle is drawn at y = 75; the 8 px gap exceeds the 4 px hit band, so clicking the painted handle does not grab the limiter at all — it starts a Spin drag. The same separation grows in for thresholds below about -71 dB and above about +3 dB.
  2. fvDragTo() maps the mouse through the PLOT range and clamps to [-80, +6], so the canvas drag can never set the bottom 40 dB or the top 6 dB of the parameter range the numbox offers.
  3. Because fvHandleDown() calls fvDragTo() on mousedown, merely grabbing the line at an out-of-plot threshold rewrites it in place: at +12 dB a press on the line emits limthr 6; at -120 dB a press on the line at the plot bottom emits limthr -80. The stored value jumps before the mouse moves.
- **User-visible effect:** with the limiter on and a threshold near either end of its range, the user cannot grab the handle where it is drawn (the click slides the split pattern instead — Spin changes), and clicking the line itself silently changes the threshold by up to 40 dB.
- **Tests:** "limiter handle at -120 dB is grabbable at its painted position" and "grabbing the limiter line at +12 dB does not jump the threshold" in tests/test_freqsplit_bugsweep.js (face driven through tests/paint_bounds_lib.js, the same harness as tests/test_freqsplit_paint_bounds.js).
- **Observed failures:**

```
[bugsweep] RED: limiter handle at -120 dB is grabbable at its painted position
    clicking the painted limiter handle at limthr -120 starts a limiter drag (got drag kind: spin)
[bugsweep] RED: grabbing the limiter line at +12 dB does not jump the threshold
    grabbing the limiter line at +12 dB emits no limthr edit (got [[0,"limthr",6]])
```

## Test run summary

```
$ node tests/test_freqsplit_bugsweep.js
[bugsweep] RED: mix dry share: gen matches fsDryShare for standalone single-channel output
[bugsweep] RED: limiter handle at -120 dB is grabbable at its painted position
[bugsweep] RED: grabbing the limiter line at +12 dB does not jump the threshold
AssertionError [ERR_ASSERTION]: 3 bugsweep check(s) red   (exit code 1)
```

3 checks, all red, each for the reason stated above. Baseline references: tests/test_freqsplit_paint_bounds.js passes; tests/test_freqsplit.js fails only at :619 (Bug 1), verified by a diagnostic copy with that single assert neutralised passing all remaining sections including the spectral rack and deferred-DSP suites.

## Checked and cleared (no credible bug found)

- Pattern / mask maths (src/freqsplit_config.js vs src/freqsplit_core.genexpr): differential fuzz over 300 random parameter sets x 3 FFT sizes x 6 sample rates (1,793,500 mask values) plus the suite coverage — no divergence beyond one floating-point case: at bin 0 with strong negative Bend the gen inverse warp amplifies a 1-ulp rounding (the hoisted (mm - x) * (1 / mm) in fs_masks vs the division in fsWarpInv) through pow(eps, 1 / gamma), shifting the DC-bin mask by up to 0.006 in a crossfade. Judged a negligible numerical nit at DC, not promoted.
- Limiter (fs_limit vs fsLimitGain): fuzzed against an independent recomputation of the bin amplitude and gains (amp diff 0, gain diff 0), plus the suite loud / quiet sine cases.
- fs_pattern / fs_masks parameter handling: splits clamping 1..1024, fractional growth per direction, Nudge wrap and fractional crossfade, Spin wrap, Bend / Pinch inverse — all covered by the suite and green.
- spectral_split_lib.genexpr (ss_in / ss_frame / ss_mid / ss_apply / ss_ola / ss_out / ss_cols / ss_tele) and spectral_split_mida.genexpr (ss_mida matches the ss_mid amplitude formula exactly): no Freq Split manifestation found.
- spectral_link.js: leader election, serve mask (2^4 - 1 for a rack leader), heartbeat / stale handling, link notify dedupe, displayScope fallback — exercised by the suite link tests, green.
- spectral_dsp.js: claim / confirm / retry / resend cycle of the deferred gen — exercised by the deferred-DSP suite, green.
- freqsplit_top_ui.js: the 1 px gaps between and after the arrow cells are unclickable, but the cells are drawn with those gaps as separators (AGENTS.md section 26: hit boxes that do not overlap) — judged intentional.
- fvHit() accepting the limiter while the limiter is off: the paint-bounds suite explicitly paints an active limiter drag while off (tests/test_freqsplit_paint_bounds.js section 3), so the state is by design.
- FV_DENSE split-line cutoff uses < 120 in both fvRebuild and fvPaintSplits consistently; a threshold convention, not a mismatch.
- fsSlotAt() can return -1 for a direct call with t = 0, Low direction, integer splits, but no caller (fsMaskAt / the gen equivalent) can produce that combination — unreachable, not promoted.
- Build script (scripts/build_freqsplit.py): parameter table, enum table, gen messages and scales, linked keys and layout all match src/freqsplit_config.js and the built device checks in the suite pass.
