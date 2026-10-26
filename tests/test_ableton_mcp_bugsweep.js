#!/usr/bin/env node
/**
 * Pass 1 bugsweep red tests for the Ableton MCP Bridge
 * (tests/test_ableton_mcp_bugsweep.js). See BUGS.md at the worktree root.
 *
 * Covers BUG-MCP-6..11 plus BUG-MCP-12..14,16 (i1 sweep, appended at the end; BUG-MCP-15 was rejected and removed in Pass 2 i1 — no spec/code evidence for a 413 limit); BUG-MCP-1..5 live in tests/test_ableton_mcp.js
 * and tests/test_ableton_mcp_stdio_http.js and are not duplicated here.
 * LOM tests run the real src/ableton_mcp_lom.js in a vm sandbox with a mock
 * LiveAPI (same style as tests/test_ableton_mcp.js); bridge/MCP tests spawn
 * the real node files as child processes via the __MAX_API_MOCK__ fallback.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- LOM sandbox
function makeLomSandbox() {
    const emitted = [];
    const sandbox = {
        Math, Date, Number, String, Boolean, Array, Object, JSON, Error, Function, parseInt, isNaN,
        Global: function() { return { peers: {}, groups: {} }; },
        LiveAPI: function(cb, target) {
            const p = String(target || "live_set");
            this.path = p;
            this.unquotedpath = p;
            this.id = 10;
            this.type = "Song";
            this.getcount = function(child) {
                if (p === "live_set" && child === "tracks") return 1;
                if (p === "live_set" && child === "return_tracks") return 0;
                if (p === "live_set" && child === "scenes") return 8;
                if (p === "live_set tracks 0" && child === "devices") return 1;
                if (child === "parameters") return 2;
                return 0;
            };
            this.get = function(prop) {
                if (prop === "tempo") return [128.0];
                if (prop === "signature_numerator") return [4];
                if (prop === "signature_denominator") return [4];
                if (prop === "name") return ["Synth Bass"];
                if (prop === "value") return [120.0];
                if (prop === "min") return [20.0];
                if (prop === "max") return [20000.0];
                return [0]; // loop, loop_start, loop_length, metronome, ... are all 0
            };
            this.set = function() {};
            this.call = function() { return "ok"; };
        },
        mgraphics: { size: [248, 157], relative_coords: 1, autofill: 1, init: function() {}, redraw: function() {}, set_source_rgba: function() {}, set_line_width: function() {}, rectangle: function() {}, rectangle_rounded: function() {}, move_to: function() {}, line_to: function() {}, arc: function() {}, fill: function() {}, stroke: function() {}, select_font_face: function() {}, set_font_size: function() {}, show_text: function() {} },
        inlets: 1,
        outlets: 1,
        outlet: function(idx, msg) { emitted.push(msg); }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "src", "ableton_mcp_lom.js"), "utf8"), sandbox);
    const rpc = (id, payload) => { sandbox.lom_rpc(id, JSON.stringify(payload)); return JSON.parse(emitted.pop()[2]); };
    return rpc;
}

function testTrackIndexOutOfRange() {
    const rpc = makeLomSandbox();
    for (const badIndex of [5, -1]) {
        const rep = rpc("t" + badIndex, { action: "get_tracks_tree", params: { trackIndex: badIndex } });
        assert.ok(
            rep.ok === false || (rep.result && Array.isArray(rep.result.tracks) && rep.result.tracks.length === 0),
            "trackIndex " + badIndex + " on a 1-track set must error or return zero tracks, got ok=" + rep.ok +
                " tracks=" + (rep.result && rep.result.tracks ? rep.result.tracks.length : "?") +
                " (the full tree was returned for a track that does not exist)"
        );
    }
}

function testMaxParametersZero() {
    const rpc = makeLomSandbox();
    const rep = rpc("mp1", { action: "get_device_parameters", params: { path: "live_set tracks 0 devices 0", maxParameters: 0 } });
    assert.strictEqual(rep.ok, true);
    assert.strictEqual(rep.result.parameters.length, 0, "maxParameters: 0 must return 0 parameters, got " + rep.result.parameters.length);
    const rep2 = rpc("mp2", { action: "get_tracks_tree", params: { includeParameters: true, maxParameters: 0 } });
    assert.strictEqual(rep2.ok, true);
    assert.strictEqual(rep2.result.tracks[0].devices[0].parameters.length, 0, "get_tracks_tree with maxParameters: 0 must return 0 parameters per device, got " + rep2.result.tracks[0].devices[0].parameters.length);
}

function testLoopLengthZero() {
    const rpc = makeLomSandbox();
    const rep = rpc("ll1", { action: "get_session_info", params: {} });
    assert.strictEqual(rep.ok, true);
    assert.strictEqual(rep.result.loop_length, 0, "Live reports loop_length 0 but get_session_info returned " + rep.result.loop_length);
}

// ------------------------------------------------------------- spawned bridge
async function testInvalidEnvPort() {
    const child = spawn(
        process.execPath,
        ["-e", "global.__MAX_API_MOCK__={post:function(){},outlet:function(){},addHandler:function(){}}; require(process.argv[1]);", path.join(ROOT, "src", "ableton_mcp_node.js")],
        { env: Object.assign({}, process.env, { ABLETON_MCP_PORT: "70000" }), stdio: ["ignore", "pipe", "pipe"] }
    );
    let err = "";
    let exited = null;
    child.stderr.on("data", (d) => { err += d; });
    child.on("exit", (c) => { exited = c; });
    try {
        let registered = false;
        for (let i = 0; i < 20 && !registered && exited === null; i++) {
            await sleep(200);
            try {
                const reg = JSON.parse(fs.readFileSync("/tmp/ableton_mcp_sessions.json", "utf8")) || {};
                registered = Object.values(reg).some((s) => s && s.node_pid === child.pid);
            } catch (_) {}
        }
        assert.strictEqual(exited, null, "bridge process exited (code " + exited + ") on ABLETON_MCP_PORT=70000 instead of falling back to a valid port; stderr: " + err.slice(0, 300));
        assert.ok(registered, "bridge with ABLETON_MCP_PORT=70000 never registered a session on a fallback port; stderr: " + err.slice(0, 300));
    } finally {
        try { child.kill("SIGTERM"); } catch (_) {}
        await sleep(150);
        try { child.kill("SIGKILL"); } catch (_) {}
    }
}

// --------------------------------------------------------------- spawned MCP
function spawnMcpServer() {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "ableton_mcp_server.js")], { stdio: ["pipe", "pipe", "pipe"] });
    const state = { out: "", err: "", exited: null };
    child.stdout.on("data", (d) => { state.out += d; });
    child.stderr.on("data", (d) => { state.err += d; });
    child.on("exit", (c) => { state.exited = c; });
    return { child, state };
}

function parseStdioMessages(out) {
    const msgs = [];
    const re = /Content-Length:\s*(\d+)\r?\n\r?\n/g;
    let m;
    let framed = false;
    while ((m = re.exec(out)) !== null) {
        framed = true;
        const body = out.slice(re.lastIndex, re.lastIndex + Number(m[1]));
        try { msgs.push(JSON.parse(body)); } catch (_) {}
        re.lastIndex += Number(m[1]);
    }
    if (!framed) {
        for (const line of out.split("\n").filter(Boolean)) {
            try { msgs.push(JSON.parse(line)); } catch (_) {}
        }
    }
    return msgs;
}

async function testSplitContentLengthHeader() {
    const { child, state } = spawnMcpServer();
    try {
        const pingMsg = JSON.stringify({ jsonrpc: "2.0", id: 42, method: "ping" });
        child.stdin.write("Content-Length: " + Buffer.byteLength(pingMsg) + "\r\n");
        await sleep(400); // header line and its terminating blank line arrive in separate chunks
        child.stdin.write("\r\n" + pingMsg);
        await sleep(1000);
        const msgs = parseStdioMessages(state.out);
        const pong = msgs.find((x) => x.id === 42);
        assert.ok(pong, "no response to a Content-Length framed ping whose header was split across chunks; raw stdout: " + state.out.slice(0, 300));
        const parseErr = msgs.find((x) => x.error && x.error.code === -32700);
        assert.ok(!parseErr, "split Content-Length header produced a spurious -32700 parse error: " + state.out.slice(0, 300));
    } finally {
        try { child.kill("SIGKILL"); } catch (_) {}
    }
}

async function testInvalidToolPort() {
    const { child, state } = spawnMcpServer();
    try {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ableton_ping", arguments: { port: 99999 } } }) + "\n");
        await sleep(1200);
        let msgs = parseStdioMessages(state.out);
        const resp7 = msgs.find((x) => x.id === 7);
        assert.ok(resp7, "no JSON-RPC response to tools/call with port 99999 (server exit code: " + state.exited + "); stderr: " + state.err.slice(0, 300));
        assert.ok(resp7.result && resp7.result.isError === true, "tools/call with port 99999 must return an isError tool result, got: " + JSON.stringify(resp7).slice(0, 300));
        assert.strictEqual(state.exited, null, "MCP server process died after tools/call with port 99999; stderr: " + state.err.slice(0, 300));
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 8, method: "ping" }) + "\n");
        await sleep(800);
        msgs = parseStdioMessages(state.out);
        assert.ok(msgs.find((x) => x.id === 8), "server did not answer a ping after the bad-port tools/call; raw stdout: " + state.out.slice(0, 300));
    } finally {
        try { child.kill("SIGKILL"); } catch (_) {}
    }
}

(async () => {
    try { testTrackIndexOutOfRange(); } catch (e) { failures.push("BUG-MCP-6 get_tracks_tree with an out-of-range trackIndex returns the full tree instead of no tracks: " + e.message); }
    try { testMaxParametersZero(); } catch (e) { failures.push("BUG-MCP-7 maxParameters: 0 is ignored (falsy default) and parameters are returned anyway: " + e.message); }
    try { testLoopLengthZero(); } catch (e) { failures.push("BUG-MCP-8 get_session_info reports loop_length 4 when Live reports 0 (falsy default): " + e.message); }
    try { await testInvalidEnvPort(); } catch (e) { failures.push("BUG-MCP-9 bridge crashes on an out-of-range ABLETON_MCP_PORT instead of falling back: " + e.message); }
    try { await testSplitContentLengthHeader(); } catch (e) { failures.push("BUG-MCP-10 stdio server loses a Content-Length framed message whose header is split across chunks: " + e.message); }
    try { await testInvalidToolPort(); } catch (e) { failures.push("BUG-MCP-11 one tools/call with an out-of-range port kills the MCP server with no response: " + e.message); }
    try { testDeleteDeviceOutOfRange(); } catch (e) { failures.push("BUG-MCP-12 delete_device with an out-of-range or fractional deviceIndex reports success and calls LiveAPI delete_device anyway: " + e.message); }
    try { testFractionalTrackIndex(); } catch (e) { failures.push("BUG-MCP-13 get_tracks_tree with a fractional trackIndex returns a phantom track instead of an error or no tracks: " + e.message); }
    try { await testNotificationGetsNoResponse(); } catch (e) { failures.push("BUG-MCP-14 stdio server answers a JSON-RPC notification (no id) with an id-less response: " + e.message); }
    try { await testContentTypeHeaderFraming(); } catch (e) { failures.push("BUG-MCP-16 a Content-Type header before a Content-Length frame produces a spurious -32700 parse error: " + e.message); }
    if (failures.length) {
        console.error("Bugsweep red tests FAILED (" + failures.length + "):\n - " + failures.join("\n - "));
        process.exit(1);
    }
    console.log("All Ableton MCP Bridge bugsweep tests passed!");
})();

// ------------------------------------------------------------ BUG-MCP-12..16
function makeRecordingLomSandbox() {
    const emitted = [];
    const calls = [];
    const sandbox = {
        Math, Date, Number, String, Boolean, Array, Object, JSON, Error, Function, parseInt, isNaN,
        Global: function() { return { peers: {}, groups: {} }; },
        LiveAPI: function(cb, target) {
            const p = String(target || "live_set");
            this.path = p;
            this.unquotedpath = p;
            this.id = 10;
            this.type = "Song";
            this.getcount = function(child) {
                if (p === "live_set" && child === "tracks") return 1;
                if (p === "live_set" && child === "return_tracks") return 0;
                if (p === "live_set" && child === "scenes") return 8;
                if (p === "live_set tracks 0" && child === "devices") return 1;
                if (child === "parameters") return 2;
                return 0;
            };
            this.get = function(prop) {
                if (prop === "tempo") return [128.0];
                if (prop === "signature_numerator") return [4];
                if (prop === "signature_denominator") return [4];
                if (prop === "name") return ["Synth Bass"];
                if (prop === "value") return [120.0];
                if (prop === "min") return [20.0];
                if (prop === "max") return [20000.0];
                return [0];
            };
            this.set = function() {};
            this.call = function(method, arg) { calls.push({ path: p, method: method, arg: arg }); return "ok"; };
        },
        mgraphics: { size: [248, 157], relative_coords: 1, autofill: 1, init: function() {}, redraw: function() {}, set_source_rgba: function() {}, set_line_width: function() {}, rectangle: function() {}, rectangle_rounded: function() {}, move_to: function() {}, line_to: function() {}, arc: function() {}, fill: function() {}, stroke: function() {}, select_font_face: function() {}, set_font_size: function() {}, show_text: function() {} },
        inlets: 1,
        outlets: 1,
        outlet: function(idx, msg) { emitted.push(msg); }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "src", "ableton_mcp_lom.js"), "utf8"), sandbox);
    const rpc = (id, payload) => { sandbox.lom_rpc(id, JSON.stringify(payload)); return JSON.parse(emitted.pop()[2]); };
    return { rpc: rpc, calls: calls };
}

function testDeleteDeviceOutOfRange() {
    const env = makeRecordingLomSandbox();
    for (const badIndex of [5, 0.5]) {
        env.calls.length = 0;
        const rep = env.rpc("del" + badIndex, { action: "delete_device", params: { parentPath: "live_set tracks 0", deviceIndex: badIndex } });
        assert.strictEqual(rep.ok, false, "delete_device with deviceIndex " + badIndex + " on a 1-device parent must error, got: " + JSON.stringify(rep));
        assert.deepStrictEqual(env.calls.filter((c) => c.method === "delete_device"), [], "LiveAPI delete_device must not be called for deviceIndex " + badIndex);
    }
}

function testFractionalTrackIndex() {
    const rpc = makeLomSandbox();
    const rep = rpc("ft1", { action: "get_tracks_tree", params: { trackIndex: 0.5 } });
    assert.ok(rep.ok === false || (rep.result && Array.isArray(rep.result.tracks) && rep.result.tracks.length === 0), "trackIndex 0.5 must error or return zero tracks, got ok=" + rep.ok + " tracks=" + (rep.result && rep.result.tracks ? rep.result.tracks.length : "?"));
}

async function testNotificationGetsNoResponse() {
    const { child, state } = spawnMcpServer();
    try {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "ping" }) + "\n");
        await sleep(800);
        const before = parseStdioMessages(state.out);
        assert.strictEqual(before.length, 0, "a JSON-RPC notification (no id) must not be answered, got: " + state.out.slice(0, 300));
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 55, method: "ping" }) + "\n");
        await sleep(800);
        const msgs = parseStdioMessages(state.out);
        assert.ok(msgs.find((x) => x.id === 55), "server did not answer a normal ping (id 55) after the notification; raw stdout: " + state.out.slice(0, 300));
    } finally {
        try { child.kill("SIGKILL"); } catch (_) {}
    }
}


async function testContentTypeHeaderFraming() {
    const { child, state } = spawnMcpServer();
    try {
        const pingMsg = JSON.stringify({ jsonrpc: "2.0", id: 44, method: "ping" });
        child.stdin.write("Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: " + Buffer.byteLength(pingMsg) + "\r\n\r\n" + pingMsg);
        await sleep(1200);
        const msgs = parseStdioMessages(state.out);
        assert.ok(msgs.find((x) => x.id === 44), "no pong for a Content-Length framed ping preceded by a Content-Type header; raw stdout: " + state.out.slice(0, 300));
        assert.ok(!state.out.includes("-32700"), "a Content-Type header produced a spurious -32700 parse error: " + state.out.slice(0, 300));
    } finally {
        try { child.kill("SIGKILL"); } catch (_) {}
    }
}
