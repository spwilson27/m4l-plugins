# Sweep 2 - sand lane (Sand.amxd)

Stage A+B (audit + red tests). Red tests: `tests/test_sand_sweep2.js` (node). Audio runner now tests the MINIFIED gen and has new extreme cases.

| id | sev | device | finding | evidence | red test |
|---|---|---|---|---|---|
| SD-1 | S2 | Sand | `buffer~ #0-sandwave`, `wave #0-sandwave`, `setbuffer #0-sandwave` in the top-level patcher: Live does not expand `#0` there, so every Sand instance shares one scope buffer (cross-talk of scopes, shared wpos/DSP-ready counter: a second instance can see "ready" from the first). The v8ui also falls back to a literal `"#0-sandwave"`. Use `---sandwave` (existing tests/test_sand.js assert the `#0` names and must be updated with the fix). | test_device_static.js instance-name; AGENTS 15 / Delay+ precedent | `tests/test_sand_sweep2.js` SD-1, SD-1b |
| SD-2 | S3 | Sand | gen `Param mix(50)` shadows the GenExpr `mix()` operator used throughout the same core (works today only because the Param is declared after the functions; the top-level `mix(0.15,...)` calls after it are fragile). Rename to `wetamt` in gen, build (`DIAL_SPECS` gen name, `prepend mix`), `sandDspResend`, UI outlet, audio runner `params`, tests. | test_device_static.js gen-reserved-name | SD-2 |
| SD-4 | S2 | Sand | One NaN input sample permanently poisons the wet path: Histories in filt / compand / limit / integ / differentiators become NaN forever (output `fixnan` only hides it as silence) until the device is reloaded. Input needs `fixnan`/clip sanitising before the channel() call. | Node transpile of `channel()`: NaN at sample 100, 4799/4800 later samples non-finite | SD-4 |
| SD-3 | S2 (test infra) | Sand | audio runner tested the readable source, but the device embeds `minify_gen` output (spectral lane found a minifier-only silent gen). FIXED in this commit: runner minifies (SAND_MINIFY=0 to disable). All 15 cases + new cases pass on the minified gen (Sand's minified text has no `0-N/` idiom). | scripts/run_sand_audio_tests.py | SD-3 (guard) |
| S4-a | S4 | Sand | Raising Order after it was lower leaves stale p_k/q_k differentiator state (only first use is guarded by q_k): a one-sample click when the order is increased again. | code read | - |
| S4-b | S4 | Sand | Click/drag anywhere in the v8ui (incl. the G/O meter column and the transfer-curve inset) sets Amount AND Freq (freq clamps to 18 kHz in the meter column). | ondrag code | - |
| S4-c | S4 | Sand | AGENTS "Amount 0 is unity gain on order 0" only holds at Soft 0 / Debrick 0 (compand clips at +-1.2 and tanh-compresses with Soft > 0); with Out Off peaks reach 1.2 (by design). Face transfer inset `compandEval` is an approximation of gen `compand` (display only). | audio ext_off peak 1.198 | - |

## Checked, no finding
- Host gate: typecheck, build, test_sand, test_sand_bugsweep green; face fuzz 0 failures; preview clean (Read).
- Parameters (built device): Order -1..15 Int, Stages 1..4, Amount 0..140 dB unitstyle 4, Freq 20..18000 Hz exp 2, Out enum Off/Hard/Limit, Filt, Place, Soft, Debrick, Mix; ranges/defaults/rects match AGENTS 6; devicewidth 296, openrect 169; panels last with background 1; XY drag inset in ondrag matches paint (freq 4 px, amount 3 px).
- Live smoke (VM, Live): PASS, ready after 440 ms, 10/10 parameters swept (41 sets), meters finite, screenshots default/after_sweep clean (values "18 dB", "14.0 kHz", "Off", "35.0 %", Mix "50.0 %" not truncated). Smoke does not exercise two-instance scope isolation for #0 (SD-1) directly.
- Audio (VM Max, minified gen): all 15 existing cases pass; new `ext_off` (order 15, 140 dB, 4 stages: peak 1.198 finite), `ext_lim` (0.890 = ceiling), `ext_int` (1.2), `mix50` (0.3535 equal power) pass. No latency (0), no sleep path.

## Verify
Independent check (ran tests/test_sand_sweep2.js: 3 fail on SD-1/1b/2/4 as stated, SD-3 passes as a guard).
- SD-1 KEEP: built patcher really has `#0-sandwave` in 3 boxes; AGENTS 15 says #0 is not expanded at top level, so instances share the scope. Real S2.
- SD-1b KEEP: same cause (v8ui literal fallback); fixed together with SD-1.
- SD-2 KEEP (downgrade to S4): Param `mix` shadows the mix() operator; works today only by declaration order, but the baseline asked for the rename and it is cheap.
- SD-3 KEEP: guard only, passes; the runner must test the minified gen the device embeds.
- SD-4 KEEP (downgrade to S3): channel() args match the core signature; one NaN poisons the Histories permanently and output fixnan hides it as silence. Rare in Live, but a cheap input sanitise fixes it.
- S4-a/b/c: no tests, left as nits.
No rejections; none duplicate iteration-1 items.

## Fix
| id | status | notes |
|---|---|---|
| SD-1 / SD-1b | fixed | `#0-sandwave` -> `---sandwave` in build, v8ui fallback, tests/test_sand.js |
| SD-2 | fixed | gen Param `mix` -> `wetamt` (gen, build DIAL_SPECS, `sandDspResend`, audio runner params) |
| SD-3 | fixed earlier (runner minifies) | guard passes |
| SD-4 | fixed | `fixnan(x)` at the top of `channel()` (plus sanitised inputs for the dry mix) |
| S4-a/b/c | left as nits | |

Gate: typecheck, build, test_sand, test_sand_sweep2 (all ok), test_device_static (Sand 0 violations), test_face_fuzz 0 failures, preview Read (clean). test_sand_bugsweep is a pre-existing RED-expected placeholder (unchanged). VM Max audio (DSP changed): all cases pass with unchanged numbers (ext_off 1.198, ext_lim 0.89, mix50 0.3535). VM smoke (Live): PASS, ready 418 ms, 10/10 params, screenshot Read clean. No separate Live batch needed (no LOM/routing change beyond buffer rename, covered by smoke).
Process note: one accidental host Max launch (a fallback `||` ran the audio runner locally when `vm_sand.sh` did not exist); killed within seconds, results discarded, real run was in the VM.

## Review
Stage E independent review. Diff main...HEAD reviewed: gen, build, UI, runner, tests, AGENTS.md (single exact-line edit in section 6). Fresh rebuild equals committed Sand.amxd (no diff). typecheck, test_sand, test_sand_sweep2 pass. No frozen/shared files touched (runner only imports minify_gen). Tests are non-tautological (static checks on built patcher; NaN test transpiles channel()). Remaining `mix50` audio case guards the renamed Param. Verdict: READY. Deferred shared items: none (minifier `0-1/x` idiom already reported by wave 1).
