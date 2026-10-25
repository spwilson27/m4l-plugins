# Envelope Trigger — bugsweep (PASS 3 fixed)

## Bug 1: Scope buffer uses `#0-trigscope` (not instance-isolated in Live) — FIXED

**PASS 3 decision:** FIXED (was High). Verified 2026-10-25 against fixed production:
- `node tests/test_envtrig_bugsweep.js` → PASS (expects `buffer~ ---trigscope` / rejects `#0-trigscope`).
- `node tests/test_envtrig.js` → PASS (asserts `---trigscope`; generic `buffer~` loop allows `#0-` or `---trigscope`).
- Host gate green: `npm run -s typecheck && python3 scripts/build_envtrig.py && node tests/test_envtrig.js && node tests/test_envtrig_bugsweep.js`.
- Built `devices/Envelope Trigger.amxd` [228/342x169 px] (161476 bytes).
- AGENTS.md precedents (Multiband Split `---mbsplitscope`, Glitch `---glitchscope`, Reverb+ `---rpscope`): `#0` is not expanded in a top-level M4L device patcher in Live.

**Severity:** High (multi-instance correctness) — resolved.

**Fix:** Renamed the production scope telemetry buffer from `#0-trigscope` to M4L `---trigscope`. Kept GenExpr `Buffer scope("trigscope")` and bind with `scope ---trigscope`.

**Touchpoints:**
- `scripts/build_envtrig.py` (~421–424): `buffer~ ---trigscope @samps …`, `setbuffer ---trigscope`, `scope ---trigscope`.
- `src/envtrig_core.genexpr`: docs/comments → `---trigscope` (bind message `scope ---trigscope`).
- `src/envtrig_config.js` / `src/envtrig_dsp.js`: docs → `---trigscope`.
- `tests/test_envtrig.js`: name-specific asserts expect `---trigscope`; generic `buffer~` prefix loop allows `#0-` or `---trigscope` for the shared scope telemetry buffer.
- `tests/test_envtrig_bugsweep.js`: left unchanged (RED → green on fixed production).

**Out of scope (unchanged):** `scripts/run_envtrig_audio_tests.py` harness `#0-trigscope` (lives in an abstraction); AGENTS.md historical Envelope Trigger docs.

**Commit SHA:** pending tip of `bugsweep/envelope-trigger-pass1` (filled after PASS 3 commit).

---

PASS 2 re-checked the pass-1 conclusion: no other credible production bugs confirmed in `src/envtrig_*.js`, `src/envtrig_core.genexpr`, `scripts/build_envtrig.py`, and `tests/test_envtrig.js` against AGENTS §1 / §12 (DSP/GenExpr rules, presentation overlap, int>255, getvalueof panel latch, theme) and the instance-isolation (`#0` vs `---` ) rule. The shared `receive envtrig-test` hook is intentional for the Max/Live harness and is left as-is.
