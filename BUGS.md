# Clip+ bug sweep — pass 3 (fix)

Worktree: `/private/tmp/bugsweep/clipplus-2` on branch `bugsweep/clipplus-pass1-2`
Pass-2 tip: `0915084` — keep True Peak unreachable red
Pass-3 tip: (this commit) — restore True Peak Options control (`truepeak` → `prepend tpeak`)

## Pass 3 outcome

| Claim | Verdict | Notes |
|-------|---------|-------|
| Bug 1 — True Peak unreachable | **FIXED** | Options toggle `truepeak` wires `prepend tpeak` / `set_tpeak` without reviving banned `obj-ctrl-tpeak` / `obj-ui-tpeak`. |
| Checked-and-cleared items | Confirm | Untouched; host suite still green. |
| Noted (`inPk` vs post-shelf; `tpHold` decay while off) | Leave noted | `tpHold` note is no longer moot (toggle exists); still not promoted. |

**Fixed 1 / kept 0 for pass 4 review.**

## Bug 1 — FIXED: True Peak can never be enabled in the shipped device

**What was wrong:** The true-peak limiter was fully implemented in gen / JS / face but unreachable from the patcher. Options **Peak** is Hard Limit (`hlim`) only; nothing sent the gen its `tpeak` Param.

**Fix (pass 3):** In `scripts/build_clipplus.py` Options `toggles`, add a True Peak row under a new key that is **not** `tpeak` (the existing suite and the red both forbid `obj-ctrl-tpeak` / `obj-ui-tpeak`):

```
("truepeak", "True Peak", "TP", "TP", opt_btn_x, 132, 48, 0, "tpeak", "set_tpeak", False,
 "True-peak limiter: turns the 4x-reconstructed inter-sample peak down to the ceiling."),
("meters", ..., opt_btn_x, 150, ...),  # was y=144; moved down 6 px so rows do not overlap
```

The generic toggle loop then emits:

- `obj-ctrl-truepeak` (live.text TP button)
- `obj-prep-truepeak` with text `prepend tpeak` (fed by a patchline from the control → `obj-gen-in`)
- `obj-ui-truepeak` with text `prepend set_tpeak` → face / meters

Peak / Hard Limit (`hlim`) is unchanged. Device rebuilt: `devices/Clip+.amxd` [406x169].

**Touchpoints:**
- `scripts/build_clipplus.py:353` — `truepeak` toggle (`gen_msg=tpeak`, `ui_msg=set_tpeak`, y=132)
- `scripts/build_clipplus.py:354` — `meters` y moved 144 → 150
- `scripts/build_clipplus.py:357-363` / `:479-487` — existing loop builds prep/ui boxes and wires ctrl→prep→gen + ctrl→ui→viz (no new wiring code)
- `devices/Clip+.amxd` — rebuilt binary with reachable `prepend tpeak`
- Face already had `set_tpeak` / `cpResend` (`src/clipplus_ui.js:48`, `:238`, `:345`); unused until this control existed

**Host gate (green):**
```
npm run -s typecheck && python3 scripts/build_clipplus.py && node tests/test_clipplus.js && node tests/test_clipplus_bugsweep.js
→ Built devices/Clip+.amxd [406x169 px]
→ test_clipplus: ok
→ [bugsweep] true peak is reachable from a device control
→ test_clipplus_bugsweep: ok
```

Red test left intact (not weakened). Pass-2 tip `0915084` remains the parent; this pass-3 commit is the fix.

## Checked and cleared (no bug claimed) — pass 2 confirms; pass 3 did not reopen

Verified by pass 1 (reading plus numeric probe); pass 2 did not reopen these; pass 3 left them alone:
- `cp_curve` / `cp_body` / `cp_fir_coef` / `cp_clip_gr` gen-vs-JS twins: exact (existing suite).
- `cp_os_store` vs `cpOsProcess` and `cp_tp_store` vs `cpTpPeak` twins over 200 samples: worst diff 0.
- Emphasis shelf (gen `cp_pre_emp`): gain at fc is exactly -Emphasis/4 dB for Q = 0.1,
  0.707, 2, 10 (measured -3.000 dB at Emphasis 12); asymptotes -12 dB low / +6 dB high
  at Emphasis 12; pre/post pair cancels (existing suite). Low Cut at fc measures
  exactly 20*log10(Q).
- Latency: JS engine impulse peak at sample 1047 in base, oversampled, true-peak and
  Detail-100 modes. Delta at Drive 0 nulls exactly (max 0 after latency).
- Parameter ranges/defaults agree across build NUMS/toggles, gen Params + History
  initials, JS `cpDefaultParams`, and face variable defaults. All `set_*`
  handlers named by the build exist in the face. Scope slot indices match.
  Baseline: `node tests/test_clipplus.js` → `test_clipplus: ok`.

## Noted, not claimed (no test written) — pass 3 leaves as notes

- Gen scope `inPk`/`inPkL`/`inPkR` are accumulated from the pre-emphasis signal
  (`ch0In`/`ch1In`) while section 29 and the gen's own `inSq` comment describe the
  input peak as the same post-shelf signal as the input RMS (`xsL`/`xsR`). Every
  current face display path prefers `drvPk` (post-shelf) and only falls back to
  `inPk` when the driven peak is 0, so user impact is negligible today; recorded
  here in case a future consumer reads those scope slots directly.
- Gen `tpHold` only decays while `smTp > 0.001` (the JS engine decays it every
  sample), so a stale hold could briefly dip the gain if True Peak is toggled
  off and back on. Pass 3 made the toggle reachable; still not promoted to a bug
  (no red written) — worth a Live listen / optional follow-up if audible.

---

# Clip+ bug sweep — pass 4 (final review)

Worktree: `/private/tmp/bugsweep/clipplus-2` on branch `bugsweep/clipplus-pass1-2`
Pass-3 tip: `89725e0` — restore True Peak Options control
Pass-4 tip: (this commit) — APPROVED; no production code changes

## Pass 4 outcome

| Claim | Verdict | Notes |
|-------|---------|-------|
| Bug 1 — True Peak unreachable | **APPROVED** | Minimal Options toggle under key `truepeak` (not banned `tpeak` ids); generic loop wires `prepend tpeak` / `set_tpeak`; meters y 144→150 only layout side-effect; red assertions intact. |
| Checked-and-cleared items | Confirm | Untouched; host suite still green. |
| Noted (`inPk` vs post-shelf; `tpHold` decay while off) | Leave noted | Still not promoted; `tpHold` note remains valid now that the toggle exists. |

**Approved 1 / adjusted 0.**

## Review notes

- Production change is only `scripts/build_clipplus.py` (+3/−1): one `truepeak` Options row (`gen_msg=tpeak`, `ui_msg=set_tpeak`, y=132) and meters y 144→150. `devices/Clip+.amxd` is the rebuild artifact. No hand-edit of the binary (AGENTS.md).
- Deliberately avoids reviving banned `obj-ctrl-tpeak` / `obj-ui-tpeak`; red test still forbids those ids and green asserts a fed `prepend tpeak` exists — test not weakened.
- Reuses the existing generic toggle loop for prep/ui boxes and wiring; no bespoke patcher code; no drive-by refactors.
- Host gate re-run green in this pass (no Max/Live — host-side only per job rules):
  ```
  npm run -s typecheck && python3 scripts/build_clipplus.py && node tests/test_clipplus.js && node tests/test_clipplus_bugsweep.js
  → Built devices/Clip+.amxd [406x169 px] (648309 bytes)
  → test_clipplus: ok
  → [bugsweep] true peak is reachable from a device control
  → test_clipplus_bugsweep: ok
  ```

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

# Ableton MCP Bridge — Pass 1 bug sweep (red tests only, no fixes)

- Worktree: /tmp/bugsweep/mcp-bridge
- Branch: bugsweep/mcp-bridge-pass1 (base HEAD 66fea67)
- Scope read in full: AGENTS.md section 13 (Architecture of devices/Ableton MCP Bridge.amxd), src/ableton_mcp_node.js (297 lines), src/ableton_mcp_lom.js (799 lines), scripts/ableton_mcp_server.js (621 lines), scripts/build_ableton_mcp.py, tests/test_ableton_mcp.js.
- Baseline on unmodified HEAD: node tests/test_ableton_mcp.js -> PASS (exit 0).
- No production code was changed. No Live, Max, or MCP session was started on this machine; every test below is plain Node.

## BUG-MCP-1: delete_device with no target calls delete_device(-1) on live_set instead of erroring

- Where: src/ableton_mcp_lom.js, handleDeleteDevice (lines 422-445), with makeApi (line 79). The MCP tool schema in scripts/ableton_mcp_server.js (lines 214-235) declares no required fields for ableton_delete_device, so an empty-arguments call is valid at the MCP layer and reaches this handler.
- Evidence: with neither path nor parentPath/deviceIndex, parentPath stays empty and deviceIndex stays -1. makeApi on an empty target silently substitutes live_set, and the handler unconditionally runs parentApi.call("delete_device", -1) and returns deleted: true.
- Expected: a validation error (ok: false) and no delete_device call at all.
- Actual (red run): reply was {"ok":true,"result":{"deleted":true,"parent_path":"","device_index":-1,"result":"ok"}}.
- Red test: tests/test_ableton_mcp.js block 3, BUG-MCP-1 (vm sandbox with mock LiveAPI, same style as the existing LOM tests).

## BUG-MCP-2: set_device_parameter without a numeric value writes NaN to the parameter

- Where: src/ableton_mcp_lom.js, handleSetDeviceParameter (lines 380-420); the clamp is line 408: Math.max(targetParam.min, Math.min(targetParam.max, Number(p.value))).
- Evidence: the handler validates path but never validates value. With value missing or non-numeric, Number(p.value) is NaN, the clamp returns NaN, and paramApi.set("value", NaN) is executed. The HTTP /rpc surface in src/ableton_mcp_node.js performs no argument validation either, so the LOM executor is the last line of defense.
- Expected: a validation error (ok: false) and no set call.
- Actual (red run): reply was ok: true for a call with paramIndex 1 and no value; the captured set call received NaN (the reply re-read shows the old mock value because the mock get is static).
- Red test: tests/test_ableton_mcp.js block 3, BUG-MCP-2.

## BUG-MCP-3: transport with an unknown action reports success while doing nothing

- Where: src/ableton_mcp_lom.js, handleTransport (lines 447-466).
- Evidence: the action string is matched against play/stop/continue/undo/redo and every other value falls through silently; the handler then returns handleGetSessionInfo() as a successful result. A typo or bogus action sent over /rpc (where no tool schema enum applies) is indistinguishable from a real transport command.
- Expected: ok: false for an unrecognized action (a tempo-only call with no action remains legitimate).
- Actual (red run): action bogus_action returned ok: true with full session info.
- Red test: tests/test_ableton_mcp.js block 3, BUG-MCP-3.

## BUG-MCP-4: POST /rpc with a valid-JSON null body crashes the Node bridge

- Where: src/ableton_mcp_node.js, /rpc handler (lines 170-191), dereference at line 182: String(body.action || "ping") and line 183 body.params.
- Evidence: JSON.parse succeeds for the body null (and for other non-object JSON values), but the handler assumes an object. A null body throws TypeError: Cannot read properties of null (reading action) inside the async end handler; the unhandled rejection terminates the Node process, so the HTTP client gets no response at all and the bridge is down until Max restarts the codebox.
- Expected: an HTTP error response with ok: false (for example 400), and the bridge stays alive and healthy.
- Actual (red run): no HTTP response; child process stderr showed the TypeError at src/ableton_mcp_node.js:182 and the process exited.
- Red test: tests/test_ableton_mcp_stdio_http.js, BUG-MCP-4 (spawns the real bridge on test port 19931 via the global.__MAX_API_MOCK__ fallback; no Live needed).

## BUG-MCP-5: stdio MCP server silently swallows invalid JSON instead of returning a -32700 parse error

- Where: scripts/ableton_mcp_server.js, stdin loop (lines 556-569): both the Content-Length branch and the newline branch wrap JSON.parse plus handleJsonRpcMessage in try { } catch (_) { }.
- Evidence: a malformed line is consumed and dropped with no response. JSON-RPC 2.0 requires a parse error response with code -32700 and id null; without it, a client that sent a damaged frame waits forever for a reply that never comes.
- Expected: one JSON-RPC error message {"jsonrpc":"2.0","id":null,"error":{"code":-32700,...}} and the server keeps serving later valid messages.
- Actual (red run): after the invalid line, the only response seen was the later valid ping reply {"jsonrpc":"2.0","id":99,"result":{}}; no parse error was emitted.
- Red test: tests/test_ableton_mcp_stdio_http.js, BUG-MCP-5 (spawns the real stdio server as a child process).

## Red run summary (2026-10-24, this worktree)

- node tests/test_ableton_mcp.js -> exit 1. Pre-existing blocks 1-2 pass; new block 3 reports exactly 3 failures: BUG-MCP-1, BUG-MCP-2, BUG-MCP-3 (each: expected ok:false, got ok:true).
- node tests/test_ableton_mcp_stdio_http.js -> exit 1. Exactly 2 failures: BUG-MCP-4 (no HTTP response, TypeError crash at ableton_mcp_node.js:182) and BUG-MCP-5 (no -32700 response).
- No other failures. Nothing in src/ or scripts/ was modified.

## Pass 2 review (2026-10-25)

- Re-read production handlers: `handleDeleteDevice` / `handleSetDeviceParameter` / `handleTransport` in `src/ableton_mcp_lom.js`, POST `/rpc` in `src/ableton_mcp_node.js`, stdin loop in `scripts/ableton_mcp_server.js`.
- Re-ran host tests on unfixed code in this worktree:
  - `node tests/test_ableton_mcp.js` -> exit 1 (BUG-MCP-1, BUG-MCP-2, BUG-MCP-3; each expected ok:false, got ok:true).
  - `node tests/test_ableton_mcp_stdio_http.js` -> exit 1 (BUG-MCP-4 TypeError crash on null `/rpc` body; BUG-MCP-5 no -32700 after invalid JSON).
- Decision: **kept 5 / dropped 0**.
  - BUG-MCP-1: real — empty target becomes `delete_device(-1)` on `live_set` via `makeApi` fallback; unvalidated destructive op.
  - BUG-MCP-2: real — missing `value` → `Number(undefined)=NaN` through clamp into `paramApi.set`.
  - BUG-MCP-3: real — unknown transport action falls through and returns session info as success.
  - BUG-MCP-4: real — `JSON.parse('null')` then `body.action` TypeError downs the bridge.
  - BUG-MCP-5: real — `catch (_) {}` swallows parse errors; clients hang waiting for -32700.
- No test rewrites: reds already fail on the claimed symptoms. No production/src fixes (pass 3).

## Pass 3 fixes (2026-10-25)

- Host gate green: `npm run -s typecheck && node tests/test_ableton_mcp.js` pass; `node tests/test_ableton_mcp_stdio_http.js` also passes. All 5 kept reds are now green.
- BUG-MCP-1: `src/ableton_mcp_lom.js` `handleDeleteDevice` - added a guard `if (!parentPath || deviceIndex < 0) throw` before `parentApi.call(delete_device, ...)`, so an empty target returns ok:false and makes no delete call.
- BUG-MCP-2: `src/ableton_mcp_lom.js` `handleSetDeviceParameter` - reject a missing or non-numeric value (`typeof p.value !== "number" || !isFinite(p.value)`) before the clamp and `paramApi.set`, so NaN is never written.
- BUG-MCP-3: `src/ableton_mcp_lom.js` `handleTransport` - added `else if (act) throw Unknown transport action`; a tempo-only call with no action still succeeds.
- BUG-MCP-4: `src/ableton_mcp_node.js` POST `/rpc` - guard `body === null || typeof body !== "object" || Array.isArray(body)` returns 400 ok:false before dereferencing `body.action`, so the bridge stays alive; narrowed body via a reqBody cast to keep typecheck clean.
- BUG-MCP-5: `scripts/ableton_mcp_server.js` stdin loop - both the Content-Length and newline branches now emit a jsonrpc 2.0 id:null error with code -32700 (Parse error) on bad JSON and keep serving later valid messages.
- No red tests were weakened or deleted. Next step: commit on branch bugsweep/mcp-bridge-pass1 (no merge to main, worktree preserved).

## Pass 4 review (final) — APPROVED

Host gate re-run green on this worktree:
`npm run -s typecheck && node tests/test_ableton_mcp.js && node tests/test_ableton_mcp_stdio_http.js` all pass.

Reviewed git diff main...HEAD (src + scripts, not just tests). Each pass-3 fix is minimal, correct, and matches the AGENTS.md argument-validation / JSON-RPC error patterns; no tests were weakened and there are no drive-by refactors.

- BUG-MCP-1 delete_device with no target: APPROVED — errors instead of calling delete_device(-1) on live_set.
- BUG-MCP-2 missing numeric param -> NaN: APPROVED — value validated before use.
- BUG-MCP-3 unknown transport action reported success: APPROVED — now returns an error.
- BUG-MCP-4 POST /rpc with JSON null body: APPROVED — returns ok:false and the bridge stays alive/healthy.
- BUG-MCP-5 stdio invalid JSON: APPROVED — emits a -32700 parse error (id null) and the server survives.

Not merged to main; worktree retained for the coordinator's serial merge.

# EQ+ — Bug Sweep Pass 1 (bugs + red tests only, no fixes)

Worktree: `/tmp/bugsweep/eqplus` · Branch: `bugsweep/eqplus-pass1` · Base: `66fea67`
Scope: `devices/EQ+.amxd` — `src/eqplus_config.js`, `src/eqplus_core.genexpr`,
`src/eqplus_ui.js`, `scripts/build_eqplus.py`, `tests/test_eqplus.js`,
`scripts/run_eqplus_audio_tests.py` (case list skimmed; Max/Live not run in this pass).

## Bug 1 — Automating Tilt EQ leaves the phase kernel stale (Linear Phase ignores the tilt entirely)

**Severity:** audible wrong behaviour in Linear Phase; stale correction in Natural Phase.

### Mechanism

- `tilt_eq` is an automatable Live parameter (-24..+24 dB/decade) bound to the face
  inlet `set_tilt_eq` (`scripts/build_eqplus.py`, control spec `obj-ctrl-tilt-eq`).
- `set_tilt_eq` (`src/eqplus_ui.js`) only calls `emitTilt()` and redraws. It never calls
  `updateCoeffBuffer()` / `updatePhaseKernel()`. Every other design input does:
  `set_shift`, `set_adaptiveq`, all `set_band_*`, `set_route`, `sr()`, `applyStateArray`.
- The tilt is a *design input* of the phase kernel: `eqpDesignPhase(bands, sr, shiftSt,
  adaptiveQ, tiltEqDb)` (`src/eqplus_config.js`) folds the tilt cascade into the Linear
  IR magnitude (`magD`) and into the Natural correction ratio.
- In the gen (`src/eqplus_core.genexpr`), the Linear path convolves the **dry** input
  (`latRingL/R` fed from `dom0/dom1`) with that designed IR (`hre/him`, `hreB/himB`).
  The gen’s own tilt cascade feeds only the Zero-Latency output (`audL/audR`) and the
  Natural FIR input (`nfirL/nfirR` via `eqL/eqR`) — it never reaches the Linear output
  (`olaL/olaR`). So in Linear Phase an automated Tilt EQ change changes **nothing**
  audible until some unrelated edit happens to call `updateCoeffBuffer()`.
  In Natural Phase the biquad+tilt part updates live via `emitTilt`, but the 128-tap
  correction FIR is left designed for the old tilt (the tilt only approximately cancels
  in the analog/digital ratio because of the -12..-36 dB blend and the ±12 dB cap in
  `eqpDesignPhase`).
- Face drags mask the bug: the `tilteq` gesture ends in `finishGesture()`, which calls
  `updateCoeffBuffer()`. The exposed path is host automation / macro / preset-driven
  changes arriving through the `set_tilt_eq` inlet — exactly what the parameter exists for.

### Red test

`tests/test_eqplus.js`, new section 9 (`runBugSweepPass1`): fresh mock face, enter
Linear Phase (IR pokes counted on the stubbed `#0-eqplusir` Buffer), then
`ui.set_tilt_eq(6)` and require a further IR poke; same again in Natural Phase.

```
AssertionError [ERR_ASSERTION]: bug sweep: set_tilt_eq redesigns the phase kernel in Linear Phase (stale IR: the gen convolves dry audio with the IR, so an automated Tilt EQ change is inaudible until an unrelated coeff update)
    at ok (/private/tmp/bugsweep/eqplus/tests/test_eqplus.js:36:12)
    at runBugSweepPass1 (/private/tmp/bugsweep/eqplus/tests/test_eqplus.js:2665:5)
```

Commands: `python3 scripts/build_eqplus.py && node tests/test_eqplus.js` (worktree, host).
The three sanity checks before the failing one pass (phase engages, entering Linear
pokes a designed IR, the tilt value itself lands), so the red is the missing redesign,
not a harness artefact.

### Fix direction (NOT applied in Pass 1)

Route `set_tilt_eq` through `updateCoeffBuffer()` like the other design inputs
(it already re-emits the tilt via `emitTilt` inside `updateCoeffBuffer`).

## Audited, no credible bug found

- **Config math** (`eqplus_config.js`): RBJ coeffs for all 13 modes; analog prototypes
  in `eqpAnalogSection` (shelf ×A gives the correct A² plateau; bell centre ratio A²);
  `eqpTiltShelf1` is exactly A² at DC and unity at Nyquist; solo bandpass is the RBJ
  constant-0 dB-peak form; `eqpEffectiveFreq` / `eqpEffectiveQ` clamps.
- **Gen cascade** (`eqplus_core.genexpr`): DF2T section loop, `sections` repetition,
  cstate snap/slew (0.995/0.005), zstate clear on enable/disable per curve and channel,
  M/S encode/decode gains (1/√2 both ways), tilt snap/slew into `tiltC` (gain at 27),
  Natural delay `round(322·sr/44100)`, Linear latency constant 3072 = (2048-1)+1025,
  IR job split (unity / curve A at irspec ch 0 @0 / curve B @2048 / Natural taps ch 1 @0,128)
  vs the face’s `Buffer.poke` layout (JS channels are 1-based) — all consistent.
- **Spectrum path**: gen spec writes (ch 0 pre, ch 1 post, ch 2 metadata, ch 3 sidechain,
  all at 8+writeIdx) vs face reads (1-based channels 1/2/3/4, offset 8 with offset-0
  fallback) and the build’s `buffer~ #0-eqplusspec 200 4 @samps 8200` — consistent.
- **Solo**: `updateSoloState` uses `toScreenFreq(b.freq)`, which *does* apply the Global
  Shift (`eqpEffectiveFreq`), and effective Q — matches the existing test’s expectation.
- **Routes**: Stereo/Left/Right/Mid/Side semantics (`routeEditsB`, `focusRoute`, linked
  copy-back) match the gen’s curve A = dom0 / curve B = dom1 slot logic and the build help text.
- **State blob**: `getvalueof`/`applyStateArray` indices (curve A at 12, shelves at 52,
  phase at 58, route at 59, curve B at 60; length 100) round-trip, incl. legacy lengths.
- **Latency reporting**: `updateDeviceLatency` matches the gen (Natural formula, Linear 3072).

## Pass 2 review (reds only — no fixes)

- **Kept 1 — Bug 1 (stale phase kernel on `tilt_eq` automation).** Mechanism re-checked: `set_tilt_eq` only `emitTilt()` + redraw; `set_shift` / `set_adaptiveq` call `updateCoeffBuffer()`; `updatePhaseKernel` passes `tiltEqDb` into `eqpDesignPhase`. Host node red still fails on unfixed code at the Linear Phase IR-poke assertion (`node tests/test_eqplus.js`). No rewrite needed.
- **Dropped 0.**

## Pass 3 fix

- **Bug 1 fixed** — `set_tilt_eq` (`src/eqplus_ui.js`) now calls `updateCoeffBuffer()` instead of only `emitTilt()` + redraw. `updateCoeffBuffer` already re-emits tilt and redesigns the Linear/Natural phase kernel via `updatePhaseKernel` → `eqpDesignPhase(..., tiltEqDb)`, matching `set_shift` / `set_adaptiveq`.
- Touchpoint: `src/eqplus_ui.js` `set_tilt_eq` (was `emitTilt()`; now `updateCoeffBuffer()`).
- Rebuilt `devices/EQ+.amxd`.
- Host gate green: `npm run -s typecheck && python3 scripts/build_eqplus.py && node tests/test_eqplus.js` — EQ+ tests passed (2763 checks).
- Commit SHA: recorded in the Pass 3 commit on `bugsweep/eqplus-pass1` (see final summary / `git log -1`).

## Pass 4 review (approve)

- **Bug 1 — APPROVED.** Production fix is the one-line `set_tilt_eq` change (`emitTilt()` → `updateCoeffBuffer()`); no drive-bys. `updateCoeffBuffer` still `emitTilt()`s then `updatePhaseKernel()` → `eqpDesignPhase(..., tiltEqDb)` for curves A/B, matching `set_shift` / `set_adaptiveq`. Red test kept and still asserts Linear + Natural IR redesign on automation. Host gate re-run green: `npm run -s typecheck && python3 scripts/build_eqplus.py && node tests/test_eqplus.js` — EQ+ tests passed (2763 checks). Tip after this note: see `git log -1`.

# Amp+ variants — Pass 1 bug hunt (bugsweep/ampplus-variants-pass1)

## Verdict

**1 credible bug found.** Red test added in `tests/test_ampplus_bugsweep.js`
(expect FAIL on current HEAD). Production code is intentionally untouched in
pass 1.

- Worktree: `/private/tmp/bugsweep/ampplus-variants`, branch
  `bugsweep/ampplus-variants-pass1`.
- Devices in scope: `devices/Amp+.amxd` plus the five locked-face variants
  (`Amp+ Wave/Pulse/Tiles/Strip/Mono.amxd`), all built by
  `scripts/build_ampplus.py`.

## Bug 1: Scope buffer uses `#0-ampscope` (not instance-isolated in Live)

### Symptom
Every Amp+ instance in a Live Set shares one scope ring / header. With
`scopeon 1` the gen pokes envelope, peak and the 24-sample waveform into
`buffer~ #0-ampscope`; the face polls it every 33 ms for meters, traces,
spokes, tiles and the level disc. Two (or more) Amp+ devices therefore
corrupt each other's meters and waveform displays.

### Evidence
- `scripts/build_ampplus.py:190` — `sc.message("obj-msg-buf", "#0-ampscope", ...)`
  (loadbang name fed to `prepend scope` / `prepend set_scope`).
- `scripts/build_ampplus.py:194` —
  `sc.newobj("obj-scope", "buffer~ #0-ampscope @samps 32", ...)`.
- `src/ampplus_core.genexpr` — `Buffer scope("ampscope")` rebound on loadbang
  via `scope <name>`; the collision is the patcher-side name, not the GenExpr
  external default.
- `AGENTS.md` §30 still documents `buffer~ #0-ampscope` as the contract.
- Same class already fixed elsewhere: Multiband Split migrated
  `#0-splitscope` → `---mbsplitscope` because "Live does not expand `#0` in a
  device's top-level patcher (AGENTS 15)"; Glitch / Delay+ / Spectral Split
  use `---` names and assert no literal `#0` in box text / v8ui script
  (`tests/test_glitch.js`, `tests/test_mbsplit.js`).
- `tests/test_ampplus.js` never asserts `---` isolation or rejects
  `#0-ampscope`.

### Red test
`tests/test_ampplus_bugsweep.js` — for each of the six `.amxd` files:
`obj-scope.text === "buffer~ ---ampscope @samps 32"`,
`obj-msg-buf.text === "---ampscope"`, and no box text matches `#0-ampscope`;
plus the same constraints on `scripts/build_ampplus.py`.

### Fix direction (do **not** apply in pass 1)
In `scripts/build_ampplus.py` replace `#0-ampscope` with `---ampscope` in the
`buffer~`, the loadbang message, and any bind strings; rebuild all six
devices; update `AGENTS.md` §30. GenExpr `Buffer scope("ampscope")` can stay
(rebound by `scope ---ampscope`, same pattern as Glitch).

## Audited and cleared

### Z-order / ignoreclick vs live.* controls
Hypothesis that `obj-viz-bg` (full-bleed `ignoreclick` drawing canvas) sat
after the `live.*` dials and covered them. Probe of all six `.amxd` files:
`obj-viz-bg` at `boxes[0]`, `obj-viz` at `[1]`, `bg.ignoreclick = 1`,
`bg.background` undefined, **zero** `live.*` boxes before `obj-viz-bg`. Per
AGENTS.md rule 4 (ignoreclick exception: later in `boxes` = in front), the
ordering is correct. Not a bug.

### GenExpr / tone-stack / cabinet core
`src/ampplus_core.genexpr` read in full. Existing `tests/test_ampplus.js`
covers single-return lint, no `e<digit>` identifiers, toneDb / volCurve,
flat/shelf biquad magnitudes, cab LP/HP/peak helpers, slew, and a short
biquad run. No new DSP defect found in pass 1.

### Presentation / look lock / overlap
Five looks (Wave/Pulse/Tiles/Strip/Mono) validated by `test_ampplus.js`
(`ampLookProblems`, baked `ampLookLock`, no `live.*` overlap with
`obj-viz`'s click target). Variant devices lock Look to one face. Cleared.

### Integer > 255 automatable params / theme / state
No `parameter_type` integer knobs above 255 spotted in the Amp+ build path;
theme menus come from `spectral_common`; no `getvalueof`/`setvalueof` blob
beyond the normal Live parameter set. Cleared for pass 1.

## Commands run (pass 1)
- `git merge --ff-only main` on `bugsweep/ampplus-variants-pass1` (clean).
- Host reads of `src/ampplus_{ui,looks,core,models}.*`,
  `scripts/build_ampplus.py`, `tests/test_ampplus.js`, `AGENTS.md` §30.
- Z-order probe script over all six `.amxd` (see above).
- `node tests/test_ampplus_bugsweep.js` — expected RED on current HEAD
  (run after this file lands).

## Pass 2 review — KEEP

**Kept 1 / dropped 0.**

Bug 1 is a real multi-instance functional bug (shared scope ring corrupts
meters/waveforms across Amp+ instances in one Set), not a nit or harness-only
issue. Pass-2 checks:

1. **Top-level patcher name** — `scripts/build_ampplus.py` emits
   `buffer~ #0-ampscope @samps 32` and loadbang message `#0-ampscope`, wired to
   gen (`prepend scope`) and face (`prepend set_scope`). Same class as devices
   that already migrated: Live does not expand `#0` in a top-level device
   patcher (AGENTS Multiband Split / Glitch / Delay+).
2. **Face + gen bind that name** — `src/ampplus_ui.js` `set_scope`,
   `src/ampplus_core.genexpr` `Buffer scope("ampscope")` rebound on loadbang;
   collision is the patcher-side name, not the GenExpr default.
3. **Red fails on HEAD** — `node tests/test_ampplus_bugsweep.js` →
   AssertionError: got `buffer~ #0-ampscope @samps 32`, expected
   `buffer~ ---ampscope @samps 32`.

Red test left as-is (already asserts all six `.amxd` + build source). Production
/ `src` / build untouched (pass 3 applies `---ampscope`). No new bugs found;
pass-1 cleared items stand.

### Commands run (pass 2)
- Re-read build scope wiring; grep Amp+/AGENTS for ampscope / `#0` / `---`.
- `node tests/test_ampplus_bugsweep.js` — RED (confirmed).
- Host gate: `npm run -s typecheck && python3 scripts/build_ampplus.py && node tests/test_ampplus.js` (in flight / next).

## Pass 3 fix

**Bug 1 fixed.** Renamed scope buffer `#0-ampscope` → `---ampscope` so each Amp+ instance gets its own ring (Live does not expand `#0` in a top-level M4L patcher).

### Touchpoints
- `scripts/build_ampplus.py` — `obj-msg-buf` loadbang message and `obj-scope` `buffer~` text (`#0-ampscope` → `---ampscope`).
- Rebuilt all six devices: `devices/Amp+.amxd` plus Wave/Pulse/Tiles/Strip/Mono.
- `AGENTS.md` §30 — contract updated to `buffer~ ---ampscope`.
- GenExpr `Buffer scope("ampscope")` left as-is (rebound on loadbang via `scope ---ampscope`, same pattern as Glitch).

### Host gate (green)
`npm run -s typecheck && python3 scripts/build_ampplus.py && node tests/test_ampplus.js && node tests/test_ampplus_bugsweep.js` → typecheck ok, six devices built, `ampplus ok`, `ampplus bugsweep ok`.

### Commit
`ccb8f79` fix(ampplus): isolate scope buffer with ---ampscope (bugsweep pass3) on `bugsweep/ampplus-variants-pass1`; no merge to main.

## Pass 4 review — APPROVED

**Approved 1 / adjusted 0.**

Bug 1 fix (`#0-ampscope` → `---ampscope`) is minimal, correct, and matches the AGENTS.md --- isolation precedent (Delay+/Glitch/Multiband Split). Review checks:

1. **Production diff** — `scripts/build_ampplus.py` is a pure two-site rename (`obj-msg-buf` + `obj-scope`); no drive-by refactors.
2. **AGENTS.md §30** — contract updated to `buffer~ ---ampscope`.
3. **GenExpr intentional** — `Buffer scope("ampscope")` left as-is; rebound on loadbang via `scope ---ampscope` (same pattern as Glitch).
4. **Tests not weakened** — `tests/test_ampplus_bugsweep.js` still requires `---ampscope` on all six `.amxd` + build source and still rejects `#0-ampscope`.

### Host gate (green)
`npm run -s typecheck && python3 scripts/build_ampplus.py && node tests/test_ampplus.js && node tests/test_ampplus_bugsweep.js` → typecheck ok, six devices built, `ampplus ok`, `ampplus bugsweep ok`.

### Tip
`d934a76` on `bugsweep/ampplus-variants-pass1` before this Pass-4 docs commit; no merge to main; worktree kept.

# Percipitator — Bug Sweep Pass 1 (red tests only, no fixes)

- Device: `devices/Percipitator.amxd`
- Branch: `bugsweep/percipitator-pass1` (from HEAD `66fea67`)
- Worktree: `/tmp/bugsweep/percipitator`
- Scope: read AGENTS.md §9 + all Percipitator src/scripts/tests; hunted logic, param
  range/default/mapping, state, gen-vs-JS mirror and UI-binding bugs. No production code changed.
- Baseline before adding tests: `node tests/test_percipitator.js` → `test_percipitator: ok` (exit 0).

## Bug 1 — Partial Sieve gains diverge between the gen core and its JS mirror (all non-All modes)

`src/percipitator_config.js:103` `computeSieveGain` is documented as matching the gen
(`Per-band Partial Sieve gain multiplier matching sieve_gain() in src/percipitator_core.genexpr`),
and the face uses the JS values to shade muted lanes (`src/percipitator_ui.js:626`, threshold
`sWeight < 0.25`) and to weight the demo state (`src/percipitator_ui.js:96`). The audio path uses
`sieve_one` in the gen. They do not match:

| Mode | Gen (`src/percipitator_core.genexpr:72-75`) | JS (`computeSieveGain`) |
|---|---|---|
| Odd (1), attenuated bands | 0.06 | 0.08 |
| Even (2), attenuated bands | 0.06 | 0.08 |
| Sprs (3), every-3rd boost | 1.18 | 1.15 |
| Sprs (3), attenuated bands | 0.03 | 0.04 |
| Rise (4) | `0.22 + 0.98 * (b / 15)` (0.22 → 1.20) | `0.25 + 0.95 * (b / 15)` (0.25 → 1.20) |

Effect: with any sieve mode except All, the partial gains the user hears differ from the gains
the face displays/uses (e.g. Rise band 0 is shaded as exactly at the 0.25 mute threshold in JS
while the gen applies 0.22; Sprs droplets are boosted 1.18x in audio but 1.15x in the mirror).
One side is wrong; pass 1 only proves the divergence. The pre-existing tests only asserted the
JS side loosely (`< 0.1` attenuation, Sprs band 0 exactly 1.15), so this escaped.

Red test: `tests/test_percipitator.js` block 7 (line 435) — extracts the constants from
`sieve_one` in the gen source, reconstructs the gen gains, and asserts
`cfg.computeSieveGain(b, m)` equals them for all 16 bands × 5 modes.

Red output (`node tests/test_percipitator.js`, exit 1):

```
AssertionError [ERR_ASSERTION]: Sieve mirror mismatch band 1 mode 1: JS 0.08 vs gen 0.06
    at Object.<anonymous> (/private/tmp/bugsweep/percipitator/tests/test_percipitator.js:462:20)
```

## Bug 2 — Gen procedural fallback triangle wave is inverted

When the wavetable buffer reads empty (`hasWt == 0`, `src/percipitator_core.genexpr:259-266` —
e.g. before the first wavetable poke lands), `voice_osc` synthesizes the four shapes
procedurally. Its triangle term (`src/percipitator_core.genexpr:262`)

```
pTri = 1.0 - 4.0 * abs(wrap(wPh - 0.25, 0, 1) - 0.5);
```

evaluates to **-1 at phase 0.25 and +1 at phase 0.75**. The canonical Triangle frame it
substitutes for peaks at +1 at 0.25 and troughs at -1 at 0.75
(`src/percipitator_config.js:167`: "phase-aligned with sine: rises 0..0.25, falls 0.25..0.75";
verified from `generateStandardWavetable()`: frame 1 sample 512 = +0.98, sample 1536 = -0.98).
The fallback sine and saw terms do align with their frames (saw starts high and ramps down,
matching the sine-series frame), so this is a one-sign error in the triangle term only:
any Wave morph position that blends through the Triangle frame is phase-flipped (half-cycle
shifted) whenever the fallback path is active. The fix direction is `wrap(wPh + 0.25, 0, 1)`
(not applied — pass 1 is red tests only).

Red test: `tests/test_percipitator.js` block 8 (line 470) — pins the canonical frame from
`generateStandardWavetable()`, extracts the `pTri` expression from the gen source, evaluates
it with a JS `wrap`/`abs`, and asserts 0 / +1 / 0 / -1 at phases 0 / 0.25 / 0.5 / 0.75.
The suite stops at Bug 1s assertion first; the identical extraction evaluated standalone gives:

```
pTri(0)=0 pTri(0.25)=-1 pTri(0.5)=0 pTri(0.75)=1
```

## Checked — no credible bug found

- Parameter ranges/defaults: build `PARAM_SPECS` (`scripts/build_percipitator.py:41-90`), gen
  `Param` defaults and `clip` ranges, UI setter clamps and UI defaults all agree with AGENTS.md
  §9 (Pitch ±24, Shift ±2000 Hz, Stretch 50–200%, Decay 1–1500 ms, Attack 0.2–100 ms,
  Wave init 0, Warp init 50, Tilt ±100%, Vol −36..+18 dB, Mix init 100 → `wet`).
- Mirrors that do match exactly: tilt (`pow(2, t * pos * 6.0)`, ±36 dB), scale quantizer
  (search ±11, strict-`<` tie-break, snap mix, mask-0 passthrough), warp Bend/Asym/Sync/Fold,
  band frequency table (`band_hz` vs `BAND_FREQS`).
- Enum wiring: Mode (Bend/Asym/Sync/Fold) and Sieve (All/Odd/Even/Sprs/Rise) reach the gen via
  `prepend wtmode`/`prepend sieve` unscaled and the face via `set_wtmode`/`set_sieve`; percent
  params are scaled exactly once (`* 0.01` boxes shared by the control and viz-route paths).
- Sidechain MIDI: `midiin → midiparse` outlet 0 → `prepend midi_in` → face; chord latch and
  `computeMidiChordState` behave as tested; scale-strip toggling, `set_scalemask` and
  `setvalueof` all refuse a zero mask (so the `0 → 0xFFF` case in `setvalueof` is a deliberate
  guard, not a round-trip bug).
- Gate: drag inversion `vis01ToDb` bisects the same `ampToVis01` curve the line is drawn with
  (already covered by the click-on-the-line test); `pcpDspResend` re-sends every gen parameter
  in gen units (freeze is hard-sent 0, consistent with the deliberately removed Freeze control).
- Build assembly order (config → GEN_DSP vars → dsp → ui), probe scope slots (33 active,
  16+3 MIDI), nested-`return` guard, and the Freeze/silence-sleep behaviour (covered by
  `run_percipitator_audio_tests.py` cases `freeze_hold`/`freeze_off`/`sleep_silent`/`sleep_wake`).

## Commands

```bash
node tests/test_percipitator.js   # baseline: ok (exit 0); with the new tests: exit 1, Bug 1 assertion above
git -C /tmp/bugsweep/percipitator status   # only tests/test_percipitator.js modified + BUGS.md added
```

## Pass 2 review

Reviewed both claimed reds against live source (`computeSieveGain` / `sieve_one`, `pTri` / `generateStandardWavetable` + UI call sites). Both are real functional bugs; neither dropped.

1. **Kept** — Partial Sieve gains diverge between gen audio path and JS mirror used for UI shading / demo weighting. Host test fails at block 7: `Sieve mirror mismatch band 1 mode 1: JS 0.08 vs gen 0.06` (exit 1).
2. **Kept** — Gen procedural fallback triangle (`pTri`) is phase-inverted vs the canonical Triangle wavetable frame (+1 at 0.25 / -1 at 0.75). Block 8 pins the frame and asserts the fallback; standalone evaluation gives `pTri(0.25)=-1`.

Dropped: 0. No production/src edits (pass 3). Strengthening not needed — both reds already fail on unfixed code.

## Pass 3 fixes

Host gate green: `npm run -s typecheck && python3 scripts/build_percipitator.py && node tests/test_percipitator.js` → `test_percipitator: ok (408x169 Concept 3 verified)` (exit 0).

1. **Bug 1 — Sieve mirror** — Aligned JS `computeSieveGain` (`src/percipitator_config.js`) to gen `sieve_one` constants: Odd/Even atten `0.08`→`0.06`, Sprs boost `1.15`→`1.18` / atten `0.04`→`0.03`, Rise `0.25+0.95*(b/15)`→`0.22+0.98*(b/15)`. Comment now says `sieve_one`. Updated the pre-existing Sprs band-0 pin in `tests/test_percipitator.js` from `1.15`→`1.18` (outdated mirror value; block 7 gen-extraction red left intact).
2. **Bug 2 — Inverted pTri** — `src/percipitator_core.genexpr` fallback triangle: `wrap(wPh - 0.25, 0, 1)` → `wrap(wPh + 0.25, 0, 1)` so phase 0.25 = +1 / 0.75 = −1 matching the wavetable frame.

Rebuild: `devices/Percipitator.amxd` regenerated (408×169). Commit SHA recorded in the pass-3 commit on `bugsweep/percipitator-pass1` (see git log; do not merge to main).

## Pass 4 review

APPROVED. Live re-check of gen `sieve_one` vs JS `computeSieveGain` and of `pTri` vs the Triangle wavetable frame; host gate green.

1. **Bug 1 — Sieve mirror** — APPROVED. JS constants match gen exactly (Odd/Even atten 0.06, Sprs 1.18/0.03, Rise 0.22+0.98*(b/15)); Sprs band-0 pin 1.15→1.18 is mirror-value sync only; Block 7 gen-extraction red left intact. Minimal — JS aligned TO gen, no drive-by.
2. **Bug 2 — Inverted pTri** — APPROVED. `wrap(wPh + 0.25, 0, 1)` yields +1 at phase 0.25 / −1 at 0.75, matching `generateStandardWavetable` frame 1. Minimal one-sign fix in the fallback path.

Host gate: `npm run -s typecheck && python3 scripts/build_percipitator.py && node tests/test_percipitator.js` → `test_percipitator: ok (408x169 Concept 3 verified)` (exit 0). Tip before this docs commit: `dd6880a` on `bugsweep/percipitator-pass1`. Do not merge to main; do not delete the worktree.

# Delay+ / Delay+ End — Bug Sweep (Pass 1 findings, Pass 2 review)

Worktree: `/tmp/bugsweep/delayplus` · Branch: `bugsweep/delayplus-pass1` · Base: `66fea67`
Scope: `devices/Delay+.amxd` + `devices/Delay+ End.amxd` — `src/delayplus_config.js`,
`src/delayplus_link.js`, `src/delayplus_start.genexpr`, `src/delayplus_end.genexpr`,
`src/delayplus_ui.js`, `src/delayplus_dsp.js`, `src/delayplus_end_ui.js`,
`src/delayplus_filter.js`, `src/delayplus_lfo.js`, `src/delayplus_spectrum.js`,
`src/delayplus_clipled.js`, `src/delayplus_clipcurve.js`, `src/delayplus_notedial.js`,
`src/delayplus_viz_b.js`, `scripts/build_delayplus.py` (parameter table),
`scripts/run_delayplus_audio_tests.py` (case list), `tests/test_delayplus.js`.
Max / Live were NOT run in this pass (the Node gate below is the only run; the two bugs
are in code paths the Max harness cases cannot see, see Bug 1).

## Pass 2 review — kept 2 / dropped 0

Re-read `delayplus_end.genexpr` (K calib), `delayplus_start.genexpr` (`pR`), and
`delayplus_lfo.js` `paint()`. Host gate: `node tests/test_delayplus.js` → 37 passed,
2 failed (only the two reds below). No production/src edits in this pass.

- **Kept Bug 1** — real DSP: comment requires the same K twice in a row; `kCand` is
  cleared only on `!alive`, so a failed window leaves a banked candidate and a later
  single accept adopts a wrong K (dry offset + feedback B).
- **Kept Bug 2** — real UI: gen advances R by Phase (`pR = wrap(lfo + phase/360)`);
  paint subtracts (`ph = … - off`). At Phase 90 the red test gets the exact sign-flipped
  y (73.4 vs 8.6); live dots plot real `LFO_R`, so they leave the drawn curve.

## Pass 3 — fixes applied (host gate now 39 passed, 0 failed)

Both Pass-2 kept reds fixed with minimal source changes; no tests weakened or deleted.
Host gate: `npm install && npm run -s typecheck && python3 scripts/build_delayplus.py && node tests/test_delayplus.js` -> 39 passed, 0 failed.

- **Bug 1 fixed** — `src/delayplus_end.genexpr`, K calibration window (the `if (cN >= 8192)` block): added an `else { kCand = 1e9; }` on the acceptance `if`, so any calibration window that does not adopt clears the pending candidate; adoption again requires two consecutive accepted windows with the same lag. Red "K calibration: a candidate must be seen twice in a row (a failed window clears it)" is now green.
- **Bug 2 fixed** — `src/delayplus_lfo.js` `paint()` per-point loop: changed the right-channel phase from `ph = k / N * cyc - off` to `ph = k / N * cyc + off`, matching the gen which advances R by Phase (`pR = wrap(lfo + phase/360)`); the drawn right waveform and the live `LFO_R` dot now agree at every Phase. Red "LFO display: the right waveform is drawn at the phase the gen applies (R = LFO + phase)" is now green.

## Pass 4 — final review (ADJUSTED)

Re-read Pass-3 diffs vs `main`, the K-calib window in `delayplus_end.genexpr`, gen `pR` in `delayplus_start.genexpr`, and `delayplus_lfo.js` `paint()`. Host gate after the follow-up: `npm run -s typecheck && python3 scripts/build_delayplus.py && node tests/test_delayplus.js` → 39 passed, 0 failed. No tests weakened. No merge to main.

- **Bug 1 — APPROVED** — `else { kCand = 1e9; }` on the acceptance `if` inside `if (cN >= 8192)` is minimal and correct: a rejected window clears the pending candidate so adoption again needs two consecutive accepted lags. (Note: `reverbplus_end.genexpr` still lacks this `else` clear — out of scope for this worktree; Delay+ is ahead.)
- **Bug 2 — ADJUSTED** — Pass-3 correctly flipped the main per-point phase to `+ off`, but left the discontinuity edge helper at `(k - 1) / N * cyc - off` (square/saw/noise vertical edges). Pass 4 changed that site to `+ off` as well so every paint path matches gen `pR = wrap(lfo + phase/360)`. Devices rebuilt.

## Bug 1 — End K calibration: a candidate does not have to be seen twice IN A ROW

**Severity:** wrong K, adopted silently and persistently: the dry signal is read at the
wrong Start offset in the End and Start re-inserts the feedback return at the wrong
position (B = Smax − K), so echoes drift off n · T and the dry/wet alignment shifts
until a later pair of agreeing windows happens to re-calibrate.

### Mechanism

- `src/delayplus_end.genexpr`, K calibration block: every 8192 samples the End
  cross-correlates its whitened chain output against the whitened tap (xfer ch4) for
  128 candidate lags around the counter anchor. The stated adoption rule, in the code
  comment and AGENTS.md §15, is: a peak is adopted only when it is strong
  (normalised > 0.4), unambiguous (1.5× the runner-up), inside the window — and
  **the same K twice in a row** (`if (cand == kCand) { kCal = cand; calOk = 1; }`,
  then `kCand = cand;`).
- `kCand` (the seen-once candidate) is cleared in exactly one place: the
  `if (!alive)` block, when the Start counter stops. A window that FAILS the
  acceptance criteria — silence (energies below threshold), tonal input (ambiguity
  check), or a peak at the window edge — leaves `kCand` untouched, and so does a
  window whose best lag is a different value that also fails.
- Consequence: one spurious accepted peak (a transient, a chain device being toggled,
  a burst of noise) is banked indefinitely. Minutes later, a single ordinary window
  whose best lag equals the banked value adopts it as K — not two in a row in any
  meaningful sense. `calOk` then keeps that K (`kk = calOk ? kCal : anchor`) until
  another value manages two consecutive accepted windows.
- The Max audio harness cannot catch this: its cases use a fixed `delay~ L` chain, so
  calibration succeeds immediately and stays put; no case injects a failing window
  between two agreeing ones.

### Red test

`tests/test_delayplus.js`, new test "K calibration: a candidate must be seen twice in
a row (a failed window clears it)": structural, in the style of the existing gen
source checks in the same file (frame counter position, CLIP_DB on the tick). It
slices the window-evaluation block (`if (cN >= 8192)` … `kk = calOk`) of
`src/delayplus_end.genexpr` and requires a `kCand = 1e9` reset inside it, i.e. a
window that does not adopt must drop the pending candidate.

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

### Fix direction (NOT applied in Pass 1)

Clear `kCand` at the end of every calibration window that did not adopt (an `else`
on the acceptance `if`, or an unconditional reset after the adoption check), so
adoption again requires two consecutive accepted windows with the same lag.

## Bug 2 — Modulation page draws the right LFO with the phase sign flipped

**Severity:** display-only, but the display contradicts the device: with Mod Phase
set to anything but 0 or the 180° default, the orange right-hand waveform on the
Modulation page is drawn 2 × phase away from the LFO the device is actually
applying, and the live dot (which plots the real value) does not sit on the drawn
curve.

### Mechanism

- Gen (authoritative, it makes the sound): `src/delayplus_start.genexpr` computes
  the right LFO phase as `pR = wrap(lfo + clip(phase, 0, 360) / 360, 0, 1)` — the
  right channel is ADVANCED by Phase — and pokes the resulting `lR` to scope
  `LFO_R` every 64 samples.
- Display: `src/delayplus_lfo.js` `paint()` builds the two channels as
  `chans = [[C_L, 0], [C_R, pOff]]` with `pOff = phase / 360`, then evaluates each
  point as `ph = k / N * cyc - off` — MINUS the offset for the right channel.
- At the default Phase 180 the error is invisible (`sin(θ + π) == sin(θ − π)`), and
  at Phase 0 there is no offset; at Phase 90 the drawn right curve is a full 180°
  from the applied LFO whose value the page live dot shows from `DP_SCOPE.LFO_R`.

### Red test

`tests/test_delayplus.js`, new test "LFO display: the right waveform is drawn at the
phase the gen applies (R = LFO + phase)": vm-executes the real scripts
(`delayplus_config.js` + `delayplus_lfo.js`, the Filter Display test pattern) with a
recording mgraphics stub, sets Phase 90 / sine / no mod depth, calls `paint()`, and
checks the recorded right waveform against `sin(2π(ph + 0.25))` through the script
own `lfoY` geometry (wh 80, amp 0.9: y = 41 − v · 32.4).

```
FAIL LFO display: the right waveform is drawn at the phase the gen applies (R = LFO + phase): right LFO at ph 0 sits at its +90 degree value expected 8.600000000000001 got 73.4
```

(73.4 is exactly the sign-flipped value, confirming the diagnosis rather than a
harness artefact.)

### Fix direction (NOT applied in Pass 1)

Draw the right channel with `ph = k / N * cyc + off` in `paint()` (equivalently pass
the offset with the gen sign), so the curve and the live dot agree at every Phase.

## Commands and results

```
cd /tmp/bugsweep/delayplus && node tests/test_delayplus.js
→ 37 passed, 2 failed — the only failures are the two new tests above.
```

(The build step of the AGENTS gate was not run: rebuilding would rewrite the
shipped `.amxd` files, and Pass 1 commits only tests + this file. The pre-existing
device-structure tests read the `.amxd` files from the checkout and pass.)

## Audited, no credible bug found

- **Config math** (`delayplus_config.js`), partly by Node property probes run during
  the sweep: `dpPitchFolded` agrees with the folding `dpSideMs` actually performs for
  all 128 notes × five tank minima; `dpSideWarn` printed MIN/MAX multipliers make the
  Sync time fit when applied, and its Pitch MAX note is the highest non-folding note
  across offset/cents combinations; `dpDivSnap` always returns an offered value and
  is idempotent for every Triplet/Dotted switch combination; division enum sorted,
  LFO sync beats match the build `LFO_DIVS` names.
- **Pairing and latency (LOM)**: `dpFindPartner` bracket matching, `dpChainLatency`
  strictly-between sum, `dpDeviceLatency` longest-chain recursion, registry staleness
  (3 s) and the link poll (partner rebind for the End, `hdr[30]` poke for the Start,
  unpaired rebind to own buffers) all match AGENTS.md §15.
- **Transfer protocol in the gens**: Smax held max over the current + 3 windows,
  B = clip(Smax − K, 1, 8192) with the unpaired fallback, return read at End index
  `cn − Smax`, reinsertion at `cn − B − L − dTot`, dry read at `cE + K − L`, the
  2048-sample duck on any L/B/K change — all as specified.
- **Feedback path**: diffusion allpasses are true Schroeder allpasses whose per-side
  lengths sum exactly to `dTot`; freeze latches whole-sample periods, fades the chain
  return out with `ig`, and at full freeze the return slot is written back unchanged
  (no clip, no drift); the feedback soft clip on the return and the tank clip laws
  (Soft linear to 0.8 T then tanh to T, Hard, linked Limit) match the Options page
  text and the clip-curve display formula.
- **Echo DSP additions**: M/S encode/decode of input, return and tap are consistent
  inverses; Ping Pong swaps the return and mono-feeds the left tank; ducking gain in
  the End simplifies to the documented 2 dB-per-dB, 24 dB-capped law (also covered by
  an existing test); equal-power Dry/Wet matches its spec.
- **Parameter mapping**: every `P` entry in `scripts/build_delayplus.py` maps to the
  gen Param of the same name with the correct scale (`/100` exactly for the percent
  parameters), and the UI-only parameters (times, LFO rate) are the ones the face
  pokes into `hdr[27/28/31]`; `DP_GEN_PARAMS` resend after deferred DSP load covers
  every hub prepend (also covered by an existing test).
- **Load / idle**: deferred-DSP claim queue, 150 ms resend until the scope frame
  counter moves, settle resend, and the ring sleep logic in `dpFrame` match AGENTS
  §15 / 1d. (One judgement call left alone: after a DSP confirm timeout the face
  never retries creation because `createdAt` stays set — it does surface DSP FAILED
  and matches the shared pattern, so it is recorded here, not filed as a bug.)
- **`dpMinTimeSamples` / `dpEffectiveTimes`** use a simplified B + L + mod + 4
  minimum that omits the gen terms for diffusion (`dTot`) and wobble — but nothing in
  the device calls them (the face folds and warns from the gen-reported scope TMIN),
  so the difference is test-model only and not user-visible. Not filed.
- **Filter Display / spectrum / clip LED / note display**: spectrogram ring is
  re-linearised oldest-first from the poked head, box-select and joint drag match the
  existing test, `fdMag` gives 1/k at each cutoff, the clip LED hold/fade via
  `dpClipStep` matches the ~1 s spec, and the MIDI note display is display-only as
  documented.

# Bug sweep — Transient Split (transplit), Pass 4 (review)

Worktree: `/tmp/bugsweep/transplit` · Branch: `bugsweep/transplit-pass1` · Base: `66fea67`
Pass 3: fixed 1 / remaining 0. Bug 1 fixed — GenExpr tilt-gain cache now keys on sample rate (`cgSr`), mirroring `twSr`. Host gate green.
Pass 4: **APPROVED** — no code changes. Fix is minimal, correct, and matches the existing History cache-key pattern; red test unchanged and green; no drive-by refactors.
Scope: `devices/Transient Split.amxd` + `.adg`, `src/transplit_*`, `src/spectral_*`,
`scripts/spectral_common.py`, `scripts/build_transplit.py`, and the transplit/spectral tests.
Method: applied the pass-2 fix direction in `ts_masks`; re-ran the host gate until green.

## Bug 1 — Tilt gains go stale on a sample-rate change (GenExpr only) — FIXED

**Where:** `src/transplit_core.genexpr`, `ts_masks()` — the per-bin tilt-gain cache in
`tw` channel 2, keyed on the function-local History `cgTl / cgMd / cgN / cgW` (and now `cgSr`).

**Mechanism:** The gains were rebuilt only when tilt, tilt mode, FFT size `n`, or `cgW`
changed, where `cgW` is compared against `tw.peek(1, md)` — the tilt weight at **bin 1**,
used as a cheap probe for "the tilt table changed". But bin 1 is in the clipped region of
the table for every common configuration: its frequency `max(sr/n, 20)` is below 100 Hz
for sample rates 44.1-96 kHz at `n >= 1024`, so
`u = clip(log(f/100)/log(100), 0, 1) = 0` and the weight is pinned at -1 (Standard) /
+1 (Contour) regardless of sample rate. A sample-rate change rebuilt the tilt *table*
(the ctl hook in the same file tracks `twSr` and re-runs `ts_tilttab` for exactly this
case) but did **not** invalidate the cached *gains*, which were computed from the old
table. The wrong gains persisted until tilt, mode or size happened to change.

**Effect:** With Tilt non-zero, switching Live's sample rate (e.g. 44.1 <-> 48 <-> 96 kHz)
left the Transients/Tones tilt gains computed for the previous rate indefinitely.
Worked example (n = 1024, bin 64, Tilt = +1, Standard): weight 0.440 at 44.1 kHz vs
0.778 at 96 kHz, i.e. gain 1.837 vs the correct 2.930. The JS reference
(`cfg.tsMasks`) recomputes `exp(tl * 12 * w[k])` from the fresh table every frame, so
this was also a JS-vs-GenExpr mirror divergence.

**Red test (now green):** `tests/test_transplit.js`, section 2, "tilt gains follow the sample rate"
(drives `ts_tilttab` at 44100, one `ts_masks` frame, `ts_tilttab` at 96000 — exactly what
the ctl hook does on a rate change — then asserts `tw` channel 2 at bin 64).

**Fix applied (pass 3):** Added `History cgSr(0)` alongside the other `ts_masks` cache-
history vars, and included `cgSr != sr` in the rebuild condition with `cgSr = sr` inside
the rebuild block — mirroring the existing `twSr` pattern in the ctl hook. Keying on `sr`
invalidates the gains when the sample rate changes even though bin 1 stays clipped.

Touchpoints:
- `src/transplit_core.genexpr` — `History cgSr(0)` next to `cgW` in `ts_masks`
- `src/transplit_core.genexpr` — rebuild condition `... || cgSr != sr`; assign `cgSr = sr` in the rebuild block
- `tests/test_transplit.js:415` — assertion now passes (test left unchanged)

Commit SHA: `17d4b1b1347fd049e909e0a41e83c3d16b022416`

## Examined, no credible bug found

- Mask maths constants and helpers: JS named constants vs GenExpr literals (history
  rise/fall 0.014/0.040 s, onset 4.5 + 5.5 dB with bias 12, deviation 0.10/0.30 with bias
  0.12/0.27, tilt 12 dB, blend `min(1,2b)` / `min(1,2(1-b))`, smoothstep) — identical.
  Tilt tables (`tsTiltTables` vs `ts_tilttab`) — identical, incl. `log(100)` literal.
- Rack template reader/writer: signed centred counter differences (`ss2_wd`), slot
  arithmetic (`ss2_slot`), gap fade (256 in / 512 out), follower validity window
  (64 < age < RS-64), underrun -> fbk 3, `muteLeft = n + 128` restart muting with ring
  writes continuing so followers stay aligned — coherent.
- Serve/election: JS serve mask `(1<<K)-1` in a rack, gen `eserveH` forcing the own bit
  (`2^(selH-1)`, or bit K for All), `sAllCh` counting only real channels, DERIVE gating,
  epoch-change resets, leader election excluding fb=1 peers and dead-reported incumbents
  — consistent between `spectral_link.js`, the template and the tests.
- Telemetry layout: template scalars at SCB+0..+17 with +5 deliberately left for the
  device mean-mask slot; `transplit_config.js` TS_SC_* constants, the core header comment
  and the face reads (`tsPoll`, wave ring `frame mod 64`) all agree. Scope buffer 800 >=
  TS_SCOPE_SAMPS 786; ring buffer = `rack_ring_samps(2)`.
- Latency: every functional use is `RACK_LATENCY` = 5120 (gen reader/dry delay, scope
  slot, build line 216, `TS_LATENCY` displayed by the face).
- Sleep path: `ZERO_COUNT = 512` clears exactly the four display arrays; scalars are
  handled by explicit pokes; the face stops drawing on `awake = 0`.
- Face interaction: slider/drag mappings for Bias, Blend, Tilt, Decay, Smoothing match
  the parameter ranges and defaults; `tsResolveSel` maps Auto/Transients/Tones/All as
  documented.

## Non-functional notes (not bugs, no tests)

- `scripts/build_transplit.py` line 8 (docstring) and line 69 (Size help text) still say
  the latency is/stays 4096; the device actually delays and reports 5120 (see above).
  Prose only — Live-facing help for Size contradicts the face's own "Latency 5120 smp".
- `src/transplit_config.js` line 133 comment describes Contour as "+1 at the mids"; the
  code (and every other comment) is -1 at the centre, +1 at the edges.

## Pass 4 review

**Verdict: APPROVED** (no production follow-up).

- **Bug 1 (`cgSr`):** Minimal three-line GenExpr change (`History cgSr(0)`, `|| cgSr != sr`,
  `cgSr = sr` in the rebuild block). Correctly mirrors ctl-hook `twSr` / `ts_tilttab`.
  Bin-1 `cgW` probe stays clipped across SR at common n, so the SR key is necessary and
  sufficient. JS `tsMasks` recomputes `exp(tl * … * w[k])` every frame (no cache) — no
  remaining mirror gap. Red test left unchanged from pass 1 and is green.
- Diff vs main is only: BUGS.md, the red test (+17), `src/transplit_core.genexpr` (+3/-1),
  and rebuilt device artifacts. No drive-by refactors; tests not weakened.
- Non-functional prose notes (latency 4096 vs 5120 help text; Contour comment sign) left
  as notes — out of scope for this bugsweep.

## Commands / results

```
npm run -s typecheck && python3 scripts/build_transplit.py && node tests/test_transplit.js
# GREEN (pass 4 re-run): All Transient Split tests passed (incl. "tilt gains follow the sample rate")
node tests/spectral_link_tests.js      # passed (via test_transplit suite)
node tests/test_spectral_rack.js       # passed
node tests/test_spectral_dsp.js        # passed
```

Pass 1 committed the red test + this file; pass 2 confirmed the bug; pass 3 applied the
`cgSr` cache-key fix in `src/transplit_core.genexpr` and turned the host gate green;
pass 4 reviewed and approved with no further code changes.

# Analyzer (+ Oscilloscope shared tap) — Bug sweep

Worktree: `/private/tmp/bugsweep/analyzer-scope` · Branch: `bugsweep/analyzer-scope-pass1` · Base: `d72ee17`
Scope: `devices/Analyzer.amxd` — `scripts/build_analyzer.py`, `src/analyzer_ui.js`, `src/analyzer_config.js`, `src/analyzer_core.genexpr`, `src/analyzer_dsp.js`, `tests/test_analyzer.js`.
Shared in-tree concern (same tap name): `scripts/build_oscilloscope.py`, `src/oscilloscope_ui.js`, `tests/test_oscilloscope.js`.
Max / Live were NOT run in these passes (Node host gate only).

## Pass 4 review — APPROVED

Reviewed Pass 3 production/build/UI/docs + red tests against AGENTS.md precedents (Multiband Split `---mbsplitscope` / harness `#0-splitscope`; Delay+ `---dpxfer`; Glitch `---` names). Fix is minimal and correct; tests were strengthened (require `---analyzerscope`, reject literal `#0` in buffer/scope/setbuffer and `#0-` in v8ui/source), not weakened. Harness probes (`analyzer_probe.js`, `oscilloscope_probe.js`) and `run_*_audio_tests.py` remaining on `#0-analyzerscope` is intentional (mbsplit precedent). No follow-up code change.

Host gate (Pass 4 re-run, tip `0c75da7`):
```
npm run -s typecheck
python3 scripts/build_analyzer.py && node tests/test_analyzer.js
python3 scripts/build_oscilloscope.py && node tests/test_oscilloscope.js
→ green (analyzer: 185580 checks; oscilloscope: 163559 checks passed)
```

Not merged to main; worktree kept for coordinator.

## Pass 3 fix — Bug 1 closed (host gate green)

Applied the Pass 1/2 fix direction: rename the shipped scope tap from literal `#0-analyzerscope` to M4L per-instance `---analyzerscope` in Analyzer and Oscilloscope production/build/UI (and AGENTS.md §28). Harness probes and `run_*_audio_tests.py` left on `#0-analyzerscope` (mbsplit precedent).

### Touchpoints

- `scripts/build_analyzer.py` — `obj-buf` / `obj-msg-scope` / `obj-msg-setbuf` → `---analyzerscope`
- `scripts/build_oscilloscope.py` — same three boxes
- `src/analyzer_ui.js` — `anBufName = "---analyzerscope"`
- `src/oscilloscope_ui.js` — `anBufName = "---analyzerscope"`
- `src/analyzer_config.js` / `src/oscilloscope_config.js` — header comments
- `AGENTS.md` §28 / Oscilloscope architecture — document `---` name
- Rebuilt `devices/Analyzer.amxd`, `devices/Oscilloscope.amxd`

### Host gate (Pass 3)

```
npm run -s typecheck
python3 scripts/build_analyzer.py && node tests/test_analyzer.js
python3 scripts/build_oscilloscope.py && node tests/test_oscilloscope.js
→ green (analyzer: 185580 checks; oscilloscope: 163559 checks passed)
```

Pass 3 fix commit: `0c75da7` on `bugsweep/analyzer-scope-pass1` (not merged to main).

## Pass 2 review — kept 1 / dropped 0

Reviewed Pass 1 reds against source, AGENTS.md precedents (Multiband Split `---mbsplitscope`, Delay+ `---dpxfer`, Glitch `---` names), and a fresh host gate run. Bug 1 is a real multi-instance isolation failure; the Analyzer red still FAILS on unfixed code. No Pass 1 claims were dropped.

**Pass 1 miss closed here:** Oscilloscope ships the same literal `#0-analyzerscope` tap but had no device-structure red. Pass 2 adds matching `---analyzerscope` / no-`#0` asserts in `tests/test_oscilloscope.js` (still under Bug 1 — same defect class, not a new root cause).

Host gate (Analyzer) before Pass 3 fix:
```
npm run -s typecheck && python3 scripts/build_analyzer.py && node tests/test_analyzer.js
→ FAIL Analyzer.amxd: scope buffer is ---analyzerscope @samps 17952
```

Oscilloscope red (after `python3 scripts/build_oscilloscope.py`):
```
node tests/test_oscilloscope.js
→ FAIL Oscilloscope.amxd: scope buffer is ---analyzerscope @samps 17952
```
(or matching scope / setbuffer / no-literal-#0 / no-#0-in-v8ui / no-#0-in-source asserts)

## Pass 1 findings — kept 1

### Bug 1 — Scope buffer ships as literal `#0-analyzerscope` (Live does not expand `#0` in a top-level device)

**Severity:** multi-instance isolation failure. Every Analyzer (and every Oscilloscope, which shares the same tap name) in a Live Set binds the same global `buffer~` / scope ring. Instances overwrite each other's header, packet ring, stereo scope ring, and FFT ring — meters, spectrogram, and scope flash or freeze incorrectly when more than one device is loaded.

### Mechanism

- `scripts/build_analyzer.py` lines 65 / 69 / 70 shipped (pre-fix):
  - `buffer~ #0-analyzerscope @samps 17952`
  - `scope #0-analyzerscope`
  - `setbuffer #0-analyzerscope`
- `src/analyzer_ui.js` line 20 defaulted `var anBufName = "#0-analyzerscope";` (embedded into the face).
- Oscilloscope mirrored the same literals: `scripts/build_oscilloscope.py` 62 / 66 / 67 and `src/oscilloscope_ui.js` line 13.
- AGENTS.md (Multiband Split §11 buffer isolation fix; Delay+ §15; Glitch / Reverb+): in Live, `#0` is **not** expanded in a device's top-level patcher (only in abstractions). Per-instance isolation requires the M4L `---` prefix (e.g. `---mbsplitscope`, `---dpxfer`).
- Harness probes (`tests/analyzer_probe.js`, `tests/oscilloscope_probe.js`, wavload) intentionally keep `#0-analyzerscope` — same pattern as `mbsplit_probe.js` using `#0-splitscope` while the device uses `---`. Those are not the bug.

### Red tests

`tests/test_analyzer.js`, device-structure block for `Analyzer.amxd`:

- Require `obj-buf` / `obj-msg-scope` / `obj-msg-setbuf` to use `---analyzerscope` (and `@samps 17952` on the buffer).
- Reject any literal `#0` in those box texts.
- Reject `#0-` in the embedded v8ui script (stripping `//` comments), so the face default cannot stay `#0-analyzerscope`.

`tests/test_oscilloscope.js` (added in Pass 2), built-device block for `Oscilloscope.amxd`:

- Same `---analyzerscope` / no-literal-`#0` / no-`#0-` in v8ui and `oscilloscope_ui.js` source asserts.

### Fix direction (applied in Pass 3)

Rename the shipped tap to `---analyzerscope` in `build_analyzer.py` (buffer / scope / setbuffer) and `analyzer_ui.js` (`anBufName`). Mirror the same rename in Oscilloscope's build + UI. Leave harness probes on `#0-analyzerscope`. Update AGENTS.md §28 which still documents the old `#0-` name.

## Audited, no credible bug found

- **AnalyzerState blob** (`anBlob` / `anFromBlob` in `analyzer_config.js` 550 / 564; `getvalueof` / `setvalueof` in `analyzer_ui.js` ~1521+): version-1 array (mask, order, specType, scopeMode, scopeTime, trigger, f1/f2/f3) with clamp/fallback; round-trip covered by existing paint/blob checks.
- **Deferred DSP**: hub `gate 1 1`, no static `gen~`, plugin~ → plugout~ pass-through, embedded `GEN_DSP_TEXT` / `GEN_DSP_HASH` — existing structure tests cover this.
- **Presentation**: 169 px height, body panel last, Live-native `max.getcolor` over stale theme bus — existing tests.
- **Config / genexpr / paint helpers**: no additional DSP or UI defects with file:line evidence beyond the `#0` isolation bug.

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

## Pass 3 fix

Date: 2026-10-25. Both kept reds fixed in production; host gate green. Tests unchanged.

- **Fixed Bug 1** (`clear_ir` resurrection): In `src/reverbplus_engine.js` `clear_ir()`, after `rpLastDropped = ""`, added `outlet(4, "")` so the IR File `live.drop` param is cleared and Live cannot replay the path on reload.
- **Fixed Bug 2** (End K calib): In `src/reverbplus_end.genexpr`, the acceptance `if` inside `if (cN >= 8192)` gained `else { kCand = 1e9; }` so a failed window clears the pending candidate (same shape as Delay+ End).
- Host gate: `python3 scripts/build_reverbplus.py` OK; `node tests/test_reverbplus.js` → 31 passed, 0 failed; `node tests/test_reverbplus_face.js` → 20 passed.

## Pass 4 review

Date: 2026-10-25. Final review of Pass-3 fixes against production diffs, red-test bodies, Delay+ End pattern, and a fresh host gate. No production adjustments.

- **Approved Bug 1** (`clear_ir` resurrection): `outlet(4, "")` after `rpLastDropped = ""` in `clear_ir()` is minimal and correct; red test still asserts Live-replay must not reload (behavioral, not weakened).
- **Approved Bug 2** (End K calib): `else { kCand = 1e9; }` matches Delay+ End acceptance-window shape exactly; structural red still requires the clear inside the window.
- Host gate: `npm run -s typecheck` OK (reverbplus-* configs included); `python3 scripts/build_reverbplus.py` OK; `node tests/test_reverbplus.js` → 31 passed, 0 failed; `node tests/test_reverbplus_face.js` → 20 passed. Tests unchanged. No merge / no worktree delete.

# Harmonic Split — Pass 1 bug sweep (bugsweep/harmsplit-pass1)

Scope: bug hunt + red tests ONLY, no fixes. Worktree /tmp/bugsweep/harmsplit at HEAD 66fea67.
Method: AGENTS.md sections 22+25 read in full; src/harmsplit_config.js (JS reference hsFrame), src/harmsplit_core.genexpr, src/harmsplit_ui.js, src/spectral_split_lib.genexpr, the rack template (spectral_split_rack_main), scripts/build_harmsplit.py and all existing harmsplit tests audited; JS-vs-genexpr fuzzing over n in {1024,2048,4096}, sr in {44100,48000}, saw/square/triangle/pulse/noise, Sens/tilt/threshold extremes, Max Harm values, and a mid-stream parameter switch.

## Pass 2 review — kept 1 / dropped 0

Re-checked BUG-1 against production sources and re-ran the host gate. No production/src edits in this pass.

- **Kept BUG-1** — real mirror/device divergence: ctl hook (`harmsplit_core.genexpr:644`) and UI paint (`harmsplit_ui.js:341`) round `hmaxp`; JS `hsFrame` (`harmsplit_config.js:261`) does not. Fractional Max Harm (>= .5) is reachable via automation / typed entry on the float control. Red `tests/test_harmsplit_maxh.js` drives the gen chain WITH ctl rounding (the real device path) and still fails on unfixed code (`AssertionError hmaxp=9.5 maxMaskDiff=1`). No rewrite needed. Rounding is device-specific (not in `spectral_split_lib.genexpr` / rack template).
- **Dropped:** none.

Host gate (Pass 2): `npm run -s typecheck && python3 scripts/build_harmsplit.py && node tests/test_harmsplit.js && node tests/test_harmsplit_face.js && node tests/test_harmsplit_paint_bounds.js` green; `node tests/test_harmsplit_maxh.js` RED as expected for the kept bug.

## Pass 3 fix — BUG-1 green

- **Fixed BUG-1** in `src/harmsplit_config.js` `hsFrame` (line 261): `hmx` on the `hmaxp >= 0.5` branch is now `hsClip(Math.round(p.hmaxp), 1, HS_MAXH)`, matching ctl (`harmsplit_core.genexpr:644` `clip(round(hmaxp), 1, 404)`) and UI (`hsMaxHarm` / `harmsplit_ui.js:341`). The `< 0.5 -> HS_MAXH` full-range branch is unchanged. Device ctl and UI were left alone (single source of truth = device rounding).
- Red `tests/test_harmsplit_maxh.js` kept as-is; now green (`All Harmonic Split Max Harm rounding tests passed`, maxMaskDiff < 1e-9 for 9 / 9.4 / 9.5 / 9.6 / 10 / 2.5 / 3.5).
- Host gate (Pass 3): `npm run -s typecheck && python3 scripts/build_harmsplit.py && node tests/test_harmsplit.js && node tests/test_harmsplit_maxh.js` green. Rebuild wrote `devices/Harmonic Split.amxd` / `.adg`.

## Pass 4 review — APPROVED

Independent re-review of `git log main..HEAD` / `git diff main...HEAD` (production/src/build focus) and re-ran the host gate on tip `a431e7f`. No production adjustments needed.

- **BUG-1 APPROVED** — one-line `hsFrame` fix in `src/harmsplit_config.js:261` is minimal and correct: `hmx = p.hmaxp < 0.5 ? HS_MAXH : hsClip(Math.round(p.hmaxp), 1, HS_MAXH)` matches ctl (`harmsplit_core.genexpr:644` `clip(round(hmaxp), 1, 404)`) and UI (`hsMaxHarm` / `harmsplit_ui.js:341`). Device ctl/UI left alone (device rounding is source of truth). Red `tests/test_harmsplit_maxh.js` kept as-is (not weakened). Diff touches only BUGS.md, device binaries, that one config line, and the new red test — no drive-by refactors; `spectral_split_lib.genexpr` / rack template untouched.
- Adjustments: none.

Host gate (Pass 4, re-run on tip `a431e7f`): `npm run -s typecheck && python3 scripts/build_harmsplit.py && node tests/test_harmsplit.js && node tests/test_harmsplit_maxh.js` green.

## BUG-1 — Fractional Max Harm: JS reference mirror does not round, device and UI do (RED TEST)

Severity: real mirror/device divergence; affects any fractional Max Harm value with fraction >= .5 (e.g. 9.5, 9.6, 2.5, 3.5), reachable because Max Harm is a float control (0..404, integer unit style) and fractional values arrive via automation / typed entry.

Evidence:
- Device path: src/harmsplit_core.genexpr ctl hook computes mxH = hmaxp < 0.5 ? 404 : clip(round(hmaxp), 1, 404) before hs_masks — it ROUNDS.
- UI paint: hsMaxHarm in src/harmsplit_ui.js also returns Math.round(hsVals.maxh).
- JS mirror: src/harmsplit_config.js sets hmx = p.hmaxp < 0.5 ? HS_MAXH : p.hmaxp with NO rounding, and the mask test compares integer h-prime against that unrounded limit (hp2 <= hmx). So for hmaxp = 9.6 the device tracks harmonics up to h-prime 10 while the mirror stops at 9.
- hsGenMessages in harmsplit_config.js sends hmaxp raw (['hmaxp', v.maxh]), so the fractional value really reaches both sides unrounded.
- AGENTS.md section 25 contract: hsFrame mirrors the genexpr line-for-line. Two of three surfaces round; the mirror is the odd one out. Pass 2 may fix either side, but they must agree; the red test pins the device (ctl-rounded) behaviour.

Why the existing suite missed it: every existing test hmaxp is an integer (0, 4, 8, 12, 30, 40), and tests/test_harmsplit.js passes p.hmaxp raw straight into gx.hs_masks, bypassing the ctl hook that performs the rounding in the real device path.

Red test: tests/test_harmsplit_maxh.js (new, self-contained, existing harness idiom). It drives the gen chain WITH the ctl conversion applied and asserts mask equality (tolerance 1e-9) against cfg.hsFrame for hmaxp in {9, 9.4, 9.5, 9.6, 10, 2.5, 3.5} on a 220 Hz saw, n=2048, sr=48000. Fuzzing beforehand showed integers and 9.4 agree (~2.3e-14) while 9.5 / 9.6 / 2.5 / 3.5 diverge with maxMaskDiff = 1.0 (a full mask flip at the boundary harmonic).

Verbatim red output (node tests/test_harmsplit_maxh.js, workdir /tmp/bugsweep/harmsplit):

AssertionError [ERR_ASSERTION]: hmaxp=9.5: JS mirror vs device (ctl-rounded) masks diverge, maxMaskDiff=1
    at Object.<anonymous> (/private/tmp/bugsweep/harmsplit/tests/test_harmsplit_maxh.js:59:12)
    code: 'ERR_ASSERTION', actual: false, expected: true

Baseline (same worktree, unchanged): node tests/test_harmsplit.js passes ('All spectral rack function tests passed', 'All spectral deferred-DSP tests passed'); tests/test_harmsplit_face.js and tests/test_harmsplit_paint_bounds.js pass ('7506 extreme scenarios drawn inside their regions, no text overlap').

Shared-framework flag: none for BUG-1 — the rounding lives in the device-specific ctl hook and device-specific config/UI, not in spectral_split_lib.genexpr or the shared rack template.

## Checked and found NOT bugs (no red tests, for the record)

- hst slots 25..29 asymmetry: the genexpr hs_prep cache key (n, sr, flo, fhi, tilt) lives in hst[25..29]; the JS mirror never maintains those slots (hsNewState zeroes a Float64Array(32), hsFrame drives only indices 0..24) and keeps its prep state elsewhere. The only genexpr reader of slots 25..29 is hs_prep's own cache-validity check; no telemetry, decision, salience or mask path consumes them. Fuzz masks matched to <= 8.1e-13 across sr/n/parameter switches including a mid-stream switch, so the cache behaviour is functionally equivalent. Benign mirror asymmetry, by design; the existing suite comparing hst[0..24] is correct.
- Mask/frame math generally: 12-case JS-vs-genexpr fuzz (n 1024/2048/4096, sr 44100/48000, five waveforms, Sens 0 and 1, Max Harm 1, tilt/threshold extremes, C1-square band case, mid-stream parameter switch) showed maxMaskDiff <= 8.1e-13 apart from BUG-1's fractional-Max-Harm cases.
- Rack sharing / derived channel: sumOneH=1 is set unconditionally in the ctl hook and hs_masks does guarantee NH + A + B = 1 per bin (B clipped to 1 - A, NH = 1 - A - B), so the template deriving the last served channel as input minus the others, and the All row as pure input, is sound. spectral_link serve bits (peers > 1 -> serve 7 for the leader) match section 22/25.
- Mix: kdry 1/3 per chain in the rack, 1 for Output = All, dry delayed by the same 5120 samples; rack sum equals mix * wet + (1 - mix) * dry as documented.
- Telemetry: HS_SC_* device slots 512..520 and template scalars at 528+ agree between config, core and UI polling; build_harmsplit.py ZERO_COUNT = 528, so sleep zeroing clears columns + device slots without touching the scalars base.
- UI / face: hsGenMessages conversions (hpat = index + 1, fftn = 1024 * 2^i, sensamt = (v - 1) / 99, mixamt = v * 0.01), header-first polling, asleep-leader empty analysis, and follower-reads-leader behaviour are all covered by tests/test_harmsplit_face.js and pass.
- ss_mid / ss_apply / ss_ola / ss_cols in spectral_split_lib.genexpr: amplitude/phase algebra verified against the test reference mirror; Hermitian mask application and Hann^2 compensation consistent; column pooling never includes bin 0 or Nyquist, matching the JS side.

# Cepstra bugsweep — PASS-4 review (bugsweep/cepstra-pass1)

## PASS-4 outcome

**APPROVED** — no code adjustments. Tip before this note: `947a8b1` (fix `750abf8`).

| Bug | Verdict | One-line |
| --- | --- | --- |
| A — stale f0 / display ignores `voiced` | **APPROVE** | `job_lift` resets `voiced=0` each frame; Auto/MIDI else clear `f0v`; display `periodSamplesNow` Auto requires `voiced`; paint/Res use helper. |
| B — shared `#0-cepscope` | **APPROVE** | `---` rename in build/display/amxd + AGENTS/audio/probe; tests require `---` (not weakened). |

Host gate re-run green: `npm run -s typecheck && python3 scripts/build_cepstra.py && node tests/test_cepstra.js` → 1627; `node tests/test_cepstra_bugsweep.js` → 15. No merge to main.

---

# Cepstra bugsweep — PASS-3 fixes (bugsweep/cepstra-pass1)

Host gate green after PASS 3: `npm run -s typecheck && python3 scripts/build_cepstra.py && node tests/test_cepstra.js` → 1627 checks; `node tests/test_cepstra_bugsweep.js` → 15 checks.

**Fix commit:** `750abf8` — `fix(cepstra): PASS-3 — clear stale f0 + ---cepscope isolation`.

## PASS-3 outcome

**Fixed 2 / kept from PASS-2.**

| Bug | Status | Touchpoints |
| --- | --- | --- |
| A — stale f0 / display ignores `voiced` | **FIXED** | `src/cepstra_core.genexpr` `job_lift` Auto/MIDI `else { f0v = 0; }`; `src/cepstra_display.js` `periodSamplesNow` requires `voiced` in Auto |
| B — shared `#0-cepscope` | **FIXED** | `scripts/build_cepstra.py` + display defaults + gen comment → `---cepscope`; `tests/test_cepstra.js` asserts; rebuilt `devices/Cepstra.amxd` |

### Bug A fix notes
- Gen Auto arm: after `if (best > 0.06) { … voiced = 1; }`, add `else { f0v = 0; }` so unvoiced frames clear scope 257 while still holding `L` / `held`.
- Gen MIDI arm: after `if (midiNote >= 0) { … }`, add `else { f0v = 0; }` for note-off.
- Display: `periodSamplesNow()` Auto branch is now `curMode === 1 && voiced && f0Hz > 20`. Paint diamond / Hz label and Res drag both go through that helper, so unvoiced → period 0 → manual Res map.

### Bug B fix notes
- Renamed `buffer~` / `scope` / `setbuffer` from `#0-cepscope` to `---cepscope` (Live expands `---` per instance; `#0` does not in a top-level device).
- `tests/test_cepstra.js`: exact message asserts + buffer~ isolation check now require `---`; sandbox setbuffer/resend use `---cepscope`.
- `tests/test_cepstra_bugsweep.js`: display sandbox prepends `cepstra_config.js` (face script shape) so RED paint checks can run after genexpr is green.
- Also updated `scripts/run_cepstra_audio_tests.py` `SCOPE` (and probe/AGENTS comments) so VM audio tests bind the new name.

### Host gate
```
npm run -s typecheck && python3 scripts/build_cepstra.py && node tests/test_cepstra.js && node tests/test_cepstra_bugsweep.js
```
→ green (1627 + 15). No merge to main (PASS 4 reviews next).

## PASS-2 review outcome (historical)

**Kept 2 / dropped 0.** See git `7a55961`.

| Bug | Verdict | One-line |
| --- | --- | --- |
| A — stale f0 / display ignores `voiced` | **KEEP** | Verified in `job_lift` Auto/MIDI arms + `periodSamplesNow` + green diamond paint; RED fails first assert on unfixed code. |
| B — shared `#0-cepscope` | **KEEP** | Build still ships `buffer~`/`scope #0-cepscope`; Multiband/Glitch/Reverb+/Amp+ `---` migration is the correct precedent. |

## Bug A — Auto / MIDI leave a stale f0 in scope 257; display pitch marker ignores `voiced`

**Where (pre-fix)**
- `src/cepstra_core.genexpr` — `job_lift` (~L130–185)
- `src/cepstra_display.js` — `periodSamplesNow` (~L400–403) and the Auto/MIDI pitch diamond paint (~L619–625)

**Contract**
- Gen header: `257 : f0 estimate in Hz (0 = unvoiced / unknown)`; `261 : voiced flag`.
- AGENTS (Cepstra): Auto holds **L** when unvoiced (`L = k * period` held); it does **not** say f0 is held.

**RED**
`tests/test_cepstra_bugsweep.js` — genexpr static checks + display sandbox (Auto + unvoiced + stale f0).

## Bug B — `#0-cepscope` is shared across every Cepstra instance in Live

**Where (pre-fix)**
- `scripts/build_cepstra.py` — `buffer~ #0-cepscope`, `scope #0-cepscope`
- `src/cepstra_display.js` — default `#0-cepscope` binding path

**Contract / precedent**
AGENTS.md Multiband/Glitch/Reverb+/Amp+ `---` isolation.

**RED**
`tests/test_cepstra_bugsweep.js` — build/display/amxd must bind `---cepscope`.

# Envelope Trigger — bugsweep (PASS 4 APPROVED)

## Bug 1: Scope buffer uses `#0-trigscope` (not instance-isolated in Live) — FIXED

**PASS 4 decision:** APPROVED. Reviewed 2026-10-25 against tip `cf0b82f` (fix `aafec96`):
- Diff vs main is minimal and correct: production rename in `scripts/build_envtrig.py` (`buffer~` / `setbuffer` / `scope` `#0-trigscope` → `---trigscope`), matching comment updates in `src/envtrig_core.genexpr` / `src/envtrig_config.js` / `src/envtrig_dsp.js`, `tests/test_envtrig.js` name asserts flipped to `---trigscope` with a necessary (not weakened) exception in the generic `buffer~` loop for this shared scope buffer; `tests/test_envtrig_bugsweep.js` left strict (still rejects `#0-trigscope`).
- No leftover `#0-trigscope` in production/src/build (only this BUGS.md narrative and the out-of-scope `scripts/run_envtrig_audio_tests.py` harness).
- GenExpr still declares `Buffer scope("trigscope")` and binds via the `scope ---trigscope` message; UI `setbuffer ---trigscope` is the other consumer — matches AGENTS precedents (`---mbsplitscope` / `---glitchscope` / `---rpscope`).
- Host gate re-run green on Pass 4: `npm run -s typecheck && python3 scripts/build_envtrig.py && node tests/test_envtrig.js && node tests/test_envtrig_bugsweep.js` → Built `devices/Envelope Trigger.amxd` [228/342x169 px] (161476 bytes); both node suites ok.
- No drive-by refactors; dirty harness left untouched. No production follow-up.

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

**Commit SHA:** aafec96 on `bugsweep/envelope-trigger-pass1` (Pass 4 review commit follows).

---

PASS 2 re-checked the pass-1 conclusion: no other credible production bugs confirmed in `src/envtrig_*.js`, `src/envtrig_core.genexpr`, `scripts/build_envtrig.py`, and `tests/test_envtrig.js` against AGENTS §1 / §12 (DSP/GenExpr rules, presentation overlap, int>255, getvalueof panel latch, theme) and the instance-isolation (`#0` vs `---` ) rule. The shared `receive envtrig-test` hook is intentional for the Max/Live harness and is left as-is.

# Loud Split — Pass 1 bug hunt (red tests only, no fixes)

Branch: `bugsweep/loudsplit-pass1` · Worktree: `/tmp/bugsweep/loudsplit`

## BUG 1 — Mix dry share is 1/3 for a standalone single-channel Output (should be full dry)

**Severity:** audible level error in a documented configuration.

**Symptom.** A standalone Loud Split (not in the `.adg` rack) with `Output` set to
Loud, Mid or Quiet and `Mix` below 100 % outputs `(1 - mix) * dry / 3` instead of
`(1 - mix) * dry`. The dry component is ~9.5 dB low; at `Mix = 0 %` the device
outputs `dry / 3` instead of passing the dry signal through. `Output = All` (or
`Auto` outside a rack) is unaffected.

**Contract (AGENTS.md §24, “Mix”).** “Each instance outputs
`mix * wet_own + (1 - mix) * dry / K` … `K = 3` when one chain of a rack
(outsel 1..3), `K = 1` for Output All / outside a rack, so the rack sum is
`mix * wet + (1 - mix) * dry`.” The JS reference agrees:
`lsMixOut(wetOwn, dry, mix, k) = mix * wetOwn + (1 - mix) * dry / k`
(`src/loudsplit_config.js:90`), with `k` = the number of summed outputs.

**Root cause.** `src/spectral_split_rack_main.genexpr:480`:

```
kShare = selH > 0.5 ? @@KSHARE@@ : 1;
ov1 = fixnan(fixdenorm(mixS * wetL + (1 - mixS) * kShare * dryL.read(@@LAT@@)));
```

`@@KSHARE@@` is substituted as `repr(1.0 / k)` (= 1/3 for K = 3) by
`scripts/spectral_common.py:256`. The share is keyed **only** on `selH`, the
resolved output selection (`selH = clip(floor(outsel + 0.5), 0, K)`, ctl hook
line 158). No rack-presence / peer term reaches the mix: the template does track
served channels (`serveH` / `eserveH` / `allc` → `sAllCh`), but `sAllCh` feeds
only the DERIVE shortcut (line 303). Inside the rack the behaviour is correct by
accident of summation — each of the three chains selects its own channel and
contributes `dry / 3`, summing to full dry. A lone device has nothing to sum
with, so the share must be 1.

**Shared-framework flag.** The fault lives in the shared rack template
(`src/spectral_split_rack_main.genexpr`) and the shared build substitution
(`scripts/spectral_common.py`), not in Loud Split–specific code. Every device
built on the same template (the spectral split suite: Transient Split, Harmonic
Split, Freq Split, Multiband Split, …) presumably has the same standalone
single-channel Mix bug and should be checked in its own pass.

**Red test.** `tests/test_loudsplit.js`, §5 (after the existing Mix sum identity):
a model anchor (`lsMixOut(..., 1)` keeps full dry — passes; the JS reference is
correct) plus the failing assertion that the expanded gen must not contain a
selection-only share of the form `kShare = selH > 0.5 ? …`. Pass 2 strengthened
the match from the exact float literal to `/kShare\s*=\s*selH\s*>\s*0\.5\s*\?/`
so a repr change cannot green the test without a real fix (still fails at :699).

```
$ node tests/test_loudsplit.js
[ref] … passed
[genexpr] transpiled lib + ls_* tests passed
[lint] genexpr lint and link module tests passed
[device] built device and rack preset checks passed
AssertionError [ERR_ASSERTION]: gen dry share keys on selH alone (kShare = 1/K
for any single-channel Output): a standalone device with Output Loud / Mid /
Quiet must keep K = 1
    at Object.<anonymous> (tests/test_loudsplit.js:699:12)
```

## Pass 2 review (kept 1 / dropped 0)

- **KEEP Bug 1** — real audible DSP bug: standalone single-channel Output wrongly
  gets dry / 3. Confirmed against AGENTS.md §24 Mix (`K = 1` outside a rack),
  `lsMixOut(..., k=1)`, and live `gen_code()` still emitting
  `kShare = selH > 0.5 ? 0.3333333333333333 : 1;` (`roleH` / `serveH` unused at
  Mix). Strengthened the red regex as above. Host gate
  `npm run -s typecheck && python3 scripts/build_loudsplit.py && node tests/test_loudsplit.js`
  still fails on this assert only (typecheck + build pass). No production/src
  edits this pass; dirty `devices/Loud Split.{amxd,adg}` left uncommitted.

## Pass 3 fix (Bug 1)

**Fix.** `src/spectral_split_rack_main.genexpr` Mix line: gate `@@KSHARE@@` on rack
role as well as channel selection:

```
kShare = (selH > 0.5 && roleH > 0.5) ? @@KSHARE@@ : 1;
```

`roleH > 0.5` is LEAD (1) or FOLLOW (2) — this instance is one chain of a rack.
`roleH` SELF (0) / pending (−1) keeps full dry even when Output is Loud / Mid /
Quiet, matching AGENTS.md §24 (`K = 1` outside a rack). Rack single-channel
Output still uses `1/K` so the three chains sum to full dry.

**Touchpoints.** `src/spectral_split_rack_main.genexpr` (Mix comment + `kShare`
expression). Rebuild refreshed `devices/Loud Split.{amxd,adg}`.

**Host gate.** `npm run -s typecheck && python3 scripts/build_loudsplit.py &&
node tests/test_loudsplit.js` — green (Mix red assert at
`tests/test_loudsplit.js:699` no longer matches the expanded gen; all Loud Split /
spectral rack / deferred-DSP / paint-bounds checks passed). Red test left
unchanged.

**Shared-framework note.** Same template is used by the other spectral-split
devices; their own passes should adopt / verify the same Mix gate (e.g.
`tests/test_freqsplit.js` still expects the old `selH`-only form).

## Pass 4 review (approved 1 / adjusted 0)

- **APPROVE Bug 1** — fix is minimal and correct. `roleH = clip(floor(role + 0.5), -1, 2)` with
  SELF=0 / LEAD=1 / FOLLOW=2 / pending=−1; `roleH > 0.5` therefore means LEAD or FOLLOW (in a
  rack). Combined with `selH > 0.5`, `kShare` is `1/K` only for a single-channel Output on a rack
  chain; Output All (`selH = 0`) and SELF/pending (outside a rack) keep full dry — matches
  AGENTS.md §22/§24 Mix and `lsMixOut(..., k=1)`. Red regex still forbids the old selH-only form;
  no drive-by refactors. Host gate green after rebuild.

## Checked and found correct (do not re-hunt)

- `lsMasks` (JS) vs `ls_masks` (genexpr) mirror: tilt table, lmax excluding bins
  0 and half, relative floor −150, Rise/Fall coefficient, smoothstep knees,
  `lo = min(tlo, thi)`, masks sum to 1 — identical.
- Latency: `LS_LATENCY` 5120 everywhere (patcher attribute, dry delay, tests);
  the “4096” in §22 is the suite’s generic hop wording, not this device.
- Parameter tables: build NUM/ENUM/GEN_MSG vs `LS_PARAMS` / `LS_ENUMS` /
  `LS_GEN_PARAMS` — ranges and initials all match; gen Param defaults match.
- Telemetry scope: channel rows (Loud 2, Mid 3, Quiet 4, sum 5), `LS_SC_*`
  offsets, 512 telemetry columns zeroed on sleep.
- `sAge` resets (template lines 266 / 296) match the documented restart
  semantics (“age = frames since the state was (re)started”); the JS model
  restarts age with a fresh state the same way.
- `ss_cols` bin-edge rounding vs `lsColBin`: documented as matching for the
  sizes used; covered by existing tests.
- UI maths: threshold / knee / Rise / Fall / Tilt drag mappings, `lsEffLo`
  clamp, solo override in `lsEmitSel`, UI defaults vs the parameter tables.

# Degrade — Bug Sweep (Pass 1 reds + Pass 2 review)

Device: `devices/Degrade.amxd` · Worktree: `/tmp/bugsweep/degrade` · Branch: `bugsweep/degrade-pass1`
Tests: `tests/test_degrade.js`, new section 5 ("BUGSWEEP PASS 1").
Command: `node tests/test_degrade.js`

## Pass 4 review (ADJUSTED)

Re-checked each Pass 3 fix against production sources, JS mirror, and section-5
reds. Host gate green after follow-up:
`npm run -s typecheck && python3 scripts/build_degrade.py && node tests/test_degrade.js`
→ `All Degrade unit, GenExpr, layout, patchline, and v8ui tests passed!`
No test rewrites. No merge to main.

| Bug | Verdict |
|-----|---------|
| **D1** | APPROVED — `ulaw_compand` / `alaw_compand` use `round(comp * qSteps) / qSteps`; `quant_steps` left for BIT |
| **D2** | ADJUSTED — logic already correct (soft-clip wet sans gain; `outGainSlew` on summed outs); synced stale L1209– comment that still described `tanh(sig * outGainSlew)` |
| **D3** | APPROVED — equal-power `sin`/`cos(asin)` mix matches PARAM_SPECS |
| **D4** | APPROVED — `set_mix` falsy default `0`, consistent with other percent setters |

## Pass 3 fixes (all 4 green)

Host gate green: `npm run -s typecheck && python3 scripts/build_degrade.py && node tests/test_degrade.js`
→ `All Degrade unit, GenExpr, layout, patchline, and v8ui tests passed!`
No test rewrites. Production/src + rebuilt `devices/Degrade.amxd` only.

| Bug | Fix | Touchpoints |
|-----|-----|-------------|
| **D1** | u-Law/A-Law now quantize with `round(comp * qSteps) / qSteps` (match JS mirror); leave `quant_steps` alone for BIT | `src/degrade_core.genexpr` `ulaw_compand` L58, `alaw_compand` L73 |
| **D2** | Soft-clip wet without master gain; apply `outGainSlew` on the summed dry+wet outs | `src/degrade_core.genexpr` L1217–1226 |
| **D3** | Equal-power mix: `cWetG = sin(clip(wet)·π/2)`, `cDryG = cos(asin(cWetG))` | `src/degrade_core.genexpr` L437–438 |
| **D4** | `set_mix` falsy default `100` → `0`, matching other percent setters | `src/degrade_ui.js` L312 |

Fix commit SHA: `1a0dc4c`.

## Pass 2 review (keep all 4 — no drops)

Re-checked each claim against production sources and re-ran the host suite.
Kept: **D1, D2, D3, D4**. Dropped: none. No test rewrites; reds already fail
on unfixed code. No production/src edits (pass 3).

Verified red (full suite, Pass 2):
`BUG D1: gen A-Law compand must match the JS mirror quantization step (qSteps=64, x=0.1): gen=0.10824942325064496 mirror=0.09937750651761865`

---

## Pass 1 notes

Verification method: the committed suite fails first at D1 (asserts run in order).
D2–D4 were each additionally captured red on their own in a throwaway scratch
copy (`/tmp/degrade-probe`) with only the preceding new asserts neutralized;
the committed test file was never altered by those probes. No production code
was changed in this pass.

---

## D1 — Gen telecom companders quantize 2× coarser than the JS mirror

- **Where:** `src/degrade_core.genexpr` — `quant_steps()` (lines 39–43),
  `ulaw_compand()` (53–62), `alaw_compand()` (64–80); mirror in
  `src/degrade_config.js` `processTelecomSample()` (157–187).
- **Root cause:** both sides compute the same `qSteps`
  (`max(4, round(64 − line·56))` in JS, line 162). The JS mirror quantizes the
  companded value with `round(comp * qSteps) / qSteps` (lines 168, 179). The
  gen helpers instead route through `quant_steps()`, which quantizes with
  `round(x * steps/2) / (steps/2)` — half the multiplier — so the shipped DSP
  staircase is twice as coarse as the mirror/UI simulation at every Line
  value. (The BIT caller is the one correct `quant_steps` user: there
  `steps = 2^bits` is a total level count across [−1, 1], matching the JS bit
  quantizer.)
- **Impact:** u-Law/A-Law telephone degradation in the real device is
  audibly coarser than designed/simulated; at coarse steps the gen grid can
  even round a companded value to full scale where the mirror does not.
- **Red test:** executes the actual gen helper functions (transpiled
  GenExpr→JS) against the mirror formulas, qSteps ∈ {64, 32, 8},
  x ∈ {0.42, −0.42, 0.1, 0.83}, tolerance 1e-6 (deliberately above the
  ~2.4e-8 noise from the gen helpers truncated decimal constants, far below
  any quantization-step gap).
- **Red output (full suite):**
  `BUG D1: gen A-Law compand must match the JS mirror quantization step (qSteps=64, x=0.1): gen=0.10824942325064496 mirror=0.09937750651761865`
  (companded 0.5793 rounds to 19/32 on the gen grid vs 37/64 on the mirror grid.)
- **Secondary observation (not separately red-tested):** the GSM branch has
  its own grid drift — gen `max(3, 22 − line·18)` vs JS `max(3, 24 − amt·20)`
  — on top of the same `quant_steps` halving.

## D2 — Master Output gain never reaches the dry path

- **Where:** `src/degrade_core.genexpr` lines 1217–1226;
  `scripts/build_degrade.py` documents `out_gain` as "Master output
  drive/trim in dB before final soft ceiling".
- **Root cause:** `outGainSlew` is applied only inside `wetOutL`/`wetOutR`.
  The summed outputs are `outL = in1 * cDryG + wetOutL * cWetG;` (and R) with
  no master gain.
- **Impact:** at Mix = 0% the Output knob does nothing at all; at Mix = 50%
  a +6 dB Output setting delivers only 0.5 + 0.5·2 = 1.5× (+3.5 dB).
- **Red output (scratch probe):**
  `BUG D2: master out_gain must scale the summed dry+wet output (L), got: outL = in1 * cDryG + wetOutL * cWetG;`

## D3 — Mix law is linear, not the documented equal-power law

- **Where:** `src/degrade_core.genexpr` lines 437–438;
  `scripts/build_degrade.py` `PARAM_SPECS` documents Mix as
  "Equal-power dry/wet mix".
- **Root cause:** the gen cache computes `cWetG = clip(wetSlew, 0.0, 1.0);`
  and `cDryG = 1.0 - cWetG;` — a linear crossfade, with no sin/cos anywhere.
- **Impact:** −3 dB dip for decorrelated wet content at Mix = 50%, contrary
  to the documented equal-power behaviour.
- **Red output (scratch probe):**
  `BUG D3: cWetG must be an equal-power (sin) gain, got: cWetG = clip(wetSlew, 0.0, 1.0);`

## D4 — `set_mix(0)` mirrors Mix as 100% wet in the v8ui

- **Where:** `src/degrade_ui.js` line 312.
- **Root cause:** `set_mix` uses `clamp((Number(v) || 100) / 100.0, 0, 1)`.
  Every other percent setter in the file uses `(Number(v) || 0) / 100`, so the
  legitimate in-range value Mix = 0% (fully dry) is falsy-coerced to 100.
- **Impact:** the UI mirror `curWet` becomes 1.0 at Mix = 0; change detection
  also breaks — after `set_mix(100)`, a following `set_mix(0)` reports no
  change and skips redraw.
- **Red output (scratch probe):** after `set_mix(100)` (curWet = 1.0, as
  expected), `set_mix(0)` fails with
  `BUG D4: set_mix(0) must mirror curWet = 0.0 (fully dry), not 1.0` — `1 !== 0`.

# Theme Editor — Pass 1 Bug Hunt

Branch: bugsweep/theme-editor-pass1. Worktree: /tmp/bugsweep/theme-editor (at main HEAD 66fea67, clean before this pass).
Scope: devices/Theme Editor.amxd plus src/theme_engine.js, src/theme_editor_node.js, src/theme_editor_ui.js, src/theme_editor_web.html, scripts/build_theme_editor.py, scripts/theme_common.py, tests/test_theme_editor.js.
Method: source audit, then one red test per credible bug in the existing suite style. No fixes in this pass.

Baseline: node tests/test_theme_editor.js — all 9 checks PASS, exit 0.
Red suite: node tests/test_theme_editor_bugs.js — 0 passed, 6 failed, exit 1.

## Bug 1 — m4lSetThemeState stores NaN for non-numeric satScale/contrast, and a JSON round trip decays it to 0

Location: src/theme_engine.js, m4lSetThemeState (macro parsing).

hueShift and brightness are parsed as Number(x) || 0, so bad input falls back to the default. satScale and contrast only special-case undefined and otherwise store Number(value) unchecked, so a non-numeric value (a string from a hand-edited state file or an API client, an object, null after a round trip) is stored as NaN.

Ingress paths are real: the node server loadStateFromDisk performs no sanitation of ~/.m4l_theme_state.json before broadcasting it, POST /api/state accepts arbitrary JSON, and the v8ui theme_sync handler feeds parsed JSON straight into m4lSetThemeState.

The damage compounds through serialisation: JSON.stringify writes NaN as null (bus stateJson, the getvalueof blob, the node disk file), and the next m4lSetThemeState computes Number(null) === 0. One bad Saturation value therefore becomes a permanent satScale of 0 in the saved state — every themed device renders fully desaturated until the state is repaired by hand.

Red evidence:
- satScale must fall back to 1.0, not NaN (NaN !== 1)
- satScale after a JSON round trip must be 1.0, not 0 (0 !== 1)

## Bug 2 — m4lApplyMacros maps a null alpha to fully transparent

Location: src/theme_engine.js, m4lApplyMacros.

When a colour array has a fourth element, alpha is m4lClamp(Number(col[3]), 0, 1). Number(null) is 0, so a token with an explicit null alpha (or a NaN alpha that JSON.stringify turned into null) comes out fully transparent. m4lColor and m4lMixColor treat a missing fourth element as opaque 1.0 and pass a present fourth element through without Number(); m4lMapRgba shares the same Number(a) coercion for a present null (`a === undefined ? 1.0 : Number(a)`), so the original "this one site" wording was slightly overstated. The functional defect still stands: a null alpha becoming fully invisible is a bad failure mode for JSON-revived or hand-edited colour tokens, and it contradicts the missing→opaque convention used by m4lColor / m4lMixColor. (Bug 1's NaN→null→0 chain is about satScale/contrast macros, not colour alphas; the two bugs share the JSON null decay pattern but are otherwise independent.)

Red evidence:
- a null alpha (what JSON produces from NaN) must fall back to opaque 1.0 (0 !== 1)

## Bug 3 — The node server replaces the whole theme state on update, dropping every field it was not sent

Location: src/theme_editor_node.js, the POST /api/state handler and the sync_state Max handler, persisted by saveStateToDisk.

Both ingress paths assign the parsed body wholesale (currentState = next / currentState = parsed) and immediately save and broadcast the result. A partial update therefore deletes the fields it does not mention: posting { preset: "Cyber Cyan" } — a shape the existing verification suite itself uses — silently removes abletonUi, customPresets and deviceOverrides from the served state and from ~/.m4l_theme_state.json, and posting { macros: { hueShift: 25 } } removes satScale, contrast and brightness from the macros object. loadStateFromDisk cannot heal this: it merges only at the top level on restart and replaces nested objects wholesale, so the loss is permanent. The engine-side m4lSetThemeState demonstrates the intended pattern — it merges the incoming state into defaults field by field. The node hub, which owns persistence, does not.

Red evidence:
- abletonUi must survive a partial POST
- satScale must not be dropped by a partial macros POST (undefined !== 1)
- the on-disk state file must keep abletonUi

## Investigated and not counted as bugs

- Preset switching clears token overrides in both the v8ui (onclick) and the WebUI (preset buttons): identical on both surfaces, treated as deliberate design.
- The candidate grids in m4lEstimateAbletonUiSettings (brightness, intensity, hue) are coarse by design and the function reports rmse.
- m4lRgbKey quantises to 1/1000; the comment documents this and the existing suite covers the no-double-mapping behaviour.
- WebUI hexToRgba always returns alpha 1.0, but its only caller is an input type=color element, which has no alpha channel; worth revisiting only if an alpha-capable editor is added.
- teBroadcastState republishes state (incrementing its version) on every macro drag frame: a batching and undo-granularity improvement for a future pass, not a correctness bug.

## Commands and results

- node tests/test_theme_editor_bugs.js → exit 0, 6 passed / 0 failed (green after Pass 3 fixes)
- npm run -s typecheck && node tests/test_theme_editor.js → exit 0, all 9 checks PASS (host gate)

## Pass 2 review (kept all three)

Reviewed against source on tip 3cb1c01. All three claims are real functional/state bugs; none dropped. No production/src fixes in this pass.

- Bug 1 KEEP — satScale/contrast store `Number(x)` with no NaN fallback while hueShift/brightness use `Number(x) || 0` (m4lSetThemeState ~3482–3483). JSON round-trip NaN→null→0 permanently desaturates themed devices.
- Bug 2 KEEP — m4lApplyMacros null alpha → 0 is a real failure mode. Softened the "one site" consistency claim above (m4lMapRgba also Number()-coerces a present null); the missing→opaque convention of m4lColor/m4lMixColor still makes this a bug. Bug 1 linkage is about macros, not colour alphas.
- Bug 3 KEEP — POST /api/state and sync_state assign `currentState` wholesale; partial bodies drop abletonUi/customPresets/sibling macros. Confirmed in theme_editor_node.js.

Red suite re-run on unfixed code: `node tests/test_theme_editor_bugs.js` → 0 passed, 6 failed, exit 1 (expected).

## Pass 3 fixes

Fixed all three kept bugs on `bugsweep/theme-editor-pass1`. Red suite and host gate green. Pass 3 commit: `d7aa9c2`.

- Bug 1 FIXED — `src/theme_engine.js` `m4lSetThemeState` (~3482–3483): satScale/contrast now fall back to 1.0 when the value is `undefined`, `null`, or non-finite after `Number(...)`, matching the hueShift/brightness defaulting style and blocking the NaN→null→0 desaturate path.
- Bug 2 FIXED — `src/theme_engine.js` `m4lApplyMacros` (~3604): alpha only Number/clamps when the fourth element is present, non-null, and finite; otherwise opaque 1.0 (same missing→opaque convention as `m4lColor` / `m4lMixColor`).
- Bug 3 FIXED — `src/theme_editor_node.js`: added `mergeThemeState(prev, patch)` (~330) that shallow-merges top-level fields and deep-merges `macros` / `tokens` / `deviceOverrides` / `customPresets` / `abletonUi`. Wired into `sync_state` (~355) and POST `/api/state` (~433) so partial updates no longer wipe sibling state or the on-disk file.

## Pass 4 review — APPROVED

Reviewed production diffs on tip `4839b74` (Pass 3 fix `d7aa9c2` + BUGS SHA note). Host gate re-run green: `npm run -s typecheck` + `node tests/test_theme_editor.js` (9/9) + `node tests/test_theme_editor_bugs.js` (6/6). No production adjustments.

- Bug 1 APPROVED — `m4lSetThemeState` satScale/contrast fall back to 1.0 on undefined/null/non-finite; blocks NaN→null→0 desaturate; keeps intentional 0.
- Bug 2 APPROVED — `m4lApplyMacros` treats null/non-finite alpha as opaque 1.0; matches m4lColor/m4lMixColor missing→opaque.
- Bug 3 APPROVED — `mergeThemeState` deep-merges nested theme fields on sync_state and POST /api/state; partial bodies no longer wipe siblings or disk state.

# XO Sample Map — Pass 1–4 bug sweep

Branch: `bugsweep/xo-map-pass1` · Worktree: `/private/tmp/bugsweep/xo-map`
Scope: `src/xo_node_engine.js`, `src/xo_strip_ui.js`, `src/xo_search.js`, `src/xo_stretch.js`,
`scripts/build_xo_map.py`, `tests/test_xo_*.js`. One credible bug found (Pass 1); Pass 2 kept it; Pass 3 fixed it; Pass 4 approved.

## Pass 4 — review (APPROVED)

- **Bug 1:** APPROVED. Fix is minimal and correct: `captureSnapshot` / `applySnapshot` now cover all seven
  playback fields that `recallSavedEntry` assigns (`pitchSt`, `decayMs`, `gainDb`, `reversePlayback`,
  `speedPct`, `grainMs`, `stretchMode`) with `!== undefined` defaults `0` / `100` / `45` / `1` matching recall.
  Red test left unchanged and still isolates the four previously-missing fields. No drive-by refactors;
  no test weakening. Host gate re-run green on tip `5ddf91c` (`npm run -s typecheck && python3 scripts/build_xo_map.py && node tests/test_xo_map.js`, including `OK: undo after recall restores all playback settings`). No production code changes in Pass 4.

## Pass 3 — fixed

### Bug 1 — FIXED (undo after saved-sample recall restores all 7 playback settings)

- **Touchpoints:** `src/xo_strip_ui.js` — `captureSnapshot()` (~649) and `applySnapshot()` (~666).
  Added `reversePlayback`, `speedPct`, `grainMs`, `stretchMode` to the snapshot object and restore
  them with `!== undefined` defaults `0` / `100` / `45` / `1` (matching `recallSavedEntry`).
- Red test left unchanged: `tests/test_xo_map.js` block "Undo after recalling a saved sample restores ALL playback settings".
- **Host gate green:** `npm run -s typecheck && python3 scripts/build_xo_map.py && node tests/test_xo_map.js`
  (includes `OK: undo after recall restores all playback settings`). Rebuilt `devices/XO Sample Map.amxd`.
- Commit SHA: `5ddf91c`.

## Bug 1 — Undo after recalling a saved sample only restores 3 of the 7 playback settings it changed (was KEEP; fixed in Pass 3)

**Where:** `src/xo_strip_ui.js`
- `captureSnapshot()` (~line 649) / `applySnapshot()` (~line 666) save and restore:
  `activeCategory, maxLenMs, toneFilter, searchQuery, pitchSt, decayMs, gainDb,
  selectedIndex, anchorIndex, selectedSavedIndex, savedScrollOffset, savedList`.
- `recallSavedEntry()` (~line 1378) assigns **seven** playback fields from the entry:
  `pitchSt, decayMs, gainDb, reversePlayback, speedPct, grainMs, stretchMode`
  and outlets them as `recalled_settings`.
- Clicking a saved row pushes an undo snapshot immediately before recalling
  (`onclick`, ~line 2011: `pushUndoState(); recallSavedEntry(actualIdx);`),
  so the recall is explicitly meant to be undoable.

**Effect:** Undo after a recall restores pitch/decay/gain to their pre-recall values but
silently leaves **Reverse, Speed, Grain and Stretch Mode** at the recalled sample values —
an inconsistent half-reverted state. (`save_selected()` entries capture all seven fields,
so the snapshot pair is the odd one out.)

**Red test:** `tests/test_xo_map.js`, block "Undo after recalling a saved sample restores
ALL playback settings" (inserted before the final SUCCESS log). It banks an entry with
state B on all seven axes, switches to a distinct state A, pushes undo, recalls
(asserting recall applied B), undoes, then probes the restored state via `save_selected()`.

**Command / result (current code, expected exit 1):**

```
$ node tests/test_xo_map.js
AssertionError [ERR_ASSERTION]: undo after recall restores reverse
1 !== 0
    at Object.<anonymous> (/private/tmp/bugsweep/xo-map/tests/test_xo_map.js:…)
```

The pitch, decay and gain undo assertions immediately before it pass, isolating the
failure to the four fields missing from the snapshot.

**Suggested fix (Pass 3, not applied):** add `reversePlayback, speedPct, grainMs, stretchMode`
to `captureSnapshot()` and restore them in `applySnapshot()` (with the same
`!== undefined` defaulting as the other fields).

## Pass 2 review — kept 1 / dropped 0

- **Kept Bug 1:** Real functional/UI/state bug. Verified `captureSnapshot`/`applySnapshot` omit
  the four fields while `recallSavedEntry` assigns all seven and the saved-row `onclick`
  calls `pushUndoState()` before recall. Host gate (typecheck + `build_xo_map.py` +
  `node tests/test_xo_map.js`) exits 1 only on
  `AssertionError: undo after recall restores reverse (1 !== 0)`; pitch/decay/gain undo
  asserts pass. Red test left as-is (already isolates the missing snapshot fields).
- **Dropped:** none. Cleared items below still stand; no additional bugs found.

## Checked and cleared (do not re-litigate in Pass 2/3)

- **`getvalueof` / Live dials:** top-level blob serializes pitch/decay/gain (plus filters/selection/saved list
  pitch-decay-gain); Reverse / Speed / Grain / Stretch Mode are live.* parameters Live persists separately.
  Not filed as a Set-reload bug here.
- **relative_coords:** strip UI init path looks correct for the presentation box.
- **`const max` in node engine:** local Array method, not Max global shadowing.
- **Pitch Int range:** Int −24..24 is within Max Int limits (not >255 enum hazard).
- Sibling `xo-sample-map` worktree already filed the same undo bug; this pass independently
  confirmed it in this fresh `xo-map` worktree and added the red test here.

# Multiband Split — Pass 1–4 bugsweep

Branch: `bugsweep/mbsplit-pass1` · Worktree: `/private/tmp/bugsweep/mbsplit` · base HEAD `d72ee17`

## Pass 4 review (ADJUSTED — docs only)

Production fixes at tip `e5ade72` reviewed and kept. Host gate re-run green:
`npm run -s typecheck && python3 scripts/build_mbsplit.py && MBSPLIT_SKIP_LIVE_MCP=1 node tests/test_mbsplit.js && node tests/test_mbsplit_pass1.js`
→ typecheck OK, amxd rebuilt, host suite passed, **All Pass 1 tests passed** (4/4).

| Bug | Verdict | Note |
|---|---|---|
| 1 Volume slider dead zone | **APPROVED** | Exact inverse at exp 1.5; only `n <= 0.0` → −70 dB; (−70, −62.4) reachable; round-trip ≤0.5 dB. Minimal touch in `src/mbsplit_ui.js`. Reds not weakened. |
| 2 FIR display approx > 0.1 | **APPROVED** | `computeFirLowpassMag` uses cached real DC-normalized half-kernel; max error ≤0.1 (rounding). Minimal touch in `src/mbsplit_config.js`. Reds not weakened. |

**Doc adjust:** AGENTS.md Dynamic Phase JS-mirror line still said "raised-cosine display approximation"; synced to describe the real-kernel evaluation. No production/code change beyond that docs line. Pass 4 tip = HEAD after this review commit. Do not merge; do not delete worktree.

## Pass 3 fix (both kept reds now green)

Production fixes landed on this branch. Host gate green with `MBSPLIT_SKIP_LIVE_MCP=1`.
`node tests/test_mbsplit_pass1.js` → **All Pass 1 tests passed.** Fix commit SHA = tip of
`bugsweep/mbsplit-pass1` after the Pass 3 commit (see `git log main..HEAD --oneline`).

| Bug | Fix | Touchpoints |
|---|---|---|
| 1 Volume slider dead zone | Matched `gainDbToSliderNorm` / `sliderNormToGainDb` exponents to **1.5** (exact inverse). Removed the `n <= 0.015` dead zone — only true zero (`n <= 0.0`) maps to −70 dB (−inf). Gains in (−70, −62.4) dB are reachable again and round-trip within 0.5 dB. | `src/mbsplit_ui.js:153` `gainDbToSliderNorm` (exponent 1.5 at :161); `:164` `sliderNormToGainDb` (`n <= 0.0` at :168, `1.0/1.5` at :172) |
| 2 FIR display approx > 0.1 | Replaced the raised-cosine guess with the real DC-normalized half-kernel (`designFirHalfKernel` + `evalFirHalfKernel`), cached per `fc@sr` in module-level `firLowpassMagCache`. Display curve tracks the actual FIR to within rounding; worst pre-fix errors 0.180@fc=40 and 0.113@DEFAULT_F1=120 are gone. | `src/mbsplit_config.js:277` `firLowpassMagCache`; `:278` `computeFirLowpassMag` |

Also rebuilt `devices/Multiband Split.amxd` via `scripts/build_mbsplit.py` (included in the fix commit).
Reds in `tests/test_mbsplit_pass1.js` were **not** weakened.

## Pass 2 review (kept 2 / dropped 0)

Reviewed Pass 1 claims against source, PARAM_SPECS, AGENTS.md, and host measurements.
**Both bugs kept.** No drops. Production code untouched at review time (tip `bfe14c4`).

| Bug | Decision | Why |
|---|---|---|
| 1 Volume slider dead zone | **KEEP** | `sliderNormToGainDb` snaps `norm <= 0.015` to −70 while `gainDbToSliderNorm` maps (−70, −62.4) into that zone. Wired as inverse pair on click→drag. Live param / gen allow −70…+18; gen silence floor is `gain <= -69.5`; `formatGainDb(-65)` prints `"-65.0 dB"`. Real functional UI bug. |
| 2 FIR display approx > 0.1 | **KEEP** | AGENTS.md states unqualified "within 0.1 of the real kernel". Face draws Dynamic Phase bands via `computeBandMagnitudesAtFreq` → `computeFirLowpassMag`. F2/F3 PARAM_SPECS allow 20…20000 Hz. Measured worst error **0.113 at fc=120** (default F1 / legal F2) and **0.180 at fc=40** (48k/96k). Host suite only checks fc∈{800,4500} where error≈0.05. Real display/architecture-contract bug. |

## Verdict (Pass 1)

**Two credible bugs found.** Both have RED tests in `tests/test_mbsplit_pass1.js`
(they fail on unmodified HEAD; no production code was changed in Pass 1). The host gate
(`node tests/test_mbsplit.js` + build) still passes on unfixed HEAD — its FIR display check only
covers fc ∈ {800, 4500} at 48 kHz, and its volume-slider checks only exercise
the endpoints (−70 / 0 / +18 dB).

## BUG 1 — Volume slider mapping is not invertible at low gains

**Severity:** functional UI — Chain Gain values in roughly (−70, −62.4) dB are
unreachable from the painted volume slider, and any legal gain in that range
(e.g. from the Live parameter or `set_gain`) snaps to −70 dB (−inf) on the next
slider drag seed / paint→drag round-trip.

**Symptom.** `gainDbToSliderNorm` (`src/mbsplit_ui.js:153`) and
`sliderNormToGainDb` were used as an inverse pair:

- `drawTopVolumeSlider` fills from `gainDbToSliderNorm(curGainDb)`
- onclick seeds `volDragNorm = gainDbToSliderNorm(curGainDb)`
- ondrag sets `curGainDb = sliderNormToGainDb(volDragNorm)`

They did not round-trip at low gains. `sliderNormToGainDb` mapped every
`norm <= 0.015` to −70 dB, while `gainDbToSliderNorm` mapped the whole audible
range −69.5 … ≈−62.3 dB onto norms below 0.015. Measured: 14 of 176 half-dB
steps from −69.5 to +18 failed a 0.5 dB round-trip. Dragging across the dead
zone jumped from −70 dB to about −62.4 dB with no intermediate values.

**Contract.** `set_gain` / build `PARAM_SPECS` / gen clamp Chain Gain to
−70 … +18 dB; only `gain <= -69.5` is treated as silence in the gen
(`cGainLin = (gain <= -69.5) ? 0.0 : …`). `formatGainDb(-65)` prints
`"-65.0 dB"`. The slider is the face's control for that same parameter, so the
mapping pair must be invertible across the full legal range.

**Red test.** `tests/test_mbsplit_pass1.js` — extracts the two functions from
`mbsplit_ui.js` and asserts (a) round-trip within 0.5 dB for every half-dB step
−69.5 … +18, and (b) no >1 dB jump when sweeping norm 0…1 in 0.001 steps.

**Pass 3 fix.** Exponents matched at 1.5; dead zone removed (`n <= 0.0` only). See Pass 3 table.

## BUG 2 — Dynamic Phase FIR display approximation exceeds its stated 0.1 tolerance

**Severity:** display / architecture contract — the band curves the face draws
in Dynamic Phase mode (via `computeBandMagnitudesAtFreq` →
`computeFirLowpassMag`) diverge from the real Kaiser kernel by up to ~0.18
linear magnitude at low crossovers, contradicting AGENTS.md.

**Symptom.** AGENTS.md (Multiband Split / Dynamic Phase) stated
`computeFirLowpassMag` is a raised-cosine display approximation of the real
Kaiser FIR kernel, "**within 0.1 of the real kernel**". Against
`evalFirHalfKernel(designFirHalfKernel(fc, sr, D))` with
`D = firLatencyForSampleRate(sr)`, the worst error on unfixed HEAD was
**0.180** (f ≈ 108.7 Hz, fc = 40, sr = 48000/96000; real ≈ 0.79 vs approx ≈ 0.61).
Error already exceeded 0.1 at the default F1 / legal F2 = 120 Hz (**0.113**).
The error grew when the crossover approached / fell below the transition
half-width `sr / D` (375 Hz at 48/96 kHz), where the `lo <= 0` normalization
branch in the old raised-cosine ran.

**Why the host suite stayed green on unfixed HEAD.** `tests/test_mbsplit.js` §1b only checks
fc ∈ {800, 4500} at 48 kHz — well above `sr/D = 375` Hz — so the lo≤0 branch
never ran and the 0.1 assert stayed satisfied (measured worst ≈ 0.05 there).

**Red test.** `tests/test_mbsplit_pass1.js` — sweeps fc ∈
{40, 120, 300, 800, 2000, 4500, 9000} at 48 kHz and 96 kHz over a log-frequency
grid and asserts max |real − approx| ≤ 0.1; also asserts explicitly at
`MBSPLIT_DEFAULT_F1` (120 Hz) so a default-only miss cannot hide behind the
low-fc worst case.

**Pass 3 fix.** `computeFirLowpassMag` now evaluates the real half-kernel (module cache).
Raised-cosine half-width sweeps (k=0.55..1.3) could not meet 0.1 — shape wrong, not just width.
See Pass 3 table.

## Audited and cleared (do not re-hunt)

- **Scope isolation:** `buffer~ ---mbsplitscope @samps 8224`, loadbang
  `scope ---mbsplitscope` / `setbuffer ---mbsplitscope` — no top-level `#0-`
  share among device instances (AGENTS pitfall; already asserted by host suite).
- **Deferred gen~ loader** (`src/mbsplit_dsp.js`): silence-until-ready, claim
  queue, retry, scope slot 23 confirm — looks sound; not the spectral-rack Mix
  share bug (mbsplit is the LR gen core, not `spectral_split_rack_main`).
- **getvalueof / setvalueof:** versioned snapshot; custom mask 0 preserved
  (`isNaN(cmRaw) ? 1 : clamp…`, not `|| 1`); phaseMode at ver ≥ 3.
- **GenExpr nested early-return:** no `if (…) { …; return …; }` pattern in
  `mbsplit_core.genexpr`.
- **No `var box` shadowing** in mbsplit sources.
- **Param `phase`:** gen exposes polarity `phaseSign` from `Param phase`, but
  the UI never emits `phase` (only `dynphase`). Always +1 at runtime. Dead
  control / leftover — not filed (no user-facing polarity UI; measure harness
  sends `phase 0` explicitly).
- **FIR rebuild on sr change:** `if (sr != firSr) { firSr = sr; firD = clamp(128 * round(sr/48000), 128, 512); …}` and UI reads scope[26] into
  `firLatencySamples` / `updateDeviceLatency()` — consistent with
  `firLatencyForSampleRate`.
- **Loud Split Mix /K standalone bug** does **not** apply here (different
  architecture).

## Commands

```
# Pass 1 reds (GREEN after Pass 3 fix):
node tests/test_mbsplit_pass1.js

# Host gate (must stay green):
npm run -s typecheck && python3 scripts/build_mbsplit.py && MBSPLIT_SKIP_LIVE_MCP=1 node tests/test_mbsplit.js
```

# Tiny Space bugsweep (bugsweep/tinyspace-pass1)

PASS-1 filed Bug A with a RED suite. PASS-2 reviewed that RED and **kept** it. PASS-3 fixed production: top-level buffers are now instance-unique `---tsconfig` / `---tsmeters`, `tsDspFrames` peeks `meterBuf` from `setbuffer`, and `tests/test_tinyspace.js` expects the `---` names. Host gate (`npm run -s typecheck && python3 scripts/build_tinyspace.py && node tests/test_tinyspace.js && node tests/test_tinyspace_bugsweep.js`) is green. RED coverage remains in `tests/test_tinyspace_bugsweep.js` as a regression guard.

## PASS-2 review

- **Kept 1 / dropped 0.**
- **KEEP Bug A** — real functional instance cross-talk: Live does not expand `#0` in a top-level device patcher, so every Tiny Space shares one config and one meter buffer. Precedent (Multiband / Delay+ / Glitch / Reverb+ `---` names) confirms the expected fix shape. RED asserts the right surfaces (build `buffer~` / bind / `setbuffer`, built `.amxd`, UI `new Buffer("#0-tsmeters")` hardcode in `tsDspFrames`) and fails on current code. No rewrite or strengthening needed.
- Pass-1 "reviewed and not filed" items re-checked; none elevated to a new RED. No additional tinyspace-specific top-level `#0-` buffers found beyond `tsconfig` / `tsmeters`.

## Bug A — `#0-tsconfig` / `#0-tsmeters` are shared across every Tiny Space instance in Live

**Where (pre-fix)**
- `scripts/build_tinyspace.py` — `buffer~ #0-tsconfig @samps 128` (~L434), `buffer~ #0-tsmeters @samps 32` (~L447), bind `cfg #0-tsconfig, meters #0-tsmeters` (~L513), face `setbuffer #0-tsconfig #0-tsmeters` (~L527)
- `src/tinyspace_ui.js` — `tsDspFrames()` hardcodes `new Buffer("#0-tsmeters")` (~L193) instead of using the `meterBuf` from `setbuffer` (~L44–47)
- `tests/test_tinyspace.js` (~L331–339) currently *requires* the `#0-` prefix on those boxes
- Comments / docs that teach the same names: `src/tinyspace_config.js` L2, `src/tinyspace_core.genexpr` L2/L6, `AGENTS.md` Tiny Space section (~L367 / L372), `scripts/run_tinyspace_audio_tests.py` L4–5 / L85–109

**Contract / precedent**
AGENTS.md (measured): `#0` is **not** expanded in a device's top-level patcher in Live (only in abstractions). Multiband Split migrated `#0-splitscope` → `---mbsplitscope`; Delay+ uses `---dpxfer` / `---dphdr`; Glitch uses `---glitchslots` / `---glitchscope` / `---glitchctl`; Reverb+ uses `---rpscope` / `---rpxfer`. Tiny Space is the same class of top-level audio effect and still ships `#0-tsconfig` / `#0-tsmeters`.

Gen itself is fine: `Buffer cfg("tsconfig")` / `Buffer meters("tsmeters")` are fixed external names bound on loadbang (Glitch pattern). The shared names are the patcher's `buffer~` objects and the messages that bind / `setbuffer` them.

**User-visible effect**
Two Tiny Space instances (second track, or Cmd+D) share one config buffer and one meter buffer:
1. Seed / Character (and any UI poke into `#0-tsconfig`) on instance A rewrites instance B's tank geometry.
2. String / meter viz crosses: each face reads the other's envelopes and frame counter.
3. `tsDspFrames` always peeks the literal `#0-tsmeters`, so even a future `setbuffer` of an expanded per-instance name would not fix DSP-ready detection until that hardcode is removed.

**Expected**
Rename to unique `---` buffers (e.g. `---tsconfig`, `---tsmeters`) in build (`buffer~`, gen bind message, face `setbuffer` message), have `tsDspFrames` use `meterBuf` (or the name passed through `setbuffer`), and update `tests/test_tinyspace.js` assertions. The audio harness may keep private `#0-` names for its own probe buffers if needed (Multiband precedent: device `---mbsplitscope`, harness `#0-splitscope`).

**RED**
`tests/test_tinyspace_bugsweep.js` — build script / built `devices/Tiny Space.amxd` / UI must use instance-unique `---` names (not `#0-tsconfig` / `#0-tsmeters`); UI must not hardcode `new Buffer("#0-tsmeters")`.

## PASS-3 fix

**Status:** FIXED (host gate + bugsweep suite green). Commit SHA filled after commit on `bugsweep/tinyspace-pass1`.

**Production touchpoints**
- `scripts/build_tinyspace.py` — `buffer~ ---tsconfig @samps 128` (~L434), `buffer~ ---tsmeters @samps 32` (~L447), bind `cfg ---tsconfig, meters ---tsmeters` (~L513), face `setbuffer ---tsconfig ---tsmeters` (~L527)
- `src/tinyspace_ui.js` — `tsDspFrames()` peeks `meterBuf` (from `setbuffer`); comments at ~L141 / ~L189 updated to `---tsmeters (meterBuf)`
- `tests/test_tinyspace.js` (~L331–339) — asserts `---tsconfig` / `---tsmeters` (required so the main suite stays green; not a weaken of the bugsweep RED)
- Comments / docs aligned with production: `src/tinyspace_config.js` L2, `src/tinyspace_core.genexpr` L2/L6, `AGENTS.md` Tiny Space section (~L367 / L372)
- `devices/Tiny Space.amxd` — rebuilt after the rename (intentional; include in the PASS-3 commit)

**Left unchanged (intentional)**
- GenExpr `Buffer cfg("tsconfig")` / `Buffer meters("tsmeters")` — external names, bound via loadbang
- Audio harness private `#0-` probe buffers: `scripts/run_tinyspace_audio_tests.py`, `tests/tinyspace_harness.maxpat`, `tests/tinyspace_probe.js` (self-consistent inside the harness patcher; Multiband precedent)
- `tests/test_tinyspace_bugsweep.js` — kept as regression guard (still asserts `#0-` absence / `---` presence)

## Reviewed and not filed

These were checked against AGENTS / source / tests and are **not** bugs (doc drift or intentional design):
- JS `fdnMix` / `house()` vs gen `house()` for models 0–7, n=1–10: 0 coefficient mismatches.
- Nested returns: every gen helper has a single function-level return; `dampCoef` if-block then return is OK.
- Presentation rects (title / seed / char / viz / dials): no mutual live.* overlap; all inside 292×169.
- Seed `parameter_type` 0 + steps 1001; Character enum; `%/100` dial scales; deferred DSP (no static `plugin~`→`plugout~`); silence-sleep zeroing wet when asleep — intentional and covered by existing tests.
- AGENTS "70-float" vs `CFG_FLOATS=72`, and "whole samples" vs `interp="linear"` + `round()`: doc drift / intentional, not RED material.
- `Global("tinyspace_dspq")`: shared create-queue like `mbsplit_dspq` — intentional.

## PASS-3 complete

Bug A production fix is in; harness `#0-` names and the bugsweep RED suite stay as documented above. Pass 4 reviews next — do not merge to main from this pass.

## PASS-4 review

**APPROVED — 1 bug, no adjustments.**

- Reviewed `git log main..HEAD` and `git diff main...HEAD` across production/src/build, not only tests.
- Bug A fix is minimal and correct: build creates `buffer~ ---tsconfig @samps 128` / `buffer~ ---tsmeters @samps 32`, binds `cfg ---tsconfig, meters ---tsmeters`, and sends the face `setbuffer ---tsconfig ---tsmeters`; `tsDspFrames()` now peeks `meterBuf` (from `setbuffer`) instead of a hardcoded `#0-tsmeters` Buffer. Matches the Multiband / Delay+ / Glitch / Reverb+ `---` top-level isolation precedent.
- GenExpr `Buffer cfg(tsconfig)` / `Buffer meters(tsmeters)` external names left unchanged (correct — bound on loadbang). Audio-harness private `#0-` probe buffers left alone (Multiband precedent).
- Comments/docs in tinyspace_config.js, tinyspace_core.genexpr and AGENTS.md aligned to the new names. tests/test_tinyspace.js updated to assert `---`; no test weakened — the bugsweep RED suite (8 checks) stays as a regression guard. No drive-by refactors.
- Host gate green: typecheck OK, Tiny Space.amxd built 292×169 / 120098 bytes, test_tinyspace: ok, tinyspace bugsweep RED 8 checks.

Not merged to main; worktree left in place for the coordinator. Next: commit this note on bugsweep/tinyspace-pass1.

# Oscilloscope — Bugsweep (Pass 1 findings, Pass 2 review, Pass 3 fix, Pass 4 review)

Branch: `bugsweep/oscilloscope-pass1`
Scope: Oscilloscope-specific UI/DSP/state bugs only. The shared `#0-analyzerscope` buffer-name collision is owned by analyzer-scope pass 2/3 and is **not** re-filed here.

## Pass 4 review — APPROVED

Re-read production blob path (`OSC_VERSION` 5; `oscBlob` / `oscFromBlob` / `oscDefaultState` / `getvalueof` / `setvalueof`), build `parameter_initial` seed, and section-5 / section-7 tests. Host gate re-run green: typecheck OK, `devices/Oscilloscope.amxd` rebuilt (460×169, 115643 bytes), `oscilloscope: 163552 checks passed`. No follow-up code changes.

- **Bug 1 — APPROVED** — blob v5 persists armed `trigLevel` as the 9th element; old v4 8-element blobs load with `trigLevel = 0`; v3/v2/v1 loaders unchanged; `oscFrozen` intentionally left unpersisted; `#0-analyzerscope` not re-touched.

## Pass 3 fix — Bug 1 green

Host gate green after the fix: `npm run -s typecheck && python3 scripts/build_oscilloscope.py && node tests/test_oscilloscope.js` → typecheck OK, `devices/Oscilloscope.amxd` rebuilt (460×169), `oscilloscope: 163552 checks passed` (section-7 `near(ctx.oscTrigLevel, 0.42, …)` now passes).

**Bug 1 fix (persist armed `oscTrigLevel` across getvalueof/setvalueof):**
- `src/oscilloscope_config.js` — bumped `OSC_VERSION` 4→5; `oscDefaultState()` adds `trigLevel: 0`; `oscBlob()` emits a 9th element (clamped −1..1, rounded to 1e-3); `oscFromBlob()` has a v5 branch (`length >= 9`) plus an explicit v4 backward-compat branch (`length >= 8`, `trigLevel` defaults to 0). v3/v2/v1 loaders unchanged.
- `src/oscilloscope_ui.js` — `getvalueof()` passes `trigLevel: oscTrigLevel`; `setvalueof()` restores `oscTrigLevel = saved.trigLevel`. `oscFrozen` intentionally left unpersisted.
- `scripts/build_oscilloscope.py` — `parameter_initial` seed is now `[5, …, 0.0]` (9 elems).
- `tests/test_oscilloscope.js` — section 5 asserts v5 round-trip (9 elems, `trigLevel` 0.42) and v4 back-compat (`trigLevel` defaults to 0). Section-7 RED left as-is and is now green.
- Rebuilt `devices/Oscilloscope.amxd` via the build script.

Parents for this tip: pass-2 `ac39c75`, pass-1 RED `4d65086`.

## Pass 2 review — kept 1 / dropped 0

Re-read `src/oscilloscope_ui.js` getvalueof/setvalueof (1078-1105), `src/oscilloscope_config.js` oscDefaultState/oscBlob/oscFromBlob (8-elem blob v4, no trigger slot), and the section-7 RED in `tests/test_oscilloscope.js`. Host gate: typecheck + build_oscilloscope green; `node tests/test_oscilloscope.js` fails only on `near(ctx.oscTrigLevel, 0.42, …)` (got 0, want 0.42). No production/src edits in this pass.

- **Kept Bug 1** — real user-facing serialization bug: armed `oscTrigLevel` is sticky (trig drag / dblclick clear / guide paint / trigLocked) but never round-trips through getvalueof/setvalueof, so Live save/reload silently resets it to 0. RED left as-is; still fails on unfixed code.
- **Dropped:** 0. `oscFrozen` stays intentional momentary live-display state (sand pass-1 precedent). `#0-analyzerscope` stays owned by analyzer-scope pass 2/3.

## Confirmed bugs

### 1. Trigger level is not persisted across save / reload — FIXED (pass 3)

**Severity:** User-facing state loss (armed trigger silently resets to 0 when a Live set is saved and reopened).

**Evidence (pre-fix):**
- `src/oscilloscope_ui.js` (`getvalueof`) serialized only `routingMode`, `editSub`, `chMode`, `viewMode`, `cycleMode`, `rateHz`, `gainDb`, `autoGain` via `oscBlob` — no trigger field.
- `setvalueof` never restored a trigger level.
- `src/oscilloscope_config.js` `oscDefaultState()` exposed the same 8 keys (no trigger).
- Blob v4 was fixed at 8 elements.
- Yet `oscTrigLevel` is a sticky user control: trig drag / dblclick clear / guide paint / `trigLocked`. Trig drag-end and freeze toggle call `notifyclients()`, so Live dirtied and saved a state blob that dropped the armed trigger.

**Probe** (pre-fix, vm sandbox of built `devices/Oscilloscope.amxd`):
```
oscTrigLevel = 0.42
getvalueof() → [4, 0, 0, 0, 1, 30, 0, 0]   // blobHasTrigField = false
setvalueof(blob) → oscTrigLevel === 0         // FAIL_trig_roundtrip = true
```

**Fix:** Blob v5 adds `trigLevel` as the 9th element; old v4 8-element blobs still load with `trigLevel = 0`. See Pass 3 section above for file touchpoints.

**Not filed:** `oscFrozen` is also unpersisted, but Freeze is momentary live-display state (sand pass 1 precedent: do not invent nits). Left unpersisted in pass 3.

**Test:** `tests/test_oscilloscope.js` section 7 — `"trigger level survives a getvalueof/setvalueof round-trip"` — green after the fix.

## Out of scope (owned elsewhere)

- Shared `buffer~ #0-analyzerscope` / `setbuffer #0-analyzerscope` name in a top-level device (`src/oscilloscope_ui.js:13`, `scripts/build_oscilloscope.py:62,66,67`) — already covered by analyzer-scope pass 2; fix in pass 3 of that device.

# BUGS.md — Better Shaper PASS 1

Branch: `bugsweep/shaper-pass1`
Worktree: `/private/tmp/bugsweep/shaper`
Rule: PASS 1 finds bugs and adds RED tests only — do not fix production code here.

## Confirmed bugs

### 1. Multi-select vertical drag deletes unselected points between the selection

- **Where**: `src/mseg_edit.js:83-89` (`msegMoveSelection`)
- **What**: After pushing per-point travel intervals, when `sweepIntervals.length >= 2` the code also pushes the bounding union `[minSpan, maxSpan]` of *all* intervals. Selecting two or more interior points always hits that branch (each interior still pushes two near-degenerate intervals even when `dx === 0`), so a pure vertical group move deletes every unselected point whose `x` lies between the leftmost and rightmost selected `x`.
- **Why it is wrong**: Contradicts the comment at `src/mseg_edit.js:41` (“An unselected point whose x lies on a selected point's travel is removed”). A pure vertical move has no horizontal travel, so intervening points must survive.
- **Repro (Node)**: five points at x=`0,0.25,0.5,0.75,1`; select ids `[2,4]`; call `msegMoveSelection(..., primaryId=2, targetX=0.25, targetY=0.55, ...)`. Point id `3` at x=`0.5` is removed; result ids `1,2,4,5`.
- **RED test**: `tests/test_shaper_bugsweep.js` (run: `node tests/test_shaper_bugsweep.js`; expected FAIL on current code). Verified RED on this branch (AssertionError: middle point 3 deleted).

## Notes

- No other credible bugs locked in this pass yet; further review may add entries and RED cases.
- Host gate (`npm run -s typecheck && python3 scripts/build_shaper.py && node tests/test_shaper.js`) does not run `tests/test_shaper_bugsweep.js`; run that file separately to see the RED failure.

## PASS 2 review

- **Kept 1 / Dropped 0.** Bug 1 confirmed real UI bug, not intentional sweep: L41 comment limits deletes to an unselected point on a selected point's travel; on `dx === 0` interiors still push near-degenerate intervals and L83-89 unions the whole selection span, so intervening points die. RED re-verified FAIL on unfixed code (`node tests/test_shaper_bugsweep.js` → AssertionError, ids `1,2,4,5`).
- Host gate green on unfixed code: `npm run -s typecheck && python3 scripts/build_shaper.py && node tests/test_shaper.js` (GATE_EXIT:0). Bugsweep remains RED (BUGSWEEP_EXIT:1).
- No strengthen needed; no additional bugs found in `src/mseg_edit.js` (104 lines; file ends at `msegMoveSelection`). Production/src untouched (pass 3).

## PASS 3 fix

- **Fixed 1 / Deferred 0.** Bug 1 fixed in `src/mseg_edit.js` `msegMoveSelection`: guarded the bounding-union sweepIntervals push with `dx !== 0`, so a pure vertical multi-select drag (dx === 0) no longer unions the whole selection span and no longer deletes intervening unselected points. Per-point travel intervals still apply, preserving intentional horizontal-sweep deletes for dx !== 0.
- **Red now green**: `node tests/test_shaper_bugsweep.js` passes (middle point id 3 survives; ids 1,2,3,4,5; selected points 2 and 4 keep x=0.25/0.75). Full host gate green end-to-end: `npm run -s typecheck && python3 scripts/build_shaper.py && node tests/test_shaper.js && node tests/test_shaper_bugsweep.js` (GATE_BUGSWEEP_EXIT:0). Rebuilt `devices/Better Shaper.amxd` (1383889 bytes).
- Commit: pending on `bugsweep/shaper-pass1`; not merged to main.

## PASS 4 review

- **APPROVED.** Bug 1 fix confirmed minimal and correct: `src/mseg_edit.js:85` gates the bounding-union push with `dx !== 0 && sweepIntervals.length >= 2`; per-point travel pushes (L79-80) and the filter (L93-103) are unchanged, so dx !== 0 horizontal-sweep deletes remain. RED test still asserts middle point id 3 survives a pure vertical multi-select of ids 2+4 (primary at x=0.25, y to 0.55), length stays 5, and selected points keep x=0.25/0.75. No drive-by refactors; no test weakening.
- Host gate re-verified green on tip 3c91f90: `npm run -s typecheck && python3 scripts/build_shaper.py && node tests/test_shaper.js && node tests/test_shaper_bugsweep.js` (GATE_BUGSWEEP_EXIT:0). Rebuilt `devices/Better Shaper.amxd` (1383889 bytes).
- No follow-up code changes in this pass; note-only commit next. Not merged to main.

---

# Reciprocator — Bug Sweep (pass 1 reds)

Branch: `bugsweep/reciprocator`
Worktree: `/tmp/bugsweep/reciprocator`
Baseline: `69699f7` (pre-bugsweep; prior Delay/linkAmt/gateMix/gate-curve fixes already present and green)

## Pass 1 outcome

| Claim | Verdict | Notes |
|-------|---------|-------|
| Bug A — `#0-recipscope` shared across instances | **CLAIMED (RED)** | Top-level Live device; `#0` not expanded. Same class as Amp+/EnvTrig/Cepstra/Tiny Space/mbsplit. |
| Prior bugs 1–4 (gate curve / lookahead / Detect link / gateMix) | Cleared | Already fixed at baseline; `node tests/test_reciprocator.js` → ok; section 9 green. |
| Gate/Ceiling viz drag undo | Noted, not claimed | Outlets `set` into live.dials with no `pushUndoState`; live.param undo path differs from blob MSEG rule — not promoted. |
| Gen vs JS gate/ceiling mirror | Cleared | `computeGateFactor` / `computeRecipGain` match `gate_smooth` / recip path; Amount-0 mute contract holds. |

**Claimed 1 / noted 1 / cleared prior 4.**

## Bug A (claimed): Scope buffer `#0-recipscope` is shared by every instance

- **Where:** `scripts/build_reciprocator.py` (`buffer~ #0-recipscope @samps 32`, `scope #0-recipscope`, `setbuffer #0-recipscope`); comments in `src/reciprocator_core.genexpr` / `src/reciprocator_config.js`; existing `tests/test_reciprocator.js` still requires `#0-`.
- **Evidence:** AGENTS.md documents that Live does not expand `#0` in a top-level device patcher (Multiband Split / Glitch / Delay+). Peer devices migrated to `---…`. Reciprocator is a top-level `.amxd`, so every instance writes the same 32-sample scope ring and faces paint each other's telemetry.
- **Impact:** Multi-instance sets show wrong ENV/OUT/gate meters; deferred DSP frame counter is also shared.
- **Red:** `tests/test_reciprocator_bugsweep.js` — asserts build + amxd use `---recipscope` and contain no `#0-recipscope`.
- **Host proof (pass 1):**
  ```
  node tests/test_reciprocator.js → test_reciprocator: ok
  node tests/test_reciprocator_bugsweep.js → AssertionError Bug A RED (exit 1)
  ```
- **Status:** RED. Pass 3 will flip build/bind messages to `---recipscope`, rebuild the amxd, update `test_reciprocator.js` `#0-` asserts, and clear gen/config comments.

