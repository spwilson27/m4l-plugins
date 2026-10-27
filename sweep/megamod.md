# Mega Modulator sweep2 lane report (stage A+B: audit + red tests)

Host gate: typecheck, build, test_megamod.js (21688 checks) pass; test_megamod_perf.js pass; test_megamod_ui.js FAILS (MM-01). test_device_static (1 allowlisted), test_face_fuzz (1500 steps strict canvas): clean.
Previews rendered (committed state + scratch builds of every UB_PREVIEW_* state) and read; state-blob garbage fuzz (3000 mutated states through normalizeState/serialize): no throw, no non-finite.

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| MM-01 | S2 | XY pad: click/drag mapping ignores the 2 px inset the puck/crosshair is painted with (`ubXyDrag` uses the full rect). A click on the painted puck at (0,1) stores (0.042,0.958); AGENTS 21 says (0,1) must stay (0,1). Also baseline F5. With the assertion softened this is the ONLY failure in test_megamod_ui.js (12 sub-checks, collapsed and expanded). | tests/test_megamod_ui.js:3745, soft-run | tests/test_megamod_sweep2.js (MM-S2-01), tests/test_megamod_ui.js:3745 |
| MM-02 | S2 (infra, frozen file) | scripts/vm_megamod_keys.sh uses `$ROOT` (line 24, `. "$ROOT/scripts/vm_common.sh"`) before assigning it (line 27) under `set -u`: aborts with "ROOT: parameter not set" unless ROOT is exported. vm_megamod_live_suite.sh does not export ROOT, so the whole Live suite fails at the first step (explains "never ran" in baseline). Fix in shared infra: move the ROOT= line above. Workaround used: `export ROOT=<worktree>`. | audio run failed until ROOT exported | tests/test_megamod_sweep2.js (MM-S2-02) |
| MM-03 | S4 | DSP loading / failed pill (`ubPaintDsp`) is drawn at top-right of the layout over strip headers (hides the 5th strip's name/type glyph in preview; a persistent "DSP failed" pill would cover expanded-strip type chip / delete button). | previews newmods1/newmods5 | none |
| MM-04 | S4 | AGENTS 21 drift: check totals (23,021 / 13,578 claimed; actual 21,688 / 13,616), ROUTE_SAMPS stated 1040 (code 1048). Reported for doc owner only. | grep | none |
| MM-05 | S4 | Smoke screenshot shows Max Console "node.script Node script not ready can't handle message map samples" - not from this device (no node.script box in Mega Modulator); likely other VM state. | smoke default.png | none |

## Verified OK (no finding)
- Parameter pool: 257 LOM params, unique short names, ranges/units/enums as documented; marker Int 0..2; Depth only for pool slots <64 (by design).
- New audio case `extremes` (all generator types at range extremes: 40 Hz / 0.01 Hz, inverted/degenerate MSEG loop, 32 steps+glide, synced div 0/15 at 300 bpm, follower +36 dB / 0.05 ms attack, ADSR thresh 0/-60, XY slew 1): finite and within -1..1 -> PASS (kept as a regression test in scripts/run_megamod_audio_tests.py).
