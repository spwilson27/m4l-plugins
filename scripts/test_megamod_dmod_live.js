#!/usr/bin/env node
/**
 * Mega Modulator depth-modulation routes (schema 10) in REAL Ableton Live (AGENTS.md 1a: the VM only; section 21).
 *
 *   scripts/vm_live_lock.sh megamod-dmod -- zsh -c 'FORCE=1 scripts/vm_megamod_keys.sh live && scripts/vm_megamod_keys.sh run scripts/test_megamod_dmod_live.js'
 *
 * Through the bridge (LOM + `receive megamod-test`) and real OS mouse events in the VM (scripts/mm_os_input.py):
 *   0. two LFOs: LFO 1 = 1 Hz sine, LFO 2 = 8 Hz; a mapping of LFO 2 onto a Live parameter (the track's volume)
 *   1. the learn gesture with REAL clicks: LST rail button, LFO 1's tab, LRN (armed from LFO 1), LFO 2's tab, the mapping's row in the list
 *      -> ONE depth route (internal, kind depth, source LFO 1, mapId = the mapping), the LRN disarms, the row gets a sub-row
 *   2. the telemetry shows the effective depth of the mapping moving with LFO 1 (sampled over 2 s: min / max spread)
 *   3. delete / undo through the model hooks: the route goes and comes back
 *   4. THE THREE CASES on a real Delay L Time (normalized LOM value; A = LFO 1 Remote mapping, B = LFO 2 through the depth route; the depth route is
 *      UNIPOLAR: m = range * y, y = B's normalized output, eff = clamp(base * m, 0, 1), a stored polarity is ignored): 1. A 0..100 + route range 0 holds ~0.5;
 *      2. A 25..100 + route range 0 holds ~0.625; 3. A 0..100 + route range 50 stays within ~0.25..0.75, reaching near both ends at B's peak and centred at B's
 *      minimum; and the effective depth (telemetry) never goes below 0 while B sweeps through an old "-" route
 * Prints verbatim PASS / FAIL lines. Exit status is non-zero when a check fails.
 */
const { execFileSync } = require("child_process");
const path = require("path");
const C = require(path.join(__dirname, "..", "src", "megamod_config.js"));

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
const near = (a, b, t) => Math.abs(a - b) <= t;

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
const measure = (slot, ms) => globalJson("measure", "test_measure", slot, ms);
function param(name) {
    return evalLom(`
        var d = new LiveAPI(${JSON.stringify(dev.path)});
        var n = d.getcount("parameters");
        for (var i = 0; i < n; i++) {
            var p = new LiveAPI(${JSON.stringify(dev.path)} + " parameters " + i);
            if (String(p.get("name")) === ${JSON.stringify(name)}) return { id: Number(p.id), value: Number(p.get("value")), str: String(p.call("str_for_value", Number(p.get("value")))), count: n };
        }
        return null;
    `);
}
function showDevice() {
    evalLom(`
        var v = new LiveAPI("live_set view");
        var a = new LiveAPI("live_app view");
        a.call("hide_view", "Browser");
        a.call("show_view", "Detail");
        a.call("show_view", "Detail/DeviceChain");
        v.set("selected_track", "id", Number(new LiveAPI("live_set master_track").id));
        return 1;
    `);
    sleep(1200);
    evalLom(`
        var v = new LiveAPI("live_set view");
        var a = new LiveAPI("live_app view");
        v.set("selected_track", "id", Number(new LiveAPI(${JSON.stringify("live_set tracks " + dev.track)}).id));
        v.call("select_device", "id", ${Number(dev.id)});
        a.call("show_view", "Detail/DeviceChain");
        a.call("focus_view", "Detail/DeviceChain");
        return 1;
    `);
    sleep(1500);
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
const click = (lx, ly, dbl) => os("click", Math.round(origin.x + lx), Math.round(origin.y + ly), dbl ? "double" : "");
const mid = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
const geom = () => globalJson("dmodgeom", "test_dmodgeom");
const routesOf = (r) => r.mappings.filter((m) => m.depthRoute > 0);

(function main() {
    const w = JSON.parse(os("window", PROC));
    showDevice();
    os("front", PROC);
    sleep(800);
    let r = report();
    if (!r) { console.error("test_report got no answer; reload the device"); process.exit(1); }
    for (const m of r.mappings) hook("test_delmap", m.id);
    let n = r.mods.filter((m) => m).length;
    while (n < 2) { hook("test_add", 1); sleep(500); n++; }
    hook("test_setparam", 0, "sync", 0); hook("test_setparam", 0, "shape", 0); hook("test_setparam", 0, "rate", 1);
    hook("test_setparam", 1, "sync", 0); hook("test_setparam", 1, "shape", 0); hook("test_setparam", 1, "rate", 8);
    // a Live parameter to map: the mixer volume of the device's own track
    const volId = evalLom(`return Number(new LiveAPI(${JSON.stringify("live_set tracks " + dev.track + " mixer_device volume")}).id);`);
    hook("test_learn", 1, volId);
    sleep(1200);
    hook("test_selui", 1);
    r = report();
    const target = r.mappings.filter((m) => m.mod === 1 && !m.internal)[0];
    check("setup: LFO 2 maps the track volume (one pool mapping, no route yet)", !!target && routesOf(r).length === 0, JSON.stringify(r.mappings.map((m) => ({ id: m.id, mod: m.mod, internal: m.internal }))));
    origin = calibrate(w);
    if (!origin || !target) { check("find the device UI on screen with the real pointer", false, "calibration failed"); console.log(`FAILED (${failed})`); process.exit(1); }
    info(`v8ui origin on screen (${origin.x}, ${origin.y})`);
    let g = geom();

    // ---- 1. the gesture, real clicks: LST on, LFO 1's tab, LRN, LFO 2's tab, the mapping's row
    if (!g.pb) { click(...mid(g.rail.list)); sleep(700); g = geom(); }
    check("a real click on the LST rail button opens the inspector", g.pb === true, String(g.pb));
    click(...mid(g.tabs[0])); sleep(500);
    click(...mid(g.rail.learn)); sleep(600);
    r = report();
    check("a real click on LRN arms learn for LFO 1", r.learn.armed === true && r.learn.mod === 0, JSON.stringify(r.learn));
    click(...mid(g.tabs[1])); sleep(600);
    g = geom();
    check("a real click on LFO 2's tab selects it (single-shot learn stays on LFO 1)", g.sel === 1 && report().learn.mod === 0, `sel ${g.sel}`);
    const row = g.rows[target.id];
    check("LFO 2's mapping has a row in the list", !!row, JSON.stringify(Object.keys(g.rows)));
    click(...mid(row)); sleep(900);
    r = report();
    const rts = routesOf(r);
    check("a real click on the mapping's row while armed creates ONE depth route", rts.length === 1, JSON.stringify(rts.map((m) => ({ id: m.id, mod: m.mod, mapId: m.depthRoute }))));
    if (rts.length === 1) {
        check("...from LFO 1 onto the mapping (mapId), internal: no pool slot, no Live id", rts[0].mod === 0 && rts[0].depthRoute === target.id && rts[0].internal === true && rts[0].slot === -1 && !rts[0].pid, JSON.stringify(rts[0]));
        check("...the learn disarmed (single shot)", r.learn.armed === false);
        g = geom();
        check("...the row now has a sub-row in the list", Object.keys(g.subs).indexOf(String(rts[0].id)) >= 0, JSON.stringify(Object.keys(g.subs)));
        check("the mapping reports one route", r.mappings.filter((m) => m.id === target.id)[0].nRoutes === 1);
        // ---- 2. the effective depth moves with LFO 1 (a 1 Hz sine, range 0.5, unipolar: m = 0.5 (sin + 1) / 2, base depth 1: eff 0..0.5, never negative)
        hook("test_mapupd", target.id, "depth", 1);
        hook("test_mapupd", rts[0].id, "range", 0.5);
        sleep(800);
        const vals = [];
        for (let k = 0; k < 40; k++) { const m = report().mappings.filter((q) => q.id === target.id)[0]; vals.push(m.effDepth); sleep(50); }
        const lo = Math.min(...vals), hi = Math.max(...vals);
        info(`effective depth over 2 s: ${lo.toFixed(3)} .. ${hi.toFixed(3)} (base 1 x m = 0.5 (sin + 1) / 2, LFO 1 at 1 Hz)`);
        check("the telemetry shows the effective depth moving with LFO 1 within 0..0.5 (never below 0)", hi - lo > 0.35 && lo >= -0.001 && lo < 0.1 && hi <= 0.501 && hi > 0.4, `${lo.toFixed(3)}..${hi.toFixed(3)}`);
        // ---- 3. delete / undo
        hook("test_delmap", rts[0].id); sleep(600);
        r = report();
        check("deleting the route removes it", routesOf(r).length === 0);
        hook("test_undo"); sleep(800);
        check("undo restores the route", routesOf(report()).length === 1, JSON.stringify(routesOf(report()).map((m) => m.id)));
    }
    // ---- 4. the three cases on a real Delay L Time
    {
        for (const m of report().mappings) hook("test_delmap", m.id);
        sleep(600);
        evalLom(`var tr = new LiveAPI("live_set tracks ${dev.track}"); tr.call("insert_device", "Delay", 1); return tr.getcount("devices");`);
        const dpath = `live_set tracks ${dev.track} devices 1`;
        const P = (name) => evalLom(`
            var d = new LiveAPI(${JSON.stringify(dpath)});
            var n = d.getcount("parameters");
            for (var i = 0; i < n; i++) {
                var p = new LiveAPI(${JSON.stringify(dpath)} + " parameters " + i);
                if (String(p.get("name")) === ${JSON.stringify(name)}) return { id: Number(p.id), path: ${JSON.stringify(dpath)} + " parameters " + i, min: Number(p.get("min")), max: Number(p.get("max")) };
            }
            return null;
        `);
        const sample = (pr, ms) => {
            const vals = [];
            const t0 = Date.now();
            while (Date.now() - t0 < ms) {
                const v = evalLom(`var p = new LiveAPI(${JSON.stringify(pr.path)}); var o = []; for (var i = 0; i < 6; i++) { o.push(Number(p.get("value"))); var t = Date.now(); while (Date.now() - t < 12) {} } return o;`);
                for (const x of v) vals.push((x - pr.min) / (pr.max - pr.min));
            }
            return { lo: Math.min(...vals), hi: Math.max(...vals), n: vals.length };
        };
        const ls = P("L Sync");
        if (ls) evalLom(`new LiveAPI(${JSON.stringify(ls.path)}).set("value", 0); return 1;`);
        const lt = P("L Time");
        // A = LFO 1 (sine, synced 1/4, bipolar, depth 100 %), B = LFO 2 (a slow bipolar square: it sits at one extreme; the loop below puts it at its peak)
        hook("test_setparam", 0, "sync", 1); hook("test_setparam", 0, "syncDiv", 9); hook("test_setparam", 0, "shape", 0); hook("test_setparam", 0, "bipolar", 1); hook("test_setparam", 0, "depth", 1);
        hook("test_setparam", 1, "sync", 0); hook("test_setparam", 1, "shape", 4); hook("test_setparam", 1, "rate", 0.05); hook("test_setparam", 1, "bipolar", 1); hook("test_setparam", 1, "depth", 1);
        hook("test_learn", 0, P("Dry/Wet").id); sleep(700); for (const m of report().mappings) hook("test_delmap", m.id); sleep(500);
        hook("test_learn", 0, lt.id); sleep(1500);
        const mp = report().mappings.filter((m) => m.mod === 0 && !m.internal)[0];
        check("cases: LFO 1 maps Delay L Time", !!mp && mp.pid === lt.id, JSON.stringify(report().mappings.map((m) => ({ id: m.id, mod: m.mod, pid: m.pid }))));
        if (mp) {
            hook("test_mapupd", mp.id, "mode", "remote"); hook("test_mapupd", mp.id, "min", 0); hook("test_mapupd", mp.id, "max", 1); hook("test_mapupd", mp.id, "depth", 1);
            hook("test_dmodroute", 1, mp.id); sleep(800);
            const rt = report().mappings.filter((m) => m.depthRoute === mp.id)[0];
            check("cases: LFO 2 has a depth route onto the mapping", !!rt);
            if (rt) {
                // an old "-" route: its stored polarity is ignored. B (the slow square) flips every ~10 s: wait for its RISING edge so each window sits at its peak.
                const effOf = () => report().mappings.filter((m) => m.id === mp.id)[0].effDepth;
                const riseToPeak = (range) => {
                    const t0 = Date.now(); let low = false;
                    while (Date.now() - t0 < 30000) { const e = effOf(); if (e < 0.1 * range) low = true; else if (low && e > 0.9 * range) return true; sleep(100); }
                    return false;
                };
                hook("test_mapupd", rt.id, "polarity", -1); hook("test_mapupd", rt.id, "range", 1); sleep(1500);
                check("cases: LFO 2 (slow square) rises to its peak", riseToPeak(1));
                check("cases: LFO 2 at its peak gives the effective depth 1 (range 1, stored polarity -)", effOf() > 0.9 && effOf() <= 1.0001, String(effOf()));
                // case 3 first (needs B at its peak): route range 50
                hook("test_mapupd", rt.id, "range", 0.5); sleep(500);
                check("cases: LFO 2 still at its peak: the effective depth is 0.5 (range 50)", effOf() > 0.45 && effOf() <= 0.5001, String(effOf()));
                let sm = sample(lt, 4000);
                check("case 3: A 0..100, route range 50 (B at its peak) -> A stays within ~0.25..0.75 and reaches near both ends", sm.lo > 0.22 && sm.hi < 0.78 && sm.lo < 0.3 && sm.hi > 0.7, `${sm.lo.toFixed(3)}..${sm.hi.toFixed(3)}`);
                // B at its minimum (unipolar, Depth 0 -> -1): depth 0, A centred at 0.5
                hook("test_setparam", 1, "bipolar", 0); hook("test_setparam", 1, "depth", 0); sleep(1500);
                sm = sample(lt, 3000);
                check("case 3: with B at its minimum A is centred at ~0.5", sm.lo > 0.47 && sm.hi < 0.53, `${sm.lo.toFixed(3)}..${sm.hi.toFixed(3)}`);
                // NEVER BELOW 0: B a full-range 1 Hz sine through the "-" route (range 1): the effective depth stays 0..1 and L Time stays inside 0..1
                hook("test_mapupd", rt.id, "range", 1); hook("test_setparam", 1, "bipolar", 1); hook("test_setparam", 1, "shape", 0); hook("test_setparam", 1, "rate", 1); hook("test_setparam", 1, "depth", 1); sleep(1500);
                const effs = []; const tt = Date.now();
                while (Date.now() - tt < 3500) { effs.push(effOf()); sleep(60); }
                const emin = Math.min(...effs), emax = Math.max(...effs);
                info(`effective depth with B a 1 Hz sine through a stored "-" route: ${emin.toFixed(3)} .. ${emax.toFixed(3)} over ${effs.length} reads`);
                check("the effective depth never goes below 0 on a real Delay L Time mapping (B sweeping, stored polarity -)", effs.length > 15 && emin >= -0.001 && emax <= 1.001 && emin < 0.25 && emax > 0.75, `${emin.toFixed(3)}..${emax.toFixed(3)}`);
                sm = sample(lt, 3000);
                check("L Time stays within 0..1 while B sweeps", sm.lo >= -0.001 && sm.hi <= 1.001, `${sm.lo.toFixed(3)}..${sm.hi.toFixed(3)}`);
                // cases 1 and 2: route range 0 holds A at its centre whatever B does (B still a full-range 1 Hz sine)
                hook("test_mapupd", rt.id, "range", 0); sleep(1500);
                sm = sample(lt, 3000);
                check("case 1: A 0..100, route range 0 -> A holds L Time at ~0.5", sm.lo > 0.47 && sm.hi < 0.53, `${sm.lo.toFixed(3)}..${sm.hi.toFixed(3)}`);
                hook("test_mapupd", mp.id, "min", 0.25); sleep(1500);
                sm = sample(lt, 3000);
                check("case 2: A 25..100, route range 0 -> A holds L Time at ~0.625", sm.lo > 0.595 && sm.hi < 0.655, `${sm.lo.toFixed(3)}..${sm.hi.toFixed(3)}`);
            }
        }
        for (const m of report().mappings) hook("test_delmap", m.id);
        evalLom(`var tr = new LiveAPI("live_set tracks ${dev.track}"); tr.call("delete_device", 1); return 1;`);
    }
    // leave the device as found
    for (const m of report().mappings) hook("test_delmap", m.id);
    const left = report().mods;
    for (let i = 0; i < left.length; i++) if (left[i]) { hook("test_remove", i); sleep(200); }
    if (failed) { console.log(`FAILED (${failed})`); process.exit(1); }
    console.log("megamod depth-route Live test passed");
})();
