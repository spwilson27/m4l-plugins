# Oscilloscope — Bugsweep (Pass 1 findings, Pass 2 review, Pass 3 fix)

Branch: `bugsweep/oscilloscope-pass1`
Scope: Oscilloscope-specific UI/DSP/state bugs only. The shared `#0-analyzerscope` buffer-name collision is owned by analyzer-scope pass 2/3 and is **not** re-filed here.

## Pass 3 fix — Bug 1 green

Host gate green after the fix: `npm run -s typecheck && python3 scripts/build_oscilloscope.py && node tests/test_oscilloscope.js` → typecheck OK, `devices/Oscilloscope.amxd` rebuilt (460×169), `oscilloscope: 163552 checks passed` (section-7 `near(ctx.oscTrigLevel, 0.42, …)` now passes).

**Bug 1 fix (persist armed `oscTrigLevel` across getvalueof/setvalueof):**
- `src/oscilloscope_config.js` — bumped `OSC_VERSION` 4→5; `oscDefaultState()` adds `trigLevel: 0`; `oscBlob()` emits a 9th element (clamped −1..1, rounded to 1e-3); `oscFromBlob()` has a v5 branch (`length >= 9`) plus an explicit v4 backward-compat branch (`length >= 8`, `trigLevel` defaults to 0). v3/v2/v1 loaders unchanged.
- `src/oscilloscope_ui.js` — `getvalueof()` passes `trigLevel: oscTrigLevel`; `setvalueof()` restores `oscTrigLevel = saved.trigLevel`. `oscFrozen` intentionally left unpersisted.
- `scripts/build_oscilloscope.py` — `parameter_initial` seed is now `[5, …, 0.0]` (9 elems).
- `tests/test_oscilloscope.js` — section 5 asserts v5 round-trip (9 elems, `trigLevel` 0.42) and v4 back-compat (`trigLevel` defaults to 0). Section-7 RED left as-is and is now green.
- Rebuilt `devices/Oscilloscope.amxd` via the build script.

Parents for this tip: pass-2 `ac39c75`, pass-1 RED `4d65086`.

## Pass 2 review — kept 1 / dropped 0

Re-read `src/oscilloscope_ui.js` getvalueof/setvalueof (1078-1105), `src/oscilloscope_config.js` oscDefaultState/oscBlob/oscFromBlob (8-elem blob v4, no trigger slot), and the section-7 RED in `tests/test_oscilloscope.js`. Host gate: typecheck + build_oscilloscope green; `node tests/test_oscilloscope.js` fails only on `near(ctx.oscTrigLevel, 0.42, …)` (got 0, want 0.42). No production/src edits in this pass.

- **Kept Bug 1** — real user-facing serialization bug: armed `oscTrigLevel` is sticky (trig drag / dblclick clear / guide paint / trigLocked) but never round-trips through getvalueof/setvalueof, so Live save/reload silently resets it to 0. RED left as-is; still fails on unfixed code.
- **Dropped:** 0. `oscFrozen` stays intentional momentary live-display state (sand pass-1 precedent). `#0-analyzerscope` stays owned by analyzer-scope pass 2/3.

## Confirmed bugs

### 1. Trigger level is not persisted across save / reload — FIXED (pass 3)

**Severity:** User-facing state loss (armed trigger silently resets to 0 when a Live set is saved and reopened).

**Evidence (pre-fix):**
- `src/oscilloscope_ui.js` (`getvalueof`) serialized only `routingMode`, `editSub`, `chMode`, `viewMode`, `cycleMode`, `rateHz`, `gainDb`, `autoGain` via `oscBlob` — no trigger field.
- `setvalueof` never restored a trigger level.
- `src/oscilloscope_config.js` `oscDefaultState()` exposed the same 8 keys (no trigger).
- Blob v4 was fixed at 8 elements.
- Yet `oscTrigLevel` is a sticky user control: trig drag / dblclick clear / guide paint / `trigLocked`. Trig drag-end and freeze toggle call `notifyclients()`, so Live dirtied and saved a state blob that dropped the armed trigger.

**Probe** (pre-fix, vm sandbox of built `devices/Oscilloscope.amxd`):
```
oscTrigLevel = 0.42
getvalueof() → [4, 0, 0, 0, 1, 30, 0, 0]   // blobHasTrigField = false
setvalueof(blob) → oscTrigLevel === 0         // FAIL_trig_roundtrip = true
```

**Fix:** Blob v5 adds `trigLevel` as the 9th element; old v4 8-element blobs still load with `trigLevel = 0`. See Pass 3 section above for file touchpoints.

**Not filed:** `oscFrozen` is also unpersisted, but Freeze is momentary live-display state (sand pass 1 precedent: do not invent nits). Left unpersisted in pass 3.

**Test:** `tests/test_oscilloscope.js` section 7 — `"trigger level survives a getvalueof/setvalueof round-trip"` — green after the fix.

## Out of scope (owned elsewhere)

- Shared `buffer~ #0-analyzerscope` / `setbuffer #0-analyzerscope` name in a top-level device (`src/oscilloscope_ui.js:13`, `scripts/build_oscilloscope.py:62,66,67`) — already covered by analyzer-scope pass 2; fix in pass 3 of that device.
