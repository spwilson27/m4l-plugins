// Delay+ Options page: the feedback clip's transfer curve (input level -> what goes back into the
// loop), for the current Clip Mode and Clip Level. Display only; mirrors the gen core's clip
// (src/delayplus_start.genexpr, "Feedback clip"). Inputs: set_clipmode, set_cliplevel.

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var ccMode = 0, ccLevel = 0;
var ccThemeTask = dpThemeWatch();
var CC_RANGE = 2.5; // the plot spans input 0..2.5 (+8 dB)

function anything() {
    if (messagename === "set_clipmode") ccMode = Math.round(Number(arguments[0]) || 0);
    else if (messagename === "set_cliplevel") ccLevel = Number(arguments[0]) || 0;
    else return;
    mgraphics.redraw();
}

// Static curve; Limit is drawn at steady state (its gain settles at ceiling / input).
function ccOut(x, T) {
    if (ccMode === 1 || ccMode === 2) return Math.min(x, T);
    var k = 0.8 * T;
    return x <= k ? x : k + (T - k) * Math.tanh((x - k) / (T - k));
}

function paint() {
    var mg = mgraphics, w = mg.size[0], h = mg.size[1];
    var T = Math.pow(10, dpClamp(ccLevel, -18, 6) / 20);
    var frame = dpTheme("live_lcd_frame", [0.3, 0.3, 0.3, 1]);
    var line = dpTheme("live_display_line_one", [0.96, 0.64, 0.23, 1]);
    var scale = dpTheme("live_display_scale_text", [0.6, 0.6, 0.6, 1]);
    var px = function (v) { return 2 + v / CC_RANGE * (w - 4); };
    var py = function (v) { return h - 2 - v / CC_RANGE * (h - 4); };
    mg.set_line_width(1);
    mg.set_source_rgba(frame[0], frame[1], frame[2], 1);
    mg.rectangle(0.5, 0.5, w - 1, h - 1);
    mg.stroke();
    // unity diagonal and the ceiling
    mg.set_source_rgba(scale[0], scale[1], scale[2], 0.35);
    mg.move_to(px(0), py(0));
    mg.line_to(px(CC_RANGE), py(CC_RANGE));
    mg.stroke();
    mg.move_to(px(0), py(T));
    mg.line_to(px(CC_RANGE), py(T));
    mg.stroke();
    mg.set_source_rgba(line[0], line[1], line[2], 1);
    mg.set_line_width(1.6);
    for (var i = 0; i <= 80; i++) {
        var x = CC_RANGE * i / 80;
        if (i === 0) mg.move_to(px(x), py(ccOut(x, T)));
        else mg.line_to(px(x), py(ccOut(x, T)));
    }
    mg.stroke();
    mg.select_font_face("Arial");
    mg.set_font_size(8.5);
    mg.set_source_rgba(scale[0], scale[1], scale[2], 1);
    var lbl = (ccLevel > 0 ? "+" : "") + ccLevel.toFixed(1) + " dB";
    mg.move_to(4, Math.max(10, py(T) - 3));
    mg.show_text(lbl);
}

function onclick() {}

// scripts/render_preview.py
function preview() { ccMode = 0; ccLevel = -6; }
