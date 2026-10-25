// Amp+ faces, redesigned: Wave, Pulse, Tiles, Strip, Mono. AMP_ROLE is "hit"
// (the click target) or "bg" (the drawing). No amp pictures: every face is a
// level instrument built from the scope buffer the gen fills — slot 0 is the
// output envelope, slot 1 the instantaneous peak, slots 2..25 a 24-sample
// waveform ring (see src/ampplus_core.genexpr).
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

// The build prepends the real role. This keeps the file checkable on its own.
var AMP_ROLE = (typeof AMP_ROLE === "undefined") ? "bg" : AMP_ROLE;

var ampIndex = 0;
var lookIndex = 0;
var ampLookLock = -1;
var modelState = 1;
var modelError = "";
var cabOn = 1;
var cabKind = 1;
var micKind = 0;
var micPos = 0;
var scopeName = "";
var dispLevel = (typeof Task === "undefined") ? 0.62 : 0;
var ampPeak = 0;
var ampWave = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
var ampMeterTask = null;
var ampThemeTask = null;

var AMP_PANELS = [["obj-panel-amp", "live_desktop"], ["obj-panel-cab", "live_desktop"], ["obj-panel-body", "live_surface_bg"]];
var TAU = 6.283185307179586;
var AMP_CABS = ["1x12", "2x12", "4x10", "4x12", "1x15", "8x10"];

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
    if (ampLookLock >= 0) lookIndex = ampLookLock;
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
        var raw = buf.peek(1, 0, 26);
        if (raw && raw.length >= 26) {
            env = Number(raw[0]) || 0;
            var peak = ampLevelFromEnv(Number(raw[1]) || 0);
            ampPeak = Math.max(peak, ampPeak * 0.92);
            var i;
            for (i = 0; i < 24; i++) ampWave[i] = Number(raw[2 + i]) || 0;
        } else {
            env = (typeof raw === "number") ? raw : ((raw && raw.length) ? raw[0] : 0);
        }
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

function chevron(x, y, dir, col) {
    sptRgba(col);
    mgraphics.set_line_width(1.25);
    mgraphics.move_to(x + (dir < 0 ? 5 : 0), y - 3.5);
    mgraphics.line_to(x + (dir < 0 ? 0 : 5), y);
    mgraphics.line_to(x + (dir < 0 ? 5 : 0), y + 3.5);
    mgraphics.stroke();
}

function captureCaption() {
    var model = AMP_MODELS[ampIndex] || AMP_MODELS[0];
    return modelState === 2 ? "not found" : model.capture;
}

function captionColor() {
    return modelState === 2 ? sptColor("live_alert") : sptColor("live_control_fg");
}

// Green under half level, the selection colour to 80%, alert red above.
function levelColor(t) {
    if (t > 0.8) return sptColor("live_alert");
    if (t > 0.5) return sptColor("live_control_selection");
    return sptColor("live_display_line_two");
}

function waveY(v, cy, half) {
    var x = Number(v) || 0;
    if (x > 1.5) x = 1.5;
    if (x < -1.5) x = -1.5;
    return cy - (x / 1.5) * half;
}

function drawWaveTrace(r, dark) {
    fillBox(r[0], r[1], r[2], r[3], dark, 3);
    var fg = sptColor("live_control_fg");
    var cy = r[1] + r[3] * 0.5;
    var i;
    mgraphics.set_line_width(1);
    for (i = 1; i <= 3; i++) {
        var gy = r[1] + (r[3] * i) / 4;
        mgraphics.set_source_rgba(fg[0], fg[1], fg[2], i === 2 ? 0.38 : 0.20);
        mgraphics.move_to(r[0] + 4, gy);
        mgraphics.line_to(r[0] + r[2] - 4, gy);
        mgraphics.stroke();
    }
    var band = dispLevel * (r[3] * 0.5 - 4);
    var bc = levelColor(dispLevel);
    mgraphics.set_source_rgba(bc[0], bc[1], bc[2], 0.10);
    mgraphics.rectangle(r[0] + 4, cy - band, r[2] - 8, band * 2);
    mgraphics.fill();
    sptRgba(bc);
    mgraphics.set_line_width(1.6);
    for (i = 0; i < 24; i++) {
        var x = r[0] + 6 + (i * (r[2] - 12)) / 23;
        var y = waveY(ampWave[i], cy, r[3] * 0.5 - 5);
        if (i === 0) mgraphics.move_to(x, y);
        else mgraphics.line_to(x, y);
    }
    mgraphics.stroke();
}

function paintWave() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    fillBox(0, 0, w, h, sptColor("live_surface_bg"), 0);
    var r = ampLayout(lookIndex).boxes["obj-viz"].rect;
    drawWaveTrace(r, [0.03, 0.03, 0.04, 1]);
    sptText(captureCaption(), r[0] + 8, r[1] + 13, captionColor(), 8, 0);
    drawJewel(r[0] + r[2] - 12, r[1] + 10, 3.2);
    var fg = sptColor("live_control_fg");
    var midY = r[1] + r[3] * 0.5;
    chevron(r[0] + 6, midY, -1, fg);
    chevron(r[0] + r[2] - 16, midY, 1, fg);
    mgraphics.set_source_rgba(fg[0], fg[1], fg[2], 0.35);
    mgraphics.set_line_width(1);
    mgraphics.rectangle_rounded(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1, 3, 3);
    mgraphics.stroke();
}

function paintPulse() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    fillBox(0, 0, w, h, sptColor("live_surface_bg"), 0);
    fillBox(246, 0, w - 246, h, sptMix(sptColor("live_lcd_bg"), sptColor("live_surface_bg"), 0.45), 0);
    var r = ampLayout(lookIndex).boxes["obj-viz"].rect;
    var cx = r[0] + r[2] * 0.5;
    var cy = r[1] + r[3] * 0.5 - 8;
    var fg = sptColor("live_control_fg");
    var k;
    for (k = 0; k < 3; k++) {
        var ring = 30 + k * 20 + dispLevel * (3 + k * 2);
        mgraphics.set_source_rgba(fg[0], fg[1], fg[2], 0.22 - k * 0.05);
        mgraphics.set_line_width(1);
        mgraphics.arc(cx, cy, ring, 0, TAU);
        mgraphics.stroke();
    }
    var i;
    for (i = 0; i < 24; i++) {
        var a = (i / 24) * TAU;
        mgraphics.set_source_rgba(fg[0], fg[1], fg[2], 0.35);
        mgraphics.set_line_width(1.5);
        mgraphics.move_to(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20);
        mgraphics.line_to(cx + Math.cos(a) * 24, cy + Math.sin(a) * 24);
        mgraphics.stroke();
        var len = 14 + Math.abs(ampWave[i]) * 38 + dispLevel * 16;
        var col = levelColor(Math.abs(ampWave[i]) / 1.5);
        mgraphics.set_source_rgba(col[0], col[1], col[2], 0.35 + Math.abs(ampWave[i]) * 0.5);
        mgraphics.set_line_width(2.4);
        mgraphics.move_to(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26);
        mgraphics.line_to(cx + Math.cos(a) * (26 + len), cy + Math.sin(a) * (26 + len));
        mgraphics.stroke();
    }
    if (dispLevel > 0.01) {
        var lc = levelColor(dispLevel);
        mgraphics.set_source_rgba(lc[0], lc[1], lc[2], 0.85);
        mgraphics.set_line_width(3);
        mgraphics.arc(cx, cy, 68, -TAU * 0.25, -TAU * 0.25 + dispLevel * TAU * 0.75);
        mgraphics.stroke();
    }
    drawJewel(cx, cy, 4);
    sptText(captureCaption(), cx, r[1] + r[3] - 4, captionColor(), 8, 1);
}

function paintTiles() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    fillBox(0, 0, w, h, sptColor("live_surface_bg"), 0);
    var look = ampLayout(lookIndex);
    var keys = ["gain", "bass", "mid", "treble", "presence", "volume"];
    var glow = sptMix(sptColor("live_surface_bg"), sptColor("live_control_selection"), 0.05 + dispLevel * 0.10);
    var i;
    for (i = 0; i < keys.length; i++) {
        var d = look.boxes["obj-ctrl-" + keys[i]].rect;
        fillBox(d[0] - 3, d[1] - 3, d[2] + 6, d[3] + 6, glow, 5);
    }
    var cab = look.boxes["obj-ctrl-amp"].rect;
    fillBox(cab[0] - 4, cab[1] - 4, 158, 92, glow, 5);
    var r = look.boxes["obj-viz"].rect;
    drawWaveTrace(r, [0.03, 0.03, 0.04, 1]);
    drawJewel(r[0] + r[2] - 11, r[1] + 10, 3);
    var barW = (r[2] - 16) * dispLevel;
    var bc = levelColor(dispLevel);
    mgraphics.set_source_rgba(bc[0], bc[1], bc[2], 0.22);
    mgraphics.rectangle(r[0] + 8, r[1] + r[3] - 9, r[2] - 16, 3);
    mgraphics.fill();
    mgraphics.set_source_rgba(bc[0], bc[1], bc[2], 0.85);
    mgraphics.rectangle(r[0] + 8, r[1] + r[3] - 9, Math.max(0, barW), 3);
    mgraphics.fill();
    sptText(captureCaption(), r[0] + 8, r[1] + 13, captionColor(), 8, 0);
    var cabText = cabOn ? (AMP_CABS[cabKind] + "  ·  " + (micKind ? "Condenser" : "Dynamic") + "  ·  Pos " + Math.round(micPos) + "%") : "Cabinet off — direct";
    sptText(cabText, 8, 160, sptColor("live_control_fg"), 8, 0);
}

function paintStrip() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    fillBox(0, 0, w, h, sptColor("live_surface_bg"), 0);
    var r = ampLayout(lookIndex).boxes["obj-viz"].rect;
    fillBox(r[0], r[1], r[2], r[3], [0.03, 0.03, 0.04, 1], 3);
    var cy = r[1] + r[3] * 0.5;
    var fg0 = sptColor("live_control_fg");
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(fg0[0], fg0[1], fg0[2], 0.30);
    mgraphics.move_to(r[0] + 4, cy);
    mgraphics.line_to(r[0] + r[2] - 4, cy);
    mgraphics.stroke();
    mgraphics.set_source_rgba(fg0[0], fg0[1], fg0[2], 0.12);
    mgraphics.move_to(r[0] + 4, cy - r[3] * 0.25);
    mgraphics.line_to(r[0] + r[2] - 4, cy - r[3] * 0.25);
    mgraphics.stroke();
    mgraphics.move_to(r[0] + 4, cy + r[3] * 0.25);
    mgraphics.line_to(r[0] + r[2] - 4, cy + r[3] * 0.25);
    mgraphics.stroke();
    var i;
    for (i = 0; i < 60; i++) {
        var v = ampWave[i % 24];
        var x = r[0] + 5 + i * ((r[2] - 10) / 60);
        var col = levelColor(Math.abs(v) / 1.5);
        mgraphics.set_source_rgba(col[0], col[1], col[2], 0.75);
        var y = waveY(v, cy, r[3] * 0.5 - 4);
        if (Math.abs(y - cy) < 1) y = cy + (i % 2 ? 1 : -1);
        mgraphics.move_to(x, cy);
        mgraphics.line_to(x, y);
        mgraphics.set_line_width(2.4);
        mgraphics.stroke();
    }
    var fg = sptColor("live_control_fg");
    sptText("IN", r[0] + 6, r[1] + r[3] - 6, fg, 7, 0);
    sptText("TONE STACK", 84, r[1] + r[3] - 6, fg, 7, 0);
    sptText("OUT", r[0] + r[2] - 6, r[1] + r[3] - 6, fg, 7, 2);
    mgraphics.set_source_rgba(fg[0], fg[1], fg[2], 0.22);
    mgraphics.set_line_width(1);
    mgraphics.move_to(76, 54);
    mgraphics.line_to(76, 116);
    mgraphics.stroke();
    mgraphics.move_to(428, 54);
    mgraphics.line_to(428, 116);
    mgraphics.stroke();
    fillBox(8, 146, 480, 17, [0.03, 0.03, 0.04, 1], 3);
    var bc2 = levelColor(dispLevel);
    mgraphics.set_source_rgba(bc2[0], bc2[1], bc2[2], 0.9);
    mgraphics.rectangle(11, 149, Math.max(0, 474 * dispLevel), 11);
    mgraphics.fill();
    mgraphics.set_source_rgba(1, 1, 1, 0.35);
    mgraphics.set_line_width(1);
    for (i = 1; i < 4; i++) {
        var tx = 11 + (474 * i) / 4;
        mgraphics.move_to(tx, 149);
        mgraphics.line_to(tx, 160);
        mgraphics.stroke();
    }
    mgraphics.set_source_rgba(1, 1, 1, 0.85);
    mgraphics.rectangle(11 + 474 * ampPeak, 148, 1.6, 13);
    mgraphics.fill();
}

function paintMono() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    fillBox(0, 0, w, h, sptColor("live_surface_bg"), 0);
    var look = ampLayout(lookIndex);
    var fg = sptColor("live_control_fg");
    var r = look.boxes["obj-viz"].rect;
    var cx = r[0] + r[2] * 0.5;
    var cy = r[1] + 44;
    mgraphics.set_source_rgba(fg[0], fg[1], fg[2], 0.3);
    mgraphics.set_line_width(1);
    mgraphics.arc(cx, cy, 40, 0, TAU);
    mgraphics.stroke();
    var col = levelColor(dispLevel);
    var ti;
    mgraphics.set_line_width(2);
    for (ti = 0; ti < 12; ti++) {
        var ta = (ti / 12) * TAU;
        mgraphics.set_source_rgba(fg[0], fg[1], fg[2], 0.45);
        mgraphics.move_to(cx + Math.cos(ta) * 35, cy + Math.sin(ta) * 35);
        mgraphics.line_to(cx + Math.cos(ta) * 38, cy + Math.sin(ta) * 38);
        mgraphics.stroke();
    }
    mgraphics.set_source_rgba(col[0], col[1], col[2], 0.20);
    mgraphics.set_line_width(7);
    mgraphics.arc(cx, cy, 29, 0, TAU);
    mgraphics.stroke();
    if (dispLevel > 0.01) {
        mgraphics.set_source_rgba(col[0], col[1], col[2], 0.9);
        mgraphics.set_line_width(7);
        mgraphics.arc(cx, cy, 29, -TAU * 0.25, -TAU * 0.25 + dispLevel * TAU * 0.75);
        mgraphics.stroke();
    }
    mgraphics.set_source_rgba(col[0], col[1], col[2], 0.9);
    mgraphics.arc(cx, cy, 5, 0, TAU);
    mgraphics.fill();
    drawJewel(cx, cy, 2.6);
    sptText(captureCaption(), cx, r[1] + r[3] - 4, captionColor(), 9, 1);
    sptText("GAIN", look.boxes["obj-ctrl-gain"].rect[0] + 39, 100, fg, 8, 1);
    sptText("VOLUME", look.boxes["obj-ctrl-volume"].rect[0] + 39, 100, fg, 8, 1);
    var names = ["BASS", "MID", "TREBLE", "PRESENCE"];
    var keys = ["bass", "mid", "treble", "presence"];
    var i;
    for (i = 0; i < keys.length; i++) {
        var d = look.boxes["obj-ctrl-" + keys[i]].rect;
        sptText(names[i], d[0] + d[2] * 0.5, d[1] - 4, fg, 7, 1);
    }
    sptText(Math.round(dispLevel * 100) + "%", 488, 148, col, 20, 2);
    sptText("LEVEL", 488, 160, fg, 7, 2);
}

function paint() {
    if (AMP_ROLE !== "bg") return;
    var look = ampLayout(lookIndex);
    if (look.name === "Wave") paintWave();
    else if (look.name === "Pulse") paintPulse();
    else if (look.name === "Tiles") paintTiles();
    else if (look.name === "Strip") paintStrip();
    else paintMono();
}

if (AMP_ROLE === "bg") {
    sptApplyPanelTheme(AMP_PANELS);
    ampThemeTask = sptThemeWatch(function () { sptApplyPanelTheme(AMP_PANELS); });
}
