# Sweep 2 - cepstra lane (Cepstra.amxd + src/cepstrum_lib.genexpr) - Stage A+B

Baseline reproduced: host gate (typecheck, build, test_cepstra, test_cepstra_bugsweep, preview), test_cepstrum_lib, test_glitch, face fuzz, static: all PASS.
VM: vm_smoke Cepstra PASS (11/11 params, no crash, screenshots read: face fine); Cepstra audio cases neutral/q0/q2/mix0/silence/qswitch/ceps gate/auto/midi PASS;
cepstrum_lib audio suite now runs in the VM (expected levels host-generated into tests/cepstrum_lib_expect.json) and PASSES.
Live check `scripts/vm_cepstra.sh` (`scripts/test_cepstra_live.js`): Lock M/S follower, AUTO/MIDI exclusivity, Quality switch recovery, Ceps/Spec gate: PASS.

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| CEP-S2-01 | S2 | Device reports no latency to Live (patcher has no `latency`) though the audio path is N+N/8 = 1152/2304/4608 samples late; PDC does not compensate, track is misaligned vs other tracks (cepstrum_lib header itself prescribes a static latency + constant pad) | Live LOM `latency_in_samples` = 0 at Quality 0/1/2; Max null tests prove 1152/2304/4608 | tests/test_cepstra_sweep2.js CEP-S2-01; scripts/test_cepstra_live.js |
| CEP-S2-02 | S2/S3 | Display `srNow` is a constant 44100, never updated (telemetry has no sample rate): while audio runs the cutoff bar/readout ms uses lag_samples/44100, wrong by sr/44100 (+8.8% at 48k, 2.2x at 96k); bar jumps away from the dragged position once signal arrives | node sandbox: 7.2 ms cutoff at 48k drawn at 7.837 ms | CEP-S2-02, 02b (fix contract: gen pokes `samplerate` to scope slot 265, face reads it) |
| CEP-S2-03 | S2 | MIDI cutoff mode unreachable in Live: audio effect has `midiin` but its DeviceIO routing defaults to "No Input" and Cepstra has no MIDI From chooser (Delay+/Envelope Trigger mirror one), so notes never arrive; Max-harness tests inject `midinote` directly and hide it | Live `midi_inputs 0` routing_type = No Input; params list has no MIDI From | CEP-S2-03 (node), scripts/test_cepstra_live.js |

Red run: `node tests/test_cepstra_sweep2.js` -> 4/4 checks fail for the stated reasons.

## S4 / log only
- CEP-S4-01 AGENTS says 67 dot columns; actual 47 ((244-8)/5). Also scope slot 264 (alive counter) and the deferred gen~ (cep_genin hub, silence until gen runs) are undocumented in section 12.
- CEP-S4-02 tests/test_cepstra.js header still says "424 x 169".
- CEP-S4-03 A NaN input latches the Ceps gate (stat[6] NaN propagates until Gate set to 0 / mode change).
- CEP-S4-04 `preview()` (called on first paint before setbuffer) mutates curMode/curGmode/curGatePct; harmless only because Live re-delivers initial parameter values.
- CEP-S4-05 Auto mode with unvoiced input: cutoff-bar drag uses the manual Res mapping (inconsistent with tracked meaning).
- CEP-S4-06 Quality switch / load mute also mutes the dry path (85 ms at load even at Mix 0); inputs > ~+44 dBFS hit the exp(12) magnitude clip.
- CEP-S4-07 Lock follower correctness depends on parameter restore order (Lock restored after Mid/Side in box order; not guaranteed).
- Shared: `scripts/run_cepstrum_lib_audio_tests.py` needed node; fixed here (host-generated JSON). cepstrum_lib itself: no defects found.

## Verify
Stage C (independent). Re-ran `node tests/test_cepstra_sweep2.js`: 4/4 red, each for the stated reason.
- KEEP CEP-S2-01 (latency): patcher has no `latency`, gen path is N+N/8 late (AGENTS s12), Live PDC would misalign. Real S2. Note: the test accepts only a static 2k/4k value; a runtime `setattr latency` fix (Multiband Split style) would not satisfy it, adjust the test then.
- KEEP CEP-S2-02 / 02b (srNow): `srNow` is assigned once (44100) and never updated; gen has no sample rate in the scope; slot 265 is free (264 = alive). Expected 7.2 ms at 48k is correct arithmetic. Real S2.
- KEEP CEP-S2-03 (MIDI routing): `midiin` present, no `midi_inputs` handling anywhere in Cepstra; Delay+/Envelope Trigger/Mega Modulator mirror the DeviceIO. Real S2 (MIDI mode unreachable in Live). Test is a string check, weak but deterministic; Live script covers the real behaviour.
- Not duplicates of iteration-1 items; no flaky tests (pure node, deterministic). No rejects.
- S4 log entries left as log-only (no tests).
