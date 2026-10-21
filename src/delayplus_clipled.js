// Delay+ clip LED: a small red dot after the page tabs (top right of the display) that lights while
// the Feedback Clip reduces the loop (scope CLIP_DB), held about 1 s and then fading (dpClipStep).
// Fixed red, not a theme colour: some themes map Live's alert / selection colours to yellow.
// Display only; it reads the Start's telemetry itself. Inputs: `names <xfer> <hdr> <scope> ...`.

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var LED_RED = [0.93, 0.2, 0.17, 1];
var ledScopeName = "", ledScope = null, ledTask = null;
var ledState = { hold: 0, db: 0 };
var ledLvl = 0;
var ledThemeTask = dpThemeWatch();

function anything() {
    if (messagename === "names") {
        ledScopeName = arguments.length > 2 ? String(arguments[2]) : "";
        ledScope = null;
        if (!ledTask) {
            try {
                ledTask = new Task(ledFrame, this);
                ledTask.interval = 33;
                ledTask.repeat();
            } catch (e) { ledTask = null; }
        }
    }
}

function ledFrame() {
    if (!ledScope && ledScopeName) {
        try { ledScope = new Buffer(ledScopeName); } catch (e) { ledScope = null; }
    }
    if (!ledScope) return;
    var v = null;
    try { v = ledScope.peek(1, DP_SCOPE.CLIP_DB, 1); } catch (e2) { v = null; }
    // peek of one sample returns a plain number in v8, an array elsewhere
    var db = Number(v && typeof v === "object" ? v[0] : v) || 0;
    var was = ledLvl;
    ledLvl = dpClipStep(ledState, db, db < -0.1 ? 1 : 0);
    if (ledLvl !== was) mgraphics.redraw();
}

function paint() {
    var mg = mgraphics, w = mg.size[0], h = mg.size[1];
    var r = Math.min(w, h) / 2 - 1;
    mg.ellipse(w / 2 - r, h / 2 - r, 2 * r, 2 * r);
    if (ledLvl > 0) {
        mg.set_source_rgba(LED_RED[0], LED_RED[1], LED_RED[2], 0.25 + 0.75 * ledLvl);
        mg.fill();
    } else {
        // unlit: a faint ring in the display's scale colour, so the LED's place is visible
        var off = dpTheme("live_display_scale_text", [0.6, 0.6, 0.6, 1]);
        mg.set_source_rgba(off[0], off[1], off[2], 0.35);
        mg.set_line_width(1);
        mg.stroke();
    }
}

function onclick() {}

// scripts/render_preview.py: lit
function preview() { ledLvl = 1; }
