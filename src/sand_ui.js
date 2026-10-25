// Sand — Audio-Reactive Differential Compander Visualizer & Interactive XY Scope.
// Reads stereo output + input silhouette + isolated wet grit + peak telemetry
// from buffer~ #0-sandwave, renders an audio-reactive waveform + sand particle
// field + live multi-stage compander transfer curve + dual GRIT/OUT meters.
// Dragging vertically adjusts Amount (0..140 dB); dragging horizontally adjusts Freq.
// Amount, Freq, and Out mode live in the automatable LCD strip directly above this canvas.

inlets = 1;
outlets = 2;

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
var curOutMode = 0; // 0=Off, 1=Hard, 2=Limit (matches the Out numbox)
var curMixPct = 50.0;
var waveName = "";
var scopeDirty = true;

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
    waveName = "" + name;
    waveBuf = new Buffer(waveName);
    scopeDirty = true;
    if (waveTask || typeof Task !== "function") return;
    waveTask = new Task(sandWaveTick, this);
    waveTask.interval = 33;
    waveTask.repeat();
}

// 30 fps scope poll. Skip the mgraphics pass while the buffer is silent, the
// meters and sand grains have decayed, and nothing has asked for a redraw.
function sandWaveTick() {
    pullWave();
    if (scopeDirty || sandScopeActive()) {
        mgraphics.redraw();
        scopeDirty = false;
    }
}

function sandScopeActive() {
    if (liveInPeak > 0.004 || liveWetPeak > 0.004 || liveOutPeak > 0.004) return true;
    var p;
    for (p = 0; p < particles.length; p++) {
        if (particles[p].energy > 0.03) return true;
    }
    return false;
}

function requestRedraw() {
    scopeDirty = false;
    mgraphics.redraw();
}

function set_amount(v) {
    curAmountDb = clamp(Number(v) || 0, 0, 140);
    if (isDemo) initArrays(true);
    requestRedraw();
}

function set_soft(v) {
    curSoftPct = clamp(Number(v) || 0, 0, 100);
    requestRedraw();
}

function set_debrick(v) {
    curDebrickPct = clamp(Number(v) || 0, 0, 100);
    requestRedraw();
}

function set_freq(v) {
    curFreqHz = clamp(Number(v) || 14000, 20, 18000);
    requestRedraw();
}

function set_order(v) {
    curOrder = clamp(Math.round(Number(v) || 0), -1, 15);
    requestRedraw();
}

function set_stages(v) {
    curStages = clamp(Math.round(Number(v) || 1), 1, 4);
    requestRedraw();
}

function set_ftype(v) {
    curFType = clamp(Math.round(Number(v) || 0), 0, 2);
    requestRedraw();
}

function set_fpos(v) {
    curFPos = clamp(Math.round(Number(v) || 0), 0, 2);
    requestRedraw();
}

function set_outmode(v) {
    curOutMode = clamp(Math.round(Number(v) || 0), 0, 3);
    requestRedraw();
}

function set_mix(v) {
    curMixPct = clamp(Number(v) || 0, 0, 100);
    requestRedraw();
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

// Transfer-curve inset. 21 samples, rebuilt only when Amount, Stages, Soft, or Debrick change.
var CURVE_STEPS = 20;
var curveKey = "";
/** @type {number[]} */
var curvePts = [];

function transferKey() {
    return curAmountDb + ":" + curStages + ":" + curSoftPct + ":" + curDebrickPct;
}

function ensureTransferCurve() {
    var k = transferKey();
    if (k === curveKey && curvePts.length === CURVE_STEPS + 1) return;
    curveKey = k;
    curvePts = [];
    var s;
    for (s = 0; s <= CURVE_STEPS; s++) curvePts.push(compandEval(s / CURVE_STEPS));
}

function transferAt(u) {
    ensureTransferCurve();
    var x = clamp(u, 0, 1) * CURVE_STEPS;
    var i = Math.floor(x);
    if (i >= CURVE_STEPS) return curvePts[CURVE_STEPS];
    var f = x - i;
    return curvePts[i] + (curvePts[i + 1] - curvePts[i]) * f;
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
    // The reticles are inset from the plot edge (paint: freq by 4 px, amount by 3 px
    // over a travel 6 px shorter). Map the click through that same inset.
    var ny = clamp((plotY + plotH - 3 - y) / Math.max(1, plotH - 6), 0, 1);
    var nx = clamp((x - (plotX + 4)) / Math.max(1, plotW - 8), 0, 1);
    curAmountDb = Math.round(ny * 140.0 * 10) / 10;
    curFreqHz = Math.round(normToFreq(nx));
    if (typeof outlet === "function") {
        outlet(0, ["amount", curAmountDb]);
        outlet(0, ["freq", curFreqHz]);
    }
    if (!waveBuf) initArrays(true);
    requestRedraw();
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
    ensureTransferCurve();
    var steps = CURVE_STEPS;
    for (var s = 0; s <= steps; s++) {
        var u = s / steps;
        var v = curvePts[s];
        var tx = cx + 3 + u * (cw - 6);
        var ty = cy + ch - 3 - v * (ch - 6);
        if (s === 0) mgraphics.move_to(tx, ty);
        else mgraphics.line_to(tx, ty);
    }
    mgraphics.stroke();

    var opIn = clamp(liveInPeak > 0.01 ? liveInPeak : 0.32, 0, 1);
    var opOut = transferAt(opIn);
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

    // Only while a gen~ is being created or has failed. A static preview never
    // calls init_dsp, so createdAt stays 0 and this pill is not drawn.
    if (sandDspPillOn()) drawDspPill(plotX, plotY);
}

function loadbang() {
    mgraphics.redraw();
}

// --- Deferred DSP (AGENTS.md 1d) -------------------------------------------------
// The device ships without gen~. live.thisdevice bangs init_dsp; one Task tick
// later we write /tmp/sand_core_<hash>.gendsp and create gen~ through Global("sand_dspq")
// so two instances never compile at once. Until that gen~ is wired, nothing connects
// plugin~ to plugout~ (silence). The gen drops messages while it compiles, so each
// confirm tick re-sends the buffer binding and every gen parameter from the JS
// state on outlet 1 (into the gate's data inlet). live.text toggles are never banged.

var sandHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var sandDsp = {
    ready: 0,
    error: "",
    createdAt: 0,
    counter0: -1,
    retries: 0,
    readyMs: 0,
    armed: 0,
    /** @type {Task | null} */
    task: null,
    /** @type {Task | null} */
    confirmTask: null,
    /** @type {Task | null} */
    settleTask: null
};
var SAND_DSP_RETRIES = 2;
var SAND_DSP_CLAIM_MS = 15000;
var SAND_DSP_QUEUE_POLL_MS = 100;
var SAND_DSP_CONFIRM_MS = 150;
var SAND_DSP_SETTLE_MS = 300;
var SAND_DSP_FIRST_TIMEOUT_MS = 3500;
var SAND_DSP_TIMEOUT_MS = 6000;
var sandDspToken = Math.random();

function sandDspTimeout() {
    return sandDsp.retries === 0 ? SAND_DSP_FIRST_TIMEOUT_MS : SAND_DSP_TIMEOUT_MS;
}

function sandDspPath() {
    return "/tmp/sand_core_" + GEN_DSP_HASH + ".gendsp";
}

/** @param {string} path */
function sandDspWriteFile(path) {
    try {
        var rf = new File(path, "read");
        var have = rf.isopen && rf.eof === GEN_DSP_TEXT.length;
        rf.close();
        if (have) return true;
    } catch (_) {}
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) return false;
    f.eof = 0;
    for (var i = 0; i < GEN_DSP_TEXT.length; i += 16384) f.writestring(GEN_DSP_TEXT.substring(i, i + 16384));
    f.close();
    return true;
}

// wpos at frame 259 (gen channel 0). It advances every 32 samples, silence included.
function sandDspFrames() {
    if (typeof Buffer !== "function") return -1;
    try {
        var v = new Buffer(waveName || "#0-sandwave").peek(1, 259, 1);
        var n = typeof v === "number" ? v : (v && v.length ? Number(v[0]) : NaN);
        return n === n ? n : -1;
    } catch (_) {
        return -1;
    }
}

/** @param {string} name */
function sandNamed(name) {
    if (!sandHost) return null;
    var o = sandHost.getnamed(name);
    if (!o || !o.valid) return null;
    return o;
}

// Gen parameters from the values the face holds. Outlet 1 is patched to the
// gate's data inlet. Do not bang live.text (a toggle would flip).
function sandDspResend() {
    if (typeof outlet !== "function") return;
    outlet(1, ["wave", waveName || "#0-sandwave"]);
    outlet(1, ["dorder", curOrder]);
    outlet(1, ["stages", curStages]);
    outlet(1, ["amount", curAmountDb]);
    outlet(1, ["ffreq", curFreqHz]);
    outlet(1, ["soft", curSoftPct]);
    outlet(1, ["debrick", curDebrickPct]);
    outlet(1, ["ftype", curFType]);
    outlet(1, ["fpos", curFPos]);
    outlet(1, ["mix", curMixPct]);
    outlet(1, ["outmode", curOutMode]);
}

function sandDspClaim() {
    var q = new Global("sand_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== sandDspToken && now - Number(q.t) < SAND_DSP_CLAIM_MS) return false;
    q.owner = sandDspToken;
    q.t = now;
    return true;
}

function sandDspRelease() {
    try {
        var q = new Global("sand_dspq");
        if (q.owner === sandDspToken) q.owner = 0;
    } catch (_) {}
}

function sandDspLoad() {
    if (sandDsp.ready || sandDsp.createdAt || !sandHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!sandDspClaim()) {
        if (!sandDsp.task) sandDsp.task = new Task(sandDspLoad, this);
        sandDsp.task.schedule(SAND_DSP_QUEUE_POLL_MS);
        return;
    }
    var created = null;
    try {
        var g = sandNamed("sand_gen");
        if (!g) {
            var path = sandDspPath();
            if (!sandDspWriteFile(path)) throw new Error("cannot write " + path);
            g = sandHost.newdefault(120, 420, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            created = g;
            g.varname = "sand_gen";
            var hub = sandNamed("sand_genin");
            var pin = sandNamed("sand_plugin");
            var pout = sandNamed("sand_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            sandHost.connect(hub, 0, g, 0);
            sandHost.connect(pin, 0, g, 0);
            sandHost.connect(pin, 1, g, 1);
            sandHost.connect(g, 0, pout, 0);
            sandHost.connect(g, 1, pout, 1);
        }
        sandDsp.createdAt = Date.now();
        sandDsp.counter0 = sandDspFrames();
        sandDspConfirm();
    } catch (err) {
        if (created) {
            try { sandHost.remove(created); } catch (_) {}
        }
        sandDsp.error = String(err && err.message ? err.message : err);
        sandDspRelease();
        post("Sand: DSP load failed: " + sandDsp.error + "\n");
    }
    sandDspChanged();
}

function sandDspConfirm() {
    var c = sandDspFrames();
    if (sandDsp.counter0 >= 0 && c >= 0 && c !== sandDsp.counter0) {
        sandDsp.ready = 1;
        sandDsp.error = "";
        sandDsp.readyMs = Date.now() - sandDsp.createdAt;
        sandDspRelease();
        sandDspResend();
        if (!sandDsp.settleTask) sandDsp.settleTask = new Task(sandDspResend, this);
        sandDsp.settleTask.schedule(SAND_DSP_SETTLE_MS);
        sandDspChanged();
        return;
    }
    if (Date.now() - sandDsp.createdAt > sandDspTimeout() && sandDsp.retries < SAND_DSP_RETRIES) {
        sandDsp.retries++;
        try {
            var old = sandNamed("sand_gen");
            if (old) sandHost.remove(old);
        } catch (_) {}
        sandDsp.createdAt = 0;
        sandDsp.counter0 = -1;
        sandDspLoad();
        return;
    }
    if (Date.now() - sandDsp.createdAt > sandDspTimeout()) {
        sandDsp.error = "not running";
        sandDspRelease();
        sandDspChanged();
        return;
    }
    sandDspResend();
    if (sandDsp.counter0 < 0) sandDsp.counter0 = c;
    if (!sandDsp.confirmTask) sandDsp.confirmTask = new Task(sandDspConfirm, this);
    sandDsp.confirmTask.schedule(SAND_DSP_CONFIRM_MS);
}

// From live.thisdevice (`init_dsp`): let the face paint first, then build the DSP.
function sandDspSchedule() {
    if (sandDsp.ready || sandDsp.createdAt || sandDsp.armed) return;
    if (!sandHost || typeof GEN_DSP_TEXT === "undefined" || typeof Task !== "function") return;
    sandDsp.armed = 1;
    if (!sandDsp.task) sandDsp.task = new Task(sandDspLoad, this);
    sandDsp.task.schedule(30);
}

function init_dsp() {
    sandDspSchedule();
}

function sandDspChanged() {
    scopeDirty = false;
    mgraphics.redraw();
}

function sandDspPillOn() {
    return !sandDsp.ready && (sandDsp.createdAt > 0 || sandDsp.error);
}

function drawDspPill(plotX, plotY) {
    var failed = !!sandDsp.error;
    var label = failed
        ? ("DSP failed: " + String(sandDsp.error).replace(/\s+/g, " ").substring(0, 18))
        : "DSP loading...";
    var tw = Math.min(150, label.length * 4.7 + 10);
    drawRRect(plotX + 2, plotY + 2, tw, 12, 3, [0.04, 0.05, 0.07, 0.82], null, 0);
    if (failed) drawText(plotX + 6, plotY + 11, label, 7.5, 0.96, 0.48, 0.44, 0.95);
    else drawText(plotX + 6, plotY + 11, label, 7.5, 0.98, 0.74, 0.30, 0.92);
}
