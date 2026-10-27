# Sweep 2 - shared-code lane (stage A+B)

Scope: `.adg` presets, build determinism, `scripts/minify_gen.py`, `tests/paint_bounds_lib.js`, spectral `#0-sstest`. Neural Amp / Deviate untouched.

## Findings
| id | sev | device | description | evidence | red test |
|---|---|---|---|---|---|
| SH-F1 | S2 | Delay+, Reverb+, Freq/Harmonic/Loud/Transient Split `.adg` | Presets bake the builder's absolute checkout path in `<Path Value>` (`/private/tmp/sweep2/<lane>/devices/...`, earlier `/Users/...` or stale `/private/tmp/bugsweep/...`) and the build-time mtime in `<LastModDate>`. A preset opened on another machine/checkout depends on the relative path only; every rebuild from another checkout rewrites all six files. | `tests/test_adg_portable.js` 38/86 pass: 4 abs-path + 4 mtime failures for Freq, 3+3 Loud/Harmonic, 2+2 Transient, 3 for Delay+ and Reverb+ each. `OriginalFileSize` already matches the committed `.amxd` (Transient's stale size from the baseline is fixed). Fix idea: `<Path Value="">` and `<LastModDate Value="0">` for `.adg` output (`m4l_xml` in `make_delayplus_sets.py`; keep absolute paths for `.als` sets, which are generated inside the VM); `smoke_fix_adg.py` regex needs to also match an empty Path. Verify in the VM that Live resolves the relative-only reference. | tests/test_adg_portable.js |
| SH-F1b | S3 | Delay+, Reverb+ (`.amxd`, End) | Build embeds `time.strftime("%Y%m%d-%H%M%S")` as `DP_BUILD`/`RP_BUILD`, so two builds a second apart differ and the committed device always shows as modified after a rebuild. All other 24 build scripts rebuild byte-identical (checked by building all of them: only Delay+, Reverb+ and the six `.adg` differ from HEAD). | `tests/test_build_deterministic.js`: static clock scan flags build_delayplus.py and build_reverbplus.py; two Reverb+ builds 2 s apart differ in both `.amxd`. Fix idea: stamp from a hash of the sources (or `SOURCE_DATE_EPOCH`). | tests/test_build_deterministic.js |
| SH-F2 | S2 (latent) | all devices embedding minified gen | `minify_gen.py` still emits `0-1/x` for `0 - 1 / x`, which gen~ compiles to a silent gen (wave 1 spectral F2, S1 there). Current `src/*.genexpr` are clean (spectral sources were changed to `exp(-1 / ..)`), so nothing breaks today, but the next author hits the same trap. Narrow idiom: literal `0`, binary minus, number literal, `/`. Other `N-M` forms (`3.0-2.0*x`, `0-0.4*aa` in Glitch, `0-floor(..)` in Harmonic Split, `1-4*abs`) run fine in Live and must keep their current text. | `tests/test_minify_idiom.js` 34/38: 4 synthetic cases red; all 39 real cores pass the same scan. `minify_gen.py --check` passes (token-preserving). | tests/test_minify_idiom.js |
| SH-F3 | S3 (tooling) | XO minimap (all face-fuzz users) | `paint_bounds_lib.js` flags every `move_to` followed by `arc` ("arc joined to a pending path"), but `move_to(x+r, y); arc(x, y, r, 0, 2pi)` starts the arc at its own start point and draws no joining line. Mock `arc` ignores the start angle. 1 false warning in `test_face_fuzz` (obj-minimap), and any strict `checkRecording` user would fail on it. | `tests/test_paint_bounds_lib.js` 2/4: both move_to-at-arc-start cases red; the two real-join controls (far move_to, arc after line_to) already pass and must stay detected. Fix: record a1, flag only if the pending point is further than ~1e-3 from `(x+r cos a1, y+r sin a1)`. | tests/test_paint_bounds_lib.js |

## S4 (logged, no test)
- SH-S4-1 `#0-sstest` (all four spectral devices): literal `#0` in a top-level device is shared by every instance and every Set rack. The hook carries chain + kind filters (`dsp_restart <chain> <slug>`), so it works as a broadcast; two racks of the same kind in one Set would both restart chain c. Test-only; allowlisted in `device_static_allow.json`. Decision for fix stage: keep (documented), or add a `---` name with a `Global("spectral_split_hooks")` map like Glitch if multi-rack tests are wanted. `scripts/test_spectral_sum_live.js:310` is the only caller.
- SH-S4-2 AGENTS 1c says "all 28 configs" for `npm run typecheck`; there are 51 `tsconfig.*.json` (50 non-base) now.
- SH-S4-3 `scripts/ableton_mcp_server.js:371` error text hard-codes `/Users/mrwilson/software/ableton/...` (frozen bridge file).
- SH-S4-4 `test_face_fuzz` warnings owned by other lanes: Better Shaper mseg strokes 1.5 px past the canvas edge on drag at the border; EQ+ `obj-viz` fills/text up to x=518 on a 370 px canvas after `set_analyzer_shelf` (canvas guessed from the saved rect; check the fold width in EQ+ lane); Theme Editor subtitle text 85 px past a 308 px canvas.
- SH-S4-5 `test_device_static`: Better Shaper (dup short name `Rate`, `#0-mseg`) and Neural Amp (`#0-amptest`) still red; both belong to other lanes (shaper wave 4, Amp WIP).

## Checked and fine
- AGENTS 1a claims: `vm_live_open.sh` subcommands, `vm_live_lock.sh` status/queue/break/batch/selftest + env names, `*_test.als` untracked and git-ignored, smoke F4 (instance-id regex) and F4b (slug collision, `_adg` suffix) are already fixed.
- Rack chain colours in all four spectral `.adg` match `CHAIN_COLORS`; Delay+/Reverb+ `.adg` have the nested FX rack.
- Parameter sanity scan over all 34 `.amxd` (mmin < mmax, initial in range, enum length == mmax+1): no violations.
- `minify_gen.py --check`: ok (39 files). Typecheck passes.
- Not run in this stage: VM smoke on the `.adg` presets (needs the fix first: relative-only reference), VM audio (no DSP code in this lane).

## Dependent devices after the fixes (for stage D)
Minifier: rebuild everything; expect embedded gen text to change only where `0 - N /` occurs (today: none). `.adg`: rebuild Delay+, Reverb+, the four splitters. Determinism: Delay+, Reverb+ (+ their tests/previews). paint_bounds_lib: re-run every `test_*paint_bounds*.js`, `test_clipplus.js`, `test_glitch_paint_bounds.js`, `test_deviate_face*.js`, `test_face_fuzz.js`.

## Verify
Stage C: all four tests run on this branch and fail for the stated reason.
- KEEP tests/test_adg_portable.js (SH-F1): 38/86, fails on abs checkout path and build-time mtime; relative path and size checks pass. Caveat for fix stage: Live resolving a relative-only reference is unverified, check in the VM.
- KEEP tests/test_build_deterministic.js (SH-F1b): 27/31, static clock scan flags Delay+/Reverb+, two Reverb+ builds 2 s apart differ.
- KEEP tests/test_minify_idiom.js (SH-F2): 34/38, 4 synthetic `0 - N /` cases emit `0-N/`; expected form is per AGENTS/wave-1 silent-gen finding. Latent, no current device affected.
- KEEP tests/test_paint_bounds_lib.js (SH-F3): 2/4, the two move_to-at-arc-start cases red (false positive); the two real-join controls pass.
- No rejects. SH-S4 items stay logged without tests.

## Fix
| finding | result | notes |
|---|---|---|
| SH-F1 | fixed (565afc0) | `m4l_xml` writes `<Path Value="">` and `<LastModDate Value="0">` for `.adg` output (relative reference + size only); `.als` sets keep the absolute path. Six `.adg` rebuilt. `smoke_fix_adg.py` now rewrites the Path inside each `MxPatchRef` using the RelativePath basename (works for empty or absolute Path). Spectral tests that counted "relative and absolute" references now expect the relative one only. `tests/test_adg_portable.js` 86/86. Live resolving a relative-only reference outside the smoke staging is still not independently proven (the smoke loader repoints it); see smoke result below. |
| SH-F1b | fixed | `BUILD_STAMP` in Delay+/Reverb+ is now a sha1 of the device's `src/<dev>_*` files; no wall clock. `tests/test_build_deterministic.js` 31/31. Delay+/Reverb+ `.amxd` change once (stamp string only). |
| SH-F2 | fixed | `minify_gen.py` keeps the spaces of the sequence `0 +/- number /` (`exp(0 - 1 /x)`); other `N-M` forms unchanged. `--check` ok (39), `tests/test_minify_idiom.js` 38/38. Rebuilding every non-Amp/Deviate device changed no embedded gen (only the Delay+/Reverb+ stamp and the six `.adg` differ). |
| SH-F3 | fixed | `paint_bounds_lib.js` arc: a pending point within 1e-3 of the arc's own start (`a1`) is not a join; `arc_negative` passes the start angle. `tests/test_paint_bounds_lib.js` 4/4; the real-join controls still flag. |
| SH-S4-1 | kept | `#0-sstest` stays a documented test broadcast (chain + kind filtered). Not changed. |
| SH-S4-2..5 | not fixed | other lanes / frozen files / doc nit. |

Gates: typecheck ok; test_delayplus, test_reverbplus(+face), test_transplit/loudsplit/harmsplit/freqsplit, test_clipplus, test_glitch, all `*paint_bounds*`, test_face_fuzz (0 failures) green; test_device_static: only the known Better Shaper and Neural Amp violations remain. No DSP change, so no Max audio; no face/LOM change beyond the version stamp, so no full Live run.

Smoke: `scripts/vm_smoke.sh "devices/Delay+.adg"` PASS (90/90 parameters, 0 fails, 0 warns, rack Delay+ / Delay+ FX / Delay+ End loaded). The smoke loader repoints the empty Path to the VM devices dir (`smoke_fix_adg.py`), so it shows the empty-Path preset parses and loads, not Live's own relative-only resolution. The other five `.adg` were not smoked (identical generator).

## Review
- Diff main...HEAD touches only allowed shared files (minify_gen.py, paint_bounds_lib.js, make_delayplus_sets.py, smoke_fix_adg.py, build_delayplus/reverbplus, spectral tests' .adg assertions) plus six .adg and Delay+/Reverb+ .amxd (stamp only). No frozen files, no Amp/Deviate, no AGENTS.md edit.
- Rebuilt every non-Amp/Deviate device from a clean tree: `git diff devices/` empty, i.e. committed devices equal a fresh rebuild (also deterministic across runs). tests/spectral_probe and tests/out/dropprobe change on rebuild vs HEAD (stale in main, not this lane); left untouched.
- Minifier output checked by hand: `exp(0 - 1 /x)` kept, `a-1/b` and `(0-1)/x` still compact.
- Gates green: typecheck, test_adg_portable, test_build_deterministic, test_minify_idiom, test_paint_bounds_lib, delayplus, reverbplus(+face), transplit, loudsplit, harmsplit, freqsplit, clipplus, glitch, face_fuzz, minify --check.
- Nit: test_minify_idiom's "ordinary subtraction stays minified" check is a weak OR; harmless.
- Deferred: Live resolving a relative-only (empty Path) .adg outside the smoke loader unverified (only Delay+ smoked); `#0-sstest` kept as test broadcast; S4-2..5.
Verdict: READY.
