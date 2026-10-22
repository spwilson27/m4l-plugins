#!/usr/bin/env node
/**
 * Mega Modulator self-modulation in REAL Ableton Live (AGENTS.md 1a: the VM only; section 21: "Self-modulation").
 *
 *   scripts/vm_live_lock.sh megamod-selfmod -- zsh -c 'FORCE=1 scripts/vm_megamod_keys.sh live && scripts/vm_megamod_keys.sh run scripts/test_megamod_selfmod_live.js'
 *
 * Through the bridge (`--port`, LOM + `receive megamod-test`) and real OS mouse events in the VM (`--ssh`, scripts/mm_os_input.py):
 *   0. two LFOs: LFO 1 = a very slow square (a constant +1 or -1 for the whole test), LFO 2 = 4 Hz free-running
 *   1. baseline: LFO 2 cycles counted from the engine telemetry over 2.5 s (~10)
 *   2. selector INTERNAL: a real click on LFO 2's Depth face (moves Live's selection), LRN armed by a real click, a real click on LFO 2's Rate
 *      face -> an INTERNAL self-mapping (no pool slot, no live.* object); range = +-1 octave: LFO 2's speed doubles / halves
 *   3. selector VIA LIVE: the same gesture -> a normal pool mapping on the device's own Live parameter `M2 A`; the live.modulate~ of the
 *      pool is bound to that parameter's id; LFO 2's speed is measured again and the evidence (LOM value, what the device receives, the
 *      engine cfg) is printed
 *   4. the selector converts existing self-mappings (VIA LIVE -> INTERNAL -> VIA LIVE) and Cmd-Z-style undo restores them
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
// collapsed strips (src/megamod_ui.js): strip j at x = 22 + 58 j (56 wide); a 27 x 28 dial face centred on each knob at y 88..116: Rate at x + 1, Depth at x + 28
const RAIL_LRN = [10, 11];
const faceCenter = (j, k) => [22 + 58 * j + 1 + 27 * k + 13.5, 88 + 14];
// a real learn gesture: select another parameter (Live's selection must CHANGE), arm LRN with a real click, click the target face
function learnClick(j, k, other) {
    const o = faceCenter(j, other);
    click(o[0], o[1]);
    sleep(500);
    click(RAIL_LRN[0], RAIL_LRN[1]);
    sleep(500);
    const armed = report().learn;
    const f = faceCenter(j, k);
    click(f[0], f[1]);
    sleep(900);
    return armed;
}
const OCT = Math.log(2) / Math.log(40 / 0.01); // one octave of the Rate knob, normalized
function cycles(slot, ms) {
    const a = measure(0, 50); // LFO 1 (a very slow square: +1 or -1)
    const m = measure(slot, ms);
    const b = measure(0, 50);
    return { f: (m.wraps * 1000) / m.ms, wraps: m.wraps, ms: m.ms, rate: m.rate, lfo1: a.out1, lfo1End: b.out1, factor: Math.pow(2, a.out1 > 0 ? 1 : -1) };
}
const selfMaps = (r) => r.mappings.filter((m) => m.selfDest >= 0);

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
    // LFO 1: a very slow square (constant +1 for 50 s from its start, then -1); LFO 2: 4 Hz free-running sine
    hook("test_setparam", 0, "sync", 0); hook("test_setparam", 0, "shape", 4); hook("test_setparam", 0, "rate", 0.01);
    hook("test_setparam", 1, "sync", 0); hook("test_setparam", 1, "shape", 0); hook("test_setparam", 1, "rate", 4);
    hook("test_selfmod", "internal");
    sleep(1000);
    r = report();
    check("the device script is ready and the Options selector defaults to INTERNAL", r && r.auto === true && r.settings.selfMod === "internal", JSON.stringify(r && r.settings));

    origin = calibrate(w);
    if (!origin) { check("find the device UI on screen with the real pointer", false, "the v8ui never reported a hover"); console.log(`FAILED (${failed})`); process.exit(1); }
    info(`v8ui origin on screen (${origin.x}, ${origin.y})`);

    // ---- 1. baseline
    const base = cycles(1, 2500);
    info(`baseline LFO 2: ${base.wraps} cycles in ${base.ms} ms = ${base.f.toFixed(2)} Hz, cfg rate ${base.rate}, LFO 1 out ${base.lfo1}`);
    check("baseline: LFO 2 runs at ~4 Hz", near(base.f, 4, 0.5), `${base.f.toFixed(2)} Hz`);
    check("LFO 1 is a constant +1 / -1 (square)", Math.abs(Math.abs(base.lfo1) - 1) < 1e-6, String(base.lfo1));

    // ---- 2. INTERNAL, learned with real clicks
    const armed = learnClick(1, 0, 1);
    info(`LRN armed by a real click: ${JSON.stringify(armed)}`);
    check("a real click on the LRN button arms learn", armed && armed.armed === true, JSON.stringify(armed));
    r = report();
    let sm = selfMaps(r);
    check("INTERNAL: a real click on LFO 2's Rate face creates ONE self-mapping", sm.length === 1, JSON.stringify(sm.map((m) => ({ id: m.id, internal: m.internal, dest: m.selfDest, label: m.label }))));
    if (sm.length === 1) {
        check("INTERNAL: it is an internal route (no pool slot, no Live id) on dest code 6 (M2 A), named by meaning", sm[0].internal === true && sm[0].slot === -1 && sm[0].selfDest === 6 && sm[0].label === "LFO 2 Rate", JSON.stringify(sm[0]));
        check("INTERNAL: the learn disarmed (single shot)", report().learn.armed === false);
        hook("test_mapupd", sm[0].id, "range", OCT);
        sleep(800);
        const mi = cycles(1, 2500);
        const lfo1 = mi.lfo1;
        info(`INTERNAL +-1 oct: LFO 2 ${mi.wraps} cycles in ${mi.ms} ms = ${mi.f.toFixed(2)} Hz (LFO 1 = ${lfo1}, expected ${(4 * mi.factor).toFixed(2)} Hz), cfg rate ${mi.rate}`);
        check("INTERNAL: LFO 2's speed follows LFO 1 (x2 / x1/2)", near(mi.f, 4 * mi.factor, 4 * mi.factor * 0.12), `${mi.f.toFixed(2)} Hz vs ${(4 * mi.factor).toFixed(2)}`);
        check("INTERNAL: the engine's cfg (the stored value) is untouched", near(mi.rate, 4, 1e-6), String(mi.rate));
        const eff = report().eff[1].ctl[0];
        const nb = C.autoNorm("rate", 4);
        check("INTERNAL: the telemetry reports the modulated knob value (the ring)", lfo1 > 0 ? eff > nb + 0.05 : eff < nb - 0.05, `effective ${eff.toFixed(3)} vs stored ${nb.toFixed(3)}`);
        hook("test_delmap", sm[0].id);
        sleep(600);
        const gone = cycles(1, 2000);
        check("INTERNAL: deleting the mapping restores 4 Hz", near(gone.f, 4, 0.5), `${gone.f.toFixed(2)} Hz`);
    }

    // ---- 3. VIA LIVE, learned with real clicks
    hook("test_selfmod", "live");
    sleep(800);
    check("the Options selector switched to VIA LIVE", report().settings.selfMod === "live");
    learnClick(1, 0, 1);
    r = report();
    sm = selfMaps(r);
    check("VIA LIVE: a real click on LFO 2's Rate face creates ONE self-mapping", sm.length === 1, JSON.stringify(sm.map((m) => ({ id: m.id, internal: m.internal, dest: m.selfDest, label: m.label }))));
    if (sm.length === 1) {
        const pM2A = param("M2 A");
        check("VIA LIVE: it is a pool mapping (slot >= 0) on the device's own parameter M2 A, named by meaning", sm[0].internal === false && sm[0].slot >= 0 && sm[0].selfDest === 6 && sm[0].label === "LFO 2 Rate (M2 A)", JSON.stringify(sm[0]));
        check("VIA LIVE: the pool's live.modulate~ is bound to the device's OWN parameter id", pM2A && sm[0].idMod === pM2A.id && sm[0].idMod > 0, `bound id ${sm[0].idMod}, M2 A id ${pM2A && pM2A.id}`);
        check("VIA LIVE: the route is on (source modulator 0) and the mapping is active", sm[0].route === 0 && sm[0].status === "ok", `route ${sm[0].route}, status ${sm[0].status}`);
        hook("test_mapupd", sm[0].id, "range", OCT);
        sleep(1500);
        const stored = param("M2 A");
        const mv = cycles(1, 2500);
        const rep2 = report();
        info(`VIA LIVE +-1 oct: LFO 2 ${mv.wraps} cycles in ${mv.ms} ms = ${mv.f.toFixed(2)} Hz (LFO 1 = ${mv.lfo1}, expected ${(4 * mv.factor).toFixed(2)} Hz)`);
        info(`EVIDENCE LOM M2 A value ${stored.value.toFixed(3)} (${stored.str}), stored rate norm ${(100 * C.autoNorm("rate", 4)).toFixed(3)}; model rate ${rep2.modP[1].rate}; engine cfg rate ${mv.rate}; device-received cache ap_6 ${rep2.cache.ap_6}`);
        check("VIA LIVE: LFO 2 actually changes speed (period measured from telemetry)", near(mv.f, 4 * mv.factor, 4 * mv.factor * 0.15), `${mv.f.toFixed(2)} Hz vs expected ${(4 * mv.factor).toFixed(2)} Hz (baseline ${base.f.toFixed(2)})`);
        check("VIA LIVE: the modulation did not write back into the model's stored value", near(rep2.modP[1].rate, 4, 1e-6), String(rep2.modP[1].rate));
        hook("test_delmap", sm[0].id);
        sleep(800);
    }

    // ---- 4. conversion
    hook("test_selflearn", 0, 6, "live");
    sleep(500);
    r = report();
    sm = selfMaps(r);
    if (sm.length === 1) {
        hook("test_mapupd", sm[0].id, "range", OCT);
        hook("test_selfmod", "internal");
        sleep(800);
        const rc = selfMaps(report());
        check("selector VIA LIVE -> INTERNAL converts the existing self-mapping (same id, range, internal now)", rc.length === 1 && rc[0].id === sm[0].id && rc[0].internal === true && rc[0].slot === -1, JSON.stringify(rc[0]));
        const mc = cycles(1, 2000);
        check("converted: still modulates LFO 2", near(mc.f, 4 * mc.factor, 4 * mc.factor * 0.15), `${mc.f.toFixed(2)} Hz vs ${(4 * mc.factor).toFixed(2)}`);
        hook("test_undo");
        sleep(800);
        const ru = selfMaps(report());
        check("undo restores the VIA LIVE mapping on its pool slot", ru.length === 1 && ru[0].internal === false && ru[0].slot >= 0, JSON.stringify(ru[0]));
        hook("test_delmap", ru[0] ? ru[0].id : 0);
    }
    // leave the device as found (the other Live tests expect a fresh device)
    hook("test_selfmod", "internal");
    for (const m of report().mappings) hook("test_delmap", m.id);
    const left = report().mods;
    for (let i = 0; i < left.length; i++) if (left[i]) { hook("test_remove", i); sleep(200); }
    if (failed) { console.log(`FAILED (${failed})`); process.exit(1); }
    console.log("megamod selfmod Live test passed");
})();
