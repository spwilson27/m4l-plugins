# Sweep 2 lane report: XO Sample Map (stage A+B: audit + red tests)

Red tests: `node tests/test_xo_sweep2.js` (7 checks, all currently FAIL for the stated reason; exit 1 while any finding is open).

## Host gate / static results (before findings)
- typecheck, `build_xo_map.py`, `test_xo_map|layout|search|stretch|bugsweep.js`: PASS. `test_face_fuzz.js`: PASS (obj-minimap 1 warning, see XO-S4-01). `test_device_static.js`: PASS (2 allowlisted `#0-xo-test*` hooks).
- Preview `previews/xo_sample_map.png` (default Live theme, 414 px) and a scratch all-sections-open Live layout (982 px): no truncation / overlap seen.
- Parameters (read from the built .amxd): 31 parameters, ranges/defaults/exponents match AGENTS 4 (Theme default is Live = 2). UI -> object -> node wiring checked for all 10 value controls, Theme, Zoom Speed, Map Samples, Searches Category, section toggles; mirrors only talk to their source through `set` (no loop).
- `stretchAudioEx` fuzz (3 modes x 5 lengths x silence/sine/impulse x 7 speed/pitch pairs): no NaN, no throw, peak <= 1, silence stays silent. 20 s stereo render: granular 0.11 s, complex 1.1 s, texture 1.6 s (synchronous on the node thread).

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| XO-S2-01 | S2 | Recalling a Saved row after a Re-Seed / Map Samples / folder change selects (and auditions) a different sample. A row keeps only the map INDEX (`sampleIndex`); `rebuildActiveMapSubset` replaces `engineState.samples`, `recallSavedSample` / v8ui `recallSavedEntry` select `samples[index]`. Name / paths in the row stay right, so the list shows "Kick 78" but plays "Kick 293". | node: save index 5, `reseedMapSubset`, recall -> selected path differs | `tests/test_xo_sweep2.js` XO-S2-01 |
| XO-S2-02 | S2 | `XOStateData` blob (getvalueof) stores a Saved row as (index, cat, pitch, decay, gain) only. After a Set save / reopen Reverse, Speed, Grain and Mode of every Saved row reset (reverse 0, 100 %, 45 ms, Cmplx), so recall and the re-pushed row render differently. AGENTS 4 says `savedList` is "not written to the Live Set" but pitch/decay/gain are. | v8ui: `saved_list_sync` with reverse 1 / 50 % / 120 ms / Textr -> getvalueof -> setvalueof | XO-S2-02 |
| XO-S2-03 | S2 | `extractAudioFeatures` reads `samples[onsetIdx + n]` for n < specWin = min(1024, max(64, activeLen)) with no length check. A decoded window < 64 samples, or an onset within specWin of the end, gives a NaN spectrum: centroid / flatness / band ratios / vector become NaN (null in the cache, 0 after the binary round trip, NaN in kNN and map). | node: 32/40/63-sample sine, onset 10 samples from the end (N = 100 and 2000) | XO-S2-03 |
| XO-S2-04 | S3 | `scripts/vm_xo.sh max` fails (reproduced twice in the VM: "obj-node (node.codebox) produced no result in 3 launches"). Node boots, drag helper compiles and arms (state file has 1 path). Cause: the harness (`XO_RUN_MAX_RUNTIME=1` branch of tests/test_xo_map.js) sends key 115 without forcing the instance selected, so `hotkeyAllowed()` is false (no LOM in standalone Max), the Saved list stays empty, only the 2 batch drags reach the node and it waits for 4 `drag_out` before writing its result. Test-harness drift since hotkey gating was added. CONFIRMED: the same harness with a `test_selected 1` message added (loadbang -> obj-minimap) passes in the VM ("all runtime checks passed", savedCountFromHotkey 1, 4 drag modes seen). | VM log + `/var/folders/.../T/xo_sample_map_exports/last_drag_helper_state.json` | XO-S2-04 (static check that the harness sends `test_selected 1`) |
| XO-S2-05 | S2 | The offline render (Edited export, and any audition with Pitch / Speed / Reverse / Texture) decodes channel 0 only (`parseAudioBuffer(..., peakChannels=false)`) and writes it to both outputs: stereo image lost; a sample with content only on the right channel renders as silence. | node: right-only sine, Reverse -> peak 0.0000 | XO-S2-05 |
| XO-S2-06 | S2 | Rendered file name = source BASENAME + settings. Two different samples with the same file name in different folders (Kick.wav) and equal settings write the same path; the second render overwrites the first while the first's cache entry / Saved row still points at it (the [E] drag of the first delivers the second's audio). | node: a/Kick.wav and b/Kick.wav -> identical output path | XO-S2-06 |
| XO-S2-07 | S2 | Folder scan with >= 4 sub-folders (`scanDirectories` and the real `startBackgroundScan`) only collects files inside the sub-folders; audio files lying directly in the added folder are never indexed. | node: root loose file + 4 sub-folders -> only the 4 sub-folder files indexed | XO-S2-07 |

## S4 / log only
- XO-S4-01 `test_face_fuzz` warning "arc joined to a pending path" is a false positive: the minimap draws dots as `move_to(x + r, y); arc(...)` (the correct way to avoid a joining line). Shared lib `tests/paint_bounds_lib.js` flags `move` before `arc`; suggest allowing a move_to at the arc start.
- XO-S4-02 AGENTS drift: Options row says Theme "enum LCD / Focus, default LCD" (actual: LCD / Focus / Live, default Live); the Theme paragraph says Focus Filters is 134 px (code: 208 in all themes); "MaxLen 50 ms..Inf" - the widget shows "5000 ms" at the top (infinite is >= 4990 internally); "Saved items ... not written to the Live Set" contradicts the blob (see XO-S2-02).
- XO-S4-03 `collectAudioFilesRecursive` uses Dirent `isDirectory()/isFile()`, so symlinked folders and files are skipped.
- XO-S4-04 `parseWavBuffer` decodes 64-bit float WAV as silence (format 3, 64 bit not handled); sample rate floored at 8000.
- XO-S4-05 Edited render: baked Gain > 0 dB hard-clips at +-1 (the preview via `dbtoa` does not); decode window is 25 s, a longer sample is silently truncated.
- XO-S4-06 `isSamplePassingFilters` / `isPointVisible` search matches the file name only (`Match folders` applies to the category terms, not the search box). Intentional per doc, noted.
- XO-S4-07 UNVERIFIED RISK (needs real Live keyboard): hotkeys come from the patcher `key` object (AGENTS: "hears every keystroke in Live") gated only on "this device is selected". If it hears keys typed into the Filters search box / Searches terms field, typing `s` saves the selected sample, `r` fires Random and Backspace deletes the selected Saved row. Not filed as a finding because it could not be checked here (no real keyboard path to a focused textedit in the VM run).

## VM runs
- `vm_xo.sh max`: FAIL (XO-S2-04; passes with `test_selected 1` added).
- `vm_smoke.sh`: PASS (11/11 sweepable parameters, 50 sets, meters stable, screenshot of default and after-sweep clean, device 414 px).
- `vm_xo.sh run` (Live, scripts/test_xo_live.js): all checks passed (layout x themes, mirrors, arrows, zoom, render modes, playhead, Esc, Re-Seed, Map Samples, dot groups).

## Verify
Independent run of `node tests/test_xo_sweep2.js`: 7/7 fail deterministically, each for the stated reason (outputs checked above against code at src/xo_node_engine.js).
- XO-S2-01 KEEP: recall selects `samples[sampleIndex]`; reseed replaces samples, so the wrong sample plays. Real, not in iter-1.
- XO-S2-02 KEEP: blob stores only index/cat/pitch/decay/gain; Reverse/Speed/Grain/Mode reset on reopen, so recall differs from what was saved. Expected value is sound.
- XO-S2-03 KEEP (low impact, S2/S3): `activeLen` is forced to >= 64 (`Math.max(64, ...)`) so `samples[onsetIdx+n]` runs past the array for tiny or late-onset files -> NaN features. Rare in practice, but a real defect.
- XO-S2-04 KEEP: static check that the harness sends `test_selected`; VM run confirmed the harness fails without it and passes with it. Fix belongs in tests/test_xo_map.js.
- XO-S2-05 KEEP: right-only stereo sample renders silent (channel 0 decoded only); user-visible in Edited export/audition.
- XO-S2-06 KEEP: output name is basename + settings only; reproduced identical path for a/Kick.wav and b/Kick.wav.
- XO-S2-07 KEEP: loose files in the added root are skipped when there are >= 4 sub-folders; reproduced.
REJECT: none.

## Fix
| finding | status | notes |
|---|---|---|
| XO-S2-01 | fixed | `recallSavedSample` resolves by sourcePath (src/xo_node_engine.js) |
| XO-S2-02 | fixed | blob v4 stores reverse/speed/grain/mode per row (src/xo_strip_ui.js); v2/v3 still load; tests + Live check updated to v4 |
| XO-S2-03 | fixed | specWin clamped to available samples, out-of-range reads 0 |
| XO-S2-04 | fixed | harness sends `test_selected 1` (tests/test_xo_map.js); `vm_xo.sh max` now passes in the VM |
| XO-S2-05 | fixed (partial) | render decodes the loudest channel, so right-only content is no longer silent; stereo image is still folded to mono (S4 remains) |
| XO-S2-06 | fixed | rendered name includes a path hash |
| XO-S2-07 | fixed | root-level files collected first in both scan paths |
S4 items: XO-S4-01 shared lib false positive (DEFERRED(shared): tests/paint_bounds_lib.js should allow move_to before arc); others untouched, XO-S4-02 AGENTS drift not rewritten.

Commits: 7606c00 (fixes) plus follow-up commit (Live test v4 + AGENTS + report).
Gate: typecheck, build, test_xo_map/layout/search/stretch/bugsweep/sweep2 (all pass), test_device_static (0 violations, 2 allowlisted), test_face_fuzz (0 failures), preview Read OK, `vm_xo.sh max` PASS, Live `vm_xo.sh live`+`test` PASS (all checks), `vm_smoke.sh` PASS (0 fails, 0 warns).
