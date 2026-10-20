#!/usr/bin/env node
// Reference helper for scripts/run_tsplit_audio_tests.py (host side, pure Node; it never starts Max).
//   node tests/tsplit_ref_cli.js info                    -> one JSON line: sample rate, length, learned centroids, events
//   node tests/tsplit_ref_cli.js stimulus <out.wav>      -> mono float32 WAV, the drum sequence (L channel of synthDrumLoop)
//   node tests/tsplit_ref_cli.js silence <out.wav> <s>   -> mono float32 WAV of zeros
//   node tests/tsplit_ref_cli.js render <out.raw>        -> planar little-endian float32: chain 1, 2, 3 outputs of
//                                                           src/tsplit_ref.js (masks 1, 2, 4) for the same stimulus,
//                                                           centroids from `info`, Classes 3 / Sharp 60 / Smooth 8
// The stimulus is the mono drum sequence of tests/test_tsplit.js; the Max patch feeds it to in1 and in2.

"use strict";
const fs = require("fs");
const path = require("path");
const R = require(path.join(__dirname, "..", "src", "tsplit_ref.js"));
const C = require(path.join(__dirname, "..", "src", "tsplit_config.js"));

const SR = 48000;
const SECONDS = 11.2;
const PARAMS = { classes: 3, sharp: 60, smooth: 8 };

function stimulus() {
    const sig = R.synthDrumLoop(SR, R.defaultDrumPattern(), SECONDS);
    return { mono: sig.L, events: sig.events };
}

function learnCentroids(mono) {
    const split = new R.TimbreSplitRef(SR, { classes: 3 });
    const learner = C.createKMeansLearner(3, 4242);
    split.onHop = (h) => { if (h.feat) learner.add(h.feat); };
    for (let i = 0; i < mono.length; i++) split.push(mono[i], mono[i]);
    return learner.finalize();
}

function writeWav(file, samples, sr) {
    const n = samples.length * 4;
    const b = Buffer.alloc(44 + n);
    b.write("RIFF", 0, "ascii");
    b.writeUInt32LE(36 + n, 4);
    b.write("WAVEfmt ", 8, "ascii");
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(3, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(sr, 24);
    b.writeUInt32LE(sr * 4, 28);
    b.writeUInt16LE(4, 32);
    b.writeUInt16LE(32, 34);
    b.write("data", 36, "ascii");
    b.writeUInt32LE(n, 40);
    for (let i = 0; i < samples.length; i++) b.writeFloatLE(samples[i], 44 + 4 * i);
    fs.writeFileSync(file, b);
}

const cmd = process.argv[2];
if (cmd === "info") {
    const s = stimulus();
    process.stdout.write(JSON.stringify({
        sr: SR, total: s.mono.length, params: PARAMS, centroids: learnCentroids(s.mono), events: s.events,
    }) + "\n");
} else if (cmd === "stimulus") {
    writeWav(process.argv[3], stimulus().mono, SR);
} else if (cmd === "silence") {
    writeWav(process.argv[3], new Float64Array(Math.round(Number(process.argv[4] || 3) * SR)), SR);
} else if (cmd === "render") {
    const s = stimulus();
    const cents = learnCentroids(s.mono);
    const out = R.renderChains(SR, PARAMS, cents, s.mono, s.mono, [1, 2, 4]);
    const buf = Buffer.alloc(3 * s.mono.length * 4);
    for (let c = 0; c < 3; c++) {
        for (let i = 0; i < s.mono.length; i++) buf.writeFloatLE(out.outL[c][i], 4 * (c * s.mono.length + i));
    }
    fs.writeFileSync(process.argv[3], buf);
} else {
    process.stderr.write("usage: tsplit_ref_cli.js info | stimulus <wav> | silence <wav> <seconds> | render <raw>\n");
    process.exit(2);
}
