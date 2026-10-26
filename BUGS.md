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
