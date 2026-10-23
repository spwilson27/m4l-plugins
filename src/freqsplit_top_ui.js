// freqsplit_top_ui.js — Freq Split header strip (v8ui, 84 x 15; spectral_theme.js is prepended): the Split Insertion Direction arrows (<- inserted at the
// right / high end, <-> in the middle, -> at the left / low end), drawn as a live.tab look-alike in Live theme colours. Live's UI font has no arrow
// glyphs, so they are drawn here. A click sends the direction index (0 High, 1 Mid, 2 Low) out of outlet 0 straight into the real
// `Insert` live.tab (which is off the face, automatable and linked); the live.tab echoes it back as set_dir.
//
// Messages in: set_dir <0..2>.  Outlet 0: the new direction index.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 1;

var FT_W = 84;
var FT_H = 15;
var ftDir = 0;
var FT_CELLS = [{ x: 0, w: 27 }, { x: 28, w: 27 }, { x: 56, w: 27 }];
var ftThemeTask = sptThemeWatch(null);

function set_dir(v) {
    var d = Math.max(0, Math.min(2, Math.round(Number(v))));
    if (d === ftDir) return;      // the control echoes every click and rack peer value: redraw only when the arrow changed
    ftDir = d;
    mgraphics.redraw();
}

function ftArrow(cx, cy, kind, col) {
    var half = 6;
    mgraphics.set_line_width(1);
    sptRgba(col);
    mgraphics.move_to(cx - half, cy);
    mgraphics.line_to(cx + half, cy);
    mgraphics.stroke();
    if (kind === 0 || kind === 1) {
        mgraphics.move_to(cx - half + 3, cy - 2.5);
        mgraphics.line_to(cx - half, cy);
        mgraphics.line_to(cx - half + 3, cy + 2.5);
        mgraphics.stroke();
    }
    if (kind === 1 || kind === 2) {
        mgraphics.move_to(cx + half - 3, cy - 2.5);
        mgraphics.line_to(cx + half, cy);
        mgraphics.line_to(cx + half - 3, cy + 2.5);
        mgraphics.stroke();
    }
}

// Three cells like a native live.tab: dark cells with light arrows, the selected one in the orange selection colour.
function paint() {
    for (var i = 0; i < 3; i++) {
        var c = FT_CELLS[i];
        var on = i === ftDir;
        sptRgba(sptColor(on ? "live_control_selection" : "live_control_bg"));
        mgraphics.rectangle(c.x, 0, c.w, FT_H);
        mgraphics.fill();
        ftArrow(c.x + c.w * 0.5, FT_H * 0.5, i, sptColor(on ? "live_lcd_bg" : "live_control_fg"));
    }
}

function onclick(x, y) {
    for (var i = 0; i < 3; i++) {
        var c = FT_CELLS[i];
        if (x >= c.x - 2 && x <= c.x + c.w + 2) {
            if (i !== ftDir) {
                ftDir = i;
                outlet(0, i);
                mgraphics.redraw();
            }
            return;
        }
    }
}

function ondblclick(x, y) {
    onclick(x, y);
}

function onidle() {}
function onidleout() {}
