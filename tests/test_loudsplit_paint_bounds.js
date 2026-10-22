#!/usr/bin/env node
"use strict";
/**
 * Paint bounds for the Loud Split face: every fill / stroke / text lies inside a legitimate region of the 284 x 141 canvas at
 * extreme parameter and telemetry values (thresholds at -110 / 0 dB, absolute and Relative with the loudest bin anywhere, knees 1 / 24,
 * Tilt +-6, PRE / POST / SONO, held solos, NaN / huge / negative telemetry). Threshold lines and knee bands are clipped to the plot,
 * the stub and handles stay in the LCD strip right of it, the two threshold labels never touch each other or the axis labels, and
 * the hit rects are inside the canvas. Uses tests/paint_bounds_lib.js (reproduces the "Relative mode line runs out of the plot" bug).
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeRecorder, loadFace, checkRecording, grid } = require("./paint_bounds_lib");

const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8").trimEnd();
// same order as scripts/build_loudsplit.py
const code = [read("loudsplit_config.js"), read("spectral_link.js"), read("spectral_theme.js"), fs.readFileSync(path.join(SRC, "loudsplit_ui.js"), "utf8")].join("\n\n");

const W = 284, H = 141;
const rec = makeRecorder(W, H);
const sb = loadFace(code, rec);
const P = sb.LS_PLOT;
const origLcd = sb.sptLcd;
sb.sptLcd = function () { const n = rec.shapes.length; origLcd.apply(null, arguments); rec.shapes.length = n; };   // the LCD backdrop itself

const T = sb.lsToggleRects();
const R = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h });
const regions = [
    P,                                                              // spectrum, grid, axis labels, threshold lines / bands / labels
    { x: P.x + P.w, y: 0, w: W - P.x - P.w, h: P.y + P.h + 1 },     // stub + solo handles, right of the plot inside the LCD
    R(T.post), R(T.style),                                          // Post / Sono buttons
    { x: 0, y: 95, w: W, h: 13 },                                   // legend row + chain chip
    R(T.rise), R(T.fall), R(T.tilt), R(T.rel)                       // value rows + Relative button
];
for (const r of Object.values(T)) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, "hit rect inside the canvas");

function fillTelemetry(kind) {
    const v = kind === "nan" ? NaN : kind === "huge" ? 1e9 : kind === "neg" ? -5 : kind === "one" ? 1 : kind === "zero" ? 0 : 0.5;
    for (let c = 0; c < sb.LS_NCOLS; c++) { sb.lsPre[c] = v; sb.lsQ[c] = v; sb.lsM[c] = v; sb.lsL[c] = v; }
    sb.lsSono.length = 0;
    for (let r = 0; r < sb.LS_SONO_ROWS; r++) sb.lsPushSono();
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
        if (a.text.length === 1 || b.text.length === 1) continue;     // handle letters
        if (a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5) failures.push(`${label}: texts "${a.text}" and "${b.text}" overlap`);
    }
    failures.push(...checkRecording(rec, { regions }));
    rec.bad.length = 0;
    n++;
}

sb.lsInfo = { instanceId: "t", isInRack: true, chainIndex: 11, chainCount: 16, peers: 16, linked: true, autoChannel: 2 };
const g = grid({
    hithr: [-110, -30, 0, NaN],
    lothr: [-110, -85, 0],
    rhithr: [-110, -15, 0],
    rlothr: [-110, -36, 0],
    hiknee: [1, 24],
    loknee: [1, 24],
    relative: [0, 1],
    tilt: [-6, 0, 6],
    lmax: [-200, -20, 0, 100],
});
for (const c of g) {
    sb.set_hithr(c.hithr); sb.set_lothr(c.lothr); sb.set_rhithr(c.rhithr); sb.set_rlothr(c.rlothr);
    sb.set_hiknee(c.hiknee); sb.set_loknee(c.loknee); sb.set_relative(c.relative); sb.set_tilt(c.tilt);
    sb.lsLmaxS = c.lmax;
    sb.lsScalars.awake = 1;
    fillTelemetry("half");
    sb.lsVals.disstyle = 0; sb.lsVals.dispost = 0; sb.lsSolo = "";
    check(`pre ${JSON.stringify(c)}`);
}
// display styles, telemetry edge cases, solos, selections, no signal, extreme Rise / Fall / Mix text
for (const tel of ["zero", "half", "one", "nan", "huge", "neg"]) {
    for (const [dispost, disstyle] of [[0, 0], [1, 0], [0, 1]]) {
        for (const solo of ["", "hi", "lo"]) {
            for (const sel of [0, 1, 2, 3]) {
                for (const awake of [0, 1]) {
                    sb.set_relative(solo === "hi" ? 1 : 0);
                    sb.set_hithr(-12); sb.set_lothr(-110); sb.set_rhithr(0); sb.set_rlothr(-110); sb.set_tilt(6);
                    sb.lsLmaxS = 0;
                    sb.lsVals.dispost = dispost; sb.lsVals.disstyle = disstyle; sb.lsSolo = solo; sb.lsSel = sel; sb.lsScalars.awake = awake;
                    sb.set_rise(125); sb.set_fall(0.13);
                    fillTelemetry(tel);
                    check(`tel=${tel} post=${dispost} sono=${disstyle} solo=${solo} sel=${sel} awake=${awake}`);
                }
            }
        }
    }
}
// a dragged knee label, a rack with no chain
sb.lsInfo = { instanceId: "t", isInRack: false, chainIndex: 0, chainCount: 0, peers: 1, linked: false, autoChannel: -1 };
for (const which of ["hi", "lo"]) {
    sb.lsDrag = { kind: "knee", which };
    for (const thr of [-110, -50, 0]) { sb.set_hithr(thr); sb.set_lothr(thr); sb.lsLmaxS = -20; check(`knee drag ${which} thr=${thr}`); }
    sb.lsDrag = null;
}
// the user's report: Relative, Rel Low at its minimum, Rel High -15
sb.set_relative(1); sb.set_rlothr(-110); sb.set_rhithr(-15); sb.lsLmaxS = -20; sb.lsSolo = ""; fillTelemetry("half");
check("report: relative, Rel Low -110, Rel High -15");
const ys = sb.lsLabelYs();
assert.ok(ys.lo - ys.hi >= sb.LS_LABEL_GAP - 1e-9 && ys.lo <= P.y + P.h - 11 + 1e-9, "threshold labels apart and above the axis-label row");
const dots = sb.lsDotYs();
assert.ok(dots.lo - dots.hi >= sb.LS_DOT_GAP - 1e-9 && dots.hi >= sb.LS_DOT_MIN_Y && dots.lo <= P.y + P.h - 6 + 1e-9, "solo handles apart and inside the plot");

assert.strictEqual(failures.length, 0, `Loud Split paint bounds: ${failures.length} violation(s) in ${n} paints, first:\n  ${failures.slice(0, 12).join("\n  ")}`);
console.log(`[paint bounds] Loud Split: ${n} paints, no drawing outside its regions, no path continuation, no label collisions`);
