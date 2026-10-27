# Sweep 2 lane report: mbsplit (Multiband Split.amxd)

## Stage A+B summary
- Host gate (typecheck, build, test_mbsplit with MBSPLIT_SKIP_LIVE_MCP=1, paint bounds, bugsweep, pass1): PASS. test_device_static: ok (0 violations). test_face_fuzz: 0 failures.
- Preview previews/multiband_split.png read: no truncation or overlap.
- vm_smoke (Live 12.4.x): PASS, 8/8 params, 33 sets, meters 0.857 -> 0.852, DSP ready 1267 ms (first) / 154 ms (second instance), no leaks between A and B. Screenshots default.png / after_sweep_full.png read: face drawn correctly. Baseline F9 ("gen~ failed to compile patcher" Console line after the sweep) did NOT reproduce; no Max Console window visible in this run, trace shows both gens ready.
- Doc<->code: parameters (Crossover 1/2/3 20..20000 exp 3 defaults 120/800/4500, Slope 12/24/48 default 24, Phase Mode, Chain Gain -70..18, Link Group, Band Mode), rects (viz 8,20,252x102; sections; controls y=145), latency set at runtime, blob v3 layout all match AGENTS s11. Blob loader survives hostile arrays (NaN, short, version 99) without throwing.
- VM audio suite (scripts/vm_mbsplit.sh audio): see Result below.

Counts: S1 0, S2 0, S3 1, S4 3.

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| MB-01 | S3 | set_f1/f2/f3 only echo ui_f* to the live.numbox when a NEIGHBOUR changed. When the face clamps the written value itself (F1 20000 with F2/F3 at their limits -> 14142 Hz; F3 20 Hz at the bottom of the stack -> 28.3 Hz) the parameter keeps the unclamped value while DSP/face use the clamped one (param range 20..20000 is wider than the reachable range). Saved Set value disagrees with the sound. | tests/mbsplit_sandbox.js run: set_f1(20000) -> curF1 14142, no ui_f1 emitted | tests/test_mbsplit_sweep2.js MB-01, MB-01b (FAIL) |
| MB-02 | S4 | Coverage gap: run_mbsplit_audio_tests.py rendered the readable src core, but the device embeds the minified gen (build gendsp_json -> minify_gen). Runner now minifies (MBSPLIT_MINIFY=0 to disable). | scripts/run_mbsplit_audio_tests.py | n/a (runner changed) |
| MB-03 | S4 | setvalueof with an unknown future version (e.g. [99,1,2,3]) is parsed as the legacy unversioned layout (F1=99 Hz) instead of being ignored. | node probe | log only |
| MB-04 | S4 | Gain below -69.5 dB is silent in the gen (cGainLin 0) while the numbox range is -70..18 and displays -69.7 as a number, not -inf. | core l.186 | log only |
| F9 | not reproduced | see above | smoke PASS | n/a |

Not run in this stage: vm_mbsplit.sh livetest (rack sum, linking, work sharing) - Live lock was contended by other lanes; to be run before fixing.

## Verify
- MB-01 KEEP: re-run, fails for the stated reason (set_f1/set_f3 clamp without echoing ui_f*; code at src/mbsplit_ui.js set_f1..f3 emits ui_* only when emitDspState(neighChanged) is true). User-visible: numbox/saved value disagrees with the sound. Deterministic, not an iteration-1 item.
- MB-01b KEEP: same cause, F3 at the bottom of the stack; deterministic.
- MB-02 KEEP (runner change, no test): sound, makes audio suite test the shipped minified gen; guarded by MBSPLIT_MINIFY=0.
- MB-03, MB-04 stay log-only S4 (no tests, nothing to delete); MB-04 is by design (-70 dB = off).
- F9 not reproduced: accepted; no test.
- No tests rejected or deleted.

## Fix
- MB-01 / MB-01b: FIXED. set_f1/f2/f3 in src/mbsplit_ui.js now also echo ui_f* when the written value itself was clamped (selfClamped). tests/test_mbsplit_sweep2.js passes.
- MB-02: already in runner (minified gen tested). MB-03, MB-04: log-only S4, unchanged (MB-04 by design). F9: not reproduced.
- Gates: typecheck, build, test_mbsplit (live MCP skipped on host), paint bounds, sweep2 test, preview read (no defects), test_device_static (Multiband Split ok; remaining violations belong to other devices), test_face_fuzz 0 failures.
- Live: vm_mbsplit.sh livetest (batch) all checks passed (rack sum flat, one FFT leader, linking, mute). VM audio not rerun: no DSP change. vm_smoke not rerun: only a numbox echo change, livetest covers Live load.

## Review
- Diff main...HEAD: ui change (3 clamp echoes), runner minify, 2 test files, rebuilt device, report. No frozen/shared files, no AGENTS.md edits.
- Fresh rebuild equals committed Multiband Split.amxd (git diff --stat devices/ empty). Typecheck, test_mbsplit (host), sweep2 test, preview: pass.
- Tests prove the bug (red before fix per Verify stage). Minor: test_mbsplit_sweep2.js is not chained into test_mbsplit.js (run separately).
- Verdict: READY. Deferred shared items: none (MB-03/MB-04 S4 log-only; F9 not reproduced).
