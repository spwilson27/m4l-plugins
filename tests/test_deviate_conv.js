"use strict";
// Deviate's convolver (src/deviate_conv.genexpr dvc_tick, a fork of Reverb+'s with 48 tail slots and a per-input-slot IR tag) against direct
// convolution: single IRs of every size class, a mid-run IR change (older input blocks keep their IR: the tag), an IR with fewer partitions than
// its neighbours, no IR loaded, and a state wipe by dv_wipe. Run through tests/genexpr_functions.js (bounds-checked Data).
//   node tests/test_deviate_conv.js

const cfg = require("../src/deviate_config.js");
const irm = require("../src/deviate_ir.js");
const gx = require("./genexpr_functions.js");
const lib = require("./deviate_dsp_lib.js");

globalThis.atan2 = Math.atan2;
let fails = 0, checks = 0;
function ok(cond, msg) {
    checks++;
    if (!cond) { fails++; console.log("FAIL: " + msg); }
}
const SR = 48000;
let fns = gx.load(lib.genTexts().full);

// ---- the IR bank exactly as the engine writes it ----
const builder = irm.dvIrBuilder(SR);
while (!builder.done()) builder.step(8);
const irs = new gx.DataSim(cfg.DV_IR.SAMPS);
for (const c of builder.chunks()) for (let i = 0; i < c.data.length; i++) irs.a[c.offset + i] = c.data[i];
irs.a[cfg.DV_IR.READY] = 1;
const plan = builder.plan;
const bank = builder.irs; // fitted time-domain IRs {L, R, len}
const dirOf = (i) => [1, plan.irs[i].offset, plan.irs[i].nHead, plan.irs[i].nTail];

function makeState() {
    fns = gx.load(lib.genTexts().full); // every History inside a function (fft_init's guard) is persistent per load: fresh functions, fresh state
    const S = {
        tab: new gx.DataSim(4096, 3), cvr: new gx.DataSim(8192, 2), cxh: new gx.DataSim(256, 2), cxt: new gx.DataSim(4096, 2),
        fdh: new gx.DataSim(16512), fdt: new gx.DataSim(393408), ohr: new gx.DataSim(512, 2), otr: new gx.DataSim(8192, 2),
        cp: new gx.DataSim(4), tgh: new gx.DataSim(32, 3), tgt: new gx.DataSim(48, 3), ach: new gx.DataSim(192), cout: new gx.DataSim(2), cn: 0,
    };
    fns.fft_init(S.tab);
    return S;
}
function setCp(S, d) { for (let k = 0; k < 4; k++) S.cp.poke(d[k], k); }
function tick(S, xl, xr) {
    fns.dvc_tick(S.cn, xl, xr, S.tab, S.cvr, S.cxh, S.cxt, S.fdh, S.fdt, S.ohr, S.otr, irs, S.cp, S.tgh, S.tgt, S.ach, S.cout);
    S.cn++;
    return [S.cout.peek(0), S.cout.peek(1)];
}
function noise(seed, n, amp) {
    const r = cfg.dvRng(seed);
    const a = new Float64Array(n);
    for (let i = 0; i < n; i++) a[i] = (r() * 2 - 1) * amp;
    return a;
}
function direct(ir, x, n, ch) {
    // y[m] = sum_k IR[k] x[m - k]; out[cn] = y[cn - 256]
    const h = ch ? ir.R : ir.L;
    const y = new Float64Array(n);
    for (let m = 0; m < x.length; m++) {
        if (x[m] === 0) continue;
        const lim = Math.min(h.length, n - 256 - m);
        for (let k = 0; k < lim; k++) y[m + k + 256] += h[k] * x[m];
    }
    return y;
}
function addTo(a, b) { for (let i = 0; i < a.length; i++) a[i] += b[i]; return a; }
function err(a, b) {
    let e = 0, s = 0;
    for (let i = 0; i < a.length; i++) { e += (a[i] - b[i]) * (a[i] - b[i]); s += b[i] * b[i]; }
    return { rel: Math.sqrt(e / Math.max(s, 1e-30)), energy: s };
}

// ---- 1. one IR at a time: every size class (head only, head + 1 tail, many tail partitions, the longest) ----
for (const idx of [0, 2, 5, 9]) {
    const S = makeState();
    setCp(S, dirOf(idx));
    const ir = bank[idx];
    const N = ir.len + 256 + 4096;
    const xl = new Float64Array(N), xr = new Float64Array(N);
    xl.set(noise(10 + idx, 1500, 0.6)); xr.set(noise(50 + idx, 1500, 0.6));
    const oL = new Float64Array(N), oR = new Float64Array(N);
    for (let i = 0; i < N; i++) { const o = tick(S, xl[i], xr[i]); oL[i] = o[0]; oR[i] = o[1]; }
    const eL = err(oL, direct(ir, xl, N, 0)), eR = err(oR, direct(ir, xr, N, 1));
    ok(eL.rel < 1e-4 && eR.rel < 1e-4 && eL.energy > 1, `IR ${idx} (${plan.irs[idx].len} samples, ${plan.irs[idx].nHead} head + ${plan.irs[idx].nTail} tail partitions): ` +
        `convolver equals direct convolution (rel error L ${eL.rel.toExponential(2)}, R ${eR.rel.toExponential(2)})`);
}

// ---- 2. a new hit with another IR while the old one still rings: every input block keeps the IR it was captured with ----
{
    const A = 2, B = 4; // 0.35 s (7 tail partitions) and 1.2 s (26)
    const S = makeState();
    setCp(S, dirOf(A));
    const N = bank[B].len + 256 + 9000;
    const xA = new Float64Array(N), xB = new Float64Array(N);
    xA.set(noise(71, 1500, 0.5), 0);
    xB.set(noise(72, 1500, 0.5), 4200);
    const out = new Float64Array(N), outR = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        if (i === 4097) setCp(S, dirOf(B)); // after the frames that still hold hit A (a frame carries the last two blocks)
        const o = tick(S, xA[i] + xB[i], 0);
        out[i] = o[0]; outR[i] = o[1];
    }
    const ref = addTo(direct(bank[A], xA, N, 0), direct(bank[B], xB, N, 0));
    const e = err(out, ref);
    ok(e.rel < 1e-4, `per-slot IR tags: hit A (IR ${A}) keeps ringing with its own IR after hit B (IR ${B}) was captured (rel error ${e.rel.toExponential(2)})`);
    // the right channel got no input: its output is the IR_R response of nothing = 0 (the convolver is channel-wise)
    ok(lib.peak(outR, 0, N) < 1e-9, "channel-wise: silence in R gives silence out of R");
    // the single-IR reference would be wrong: switching all blocks to B would change the first part of the output
    const refB = addTo(direct(bank[B], xA, N, 0), direct(bank[B], xB, N, 0));
    ok(err(out, refB).rel > 0.05, "the tags matter (a shared IR gives a different result)");
}

// ---- 3. an IR change right at a tail-block boundary with a longer first IR, and the reverse order ----
{
    const A = 9, B = 0; // 96000 samples (45 tail partitions) then a 0.25 s IR
    const S = makeState();
    setCp(S, dirOf(A));
    const N = bank[A].len + 256 + 9000;
    const xA = new Float64Array(N), xB = new Float64Array(N);
    xA.set(noise(81, 800, 0.5), 100);
    xB.set(noise(82, 800, 0.5), 8300);
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        if (i === 8192) setCp(S, dirOf(B));
        out[i] = tick(S, xA[i] + xB[i], 0)[0];
    }
    const ref = addTo(direct(bank[A], xA, N, 0), direct(bank[B], xB, N, 0));
    const e = err(out, ref);
    ok(e.rel < 1e-4, `long IR followed by a short one: both tails correct (rel error ${e.rel.toExponential(2)})`);
}

// ---- 4. no IR loaded: exact zeros; wipe: a used convolver wiped by dv_wipe behaves like a fresh one ----
{
    const S = makeState();
    setCp(S, [0, 0, 0, 0]);
    let m = 0;
    for (let i = 0; i < 6000; i++) m = Math.max(m, Math.abs(tick(S, Math.sin(i * 0.1), 0.3)[0]));
    ok(m === 0, "loaded = 0 gives exact zeros");
}
{
    const S = makeState();
    const idx = 3; // small plate, 0.8 s
    setCp(S, dirOf(idx));
    const N1 = bank[idx].len + 256 + 3000;
    for (let i = 0; i < N1; i++) tick(S, i < 1200 ? 0.5 * Math.sin(i * 0.2) : 0, 0.2);
    // the core's wipe: 1536 slices of every array
    for (let j = 0; j < 1536; j++) {
        fns.dv_wipe(S.fdt, j, 257, 393408, 0);
        fns.dv_wipe(S.fdh, j, 11, 16512, 0);
        fns.dv_wipe(S.cvr, j, 6, 8192, 1);
        fns.dv_wipe(S.otr, j, 6, 8192, 1);
        fns.dv_wipe(S.ohr, j, 1, 512, 1);
    }
    S.cn = 0; // the core restarts the counter with the wipe, so the pipeline begins at a clean phase (no half-finished job)
    let silent = 0;
    for (let i = 0; i < 5000; i++) silent = Math.max(silent, Math.abs(tick(S, 0, 0)[0]) + Math.abs(tick(S, 0, 0)[1]));
    ok(silent === 0, "after the wipe the convolver outputs exact zeros for zero input (no old residue)");
    const x = noise(91, 1000, 0.5);
    const N2 = bank[idx].len + 256 + 4096;
    const start = S.cn;
    const o = new Float64Array(N2);
    for (let i = 0; i < N2; i++) o[i] = tick(S, i < 1000 ? x[i] : 0, 0)[0];
    // out[start + i] = y[i - 256 + ...]: compare with direct convolution of the burst starting at 0 (the wipe point is the origin of this burst)
    const ref = direct(bank[idx], Float64Array.from([...x, ...new Float64Array(N2 - 1000)]), N2, 0);
    ok(err(o, ref).rel < 1e-4, `a wiped convolver convolves the next hit correctly (rel error ${err(o, ref).rel.toExponential(2)}, started at cn ${start})`);
}

console.log(`${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
