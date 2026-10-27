# Sweep 2 lane report: ableton_mcp (Ableton MCP Bridge.amxd, scripts/ableton_mcp_server.js)

## Stage A+B summary
Host gate (typecheck, build, test_ableton_mcp, bugsweep, stdio_http, preview) pass; static 0 violations; face fuzz ok.
Live: vm_smoke PASS (bridge loads on two tracks, meters unchanged, panel renders correctly in Live, tests/out/smoke/ableton_mcp_bridge/).
Counts: S1 0, S2 3, S3 0, S4 9.

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| MCP-01 | S2 | RPCs on a LOM path that does not exist (LiveAPI id 0) report ok:true: lom_get, lom_set, lom_call, get_device_parameters (set_device_parameter and delete_device already error). Callers cannot tell a no-op from success. | mock LiveAPI with id 0 for unknown paths | tests/test_ableton_mcp_sweep2.js MCP-01 |
| MCP-02 | S2 | get/set_device_parameter read at most 128 parameters (`readParameterList(path,128)`); Mega Modulator has 257, so paramIndex/paramName beyond 127 are "not found" and the listing truncates silently with no total. | handleSetDeviceParameter | MCP-02 |
| MCP-03 | S2 (security) | Bridge sends `Access-Control-Allow-Origin: *`, never checks Origin/Host: any web page can POST text/plain to 127.0.0.1:9877/rpc (eval_js = arbitrary code in Max, delete_device, lom_set) or /shutdown; DNS rebinding works too. Fix: reject requests with an Origin header or a non-loopback Host (403); node clients unaffected. | spawned bridge, Origin: http://evil.example gets 200 | MCP-03 |
| MCP-04 | S4 | Doc drift: AGENTS s13 says a [PING] button and an "RPCs: n" info strip with [CLEAR]; code has "Refresh LOM" / "Clear Log" buttons, title "ABLETON MCP BRIDGE", log y=52..132. `ableton_ping` doc says tempo/playing state; code returns bridge/version/this_device_path/timestamp. | src/ableton_mcp_lom.js | log only |
| MCP-05 | S4 | Port scan tries 17 ports (9877..9893) not 9877..9892; `ableton_list_sessions` only probes 9877..9884 plus the registry file (tool text says 9877..9884). Registry is read-modify-write without locking and never pruned. | node.js MAX_PORT_SCAN | log only |
| MCP-06 | S4 | Face keeps text "LOM + Global Bus Ready" and "Waiting for ... 127.0.0.1:9877" when status is STARTING/ERR:*; port shown is stale after an error. | paint() | log only |
| MCP-07 | S4 | A second Bridge in the same Live shuts the first's listener (same max_ppid); the first keeps showing ONLINE and never re-listens. | startListening | log only |
| MCP-08 | S4 | transport: tempo is applied before an unknown action is rejected (error reply but tempo changed). | handleTransport | log only |
| MCP-09 | S4 | No request body size limit; `/health?x` 404s (exact URL match); node RPC timeout equals client timeout (8000 ms) so the client usually reports a generic timeout instead of the bridge's error; JSON-RPC batch arrays are silently ignored by the stdio server; error text hard-codes a user path. | node.js / server.js | log only |
| MCP-10 | S4 | A reply whose JSON.stringify throws logs an OK entry then an error entry in the face log (double entry). eval_js is unrestricted by design (test tool); an infinite loop blocks Live's main thread. | lom_rpc | log only |

## Red tests
tests/test_ableton_mcp_sweep2.js (fails with 3 failures: MCP-01, MCP-02, MCP-03; each for the stated reason).
Compatibility note for the fixer: keep every action name and success shape; MCP-01 changes only the missing-path case, MCP-02 may add `total_parameters`, MCP-03 must not affect clients that send no Origin header.

## Verify
Stage C (independent): ran tests/test_ableton_mcp_sweep2.js, 3 failures, each for the stated reason.
- MCP-01 KEEP: real user-visible bug (caller cannot tell a no-op from success); set/delete already error on id 0, so expectation is consistent; no repo script relies on ok:true for a missing path; deterministic (mock LiveAPI id 0).
- MCP-02 KEEP: Mega Modulator has 257 parameters (AGENTS s21), so index/name >127 "not found" is real (hard-coded 128 in handleSetDeviceParameter); test accepts total_parameters or full list, so fix is backward compatible.
- MCP-03 KEEP: cross-origin/foreign-Host RPC is accepted (status 200); expectation 403 is right, plain clients without Origin and Host 127.0.0.1:port (incl. ssh-tunnel local ports) are unaffected and asserted. Not flaky (random port, health wait loop).
- MCP-04..MCP-10 (S4, log only, no tests): accepted as log items, no test to delete.
Rejected: none.
