// Delay+ icon button: a tiny v8ui that draws one of Echo's icon toggles and drives the
// (non-presentation) live.text parameter behind it. Live's UI font has no triangle / link glyphs.
// The build prepends `var DP_ICON = "tri" | "link";` to pick the icon.
//   tri   Filter Display toggle: right-pointing triangle when hidden, up when shown
//   link  Stereo Link: two chain links, lit when on
// State comes back as `set_<key> <0|1>` from the parameter; a click sends the toggled value out.

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var icKind = typeof DP_ICON !== "undefined" ? DP_ICON : "tri"; // set per instance by the build
var icOn = 0;
var icThemeTask = dpThemeWatch();

function icon(kind) {
    icKind = String(kind);
    mgraphics.redraw();
}

function anything() {
    if (messagename.indexOf("set_") === 0) {
        icOn = Number(arguments[0]) > 0.5 ? 1 : 0;
        mgraphics.redraw();
    }
}

function onclick() {
    icOn = icOn ? 0 : 1;
    outlet(0, icOn);
    mgraphics.redraw();
}

function paint() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    if (icKind === "link") {
        var on = dpTheme("live_control_selection", [0.96, 0.64, 0.23, 1]);
        var off = dpTheme("live_control_bg", [0.24, 0.24, 0.24, 1]);
        var c = icOn ? on : off;
        mgraphics.set_source_rgba(c[0], c[1], c[2], 1);
        mgraphics.rectangle_rounded(0, 0, w, h, 2, 2);
        mgraphics.fill();
        var g = icOn ? dpTheme("live_control_text_selection", [0.1, 0.1, 0.1, 1]) : dpTheme("live_control_fg", [0.75, 0.75, 0.75, 1]);
        mgraphics.set_source_rgba(g[0], g[1], g[2], 1);
        mgraphics.set_line_width(1.2);
        var cy = h / 2;
        mgraphics.rectangle_rounded(w * 0.16, cy - 2.2, w * 0.4, 4.4, 2.2, 2.2);
        mgraphics.stroke();
        mgraphics.rectangle_rounded(w * 0.44, cy - 2.2, w * 0.4, 4.4, 2.2, 2.2);
        mgraphics.stroke();
        return;
    }
    var t = dpTheme("live_lcd_title", [0.75, 0.75, 0.75, 1]);
    mgraphics.set_source_rgba(t[0], t[1], t[2], 1);
    if (icOn) {
        mgraphics.move_to(w * 0.5, h * 0.25);
        mgraphics.line_to(w * 0.85, h * 0.75);
        mgraphics.line_to(w * 0.15, h * 0.75);
    } else {
        mgraphics.move_to(w * 0.3, h * 0.18);
        mgraphics.line_to(w * 0.8, h * 0.5);
        mgraphics.line_to(w * 0.3, h * 0.82);
    }
    mgraphics.close_path();
    mgraphics.fill();
}

// scripts/render_preview.py: the Filter Display is shown by default, Stereo Link is on.
function preview() {
    icOn = 1;
}
