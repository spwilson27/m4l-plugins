# Envelope Trigger — bugsweep (PASS 2 review)

## Bug 1: Scope buffer uses `#0-trigscope` (not instance-isolated in Live) — KEPT

**PASS 2 decision:** KEEP (High). Verified 2026-10-25 against unfixed production:
- `node tests/test_envtrig_bugsweep.js` → FAIL (expects `buffer~ ---trigscope` / rejects `#0-trigscope`).
- `node tests/test_envtrig.js` → PASS (still asserts `#0-trigscope`).
- `scripts/build_envtrig.py` still has exactly three production `#0-trigscope` sites (lines 421–424: `buffer~`, `setbuffer`, `scope`).
- AGENTS.md precedents (Multiband Split `---mbsplitscope`, Glitch `---glitchscope`, Reverb+ `---rpscope`): `#0` is not expanded in a top-level M4L device patcher in Live.

**Severity:** High (multi-instance correctness)  
**Evidence:**
- `scripts/build_envtrig.py` declares `buffer~ #0-trigscope` and messages `scope #0-trigscope` / `setbuffer #0-trigscope` (approx. lines 421–424).
- `src/envtrig_core.genexpr` / `src/envtrig_config.js` / `src/envtrig_dsp.js` document the same `#0-trigscope` name.
- AGENTS.md (Delay+ §15, Multiband Split, Glitch, Reverb+): **`#0` is not expanded in a top-level M4L device patcher in Live** (only in abstractions). Every Envelope Trigger instance therefore shares one scope ring and header.
- Same class of bug already fixed elsewhere by switching to M4L `---` names (`---dpxfer`, `---mbsplitscope`, `---glitchscope`, `---rpscope`, …).

**User-visible effect:** With two or more Envelope Trigger devices in a Live set, graphs (envelope/scope), fired-note ticks, velocity LED, and deferred-DSP “roll” confirmation can cross-talk or flicker as instances overwrite the shared `buffer~`.

**RED test:** `tests/test_envtrig_bugsweep.js` (expects `---trigscope` and rejects `#0-trigscope`). Left unchanged — still fails on current code; no rewrite needed.

**Fix direction (PASS 3 — do not apply here):** Rename to `---trigscope` in the build script messages and `buffer~` object; keep GenExpr `Buffer scope("trigscope")` and bind with `scope ---trigscope`. Update `tests/test_envtrig.js` assertions that currently require `#0-`. Harness-only buffers may keep `#0-` if they live in an abstraction.

---

PASS 2 re-checked the pass-1 conclusion: no other credible production bugs confirmed in `src/envtrig_*.js`, `src/envtrig_core.genexpr`, `scripts/build_envtrig.py`, and `tests/test_envtrig.js` against AGENTS §1 / §12 (DSP/GenExpr rules, presentation overlap, int>255, getvalueof panel latch, theme) and the instance-isolation (`#0` vs `---`) rule. The shared `receive envtrig-test` hook is intentional for the Max/Live harness and is left as-is. Uncommitted local edits in `scripts/run_envtrig_audio_tests.py` (harness `#0-trigscope`) are out of scope for this review.
