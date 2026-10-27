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
