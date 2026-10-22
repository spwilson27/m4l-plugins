#!/usr/bin/env node
"use strict";
/**
 * Goal 1: per-call cost of the Spectral Split faces (Node/V8, mock mgraphics; Max's v8 is the same engine, drawing itself is not measured).
 *   node scripts/measure_face_cost.js [N]
 * For each device: paint() (microseconds per call, on a steady mid-level telemetry), and the telemetry poll (microseconds per call that finds
 * a NEW frame = reads the whole buffer, and per call that finds none). A poll runs at 15 fps per instance, paint when something changed.
 */
const fs = require("fs");
const path = require("path");
const { makeRecorder, loadFace } = require("../tests/paint_bounds_lib");

const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8").trimEnd();
const N = Number(process.argv[2]) || 400;
const HEADER = 'var GEN_DSP_TEXT = "";\nvar GEN_DSP_HASH = "x";\nvar SS_PREFIX = "x";\n';
const DEVICES = [
    { slug: "transplit", pre: "TS", poll: "tsPoll", files: ["transplit_config.js", "spectral_link.js", "spectral_theme.js", "spectral_dsp.js", "transplit_ui.js"], header: true, names: "setnames" },
    { slug: "loudsplit", pre: "LS", poll: "lsPoll", files: ["loudsplit_config.js", "spectral_link.js", "spectral_theme.js", "loudsplit_ui.js"], names: "setbuffer" },
    { slug: "harmsplit", pre: "HS", poll: "hsPoll", files: ["harmsplit_config.js", "spectral_link.js", "spectral_theme.js", "harmsplit_ui.js"], names: "setbuffer" },
    { slug: "freqsplit", pre: "FS", poll: "fvPoll", files: ["freqsplit_config.js", "spectral_link.js", "spectral_theme.js", "freqsplit_ui.js"], names: "setbuffer" },
];
function time(fn, n) {
    for (let i = 0; i < 20; i++) fn(i);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) fn(i);
    return Number(process.hrtime.bigint() - t0) / 1000 / n;
}
for (const d of DEVICES) {
    const rec = makeRecorder(444, 169);
    const code = (d.header ? HEADER : "") + d.files.map((f) => read(f)).join("\n\n");
    let counter = 0;
    let cfg;
    try { cfg = require(path.join(SRC, d.slug + "_config.js")); } catch (e) { cfg = {}; }
    const samps = cfg[d.pre + "_SCOPE_SAMPS"] || 800;
    const frameIdx = cfg[d.pre + "_SC_FRAME"];
    const awakeIdx = cfg[d.pre + "_SC_AWAKE"];
    const buf = new Float64Array(samps).fill(0.35);
    const sb = loadFace(code, rec, {
        Buffer: function () { this.peek = (ch, i, n) => { buf[frameIdx] = counter; return Array.from(buf.subarray(i, i + n)); }; this.poke = () => {}; this.framecount = () => samps; this.channelcount = () => 1; },
    });
    if (typeof sb[d.names] === "function") { if (d.names === "setnames") sb.setnames("scope", "ring"); else sb.setbuffer("scope"); }
    if (awakeIdx !== undefined) buf[awakeIdx] = 1;
    const fresh = () => { counter++; sb[d.poll](); };
    const stale = () => { sb[d.poll](); };
    // warm up: fill the histories
    for (let i = 0; i < 100; i++) fresh();
    const tNew = time(fresh, N);
    counter++; sb[d.poll]();
    const tOld = time(stale, N);
    const tPaint = time(() => { rec.begin("x"); sb.paint(); rec.end(); }, N);
    console.log(`${d.slug.padEnd(10)} paint ${tPaint.toFixed(0).padStart(5)} us   poll with a new frame ${tNew.toFixed(0).padStart(5)} us   poll without ${tOld.toFixed(0).padStart(5)} us   (scope ${samps} floats)`);
}
