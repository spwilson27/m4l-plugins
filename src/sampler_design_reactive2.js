// Better Sampler, design "reactive2": the Reactive face with a left sidebar of folding sections, a tall sample viewer and
// Bitwig-style traced envelopes / per-voice filter modulation.
//
// Appended after sampler_config.js + sampler_ui.js + sampler_face.js (see AGENTS.md section 14, "Design variants").
// It reuses the shared state, helpers (text / fillRR / strokeArc / zone / ...), the shared zone kinds
// (knob, value, button, wave, flag, xfade, loop_move, menu) and their handlers, and adds two zone kinds:
//   "hdl"  a draggable graph handle (envelope breakpoints, filter cutoff / resonance point)
//   "act"  a button with its own callback (sidebar toggles, drawer-less tabs)
//
// Layout (default 766 px = sidebar + viewer + the Mod Sources section; everything open = 1496 px):
//   x   3..25   sidebar: 5 icon toggles (Engine detail, Mod Sources, Filter, Mod Matrix, Voice / Out)
//   x  29..495  sample viewer, 466 px wide (= Better Sampler's MAIN.sample width): header row, waveform, footer row (y 3..110)
//               and, fixed directly under it (y 113..166), the engine strip: engine pills, character switch, the engine's
//               knobs and Pitch / Speed / Pos (never folds away)
//   x 499..     open sections, left to right in sidebar order, 4 px apart, each 163 px high
// Which sections are open is a bit mask (bit i = SECTIONS[i]); it is saved in the SamplerStateData blob as a trailing
// "R2", <mask> pair and sets the device width with outlet(0, "setwidth_cmd", w). show_inspector mirrors "anything open".

var oscTab = 0;                             // 0 = Osc 1, 1 = Osc 2, 2 = Sub

var SECTIONS = [
    { id: "details", name: "Engine detail", w: 164, acc: "a_eng" },
    { id: "env", name: "Mod Sources", w: 264, acc: "a_amp" },
    { id: "filter", name: "Filter", w: 235, acc: "a_filt" },
    { id: "matrix", name: "Mod Matrix", w: 252, acc: "a_lfo" },
    { id: "voice", name: "Voice / Out", w: 132, acc: "a_out" }
];
var SB_X = 2, SB_W = 22;
var VIEW = { x: 26, y: 0, w: 466, h: 107 };
var STRIP = { x: 26, y: 108, w: 466, h: 61 };
var SEC_X0 = 493, SEC_GAP = 1, WIN_PAD = 1, SEC_Y = 0, SEC_H = 169;
var DEFAULT_FOLD = 2;                       // Mod Sources open
var foldMask = DEFAULT_FOLD;
var sectionOrder = [0, 1, 2, 3, 4];         // Sidebar top-to-bottom & panel left-to-right order of SECTIONS[0..4]
var sbDrag = null;                          // Active drag-to-reorder state on the sidebar buttons
var hoverHdl = "";
var hoverTip = null;
var RC = null;
var envX = SEC_X0, filtX = SEC_X0, matX = SEC_X0; // x of the Mod Sources / Filter / Matrix section in the current layout

function isDefaultSectionOrder() {
    for (var i = 0; i < SECTIONS.length; i++) if (sectionOrder[i] !== i) return false;
    return true;
}
function encodeSectionOrder() {
    var code = 0;
    for (var i = 0; i < SECTIONS.length; i++) code = code * 10 + (sectionOrder[i] | 0);
    return code;
}
function decodeSectionOrder(code) {
    var s = String(Math.max(0, Math.round(Number(code) || 0)));
    while (s.length < SECTIONS.length) s = "0" + s;
    if (s.length !== SECTIONS.length) return false;
    var seen = {}, next = [];
    for (var i = 0; i < SECTIONS.length; i++) {
        var d = s.charCodeAt(i) - 48;
        if (d < 0 || d >= SECTIONS.length || seen[d]) return false;
        seen[d] = true;
        next.push(d);
    }
    sectionOrder = next;
    return true;
}
function setSectionOrder(arr) {
    if (!arr || arr.length !== SECTIONS.length) return false;
    var seen = {}, next = [];
    for (var i = 0; i < SECTIONS.length; i++) {
        var d = Math.round(Number(arr[i]));
        if (d < 0 || d >= SECTIONS.length || seen[d]) return false;
        seen[d] = true;
        next.push(d);
    }
    sectionOrder = next;
    notifyclients();
    mgraphics.redraw();
    return true;
}

function sectionRects(mask) {
    var out = [], x = SEC_X0;
    for (var pos = 0; pos < sectionOrder.length; pos++) {
        var i = sectionOrder[pos];
        if (!((mask >> i) & 1)) continue;
        out.push({ id: SECTIONS[i].id, index: i, slot: pos, x: x, w: SECTIONS[i].w });
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
function dbg_fold(m) { setFoldMask(Number(m)); }
function dbg_osctab(t) { oscTab = Number(t) || 0; mgraphics.redraw(); }
function dbg_menu(key, ax, ay, w) {
    if (!key || key === "none") openMenu = null;
    else openMenu = { key: String(key), x: Number(ax) || 0, y: Number(ay) || 15, w: Number(w) || 30, rowH: 12 };
    mgraphics.redraw();
}
function dbg_focus(n) { filtFocus = Number(n); mgraphics.redraw(); }

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
    live_desktop: [0.165, 0.165, 0.165], live_surface_bg: [0.212, 0.212, 0.212], live_surface_frame: [0.141, 0.141, 0.141],
    live_macro_title: [0.263, 0.271, 0.314],
    live_lcd_bg: [0.094, 0.094, 0.094], live_lcd_frame: [0.243, 0.243, 0.243], live_lcd_title: [0.71, 0.71, 0.71],
    live_lcd_control_fg_zombie: [0.525, 0.525, 0.525],
    live_control_bg: [0.118, 0.118, 0.118], live_control_fg: [0.71, 0.71, 0.71], live_control_text_bg: [0.133, 0.141, 0.176],
    live_contrast_frame: [0.059, 0.067, 0.090],
    live_dial_fg: [0.059, 0.067, 0.090], live_dial_fg_zombie: [0.165, 0.165, 0.165],
    live_dial_needle: [0.094, 0.094, 0.094], live_dial_needle_zombie: [0.165, 0.165, 0.165],
    live_control_fg_zombie: [0.459, 0.459, 0.459],
    live_control_selection: [1.0, 0.678, 0.337], live_control_zombie: [0.459, 0.459, 0.459],
    live_display_line_one: [1.0, 0.678, 0.337], live_display_line_two: [0.012, 0.765, 0.835],
    live_display_handle_one: [1.0, 0.678, 0.337], live_display_handle_two: [1.0, 0.412, 0.498],
    live_display_scale_text: [0.525, 0.525, 0.525], live_alert: [0.906, 0.412, 0.259]
};
function liveCol(name) { return themeCol([name], LIVE_FALLBACK[name]); }

function initTheme() {
    faceFont = "Ableton Sans Medium";
    faceFontBold = "Ableton Sans Bold";
    if (RC) return;
    var desk = liveCol("live_desktop"), surf = liveCol("live_surface_bg"), surfFrame = liveCol("live_macro_title"), lcd = liveCol("live_lcd_bg"), frame = liveCol("live_lcd_frame");
    var ctlBg = liveCol("live_control_bg"), ctlFg = liveCol("live_control_fg"), sel = liveCol("live_control_selection");
    var cyan = liveCol("live_display_line_two"), orange = liveCol("live_display_handle_one"), pink = liveCol("live_display_handle_two");
    var scale = liveCol("live_display_scale_text"), zombie = liveCol("live_control_zombie"), lcdTitle = liveCol("live_lcd_title");
    var surfHi = lumi(surf) >= lumi(desk) ? surf : desk;
    var surfLo = lumi(surf) >= lumi(desk) ? desk : surf;
    RC = {
        light: lumi(desk) > 0.5,
        bg: frame, panel: surfHi, divider: surfLo, raised: ctlBg, wave: lcd, line: frame,
        wtBorder: frame,
        textBg: liveCol("live_control_text_bg"),
        contrastFrame: liveCol("live_contrast_frame"),
        dialFg: liveCol("live_dial_fg"), dialFgOff: liveCol("live_dial_fg_zombie"),
        dialNeedle: liveCol("live_dial_needle"), dialNeedleOff: liveCol("live_dial_needle_zombie"),
        arcOff: liveCol("live_control_fg_zombie"),
        lcdDim: liveCol("live_lcd_control_fg_zombie"),
        track: mixc(frame, ctlFg, 0.3),
        text: ctlFg, lcdText: lcdTitle, sub: scale, dim: zombie, knob: ctlBg, dark: mixc(lcd, [0, 0, 0], 0.4),
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
    fillRect(x, y, w, h, RC.panel, 1.0);
}

function secTitle(label, x, y, acc) {
    text(label, x, y, 7.5, acc, true, 0, 0.95);
}

function pill(x, y, w, h, label, on, acc, size) {
    fillRR(x, y, w, h, h * 0.5, on ? acc : RC.raised, on ? 0.9 : 1.0);
    text(label, x + w * 0.5, y + h * 0.5 + 3, size || 8.0, on ? RC.dark : RC.sub, on, 1);
}

// Segmented control over an enum (or any 0..n-1 value): each segment sets `key`
function segCtl(key, x, y, w, h, labels, acc, dimmed, fontSize) {
    var cur = Math.round(paramValue(key));
    var n = labels.length, sw = w / n;
    fillRR(x, y, w, h, 3, RC.raised, dimmed ? 0.5 : 1);
    for (var i = 0; i < n; i++) {
        var on = i === cur;
        if (on) fillRR(x + i * sw + 1, y + 1, sw - 2, h - 2, 2.5, RC.sel, dimmed ? 0.4 : 0.95);
        text(labels[i], x + i * sw + sw * 0.5, y + h * 0.5 + 3, fontSize || 7.5, on ? RC.dark : RC.sub, on, 1);
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

var SB_BTN = { h: 20, pitch: 25, y0: 6 };

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
    } else if (i === 1) {                         // mod sources / envelope: ADSR outline
        mgraphics.move_to(cx - 7.5, cy + 5); mgraphics.line_to(cx - 3.5, cy - 5.5); mgraphics.line_to(cx, cy - 1);
        mgraphics.line_to(cx + 3.5, cy - 1); mgraphics.line_to(cx + 7.5, cy + 5); mgraphics.stroke();
    } else if (i === 2) {                         // filter: low-pass response
        mgraphics.move_to(cx - 7.5, cy - 2); mgraphics.line_to(cx - 1, cy - 2); mgraphics.line_to(cx + 1, cy - 5);
        mgraphics.line_to(cx + 3, cy - 1); mgraphics.line_to(cx + 7.5, cy + 5); mgraphics.stroke();
    } else if (i === 3) {                         // mod matrix: 3x3 matrix grid
        for (var r = 0; r < 3; r++) for (j = 0; j < 3; j++) {
            var cellOn = (r === 0 && j === 1) || (r === 1 && j === 0) || (r === 2 && j === 2);
            fillRect(cx - 6.5 + j * 4.8, cy - 6.0 + r * 4.5, 3.4, 3.0, c, cellOn ? a : a * 0.42);
        }
    } else {                                      // voice / out: level bars
        var hs = [5, 9, 6.5];
        for (j = 0; j < 3; j++) fillRR(cx - 7 + j * 5.2, cy + 6 - hs[j] * 1.1, 3.6, hs[j] * 1.1, 1.2, c, a);
    }
}

function strokeRR(x, y, w, h, r, c, a, lw) {
    setc(c, a);
    mgraphics.set_line_width(lw || 1.0);
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
    mgraphics.stroke();
}

function paintSidebar() {
    panelBox(SB_X, SEC_Y, SB_W, SEC_H);
    var draggingSec = (sbDrag && sbDrag.moved) ? sbDrag.secIdx : -1;
    for (var slot = 0; slot < SECTIONS.length; slot++) {
        var secIdx = sectionOrder[slot];
        var y = SB_BTN.y0 + slot * SB_BTN.pitch;
        var on = ((foldMask >> secIdx) & 1) === 1;
        var hot = hoverTip && hoverTip.index === secIdx;
        if (secIdx === draggingSec) {
            // Draw insertion slot placeholder where the dragged button will land
            fillRR(SB_X + 2, y, SB_W - 4, SB_BTN.h, 4, RC.wave, 0.75);
            strokeRR(SB_X + 2.5, y + 0.5, SB_W - 5, SB_BTN.h - 1, 3.5, RC.sel, 0.85, 1.1);
        } else {
            fillRR(SB_X + 2, y, SB_W - 4, SB_BTN.h, 4, on ? RC.sel : (hot ? mixc(RC.raised, RC.cyan, 0.25) : RC.raised), on ? 0.95 : 1);
            sbGlyph(secIdx, SB_X + SB_W * 0.5, y + SB_BTN.h * 0.5, on ? RC.dark : (hot ? RC.cyan : RC.sub), 1.0);
        }
        (function (sIdx, slotIdx) {
            actZone(SB_X + 1, y - 1, SB_W - 2, SB_BTN.h + 2, function () { toggleSection(sIdx); }, {
                tip: SECTIONS[sIdx].name,
                index: sIdx,
                slot: slotIdx,
                secIdx: sIdx
            });
        })(secIdx, slot);
    }
    if (draggingSec >= 0) {
        var fy = Math.max(2, Math.min(SEC_H - SB_BTN.h - 2, sbDrag.curY - SB_BTN.h * 0.5));
        var dOn = ((foldMask >> draggingSec) & 1) === 1;
        fillRR(SB_X + 1.5, fy, SB_W - 3, SB_BTN.h, 4, dOn ? RC.sel : mixc(RC.raised, RC.sel, 0.28), 0.98);
        strokeRR(SB_X + 1.5, fy, SB_W - 3, SB_BTN.h, 4, dOn ? RC.dark : RC.sel, 0.95, 1.2);
        sbGlyph(draggingSec, SB_X + SB_W * 0.5, fy + SB_BTN.h * 0.5, dOn ? RC.dark : RC.text, 1.0);
    }
}

function paintTip() {
    if (!hoverTip || (sbDrag && sbDrag.moved)) return;
    var w = textW(hoverTip.tip, 8.0) + 14;
    var slotIdx = hoverTip.slot !== undefined ? hoverTip.slot : hoverTip.index;
    var y = SB_BTN.y0 + slotIdx * SB_BTN.pitch + 3;
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

// Active oscillator descriptor for Osc 1 (oscTab === 0) and Osc 2 (oscTab === 1)
function activeOsc() {
    var is2 = oscTab === 1;
    return {
        is2: is2,
        onKey: is2 ? "osc2_on" : "osc1_on",
        typeKey: is2 ? "osc2_type" : "osc1_type",
        modeKey: is2 ? "osc2_mode" : "mode",
        pitchKey: is2 ? "osc2_pitch" : "pitch_st",
        detKey: is2 ? "osc2_detune" : "fine_cents",
        ratioKey: is2 ? "osc2_ratio" : "osc1_ratio",
        posKey: is2 ? "osc2_pos" : "play_pos",
        gainKey: is2 ? "osc2_gain" : "samp_gain",
        fxKey: is2 ? "wt2_fx" : "wt1_fx",
        fx1Key: is2 ? "wt2_fx1" : "wt1_fx1",
        fx2Key: is2 ? "wt2_fx2" : "wt1_fx2"
    };
}

var sharedFmtParam = fmtParam;
fmtParam = function (key, v) {
    if (key === "fine_cents" || key === "osc2_detune" || key === "sub_fine") {
        var rng = Math.max(1.0, Math.min(96.0, Number(paramValue("fine_range")) || 1.0));
        var scaled = (Number(v) * 0.01) * rng;
        var sign = scaled > 0.005 ? "+" : "";
        return sign + (Math.abs(scaled) < 10 ? scaled.toFixed(2) : scaled.toFixed(1));
    }
    if (key === "osc1_ratio" || key === "osc2_ratio" || key === "sub_ratio") {
        var rv = Number(v) || 1.0;
        return (Math.abs(rv - Math.round(rv)) < 0.005 ? rv.toFixed(1) : rv.toFixed(2)) + "x";
    }
    if (key === "fine_range") {
        var fr = Math.max(1.0, Math.min(96.0, Number(v) || 1.0));
        return "\u00b1" + fr.toFixed(1);
    }
    return sharedFmtParam(key, v);
};


// Factory wavetables share Ableton Wavetable's categories and names (Live's Vector sprite waves,
// 1024 samples per frame). User is the loaded sample, and sample mode reads that same buffer.
var WT_FRAME = 1024;
var WT_CATS = ["Basics", "Collection", "Complex", "Distortion", "Filter", "Formant", "Harmonics", "Instrument", "Noise", "Retro", "Vintage", "User"];
var WT_TABLES = {
    "Basics": ["Basic Shapes","Harmonic Series","Sub 1","Sub 2","Sub 3","Saw Dual 1","Saw Dual 2","Saw Dual 3","Saw Harmonics","Saw PW Bass","Saw PW Detune","Quad Saw","Beating 1","Beating 2","Beating 3","Beating 4","Beating 5","Pulse PW","Pulse Dual","5th Brutal","Sync Additive","Sync Digital","Galactica","FM Feedback","FM Fold","FM Harmonics","No Primes","Primes","White Noise"],
    "Collection": ["Amber","Aureolin","Beige","Charcoal","Cobalt","Copper","Graphite","Olive","Pearl","Ruby","Rust","Sapphire","Slate","Squash","Violet"],
    "Complex": ["Bit Ring","Bitkart","Bitten Filter","Bitten Sync","Dubstep Organ","Kicked","Menace","Noise Manipulator","Octa Phase","Plastic Shimmer","Ring Mod","Ripped Sync","Transformations","Verbed","Void","Xmod Drive"],
    "Distortion": ["Brutal Metal","Clipped Sweep","DP Fold","Freak","JN60 Bitter","Malice","Phased","Westcost Fold","Wow"],
    "Filter": ["Acid Pulse","Acid Saw","Bit Sweep","Dark Throaty","Frequency FM","JUP Sweep","Modern Sweep 1","Modern Sweep 2","Nasal","Super Phased","Sweep 1","Sweep 2","Sweep 3","Sweep 4"],
    "Formant": ["AEIOU","AhOhOoh","Aligned Form","Crispy Form","Digital Ah","FOF","Gremlin","Harsh Vowel","Real Voice","Riser","Sparkle Form","Stepped Vowels","Tuvan","Unaligned Form","VOSM","Voice Harmonics","Yahie"],
    "Harmonics": ["Biharmonic Steps","Buzz Bell","Crispy Sines","Crystal Shifter","Shrinking Saws","Sines 1","Sines 2","Sines 3","Sines 4","Sines 5","Sines Bunch","Spectral 1","Spectral 2","Spectral 3","Squarrely","Strong Seventh","Synced Sines","Transistor Saw","Transistor Square","Vocal Sines"],
    "Instrument": ["Afrobeat","Beauty Vox","Bell","Digi Piano","Finger Off","Harmonica","Jazz Buzz","Marimba","Nylon Bass","Nylon Guitar","Oboe","Organ","Piano","Sarod","Sitar","Strings 1","Strings 2","Strings 3","Trombone"],
    "Noise": ["Applause","Bad Bits","Bitter","Broken Filter","Brown Noise","Crash","Dizzy","Formula 1","HP Noise","Helicopter","Junk 1","Junk 2","Modulated Kodiak","Pink Noise","Pouring Rain","Radio 1","Radio 2","Redux Noise","Swepdustry","Swept Noise","Vintage Noise","Vinyl Dirt Constant","Vinyl Dirt Soft"],
    "Retro": ["Echoes","Harmonics 1","Harmonics 2","Harmonics 3","Harmonics 4","Percusive Organ","Polated","Resonant 1","Resonant 2","Robotic","Sweep Pulse","Sweep Random","Sweep Saw 1","Sweep Saw 2","Wind Synth"],
    "Vintage": ["BS Sync","Brds Dual Saw","JN6 Double Saws","JUN Square Stack","JUP Double Pulse","JUP SawPulse","JX10 Sync","Logue Saw Dist","Logue Saw","MG Memo","Minifilter","Miniwaves","OB6 Shapes","Sloppy Saw","Sloppy Square","Sub3 Shapes","Sys8 Comb"],
    "User": []
};

var WT_USER = WT_CATS.length - 1;
var WT_DIRS = [
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Builtin/Samples/Vector/Sprites",
    "/Applications/Ableton Live 12 Beta.app/Contents/App-Resources/Builtin/Samples/Vector/Sprites",
    "/Applications/.Ableton Live 12 Suite_updated.app/Contents/App-Resources/Builtin/Samples/Vector/Sprites"
];
var wtSel = [{ cat: 0, idx: 0 }, { cat: 0, idx: 0 }];
var wtFrames = [0, 0];
var wtPreviewFrames = 0;
var wtUserFlag = [0, 0];
var wtLoadedPath = ["", ""];
var wtSendKey = "";
var wtWasReady = 0;
var wtSpriteRoot = "";

function wtTableNames(cat) {
    if (cat === WT_USER) return [hasLoadedSample ? sampleFileName : "Drop Sample"];
    var names = WT_TABLES[WT_CATS[cat]] || [];
    return names.length ? names : ["Empty"];
}

function wtCatLabel(i) { return WT_CATS[wtSel[i].cat] || "Basics"; }

function wtTableLabel(i) {
    var names = wtTableNames(wtSel[i].cat);
    var idx = Math.max(0, Math.min(names.length - 1, wtSel[i].idx | 0));
    return names[idx];
}

function wtSpriteDir() {
    if (wtSpriteRoot) return wtSpriteRoot;
    if (typeof Folder === "function") {
        for (var d = 0; d < WT_DIRS.length; d++) {
            try {
                var folder = new Folder(WT_DIRS[d]);
                var ok = folder && folder.end === false;
                if (folder && typeof folder.close === "function") folder.close();
                if (ok) { wtSpriteRoot = WT_DIRS[d]; return wtSpriteRoot; }
            } catch (eDir) {}
        }
        wtSpriteRoot = WT_DIRS[0];
        return wtSpriteRoot;
    }
    wtSpriteRoot = WT_DIRS[0];
    return wtSpriteRoot;
}

function wtFilePath(cat, idx) {
    if (cat === WT_USER) return "";
    var dir = wtSpriteDir();
    var name = (WT_TABLES[WT_CATS[cat]] || [])[idx];
    if (!dir || !name) return "";
    return dir + "/Vector_Sprite_" + WT_CATS[cat] + " " + name + ".wav";
}

function wtUserFrames() {
    var n = 0;
    if (sampBufName && typeof Buffer !== "undefined") {
        try { n = new Buffer(sampBufName).framecount() || 0; } catch (eUf) { n = 0; }
    }
    if (!n && sampleFrames) n = sampleFrames;
    return Math.max(0, Math.floor(n / WT_FRAME));
}

function wtProcedural(ph, pos01) {
    var p = ph - Math.floor(ph);
    var s2 = Math.sin(6.28318530718 * p);
    var tr2 = 1.0 - 4.0 * Math.abs(((p + 0.25) - Math.floor(p + 0.25)) - 0.5);
    var sw2 = 2.0 * p - 1.0;
    var sq2 = p < 0.5 ? 1.0 : -1.0;
    var posM = clamp01(pos01) * 3.0;
    if (posM <= 1) return s2 + (tr2 - s2) * posM;
    if (posM <= 2) return tr2 + (sw2 - tr2) * (posM - 1);
    return sw2 + (sq2 - sw2) * (posM - 2);
}

function wtPeekAt(buf, frame, phase) {
    var p = phase - Math.floor(phase);
    var idx = p * WT_FRAME;
    var i0 = Math.floor(idx);
    var frac = idx - i0;
    var i1 = i0 >= WT_FRAME - 1 ? 0 : i0 + 1;
    var base = frame * WT_FRAME;
    var a = buf.peek(1, base + i0, 1);
    var c = buf.peek(1, base + i1, 1);
    var av = (typeof a === "number") ? a : (a && a.length ? a[0] : 0);
    var cv = (typeof c === "number") ? c : (c && c.length ? c[0] : 0);
    return av + (cv - av) * frac;
}

function wtPeekCycle(bufName, ph, pos01, frames) {
    if (!bufName || typeof Buffer === "undefined" || !(frames >= 1)) return null;
    try {
        var b = new Buffer(bufName);
        var nF = Math.max(1, frames | 0);
        var fPos = clamp01(pos01) * Math.max(0, nF - 1);
        var f0 = Math.floor(fPos);
        var fr = fPos - f0;
        var f1 = Math.min(nF - 1, f0 + 1);
        var s0 = wtPeekAt(b, f0, ph);
        var s1 = wtPeekAt(b, f1, ph);
        return s0 + (s1 - s0) * fr;
    } catch (ePk) { return null; }
}

function wtDisplaySample(ph, pos01) {
    var i = oscTab === 1 ? 1 : 0;
    var user = wtSel[i].cat === WT_USER;
    var frames = user ? wtUserFrames() : wtFrames[i];
    var bufName = user ? sampBufName : (i ? "#0-bswt2" : "#0-bswt1");
    if (frames >= 1 && bufName) {
        var s = wtPeekCycle(bufName, ph, pos01, frames);
        if (s !== null && isFinite(s)) return s;
    }
    return wtProcedural(ph, pos01);
}

function wtSendAll() {
    var key = wtFrames[0] + ":" + wtUserFlag[0] + ":" + wtFrames[1] + ":" + wtUserFlag[1];
    if (key === wtSendKey) return;
    wtSendKey = key;
    if (typeof outlet !== "function") return;
    outlet(0, "wt_msg", "wt1_frames", wtFrames[0]);
    outlet(0, "wt_msg", "wt1_user", wtUserFlag[0]);
    outlet(0, "wt_msg", "wt2_frames", wtFrames[1]);
    outlet(0, "wt_msg", "wt2_user", wtUserFlag[1]);
}

function wtMaybeSend() {
    if (typeof dspReady !== "undefined" && dspReady && !wtWasReady) {
        wtWasReady = 1;
        wtSendKey = "";
        wtSendAll();
    }
    if (typeof dspReady !== "undefined" && !dspReady) wtWasReady = 0;
}

function wtPoll(i, n) {
    var name = i ? "#0-bswt2" : "#0-bswt1";
    var frames = 0;
    try { frames = Math.floor((new Buffer(name).framecount() || 0) / WT_FRAME); } catch (ePo) { frames = 0; }
    if (frames > 0 && wtLoadedPath[i]) {
        wtFrames[i] = frames;
        wtSendKey = "";
        wtSendAll();
        if (typeof mgraphics !== "undefined") mgraphics.redraw();
        return;
    }
    if (n > 25 || typeof Task !== "function") return;
    var task = new Task(function () { wtPoll(i, n + 1); });
    task.schedule(80);
}

function wtApplyOsc(i) {
    var sel = wtSel[i];
    if (sel.cat < 0) sel.cat = 0;
    if (sel.cat > WT_USER) sel.cat = WT_USER;
    var names = wtTableNames(sel.cat);
    if (sel.idx < 0 || sel.idx > names.length - 1) sel.idx = 0;
    if (sel.cat === WT_USER) {
        wtUserFlag[i] = 1;
        wtFrames[i] = 0;
        wtLoadedPath[i] = "";
    } else {
        wtUserFlag[i] = 0;
        var path = wtFilePath(sel.cat, sel.idx);
        if (path && path !== wtLoadedPath[i] && typeof hostPatcher !== "undefined" && hostPatcher) {
            var box = hostPatcher.getnamed(i ? "obj-buf-wt2" : "obj-buf-wt1");
            if (box && box.message) box.message("replace", path);
            wtLoadedPath[i] = path;
            wtFrames[i] = 0;
            wtPoll(i, 0);
        } else if (!path) {
            wtFrames[i] = 0;
            wtLoadedPath[i] = "";
        }
    }
    wtSendKey = "";
    wtSendAll();
}

function wtSelect(i, cat, idx) {
    wtSel[i].cat = cat;
    wtSel[i].idx = idx;
    wtApplyOsc(i);
    if (typeof notifyclients === "function") notifyclients();
}

function wtSelectUser(i) { wtSelect(i, WT_USER, 0); }

function wtSync() {
    wtMaybeSend();
    for (var i = 0; i < 2; i++) {
        var typeKey = i ? "osc2_type" : "osc1_type";
        var wtOn = Math.round(paramValue(typeKey)) > 0;
        if (!wtOn) continue;
        if (wtSel[i].cat === WT_USER) {
            if (!wtUserFlag[i]) wtApplyOsc(i);
        } else if (!wtLoadedPath[i] && typeof hostPatcher !== "undefined" && hostPatcher) {
            wtApplyOsc(i);
        }
    }
}

function wtPosFromY(y, top, h) {
    return clamp01(1 - (y - top) / Math.max(1, h)) * 100;
}

// Evaluate Wavetable sample with Fm / Classic / Modern wave effects (matches wt_osc_eval in sampler_core.genexpr)
function evalWtWave(ph, pos01, fxMode, fx1, fx2) {
    var p = ph - Math.floor(ph);
    var effP = p;
    var m = Math.round(Math.max(0, Math.min(3, fxMode || 0)));
    if (m === 1) {
        var modRatio = Math.pow(2.0, Math.max(-1, Math.min(1, fx1)) * 2.0);
        var mp = (p * modRatio) - Math.floor(p * modRatio);
        effP = p + Math.max(0, Math.min(1, fx2)) * 0.65 * Math.sin(6.28318530718 * mp);
        effP = effP - Math.floor(effP);
    } else if (m === 2) {
        var duty = Math.max(0.05, Math.min(0.95, 0.5 + 0.45 * Math.max(-1, Math.min(1, fx1))));
        var pPw = (p < duty) ? (0.5 * p / duty) : (0.5 + 0.5 * (p - duty) / (1.0 - duty));
        var syncR = 1.0 + Math.max(0, Math.min(1, fx2)) * 7.0;
        effP = (pPw * syncR) - Math.floor(pPw * syncR);
    } else if (m === 3) {
        var warpAmt = Math.max(-1, Math.min(1, fx1));
        if (Math.abs(warpAmt) > 0.0005) {
            effP = Math.pow(Math.max(0, Math.min(1, p)), Math.pow(3.0, -warpAmt));
        }
    }
    var val = wtDisplaySample(effP, pos01);
    if (m === 3) {
        var foldAmt = Math.max(0, Math.min(1, fx2));
        if (foldAmt > 0.0005) {
            val = Math.sin(1.57079632679 * val * (1.0 + foldAmt * 5.0));
        }
    }
    return val;
}

// First 64 harmonic magnitudes of one wavetable cycle. A unit sine is 1. This is a view of
// evalWtWave (position and the Fm / Classic / Modern effect), not an editor.
function wtHarmAmps(pos01, fxMode, fx1, fx2) {
    var N = 128, H = 64, amps = [], h, i;
    for (h = 1; h <= H; h++) {
        var re = 0, im = 0;
        for (i = 0; i < N; i++) {
            var p = i / N;
            var s = evalWtWave(p, pos01, fxMode, fx1, fx2);
            var ang = 6.28318530718 * h * p;
            re += s * Math.cos(ang);
            im += s * Math.sin(ang);
        }
        amps.push(Math.sqrt(re * re + im * im) * 2 / N);
    }
    return amps;
}

// How many frames the stack draws. A loaded table uses its real count; otherwise the
// procedural morph is the same four frames as wt_base (sine, triangle, saw, square).
function wtViewFrameCount() {
    if (wtPreviewFrames >= 2) return wtPreviewFrames | 0;
    var i = oscTab === 1 ? 1 : 0;
    var n = wtSel[i].cat === WT_USER ? wtUserFrames() : wtFrames[i];
    if (n >= 1) return n | 0;
    return 4;
}

// 64 harmonic bars, then a position slider, the wave, and the stereo scope.
function wtViewLayout() {
    var wx = viewWave[0], wy = viewWave[1], ww = viewWave[2], wh = viewWave[3];
    var harmW = 228, slideW = 26, gap = 4, barGap = 1;
    var barsX = wx + 2;
    var barsW = harmW - 4;
    var top = wy + 11, bot = wy + wh - 3;
    var slideX = wx + harmW + gap;
    var panelX = slideX + slideW + gap;
    var panelW = wx + ww - panelX;
    return {
        wx: wx, wy: wy, ww: ww, wh: wh,
        editorW: harmW,
        barsX: barsX, barsW: barsW, bw: (barsW - barGap * 63) / 64, barGap: barGap,
        top: top, bot: bot,
        slideX: slideX, slideW: slideW,
        panelX: panelX, panelW: panelW,
        scopeX: panelX, scopeW: panelW
    };
}

function paintWtHarmonics(L, on, amps) {
    var bh = L.bot - L.top;
    text("HARM", L.barsX, L.top - 2, 6.5, RC.sub, true, 0);
    for (var i = 0; i < 64; i++) {
        var bx = L.barsX + i * (L.bw + L.barGap);
        var mag = Math.max(0, Math.min(1, amps[i] || 0));
        var col = i === 0 ? RC.sel : RC.cyan;
        if (!on) col = RC.lcdDim;
        fillRect(bx, L.top, Math.max(1, L.bw), bh, RC.raised, on ? 0.45 : 0.18);
        var hgt = mag * bh;
        var bw = Math.max(0.8, L.bw - 0.6);
        if (hgt > 0.8) {
            fillRect(bx + 0.3, L.bot - hgt, bw, hgt, col, on ? 0.95 : 0.28);
            line(bx, L.bot - hgt, bx + L.bw, L.bot - hgt, i === 0 ? RC.sel : RC.white, on ? 0.85 : 0.28, 1);
        }
    }
}

// Helper: draw Oscillator Header Tabs ([■ Osc 1] [■ Osc 2] [■ Sub])
function paintOscHeaderTabs(tx, ty) {
    var o1On = Math.round(paramValue("osc1_on")) > 0;
    var o2On = Math.round(paramValue("osc2_on")) > 0;
    var subOn = Math.round(paramValue("sub_on")) > 0;
    var tabs = [
        { label: "Osc 1", idx: 0, enKey: "osc1_on", on: o1On, w: 38 },
        { label: "Osc 2", idx: 1, enKey: "osc2_on", on: o2On, w: 38 },
        { label: "Sub",   idx: 2, enKey: "sub_on",  on: subOn, w: 32 }
    ];
    var x = tx;
    for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i], active = oscTab === t.idx;
        if (active) line(x + 2, ty + 12.5, x + t.w - 2, ty + 12.5, RC.sel, 1.0, 1.3);
        var sqX = x + 3.0, sqY = ty + 3.5, sqS = 6.0;
        if (t.on) fillRect(sqX, sqY, sqS, sqS, RC.sel, 1.0);
        else { setc(RC.sel, 0.85); mgraphics.set_line_width(1.0); mgraphics.rectangle(sqX + 0.5, sqY + 0.5, sqS - 1, sqS - 1); mgraphics.stroke(); }
        zone("button", sqX - 1, ty, 8.5, 13, { action: "osc_toggle", key: t.enKey, tab: t.idx });
        text(t.label, x + 10.5, ty + 9.8, 8.2, active ? RC.sel : (t.on ? RC.lcdText : RC.sub), active, 0);
        zone("button", x + 8, ty, t.w - 8, 13, { action: "osc_tab", tab: t.idx });
        x += t.w + 2;
    }
}

// ---------------------------------------------------------------------------
// Additive sub oscillator (Operator-style harmonic bars + Current-style spectra)
// Packed levels: sub_h1_4 / sub_h5_8 / sub_h9_12 / sub_h13_16 are 16-bit words of
// four 4-bit nibbles. The lowest nibble of each word is the first partial in that
// group (partial 1 = bits 0..3 of sub_h1_4). A nibble 0..15 is a level 0..1.
// ---------------------------------------------------------------------------

var SUB_H_KEYS = ["sub_h1_4", "sub_h5_8", "sub_h9_12", "sub_h13_16"];
var SUB_WAVE_NAMES = ["Custom", "Sine", "Saw", "Square", "Triangle", "Odd", "Warm"];
var SUB_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var SUB_DRV_NAMES = ["Soft", "Hard", "Tube", "Fold", "Sine", "Pinch", "Noise"];
var SUB_ENUMS = {
    sub_wave: SUB_WAVE_NAMES,
    sub_lock_note: SUB_NOTE_NAMES,
    sub_drv_type: SUB_DRV_NAMES
};

function quantHarmNibble(val01) {
    var n = clamp01(Number(val01));
    if (!isFinite(n)) n = 0;
    return Math.max(0, Math.min(15, Math.round(n * 15)));
}

function getSubHarmonic(idx) {
    idx = Math.max(0, Math.min(15, idx | 0));
    var packed = Math.round(paramValue(SUB_H_KEYS[(idx / 4) | 0])) & 65535;
    return ((packed >> ((idx % 4) * 4)) & 15) / 15;
}

function setSubHarmonic(idx, val01) {
    idx = Math.max(0, Math.min(15, idx | 0));
    var group = (idx / 4) | 0;
    var shift = (idx % 4) * 4;
    var packed = Math.round(paramValue(SUB_H_KEYS[group])) & 65535;
    packed = (packed & ~(15 << shift)) | (quantHarmNibble(val01) << shift);
    setParamFromFace(SUB_H_KEYS[group], packed);
}

function subPresetAmps(waveIdx) {
    var a = [], i, n;
    if (waveIdx === 1) {                         // Sine: fundamental only
        for (i = 0; i < 16; i++) a.push(i === 0 ? 1 : 0);
    } else if (waveIdx === 2) {                  // Saw: 1/n
        for (i = 0; i < 16; i++) a.push(1 / (i + 1));
    } else if (waveIdx === 3) {                  // Square: odd 1/n
        for (i = 0; i < 16; i++) a.push((i % 2) === 0 ? 1 / (i + 1) : 0);
    } else if (waveIdx === 4) {                  // Triangle: odd 1/n^2
        for (i = 0; i < 16; i++) { n = i + 1; a.push((i % 2) === 0 ? 1 / (n * n) : 0); }
    } else if (waveIdx === 5) {                  // Odd: odd partials, slower rolloff than square
        for (i = 0; i < 16; i++) a.push((i % 2) === 0 ? 1 / Math.sqrt(i + 1) : 0);
    } else if (waveIdx === 6) {                  // Warm: every partial, soft exponential decay
        for (i = 0; i < 16; i++) a.push(Math.pow(0.72, i));
    } else return null;
    return a;
}

function applySubWavePreset(waveIdx) {
    waveIdx = Math.max(0, Math.min(SUB_WAVE_NAMES.length - 1, Math.round(Number(waveIdx) || 0)));
    var amps = subPresetAmps(waveIdx);
    if (amps) {
        for (var g = 0; g < 4; g++) {
            var word = 0;
            for (var k = 0; k < 4; k++) word |= quantHarmNibble(amps[g * 4 + k]) << (k * 4);
            setParamFromFace(SUB_H_KEYS[g], word);
        }
    }
    setParamFromFace("sub_wave", waveIdx);
}

function subPartials() {
    var n = Math.round(paramValue("sub_partials"));
    if (!isFinite(n) || n < 1) n = 1;
    return n > 16 ? 16 : n;
}

// Series spectra gain relative to the drawn level: 1. Odd -> 2. Even -> 3. Tilt -> 4. Low Pass (Low Pass applies only to harmonics idx >= 1, never the sub fundamental idx === 0).
// Neutral settings (Odd 0%, Even 0%, Tilt 0%, Low Pass 100%) evaluate to 1.0 on every partial.
function subSpectraGain(idx) {
    var oddV = paramValue("sub_odd") / 100;
    var evenV = paramValue("sub_even") / 100;
    var tiltV = paramValue("sub_tilt") / 100;
    var lpV = paramValue("sub_lp") / 100;
    if (!isFinite(oddV)) oddV = 0;
    if (!isFinite(evenV)) evenV = 0;
    if (!isFinite(tiltV)) tiltV = 0;
    if (!isFinite(lpV)) lpV = 1;
    oddV = Math.max(-1, Math.min(1, oddV));
    evenV = Math.max(-1, Math.min(1, evenV));
    tiltV = Math.max(-1, Math.min(1, tiltV));
    lpV = clamp01(lpV);
    var num = idx + 1;
    var isOdd = (idx % 2) === 0;
    var mulOdd = (idx > 0 && isOdd) ? Math.max(0, 1 + oddV) : 1;
    var mulEven = (!isOdd) ? Math.max(0, 1 + evenV) : 1;
    var mulTilt = Math.pow(num, tiltV * 1.2);
    var cut = 1.5 + lpV * 15.5;
    // 2-pole Butterworth on harmonic number: -3 dB at the cutoff partial, then about 12 dB per octave.
    var mulLp = idx === 0 ? 1 : (lpV <= 0.005 ? 0 : (lpV >= 0.995 ? 1 : (1 / Math.sqrt(1 + Math.pow(num / cut, 4)))));
    var g = mulOdd * mulEven * mulTilt * mulLp;
    if (g < 0) g = 0;
    return g > 2 ? 2 : g;
}

function effSubHarmonic(idx) {
    idx = Math.max(0, Math.min(15, idx | 0));
    if (idx >= subPartials()) return 0;
    var lvl = (idx === 0 ? paramValue("sub_level") : paramValue("sub_harm_level")) / 100;
    if (!isFinite(lvl)) lvl = 0;
    lvl = clamp01(lvl);
    return clamp01(getSubHarmonic(idx) * subSpectraGain(idx) * lvl);
}

// Waveshaper for the scope. tone is 0..1. At 0 every mode matches the plain curve.
// Keep this in step with the sub drive block in sampler_core.genexpr.
function subShapeDrive(x, amt, kind, phase01, tone) {
    var tn = (typeof tone === "number" && isFinite(tone)) ? tone : 0;
    if (tn < 0) tn = 0;
    if (tn > 1) tn = 1;
    if (!(amt > 0.0005)) return Math.max(-1, Math.min(1, x));
    var ax, sgn, an, y0, y1, t, kn, x0, p, w, env;
    if (kind === 1) {                            // Hard: cubic fillet on the clip shoulder
        var yH = x * (1 + amt * 8);
        an = Math.abs(yH);
        sgn = yH >= 0 ? 1 : -1;
        y0 = Math.min(an, 1);
        kn = tn * 0.7;
        x0 = 1 - kn;
        if (kn > 0.0001 && an > x0 && an < 1) {
            t = (an - x0) / kn;
            y0 = x0 + kn * (t + t * t - t * t * t);
        }
        return x + (sgn * y0 - x) * amt;
    }
    if (kind === 2) {                            // Tube: even-harmonic coefficient 0.35 .. 1.15
        var yT = x * (1 + amt * 5);
        var asym = 0.35 + tn * 0.80;
        var tb = Math.tanh(yT + asym * yT * yT);
        return x + (tb - x) * amt;
    }
    if (kind === 3) {                            // Fold: bias into the folder, DC of a zero input removed
        var bias = tn * 0.6;
        var yF = x * (1 + amt * 4) + bias;
        var fd = Math.sin(Math.max(-8, Math.min(8, yF))) - Math.sin(bias);
        return x + (fd - x) * amt;
    }
    if (kind === 4) {                            // Sine: input warp |x|^p, p from 1 down to 0.35
        p = 1 - tn * 0.65;
        ax = Math.abs(x);
        sgn = x >= 0 ? 1 : -1;
        w = ax > 1e-7 ? sgn * Math.pow(ax, p) : 0;
        var yS = w * (1 + amt * 3);
        var sn = Math.sin(Math.max(-4, Math.min(4, yS)) * 1.57079632679);
        return x + (sn - x) * amt;
    }
    if (kind === 5) {                            // Pinch: taller narrower ear, deeper valley, crest held
        ax = Math.abs(x);
        sgn = x >= 0 ? 1 : -1;
        var earK = 11.0 + tn * 17.0;
        var earD = 8.5 + tn * 7.5;
        var bodyS = 0.14 + tn * 0.14;
        var bodyE = 1.45 + tn * 0.95;
        var bodyDen = 0.86 - tn * 0.14;
        var ear = earK * ax * Math.exp(-earD * ax);
        var body = 0.78 * Math.pow(Math.max(0, ax - bodyS) / bodyDen, bodyE);
        var pn = sgn * (ear + body);
        return Math.max(-1, Math.min(1, x + (pn - x) * amt));
    }
    if (kind === 6) {                            // Noise: grit walks from the peaks onto the zero crossings
        var nh = Math.sin((phase01 || 0) * 129.898 + 78.233) * 43758.5453;
        var nv = (nh - Math.floor(nh)) * 2 - 1;
        an = Math.abs(x);
        env = (0.15 + 0.85 * an) + ((0.15 + 0.85 * (1 - Math.min(an, 1))) - (0.15 + 0.85 * an)) * tn;
        var yN = Math.tanh(x * (1 + amt * 3.5) + nv * amt * env);
        return x + (yN - x) * amt;
    }
    // Soft: tanh blended toward an order-8 knee
    ax = x * (1 + amt * 6);
    an = Math.min(Math.abs(ax), 4);
    sgn = ax >= 0 ? 1 : -1;
    var an2 = an * an;
    var an8 = an2 * an2;
    an8 = an8 * an8;
    y1 = sgn * an / Math.pow(1 + an8, 0.125);
    y0 = Math.tanh(ax);
    return x + ((y0 + (y1 - y0) * tn) - x) * amt;
}

// One cycle of the additive sub, channel 0 = left, 1 = right.
// Upper harmonics take Detune, Mod and Width; Drive shapes the sum and Tone retunes that shaper.
function subWaveSample(phase01, channel) {
    var det = paramValue("sub_detune") / 100;
    var mod = paramValue("sub_mod") / 100;
    var wid = paramValue("sub_width") / 100;
    var ph0 = paramValue("sub_phase") / 360;
    if (!isFinite(det)) det = 0;
    if (!isFinite(mod)) mod = 0;
    if (!isFinite(wid)) wid = 0;
    if (!isFinite(ph0)) ph0 = 0;
    var sum = 0, energy = 0, i;
    var dispStages = clamp01(paramValue("sub_disp_amt") / 100) * 32.0;
    var dispCut = Math.max(20, Math.min(2000, Number(paramValue("sub_disp_freq")) || 160));
    for (i = 0; i < 16; i++) {
        var amp = effSubHarmonic(i);
        if (amp < 1e-6) continue;
        var n = i + 1;
        var spread = i === 0 ? 0 : det * 0.02 * n * ((i % 2) ? 1 : -1);
        var wob = i === 0 ? 0 : mod * 0.035 * n * Math.sin(6.28318530718 * phase01);
        var stereo = i === 0 ? 0 : wid * 0.08 * n * (channel ? 1 : -1);
        var ph = (phase01 + ph0) * n * (1 + spread + wob) + stereo;
        var drvG = 1 + (Math.round(paramValue("sub_drv_type")) === 5 ? 0 : clamp01(paramValue("sub_drive") / 100) * Math.max(0.2, 1.6 - i * 0.08));
        sum += Math.sin(6.28318530718 * ph) * amp * drvG;
        energy += amp;
    }
    if (energy < 1e-6) return 0;
    sum /= Math.sqrt(energy);
    var subTone01 = clamp01(paramValue("sub_tone") / 100);
    var driven = subShapeDrive(sum, clamp01(paramValue("sub_drive") / 100), Math.round(paramValue("sub_drv_type")), phase01, subTone01);
    if (dispStages > 0.05) {
        // Apply post-drive biquad all-pass phase dispersion in the scope preview
        var fRatio = 55.0 / dispCut;
        var rot = dispStages * 0.35 * Math.atan(fRatio);
        var pShift = (phase01 + rot * 0.1591549) - Math.floor(phase01 + rot * 0.1591549);
        var sum2 = 0;
        for (i = 0; i < 16; i++) {
            var amp2 = effSubHarmonic(i);
            if (amp2 < 1e-6) continue;
            var n2 = i + 1;
            var stagePh = dispStages * 2.0 * Math.atan2(n2 * 55.0 / dispCut, 1.0 - (n2 * 55.0 / dispCut) * (n2 * 55.0 / dispCut));
            var ph2 = (phase01 + ph0) * n2 * 6.28318530718 - stagePh;
            sum2 += Math.sin(ph2) * amp2;
        }
        sum2 /= Math.sqrt(energy);
        return 0.55 * driven + 0.45 * subShapeDrive(sum2, clamp01(paramValue("sub_drive") / 100), Math.round(paramValue("sub_drv_type")), pShift, subTone01);
    }
    return driven;
}

// Plot geometry for oscTab === 2. The waveform rect is 458 x 73: 300 px of harmonic
// bars on the left, 150 px of waveform / stereo scope on the right.
function subHarmLayout() {
    var wx = viewWave[0], wy = viewWave[1], ww = viewWave[2], wh = viewWave[3];
    var editorW = 300, scopeW = 150, split = 8, handleW = 34, barGap = 2;
    var barsX = wx + handleW + 4;
    var barsW = editorW - handleW - 8;
    return {
        wx: wx, wy: wy, ww: ww, wh: wh,
        editorX: wx, editorW: editorW,
        scopeX: wx + editorW + split, scopeW: scopeW,
        handleW: handleW,
        barsX: barsX, barsW: barsW, bw: (barsW - barGap * 15) / 16, barGap: barGap,
        top: wy + 14, bot: wy + wh - 5
    };
}

function subHarmIndexAt(L, x) {
    var cell = L.bw + L.barGap;
    var i = Math.floor((x - L.barsX) / cell);
    if (i < 0) i = 0;
    return i > 15 ? 15 : i;
}

function subHarmLevelAt(L, y) {
    return clamp01((L.bot - y) / Math.max(1, L.bot - L.top));
}

function drawSubHarmonicsAt(x, y) {
    var L = subHarmLayout();
    var idx = subHarmIndexAt(L, x);
    var lvl = subHarmLevelAt(L, y);
    if (drag.subLast === undefined || drag.subLast === null) {
        setSubHarmonic(idx, lvl);
    } else if (drag.subLast === idx) {
        setSubHarmonic(idx, lvl);
    } else {
        var a = drag.subLast, b = idx;
        var lo = Math.min(a, b), hi = Math.max(a, b);
        for (var i = lo; i <= hi; i++) {
            var u = (i - a) / (b - a);
            setSubHarmonic(i, drag.subLastLvl + (lvl - drag.subLastLvl) * u);
        }
    }
    drag.subLast = idx;
    drag.subLastLvl = lvl;
    if (Math.round(paramValue("sub_wave")) !== 0) setParamFromFace("sub_wave", 0);
}

function paintSubFader(key, x, y, w, h, label, acc, dim) {
    var n = toNorm(key, paramValue(key));
    var al = dim ? 0.45 : 1;
    text(label, x + 1, y + 9, 7.0, acc, true, 0, al);
    text(String(Math.round(paramValue(key))), x + 1, y + h - 2, 6.5, dim ? RC.sub : RC.text, false, 0, al);
    var tx = x + w - 7, ty = y + 2, th = h - 4;
    fillRR(tx, ty, 5, th, 1.5, RC.raised, al);
    var fh = Math.max(n > 0.01 ? 2 : 0, n * (th - 2));
    if (fh > 0) fillRect(tx + 1, ty + th - 1 - fh, 3, fh, acc, al);
    zone("value", x, y, w, h, { key: key, norm: true });
}

// Wave on the left of the scope pane, Lissajous on the right. sampleAt(phase, channel) is the cycle.
function paintCycleScope(x, y, w, h, on, sampleAt) {
    fillRR(x, y, w, h, 3, RC.dark, 0.85);
    var waveW = w - 48;
    var mid = y + h * 0.58, amp = h * 0.32;
    var cols = 56, c;
    var left = [], right = [];
    for (c = 0; c <= cols; c++) {
        var p = c / cols;
        var px = x + 4 + p * (waveW - 8);
        left.push([px, mid - sampleAt(p, 0) * amp]);
        right.push([px, mid - sampleAt(p, 1) * amp]);
    }
    line(x + 4, mid, x + waveW - 4, mid, RC.line, 0.7, 1);
    strokePath(right, RC.cyan, on ? 0.55 : 0.25, 1.1);
    strokePath(left, on ? RC.sel : RC.lcdDim, on ? 1 : 0.4, 1.45);
    text("WAVE", x + 5, y + 9, 6.5, RC.sub, true, 0);
    var lx = x + waveW + 2, ly = y + 8, ls = h - 16;
    line(lx + ls * 0.5, ly, lx + ls * 0.5, ly + ls, RC.line, 0.45, 1);
    line(lx, ly + ls * 0.5, lx + ls, ly + ls * 0.5, RC.line, 0.45, 1);
    var xy = [];
    for (c = 0; c <= 48; c++) {
        var ph = c / 48;
        xy.push([lx + ls * 0.5 + sampleAt(ph, 0) * ls * 0.42, ly + ls * 0.5 - sampleAt(ph, 1) * ls * 0.42]);
    }
    strokePath(xy, on ? RC.cyan : RC.lcdDim, on ? 0.9 : 0.35, 1.1);
}

function paintSubScope(x, y, w, h, subOn) {
    paintCycleScope(x, y, w, h, subOn, subWaveSample);
}

// Native Wavetable position: a hairline, a hollow square, and the percent under the line.
function paintWtPosSlider(L, pos, on, osc) {
    var x = L.slideX + L.slideW * 0.5;
    var y0 = L.top + 1;
    var y1 = L.bot - 13;
    var track = [0.20, 0.27, 0.33];
    line(x, y0, x, y1, track, on ? 1 : 0.45, 1);
    var t = clamp01(pos);
    var hy = y1 - t * (y1 - y0);
    var s = 3.5;
    setc(on ? RC.sel : RC.lcdDim, 1);
    mgraphics.set_line_width(1);
    mgraphics.rectangle(Math.round(x - s) + 0.5, Math.round(hy - s) + 0.5, s * 2, s * 2);
    mgraphics.stroke();
    text((t * 100).toFixed(1) + "%", x, L.bot - 1, 8.0, on ? RC.sel : RC.sub, true, 1);
    zone("wt_pos", L.slideX, y0, L.slideW, y1 - y0, { key: osc.posKey, top: y0, h: Math.max(1, y1 - y0) });
}

// Every frame of the table, frame 0 at the bottom. The current position is the orange trace.
function paintWtFrameStack(x, y, w, h, on, pos01, fxMode, fx1, fx2) {
    var n = Math.max(1, wtViewFrameCount());
    var few = n <= 8;
    // Few frames stay apart, the way Basic Shapes reads. A long table packs until the
    // traces overlap and the current frame stays the thick orange line.
    var amp = few ? Math.min(5.5, h * 0.11) : Math.min(h * 0.16, 10);
    var room = Math.max(1, h - 8 - amp * 2);
    var apart = amp * 2 + 3.5;
    var gap = n <= 1 ? 0 : (few ? Math.min(room / (n - 1), apart) : room / (n - 1));
    var stack = gap * Math.max(0, n - 1);
    var yBot = y + h - 4 - amp;
    var yAt = function (t) { return yBot - clamp01(t) * stack; };
    var cols = 72;
    var cap = few ? n : 48;
    var shown = n <= cap ? n : cap;
    var k, fi, c, pts, px, p, framePos;
    var ghost = [0.34, 0.36, 0.39];
    var sampleAt = function (phase, frameT) { return evalWtWave(phase, frameT, fxMode, fx1, fx2); };
    for (k = shown - 1; k >= 0; k--) {
        fi = n <= cap ? k : Math.round(k * (n - 1) / (cap - 1));
        framePos = n <= 1 ? 0 : fi / (n - 1);
        pts = [];
        for (c = 0; c <= cols; c++) {
            p = c / cols;
            px = x + 3 + p * (w - 6);
            pts.push([px, yAt(framePos) - sampleAt(p, framePos) * amp]);
        }
        strokePath(pts, ghost, on ? 1 : 0.35, 1);
    }
    pts = [];
    var cur = clamp01(pos01);
    for (c = 0; c <= cols; c++) {
        p = c / cols;
        px = x + 3 + p * (w - 6);
        pts.push([px, yAt(cur) - sampleAt(p, cur) * amp]);
    }
    strokePath(pts, on ? RC.sel : RC.lcdDim, on ? 1 : 0.45, 1.75);
}

function paintWtScopePanel(x, y, w, h, on, pos01, fxMode, fx1, fx2) {
    fillRR(x, y, w, h, 3, RC.dark, 0.85);
    var waveW = Math.max(8, w - 48);
    paintWtFrameStack(x, y + 2, waveW, h - 4, on, pos01, fxMode, fx1, fx2);
    var sampleAt = function (p) { return evalWtWave(p, pos01, fxMode, fx1, fx2); };
    var lx = x + waveW + 2, ly = y + 8, ls = h - 16;
    line(lx + ls * 0.5, ly, lx + ls * 0.5, ly + ls, RC.line, 0.45, 1);
    line(lx, ly + ls * 0.5, lx + ls, ly + ls * 0.5, RC.line, 0.45, 1);
    var xy = [], c, ph;
    for (c = 0; c <= 48; c++) {
        ph = c / 48;
        xy.push([lx + ls * 0.5 + sampleAt(ph) * ls * 0.42, ly + ls * 0.5 - sampleAt(ph) * ls * 0.42]);
    }
    strokePath(xy, on ? RC.cyan : RC.lcdDim, on ? 0.9 : 0.35, 1.1);
}

function paintWtViewer(wx, wy, ww, wh, pos01, on, fxMode, fx1, fx2) {
    wtSync();
    var L = wtViewLayout();
    var osc = activeOsc();
    fillRect(wx, wy, ww, wh, RC.wave, 1);
    paintWtHarmonics(L, on, wtHarmAmps(pos01, fxMode, fx1, fx2));
    paintWtPosSlider(L, pos01, on, osc);
    paintWtScopePanel(L.panelX, wy + 3, L.panelW, wh - 6, on, pos01, fxMode, fx1, fx2);
    var waveW = Math.max(8, L.panelW - 48);
    zone("wt_pos", L.panelX, wy + 3, waveW, wh - 6, { key: osc.posKey, top: wy + 3, h: wh - 6 });
    var oi = osc.is2 ? 1 : 0;
    if (wtSel[oi].cat === WT_USER && !hasLoadedSample) {
        text("Drop Sample Here", L.panelX + waveW * 0.5, wy + wh * 0.48, 8.0, RC.sub, false, 1);
    }
}

function paintWtFooter(sx, fy, osc, oscOn, wtFx) {
    var fxNames = ["None", "Fm", "Classic", "Modern"];
    var fxName = fxNames[wtFx] || "Modern";
    var fxOpen = openMenu && openMenu.key === osc.fxKey;
    if (fxOpen) focusBrackets(sx + 4, fy - 10, 48, 12, RC.sel);
    text(fxName, sx + 6, fy, 9.0, oscOn ? RC.sel : RC.sub, false, 0);
    wtCaret(sx + 44, fy - 5.5, oscOn ? RC.sel : RC.sub);
    zone("button", sx + 4, fy - 11, 48, 14, { action: "menu", key: osc.fxKey, w2: 48, wtMenu: "wt_fx", anchorX: sx + 4, anchorY: fy - 12 });

    var fxLabs = wtFx === 1 ? ["Tune", "Amt"] : (wtFx === 2 ? ["PW", "Sync"] : ["Warp", "Fold"]);
    var fxDim = !oscOn || wtFx === 0;
    var f1v = paramValue(osc.fx1Key), f2v = paramValue(osc.fx2Key);
    text(fxLabs[0], sx + 58, fy, 9.0, RC.sub, false, 0);
    text(f1v.toFixed(1) + " %", sx + 86, fy, 9.0, fxDim ? RC.sub : RC.sel, false, 0);
    zone("value", sx + 56, fy - 11, 66, 14, { key: osc.fx1Key, norm: true });

    text(fxLabs[1], sx + 128, fy, 9.0, RC.sub, false, 0);
    text(f2v.toFixed(1) + " %", sx + 154, fy, 9.0, fxDim ? RC.sub : RC.sel, false, 0);
    zone("value", sx + 126, fy - 11, 66, 14, { key: osc.fx2Key, norm: true });

    var oi = osc.is2 ? 1 : 0;
    var L = wtViewLayout();
    var yb = fy - 11;
    var catW = 68;
    var tblW = Math.max(56, L.panelW - catW - 4);
    var catKey = oi ? "wt2_cat" : "wt1_cat";
    var tblKey = oi ? "wt2_tbl" : "wt1_tbl";
    fillRR(L.panelX, yb, catW, 13, 3, RC.raised, oscOn ? 1 : 0.55);
    text(fitText(wtCatLabel(oi), catW - 14, 8.0), L.panelX + 4, yb + 9.5, 8.0, oscOn ? RC.sel : RC.sub, false, 0);
    wtCaret(L.panelX + catW - 9, yb + 5, RC.sub);
    zone("button", L.panelX, yb, catW, 13, { action: "menu", key: catKey, wtList: 1, which: "cat", osc: oi, anchorX: L.panelX, anchorY: yb, w2: Math.max(catW, 108) });
    var tx = L.panelX + catW + 4;
    fillRR(tx, yb, tblW, 13, 3, RC.raised, oscOn ? 1 : 0.55);
    text(fitText(wtTableLabel(oi), tblW - 14, 8.0), tx + 4, yb + 9.5, 8.0, oscOn ? RC.sel : RC.sub, false, 0);
    wtCaret(tx + tblW - 9, yb + 5, RC.sub);
    zone("button", tx, yb, tblW, 13, { action: "menu", key: tblKey, wtList: 1, which: "tbl", osc: oi, anchorX: tx, anchorY: yb, w2: Math.max(tblW, 132) });
}

function paintWtListMenu() {
    var m = openMenu;
    var names = m.names || [];
    var rowH = 12;
    var vis = Math.min(names.length, 12);
    if (vis < 1) return;
    var mh = vis * rowH + 2;
    var mx = m.anchorX !== undefined ? m.anchorX : m.x;
    var my = (m.anchorY !== undefined ? m.anchorY : m.y) - mh;
    if (my < 2) my = 2;
    var mw = Math.max(m.w || 120, 108);
    var maxScroll = Math.max(0, names.length - vis);
    var scroll = Math.max(0, Math.min(maxScroll, m.scroll || 0));
    m.scroll = scroll;
    m.menuRect = [mx, my, mw, mh];
    fillRect(mx, my, mw, mh, RC.wave, 1);
    setc(RC.sel, 1);
    mgraphics.set_line_width(1.1);
    mgraphics.rectangle(mx + 0.5, my + 0.5, mw - 1, mh - 1);
    mgraphics.stroke();
    for (var i = 0; i < vis; i++) {
        var idx = i + scroll;
        var ry = my + 1 + i * rowH;
        var sel = m.cur === idx;
        if (sel) fillRect(mx + 1, ry, mw - 2, rowH, RC.sel, 1);
        text(fitText(names[idx], mw - 10, 8.0), mx + 5, ry + rowH * 0.5 + 3, 8.0, sel ? RC.wave : RC.sel, false, 0);
        zone("button", mx, ry, mw, rowH, { action: "wt_pick", which: m.which, osc: m.osc, value: idx });
    }
}

function paintSubOscViewer(wx, wy, ww, wh) {
    var subOn = Math.round(paramValue("sub_on")) > 0;
    var L = subHarmLayout();
    var partials = subPartials();
    fillRect(wx, wy, ww, wh, RC.wave, 1);
    paintSubFader("sub_level", L.editorX + 1, wy + 2, L.handleW, 32, "Sub", subOn ? RC.sel : RC.lcdDim, !subOn);
    paintSubFader("sub_harm_level", L.editorX + 1, wy + 36, L.handleW, 32, "Harm", subOn ? RC.cyan : RC.lcdDim, !subOn);
    var bh = L.bot - L.top;
    for (var i = 0; i < 16; i++) {
        var bx = L.barsX + i * (L.bw + L.barGap);
        var drawn = getSubHarmonic(i);
        var eff = effSubHarmonic(i);
        var active = i < partials;
        var col = i === 0 ? RC.sel : RC.cyan;
        if (!subOn) col = RC.lcdDim;
        fillRect(bx, L.top, L.bw, bh, RC.raised, active ? 0.55 : 0.22);
        var drawnH = drawn * bh;
        var effH = eff * bh;
        if (drawnH > 0.4) fillRect(bx + 0.5, L.bot - drawnH, L.bw - 1, drawnH, col, active ? 0.28 : 0.1);
        if (effH > 0.4) fillRect(bx + 1.6, L.bot - effH, Math.max(1, L.bw - 3.2), effH, col, active ? 0.95 : 0.22);
        var capY = L.bot - drawnH;
        line(bx, capY, bx + L.bw, capY, i === 0 ? RC.sel : RC.white, active ? 0.85 : 0.28, 1);
        if (i === 0) text("SUB", bx + L.bw * 0.5, L.top - 2, 6.5, subOn ? RC.sel : RC.sub, true, 1);
    }
    zone("sub_harm", L.barsX - 1, L.top - 2, L.barsW + 2, bh + 4, {
        keys: ["sub_h1_4", "sub_h5_8", "sub_h9_12", "sub_h13_16"]
    });
    paintSubScope(L.scopeX, wy + 3, L.scopeW, wh - 6, subOn);
}

function subMenuBtn(key, x, y, w, label, dim) {
    fillRR(x, y, w, 13, 3, RC.raised, dim ? 0.5 : 1);
    text(fitText(label, w - 12, 8.0), x + 4, y + 9.5, 8.0, dim ? RC.sub : RC.sel, false, 0, dim ? 0.5 : 1);
    wtCaret(x + w - 9, y + 5, RC.sub);
    zone("button", x, y, w, 13, { action: "menu", key: key, subMenu: true, w2: Math.max(w, 72), anchorX: x, anchorY: y });
}

function subValueReadout(key, x, y, w, label, display, dim) {
    var al = dim ? 0.45 : 1;
    text(label, x, y + 9.5, 7.2, RC.sub, false, 0, al);
    text(display, x + w, y + 9.5, 8.0, dim ? RC.sub : RC.sel, false, 2, al);
    zone("value", x, y, w, 13, { key: key, norm: true });
}

function subToggle(key, x, y, w, label, dim) {
    var on = Math.round(paramValue(key)) > 0;
    fillRR(x, y, w, 13, 3, on ? RC.sel : RC.raised, dim ? 0.45 : (on ? 0.95 : 1));
    text(label, x + w * 0.5, y + 9.5, 7.2, on ? RC.dark : RC.sub, on, 1, dim ? 0.5 : 1);
    zone("button", x, y, w, 13, { action: "toggle", key: key });
}

function paintSubFooter(sx, fy) {
    var subOn = Math.round(paramValue("sub_on")) > 0;
    var y = fy - 10;
    var x = sx + 4;
    var wave = Math.round(paramValue("sub_wave"));
    subMenuBtn("sub_wave", x, y, 68, SUB_WAVE_NAMES[wave] || "Custom", !subOn);
    x += 74;
    subValueReadout("sub_partials", x, y, 76, "Partials", String(Math.round(paramValue("sub_partials"))), !subOn);
    x += 82;
    subToggle("sub_lock", x, y, 38, "Lock", !subOn);
    x += 42;
    var note = Math.round(paramValue("sub_lock_note"));
    var lockOn = Math.round(paramValue("sub_lock")) > 0;
    subMenuBtn("sub_lock_note", x, y, 38, SUB_NOTE_NAMES[note] || "C", !subOn || !lockOn);
    x += 44;
    subValueReadout("sub_phase", x, y, 64, "Phase", Math.round(paramValue("sub_phase")) + "\u00b0", !subOn);
    x += 70;
    subToggle("sub_mono", x, y, 42, "Mono", !subOn);
    x += 46;
    subToggle("sub_direct", x, y, 48, "Direct", !subOn);
}

function paintSubEnumMenu() {
    var m = openMenu;
    var names = SUB_ENUMS[m.key];
    if (!names) return;
    var cur = Math.round(paramValue(m.key));
    var rowH = names.length > 8 ? 11.5 : 13;
    var mh = names.length * rowH + 2;
    var mx = m.anchorX !== undefined ? m.anchorX : m.x;
    var my = (m.anchorY !== undefined ? m.anchorY : m.y) - mh;
    if (my < 2) my = 2;
    var mw = Math.max(m.w || 72, 72);
    fillRect(mx, my, mw, mh, RC.wave, 1);
    setc(RC.sel, 1);
    mgraphics.set_line_width(1.1);
    mgraphics.rectangle(mx + 0.5, my + 0.5, mw - 1, mh - 1);
    mgraphics.stroke();
    for (var i = 0; i < names.length; i++) {
        var ry = my + 1 + i * rowH;
        var sel = cur === i;
        if (sel) fillRect(mx + 1, ry, mw - 2, rowH, RC.sel, 1);
        text(names[i], mx + 5, ry + rowH * 0.5 + 3, 8.5, sel ? RC.wave : RC.sel, false, 0);
        zone("button", mx, ry, mw, rowH, { action: "menu_pick", key: m.key, value: i });
    }
}

// 2-row Pitch-Envelope Knock widget (to the right of Tone, occupying the 4th column across Rows 2 & 3):
//   - Top text readout: draggable decay time ("120 ms", 1..250 ms)
//   - Left triangle/curve area: draggable up/down for pitch-envelope slope (sub_knock_slope, -100..+100%)
//   - Right vertical bar with orange top cap: draggable up/down for knock amount (sub_knock, 0..+96 st)
function paintSubKnockWidget(x, y, w, h, dim) {
    var al = dim ? 0.45 : 1.0;
    var orange = RC.sel;
    fillRR(x, y, w, h, 3, RC.textBg, al);
    strokeRR(x + 0.5, y + 0.5, w - 1, h - 1, 2.5, RC.contrastFrame, al, 1.0);

    var decMs = paramValue("sub_decay");
    var slopePct = paramValue("sub_knock_slope");
    var amtSt = paramValue("sub_knock");
    var decNorm = toNorm("sub_decay", decMs);
    var amtNorm = clamp01(amtSt / 96.0);
    var sNorm = Math.max(-1, Math.min(1, slopePct / 100.0));
    var expP = Math.pow(3.5, -sNorm);

    // Top time readout ("120 ms", draggable for sub_decay 1..250 ms)
    var msTxt = decMs < 10 ? decMs.toFixed(1) + " ms" : Math.round(decMs) + " ms";
    text(msTxt, x + 4.5, y + 9.8, 7.6, orange, false, 0, al);
    if (amtSt > 0.05) {
        text("+" + Math.round(amtSt), x + w - 3.5, y + 9.4, 6.8, RC.sub, false, 2, al * 0.9);
    }
    zone("value", x + 1, y + 1, w - 16, 11, { key: "sub_decay", norm: true });

    // Plot geometry inside the widget
    var gx0 = x + 4.0, gyTop = y + 12.5, gyBot = y + h - 3.0;
    var gh = gyBot - gyTop;
    var curveMaxW = w - 22.0;
    var curveW = Math.max(12.0, (0.38 + 0.62 * decNorm) * curveMaxW);

    // Baseline
    line(gx0, gyBot, x + w - 3.5, gyBot, RC.line, al * 0.75, 1.0);

    // Filled decay curve polygon & bright orange top stroke
    var nPts = 16;
    var polyPts = [[gx0, gyBot]];
    var strokePts = [];
    for (var i = 0; i <= nPts; i++) {
        var t = i / nPts;
        var envY = Math.pow(1.0 - t, expP);
        var px = gx0 + t * curveW;
        var py = gyBot - envY * gh;
        polyPts.push([px, py]);
        strokePts.push([px, py]);
    }
    polygon(polyPts, mixc(RC.textBg, orange, 0.42), al);
    strokePath(strokePts, orange, al, 1.35);

    // Draggable slope zone over the curve area
    zone("value", x + 1, y + 12, w - 17, h - 13, { key: "sub_knock_slope", norm: true });

    // Right vertical amount bar (0..96 st) with bright orange top cap
    var barW = 9.5;
    var barX = x + w - barW - 4.0;
    fillRect(barX, gyTop, barW, gh, RC.raised, al * 0.55);
    var barH = Math.max(1.5, amtNorm * gh);
    var barTopY = gyBot - barH;
    if (amtNorm > 0.005) {
        fillRect(barX, barTopY, barW, barH, mixc(RC.textBg, orange, 0.45), al);
    }
    line(barX, barTopY, barX + barW, barTopY, orange, al, 1.6);
    zone("value", barX - 3, y + 1, barW + 6, h - 2, { key: "sub_knock", norm: true });
}

// Bottom strip when oscTab === 2. Same 5A columns as the engine strip:
// left 276 px (Row 1: Odd, Even, Tilt, Low Pass; Row 2: Disp Freq, Disp Amt; Row 3: Drive Mode, Drive, Tone; Col 4 Rows 2-3: 2-row Knock widget),
// right 168 px (upper harmonics + tuning).
function paintSubStrip(x, y, w, h) {
    var subOn = Math.round(paramValue("sub_on")) > 0;
    var acc = RC.cyan;
    var dim = !subOn;
    var leftW = 276;
    var gap = 4;
    var bw = Math.floor((leftW - 3 * gap) / 4);             // 66 px, same 4-slot width as Design 5A

    // Row 1 (y+3): 4 series Spectra parameters in order: Odd, Even, Tilt, Low Pass
    var specRow = [
        ["sub_odd", "Odd"],
        ["sub_even", "Even"],
        ["sub_tilt", "Tilt"],
        ["sub_lp", "Low Pass"]
    ];
    for (var s = 0; s < 4; s++) {
        hValueBar(specRow[s][0], x + 4 + s * (bw + gap), y + 3, bw, 14, specRow[s][1], acc, dim);
    }

    // Row 2 (y+20, cols 1..3): Distortion Mode dropdown + Drive amount bar + Tone bar
    var drvIdx = Math.round(paramValue("sub_drv_type"));
    subMenuBtn("sub_drv_type", x + 4, y + 20, bw, SUB_DRV_NAMES[drvIdx] || "Soft", dim);
    hValueBar("sub_drive", x + 4 + (bw + gap), y + 20, bw, 15, "Drive", acc, dim);
    hValueBar("sub_tone", x + 4 + 2 * (bw + gap), y + 20, bw, 15, "Tone", acc, dim);

    // Row 3 (y+38, cols 1..3): Disperser Cutoff & Disperser Amount
    var dispFreqW = bw * 2 + gap;                           // 136 px
    hValueBar("sub_disp_freq", x + 4, y + 38, dispFreqW, 16, "Disp Freq", acc, dim);
    hValueBar("sub_disp_amt", x + 4 + dispFreqW + gap, y + 38, bw, 16, "Disp Amt", acc, dim);

    // Col 4 across Rows 2 & 3 (to the right of Tone / Disp Amt): 2-row Pitch-Envelope Knock widget
    paintSubKnockWidget(x + 4 + 3 * (bw + gap), y + 20, bw, 34, dim);

    line(x + 286, y + 4, x + 286, y + h - 4, RC.divider, 1, 1);
    var rx = x + 292;
    hValueBar("sub_detune", rx, y + 3, 54, 14, "Detune", acc, dim);
    hValueBar("sub_mod", rx + 58, y + 3, 53, 14, "Mod", acc, dim);
    hValueBar("sub_width", rx + 115, y + 3, 53, 14, "Width", acc, dim);
    hValueBar("sub_semi", rx, y + 20, 54, 15, "Semi", acc, dim);
    hValueBar("sub_fine", rx + 58, y + 20, 53, 15, "Fine", acc, dim);
    hValueBar("sub_ratio", rx + 115, y + 20, 53, 15, "Ratio", acc, dim);
    hValueBar("sub_gain", x + 410, y + 38, 50, 16, "Level", acc, dim);
}

function paintViewer() {
    var sx = VIEW.x, sy = VIEW.y, sw = VIEW.w, sh = VIEW.h;
    fillRect(sx, sy, sw, sh, RC.wave, 1.0);
    var acc = RC.a_wave;

    // Header: folder / file name, sample gain, ROOT note + ct, sample/slice; plus oscillator tabs.
    // The tabs stay put in every engine. Sub and Wavetable keep the gain pill and drop the sample folder, root, and sample/slice switch.
    var headOsc = activeOsc();
    var slimHead = oscTab === 2 || ((oscTab === 0 || oscTab === 1) && Math.round(paramValue(headOsc.typeKey)) > 0);
    if (!slimHead) {
        iconFolder(sx + 7, sy + 5, acc, 0.9);
        var nameW = text(fitText(hasLoadedSample ? sampleFileName : "Drop a sample or click to browse", 88, 9.0), sx + 21, sy + 13, 9.0, hasLoadedSample ? acc : RC.sub, false, 0);
        zone("button", sx + 4, sy + 1, nameW + 20, 15, { action: "browse" });
    }
    // One position in every engine: the viewer centre, held short of the gain pill.
    var tabW = 112;
    var tabX = sx + Math.round((sw - tabW) / 2);
    var gainX = sx + 276;
    if (tabX + tabW > gainX - 8) tabX = gainX - 8 - tabW;
    paintOscHeaderTabs(tabX, sy + 2);
    if (!dspReady) {
        var vx = sx + 228;
        var failed = dspError.length > 0;
        var pl = failed ? "DSP failed: " + dspError : "DSP loading…";
        var pw = textW(pl, 8.0) + 12;
        fillRR(vx - 4, sy + 3, pw, 12, 6, failed ? RC.orange : RC.a_filt, 0.9);
        text(pl, vx - 4 + pw * 0.5, sy + 12, 8.0, RC.dark, true, 1);
    }
    paintGainPill(sx + 276, sy + 2);
    if (!slimHead) {
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
    }

    if (oscTab === 2) {
        paintSubOscViewer(viewWave[0], viewWave[1], viewWave[2], viewWave[3]);
        paintSubFooter(sx, sy + sh - 4);
        return;
    }
    var osc = activeOsc();
    var oscOn = Math.round(paramValue(osc.onKey)) > 0;
    var isWt = (oscTab === 0 || oscTab === 1) && Math.round(paramValue(osc.typeKey)) > 0;
    if (isWt) {
        paintWtViewer(viewWave[0], viewWave[1], viewWave[2], viewWave[3], clamp01(paramValue(osc.posKey) * 0.01), oscOn, Math.round(paramValue(osc.fxKey)), paramValue(osc.fx1Key) * 0.01, paramValue(osc.fx2Key) * 0.01);
        paintWtFooter(sx, sy + sh - 4, osc, oscOn, Math.round(paramValue(osc.fxKey)));
        return;
    }

    // Waveform (one view transform: vwx / vnorm; overlays are clipped to the waveform; zoom / pan are not persisted)
    var wx = viewWave[0], wy = viewWave[1], ww = viewWave[2], wh = viewWave[3];
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

    // Footer: sample start / loop row. Wavetable and Sub return above with their own footers.
    var fy = sy + sh - 4;
    if (curSliced) {
        paintSlicedFooter(sx, sw, fy);
        return;
    }
    iconReverse(sx + 6, fy - 9, curReverse);
    zone("button", sx + 3, fy - 11, 16, 14, { action: "reverse" });
    iconFlag(sx + 28, fy - 9, RC.yellow, false);
    var stW = text(fmtPos(curStart), sx + 36, fy, 9.0, RC.yellow, false, 0);
    zone("value", sx + 34, fy - 11, stW + 4, 14, { region: "samp_start" });
    iconFlag(sx + 102, fy - 9, RC.yellow, true);
    var enW = text(fmtPos(curEnd), sx + 106, fy, 9.0, RC.yellow, false, 0);
    zone("value", sx + 104, fy - 11, enW + 4, 14, { region: "samp_end" });
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
// Mod Sources Section & Mod Matrix Section (Ableton Wavetable look):
//   Mod Sources section ("env"):
//     Top tab bar: [Amp] [Env 2] [Env 3] [LFO 1] [LFO 2]
//     Envelope sub-tabs: Time | Slope | Value, None/Trigger/Loop dropdown, 4 orange hollow squares + 3 pink slope diamonds
//     LFO sub-tabs: A attack ms, Hz / Sync note, R retrigger, 4-cycle orange wave, 5 shape icons, Rate / Amount / Shape / Offset
//   Mod Matrix section ("matrix"):
//     Top tab bar (same style as Mod Sources): [Matrix] [MIDI] [MPE]
//     4 target rows (Amp, Pitch, Osc 1 Pos, Osc 1 Warp) with bipolar mod cells & green/cyan/orange bars + Global Time/Amount
// ---------------------------------------------------------------------------

var ENV_W = 264;
var MAT_W = 252;
var envDots = [];            // last painted: { v, x, y, stage, alpha, rank } for the page shown (newest first)
var envPanelRect = [0, 0, 0, 0];
var envTab = 0;              // 0 Time, 1 Slope, 2 Value (the envelope value row)
var matTab = 0;              // 0 Matrix, 1 MIDI, 2 MPE (the Mod Matrix section tab)
var ENV_MIN_SEG = 20;        // minimum width of a segment in px: handle zones are +-5, diamond zones +-4, so they never overlap

// Auxiliary matrix cell values for cells not backed by direct gen parameters (seeded with Wavetable's defaults from screenshots)
var wtModCells = {
    "midi:0:0": 50, "midi:1:2": 2, "midi:2:4": 100, "midi:3:3": 7,
    "mpe:0:0": 50, "mpe:1:1": 48, "mpe:2:2": 33, "mpe:3:3": 7
};

function envKeys() {
    if (envPage === 2) return ["env3_atk_ms", "env3_dec_ms", "env3_sus_lvl", "env3_rel_ms"];
    return envPage === 1 ? ["matk_ms", "mdec_ms", "msus_lvl", "mrel_ms"] : ["atk_ms", "dec_ms", "sus_lvl", "rel_ms"];
}
function envSlopeKeys() {
    if (envPage === 2) return ["env3_atk_slope", "env3_dec_slope", "env3_rel_slope"];
    return envPage === 1 ? ["matk_slope", "mdec_slope", "mrel_slope"] : ["atk_slope", "dec_slope", "rel_slope"];
}
function envValKeys() {
    if (envPage === 2) return ["env3_init", "env3_peak", "env3_sus_lvl", "env3_final"];
    if (envPage === 1) return ["env2_init", "env2_peak", "msus_lvl", "env2_final"];
    return ["amp_init", "amp_peak", "sus_lvl", null];
}
function envLoopKey() {
    if (envPage === 2) return "env3_loop_mode";
    return envPage === 1 ? "env2_loop_mode" : "amp_loop_mode";
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
    var k = envKeys(), sk = envSlopeKeys(), vk = envValKeys();
    var gx = envX + 18.5, gw = ENV_W - 35.0, gy = 38.5, gb = 109.5;
    var hold = Math.round(gw * 0.36);
    var segMax = (gw - hold) / 3;
    var smA = segMax;                            // Attack starts at 0 px (on the left wall gx when A = 0 ms) up to segMax
    var sm = segMax - ENV_MIN_SEG;               // Decay and Release stay at least ENV_MIN_SEG wide
    var an = toNorm(k[0], paramValue(k[0])), dn = toNorm(k[1], paramValue(k[1])), rn = toNorm(k[3], paramValue(k[3]));
    var sus = clamp01(paramValue(k[2]) * 0.01);
    var initL = vk[0] ? clamp01(paramValue(vk[0]) * 0.01) : 0.0;
    var peakL = vk[1] ? clamp01(paramValue(vk[1]) * 0.01) : 1.0;
    var finalL = vk[3] ? clamp01(paramValue(vk[3]) * 0.01) : 0.0;
    var xA = gx + an * smA;
    var xD = xA + ENV_MIN_SEG + dn * sm;
    var xRSpan = ENV_MIN_SEG + rn * sm;
    // Sustain hold stretches from xD so that at maximum Release (rn = 1), xR lands on the right wall (gx + gw)
    var xS = Math.max(xD + hold, gx + gw - segMax);
    var xR = Math.min(gx + gw, xS + xRSpan);
    var spanY = gb - gy;
    return { keys: k, slopeKeys: sk, valKeys: vk, gx: gx, gw: gw, gy: gy, gb: gb, hold: hold, segMax: segMax, minSeg: ENV_MIN_SEG, sm: sm, smA: smA,
        xA: xA, xD: xD, xS: xS, xR: xR,
        y0: gb - initL * spanY, yPeak: gb - peakL * spanY, ys: gb - sus * spanY, yFinal: gb - finalL * spanY,
        initL: initL, peakL: peakL, sus: sus, finalL: finalL, an: an, dn: dn, rn: rn,
        sA: clamp01((paramValue(sk[0]) + 100) / 200) * 2 - 1, sD: clamp01((paramValue(sk[1]) + 100) / 200) * 2 - 1, sR: clamp01((paramValue(sk[2]) + 100) / 200) * 2 - 1 };
}

// exponential-looking decay / release between two levels (the same shape the voice dots are mapped through)
var ENV_POW = 2.2;
function envCurveY(t) { return Math.pow(1 - t, ENV_POW); }
// progress through the curve for a level-based fraction f (0..1) of a decay / release
function envT(f) { return 1 - Math.pow(1 - clamp01(f), 1 / ENV_POW); }

// screen y of the curve in each segment (t 0..1 through the segment), slope included
function envYAttack(g, t) {
    var lv = g.initL + (g.peakL - g.initL) * bendP(t, g.sA);
    return g.gb - lv * (g.gb - g.gy);
}
function envYDecay(g, t) {
    var lv = g.sus + (g.peakL - g.sus) * bendW(envCurveY(t), g.sD);
    return g.gb - lv * (g.gb - g.gy);
}
function envYRelease(g, t, relLevel) {
    var r0 = relLevel === undefined ? g.sus : relLevel;
    var lv = g.finalL + (r0 - g.finalL) * bendW(envCurveY(t), g.sR);
    return g.gb - lv * (g.gb - g.gy);
}

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
        var rel = (f < 0.999 && b > 1e-4) ? clamp01(g.finalL + (lvl - g.finalL) / b) : g.sus;      // the level the voice had when its release began
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
    var L = 7.0;
    var xs = [x + 0.5, x + w - 0.5], ys = [y + 0.5, y + h - 0.5];
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
        var dx = i === 0 ? 1 : -1, dy = j === 0 ? 1 : -1;
        line(xs[i], ys[j], xs[i] + dx * L, ys[j], c, 1.0, 1.0);
        line(xs[i], ys[j], xs[i], ys[j] + dy * L, c, 1.0, 1.0);
    }
}
function focusBrackets(x, y, w, h, c) {
    var L = 2.5;
    line(x, y, x + L, y, c, 1.0, 1.0); line(x, y, x, y + L, c, 1.0, 1.0);
    line(x + w, y, x + w - L, y, c, 1.0, 1.0); line(x + w, y, x + w, y + L, c, 1.0, 1.0);
    line(x, y + h, x + L, y + h, c, 1.0, 1.0); line(x, y + h, x, y + h - L, c, 1.0, 1.0);
    line(x + w, y + h, x + w - L, y + h, c, 1.0, 1.0); line(x + w, y + h, x + w, y + h - L, c, 1.0, 1.0);
}
function diamond(x, y, r, c, a) {
    setc(c, a === undefined ? 1.0 : a);
    mgraphics.set_line_width(1.1);
    mgraphics.move_to(x, y - r);
    mgraphics.line_to(x + r, y);
    mgraphics.line_to(x, y + r);
    mgraphics.line_to(x - r, y);
    mgraphics.close_path();
    mgraphics.stroke();
}
function hollowSquare(x, y, r, c, w) {
    setc(c, 1.0);
    mgraphics.set_line_width(w);
    mgraphics.rectangle(x - r, y - r, r * 2, r * 2);
    mgraphics.stroke();
}

// Wavetable value formatting: Amp S in dB (or % for Env 2/3), times as ms / s, slopes as %, Initial/Peak/Final as %
function fmtEnvVal(key, v) {
    if (key === "sus_lvl" && envTab === 0 && envPage === 0) return v <= 0.05 ? "-inf dB" : (20 * Math.log(v / 100) / Math.LN10).toFixed(1) + " dB";
    if (key === "sus_lvl" || key === "msus_lvl" || key === "env3_sus_lvl") return Math.round(v) + " %";
    if (/init$|peak$|final$/.test(key)) return (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)) + " %";
    if (/slope$/.test(key)) return (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)) + " %";
    if (v >= 10000) return (v / 1000).toFixed(1) + " s";
    if (v >= 1000) return (v / 1000).toFixed(2) + " s";
    if (v >= 100) return Math.round(v) + " ms";
    return v.toFixed(2) + " ms";
}

// Shape LFO waveform (-1..+1) with shaping (-1..+1) and phase offset
function wtLfoEval(shape, p, shaping) {
    p = p - Math.floor(p);
    var sh = clamp01((shaping + 100) / 200) * 2 - 1;
    if (sh !== 0 && shape !== 3) {
        p = Math.pow(p, Math.pow(3.0, -sh));
    }
    if (shape === 0) return Math.sin(6.28318530718 * p);
    if (shape === 1) return 1.0 - 4.0 * Math.abs((p + 0.25 - Math.floor(p + 0.25)) - 0.5);
    if (shape === 2) return 1.0 - 2.0 * p;     // Wavetable descending sawtooth
    if (shape === 4) return p < 0.5 ? 1.0 : -1.0;
    var step = Math.min(15, Math.floor(p * 16));
    var shTab = [0.65, -0.45, 0.85, -0.15, -0.75, 0.35, -0.55, 0.90, -0.25, 0.50, -0.85, 0.15, 0.70, -0.60, 0.25, -0.35];
    return shTab[step];
}

// Wavetable 5 LFO shape icons: 0 Sine, 1 Triangle, 2 Sawtooth (falling), 3 Square, 4 S&H stepped
function drawWtLfoShapeIcon(idx, x, y, w, h, c, a) {
    setc(c, a === undefined ? 1.0 : a);
    mgraphics.set_line_width(1.2);
    var cy = y + h * 0.5, ay = h * 0.42;
    if (idx === 0) {
        for (var i = 0; i <= 16; i++) {
            var t = i / 16;
            var px = x + t * w, py = cy - Math.sin(t * 6.2831853) * ay;
            if (i === 0) mgraphics.move_to(px, py); else mgraphics.line_to(px, py);
        }
        mgraphics.stroke();
    } else if (idx === 1) {
        mgraphics.move_to(x, cy + ay * 0.8);
        mgraphics.line_to(x + w * 0.5, cy - ay * 0.8);
        mgraphics.line_to(x + w, cy + ay * 0.8);
        mgraphics.stroke();
    } else if (idx === 2) {
        mgraphics.move_to(x, cy + ay * 0.8);
        mgraphics.line_to(x, cy - ay * 0.8);
        mgraphics.line_to(x + w, cy + ay * 0.8);
        mgraphics.stroke();
    } else if (idx === 3) {
        mgraphics.move_to(x, cy + ay * 0.8);
        mgraphics.line_to(x, cy - ay * 0.8);
        mgraphics.line_to(x + w * 0.5, cy - ay * 0.8);
        mgraphics.line_to(x + w * 0.5, cy + ay * 0.8);
        mgraphics.line_to(x + w, cy + ay * 0.8);
        mgraphics.line_to(x + w, cy - ay * 0.8);
        mgraphics.stroke();
    } else {
        var st = [0.2, 0.85, -0.7, 0.45, -0.3, 0.0, 0.6];
        for (var s = 0; s < 6; s++) {
            var sx0 = x + (s / 6) * w, sx1 = x + ((s + 1) / 6) * w;
            var sy0 = cy - st[s] * ay, sy1 = cy - st[s + 1] * ay;
            if (s === 0) mgraphics.move_to(sx0, sy0);
            mgraphics.line_to(sx1, sy0);
            if (s < 5) mgraphics.line_to(sx1, sy1);
        }
        mgraphics.stroke();
    }
}

function drawMetronomeIcon(x, y, c) {
    setc(c, 1.0);
    mgraphics.set_line_width(1.1);
    mgraphics.move_to(x + 1, y + 7.5);
    mgraphics.line_to(x + 3, y + 1);
    mgraphics.line_to(x + 6, y + 1);
    mgraphics.line_to(x + 8, y + 7.5);
    mgraphics.close_path();
    mgraphics.stroke();
    line(x + 4.5, y + 6.5, x + 7.5, y + 1.5, c, 1.0, 1.1);
}

function paintEnvSubPage(sx, bx, by, bw, bh) {
    var cy1 = RC.cyan, orange = liveCol("live_display_handle_one");
    var modPage = envPage >= 1;
    var g = envGeom();
    envPanelRect = [bx, by + 17, bw, 118];

    // Loop mode dropdown in top-right ("None ▾" / "Trigger ▾" / "Loop ▾")
    var lk = envLoopKey();
    var lModes = ["None", "Trigger", "Loop"];
    var curL = Math.round(paramValue(lk));
    var lbx = bx + bw - 44, lby = by + 20, lbw = 39, lbh = 13;
    if (openMenu && openMenu.key === lk) focusBrackets(lbx, lby, lbw, lbh, cy1);
    text(lModes[curL] || "None", lbx + 2, lby + 9.5, 9.5, cy1, false, 0);
    polygon([[lbx + lbw - 7.5, lby + 4.5], [lbx + lbw - 3.5, lby + 4.5], [lbx + lbw - 5.5, lby + 6.8]], cy1);
    zone("button", lbx, lby, lbw, lbh, { action: "menu", key: lk, w2: 41, below: true, wtEnvLoop: true, anchorX: lbx, anchorY: lby + lbh + 1 });

    // Corner brackets inside the envelope plot area
    cornerBrackets(g.gx - 5.5, g.gy - 5.5, ENV_W - 22, g.gb - g.gy + 11, cy1);

    // Envelope curve: thin cyan line from (gx, y0) -> (xA, yPeak) -> (xD, ys) -> (xS, ys) -> (xR, yFinal).
    // The static curve depends only on the envelope parameters; voice dots are drawn on top of the cache.
    var n = 18, j;
    var envKey = [g.gx, g.xA, g.xD, g.xS, g.xR, g.y0, g.yPeak, g.ys, g.yFinal, g.sA, g.sD, g.sR, g.initL, g.peakL, g.sus, g.finalL, g.gb, g.gy].join("|");
    var pts = curveGeomGet("r2-env", envKey);
    if (!pts) {
        pts = [[g.gx, g.y0]];
        for (j = 1; j <= n; j++) { var ta = j / n; pts.push([g.gx + (g.xA - g.gx) * ta, envYAttack(g, ta)]); }
        for (j = 1; j <= n; j++) { var td = j / n; pts.push([g.xA + (g.xD - g.xA) * td, envYDecay(g, td)]); }
        pts.push([g.xS, g.ys]);
        for (j = 1; j <= n; j++) { var tr = j / n; pts.push([g.xS + (g.xR - g.xS) * tr, envYRelease(g, tr, g.sus)]); }
        curveGeomPut("r2-env", envKey, pts);
    }
    strokeSeg(pts, cy1, 1.0, 1.5);

    // Sounding voice dots riding the curve
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

    // Slope diamonds (pink hollow diamonds on the A / D / R segments)
    var hv = function (id) { return hoverHdl === "env:" + id || (drag && drag.hdl === "env:" + id); };
    var sl = [
        { id: "As", x: g.gx + (g.xA - g.gx) * 0.5, y: envYAttack(g, 0.5) },
        { id: "Ds", x: g.xA + (g.xD - g.xA) * 0.5, y: envYDecay(g, 0.5) },
        { id: "Rs", x: g.xS + (g.xR - g.xS) * 0.5, y: envYRelease(g, 0.5, g.sus) }
    ];
    for (var q = 0; q < sl.length; q++) {
        diamond(sl[q].x, sl[q].y, hv(sl[q].id) ? 2.5 : 1.75, RC.pink, 1.0);
        zone("hdl", sl[q].x - 4, sl[q].y - 4, 8, 8, { id: "env:" + sl[q].id, cx: sl[q].x, cy: sl[q].y });
    }

    // Breakpoint handles (Wavetable: 4 orange squares at Initial, Attack Peak, Decay/Sustain, Release End; active/hovered fills orange)
    var hs = [
        { id: "I", x: g.gx, y: g.y0, zoneHdl: envTab === 2 },
        { id: "A", x: g.xA, y: g.yPeak, zoneHdl: true },
        { id: "D", x: g.xD, y: g.ys, zoneHdl: true },
        { id: "R", x: g.xR, y: g.yFinal, zoneHdl: true }
    ];
    for (var h = 0; h < hs.length; h++) {
        var isHot = hv(hs[h].id) || (envTab === 1 && hs[h].id === "A");
        var isWhiteBox = envTab === 2 && hs[h].id === "A" && !hv(hs[h].id);
        var sqX = Math.round(hs[h].x), sqY = Math.round(hs[h].y), sqR = 2.0;
        fillRect(sqX - sqR, sqY - sqR, sqR * 2, sqR * 2, isHot ? orange : RC.wave, 1.0);
        hollowSquare(sqX, sqY, sqR, isWhiteBox ? RC.white : orange, 1.0);
        if (hs[h].zoneHdl) {
            zone("hdl", hs[h].x - 5, hs[h].y - 5, 10, 10, { id: "env:" + hs[h].id, cx: hs[h].x, cy: hs[h].y });
        }
    }

    // Centered Time | Slope | Value tabs at bottom of plot area, with white underline on active tab and horizontal divider
    var subTabs = ["Time", "Slope", "Value"];
    var tabXs = [bx + 92, bx + 116, bx + 141];
    var tabWs = [22, 23, 24];
    var divY = by + 135;
    for (var tb = 0; tb < 3; tb++) {
        var tx = tabXs[tb], tw = tabWs[tb], on3 = envTab === tb;
        text(subTabs[tb], tx + tw * 0.5, divY - 5.5, 9.5, on3 ? RC.white : RC.sub, false, 1);
        if (on3) line(tx, divY - 0.5, tx + tw, divY - 0.5, RC.white, 1.0, 1.5);
        (function (idx) { actZone(tx - 2, divY - 14, tw + 4, 14, function () { envTab = idx; }); })(tb);
    }
    line(bx + 1, divY, bx + bw - 1, divY, RC.line, 1.0, 1.0);

    // Bottom parameter row: 4 columns (A D S R for Time & Slope; Initial Peak S Final for Env 2/3 Value, Initial Peak S for Amp Value)
    var k4 = envKeys(), sk = envSlopeKeys(), vk = envValKeys();
    var labs = envTab === 2 ? ["Initial", "Peak", "S", "Final"] : ["A", "D", "S", "R"];
    var colX = [bx + 56, bx + 93, bx + 130, bx + 167];
    var colW = 36;
    for (var c = 0; c < 4; c++) {
        var lx = colX[c];
        var key = envTab === 0 ? k4[c] : (envTab === 1 ? (c === 2 ? k4[2] : sk[c === 3 ? 2 : c]) : vk[c]);
        if (!key) continue;
        text(labs[c], lx, divY + 11.5, 9.5, RC.sub, false, 0);
        var hot = hoverKey === key || (drag && drag.key === key);
        var vStr = (envTab === 1 && c === 2) ? (Math.round(paramValue(key)) + " %") : fmtEnvVal(key, paramValue(key));
        text(vStr, lx, divY + 23.0, 9.5, hot ? RC.white : cy1, hot, 0);
        zone("value", lx - 2, divY + 2, colW, 23, { key: key, norm: true });
    }
}

function paintLfoSubPage(sx, bx, by, bw, bh) {
    var orange = liveCol("live_display_handle_one");
    var isLfo2 = envPage === 4;
    var rateKey = isLfo2 ? "lfo2_rate" : "lfo_rate";
    var shpKey = isLfo2 ? "lfo2_shape" : "lfo_shape";
    var atkKey = isLfo2 ? "lfo2_atk_ms" : "lfo1_atk_ms";
    var amtKey = isLfo2 ? "lfo2_amount" : "lfo1_amount";
    var shgKey = isLfo2 ? "lfo2_shaping" : "lfo1_shaping";
    var offKey = isLfo2 ? "lfo2_offset" : "lfo1_offset";
    var synKey = isLfo2 ? "lfo2_sync" : "lfo1_sync";
    var retKey = isLfo2 ? "lfo2_retrig" : "lfo1_retrig";

    // Top-right row inside LFO view: A 0.00 ms | Hz | metronome | [R]
    var atkV = paramValue(atkKey);
    text("A", bx + 154, by + 29, 9.5, RC.sub, false, 0);
    text(fmtTime(atkV), bx + 164, by + 29, 9.5, orange, false, 0);
    zone("value", bx + 152, by + 19, 46, 12, { key: atkKey, norm: true });

    var syncOn = Math.round(paramValue(synKey)) > 0;
    text("Hz", bx + 205, by + 29, 9.5, !syncOn ? orange : RC.sub, false, 0);
    zone("button", bx + 203, by + 19, 15, 12, { action: "menu_pick", key: synKey, value: 0 });
    drawMetronomeIcon(bx + 221, by + 20.5, syncOn ? orange : RC.sub);
    zone("button", bx + 219, by + 19, 13, 12, { action: "menu_pick", key: synKey, value: 1 });

    var retrigOn = Math.round(paramValue(retKey)) > 0;
    if (retrigOn) {
        fillRect(bx + 235, by + 20, 9.5, 9.5, orange, 1.0);
        text("R", bx + 239.8, by + 27.5, 8.5, RC.wave, true, 1);
    } else {
        hollowSquare(bx + 239.75, by + 24.75, 4.75, RC.sub, 1.0);
        text("R", bx + 239.8, by + 27.5, 8.5, RC.sub, true, 1);
    }
    zone("button", bx + 234, by + 19, 12, 12, { action: "toggle", key: retKey });

    // 4-cycle orange waveform across the plot area
    var shpRaw = Math.round(paramValue(shpKey));
    var amount = clamp01(paramValue(amtKey) * 0.01);
    var shaping = paramValue(shgKey);
    var offset = (paramValue(offKey) || 0) / 360.0;
    var atkNorm = toNorm(atkKey, atkV) * 0.45;
    var wx0 = bx + 8, wx1 = bx + bw - 16, wyMid = by + 74.5, wyAmp = 32.0 * (0.15 + 0.85 * amount);
    var nSteps = 128;
    setc(orange, 1.0);
    mgraphics.set_line_width(1.4);
    for (var i = 0; i <= nSteps; i++) {
        var t = i / nSteps;
        var env = atkNorm > 0.005 ? Math.min(1.0, t / atkNorm) : 1.0;
        var yVal = wtLfoEval(shpRaw, t * 4.0 + offset, shaping) * env;
        var px = wx0 + t * (wx1 - wx0), py = wyMid - yVal * wyAmp;
        if (i === 0) mgraphics.move_to(px, py); else mgraphics.line_to(px, py);
    }
    mgraphics.stroke();

    // 5 LFO shape selector icons at bottom of plot area: Sine (0), Tri (1), Saw (2), Square (enum 4), S&H (enum 3)
    var divY = by + 135;
    var iconEnums = [0, 1, 2, 4, 3];
    for (var si = 0; si < 5; si++) {
        var enumVal = iconEnums[si];
        var ix = bx + 78 + si * 20.5, iy = divY - 13;
        var isSel = shpRaw === enumVal;
        drawWtLfoShapeIcon(si, ix, iy, 12, 8.5, isSel ? orange : RC.sub, 1.0);
        zone("button", ix - 3, iy - 2, 18, 13, { action: "menu_pick", key: shpKey, value: enumVal });
    }
    line(bx + 1, divY, bx + bw - 1, divY, RC.line, 1.0, 1.0);

    // Bottom parameter row: Rate | Amount | Shape | Offset
    var cols = [
        { lab: "Rate", key: rateKey, x: bx + 52, fmt: function (v) { return v >= 10 ? v.toFixed(1) + " Hz" : v.toFixed(2) + " Hz"; } },
        { lab: "Amount", key: amtKey, x: bx + 90, fmt: function (v) { return (Math.abs(v) < 10 && v !== 0 ? v.toFixed(1) : Math.round(v)) + " %"; } },
        { lab: "Shape", key: shgKey, x: bx + 128, fmt: function (v) { return v.toFixed(1) + " %"; } },
        { lab: "Offset", key: offKey, x: bx + 165, fmt: function (v) { return Math.round(v) + ".0°"; } }
    ];
    for (var c = 0; c < 4; c++) {
        var cl = cols[c];
        var hot = hoverKey === cl.key || (drag && drag.key === cl.key);
        text(cl.lab, cl.x, divY + 11.5, 9.5, RC.sub, false, 0);
        text(cl.fmt(paramValue(cl.key)), cl.x, divY + 23.0, 9.5, hot ? RC.white : orange, hot, 0);
        zone("value", cl.x - 2, divY + 2, 36, 23, { key: cl.key, norm: true });
    }
}

var XS_MATRIX_KEYS = [
    ["xs_fm_21",   "xs_fm_12",   "xs_sub_fm",   null],
    ["xs_rm_21",   "xs_rm_12",   "xs_sub_rm",   null],
    ["xs_cep_21",  "xs_cep_12",  "xs_sub_cep",  null],
    ["xs_sync_21", "xs_sync_12", "xs_sub_sync", null],
    ["xs_fold_21", "xs_fold_12", "xs_sub_fold", null]
];

function activeVoiceLevel() {
    var maxA = 0;
    for (var v = 0; v < 16; v++) if (voiceAmpLvl[v] > maxA) maxA = voiceAmpLvl[v];
    return clamp01(maxA);
}

function paintCrossSynthTable(sx, bx, by, bw, bh) {
    var cy1 = RC.cyan, orange = liveCol("live_display_handle_one");
    var cellBg = mixc(RC.wave, RC.line, 0.62);
    var activeBg = [0.05, 0.08, 0.09];
    var ty = by + 17;

    text("Mode", bx + 6, ty + 13.0, 9.0, RC.sub, false, 0);

    var vLvl = activeVoiceLevel();
    var colPairs = [["2", "1"], ["1", "2"], ["Sub", "1"], ["Sub", "2"]];
    var colCols = [cy1, orange, cy1, orange];
    var nCols = 4;
    var gx0 = bx + 65, gxEnd = bx + bw - 6;
    var cw = (gxEnd - gx0) / nCols;
    for (var c = 0; c < nCols; c++) {
        var cx = gx0 + c * cw;
        var midX = cx + cw * 0.5 + (c >= 2 ? 4.0 : 0.0);
        text(colPairs[c][0], midX - 5.5, ty + 13.0, 8.8, colCols[c], false, 2);
        // Clean vector right-arrow between Modulator and Carrier
        line(midX - 3.5, ty + 9.8, midX + 3.0, ty + 9.8, colCols[c], 0.9, 1.1);
        polygon([[midX + 1.2, ty + 7.6], [midX + 4.2, ty + 9.8], [midX + 1.2, ty + 12.0]], colCols[c], 0.9);
        text(colPairs[c][1], midX + 6.0, ty + 13.0, 8.8, colCols[c], false, 0);
        // Header underline: dim track + live indicator when a voice is actively sounding
        line(cx + 0.5, ty + 16.0, cx + cw - 0.5, ty + 16.0, colCols[c], 0.35, 1.2);
        if (vLvl > 0.005) {
            var uw = Math.max(1.5, vLvl * (cw - 1.0));
            line(cx + 0.5, ty + 16.0, cx + 0.5 + uw, ty + 16.0, colCols[c], 1.0, 1.4);
        }
    }

    var xsRowNames = ["FM", "RM / AM", "Cepstral", "Hard Sync", "Wavefold"];
    var xsScale = paramValue("xs_depth") * 0.01;
    for (var r = 0; r < 5; r++) {
        var ry = ty + 18.0 + r * 18.2, rh = 16.8, lblW = 59.0;
        var rowSigned = 0;
        for (var cc = 0; cc < nCols; cc++) {
            var pk = XS_MATRIX_KEYS[r][cc];
            var cid0 = "xs:" + r + ":" + cc;
            var cv = pk ? paramValue(pk) : (wtModCells[cid0] !== undefined ? wtModCells[cid0] : 0);
            rowSigned += (cv * 0.01) * xsScale;
        }
        // Matrix values never change the label's background fill (X-Synth modes have no separate base knob, so base = 0)
        fillRect(bx + 5, ry, lblW, rh, [0.07, 0.09, 0.11], 1.0);
        // Horizontal bar under the mode name: only shows actively applied cross-synthesis when a voice is playing (vLvl > 0)
        var liveRowMod = rowSigned * vLvl;
        if (Math.abs(liveRowMod) > 0.005) {
            var midX0 = (r === 3) ? (bx + 5) : (bx + 5 + lblW * 0.5);
            var endX0 = (r === 3) ? (bx + 5 + clamp01(liveRowMod) * lblW) : (bx + 5 + clamp01(0.5 + liveRowMod * 0.48) * lblW);
            var bxS = Math.min(midX0, endX0);
            var bwS = Math.max(2.0, Math.abs(endX0 - midX0));
            fillRect(bxS, ry + rh - 2.2, bwS, 1.8, [0.62, 0.66, 0.72], 0.95);
        }
        text(xsRowNames[r], bx + 8, ry + 11.6, 8.8, RC.sub, false, 0);

        for (var col = 0; col < nCols; col++) {
            var clx = gx0 + col * cw + 0.5, clw = cw - 1.0;
            var pKey = XS_MATRIX_KEYS[r][col];
            var cellId = "xs:" + r + ":" + col;
            var val = pKey ? paramValue(pKey) : (wtModCells[cellId] !== undefined ? wtModCells[cellId] : 0);
            var hasVal = Math.abs(val) > 0.05;
            fillRect(clx, ry, clw, rh, hasVal ? activeBg : cellBg, 1.0);
            if (hasVal) {
                var barCol = colCols[col];
                var barTrack = mixc(activeBg, barCol, 0.25);
                fillRect(clx + 0.5, ry + rh - 2.2, clw - 1.0, 1.8, barTrack, 1.0);
                var isUnipolar = (r === 3); // Hard Sync is 0..100%
                if (isUnipolar) {
                    var uw0 = Math.max(1.5, (val / 100) * (clw - 2.0));
                    fillRect(clx + 1.0, ry + rh - 2.2, uw0, 1.8, barCol, 1.0);
                } else {
                    var mid = clx + clw * 0.5;
                    var bx0 = val >= 0 ? mid : mid + (val / 100) * (clw * 0.48);
                    var bw0 = Math.max(1.5, Math.abs(val / 100) * (clw * 0.48));
                    fillRect(bx0, ry + rh - 2.2, bw0, 1.8, barCol, 1.0);
                }
                var vTxt = (Math.abs(val) < 10 && Math.abs(val - Math.round(val)) > 0.05) ? val.toFixed(1) : String(Math.round(val));
                text(vTxt, clx + clw * 0.5, ry + 11.2, 9.0, barCol, false, 1);
            }
            if (pKey) {
                zone("value", clx, ry, clw, rh, { key: pKey, norm: true });
            } else {
                (function (cid) {
                    actZone(clx, ry, clw, rh, function () {
                        wtModCells[cid] = wtModCells[cid] ? 0 : 35;
                    });
                })(cellId);
            }
        }
    }

    // Bottom row at y = 158.5: Cepstral Quefrency | Tilt | Master Cross-Synth Depth
    var gyFoot = by + bh - 10.5;
    text("Quef", bx + 6, gyFoot, 8.8, RC.sub, false, 0);
    text(Math.round(paramValue("xs_quef")) + " %", bx + 31, gyFoot, 8.8, cy1, true, 0);
    zone("value", bx + 4, gyFoot - 10, 62, 14, { key: "xs_quef", norm: true });

    text("Tilt", bx + 84, gyFoot, 8.8, RC.sub, false, 0);
    var tlV = Math.round(paramValue("xs_tilt"));
    text((tlV > 0 ? "+" : "") + tlV + " %", bx + 104, gyFoot, 8.8, cy1, true, 0);
    zone("value", bx + 82, gyFoot - 10, 66, 14, { key: "xs_tilt", norm: true });

    text("Depth", bx + 164, gyFoot, 8.8, RC.sub, false, 0);
    text(Math.round(paramValue("xs_depth")) + " %", bx + 196, gyFoot, 8.8, orange, true, 0);
    zone("value", bx + 162, gyFoot - 10, 82, 14, { key: "xs_depth", norm: true });
}

function modSourceSignal(mode, col) {
    // Returns the strictly live modulation source output in [-1..+1] (or [0..1] for unipolar envelopes).
    // Returns 0 when no voice is playing so the horizontal modulation-sum bar under target names is empty at rest.
    var vLvl = activeVoiceLevel();
    if (vLvl <= 0.002) return 0;
    if (mode === 1) {
        if (col === 0) return vLvl;
        if (col === 1) return clamp01(liveModEnvVal);
        if (col === 2) return clamp01(liveModEnvVal);
        if (col === 3) return Math.max(-1, Math.min(1, liveLfoVal * (paramValue("lfo1_amount") * 0.01)));
        if (col === 4) {
            var ph2 = (lfoPhaseEst * 1.37 + paramValue("lfo2_offset") / 360.0) % 1.0;
            return Math.max(-1, Math.min(1, Math.sin(6.2831853 * ph2) * (paramValue("lfo2_amount") * 0.01)));
        }
    }
    return 0;
}

function paintModTable(sx, bx, by, bw, bh, mode) {
    var cy1 = RC.cyan, orange = liveCol("live_display_handle_one");
    var green = [0.46, 0.96, 0.30], greenDim = [0.22, 0.50, 0.16];
    var cellBg = mixc(RC.wave, RC.line, 0.62);
    var activeBg = [0.05, 0.08, 0.09];
    var pillBg = [0.22, 0.25, 0.28];
    var ty = by + 17;

    text("Target", bx + 6, ty + 13.0, 9.5, RC.sub, false, 0);

    var colNames, colCols, nCols;
    if (mode === 1) {
        colNames = ["Amp", "Env 2", "Env 3", "LFO 1", "LFO 2"];
        colCols = [cy1, cy1, cy1, orange, orange];
        nCols = 5;
    } else if (mode === 2) {
        colNames = ["Vel", "Key", "PB", "Press", "Mod", "Rand"];
        colCols = [green, green, green, green, green, green];
        nCols = 6;
    } else {
        colNames = ["Vel", "Note PB", "Slide", "Press"];
        colCols = [green, green, green, green];
        nCols = 4;
    }

    var gx0 = bx + 65, gxEnd = bx + bw - 6;
    var cw = (gxEnd - gx0) / nCols;
    for (var c = 0; c < nCols; c++) {
        var cx = gx0 + c * cw;
        text(colNames[c], cx + cw * 0.5, ty + 13.0, 9.5, colCols[c], false, 1);
        // Header bar under source name: dim track + bright bar showing current live output of that source
        var srcSig = modSourceSignal(mode, c);
        line(cx + 0.5, ty + 16.0, cx + cw - 0.5, ty + 16.0, colCols[c], 0.35, 1.2);
        if (Math.abs(srcSig) > 0.01) {
            if (mode === 1 && c >= 3) {
                var smid = cx + cw * 0.5;
                var sx0 = srcSig >= 0 ? smid : smid + srcSig * (cw * 0.48);
                var sw0 = Math.max(1.5, Math.abs(srcSig) * (cw * 0.48));
                line(sx0, ty + 16.0, sx0 + sw0, ty + 16.0, colCols[c], 1.0, 1.4);
            } else {
                var uw = Math.max(1.5, clamp01(srcSig) * (cw - 1.0));
                line(cx + 0.5, ty + 16.0, cx + 0.5 + uw, ty + 16.0, colCols[c], 1.0, 1.4);
            }
        }
    }

    // Target rows: each row's background fill represents the static parameter value (toNorm: 0 = empty/black, 1 = full 59px),
    // and the horizontal bar along the bottom of the target label represents the current sum of modulation applied.
    var isWt1 = Math.round(paramValue("osc1_type")) > 0;
    var warpKey1 = isWt1 ? "wt1_fx1" : (curMode === 0 ? "rp_dist" : (curMode === 1 || curMode === 3 ? "formant" : "grain_size"));
    var rows = [
        { name: "Amp",        paramKey: "samp_gain" },
        { name: "Pitch",      paramKey: "pitch_st" },
        { name: "Osc 1 Pos",  paramKey: "play_pos" },
        { name: "Osc 1 Warp", paramKey: warpKey1 },
        { name: "X-Synth",    paramKey: "xs_depth", isXSynth: true }
    ];
    var glbAmt = paramValue("mod_global_amt") * 0.01;

    for (var r = 0; r < 5; r++) {
        var ry = ty + 18.0 + r * 18.2, rh = 16.8, lblW = 59.0;
        var tKey = rows[r].paramKey;
        var staticNorm = clamp01(toNorm(tKey, paramValue(tKey)));
        fillRect(bx + 5, ry, lblW, rh, [0.07, 0.09, 0.11], 1.0);
        // Static value fill: 0 (e.g. -inf / min) = 0 px black/empty, 1 (max) = 100% full width (59 px)
        var fillW = Math.round(staticNorm * lblW * 10) / 10;
        if (fillW > 0.5) fillRect(bx + 5, ry, fillW, rh, pillBg, 1.0);

        // Compute current sum of modulation applied to this target across all sources
        var modSumNorm = 0;
        for (var sc = 0; sc < 5; sc++) {
            var mpKey = null;
            if (sc === 1 && r === 1) mpKey = "menv_pitch";
            else if (sc === 1 && r === 2) mpKey = "menv_pos";
            else if (sc === 1 && r === 3) mpKey = "filt_env_amt";
            else if (sc === 3 && r === 1) mpKey = "lfo_pitch";
            else if (sc === 3 && r === 2) mpKey = "lfo_pos";
            else if (sc === 3 && r === 3) mpKey = "lfo_filt";
            var mCid = "mat:" + r + ":" + sc;
            var mDepth = wtModCells[mCid] !== undefined ? wtModCells[mCid] : (mpKey ? paramValue(mpKey) : 0);
            if (Math.abs(mDepth) > 0.05) {
                modSumNorm += (mDepth * 0.01) * modSourceSignal(1, sc) * glbAmt;
            }
        }
        modSumNorm = Math.max(-1, Math.min(1, modSumNorm));

        // Horizontal bar under the target name showing the current sum of modulation applied around the static position
        if (Math.abs(modSumNorm) > 0.005) {
            var anchorX = bx + 5 + staticNorm * lblW;
            var endX = bx + 5 + clamp01(staticNorm + modSumNorm * 0.5) * lblW;
            var barX0 = Math.min(anchorX, endX);
            var barW0 = Math.max(2.0, Math.abs(endX - anchorX));
            if (barX0 + barW0 > bx + 5 + lblW) barX0 = bx + 5 + lblW - barW0;
            fillRect(barX0, ry + rh - 2.2, barW0, 1.8, [0.62, 0.66, 0.72], 0.95);
        }

        text(rows[r].name, bx + 8, ry + 11.6, 8.8, rows[r].isXSynth ? orange : RC.sub, false, 0);
        if (rows[r].isXSynth) {
            polygon([[bx + 55.0, ry + 5.8], [bx + 59.5, ry + 8.4], [bx + 55.0, ry + 11.0]], orange, 0.9);
            actZone(bx + 5, ry, lblW, rh, function () { matTab = 1; });
        }

        for (var col = 0; col < nCols; col++) {
            var clx = gx0 + col * cw + 0.5, clw = cw - 1.0;
            // Map to real Better Sampler parameter where applicable, else auxiliary cell state
            var pKey = null;
            if (mode === 1) {
                if (col === 1 && r === 1) pKey = "menv_pitch";
                else if (col === 1 && r === 2) pKey = "menv_pos";
                else if (col === 1 && r === 3) pKey = "filt_env_amt";
                else if (col === 3 && r === 1) pKey = "lfo_pitch";
                else if (col === 3 && r === 2) pKey = "lfo_pos";
                else if (col === 3 && r === 3) pKey = "lfo_filt";
            } else if (mode === 2 && col === 0 && r === 0) {
                pKey = "vel_sens";
            }
            var cellId = (mode === 1 ? "mat:" : (mode === 2 ? "midi:" : "mpe:")) + r + ":" + col;
            var val = wtModCells[cellId] !== undefined ? wtModCells[cellId] : (pKey ? paramValue(pKey) : 0);
            var hasVal = Math.abs(val) > 0.05;
            fillRect(clx, ry, clw, rh, hasVal ? activeBg : cellBg, 1.0);
            if (hasVal) {
                var barCol = colCols[col];
                var barTrack = mode === 1 ? mixc(activeBg, barCol, 0.25) : greenDim;
                fillRect(clx + 0.5, ry + rh - 2.2, clw - 1.0, 1.8, barTrack, 1.0);
                var mid = clx + clw * 0.5;
                var bx0 = val >= 0 ? mid : mid + (val / 100) * (clw * 0.48);
                var bw0 = Math.max(1.5, Math.abs(val / 100) * (clw * 0.48));
                fillRect(bx0, ry + rh - 2.2, bw0, 1.8, barCol, 1.0);
                var vTxt = (Math.abs(val) < 10 && Math.abs(val - Math.round(val)) > 0.05) ? val.toFixed(1) : (val === 7 && r === 3 ? "7.0" : String(Math.round(val)));
                text(vTxt, clx + clw * 0.5, ry + 11.2, 9.0, barCol, false, 1);
            }
            if (pKey) {
                zone("value", clx, ry, clw, rh, { key: pKey, norm: true });
            } else {
                (function (cid) {
                    actZone(clx, ry, clw, rh, function () {
                        wtModCells[cid] = wtModCells[cid] ? 0 : 50;
                    });
                })(cellId);
            }
        }
    }

    if (mode === 1) {
        // Global row at bottom of Matrix view: Global | Time 0.0 % | Amount 100 %
        var gyFoot = by + bh - 10.5;
        text("Global", bx + 6, gyFoot, 9.5, RC.sub, false, 0);
        text("Time", bx + 114, gyFoot, 9.5, RC.sub, false, 0);
        var gt = paramValue("mod_global_time");
        text(gt.toFixed(1) + " %", bx + 140, gyFoot, 9.5, RC.white, true, 0);
        zone("value", bx + 112, gyFoot - 10, 56, 14, { key: "mod_global_time", norm: true });

        text("Amount", bx + 174, gyFoot, 9.5, RC.sub, false, 0);
        var ga = paramValue("mod_global_amt");
        text(Math.round(ga) + " %", bx + 210, gyFoot, 9.5, RC.white, true, 0);
        zone("value", bx + 172, gyFoot - 10, 66, 14, { key: "mod_global_amt", norm: true });
    }
}

function paintEnvSection(sx) {
    envX = sx;
    var cy1 = RC.cyan, orange = liveCol("live_display_handle_one");
    var bx = sx, by = 0, bw = ENV_W, bh = 169;
    fillRect(bx, by, bw, bh, RC.wave, 1.0);

    // Tab bar: Amp | Env 2 | Env 3 | LFO 1 | LFO 2
    var subNames = ["Amp", "Env 2", "Env 3", "LFO 1", "LFO 2"];
    var sw = bw / 5;
    for (var s = 0; s < 5; s++) {
        var sx0 = bx + s * sw;
        var sOn = envPage === s;
        var sCol = s >= 3 ? orange : cy1;
        text(subNames[s], sx0 + sw * 0.5, by + 11.2, 9.5, sOn ? sCol : RC.sub, false, 1);
        if (sOn) line(sx0 + 1, by + 16.0, sx0 + sw - 1, by + 16.0, sCol, 1.0, 1.5);
        zone("button", sx0, by + 1, sw, 15.5, { action: "env_page", page: s });
    }
    line(bx, by + 16.5, bx + bw, by + 16.5, RC.line, 1.0, 1.0);

    if (envPage <= 2) paintEnvSubPage(sx, bx, by, bw, bh);
    else paintLfoSubPage(sx, bx, by, bw, bh);
}

function paintMatrixSection(sx) {
    matX = sx;
    var cy1 = RC.cyan, orange = liveCol("live_display_handle_one");
    var bx = sx, by = 0, bw = MAT_W, bh = 169;
    fillRect(bx, by, bw, bh, RC.wave, 1.0);

    // Top tab bar: Matrix | X-Synth | MIDI | MPE
    var matNames = ["Matrix", "X-Synth", "MIDI", "MPE"];
    var sw = bw / 4;
    for (var t = 0; t < 4; t++) {
        var tx0 = bx + t * sw;
        var tOn = matTab === t;
        var tCol = t === 1 ? orange : cy1;
        text(matNames[t], tx0 + sw * 0.5, by + 11.2, 9.5, tOn ? tCol : RC.sub, false, 1);
        if (tOn) line(tx0 + 1, by + 16.0, tx0 + sw - 1, by + 16.0, tCol, 1.0, 1.5);
        (function (idx) { actZone(tx0, by + 1, sw, 15.5, function () { matTab = idx; }); })(t);
    }
    line(bx, by + 16.5, bx + bw, by + 16.5, RC.line, 1.0, 1.0);

    if (matTab === 1) paintCrossSynthTable(sx, bx, by, bw, bh);
    else paintModTable(sx, bx, by, bw, bh, matTab === 0 ? 1 : matTab);
}

// ---------------------------------------------------------------------------
// Filter section: Ableton Wavetable dual filter section (Filter 1 + Filter 2, Serial / Parallel / Split)
// ---------------------------------------------------------------------------

var FILT_W = 235;
var F_DB_LO = -26, F_DB_HI = 14;
var filtDots = [];           // last painted: { v, x, y, hz, alpha, rank } (newest first)
var filtFocus = 2;           // 1 = Filter 1 selected, 2 = Filter 2 selected

function filterGeom() {
    var gx = filtX + 7, gw = FILT_W - 14, gy = 18, gb = 79.0, y0 = 49.0;
    return { gx: gx, gw: gw, gy: gy, gb: gb, y0: y0 };
}
function fFx(g, hz) { return g.gx + (Math.log(Math.max(20, Math.min(20000, hz)) / 20) / Math.log(1000)) * g.gw; }
function fHz(g, x) { return 20 * Math.pow(1000, clamp01((x - g.gx) / g.gw)); }
function fFy(g, db) { return Math.max(g.gy, Math.min(g.gb + 1, g.y0 - db * 1.35)); }
function fDbFromY(g, y) { return (g.y0 - y) / 1.35; }
function resToQ(res) { return Math.pow(10, clamp01(res / 100) * 18.0 / 20.0) * 0.92; }
function qToRes(q) { return clamp01(20.0 * Math.log(Math.max(0.92, q) / 0.92) / Math.LN10 / 18.0) * 100; }

// 2-pole magnitude in dB: LP (0), BP (1), HP (2), Notch (3), Morph (4)
function filterDb(type, w, q, morph, slope24) {
    var w2 = w * w;
    var den = Math.sqrt((1 - w2) * (1 - w2) + (w / q) * (w / q));
    var lp = 1 / den, bp = (w / q) * q / den, hp = w2 / den, notch = Math.abs(1 - w2) / den;
    var h;
    if (type === 0) h = lp;
    else if (type === 1) h = bp;
    else if (type === 2) h = hp;
    else if (type === 3) h = notch;
    else {
        var m = clamp01(morph === undefined ? 0 : morph) * 4;
        if (m <= 1) h = lp + (bp - lp) * m;
        else if (m <= 2) h = bp + (hp - bp) * (m - 1);
        else if (m <= 3) h = hp + (notch - hp) * (m - 2);
        else h = notch + (lp - notch) * (m - 3);
    }
    if (slope24) h = h * h;
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
    var cols = 96, top = [];
    for (var i = 0; i <= cols; i++) {
        var hz = 20 * Math.pow(1000, i / cols);
        top.push([g.gx + g.gw * i / cols, fFy(g, filterDb(ft, hz / hzCut, q))]);
    }
    return top;
}
function combinedFilterDb(hz, f1On, ft1, fc1, q1, m1, sl1, f2On, ft2, fc2, q2, m2, sl2, route) {
    var d1 = f1On ? filterDb(ft1, hz / fc1, q1, m1, sl1) : 0;
    var d2 = f2On ? filterDb(ft2, hz / fc2, q2, m2, sl2) : 0;
    if (f1On && f2On) {
        if (route === 0) return d1 + d2;
        var g1 = Math.pow(10, d1 / 20), g2 = Math.pow(10, d2 / 20);
        return 20 * Math.log(Math.max(1e-5, 0.5 * (g1 + g2))) / Math.LN10;
    }
    if (f1On) return d1;
    if (f2On) return d2;
    return 0;
}

function strokePath(p, c, a, wd) {
    setc(c, a);
    mgraphics.set_line_width(wd);
    mgraphics.move_to(p[0][0], p[0][1]);
    for (var j = 1; j < p.length; j++) mgraphics.line_to(p[j][0], p[j][1]);
    mgraphics.stroke();
}

function strokePathClipped(p, yMax, c, a, wd) {
    setc(c, a);
    mgraphics.set_line_width(wd);
    var down = false;
    for (var j = 0; j < p.length; j++) {
        var x = p[j][0], y = p[j][1];
        if (y <= yMax) {
            if (!down) { mgraphics.move_to(x, y); down = true; }
            else mgraphics.line_to(x, y);
        } else if (down && j > 0) {
            var x0 = p[j - 1][0], y0 = p[j - 1][1];
            var t = (yMax - y0) / Math.max(1e-6, y - y0);
            mgraphics.line_to(x0 + (x - x0) * t, yMax);
            mgraphics.stroke();
            down = false;
        }
    }
    if (down) mgraphics.stroke();
}

// Wavetable filter type glyph: 0=LP, 1=BP, 2=HP, 3=Notch, 4=Morph
function drawWtFilterIcon(x, y, type, c, a) {
    setc(c, a === undefined ? 1.0 : a);
    mgraphics.set_line_width(1.45);
    if (type === 0) { // LP: flat top left, smooth curve down on right
        mgraphics.move_to(x, y + 1.5);
        mgraphics.line_to(x + 10.0, y + 1.5);
        mgraphics.curve_to(x + 13.0, y + 1.5, x + 14.0, y + 4.0, x + 14.0, y + 7.5);
        mgraphics.stroke();
    } else if (type === 2) { // HP: smooth curve up on left, flat top right
        mgraphics.move_to(x, y + 7.5);
        mgraphics.curve_to(x, y + 4.0, x + 1.0, y + 1.5, x + 4.0, y + 1.5);
        mgraphics.line_to(x + 14.0, y + 1.5);
        mgraphics.stroke();
    } else if (type === 1) { // BP: rounded arch
        mgraphics.move_to(x, y + 7.5);
        mgraphics.curve_to(x, y + 2.8, x + 1.8, y + 1.5, x + 4.5, y + 1.5);
        mgraphics.line_to(x + 9.5, y + 1.5);
        mgraphics.curve_to(x + 12.2, y + 1.5, x + 14.0, y + 2.8, x + 14.0, y + 7.5);
        mgraphics.stroke();
    } else if (type === 3) { // Notch: two arms dipping into a V/U notch in the middle
        mgraphics.move_to(x, y + 1.5);
        mgraphics.curve_to(x + 4.0, y + 1.5, x + 5.8, y + 3.2, x + 6.1, y + 7.5);
        mgraphics.stroke();
        mgraphics.move_to(x + 14.0, y + 1.5);
        mgraphics.curve_to(x + 10.0, y + 1.5, x + 8.2, y + 3.2, x + 7.9, y + 7.5);
        mgraphics.stroke();
    } else { // Morph: HP solid curve + dotted LP/BP hints
        mgraphics.move_to(x + 3.5, y + 7.5);
        mgraphics.curve_to(x + 3.5, y + 4.0, x + 4.5, y + 1.5, x + 7.5, y + 1.5);
        mgraphics.line_to(x + 14.0, y + 1.5);
        mgraphics.stroke();
        for (var d = 0; d < 3; d++) fillRect(x + d * 2.0, y + 1.0, 1.1, 1.1, c, a === undefined ? 1.0 : a);
        for (var v = 0; v < 3; v++) fillRect(x + 8.5, y + 3.0 + v * 1.8, 1.1, 1.1, c, a === undefined ? 1.0 : a);
    }
}

function drawWtRoutingIcon(x, y, route, c) {
    setc(c, 1.0);
    mgraphics.set_line_width(1.2);
    if (route === 0) { // Serial: -[]-[]-
        line(x, y + 3.0, x + 2.8, y + 3.0, c, 1.0, 1.2);
        mgraphics.rectangle(x + 2.8, y + 0.8, 3.8, 4.4); mgraphics.stroke();
        line(x + 6.6, y + 3.0, x + 9.2, y + 3.0, c, 1.0, 1.2);
        mgraphics.rectangle(x + 9.2, y + 0.8, 3.8, 4.4); mgraphics.stroke();
        line(x + 13.0, y + 3.0, x + 15.8, y + 3.0, c, 1.0, 1.2);
    } else if (route === 1) { // Parallel: single input splits to two stacked boxes, merges to single output
        line(x, y + 3.0, x + 2.8, y + 3.0, c, 1.0, 1.2);
        line(x + 2.8, y + 0.2, x + 2.8, y + 5.8, c, 1.0, 1.2);
        line(x + 2.8, y + 0.2, x + 5.5, y + 0.2, c, 1.0, 1.2);
        line(x + 2.8, y + 5.8, x + 5.5, y + 5.8, c, 1.0, 1.2);
        mgraphics.rectangle(x + 5.5, y - 1.5, 4.0, 3.4); mgraphics.stroke();
        mgraphics.rectangle(x + 5.5, y + 4.1, 4.0, 3.4); mgraphics.stroke();
        line(x + 9.5, y + 0.2, x + 12.2, y + 0.2, c, 1.0, 1.2);
        line(x + 9.5, y + 5.8, x + 12.2, y + 5.8, c, 1.0, 1.2);
        line(x + 12.2, y + 0.2, x + 12.2, y + 5.8, c, 1.0, 1.2);
        line(x + 12.2, y + 3.0, x + 15.4, y + 3.0, c, 1.0, 1.2);
    } else { // Split: two separate horizontal input lines into two stacked boxes, merging to single output
        line(x, y + 0.2, x + 5.5, y + 0.2, c, 1.0, 1.2);
        line(x, y + 5.8, x + 5.5, y + 5.8, c, 1.0, 1.2);
        mgraphics.rectangle(x + 5.5, y - 1.5, 4.0, 3.4); mgraphics.stroke();
        mgraphics.rectangle(x + 5.5, y + 4.1, 4.0, 3.4); mgraphics.stroke();
        line(x + 9.5, y + 0.2, x + 12.2, y + 0.2, c, 1.0, 1.2);
        line(x + 9.5, y + 5.8, x + 12.2, y + 5.8, c, 1.0, 1.2);
        line(x + 12.2, y + 0.2, x + 12.2, y + 5.8, c, 1.0, 1.2);
        line(x + 12.2, y + 3.0, x + 15.4, y + 3.0, c, 1.0, 1.2);
    }
}

function focusBrackets(x, y, w, h, c) {
    var L = 2.8;
    line(x, y, x + L, y, c, 1.0, 1.0); line(x, y, x, y + L, c, 1.0, 1.0);
    line(x + w, y, x + w - L, y, c, 1.0, 1.0); line(x + w, y, x + w, y + L, c, 1.0, 1.0);
    line(x, y + h, x + L, y + h, c, 1.0, 1.0); line(x, y + h, x, y + h - L, c, 1.0, 1.0);
    line(x + w, y + h, x + w - L, y + h, c, 1.0, 1.0); line(x + w, y + h, x + w, y + h - L, c, 1.0, 1.0);
}

function wtCaret(x, y, c) {
    polygon([[x, y], [x + 5.4, y], [x + 2.7, y + 3.0]], c);
}

// Wavetable dial: large (Frequency, r=17.8, value centered below) or small (Res, r=9.2, value to the bottom-right)
function wtDial(key, cx, cy, r, label, acc, on, isRes) {
    var v = paramValue(key);
    var n = (key === "filt_cutoff" || key === "filt2_cutoff") ? (Math.log(Math.max(20, Math.min(20000, v)) / 20) / Math.log(1000)) : toNorm(key, v);
    var a0 = isRes ? Math.PI * 0.50 : Math.PI * 0.75;
    var a1 = isRes ? Math.PI * 1.98 : Math.PI * 2.25;
    var ang = a0 + n * (a1 - a0);
    var trackCol = on ? RC.dialFg : RC.dialFgOff;
    var arcCol = on ? acc : RC.arcOff;
    var needleCol = on ? RC.dialNeedle : RC.dialNeedleOff;
    var lw = isRes ? 2.4 : 2.6;
    strokeArc(cx, cy, r, a0, a1, trackCol, 1.0, lw);
    var from = BIPOLAR_KEYS[key] ? (a0 + a1) * 0.5 : a0;
    var lo = Math.min(from, ang), hi = Math.max(from, ang);
    if (hi - lo > 0.012) strokeArc(cx, cy, r, lo, hi, arcCol, 1.0, lw);

    var md = knobMod(key);
    if (md && on) {
        var mr = r + 2.4;
        strokeArc(cx, cy, mr, a0 + clamp01(n - md.ext) * (a1 - a0), a0 + clamp01(n + md.ext) * (a1 - a0), RC.a_mod, 0.55, 1.4);
    }
    line(cx, cy, cx + Math.cos(ang) * (r - 0.5), cy + Math.sin(ang) * (r - 0.5), needleCol, 1.0, isRes ? 1.7 : 2.0);

    var hot = (hoverKey === key) || (drag && drag.key === key);
    var txtCol = hot ? RC.white : RC.text;
    if (isRes) {
        text(label, cx - r + 0.5, cy - r - 4.8, 10.0, RC.text, false, 0);
        var resStr = (v < 0.05 ? "0.0" : (v < 10 && Math.abs(v - Math.round(v)) > 0.05 ? v.toFixed(1) : Math.round(v))) + " %";
        text(resStr, cx + r - 5.0, cy + r + 2.2, 10.0, txtCol, hot, 0);
        zone("knob", cx - r - 3, cy - r - 13, r * 2 + 26, r * 2 + 18, { key: key });
    } else {
        text(label, cx, cy - r - 4.8, 10.0, RC.text, false, 1);
        var valStr = v >= 1000 ? (v / 1000).toFixed(2) + " kHz" : (v >= 100 ? Math.round(v) + " Hz" : v.toFixed(1) + " Hz");
        text(valStr, cx, cy + r + 11.8, 10.0, txtCol, hot, 1);
        zone("knob", cx - r - 8, cy - r - 13, r * 2 + 16, r * 2 + 28, { key: key });
    }
}

function fmtHz(hz) { return hz >= 1000 ? (hz / 1000).toFixed(1) + "k" : Math.round(hz) + "Hz"; }

function paintFilterStrip(sx, xOff, num) {
    var isF1 = num === 1;
    var onKey = isF1 ? "filt_on" : "filt2_on";
    var typeKey = isF1 ? "filt_type" : "filt2_type";
    var slopeKey = isF1 ? "filt_slope" : "filt2_slope";
    var circKey = isF1 ? "filt_circuit" : "filt2_circuit";
    var on = Math.round(paramValue(onKey)) > 0;
    var ft = Math.round(paramValue(typeKey));
    var sl = Math.round(paramValue(slopeKey));
    var cir = Math.round(paramValue(circKey));
    var bx = sx + xOff;
    var orange = RC.sel, cyan = RC.cyan, offCol = RC.lcdDim;

    // 1. Enable square button (9.0 x 9.0 at y = 5.5)
    var sqX = bx + 1.0, sqY = 5.5, sqS = 9.0;
    if (on) {
        fillRect(sqX, sqY, sqS, sqS, orange, 1.0);
    } else {
        setc(orange, 1.0);
        mgraphics.set_line_width(1.1);
        mgraphics.rectangle(sqX + 0.5, sqY + 0.5, sqS - 1, sqS - 1);
        mgraphics.stroke();
    }
    actZone(sqX - 2, 3, 13, 14, function () {
        filtFocus = num;
        setParamFromFace(onKey, on ? 0 : 1);
    }, { key: onKey });

    // 2. Filter type icon + caret dropdown
    var tyX = bx + 17.5;
    if (openMenu && openMenu.key === typeKey) focusBrackets(tyX - 3.0, 4.5, 27.0, 11.0, orange);
    drawWtFilterIcon(tyX, 5.5, ft, on ? orange : offCol, 1.0);
    wtCaret(tyX + 16.0, 9.0, on ? orange : offCol);
    zone("button", tyX - 3, 3, 28, 14, { action: "menu", key: typeKey, w2: 28.0, below: true, wtMenu: "type", anchorX: tyX - 3.0, anchorY: 16.0 });

    // 3. Slope badge [12] / [24]
    var slX = bx + 46.5, slY = 4.8, slW = 14.5, slH = 10.6;
    fillRR(slX, slY, slW, slH, 1.3, on ? cyan : offCol, 1.0);
    text(sl ? "24" : "12", slX + slW * 0.5, slY + 8.3, 9.2, RC.wave, true, 1);
    actZone(slX - 1, 3, slW + 2, 14, function () {
        filtFocus = num;
        setParamFromFace(slopeKey, sl ? 0 : 1);
    }, { key: slopeKey });

    // 4. Circuit selector (Clean / OSR / MS2 / SMP / PRD)
    var crX = bx + 68.0;
    var cirNames = ["Clean", "OSR", "MS2", "SMP", "PRD"];
    if (openMenu && openMenu.key === circKey) focusBrackets(crX - 3.0, 4.5, 38.5, 11.0, orange);
    text(cirNames[cir] || "Clean", crX, 13.0, 10.0, on ? orange : offCol, false, 0);
    wtCaret(crX + 28.0, 9.0, on ? orange : offCol);
    zone("button", crX - 3, 3, 40, 14, { action: "menu", key: circKey, w2: 44.0, below: true, wtMenu: "circuit", anchorX: crX - 3.0, anchorY: 16.0 });
}

// Rounded rectangle with rounded top corners and flat bottom corners (for the Wavetable black LCD face)
function fillTopRR(x, y, w, h, r, c, a) {
    setc(c, a);
    var d = Math.min(r, w * 0.5, h * 0.5);
    mgraphics.move_to(x, y + h);
    mgraphics.line_to(x, y + d);
    mgraphics.arc(x + d, y + d, d, Math.PI, Math.PI * 1.5);
    mgraphics.line_to(x + w - d, y);
    mgraphics.arc(x + w - d, y + d, d, Math.PI * 1.5, Math.PI * 2.0);
    mgraphics.line_to(x + w, y + h);
    mgraphics.close_path();
    mgraphics.fill();
}

function paintFilterSection(sx) {
    filtX = sx;
    var acc = RC.cyan, orange = RC.sel, grey = RC.sub;
    var on1 = curFiltOn > 0, on2 = Math.round(paramValue("filt2_on")) > 0;
    var osc2On = Math.round(paramValue("osc2_on")) > 0, subOn = Math.round(paramValue("sub_on")) > 0;
    var ft1 = Math.round(paramValue("filt_type")), ft2 = Math.round(paramValue("filt2_type"));
    var sl1 = Math.round(paramValue("filt_slope")), sl2 = Math.round(paramValue("filt2_slope"));
    var cir1 = Math.round(paramValue("filt_circuit")), cir2 = Math.round(paramValue("filt2_circuit"));
    var fc1 = paramValue("filt_cutoff"), res1 = paramValue("filt_res"), m1 = paramValue("filt_morph") * 0.01;
    var fc2 = paramValue("filt2_cutoff"), res2 = paramValue("filt2_res"), m2 = paramValue("filt2_morph") * 0.01;
    var route = Math.round(paramValue("filt_route"));
    var q1 = resToQ(res1), q2 = resToQ(res2);

    // Wavetable section panel: flush full height (y = 0..169) with only a 1 px separator between sections
    fillRect(sx, 0, FILT_W, 169, RC.panel, 1.0);
    fillRect(sx, 0, FILT_W, 95.5, RC.wave, 1.0);

    // Top control bar: Filter 1 strip | divider | Filter 2 strip
    paintFilterStrip(sx, 5.0, 1);
    line(sx + 116.5, 5.2, sx + 116.5, 14.8, RC.line, 1.0, 1.0);
    paintFilterStrip(sx, 123.5, 2);

    // Filter response graph (y = 18..79.0)
    // In Split mode (route === 2), Filter 2 is live & colored (orange) when Oscillator 2 or Sub is enabled!
    var splitF2Live = on2 && (route === 1 || (route === 2 && (osc2On || subOn)));
    var g = filterGeom();
    var cols = 140, c;
    if (route === 0) {
        // Serial: one combined cyan curve
        var top = [];
        for (c = 0; c <= cols; c++) {
            var hz = 20 * Math.pow(1000, c / cols);
            var db = combinedFilterDb(hz, on1, ft1, fc1, q1, m1, sl1, on2, ft2, fc2, q2, m2, sl2, route);
            top.push([g.gx + g.gw * (c / cols), fFy(g, db)]);
        }
        var anyOn = on1 || on2;
        strokePathClipped(top, 78.6, acc, anyOn ? 1.0 : 0.38, 1.65);
    } else {
        // Parallel (route === 1) or Split (route === 2): two separate curves (Filter 2 drawn first, Filter 1 on top)
        var top1 = [], top2 = [];
        for (c = 0; c <= cols; c++) {
            var hz2 = 20 * Math.pow(1000, c / cols);
            var db1 = on1 ? filterDb(ft1, hz2 / fc1, q1, m1, sl1) : 0;
            var db2 = on2 ? filterDb(ft2, hz2 / fc2, q2, m2, sl2) : 0;
            var xx = g.gx + g.gw * (c / cols);
            top1.push([xx, fFy(g, db1)]);
            top2.push([xx, fFy(g, db2)]);
        }
        var c2Col = on2 ? (splitF2Live ? orange : RC.lcdText) : RC.lcdDim;
        var c1Col = on1 ? acc : RC.lcdDim;
        strokePathClipped(top2, 78.6, c2Col, on2 ? 1.0 : 0.38, 1.65);
        strokePathClipped(top1, 78.6, c1Col, on1 ? 1.0 : 0.38, 1.65);
    }

    // Per-voice cutoff telemetry (kept for reactive voice tracking while notes play)
    filtDots = [];
    if (on1) {
        var vs = filterVoices();
        var k;
        for (k = vs.length - 1; k >= 1; k--) strokePathClipped(responsePath(g, ft1, voiceCutHz[vs[k]], q1), 78.6, acc, Math.max(0.08, 0.18 - 0.02 * k), 0.9);
        for (k = 0; k < vs.length; k++) {
            var hzv = voiceCutHz[vs[k]];
            var px = Math.min(g.gx + g.gw, fFx(g, hzv)), py = fFy(g, filterDb(ft1, 1, q1, m1, sl1));
            var a2 = k === 0 ? 1.0 : Math.max(0.3, 0.72 - 0.11 * k);
            filtDots.push({ v: vs[k], x: px, y: py, hz: hzv, alpha: a2, rank: k });
        }
    }

    // Numbered circular handles (1 and 2)
    var h1x = fFx(g, fc1), h1y = 73.0 - clamp01(res1 / 100) * 44.0;
    var h2x = fFx(g, fc2), h2y = 73.0 - clamp01(res2 / 100) * 44.0;
    var hOrder = filtFocus === 1 ? [2, 1] : [1, 2];
    for (var hi = 0; hi < 2; hi++) {
        var hn = hOrder[hi];
        var hx = hn === 1 ? h1x : h2x;
        var hy = hn === 1 ? h1y : h2y;
        var hon = hn === 1 ? on1 : on2;
        var hcol;
        if (!hon) hcol = RC.lcdDim;
        else if (route === 0) hcol = orange;
        else if (hn === 1) hcol = acc;
        else hcol = splitF2Live ? orange : RC.lcdText;
        var hr = 6.0;
        var isSolid = (!hon) || (route > 0 && ((hn === 1 && filtFocus === 1 && splitF2Live) || (hn === 2 && (filtFocus === 2 || !splitF2Live))));
        if (isSolid) {
            circle(hx, hy, hr, hcol, 1.0);
            text(String(hn), hx, hy + 3.1, 8.5, RC.wave, true, 1);
        } else {
            circle(hx, hy, hr, RC.wave, 1.0);
            strokeArc(hx, hy, hr - 0.5, 0, Math.PI * 2, hcol, 1.0, 1.35);
            text(String(hn), hx, hy + 3.1, 8.5, hcol, true, 1);
        }
        zone("hdl", hx - 7.5, hy - 7.5, 15, 15, { id: hn === 1 ? "filt" : "filt2", cx: hx, cy: hy, num: hn });
    }

    // Routing strip (y = 79.0..95.5)
    line(sx, 79.0, sx + FILT_W, 79.0, RC.line, 1.0, 1.1);
    var routeNames = ["Serial", "Parallel", "Split"];
    drawWtRoutingIcon(sx + 8.5, 84.5, route, RC.sub);
    var rName = routeNames[route] || "Serial";
    var rCaretX = route === 1 ? sx + 66.0 : (route === 2 ? sx + 55.0 : sx + 62.0);
    if (openMenu && openMenu.key === "filt_route") focusBrackets(sx + 27.5, 81.2, rCaretX - (sx + 27.5) + 8.0, 12.2, RC.lcdText);
    text(rName, sx + 30.0, 90.5, 10.0, RC.lcdText, false, 0);
    wtCaret(rCaretX, 86.2, RC.lcdText);
    zone("button", sx + 6, 79.5, 70, 15.5, { action: "menu", key: "filt_route", w2: 64, below: true, wtMenu: "route", anchorX: sx + 27.5, anchorY: 95.5 });

    // Bottom parameter area (y = 95.5..167): Left half (Filter 1) | vertical divider | Right half (Filter 2)
    line(sx + 116.5, 101.5, sx + 116.5, 163.5, RC.divider, 1.0, 1.1);

    // Filter 1 controls: Res (small dial at top-left), Frequency (large dial on right), Drive / Morph box below Res
    wtDial("filt_res", sx + 19.0, 121.0, 9.2, "Res", acc, on1, true);
    wtDial("filt_cutoff", sx + 79.5, 128.5, 17.8, "Frequency", acc, on1, false);

    // Filter 1 Drive (or Morph when Morph type is active)
    var f1SubKey = (ft1 === 4 && cir1 === 0) ? "filt_morph" : "filt_drive";
    var f1SubLab = f1SubKey === "filt_morph" ? "Morph" : "Drive";
    text(f1SubLab, sx + 11.0, 144.8, 10.0, RC.text, false, 0);
    var dbX1 = sx + 9.0, dbY1 = 149.2, dbW1 = 42.5, dbH1 = 13.0;
    fillRect(dbX1, dbY1, dbW1, dbH1, on1 ? RC.textBg : mixc(RC.panel, RC.textBg, 0.45), 1.0);
    setc(RC.contrastFrame, on1 ? 0.95 : 0.45);
    mgraphics.set_line_width(1.0);
    mgraphics.rectangle(dbX1 + 0.5, dbY1 + 0.5, dbW1 - 1, dbH1 - 1);
    mgraphics.stroke();
    var drv1 = paramValue(f1SubKey);
    var drv1Str = f1SubKey === "filt_morph" ? Math.round(drv1) + " %" : (drv1 * 0.24).toFixed(2) + " dB";
    text(drv1Str, dbX1 + dbW1 * 0.5, dbY1 + 9.8, 9.5, on1 ? RC.text : RC.arcOff, false, 1);
    zone("value", dbX1, dbY1, dbW1, dbH1, { key: f1SubKey, norm: true });
    zone("value", sx + 54, 157, 48, 9, { key: f1SubKey === "filt_morph" ? "filt_drive" : "filt_morph", norm: true });

    // Filter 2 controls: Frequency (large dial on left), Res (small dial at top-right), Drive / Morph when active
    wtDial("filt2_cutoff", sx + 155.5, 128.5, 17.8, "Frequency", acc, on2, false);
    wtDial("filt2_res", sx + 198.0, 121.0, 9.2, "Res", acc, on2, true);
    var showDrv2 = (cir2 > 0 || paramValue("filt2_drive") > 0.01);
    var showMph2 = (ft2 === 4);
    var dbX2 = sx + 185.0, dbY2 = 149.2, dbW2 = 42.5, dbH2 = 13.0;
    if (showDrv2 || showMph2) {
        var f2SubKey = (showMph2 && !showDrv2) ? "filt2_morph" : "filt2_drive";
        var f2SubLab = f2SubKey === "filt2_morph" ? "Morph" : "Drive";
        text(f2SubLab, sx + 187.0, 144.8, 10.0, RC.text, false, 0);
        fillRect(dbX2, dbY2, dbW2, dbH2, on2 ? RC.textBg : mixc(RC.panel, RC.textBg, 0.45), 1.0);
        setc(RC.contrastFrame, on2 ? 0.95 : 0.45);
        mgraphics.set_line_width(1.0);
        mgraphics.rectangle(dbX2 + 0.5, dbY2 + 0.5, dbW2 - 1, dbH2 - 1);
        mgraphics.stroke();
        var drv2 = paramValue(f2SubKey);
        var drv2Str = f2SubKey === "filt2_morph" ? Math.round(drv2) + " %" : (drv2 * 0.24).toFixed(2) + " dB";
        text(drv2Str, dbX2 + dbW2 * 0.5, dbY2 + 9.8, 9.5, on2 ? RC.text : RC.arcOff, false, 1);
        zone("value", dbX2, dbY2, dbW2, dbH2, { key: f2SubKey, norm: true });
    } else {
        zone("value", dbX2, dbY2, dbW2, dbH2, { key: "filt2_drive", norm: true });
    }
    zone("value", sx + 124, 157, 48, 9, { key: "filt2_morph", norm: true });
}

// ---------------------------------------------------------------------------
// Engine section: engine pills, character, the engine's knobs, Pitch / Speed / Pos
// ---------------------------------------------------------------------------

function engineLayout(modeOverride, isWtOverride) {
    // returns { head: {key, labels} | null, knobs: [{key,label,opts} | {menu:true}] }
    var osc = activeOsc();
    var isWt = isWtOverride !== undefined ? isWtOverride : (Math.round(paramValue(osc.typeKey)) > 0);
    if (isWt) {
        var fx = Math.round(paramValue(osc.fxKey));
        var fxLabs = fx === 1 ? ["Tune", "Amt"] : (fx === 2 ? ["PW", "Sync"] : ["Warp", "Fold"]);
        return {
            head: { key: osc.fxKey, labels: ["None", "Fm", "Classic", "Modern"] },
            knobs: [
                { key: osc.fx1Key, label: fxLabs[0], opts: { dim: fx === 0 } },
                { key: osc.fx2Key, label: fxLabs[1], opts: { dim: fx === 0 } }
            ]
        };
    }
    var m = modeOverride !== undefined ? modeOverride : Math.round(paramValue(osc.modeKey));
    var ch;
    if (m === 0) {
        ch = Math.round(paramValue("rp_char"));
        var labs = ch === 1 ? ["Crunch", "Tape"] : (ch === 2 ? ["Bits", "Color"] : ["Dist", "Color"]);
        return { head: { key: "rp_char", labels: ["Clean", "Analog", "Digital"] },
            knobs: [{ key: "rp_dist", label: labs[0], opts: { dim: ch === 0 } }, { key: "rp_color", label: labs[1], opts: { dim: ch === 0 } }] };
    }
    if (m === 3) {
        ch = Math.round(paramValue("sp_char"));
        if (ch === 0) return { head: { key: "sp_char", labels: ["Pure", "Reharm"] },
            knobs: [{ key: "formant", label: "Formant" }, { key: "sp_shift", label: "Shift" }] };
        var q = Math.round(paramValue("sp_quant"));
        return { head: { key: "sp_char", labels: ["Pure", "Reharm"] },
            knobs: [{ key: "sp_bend", label: "Bend" }, { menu: true }, { key: "sp_quant_amt", label: "Amt", opts: { dim: q === 0 } }] };
    }
    if (m === 1) {
        ch = Math.round(paramValue("cy_char"));
        var head = { key: "cy_char", labels: ["Pulse", "Partials", "Phase"] };
        if (ch === 0) return { head: head, knobs: [{ key: "formant", label: "Formant" }, { key: "cy_width", label: "Width" }] };
        if (ch === 1) return { head: head, knobs: [{ key: "formant", label: "Formant" }, { key: "cy_split", label: "Split" }, { key: "cy_fund", label: "Fund." }] };
        return { head: head, knobs: [{ key: "formant", label: "Formant" }, { key: "cy_mod", label: "Mod" }, { key: "cy_harm", label: "Harm." }] };
    }
    if (m === 2) return { head: null, title: "Granular cloud", knobs: [{ key: "grain_size", label: "Size" }, { key: "grain_spray", label: "Spray" }] };
    return { head: null, title: "Grain pool", knobs: [{ key: "grain_size", label: "Size" },
        { key: "fr_density", label: "Density", opts: { dim: Math.round(paramValue("fr_use_density")) === 0 } },
        { key: "fr_motion", label: "Motion" }] };
}


var PILL_W = { 0: 33, 3: 35, 1: 30, 2: 35, 4: 39 };

// Helper: draw the 6 engine pills ([Repitch][Spectral][Cycles][Textures][Fragments] | [Wavetable]) at (px0, py)
var PILL_W_WIDE = { 0: 38, 3: 41, 1: 35, 2: 41, 4: 46 };
function paintModePillsRow(px0, py, isWt, actMode) {
    var px = px0;
    for (var e = 0; e < ENGINE_ORDER.length; e++) {
        var m = ENGINE_ORDER[e], pw = PILL_W_WIDE[m], on = !isWt && actMode === m;
        fillRR(px, py, pw, 12, 3, on ? RC.sel : RC.raised, 1);
        text(MODE_NAMES[m], px + pw * 0.5, py + 9, 7.2, on ? RC.dark : RC.sub, on, 1);
        zone("button", px, py, pw, 12, { action: "engine", engine: m });
        px += pw + 3.0;
    }
    line(px + 4.0, py, px + 4.0, py + 12.0, RC.sub, 0.75, 1.2);
    px += 11.0;
    var wtW = 49;
    fillRR(px, py, wtW, 12, 3, isWt ? RC.sel : RC.raised, 1);
    text("Wavetable", px + wtW * 0.5, py + 9, 7.2, isWt ? RC.dark : RC.sub, isWt, 1);
    zone("button", px, py, wtW, 12, { action: "engine_wt" });
    return px + wtW;
}

// Helper: draw horizontal value bar (Ableton value-slider style, always showing both label and value)
function hValueBar(key, x, y, w, h, label, acc, dimmed) {
    var v = paramValue(key);
    var n = toNorm(key, v);
    var al = dimmed ? 0.45 : 1.0;
    fillRect(x, y, w, h, RC.textBg, al);
    setc(RC.contrastFrame, al);
    mgraphics.set_line_width(1.0);
    mgraphics.rectangle(x + 0.5, y + 0.5, w - 1, h - 1);
    mgraphics.stroke();
    var bip = !!BIPOLAR_KEYS[key];
    var bx0 = bip ? (x + w * 0.5 + Math.min(0, n - 0.5) * (w - 2)) : (x + 1);
    var bw0 = bip ? (Math.abs(n - 0.5) * (w - 2)) : (n * (w - 2));
    if (bw0 > 0.5) fillRect(bx0, y + 1, bw0, h - 2, mixc(RC.textBg, acc, 0.38), al);
    var fs = w < 58 ? 6.5 : (w < 72 ? 7.4 : 7.8);
    var pad = w < 58 ? 2.0 : (w < 72 ? 3.5 : 4.0);
    text(label, x + pad, y + h - 3.3, fs, RC.sub, false, 0, al);
    text(fmtParam(key, v), x + w - pad, y + h - 3.3, fs, dimmed ? RC.sub : acc, false, 2, al);
    zone("value", x, y, w, h, { key: key, norm: true });
}

// Helper: render a single mode-setting bar or Quant dropdown pill
function paintSettingBarItem(kItem, bx, by, bw, bh, acc) {
    if (kItem.menu) {
        var qv = Math.round(paramValue("sp_quant"));
        fillRR(bx, by, bw, bh, 2.5, RC.raised);
        text("Quant", bx + 3.5, by + bh - 3.4, 7.4, RC.sub, false, 0);
        text(["Off", "Oct", "Key"][qv], bx + bw - 11, by + bh - 3.4, 7.4, RC.text, false, 2);
        caret(bx + bw - 6, by + bh * 0.5 - 2, RC.sub);
        zone("button", bx, by, bw, bh, { action: "menu", key: "sp_quant", mw: 80 });
    } else {
        hValueBar(kItem.key, bx, by, bw, bh, kItem.label, acc, !!(kItem.opts && kItem.opts.dim));
    }
}

function paintFreezeBtn(x, y, s) {
    fillRR(x, y, s, s, 2.5, curFreeze ? RC.sel : RC.raised, 1);
    iconSnow(x + s * 0.5, y + s * 0.5, curFreeze ? RC.dark : RC.sub, 0.85);
    zone("button", x, y, s, s, { action: "freeze" });
}

function paintEngineStrip() {
    var x = STRIP.x, y = STRIP.y, w = STRIP.w, h = STRIP.h;
    panelBox(x, y, w, h);
    if (oscTab === 2) {
        paintSubStrip(x, y, w, h);
        return;
    }
    var osc = activeOsc();
    var isWt = Math.round(paramValue(osc.typeKey)) > 0;
    var actMode = Math.round(paramValue(osc.modeKey));
    var acc = isWt ? RC.sel : RC.cyan;
    var scanOn = !isWt && actMode !== 0;
    var L = engineLayout(actMode, isWt);
    var nk = L.knobs.length;

    // Left column (x+4 .. x+280). Sample mode keeps Speed, Pos and Freeze in their own column.
    // Wavetable leaves that column out and gives the mode controls the full width.
    var leftX = x + 4, leftW = 276;
    var modeW = isWt ? leftW : leftW - 98;
    var knobW = 66, knobGap = 4;
    if (!isWt && nk >= 3) knobW = Math.floor((modeW - knobGap * (nk - 1)) / nk);
    paintModePillsRow(leftX, y + 3, isWt, actMode);
    if (L.head) {
        segCtl(L.head.key, leftX, y + 20, modeW, 13, L.head.labels, acc);
    } else if (actMode === 4) {
        segCtl("fr_use_density", leftX, y + 20, modeW, 13, ["Step Grid", "Density"], acc);
    } else {
        fillRR(leftX, y + 20, modeW, 13, 2.5, RC.raised, 0.7);
        text(L.title, leftX + modeW * 0.5, y + 29.5, 7.8, RC.sub, true, 1);
    }
    for (var i5a = 0; i5a < nk; i5a++) {
        paintSettingBarItem(L.knobs[i5a], leftX + i5a * (knobW + knobGap), y + 38, knobW, 16, acc);
    }
    if (!isWt) {
        var colX = leftX + modeW + 6;
        line(colX - 4, y + 18, colX - 4, y + h - 6, RC.divider, 0.7, 1);
        hValueBar("grain_motion", colX, y + 20, 92, 15, "Speed", acc, !scanOn);
        hValueBar(osc.posKey, colX, y + 38, 73, 16, "Pos", acc, !curFreeze);
        paintFreezeBtn(colX + 76, y + 38, 16);
    }

    line(x + 286, y + 4, x + 286, y + h - 4, RC.divider, 1.0, 1.0);

    // Right column stays the shared tuning row. Gain keeps its 50 px box.
    text("TUNING", x + 292, y + 12, 7.5, RC.sub, true, 0);
    valuePill(x + 412, y + 3, 22, Math.round(paramValue("unison_voices")) + "v", { key: "unison_voices", pxPerUnit: 6 }, RC.sel, false);
    valuePill(x + 436, y + 3, 24, Math.round(paramValue("unison_detune")) + "%", { key: "unison_detune" }, RC.sel, Math.round(paramValue("unison_voices")) <= 1);
    hValueBar(osc.pitchKey, x + 292, y + 20, 54, 15, "Pitch", acc, false);
    hValueBar(osc.detKey, x + 350, y + 20, 53, 15, "Fine", acc, false);
    hValueBar(osc.ratioKey, x + 407, y + 20, 53, 15, "Ratio", acc, false);
    hValueBar(osc.gainKey, x + 410, y + 38, 50, 16, "Gain", acc, false);
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
// Voice / Out section
// ---------------------------------------------------------------------------

function paintVoiceSection(sx) {
    var w = SECTIONS[4].w, acc = RC.cyan;
    panelBox(sx, SEC_Y, w, SEC_H);
    secTitle("VOICING", sx + 7, 14, RC.text);
    segCtl("mono_legato", sx + 7, 18, w - 14, 12, ["Poly", "Mono"], acc);
    var ks1 = [["poly_voices", "Poly"], ["unison_voices", "Unison"], ["unison_detune", "Detune"]];
    var ks2 = [["unison_width", "Width"], ["glide_ms", "Glide"], ["vel_sens", "Vel"]];
    for (var i = 0; i < 3; i++) rKnob(ks1[i][0], sx + 6 + (w - 12) * (i + 0.5) / 3, 52, 6.8, ks1[i][1], acc, {});
    for (var j = 0; j < 3; j++) rKnob(ks2[j][0], sx + 6 + (w - 12) * (j + 0.5) / 3, 89, 6.8, ks2[j][1], acc, {});
    hValueBar("fine_range", sx + 7, 108, w - 14, 14, "Fine Range", acc, false);
    line(sx + 7, 125, sx + w - 7, 125, RC.line, 1.0, 1.0);
    secTitle("OUT", sx + 7, 134, RC.text);
    rKnob("out_gain", sx + 34, 148, 7, "", acc, {});
    var my = 129;
    var L = [livePeakL, livePeakR];
    for (var m = 0; m < 2; m++) {
        var mx = sx + w - 38 + m * 9;
        fillRR(mx, my, 6, 34, 1.5, RC.track);
        var hh = clamp01(L[m]) * 34;
        if (hh > 0.5) fillRR(mx, my + 34 - hh, 6, hh, 1.5, L[m] > 0.9 ? RC.orange : acc, 0.95);
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
        else if (id === "matrix") paintMatrixSection(sx);
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
    out.push("WT", wtSel[0].cat, wtSel[0].idx, wtSel[1].cat, wtSel[1].idx);
    if (!isDefaultSectionOrder()) {
        out.push("R2O");
        out.push(encodeSectionOrder());
    }
    out.push("R2");
    out.push(foldMask);
    return out;
};

setvalueof = function () {
    var a = arrayfromargs(arguments);
    var hasR2 = false;
    if (a && a.length >= 3 && String(a[a.length - 2]) === "R2") {
        var m = Math.round(Number(a[a.length - 1]));
        a = a.slice(0, a.length - 2);
        hasR2 = true;
        if (isFinite(m)) {
            foldMask = Math.max(0, Math.min((1 << SECTIONS.length) - 1, m));
        }
    }
    if (a && a.length >= 3 && String(a[a.length - 2]) === "R2O") {
        var ord = Number(a[a.length - 1]);
        a = a.slice(0, a.length - 2);
        if (hasR2 && isFinite(ord)) decodeSectionOrder(ord);
    } else if (hasR2) {
        sectionOrder = [0, 1, 2, 3, 4];
    }
    if (a && a.length >= 5 && String(a[a.length - 5]) === "WT") {
        wtSel[0].cat = Math.max(0, Math.min(WT_USER, Math.round(Number(a[a.length - 4]) || 0)));
        wtSel[0].idx = Math.max(0, Math.round(Number(a[a.length - 3]) || 0));
        wtSel[1].cat = Math.max(0, Math.min(WT_USER, Math.round(Number(a[a.length - 2]) || 0)));
        wtSel[1].idx = Math.max(0, Math.round(Number(a[a.length - 1]) || 0));
        a = a.slice(0, a.length - 5);
        wtLoadedPath[0] = "";
        wtLoadedPath[1] = "";
        wtApplyOsc(0);
        wtApplyOsc(1);
    }
    if (hasR2) applyDeviceWidth();
    sharedSetvalueof.apply(null, a);
};

var sharedDropfile = dropfile;
dropfile = function () {
    var dropped = pathFromArgs(arguments);
    sharedDropfile.apply(null, arguments);
    if (!dropped || dropped === "none") return;
    if ((oscTab === 0 || oscTab === 1) && Math.round(paramValue(activeOsc().typeKey)) > 0) {
        wtSelectUser(oscTab === 1 ? 1 : 0);
    }
};

// Debug messages via #0-bsdebug for automated Live UI verification of Reactive 2's Mod Sources & Mod Matrix views:
//   messnamed("#0-bsdebug", "dbg_r2_view", matTab, envPage, envTab, openLoopMenu, foldMask)
function dbg_section_order(s0, s1, s2, s3, s4) {
    setSectionOrder([s0, s1, s2, s3, s4]);
}

function dbg_r2_view(mTab, pg, tb, loopMenu, fold) {
    if (fold !== undefined && fold >= 0) setFoldMask(Number(fold));
    if (mTab !== undefined && mTab >= 0) matTab = Math.max(0, Math.min(3, Math.round(Number(mTab))));
    if (pg !== undefined && pg >= 0) envPage = Math.round(Number(pg));
    if (tb !== undefined && tb >= 0) envTab = Math.round(Number(tb));
    if (loopMenu !== undefined) {
        if (Number(loopMenu) > 0) {
            var lk = envLoopKey();
            var bx = envX + 1, by = 1, bw = ENV_W - 2;
            var lbx = bx + bw - 44, lby = by + 20, lbh = 13;
            openMenu = { key: lk, x: lbx, y: lby + lbh + 1, w: 41, rowH: 13.5, wtEnvLoop: true, anchorX: lbx, anchorY: lby + lbh + 1 };
        } else {
            openMenu = null;
        }
    }
    mgraphics.redraw();
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


// slope from the dragged level of a segment's midpoint: the curve there is bend(base, s) = base^(4^-s)
function slopeFromMid(level, base) {
    level = Math.max(0.004, Math.min(0.996, level));
    base = Math.max(0.004, Math.min(0.996, base));
    var g = Math.log(level) / Math.log(base);
    return Math.max(-1, Math.min(1, -Math.log(g) / Math.log(4)));
}

var sharedPaintMenu = paintMenu;
paintMenu = function () {
    if (!openMenu) return;
    if (openMenu.wtList) { paintWtListMenu(); return; }
    if (openMenu.subMenu) { paintSubEnumMenu(); return; }
    if (openMenu.wtEnvLoop) {
        var m = openMenu;
        var items = ["None", "Trigger", "Loop"];
        var cur0 = Math.round(paramValue(m.key));
        var rowH0 = 13.5, h0 = items.length * rowH0 + 2;
        var mx0 = m.anchorX !== undefined ? m.anchorX : m.x;
        var my0 = m.anchorY !== undefined ? m.anchorY : m.y;
        var mw0 = m.w || 41;
        var cy1 = RC.cyan;
        fillRect(mx0, my0, mw0, h0, RC.wave, 1.0);
        setc(cy1, 1.0);
        mgraphics.set_line_width(1.0);
        mgraphics.rectangle(mx0 + 0.5, my0 + 0.5, mw0 - 1, h0 - 1);
        mgraphics.stroke();
        for (var i0 = 0; i0 < items.length; i0++) {
            var ry0 = my0 + 1 + i0 * rowH0;
            var on0 = i0 === cur0;
            if (on0) fillRect(mx0 + 1, ry0, mw0 - 2, rowH0, cy1, 1.0);
            text(items[i0], mx0 + 4, ry0 + 9.8, 8.5, on0 ? RC.wave : cy1, false, 0);
            zone("button", mx0, ry0, mw0, rowH0, { action: "menu_pick", key: m.key, value: i0 });
        }
        return;
    }
    var k = openMenu.key;
    if (k === "wt1_fx" || k === "wt2_fx") {
        // Wavetable wave-effect popup menu above the [Modern▾] selector at the bottom of the viewer (matches Screenshot 2.18.11)
        var curW = Math.round(paramValue(k));
        var fxItems = ["None", "Fm", "Classic", "Modern"];
        var mwW = 48.0, rhW = 13.0, mhW = fxItems.length * rhW + 2.0;
        var mxW = openMenu.x || (VIEW.x + 4), myW = (openMenu.y || (VIEW.y + VIEW.h - 16)) - mhW;
        fillRect(mxW, myW, mwW, mhW, RC.wave, 1.0);
        setc(RC.sel, 1.0);
        mgraphics.set_line_width(1.1);
        mgraphics.rectangle(mxW + 0.5, myW + 0.5, mwW - 1, mhW - 1);
        mgraphics.stroke();
        for (var wi = 0; wi < fxItems.length; wi++) {
            var wry = myW + 1.0 + wi * rhW;
            var wsel = curW === wi;
            if (wsel) fillRect(mxW + 1, wry, mwW - 2, rhW, RC.sel, 1.0);
            text(fxItems[wi], mxW + 4.5, wry + rhW * 0.5 + 3.2, 9.2, wsel ? RC.wave : RC.sel, false, 0);
            zone("button", mxW, wry, mwW, rhW, { action: "menu_pick", key: k, value: wi });
        }
        return;
    }
    if (k === "filt_type" || k === "filt2_type" || k === "filt_circuit" || k === "filt2_circuit" || k === "filt_route") {
        var isType = (k === "filt_type" || k === "filt2_type");
        var isRoute = (k === "filt_route");
        var cur = Math.round(paramValue(k));
        var mx = openMenu.x, my = 16.5, mw = isType ? 28.0 : (isRoute ? 64.0 : 44.0), mh = isRoute ? 44.0 : 72.0;
        if (isRoute) { mx = filtX + 6; my = 94.5; }
        fillRect(mx, my, mw, mh, RC.wave, 1.0);
        setc(RC.sel, 1.0);
        mgraphics.set_line_width(1.1);
        mgraphics.rectangle(mx + 0.5, my + 0.5, mw - 1, mh - 1);
        mgraphics.stroke();
        if (isType) {
            // Wavetable visual order in the dropdown: LP (0), HP (2), BP (1), Notch (3), Morph (4)
            var typeOrder = [0, 2, 1, 3, 4];
            var rowH = 13.8;
            for (var r = 0; r < 5; r++) {
                var val = typeOrder[r];
                var ry = my + 1.5 + r * rowH;
                var sel = cur === val;
                if (sel) fillRect(mx + 1, ry, mw - 2, rowH, RC.sel, 1.0);
                drawWtFilterIcon(mx + 6.5, ry + 2.5, val, sel ? RC.wave : RC.sel, 1.0);
                zone("button", mx, ry, mw, rowH, { action: "menu_pick", key: k, value: val });
            }
        } else {
            var names = isRoute ? ["Serial", "Parallel", "Split"] : ["Clean", "OSR", "MS2", "SMP", "PRD"];
            var rh = (mh - 2) / names.length;
            for (var i = 0; i < names.length; i++) {
                var ry2 = my + 1 + i * rh;
                var sel2 = cur === i;
                if (sel2) fillRect(mx + 1, ry2, mw - 2, rh, RC.sel, 1.0);
                text(names[i], mx + 4.5, ry2 + rh * 0.5 + 3.2, 9.2, sel2 ? RC.wave : RC.sel, false, 0);
                zone("button", mx, ry2, mw, rh, { action: "menu_pick", key: k, value: i });
            }
        }
        return;
    }
    sharedPaintMenu();
};

var sharedDoAction = doAction;
doAction = function (z) {
    if (z.action === "menu" && z.wtList) {
        if (openMenu && openMenu.key === z.key) { openMenu = null; mgraphics.redraw(); return; }
        var names = z.which === "cat" ? WT_CATS.slice() : wtTableNames(wtSel[z.osc].cat);
        openMenu = {
            key: z.key, wtList: true, which: z.which, osc: z.osc, names: names,
            cur: z.which === "cat" ? wtSel[z.osc].cat : wtSel[z.osc].idx,
            anchorX: z.anchorX, anchorY: z.anchorY, scroll: 0, w: z.w2 || 120
        };
        mgraphics.redraw();
        return;
    }
    if (z.action === "wt_pick") {
        if (z.which === "cat") wtSelect(z.osc, z.value, 0);
        else wtSelect(z.osc, wtSel[z.osc].cat, z.value);
        openMenu = null;
        mgraphics.redraw();
        return;
    }
    if (z.action === "menu" && z.subMenu) {
        if (openMenu && openMenu.key === z.key) { openMenu = null; mgraphics.redraw(); return; }
        openMenu = { key: z.key, x: z.anchorX, y: z.anchorY, w: z.w2, rowH: 13, subMenu: true, anchorX: z.anchorX, anchorY: z.anchorY };
        mgraphics.redraw();
        return;
    }
    if (z.action === "menu_pick" && z.key === "sub_wave") {
        applySubWavePreset(z.value);
        openMenu = null;
        mgraphics.redraw();
        return;
    }
    if (z.action === "osc_tab") {
        oscTab = z.tab || 0;
        mgraphics.redraw();
        return;
    }
    if (z.action === "osc_toggle") {
        if (z.tab !== undefined) oscTab = z.tab;
        setParamFromFace(z.key, Math.round(paramValue(z.key)) > 0 ? 0 : 1);
        mgraphics.redraw();
        return;
    }
    if (z.action === "engine") {
        var oscE = activeOsc();
        setParamFromFace(oscE.typeKey, 0);
        setParamFromFace(oscE.modeKey, z.engine);
        mgraphics.redraw();
        return;
    }
    if (z.action === "engine_wt") {
        var oscW = activeOsc();
        setParamFromFace(oscW.typeKey, 1);
        mgraphics.redraw();
        return;
    }
    if (z.action === "menu" && z.wtMenu) {
        filtFocus = /^filt2/.test(z.key) ? 2 : 1;
        if (openMenu && openMenu.key === z.key) { openMenu = null; mgraphics.redraw(); return; }
        openMenu = { key: z.key, x: z.anchorX, y: z.anchorY, w: z.w2, rowH: 12 };
        mgraphics.redraw();
        return;
    }
    if (z.action === "menu_pick" && /^filt/.test(z.key)) {
        filtFocus = /^filt2/.test(z.key) ? 2 : 1;
    }
    sharedDoAction(z);
};

function hdlMove(id, x, y) {
    var gx = x + drag.ox, gy = y + drag.oy;
    if (id === "filt" || id === "filt2") {
        var g = filterGeom();
        var isF1 = id === "filt";
        setIfChanged(isF1 ? "filt_cutoff" : "filt2_cutoff", fHz(g, gx));
        var resPct = clamp01((73.0 - gy) / 44.0) * 100;
        setIfChanged(isF1 ? "filt_res" : "filt2_res", resPct);
        return;
    }
    var e = envGeom(), k = e.keys, vk = e.valKeys;
    var which = id.substring(4);
    var lvl = clamp01((e.gb - gy) / (e.gb - e.gy));
    if (which === "I") {
        if (vk[0]) setIfChanged(vk[0], lvl * 100);
    } else if (which === "A") {
        setIfChanged(k[0], fromNorm(k[0], (gx - e.gx) / e.smA));
        if (vk[1] && Math.abs(y - drag.y0) > 0.5) setIfChanged(vk[1], lvl * 100);
    } else if (which === "D") {
        setIfChanged(k[1], fromNorm(k[1], (gx - e.xA - e.minSeg) / e.sm));
        setIfChanged(k[2], lvl * 100);
    } else if (which === "R") {
        setIfChanged(k[3], fromNorm(k[3], (gx - e.xS - e.minSeg) / e.sm));
        if (vk[3] && envPage >= 1 && Math.abs(y - drag.y0) > 0.5) setIfChanged(vk[3], lvl * 100);
    } else if (which === "As") {
        var spanA = e.peakL - e.initL;
        var normA = Math.abs(spanA) > 0.05 ? (lvl - e.initL) / spanA : lvl;
        setIfChanged(e.slopeKeys[0], slopeFromMid(normA, 0.5) * 100);
    } else if (which === "Ds") {
        var spanD = e.peakL - e.sus;
        var normD = Math.abs(spanD) > 0.05 ? (lvl - e.sus) / spanD : (lvl - e.sus) / Math.max(0.12, 1 - e.sus);
        setIfChanged(e.slopeKeys[1], slopeFromMid(normD, Math.pow(0.5, ENV_POW)) * 100);
    } else if (which === "Rs") {
        var spanR = e.sus - e.finalL;
        var normR = Math.abs(spanR) > 0.05 ? (lvl - e.finalL) / spanR : lvl / Math.max(0.12, e.sus);
        setIfChanged(e.slopeKeys[2], slopeFromMid(normR, Math.pow(0.5, ENV_POW)) * 100);
    }
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
    if (z && z.kind === "wt_pos") {
        if (openMenu) openMenu = null;
        drag = { wtPos: true, key: z.key, top: z.top, h: z.h };
        setIfChanged(z.key, wtPosFromY(y, z.top, z.h));
        mgraphics.redraw();
        return;
    }
    if (z && z.kind === "sub_harm") {
        if (openMenu) openMenu = null;
        if (drag && drag.captured) setCursorHidden(false);
        drag = { subHarm: true, subLast: null, subLastLvl: 0 };
        drawSubHarmonicsAt(x, y);
        mgraphics.redraw();
        return;
    }
    if (z && (z.kind === "hdl" || z.kind === "act")) {
        if (openMenu) { openMenu = null; mgraphics.redraw(); return; }
        if (drag && drag.captured) setCursorHidden(false);
        drag = null;
        sbDrag = null;
        if (z.kind === "act") {
            var preMask = foldMask;
            z.fn();
            if (z.secIdx !== undefined) {
                sbDrag = {
                    secIdx: z.secIdx,
                    startSlot: z.slot,
                    curSlot: z.slot,
                    startY: y,
                    curY: y,
                    moved: false,
                    preMask: preMask
                };
            }
            mgraphics.redraw();
            return;
        }
        if (z.num) filtFocus = z.num;
        drag = { hdl: z.id, ox: z.cx - x, oy: z.cy - y, x0: x, y0: y };
        hoverHdl = z.id;
        mgraphics.redraw();
        return;
    }
    sbDrag = null;
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
    if (openMenu && openMenu.wtList && openMenu.menuRect && d[1] !== 0) {
        var r = openMenu.menuRect;
        if (x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]) {
            var vis = Math.min((openMenu.names || []).length, 12);
            var maxScroll = Math.max(0, (openMenu.names || []).length - vis);
            openMenu.scroll = Math.max(0, Math.min(maxScroll, (openMenu.scroll || 0) + (d[1] > 0 ? -1 : 1)));
            mgraphics.redraw();
            return;
        }
    }
    if (d[1] !== 0 && inWaveRect(x, y)) zoomViewAt(x, wheelZoomFactor(d[1]));
}

ondrag = function (x, y, but, cmd, shift) {
    if (sbDrag) {
        if (!but) {
            sbDrag = null;
            mgraphics.redraw();
            return;
        }
        sbDrag.curY = y;
        if (!sbDrag.moved && Math.abs(y - sbDrag.startY) > 5) {
            sbDrag.moved = true;
            hoverTip = null;
            if (foldMask !== sbDrag.preMask) setFoldMask(sbDrag.preMask);
        }
        if (sbDrag.moved) {
            var targetSlot = Math.max(0, Math.min(SECTIONS.length - 1, Math.floor((y - SB_BTN.y0 + SB_BTN.pitch * 0.5) / SB_BTN.pitch)));
            var curIdx = sectionOrder.indexOf(sbDrag.secIdx);
            if (curIdx >= 0 && targetSlot !== curIdx) {
                sectionOrder.splice(curIdx, 1);
                sectionOrder.splice(targetSlot, 0, sbDrag.secIdx);
                sbDrag.curSlot = targetSlot;
                notifyclients();
            }
            mgraphics.redraw();
        }
        return;
    }
    if (panState) {
        if (!but) { panState = null; return; }
        viewX0 = panState.x0;
        panViewBy(x - panState.x);
        return;
    }
    if (drag && drag.wtPos) {
        if (but === 0) { drag = null; mgraphics.redraw(); return; }
        setIfChanged(drag.key, wtPosFromY(y, drag.top, drag.h));
        mgraphics.redraw();
        return;
    }
    if (drag && drag.subHarm) {
        if (but === 0) { drag = null; mgraphics.redraw(); return; }
        drawSubHarmonicsAt(x, y);
        mgraphics.redraw();
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
    if (z && z.kind === "wt_pos") { setParamFromFace(z.key, 0); mgraphics.redraw(); return; }
    if (z && z.kind === "wave" && viewZoom > 1.0005) { resetView(); return; }     // empty waveform space resets the view
    if (z && z.kind === "hdl") {
        if (z.id === "filt") { setParamFromFace("filt_cutoff", paramSpec("filt_cutoff").init); setParamFromFace("filt_res", paramSpec("filt_res").init); }
        else if (z.id === "filt2") { setParamFromFace("filt2_cutoff", paramSpec("filt2_cutoff").init); setParamFromFace("filt2_res", paramSpec("filt2_res").init); }
        else {
            var w4 = z.id.substring(4);
            if (w4 === "As" || w4 === "Ds" || w4 === "Rs") { var sk2 = envSlopeKeys(), si = { As: 0, Ds: 1, Rs: 2 }[w4]; setParamFromFace(sk2[si], 0); }
            else if (w4 === "I") {
                var vk0 = envValKeys();
                if (vk0[0]) setParamFromFace(vk0[0], paramSpec(vk0[0]).init);
            } else {
                var k = envKeys(), vk = envValKeys(), idx = { A: 0, D: 1, R: 3 }[w4];
                setParamFromFace(k[idx], paramSpec(k[idx]).init);
                if (idx === 0 && vk[1]) setParamFromFace(vk[1], paramSpec(vk[1]).init);
                if (idx === 1) setParamFromFace(k[2], paramSpec(k[2]).init);   // the D handle also carries sustain
                if (idx === 3 && vk[3]) setParamFromFace(vk[3], paramSpec(vk[3]).init);
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
    if ((drag && (drag.captured || drag.hdl)) || (sbDrag && sbDrag.moved)) return;
    var z = zoneAt(x, y);
    var h = (z && z.kind === "hdl") ? z.id : "";
    var tip = (z && z.kind === "act" && z.tip) ? { tip: z.tip, index: z.index, slot: z.slot } : null;
    var gh = !!(z && z.key === "samp_gain");
    if (gh !== gainHover) { gainHover = gh; mgraphics.redraw(); }
    var tipChanged = (tip ? tip.index : -1) !== (hoverTip ? hoverTip.index : -1) || (tip ? tip.slot : -1) !== (hoverTip ? hoverTip.slot : -1);
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
    storeParam("filt_cutoff", 762, true);
    storeParam("filt_res", 44, true);
    storeParam("filt_circuit", 1, true);
    storeParam("filt2_on", 1, true);
    storeParam("filt2_type", 2, true);
    storeParam("filt2_cutoff", 73.2, true);
    storeParam("filt2_res", 47, true);
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
    } else if (o.playing === 0) {
        liveActiveVoices = 0;
        for (var z0 = 0; z0 < 16; z0++) { voiceAmpLvl[z0] = 0; voiceModLvl[z0] = 0; voiceAmps[z0] = 0; }
    } else {
        liveActiveVoices = 3;
        voicePlayheads[0] = 0.32; voiceAmps[0] = 0.8;
        voicePlayheads[1] = 0.34; voiceAmps[1] = 0.5;
    }
    for (var g = 0; g < 9; g++) { grainPos[g] = 0.28 + g * 0.018; grainAmp[g] = 0.3 + 0.07 * g; }
    envPage = o.env === undefined ? 1 : o.env;
    envTab = o.tab || 0;
    if (o.matTab !== undefined) matTab = o.matTab;
    modTopTab = o.topTab || 0;
    if (o.zoom) { viewZoom = o.zoom; viewX0 = o.x0 || 0; clampView(); }
    foldMask = o.fold === undefined ? DEFAULT_FOLD : o.fold;
    showInspector = foldMask ? 1 : 0;
    if (o.order) setSectionOrder(o.order);
    if (o.hover) hoverKey = o.hover;
    if (o.oscTab !== undefined) oscTab = Math.max(0, Math.min(2, Math.round(Number(o.oscTab) || 0)));
    if (o.wtFrames) wtPreviewFrames = Math.max(2, Math.round(Number(o.wtFrames) || 0));
    if (o.menu) openMenu = o.menu;
}
