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
