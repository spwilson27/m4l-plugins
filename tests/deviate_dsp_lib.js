"use strict";
// Shared helpers of the Deviate DSP Node tests (tests/test_deviate_fx.js, test_deviate_conv.js, test_deviate_spec.js): the gen texts exactly as
// the build makes them, small signal utilities.
const cp = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
let cache = null;

/** @returns {{full: string, spec: string}} build_deviate.gen_code() and build_deviate.spec_code() */
function genTexts() {
    if (!cache) {
        const r = cp.spawnSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'scripts'); import build_deviate as b; sys.stdout.write(json.dumps({'full': b.gen_code(), 'spec': b.spec_code()}))"],
            { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
        if (r.status !== 0) throw new Error("build_deviate failed: " + r.stderr);
        cache = JSON.parse(r.stdout);
    }
    return cache;
}

/** Goertzel magnitude (amplitude of a sine) of x[from, to) at frequency f. */
function tone(x, f, sr, from, to) {
    let c = 0, s = 0;
    const n = to - from;
    for (let i = from; i < to; i++) {
        const w = 2 * Math.PI * f * (i - from) / sr;
        c += x[i] * Math.cos(w);
        s += x[i] * Math.sin(w);
    }
    return 2 * Math.sqrt(c * c + s * s) / n;
}

function rms(x, from, to) {
    let s = 0;
    for (let i = from; i < to; i++) s += x[i] * x[i];
    return Math.sqrt(s / Math.max(1, to - from));
}

function peak(x, from, to) {
    let m = 0;
    for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i]));
    return m;
}

module.exports = { ROOT, genTexts, tone, rms, peak };
