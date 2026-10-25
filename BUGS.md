# Cepstra bugsweep — PASS-2 review (bugsweep/cepstra-pass1)

Host gate baseline was green on PASS 1 (`npm run -s typecheck && python3 scripts/build_cepstra.py && node tests/test_cepstra.js` → 1627 checks). No production code was changed in PASS 1 or PASS 2. RED coverage is in `tests/test_cepstra_bugsweep.js`.

## PASS-2 review outcome

**Kept 2 / dropped 0.**

| Bug | Verdict | One-line |
| --- | --- | --- |
| A — stale f0 / display ignores `voiced` | **KEEP** | Verified in `job_lift` Auto/MIDI arms + `periodSamplesNow` + green diamond paint; RED fails first assert on unfixed code. |
| B — shared `#0-cepscope` | **KEEP** | Build still ships `buffer~`/`scope #0-cepscope`; Multiband/Glitch/Reverb+/Amp+ `---` migration is the correct precedent. |

Evidence re-checked against live sources (not just PASS-1 notes):
- Auto arm (`modeNow < 1.5`): `f0v = peek(stat,1)` then only assigned inside `if (best > 0.06)`; unvoiced fallthrough leaves stale `f0v`; `poke(stat, f0v, 1)` writes it.
- MIDI arm: `f0v` assigned only inside `if (midiNote >= 0)`; no-note path never clears.
- Display: `periodSamplesNow` Auto arm is `curMode === 1 && f0Hz > 20` with **no** `voiced` gate; paint L618–627 draws green diamond / Hz from that period. Display *does* load `voiced` from scope 261 (`voiced = numAt(chunk, 261) > 0.5`), so the gate fix is local.
- Gen header contract: `257 : f0 estimate in Hz (0 = unvoiced / unknown)`; `261 : voiced flag`. AGENTS: Auto holds **L** when unvoiced, not f0.
- Bug B: `scripts/build_cepstra.py` still has `buffer~ #0-cepscope` / `scope #0-cepscope` / `setbuffer #0-cepscope`; AGENTS Multiband Split isolation note (`---mbsplitscope`) and Glitch/Reverb+/Amp+ `---` names are the fix pattern.

RED suite left in place (still expected FAIL on unfixed code). Existing `tests/test_cepstra.js` `#0-` assertions stay until PASS 3 migrates the buffer name.

## Bug A — Auto / MIDI leave a stale f0 in scope 257; display pitch marker ignores `voiced`

**Where**
- `src/cepstra_core.genexpr` — `job_lift` (~L130–185)
- `src/cepstra_display.js` — `periodSamplesNow` (~L400–403) and the Auto/MIDI pitch diamond paint (~L619–625)

**Contract**
- Gen header: `257 : f0 estimate in Hz (0 = unvoiced / unknown)`; `261 : voiced flag`.
- AGENTS (Cepstra): Auto holds **L** when unvoiced (`L = k * period` held); it does **not** say f0 is held. Silence sleep already clears scope 257 to 0.

**What happens**
1. Auto: `f0v = peek(stat, 1)` then only assigned inside `if (best > 0.06) { … voiced = 1; }`. On an unvoiced frame `voiced` stays 0 but `f0v` keeps the previous pitch; `job_tele` writes that stale value to scope 257.
2. MIDI: when `midiNote < 0`, neither `f0v` nor a clear runs — same hold of the previous note's Hz.
3. Display: `periodSamplesNow()` returns `srNow / f0Hz` whenever `curMode === 1 && f0Hz > 20`, with **no** `voiced` check. Paint then draws the green pitch diamond and `NNNHz` label from that period. Res-bar clicks in Auto also call `axis01ToRes(..., periodSamplesNow())`, so an unvoiced frame with a ghost f0 does **not** take the documented "Auto without a period → manual map" fallback (`cepstra_config` / existing test at `test_cepstra.js` L54).

**User-visible effect**
After a voiced note drops to noise/breath (or MIDI note-off with Res Mode still MIDI), the green pitch marker and Hz label stick on the last pitch, and Res drag mapping keeps using that ghost period.

**Expected (PASS 3)**
- Gen: when Auto peak fails the 0.06 threshold, or MIDI has no note, write `f0v = 0` (keep holding L / `held` as today).
- Display: Auto pitch marker / Hz label / `periodSamplesNow` must require `voiced` (mirror MIDI's `curMidiNote >= 0` gate). Unvoiced → period 0 → manual Res map fallback.

**RED**
`tests/test_cepstra_bugsweep.js` — genexpr static checks that the Auto unvoiced path and the MIDI no-note path assign `f0v = 0`; display sandbox: Auto + `voiced=0` + stale `f0Hz=120` must not paint the green pitch marker / Hz label, and `periodSamplesNow`-driven Res click must use the manual map.

## Bug B — `#0-cepscope` is shared across every Cepstra instance in Live

**Where**
- `scripts/build_cepstra.py` — `buffer~ #0-cepscope`, `scope #0-cepscope`
- `src/cepstra_display.js` — default `#0-cepscope` binding path
- Existing `tests/test_cepstra.js` currently *requires* the `#0-` prefix

**Contract / precedent**
AGENTS.md (Multiband Split buffer isolation fix; also Glitch `---glitchscope`, Reverb+ `---rpscope`): `#0` is **not** expanded in a top-level Live device, so every instance shared one ring/header. Those devices migrated to unique `---` names. Cepstra is the same class of top-level audio effect and still ships `#0-cepscope`.

**User-visible effect**
Two Cepstra instances on a track (or Cmd+D) would write into one shared 272-sample scope: faces show each other's cepstrum / L / f0 / voiced.

**Expected (PASS 3)**
Rename to a unique `---` buffer (e.g. `---cepscope`) in build, gen bind, display `setbuffer`, and tests (harness may keep a private `#0-` name if needed, as Multiband does). Update the existing `#0-` assertions in `test_cepstra.js` at that time.

**RED**
`tests/test_cepstra_bugsweep.js` — built device / build script / display must bind `---cepscope` (or another non-`#0-` unique name), not `#0-cepscope`.

## Out of scope

Production fixes for A/B belong in **PASS 3** (clear f0 on unvoiced / no-note, gate the display on `voiced`, migrate the scope buffer name). PASS 2 is review-only: keep/drop reds, update this file, host-gate, commit.
