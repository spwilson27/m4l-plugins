#!/usr/bin/env node
/**
 * Live end-to-end test for Reverb+, driven through the Ableton MCP Bridge (`scripts/ableton_mcp_server.js`,
 * `ableton_eval_lom_js`).
 *
 * Needs a Live set with the MCP Bridge and at least one Reverb+ pair, e.g. reverbplus_test.als (tracks "Reverb+ 1/2/3":
 * rack [Reverb+, Limiter 6 ms, Reverb+ End]). Live runs in the tart VM (AGENTS.md 1a): `scripts/vm_reverbplus.sh run`
 * (= live + test under the Live lock). Every Start registers in Global("reverbplus_bus").reg, which is how the test finds
 * the pairs, their buffer names and the chain.
 *
 * First: every Start's deferred gen~ reports "dsp ready" in Global("reverbplus_trace").
 * Per pair:
 *   link        Start and End see each other (hdr 14 / 15), the return read lag B (hdr 3) is 1..2048, L (hdr 4) == the sum of
 *               latency_in_samples of the devices between them
 *   algorithms  every algorithm (LOM parameter Algorithm 0..5) reaches the gen (scope ALGO) and its fade state settles to 0
 *   audio       a Core Library drum loop plays through the chain with Dry/Wet 100 %: the track meter moves, the Start's wet
 *               peak and End's output peak (scope) are above 0
 *   ir          Convolution: the engine's `dropfile` (the live.drop path, through the test hook `#0-rptest`) loads a Core
 *               Library file as the IR: status ready, length 1..RP_IR_MAX, header version bumped, the Start convolves (wet peak > 0);
 *               IR Stretch 150 % reprocesses it (longer, new version)
 *   loop        Loop Time 0 with Loop > 0 flags MIN (scope CLAMPED), the effective loop is >= B + L + 4
 *   restore     the Limiter lookahead / parameters are put back as found
 *
 *   node scripts/test_reverbplus_live.js [--port 9879]
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
    var g = new Global("reverbplus_bus");
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
                        lat: Number(d.get("latency_in_samples")), role: reg[did] ? reg[did].role : null,
                        hdr: reg[did] ? reg[did].hdr : null, scope: reg[did] ? reg[did].scope : null });
        }
        out.push({ id: Number(id), path: p, index: Number(m[2]), hdr: e.hdr, scope: e.scope, devs: devs });
    }
    return out;
`);

if (!pairs.length) {
    console.error("No live Reverb+ (Start) instance found. Load reverbplus_test.als (scripts/vm_reverbplus.sh live).");
    process.exit(1);
}

const LOOP = process.env.REVERBPLUS_LOOP || "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/Loops/Drums/Full/Hip Hop Doubled 145 bpm.wav";
const IR_FILE = process.env.REVERBPLUS_IR || "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/Loops/Tonal/Keys/Dirty Herbie Chords 73 bpm.wav";

let failures = 0;
function check(ok, msg) {
    console.log((ok ? "PASS " : "FAIL ") + msg);
    if (!ok) failures++;
}

function readBuf(name, n) {
    return evalLom(`var b = new Buffer(${JSON.stringify(name)}); var v = b.peek(1, 0, ${n}); return typeof v === "number" ? [v] : Array.prototype.slice.call(v);`);
}
const readHdr = (name) => readBuf(name, 48);
// LOM values of exponent parameters are the linear position, not the shown value: lom = min + (max - min) * ((v - min) / (max - min)) ^ (1 / exponent)
const expLom = (v, lo, hi, expo) => lo + (hi - lo) * Math.pow((v - lo) / (hi - lo), 1 / expo);
const readScope = (name) => readBuf(name, 40);

// Deferred DSP: each Start creates its gen~ after load and logs to Global("reverbplus_trace").
let dspMs = null;
{
    let trace = "";
    for (let t = 0; t < 60; t++) {
        trace = String(evalLom(`return String(new Global("reverbplus_trace").text || "");`) || "");
        if ((trace.match(/ dsp ready after /g) || []).length >= pairs.length || / dsp-error /.test(trace)) break;
        sleep(500);
    }
    const ready = trace.match(/ dsp ready after \d+ ms/g) || [];
    const times = ready.map((r) => Number(r.replace(" dsp ready after ", "").replace(" ms", "")));
    dspMs = times;
    check(ready.length >= pairs.length && !/ dsp-error /.test(trace),
        `deferred DSP: ${ready.length}/${pairs.length} Starts ready (${times.join(", ")} ms after the gen~ was created)`);
    const first = (trace.match(/^\+(\d+) dsp-start/m) || [])[1];
    console.log(`INFO trace:\n${trace.split("\n").slice(-12).join("\n")}`);
    void first;
}

function report(id) {
    evalLom(`messnamed("#0-rptest", "test_report"); return 1;`);
    sleep(300);
    return JSON.parse(evalLom(`return String(new Global("reverbplus_test")["report_${id}"] || "null");`));
}

for (const pair of pairs) {
    const tag = `[${pair.path}]`;
    const endIdx = pair.devs.findIndex((d, i) => i > pair.index && d.role === "end");
    check(endIdx > 0, `${tag} has a Reverb+ End after it in the chain`);
    if (endIdx < 0) continue;
    const end = pair.devs[endIdx];
    const between = pair.devs.slice(pair.index + 1, endIdx);
    const lomL = between.reduce((s, d) => s + Math.max(0, d.lat), 0);
    console.log(`${tag} chain: ${between.map((d) => `${d.name}(${d.lat})`).join(", ") || "(empty)"}`);

    sleep(1200);
    let h = readHdr(pair.hdr);
    check(h[14] === 1 && h[15] === 1, `${tag} link: Start sees End (${h[14]}), End sees Start (${h[15]})`);
    check(h[3] >= 1 && h[3] <= 2048, `${tag} K = ${h[2]}, B = ${h[3]}`);
    check(h[4] === lomL, `${tag} L in use ${h[4]} == LOM sum ${lomL}`);

    const trackPath = pair.path.split(" devices ")[0];
    const setP = (name, v) => evalLom(HELPERS + `var p = param(${pair.id}, ${JSON.stringify(name)}); if (!p) return "no parameter ${name}"; p.set("value", ${v}); return "ok";`);
    const getP = (name) => evalLom(HELPERS + `var p = param(${pair.id}, ${JSON.stringify(name)}); return p ? Number(p.get("value")) : null;`);
    const before = { drywet: getP("Dry/Wet"), algo: getP("Algorithm"), loop: getP("Loop"), looptime: getP("Loop Time"), stretch: getP("IR Stretch") };
    check(before.algo !== null, `${tag} parameters reachable through the LOM (Algorithm ${before.algo}, Dry/Wet ${before.drywet})`);

    // audio: a drum loop through the chain at Dry/Wet 100 %
    setP("Dry/Wet", 100);
    const clipOk = evalLom(`
        var slot = new LiveAPI("${trackPath} clip_slots 0");
        if (Number(slot.get("has_clip")) === 0) {
            try { slot.call("create_audio_clip", ${JSON.stringify(LOOP)}); } catch (e) { return "no create_audio_clip: " + e; }
        }
        if (Number(slot.get("has_clip")) === 0) return "clip not created";
        var clip = new LiveAPI("${trackPath} clip_slots 0 clip");
        clip.set("looping", 1);
        slot.call("fire");
        return "ok";
    `);
    check(clipOk === "ok", `${tag} loop clip playing (${clipOk})`);
    if (clipOk === "ok") {
        sleep(2500);
        const meter = evalLom(`var t = new LiveAPI("${trackPath}"); return Number(t.get("output_meter_left"));`);
        const s = readScope(pair.scope);
        check(meter > 0.01, `${tag} track meter moves (${Number(meter).toFixed(3)})`);
        check(s[14] > 1e-4, `${tag} Start wet peak ${s[14].toFixed(4)}, End out peak ${s[16].toFixed(4)}`);

        // every algorithm reaches the gen and settles
        for (let a = 0; a < 6; a++) {
            setP("Algorithm", a);
            sleep(900);
            const sc = readScope(pair.scope);
            check(sc[2] === a, `${tag} Algorithm ${a}: gen runs ${sc[2]}`);
            const st = readBuf(pair.scope, 849)[848];
            check(st === 0, `${tag} Algorithm ${a}: fade state back to 0 (${st})`);
            if (a < 5) check(sc[14] > 1e-5, `${tag} Algorithm ${a}: wet peak ${sc[14].toFixed(5)}`);
        }

        // Convolution with an IR file through the live.drop path
        setP("Algorithm", 5);
        evalLom(`messnamed("#0-rptest", "dropfile", ${JSON.stringify(IR_FILE)}); return 1;`);
        let rep = null;
        for (let t = 0; t < 40; t++) {
            sleep(500);
            rep = report(pair.id);
            if (rep && rep.ir.status === "ready") break;
        }
        check(rep && rep.ir.status === "ready" && rep.ir.loaded && rep.ir.len > 1000 && rep.ir.len <= 290816,
            `${tag} IR loaded: ${rep && JSON.stringify(rep.ir)}`);
        h = readHdr(pair.hdr);
        check(h[37] === 1 && h[32] >= 1 && h[36] === (rep && rep.ir.len), `${tag} header: loaded ${h[37]}, version ${h[32]}, length ${h[36]}, head ${h[34]}, tail ${h[35]}`);
        sleep(1500);
        const sc = readScope(pair.scope);
        check(sc[2] === 5 && sc[14] > 1e-5, `${tag} convolving: wet peak ${sc[14].toFixed(5)}, IR loaded flag ${sc[25]}, length ${sc[26]}`);
        const len0 = rep ? rep.ir.len : 0;
        setP("IR Stretch", 150);
        let rep2 = null;
        for (let t = 0; t < 40; t++) {
            sleep(500);
            rep2 = report(pair.id);
            if (rep2 && rep2.ir.status === "ready" && rep2.ir.ver > rep.ir.ver) break;
        }
        const wantLen = Math.min(Math.floor(len0 * 1.5), 290816); // the engine caps the IR at RP_IR_MAX
        check(rep2 && rep2.ir.ver > rep.ir.ver && Math.abs(rep2.ir.len - wantLen) <= 2,
            `${tag} IR Stretch 150 %: length ${len0} -> ${rep2 && rep2.ir.len} (want ${wantLen}), version ${rep && rep.ir.ver} -> ${rep2 && rep2.ir.ver}`);
        setP("IR Stretch", before.stretch);

        // outer loop MIN
        setP("Algorithm", 1);
        setP("Loop", 50);
        setP("Loop Time", 0);
        sleep(900);
        const lc = readScope(pair.scope);
        const tmin = h[3] + h[4] + 4;
        check(lc[11] === 1 && Math.abs(lc[8] * lc[1] / 1000 - tmin) < 1.5, `${tag} Loop Time 0: MIN flagged (${lc[11]}), MIN ${lc[8].toFixed(2)} ms = ${(lc[8] * lc[1] / 1000).toFixed(0)} smp vs B + L + 4 = ${tmin}`);
        setP("Loop Time", expLom(120, 0, 2000, 3));
        sleep(600);
        const lc2 = readScope(pair.scope);
        check(lc2[11] === 0 && Math.abs(lc2[9] - 120) < 0.1, `${tag} Loop Time 120 ms: effective ${lc2[9].toFixed(2)} ms, not clamped`);
    }
    // restore
    evalLom(`new LiveAPI("${trackPath}").call("stop_all_clips"); return 1;`);
    for (const [name, key] of [["Dry/Wet", "drywet"], ["Algorithm", "algo"], ["Loop", "loop"], ["Loop Time", "looptime"]]) if (before[key] !== null) setP(name, before[key]);

    // latency follows the LOM (Limiter lookahead)
    const limiter = between.find((d) => d.cls === "Limiter");
    if (limiter) {
        const lookBefore = evalLom(HELPERS + `return Number(param(${limiter.id}, "Lookahead").get("value"));`);
        for (const look of [2, 0, 1]) {
            evalLom(HELPERS + `param(${limiter.id}, "Lookahead").set("value", ${look}); return 1;`);
            sleep(1500);
            const lat = evalLom(`return Number(new LiveAPI("id ${limiter.id}").get("latency_in_samples"));`);
            const expectL = lomL - limiter.lat + lat;
            h = readHdr(pair.hdr);
            check(h[4] === expectL, `${tag} lookahead ${look} (${lat} smp): L in use ${h[4]} == LOM ${expectL}`);
        }
        evalLom(HELPERS + `param(${limiter.id}, "Lookahead").set("value", ${lookBefore}); return 1;`);
    }
}

evalLom(`new LiveAPI("live_set").call("stop_playing"); return 1;`);
console.log(`INFO deferred DSP ready after (ms): ${dspMs && dspMs.join(", ")}`);
console.log(`INFO trace tail:\n${String(evalLom(`return String(new Global("reverbplus_trace").text || "");`) || "").split("\n").filter((l) => / ir /.test(l)).slice(-6).join("\n")}`);
console.log(failures ? `\n${failures} check(s) failed` : "\nall Live checks passed");
process.exit(failures ? 1 : 0);
