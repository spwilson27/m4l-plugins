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
 *   loop        the derived chain loop: period = K x the tank's period (never below MIN), gain = 10^(-3 (T + allpass delay) / Decay),
 *               tank RT60 = Decay x TANK_FRAC
 *   shimmer     (first linked pair) Live's Shifter inserted between Reverb+ and Reverb+ End through the LOM (insert_device), +12 st, Dry/Wet 100 %:
 *               a 220 Hz tone burst (/tmp/rp_tone_220.wav, made in the VM) plays and the return ring (xfer ch 3, what the chain hands back)
 *               shifted to 440 Hz with the unshifted 220 Hz 12 dB+ below, 880 Hz within 10 dB and 1760 Hz within 20 dB of 440 Hz (the cascade), and no loop mute while it plays
 *   dsp         every Start's gen~ runs (re-created once if it never joined the DSP chain) and every End gen runs
 *   restore     the Limiter lookahead / parameters are put back as found
 *
 *   node scripts/test_reverbplus_live.js [--port 9879]
 */

const { execFileSync } = require("child_process");
const CFG = require(require("path").join(__dirname, "..", "src", "reverbplus_config.js"));
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
const readScope = (name) => readBuf(name, CFG.RP_SCOPE_SAMPS);
const SC = CFG.RP_SCOPE;

// Deferred DSP: each Start creates its gen~ after load and logs to Global("reverbplus_trace").
let dspMs = null;
{
    let trace = "";
    for (let t = 0; t < 90; t++) {
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
    {
        // both gens run: Start frame counter (scope 0) and End frame counter (escope 7) advance
        const s0 = readScope(pair.scope)[0], e0 = readBuf(end.scope, 12)[7];
        sleep(600);
        const s1 = readScope(pair.scope)[0], e1 = readBuf(end.scope, 12)[7];
        check(s1 !== s0 && e1 !== e0, `${tag} Start gen runs (frames ${s0} -> ${s1}) and End gen runs (${e0} -> ${e1})`);
    }
    let h = readHdr(pair.hdr);
    check(h[14] === 1 && h[15] === 1, `${tag} link: Start sees End (${h[14]}), End sees Start (${h[15]})`);
    check(h[3] >= 1 && h[3] <= 2048, `${tag} K = ${h[2]}, B = ${h[3]}`);
    check(h[4] === lomL, `${tag} L in use ${h[4]} == LOM sum ${lomL}`);

    const trackPath = pair.path.split(" devices ")[0];
    const setP = (name, v) => evalLom(HELPERS + `var p = param(${pair.id}, ${JSON.stringify(name)}); if (!p) return "no parameter ${name}"; p.set("value", ${v}); return "ok";`);
    const getP = (name) => evalLom(HELPERS + `var p = param(${pair.id}, ${JSON.stringify(name)}); return p ? Number(p.get("value")) : null;`);
    const sizeNow = () => Number(evalLom(HELPERS + `var p = param(${pair.id}, "Size"); return p ? Number(p.get("value")) : 60;`)) / 100;
    const before = { drywet: getP("Dry/Wet"), algo: getP("Algorithm"), stretch: getP("IR Stretch") };
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
        const s = readScope(pair.scope), hEnd = readHdr(pair.hdr);
        check(meter > 0.01, `${tag} track meter moves (${Number(meter).toFixed(3)})`);
        check(s[14] > 1e-4, `${tag} Start wet peak ${s[14].toFixed(4)}, End out peak ${hEnd[17].toFixed(4)}`);

        // every algorithm reaches the gen and settles
        for (let a = 0; a < 6; a++) {
            setP("Algorithm", a);
            sleep(900);
            const sc = readScope(pair.scope);
            check(sc[2] === a, `${tag} Algorithm ${a}: gen runs ${sc[2]}`);
            const st = sc[SC.ALGO_STATE];
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

        // the derived outer loop (no Loop / Loop Time parameters): period = K x the tank's period, never below MIN; gain and
        // tank RT60 from Decay (a unity chain: this rack holds a Limiter, which has no gain below its ceiling)
        for (const algo of [1, 2, 0]) {
            setP("Algorithm", algo);
            sleep(1200);
            const lc = readScope(pair.scope);
            const sz = readScope(pair.scope);
            const sr = lc[1];
            const size = sizeNow();
            const want = CFG.rpLoopPeriod(algo, size, sr, 0);
            const tmin = h[3] + h[4] + 4;
            const wantEff = Math.max(want, tmin);
            check(Math.abs(lc[9] * sr / 1000 - wantEff) < 1.5 && (lc[11] === 1) === (want < tmin),
                `${tag} Algorithm ${algo}: derived loop ${want} smp (MIN ${tmin}), telemetry ${(lc[9] * sr / 1000).toFixed(1)} smp, clamped ${lc[11]}`);
            const wantG = CFG.rpLoopGain(algo, { decay: lc[23] }, wantEff, sr, 0);
            check(sz[SC.LOOP_GAIN] > 0.2 && sz[SC.LOOP_GAIN] <= 0.97 && Math.abs(sz[SC.LOOP_GAIN] - wantG) < 0.01, `${tag} Algorithm ${algo}: derived loop gain ${sz[SC.LOOP_GAIN].toFixed(4)} (want ${wantG.toFixed(4)})`);
            check(Math.abs(sz[SC.TANK_RT] - lc[23] * CFG.RP_LOOP.TANK_FRAC) < 0.01 * lc[23] + 1e-3, `${tag} Algorithm ${algo}: tank RT60 ${sz[SC.TANK_RT].toFixed(3)} s = Decay ${lc[23].toFixed(3)} s x ${CFG.RP_LOOP.TANK_FRAC}`);
        }

        // shimmer: a real Live Shifter (+12 st) inside the reverb's feedback (first linked pair only)
        if (!globalThis.shimmerDone && h[14] === 1) {
            globalThis.shimmerDone = true;
            const chainPath = pair.path.replace(/ devices \d+$/, "");
            const shIdx = pair.index + 1;
            let built;
            try {
                built = evalLom(`
                    var ch = new LiveAPI("${chainPath}");
                    ch.call("insert_device", "Shifter", ${shIdx});
                    var d = new LiveAPI("${chainPath} devices ${shIdx}");
                    var names = [];
                    var n = d.getcount("parameters");
                    for (var i = 0; i < n; i++) { var p = new LiveAPI("${chainPath} devices ${shIdx} parameters " + i); names.push(String(p.get("name")) + ":" + Number(p.get("min")) + ".." + Number(p.get("max")) + "=" + Number(p.get("value"))); }
                    return { id: Number(d.id), cls: String(d.get("class_name")), lat: Number(d.get("latency_in_samples")), names: names };
                `);
            } catch (e) { built = { error: String(e) }; }
            check(built && !built.error && built.cls === "Shifter", `${tag} Live Shifter inserted between Start and End (${built && (built.error || built.cls)})`);
            if (built && !built.error) {
                console.log(`INFO Shifter parameters: ${built.names.join(" | ")}`);
                const setSh = (re, v) => evalLom(`
                    var d = new LiveAPI("id ${built.id}");
                    var n = d.getcount("parameters");
                    for (var i = 0; i < n; i++) {
                        var p = new LiveAPI("${chainPath} devices ${shIdx} parameters " + i);
                        if (new RegExp(${JSON.stringify(re)}, "i").test(String(p.get("name")))) { var mx = Number(p.get("max")), mn = Number(p.get("min")); p.set("value", Math.max(mn, Math.min(mx, ${v}))); return String(p.get("name")) + "=" + Number(p.get("value")); }
                    }
                    return "none";
                `);
                console.log(`INFO Shifter set: mode ${setSh("^Mode$", 0)}, pitch ${setSh("^(Pitch Coarse|Coarse|Pitch)$", 12)}, fine ${setSh("^Fine$", 0)}, wet ${setSh("^(Dry/Wet|Wet)$", 100)}`);
                setP("Algorithm", 1);
                setP("Dry/Wet", 100);
                sleep(1500);
                {
                    const hh = readHdr(pair.hdr), ss = readScope(pair.scope), zz = readScope(pair.scope);
                    console.log(`INFO shimmer chain: Shifter latency ${built.lat}, L in use ${hh[4]}, B ${hh[3]}, K ${hh[2]}, loop ${(ss[9]).toFixed(1)} ms, clamped ${ss[11]}, loop gain ${zz[SC.LOOP_GAIN].toFixed(3)}, tank RT60 ${zz[SC.TANK_RT].toFixed(3)} s`);
                }
                evalLom(`new LiveAPI("${trackPath}").call("stop_all_clips"); return 1;`);
                const toneOk = evalLom(`
                    var slot = new LiveAPI("${trackPath} clip_slots 1");
                    if (Number(slot.get("has_clip")) === 0) { try { slot.call("create_audio_clip", "/tmp/rp_tone_220.wav"); } catch (e) { return "no create_audio_clip: " + e; } }
                    if (Number(slot.get("has_clip")) === 0) return "clip not created";
                    new LiveAPI("${trackPath} clip_slots 1 clip").set("looping", 1);
                    slot.call("fire");
                    return "ok";
                `);
                check(toneOk === "ok", `${tag} tone clip playing (${toneOk})`);
                if (toneOk === "ok") {
                    const reg = evalLom(`var r = new Global("reverbplus_bus").reg[${pair.id}]; return { xfer: r.xfer, hdr: r.hdr };`);
                    const freqs = [220, 440, 880, 1760, 3520];
                    const muteBefore = readScope(pair.scope)[SC.MUTE_N];
                    const peaks = freqs.map(() => 0), peaksExact = freqs.map(() => 0);
                    const trace = [];
                    const sr0 = readScope(pair.scope)[1];
                    for (let k = 0; k < 24; k++) {
                        sleep(250);
                        const pw = evalLom(`
                            var N = 65536, sr = ${sr0}, L = 16384;
                            var h = new Buffer(${JSON.stringify(reg.hdr)}); var ce = Number(h.peek(1, 1, 1));
                            var b = new Buffer(${JSON.stringify(reg.xfer)});
                            var raw = b.peek(3, 0, N), x = new Array(L);
                            var st = (Math.floor(ce) + 1 + N - L) % N;
                            for (var i = 0; i < L; i++) x[i] = raw[(st + i) % N] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / L));
                            // the cascaded partials are not exactly 2^n x 220 Hz (the reverb's modulation smears each pass), so
                            // each band is the strongest line within +-4 % of its nominal frequency, not one exact bin
                            var out = [], exact = [], fr = ${JSON.stringify(freqs)};
                            for (var f = 0; f < fr.length; f++) {
                                var best = 0;
                                for (var k = -8; k <= 8; k++) {
                                    var w = 2 * Math.PI * fr[f] * (1 + k * 0.005) / sr, re = 0, im = 0, c = Math.cos(w), s = Math.sin(w), cr = 1, ci = 0;
                                    for (var i = 0; i < L; i++) { re += x[i] * cr; im -= x[i] * ci; var t = cr * c - ci * s; ci = cr * s + ci * c; cr = t; }
                                    var pwr = 2 * (re * re + im * im) / (L * L * 0.25);
                                    best = Math.max(best, pwr);
                                    if (k === 0) exact.push(pwr);
                                }
                                out.push(best);
                            }
                            return { tol: out, exact: exact };
                        `);
                        pw.tol.forEach((v, i) => { peaks[i] = Math.max(peaks[i], v); });
                        pw.exact.forEach((v, i) => { peaksExact[i] = Math.max(peaksExact[i], v); });
                        {
                            const ss2 = readScope(pair.scope), hh2 = readHdr(pair.hdr), z2 = readScope(pair.scope);
                            trace.push(`${(k * 0.25).toFixed(2)}s wet ${ss2[14].toFixed(4)} ret ${ss2[15].toFixed(4)} L ${hh2[4]} K ${hh2[2]} B ${hh2[3]} cal ${hh2[18]} mutes ${z2[SC.MUTE_N]}(L${z2[SC.MUTE_L]} B${z2[SC.MUTE_B]} K${z2[SC.MUTE_K]}) gLink ${z2[SC.GLINK].toFixed(2)} p440 ${(10 * Math.log10(Math.max(pw.tol[1], 1e-30))).toFixed(0)} p880 ${(10 * Math.log10(Math.max(pw.tol[2], 1e-30))).toFixed(0)}`);
                        }
                    }
                    console.log("INFO shimmer trace:\n  " + trace.join("\n  "));
                    const dbv = (v) => 10 * Math.log10(Math.max(v, 1e-30));
                    {
                        const hh = readHdr(pair.hdr), ss = readScope(pair.scope);
                        console.log(`INFO shimmer after: L ${hh[4]}, K ${hh[2]}, B ${hh[3]}, End sees Start ${hh[15]}, return peak ${ss[15].toFixed(4)}, wet peak ${ss[14].toFixed(4)}, clip ${ss[18].toFixed(2)} dB`);
                    }
                    console.log(`INFO shimmer peak power (dB, 65536-sample return ring): ${freqs.map((f, i) => f + " Hz " + dbv(peaks[i]).toFixed(1)).join(", ")}`);
                    // The cascade through Live's Shifter (+12 st): every pass of the loop shifts up one more octave, so 880 and 1760 Hz
                    // appear. Measured in Live 12.4.6 (VM, Hall, Decay 2.5 s, Shifter Pitch Coarse +12, strongest line within +-4 % over
                    // the last 0.34 s of the return, maximum over 6 s): 880 Hz is -3.0 / -5.1 dB and 1760 Hz -4.9 / -4.7 dB vs 440 Hz in two runs (the old single-bin measurement read -39 dB for both).
                    // The limits (880 Hz not more than 10 dB, 1760 Hz not more than 20 dB below 440 Hz) leave a margin of the same size.
                    const d880 = dbv(peaks[2]) - dbv(peaks[1]), d1760 = dbv(peaks[3]) - dbv(peaks[1]);
                    console.log(`INFO shimmer, the old single-bin measurement (exact 220 x 2^n Hz): 880 Hz ${(dbv(peaksExact[2]) - dbv(peaksExact[1])).toFixed(1)} dB vs 440 Hz, 1760 Hz ${(dbv(peaksExact[3]) - dbv(peaksExact[1])).toFixed(1)} dB`);
                    console.log(`INFO shimmer: 880 Hz ${d880.toFixed(1)} dB vs 440 Hz, 1760 Hz ${d1760.toFixed(1)} dB vs 440 Hz`);
                    check(d880 > -10, `${tag} shimmer: 880 Hz (second pass) is ${d880.toFixed(1)} dB vs 440 Hz (limit > -10)`);
                    check(d1760 > -20, `${tag} shimmer: 1760 Hz (third pass) is ${d1760.toFixed(1)} dB vs 440 Hz (limit > -20)`);
                    {
                        // a chain that alters the signal (no correlation with Start's tap) must not make the pair re-time itself and
                        // mute the loop: the Start counts every L / B / K change (each one ducks the wet and the return for 2048 samples)
                        const zAfter = readScope(pair.scope);
                        const dm = zAfter[SC.MUTE_N] - muteBefore;
                        check(dm <= 1, `${tag} shimmer: ${dm} loop mutes (L ${zAfter[SC.MUTE_L]}, B ${zAfter[SC.MUTE_B]}, K ${zAfter[SC.MUTE_K]} changes in total) while the Shifter plays`);
                    }
                    check(dbv(peaks[0]) < dbv(peaks[1]) - 12, `${tag} shimmer: the unshifted 220 Hz is ${(dbv(peaks[1]) - dbv(peaks[0])).toFixed(1)} dB below 440 Hz`);
                }
                evalLom(`new LiveAPI("${trackPath}").call("stop_all_clips"); return 1;`);
                evalLom(`new LiveAPI("${chainPath}").call("delete_device", ${shIdx}); return 1;`);
            }
        }
    }
    // restore
    evalLom(`new LiveAPI("${trackPath}").call("stop_all_clips"); return 1;`);
    for (const [name, key] of [["Dry/Wet", "drywet"], ["Algorithm", "algo"]]) if (before[key] !== null) setP(name, before[key]);

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
