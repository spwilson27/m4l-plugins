"use strict";
// Shared Node simulation of the Deviate gen core: builds the gen text exactly as scripts/build_deviate.py does and runs the
// per-sample statements of src/deviate_core.genexpr in Node (History = old value on read, as in Max).
// Used by tests/test_deviate_gen.js and scripts/deviate_variance_report.js.
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const cfg = require("../src/deviate_config.js");
const { stripComments } = require("./lint_lib.js");
const gx = require("./genexpr_functions.js");

const ROOT = path.join(__dirname, "..");
const read = (n) => fs.readFileSync(path.join(ROOT, "src", n), "utf8");

const coreRaw = read("deviate_core.genexpr");
const coreLines = coreRaw.split("\n");
const hiddenText = cfg.dvHiddenGen();
const core = coreLines.map((l) => (l === "//@hidden" ? hiddenText : l)).join("\n");
let full = "";
const buildStatus = { hiddenLineCount: coreLines.filter((l) => l === "//@hidden").length, genOk: false, genErr: "", embedsHidden: false, embedsConvFx: false };
{
    const r = cp.spawnSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import build_deviate; sys.stdout.write(build_deviate.gen_code())"], { cwd: ROOT, encoding: "utf8" });
    buildStatus.genOk = r.status === 0 && r.stdout.length > 1000;
    buildStatus.genErr = (r.stderr || "").split("\n").slice(-2).join(" ");
    full = r.stdout;
    buildStatus.embedsHidden = full.includes(hiddenText);
    buildStatus.embedsConvFx = full.includes(read("deviate_conv.genexpr").trim()) && full.includes(read("deviate_fx.genexpr").trim());
}
globalThis.atan2 = Math.atan2;
const fns = gx.load(full);

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

module.exports = { cfg, gx, full, core, coreRaw, coreLines, hiddenText, fns, makeSim, burst, buildStatus, read };
