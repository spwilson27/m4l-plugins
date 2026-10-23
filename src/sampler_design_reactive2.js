// Better Sampler, design "reactive2": the Reactive face with a left sidebar of folding sections, a tall sample viewer and
// Bitwig-style traced envelopes / per-voice filter modulation.
//
// Appended after sampler_config.js + sampler_ui.js + sampler_face.js (see AGENTS.md section 14, "Design variants").
// It reuses the shared state, helpers (text / fillRR / strokeArc / zone / ...), the shared zone kinds
// (knob, value, button, wave, flag, xfade, loop_move, menu) and their handlers, and adds two zone kinds:
//   "hdl"  a draggable graph handle (envelope breakpoints, filter cutoff / resonance point)
//   "act"  a button with its own callback (sidebar toggles, drawer-less tabs)
//
// Layout (default 678 px = sidebar + viewer + the Envelope section; everything open = 1306 px):
//   x   3..25   sidebar: 5 icon toggles (Engine detail, Envelope, Filter, LFO / Mod, Voice / Out)
//   x  29..495  sample viewer, 466 px wide (= Better Sampler's MAIN.sample width): header row, waveform, footer row (y 3..110)
//               and, fixed directly under it (y 113..166), the engine strip: engine pills, character switch, the engine's
//               knobs and Pitch / Speed / Pos (never folds away)
//   x 499..     open sections, left to right in sidebar order, 4 px apart, each 163 px high
// Which sections are open is a bit mask (bit i = SECTIONS[i]); it is saved in the SamplerStateData blob as a trailing
// "R2", <mask> pair and sets the device width with outlet(0, "setwidth_cmd", w). show_inspector mirrors "anything open".

var SECTIONS = [
    { id: "details", name: "Engine detail", w: 164, acc: "a_eng" },
    { id: "env", name: "Envelope", w: 176, acc: "a_amp" },
    { id: "filter", name: "Filter", w: 166, acc: "a_filt" },
    { id: "lfo", name: "LFO / Mod", w: 150, acc: "a_lfo" },
    { id: "voice", name: "Voice / Out", w: 132, acc: "a_out" }
];
var SB_X = 3, SB_W = 22;
var VIEW = { x: 29, y: 3, w: 466, h: 102 };
var STRIP = { x: 29, y: 108, w: 466, h: 58 };
var SEC_X0 = 499, SEC_GAP = 4, WIN_PAD = 3, SEC_Y = 3, SEC_H = 163;
var DEFAULT_FOLD = 2;                       // Envelope open
var foldMask = DEFAULT_FOLD;
var hoverHdl = "";
var hoverTip = null;
var RC = null;
var envX = SEC_X0, filtX = SEC_X0;          // x of the Envelope / Filter section in the current layout (set by paint)

function sectionRects(mask) {
    var out = [], x = SEC_X0;
    for (var i = 0; i < SECTIONS.length; i++) {
        if (!((mask >> i) & 1)) continue;
        out.push({ id: SECTIONS[i].id, index: i, x: x, w: SECTIONS[i].w });
        x += SECTIONS[i].w + SEC_GAP;
    }
    return out;
}
function foldWidth(mask) {
    var r = sectionRects(mask);
    if (!r.length) return SEC_X0 - SEC_GAP + WIN_PAD;
    var l = r[r.length - 1];
    return l.x + l.w + WIN_PAD;
}
function sectionX(id) {
    var r = sectionRects(foldMask);
    for (var i = 0; i < r.length; i++) if (r[i].id === id) return r[i].x;
    return -1;
}

function setFoldMask(m) {
    foldMask = Math.max(0, Math.min((1 << SECTIONS.length) - 1, Math.round(m)));
    setParamFromFace("show_inspector", foldMask ? 1 : 0);
    applyDeviceWidth();
    notifyclients();
    mgraphics.redraw();
}
function toggleSection(i) { setFoldMask(foldMask ^ (1 << i)); }

// The open sections set the device width (function declaration: replaces the shared one; device_ready calls it)
function applyDeviceWidth() {
    outlet(0, "setwidth_cmd", foldWidth(foldMask));
}

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

// Live's own colours (max.getcolor) with the measured Live 12 default dark theme as fallback (see sampler_theme_ableton.js)
var LIVE_FALLBACK = {
    live_desktop: [0.165, 0.165, 0.165], live_surface_bg: [0.212, 0.212, 0.212], live_lcd_bg: [0.094, 0.094, 0.094],
    live_lcd_frame: [0.243, 0.243, 0.243], live_control_bg: [0.118, 0.118, 0.118], live_control_fg: [0.71, 0.71, 0.71],
    live_control_selection: [1.0, 0.678, 0.337], live_control_zombie: [0.459, 0.459, 0.459],
    live_display_line_one: [1.0, 0.678, 0.337], live_display_line_two: [0.012, 0.765, 0.835],
    live_display_handle_one: [1.0, 0.678, 0.337], live_display_handle_two: [1.0, 0.412, 0.498],
    live_display_scale_text: [0.525, 0.525, 0.525], live_alert: [0.906, 0.412, 0.259]
};
function liveCol(name) { return themeCol([name], LIVE_FALLBACK[name]); }

function initTheme() {
    if (RC) return;
    var desk = liveCol("live_desktop"), surf = liveCol("live_surface_bg"), lcd = liveCol("live_lcd_bg"), frame = liveCol("live_lcd_frame");
    var ctlBg = liveCol("live_control_bg"), ctlFg = liveCol("live_control_fg"), sel = liveCol("live_control_selection");
    var cyan = liveCol("live_display_line_two"), orange = liveCol("live_display_handle_one"), pink = liveCol("live_display_handle_two");
    var scale = liveCol("live_display_scale_text"), zombie = liveCol("live_control_zombie");
    // Like Echo: the sections hold the lighter of the two Live surface colours, the gaps behind them the darker one, the displays
    // stay the near-black LCD colour (the names differ between Live themes, so the choice is by luminance)
    RC = {
        light: lumi(desk) > 0.5,
        bg: lumi(surf) >= lumi(desk) ? desk : surf, panel: lumi(surf) >= lumi(desk) ? surf : desk, raised: ctlBg, wave: lcd, line: frame, track: mixc(frame, ctlFg, 0.3),
        text: ctlFg, sub: scale, dim: zombie, knob: ctlBg, dark: mixc(lcd, [0, 0, 0], 0.4),
        sel: sel, cyan: cyan, pink: pink, white: [1, 1, 1],
        a_wave: cyan, a_eng: cyan, a_amp: cyan, a_mod: orange, a_filt: cyan, a_lfo: cyan, a_out: cyan,
        yellow: orange, green: cyan, orange: liveCol("live_alert")
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


// ---------------------------------------------------------------------------
// Cheap telemetry: redraw only when something moved. The shared poll reads the scope (incl. the per-voice slots
// 128..207); this adds the signature, the LFO phase estimate and the "newest voice" ordering.
// ---------------------------------------------------------------------------

var sharedPoll = pollTelemetryScope;
var voiceBorn = [];
var prevAmpStage = [];
var bornSeq = 0;
for (var bi0 = 0; bi0 < 16; bi0++) { voiceBorn.push(0); prevAmpStage.push(0); }

function stageOf(enc) { return Math.floor(enc + 1e-6); }

// Voices that sound (amp stage > 0), newest first
function soundingVoices(modPage) {
    var out = [];
    for (var v = 0; v < 16; v++) {
        var enc = modPage ? voiceModStg[v] : voiceAmpStg[v];
        if (stageOf(enc) >= 1 && (voiceAmpStg[v] > 0.5 || !modPage)) out.push(v);
    }
    out.sort(function (a, b) { return voiceBorn[b] - voiceBorn[a] || a - b; });
    return out;
}

pollTelemetryScope = function () {
    sharedPoll();
    for (var v = 0; v < 16; v++) {
        var st = stageOf(voiceAmpStg[v]);
        var pv = prevAmpStage[v];
        if ((st === 1 && pv !== 1) || (st > 1 && pv === 0)) voiceBorn[v] = ++bornSeq;
        prevAmpStage[v] = st;
    }
    var sig = liveActiveVoices * 1009 + Math.round(liveLfoVal * 400) * 7 + Math.round(liveModEnvVal * 200) * 13
        + Math.round(livePeakL * 120) * 17 + Math.round(livePeakR * 120) * 19 + Math.round(Math.log(Math.max(20, liveEffCutHz)) * 40) * 23;
    for (var u = 0; u < 16; u++) {
        if (voiceAmps[u] > 0.02) sig += Math.round(voicePlayheads[u] * 400) * (29 + u) + Math.round(voiceAmps[u] * 60);
        sig += Math.round(voiceAmpStg[u] * 160) * (37 + u) + Math.round(voiceAmpLvl[u] * 100) * (41 + u)
            + Math.round(voiceModStg[u] * 160) * (43 + u) + Math.round(voiceModLvl[u] * 100) * (47 + u)
            + Math.round(Math.log(Math.max(1, voiceCutHz[u])) * 60) * (53 + u);
    }
    for (var q = 0; q < GRAIN_SLOTS; q++) if (grainAmp[q] > 0.02) sig += Math.round(grainPos[q] * 400) * (31 + q);
    var d = liveLfoVal - lfoPrevVal;
    if (d > 1e-4) lfoDir = 1; else if (d < -1e-4) lfoDir = -1;
    lfoPrevVal = liveLfoVal;
    var shp = Math.round(paramValue("lfo_shape"));
    if (shp < 3) lfoPhaseEst = lfoPhaseFromValue(shp, liveLfoVal, lfoDir);
    else if (sig !== telSig) { lfoHist.push(liveLfoVal); if (lfoHist.length > 40) lfoHist.shift(); }
    if (sig !== telSig) { telSig = sig; telChanged = true; }
};

scopeTask = (typeof Task !== "undefined") ? new Task(function () {
    pollTelemetryScope();
    if (telChanged) { telChanged = false; mgraphics.redraw(); }
    if (scopeTask) scopeTask.schedule((liveActiveVoices > 0 || livePeakL > 0.001) ? 45 : 80);
}) : null;

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
        if (on) fillRR(x + i * sw + 1, y + 1, sw - 2, h - 2, 2.5, RC.sel, dimmed ? 0.4 : 0.95);
        text(labels[i], x + i * sw + sw * 0.5, y + h * 0.5 + 3, 7.5, on ? RC.dark : RC.sub, on, 1);
        zone("button", x + i * sw, y, sw, h, { action: "menu_pick", key: key, value: i });
    }
}

// Switch: track + thumb, toggles `key`
function switchCtl(key, x, y, acc, dimmed) {
    var on = Math.round(paramValue(key)) > 0;
    fillRR(x, y + 1, 20, 9, 4.5, on ? RC.sel : RC.track, dimmed ? 0.4 : (on ? 0.9 : 1));
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

// Ableton dial: label above, a thin open 270 degree arc (lit in the accent only where the value is), a thin needle, value below.
// opts: dim, mod {ext, cur} (LFO / Mod envelope reach on the knob), live {val, acc}: a dot at the modulated position, noValue
function rKnob(key, cx, cy, r, label, acc, opts) {
    opts = opts || {};
    var v = paramValue(key);
    var n = toNorm(key, v);
    var al = opts.dim ? 0.45 : 1.0;
    var R = r + 1;
    var ang = KNOB_A0 + n * KNOB_SWEEP;
    strokeArc(cx, cy, R, KNOB_A0, KNOB_A0 + KNOB_SWEEP, RC.track, al, 1.3);
    var from = BIPOLAR_KEYS[key] ? KNOB_A0 + KNOB_SWEEP * 0.5 : KNOB_A0;
    var lo = Math.min(from, ang), hi = Math.max(from, ang);
    if (hi - lo > 0.012) strokeArc(cx, cy, R, lo, hi, acc, al, 2.0);

    var md = opts.mod === undefined ? knobMod(key) : opts.mod;
    if (md && !opts.dim) {
        var mr = R + 2.4;
        strokeArc(cx, cy, mr, KNOB_A0 + clamp01(n - md.ext) * KNOB_SWEEP, KNOB_A0 + clamp01(n + md.ext) * KNOB_SWEEP, RC.a_mod, 0.5, 1.6);
        var ad = KNOB_A0 + clamp01(n + md.cur) * KNOB_SWEEP;
        circle(cx + Math.cos(ad) * mr, cy + Math.sin(ad) * mr, 1.6, [1, 1, 1], 0.95);
    }
    if (opts.live) {
        var mr2 = R + 2.4;
        var depth = BIPOLAR_KEYS[key] ? (n * 2 - 1) : n;
        var al2 = KNOB_A0 + clamp01(0.5 + 0.5 * depth * opts.live.val) * KNOB_SWEEP;
        strokeArc(cx, cy, mr2, KNOB_A0, KNOB_A0 + KNOB_SWEEP, RC.line, 0.9, 1.0);
        circle(cx + Math.cos(al2) * mr2, cy + Math.sin(al2) * mr2, 1.6, opts.live.acc, 0.95);
    }
    line(cx + Math.cos(ang) * R * 0.28, cy + Math.sin(ang) * R * 0.28, cx + Math.cos(ang) * R * 0.88, cy + Math.sin(ang) * R * 0.88, RC.text, al, 1.2);

    var hot = (hoverKey === key) || (drag && drag.key === key);
    if (label) text(label, cx, cy - R - ((md && !opts.dim) || opts.live ? 9 : 3), 7.5, RC.text, false, 1, al);
    if (!opts.noValue) text(fmtParam(key, v), cx, cy + R + 9, 7.5, hot ? RC.white : RC.text, hot, 1, al);
    zone("knob", cx - R - 6, cy - R - 10, R * 2 + 12, R * 2 + 21, { key: key });
}

function fmtMsShort(ms) {
    if (ms < 10) return ms.toFixed(1) + "ms";
    if (ms < 1000) return Math.round(ms) + "ms";
    return (ms / 1000).toFixed(1) + "s";
}


// ---------------------------------------------------------------------------
// Sidebar: one icon toggle per section (vector glyphs; the name shows as a HUD tip while hovering)
// ---------------------------------------------------------------------------

var SB_BTN = { h: 22, pitch: 28, y0: 8 };

function sbGlyph(i, cx, cy, c, a) {
    setc(c, a);
    mgraphics.set_line_width(1.4);
    var j;
    if (i === 0) {                         // engine settings: three sliders
        for (j = 0; j < 3; j++) {
            var ly = cy - 5 + j * 5;
            line(cx - 7, ly, cx + 7, ly, c, a * 0.7, 1.1);
            circle(cx - 3 + ((j * 5) % 9) , ly, 1.9, c, a);
        }
    } else if (i === 1) {                         // envelope: ADSR outline
        mgraphics.move_to(cx - 7.5, cy + 5); mgraphics.line_to(cx - 3.5, cy - 5.5); mgraphics.line_to(cx, cy - 1);
        mgraphics.line_to(cx + 3.5, cy - 1); mgraphics.line_to(cx + 7.5, cy + 5); mgraphics.stroke();
    } else if (i === 2) {                         // filter: low-pass response
        mgraphics.move_to(cx - 7.5, cy - 2); mgraphics.line_to(cx - 1, cy - 2); mgraphics.line_to(cx + 1, cy - 5);
        mgraphics.line_to(cx + 3, cy - 1); mgraphics.line_to(cx + 7.5, cy + 5); mgraphics.stroke();
    } else if (i === 3) {                         // LFO: sine
        for (j = 0; j <= 14; j++) {
            var px = cx - 7.5 + j, py = cy - Math.sin(j / 14 * 6.2832) * 4.5;
            if (j === 0) mgraphics.move_to(px, py); else mgraphics.line_to(px, py);
        }
        mgraphics.stroke();
    } else {                                      // voice / out: level bars
        var hs = [5, 9, 6.5];
        for (j = 0; j < 3; j++) fillRR(cx - 7 + j * 5.2, cy + 6 - hs[j] * 1.1, 3.6, hs[j] * 1.1, 1.2, c, a);
    }
}

function paintSidebar() {
    panelBox(SB_X, SEC_Y, SB_W, SEC_H);
    for (var i = 0; i < SECTIONS.length; i++) {
        var y = SB_BTN.y0 + i * SB_BTN.pitch;
        var on = ((foldMask >> i) & 1) === 1;
        var acc = RC[SECTIONS[i].acc];
        var hot = hoverTip && hoverTip.index === i;
        fillRR(SB_X + 2, y, SB_W - 4, SB_BTN.h, 4, on ? RC.sel : (hot ? mixc(RC.raised, RC.cyan, 0.25) : RC.raised), on ? 0.95 : 1);
        sbGlyph(i, SB_X + SB_W * 0.5, y + SB_BTN.h * 0.5, on ? RC.dark : (hot ? RC.cyan : RC.sub), 1.0);
        (function (idx) {
            actZone(SB_X + 1, y - 1, SB_W - 2, SB_BTN.h + 2, function () { toggleSection(idx); }, { tip: SECTIONS[idx].name, index: idx });
        })(i);
    }
}

function paintTip() {
    if (!hoverTip) return;
    var w = textW(hoverTip.tip, 8.0) + 14;
    var y = SB_BTN.y0 + hoverTip.index * SB_BTN.pitch + 3;
    var x = SB_X + SB_W + 3;
    fillRR(x, y, w, 16, 4, RC.dark, 0.96);
    text(hoverTip.tip, x + 7, y + 11.5, 8.0, RC.text, false, 0);
}

// ---------------------------------------------------------------------------
// Sample viewer: nearly full height (header row, waveform, footer row)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Waveform zoom / pan (the XO Sample Map gestures): wheel zooms around the cursor, Cmd-drag / Option-drag / middle-button drag
// pans, a double-click on the zoomed waveform or a click on the zoom pill resets. 1x .. 64x, not persisted. Everything goes
// through vwx (norm -> screen) / vnorm (screen -> norm); the waveform is re-read at the visible range's resolution in chunks.
// ---------------------------------------------------------------------------

var viewWave = [VIEW.x + 4, VIEW.y + 17, VIEW.w - 8, VIEW.h - 34];
var VZ_MAX = 64;
var viewZoom = 1.0, viewX0 = 0.0;
var panState = null;
var WHEEL_ZOOM_SIGN = 1;
var WHEEL_ZOOM_RATE = 0.96;

function vwx(n) { return viewWave[0] + (n - viewX0) * viewZoom * viewWave[2]; }
function vnorm(x) { return viewX0 + (x - viewWave[0]) / (viewWave[2] * viewZoom); }
function waveNorm(x) { return clamp01(vnorm(x)); }          // replaces the shared one: every wave drag goes through the view
function clampView() {
    viewZoom = Math.max(1.0, Math.min(VZ_MAX, Number(viewZoom) || 1.0));
    if (viewZoom < 1.0005) { viewZoom = 1.0; viewX0 = 0.0; return; }
    viewX0 = Math.max(0.0, Math.min(1.0 - 1.0 / viewZoom, viewX0));
}
function resetView() { viewZoom = 1.0; viewX0 = 0.0; panState = null; mgraphics.redraw(); }
function zoomLabel() { return (viewZoom >= 10 ? viewZoom.toFixed(0) : viewZoom.toFixed(1)) + "x"; }
function zoomPillRect() { return [viewWave[0] + 3, viewWave[1] + viewWave[3] - 14, 30, 11]; }
function inWaveRect(x, y) { return x >= viewWave[0] && x <= viewWave[0] + viewWave[2] && y >= viewWave[1] && y <= viewWave[1] + viewWave[3]; }

// Zoom by factor keeping the sample position under screen x fixed (unless clamped at the edges)
function zoomViewAt(x, factor) {
    var fx = clamp01((x - viewWave[0]) / viewWave[2]);
    var n = vnorm(x);
    viewZoom = Math.max(1.0, Math.min(VZ_MAX, viewZoom * factor));
    viewX0 = n - fx / viewZoom;
    clampView();
    mgraphics.redraw();
}
function panViewBy(dx) { viewX0 -= dx / (viewWave[2] * viewZoom); clampView(); mgraphics.redraw(); }

// One wheel event's zoom factor: dy clamped to +-3 units, the same exponent as XO Sample Map's Zoom Speed 1.0x
function wheelZoomFactor(dy) {
    var units = Math.max(-3, Math.min(3, dy * WHEEL_ZOOM_SIGN));
    var cap = Math.max(1.8, WHEEL_ZOOM_RATE);
    return Math.exp(Math.max(-cap, Math.min(cap, WHEEL_ZOOM_RATE * units)));
}
// Max documents onwheel(x, y, inc_x, inc_y, cmd, shift, capslock, option, ctrl); up to 9 arguments -> the deltas are args 2 / 3,
// 10 or more -> the last two, an event object last -> its deltaX / deltaY (the XO lesson: taking the last two of the documented
// form reads the option / ctrl flags and a real wheel never zoomed)
function parseWheelDelta(args) {
    var last = args.length > 0 ? args[args.length - 1] : null;
    if (args.length <= 9 && !(last && typeof last === "object")) {
        var ix = Number(args[2]), iy = Number(args[3]);
        return [isFinite(ix) ? ix : 0, isFinite(iy) ? iy : 0];
    }
    if (last && typeof last === "object") {
        var oy = Number(last.deltaY !== undefined ? -last.deltaY : (last.wheelDeltaY !== undefined ? last.wheelDeltaY : 0));
        return [Number(last.deltaX) || 0, oy || 0];
    }
    var nums = args.slice(2).map(Number).filter(function (v) { return isFinite(v); });
    if (nums.length >= 2) return [nums[nums.length - 2], nums[nums.length - 1]];
    if (nums.length === 1) return [0, nums[0]];
    return [0, 0];
}
function isPanGesture(option, ev, cmd) {
    if (option || cmd) return true;
    return !!(ev && typeof ev === "object" && (Number(ev.buttons) & 4));
}

// Waveform detail for a zoomed view: peak per pixel column of the visible range, read from the buffer in chunks on a Task
var DETAIL_CHUNK = 262144;
var detail = null;      // { key, cols, amp: Float32Array, got: Uint8Array, pos, end, startF, perCol, chans, task, done }
function detailKey() { return [Math.round(viewX0 * 1e6), Math.round(viewZoom * 1e4), Math.round(viewWave[2]), sampleFrames].join("|"); }
function requestDetail() {
    if (viewZoom <= 1.0005 || !sampBufName || typeof Buffer === "undefined" || sampleFrames <= 0) { detail = null; return; }
    var key = detailKey();
    if (detail && detail.key === key) return;
    if (detail && detail.task && typeof detail.task.cancel === "function") detail.task.cancel();
    var cols = Math.max(1, Math.round(viewWave[2]));
    var startF = Math.floor(viewX0 * sampleFrames), endF = Math.min(sampleFrames, Math.ceil((viewX0 + 1.0 / viewZoom) * sampleFrames));
    var chans = 1;
    try { var bb = new Buffer(sampBufName); chans = (typeof bb.channelcount === "function") ? Math.max(1, bb.channelcount()) : 2; } catch (_) {}
    detail = { key: key, cols: cols, amp: new Float32Array(cols), got: new Uint8Array(cols), pos: startF, end: Math.max(startF + 1, endF), startF: startF, perCol: Math.max(1e-6, (endF - startF) / cols), chans: chans, task: null, done: false };
    var job = detail;
    if (typeof Task === "undefined") { while (!detailStep(job)) {} return; }
    job.task = new Task(function () {
        if (detail !== job) return;
        if (!detailStep(job)) job.task.schedule(1);
        mgraphics.redraw();
    });
    job.task.schedule(1);
}
function detailStep(job) {
    if (!job || job.done) return true;
    try {
        var b = new Buffer(sampBufName);
        var len = Math.min(DETAIL_CHUNK, job.end - job.pos);
        for (var c = 1; c <= job.chans; c++) {
            var d = b.peek(c, job.pos, len);
            for (var i = 0; i < len; i++) {
                var col = Math.min(job.cols - 1, Math.floor((job.pos + i - job.startF) / job.perCol));
                var v = d[i] < 0 ? -d[i] : d[i];
                if (v > job.amp[col]) job.amp[col] = v;
                job.got[col] = 1;
            }
        }
        job.pos += len;
    } catch (_) { job.done = true; return true; }
    if (job.pos < job.end) return false;
    job.done = true;
    return true;
}
// amplitude at screen column px: the detail when this column has been read, else the overview
function colAmp(px) {
    if (detail && detail.key === detailKey()) {
        var col = Math.round(px - viewWave[0]);
        if (col >= 0 && col < detail.cols && detail.got[col]) return Math.min(1, detail.amp[col]);
    }
    return waveAmp(clamp01(vnorm(px)));
}
function zoomWavePolygon(wx, wy, ww, wh, t0, t1, c, a) {
    var cy = wy + wh * 0.5, half = wh * 0.48;
    var x0 = Math.max(wx, vwx(t0)), x1 = Math.min(wx + ww, vwx(t1));
    if (x1 <= x0) return;
    var cols = Math.max(2, Math.round(x1 - x0));
    var top = [], bot = [];
    for (var i = 0; i <= cols; i++) {
        var px = x0 + (x1 - x0) * (i / cols);
        var amp = Math.max(0.004, colAmp(px)) * half;
        top.push([px, cy - amp]);
        bot.push([px, cy + amp]);
    }
    polygon(top.concat(bot.reverse()), c, a);
}
function paintPitchCurveZ(wx, wy, ww, wh) {
    var n = pitchCurve.length, lo = Infinity, hi = -Infinity;
    for (var i = 0; i < n; i++) { var v = pitchCurve[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    lo -= 2; hi += 2;
    var span = Math.max(4, hi - lo), top = wy + 6, bot = wy + wh - 6;
    var cols = Math.max(2, Math.round(ww)), runVoiced = -1;
    mgraphics.set_line_width(1.6);
    for (var c = 0; c <= cols; c++) {
        var px = wx + c / cols * ww;
        var idx = Math.min(n - 1, Math.max(0, Math.round(clamp01(vnorm(px)) * (n - 1))));
        var vz = pitchVoiced ? pitchVoiced[idx] : 1;
        var py = bot - (pitchCurve[idx] - lo) / span * (bot - top);
        if (vz !== runVoiced) {
            if (runVoiced >= 0) { mgraphics.line_to(px, py); mgraphics.stroke(); }
            setc(RC.orange, vz ? 0.95 : 0.4);
            mgraphics.move_to(px, py);
            runVoiced = vz;
        } else mgraphics.line_to(px, py);
    }
    mgraphics.stroke();
}

function paintViewer() {
    var sx = VIEW.x, sy = VIEW.y, sw = VIEW.w, sh = VIEW.h;
    panelBox(sx, sy, sw, sh);
    var acc = RC.a_wave;

    // Header (the default face's layout): folder / file name, voices, sample gain, ROOT note + ct; Single / Sliced top right
    iconFolder(sx + 7, sy + 5, acc, 0.9);
    var nameW = text(fitText(hasLoadedSample ? sampleFileName : "Drop a sample or click to browse", 170, 9.0), sx + 21, sy + 13, 9.0, hasLoadedSample ? acc : RC.sub, false, 0);
    zone("button", sx + 4, sy + 1, nameW + 20, 15, { action: "browse" });
    var vx = sx + 228;
    if (!dspReady) {
        var failed = dspError.length > 0;
        var pl = failed ? "DSP failed: " + dspError : "DSP loading…";
        var pw = textW(pl, 8.0) + 12;
        fillRR(vx - 4, sy + 3, pw, 12, 6, failed ? RC.orange : RC.a_filt, 0.9);
        text(pl, vx - 4 + pw * 0.5, sy + 12, 8.0, RC.dark, true, 1);
    } else {
        for (var b = 0; b < 4; b++) line(vx + b * 2.5, sy + 6, vx + b * 2.5, sy + 13, acc, 0.9, 1.4);
        text(liveActiveVoices + " / " + curPolyVoices, vx + 14, sy + 13, 9.0, acc, false, 0);
    }
    paintGainPill(sx + 276, sy + 2);
    var rx = sx + 330;
    var rc = rootDyn ? acc : RC.sub;
    strokeArc(rx + 4, sy + 9, 3.6, 0, Math.PI * 2, rc, 1.0, 1.2);
    line(rx + 1, sy + 9, rx + 7, sy + 9, rc, 1.0, 1.0);
    text("ROOT", rx + 11, sy + 13, 8.5, RC.sub, true, 0);
    zone("button", rx - 2, sy + 1, 44, 15, { action: "toggle", key: "root_dyn" });
    if (rootDyn) {
        text(pitchCurve ? "Dynamic" : "Dynamic…", rx + 46, sy + 13, 9.0, RC.sub, false, 0);
    } else {
        var noteW = text(midiToNoteName(curRootNote), rx + 46, sy + 13, 9.0, acc, false, 0);
        zone("value", rx + 44, sy + 2, noteW + 4, 14, { key: "root_note", pxPerUnit: 4 });
        var fine = Math.round(paramValue("fine_cents"));
        var fineW = text(fine + " ct", rx + 62, sy + 13, 9.0, acc, false, 0);
        zone("value", rx + 60, sy + 2, fineW + 4, 14, { key: "fine_cents", pxPerUnit: 1 });
    }
    for (var i = 0; i < 2; i++) {
        var bx = sx + sw - 46 + i * 22;
        var on = (curSliced ? 1 : 0) === i;
        fillRR(bx, sy + 2, 21, 13, 3, on ? acc : RC.raised, on ? 0.9 : 1);
        var cc = on ? RC.dark : RC.sub;
        if (i === 0) iconWave(bx + 4.5, sy + 5, cc, 1.0); else iconKnife(bx + 5, sy + 5, cc, 1.0);
        zone("button", bx, sy + 2, 21, 13, { action: "sliced_set", value: i });
    }

    // Waveform (one view transform: vwx / vnorm; overlays are clipped to the waveform; zoom / pan are not persisted)
    var wx = viewWave[0], wy = viewWave[1], ww = viewWave[2], wh = viewWave[3];
    fillRR(wx, wy, ww, wh, 3, RC.wave);
    var loopOn = curLoopMode > 0;
    var loopZones = null;
    var inW = function (x) { return x >= wx - 0.5 && x <= wx + ww + 0.5; };
    line(wx + 4, wy + wh * 0.5, wx + ww - 4, wy + wh * 0.5, RC.line, 0.5, 0.8);
    if (hasLoadedSample) {
        requestDetail();
        zoomWavePolygon(wx, wy, ww, wh, 0, 1, mixc(RC.wave, acc, 0.28), 1.0);
        zoomWavePolygon(wx, wy, ww, wh, curStart, curEnd, mixc(acc, [1, 1, 1], 0.25), 1.0);
    } else {
        line(wx + 4, wy + wh * 0.5, wx + ww - 4, wy + wh * 0.5, RC.dim, 1.0, 1.0);
    }

    if (loopOn && !curSliced) {
        var lsX = vwx(curLoopStart), leX = vwx(curLoopEnd);
        var xfW = curXfade * (leX - lsX);
        var LC = RC.green;
        for (var gi = 0; gi < 12 && xfW > 1; gi++) fillClipped(lsX - xfW + xfW * gi / 12, xfW / 12 + 0.5, wx, ww, wy, wh, LC, 0.38 * (gi + 1) / 12);
        fillClipped(lsX, leX - lsX, wx, ww, wy, wh, LC, 0.30);
        if (inW(lsX)) { line(lsX, wy, lsX, wy + wh, LC, 0.95, 1.0); fillRect(lsX, wy + wh - 7, 7, 7, LC); }
        if (inW(leX)) { line(leX, wy, leX, wy + wh, LC, 0.95, 1.0); fillRect(leX - 7, wy + wh - 7, 7, 7, LC); }
        var midX = (lsX + leX) * 0.5;
        if (inW(midX)) fillRect(midX - 3.5, wy + wh * 0.5 - 3.5, 7, 7, LC);
        loopZones = { xf: (xfW > 4 && lsX - xfW >= wx && lsX <= wx + ww) ? [lsX - xfW, wy, xfW - 3, wh] : null, mv: inW(midX) ? [Math.max(wx, Math.min(wx + ww - 12, midX - 6)), wy + wh * 0.5 - 6, 12, 12] : null };
    }

    if (curSliced) {
        var starts = currentSliceStarts();
        for (var mi = 0; mi < sliceMarkers.length; mi++) {
            var mk = sliceMarkers[mi];
            var mkx = vwx(mk);
            if ((mk < curStart - 1e-6 || mk > curEnd + 1e-6) && inW(mkx)) line(mkx, wy + 8, mkx, wy + wh, [1, 1, 1], 0.14, 1.0);
        }
        for (var si = 0; si < starts.length; si++) {
            var mxs = vwx(starts[si]);
            var nxt = vwx((si + 1 < starts.length) ? starts[si + 1] : curEnd);
            if (nxt < wx || mxs > wx + ww) continue;
            if (si === selectedSliceIdx) fillClipped(mxs, nxt - mxs, wx, ww, wy, wh, acc, 0.18);
            if (inW(mxs)) {
                line(mxs, wy, mxs, wy + wh, RC.yellow, 0.85, 1.0);
                polygon([[mxs, wy], [Math.min(mxs + 6, wx + ww), wy], [mxs, wy + 6]], RC.yellow);
                if (nxt - mxs > 22) text(midiToNoteName(curSliceFrom + si), mxs + 3, wy + 15, 7.0, RC.yellow, false, 0, 0.85);
            }
        }
    }

    // Playheads and grains, clipped to the waveform
    for (var v = 0; v < 16 && hasLoadedSample; v++) {
        if ((voiceAmps[v] || 0) <= 0.02) continue;
        var phx = vwx(clamp01(voicePlayheads[v]));
        if (curMode === 2 || curMode === 4) {
            var spread = Math.max(3, paramValue("grain_spray") * 0.01 * ww * 0.25);
            fillClipped(phx - spread, spread * 2, wx, ww, wy, wh, acc, 0.08 * voiceAmps[v] + 0.04);
        } else if (curMode === 1) {
            var cw = Math.max(3, Math.min(ww * 0.2, paramValue("grain_size") / Math.max(1, sampleDurationMs) * ww * viewZoom));
            fillClipped(phx, cw, wx, ww, wy, wh, acc, 0.14);
        }
        if (inW(phx)) line(phx, wy, phx, wy + wh, [1, 1, 1], Math.min(1, 0.4 + voiceAmps[v]), 1.2);
    }
    if (hasLoadedSample && (curMode === 2 || curMode === 4)) {
        for (var g = 0; g < GRAIN_SLOTS; g++) {
            var gp = grainPos[g], ga = grainAmp[g];
            if (!(gp >= 0) || !(ga > 0.02)) continue;
            var gx = vwx(clamp01(gp));
            if (inW(gx)) line(gx, wy + 4, gx, wy + wh - 4, [0.85, 0.95, 1.0], Math.min(0.9, 0.2 + 0.7 * ga), 1.0);
        }
    }
    if (rootDyn && pitchCurve && hasLoadedSample) paintPitchCurveZ(wx, wy, ww, wh);
    if (!hasLoadedSample) text("Drop a sample here", wx + ww * 0.5, wy + wh * 0.5 - 7, 9.5, RC.sub, false, 1);

    var stX = vwx(curStart), enX = vwx(curEnd);
    if (curSliced) {
        if (inW(enX)) { line(enX, wy, enX, wy + wh, acc, 0.95, 1.0); fillRect(enX - 7, wy + wh - 7, 7, 7, acc); }
        if (inW(stX)) fillRect(stX, wy + wh - 7, 7, 7, acc);
    } else {
        if (inW(stX)) { line(stX, wy, stX, wy + wh, RC.yellow, 0.95, 1.0); fillRect(stX, wy, 6, 6, RC.yellow); }
        if (inW(enX)) { line(enX, wy, enX, wy + wh, RC.yellow, 0.95, 1.0); fillRect(enX - 6, wy, 6, 6, RC.yellow); }
    }
    zone("wave", wx, wy, ww, wh, {});
    if (loopOn && !curSliced && loopZones) {
        if (loopZones.xf) zone("xfade", loopZones.xf[0], loopZones.xf[1], loopZones.xf[2], loopZones.xf[3], {});
        if (loopZones.mv) zone("loop_move", loopZones.mv[0], loopZones.mv[1], loopZones.mv[2], loopZones.mv[3], {});
    }
    if (curSliced) {
        for (var fi = 0; fi < sliceMarkers.length; fi++) {
            var fm = sliceMarkers[fi];
            var fx = vwx(fm) - 2;
            if (fm > curStart + 0.002 && fm < curEnd - 0.002 && fx >= wx && fx + 10 <= wx + ww) zone("flag", fx, wy, 10, 9, { index: fi });
        }
    }
    if (viewZoom > 1.0005) {
        var pr = zoomPillRect();
        fillRR(pr[0], pr[1], pr[2], pr[3], 5, RC.dark, 0.85);
        text(zoomLabel(), pr[0] + pr[2] * 0.5, pr[1] + 8.5, 7.5, RC.text, true, 1);
        actZone(pr[0], pr[1], pr[2], pr[3], function () { resetView(); });
    }

    // Footer (the default face's layout)
    var fy = sy + sh - 4;
    if (curSliced) {
        paintSlicedFooter(sx, sw, fy);
        return;
    }
    text("PLAY", sx + 6, fy, 8.5, RC.sub, true, 0);
    iconReverse(sx + 36, fy - 9, curReverse);
    zone("button", sx + 33, fy - 11, 16, 14, { action: "reverse" });
    iconFlag(sx + 58, fy - 9, RC.yellow, false);
    var stW = text(fmtPos(curStart), sx + 66, fy, 9.0, RC.yellow, false, 0);
    zone("value", sx + 64, fy - 11, stW + 4, 14, { region: "samp_start" });
    iconFlag(sx + 132, fy - 9, RC.yellow, true);
    var enW = text(fmtPos(curEnd), sx + 136, fy, 9.0, RC.yellow, false, 0);
    zone("value", sx + 134, fy - 11, enW + 4, 14, { region: "samp_end" });
    var lx = sx + 240;
    var lc = loopOn ? RC.green : RC.dim;
    text("LOOP", lx, fy, 8.5, RC.sub, true, 0);
    iconLoopMode(lx + 32, fy - 8, curLoopMode, loopOn ? RC.text : RC.sub);
    caret(lx + 47, fy - 6, RC.sub);
    zone("button", lx + 30, fy - 11, 26, 14, { action: "menu", key: "loop_mode", mw: 128 });
    iconFlag(lx + 62, fy - 9, lc, false);
    var lsW = text(fmtPos(curLoopStart), lx + 70, fy, 9.0, lc, false, 0);
    zone("value", lx + 68, fy - 11, lsW + 4, 14, { region: "loop_start" });
    iconFlag(lx + 124, fy - 9, lc, true);
    var leW = text(fmtPos(curLoopEnd), lx + 128, fy, 9.0, lc, false, 0);
    zone("value", lx + 126, fy - 11, leW + 4, 14, { region: "loop_end" });
    polygon([[lx + 170, fy - 9], [lx + 176, fy - 4], [lx + 170, fy + 1]], lc);
    polygon([[lx + 182, fy - 9], [lx + 176, fy - 4], [lx + 182, fy + 1]], lc);
    var xfW2 = text((curXfade / 0.45 * 100).toFixed(1) + " %", lx + 186, fy, 9.0, lc, false, 0);
    zone("value", lx + 168, fy - 11, xfW2 + 22, 14, { region: "loop_xfade" });
}

// ---------------------------------------------------------------------------
// Sample gain: a pill in the viewer header (drag, double-click = 0 dB), right-click / ctrl-click = normalize
// ---------------------------------------------------------------------------

var GAIN_LO = -48, GAIN_HI = 24;
var peakCache = { n: -1, peak: -1 };      // peak of the loaded sample (all channels); n = frames it was measured for
var peakJob = null;                       // { pos, n, chans, peak, task, apply } while measuring
var hudNote = { text: "", until: 0 };
var hudTask = (typeof Task !== "undefined") ? new Task(function () { mgraphics.redraw(); }) : null;
var gainHover = false;
var lastRightClick = 0;

function paintGainPill(x, y) {
    var g = paramValue("samp_gain");
    var hot = gainHover || (drag && drag.key === "samp_gain");
    fillRR(x, y, 50, 13, 3, RC.raised);
    text("G", x + 6, y + 10, 8.0, RC.dim, true, 0);
    text(fmtParam("samp_gain", g), x + 46, y + 10, 8.0, Math.abs(g) > 0.04 || hot ? (hot ? RC.text : RC.a_wave) : RC.sub, hot, 2);
    zone("value", x, y, 50, 13, { key: "samp_gain", norm: true });
    if (hudNote.text && Date.now() < hudNote.until) {
        var w = textW(hudNote.text, 8.0) + 14;
        fillRR(x - w - 4, y, w, 13, 4, RC.dark, 0.95);
        text(hudNote.text, x - w + 3, y + 10, 8.0, RC.a_out, false, 0);
    } else if (gainHover) {
        var hint = "right-click: normalize";
        var hw = textW(hint, 7.5) + 12;
        fillRR(x - hw - 4, y, hw, 13, 4, RC.dark, 0.95);
        text(hint, x - hw + 2, y + 10, 7.5, RC.sub, false, 0);
    }
}

function showHud(msg) {
    hudNote = { text: msg, until: Date.now() + 2200 };
    if (hudTask) hudTask.schedule(2300);
    mgraphics.redraw();
}

function applyNormalize(peak) {
    if (!(peak > 1e-6)) { showHud("Sample is silent"); return; }
    var want = -20 * Math.log(peak) / Math.LN10;
    var g = Math.max(GAIN_LO, Math.min(GAIN_HI, want));
    setParamFromFace("samp_gain", g);
    var clamped = g !== want;
    showHud("Normalized " + (g >= 0 ? "+" : "") + g.toFixed(1) + " dB" + (clamped ? " (limit)" : ""));
}

// Peak over every channel, read in chunks on a Task so a long file never blocks; cached per loaded sample
var PEAK_CHUNK = 262144;
function peakStep() {
    var job = peakJob;
    if (!job) return true;
    try {
        var b = new Buffer(sampBufName);
        var len = Math.min(PEAK_CHUNK, job.n - job.pos);
        for (var c = 1; c <= job.chans; c++) {
            var d = b.peek(c, job.pos, len);
            for (var i = 0; i < len; i++) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > job.peak) job.peak = v; }
        }
        job.pos += len;
    } catch (_) { peakJob = null; return true; }
    if (job.pos < job.n) return false;
    peakCache = { n: job.n, peak: job.peak };
    peakJob = null;
    if (job.apply) applyNormalize(job.peak);
    return true;
}

function normalizeSample() {
    if (!hasLoadedSample || !sampBufName || typeof Buffer === "undefined") { showHud("No sample loaded"); return; }
    if (peakCache.peak >= 0 && peakCache.n === sampleFrames) { applyNormalize(peakCache.peak); return; }
    if (peakJob) { peakJob.apply = true; showHud("Measuring peak…"); return; }
    var chans = 1;
    try { var bb = new Buffer(sampBufName); chans = (typeof bb.channelcount === "function") ? Math.max(1, bb.channelcount()) : 2; } catch (_) {}
    var n = sampleFrames;
    if (n <= 0) { showHud("No sample loaded"); return; }
    peakJob = { pos: 0, n: n, chans: chans, peak: 0, task: null, apply: true };
    showHud("Measuring peak…");
    if (typeof Task === "undefined") { while (!peakStep()) {} return; }
    var job = peakJob;
    job.task = new Task(function () {
        if (peakJob !== job) return;
        if (!peakStep()) job.task.schedule(1);
        mgraphics.redraw();
    });
    job.task.schedule(1);
}

// A new load drops the cached peak (and any measurement of the old file)
var sharedSampleLoaded = sample_loaded;
sample_loaded = function () {
    peakCache = { n: -1, peak: -1 };
    viewZoom = 1.0; viewX0 = 0.0; panState = null; detail = null;
    if (peakJob && peakJob.task && typeof peakJob.task.cancel === "function") peakJob.task.cancel();
    peakJob = null;
    return sharedSampleLoaded.apply(null, arrayfromargs(arguments));
};



// ---------------------------------------------------------------------------
// Envelope section (Live look): thin cyan curve in a dark display with corner brackets, orange hollow A / R handles, a white
// filled D handle (x = decay, y = sustain), pink diamond slope handles on the A / D / R segments, a Time | Slope tab pair and an
// A D S R value row; one white dot per sounding voice rides the curve (newest brightest)
// ---------------------------------------------------------------------------

var ENV_W = 176;
var envDots = [];            // last painted: { v, x, y, stage, alpha, rank } for the page shown (newest first)
var envPanelRect = [0, 0, 0, 0];
var envTab = 0;              // 0 Time, 1 Slope (the value row)
var ENV_MIN_SEG = 18;        // minimum width of a segment in px: handle zones are +-5, diamond zones +-4, so they never overlap

function envKeys() {
    return envPage === 1 ? ["matk_ms", "mdec_ms", "msus_lvl", "mrel_ms"] : ["atk_ms", "dec_ms", "sus_lvl", "rel_ms"];
}
function envSlopeKeys() {
    return envPage === 1 ? ["matk_slope", "mdec_slope", "mrel_slope"] : ["atk_slope", "dec_slope", "rel_slope"];
}

// bend(p, s): the gen's slope shape, p in 0..1, s in -1..1 (s > 0 bows the curve up); exactly p at s = 0
function bendP(p, s) { p = clamp01(p); return s === 0 ? p : Math.pow(p, Math.pow(4, -s)); }
// decay / release: the gen blends the bend back to p over the last 2 % of the residual, so each segment ends exactly
// when the unbent one does (no step at the tail): p + (bend - p) * smoothstep(p / 0.02)
var BEND_END = 0.02;
function bendW(p, s) {
    p = clamp01(p);
    if (s === 0) return p;
    var u = clamp01(p / BEND_END), w = u * u * (3 - 2 * u);
    return p + (bendP(p, s) - p) * w;
}

function envGeom() {
    var k = envKeys(), sk = envSlopeKeys();
    var gx = envX + 13, gw = ENV_W - 26, gy = 36, gb = 102;
    var hold = gw * 0.16;
    var segMax = (gw - hold - 4) / 3;
    var sm = segMax - ENV_MIN_SEG;               // every segment is at least ENV_MIN_SEG wide, so its slope diamond stays visible
    var an = toNorm(k[0], paramValue(k[0])), dn = toNorm(k[1], paramValue(k[1])), rn = toNorm(k[3], paramValue(k[3]));
    var sus = clamp01(paramValue(k[2]) * 0.01);
    var xA = gx + ENV_MIN_SEG + an * sm, xD = xA + ENV_MIN_SEG + dn * sm, xS = xD + hold, xR = xS + ENV_MIN_SEG + rn * sm;
    return { keys: k, slopeKeys: sk, gx: gx, gw: gw, gy: gy, gb: gb, hold: hold, segMax: segMax, minSeg: ENV_MIN_SEG, sm: sm,
        xA: xA, xD: xD, xS: xS, xR: xR, ys: gb - sus * (gb - gy), sus: sus, an: an, dn: dn, rn: rn,
        sA: clamp01((paramValue(sk[0]) + 100) / 200) * 2 - 1, sD: clamp01((paramValue(sk[1]) + 100) / 200) * 2 - 1, sR: clamp01((paramValue(sk[2]) + 100) / 200) * 2 - 1 };
}

// exponential-looking decay / release between two levels (the same shape the voice dots are mapped through)
var ENV_POW = 2.2;
function envCurveY(t) { return Math.pow(1 - t, ENV_POW); }
// progress through the curve for a level-based fraction f (0..1) of a decay / release
function envT(f) { return 1 - Math.pow(1 - clamp01(f), 1 / ENV_POW); }

// screen y of the curve in each segment (t 0..1 through the segment), slope included
function envYAttack(g, t) { return g.gb - bendP(t, g.sA) * (g.gb - g.gy); }
function envYDecay(g, t) { return g.gb - (g.sus + (1 - g.sus) * bendW(envCurveY(t), g.sD)) * (g.gb - g.gy); }
function envYRelease(g, t, relLevel) { return g.gb - relLevel * bendW(envCurveY(t), g.sR) * (g.gb - g.gy); }

// Where a voice sits on the curve. enc = stage + fraction (telemetry: slope-independent), lvl = the voice's output level (0..1).
function envDotAt(g, enc, lvl) {
    var st = stageOf(enc), f = clamp01(enc - st);
    var y = g.gb - clamp01(lvl) * (g.gb - g.gy);
    if (st === 1) { var ta = clamp01(f); return { x: g.gx + (g.xA - g.gx) * ta, y: envYAttack(g, ta), stage: 1 }; }
    if (st === 2) { var td = envT(f); return { x: g.xA + (g.xD - g.xA) * td, y: envYDecay(g, td), stage: 2 }; }
    if (st === 3) return { x: g.xD + g.hold * 0.5, y: g.ys, stage: 3 };
    if (st === 4) {
        var tr = envT(f);
        var b = bendW(1 - f, g.sR);
        var rel = (f < 0.999 && b > 1e-4) ? clamp01(lvl / b) : g.sus;      // the level the voice had when its release began
        return { x: g.xS + (g.xR - g.xS) * tr, y: y, stage: 4, relStart: rel };
    }
    return null;
}

function strokeSeg(pts, c, a, wd) {
    setc(c, a);
    mgraphics.set_line_width(wd);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (var j = 1; j < pts.length; j++) mgraphics.line_to(pts[j][0], pts[j][1]);
    mgraphics.stroke();
}
function cornerBrackets(x, y, w, h, c) {
    var L = 7;
    var xs = [x + 1, x + w - 1], ys = [y + 1, y + h - 1];
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
        var dx = i === 0 ? 1 : -1, dy = j === 0 ? 1 : -1;
        line(xs[i], ys[j], xs[i] + dx * L, ys[j], c, 1.0, 1.3);
        line(xs[i], ys[j], xs[i], ys[j] + dy * L, c, 1.0, 1.3);
    }
}
function diamond(x, y, r, c, a) { polygon([[x, y - r], [x + r, y], [x, y + r], [x - r, y]], c, a); }
function hollowSquare(x, y, r, c, w) {
    setc(c, 1.0);
    mgraphics.set_line_width(w);
    mgraphics.rectangle(x - r, y - r, r * 2, r * 2);
    mgraphics.stroke();
}

// S shown in dB, times as ms / s, slopes as %
function fmtEnvVal(key, v) {
    if (key === "sus_lvl" || key === "msus_lvl") return v <= 0.05 ? "-inf dB" : (20 * Math.log(v / 100) / Math.LN10).toFixed(1) + " dB";
    if (/slope$/.test(key)) return (v > 0 ? "+" : "") + Math.round(v) + " %";
    return fmtTime(v);
}

function paintEnvSection(sx) {
    envX = sx;
    var cy1 = RC.cyan;
    var modPage = envPage === 1;
    panelBox(sx, SEC_Y, ENV_W, SEC_H);
    var tabs = ["AMP", "MOD"];
    for (var t = 0; t < 2; t++) {
        var on2 = envPage === t || (envPage > 1 && t === 0);
        fillRR(sx + 7 + t * 43, 7, 40, 15, 3, on2 ? RC.sel : RC.raised, 1);
        text(tabs[t], sx + 7 + t * 43 + 20, 17.5, 8.5, on2 ? RC.dark : RC.sub, on2, 1);
        zone("button", sx + 7 + t * 43, 7, 40, 15, { action: "env_page", page: t });
    }
    text("ENVELOPE", sx + ENV_W - 8, 17.5, 7.0, RC.dim, false, 2);

    var g = envGeom();
    envPanelRect = [sx + 5, 27, ENV_W - 10, 84];
    fillRR(envPanelRect[0], envPanelRect[1], envPanelRect[2], envPanelRect[3], 2, RC.wave);
    cornerBrackets(envPanelRect[0], envPanelRect[1], envPanelRect[2], envPanelRect[3], cy1);

    // curve: a thin line, no fill
    var n = 18, j, pts = [[g.gx, g.gb]];
    for (j = 1; j <= n; j++) { var ta = j / n; pts.push([g.gx + (g.xA - g.gx) * ta, envYAttack(g, ta)]); }
    for (j = 1; j <= n; j++) { var td = j / n; pts.push([g.xA + (g.xD - g.xA) * td, envYDecay(g, td)]); }
    pts.push([g.xS, g.ys]);
    for (j = 1; j <= n; j++) { var tr = j / n; pts.push([g.xS + (g.xR - g.xS) * tr, envYRelease(g, tr, g.sus)]); }
    strokeSeg(pts, cy1, 1.0, 1.3);

    // voices: ghost release path of a voice that did not release from the sustain level, then the dots (oldest first)
    var order = soundingVoices(modPage);
    envDots = [];
    var k;
    for (k = 0; k < order.length; k++) {
        var v = order[k];
        var enc = modPage ? voiceModStg[v] : voiceAmpStg[v];
        var lv = modPage ? voiceModLvl[v] : voiceAmpLvl[v];
        var d = envDotAt(g, enc, lv);
        if (!d) continue;
        var rank = envDots.length;
        var al = rank === 0 ? 1.0 : Math.max(0.28, 0.72 - 0.11 * rank);
        if (d.stage === 4 && Math.abs(d.relStart - g.sus) > 0.03) {
            var gp = [[g.xS, envYRelease(g, 0, d.relStart)]];
            for (j = 1; j <= n; j++) { var tq = j / n; gp.push([g.xS + (g.xR - g.xS) * tq, envYRelease(g, tq, d.relStart)]); }
            strokeSeg(gp, [1, 1, 1], 0.22 * al, 1.0);
        }
        envDots.push({ v: v, x: d.x, y: d.y, stage: d.stage, alpha: al, rank: rank });
    }
    for (k = envDots.length - 1; k >= 0; k--) {
        var e = envDots[k];
        var r = e.rank === 0 ? 2.8 : 2.2;
        circle(e.x, e.y, r + 1.2, RC.dark, 0.7 * e.alpha);
        circle(e.x, e.y, r, [1, 1, 1], e.alpha);
    }

    // handles (Live): orange hollow squares at the attack peak and the release end, a white filled square at the decay / sustain
    // breakpoint, pink diamonds on the middle of the attack, decay and release segments (the slope handles)
    var hv = function (id) { return hoverHdl === "env:" + id || (drag && drag.hdl === "env:" + id); };
    var hs = [
        { id: "A", x: g.xA, y: g.gy },
        { id: "D", x: g.xD, y: g.ys },            // x = decay, y = sustain
        { id: "R", x: g.xR, y: g.gb }
    ];
    for (var h = 0; h < hs.length; h++) {
        var big = hv(hs[h].id) ? 4.2 : 3.2;
        if (hs[h].id === "D") { fillRect(hs[h].x - big, hs[h].y - big, big * 2, big * 2, [1, 1, 1], 1.0); }
        else hollowSquare(hs[h].x, hs[h].y, big, liveCol("live_display_handle_one"), 1.3);
        zone("hdl", hs[h].x - 5, hs[h].y - 5, 10, 10, { id: "env:" + hs[h].id, cx: hs[h].x, cy: hs[h].y });
    }
    var sl = [
        { id: "As", x: g.gx + (g.xA - g.gx) * 0.5, y: envYAttack(g, 0.5) },
        { id: "Ds", x: g.xA + (g.xD - g.xA) * 0.5, y: envYDecay(g, 0.5) },
        { id: "Rs", x: g.xS + (g.xR - g.xS) * 0.5, y: envYRelease(g, 0.5, g.sus) }
    ];
    for (var q = 0; q < sl.length; q++) {
        diamond(sl[q].x, sl[q].y, hv(sl[q].id) ? 4.4 : 3.4, RC.pink, 1.0);
        zone("hdl", sl[q].x - 4, sl[q].y - 4, 8, 8, { id: "env:" + sl[q].id, cx: sl[q].x, cy: sl[q].y });
    }

    // Time | Slope tabs, then the A D S R labels and values (draggable; S in dB; Slope shows A, D and R)
    for (var tb = 0; tb < 2; tb++) {
        var tx = sx + 9 + tb * 38, on3 = envTab === tb;
        text(tb === 0 ? "Time" : "Slope", tx, 125, 8.0, on3 ? RC.white : RC.sub, on3, 0);
        if (on3) line(tx, 128, tx + textW(tb === 0 ? "Time" : "Slope", 8.0), 128, RC.white, 1.0, 1.4);
        (function (idx) { actZone(tx - 3, 114, 36, 17, function () { envTab = idx; }); })(tb);
    }
    var k4 = envKeys(), sk = envSlopeKeys();
    var labs = ["A", "D", "S", "R"];
    var cw = (ENV_W - 12) / 4;
    for (var c = 0; c < 4; c++) {
        var cx = sx + 6 + cw * (c + 0.5);
        var key = envTab === 0 ? k4[c] : (c === 2 ? null : sk[c === 3 ? 2 : c]);
        text(labs[c], cx, 142, 7.5, RC.sub, false, 1);
        if (key) {
            var hot = hoverKey === key || (drag && drag.key === key);
            text(fmtEnvVal(key, paramValue(key)), cx, 154, 8.0, hot ? RC.white : cy1, hot, 1);
            zone("value", cx - cw * 0.5, 144, cw, 13, { key: key, norm: true });
        } else {
            text("—", cx, 154, 8.0, RC.dim, false, 1);
        }
    }
}

// ---------------------------------------------------------------------------
// Filter section: response curve with a cutoff / resonance point and the modulation actually applied while notes play
// ---------------------------------------------------------------------------

var FILT_W = 166;
var F_DB_LO = -36, F_DB_HI = 24;
var filtDots = [];           // last painted: { v, x, y, hz, alpha, rank } (newest first)

function filterGeom() {
    var gx = filtX + 12, gw = FILT_W - 24, gy = 34, gb = 94;
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


// Voices whose effective cutoff is reported (idle voices report 0), newest first
function filterVoices() {
    var out = [];
    for (var v = 0; v < 16; v++) if (voiceCutHz[v] > 10 && stageOf(voiceAmpStg[v]) >= 1) out.push(v);
    out.sort(function (a, b) { return voiceBorn[b] - voiceBorn[a] || a - b; });
    return out;
}

function responsePath(g, ft, hzCut, q) {
    var cols = 56, top = [];
    for (var i = 0; i <= cols; i++) {
        var hz = 20 * Math.pow(1000, i / cols);
        top.push([g.gx + g.gw * i / cols, fFy(g, filterDb(ft, hz / hzCut, q))]);
    }
    return top;
}
function strokePath(p, c, a, wd) {
    setc(c, a);
    mgraphics.set_line_width(wd);
    mgraphics.move_to(p[0][0], p[0][1]);
    for (var j = 1; j < p.length; j++) mgraphics.line_to(p[j][0], p[j][1]);
    mgraphics.stroke();
}

function paintFilterSection(sx) {
    filtX = sx;
    var acc = RC.cyan;
    panelBox(sx, SEC_Y, FILT_W, SEC_H);
    var on = curFiltOn;
    var al = on ? 1.0 : 0.4;

    // header: power, type
    fillRR(sx + 5, 6, 90, 17, 3, RC.raised);
    iconPower(sx + 15, 14.5, on ? RC.sel : RC.dim, 1.0);
    zone("button", sx + 6, 6, 18, 17, { action: "filt_on" });
    var ft = Math.round(paramValue("filt_type"));
    var names = ["LP", "BP", "HP"];
    for (var i = 0; i < 3; i++) {
        var tx = sx + 27 + i * 22;
        var son = ft === i;
        if (son) fillRR(tx, 8.5, 21, 12, 2.5, RC.sel, on ? 0.95 : 0.4);
        text(names[i], tx + 10.5, 17.5, 7.5, son ? RC.dark : RC.sub, son, 1);
        zone("button", tx, 7, 21, 15, { action: "menu_pick", key: "filt_type", value: i });
    }
    text("FILTER", sx + FILT_W - 8, 17.5, 7.0, RC.dim, false, 2);

    var g = filterGeom();
    fillRR(sx + 5, 27, FILT_W - 10, 76, 2, RC.wave);
    cornerBrackets(sx + 5, 27, FILT_W - 10, 76, acc);
    var fc = paramValue("filt_cutoff"), res = paramValue("filt_res");
    var q = resToQ(res);

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

    // base response (the knob setting): a thin line
    var top = responsePath(g, ft, fc, q);
    strokePath(top, acc, al, 1.3);

    // per voice: a ghost of the response at the voice's own effective cutoff, a dot on its peak, the newest voice's curve bright
    filtDots = [];
    if (on) {
        var vs = filterVoices();
        var k;
        for (k = vs.length - 1; k >= 1; k--) strokePath(responsePath(g, ft, voiceCutHz[vs[k]], q), RC.a_mod, Math.max(0.1, 0.22 - 0.02 * k), 1.0);
        if (vs.length) strokePath(responsePath(g, ft, voiceCutHz[vs[0]], q), RC.a_mod, 1.0, 1.4);
        for (k = 0; k < vs.length; k++) {
            var hzv = voiceCutHz[vs[k]];
            var px = Math.min(g.gx + g.gw, fFx(g, hzv)), py = fFy(g, filterDb(ft, 1, q));
            var a2 = k === 0 ? 1.0 : Math.max(0.3, 0.72 - 0.11 * k);
            filtDots.push({ v: vs[k], x: px, y: py, hz: hzv, alpha: a2, rank: k });
        }
        for (k = filtDots.length - 1; k >= 0; k--) {
            var fd = filtDots[k];
            var r = fd.rank === 0 ? 2.8 : 2.2;
            circle(fd.x, fd.y, r + 1.2, RC.dark, 0.7 * fd.alpha);
            circle(fd.x, fd.y, r, [1, 1, 1], fd.alpha);
        }
        // the cutoff the shared filter is actually running with (driven by the loudest mod envelope)
        if (liveActiveVoices > 0 && Math.abs(Math.log(liveEffCutHz / fc)) > 0.03) {
            var lx = fFx(g, liveEffCutHz);
            line(lx, g.gy, lx, g.gb, [1, 1, 1], 0.3, 1.0);
        }
    }

    // the point
    var hx = fFx(g, fc), hy = fFy(g, filterDb(ft, 1, q));
    var hv = hoverHdl === "filt" || (drag && drag.hdl === "filt");
    hollowSquare(hx, hy, hv ? 4.2 : 3.2, liveCol("live_display_handle_one"), 1.3);
    zone("hdl", hx - 7, hy - 7, 14, 14, { id: "filt", cx: hx, cy: hy });

    text("20", g.gx + 1, g.gb - 2.5, 6.0, RC.dim, false, 0);
    text("1k", fFx(g, 1000) + 2, g.gb - 2.5, 6.0, RC.dim, false, 0);
    text("20k", g.gx + g.gw - 1, g.gb - 2.5, 6.0, RC.dim, false, 2);

    var hot = hv || hoverKey === "filt_cutoff";
    text("Cut", sx + 9, 115, 7.5, RC.sub, false, 0);
    text(fmtParam("filt_cutoff", fc), sx + 25, 115, 7.5, hot ? RC.white : acc, hot, 0);
    text("Res", sx + 74, 115, 7.5, RC.sub, false, 0);
    text(Math.round(res) + "%", sx + 90, 115, 7.5, hot ? RC.white : acc, hot, 0);
    var fe = Math.round(paramValue("filt_env_amt"));
    text("Env " + (fe > 0 ? "+" : "") + fe, sx + FILT_W - 8, 115, 7.5, RC.sub, false, 2);

    rKnob("filt_drive", sx + 34, 142, 8, "Drive", acc, { mod: null });
    if (on && filtDots.length) text(filtDots.length + (filtDots.length > 1 ? " voices" : " voice") + " · " + fmtHz(filtDots[0].hz), sx + FILT_W - 8, 146, 7.5, RC.a_mod, false, 2);
    else text(on ? "no notes playing" : "filter off", sx + FILT_W - 8, 146, 7.5, RC.dim, false, 2);
}

function fmtHz(hz) { return hz >= 1000 ? (hz / 1000).toFixed(1) + "k" : Math.round(hz) + "Hz"; }

// ---------------------------------------------------------------------------
// Engine section: engine pills, character, the engine's knobs, Pitch / Speed / Pos
// ---------------------------------------------------------------------------

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


var PILL_W = { 0: 40, 3: 42, 1: 36, 2: 42, 4: 46 };

function paintEngineStrip() {
    var x = STRIP.x, y = STRIP.y, w = STRIP.w, acc = RC.cyan;
    panelBox(x, y, w, STRIP.h);
    // left: the engine selector above Pitch / Speed / Pos (+ Freeze)
    var px = x + 6;
    for (var e = 0; e < ENGINE_ORDER.length; e++) {
        var m = ENGINE_ORDER[e], pw = PILL_W[m], on = curMode === m;
        fillRR(px, y + 2, pw, 12, 3, on ? RC.sel : RC.raised, 1);
        text(MODE_NAMES[m], px + pw * 0.5, y + 11, 7.5, on ? RC.dark : RC.sub, on, 1);
        zone("button", px, y + 2, pw, 12, { action: "engine", engine: m });
        px += pw + 3;
    }
    var ky = y + 39;
    var scanOn = curMode !== 0;
    var ks = [["pitch_st", "Pitch", {}], ["grain_motion", "Speed", { dim: !scanOn }], ["play_pos", "Pos", { dim: !curFreeze }]];
    for (var p = 0; p < 3; p++) rKnob(ks[p][0], x + 6 + 36 + p * 72, ky, 7, ks[p][1], acc, ks[p][2]);
    // Freeze (Pos follows the frozen playhead)
    fillRR(x + 224, y + 22, 22, 18, 3, curFreeze ? RC.sel : RC.raised, 1);
    iconSnow(x + 235, y + 31, curFreeze ? RC.dark : RC.sub, 1.0);
    zone("button", x + 224, y + 22, 22, 18, { action: "freeze" });
    line(x + 250, y + 6, x + 250, y + STRIP.h - 5, RC.line, 1.0, 1.0);

    // right: the character switch directly above the knobs it controls
    var rx0 = x + 256;
    var L = engineLayout();
    var nk = L.knobs.length;
    if (L.head) {
        var hw = Math.min(nk * 68 - 14, L.head.labels.length * 48);
        segCtl(L.head.key, rx0 + 12, y + 2, hw, 12, L.head.labels, acc);
    } else {
        text(L.title, rx0 + 2, y + 14, 8.5, RC.text, false, 0);
    }
    for (var i = 0; i < nk; i++) {
        var cx = rx0 + 26 + i * 68;
        var k = L.knobs[i];
        if (k.menu) {
            var q = Math.round(paramValue("sp_quant"));
            text("Quant", cx, ky - 11, 7.5, RC.text, false, 1);
            fillRR(cx - 15, ky - 7, 30, 14, 3, RC.raised);
            text(["Off", "Oct", "Key"][q], cx - 3, ky + 3.5, 7.5, RC.text, false, 1);
            caret(cx + 9, ky - 2, RC.sub);
            zone("button", cx - 15, ky - 7, 30, 14, { action: "menu", key: "sp_quant", mw: 80 });
        } else {
            rKnob(k.key, cx, ky, 7, k.label, acc, k.opts || {});
        }
    }
}

// ---------------------------------------------------------------------------
// Engine settings section (what the Reactive drawer's ENGINE tab held)
// ---------------------------------------------------------------------------

var DR = { pitch: 13.6 };

function dlabel(label, x, y, c) { text(label, x, y + 8.5, 8.0, c || RC.sub, false, 0); }

function paintDetailsSection(sx) {
    var w = SECTIONS[0].w, acc = RC.a_eng;
    panelBox(sx, SEC_Y, w, SEC_H);
    var x0 = sx + 9, x1 = sx + w - 9, p = DR.pitch;
    var y = 20;
    secTitle(MODE_NAMES[curMode].toUpperCase() + " DETAIL", x0, 14, acc);
    var ch;
    if (curMode === 0) {
        ch = Math.round(paramValue("rp_char"));
        dlabel("Character", x0, y); segCtl("rp_char", x1 - 100, y - 1, 100, 12, ["Clean", "Analog", "Digital"], acc); y += p + 2;
        dlabel("Imaging", x0, y, ch === 2 ? RC.sub : RC.dim); switchCtl("rp_imaging", x1 - 20, y, acc, ch !== 2); y += p;
        dlabel("Variable sample rate", x0, y, ch === 2 ? RC.sub : RC.dim); switchCtl("rp_vsr", x1 - 20, y, acc, ch !== 2); y += p + 4;
        dlabel(ch === 1 ? "Crunch / Tape on the strip" : (ch === 2 ? "Bits / Color on the strip" : "Clean: no character"), x0, y, RC.dim);
        y += p + 6;
        text("Imaging and VSR belong to the", x0, y + 8, 7.0, RC.dim, false, 0); y += 10;
        text("Digital character.", x0, y + 8, 7.0, RC.dim, false, 0);
    } else if (curMode === 3) {
        ch = Math.round(paramValue("sp_char"));
        dlabel("Character", x0, y); segCtl("sp_char", x1 - 80, y - 1, 80, 12, ["Pure", "Reharm"], acc); y += p;
        dlabel("Quantize", x0, y, ch === 1 ? RC.sub : RC.dim); segCtl("sp_quant", x1 - 100, y - 1, 100, 12, ["Off", "Octaves", "Key"], acc, ch !== 1); y += p;
        dlabel("Onsets", x0, y); switchCtl("sp_onsets", x1 - 20, y, acc); y += p;
        dlabel("Formant correction", x0, y); switchCtl("sp_formant_on", x1 - 20, y, acc); y += p;
        dlabel("Phase dispersion", x0, y);
        valuePill(x1 - 50, y - 1, 50, fmtParam("sp_dispersion", paramValue("sp_dispersion")), { key: "sp_dispersion", norm: true }, acc); y += p;
        dlabel("Quality", x0, y); segCtl("sp_quality", x1 - 100, y - 1, 100, 12, ["Low", "Medium", "High"], acc); y += p;
        dlabel("Live performance", x0, y); switchCtl("sp_live", x1 - 20, y, acc); y += p;
        dlabel("Relative formants", x0, y); switchCtl("sp_rel_formant", x1 - 20, y, acc); y += p;
        dlabel("Key", x0, y); menuPill("sp_key", x0 + 24, y - 1, 40, fmtParam("sp_key", paramValue("sp_key")), acc, 52);
        segCtl("sp_scale", x1 - 66, y - 1, 66, 12, ["Major", "Minor"], acc);
    } else if (curMode === 1) {
        dlabel("Character", x0, y); segCtl("cy_char", x1 - 100, y - 1, 100, 12, ["Pulse", "Partials", "Phase"], acc); y += p + 2;
        dlabel("Cycle crossfade", x0, y); switchCtl("cy_xfade", x1 - 20, y, acc); y += p + 6;
        text("Formant and the character", x0, y + 8, 7.0, RC.dim, false, 0); y += 10;
        text("controls sit in the Engine", x0, y + 8, 7.0, RC.dim, false, 0); y += 10;
        text("section. Speed keeps the sample's", x0, y + 8, 7.0, RC.dim, false, 0); y += 10;
        text("timing: pitch follows the key.", x0, y + 8, 7.0, RC.dim, false, 0);
    } else if (curMode === 2) {
        text("Size and Spray are in the Engine", x0, y + 8, 7.5, RC.sub, false, 0); y += 14;
        text("section. Speed scans the cloud;", x0, y + 8, 7.5, RC.dim, false, 0); y += 11;
        text("Freeze + Pos hold it.", x0, y + 8, 7.5, RC.dim, false, 0);
    } else {
        dlabel("Direction", x0, y); y += p - 1;
        segCtl("fr_direction", x0, y - 1, x1 - x0, 12, ["Sample", "Playhead", "Random", "Alt."], acc); y += p;
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

// ---------------------------------------------------------------------------
// LFO / Mod section: LFO scope, its destinations, the Mod envelope's destinations
// ---------------------------------------------------------------------------

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


function paintLfoSection(sx) {
    var w = SECTIONS[3].w, acc = RC.cyan;
    panelBox(sx, SEC_Y, w, SEC_H);
    secTitle("LFO", sx + 7, 15, RC.text);
    var shp = Math.round(paramValue("lfo_shape"));
    for (var s = 0; s < 4; s++) {
        var gx = sx + 32 + s * 17;
        var on = shp === s;
        fillRR(gx, 7, 15, 11, 2.5, on ? RC.sel : RC.raised, 1);
        lfoGlyph(s, gx + 2.5, 8.5, 10, 8, on ? RC.dark : RC.sub, 1.0);
        zone("button", gx, 7, 15, 11, { action: "menu_pick", key: "lfo_shape", value: s });
    }
    var bx = sx + 6, by = 22, bw = 90, bh = 34;
    fillRR(bx, by, bw, bh, 2, RC.wave);
    cornerBrackets(bx, by, bw, bh, acc);
    var cy = by + bh * 0.5;
    line(bx + 2, cy, bx + bw - 2, cy, RC.line, 1.0, 1.0);
    var dest = Math.abs(paramValue("lfo_pitch")) + Math.abs(paramValue("lfo_filt")) + Math.abs(paramValue("lfo_pos"));
    var al = dest > 0.5 ? 1.0 : 0.55;
    var amp = bh * 0.4;
    if (shp < 3) {
        setc(acc, 0.6 * al);
        mgraphics.set_line_width(1.2);
        for (var i = 0; i <= 40; i++) {
            var p = i / 40;
            var px = bx + 4 + p * (bw - 8), py = cy - lfoShapeAt(shp, p) * amp;
            if (i === 0) mgraphics.move_to(px, py); else mgraphics.line_to(px, py);
        }
        mgraphics.stroke();
        var dx = bx + 4 + lfoPhaseEst * (bw - 8), dy = cy - clamp01((liveLfoVal + 1) * 0.5) * 2 * amp + amp;
        line(dx, by + 3, dx, by + bh - 3, acc, 0.3, 1.0);
        circle(dx, dy, 2.4, [1, 1, 1], 1.0);
    } else {
        setc(acc, 0.9 * al);
        mgraphics.set_line_width(1.2);
        var m = lfoHist.length, prevY = 0;
        for (var h = 0; h < m; h++) {
            var hx = bx + 4 + (h / 39) * (bw - 8), hy = cy - lfoHist[h] * amp;
            if (h === 0) mgraphics.move_to(hx, hy); else { mgraphics.line_to(hx, prevY); mgraphics.line_to(hx, hy); }
            prevY = hy;
        }
        mgraphics.stroke();
        if (m > 0) circle(bx + 4 + ((m - 1) / 39) * (bw - 8), cy - lfoHist[m - 1] * amp, 2.4, [1, 1, 1], 1.0);
    }
    rKnob("lfo_rate", sx + 122, 44, 7, "Rate", acc, {});
    var dd = [["lfo_pitch", "Pitch"], ["lfo_filt", "Filter"], ["lfo_pos", "Pos"]];
    for (var d = 0; d < 3; d++) rKnob(dd[d][0], sx + 6 + (w - 12) * (d + 0.5) / 3, 89, 7, dd[d][1], acc, { live: { val: liveLfoVal, acc: [1, 1, 1] } });
    line(sx + 7, 112, sx + w - 7, 112, RC.line, 1.0, 1.0);
    secTitle("MOD ENV  →", sx + 7, 123, RC.text);
    var md = [["menv_pitch", "Pitch"], ["filt_env_amt", "Filter"], ["menv_pos", "Pos"]];
    for (var j = 0; j < 3; j++) rKnob(md[j][0], sx + 6 + (w - 12) * (j + 0.5) / 3, 148, 7, md[j][1], acc, { live: { val: clamp01(liveModEnvVal) * 2 - 1, acc: [1, 1, 1] } });
}

// ---------------------------------------------------------------------------
// Voice / Out section
// ---------------------------------------------------------------------------

function paintVoiceSection(sx) {
    var w = SECTIONS[4].w, acc = RC.cyan;
    panelBox(sx, SEC_Y, w, SEC_H);
    secTitle("VOICING", sx + 7, 15, RC.text);
    segCtl("mono_legato", sx + 7, 20, w - 14, 13, ["Poly", "Mono"], acc);
    var ks1 = [["poly_voices", "Poly"], ["unison_voices", "Unison"], ["unison_detune", "Detune"]];
    var ks2 = [["unison_width", "Width"], ["glide_ms", "Glide"], ["vel_sens", "Vel"]];
    for (var i = 0; i < 3; i++) rKnob(ks1[i][0], sx + 6 + (w - 12) * (i + 0.5) / 3, 58, 7, ks1[i][1], acc, {});
    for (var j = 0; j < 3; j++) rKnob(ks2[j][0], sx + 6 + (w - 12) * (j + 0.5) / 3, 100, 7, ks2[j][1], acc, {});
    line(sx + 7, 120, sx + w - 7, 120, RC.line, 1.0, 1.0);
    secTitle("OUT", sx + 7, 130, RC.text);
    rKnob("out_gain", sx + 34, 146, 7, "", acc, {});
    var my = 126;
    var L = [livePeakL, livePeakR];
    for (var m = 0; m < 2; m++) {
        var mx = sx + w - 38 + m * 9;
        fillRR(mx, my, 6, 36, 1.5, RC.track);
        var hh = clamp01(L[m]) * 36;
        if (hh > 0.5) fillRR(mx, my + 36 - hh, 6, hh, 1.5, L[m] > 0.9 ? RC.orange : acc, 0.95);
    }
}

// ---------------------------------------------------------------------------
// paint
// ---------------------------------------------------------------------------

function paint() {
    initTheme();
    var sz = mgraphics.size;
    hitZones = [];
    fillRect(0, 0, sz[0], sz[1], RC.bg);
    paintSidebar();
    paintViewer();
    paintEngineStrip();
    var secs = sectionRects(foldMask);
    for (var i = 0; i < secs.length; i++) {
        var id = secs[i].id, sx = secs[i].x;
        if (id === "details") paintDetailsSection(sx);
        else if (id === "env") paintEnvSection(sx);
        else if (id === "filter") paintFilterSection(sx);
        else if (id === "lfo") paintLfoSection(sx);
        else paintVoiceSection(sx);
    }
    paintTip();
    paintMenu();
}

// ---------------------------------------------------------------------------
// State: the open sections ride along in the SamplerStateData blob as a trailing "R2", <mask> pair
// ---------------------------------------------------------------------------

var sharedGetvalueof = getvalueof;
var sharedSetvalueof = setvalueof;

getvalueof = function () {
    var out = sharedGetvalueof();
    out.push("R2");
    out.push(foldMask);
    return out;
};

setvalueof = function () {
    var a = arrayfromargs(arguments);
    if (a && a.length >= 3 && String(a[a.length - 2]) === "R2") {
        var m = Math.round(Number(a[a.length - 1]));
        a = a.slice(0, a.length - 2);
        if (isFinite(m)) {
            foldMask = Math.max(0, Math.min((1 << SECTIONS.length) - 1, m));
            applyDeviceWidth();
        }
    }
    sharedSetvalueof.apply(null, a);
};

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


// slope from the dragged level of a segment's midpoint: the curve there is bend(base, s) = base^(4^-s)
function slopeFromMid(level, base) {
    level = Math.max(0.004, Math.min(0.996, level));
    base = Math.max(0.004, Math.min(0.996, base));
    var g = Math.log(level) / Math.log(base);
    return Math.max(-1, Math.min(1, -Math.log(g) / Math.log(4)));
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
    var lvl = clamp01((e.gb - gy) / (e.gb - e.gy));
    if (which === "A") setIfChanged(k[0], fromNorm(k[0], (gx - e.gx - e.minSeg) / e.sm));
    else if (which === "D") {
        setIfChanged(k[1], fromNorm(k[1], (gx - e.xA - e.minSeg) / e.sm));
        setIfChanged(k[2], lvl * 100);
    }
    else if (which === "R") setIfChanged(k[3], fromNorm(k[3], (gx - e.xS - e.minSeg) / e.sm));
    else if (which === "As") setIfChanged(e.slopeKeys[0], slopeFromMid(lvl, 0.5) * 100);
    else if (which === "Ds") setIfChanged(e.slopeKeys[1], slopeFromMid((lvl - e.sus) / Math.max(0.12, 1 - e.sus), Math.pow(0.5, ENV_POW)) * 100);
    else if (which === "Rs") setIfChanged(e.slopeKeys[2], slopeFromMid(lvl / Math.max(0.12, e.sus), Math.pow(0.5, ENV_POW)) * 100);
}

// Right-click: Max 9's v8ui passes a PointerEvent as the 9th argument (buttons & 2); ctrl-click (8th argument) is the fallback
// because Live may keep the real right-click for its own context menu.
function isRightClick(ctrl, ev) {
    if (ctrl && Number(ctrl) !== 0) return true;
    return !!(ev && (((ev.buttons | 0) & 2) || ev.button === 2));
}

onclick = function (x, y, but, cmd, shift, capslock, option, ctrl, ev) {
    var z = zoneAt(x, y);
    panState = null;                                          // a stale pan (release not delivered) must not hijack this gesture
    if (inWaveRect(x, y) && z && (z.kind === "wave" || z.kind === "flag" || z.kind === "xfade" || z.kind === "loop_move") && isPanGesture(option, ev, cmd)) {
        if (openMenu) { openMenu = null; mgraphics.redraw(); return; }
        drag = null;
        panState = { x: x, x0: viewX0 };
        return;
    }
    if (z && z.key === "samp_gain" && z.kind === "value" && isRightClick(ctrl, ev)) {
        if (openMenu) openMenu = null;
        drag = null;
        normalizeSample();
        return;
    }
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
    if (z && z.kind === "wave" && viewZoom > 1.0005) {
        // the shared handler measures its grab distance in zone pixels: give it the zoomed width for this one call
        var w0 = z.w; z.w = w0 * viewZoom;
        try { sharedOnclick(x, y, but, cmd, shift, capslock, option, ctrl, ev); } finally { z.w = w0; }
        return;
    }
    sharedOnclick(x, y, but, cmd, shift, capslock, option, ctrl, ev);
};

function onwheel(x, y) {
    var d = parseWheelDelta(Array.prototype.slice.call(arguments));
    if (d[1] !== 0 && inWaveRect(x, y)) zoomViewAt(x, wheelZoomFactor(d[1]));
}

ondrag = function (x, y, but, cmd, shift) {
    if (panState) {
        if (!but) { panState = null; return; }
        viewX0 = panState.x0;
        panViewBy(x - panState.x);
        return;
    }
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
    if (z && z.kind === "wave" && viewZoom > 1.0005) { resetView(); return; }     // empty waveform space resets the view
    if (z && z.kind === "hdl") {
        if (z.id === "filt") { setParamFromFace("filt_cutoff", paramSpec("filt_cutoff").init); setParamFromFace("filt_res", paramSpec("filt_res").init); }
        else {
            var w4 = z.id.substring(4);
            if (w4 === "As" || w4 === "Ds" || w4 === "Rs") { var sk2 = envSlopeKeys(), si = { As: 0, Ds: 1, Rs: 2 }[w4]; setParamFromFace(sk2[si], 0); }
            else {
                var k = envKeys(), idx = { A: 0, D: 1, R: 3 }[w4];
                setParamFromFace(k[idx], paramSpec(k[idx]).init);
                if (idx === 1) setParamFromFace(k[2], paramSpec(k[2]).init);   // the D handle also carries sustain
            }
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
    var tip = (z && z.kind === "act" && z.tip) ? { tip: z.tip, index: z.index } : null;
    var gh = !!(z && z.key === "samp_gain");
    if (gh !== gainHover) { gainHover = gh; mgraphics.redraw(); }
    var tipChanged = (tip ? tip.index : -1) !== (hoverTip ? hoverTip.index : -1);
    hoverTip = tip;
    if (h !== hoverHdl || tipChanged) { hoverHdl = h; mgraphics.redraw(); }
    sharedOnidle(x, y);
};

onidleout = function () {
    if (gainHover) { gainHover = false; mgraphics.redraw(); }
    if ((hoverHdl && !(drag && drag.hdl)) || hoverTip) { hoverHdl = ""; hoverTip = null; mgraphics.redraw(); }
    sharedOnidleout();
};

// ---------------------------------------------------------------------------
// Preview hook (scripts/render_preview.py calls preview() before paint): demo state from the environment
//   SAMPLER_PREVIEW='{"mode":3,"sliced":0,"fold":63,"env":0,"dyn":1,"playing":1,"set":{"filt_cutoff":900}}'
// "fold" is the section bit mask (default: Envelope only); "playing" adds several voices in different stages.
// ---------------------------------------------------------------------------

function preview() {
    var o = {};
    try { if (typeof process !== "undefined" && process.env && process.env.SAMPLER_PREVIEW) o = JSON.parse(process.env.SAMPLER_PREVIEW); } catch (_) {}
    if (o.theme === "swap") {       // a Live theme whose desktop is the lighter grey-blue and whose surface is close to the LCD
        LIVE_FALLBACK.live_desktop = [0.30, 0.31, 0.34]; LIVE_FALLBACK.live_surface_bg = [0.15, 0.15, 0.16];
        RC = null;
    }
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
    storeParam("dec_ms", 900, true);
    storeParam("sus_lvl", 35, true);
    storeParam("rel_ms", 1200, true);
    storeParam("matk_ms", 60, true);
    storeParam("mdec_ms", 900, true);
    storeParam("msus_lvl", 30, true);
    storeParam("mrel_ms", 400, true);
    storeParam("unison_voices", 3, true);
    storeParam("loop_mode", o.loop === undefined ? 1 : o.loop, true);
    storeParam("atk_slope", 35, true); storeParam("dec_slope", -40, true); storeParam("rel_slope", 25, true);
    storeParam("matk_slope", -20, true); storeParam("mdec_slope", 30, true);
    var set = o.set || {};
    for (var k in set) storeParam(k, set[k], true);
    if (o.dyn) {
        pitchCurve = new Float32Array(PITCH_POINTS);
        pitchVoiced = new Uint8Array(PITCH_POINTS);
        for (var j = 0; j < PITCH_POINTS; j++) { pitchCurve[j] = 66 + 3 * Math.sin(j / 400) + (j > 2500 ? -2 : 0); pitchVoiced[j] = j % 900 < 760 ? 1 : 0; }
    }
    livePeakL = 0.55; livePeakR = 0.48;
    liveLfoVal = Math.sin(6.28318 * 0.62); lfoPhaseEst = 0.62;
    liveModEnvVal = 0.55;
    liveEffCutHz = 3100;
    if (o.playing) {
        // five voices: sustain, decay, attack (the newest), release from a lower level, and a second sustain
        var demo = [
            { amp: 3.0, al: 0.62, mod: 3.0, ml: 0.30, cut: 1650, ph: 0.30, born: 1 },
            { amp: 2.48, al: 0.78, mod: 2.30, ml: 0.62, cut: 3300, ph: 0.34, born: 2 },
            { amp: 4.40, al: 0.35, mod: 4.50, ml: 0.18, cut: 1900, ph: 0.41, born: 3 },
            { amp: 3.0, al: 0.62, mod: 2.9, ml: 0.34, cut: 1800, ph: 0.47, born: 4 },
            { amp: 1.45, al: 0.45, mod: 1.30, ml: 0.28, cut: 4300, ph: 0.52, born: 5 }
        ];
        liveActiveVoices = demo.length;
        for (var d = 0; d < demo.length; d++) {
            voiceAmpStg[d] = demo[d].amp; voiceAmpLvl[d] = demo[d].al;
            voiceModStg[d] = demo[d].mod; voiceModLvl[d] = demo[d].ml;
            voiceCutHz[d] = demo[d].cut; voiceBorn[d] = demo[d].born;
            voicePlayheads[d] = demo[d].ph; voiceAmps[d] = demo[d].al;
        }
        bornSeq = demo.length;
    } else {
        liveActiveVoices = 3;
        voicePlayheads[0] = 0.32; voiceAmps[0] = 0.8;
        voicePlayheads[1] = 0.34; voiceAmps[1] = 0.5;
    }
    for (var g = 0; g < 9; g++) { grainPos[g] = 0.28 + g * 0.018; grainAmp[g] = 0.3 + 0.07 * g; }
    envPage = o.env || 0;
    envTab = o.tab || 0;
    if (o.zoom) { viewZoom = o.zoom; viewX0 = o.x0 || 0; clampView(); }
    foldMask = o.fold === undefined ? DEFAULT_FOLD : o.fold;
    showInspector = foldMask ? 1 : 0;
    if (o.hover) hoverKey = o.hover;
}
