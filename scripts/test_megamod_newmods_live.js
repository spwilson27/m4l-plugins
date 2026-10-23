#!/usr/bin/env node
/**
 * Mega Modulator XY, Buttons and the threshold-triggered ADSR in REAL Ableton Live (VM only, AGENTS.md 1a; section 21).
 *
 *   scripts/vm_live_lock.sh megamod-newmods -- zsh -c 'FORCE=1 scripts/vm_megamod_keys.sh live && scripts/vm_megamod_keys.sh run scripts/test_megamod_newmods_live.js'
 *
 * Through the bridge (LOM + `receive megamod-test` hooks), on a scratch track with a Live Delay:
 *   A. XY: X -> Delay "Feedback" and Y -> Delay "Dry/Wet" (two REMOTE mappings 0..1 from the two OUTPUTS of one modulator, each learned with its own output).
 *      Moving X moves only Feedback, moving Y moves only Dry/Wet, and both follow the pad values.
 *   B. Buttons: button 1 -> "Filter Freq", button 2 -> "Filter Width": toggled independently; a slew makes the toggle ramp.
 *   C. ADSR, Trig = Threshold, on a real audio clip of tone bursts (3 s loud, 3 s below the threshold, 3 s loud) played on the Mega Mod Keys track: the envelope fires on a loud burst, runs attack -> decay -> sustain,
 *      releases after the burst, and a burst below the threshold does not fire it.
 * Prints verbatim PASS / FAIL lines. Exit status is non-zero when a check fails.
 */
const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const PORT = Number(arg("--port", 0)) || null;
const SSH = arg("--ssh", "");
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

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
        if (attempt >= 3 || (out && !/timed out/.test(out.error))) throw new Error(out ? out.error : "no answer from the bridge");
        sleep(2000);
    }
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
            if (String(d.get("name")) === "Mega Modulator") out.push({ id: String(d.id), path: tp + " devices " + i, track: t, trackName: String(tr.get("name")) });
        }
    }
    return out;
`);
if (!found.length) { console.error("No Mega Modulator in the set. Run scripts/vm_megamod_keys.sh live first."); process.exit(1); }
const dev = found.find((d) => d.trackName === "Mega Mod Keys") || found[0];
info(`device ${dev.id} at ${dev.path}`);
const hook = (...a) => evalLom(`messnamed("megamod-test", ${a.map((x) => JSON.stringify(x)).join(", ")}); return 1;`);
function globalJson(prop, hookName, ...hargs) {
    const raw = evalLom(`
        var g = new Global("megamod_test");
        g[${JSON.stringify(prop + "_" + dev.id)}] = "";
        messnamed("megamod-test", ${JSON.stringify(hookName)}${hargs.map((x) => ", " + JSON.stringify(x)).join("")});
        var r = g[${JSON.stringify(prop + "_" + dev.id)}];
        return r ? String(r) : "";
    `);
    return raw ? JSON.parse(raw) : null;
}
const report = () => globalJson("report", "test_report");
const midiRep = () => { sleep(150); return globalJson("midi", "test_midi"); };

const P = (devPath, name) => evalLom(`
    var d = new LiveAPI(${JSON.stringify(devPath)});
    var n = d.getcount("parameters");
    for (var i = 0; i < n; i++) {
        var p = new LiveAPI(${JSON.stringify(devPath)} + " parameters " + i);
        if (String(p.get("name")) === ${JSON.stringify(name)}) return { id: Number(p.id), idx: i, path: ${JSON.stringify(devPath)} + " parameters " + i,
            min: Number(p.get("min")), max: Number(p.get("max")), value: Number(p.get("value")) };
    }
    return null;
`);
const norm = (pr) => { const v = evalLom(`return Number(new LiveAPI(${JSON.stringify(pr.path)}).get("value"));`); return (v - pr.min) / (pr.max - pr.min); };
function cleanup() {
    const r = report();
    if (!r) return;
    for (const m of r.mappings) hook("test_delmap", m.id);
    for (let i = 0; i < r.mods.length; i++) if (r.mods[i]) { hook("test_remove", i); sleep(250); }
    sleep(800);
}

(function main() {
    cleanup();
    const scratch = evalLom(`
        var set = new LiveAPI("live_set");
        set.call("create_audio_track", -1);
        var n = set.getcount("tracks") - 1;
        var tp = "live_set tracks " + n;
        var tr = new LiveAPI(tp);
        tr.set("name", "MM Scratch");
        tr.call("insert_device", "Delay");
        return { track: n, path: tp + " devices 0" };
    `);
    const fb = P(scratch.path, "Feedback"), dw = P(scratch.path, "Dry/Wet"), ff = P(scratch.path, "Filter Freq"), fw = P(scratch.path, "Filter Width");
    info(`Delay parameters: Feedback ${fb && fb.id}, Dry/Wet ${dw && dw.id}, Filter Freq ${ff && ff.id}, Filter Width ${fw && fw.id}`);
    // (a learn ignores a selection equal to the previous one: the throw-away learns below select another parameter first)

    // ================= A. XY: independent X and Y mappings
    hook("test_add", 7); sleep(700);
    hook("test_setparam", 0, "x", 0.2); hook("test_setparam", 0, "y", 0.8); hook("test_setparam", 0, "slew", 0);
    sleep(500);
    hook("test_learn", 0, ff.id, 0); sleep(900);                 // a throw-away learn so the next selections count as changes
    for (const m of report().mappings) hook("test_delmap", m.id);
    sleep(400);
    hook("test_learn", 0, fb.id, 0); sleep(900);                 // X (output A) -> Feedback
    hook("test_learn", 0, dw.id, 1); sleep(900);                 // Y (output B) -> Dry/Wet
    let r = report();
    const mx = r.mappings.filter((m) => m.mod === 0 && !m.internal && m.out === 0)[0];
    const my = r.mappings.filter((m) => m.mod === 0 && !m.internal && m.out === 1)[0];
    check("XY: X and Y are two mappings of one modulator (outputs 0 and 1)", !!mx && !!my, JSON.stringify(r.mappings.map((m) => ({ id: m.id, mod: m.mod, out: m.out, pid: m.pid }))));
    if (!mx || !my) { console.log("FAILED"); process.exit(1); }
    check("XY: X -> Feedback, Y -> Dry/Wet", mx.pid === fb.id && my.pid === dw.id, `${mx.pid} / ${my.pid}`);
    check("XY: the two pool slots route from engine signals 0 (X) and 1 (Y)", mx.route === 0 && my.route === 1, `${mx.route} / ${my.route}`);
    for (const m of [mx, my]) { hook("test_mapupd", m.id, "mode", "remote"); hook("test_mapupd", m.id, "min", 0); hook("test_mapupd", m.id, "max", 1); hook("test_mapupd", m.id, "depth", 1); }
    sleep(1500);
    let a = norm(fb), b = norm(dw);
    check("XY: X = 0.2, Y = 0.8 -> Feedback 0.2, Dry/Wet 0.8", Math.abs(a - 0.2) < 0.03 && Math.abs(b - 0.8) < 0.03, `Feedback ${a.toFixed(3)}, Dry/Wet ${b.toFixed(3)}`);
    hook("test_setparam", 0, "x", 0.9); sleep(900);
    let a2 = norm(fb), b2 = norm(dw);
    check("XY: moving X moves only Feedback", Math.abs(a2 - 0.9) < 0.03 && Math.abs(b2 - b) < 0.02, `Feedback ${a2.toFixed(3)}, Dry/Wet ${b2.toFixed(3)} (was ${b.toFixed(3)})`);
    hook("test_setparam", 0, "y", 0.1); sleep(900);
    let a3 = norm(fb), b3 = norm(dw);
    check("XY: moving Y moves only Dry/Wet", Math.abs(b3 - 0.1) < 0.03 && Math.abs(a3 - a2) < 0.02, `Feedback ${a3.toFixed(3)}, Dry/Wet ${b3.toFixed(3)}`);
    hook("test_setparam", 0, "x", 0.5); hook("test_setparam", 0, "y", 0.5); sleep(900);
    check("XY: both at the centre", Math.abs(norm(fb) - 0.5) < 0.03 && Math.abs(norm(dw) - 0.5) < 0.03, `${norm(fb).toFixed(3)} / ${norm(dw).toFixed(3)}`);
    // the Live parameters of the pad (M1 A = X, M1 B = Y) move the same mappings
    const mega = (nm) => P(dev.path, nm);
    const m1a = mega("M1 A"), m1b = mega("M1 B");
    evalLom(`new LiveAPI(${JSON.stringify(m1a.path)}).set("value", 100); return 1;`); sleep(900);
    check("XY: automating the X parameter (M1 A = 100 %) drives Feedback to 1.0 and leaves Dry/Wet", norm(fb) > 0.97 && Math.abs(norm(dw) - 0.5) < 0.03, `${norm(fb).toFixed(3)} / ${norm(dw).toFixed(3)}`);
    evalLom(`new LiveAPI(${JSON.stringify(m1b.path)}).set("value", 0); return 1;`); sleep(900);
    check("XY: automating the Y parameter (M1 B = 0 %) drives Dry/Wet to 0.0 and leaves Feedback", norm(dw) < 0.03 && norm(fb) > 0.97, `${norm(fb).toFixed(3)} / ${norm(dw).toFixed(3)}`);
    cleanup();

    // ================= B. Buttons
    hook("test_add", 8); sleep(700);
    hook("test_setparam", 0, "sync", 0); hook("test_setparam", 0, "bipolar", 0); hook("test_setparam", 0, "slew", 0); sleep(500);
    hook("test_learn", 0, dw.id, 0); sleep(900); for (const m of report().mappings) hook("test_delmap", m.id); sleep(400);
    hook("test_learn", 0, ff.id, 0); sleep(900);                 // button 1 -> Filter Freq
    hook("test_learn", 0, fw.id, 1); sleep(900);                 // button 2 -> Filter Width
    r = report();
    const bt1 = r.mappings.filter((m) => m.out === 0 && !m.internal)[0], bt2 = r.mappings.filter((m) => m.out === 1 && !m.internal)[0];
    check("Buttons: two mappings, one per button", !!bt1 && !!bt2 && bt1.pid === ff.id && bt2.pid === fw.id, JSON.stringify(r.mappings.map((m) => ({ mod: m.mod, out: m.out, pid: m.pid }))));
    if (!bt1 || !bt2) { console.log("FAILED"); process.exit(1); }
    for (const m of [bt1, bt2]) { hook("test_mapupd", m.id, "mode", "remote"); hook("test_mapupd", m.id, "min", 0); hook("test_mapupd", m.id, "max", 1); }
    sleep(1500);
    check("Buttons: both off -> both parameters at their minimum", norm(ff) < 0.03 && norm(fw) < 0.03, `${norm(ff).toFixed(3)} / ${norm(fw).toFixed(3)}`);
    hook("test_setparam", 0, "sync", 1); sleep(900);
    check("Buttons: button 1 on -> Filter Freq 1.0, Filter Width unchanged", norm(ff) > 0.97 && norm(fw) < 0.03, `${norm(ff).toFixed(3)} / ${norm(fw).toFixed(3)}`);
    hook("test_setparam", 0, "bipolar", 1); sleep(900);
    check("Buttons: button 2 on -> Filter Width 1.0, Filter Freq stays on", norm(ff) > 0.97 && norm(fw) > 0.97, `${norm(ff).toFixed(3)} / ${norm(fw).toFixed(3)}`);
    hook("test_setparam", 0, "sync", 0); sleep(900);
    check("Buttons: button 1 off -> Filter Freq 0.0, Filter Width stays on", norm(ff) < 0.03 && norm(fw) > 0.97, `${norm(ff).toFixed(3)} / ${norm(fw).toFixed(3)}`);
    // the switch parameters (M1 Sync = button 1, M1 Bipolar = button 2) are what Live automates
    const sw1 = mega("M1 Sync"), sw2 = mega("M1 Bipolar");
    evalLom(`new LiveAPI(${JSON.stringify(sw1.path)}).set("value", 1); return 1;`); sleep(900);
    check("Buttons: the M1 Sync parameter (Live automation) toggles button 1 and the mapped parameter", norm(ff) > 0.97 && norm(fw) > 0.97, `${norm(ff).toFixed(3)} / ${norm(fw).toFixed(3)}`);
    evalLom(`new LiveAPI(${JSON.stringify(sw2.path)}).set("value", 0); return 1;`); sleep(900);
    check("Buttons: the M1 Bipolar parameter toggles button 2 only", norm(fw) < 0.03 && norm(ff) > 0.97, `${norm(ff).toFixed(3)} / ${norm(fw).toFixed(3)}`);
    // slew: button 2 on with a 500 ms time constant (slew 0.5) ramps instead of stepping
    hook("test_setparam", 0, "slew", 0.5); hook("test_setparam", 0, "bipolar", 0); sleep(2500);
    hook("test_setparam", 0, "bipolar", 1);
    const t0 = Date.now(); const ramp = [];
    while (Date.now() - t0 < 1500) { ramp.push([Date.now() - t0, norm(fw)]); }
    const mid = ramp.filter((p) => p[0] > 150 && p[0] < 700).map((p) => p[1]);
    const end = ramp[ramp.length - 1][1];
    check("Buttons: slew 0.5 (500 ms) ramps the toggle (intermediate values seen, then on)", mid.some((v) => v > 0.15 && v < 0.85) && end > 0.85, `${mid.length} mid samples, end ${end.toFixed(3)}`);
    cleanup();

    // ================= C. ADSR, Trig = Threshold, on a real audio clip
    if (!SSH) { check("ADSR threshold: needs --ssh to write the audio file", false); } else {
        const wav = "/tmp/mm_bursts.wav";
        execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", SSH, "/usr/bin/python3 - <<'EOF'\nimport wave, struct, math\nsr = 44100\nw = wave.open('" + wav + "', 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)\nfr = []\nfor i in range(12 * sr):\n    t = i / sr\n    ph = t % 4.0\n    amp = 0.0\n    if 0.2 <= ph < 3.2:\n        amp = 0.02 if int(t // 4) == 1 else 0.5\n    fr.append(struct.pack('<h', int(32767 * amp * math.sin(2 * math.pi * 1000 * t))))\nw.writeframes(b''.join(fr)); w.close()\nEOF"], { env: Object.assign({}, process.env, { SSHPASS: "admin" }) });
        hook("test_add", 6); sleep(700);
        // slow stages so the ~0.3 s poll of the bridge sees every stage (the loud bursts last 3 s, the middle one is below the threshold)
        for (const [k, v] of [["sync", 1], ["attack", 500], ["decay", 500], ["sustain", 0.5], ["release", 800], ["thresh", -24]]) hook("test_setparam", 0, k, v);
        sleep(500);
        const clip = evalLom(`
            var tp = ${JSON.stringify(dev.path.replace(/ devices \d+$/, ""))};
            var slot = new LiveAPI(tp + " clip_slots 0");
            var res = "";
            try { slot.call("create_audio_clip", ${JSON.stringify(wav)}); res = "ok"; } catch (e) { res = "ERR " + e; }
            var c = new LiveAPI(tp + " clip_slots 0 clip");
            var out = { res: res, id: String(c.id) };
            if (String(c.id) !== "0") { c.set("looping", 1); c.set("warping", 0); out.len = Number(c.get("length")); }
            return out;
        `);
        info("audio clip: " + JSON.stringify(clip));
        check("an audio clip of tone bursts was created on the Mega track", clip.res === "ok" && clip.id !== "0");
        if (clip.res === "ok") {
            evalLom(`new LiveAPI(${JSON.stringify(dev.path.replace(/ devices \d+$/, "") + " clip_slots 0")}).call("fire"); return 1;`);
            let maxU = 0, stages = {}, sawSus = false, quiet = 0, n = 0;
            const t1 = Date.now();
            while (Date.now() - t1 < 13500) {
                const m = midiRep();
                if (!m) continue;
                const mod = m.mods[0];
                const u = (mod.out + 1) / 2, st = Math.round(mod.aux) % 10;
                n++;
                maxU = Math.max(maxU, u);
                stages[st] = 1;
                if (st === 3 && Math.abs(u - 0.5) < 0.03) sawSus = true;
            }
            info(`${n} telemetry samples: max u ${maxU.toFixed(3)}, stages ${Object.keys(stages).join(",")}`);
            check("ADSR (Threshold): a tone burst fires it (the level climbs past 0.7)", maxU > 0.7, `max u ${maxU.toFixed(3)}`);
            check("ADSR (Threshold): attack, decay, sustain and release stages all run", !!(stages[1] && stages[2] && stages[3] && stages[4]), Object.keys(stages).join(","));
            check("ADSR (Threshold): it settles at the sustain level 0.5 while the burst lasts", sawSus);
            evalLom(`new LiveAPI(${JSON.stringify(dev.path.replace(/ devices \d+$/, ""))}).call("stop_all_clips"); return 1;`);
            sleep(1200);
            const ms = midiRep();
            check("ADSR (Threshold): back at 0 when the clip stops", !!ms && (ms.mods[0].out + 1) / 2 < 0.02, ms && ms.mods[0].out);
            evalLom(`new LiveAPI(${JSON.stringify(dev.path.replace(/ devices \d+$/, "") + " clip_slots 0")}).call("delete_clip"); return 1;`);
        }
    }
    cleanup();
    evalLom(`new LiveAPI("live_set").call("delete_track", ${scratch.track}); return 1;`);
    console.log(failed ? "FAILED" : "megamod newmods live checks passed");
    process.exit(failed ? 1 : 0);
})();
