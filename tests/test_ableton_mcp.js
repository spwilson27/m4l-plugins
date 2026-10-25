#!/usr/bin/env node
/**
 * Automated Unit & End-to-End Test Suite for `devices/Ableton MCP Bridge.amxd`
 * and `scripts/ableton_mcp_server.js` (`tests/test_ableton_mcp.js`).
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const AMXD_PATH = path.join(ROOT, "devices", "Ableton MCP Bridge.amxd");
const LOM_JS_PATH = path.join(ROOT, "src", "ableton_mcp_lom.js");

function parseAmxd(filePath) {
    const buf = fs.readFileSync(filePath);
    assert.strictEqual(buf.slice(0, 4).toString("ascii"), "ampf");
    assert.strictEqual(buf.slice(8, 12).toString("ascii"), "aaaa");
    assert.strictEqual(buf.slice(24, 28).toString("ascii"), "ptch");
    const jsonLen = buf.readUInt32LE(28);
    return JSON.parse(buf.slice(32, 32 + jsonLen).toString("utf8"));
}

// 1. Verify `.amxd` binary and layout rules
{
    const doc = parseAmxd(AMXD_PATH);
    const p = doc.patcher;
    assert.strictEqual(p.openinpresentation, 1);
    assert.deepStrictEqual(p.openrect, [0.0, 0.0, 260.0, 169.0]);
    const boxes = p.boxes.map((b) => b.box);
    const viz = boxes.find((b) => b.id === "obj-viz");
    const nodeBox = boxes.find((b) => b.id === "obj-node");
    const panel = boxes.find((b) => b.id === "obj-panel-bg");
    assert.ok(viz && viz.maxclass === "v8ui");
    assert.ok(nodeBox && nodeBox.maxclass === "node.codebox");
    assert.strictEqual(panel.background, 1);
    assert.strictEqual(boxes[boxes.length - 1].id, "obj-panel-bg", "Background panel must be last box");
}

// 2. Test LOM RPC handler inside a simulated Max v8ui + LiveAPI environment
{
    const lomCode = fs.readFileSync(LOM_JS_PATH, "utf8");
    const emitted = [];
    const mockLomState = {
        tempo: 128.0,
        is_playing: 1,
        deletedDevices: []
    };

    const sandbox = {
        Math,
        Date,
        Number,
        String,
        Boolean,
        Array,
        Object,
        JSON,
        Error,
        Function,
        parseInt,
        isNaN,
        Global: function(name) {
            return {
                peers: {
                    mbsplit_1: {
                        id: "mbsplit_1",
                        order: 1,
                        isDeleted: () => false,
                        getGroupKey: () => "rack:live_set tracks 0 devices 0",
                        getChainIndex: () => 0
                    }
                },
                groups: {
                    "rack:live_set tracks 0 devices 0": { numBands: 2, f1: 120, f2: 800, f3: 4500, slope: 1 }
                }
            };
        },
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
                if (p === "live_set tracks 0 devices 0" && child === "chains") return 2;
                if (p.indexOf("chains") !== -1 && child === "devices") return 1;
                if (child === "parameters") return 2;
                return 0;
            };
            this.get = function(prop) {
                if (prop === "tempo") return [mockLomState.tempo];
                if (prop === "is_playing") return [mockLomState.is_playing];
                if (prop === "signature_numerator") return [4];
                if (prop === "signature_denominator") return [4];
                if (prop === "name") {
                    if (p.indexOf("chains") !== -1 && p.indexOf("devices") !== -1) return ["Multiband Split"];
                    if (p === "live_set tracks 0 devices 0") return ["Audio Effect Rack"];
                    if (p.indexOf("parameters 0") !== -1) return ["Device On"];
                    if (p.indexOf("parameters 1") !== -1) return ["F1 Low"];
                    return ["Synth Bass"];
                }
                if (prop === "can_have_chains") {
                    return [p === "live_set tracks 0 devices 0" ? 1 : 0];
                }
                if (prop === "value") return [120.0];
                if (prop === "min") return [20.0];
                if (prop === "max") return [20000.0];
                return [0];
            };
            this.set = function(prop, val) {
                if (prop === "tempo") mockLomState.tempo = Number(val);
            };
            this.call = function(method, arg) {
                if (method === "delete_device") {
                    mockLomState.deletedDevices.push({ parent: p, index: arg });
                    return "ok";
                }
                if (method === "str_for_value") return valStr(arg);
                return "ok";
            };
            function valStr(v) { return String(v) + " Hz"; }
        },
        mgraphics: {
            size: [248, 157],
            relative_coords: 1,
            autofill: 1,
            init: function() {},
            redraw: function() { sandbox.paint(); },
            set_source_rgba: function() {},
            set_line_width: function() {},
            rectangle: function() {},
            rectangle_rounded: function() {},
            move_to: function() {},
            line_to: function() {},
            arc: function() {},
            fill: function() {},
            stroke: function() {},
            select_font_face: function() {},
            set_font_size: function() {},
            show_text: function() {}
        },
        inlets: 1,
        outlets: 1,
        outlet: function(idx, msg) { emitted.push(msg); }
    };

    vm.createContext(sandbox);
    vm.runInContext(lomCode, sandbox);
    assert.strictEqual(sandbox.mgraphics.relative_coords, 0);
    assert.strictEqual(sandbox.mgraphics.autofill, 0);

    // Test get_session_info
    sandbox.lom_rpc("1", JSON.stringify({ action: "get_session_info", params: {} }));
    const rep1 = JSON.parse(emitted.pop()[2]);
    assert.strictEqual(rep1.ok, true);
    assert.strictEqual(rep1.result.tempo, 128.0);

    // Test get_tracks_tree
    sandbox.lom_rpc("2", JSON.stringify({ action: "get_tracks_tree", params: { includeParameters: true } }));
    const rep2 = JSON.parse(emitted.pop()[2]);
    assert.strictEqual(rep2.ok, true);
    assert.strictEqual(rep2.result.tracks[0].devices[0].chains.length, 2);

    // Test delete_device
    sandbox.lom_rpc("3", JSON.stringify({ action: "delete_device", params: { path: "live_set tracks 0 devices 0 chains 1 devices 0" } }));
    const rep3 = JSON.parse(emitted.pop()[2]);
    assert.strictEqual(rep3.ok, true);
    assert.strictEqual(mockLomState.deletedDevices[0].parent, "live_set tracks 0 devices 0 chains 1");
    assert.strictEqual(mockLomState.deletedDevices[0].index, 0);

    // Test inspect_mbsplit
    sandbox.lom_rpc("4", JSON.stringify({ action: "inspect_mbsplit", params: {} }));
    const rep4 = JSON.parse(emitted.pop()[2]);
    assert.strictEqual(rep4.ok, true);
    assert.strictEqual(rep4.result.peers.length, 1);
    assert.strictEqual(rep4.result.liveSetMbsplitDevices.length, 2);
}

// 3. Pass 1 red tests: LOM executor argument validation (see BUGS.md at repo root of this worktree)
{
    const pass1Failures = [];
    const expectBugFixed = (name, fn) => { try { fn(); } catch (e) { pass1Failures.push(name + ": " + e.message); } };
    const sets = [];
    const calls = [];
    const emitted2 = [];
    const sandbox2 = {
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
                if (child === "parameters") return 2;
                return 0;
            };
            this.get = function(prop) {
                if (prop === "tempo") return [128.0];
                if (prop === "is_playing") return [1];
                if (prop === "signature_numerator") return [4];
                if (prop === "signature_denominator") return [4];
                if (prop === "name") {
                    if (p.indexOf("parameters 0") !== -1) return ["Device On"];
                    if (p.indexOf("parameters 1") !== -1) return ["F1 Low"];
                    return ["Synth Bass"];
                }
                if (prop === "value") return [120.0];
                if (prop === "min") return [20.0];
                if (prop === "max") return [20000.0];
                return [0];
            };
            this.set = function(prop, val) { sets.push({ path: p, prop: prop, val: val }); };
            this.call = function(method, arg) { calls.push({ path: p, method: method, arg: arg }); if (method === "str_for_value") return String(arg) + " Hz"; return "ok"; };
        },
        mgraphics: { size: [248, 157], relative_coords: 1, autofill: 1, init: function() {}, redraw: function() {}, set_source_rgba: function() {}, set_line_width: function() {}, rectangle: function() {}, rectangle_rounded: function() {}, move_to: function() {}, line_to: function() {}, arc: function() {}, fill: function() {}, stroke: function() {}, select_font_face: function() {}, set_font_size: function() {}, show_text: function() {} },
        inlets: 1,
        outlets: 1,
        outlet: function(idx, msg) { emitted2.push(msg); }
    };
    vm.createContext(sandbox2);
    vm.runInContext(fs.readFileSync(LOM_JS_PATH, "utf8"), sandbox2);
    const rpc2 = (id, payload) => { sandbox2.lom_rpc(id, JSON.stringify(payload)); return JSON.parse(emitted2.pop()[2]); };

    expectBugFixed("BUG-MCP-1 delete_device with no path/parentPath/deviceIndex must error, not call delete_device(-1) on live_set", () => {
        calls.length = 0;
        const rep = rpc2("p1-1", { action: "delete_device", params: {} });
        assert.strictEqual(rep.ok, false, "expected ok:false, got " + JSON.stringify(rep));
        assert.deepStrictEqual(calls.filter((c) => c.method === "delete_device"), []);
    });

    expectBugFixed("BUG-MCP-2 set_device_parameter without a numeric value must error, not set NaN", () => {
        sets.length = 0;
        const rep = rpc2("p1-2", { action: "set_device_parameter", params: { path: "live_set tracks 0 devices 0", paramIndex: 1 } });
        assert.strictEqual(rep.ok, false, "expected ok:false, got " + JSON.stringify(rep));
        assert.deepStrictEqual(sets.filter((s) => s.prop === "value"), []);
    });

    expectBugFixed("BUG-MCP-3 transport with an unknown action must error, not report success", () => {
        const rep = rpc2("p1-3", { action: "transport", params: { action: "bogus_action" } });
        assert.strictEqual(rep.ok, false, "expected ok:false, got " + JSON.stringify(rep));
    });

    if (pass1Failures.length) console.error("Pass 1 red tests failing:\n - " + pass1Failures.join("\n - "));
    assert.deepStrictEqual(pass1Failures, []);
}

console.log("All Ableton MCP Bridge tests passed!");
