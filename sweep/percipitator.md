# Sweep 2 - percipitator lane - Stage A+B

Baseline: typecheck, build, test_percipitator, bugsweep, face fuzz (0 failures), preview OK. vm_smoke PASS (14/14 params, no crash); screenshots show a correct face in Live.
Audio suite not re-run (no DSP change; no findings in gen code reading: neutral Mix 0 = dry, silence sleep/freeze logic consistent).

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| PCP-S2-01 | S2 | `buffer~ #0-percipwt` / `#0-percipscope` (+ setbuffer/wt/scope messages) shared by all instances in Live (# 0 not expanded in top-level device): wavetable, band telemetry and gate/scope readings collide | test_device_static FAIL (2 violations); AGENTS 15 | tests/test_percipitator_sweep2.js |
| PCP-S2-02 | S2 | Sidechain MIDI chord strip unreachable in Live: midiin present, but audio-effect MIDI input routing defaults to "No Input" and nothing sets `midi_inputs 0` (same as CEP-S2-03) | no midi_inputs in src; Cepstra fix is the pattern | same file |

## S4 / log only
- PCP-S4-01 Gen `freeze` Param has no Live parameter/face control (feature unreachable; face resend sends freeze 0). Doc lists audio cases only.
- PCP-S4-02 Gate drag clamps -60..-6 but gen/blob accept -66..-6; Gate is only in the blob (not automatable).
- PCP-S4-03 `midi_clear` is never wired: held-note state can stick (no CC123/transport handling); latched chord overwrites the user's scale mask and is not saved until next click (no notifyclients in midi_in).
- PCP-S4-04 A NaN input latches band SVF state (clip(NaN) stays NaN) until reload; output is fixnan'd so just silent wet.

## Verify
- PCP-S2-01 KEEP: real S2 (#0 not expanded in top-level device, AGENTS 15/Glitch/Mega notes); test run fails because build still has #0-percip names.
- PCP-S2-02 KEEP: real S2 (audio-effect midi_inputs defaults to "No Input", measured for Mega Modulator/Cepstra); test run fails because no midi_inputs routing in src. Test is a static grep, acceptable as a red marker.
- S4 items: log only, no tests.
