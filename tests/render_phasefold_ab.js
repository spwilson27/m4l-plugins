#!/usr/bin/env node
"use strict";
// A/B renders of Phase Fold for listening: legacy (before the crispiness fix) vs fixed model.
// Writes 16-bit mono 44.1 kHz WAVs to tests/out/phasefold_ab/:
//   <signal>_dry.wav, <signal>_before_p-100.wav, <signal>_after_p-100.wav (and p0, p100)
// Size 2048, Orig 0, Auto Gain on, Mix 100 %. Outputs are aligned to the dry signal.
// Every file of a signal shares one gain so loudness differences are real.
const fs = require("fs");
const path = require("path");
const mx = require("./phasefold_metrics.js");
const legacy = require("./phasefold_legacy_model.js");
const fixed = require("./phasefold_model.js");

const OUT = path.join(__dirname, "out", "phasefold_ab");
const N = 2048;
const SECONDS = 4;

function wav16(file, x, gain) {
    const buf = Buffer.alloc(44 + x.length * 2);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + x.length * 2, 4);
    buf.write("WAVEfmt ", 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(mx.SR, 24);
    buf.writeUInt32LE(mx.SR * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(x.length * 2, 40);
    for (let i = 0; i < x.length; i++) {
        const v = Math.max(-1, Math.min(1, x[i] * gain));
        buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
    }
    fs.writeFileSync(file, buf);
}

function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const len = mx.SR * SECONDS;
    const signals = {
        saw_chord: mx.chord(len),
        pink_noise: mx.pinkNoise(len, 0.3),
        drum_loop: mx.drums(len),
        sine_1k: mx.sine(len, 1000, 0.5),
    };
    const written = [];
    for (const [name, x] of Object.entries(signals)) {
        const renders = { dry: x };
        for (const p of [-100, 0, 100]) {
            for (const [tag, m] of [["before", legacy], ["after", fixed]]) {
                const y = m.run(x, N, p / 100, 0, true);
                renders[`${tag}_p${p}`] = y.subarray(N - 1, N - 1 + len).slice();
            }
        }
        let peak = 0;
        for (const y of Object.values(renders)) for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]));
        const gain = peak > 0 ? 0.9 / peak : 1;
        for (const [tag, y] of Object.entries(renders)) {
            const file = path.join(OUT, `${name}_${tag}.wav`);
            wav16(file, y, gain);
            written.push(file);
        }
    }
    console.log(`wrote ${written.length} files to ${OUT}`);
}

main();
