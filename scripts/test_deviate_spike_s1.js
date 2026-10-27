#!/usr/bin/env node
/**
 * Spike S1 live checks for Deviate (DEVIATE_PLAN.md, scripts/deviate_faces/README.md "Spike S1"). Through the MCP bridge (--port) and,
 * for (b), real OS input in the VM (--ssh, scripts/mm_os_input.py). Live runs only in the VM (AGENTS.md 1a):
 *   M4L_VM_DIR=deviate/spike scripts/vm_deviate.sh spike      (see vm_deviate.sh)
 *
 *   --phase adde        (a) blob persistence across duplicate_track, (d) MIDI From, (e) momentary Reroll          (needs "Deviate Stub")
 *   --phase prep        show the "Deviate Under" device and print the Live window (for the click coordinates of (b))
 *   --phase b --ox X --oy Y   (b) real clicks on an ignoreclick canvas under live.* widgets; X, Y = screen point of the device's (0, 0)
 */
const { execFileSync } = require("child_process");
const path = require("path");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = arg("--port", null);
const PHASE = arg("--phase", "adde");
const SSH = arg("--ssh", null);          // admin@ip
const VM_DIR = arg("--vmdir", "ableton-deviate");
const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const S = { HITS: 2, DRAW_SERIAL: 3, REROLL: 8, METAS: 16, DRAWS: 24, ALIVE: 48 };

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    for (let attempt = 0; ; attempt++) {
        let txt;
        try { txt = execFileSync("node", args, { encoding: "utf8", maxBuffer: 1 << 26 }); } catch (e) { txt = String(e.stdout || ""); }
        let out = null;
        try { out = JSON.parse(txt); } catch (e) { /* retry */ }
        if (out && !out.error) return out.result;
        if (attempt >= 3) throw new Error(out ? out.error : "no answer from the bridge");
        sleep(1500);
    }
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function waitFor(fn, ms, step = 250) {
    const t0 = Date.now();
    for (;;) { let v; try { v = fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() - t0 > ms) return null; sleep(step); }
}
function os(...a) {
    const cmd = `cd ~/${VM_DIR} && /usr/bin/python3 scripts/mm_os_input.py ${a.join(" ")}`;
    return execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", SSH, cmd],
        { encoding: "utf8", env: Object.assign({ SSHPASS: "admin" }, process.env) }).trim();
}
let failures = 0;
function check(ok, msg) { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failures++; return ok; }
const info = (m) => console.log("INFO " + m);

const HELPERS = `
function g1(a, p) { var v = a.get(p); return (v && typeof v !== "string" && v.length !== undefined) ? v[0] : v; }
function pidx(path, name) {
    var n = new LiveAPI(path).getcount("parameters");
    for (var i = 0; i < n; i++) if (String(g1(new LiveAPI(path + " parameters " + i), "name")) === name) return i;
    return -1;
}`;
function discover() {
    return evalLom(`
        var out = [], n = new LiveAPI("live_set").getcount("tracks");
        for (var t = 0; t < n; t++) {
            var tr = new LiveAPI("live_set tracks " + t), nd = tr.getcount("devices");
            for (var d = 0; d < nd; d++) {
                var dv = new LiveAPI("live_set tracks " + t + " devices " + d), nm = String(dv.get("name"));
                if (/^Deviate /.test(nm)) out.push({ track: t, device: d, name: nm, id: String(dv.id), tname: String(tr.get("name")) });
            }
        }
        return out;`).map((d) => Object.assign(d, { path: `live_set tracks ${d.track} devices ${d.device}`, trackPath: `live_set tracks ${d.track}` }));
}
const hookMap = () => JSON.parse(String(evalLom('return new Global("deviate_hooks").map || "{}";')));
const traceText = () => String(evalLom('return new Global("deviate_trace").text || "";') || "");
const hook = (d, ...m) => evalLom(`messnamed(${JSON.stringify(hookMap()[d.id])}, ${m.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
function getG(key) { return JSON.parse(String(evalLom(`return new Global("deviate_test")[${JSON.stringify(key)}];`))); }
function report(d) { hook(d, "test_report"); sleep(400); return getG("report_" + d.id); }
function blob(d) { hook(d, "test_blob"); sleep(400); return getG("blob_" + d.id); }
const setParam = (d, name, v) => evalLom(HELPERS + `var i = pidx(${JSON.stringify(d.path)}, ${JSON.stringify(name)}); if (i < 0) return -1; new LiveAPI(${JSON.stringify(d.path)} + " parameters " + i).set("value", ${Number(v)}); return i;`);
const getParam = (d, name) => evalLom(HELPERS + `var i = pidx(${JSON.stringify(d.path)}, ${JSON.stringify(name)}); if (i < 0) return null; return Number(g1(new LiveAPI(${JSON.stringify(d.path)} + " parameters " + i), "value"));`);
const dspReady = (d, ms) => waitFor(() => traceText().split("\n").some((l) => /dsp ready/.test(l) && l.includes(`#${d.id} `)), ms, 500);
function showDevice(d) {
    evalLom(`var v = new LiveAPI("live_set view"), a = new LiveAPI("live_app view");
        a.call("hide_view", "Browser"); a.call("show_view", "Detail"); a.call("show_view", "Detail/DeviceChain");
        v.set("selected_track", "id", Number(new LiveAPI("live_set master_track").id)); return 1;`);
    sleep(1200);
    evalLom(`var v = new LiveAPI("live_set view"), a = new LiveAPI("live_app view");
        v.set("selected_track", "id", Number(new LiveAPI(${JSON.stringify(d.trackPath)}).id));
        v.call("select_device", "id", ${Number(d.id)});
        a.call("show_view", "Detail/DeviceChain"); a.call("focus_view", "Detail/DeviceChain"); return 1;`);
    sleep(1500);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function phaseADE() {
    const devs = discover();
    const stub = devs.find((d) => d.name === "Deviate Stub");
    if (!check(!!stub, "Deviate Stub found")) return;
    check(!!waitFor(() => hookMap()[stub.id], 30000), "hook registered");
    check(!!dspReady(stub, 60000), "Stub: dsp ready in Global(deviate_trace)");
    console.log(traceText().split("\n").filter((l) => l.includes(`#${stub.id} `)).join("\n"));

    // ---- (e) momentary Reroll through the LOM ----
    setParam(stub, "Chance", 100);
    sleep(500);
    const e0 = report(stub).scope;
    const idx = setParam(stub, "Reroll", 1);
    check(idx >= 0, `(e) Reroll parameter index ${idx}`);
    sleep(300);
    const v300 = getParam(stub, "Reroll");
    sleep(700);
    const v1000 = getParam(stub, "Reroll");
    const e1 = report(stub).scope;
    info(`(e) LOM Reroll value after set(1): ${v300} @0.3 s, ${v1000} @1 s; REROLL ${e0[S.REROLL]} -> ${e1[S.REROLL]}, DRAW_SERIAL ${e0[S.DRAW_SERIAL]} -> ${e1[S.DRAW_SERIAL]}`);
    check(e1[S.REROLL] === e0[S.REROLL] + 1, `(e) gen reroll counter incremented exactly once (${e0[S.REROLL]} -> ${e1[S.REROLL]})`);
    check(e1[S.DRAW_SERIAL] === e0[S.DRAW_SERIAL] + 1, `(e) one new draw (${e0[S.DRAW_SERIAL]} -> ${e1[S.DRAW_SERIAL]})`);
    info(`(e) a LOM set of 1 leaves the button value at ${v1000} (no automatic return to 0 through the LOM)`);
    setParam(stub, "Reroll", 0);
    sleep(300);
    setParam(stub, "Reroll", 1);
    sleep(800);
    const e2 = report(stub).scope;
    check(e2[S.REROLL] === e1[S.REROLL] + 1, `(e) second press counts again (${e1[S.REROLL]} -> ${e2[S.REROLL]}; Reroll value ${getParam(stub, "Reroll")})`);
    setParam(stub, "Reroll", 0);

    // ---- (d) MIDI From ----
    const midiT = devs.length && evalLom(`var n = new LiveAPI("live_set").getcount("tracks"); for (var t = 0; t < n; t++) if (/Deviate MIDI Src/.test(String(new LiveAPI("live_set tracks " + t).get("name")))) return t; return -1;`);
    if (check(midiT >= 0, "(d) MIDI source track present")) {
        const mt = `live_set tracks ${midiT}`;
        const made = evalLom(`var slot = new LiveAPI("${mt} clip_slots 0");
            if (Number(slot.get("has_clip")) === 0) slot.call("create_clip", 4);
            var clip = new LiveAPI("${mt} clip_slots 0 clip"); clip.set("looping", 1);
            var notes = [0, 1, 2, 3].map(function (b) { return { pitch: 60 + b, start_time: b, duration: 0.25, velocity: 100 }; });
            try { clip.call("add_new_notes", JSON.stringify({ notes: notes })); } catch (e) { return "add_new_notes: " + e; }
            return "ok";`);
        check(made === "ok", `(d) MIDI clip (${made})`);
        const routed = evalLom(`
            function g(a, p) { var v = a.get(p); return (v && typeof v !== "string" && v.length !== undefined) ? v[0] : v; }
            var io = new LiveAPI("${stub.path} midi_inputs 0");
            var types = JSON.parse(String(g(io, "available_routing_types"))).available_routing_types;
            var hit = types.filter(function (t) { return String(t.display_name) === "Deviate MIDI Src"; })[0];
            if (!hit) return "no type among " + types.map(function (t) { return t.display_name; }).join("|");
            var forms = [ { identifier: hit.identifier }, JSON.stringify({ identifier: hit.identifier }), JSON.stringify({ routing_type: { identifier: hit.identifier } }), hit.identifier ];
            for (var i = 0; i < forms.length; i++) {
                try { io.set("routing_type", forms[i]); } catch (e) { continue; }
                if (String(g(io, "routing_type")).indexOf("Deviate MIDI Src") >= 0) return "ok form " + i;
            }
            return "routing_type did not take";`);
        check(/^ok/.test(String(routed)), `(d) midi_inputs 0 routing_type set (${routed})`);
        const r0 = report(stub);
        evalLom(`new LiveAPI("${mt} clip_slots 0").call("fire"); return 1;`);
        sleep(4200);
        const r1 = report(stub);
        evalLom(`new LiveAPI("${mt}").call("stop_all_clips"); return 1;`);
        info(`(d) midi state ${JSON.stringify(r1.midi)}, mtrig ${r0.mtrig} -> ${r1.mtrig}, HITS ${r0.scope[S.HITS]} -> ${r1.scope[S.HITS]}`);
        check(r1.midi.hits > r0.midi.hits && r1.scope[S.HITS] > r0.scope[S.HITS], `(d) note-ons reached midiin: midi.hits ${r0.midi.hits} -> ${r1.midi.hits}, gen HITS ${r0.scope[S.HITS]} -> ${r1.scope[S.HITS]}`);
    }

    // ---- (a) blob across duplicate_track ----
    setParam(stub, "Chance", 100); setParam(stub, "Snap", 77); setParam(stub, "R Snap", 40);
    sleep(500);
    hook(stub, "test_hit"); sleep(400); hook(stub, "test_hit"); sleep(400);
    const A = blob(stub), RA = report(stub);
    info(`(a) original blob ${JSON.stringify(A.blob)}`);
    check(Array.isArray(A.blob) && A.blob.length > 4 && A.blob[1] === 1 && String(A.blob[0]) === String(A.blob[0]), `(a) original getvalueof valid (len ${A.blob.length}, valid flag ${A.blob[1]})`);
    sleep(1500); // the engine's 300 ms state poll calls notifyclients(), Live then reads getvalueof()
    evalLom(`new LiveAPI("live_set").call("duplicate_track", ${stub.track}); return 1;`);
    sleep(2000);
    const after = discover().filter((d) => d.name === "Deviate Stub");
    const clone = after.find((d) => d.id !== stub.id);
    if (!check(!!clone, `(a) clone device appeared (${after.map((d) => d.id + "@" + d.track).join(", ")})`)) return;
    check(!!waitFor(() => hookMap()[clone.id], 30000), "(a) clone registered its hook");
    check(!!dspReady(clone, 60000), "(a) clone dsp ready");
    sleep(1500);
    const B = blob(clone), RB = report(clone);
    info(`(a) clone blob    ${JSON.stringify(B.blob)}`);
    info(`(a) clone restored ${JSON.stringify(B.restored)}  original restored ${JSON.stringify(A.restored)}`);
    check(same(A.blob, B.blob), "(a) clone's blob equals the original's (getvalueof)");
    check(B.restored !== null && B.restored.valid === 1, `(a) clone ran setvalueof with a valid blob (restored.valid ${B.restored && B.restored.valid})`);
    const dr = RA.scope.slice(S.DRAWS, S.DRAWS + 8), dc = RB.scope.slice(S.DRAWS, S.DRAWS + 8);
    info(`(a) gen draws original ${JSON.stringify(dr)} clone ${JSON.stringify(dc)}; REROLL ${RA.scope[S.REROLL]} / ${RB.scope[S.REROLL]}; Snap param ${getParam(stub, "Snap")} / ${getParam(clone, "Snap")}`);
    check(same(dr.map((x) => Math.round(x * 100)), dc.map((x) => Math.round(x * 100))), "(a) the clone's gen holds the same 8 draws as the original");
    // leave the Set tidy: delete the clone track
    evalLom(`new LiveAPI("live_set").call("delete_track", ${clone.track}); return 1;`);
}

const LOOP = "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/Loops/Drums/Full/Hip Hop Doubled 145 bpm.wav";
function phaseE2() {   // diagnose the momentary Reroll / lock echo while the gen is awake and asleep
    const stub = discover().find((d) => d.name === "Deviate Stub");
    if (!check(!!stub, "Deviate Stub found")) return;
    check(!!waitFor(() => hookMap()[stub.id], 30000), "hook registered");
    let lastRep = null;
    const sc = () => { lastRep = report(stub); return lastRep.scope; };
    const row = (tag) => { const s = sc(); info(`  rr ${JSON.stringify(lastRep.rr)} front ${lastRep.frontN}`); info(`${tag}: ASLEEP ${s[7]} REROLL ${s[S.REROLL]} SERIAL ${s[S.DRAW_SERIAL]} echo reroll ${s[152]} locks ${s[144]} | LOM Reroll ${getParam(stub, "Reroll")}`); return s; };
    setParam(stub, "Reroll", 0); setParam(stub, "L Snap", 0);
    const lp = evalLom(`var slot = new LiveAPI(${JSON.stringify(stub.trackPath + " clip_slots 0")});
        if (Number(slot.get("has_clip")) === 0) slot.call("create_audio_clip", ${JSON.stringify(LOOP)});
        new LiveAPI(${JSON.stringify(stub.trackPath + " clip_slots 0 clip")}).set("looping", 1); slot.call("fire"); return "ok";`);
    info("loop " + lp);
    sleep(1500);
    row("awake, before");
    setParam(stub, "L Snap", 1); sleep(800); row("awake, L Snap=1");
    setParam(stub, "Reroll", 1); sleep(600); const a1 = row("awake, Reroll=1 (first value)");
    setParam(stub, "Reroll", 0); sleep(600); row("awake, Reroll=0");
    setParam(stub, "Reroll", 1); sleep(600); const a2 = row("awake, Reroll=1 (after a 0)");
    check(a2[S.REROLL] === a1[S.REROLL] + 1, `awake: 0 -> 1 edge counted (${a1[S.REROLL]} -> ${a2[S.REROLL]})`);
    setParam(stub, "Reroll", 0); sleep(300);
    evalLom(`new LiveAPI(${JSON.stringify(stub.trackPath)}).call("stop_all_clips"); return 1;`);
    sleep(7000);
    row("asleep, before");
    setParam(stub, "L Snap", 0); setParam(stub, "L Pitch", 1); sleep(800); row("asleep, L Pitch=1 (echo stale if asleep)");
    setParam(stub, "Reroll", 1); sleep(600); const b1 = row("asleep, Reroll=1");
    setParam(stub, "Reroll", 0); sleep(400);
    setParam(stub, "Reroll", 1); sleep(600); const b2 = row("asleep, Reroll 0 -> 1");
    check(b2[S.REROLL] === b1[S.REROLL] + 1, `asleep: 0 -> 1 edge counted (${b1[S.REROLL]} -> ${b2[S.REROLL]})`);
    setParam(stub, "Reroll", 0); setParam(stub, "L Pitch", 0);
}

function phasePrep() {
    const under = discover().find((d) => d.name === "Deviate Under");
    if (!check(!!under, "Deviate Under found")) return;
    check(!!dspReady(under, 60000), "Under: dsp ready");
    showDevice(under);
    if (SSH) { info("window " + os("window", "Live")); }
}

function phaseB() {
    const under = discover().find((d) => d.name === arg("--dev", "Deviate Under"));
    if (!check(!!under, "device found")) return;
    const ox = Number(arg("--ox", 248)), oy = Number(arg("--oy", 775));
    showDevice(under);
    os("front", "Live");
    sleep(500);
    // targets (device coordinates; Stub layout: strip block at (6, 8): Value dial 33 x 42 at col*36.. ; see the screenshot): lock toggle and a dial
    const t = JSON.parse(process.env.DEVIATE_TARGETS || arg("--targets", '{"lock":[23,74,"L Snap"],"dial":[18,33,"Snap"],"numbox":[23,58,"R Snap"],"globalDial":[390,32,"Chance"]}'));
    // t = {lock: [x, y, "L Snap"], dial: [x, y, "Snap"], numbox: [x, y, "R Snap"], globalDial: [x, y, "Chance"]}
    const rep = (n) => getParam(under, n);
    for (const [kind, spec] of Object.entries(t)) {
        const [x, y, name, dy = -30] = spec;
        const before = rep(name);
        if (kind === "lock") os("click", Math.round(ox + x), Math.round(oy + y));
        else os("drag", Math.round(ox + x), Math.round(oy + y), 0, dy);
        sleep(700);
        const after = rep(name);
        check(before !== after, `(b) ${kind} "${name}" at device (${x}, ${y}): LOM ${before} -> ${after}`);
    }
}

if (PHASE === "adde") phaseADE();
else if (PHASE === "e2") phaseE2();
else if (PHASE === "prep") phasePrep();
else if (PHASE === "b") phaseB();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
