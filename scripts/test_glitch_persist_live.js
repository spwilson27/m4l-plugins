#!/usr/bin/env node
/**
 * sweep2(glitch): Live checks the main suite lacks. Needs glitch_test.als (scripts/vm_glitch.sh live), under the Live lock.
 *   latency  the device reports latency_in_samples == 1023 (AGENTS 19: constant patcher attribute; the audio case spec_latency measures 1023)
 *   persist  `live_set duplicate_track` clones the device through its stored state (parameter values + GlitchStateData blob) like a Set load:
 *            the clone has the original's working glitch (seed, tiles), slots, Morph X / Mode / Chaos / Seq Length and Mix / Out values
 *   node scripts/test_glitch_persist_live.js --port 19880
 */
const { execFileSync } = require("child_process");
const path = require("path");
const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = arg("--port", null);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8" }));
    if (out.error) throw new Error(out.error);
    return out.result;
}
let failures = 0;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failures++; return ok; };
const finish = () => { console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed"); process.exit(failures ? 1 : 0); };
const findAll = () => evalLom(`
    var out = []; var n = new LiveAPI("live_set").getcount("tracks");
    for (var t = 0; t < n; t++) { var tr = new LiveAPI("live_set tracks " + t); var nd = tr.getcount("devices");
        for (var d = 0; d < nd; d++) { var dv = new LiveAPI("live_set tracks " + t + " devices " + d);
            if (/Glitch/.test(String(dv.get("name")))) out.push({ track: t, device: d, id: String(dv.id), path: "live_set tracks " + t + " devices " + d }); } }
    return out;`);
function hookKey(id, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const m = JSON.parse(String(evalLom('return new Global("glitch_hooks").text || "{}";')));
        if (m[String(id)]) return m[String(id)];
        sleep(300);
    }
    return null;
}
const inst = (key) => ({
    debug: (...m) => evalLom(`messnamed(${JSON.stringify(key)}, ${m.map((x) => JSON.stringify(x)).join(", ")}); return 1;`),
    report() { this.debug("test_report"); sleep(400); return JSON.parse(String(evalLom(`return new Global(${JSON.stringify("glitch_test_" + key)}).text;`))); },
    ready(ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = this.report(); if (r.ready === 1) return true; sleep(400); } return false; },
});
const params = (path_) => evalLom(`
    var ids = new LiveAPI(${JSON.stringify(path_)}).get("parameters"); var out = {};
    for (var i = 0; i + 1 < ids.length; i += 2) { var p = new LiveAPI("id " + ids[i + 1]); out[String(p.get("name"))] = { id: Number(ids[i + 1]), value: Number(p.get("value")) }; }
    return out;`);
const setP = (P, n, v) => evalLom(`new LiveAPI("id ${P[n].id}").set("value", ${v}); return 1;`);
const getP = (n_, P) => Number(evalLom(`return new LiveAPI("id ${P[n_].id}").get("value");`));

const all = findAll();
if (!check(all.length >= 1, `Glitch device found (${all.length})`)) finish();
const dev = all[0];
const key = hookKey(dev.id, 30000);
if (!check(!!key, "hook name registered")) finish();
const A = inst(key);
check(A.ready(30000), "DSP ready");
const lat = Number(evalLom(`return new LiveAPI(${JSON.stringify(dev.path)}).get("latency_in_samples");`));
check(lat === 1023, `latency_in_samples == 1023 (got ${lat})`);

// prepare: a distinctive state
A.debug("randomize", 4242); sleep(500);
A.debug("save", 3); sleep(300);
A.debug("randomize", 777); sleep(500);
const P = params(dev.path);
setP(P, "Chaos", 80); setP(P, "Seq Length", 5); setP(P, "Mix", 61); setP(P, "Out", -7.5); setP(P, "Morph X", 20);
sleep(800);
const ra = A.report();
const pa = { chaos: getP("Chaos", P), len: getP("Seq Length", P), mix: getP("Mix", P), out: getP("Out", P), mx: getP("Morph X", P), mode: getP("Mode", P) };
console.log("original", JSON.stringify({ seed: ra.seed, tiles: ra.tiles, filled: ra.slotsFilled, audition: ra.audition, xy: ra.xy, chaos: ra.chaos, seqlen: ra.seq && ra.seq.length }), JSON.stringify(pa));

// clone through Live's own state store
evalLom(`new LiveAPI("live_set").call("duplicate_track", ${dev.track}); return 1;`);
sleep(5000);
const all2 = findAll();
const clone = all2.find((d) => d.id !== dev.id && d.track !== dev.track && !all.some((o) => o.id === d.id));
if (!check(!!clone, "the track duplicate holds a second Glitch")) finish();
const ckey = hookKey(clone.id, 30000);
if (!check(!!ckey && ckey !== key, "the clone registered its own hook name")) finish();
const B = inst(ckey);
check(B.ready(40000), "clone DSP ready");
const rb = B.report();
const PB = params(clone.path);
const pb = { chaos: getP("Chaos", PB), len: getP("Seq Length", PB), mix: getP("Mix", PB), out: getP("Out", PB), mx: getP("Morph X", PB), mode: getP("Mode", PB) };
console.log("clone", JSON.stringify({ seed: rb.seed, tiles: rb.tiles, filled: rb.slotsFilled, audition: rb.audition, xy: rb.xy, chaos: rb.chaos, seqlen: rb.seq && rb.seq.length }), JSON.stringify(pb));
check(JSON.stringify(rb.tiles) === JSON.stringify(ra.tiles), "clone: same working glitch tiles");
check(JSON.stringify(rb.slotsFilled) === JSON.stringify(ra.slotsFilled), "clone: same filled slots");
check(rb.seed === ra.seed, `clone: same seed (${ra.seed} / ${rb.seed})`);
check(rb.audition === ra.audition, `clone: same audition (${ra.audition} / ${rb.audition})`);
check(Math.abs(rb.chaos - ra.chaos) < 0.01 && Math.abs(pb.chaos - pa.chaos) < 0.5, `clone: Chaos ${pa.chaos} -> ${pb.chaos} (face ${ra.chaos} / ${rb.chaos})`);
check(pb.len === pa.len && rb.seq.length === ra.seq.length, `clone: Seq Length ${pa.len} -> ${pb.len} (face ${ra.seq.length} / ${rb.seq.length})`);
check(Math.abs(pb.mix - pa.mix) < 0.5, `clone: Mix ${pa.mix} -> ${pb.mix}`);
check(Math.abs(pb.out - pa.out) < 0.2, `clone: Out ${pa.out} -> ${pb.out}`);
check(Math.abs(pb.mx - pa.mx) < 0.5 && Math.abs(rb.xy[0] * 100 - pb.mx) < 0.5, `clone: Morph X ${pa.mx} -> ${pb.mx} (face ${rb.xy[0] * 100})`);
check(pb.mode === pa.mode, `clone: Mode ${pa.mode} -> ${pb.mode}`);
// the clone's face and the original's must not share per-instance buffers: changing the clone leaves the original alone
B.debug("randomize", 31337); sleep(600);
const ra2 = A.report();
check(JSON.stringify(ra2.tiles) === JSON.stringify(ra.tiles) && ra2.seed === ra.seed, "re-rolling the clone leaves the original's glitch alone");
finish();
