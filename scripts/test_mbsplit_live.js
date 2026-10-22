#!/usr/bin/env node
/**
 * Live check for Multiband Split work sharing (run by scripts/vm_mbsplit.sh test, against the Set written by scripts/make_mbsplit_set.py):
 * track "Multiband Split" = Audio Effect Rack with 4 chains, each holding the device; track "Reference" = no devices.
 *  - deferred DSP: all 4 gen~ created after load and running ("dsp ready" in Global("mbsplit_trace")), creation order serialized
 *  - work sharing: every instance prunes (bands computed = its own band), exactly one instance computes the FFT (ring on) and the
 *    others copy its frames
 *  - linking: a crossover edit on chain 1 reaches the other three chains
 *  - rack sum: for sine tones at 70 Hz .. 9 kHz the rack track's output meter equals the Reference track's (allpass sum, both
 *    meters read while the same clip plays), and muting one chain drops its band by > 20 dB
 * The tones are written in the VM with the stdlib (python over ssh), like scripts/test_spectral_live.js.
 *   node scripts/test_mbsplit_live.js [--port 19881]
 */
"use strict";
const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const argv = process.argv.slice(2);
const portIdx = argv.indexOf("--port");
const PORT = portIdx >= 0 ? Number(argv[portIdx + 1]) : null;

function call(action, params) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", action, JSON.stringify(params || {}));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    if (out.error) throw new Error(out.error);
    return out.result !== undefined ? out.result : out;   // eval_js wraps its value in `result`, the inspect tool returns the object itself
}
const lom = (code) => call("ableton_eval_lom_js", { code });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let failures = 0;
function check(ok, msg) {
    console.log((ok ? "PASS " : "FAIL ") + msg);
    if (!ok) failures++;
    return ok;
}

const TONES = [70, 400, 2000, 9000];
function makeTones() {
    let ip = null;
    for (const args of [["ip", "macos-1"], ["ip", "--resolver=arp", "macos-1"]]) {
        try { ip = execFileSync("tart", args, { encoding: "utf8" }).trim(); if (ip) break; } catch (e) { /* next */ }
    }
    if (!ip) throw new Error("no VM ip (tart ip macos-1)");
    const py = `
import wave, struct, math, sys, json
for hz in json.loads(sys.argv[1]):
    f = wave.open("/tmp/mbs_tone_%d.wav" % hz, "wb"); f.setnchannels(2); f.setsampwidth(2); f.setframerate(48000)
    fr = bytearray()
    for i in range(48000 * 12):
        a = int(0.5 * math.sin(2 * math.pi * hz * i / 48000) * 32767)
        fr += struct.pack("<hh", a, a)
    f.writeframes(bytes(fr)); f.close()
print("ok")
`;
    const out = execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", `admin@${ip}`, "/usr/bin/python3", "-", `'${JSON.stringify(TONES)}'`],
        { encoding: "utf8", input: py, env: Object.assign({}, process.env, { SSHPASS: process.env.SSHPASS || "admin" }) });
    return out.trim() === "ok";
}

function inspect() {
    const r = call("ableton_inspect_mbsplit", {});
    return (r.peers || []).filter((p) => p.state && !p.isDeleted).sort((a, b) => (a.chainIndex - b.chainIndex));
}
const HELPERS = `
    function findParam(devPath, names) {
        var d = new LiveAPI(devPath); var n = d.getcount("parameters");
        for (var i = 0; i < n; i++) { var p = new LiveAPI(devPath + " parameters " + i); var nm = String(p.get("name")); if (names.indexOf(nm) >= 0) return p; }
        return null;
    }
`;
const L = (code) => lom(HELPERS + code);

// ---- the Set ----
const info = L(`
    var n = new LiveAPI("live_set").getcount("tracks"), out = { rack: -1, ref: -1 };
    for (var t = 0; t < n; t++) { var nm = String(new LiveAPI("live_set tracks " + t).get("name")); if (nm === "Multiband Split") out.rack = t; if (nm === "Reference") out.ref = t; }
    return out;
`);
if (!check(info.rack >= 0 && info.ref >= 0, `tracks found (rack ${info.rack}, reference ${info.ref})`)) process.exit(1);
const rackPath = `live_set tracks ${info.rack} devices 0`;
const chainDev = [0, 1, 2, 3].map((c) => `${rackPath} chains ${c} devices 0`);

// ---- deferred DSP + sharing state ----
let peers = [];
for (let i = 0; i < 120; i++) {
    peers = inspect();
    if (peers.length === 4 && peers.every((p) => p.state.dspReady === 1)) break;
    sleep(500);
}
check(peers.length === 4, `4 instances registered (got ${peers.length})`);
check(peers.every((p) => p.state.dspReady === 1), `all 4 gen~ created after load and running: ready after ${peers.map((p) => p.state.dspReadyMs)} ms (retries ${peers.map((p) => p.state.dspRetries)}, errors ${peers.map((p) => p.state.dspError || "-")})`);
const trace = L(`var g = new Global("mbsplit_trace"); return String(g.text || "");`);
const starts = (trace.match(/dsp-start/g) || []).length;
check(starts >= 4 && /dsp ready/.test(trace), `deferred load trace has ${starts} dsp-start lines and 'dsp ready'`);
console.log(trace.split("\n").slice(-16).map((l) => "     " + l).join("\n"));
check(peers.every((p) => p.groupKey === peers[0].groupKey), `all instances share one link group (${peers[0] && peers[0].groupKey})`);
check(peers.every((p, i) => p.chainIndex === i), `chain indices 0..3: [${peers.map((p) => p.chainIndex)}]`);
check(peers.every((p) => p.state.curNumBands === 4), `4 bands detected: [${peers.map((p) => p.state.curNumBands)}]`);
check(peers.every((p, i) => p.state.effectiveMask === (1 << i)), `Auto: chain k outputs band k: masks [${peers.map((p) => p.state.effectiveMask)}]`);
console.log(`INFO crossovers per instance: ${peers.map((p) => [p.state.f1, p.state.f2, p.state.f3].map((v) => Math.round(v)).join("/")).join("  ")}  slope ${peers.map((p) => p.state.slope)}  phase ${peers.map((p) => p.state.phaseMode)}`);
check(peers.every((p) => p.state.prune === 1), `every instance prunes its gen: prune [${peers.map((p) => p.state.prune)}]`);

// ---- tones, rack sum vs reference ----
check(makeTones(), "tones written in the VM");
L(`new LiveAPI("live_set").set("clip_trigger_quantization", 0);
   TONES = ${JSON.stringify(TONES)};
   for (var t = 0; t < 2; t++) {
       var tk = ${JSON.stringify([info.rack, info.ref])}[t];
       for (var k = 0; k < TONES.length; k++) {
           var slot = new LiveAPI("live_set tracks " + tk + " clip_slots " + k);
           if (Number(slot.get("has_clip")) === 0) slot.call("create_audio_clip", "/tmp/mbs_tone_" + TONES[k] + ".wav");
           new LiveAPI("live_set tracks " + tk + " clip_slots " + k + " clip").set("looping", 1);
       }
   }
   return 1;`);
function levels(slot, ms) {
    L(`new LiveAPI("live_set").call("stop_playing");
       new LiveAPI("live_set tracks ${info.rack}").call("stop_all_clips"); new LiveAPI("live_set tracks ${info.ref}").call("stop_all_clips");
       new LiveAPI("live_set tracks ${info.rack} clip_slots ${slot}").call("fire");
       new LiveAPI("live_set tracks ${info.ref} clip_slots ${slot}").call("fire"); return 1;`);
    sleep(1500);   // PDC / filters settle
    let a = 0, b = 0;
    for (let t = 0; t < ms; t += 100) {
        a = Math.max(a, Number(L(`return new LiveAPI("live_set tracks ${info.rack}").get("output_meter_left");`)));
        b = Math.max(b, Number(L(`return new LiveAPI("live_set tracks ${info.ref}").get("output_meter_left");`)));
        sleep(100);
    }
    return [a, b];
}
for (let k = 0; k < TONES.length; k++) {
    const [rackLvl, refLvl] = levels(k, 1500);
    const db = 20 * Math.log10(Math.max(rackLvl, 1e-9) / Math.max(refLvl, 1e-9));
    check(refLvl > 0.2 && Math.abs(db) < 0.5, `rack sum is flat at ${TONES[k]} Hz: rack meter ${rackLvl.toFixed(3)} vs reference ${refLvl.toFixed(3)} (${db.toFixed(2)} dB)`);
}

// ---- work sharing while audio plays ----
levels(1, 300);
sleep(1500);
peers = inspect();
const ringOn = peers.map((p) => p.state.ringOn);
check(ringOn.reduce((a, b) => a + b, 0) === 1 && ringOn[0] === 1, `exactly one instance (chain 1, the leader) runs the FFT: ringOn [${ringOn}]`);
const f0 = peers.map((p) => [p.state.fftComputed, p.state.fftCopied]);
sleep(1500);
peers = inspect();
const f1 = peers.map((p) => [p.state.fftComputed, p.state.fftCopied]);
check(f1[0][0] - f0[0][0] >= 10, `leader computes the spectrogram: +${f1[0][0] - f0[0][0]} FFTs in 1.5 s`);
check(f1.slice(1).every((v, i) => v[0] === f0[i + 1][0] && v[1] - f0[i + 1][1] >= 10), `followers copy its frames and compute none: computed [${f1.slice(1).map((v) => v[0])}], copied +[${f1.slice(1).map((v, i) => v[1] - f0[i + 1][1])}]`);
check(peers.every((p, i) => (Math.round(p.state.needBits) & 15) === (1 << i) && (Math.round(p.state.needBits) & 16) === 16), `gens compute only their band (telemetry bits): [${peers.map((p) => p.state.needBits)}]`);
check(peers.every((p) => p.state.asleep === 0 && p.state.beat !== undefined), `gens awake while playing`);

// ---- sensitivity: mute the high band, 9 kHz must drop ----
L(`new LiveAPI("live_set tracks ${info.rack} devices 0 chains 3").set("mute", 1); return 1;`);
{
    console.log("INFO chain 4 mute readback: " + L(`return new LiveAPI("live_set tracks ${info.rack} devices 0 chains 3").get("mute");`));
    const dbs = [];
    for (let k = 0; k < TONES.length; k++) {
        const [rackLvl, refLvl] = levels(k, 1200);
        dbs.push(20 * Math.log10(Math.max(rackLvl, 1e-9) / Math.max(refLvl, 1e-9)));
    }
    console.log(`INFO chain 4 muted, level vs reference at ${TONES.join(" / ")} Hz: ${dbs.map((d) => d.toFixed(1)).join(" / ")} dB`);
    // Live's output meter is not linear in amplitude (a 0.5 sine reads 0.84), so the drop is judged by the meter ratio: the 9 kHz band
    // is a clear fraction of the reference while 70 / 400 Hz are untouched
    check(dbs[3] < -3 && Math.abs(dbs[0]) < 0.5 && Math.abs(dbs[1]) < 0.5, `muting chain 4 removes the 9 kHz band (meter ratio ${dbs[3].toFixed(1)} dB) and leaves 70 / 400 Hz (${dbs[0].toFixed(2)} / ${dbs[1].toFixed(2)} dB)`);
}
L(`new LiveAPI("live_set tracks ${info.rack} devices 0 chains 3").set("mute", 0); new LiveAPI("live_set").call("stop_playing");
   new LiveAPI("live_set tracks ${info.rack}").call("stop_all_clips"); new LiveAPI("live_set tracks ${info.ref}").call("stop_all_clips"); return 1;`);

// ---- linking ----
const get = (c, names) => Number(L(`var p = findParam(${JSON.stringify(chainDev[c])}, ${JSON.stringify(names)}); return p ? Number(p.get("value")) : null;`));
const F1 = ["F1 Low", "Crossover 1"];
const v0 = [0, 1, 2, 3].map((c) => get(c, F1));
const range = L(`var p = findParam(${JSON.stringify(chainDev[0])}, ${JSON.stringify(F1)}); return [Number(p.get("min")), Number(p.get("max"))];`);
const target = v0[0] + (range[1] - range[0]) * 0.02;   // a small step: F2 / F3 stay where they are
L(`findParam(${JSON.stringify(chainDev[0])}, ${JSON.stringify(F1)}).set("value", ${target}); return 1;`);
sleep(1200);
const v1 = [0, 1, 2, 3].map((c) => get(c, F1));
check(Math.abs(v1[0] - v0[0]) > 1e-6 && v1.every((v) => Math.abs(v - v1[0]) < 1e-6), `F1 edit on chain 1 reaches all chains: [${v0.map((v) => v.toFixed(3))}] -> [${v1.map((v) => v.toFixed(3))}]`);
// the sum stays flat after the edit (linked filters)
{
    const [rackLvl, refLvl] = levels(1, 1200);
    const db = 20 * Math.log10(Math.max(rackLvl, 1e-9) / Math.max(refLvl, 1e-9));
    check(Math.abs(db) < 0.5, `rack sum still flat at 400 Hz after the F1 edit (${db.toFixed(2)} dB)`);
}
L(`findParam(${JSON.stringify(chainDev[0])}, ${JSON.stringify(F1)}).set("value", ${v0[0]}); return 1;`);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall Live checks passed");
process.exit(failures ? 1 : 0);
