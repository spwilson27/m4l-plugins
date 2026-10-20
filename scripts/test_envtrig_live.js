#!/usr/bin/env node
/**
 * Live end-to-end test for the Envelope Trigger collapsible MIDI To panel, driven through the
 * Ableton MCP Bridge (`scripts/ableton_mcp_server.js`, `ableton_eval_lom_js`).
 *
 * Live runs only in the tart VM (AGENTS.md 1a). `scripts/vm_envtrig.sh live` starts the VM's Live
 * with envtrig_test.als (MCP Bridge + two Envelope Trigger instances); `scripts/vm_envtrig.sh test`
 * runs this script on the host through an ssh tunnel to the VM's bridge (`--port 19878`).
 *
 * Uses the device's test hook (`receive envtrig-test`): `test_click` clicks the strip of every
 * instance and `test_report` makes each strip write its state to Global("envtrig_test") as
 * `report_<LOM device id>`. Checks every instance: click -> state flips (toggle, setwidth 228/342,
 * panel widgets shown/hidden); click again -> back to the starting state, which is left as found.
 *
 *   scripts/vm_envtrig.sh test        (or: node scripts/test_envtrig_live.js --port <tunnelled port>)
 */

const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const portIdx = process.argv.indexOf("--port");
const PORT = portIdx > 0 ? Number(process.argv[portIdx + 1]) : null;
const WIDTH = { 0: 228, 1: 342 };

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8" }));
    if (out.error) throw new Error(out.error);
    return out.result;
}

// Find every Envelope Trigger (top level of tracks, returns, and rack chains).
const devices = evalLom(`
    var found = [];
    function scan(p, depth) {
        var api = new LiveAPI(p);
        var n = api.getcount("devices");
        for (var i = 0; i < n; i++) {
            var dp = p + " devices " + i;
            var d = new LiveAPI(dp);
            if (String(d.get("class_name")) === "MxDeviceAudioEffect" && String(d.get("name")) === "Envelope Trigger") {
                found.push({ id: String(d.id), path: dp });
            }
            if (depth < 3 && Number(d.get("can_have_chains")) === 1) {
                var c = d.getcount("chains");
                for (var k = 0; k < c; k++) scan(dp + " chains " + k, depth + 1);
            }
        }
    }
    var set = new LiveAPI("live_set");
    for (var t = 0; t < set.getcount("tracks"); t++) scan("live_set tracks " + t, 0);
    for (var r = 0; r < set.getcount("return_tracks"); r++) scan("live_set return_tracks " + r, 0);
    return found;
`);

if (!devices.length) {
    console.error("No Envelope Trigger device found in the Live set.");
    process.exit(1);
}

function reports() {
    return evalLom(`
        var g = new Global("envtrig_test");
        ${JSON.stringify(devices.map((d) => d.id))}.forEach(function (id) { g["report_" + id] = ""; });
        messnamed("envtrig-test", "test_report");
        var out = {};
        ${JSON.stringify(devices.map((d) => d.id))}.forEach(function (id) {
            var r = g["report_" + id];
            out[id] = r ? JSON.parse(String(r)) : null;
        });
        return out;
    `);
}

function click() {
    evalLom(`messnamed("envtrig-test", "test_click"); return 1;`);
}

const errors = [];
const start = reports();
for (const d of devices) {
    if (!start[d.id]) errors.push(`${d.path}: no test_report — reload the device so it has the envtrig-test hook`);
}
if (errors.length) {
    errors.forEach((e) => console.error(" -", e));
    process.exit(1);
}

function expectState(label, snap, d, state) {
    const r = snap[d.id];
    if (!r) return errors.push(`${d.path} ${label}: no report`);
    if (r.open !== state) errors.push(`${d.path} ${label}: strip open=${r.open}, expected ${state}`);
    if (r.toggle !== state) errors.push(`${d.path} ${label}: MIDI To Panel toggle=${r.toggle}, expected ${state}`);
    if (r.width !== WIDTH[state]) errors.push(`${d.path} ${label}: setwidth ${r.width}, expected ${WIDTH[state]}`);
    const wrong = Object.keys(r.hidden).filter((n) => r.hidden[n] !== (state ? 0 : 1));
    if (wrong.length) errors.push(`${d.path} ${label}: wrong visibility for ${wrong.join(", ")}`);
}

click();
const flipped = reports();
click();
const restored = reports();

for (const d of devices) {
    const s0 = start[d.id].toggle;
    console.log(`${d.path} (id ${d.id}): start ${s0 ? "open" : "collapsed"}, width ${start[d.id].width}`);
    expectState("after click", flipped, d, s0 ? 0 : 1);
    expectState("after second click", restored, d, s0);
}

if (errors.length) {
    console.error("FAILED");
    errors.forEach((e) => console.error(" -", e));
    process.exit(1);
}
console.log(`envtrig Live collapse test passed (${devices.length} instance${devices.length > 1 ? "s" : ""})`);
