// Reciprocator scrolling waveform + envelope + gate + output HUD.
// src/reciprocator_config.js is prepended at build time.
// Supports interactive dragging of the Gate & Ceiling horizontal bars inside the scope,
// visualizes normal vs reverse gate shading, and adapts cleanly to the 448x169 layout.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var scopeBuf = null;
var scopeTask = null;

var histIn = [];
var histEnv = [];
var histOut = [];
var histGate = [];

var curGateDb = -42.0;
var curCeilingDb = -1.0;
var curAmountPct = 100.0;
var curOutMode = 0; // 0 = Soft, 1 = Hard, 2 = Lim
var curRevGate = 0; // 0 = Normal, 1 = Reverse (Duck)
var liveGainNorm = 0.58;
var liveGateOpen = 1.0;
var liveOutPeak = 0.0;
var liveEnvPeak = 0.0;

var dragTarget = ""; // "gate" | "ceiling" | ""

function initHistory(demo) {
    histIn = [];
    histEnv = [];
    histOut = [];
    histGate = [];
    var gateLin = dbToLin(curGateDb);
    var ceilLin = dbToLin(curCeilingDb);
    for (var i = 0; i < SCOPE_COLS; i++) {
        if (!demo) {
            histIn.push(0);
            histEnv.push(0);
            histOut.push(0);
            histGate.push(0);
        } else {
            var ph = (i / SCOPE_COLS) * 3.0;
            var hitIdx = Math.floor(ph);
            var localT = ph - hitIdx;
            var burst = Math.exp(-localT * (hitIdx === 1 ? 4.8 : 3.4)) * (hitIdx === 0 ? 0.85 : (hitIdx === 1 ? 0.45 : 0.72));
            var ripple = 0.82 + 0.18 * Math.sin(i * 0.55);
            var inVal = localT > 0.78 ? 0.008 * Math.abs(Math.sin(i * 0.9)) : burst * ripple;
            var envVal = Math.max(inVal * 0.92, 0.002);
            var gain = computeRecipGain(envVal, curAmountPct / 100.0, curGateDb, curCeilingDb, curRevGate);
            var outVal = applyCeiling(inVal * gain, ceilLin, curOutMode);
            var gFactor = computeGateFactor(envVal, gateLin, curRevGate);
            histIn.push(clamp(inVal, 0, 1));
            histEnv.push(clamp(envVal, 0, 1));
            histOut.push(clamp(outVal, 0, 1));
            histGate.push(clamp(gFactor, 0, 1));
        }
    }
    if (demo) {
        liveEnvPeak = 0.14;
        liveOutPeak = dbToLin(curCeilingDb) * 0.92;
        liveGateOpen = 1.0;
        liveGainNorm = 0.58;
    }
}

initHistory(false);

function preview() {
    initHistory(true);
}

function setbuffer(name) {
    if (!name) return;
    scopeBuf = new Buffer("" + name);
}

function set_gate(db) {
    curGateDb = clamp(Number(db) || -42.0, -72.0, -6.0);
    if (!scopeBuf) initHistory(true);
    mgraphics.redraw();
}

function set_ceiling(db) {
    curCeilingDb = clamp(Number(db) || -1.0, -18.0, 0.0);
    if (!scopeBuf) initHistory(true);
    mgraphics.redraw();
}

function set_amount(pct) {
    curAmountPct = clamp(Number(pct) || 0.0, 0.0, 150.0);
    if (!scopeBuf) initHistory(true);
    mgraphics.redraw();
}

function set_outmode(v) {
    curOutMode = clamp(Math.round(Number(v) || 0), 0, 2);
    if (!scopeBuf) initHistory(true);
    mgraphics.redraw();
}

function set_revgate(v) {
    curRevGate = Number(v) > 0.5 ? 1 : 0;
    if (!scopeBuf) initHistory(true);
    mgraphics.redraw();
}

function sampleAt(chunk, idx) {
    if (typeof chunk === "number") return idx === 0 ? chunk : 0;
    if (!chunk || !chunk.length || idx >= chunk.length) return 0;
    var v = chunk[idx];
    return (v === v && v > 0) ? v : 0;
}

function pullScope() {
    if (!scopeBuf) return;
    var chunk = scopeBuf.peek(1, 0, 8);
    var inPk = clamp(sampleAt(chunk, 0), 0, 1);
    var envPk = clamp(sampleAt(chunk, 1), 0, 1);
    var gateOpen = clamp(sampleAt(chunk, 2), 0, 1);
    var gainNorm = clamp(sampleAt(chunk, 3), 0, 1);
    var outPk = clamp(sampleAt(chunk, 4), 0, 1);

    liveEnvPeak = liveEnvPeak + (envPk - liveEnvPeak) * (envPk > liveEnvPeak ? 0.6 : 0.25);
    liveOutPeak = liveOutPeak + (outPk - liveOutPeak) * (outPk > liveOutPeak ? 0.65 : 0.25);
    liveGateOpen = liveGateOpen + (gateOpen - liveGateOpen) * 0.4;
    liveGainNorm = liveGainNorm + (gainNorm - liveGainNorm) * 0.35;

    histIn.shift();
    histIn.push(inPk);
    histEnv.shift();
    histEnv.push(envPk);
    histOut.shift();
    histOut.push(outPk);
    histGate.shift();
    histGate.push(gateOpen);
}

function loadbang() {
    if (typeof Task === "function") {
        scopeTask = new Task(function () {
            pullScope();
            mgraphics.redraw();
        }, this);
        scopeTask.interval = 33;
        scopeTask.repeat();
    }
    mgraphics.redraw();
}

function canvasSize() {
    var s = mgraphics.size;
    if (!s || s.length < 2) return [162, 132];
    return [s[0], s[1]];
}

function ampToVisual01(lin) {
    if (lin <= 0.0001) return 0;
    var db = 20 * Math.log10(Math.min(lin, 1.0));
    var db01 = clamp((db + 66.0) / 66.0, 0, 1);
    var lin01 = clamp(Math.sqrt(lin), 0, 1);
    return 0.62 * db01 + 0.38 * lin01;
}

function visual01ToDb(v01) {
    var c = clamp(v01, 0, 1);
    return -66.0 + c * 66.0;
}

function plotBounds() {
    var sz = canvasSize();
    var w = sz[0];
    var h = sz[1];
    var plotX = 6;
    var plotY = 18;
    var meterW = 24;
    var plotW = w - plotX - meterW - 8;
    var plotH = h - plotY - 6;
    return { w: w, h: h, plotX: plotX, plotY: plotY, plotW: plotW, plotH: plotH, baseY: plotY + plotH, meterW: meterW };
}

function onclick(x, y) {
    var b = plotBounds();
    var gateY = b.baseY - ampToVisual01(dbToLin(curGateDb)) * b.plotH;
    var ceilY = b.baseY - ampToVisual01(dbToLin(curCeilingDb)) * b.plotH;
    if (Math.abs(y - gateY) <= Math.abs(y - ceilY) && Math.abs(y - gateY) < 14) {
        dragTarget = "gate";
    } else if (Math.abs(y - ceilY) < 14) {
        dragTarget = "ceiling";
    } else {
        dragTarget = y > b.plotY + b.plotH * 0.45 ? "gate" : "ceiling";
    }
    ondrag(x, y);
}

function ondrag(x, y) {
    if (!dragTarget) return;
    var b = plotBounds();
    var v01 = clamp((b.baseY - y) / Math.max(1, b.plotH), 0, 1);
    var db = visual01ToDb(v01);
    if (dragTarget === "gate") {
        curGateDb = Math.round(clamp(db, -72.0, -6.0) * 10) / 10;
        outlet(0, ["gate", curGateDb]);
    } else if (dragTarget === "ceiling") {
        curCeilingDb = Math.round(clamp(db, -18.0, 0.0) * 10) / 10;
        outlet(0, ["ceiling", curCeilingDb]);
    }
    if (!scopeBuf) initHistory(true);
    mgraphics.redraw();
}

function paint() {
    if (!scopeBuf && histOut[SCOPE_COLS - 1] === 0 && histEnv[0] === 0) {
        initHistory(true);
    }

    var b = plotBounds();
    var w = b.w;
    var h = b.h;
    var plotX = b.plotX;
    var plotY = b.plotY;
    var plotW = b.plotW;
    var plotH = b.plotH;
    var baseY = b.baseY;
    var meterW = b.meterW;

    // Outer dark LCD background
    mgraphics.set_source_rgba(0.047, 0.059, 0.075, 1.0);
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();

    // Subtle horizontal dB grid lines (-6, -18, -36, -54 dB)
    var gridDbs = [-6, -18, -36, -54];
    mgraphics.set_line_width(1);
    for (var g = 0; g < gridDbs.length; g++) {
        var gy = baseY - ampToVisual01(dbToLin(gridDbs[g])) * plotH;
        mgraphics.set_source_rgba(0.15, 0.19, 0.24, 0.65);
        mgraphics.move_to(plotX, gy);
        mgraphics.line_to(plotX + plotW, gy);
        mgraphics.stroke();
    }

    // Gate pass-region tint (shows whether gate passes above or below threshold)
    var gateY = baseY - ampToVisual01(dbToLin(curGateDb)) * plotH;
    mgraphics.set_source_rgba(0.96, 0.42, 0.42, 0.06);
    if (curRevGate > 0.5) {
        mgraphics.rectangle(plotX, gateY, plotW, baseY - gateY);
    } else {
        mgraphics.rectangle(plotX, plotY, plotW, gateY - plotY);
    }
    mgraphics.fill();

    // 1. Input waveform silhouette (slate fill)
    mgraphics.set_source_rgba(0.28, 0.36, 0.46, 0.30);
    mgraphics.move_to(plotX, baseY);
    for (var i = 0; i < SCOPE_COLS; i++) {
        var x = plotX + (i / (SCOPE_COLS - 1)) * plotW;
        var yIn = baseY - ampToVisual01(histIn[i]) * plotH;
        mgraphics.line_to(x, yIn);
    }
    mgraphics.line_to(plotX + plotW, baseY);
    mgraphics.close_path();
    mgraphics.fill();

    // 2. Reciprocated output waveform fill & amber crest
    mgraphics.set_source_rgba(0.95, 0.62, 0.22, 0.22);
    mgraphics.move_to(plotX, baseY);
    for (var j = 0; j < SCOPE_COLS; j++) {
        var xOut = plotX + (j / (SCOPE_COLS - 1)) * plotW;
        var yOut = baseY - ampToVisual01(histOut[j]) * plotH;
        mgraphics.line_to(xOut, yOut);
    }
    mgraphics.line_to(plotX + plotW, baseY);
    mgraphics.close_path();
    mgraphics.fill();

    mgraphics.set_line_width(1.5);
    mgraphics.set_source_rgba(0.96, 0.66, 0.25, 0.92);
    for (var k = 0; k < SCOPE_COLS; k++) {
        var xO = plotX + (k / (SCOPE_COLS - 1)) * plotW;
        var yO = baseY - ampToVisual01(histOut[k]) * plotH;
        if (k === 0) mgraphics.move_to(xO, yO);
        else mgraphics.line_to(xO, yO);
    }
    mgraphics.stroke();

    // 3. Detected envelope trace (cyan)
    mgraphics.set_line_width(1.4);
    mgraphics.set_source_rgba(0.28, 0.84, 0.96, 0.95);
    for (var m = 0; m < SCOPE_COLS; m++) {
        var xE = plotX + (m / (SCOPE_COLS - 1)) * plotW;
        var yE = baseY - ampToVisual01(histEnv[m]) * plotH;
        if (m === 0) mgraphics.move_to(xE, yE);
        else mgraphics.line_to(xE, yE);
    }
    mgraphics.stroke();

    // 4. Draggable Ceiling line
    var ceilY = baseY - ampToVisual01(dbToLin(curCeilingDb)) * plotH;
    mgraphics.set_line_width(1.1);
    mgraphics.set_source_rgba(0.76, 0.90, 0.98, 0.65);
    mgraphics.move_to(plotX, ceilY);
    mgraphics.line_to(plotX + plotW, ceilY);
    mgraphics.stroke();

    // 5. Draggable Gate threshold dashed line (coral red)
    mgraphics.set_line_width(1.2);
    mgraphics.set_source_rgba(0.96, 0.42, 0.42, 0.88);
    var seg = 5;
    for (var gx = plotX; gx < plotX + plotW; gx += seg * 2) {
        mgraphics.move_to(gx, gateY);
        mgraphics.line_to(Math.min(gx + seg, plotX + plotW), gateY);
    }
    mgraphics.stroke();

    // Compact top HUD legend
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(8.5);
    mgraphics.set_source_rgba(0.28, 0.84, 0.96, 0.92);
    mgraphics.move_to(plotX, 12);
    mgraphics.show_text("ENV");

    mgraphics.set_source_rgba(0.96, 0.66, 0.25, 0.92);
    mgraphics.move_to(plotX + 24, 12);
    mgraphics.show_text("OUT");

    var gainDb = Math.round((liveGainNorm * 80.0) - 20.0);
    var gainTxt = (curRevGate > 0.5 ? "REV " : "1/E ") + (gainDb >= 0 ? "+" : "") + gainDb + "dB";
    mgraphics.set_source_rgba(0.78, 0.85, 0.92, 0.92);
    mgraphics.move_to(plotX + 52, 12);
    mgraphics.show_text(gainTxt);

    // 6. Right-hand Reciprocal Gain & Gate status meter column
    var mx = plotX + plotW + 5;
    mgraphics.set_source_rgba(0.08, 0.10, 0.13, 1.0);
    mgraphics.rectangle(mx, plotY, meterW - 2, plotH);
    mgraphics.fill();

    var barH = clamp(liveGainNorm, 0, 1) * (plotH - 6);
    var barY = baseY - barH;
    if (liveGateOpen > 0.15) {
        mgraphics.set_source_rgba(0.28, 0.84, 0.96, 0.85);
    } else {
        mgraphics.set_source_rgba(0.45, 0.5, 0.56, 0.45);
    }
    mgraphics.rectangle(mx + 3, barY, meterW - 8, barH);
    mgraphics.fill();

    mgraphics.set_font_size(7.5);
    if (liveGateOpen > 0.2) {
        mgraphics.set_source_rgba(0.28, 0.88, 0.66, 0.95);
        mgraphics.move_to(mx, 12);
        mgraphics.show_text("OPEN");
    } else {
        mgraphics.set_source_rgba(0.62, 0.66, 0.72, 0.75);
        mgraphics.move_to(mx, 12);
        mgraphics.show_text("MUTE");
    }

    // Subtle border
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.18, 0.22, 0.28, 1.0);
    mgraphics.rectangle(0.5, 0.5, w - 1, h - 1);
    mgraphics.stroke();
}
