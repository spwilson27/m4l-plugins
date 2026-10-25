# Analyzer (+ Oscilloscope shared tap) — Pass 1 bug sweep

Worktree: `/private/tmp/bugsweep/analyzer-scope` · Branch: `bugsweep/analyzer-scope-pass1` · Base: `d72ee17`
Scope: `devices/Analyzer.amxd` — `scripts/build_analyzer.py`, `src/analyzer_ui.js`, `src/analyzer_config.js`, `src/analyzer_core.genexpr`, `src/analyzer_dsp.js`, `tests/test_analyzer.js`.
Shared in-tree concern (same tap name, not fixed here): `scripts/build_oscilloscope.py`, `src/oscilloscope_ui.js`.
Max / Live were NOT run in this pass (Node host gate only). Tests only — no production/src/build fixes.

## Pass 1 findings — kept 1

### Bug 1 — Scope buffer ships as literal `#0-analyzerscope` (Live does not expand `#0` in a top-level device)

**Severity:** multi-instance isolation failure. Every Analyzer (and every Oscilloscope, which shares the same tap name) in a Live Set binds the same global `buffer~` / scope ring. Instances overwrite each other's header, packet ring, stereo scope ring, and FFT ring — meters, spectrogram, and scope flash or freeze incorrectly when more than one device is loaded.

### Mechanism

- `scripts/build_analyzer.py` lines 65 / 69 / 70 ship:
  - `buffer~ #0-analyzerscope @samps 17952`
  - `scope #0-analyzerscope`
  - `setbuffer #0-analyzerscope`
- `src/analyzer_ui.js` line 20 defaults `var anBufName = "#0-analyzerscope";` (embedded into the face).
- AGENTS.md (Multiband Split §11 buffer isolation fix; Delay+ §15; Glitch / Reverb+): in Live, `#0` is **not** expanded in a device's top-level patcher (only in abstractions). Per-instance isolation requires the M4L `---` prefix (e.g. `---mbsplitscope`, `---dpxfer`).
- Oscilloscope shares the same literal name (`build_oscilloscope.py` 62 / 66 / 67, `oscilloscope_ui.js:13`), so Analyzer ↔ Oscilloscope also collide. Primary red test is Analyzer; Oscilloscope is the same defect class, noted for Pass 2 / a follow-up flip in `tests/test_oscilloscope.js` if desired.
- Harness probes (`tests/analyzer_probe.js`, `tests/oscilloscope_probe.js`, wavload) intentionally keep `#0-analyzerscope` — same pattern as `mbsplit_probe.js` using `#0-splitscope` while the device uses `---`. Those are not the bug.

### Red test

`tests/test_analyzer.js`, device-structure block for `Analyzer.amxd`:

- Require `obj-buf` / `obj-msg-scope` / `obj-msg-setbuf` to use `---analyzerscope` (and `@samps 17952` on the buffer).
- Reject any literal `#0` in those box texts.
- Reject `#0-` in the embedded v8ui script (stripping `//` comments), so the face default cannot stay `#0-analyzerscope`.

```
FAIL Analyzer.amxd: scope buffer is ---analyzerscope @samps 17952
```
(or the matching scope / setbuffer / no-literal-#0 / no-#0-in-v8ui asserts)

Command: `cd /private/tmp/bugsweep/analyzer-scope && node tests/test_analyzer.js`

### Fix direction (NOT applied in Pass 1)

Rename the shipped tap to `---analyzerscope` in `build_analyzer.py` (buffer / scope / setbuffer) and `analyzer_ui.js` (`anBufName`). Mirror the same rename in Oscilloscope's build + UI. Leave harness probes on `#0-analyzerscope`. Update AGENTS.md §28 which still documents the old `#0-` name. Flip any remaining green `#0` device asserts the same way.

## Audited, no credible bug found

- **AnalyzerState blob** (`anBlob` / `anFromBlob` in `analyzer_config.js` 550 / 564; `getvalueof` / `setvalueof` in `analyzer_ui.js` ~1521+): version-1 array (mask, order, specType, scopeMode, scopeTime, trigger, f1/f2/f3) with clamp/fallback; round-trip covered by existing paint/blob checks.
- **Deferred DSP**: hub `gate 1 1`, no static `gen~`, plugin~ → plugout~ pass-through, embedded `GEN_DSP_TEXT` / `GEN_DSP_HASH` — existing structure tests cover this.
- **Presentation**: 169 px height, body panel last, Live-native `max.getcolor` over stale theme bus — existing tests.
- **Config / genexpr / paint helpers**: no additional DSP or UI defects with file:line evidence beyond the `#0` isolation bug.
