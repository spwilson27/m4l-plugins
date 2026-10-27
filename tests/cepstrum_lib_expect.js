#!/usr/bin/env node
"use strict";
// Prints the level change (dB) the reference gives for the Max audio test
// signal (noise 0.2 + sine 0.3 at 440 Hz) through a min or max phase STFT.
// usage: cepstrum_lib_expect.js <min|max> <n> <samplerate>
const ref = require("../src/cepstrum_ref.js");

function level(kind, n, sr) {
let s = 1;
const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2147483648 - 1;
};
const len = n * 40;
const x = new Float64Array(len);
for (let i = 0; i < len; i++) x[i] = 0.2 * rnd() + 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr);
const stft = new ref.Stft(n, (re, im) => {
    const folded = kind === "max" ? ref.foldMaxPhase : ref.foldMinPhase;
    const ls = ref.cepToLogSpec(folded(ref.realCepstrum(re, im, 1e-9)));
    const sp = ref.expSpec(ls.re, ls.im, 1e-9);
    re.set(sp.re);
    im.set(sp.im);
});
const y = stft.run(x);
let a = 0;
let b = 0;
for (let i = len - n * 8; i < len; i++) {
    a += x[i] * x[i];
    b += y[i] * y[i];
}
return (10 * Math.log10(b / a)).toFixed(3);
}

// `--all` writes tests/cepstrum_lib_expect.json (kind_n_sr -> level dB): the VM has no node, so the audio runner reads this file.
if (process.argv[2] === "--all") {
    const out = {};
    for (const kind of ["min", "max"]) for (const n of [512, 1024, 2048, 4096]) for (const sr of [44100, 48000]) out[`${kind}_${n}_${sr}`] = level(kind, n, sr);
    require("fs").writeFileSync(require("path").join(__dirname, "cepstrum_lib_expect.json"), JSON.stringify(out, null, 1) + "\n");
} else {
    console.log(level(process.argv[2], parseInt(process.argv[3], 10), parseFloat(process.argv[4])));
}
