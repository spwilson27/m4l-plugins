#!/usr/bin/env node
/**
 * Mega Modulator deferred DSP in REAL Live (AGENTS.md 1a: the VM only; section 21 "Load time"). Through the bridge, no OS input:
 *
 *   scripts/vm_live_lock.sh megamod-dsp -- zsh -c 'FORCE=1 scripts/vm_megamod_keys.sh live && scripts/vm_megamod_keys.sh run scripts/test_megamod_dsp_live.js'
 *
 *   1. the device ships without gen~ objects and builds its DSP after load: `test_report.dsp.ready`, `dsp_diag` (engine + 8 routers present, the cord count, every
 *      router heartbeat moving and echoing 32 r + 1, the engine frame counter moving), the load trace (Global megamod_load_trace) with the step timings
 *   2. an LFO runs at its rate (test_measure counts cycles of the engine's scope phase)
 *   3. queued writes: `dsp_restart` tears the graph down; while it is down the rate multiplier is set to 2 and an LFO's Rate parameter is moved (messages
 *      the mapper must hold); when the DSP is back the LFO runs at the NEW rate and 2x (the stored Params were flushed)
 *   4. pass-through: plugin~ -> plugout~ is connected by the DSP build once the engine is ready (silence while it loads); dsp_diag.plug.pass
 * Prints PASS / FAIL lines; exit status non-zero on a failure.
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
const check = (name, ok, detail) => { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? "  [" + detail + "]" : "")); };
const info = (s) => console.log("INFO " + s);

const dev = evalLom(`var s = new LiveAPI("live_set"); for (var t = 0; t < s.getcount("tracks"); t++) { var tr = new LiveAPI("live_set tracks " + t); for (var i = 0; i < tr.getcount("devices"); i++) { var d = new LiveAPI("live_set tracks " + t + " devices " + i); if (String(d.get("name")) === "Mega Modulator") return { id: String(d.id), path: "live_set tracks " + t + " devices " + i }; } } return null;`);
if (!dev) { console.error("no Mega Modulator in the set (scripts/vm_megamod_keys.sh live first)"); process.exit(1); }
const hook = (...a) => evalLom(`messnamed("megamod-test", ${a.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
const gjson = (prop, hookName, ...h) => {
    const raw = evalLom(`var g = new Global("megamod_test"); g[${JSON.stringify(prop + "_" + dev.id)}] = ""; messnamed("megamod-test", ${JSON.stringify(hookName)}${h.map((x) => ", " + JSON.stringify(x)).join("")}); return String(g[${JSON.stringify(prop + "_" + dev.id)}] || "");`);
    return raw ? JSON.parse(raw) : null;
};
const report = () => gjson("report", "test_report");
const diag = () => gjson("dsp", "dsp_diag");
const trace = () => String(evalLom(`var g = new Global("megamod_load_trace"); return g.text ? String(g.text) : "";`) || "").split("\n").filter((l) => l.includes("[#" + dev.id + "]"));
function waitDsp(ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const r = report(); if (r && r.dsp && r.dsp.ready) return Date.now() - t0; sleep(300); }
    return -1;
}
const measure = (slot, ms) => { const m = gjson("measure", "test_measure", slot, ms); return m ? Object.assign(m, { hz: m.wraps / (m.ms / 1000) }) : null; };

// 1. the device built its DSP after load
check("the DSP is ready (deferred build finished)", waitDsp(30000) >= 0);
{
    const r = report();
    check("report.dsp: ready, no error", r.dsp.ready === true && r.dsp.error === "", JSON.stringify(r.dsp));
    const d = diag();
    check("dsp_diag: state ready, engine gen~ present", d && d.state === "ready" && d.engine && d.engine.cls === "gen~", JSON.stringify(d && { state: d.state, engine: d.engine, retries: d.retries, cords: d.cords }));
    check("dsp_diag: all 8 routers present, heartbeat moving, echo = 32 r + 1", d && d.routers.every((q, i) => q.present && q.hb > 0 && q.echo === 32 * i + 1), JSON.stringify(d && d.routers));
    check("dsp_diag: the cords were scripted (771 gen cords + 2 pass-through = 773)", d && d.cords === 773, d && d.cords);
    const f0 = diag().engineFrames; sleep(400); const f1 = diag().engineFrames;
    check("the engine frame counter moves", f1 > f0, f0 + " -> " + f1);
    const tr = trace();
    info("load trace:\n" + tr.map((l) => "   " + l).join("\n"));
    check("trace: dsp-start, engine-wired, routers-wired, engine-loaded, dsp-ready", ["dsp-start", "engine-wired", "routers-wired", "engine-loaded", "dsp-ready"].every((t) => tr.some((l) => l.startsWith(t + " "))));
    const at = (tag) => { const l = tr.find((x) => x.startsWith(tag + " ")); return l ? Number(/ t=(\d+)/.exec(l)[1]) : 0; };
    check("trace: face-ready came before dsp-ready", at("face-ready") > 0 && at("face-ready") <= at("dsp-ready"), (at("dsp-ready") - at("face-ready")) + " ms after the face");
    info("dsp-start -> dsp-ready " + (at("dsp-ready") - at("dsp-start")) + " ms, wiring " + (at("routers-wired") - at("dsp-start")) + " ms");
}

// 4. the audio path: silence until the engine is ready, then plugin~ -> plugout~ (both channels) connected by the DSP build
{
    const d = diag();
    check("plugin~ -> plugout~ is connected once the DSP is ready (silence while it was loading)", d && d.state === "ready" && d.plug && d.plug.plugin && d.plug.plugout && d.plug.hub && d.plug.pass === 1, JSON.stringify(d && d.plug));
}

// 2. an LFO runs at its rate
hook("test_add", 1); sleep(800);
hook("test_setparam", 0, "sync", 0); hook("test_setparam", 0, "rate", 2); sleep(500);
{
    const m = measure(0, 2000);
    info("LFO 1 at 2 Hz: " + JSON.stringify(m));
    check("the LFO runs at 2 Hz", m && Math.abs(m.hz - 2) < 0.15, m && m.hz);
}

// 3. queued writes
{
    hook("dsp_restart"); sleep(200);
    const down = report();
    check("after dsp_restart the DSP is down (pill state)", down.dsp.ready === false, JSON.stringify(down.dsp));
    hook("test_setparam", 0, "rate", 3);
    evalLom(`messnamed("megamod-test", "test_setsettings", ${JSON.stringify(JSON.stringify({ rateMul: 2 }))}); return 1;`);
    const w = waitDsp(40000);
    check("the DSP is ready again after the restart", w >= 0, w + " ms");
    sleep(800);
    const m = measure(0, 4000);
    info("after the restart: LFO 1 rate 3 Hz x rate multiplier 2: " + JSON.stringify(m));
    check("the queued rate and the rate multiplier reached the new engine (6 Hz)", m && Math.abs(m.hz - 6) < 0.4, m && m.hz);
    const d = diag();
    check("dsp_diag after the restart: 8 routers, 771 cords", d && d.state === "ready" && d.routers.every((q, i) => q.present && q.echo === 32 * i + 1) && d.cords === 771, d && d.cords);
}

hook("test_remove", 0);
console.log(failed ? `FAILED (${failed})` : "ALL PASS");
process.exit(failed ? 1 : 0);
