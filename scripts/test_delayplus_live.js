#!/usr/bin/env node
/**
 * Live end-to-end test for Delay+, driven through the Ableton MCP Bridge
 * (`scripts/ableton_mcp_server.js`, `ableton_eval_lom_js`).
 *
 * Needs a Live set with the MCP Bridge and at least one Delay+ pair, e.g. delayplus_test.als
 * (tracks "Delay+ A/B/C": rack [Delay+ X, Limiter 6 ms, Delay+ End]); start it in its own Live
 * instance with scripts/relaunch_delayplus_live.sh. Every Start registers its buffers in
 * Global("delayplus_bus").reg, which is how the test finds the pairs and reads their shared header.
 *
 * Per pair:
 *   link      Start and End see each other's counters (hdr 14/15), the return read lag B (hdr 3) is
 *             1..2048
 *   latency   L (hdr 4) == sum of latency_in_samples of the devices between Start and End
 *   ping      Debug on -> the ping-measured latency (hdr 10) == L, for each Limiter lookahead
 *             (1.5 / 3 / 6 ms) when a Limiter sits in the chain, so a latency change is followed
 *             and the returning ping is written back exactly at its emit position (hdr 17 == 0)
 *   music     a Core Library loop (clip created through the LOM) plays through the chain with Debug
 *             off -> End calibrates K from the audio (hdr 18); the pings afterwards confirm that K
 *   restore   Debug and the Limiter lookahead are put back as found
 *
 *   node scripts/test_delayplus_live.js [--port 9879]
 */

const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const portIdx = process.argv.indexOf("--port");
const PORT = portIdx > 0 ? Number(process.argv[portIdx + 1]) : null;

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8" }));
    if (out.error) throw new Error(out.error);
    return out.result;
}

function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const HELPERS = `
    function devPath(id) { var a = new LiveAPI("id " + id); return String(a.unquotedpath); }
    function param(devId, name) {
        var d = new LiveAPI("id " + devId);
        var n = d.getcount("parameters");
        for (var i = 0; i < n; i++) {
            var p = new LiveAPI("id " + devId);
            p.goto(String(d.unquotedpath) + " parameters " + i);
            if (String(p.get("name")) === name) return p;
        }
        return null;
    }
`;

const pairs = evalLom(`
    var g = new Global("delayplus_bus");
    var reg = g.reg || {};
    var now = Date.now();
    var out = [];
    for (var id in reg) {
        var e = reg[id];
        if (e.role !== "start" || now - e.t > 3000) continue;
        var dev = new LiveAPI("id " + id);
        var p = String(dev.unquotedpath);
        var m = p.match(/^(.*) devices (\\d+)$/);
        if (!m) continue;
        var chain = new LiveAPI(m[1]);
        var n = chain.getcount("devices");
        var devs = [];
        for (var i = 0; i < n; i++) {
            var d = new LiveAPI(m[1] + " devices " + i);
            var did = Number(d.id);
            devs.push({ id: did, name: String(d.get("name")), cls: String(d.get("class_name")),
                        lat: Number(d.get("latency_in_samples")), role: reg[did] ? reg[did].role : null });
        }
        out.push({ id: Number(id), path: p, index: Number(m[2]), hdr: e.hdr, devs: devs });
    }
    return out;
`);

if (!pairs.length) {
    console.error("No live Delay+ (Start) instance found. Load delayplus_test.als (scripts/relaunch_delayplus_live.sh).");
    process.exit(1);
}

const LOOPS = [
    process.env.DELAYPLUS_LOOP || "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/Loops/Drums/Full/Hip Hop Doubled 145 bpm.wav",
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/Loops/Tonal/Keys/Dirty Herbie Chords 73 bpm.wav",
];

let failures = 0;
function check(ok, msg) {
    console.log((ok ? "PASS " : "FAIL ") + msg);
    if (!ok) failures++;
}

function readHdr(name) {
    return evalLom(`var b = new Buffer(${JSON.stringify(name)}); return b.peek(1, 0, 24);`);
}

for (const pair of pairs) {
    const tag = `[${pair.path}]`;
    const endIdx = pair.devs.findIndex((d, i) => i > pair.index && d.role === "end");
    check(endIdx > 0, `${tag} has a Delay+ End after it in the chain`);
    if (endIdx < 0) continue;
    const between = pair.devs.slice(pair.index + 1, endIdx);
    const lomL = between.reduce((s, d) => s + Math.max(0, d.lat), 0);
    console.log(`${tag} chain: ${between.map((d) => `${d.name}(${d.lat})`).join(", ") || "(empty)"}`);

    sleep(1200); // two link polls
    let h = readHdr(pair.hdr);
    check(h[14] === 1 && h[15] === 1, `${tag} link: Start sees End (${h[14]}), End sees Start (${h[15]})`);
    check(h[3] >= 1 && h[3] <= 2048, `${tag} K = ${h[2]}, B = ${h[3]}`);
    check(h[4] === lomL, `${tag} L in use ${h[4]} == LOM sum ${lomL}`);
    console.log(`${tag} diag: Start sees [${h[20]}, ${h[21]}], End sees [${h[22]}, ${h[23]}]`);

    // Music calibration: play a loop through the chain (Debug off) -> End calibrates K from the audio.
    const trackPath = pair.path.split(" devices ")[0];
    const loop = LOOPS[pairs.indexOf(pair) % LOOPS.length];
    const clipOk = evalLom(`
        var slot = new LiveAPI("${trackPath} clip_slots 0");
        if (Number(slot.get("has_clip")) === 0) {
            try { slot.call("create_audio_clip", ${JSON.stringify(loop)}); } catch (e) { return "no create_audio_clip: " + e; }
        }
        if (Number(slot.get("has_clip")) === 0) return "clip not created";
        var clip = new LiveAPI("${trackPath} clip_slots 0 clip");
        clip.set("looping", 1);
        slot.call("fire");
        return "ok";
    `);
    check(clipOk === "ok", `${tag} loop clip playing (${clipOk})`);
    if (clipOk === "ok") {
        sleep(4000);
        h = readHdr(pair.hdr);
        // Tonal material gives an ambiguous correlation peak, which End rejects by design (it keeps
        // the counter estimate, which the pings below then verify). Drums must calibrate.
        if (loop === LOOPS[0]) check(h[18] === 1, `${tag} K calibrated from the drum loop (K ${h[2]}, calibrated ${h[18]})`);
        else console.log(`INFO ${tag} tonal loop: calibrated ${h[18]}, K ${h[2]} (ambiguous peaks are rejected by design)`);
    }

    const limiter = between.find((d) => d.cls === "Limiter");
    const debugBefore = evalLom(HELPERS + `var p = param(${pair.id}, "Debug"); return p ? Number(p.get("value")) : -1;`);
    check(debugBefore >= 0, `${tag} has a Debug parameter`);
    evalLom(HELPERS + `param(${pair.id}, "Debug").set("value", 1); return 1;`);
    const looks = limiter ? [2, 0, 1] : [null];
    let lookBefore = null;
    if (limiter) lookBefore = evalLom(HELPERS + `return Number(param(${limiter.id}, "Lookahead").get("value"));`);
    for (const look of looks) {
        if (look !== null) evalLom(HELPERS + `param(${limiter.id}, "Lookahead").set("value", ${look}); return 1;`);
        sleep(2500); // link poll (500 ms) + loop re-settle + several 0.5 s pings
        const lat = limiter
            ? evalLom(`return Number(new LiveAPI("id ${limiter.id}").get("latency_in_samples"));`)
            : 0;
        const expectL = lomL - (limiter ? limiter.lat : 0) + lat;
        h = readHdr(pair.hdr);
        const lbl = look === null ? "" : ` lookahead ${look} (${lat} smp)`;
        check(h[4] === expectL, `${tag}${lbl}: L in use ${h[4]} == LOM ${expectL}`);
        check(Math.abs(h[10] - expectL) <= 1, `${tag}${lbl}: ping-measured ${h[10]} == ${expectL}`);
        check(h[17] === 0, `${tag}${lbl}: feedback write lands on the emit position (loop error ${h[17]})`);
    }
    if (limiter && lookBefore !== null) evalLom(HELPERS + `param(${limiter.id}, "Lookahead").set("value", ${lookBefore}); return 1;`);
    evalLom(HELPERS + `param(${pair.id}, "Debug").set("value", ${Math.max(debugBefore, 0)}); return 1;`);
    evalLom(`new LiveAPI("${trackPath}").call("stop_all_clips"); return 1;`);
}
evalLom(`new LiveAPI("live_set").call("stop_playing"); return 1;`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall Live checks passed");
process.exit(failures ? 1 : 0);
