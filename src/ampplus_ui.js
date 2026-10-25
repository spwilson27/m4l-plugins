// Amp head for Amp+. The tolex colours are the picture of the amp, not device chrome.
// Chrome (the jewel, the section behind the head) comes from the Live theme.
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var ampIndex = 0;
var modelState = 1;
var modelError = "";

var AMP_PANELS = [["obj-panel-amp", "live_desktop"], ["obj-panel-cab", "live_desktop"], ["obj-panel-body", "live_surface_bg"]];

// Illustration colours, one row per amp type. Not theme colours.
var TOLEX = [
    [0.62, 0.48, 0.28],
    [0.42, 0.14, 0.12],
    [0.14, 0.15, 0.18],
    [0.11, 0.11, 0.12],
    [0.52, 0.40, 0.26],
    [0.09, 0.09, 0.10],
    [0.12, 0.17, 0.28]
];
var GRILLE = [
    [0.30, 0.22, 0.13],
    [0.22, 0.08, 0.07],
    [0.32, 0.26, 0.16],
    [0.22, 0.16, 0.12],
    [0.24, 0.17, 0.12],
    [0.26, 0.07, 0.06],
    [0.08, 0.12, 0.20]
];

function inkFor(rgb) {
    var lum = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2];
    return lum > 0.45 ? [0.14, 0.10, 0.06, 1] : [0.94, 0.91, 0.84, 1];
}

function modelPath(file) {
    var path = file;
    try {
        var fp = this.patcher && this.patcher.filepath ? String(this.patcher.filepath) : "";
        var slash = fp.lastIndexOf("/");
        if (slash > 0) path = fp.substring(0, slash + 1) + file;
    } catch (err) {}
    return path;
}

function sendLoad(index) {
    var model = AMP_MODELS[index];
    if (!model) return;
    outlet(0, "load", modelPath(model.file));
}

function set_amp(v) {
    var n = Math.round(Number(v));
    if (!(n >= 0 && n < AMP_MODELS.length)) n = 0;
    ampIndex = n;
    modelState = 0;
    modelError = "";
    sendLoad(n);
    mgraphics.redraw();
}

function model_ok() {
    modelState = 1;
    modelError = "";
    mgraphics.redraw();
}

function model_err() {
    var parts = [];
    var i;
    for (i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
    modelError = parts.join(" ");
    modelState = 2;
    mgraphics.redraw();
}

function loadbang() {
    sptApplyPanelTheme(AMP_PANELS);
    sendLoad(ampIndex);
}

function onclick(x) {
    var w = mgraphics.size[0];
    var dir = x < w * 0.5 ? -1 : 1;
    outlet(1, ampStep(ampIndex, dir, AMP_MODELS.length));
}

function chevron(x, y, dir, col) {
    sptRgba(col);
    mgraphics.set_line_width(1.25);
    mgraphics.move_to(x + (dir < 0 ? 5 : 0), y - 3.5);
    mgraphics.line_to(x + (dir < 0 ? 0 : 5), y);
    mgraphics.line_to(x + (dir < 0 ? 5 : 0), y + 3.5);
    mgraphics.stroke();
}

function paint() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    var model = AMP_MODELS[ampIndex] || AMP_MODELS[0];
    var body = TOLEX[ampIndex] || TOLEX[0];
    var cloth = GRILLE[ampIndex] || GRILLE[0];
    var fg = inkFor(body);
    var x = 1;
    var y = 1;
    var bw = w - 2;
    var bh = h - 2;

    sptRgba(sptColor("live_desktop"));
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();

    mgraphics.set_source_rgba(body[0], body[1], body[2], 1);
    mgraphics.rectangle_rounded(x, y, bw, bh, 4, 4);
    mgraphics.fill();

    var gx = 8;
    var gy = 6;
    var gw = bw - 36;
    var gh = bh - 22;
    mgraphics.set_source_rgba(cloth[0], cloth[1], cloth[2], 1);
    mgraphics.rectangle_rounded(gx, gy, gw, gh, 2, 2);
    mgraphics.fill();

    mgraphics.set_source_rgba(fg[0], fg[1], fg[2], 0.22);
    mgraphics.set_line_width(1);
    var row;
    for (row = 1; row <= 5; row++) {
        var ly = gy + (gh * row) / 6;
        mgraphics.move_to(gx + 3, ly);
        mgraphics.line_to(gx + gw - 3, ly);
        mgraphics.stroke();
    }

    var px = gx + gw + 5;
    var jewel = sptColor("live_control_zombie");
    if (modelState === 1) jewel = sptColor("live_control_selection");
    if (modelState === 2) jewel = sptColor("live_alert");
    sptRgba(jewel);
    mgraphics.arc(px + 6, gy + 8, 3.2, 0, 6.283185307179586);
    mgraphics.fill();

    mgraphics.set_source_rgba(fg[0], fg[1], fg[2], 0.9);
    mgraphics.set_line_width(1);
    var knob;
    for (knob = 0; knob < 3; knob++) {
        mgraphics.arc(px + 6, gy + 20 + knob * 10, 2.4, 0, 6.283185307179586);
        mgraphics.stroke();
    }

    var nameY = y + bh - 5;
    var caption = modelState === 2 ? "not found" : model.capture;
    sptText(caption, w * 0.5, nameY, modelState === 2 ? sptColor("live_alert") : fg, 8, 1);
    chevron(7, nameY - 2, -1, fg);
    chevron(w - 12, nameY - 2, 1, fg);
}

sptApplyPanelTheme(AMP_PANELS);
var ampThemeTask = sptThemeWatch(function () { sptApplyPanelTheme(AMP_PANELS); });
