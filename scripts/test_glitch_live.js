#!/usr/bin/env node
/**
 * Live end-to-end test for Glitch, driven through the Ableton MCP Bridge (`scripts/ableton_mcp_server.js`,
 * `ableton_eval_lom_js`). Needs glitch_test.als (audio tracks "Glitch A" and "Glitch B", each with a Glitch instance, + the bridge on Main). Live runs in the tart VM
 * (AGENTS.md 1a): `scripts/vm_glitch.sh run` (live + test under the Live lock). Checks, in order:
 *   find      the Glitch device (class MxDeviceAudioEffect) on a track; its Live parameters (Morph X / Y, Chaos, Mix, Out,
 *             Randomize, Mutate, Mode) are listed by the LOM
 *   dsp       Global("glitch_trace_<hook name>") gets "dsp ready" (deferred gen~, AGENTS.md 1d); prints the load -> dsp-ready time
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
 *   isolate   (instance isolation, needs both Glitch instances) every per-instance buffer / receive is a `---` name that Live expands per
 *             instance: each instance reaches DSP ready on its own scope buffer, the scope names differ, instance A (drive, no spectral
 *             code) and B (spectral sub-ops) show different telemetry and stages, A's Mix 0 gives its track's dry level while B stays wet
 *             (and the other way round), and hot-loading the spectral stage in B leaves A's stages, frame counter and level alone
 *
 * Hook names: the patcher passes each instance its expanded `---glitchdebug` name; the v8ui registers it in Global("glitch_hooks")
 * ({LOM device id: name}); trace / test reports are Global("glitch_trace_<name>") / Global("glitch_test_<name>").
 *
 *   node scripts/test_glitch_live.js [--port 19880] [--wav /tmp/glitch_test_220.wav] [--inst 0]
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
const INST = Number(arg("--inst", 0));
// Per-instance hook / trace / report access. `key` = the instance's expanded ---glitchdebug name (see the header).
function hookKey(deviceId, waitMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
        const m = JSON.parse(String(evalLom('return new Global("glitch_hooks").text || "{}";')));
        if (m[String(deviceId)]) return m[String(deviceId)];
        sleep(300);
    }
    return null;
}
const mkInst = (key) => ({
    key,
    trace: () => String(evalLom(`return new Global(${JSON.stringify("glitch_trace_" + key)}).text;`) || ""),
    clearTrace: () => evalLom(`new Global(${JSON.stringify("glitch_trace_" + key)}).text = ""; return 1;`),
    debug: (...m) => evalLom(`messnamed(${JSON.stringify(key)}, ${m.map((x) => JSON.stringify(x)).join(", ")}); return 1;`),
    report() {
        this.debug("test_report");
        sleep(300);
        return JSON.parse(String(evalLom(`return new Global(${JSON.stringify("glitch_test_" + key)}).text;`)));
    },
});
let me = null; // the instance the single-instance checks drive
const trace = () => me.trace();
const debug = (...m) => me.debug(...m);
const report = () => me.report();
const clearTrace = () => me.clearTrace();

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
const found = evalLom(`
    var out = [];
    var n = new LiveAPI("live_set").getcount("tracks");
    for (var t = 0; t < n; t++) {
        var tr = new LiveAPI("live_set tracks " + t);
        var nd = tr.getcount("devices");
        for (var d = 0; d < nd; d++) {
            var dv = new LiveAPI("live_set tracks " + t + " devices " + d);
            if (/Glitch/.test(String(dv.get("name")))) out.push({ track: t, device: d, cls: String(dv.get("class_name")), id: String(dv.id) });
        }
    }
    return out;
`);
const dev = found[INST] || null;
if (!check(!!dev, `Glitch device found (${found.length} instance(s))` + (dev ? ` (track ${dev.track}, ${dev.cls})` : ""))) finish();
{
    const key = hookKey(dev.id, 30000);
    if (!check(!!key, `instance ${INST} registered its hook name${key ? ` (${key})` : ""}`)) finish();
    check(!/#0|^---/.test(key), "the hook name is an expanded per-instance name (not a literal #0- / ---)");
    me = mkInst(key);
}
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
const stamp = (re, text) => { const m = (text || tr).match(new RegExp("\\+(\\d+)ms " + re)); return m ? Number(m[1]) : null; };
const tStart = stamp("dsp-start"), tReady = stamp("dsp ready");
console.log(`LOAD TIME  dsp-ready ${tReady} ms after the script loaded` + (tStart !== null ? ` (stage creation started at +${tStart} ms, compile+run ${tReady - tStart} ms)` : "") + "  [one gen, before staging: ~5700 ms]");
for (const l of tr.split("\n")) if (/stage-|dsp-start|dsp ready/.test(l)) console.log("  " + l);
check(tReady !== null && tReady < 3500, `an empty device is ready ${tReady} ms after the script loaded (< 3500 ms; one gen~ for everything: ~5700 ms; the ~1 s of that before the first code load is the patcher load with its 26 saved shell gen~ objects)`);
debug("dsp_diag");
sleep(300);
const diag = (trace().split("\n").filter((l) => /dsp-diag/.test(l)).pop() || "");
console.log(diag);
check(/stage h:gen~:code cnt=\d+ run=1 on=0 in=[1-9]\d* /.test(diag), "dsp_diag: the head has its code, runs and has input cords");
check(/stage t:gen~:code cnt=\d+ run=1 on=0 in=[1-9]\d* out=[1-9]/.test(diag), "dsp_diag: the tail has its code, runs and has input and output cords");
const GSTAGES = require("../src/glitch_config.js").glitchStages();
const NONHT = GSTAGES.filter((x) => x.role === "group" || x.role === "spec").map((x) => x.id);
check(NONHT.every((id) => new RegExp(`stage ${id}:gen~:shell cnt=\\d+ run=0`).test(diag)), `an empty device has only shells for its ${NONHT.length} module stages (code is loaded when a glitch needs one)`);
const SIDX = (id) => GSTAGES.findIndex((x) => x.id === id);
const scope = (diag.match(/scope=(\S+)/) || [])[1];
const GSC = require("../src/glitch_config.js").GL_SCOPE;
const counterAt = (slot) => evalLom(`var v = new Buffer(${JSON.stringify(scope)}).peek(1, ${slot}, 1); return typeof v === "number" ? v : v[0];`);
const counter = () => counterAt(0);
const c0 = counter(); sleep(600); const c1 = counter();
check(c1 !== c0, `telemetry frame counter advances (${c0} -> ${c1})`);
{
    const before = { h: counterAt(GSC.STAGE_FRAME + SIDX("h")), t: counterAt(GSC.STAGE_FRAME + SIDX("t")), a: counterAt(GSC.STAGE_FRAME + SIDX("drvA")) };
    sleep(500);
    for (const k of ["h", "t"]) check(counterAt(GSC.STAGE_FRAME + SIDX(k)) !== before[k], `stage ${k}'s own frame counter advances`);
    check(counterAt(GSC.STAGE_FRAME + SIDX("drvA")) === before.a, "a stage that was never created has a still counter");
}

// load time by kind of glitch: the working glitch a restored device would have, then the whole stage load again (test_load = dsp_retry)
const loadStats = {};
for (const kind of ["empty", "typical", "spectral", "all", "typical", "empty"]) {
    clearTrace();
    debug("test_load", kind);
    let cur = "";
    const tl = Date.now();
    while (Date.now() - tl < 40000) { cur = trace(); if (/dsp ready/.test(cur)) break; sleep(80); }
    const s0 = stamp("dsp-start", cur), s1 = stamp("dsp ready", cur);
    // wait until every created stage is switched in (the spectral stage is the last)
    const ton = Date.now();
    while (Date.now() - ton < 25000) { const r = report(); if (Object.values(r.stages).every((x) => x === "none" || x === "on")) break; sleep(200); }
    cur = trace();
    const onAt = [...cur.matchAll(/\+(\d+)ms stage-on (\w+) \+(\d+)ms/g)].map((m) => Number(m[1]));
    const allOn = onAt.length ? Math.max(...onAt) - s0 : 0;
    const made = [...cur.matchAll(/stage-load (\w+)/g)].map((m) => m[1]);
    const blocked = [...cur.matchAll(/stage-load (\w+) (\d+)ms/g)].map((m) => `${m[1]} ${m[2]}`).join(", ");
    loadStats[kind] = { ready: s1 - s0, allOn: Math.max(allOn, s1 - s0), made: made.length };
    console.log(`  load ${kind.padEnd(8)} ${String(made.length).padStart(2)} stages (${made.join(" ")}): chain on ${s1 - s0} ms after the first code load started; every module stage switched in after ${loadStats[kind].allOn} ms (main thread blocked per stage: ${blocked})`);
}
check(loadStats.empty.allOn < 1200, `empty device: DSP ready ${loadStats.empty.allOn} ms after the first code load (< 1200)`);
check(loadStats.typical.ready < 1200, `typical 6-module glitch: the chain is on ${loadStats.typical.ready} ms after the first code load (head + tail first, < 1200)`);
check(loadStats.typical.allOn < 2600, `typical 6-module glitch without spectral ops: every module on ${loadStats.typical.allOn} ms after the first code load (< 2600)`);
check(loadStats.spectral.allOn < 4200, `the same plus the spectral stage: every stage on ${loadStats.spectral.allOn} ms after the first code load (< 4200)`);
check(loadStats.all.allOn < 7000, `every module: all on after ${loadStats.all.allOn} ms`);
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

// lazy stages: a glitch without spectral ops never loads the spectral code; a spectral one loads it, and loading (a hot code swap into the saved
// shell gen~, no object or cord is added) does not interrupt the audio
{
    const SC = GSC;
    const traceLines = () => trace().split("\n");
    const ring = () => { const a = evalLom(`return new Buffer(${JSON.stringify(scope)}).peek(1, ${SC.WAVE_OUT}, 129);`); return { out: a.slice(0, 64), inn: evalLom(`return new Buffer(${JSON.stringify(scope)}).peek(1, ${SC.WAVE_IN}, 64);`), head: a[64] }; };
    // the longest run of consecutive SILENT output blocks (256 samples; out < 0.02 while the input is > 0.1) in the newest 62 blocks of the ring.
    // (The test clip's loop seam only dips the level to 0.3 - 0.56 of the input; it is never silent.) The ring is written per processed audio sample,
    // so a stall of the audio thread does not show in it: that is what test_watch measures (the tail's tick counter against the wall clock).
    const silentRun = () => {
        const r = ring();
        let best = 0, run = 0;
        for (let k = 1; k < 63; k++) { const i = (r.head + k) % 64; if (r.inn[i] > 0.1 && r.out[i] < 0.02) { run++; best = Math.max(best, run); } else run = 0; }
        return best;
    };
    const watched = (ms) => { const m = trace().split("\n").filter((l) => /watch audio time lost/.test(l)).pop(); const n = m && m.match(/lost (-?\d+) ms in (\d+) ms/); return n && Number(n[2]) >= ms - 100 ? Number(n[1]) : null; };
    const waitWatch = (ms) => { for (let i = 0; i < 80; i++) { const w = watched(ms); if (w !== null) return w; sleep(100); } return null; };
    clearTrace();
    debug("test_watch", 3000);
    debug("test_fill");
    for (let i = 0; i < 60 && report().stages.drvA !== "on"; i++) sleep(150);
    const lostFill = waitWatch(3000);
    check(report().stages.spec === "none" && !traceLines().some((l) => /stage-load spec|stage-lazy spec/.test(l)), "non-spectral glitches (test_fill: drive, low pass) never load the spectral code");
    check(report().stages.drvA === "on" && NONHT.filter((k) => k !== "drvA").every((k) => report().stages[k] === "none"), "... only the stage that holds their module (drvA) has code");
    check(lostFill !== null && lostFill < 60, `loading a module's code (drvA, lazily) loses ${lostFill} ms of audio (< 60 ms; creating a gen~ object instead lost 100 - 690 ms, measured)`);
    debug("test_spec", "off");
    sleep(800);
    check(silentRun() === 0, "steady tone through the stand-in delay: no silent block");
    // the transparent spectral glitch: its code is loaded into the shell (main thread busy ~1 s, the audio is not), then the chain is switched onto it
    // (a message: no graph change) and `go 1` starts it
    const events = [];
    clearTrace();
    debug("test_watch", 6000);
    const tStartSpec = Date.now();
    debug("test_spec", "quiet");
    let st = "none", lastSt = "";
    let maxRun = 0;
    while (Date.now() - tStartSpec < 14000) {
        const run = silentRun();
        maxRun = Math.max(maxRun, run);
        st = report().stages.spec;
        if (st !== lastSt) { events.push(`${Date.now() - tStartSpec}ms ${st}`); lastSt = st; }
        if (st === "on" && Date.now() - tStartSpec > 3500) break;
        sleep(40);
    }
    const lostSpec = waitWatch(6000);
    console.log("  lazy spectral stage timeline: " + events.join(" | ") + ` ; audio lost ${lostSpec} ms, longest silent run in the output ring ${maxRun} blocks`);
    check(st === "on", `a spectral glitch loads the spectral code and switches onto it (state ${st}, ${Date.now() - tStartSpec} ms)`);
    const tl = traceLines();
    const stampOf = (ev) => { const l = tl.find((x) => new RegExp(ev).test(x)); const m = l && l.match(/^\+(\d+)ms/); return m ? Number(m[1]) : null; };
    const tc = stampOf("stage-lazy spec"), tr2 = stampOf("stage-run spec"), ton = stampOf("stage-on spec");
    check(tc !== null && tr2 !== null && ton !== null && tc <= tr2 && tr2 <= ton, `trace: stage-lazy spec +${tc} ms, stage-run spec +${tr2} ms, stage-on spec +${ton} ms`);
    if (tc !== null && ton !== null) console.log(`  SPECTRAL  queued -> running ${tr2 - tc} ms, -> switched on ${ton - tc} ms; ${(tl.find((x) => /stage-load spec/.test(x)) || "").replace(/^\+\d+ms /, "")}`);
    check(lostSpec !== null && lostSpec < 60, `loading the spectral code and switching onto it loses ${lostSpec} ms of audio (< 60 ms)`);
    check(maxRun === 0, `no silent output block while the spectral gen~ is loaded and swapped in (${maxRun})`);
    sleep(600);
    const a2 = evalLom(`return new Buffer(${JSON.stringify(scope)}).peek(1, 0, ${SC.END});`);
    check(a2[SC.SPEC_RUN] === 1 && a2[SC.SPEC_FRAMES] > 20, `the STFT runs after the swap (frames ${a2[SC.SPEC_FRAMES]})`);
    const dgx = (() => { debug("dsp_diag"); sleep(300); return trace().split("\n").filter((l) => /dsp-diag/.test(l)).pop() || ""; })();
    check(/stage spec:gen~:code cnt=\d+ run=1 on=1 in=[1-9]\d* out=[1-9]/.test(dgx), "dsp_diag: the spectral stage has its code, runs and is wired");
    check(a2[SC.STAGE_FRAME + SIDX("spec")] > 0, "the spectral stage's frame counter moves");
    debug("test_fill");
    sleep(800);
}

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
for (let round = 0; round < 6 && !sm.some((t) => t.glide < 0.95); round++) sm = sm.concat(seqSamples(10, 90)); // a fade is only visible while a step changes slot
const gl = sm.map((t) => Math.abs(t.glide - Math.min(1, t.frac / 0.5)));
check(Math.max(...gl) < 0.06 && sm.some((t) => t.glide < 0.95), `Glide 50 % via the LOM: crossfade progress = fraction / 0.5 in the gen (max error ${Math.max(...gl).toFixed(3)}, ${sm.filter((t) => t.glide < 0.95).length} of ${sm.length} samples mid-fade)`);
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

// ---------------------------------------------------------------------------------------------------------------------------------------
// INSTANCE ISOLATION: instance A (the one tested above) and instance B on the other track. Every per-instance buffer / receive is a `---` name
// (Live expands it per device instance); with a literal #0- both instances shared slots / scope / ctl and clobbered each other.
// ---------------------------------------------------------------------------------------------------------------------------------------
if (found.length >= 2 && INST === 0) {
    console.log("\n--- instance isolation: two Glitch instances ---");
    const A = me;
    const bDev = found[1];
    const bKey = hookKey(bDev.id, 30000);
    if (!check(!!bKey && bKey !== A.key, `instance B has its own hook name (A ${A.key}, B ${bKey})`)) finish();
    const B = mkInst(bKey);
    const waitReady = (I, label) => { // the trace keeps only its newest 160 lines, so ask the instance (test_report.ready)
        const t = Date.now();
        while (Date.now() - t < DSP_WAIT_MS) { const r = I.report(); if (r.err) return bail(`${label}: dsp-error ${r.err}`); if (r.ready === 1) return true; sleep(300); }
        return bail(`${label}: not ready`);
    };
    waitReady(A, "A"); waitReady(B, "B");
    check(true, "both instances reached DSP ready");
    const diagScope = (I) => { I.debug("dsp_diag"); sleep(300); return ((I.trace().split("\n").filter((l) => /dsp-diag/.test(l)).pop() || "").match(/scope=(\S+)/) || [])[1]; };
    const scA = diagScope(A), scB = diagScope(B);
    check(!!scA && !!scB && scA !== scB, `the two instances bind different scope buffers (A ${scA}, B ${scB})`);
    check(!/#0/.test(scA + scB) && !/^---/.test(scA + scB), "scope buffer names are expanded per-instance names");
    const pathB = `live_set tracks ${bDev.track} devices ${bDev.device}`;
    const paramsB = evalLom(`
        var dv = new LiveAPI(${JSON.stringify(pathB)}); var ids = dv.get("parameters"); var out = {};
        for (var i = 0; i + 1 < ids.length; i += 2) { var p = new LiveAPI("id " + ids[i + 1]); out[String(p.get("name"))] = Number(ids[i + 1]); }
        return out;`);
    const setPB = (name, v) => evalLom(`new LiveAPI("id ${paramsB[name]}").set("value", ${v}); return 1;`);
    const bufPeaks = (sc, ms) => {
        let pin = 1e-6, pout = 0;
        const t = Date.now();
        while (Date.now() - t < ms) { const a = evalLom(`return new Buffer(${JSON.stringify(sc)}).peek(1, 2, 2);`); pin = Math.max(pin, a[0]); pout = Math.max(pout, a[1]); sleep(40); }
        return { in: pin, out: pout, db: db(pout) - db(pin) };
    };
    const levelOf = (track, ms) => { let m = 0; const t = Date.now(); while (Date.now() - t < ms) { m = Math.max(m, Number(evalLom(`return new LiveAPI("live_set tracks ${track}").get("output_meter_left");`))); sleep(60); } return m; };
    const fireClip = (track) => evalLom(`
        var slot = new LiveAPI("live_set tracks ${track} clip_slots 0");
        if (Number(slot.get("has_clip")) === 0) slot.call("create_audio_clip", ${JSON.stringify(WAV)});
        var clip = new LiveAPI("live_set tracks ${track} clip_slots 0 clip");
        clip.set("looping", 1); try { clip.set("launch_quantization", 0); } catch (e) {}
        slot.call("fire"); return "ok";`);
    check(fireClip(dev.track) === "ok" && fireClip(bDev.track) === "ok", "the test clip plays on both tracks");
    setP("Mix", 0); setPB("Mix", 0);
    sleep(1500);
    const dryA = levelOf(dev.track, 1000), dryB = levelOf(bDev.track, 1000);
    check(dryA > 0.05 && dryB > 0.05, `both tracks carry the clip dry (track meters A ${dryA.toFixed(3)}, B ${dryB.toFixed(3)})`);
    const pkDryA = bufPeaks(scA, 600), pkDryB = bufPeaks(scB, 600);
    check(Math.abs(pkDryA.db) < 2.5 && Math.abs(pkDryB.db) < 2.5, `Mix 0 on both: out = in (A ${pkDryA.db.toFixed(1)} dB, B ${pkDryB.db.toFixed(1)} dB)`);

    // different glitches: A = loud drive (no spectral code), B = Width / Gain with a synced LFO (no spectral code either)
    A.debug("test_fill"); B.debug("test_move");
    sleep(2500);
    const rA0 = A.report(), rB0 = B.report();
    check(rA0.tiles.join() !== rB0.tiles.join(), `different glitches: A tiles ${rA0.tiles.join(",")} vs B tiles ${rB0.tiles.join(",")}`);
    check(rB0.stages.spec === "none" && !B.trace().split("\n").some((l) => /stage-lazy spec/.test(l)), `B has no spectral code yet (A\'s spec stage is "${rA0.stages.spec}": the checks above loaded it there)`);
    check(rA0.stages.drvA === "on" && rB0.stages.drvA !== "on" && rB0.stages.wid === "on", `stages follow each instance's own glitch (A drvA ${rA0.stages.drvA}, B drvA ${rB0.stages.drvA} / wid ${rB0.stages.wid})`);

    // hot-load the spectral stage in B while watching A: A's stages, counter, trace and level must not notice
    const aStagesBefore = JSON.stringify(rA0.stages);
    setPB("Mix", 100); setP("Mix", 100);
    sleep(800);
    const pkA0 = bufPeaks(scA, 700);
    A.clearTrace(); B.clearTrace();
    const frames = [];
    const tH = Date.now();
    B.debug("test_p4", "spec");
    let bSpec = "none", aMin = Infinity, aMax = 0;
    while (Date.now() - tH < 14000) {
        const ca = evalLom(`var v = new Buffer(${JSON.stringify(scA)}).peek(1, 0, 1); return typeof v === "number" ? v : v[0];`);
        frames.push([Date.now() - tH, ca]);
        const o = bufPeaks(scA, 120); aMin = Math.min(aMin, o.out); aMax = Math.max(aMax, o.out);
        bSpec = B.report().stages.spec;
        if (bSpec === "on" && Date.now() - tH > 3500) break;
    }
    check(bSpec === "on", `B hot-loaded its spectral stage (${Date.now() - tH} ms)`);
    let worstGap = 0;
    for (let i = 1; i < frames.length; i++) worstGap = Math.max(worstGap, frames[i][0] - frames[i - 1][0]);
    check(frames.length > 5 && frames.every((f, i) => i === 0 || f[1] !== frames[i - 1][1]), `A's telemetry frame counter kept advancing during B's load (${frames[0][1]} -> ${frames[frames.length - 1][1]}, ${frames.length} reads)`);
    const rA1 = A.report();
    check(JSON.stringify(rA1.stages) === aStagesBefore, `A's stages are unchanged by B's hot load (spec ${rA1.stages.spec} before and after)`);
    check(!A.trace().split("\n").some((l) => /stage-load|stage-lazy|stage-run|stage-on/.test(l)), "A's trace has no stage load events while B loaded");
    check(B.trace().split("\n").some((l) => /stage-lazy spec/.test(l)), "B's trace shows the spectral stage loading");
    check(aMin > pkA0.out * 0.5 && aMax < pkA0.out * 2 + 0.01, `A's output level stayed put while B loaded (${pkA0.out.toFixed(3)}; window ${aMin.toFixed(3)}..${aMax.toFixed(3)})`);
    check(rA1.tiles.join() === rA0.tiles.join(), "A's glitch (tiles) is unchanged");
    const aS = evalLom(`return new Buffer(${JSON.stringify(scA)}).peek(1, 0, ${GSC.END});`);
    const bS = evalLom(`return new Buffer(${JSON.stringify(scB)}).peek(1, 0, ${GSC.END});`);
    check(bS[GSC.SPEC_RUN] === 1 && bS[GSC.SPEC_FRAMES] > 20 && aS[GSC.SPEC_RUN] === 0, `telemetry differs: B's STFT runs (frames ${bS[GSC.SPEC_FRAMES]}), A's does not (run ${aS[GSC.SPEC_RUN]})`);
    check(Math.abs(aS[GSC.OUT_PEAK] - bS[GSC.OUT_PEAK]) > 1e-4 || aS.some((v, i) => v !== bS[i]), "the two scope buffers hold different data");

    // each track's output reflects only its own glitch: Mix 0 on one gives that track's dry level while the other stays wet
    sleep(800);
    setP("Mix", 0); setPB("Mix", 100);
    sleep(1200);
    const a0 = bufPeaks(scA, 800), b100 = bufPeaks(scB, 800);
    const mA = levelOf(dev.track, 900), mB = levelOf(bDev.track, 900);
    console.log(`  A Mix 0: ${a0.db.toFixed(1)} dB vs dry, meter ${mA.toFixed(3)} (dry ${dryA.toFixed(3)}); B Mix 100: ${b100.db.toFixed(1)} dB vs dry, meter ${mB.toFixed(3)} (dry ${dryB.toFixed(3)})`);
    check(Math.abs(a0.db) < 2.5, `A at Mix 0 is its dry level (${a0.db.toFixed(1)} dB) while B is wet`);
    check(Math.abs(b100.db) > 1.5 || Math.abs(mB / dryB - 1) > 0.2, `B stays wet while A is dry (${b100.db.toFixed(1)} dB; track meter ${mB.toFixed(3)} vs dry ${dryB.toFixed(3)})`);
    check(Math.abs(mA / dryA - 1) < 0.25, `A's track meter is its dry level (${mA.toFixed(3)} vs ${dryA.toFixed(3)})`);
    setP("Mix", 100); setPB("Mix", 0);
    sleep(1200);
    const a100 = bufPeaks(scA, 800), b0 = bufPeaks(scB, 800);
    const mA2 = levelOf(dev.track, 900), mB2 = levelOf(bDev.track, 900);
    console.log(`  A Mix 100: ${a100.db.toFixed(1)} dB, meter ${mA2.toFixed(3)}; B Mix 0: ${b0.db.toFixed(1)} dB, meter ${mB2.toFixed(3)}`);
    check(Math.abs(b0.db) < 2.5 && Math.abs(mB2 / dryB - 1) < 0.25, `B at Mix 0 is its dry level (${b0.db.toFixed(1)} dB) while A is wet`);
    check(Math.abs(a100.db) > 1.5 || Math.abs(mA2 / dryA - 1) > 0.2, `A stays wet while B is dry (${a100.db.toFixed(1)} dB)`);
    setPB("Mix", 100);
    evalLom(`new LiveAPI("live_set tracks ${bDev.track} clip_slots 0").call("stop"); return 1;`);
}

// leave the clip stopped
evalLom(`new LiveAPI("live_set tracks ${dev.track} clip_slots 0").call("stop"); return 1;`);
finish();
