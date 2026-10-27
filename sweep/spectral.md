# Sweep 2 — spectral lane (Transient / Loud / Harmonic / Freq Split)

Stage A+B (audit + red tests). Red tests: `tests/test_spectral_sweep2.js` (node), audio runners now test the MINIFIED gen.

| id | sev | device | finding | evidence | red test |
|---|---|---|---|---|---|
| F2 | S1 | Transient, Loud | deferred gen~ never runs in Live (dsp-created alive 0, 2x retry, "DSP failed: not running"), silent output | baseline smoke + control run | see below |
| F3 | S2 | all four | Mix: kShare gated on `roleH > 0.5`; role 0 is also what an in-rack instance has before election / on fb 1 / after fallback, so it outputs the FULL dry at Mix<100 % and the rack sum is up to Kx too loud; audio cases mix_0/mix_50/rack_mix_* fail | `kShare = (selH > 0.5 && roleH > 0.5)` in `src/spectral_split_rack_main.genexpr` (commit 7508337); spectral_link.js rackDesired gives role 0 to fb-1 instances and before a leader exists | `node tests/test_spectral_sweep2.js` (F3), audio `mix_*` |
| F9a | S3 | Loud | six threshold/knee numboxes are 38 px wide, "-30.0 dB" shows "-30.0 d" (extreme "-110.0 dB" needs ~54 px) | baseline screenshot + width model | `test_spectral_sweep2.js` S3-fit |
| F9b | S3 | Transient | Size tab 70 px / 4 cells: "512" shows "51" | baseline screenshot | `test_spectral_sweep2.js` S3-fit |
| T1 | S2 | all (test infra) | audio runners claimed "exactly the gen code the device embeds" but ran the unminified source; the device embeds `minify_gen` output (gendsp_json), so a minifier-only failure was invisible | spectral_common.gendsp_json | runners now minify (SS_MINIFY=0 to disable) |
| D1 | S4 | docs | AGENTS 26 Telemetry paragraph (704-sample buffer, 647 limiter) is superseded by the rack layout (648..657 scalars, 658 limiter) but left in place | config FS_SC_* | - |
| D2 | S4 | all | `r #0-sstest` is a literal shared receive: a `dsp_restart <chain>` hook message hits every spectral device in the Set | allowlist entries | - |
| F1 | note | all | .adg builds bake absolute checkout paths (shared lane item) | `git status` after build modifies the four .adg | - |
