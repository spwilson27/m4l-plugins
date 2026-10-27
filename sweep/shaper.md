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
