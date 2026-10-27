# Sweep 2 — spectral lane (Transient / Loud / Harmonic / Freq Split)

Stage A+B (audit + red tests). Red tests: `tests/test_spectral_sweep2.js` (node), audio runners now test the MINIFIED gen.

| id | sev | device | finding | evidence | red test |
|---|---|---|---|---|---|
| F2 | S1 | Transient, Loud | deferred gen~ never runs in Live (dsp-created alive 0, 2x retry, "DSP failed: not running"), silent output. ROOT CAUSE (bisected in VM Max): `scripts/minify_gen.py` strips the spaces of `exp(0 - 1 / clip(..))` (src/transplit_core.genexpr:82-83, loudsplit_core.genexpr:65-66) to `exp(0-1/clip(..))`, and gen~ then compiles the whole core to a gen that outputs only zeros. Variants: comments stripped + renames off + whitespace collapsed FAILS; comments-only and indent-only PASS; only that expression tightened FAILS. Harmonic/Freq have no such expression (they pass minified). Fix options: change the source expression (e.g. `exp(-1.0 * ...)` / `exp(0.0 - 1.0 / ..)` still gets tightened, so use a form with no `0-N/` after minify) or make minify_gen keep a space after `0-` before `N/`. minify_gen.py is shared: other lanes should grep for the same idiom (only these two devices have it today). Live reconfirmed this run (smoke FAIL, pill DSP failed: not running). | `tests/test_spectral_sweep2.js` F2; ALL Transient/Loud audio cases now red because runners test the minified gen (e.g. `scripts/vm_spectral.sh audio transplit latency_1024`: out at 0, N=0) |
| F3 | S2 | all four | Mix: kShare gated on `roleH > 0.5`; role 0 is also what an in-rack instance has before election / on fb 1 / after fallback, so it outputs the FULL dry at Mix<100 % and the rack sum is up to Kx too loud; audio cases mix_0/mix_50/rack_mix_* fail | `kShare = (selH > 0.5 && roleH > 0.5)` in `src/spectral_split_rack_main.genexpr` (commit 7508337); spectral_link.js rackDesired gives role 0 to fb-1 instances and before a leader exists | `node tests/test_spectral_sweep2.js` (F3), audio `mix_*` |
| F9a | S3 | Loud | six threshold/knee numboxes are 38 px wide, "-30.0 dB" shows "-30.0 d" (extreme "-110.0 dB" needs ~54 px) | baseline screenshot + width model | `test_spectral_sweep2.js` S3-fit |
| F9b | S3 | Transient | Size tab 70 px / 4 cells: "512" shows "51" | baseline screenshot | `test_spectral_sweep2.js` S3-fit |
| T1 | S2 | all (test infra) | audio runners claimed "exactly the gen code the device embeds" but ran the unminified source; the device embeds `minify_gen` output (gendsp_json), so a minifier-only failure was invisible | spectral_common.gendsp_json | runners now minify (SS_MINIFY=0 to disable) |
| D1 | S4 | docs | AGENTS 26 Telemetry paragraph (704-sample buffer, 647 limiter) is superseded by the rack layout (648..657 scalars, 658 limiter) but left in place | config FS_SC_* | - |
| D2 | S4 | all | `r #0-sstest` is a literal shared receive: a `dsp_restart <chain>` hook message hits every spectral device in the Set | allowlist entries | - |
| F1 | note | all | .adg builds bake absolute checkout paths (shared lane item) | `git status` after build modifies the four .adg | - |
| F1b | S3 | all | committed .adg point at three different dead builder paths (/private/tmp/bugsweep/transplit, /private/tmp/bugsweep/i1/harmsplit, /Users/mrwilson/software/ableton) | `gunzip -c devices/*.adg` | `test_spectral_sweep2.js` F1 |

## Checked, no finding
- Host gates (typecheck, build, test_*, *_bugsweep, paint bounds, face fuzz, device_static) all green for the four devices; face fuzz 0 failures, no warnings for them.
- Previews (all four) clean; Live smoke screenshots for Harmonic Split and Freq Split (PASS, ready 0.2-1 s, 10/10-and-more params sweep, isolation ok) clean.
- Telemetry slots, scope sizes, latency 5120, parameter names/ranges/defaults/units of AGENTS 23-26 match the built devices (D1 aside).
- Audio (VM, minified gen): Harmonic: saw_p2, sq_p2, silence, latency_2048, sum_1024_saw, rack_sum_2048_saw pass; Freq: sum_default, iso_mid, lim_on, silence, latency_2k, rack_sum_default, rack_pending, rack_change pass. Failing: Mix cases only (F3), see above. Transient/Loud: only the unminified baseline (all pass except Mix) is known good; minified fails entirely (F2).
- Smoke: Transient Split and Loud Split FAIL (F2), Harmonic Split and Freq Split PASS (the F4 false FAIL was the baseline smoke-id regex; with default SMOKE_VM_DIR they pass).

## Notes for the fixer
- F3 audio failures are partly a test-setup artefact: `rack_mix_*` compare the follower (role 2, kShare 1/K) with a SELF reference (role 0, kShare 1). Fix the template (kShare must not depend on role; an in-rack role-0 instance before election / fb 1 / fallback must still take dry/K; decide the standalone explicit Ch n case in docs) and the SELF reference then matches.
- Runner env vars do not reach the VM (vm_spectral.sh does not forward env): `SS_MINIFY=0` only works when exported inside the VM shell.

## Verify
- F2 KEEP (S1): reproduced in VM (`vm_spectral.sh audio transplit latency_1024` on the minified gen: out 0, peak 0.0000); test is deterministic on the embedded text and passes for Harmonic/Freq.
- F9a KEEP (S3): smoke screenshot shows "-30.0 d", "-85.0 d", "-12.0 d", "-36.0 d" truncated in 38 px boxes. Caveat: the Knee boxes ("24.0 dB", 7 chars) are borderline in the width model; the threshold boxes are certain. Fixer should widen all six.
- F9b KEEP (S3): screenshot shows Transient Size tab cell reading "51".
- F3 REJECT (test deleted): the source-text check forbids roleH in kShare, but AGENTS 24 says K=1 outside a rack, and 7508337 (iteration-1 fix) deliberately gated on role for that. The in-rack role-0 case (pre-election, fb 1) outputting full dry may be real, but the right fix (e.g. an explicit in-rack flag message) is a design decision, and the audio mix_* cases (role 0 + outsel 1..3 expecting dry/K) contradict AGENTS. Needs a design call, not this test. Fixer: decide semantics and update either the runners or the template.
- F1/F1b REJECT (test deleted): lane brief says note only (shared .adg path item); build output is path-dependent so the committed-file test can never be stable. Kept as a note.
- T1 KEEP (infra change: runners now test the minified gen; SS_MINIFY=0 reaches the VM only if exported there).
