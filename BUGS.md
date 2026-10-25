# XO Sample Map — Pass 1 + Pass 2 + Pass 3 bug sweep

Branch: `bugsweep/xo-map-pass1` · Worktree: `/private/tmp/bugsweep/xo-map`
Scope: `src/xo_node_engine.js`, `src/xo_strip_ui.js`, `src/xo_search.js`, `src/xo_stretch.js`,
`scripts/build_xo_map.py`, `tests/test_xo_*.js`. One credible bug found (Pass 1); Pass 2 kept it; Pass 3 fixed it.

## Pass 3 — fixed

### Bug 1 — FIXED (undo after saved-sample recall restores all 7 playback settings)

- **Touchpoints:** `src/xo_strip_ui.js` — `captureSnapshot()` (~649) and `applySnapshot()` (~666).
  Added `reversePlayback`, `speedPct`, `grainMs`, `stretchMode` to the snapshot object and restore
  them with `!== undefined` defaults `0` / `100` / `45` / `1` (matching `recallSavedEntry`).
- Red test left unchanged: `tests/test_xo_map.js` block "Undo after recalling a saved sample restores ALL playback settings".
- **Host gate green:** `npm run -s typecheck && python3 scripts/build_xo_map.py && node tests/test_xo_map.js`
  (includes `OK: undo after recall restores all playback settings`). Rebuilt `devices/XO Sample Map.amxd`.
- Commit SHA: pending (this commit).

## Bug 1 — Undo after recalling a saved sample only restores 3 of the 7 playback settings it changed (was KEEP; fixed in Pass 3)

**Where:** `src/xo_strip_ui.js`
- `captureSnapshot()` (~line 649) / `applySnapshot()` (~line 666) save and restore:
  `activeCategory, maxLenMs, toneFilter, searchQuery, pitchSt, decayMs, gainDb,
  selectedIndex, anchorIndex, selectedSavedIndex, savedScrollOffset, savedList`.
- `recallSavedEntry()` (~line 1378) assigns **seven** playback fields from the entry:
  `pitchSt, decayMs, gainDb, reversePlayback, speedPct, grainMs, stretchMode`
  and outlets them as `recalled_settings`.
- Clicking a saved row pushes an undo snapshot immediately before recalling
  (`onclick`, ~line 2011: `pushUndoState(); recallSavedEntry(actualIdx);`),
  so the recall is explicitly meant to be undoable.

**Effect:** Undo after a recall restores pitch/decay/gain to their pre-recall values but
silently leaves **Reverse, Speed, Grain and Stretch Mode** at the recalled sample values —
an inconsistent half-reverted state. (`save_selected()` entries capture all seven fields,
so the snapshot pair is the odd one out.)

**Red test:** `tests/test_xo_map.js`, block "Undo after recalling a saved sample restores
ALL playback settings" (inserted before the final SUCCESS log). It banks an entry with
state B on all seven axes, switches to a distinct state A, pushes undo, recalls
(asserting recall applied B), undoes, then probes the restored state via `save_selected()`.

**Command / result (current code, expected exit 1):**

```
$ node tests/test_xo_map.js
AssertionError [ERR_ASSERTION]: undo after recall restores reverse
1 !== 0
    at Object.<anonymous> (/private/tmp/bugsweep/xo-map/tests/test_xo_map.js:…)
```

The pitch, decay and gain undo assertions immediately before it pass, isolating the
failure to the four fields missing from the snapshot.

**Suggested fix (Pass 3, not applied):** add `reversePlayback, speedPct, grainMs, stretchMode`
to `captureSnapshot()` and restore them in `applySnapshot()` (with the same
`!== undefined` defaulting as the other fields).

## Pass 2 review — kept 1 / dropped 0

- **Kept Bug 1:** Real functional/UI/state bug. Verified `captureSnapshot`/`applySnapshot` omit
  the four fields while `recallSavedEntry` assigns all seven and the saved-row `onclick`
  calls `pushUndoState()` before recall. Host gate (typecheck + `build_xo_map.py` +
  `node tests/test_xo_map.js`) exits 1 only on
  `AssertionError: undo after recall restores reverse (1 !== 0)`; pitch/decay/gain undo
  asserts pass. Red test left as-is (already isolates the missing snapshot fields).
- **Dropped:** none. Cleared items below still stand; no additional bugs found.

## Checked and cleared (do not re-litigate in Pass 2/3)

- **`getvalueof` / Live dials:** top-level blob serializes pitch/decay/gain (plus filters/selection/saved list
  pitch-decay-gain); Reverse / Speed / Grain / Stretch Mode are live.* parameters Live persists separately.
  Not filed as a Set-reload bug here.
- **relative_coords:** strip UI init path looks correct for the presentation box.
- **`const max` in node engine:** local Array method, not Max global shadowing.
- **Pitch Int range:** Int −24..24 is within Max Int limits (not >255 enum hazard).
- Sibling `xo-sample-map` worktree already filed the same undo bug; this pass independently
  confirmed it in this fresh `xo-map` worktree and added the red test here.
