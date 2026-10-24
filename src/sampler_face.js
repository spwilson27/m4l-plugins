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
    track:  [0.34, 0.34, 0.34],
    // Used by the sample panel / menus / toggles; the Ableton theme (src/sampler_theme_ableton.js) swaps them
    waveOut:  [0.42, 0.42, 0.42],
    waveIn:   [0.94, 0.94, 0.94],
    loopFill: [0.30, 0.85, 0.68],
    loopLine: [0.85, 1.00, 0.95],
    buttonOn: [0.42, 0.42, 0.42],
    menuEdge: [0.36, 0.36, 0.36],
    menuBg:   [0.20, 0.20, 0.20],
    menuSel:  [0.36, 0.36, 0.36]
};
// Font faces (the Ableton theme swaps them while it paints)
var faceFont = "Arial";
var faceFontBold = "Arial Bold";

// Engines by `mode` index, and Bitwig's list order (Repitch, Spectral, Cycles, Textures, Fragments)
var MODE_NAMES = ["Repitch", "Cycles", "Textures", "Spectral", "Fragments"];
var ENGINE_ORDER = [0, 3, 1, 2, 4];
var ENV_PAGES = ["AMP", "MOD", "LFO", "UNI"];
var ENV_PAGE_KNOBS = [
    [["atk_ms", "A"], ["dec_ms", "D"], ["sus_lvl", "S"], ["rel_ms", "R"]],
    [["matk_ms", "A"], ["mdec_ms", "D"], ["msus_lvl", "S"], ["mrel_ms", "R"], ["menv_pitch", "Pit"], ["menv_pos", "Pos"]],
    [["lfo_rate", "Rate"], ["lfo_shape", "Shape"], ["lfo_pitch", "Pit"], ["lfo_filt", "Flt"], ["lfo_pos", "Pos"]],
    [["unison_voices", "Uni"], ["unison_detune", "Detune"], ["poly_voices", "Poly"]]
];
var BIPOLAR_KEYS = {
    pitch_st: 1, formant: 1, filt_env_amt: 1, menv_pitch: 1, menv_pos: 1,
    lfo_pitch: 1, lfo_filt: 1, lfo_pos: 1, fine_cents: 1,
    rp_color: 1, sp_bend: 1, cy_width: 1, cy_split: 1, cy_harm: 1,
    osc2_pitch: 1, osc2_detune: 1, wt1_fx1: 1, wt2_fx1: 1,
    xs_fm_21: 1, xs_fm_12: 1, xs_rm_21: 1, xs_rm_12: 1,
    xs_cep_21: 1, xs_cep_12: 1, xs_fold_21: 1, xs_fold_12: 1,
    xs_sub_fm: 1, xs_sub_rm: 1, xs_sub_cep: 1, xs_sub_fold: 1, xs_tilt: 1,
    sub_semi: 1, sub_fine: 1, sub_odd: 1, sub_even: 1, sub_tilt: 1
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
    storeParam(key, v, true);
    expectEcho(key, v);
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
    mgraphics.select_font_face(bold ? faceFontBold : faceFont);
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

// One cached polyline per id. `key` must include every parameter the points depend on (cutoff, resonance,
// envelope times, slopes). A hit means the filter response or ADSR curve is not rebuilt this paint.
var curveGeomCache = {};
function curveGeomGet(id, key) {
    var slot = curveGeomCache[id];
    if (slot && slot.key === key) return slot.pts;
    return null;
}
function curveGeomPut(id, key, pts) {
    curveGeomCache[id] = { key: key, pts: pts };
    return pts;
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
            text(label, cx, ly, opts.labelSize || 8.5, opts.labelColor || COL.label, false, 1, alpha);
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

var LOOP_MODE_NAMES = ["Off", "One-way looping", "Ping-pong looping"];
var SLICE_AT_NAMES = ["Divisions", "Beats", "Onsets", "Pitches", "Manual"];
var SLICE_AT_DESCS = ["Slice into equal pieces", "Slice at note intervals", "Slice at transients", "Slice on pitch changes", "Slice it yourself"];
var SLICE_BEAT_LABELS = ["1 bar", "Half note", "Quarter note", "Triplet quarter note", "8th note", "Triplet 8th note",
    "16th note", "Triplet 16th note", "32nd note", "Triplet 32nd note"];
var SLICE_BEAT_SHORT = ["1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"];

// One Bitwig-style dropdown open at a time: {key, x, y, w, rowH}
var openMenu = null;

function menuItems(key) {
    var names, descs = null, icon = null;
    if (key === "slice_play") { names = SLICE_PLAY_NAMES; icon = iconSlicePlay; }
    else if (key === "loop_mode") { names = LOOP_MODE_NAMES; icon = function (x, y, i, c) { iconLoopMode(x, y, i, c); }; }
    else if (key === "slice_at") { names = SLICE_AT_NAMES; descs = SLICE_AT_DESCS; }
    else if (key === "slice_beat") { names = SLICE_BEAT_LABELS; }
    else { names = paramSpec(key).enums || []; }
    return { names: names, descs: descs, icon: icon };
}

// The canvas in zone coordinates [x, y, w, h]: the whole v8ui, except in the Ableton theme where canvases keep
// device coordinates (see sampler_theme_ableton.js)
function canvasBounds() {
    var sz = mgraphics.size;
    if (curFaceTheme === 1) { var o = abOrigin(); return [o[0], o[1], sz[0], sz[1]]; }
    return [0, 0, sz[0], sz[1]];
}

// Opens `key`'s menu next to (ax, ay); it stays inside the canvas and opens upward from the footer
function toggleMenu(key, ax, ay, w) {
    if (openMenu && openMenu.key === key) { openMenu = null; return; }
    var items = menuItems(key);
    var cb = canvasBounds();
    // Long lists (e.g. 12 keys) shrink their rows to fit the canvas
    var rowH = Math.min(15, Math.floor((cb[3] - 10) / Math.max(1, items.names.length)));
    var h = items.names.length * rowH + 6;
    var x = Math.max(cb[0] + 2, Math.min(cb[0] + cb[2] - w - 2, ax));
    var y = Math.max(cb[1] + 2, Math.min(cb[1] + cb[3] - h - 2, ay - h - 2));
    openMenu = { key: key, x: x, y: y, w: w, rowH: rowH };
}

function paintMenu() {
    if (!openMenu) return;
    var m = openMenu;
    var items = menuItems(m.key);
    var cur = Math.round(paramValue(m.key));
    var h = items.names.length * m.rowH + 6;
    fillRR(m.x - 1, m.y - 1, m.w + 2, h + 2, 3, COL.menuEdge);
    fillRR(m.x, m.y, m.w, h, 3, COL.menuBg);
    for (var i = 0; i < items.names.length; i++) {
        var ry = m.y + 3 + i * m.rowH;
        if (i === cur) fillRect(m.x + 3, ry, m.w - 6, m.rowH, COL.menuSel);
        var tx = m.x + 8;
        if (items.icon) { items.icon(m.x + 8, ry + m.rowH * 0.5 - 4, i, COL.text); tx = m.x + 28; }
        var nw = text(items.names[i], tx, ry + m.rowH * 0.5 + 3.5, 9.0, i === cur ? COL.label : COL.text, false, 0);
        if (items.descs) text(items.descs[i], tx + nw + 6, ry + m.rowH * 0.5 + 3.5, 8.5, COL.label, false, 0);
        zone("button", m.x, ry, m.w, m.rowH, { action: "menu_pick", key: m.key, value: i });
    }
}

function caret(x, y, c) {
    polygon([[x, y], [x + 6, y], [x + 3, y + 3.5]], c || COL.label);
}

// Small square toggle with a glyph (Bitwig's mode-panel icon buttons)
function iconToggle(x, y, key, glyph) {
    var on = Math.round(paramValue(key)) > 0;
    fillRR(x, y, 14, 12, 2, on ? COL.buttonOn : COL.button);
    glyph(x + 7, y + 6, on ? COL.text : COL.label);
    zone("button", x, y, 14, 12, { action: "toggle", key: key });
}

function glyphFork(cx, cy, c) { line(cx, cy + 4, cx, cy, c, 1.0, 1.2); line(cx, cy, cx - 3, cy - 4, c, 1.0, 1.2); line(cx, cy, cx + 3, cy - 4, c, 1.0, 1.2); }
function glyphBar(cx, cy, c) { line(cx, cy - 4, cx, cy + 4, c, 1.0, 1.6); line(cx - 2, cy - 4, cx + 2, cy - 4, c, 1.0, 1.0); line(cx - 2, cy + 4, cx + 2, cy + 4, c, 1.0, 1.0); }
function glyphGrid(cx, cy, c) { for (var i = -1; i <= 1; i++) { line(cx - 4, cy + i * 2.5, cx + 4, cy + i * 2.5, c, 1.0, 1.0); line(cx + i * 2.5, cy - 4, cx + i * 2.5, cy + 4, c, 1.0, 1.0); } }
function glyphCross(cx, cy, c) { line(cx - 4, cy - 3, cx + 4, cy + 3, c, 1.0, 1.2); line(cx - 4, cy + 3, cx + 4, cy - 3, c, 1.0, 1.2); line(cx - 4, cy, cx + 4, cy, c, 1.0, 1.0); }
function glyphNote(cx, cy, c) { circle(cx - 1.5, cy + 3, 2, c); line(cx + 0.5, cy + 3, cx + 0.5, cy - 4, c, 1.0, 1.2); line(cx + 0.5, cy - 4, cx + 3, cy - 2, c, 1.0, 1.2); }
function glyphLink(cx, cy, c) { strokeArc(cx - 2.5, cy, 2.5, Math.PI * 0.5, Math.PI * 1.5, c, 1.0, 1.2); strokeArc(cx + 2.5, cy, 2.5, -Math.PI * 0.5, Math.PI * 0.5, c, 1.0, 1.2); line(cx - 2.5, cy - 2.5, cx + 2.5, cy - 2.5, c, 1.0, 1.2); line(cx - 2.5, cy + 2.5, cx + 2.5, cy + 2.5, c, 1.0, 1.2); }

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
    fillRR(x, 3, w, 44, 3, COL.panel);
    var rows = [["Single", !curSliced], ["Sliced", !!curSliced]];
    for (var i = 0; i < 2; i++) {
        var ry = 3 + i * 22;
        var c = rows[i][1] ? COL.blue : COL.label;
        if (i === 0) iconWave(x + w * 0.5 - 6, ry + 3, c, 1.0); else iconKnife(x + w * 0.5 - 5.5, ry + 3, c, 1.0);
        text(rows[i][0], x + w * 0.5, ry + 20, 9.0, c, false, 1);
        zone("button", x, ry, w, 22, { action: "sliced_set", value: i });
    }

    fillRR(x, 50, w, 116, 3, COL.panel);
    for (var e = 0; e < ENGINE_ORDER.length; e++) {
        var m = ENGINE_ORDER[e];
        var ey = 50 + 116 * (e + 0.5) / ENGINE_ORDER.length + 3.5;
        text(MODE_NAMES[m], x + w * 0.5, ey, 9.0, curMode === m ? COL.blue : COL.label, false, 1);
        zone("button", x, ey - 14, w, 22, { action: "engine", engine: m });
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
    if (!dspReady) {
        // DSP still loading (deferred gen~) or failed: a pill in the voice-count slot
        var failed = dspError.length > 0;
        var pl = failed ? "DSP failed: " + dspError : "DSP loading…";
        var pw = textW(pl, 8.0) + 12;
        fillRR(vx - 4, sy + 3, pw, 12, 6, failed ? COL.red : COL.orange, 0.9);
        text(pl, vx - 4 + pw * 0.5, sy + 12, 8.0, [0.10, 0.10, 0.10], true, 1);
    } else {
        for (var b = 0; b < 4; b++) line(vx + b * 2.5, sy + 6, vx + b * 2.5, sy + 13, COL.blue, 0.9, 1.4);
        text(liveActiveVoices + " / " + curPolyVoices, vx + 14, sy + 13, 9.0, COL.blue, false, 0);
    }

    // ROOT: click the icon / label to switch between a fixed key and Analyzed Root Key ("Dynamic")
    var rx = sx + 330;
    var rc = rootDyn ? COL.blue : COL.label;
    strokeArc(rx + 4, sy + 9, 3.6, 0, Math.PI * 2, rc, 1.0, 1.2);
    line(rx + 1, sy + 9, rx + 7, sy + 9, rc, 1.0, 1.0);
    text("ROOT", rx + 11, sy + 13, 8.5, COL.label, true, 0);
    zone("button", rx - 2, sy + 1, 44, 15, { action: "toggle", key: "root_dyn" });
    if (rootDyn) {
        text(pitchCurve ? "Dynamic" : "Dynamic…", rx + 46, sy + 13, 9.0, COL.label, false, 0);
    } else {
        var noteW = text(midiToNoteName(curRootNote), rx + 46, sy + 13, 9.0, COL.blue, false, 0);
        zone("value", rx + 44, sy + 2, noteW + 4, 14, { key: "root_note", pxPerUnit: 4 });
        var fine = Math.round(paramValue("fine_cents"));
        var fineW = text(fine + " ct", rx + 62, sy + 13, 9.0, COL.blue, false, 0);
        zone("value", rx + 60, sy + 2, fineW + 4, 14, { key: "fine_cents", pxPerUnit: 1 });
    }

    // L / R output meters
    var mx = sx + sw - 30;
    fillRect(mx, sy + 6, 24, 2.5, COL.track);
    fillRect(mx, sy + 6, 24 * clamp01(livePeakL), 2.5, COL.green);
    fillRect(mx, sy + 10, 24, 2.5, COL.track);
    fillRect(mx, sy + 10, 24 * clamp01(livePeakR), 2.5, COL.green);

    // Waveform
    var wx = sx + 4, wy = sy + 17, ww = sw - 8, wh = 66;
    var loopOn = curLoopMode > 0;
    var loopZones = null;
    if (hasLoadedSample) {
        wavePolygon(wx, wy, ww, wh, 0, 1, COL.waveOut, 1.0);
        wavePolygon(wx, wy, ww, wh, curStart, curEnd, COL.waveIn, 1.0);
    } else {
        line(wx, wy + wh * 0.5, wx + ww, wy + wh * 0.5, COL.dim, 1.0, 1.0);
        text("Drop a sample here", wx + ww * 0.5, wy + wh * 0.5 - 6, 10.0, COL.label, false, 1);
    }

    if (loopOn && !curSliced) {
        // Bitwig loop: green body, a fade-in gradient before the loop start for the crossfade,
        // loop handles at the bottom and a move handle in the middle
        var lsX = wx + curLoopStart * ww, leX = wx + curLoopEnd * ww;
        var xfW = curXfade * (leX - lsX);
        var LOOPC = COL.loopFill;
        var strips = 14;
        for (var gi = 0; gi < strips && xfW > 1; gi++) {
            var gx0 = lsX - xfW + xfW * gi / strips;
            fillRect(gx0, wy, xfW / strips + 0.5, wh, LOOPC, 0.42 * (gi + 1) / strips);
        }
        fillRect(lsX, wy, leX - lsX, wh, LOOPC, 0.42);
        line(lsX, wy, lsX, wy + wh, COL.loopLine, 0.9, 1.0);
        line(leX, wy, leX, wy + wh, COL.loopLine, 0.9, 1.0);
        var midX = (lsX + leX) * 0.5;
        line(midX, wy, midX, wy + wh, COL.loopLine, 0.5, 1.0);
        fillRect(lsX, wy + wh - 7, 7, 7, LOOPC);
        fillRect(leX - 7, wy + wh - 7, 7, 7, LOOPC);
        fillRect(midX - 3.5, wy + wh * 0.5 - 3.5, 7, 7, LOOPC);
        loopZones = { xf: xfW > 4 ? [lsX - xfW, wy, xfW - 3, wh] : null, mv: [midX - 6, wy + wh * 0.5 - 6, 12, 12] };
    }

    if (curSliced) {
        // Bitwig-style slices: yellow flag + line per slice from the start point; markers outside
        // start..end are faint and unmapped. Slice k plays on key slice_from + k (C1 upward).
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
            if (nxt - mxs > 22) text(midiToNoteName(curSliceFrom + si), mxs + 3, wy + 16, 7.0, COL.yellow, false, 0, 0.8);
        }
    }

    // Grain cloud (Textures, Fragments) / cycle window (Cycles) around each sounding voice, clipped to
    // the waveform; Textures / Fragments also draw a line per playing grain at its read position
    // Scan lines only for a loaded sample: with an empty buffer the voices still run but play nothing
    for (var v = 0; v < 16 && hasLoadedSample; v++) {
        if ((voiceAmps[v] || 0) <= 0.02) continue;
        var phx = wx + clamp01(voicePlayheads[v]) * ww;
        if (curMode === 2 || curMode === 4) {
            var spread = Math.max(3, paramValue("grain_spray") * 0.01 * ww * 0.25);
            fillClipped(phx - spread, spread * 2, wx, ww, wy, wh, COL.blue, 0.08 * voiceAmps[v] + 0.04);
        } else if (curMode === 1) {
            var cw = Math.max(3, Math.min(ww * 0.2, paramValue("grain_size") / Math.max(1, sampleDurationMs) * ww));
            fillClipped(phx, cw, wx, ww, wy, wh, COL.blue, 0.12);
        }
        line(phx, wy, phx, wy + wh, COL.blue, Math.min(1, 0.35 + voiceAmps[v]), 1.0);
    }
    if (hasLoadedSample && (curMode === 2 || curMode === 4)) {
        for (var g = 0; g < GRAIN_SLOTS; g++) {
            var gp = grainPos[g], ga = grainAmp[g];
            if (!(gp >= 0) || !(ga > 0.02)) continue;
            var gx = wx + clamp01(gp) * ww;
            line(gx, wy + 4, gx, wy + wh - 4, [0.85, 0.95, 1.0], Math.min(0.9, 0.2 + 0.7 * ga), 1.0);
        }
    }

    // Analyzed Root Key curve sits above the loop and slice overlays
    if (rootDyn && pitchCurve && hasLoadedSample) paintPitchCurve(wx, wy, ww, wh);

    // Start / end: yellow flags at the top, or blue handles at the bottom in Sliced mode (Bitwig)
    var stX = wx + curStart * ww, enX = wx + curEnd * ww;
    if (curSliced) {
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
    if (loopOn && !curSliced && loopZones) {
        if (loopZones.xf) zone("xfade", loopZones.xf[0], loopZones.xf[1], loopZones.xf[2], loopZones.xf[3], {});
        zone("loop_move", loopZones.mv[0], loopZones.mv[1], loopZones.mv[2], loopZones.mv[3], {});
    }
    // Flags of slice markers (not the start point) can be dragged; zones after "wave" win the hit test
    if (curSliced) {
        for (var fi = 0; fi < sliceMarkers.length; fi++) {
            var fm = sliceMarkers[fi];
            if (fm > curStart + 0.002 && fm < curEnd - 0.002) zone("flag", wx + fm * ww - 2, wy, 10, 9, { index: fi });
        }
    }

    var fy = sy + sh - 4;
    if (curSliced) {
        paintSlicedFooter(sx, sw, fy);
        return;
    }
    // Footer: PLAY reverse/start/end, LOOP mode (dropdown)/start/end/xfade
    text("PLAY", sx + 6, fy, 8.5, COL.label, true, 0);
    iconReverse(sx + 36, fy - 9, curReverse);
    zone("button", sx + 33, fy - 11, 16, 14, { action: "reverse" });
    iconFlag(sx + 58, fy - 9, COL.yellow, false);
    var stW = text(fmtPos(curStart), sx + 66, fy, 9.0, COL.yellow, false, 0);
    zone("value", sx + 64, fy - 11, stW + 4, 14, { region: "samp_start" });
    iconFlag(sx + 132, fy - 9, COL.yellow, true);
    var enW = text(fmtPos(curEnd), sx + 136, fy, 9.0, COL.yellow, false, 0);
    zone("value", sx + 134, fy - 11, enW + 4, 14, { region: "samp_end" });

    var lx = sx + 240;
    var lc = loopOn ? COL.green : COL.dim;
    text("LOOP", lx, fy, 8.5, COL.label, true, 0);
    iconLoopMode(lx + 32, fy - 8, curLoopMode, loopOn ? COL.text : COL.label);
    caret(lx + 47, fy - 6);
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

// Sliced footer: Use keys from <key> | Slice at: <mode> <amount> | Playback <mode>
function paintSlicedFooter(sx, sw, fy) {
    text("Use:", sx + 6, fy, 8.5, COL.label, true, 0);
    for (var kk = 0; kk < 4; kk++) fillRect(sx + 30 + kk * 3.2, fy - 9, 2.4, 9, COL.blue);
    text("from", sx + 47, fy, 8.5, COL.label, false, 0);
    var kw = text(midiToNoteName(curSliceFrom), sx + 72, fy, 9.0, COL.blue, false, 0);
    zone("value", sx + 70, fy - 11, kw + 4, 14, { key: "slice_from", pxPerUnit: 4 });

    var at = Math.round(paramValue("slice_at"));
    var ax = sx + 150;
    var lw = text("Slice at:", ax, fy, 8.5, COL.label, true, 0);
    var nw = text(SLICE_AT_NAMES[at], ax + lw + 5, fy, 9.0, COL.blue, false, 0);
    caret(ax + lw + nw + 8, fy - 6);
    zone("button", ax + lw + 3, fy - 11, nw + 14, 14, { action: "menu", key: "slice_at", mw: 224 });
    var vx = ax + lw + nw + 22;
    if (at === 0) {
        var dw = text(String(Math.round(paramValue("slice_div"))), vx, fy, 9.0, COL.blue, false, 0);
        zone("value", vx - 2, fy - 11, dw + 4, 14, { key: "slice_div", pxPerUnit: 3 });
    } else if (at === 1) {
        glyphNote(vx + 4, fy - 4, COL.blue);
        var bw = text(SLICE_BEAT_SHORT[Math.round(paramValue("slice_beat"))], vx + 11, fy, 9.0, COL.blue, false, 0);
        caret(vx + 14 + bw, fy - 6);
        zone("button", vx - 2, fy - 11, bw + 24, 14, { action: "menu", key: "slice_beat", mw: 150 });
    } else if (at === 2 || at === 3) {
        var sw2 = text(Math.round(paramValue("slice_sens")) + " %", vx, fy, 9.0, COL.blue, false, 0);
        zone("value", vx - 2, fy - 11, sw2 + 4, 14, { key: "slice_sens", norm: true });
        if (sliceMonoJob) text("analyzing…", vx + sw2 + 8, fy, 8.0, COL.label, false, 0);
    } else {
        text("dbl-click: add / remove", vx, fy, 8.0, COL.label, false, 0);
    }

    // Playback: slice end / sample end / one-way loop / ping-pong
    var sp = Math.round(paramValue("slice_play"));
    var px2 = sx + sw - 8;
    caret(px2 - 7, fy - 6);
    iconSlicePlay(px2 - 26, fy - 8, sp, COL.blue);
    var plW = text("Playback", px2 - 30, fy, 8.5, COL.label, true, 2);
    zone("button", px2 - 34 - plW, fy - 11, plW + 36, 14, { action: "menu", key: "slice_play", mw: 128 });
}
// Analyzed Root Key curve: pitch over the sample, scaled to its own range (padded 2 st), brighter
// where the tracker is confident
function paintPitchCurve(wx, wy, ww, wh) {
    var n = pitchCurve.length;
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < n; i++) { var v = pitchCurve[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    lo -= 2; hi += 2;
    var span = Math.max(4, hi - lo);
    var top = wy + 6, bot = wy + wh - 6;
    var cols = Math.max(2, Math.round(ww));
    var runVoiced = -1;
    mgraphics.set_line_width(1.6);
    for (var c = 0; c <= cols; c++) {
        var idx = Math.min(n - 1, Math.round(c / cols * (n - 1)));
        var vz = pitchVoiced ? pitchVoiced[idx] : 1;
        var px = wx + c / cols * ww;
        var py = bot - (pitchCurve[idx] - lo) / span * (bot - top);
        if (vz !== runVoiced) {
            if (runVoiced >= 0) { mgraphics.line_to(px, py); mgraphics.stroke(); }
            setc(COL.orange, vz ? 0.95 : 0.4);
            mgraphics.move_to(px, py);
            runVoiced = vz;
        } else {
            mgraphics.line_to(px, py);
        }
    }
    mgraphics.stroke();
}

// A rect clipped horizontally to [cx, cx + cw] (overlays must never spill out of the waveform)
function fillClipped(x, w, cx, cw, y, h, c, a) {
    var x0 = Math.max(x, cx), x1 = Math.min(x + w, cx + cw);
    if (x1 > x0) fillRect(x0, y, x1 - x0, h, c, a);
}

function fmtPos(norm) {
    return sampleDurationMs > 0 ? fmtTime(norm * sampleDurationMs) : (norm * 100).toFixed(1) + " %";
}

function bottomPanel(p) {
    fillRR(p[0], MAIN.bottomY, p[1], MAIN.bottomH, 3, COL.panel);
}

// Character header "◀ name ▶" stepping `key`
function charHeader(x, w, y, key) {
    // "◀ name ▶" in the left 64 px; toggle icons sit at the right edge
    var names = paramSpec(key).enums;
    polygon([[x + 6, y + 8], [x + 10, y + 5], [x + 10, y + 11]], COL.label);
    polygon([[x + 62, y + 8], [x + 58, y + 5], [x + 58, y + 11]], COL.label);
    text(names[Math.round(paramValue(key))], x + 34, y + 12, 9.0, COL.text, true, 1);
    zone("button", x, y, 16, 16, { action: "step", key: key, delta: -1 });
    zone("button", x + 52, y, 16, 16, { action: "step", key: key, delta: 1 });
}

function paintEnginePanel() {
    var p = MAIN.p1, x = p[0], w = p[1], y = MAIN.bottomY;
    bottomPanel(p);
    var k3 = [x + w * 0.18, x + w * 0.5, x + w * 0.82];
    var k2 = [x + w * 0.3, x + w * 0.7];
    var ky = y + 34;
    if (curMode === 0) {
        charHeader(x, w, y, "rp_char");
        var ch = Math.round(paramValue("rp_char"));
        if (ch === 2) {
            iconToggle(x + w - 34, y + 3, "rp_imaging", glyphFork);
            iconToggle(x + w - 18, y + 3, "rp_vsr", glyphBar);
        }
        var labs = ch === 1 ? ["Crunch", "Tape"] : (ch === 2 ? ["Bits", "Color"] : ["—", "—"]);
        drawKnob("rp_dist", k2[0], ky, 10, labs[0], { dim: ch === 0 });
        drawKnob("rp_color", k2[1], ky, 10, labs[1], { dim: ch === 0 });
    } else if (curMode === 3) {
        charHeader(x, w, y, "sp_char");
        iconToggle(x + w - 34, y + 3, "sp_onsets", glyphBar);
        iconToggle(x + w - 18, y + 3, "sp_formant_on", glyphGrid);
        if (Math.round(paramValue("sp_char")) === 0) {
            drawKnob("formant", k2[0], ky, 10, "Formant", { white: true });
            drawKnob("sp_shift", k2[1], ky, 10, "Shift %");
        } else {
            drawKnob("sp_bend", k3[0], ky, 10, "Bend", { white: true, labelSize: 8 });
            var q = Math.round(paramValue("sp_quant"));
            fillRR(k3[1] - 13, ky - 7, 26, 14, 2, COL.button);
            text(["—", "Oct", "Key"][q], k3[1] - 3, ky + 3.5, 8.5, COL.text, false, 1);
            caret(k3[1] + 5, ky - 1.5);
            zone("button", k3[1] - 13, ky - 7, 26, 14, { action: "menu", key: "sp_quant", mw: 80 });
            text("Quant.", k3[1], y + 57, 8, COL.label, false, 1);
            drawKnob("sp_quant_amt", k3[2], ky, 9, "%", { dim: q === 0 });
        }
    } else if (curMode === 1) {
        charHeader(x, w, y, "cy_char");
        iconToggle(x + w - 18, y + 3, "cy_xfade", glyphCross);
        var cc = Math.round(paramValue("cy_char"));
        if (cc === 0) {
            drawKnob("formant", k2[0], ky, 10, "Formant", { white: true });
            drawKnob("cy_width", k2[1], ky, 10, "Width");
        } else if (cc === 1) {
            drawKnob("formant", k3[0], ky, 10, "Formant", { white: true });
            drawKnob("cy_split", k3[1], ky, 10, "Split");
            drawKnob("cy_fund", k3[2], ky, 9, "Fund.");
        } else {
            drawKnob("formant", k3[0], ky, 10, "Formant", { white: true });
            drawKnob("cy_mod", k3[1], ky, 10, "Mod");
            drawKnob("cy_harm", k3[2], ky, 9, "Harm.");
        }
    } else if (curMode === 2) {
        text("Textures", x + 39, y + 12, 9.5, COL.text, true, 1);
        drawKnob("grain_size", k2[0], ky, 10, "Size", { white: true });
        drawKnob("grain_spray", k2[1], ky, 10, "Spray");
    } else {
        // Fragments: grain envelope glyph + Repeats in the header, Gr. Size / Density / Motion
        var env = paramValue("fr_env") * 0.01;
        var ex = x + 8, ey0 = y + 13;
        setc(COL.orange);
        mgraphics.set_line_width(1.3);
        mgraphics.move_to(ex, ey0);
        mgraphics.line_to(ex + 3 + env * 8, ey0 - 9);
        mgraphics.line_to(ex + 14, ey0);
        mgraphics.stroke();
        zone("value", x + 4, y + 2, 18, 14, { key: "fr_env", norm: true });
        text("Rpt", x + 26, y + 12, 9.0, COL.label, false, 0);
        var rw = text(String(Math.round(paramValue("fr_repeats"))), x + 46, y + 12, 9.0, COL.orange, false, 0);
        zone("value", x + 24, y + 2, rw + 26, 14, { key: "fr_repeats", pxPerUnit: 6 });
        drawKnob("grain_size", k3[0], ky, 10, "Size", { white: true });
        drawKnob("fr_density", k3[1], ky, 10, "Density", { dim: Math.round(paramValue("fr_use_density")) === 0 });
        drawKnob("fr_motion", k3[2], ky, 9, "Motion");
        iconToggle(x + w - 34, y + 3, "fr_sync", glyphNote);
        iconToggle(x + w - 18, y + 3, "fr_use_density", glyphLink);
    }
}

function paintPlayPanel() {
    var p = MAIN.p2, x = p[0], w = p[1], y = MAIN.bottomY;
    bottomPanel(p);
    iconSnow(x + w * 0.5, y + 9, curFreeze ? COL.blue : COL.label, 1.0);
    zone("button", x + w * 0.5 - 9, y + 1, 18, 16, { action: "freeze" });
    var scanOn = (curMode !== 0);
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
    // Inspector show / hide (Bitwig's FX-row style button)
    fillRR(0, 0, W, 24, 2, COL.button);
    fillRect(2, 1, W - 4, 2, showInspector ? COL.blue : COL.track);
    fillRR(W * 0.5 - 30, 7, 11, 10, 1.5, showInspector ? COL.text : COL.label);
    fillRect(W * 0.5 - 24, 8, 4, 8, COL.button);
    text("Inspector", W * 0.5 + 7, 16, 8.5, showInspector ? COL.text : COL.label, true, 1);
    zone("button", 0, 0, W, 24, { action: "inspector" });

    var top = 27;
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
    text("L", 9, py + 21, 8.5, COL.label, true, 1);
    text("R", W - 9, py + 21, 8.5, COL.label, true, 1);
    drawKnob("unison_width", cx, py + 17, 9, null);
    drawKnob("glide_ms", W * 0.27, py + 42, 8, null);
    drawKnob("vel_sens", W * 0.73, py + 42, 8, null);
    // glide (pin) and velocity (speaker) glyphs under the small knobs
    var gx = W * 0.27, vx = W * 0.73;
    if (hoverKey === "glide_ms" || (drag && drag.key === "glide_ms")) text(fmtParam("glide_ms", paramValue("glide_ms")), gx, py + 63, 8.0, COL.text, true, 1);
    else { circle(gx, py + 56, 2, COL.label); line(gx, py + 70, gx, py + 63, COL.label, 1.0, 1.2); }
    if (hoverKey === "vel_sens" || (drag && drag.key === "vel_sens")) text(fmtParam("vel_sens", paramValue("vel_sens")), vx, py + 63, 8.0, COL.text, true, 1);
    else polygon([[vx - 4, py + 57], [vx - 2, py + 57], [vx + 2, py + 54], [vx + 2, py + 64], [vx - 2, py + 61], [vx - 4, py + 61]], COL.label);
    if (hoverKey === "unison_width" || (drag && drag.key === "unison_width")) text(fmtParam("unison_width", paramValue("unison_width")), cx, py + 6, 7.5, COL.text, true, 1);
    drawKnob("out_gain", cx, py + 82, 12, "Out", { labelY: py + 104 });
}

// ---------------------------------------------------------------------------
// Inspector region: Note Glide + Legato, then the current mode's extra settings
// ---------------------------------------------------------------------------

function inspRow(label, y, W) {
    text(label, 8, y + 11, 9.0, COL.text, false, 0);
}

function inspCheck(key, y, W) {
    var on = Math.round(paramValue(key)) > 0;
    circle(W - 16, y + 7, 6, on ? COL.orange : [0.30, 0.30, 0.30]);
    if (on) { line(W - 19, y + 7, W - 17, y + 9.5, [0.12, 0.12, 0.12], 1.0, 1.6); line(W - 17, y + 9.5, W - 12.5, y + 4, [0.12, 0.12, 0.12], 1.0, 1.6); }
    zone("button", 0, y, W, 15, { action: "toggle", key: key });
}

function inspValue(key, y, W, opts) {
    var vw = text(fmtParam(key, paramValue(key)), W - 8, y + 11, 9.0, COL.orange, false, 2);
    zone("value", W - 12 - vw, y, vw + 8, 15, opts || { key: key, norm: true });
}

function inspMenu(key, y, W, w) {
    var names = menuItems(key).names;
    fillRR(W - 66, y + 1, 58, 13, 2, COL.button);
    text(names[Math.round(paramValue(key))], W - 62, y + 11, 8.5, COL.text, false, 0);
    caret(W - 17, y + 6);
    zone("button", W - 66, y + 1, 58, 13, { action: "menu", key: key, w2: w || 90, below: true });
}

// "Theme" row at the top of the inspector: Bitwig | Ableton (emits face_theme)
function inspThemeRow(y, W) {
    if (curFaceTheme === 1) { abInspThemeRow(y, W); return; }
    text("Theme", 8, y + 11, 9.0, COL.text, false, 0);
    var names = paramSpec("face_theme").enums || ["Bitwig", "Ableton"];
    var cw = 48, cx0 = W - 8 - cw * 2;
    for (var i = 0; i < 2; i++) {
        var on = curFaceTheme === i;
        fillRR(cx0 + i * cw, y, cw - 1, 14, 2, on ? COL.buttonOn : COL.button);
        text(names[i], cx0 + i * cw + (cw - 1) * 0.5, y + 10.5, 8.5, on ? COL.text : COL.label, true, 1);
        zone("button", cx0 + i * cw, y, cw - 1, 14, { action: "face_theme", value: i });
    }
}

function paintInspector(W, H) {
    fillRR(0, 3, W - 3, H - 6, 3, COL.panel);
    inspThemeRow(6, W);
    var y = 27;
    text("Note Glide", 8, y + 11, 9.0, COL.text, false, 0);
    var leg = curMonoLegato === 1;
    fillRR(W - 76, y + 1, 13, 13, 2, leg ? COL.text : [0.30, 0.30, 0.30]);
    text("L", W - 69.5, y + 11, 8.5, leg ? COL.panel : COL.label, true, 1);
    zone("button", W - 76, y + 1, 13, 13, { action: "voicing", value: leg ? 0 : 1 });
    inspValue("glide_ms", y, W);
    y += 20;
    line(6, y, W - 9, y, COL.track, 1.0, 1.0);
    y += 4;
    text(MODE_NAMES[curMode] + " mode", (W - 3) * 0.5, y + 11, 9.5, COL.text, true, 1);
    y += 17;
    if (curMode === 3) {
        inspRow("Phase Dispersion", y, W); inspValue("sp_dispersion", y, W); y += 16;
        inspRow("Quality / Cost", y, W); inspMenu("sp_quality", y, W); y += 16;
        inspRow("Live Performance", y, W); inspCheck("sp_live", y, W); y += 16;
        inspRow("Relative Formants", y, W); inspCheck("sp_rel_formant", y, W); y += 16;
        inspRow("Local Key", y, W); inspMenu("sp_key", y, W, 60); y += 16;
        inspRow("Local Scale", y, W); inspMenu("sp_scale", y, W); y += 16;
    } else if (curMode === 4) {
        inspRow("Direction", y, W); inspMenu("fr_direction", y, W); y += 16;
        inspRow("Latch Initial Rate", y, W); inspCheck("fr_latch", y, W); y += 16;
        inspRow("Repeat at Initial Pos", y, W); inspCheck("fr_repeat_init", y, W); y += 16;
        inspRow("Grains Survive End", y, W); inspCheck("fr_survive", y, W); y += 16;
        inspRow("Max Grains / Voice", y, W); inspValue("fr_max_grains", y, W, { key: "fr_max_grains", pxPerUnit: 1 }); y += 16;
    } else {
        text("No extra settings", (W - 3) * 0.5, y + 14, 9.0, COL.label, false, 1);
    }
}

// ---------------------------------------------------------------------------
// paint / mouse
// ---------------------------------------------------------------------------

function paint() {
    var sz = mgraphics.size;
    var W = sz[0], H = sz[1];
    hitZones = [];
    if (curFaceTheme === 1) { paintAbleton(W, H); return; }
    fillRect(0, 0, W, H, COL.gap);
    if (faceRegion === "side") {
        paintSide(W, H);
    } else if (faceRegion === "inspector") {
        paintInspector(W, H);
    } else {
        paintModeColumn();
        paintSamplePanel();
        paintEnginePanel();
        paintPlayPanel();
        paintFilterPanel();
        paintEnvPanel();
    }
    paintMenu();
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

function stepEngine(delta) {
    var i = ENGINE_ORDER.indexOf(curMode);
    setMode(ENGINE_ORDER[((i < 0 ? 0 : i) + delta + ENGINE_ORDER.length) % ENGINE_ORDER.length]);
}

function doAction(z) {
    switch (z.action) {
        case "sliced_set": pushUndoState(); setParamFromFace("sliced", z.value); notifyclients(); break;
        case "engine": setMode(z.engine); break;
        case "engine_prev": stepEngine(-1); break;
        case "engine_next": stepEngine(1); break;
        case "step": stepParam(z.key, z.delta); break;
        case "toggle": setParamFromFace(z.key, Math.round(paramValue(z.key)) > 0 ? 0 : 1); break;
        case "reverse": setParamFromFace("reverse", curReverse ? 0 : 1); break;
        case "freeze": setParamFromFace("freeze", curFreeze ? 0 : 1); break;
        case "filt_on": setParamFromFace("filt_on", curFiltOn ? 0 : 1); break;
        case "filt_type": stepParam("filt_type", 1); break;
        case "set_enum": setParamFromFace(z.key, z.value); break;
        case "face_theme": setParamFromFace("face_theme", z.value); break;
        case "voicing": setParamFromFace("mono_legato", z.value); break;
        case "env_page":
            envPage = z.page;
            if (typeof FACE_PARAMS !== "undefined" && FACE_PARAMS.env_page) setParamFromFace("env_page", z.page);
            notifyclients();
            break;
        case "browse": outlet(0, "browse", "bang"); break;
        case "inspector": setParamFromFace("show_inspector", showInspector ? 0 : 1); break;
        case "menu":
            if (z.wtEnvLoop) {
                if (openMenu && openMenu.key === z.key) openMenu = null;
                else openMenu = { key: z.key, x: z.anchorX, y: z.anchorY, w: z.w2 || 41, rowH: 13.5, wtEnvLoop: true, anchorX: z.anchorX, anchorY: z.anchorY };
            } else if (z.below) {
                var items = menuItems(z.key).names.length * Math.min(15, Math.floor((mgraphics.size[1] - 10) / menuItems(z.key).names.length)) + 6;
                toggleMenu(z.key, z.x + z.w - (z.w2 || z.w || 90), z.y + z.h + items + 2, z.w2 || 90);
            } else {
                toggleMenu(z.key, z.x + z.w - (z.w2 || 0) - (z.mw || 0), z.y, z.mw || 128);
            }
            break;
        case "menu_pick": setParamFromFace(z.key, z.value); openMenu = null; break;
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
    if (curFaceTheme === 1) { var o = abOrigin(); x += o[0]; y += o[1]; }
    var z = zoneAt(x, y);
    // An open dropdown takes the next click: pick an item, re-click its button, or click away to close
    if (openMenu && !(z && (z.action === "menu_pick" || (z.action === "menu" && z.key === openMenu.key)))) {
        openMenu = null;
        mgraphics.redraw();
        return;
    }
    if (drag && drag.captured) setCursorHidden(false);  // a release we never saw
    drag = null;
    if (!z) return;
    if (z.kind === "button") { doAction(z); return; }
    if (z.kind === "env_pt" || z.kind === "filt_pt") {
        drag = { pt: z };
        mgraphics.redraw();
        return;
    }
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
    if (z.kind === "flag") {
        // Moving a slice point makes the slicing Manual (as in Bitwig)
        pushUndoState();
        if (Math.round(paramValue("slice_at")) !== 4) setParamFromFace("slice_at", 4);
        drag = { flag: z.index };
        return;
    }
    if (z.kind === "loop_move") {
        pushUndoState();
        drag = { wave: "loop_move", n0: waveNorm(x), ls0: curLoopStart, le0: curLoopEnd };
        return;
    }
    if (z.kind === "xfade") {
        pushUndoState();
        drag = { wave: "xfade" };
        return;
    }
    if (z.kind === "wave") {
        var nx = waveNorm(x);
        var ww = z.w;
        pushUndoState();
        if (curSliced) {
            // Start / end handles stay draggable; elsewhere a click auditions the slice under it
            if (Math.abs(nx - curStart) * ww < 6.0) { drag = { wave: "samp_start" }; mgraphics.redraw(); return; }
            if (Math.abs(nx - curEnd) * ww < 6.0) { drag = { wave: "samp_end" }; mgraphics.redraw(); return; }
            var sIdx = sliceIndexAt(currentSliceStarts(), curEnd, nx);
            if (sIdx < 0) return;
            selectedSliceIdx = sIdx;
            midi_note(curSliceFrom + sIdx, 110);
            drag = { wave: "slice_audition", note: curSliceFrom + sIdx };
            mgraphics.redraw();
            return;
        }
        /** @type {Array<[string, number]>} */
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
    if (curFaceTheme === 1) { var o = abOrigin(); x += o[0]; y += o[1]; }
    if (!drag) return;
    if (but === 0) {
        if (drag.wave === "slice_audition") midi_note(drag.note, 0);
        if (drag.region || drag.wave || drag.flag !== undefined) notifyclients();
        if (drag.captured) {
            setCursorHidden(false);
            var zr = zoneAt(x, y);
            hoverKey = (zr && zr.kind === "knob") ? zr.key : "";
        }
        drag = null;
        mgraphics.redraw();
        return;
    }
    if (drag.pt) {
        abDragPoint(drag.pt, x, y);
        mgraphics.redraw();
        return;
    }
    var dy = drag.y0 - y;
    if (drag.flag !== undefined) {
        var i = drag.flag;
        var lo = (i > 0 ? sliceMarkers[i - 1] : 0) + 0.002;
        var hi = (i + 1 < sliceMarkers.length ? sliceMarkers[i + 1] : 1) - 0.002;
        sliceMarkers[i] = Math.max(lo, Math.min(hi, waveNorm(x)));
        refreshHeldSlices();
    } else if (drag.wave === "loop_move") {
        var len = drag.le0 - drag.ls0;
        var ns = Math.max(curStart, Math.min(curEnd - len, drag.ls0 + waveNorm(x) - drag.n0));
        curLoopStart = ns;
        curLoopEnd = ns + len;
        emitRegionParams();
    } else if (drag.wave === "xfade") {
        // Drag the fade's left edge: the crossfade spans up to 45 % of the loop before its start
        var loopLen = Math.max(1e-6, curLoopEnd - curLoopStart);
        curXfade = Math.max(0, Math.min(0.45, (curLoopStart - waveNorm(x)) / loopLen));
        emitRegionParams();
    } else if (drag.wave) {
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
    if (curFaceTheme === 1) { var o = abOrigin(); x += o[0]; y += o[1]; }
    var z = zoneAt(x, y);
    if (!z) return;
    if (z.kind === "env_pt" || z.kind === "filt_pt") {
        abResetPoint(z);
    } else if (z.kind === "knob" || (z.kind === "value" && z.key)) {
        setParamFromFace(z.key, paramSpec(z.key).init);
    } else if (z.kind === "value" && z.region) {
        pushUndoState();
        var defs = { samp_start: 0, samp_end: 1, loop_start: 0.15, loop_end: 0.85, loop_xfade: 0.05 / 0.45 };
        setRegion(z.region, defs[z.region]);
        notifyclients();
    } else if (curSliced && (z.kind === "flag" || z.kind === "wave")) {
        // Manual slicing: double-click a flag removes it, anywhere else adds a slice point
        pushUndoState();
        if (Math.round(paramValue("slice_at")) !== 4) setParamFromFace("slice_at", 4);
        if (z.kind === "flag") {
            sliceMarkers = (typeof removeSliceMarker === "function") ? removeSliceMarker(sliceMarkers, z.index)
                : sliceMarkers.filter(function (_, i) { return i !== z.index; });
        } else {
            var pos = waveNorm(x);
            sliceMarkers = (typeof addSliceMarker === "function") ? addSliceMarker(sliceMarkers, pos)
                : sliceMarkers.concat([pos]).sort(function (a, b) { return a - b; });
        }
        refreshHeldSlices();
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
    if (curFaceTheme === 1) { var o = abOrigin(); x += o[0]; y += o[1]; }
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
