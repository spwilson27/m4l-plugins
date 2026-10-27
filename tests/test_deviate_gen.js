"use strict";
// Host tests of the Deviate gen core (src/deviate_core.genexpr, src/deviate_conv.genexpr): lint, static contract against
// src/deviate_config.js, and the plain functions (dv_hidden, dv_draw, dv_soft) run through tests/genexpr_functions.js.
// Real behaviour (detector, timing, telemetry) is verified by scripts/run_deviate_audio_tests.py in the VM.
//   node tests/test_deviate_gen.js

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const cfg = require("../src/deviate_config.js");
const { lintGenExpr, stripComments } = require("./lint_lib.js");
const gx = require("./genexpr_functions.js");

const ROOT = path.join(__dirname, "..");
const read = (n) => fs.readFileSync(path.join(ROOT, "src", n), "utf8");
let fails = 0;
let checks = 0;
function ok(cond, msg) {
    checks++;
    if (!cond) { fails++; console.log("FAIL: " + msg); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---- the gen text is the build's: fft_init + deviate_conv + deviate_fx + deviate_core with //@hidden replaced (python3 scripts/build_deviate.py) ----
const coreRaw = read("deviate_core.genexpr");
const coreLines = coreRaw.split("\n");
ok(coreLines.filter((l) => l === "//@hidden").length === 1, "the core has the line //@hidden exactly once");
const hiddenText = cfg.dvHiddenGen();
const core = coreLines.map((l) => (l === "//@hidden" ? hiddenText : l)).join("\n");
let full = "";
{
    const r = cp.spawnSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import build_deviate; sys.stdout.write(build_deviate.gen_code())"], { cwd: ROOT, encoding: "utf8" });
    ok(r.status === 0 && r.stdout.length > 1000, "build_deviate.gen_code() works: " + (r.stderr || "").split("\n").slice(-2).join(" "));
    full = r.stdout;
    ok(full.includes(hiddenText), "the build embeds dvHiddenGen() from src/deviate_config.js");
    ok(full.includes(read("deviate_conv.genexpr").trim()) && full.includes(read("deviate_fx.genexpr").trim()), "the build embeds deviate_conv + deviate_fx");
}

// ---- 1. lint ----
const lint = lintGenExpr(full, "deviate gen");
lint.forEach((l) => ok(false, `${l.rule}: ${l.msg}`));
ok(lint.length === 0, "lintGenExpr clean");
const builtDir = path.join(ROOT, "devices");
if (fs.existsSync(builtDir)) {
    const { extractGenCode } = require("./lint_lib.js");
    fs.readdirSync(builtDir).filter((f) => /^Deviate.*\.amxd$/.test(f)).forEach((f) => {
        const buf = fs.readFileSync(path.join(builtDir, f));
        const gens = extractGenCode(buf.toString("utf8", 32));
        gens.forEach((g) => { if (g.code) lintGenExpr(g.code, f).forEach((l) => ok(false, `${f}: ${l.rule}: ${l.msg}`)); });
    });
}

// ---- 2. static contract ----
const code = stripComments(core);
const decl = /^(Buffer|Data|Param|History|Delay)\b/m;
const firstDeclIdx = code.search(decl);
ok(coreRaw.indexOf("//@hidden") < coreRaw.search(/^(Buffer|Data|Param|History|Delay)\b/m), "//@hidden comes before the first declaration");
ok(firstDeclIdx > code.indexOf("dv_hidden(mE, mT, hv) {"), "dv_hidden is defined before the declarations");
ok(!/\bfract\s*\(/.test(code), "no fract()");
ok((code.match(/\bdv_hidden\(/g) || []).length === 3, "dv_hidden: one definition + two call sites (hit branch, page apply)");
ok((code.match(/\bdv_draw\(/g) || []).length === 2, "dv_draw: one definition + exactly one call site");
ok(!/\bdelay\s*\(/.test(code), "no delay() call");

const params = [...code.matchAll(/^Param (\w+)\(([^)]*)\);/gm)].map((m) => ({ name: m[1], def: Number(m[2]) }));
const pset = new Set(params.map((p) => p.name));
const expected = new Set(["dvmtrig", "dvplay"]);
cfg.DV_PARAMS.forEach((p) => { if (p[9]) expected.add(p[9]); });
ok(pset.size === params.length, "no duplicate Param");
for (const n of expected) ok(pset.has(n), `Param ${n} exists (gen message of DV_PARAMS)`);
for (const n of pset) ok(expected.has(n), `Param ${n} is a known gen message`);
ok(!params.some((p) => ["mix", "noise", "rise", "fall", "bias", "hold", "phi", "pi"].includes(p.name)), "no reserved Param name");
const pdef = (n) => params.find((p) => p.name === n).def;
cfg.DV_PARAMS.forEach((p) => {
    if (!p[9] || p[9] === "dvsplit" || p[9] === "dvreroll") return;
    ok(near(pdef(p[9]), p[5] / p[10], 1e-12), `Param ${p[9]} default ${pdef(p[9])} = initial ${p[5]} / ${p[10]}`);
});
ok(pdef("dvreroll") === -1 && pdef("dvmtrig") === -1, "dvreroll and dvmtrig start at -1 (no value yet)");

const bufs = [...code.matchAll(/^Buffer (\w+)\("(\w+)"\);/gm)].map((m) => m[1]).sort().join(",");
ok(bufs === "ctl,dmap,ir,scope,spec", `Buffer variable names ${bufs}`);

// scope pokes: literal slots, `base + i` loops and the waveform ring
const pokes = [...code.matchAll(/poke\(scope,\s*([^;]*?),\s*([^,]+?),\s*0\);/g)].map((m) => m[2].trim());
const lit = new Set(pokes.filter((x) => /^\d+$/.test(x)).map(Number));
const S = cfg.DV_SCOPE, E = cfg.DV_ECHO;
const need = (name, slot) => ok(lit.has(slot), `scope slot ${name} (${slot}) is written`);
["FRAMES", "SR", "HITS", "DRAW_SERIAL", "ONSET_AGE", "SPLIT_MODE", "LATENCY", "ASLEEP", "REROLL", "TR_S", "RING_ENV", "IR_TAG", "FAST", "SLOW", "THR",
    "MTRIG", "PK_IN", "PK_T", "PK_B", "PK_L", "PK_OUT", "PK_DRY", "PAGE_APPLIED", "HIT_GATE", "HIT_SRC", "WAVE_HEAD", "SPEC_HEAD", "ALIVE"].forEach((k) => need(k, S[k]));
ok(pokes.includes(`${S.METAS} + i`), "METAS are written as METAS + i");
ok(pokes.includes(`${S.DRAWS} + i`), "DRAWS are written as DRAWS + i");
ok(pokes.includes(`${S.HIDDEN} + i`), "HIDDEN are written as HIDDEN + i");
ok(cfg.DV_HIDDEN_COUNT <= 64, "hidden rows fit the 64 HIDDEN slots");
for (let i = 0; i < 26; i++) need(`ECHO+${i}`, S.ECHO + i);
ok(S.METAS === 16 && S.DRAWS === 24 && S.HIDDEN === 64 && S.ECHO === 128 && S.WAVE === 256, "scope bases used as literals");
ok(code.includes(`wb = ${S.WAVE} + whN * ${cfg.DV_WAVE_STRIDE};`), "waveform block address");
ok(code.includes(`wrap(whN + 1, 0, ${cfg.DV_WAVE_BLOCKS})`), "waveform head wraps at DV_WAVE_BLOCKS");
ok(code.includes(`bcN >= ${cfg.DV_WAVE_BLOCK_SAMPS}`), "waveform block length");
ok([0, 1, 2, 3, 4].every((j) => code.includes(`wb + ${j}, 0)`)), "five waveform fields per block");
ok(code.includes(`wrap(shN + 1, 0, ${cfg.DV_SPEC_N})`) && code.includes(`dim(spec) >= ${cfg.DV_SPEC_N}`), "spec ring length");
// ECHO order: V, R, LOCKS, SENS, THR, CHANCE, MIX, SEED, DRIFT, SPLIT, REROLL, CTL_GEN
const echoOrder = ["dvv0", "dvr0", "lockMask", "dvsens", "dvthr", "dvchance", "dvwet", "dvseed", "dvdrift", "dvsplit", "dvreroll", "lcN"];
const echoIdx = [E.V, E.R, E.LOCKS, E.SENS, E.THR, E.CHANCE, E.MIX, E.SEED, E.DRIFT, E.SPLIT, E.REROLL, E.CTL_GEN];
echoOrder.forEach((v, i) => ok(code.includes(`poke(scope, ${v}, ${S.ECHO + echoIdx[i]}, 0);`), `ECHO ${v} at ${S.ECHO + echoIdx[i]}`));
for (let i = 1; i < 8; i++) {
    ok(code.includes(`poke(scope, dvv${i}, ${S.ECHO + E.V + i}, 0);`), `ECHO value ${i}`);
    ok(code.includes(`poke(scope, dvr${i}, ${S.ECHO + E.R + i}, 0);`), `ECHO range ${i}`);
}
// ctl layout and constants
ok(code.includes("peek(ctl, 0, 0)") && code.includes("peek(ctl, 1, 0)") && code.includes("peek(ctl, 2, 0)"), "ctl GEN / FLAGS / REROLL slots");
ok(code.includes(`peek(ctl, ${cfg.DV_CTL.T} + i, 0)`), "ctl T block");
ok(code.includes(`peek(ctl, ${cfg.DV_CTL.E} + i, 0)`), "ctl E block");
ok(cfg.DV_CTL.GEN === 0 && cfg.DV_CTL.FLAGS === 1 && cfg.DV_CTL.REROLL === 2 && cfg.DV_CTL.T === 4 && cfg.DV_CTL.E === 12, "DV_CTL layout as the core reads it");
// hidden rows the core reads
const hi = cfg.DV_HIDDEN_INDEX;
ok(code.includes(`wtN = peek(dvHV, ${hi.win_t_ms});`), "win_t_ms index");
ok(code.includes(`wrN = peek(dvHV, ${hi.win_r_ms});`), "win_r_ms index");
ok(code.includes(`trN = peek(dvHV, ${hi.tr_s});`), "tr_s index");
ok(code.includes(`irN = peek(dvHV, ${hi.conv_ir});`), "conv_ir index");
// timing constants
const lat = (s) => `(${s} > 0.5) ? ${cfg.DV_LAT_SPEC} : ${cfg.DV_LAT_ENV}`;
ok(code.includes(lat("modeN")), "latency per mode");
ok(code.includes(`pa = latN - ${cfg.DV_PRE};`) && code.includes(`latN + ${cfg.DV_PRE}`) && code.includes(`agN - ${cfg.DV_PRE}`), "pre-roll constant");
ok(code.includes(`lkaN = floor(${cfg.DV_LOCK_AUDIO_MS} * sr / 1000);`), "audio lockout");
ok(code.includes(`hldN = ${cfg.DV_RING_HOLD_S} * sr;`) && code.includes(`fdN = ${cfg.DV_RING_FADE_S} * sr;`), "Ring hold / fade");
ok(code.includes(`pow(10, -3.3 / (max(trN, 0.001) * sr))`), "Ring decay factor -66 dB at Tr");
ok(code.includes(String(Math.pow(10, -3.3))), "Ring fade start level 10^-3.3");
ok(code.includes("dv_hidden(dvAE, dvAT, dvHV, dvMp);"), "hidden values from the applied page");
ok(code.includes("dv_hidden(dvE, dvT, dvHV, dvMp);") && code.includes("cwE = peek(dvHV, 21);") && code.includes("tgE = clip(floor(peek(dvHV, 22) + 0.5), 0, 9);"),
    "the hit branch takes the convolver's wet / IR from the same map");
ok(code.includes("applyNow = (mapOk > 0.5) ? applyNow : 0;") && code.includes("mapOk > 0.5) ? 1 : 0;"), "no page and no convolver start before a map exists");

// ---- 3. function parity ----
globalThis.atan2 = Math.atan2;
const fns = gx.load(full);
const mkData = (arr, size) => { const d = new gx.DataSim(size || arr.length); arr.forEach((v, i) => d.poke(v, i)); return d; };
// dv_hidden vs dvHiddenFromMetas
{
    const rng = cfg.dvRng(99);
    let worst = 0;
    for (let t = 0; t < 200; t++) {
        const E = [], T = [];
        for (let i = 0; i < 8; i++) { E.push(rng() * 100); T.push(rng() * 100); }
        if (t < 4) for (let i = 0; i < 8; i++) { E[i] = [0, 100, 50, 33.3][t]; T[i] = [0, 100, 50, 66.6][t]; }
        const arch = t % 4 === 0 ? 0 : 1 + Math.floor(rng() * 1000);
        const map = cfg.dvArchMap(arch, t % 3 === 0 ? 0 : 1 + (t % 3));
        const mE = mkData(E), mT = mkData(T), hv = new gx.DataSim(64), mp = mkData(cfg.dvMapFloats(map), 512);
        fns.dv_hidden(mE, mT, hv, mp);
        const ref = cfg.dvHiddenFromMetas(E, T, map);
        for (let i = 0; i < cfg.DV_HIDDEN_COUNT; i++) {
            const d = Math.abs(hv.peek(i) - ref[i]) / Math.max(1, Math.abs(ref[i]));
            worst = Math.max(worst, d);
        }
    }
    ok(worst < 1e-12, `dv_hidden equals dvHiddenFromMetas for Arch 0 and random Archs of every Arch Mode (worst relative diff ${worst})`);
}
// dv_soft
{
    let good = true;
    for (let x = -2; x <= 2; x += 0.25) if (fns.dv_soft(x) !== x) good = false;
    ok(good, "dv_soft is the identity up to |x| = 2");
    ok(fns.dv_soft(100) < 6.0001 && fns.dv_soft(-100) > -6.0001 && fns.dv_soft(3) > 2 && fns.dv_soft(3) < 3, "dv_soft knee bounded");
}
// dv_draw vs dvStep over scripted sequences
function drawRun(seedRng, nEvents, opts) {
    const p = { v: [], r: [], lock: [], chance: opts.chance, seed: opts.seed, drift: opts.drift };
    for (let i = 0; i < 8; i++) { p.v.push(Math.floor(seedRng() * 101)); p.r.push(Math.floor(seedRng() * 101)); p.lock.push(opts.locks ? (seedRng() < 0.4 ? 1 : 0) : 0); }
    const st = cfg.dvNewState();
    const pv = mkData(p.v), pr = mkData(p.r), lk = mkData(p.lock);
    const dst = new gx.DataSim(8), tT = new gx.DataSim(8), tE = new gx.DataSim(8);
    dst.poke(1, 4);
    let worst = 0, passes = 0, n = 0;
    for (let e = 0; e < nEvents; e++) {
        const ev = opts.rerolls && seedRng() < 0.2 ? 1 : 0;
        if (opts.vary && seedRng() < 0.1) { // Values / Ranges edited between hits
            for (let i = 0; i < 8; i++) { p.v[i] = Math.floor(seedRng() * 101); pv.poke(p.v[i], i); p.r[i] = Math.floor(seedRng() * 101); pr.poke(p.r[i], i); }
        }
        const ref = cfg.dvStep(st, p, ev ? "reroll" : "hit");
        const ret = fns.dv_draw(pv, pr, lk, dst, tT, tE, p.seed, p.chance, p.drift, ev);
        ok(ret === ref.gate, `dv_draw return = gate (event ${e})`);
        const sv = [dst.peek(0), dst.peek(1), dst.peek(2), dst.peek(3), dst.peek(4)];
        const sref = [st.valid, st.hits, st.reroll, st.serial, st.gate];
        for (let i = 0; i < 5; i++) worst = Math.max(worst, Math.abs(sv[i] - sref[i]));
        for (let i = 0; i < 8; i++) {
            worst = Math.max(worst, Math.abs(tT.peek(i) - st.T[i]), Math.abs(tE.peek(i) - st.E[i]));
        }
        if (!ev && e > 0) { n++; passes += ref.gate; }
    }
    return { worst, passes, n };
}
{
    const rng = cfg.dvRng(12345);
    let worst = 0;
    const settings = [];
    for (const chance of [0, 50, 100]) for (const drift of [0, 50, 100]) for (const seed of [0, 5, 777, 1000]) settings.push({ chance, drift, seed });
    for (const s of settings) {
        for (const flags of [{ locks: 0 }, { locks: 1, rerolls: 1, vary: 1 }]) {
            const r = drawRun(rng, 40, Object.assign({}, s, flags));
            worst = Math.max(worst, r.worst);
        }
    }
    ok(worst < 1e-9, `dv_draw equals dvStep over ${settings.length * 2} scripted sequences (worst diff ${worst})`);
    // Chance statistics: pass rate at Chance 50 over 4000 hits within 3 sigma; 0 never (after the first), 100 always
    const st50 = drawRun(cfg.dvRng(7), 4001, { chance: 50, seed: 3, drift: 0 });
    const sigma = Math.sqrt(4000 * 0.25);
    ok(Math.abs(st50.passes - 2000) < 3 * sigma, `Chance 50 pass rate ${st50.passes}/4000 within 3 sigma (${(3 * sigma).toFixed(0)})`);
    ok(drawRun(cfg.dvRng(8), 300, { chance: 0, seed: 1, drift: 0 }).passes === 0, "Chance 0: no hit draws after the first");
    ok(drawRun(cfg.dvRng(9), 300, { chance: 100, seed: 1, drift: 0 }).passes === 299, "Chance 100: every hit draws");
}
// Locks hold through Reroll, first draw ignores locks
{
    const p = cfg.dvDefaultDrawParams();
    p.lock = [1, 0, 0, 0, 0, 0, 0, 1];
    p.seed = 2;
    const pv = mkData(p.v), pr = mkData(p.r), lk = mkData(p.lock);
    const dst = new gx.DataSim(8), tT = new gx.DataSim(8), tE = new gx.DataSim(8);
    dst.poke(1, 4);
    fns.dv_draw(pv, pr, lk, dst, tT, tE, p.seed, 100, 0, 0);
    const first = [tT.peek(0), tT.peek(7)];
    for (let i = 0; i < 6; i++) fns.dv_draw(pv, pr, lk, dst, tT, tE, p.seed, 100, 0, i % 2);
    ok(tT.peek(0) === first[0] && tT.peek(7) === first[1], "locked metas keep their first draw through hits and rerolls");
    ok(tT.peek(2) !== p.v[2] || p.r[2] === 0, "an unlocked meta moves");
}

// ---- 4. python port of dvHash / dvStep (scripts/run_deviate_audio_tests.py) against the JS mirror ----
{
    const r = cp.spawnSync("python3", ["-c", `
import sys, json
sys.path.insert(0, 'scripts')
import run_deviate_audio_tests as r
out = {"hash": [r.dv_hash(i, k, s) for i, k, s in [(0, 0, 0), (4096, 5, 3), (123456, 777, 8), (8192 * 5 + 7, 1000, 7), (1, 6, 2)]]}
p = {"v": [20, 50, 80, 10, 60, 30, 90, 5], "r": [30, 60, 40, 100, 25, 0, 50, 80], "lock": [0, 1, 0, 0, 1, 0, 0, 0], "chance": 70, "seed": 5, "drift": 40}
st = r.dv_new_state()
seq = []
for ev in ["hit", "hit", "reroll", "hit", "hit", "hit", "reroll"]:
    r.dv_step(st, p, ev)
    seq.append({"T": list(st["T"]), "E": list(st["E"]), "hits": st["hits"], "serial": st["serial"], "gate": st["gate"]})
out["seq"] = seq
sys.stdout.write(json.dumps(out))
`], { cwd: ROOT, encoding: "utf8" });
    if (r.status !== 0) {
        console.log("note: python3 cross-check skipped: " + (r.stderr || "").split("\n").slice(-2).join(" "));
    } else {
        const py = JSON.parse(r.stdout);
        [[0, 0, 0], [4096, 5, 3], [123456, 777, 8], [8192 * 5 + 7, 1000, 7], [1, 6, 2]].forEach((a, i) => ok(Math.abs(py.hash[i] - cfg.dvHash(a[0], a[1], a[2])) < 1e-9, `python dv_hash ${a}`));
        const p = { v: [20, 50, 80, 10, 60, 30, 90, 5], r: [30, 60, 40, 100, 25, 0, 50, 80], lock: [0, 1, 0, 0, 1, 0, 0, 0], chance: 70, seed: 5, drift: 40 };
        const st = cfg.dvNewState();
        ["hit", "hit", "reroll", "hit", "hit", "hit", "reroll"].forEach((ev, i) => {
            cfg.dvStep(st, p, ev);
            const q = py.seq[i];
            let d = 0;
            for (let k = 0; k < 8; k++) d = Math.max(d, Math.abs(q.T[k] - st.T[k]), Math.abs(q.E[k] - st.E[k]));
            ok(d < 1e-9 && q.hits === st.hits && q.serial === st.serial && q.gate === st.gate, `python dv_step event ${i} (diff ${d})`);
        });
    }
}


// ---- 5. whole-core simulation: the per-sample statements of the core run in Node (History = old value on read, as in Max) ----
function makeSim(overrides, fresh) {
    const FN = fresh ? gx.load(full) : fns; // fft_init keeps a persistent guard per load: a sim that runs the convolver needs its own functions
    const raw = stripComments(core).split("\n");
    const decls = { Param: [], History: [], Data: [], Delay: [], Buffer: [] };
    let lastDecl = -1;
    raw.forEach((l, i) => {
        const m = /^(Param|History|Data|Delay|Buffer)\s+(\w+)\(([^)]*)\);/.exec(l);
        if (m) { decls[m[1]].push({ name: m[2], arg: m[3] }); lastDecl = i; }
    });
    let body = raw.slice(lastDecl + 1).join("\n");
    const rep = (name, to) => { body = body.replace(new RegExp(`(^|[^.\\w])${name}\\b`, "gm"), (m0, a) => a + to); };
    decls.Param.forEach((d) => rep(d.name, "P." + d.name));
    decls.History.forEach((d) => rep(d.name, "H." + d.name));
    decls.History.forEach((d) => { body = body.replace(new RegExp(`^(\\s*)H\\.${d.name} = `, "gm"), `$1W.${d.name} = `); });
    rep("in1", "IO.in1"); rep("in2", "IO.in2"); rep("in3", "IO.in3"); rep("in4", "IO.in4"); rep("samplerate", "IO.sr");
    body = body.replace(/^out1 = /m, "IO.out1 = ").replace(/^out2 = /m, "IO.out2 = ");
    const H = {}, W = {}, P = {};
    decls.History.forEach((d) => { H[d.name] = Number(d.arg); });
    decls.Param.forEach((d) => { P[d.name] = Number(d.arg); });
    Object.assign(P, overrides || {});
    const data = {};
    decls.Data.forEach((d) => { const q = d.arg.split(",").map(Number); data[d.name] = new gx.DataSim(q[0], q[1] || 1); });
    decls.Buffer.forEach((d) => { data[d.name] = new gx.DataSim(d.name === "scope" ? cfg.DV_SCOPE_SAMPS : d.name === "spec" ? cfg.DV_SPEC_N : d.name === "dmap" ? cfg.DV_MAP.SAMPS : 64, d.name === "spec" ? 5 : 1); });
    // the engine writes the Arch 0 map before the gen exists (overrides.__arch picks another one)
    {
        const mp0 = cfg.dvArchMap((overrides && overrides.__arch) || 0, (overrides && overrides.__mode) || 0).map((r) => Object.assign({}, r));
        for (const [id, lo, hi] of (overrides && overrides.__rows) || []) {
            const i = cfg.DV_HIDDEN_INDEX[id], d = cfg.DV_HIDDEN[i].kind === "D";
            mp0[i] = { meta: mp0[i].meta, src: d ? 1 : 0, curve: d ? 3 : 0, lo, hi: d ? lo : hi, jit: 1 };
        }
        const mf = cfg.dvMapFloats(mp0);
        mf.forEach((v, i) => data.dmap.poke(v, cfg.DV_MAP.BASE + i));
        data.dmap.poke(1, cfg.DV_MAP.VER);
    }
    class Dly {
        constructor(n) { this.n = n; this.a = new Float64Array(n); this.w = 0; }
        write(x) { this.a[this.w] = x; this.w = (this.w + 1) % this.n; this.last = x; }
        read(d) { const i = ((this.w - 1 - d) % this.n + this.n) % this.n; return this.a[i]; }
    }
    decls.Delay.forEach((d) => { data[d.name] = new Dly(Number(d.arg)); });
    const wrap = (x, lo, hi) => { const r = hi - lo; return lo + (((x - lo) % r) + r) % r; };
    const names = Object.keys(data);
    const B = { max: Math.max, min: Math.min, abs: Math.abs, floor: Math.floor, pow: Math.pow, exp: Math.exp, sin: Math.sin, tanh: Math.tanh,
        clip: (x, lo, hi) => Math.max(lo, Math.min(hi, x)), peek: (b, i, c) => b.peek(i, c), poke: (b, v, i, c) => b.poke(v, i, c), wrap, dim: (bf) => bf.size,
        fixnan: (x) => (Number.isFinite(x) ? x : 0), sqrt: Math.sqrt, tan: Math.tan, cos: Math.cos, log: Math.log, log10: Math.log10, round: Math.round };
    Object.assign(B, FN);
    const bnames = Object.keys(B);
    const fn = new Function("H", "W", "P", "IO", ...bnames, ...names, body);
    const IO = { sr: 48000, in1: 0, in2: 0, in3: 0, in4: 0, out1: 0, out2: 0 };
    const sim = {
        P, H, data, IO, n: 0,
        step(a, b) {
            IO.in1 = a; IO.in2 = b === undefined ? a : b; IO.in3 = 0; IO.in4 = 0;
            fn(H, W, P, IO, ...bnames.map((k) => B[k]), ...names.map((k) => data[k]));
            Object.assign(H, W);
            sim.n++;
            return IO.out1;
        },
        sc(i) { return data.scope.peek(i); },
    };
    return sim;
}
function burst(n, s, len, amp) { const t = n - s; return t >= 0 && t < len ? amp * Math.sin(2 * Math.PI * 1000 * t / 48000) : 0; }
{
    // delayed dry is bit exact at Mix 0 (default metas: effects run, Mix scales their residue) and at every Mix when the metas are neutral
    const NEUTRAL = { dvv0: 0, dvv1: 50, dvv2: 0, dvv3: 0, dvv4: 0, dvv5: 0, dvv6: 0, dvv7: 0, dvr0: 0, dvr1: 0, dvr2: 0, dvr3: 0, dvr4: 0, dvr5: 0, dvr6: 0, dvr7: 0 };
    for (const [wet, neutral] of [[0, false], [1, true], [0.37, true]]) {
        const sim = makeSim(Object.assign({ dvwet: wet }, neutral ? NEUTRAL : {}));
        let bad = 0, nan = 0;
        const hist = [];
        for (let n = 0; n < 12000; n++) {
            const x = Math.sin(n * 0.01) * 0.5 + burst(n, 3000, 100, 0.8);
            hist.push(x);
            const y = sim.step(x);
            if (!Number.isFinite(y)) nan++;
            const want = n >= 256 ? hist[n - 256] : 0;
            if (y !== want) bad++;
        }
        ok(bad === 0 && nan === 0, `sim: output is the input delayed 256 samples exactly at Mix ${wet}${neutral ? " with neutral metas" : ""} (${bad} mismatches)`);
    }
    for (const mode of [0, 1]) {
        const sim = makeSim({ dvsplit: mode });
        const lat = mode ? 1279 : 256;
        let first = -1;
        for (let n = 0; n < 4000; n++) { const y = sim.step(n === 500 ? 0.8 : 0); if (first < 0 && Math.abs(y) > 0.5) first = n; }
        ok(first === 500 + lat, `sim: impulse latency ${first - 500} for dvsplit ${mode}, want ${lat}`);
        ok(sim.sc(cfg.DV_SCOPE.LATENCY) === lat && sim.sc(cfg.DV_SCOPE.SPLIT_MODE) === mode, `sim: LATENCY / SPLIT_MODE telemetry for dvsplit ${mode}`);
    }
    // hit_once timeline
    {
        const sim = makeSim({});
        const hits = [], applied = [];
        let lastH = 0, lastA = 0;
        const starts = [4800, 5280, 7680];
        for (let n = 0; n < 19200; n++) {
            sim.step(starts.reduce((a, s) => a + burst(n, s, 100, 0.8), 0));
            const h = sim.sc(cfg.DV_SCOPE.HITS), a = sim.sc(cfg.DV_SCOPE.PAGE_APPLIED);
            if (h !== lastH) { hits.push(n); lastH = h; }
            if (a !== lastA) { applied.push(n); lastA = a; }
        }
        ok(hits.length === 2 && hits[0] - 4800 <= 8 && hits[1] - 7680 <= 8, `sim: hits at ${hits} (bursts 4800, 7680; 5280 swallowed)`);
        ok(applied.length === 2 && applied[0] - hits[0] === 160 && applied[1] - hits[1] === 160, `sim: page applied 160 samples (256 - 96) after the hit: ${applied}`);
    }
    // seed repro + gate/drift/lock/reroll via the same event stream
    {
        const params = { dvseed: 5, dvchance: 60, dvdrift: 30, dvl2: 1, dvl6: 1 };
        for (let i = 0; i < 8; i++) { params["dvv" + i] = [20, 50, 80, 10, 60, 30, 90, 5][i]; params["dvr" + i] = [30, 60, 40, 100, 25, 0, 50, 80][i]; }
        const sim = makeSim(params);
        const p = { v: [20, 50, 80, 10, 60, 30, 90, 5], r: [30, 60, 40, 100, 25, 0, 50, 80], lock: [0, 0, 1, 0, 0, 0, 1, 0], chance: 60, seed: 5, drift: 30 };
        const st = cfg.dvNewState();
        let n = 0;
        const hitAt = [3000, 12000, 21000, 30000, 39000, 48000];
        let rr = 0;
        let worst = 0;
        for (let k = 0; k < hitAt.length; k++) {
            for (; n < hitAt[k]; n++) sim.step(0);
            if (k === 3) { sim.P.dvreroll = 0; sim.step(0); n++; sim.P.dvreroll = 1; for (let q = 0; q < 70; q++) { sim.step(0); n++; } rr++; cfg.dvStep(st, p, "reroll"); }
            for (let q = 0; q < 100; q++, n++) sim.step(burst(q, 0, 100, 0.8));
            cfg.dvStep(st, p, "hit");
            for (let q = 0; q < 200; q++, n++) sim.step(0);
            for (let i = 0; i < 8; i++) {
                worst = Math.max(worst, Math.abs(sim.sc(cfg.DV_SCOPE.DRAWS + i) - st.T[i]), Math.abs(sim.sc(cfg.DV_SCOPE.METAS + i) - st.E[i]));
            }
            ok(sim.sc(cfg.DV_SCOPE.DRAW_SERIAL) === st.serial && sim.sc(cfg.DV_SCOPE.HIT_GATE) === st.gate, `sim: serial/gate after hit ${k}`);
        }
        ok(worst < 1e-4, `sim: DRAWS / METAS follow dvStep with Chance, Drift, Locks and a Reroll (worst ${worst}, float32 tolerance is not applied: DataSim is double)`);
        ok(sim.sc(cfg.DV_SCOPE.HITS) === 6 && sim.sc(cfg.DV_SCOPE.REROLL) === 1, "sim: HITS counts hits only, REROLL counts the reroll");
        // hidden values equal dvHiddenFromMetas of the applied page
        const hv = cfg.dvHiddenFromMetas(st.E, st.T);
        let he = 0;
        for (let i = 0; i < cfg.DV_HIDDEN_COUNT; i++) he = Math.max(he, Math.abs(sim.sc(cfg.DV_SCOPE.HIDDEN + i) - hv[i]) / Math.max(1, Math.abs(hv[i])));
        ok(he < 1e-12, `sim: HIDDEN telemetry equals dvHiddenFromMetas (${he})`);
    }
    // reroll baseline (first value 1 is only a baseline), MIDI trigger baseline, dedupe with an audio hit
    {
        const sim = makeSim({});
        for (let n = 0; n < 200; n++) sim.step(0);
        sim.P.dvreroll = 1; for (let n = 0; n < 200; n++) sim.step(0);
        ok(sim.sc(cfg.DV_SCOPE.REROLL) === 0, "sim: the first dvreroll value is a baseline, not an edge");
        sim.P.dvreroll = 0; for (let n = 0; n < 100; n++) sim.step(0);
        sim.P.dvreroll = 1; for (let n = 0; n < 200; n++) sim.step(0);
        ok(sim.sc(cfg.DV_SCOPE.REROLL) === 1 && sim.sc(cfg.DV_SCOPE.HITS) === 0, "sim: a rising edge after the baseline is one reroll and no hit");
        sim.P.dvmtrig = 7; for (let n = 0; n < 200; n++) sim.step(0);
        ok(sim.sc(cfg.DV_SCOPE.HITS) === 0, "sim: the first dvmtrig value is a baseline");
        sim.P.dvmtrig = 8; for (let n = 0; n < 200; n++) sim.step(0);
        ok(sim.sc(cfg.DV_SCOPE.HITS) === 1 && sim.sc(cfg.DV_SCOPE.HIT_SRC) === 1, "sim: a changed dvmtrig is one MIDI hit");
        for (let n = 0; n < 100; n++) sim.step(burst(n, 0, 100, 0.8)); // audio burst inside the lockout
        for (let n = 0; n < 20000; n++) sim.step(0);
        ok(sim.sc(cfg.DV_SCOPE.HITS) === 1, "sim: an audio onset inside the MIDI lockout is deduped (no second hit after the lockout)");
        sim.P.dvmtrig = 9; for (let n = 0; n < 300; n++) sim.step(0);
        sim.P.dvmtrig = 10; for (let n = 0; n < 300; n++) sim.step(0);
        ok(sim.sc(cfg.DV_SCOPE.HITS) === 2, "sim: a MIDI change after the lockout fires, one inside it is dropped");
        for (let n = 0; n < 2000; n++) sim.step(0);
        sim.P.dvmtrig = 11; for (let n = 0; n < 300; n++) sim.step(0);
        ok(sim.sc(cfg.DV_SCOPE.HITS) === 3, "sim: the next MIDI change after the lockout fires again");
    }
    // transport start resets the draw hit counter (the next draw index restarts)
    {
        const sim = makeSim({ dvseed: 3 });
        const p = cfg.dvDefaultDrawParams(); p.seed = 3;
        const st = cfg.dvNewState();
        for (let k = 0; k < 2; k++) { for (let n = 0; n < 6000; n++) sim.step(burst(n, 100, 100, 0.8)); cfg.dvStep(st, p, "hit"); }
        const st2 = cfg.dvNewState(); st2.valid = st.valid; st2.T = st.T.slice(); st2.E = st.E.slice(); st2.reroll = 0; st2.serial = st.serial; st2.hits = 0;
        sim.P.dvplay = 1; sim.step(0);
        for (let n = 0; n < 6000; n++) sim.step(burst(n, 100, 100, 0.8));
        cfg.dvStep(st2, p, "hit");
        let d = 0;
        for (let i = 0; i < 8; i++) d = Math.max(d, Math.abs(sim.sc(cfg.DV_SCOPE.DRAWS + i) - st2.T[i]));
        ok(d < 1e-9, `sim: dvplay rising edge restarts the hit counter (diff ${d})`);
    }
    // Ring envelope (telemetry at ticks) against dvRingEnv from the apply sample, up to 2.2 s, and exact zero after the fade
    for (const ring of [0, 50, 100]) {
        const sim = makeSim({ dvv7: ring, dvr7: 0 });
        let applyN = -1, lastA = 0, worst = 0, zeroAfter = true, ticks = 0;
        const trExp = cfg.dvRingTr(ring);
        for (let n = 0; n < 48000 * 2.4; n++) {
            sim.step(burst(n, 1000, 100, 0.8));
            const a = sim.sc(cfg.DV_SCOPE.PAGE_APPLIED);
            if (a !== lastA) { applyN = n; lastA = a; }
            if (applyN >= 0 && n % 64 === 63 && n > applyN + 64) {
                const want = cfg.dvRingEnv((n - applyN) / 48000, trExp);
                worst = Math.max(worst, Math.abs(sim.sc(cfg.DV_SCOPE.RING_ENV) - want));
                ticks++;
                if ((n - applyN) / 48000 > 0.15 + trExp + 0.02 + 0.002 && sim.sc(cfg.DV_SCOPE.RING_ENV) !== 0) zeroAfter = false;
            }
        }
        ok(near(sim.sc(cfg.DV_SCOPE.TR_S), trExp, 1e-9), `sim: TR_S for Ring ${ring}`);
        ok(worst < 1e-9 && ticks > 100, `sim: Ring envelope Ring ${ring} follows dvRingEnv (worst ${worst})`);
        ok(zeroAfter, `sim: Ring envelope is exactly 0 after hold + Tr + fade (Ring ${ring})`);
    }
    // Ring cap in the whole core (Node twin of the audio cases ring_cap_*): every effect on, Ring 100: finite, bounded, and exactly the delayed dry from
    // 2.0 s after the page was applied on (the convolver is off here: no IR bank in the simulated buffer)
    {
        const sim = makeSim({ dvv0: 100, dvv1: 100, dvv2: 100, dvv3: 100, dvv4: 100, dvv5: 100, dvv6: 100, dvv7: 100, dvr0: 0, dvr1: 0, dvr2: 0, dvr3: 0, dvr4: 0, dvr5: 0, dvr6: 0, dvr7: 0 });
        const hist = [];
        let nan = 0, peakV = 0, applyN = -1, lastA = 0, late = 0, resMid = 0;
        for (let n = 0; n < 48000 * 2.4; n++) {
            const x = burst(n, 1000, 300, 0.8) + (n > 1000 && n < 1500 ? 0.2 * Math.sin(n * 0.37) : 0);
            hist.push(x);
            const y = sim.step(x);
            if (!Number.isFinite(y)) nan++;
            peakV = Math.max(peakV, Math.abs(y));
            const a = sim.sc(cfg.DV_SCOPE.PAGE_APPLIED);
            if (a !== lastA) { applyN = n; lastA = a; }
            const dry = n >= 256 ? hist[n - 256] : 0;
            if (applyN >= 0 && n > applyN + 48000 * 0.2 && n < applyN + 48000 * 1.0) resMid = Math.max(resMid, Math.abs(y - dry));
            if (applyN >= 0 && n > applyN + 48000 * 2.0 + 64) late = Math.max(late, Math.abs(y - dry));
        }
        ok(nan === 0 && peakV < 4, `sim: all effects, Ring 100: finite and bounded (peak ${peakV.toFixed(3)})`);
        ok(resMid > 0.002, `sim: the tail is there between 0.2 and 1 s (${resMid.toExponential(2)})`);
        ok(late === 0, `sim: the output is exactly the delayed dry from 2.0 s after the apply on (max ${late})`);
    }
    // sleep: silence for 0.5 s -> exact zeros, ASLEEP 1, ALIVE/FRAMES moving; a hit wakes it
    {
        const sim = makeSim({});
        let a0 = 0, f0 = 0;
        for (let n = 0; n < 24000; n++) { sim.step(0); if (n === 12000) { a0 = sim.sc(cfg.DV_SCOPE.ALIVE); f0 = sim.sc(cfg.DV_SCOPE.FRAMES); } }
        ok(sim.sc(cfg.DV_SCOPE.ASLEEP) === 1 && sim.sc(cfg.DV_SCOPE.ALIVE) > a0 && sim.sc(cfg.DV_SCOPE.FRAMES) > f0, "sim: asleep, ALIVE and FRAMES keep moving");
        sim.P.dvmtrig = 1; sim.step(0); sim.P.dvmtrig = 2;
        for (let n = 0; n < 200; n++) sim.step(0);
        ok(sim.sc(cfg.DV_SCOPE.ASLEEP) === 0 && sim.sc(cfg.DV_SCOPE.HITS) === 1, "sim: a MIDI hit wakes the device");
    }
    // restore from ctl: generation 1, valid, reroll 3, T/E
    {
        const sim = makeSim({ dvseed: 9 });
        const c = sim.data.ctl;
        const T = [10, 20, 30, 40, 50, 60, 70, 80], E = [11, 21, 31, 41, 51, 61, 71, 81];
        c.poke(1, cfg.DV_CTL.FLAGS); c.poke(3, cfg.DV_CTL.REROLL);
        for (let i = 0; i < 8; i++) { c.poke(T[i], cfg.DV_CTL.T + i); c.poke(E[i], cfg.DV_CTL.E + i); }
        c.poke(1, cfg.DV_CTL.GEN);
        for (let n = 0; n < 300; n++) sim.step(0);
        let d = 0;
        for (let i = 0; i < 8; i++) d = Math.max(d, Math.abs(sim.sc(cfg.DV_SCOPE.METAS + i) - E[i]), Math.abs(sim.sc(cfg.DV_SCOPE.DRAWS + i) - T[i]));
        ok(d < 1e-9 && sim.sc(cfg.DV_SCOPE.ECHO + cfg.DV_ECHO.CTL_GEN) === 1, `sim: ctl restore loads T/E (diff ${d}) and echoes the generation`);
        const hv = cfg.dvHiddenFromMetas(E, T);
        let he = 0;
        for (let i = 0; i < cfg.DV_HIDDEN_COUNT; i++) he = Math.max(he, Math.abs(sim.sc(cfg.DV_SCOPE.HIDDEN + i) - hv[i]) / Math.max(1, Math.abs(hv[i])));
        ok(he < 1e-12, "sim: ctl restore applies the page");
        const p = cfg.dvDefaultDrawParams(); p.seed = 9;
        const st = { valid: 1, hits: 0, reroll: 3, serial: 0, gate: 1, T: T.slice(), E: E.slice() };
        for (let n = 0; n < 6000; n++) sim.step(burst(n, 100, 100, 0.8));
        cfg.dvStep(st, p, "hit");
        let d2 = 0;
        for (let i = 0; i < 8; i++) d2 = Math.max(d2, Math.abs(sim.sc(cfg.DV_SCOPE.DRAWS + i) - st.T[i]));
        ok(d2 < 1e-9, `sim: the first hit after a restore continues from the restored counters (diff ${d2})`);
    }
    // no hit before the pre-draw page: Values reach METAS / HIDDEN, a Value change is followed
    {
        const sim = makeSim({});
        for (let n = 0; n < 200; n++) sim.step(0);
        ok(sim.sc(cfg.DV_SCOPE.METAS + 1) === 50 && sim.sc(cfg.DV_SCOPE.PAGE_APPLIED) === 0, "sim: before any draw METAS show the Values and PAGE_APPLIED stays 0");
        sim.P.dvv0 = 80; for (let n = 0; n < 200; n++) sim.step(0);
        ok(sim.sc(cfg.DV_SCOPE.METAS + 0) === 80 && near(sim.sc(cfg.DV_SCOPE.HIDDEN + cfg.DV_HIDDEN_INDEX.snap_amt), cfg.dvHiddenFromMetas([80, 50, 30, 20, 30, 20, 20, 10], [80, 50, 30, 20, 30, 20, 20, 10])[0], 1e-12), "sim: a Value edit before the first draw moves METAS and the hidden page");
    }
    // mode switch while playing: no NaN, no jump larger than a fade step, tap moved, back again
    {
        const sim = makeSim({ dvsplit: 0 });
        let nan = 0, prev = 0, jump = 0, sawMode1 = false;
        for (let n = 0; n < 12000; n++) {
            if (n === 3000) sim.P.dvsplit = 1;
            if (n === 8000) sim.P.dvsplit = 0;
            const y = sim.step(0.5 * Math.sin(n * 0.05));
            if (!Number.isFinite(y)) nan++;
            if (Math.abs(y - prev) > 0.5 * 0.05 * 3 + 0.01) jump = Math.max(jump, Math.abs(y - prev));
            prev = y;
            if (n === 6000 && sim.H.modeCur === 1 && sim.H.latCur === 1279) sawMode1 = true;
        }
        ok(nan === 0 && sawMode1 && sim.H.modeCur === 0 && sim.H.latCur === 256 && sim.H.swGain === 1, `sim: mode switch 256 <-> 1279 completes (nan ${nan})`);
        ok(jump < 0.2, `sim: no click while the tap moves (largest step ${jump})`);
    }
}


// ---- 6. review fixes (Node twins of the audio cases conv_onset, wipe_rehit, stale_wake, reroll_shorten, mix0_exact) ----
const ZERO_R = { dvr0: 0, dvr1: 0, dvr2: 0, dvr3: 0, dvr4: 0, dvr5: 0, dvr6: 0, dvr7: 0 };
{
    // conv_onset: the convolver output of a hit that starts a new life equals the convolution of the hit from its first sample (IR 6, Envelope and Spectral)
    const irm = require("../src/deviate_ir.js");
    const builder = irm.dvIrBuilder(48000);
    while (!builder.done()) builder.step(8);
    const irs = new gx.DataSim(cfg.DV_IR.SAMPS);
    for (const c of builder.chunks()) for (let i = 0; i < c.data.length; i++) irs.a[c.offset + i] = c.data[i];
    irs.a[cfg.DV_IR.READY] = 1;
    const IR = builder.irs[6];
    for (const mode of [0, 1]) {
        for (const start of [3000, 3037]) { // two block phases
            const lat = mode ? 1279 : 256;
            const sim = makeSim(Object.assign({ dvv0: 0, dvv1: 50, dvv2: 0, dvv3: 0, dvv4: 60, dvv5: 0, dvv6: 0, dvv7: 0, dvsplit: mode }, ZERO_R), true);
            sim.data.ir = irs;
            const N = start + 100 + 2600 + lat;
            const x = new Float64Array(N);
            for (let n = 0; n < N; n++) x[n] = burst(n, start, 100, 0.8) * (0.7 + 0.3 * Math.sin(n * 0.37));
            const oL = new Float64Array(N);
            for (let n = 0; n < N; n++) { sim.step(x[n]); oL[n] = sim.data.dvCout.peek(0); }
            let e = 0, en = 0;
            for (let t = start + lat - 20; t < N; t++) {
                let ref = 0;
                for (let k = 0; k < IR.len; k++) { const m = t - lat - k; if (m < start) break; if (m < start + 100) ref += IR.L[k] * x[m]; }
                e += (oL[t] - ref) * (oL[t] - ref); en += ref * ref;
            }
            ok(en > 1e-3 && Math.sqrt(e / en) < 1e-3, `conv_onset: ${mode ? "Spectral" : "Envelope"} mode, burst at ${start}: convolver output = IR * hit from its first sample (rel error ${Math.sqrt(e / Math.max(en, 1e-30)).toExponential(2)}, energy ${en.toExponential(2)})`);
            ok(sim.H.cvArm === 1, "conv_onset: the stream is armed");
        }
    }
}
{
    // wipe_rehit: identical hits at gaps between the end of a life and the next apply of 100 / 400 samples give the same response as at a gap of 6000
    // (the previous hit's wipe is finished or cancelled safely: no holes in the new hit's rings)
    const mk = () => makeSim(Object.assign({ dvv0: 30, dvv1: 50, dvv2: 60, dvv3: 70, dvv4: 70, dvv5: 80, dvv6: 40, dvv7: 10, dvl7: 1 }, ZERO_R), true);
    const tr = cfg.dvRingTr(10);
    const life = Math.round((0.15 + tr + 0.02) * 48000);
    const run = (gap) => {
        const sim = mk();
        const outs = [];
        const per = life + gap;
        for (let h = 0; h < 5; h++) {
            const o = [];
            for (let n = 0; n < per; n++) o.push(sim.step(burst(n, 600, 100, 0.8)));
            outs.push(o);
        }
        return outs;
    };
    const ref = run(6000);
    for (const gap of [100, 400]) {
        const got = run(gap);
        let worst = 0;
        // hit k response over the first `life` samples after its burst (the next burst starts at 600 + per)
        for (let h = 1; h < 5; h++) {
            for (let n = 600; n < life + 100; n++) worst = Math.max(worst, Math.abs(got[h][n] - ref[h][n]));
        }
        ok(worst < 1e-9, `wipe_rehit: gap ${gap}: hits 2..5 equal the isolated response (worst ${worst.toExponential(2)})`);
    }
    // the old behaviour must be detectable by this test: a gap-6000 hit 1 differs from hit 2 only through the hit counter (none here)
    let w2 = 0;
    for (let n = 600; n < life + 100; n++) w2 = Math.max(w2, Math.abs(ref[1][n] - ref[0][n]));
    ok(w2 < 1e-9, `wipe_rehit: isolated hits are identical to each other (${w2.toExponential(2)})`);
}
{
    // stale_wake: delay + slap on for hit 1, off for hit 2, on for hit 3 inside one Ring-100 life: hit 3 has no residue of hit 1
    const V = { dvv0: 0, dvv1: 50, dvv2: 0, dvv3: 0, dvv4: 0, dvv5: 90, dvv6: 0, dvv7: 100 };
    const run = (hits) => {
        const sim = makeSim(Object.assign({}, V, ZERO_R), true);
        const out = [];
        let n = 0;
        for (const h of hits) {
            for (; n < h.t; n++) out.push(sim.step(0));
            sim.P.dvv5 = h.v5;
            for (let q = 0; q < 100; q++, n++) out.push(sim.step(burst(q, 0, 100, 0.8)));
        }
        for (; n < 48000 * 3.4; n++) out.push(sim.step(0));
        return out;
    };
    const sr = 48000;
    const a = run([{ t: 3000, v5: 90 }, { t: 3000 + 0.4 * sr, v5: 0 }, { t: 3000 + 0.8 * sr, v5: 90 }]);
    const b = run([{ t: 3000 + 0.4 * sr, v5: 0 }, { t: 3000 + 0.8 * sr, v5: 90 }]);
    let worst = 0, sig = 0;
    for (let n = 3000 + 0.8 * sr; n < 3000 + 2.8 * sr; n++) { worst = Math.max(worst, Math.abs(a[n] - b[n])); sig = Math.max(sig, Math.abs(b[n])); }
    ok(sig > 0.05 && worst < 1e-9, `stale_wake: hit 3 equals the run without hit 1 (worst diff ${worst.toExponential(2)}, signal ${sig.toFixed(3)})`);
}
{
    // reroll_shorten: a Reroll that shortens Ring mid-tail ramps the envelope out (no jump to 0)
    const sim = makeSim(Object.assign({ dvv0: 30, dvv2: 50, dvv3: 50, dvv4: 0, dvv5: 50, dvv6: 0, dvv7: 100 }, ZERO_R), true);
    let prev = 0, worstDrop = 0, sawLong = 0;
    const sr = 48000;
    for (let n = 0; n < sr * 2.2; n++) {
        if (n === Math.round(sr * 0.6)) { sim.P.dvv7 = 0; sim.P.dvreroll = 0; }
        if (n === Math.round(sr * 0.6) + 100) sim.P.dvreroll = 1;
        sim.step(burst(n, 1000, 100, 0.8));
        const e = sim.H.envLast;
        if (n > sr * 0.5) worstDrop = Math.max(worstDrop, prev - e);
        if (n === Math.round(sr * 0.6) + 90) sawLong = e;
        prev = e;
    }
    ok(sawLong > 0.05, `reroll_shorten: envelope still audible when Ring is shortened (${sawLong.toFixed(3)})`);
    ok(worstDrop < 0.006 && sim.H.envLast === 0, `reroll_shorten: envelope falls at most ${worstDrop.toFixed(5)} per sample and reaches 0`);
}
{
    // Arch Modes in the core: neutral metas are the delayed dry exactly; a Ring 100 life ends at hold + Tr + fade (2.0 s Natural, 8.0 s Wonky / Glitch)
    // with the output back to the exact delayed dry; random hits under every mode stay finite and bounded
    const sr = 48000;
    for (const [md, arch] of [[1, 37], [2, 417], [3, 913]]) {
        const sim = makeSim(Object.assign({ dvv0: 0, dvv1: 50, dvv2: 0, dvv3: 0, dvv4: 0, dvv5: 0, dvv6: 0, dvv7: 0, __arch: arch, __mode: md }, ZERO_R), true);
        const hist = [];
        let bad = 0;
        for (let n = 0; n < 20000; n++) {
            const x = burst(n, 2000, 100, 0.8) + burst(n, 9000, 100, 0.5) + 0.2 * Math.sin(n * 0.03);
            hist.push(x);
            const y = sim.step(x);
            if (n >= 256 && y !== hist[n - 256]) bad++;
        }
        ok(bad === 0, `mode ${cfg.DV_MODES[md]} Arch ${arch}: neutral metas give the delayed dry exactly (${bad} differing samples)`);
    }
    for (const [md, arch] of [[2, 417], [1, 37], [3, 913]]) {
        const tr = cfg.dvModeTrMax(md);
        const end = Math.round((0.15 + tr + 0.02) * sr) + 256 + 96 + 3000 + 400;
        const sim = makeSim(Object.assign({ dvv0: 100, dvv1: 100, dvv2: 100, dvv3: 100, dvv4: 100, dvv5: 100, dvv6: 100, dvv7: 100, __arch: arch, __mode: md }, ZERO_R), true);
        let res = 0, mid = 0, nan = 0, pk = 0;
        for (let n = 0; n < end + 2000; n++) {
            const x = burst(n, 3000, 100, 0.8);
            const y = sim.step(x);
            if (!Number.isFinite(y)) nan++;
            pk = Math.max(pk, Math.abs(y));
            if (n > end) res = Math.max(res, Math.abs(y));
            if (n === Math.round(3000 + 0.6 * tr * sr)) mid = sim.H.envLast;
        }
        ok(nan === 0 && res === 0 && mid > 0 && pk < 4, `mode ${cfg.DV_MODES[md]} Arch ${arch}, every meta 100: the life ends by ${(0.17 + tr).toFixed(2)} s (residue after ${res}, envelope at 0.6 Tr ${mid.toExponential(2)}, peak ${pk.toFixed(2)})`);
    }
    for (const md of [1, 2, 3]) {
        const rng = cfg.dvRng(40 + md);
        let nan = 0, pk = 0;
        for (const arch of [5, 250, 777]) {
            const sim = makeSim({ __arch: arch, __mode: md, dvv0: 70, dvv1: 30, dvv2: 80, dvv3: 90, dvv4: 60, dvv5: 80, dvv6: 90, dvv7: 40, dvseed: arch }, true);
            for (let n = 0; n < sr * 1.6; n++) {
                const y = sim.step(burst(n % 7200, 300, 100, 0.9) + 0.05 * (rng() - 0.5));
                if (!Number.isFinite(y)) nan++;
                pk = Math.max(pk, Math.abs(y));
            }
        }
        ok(nan === 0 && pk < 4, `mode ${cfg.DV_MODES[md]}: hits every 150 ms under three Archs stay finite (peak ${pk.toFixed(2)})`);
    }
}
if (process.env.DV_DEBUG_MOD) {
    const rows = JSON.parse(process.env.DV_DEBUG_MOD);
    const sim = makeSim(Object.assign({ dvv0: 0, dvv1: 50, dvv2: 0, dvv3: 0, dvv4: 0, dvv5: 0, dvv6: 0, dvv7: 100, __rows: rows }, ZERO_R), true);
    const res = [];
    for (let n = 0; n < 48000; n++) {
        const x = process.env.DV_SRC === "tone" ? 0.3 * Math.sin(2 * Math.PI * 440 * n / 48000) + (n >= 4800 && n < 4802 ? 0.8 : 0) : burst(n, 4800, 4800, 0.8);
        const y = sim.step(x);
        res.push(y);
    }
    const hist = [];
    for (let n = 0; n < 48000; n++) hist.push(process.env.DV_SRC === "tone" ? 0.3 * Math.sin(2 * Math.PI * 440 * n / 48000) + (n >= 4800 && n < 4802 ? 0.8 : 0) : burst(n, 4800, 4800, 0.8));
    const w = (a, b) => { let m = 0; for (let n = a * 48; n < b * 48; n++) m = Math.max(m, Math.abs(res[n] - (n >= 256 ? hist[n - 256] : 0))); return m.toFixed(4); };
    console.log("DEBUG", [110,120,130,140,150,160,170,180,190,200,220,260].map((a)=>w(a,a+10)).join(" "), w(105, 130), w(130, 200), w(200, 300), w(400, 1500), "q76", sim.data.dvQ.peek(76), "q87", sim.data.dvQ.peek(87), "zf", sim.data.dvRsp.peek(5));
}
{
    // mix0_exact: Mix 0 is the delayed dry, bit for bit, also for +12 dBFS input, after Mix moved 1 -> 0, with a NaN residue and through sleep
    const mkX = (n) => 4 * Math.sin(n * 0.013) * (n % 9000 < 4000 ? 1 : 0.3) + burst(n, 2000, 100, 3);
    const sim = makeSim({ dvwet: 1, dvv0: 60, dvv2: 60, dvv3: 60, dvv5: 60, dvv6: 60, dvv7: 30 }, true);
    const hist = [];
    let bad = 0, nan = 0;
    for (let n = 0; n < 60000; n++) {
        if (n === 12000) sim.P.dvwet = 0;
        const x = mkX(n);
        hist.push(x);
        const y = sim.step(x);
        if (!Number.isFinite(y)) nan++;
        if (n > 12000 + 9000 && y !== (n >= 256 ? hist[n - 256] : 0)) bad++;
    }
    ok(bad === 0 && nan === 0 && sim.H.wsm === 0, `mix0_exact: after Mix moved to 0 the output is the delayed dry bit for bit incl. +12 dBFS (${bad} mismatches, wsm ${sim.H.wsm})`);
    // quiet input below the sleep threshold is passed through, not zeroed
    const sim2 = makeSim({ dvwet: 0 }, true);
    let bad2 = 0, asleepSeen = 0;
    const h2 = [];
    for (let n = 0; n < 40000; n++) {
        const x = 4e-6 * Math.sin(n * 0.2);
        h2.push(x);
        const y = sim2.step(x);
        if (sim2.sc(cfg.DV_SCOPE.ASLEEP) === 1) asleepSeen++;
        if (y !== (n >= 256 ? h2[n - 256] : 0)) bad2++;
    }
    ok(bad2 === 0 && asleepSeen > 1000, `mix0_exact: a signal under the sleep threshold passes through asleep (${bad2} mismatches, asleep ${asleepSeen} ticks)`);
    // digital silence stays exact zero asleep
    const sim3 = makeSim({ dvwet: 1 }, true);
    let nz = 0;
    for (let n = 0; n < 30000; n++) { const y = sim3.step(0); if (n > 20000 && y !== 0) nz++; }
    ok(nz === 0 && sim3.sc(cfg.DV_SCOPE.ASLEEP) === 1, "mix0_exact: digital silence asleep is exact zeros");
    // a bad residue cannot touch the dry at Mix 0 (DataSim refuses non-finite pokes, so this one is structural): the residue is fixnan'd before it is scaled and
    // Mix 0 selects the delayed dry itself
    ok(code.includes("resL = fixnan(resL);") && code.includes("limL = (wsmN > 0) ? limSL : xdL;") && code.includes("o1 = fixnan(limL * sgN);"), "mix0_exact: residue fixnan'd first, Mix 0 selects xd (no sleep zeroing, no soft limit of the dry)");
    ok(!/outScale/.test(code), "mix0_exact: no outScale zeroing when asleep");
}

console.log(`${checks} checks, ${fails} failed`);
if (fails) { console.log("FAIL"); process.exit(1); }
console.log("PASS");
