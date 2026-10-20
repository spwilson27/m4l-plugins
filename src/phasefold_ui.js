// Phase Fold: audio-reactive v8ui for the three layouts (a, b, c).
// Reads buffer~ #0-phasefoldscope (4 channels, see src/phasefold_core.genexpr):
//   frames 0..255 : ch1 dry max, ch2 dry min, ch3 wet max, ch4 wet min (peek channels are 1-based)
//   frame 256     : write position, heartbeat, FFT size, wet gate
//   frame 257     : input centroid, output centroid, pivot, Auto Gain dB
// The layout comes from the build (the line below) and from a "layout a|b|c" message.
// Dragging the Phase handle sends ["phase", percent] out of outlet 0.

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var layoutMode = "a"; // @layout

var NF = 256;
var scopeBuf = null;
var scopeTask = null;

var dMax = [];
var dMin = [];
var wMax = [];
var wMin = [];

var curPhase = -50;
var curSizeIdx = 2;
var curOrig = 0;
var curAuto = 1;
var curMix = 100;
var curOut = 0;

var nAct = 2048;
var wetGate = 1;
var cIn = 0.5;
var cOut = 0.5;
var cOutSm = 0.5;
var cInSm = 0.5;
var pivotPos = 0.5;
var gainDb = 0;
var lastBeat = -1;
var quietPulls = 0;
var isDemo = true;
var dragging = false;

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function sizeFromIdx(i) {
    return 512 * Math.pow(2, clamp(Math.round(i), 0, 3));
}

// ---------------------------------------------------------------------------
// Demo trace: a kick-like hit and its processed twin. Shown only until real
// telemetry arrives (and in the Node preview, which has no audio).
// ---------------------------------------------------------------------------
function initDemo() {
    var p = clamp(curPhase, -100, 100) / 100;
    var cw = (1 + p) * 0.5;
    var aw = (1 - p) * 0.5;
    var swell = 8 + 26 * (clamp(curSizeIdx, 0, 3) / 3);
    var hits = [78, 196];
    var i;
    var h;
    dMax = [];
    dMin = [];
    wMax = [];
    wMin = [];
    for (i = 0; i < NF; i++) {
        var envD = 0.03;
        var envW = 0.03;
        for (h = 0; h < hits.length; h++) {
            var k = i - hits[h];
            var amp = h === 0 ? 0.86 : 0.62;
            if (k >= 0) {
                envD = Math.max(envD, amp * Math.exp(-k / 20));
                envW = Math.max(envW, amp * (0.25 + 0.75 * cw) * Math.exp(-k / (8 + 12 * cw)));
            } else {
                envW = Math.max(envW, amp * aw * Math.exp(k / swell));
            }
        }
        var ripple = 0.62 + 0.38 * Math.abs(Math.sin(i * 0.93));
        var rippleN = 0.58 + 0.38 * Math.abs(Math.cos(i * 0.71));
        dMax.push(envD * ripple);
        dMin.push(-envD * rippleN);
        wMax.push(envW * ripple);
        wMin.push(-envW * rippleN);
    }
    cIn = 0.5;
    cOut = clamp(0.5 - p * 0.42, 0.04, 0.96);
    cInSm = cIn;
    cOutSm = cOut;
    pivotPos = 0.5;
    gainDb = 0.6;
    wetGate = 1;
    nAct = sizeFromIdx(curSizeIdx);
}

function preview() {
    isDemo = true;
    initDemo();
}

// ---------------------------------------------------------------------------
// Messages from the patcher
// ---------------------------------------------------------------------------
function layout(m) {
    var s = ("" + m).toLowerCase();
    if (s === "a" || s === "b" || s === "c") layoutMode = s;
    mgraphics.redraw();
}

function setbuffer(name) {
    if (!name || typeof Buffer !== "function") return;
    scopeBuf = new Buffer("" + name);
    isDemo = true;
    if (scopeTask || typeof Task !== "function") return;
    scopeTask = new Task(pullScope, this);
    scopeTask.interval = 33;
    scopeTask.repeat();
}

function set_phase(v) {
    curPhase = clamp(Number(v) || 0, -100, 100);
    if (isDemo) initDemo();
    mgraphics.redraw();
}

function set_size(v) {
    curSizeIdx = clamp(Math.round(Number(v) || 0), 0, 3);
    if (isDemo) initDemo();
    mgraphics.redraw();
}

function set_orig(v) {
    curOrig = clamp(Number(v) || 0, 0, 100);
    mgraphics.redraw();
}

function set_auto(v) {
    curAuto = Number(v) > 0.5 ? 1 : 0;
    mgraphics.redraw();
}

function set_mix(v) {
    curMix = clamp(Number(v) || 0, 0, 100);
    mgraphics.redraw();
}

function set_out(v) {
    curOut = clamp(Number(v) || 0, -24, 12);
    mgraphics.redraw();
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------
function at(chunk, i) {
    if (typeof chunk === "number") return i === 0 ? chunk : 0;
    if (!chunk || i >= chunk.length) return 0;
    var v = chunk[i];
    return v === v ? v : 0;
}

function pullScope() {
    if (!scopeBuf) return;
    var c1 = scopeBuf.peek(1, 0, 258);
    var beat = at(scopeBuf.peek(2, 256, 1), 0);
    if (beat === lastBeat) {
        return; // DSP stopped: nothing new to draw
    }
    lastBeat = beat;
    var c2 = scopeBuf.peek(2, 0, 258);
    var c3 = scopeBuf.peek(3, 0, 258);
    var c4 = scopeBuf.peek(4, 0, 258);
    var wpos = Math.round(clamp(at(c1, 256), 0, NF - 1));
    var peak = 0;
    var k;
    if (isDemo) {
        isDemo = false;
        dMax = [];
        dMin = [];
        wMax = [];
        wMin = [];
        for (k = 0; k < NF; k++) {
            dMax.push(0);
            dMin.push(0);
            wMax.push(0);
            wMin.push(0);
        }
    }
    for (k = 0; k < NF; k++) {
        var idx = (wpos + k) & (NF - 1);
        var a = clamp(at(c1, idx), -1, 1.5);
        var b = clamp(at(c2, idx), -1.5, 1);
        var c = clamp(at(c3, idx), -1, 1.5);
        var d = clamp(at(c4, idx), -1.5, 1);
        // an untouched 128-sample slot holds its init peaks (-1 / +1)
        dMax[k] = a < 0 ? 0 : a;
        dMin[k] = b > 0 ? 0 : b;
        wMax[k] = c < 0 ? 0 : c;
        wMin[k] = d > 0 ? 0 : d;
        peak = Math.max(peak, dMax[k], -dMin[k], wMax[k], -wMin[k]);
    }
    nAct = at(scopeBuf.peek(3, 256, 1), 0) || nAct;
    wetGate = at(scopeBuf.peek(4, 256, 1), 0);
    cIn = clamp(at(scopeBuf.peek(1, 257, 1), 0), 0, 1);
    cOut = clamp(at(scopeBuf.peek(2, 257, 1), 0), 0, 1);
    pivotPos = clamp(at(scopeBuf.peek(3, 257, 1), 0), 0, 1);
    gainDb = clamp(at(scopeBuf.peek(4, 257, 1), 0), -24, 24);
    cInSm += (cIn - cInSm) * 0.35;
    cOutSm += (cOut - cOutSm) * 0.35;

    // Silent input: draw one more frame so the trace clears, then stop redrawing.
    if (peak < 0.0005) {
        quietPulls++;
        if (quietPulls > 2) return;
    } else {
        quietPulls = 0;
    }
    mgraphics.redraw();
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------
function canvasSize() {
    var s = mgraphics.size;
    if (!s || s.length < 2) return [270, 134];
    return [s[0], s[1]];
}

function drawText(x, y, txt, size, r, g, b, a) {
    if (!mgraphics.select_font_face || !mgraphics.show_text) return;
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(size);
    mgraphics.set_source_rgba(r, g, b, a);
    mgraphics.move_to(x, y);
    mgraphics.show_text(txt);
}

function drawRRect(x, y, w, h, rad, fillRgba, strokeRgba, lw) {
    if (fillRgba) {
        mgraphics.set_source_rgba(fillRgba[0], fillRgba[1], fillRgba[2], fillRgba[3]);
        if (mgraphics.rectangle_rounded) mgraphics.rectangle_rounded(x, y, w, h, rad, rad);
        else mgraphics.rectangle(x, y, w, h);
        mgraphics.fill();
    }
    if (strokeRgba) {
        mgraphics.set_line_width(lw || 1);
        mgraphics.set_source_rgba(strokeRgba[0], strokeRgba[1], strokeRgba[2], strokeRgba[3]);
        if (mgraphics.rectangle_rounded) mgraphics.rectangle_rounded(x, y, w, h, rad, rad);
        else mgraphics.rectangle(x, y, w, h);
        mgraphics.stroke();
    }
}

function hline(x0, x1, y, lw, rgba) {
    mgraphics.set_line_width(lw);
    mgraphics.set_source_rgba(rgba[0], rgba[1], rgba[2], rgba[3]);
    mgraphics.move_to(x0, y);
    mgraphics.line_to(x1, y);
    mgraphics.stroke();
}

function vline(x, y0, y1, lw, rgba) {
    mgraphics.set_line_width(lw);
    mgraphics.set_source_rgba(rgba[0], rgba[1], rgba[2], rgba[3]);
    mgraphics.move_to(x, y0);
    mgraphics.line_to(x, y1);
    mgraphics.stroke();
}

// Min/max envelope as a filled band around cy (amp = pixels for a full-scale peak).
function drawBand(x, cy, w, amp, maxArr, minArr, fillRgba, edgeRgba) {
    var i;
    var px;
    var step = w / (NF - 1);
    mgraphics.set_source_rgba(fillRgba[0], fillRgba[1], fillRgba[2], fillRgba[3]);
    for (i = 0; i < NF; i++) {
        px = x + i * step;
        var yt = cy - clamp(maxArr[i], 0, 1.2) * amp;
        var yb = cy - clamp(minArr[i], -1.2, 0) * amp;
        if (i === 0) mgraphics.move_to(px, yt);
        else mgraphics.line_to(px, yt);
    }
    for (i = NF - 1; i >= 0; i--) {
        px = x + i * step;
        mgraphics.line_to(px, cy - clamp(minArr[i], -1.2, 0) * amp);
    }
    mgraphics.close_path();
    mgraphics.fill();
    if (edgeRgba) {
        mgraphics.set_line_width(1);
        mgraphics.set_source_rgba(edgeRgba[0], edgeRgba[1], edgeRgba[2], edgeRgba[3]);
        for (i = 0; i < NF; i++) {
            px = x + i * step;
            var ty = cy - clamp(maxArr[i], 0, 1.2) * amp;
            if (i === 0) mgraphics.move_to(px, ty);
            else mgraphics.line_to(px, ty);
        }
        mgraphics.stroke();
        for (i = 0; i < NF; i++) {
            px = x + i * step;
            var by = cy - clamp(minArr[i], -1.2, 0) * amp;
            if (i === 0) mgraphics.move_to(px, by);
            else mgraphics.line_to(px, by);
        }
        mgraphics.stroke();
    }
}

var CYAN = [0.28, 0.84, 0.96];
var AMBER = [0.98, 0.70, 0.26];
var CORAL = [0.96, 0.48, 0.44];
var SLATE = [0.62, 0.70, 0.80];

function rgba(c, a) {
    return [c[0], c[1], c[2], a];
}

// Frame position strip: where the energy of an analysis frame sits, from the
// frame start (min phase) to its end (max phase).
function drawCentroidStrip(x, y, w, h, withLabels) {
    drawRRect(x, y, w, h, 2, [0.045, 0.055, 0.072, 1.0], [0.18, 0.23, 0.30, 1.0], 1);
    vline(x + w * 0.5, y + 1, y + h - 1, 1, [0.30, 0.38, 0.48, 0.8]);
    var xi = x + 3 + cInSm * (w - 6);
    var xo = x + 3 + cOutSm * (w - 6);
    var lo = Math.min(xi, xo);
    var hi = Math.max(xi, xo);
    mgraphics.set_source_rgba(AMBER[0], AMBER[1], AMBER[2], 0.22);
    mgraphics.rectangle(lo, y + 2, Math.max(1, hi - lo), h - 4);
    mgraphics.fill();
    vline(xi, y + 1, y + h - 1, 2, rgba(CYAN, 0.95));
    mgraphics.set_source_rgba(AMBER[0], AMBER[1], AMBER[2], 1.0);
    if (mgraphics.arc) {
        mgraphics.arc(xo, y + h * 0.5, Math.max(2.2, h * 0.3), 0, 6.2831853);
        mgraphics.fill();
    }
    if (withLabels) {
        drawText(x + 3, y + h + 8, "FRAME START", 6.5, SLATE[0], SLATE[1], SLATE[2], 0.8);
        drawText(x + w - 36, y + h + 8, "FRAME END", 6.5, SLATE[0], SLATE[1], SLATE[2], 0.8);
    }
}

function phaseLabel() {
    var v = Math.round(curPhase);
    return (v > 0 ? "+" : "") + v + "%";
}

function sizeLabel() {
    var n = nAct || sizeFromIdx(curSizeIdx);
    return n >= 1024 ? (n / 1024) + "K" : "" + n;
}

// Canonical hit under the current Phase: the energy of a decaying hit with its
// pivot at the centre (min phase decays after it, max phase swells before it).
function drawHitShape(x, y, w, h) {
    var p = clamp(curPhase, -100, 100) / 100;
    var cw = (1 + p) * 0.5;
    var aw = (1 - p) * 0.5;
    var swell = 0.10 + 0.20 * (clamp(curSizeIdx, 0, 3) / 3);
    var cy = y + h - 2;
    var px = x + w * 0.5;
    var i;
    var steps = 60;
    var amp = h - 6;
    mgraphics.set_source_rgba(AMBER[0], AMBER[1], AMBER[2], 0.55);
    mgraphics.move_to(x, cy);
    for (i = 0; i <= steps; i++) {
        var u = i / steps;
        var d = (u - 0.5) * 2;
        var v;
        if (d >= 0) v = (0.25 + 0.75 * cw) * Math.exp(-d / (0.16 + 0.1 * cw));
        else v = aw * Math.exp(d / swell);
        if (Math.abs(d) < 0.03) v = 1;
        mgraphics.line_to(x + u * w, cy - v * amp);
    }
    mgraphics.line_to(x + w, cy);
    mgraphics.close_path();
    mgraphics.fill();
    vline(px, y, cy, 1, [0.9, 0.95, 1.0, 0.35]);
}

// Draggable Phase track with the handle (value -100..+100).
function drawPhaseTrack(x, y, w, h) {
    var mid = x + w * 0.5;
    var hx = x + (clamp(curPhase, -100, 100) + 100) / 200 * w;
    drawRRect(x, y, w, h, 3, [0.040, 0.048, 0.064, 1.0], [0.17, 0.22, 0.29, 1.0], 1);
    drawHitShape(x + 2, y + 2, w - 4, h - 6);
    var ty = y + h - 3;
    hline(x + 4, x + w - 4, ty, 1, [0.30, 0.38, 0.48, 0.9]);
    var ticks = [-100, -50, 0, 50, 100];
    for (var t = 0; t < ticks.length; t++) {
        var tx = x + 4 + (ticks[t] + 100) / 200 * (w - 8);
        vline(tx, ty - 2, ty + 1, 1, [0.5, 0.58, 0.68, 0.9]);
    }
    vline(mid, y + 2, y + h - 2, 1, [0.5, 0.58, 0.68, 0.25]);
    vline(hx, y + 1, y + h - 1, 2, rgba(CORAL, 0.95));
    if (mgraphics.arc) {
        mgraphics.set_source_rgba(CORAL[0], CORAL[1], CORAL[2], 1.0);
        mgraphics.arc(hx, ty - 8, 4.2, 0, 6.2831853);
        mgraphics.fill();
        mgraphics.set_source_rgba(0.07, 0.08, 0.10, 1.0);
        mgraphics.arc(hx, ty - 8, 1.5, 0, 6.2831853);
        mgraphics.fill();
    }
    var lx = hx > x + w - 40 ? hx - 36 : hx + 7;
    drawText(lx, y + 11, phaseLabel(), 8.5, 0.96, 0.92, 0.90, 1.0);
    drawText(x + 4, y + 11, "MAX", 6.5, SLATE[0], SLATE[1], SLATE[2], 0.85);
    drawText(x + w - 20, y + 11, "MIN", 6.5, SLATE[0], SLATE[1], SLATE[2], 0.85);
}

// ---------------------------------------------------------------------------
// Layout A: big canvas, the Phase handle is the main gesture
// ---------------------------------------------------------------------------
var TRACK_A = [0, 0, 0, 0];
var TRACK_C = [0, 0, 0, 0];

function paintA(w, h) {
    drawRRect(0, 0, w, h, 4, [0.032, 0.038, 0.050, 1.0], [0.16, 0.20, 0.26, 1.0], 1);
    var heroH = 62;
    hline(4, w - 4, heroH * 0.5, 1, [0.20, 0.26, 0.34, 0.8]);
    drawBand(4, heroH * 0.5, w - 8, heroH * 0.46, wMax, wMin, rgba(AMBER, 0.50), rgba(AMBER, 0.95));
    drawBand(4, heroH * 0.5, w - 8, heroH * 0.46, dMax, dMin, rgba(CYAN, 0.12), rgba(CYAN, 0.95));
    drawText(7, 10, "IN", 7, CYAN[0], CYAN[1], CYAN[2], 0.95);
    drawText(22, 10, "OUT", 7, AMBER[0], AMBER[1], AMBER[2], 0.95);
    drawText(w - 74, 10, "N " + sizeLabel() + "  G " + (gainDb >= 0 ? "+" : "") + gainDb.toFixed(1), 7, SLATE[0], SLATE[1], SLATE[2], 0.9);
    drawCentroidStrip(6, heroH + 4, w - 12, 9, true);
    TRACK_A = [6, 90, w - 12, h - 94];
    drawPhaseTrack(TRACK_A[0], TRACK_A[1], TRACK_A[2], TRACK_A[3]);
}

// ---------------------------------------------------------------------------
// Layout B: compact classic, small scope strip
// ---------------------------------------------------------------------------
function paintB(w, h) {
    drawRRect(0, 0, w, h, 4, [0.032, 0.038, 0.050, 1.0], [0.16, 0.20, 0.26, 1.0], 1);
    var bandH = h - 9;
    hline(3, w - 3, bandH * 0.5, 1, [0.20, 0.26, 0.34, 0.8]);
    drawBand(3, bandH * 0.5, w - 6, bandH * 0.46, wMax, wMin, rgba(AMBER, 0.50), rgba(AMBER, 0.95));
    drawBand(3, bandH * 0.5, w - 6, bandH * 0.46, dMax, dMin, rgba(CYAN, 0.12), rgba(CYAN, 0.95));
    drawText(5, 9, phaseLabel(), 8, 0.96, 0.92, 0.90, 0.95);
    drawText(w - 40, 9, "N " + sizeLabel(), 7, SLATE[0], SLATE[1], SLATE[2], 0.9);
    drawCentroidStrip(3, h - 7, w - 6, 5, false);
}

// ---------------------------------------------------------------------------
// Layout C: transient lab, before / after waveform hero
// ---------------------------------------------------------------------------
function onsetFrames() {
    var out = [];
    var prev = 0;
    var thr = 0.18;
    for (var i = 1; i < NF; i++) {
        var a = Math.max(dMax[i], -dMin[i]);
        if (a > thr && prev <= thr) out.push(i);
        prev = a;
    }
    return out;
}

function paintC(w, h) {
    drawRRect(0, 0, w, h, 4, [0.032, 0.038, 0.050, 1.0], [0.16, 0.20, 0.26, 1.0], 1);
    var laneH = 34;
    var x0 = 30;
    var lw = w - x0 - 6;
    var yIn = 3;
    var yOut = yIn + laneH + 4;
    drawRRect(x0 - 2, yIn, lw + 4, laneH, 2, [0.040, 0.048, 0.064, 1.0], null, 1);
    drawRRect(x0 - 2, yOut, lw + 4, laneH, 2, [0.040, 0.048, 0.064, 1.0], null, 1);
    hline(x0, x0 + lw, yIn + laneH * 0.5, 1, [0.20, 0.26, 0.34, 0.8]);
    hline(x0, x0 + lw, yOut + laneH * 0.5, 1, [0.20, 0.26, 0.34, 0.8]);
    var ons = onsetFrames();
    var step = lw / (NF - 1);
    for (var o = 0; o < ons.length; o++) {
        vline(x0 + ons[o] * step, yIn, yOut + laneH, 1, [0.96, 0.92, 0.84, 0.28]);
    }
    drawBand(x0, yIn + laneH * 0.5, lw, laneH * 0.46, dMax, dMin, rgba(CYAN, 0.45), rgba(CYAN, 0.95));
    drawBand(x0, yOut + laneH * 0.5, lw, laneH * 0.46, wMax, wMin, rgba(AMBER, 0.50), rgba(AMBER, 0.95));
    drawText(4, yIn + 14, "IN", 8, CYAN[0], CYAN[1], CYAN[2], 0.95);
    drawText(4, yOut + 14, "OUT", 8, AMBER[0], AMBER[1], AMBER[2], 0.95);
    drawText(4, yOut + 25, "G", 6.5, SLATE[0], SLATE[1], SLATE[2], 0.9);
    drawText(11, yOut + 25, (gainDb >= 0 ? "+" : "") + gainDb.toFixed(1), 6.5, SLATE[0], SLATE[1], SLATE[2], 0.9);
    drawText(x0 + 4, yOut + laneH - 3, "N " + sizeLabel(), 7, SLATE[0], SLATE[1], SLATE[2], 0.9);
    var sy = yOut + laneH + 5;
    drawCentroidStrip(x0, sy, lw, 8, false);
    drawText(4, sy + 7, "CTR", 6.5, SLATE[0], SLATE[1], SLATE[2], 0.9);
    TRACK_C = [x0, sy + 12, lw, h - (sy + 12) - 2];
    drawPhaseTrack(TRACK_C[0], TRACK_C[1], TRACK_C[2], TRACK_C[3]);
    drawText(4, TRACK_C[1] + 14, "PH", 6.5, SLATE[0], SLATE[1], SLATE[2], 0.9);
}

function paint() {
    if (isDemo && dMax.length === 0) initDemo();
    var wh = canvasSize();
    if (layoutMode === "b") paintB(wh[0], wh[1]);
    else if (layoutMode === "c") paintC(wh[0], wh[1]);
    else paintA(wh[0], wh[1]);
}

// ---------------------------------------------------------------------------
// Mouse: the Phase handle (layouts a and c)
// ---------------------------------------------------------------------------
function trackRect() {
    if (layoutMode === "a") return TRACK_A;
    if (layoutMode === "c") return TRACK_C;
    return null;
}

function setPhaseFromX(x) {
    var t = trackRect();
    if (!t) return;
    var v = ((x - t[0]) / Math.max(1, t[2])) * 200 - 100;
    v = clamp(Math.round(v), -100, 100);
    if (Math.abs(v) <= 3) v = 0;
    curPhase = v;
    if (isDemo) initDemo();
    if (typeof outlet === "function") outlet(0, ["phase", v]);
    mgraphics.redraw();
}

function onclick(x, y) {
    var t = trackRect();
    if (!t) return;
    dragging = false;
    if (y < t[1] - 2) return;
    dragging = true;
    setPhaseFromX(x);
}

function ondrag(x, y) {
    if (!dragging) return;
    setPhaseFromX(x);
}

function ondblclick(x, y) {
    var t = trackRect();
    if (!t || y < t[1] - 2) return;
    curPhase = 0;
    if (isDemo) initDemo();
    if (typeof outlet === "function") outlet(0, ["phase", 0]);
    mgraphics.redraw();
}

function onidleout() {
    dragging = false;
}

function loadbang() {
    mgraphics.redraw();
}
