# Sweep 2 - shaper lane (Better Shaper.amxd)

Stage A+B. Red tests: `tests/test_shaper_sweep2.js` (node).

| id | sev | finding | evidence | red test |
|---|---|---|---|---|
| SH-1 | S2 | `buffer~ #0-mseg`, `loadmess setbuffer #0-mseg`, `index~ #0-mseg` in the top-level patcher: Live does not expand `#0` there, so all Better Shaper instances share one 4096-sample table (curves overwrite each other). Use `---mseg`. | test_device_static instance-name; AGENTS 15 | SH-1 |
| SH-2 | S3 | duplicate Live short name `Rate` (obj-rate-hz, obj-rate-sync); rename the sync one (keep long name/order). | test_device_static | SH-2 |
| SH-3 | S2 | Escape via v8ui onkeydown arrives as keycode -3 / textchar 27 (Mega Modulator measurement); handleKeyCommand treats -3 as Delete before checking Esc, so Esc deletes the selected points (data loss, undoable). | probe: 5 pts -> 2 | SH-3 |
| SH-4 | S2 | Delete list contains keycodes 51 and 117, which are ASCII '3' and 'u': typing them with the editor focused deletes selected points. Only 8/127/-4 (and -3 without char 27) should delete. | probe: 5 pts -> 2 | SH-4a/b |
| SH-5 | S3 | In Live the Jitter / Smooth / Offset boxes (32-34 px) show "0.00" without the % unit while Phase (38 px) shows "0.00 %"; preview renderer hides this. | tests/out/smoke/better_shaper/default.png | SH-5 |
| S4-a | S4 | A plain click on an existing point pushes an undo entry although nothing changes (extra Cmd-Z step). | probe | - |
| S4-b | S4 | Loop-bar click always enables the loop and a double click then disables it (3 undo entries per double click). | probe | - |
| S4-c | S4 | Retrigger shows as an empty square in Live (preview draws a circled R); Retrigger enum values are "val1/val2". | smoke screenshot | - |
| S4-d | S4 | Max Console during smoke shows "codebox patchcord outlet out of range" - not from Shaper (no codebox in it); likely MCP Bridge, shared-code. | smoke screenshot | - |

## Checked, no finding
- Host gate green (typecheck, build, test_shaper, preview Read: main and multimap views clean); test_face_fuzz 0 hard failures (2 canvas-stroke warnings of 1.5px).
- Parameters match AGENTS 3 (Grid Int 1..16, Rate 0.01..40 exp 3, SyncRate 16 values default 1/4, Depth -100..100, Jitter/Smooth 0..100, Offset -100..100, per-slot Map/Mode/Pol/Amt/Min/Max); Grid/Snap presentation 0 so no v8ui overlap; `---mapOff` in p Map is instance-wide as intended.
- Undo discipline: toolbar edits, point add/move, curve drag, loop drag push exactly one entry per gesture.
- Live smoke PASS: ready 419 ms, 51/51 params swept (176 sets), meters finite.
- No audio suite exists for this device (patcher DSP only); not run.

## Verify
Stage C, independent. Ran `node tests/test_shaper_sweep2.js`: all red tests fail for the stated reason; SH-4c (Delete still deletes) passes as a guard.
- SH-1 KEEP: `#0-mseg` in buffer~/loadmess/index~ confirmed in the built patcher; AGENTS 15 says Live does not expand `#0` in a top-level device (instances share the table). Not an iteration-1 item. (AGENTS section 3 and rule 5 still say `#0-`; the fix must update them.)
- SH-2 KEEP: `Rate` short name on obj-rate-hz and obj-rate-sync; Live names parameters by short name, so the duplicate is real.
- SH-3 KEEP: Max v8ui delivers Esc as keycode -3 / char 27 (measured for Mega Modulator, AGENTS 21); `handleKeyCommand` treats -3 as Delete first. Expected value is right.
- SH-4a/4b KEEP: 51 and 117 are the ASCII codes of '3' and 'u' (the "macOS keycode" comment is unfounded given -3 for Esc shows Max reports its own codes), so typing them with focus deletes points. The patcher `key` path passes ASCII too. Fix must keep 8/127/-4. 4c is a regression guard.
- SH-5 KEEP (S3, cosmetic): the Live smoke screenshot (tests/out/smoke/better_shaper/default.png) shows Jitter/Smooth/Offset as "0.00" and Phase as "0.00 %". The width assertion is a heuristic proxy, but it matches the observed cause (32-34 px vs 38 px).
- S4-a..d: no tests, left as notes. S4-d is likely the MCP Bridge, not Shaper.
No tests rejected or deleted.

## Fix
- SH-1 fixed: `buffer~ ---mseg`, `loadmess setbuffer ---mseg`, `index~ ---mseg` (v8ui already takes the name via `setbuffer`); AGENTS section 3 line updated.
- SH-2 fixed: SyncRate short name -> `Sync Rate` (long name/order unchanged); the dial label now reads "Sync Rate".
- SH-3 fixed: Esc (keycode -3 / char 27) now clears selection before the delete branch.
- SH-4 fixed: keycodes 51/117 removed from delete; 8/127/-4 (and -3 without char 27) still delete.
- SH-5 fixed: Jitter/Smooth/Offset 38 px wide (Smooth/Offset moved to x=395, labels narrowed); Live smoke shows "0.00 %" on all.
- S4-a..d: not changed (notes only; S4-d likely MCP Bridge, shared code).
- Gate: typecheck, build, test_shaper, test_shaper_sweep2 (all PASS), preview Read, test_device_static and face_fuzz clean for Better Shaper, vm_smoke PASS (51/51 params, screenshot Read). No DSP change, no VM Max audio; smoke was the Live run.
- Nothing DEFERRED(shared).

## Review
Independent review of main...HEAD: rebuild of Better Shaper.amxd is byte-identical to the committed one; typecheck, build, test_shaper, test_shaper_sweep2 (7/7) pass; preview Read clean. No frozen/shared files touched; AGENTS.md change is one exact line in section 3. Tests assert real built-patcher state / real key handler behaviour (not tautologies). Remaining `#0-mseg` mentions in AGENTS.md are in rule 5 / illustrative examples (generic guidance, outside own section; rule 5 itself is a shared section, left alone). Verdict READY. Deferred shared: none (S4-d Max Console codebox warning likely MCP Bridge).
