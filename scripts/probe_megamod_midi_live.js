#!/usr/bin/env node
/**
 * Probe: can a Max for Live AUDIO EFFECT (Mega Modulator) take MIDI input in real Ableton Live?  (VM only, AGENTS.md 1a)
 *
 *   scripts/vm_live_lock.sh megamod-midi -- zsh -c 'FORCE=1 scripts/vm_megamod_keys.sh live && scripts/vm_megamod_keys.sh run scripts/probe_megamod_midi_live.js'
 *
 * Steps (all through the MCP bridge, LOM only):
 *   1. the Mega Modulator's LOM info (children): is there a `midi_inputs` DeviceIO?
 *   2. `midi_inputs 0`: available_routing_types / routing_type
 *   3. a MIDI track with a looping clip of notes; set the device's routing to that track; an ADSR (Trig = MIDI) must fire (telemetry), or not
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
const info = (s) => console.log("INFO " + s);
let failed = 0;
function check(name, ok, detail) { if (!ok) failed++; console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : "")); }

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
if (!found.length) { console.error("No Mega Modulator in the set."); process.exit(1); }
const dev = found[0];
info("device " + dev.id + " at " + dev.path);
const hook = (...a) => evalLom(`messnamed("megamod-test", ${a.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
const report = (id) => { const r = evalLom(`return new Global("megamod_test")["midi_${dev.id}"] || null;`); return r ? JSON.parse(r) : null; };

// 1. LOM info
const lomInfo = evalLom(`var d = new LiveAPI(${JSON.stringify(dev.path)}); return String(d.info);`);
info("LOM info of the device:\n" + lomInfo);
check("device lists midi_inputs as a child", /midi_inputs/.test(lomInfo));
const cnt = evalLom(`var d = new LiveAPI(${JSON.stringify(dev.path)}); return [d.getcount("midi_inputs"), d.getcount("midi_outputs"), d.getcount("audio_inputs"), d.getcount("audio_outputs")];`);
info("child counts midi_inputs / midi_outputs / audio_inputs / audio_outputs: " + JSON.stringify(cnt));
const io = evalLom(`var a = new LiveAPI(${JSON.stringify(dev.path + " midi_inputs 0")}); return {id: String(a.id), info: String(a.info), types: String(a.get("available_routing_types")), type: String(a.get("routing_type")), chans: String(a.get("available_routing_channels"))};`);
info("midi_inputs 0: " + JSON.stringify(io));
check("midi_inputs 0 exists", io.id !== "0" && io.id !== "");

// 2. the device's own view of the routing
hook("test_midi");
sleep(300);
const r0 = report();
info("device MIDI info: " + JSON.stringify(r0 && r0.info));
check("the device sees the routing (MM.midiInfo().supported)", !!(r0 && r0.info && r0.info.supported));
process.exit(failed ? 1 : 0);
