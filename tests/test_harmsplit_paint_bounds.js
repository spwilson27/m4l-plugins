#!/usr/bin/env node
"use strict";
/**
 * Paint bounds for the Harmonic Split face: every fill / stroke / text must lie inside a legitimate region of the canvas
 * (plot, Post button, legend row, value rows) at extreme parameter and telemetry values (Low / High at 19.4 Hz / 19.9 kHz and
 * crossed, Threshold -120..0, Tilt +-12, f0 out of range, Max Harm 0 / 404, NaN / huge / negative telemetry), the f0 label must
 * not collide with the axis labels or any other text, and hit rects must be inside the canvas. Uses tests/paint_bounds_lib.js.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeRecorder, loadFace, checkRecording, grid } = require("./paint_bounds_lib");

const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8").trimEnd();
// same order as scripts/build_harmsplit.py
const code = [read("harmsplit_config.js"), read("spectral_link.js"), read("spectral_theme.js"), fs.readFileSync(path.join(SRC, "harmsplit_ui.js"), "utf8")].join("\n\n");

const W = 280, H = 141;
const rec = makeRecorder(W, H);
const sb = loadFace(code, rec);
const P = sb.HS_PLOT;
const origLcd = sb.sptLcd;
sb.sptLcd = function () { const n = rec.shapes.length; origLcd.apply(null, arguments); rec.shapes.length = n; };

const T = sb.hsToggleRect();
const regions = [
    P,                                                   // the plot: spectra, grid labels, handles, markers, f0 label
    { x: T.x, y: T.y, w: T.w, h: T.h },                  // Post button
    { x: 0, y: 95, w: W, h: 13 },                        // legend row + chain chip
    { x: 0, y: 108, w: W, h: 28 }                        // Low / High / Tilt / Threshold rows
];

const BAD = [NaN, -1e9, 1e9];
function fillTelemetry(kind) {
    const v = kind === "nan" ? NaN : kind === "huge" ? 1e9 : kind === "neg" ? -5 : kind === "inf" ? Infinity : kind === "one" ? 1 : 0.5;
    for (let c = 0; c < sb.HS_NCOLS; c++) { sb.hsPre[c] = v; sb.hsNh[c] = v; sb.hsA[c] = v; sb.hsB[c] = v; }
}

let n = 0;
const failures = [];
function check(label) {
    rec.begin(label);
    sb.paint();
    rec.end();
    const t = rec.shapes.filter((s) => s.kind === "text");
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
        const a = t[i], b = t[j];
        if (a.text.length === 1 || b.text.length === 1) continue;     // L / H / T handle letters are draggable overlays: they may sit on data or on each other
        if (a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5) failures.push(`${label}: texts "${a.text}" and "${b.text}" overlap`);
    }
    failures.push(...checkRecording(rec, { regions }));
    rec.bad.length = 0;
    n++;
}

const lows = [19.4, 80, 19900, NaN];
const highs = [19.4, 1500, 19900, NaN];
const thrs = [-120, -100, -60, 0, NaN, 1e9];
const f0s = [0, 15, 20, 30, 55, 196, 440, 5000, 19900, 28000, 1e9, NaN];
for (const tk of ["nan", "huge", "neg", "inf", "one", "mid"]) {
    fillTelemetry(tk);
    for (const g of grid({ lowcut: lows, highcut: highs, thr: thrs, f0: f0s, dispost: [0, 1], maxh: [0, 1, 404, 1e9], sel: [0, 2] })) {
        // keep the product manageable: full f0 sweep only for the default band
        const dflt = g.lowcut === 80 && g.highcut === 1500;
        if (!dflt && (g.sel !== 0 || g.maxh !== 0 || (g.f0 !== 196 && g.f0 !== 19900 && g.f0 !== 28000 && g.f0 !== 20))) continue;
        if (dflt && g.thr !== -120 && g.thr !== -60 && g.f0 !== 196 && g.f0 !== 19900) continue;
        Object.assign(sb.hsVals, { lowcut: g.lowcut, highcut: g.highcut, thr: g.thr, dispost: g.dispost, maxh: g.maxh, tilt: n % 2 ? 12 : -12, pattern: n % 24 });
        const awake = g.f0 > 0 ? 1 : 0;
        sb.hsScalars = { frame: 5, awake: awake, sr: 48000, n: 2048, level: 0.2, f0: g.f0, series: g.f0, rootH: n % 3 === 0 ? 7 : 1, odd: n % 4 === 0 ? 1 : 0,
            conf: 0.6, voiced: tk === "nan" ? NaN : 1, lvl: -14, nact: 40, threff: tk === "nan" ? NaN : (n % 2 ? -54 : 5) };
        sb.hsSel = g.sel;
        sb.hsInfo = { instanceId: "t", isInRack: true, chainIndex: 99, chainCount: 100, peers: 100, linked: true, autoChannel: 0 };
        sb.hsDrag = n % 5 === 0 ? { kind: "thr" } : null;
        check(`tele=${tk} ${JSON.stringify(g)}`);
    }
}
// f0 sweep over the whole band edge cases with a real-looking spectrum
fillTelemetry("mid");
sb.hsVals.lowcut = 19.4; sb.hsVals.highcut = 19900; sb.hsVals.maxh = 0; sb.hsVals.thr = -120;
for (let f = 20; f < 24000; f *= 1.07) {
    sb.hsScalars = { frame: 1, awake: 1, sr: 48000, n: 2048, level: 0.2, f0: f, series: f / 3, rootH: 3, odd: 0, conf: 0.6, voiced: 1, lvl: -14, nact: 40, threff: -54 };
    check(`f0 sweep ${f.toFixed(1)}`);
}
sb.preview();
check("preview");

// interactive helpers: hit rects inside the canvas, handle hit positions inside the plot
for (const k of Object.keys(sb.HS_FIELDS)) {
    const r = sb.HS_FIELDS[k];
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `field ${k} is outside the canvas`);
}
assert.ok(T.x >= 0 && T.x + T.w <= W && T.y >= 0 && T.y + T.h <= H, "toggle outside the canvas");
for (const db of [-120, -100, 0, NaN]) {
    const y = sb.hsYOfDb(db);
    assert.ok(y >= P.y && y <= P.y + P.h, `hsYOfDb(${db}) = ${y} outside the plot`);
}
for (const f of [0, 19.4, 20000, 1e9, NaN]) {
    const x = sb.hsFreqX(f);
    assert.ok(x >= P.x && x <= P.x + P.w, `hsFreqX(${f}) = ${x} outside the plot`);
}

const uniq = [...new Set(failures)];
if (uniq.length) {
    console.error(uniq.slice(0, 25).join("\n"));
    throw new Error(`Harmonic Split paint bounds: ${uniq.length} violation(s) in ${n} scenarios`);
}
console.log(`[paint bounds] Harmonic Split: ${n} extreme scenarios drawn inside their regions, no text overlap`);
