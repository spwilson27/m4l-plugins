# Sweep 2 - degrade lane (Degrade.amxd) - Stage A+B

Baseline reproduced: host gate (typecheck, build, test_degrade, bugsweep, preview) PASS; face fuzz 0 failures; vm_smoke PASS (21/21 params, no crash).
VM audio suite: all cases pass except `all_on_zero` (F6, see DEG-S4-01: the TEST is wrong, not the DSP).

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| DEG-S2-01 | S2 | `buffer~ #0-degscope`, `scope #0-degscope`, `setbuffer #0-degscope` in a top-level patcher: Live does not expand `#0`, all instances share one scope buffer (wrong meters/waveform, and one instance's gen makes another's DSP-ready check pass); `degDspFrames()` also hard-codes the literal name instead of the one passed via `setbuffer` | test_device_static [instance-name]; node test | tests/test_degrade_sweep2.js DEG-S2-01, DEG-S2-01b |
| DEG-S2-02 | S2 | Whenever any stage is active the wet path is `tanh(sig)`, otherwise raw `in`: engaging a near-neutral stage (Bit 16, Wrap 0.2%) at Mix 100% drops level 1.1 dB (0.65 -> 0.575 peak) and adds soft-clip; level/click step when a stage toggles on/off while dragging | Max audio: near_neutral peak 0.5747 vs 0.65 | scripts/run_degrade_sweep2_audio_tests.py near_neutral |
| DEG-S3-01 | S3 | The 6 hero `live.dial`s set no `textcolor`: in Live the name labels and values (Bits, Rate, ... 16.00, 44.1 kHz) are dark grey on the dark panel and nearly unreadable (preview renderer shows white) | Live smoke default.png crop | tests/test_degrade_sweep2.js DEG-S3-01 |

Red run: `node tests/test_degrade_sweep2.js` -> 3/3 fail for the stated reasons; the audio runner fails on DEG-S2-02 only (mix0_exact, extreme_all controls pass: no NaN, peak 0.76).

## S4 / log only
- DEG-S4-01 F6: `all_on_zero` compared a Mix 100% case to `all_off` at Mix 50% (equal power sums a transparent chain +3 dB: 0.919 vs 0.650). DSP is transparent (0.650 = input). Test fixed here to compare with the 0.65 input peak. Default Mix 50% on a transparent device is +3 dB louder (D7 deliberate).
- DEG-S4-02 F9 "inlet outlet already connected": no duplicate cord in the saved patcher (checked); likely from the scripted connects in degDspLoad on retry/Console only. Not reproduced.
- DEG-S4-03 v8ui emits `macro <stage> <norm>` on a drag inside the plot, but `obj-route-ui` outlets 2 (macro) and 3 (focus) are not wired: the drag does nothing.
- DEG-S4-04 Double-click on a pill toggles the stage (undocumented; double-click on the LED toggles twice).
- DEG-S4-05 Codec Echo delays only the wet path by up to 72 ms, dry not compensated, no latency reported (header comment says 32 ms / 16 bands; code 72 ms / 12 bands; AGENTS 16-band).
- DEG-S4-06 Rate 44100 max is not neutral on 48/96 kHz hosts (stage then gates on srate < 44000).

## Verify
- DEG-S2-01 (test_degrade_sweep2.js): KEEP. AGENTS 15/Glitch rule: `#0` is not expanded in a top-level device; boxes use `#0-degscope`; run, fails for the stated reason.
- DEG-S2-01b: KEEP. degDspFrames opens literal `#0-degscope` instead of the name passed via setbuffer; real consequence of S2-01, fails for the stated reason.
- DEG-S3-01: KEEP. The dials have no textcolor; the Live smoke screenshot (default.png) shows dim, hard-to-read dial labels on the dark panel; the test fails for that reason.
- DEG-S2-02 (run_degrade_sweep2_audio_tests.py near_neutral): KEEP. tanh(0.65)/0.65 = -1.12 dB, so any active stage soft-clips the wet and steps the level. This is user-visible and not flaky because the arithmetic is deterministic. The VM run was not repeated in Stage C.
- Fix to the red commit: the edit to run_degrade_audio_tests.py (S4-01 all_on_zero) had a column-0 `assert` inside main(), an IndentationError. That broke the existing runner and made the sweep2 audio runner fail on import, not for DEG-S2-02. Indentation repaired; both files now compile.
- REJECTED: none.
