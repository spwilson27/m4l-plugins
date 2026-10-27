#!/usr/bin/env node
"use strict";
// sweep2(scopes) red tests: Analyzer + Oscilloscope scope ring vs sample rate.
// Root cause: both devices share a 4096-sample scope ring (src/analyzer_core.genexpr
// scopeIx wraps at 4096; AN_SCOPE_N / OSC_RING_N = 4096), so any window longer than
// 4096 samples (or 0.9 x that for the oscilloscope) is silently truncated.
const fs = require("fs");
const path = require("path");
const VM = require("vm");
const ROOT = path.resolve(__dirname, "..");
const osc = require("../src/oscilloscope_config.js");

let failed = 0, passed = 0;
function ok(c, m) { if (c) { passed++; console.log("ok - " + m); } else { failed++; console.log("not ok - " + m); } }

// --- SC-01: Analyzer 5/20/50 ms scope windows at 96/192 kHz --------------------------
function loadAnalyzerFace() {
    const HEAD = 3000;
    function FakeBuffer() {}
    FakeBuffer.prototype.peek = function (chan, start, count) {
        const out = [];
        for (let i = 0; i < count; i++) {
            if (start === 0) out.push([1, 48000, HEAD, HEAD][i] || 0);
            else out.push(Math.sin(2 * Math.PI * (start + i) / 480));
        }
        return out;
    };
    const sb = {
        Math, Number, String, Array, Object, Float64Array, Date, console, Buffer: FakeBuffer,
        outlet() {}, notifyclients() {}, post() {},
        arrayfromargs: (a) => Array.prototype.slice.call(a),
        mgraphics: { init() {}, redraw() {}, size: [392, 169], relative_coords: 0, autofill: 0 }
    };
    VM.createContext(sb);
    VM.runInContext(fs.readFileSync(path.join(ROOT, "src/analyzer_config.js"), "utf8"), sb);
    VM.runInContext(fs.readFileSync(path.join(ROOT, "src/analyzer_ui.js"), "utf8"), sb);
    return sb;
}
const face = loadAnalyzerFace();
const MS = [5, 20, 50];
for (const sr of [96000, 192000]) {
    for (let t = 0; t < 3; t++) {
        face.anScopeTime = t; face.anSr = sr; face.anScopeL = null;
        face.anTakeScope();
        const want = Math.round(sr * MS[t] / 1000);
        const got = face.anScopeL ? face.anScopeL.length : -1;
        ok(got === want, "SC-01 Analyzer " + MS[t] + " ms scope window at " + sr / 1000 + " kHz holds " + want + " samples (got " + got + ")");
    }
}

// --- SC-02: Oscilloscope multi-cycle windows silently truncated -----------------------
function sine(f, r, n) { const a = []; for (let i = 0; i < n; i++) a.push(0.8 * Math.sin(2 * Math.PI * f * i / r)); return a; }
function frame(f, r, mode) {
    const s = sine(f, r, 4096);
    return osc.oscComputeFrame(s, s, r, { chMode: 0, cycleMode: mode, trigLevel: 0, points: 336, pitchState: osc.oscCreatePitchState() });
}
for (const [f, r, mode, n] of [[100, 48000, 3, 8], [50, 48000, 2, 4], [100, 96000, 3, 8]]) {
    const fr = frame(f, r, mode);
    const periods = fr.spanSamples * f / r;
    ok(Math.abs(periods - n) < 0.1, "SC-02 Oscilloscope " + n + " Cyc at " + f + " Hz / " + r / 1000 + " kHz spans " + n + " periods (got " + periods.toFixed(2) + ")");
}
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
