# Sweep 2 lane report: reciprocator (Reciprocator.amxd)

## Stage A+B summary
Host gate passes (typecheck, build, test_reciprocator, bugsweep, preview); face fuzz 0 failures; test_device_static ok. vm_smoke PASS (12/12 parameters, 54 sets, no restore drift). VM audio suite (10 existing cases) passes; two new cases (`extremes`, `mix0_dry`) pass as regression coverage.
Counts: S1 0, S2 0, S3 1, S4 6.

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| RC-01 | S3 | The six `live.dial`s have no `textcolor`, so in Live their name and value text uses the theme text colour on the dark section panels and is nearly unreadable (Attack, Release, Amount, Gate, Ceiling, Mix and their values). The preview renderer draws them white, hiding it. | tests/out/smoke/reciprocator/default.png (crop: dial labels ghosted) | tests/test_reciprocator_sweep2.js (fails for 6 dials) |
| RC-02 | S4 | Doc drift: AGENTS 7 says `#0-recipscope`; code and device use `---recipscope` (correct). Update the section. | grep | log only |
| RC-03 | S4 | F9 "inlet outlet already connected" not reproduced: no duplicate cords in the .amxd, `rcpDspLoad` connects once (retry removes the gen first). | cord scan | log only |
| RC-04 | S4 | Lookahead (default 1.5 ms, up to 10 ms) delays the dry path but the device reports latency 0 (no PDC). Design choice. | code | log only |
| RC-05 | S4 | Amount 0 is not an identity: Gate (default -42 dB) still mutes quiet signals and Soft Clip tanh-colours at the ceiling (computeRecipGain comment says unity). | code | log only |
| RC-06 | S4 | JS reference `computeGateFactor` floor guard (`silenceHi`) lacks the gen's `max(..., 0.00005)` lower bound; only the demo scope uses the JS reference. | code | log only |
| RC-07 | S4 | Lookahead changes are not smoothed (linear-interp delay read jumps while dragging: possible click). | code | log only |

## Checked, no finding
Gate/Ceiling line drag inverse maps and clamps (-72..-6, -18..0); Rev Gate and output modes (audio: rev_gate, ceiling, limiter, audiorate); parameter table ranges/defaults match AGENTS; mirrors via `set` do not loop; extremes finite and bounded; Mix 0 = dry exactly.
Not checked: multi-instance scope isolation in Live (smoke only loads two instances for parameter isolation), Lookahead 0 sample-exact latency.

## Verify
- KEEP RC-01 (tests/test_reciprocator_sweep2.js): reran, fails for the six live.dial boxes lacking textcolor; smoke default.png confirms dial names/values are ghosted on the dark panels. Real S3, not an iteration-1 item, deterministic static check.
- KEEP audio cases `extremes` and `mix0_dry` (run_reciprocator_audio_tests.py): not red; regression coverage with sound expectations (ceiling 0 dB bound; Mix 0 = dry 0.25 per AGENTS/Stage A+B run).
- RC-02..RC-07 (S4, log only, no tests): no test to verify; accepted as notes. RC-02 doc drift is correct (device uses ---recipscope).
- No tests rejected.
