#!/usr/bin/env node
/**
 * Live end-to-end test for Better Sampler, driven through the Ableton MCP Bridge
 * (`scripts/ableton_mcp_server.js`, `ableton_eval_lom_js`).
 *
 * Needs sampler_test.als (MIDI track "Better Sampler" + the bridge on Main). Live runs in the tart VM
 * (AGENTS.md 1a): `scripts/vm_sampler.sh live`, then `scripts/vm_sampler.sh test` (which makes the WAV and
 * tunnels the bridge port). Checks, in order:
 *   find     the Better Sampler device (class MxDeviceInstrument) on a track
 *   dsp      Global("better_sampler_trace") gets "dsp ready" within 20 s (fails with the trace on
 *            "dsp-error" or timeout); prints the load -> dsp-ready time from the trace's "+<ms>" stamps
 *   diag     dsp_diag via messnamed("#0-bsdebug", ...) (#0 is not substituted in a top-level device)
 *   counter  telemetry buffer slot 39 (the gen's frame counter) advances
 *   sample   dropfile <wav> (a 1.5 s 220 Hz sine made in the VM) loads
 *   audio    midi_note 60 110 -> the track's output_meter_left rises above 0.05; note off
 *   params   every GUI parameter change (face -> hidden live.* -> prepend -> hub -> gen~) is visible in the gen's
 *            own telemetry (#0-bsscope 40..47: sliced, loop_mode, slice_play, mode, freeze, reverse, root_note,
 *            loop_start), including the initial sync after load
 *   sliced   real MIDI (a clip with C1..G1 played by Live -> midiin -> midiparse -> face -> #0-bsvoices -> gen~):
 *            each key's voice playhead sits inside its own slice, whatever the engine pitch
 *   loop     Loop Off: a short sample ends and the output goes silent; Loop Fwd keeps sounding
 *
 * Needs --wav2 (a short 220 Hz WAV, default /tmp/bs_test_short.wav) for the Loop test.
 *
 *   node scripts/test_sampler_live.js [--port 19877] [--wav /tmp/bs_test_220.wav]
 */

const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = arg("--port", null);
const WAV = arg("--wav", "/tmp/bs_test_220.wav");
const WAV2 = arg("--wav2", "/tmp/bs_test_short.wav");
const DSP_WAIT_MS = 20000;

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8" }));
    if (out.error) throw new Error(out.error);
    return out.result;
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const trace = () => String(evalLom('return new Global("better_sampler_trace").text;') || "");
const debug = (...m) => evalLom(`messnamed("#0-bsdebug", ${m.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);

let failures = 0;
function check(ok, msg) {
    console.log((ok ? "PASS " : "FAIL ") + msg);
    if (!ok) failures++;
    return ok;
}
function finish() {
    console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
    process.exit(failures ? 1 : 0);
}
function bail(msg) {
    check(false, msg);
    console.log("--- trace ---\n" + trace());
    finish();
}

// find
const dev = evalLom(`
    var n = new LiveAPI("live_set").getcount("tracks");
    for (var t = 0; t < n; t++) {
        var tr = new LiveAPI("live_set tracks " + t);
        var nd = tr.getcount("devices");
        for (var d = 0; d < nd; d++) {
            var dv = new LiveAPI("live_set tracks " + t + " devices " + d);
            if (/Better Sampler/.test(String(dv.get("name")))) return { track: t, device: d, cls: String(dv.get("class_name")) };
        }
    }
    return null;
`);
if (!check(!!dev, "Better Sampler device found" + (dev ? ` (track ${dev.track}, ${dev.cls})` : ""))) finish();

// dsp ready
const t0 = Date.now();
let tr = "";
let state = "wait";
while (Date.now() - t0 < DSP_WAIT_MS) {
    tr = trace();
    if (/dsp-error/.test(tr)) { state = "error"; break; }
    if (/dsp ready/.test(tr)) { state = "ready"; break; }
    sleep(300);
}
if (state !== "ready") bail(state === "error" ? "dsp-error in the trace" : `no "dsp ready" within ${DSP_WAIT_MS / 1000} s`);
check(true, `dsp ready (waited ${Date.now() - t0} ms)`);
const stamp = (re) => { const m = tr.match(new RegExp("\\+(\\d+)ms " + re)); return m ? Number(m[1]) : null; };
const tStart = stamp("dsp-start"), tReady = stamp("dsp ready");
console.log(`load -> dsp-ready: ${tReady} ms after the script loaded` + (tStart !== null ? ` (gen~ creation started at +${tStart} ms, gen compile+run ${tReady - tStart} ms)` : ""));

// diag
debug("dsp_diag");
sleep(300);
const diag = (trace().split("\n").filter((l) => /dsp-diag/.test(l)).pop() || "");
console.log(diag);
const scope = (diag.match(/scope=(\S+)/) || [])[1];
check(!!scope && /gen=gen~/.test(diag), "dsp_diag: gen~ present, scope buffer " + scope);
check(/cordsIn=[1-9]/.test(diag) && /cordsOut=[1-9]/.test(diag), "dsp_diag: gen~ has input and output cords");

// counter
const counter = () => evalLom(`var v = new Buffer(${JSON.stringify(scope)}).peek(1, 39, 1); return typeof v === "number" ? v : v[0];`);
const c0 = counter(); sleep(600); const c1 = counter();
check(c1 > c0, `telemetry frame counter advances (${c0} -> ${c1})`);

// sample
debug("dropfile", WAV);
let loaded = false;
for (let i = 0; i < 20 && !loaded; i++) { sleep(250); loaded = /sample_loaded|loaded=true/.test(trace().split("dropfile").pop()); }
// A repeat run on a live session finds the same path already loaded (dropfile returns early)
const already = !loaded && /loaded=true/.test(trace());
check(loaded || already, `dropfile ${WAV} loaded` + (already ? " (already loaded by an earlier run)" : ""));

// audio
const meter = () => Number(evalLom(`return new LiveAPI("live_set tracks ${dev.track}").get("output_meter_left");`));
const idle = meter();
debug("midi_note", 60, 110);
let peak = 0;
for (let i = 0; i < 12; i++) { sleep(120); peak = Math.max(peak, meter()); }
debug("midi_note", 60, 0);
check(peak > 0.05, `output_meter_left rises while the note plays (idle ${idle.toFixed(3)}, peak ${peak.toFixed(3)})`);
if (peak <= 0.05) console.log("--- trace ---\n" + trace());

// ------------------------------------------------------------------------------------------------
// Parameters reach the gen
// ------------------------------------------------------------------------------------------------
const GEN_PARAM_SLOTS = ["sliced", "loop_mode", "slice_play", "mode", "freeze", "reverse", "root_note", "loop_start"];
const genParams = () => {
    const v = evalLom(`var a = new Buffer(${JSON.stringify(scope)}).peek(1, 40, 8); return Array.prototype.slice.call(a);`);
    const o = {};
    GEN_PARAM_SLOTS.forEach((k, i) => { o[k] = v[i]; });
    return o;
};
const waitGen = (key, want, ms = 2500) => {
    const t = Date.now();
    let got;
    while (Date.now() - t < ms) { got = genParams()[key]; if (Math.abs(got - want) < 1e-3) return { ok: true, got }; sleep(100); }
    return { ok: false, got };
};
const setParam = (key, v) => debug("dbg_param", key, v);

// Initial sync: the values the device's live.* objects hold must be the values the gen runs with
// Live names parameters by their short name (parameter_shortname in scripts/build_sampler.py)
const liveParam = (shortName) => evalLom(`
    var d = new LiveAPI("live_set tracks ${dev.track} devices ${dev.device}");
    var n = d.getcount("parameters");
    for (var i = 0; i < n; i++) {
        var p = new LiveAPI("live_set tracks ${dev.track} devices ${dev.device} parameters " + i);
        if (String(p.get("name")) === ${JSON.stringify(shortName)}) return Number(p.get("value"));
    }
    return null;
`);
const liveNames = { sliced: "Sliced", loop_mode: "Loop", slice_play: "SlcPlay", mode: "Mode", root_note: "Root" };
const gp0 = genParams();
for (const key of ["sliced", "loop_mode", "slice_play", "mode"]) {
    const lv = liveParam(liveNames[key]);
    check(lv !== null && Math.abs(lv - gp0[key]) < 1e-3, `initial sync: gen ${key} (${gp0[key]}) == the device's parameter ${liveNames[key]} (${lv})`);
}

// Each enum the GUI sets must land in the gen
const sequence = [["loop_mode", [0, 2, 1, 0]], ["sliced", [1, 0, 1]], ["slice_play", [1, 2, 3, 0]], ["mode", [2, 4, 3, 1, 0]], ["freeze", [1, 0]], ["reverse", [1, 0]]];
for (const [key, vals] of sequence) {
    for (const v of vals) {
        setParam(key, v);
        const r = waitGen(key, v);
        check(r.ok, `GUI ${key} = ${v} reaches the gen (gen reports ${r.got})`);
    }
}
setParam("mode", 0); setParam("sliced", 0); setParam("loop_mode", 1);
waitGen("loop_mode", 1);

// ------------------------------------------------------------------------------------------------
// Real MIDI: a clip plays C1.. through midiin -> midiparse -> face -> voices -> gen
// ------------------------------------------------------------------------------------------------
const recRead = () => String(evalLom('return new Global("better_sampler_rec").text;') || "");
const parseRec = (txt) => txt.split(";").filter(Boolean).map((r) => {
    const [t, voice, pos, amp, peak, active] = r.split(",").map(Number);
    return { t, voice, pos, amp, peak, active };
});
function playClip(notes, lengthBeats, tempo, recMs) {
    // notes: [{pitch, start_time, duration, velocity}]
    evalLom(`
        var ls = new LiveAPI("live_set");
        ls.set("tempo", ${tempo});
        ls.set("clip_trigger_quantization", 0);
        var slot = new LiveAPI("live_set tracks ${dev.track} clip_slots 0");
        if (Number(slot.get("has_clip"))) slot.call("delete_clip");
        slot.call("create_clip", ${lengthBeats});
        var clip = new LiveAPI("live_set tracks ${dev.track} clip_slots 0 clip");
        clip.set("looping", 0);
        clip.call("add_new_notes", ${JSON.stringify(JSON.stringify({ notes }))});
        return 1;
    `);
    // record first, then fire, so the first note is inside the recording
    debug("dbg_record", recMs);
    evalLom(`new LiveAPI("live_set tracks ${dev.track} clip_slots 0").call("fire"); return 1;`);
}
function stopClip() {
    evalLom(`
        new LiveAPI("live_set tracks ${dev.track}").call("stop_all_clips");
        new LiveAPI("live_set").call("stop_playing");
        return 1;`);
}

// Sliced: 8 equal slices from C1 (default markers), the loudest voice's playhead must follow the key
const SL_TEMPO = 120; // 0.5 s per beat
const SL_KEYS = [36, 37, 38, 39, 40, 41, 42, 43];
setParam("sliced", 1); setParam("slice_play", 2); setParam("mode", 0); setParam("loop_mode", 1);
waitGen("sliced", 1); waitGen("slice_play", 2);
debug("dbg_param", "slice_from", 36);
debug("dbg_state");
sleep(300);
console.log((trace().split("\n").filter((l) => /dbg-state/.test(l)).pop() || "").trim());
{
    const recMs = SL_KEYS.length * 500 + 1500;
    playClip(SL_KEYS.map((k, i) => ({ pitch: k, start_time: i, duration: 0.8, velocity: 100 })), SL_KEYS.length, SL_TEMPO, recMs);
    sleep(recMs + 600);
    const rows = parseRec(recRead());
    const first = rows.find((r) => r.voice >= 0 && r.amp > 0.05);
    check(!!first, `Sliced clip: sound starts (${rows.length} telemetry rows)`);
    if (first) {
        let okAll = true;
        const msgs = [];
        SL_KEYS.forEach((k, i) => {
            const lo = i * 0.125, hi = lo + 0.125;
            const win = rows.filter((r) => r.t >= first.t + i * 500 + 120 && r.t <= first.t + i * 500 + 330 && r.voice >= 0);
            const ps = win.map((r) => r.pos);
            const inside = ps.length > 0 && ps.every((p) => p >= lo - 0.004 && p <= hi + 0.004);
            msgs.push(`key ${k} slice ${i}: ${ps.length ? ps[0].toFixed(3) + ".." + ps[ps.length - 1].toFixed(3) : "silent"}`);
            if (!inside) okAll = false;
        });
        check(okAll, "Sliced real MIDI: every key's playhead stays in its own slice (" + msgs.join("; ") + ")");
    }
    stopClip();
    sleep(400);
}

// Loop Off: a short sample ends; Loop Fwd keeps sounding (real MIDI note at the sample's root)
debug("dropfile", WAV2);
for (let i = 0; i < 20; i++) { sleep(250); if (/loaded=true/.test(trace().split("dropfile").pop())) break; }
setParam("sliced", 0); setParam("freeze", 0); setParam("reverse", 0); setParam("mode", 0);
setParam("atk_ms", 2.5); setParam("rel_ms", 100);
const root = Math.round(genParams().root_note);
console.log(`short sample root note: ${root}`);
for (const [lm, name] of [[0, "Off"], [1, "Fwd"], [2, "Ping"]]) {
    setParam("loop_mode", lm);
    waitGen("loop_mode", lm);
    const recMs = 2600;
    playClip([{ pitch: root, start_time: 0, duration: 3.0, velocity: 100 }], 4, 120, recMs);
    sleep(recMs + 600);
    const rows = parseRec(recRead());
    const first = rows.find((r) => r.peak > 0.05);
    const late = rows.filter((r) => first && r.t >= first.t + 1500);
    const latePeak = late.length ? Math.max(...late.map((r) => r.peak)) : -1;
    if (lm === 0) check(!!first && late.length > 5 && latePeak < 0.01, `Loop ${name}: output is silent 1.5 s after the 0.5 s sample started (late peak ${latePeak.toFixed(3)}, ${late.length} rows)`);
    else check(!!first && late.length > 5 && latePeak > 0.05, `Loop ${name}: the sample keeps sounding past its end (late peak ${latePeak.toFixed(3)}, ${late.length} rows)`);
    stopClip();
    sleep(500);
}
setParam("loop_mode", 1);

finish();
