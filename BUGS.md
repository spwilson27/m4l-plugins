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

## Checked and cleared

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
