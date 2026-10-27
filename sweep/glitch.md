# Sweep 2 lane report: glitch (Glitch.amxd)

## Stage A+B summary
Host gate (typecheck, build, test_glitch 99 groups, bugsweep, preview) all pass; test_face_fuzz Glitch 0 failures; test_device_static ok.
All 9 preview states (default, editor, seq, options, many, many2, motion, new, specedit, options2) read: no truncation/overlap defects seen.
Live smoke (vm_smoke) PASS (11/11 params, 44 sets, screenshots tests/out/smoke/glitch/*.png look right); `vm_glitch.sh run` (full Live suite incl. 2-instance isolation) all checks passed.
VM audio (filtered): neutral, neutral_min, neutral_stub, spec_latency, silence, stress_all, stress_p4, weights, telemetry, slots, xy_morph(_empty), seq_empty, tail, wet: pass (neutral bit-exact -300 dB, latency 1023, no NaN).
Sweeps: 19 launches (filter_a/b, formant, comb, phaser_a, crush, rectify, fm, ring, stutter, ratchet, time, delay_a, reverb, shuffle, chopper_a, spec_freeze, spec_mp3, spec_clipper) 111 checks pass.
Seq/movement cases (mv_*, seq_*, events, disc_switch, spec_go, spec_t): pass.
Node probes (sweep/probe1-4.js, not committed as tests): 400 seeds x 4 chaos randomize (finite, spec cap, blob roundtrip), hostile blobs, hit-map OOB/overlap over 67k rects, mutate/lock, 3000-step random UI drive with state/vector stability: no defects.

Counts: S1 0, S2 2, S3 0, S4 6.

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| G-01 | S2 (tooling) | scripts/vm_glitch.sh sources "$ROOT/scripts/vm_common.sh" (l.18) before ROOT= (l.21) under `set -u`: every audio/live/sync call dies "ROOT: parameter not set" unless ROOT is exported. Same bug in scripts/vm_megamod_keys.sh (megamod lane). | ran it | tests/test_glitch_sweep2.js G-01 (FAILS) |
| G-02 | S4 | Doc drift: src/glitch_config.js header + build_glitch.py docstring say weights 6824..6831, SEQ=6832, constants end 10292; real 6816, 6824, 10280. AGENTS s19 phase 3/4 numbers (25 instances, 885 floats, 10752) superseded by v6/v7 (24 instances, 852, 10496). | glitchLayout() | log only |
| G-03 | S4 | glitchFormatValue prints "-0.0 st" / "-0.0 dB" for tiny negatives. | node | log only |
| G-04 | S4 | Editor row bars: paint inset 1px, click maps x over full width; Motion bars use 2px inset. Click at painted edge shifts value by <=1/w. | glitch_ui.js setRowFromX vs paintEditor | log only |
| G-05 | S4 | normalizeGlitch copies raw g.movement (dead field) into state blob, unbounded passthrough. | l.1516 | log only |
| G-06 | S4 | normalizeSeq: step null becomes slot 1 (Number(null)=0). | probe2 | log only |
| G-07 | S4 | Fuzz: set_out(48000) draws "+48000.0dB" (face does not clamp; Live does). | face fuzz | log only |
| G-09 | S2 | Parameter-path changes (set_chaos, set_morphx/y, set_mode, set_seqrate, set_glide, set_seqlen from automation/LOM/macro) update gState but never notifyclients, so Live keeps a stale GlitchStateData blob; on Set load setvalueof(stale)+syncParamsOut overwrite the restored parameter. Live evidence: Chaos 80 -> duplicate_track clone has 50 (param and face). | scripts/test_glitch_persist_live.js FAIL 'clone: Chaos 80 -> 50' (latency 1023, seed/tiles/slots/Mix/Out/Morph X/Mode/Seq Length all PASS) | tests/test_glitch_sweep2.js G-09 x6 (FAIL) |
| G-08 | gap | Live suite had no latency_in_samples == 1023 check and no save/restore (duplicate_track) check. Added scripts/test_glitch_persist_live.js (see result below). | | n/a |

## Verify
- G-01 KEEP: ran tests/test_glitch_sweep2.js, fails for the stated reason (ROOT used at line 18, assigned at line 21 under set -u); real tooling bug. Note: vm_glitch.sh is device-owned, but the same bug in vm_megamod_keys.sh belongs to the megamod lane.
- G-09 KEEP (x6 tests): ran, all fail with "no notifyclients"; onParamIn (src/glitch_ui.js:214) updates gState for chaos/morph/mode/seq* without done(), unlike the chaos(v) message path; expected value matches the blob-persistence contract (AGENTS s19). Fix should debounce/notify without churning undo. Live repro (scripts/test_glitch_persist_live.js, Chaos 80 -> clone 50) not re-run in this stage (no Live lock taken).
- G-08 KEEP: scripts/test_glitch_persist_live.js is a new check, not a bug.
- G-02..G-07 log-only S4 nits: no red tests, nothing to verify or delete; G-04 and G-07 are cosmetic and low value.
- Rejected: none.

## Fix
- G-01 fixed: ROOT assigned before sourcing vm_common.sh in scripts/vm_glitch.sh (commit 5312dc9). The same bug in scripts/vm_megamod_keys.sh is for the megamod lane.
- G-09 fixed: onParamIn in src/glitch_ui.js now calls done() (notifyclients) for chaos, morphx/y, mode, seqrate, glide and seqlen (commit 5312dc9). The 6 red tests in tests/test_glitch_sweep2.js pass.
- G-08: scripts/test_glitch_persist_live.js committed. It was not re-run after the fix; the Live clone Chaos 80 check is unverified.
- G-02..G-07 (S4): not fixed (log-only nits).
- Gate: typecheck, build_glitch, test_glitch, test_glitch_sweep2, test_face_fuzz, preview and test_device_static all pass for Glitch (the static violations are other devices'). `vm_glitch.sh run` (full Live suite): all checks passed. DSP unchanged, so no Max audio re-run.
- DEFERRED(shared): none.

## Review
- Diff main...HEAD: devices/Glitch.amxd, src/glitch_ui.js, scripts/vm_glitch.sh, new tests/test_glitch_sweep2.js, tests/glitch_ui_harness.js, scripts/test_glitch_persist_live.js, sweep/glitch.md. No frozen/shared files, no AGENTS.md edits.
- Fresh rebuild (typecheck + build_glitch.py): `git status devices/` clean, committed .amxd equals the rebuild.
- Gates: test_glitch 99 groups, test_glitch_sweep2 all pass. The red tests fail on the pre-fix code for the stated reason (no notifyclients / ROOT used before assignment), so they prove the bugs.
- Fix review: `done()` is only `notifyclients()` (no echo loop). Side effect: automation playback of Chaos/Morph/Mode/Seq now dirties the Set, which is required for the blob to stay current.
- Live (re-run, under the lock, set rebuilt): scripts/test_glitch_persist_live.js all PASS incl. latency 1023 and clone Chaos 80 -> 80 (was 50 before the fix). This closes the "not re-run" gap in the Fix section.
- Deferred shared: vm_megamod_keys.sh has the same ROOT-before-assignment bug (megamod lane).
- Verdict: READY.
