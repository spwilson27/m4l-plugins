// Amp+ faces. AMP_ROLE is "hit" (the click target) or "bg" (the drawing).
// The tolex, cloth, cones and lamps are the picture of the amp. Chrome comes from the Live theme.
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

// The build prepends the real role. This keeps the file checkable on its own.
var AMP_ROLE = (typeof AMP_ROLE === "undefined") ? "bg" : AMP_ROLE;

var ampIndex = 0;
var lookIndex = 0;
var modelState = 1;
var modelError = "";
var cabOn = 1;
var cabKind = 1;
var micKind = 0;
var micPos = 0;
var scopeName = "";
var dispLevel = (typeof Task === "undefined") ? 0.62 : 0;
var ampMeterTask = null;
var ampThemeTask = null;

var AMP_PANELS = [["obj-panel-amp", "live_desktop"], ["obj-panel-cab", "live_desktop"], ["obj-panel-body", "live_surface_bg"]];
var TAU = 6.283185307179586;

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

function ampHost() {
    return (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
}

function modelPath(file) {
    var path = file;
    try {
        var host = ampHost();
        var fp = host && host.filepath ? String(host.filepath) : "";
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

function clampIndex(v, n) {
    var i = Math.round(Number(v));
    if (!(i >= 0 && i < n)) i = 0;
    return i;
}

function set_amp(v) {
    ampIndex = clampIndex(v, AMP_MODELS.length);
    modelState = 0;
    modelError = "";
    if (AMP_ROLE === "hit") sendLoad(ampIndex);
    mgraphics.redraw();
}

function set_look(v) {
    lookIndex = clampIndex(v, ampAllLooks().length);
    if (AMP_ROLE === "bg") applyLook(lookIndex);
    mgraphics.redraw();
}

function set_cab(v) { cabOn = Number(v) > 0.5 ? 1 : 0; mgraphics.redraw(); }
function set_cabtype(v) { cabKind = clampIndex(v, 6); mgraphics.redraw(); }
function set_mic(v) { micKind = Number(v) > 0.5 ? 1 : 0; mgraphics.redraw(); }
function set_position(v) {
    var n = Number(v);
    micPos = n >= 0 && n <= 100 ? n : 0;
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

function set_scope(name) {
    scopeName = String(name);
}

function pullMeter() {
    if (!scopeName || typeof Buffer === "undefined") return;
    var env = 0;
    try {
        var buf = new Buffer(scopeName);
        var raw = buf.peek(1, 0, 1);
        env = (typeof raw === "number") ? raw : ((raw && raw.length) ? raw[0] : 0);
    } catch (err) { return; }
    var target = ampLevelFromEnv(env);
    var next = dispLevel + (target - dispLevel) * 0.45;
    if (Math.abs(next - dispLevel) < 0.003 && Math.abs(target - next) < 0.003) return;
    dispLevel = next;
    mgraphics.redraw();
}

function applyLook(index) {
    var host = ampHost();
    if (!host || !host.getnamed) return;
    var look = ampLayout(index);
    var id;
    for (id in look.boxes) {
        if (!Object.prototype.hasOwnProperty.call(look.boxes, id)) continue;
        var spec = look.boxes[id];
        var o = host.getnamed(id);
        if (!o || !o.setattr) continue;
        var r = spec.rect;
        o.setattr("presentation_rect", r[0], r[1], r[2], r[3]);
        o.setattr("hidden", spec.hidden ? 1 : 0);
    }
    var keys = ["gain", "bass", "mid", "treble", "presence", "volume"];
    var i;
    for (i = 0; i < keys.length; i++) {
        var dial = host.getnamed("obj-ctrl-" + keys[i]);
        if (dial && dial.setattr) {
            dial.setattr("showname", look.dialName ? 1 : 0);
            dial.setattr("shownumber", 1);
        }
    }
}

function loadbang() {
    if (AMP_ROLE === "hit") {
        sendLoad(ampIndex);
        return;
    }
    sptApplyPanelTheme(AMP_PANELS);
    applyLook(lookIndex);
    if (typeof Task !== "undefined") {
        ampMeterTask = new Task(pullMeter);
        ampMeterTask.interval = 33;
        ampMeterTask.repeat();
    }
}

function onclick(x) {
    if (AMP_ROLE !== "hit") return;
    var w = mgraphics.size[0];
    var dir = x < w * 0.5 ? -1 : 1;
    outlet(1, ampStep(ampIndex, dir, AMP_MODELS.length));
}

function fillBox(x, y, w, h, col, rad) {
    sptRgba(col);
    if (rad) mgraphics.rectangle_rounded(x, y, w, h, rad, rad);
    else mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
}

function jewelColor() {
    if (modelState === 2) return sptColor("live_alert");
    if (modelState === 1) return sptColor("live_control_selection");
    return sptColor("live_control_zombie");
}

function drawJewel(x, y, r) {
    var col = jewelColor();
    var glow = 0.25 + dispLevel * 0.75;
    mgraphics.set_source_rgba(col[0], col[1], col[2], 0.28 * glow);
    mgraphics.arc(x, y, r + 3 + dispLevel * 2, 0, TAU);
    mgraphics.fill();
    sptRgba(col);
    mgraphics.arc(x, y, r, 0, TAU);
    mgraphics.fill();
}

function drawHead(x, y, w, h) {
    var body = TOLEX[ampIndex] || TOLEX[0];
    var cloth = GRILLE[ampIndex] || GRILLE[0];
    var fg = inkFor(body);
    var model = AMP_MODELS[ampIndex] || AMP_MODELS[0];
    fillBox(x, y, w, h, body, 4);
    var gw = w - 40;
    var gh = h - 22;
    var clothCol = sptMix(cloth, [1, 0.92, 0.7, 1], dispLevel * 0.28);
    fillBox(x + 7, y + 6, gw, gh, clothCol, 2);
    mgraphics.set_source_rgba(fg[0], fg[1], fg[2], 0.18 + dispLevel * 0.45);
    mgraphics.set_line_width(1);
    var row;
    for (row = 1; row <= 5; row++) {
        var ly = y + 6 + (gh * row) / 6 + Math.sin(row + dispLevel * 6) * dispLevel * 1.4;
        mgraphics.move_to(x + 11, ly);
        mgraphics.line_to(x + 7 + gw - 4, ly);
        mgraphics.stroke();
    }
    var px = x + w - 22;
    drawJewel(px, y + 14, 3.2);
    if (h >= 56) {
        mgraphics.set_source_rgba(fg[0], fg[1], fg[2], 0.9);
        var knob;
        for (knob = 0; knob < 3; knob++) {
            mgraphics.arc(px, y + 26 + knob * 10, 2.3, 0, TAU);
            mgraphics.stroke();
        }
    }
    var caption = modelState === 2 ? "not found" : model.capture;
    sptText(caption, x + w * 0.42, y + h - 5, modelState === 2 ? sptColor("live_alert") : fg, 8, 1);
    chevron(x + 6, y + h - 8, -1, fg);
    chevron(x + w - 16, y + h - 8, 1, fg);
}

function chevron(x, y, dir, col) {
    sptRgba(col);
    mgraphics.set_line_width(1.25);
    mgraphics.move_to(x + (dir < 0 ? 5 : 0), y - 3.5);
    mgraphics.line_to(x + (dir < 0 ? 0 : 5), y);
    mgraphics.line_to(x + (dir < 0 ? 5 : 0), y + 3.5);
    mgraphics.stroke();
}

function speakerCount() {
    var n = [1, 2, 4, 4, 1, 8];
    return n[cabKind] || 1;
}

function drawCone(cx, cy, r, cloth) {
    var push = 1 + dispLevel * 0.22;
    mgraphics.set_source_rgba(0.04, 0.04, 0.05, 1);
    mgraphics.arc(cx, cy, r, 0, TAU);
    mgraphics.fill();
    var rim = sptMix(cloth, [0.05, 0.04, 0.03, 1], 0.35);
    sptRgba(rim);
    mgraphics.arc(cx, cy, r * 0.86, 0, TAU);
    mgraphics.fill();
    var cone = sptMix(cloth, [1, 0.85, 0.55, 1], 0.15 + dispLevel * 0.4);
    sptRgba(cone);
    mgraphics.arc(cx, cy, r * 0.62 * push, 0, TAU);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.08, 0.07, 0.06, 1);
    mgraphics.arc(cx, cy, Math.max(1.5, r * 0.16), 0, TAU);
    mgraphics.fill();
}

function drawSpeakers(x, y, w, h, cloth) {
    var n = cabOn ? speakerCount() : 0;
    if (!n) {
        sptText("direct", x + w * 0.5, y + h * 0.55, sptColor("live_control_fg"), 9, 1);
        return;
    }
    var cols = n >= 8 ? 4 : (n > 2 ? 2 : n);
    var rows = Math.ceil(n / cols);
    var i;
    for (i = 0; i < n; i++) {
        var c = i % cols;
        var r = Math.floor(i / cols);
        var cx = x + (c + 0.5) * w / cols;
        var cy = y + (r + 0.5) * h / rows;
        var rad = Math.min(w / cols, h / rows) * 0.38;
        drawCone(cx, cy, rad, cloth);
    }
}

function drawMic(cx, cy, reach) {
    var t = micPos / 100;
    var mx = cx + (t - 0.5) * reach;
    var my = cy - reach * 0.55;
    var col = sptColor("live_control_fg");
    sptRgba(col);
    mgraphics.set_line_width(1.25);
    mgraphics.move_to(mx, my + 8);
    mgraphics.line_to(cx + (mx - cx) * 0.3, cy - 4);
    mgraphics.stroke();
    if (micKind) {
        fillBox(mx - 3, my - 10, 6, 14, col, 1);
    } else {
        mgraphics.arc(mx, my - 2, 5, 0, TAU);
        mgraphics.fill();
    }
}

function screw(x, y) {
    var col = sptColor("live_control_fg");
    mgraphics.set_source_rgba(col[0], col[1], col[2], 0.55);
    mgraphics.arc(x, y, 2.2, 0, TAU);
    mgraphics.fill();
    mgraphics.set_source_rgba(0, 0, 0, 0.45);
    mgraphics.set_line_width(1);
    mgraphics.move_to(x - 1.4, y);
    mgraphics.line_to(x + 1.4, y);
    mgraphics.stroke();
}

function paintHeadLook() {
    var r = ampLayout(lookIndex).boxes["obj-viz"].rect;
    drawHead(r[0], r[1], r[2], r[3]);
}

function paintStack() {
    var r = ampLayout(lookIndex).boxes["obj-viz"].rect;
    var body = TOLEX[ampIndex] || TOLEX[0];
    var cloth = GRILLE[ampIndex] || GRILLE[0];
    var x = r[0];
    var y = r[1];
    var w = r[2];
    var headH = 36;
    drawHead(x, y, w, headH);
    fillBox(x, y + headH - 2, w, r[3] - headH + 2, sptMix(body, [0, 0, 0, 1], 0.25), 3);
    drawSpeakers(x + 8, y + headH + 6, w - 16, r[3] - headH - 12, cloth);
}

function paintPlate() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    var body = TOLEX[ampIndex] || TOLEX[0];
    var fg = inkFor(body);
    fillBox(0, 0, w, h, sptColor("live_surface_bg"), 0);
    fillBox(4, 4, w - 8, h - 8, body, 5);
    screw(12, 12);
    screw(w - 12, 12);
    screw(12, h - 12);
    screw(w - 12, h - 12);
    var meter = ampLayout(lookIndex).boxes["obj-viz"].rect;
    fillBox(meter[0], meter[1], meter[2], meter[3], [0.05, 0.04, 0.03, 1], 3);
    var cx = meter[0] + meter[2] * 0.5;
    var cy = meter[1] + meter[3] - 16;
    var reach = meter[3] - 26;
    var tick;
    mgraphics.set_line_width(1);
    for (tick = 0; tick <= 8; tick++) {
        var ta = -0.95 + tick * (1.9 / 8);
        var inner = reach - 6;
        mgraphics.set_source_rgba(fg[0], fg[1], fg[2], tick === 0 || tick === 8 ? 0.7 : 0.35);
        mgraphics.move_to(cx + Math.sin(ta) * inner, cy - Math.cos(ta) * inner);
        mgraphics.line_to(cx + Math.sin(ta) * reach, cy - Math.cos(ta) * reach);
        mgraphics.stroke();
    }
    var ang = -0.9 + dispLevel * 1.8;
    var nx = cx + Math.sin(ang) * (reach - 2);
    var ny = cy - Math.cos(ang) * (reach - 2);
    var lamp = jewelColor();
    mgraphics.set_source_rgba(lamp[0], lamp[1], lamp[2], 0.95);
    mgraphics.set_line_width(1.6);
    mgraphics.move_to(cx, cy);
    mgraphics.line_to(nx, ny);
    mgraphics.stroke();
    mgraphics.arc(cx, cy, 2.2, 0, TAU);
    mgraphics.fill();
    drawJewel(meter[0] + 16, meter[1] + meter[3] * 0.5, 3.2);
    var model = AMP_MODELS[ampIndex] || AMP_MODELS[0];
    var caption = modelState === 2 ? "not found" : model.capture;
    sptText(caption, meter[0] + meter[2] - 10, meter[1] + 12, [0.93, 0.9, 0.84, 0.92], 8, 2);
}

function paintCombo() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    var body = TOLEX[ampIndex] || TOLEX[0];
    var cloth = GRILLE[ampIndex] || GRILLE[0];
    var fg = inkFor(body);
    fillBox(0, 0, w, h, sptColor("live_surface_bg"), 0);
    var r = ampLayout(lookIndex).boxes["obj-viz"].rect;
    fillBox(r[0] - 8, r[1] - 2, r[2] + 16, r[3] + 8, body, 6);
    var n = cabOn ? Math.min(speakerCount(), 4) : 0;
    if (!n) {
        sptText("direct", r[0] + r[2] * 0.5, r[1] + r[3] * 0.5, fg, 10, 1);
    } else if (n === 1) {
        drawCone(r[0] + r[2] * 0.5, r[1] + r[3] * 0.48, Math.min(r[2], r[3]) * 0.36, cloth);
        drawMic(r[0] + r[2] * 0.5, r[1] + r[3] * 0.48, Math.min(r[2], r[3]) * 0.42);
    } else {
        drawSpeakers(r[0] + 10, r[1] + 8, r[2] - 20, r[3] - 16, cloth);
    }
    var names = ["Gain", "Bass", "Mid", "Treb", "Pres", "Vol"];
    var keys = ["gain", "bass", "mid", "treble", "presence", "volume"];
    var i;
    for (i = 0; i < keys.length; i++) {
        var d = ampLayout(lookIndex).boxes["obj-ctrl-" + keys[i]].rect;
        var lx = i < 3 ? d[0] + d[2] + 6 : d[0] - 4;
        var align = i < 3 ? 0 : 2;
        sptText(names[i], lx, d[1] + 16, sptColor("live_control_fg"), 8, align);
    }
    drawJewel(r[0] + r[2] - 16, r[1] + 12, 3);
}

function paintRack() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    var metal = sptMix(sptColor("live_lcd_bg"), sptColor("live_control_bg"), 0.35);
    fillBox(0, 0, w, h, metal, 0);
    screw(10, 34);
    screw(w - 10, 34);
    screw(10, h - 10);
    screw(w - 10, h - 10);
    var meter = ampLayout(lookIndex).boxes["obj-viz"].rect;
    fillBox(meter[0], meter[1], meter[2], meter[3], [0.02, 0.02, 0.025, 1], 2);
    var model = AMP_MODELS[ampIndex] || AMP_MODELS[0];
    var caption = modelState === 2 ? "not found" : model.capture;
    sptText("AMP+", meter[0] + 8, meter[1] + 16, sptColor("live_lcd_title"), 9, 0);
    sptText(caption, meter[0] + meter[2] - 8, meter[1] + 16, modelState === 2 ? sptColor("live_alert") : sptColor("live_control_fg"), 8, 2);
    var n = 16;
    var i;
    var lit = dispLevel * n;
    var ledLeft = meter[0] + 56;
    var ledRight = meter[0] + meter[2] - 96;
    for (i = 0; i < n; i++) {
        var x = ledLeft + i * ((ledRight - ledLeft) / n);
        var on = i < lit;
        var hot = i / n;
        var col = hot > 0.8 ? sptColor("live_alert") : (hot > 0.55 ? sptColor("live_control_selection") : sptColor("live_display_line_two"));
        mgraphics.set_source_rgba(col[0], col[1], col[2], on ? 0.95 : 0.16);
        mgraphics.rectangle_rounded(x, meter[1] + 5, 12, meter[3] - 10, 1, 1);
        mgraphics.fill();
    }
}

function paint() {
    if (AMP_ROLE !== "bg") return;
    var look = ampLayout(lookIndex);
    if (look.name === "Head") paintHeadLook();
    else if (look.name === "Stack") paintStack();
    else if (look.name === "Plate") paintPlate();
    else if (look.name === "Combo") paintCombo();
    else paintRack();
}

if (AMP_ROLE === "bg") {
    sptApplyPanelTheme(AMP_PANELS);
    ampThemeTask = sptThemeWatch(function () { sptApplyPanelTheme(AMP_PANELS); });
}
