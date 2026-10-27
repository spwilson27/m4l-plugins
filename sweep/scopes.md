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

## Not run in stage A+B (VM contention)
- `vm_smoke.sh` (Analyzer, Oscilloscope) and `vm_oscilloscope.sh audio` / `run_analyzer_audio_tests.py` were started but never got the VM:
  the Live lock holder `amp-live` (started 10:43, maxhold 600) stayed in place for 45+ min and the Max harness queue was busy. Killed.
  Still to do in stage C/D: smoke screenshots (check SC-04 gain-slider thumb, fold/reorder/freeze GUI in real Live), Oscilloscope audio suite
  (OSC_DRUM_DIR=/tmp/drum_probe), Analyzer audio suite incl. 192 kHz scope window check once the ring is enlarged.

## Verify (stage C, independent)
- KEEP SC-01 (Analyzer 50 ms window at 96/192 kHz holds 4096 not 4800/9600 samples): real, user-visible (pill says 50 ms), fails for the stated reason, 5/20 ms controls pass; not an iteration-1 item (iter-1 analyzer scope fix was cut+count<=n only).
- KEEP SC-02 (Oscilloscope 4/8 Cyc spans 3.84/7.68 periods instead of 4/8; 96 kHz 3.84): real mislabelled window from the 0.9 x 4096 cap, expected value follows the label. Fixed-ms variant is the deliberately red iteration-1 deferred test in test_oscilloscope_bugsweep.js (kept, not duplicated).
- REJECT SC-03 (ring-size assertions): prescribes the implementation (ring >= 9600) rather than behaviour; fully covered by SC-01/SC-02. Test lines deleted.
- SC-04..06 have no tests (S4, unverified; SC-04 needs Live smoke).

## Fix
- SC-01 (Analyzer 50 ms window at 96/192 kHz), SC-02 (Oscilloscope 4/8 Cyc and fixed 50 ms windows truncated), baseline F5: FIXED. Scope ring grown 4096 -> 16384 per channel
  (`AN_SCOPE_N`, `OSC_RING_N`, `scopeIx` wrap and poke bases in `analyzer_core.genexpr`: scope R 17952, FFT ring 34336, buffer `@samps 42528`
  in both builds and the audio runner / probe). Commit 4d3cd7e. Tests that fed 4096-sample signals now feed OSC_RING_N like the face does.
- SC-03: rejected in verify (implementation of the above). SC-04/05/06 (S4): not fixed (SC-04 gain thumb over "+0.0 dB" still present in preview; cosmetic, left open).
- Gate: typecheck, both builds, test_analyzer 185580, test_oscilloscope 163561, test_scopes_sweep2 9/9, test_analyzer_bugsweep 16/16,
  test_oscilloscope_bugsweep 22/22 (was 18 + 2 red), test_device_static clean for both, test_face_fuzz 0 failures, previews rendered and read.
- Max audio (VM): Analyzer run_analyzer_audio_tests all ok (tone1k, invert, intersample, lowband). Oscilloscope audio suite queued behind the VM harness; not completed at report time.
- Not run: vm_smoke / Live (Live lock held by other lanes; no face/LOM change beyond ring size, so Live run deferred). AGENTS.md section 28 updated (buffer size, ring).

## Review
- Diff reviewed (main...HEAD): ring 4096 -> 16384 consistent across core, config, both builds, tests, AGENTS 28 (exact, own section). No frozen/shared files touched.
- Found and fixed: scripts/run_oscilloscope_audio_tests.py still created the harness buffer with @samps 17952, which the enlarged gen (pokes up to 42528) would overrun. Now 42528.
- Fresh rebuild of Analyzer.amxd and Oscilloscope.amxd equals the committed files (git status clean for devices/).
- Tests: SC-01/SC-02 tests fail on old ring (derived from window lengths, not implementation constants); not tautological.
- Gates: typecheck, test_analyzer, test_oscilloscope, test_scopes_sweep2 9/9, analyzer bugsweep 16/16, oscilloscope bugsweep 22/22 all pass.
- Deferred: Oscilloscope audio suite and vm_smoke/Live run not executed (VM lock contention); SC-04/05/06 (S4) open; the pitch tracker still uses a 4096 window by design.
