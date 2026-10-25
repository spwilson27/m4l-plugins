# Reverb+ / Reverb+ End — Bug Sweep Pass 1

Worktree: `/private/tmp/bugsweep/reverbplus` · Branch: `bugsweep/reverbplus-pass1` · Base: `66fea67`
Scope: `devices/Reverb+.amxd` + `devices/Reverb+ End.amxd` — `src/reverbplus_engine.js`,
`src/reverbplus_end.genexpr`, `src/reverbplus_start.genexpr`, `src/reverbplus_config.js`,
`src/reverbplus_face*.js`, `src/reverbplus_link.js`, `src/reverbplus_dsp.js`,
`scripts/build_reverbplus.py`, `tests/test_reverbplus.js`, `tests/test_reverbplus_face.js`.
Max / Live were NOT run in this pass (host Node gate only).

## Bugs found (2)

### Bug 1 — `clear_ir` does not clear the saved IR File parameter; Live reload resurrects the IR

**Severity:** user-visible state bug. Clear IR appears to work until the set is reloaded (or the
device is duplicated / the Live.drop param is restored), at which point the previously cleared
impulse comes back.

#### Mechanism

- `browsed()` / `anydrop` → `rpDropRun()` store the path with `outlet(4, p)` into the IR File
  `live.drop` parameter so Live persists it (`src/reverbplus_engine.js` ~156, ~163).
- `clear_ir()` (`src/reverbplus_engine.js` 171–181) zeroes in-memory IR state and
  `rpLastDropped = ""`, bumps the header version, and broadcasts — but **never**
  `outlet(4, "")`.
- On the next load Live replays the still-saved path into `dropfile()`. Because
  `rpLastDropped` is `""`, the guard `p === rpLastDropped && rpIr.loaded` fails, so
  `rpIrLoad(p)` runs and the cleared IR is reloaded.

#### Red test

`tests/test_reverbplus.js`, "clear_ir: a cleared IR stays cleared when Live replays the saved IR File path on load":
vm-executes the real IR path helpers, loads via `browsed("/x/ir.wav")`, clears, then feeds
whatever Live would have saved back into `dropfile()`. Requires the IR to stay unloaded and
no `outlet(2, "replace", …)` to fire.

```
FAIL clear_ir: a cleared IR stays cleared when Live replays the saved IR File path on load: replaying the saved IR File value after clear_ir must not reload the IR
```

#### Fix direction (NOT applied in Pass 1)

In `clear_ir()`, also `outlet(4, "")` (clear the stored IR File parameter), matching how
`browsed`/`anydrop` write it. Alternatively suppress resurrect in `dropfile` after an explicit
clear; clearing outlet 4 is the direct fix already proven on a parallel bugfix branch.

---

### Bug 2 — End K calibration: a candidate does not have to be seen twice IN A ROW

**Severity:** wrong K, adopted silently and persistently: the dry signal is read at the wrong
Start offset in the End and Start re-inserts the feedback return at the wrong position
(B = Smax − K), so the outer loop drifts until a later pair of agreeing windows re-calibrates.
Identical defect to Delay+ End (bugsweep/delayplus-pass1 Bug 1).

#### Mechanism

- `src/reverbplus_end.genexpr` K calibration block (comment at ~151–158; window at
  `if (cN >= 8192)` … `kk = calOk`): every 8192 samples cross-correlates whitened chain
  output against the whitened tap (xfer ch4). Stated rule: adopt only when strong
  (norm > 0.4), unambiguous (1.5× runner-up), inside the window — **and the same K twice
  in a row** (`if (cand == kCand) { kCal = cand; calOk = 1; }`, then `kCand = cand`).
- `kCand` is cleared in exactly one place: the `if (!alive)` block. A window that fails
  acceptance leaves `kCand` untouched.
- Consequence: one spurious accepted peak is banked indefinitely; minutes later a single
  ordinary window whose best lag equals the banked value adopts it as K — not two in a row
  in any meaningful sense. `kk = calOk > 0.5 ? kCal : anchor` then keeps that K.

#### Red test

`tests/test_reverbplus.js`, "K calibration: a candidate must be seen twice in a row (a failed window clears it)":
structural slice of the `if (cN >= 8192)` … `kk = calOk` window; requires a `kCand = 1e9`
reset inside it (same shape as Delay+).

```
FAIL K calibration: a candidate must be seen twice in a row (a failed window clears it): a calibration window that does not adopt must clear the pending candidate (kCand)
```

#### Fix direction (NOT applied in Pass 1)

Clear `kCand` at the end of every calibration window that did not adopt (an `else` on the
acceptance `if`, or an unconditional reset after the adoption check), so adoption again
requires two consecutive accepted windows with the same lag.

## Audited / not filed

- Buffer / send names use `---` (`---rpxfer`, `---rphdr`, `---rpscope`, `---rpir`, …); the
  intentional `#0-rptest` receive is documented for the MCP test hook.
- GenExpr lint already covered by existing `test_reverbplus.js` (functions-first, one return,
  no nested poke calls, Param/buffer/header slot contracts).
- Face overlap / 169 px / wiring covered by layout builds inside the same host suite.
- No additional credible bugs found in a pass-1 pass over engine IR path, End K calib, and
  the existing host suite surface. Production code was not modified.

## Commands (host gate only)

```
npm run -s typecheck && python3 scripts/build_reverbplus.py && node tests/test_reverbplus.js && node tests/test_reverbplus_face.js
```

Expect the two new tests above to FAIL on unmodified HEAD; all prior tests should still PASS.

## Pass 2 review

Date: 2026-10-25. Reviewed both Pass-1 reds against current `src/`; host gate re-run on this worktree. Production / `src/` not modified.

- **Kept Bug 1** (`clear_ir` resurrection): confirmed. `clear_ir` never `outlet(4, "")`; Live replay via `dropfile` reloads the IR. Behavioral red stays; FAIL as expected.
- **Kept Bug 2** (End K calib): confirmed. `kCand` is cleared only in the `!alive` block, not when an acceptance window fails. Structural red stays; FAIL as expected.
- **Dropped:** none.
- Host gate: `python3 scripts/build_reverbplus.py` OK; `node tests/test_reverbplus.js` → 29 passed, 2 failed (exactly the two reds); `node tests/test_reverbplus_face.js` → 20 passed.
