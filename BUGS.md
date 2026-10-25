# Degrade — Bug Sweep (Pass 1 reds + Pass 2 review)

Device: `devices/Degrade.amxd` · Worktree: `/tmp/bugsweep/degrade` · Branch: `bugsweep/degrade-pass1`
Tests: `tests/test_degrade.js`, new section 5 ("BUGSWEEP PASS 1").
Command: `node tests/test_degrade.js`

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

Fix commit SHA: see tip of `bugsweep/degrade-pass1` after pass-3 commit.

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
