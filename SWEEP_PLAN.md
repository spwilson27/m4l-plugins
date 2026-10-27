# Sweep 2 — Deep review & validation of every device (orchestration plan)

## Context
Many devices were built or "fixed" by lower-quality agents. The earlier sweep (`BUG_SWEEP_PLAN.md`, iteration 1 partly done) was a static read + Node red-test loop; it never exercised the real GUI in Live, never swept every parameter end-to-end, and ran few VM tests. This sweep validates each device for real — GUI (no glitches, every control works), parameters (range/default/units/automation/save-restore reach the DSP), DSP (correct, stable, latency as reported) — using the tart VM (`macos-1`) for Max and Live, fixes what it finds, and turns every finding into a permanent test. It replaces `BUG_SWEEP_PLAN.md` (its iteration-1 log is carried over as "already fixed, don't re-report").

Orchestrator = the main session (Opus). Every subagent runs on **sonnet** (audit/fix/review) or **haiku** (mechanical runs, verification of test output) per `~/.claude/CLAUDE.md`. Max **6 device lanes in flight**. All Max/Live work goes through the VM locks (`/tmp/m4l_real_max.lock`, `scripts/vm_live_lock.sh`), so VM runs queue no matter how many lanes run.

## Device lanes (21; shared code has one owner)
| Wave | Lanes |
|---|---|
| 1 (highest risk) | sampler (Better Sampler + Reactive 2), megamod, xo_map, reverbplus (+End), glitch, spectral (transplit, loudsplit, harmsplit, freqsplit) |
| 2 | delayplus (+End), mbsplit, cepstra (+cepstrum_lib), scopes (analyzer + oscilloscope), eqplus, clipplus |
| 3 | envtrig, degrade, percipitator, reciprocator, tinyspace, sand |
| 4 | shaper, theme_editor, ableton_mcp (last: it is the Live test bridge) + shared-code lanes |

Frozen during waves 1–3 (edited only in Phase 0 or wave 4 shared lanes): `scripts/max_harness.py`, `scripts/vm_*.sh` infra, `scripts/vm_live_lock.sh`, `scripts/vm_live_open.sh`, `scripts/live_remote/*`, the MCP bridge, `src/spectral_*` (owned by the spectral lane only), `src/analyzer_core.genexpr` (scopes lane), `src/cepstrum_lib.genexpr` (cepstra lane), `src/spectral_theme.js` / theme engine. Lanes report shared-code bugs instead of editing.

## Phase 0 — prepare (serial, before any lane)
1. **Prune old trees** (user chose prune now): first save `git for-each-ref` tips + `git log main..<branch> --oneline` of every `bugfix/*`, `bugsweep/*` branch to the scratchpad (recovery record), then `git worktree remove --force` + `git branch -D` for all `bugfix/*` and `bugsweep/*`; keep `feat/*` and `archive/*`; `git worktree prune`. Untracked `src/amp_*`, `scripts/amp_nam_ref.py`, `tests/amp_ref/` (Amp+ leftovers) are left untouched and flagged to the user.
2. **Per-worktree VM checkouts (infra agent, sonnet).** Most `scripts/vm_*.sh` hard-code `~/ableton` and `rsync --delete` into it, so parallel worktrees would clobber each other. Add one env var `M4L_VM_DIR` (default `~/ableton`, existing `SPECTRAL_VM_DIR` / `GLITCH_VM_DIR` / `CLIPPLUS_VM_DIR` / `MM_VM_DIR` become aliases) to every `vm_*.sh` and `make_*_set.py` path; generated `.als` reference that dir. Lane convention: `M4L_VM_DIR=~/sweep2/<lane>`. Test: two dirs synced at once, a Live `ensure` from each.
3. **Generic Live smoke harness** — new `scripts/test_device_smoke_live.js` + `scripts/vm_smoke.sh <device.amxd|.adg>...` built on `vm_live_open.sh ensure/load/exec`, the MCP bridge and `vm_shot.sh`. Per device: load into a fresh track (two instances for isolation), wait for DSP ready (device trace in `Global(...)` if declared, else output meter moves on a test clip), enumerate LOM parameters, for each: set min / default / max / 2 random values, read back `value` + `str_for_value`, assert output meter finite and bounded, no `#0`/`---` cross-talk between the two instances, device width / 169 px via the device's own report hook when present; screenshot Live (device selected and in view, `mm_os_input.py window Live` for the crop) at default and after the sweep into `tests/out/smoke/<device>/*.png`. One device config table (`scripts/smoke_devices.json`: path, kind, ready probe, safe test clip, params to skip).
4. **Generic host checks** — new `tests/test_device_static.js` (all `devices/*.amxd`): AGENTS §1 rules (169 height/openrect, panels last + background, no `live.*` over interactive v8ui except the ignoreclick exception, Int params >255 typed Float, unique short names, no literal `#0` where Live won't expand it, every v8ui script sets `relative_coords = 0`, no Max-global declarations, GenExpr lint: single return, no `e<digit>` / `phi`/`pi` idents, helpers first). Reuse existing lints from `test_cepstra.js`, `test_delayplus.js`, `test_glitch.js` by moving them into `tests/lint_lib.js`. Generalize `tests/paint_bounds_lib.js` into `tests/face_fuzz_lib.js`: load any face script in a vm sandbox with the recording mgraphics mock, paint across param extremes + random states, fire random click/drag/dblclick/wheel/key sequences, assert no throw, no out-of-bounds / NaN drawing, every emitted param in range.
5. **Baseline on main**: run every lane's host gate + `test_device_static.js` + face fuzz + `vm_smoke.sh` over all devices + each device's VM audio suite (serial, can run overnight; Glitch sweeps only the default set). Write `SWEEP_BASELINE.md` (what is already red, e.g. the 2 deliberately red oscilloscope tests). Commit Phase 0 (scoped commits per step).
6. Replace `BUG_SWEEP_PLAN.md` with `SWEEP_PLAN.md` (this plan + carried-over iteration-1 log + tally).

## Phase 1 — per-lane pipeline (6 lanes at a time, background)
Each lane: worktree `/tmp/sweep2/<lane>` on branch `sweep2/<lane>` from current main, VM dir `~/sweep2/<lane>`, report file `sweep/<lane>.md` on its branch (unique path → no merge conflicts). Stages, each a separate agent:

**A. Audit (sonnet).** Inputs: device's AGENTS.md section, src/, build script, tests, its baseline row, the old iteration log. Checks:
- *Doc ↔ code drift*: every concrete claim in the AGENTS section (ranges, defaults, layout rects, telemetry slots, gen messages) verified against code; drift = finding.
- *GUI*: `render_preview.py` + extra states (folds, themes, tabs, algorithms via existing env hooks), Read every PNG; face fuzz; then `vm_smoke.sh` screenshots in real Live (authority for glitches — the preview renderer is approximate per AGENTS). Look for truncated/overlapping text, controls off-panel, wrong colours/theme, stale drawing, unclickable or misaligned hit areas.
- *Parameters*: for every parameter: range/default/units/exponent sane, UI → object → gen/engine path wired, Live → model path (automation) without undo/dirty side effects, save/restore + blob version fallback, linked/mirror params don't loop.
- *DSP*: run the device's VM audio suite cases; add checks for neutral-setting identity, extremes (no NaN/inf/runaway, CPU sane), silence sleep/wake, reported latency == measured, multi-instance isolation.
- Output: findings with severity S1 crash/blow-up/data loss, S2 wrong behaviour, S3 visual glitch, S4 nit (logged, not fixed).

**B. Red tests (same audit agent).** Every S1–S3 finding gets a failing test at the cheapest layer that proves it: Node unit/face test → `run_<dev>_audio_tests.py` case (VM Max) → Live check in the device's `test_*_live.js` or the smoke config. Confirm it fails for the stated reason. Commit.

**C. Verify (fresh sonnet, not the author).** KEEP / REJECT each red test (real user-visible bug, correct expected value, not a duplicate, not flaky). Rejected tests deleted. Commit verdicts in `sweep/<lane>.md`.

**D. Fix (sonnet).** Smallest correct fix in `src/` / `scripts/`, rebuild (never hand-edit `.amxd`), full AGENTS gate for the lane, Read previews; VM Max audio only if DSP changed (affected cases), Live run (`vm_live_lock.sh batch` — one hold per lane run) if face/LOM/routing changed; re-run smoke for the device. Update the device's AGENTS.md section with exact-string edits only where behaviour changed. Commit per passing step.

**E. Review (fresh sonnet).** Full diff vs main: correctness, regressions, AGENTS rules, `.amxd` == a rebuild, no frozen/shared files touched, test quality. Fixes → re-gate. Hand back to orchestrator.

**Merge (orchestrator).** Rebase/merge onto main, re-run the lane gate + `test_device_static.js` on main, merge, remove worktree + branch + VM dir (`rm -rf ~/sweep2/<lane>` in the VM). Append the tally line to `SWEEP_PLAN.md`. Start the next lane from the queue.

## Phase 2 — shared-code lanes (wave 4, one at a time)
Collect flagged shared bugs from all reports: spectral framework, analyzer scope ring (incl. the deferred oscilloscope sample-rate bug), cepstrum lib, theme helpers, max harness / vm scripts, MCP bridge. Same A–E pipeline; after merge re-run the gates and the smoke of **every dependent device**.

## Phase 3 — integration on main
Host: all gates + static + face fuzz. VM: every audio suite (serial), `vm_megamod_live_suite.sh`, `vm_spectral.sh livetest` + `sumtest`, the per-device `vm_<dev>.sh run`, then `vm_smoke.sh` over all devices with screenshots; Read every screenshot. Compare against `SWEEP_BASELINE.md`. Final report: findings / fixes / tests added per device, deferred items with reasons, published as an Artifact page for the user.

## Mechanics
- Driven by the **Workflow tool, one workflow per wave** (6 lane pipelines, ~5 agents each ≈ 30 agents per wave, ~130 agent runs total — the user asked for this orchestration; confirm cost at approval). Within a wave, lanes run as a `pipeline` so a lane goes A→E without waiting on others; merges are done by the orchestrator between waves.
- Lane agents never touch another lane's worktree, VM dir, or the main checkout.
- Live lock rules from AGENTS §1a apply verbatim; `M4L_LIVE_LOCK_MAX_HOLD` raised only for long batches.
- Status between waves: short update to the user (lanes merged, findings by severity, blockers).

## Critical files
New: `scripts/test_device_smoke_live.js`, `scripts/vm_smoke.sh`, `scripts/smoke_devices.json`, `tests/test_device_static.js`, `tests/lint_lib.js`, `tests/face_fuzz_lib.js`, `SWEEP_PLAN.md`, `SWEEP_BASELINE.md`, `sweep/<lane>.md`.
Modified (Phase 0 only): all `scripts/vm_*.sh`, `scripts/make_*_set.py` (VM dir), `tests/paint_bounds_lib.js` (wrapped by face_fuzz_lib).
Reused: `scripts/max_harness.py`, `scripts/vm_live_lock.sh` (`batch`), `scripts/vm_live_open.sh` (`ensure/load/exec`), `scripts/vm_shot.sh`, `scripts/mm_os_input.py`, `scripts/live_loader_client.py`, `scripts/ableton_mcp_server.js`, existing `run_*_audio_tests.py` and `test_*_live.js`.

## Verification
- Phase 0: two lanes' VM dirs synced concurrently without interference; `vm_smoke.sh` produces readable screenshots and a param table for 3 sample devices (one audio FX, one instrument, one rack `.adg`); `test_device_static.js` passes or lists only real findings on main.
- Per lane: red test fails before fix, passes after; lane gate green on main after merge; smoke screenshot inspected.
- End: Phase 3 all green except documented deferrals; every finding has a test in the repo.

## Carried over from BUG_SWEEP_PLAN.md (iteration 1: already fixed, do not re-report)

- Iteration 1 — xo_map (XO Sample Map): 3 bugs found in Pass 1, KEEP all 3 in Pass 2, fixed in Pass 3 (91c9608), Pass 4 independent review passed with no corrections, merged to main (12f846e), device rebuilt on main (1e425ad, build(xo_map): rebuild device for pass4 i1 fixes), full xo_map gate passed on main, worktree /tmp/bugsweep/i1/xo_map and branch bugsweep/i1/xo_map removed.
- Iteration 1 — oscilloscope (Oscilloscope): Bug 1 (pitch-estimator low-frequency floor rises at high sample rates; labelled Bug 3 in the tests) fixed in Pass 3 (7573456, maxLag window fraction 0.64 -> 0.85 in src/oscilloscope_config.js), Pass 4 independent review passed with no corrections, merged to main (da9626a), main gate passed (typecheck, build, test_oscilloscope.js 163561 checks, preview visually inspected), worktree /tmp/bugsweep/i1/oscilloscope and branch bugsweep/i1/oscilloscope removed. Bug 2 (fixed timebase windows shrink at high sample rates; labelled Bug 4 in the tests) is DEFERRED to the shared scope-ring pass (OSC_RING_N / src/analyzer_core.genexpr / Analyzer constants moved together) — its 2 tests in tests/test_oscilloscope_bugsweep.js stay red on main by design (18 checks passed / exactly 2 failing), not as an oversight.
- Iteration 1 — shaper (Better Shaper): 2 bugs found in Pass 1, KEEP both in Pass 2, fixed in Pass 3 (505c517), Pass 4 independent review passed with no corrections, merged to main (8da9264), device rebuilt on main (5e30090, build(shaper): rebuild device for pass4 i1 fixes), full shaper gate passed on main, worktree /tmp/bugsweep/i1/shaper and branch bugsweep/i1/shaper removed.
- Iteration 1 — sand (Sand): 2 bugs found in Pass 1 (Bug C scope ring telemetry order, Bug D value-bar pre-blend), KEEP both in Pass 2, fixed in Pass 3 (bbe78db), Pass 4 independent review passed with no corrections (frame-259 consumers re-verified: pullWave oldest-to-newest, sandDspConfirm change-only; .amxd byte-matched a script rebuild), merged to main (d2f25fc), full sand gate passed on main (typecheck, build_sand, test_sand, test_sand_bugsweep, render_preview inspected), worktree /tmp/bugsweep/i1/sand and branch bugsweep/i1/sand removed.
- Iteration 1 — eqplus (EQ+): 4 bugs found in Pass 1, KEEP all 4 in Pass 2, fixed in Pass 3 (9af304d), Pass 4 independent review passed with no corrections, merged to main (84b5eba), device rebuilt on main (17f4dc0, build(eqplus): rebuild device for pass4 i1 fixes), full eqplus gate passed on main, worktree /tmp/bugsweep/i1/eqplus and branch bugsweep/i1/eqplus removed.
- Iteration 1 — ableton_mcp (Ableton MCP Bridge): 5 bugs found in Pass 1 (BUG-MCP-12..16), BUG-MCP-15 REJECTED in Pass 2 (032e430, no spec/code evidence for a 413 limit; Pass 4 confirmed it was not resurrected), remaining 4 KEEP and fixed in Pass 3 (2734fc0), Pass 4 independent review passed with no corrections (full diff re-verified line by line, .amxd byte-matched a script rebuild, live probes for ping id 0 / id null / notification silence / split Content-Type header all passed), merged to main (8119094), full ableton_mcp gate passed on main (typecheck, build_ableton_mcp, test_ableton_mcp, test_ableton_mcp_bugsweep, test_ableton_mcp_stdio_http, render_preview visually inspected), worktree /tmp/bugsweep/i1/ableton_mcp and branch bugsweep/i1/ableton_mcp removed.
- Iteration 1 — delayplus (Delay+ incl. Delay+ End): 2 bugs found in Pass 1, KEEP both in Pass 2, fixed in Pass 3 (e324912), Pass 4 independent review passed with no corrections (End xfer buffer {RING}=65536 verified against delayplus_end.genexpr wrap/peek/poke at RING with hdr staying 64 slots, highest hdr index 42; LFO display Noise lfoHash(Math.floor(p)) verified against the gen re-rolling noise() only on phase wrap, drawIcon noise glyph unchanged; artifacts verified as genuine build outputs — .amxd byte-identical after build-stamp normalisation, .adg/.als decompressed XML differing only in /private/tmp path prefix and LastModDate), merged to main (ca50031), full delayplus gate passed on main (typecheck, build_delayplus, test_delayplus.js 39/39, test_delayplus_bugsweep.js 4/4, render_preview for Delay+ and Delay+ End both visually inspected clean), worktree /tmp/bugsweep/i1/delayplus and branch bugsweep/i1/delayplus removed.
- Iteration 1 — harmsplit (Harmonic Split): 1 bug found in Pass 1 (painted T handle in hsPaintAnalysis clamped to hsBase()-6.5 = y 84.5, up to 5.5 px above the Threshold line, outside hsHandleDown 5 px line tolerance, so the handle could not be grabbed or double-click-reset at thr -120 dB Automatic / -119 dB), KEEP in Pass 2, fixed in Pass 3 (e49b9de, +5 lines in src/harmsplit_ui.js honouring the painted handle position like the existing L/H flag exception), Pass 4 independent review passed with no corrections (thy matches the paint clamp exactly, thx 1 px from the painted centre but inside the 6 px tolerance, Threshold semantics and paint unchanged, no shared files; .amxd rebuilt byte-identical at 188252 bytes, .adg decompressed XML identical except LastModDate build timestamps), merged to main (6187b87), full harmsplit gate passed on main (typecheck, build_harmsplit, test_harmsplit, test_harmsplit_bugsweep, test_harmsplit_face, test_harmsplit_paint_bounds 7506 scenarios, render_preview previews/harmonic_split.png visually inspected clean), worktree /tmp/bugsweep/i1/harmsplit and branch bugsweep/i1/harmsplit removed.
- Iteration 1 — fill (Fill): 4 bugs found in Pass 1 (Bugs A-D, tests/test_fill_bugsweep.js), KEEP in Pass 2, Bug D (sample-rate-blind cache signatures in fillPublishIr and fillPublishBank) fixed in Pass 3 (a222c58, fillSr() added to both signatures in src/fill_dsp.js; Bugs A-C checks already pass on main), Pass 4 independent review passed with no corrections (both signatures change iff the sample rate changes and are byte-identical when nothing changes — suite controls plus a direct probe: IR publish 72 pokes at 48 kHz, repeat still 72 pokes with the slot unchanged, sr 44100 republished, repeat cached again; the bank signature is exactly hit|pageSeed|sr|metas with numeric-only neighbours that cannot contain a pipe, so the delimited sr field cannot collide or be spoofed; fillSr() is a pure read of the samplerate global with a 48000 fallback and no side effects; no third sample-rate-dependent cache or publish path exists in fill_dsp.js; no shared files edited; .amxd is a pure rebuild — rebuilt in the worktree at 246494 bytes with git status clean), merged to main (a57b3d1), full fill gate passed on main (typecheck, build_fill, test_fill, test_fill_face, test_fill_bugsweep 12/12, render_fill_faces five faces visually inspected clean, vm_fill.sh audio ok), worktree /tmp/bugsweep/i1/fill and branch bugsweep/i1/fill removed.
- Iteration 1 — analyzer (Analyzer): 3 bugs found in Pass 1, KEEP all 3 in Pass 2, fixed in Pass 3 (89364f4), Pass 4 independent review passed with no corrections (log-axis inverse round-trip verified to 2.6e-15 relative error with exact endpoints and old 40/18000 edges intact and both paint paths distinct/increasing; amp 0.25 tone reads -12.042 dB in both Heat and its Bars band; anBandEnergies sole production consumer anTakeSpectrum re-confirmed; scope cut+count <= n verified at 44.1k-384k in Auto and Free; test_analyzer.js 4 -> 4/1.5 edit adjudicated a legitimate calibration consequence, strict equality and both routing assertions preserved; no changes to src/analyzer_core.genexpr, the shared scope-ring layout, or any shared file; .amxd is a pure rebuild at 120807 bytes with git status clean after building), merged to main (9c1b0e0), full analyzer gate passed on main (typecheck, build_analyzer, test_analyzer 185580 checks, test_analyzer_bugsweep 16/16, render_preview previews/analyzer.png visually inspected clean), worktree /tmp/bugsweep/i1/analyzer and branch bugsweep/i1/analyzer removed.

## Sweep 2 tally

### Wave 1 (merged 2026-10-27)
| Lane | S1 | S2 | S3 | S4 (logged) | Fixed | Notes |
|---|---|---|---|---|---|---|
| sampler | 0 | 1 | 0 | 3 | S2 `#0-bs*` buffers -> `---bs*` (both devices), theme test regex | hooks lookup in Live not yet run |
| megamod | 0 | 0 | 0 | 3 | XY test inset, `extremes` case, MM-02 vm script ROOT order (orchestrator) | Live suite still to run |
| xo_map | 0 | 6 | 1 | 7 | all 7 (blob v4) | XO-S2-05 partial: Edited renders fold stereo to mono |
| reverbplus | 0 | 1 | 0 | 4 | IR control edit during load swallowed the new IR | build is byte-nondeterministic |
| glitch | 0 | 2 | 0 | 6 | vm_glitch.sh ROOT, Live param changes now update the state blob | |
| spectral | 1 | 2 | 4 | 2 | F2 minifier `0-1/x` silent gen (Transient/Loud), F3 Mix dry/K via `inrack`, F9 widths | D2 shared `#0-sstest` hook; F1 .adg paths (shared) |

Deferred to shared lanes: F1 `.adg` absolute paths; `scripts/minify_gen.py` should keep `0- N/` safe (no other core uses the idiom today); `tests/paint_bounds_lib.js` move_to-before-arc false positive; `#0-sstest` / `#0-amptest` test hooks.

### Wave 4 (merged 2026-10-27)
| Lane | S1 | S2 | S3 | S4 (logged) | Fixed | Notes |
|---|---|---|---|---|---|---|
| shaper | 0 | 3 | 2 | 4 | `---mseg`, short name `Sync Rate`, Esc / keys `3` `u` no longer delete MSEG points, numbox widths show the unit | AGENTS rule 5 still uses `#0-mseg` as its example |
| theme_editor | 0 | 0 | 2 | 3 | header hint clipped, LED red when no server port is free | macro sliders inert on the Default preset (by design of the theme engine) |
| ableton_mcp | 0 | 3 | 0 | 7 | missing LOM paths return errors, >128 parameters, 403 for Origin / non-loopback Host | API unchanged |
| shared | 0 | 3 | 1 | 1 | `.adg` relative-only references, deterministic Delay+ / Reverb+ builds, minifier keeps `0 - N /`, paint-bounds arc false positive | `#0-sstest` kept as a documented test hook; relative `.adg` load in Live: see Phase 3 |

### Wave 3 (merged 2026-10-27)
| Lane | S1 | S2 | S3 | S4 (logged) | Fixed | Notes |
|---|---|---|---|---|---|---|
| envtrig | 0 | 2 | 1 | 3 | short name `MIDI To` -> `MIDI Panel`, dial text colour, UI runner prefix | |
| degrade | 0 | 2 | 1 | 6 | `---degscope`, wet path soft knee (no level step), dial text colour; F6 was a test bug | codec echo latency unreported (S4) |
| percipitator | 0 | 2 | 0 | ? | `---percipwt` / `---percipscope`, MIDI input routing | real MIDI chord in Live not checked |
| reciprocator | 0 | 0 | 1 | 6 | dial text colour | |
| tinyspace | 0 | 1 | 1 | ? | dial text colour, duck slewed (no hard cut on seed change) | VM audio not re-run after the slew |
| sand | 0 | 3 | 0 | ? | `---sandwave`, Param `mix` -> `wetamt`, fixnan on input | |

### Wave 2 (merged 2026-10-27)
| Lane | S1 | S2 | S3 | S4 (logged) | Fixed | Notes |
|---|---|---|---|---|---|---|
| delayplus | 0 | 0 | 2 | 4 | max time capped by tank length per sample rate; End K held-min reset on counter jump (first pair after Set open) | no gen~ retry (S4); F9 not reproduced |
| mbsplit | 0 | 0 | 1 | 3 | F1/F2/F3 numbox echo when the face clamps | F9 not reproduced |
| cepstra | 0 | 2 | 1 | 7 | constant PDC latency 4608, display sample rate, MIDI input routing; cepstrum_lib runner host-generated | MIDI From chooser deferred |
| scopes | 0 | 1 | 1 | ? | scope ring 4096 -> 16384 (50 ms / 8 Cyc windows at 96/192 kHz), F5 | Oscilloscope VM audio + Live smoke not completed |
| eqplus | 0 | 2 | 0 | 3 | `#0-eqplus*` -> `---`, audio runner replays host fixtures | new AGENTS section 32 |
| clipplus | 0 | 5 | 0 | 6 | layout (True Peak / Meters), channel mode, `---clipscope`, restore drift, duplicate cord | |
