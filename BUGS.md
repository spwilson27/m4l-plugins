# Reciprocator - Bug Sweep

Branch: bugsweep/reciprocator-pass1
Worktree: /private/tmp/bugsweep/reciprocator
Scope: pass 4 final review — APPROVED. No follow-up code changes. Host gate green.

## Pass 4 review (APPROVED)

Reviewed production diffs vs the four kept reds. All four fixes are minimal and correct; tests were strengthened (not weakened). No adjustments.

Host gate (worktree, tip da2e876 before this note): `npm run -s typecheck && python3 scripts/build_reciprocator.py && node tests/test_reciprocator.js` → green (`test_reciprocator: ok`, `devices/Reciprocator.amxd` rebuilt).

| Bug | Verdict | Why |
| --- | --- | --- |
| 1 Gate drag below -66 | APPROVED | `ampToVisual01` / `visual01ToDb` now span -72..0; keep-value asserts for set_gate(-72)/(-70) pass. Ceiling still drawn through the same inverse; -12 keep-value intact. |
| 2 Lookahead at 192 kHz | APPROVED | `Delay lookL/R(2048)` and `lookSampsH` clip 1920 hold 10 ms at 192 kHz; section 9 parses both ≥ 1920. |
| 3 Detect 0% dual-mono | APPROVED | `linkAmt = 0.0 + 1.0 * detNow` — base 0, base+slope 1; matches Detect help. |
| 4 gateMix fades Gate with Amount | APPROVED | `gateMix` removed; `effGateL/R = gateL/R` always. Mirror Amount-0 contract pinned; gen has no Amount fade. |

## Pass 2 review (kept 4 / dropped 0)

All four pass-1 claims are real functional / docs / mirror mismatches. No drops. Strengthened reachability by calling verifyAmxd before section 9 so Bug 1 fails first (section 9 previously short-circuited the suite).

| Bug | Verdict | Why |
| --- | --- | --- |
| 1 Gate drag below -66 | KEEP | `ampToVisual01` / `visual01ToDb` use a -66..0 map; Gate is -72..-6. Click on drawn -72/-70 line jumps to -66. Violates AGENTS.md "click on a line keeps that dB". |
| 2 Lookahead at 192 kHz | KEEP | `Delay lookL/R(1024)` and `lookSampsH` clip 960 cannot hold 10 ms at 192 kHz (1920). Docs/PARAM_SPECS/gen clip promise 0..10 ms with no SR caveat. |
| 3 Detect 0% not dual-mono | KEEP | `linkAmt = 0.35 + 0.65 * detNow` leaves 35% stereo link at Detect 0. Help text: dual-mono Peak at 0%, stereo-linked RMS at 100%. |
| 4 gateMix fades Gate with Amount | KEEP | Gen `gateMix = clip(amtNow * 4)` bypasses gate at Amount 0; mirror `computeRecipGain` and Gate help apply gate at every Amount. Face demo history uses the mirror. |

## Pass 3 fixes

Host gate (worktree): `npm install && npm run -s typecheck && python3 scripts/build_reciprocator.py && node tests/test_reciprocator.js` → green (`test_reciprocator: ok`, `devices/Reciprocator.amxd` rebuilt).
Commit SHA: da2e87683e583844be0680fb2f85ad37d1f86b47.

### Bug 1: Gate scope drag below -66 dB

- Fix: `src/reciprocator_ui.js` — `ampToVisual01` dB component and `visual01ToDb` bisection span **-72..0** (was -66..0) so a click on the drawn Gate line keeps that dB across the full Gate floor.
- Red: verifyAmxd keep-value asserts for set_gate(-72) / set_gate(-70).

### Bug 2: Lookahead 10 ms at 192 kHz

- Fix: `src/reciprocator_core.genexpr` — `Delay lookL/R(2048)` (was 1024); `lookSampsH` clip upper bound **1920** (was 960) = 10 ms at 192 kHz.
- Red: section 9 Delay size + clip parse ≥ 1920.

### Bug 3: Detect 0% dual-mono

- Fix: `src/reciprocator_core.genexpr` — `linkAmt = 0.0 + 1.0 * detNow` (was `0.35 + 0.65 * detNow`) so Detect 0 is fully dual-mono and 100% is fully linked.
- Red: section 9 linkAmt base 0 / base+slope 1.

### Bug 4: Gate applies at every Amount

- Fix: `src/reciprocator_core.genexpr` — removed `gateMix` Amount fade; `effGateL/R = gateL/R` always (matches mirror + Gate help).
- Red: section 9 asserts no `gateMix`; mirror contract at Amount 0.

## Bug 1 (original claim): Scope drag cannot set Gate below -66 dB; clicking the drawn -72 line jumps to -66

- Where: src/reciprocator_ui.js, visual01ToDb bisects only over -66..0 dB, while Gate spans -72..-6 dB (PARAM_SPECS in scripts/build_reciprocator.py; gen clips gate to -72..-6).
- Evidence: round trip through the draw/drag curve pair: -72 dB -> -66.00, -70 -> -66.00, -66 exact, -60 / -42 / -12 exact. The dB component of ampToVisual01 bottoms out at -66 dB, and the bisection in visual01ToDb never searches below -66.
- Impact: Gate values from -72 to about -66.5 are unreachable by dragging, and a click on the drawn gate line silently rewrites them to -66. AGENTS.md section 7 requires a click on a line to keep that dB.
- Red test: in verifyAmxd, after set_gate(-72) and set_gate(-70), clicking the drawn gate line must keep the value within 0.6 dB.
- Status: FIXED in pass 3 (curve span -72..0).

## Bug 2 (original claim): Lookahead cannot deliver the documented 10 ms above 96 kHz

- Where: src/reciprocator_core.genexpr: Delay lookL(1024) and lookR(1024); lookSampsH = clip(lookMs * 0.001 * sr, 0, 960).
- Evidence: at 192 kHz (Live-supported), the clip caps lookahead at 960 samples = 5.00 ms and the Delay size caps it at 1024 samples = 5.33 ms, against the documented 0..10 ms range (AGENTS.md section 7, Lookahead help text, gen clip of lookahead to 0..10).
- Red test: section 9 parses the Delay size and the clip bound from the gen source and asserts both hold at least 1920 samples (10 ms at 192 kHz).
- Status: FIXED in pass 3 (Delay 2048, clip 1920).

## Bug 3 (original claim): Detect 0 percent is not dual-mono; the channels stay 35 percent stereo-linked

- Where: src/reciprocator_core.genexpr: linkAmt = 0.35 + 0.65 * detNow, with envL and envR mixed toward linkedEnv = max(detL, detR).
- Evidence: at Detect 0, linkAmt is 0.35. Detect help in scripts/build_reciprocator.py: 0% = dual-mono Peak, 100% = stereo-linked RMS.
- Red test: section 9 parses the linkAmt formula and asserts a base of 0 and a base-plus-slope of 1.
- Status: FIXED in pass 3 (linkAmt = 0.0 + 1.0 * detNow).

## Bug 4 (original claim): The gen fades the noise gate out with Amount; the shared mirror and the docs apply it at every Amount

- Where: src/reciprocator_core.genexpr: gateMix = (revMode > 0.5) ? 1.0 : clip(amtNow * 4.0, 0, 1); effGateL/R = mix(1.0, gate, gateMix). At Amount 0 the gate is fully bypassed in normal mode.
- Evidence: computeRecipGain in src/reciprocator_config.js applies the gate at every amount (below-Gate at Amount 0 returns 0). Gate help has no Amount condition. UI demo history is drawn from the mirror, so at low Amount the face and the DSP disagree. The audio gate_mute case runs at Amount 1.0 and cannot see this.
- Red test: section 9 asserts the gen contains no gateMix Amount scaling, and pins the mirror contract at Amount 0.
- Status: FIXED in pass 3 (gateMix removed; effGate = gate).

## Red run (pass 2)

Command: node tests/test_reciprocator.js (in the worktree)
Result: exit 1. After reordering verifyAmxd before section 9, the suite stops at Bug 1:

AssertionError: clicking the drawn gate line jumped -72 to -66

Bugs 2, 3 and 4 remain in section 9 and fail once Bug 1 is fixed (source still has Delay 1024 / clip 960, linkAmt floor 0.35, and gateMix). Independent checks: curve round-trip for Bug 1; formula/source parse for Bugs 2-4; mirror evaluation for Bug 4.

## Checked and cleared

- PARAM_SPECS ranges and defaults against AGENTS.md section 7 and the gen clips and Param defaults: all match.
- Mirror against gen for the gate cubic, reciprocal targetScale, safeEnv floors, the 1000x gain cap, and the soft/hard/limiter ceiling formulas: match (aside from Bug 4 gateMix divergence — now aligned in pass 3).
- Build wiring: percent scaling, prepend chains, drag routing, scope buffer 32 / SCOPE_FLOATS 32, GEN_DSP embedding, panels last with background 1: consistent.
- Known rough edge Soft Clip real tanh: covered by pre-existing nested-return test and audiorate audio case.
- UI setters, scope slot indices, HUD gain text, deferred DSP re-bang list: consistent.
