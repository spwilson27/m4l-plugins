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
