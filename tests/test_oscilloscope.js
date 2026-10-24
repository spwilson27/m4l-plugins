#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const osc = require("../src/oscilloscope_config.js");

const ROOT = path.join(__dirname, "..");
let checks = 0;

function ok(cond, msg) {
    assert.ok(cond, msg);
    checks++;
}

function near(got, want, tol, msg) {
    assert.ok(Math.abs(got - want) <= tol, msg + " (got " + got + ", want " + want + ")");
    checks++;
}

function overlaps(a, b) {
    return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

function inside(rect, x, y, w, h) {
    return rect[0] >= x - 0.01 && rect[1] >= y - 0.01 && rect[0] + rect[2] <= x + w + 0.01 && rect[1] + rect[3] <= y + h + 0.01;
}

// ---------------------------------------------------------------------------------------------
// 1. Geometry, Non-Overlapping Controls, and Dropdown Menus
// ---------------------------------------------------------------------------------------------
const g = osc.oscGeom();
ok(osc.OSC_W === 460 && osc.OSC_H === 169, "Oscilloscope is 460 x 169 px");
ok(osc.OSC_VIEW_NAMES.length === 2 && osc.OSC_VIEW_NAMES[0] === "Overlay" && osc.OSC_VIEW_NAMES[1] === "Split", "Vectorscope removed: only Overlay and Split views exist");
ok(inside(g.lcd, 0, 0, osc.OSC_W, osc.OSC_H), "LCD inside device");
ok(inside(g.plot, g.lcd[0], g.lcd[1], g.lcd[2], g.lcd[3]), "Plot inside LCD");
ok(inside(g.side, 0, 0, osc.OSC_W, osc.OSC_H), "Sidebar inside device");
ok(!overlaps(g.lcd, g.side), "LCD and Sidebar do not overlap");

const baseHits = osc.oscHits("");
ok(baseHits.length === 11, "11 top-level interactive controls registered when no menu is open");
for (let i = 0; i < baseHits.length; i++) {
    const r = baseHits[i].rect;
    ok(inside(r, 0, 0, osc.OSC_W, osc.OSC_H), "Control " + baseHits[i].kind + " inside 460x169");
    const cx = r[0] + r[2] * 0.5;
    const cy = r[1] + r[3] * 0.5;
    const hit = osc.oscHitAt(cx, cy, "");
    ok(hit && hit.kind === baseHits[i].kind && hit.index === baseHits[i].index, "oscHitAt resolves " + baseHits[i].kind);
    for (let j = i + 1; j < baseHits.length; j++) {
        ok(!overlaps(r, baseHits[j].rect), "Controls " + baseHits[i].kind + " and " + baseHits[j].kind + " do not overlap");
    }
}

// Verify Mode dropdown items and Window dropdown items
for (let i = 0; i < g.modeMenuItems.length; i++) {
    const r = g.modeMenuItems[i];
    const hit = osc.oscHitAt(r[0] + 5, r[1] + 5, "mode");
    ok(hit && hit.kind === "mode_item" && hit.index === i, "Mode menu item " + i + " hit-tests when mode menu is open");
}
for (let i = 0; i < g.winMenuItems.length; i++) {
    const r = g.winMenuItems[i];
    const hit = osc.oscHitAt(r[0] + 5, r[1] + 5, "window");
    ok(hit && hit.kind === "win_item" && hit.index === i, "Window menu item " + i + " hit-tests when window menu is open");
}

// ---------------------------------------------------------------------------------------------
// 2. EQ-Eight Style Mode Selection Box + Channel Toggle (`oscResolveRouting`)
// ---------------------------------------------------------------------------------------------
const rStereo = osc.oscResolveRouting(0, 0);
ok(rStereo.chMode === 0 && rStereo.editLabel === "L / R" && rStereo.editActive === false, "Stereo mode -> dual L/R");
const rLeft = osc.oscResolveRouting(1, 0);
ok(rLeft.chMode === 2 && rLeft.editLabel === "L" && rLeft.editActive === true, "L/R mode sub 0 -> Left only (L)");
const rRight = osc.oscResolveRouting(1, 1);
ok(rRight.chMode === 3 && rRight.editLabel === "R" && rRight.editActive === true, "L/R mode sub 1 -> Right only (R)");
const rMS = osc.oscResolveRouting(2, 0);
ok(rMS.chMode === 1 && rMS.editLabel === "M / S" && rMS.editActive === true, "M/S mode sub 0 -> Dual M/S");
const rMid = osc.oscResolveRouting(2, 1);
ok(rMid.chMode === 4 && rMid.editLabel === "M" && rMid.editActive === true, "M/S mode sub 1 -> Mid only (M)");
const rSide = osc.oscResolveRouting(2, 2);
ok(rSide.chMode === 5 && rSide.editLabel === "S" && rSide.editActive === true, "M/S mode sub 2 -> Side only (S)");

// ---------------------------------------------------------------------------------------------
// 3. Stabilized Pitch Period Detection (Hysteresis, Harmonic Lock, and Dropout Hold)
// ---------------------------------------------------------------------------------------------
const sr = 48000;
for (const testFreq of [32.6, 55, 110, 220, 440, 880]) {
    const N = 4096;
    const waveL = new Array(N);
    const waveR = new Array(N);
    for (let i = 0; i < N; i++) {
        const ph = (2 * Math.PI * testFreq * i) / sr;
        waveL[i] = 0.8 * Math.sin(ph) + 0.2 * Math.sin(2 * ph);
        waveR[i] = 0.7 * Math.cos(ph);
    }
    const pState = osc.oscCreatePitchState();
    const est = osc.oscEstimatePeriod(waveL, sr, pState);
    const expectedPeriod = sr / testFreq;
    near(est.period, expectedPeriod, expectedPeriod * 0.015, "Pitch period at " + testFreq + " Hz");
    near(est.freq, testFreq, testFreq * 0.015, "Detected frequency at " + testFreq + " Hz");
    ok(est.confidence > 0.80, "High pitch confidence at " + testFreq + " Hz");

    // Feed 20 frames of complete silence into the same trackerState: pitch must HOLD without disappearing!
    const silent = new Array(N).fill(0);
    for (let f = 0; f < 20; f++) {
        const held = osc.oscEstimatePeriod(silent, sr, pState);
        near(held.freq, testFreq, testFreq * 0.02, "Pitch holds steady across dropout frame " + f + " at " + testFreq + " Hz");
        ok(held.confidence >= 0.14, "Held pitch confidence stays above voiced threshold on frame " + f);
    }
}

// ---------------------------------------------------------------------------------------------
// 4. Auto-Normalize + Gain Scale Slider Math (`oscComputeEffectiveGain`)
// ---------------------------------------------------------------------------------------------
// Quiet signal with peak = 0.25 (-12 dBFS):
// - With Auto OFF and Gain = +6 dB (2x): totalGain = 2.0 (peak becomes 0.5)
// - With Auto ON and Gain = 0 dB (1x): normGain = 1 / 0.25 = 4.0, userGain = 1.0 -> totalGain = 4.0 (peak normalized to 1.0!)
// - With Auto ON and Gain = +6 dB (~1.995x): normGain = 4.0, userGain = ~1.995 -> totalGain = ~7.98 (normalized first, then Gain Scale applied!)
const gOff = osc.oscComputeEffectiveGain(0.25, 6.0, 0);
near(gOff.normGain, 1.0, 1e-9, "Auto OFF has normGain = 1.0");
near(gOff.totalGain, Math.pow(10, 6 / 20), 1e-6, "Auto OFF applies user gain directly");

const gAuto0 = osc.oscComputeEffectiveGain(0.25, 0.0, 1);
near(gAuto0.normGain, 4.0, 1e-9, "Auto ON normalizes 0.25 peak by 4x to unity");
near(gAuto0.totalGain, 4.0, 1e-9, "Auto ON at 0 dB gives 4x total gain");

const gAutoPlus6 = osc.oscComputeEffectiveGain(0.25, 6.0, 1);
near(gAutoPlus6.totalGain, 4.0 * Math.pow(10, 6 / 20), 1e-6, "Auto ON normalizes first (4x) and then applies +6 dB Gain Scale");

// ---------------------------------------------------------------------------------------------
// 5. Blob v3 Serialization & Backward Compatibility
// ---------------------------------------------------------------------------------------------
const blob3 = osc.oscBlob({
    routingMode: 2,
    editSub: 1,
    viewMode: 1,
    cycleMode: 0,
    trigMode: 1,
    rateHz: 48,
    gainDb: -4.5,
    autoGain: 1
});
ok(blob3[0] === 3 && blob3.length === 9, "v3 blob has 9 elements");
const from3 = osc.oscFromBlob(blob3);
ok(from3.routingMode === 2 && from3.editSub === 1 && from3.chMode === 4 && from3.viewMode === 1 && from3.cycleMode === 0 && from3.trigMode === 1 && from3.rateHz === 48 && Math.abs(from3.gainDb - (-4.5)) < 1e-6 && from3.autoGain === 1, "v3 blob round-trip");

const from2 = osc.oscFromBlob([2, 3, 1, 2, 0, 3, 2]);
ok(from2.routingMode === 1 && from2.editSub === 1 && from2.chMode === 3 && from2.viewMode === 1 && from2.rateHz === 60 && from2.gainDb === 6, "v2 blob backward compatibility");

// ---------------------------------------------------------------------------------------------
// 6. Built Device (`devices/Oscilloscope.amxd`) & Full Paint / Interaction Sandbox Verification
// ---------------------------------------------------------------------------------------------
const uiSrc = fs.readFileSync(path.join(ROOT, "src", "oscilloscope_ui.js"), "utf8");
ok(/var AN_PREVIEW = 0;/.test(uiSrc), "AN_PREVIEW is 0 in oscilloscope_ui.js");
ok(!uiSrc.includes("oscPaintXY"), "Vectorscope code removed from oscilloscope_ui.js");
ok(!/\bvar\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(uiSrc), "oscilloscope_ui.js does not shadow Max globals");

const amxdPath = path.join(ROOT, "devices", "Oscilloscope.amxd");
ok(fs.existsSync(amxdPath), "devices/Oscilloscope.amxd exists");
const raw = fs.readFileSync(amxdPath);
const doc = JSON.parse(raw.slice(32, 32 + raw.readUInt32LE(28)).toString("utf8"));
const viz = doc.patcher.boxes.map((b) => b.box).find((b) => b.id === "obj-viz");

const cmds = [];
const ctx = {
    Math, Number, String, Array, Object, Float64Array, isFinite, isNaN, parseInt, parseFloat, Date, JSON,
    inlets: 1, outlets: 2,
    outlet: () => {},
    notifyclients: () => {},
    post: () => {},
    arrayfromargs: (a) => Array.prototype.slice.call(a),
    Task: function (fn) {
        this.interval = 33;
        this.repeat = () => {};
        this.schedule = () => {};
        this.cancel = () => {};
        this._fn = fn;
    },
    max: {
        getcolor(name) {
            const tbl = {
                live_surface_bg: [0.212, 0.212, 0.212, 1],
                live_desktop: [0.165, 0.165, 0.165, 1],
                live_lcd_bg: [0.094, 0.094, 0.094, 1],
                live_lcd_frame: [0.243, 0.243, 0.243, 1],
                live_lcd_title: [0.71, 0.71, 0.71, 1],
                live_lcd_control_fg: [1, 0.678, 0.337, 1],
                live_lcd_control_fg_alt: [0.012, 0.765, 0.835, 1],
                live_display_line_one: [1, 0.678, 0.337, 1],
                live_display_line_two: [0.012, 0.765, 0.835, 1],
                live_display_scale_text: [0.525, 0.525, 0.525, 1],
                live_control_bg: [0.118, 0.118, 0.118, 1],
                live_control_fg: [0.71, 0.71, 0.71, 1],
                live_control_selection: [1, 0.678, 0.337, 1],
                live_alert: [0.906, 0.412, 0.259, 1]
            };
            return tbl[name] || [0.5, 0.5, 0.5, 1];
        }
    },
    mgraphics: {
        size: [460, 169],
        relative_coords: 0,
        autofill: 0,
        _fs: 9.5,
        init() {},
        redraw() {},
        set_source_rgba(r, g, b, a = 1) { cmds.push({ op: "rgba", r, g, b, a }); },
        set_line_width(w) { cmds.push({ op: "lw", w }); },
        rectangle(x, y, w, h) { cmds.push({ op: "rect", x, y, w, h }); },
        rectangle_rounded(x, y, w, h, rx, ry) { cmds.push({ op: "rrect", x, y, w, h, rx, ry }); },
        move_to(x, y) { cmds.push({ op: "move", x, y }); },
        line_to(x, y) { cmds.push({ op: "line", x, y }); },
        close_path() { cmds.push({ op: "close" }); },
        arc(x, y, r, a1, a2) { cmds.push({ op: "arc", x, y, r, a1, a2 }); },
        fill() { cmds.push({ op: "fill" }); },
        stroke() { cmds.push({ op: "stroke" }); },
        select_font_face() {},
        set_font_size(s) { this._fs = s; },
        text_measure(s) { return [String(s).length * this._fs * 0.56, this._fs]; },
        show_text(s) { cmds.push({ op: "text", s }); }
    }
};
vm.createContext(ctx);
vm.runInContext(viz.textfile.text, ctx);
ctx.loadbang();
ctx.oscEnsureDemo();

// Sweep every routingMode (0..2), editSub (0..2), viewMode (0..1), cycleMode (0..6), autoGain (0..1)
for (let rMode = 0; rMode < 3; rMode++) {
    for (let eSub = 0; eSub < 3; eSub++) {
        for (let vMode = 0; vMode < 2; vMode++) {
            for (let cMode = 0; cMode < 7; cMode++) {
                for (let autoG = 0; autoG < 2; autoG++) {
                    cmds.length = 0;
                    ctx.setvalueof(3, rMode, eSub, vMode, cMode, 0, 30, 3.0, autoG);
                    ctx.paint();
                    ok(cmds.length > 20, "Paints state");
                    for (const c of cmds) {
                        if (c.op === "rect" || c.op === "rrect") {
                            ok(c.x >= -1 && c.x + c.w <= 461 && c.y >= -1 && c.y + c.h <= 170, "Rect within 460x169");
                        } else if (c.op === "move" || c.op === "line") {
                            ok(c.x >= -2 && c.x <= 462 && c.y >= -2 && c.y <= 171, "Line within 460x169");
                        }
                    }
                }
            }
        }
    }
}

// Test Mode dropdown selection box + Edit/Ch toggle button interaction
ctx.onclick(g.modeBox[0] + 5, g.modeBox[1] + 5);
ok(ctx.oscOpenMenu === "mode", "Clicking Mode box opens Mode dropdown menu");
ctx.paint();
// Click "M / S" (item 2) in Mode dropdown
ctx.onclick(g.modeMenuItems[2][0] + 5, g.modeMenuItems[2][1] + 5);
ok(ctx.oscRoutingMode === 2 && ctx.oscOpenMenu === "", "Selecting M/S in Mode menu sets oscRoutingMode=2 and closes menu");
ok(ctx.oscChMode === 1, "M/S initial sub 0 is dual M/S (chMode=1)");
// Click Edit/Ch toggle button to cycle M/S -> M -> S -> M/S
ctx.onclick(g.editBtn[0] + 5, g.editBtn[1] + 5);
ok(ctx.oscEditSub === 1 && ctx.oscChMode === 4, "First click on Ch toggle in M/S mode selects Mid (M)");
ctx.onclick(g.editBtn[0] + 5, g.editBtn[1] + 5);
ok(ctx.oscEditSub === 2 && ctx.oscChMode === 5, "Second click on Ch toggle in M/S mode selects Side (S)");
ctx.onclick(g.editBtn[0] + 5, g.editBtn[1] + 5);
ok(ctx.oscEditSub === 0 && ctx.oscChMode === 1, "Third click on Ch toggle in M/S mode returns to M/S");

// Test Window Size dropdown selection box
ctx.onclick(g.winBox[0] + 5, g.winBox[1] + 5);
ok(ctx.oscOpenMenu === "window", "Clicking Window box opens Window dropdown menu");
ctx.paint();
ctx.onclick(g.winMenuItems[0][0] + 5, g.winMenuItems[0][1] + 5);
ok(ctx.oscCycleMode === 0 && ctx.oscOpenMenu === "", "Selecting 1 Cyc in Window menu sets oscCycleMode=0 and closes menu");

// Test single Overlay/Split toggle button
const prevView = ctx.oscViewMode;
ctx.onclick(g.splitBtn[0] + 5, g.splitBtn[1] + 5);
ok(ctx.oscViewMode === (prevView ? 0 : 1), "Clicking Split/Overlay button toggles oscViewMode");

// Test Refresh Rate slider drag + double-click reset
ctx.onclick(g.rateSlider[0] + 2, g.rateSlider[1] + 5);
ctx.ondrag(g.rateSlider[0] + g.rateSlider[2] - 2, g.rateSlider[1] + 5, 1);
ok(ctx.oscRateHz >= 55, "Dragging Refresh Rate slider to right edge sets ~60 Hz");
ctx.ondrag(g.rateSlider[0] + g.rateSlider[2] - 2, g.rateSlider[1] + 5, 0);
ctx.ondblclick(g.rateSlider[0] + 10, g.rateSlider[1] + 5);
near(ctx.oscRateHz, 30, 1e-6, "Double-clicking Refresh Rate slider resets to 30 Hz");

// Test Auto Normalize toggle button + Gain Scale slider drag + double-click reset
const prevAuto = ctx.oscAutoGain;
ctx.onclick(g.autoBtn[0] + 5, g.autoBtn[1] + 5);
ok(ctx.oscAutoGain === (prevAuto ? 0 : 1), "Clicking Auto button toggles auto-normalization");
if (!ctx.oscAutoGain) {
    ctx.onclick(g.autoBtn[0] + 5, g.autoBtn[1] + 5);
    ok(ctx.oscAutoGain === 1, "Second click on Auto button enables auto-normalization");
}
ctx.onclick(g.gainSlider[0] + 10, g.gainSlider[1] + 5);
ctx.ondrag(g.gainSlider[0] + g.gainSlider[2] - 4, g.gainSlider[1] + 5, 1);
ok(ctx.oscGainDb > 10, "Dragging Gain Scale slider increases gainDb");
ctx.ondrag(g.gainSlider[0] + g.gainSlider[2] - 4, g.gainSlider[1] + 5, 0);
ctx.ondblclick(g.gainSlider[0] + 10, g.gainSlider[1] + 5);
near(ctx.oscGainDb, 0, 1e-6, "Double-clicking Gain Scale slider resets to 0.0 dB");

// Regression 1: Auto-Normalize at 0.0 dB never clips visually, even immediately after oscSmoothGain was 64.0
ctx.oscSmoothGain = 64.0;
ctx.setvalueof(3, 0, 0, 1, 0, 0, 60, 0.0, 1); // Stereo, Split, 1 Cyc, Auto Gain ON, 0.0 dB
ctx.paint();
const splitLanes = ctx.oscSplitGeom(g.plot);
const ptsTop = ctx.oscChannelPts(ctx.oscFrame.wave1, splitLanes.top);
const ptsBot = ctx.oscChannelPts(ctx.oscFrame.wave2, splitLanes.bot);
for (const p of ptsTop) {
    ok(p[1] >= splitLanes.top[1] + 2 && p[1] <= splitLanes.top[1] + splitLanes.top[3] - 2, "Auto-Normalized 0 dB top lane has headroom and never touches border (got y=" + p[1] + ")");
}
for (const p of ptsBot) {
    ok(p[1] >= splitLanes.bot[1] + 2 && p[1] <= splitLanes.bot[1] + splitLanes.bot[3] - 2, "Auto-Normalized 0 dB bottom lane has headroom and never touches border (got y=" + p[1] + ")");
}

// Regression 2: R solo (routingMode=1, editSub=1) uses Slot 2 (show1=false, show2=true),
// draws in the bottom lane in Split mode in Blue/Cyan, and draws in Blue/Cyan in Overlay mode
ctx.setvalueof(3, 1, 1, 1, 0, 0, 60, 0.0, 1); // Mode: L/R, Ch: R, Layout: Split
ok(ctx.oscFrame.show1 === false && ctx.oscFrame.show2 === true, "R solo sets show1=false, show2=true");
cmds.length = 0;
ctx.paint();
// Check that the 1.25px waveform stroke in R solo Split mode is in the bottom lane (y >= splitLanes.bot[1]) and uses cyan (b > 0.7)
let curColor = [0, 0, 0, 1];
let curLw = 1;
let pathYs = [];
let strokeRecords = [];
for (const c of cmds) {
    if (c.op === "rgba") curColor = [c.r, c.g, c.b, c.a];
    else if (c.op === "lw") curLw = c.w;
    else if (c.op === "move" || c.op === "line") pathYs.push(c.y);
    else if (c.op === "stroke" || c.op === "fill") {
        if (c.op === "stroke" && pathYs.length > 0) {
            strokeRecords.push({ color: curColor.slice(), lw: curLw, ys: pathYs.slice() });
        }
        pathYs = [];
    }
}
const rSplitWaveStrokes = strokeRecords.filter((s) => s.lw > 1.1);
ok(rSplitWaveStrokes.length === 1, "R solo in Split mode draws exactly 1 waveform trace");
ok(rSplitWaveStrokes[0].color[2] > 0.7 && rSplitWaveStrokes[0].color[0] < 0.2, "R solo in Split mode is Blue/Cyan");
ok(rSplitWaveStrokes[0].ys.every((y) => y >= splitLanes.bot[1] - 0.5), "R solo in Split mode is drawn in the bottom lane");

// Now check R solo in Overlay mode (viewMode=0)
ctx.setvalueof(3, 1, 1, 0, 0, 0, 60, 0.0, 1); // Mode: L/R, Ch: R, Layout: Overlay
cmds.length = 0;
strokeRecords = [];
pathYs = [];
ctx.paint();
for (const c of cmds) {
    if (c.op === "rgba") curColor = [c.r, c.g, c.b, c.a];
    else if (c.op === "lw") curLw = c.w;
    else if (c.op === "move" || c.op === "line") pathYs.push(c.y);
    else if (c.op === "stroke" || c.op === "fill") {
        if (c.op === "stroke" && pathYs.length > 0) {
            strokeRecords.push({ color: curColor.slice(), lw: curLw, ys: pathYs.slice() });
        }
        pathYs = [];
    }
}
const rOverlayWaveStrokes = strokeRecords.filter((s) => s.lw > 1.1);
ok(rOverlayWaveStrokes.length === 1, "R solo in Overlay mode draws 1 waveform trace");
ok(rOverlayWaveStrokes[0].color[2] > 0.7 && rOverlayWaveStrokes[0].color[0] < 0.2, "R solo in Overlay mode is also Blue/Cyan");

// Regression 3: Clipped top lane in M/S Split mode (+24 dB gain) NEVER leaks blue onto the top lane
ctx.setvalueof(3, 2, 0, 1, 0, 0, 60, 24.0, 0); // M/S, Split, +24 dB gain so Mid clips at top
cmds.length = 0;
strokeRecords = [];
pathYs = [];
ctx.paint();
for (const c of cmds) {
    if (c.op === "rgba") curColor = [c.r, c.g, c.b, c.a];
    else if (c.op === "lw") curLw = c.w;
    else if (c.op === "move" || c.op === "line") pathYs.push(c.y);
    else if (c.op === "stroke" || c.op === "fill") {
        if (c.op === "stroke" && pathYs.length > 0) {
            strokeRecords.push({ color: curColor.slice(), lw: curLw, ys: pathYs.slice() });
        }
        pathYs = [];
    }
}
for (const s of strokeRecords) {
    if (s.lw > 1.1 && s.color[2] > 0.7) {
        // Blue stroke must NEVER contain any y coordinate in the top lane!
        ok(s.ys.every((y) => y >= splitLanes.bot[1] - 0.5), "Blue stroke never leaks into top lane when Mid clips");
    }
}

console.log("oscilloscope: " + checks + " checks passed");
