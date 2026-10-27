# Lane theme_editor: Theme Editor (Stage A+B)

Host gate: typecheck, build, test_theme_editor / _bugs / _bugsweep pass; test_device_static ok; face fuzz 0 failures (1 warning = F1).
Preview read (previews/theme_editor.png): clean. Live smoke (VM): PASS, 2 instances load, meters fine, 0 LOM parameters (state blob is hidden), Live screenshot default.png read: face renders correctly.
No AGENTS section exists for this device; none added. No audio DSP (pass-through plugin~ -> plugout~), no audio suite.
Tests use M4L_THEME_STATE_FILE tmp paths; none writes the real ~/.m4l_theme_state.json (the new test sets it too).

| id | sev | device | description | evidence | red test |
|---|---|---|---|---|---|
| TE-1 | S3 | Theme Editor | Header hover hint (preset description, drawn at x=98, 8.5 pt, unclipped) runs under the Popout/WebUI buttons (x>=204) and past the 308 px canvas ("Each plugin's original native look" ends at x~260; the longer "Deep midnight navy ..." at 393). | face fuzz warn canvas; test | tests/test_theme_editor_sweep2.js |
| TE-2 | S2 | Theme Editor (shared: src/theme_engine.js, frozen) | In Live (max.getcolor present) m4lGetThemeState re-parses the bus after every m4lRefreshTheme and forces macros to neutral while preset is Default/Ableton Live. The Hue/Sat/Cont/Brt sliders on the Default preset snap back within ~0.5 s (watcher fingerprint change -> refresh) and never affect any device. | test | tests/test_theme_editor_sweep2.js (Node, mock Global+max). Report to shared-theme lane; alternative fix: disable/grey macros on Default in the face. |
| TE-3 | S3 | Theme Editor | If all 12 ports 9888..9899 are taken, startListening gives up silently; server_status 0 is never sent, status LED stays green and Popout/WebUI point at a dead port. | test | tests/test_theme_editor_sweep2.js |
| TE-4 | S4 | Theme Editor | Unverified: Set-saved theme (setvalueof -> sync_state) may arrive before node boots; node's listen callback then emits the disk state via theme_sync and overrides the Set's state. Needs a Live load order check. | code read | - |
| TE-5 | S4 | Theme Editor | open_browser handler passes any string to `open` (execFile, no shell); POST /api/state has CORS * and no body limit, so any web page can change the theme (localhost). | code read | - |
| TE-6 | S4 | Theme Editor | loadbang + live.thisdevice both send `loadbang` to the v8ui (runs teEmitHostColors/watch twice); jweb subpatcher box id "obj-zl- rot" contains a space. | build script | - |

## Verify
- TE-1 KEEP: ran, fails as stated (hint ends x=260, past Popout at x=204); real visual overlap, expected bound correct.
- TE-2 REJECT test (deleted): engine forces neutral macros on Default deliberately ("Default" = native look, header comment); shared frozen file. Residual S4 UX note: macro sliders are inert on Default; report to shared-theme lane.
- TE-3 KEEP: ran, fails for stated reason (no server_status 0 when all ports busy); uses a random high port range and tmp state file, not flaky, no real prefs touched.
- TE-4..6 no tests, unverified S4 notes, unchanged.

## Fix
- TE-1: fixed (header hint ellipsised to 100 px, src/theme_editor_ui.js). Commit 64a4253.
- TE-3: fixed (startListening emits server_status 0 when all ports busy, src/theme_editor_node.js). Commit 64a4253.
- TE-2: rejected at verify; DEFERRED(shared) UX note only: macro sliders inert on Default preset (src/theme_engine.js frozen).
- TE-4..6: S4 notes, untouched.
Gate: typecheck, build, test_theme_editor{,_bugs,_bugsweep,_sweep2} all pass; test_face_fuzz 0 failures; test_device_static: Theme Editor ok (3 violations are other devices); preview ok; vm_smoke PASS.

## Review
Branch diff reviewed: only Theme Editor files (src/theme_editor_node.js, src/theme_editor_ui.js, device, new test, lane report, smoke outputs). No frozen/shared files, no AGENTS.md edits. Fresh rebuild of devices/Theme Editor.amxd is byte-identical (git status clean). Tests: typecheck, test_theme_editor{,_bugs,_bugsweep,_sweep2} pass. Red tests are real (hint extent bound, server_status 0 on exhausted ports, tmp state file). Nit: the hint test hardcodes 204 (Popout x) and has a dead `const z` line; harmless.
Deferred shared: TE-2 (macro sliders inert on Default preset, src/theme_engine.js frozen).
Verdict: READY.
