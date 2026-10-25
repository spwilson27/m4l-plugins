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
