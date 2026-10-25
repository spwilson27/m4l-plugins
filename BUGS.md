# Cepstra bugsweep — PASS-3 fixes (bugsweep/cepstra-pass1)

Host gate green after PASS 3: `npm run -s typecheck && python3 scripts/build_cepstra.py && node tests/test_cepstra.js` → 1627 checks; `node tests/test_cepstra_bugsweep.js` → 15 checks.

## PASS-3 outcome

**Fixed 2 / kept from PASS-2.**

| Bug | Status | Touchpoints |
| --- | --- | --- |
| A — stale f0 / display ignores `voiced` | **FIXED** | `src/cepstra_core.genexpr` `job_lift` Auto/MIDI `else { f0v = 0; }`; `src/cepstra_display.js` `periodSamplesNow` requires `voiced` in Auto |
| B — shared `#0-cepscope` | **FIXED** | `scripts/build_cepstra.py` + display defaults + gen comment → `---cepscope`; `tests/test_cepstra.js` asserts; rebuilt `devices/Cepstra.amxd` |

### Bug A fix notes
- Gen Auto arm: after `if (best > 0.06) { … voiced = 1; }`, add `else { f0v = 0; }` so unvoiced frames clear scope 257 while still holding `L` / `held`.
- Gen MIDI arm: after `if (midiNote >= 0) { … }`, add `else { f0v = 0; }` for note-off.
- Display: `periodSamplesNow()` Auto branch is now `curMode === 1 && voiced && f0Hz > 20`. Paint diamond / Hz label and Res drag both go through that helper, so unvoiced → period 0 → manual Res map.

### Bug B fix notes
- Renamed `buffer~` / `scope` / `setbuffer` from `#0-cepscope` to `---cepscope` (Live expands `---` per instance; `#0` does not in a top-level device).
- `tests/test_cepstra.js`: exact message asserts + buffer~ isolation check now require `---`; sandbox setbuffer/resend use `---cepscope`.
- `tests/test_cepstra_bugsweep.js`: display sandbox prepends `cepstra_config.js` (face script shape) so RED paint checks can run after genexpr is green.
- Also updated `scripts/run_cepstra_audio_tests.py` `SCOPE` (and probe/AGENTS comments) so VM audio tests bind the new name.

### Host gate
```
npm run -s typecheck && python3 scripts/build_cepstra.py && node tests/test_cepstra.js && node tests/test_cepstra_bugsweep.js
```
→ green (1627 + 15). No merge to main (PASS 4 reviews next).

## PASS-2 review outcome (historical)

**Kept 2 / dropped 0.** See git `7a55961`.

| Bug | Verdict | One-line |
| --- | --- | --- |
| A — stale f0 / display ignores `voiced` | **KEEP** | Verified in `job_lift` Auto/MIDI arms + `periodSamplesNow` + green diamond paint; RED fails first assert on unfixed code. |
| B — shared `#0-cepscope` | **KEEP** | Build still ships `buffer~`/`scope #0-cepscope`; Multiband/Glitch/Reverb+/Amp+ `---` migration is the correct precedent. |

## Bug A — Auto / MIDI leave a stale f0 in scope 257; display pitch marker ignores `voiced`

**Where (pre-fix)**
- `src/cepstra_core.genexpr` — `job_lift` (~L130–185)
- `src/cepstra_display.js` — `periodSamplesNow` (~L400–403) and the Auto/MIDI pitch diamond paint (~L619–625)

**Contract**
- Gen header: `257 : f0 estimate in Hz (0 = unvoiced / unknown)`; `261 : voiced flag`.
- AGENTS (Cepstra): Auto holds **L** when unvoiced (`L = k * period` held); it does **not** say f0 is held.

**RED**
`tests/test_cepstra_bugsweep.js` — genexpr static checks + display sandbox (Auto + unvoiced + stale f0).

## Bug B — `#0-cepscope` is shared across every Cepstra instance in Live

**Where (pre-fix)**
- `scripts/build_cepstra.py` — `buffer~ #0-cepscope`, `scope #0-cepscope`
- `src/cepstra_display.js` — default `#0-cepscope` binding path

**Contract / precedent**
AGENTS.md Multiband/Glitch/Reverb+/Amp+ `---` isolation.

**RED**
`tests/test_cepstra_bugsweep.js` — build/display/amxd must bind `---cepscope`.
