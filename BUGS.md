# Cepstra PASS-1 bugs (bugsweep/cepstra-pass1)

Host gate baseline was green (`npm run -s typecheck && python3 scripts/build_cepstra.py && node tests/test_cepstra.js` → 1627 checks). No production code was changed in this pass. RED coverage is in `tests/test_cepstra_bugsweep.js`.

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

**Expected**
- Gen: when Auto peak fails the 0.06 threshold, or MIDI has no note, write `f0v = 0` (keep holding L / `held` as today).
- Display: Auto pitch marker / Hz label / `periodSamplesNow` must require `voiced` (mirror MIDI's `curMidiNote >= 0` gate). Unvoiced → period 0 → manual Res map fallback.

**RED**
`tests/test_cepstra_bugsweep.js` — genexpr static checks that the Auto unvoiced path and the MIDI no-note path assign `f0v = 0`; display sandbox: Auto + `voiced=0` + stale `f0Hz=120` must not paint the green pitch marker / Hz label, and `periodSamplesNow`-driven Res click must use the manual map.

## Bug B — `#0-cepscope` is shared across every Cepstra instance in Live

**Where**
- `scripts/build_cepstra.py` — `buffer~ #0-cepscope`, `scope #0-cepscope`
- `src/cepstra_display.js` — default `setbuffer("1001-cepscope")` / `#0-cepscope` binding path
- Existing `tests/test_cepstra.js` currently *requires* the `#0-` prefix

**Contract / precedent**
AGENTS.md (Multiband Split buffer isolation fix; also Glitch `---glitchscope`, Reverb+ `---rpscope`): `#0` is **not** expanded in a top-level Live device, so every instance shared one ring/header. Those devices migrated to unique `---` names. Cepstra is the same class of top-level audio effect and still ships `#0-cepscope`.

**User-visible effect**
Two Cepstra instances on a track (or Cmd+D) would write into one shared 272-sample scope: faces show each other's cepstrum / L / f0 / voiced.

**Expected**
Rename to a unique `---` buffer (e.g. `---cepscope`) in build, gen bind, display `setbuffer`, and tests (harness may keep a private `#0-` name if needed, as Multiband does).

**RED**
`tests/test_cepstra_bugsweep.js` — built device / build script / display must bind `---cepscope` (or another non-`#0-` unique name), not `#0-cepscope`.

## Out of scope for PASS 1
Production fixes for A/B. PASS 2+ should clear f0 on unvoiced / no-note, gate the display on `voiced`, and migrate the scope buffer name (updating the existing `#0-` assertions in `test_cepstra.js`).
