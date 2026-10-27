# Sweep 2 lane report: delayplus (Delay+, Delay+ End, Delay+.adg)

Stage A+B (audit + red tests). VM dir `sweep2/delayplus`.

## Gates run
- Host gate (typecheck, build, `test_delayplus.js` 39/39, `test_delayplus_bugsweep.js` 4/4), previews `previews/delay.png` / `delay_end.png` read: clean (preview ignores unit text, as documented).
- `test_device_static.js` (both devices ok), `test_face_fuzz.js` (all Delay+ faces ok, 0 failures).
- VM audio suite (`vm_delayplus.sh audio`) with the MINIFIED gen text (new: runner now tests what the device embeds, `DP_MINIFY=0` for source): 26/26 PASS incl. new `extremes` case (all mod / filter / noise / diffusion controls at max, fb 1.1: finite, peak < 4).
- `vm_smoke.sh` Delay+ and Delay+ End: PASS (56/56 LOM params swept, isolation 0 changes, DSP ready 0.9-1.0 s first / 0.16 s next). Screenshots read: face intact in Live, "NO END" pill and "NO START" End look right.
- `vm_delayplus.sh run` (dedicated Live test, never run in baseline): 1 FAIL, see DP-S2-02; rest PASS (link, L == LOM sum for 3 limiter lookaheads, rack-grouped latency, `.adg` structure, audio passes).

## F9 (baseline: "gen~ failed to compile patcher" in Delay+ smoke)
Not reproduced: Max Console empty after a default + sweep smoke run, DSP ready in all 4 instances in the Live test, the minified Start/End text passes the full audio suite (checked: the minifier produces `0-ax` / `clip(x,0-jq,jq)` but not the `0-<number>/` idiom that silences the spectral gens). Likely a transient of the Console from another lane's patch or from a first-creation retry; Delay+ has NO retry for a gen~ that never joins the DSP (Reverb+ added one after the first gen~ of a Live process failed): logged as DP-S4-01.

## Findings
| id | sev | device | description | evidence | red test |
|---|---|---|---|---|---|
| DP-S2-01 | S3 | Delay+ | The face's range warning and `dpSideMs` assume 8000 ms, but the tank is 524288 samples (the gen clips at TANK-8): at 96 kHz it holds 5.46 s, at 192 kHz 2.73 s. A Sync time of 5.6 s at 96 kHz is silently shortened and no `MAX x..` pill shows. | config `DP_TIME_MAX_MS`, gen `tmax = TANK - 8` | `tests/test_delayplus_sweep2.js` (DP-S2-01, 01b) fail |
| DP-S2-02 | S2 | Delay+ + End | Start-up link calibration: on the first pair after a Set opens (reproduced 2/2 runs), 1.2 s after DSP ready End reports `K = -20032..-21632` and Start `B = 8192` (clamp max) while the live counters say Start is +21.5k ahead (diag `Start sees [21505,22016]`). `kk` is the held min over 8 windows (about 3 s) and keeps a stale window from before the counter relation settled, so for about 3 s the minimum loop time is 8192+ samples (186 ms) and short echoes are clamped. Recovers by itself (later `K 21504` calibrated). Other pairs: `K = 10240, B = 512`. | `/tmp/dp_live.log`, `/tmp/dp_live2.log` (`FAIL ... K = -21632, B = 8192`) | existing Live check `scripts/test_delayplus_live.js:134` (`scripts/vm_delayplus.sh run`), fails reproducibly on track 0 |
| DP-S4-01 | S4 | Delay+ | `src/delayplus_dsp.js` has no retry when the gen~ does not start (error "not running" after 10 s is final); Reverb+ needed a rebuild-retry for the first gen~ of a Live process. Not seen failing here. | code read | none |
| DP-S4-02 | S4 | doc | AGENTS section 15 says `492 x 169`; built Delay+ is `478 x 169` (devicewidth / openrect). | built `.amxd` | none |
| DP-S4-03 | S4 | config | `dpMinTimeSamples` / `dpEffectiveTimes` (test-only) omit `dTot`, wobble and the x4 factor of the gen's `tmin`. | gen line 612 vs config | none |
| DP-S4-04 | S4 | build | `build_delayplus.py` rewrites `.amxd` / `.adg` bytes on every build (stamp / absolute paths), leaving the committed devices dirty. Shared item F1 (.adg absolute paths) noted only. | `git status` after build | none |

Counts: S1 0, S2 1, S3 1, S4 4.
Red test files: `tests/test_delayplus_sweep2.js` (Node), Live check `scripts/test_delayplus_live.js` (existing, red). Audio runner changes: minified-gen testing, `extremes` case (green).
