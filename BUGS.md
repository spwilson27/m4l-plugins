# BUGS.md — Better Shaper PASS 1

Branch: `bugsweep/shaper-pass1`
Worktree: `/private/tmp/bugsweep/shaper`
Rule: PASS 1 finds bugs and adds RED tests only — do not fix production code here.

## Confirmed bugs

### 1. Multi-select vertical drag deletes unselected points between the selection

- **Where**: `src/mseg_edit.js:83-89` (`msegMoveSelection`)
- **What**: After pushing per-point travel intervals, when `sweepIntervals.length >= 2` the code also pushes the bounding union `[minSpan, maxSpan]` of *all* intervals. Selecting two or more interior points always hits that branch (each interior still pushes two near-degenerate intervals even when `dx === 0`), so a pure vertical group move deletes every unselected point whose `x` lies between the leftmost and rightmost selected `x`.
- **Why it is wrong**: Contradicts the comment at `src/mseg_edit.js:41` (“An unselected point whose x lies on a selected point's travel is removed”). A pure vertical move has no horizontal travel, so intervening points must survive.
- **Repro (Node)**: five points at x=`0,0.25,0.5,0.75,1`; select ids `[2,4]`; call `msegMoveSelection(..., primaryId=2, targetX=0.25, targetY=0.55, ...)`. Point id `3` at x=`0.5` is removed; result ids `1,2,4,5`.
- **RED test**: `tests/test_shaper_bugsweep.js` (run: `node tests/test_shaper_bugsweep.js`; expected FAIL on current code). Verified RED on this branch (AssertionError: middle point 3 deleted).

## Notes

- No other credible bugs locked in this pass yet; further review may add entries and RED cases.
- Host gate (`npm run -s typecheck && python3 scripts/build_shaper.py && node tests/test_shaper.js`) does not run `tests/test_shaper_bugsweep.js`; run that file separately to see the RED failure.

## PASS 2 review

- **Kept 1 / Dropped 0.** Bug 1 confirmed real UI bug, not intentional sweep: L41 comment limits deletes to an unselected point on a selected point's travel; on `dx === 0` interiors still push near-degenerate intervals and L83-89 unions the whole selection span, so intervening points die. RED re-verified FAIL on unfixed code (`node tests/test_shaper_bugsweep.js` → AssertionError, ids `1,2,4,5`).
- Host gate green on unfixed code: `npm run -s typecheck && python3 scripts/build_shaper.py && node tests/test_shaper.js` (GATE_EXIT:0). Bugsweep remains RED (BUGSWEEP_EXIT:1).
- No strengthen needed; no additional bugs found in `src/mseg_edit.js` (104 lines; file ends at `msegMoveSelection`). Production/src untouched (pass 3).
