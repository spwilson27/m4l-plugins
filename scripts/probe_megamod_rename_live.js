#!/usr/bin/env node
/**
 * Mega Modulator: which runtime renames does Live pick up? (diagnostic, runs against the VM bridge, AGENTS.md 1a)
 * Tries several ways to change the long / short name of the saved parameter objects ap_1..ap_6 (test_probe / test_rename hooks and
 * direct JS in the device's v8ui through `messnamed`), then reads the LOM `DeviceParameter.name` of the matching parameter.
 *   node scripts/probe_megamod_rename_live.js --port 19880
 */
const { execFileSync } = require("child_process");
const path = require("path");
const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("--port", 0)) || null;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function evalLom(code) {
    const args = [SERVER]; if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8", maxBuffer: 1 << 26 }));
    if (out.error) throw new Error(out.error);
    return out.result;
}
const dev = evalLom(`var s = new LiveAPI("live_set"); for (var t = 0; t < s.getcount("tracks"); t++) { var tr = new LiveAPI("live_set tracks " + t); for (var i = 0; i < tr.getcount("devices"); i++) { var d = new LiveAPI("live_set tracks " + t + " devices " + i); if (String(d.get("name")) === "Mega Modulator") return { id: String(d.id), path: "live_set tracks " + t + " devices " + i }; } } return null;`);
const names = () => evalLom(`var d = new LiveAPI(${JSON.stringify(dev.path)}); var n = d.getcount("parameters"); var o = []; for (var i = 0; i < n; i++) { var p = new LiveAPI(${JSON.stringify(dev.path)} + " parameters " + i); var nm = String(p.get("name")); if (/^M2 /.test(nm) || /^M3 /.test(nm) || /^X\d/.test(nm)) o.push(nm + "|" + String(p.get("original_name"))); } return o;`);
const hook = (...a) => evalLom(`messnamed("megamod-test", ${a.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
// direct attribute experiments on the patcher object, run inside the device (via the test_eval hook is not available: use test_rename modes)
console.log("before:", JSON.stringify(names()));
for (let mode = 0; mode <= 11; mode++) {
    hook("test_rename", "ap_" + (6 + mode), "X" + mode, mode);
}
sleep(300);
console.log("after 0.3 s:", JSON.stringify(names()));
sleep(3000);
console.log("after 3.3 s:", JSON.stringify(names()));
// Live-side refresh triggers: select another device / the device, toggle the device on / off, collapse / expand it
const live = (code) => evalLom(code);
const refresh = [
    ["select_device", `var v = new LiveAPI("live_set view"); v.call("select_device", "id ${dev.id}"); return 1;`],
    ["device is_active off/on", `var d = new LiveAPI(${JSON.stringify(dev.path)}); d.set("is_active", 0); d.set("is_active", 1); return 1;`],
    ["view is_collapsed on/off", `var d = new LiveAPI(${JSON.stringify(dev.path)} + " view"); d.set("is_collapsed", 1); d.set("is_collapsed", 0); return 1;`],
];
for (const [label, code] of refresh) {
    try { live(code); } catch (e) { console.log(label, "ERR", String(e).slice(0, 120)); }
    sleep(1500);
    console.log(`after ${label}:`, JSON.stringify(names()));
}
