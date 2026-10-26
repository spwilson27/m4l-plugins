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
