# Oscilloscope — Bugsweep (Pass 1 findings, Pass 2 review)

Branch: `bugsweep/oscilloscope-pass1`
Scope: Oscilloscope-specific UI/DSP/state bugs only. The shared `#0-analyzerscope` buffer-name collision is owned by analyzer-scope pass 2/3 and is **not** re-filed here.

## Pass 2 review — kept 1 / dropped 0

Re-read `src/oscilloscope_ui.js` getvalueof/setvalueof (1078-1105), `src/oscilloscope_config.js` oscDefaultState/oscBlob/oscFromBlob (8-elem blob v4, no trigger slot), and the section-7 RED in `tests/test_oscilloscope.js`. Host gate: typecheck + build_oscilloscope green; `node tests/test_oscilloscope.js` fails only on `near(ctx.oscTrigLevel, 0.42, …)` (got 0, want 0.42). No production/src edits in this pass.

- **Kept Bug 1** — real user-facing serialization bug: armed `oscTrigLevel` is sticky (trig drag / dblclick clear / guide paint / trigLocked) but never round-trips through getvalueof/setvalueof, so Live save/reload silently resets it to 0. RED left as-is; still fails on unfixed code.
- **Dropped:** 0. `oscFrozen` stays intentional momentary live-display state (sand pass-1 precedent). `#0-analyzerscope` stays owned by analyzer-scope pass 2/3.

## Confirmed bugs

### 1. Trigger level is not persisted across save / reload

**Severity:** User-facing state loss (armed trigger silently resets to 0 when a Live set is saved and reopened).

**Evidence:**
- `src/oscilloscope_ui.js:1078-1088` (`getvalueof`) serializes only `routingMode`, `editSub`, `chMode`, `viewMode`, `cycleMode`, `rateHz`, `gainDb`, `autoGain` via `oscBlob` — no trigger field.
- `src/oscilloscope_ui.js:1091-1105` (`setvalueof`) never restores a trigger level.
- `src/oscilloscope_config.js` `oscDefaultState()` exposes the same 8 keys (no trigger).
- Blob v4 is fixed at 8 elements (see existing blob / `parameter_initial` asserts in `tests/test_oscilloscope.js`).
- Yet `oscTrigLevel` is a sticky user control: `onclick` / `ondrag` (`kind: "trig"`) set it, `ondblclick` clears it, `oscGuideOn` / `oscGuideY` paint a persistent guide line, and `oscComputeFrame` feeds it into `trigLocked`. Trig drag-end and freeze toggle call `notifyclients()`, so Live dirties and saves a state blob that drops the armed trigger.

**Probe** (vm sandbox of built `devices/Oscilloscope.amxd`):
```
oscTrigLevel = 0.42
getvalueof() → [4, 0, 0, 0, 1, 30, 0, 0]   // blobHasTrigField = false
setvalueof(blob) → oscTrigLevel === 0         // FAIL_trig_roundtrip = true
```

**Why it should persist:** Every other face control round-trips through `getvalueof` / `setvalueof`. The parent Analyzer face persists `trigger` in its state blob, so Oscilloscope dropping it is a regression, not a design choice.

**Not filed:** `oscFrozen` is also unpersisted, but Freeze is momentary live-display state (sand pass 1 precedent: do not invent nits).

**RED test:** `tests/test_oscilloscope.js` section 7 — `"trigger level survives a getvalueof/setvalueof round-trip"`.

## Out of scope (owned elsewhere)

- Shared `buffer~ #0-analyzerscope` / `setbuffer #0-analyzerscope` name in a top-level device (`src/oscilloscope_ui.js:13`, `scripts/build_oscilloscope.py:62,66,67`) — already covered by analyzer-scope pass 2; fix in pass 3.
