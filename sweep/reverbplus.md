# Sweep 2 lane report: reverbplus (Reverb+, Reverb+ End, Reverb+.adg) - stage A+B

## Coverage
- Host gate (typecheck, build, test_reverbplus, test_reverbplus_face, test_reverbplus_bugsweep, previews): green. Previews Reverb / Tone / Tail / Conv read: clean.
- test_device_static (Reverb+ 1 allowlisted `r #0-rptest`), test_face_fuzz: clean.
- vm_smoke (.amxd, End, .adg; distinct slugs `reverb`, `reverb_end`, `reverb_adg`): PASS, 61/61 params swept, two instances isolated, DSP ready 0.15..1.8 s, screenshots read: no glitch, rack shows Start / nested FX / collapsed End.
- VM audio (Max): switch freezeL_hall drywet input_0 input_m12 sleep_hall sleep_size_hall conv_swap conv_null stable_hall stable_spring loopclip looptime loopmin period_room_min perf_conv: all PASS.
- Live `vm_reverbplus.sh run` (chain loop, Shifter, face clicks, real file drops): all checks passed (second run).
- Doc drift: parameter table (ranges/defaults/units), RP_INACTIVE, RP_LOOP constants (TANK_FRAC, K, AP 1.5x), DSP retry timeouts match AGENTS 27. None found.

## Findings
| id | sev | device | description | red test |
|---|---|---|---|---|
| RP-S2-01 | S2 | Reverb+ | An IR control (Stretch/Start/Reverse/Decay) edited within 200 ms of dropping a new IR re-processes the OLD source: status becomes "processing", and the new file's `ir_loaded` (accepts only status "loading") is ignored, so the dropped IR is never used (old IR stays, new name shown). Fix idea: `rpIrLoad` must also cancel a pending reproTask when set after, or `ir_loaded` should accept "processing" when `rpIr.path` changed / reprocess must bail while loading. | tests/test_reverbplus_sweep2.js (fails: got 4800 expected 9600) |
| RP-S4-01 | S4 | Reverb+ | Dropping the same path again while loaded is ignored (`rpLastDropped`), so an edited file cannot be reloaded without clearing. | log only |
| RP-S4-02 | S4 | Reverb+ | After a failed IR load, name shows the new file while the previous IR stays active. | log only |
| RP-S4-03 | S4 infra | test_reverbplus_live.js | First Live run failed: `/tmp/rpdrop/ir_src.wav` missing in VM (shared `/tmp/rpdrop` clobbered by another lane's `rm -f /tmp/rpdrop/*`); passed on rerun. | log only |
| RP-S4-04 | S4 | previews | render_preview ignores parameter_units (Decay "2", Bass Mult "1"); Live is correct. | log only |

Counts: S1 0, S2 1, S3 0, S4 4.

## Verify
- RP-S2-01 KEEP: red test run, fails for the stated reason (got 4800, expected 9600); code confirms rpIrReprocess sets status "processing" during a load and ir_loaded returns unless status is "loading"; user-visible (dropped IR never used); not an iteration-1 item.
- RP-S4-01 KEEP (log only, S4): deliberate dedupe, minor; no test.
- RP-S4-02 KEEP (log only, S4): no test.
- RP-S4-03 REJECT as a device finding: infra/shared /tmp clobbering between lanes, not a Reverb+ bug.
- RP-S4-04 REJECT as a bug: preview renderer limitation already documented in AGENTS 27 (Live is correct).
