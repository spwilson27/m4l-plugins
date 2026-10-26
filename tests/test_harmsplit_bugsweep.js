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

console.log("All Harmonic Split bugsweep tests passed");
