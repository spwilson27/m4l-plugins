#!/usr/bin/env node
/**
 * Live end-to-end test for Deviate, driven through the Ableton MCP Bridge (`scripts/ableton_mcp_server.js`, `ableton_eval_lom_js`).
 * Needs deviate_test.als (scripts/make_deviate_set.py: one audio track per built face, an empty MIDI track "Deviate MIDI Src", the
 * bridge on Main). Live runs in the tart VM (AGENTS.md 1a): `scripts/vm_deviate.sh run` (live + test + shot under the Live lock).
 *
 *   node scripts/test_deviate_live.js --port 19882              all checks below, every Deviate device of the Set
 *   node scripts/test_deviate_live.js --port N --midi           also the MIDI From check (routes "Deviate MIDI Src" into the first device)
 *   node scripts/test_deviate_live.js --port N --shot <face>    only: show the face's track, fire a loop + test_hit, screenshot ->
 *                                                               previews/live/deviate_<face>.png (whole VM screen, not cropped)
 *   node scripts/test_deviate_live.js --port N --list-faces     print the faces found in the Set (lower case), one per line
 *
 * Checks: discover | dsp (<= 60 s, per instance, trace `[#<id>` tag) | report (face, geometry, latency attr, alive) | params (LOM names and
 * order equal across devices and to `build_deviate.py --dump-params`) | echo (LOM value -> gen ECHO slots) | hit (only the target's HITS /
 * DRAW_SERIAL move, draws within V +- R, locks hold, Chance 0 -> HIT_GATE 0) | reroll | split (Split Mode -> latency 1279 / 256) |
 * audio (Core Library drum loop: track meter > 0.02, HITS rise) | midi (only with --midi). Hook protocol: src/deviate_engine.js.
 * Everything that depends on the DSP effects (not only the stub's detector / draw / telemetry) is NOT asserted here.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(n);
const PORT = arg("--port", null);
const SHOT = arg("--shot", null);
const LOOP = process.env.DEVIATE_LOOP ||
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/Loops/Drums/Full/Hip Hop Doubled 145 bpm.wav";
// DV_SCOPE / DV_ECHO slots (src/deviate_config.js)
const S = { HITS: 2, DRAW_SERIAL: 3, SPLIT_MODE: 5, LATENCY: 6, REROLL: 8, METAS: 16, DRAWS: 24, HIT_GATE: 39, HIT_SRC: 40, ALIVE: 48, ECHO: 128 };
const E = { V: 0, R: 8, LOCKS: 16 };

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8", maxBuffer: 64 << 20 }));
    if (out.error) throw new Error(out.error);
    return out.result;
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function waitFor(fn, ms, step = 250) {
    const t0 = Date.now();
    for (;;) {
        let v;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return v;
        if (Date.now() - t0 > ms) return null;
        sleep(step);
    }
}
let failures = 0;
function check(ok, msg) { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failures++; return ok; }
function step(name, fn) {
    try { fn(); } catch (e) { check(false, `${name}: exception ${String(e && e.message || e).split("\n")[0]}`); }
}

const HELPERS = `
function g1(a, p) { var v = a.get(p); return (v && typeof v !== "string" && v.length !== undefined) ? v[0] : v; }
function pidx(path, name) {
    var n = new LiveAPI(path).getcount("parameters");
    for (var i = 0; i < n; i++) if (String(g1(new LiveAPI(path + " parameters " + i), "name")) === name) return i;
    return -1;
}
`;

// ---- discovery ------------------------------------------------------------------------------------------------------------------
function discover() {
    return evalLom(`
        var out = [], midi = -1;
        var n = new LiveAPI("live_set").getcount("tracks");
        for (var t = 0; t < n; t++) {
            var tr = new LiveAPI("live_set tracks " + t);
            if (/Deviate MIDI Src/.test(String(tr.get("name")))) midi = t;
            var nd = tr.getcount("devices");
            for (var d = 0; d < nd; d++) {
                var dv = new LiveAPI("live_set tracks " + t + " devices " + d);
                var nm = String(dv.get("name"));
                if (/^Deviate /.test(nm)) out.push({ track: t, device: d, name: nm, id: String(dv.id), cls: String(dv.get("class_name")) });
            }
        }
        return { devices: out, midi: midi };
    `);
}
const found = discover();
const devs = found.devices.map((d) => Object.assign(d, {
    face: d.name.replace(/^Deviate /, ""),
    path: `live_set tracks ${d.track} devices ${d.device}`,
    trackPath: `live_set tracks ${d.track}`,
}));
if (flag("--list-faces")) { devs.forEach((d) => console.log(d.face.toLowerCase())); process.exit(0); }

// ---- hook / report / trace / params helpers -------------------------------------------------------------------------------------
const hookMap = () => JSON.parse(String(evalLom('return new Global("deviate_hooks").map || "{}";')));
const traceText = () => String(evalLom('return new Global("deviate_trace").text || "";') || "");
const hook = (d, ...m) => evalLom(`messnamed(${JSON.stringify(d.hook)}, ${m.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
function report(d) {
    hook(d, "test_report");
    sleep(350);
    const r = JSON.parse(String(evalLom(`return new Global("deviate_test")["report_" + ${JSON.stringify(d.id)}];`)));
    return r;
}
const scope = (d) => report(d).scope;
function setParam(d, name, v) { return evalLom(HELPERS + `var i = pidx(${JSON.stringify(d.path)}, ${JSON.stringify(name)}); if (i < 0) return -1; new LiveAPI(${JSON.stringify(d.path)} + " parameters " + i).set("value", ${Number(v)}); return i;`); }
function getParam(d, name) { return evalLom(HELPERS + `var i = pidx(${JSON.stringify(d.path)}, ${JSON.stringify(name)}); if (i < 0) return null; return Number(g1(new LiveAPI(${JSON.stringify(d.path)} + " parameters " + i), "value"));`); }
function paramNames(d) {
    return evalLom(HELPERS + `
        var n = new LiveAPI(${JSON.stringify(d.path)}).getcount("parameters"), out = [];
        for (var i = 0; i < n; i++) out.push(String(g1(new LiveAPI(${JSON.stringify(d.path)} + " parameters " + i), "name")));
        return out;`);
}
const devLatency = (d) => Number(evalLom(`return Number(new LiveAPI(${JSON.stringify(d.path)}).get("latency_in_samples"));`));
function trackMeter(d, ms) {
    return Number(evalLom(`
        var t = new LiveAPI(${JSON.stringify(d.trackPath)}), m = 0, t0 = Date.now();
        while (Date.now() - t0 < ${ms}) { var v = Number(t.get("output_meter_left")); if (v > m) m = v; }
        return m;`));
}
function startLoop(d, loop) {
    return evalLom(`
        var slot = new LiveAPI(${JSON.stringify(d.trackPath + " clip_slots 0")});
        if (Number(slot.get("has_clip")) === 0) { try { slot.call("create_audio_clip", ${JSON.stringify(loop)}); } catch (e) { return "no create_audio_clip: " + e; } }
        if (Number(slot.get("has_clip")) === 0) return "clip not created";
        new LiveAPI(${JSON.stringify(d.trackPath + " clip_slots 0 clip")}).set("looping", 1);
        slot.call("fire");
        return "ok";`);
}
const stopTrack = (d) => evalLom(`new LiveAPI(${JSON.stringify(d.trackPath)}).call("stop_all_clips"); return 1;`);

// ---- screenshot mode ------------------------------------------------------------------------------------------------------------
function showDevice(d) {
    // a v8ui only paints once its track is shown in the Detail view: master track first, then the device's track (as test_megamod_faces_live.js)
    evalLom(`
        var v = new LiveAPI("live_set view"), a = new LiveAPI("live_app view");
        a.call("hide_view", "Browser"); a.call("show_view", "Detail"); a.call("show_view", "Detail/DeviceChain");
        v.set("selected_track", "id", Number(new LiveAPI("live_set master_track").id));
        return 1;`);
    sleep(1200);
    evalLom(`
        var v = new LiveAPI("live_set view"), a = new LiveAPI("live_app view");
        v.set("selected_track", "id", Number(new LiveAPI(${JSON.stringify(d.trackPath)}).id));
        v.call("select_device", "id", ${Number(d.id)});
        a.call("show_view", "Detail/DeviceChain"); a.call("focus_view", "Detail/DeviceChain");
        return 1;`);
    sleep(1500);
}
function attachHooks() {
    const m = waitFor(() => { const h = hookMap(); return devs.every((d) => h[d.id]) ? h : null; }, 30000);
    devs.forEach((d) => { d.hook = (m || hookMap())[d.id] || null; });
    return !!m;
}
if (SHOT) {
    const d = devs.find((x) => x.face.toLowerCase() === SHOT.toLowerCase());
    if (!d) { console.log(`FAIL no Deviate ${SHOT} device in the Set (${devs.map((x) => x.face).join(", ")})`); process.exit(1); }
    attachHooks();
    showDevice(d);
    const lp = startLoop(d, LOOP);
    if (lp !== "ok") console.log(`INFO loop not started (${lp})`);
    sleep(800);
    if (d.hook) hook(d, "test_hit");
    sleep(300);
    fs.mkdirSync(path.join(ROOT, "previews", "live"), { recursive: true });
    const out = path.join(ROOT, "previews", "live", `deviate_${d.face.toLowerCase()}.png`);
    try { execFileSync(path.join(__dirname, "vm_shot.sh"), [out], { encoding: "utf8" }); console.log("PASS screenshot " + out + " (whole VM screen; Read it, the device is in the Detail view at the bottom)"); }
    catch (e) { console.log("FAIL screenshot: " + String(e.message).split("\n")[0]); process.exit(1); }
    stopTrack(d);
    process.exit(0);
}

// ---- 1 discover -------------------------------------------------------------------------------------------------------------------
if (!check(devs.length > 0, `Deviate devices found: ${devs.map((d) => `${d.face} (track ${d.track}, ${d.cls})`).join(", ") || "none"}`)) process.exit(1);
step("hooks", () => check(attachHooks(), "every instance registered its hook name in Global(\"deviate_hooks\")"));
const live = devs.filter((d) => d.hook);
check(live.every((d) => !/#0|^---/.test(d.hook)), "hook names are expanded per-instance names");

// ---- 2 dsp ready ------------------------------------------------------------------------------------------------------------------
step("dsp", () => {
    for (const d of live) {
        const t0 = Date.now();
        let err = null;
        const ok = waitFor(() => {
            const lines = traceText().split("\n").filter((l) => l.includes(`[#${d.id} `) || l.includes(`#${d.id} `));
            if (lines.some((l) => /dsp-error/.test(l))) { err = lines.join("\n"); return true; }
            return lines.some((l) => /dsp ready/.test(l));
        }, 60000, 500);
        if (err) { check(false, `${d.face}: dsp-error\n--- trace ---\n${traceText()}`); d.broken = true; }
        else if (!check(!!ok, `${d.face}: dsp ready (${((Date.now() - t0) / 1000).toFixed(1)} s wait)`)) { console.log("--- trace ---\n" + traceText()); d.broken = true; }
    }
});
const run = live.filter((d) => !d.broken);

// ---- 3 report ---------------------------------------------------------------------------------------------------------------------
function amxdWidth(face) {
    const f = path.join(ROOT, "devices", `Deviate ${face}.amxd`);
    const j = JSON.parse(fs.readFileSync(f).subarray(32).toString("utf8").trim());
    return Number(j.patcher.devicewidth);
}
step("report", () => {
    for (const d of run) {
        const r = report(d);
        check(r.dsp === 1, `${d.face}: test_report dsp ready (${r.dsp}${r.dspError ? " " + r.dspError : ""})`);
        check(String(r.face).toLowerCase() === d.face.toLowerCase(), `${d.face}: report face "${r.face}"`);
        let w = NaN; try { w = amxdWidth(d.face); } catch (e) { /* no file on the host */ }
        if (!isNaN(w)) check(r.geom && r.geom.devicewidth === w, `${d.face}: devicewidth ${r.geom && r.geom.devicewidth} == amxd ${w}`);
        check(r.geom && r.geom.latencyAttr === 256, `${d.face}: latency attribute ${r.geom && r.geom.latencyAttr} == 256`);
        check(r.alive > 0, `${d.face}: gen alive counter ${r.alive}`);
        check(Array.isArray(r.scope) && r.scope.length >= 160, `${d.face}: scope header read (${r.scope && r.scope.length} floats)`);
    }
});

// ---- 4 parameter list -----------------------------------------------------------------------------------------------------------------
step("params", () => {
    const table = JSON.parse(execFileSync("python3", [path.join(__dirname, "build_deviate.py"), "--dump-params"], { encoding: "utf8", maxBuffer: 16 << 20 }));
    const want = ["Device On"].concat(table.filter((p) => !p.invisible).map((p) => p.short));
    const first = paramNames(live[0]);
    for (const d of live) {
        const names = paramNames(d);
        check(JSON.stringify(names) === JSON.stringify(first), `${d.face}: parameter names / order equal the first device's (${names.length})`);
    }
    // Live lists the parameters in its own order (not the table's), so compare as sets; the order only has to be the same in every device
    const sw = want.slice().sort(), sf = first.slice().sort();
    check(JSON.stringify(sf) === JSON.stringify(sw), `parameter list equals --dump-params as a set (${first.length} vs ${want.length})` +
        (JSON.stringify(sf) === JSON.stringify(sw) ? "" : `\n  live: ${first.join(", ")}\n  want: ${want.join(", ")}`));
});

// ---- helpers for the value checks ---------------------------------------------------------------------------------------------------
const defaults = {};
function snapshot(d) { defaults[d.id] = {}; for (const n of ["Snap", "R Snap", "Thresh", "Chance", "L Snap", "L Pitch", "Sens"]) defaults[d.id][n] = getParam(d, n); }
function restore(d) { for (const [n, v] of Object.entries(defaults[d.id] || {})) if (v !== null) setParam(d, n, v); }
run.forEach((d) => step("snapshot", () => snapshot(d)));

// ---- 5 LOM value -> gen echo --------------------------------------------------------------------------------------------------------
step("echo", () => {
    for (const d of run) {
        setParam(d, "Snap", 77); setParam(d, "R Snap", 12);
        hook(d, "test_hit"); sleep(300);   // the gen refreshes its echo block only while awake (asleep after 0.35 s of silence): a hit wakes it
        const ok = waitFor(() => { const s = scope(d); return Math.abs(s[S.ECHO + E.V] - 77) < 1e-3 && Math.abs(s[S.ECHO + E.R] - 12) < 1e-3 ? s : null; }, 1500, 300);
        const s = ok || scope(d);
        check(!!ok, `${d.face}: LOM Snap 77 / R Snap 12 reach the gen (echo ${s[S.ECHO + E.V]} / ${s[S.ECHO + E.R]})`);
        restore(d);
    }
});

// ---- 6 hit ------------------------------------------------------------------------------------------------------------------------
const clampd = (x) => Math.min(100, Math.max(0, x));
step("hit", () => {
    for (const d of run) { setParam(d, "Chance", 100); setParam(d, "R Snap", 50); }
    sleep(600);
    const before = new Map(run.map((d) => [d.id, scope(d)]));
    const target = run[0];
    hook(target, "test_hit");
    sleep(500);
    for (const d of run) {
        const a = before.get(d.id), b = scope(d);
        if (d === target) {
            check(b[S.HITS] === a[S.HITS] + 1, `${d.face}: test_hit -> HITS ${a[S.HITS]} -> ${b[S.HITS]}`);
            check(b[S.DRAW_SERIAL] === a[S.DRAW_SERIAL] + 1, `${d.face}: DRAW_SERIAL ${a[S.DRAW_SERIAL]} -> ${b[S.DRAW_SERIAL]}`);
            check(b[S.HIT_SRC] === 1, `${d.face}: HIT_SRC ${b[S.HIT_SRC]} == 1 (MIDI-source hit)`);
            let ok = true;
            for (let i = 0; i < 8; i++) {
                const V = b[S.ECHO + E.V + i], R = b[S.ECHO + E.R + i], x = b[S.DRAWS + i];
                if (x < clampd(V - R) - 0.05 || x > clampd(V + R) + 0.05) { ok = false; console.log(`  meta ${i}: draw ${x} outside ${clampd(V - R)}..${clampd(V + R)}`); }
            }
            check(ok, `${d.face}: the 8 draws lie within Value +- Range`);
        } else {
            check(b[S.HITS] === a[S.HITS] && b[S.DRAW_SERIAL] === a[S.DRAW_SERIAL], `${d.face}: unaffected by the other instance's hit (HITS ${b[S.HITS]}, serial ${b[S.DRAW_SERIAL]})`);
        }
    }
    // locks: L Snap + L Pitch hold their draws across the next hit (all ranges 50)
    setParam(target, "L Snap", 1); setParam(target, "L Pitch", 1);
    sleep(300);
    hook(target, "test_hit"); sleep(700);   // the gen refreshes its echo block only while awake (it sleeps after 0.35 s of silence): a hit wakes it
    const s0 = scope(target);
    check((s0[S.ECHO + E.LOCKS] & 3) === 3, `${target.face}: lock mask in the echo ${s0[S.ECHO + E.LOCKS]} has bits 0 and 1`);
    hook(target, "test_hit"); sleep(500);
    const s1 = scope(target);
    check(s1[S.DRAW_SERIAL] === s0[S.DRAW_SERIAL] + 1, `${target.face}: second hit drew (serial ${s1[S.DRAW_SERIAL]})`);
    check(s1[S.DRAWS] === s0[S.DRAWS] && s1[S.DRAWS + 1] === s0[S.DRAWS + 1], `${target.face}: locked metas unchanged (${s0[S.DRAWS]}, ${s0[S.DRAWS + 1]})`);
    check([2, 3, 4, 5, 6, 7].some((i) => s1[S.DRAWS + i] !== s0[S.DRAWS + i]), `${target.face}: an unlocked meta changed`);
    // Chance 0: the next hit is rejected
    setParam(target, "Chance", 0); sleep(700);
    hook(target, "test_hit"); sleep(500);
    const s2 = scope(target);
    check(s2[S.HIT_GATE] === 0 && s2[S.DRAW_SERIAL] === s1[S.DRAW_SERIAL] && s2[S.HITS] === s1[S.HITS] + 1,
        `${target.face}: Chance 0 -> HIT_GATE ${s2[S.HIT_GATE]}, serial unchanged ${s2[S.DRAW_SERIAL]}, HITS ${s2[S.HITS]}`);
    restore(target); setParam(target, "L Snap", 0); setParam(target, "L Pitch", 0);
});

// ---- 7 reroll ---------------------------------------------------------------------------------------------------------------------
step("reroll", () => {
    const d = run[0];
    setParam(d, "Chance", 100); sleep(400);
    const a = scope(d);
    hook(d, "test_reroll"); sleep(700);
    const b = scope(d);
    check(b[S.DRAW_SERIAL] === a[S.DRAW_SERIAL] + 1 && b[S.REROLL] === a[S.REROLL] + 1, `${d.face}: Reroll -> serial ${a[S.DRAW_SERIAL]} -> ${b[S.DRAW_SERIAL]}, REROLL ${a[S.REROLL]} -> ${b[S.REROLL]}`);
    check(b[S.HITS] === a[S.HITS], `${d.face}: Reroll leaves HITS unchanged (${b[S.HITS]})`);
});

// ---- 8 split mode -> latency ----------------------------------------------------------------------------------------------------------
step("split", () => {
    const d = run[0];
    check(devLatency(d) === 256, `${d.face}: Envelope split latency_in_samples ${devLatency(d)} == 256`);
    hook(d, "test_set", "split", 1);
    const up = waitFor(() => devLatency(d) === 1279, 2500, 250);
    check(!!up, `${d.face}: Split Mode 1 -> latency_in_samples ${devLatency(d)} == 1279 (within 2 s)`);
    check(waitFor(() => scope(d)[S.LATENCY] === 1279, 2000, 300) !== null, `${d.face}: telemetry LATENCY ${scope(d)[S.LATENCY]} agrees`);
    hook(d, "test_set", "split", 0);
    check(!!waitFor(() => devLatency(d) === 256, 2500, 250), `${d.face}: Split Mode 0 -> latency_in_samples ${devLatency(d)} == 256`);
    check(waitFor(() => scope(d)[S.LATENCY] === 256, 2000, 300) !== null, `${d.face}: telemetry LATENCY ${scope(d)[S.LATENCY]} == 256`);
});

// ---- 9 audio ----------------------------------------------------------------------------------------------------------------------
step("audio", () => {
    for (const d of run) {
        setParam(d, "Thresh", -50); setParam(d, "Chance", 100);
        const a = scope(d)[S.HITS];
        const lp = startLoop(d, LOOP);
        if (!check(lp === "ok", `${d.face}: drum loop clip playing (${lp})`)) continue;
        sleep(1500);
        const meter = trackMeter(d, 3000);
        const b = scope(d)[S.HITS];
        check(meter > 0.02, `${d.face}: track output meter ${meter.toFixed(3)} > 0.02`);
        check(b > a, `${d.face}: the audio detector counted hits (${a} -> ${b})`);
        stopTrack(d);
        restore(d);
    }
});

// ---- 10 midi (opt-in) -------------------------------------------------------------------------------------------------------------------
if (!flag("--no-midi")) step("midi", () => {
    if (!check(found.midi >= 0, "MIDI source track \"Deviate MIDI Src\" present")) return;
    const d = run[0], mt = `live_set tracks ${found.midi}`;
    const made = evalLom(`
        var slot = new LiveAPI("${mt} clip_slots 0");
        if (Number(slot.get("has_clip")) === 0) slot.call("create_clip", 4);
        var clip = new LiveAPI("${mt} clip_slots 0 clip");
        clip.set("looping", 1);
        var notes = [0, 1, 2, 3].map(function (b) { return { pitch: 60 + b, start_time: b, duration: 0.25, velocity: 100 }; });
        try { clip.call("add_new_notes", JSON.stringify({ notes: notes })); } catch (e) { return "add_new_notes: " + e; }
        return "ok";`);
    check(made === "ok", `MIDI clip created (${made})`);
    // the routing_type value form for set() is not documented for the Max JS LiveAPI: try the plausible ones until the read-back matches
    const routed = evalLom(`
        var io = new LiveAPI("${d.path} midi_inputs 0");
        var types = JSON.parse(String(g(io, "available_routing_types"))).available_routing_types;
        var hit = types.filter(function (t) { return String(t.display_name) === "Deviate MIDI Src"; })[0];
        if (!hit) return "no routing type named Deviate MIDI Src among " + types.map(function (t) { return t.display_name; }).join("|");
        function g(a, p) { var v = a.get(p); return (v && typeof v !== "string" && v.length !== undefined) ? v[0] : v; }
        var forms = [ { identifier: hit.identifier }, JSON.stringify({ identifier: hit.identifier }), JSON.stringify({ routing_type: { identifier: hit.identifier } }), hit.identifier ];
        for (var i = 0; i < forms.length; i++) {
            try { io.set("routing_type", forms[i]); } catch (e) { continue; }
            var cur = String(g(io, "routing_type"));
            if (cur.indexOf("Deviate MIDI Src") >= 0) return "ok form " + i;
        }
        return "routing_type did not take any form";`);
    check(/^ok/.test(String(routed)), `${d.face}: MIDI From routed from the MIDI track (${routed})`);
    if (!/^ok/.test(String(routed))) return;
    const a = scope(d)[S.HITS];
    evalLom(`new LiveAPI("${mt} clip_slots 0").call("fire"); return 1;`);
    sleep(3500);
    const s = scope(d), r = report(d);
    check(s[S.HITS] > a, `${d.face}: MIDI notes counted as hits (${a} -> ${s[S.HITS]}, midi.hits ${r.midi && r.midi.hits})`);
    evalLom(`new LiveAPI("${mt}").call("stop_all_clips"); return 1;`);
});

run.forEach((d) => step("restore", () => restore(d)));
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
