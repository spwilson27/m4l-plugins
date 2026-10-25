# Envelope Trigger — PASS 1 bugsweep

## Bug 1: Scope buffer uses `#0-trigscope` (not instance-isolated in Live)

**Severity:** High (multi-instance correctness)  
**Evidence:**
- `scripts/build_envtrig.py` declares `buffer~ #0-trigscope` and messages `scope #0-trigscope` / `setbuffer #0-trigscope` (approx. lines 421–424).
- `src/envtrig_core.genexpr` / `src/envtrig_config.js` / `src/envtrig_dsp.js` document the same `#0-trigscope` name.
- AGENTS.md (Delay+ §15, Multiband Split, Glitch, Reverb+): **`#0` is not expanded in a top-level M4L device patcher in Live** (only in abstractions). Every Envelope Trigger instance therefore shares one scope ring and header.
- Same class of bug already fixed elsewhere by switching to M4L `---` names (`---dpxfer`, `---mbsplitscope`, `---glitchscope`, `---rpscope`, …).

**User-visible effect:** With two or more Envelope Trigger devices in a Live set, graphs (envelope/scope), fired-note ticks, velocity LED, and deferred-DSP “roll” confirmation can cross-talk or flicker as instances overwrite the shared `buffer~`.

**RED test:** `tests/test_envtrig_bugsweep.js` (expects `---trigscope` and rejects `#0-trigscope`).

**Fix direction (PASS 2 — do not apply here):** Rename to `---trigscope` in the build script messages and `buffer~` object; keep GenExpr `Buffer scope("trigscope")` and bind with `scope ---trigscope`. Update `tests/test_envtrig.js` assertions that currently require `#0-`. Harness-only buffers may keep `#0-` if they live in an abstraction.

---

No other credible production bugs confirmed in this pass after review of `src/envtrig_*.js`, `src/envtrig_core.genexpr`, `scripts/build_envtrig.py`, and `tests/test_envtrig.js` against AGENTS §1 / §12 (DSP/GenExpr rules, presentation overlap, int>255, getvalueof panel latch, theme). The shared `receive envtrig-test` hook is intentional for the Max/Live harness and is left as-is.
