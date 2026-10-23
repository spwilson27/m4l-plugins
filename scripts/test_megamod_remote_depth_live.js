#!/usr/bin/env node
/**
 * Mega Modulator: a REMOTE mapping whose DEPTH is modulated by another modulator, in REAL Ableton Live (AGENTS.md 1a: the VM only; section 21).
 *
 *   scripts/vm_live_lock.sh megamod-remote-depth -- zsh -c 'FORCE=1 scripts/vm_megamod_keys.sh live && scripts/vm_megamod_keys.sh run scripts/test_megamod_remote_depth_live.js'
 *
 * Semantics under test (schema 10, unipolar): the depth route is MULTIPLICATIVE (VCA-like) and UNIPOLAR: eff = clamp(base * prod m_k, 0, 1), m = range * dep * y
 * (y = B's normalized output (B + 1) / 2; B at its minimum -> 0, at its peak -> range; a stored polarity is ignored), and a Remote mapping's depth
 * scales AROUND THE CENTRE c = (min + max) / 2: v = c + (lookup - c) * eff. THE THREE CASES (A = the Remote mapping, B the depth route's source, "range" = the route's range):
 *   1. A 0..100, route range 0 -> A always 50 (L Time normalized 0.5)
 *   2. A 25..100, route range 0 -> A always 62.5 (0.625)
 *   3. A 0..100, route range 50 (B swept over its full range) -> A within 25..75, reaching both ends at B's peak and centred at B's minimum
 * Through the bridge (LOM + `receive megamod-test`, no OS input):
 *   - a scratch audio track with a Live Delay (L Sync off), LFO 1 (A, synced sine) + LFO 2 (B), the Remote 0..1 mapping A -> "L Time"
 *   - control (no route, depth 100 %): L Time (normalized 0..1 of its LOM range) sweeps about 0..1
 *   - base depth 0, no route: L Time holds 0.5
 *   - a full-range depth route (stored polarity "-") from LFO 2 at its minimum: L Time stays near 0.5; the effective depth never goes below 0 while B sweeps
 *   - LFO 2 at its peak (a square at a very slow rate, its Depth 100 %): L Time sweeps 0..1
 *   - bounds 0.25..1 with LFO 2 at its minimum: L Time holds the centre 0.625
 *   - the router cells of the mapping's slot: source, effective depth, base depth, Remote centre
 * Prints verbatim PASS / FAIL lines. Exit status is non-zero when a check fails.
 */
const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const PORT = Number(arg("--port", 0)) || null;
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
            if (String(d.get("name")) === "Mega Modulator") out.push({ id: String(d.id), path: tp + " devices " + i, track: t, trackName: String(tr.get("name")) });
        }
    }
    return out;
`);
if (!found.length) { console.error("No Mega Modulator in the set. Run scripts/vm_megamod_keys.sh live first."); process.exit(1); }
let dev = found.find((d) => d.trackName === "Mega Mod Keys") || found[0];
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

const findDevice = () => evalLom(`
    var set = new LiveAPI("live_set");
    for (var t = 0; t < set.getcount("tracks"); t++) {
        var tp = "live_set tracks " + t;
        var tr = new LiveAPI(tp);
        for (var i = 0; i < tr.getcount("devices"); i++) {
            var d = new LiveAPI(tp + " devices " + i);
            if (String(d.get("name")) === "Mega Modulator") return { id: String(d.id), path: tp + " devices " + i, track: t, trackName: String(tr.get("name")) };
        }
    }
    return null;
`);
const P = (devPath, name) => evalLom(`
    var d = new LiveAPI(${JSON.stringify(devPath)});
    var n = d.getcount("parameters");
    for (var i = 0; i < n; i++) {
        var p = new LiveAPI(${JSON.stringify(devPath)} + " parameters " + i);
        if (String(p.get("name")) === ${JSON.stringify(name)}) return { id: Number(p.id), idx: i, path: ${JSON.stringify(devPath)} + " parameters " + i,
            min: Number(p.get("min")), max: Number(p.get("max")), value: Number(p.get("value")), quant: Number(p.get("is_quantized")),
            str: String(p.call("str_for_value", 0)) + " .. " + String(p.call("str_for_value", 1)) };
    }
    return null;
`);
function sampleParam(pr, ms) {
    const vals = [];
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const v = evalLom(`var p = new LiveAPI(${JSON.stringify(pr.path)}); var o = []; for (var i = 0; i < 6; i++) { o.push(Number(p.get("value"))); var t = Date.now(); while (Date.now() - t < 12) {} } return o;`);
        for (const x of v) vals.push((x - pr.min) / (pr.max - pr.min));
    }
    return { lo: Math.min(...vals), hi: Math.max(...vals), n: vals.length };
}
const delayParam = (devPath, name) => {
    const q = P(devPath, name);
    if (!q) throw new Error("Delay has no " + name);
    return q;
};

// Setup: LFO 1 (A: sine, synced 1/4, bipolar, depth 100 %) Remote 0..1 onto `lt`, depth 100 %; LFO 2 (B, Depth 0 = outputs 0) is the route source.
function setup(lt, pre, nudge) {
    let r = report();
    if (!r) { console.error("test_report got no answer; reload the device"); process.exit(1); }
    for (const m of r.mappings) hook("test_delmap", m.id);
    let n = r.mods.filter((m) => m).length;
    while (n < 2) { hook("test_add", 1); sleep(700); n++; }
    sleep(800);
    hook("test_setparam", 0, "sync", 1); hook("test_setparam", 0, "syncDiv", 9); hook("test_setparam", 0, "shape", 0);
    hook("test_setparam", 0, "bipolar", 1); hook("test_setparam", 0, "depth", 1);
    // LFO 2 (B): a sine, 1 Hz, Depth 0 -> its bipolar output is exactly 0 (the route source "at 0")
    hook("test_setparam", 1, "sync", 0); hook("test_setparam", 1, "shape", 0); hook("test_setparam", 1, "rate", 1);
    hook("test_setparam", 1, "bipolar", 1); hook("test_setparam", 1, "depth", 0);
    // (the learn ignores a selection equal to the last one: select another parameter first so L Time counts as a change)
    if (nudge) { hook("test_learn", 0, nudge); sleep(700); for (const m of report().mappings) hook("test_delmap", m.id); sleep(500); }
    for (const pid of pre || []) { hook("test_learn", 1, pid); sleep(700); }
    hook("test_learn", 0, lt.id);
    sleep(1500);
    r = report();
    const map = r.mappings.filter((m) => m.mod === 0 && !m.internal)[0];
    check("setup: LFO 1 maps Delay L Time (one pool mapping)", !!map && map.pid === lt.id, JSON.stringify(r.mappings.map((m) => ({ id: m.id, mod: m.mod, pid: m.pid }))));
    if (!map) { console.log(`FAILED (${failed})`); process.exit(1); }
    hook("test_mapupd", map.id, "mode", "remote");
    hook("test_mapupd", map.id, "min", 0);
    hook("test_mapupd", map.id, "max", 1);
    hook("test_mapupd", map.id, "depth", 1);
    sleep(1500);
    return map;
}
function addRoute(map, range) {
    hook("test_dmodroute", 1, map.id);
    sleep(800);
    const r = report();
    const rt = r.mappings.filter((m) => m.depthRoute === map.id)[0];
    check("LFO 2 has a depth route onto the mapping", !!rt, JSON.stringify(r.mappings.map((m) => ({ id: m.id, dr: m.depthRoute }))));
    if (rt) { hook("test_mapupd", rt.id, "polarity", 0); // (stored polarity is ignored by a depth route)
        hook("test_mapupd", rt.id, "range", range); sleep(800); }
    return rt;
}
// B = LFO 2: its minimum (unipolar, Depth 0 -> -1), its peak (a very slow bipolar square, Depth 100 %), a full-range 1 Hz bipolar sine
const bMin = () => { hook("test_setparam", 1, "shape", 0); hook("test_setparam", 1, "bipolar", 0); hook("test_setparam", 1, "depth", 0); };
const bPeak = () => { hook("test_setparam", 1, "bipolar", 1); hook("test_setparam", 1, "shape", 4); hook("test_setparam", 1, "rate", 0.05); hook("test_setparam", 1, "depth", 1); sleep(1500); };
const bSine = () => { hook("test_setparam", 1, "bipolar", 1); hook("test_setparam", 1, "shape", 0); hook("test_setparam", 1, "rate", 1); hook("test_setparam", 1, "depth", 1); };
// B's slow square flips every ~10 s: wait for a RISING edge (low, then high), so the next ~9 s are at the peak. `range` = the route's range (the effective depth reads
// range at B's peak and 0 at its minimum).
function riseToPeak(mapId, range) {
    const eff = () => mapInfo(mapId).effDepth;
    const t0 = Date.now();
    let low = false;
    while (Date.now() - t0 < 30000) {
        const e = eff();
        if (e < 0.1 * range) low = true;
        else if (low && e > 0.9 * range) return true;
        sleep(100);
    }
    return false;
}
const holds = (s, c, tol) => s.lo > c - tol && s.hi < c + tol;
const mapInfo = (id) => report().mappings.filter((m) => m.id === id)[0];
function cleanup() {
    for (const m of report().mappings) hook("test_delmap", m.id);
    const left = report().mods;
    for (let i = 0; i < left.length; i++) if (left[i]) { hook("test_remove", i); sleep(300); }
    sleep(1500);
    const rest = report();
    if (rest.mods.some((m) => m) || rest.mappings.length) info("cleanup left " + JSON.stringify({ mods: rest.mods, maps: rest.mappings.length }));
}

(function main() {
    // ================= A. a scratch track with a Live Delay (L Sync off), fresh mapping
    const scratch = evalLom(`
        var set = new LiveAPI("live_set");
        set.call("create_audio_track", -1);
        var n = set.getcount("tracks") - 1;
        var tp = "live_set tracks " + n;
        var tr = new LiveAPI(tp);
        tr.set("name", "MM Scratch");
        tr.call("insert_device", "Delay");
        return { track: n, path: tp + " devices 0", count: tr.getcount("devices") };
    `);
    let ls = P(scratch.path, "L Sync");
    let lt, map, mm, s;
    // variants: [Delay L Sync, transport playing, mappings added before (so the mapping sits in a later pool slot)]
    for (const v of [{ sync: 0, play: 0, pre: 0 }, { sync: 0, play: 1, pre: 3 }]) {
        const tag = `A(L Sync ${v.sync}, ${v.play ? "playing" : "stopped"}, ${v.pre} earlier mappings)`;
        if (ls) evalLom(`new LiveAPI(${JSON.stringify(ls.path)}).set("value", ${v.sync}); return 1;`);
        evalLom(`new LiveAPI("live_set").call(${JSON.stringify(v.play ? "start_playing" : "stop_playing")}); return 1;`);
        lt = delayParam(scratch.path, "L Time");
        const pre = ["Feedback", "Filter Freq", "Filter Width"].slice(0, v.pre).map((nm) => P(scratch.path, nm).id);
        info(`${tag}: L Time min ${lt.min} max ${lt.max} value ${lt.value} quantized ${lt.quant} display ${lt.str}`);
        map = setup(lt, pre, P(scratch.path, "Dry/Wet").id);
        mm = mapInfo(map.id);
        info(`${tag}: mapping mode ${mm.mode} status ${mm.status} slot ${mm.slot} bound rem ${mm.idRem} cells [src, eff, base, centre] ${JSON.stringify(mm.cells)}`);
        s = sampleParam(lt, 3000);
        info(`${tag}: control (no route, depth 100 %): L Time normalized ${s.lo.toFixed(3)} .. ${s.hi.toFixed(3)} over ${s.n} samples`);
        check(`${tag}: Remote 0..1 at depth 100 % sweeps L Time (control)`, s.hi - s.lo > 0.6 && s.hi > 0.85 && s.lo < 0.15, `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
        // base depth 0, no route: the Remote output sits at the centre 0.5 (depth scales around the centre of the bounds)
        hook("test_mapupd", map.id, "depth", 0); sleep(1000);
        s = sampleParam(lt, 2000);
        info(`${tag}: base depth 0, no route: L Time normalized ${s.lo.toFixed(3)} .. ${s.hi.toFixed(3)} over ${s.n} samples`);
        check(`${tag}: base depth 0 with no route holds L Time at 0.5`, holds(s, 0.5, 0.03), `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
        hook("test_mapupd", map.id, "depth", 1); sleep(1000);
        // UNIPOLAR depth route: m = range * y (y = B's normalized output), eff = clamp(base * m, 0, 1). B = LFO 2. B at its MINIMUM (unipolar LFO, Depth 0 -> -1) -> depth 0 -> 0.5.
        // The route is created with the default polarity (+-) and then set to "-" (an old route): the stored polarity must be ignored.
        const rt = addRoute(map, 1.0);
        hook("test_mapupd", rt.id, "polarity", -1); sleep(500);
        bMin(); sleep(1500);
        mm = mapInfo(map.id);
        info(`${tag}: full-range route (stored polarity -), LFO 2 at its minimum: effDepth ${mm.effDepth} cells [src, eff, base, centre] ${JSON.stringify(mm.cells)}`);
        s = sampleParam(lt, 3000);
        info(`${tag}: full-range route, B at its minimum: L Time normalized ${s.lo.toFixed(3)} .. ${s.hi.toFixed(3)} over ${s.n} samples`);
        check(`${tag}: with the depth route at full range and LFO 2 at its minimum, L Time stays near 0.5`, holds(s, 0.5, 0.03), `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
        check(`${tag}: ...the effective depth is 0 (not negative)`, mm.effDepth > -0.001 && mm.effDepth < 0.02, String(mm.effDepth));
        check(`${tag}: the router cells hold base depth 1, Remote centre 0.5 and a source`, mm.cells && mm.cells[2] === 1 && Math.abs(mm.cells[3] - 0.5) < 1e-6 && mm.cells[0] >= 0, JSON.stringify(mm.cells));
        // B at its PEAK: a square at a very slow rate (bipolar, Depth 100 %); wait for its rising edge so the window below sits at the peak
        bPeak();
        check(`${tag}: LFO 2 (slow square) rises to its peak`, riseToPeak(map.id, 1));
        mm = mapInfo(map.id);
        info(`${tag}: LFO 2 at its peak: effDepth ${mm.effDepth}`);
        check(`${tag}: LFO 2 at its peak gives the full effective depth 1`, mm.effDepth > 0.9 && mm.effDepth <= 1.0001, String(mm.effDepth));
        s = sampleParam(lt, 3000);
        info(`${tag}: full-range route, B at its peak: L Time normalized ${s.lo.toFixed(3)} .. ${s.hi.toFixed(3)} over ${s.n} samples`);
        check(`${tag}: with LFO 2 at its peak L Time sweeps 0..1`, s.hi - s.lo > 0.6 && s.hi > 0.85 && s.lo < 0.15, `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
        // NEVER BELOW 0: B a full-range sine (1 Hz) through the old "-" route; the effective depth (engine telemetry) stays 0..1 and L Time stays inside 0..1 without mirroring
        bSine(); sleep(1500);
        const effs = [];
        const t0 = Date.now();
        while (Date.now() - t0 < 3500) { effs.push(mapInfo(map.id).effDepth); sleep(60); }
        const emin = Math.min(...effs), emax = Math.max(...effs);
        info(`${tag}: B sine 1 Hz through the route (stored polarity -): effective depth ${emin.toFixed(3)} .. ${emax.toFixed(3)} over ${effs.length} reads`);
        check(`${tag}: the effective depth never goes below 0 (B sweeping its full range, stored polarity -)`, effs.length > 15 && emin >= -0.001 && emax <= 1.001, `${emin.toFixed(3)}..${emax.toFixed(3)}`);
        check(`${tag}: ...and it does follow B (reaches near 0 and near 1)`, emin < 0.25 && emax > 0.75, `${emin.toFixed(3)}..${emax.toFixed(3)}`);
        s = sampleParam(lt, 3000);
        check(`${tag}: L Time (a real Delay) stays within 0..1 while B sweeps`, s.lo >= -0.001 && s.hi <= 1.001, `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
        // bounds 0.25..1 with B at its minimum: the centre 0.625
        bMin(); hook("test_mapupd", map.id, "min", 0.25); sleep(1500);
        mm = mapInfo(map.id);
        s = sampleParam(lt, 2000);
        info(`${tag}: bounds 0.25..1, LFO 2 at its minimum: L Time normalized ${s.lo.toFixed(3)} .. ${s.hi.toFixed(3)} over ${s.n} samples; cells ${JSON.stringify(mm.cells)}`);
        check(`${tag}: bounds 0.25..1 with LFO 2 at its minimum holds L Time at 0.625`, holds(s, 0.625, 0.03), `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
        // THE CASES. Case 3 first (B at its peak: wait for the slow square's rising edge); A (LFO 1) keeps sweeping its lookup
        hook("test_mapupd", map.id, "min", 0); hook("test_mapupd", rt.id, "range", 0.5); bPeak();
        check(`${tag}: case 3: LFO 2 (slow square) rises to its peak`, riseToPeak(map.id, 0.5));
        s = sampleParam(lt, 4000);
        info(`${tag}: case 3 (A 0..100, route range 50, B at its peak): L Time normalized ${s.lo.toFixed(3)} .. ${s.hi.toFixed(3)} over ${s.n} samples; effDepth ${mapInfo(map.id).effDepth}`);
        check(`${tag}: case 3: A 0..100 with route range 50, B at its peak, stays within 0.25..0.75 and reaches both ends`, s.lo > 0.22 && s.hi < 0.78 && s.lo < 0.3 && s.hi > 0.7, `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
        bMin(); sleep(1500);
        s = sampleParam(lt, 3000);
        info(`${tag}: case 3 with B at its minimum: L Time normalized ${s.lo.toFixed(3)} .. ${s.hi.toFixed(3)} over ${s.n} samples`);
        check(`${tag}: case 3: with B at its minimum A is centred at 0.5`, holds(s, 0.5, 0.03), `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
        // cases 1 and 2: route range 0 holds A at its centre whatever B does (B a full-range 1 Hz sine)
        hook("test_mapupd", rt.id, "range", 0); bSine(); sleep(1500);
        s = sampleParam(lt, 3000);
        info(`${tag}: case 1 (A 0..100, route range 0, B sweeping): L Time normalized ${s.lo.toFixed(3)} .. ${s.hi.toFixed(3)} over ${s.n} samples`);
        check(`${tag}: case 1: A 0..100 with route range 0 holds L Time at 0.5`, holds(s, 0.5, 0.03), `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
        hook("test_mapupd", map.id, "min", 0.25); sleep(1500);
        s = sampleParam(lt, 3000);
        info(`${tag}: case 2 (A 25..100, route range 0, B sweeping): L Time normalized ${s.lo.toFixed(3)} .. ${s.hi.toFixed(3)} over ${s.n} samples`);
        check(`${tag}: case 2: A 25..100 with route range 0 holds L Time at 0.625`, holds(s, 0.625, 0.03), `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
        cleanup();
    }
    evalLom(`new LiveAPI("live_set").call("stop_playing"); return 1;`);
    evalLom(`new LiveAPI("live_set").call("delete_track", ${scratch.track}); return 1;`);

    // ================= B. a Set LOAD: the same mapping + route on a Delay after the device, then `duplicate_track` (Live restores the clone's
    // parameters + MegaModState blob like a Set load) and the original track is deleted so the saved paths point at the clone's own Delay
    const trk = dev.track;
    evalLom(`var tr = new LiveAPI("live_set tracks ${trk}"); tr.call("insert_device", "Delay", 1); return tr.getcount("devices");`);
    const dpath = `live_set tracks ${trk} devices 1`;
    ls = P(dpath, "L Sync");
    if (ls) evalLom(`new LiveAPI(${JSON.stringify(ls.path)}).set("value", 0); return 1;`);
    lt = delayParam(dpath, "L Time");
    map = setup(lt, [], P(dpath, "Dry/Wet").id);
    addRoute(map, 1.0);
    mm = mapInfo(map.id);
    info(`B. before the reload: effDepth ${mm.effDepth} cells ${JSON.stringify(mm.cells)}`);
    const before = dev.id;
    // the original is deleted at once, before the clone's init_lom (the deferred-DSP build loads the face in about 0.7 s: with the old 5 s wait the clone resolved its target
    // (a path into the ORIGINAL track) to the original's Delay and lost it when that track was deleted; the old build only worked because its gen compile blocked the load for 4 s)
    evalLom(`var s = new LiveAPI("live_set"); s.call("duplicate_track", ${trk}); s.call("delete_track", ${trk}); return 1;`);
    sleep(7500);
    const clone = findDevice();
    check("B. the clone is a different Mega Modulator", !!clone && clone.id !== before, clone ? clone.id : "none");
    if (!clone) { console.log(`FAILED (${failed})`); process.exit(1); }
    dev = clone;
    // the clone builds its own deferred DSP after the face (src/megamod_dsp.js): modulation starts when it runs
    for (let w = 0; w < 60; w++) { const q = report(); if (q && q.dsp && q.dsp.ready) break; sleep(500); }
    info("B. clone DSP: " + JSON.stringify((report() || {}).dsp));
    { const q = report(); info("B. clone mapping targets: " + JSON.stringify(q.mappings.map((m) => ({ path: m.path, status: m.status, pid: m.pid, mode: m.mode }))) + " lomReady " + q.lomReady + " self " + q.self); }
    sleep(3000);
    lt = delayParam(`live_set tracks ${dev.track} devices 1`, "L Time");
    const rr = report();
    const cm = rr.mappings.filter((m) => !m.internal)[0];
    info(`B. after the reload: ${rr.mappings.length} mappings, pool mapping ${cm ? JSON.stringify({ mode: cm.mode, status: cm.status, depth: cm.depth, slot: cm.slot, rem: cm.idRem, effDepth: cm.effDepth, cells: cm.cells }) : "none"}`);
    bMin(); sleep(1500);
    s = sampleParam(lt, 3000);
    info(`B. after the reload with the route (LFO 2 at its minimum): L Time normalized ${s.lo.toFixed(3)} .. ${s.hi.toFixed(3)} over ${s.n} samples`);
    check("B. after a Set load the full-range depth route with LFO 2 at its minimum still holds L Time near 0.5", holds(s, 0.5, 0.03), `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
    bPeak();
    check("B. after the reload LFO 2 (slow square) rises to its peak", riseToPeak(report().mappings.filter((m) => !m.internal)[0].id, 1));
    s = sampleParam(lt, 3000);
    info(`B. after the reload, LFO 2 at its peak: L Time normalized ${s.lo.toFixed(3)} .. ${s.hi.toFixed(3)} over ${s.n} samples`);
    check("B. after a Set load the Remote mapping + depth route sweeps L Time 0..1 with LFO 2 at its peak", s.hi - s.lo > 0.6 && s.hi > 0.85 && s.lo < 0.15, `${s.lo.toFixed(3)}..${s.hi.toFixed(3)}`);
    cleanup();
    evalLom(`var tr = new LiveAPI("live_set tracks ${dev.track}"); tr.call("delete_device", 1); return 1;`);
    if (failed) { console.log(`FAILED (${failed})`); process.exit(1); }
    console.log("megamod remote + depth route (VCA, centre-scaled) Live test passed");
})();
