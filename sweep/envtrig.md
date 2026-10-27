# Sweep 2 lane report: envtrig (Envelope Trigger.amxd)

## Stage A+B summary
Host gate (typecheck, build, test_envtrig, bugsweep, preview) pass; face fuzz ok; static: 1 violation (E-01).
VM audio suite (hits, scope, quiet, velocity, sustain, hold): all pass (velocity 76 at -14 dB matches the map, sustain fires once, audio bit-identical, no NaN).
Live: vm_smoke PASS (8/8 params, 38 sets, meters 0.85); `vm_envtrig.sh run` (2-instance collapse test) PASS.
`vm_envtrig.sh ui` crashes before running (E-03).
Counts: S1 0, S2 2, S3 1, S4 3.

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| E-01 | S2 | Duplicate Live short name `MIDI To` on hidden `MIDI To Panel` toggle and `MIDI Output Type` menu (rename the toggle's short name; keep long names / order). | tests/test_device_static.js | tests/test_envtrig_sweep2.js E-01 |
| E-02 | S3 | Threshold / Sens / Hold dial labels and value text are dark grey on the dark panel in real Live (default theme): practically unreadable. No `textcolor` on the live.dial boxes (the numboxes have one). | tests/out/smoke/envelope_trigger/default.png (crop) | tests/test_envtrig_sweep2.js E-02 x3 |
| E-03 | S2 (tooling) | scripts/run_envtrig_ui_tests.py slices `var PANEL_NAMES = ` but the embed minifier emits `var PANEL_NAMES=[...]`: JSONDecodeError, the UI test never runs. | `vm_envtrig.sh ui` traceback | tests/test_envtrig_sweep2.js E-03 |
| E-04 | S4 | Doc drift: AGENTS s12 says `buffer~ #0-trigscope` / `scope #0-trigscope`; code uses `---trigscope` (correct for Live). The static allowlist entry (`receive envtrig-test`) is legitimate (bridge test hook, reports keyed by device id). | build_envtrig.py | log only |
| E-05 | S4 | Velocity map at Threshold 0 dB: a 0 dBFS peak gives velmin (t=(pk-thr)/max(-thr,1) = 0). Vel Lo > Vel Hi is silently clamped (hi follows lo). | envtrig_core.genexpr | log only |
| E-06 | S4 | Face coalesces several fires inside one 33 ms poll into one tick/LED flash (counter diff only). | envtrig_ui.js pullScope | log only |

## Verify
- E-01 KEEP: test fails on the real duplicate short name 'MIDI To' (obj-panel-toggle, obj-route-type); Live requires unique short names; not an iteration-1 item.
- E-02 KEEP: smoke screenshot shows the Threshold/Sens/Hold labels and values dark grey on the dark teal panel, barely legible; the three live.dial boxes have no textcolor; test fails for that reason.
- E-03 KEEP: runner slices the literal "var PANEL_NAMES = " but the built script has "var PANEL_NAMES=[...]"; the test reproduces the mismatch (tooling, but it blocks the UI test from ever running).
- E-04/E-05/E-06 log-only S4, no tests; nothing to verify.

## Fix
| id | status | change |
|---|---|---|
| E-01 | fixed | `MIDI To Panel` toggle short name -> `MIDI Panel` (long name, order unchanged) in scripts/build_envtrig.py |
| E-02 | fixed | live.dial boxes get `textcolor` [0.86,0.90,0.94,1]; Live smoke shot shows readable Thresh/Sens/Hold labels and values |
| E-03 | fixed | run_envtrig_ui_tests.py prefix `var PANEL_NAMES=`; `vm_envtrig.sh ui` now passes |
| E-04 | fixed (doc) | AGENTS s12 trigscope now `---trigscope`; static allowlist entry (`receive envtrig-test`) confirmed legitimate |
| E-05/E-06 | not fixed | S4, log only |

Gate: typecheck, build, test_envtrig, test_envtrig_sweep2, preview (read), test_device_static (Envelope Trigger ok; other devices' violations are not this lane), test_face_fuzz 0 failures; VM: `vm_envtrig.sh ui` pass, `vm_envtrig.sh run` pass, `vm_smoke.sh` PASS. DSP unchanged so no audio re-run. Commit: "fix(envtrig): unique MIDI Panel short name, ...".

## Review
Diff main...HEAD reviewed: build_envtrig.py (short name, dial textcolor), run_envtrig_ui_tests.py prefix, one exact AGENTS s12 line, red test file. No frozen/shared files touched. Fresh rebuild leaves devices/ unchanged (committed .amxd matches). Gates re-run: typecheck, test_envtrig, test_envtrig_sweep2, test_device_static (Envelope Trigger ok). Red tests assert the real defects (duplicate short name, missing textcolor, runner prefix vs built script). Verdict: READY. Deferred shared items: none.
