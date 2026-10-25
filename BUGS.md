# Multiband Split — Pass 1–3 bugsweep

Branch: `bugsweep/mbsplit-pass1` · Worktree: `/private/tmp/bugsweep/mbsplit` · base HEAD `d72ee17`

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
