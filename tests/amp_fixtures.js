// Host-side fixtures for scripts/run_amp_audio_tests.py (the VM has no node): for each reference
// model in tests/amp_ref, the generated gen code, the weights, a stimulus and the reference output of
// ampForward on that stimulus (zero history, as the gen starts), as float32 WAVs in tests/out/amp.
//   node tests/amp_fixtures.js
"use strict";
const fs = require("fs");
const path = require("path");
const A = require("../src/amp_config.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "tests", "out", "amp");
const SR = 48000;

function stripComments(src) {
    return src.split("\n").map((l) => l.replace(/\/\/(?!@NAM_).*$/, "")).filter((l) => l.trim()).join("\n");
}

function wav32(file, data) {
    const n = data.length;
    const b = Buffer.alloc(44 + n * 4);
    b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVE", 8);
    b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(32, 34);
    b.write("data", 36); b.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) b.writeFloatLE(data[i], 44 + i * 4);
    fs.writeFileSync(file, b);
}

function stimulus(n) {
    const x = new Float64Array(n);
    const notes = [[0, 82.41, 0.7], [0.35, 110, 0.5], [0.7, 146.8, 0.9], [1.05, 98, 0.25]];
    for (const [t0, f, a] of notes) {
        for (let i = Math.floor(t0 * SR); i < n; i++) {
            const t = i / SR - t0;
            const env = a * Math.exp(-t * 3.5) * Math.min(1, t * 400);
            let v = 0;
            for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t + h) / h;
            x[i] += env * v * 0.6;
        }
    }
    for (let i = 0; i < n; i++) x[i] = Math.fround(x[i]);
    return x;
}

// Pre-EQ fixture: a tone stack (Bass 10, Middle 2, Treble 8, Presence 5, Cab Off) as the 56-sample ---ampcf
// buffer (float32 coefficients, valid flag at 50) and the tone stack itself, run like the gen runs it
// (transposed direct form II in doubles on the float32 coefficients).
const PRE_TONE = { bass: 10, mid: 2, treble: 8, presence: 5, cab: 0 };
function preEqFixture() {
    const bq = A.ampToneBiquads(PRE_TONE, SR).map((b) => b.map(Math.fround));
    const cf = new Float64Array(A.AMP_CF_SAMPS);
    bq.forEach((b, q) => b.forEach((v, k) => { cf[q * 5 + k] = v; }));
    cf[50] = 1;
    wav32(path.join(OUT, "cf_pre.wav"), cf);
    return function (x) {
        let y = Float64Array.from(x);
        for (let q = 0; q < 4; q++) {
            const [b0, b1, b2, a1, a2] = bq[q];
            let z1 = 0, z2 = 0;
            const o = new Float64Array(y.length);
            for (let i = 0; i < y.length; i++) {
                const v = y[i], yq = b0 * v + z1;
                z1 = b1 * v - a1 * yq + z2;
                z2 = b2 * v - a2 * yq;
                o[i] = yq;
            }
            y = o;
        }
        return y;
    };
}

// Analog engine fixtures: one gen for every circuit (analog.genexpr), per circuit its table (an_<id>_w.wav, bank 0),
// its ---ampcfa content (tone stack at 0..17, presence at 18, identity cab biquads, valid flag at 50) and the twin's raw
// output on the stimulus. The gen starts the chain on the sample the table copy completes (AA_NW / 128 - 1).
function analogFixtures(x, template) {
    const S = require("./amp_analog_sim.js");
    const AA = S.AA;
    const src = stripComments(fs.readFileSync(path.join(ROOT, "src", "amp_analog_core.genexpr"), "utf8"));
    global.ampFillHooks = A.ampFillHooks;
    fs.writeFileSync(path.join(OUT, "analog.genexpr"), AA.aaGenCode(template, src));
    const start = AA.AA_NW / 128 - 1;
    const ids = [];
    AA.AMP_ANALOG.forEach((r, idx) => {
        const tbl = AA.aaBank(idx, SR, 1);
        wav32(path.join(OUT, `an_${r.id}_w.wav`), Array.from(tbl, Math.fround));
        const cf = new Float64Array(A.AMP_CF_SAMPS);
        AA.aaToneTable(idx, { bass: 5, mid: 5, treble: 5, presence: 5 }, SR).forEach((v, i) => { cf[i] = v; });
        for (let q = 4; q < 10; q++) cf[q * 5] = 1;
        cf[50] = 1;
        wav32(path.join(OUT, `an_${r.id}_cf.wav`), cf);
        const m = S.create(idx, { settle: false });
        const y = new Float64Array(x.length);
        for (let i = start; i < x.length; i++) y[i] = Math.max(-8, Math.min(8, m.raw(x[i])[0]));
        wav32(path.join(OUT, `an_${r.id}_ref.wav`), y);
        ids.push(r.id);
    });
    console.log("analog", ids.join(" "));
}

function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const template = stripComments(fs.readFileSync(path.join(ROOT, "src", "amp_core.genexpr"), "utf8"));
    const n = Math.round(SR * 1.5);
    const x = stimulus(n);
    wav32(path.join(OUT, "stim.wav"), x);
    const preEq = preEqFixture();
    analogFixtures(x, template);
    const names = process.argv.slice(2).length ? process.argv.slice(2) : ["nano", "feather", "standard", "lstm", "lstm2"];
    for (const name of names) {
        const m = A.ampParseNam(fs.readFileSync(path.join(ROOT, "tests", "amp_ref", name + ".nam"), "utf8"));
        // The weights in the buffer are float32; the reference uses the same rounded values.
        m.weights = m.weights.map(Math.fround);
        fs.writeFileSync(path.join(OUT, name + ".genexpr"), A.ampGenCode(template, m));
        wav32(path.join(OUT, name + "_w.wav"), m.weights);
        wav32(path.join(OUT, name + "_ref.wav"), A.ampForward(m, x));
        wav32(path.join(OUT, name + "_pre_ref.wav"), A.ampForward(m, preEq(x)));
        console.log(name, A.ampArchLabel(m), "rf", m.receptiveField);
    }
}

main();
