# Tiny Space bugsweep (bugsweep/tinyspace-pass1)

PASS-1 filed Bug A with a RED suite. PASS-2 reviewed that RED and **kept** it. PASS-3 fixed production: top-level buffers are now instance-unique `---tsconfig` / `---tsmeters`, `tsDspFrames` peeks `meterBuf` from `setbuffer`, and `tests/test_tinyspace.js` expects the `---` names. Host gate (`npm run -s typecheck && python3 scripts/build_tinyspace.py && node tests/test_tinyspace.js && node tests/test_tinyspace_bugsweep.js`) is green. RED coverage remains in `tests/test_tinyspace_bugsweep.js` as a regression guard.

## PASS-2 review

- **Kept 1 / dropped 0.**
- **KEEP Bug A** — real functional instance cross-talk: Live does not expand `#0` in a top-level device patcher, so every Tiny Space shares one config and one meter buffer. Precedent (Multiband / Delay+ / Glitch / Reverb+ `---` names) confirms the expected fix shape. RED asserts the right surfaces (build `buffer~` / bind / `setbuffer`, built `.amxd`, UI `new Buffer("#0-tsmeters")` hardcode in `tsDspFrames`) and fails on current code. No rewrite or strengthening needed.
- Pass-1 "reviewed and not filed" items re-checked; none elevated to a new RED. No additional tinyspace-specific top-level `#0-` buffers found beyond `tsconfig` / `tsmeters`.

## Bug A — `#0-tsconfig` / `#0-tsmeters` are shared across every Tiny Space instance in Live

**Where (pre-fix)**
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

## PASS-3 fix

**Status:** FIXED (host gate + bugsweep suite green). Commit SHA filled after commit on `bugsweep/tinyspace-pass1`.

**Production touchpoints**
- `scripts/build_tinyspace.py` — `buffer~ ---tsconfig @samps 128` (~L434), `buffer~ ---tsmeters @samps 32` (~L447), bind `cfg ---tsconfig, meters ---tsmeters` (~L513), face `setbuffer ---tsconfig ---tsmeters` (~L527)
- `src/tinyspace_ui.js` — `tsDspFrames()` peeks `meterBuf` (from `setbuffer`); comments at ~L141 / ~L189 updated to `---tsmeters (meterBuf)`
- `tests/test_tinyspace.js` (~L331–339) — asserts `---tsconfig` / `---tsmeters` (required so the main suite stays green; not a weaken of the bugsweep RED)
- Comments / docs aligned with production: `src/tinyspace_config.js` L2, `src/tinyspace_core.genexpr` L2/L6, `AGENTS.md` Tiny Space section (~L367 / L372)
- `devices/Tiny Space.amxd` — rebuilt after the rename (intentional; include in the PASS-3 commit)

**Left unchanged (intentional)**
- GenExpr `Buffer cfg("tsconfig")` / `Buffer meters("tsmeters")` — external names, bound via loadbang
- Audio harness private `#0-` probe buffers: `scripts/run_tinyspace_audio_tests.py`, `tests/tinyspace_harness.maxpat`, `tests/tinyspace_probe.js` (self-consistent inside the harness patcher; Multiband precedent)
- `tests/test_tinyspace_bugsweep.js` — kept as regression guard (still asserts `#0-` absence / `---` presence)

## Reviewed and not filed

These were checked against AGENTS / source / tests and are **not** bugs (doc drift or intentional design):
- JS `fdnMix` / `house()` vs gen `house()` for models 0–7, n=1–10: 0 coefficient mismatches.
- Nested returns: every gen helper has a single function-level return; `dampCoef` if-block then return is OK.
- Presentation rects (title / seed / char / viz / dials): no mutual live.* overlap; all inside 292×169.
- Seed `parameter_type` 0 + steps 1001; Character enum; `%/100` dial scales; deferred DSP (no static `plugin~`→`plugout~`); silence-sleep zeroing wet when asleep — intentional and covered by existing tests.
- AGENTS "70-float" vs `CFG_FLOATS=72`, and "whole samples" vs `interp="linear"` + `round()`: doc drift / intentional, not RED material.
- `Global("tinyspace_dspq")`: shared create-queue like `mbsplit_dspq` — intentional.

## PASS-3 complete

Bug A production fix is in; harness `#0-` names and the bugsweep RED suite stay as documented above. Pass 4 reviews next — do not merge to main from this pass.
