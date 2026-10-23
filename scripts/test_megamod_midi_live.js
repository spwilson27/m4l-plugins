#!/usr/bin/env node
/**
 * Mega Modulator ADSR in MIDI mode, in REAL Ableton Live (VM only, AGENTS.md 1a).
 *
 *   scripts/vm_live_lock.sh megamod-midi -- zsh -c 'FORCE=1 scripts/vm_megamod_keys.sh live && scripts/vm_megamod_keys.sh run scripts/test_megamod_midi_live.js'
 *
 * The device is an Audio Effect, so MIDI reaches it through the LOM DeviceIO `this_device midi_inputs 0` ("MIDI From": `routing_type`). This script:
 *   1. checks the device exposes `midi_inputs 0` and lists its available routing types
 *   2. adds an ADSR (Trig = MIDI) in the device, creates a MIDI track with a looping clip of notes, routes the device's MIDI input to that track
 *   3. fires the clip: the ADSR must run (telemetry: stage, level, gate), a held note keeps it in sustain, stopping the clip releases it
 *   4. Trig = Threshold must ignore the notes (the same clip playing does not fire an ADSR in Threshold mode)
 * Everything goes through the bridge (LiveAPI + the `megamod-test` hooks). Exit status is non-zero when a check fails.
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
            if (String(d.get("name")) === "Mega Modulator") out.push({ id: String(d.id), path: tp + " devices " + i, trackName: String(tr.get("name")), track: t });
        }
    }
    return out;
`);
if (!found.length) { console.error("No Mega Modulator in the set. Run scripts/vm_megamod_keys.sh live first."); process.exit(1); }
const dev = found[0];
info(`device ${dev.id} at ${dev.path}`);
const hook = (...a) => evalLom(`messnamed("megamod-test", ${a.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
const midiReport = () => {
    hook("test_midi");
    sleep(250);
    const r = evalLom(`return new Global("megamod_test")["midi_${dev.id}"] || null;`);
    return r ? JSON.parse(r) : null;
};
const ioPath = dev.path + " midi_inputs 0";
const ioInfo = () => evalLom(`var a = new LiveAPI(${JSON.stringify(ioPath)}); return {types: String(a.get("available_routing_types")), type: String(a.get("routing_type")), chans: String(a.get("available_routing_channels")), chan: String(a.get("routing_channel"))};`);

// 1. the DeviceIO
const io0 = ioInfo();
info("midi_inputs 0 before: " + JSON.stringify(io0));
check("the audio effect has a midi_inputs DeviceIO", /available_routing_types/.test(io0.types));

// 2. an ADSR in MIDI mode (Trig = MIDI: the Trig switch is the model's `sync`, 0 = MIDI)
hook("test_add", 6);
sleep(300);
hook("test_setparam", 0, "sync", 0);
hook("test_setparam", 0, "attack", 10);
hook("test_setparam", 0, "decay", 50);
hook("test_setparam", 0, "sustain", 0.6);
hook("test_setparam", 0, "release", 150);
hook("test_add", 6); // a second ADSR (slot 1) stays in Threshold mode (the default): it must ignore the notes
sleep(300);
const r1 = midiReport();
check("the device sees the DeviceIO", !!(r1 && r1.info && r1.info.supported));

// a MIDI track with a looping clip: C3 for 2 beats, then E3 for 1 beat (a legato overlap with G3)
const mk = evalLom(`
    var set = new LiveAPI("live_set");
    set.call("create_midi_track", -1);
    var n = set.getcount("tracks");
    var ti = n - 1;
    var tr = new LiveAPI("live_set tracks " + ti);
    tr.set("name", "Midi Src");
    var slot = new LiveAPI("live_set tracks " + ti + " clip_slots 0");
    slot.call("create_clip", 4);
    var clip = new LiveAPI("live_set tracks " + ti + " clip_slots 0 clip");
    var notes = { notes: [
        { pitch: 60, start_time: 0, duration: 2, velocity: 100 },
        { pitch: 67, start_time: 1, duration: 0.5, velocity: 40 },
        { pitch: 64, start_time: 3, duration: 0.5, velocity: 127 } ] };
    var how = "dict";
    try { clip.call("add_new_notes", notes); } catch (e) { how = "json"; clip.call("add_new_notes", JSON.stringify(notes)); }
    return { ti: ti, how: how, notes: String(clip.call("get_notes_extended", 0, 128, 0, 8)).slice(0, 80) };
`);
info("MIDI track " + JSON.stringify(mk));
sleep(500);
const io1 = ioInfo();
info("midi_inputs 0 after creating the MIDI track: " + io1.types);
let types = [];
try { types = JSON.parse(io1.types).available_routing_types; } catch (e) { /* */ }
const src = types.find((t) => /Midi Src/.test(t.display_name));
check("the new MIDI track is listed as a MIDI source", !!src, src ? src.display_name : types.map((t) => t.display_name).join(" | "));
if (!src) { console.log("FAILED"); process.exit(1); }
evalLom(`var a = new LiveAPI(${JSON.stringify(ioPath)}); a.set("routing_type", ${JSON.stringify(src)}); return 1;`);
sleep(500);
const io2 = ioInfo();
info("routing_type now " + io2.type + "; channels " + io2.chans + "; channel " + io2.chan);
check("routing_type follows", /Midi Src/.test(io2.type));
const r2 = midiReport();
check("the device mirrors the routing (MM.midiInfo().name)", !!(r2 && /Midi Src/.test(r2.info.name)), r2 && r2.info.name);

// 3. play the clip
const tick = () => { const r = midiReport(); return r; };
evalLom(`new LiveAPI("live_set tracks ${mk.ti} clip_slots 0").call("fire"); return 1;`);
let sawGate = 0, maxU = 0, stages = {}, sawSustain = false, other = 0;
const t0 = Date.now();
while (Date.now() - t0 < 6000) {
    const r = tick();
    if (!r) continue;
    const a = r.mods[0], b = r.mods[1];
    if (r.state.count > 0) sawGate++;
    maxU = Math.max(maxU, (a.out + 1) / 2);
    stages[Math.round(a.aux) % 10] = 1;
    if (Math.round(a.aux) % 10 === 3 && Math.abs((a.out + 1) / 2 - 0.6) < 0.02) sawSustain = true;
    other = Math.max(other, (b.out + 1) / 2);
}
info(`gate seen ${sawGate} times, max u ${maxU.toFixed(3)}, stages ${Object.keys(stages).join(",")}, threshold-mode ADSR max u ${other.toFixed(3)}`);
check("MIDI notes from the routed track reach the device (held notes counted)", sawGate > 0);
check("the MIDI-mode ADSR fires on the notes (level above 0.8; decay, sustain and release stages seen: the 10 ms attack is shorter than the poll)", maxU > 0.8 && stages[2] && stages[3] && stages[4], `max u ${maxU.toFixed(3)}, stages ${Object.keys(stages).join(",")}`);
check("...and settles at the sustain level 0.6", sawSustain);
check("the Threshold-mode ADSR ignores the notes", other < 0.02, "max u " + other.toFixed(3));
evalLom(`new LiveAPI("live_set tracks ${mk.ti}").call("stop_all_clips"); return 1;`);
sleep(1500);
const r3 = midiReport();
check("stopping the clip releases every note (gate off, ADSR back at 0)", !!r3 && r3.state.count === 0 && (r3.mods[0].out + 1) / 2 < 0.02, r3 && JSON.stringify(r3.state));

// cleanup: route back to No Input and delete the helper track
evalLom(`
    var a = new LiveAPI(${JSON.stringify(ioPath)});
    var types = JSON.parse(String(a.get("available_routing_types"))).available_routing_types;
    for (var i = 0; i < types.length; i++) if (types[i].display_name === "No Input") a.set("routing_type", types[i]);
    new LiveAPI("live_set").call("delete_track", ${mk.ti});
    return 1;
`);
// the ADSRs added above (slots 0 and 1) are removed again so a later test starts clean
hook("test_remove", 0); sleep(300); hook("test_remove", 1); sleep(500);
console.log(failed ? "FAILED" : "megamod midi live checks passed");
process.exit(failed ? 1 : 0);
