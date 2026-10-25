#!/usr/bin/env node
/**
 * Pass 1 red tests: stdio MCP protocol handling in scripts/ableton_mcp_server.js
 * and HTTP JSON handling in src/ableton_mcp_node.js
 * (tests/test_ableton_mcp_stdio_http.js). See BUGS.md at the repo root of this worktree.
 *
 * These spawn the real server/bridge as child processes (plain Node, no Live/Max):
 * the bridge is loaded via the global.__MAX_API_MOCK__ fallback path.
 */

const assert = require("assert");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpRequest(opts) {
    return new Promise((resolve) => {
        const body = opts.body || "";
        const req = http.request(
            { hostname: "127.0.0.1", port: opts.port, path: opts.path, method: opts.method, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 2500 },
            (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
            }
        );
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.on("error", () => resolve(null));
        if (body) req.write(body);
        req.end();
    });
}

async function testRpcNullBody() {
    const port = 19931;
    const child = spawn(
        process.execPath,
        ["-e", "global.__MAX_API_MOCK__={post:function(){},outlet:function(){},addHandler:function(){}}; require(process.argv[1]);", path.join(ROOT, "src", "ableton_mcp_node.js")],
        { env: Object.assign({}, process.env, { ABLETON_MCP_PORT: String(port) }), stdio: ["ignore", "pipe", "pipe"] }
    );
    let childErr = "";
    child.stderr.on("data", (d) => { childErr += d; });
    try {
        let health = null;
        for (let i = 0; i < 25 && !health; i++) {
            health = await httpRequest({ port: port, method: "GET", path: "/health", body: "" });
            if (!health) await sleep(200);
        }
        assert.ok(health && health.status === 200, "bridge did not come up on test port " + port + ": " + childErr.slice(0, 400));
        const res = await httpRequest({ port: port, method: "POST", path: "/rpc", body: "null" });
        assert.ok(res, "no HTTP response to a valid-JSON null /rpc body (bridge hung or crashed); stderr: " + childErr.slice(0, 400));
        assert.strictEqual(JSON.parse(res.text).ok, false, "expected ok:false for null body, got: " + res.text);
        const health2 = await httpRequest({ port: port, method: "GET", path: "/health", body: "" });
        assert.ok(health2 && health2.status === 200, "bridge not healthy after null /rpc body");
    } finally {
        try { child.kill("SIGKILL"); } catch (_) {}
    }
}

async function testStdioParseError() {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "ableton_mcp_server.js")], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    try {
        child.stdin.write("{this is not json}\n");
        await sleep(600);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping" }) + "\n");
        await sleep(900);
        const msgs = out.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
        const pong = msgs.find((m) => m.id === 99);
        assert.ok(pong, "no response to a valid ping after the bad line (server died?); raw stdout: " + out.slice(0, 300));
        const parseErr = msgs.find((m) => m.error && m.error.code === -32700);
        assert.ok(parseErr, "invalid JSON line produced no JSON-RPC -32700 parse error response, so a client waits forever; responses seen: " + JSON.stringify(msgs));
        assert.strictEqual(parseErr.id, null);
    } finally {
        try { child.kill("SIGKILL"); } catch (_) {}
    }
}

(async () => {
    try { await testRpcNullBody(); } catch (e) { failures.push("BUG-MCP-4 POST /rpc with a JSON null body must return ok:false and keep the bridge alive: " + e.message); }
    try { await testStdioParseError(); } catch (e) { failures.push("BUG-MCP-5 stdio server must answer invalid JSON with a -32700 parse error (id null): " + e.message); }
    if (failures.length) {
        console.error("Pass 1 red tests FAILED (" + failures.length + "):\n - " + failures.join("\n - "));
        process.exit(1);
    }
    console.log("All Ableton MCP Bridge stdio/HTTP pass 1 tests passed!");
})();
