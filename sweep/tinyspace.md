# Sweep 2 - tinyspace lane (Tiny Space.amxd) - Stage A+B

Baseline reproduced: host gate (typecheck, build, test_tinyspace, test_tinyspace_bugsweep, preview), face fuzz, static: PASS.
VM: vm_smoke PASS (12/12 params, 59 sets, no crash; Live screenshots read); audio suite (all cases) result below.

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| TS-S3-01 | S3 | All 7 `live.dial`s set no `textcolor`, so Live draws names/values in its theme text colour on the forced-dark panels: HP, LP, Size, Fbk, XFeed, Width, Mix labels and values are nearly invisible (preview renderer draws them white, hiding it) | tests/out/smoke/tiny_space/default.png | tests/test_tinyspace_sweep2.js TS-S3-01 |
| TS-S2-01 | S2 | Seed / Character change: the v8ui pokes the new config into the gen buffer first and only then bangs the duck; the gen `duckG = clip(duck,0,1)` is an unsmoothed step, so the ringing tail is hard-cut (click) while the new config is already live | src/tinyspace_ui.js set_seed/set_character; core duckG | TS-S2-01a (order), TS-S2-01b (no slew) |

## S4 / log only
- TS-S4-01 AGENTS says the seed config is 70 floats; it is 72 (CFG_MODEL at 70, CFG_FLOATS 72). Core header comment says coefficients are recomputed only when controls change, but `doCoef` is forced every sample while Mod > 0 (default 15%): 20x ringGain/dampCoef (pow/exp) + 20 pokes per sample.
- TS-S4-02 `set_viz_mode` (split L/R view) is unreachable: no control or message sends it.
- TS-S4-03 Modulated line times are rounded to whole samples (stepping clicks at Mod > 0, by design per core comment, undocumented).
- TS-S4-04 Seed/Character initial values are not re-banged on DSP ready (only dials), the first set_seed/set_character after load skips the duck by design (`seededOnce`); relies on Live outputting initial values at load (unverified).
- TS-S4-05 parameterbanks list long names ("Feedback") while Live names params by short name ("Fbk"); Push bank resolution unverified.

Red run: `node tests/test_tinyspace_sweep2.js` -> 3 checks fail for the stated reasons.

## Verify
- TS-S3-01 KEEP: real S3; Live smoke screenshot shows HP/LP/Size/Fbk/XFeed/Mix dial text faint on the dark panels, all 7 dials lack textcolor (test fails for that reason).
- TS-S2-01a REJECT: poke and duck bang run back-to-back in one JS call on the main thread, so call order is not audibly observable; asserting source order is implementation-pinning, not a user-visible bug. Test removed.
- TS-S2-01b KEEP (weak, S2/S3): duck is an unsmoothed step to 0 in the gen (duckG = clip(duck)), hard-cutting the tail; slewing it is a sound fix. Test is implementation-specific (expects slew()), fails for the stated reason.
- S4 log items: not tests, no action.

## Fix
- TS-S3-01: FIXED (build_tinyspace.py make_dial adds light textcolor). Commit 8d8de28. Live smoke screenshot: dial names/values legible.
- TS-S2-01b: FIXED (core `duckG = slew(clip(duck,0,1), 0.9992)`, ~2.6 ms). Commit 8d8de28.
- TS-S2-01a: rejected in verify. S4 items: logged only.
Gate: typecheck, build, test_tinyspace, bugsweep, test_tinyspace_sweep2 (both ok), preview read, test_device_static (Tiny Space 0 violations), test_face_fuzz 0 failures, vm_smoke PASS (12/12 params, meters 0.86).
Not run: VM Max audio suite (no vm_tinyspace.sh wrapper; the runner would have launched Max on the host, so it was aborted at once and nothing was left running). The DSP change is a 2.6 ms gain slew on the seed/character duck; covered by smoke only.
No AGENTS.md edit (S4-01 70-vs-72 float note left for a docs pass).

## Review
- git diff main...HEAD: one build line (dial textcolor), one core line (duck slew), test file, report, smoke outputs. No frozen/shared files or AGENTS.md touched.
- Fresh rebuild equals committed Tiny Space.amxd (git diff --stat devices/ empty). typecheck, test_tinyspace, sweep2 test pass.
- Test cleanup: removed dead vm/event scaffolding and a stale "must duck BEFORE poke" comment left from the rejected TS-S2-01a. Both remaining tests are source/patcher checks (implementation-specific, but they fail on the pre-fix code).
- Slew starts at 0 with duck default 1: ~3 ms fade-in at load, benign.
- Gap: the 2.6 ms duck slew is not covered by a Max audio case (no vm_tinyspace wrapper); smoke only.
- Deferred shared items: none (S4-01 70 vs 72 float doc note left for a docs pass).
