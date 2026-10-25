# Reciprocator - Bug Sweep Pass 1

Branch: bugsweep/reciprocator-pass1
Worktree: /tmp/bugsweep/reciprocator
Scope: red tests only, no fixes. New tests are in tests/test_reciprocator.js (UI section of verifyAmxd, and the new section 9 block). Baseline before the new tests: node tests/test_reciprocator.js printed test_reciprocator: ok.

## Bug 1: Scope drag cannot set Gate below -66 dB; clicking the drawn -72 line jumps to -66

- Where: src/reciprocator_ui.js, visual01ToDb bisects only over -66..0 dB, while Gate spans -72..-6 dB (PARAM_SPECS in scripts/build_reciprocator.py; gen clips gate to -72..-6).
- Evidence: round trip through the draw/drag curve pair, evaluated with ampToVisual01 and visual01ToDb copied verbatim: -72 dB drag-yields -66.00 dB, -70 drag-yields -66.00, -66 exact, -60 / -42 / -12 exact. The dB component of ampToVisual01 bottoms out at -66 dB, and the bisection in visual01ToDb never searches below -66.
- Impact: Gate values from -72 to about -66.5 are unreachable by dragging, and a click on the drawn gate line silently rewrites them to -66. The comment on visual01ToDb states the invariant that a click on a line keeps the value; the pre-existing test enforces it only at -42 and -12.
- Red test: in verifyAmxd, after set_gate(-72) and set_gate(-70), clicking the drawn gate line must keep the value within 0.6 dB.

## Bug 2: Lookahead cannot deliver the documented 10 ms above 96 kHz

- Where: src/reciprocator_core.genexpr: Delay lookL(1024) and lookR(1024); lookSampsH = clip(lookMs * 0.001 * sr, 0, 960).
- Evidence: at 192 kHz, a sample rate Live supports, the clip caps lookahead at 960 samples = 5.00 ms and the Delay size caps it at 1024 samples = 5.33 ms, against the documented 0..10 ms range (AGENTS.md section 7, the Lookahead help text, and the gen clip of lookahead to 0..10).
- Red test: section 9 parses the Delay size and the clip bound from the gen source and asserts both hold at least 1920 samples (10 ms at 192 kHz). This is the assertion that fires in the red run below.

## Bug 3: Detect 0 percent is not dual-mono; the channels stay 35 percent stereo-linked

- Where: src/reciprocator_core.genexpr: linkAmt = 0.35 + 0.65 * detNow, with envL and envR mixed toward linkedEnv = max(detL, detR).
- Evidence: at Detect 0, linkAmt is 0.35, so the envelope of the quieter channel is pulled 35 percent toward the louder channel. The Detect help text in scripts/build_reciprocator.py describes 0 percent as dual-mono Peak and 100 percent as stereo-linked RMS.
- Red test: section 9 parses the linkAmt formula and asserts a base of 0 and a base-plus-slope of 1.

## Bug 4: The gen fades the noise gate out with Amount; the shared mirror and the docs apply it at every Amount

- Where: src/reciprocator_core.genexpr lines 275-277: gateMix = (revMode > 0.5) ? 1.0 : clip(amtNow * 4.0, 0, 1); effGateL and effGateR = mix(1.0, gate, gateMix). At Amount 0 the gate is fully bypassed in normal mode, and below 25 percent it is only partially applied.
- Evidence: src/reciprocator_config.js is headed Shared Reciprocator DSP math, and its computeRecipGain applies the gate at every amount: computeRecipGain(0.002, 0.0, -42, -1, 0) returns 0, a below-Gate signal muted even at Amount 0. The Gate parameter help says signals below Gate smoothly mute with no Amount condition, and AGENTS.md section 7 describes the gate with no Amount dependence. The UI demo history is drawn from the mirror, so at low Amount the face and the DSP disagree as well. The audio gate_mute case runs at Amount 1.0, where gateMix is 1, so it cannot see this divergence.
- Red test: section 9 asserts the gen contains no gateMix Amount scaling of the gate, and pins the mirror contract at Amount 0.

## Red run

Command: node tests/test_reciprocator.js (in the worktree)
Result: exit 1. The suite stops at the first failing assertion, which is Bug 2:

AssertionError [ERR_ASSERTION]: lookahead Delay holds 1024 samples, less than 10 ms at 192 kHz (1920) at tests/test_reciprocator.js:394

The Bug 1, 3 and 4 assertions live in the same run and are reached once the earlier ones pass; each is backed by the direct evidence above (curve round trip for Bug 1, formula values for Bug 3, mirror evaluation plus gen lines 275-277 for Bug 4).

## Checked and cleared

- PARAM_SPECS ranges and defaults against AGENTS.md section 7 and the gen clips and Param defaults: all match (amount, gate, attack, release, mix, ceiling, lookahead, detect, schp, sclp, outmode, revgate).
- Mirror against gen for the gate cubic, reciprocal targetScale, safeEnv floors, the 1000x gain cap, and the soft, hard and limiter ceiling formulas: match. The one textual difference, the reverse floor guard in the mirror lacking the gen max(..., 0.00005) floor, cannot trigger inside the -72..-6 dB Gate range.
- Build wiring: percent scaling objects, prepend chains into the gen hub, drag routing with prepend set back into the dials, scope buffer 32 samples against SCOPE_FLOATS 32, GEN_DSP_TEXT and GEN_DSP_HASH embedding, panels last with background 1: all consistent, and largely covered by the pre-existing suite.
- Known rough edge from AGENTS.md, Soft Clip is a real tanh after the nested-return fix: verified in limit_out and covered by the pre-existing nested-return test and the audiorate audio case.
- UI setters, scope slot indices 0..7 against the gen telemetry header, the HUD gain text conversion, and the deferred DSP re-bang list (all 11 non-toggle parameters, Reverse Gate sent by value): consistent.
