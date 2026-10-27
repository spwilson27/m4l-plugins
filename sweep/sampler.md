# Lane sampler: Better Sampler, Better Sampler Reactive 2 (Stage A+B)

Host gate: typecheck, build, test_sampler / slicing / pitch / designs / reactive2 / modmatrix / bugsweep pass.
Face fuzz: 58 faces, 0 failures. Live smoke (Better Sampler): PASS, 91/91 parameters, two instances ready, no crash.
Audio cases run (VM, filtered): idle_silent, repitch_chord, cycles_formant, textures_cloud, slice_trig, forward_oneshot: no NaN, peak < 1.

| id | sev | device | description | evidence | red test |
|---|---|---|---|---|---|
| S-1 | S2 | both | Per-instance buffers/receive use literal `#0-bs*` in a top-level patcher (7 in Better Sampler, 19 in Reactive 2 incl. bsamp2/bsmod/bsmseg/bsslot/bsmpe/wt). Live does not expand `#0` there (AGENTS 15), so two instances in a Set share sample, voice slots, telemetry, pitch curve, wavetables; `receive #0-bsdebug` hits all. v8ui scripts also hard-code `"#0-bsmpe"`, `"#0-bsamp2"`, `"#0-bswt1/2"`, `"#0-bsmod"`, `"#0-bsmseg"`, `"#0-bsslot"` (script strings are never expanded; names must come from the patcher). | test_device_static.js F8; tests/test_sampler_sweep2.js (34 failures). Smoke isolation check cannot see it (no sample loaded). | tests/test_sampler_sweep2.js |
| S-2 | S4 | test | tests/test_sampler_theme.js:101 FACE_PARAMS regex/JSON.parse fails (minified, unquoted keys) so the theme test aborts before its checks. Test bug, not product. | node tests/test_sampler_theme.js TypeError | existing |
| S-3 | S4 | Reactive 2 | AGENTS section 14 drift: reactive2 default width 678 / max 1306 with 5 sections; spec is 758 / 1545 with Mod Sources + Mod Matrix. | scripts/sampler_designs/reactive2.json | - |
| S-4 | S3? | Reactive 2 | Preview only: Mod Sources A/D/S/R values "60.00 ms900 ms" touch, "TimeSlopeValue" tabs crammed, "Detune" label under bar. Preview renderer is approximate; Live smoke of Reactive 2 not yet read (lock queue). | previews/better_sampler_reactive_2.png | pending Live check |

Open: Reactive 2 smoke and remaining audio groups (queued behind other lanes' Live lock holds at time of writing).
