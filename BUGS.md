# Multiband Split — Pass 1 bug hunt (red tests only, no fixes)

Branch: `bugsweep/mbsplit-pass1` · Worktree: `/private/tmp/bugsweep/mbsplit` · base HEAD `d72ee17`

## Verdict

**Two credible bugs found.** Both have RED tests in `tests/test_mbsplit_pass1.js`
(they fail on unmodified HEAD; no production code was changed). The host gate
(`node tests/test_mbsplit.js` + build) still passes — its FIR display check only
covers fc ∈ {800, 4500} at 48 kHz, and its volume-slider checks only exercise
the endpoints (−70 / 0 / +18 dB).

## BUG 1 — Volume slider mapping is not invertible at low gains

**Severity:** functional UI — Chain Gain values in roughly (−70, −62.4) dB are
unreachable from the painted volume slider, and any legal gain in that range
(e.g. from the Live parameter or `set_gain`) snaps to −70 dB (−inf) on the next
slider drag seed / paint→drag round-trip.

**Symptom.** `gainDbToSliderNorm` (`src/mbsplit_ui.js:153`) and
`sliderNormToGainDb` (`:163`) are used as an inverse pair:

- `drawTopVolumeSlider` fills from `gainDbToSliderNorm(curGainDb)`
- onclick seeds `volDragNorm = gainDbToSliderNorm(curGainDb)`
- ondrag sets `curGainDb = sliderNormToGainDb(volDragNorm)`

They do not round-trip at low gains. `sliderNormToGainDb` maps every
`norm <= 0.015` to −70 dB, while `gainDbToSliderNorm` maps the whole audible
range −69.5 … ≈−62.3 dB onto norms below 0.015. Measured on this tree:
14 of 176 half-dB steps from −69.5 to +18 fail a 0.5 dB round-trip (e.g.
−69.0 → norm → −70.0). Dragging across the dead zone jumps from −70 dB to
about −62.4 dB with no intermediate values.

**Contract.** `set_gain` / build `PARAM_SPECS` / gen clamp Chain Gain to
−70 … +18 dB; only `gain <= -69.5` is treated as silence in the gen
(`cGainLin = (gain <= -69.5) ? 0.0 : …`). `formatGainDb(-65)` prints
`"-65.0 dB"`. The slider is the face's control for that same parameter, so the
mapping pair must be invertible across the full legal range.

**Red test.** `tests/test_mbsplit_pass1.js` — extracts the two functions from
`mbsplit_ui.js` and asserts (a) round-trip within 0.5 dB for every half-dB step
−69.5 … +18, and (b) no >1 dB jump when sweeping norm 0…1 in 0.001 steps.

## BUG 2 — Dynamic Phase FIR display approximation exceeds its stated 0.1 tolerance

**Severity:** display / architecture contract — the band curves the face draws
in Dynamic Phase mode (via `computeBandMagnitudesAtFreq` →
`computeFirLowpassMag`) diverge from the real Kaiser kernel by up to ~0.18
linear magnitude at low crossovers, contradicting AGENTS.md.

**Symptom.** AGENTS.md (Multiband Split / Dynamic Phase) states
`computeFirLowpassMag` is a raised-cosine display approximation of the real
Kaiser FIR kernel, "**within 0.1 of the real kernel**". Against
`evalFirHalfKernel(designFirHalfKernel(fc, sr, D))` with
`D = firLatencyForSampleRate(sr)`, the worst error on this tree is
**0.180** (f ≈ 108.7 Hz, fc = 40, sr = 96000; real ≈ 0.81 vs approx ≈ 0.63).
Error already exceeds 0.1 at the default-ish F1 = 120 Hz. The error grows when
the crossover approaches / falls below the transition half-width `sr / D`,
where the `lo <= 0` normalization branch in `computeFirLowpassMag` runs
(`src/mbsplit_config.js:273`).

**Why the host suite is green.** `tests/test_mbsplit.js` §1b only checks
fc ∈ {800, 4500} at 48 kHz — well above `sr/D = 375` Hz — so the lo≤0 branch
never runs and the 0.1 assert stays satisfied.

**Red test.** `tests/test_mbsplit_pass1.js` — sweeps fc ∈
{40, 120, 300, 800, 2000, 4500, 9000} at 48 kHz and 96 kHz over a log-frequency
grid and asserts max |real − approx| ≤ 0.1.

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
# RED (must fail on HEAD):
node tests/test_mbsplit_pass1.js

# Host gate (must stay green; production untouched):
npm run -s typecheck && python3 scripts/build_mbsplit.py && node tests/test_mbsplit.js
```
