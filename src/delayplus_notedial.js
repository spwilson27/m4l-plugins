// Delay+ MIDI-mode note display: drawn like a disabled live.dial (greyed arc + value), in place of
// one side's Note dial while that side's Time Mode is MIDI. Display only: the note comes from the
// MIDI input (`midi_note <n>`, note-ons), so there is nothing to adjust by hand. It is not a Live
// parameter, so incoming notes never write automation or undo steps.
// Inputs: midi_note <n>, set_cents_<side> <ct> (the side's fine tune, shown with the note).

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var ndNote = -1; // no note received yet
var ndCents = 0;
var ndThemeTask = dpThemeWatch();

function midi_note(n) {
    ndNote = dpClamp(Math.round(Number(n) || 0), 0, 127);
    mgraphics.redraw();
}

function anything() {
    if (messagename.indexOf("set_cents_") === 0) {
        ndCents = Math.round(Number(arguments[0]) || 0);
        mgraphics.redraw();
    }
}

function paint() {
    var mg = mgraphics, w = mg.size[0];
    // Same geometry as a 44 x 38 live.dial with its name hidden: arc on top, value under it.
    var cx = w / 2, cy = 14, r = 11.5;
    var a0 = Math.PI * 0.75, span = Math.PI * 1.5;
    var fg = dpTheme("live_control_fg", [0.75, 0.75, 0.75, 1]);
    mg.set_line_width(2);
    mg.set_source_rgba(fg[0], fg[1], fg[2], 0.18);
    mg.arc(cx, cy, r, a0, a0 + span);
    mg.stroke();
    if (ndNote >= 0) {
        mg.set_source_rgba(fg[0], fg[1], fg[2], 0.45);
        mg.arc(cx, cy, r, a0, a0 + span * ndNote / 127);
        mg.stroke();
        var na = a0 + span * ndNote / 127;
        mg.move_to(cx + Math.cos(na) * (r - 4), cy + Math.sin(na) * (r - 4));
        mg.line_to(cx + Math.cos(na) * (r + 1), cy + Math.sin(na) * (r + 1));
        mg.stroke();
    }
    var txt;
    if (ndNote >= 0) {
        txt = dpNoteName(ndNote);
        if (ndCents) txt += (ndCents > 0 ? " +" : " ") + ndCents;
    } else {
        txt = "MIDI";
    }
    mg.select_font_face("Arial");
    mg.set_font_size(9.5);
    mg.set_source_rgba(fg[0], fg[1], fg[2], 0.5);
    var tw = mg.text_measure(txt)[0];
    mg.move_to(cx - tw / 2, 34);
    mg.show_text(txt);
}

function onclick() {}
function ondrag() {}

// scripts/render_preview.py: a note has arrived.
function preview() { ndNote = 57; }
