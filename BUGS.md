# Analyzer (+ Oscilloscope shared tap) — Bug sweep

Worktree: `/private/tmp/bugsweep/analyzer-scope` · Branch: `bugsweep/analyzer-scope-pass1` · Base: `d72ee17`
Scope: `devices/Analyzer.amxd` — `scripts/build_analyzer.py`, `src/analyzer_ui.js`, `src/analyzer_config.js`, `src/analyzer_core.genexpr`, `src/analyzer_dsp.js`, `tests/test_analyzer.js`.
Shared in-tree concern (same tap name): `scripts/build_oscilloscope.py`, `src/oscilloscope_ui.js`, `tests/test_oscilloscope.js`.
Max / Live were NOT run in these passes (Node host gate only).

## Pass 4 review — APPROVED

Reviewed Pass 3 production/build/UI/docs + red tests against AGENTS.md precedents (Multiband Split `---mbsplitscope` / harness `#0-splitscope`; Delay+ `---dpxfer`; Glitch `---` names). Fix is minimal and correct; tests were strengthened (require `---analyzerscope`, reject literal `#0` in buffer/scope/setbuffer and `#0-` in v8ui/source), not weakened. Harness probes (`analyzer_probe.js`, `oscilloscope_probe.js`) and `run_*_audio_tests.py` remaining on `#0-analyzerscope` is intentional (mbsplit precedent). No follow-up code change.

Host gate (Pass 4 re-run, tip `0c75da7`):
```
npm run -s typecheck
python3 scripts/build_analyzer.py && node tests/test_analyzer.js
python3 scripts/build_oscilloscope.py && node tests/test_oscilloscope.js
→ green (analyzer: 185580 checks; oscilloscope: 163559 checks passed)
```

Not merged to main; worktree kept for coordinator.

## Pass 3 fix — Bug 1 closed (host gate green)

Applied the Pass 1/2 fix direction: rename the shipped scope tap from literal `#0-analyzerscope` to M4L per-instance `---analyzerscope` in Analyzer and Oscilloscope production/build/UI (and AGENTS.md §28). Harness probes and `run_*_audio_tests.py` left on `#0-analyzerscope` (mbsplit precedent).

### Touchpoints

- `scripts/build_analyzer.py` — `obj-buf` / `obj-msg-scope` / `obj-msg-setbuf` → `---analyzerscope`
- `scripts/build_oscilloscope.py` — same three boxes
- `src/analyzer_ui.js` — `anBufName = "---analyzerscope"`
- `src/oscilloscope_ui.js` — `anBufName = "---analyzerscope"`
- `src/analyzer_config.js` / `src/oscilloscope_config.js` — header comments
- `AGENTS.md` §28 / Oscilloscope architecture — document `---` name
- Rebuilt `devices/Analyzer.amxd`, `devices/Oscilloscope.amxd`

### Host gate (Pass 3)

```
npm run -s typecheck
python3 scripts/build_analyzer.py && node tests/test_analyzer.js
python3 scripts/build_oscilloscope.py && node tests/test_oscilloscope.js
→ green (analyzer: 185580 checks; oscilloscope: 163559 checks passed)
```

Pass 3 fix commit: `0c75da7` on `bugsweep/analyzer-scope-pass1` (not merged to main).

## Pass 2 review — kept 1 / dropped 0

Reviewed Pass 1 reds against source, AGENTS.md precedents (Multiband Split `---mbsplitscope`, Delay+ `---dpxfer`, Glitch `---` names), and a fresh host gate run. Bug 1 is a real multi-instance isolation failure; the Analyzer red still FAILS on unfixed code. No Pass 1 claims were dropped.

**Pass 1 miss closed here:** Oscilloscope ships the same literal `#0-analyzerscope` tap but had no device-structure red. Pass 2 adds matching `---analyzerscope` / no-`#0` asserts in `tests/test_oscilloscope.js` (still under Bug 1 — same defect class, not a new root cause).

Host gate (Analyzer) before Pass 3 fix:
```
npm run -s typecheck && python3 scripts/build_analyzer.py && node tests/test_analyzer.js
→ FAIL Analyzer.amxd: scope buffer is ---analyzerscope @samps 17952
```

Oscilloscope red (after `python3 scripts/build_oscilloscope.py`):
```
node tests/test_oscilloscope.js
→ FAIL Oscilloscope.amxd: scope buffer is ---analyzerscope @samps 17952
```
(or matching scope / setbuffer / no-literal-#0 / no-#0-in-v8ui / no-#0-in-source asserts)

## Pass 1 findings — kept 1

### Bug 1 — Scope buffer ships as literal `#0-analyzerscope` (Live does not expand `#0` in a top-level device)

**Severity:** multi-instance isolation failure. Every Analyzer (and every Oscilloscope, which shares the same tap name) in a Live Set binds the same global `buffer~` / scope ring. Instances overwrite each other's header, packet ring, stereo scope ring, and FFT ring — meters, spectrogram, and scope flash or freeze incorrectly when more than one device is loaded.

### Mechanism

- `scripts/build_analyzer.py` lines 65 / 69 / 70 shipped (pre-fix):
  - `buffer~ #0-analyzerscope @samps 17952`
  - `scope #0-analyzerscope`
  - `setbuffer #0-analyzerscope`
- `src/analyzer_ui.js` line 20 defaulted `var anBufName = "#0-analyzerscope";` (embedded into the face).
- Oscilloscope mirrored the same literals: `scripts/build_oscilloscope.py` 62 / 66 / 67 and `src/oscilloscope_ui.js` line 13.
- AGENTS.md (Multiband Split §11 buffer isolation fix; Delay+ §15; Glitch / Reverb+): in Live, `#0` is **not** expanded in a device's top-level patcher (only in abstractions). Per-instance isolation requires the M4L `---` prefix (e.g. `---mbsplitscope`, `---dpxfer`).
- Harness probes (`tests/analyzer_probe.js`, `tests/oscilloscope_probe.js`, wavload) intentionally keep `#0-analyzerscope` — same pattern as `mbsplit_probe.js` using `#0-splitscope` while the device uses `---`. Those are not the bug.

### Red tests

`tests/test_analyzer.js`, device-structure block for `Analyzer.amxd`:

- Require `obj-buf` / `obj-msg-scope` / `obj-msg-setbuf` to use `---analyzerscope` (and `@samps 17952` on the buffer).
- Reject any literal `#0` in those box texts.
- Reject `#0-` in the embedded v8ui script (stripping `//` comments), so the face default cannot stay `#0-analyzerscope`.

`tests/test_oscilloscope.js` (added in Pass 2), built-device block for `Oscilloscope.amxd`:

- Same `---analyzerscope` / no-literal-`#0` / no-`#0-` in v8ui and `oscilloscope_ui.js` source asserts.

### Fix direction (applied in Pass 3)

Rename the shipped tap to `---analyzerscope` in `build_analyzer.py` (buffer / scope / setbuffer) and `analyzer_ui.js` (`anBufName`). Mirror the same rename in Oscilloscope's build + UI. Leave harness probes on `#0-analyzerscope`. Update AGENTS.md §28 which still documents the old `#0-` name.

## Audited, no credible bug found

- **AnalyzerState blob** (`anBlob` / `anFromBlob` in `analyzer_config.js` 550 / 564; `getvalueof` / `setvalueof` in `analyzer_ui.js` ~1521+): version-1 array (mask, order, specType, scopeMode, scopeTime, trigger, f1/f2/f3) with clamp/fallback; round-trip covered by existing paint/blob checks.
- **Deferred DSP**: hub `gate 1 1`, no static `gen~`, plugin~ → plugout~ pass-through, embedded `GEN_DSP_TEXT` / `GEN_DSP_HASH` — existing structure tests cover this.
- **Presentation**: 169 px height, body panel last, Live-native `max.getcolor` over stale theme bus — existing tests.
- **Config / genexpr / paint helpers**: no additional DSP or UI defects with file:line evidence beyond the `#0` isolation bug.
