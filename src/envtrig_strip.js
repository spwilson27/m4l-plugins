// Envelope Trigger collapsible "MIDI To" strip (like Envelope Follower's "Audio Routing" strip).
// Draws a round arrow button and a vertical label. Clicking anywhere toggles the panel:
// outlet 0 sends the new state (0 = collapsed, 1 = open) to the hidden "MIDI To Panel" live.text,
// which resizes the device and shows/hides the panel widgets. `set_open` mirrors the saved state.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var LABEL = "MIDI TO";
var open = 0;
var lastWidth = -1;
// Scripting names of the panel widgets; build_envtrig.py prepends `var PANEL_NAMES = [...]`.
if (typeof PANEL_NAMES === "undefined") var PANEL_NAMES = /** @type {string[]} */ ([]);

function set_open(v) {
    open = Number(v) > 0.5 ? 1 : 0;
    mgraphics.redraw();
}

// Mirrors the `setwidth` value sent to live.thisdevice, for test_report.
function set_width(w) {
    lastWidth = Number(w);
}

function onclick() {
    outlet(0, open ? 0 : 1);
}

// ---------- Test hook (global `receive envtrig-test`) ----------
// Lets standalone Max and the Ableton MCP bridge drive the strip and read back the panel state:
//   test_click  — same as a mouse click on the strip
//   test_report — writes this instance's state to Global("envtrig_test") as `report_<device id>` and `last`

function test_click() {
    onclick();
}

function deviceId() {
    try {
        if (typeof LiveAPI !== "undefined") return String(new LiveAPI("this_device").id);
    } catch (err) {}
    return "0";
}

function test_report() {
    var p = this.patcher;
    var hidden = {};
    for (var i = 0; i < PANEL_NAMES.length; i++) {
        var obj = p ? p.getnamed(PANEL_NAMES[i]) : null;
        hidden[PANEL_NAMES[i]] = obj ? (obj.hidden ? 1 : 0) : -1;
    }
    var toggle = p ? p.getnamed("MIDI To Panel") : null;
    var report = {
        open: open,
        toggle: toggle ? Number(toggle.getvalueof()) : -1,
        width: lastWidth,
        hidden: hidden,
    };
    // Plain string properties survive across v8 contexts; nested objects may not.
    var g = new Global("envtrig_test");
    g["report_" + deviceId()] = JSON.stringify(report);
    g.last = JSON.stringify(report);
}

function paint() {
    var s = mgraphics.size;
    var w = (s && s.length > 1) ? s[0] : 16;
    var h = (s && s.length > 1) ? s[1] : 161;
    var cx = w / 2;
    var cy = 10;

    mgraphics.set_source_rgba(0.10, 0.11, 0.13, 1.0);
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();

    // Round button with an arrow: right when collapsed (panel opens to the right), left when open.
    mgraphics.set_source_rgba(open ? 0.96 : 0.82, open ? 0.66 : 0.86, open ? 0.25 : 0.90, 1.0);
    mgraphics.arc(cx, cy, 6, 0, Math.PI * 2);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.06, 0.07, 0.09, 1.0);
    var dir = open ? -1 : 1;
    mgraphics.move_to(cx - 2 * dir, cy - 3);
    mgraphics.line_to(cx + 2.5 * dir, cy);
    mgraphics.line_to(cx - 2 * dir, cy + 3);
    mgraphics.close_path();
    mgraphics.fill();

    // Vertical label reading bottom-to-top, anchored near the bottom like Live's native strips.
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(8.5);
    mgraphics.set_source_rgba(open ? 0.96 : 0.70, open ? 0.66 : 0.76, open ? 0.25 : 0.82, 1.0);
    mgraphics.save();
    mgraphics.translate(cx + 3, h - 6);
    mgraphics.rotate(-Math.PI / 2);
    mgraphics.move_to(0, 0);
    mgraphics.show_text(LABEL);
    mgraphics.restore();

    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.22, 0.26, 0.32, 1.0);
    mgraphics.rectangle(0.5, 0.5, w - 1, h - 1);
    mgraphics.stroke();
}
