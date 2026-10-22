#!/usr/bin/env node
/**
 * Live end-to-end test for Glitch, driven through the Ableton MCP Bridge (`scripts/ableton_mcp_server.js`,
 * `ableton_eval_lom_js`). Needs glitch_test.als (audio track "Glitch" + the bridge on Main). Live runs in the tart VM
 * (AGENTS.md 1a): `scripts/vm_glitch.sh run` (live + test under the Live lock). Checks, in order:
 *   find      the Glitch device (class MxDeviceAudioEffect) on a track; its Live parameters (Morph X / Y, Chaos, Mix, Out,
 *             Randomize, Mutate, Mode) are listed by the LOM
 *   dsp       Global("glitch_trace") gets "dsp ready" (deferred gen~, AGENTS.md 1d); prints the load -> dsp-ready time
 *   counter   the gen's telemetry frame counter advances
 *   audio     a looped 220 Hz + 1.76 kHz clip plays through the device: the track meter rises (dry through the gen)
 *   randomize `randomize <seed>` through the test hook: tiles appear, the telemetry shows activity, and the device's output
 *             level (gen telemetry OUT_PEAK / IN_PEAK) changes for most seeds
 *   trigger   the Randomize Live parameter (rising edge) rolls once and resets itself
 *   morph     slot 1 = hard drive, slot 2 = a 60 Hz low pass (test_fill, corners 1 2 1 2). Setting Morph X through the LOM
 *             flips Mode to Morph by itself; X = 0 is loud, X = 100 is >= 10 dB quieter (telemetry; the track meter, which
 *             is on Live's own scale, agrees in direction), X = 50 lies between
 *   seq       Mode = Seq through the LOM: the step advances while the transport plays; Seq Rate / Glide / Seq Length set through the
 *             LOM reach the gen (its reported step length, step = counter mod length, crossfade = fraction / glide)
 *   movement  (phase 3) Randomize assigns movement (tiles with an indicator, gen telemetry MOVE_ON); a Width / Gain module with a synced
 *             LFO on its gain (test_move) audibly varies the output over time while the transport plays, its phase equals the host beat
 *             x cycles-per-beat (locked), and stopping the transport holds the synced phase
 *   phase4    (phase 4) test_p4: Ratchet + Scratch (roll and lag telemetry move), the 11 new spectral sub-ops (STFT runs, spectra alive), both at
 *             once: gen keeps running, telemetry finite, output bounded
 *   mix       Mix 0 returns the dry level while the strong glitch is active
 *
 *   node scripts/test_glitch_live.js [--port 19880] [--wav /tmp/glitch_test_220.wav]
 */

const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = arg("--port", null);
const WAV = arg("--wav", "/tmp/glitch_test_220.wav");
const DSP_WAIT_MS = 25000;

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8" }));
    if (out.error) throw new Error(out.error);
    return out.result;
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const trace = () => String(evalLom('return new Global("glitch_trace").text;') || "");
const debug = (...m) => evalLom(`messnamed("#0-glitchdebug", ${m.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
function report() {
    debug("test_report");
    sleep(300);
    return JSON.parse(String(evalLom('return new Global("glitch_test").text;')));
}

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
            if (/Glitch/.test(String(dv.get("name")))) return { track: t, device: d, cls: String(dv.get("class_name")) };
        }
    }
    return null;
`);
if (!check(!!dev, "Glitch device found" + (dev ? ` (track ${dev.track}, ${dev.cls})` : ""))) finish();
const devPath = `live_set tracks ${dev.track} devices ${dev.device}`;
const params = evalLom(`
    var dv = new LiveAPI(${JSON.stringify(devPath)});
    var ids = dv.get("parameters");
    var out = {};
    for (var i = 0; i + 1 < ids.length; i += 2) {
        var p = new LiveAPI("id " + ids[i + 1]);
        out[String(p.get("name"))] = { id: Number(ids[i + 1]), min: Number(p.get("min")), max: Number(p.get("max")), value: Number(p.get("value")) };
    }
    return out;
`);
const WANT = ["Morph X", "Morph Y", "Chaos", "Mix", "Out", "Randomize", "Mutate", "Mode", "Seq Rate", "Glide", "Seq Length"];
check(WANT.every((n) => params[n]), "Live parameters present: " + WANT.map((n) => (params[n] ? n : "!" + n)).join(", "));
const getP = (name) => Number(evalLom(`return new LiveAPI("id ${params[name].id}").get("value");`));
const setP = (name, v) => evalLom(`new LiveAPI("id ${params[name].id}").set("value", ${v}); return 1;`);

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
debug("dsp_diag");
sleep(300);
const diag = (trace().split("\n").filter((l) => /dsp-diag/.test(l)).pop() || "");
console.log(diag);
check(/gen=gen~/.test(diag) && /cordsIn=[1-9]/.test(diag) && /cordsOut=[1-9]/.test(diag), "dsp_diag: gen~ present with input and output cords");
const scope = (diag.match(/scope=(\S+)/) || [])[1];
const counter = () => evalLom(`var v = new Buffer(${JSON.stringify(scope)}).peek(1, 0, 1); return typeof v === "number" ? v : v[0];`);
const c0 = counter(); sleep(600); const c1 = counter();
check(c1 !== c0, `telemetry frame counter advances (${c0} -> ${c1})`);

// audio: a looped clip through the device
const clipOk = evalLom(`
    var slot = new LiveAPI("live_set tracks ${dev.track} clip_slots 0");
    if (Number(slot.get("has_clip")) === 0) {
        try { slot.call("create_audio_clip", ${JSON.stringify(WAV)}); } catch (e) { return "no create_audio_clip: " + e; }
    }
    if (Number(slot.get("has_clip")) === 0) return "clip not created";
    var clip = new LiveAPI("live_set tracks ${dev.track} clip_slots 0 clip");
    clip.set("looping", 1);
    try { clip.set("launch_quantization", 0); } catch (e) {}
    slot.call("fire");
    return "ok";
`);
check(clipOk === "ok", `test clip playing (${clipOk})`);
const meter = () => Number(evalLom(`return new LiveAPI("live_set tracks ${dev.track}").get("output_meter_left");`));
function level(ms) { // max of the decaying meter over a window
    let m = 0;
    const t = Date.now();
    while (Date.now() - t < ms) { m = Math.max(m, meter()); sleep(60); }
    return m;
}
const db = (x) => 20 * Math.log10(Math.max(x, 1e-6));
// Live's track meter is on its own (not linear) scale, so levels are compared with the gen's telemetry: IN_PEAK / OUT_PEAK
// (decaying peaks of the device input and of its output after Mix and Output); the track meter is only used for direction.
function peaks(ms) {
    let pin = 1e-6, pout = 0;
    const t = Date.now();
    while (Date.now() - t < ms) {
        const a = evalLom(`var a = new Buffer(${JSON.stringify(scope)}).peek(1, 2, 2); return a;`);
        pin = Math.max(pin, a[0]); pout = Math.max(pout, a[1]);
        sleep(40);
    }
    return { in: pin, out: pout, db: db(pout) - db(pin) };
}
sleep(1500);
const dry = level(1200);
check(dry > 0.05, `track meter with no glitch (dry through the gen): ${dry.toFixed(3)}`);
const dryPk = peaks(800);
console.log(`  dry: input peak ${dryPk.in.toFixed(3)}, output peak ${dryPk.out.toFixed(3)} (${dryPk.db.toFixed(1)} dB)`);
check(Math.abs(dryPk.db) < 3, "no glitch: the device output is the input (within 3 dB: soft limiter)");
const r0 = report();
check(r0.ready === 1 && r0.tiles.length === 0, "no glitch yet: no tiles");

// randomize through the hook
let changed = 0;
let moveSeeds = 0;
for (let seed = 1; seed <= 8; seed++) {
    debug("randomize", seed);
    sleep(900);
    const r = report();
    const pk = peaks(700);
    const act = (r.activity || []).reduce((a, b) => a + b, 0);
    const d = pk.db - dryPk.db;
    if (Math.abs(d) >= 1.5) changed++;
    moveSeeds += (r.moves || []).length > 0 ? 1 : 0;
    const mvOn = (r.moveOn || []).reduce((a, b) => a + b, 0);
    if ((r.moves || []).length) check(mvOn >= 1, `seed ${seed}: movement on ${r.moves.join(",")} reaches the gen (telemetry MOVE_ON sum ${mvOn})`);
    console.log(`  seed ${seed}: tiles ${r.tiles.join(",")} activity ${act.toFixed(2)} output ${pk.out.toFixed(3)} (${d.toFixed(1)} dB vs dry)` + ((r.moves || []).length ? ` movement ${r.moves.join(",")}` : ""));
    if (!(r.tiles.length > 0 && act > 0.05)) check(false, `seed ${seed}: tiles and telemetry activity`);
}
check(changed >= 4, `randomize changes the output level (|delta| >= 1.5 dB for ${changed} of 8 seeds)`);
check(moveSeeds >= 1, `Randomize assigns movement to some modules (${moveSeeds} of 8 seeds)`);

// the Randomize / Mutate Live parameters (automation, MIDI map): a rising edge rolls once and the parameter resets
const seedBefore = report().seed;
setP("Randomize", 1);
sleep(1200);
const rr = report();
check(rr.seed === seedBefore + 1, `Randomize parameter 0 -> 1 rolled once (seed ${seedBefore} -> ${rr.seed})`);
check(getP("Randomize") === 0, "Randomize parameter reset itself to 0");
setP("Mutate", 1);
sleep(1200);
check(report().seed === seedBefore + 2 && getP("Mutate") === 0, "Mutate parameter rolled once and reset");

// the face's own event handling in Live (test_click = onclick + release at a device pixel): Randomize button, tile -> editor
{
    const G = require("../src/glitch_config.js");
    const Lh = G.glitchFaceLayout({});
    const mid = (r) => [r.x + r.w / 2, r.y + r.h / 2];
    const s0 = report().seed;
    debug("test_click", ...mid(Lh.action.dice));
    sleep(500);
    const rep = report();
    check(rep.seed === s0 + 1 && rep.tiles.length > 0, `click on the Randomize button rolls (seed ${s0} -> ${rep.seed}, tiles ${rep.tiles.join(",")})`);
    const tile = G.glitchTileRects(rep.tiles.length, Lh.view)[0];
    debug("test_click", ...mid(tile));
    sleep(500);
    const r2 = report();
    check(r2.ui.editor === 1 && r2.ui.sel === rep.tiles[0] && r2.width === 656, `click on a tile opens the editor (sel ${r2.ui.sel}, width ${r2.width})`);
    debug("test_click", ...mid(tile));
    sleep(500);
    const r3 = report();
    check(r3.ui.editor === 0 && r3.width === 462, `a second click collapses it (width ${r3.width})`);
}

// morph: slot 1 = hard drive (loud), slot 2 = 60 Hz low pass (quiet); corners are slots 1 2 1 2, so X moves between them
debug("test_fill");
sleep(900);
check(report().audition === "working" && getP("Mode") === 0, "test_fill: working glitch is the loud one, Mode = Working");
const wLevel = peaks(900).db;
setP("Morph Y", 0);
sleep(400);
setP("Morph X", 0);
sleep(1000);
const m0 = report();
check(m0.audition === "morph" && getP("Mode") === 1, "Morph X through the LOM flips Mode to Morph");
check(Math.abs(m0.weights[0] - 1) < 0.01, `X = 0: all weight on slot 1 (weights ${m0.weights.map((w) => w.toFixed(2)).join(" ")})`);
const loM = level(900);
const lo = peaks(600).db;
setP("Morph X", 100);
sleep(1200);
const m1 = report();
check(Math.abs(m1.weights[1] - 1) < 0.01, "X = 100: all weight on slot 2");
const hiM = level(900);
const hi = peaks(600).db;
setP("Morph X", 50);
sleep(1200);
const midM = level(900);
const mid = peaks(600).db;
console.log(`  output vs input (dB): working ${wLevel.toFixed(1)}, X=0 ${lo.toFixed(1)}, X=50 ${mid.toFixed(1)}, X=100 ${hi.toFixed(1)}; track meter ${loM.toFixed(2)} / ${midM.toFixed(2)} / ${hiM.toFixed(2)}`);
check(lo - hi >= 10, `Morph X 0 -> 100 changes the output by ${(lo - hi).toFixed(1)} dB (>= 10)`);
check(loM > hiM + 0.05, "the track meter follows (X = 0 louder than X = 100)");
check(mid < lo - 0.5 && mid > hi + 0.5, "X = 50 lies between the two corners");
check(getP("Morph X") === 50, "Morph X reads back 50");

// sequencer (phase 2): Mode = Seq through the LOM, two steps (slot 1 loud, slot 2 quiet), the transport plays (the clip is running).
// Every value the sequencer reports in one tick (beat, step counter, fraction, glide progress) must agree with the settings that
// came through the LOM: that proves Seq Rate / Glide / Seq Length reached the gen, not only the face's state.
const GS = require("../src/glitch_config.js");
debug("seqstep", 0, 0);
debug("seqstep", 1, 1);
sleep(300);
setP("Seq Length", 2);
setP("Seq Rate", 2);
setP("Glide", 0);
setP("Mode", 2);
sleep(900);
const isPlaying = () => Number(evalLom('return new LiveAPI("live_set").get("is_playing");')) === 1;
check(isPlaying(), "the transport is playing (the clip launched it)");
const sq0 = report();
check(sq0.audition === "seq" && getP("Mode") === 2, "Mode = Seq through the LOM");
check(sq0.seq && sq0.seq.length === 2 && sq0.seq.rate === 2 && sq0.seq.steps[0] === 0 && sq0.seq.steps[1] === 1, `Seq Length / Seq Rate reach the state (${JSON.stringify(sq0.seq)})`);
check(sq0.seqHdr && sq0.seqHdr[0] === 2 && sq0.seqHdr[1] === 2 && sq0.seqHdr[2] === 2, `... and the engine buffer header (${JSON.stringify(sq0.seqHdr)})`);
check(sq0.seqTele && sq0.seqTele.on === 1 && sq0.seqTele.play === 1, "sequencer telemetry on and playing");
function seqSamples(n, gapMs) {
    const out = [];
    for (let i = 0; i < n; i++) { const t = report().seqTele; if (t) out.push(t); sleep(gapMs); }
    return out;
}
// the step advances while the transport plays
let sm = seqSamples(12, 150);
const counts = [...new Set(sm.map((t) => t.count))];
const seen = {};
for (const t of sm) seen[t.step] = (seen[t.step] || 0) + 1;
check(counts.length >= 4 && sm.every((t, i) => i === 0 || t.count >= sm[i - 1].count), `the step counter advances with the transport (${counts.length} distinct of 12: ${counts.slice(0, 6).join(",")}...)`);
check(seen[0] > 0 && seen[1] > 0, `both steps are visited while the transport plays (${JSON.stringify(seen)})`);
check(sm.every((t) => t.step === t.count % 2), "step = counter mod Seq Length (2)");
const stepLen = (t) => t.beat / (t.count + t.frac);
const near = (a, b, tol) => Math.abs(a - b) <= tol * b;
check(sm.every((t) => near(stepLen(t), GS.GL_SEQ_RATES[2], 0.02)), `Seq Rate 1/16: the gen's step length is ${GS.GL_SEQ_RATES[2]} beat (${stepLen(sm[0]).toFixed(4)})`);
// Seq Rate through the LOM: the gen's step length follows
for (const idx of [6, 0]) {
    setP("Seq Rate", idx);
    sleep(700);
    sm = seqSamples(4, 120);
    check(sm.every((t) => near(stepLen(t), GS.GL_SEQ_RATES[idx], 0.02)), `Seq Rate ${GS.GL_SEQ_RATE_NAMES[idx]} via the LOM: gen step length ${GS.GL_SEQ_RATES[idx].toFixed(3)} beat (${stepLen(sm[0]).toFixed(4)})`);
}
setP("Seq Rate", 4);
// Seq Length through the LOM
debug("seqstep", 2, 0);
sleep(200);
setP("Seq Length", 3);
sleep(700);
sm = seqSamples(10, 130);
check(getP("Seq Length") === 3 && sm.every((t) => t.step === t.count % 3 && t.step < 3), `Seq Length 3 via the LOM: step = counter mod 3 in the gen (steps ${[...new Set(sm.map((t) => t.step))].sort().join(",")})`);
check(new Set(sm.map((t) => t.step)).size >= 2, "and the steps keep moving");
setP("Seq Length", 5);
sleep(700);
sm = seqSamples(6, 130);
check(sm.every((t) => t.step === t.count % 5), "Seq Length 5 via the LOM: step = counter mod 5");
// Glide through the LOM: the gen's crossfade progress is fraction / glide
setP("Glide", 0);
sleep(600);
sm = seqSamples(6, 100);
check(sm.every((t) => t.glide > 0.999), "Glide 0 %: the crossfade is a hard switch in the gen (progress 1)");
setP("Glide", 50);
sleep(700);
sm = seqSamples(10, 90);
const gl = sm.map((t) => Math.abs(t.glide - Math.min(1, t.frac / 0.5)));
check(Math.max(...gl) < 0.06 && sm.some((t) => t.glide < 0.95), `Glide 50 % via the LOM: crossfade progress = fraction / 0.5 in the gen (max error ${Math.max(...gl).toFixed(3)}, ${sm.filter((t) => t.glide < 0.95).length} of 10 samples mid-fade)`);
setP("Glide", 0);
// Randomize Sequence and a step edit from the face's own clicks
{
    const Gs = GS;
    const Lq = Gs.glitchFaceLayout({ seq: 1 });
    const midr = (r) => [r.x + r.w / 2, r.y + r.h / 2];
    debug("test_section", "seq", 1);
    sleep(500);
    check(report().width === Lq.width, `the SEQ section opens through the face (width ${report().width})`);
    const stepsBefore = JSON.stringify(report().seq.steps);
    debug("test_click", ...midr(Lq.seq.dice));
    sleep(500);
    const rs = report();
    check(JSON.stringify(rs.seq.steps) !== stepsBefore && rs.audition === "seq", "click on Randomize Sequence rolls a new sequence and keeps Seq");
    debug("test_section", "seq", 0);
    sleep(300);
}
setP("Seq Length", 2);
setP("Mode", 0);
sleep(500);


// movement (phase 3): one Width / Gain module with a synced sine LFO on its gain, 1/4 note cycle (one beat), +-9 dB. The scope is read
// straight from the buffer (no 300 ms report round trip): slot layout from src/glitch_config.js GL_SCOPE.
{
    const SC = GS.GL_SCOPE;
    const kW = GS.GL_INSTANCES.findIndex((i) => i.id === "wid");
    const readScope = () => evalLom(`return new Buffer(${JSON.stringify(scope)}).peek(1, 0, ${SC.END});`);
    setP("Mode", 0);
    debug("test_move");
    sleep(1200);
    check(report().moves.includes("wid"), "test_move: the Width / Gain tile carries a movement");
    // make sure the transport plays (the clip launched it earlier; the sequencer test left it running)
    if (!isPlaying()) { evalLom('new LiveAPI("live_set").call("start_playing"); return 1;'); sleep(800); }
    const circ = (a, b) => { const d = Math.abs((a - b) % 1); return Math.min(d, 1 - d); };
    const samples = [];
    for (let i = 0; i < 26; i++) { const a = readScope(); samples.push({ on: a[SC.MOVE_ON + kW], ofs: a[SC.MOVE_OFS + kW], pos: a[SC.MOVE_POS + kW], ph: a[SC.MOVE_PH + kW], beat: a[SC.BEAT], out: a[SC.OUT_PEAK], inp: a[SC.IN_PEAK], play: a[SC.SEQ_PLAY] }); sleep(40); }
    check(samples.every((x) => x.on === 1), "movement telemetry on for the Width / Gain module");
    const ofs = samples.map((x) => x.ofs);
    check(Math.max(...ofs) > 0.25 && Math.min(...ofs) < -0.25 && Math.max(...ofs.map(Math.abs)) <= 0.5001, `the offset swings +-0.5 over time (${Math.min(...ofs).toFixed(2)} .. ${Math.max(...ofs).toFixed(2)})`);
    const outDb = samples.filter((x) => x.inp > 0.05).map((x) => db(x.out) - db(x.inp));
    const span = Math.max(...outDb) - Math.min(...outDb);
    console.log(`  output vs input while the LFO runs: ${Math.min(...outDb).toFixed(1)} .. ${Math.max(...outDb).toFixed(1)} dB (span ${span.toFixed(1)} dB, ${outDb.length} samples, playing ${samples[0].play})`);
    check(outDb.length >= 12 && span >= 6, `the output level varies audibly with the movement (span ${span.toFixed(1)} dB >= 6)`);
    const lockErr = Math.max(...samples.map((x) => circ(x.ph, x.beat * 1)));
    check(lockErr < 0.06, `the LFO phase equals the host beat x 1 cycle/beat (largest phase error ${lockErr.toFixed(3)} of a cycle)`);
    check(samples.every((x) => x.pos >= 0 && x.pos <= 1), "target position telemetry stays in 0..1");
    // transport stopped: a synced source holds
    evalLom('new LiveAPI("live_set").call("stop_playing"); return 1;');
    sleep(900);
    const held = [];
    for (let i = 0; i < 6; i++) { const a = readScope(); held.push({ ph: a[SC.MOVE_PH + kW], play: a[SC.SEQ_PLAY + 0] }); sleep(200); }
    check(held.every((x) => x.play === 0), "the gen sees the stopped transport");
    check(Math.max(...held.map((x) => x.ph)) - Math.min(...held.map((x) => x.ph)) < 1e-6, `stopped transport: the synced LFO phase is held (${held[0].ph.toFixed(4)})`);
    evalLom('new LiveAPI("live_set").call("start_playing"); return 1;');
    sleep(900);
    const resumed = [];
    for (let i = 0; i < 4; i++) { const a = readScope(); resumed.push({ ph: a[SC.MOVE_PH + kW], beat: a[SC.BEAT] }); sleep(120); }
    check(resumed.every((x) => circ(x.ph, x.beat) < 0.06), "playback resumes locked to the host beat");
    check(Math.max(...resumed.map((x) => x.ph)) - Math.min(...resumed.map((x) => x.ph)) > 0.01 || circ(resumed[0].ph, resumed[3].ph) > 0.01, "and the phase moves again");
    setP("Mode", 0);
}

// phase 4: Ratchet / Scratch and the 11 new spectral sub-ops run in Live: the gen keeps running (frame counter), the telemetry is finite, the
// STFT runs with the new sub-ops, the roll telemetry of Ratchet moves, the output stays bounded, and an audio meter reading appears
{
    const P4 = require("../src/glitch_config.js");
    const SC = P4.GL_SCOPE;
    const readS = () => evalLom(`return new Buffer(${JSON.stringify(scope)}).peek(1, 0, ${SC.END});`);
    if (!isPlaying()) { evalLom('new LiveAPI("live_set").call("start_playing"); return 1;'); sleep(800); }
    setP("Mode", 0);
    debug("test_p4", "mods");
    sleep(1500);
    check(["ratc", "scrb"].every((k) => report().tiles.includes(k)), `test_p4 mods: Ratchet and Scratch tiles (${report().tiles.join(",")})`);
    const f0 = readS()[SC.FRAME];
    let ratSeen = 0, ratMaxIdx = 0, scrMoved = new Set(), finite = true, bounded = true;
    for (let i = 0; i < 40; i++) {
        const a = readS();
        if (a[SC.RAT_ON] > 0.5) { ratSeen++; ratMaxIdx = Math.max(ratMaxIdx, a[SC.RAT_IDX]); }
        scrMoved.add(Math.round(a[SC.SCR_POS] * 10));
        if (!a.every((v) => Number.isFinite(v))) finite = false;
        if (a[SC.OUT_PEAK] > 1.01) bounded = false;
        sleep(70);
    }
    check(readS()[SC.FRAME] > f0 + 20, "p4 mods: the gen runs (frame counter advances)");
    check(finite && bounded, "p4 mods: telemetry finite, output bounded");
    check(ratSeen >= 2, `p4 mods: the Ratchet roll shows in the telemetry (${ratSeen} of 40 reads, last repeat index ${ratMaxIdx})`);
    check(scrMoved.size >= 3, `p4 mods: the Scratch lag moves (${scrMoved.size} distinct positions)`);
    debug("test_p4", "spec");
    sleep(1800);
    const rs = report();
    check(["gfreeze", "stretch", "bubbler", "mp3ify", "duststorm", "thinner", "decap", "noisify", "clipper", "pswap", "rphase"].every((k) => rs.tiles.includes(k)), `test_p4 spec: the 11 new sub-op tiles (${rs.tiles.length} tiles)`);
    const g0 = readS();
    sleep(900);
    const g1 = readS();
    check(g1[SC.SPEC_RUN] === 1 && g1[SC.SPEC_FRAMES] > g0[SC.SPEC_FRAMES] + 20, `p4 spec: the STFT runs the new sub-ops (frames ${g0[SC.SPEC_FRAMES]} -> ${g1[SC.SPEC_FRAMES]})`);
    check(g1.every((v) => Number.isFinite(v)) && g1[SC.OUT_PEAK] <= 1.01, `p4 spec: finite telemetry, output peak ${g1[SC.OUT_PEAK].toFixed(3)}`);
    let bo = 0;
    for (let i = 0; i < 64; i++) bo += g1[SC.BANDS_OUT + i];
    check(bo > 0.5, "p4 spec: the output spectrum telemetry is alive");
    debug("test_p4", "p4all");
    sleep(1500);
    const g2 = readS();
    check(g2.every((v) => Number.isFinite(v)) && g2[SC.OUT_PEAK] <= 1.01 && g2[SC.FRAME] > g1[SC.FRAME], "p4 all: both at once keep running, finite and bounded");
}

// Mix: 0 = the dry level, with the strong glitch active
setP("Morph X", 0);
sleep(600);
setP("Mix", 0);
sleep(1000);
const mix0 = peaks(700).db;
check(Math.abs(mix0 - dryPk.db) < 2.5, `Mix 0 returns the dry level (${mix0.toFixed(1)} dB vs dry ${dryPk.db.toFixed(1)} dB) while the strong glitch is active`);
setP("Mix", 100);

// leave the clip stopped
evalLom(`new LiveAPI("live_set tracks ${dev.track} clip_slots 0").call("stop"); return 1;`);
finish();
