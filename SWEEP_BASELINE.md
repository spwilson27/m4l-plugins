# Sweep 2 baseline (branch `sweep2/p0-baseline`, from main 1d7d705, 2026-10-26/27)

Nothing was fixed. Host gates ran in a copy of the worktree (`/tmp/sweep2/gates`); VM work used `~/sweep2/baseline`
(smoke: `scripts/vm_smoke.sh` over all 35 files in `devices/`; audio: each `run_<dev>_audio_tests.py` serially; Live control:
`vm_spectral.sh test`). Screenshots and reports of the smoke run: `tests/out/smoke/<slug>/` (not committed, copied to
`/tmp/sweep2/base_out/smoke_out`).

## 1. Rebuild from source
All 26 `build_*.py` (everything except dropprobe / spectral_probe) exit 0. Compared decompressed JSON/XML with build stamps
(`DP_BUILD`, `RP_BUILD`), `LastModDate` and absolute tmp paths ignored.

Committed (commit 4a134a8, the committed .amxd lacked the current theme-engine code, `m4lClamp`/`M4L_DEFAULT_TOKENS` skin code):
- `Better Sampler Reactive 2.amxd`
- `Envelope Trigger.amxd`
- `Glitch.amxd`
- `Transient Split.amxd`

Not committed (stamp / path only): Delay+ (.amxd, End, .adg), Reverb+ (.amxd, End, .adg), Freq / Harmonic / Loud / Transient Split `.adg`.
Everything else rebuilt byte-equivalent.

Finding F1: **every builder bakes its own absolute checkout path into the `.adg` presets** (`<Path Value=...>`): committed presets point
at `/Users/mrwilson/software/ableton/...` (Freq, Loud, Reverb+) or stale `/private/tmp/bugsweep/...` (Transient, Harmonic, Delay+); a rebuild from this
worktree bakes `/private/tmp/sweep2/p0-baseline/devices/...`. `Transient Split.adg` also embeds `OriginalFileSize 171376` vs the rebuilt
`.amxd` 171758 (stale). Shared-lane item (make the builders write a repo-relative / neutral path; `vm_smoke.sh` already repoints with `smoke_fix_adg.py`).

## 2. Per-device table
Host gate = typecheck + build + all `node tests/test_<dev>*.js` (incl. `*_bugsweep.js` and extra suites) + `render_preview`.
Static = `tests/test_device_static.js`. Fuzz = `tests/test_face_fuzz.js` + `tests/test_parameter_info.js` (both PASS globally; typecheck PASS).
Smoke = `vm_smoke.sh` (Live, two instances, parameter sweep, 120 s budget). Audio = real Max suite in the VM.

| Device | Host gate | Static | Fuzz | Smoke (Live) | Audio (Max) |
|---|---|---|---|---|---|
| Better Shaper | PASS | FAIL dup short name `Rate`; `#0-mseg` | PASS | PASS | n/a (no suite) |
| XO Sample Map | PASS | PASS (2 allowlisted) | PASS | PASS | not run (`vm_xo.sh max` not in scope) |
| Tiny Space | PASS | PASS | PASS | PASS | PASS |
| Sand | PASS | FAIL `#0-sandwave`; Param `mix` shadows gen operator | PASS | PASS | PASS |
| Reciprocator | PASS | PASS | PASS | PASS | PASS |
| Percipitator | PASS | FAIL `#0-percipwt`, `#0-percipscope` | PASS | PASS | PASS |
| Degrade | PASS | FAIL `#0-degscope` | PASS | PASS | **FAIL** `all_on_zero` (see F6) |
| Multiband Split | PASS | PASS | PASS | PASS | PASS |
| Cepstra (+cepstrum_lib) | PASS | PASS | PASS | PASS | Cepstra PASS; cepstrum_lib not runnable (needs node in VM) |
| Ableton MCP Bridge | PASS | PASS | PASS | PASS | n/a |
| Better Sampler | **FAIL** `test_sampler_theme.js` (F5) | FAIL 7x `#0-bs*` buffers | PASS | PASS (warn: silent output, no sample) | partial: 30 min cap hit, no failure seen (see 3) |
| Better Sampler Reactive 2 | same suite | FAIL 12x `#0-bs*` | PASS | PASS (warn: 117/219 params swept in budget) | (shares sampler suite) |
| Delay+ (.amxd / .adg) | PASS | PASS | PASS | PASS / PASS (rack) | PASS |
| Delay+ End | PASS | PASS | PASS | PASS | PASS (pair suite) |
| Envelope Trigger | PASS | FAIL dup short name `MIDI To` | PASS | PASS | PASS |
| Mega Modulator | **FAIL** `test_megamod_ui.js` (F5) | PASS (1 allowlisted) | PASS | PASS (warn 103/256 params swept) | PASS (31 cases) |
| Glitch | PASS | PASS | PASS | PASS | inconclusive: default non-sweep set did not finish in 45 min (see 3) |
| Transient Split (.amxd / .adg) | PASS | PASS | PASS | **FAIL both**: gen~ never runs (F2) | **FAIL** `mix_50`, `mix_0` (F3) |
| Loud Split | PASS | PASS | PASS | **FAIL both**: gen~ never runs (F2) | **FAIL** 5 mix checks (F3) |
| Harmonic Split | PASS | PASS | PASS | "FAIL" is a smoke-test bug (F4); device is ready | **FAIL** `mix_0`, `mix_50`, `rack_mix_*` (F3) |
| Freq Split | PASS | PASS | PASS | "FAIL" is a smoke-test bug (F4); device is ready | **FAIL** `mix_30`, `mix_0` (F3) |
| Reverb+ (.amxd / .adg) | PASS | PASS (1 allowlisted) | PASS | PASS / PASS (rack) | PASS (all, 29 min) |
| Reverb+ End | PASS | PASS | PASS | PASS | PASS |
| Analyzer | PASS | PASS | PASS | PASS | PASS |
| Oscilloscope | **FAIL** `bugsweep`: 50 ms window reports 38.4 ms at 96 kHz; 50 vs 20 ms identical at 192 kHz | PASS | PASS | PASS | PASS (needs `OSC_DRUM_DIR`, I copied `/tmp/drum_probe`) |
| Clip+ | PASS | FAIL `#0-clipscope` | PASS | PASS (warn restore drift `live_set tracks 0 devices 0#3`) | PASS (31 cases) |
| EQ+ | PASS | FAIL 3x `#0-eqplus*` buffers | PASS | PASS | not runnable: runner shells out to `node` (VM has none) |
| Theme Editor | PASS | PASS | PASS | PASS | n/a |
| Amp Stack (WIP by another session) | PASS (`test_amp_face`) | PASS | PASS | **FAIL** DSP not running, silent (F7) | partial: nano, feather PASS; `lite` fixture missing (F7) |

Control run, `vm_spectral.sh test` with a fresh Live set: Freq Split and Harmonic Split link tests pass in full (26 checks FAILED, all of them Transient Split
and Loud Split, every one a consequence of the gen~ not running: counters 0, roles 0, meter 0.000, trace "dsp-error not running").

## 3. Skipped / partial
- Glitch audio: ran the default (non-sweep) set; killed at the 45 min cap. The runner prints results only at the end, so no per-case verdict exists.
  Sweeps (`sweep`) not run, as instructed. Needs a lane run with case filters.
- Better Sampler audio: killed at the 30 min cap in the `cy_*` group; no FAIL line was printed before it. `ct*`, `cr_*`, `spf_*`, etc. not reached.
- Mega Modulator: full default set passed (16 min), long Live scripts (`vm_megamod_live_suite.sh`) not run.
- Not runnable in the VM (no `node` there; runners call `node`): `run_eqplus_audio_tests.py`, `run_cepstrum_lib_audio_tests.py`.
  Glitch needs `tests/out/glitch_layout.json` and Amp needs `tests/out/amp/*` generated on the host first (I did, then rsynced).
- Not run: XO `vm_xo.sh max` and the Live suites of every device (only the generic smoke ran), face-interaction runners
  (`run_*_face_tests.py`), Delay+/Reverb+/Multiband/Envtrig dedicated Live tests.
- The smoke sweep budget was 120 s per device, so Mega Modulator (103/256) and Reactive 2 (117/219) were only partly swept.

## 4. Findings (red or suspicious)
- **F2 Transient Split and Loud Split deferred gen~ never runs in Live** (smoke .amxd and .adg, and the `vm_spectral.sh test` control). Trace for every instance:
  `dsp-start`, `dsp-created alive 0`, two `dsp-retry` (3.5 s, 6 s), `dsp-error not running (alive 0 / 0)`. Output is silent (meter 0). Freq Split and Harmonic Split
  create from the same `src/spectral_dsp.js` and are ready in 0.16..1.0 s. Evidence: `/tmp/sweep2/base_out/spectral_ctl.log`, smoke `tests/out/smoke/{transient_split,loud_split}/`.
  The same two devices have `mix_*` audio failures (F3), so the cause is probably in their gen text (compile failure in Live; the Console in the Delay+/mbsplit shots also shows
  "gen~ failed to compile patcher", so check the Max Console in the VM).
- **F3 Mix audio cases fail in all four splitters** (`run_transplit/loudsplit/harmsplit/freqsplit_audio_tests.py`): every chain outputs the full dry at Mix 0 (energy ratio 1.000, expected 1/K),
  rack sum 6.0 dB too loud. Everything else (sums, isolation, latency, rack_*) passes. Suspect `7508337 bugsweep(loudsplit) pass 3: fix Mix dry share outside rack (roleH-gated kShare)`
  in `src/spectral_split_rack_main.genexpr` against tests that run the instances as role 0 with `outsel` set. Either the test setup or the template is wrong (shared spectral lane).
- **F4 `scripts/test_device_smoke_live.js` false FAIL**: the instance-id regex `/\[#(\d*)/` matches empty for ids like `[#i1_ednyrf @...]` (spectral traces), so
  `ids.size` stays 1 and a ready device reports "not ready". `vm_smoke.sh`'s `probe_wait` uses the right pattern. Hits Freq/Harmonic Split (.amxd and .adg).
- **F4b Smoke slug collision**: `slug_of` drops the extension, so `.amxd` and `.adg` of Delay+, Reverb+, Freq/Harmonic/Loud/Transient Split share one output directory and the `.adg` run overwrites the `.amxd` report/screenshots.
  The `.amxd` results above come from `smoke.log` RESULT lines.
- **F5 Host test failures after the rebuild**: `tests/test_sampler_theme.js:101` regex `/var FACE_PARAMS = (\{.*\});/` no longer matches (FACE_PARAMS is minified in the embedded script;
  null dereference). `tests/test_megamod_ui.js:3745` `click sets X: 0.22727 vs 0.25` (XY pad hit mapping). `tests/test_oscilloscope_bugsweep.js`: 50 ms window = 38.4 ms at 96 kHz,
  50 and 20 ms windows identical (19.2 ms) at 192 kHz (window length limited by a fixed sample count).
- **F6 Degrade audio**: `run_degrade_audio_tests.py:171` `all_on_zero at default knob values must match all_off unity peak` (all sections enabled at defaults is not transparent).
- **F7 Amp Stack**: DSP never starts in the smoke run ("DSP: not running", amp_trace null, silent), `run_amp_audio_tests.py` needs fixture `tests/out/amp/lite.genexpr` that
  `tests/amp_fixtures.js` does not produce. The Amp work in the main checkout is uncommitted/WIP by another session, so this is the committed state only.
- **F8 Static check, 12 devices** (`test_device_static.js`): `#0-` buffer/receive names in a top-level patcher (not expanded by Live, so all instances share one buffer, AGENTS 15):
  Better Sampler (7x `#0-bs*`) and Reactive 2 (12x), Better Shaper `#0-mseg`, Clip+ `#0-clipscope`, Degrade `#0-degscope`, EQ+ (3), Percipitator (2), Sand `#0-sandwave`.
  Also duplicate Live short names: Better Shaper `Rate` (obj-rate-hz / obj-rate-sync), Envelope Trigger `MIDI To`; Sand's gen Param `mix` shadows the `mix()` operator.
  Real instance-isolation bug candidates for those devices when more than one instance is in a Set.
- **F9 Suspicious in screenshots** (visual review of 58 shots): Max Console shows "gen~ failed to compile patcher" in Delay+ (default) and Multiband Split (after_sweep) runs; "inlet outlet already connected"
  in Clip+, Degrade, Freq Split, Reciprocator; Loud Split threshold fields read "-30.0 d" (unit truncated, `dB`); Transient Split Size tab reads "51" (should be 512); Amp, Loud, Transient show DSP-not-running pills.
  Many default shots are partly covered by Max patcher/Console windows (harness windows), which limits what could be judged.
- **F10 Smoke warnings**: Clip+ restore drift `live_set tracks 0 devices 0#3 0 -> 1` (one parameter not restored after the sweep); spectral racks show restore drift on linked parameters (expected while linked, noted); Better Sampler
  has silent output at default (no sample loaded, config `needsSignal false`).
- **F11 Infra**: the VM has no `node` (eqplus, cepstrum_lib audio runners, glitch layout, amp fixtures need host-generated files or a node binary); `vm_spectral.sh live` restarts Live with `pkill` + `open`
  and, after a smoke run, came up on the previous smoke set (SMK A/B tracks) so `test` found no tracks; I used `vm_live_open.sh ensure --fresh` for the control. A foreign Live-lock holder (`amp-live`) delayed the smoke start by ~15 min.
