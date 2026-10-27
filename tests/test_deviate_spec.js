"use strict";
// Deviate's Spectral split stage (src/deviate_spec.genexpr): the T mask equals Transient Split's Percussive rule (src/transplit_config.js tsMasks),
// the stage is an exact delayed identity when the mask is 1 (latency 1023 + 256 = 1279), and it separates clicks from a steady tone.
// The per-sample statements of the gen are mirrored here around the transpiled library functions (a static check ties the two together).
//   node tests/test_deviate_spec.js

const fs = require("fs");
const path = require("path");
const cfg = require("../src/deviate_config.js");
const ts = require("../src/transplit_config.js");
const gx = require("./genexpr_functions.js");
const L = require("./lint_lib.js");
const lib = require("./deviate_dsp_lib.js");

globalThis.atan2 = Math.atan2;
let fails = 0, checks = 0;
function ok(cond, msg) {
    checks++;
    if (!cond) { fails++; console.log("FAIL: " + msg); }
}
const SR = 48000;
const N = 1024;
const specText = lib.genTexts().spec;
const body = L.stripComments(fs.readFileSync(path.join(__dirname, "..", "src", "deviate_spec.genexpr"), "utf8"));

// ---- the gen's statement order (mirrored below) ----
for (const frag of ["rdy = ss_in(ringL, ringR, stt, in1, in2, 1024);", "ss_frame(fx, ringL, ringR, stt, win, 1024);", "fft_run(fx, tab, 1024, 0);", "ss_mid(fx, ms, 1024);",
    "sp_masks(ms, spd, 1024, samplerate, ageNow);", "ss_apply(fx, spd, 5, 1024);", "fft_run(fx, tab, 1024, 1);", "ss_ola(accL, accR, stt, fx, win, 1024);",
    "yL = ss_out(accL, stt, 1024, 3);", "yR = ss_out(accR, stt, 1024, 4);", "out1 = padL.read(256);", "poke(scope, alN, 49, 0);"]) {
    ok(body.includes(frag), `the spec gen contains: ${frag}`);
}
ok(cfg.DV_SCOPE.SPEC_ALIVE === 49, "DV_SCOPE.SPEC_ALIVE is slot 49");
ok(!/\bsp_masks\([^)]*\)\s*;/.test(body.replace("sp_masks(ms, spd, 1024, samplerate, ageNow);", "")), "sp_masks has one call site");

function stage(maskFn, nSamples, input) {
    const fns = gx.load(specText); // fresh History state (fft_init / stft_win guards)
    if (maskFn) fns.sp_masks = maskFn(fns);
    const D = {
        tab: new gx.DataSim(4096, 3), win: new gx.DataSim(4096), fx: new gx.DataSim(4096, 2), ringL: new gx.DataSim(4096), ringR: new gx.DataSim(4096),
        accL: new gx.DataSim(4096), accR: new gx.DataSim(4096), stt: new gx.DataSim(8), ms: new gx.DataSim(2049, 2), spd: new gx.DataSim(2049, 6),
    };
    const pad = new Float64Array(nSamples + 400);
    const out = new Float64Array(nSamples), outR = new Float64Array(nSamples);
    let age = 0, quiet = 0;
    const masks = [];
    for (let i = 0; i < nSamples; i++) {
        const x = input(i);
        fns.fft_init(D.tab);
        fns.stft_win(D.win, N);
        const inPk = Math.abs(x);
        quiet = inPk < 0.00001 ? Math.min(quiet + 1, 1e8) : 0;
        const awake = quiet < 1024 ? 1 : 0;
        const ageNow = awake ? age : 0;
        const rdy = fns.ss_in(D.ringL, D.ringR, D.stt, x, x, N);
        let ageNext = ageNow;
        if (rdy > 0.5 && awake) {
            fns.ss_frame(D.fx, D.ringL, D.ringR, D.stt, D.win, N);
            fns.fft_run(D.fx, D.tab, N, 0);
            fns.ss_mid(D.fx, D.ms, N);
            fns.sp_masks(D.ms, D.spd, N, SR, ageNow);
            masks.push({ mag: Float64Array.from({ length: 513 }, (_, k) => D.ms.peek(k, 0)), ph: Float64Array.from({ length: 513 }, (_, k) => D.ms.peek(k, 1)),
                mask: Float64Array.from({ length: 513 }, (_, k) => D.spd.peek(k, 5)), age: ageNow });
            fns.ss_apply(D.fx, D.spd, 5, N);
            fns.fft_run(D.fx, D.tab, N, 1);
            fns.ss_ola(D.accL, D.accR, D.stt, D.fx, D.win, N);
            ageNext = Math.min(ageNow + 1, 3);
        }
        age = ageNext;
        out[i] = fns.ss_out(D.accL, D.stt, N, 3);
        outR[i] = fns.ss_out(D.accR, D.stt, N, 4);
        pad[i] = out[i];
    }
    return { out, outR, masks };
}

// ---- 1. mask 1 everywhere: T is the input delayed 1023 samples (+256 in the gen's pad = 1279) exactly ----
{
    const r = cfg.dvRng(5);
    const x = new Float64Array(12000);
    for (let i = 0; i < x.length; i++) x[i] = (r() * 2 - 1) * 0.5;
    const R = stage((fns) => (ms, spd, n) => { for (let k = 0; k <= n / 2; k++) spd.poke(1, k, 5); return 0; }, x.length, (i) => x[i]);
    let worst = 0;
    for (let i = 1023; i < x.length; i++) worst = Math.max(worst, Math.abs(R.out[i] - x[i - 1023]));
    ok(worst < 1e-12, `unit mask: the stage output is the input delayed 1023 samples (worst ${worst.toExponential(2)}); the gen adds 256 more`);
}

// ---- 2. the mask rule equals Transient Split's Percussive rule ----
{
    const r = cfg.dvRng(9);
    const nS = 60000;
    const tone = (i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / SR) + 0.05 * Math.sin(2 * Math.PI * 3100 * i / SR);
    const click = (i) => ((i % 9600) < 2 && i > 5000 ? 0.8 : 0);
    const noiseBurst = (i) => (i > 30000 && i < 31500 ? (r() * 2 - 1) * 0.5 : 0);
    const R = stage(null, nS, (i) => tone(i) + click(i) + noiseBurst(i));
    const st = ts.tsNewState(N);
    const tilts = ts.tsTiltTables(N, SR);
    const outTr = new Float64Array(513), outTone = new Float64Array(513);
    let worst = 0;
    const p = { ttype: 0, bias: 0, tdecay: 8, tsmooth: 1.5, tilt: 0, tmode: 0, blend: 0.5 };
    for (const f of R.masks) {
        st.age = f.age;
        ts.tsMasks(st, f.mag, f.ph, p, SR, tilts, outTr, outTone);
        for (let k = 0; k <= 512; k++) worst = Math.max(worst, Math.abs(f.mask[k] - outTr[k]));
    }
    ok(R.masks.length > 100 && worst < 1e-9, `T mask == tsMasks Percussive (Bias 0, Decay 8, Smoothing 1.5) over ${R.masks.length} frames (worst ${worst.toExponential(2)})`);
}

// ---- 3. clicks over a steady tone: T keeps the clicks, little of the tone ----
{
    const clicks = [6000, 16000, 26000, 36000];
    const tone = (i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / SR);
    const ck = (i) => (clicks.some((c) => i >= c && i < c + 2) ? 0.8 : 0);
    const nS = 46000;
    const R = stage(null, nS, (i) => tone(i) + ck(i));
    let clickE = 0, clickT = 0, toneE = 0, toneT = 0;
    for (const c of clicks) {
        clickE += 2 * 0.64;
        for (let i = c - 100; i < c + 1400; i++) clickT += R.out[i + 1023] * R.out[i + 1023];
        for (let i = c + 2400; i < c + 7200 && i + 1023 < nS; i++) { toneE += tone(i) * tone(i); toneT += R.out[i + 1023] * R.out[i + 1023]; }
    }
    ok(clickT / clickE > 0.25, `T keeps the clicks (${(clickT / clickE).toFixed(2)} of their energy)`);
    ok(toneT / toneE < 0.02, `T keeps little of the steady tone (${(toneT / toneE).toExponential(2)})`);
    let nan = 0;
    for (const v of R.out) if (!Number.isFinite(v)) nan++;
    ok(nan === 0, "no NaN");
}

// ---- 4. silence: exact zeros, and a wake-up restarts the analysis (age 0) ----
{
    const R = stage(null, 20000, (i) => (i > 8000 && i < 8100 ? 0.5 * Math.sin(i) : 0));
    let late = 0;
    for (let i = 14000; i < 20000; i++) late = Math.max(late, Math.abs(R.out[i]));
    ok(late === 0, "silence gives exact zeros after the tail");
}

console.log(`${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
