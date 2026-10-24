// Better Sampler — "Ableton" face theme (face_theme == 1).
//
// Appended after src/sampler_face.js by scripts/build_sampler.py (global script scope, no exports). The Bitwig
// painters in sampler_face.js stay untouched for face_theme == 0; paint() calls paintAbleton() when the theme is
// Ableton.
//
// In the Ableton theme every knob, tab, toggle, menu and value box is the parameter's own live.* object (Live's
// theme colours, native automation / mapping), moved into place by abApplyLayout() with the pure layout of
// src/sampler_layout_ableton.js. What is still drawn here:
//   - main v8ui, shrunk to the sample panel (header, waveform, sliced / loop footers and their dropdown menus),
//   - region "adsr": the Simpler-style ADSR display (AMP / MOD pages), region "filt": the filter response curve,
//   - the inspector (restyled with Live colours, plus the Theme row).
// Shrunk canvases keep device coordinates: paint() translates by the canvas origin (AB_ORIGIN) and mouse events
// are shifted back by it (abOrigin()), so zones are in device pixels in every region.
// The Bitwig painters are reused under a swapped palette (COL and the font faces) where something is still drawn.
// Colours come from the user's Live theme (max.getcolor("live_...")), with the measured Live 12 default dark
// theme as fixed fallback (no `max` in the Node tests).
//
// Prefix: ab / AB_. Hit-zone kinds: "env_pt" (ADSR handle: pt A / D / R) and "filt_pt" (filter point).

var AB_FONT = "Ableton Sans Medium";

// Live 12.4.6 default dark theme (same measured values as src/spectral_theme.js)
var AB_FALLBACK = {
    live_desktop: [0.165, 0.165, 0.165],
    live_surface_bg: [0.212, 0.212, 0.212],
    live_lcd_bg: [0.094, 0.094, 0.094],
    live_lcd_frame: [0.243, 0.243, 0.243],
    live_lcd_title: [0.71, 0.71, 0.71],
    live_lcd_control_fg: [1.0, 0.678, 0.337],
    live_lcd_control_fg_alt: [0.012, 0.765, 0.835],
    live_display_line_one: [1.0, 0.678, 0.337],
    live_display_line_two: [0.012, 0.765, 0.835],
    live_display_handle_one: [1.0, 0.678, 0.337],
    live_display_handle_two: [1.0, 0.412, 0.498],
    live_display_scale_text: [0.525, 0.525, 0.525],
    live_control_bg: [0.118, 0.118, 0.118],
    live_control_fg: [0.71, 0.71, 0.71],
    live_control_selection: [1.0, 0.678, 0.337],
    live_control_zombie: [0.459, 0.459, 0.459],
    live_surface_frame: [0.141, 0.141, 0.141],
    live_alert: [0.906, 0.412, 0.259]
};

function abColor(name) {
    if (typeof m4lColor === "function" && typeof m4lIsActive === "function" && m4lIsActive()) {
        var mc = m4lColor(name, AB_FALLBACK[name] || [0.5, 0.5, 0.5, 1]);
        return [mc[0], mc[1], mc[2]];
    }
    try {
        if (typeof max !== "undefined" && max && typeof max.getcolor === "function") {
            var c = max.getcolor(name);
            if (c && c.length >= 3 && !(c.length > 3 && c[3] === 0 && c[0] === 0 && c[1] === 0 && c[2] === 0)) return [c[0], c[1], c[2]];
        }
    } catch (e) { /* no theme colour: use the fallback */ }
    var f = AB_FALLBACK[name] || [0.5, 0.5, 0.5];
    return [f[0], f[1], f[2]];
}

function abMix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// The Ableton palette in COL's keys, plus the colours only this file uses (under `ab`)
function abBuildPalette() {
    var desk = abColor("live_desktop"), surf = abColor("live_surface_bg"), lcd = abColor("live_lcd_bg");
    var ctlBg = abColor("live_control_bg"), ctlFg = abColor("live_control_fg"), sel = abColor("live_control_selection");
    var line1 = abColor("live_display_line_one"), alt = abColor("live_lcd_control_fg_alt");
    var scale = abColor("live_display_scale_text"), zombie = abColor("live_control_zombie");
    var text = abMix(ctlFg, [1, 1, 1], 0.3);
    return {
        col: {
            gap: surf, panel: desk, button: ctlBg, wave: lcd,
            text: text, label: scale, dim: abMix(zombie, desk, 0.35),
            blue: alt, yellow: abMix(ctlFg, [1, 1, 1], 0.55), orange: sel,
            red: abColor("live_alert"),
            knob: ctlBg, knobHi: ctlFg, track: abColor("live_lcd_frame"),
            waveIn: abMix(ctlFg, line1, 0.22), waveOut: abMix(abMix(ctlFg, line1, 0.22), lcd, 0.68),
            loopFill: [0.30, 0.85, 0.68], loopLine: [0.85, 1.0, 0.95],
            buttonOn: abMix(ctlBg, ctlFg, 0.28),
            menuEdge: abColor("live_lcd_frame"), menuBg: abMix(lcd, desk, 0.4), menuSel: abMix(ctlBg, ctlFg, 0.28)
        },
        lcd: lcd, frame: abColor("live_lcd_frame"), sel: sel, dark: abMix(lcd, [0, 0, 0], 0.4),
        line1: line1, line2: abColor("live_display_line_two"), handle: abColor("live_display_handle_one"),
        title: abColor("live_lcd_title"), scale: scale
    };
}

var AB = null;          // palette of the current paint
var abSaved = null;     // COL values to restore after painting

function abPush() {
    AB = abBuildPalette();
    abSaved = {};
    for (var k in AB.col) {
        if (Object.prototype.hasOwnProperty.call(AB.col, k)) { abSaved[k] = COL[k]; COL[k] = AB.col[k]; }
    }
    abSaved.__font = faceFont;
    abSaved.__fontBold = faceFontBold;
    faceFont = AB_FONT;
    faceFontBold = AB_FONT;
}

function abPop() {
    if (!abSaved) return;
    for (var k in abSaved) {
        if (k.indexOf("__") !== 0 && Object.prototype.hasOwnProperty.call(abSaved, k)) COL[k] = abSaved[k];
    }
    faceFont = abSaved.__font;
    faceFontBold = abSaved.__fontBold;
    abSaved = null;
}

function abOrigin() {
    return AB_ORIGIN[faceRegion] || [0, 0];
}

function paintAbleton(W, H) {
    abPush();
    try {
        mgraphics.save();
        var o = abOrigin();
        if (o[0] !== 0 || o[1] !== 0) mgraphics.translate(-o[0], -o[1]);
        if (faceRegion === "inspector") {
            fillRect(0, 0, W, H, COL.gap);
            paintInspector(W, H);
        } else if (faceRegion === "adsr") {
            abPaintAdsrRegion();
        } else if (faceRegion === "filt") {
            abPaintFilterRegion();
        } else if (faceRegion === "main") {
            abPaintSamplePanel();
        }
        paintMenu();
        mgraphics.restore();
    } finally {
        abPop();
    }
}

// ---------------------------------------------------------------------------
// Small widgets
// ---------------------------------------------------------------------------

// live.tab-style cell (inspector theme row): flat control fill, accent fill with dark text when selected
function abTab(x, y, w, h, label, on, props, size) {
    fillRect(x, y, w, h, on ? COL.orange : COL.button);
    text(label, x + w * 0.5, y + h * 0.5 + (size || 8.5) * 0.36, size || 8.5, on ? AB.dark : COL.text, false, 1);
    if (props) zone("button", x, y, w, h, props);
}

function abPolyline(pts, c, a, lw) {
    if (pts.length < 2) return;
    setc(c, a);
    mgraphics.set_line_width(lw || 1.0);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.stroke();
}

// LCD rectangle with a 1 px frame
function abLcd(x, y, w, h) {
    fillRect(x, y, w, h, AB.lcd);
    setc(AB.frame, 1.0);
    mgraphics.set_line_width(1.0);
    mgraphics.rectangle(x + 0.5, y + 0.5, w - 1, h - 1);
    mgraphics.stroke();
}

// small hollow handle
function abHandle(x, y, active) {
    circle(x, y, 3.6, AB.lcd);
    strokeArc(x, y, 3.2, 0, Math.PI * 2, active ? COL.text : AB.handle, 1.0, 1.1);
}

// a handle's hit zone, clipped to its canvas rect [cx, cy, cw, ch] (zones never leave their v8ui)
function abPtZone(kind, px, py, canvas, props) {
    var x0 = Math.max(canvas[0], px - 6), y0 = Math.max(canvas[1], py - 6);
    var x1 = Math.min(canvas[0] + canvas[2], px + 6), y1 = Math.min(canvas[1] + canvas[3], py + 6);
    zone(kind, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0), props);
}

// compact time / percent text for the LCD readouts (no space, so four fit side by side)
function abFmt(key, v) {
    var p = paramSpec(key);
    if (p.unit === 2) {
        if (v < 10) return v.toFixed(1) + "ms";
        if (v < 100) return v.toFixed(1) + "ms";
        if (v < 1000) return Math.round(v) + "ms";
        return (v / 1000).toFixed(2) + "s";
    }
    if (p.unit === 5) return Math.round(v) + "%";
    return fmtParam(key, v).replace(" ", "");
}

// ---------------------------------------------------------------------------
// Main region: the sample panel only
// ---------------------------------------------------------------------------

function abPaintSamplePanel() {
    paintSamplePanel();
    var sx = MAIN.sample[0], sy = MAIN.sample[1], sw = MAIN.sample[2], sh = MAIN.sample[3];
    setc(AB.frame, 1.0);
    mgraphics.set_line_width(1.0);
    mgraphics.rectangle_rounded(sx + 0.5, sy + 0.5, sw - 1, sh - 1, 3, 3);
    mgraphics.stroke();
}

// ---------------------------------------------------------------------------
// ADSR display (region "adsr": AMP and MOD pages)
// ---------------------------------------------------------------------------

var AB_ADSR_KEYS = [
    { a: "atk_ms", d: "dec_ms", s: "sus_lvl", r: "rel_ms" },
    { a: "matk_ms", d: "mdec_ms", s: "msus_lvl", r: "mrel_ms" }
];
var AB_ADSR_LCD_H = 28;
var AB_ADSR_CANVAS_H = 38;

// Where the breakpoints sit: stage widths are fixed shares of the plot, a stage's length is its parameter's knob position
function abAdsrGeom(lx, ly, lw, lh, keys) {
    var x0 = lx + 5, W = lw - 10, top = ly + 5, bot = ly + lh - 4;
    var sA = W * 0.27, sD = W * 0.27, hold = W * 0.16, sR = W * 0.30;
    var nA = toNorm(keys.a, paramValue(keys.a)), nD = toNorm(keys.d, paramValue(keys.d));
    var nS = toNorm(keys.s, paramValue(keys.s)), nR = toNorm(keys.r, paramValue(keys.r));
    var xA = x0 + sA * nA, xD = xA + sD * nD, xS = xD + hold, xR = xS + sR * nR;
    return {
        keys: keys, x0: x0, W: W, top: top, bot: bot, sA: sA, sD: sD, hold: hold, sR: sR,
        xA: xA, xD: xD, xS: xS, xR: xR, yS: bot - (bot - top) * nS
    };
}

function abPaintAdsrRegion() {
    if (envPage > 1) return;
    var keys = AB_ADSR_KEYS[envPage];
    var lx = AB_ORIGIN.adsr[0], ly = AB_ORIGIN.adsr[1];
    var lw = envPage === 0 ? 131 : 88, lh = AB_ADSR_LCD_H;
    var canvas = [lx, ly, lw, AB_ADSR_CANVAS_H];
    var g = abAdsrGeom(lx, ly, lw, lh, keys);
    abLcd(lx, ly, lw, lh);
    line(lx + 3, g.bot, lx + lw - 3, g.bot, AB.frame, 1.0, 1.0);
    var adsrKey = [envPage, g.x0, g.xA, g.xD, g.xS, g.xR, g.top, g.bot, g.yS].join("|");
    var pts = curveGeomGet("ab-adsr", adsrKey);
    if (!pts) {
        pts = [[g.x0, g.bot], [g.xA, g.top]];
        var i, t;
        for (i = 1; i <= 10; i++) {
            t = i / 10;
            pts.push([g.xA + (g.xD - g.xA) * t, g.yS + (g.top - g.yS) * (1 - t) * (1 - t)]);
        }
        pts.push([g.xS, g.yS]);
        for (i = 1; i <= 10; i++) {
            t = i / 10;
            pts.push([g.xS + (g.xR - g.xS) * t, g.bot - (g.bot - g.yS) * (1 - t) * (1 - t)]);
        }
        curveGeomPut("ab-adsr", adsrKey, pts);
    }
    polygon(pts, AB.line1, 0.22);
    abPolyline(pts, AB.line1, 1.0, 1.1);
    var hs = [["A", g.xA, g.top], ["R", g.xR, g.bot], ["D", g.xD, g.yS]];
    for (var h = 0; h < hs.length; h++) {
        var act = drag && drag.pt && drag.pt.pt === hs[h][0] && drag.pt.keys === keys;
        abHandle(hs[h][1], hs[h][2], act);
        abPtZone("env_pt", hs[h][1], hs[h][2], canvas, { pt: hs[h][0], keys: keys, geo: g });
    }
    // readouts: A D S R, each a draggable value (letters only when there is room)
    var order = [["A", keys.a], ["D", keys.d], ["S", keys.s], ["R", keys.r]];
    var cw = lw / 4, ry = ly + AB_ADSR_LCD_H + 1;
    for (var k = 0; k < 4; k++) {
        var rx = lx + k * cw;
        fillRect(rx, ry, cw - 1, 9, COL.button);
        if (envPage === 0) text(order[k][0], rx + 3, ry + 7, 6.5, COL.label, false, 0);
        text(abFmt(order[k][1], paramValue(order[k][1])), rx + cw - 1, ry + 7, envPage === 0 ? 6.5 : 5.8, COL.blue, false, 2);
        zone("value", rx, ry, cw - 1, 9, { key: order[k][1], norm: true });
    }
}

// ---------------------------------------------------------------------------
// Filter response curve (region "filt"): one draggable point, x = cutoff, y = resonance
// ---------------------------------------------------------------------------

var AB_FILT_DB = 18.0;     // resonance peak at Res 100 %
var AB_FILT_CANVAS = [292, 125, 90, 22];

function abFiltX(g, hz) {
    var t = Math.log(Math.max(20, Math.min(20000, hz)) / 20) / Math.log(1000);
    return g.x0 + g.W * t;
}

function abFiltGeom(lx, ly, lw, lh) {
    var y0 = ly + lh * 0.7;
    return { lx: lx, ly: ly, lw: lw, lh: lh, x0: lx + 4, W: lw - 8, top: ly + 3, bot: ly + lh - 2, y0: y0, k: (y0 - (ly + 4)) / AB_FILT_DB };
}

// magnitude (dB) of the 2-pole response at hz: LP / BP / HP, all peaking at Q (= resonance) at the cutoff
function abFiltDb(type, hz, fc, q) {
    var w = hz / fc, w2 = w * w;
    var den = Math.sqrt((1 - w2) * (1 - w2) + (w / q) * (w / q));
    var h = type === 0 ? 1 / den : (type === 2 ? w2 / den : w / den);
    return 20 * Math.log(Math.max(1e-6, h)) / Math.LN10;
}

function abPaintFilterRegion() {
    var cv = AB_FILT_CANVAS;
    var g = abFiltGeom(cv[0], cv[1], cv[2], cv[3]);
    var on = curFiltOn;
    var al = on ? 1.0 : 0.45;
    var ft = Math.round(paramValue("filt_type"));
    abLcd(g.lx, g.ly, g.lw, g.lh);
    for (var gi = 0; gi < 3; gi++) {
        var gx = abFiltX(g, 100 * Math.pow(10, gi));
        line(gx, g.ly + 1, gx, g.ly + g.lh - 1, AB.frame, 0.7, 1.0);
    }
    line(g.lx + 1, g.y0, g.lx + g.lw - 1, g.y0, AB.frame, 0.7, 1.0);
    var fc = Math.max(20, paramValue("filt_cutoff"));
    var resN = clamp01(paramValue("filt_res") / 100);
    var q = Math.pow(10, AB_FILT_DB * resN / 20);
    var filtKey = [ft, fc, q, g.x0, g.W, g.top, g.bot, g.y0, g.k].join("|");
    var pts = curveGeomGet("ab-filt", filtKey);
    if (!pts) {
        pts = [];
        var cols = Math.floor(g.W / 2);
        for (var c = 0; c <= cols; c++) {
            var hz = 20 * Math.pow(1000, c / cols);
            var db = Math.max(-40, Math.min(AB_FILT_DB + 3, abFiltDb(ft, hz, fc, q)));
            pts.push([g.x0 + g.W * c / cols, Math.max(g.top, Math.min(g.bot, g.y0 - db * g.k))]);
        }
        curveGeomPut("ab-filt", filtKey, pts);
    }
    polygon(pts.concat([[g.x0 + g.W, g.bot], [g.x0, g.bot]]), AB.line1, 0.20 * al);
    abPolyline(pts, AB.line1, al, 1.1);
    var px = abFiltX(g, fc), py = Math.max(g.top, g.y0 - AB_FILT_DB * resN * g.k);
    abHandle(px, py, drag && drag.pt && drag.pt.kind === "filt_pt");
    abPtZone("filt_pt", px, py, cv, { geo: g });
    text(fitText(fmtParam("filt_cutoff", fc), 40, 6.5), g.lx + 4, g.ly + 7, 6.5, AB.scale, false, 0, al);
}

// ---------------------------------------------------------------------------
// Dragging the ADSR handles / filter point (called from sampler_face.js ondrag / ondblclick)
// ---------------------------------------------------------------------------

function abSetNorm(key, n) {
    var v = fromNorm(key, clamp01(n));
    if (v !== paramValue(key)) setParamFromFace(key, v);
}

function abDragPoint(z, x, y) {
    var g = z.geo;
    if (z.kind === "filt_pt") {
        var t = clamp01((x - g.x0) / g.W);
        var p = paramSpec("filt_cutoff");
        var hz = Math.max(p.lo, Math.min(p.hi, 20 * Math.pow(1000, t)));
        if (hz !== paramValue("filt_cutoff")) setParamFromFace("filt_cutoff", hz);
        var pr = paramSpec("filt_res");
        var res = Math.max(pr.lo, Math.min(pr.hi, 100 * (g.y0 - y) / (AB_FILT_DB * g.k)));
        if (res !== paramValue("filt_res")) setParamFromFace("filt_res", res);
        return;
    }
    var k = z.keys;
    var xA = g.x0 + g.sA * toNorm(k.a, paramValue(k.a));
    if (z.pt === "A") {
        abSetNorm(k.a, (x - g.x0) / g.sA);
    } else if (z.pt === "D") {
        abSetNorm(k.d, (x - xA) / g.sD);
        abSetNorm(k.s, (g.bot - y) / (g.bot - g.top));
    } else {
        var xS = xA + g.sD * toNorm(k.d, paramValue(k.d)) + g.hold;
        abSetNorm(k.r, (x - xS) / g.sR);
    }
}

function abResetPoint(z) {
    if (z.kind === "filt_pt") {
        setParamFromFace("filt_cutoff", paramSpec("filt_cutoff").init);
        setParamFromFace("filt_res", paramSpec("filt_res").init);
        return;
    }
    var k = z.keys;
    if (z.pt === "A") setParamFromFace(k.a, paramSpec(k.a).init);
    else if (z.pt === "D") { setParamFromFace(k.d, paramSpec(k.d).init); setParamFromFace(k.s, paramSpec(k.s).init); }
    else setParamFromFace(k.r, paramSpec(k.r).init);
}

// "Theme" row of the inspector, Ableton look: label left, a two-cell tab right
function abInspThemeRow(y, W) {
    text("Theme", 8, y + 11, 9.0, COL.text, false, 0);
    var names = paramSpec("face_theme").enums || ["Bitwig", "Ableton"];
    var cw = 48, cx0 = W - 8 - cw * 2;
    for (var i = 0; i < 2; i++) {
        abTab(cx0 + i * cw, y, cw - 1, 14, names[i], curFaceTheme === i, { action: "face_theme", value: i }, 8);
    }
}

// ---------------------------------------------------------------------------
// Layout switching (main v8ui only): move the live.* widgets, panels and canvases
// ---------------------------------------------------------------------------

var abLayoutCache = null;          // layout key -> rect | null as last applied (starts as the saved Bitwig state)
var abPatcherOverride = null;      // tests hand in a fake patcher here
var abObjects = {};                // layout key -> looked-up Maxobj

function abThemeAvailable() {
    return typeof FACE_PARAMS !== "undefined" && !!FACE_PARAMS.face_theme;
}

function abLayoutState() {
    return {
        mode: curMode, sliced: curSliced,
        rpChar: Math.round(paramValue("rp_char")), spChar: Math.round(paramValue("sp_char")),
        spQuant: Math.round(paramValue("sp_quant")), cyChar: Math.round(paramValue("cy_char")),
        envPage: envPage, inspector: showInspector
    };
}

function abSameRect(a, b) {
    if (a === null || b === null) return a === b;
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

// Applies abComputeLayout() with getnamed + presentation_rect / hidden; only objects whose entry changed are touched
function abApplyLayout() {
    if (faceRegion !== "main" || !abThemeAvailable()) return 0;
    var p = abPatcherOverride || this.patcher;
    if (!p) return 0;
    if (!abLayoutCache) abLayoutCache = abComputeLayout(0, abLayoutState());
    var lay = abComputeLayout(curFaceTheme, abLayoutState());
    var calls = 0;
    for (var i = 0; i < AB_LAYOUT_KEYS.length; i++) {
        var key = AB_LAYOUT_KEYS[i];
        var r = lay[key];
        if (abSameRect(r, abLayoutCache[key])) continue;
        abLayoutCache[key] = r;
        var name = AB_BOXNAMES[key];
        var obj = abObjects[key] || (abObjects[key] = p.getnamed(name));
        if (!obj) continue;
        if (r) {
            obj.setattr("presentation_rect", r);
            obj.setattr("hidden", 0);
            calls += 2;
        } else {
            obj.setattr("hidden", 1);
            calls += 1;
        }
    }
    if (calls) mgraphics.redraw();
    return calls;
}

// storeParam() calls this after every value: re-apply the layout when one of its inputs moved
function abOnParam(key) {
    if (AB_LAYOUT_INPUTS[key]) abApplyLayout();
}
