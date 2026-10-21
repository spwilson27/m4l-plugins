// freqsplit_top_ui.js — Freq Split header strip (v8ui, 160 x 15): the Split Insertion Direction arrows (<- inserted at the
// right / high end, <-> in the middle, -> at the left / low end) and the crossfade ramp glyph. Live's UI font has no arrow
// glyphs, so they are drawn here. A click sends the direction index (0 High, 1 Mid, 2 Low) out of outlet 0 straight into the real
// `Insert` live.tab (which is off the face, automatable and linked); the live.tab echoes it back as set_dir.
//
// Messages in: set_dir <0..2>.  Outlet 0: the new direction index.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 1;

var FT_W = 160;
var FT_H = 15;
var FT_ORANGE = [1.0, 0.62, 0.20];
var FT_DIM = [0.58, 0.66, 0.74];
var ftDir = 0;
var FT_CELLS = [{ x: 4, w: 26 }, { x: 34, w: 26 }, { x: 64, w: 26 }];

function set_dir(v) {
    ftDir = Math.max(0, Math.min(2, Math.round(Number(v))));
    mgraphics.redraw();
}

function ftArrow(cx, cy, kind, col) {
    var half = 7;
    mgraphics.set_line_width(1.4);
    mgraphics.set_source_rgba(col[0], col[1], col[2], 1);
    mgraphics.move_to(cx - half, cy);
    mgraphics.line_to(cx + half, cy);
    mgraphics.stroke();
    if (kind === 0 || kind === 1) {
        mgraphics.move_to(cx - half + 3.5, cy - 3);
        mgraphics.line_to(cx - half, cy);
        mgraphics.line_to(cx - half + 3.5, cy + 3);
        mgraphics.stroke();
    }
    if (kind === 1 || kind === 2) {
        mgraphics.move_to(cx + half - 3.5, cy - 3);
        mgraphics.line_to(cx + half, cy);
        mgraphics.line_to(cx + half - 3.5, cy + 3);
        mgraphics.stroke();
    }
}

function paint() {
    mgraphics.set_source_rgba(0.045, 0.06, 0.08, 1);
    mgraphics.rectangle_rounded(0, 0, FT_W, FT_H, 4, 4);
    mgraphics.fill();
    for (var i = 0; i < 3; i++) {
        var c = FT_CELLS[i];
        var on = i === ftDir;
        if (on) {
            mgraphics.set_source_rgba(FT_ORANGE[0], FT_ORANGE[1], FT_ORANGE[2], 0.16);
            mgraphics.rectangle_rounded(c.x, 1.5, c.w, FT_H - 3, 3, 3);
            mgraphics.fill();
        }
        ftArrow(c.x + c.w * 0.5, FT_H * 0.5, i, on ? FT_ORANGE : FT_DIM);
    }
    // crossfade ramp glyph (a rising wedge)
    mgraphics.set_source_rgba(0.62, 0.68, 0.74, 1);
    mgraphics.move_to(130, FT_H - 3.5);
    mgraphics.line_to(152, FT_H - 3.5);
    mgraphics.line_to(152, 3.5);
    mgraphics.close_path();
    mgraphics.fill();
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
