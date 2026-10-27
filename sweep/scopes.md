# Scopes (Analyzer + Oscilloscope) sweep2 lane report (stage A+B)

Host gate: typecheck, build_analyzer, test_analyzer (185580), build_oscilloscope, test_oscilloscope (163561) pass.
test_analyzer_bugsweep 16/16 pass; test_oscilloscope_bugsweep 18 pass / 2 red (baseline F5, same root cause as SC-01..03).
test_device_static: both devices clean. test_face_fuzz: both faces ok (0 failures).
Previews read (Analyzer default + all four panels via AN_PREVIEW=15 scratch build, Oscilloscope default). State-blob garbage fuzz
(anFromBlob/oscFromBlob, 10 malformed inputs): always sane clamped state, no NaN.
Doc check: anFoldWidth (28/392/1134), AN_SCOPE_MS [5,20,50], OSC_FIXED_MS, gain range -18..+24, BUF 17952 all match AGENTS 28.

## Findings
| id | sev | device | description | evidence | red test |
|---|---|---|---|---|---|
| SC-01 | S2 | Analyzer | 50 ms scope window is truncated by the fixed 4096-sample ring (AN_SCOPE_N, `scopeIx` wraps at 4096 in analyzer_core.genexpr): 4096 samples (42.7 ms) at 96 kHz, 4096 (21 ms) at 192 kHz, so 20 ms and 50 ms look alike at 192 kHz while the pill says 50 ms. | tests/test_scopes_sweep2.js | tests/test_scopes_sweep2.js (SC-01) |
| SC-02 | S2 | Oscilloscope | Multi-cycle windows are silently shortened to 0.9 x ring (3686 samples) but still labelled 4/8 Cyc: 8 Cyc at 100 Hz/48 kHz spans 7.68 periods; 4 Cyc at 50 Hz 3.84; 8 Cyc at 100 Hz/96 kHz only 3.84. Fixed 50 ms at 96/192 kHz same (baseline F5). | oscComputeFrame spanSamples | tests/test_scopes_sweep2.js (SC-02), tests/test_oscilloscope_bugsweep.js |
| SC-03 | S2 (root cause) | both (src/analyzer_core.genexpr, shared config) | Ring size 4096 must grow (>= 9600/0.9 ~ 10.7k -> 16384) in analyzer_core, AN_SCOPE_N, OSC_RING_N, buffer layout and `@samps`, all together (lane owns core). | | tests/test_scopes_sweep2.js (SC-03) |
| SC-04 | S4 | Oscilloscope | Preview: Gain Scale slider thumb is drawn over the "+0.0 dB" text. Check in Live smoke. | previews/oscilloscope.png | none |
| SC-05 | S4 | Analyzer | Preview all-panels: "+1" axis label touches the "Oscilloscope" title. | AN_PREVIEW=15 render | none |
| SC-06 | S4 | docs | AGENTS 28 Oscilloscope subsection ends with an "EQ+ face clicks" paragraph that belongs to EQ+; Oscilloscope has no vm_ audio wrapper entry in section 1 gate (needs OSC_DRUM_DIR). | AGENTS.md | none |
