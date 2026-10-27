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

function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const template = stripComments(fs.readFileSync(path.join(ROOT, "src", "amp_core.genexpr"), "utf8"));
    const n = Math.round(SR * 1.5);
    const x = stimulus(n);
    wav32(path.join(OUT, "stim.wav"), x);
    const names = process.argv.slice(2).length ? process.argv.slice(2) : ["nano", "feather", "standard", "lstm", "lstm2"];
    for (const name of names) {
        const m = A.ampParseNam(fs.readFileSync(path.join(ROOT, "tests", "amp_ref", name + ".nam"), "utf8"));
        // The weights in the buffer are float32; the reference uses the same rounded values.
        m.weights = m.weights.map(Math.fround);
        fs.writeFileSync(path.join(OUT, name + ".genexpr"), A.ampGenCode(template, m));
        wav32(path.join(OUT, name + "_w.wav"), m.weights);
        wav32(path.join(OUT, name + "_ref.wav"), A.ampForward(m, x));
        console.log(name, A.ampArchLabel(m), "rf", m.receptiveField);
    }
}

main();
