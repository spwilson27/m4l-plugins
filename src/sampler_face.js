// Better Sampler — Bitwig-style face drawn entirely in v8ui.
//
// Appended after src/sampler_ui.js. The build injects:
//   FACE_REGION  "main" (engine list, sample panel, bottom panels) or "side" (voicing + output column)
//   FACE_PARAMS  { key: { lo, hi, init, exp, unit, enums? } } for every automatable parameter
//
// Every knob or value edited here is sent as ["param", key, value] to its hidden live.* object,
// which echoes back through set_<key> -> storeParam(), so Live automation and the face stay in sync.

var faceRegion = (typeof FACE_REGION !== "undefined") ? FACE_REGION : "main";

var COL = {
    gap:    [0.255, 0.255, 0.255],
    panel:  [0.165, 0.165, 0.165],
    button: [0.215, 0.215, 0.215],
    wave:   [0.110, 0.110, 0.110],
    text:   [0.88, 0.88, 0.88],
    label:  [0.60, 0.60, 0.60],
    dim:    [0.38, 0.38, 0.38],
    blue:   [0.36, 0.66, 1.00],
    yellow: [0.96, 0.86, 0.28],
    green:  [0.36, 0.80, 0.62],
    orange: [0.98, 0.63, 0.20],
    red:    [0.93, 0.36, 0.36],
    knob:   [0.31, 0.31, 0.31],
    knobHi: [0.90, 0.90, 0.90],
    track:  [0.34, 0.34, 0.34]
};

var ENGINE_NAMES = ["Repitch", "Cycles", "Textures"];
var ENV_PAGES = ["AMP", "MOD", "LFO", "UNI"];
var ENV_PAGE_KNOBS = [
    [["atk_ms", "A"], ["dec_ms", "D"], ["sus_lvl", "S"], ["rel_ms", "R"]],
    [["matk_ms", "A"], ["mdec_ms", "D"], ["msus_lvl", "S"], ["mrel_ms", "R"], ["menv_pitch", "Pit"], ["menv_pos", "Pos"]],
    [["lfo_rate", "Rate"], ["lfo_shape", "Shape"], ["lfo_pitch", "Pit"], ["lfo_filt", "Flt"], ["lfo_pos", "Pos"]],
    [["unison_voices", "Uni"], ["unison_detune", "Detune"], ["poly_voices", "Poly"]]
];
var BIPOLAR_KEYS = {
    pitch_st: 1, formant: 1, filt_env_amt: 1, menv_pitch: 1, menv_pos: 1,
    lfo_pitch: 1, lfo_filt: 1, lfo_pos: 1, fine_cents: 1
};
var KNOB_DRAG_PX = 120.0;

var hitZones = [];
var drag = null;        // active gesture
var hoverKey = "";      // knob under the mouse (label shows its value)

// ---------------------------------------------------------------------------
// Value mapping & formatting
// ---------------------------------------------------------------------------

function clamp01(n) { return n < 0 ? 0 : (n > 1 ? 1 : n); }

function paramSpec(key) {
    return (typeof FACE_PARAMS !== "undefined" && FACE_PARAMS[key]) ? FACE_PARAMS[key] : { lo: 0, hi: 1, init: 0, exp: 1, unit: 1 };
}

// Live maps a parameter as value = lo + (hi - lo) * norm^exponent
function toNorm(key, v) {
    var p = paramSpec(key);
    var lin = clamp01((v - p.lo) / Math.max(1e-9, p.hi - p.lo));
    return (p.exp && p.exp !== 1) ? Math.pow(lin, 1.0 / p.exp) : lin;
}

function fromNorm(key, n) {
    var p = paramSpec(key);
    n = clamp01(n);
    var lin = (p.exp && p.exp !== 1) ? Math.pow(n, p.exp) : n;
    var v = p.lo + lin * (p.hi - p.lo);
    if (p.enums || p.unit === 0) v = Math.round(v);
    return v;
}

function fmtTime(ms) {
    if (ms < 10) return ms.toFixed(2) + " ms";
    if (ms < 100) return ms.toFixed(1) + " ms";
    if (ms < 1000) return Math.round(ms) + " ms";
    return (ms / 1000).toFixed(2) + " s";
}

function fmtParam(key, v) {
    var p = paramSpec(key);
    if (p.enums) return String(p.enums[Math.max(0, Math.min(p.enums.length - 1, Math.round(v)))]);
    switch (p.unit) {
        case 0: return String(Math.round(v));
        case 2: return fmtTime(v);
        case 3: return v >= 1000 ? (v / 1000).toFixed(2) + " kHz" : (v >= 100 ? Math.round(v) + " Hz" : v.toFixed(2) + " Hz");
        case 4: return v.toFixed(1) + " dB";
        case 5: return (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)) + " %";
        case 7: return (v > 0 ? "+" : "") + Math.round(v) + " st";
        default: return v.toFixed(2);
    }
}

function setParamFromFace(key, v) {
    storeParam(key, v);
    outlet(0, "param", key, v);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function setc(c, a) { mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? 1.0 : a); }

function fillRR(x, y, w, h, r, c, a) {
    setc(c, a);
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
    mgraphics.fill();
}

function fillRect(x, y, w, h, c, a) {
    setc(c, a);
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
}

function line(x0, y0, x1, y1, c, a, lw) {
    setc(c, a);
    mgraphics.set_line_width(lw || 1.0);
    mgraphics.move_to(x0, y0);
    mgraphics.line_to(x1, y1);
    mgraphics.stroke();
}

function font(size, bold) {
    mgraphics.select_font_face(bold ? "Arial Bold" : "Arial");
    mgraphics.set_font_size(size);
}

function textW(s, size) {
    if (typeof mgraphics.text_measure === "function") {
        var m = mgraphics.text_measure(String(s));
        if (m && m.length) return m[0];
    }
    return String(s).length * size * 0.56;
}

// align: 0 = left, 1 = centre, 2 = right; y is the baseline
function text(s, x, y, size, c, bold, align, a) {
    font(size, bold);
    var w = textW(s, size);
    var tx = align === 1 ? x - w * 0.5 : (align === 2 ? x - w : x);
    setc(c, a);
    mgraphics.move_to(tx, y);
    mgraphics.show_text(String(s));
    return w;
}

function fitText(s, maxW, size) {
    s = String(s);
    font(size, false);
    if (textW(s, size) <= maxW) return s;
    while (s.length > 3 && textW(s + "…", size) > maxW) s = s.substring(0, s.length - 1);
    return s + "…";
}

function circle(cx, cy, r, c, a) {
    setc(c, a);
    mgraphics.arc(cx, cy, r, 0, Math.PI * 2);
    mgraphics.fill();
}

// Arc as a polyline so it renders the same in Max and the preview renderer
function strokeArc(cx, cy, r, a0, a1, c, a, lw) {
    if (Math.abs(a1 - a0) < 0.01) return;
    setc(c, a);
    mgraphics.set_line_width(lw);
    var steps = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 0.12));
    for (var i = 0; i <= steps; i++) {
        var t = a0 + (a1 - a0) * (i / steps);
        var px = cx + Math.cos(t) * r;
        var py = cy + Math.sin(t) * r;
        if (i === 0) mgraphics.move_to(px, py); else mgraphics.line_to(px, py);
    }
    mgraphics.stroke();
}

function polygon(pts, c, a) {
    if (pts.length < 3) return;
    setc(c, a);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.close_path();
    mgraphics.fill();
}

function zone(kind, x, y, w, h, props) {
    var z = props || {};
    z.kind = kind; z.x = x; z.y = y; z.w = w; z.h = h;
    hitZones.push(z);
    return z;
}

// Bitwig knob: flat grey disc, white pointer, orange value arc on a grey track
var KNOB_A0 = Math.PI * 0.75;
var KNOB_SWEEP = Math.PI * 1.5;

function drawKnob(key, cx, cy, r, label, opts) {
    opts = opts || {};
    var v = paramValue(key);
    var n = toNorm(key, v);
    var alpha = opts.dim ? 0.45 : 1.0;
    var ringR = r + 3.0;
    var ang = KNOB_A0 + n * KNOB_SWEEP;

    strokeArc(cx, cy, ringR, KNOB_A0, KNOB_A0 + KNOB_SWEEP, COL.track, alpha, 2.0);
    var from = BIPOLAR_KEYS[key] ? KNOB_A0 + KNOB_SWEEP * 0.5 : KNOB_A0;
    strokeArc(cx, cy, ringR, Math.min(from, ang), Math.max(from, ang), COL.orange, alpha, 2.0);

    circle(cx, cy, r, opts.white ? COL.knobHi : COL.knob, alpha);
    var pc = opts.white ? [0.12, 0.12, 0.12] : [0.95, 0.95, 0.95];
    line(cx + Math.cos(ang) * r * 0.25, cy + Math.sin(ang) * r * 0.25,
         cx + Math.cos(ang) * r * 0.92, cy + Math.sin(ang) * r * 0.92, pc, alpha, 1.6);

    if (label !== undefined && label !== null) {
        var ly = opts.labelY !== undefined ? opts.labelY : cy + ringR + 10.0;
        var showVal = (hoverKey === key) || (drag && drag.key === key);
        if (showVal) {
            text(fmtParam(key, v), cx, ly, 8.0, COL.text, true, 1);
        } else if (label !== "") {
            text(label, cx, ly, 8.5, opts.labelColor || COL.label, false, 1, alpha);
        }
    }
    zone("knob", cx - ringR - 2, cy - ringR - 2, ringR * 2 + 4, ringR * 2 + 14, { key: key });
}

// ---------------------------------------------------------------------------
// Small vector icons
// ---------------------------------------------------------------------------

function iconWave(x, y, c, a) {
    var hs = [2, 5, 7, 4, 6, 3, 2];
    for (var i = 0; i < hs.length; i++) line(x + i * 2, y + 3.5 - hs[i] * 0.5, x + i * 2, y + 3.5 + hs[i] * 0.5, c, a, 1.0);
}

function iconKnife(x, y, c, a) {
    polygon([[x + 4, y + 4], [x + 11, y], [x + 9, y + 4]], c, a);
    line(x, y + 7, x + 4, y + 4, c, a, 1.8);
}

function iconFolder(x, y, c, a) {
    polygon([[x, y + 1], [x + 4, y + 1], [x + 5, y + 2.5], [x + 10, y + 2.5], [x + 10, y + 8], [x, y + 8]], c, a);
}

function iconFlag(x, y, c, flip) {
    line(x, y, x, y + 9, c, 1.0, 1.2);
    fillRect(flip ? x - 4 : x, y, 4, 4, c);
}

function iconSnow(cx, cy, c, a) {
    for (var i = 0; i < 3; i++) {
        var t = i * Math.PI / 3;
        line(cx - Math.cos(t) * 5, cy - Math.sin(t) * 5, cx + Math.cos(t) * 5, cy + Math.sin(t) * 5, c, a, 1.3);
    }
}

function iconPower(cx, cy, c, a) {
    strokeArc(cx, cy, 3.6, -Math.PI * 0.30, Math.PI * 1.30, c, a, 1.3);
    line(cx, cy - 4.8, cx, cy - 0.5, c, a, 1.3);
}

function iconFilter(x, y, type, c, a) {
    var pts;
    if (type === 0) pts = [[x, y + 2], [x + 8, y + 2], [x + 11, y + 4], [x + 14, y + 9]];
    else if (type === 1) pts = [[x, y + 9], [x + 4, y + 3], [x + 7, y + 1], [x + 10, y + 3], [x + 14, y + 9]];
    else pts = [[x, y + 9], [x + 3, y + 4], [x + 6, y + 2], [x + 14, y + 2]];
    setc(c, a);
    mgraphics.set_line_width(1.4);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.stroke();
}

function iconRamp(x, y, w, rising, c, a) {
    polygon(rising ? [[x, y + 6], [x + w, y], [x + w, y + 6]] : [[x, y], [x + w, y + 6], [x, y + 6]], c, a);
}

function iconLoopMode(x, y, mode, c) {
    if (mode === 0) { line(x, y + 4, x + 12, y + 4, c, 1.0, 1.4); return; }
    line(x, y + 4, x + 11, y + 4, c, 1.0, 1.4);
    polygon([[x + 12, y + 4], [x + 8, y + 1], [x + 8, y + 7]], c);
    if (mode === 2) polygon([[x, y + 4], [x + 4, y + 1], [x + 4, y + 7]], c);
}

var SLICE_PLAY_NAMES = ["to Slice end", "to Sample end", "One-way looping", "Ping-pong looping"];

// Bitwig slice playback glyphs: arrow to a bar, plain arrow, double arrow, back-and-forth arrows
function iconSlicePlay(x, y, mode, c) {
    if (mode === 0) {
        line(x, y + 4, x + 9, y + 4, c, 1.0, 1.3);
        polygon([[x + 10, y + 4], [x + 7, y + 1.5], [x + 7, y + 6.5]], c);
        line(x + 12, y, x + 12, y + 8, c, 1.0, 1.3);
    } else if (mode === 1) {
        line(x, y + 4, x + 10, y + 4, c, 1.0, 1.3);
        polygon([[x + 12, y + 4], [x + 8.5, y + 1.5], [x + 8.5, y + 6.5]], c);
    } else if (mode === 2) {
        line(x, y + 2.5, x + 9, y + 2.5, c, 1.0, 1.2);
        line(x, y + 5.5, x + 9, y + 5.5, c, 1.0, 1.2);
        polygon([[x + 12, y + 4], [x + 8.5, y], [x + 8.5, y + 8]], c);
    } else {
        line(x + 1, y + 2, x + 11, y + 2, c, 1.0, 1.2);
        polygon([[x + 12, y + 2], [x + 9, y], [x + 9, y + 4]], c);
        line(x + 1, y + 6, x + 11, y + 6, c, 1.0, 1.2);
        polygon([[x, y + 6], [x + 3, y + 4], [x + 3, y + 8]], c);
    }
}

var slicePlayMenu = null;   // {x, y, w, rowH} while the Playback dropdown is open

function paintSlicePlayMenu() {
    if (!slicePlayMenu) return;
    var m = slicePlayMenu;
    var cur = Math.round(paramValue("slice_play"));
    fillRR(m.x - 1, m.y - 1, m.w + 2, m.rowH * 4 + 8, 3, [0.36, 0.36, 0.36]);
    fillRR(m.x, m.y, m.w, m.rowH * 4 + 6, 3, [0.20, 0.20, 0.20]);
    for (var i = 0; i < 4; i++) {
        var ry = m.y + 3 + i * m.rowH;
        if (i === cur) fillRect(m.x + 3, ry, m.w - 6, m.rowH, [0.36, 0.36, 0.36]);
        iconSlicePlay(m.x + 8, ry + m.rowH * 0.5 - 4, i, COL.text);
        text(SLICE_PLAY_NAMES[i], m.x + 28, ry + m.rowH * 0.5 + 3.5, 9.0, i === cur ? COL.label : COL.text, false, 0);
        zone("button", m.x, ry, m.w, m.rowH, { action: "slice_play_pick", value: i });
    }
}

function iconReverse(x, y, on) {
    var c = on ? COL.blue : COL.label;
    text("R", x + 3, y + 7, 8.0, c, true, 0);
    line(x, y + 10, x + 11, y + 10, c, 1.0, 1.2);
    polygon([[x - 1, y + 10], [x + 2, y + 8], [x + 2, y + 12]], c);
}

// ---------------------------------------------------------------------------
// Main region
// ---------------------------------------------------------------------------

var MAIN = {
    left: [3, 3, 53],           // x, y, w of the mode column
    sample: [59, 3, 466, 100],  // x, y, w, h of the sample panel
    bottomY: 106,
    bottomH: 60,
    p1: [59, 100], p2: [162, 112], p3: [277, 100], p4: [380, 145]
};

function paintModeColumn() {
    var x = MAIN.left[0], w = MAIN.left[2];
    var sliced = (curMode === 3);

    fillRR(x, 3, w, 44, 3, COL.panel);
    var rows = [["Single", !sliced], ["Sliced", sliced]];
    for (var i = 0; i < 2; i++) {
        var ry = 3 + i * 22;
        var c = rows[i][1] ? COL.blue : COL.label;
        if (i === 0) iconWave(x + w * 0.5 - 6, ry + 3, c, 1.0); else iconKnife(x + w * 0.5 - 5.5, ry + 3, c, 1.0);
        text(rows[i][0], x + w * 0.5, ry + 20, 9.0, c, false, 1);
        zone("button", x, ry, w, 22, { action: i === 0 ? "single" : "sliced" });
    }

    fillRR(x, 50, w, 116, 3, COL.panel);
    for (var e = 0; e < 3; e++) {
        var ey = 50 + 22 + e * 28;
        var active = !sliced && curMode === e;
        text(ENGINE_NAMES[e], x + w * 0.5, ey, 9.5, active ? COL.blue : (sliced ? COL.dim : COL.label), false, 1);
        zone("button", x, ey - 16, w, 26, { action: "engine", engine: e });
    }

    // 16-voice activity LEDs
    for (var vi = 0; vi < 16; vi++) {
        var lx = x + 8 + (vi % 8) * 5.2;
        var ly = 148 + Math.floor(vi / 8) * 6;
        var lvl = voiceAmps[vi] || 0;
        fillRect(lx, ly, 3.4, 3.4, lvl > 0.02 ? COL.blue : COL.track, lvl > 0.02 ? Math.min(1, 0.4 + lvl * 0.6) : 1.0);
    }
}

function waveAmp(t) {
    var fi = t * (WAVE_BINS - 1);
    var i0 = Math.floor(fi);
    var i1 = Math.min(WAVE_BINS - 1, i0 + 1);
    var f = fi - i0;
    var a0 = Math.max(wavePeaksL[i0], wavePeaksR[i0]);
    var a1 = Math.max(wavePeaksL[i1], wavePeaksR[i1]);
    return a0 + (a1 - a0) * f;
}

function wavePolygon(wx, wy, ww, wh, t0, t1, c, a) {
    var cy = wy + wh * 0.5;
    var half = wh * 0.48;
    var x0 = wx + t0 * ww;
    var x1 = wx + t1 * ww;
    var cols = Math.max(2, Math.round(x1 - x0));
    var top = [];
    var bot = [];
    for (var i = 0; i <= cols; i++) {
        var px = x0 + (x1 - x0) * (i / cols);
        var amp = Math.max(0.004, waveAmp((px - wx) / ww)) * half;
        top.push([px, cy - amp]);
        bot.push([px, cy + amp]);
    }
    polygon(top.concat(bot.reverse()), c, a);
}

function paintSamplePanel() {
    var sx = MAIN.sample[0], sy = MAIN.sample[1], sw = MAIN.sample[2], sh = MAIN.sample[3];
    fillRR(sx, sy, sw, sh, 3, COL.wave);

    // Header
    iconFolder(sx + 7, sy + 5, COL.blue, 0.9);
    var nameW = text(fitText(hasLoadedSample ? sampleFileName : "Drop a sample or click to browse", 170, 9.0), sx + 21, sy + 13, 9.0, hasLoadedSample ? COL.blue : COL.label, false, 0);
    zone("button", sx + 4, sy + 1, nameW + 20, 15, { action: "browse" });

    var vx = sx + 228;
    for (var b = 0; b < 4; b++) line(vx + b * 2.5, sy + 6, vx + b * 2.5, sy + 13, COL.blue, 0.9, 1.4);
    text(liveActiveVoices + " / " + curPolyVoices, vx + 14, sy + 13, 9.0, COL.blue, false, 0);

    var rx = sx + 340;
    text("ROOT", rx, sy + 13, 8.5, COL.label, true, 0);
    var noteW = text(midiToNoteName(curRootNote), rx + 32, sy + 13, 9.0, COL.blue, false, 0);
    zone("value", rx + 30, sy + 2, noteW + 4, 14, { key: "root_note", pxPerUnit: 4 });
    var fine = Math.round(paramValue("fine_cents"));
    var fineW = text(fine + " ct", rx + 48, sy + 13, 9.0, COL.blue, false, 0);
    zone("value", rx + 46, sy + 2, fineW + 4, 14, { key: "fine_cents", pxPerUnit: 1 });

    // L / R output meters
    var mx = sx + sw - 30;
    fillRect(mx, sy + 6, 24, 2.5, COL.track);
    fillRect(mx, sy + 6, 24 * clamp01(livePeakL), 2.5, COL.green);
    fillRect(mx, sy + 10, 24, 2.5, COL.track);
    fillRect(mx, sy + 10, 24 * clamp01(livePeakR), 2.5, COL.green);

    // Waveform
    var wx = sx + 4, wy = sy + 17, ww = sw - 8, wh = 66;
    var loopOn = curLoopMode > 0;
    if (hasLoadedSample) {
        wavePolygon(wx, wy, ww, wh, 0, 1, [0.42, 0.42, 0.42], 1.0);
        wavePolygon(wx, wy, ww, wh, curStart, curEnd, [0.94, 0.94, 0.94], 1.0);
    } else {
        line(wx, wy + wh * 0.5, wx + ww, wy + wh * 0.5, COL.dim, 1.0, 1.0);
        text("Drop a sample here", wx + ww * 0.5, wy + wh * 0.5 - 6, 10.0, COL.label, false, 1);
    }

    if (loopOn && curMode !== 3) {
        var lsX = wx + curLoopStart * ww, leX = wx + curLoopEnd * ww;
        fillRect(lsX, wy, leX - lsX, wh, COL.green, 0.10);
        var xfW = curXfade * (leX - lsX);
        if (xfW > 1) polygon([[lsX - xfW, wy + wh], [lsX, wy + wh], [lsX, wy + wh - 10]], COL.green, 0.45);
        line(lsX, wy, lsX, wy + wh, COL.green, 0.85, 1.0);
        line(leX, wy, leX, wy + wh, COL.green, 0.85, 1.0);
        fillRect(lsX, wy + wh - 6, 6, 6, COL.green);
        fillRect(leX - 6, wy + wh - 6, 6, 6, COL.green);
    }

    if (curMode === 3) {
        // Bitwig-style slices: yellow flag + line per slice from the start point; markers outside
        // start..end are faint and unmapped. Slice k plays on MIDI note 36 + k (C1 upward).
        var starts = currentSliceStarts();
        for (var mi = 0; mi < sliceMarkers.length; mi++) {
            var m = sliceMarkers[mi];
            if (m < curStart - 1e-6 || m > curEnd + 1e-6) line(wx + m * ww, wy + 8, wx + m * ww, wy + wh, [1, 1, 1], 0.14, 1.0);
        }
        for (var si = 0; si < starts.length; si++) {
            var mxs = wx + starts[si] * ww;
            var nxt = wx + ((si + 1 < starts.length) ? starts[si + 1] : curEnd) * ww;
            if (si === selectedSliceIdx) fillRect(mxs, wy, nxt - mxs, wh, COL.blue, 0.16);
            line(mxs, wy, mxs, wy + wh, COL.yellow, 0.85, 1.0);
            polygon([[mxs, wy], [mxs + 7, wy], [mxs, wy + 7]], COL.yellow);
            if (nxt - mxs > 22) text(midiToNoteName(36 + si), mxs + 3, wy + 16, 7.0, COL.yellow, false, 0, 0.8);
        }
    }

    // Grain cloud (Textures) / cycle window (Cycles) around each sounding voice
    // Scan lines only for a loaded sample: with an empty buffer the voices still run but play nothing
    for (var v = 0; v < 16 && hasLoadedSample; v++) {
        if ((voiceAmps[v] || 0) <= 0.02) continue;
        var phx = wx + clamp01(voicePlayheads[v]) * ww;
        if (curMode === 2) {
            var spread = Math.max(3, paramValue("grain_spray") * 0.01 * ww * 0.25);
            fillRect(phx - spread, wy, spread * 2, wh, COL.blue, 0.10 * voiceAmps[v] + 0.05);
        } else if (curMode === 1) {
            var cw = Math.max(3, Math.min(ww * 0.2, paramValue("grain_size") / Math.max(1, sampleDurationMs) * ww));
            fillRect(phx, wy, cw, wh, COL.blue, 0.12);
        }
        line(phx, wy, phx, wy + wh, COL.blue, Math.min(1, 0.35 + voiceAmps[v]), 1.0);
    }

    // Start / end: yellow flags at the top, or blue handles at the bottom in Sliced mode (Bitwig)
    var stX = wx + curStart * ww, enX = wx + curEnd * ww;
    if (curMode === 3) {
        line(enX, wy, enX, wy + wh, COL.blue, 0.95, 1.0);
        fillRect(stX, wy + wh - 7, 7, 7, COL.blue);
        fillRect(enX - 7, wy + wh - 7, 7, 7, COL.blue);
    } else {
        line(stX, wy, stX, wy + wh, COL.yellow, 0.95, 1.0);
        line(enX, wy, enX, wy + wh, COL.yellow, 0.95, 1.0);
        fillRect(stX, wy, 6, 6, COL.yellow);
        fillRect(enX - 6, wy, 6, 6, COL.yellow);
    }
    zone("wave", wx, wy, ww, wh, {});

    // Footer: PLAY reverse/start/end, LOOP mode/start/end/xfade
    var fy = sy + sh - 4;
    text("PLAY", sx + 6, fy, 8.5, COL.label, true, 0);
    iconReverse(sx + 36, fy - 9, curReverse);
    zone("button", sx + 33, fy - 11, 16, 14, { action: "reverse" });
    var pc = curMode === 3 ? COL.blue : COL.yellow;
    iconFlag(sx + 58, fy - 9, pc, false);
    var stW = text(fmtPos(curStart), sx + 66, fy, 9.0, pc, false, 0);
    zone("value", sx + 64, fy - 11, stW + 4, 14, { region: "samp_start" });
    iconFlag(sx + 132, fy - 9, pc, true);
    var enW = text(fmtPos(curEnd), sx + 136, fy, 9.0, pc, false, 0);
    zone("value", sx + 134, fy - 11, enW + 4, 14, { region: "samp_end" });

    var lx = sx + 248;
    if (curMode === 3) {
        // Key range the slices occupy, starting at C1
        var n = currentSliceStarts().length;
        var kx = sx + 200;
        text("KEYS", kx, fy, 8.5, COL.label, true, 0);
        for (var kk = 0; kk < 4; kk++) fillRect(kx + 33 + kk * 3.2, fy - 9, 2.4, 9, COL.blue);
        text("C1 – " + midiToNoteName(36 + n - 1), kx + 50, fy, 9.0, COL.blue, false, 0);
        text(n + (n === 1 ? " slice" : " slices"), kx + 104, fy, 9.0, COL.label, false, 0);

        // Playback: slice end / sample end / one-way loop / ping-pong (Bitwig's dropdown)
        var sp = Math.round(paramValue("slice_play"));
        var px2 = sx + sw - 8;
        polygon([[px2 - 7, fy - 6], [px2, fy - 6], [px2 - 3.5, fy - 2]], COL.label);
        iconSlicePlay(px2 - 26, fy - 8, sp, COL.blue);
        var plW = text("Playback", px2 - 30, fy, 8.5, COL.label, true, 2);
        zone("button", px2 - 34 - plW, fy - 11, plW + 36, 14, { action: "slice_play_menu" });
        return;
    }
    var lc = loopOn ? COL.green : COL.dim;
    text("LOOP", lx, fy, 8.5, COL.label, true, 0);
    iconLoopMode(lx + 32, fy - 8, curLoopMode, loopOn ? COL.text : COL.label);
    zone("button", lx + 30, fy - 11, 16, 14, { action: "loop_mode" });
    iconFlag(lx + 54, fy - 9, lc, false);
    var lsW = text(fmtPos(curLoopStart), lx + 62, fy, 9.0, lc, false, 0);
    zone("value", lx + 60, fy - 11, lsW + 4, 14, { region: "loop_start" });
    iconFlag(lx + 118, fy - 9, lc, true);
    var leW = text(fmtPos(curLoopEnd), lx + 122, fy, 9.0, lc, false, 0);
    zone("value", lx + 120, fy - 11, leW + 4, 14, { region: "loop_end" });
    polygon([[lx + 166, fy - 9], [lx + 172, fy - 4], [lx + 166, fy + 1]], lc);
    polygon([[lx + 178, fy - 9], [lx + 172, fy - 4], [lx + 178, fy + 1]], lc);
    var xfW2 = text((curXfade / 0.45 * 100).toFixed(1) + " %", lx + 182, fy, 9.0, lc, false, 0);
    zone("value", lx + 164, fy - 11, xfW2 + 22, 14, { region: "loop_xfade" });
}

function fmtPos(norm) {
    return sampleDurationMs > 0 ? fmtTime(norm * sampleDurationMs) : (norm * 100).toFixed(1) + " %";
}

function bottomPanel(p) {
    fillRR(p[0], MAIN.bottomY, p[1], MAIN.bottomH, 3, COL.panel);
}

function paintEnginePanel() {
    var p = MAIN.p1, x = p[0], w = p[1], y = MAIN.bottomY;
    bottomPanel(p);
    var name = curMode === 3 ? "Sliced" : ENGINE_NAMES[curMode];
    polygon([[x + 8, y + 8], [x + 12, y + 5], [x + 12, y + 11]], COL.label);
    polygon([[x + w - 8, y + 8], [x + w - 12, y + 5], [x + w - 12, y + 11]], COL.label);
    text(name, x + w * 0.5, y + 12, 9.5, COL.text, true, 1);
    zone("button", x, y, 22, 16, { action: "engine_prev" });
    zone("button", x + w - 22, y, 22, 16, { action: "engine_next" });

    var grainOn = (curMode === 2);
    var cyclesOn = (curMode === 1);
    var ky = y + 33;
    drawKnob("grain_size", x + w * 0.18, ky, 9, "Size", { dim: !(grainOn || cyclesOn) });
    drawKnob("grain_spray", x + w * 0.50, ky, 9, "Spray", { dim: !grainOn });
    drawKnob("formant", x + w * 0.82, ky, 9, "Fmt", { dim: !cyclesOn });
}

function paintPlayPanel() {
    var p = MAIN.p2, x = p[0], w = p[1], y = MAIN.bottomY;
    bottomPanel(p);
    iconSnow(x + w * 0.5, y + 9, curFreeze ? COL.blue : COL.label, 1.0);
    zone("button", x + w * 0.5 - 9, y + 1, 18, 16, { action: "freeze" });
    var scanOn = (curMode === 1 || curMode === 2);
    drawKnob("pitch_st", x + 19, y + 35, 9, "Pitch");
    drawKnob("grain_motion", x + w * 0.5, y + 33, 13, "Speed", { white: true, dim: !scanOn, labelY: y + 56 });
    drawKnob("play_pos", x + w - 19, y + 35, 9, "Pos", { dim: !curFreeze });
}

function paintFilterPanel() {
    var p = MAIN.p3, x = p[0], w = p[1], y = MAIN.bottomY;
    bottomPanel(p);
    var on = curFiltOn;
    var hc = on ? COL.orange : COL.label;
    iconPower(x + 10, y + 9, hc, 1.0);
    zone("button", x + 2, y + 1, 16, 16, { action: "filt_on" });
    var ft = Math.round(paramValue("filt_type"));
    iconFilter(x + 22, y + 4, ft, on ? COL.text : COL.label, 1.0);
    polygon([[x + 40, y + 7], [x + 46, y + 7], [x + 43, y + 10]], COL.label);
    zone("button", x + 20, y + 1, 30, 16, { action: "filt_type" });
    var drvW = text(fmtParam("filt_drive", paramValue("filt_drive")), x + w - 6, y + 12, 9.0, on ? COL.orange : COL.dim, false, 2, 0.75);
    zone("value", x + w - 8 - drvW, y + 1, drvW + 4, 15, { key: "filt_drive", norm: true });

    var dim = !on;
    drawKnob("filt_cutoff", x + 24, y + 33, 12, "", { dim: dim });
    var cutShow = (hoverKey === "filt_cutoff" || (drag && drag.key === "filt_cutoff"));
    if (!cutShow) text(fmtParam("filt_cutoff", paramValue("filt_cutoff")), x + 24, y + 56, 8.0, COL.label, false, 1);
    else text(fmtParam("filt_cutoff", paramValue("filt_cutoff")), x + 24, y + 56, 8.0, COL.text, true, 1);
    drawKnob("filt_res", x + 58, y + 35, 9, "Res", { dim: dim });
    drawKnob("filt_env_amt", x + 85, y + 35, 7, "Env", { dim: dim });
}

function paintEnvPanel() {
    var p = MAIN.p4, x = p[0], w = p[1], y = MAIN.bottomY;
    bottomPanel(p);
    var tabW = (w - 8) / 4;
    for (var t = 0; t < 4; t++) {
        var tx = x + 4 + t * tabW;
        var on = (envPage === t);
        if (on) fillRR(tx + 1, y + 3, tabW - 2, 12, 2, COL.button);
        text(ENV_PAGES[t], tx + tabW * 0.5, y + 12, 8.0, on ? COL.text : COL.label, true, 1);
        zone("button", tx, y + 1, tabW, 15, { action: "env_page", page: t });
    }

    var knobs = ENV_PAGE_KNOBS[envPage] || ENV_PAGE_KNOBS[0];
    var n = knobs.length;
    var slot = (w - 6) / Math.max(4, n);
    var x0 = x + 3 + (w - 6 - slot * n) * 0.5;
    var r = n > 5 ? 7.5 : 9;
    for (var k = 0; k < n; k++) {
        var cx = x0 + slot * (k + 0.5);
        var key = knobs[k][0];
        if (envPage <= 1) {
            var lab = knobs[k][1];
            if (lab === "A") iconRamp(cx - 6, y + 19, 12, true, COL.orange, 0.85);
            else if (lab === "D" || lab === "R") iconRamp(cx - 6, y + 19, 12, false, COL.orange, 0.85);
        }
        var label = knobs[k][1];
        if (key === "lfo_shape") label = fmtParam(key, paramValue(key));
        drawKnob(key, cx, y + 37, r, label);
    }
}

// ---------------------------------------------------------------------------
// Side region: Poly / Mono, Width, Glide, Velocity, Out
// ---------------------------------------------------------------------------

function paintSide(W, H) {
    var top = 0;
    var bw = (W - 3) * 0.5;
    var btns = [["Poly", curMonoLegato === 0, COL.blue], ["Mono", curMonoLegato === 1, COL.red]];
    for (var i = 0; i < 2; i++) {
        var bx = i * (bw + 3);
        fillRR(bx, top, bw, 24, 2, COL.button);
        fillRect(bx + 2, top + 1, bw - 4, 2, btns[i][1] ? btns[i][2] : COL.track);
        text(btns[i][0], bx + bw * 0.5, top + 17, 9.0, btns[i][1] ? COL.text : COL.label, true, 1);
        zone("button", bx, top, bw, 24, { action: "voicing", value: i });
    }

    var py = top + 27;
    fillRR(0, py, W, H - py, 3, COL.panel);
    var cx = W * 0.5;
    text("L", 9, py + 26, 8.5, COL.label, true, 1);
    text("R", W - 9, py + 26, 8.5, COL.label, true, 1);
    drawKnob("unison_width", cx, py + 22, 9, null);
    drawKnob("glide_ms", W * 0.27, py + 54, 8, null);
    drawKnob("vel_sens", W * 0.73, py + 54, 8, null);
    // glide (pin) and velocity (speaker) glyphs under the small knobs
    var gx = W * 0.27, vx = W * 0.73;
    if (hoverKey === "glide_ms" || (drag && drag.key === "glide_ms")) text(fmtParam("glide_ms", paramValue("glide_ms")), gx, py + 75, 8.0, COL.text, true, 1);
    else { circle(gx, py + 68, 2, COL.label); line(gx, py + 70, gx, py + 75, COL.label, 1.0, 1.2); }
    if (hoverKey === "vel_sens" || (drag && drag.key === "vel_sens")) text(fmtParam("vel_sens", paramValue("vel_sens")), vx, py + 75, 8.0, COL.text, true, 1);
    else polygon([[vx - 4, py + 69], [vx - 2, py + 69], [vx + 2, py + 66], [vx + 2, py + 76], [vx - 2, py + 73], [vx - 4, py + 73]], COL.label);
    if (hoverKey === "unison_width" || (drag && drag.key === "unison_width")) text(fmtParam("unison_width", paramValue("unison_width")), cx, py + 9, 7.5, COL.text, true, 1);
    drawKnob("out_gain", cx, py + 100, 12, "Out", { labelY: py + 123 });
}

// ---------------------------------------------------------------------------
// paint / mouse
// ---------------------------------------------------------------------------

function paint() {
    var sz = mgraphics.size;
    var W = sz[0], H = sz[1];
    hitZones = [];
    fillRect(0, 0, W, H, COL.gap);
    if (faceRegion === "side") {
        paintSide(W, H);
        return;
    }
    paintModeColumn();
    paintSamplePanel();
    paintEnginePanel();
    paintPlayPanel();
    paintFilterPanel();
    paintEnvPanel();
    if (curMode !== 3) slicePlayMenu = null;
    paintSlicePlayMenu();
}

function zoneAt(x, y) {
    for (var i = hitZones.length - 1; i >= 0; i--) {
        var z = hitZones[i];
        if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z;
    }
    return null;
}

function setMode(m) {
    pushUndoState();
    setParamFromFace("mode", m);
    notifyclients();
}

function stepParam(key, delta) {
    var p = paramSpec(key);
    var count = p.enums ? p.enums.length : (p.hi - p.lo + 1);
    var v = Math.round(paramValue(key)) + delta;
    v = ((v - p.lo) % count + count) % count + p.lo;
    setParamFromFace(key, v);
}

function doAction(z) {
    switch (z.action) {
        case "single": setMode(lastEngine); break;
        case "sliced": setMode(3); break;
        case "engine": setMode(z.engine); break;
        case "engine_prev": setMode(((curMode === 3 ? lastEngine : curMode) + 2) % 3); break;
        case "engine_next": setMode(((curMode === 3 ? lastEngine : curMode) + 1) % 3); break;
        case "reverse": setParamFromFace("reverse", curReverse ? 0 : 1); break;
        case "freeze": setParamFromFace("freeze", curFreeze ? 0 : 1); break;
        case "loop_mode": stepParam("loop_mode", 1); break;
        case "filt_on": setParamFromFace("filt_on", curFiltOn ? 0 : 1); break;
        case "filt_type": stepParam("filt_type", 1); break;
        case "voicing": setParamFromFace("mono_legato", z.value); break;
        case "env_page": envPage = z.page; notifyclients(); break;
        case "browse": outlet(0, "browse", "bang"); break;
        case "slice_play_menu":
            slicePlayMenu = slicePlayMenu ? null : { x: MAIN.sample[0] + MAIN.sample[2] - 128, y: MAIN.sample[1] + MAIN.sample[3] - 82, w: 124, rowH: 16 };
            break;
        case "slice_play_pick": setParamFromFace("slice_play", z.value); slicePlayMenu = null; break;
    }
    mgraphics.redraw();
}

var REGION_GET = {
    samp_start: function () { return curStart; },
    samp_end: function () { return curEnd; },
    loop_start: function () { return curLoopStart; },
    loop_end: function () { return curLoopEnd; },
    loop_xfade: function () { return curXfade / 0.45; }
};

function setRegion(name, n) {
    n = clamp01(n);
    if (name === "samp_start") { curStart = Math.min(n, curEnd - 0.02); if (curLoopStart < curStart) curLoopStart = curStart; }
    else if (name === "samp_end") { curEnd = Math.max(n, curStart + 0.02); if (curLoopEnd > curEnd) curLoopEnd = curEnd; }
    else if (name === "loop_start") curLoopStart = Math.max(curStart, Math.min(curLoopEnd - 0.01, n));
    else if (name === "loop_end") curLoopEnd = Math.min(curEnd, Math.max(curLoopStart + 0.01, n));
    else if (name === "loop_xfade") curXfade = n * 0.45;
    emitRegionParams();
}

function waveNorm(x) {
    var z = null;
    for (var i = 0; i < hitZones.length; i++) if (hitZones[i].kind === "wave") z = hitZones[i];
    if (!z) return 0;
    return clamp01((x - z.x) / z.w);
}

function onclick(x, y, but, cmd, shift) {
    var z = zoneAt(x, y);
    if (slicePlayMenu && !(z && (z.action === "slice_play_pick" || z.action === "slice_play_menu"))) {
        slicePlayMenu = null;
        mgraphics.redraw();
        return;
    }
    if (drag && drag.captured) setCursorHidden(false);  // a release we never saw
    drag = null;
    if (!z) return;
    if (z.kind === "button") { doAction(z); return; }
    if (z.kind === "knob") {
        // The knob owns the mouse until release: cursor hidden, hover frozen, value readout shown
        drag = { key: z.key, y0: y, n0: toNorm(z.key, paramValue(z.key)), fine: !!shift, captured: true };
        hoverKey = z.key;
        setCursorHidden(true);
        mgraphics.redraw();
        return;
    }
    if (z.kind === "value") {
        if (z.region) {
            pushUndoState();
            drag = { region: z.region, y0: y, n0: REGION_GET[z.region]() };
        } else {
            drag = { key: z.key, y0: y, v0: paramValue(z.key), n0: toNorm(z.key, paramValue(z.key)), pxPerUnit: z.pxPerUnit, useNorm: !!z.norm };
        }
        return;
    }
    if (z.kind === "wave") {
        var nx = waveNorm(x);
        var ww = z.w;
        pushUndoState();
        if (curMode === 3) {
            // Start / end handles stay draggable; elsewhere a click auditions the slice under it
            if (Math.abs(nx - curStart) * ww < 6.0) { drag = { wave: "samp_start" }; mgraphics.redraw(); return; }
            if (Math.abs(nx - curEnd) * ww < 6.0) { drag = { wave: "samp_end" }; mgraphics.redraw(); return; }
            var sIdx = sliceIndexAt(currentSliceStarts(), curEnd, nx);
            if (sIdx < 0) return;
            selectedSliceIdx = sIdx;
            midi_note(36 + sIdx, 110);
            drag = { wave: "slice_audition" };
            mgraphics.redraw();
            return;
        }
        var cands = [["samp_start", curStart], ["samp_end", curEnd]];
        if (curLoopMode > 0) cands.push(["loop_start", curLoopStart], ["loop_end", curLoopEnd]);
        var best = "", bestD = 6.0;
        for (var c = 0; c < cands.length; c++) {
            var d = Math.abs(nx - cands[c][1]) * ww;
            if (d < bestD) { bestD = d; best = cands[c][0]; }
        }
        if (best) {
            drag = { wave: best };
        } else if (curFreeze) {
            // Pos only exists while frozen: clicking the waveform scrubs the frozen playhead
            drag = { wave: "play_pos" };
            curPlayPos = nx;
            emitRegionParams();
        }
        mgraphics.redraw();
    }
}

function ondrag(x, y, but, cmd, shift) {
    if (!drag) return;
    if (but === 0) {
        if (drag.wave === "slice_audition") midi_note(36 + selectedSliceIdx, 0);
        if (drag.region || drag.wave) notifyclients();
        if (drag.captured) {
            setCursorHidden(false);
            var zr = zoneAt(x, y);
            hoverKey = (zr && zr.kind === "knob") ? zr.key : "";
        }
        drag = null;
        mgraphics.redraw();
        return;
    }
    var dy = drag.y0 - y;
    if (drag.wave) {
        if (drag.wave === "play_pos") { curPlayPos = waveNorm(x); emitRegionParams(); }
        else if (drag.wave !== "slice_audition") setRegion(drag.wave, waveNorm(x));
    } else if (drag.region) {
        setRegion(drag.region, drag.n0 + dy / (shift ? 2400.0 : 300.0));
    } else if (drag.key) {
        var v;
        if (drag.pxPerUnit && !drag.useNorm) {
            var p = paramSpec(drag.key);
            v = Math.max(p.lo, Math.min(p.hi, Math.round(drag.v0 + dy / drag.pxPerUnit)));
        } else {
            v = fromNorm(drag.key, drag.n0 + dy / (KNOB_DRAG_PX * (shift ? 8.0 : 1.0)));
        }
        if (v !== paramValue(drag.key)) setParamFromFace(drag.key, v);
    }
    mgraphics.redraw();
}

function ondblclick(x, y) {
    var z = zoneAt(x, y);
    if (!z) return;
    if (z.kind === "knob" || (z.kind === "value" && z.key)) {
        setParamFromFace(z.key, paramSpec(z.key).init);
    } else if (z.kind === "value" && z.region) {
        pushUndoState();
        var defs = { samp_start: 0, samp_end: 1, loop_start: 0.15, loop_end: 0.85, loop_xfade: 0.05 / 0.45 };
        setRegion(z.region, defs[z.region]);
        notifyclients();
    } else if (z.kind === "wave") {
        pushUndoState();
        curStart = 0.0; curEnd = 1.0; curLoopStart = 0.15; curLoopEnd = 0.85;
        emitRegionParams();
        notifyclients();
    }
    drag = null;
    mgraphics.redraw();
}

function onidle(x, y) {
    if (drag && drag.captured) return;
    var z = zoneAt(x, y);
    var k = (z && z.kind === "knob") ? z.key : "";
    if (k !== hoverKey) { hoverKey = k; mgraphics.redraw(); }
}

function onidleout() {
    if (drag && drag.captured) return;
    if (hoverKey) { hoverKey = ""; mgraphics.redraw(); }
}

var cursorHidden = false;

function setCursorHidden(hide) {
    if (hide === cursorHidden) return;
    cursorHidden = hide;
    try {
        if (typeof max !== "undefined" && max) {
            if (hide && typeof max.hidecursor === "function") max.hidecursor();
            if (!hide && typeof max.showcursor === "function") max.showcursor();
        }
    } catch (_) {}
}
