# Analyzer (+ Oscilloscope shared tap) — Bug sweep

Worktree: `/private/tmp/bugsweep/analyzer-scope` · Branch: `bugsweep/analyzer-scope-pass1` · Base: `d72ee17`
Scope: `devices/Analyzer.amxd` — `scripts/build_analyzer.py`, `src/analyzer_ui.js`, `src/analyzer_config.js`, `src/analyzer_core.genexpr`, `src/analyzer_dsp.js`, `tests/test_analyzer.js`.
Shared in-tree concern (same tap name): `scripts/build_oscilloscope.py`, `src/oscilloscope_ui.js`, `tests/test_oscilloscope.js`.
Max / Live were NOT run in these passes (Node host gate only). Tests only — no production/src/build fixes.

## Pass 2 review — kept 1 / dropped 0

Reviewed Pass 1 reds against source, AGENTS.md precedents (Multiband Split `---mbsplitscope`, Delay+ `---dpxfer`, Glitch `---` names), and a fresh host gate run. Bug 1 is a real multi-instance isolation failure; the Analyzer red still FAILS on unfixed code. No Pass 1 claims were dropped.

**Pass 1 miss closed here:** Oscilloscope ships the same literal `#0-analyzerscope` tap but had no device-structure red. Pass 2 adds matching `---analyzerscope` / no-`#0` asserts in `tests/test_oscilloscope.js` (still under Bug 1 — same defect class, not a new root cause).

Host gate (Analyzer):
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

- `scripts/build_analyzer.py` lines 65 / 69 / 70 ship:
  - `buffer~ #0-analyzerscope @samps 17952`
  - `scope #0-analyzerscope`
  - `setbuffer #0-analyzerscope`
- `src/analyzer_ui.js` line 20 defaults `var anBufName = "#0-analyzerscope";` (embedded into the face).
- Oscilloscope mirrors the same literals: `scripts/build_oscilloscope.py` 62 / 66 / 67 and `src/oscilloscope_ui.js` line 13.
- AGENTS.md (Multiband Split §11 buffer isolation fix; Delay+ §15; Glitch / Reverb+): in Live, `#0` is **not** expanded in a device's top-level patcher (only in abstractions). Per-instance isolation requires the M4L `---` prefix (e.g. `---mbsplitscope`, `---dpxfer`).
- Harness probes (`tests/analyzer_probe.js`, `tests/oscilloscope_probe.js`, wavload) intentionally keep `#0-analyzerscope` — same pattern as `mbsplit_probe.js` using `#0-splitscope` while the device uses `---`. Those are not the bug.

### Red tests

`tests/test_analyzer.js`, device-structure block for `Analyzer.amxd`:

- Require `obj-buf` / `obj-msg-scope` / `obj-msg-setbuf` to use `---analyzerscope` (and `@samps 17952` on the buffer).
- Reject any literal `#0` in those box texts.
- Reject `#0-` in the embedded v8ui script (stripping `//` comments), so the face default cannot stay `#0-analyzerscope`.

`tests/test_oscilloscope.js` (added in Pass 2), built-device block for `Oscilloscope.amxd`:

- Same `---analyzerscope` / no-literal-`#0` / no-`#0-` in v8ui and `oscilloscope_ui.js` source asserts.

### Fix direction (NOT applied in Pass 1 or Pass 2)

Rename the shipped tap to `---analyzerscope` in `build_analyzer.py` (buffer / scope / setbuffer) and `analyzer_ui.js` (`anBufName`). Mirror the same rename in Oscilloscope's build + UI. Leave harness probes on `#0-analyzerscope`. Update AGENTS.md §28 which still documents the old `#0-` name.

## Audited, no credible bug found

- **AnalyzerState blob** (`anBlob` / `anFromBlob` in `analyzer_config.js` 550 / 564; `getvalueof` / `setvalueof` in `analyzer_ui.js` ~1521+): version-1 array (mask, order, specType, scopeMode, scopeTime, trigger, f1/f2/f3) with clamp/fallback; round-trip covered by existing paint/blob checks.
- **Deferred DSP**: hub `gate 1 1`, no static `gen~`, plugin~ → plugout~ pass-through, embedded `GEN_DSP_TEXT` / `GEN_DSP_HASH` — existing structure tests cover this.
- **Presentation**: 169 px height, body panel last, Live-native `max.getcolor` over stale theme bus — existing tests.
- **Config / genexpr / paint helpers**: no additional DSP or UI defects with file:line evidence beyond the `#0` isolation bug.
