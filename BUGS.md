# Sand bug sweep — pass 1 (hunt + red tests, NO fixes)

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

- `set_freq` (`sand_ui.js:160`): `Number(v) || 14000` maps an explicit 0 to 14000 instead of clamping to the 20 Hz floor the reticle/gen would use. No in-device sender can emit 0 (the Freq box minimum is 20 and the drag clamps to 20..18000), so it is unreachable from the shipped patcher.
- Gen coefficient cache (`sand_core.genexpr:220-272`) computes and stores `cAtk/cRel/cKnee/cMild` on refresh, but `compand()` recomputes attack/release/knee/mild from `soft01` internally and `channel()` never receives the cached copies — dead work once per parameter change, no behavioural effect.
