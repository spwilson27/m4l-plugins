// Sand — Audio-Reactive Differential Compander Visualizer & Interactive XY Scope.
// Reads stereo output + input silhouette + isolated wet grit + peak telemetry
// from buffer~ #0-sandwave, renders an audio-reactive waveform + sand particle
// field + live multi-stage compander transfer curve + dual GRIT/OUT meters.
// Dragging vertically adjusts Amount (0..140 dB); dragging horizontally adjusts Freq.
// Amount, Freq, and Out mode live in the automatable LCD strip directly above this canvas.

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var waveBuf = null;
var waveTask = null;
var WAVE = 128;

var left = [];
var right = [];
var dryWave = [];
var gritWave = [];
var particles = [];
var NUM_PARTICLES = 34;

// Live parameter state (mirrored from controls so transfer curve & reticles react)
var curAmountDb = 18.0;
var curSoftPct = 35.0;
var curDebrickPct = 0.0;
var curFreqHz = 14000.0;
var curOrder = 1;
var curStages = 1;
var curFType = 0;   // 0=LP, 1=BP, 2=HP
var curFPos = 2;    // 0=Pre, 1=Diff, 2=Post
var curOutMode = 1; // 0=Off, 1=Soft, 2=Hard, 3=Lim
var curMixPct = 50.0;

// Smoothed audio-reactive telemetry
var liveInPeak = 0.0;
var liveWetPeak = 0.0;
var liveOutPeak = 0.0;
var tickPhase = 0.0;
var isDemo = false;
var dragActive = false;

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function initArrays(demo) {
    left = [];
    right = [];
    dryWave = [];
    gritWave = [];
    particles = [];
    var i;
    for (i = 0; i < WAVE; i++) {
        if (!demo) {
            left.push(0);
            right.push(0);
            dryWave.push(0);
            gritWave.push(0);
        } else {
            var t = i / (WAVE - 1);
            var env = Math.exp(-((t - 0.22) * (t - 0.22)) / 0.018) * 0.85
                    + Math.exp(-((t - 0.64) * (t - 0.64)) / 0.028) * 0.68
                    + 0.14;
            var body = Math.sin(t * 6.2831853 * 4.0) * env * 0.55;
            var hf = (Math.sin(i * 1.9) * 0.42 + Math.cos(i * 3.7 + 0.6) * 0.36 + Math.sin(i * 7.1) * 0.22);
            var lifted = Math.tanh(hf * (1.2 + (curAmountDb / 140.0) * 3.2)) * (0.38 + 0.52 * env);
            dryWave.push(clamp(body, -1, 1));
            gritWave.push(clamp(lifted, -1, 1));
            left.push(clamp(body * 0.35 + lifted * 0.82, -1, 1));
            right.push(clamp(body * 0.30 + Math.sin(i * 2.3 + 0.9) * (0.32 + 0.45 * env), -1, 1));
        }
    }
    for (i = 0; i < NUM_PARTICLES; i++) {
        var px = (i + 0.5) / NUM_PARTICLES;
        var seedA = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
        seedA = seedA - Math.floor(seedA);
        var seedB = Math.sin(i * 78.233 + 1.732) * 19341.123;
        seedB = seedB - Math.floor(seedB);
        particles.push({
            x01: px,
            yOff: (seedA - 0.5) * 1.35,
            radius: 1.0 + seedB * 1.4,
            energy: demo ? (0.35 + 0.65 * Math.abs(Math.sin(i * 0.65))) : 0.0,
            hue: seedB
        });
    }
    if (demo) {
        liveInPeak = 0.42;
        liveWetPeak = 0.78;
        liveOutPeak = 0.71;
    }
}

initArrays(false);

function preview() {
    isDemo = true;
    initArrays(true);
}

function setbuffer(name) {
    if (!name || typeof Buffer !== "function") return;
    isDemo = false;
    waveBuf = new Buffer("" + name);
    if (waveTask || typeof Task !== "function") return;
    waveTask = new Task(function () {
        pullWave();
        mgraphics.redraw();
    }, this);
    waveTask.interval = 33;
    waveTask.repeat();
}

function set_amount(v) {
    curAmountDb = clamp(Number(v) || 0, 0, 140);
    if (isDemo) initArrays(true);
    mgraphics.redraw();
}

function set_soft(v) {
    curSoftPct = clamp(Number(v) || 0, 0, 100);
    mgraphics.redraw();
}

function set_debrick(v) {
    curDebrickPct = clamp(Number(v) || 0, 0, 100);
    mgraphics.redraw();
}

function set_freq(v) {
    curFreqHz = clamp(Number(v) || 14000, 20, 18000);
    mgraphics.redraw();
}

function set_order(v) {
    curOrder = clamp(Math.round(Number(v) || 0), -1, 15);
    mgraphics.redraw();
}

function set_stages(v) {
    curStages = clamp(Math.round(Number(v) || 1), 1, 4);
    mgraphics.redraw();
}

function set_ftype(v) {
    curFType = clamp(Math.round(Number(v) || 0), 0, 2);
    mgraphics.redraw();
}

function set_fpos(v) {
    curFPos = clamp(Math.round(Number(v) || 0), 0, 2);
    mgraphics.redraw();
}

function set_outmode(v) {
    curOutMode = clamp(Math.round(Number(v) || 0), 0, 3);
    mgraphics.redraw();
}

function set_mix(v) {
    curMixPct = clamp(Number(v) || 0, 0, 100);
    mgraphics.redraw();
}

function sampleAt(chunk, index) {
    if (typeof chunk === "number") return index === 0 ? chunk : 0;
    if (!chunk || !chunk.length || index >= chunk.length) return 0;
    var v = chunk[index];
    return v === v ? v : 0;
}

function pullWave() {
    if (!waveBuf) return;
    var l = waveBuf.peek(1, 0, 260);
    var r = waveBuf.peek(2, 0, 256);
    var wpos = Math.round(clamp(sampleAt(l, 259), 0, WAVE - 1));
    var n;
    var idx;
    var maxL = 0;
    var maxG = 0;
    var maxIn = 0;
    for (n = 0; n < WAVE; n++) {
        idx = (wpos + n) & 127;
        var lv = clamp(sampleAt(l, idx), -1.2, 1.2);
        var rv = clamp(sampleAt(r, idx), -1.2, 1.2);
        var dv = clamp(sampleAt(l, 128 + idx), -1.2, 1.2);
        var gv = clamp(sampleAt(r, 128 + idx), -1.2, 1.2);
        left[n] = lv;
        right[n] = rv;
        dryWave[n] = dv;
        gritWave[n] = gv;
        if (Math.abs(lv) > maxL) maxL = Math.abs(lv);
        if (Math.abs(gv) > maxG) maxG = Math.abs(gv);
        if (Math.abs(dv) > maxIn) maxIn = Math.abs(dv);
    }
    var pkI = Math.max(maxIn, clamp(sampleAt(l, 256), 0, 1.5));
    var pkW = Math.max(maxG, clamp(sampleAt(l, 257), 0, 1.5));
    var pkO = Math.max(maxL, clamp(sampleAt(l, 258), 0, 1.5));

    liveInPeak = liveInPeak + (pkI - liveInPeak) * (pkI > liveInPeak ? 0.55 : 0.22);
    liveWetPeak = liveWetPeak + (pkW - liveWetPeak) * (pkW > liveWetPeak ? 0.60 : 0.22);
    liveOutPeak = liveOutPeak + (pkO - liveOutPeak) * (pkO > liveOutPeak ? 0.60 : 0.22);
    tickPhase += 0.22;

    for (var p = 0; p < NUM_PARTICLES; p++) {
        var pt = particles[p];
        var wIdx = Math.min(WAVE - 1, Math.floor(pt.x01 * WAVE));
        var localGrit = Math.max(Math.abs(gritWave[wIdx]), Math.abs(left[wIdx]));
        pt.energy = pt.energy * 0.72 + localGrit * 0.55;
        var drift = Math.sin(tickPhase + p * 0.9) * (0.15 + 0.85 * Math.min(1, liveWetPeak));
        pt.yOff = clamp(pt.yOff * 0.82 + (gritWave[wIdx] >= 0 ? 1 : -1) * (0.25 + localGrit * 0.75) + drift * 0.18, -1.15, 1.15);
    }
}

function compandEval(xNorm) {
    var amt01 = clamp(curAmountDb / 140.0, 0, 1);
    var soft01 = clamp(curSoftPct / 100.0, 0, 1);
    var brick01 = clamp(curDebrickPct / 100.0, 0, 1);
    var v = clamp(xNorm, 0, 1);
    var drive = 1.0 + amt01 * 18.0;
    var stg = clamp(curStages, 1, 4);
    for (var s = 0; s < stg; s++) {
        var y = v * drive;
        var hard = clamp(y, 0, 1.0);
        var soft = Math.tanh(y * (0.85 - 0.35 * soft01));
        var shaped = hard + (soft - hard) * soft01;
        var mild = Math.tanh(v * (2.4 - 1.1 * soft01));
        v = shaped + (mild - shaped) * brick01;
    }
    return clamp(v, 0, 1);
}

function canvasSize() {
    var s = mgraphics.size;
    if (!s || s.length < 2) return [192, 114];
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

function freqToNorm(hz) {
    var lo = Math.log(20);
    var hi = Math.log(18000);
    return clamp((Math.log(clamp(hz, 20, 18000)) - lo) / (hi - lo), 0, 1);
}

function normToFreq(n01) {
    var lo = Math.log(20);
    var hi = Math.log(18000);
    return Math.exp(lo + clamp(n01, 0, 1) * (hi - lo));
}

function onclick(x, y) {
    dragActive = true;
    ondrag(x, y);
}

function ondrag(x, y) {
    if (!dragActive) return;
    var wh = canvasSize();
    var w = wh[0];
    var h = wh[1];
    var plotX = 4;
    var plotY = 4;
    var plotW = w - 32;
    var plotH = h - 8;
    var ny = clamp(1.0 - (y - plotY) / Math.max(1, plotH), 0, 1);
    var nx = clamp((x - plotX) / Math.max(1, plotW), 0, 1);
    curAmountDb = Math.round(ny * 140.0 * 10) / 10;
    curFreqHz = Math.round(normToFreq(nx));
    if (typeof outlet === "function") {
        outlet(0, ["amount", curAmountDb]);
        outlet(0, ["freq", curFreqHz]);
    }
    if (!waveBuf) initArrays(true);
    mgraphics.redraw();
}

function paint() {
    if (!waveBuf && left[0] === 0 && left[64] === 0) {
        isDemo = true;
        initArrays(true);
    }

    var wh = canvasSize();
    var w = wh[0];
    var h = wh[1];

    var meterW = 22;
    var plotX = 4;
    var plotY = 4;
    var plotW = w - plotX - meterW - 6;
    var plotH = h - 8;
    var midY = plotY + plotH * 0.5;
    var ampY = plotH * 0.43;

    // 1. Scope Plot Well + Reticle Grid
    drawRRect(0, 0, w, h, 4, [0.032, 0.038, 0.050, 1.0], [0.16, 0.20, 0.26, 1.0], 1);

    mgraphics.set_line_width(1);
    var gridFracs = [0.22, 0.5, 0.78];
    for (var g = 0; g < gridFracs.length; g++) {
        var gy = plotY + plotH * gridFracs[g];
        mgraphics.set_source_rgba(0.14, 0.18, 0.24, g === 1 ? 0.75 : 0.42);
        mgraphics.move_to(plotX + 2, gy);
        mgraphics.line_to(plotX + plotW - 2, gy);
        mgraphics.stroke();
    }

    // Vertical Filter Frequency Cutoff Reticle (Electric Cyan)
    var freqX = plotX + 4 + freqToNorm(curFreqHz) * (plotW - 8);
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.26, 0.84, 0.96, 0.38);
    mgraphics.move_to(freqX, plotY + 2);
    mgraphics.line_to(freqX, plotY + plotH - 2);
    mgraphics.stroke();

    // Horizontal Amount (Quiet-Lift) Horizon Reticle (Warm Amber)
    var amt01 = clamp(curAmountDb / 140.0, 0, 1);
    var liftY = plotY + plotH - amt01 * (plotH - 6) - 3;
    mgraphics.set_source_rgba(0.96, 0.66, 0.24, 0.34);
    mgraphics.move_to(plotX + 2, liftY);
    mgraphics.line_to(plotX + plotW - 2, liftY);
    mgraphics.stroke();

    // 2. Dry Input Ghost Silhouette (Translucent Slate-Cyan)
    mgraphics.set_source_rgba(0.26, 0.78, 0.95, 0.16);
    mgraphics.move_to(plotX + 2, midY);
    var n;
    var x;
    var y;
    for (n = 0; n < WAVE; n++) {
        x = plotX + 2 + (plotW - 4) * (n / (WAVE - 1));
        y = clamp(midY - dryWave[n] * ampY, plotY + 2, plotY + plotH - 2);
        mgraphics.line_to(x, y);
    }
    mgraphics.line_to(plotX + plotW - 2, midY);
    if (mgraphics.close_path) mgraphics.close_path();
    mgraphics.fill();

    // 3. Companded Grit Shaded Area Fill (Warm Amber Glow)
    mgraphics.set_source_rgba(0.96, 0.62, 0.20, 0.20 + 0.12 * clamp(liveWetPeak, 0, 1));
    mgraphics.move_to(plotX + 2, midY);
    for (n = 0; n < WAVE; n++) {
        x = plotX + 2 + (plotW - 4) * (n / (WAVE - 1));
        y = clamp(midY - left[n] * ampY, plotY + 2, plotY + plotH - 2);
        mgraphics.line_to(x, y);
    }
    mgraphics.line_to(plotX + plotW - 2, midY);
    if (mgraphics.close_path) mgraphics.close_path();
    mgraphics.fill();

    // 4. Audio-Reactive Sand Grain Particle Cloud
    if (mgraphics.arc) {
        for (var p = 0; p < NUM_PARTICLES; p++) {
            var pt = particles[p];
            var pEnergy = clamp(pt.energy + amt01 * 0.25, 0, 1);
            if (pEnergy < 0.05) continue;
            var px = plotX + 4 + pt.x01 * (plotW - 8);
            var py = clamp(midY - pt.yOff * ampY * (0.55 + 0.45 * pEnergy), plotY + 4, plotY + plotH - 4);
            var pr = pt.radius * (0.75 + 0.45 * pEnergy);
            if (pt.hue > 0.62) {
                mgraphics.set_source_rgba(0.32, 0.86, 0.98, 0.35 + 0.50 * pEnergy);
            } else {
                mgraphics.set_source_rgba(0.98, 0.76, 0.34, 0.38 + 0.52 * pEnergy);
            }
            mgraphics.arc(px, py, pr, 0, 6.2831853);
            mgraphics.fill();
        }
    }

    // 5. Right Channel Trace (Coral-Copper)
    mgraphics.set_line_width(1.2);
    mgraphics.set_source_rgba(0.94, 0.44, 0.32, 0.78);
    for (n = 0; n < WAVE; n++) {
        x = plotX + 2 + (plotW - 4) * (n / (WAVE - 1));
        y = clamp(midY - right[n] * ampY, plotY + 2, plotY + plotH - 2);
        if (n === 0) mgraphics.move_to(x, y);
        else mgraphics.line_to(x, y);
    }
    mgraphics.stroke();

    // 6. Left Channel Hero Grit Trace (Bright Amber-Gold)
    mgraphics.set_line_width(1.55);
    mgraphics.set_source_rgba(0.98, 0.74, 0.30, 0.96);
    for (n = 0; n < WAVE; n++) {
        x = plotX + 2 + (plotW - 4) * (n / (WAVE - 1));
        y = clamp(midY - left[n] * ampY, plotY + 2, plotY + plotH - 2);
        if (n === 0) mgraphics.move_to(x, y);
        else mgraphics.line_to(x, y);
    }
    mgraphics.stroke();

    // 7. Compander Transfer Curve Inset (Top-Right of Scope)
    var cw = 40;
    var ch = 34;
    var cx = plotX + plotW - cw - 4;
    var cy = plotY + 4;

    drawRRect(cx, cy, cw, ch, 3, [0.055, 0.068, 0.088, 0.92], [0.24, 0.30, 0.38, 0.95], 1);

    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.25, 0.32, 0.40, 0.55);
    mgraphics.move_to(cx + 3, cy + ch - 3);
    mgraphics.line_to(cx + cw - 3, cy + 3);
    mgraphics.stroke();

    mgraphics.set_line_width(1.4);
    mgraphics.set_source_rgba(0.28, 0.86, 0.98, 0.95);
    var steps = 20;
    for (var s = 0; s <= steps; s++) {
        var u = s / steps;
        var v = compandEval(u);
        var tx = cx + 3 + u * (cw - 6);
        var ty = cy + ch - 3 - v * (ch - 6);
        if (s === 0) mgraphics.move_to(tx, ty);
        else mgraphics.line_to(tx, ty);
    }
    mgraphics.stroke();

    var opIn = clamp(liveInPeak > 0.01 ? liveInPeak : 0.32, 0, 1);
    var opOut = compandEval(opIn);
    var dotX = cx + 3 + opIn * (cw - 6);
    var dotY = cy + ch - 3 - opOut * (ch - 6);
    if (mgraphics.arc) {
        mgraphics.set_source_rgba(0.98, 0.72, 0.26, 1.0);
        mgraphics.arc(dotX, dotY, 2.4, 0, 6.2831853);
        mgraphics.fill();
    }

    // 8. Right-Edge Dual Audio-Reactive Meter Column (GRIT & OUT)
    var mx = w - meterW - 3;
    drawRRect(mx, plotY, meterW, plotH, 3, [0.035, 0.042, 0.055, 1.0], [0.16, 0.20, 0.26, 1.0], 1);

    var barW = 6;
    var maxBarH = plotH - 14;
    var grit01 = clamp(liveWetPeak, 0, 1);
    var out01 = clamp(liveOutPeak, 0, 1);

    var gritH = Math.max(2, grit01 * maxBarH);
    var outH = Math.max(2, out01 * maxBarH);

    mgraphics.set_source_rgba(0.28, 0.84, 0.96, 0.90);
    mgraphics.rectangle(mx + 3, plotY + plotH - 3 - gritH, barW, gritH);
    mgraphics.fill();

    if (out01 > 0.92) mgraphics.set_source_rgba(0.96, 0.42, 0.38, 0.95);
    else mgraphics.set_source_rgba(0.98, 0.70, 0.26, 0.92);
    mgraphics.rectangle(mx + 12, plotY + plotH - 3 - outH, barW, outH);
    mgraphics.fill();

    drawText(mx + 3, plotY + 9, "G", 7.0, 0.28, 0.84, 0.96, 0.92);
    drawText(mx + 12, plotY + 9, "O", 7.0, 0.98, 0.70, 0.26, 0.92);
}

function loadbang() {
    mgraphics.redraw();
}
