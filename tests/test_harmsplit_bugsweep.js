#!/usr/bin/env node
"use strict";
/**
 * Pass 1 bugsweep red tests for devices/Harmonic Split.amxd (slug `harmsplit`).
 *
 * Bug: the Detection Threshold line / T handle cannot be grabbed on the plot when the
 * threshold is above about -7.7 dB. hsPaintAnalysis draws the T handle at the right edge
 * (and, near the top, shifted left of the Post button so it stays visible and clear of the
 * L / H flags), but hsHandleDown (src/harmsplit_ui.js) forces the threshold distance to 99
 * for every click with y < HS_PLOT.y + 12 -- the strip where the threshold line sits for
 * thr > ~-7.7 dB (hsYOfDb(-7.7) ~= 13 = HS_PLOT.y + 12) -- without the handle exception the
 * L / H flags get there (their painted x is honoured via hsFlagX). The flags get an
 * exception, the T handle does not, so at high thresholds the plot offers no way to drag
 * the threshold or to double-click it back to Automatic; only the Threshold value row
 * still works.
 *
 * Harness: the same loadFace / recording-mgraphics setup as tests/test_harmsplit_face.js.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeRecorder, loadFace } = require("./paint_bounds_lib");

const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8").trimEnd();
const header = 'var GEN_DSP_TEXT = "";\nvar GEN_DSP_HASH = "test";\nvar SS_PREFIX = "harmsplit";\n';
const code = [header, read("harmsplit_config.js"), read("spectral_link.js"), read("spectral_theme.js"), read("spectral_dsp.js"), read("harmsplit_ui.js")].join("\n\n");

const sent = [];            // outlet messages: [outlet, ...args]
function FakeBuffer(name) {
    this.peek = () => [];
}
const rec = makeRecorder(280, 141);
const sb = loadFace(code, rec, { Buffer: FakeBuffer, outlet: (...a) => sent.push(a) });

// Default detection band (Low 80 Hz / High 1.5 kHz): the L / H lines sit at x ~= 43 / 168,
// so x = 100 is far from both and a hit there can only be the Threshold line.
function clickPlot(x, y) {
    sb.hsDrag = null;
    sb.onclick(x, y);
    return sb.hsDrag;
}

// ---- control: a Threshold click in the middle of the plot starts a threshold drag ----
sb.hsVals.thr = -50;
{
    const drag = clickPlot(100, sb.hsYOfDb(-50));
    assert.ok(drag && drag.kind === "thr", "control: thr -50 dB line click starts a thr drag");
}

// ---- bug: the Threshold line can be grabbed all the way up to 0 dB ----
for (const thr of [-5, -2, 0]) {
    sb.hsVals.thr = thr;
    const drag = clickPlot(100, sb.hsYOfDb(thr));
    assert.ok(drag && drag.kind === "thr",
        `thr ${thr} dB: clicking the threshold line (y ${sb.hsYOfDb(thr).toFixed(1)}, inside the top flag strip) starts a thr drag, got ${drag && drag.kind}`);
}

// ---- bug: the painted T handle can be grabbed when Threshold is close to 0 dB ----
// hsPaintAnalysis paints it at (hsToggleRect().x - 22, min(hsYOfDb(thr), hsBase() - 6.5))
// in this state (left of the Post button, clear of the flags).
{
    sb.hsVals.thr = 0;
    const tg = sb.hsToggleRect();
    const hx = tg.x - 22;
    const hy = Math.min(sb.hsYOfDb(0), sb.hsBase() - 6.5);
    const drag = clickPlot(hx, hy);
    assert.ok(drag && drag.kind === "thr",
        `thr 0 dB: clicking the painted T handle (${hx}, ${hy}) starts a thr drag, got ${drag && drag.kind}`);
}

// ---- bug: double-clicking the Threshold line near the top resets it to Automatic ----
{
    sb.hsVals.thr = -5;
    sent.length = 0;
    sb.hsDrag = null;
    sb.ondblclick(100, sb.hsYOfDb(-5));
    const resets = sent.filter((m) => m[0] === 0 && m[1] === "thr");
    assert.ok(resets.length === 1 && Number(resets[0][2]) === -120,
        `thr -5 dB: double-click on the threshold line emits a reset to Automatic (-120), got ${JSON.stringify(sent)}`);
}

// ============================================================================
// Pass 1, iteration 1 (new sweep): the painted T handle cannot be grabbed when
// the Threshold is at / near Automatic (thr < about -118 dB).
//
// hsPaintAnalysis paints the T handle at hy = min(hsYOfDb(thr), hsBase() - 6.5)
// so the handle stays inside the LCD, but for thr in the -120..-100 strip
// hsYOfDb runs from 90 (at -120) down to 85 (at -100), so the painted handle
// sits at y = 84.5 while the Threshold line itself sits up to 5.5 px below it.
// hsHandleDown measures only the distance to the LINE (dT = |y - hsYOfDb(thr)|)
// and rejects clicks with best > 5, so a click on the centre of the painted
// handle -- the affordance a user aims for, and the only handle visible in the
// device default state (Threshold = Automatic, -120 dB) -- starts no drag when
// thr < -118, and a double-click there does not reset to Automatic either.
// The line itself (y = 90 at -120) remains clickable; only the handle is dead.
// (Distinct from the top-strip bug above: there the line and handle coincide
// and the flag strip forced dT to 99; here paint and hit-test disagree about
// the handle y at the BOTTOM of the plot.)
//
// Control: at thr -110 the painted handle (also clamped to 84.5) is 3 px from
// the line and can be grabbed.
// ---- control: the painted T handle can be grabbed at thr -110 dB ----
function paintedTHandle(thr) {
    sb.hsVals.thr = thr;
    const tg = sb.hsToggleRect();
    const hy = Math.min(sb.hsYOfDb(thr), sb.hsBase() - 6.5);
    const hx = hy - 4.5 < tg.y + tg.h + 1 ? tg.x - 22 : sb.HS_PLOT.x + sb.HS_PLOT.w - 1 - 9;
    return { hx, hy };
}
{
    const { hx, hy } = paintedTHandle(-110);
    const drag = clickPlot(hx, hy);
    assert.ok(drag && drag.kind === "thr",
        `control: thr -110 dB painted T handle (${hx}, ${hy}) starts a thr drag, got ${drag && drag.kind}`);
}

// ---- bug: the painted T handle can be grabbed at Automatic / near it ----
for (const thr of [-120, -119]) {
    const { hx, hy } = paintedTHandle(thr);
    const drag = clickPlot(hx, hy);
    assert.ok(drag && drag.kind === "thr",
        `thr ${thr} dB: clicking the painted T handle (${hx}, ${hy}, line at y ${sb.hsYOfDb(thr).toFixed(1)}) starts a thr drag, got ${drag && drag.kind}`);
}

// ---- bug: double-clicking the painted T handle near Automatic resets it ----
{
    const { hx, hy } = paintedTHandle(-119);
    sent.length = 0;
    sb.hsDrag = null;
    sb.ondblclick(hx, hy);
    const resets = sent.filter((m) => m[0] === 0 && m[1] === "thr");
    assert.ok(resets.length === 1 && Number(resets[0][2]) === -120,
        `thr -119 dB: double-click on the painted T handle (${hx}, ${hy}) emits a reset to Automatic (-120), got ${JSON.stringify(sent)}`);
}

console.log("All Harmonic Split bugsweep tests passed");
