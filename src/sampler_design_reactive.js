// Better Sampler, design "reactive": a graph-first face.
//
// Appended after sampler_config.js + sampler_ui.js + sampler_face.js (see AGENTS.md section 14, "Design variants").
// It reuses the shared state, helpers (text / fillRR / strokeArc / zone / ...), the shared zone kinds
// (knob, value, button, wave, flag, xfade, loop_move, menu) and their handlers, and adds two zone kinds:
//   "hdl"  a draggable graph handle (envelope breakpoints, filter cutoff / resonance point)
//   "act"  a button with its own callback
//
// Layout (560 px front, +220 px drawer = 780):
//   y   3..19   engine pills | Amp / Mod tabs | filter header (power, type, drive, drawer toggle)
//   y  22..104  waveform | envelope curve | filter response curve
//   y 108..166  engine strip | LFO scope | Out
//   x 560..780  drawer with tabs ENGINE / MOD / VOICE / SAMPLE (show_inspector = drawer open)

var RW0 = (typeof DESIGN_WIDTH !== "undefined") ? DESIGN_WIDTH : 560;
var RDRAWER = 220;
var drawerTab = 0;          // 0 ENGINE, 1 MOD, 2 VOICE, 3 SAMPLE
var hoverHdl = "";
var RC = null;

// ---------------------------------------------------------------------------
// Theme: Live colours when max.getcolor knows them, fixed fallbacks otherwise
// ---------------------------------------------------------------------------

function themeCol(names, fb) {
    try {
        if (typeof max !== "undefined" && max && typeof max.getcolor === "function") {
            for (var i = 0; i < names.length; i++) {
                var c = max.getcolor(names[i]);
                if (c && c.length >= 3 && isFinite(c[0]) && (c[0] + c[1] + c[2] > 0.001 || (c.length > 3 && c[3] > 0))) return [c[0], c[1], c[2]];
            }
        }
    } catch (_) {}
    return fb;
}

function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function lumi(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }

function initTheme() {
    if (RC) return;
    var bg = themeCol(["live_surface_bg", "live_control_bg", "live_background"], [0.235, 0.235, 0.24]);
    var tx = themeCol(["live_control_fg", "live_lcd_control_fg"], [0.88, 0.88, 0.88]);
    var sel = themeCol(["live_control_selection", "live_selection"], [0.36, 0.66, 1.0]);
    var light = lumi(bg) > 0.5;
    var black = light ? [1, 1, 1] : [0.0, 0.0, 0.0];
    if (light !== (lumi(tx) < 0.5)) tx = light ? [0.1, 0.1, 0.1] : [0.88, 0.88, 0.88];
    RC = {
        light: light,
        bg: bg,
        panel: mixc(bg, black, light ? 0.55 : 0.34),
        raised: mixc(bg, tx, 0.10),
        wave: mixc(bg, black, light ? 0.7 : 0.62),
        line: mixc(bg, tx, 0.16),
        track: mixc(bg, tx, 0.22),
        text: tx,
        sub: mixc(bg, tx, 0.62),
        dim: mixc(bg, tx, 0.38),
        knob: mixc(bg, tx, 0.10),
        dark: [0.08, 0.08, 0.09],
        a_wave: sel,
        a_eng: [0.66, 0.54, 1.0],
        a_amp: [0.36, 0.86, 0.56],
        a_mod: [0.96, 0.46, 0.76],
        a_filt: [1.0, 0.64, 0.24],
        a_lfo: [0.96, 0.86, 0.32],
        a_out: [0.86, 0.88, 0.92],
        yellow: [0.96, 0.86, 0.28],
        green: [0.30, 0.85, 0.68],
        orange: [0.98, 0.63, 0.20]
    };
}

// ---------------------------------------------------------------------------
// Cheap telemetry: redraw only when something moved
// ---------------------------------------------------------------------------

var telSig = -1;
var telChanged = true;
var lfoPhaseEst = 0;
var lfoDir = 1;
var lfoPrevVal = 0;
var lfoHist = [];

function lfoShapeAt(shape, p) {
    p = p - Math.floor(p);
    if (shape === 0) return Math.sin(6.28318530718 * p);
    if (shape === 1) return 1.0 - 4.0 * Math.abs((p + 0.25 - Math.floor(p + 0.25)) - 0.5);
    return 2.0 * p - 1.0;
}

function lfoPhaseFromValue(shape, v, dir) {
    v = Math.max(-1, Math.min(1, v));
    var p;
    if (shape === 0) { p = Math.asin(v) / 6.28318530718; if (dir < 0) p = 0.5 - p; }
    else if (shape === 1) { p = dir >= 0 ? v / 4 : (2 - v) / 4; }
    else p = (v + 1) / 2;
    return p - Math.floor(p);
}

function pollTelemetryScope() {
    if (!scopeBufName || typeof Buffer === "undefined") return;
    try {
        var sb = new Buffer(scopeBufName);
        var data = sb.peek(1, 0, 128);
        if (!data || data.length < 40) return;
        for (var g = 0; g < GRAIN_SLOTS; g++) {
            grainPos[g] = data.length >= 128 ? data[64 + g] : -1;
            grainAmp[g] = data.length >= 128 ? data[96 + g] : 0;
        }
        for (var i = 0; i < 16; i++) {
            voicePlayheads[i] = data[i];
            voiceAmps[i] = data[16 + i];
        }
        livePeakL = data[32];
        livePeakR = data[33];
        liveActiveVoices = Math.round(data[34]);
        liveLfoVal = data[35];
        liveModEnvVal = data[36];
        liveEffCutHz = data[37] > 10 ? data[37] : curFiltCutoff;
    } catch (_) { return; }
    var sig = liveActiveVoices * 1009 + Math.round(liveLfoVal * 400) * 7 + Math.round(liveModEnvVal * 200) * 13
        + Math.round(livePeakL * 120) * 17 + Math.round(livePeakR * 120) * 19 + Math.round(Math.log(Math.max(20, liveEffCutHz)) * 40) * 23;
    for (var v = 0; v < 16; v++) if (voiceAmps[v] > 0.02) sig += Math.round(voicePlayheads[v] * 400) * (29 + v) + Math.round(voiceAmps[v] * 60);
    for (var q = 0; q < GRAIN_SLOTS; q++) if (grainAmp[q] > 0.02) sig += Math.round(grainPos[q] * 400) * (31 + q);
    // LFO phase from the value (the telemetry carries the value only) and a short history for S&H
    var d = liveLfoVal - lfoPrevVal;
    if (d > 1e-4) lfoDir = 1; else if (d < -1e-4) lfoDir = -1;
    lfoPrevVal = liveLfoVal;
    var shp = Math.round(paramValue("lfo_shape"));
    if (shp < 3) lfoPhaseEst = lfoPhaseFromValue(shp, liveLfoVal, lfoDir);
    else if (sig !== telSig) { lfoHist.push(liveLfoVal); if (lfoHist.length > 40) lfoHist.shift(); }
    if (sig !== telSig) { telSig = sig; telChanged = true; }
}

scopeTask = (typeof Task !== "undefined") ? new Task(function () {
    pollTelemetryScope();
    if (telChanged) { telChanged = false; mgraphics.redraw(); }
    if (scopeTask) scopeTask.schedule((liveActiveVoices > 0 || livePeakL > 0.001) ? 45 : 80);
}) : null;

// The drawer is the "inspector": its open state is the show_inspector parameter, which sets the device width
function applyDeviceWidth() {
    outlet(0, "setwidth_cmd", RW0 + (showInspector ? RDRAWER : 0));
}

// ---------------------------------------------------------------------------
// Small widgets
// ---------------------------------------------------------------------------

function actZone(x, y, w, h, fn, extra) {
    var z = extra || {};
    z.fn = fn;
    return zone("act", x, y, w, h, z);
}

function panelBox(x, y, w, h) {
    fillRR(x, y, w, h, 6, RC.panel);
}

function secTitle(label, x, y, acc) {
    text(label, x, y, 7.5, acc, true, 0, 0.95);
}

function pill(x, y, w, h, label, on, acc, size) {
    fillRR(x, y, w, h, h * 0.5, on ? acc : RC.raised, on ? 0.9 : 1.0);
    text(label, x + w * 0.5, y + h * 0.5 + 3, size || 8.0, on ? RC.dark : RC.sub, on, 1);
}

// Segmented control over an enum (or any 0..n-1 value): each segment sets `key`
function segCtl(key, x, y, w, h, labels, acc, dimmed) {
    var cur = Math.round(paramValue(key));
    var n = labels.length, sw = w / n;
    fillRR(x, y, w, h, 3, RC.raised, dimmed ? 0.5 : 1);
    for (var i = 0; i < n; i++) {
        var on = i === cur;
        if (on) fillRR(x + i * sw + 1, y + 1, sw - 2, h - 2, 2.5, acc, dimmed ? 0.4 : 0.9);
        text(labels[i], x + i * sw + sw * 0.5, y + h * 0.5 + 3, 7.5, on ? RC.dark : RC.sub, on, 1);
        zone("button", x + i * sw, y, sw, h, { action: "menu_pick", key: key, value: i });
    }
}

// Switch: track + thumb, toggles `key`
function switchCtl(key, x, y, acc, dimmed) {
    var on = Math.round(paramValue(key)) > 0;
    fillRR(x, y + 1, 20, 9, 4.5, on ? acc : RC.track, dimmed ? 0.4 : (on ? 0.85 : 1));
    circle(x + (on ? 15.5 : 4.5), y + 5.5, 3.3, on ? RC.dark : RC.sub, dimmed ? 0.5 : 1);
    zone("button", x - 2, y - 1, 24, 13, { action: "toggle", key: key });
}

// Number pill, drag vertically
function valuePill(x, y, w, label, props, acc, dimmed) {
    fillRR(x, y, w, 11, 3, RC.raised, dimmed ? 0.5 : 1);
    text(label, x + w * 0.5, y + 8.5, 8.0, acc || RC.text, false, 1, dimmed ? 0.5 : 1);
    zone("value", x, y, w, 11, props);
}

function menuPill(key, x, y, w, label, acc, mw) {
    fillRR(x, y, w, 11, 3, RC.raised);
    text(fitText(label, w - 14, 8.0), x + 5, y + 8.5, 8.0, acc || RC.text, false, 0);
    caret(x + w - 10, y + 4, RC.sub);
    zone("button", x, y, w, 11, { action: "menu", key: key, w2: mw || w, below: true });
}

// ---------------------------------------------------------------------------
// Knobs with modulation rings
// ---------------------------------------------------------------------------

// Modulation of a knob from the LFO and Mod envelope: {ext: reach, cur: live offset}, both in normalised knob units
function knobMod(key) {
    var lv = liveLfoVal, mv = liveModEnvVal;
    var lp = paramValue("lfo_pitch") * 0.01, lps = paramValue("lfo_pos") * 0.01, lf = paramValue("lfo_filt") * 0.01;
    var mp = paramValue("menv_pitch") * 0.01, mps = paramValue("menv_pos") * 0.01, fe = paramValue("filt_env_amt") * 0.01;
    var sp = paramSpec(key);
    var span = sp.hi - sp.lo;
    if (key === "pitch_st") {
        var e1 = 24 * (Math.abs(lp) + Math.abs(mp));
        if (e1 < 0.01) return null;
        return { ext: e1 / span, cur: 24 * (lp * lv + mp * mv) / span };
    }
    if (key === "play_pos") {
        var e2 = 0.45 * (Math.abs(lps) + Math.abs(mps)) * 100;
        if (e2 < 0.01) return null;
        return { ext: e2 / span, cur: 0.45 * (lps * lv + mps * mv) * 100 / span };
    }
    return null;
}

// opts: dim, label colour, mod {ext, cur}, live {amt, val, acc}: a dot at amt * val on a bipolar depth knob
function rKnob(key, cx, cy, r, label, acc, opts) {
    opts = opts || {};
    var v = paramValue(key);
    var n = toNorm(key, v);
    var al = opts.dim ? 0.4 : 1.0;
    var ringR = r + 3.0;
    var ang = KNOB_A0 + n * KNOB_SWEEP;
    strokeArc(cx, cy, ringR, KNOB_A0, KNOB_A0 + KNOB_SWEEP, RC.track, al, 2.2);
    var from = BIPOLAR_KEYS[key] ? KNOB_A0 + KNOB_SWEEP * 0.5 : KNOB_A0;
    strokeArc(cx, cy, ringR, Math.min(from, ang), Math.max(from, ang), acc, al, 2.2);

    var md = opts.mod === undefined ? knobMod(key) : opts.mod;
    if (md && !opts.dim) {
        var mr = ringR + 3.4;
        var a0 = KNOB_A0 + clamp01(n - md.ext) * KNOB_SWEEP;
        var a1 = KNOB_A0 + clamp01(n + md.ext) * KNOB_SWEEP;
        strokeArc(cx, cy, mr, a0, a1, RC.a_mod, 0.42, 2.0);
        var ad = KNOB_A0 + clamp01(n + md.cur) * KNOB_SWEEP;
        circle(cx + Math.cos(ad) * mr, cy + Math.sin(ad) * mr, 2.0, [1, 1, 1], 0.95);
    }
    if (opts.live) {
        var mr2 = ringR + 3.4;
        var depth = BIPOLAR_KEYS[key] ? (n * 2 - 1) : n;       // -1..1 for the bipolar depth knobs
        var moved = 0.5 + 0.5 * depth * opts.live.val;          // knob centre + depth * live modulator value
        var al2 = KNOB_A0 + clamp01(moved) * KNOB_SWEEP;
        strokeArc(cx, cy, mr2, KNOB_A0, KNOB_A0 + KNOB_SWEEP, RC.line, 0.9, 1.0);
        circle(cx + Math.cos(al2) * mr2, cy + Math.sin(al2) * mr2, 2.1, opts.live.acc, 0.95);
    }
    circle(cx, cy, r, RC.knob, al);
    line(cx + Math.cos(ang) * r * 0.2, cy + Math.sin(ang) * r * 0.2, cx + Math.cos(ang) * r * 0.9, cy + Math.sin(ang) * r * 0.9, opts.dim ? RC.sub : RC.text, al, 1.7);

    if (label !== undefined && label !== null) {
        var ly = opts.labelY !== undefined ? opts.labelY : cy + ringR + (md || opts.live ? 12.5 : 9.5);
        var showVal = (hoverKey === key) || (drag && drag.key === key);
        if (showVal) text(fmtParam(key, v), cx, ly, 8.0, RC.text, true, 1);
        else if (label !== "") text(label, cx, ly, 8.0, RC.sub, false, 1, al);
    }
    zone("knob", cx - ringR - 3, cy - ringR - 3, ringR * 2 + 6, ringR * 2 + 15, { key: key });
}

// ---------------------------------------------------------------------------
// Header row: engines, envelope tabs, filter header
// ---------------------------------------------------------------------------

var PILL_W = { 0: 47, 3: 51, 1: 42, 2: 51, 4: 54 };

function paintHeaderRow() {
    var x = 4;
    for (var e = 0; e < ENGINE_ORDER.length; e++) {
        var m = ENGINE_ORDER[e];
        var w = PILL_W[m];
        var on = curMode === m;
        fillRR(x, 3, w, 16, 8, on ? RC.a_eng : RC.panel, on ? 0.95 : 1);
        text(MODE_NAMES[m], x + w * 0.5, 14.5, 8.5, on ? RC.dark : RC.sub, on, 1);
        zone("button", x, 3, w, 16, { action: "engine", engine: m });
        x += w + 3;
    }

    // Envelope tabs
    var ex = 268;
    var tabs = ["AMP", "MOD"];
    var tcol = [RC.a_amp, RC.a_mod];
    for (var t = 0; t < 2; t++) {
        var on2 = envPage === t || (envPage > 1 && t === 0);
        var tw = 44;
        fillRR(ex + t * (tw + 3), 3, tw, 16, 8, on2 ? tcol[t] : RC.panel, on2 ? 0.95 : 1);
        text(tabs[t], ex + t * (tw + 3) + tw * 0.5, 14.5, 8.5, on2 ? RC.dark : RC.sub, on2, 1);
        zone("button", ex + t * (tw + 3), 3, tw, 16, { action: "env_page", page: t });
    }
    text("ENVELOPE", ex + 2 * 47 + 4, 14.5, 7.0, RC.dim, false, 0);

    // Filter header: power, type, drive, drawer toggle
    var fx = 414;
    var on3 = curFiltOn;
    fillRR(fx, 3, 142, 16, 8, RC.panel);
    iconPower(fx + 10, 11, on3 ? RC.a_filt : RC.dim, 1.0);
    zone("button", fx + 2, 3, 16, 16, { action: "filt_on" });
    var ft = Math.round(paramValue("filt_type"));
    var names = ["LP", "BP", "HP"];
    for (var i = 0; i < 3; i++) {
        var sx = fx + 22 + i * 21;
        var son = ft === i;
        if (son) fillRR(sx, 5, 20, 12, 6, RC.a_filt, on3 ? 0.9 : 0.35);
        text(names[i], sx + 10, 14, 7.5, son ? RC.dark : RC.sub, son, 1);
        zone("button", sx, 4, 20, 14, { action: "menu_pick", key: "filt_type", value: i });
    }
    var drv = Math.round(paramValue("filt_drive"));
    var dtx = "Drv " + drv + "%";
    var dw = textW(dtx, 7.5);
    text(dtx, fx + 88, 14, 7.5, hoverKey === "filt_drive" || (drag && drag.key === "filt_drive") ? RC.text : RC.sub, false, 0);
    zone("value", fx + 86, 5, dw + 4, 12, { key: "filt_drive", norm: true });

    // Drawer toggle
    var dx = fx + 142 - 22;
    var open = !!showInspector;
    fillRR(dx, 5, 18, 12, 6, open ? RC.a_eng : RC.raised, open ? 0.9 : 1);
    var cc = open ? RC.dark : RC.sub;
    polygon(open ? [[dx + 11, 7.5], [dx + 11, 14.5], [dx + 6, 11]] : [[dx + 7, 7.5], [dx + 7, 14.5], [dx + 12, 11]], cc);
    actZone(dx - 1, 3, 20, 16, function () { setParamFromFace("show_inspector", showInspector ? 0 : 1); });
}

// ---------------------------------------------------------------------------
// Waveform panel
// ---------------------------------------------------------------------------

var WP = { x: 4, y: 22, w: 260, h: 82 };

function paintWavePanel() {
    var sx = WP.x, sy = WP.y, sw = WP.w, sh = WP.h;
    panelBox(sx, sy, sw, sh);
    var acc = RC.a_wave;

    // Header: file name, voices / DSP state, meters, Single / Sliced
    iconFolder(sx + 6, sy + 4, acc, 0.9);
    var nm = text(fitText(hasLoadedSample ? sampleFileName : "Drop a sample or click to browse", 112, 8.5), sx + 20, sy + 11.5, 8.5, hasLoadedSample ? acc : RC.sub, false, 0);
    zone("button", sx + 4, sy + 1, nm + 20, 13, { action: "browse" });
    if (!dspReady) {
        var failed = dspError.length > 0;
        var pl = fitText(failed ? "DSP failed: " + dspError : "DSP loading…", 70, 7.5);
        var pw = textW(pl, 7.5) + 10;
        fillRR(sx + 136, sy + 3, pw, 11, 5.5, failed ? RC.orange : RC.a_filt, 0.9);
        text(pl, sx + 136 + pw * 0.5, sy + 11.2, 7.5, RC.dark, true, 1);
    } else {
        for (var b = 0; b < 3; b++) line(sx + 138 + b * 2.5, sy + 5, sx + 138 + b * 2.5, sy + 11, liveActiveVoices > 0 ? acc : RC.dim, 0.9, 1.3);
        text(liveActiveVoices + "/" + curPolyVoices, sx + 148, sy + 11.5, 8.0, liveActiveVoices > 0 ? acc : RC.sub, false, 0);
    }
    fillRect(sx + 176, sy + 4, 22, 2.2, RC.track);
    fillRect(sx + 176, sy + 4, 22 * clamp01(livePeakL), 2.2, RC.green);
    fillRect(sx + 176, sy + 8, 22, 2.2, RC.track);
    fillRect(sx + 176, sy + 8, 22 * clamp01(livePeakR), 2.2, RC.green);
    for (var i = 0; i < 2; i++) {
        var bx = sx + sw - 52 + i * 25;
        var on = (curSliced ? 1 : 0) === i;
        fillRR(bx, sy + 2, 23, 12, 3, on ? acc : RC.raised, on ? 0.9 : 1);
        var cc = on ? RC.dark : RC.sub;
        if (i === 0) iconWave(bx + 5.5, sy + 4.5, cc, 1.0); else iconKnife(bx + 6, sy + 4.5, cc, 1.0);
        zone("button", bx, sy + 2, 23, 12, { action: "sliced_set", value: i });
    }

    // Waveform
    var wx = sx + 3, wy = sy + 15, ww = sw - 6, wh = 52;
    fillRR(wx, wy, ww, wh, 3, RC.wave);
    var loopOn = curLoopMode > 0;
    var loopZones = null;
    if (hasLoadedSample) {
        wavePolygon(wx, wy, ww, wh, 0, 1, mixc(RC.wave, acc, 0.28), 1.0);
        wavePolygon(wx, wy, ww, wh, curStart, curEnd, mixc(acc, [1, 1, 1], 0.25), 1.0);
    } else {
        line(wx + 4, wy + wh * 0.5, wx + ww - 4, wy + wh * 0.5, RC.dim, 1.0, 1.0);
    }

    if (loopOn && !curSliced) {
        var lsX = wx + curLoopStart * ww, leX = wx + curLoopEnd * ww;
        var xfW = curXfade * (leX - lsX);
        var LC = RC.green;
        for (var gi = 0; gi < 12 && xfW > 1; gi++) fillRect(lsX - xfW + xfW * gi / 12, wy, xfW / 12 + 0.5, wh, LC, 0.38 * (gi + 1) / 12);
        fillRect(lsX, wy, leX - lsX, wh, LC, 0.30);
        line(lsX, wy, lsX, wy + wh, LC, 0.95, 1.0);
        line(leX, wy, leX, wy + wh, LC, 0.95, 1.0);
        var midX = (lsX + leX) * 0.5;
        fillRect(lsX, wy + wh - 7, 7, 7, LC);
        fillRect(leX - 7, wy + wh - 7, 7, 7, LC);
        fillRect(midX - 3.5, wy + wh * 0.5 - 3.5, 7, 7, LC);
        loopZones = { xf: xfW > 4 ? [lsX - xfW, wy, xfW - 3, wh] : null, mv: [midX - 6, wy + wh * 0.5 - 6, 12, 12] };
    }

    if (curSliced) {
        var starts = currentSliceStarts();
        for (var mi = 0; mi < sliceMarkers.length; mi++) {
            var mk = sliceMarkers[mi];
            if (mk < curStart - 1e-6 || mk > curEnd + 1e-6) line(wx + mk * ww, wy + 8, wx + mk * ww, wy + wh, [1, 1, 1], 0.14, 1.0);
        }
        for (var si = 0; si < starts.length; si++) {
            var mxs = wx + starts[si] * ww;
            var nxt = wx + ((si + 1 < starts.length) ? starts[si + 1] : curEnd) * ww;
            if (si === selectedSliceIdx) fillRect(mxs, wy, nxt - mxs, wh, acc, 0.18);
            line(mxs, wy, mxs, wy + wh, RC.yellow, 0.85, 1.0);
            polygon([[mxs, wy], [mxs + 6, wy], [mxs, wy + 6]], RC.yellow);
            if (nxt - mxs > 22) text(midiToNoteName(curSliceFrom + si), mxs + 3, wy + 15, 7.0, RC.yellow, false, 0, 0.85);
        }
    }

    // Playheads and grains, clipped to the waveform
    for (var v = 0; v < 16 && hasLoadedSample; v++) {
        if ((voiceAmps[v] || 0) <= 0.02) continue;
        var phx = wx + clamp01(voicePlayheads[v]) * ww;
        if (curMode === 2 || curMode === 4) {
            var spread = Math.max(3, paramValue("grain_spray") * 0.01 * ww * 0.25);
            fillClipped(phx - spread, spread * 2, wx, ww, wy, wh, acc, 0.08 * voiceAmps[v] + 0.04);
        } else if (curMode === 1) {
            var cw = Math.max(3, Math.min(ww * 0.2, paramValue("grain_size") / Math.max(1, sampleDurationMs) * ww));
            fillClipped(phx, cw, wx, ww, wy, wh, acc, 0.14);
        }
        line(phx, wy, phx, wy + wh, [1, 1, 1], Math.min(1, 0.4 + voiceAmps[v]), 1.2);
    }
    if (hasLoadedSample && (curMode === 2 || curMode === 4)) {
        for (var g = 0; g < GRAIN_SLOTS; g++) {
            var gp = grainPos[g], ga = grainAmp[g];
            if (!(gp >= 0) || !(ga > 0.02)) continue;
            var gx = wx + clamp01(gp) * ww;
            line(gx, wy + 4, gx, wy + wh - 4, [0.85, 0.95, 1.0], Math.min(0.9, 0.2 + 0.7 * ga), 1.0);
        }
    }
    if (rootDyn && pitchCurve && hasLoadedSample) paintPitchCurve(wx, wy, ww, wh);
    if (!hasLoadedSample) text("Drop a sample here", wx + ww * 0.5, wy + wh * 0.5 - 7, 9.5, RC.sub, false, 1);

    var stX = wx + curStart * ww, enX = wx + curEnd * ww;
    if (curSliced) {
        line(enX, wy, enX, wy + wh, acc, 0.95, 1.0);
        fillRect(stX, wy + wh - 7, 7, 7, acc);
        fillRect(enX - 7, wy + wh - 7, 7, 7, acc);
    } else {
        line(stX, wy, stX, wy + wh, RC.yellow, 0.95, 1.0);
        line(enX, wy, enX, wy + wh, RC.yellow, 0.95, 1.0);
        fillRect(stX, wy, 6, 6, RC.yellow);
        fillRect(enX - 6, wy, 6, 6, RC.yellow);
    }
    zone("wave", wx, wy, ww, wh, {});
    if (loopOn && !curSliced && loopZones) {
        if (loopZones.xf) zone("xfade", loopZones.xf[0], loopZones.xf[1], loopZones.xf[2], loopZones.xf[3], {});
        zone("loop_move", loopZones.mv[0], loopZones.mv[1], loopZones.mv[2], loopZones.mv[3], {});
    }
    if (curSliced) {
        for (var fi = 0; fi < sliceMarkers.length; fi++) {
            var fm = sliceMarkers[fi];
            if (fm > curStart + 0.002 && fm < curEnd - 0.002) zone("flag", wx + fm * ww - 2, wy, 10, 9, { index: fi });
        }
    }

    // Footer
    var fy = sy + sh - 4;
    if (curSliced) {
        text("keys", sx + 6, fy, 7.5, RC.sub, false, 0);
        var kw = text(midiToNoteName(curSliceFrom), sx + 27, fy, 8.5, acc, false, 0);
        zone("value", sx + 25, fy - 10, kw + 4, 12, { key: "slice_from", pxPerUnit: 4 });
        var at = Math.round(paramValue("slice_at"));
        var ax = sx + 74;
        var nw = text(SLICE_AT_NAMES[at], ax, fy, 8.5, acc, false, 0);
        caret(ax + nw + 3, fy - 6, RC.sub);
        zone("button", ax - 3, fy - 10, nw + 14, 12, { action: "menu", key: "slice_at", mw: 224 });
        var vx = ax + nw + 18;
        if (at === 0) {
            var dw = text(String(Math.round(paramValue("slice_div"))), vx, fy, 8.5, acc, false, 0);
            zone("value", vx - 2, fy - 10, dw + 4, 12, { key: "slice_div", pxPerUnit: 3 });
        } else if (at === 1) {
            var bw = text(SLICE_BEAT_SHORT[Math.round(paramValue("slice_beat"))], vx, fy, 8.5, acc, false, 0);
            caret(vx + bw + 3, fy - 6, RC.sub);
            zone("button", vx - 2, fy - 10, bw + 14, 12, { action: "menu", key: "slice_beat", mw: 150 });
        } else if (at === 2 || at === 3) {
            var pw2 = text(Math.round(paramValue("slice_sens")) + "%", vx, fy, 8.5, acc, false, 0);
            zone("value", vx - 2, fy - 10, pw2 + 4, 12, { key: "slice_sens", norm: true });
            if (sliceMonoJob) text("analyzing…", vx + pw2 + 6, fy, 7.5, RC.sub, false, 0);
        } else {
            text("dbl-click: add / remove", vx, fy, 7.5, RC.sub, false, 0);
        }
        var sp = Math.round(paramValue("slice_play"));
        iconSlicePlay(sx + sw - 30, fy - 8, sp, acc);
        caret(sx + sw - 14, fy - 6, RC.sub);
        zone("button", sx + sw - 34, fy - 10, 32, 12, { action: "menu", key: "slice_play", mw: 128 });
        return;
    }
    iconReverse(sx + 7, fy - 9, curReverse);
    zone("button", sx + 4, fy - 11, 16, 14, { action: "reverse" });
    iconLoopMode(sx + 26, fy - 8, curLoopMode, loopOn ? RC.green : RC.sub);
    caret(sx + 41, fy - 6, RC.sub);
    zone("button", sx + 24, fy - 11, 26, 14, { action: "menu", key: "loop_mode", mw: 128 });
    iconSnow(sx + 62, fy - 4, curFreeze ? acc : RC.sub, 1.0);
    zone("button", sx + 54, fy - 11, 16, 14, { action: "freeze" });
    // ROOT: icon toggles Analyzed Root Key (Dynamic), the note and fine cents are draggable otherwise
    var rx = sx + 78;
    var rcl = rootDyn ? acc : RC.sub;
    strokeArc(rx + 4, fy - 4, 3.4, 0, Math.PI * 2, rcl, 1.0, 1.2);
    line(rx + 1.5, fy - 4, rx + 6.5, fy - 4, rcl, 1.0, 1.0);
    text("ROOT", rx + 10, fy, 7.5, rcl, true, 0);
    zone("button", rx - 2, fy - 11, 38, 14, { action: "toggle", key: "root_dyn" });
    if (rootDyn) {
        text(pitchCurve ? "Dynamic" : "Dynamic…", rx + 40, fy, 8.5, acc, false, 0);
    } else {
        var noteW = text(midiToNoteName(curRootNote), rx + 40, fy, 8.5, acc, false, 0);
        zone("value", rx + 38, fy - 10, noteW + 4, 12, { key: "root_note", pxPerUnit: 4 });
        var fine = Math.round(paramValue("fine_cents"));
        var fW = text(fine + "ct", rx + 62, fy, 8.5, acc, false, 0);
        zone("value", rx + 60, fy - 10, fW + 4, 12, { key: "fine_cents", pxPerUnit: 1 });
    }
    if (hasLoadedSample && sampleDurationMs > 0) text(fmtTime(Math.max(0, curEnd - curStart) * sampleDurationMs), sx + sw - 6, fy, 7.5, RC.sub, false, 2);
}

// ---------------------------------------------------------------------------
// Envelope curve with A / D / S / R handles
// ---------------------------------------------------------------------------

var EP = { x: 268, y: 22, w: 142, h: 82 };

function envKeys() {
    return envPage === 1 ? ["matk_ms", "mdec_ms", "msus_lvl", "mrel_ms"] : ["atk_ms", "dec_ms", "sus_lvl", "rel_ms"];
}

function envGeom() {
    var k = envKeys();
    var gx = EP.x + 7, gw = EP.w - 24, gy = EP.y + 7, gb = EP.y + 59;
    var hold = gw * 0.16;
    var segMax = (gw - hold - 4) / 3;
    var an = toNorm(k[0], paramValue(k[0])), dn = toNorm(k[1], paramValue(k[1])), rn = toNorm(k[3], paramValue(k[3]));
    var sus = clamp01(paramValue(k[2]) * 0.01);
    var xA = gx + an * segMax, xD = xA + dn * segMax, xS = xD + hold, xR = xS + rn * segMax;
    return { keys: k, gx: gx, gw: gw, gy: gy, gb: gb, hold: hold, segMax: segMax,
        xA: xA, xD: xD, xS: xS, xR: xR, ys: gb - sus * (gb - gy), an: an, dn: dn, rn: rn };
}

function envCurveY(g, kind, t) {
    // exponential-looking decay / release between two levels
    return Math.pow(1 - t, 2.2);
}

function paintEnvPanel2() {
    var acc = envPage === 1 ? RC.a_mod : RC.a_amp;
    panelBox(EP.x, EP.y, EP.w, EP.h);
    var g = envGeom();
    // grid
    for (var i = 1; i < 4; i++) line(g.gx, g.gy + (g.gb - g.gy) * i / 4, g.gx + g.gw, g.gy + (g.gb - g.gy) * i / 4, RC.line, 0.6, 0.8);
    line(g.gx, g.gb, g.gx + g.gw, g.gb, RC.line, 1.0, 1.0);

    // curve
    var pts = [[g.gx, g.gb], [g.xA, g.gy]];
    var n = 14, j;
    for (j = 1; j <= n; j++) { var td = j / n; pts.push([g.xA + (g.xD - g.xA) * td, g.ys + (g.gy - g.ys) * envCurveY(g, 0, td)]); }
    pts.push([g.xS, g.ys]);
    for (j = 1; j <= n; j++) { var tr = j / n; pts.push([g.xS + (g.xR - g.xS) * tr, g.gb + (g.ys - g.gb) * envCurveY(g, 1, tr)]); }
    var fillPts = pts.concat([[g.xR, g.gb]]);
    polygon(fillPts, acc, 0.16);
    setc(acc, 1.0);
    mgraphics.set_line_width(1.7);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (j = 1; j < pts.length; j++) mgraphics.line_to(pts[j][0], pts[j][1]);
    mgraphics.stroke();

    // live level bar (max voice amp for AMP, Mod envelope for MOD)
    var lvl = 0;
    if (envPage === 1) lvl = clamp01(liveModEnvVal);
    else for (var v = 0; v < 16; v++) if (voiceAmps[v] > lvl) lvl = voiceAmps[v];
    lvl = clamp01(lvl);
    var bx = g.gx + g.gw + 6;
    fillRR(bx, g.gy, 4, g.gb - g.gy, 2, RC.track);
    if (lvl > 0.004) fillRR(bx, g.gb - lvl * (g.gb - g.gy), 4, lvl * (g.gb - g.gy), 2, acc, 0.95);
    if (lvl > 0.004) line(g.gx, g.gb - lvl * (g.gb - g.gy), g.gx + g.gw, g.gb - lvl * (g.gb - g.gy), acc, 0.28, 1.0);

    // handles
    var hs = [
        { id: "A", x: g.xA, y: g.gy },
        { id: "D", x: g.xD, y: g.ys },
        { id: "S", x: g.xD + g.hold * 0.5, y: g.ys },
        { id: "R", x: g.xR, y: g.gb }
    ];
    for (var h = 0; h < hs.length; h++) {
        var hv = hoverHdl === "env:" + hs[h].id || (drag && drag.hdl === "env:" + hs[h].id);
        circle(hs[h].x, hs[h].y, hv ? 5.2 : 3.8, RC.panel);
        circle(hs[h].x, hs[h].y, hv ? 4.0 : 2.8, hs[h].id === "S" ? RC.text : acc);
        zone("hdl", hs[h].x - 6, hs[h].y - 6, 12, 12, { id: "env:" + hs[h].id, cx: hs[h].x, cy: hs[h].y });
    }

    // values
    var k = g.keys;
    var cells = [["A", fmtMsShort(paramValue(k[0]))], ["D", fmtMsShort(paramValue(k[1]))],
        ["S", Math.round(paramValue(k[2])) + "%"], ["R", fmtMsShort(paramValue(k[3]))]];
    var cw = (EP.w - 8) / 4;
    for (var c = 0; c < 4; c++) {
        var act = hoverHdl === "env:" + cells[c][0] || (drag && drag.hdl === "env:" + cells[c][0]);
        text(cells[c][0], EP.x + 6 + c * cw, EP.y + EP.h - 6, 7.0, acc, true, 0, 0.9);
        text(cells[c][1], EP.x + 13 + c * cw, EP.y + EP.h - 6, 7.5, act ? RC.text : RC.sub, act, 0);
    }
    // pitch / position routing of the Mod envelope
    if (envPage === 1) {
        var mp = Math.round(paramValue("menv_pitch")), mq = Math.round(paramValue("menv_pos")), fe = Math.round(paramValue("filt_env_amt"));
        text("→ P " + mp + "  Pos " + mq + "  F " + fe, EP.x + 7, EP.y + 70, 7.0, RC.sub, false, 0);
    } else {
        text("Amp  ·  velocity " + Math.round(paramValue("vel_sens")) + "%", EP.x + 7, EP.y + 70, 7.0, RC.sub, false, 0);
    }
}

function fmtMsShort(ms) {
    if (ms < 10) return ms.toFixed(1) + "ms";
    if (ms < 1000) return Math.round(ms) + "ms";
    return (ms / 1000).toFixed(1) + "s";
}

// ---------------------------------------------------------------------------
// Filter response curve with a cutoff / resonance point
// ---------------------------------------------------------------------------

var FP = { x: 414, y: 22, w: 142, h: 82 };
var F_DB_LO = -36, F_DB_HI = 24;

function filterGeom() {
    var gx = FP.x + 7, gw = FP.w - 14, gy = FP.y + 5, gb = FP.y + 62;
    return { gx: gx, gw: gw, gy: gy, gb: gb };
}
function fFx(g, hz) { return g.gx + (Math.log(Math.max(20, hz) / 20) / Math.log(1000)) * g.gw; }
function fHz(g, x) { return 20 * Math.pow(1000, clamp01((x - g.gx) / g.gw)); }
function fFy(g, db) { return g.gb - (Math.max(F_DB_LO, Math.min(F_DB_HI, db)) - F_DB_LO) / (F_DB_HI - F_DB_LO) * (g.gb - g.gy); }
function resToQ(res) { return 0.7 + res * 0.08; }
function qToRes(q) { return Math.max(0, Math.min(100, (q - 0.7) / 0.08)); }

// 2-pole magnitude in dB: LP, BP and HP all peak at Q (in linear gain) at the cutoff
function filterDb(type, w, q) {
    var den = Math.sqrt((1 - w * w) * (1 - w * w) + (w / q) * (w / q));
    var h = type === 0 ? 1 / den : (type === 1 ? w / den : w * w / den);
    return 20 * Math.log(Math.max(1e-5, h)) / Math.LN10;
}

function paintFilterPanel2() {
    var acc = RC.a_filt;
    panelBox(FP.x, FP.y, FP.w, FP.h);
    var g = filterGeom();
    var on = curFiltOn;
    var al = on ? 1.0 : 0.4;
    var fc = paramValue("filt_cutoff"), res = paramValue("filt_res"), ft = Math.round(paramValue("filt_type"));
    var q = resToQ(res);

    // grid: decades and 0 dB
    var dec = [100, 1000, 10000];
    for (var d = 0; d < dec.length; d++) line(fFx(g, dec[d]), g.gy, fFx(g, dec[d]), g.gb, RC.line, 0.7, 0.8);
    line(g.gx, fFy(g, 0), g.gx + g.gw, fFy(g, 0), RC.line, 0.9, 0.8);
    line(g.gx, g.gb, g.gx + g.gw, g.gb, RC.line, 1.0, 1.0);

    // modulation reach around the cutoff (LFO + Mod env)
    var ext = 3.5 * Math.abs(paramValue("lfo_filt")) * 0.01 + 5 * Math.abs(paramValue("filt_env_amt")) * 0.01;
    if (ext > 0.02 && on) {
        var x0 = fFx(g, Math.max(20, fc * Math.pow(2, -ext))), x1 = fFx(g, Math.min(20000, fc * Math.pow(2, ext)));
        fillRect(x0, g.gy, Math.max(1, x1 - x0), g.gb - g.gy, RC.a_mod, 0.10);
    }

    // response
    var cols = 56;
    var top = [], bot = [];
    for (var i = 0; i <= cols; i++) {
        var hz = 20 * Math.pow(1000, i / cols);
        var db = filterDb(ft, hz / fc, q);
        var px = g.gx + g.gw * i / cols;
        top.push([px, fFy(g, db)]);
    }
    var poly = top.concat([[g.gx + g.gw, g.gb], [g.gx, g.gb]]);
    polygon(poly, acc, on ? 0.17 : 0.07);
    setc(acc, al);
    mgraphics.set_line_width(1.7);
    mgraphics.move_to(top[0][0], top[0][1]);
    for (var j = 1; j < top.length; j++) mgraphics.line_to(top[j][0], top[j][1]);
    mgraphics.stroke();

    // live (modulated) cutoff
    if (on && Math.abs(Math.log(liveEffCutHz / fc)) > 0.03) {
        var lx = fFx(g, liveEffCutHz);
        line(lx, g.gy, lx, g.gb, RC.a_mod, 0.9, 1.3);
        circle(lx, fFy(g, filterDb(ft, liveEffCutHz / fc, q) * 0 + filterDb(ft, 1, q)), 2.2, [1, 1, 1], 0.9);
    }

    // the point
    var hx = fFx(g, fc), hy = fFy(g, filterDb(ft, 1, q));
    var hv = hoverHdl === "filt" || (drag && drag.hdl === "filt");
    circle(hx, hy, hv ? 6.0 : 4.6, RC.panel);
    circle(hx, hy, hv ? 4.6 : 3.4, acc, al);
    zone("hdl", hx - 7, hy - 7, 14, 14, { id: "filt", cx: hx, cy: hy });

    // readouts
    var hot = hv || hoverKey === "filt_cutoff";
    text("Cut", FP.x + 7, FP.y + FP.h - 6, 7.0, acc, true, 0, 0.9);
    text(fmtParam("filt_cutoff", fc), FP.x + 21, FP.y + FP.h - 6, 7.5, hot ? RC.text : RC.sub, hot, 0);
    text("Res", FP.x + 62, FP.y + FP.h - 6, 7.0, acc, true, 0, 0.9);
    text(Math.round(res) + "%", FP.x + 76, FP.y + FP.h - 6, 7.5, hot ? RC.text : RC.sub, hot, 0);
    var fe = Math.round(paramValue("filt_env_amt"));
    text("Env " + (fe > 0 ? "+" : "") + fe, FP.x + FP.w - 7, FP.y + FP.h - 6, 7.0, RC.sub, false, 2);
    text("20", g.gx + 1, g.gb - 2.5, 6.0, RC.dim, false, 0);
    text("1k", fFx(g, 1000) + 2, g.gb - 2.5, 6.0, RC.dim, false, 0);
    text("20k", g.gx + g.gw - 1, g.gb - 2.5, 6.0, RC.dim, false, 2);
}

// ---------------------------------------------------------------------------
// Engine strip
// ---------------------------------------------------------------------------

var SP = { x: 4, y: 108, w: 260, h: 58 };

function engineLayout() {
    // returns { head: {key, labels} | null, knobs: [{key,label,opts} | {menu:true}] }
    var ch;
    if (curMode === 0) {
        ch = Math.round(paramValue("rp_char"));
        var labs = ch === 1 ? ["Crunch", "Tape"] : (ch === 2 ? ["Bits", "Color"] : ["Dist", "Color"]);
        return { head: { key: "rp_char", labels: ["Clean", "Analog", "Digital"] },
            knobs: [{ key: "rp_dist", label: labs[0], opts: { dim: ch === 0 } }, { key: "rp_color", label: labs[1], opts: { dim: ch === 0 } }] };
    }
    if (curMode === 3) {
        ch = Math.round(paramValue("sp_char"));
        if (ch === 0) return { head: { key: "sp_char", labels: ["Pure", "Reharm"] },
            knobs: [{ key: "formant", label: "Formant" }, { key: "sp_shift", label: "Shift" }] };
        var q = Math.round(paramValue("sp_quant"));
        return { head: { key: "sp_char", labels: ["Pure", "Reharm"] },
            knobs: [{ key: "sp_bend", label: "Bend" }, { menu: true }, { key: "sp_quant_amt", label: "Amt", opts: { dim: q === 0 } }] };
    }
    if (curMode === 1) {
        ch = Math.round(paramValue("cy_char"));
        var head = { key: "cy_char", labels: ["Pulse", "Partials", "Phase"] };
        if (ch === 0) return { head: head, knobs: [{ key: "formant", label: "Formant" }, { key: "cy_width", label: "Width" }] };
        if (ch === 1) return { head: head, knobs: [{ key: "formant", label: "Formant" }, { key: "cy_split", label: "Split" }, { key: "cy_fund", label: "Fund." }] };
        return { head: head, knobs: [{ key: "formant", label: "Formant" }, { key: "cy_mod", label: "Mod" }, { key: "cy_harm", label: "Harm." }] };
    }
    if (curMode === 2) return { head: null, title: "Granular cloud", knobs: [{ key: "grain_size", label: "Size" }, { key: "grain_spray", label: "Spray" }] };
    return { head: null, title: "Grain pool", knobs: [{ key: "grain_size", label: "Size" },
        { key: "fr_density", label: "Density", opts: { dim: Math.round(paramValue("fr_use_density")) === 0 } },
        { key: "fr_motion", label: "Motion" }] };
}

function paintEngineStrip() {
    var x = SP.x, y = SP.y, w = SP.w;
    panelBox(x, y, w, SP.h);
    var L = engineLayout();
    var acc = RC.a_eng;
    if (L.head) {
        segCtl(L.head.key, x + 5, y + 4, L.head.labels.length * 34, 12, L.head.labels, acc);
    } else {
        text(L.title, x + 7, y + 13, 8.5, acc, false, 0);
    }
    if (L.head) text(MODE_NAMES[curMode].toUpperCase(), x + w - 6, y + 12.5, 7.0, RC.dim, true, 2);

    var ky = y + 33;
    var zw = 120;
    var n = L.knobs.length;
    for (var i = 0; i < n; i++) {
        var cx = x + 6 + zw * (i + 0.5) / n;
        var k = L.knobs[i];
        if (k.menu) {
            var q = Math.round(paramValue("sp_quant"));
            fillRR(cx - 15, ky - 8, 30, 15, 3, RC.raised);
            text(["Off", "Oct", "Key"][q], cx - 4, ky + 3, 8.0, RC.text, false, 1);
            caret(cx + 7, ky - 2, RC.sub);
            zone("button", cx - 15, ky - 8, 30, 15, { action: "menu", key: "sp_quant", mw: 80 });
            text("Quant", cx, ky + 22, 8.0, RC.sub, false, 1);
        } else {
            rKnob(k.key, cx, ky, 9, k.label, acc, k.opts || {});
        }
    }
    line(x + 6 + zw + 4, y + 20, x + 6 + zw + 4, y + SP.h - 6, RC.line, 1.0, 1.0);
    var px = x + 6 + zw + 8, pw = w - (px - x) - 6;
    var scanOn = curMode !== 0;
    var ks = [["pitch_st", "Pitch", RC.a_wave, {}], ["grain_motion", "Speed", RC.a_wave, { dim: !scanOn }], ["play_pos", "Pos", RC.a_wave, { dim: !curFreeze }]];
    for (var p = 0; p < 3; p++) rKnob(ks[p][0], px + pw * (p + 0.5) / 3, ky, 9, ks[p][1], ks[p][2], ks[p][3]);
}

// ---------------------------------------------------------------------------
// LFO scope and Out
// ---------------------------------------------------------------------------

var LP = { x: 268, y: 108, w: 170, h: 58 };

function lfoGlyph(shape, x, y, w, h, c, a) {
    setc(c, a);
    mgraphics.set_line_width(1.3);
    var n = 16;
    for (var i = 0; i <= n; i++) {
        var p = i / n;
        var v = shape === 3 ? [0.7, -0.4, 0.2, -0.8][Math.min(3, Math.floor(p * 4))] : lfoShapeAt(shape, p);
        var px = x + p * w, py = y + h * 0.5 - v * h * 0.45;
        if (i === 0) mgraphics.move_to(px, py); else mgraphics.line_to(px, py);
    }
    mgraphics.stroke();
}

function paintLfoPanel() {
    var x = LP.x, y = LP.y;
    var acc = RC.a_lfo;
    panelBox(x, y, LP.w, LP.h);
    secTitle("LFO", x + 7, y + 11, acc);
    var shp = Math.round(paramValue("lfo_shape"));
    for (var s = 0; s < 4; s++) {
        var gx = x + 30 + s * 17;
        var on = shp === s;
        fillRR(gx, y + 3, 15, 11, 3, on ? acc : RC.raised, on ? 0.9 : 1);
        lfoGlyph(s, gx + 2.5, y + 4.5, 10, 8, on ? RC.dark : RC.sub, 1.0);
        zone("button", gx, y + 3, 15, 11, { action: "menu_pick", key: "lfo_shape", value: s });
    }
    // scope
    var sx = x + 6, sy = y + 18, sw = 98, sh = 34;
    fillRR(sx, sy, sw, sh, 3, RC.wave);
    var cy = sy + sh * 0.5;
    line(sx + 2, cy, sx + sw - 2, cy, RC.line, 1.0, 1.0);
    var dest = Math.abs(paramValue("lfo_pitch")) + Math.abs(paramValue("lfo_filt")) + Math.abs(paramValue("lfo_pos"));
    var al = dest > 0.5 ? 1.0 : 0.55;
    var amp = sh * 0.4;
    if (shp < 3) {
        setc(acc, 0.5 * al);
        mgraphics.set_line_width(1.3);
        for (var i = 0; i <= 40; i++) {
            var p = i / 40;
            var px = sx + 4 + p * (sw - 8), py = cy - lfoShapeAt(shp, p) * amp;
            if (i === 0) mgraphics.move_to(px, py); else mgraphics.line_to(px, py);
        }
        mgraphics.stroke();
        var dx = sx + 4 + lfoPhaseEst * (sw - 8), dy = cy - clamp01((liveLfoVal + 1) * 0.5) * 2 * amp + amp;
        line(dx, sy + 3, dx, sy + sh - 3, acc, 0.3, 1.0);
        circle(dx, dy, 4.2, acc, 0.28);
        circle(dx, dy, 2.6, acc, 1.0);
    } else {
        setc(acc, 0.9 * al);
        mgraphics.set_line_width(1.4);
        var m = lfoHist.length;
        var prevY = 0;
        for (var h = 0; h < m; h++) {
            var hx = sx + 4 + (h / 39) * (sw - 8), hy = cy - lfoHist[h] * amp;
            if (h === 0) mgraphics.move_to(hx, hy); else { mgraphics.line_to(hx, prevY); mgraphics.line_to(hx, hy); }
            prevY = hy;
        }
        mgraphics.stroke();
        if (m > 0) circle(sx + 4 + ((m - 1) / 39) * (sw - 8), cy - lfoHist[m - 1] * amp, 2.6, acc, 1.0);
    }
    text(fmtParam("lfo_rate", paramValue("lfo_rate")), sx + sw - 4, sy + 9, 7.0, RC.sub, false, 2);
    rKnob("lfo_rate", x + 138, y + 30, 9, "Rate", acc, {});
}

var OP = { x: 442, y: 108, w: 114, h: 58 };

function paintOutPanel() {
    var x = OP.x, y = OP.y;
    panelBox(x, y, OP.w, OP.h);
    secTitle("OUT", x + 7, y + 11, RC.a_out);
    rKnob("out_gain", x + 30, y + 31, 11, "Out", RC.a_out, { labelY: y + 54 });
    // meters
    var mh = 40, my = y + 15;
    var L = [livePeakL, livePeakR];
    for (var i = 0; i < 2; i++) {
        var mx = x + 60 + i * 7;
        fillRR(mx, my, 5, mh, 2, RC.track);
        var hh = clamp01(L[i]) * mh;
        if (hh > 0.5) fillRR(mx, my + mh - hh, 5, hh, 2, L[i] > 0.9 ? RC.orange : RC.green, 0.95);
    }
    rKnob("vel_sens", x + 94, y + 31, 6, "Vel", RC.a_out, { labelY: y + 54 });
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

var DR = { y0: 28, pitch: 13.6 };

function dlabel(label, x, y, c) { text(label, x, y + 8.5, 8.0, c || RC.sub, false, 0); }

function paintDrawer() {
    var X = RW0, w = RDRAWER - 4;
    panelBox(X, 3, w, 163);
    var tabs = ["ENGINE", "MOD", "VOICE", "SAMPLE"];
    var tw = [50, 38, 42, 52];
    var tx = X + 6;
    for (var t = 0; t < 4; t++) {
        var on = drawerTab === t;
        fillRR(tx, 7, tw[t], 14, 7, on ? RC.a_eng : RC.raised, on ? 0.95 : 1);
        text(tabs[t], tx + tw[t] * 0.5, 17, 7.5, on ? RC.dark : RC.sub, on, 1);
        (function (idx) { actZone(tx, 7, tw[t], 14, function () { drawerTab = idx; }); })(t);
        tx += tw[t] + 3;
    }
    var x0 = X + 9, x1 = X + w - 9;
    if (drawerTab === 0) drawerEngine(x0, x1);
    else if (drawerTab === 1) drawerMod(x0, x1);
    else if (drawerTab === 2) drawerVoice(x0, x1);
    else drawerSample(x0, x1);
}

function drawerEngine(x0, x1) {
    var y = DR.y0, p = DR.pitch;
    var acc = RC.a_eng;
    secTitle(MODE_NAMES[curMode].toUpperCase() + " SETTINGS", x0, y + 6, acc);
    y += 12;
    var W = x1 - x0;
    var ch, rows;
    if (curMode === 0) {
        ch = Math.round(paramValue("rp_char"));
        dlabel("Character", x0, y); segCtl("rp_char", x1 - 108, y - 1, 108, 12, ["Clean", "Analog", "Digital"], acc); y += p + 2;
        dlabel("Imaging", x0, y, ch === 2 ? RC.sub : RC.dim); switchCtl("rp_imaging", x1 - 20, y, acc, ch !== 2); y += p;
        dlabel("Variable sample rate", x0, y, ch === 2 ? RC.sub : RC.dim); switchCtl("rp_vsr", x1 - 20, y, acc, ch !== 2); y += p + 4;
        dlabel(ch === 1 ? "Crunch / Tape on the front" : (ch === 2 ? "Bits / Color on the front" : "Clean: no character"), x0, y, RC.dim);
        y += p + 6;
        text("Imaging and VSR belong to the Digital character.", x0, y + 8, 7.0, RC.dim, false, 0);
    } else if (curMode === 3) {
        ch = Math.round(paramValue("sp_char"));
        var q = Math.round(paramValue("sp_quant"));
        dlabel("Character", x0, y); segCtl("sp_char", x1 - 80, y - 1, 80, 12, ["Pure", "Reharm"], acc); y += p;
        dlabel("Quantize", x0, y, ch === 1 ? RC.sub : RC.dim); segCtl("sp_quant", x1 - 108, y - 1, 108, 12, ["Off", "Octaves", "Key"], acc, ch !== 1); y += p;
        dlabel("Onsets", x0, y); switchCtl("sp_onsets", x1 - 20, y, acc); y += p;
        dlabel("Formant correction", x0, y); switchCtl("sp_formant_on", x1 - 20, y, acc); y += p;
        dlabel("Phase dispersion", x0, y);
        valuePill(x1 - 56, y - 1, 56, fmtParam("sp_dispersion", paramValue("sp_dispersion")), { key: "sp_dispersion", norm: true }, acc); y += p;
        dlabel("Quality / cost", x0, y); segCtl("sp_quality", x1 - 108, y - 1, 108, 12, ["Low", "Medium", "High"], acc); y += p;
        dlabel("Live performance", x0, y); switchCtl("sp_live", x1 - 20, y, acc); y += p;
        dlabel("Relative formants", x0, y); switchCtl("sp_rel_formant", x1 - 20, y, acc); y += p;
        dlabel("Key / scale", x0, y); menuPill("sp_key", x1 - 112, y - 1, 40, fmtParam("sp_key", paramValue("sp_key")), acc, 52);
        segCtl("sp_scale", x1 - 66, y - 1, 66, 12, ["Major", "Minor"], acc);
    } else if (curMode === 1) {
        dlabel("Character", x0, y); segCtl("cy_char", x1 - 108, y - 1, 108, 12, ["Pulse", "Partials", "Phase"], acc); y += p + 2;
        dlabel("Cycle crossfade", x0, y); switchCtl("cy_xfade", x1 - 20, y, acc); y += p + 6;
        text("Formant and the character controls sit on the", x0, y + 8, 7.0, RC.dim, false, 0); y += 10;
        text("front strip. Speed keeps the sample's timing:", x0, y + 8, 7.0, RC.dim, false, 0); y += 10;
        text("pitch follows the key, time follows Speed.", x0, y + 8, 7.0, RC.dim, false, 0);
    } else if (curMode === 2) {
        text("Size and Spray are on the front strip.", x0, y + 8, 7.5, RC.sub, false, 0); y += 14;
        text("Speed scans the cloud; Freeze + Pos hold it.", x0, y + 8, 7.5, RC.dim, false, 0);
    } else {
        dlabel("Direction", x0, y);
        segCtl("fr_direction", x1 - 150, y - 1, 150, 12, ["Sample", "Playhead", "Random", "Alt."], acc); y += p + 1;
        dlabel("Repeats", x0, y);
        valuePill(x1 - 40, y - 1, 40, String(Math.round(paramValue("fr_repeats"))), { key: "fr_repeats", pxPerUnit: 6 }, acc); y += p;
        dlabel("Grain envelope", x0, y);
        valuePill(x1 - 56, y - 1, 56, Math.round(paramValue("fr_env")) + "%", { key: "fr_env", norm: true }, acc); y += p;
        dlabel("Max grains / voice", x0, y);
        valuePill(x1 - 40, y - 1, 40, String(Math.round(paramValue("fr_max_grains"))), { key: "fr_max_grains", pxPerUnit: 1 }, acc); y += p;
        dlabel("Sync to tempo", x0, y); switchCtl("fr_sync", x1 - 20, y, acc); y += p;
        dlabel("Use density", x0, y); switchCtl("fr_use_density", x1 - 20, y, acc); y += p;
        dlabel("Latch initial rate", x0, y); switchCtl("fr_latch", x1 - 20, y, acc); y += p;
        dlabel("Repeat at initial pos", x0, y); switchCtl("fr_repeat_init", x1 - 20, y, acc); y += p;
        dlabel("Grains survive end", x0, y); switchCtl("fr_survive", x1 - 20, y, acc);
    }
}

function drawerMod(x0, x1) {
    var y = DR.y0;
    var W = x1 - x0;
    secTitle("LFO  →  DESTINATIONS", x0, y + 6, RC.a_lfo);
    var shp = Math.round(paramValue("lfo_shape"));
    segCtl("lfo_shape", x0, y + 11, W, 12, ["Sine", "Triangle", "Saw", "S&H"], RC.a_lfo);
    var ky = y + 45;
    var dd = [["lfo_pitch", "Pitch"], ["lfo_filt", "Filter"], ["lfo_pos", "Pos"]];
    for (var i = 0; i < 3; i++) rKnob(dd[i][0], x0 + W * (i + 0.5) / 3, ky, 9, dd[i][1], RC.a_lfo, { live: { val: liveLfoVal, acc: RC.a_lfo } });
    line(x0, y + 71, x1, y + 71, RC.line, 1.0, 1.0);
    secTitle("MOD ENVELOPE  →  DESTINATIONS", x0, y + 83, RC.a_mod);
    var md = [["menv_pitch", "Pitch"], ["filt_env_amt", "Filter"], ["menv_pos", "Pos"]];
    for (var j = 0; j < 3; j++) rKnob(md[j][0], x0 + W * (j + 0.5) / 3, y + 108, 9, md[j][1], RC.a_mod, { live: { val: clamp01(liveModEnvVal) * 2 - 1, acc: RC.a_mod } });
}

function drawerVoice(x0, x1) {
    var y = DR.y0;
    var W = x1 - x0;
    var acc = RC.a_out;
    secTitle("VOICING", x0, y + 6, acc);
    segCtl("mono_legato", x0, y + 11, W, 13, ["Poly", "Mono / Legato"], acc);
    var ks1 = [["poly_voices", "Poly"], ["unison_voices", "Unison"], ["unison_detune", "Detune"]];
    for (var i = 0; i < 3; i++) rKnob(ks1[i][0], x0 + W * (i + 0.5) / 3, y + 52, 9, ks1[i][1], acc, {});
    var ks2 = [["unison_width", "Width"], ["glide_ms", "Glide"], ["vel_sens", "Velocity"]];
    for (var j = 0; j < 3; j++) rKnob(ks2[j][0], x0 + W * (j + 0.5) / 3, y + 100, 9, ks2[j][1], acc, {});
    text("Spectral plays voices 0..3 only.", x0, y + 138, 7.0, RC.dim, false, 0);
}

function drawerSample(x0, x1) {
    var y = DR.y0 + 1, p = 13.6;
    var acc = RC.a_wave;
    dlabel("Root", x0, y); switchCtl("root_dyn", x0 + 28, y, acc); dlabel("Analyze", x0 + 52, y, rootDyn ? acc : RC.sub);
    valuePill(x1 - 94, y - 1, 48, rootDyn ? "Dynamic" : midiToNoteName(curRootNote), { key: "root_note", pxPerUnit: 4 }, acc, rootDyn);
    valuePill(x1 - 44, y - 1, 44, Math.round(paramValue("fine_cents")) + " ct", { key: "fine_cents", pxPerUnit: 1 }, acc, rootDyn); y += p + 3;
    secTitle("PLAY", x0, y + 6, acc); y += 10;
    dlabel("Reverse", x0, y); switchCtl("reverse", x0 + 38, y, acc);
    dlabel("Freeze", x0 + 68, y); switchCtl("freeze", x0 + 100, y, acc);
    dlabel("Pos", x1 - 72, y); valuePill(x1 - 44, y - 1, 44, Math.round(paramValue("play_pos")) + "%", { key: "play_pos", norm: true }, acc, !curFreeze); y += p;
    dlabel("Start", x0, y); valuePill(x0 + 28, y - 1, 62, fmtPos(curStart), { region: "samp_start" }, RC.yellow);
    dlabel("End", x0 + 100, y); valuePill(x1 - 62, y - 1, 62, fmtPos(curEnd), { region: "samp_end" }, RC.yellow); y += p;
    var lc = curLoopMode > 0 ? RC.green : RC.dim;
    dlabel("Loop", x0, y); menuPill("loop_mode", x0 + 28, y - 1, 62, fmtParam("loop_mode", paramValue("loop_mode")), lc, 128);
    dlabel("Xfade", x0 + 100, y); valuePill(x1 - 62, y - 1, 62, (curXfade / 0.45 * 100).toFixed(1) + "%", { region: "loop_xfade" }, lc, curLoopMode === 0); y += p;
    dlabel("L start", x0, y); valuePill(x0 + 38, y - 1, 52, fmtPos(curLoopStart), { region: "loop_start" }, lc, curLoopMode === 0);
    dlabel("L end", x0 + 100, y); valuePill(x1 - 52, y - 1, 52, fmtPos(curLoopEnd), { region: "loop_end" }, lc, curLoopMode === 0); y += p + 3;
    secTitle("SLICING", x0, y + 6, acc); y += 10;
    dlabel("Mode", x0, y); segCtl("sliced", x1 - 96, y - 1, 96, 12, ["Single", "Sliced"], acc); y += p;
    var at = Math.round(paramValue("slice_at"));
    dlabel("Slice at", x0, y); menuPill("slice_at", x0 + 38, y - 1, 62, SLICE_AT_NAMES[at], acc, 224);
    if (at === 0) valuePill(x1 - 46, y - 1, 46, String(Math.round(paramValue("slice_div"))), { key: "slice_div", pxPerUnit: 3 }, acc);
    else if (at === 1) menuPill("slice_beat", x1 - 46, y - 1, 46, SLICE_BEAT_SHORT[Math.round(paramValue("slice_beat"))], acc, 150);
    else if (at === 2 || at === 3) valuePill(x1 - 46, y - 1, 46, Math.round(paramValue("slice_sens")) + "%", { key: "slice_sens", norm: true }, acc);
    else text("manual", x1, y + 8.5, 7.5, RC.dim, false, 2);
    y += p;
    dlabel("Keys", x0, y); valuePill(x0 + 28, y - 1, 40, midiToNoteName(curSliceFrom), { key: "slice_from", pxPerUnit: 4 }, acc);
    dlabel("Play", x0 + 88, y); menuPill("slice_play", x1 - 66, y - 1, 66, ["to end", "sample", "loop", "ping"][Math.round(paramValue("slice_play"))], acc, 128);
}

// ---------------------------------------------------------------------------
// paint
// ---------------------------------------------------------------------------

function paint() {
    initTheme();
    var sz = mgraphics.size;
    hitZones = [];
    fillRect(0, 0, sz[0], sz[1], RC.bg);
    paintHeaderRow();
    paintWavePanel();
    paintEnvPanel2();
    paintFilterPanel2();
    paintEngineStrip();
    paintLfoPanel();
    paintOutPanel();
    if (showInspector) paintDrawer();
    paintMenu();
}

// ---------------------------------------------------------------------------
// Mouse: graph handles and callbacks, everything else falls back to the shared handlers
// ---------------------------------------------------------------------------

var sharedOnclick = onclick;
var sharedOndrag = ondrag;
var sharedOndblclick = ondblclick;
var sharedOnidle = onidle;
var sharedOnidleout = onidleout;

function setIfChanged(key, v) {
    var p = paramSpec(key);
    v = Math.max(p.lo, Math.min(p.hi, v));
    if (p.enums || p.unit === 0) v = Math.round(v);
    if (Math.abs(v - paramValue(key)) > 1e-9) setParamFromFace(key, v);
}

function hdlMove(id, x, y) {
    var gx = x + drag.ox, gy = y + drag.oy;
    if (id === "filt") {
        var g = filterGeom();
        setIfChanged("filt_cutoff", fHz(g, gx));
        var db = F_DB_LO + (g.gb - gy) / (g.gb - g.gy) * (F_DB_HI - F_DB_LO);
        setIfChanged("filt_res", qToRes(Math.pow(10, db / 20)));
        return;
    }
    var e = envGeom(), k = e.keys;
    var which = id.substring(4);
    if (which === "A") setIfChanged(k[0], fromNorm(k[0], (gx - e.gx) / e.segMax));
    else if (which === "D") setIfChanged(k[1], fromNorm(k[1], (gx - e.xA) / e.segMax));
    else if (which === "S") setIfChanged(k[2], (e.gb - gy) / (e.gb - e.gy) * 100);
    else if (which === "R") setIfChanged(k[3], fromNorm(k[3], (gx - e.xS) / e.segMax));
}

onclick = function (x, y, but, cmd, shift) {
    var z = zoneAt(x, y);
    if (z && (z.kind === "hdl" || z.kind === "act")) {
        if (openMenu) { openMenu = null; mgraphics.redraw(); return; }
        if (drag && drag.captured) setCursorHidden(false);
        drag = null;
        if (z.kind === "act") { z.fn(); mgraphics.redraw(); return; }
        drag = { hdl: z.id, ox: z.cx - x, oy: z.cy - y };
        hoverHdl = z.id;
        mgraphics.redraw();
        return;
    }
    sharedOnclick(x, y, but, cmd, shift);
};

ondrag = function (x, y, but, cmd, shift) {
    if (drag && drag.hdl) {
        if (but === 0) { drag = null; mgraphics.redraw(); return; }
        hdlMove(drag.hdl, x, y);
        mgraphics.redraw();
        return;
    }
    sharedOndrag(x, y, but, cmd, shift);
};

ondblclick = function (x, y) {
    var z = zoneAt(x, y);
    if (z && z.kind === "hdl") {
        if (z.id === "filt") { setParamFromFace("filt_cutoff", paramSpec("filt_cutoff").init); setParamFromFace("filt_res", paramSpec("filt_res").init); }
        else {
            var k = envKeys(), idx = { A: 0, D: 1, S: 2, R: 3 }[z.id.substring(4)];
            setParamFromFace(k[idx], paramSpec(k[idx]).init);
        }
        drag = null;
        mgraphics.redraw();
        return;
    }
    if (z && z.kind === "act") return;
    sharedOndblclick(x, y);
};

onidle = function (x, y) {
    if (drag && (drag.captured || drag.hdl)) return;
    var z = zoneAt(x, y);
    var h = (z && z.kind === "hdl") ? z.id : "";
    if (h !== hoverHdl) { hoverHdl = h; mgraphics.redraw(); }
    sharedOnidle(x, y);
};

onidleout = function () {
    if (hoverHdl && !(drag && drag.hdl)) { hoverHdl = ""; mgraphics.redraw(); }
    sharedOnidleout();
};

// ---------------------------------------------------------------------------
// Preview hook (scripts/render_preview.py calls preview() before paint): demo state from the environment
//   SAMPLER_PREVIEW='{"mode":3,"sliced":0,"drawer":1,"tab":0,"env":0,"dyn":1,"set":{"filt_cutoff":900}}'
// ---------------------------------------------------------------------------

function preview() {
    var o = {};
    try { if (typeof process !== "undefined" && process.env && process.env.SAMPLER_PREVIEW) o = JSON.parse(process.env.SAMPLER_PREVIEW); } catch (_) {}
    for (var i = 0; i < WAVE_BINS; i++) {
        var t = i / WAVE_BINS;
        var a = (0.18 + 0.75 * Math.abs(Math.sin(t * 37.0)) * (0.45 + 0.55 * Math.sin(t * 5.0 + 0.6) * Math.sin(t * 5.0 + 0.6))) * Math.exp(-t * 1.1);
        wavePeaksL[i] = Math.min(1, a);
        wavePeaksR[i] = Math.min(1, a * 0.92);
    }
    hasLoadedSample = 1;
    sampleFileName = "Pad - Granular - F#.wav";
    sampleDurationMs = 4200;
    dspReady = true;
    if (o.mode !== undefined) storeParam("mode", o.mode, true);
    storeParam("sliced", o.sliced || 0, true);
    storeParam("root_dyn", o.dyn ? 1 : 0, true);
    storeParam("lfo_pitch", 24, true);
    storeParam("lfo_filt", 35, true);
    storeParam("menv_pitch", 20, true);
    storeParam("filt_env_amt", 30, true);
    storeParam("filt_cutoff", 2400, true);
    storeParam("filt_res", 45, true);
    storeParam("lfo_rate", 1.4, true);
    storeParam("atk_ms", 18, true);
    storeParam("dec_ms", 420, true);
    storeParam("sus_lvl", 62, true);
    storeParam("rel_ms", 650, true);
    storeParam("matk_ms", 60, true);
    storeParam("mdec_ms", 900, true);
    storeParam("msus_lvl", 30, true);
    storeParam("mrel_ms", 400, true);
    storeParam("unison_voices", 3, true);
    storeParam("loop_mode", o.loop === undefined ? 1 : o.loop, true);
    var set = o.set || {};
    for (var k in set) storeParam(k, set[k], true);
    if (o.dyn) {
        pitchCurve = new Float32Array(PITCH_POINTS);
        pitchVoiced = new Uint8Array(PITCH_POINTS);
        for (var j = 0; j < PITCH_POINTS; j++) { pitchCurve[j] = 66 + 3 * Math.sin(j / 400) + (j > 2500 ? -2 : 0); pitchVoiced[j] = j % 900 < 760 ? 1 : 0; }
    }
    liveActiveVoices = 3;
    livePeakL = 0.55; livePeakR = 0.48;
    voicePlayheads[0] = 0.32; voiceAmps[0] = 0.8;
    voicePlayheads[1] = 0.34; voiceAmps[1] = 0.5;
    liveLfoVal = Math.sin(6.28318 * 0.62); lfoPhaseEst = 0.62;
    liveModEnvVal = 0.55;
    liveEffCutHz = 3100;
    for (var g = 0; g < 9; g++) { grainPos[g] = 0.28 + g * 0.018; grainAmp[g] = 0.3 + 0.07 * g; }
    envPage = o.env || 0;
    drawerTab = o.tab || 0;
    showInspector = o.drawer ? 1 : 0;
    if (o.hover) hoverKey = o.hover;
}
