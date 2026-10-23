#!/usr/bin/env node
/**
 * Waits (through the MCP bridge, in the VM tunnel) until every Mega Modulator in the Live set has built its deferred DSP (src/megamod_dsp.js: `test_report.dsp.ready`).
 * The device's face is up long before its engine / routers run, and the Live tests that measure modulation must not start earlier. A build without the deferred DSP
 * (no `dsp` in the report) counts as ready. Exit 0 when ready (or when no device is found after the timeout), 1 on a DSP error.
 *   node scripts/mm_wait_dsp.js --port 19880 [--timeout 90]
 */
const { execFileSync } = require("child_process");
const path = require("path");
const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("--port", 0)) || null;
const TIMEOUT = Number(arg("--timeout", 90)) * 1000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function evalLom(code) {
    const args = [SERVER]; if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    let txt;
    try { txt = execFileSync("node", args, { encoding: "utf8", maxBuffer: 1 << 26, timeout: 30000 }); } catch (e) { txt = String(e.stdout || ""); }
    try { const o = JSON.parse(txt); return o.error ? null : o.result; } catch (e) { return null; }
}
const CODE = `
var out = [];
var s = new LiveAPI("live_set");
var g = new Global("megamod_test");
for (var t = 0; t < s.getcount("tracks"); t++) {
  var tp = "live_set tracks " + t;
  var tr = new LiveAPI(tp);
  for (var i = 0; i < tr.getcount("devices"); i++) {
    var d = new LiveAPI(tp + " devices " + i);
    if (String(d.get("name")) === "Mega Modulator") { var id = String(d.id); g["report_" + id] = ""; out.push(id); }
  }
}
messnamed("megamod-test", "test_report");
return out.map(function (id) { var r = String(g["report_" + id] || ""); if (!r) return { id: id, state: "no report" }; var j = JSON.parse(r); return { id: id, state: j.dsp ? (j.dsp.ready ? "ready" : (j.dsp.error ? "error " + j.dsp.error : "building")) : "ready" }; });
`;
const t0 = Date.now();
let last = "";
while (Date.now() - t0 < TIMEOUT) {
    const r = evalLom(CODE);
    if (r && r.length) {
        const st = r.map((x) => x.state).join(",");
        if (st !== last) { console.log("mm_wait_dsp: " + st); last = st; }
        if (r.some((x) => /^error/.test(x.state))) process.exit(1);
        if (r.every((x) => x.state === "ready")) { console.log("mm_wait_dsp: DSP ready after " + ((Date.now() - t0) / 1000).toFixed(1) + " s"); process.exit(0); }
    }
    sleep(500);
}
console.log("mm_wait_dsp: timed out (" + last + ")");
process.exit(0);
