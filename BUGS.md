# Reciprocator - Bug Sweep

Branch: bugsweep/reciprocator-pass1
Worktree: /private/tmp/bugsweep/reciprocator
Scope: red tests only, no production fixes (pass 3). New tests are in tests/test_reciprocator.js (UI section of verifyAmxd, and section 9).

## Pass 2 review (kept 4 / dropped 0)

All four pass-1 claims are real functional / docs / mirror mismatches. No drops. Strengthened reachability by calling verifyAmxd before section 9 so Bug 1 fails first (section 9 previously short-circuited the suite).

| Bug | Verdict | Why |
| --- | --- | --- |
| 1 Gate drag below -66 | KEEP | `ampToVisual01` / `visual01ToDb` use a -66..0 map; Gate is -72..-6. Click on drawn -72/-70 line jumps to -66. Violates AGENTS.md "click on a line keeps that dB". |
| 2 Lookahead at 192 kHz | KEEP | `Delay lookL/R(1024)` and `lookSampsH` clip 960 cannot hold 10 ms at 192 kHz (1920). Docs/PARAM_SPECS/gen clip promise 0..10 ms with no SR caveat. |
| 3 Detect 0% not dual-mono | KEEP | `linkAmt = 0.35 + 0.65 * detNow` leaves 35% stereo link at Detect 0. Help text: dual-mono Peak at 0%, stereo-linked RMS at 100%. |
| 4 gateMix fades Gate with Amount | KEEP | Gen `gateMix = clip(amtNow * 4)` bypasses gate at Amount 0; mirror `computeRecipGain` and Gate help apply gate at every Amount. Face demo history uses the mirror. |

## Bug 1: Scope drag cannot set Gate below -66 dB; clicking the drawn -72 line jumps to -66

- Where: src/reciprocator_ui.js, visual01ToDb bisects only over -66..0 dB, while Gate spans -72..-6 dB (PARAM_SPECS in scripts/build_reciprocator.py; gen clips gate to -72..-6).
- Evidence: round trip through the draw/drag curve pair: -72 dB -> -66.00, -70 -> -66.00, -66 exact, -60 / -42 / -12 exact. The dB component of ampToVisual01 bottoms out at -66 dB, and the bisection in visual01ToDb never searches below -66.
- Impact: Gate values from -72 to about -66.5 are unreachable by dragging, and a click on the drawn gate line silently rewrites them to -66. AGENTS.md section 7 requires a click on a line to keep that dB.
- Red test: in verifyAmxd, after set_gate(-72) and set_gate(-70), clicking the drawn gate line must keep the value within 0.6 dB.

## Bug 2: Lookahead cannot deliver the documented 10 ms above 96 kHz

- Where: src/reciprocator_core.genexpr: Delay lookL(1024) and lookR(1024); lookSampsH = clip(lookMs * 0.001 * sr, 0, 960).
- Evidence: at 192 kHz (Live-supported), the clip caps lookahead at 960 samples = 5.00 ms and the Delay size caps it at 1024 samples = 5.33 ms, against the documented 0..10 ms range (AGENTS.md section 7, Lookahead help text, gen clip of lookahead to 0..10).
- Red test: section 9 parses the Delay size and the clip bound from the gen source and asserts both hold at least 1920 samples (10 ms at 192 kHz).

## Bug 3: Detect 0 percent is not dual-mono; the channels stay 35 percent stereo-linked

- Where: src/reciprocator_core.genexpr: linkAmt = 0.35 + 0.65 * detNow, with envL and envR mixed toward linkedEnv = max(detL, detR).
- Evidence: at Detect 0, linkAmt is 0.35. Detect help in scripts/build_reciprocator.py: 0% = dual-mono Peak, 100% = stereo-linked RMS.
- Red test: section 9 parses the linkAmt formula and asserts a base of 0 and a base-plus-slope of 1.

## Bug 4: The gen fades the noise gate out with Amount; the shared mirror and the docs apply it at every Amount

- Where: src/reciprocator_core.genexpr: gateMix = (revMode > 0.5) ? 1.0 : clip(amtNow * 4.0, 0, 1); effGateL/R = mix(1.0, gate, gateMix). At Amount 0 the gate is fully bypassed in normal mode.
- Evidence: computeRecipGain in src/reciprocator_config.js applies the gate at every amount (below-Gate at Amount 0 returns 0). Gate help has no Amount condition. UI demo history is drawn from the mirror, so at low Amount the face and the DSP disagree. The audio gate_mute case runs at Amount 1.0 and cannot see this.
- Red test: section 9 asserts the gen contains no gateMix Amount scaling, and pins the mirror contract at Amount 0.

## Red run (pass 2)

Command: node tests/test_reciprocator.js (in the worktree)
Result: exit 1. After reordering verifyAmxd before section 9, the suite stops at Bug 1:

AssertionError: clicking the drawn gate line jumped -72 to -66

Bugs 2, 3 and 4 remain in section 9 and fail once Bug 1 is fixed (source still has Delay 1024 / clip 960, linkAmt floor 0.35, and gateMix). Independent checks: curve round-trip for Bug 1; formula/source parse for Bugs 2-4; mirror evaluation for Bug 4.

## Checked and cleared

- PARAM_SPECS ranges and defaults against AGENTS.md section 7 and the gen clips and Param defaults: all match.
- Mirror against gen for the gate cubic, reciprocal targetScale, safeEnv floors, the 1000x gain cap, and the soft/hard/limiter ceiling formulas: match (aside from Bug 4 gateMix divergence).
- Build wiring: percent scaling, prepend chains, drag routing, scope buffer 32 / SCOPE_FLOATS 32, GEN_DSP embedding, panels last with background 1: consistent.
- Known rough edge Soft Clip real tanh: covered by pre-existing nested-return test and audiorate audio case.
- UI setters, scope slot indices, HUD gain text, deferred DSP re-bang list: consistent.
