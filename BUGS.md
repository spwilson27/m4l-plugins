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
