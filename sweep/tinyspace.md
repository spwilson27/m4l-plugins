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
