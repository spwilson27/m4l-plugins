#!/usr/bin/env node
/**
 * Mega Modulator automatable parameters + per-mapping depth in REAL Ableton Live (runs against the VM's bridge, AGENTS.md 1a).
 *
 *   scripts/vm_megamod_keys.sh live    # opens megamod_keys_test.als (one Mega Modulator on the "Mega Mod Keys" track)
 *   scripts/vm_megamod_keys.sh auto    # tunnels the bridge and runs this
 *
 * Checks, through the bridge (LiveAPI on the device's parameters + `receive megamod-test` hooks):
 *   1. the device parameter list: M1..M16 slots (A..E, On), Depth 1..64, no marker, names as built
 *   2. test_add / test_settype: the names stay (runtime renames do not reach Live), the values of the right letters follow
 *   3. LOM set of a parameter changes the modulator (test_report)
 *   4. test_setparam (the UI path) moves the LOM parameter value
 *   5. test_learn binds Depth 1; the LOM depth moves the mapping depth
 *   6. test_remove / test_undo rename / restore
 * Exit status is non-zero when a check fails.
 */
const { execFileSync } = require("child_process");
const path = require("path");
const C = require(path.join(__dirname, "..", "src", "megamod_config.js"));

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const PORT = Number(arg("--port", 0)) || null;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8", maxBuffer: 1 << 26 }));
    if (out.error) throw new Error(out.error);
    return out.result;
}
let failed = 0;
function check(name, ok, detail) { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : "")); }
const info = (s) => console.log("INFO " + s);

const found = evalLom(`
    var out = [];
    var set = new LiveAPI("live_set");
    for (var t = 0; t < set.getcount("tracks"); t++) {
        var tp = "live_set tracks " + t;
        var tr = new LiveAPI(tp);
        for (var i = 0; i < tr.getcount("devices"); i++) {
            var d = new LiveAPI(tp + " devices " + i);
            if (String(d.get("name")) === "Mega Modulator") out.push({ id: String(d.id), path: tp + " devices " + i, trackName: String(tr.get("name")) });
        }
    }
    return out;
`);
if (!found.length) { console.error("No Mega Modulator in the set. Run scripts/vm_megamod_keys.sh live first."); process.exit(1); }
const dev = found.find((d) => d.trackName === "Mega Mod Keys") || found[0];
info(`device ${dev.id} at ${dev.path}`);

const hook = (...a) => evalLom(`messnamed("megamod-test", ${a.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
function params() {
    return evalLom(`
        var d = new LiveAPI(${JSON.stringify(dev.path)});
        var n = d.getcount("parameters");
        var out = [];
        for (var i = 0; i < n; i++) {
            var p = new LiveAPI(${JSON.stringify(dev.path)} + " parameters " + i);
            var v = Number(p.get("value"));
            out.push({ i: i, id: String(p.id), name: String(p.get("name")), orig: String(p.get("original_name")), value: v, min: Number(p.get("min")), max: Number(p.get("max")) });
        }
        return out;
    `);
}
function report() {
    const raw = evalLom(`
        var g = new Global("megamod_test");
        g["report_${dev.id}"] = "";
        messnamed("megamod-test", "test_report");
        var r = g["report_${dev.id}"];
        return r ? String(r) : "";
    `);
    return raw ? JSON.parse(raw) : null;
}
const byName = (ps, n) => ps.find((p) => p.name === n);
function setParam(id, v) {
    evalLom(`var p = new LiveAPI("id ${id}"); p.set("value", ${v}); return 1;`);
}
const settle = () => sleep(500);
// diagnostics: what the device script thinks (types, ready flag, applied names, errors) and what a live.* object reports about itself
function diag(label, varname) {
    const raw = evalLom(`
        var g = new Global("megamod_test");
        g.probe = ""; g["names_${dev.id}"] = "";
        messnamed("megamod-test", "test_names");
        messnamed("megamod-test", "test_probe", ${JSON.stringify(varname)});
        return JSON.stringify({ names: String(g["names_${dev.id}"] || ""), probe: String(g.probe || "") });
    `);
    const d = JSON.parse(raw);
    let nm = {}; try { nm = JSON.parse(d.names); } catch (e) { /* none */ }
    info(`${label}: script ready=${nm.on}, errors=${JSON.stringify(nm.errors)}, applied ap_0 name=${JSON.stringify(nm.names && nm.names.ap_0)}`);
    info(`${label}: probe ${varname}: ${d.probe}`);
}

// ---- 1. the parameter list as built
let ps = params();
info(`${ps.length} parameters in the device`);
check("parameter list holds the whole pool (257 = Device On + 96 + 96 + 64, marker hidden)", ps.length === 257, `count ${ps.length}`);
check("16 x 6 modulator parameters named M<n> A..E / On", ps.filter((p) => /^M\d+ ([A-E]|On)$/.test(p.name)).length === 96, String(ps.filter((p) => /^M\d+ /.test(p.name)).length));
check("16 x 6 switch parameters named M<n> Shape / Sync / Bipolar / Retrig / 1Shot / Loop", ps.filter((p) => /^M\d+ (Shape|Sync|Bipolar|Retrig|1Shot|Loop)$/.test(p.name)).length === 96);
check("64 depth parameters Depth 1..64", ps.filter((p) => /^Depth \d+$/.test(p.name)).length === 64);
check("the marker stays hidden", !ps.some((p) => /Auto Stored/.test(p.name)));
info("first parameters: " + ps.slice(0, 4).map((p) => `${p.name}[${p.value}]`).join(", "));
check("every parameter name is unique", new Set(ps.map((p) => p.name)).size === ps.length);
const rep0 = report();
check("device script is ready and the pool is live", rep0 && rep0.auto === true, JSON.stringify(rep0 && rep0.auto));
info("units: " + ["M1 A", "Depth 1"].map((n) => { const p = byName(ps, n); return `${n} min ${p.min} max ${p.max}`; }).join("; "));
const strFor = (id, v) => evalLom(`var p = new LiveAPI("id ${id}"); return String(p.call("str_for_value", ${v}));`);
info(`display: M1 A at 50 -> "${strFor(byName(ps, "M1 A").id, 50)}"; Depth 1 at 100 -> "${strFor(byName(ps, "Depth 1").id, 100)}"`);

// ---- 2. runtime rename: Live must NOT have changed the names (the reason the names are fixed), values follow the type
hook("test_add", 1); settle();
diag("after test_add", "ap_0");
ps = params();
const M1 = (l) => byName(ps, "M1 " + l);
check("names are unchanged after test_add (runtime rename does not reach Live)", ["A", "B", "C", "D", "E", "On"].every((l) => M1(l)), JSON.stringify(ps.filter((p) => /^M1 /.test(p.name)).map((p) => p.name)));
check("LFO Rate value pushed into M1 A (log curve)", M1("A") && Math.abs(M1("A").value - 100 * C.autoNorm("rate", 1)) < 0.5, String(M1("A") && M1("A").value));
check("LFO Div value pushed into M1 B", Math.abs(M1("B").value - 100 * C.autoNorm("syncDiv", 9)) < 0.5, String(M1("B").value));
check("LFO Depth value pushed into M1 C", Math.abs(M1("C").value - 100) < 0.5);
check("LFO On value pushed", M1("On").value === 1);
hook("test_settype", 0, 2); settle();
ps = params();
check("type change to Envelope: M1 A now carries Attack", Math.abs(M1("A").value - 100 * C.autoNorm("attack", 5)) < 0.5, String(M1("A").value));
check("... M1 B carries Release", Math.abs(M1("B").value - 100 * C.autoNorm("release", 120)) < 0.5, String(M1("B").value));
const ids = Object.fromEntries(ps.filter((p) => /^M1 /.test(p.name)).map((p) => [p.name, p.id]));

// ---- 3. Live -> modulator (Envelope: A attack, B release, C depth, D gain)
setParam(ids["M1 A"], 100 * C.autoNorm("attack", 250)); settle();
let rep = report();
check("LOM set of M1 A changes the Envelope attack", rep && Math.abs(rep.modP[0].attack - 250) < 2, rep && rep.modP[0].attack);
setParam(ids["M1 D"], 100 * C.autoNorm("gain", 12)); settle();
rep = report();
check("LOM set of M1 D changes the Envelope gain", rep && Math.abs(rep.modP[0].gain - 12) < 0.3, rep && rep.modP[0].gain);
setParam(ids["M1 On"], 0); settle();
rep = report();
check("LOM set of M1 On = 0 bypasses it", rep && rep.modP[0].enabled === 0);
setParam(ids["M1 On"], 1); settle();

// ---- 4. UI path -> LOM value
hook("test_setparam", 0, "release", 900); settle();
ps = params();
check("UI change moves the LOM value (Live saw the output)", Math.abs(byName(ps, "M1 B").value - 100 * C.autoNorm("release", 900)) < 0.5, String(byName(ps, "M1 B").value));
check("no echo drift in the model", Math.abs(report().modP[0].release - 900) < 1);

// ---- 5. mapping depth (first free pool slot = Depth 1)
const track = evalLom(`var p = new LiveAPI("live_set tracks 0 mixer_device volume"); return { id: String(p.id), name: String(p.get("name")) };`);
hook("test_learn", 0, Number(track.id)); settle();
ps = params();
const dp = byName(ps, "Depth 1");
check("the learned mapping's depth parameter exists and starts at 100", dp && Math.abs(dp.value - 100) < 0.5, String(dp && dp.value));
if (dp) {
    setParam(dp.id, 50); settle();
    rep = report();
    check("LOM depth moves the mapping depth", rep && rep.mappings[0] && Math.abs(rep.mappings[0].depth - 0.5) < 0.01, JSON.stringify(rep && rep.mappings[0] && rep.mappings[0].depth));
}

// ---- 6. delete / undo restore the values
hook("test_remove", 0); settle();
ps = params();
check("delete frees the depth parameter (100 again)", Math.abs(byName(ps, "Depth 1").value - 100) < 0.5, String(byName(ps, "Depth 1").value));
hook("test_undo"); settle();
ps = params();
check("undo restores the modulator values", Math.abs(byName(ps, "M1 A").value - 100 * C.autoNorm("attack", 250)) < 1, String(byName(ps, "M1 A").value));
check("undo restores the depth value", Math.abs(byName(ps, "Depth 1").value - 50) < 0.5, String(byName(ps, "Depth 1").value));
console.log(failed ? `FAILED ${failed}` : "ALL PASSED");
process.exit(failed ? 1 : 0);
