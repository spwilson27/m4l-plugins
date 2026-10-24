// spectral_theme.js — shared Ableton-native look for the Spectral Split v8ui faces (Harmonic Split, Transient Split,
// Loud Split, Freq Split). The build concatenates it between spectral_link.js and the device's own *_ui.js (global script
// scope, no module export, so every function is visible to the face). Prefix: spt / SPT_.
//
// Why: Live's own devices (Reverb, EQ Eight, ...) share one flat look driven by the user's Live theme. Every colour here is read
// from the theme with max.getcolor(name) on each paint, so the face follows Live's theme and hue; the static fallback
// (SPT_FALLBACK) is Live 12's default dark theme measured in Live 12.4.6 (so node tests, scripts/render_preview.py and a Live
// without the colour all look the same). Never hard-code RGB in a face; ask sptColor("live_...").
//
// ---- API -------------------------------------------------------------------------------------------------------------------
// Colours (all return [r, g, b, a] in 0..1; `name` is a Live theme colour name):
//   sptColor(name, fallback?)          theme colour, falls back to SPT_FALLBACK[name] then `fallback`
//   sptRgba(c, a?)                     mgraphics.set_source_rgba(c, alpha); `a` multiplies c[3]
//   sptMix(a, b, t)                    linear blend of two colours (a at t = 0)
//   sptMuted(c, amount)                channel colour toned down towards the LCD background (amount 0 = background, 1 = c);
//                                      use ~0.75 for thin lines and 0.15..0.25 alpha fills (never big saturated fills)
// Theme change handling:
//   sptThemeWatch(onChange?)           Task (1 s): redraws the face when the theme colours change, then calls onChange
//                                      (use it with sptApplyPanelTheme). Returns the Task. Call once at load.
//   sptApplyPanelTheme(list, patcher)  list = [[scripting name of a panel, theme colour name], ...]: sets bgfillcolor / bgcolor /
//                                      bordercolor of those patcher panels from the theme (attribute bindings on a panel do not
//                                      repaint in Live, Delay+ does the same). patcher defaults to this.patcher.
// Drawing helpers (UI px, mgraphics pixel coordinates; they set their own colours):
//   sptLcd(x, y, w, h, grid?)          near-black LCD rectangle (live_lcd_bg), 1 px live_lcd_frame outline. grid =
//                                      {xs: [x, ...], ys: [y, ...]} in absolute px: faint 1 px lines (live_lcd_frame colour).
//   sptCurve(pts, col, a?)             1 px polyline through [[x, y], ...] (no fill, no glow); col is a colour array
//   sptHandle(x, y, col, label?, r?)   small hollow circle handle (default r 4.5, LCD-filled, 1 px ring); an optional label
//                                      (a number or a letter) is drawn centred inside, like Reverb's numbered handles
//   sptText(str, x, y, col, size?, align?)  text at baseline y; align 0 left / 1 centre / 2 right; size default SPT_SIZE
//   sptTextW(str, size?)               text width in px
//   sptTitle(str, x, y)                section title text (live_lcd_title colour, SPT_SIZE)
//   sptLabelValue(label, value, x, y, align?, active?, labelW?)   "Low  80.0 Hz": label in live_lcd_title, value in the LCD value colour
//                                      (live_lcd_control_fg_alt); align 0 starts at x, 2 ends at x; active = brighter (dragging);
//                                      labelW (optional) = fixed label column width in px, so values line up between rows
//   sptButton(x, y, w, h, text, on)    a live.text-looking toggle drawn in the canvas: orange fill (live_control_selection) with
//                                      dark text when on, 1 px orange outline and orange text when off (Reverb's Lo Cut / Hi Cut)
//   sptLegendSwatch(x, y, col)         6 x 2 px swatch for a legend entry
// Constants: SPT_FONT ("Ableton Sans Medium", falls back by itself), SPT_SIZE 9.5 (values / titles), SPT_SIZE_SMALL 8.5 (axis
// labels, legend). No bold, no ALL-CAPS badges.
//
// Theme names used by the Spectral Split faces (see the style guide): live_surface_bg (device body), live_desktop (recessed section
// panels), live_lcd_bg / live_lcd_frame (display + its grid), live_lcd_title (labels), live_lcd_control_fg_alt (values),
// live_control_fg / live_control_bg (controls), live_control_selection + live_display_handle_one (active / handles, the one orange
// accent), live_display_line_one / two (orange / cyan curves), live_display_scale_text (axis labels).

var SPT_FONT = "Ableton Sans Medium";
var SPT_SIZE = 9.5;
var SPT_SIZE_SMALL = 8.5;

// Live 12.4.6 default dark theme, measured with max.getcolor in Live.
var SPT_FALLBACK = {
    live_desktop: [0.165, 0.165, 0.165, 1],
    live_surface_bg: [0.212, 0.212, 0.212, 1],
    live_surface_frame: [0.141, 0.141, 0.141, 1],
    live_lcd_bg: [0.094, 0.094, 0.094, 1],
    live_lcd_frame: [0.243, 0.243, 0.243, 1],
    live_lcd_title: [0.71, 0.71, 0.71, 1],
    live_lcd_control_fg: [1, 0.678, 0.337, 1],
    live_lcd_control_fg_alt: [0.012, 0.765, 0.835, 1],
    live_display_line_one: [1, 0.678, 0.337, 1],
    live_display_line_two: [0.012, 0.765, 0.835, 1],
    live_display_handle_one: [1, 0.678, 0.337, 1],
    live_display_handle_two: [1, 0.412, 0.498, 1],
    live_display_scale_text: [0.525, 0.525, 0.525, 1],
    live_control_bg: [0.118, 0.118, 0.118, 1],
    live_control_fg: [0.71, 0.71, 0.71, 1],
    live_control_selection: [1, 0.678, 0.337, 1],
    live_control_zombie: [0.459, 0.459, 0.459, 1],
    live_alert: [0.906, 0.412, 0.259, 1]
};

function sptColor(name, fallback) {
    try {
        if (typeof max !== "undefined" && max && typeof max.getcolor === "function") {
            var c = max.getcolor(name);
            if (c && c.length >= 3 && !(c.length > 3 && c[3] === 0 && c[0] === 0 && c[1] === 0 && c[2] === 0)) {
                var liveCol = [Number(c[0]), Number(c[1]), Number(c[2]), c.length > 3 ? Number(c[3]) : 1];
                if (typeof m4lColor === "function" && typeof m4lIsActive === "function" && m4lIsActive()) {
                    var eff = typeof m4lEffectiveConfig === "function" ? m4lEffectiveConfig() : null;
                    if (!eff || eff.preset === "Default" || eff.preset === "Ableton Live") {
                        return liveCol;
                    }
                    return m4lColor(name, liveCol);
                }
                return liveCol;
            }
        }
    } catch (e) {}
    if (typeof m4lColor === "function" && typeof m4lIsActive === "function" && m4lIsActive()) {
        return m4lColor(name, SPT_FALLBACK[name] || fallback || [0.5, 0.5, 0.5, 1]);
    }
    var f = SPT_FALLBACK[name] || fallback || [0.5, 0.5, 0.5, 1];
    return [f[0], f[1], f[2], f.length > 3 ? f[3] : 1];
}

function sptRgba(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], (c.length > 3 ? c[3] : 1) * (a === undefined ? 1 : a));
}

function sptMix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
}

function sptMuted(c, amount) {
    return sptMix(sptColor("live_lcd_bg"), c, amount);
}

var sptThemeKey = "";
function sptThemeWatch(onChange) {
    if (typeof Task === "undefined" || typeof mgraphics === "undefined") return null;
    var t = new Task(function () {
        var k = "";
        var names = ["live_lcd_bg", "live_display_line_one", "live_display_line_two", "live_surface_bg", "live_desktop", "live_control_selection"];
        for (var i = 0; i < names.length; i++) k += String(sptColor(names[i]));
        if (k !== sptThemeKey) {
            sptThemeKey = k;
            mgraphics.redraw();
            if (typeof onChange === "function") onChange();
        }
    });
    t.interval = 1000;
    t.repeat();
    return t;
}

function sptApplyPanelTheme(list, patcher) {
    var p = patcher || ((typeof this !== "undefined" && this && this.patcher) ? this.patcher : null);
    if (!p) return;
    for (var i = 0; i < list.length; i++) {
        try {
            var o = p.getnamed(list[i][0]);
            if (!o) continue;
            var c = sptColor(list[i][1]);
            o.setattr("bgfillcolor", c[0], c[1], c[2], c[3]);
            o.setattr("bgcolor", c[0], c[1], c[2], c[3]);
            o.setattr("bordercolor", c[0], c[1], c[2], c[3]);
        } catch (err) {}
    }
}

function sptFont(size) {
    mgraphics.select_font_face(SPT_FONT);
    mgraphics.set_font_size(size === undefined ? SPT_SIZE : size);
}

function sptTextW(str, size) {
    sptFont(size);
    return mgraphics.text_measure(str)[0];
}

function sptText(str, x, y, col, size, align) {
    sptFont(size);
    var xx = x;
    if (align === 1 || align === 2) {
        var w = mgraphics.text_measure(str)[0];
        xx = align === 1 ? x - w * 0.5 : x - w;
    }
    sptRgba(col);
    mgraphics.move_to(xx, y);
    mgraphics.show_text(str);
}

function sptTitle(str, x, y) {
    sptText(str, x, y, sptColor("live_lcd_title"), SPT_SIZE, 0);
}

function sptLabelValue(label, value, x, y, align, active, labelW) {
    var wl = labelW ? labelW - 6 : sptTextW(label, SPT_SIZE);
    var wv = sptTextW(value, SPT_SIZE);
    var x0 = align === 2 ? x - (wl + 6 + wv) : x;
    sptText(label, x0, y, sptColor("live_lcd_title"), SPT_SIZE, 0);
    var vc = sptColor("live_lcd_control_fg_alt");
    sptText(value, x0 + wl + 6, y, active ? sptMix(vc, [1, 1, 1, 1], 0.35) : vc, SPT_SIZE, 0);
}

function sptLcd(x, y, w, h, grid) {
    sptRgba(sptColor("live_lcd_bg"));
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
    if (grid) {
        var gc = sptColor("live_lcd_frame");
        sptRgba(gc);
        var i;
        if (grid.xs) for (i = 0; i < grid.xs.length; i++) { mgraphics.rectangle(Math.round(grid.xs[i]) - 0.5, y, 1, h); mgraphics.fill(); }
        if (grid.ys) for (i = 0; i < grid.ys.length; i++) { mgraphics.rectangle(x, Math.round(grid.ys[i]) - 0.5, w, 1); mgraphics.fill(); }
    }
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.set_line_width(1);
    mgraphics.rectangle(x + 0.5, y + 0.5, w - 1, h - 1);
    mgraphics.stroke();
}

function sptCurve(pts, col, a) {
    if (!pts || pts.length < 2) return;
    sptRgba(col, a);
    mgraphics.set_line_width(1);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.stroke();
}

function sptHandle(x, y, col, label, r) {
    var rr = r === undefined ? 4.5 : r;
    sptRgba(sptColor("live_lcd_bg"));
    mgraphics.arc(x, y, rr, 0, Math.PI * 2);
    mgraphics.fill();
    sptRgba(col);
    mgraphics.set_line_width(1);
    mgraphics.arc(x, y, rr, 0, Math.PI * 2);
    mgraphics.stroke();
    if (label !== undefined && label !== null && label !== "") sptText(String(label), x, y + 2.6, col, 7, 1);
}

function sptButton(x, y, w, h, text, on) {
    var sel = sptColor("live_control_selection");
    if (on) {
        sptRgba(sel);
        mgraphics.rectangle(x, y, w, h);
        mgraphics.fill();
        sptText(text, x + w * 0.5, y + h - 3, sptColor("live_lcd_bg"), SPT_SIZE_SMALL, 1);
    } else {
        sptRgba(sel);
        mgraphics.set_line_width(1);
        mgraphics.rectangle(x + 0.5, y + 0.5, w - 1, h - 1);
        mgraphics.stroke();
        sptText(text, x + w * 0.5, y + h - 3, sel, SPT_SIZE_SMALL, 1);
    }
}

function sptLegendSwatch(x, y, col) {
    sptRgba(col);
    mgraphics.rectangle(x, y, 6, 2);
    mgraphics.fill();
}

// ---- Bounds helpers (keep every drawn coordinate inside its plot rect; tests/paint_bounds_lib.js enforces it) ----------------------
// A value-to-pixel mapping may leave the plot at a parameter extreme (threshold at its minimum, tilt at +-max, a knee band, ...):
// clamp scalars with sptClamp, and clip lines / polygons to the plot rect with the helpers below instead of drawing them raw.
// rect = {x, y, w, h}. All helpers are NaN-safe (a non-finite input is treated as the lower bound / dropped).
//   sptClamp(v, lo, hi)                      v limited to lo..hi (NaN -> lo)
//   sptClipLine(x0, y0, x1, y1, rect)        Liang-Barsky: [x0, y0, x1, y1] clipped to rect, or null when fully outside
//   sptClipPoly(pts, rect)                   Sutherland-Hodgman: polygon [[x, y], ...] clipped to rect ([] when fully outside)
//   sptCurveIn(pts, col, a, rect)            like sptCurve, but every segment is clipped to rect (a fresh move_to per piece)
//   sptFillPolyIn(pts, col, a, rect)         filled polygon clipped to rect
//   sptTextIn(str, x, y, col, size, align, rect)  like sptText, but x / baseline y are shifted so the text box (measured width,
//                                            0.8 size above and 0.2 size below the baseline) lies inside rect
function sptClamp(v, lo, hi) {
    if (!(v === v)) return lo;
    return v < lo ? lo : (v > hi ? hi : v);
}

function sptClipLine(x0, y0, x1, y1, rect) {
    if (!isFinite(x0) || !isFinite(y0) || !isFinite(x1) || !isFinite(y1)) return null;
    var xl = rect.x;
    var xh = rect.x + rect.w;
    var yl = rect.y;
    var yh = rect.y + rect.h;
    var dx = x1 - x0;
    var dy = y1 - y0;
    var t0 = 0;
    var t1 = 1;
    var p = [-dx, dx, -dy, dy];
    var q = [x0 - xl, xh - x0, y0 - yl, yh - y0];
    for (var i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return null;
        } else {
            var r = q[i] / p[i];
            if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
            else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
    }
    return [sptClamp(x0 + t0 * dx, xl, xh), sptClamp(y0 + t0 * dy, yl, yh), sptClamp(x0 + t1 * dx, xl, xh), sptClamp(y0 + t1 * dy, yl, yh)];
}

function sptClipPoly(pts, rect) {
    var xl = rect.x;
    var xh = rect.x + rect.w;
    var yl = rect.y;
    var yh = rect.y + rect.h;
    var out = [];
    var i;
    for (i = 0; i < pts.length; i++) if (isFinite(pts[i][0]) && isFinite(pts[i][1])) out.push([pts[i][0], pts[i][1]]);
    var edges = [
        function (p) { return p[0] >= xl; }, function (p) { return p[0] <= xh; },
        function (p) { return p[1] >= yl; }, function (p) { return p[1] <= yh; }
    ];
    var cut = [
        function (a, b) { return [xl, a[1] + (b[1] - a[1]) * (xl - a[0]) / (b[0] - a[0])]; },
        function (a, b) { return [xh, a[1] + (b[1] - a[1]) * (xh - a[0]) / (b[0] - a[0])]; },
        function (a, b) { return [a[0] + (b[0] - a[0]) * (yl - a[1]) / (b[1] - a[1]), yl]; },
        function (a, b) { return [a[0] + (b[0] - a[0]) * (yh - a[1]) / (b[1] - a[1]), yh]; }
    ];
    for (var e = 0; e < 4; e++) {
        var inp = out;
        out = [];
        if (inp.length === 0) break;
        var prev = inp[inp.length - 1];
        for (i = 0; i < inp.length; i++) {
            var cur = inp[i];
            var ci = edges[e](cur);
            var pi2 = edges[e](prev);
            if (ci) {
                if (!pi2) out.push(cut[e](prev, cur));
                out.push(cur);
            } else if (pi2) {
                out.push(cut[e](prev, cur));
            }
            prev = cur;
        }
    }
    for (i = 0; i < out.length; i++) {
        out[i][0] = sptClamp(out[i][0], xl, xh);
        out[i][1] = sptClamp(out[i][1], yl, yh);
    }
    return out;
}

function sptCurveIn(pts, col, a, rect) {
    if (!pts || pts.length < 2) return;
    sptRgba(col, a);
    mgraphics.set_line_width(1);
    var open = false;
    var lx = 0;
    var ly = 0;
    for (var i = 1; i < pts.length; i++) {
        var s = sptClipLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], rect);
        if (!s) { open = false; continue; }
        if (!open || s[0] !== lx || s[1] !== ly) mgraphics.move_to(s[0], s[1]);
        mgraphics.line_to(s[2], s[3]);
        lx = s[2];
        ly = s[3];
        open = true;
    }
    mgraphics.stroke();
}

function sptFillPolyIn(pts, col, a, rect) {
    var p = sptClipPoly(pts, rect);
    if (p.length < 3) return;
    mgraphics.move_to(p[0][0], p[0][1]);
    for (var i = 1; i < p.length; i++) mgraphics.line_to(p[i][0], p[i][1]);
    mgraphics.close_path();
    sptRgba(col, a);
    mgraphics.fill();
}

function sptTextIn(str, x, y, col, size, align, rect) {
    var sz = size === undefined ? SPT_SIZE : size;
    var w = sptTextW(str, sz);
    var x0 = align === 1 ? x - w * 0.5 : (align === 2 ? x - w : x);
    var xmax = rect.x + rect.w - w;
    x0 = xmax < rect.x ? rect.x : sptClamp(x0, rect.x, xmax);
    var yy = sptClamp(y, rect.y + sz * 0.8, rect.y + rect.h - sz * 0.2);
    sptText(str, x0, yy, col, sz, 0);
}
