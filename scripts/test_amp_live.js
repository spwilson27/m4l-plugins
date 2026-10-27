#!/usr/bin/env node
/**
 * Live end-to-end test for the Neural Amp (scripts/build_amp.py), driven through
 * the Ableton MCP Bridge (`ableton_eval_lom_js`). Live runs only in the tart VM (AGENTS.md 1a):
 * `scripts/vm_amp.sh livetest` opens the bridge set in the VM's Live and loads the device on its own
 * audio track; this script runs on the host through an ssh tunnel (`--port`).
 *
 * Uses the engine's test hook (`receive #0-amptest`; `#0` is literal in a top-level device):
 * `test_tone <face|all> <amp>` replaces the input with a plucked 110 Hz tone, `test_report <face|all>`
 * writes Global("amp_test").report_<face>, `test_load <face> <path>` loads a .nam like the file dialog.
 *
 * Checks, per device: the deferred gen~ runs, the built-in model is loaded, the tone comes out (engine
 * telemetry and the track's output meter). On the first device: Model Crunch -> Lead through the LOM
 * (same architecture: weight bank switch, no hot-load), a Standard WaveNet file (new architecture:
 * hot-load), an LSTM file, a broken file (error, previous model keeps playing), tone / cab / dry-wet
 * changes and the Mono / Stereo output mode through the LOM.
 *
 *   node scripts/test_amp_live.js --port <tunnelled port> --vmdir /Users/admin/ableton-amp
 */
"use strict";
const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = arg("--port", null);
const VMDIR = arg("--vmdir", "/Users/admin/ableton-amp");
let fails = 0;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) fails++; };
const sleep = (ms) => execFileSync("sleep", [String(ms / 1000)]);

function evalLom(code, tries = 1) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    for (let t = 1; ; t++) {
        try {
            const out = JSON.parse(execFileSync("node", args, { encoding: "utf8" }));
            if (out.error) throw new Error(out.error);
            return out.result;
        } catch (e) {
            // Right after the set opens Live can be busy (devices loading, gen compiles): retry the first calls.
            if (t >= tries) throw e;
            sleep(2000);
        }
    }
}

function hook(...a) {
    evalLom(`messnamed("#0-amptest", ${a.map((v) => JSON.stringify(v)).join(", ")}); return 1;`);
}

function report(face) {
    hook("test_report", face);
    sleep(150);
    const s = evalLom(`return new Global("amp_test")["report_${face}"] || "";`);
    return s ? JSON.parse(s) : null;
}

function trace() { return String(evalLom(`return String(new Global("amp_trace").text || "");`)); }

const devices = evalLom(`
    var found = [], set = new LiveAPI("live_set");
    for (var t = 0; t < set.getcount("tracks"); t++) {
        var tp = "live_set tracks " + t, tr = new LiveAPI(tp);
        for (var i = 0; i < tr.getcount("devices"); i++) {
            var d = new LiveAPI(tp + " devices " + i), n = String(d.get("name"));
            if (n.indexOf("Neural Amp") === 0) found.push({ name: n, path: tp + " devices " + i, track: tp, id: String(d.id) });
        }
    }
    return found;
`, 10);
check(devices.length > 0, `found ${devices.length} Neural Amp device(s): ${devices.map((d) => d.name).join(", ")}`);
if (!devices.length) process.exit(1);
const faceOf = () => "neural";

function setParam(dev, pname, value) {
    // Retried: idempotent, and Live can be busy for a moment after a model switch.
    return evalLom(`
        var d = new LiveAPI("${dev.path}"), n = d.getcount("parameters");
        for (var i = 0; i < n; i++) {
            var p = new LiveAPI("${dev.path} parameters " + i);
            if (String(p.get("name")) === ${JSON.stringify(pname)}) { p.set("value", ${value}); return Number(p.get("value")); }
        }
        return null;`, 3);
}

function meter(dev) {
    return evalLom(`var t = new LiveAPI("${dev.track}"); return Math.max(Number(t.get("output_meter_left")), Number(t.get("output_meter_right")));`);
}
function meterLR(dev) {
    return evalLom(`var t = new LiveAPI("${dev.track}"); return [Number(t.get("output_meter_left")), Number(t.get("output_meter_right"))];`);
}

function waitReady(face, ms) {
    const t0 = Date.now();
    let r = null;
    while (Date.now() - t0 < ms) {
        r = report(face);
        if (r && r.dsp && r.dsp.ready && r.tel && r.tel.model_ok > 0) return r;
        sleep(500);
    }
    return r;
}

function maxOut(face, ms) {
    let best = 0, r = null;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        r = report(face);
        if (r && r.tel) best = Math.max(best, r.tel.out_rms);
        sleep(250);
    }
    return { rms: best, r };
}

// Start the transport so the track meters run; every device gets the test tone.
evalLom(`new LiveAPI("live_set").call("start_playing"); return 1;`);
hook("test_tone", "all", 0.4);
for (const dev of devices) {
    const face = faceOf(dev.name);
    const r = waitReady(face, 25000);
    check(!!(r && r.dsp.ready), `${dev.name}: DSP running (${r ? JSON.stringify(r.dsp) : "no report"})`);
    check(!!(r && r.model && r.model.name === "Crunch" && /Feather/.test(r.model.label)), `${dev.name}: built-in model loaded (${r && r.model.name} ${r && r.model.label})`);
    const o = maxOut(face, 2000);
    check(o.rms > 0.005, `${dev.name}: tone through the model, telemetry out rms ${o.rms.toFixed(4)}`);
    let m = 0;
    for (let i = 0; i < 8; i++) { m = Math.max(m, meter(dev)); sleep(150); }
    check(m > 0.05, `${dev.name}: track output meter ${m.toFixed(3)}`);
}

const dev = devices[0], face = faceOf(dev.name);
let r0 = report(face);
const arch0 = r0.genArch;
// Model through the LOM: same architecture -> bank switch, no hot-load.
const tr0 = trace().length;
setParam(dev, "Model", 5);
sleep(1500);
let r = report(face);
check(r.model.name === "Lead" && r.genArch === arch0, `Model -> Lead through the LOM: ${r.model.name}, arch unchanged`);
check(!/hot-load/.test(trace().slice(tr0)), "same architecture: no gen hot-load");
check(maxOut(face, 1500).rms > 0.005, "Lead plays");
// Every built-in capture loads and plays (all Feather: bank switches, no hot-load).
const NAMES = ["Clean", "Chime", "Bass", "Drive", "Crunch", "Lead", "Metal", "Fuzz"];
for (let i = 0; i < NAMES.length; i++) {
    setParam(dev, "Model", i);
    sleep(900);
    const ri = report(face), oi = maxOut(face, 900);
    check(ri.model.name === NAMES[i] && oi.rms > 0.002, `built-in ${NAMES[i]}: loaded and plays (out rms ${oi.rms.toFixed(4)})`);
}
check(!/hot-load/.test(trace().slice(tr0)), "eight built-ins: no gen hot-load");
// A Standard WaveNet file: new architecture -> hot-load.
hook("test_load", face, `${VMDIR}/tests/amp_ref/standard.nam`);
sleep(5000);
r = report(face);
check(/Standard/.test(r.model.label) && r.genArch !== arch0 && r.p.model === 8, `Standard file loaded: ${r.model.label}, Model = ${r.p.model}`);
check(/hot-load/.test(trace().slice(tr0)), "new architecture hot-loaded");
let o = maxOut(face, 4000);
check(o.rms > 0.0005 && o.r.tel.model_ok > 0, `Standard plays (out rms ${o.rms.toFixed(4)})`);
// An LSTM file.
hook("test_load", face, `${VMDIR}/tests/amp_ref/lstm.nam`);
sleep(4000);
r = report(face);
check(r.model.kind === "LSTM", `LSTM file loaded: ${r.model.label}`);
o = maxOut(face, 3000);
check(o.rms > 0.0005, `LSTM plays (out rms ${o.rms.toFixed(4)})`);
// A broken file: error, the LSTM keeps playing.
hook("test_load", face, `${VMDIR}/tests/amp_ref/lstm_io.json`);
sleep(1000);
r = report(face);
check(!!r.model.error && r.model.kind === "LSTM", `broken file rejected: "${r.model.error}"`);
check(maxOut(face, 1500).rms > 0.0005, "previous model keeps playing");
// Back to a built-in, tone controls, cab, dry/wet.
setParam(dev, "Model", 0);
sleep(4000);
for (const [n, v] of [["Bass", 9], ["Treble", 1], ["Cabinet", 0], ["Gate", -60], ["Dry/Wet", 50], ["Volume", -6], ["Gain", 6], ["Normalize", 0], ["EQ Pos", 1]]) setParam(dev, n, v);
sleep(800);
r = report(face);
check(r.model.name === "Clean" && r.p.bass === 9 && r.p.cab === 0 && r.p.mix === 50 && r.p.volume === -6 && r.p.gain === 6 && r.p.normalize === 0 && r.p.eqpos === 1, `Clean + tone/cab/dry-wet/volume/gain/normalize/Pre-EQ through the LOM (bass ${r.p.bass}, cab ${r.p.cab}, mix ${r.p.mix}, volume ${r.p.volume}, gain ${r.p.gain})`);
o = maxOut(face, 2000);
check(o.rms > 0.002 && isFinite(o.rms), `still playing after the changes (out rms ${o.rms.toFixed(4)})`);
// Output mode: Stereo runs a model per channel. The test tone feeds both channels, so L and R both play.
setParam(dev, "Output", 1);
sleep(1500);
r = report(face);
check(r.p.stereo === 1, `Output -> Stereo through the LOM (stereo ${r.p.stereo})`);
o = maxOut(face, 2000);
let lr = [0, 0];
for (let i = 0; i < 8; i++) { const v = meterLR(dev); lr = [Math.max(lr[0], v[0]), Math.max(lr[1], v[1])]; sleep(150); }
check(o.rms > 0.002 && lr[0] > 0.05 && lr[1] > 0.05, `Stereo plays on both channels (out rms ${o.rms.toFixed(4)}, meters L ${lr[0].toFixed(3)} R ${lr[1].toFixed(3)})`);
hook("test_load", face, `${VMDIR}/tests/amp_ref/lstm.nam`);
sleep(4000);
o = maxOut(face, 2000);
check(o.rms > 0.0005 && o.r.model.kind === "LSTM", `Stereo with an LSTM file (out rms ${o.rms.toFixed(4)})`);
setParam(dev, "Model", 0);
sleep(1500);
setParam(dev, "Output", 0);
sleep(1500);
check(maxOut(face, 1500).rms > 0.002 && report(face).p.stereo === 0, "back to Mono, still playing");
for (const [n, v] of [["Bass", 5], ["Treble", 5], ["Cabinet", 2], ["Gate", -100], ["Dry/Wet", 100], ["Volume", 0], ["Gain", 0], ["Normalize", 1], ["EQ Pos", 0], ["Model", 4]]) setParam(dev, n, v);
// --shots <dir>: a host screenshot of the VM (scripts/vm_shot.sh) with each device's track selected, tone playing.
const SHOTS = arg("--shots", "");
if (SHOTS) {
    hook("test_tone", "all", 0.4);
    sleep(2000);
    for (const d of devices) {
        evalLom(`var t = new LiveAPI("${d.track}"); new LiveAPI("live_set view").set("selected_track", "id", Number(t.id)); return 1;`);
        sleep(1500);
        const out = path.join(SHOTS, faceOf(d.name) + ".png");
        try { execFileSync(path.join(__dirname, "vm_shot.sh"), [out]); console.log("SHOT " + out); } catch (e) { console.log("SHOT failed " + out); }
    }
}
hook("test_tone", "all", 0);
evalLom(`new LiveAPI("live_set").call("stop_playing"); return 1;`);
console.log(fails ? `test_amp_live: ${fails} FAILED` : "test_amp_live: all passed");
process.exit(fails ? 1 : 0);
