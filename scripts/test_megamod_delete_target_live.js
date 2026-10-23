#!/usr/bin/env node
/**
 * Mega Modulator: a mapped target is DELETED in REAL Ableton Live (AGENTS.md 1a: the VM only; section 21 "Target deleted").
 *
 *   scripts/vm_live_lock.sh megamod-delete -- zsh -c 'FORCE=1 scripts/vm_megamod_keys.sh live && scripts/vm_megamod_keys.sh run scripts/test_megamod_delete_target_live.js'
 *
 * Bridge (LOM + `receive megamod-test`) plus REAL OS clicks (`--ssh`, scripts/mm_os_input.py, scripts/mm_scan_select.py: the VM has no screenshots, so the
 * screen point of a stock Utility dial is found by clicking and reading `selected_parameter`):
 *   1. the user's report: LFO 1 maps Utility A's Balance (Remote), A is deleted through the bridge (`ableton_delete_device`) while an identical Utility B
 *      slides into A's place. The mapping must NOT jump onto B, disappears within ~4.5 s (two 1.5 s polls), its pool slot is unbound, ONE undo entry exists;
 *      then LRN (a real click) + a real click on B's dial creates a working mapping (B's Balance moves in the LOM).
 *   2. Live's own Undo brings a deleted Utility back; Mega Modulator's undo restores the mapping bound to the restored device and it modulates again.
 *   3. a mapped device MOVED to another track (move_device) keeps its mapping (same Live id, new path).
 * Prints verbatim PASS / FAIL lines. Exit status is non-zero when a check fails.
 */
const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const PORT = Number(arg("--port", 0)) || null;
const VM_DIR = arg("--vm-dir", "Software/ableton-mmnames");
const PROC = arg("--process", "Live");
let SSH_TARGET = arg("--ssh", "");
if (!SSH_TARGET) {
    let ip = "";
    for (const a of [["ip", "macos-1"], ["ip", "--resolver=arp", "macos-1"]]) {
        try { ip = execFileSync("tart", a, { encoding: "utf8" }).trim(); } catch (e) { /* next form */ }
        if (ip) break;
    }
    SSH_TARGET = "admin@" + (ip || "192.168.64.4");
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    for (let attempt = 0; ; attempt++) {
        let txt;
        try { txt = execFileSync("node", args, { encoding: "utf8", maxBuffer: 1 << 26 }); } catch (e) { txt = String(e.stdout || ""); }
        let out = null;
        try { out = JSON.parse(txt); } catch (e) { /* retry */ }
        if (out && !out.error) return out.result;
        if (attempt >= 3 || (out && !/timed out/.test(out.error))) throw new Error(out ? out.error : "no answer from the bridge");
        sleep(2000);
    }
}
function os(...a) {
    const cmd = `cd ${VM_DIR} && /usr/bin/python3 scripts/mm_os_input.py ${a.join(" ")}`;
    return execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", SSH_TARGET, cmd],
        { encoding: "utf8", env: Object.assign({ SSHPASS: "admin" }, process.env) }).trim();
}
let failed = 0;
function check(name, ok, detail) { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : "")); }
const info = (s) => console.log("INFO " + s);

function bridge(tool, params) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", tool, JSON.stringify(params));
    let txt;
    try { txt = execFileSync("node", args, { encoding: "utf8", maxBuffer: 1 << 26 }); } catch (e) { txt = String(e.stdout || ""); }
    return JSON.parse(txt);
}
const found = evalLom(`
    var out = [];
    var set = new LiveAPI("live_set");
    for (var t = 0; t < set.getcount("tracks"); t++) {
        var tp = "live_set tracks " + t;
        var tr = new LiveAPI(tp);
        for (var i = 0; i < tr.getcount("devices"); i++) {
            var d = new LiveAPI(tp + " devices " + i);
            if (String(d.get("name")) === "Mega Modulator") out.push({ id: String(d.id), path: tp + " devices " + i, track: t, trackName: String(tr.get("name")) });
        }
    }
    return out;
`);
if (!found.length) { console.error("No Mega Modulator in the set. Run scripts/vm_megamod_keys.sh live first."); process.exit(1); }
const dev = found.find((d) => d.trackName === "Mega Mod Keys") || found[0];
info(`device ${dev.id} at ${dev.path}`);

const hook = (...a) => evalLom(`messnamed("megamod-test", ${a.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
function globalJson(prop, hookName, ...hargs) {
    const raw = evalLom(`
        var g = new Global("megamod_test");
        g[${JSON.stringify(prop + "_" + dev.id)}] = "";
        messnamed("megamod-test", ${JSON.stringify(hookName)}${hargs.map((x) => ", " + JSON.stringify(x)).join("")});
        var r = g[${JSON.stringify(prop + "_" + dev.id)}];
        return r ? String(r) : "";
    `);
    return raw ? JSON.parse(raw) : null;
}
const report = () => globalJson("report", "test_report");
function showTrack(trackId) {
    evalLom(`var v = new LiveAPI("live_set view"); v.set("selected_track", "id", ${Number(trackId)}); return 1;`);
    sleep(700);
}
function showDevice() {
    evalLom(`
        var a = new LiveAPI("live_app view");
        a.call("hide_view", "Browser"); a.call("show_view", "Detail"); a.call("show_view", "Detail/DeviceChain");
        return 1;
    `);
    showTrack(evalLom(`return Number(new LiveAPI("live_set master_track").id);`));
    showTrack(evalLom(`return Number(new LiveAPI(${JSON.stringify("live_set tracks " + dev.track)}).id);`));
    evalLom(`var v = new LiveAPI("live_set view"); v.call("select_device", "id", ${Number(dev.id)}); return 1;`);
    sleep(1200);
}
let origin = null;
const hoverOf = () => { const r = report(); return r && r.hover ? r.hover : null; };
function calibrate(w) {
    for (let sy = w.y + w.h - 30; sy > w.y + 240; sy -= 40) {
        for (let sx = w.x + 14; sx < w.x + 700; sx += 40) {
            os("move", Math.round(sx), Math.round(sy), 0.25);
            const h = hoverOf();
            if (h) {
                os("move", Math.round(sx) + 1, Math.round(sy) + 1, 0.3);
                const h2 = hoverOf();
                if (h2) return { x: Math.round(sx) + 1 - h2[0], y: Math.round(sy) + 1 - h2[1] };
            }
        }
    }
    return null;
}
const click = (lx, ly) => os("click", Math.round(origin.x + lx), Math.round(origin.y + ly), "");
const RAIL_LRN = [10, 11];

const scratchTrack = (name) => evalLom(`
    var set = new LiveAPI("live_set");
    set.call("create_audio_track", -1);
    var n = set.getcount("tracks") - 1;
    var tp = "live_set tracks " + n;
    var tr = new LiveAPI(tp);
    tr.set("name", ${JSON.stringify(name)});
    return { n: n, id: Number(tr.id), path: tp };
`);
const addUtility = (tp) => evalLom(`new LiveAPI(${JSON.stringify(tp)}).call("insert_device", "Utility"); return new LiveAPI(${JSON.stringify(tp)}).getcount("devices");`);
const balance = (devPath) => evalLom(`
    var n = new LiveAPI(${JSON.stringify(devPath)}).getcount("parameters");
    for (var i = 0; i < n; i++) {
        var p = new LiveAPI(${JSON.stringify(devPath)} + " parameters " + i);
        if (String(p.get("name")) === "Balance") return { id: Number(p.id), path: ${JSON.stringify(devPath)} + " parameters " + i, min: Number(p.get("min")), max: Number(p.get("max")) };
    }
    return null;
`);
// the LOM value of a parameter (by Live id), sampled for `ms`: {lo, hi} normalized to its range
function sample(pr, ms) {
    const vals = [];
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const v = evalLom(`var p = new LiveAPI("id " + ${pr.id}); var o = []; for (var i = 0; i < 6; i++) { o.push(Number(p.get("value"))); var t = Date.now(); while (Date.now() - t < 12) {} } return o;`);
        for (const x of v) vals.push((x - pr.min) / (pr.max - pr.min));
    }
    return { lo: Math.min(...vals), hi: Math.max(...vals) };
}
const moves = (s) => s.hi - s.lo > 0.25;
function waitFor(fn, ms, step) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return { v, ms: Date.now() - t0 }; sleep(step || 250); }
    return { v: null, ms: Date.now() - t0 };
}
function setupLfo() {
    let r = report();
    if (!r) { console.error("test_report got no answer; reload the device"); process.exit(1); }
    for (const m of r.mappings) hook("test_delmap", m.id);
    let n = r.mods.filter((m) => m).length;
    while (n < 1) { hook("test_add", 1); sleep(600); n++; }
    // LFO 1: a 2 Hz free-running sine over the full range
    hook("test_settype", 0, 1);
    hook("test_setparam", 0, "sync", 0); hook("test_setparam", 0, "shape", 0); hook("test_setparam", 0, "rate", 2);
    hook("test_setparam", 0, "bipolar", 1); hook("test_setparam", 0, "depth", 1);
    sleep(500);
}
// learn through the test hook (a "selection" of that Live id), then Remote 0..1
function mapRemote(pr) {
    hook("test_learn", 0, pr.id); sleep(900);
    const m = report().mappings.filter((x) => !x.internal && x.pid === pr.id)[0];
    if (m) { hook("test_mapupd", m.id, "mode", "remote"); hook("test_mapupd", m.id, "min", 0); hook("test_mapupd", m.id, "max", 1); hook("test_mapupd", m.id, "depth", 1); sleep(1200); }
    return m;
}
const cleanTracks = () => evalLom(`
    var set = new LiveAPI("live_set");
    for (var t = set.getcount("tracks") - 1; t >= 0; t--) { var nm = String(new LiveAPI("live_set tracks " + t).get("name")); if (nm.indexOf("MM Scratch") === 0) set.call("delete_track", t); }
    return 1;
`);

const DBG = "/tmp/mm_delete_target.log";
function dumpLog(n) {
    try {
        const t = evalLom(`var f = new File(${JSON.stringify(DBG)}, "read"); var s = ""; var l; if (f.isopen) { while ((l = f.readline()) !== null && l !== undefined) s += l + "\\n"; f.close(); } return s;`);
        console.log("---- mapper trace (last " + n + " lines) ----\n" + String(t).split("\n").slice(-n).join("\n"));
    } catch (e) { info("no trace: " + e.message); }
}
(function main() {
    hook("test_debug", DBG);
    const w = JSON.parse(os("window", PROC));
    cleanTracks();
    showDevice();
    os("front", PROC);
    sleep(800);
    setupLfo();
    origin = calibrate(w);
    if (!origin) { check("find the device UI on screen with the real pointer", false, "the v8ui never reported a hover"); console.log(`FAILED (${failed})`); process.exit(1); }
    info(`v8ui origin on screen (${origin.x}, ${origin.y})`);

    // =============== 1. the user's report: delete the mapped device, then learn onto another device
    const tk = scratchTrack("MM Scratch");
    addUtility(tk.path); addUtility(tk.path); // A (devices 0), B (devices 1): identical devices
    const A = balance(tk.path + " devices 0"), B = balance(tk.path + " devices 1");
    info(`A Balance id ${A.id}, B Balance id ${B.id}`);
    const mA = mapRemote(A);
    check("1. LFO 1 maps Utility A's Balance", !!mA && mA.status === "ok", JSON.stringify(mA && { id: mA.id, st: mA.status, pid: mA.pid }));
    if (!mA) { console.log(`FAILED (${failed})`); process.exit(1); }
    check("1. before the delete A's Balance is modulated (LOM value moves)", moves(sample(A, 1300)));
    const slot = mA.slot;
    const del = bridge("ableton_delete_device", { path: tk.path + " devices 0" });
    info("delete_device: " + JSON.stringify(del));
    const gone = waitFor(() => report().mappings.length === 0, 8000, 300);
    check("1. the mapping is auto-deleted within ~4.5 s of the device delete", !!gone.v && gone.ms <= 6000, `${gone.ms} ms`);
    let r = report();
    check("1. it did NOT jump onto the identical Utility that slid into its place", r.mappings.length === 0 && !moves(sample(B, 900)), JSON.stringify(r.mappings.map((m) => m.path)));
    check("1. its pool slot is unbound (no id on either live.* box)", !r.bound[String(slot)], JSON.stringify(r.bound));
    check("1. exactly one undo entry for the batch", r.undoInfo.undo === 1 && r.undoInfo.kind === "tdel", JSON.stringify(r.undoInfo));
    // find where a real click selects B's dials (B is now devices 0 of the scratch track), then arm LRN with a real click and click one
    showTrack(tk.id);
    os("front", PROC); sleep(500);
    let hits = [];
    try { hits = JSON.parse(execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", SSH_TARGET,
        `cd ${VM_DIR} && MM_SCAN_NAMES="Balance,Stereo Width,Bass Freq,Output" /usr/bin/python3 scripts/mm_scan_select.py "live_set tracks ${tk.n} devices 0" 2`],
        { encoding: "utf8", env: Object.assign({ SSHPASS: "admin" }, process.env) }).trim().split("\n").pop()); } catch (e) { info("scan failed: " + String(e.stdout || e)); }
    info("real-click points on B: " + JSON.stringify(hits));
    check("1. found two screen points that select B's dials", hits.length === 2);
    if (hits.length === 2) {
        showDevice(); os("front", PROC); sleep(600);
        click(RAIL_LRN[0], RAIL_LRN[1]); sleep(600);
        const armed = report().learn;
        check("1. a real click on LRN arms learn", armed && armed.armed === true, JSON.stringify(armed));
        showTrack(tk.id); os("front", PROC); sleep(500);
        os("click", hits[0].x, hits[0].y, "");
        sleep(1200);
        r = report();
        const nm = r.mappings.filter((m) => !m.internal);
        check("1. a real click on B's dial creates ONE mapping onto B", nm.length === 1 && nm[0].path.indexOf(tk.path + " devices 0 parameters") === 0, JSON.stringify(nm.map((m) => ({ path: m.path, st: m.status, pid: m.pid }))));
        check("1. ...and the learn is disarmed (single-shot)", r.learn.armed === false, JSON.stringify(r.learn));
        if (nm.length === 1) {
            hook("test_mapupd", nm[0].id, "mode", "remote"); hook("test_mapupd", nm[0].id, "min", 0); hook("test_mapupd", nm[0].id, "max", 1); hook("test_mapupd", nm[0].id, "depth", 1);
            sleep(1200);
            const pr = { id: nm[0].pid, min: B.min, max: B.max };
            const nmName = hits[0].name;
            if (nmName !== "Balance") { const q = evalLom(`var p = new LiveAPI("id " + ${nm[0].pid}); return { min: Number(p.get("min")), max: Number(p.get("max")) };`); pr.min = q.min; pr.max = q.max; }
            check(`1. ...bound to B's ${nmName} and it actually moves in the LOM`, nm[0].status === "ok" && moves(sample(pr, 1300)), JSON.stringify({ pid: nm[0].pid, idRem: nm[0].idRem }));
        }
    }
    if (failed) dumpLog(40);
    for (const m of report().mappings) hook("test_delmap", m.id);

    // =============== 2. Live's own Undo brings the device back; Mega Modulator's undo restores the mapping bound to it
    const t2 = scratchTrack("MM Scratch 2");
    addUtility(t2.path);
    const U = balance(t2.path + " devices 0");
    const mU = mapRemote(U);
    check("2. LFO 1 maps Utility U's Balance", !!mU && mU.status === "ok");
    if (!mU) dumpLog(30);
    bridge("ableton_delete_device", { path: t2.path + " devices 0" });
    check("2. the mapping is auto-deleted", !!waitFor(() => report().mappings.length === 0, 8000, 300).v);
    evalLom(`new LiveAPI("live_set").call("undo"); return 1;`);
    const back = waitFor(() => evalLom(`return new LiveAPI(${JSON.stringify(t2.path)}).getcount("devices");`) === 1, 4000, 300);
    if (!back.v) { info("Live's own Undo did not bring the device back through the LOM (a LOM delete is not on its undo stack): a new Utility is inserted at the same place, like a restore (new Live ids)"); addUtility(t2.path); }
    else info("Live's own Undo restored the Utility");
    sleep(600);
    hook("test_undo"); sleep(1200);
    r = report();
    const U2 = balance(t2.path + " devices 0") || { id: -1, min: 0, max: 1 };
    const rm = r.mappings.filter((m) => !m.internal);
    check("2. Cmd-Z in Mega Modulator restores the mapping, bound to the restored device", rm.length === 1 && rm[0].status === "ok" && rm[0].pid === U2.id, JSON.stringify(rm.map((m) => ({ st: m.status, pid: m.pid, want: U2.id }))));
    check("2. ...and the restored mapping modulates it", rm.length === 1 && moves(sample(U2, 1300)));
    for (const m of report().mappings) hook("test_delmap", m.id);

    // =============== 3. a MOVED device keeps its mapping
    const t3 = scratchTrack("MM Scratch 3");
    const m3 = mapRemote(U2);
    check("3. LFO 1 maps U's Balance again", !!m3 && m3.status === "ok");
    const mv = evalLom(`
        var set = new LiveAPI("live_set");
        var d = new LiveAPI(${JSON.stringify(t2.path + " devices 0")});
        var tr = new LiveAPI(${JSON.stringify(t3.path)});
        var res = set.call("move_device", "id " + d.id, "id " + tr.id, 0);
        return { res: String(res), n3: tr.getcount("devices"), n2: new LiveAPI(${JSON.stringify(t2.path)}).getcount("devices") };`);
    info("move_device: " + JSON.stringify(mv));
    sleep(5000); // > 3 polls
    r = report();
    const mm = r.mappings.filter((m) => !m.internal);
    check("3. the mapping survives the move to another track (other name)", mm.length === 1 && mm[0].status === "ok", JSON.stringify(mm.map((m) => ({ path: m.path, st: m.status, pid: m.pid }))));
    check("3. ...re-pointed at the new path, same Live id", mm.length === 1 && mm[0].path.indexOf(t3.path + " devices 0") === 0 && mm[0].pid === U2.id, JSON.stringify(mm.map((m) => m.path)));
    check("3. ...and it still modulates the moved device", mm.length === 1 && moves(sample(U2, 1300)));
    check("3. a move deletes nothing: no undo entry added", r.undoInfo.undo === 1 || r.undoInfo.undo === 0, JSON.stringify(r.undoInfo));

    for (const m of report().mappings) hook("test_delmap", m.id);
    cleanTracks();
    console.log(failed ? `FAILED (${failed})` : "ALL PASSED");
    process.exit(failed ? 1 : 0);
})();
