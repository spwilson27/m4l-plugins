#!/usr/bin/env node
/**
 * Sweep 2 red tests for the Ableton MCP Bridge (see sweep/ableton_mcp.md).
 *  MCP-01  LOM actions on a path that does not exist report success (real LiveAPI gives id 0).
 *  MCP-02  get/set_device_parameter silently cap the parameter list at 128 (Mega Modulator has 257).
 *  MCP-03  The HTTP bridge accepts cross-origin / foreign-Host requests (any web page can POST
 *          /rpc eval_js or /shutdown to 127.0.0.1).
 * LOM tests run the real src/ableton_mcp_lom.js in a vm sandbox with a mock LiveAPI whose unknown
 * paths have id 0 (as in Live); the HTTP test spawns the real node file with a mock max-api.
 */
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeSandbox(nParams) {
    const emitted = [];
    const calls = [];
    const sets = [];
    const known = /^live_set( tracks 0( devices 0( parameters \d+)?)?)?$/;
    const sandbox = {
        Math, Date, Number, String, Boolean, Array, Object, JSON, Error, Function, parseInt, isNaN,
        Global: function() { return { peers: {}, groups: {} }; },
        LiveAPI: function(cb, target) {
            const p = String(target || "live_set");
            const exists = known.test(p) && !/parameters (\d+)$/.test(p) || (function() {
                const m = p.match(/^live_set tracks 0 devices 0 parameters (\d+)$/);
                return !!m && Number(m[1]) < nParams;
            })();
            this.path = p;
            this.unquotedpath = exists ? p : "";
            this.id = exists ? 10 : 0;
            this.type = exists ? "Thing" : "";
            const idx = (p.match(/parameters (\d+)$/) || [])[1];
            this.getcount = function(child) {
                if (!exists) return 0;
                if (p === "live_set" && child === "tracks") return 1;
                if (p === "live_set tracks 0" && child === "devices") return 1;
                if (p === "live_set tracks 0 devices 0" && child === "parameters") return nParams;
                return 0;
            };
            this.get = function(prop) {
                if (!exists) return [];
                if (prop === "name") return [idx !== undefined ? "P" + idx : "Dev"];
                if (prop === "value") return [0.5];
                if (prop === "min") return [0];
                if (prop === "max") return [1];
                return [0];
            };
            this.set = function(prop, v) { sets.push({ path: p, prop: prop, value: v }); };
            this.call = function(method) { calls.push({ path: p, method: method }); return exists ? "ok" : undefined; };
        },
        mgraphics: { size: [248, 157], relative_coords: 1, autofill: 1, init: function() {}, redraw: function() {} },
        inlets: 1, outlets: 1,
        outlet: function(i, msg) { emitted.push(msg); }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "src", "ableton_mcp_lom.js"), "utf8"), sandbox);
    const rpc = (id, payload) => { sandbox.lom_rpc(id, JSON.stringify(payload)); return JSON.parse(emitted.pop()[2]); };
    return { rpc, calls, sets };
}

function testMissingPath() {
    const env = makeSandbox(4);
    const missing = "live_set tracks 99 devices 0";
    const cases = [
        ["lom_get", { path: missing, property: "name" }],
        ["lom_set", { path: missing, property: "mute", value: 1 }],
        ["lom_call", { path: missing, method: "stop" }],
        ["get_device_parameters", { path: missing }],
        ["set_device_parameter", { path: missing, paramIndex: 0, value: 0.5 }],
    ];
    const bad = [];
    for (const c of cases) {
        const rep = env.rpc("m" + c[0], { action: c[0], params: c[1] });
        if (rep.ok !== false) bad.push(c[0] + " -> ok:" + rep.ok);
    }
    assert.deepStrictEqual(bad, [], "RPCs on a LOM path that does not exist (LiveAPI id 0) must return ok:false, but: " + bad.join(", "));
}

function testParameterCap() {
    const env = makeSandbox(257);
    const dev = "live_set tracks 0 devices 0";
    const rep = env.rpc("cap1", { action: "set_device_parameter", params: { path: dev, paramIndex: 200, value: 0.25 } });
    assert.strictEqual(rep.ok, true, "set_device_parameter paramIndex 200 on a 257-parameter device failed: " + JSON.stringify(rep));
    assert.ok(env.sets.some((s) => s.path === dev + " parameters 200" && s.prop === "value"), "parameter 200 was not written");
    const rep2 = env.rpc("cap2", { action: "set_device_parameter", params: { path: dev, paramName: "P250", value: 0.25 } });
    assert.strictEqual(rep2.ok, true, "set_device_parameter by name for parameter 250 failed: " + JSON.stringify(rep2));
    const rep3 = env.rpc("cap3", { action: "get_device_parameters", params: { path: dev } });
    assert.ok(rep3.ok && (rep3.result.parameters.length === 257 || typeof rep3.result.total_parameters === "number" && rep3.result.total_parameters === 257),
        "get_device_parameters silently truncates to " + (rep3.result && rep3.result.parameters.length) + " of 257 with no total/truncated indication");
}

// ------------------------------------------------------------- HTTP bridge
function spawnBridge(port) {
    const boot = "const h={};global.__MAX_API_MOCK__={post(){},addHandler(n,f){h[n]=f;}," +
        "outlet(n,id,json){ if(n==='lom_rpc') setImmediate(()=>h.lom_reply(id,JSON.stringify({ok:true,result:{ran:JSON.parse(json).action}}))); }};" +
        "require(process.argv[1]);";
    const child = spawn(process.execPath, ["-e", boot, path.join(ROOT, "src", "ableton_mcp_node.js")],
        { env: Object.assign({}, process.env, { ABLETON_MCP_PORT: String(port) }), stdio: "ignore" });
    return child;
}

function request(port, method, urlPath, headers, body) {
    return new Promise((resolve) => {
        const req = http.request({ hostname: "127.0.0.1", port, path: urlPath, method, headers: headers || {}, timeout: 2500 }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", (e) => resolve({ status: 0, body: String(e.code || e.message) }));
        req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "timeout" }); });
        if (body) req.write(body);
        req.end();
    });
}

async function testForeignOrigin() {
    const port = 19000 + Math.floor(Math.random() * 900);
    const child = spawnBridge(port);
    try {
        let up = false;
        for (let i = 0; i < 25 && !up; i++) { await sleep(150); up = (await request(port, "GET", "/health")).status === 200; }
        assert.ok(up, "bridge did not come up on " + port);
        // sanity: a plain (no Origin) client still works
        const ok = await request(port, "POST", "/rpc", { "Content-Type": "application/json" }, JSON.stringify({ action: "ping" }));
        assert.strictEqual(ok.status, 200, "plain RPC must keep working, got " + ok.status + " " + ok.body);
        // a browser page on another origin ("simple" CORS request: text/plain needs no preflight)
        const evil = await request(port, "POST", "/rpc",
            { "Content-Type": "text/plain", "Origin": "http://evil.example" }, JSON.stringify({ action: "eval_js", params: { code: "return 1" } }));
        assert.ok(evil.status === 403, "a cross-origin POST /rpc (Origin: http://evil.example) was executed (status " + evil.status + "); expected 403");
        // DNS-rebinding style: foreign Host header
        const rebind = await request(port, "POST", "/rpc", { "Host": "evil.example:" + port, "Content-Type": "application/json" }, JSON.stringify({ action: "ping" }));
        assert.ok(rebind.status === 403 || rebind.status === 400, "an RPC with Host: evil.example was served (status " + rebind.status + ")");
        const sd = await request(port, "POST", "/shutdown", { "Origin": "http://evil.example", "Content-Type": "text/plain" });
        const still = await request(port, "GET", "/health");
        assert.ok(sd.status === 403 && still.status === 200, "a cross-origin POST /shutdown stopped the bridge (status " + sd.status + ", health afterwards " + still.status + ")");
    } finally {
        try { child.kill("SIGKILL"); } catch (_) {}
    }
}

(async () => {
    try { testMissingPath(); } catch (e) { failures.push("MCP-01 " + e.message); }
    try { testParameterCap(); } catch (e) { failures.push("MCP-02 " + e.message); }
    try { await testForeignOrigin(); } catch (e) { failures.push("MCP-03 " + e.message); }
    if (failures.length) {
        console.error("Sweep2 red tests FAILED (" + failures.length + "):\n - " + failures.join("\n - "));
        process.exit(1);
    }
    console.log("All Ableton MCP Bridge sweep2 tests passed!");
})();
