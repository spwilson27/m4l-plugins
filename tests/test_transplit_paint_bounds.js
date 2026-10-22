#!/usr/bin/env node
"use strict";
/**
 * Paint bounds for the Transient Split face: every fill / stroke / text must lie inside a legitimate region of the canvas
 * (plot, the two sliders, Post button, legend row, value rows, footnote) at extreme parameter and telemetry values, no text may
 * overlap another text, and the interactive hit rects must be inside the canvas. Uses tests/paint_bounds_lib.js.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeRecorder, loadFace, checkRecording, grid } = require("./paint_bounds_lib");

const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8").trimEnd();
// same order as scripts/build_transplit.py
const code = [read("transplit_config.js"), read("spectral_link.js"), read("spectral_theme.js"), fs.readFileSync(path.join(SRC, "transplit_ui.js"), "utf8")].join("\n\n");

const W = 280, H = 141;
const rec = makeRecorder(W, H);
const sb = loadFace(code, rec);
const P = sb.TS_PLOT, SL = sb.TS_SLIDER_L, SR = sb.TS_SLIDER_R;
// sptLcd draws the display background, grid and frame: furniture, not content
const origLcd = sb.sptLcd;
sb.sptLcd = function () { const n = rec.shapes.length; origLcd.apply(null, arguments); rec.shapes.length = n; };

const regions = [
    P,                                                  // plot (waveform / sonogram, Post button, no-signal text)
    { x: SL.x - 3, y: 2, w: SL.w + 6, h: 88 },           // bias slider incl. hollow handle
    { x: SR.x - 3, y: 2, w: SR.w + 6, h: 88 },           // blend slider
    { x: 0, y: 95, w: W, h: 13 },                        // legend row + style icons + chain chip
    { x: 0, y: 111, w: W, h: 16 },                       // Tilt / Decay / Smoothing
    { x: 0, y: 128, w: W, h: 13 }                        // latency footnote
];

function textOverlaps(shapes, label, out) {
    const t = shapes.filter((s) => s.kind === "text");
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        const a = t[i], b = t[j];
        if (a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5) out.push(`${label}: texts "${a.text}" and "${b.text}" overlap`);
    }
}

const BAD = [NaN, -1e9, 1e9, Infinity];
function fillTelemetry(kind) {
    const v = kind === "nan" ? NaN : kind === "huge" ? 1e9 : kind === "neg" ? -5 : kind === "inf" ? Infinity : kind === "one" ? 1 : 0.5;
    for (let c = 0; c < sb.TS_NCOLS; c++) { sb.tsPre[c] = v; sb.tsTr[c] = v; sb.tsTone[c] = v; sb.tsFrac[c] = v; }
    sb.tsWave = [];
    for (let i = 0; i < sb.TS_WAVE_VIEW; i++) sb.tsPushWave(v, v, v, v);
    sb.tsSono = [];
    sb.tsSel = 0;
    for (let i = 0; i < sb.TS_SONO_ROWS; i++) sb.tsPushSono();
}

let n = 0;
const failures = [];
const tele = ["nan", "huge", "neg", "inf", "one", "mid"];
for (const tk of tele) {
    for (const g of grid({
        bias: [-100, 0, 100, -1e9, 1e9, NaN], blend: [0, 50, 100, -50, 1e9, NaN], dispost: [0, 1], disstyle: [0, 1], awake: [0, 1],
        sel: [0, 1, 2], tilt: [-1e9, 100, 1e9, NaN], tdecay: [1, 125, 1e9, NaN]
    })) {
        // skip part of the full product to keep the test fast: all bias/blend extremes only with sel 0 and tilt/decay extremes once
        if ((g.sel !== 0 && (g.tilt !== 100 || g.tdecay !== 125)) || (g.tilt !== 100 && g.tdecay !== 125 && (g.bias !== 0 || g.blend !== 50))) continue;
        fillTelemetry(tk);
        Object.assign(sb.tsVals, { bias: g.bias, blend: g.blend, dispost: g.dispost, disstyle: g.disstyle, tilt: g.tilt, tdecay: g.tdecay, tsmooth: g.tdecay });
        sb.tsScalars.awake = g.awake;
        sb.tsSel = g.sel;
        sb.tsInfo = { instanceId: "t", isInRack: true, chainIndex: 99, chainCount: 100, peers: 100, linked: true, autoChannel: 0 };
        sb.tsDrag = (n % 3 === 0) ? { kind: "bias" } : null;
        const label = `tele=${tk} ${JSON.stringify(g)}`;
        rec.begin(label);
        sb.paint();
        rec.end();
        textOverlaps(rec.shapes, label, rec.bad);
        const v = checkRecording(rec, { regions });
        if (v.length) failures.push(...v);
        rec.bad.length = 0;
        n++;
    }
}
// no rack
sb.tsInfo = { instanceId: "", isInRack: false, chainIndex: 0, chainCount: 0, peers: 1, linked: false, autoChannel: -1 };
fillTelemetry("mid");
rec.begin("norack"); sb.paint(); rec.end();
failures.push(...checkRecording(rec, { regions }));
rec.bad.length = 0;
// preview state
sb.preview();
rec.begin("preview"); sb.paint(); rec.end();
failures.push(...checkRecording(rec, { regions }));
rec.bad.length = 0;

// interactive helpers: hit rects inside the canvas
const R = sb.tsRects();
for (const k of Object.keys(R)) {
    const r = R[k];
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `hit rect ${k} is outside the ${W}x${H} canvas`);
}
for (const s of [SL, SR]) assert.ok(s.x - 3 >= 0 && s.x + s.w + 3 <= W && s.y >= 0 && s.y + s.h <= sb.TS_LCD_H, "slider hit area outside the LCD");

const uniq = [...new Set(failures)];
if (uniq.length) {
    console.error(uniq.slice(0, 25).join("\n"));
    throw new Error(`Transient Split paint bounds: ${uniq.length} violation(s) in ${n} scenarios`);
}
console.log(`[paint bounds] Transient Split: ${n} extreme scenarios drawn inside their regions, no text overlap`);
