#!/usr/bin/env node
/**
 * Mega Modulator load order in REAL Live: the parameter values Live stores in the Set win over the blob (src/megamod_mapper.js autoInit).
 * Driven by `scripts/vm_megamod_keys.sh reload` (in the VM, under the Live lock).
 *   prepare: add an LFO, move parameters through the LOM (so Live stores them), map the track volume and set its Depth
 *   load:    `live_set duplicate_track 0`: Live clones the device through its stored state (parameter values + MegaModState blob) exactly
 *            like opening a Set does (saving a Set through the UI could not be automated: the File > Save click does nothing here)
 *   check:   on the CLONE: the marker was restored (init.stored), the values were adopted from Live, model, engine cfg and LOM agree
 *   node scripts/test_megamod_reload_live.js --port 19880
 */
const { execFileSync } = require("child_process");
const path = require("path");
const C = require(path.join(__dirname, "..", "src", "megamod_config.js"));
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
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? "  [" + detail + "]" : "")); };
const info = (s) => console.log("INFO " + s);

let dev = evalLom(`var s = new LiveAPI("live_set"); for (var t = 0; t < s.getcount("tracks"); t++) { var tr = new LiveAPI("live_set tracks " + t); for (var i = 0; i < tr.getcount("devices"); i++) { var d = new LiveAPI("live_set tracks " + t + " devices " + i); if (String(d.get("name")) === "Mega Modulator") return { id: String(d.id), path: "live_set tracks " + t + " devices " + i }; } } return null;`);
if (!dev) { console.error("no Mega Modulator in the set"); process.exit(1); }
const hook = (...a) => evalLom(`messnamed("megamod-test", ${a.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
const params = () => evalLom(`var d = new LiveAPI(${JSON.stringify(dev.path)}); var n = d.getcount("parameters"); var o = []; for (var i = 0; i < n; i++) { var p = new LiveAPI(${JSON.stringify(dev.path)} + " parameters " + i); o.push({ id: String(p.id), name: String(p.get("name")), value: Number(p.get("value")) }); } return o;`);
const byName = (ps, n) => ps.find((p) => p.name === n);
const setParam = (id, v) => evalLom(`var p = new LiveAPI("id ${id}"); p.set("value", ${v}); return 1;`);
const report = () => { const raw = evalLom(`var g = new Global("megamod_test"); g["report_${dev.id}"] = ""; messnamed("megamod-test", "test_report"); return String(g["report_${dev.id}"] || "");`); return raw ? JSON.parse(raw) : null; };
const names = () => { const raw = evalLom(`var g = new Global("megamod_test"); g["names_${dev.id}"] = ""; messnamed("megamod-test", "test_names"); return String(g["names_${dev.id}"] || "");`); return raw ? JSON.parse(raw) : null; };
const settle = () => sleep(600);

// the values written in `prepare` and expected after the reload
const STALE_A = 30; // M1 A is moved to this AFTER the model (and so the blob) was frozen at WANT.A: Live's stored value must win on the load
const WANT = { A: 70, C: 40, D: 25, depth: 35 }; // percent of the control travel (LFO: A rate, C depth, D phase), Depth 1 in percent

{
    hook("test_add", 1); settle();
    let ps = params();
    for (const [letter, v] of [["A", WANT.A], ["C", WANT.C], ["D", WANT.D]]) setParam(byName(ps, "M1 " + letter).id, v);
    const track = evalLom(`var p = new LiveAPI("live_set tracks 0 mixer_device volume"); return { id: String(p.id) };`);
    hook("test_learn", 0, Number(track.id)); settle();
    ps = params();
    setParam(byName(ps, "Depth 1").id, WANT.depth); settle();
    evalLom(`var v = new LiveAPI("live_set tracks 0 mixer_device volume"); v.set("value", Number(v.get("value")) - 0.01); return 1;`); // a Live edit, so the Set is dirty and the save writes
    const rep = report();
    check("prepared: LFO rate follows M1 A", Math.abs(rep.modP[0].rate - C.autoValue("rate", WANT.A / 100)) < 0.01, rep.modP[0].rate);
    // make the blob stale against Live's stored values: the device ignores the next Live input, so its model (= the blob) keeps WANT.A
    hook("test_freeze", 1); settle();
    setParam(byName(params(), "M1 A").id, STALE_A); settle();
    setParam(byName(params(), "M1 Bipolar").id, 0); settle(); // a switch parameter moved the same way (the default is 1)
    hook("test_freeze", 0);
    check("the blob is stale: the original keeps its old model rate", Math.abs(report().modP[0].rate - C.autoValue("rate", WANT.A / 100)) < 0.01);
    check("... while Live now stores the new parameter value", Math.abs(byName(params(), "M1 A").value - STALE_A) < 0.01);
    check("prepared: mapping depth", Math.abs(rep.mappings[0].depth - WANT.depth / 100) < 0.01, rep.mappings[0].depth);
    const nm = names();
    info("prepared; init at the first ready: " + JSON.stringify(nm.init));
    check("the first load of a fresh device pushed (marker 0)", nm.init && nm.init.stored === false);
}
{
    // the clone: Live restores its parameter values and the blob, then live.thisdevice bangs (= a Set load)
    const before = dev.id;
    evalLom(`var s = new LiveAPI("live_set"); s.call("duplicate_track", 0); return 1;`);
    sleep(4000);
    const all = evalLom(`var out = []; var s = new LiveAPI("live_set"); for (var t = 0; t < s.getcount("tracks"); t++) { var tr = new LiveAPI("live_set tracks " + t); for (var i = 0; i < tr.getcount("devices"); i++) { var d = new LiveAPI("live_set tracks " + t + " devices " + i); if (String(d.get("name")) === "Mega Modulator") out.push({ id: String(d.id), path: "live_set tracks " + t + " devices " + i }); } } return out;`);
    const clone = all.find((d) => d.id !== before);
    check("the track duplicate holds a second Mega Modulator", !!clone, JSON.stringify(all.map((d) => d.id)));
    if (!clone) { console.log("FAILED"); process.exit(1); }
    dev = clone;
    info("clone " + clone.id + " at " + clone.path);
    sleep(2000);
    const nm = names();

    info("init: " + JSON.stringify(nm.init));
    check("the marker was restored by Live (stored)", nm.init && nm.init.stored === true && nm.init.marker === 2, JSON.stringify(nm.init)); // marker 2: values and switches stored
    check("the parameter values came from Live, not from a push", nm.init && nm.init.cached + nm.init.read > 0, `cached ${nm.init && nm.init.cached}, read ${nm.init && nm.init.read}, missing ${nm.init && nm.init.missing}`);
    const rep = report();
    const ps = params();
    check("Live wins: the clone's model rate is the stored parameter, not the stale blob", Math.abs(rep.modP[0].rate - C.autoValue("rate", STALE_A / 100)) < 0.01, rep.modP[0].rate);
    check("Live wins for the switches too: the clone's Bipolar is the stored M1 Bipolar (0), not the blob's 1", rep.modP[0].bipolar === 0 && byName(ps, "M1 Bipolar").value === 0, `model ${rep.modP[0].bipolar}, LOM ${byName(ps, "M1 Bipolar").value}`);
    check("model depth = the stored M1 C", Math.abs(rep.modP[0].depth - WANT.C / 100) < 0.01, rep.modP[0].depth);
    check("model phase = the stored M1 D", Math.abs(rep.modP[0].phase - WANT.D / 100) < 0.01, rep.modP[0].phase);
    check("LOM M1 A kept its stored value", Math.abs(byName(ps, "M1 A").value - STALE_A) < 0.01, byName(ps, "M1 A").value);
    check("LOM M1 C kept its value", Math.abs(byName(ps, "M1 C").value - WANT.C) < 0.01);
    check("mapping restored with its depth", rep.mappings.length === 1 && Math.abs(rep.mappings[0].depth - WANT.depth / 100) < 0.01, JSON.stringify(rep.mappings.map((m) => [m.status, m.depth])));
    check("LOM Depth 1 kept its value", Math.abs(byName(ps, "Depth 1").value - WANT.depth) < 0.01, byName(ps, "Depth 1").value);
}
console.log(failed ? `FAILED ${failed}` : "ALL PASSED");
process.exit(failed ? 1 : 0);
