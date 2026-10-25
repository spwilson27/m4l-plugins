# Tiny Space bugsweep (bugsweep/tinyspace-pass1)

PASS-1 filed Bug A with a RED suite. PASS-2 reviewed that RED and **kept** it. No production code has been changed. RED coverage remains in `tests/test_tinyspace_bugsweep.js`. Host gate (`npm run -s typecheck && python3 scripts/build_tinyspace.py && node tests/test_tinyspace.js`) stays green; the bugsweep suite is separate and stays RED until PASS 3 fixes production.

## PASS-2 review

- **Kept 1 / dropped 0.**
- **KEEP Bug A** — real functional instance cross-talk: Live does not expand `#0` in a top-level device patcher, so every Tiny Space shares one config and one meter buffer. Precedent (Multiband / Delay+ / Glitch / Reverb+ `---` names) confirms the expected fix shape. RED asserts the right surfaces (build `buffer~` / bind / `setbuffer`, built `.amxd`, UI `new Buffer("#0-tsmeters")` hardcode in `tsDspFrames`) and fails on current code. No rewrite or strengthening needed.
- Pass-1 "reviewed and not filed" items re-checked; none elevated to a new RED. No additional tinyspace-specific top-level `#0-` buffers found beyond `tsconfig` / `tsmeters`.

## Bug A — `#0-tsconfig` / `#0-tsmeters` are shared across every Tiny Space instance in Live

**Where**
- `scripts/build_tinyspace.py` — `buffer~ #0-tsconfig @samps 128` (~L434), `buffer~ #0-tsmeters @samps 32` (~L447), bind `cfg #0-tsconfig, meters #0-tsmeters` (~L513), face `setbuffer #0-tsconfig #0-tsmeters` (~L527)
- `src/tinyspace_ui.js` — `tsDspFrames()` hardcodes `new Buffer("#0-tsmeters")` (~L193) instead of using the `meterBuf` from `setbuffer` (~L44–47)
- `tests/test_tinyspace.js` (~L331–339) currently *requires* the `#0-` prefix on those boxes
- Comments / docs that teach the same names: `src/tinyspace_config.js` L2, `src/tinyspace_core.genexpr` L2/L6, `AGENTS.md` Tiny Space section (~L367 / L372), `scripts/run_tinyspace_audio_tests.py` L4–5 / L85–109

**Contract / precedent**
AGENTS.md (measured): `#0` is **not** expanded in a device's top-level patcher in Live (only in abstractions). Multiband Split migrated `#0-splitscope` → `---mbsplitscope`; Delay+ uses `---dpxfer` / `---dphdr`; Glitch uses `---glitchslots` / `---glitchscope` / `---glitchctl`; Reverb+ uses `---rpscope` / `---rpxfer`. Tiny Space is the same class of top-level audio effect and still ships `#0-tsconfig` / `#0-tsmeters`.

Gen itself is fine: `Buffer cfg("tsconfig")` / `Buffer meters("tsmeters")` are fixed external names bound on loadbang (Glitch pattern). The shared names are the patcher's `buffer~` objects and the messages that bind / `setbuffer` them.

**User-visible effect**
Two Tiny Space instances (second track, or Cmd+D) share one config buffer and one meter buffer:
1. Seed / Character (and any UI poke into `#0-tsconfig`) on instance A rewrites instance B's tank geometry.
2. String / meter viz crosses: each face reads the other's envelopes and frame counter.
3. `tsDspFrames` always peeks the literal `#0-tsmeters`, so even a future `setbuffer` of an expanded per-instance name would not fix DSP-ready detection until that hardcode is removed.

**Expected**
Rename to unique `---` buffers (e.g. `---tsconfig`, `---tsmeters`) in build (`buffer~`, gen bind message, face `setbuffer` message), have `tsDspFrames` use `meterBuf` (or the name passed through `setbuffer`), and update `tests/test_tinyspace.js` assertions. The audio harness may keep private `#0-` names for its own probe buffers if needed (Multiband precedent: device `---mbsplitscope`, harness `#0-splitscope`).

**RED**
`tests/test_tinyspace_bugsweep.js` — build script / built `devices/Tiny Space.amxd` / UI must use instance-unique `---` names (not `#0-tsconfig` / `#0-tsmeters`); UI must not hardcode `new Buffer("#0-tsmeters")`.

## Reviewed and not filed

These were checked against AGENTS / source / tests and are **not** bugs (doc drift or intentional design):
- JS `fdnMix` / `house()` vs gen `house()` for models 0–7, n=1–10: 0 coefficient mismatches.
- Nested returns: every gen helper has a single function-level return; `dampCoef` if-block then return is OK.
- Presentation rects (title / seed / char / viz / dials): no mutual live.* overlap; all inside 292×169.
- Seed `parameter_type` 0 + steps 1001; Character enum; `%/100` dial scales; deferred DSP (no static `plugin~`→`plugout~`); silence-sleep zeroing wet when asleep — intentional and covered by existing tests.
- AGENTS "70-float" vs `CFG_FLOATS=72`, and "whole samples" vs `interp="linear"` + `round()`: doc drift / intentional, not RED material.
- `Global("tinyspace_dspq")`: shared create-queue like `mbsplit_dspq` — intentional.

## Out of scope until PASS 3

Production fixes for Bug A. PASS 3 should migrate the buffer names to `---…`, route `tsDspFrames` through `meterBuf` / `setbuffer`, and update the existing `#0-` assertions in `test_tinyspace.js` (and AGENTS / comments).
