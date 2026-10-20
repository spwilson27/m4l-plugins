// Lifter — v8ui: lifter curve editor over a live cepstrum display.
// One script serves all three layouts (A canvas, B strip, C perform pad). The layout
// comes from a `layout a|b|c` message at loadbang; without it the canvas size decides.
//
// Axis: log quefrency, 0.2 ms .. 40 ms (x = 0..1). Curve: gain in dB (-24..+24) applied
// to the cepstral coefficients, drawn as breakpoints with smoothstep segments.
// Telemetry: buffer~ #0-lifterscope (see src/lifter_core.genexpr) is read at 30 Hz;
// the curve is written to buffer~ #0-liftercurve (256 dB samples) on every change.
// State: blob parameter via getvalueof / setvalueof (version 2: [2, bellWidth, n, x0, y0, ...],
// version 1 [1, n, x0, y0, ...] still loads).

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var TLO_MS = 0.2;
var THI_MS = 40.0;
var LOGSPAN = Math.log(THI_MS / TLO_MS);
var MARK_MS = 5.0;
var XM = Math.log(MARK_MS / TLO_MS) / LOGSPAN;
var DB_RANGE = 24;
var CURVE_N = 256;
var MAX_KNOTS = 24;
var MIN_GAP = 0.008;
var COLS = 128;
var SPEC_COLS = 64;
var GRAM_COLS = 64;
var GRAM_ROWS = 22;
var MAX_UNDO = 50;
var TOOL_W = 22;
var STATE_VERSION = 2;

var PRESETS = {
    flat: [[0, 0], [1, 0]],
    whisper: [[0, 0], [0.36, 0], [0.44, -24], [0.88, -24], [0.96, 0], [1, 0]],
    robot: [[0, 0], [0.46, 0], [0.55, 18], [0.67, 18], [0.77, 0], [1, 0]],
    body: [[0, 0], [0.34, 0], [0.42, -24], [1, -24]],
    comb: [[0, 0], [0.30, -9], [0.40, 9], [0.50, -9], [0.60, 9], [0.70, -9], [0.80, 9], [0.90, -9], [1, 0]]
};
var TOOLS = ["undo", "redo", "flat", "whisper", "robot", "body", "comb"];
var TOOL_TITLES = {
    undo: "Undo",
    redo: "Redo",
    flat: "Flat (no change)",
    whisper: "Whisper (cut the pitch region)",
    robot: "Robot (boost the pitch peak)",
    body: "Body (keep the envelope only)",
    comb: "Comb (alternating boosts and cuts)"
};

var C_BG = [0.036, 0.044, 0.058, 1];
var C_PLOT = [0.050, 0.060, 0.078, 1];
var C_EDGE = [0.18, 0.22, 0.30, 1];
var C_GRID = [0.20, 0.25, 0.33];
var C_CURVE = [0.98, 0.74, 0.30];
var C_IN = [0.30, 0.80, 0.96];
var C_OUT = [0.80, 0.58, 0.98];
var C_PITCH = [0.40, 0.92, 0.72];
var C_TXT = [0.70, 0.76, 0.84];

// ---------------------------------------------------------------- state
var knots = clonePreset("whisper");
var undoStack = [];
var redoStack = [];
var bellW = 0.12;
var macro = null;
var mode = null;

var depthPct = 100;
var smoothPct = 20;
var mixPct = 100;
var outDb = 0;
var sizeIdx = 1;
var trackUI = 0;

var scopeBuf = null;
var curveBuf = null;
var scopeTask = null;

var demo = true;
var cepIn = [];
var cepOut = [];
var specIn = [];
var specOut = [];
var gram = [];
var pitchQ = 0;
var pitchConf = 0;
var pitchSr = 44100;
var trackLive = 0;
var qUsed = 0;
var pkIn = 0;
var pkOut = 0;
var lastHop = -1;
var settled = false;

var dragIdx = -1;
var dragKind = "";
var dragPushed = false;
var hoverKnot = -1;
var hoverTool = -1;
var lastUndoTime = 0;

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function clonePreset(name) {
    var src = PRESETS[name] || PRESETS.flat;
    var out = [];
    for (var i = 0; i < src.length; i++) out.push([src[i][0], src[i][1]]);
    return out;
}

function cloneKnots(k) {
    var out = [];
    for (var i = 0; i < k.length; i++) out.push([k[i][0], k[i][1]]);
    return out;
}

// ---------------------------------------------------------------- curve maths
function curveAt(x) {
    var n = knots.length;
    if (n === 0) return 0;
    if (x <= knots[0][0]) return knots[0][1];
    if (x >= knots[n - 1][0]) return knots[n - 1][1];
    for (var i = 0; i < n - 1; i++) {
        if (x < knots[i + 1][0]) {
            var x0 = knots[i][0];
            var x1 = knots[i + 1][0];
            var t = (x - x0) / Math.max(1e-6, x1 - x0);
            var s = t * t * (3 - 2 * t);
            return knots[i][1] + (knots[i + 1][1] - knots[i][1]) * s;
        }
    }
    return knots[n - 1][1];
}

function curveTable() {
    var out = [];
    for (var i = 0; i < CURVE_N; i++) out.push(clamp(curveAt(i / (CURVE_N - 1)), -DB_RANGE, DB_RANGE));
    return out;
}

function writeCurve() {
    if (!curveBuf) return;
    try {
        curveBuf.poke(1, 0, curveTable());
    } catch (err) {}
}

function timeToX(ms) {
    return Math.log(ms / TLO_MS) / LOGSPAN;
}

function xToMs(x) {
    return TLO_MS * Math.exp(x * LOGSPAN);
}

function sanitizeKnots(list) {
    var out = [];
    for (var i = 0; i < list.length && out.length < MAX_KNOTS; i++) {
        var px = Number(list[i][0]);
        var py = Number(list[i][1]);
        if (!(px === px) || !(py === py)) continue;
        out.push([clamp(px, 0, 1), clamp(py, -DB_RANGE, DB_RANGE)]);
    }
    out.sort(function (a, b) { return a[0] - b[0]; });
    for (var j = 1; j < out.length; j++) {
        if (out[j][0] < out[j - 1][0] + 0.002) out[j][0] = Math.min(1, out[j - 1][0] + 0.002);
    }
    if (out.length < 2) return clonePreset("flat");
    return out;
}

function sameKnots(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
        if (Math.abs(a[i][0] - b[i][0]) > 0.004 || Math.abs(a[i][1] - b[i][1]) > 0.05) return false;
    }
    return true;
}

function activePreset() {
    var names = ["flat", "whisper", "robot", "body", "comb"];
    for (var i = 0; i < names.length; i++) {
        if (sameKnots(knots, PRESETS[names[i]])) return names[i];
    }
    return "";
}

// ---------------------------------------------------------------- undo
function snapshot() {
    return { knots: cloneKnots(knots), bellW: bellW, macro: macro ? { c: macro.c, db: macro.db } : null };
}

function pushUndoState() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    lastUndoTime = Date.now();
}

function applySnapshot(s) {
    knots = cloneKnots(s.knots);
    bellW = s.bellW;
    macro = s.macro ? { c: s.macro.c, db: s.macro.db } : null;
    writeCurve();
    notifyclients();
    mgraphics.redraw();
}

function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    applySnapshot(undoStack.pop());
}

function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    applySnapshot(redoStack.pop());
}

function applyPreset(name) {
    pushUndoState();
    knots = clonePreset(name);
    macro = null;
    writeCurve();
    notifyclients();
    mgraphics.redraw();
}

// ---------------------------------------------------------------- state save / load
function getvalueof() {
    var out = [STATE_VERSION, bellW, knots.length];
    for (var i = 0; i < knots.length; i++) {
        out.push(knots[i][0]);
        out.push(knots[i][1]);
    }
    return out;
}

function setvalueof() {
    var args = Array.prototype.slice.call(arguments);
    if (args.length === 1 && args[0] && typeof args[0] === "object" && args[0].length !== undefined) {
        args = Array.prototype.slice.call(args[0]);
    }
    if (!args.length) return;
    var ver = Math.round(Number(args[0]) || 0);
    var base = 0;
    var width = bellW;
    if (ver === 2) {
        width = clamp(Number(args[1]) || 0.12, 0.04, 0.3);
        base = 2;
    } else if (ver === 1) {
        base = 1;
    } else {
        return;
    }
    var n = Math.round(Number(args[base]) || 0);
    var list = [];
    for (var i = 0; i < n && base + 2 + i * 2 < args.length + 0; i++) {
        list.push([Number(args[base + 1 + i * 2]), Number(args[base + 2 + i * 2])]);
    }
    if (list.length < 2) return;
    knots = sanitizeKnots(list);
    bellW = width;
    macro = null;
    undoStack = [];
    redoStack = [];
    writeCurve();
    mgraphics.redraw();
}

// ---------------------------------------------------------------- messages from the patch
function layout(name) {
    var m = ("" + name).toLowerCase();
    if (m === "a" || m === "b" || m === "c") mode = m;
    mgraphics.redraw();
}

function setbuffer(scopeName, curveName) {
    if (scopeName && typeof Buffer === "function") scopeBuf = new Buffer("" + scopeName);
    if (curveName && typeof Buffer === "function") curveBuf = new Buffer("" + curveName);
    writeCurve();
    if (!scopeTask && typeof Task === "function") {
        scopeTask = new Task(pullScope, this);
        scopeTask.interval = 33;
        scopeTask.repeat();
    }
}

function set_depth(v) { depthPct = clamp(Number(v) || 0, -100, 100); mgraphics.redraw(); }
function set_smooth(v) { smoothPct = clamp(Number(v) || 0, 0, 100); }
function set_mix(v) { mixPct = clamp(Number(v) || 0, 0, 100); }
function set_out(v) { outDb = clamp(Number(v) || 0, -24, 24); }
function set_size(v) { sizeIdx = clamp(Math.round(Number(v) || 0), 0, 3); mgraphics.redraw(); }
function set_track(v) { trackUI = Number(v) > 0.5 ? 1 : 0; mgraphics.redraw(); }

function loadbang() {
    writeCurve();
    mgraphics.redraw();
}

function notifydeleted() {
    if (scopeTask) {
        scopeTask.cancel();
        scopeTask = null;
    }
}

// ---------------------------------------------------------------- telemetry
function clearTelemetry() {
    var i;
    cepIn = [];
    cepOut = [];
    specIn = [];
    specOut = [];
    gram = [];
    for (i = 0; i < COLS; i++) {
        cepIn.push(0);
        cepOut.push(0);
    }
    for (i = 0; i < SPEC_COLS; i++) {
        specIn.push(-90);
        specOut.push(-90);
    }
    pkIn = 0;
    pkOut = 0;
    pitchConf = 0;
    pitchQ = 0;
}

function cepLevel(v) {
    return clamp((20 * Math.log(Math.abs(v) + 1e-6) / Math.LN10 + 54) / 60, 0, 1);
}

function fillSpectrum(raw, target) {
    // raw: 64 dB values, -999 where no FFT bin fell in the column. Interpolate gaps.
    var i;
    var last = -1;
    var vals = [];
    for (i = 0; i < SPEC_COLS; i++) vals.push(raw[i] > -900 ? raw[i] : null);
    for (i = 0; i < SPEC_COLS; i++) {
        if (vals[i] === null) continue;
        if (last >= 0 && i - last > 1) {
            for (var g = last + 1; g < i; g++) {
                vals[g] = vals[last] + (vals[i] - vals[last]) * (g - last) / (i - last);
            }
        } else if (last < 0) {
            for (var h = 0; h < i; h++) vals[h] = vals[i];
        }
        last = i;
    }
    for (i = 0; i < SPEC_COLS; i++) {
        var v = vals[i] === null ? -90 : clamp(vals[i], -90, 6);
        target[i] += (v - target[i]) * 0.55;
    }
}

function pullScope() {
    if (!scopeBuf) return;
    var d;
    try {
        d = scopeBuf.peek(1, 0, 400);
    } catch (err) {
        return;
    }
    if (!d || d.length < 394) return;
    var sr = d[389];
    if (!(sr > 1000)) return; // DSP has not written yet: the demo stays
    if (demo) {
        demo = false;
        clearTelemetry();
    }
    var silent = d[392] > 0.5;
    var hop = d[386];
    var i;

    if (silent) {
        if (settled) return;
        var live = 0;
        for (i = 0; i < COLS; i++) {
            cepIn[i] *= 0.8;
            cepOut[i] *= 0.8;
            if (cepIn[i] > 0.01) live = 1;
        }
        for (i = 0; i < SPEC_COLS; i++) {
            specIn[i] += (-90 - specIn[i]) * 0.2;
            specOut[i] += (-90 - specOut[i]) * 0.2;
            if (specIn[i] > -88) live = 1;
        }
        pkIn *= 0.7;
        pkOut *= 0.7;
        pitchConf *= 0.8;
        if (pkIn > 0.001 || pkOut > 0.001 || pitchConf > 0.01) live = 1;
        for (var r = 0; r < gram.length; r++) {
            for (var c = 0; c < GRAM_COLS; c++) gram[r][c] *= 0.8;
        }
        if (!live) settled = true;
        mgraphics.redraw();
        return;
    }
    if (hop === lastHop) return; // the DSP is not advancing: nothing new to draw
    lastHop = hop;
    settled = false;

    for (i = 0; i < COLS; i++) {
        cepIn[i] += (cepLevel(d[i]) - cepIn[i]) * 0.6;
        cepOut[i] += (cepLevel(d[128 + i]) - cepOut[i]) * 0.6;
    }
    fillSpectrum(d.slice(256, 320), specIn);
    fillSpectrum(d.slice(320, 384), specOut);
    pitchQ = d[384];
    pitchConf += (clamp(d[385], 0, 1) - pitchConf) * 0.4;
    pitchSr = sr;
    trackLive = d[391] > 0.5 ? 1 : 0;
    qUsed = d[393];
    var pi = clamp(d[387], 0, 4);
    var po = clamp(d[388], 0, 4);
    pkIn = pi > pkIn ? pi : pkIn * 0.8 + pi * 0.2;
    pkOut = po > pkOut ? po : pkOut * 0.8 + po * 0.2;

    var row = [];
    for (i = 0; i < GRAM_COLS; i++) row.push(Math.max(cepIn[i * 2], cepIn[i * 2 + 1]));
    gram.unshift(row);
    if (gram.length > GRAM_ROWS) gram.pop();
    mgraphics.redraw();
}

// ---------------------------------------------------------------- demo (shown only before the first telemetry)
function fillDemo() {
    var i;
    var r;
    var pitchX = timeToX(5.4);
    clearTelemetry();
    for (i = 0; i < COLS; i++) {
        var x = (i + 0.5) / COLS;
        var env = 0.62 * Math.exp(-x * 5.2) + 0.05;
        var pk = 0.50 * Math.exp(-Math.pow((x - pitchX) / 0.022, 2));
        var rah = 0.22 * Math.exp(-Math.pow((x - (pitchX + 0.131)) / 0.020, 2));
        var rah2 = 0.12 * Math.exp(-Math.pow((x - (pitchX + 0.208)) / 0.020, 2));
        var wob = 0.04 * Math.sin(i * 2.7) + 0.03 * Math.sin(i * 5.3 + 1.0);
        var u = clamp(env + pk + rah + rah2 + wob, 0, 1);
        cepIn[i] = u;
        var g = Math.pow(10, curveAt(x) * depthPct / 100 / 20);
        cepOut[i] = clamp(cepLevel(Math.pow(10, (u * 60 - 54) / 20) * g), 0, 1);
    }
    for (i = 0; i < SPEC_COLS; i++) {
        var fx = i / (SPEC_COLS - 1);
        var tilt = -18 - 40 * fx;
        var comb = 14 * Math.max(0, Math.cos(i * 1.57)) * (1 - 0.6 * fx);
        specIn[i] = clamp(tilt + comb + 8 * Math.exp(-Math.pow((fx - 0.3) / 0.08, 2)), -90, 0);
        var flat = (1 - clamp(1 - Math.pow(10, curveAt(pitchX) * depthPct / 100 / 20), 0, 0.95));
        specOut[i] = clamp(tilt + comb * flat + 8 * Math.exp(-Math.pow((fx - 0.3) / 0.08, 2)), -90, 0);
    }
    gram = [];
    for (r = 0; r < GRAM_ROWS; r++) {
        var row = [];
        for (i = 0; i < GRAM_COLS; i++) {
            var xx = (i + 0.5) / GRAM_COLS;
            var drift = 0.012 * Math.sin(r * 0.5);
            var base = 0.55 * Math.exp(-xx * 5.2) + 0.05;
            var p = 0.46 * Math.exp(-Math.pow((xx - pitchX - drift) / 0.024, 2));
            var p2 = 0.18 * Math.exp(-Math.pow((xx - pitchX - 0.131 - drift * 2) / 0.022, 2));
            row.push(clamp(base + p + p2 + 0.03 * Math.sin(i * 3.1 + r), 0, 1) * (1 - r * 0.012));
        }
        gram.push(row);
    }
    pitchQ = 0.0054 * 44100;
    pitchSr = 44100;
    pitchConf = 0.82;
    qUsed = 0.005 * 44100;
    pkIn = 0.45;
    pkOut = 0.33;
}

function preview() {
    demo = true;
    fillDemo();
}

clearTelemetry();
fillDemo();

// ---------------------------------------------------------------- layout
function canvasSize() {
    var s = mgraphics.size;
    if (!s || s.length < 2) return [316, 152];
    return [s[0], s[1]];
}

function layoutMode() {
    if (mode) return mode;
    var s = canvasSize();
    if (s[1] < 110) return "b";
    if (s[0] < 260) return "c";
    return "a";
}

function getLayout() {
    var s = canvasSize();
    var w = s[0];
    var h = s[1];
    var m = layoutMode();
    if (m === "b") {
        return { mode: m, w: w, h: h, hdr: null, plot: [0, 0, w, h - 20], spec: [158, h - 18, w - 158 - 36, 18],
            tool: [0, h - 18, TOOLS.length * TOOL_W, 18], meters: [w - 32, h - 18, 32, 18], wslider: null };
    }
    if (m === "c") {
        return { mode: m, w: w, h: h, hdr: null, plot: [0, 0, w, h - 40], spec: null,
            tool: [0, h - 38, TOOLS.length * TOOL_W, 18], meters: [w - 15, 4, 11, h - 48], wslider: [0, h - 16, w, 16] };
    }
    return { mode: "a", w: w, h: h, hdr: [0, 0, w, 15], plot: [0, 16, w, h - 16 - 42], spec: [0, h - 40, w, 18],
        tool: [0, h - 20, TOOLS.length * TOOL_W, 20], meters: null, wslider: null };
}

function inRect(x, y, r) {
    return r && x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];
}

function plotX(L, xn) {
    return L.plot[0] + 6 + xn * (L.plot[2] - 12 - (L.mode === "c" ? 12 : 0));
}

function plotXInv(L, px) {
    return clamp((px - L.plot[0] - 6) / (L.plot[2] - 12 - (L.mode === "c" ? 12 : 0)), 0, 1);
}

// The bottom 11 px of the plot hold the quefrency axis labels.
function plotY(L, db) {
    return L.plot[1] + 5 + (DB_RANGE - db) / (2 * DB_RANGE) * (L.plot[3] - 16);
}

function plotYInv(L, py) {
    return clamp(DB_RANGE - (py - L.plot[1] - 5) / (L.plot[3] - 16) * 2 * DB_RANGE, -DB_RANGE, DB_RANGE);
}

function knotHit(L, x, y) {
    var best = -1;
    var bestD = 8.5 * 8.5;
    for (var i = 0; i < knots.length; i++) {
        var dx = plotX(L, knots[i][0]) - x;
        var dy = plotY(L, knots[i][1]) - y;
        var d2 = dx * dx + dy * dy;
        if (d2 <= bestD) {
            bestD = d2;
            best = i;
        }
    }
    return best;
}

function toolHit(L, x, y) {
    if (!inRect(x, y, L.tool)) return -1;
    var i = Math.floor((x - L.tool[0]) / TOOL_W);
    return i >= 0 && i < TOOLS.length ? i : -1;
}

// ---------------------------------------------------------------- bell macro (layout C)
function applyMacro(c, db) {
    var w = bellW;
    macro = { c: clamp(c, 0, 1), db: clamp(db, -DB_RANGE, DB_RANGE) };
    var xs = [0, macro.c - 2 * w, macro.c - 0.5 * w, macro.c + 0.5 * w, macro.c + 2 * w, 1];
    var ys = [0, 0, macro.db, macro.db, 0, 0];
    var list = [];
    var prev = -1;
    for (var i = 0; i < xs.length; i++) {
        var x = clamp(xs[i], 0, 1);
        if (x < prev + 0.004) x = Math.min(1, prev + 0.004);
        list.push([x, ys[i]]);
        prev = x;
    }
    knots = sanitizeKnots(list);
    writeCurve();
}

// ---------------------------------------------------------------- mouse
function setDragKnot(L, x, y) {
    var i = dragIdx;
    if (i < 0 || i >= knots.length) return;
    var lo = i > 0 ? knots[i - 1][0] + MIN_GAP : 0;
    var hi = i < knots.length - 1 ? knots[i + 1][0] - MIN_GAP : 1;
    knots[i][0] = clamp(plotXInv(L, x), lo, Math.max(lo, hi));
    knots[i][1] = Math.round(plotYInv(L, y) * 10) / 10;
    macro = null;
    writeCurve();
    mgraphics.redraw();
}

function setBellWidth(L, x) {
    bellW = clamp(0.04 + (x - L.wslider[0] - 40) / Math.max(1, L.wslider[2] - 48) * 0.26, 0.04, 0.30);
    if (macro) applyMacro(macro.c, macro.db);
    mgraphics.redraw();
}

function onclick(x, y) {
    var L = getLayout();
    var t = toolHit(L, x, y);
    dragKind = "";
    if (t >= 0) {
        var id = TOOLS[t];
        if (id === "undo") undo();
        else if (id === "redo") redo();
        else applyPreset(id);
        return;
    }
    if (L.mode === "c" && inRect(x, y, L.wslider)) {
        pushUndoState();
        dragKind = "width";
        setBellWidth(L, x);
        return;
    }
    if (!inRect(x, y, L.plot)) return;
    if (L.mode === "c") {
        pushUndoState();
        dragKind = "pad";
        applyMacro(plotXInv(L, x), plotYInv(L, y));
        mgraphics.redraw();
        return;
    }
    var k = knotHit(L, x, y);
    if (k >= 0) {
        pushUndoState();
        dragKind = "knot";
        dragIdx = k;
        setDragKnot(L, x, y);
    }
}

function ondrag(x, y, but) {
    var L = getLayout();
    if (but === 0) {
        if (dragKind) notifyclients();
        dragKind = "";
        dragIdx = -1;
        mgraphics.redraw();
        return;
    }
    if (dragKind === "knot") {
        setDragKnot(L, x, y);
    } else if (dragKind === "pad") {
        applyMacro(plotXInv(L, x), plotYInv(L, y));
        mgraphics.redraw();
    } else if (dragKind === "width") {
        setBellWidth(L, x);
    }
}

function ondblclick(x, y) {
    var L = getLayout();
    if (!inRect(x, y, L.plot)) return;
    var fresh = (Date.now() - lastUndoTime) < 500;
    if (L.mode === "c") {
        if (!fresh) pushUndoState();
        knots = clonePreset("flat");
        macro = null;
        writeCurve();
        notifyclients();
        mgraphics.redraw();
        return;
    }
    var k = knotHit(L, x, y);
    if (k >= 0) {
        if (knots.length <= 2) return;
        if (!fresh) pushUndoState();
        knots.splice(k, 1);
    } else {
        if (knots.length >= MAX_KNOTS) return;
        if (!fresh) pushUndoState();
        var nx = plotXInv(L, x);
        var ny = Math.round(plotYInv(L, y) * 10) / 10;
        var at = knots.length;
        for (var i = 0; i < knots.length; i++) {
            if (knots[i][0] > nx) {
                at = i;
                break;
            }
        }
        knots.splice(at, 0, [nx, ny]);
        knots = sanitizeKnots(knots);
    }
    macro = null;
    dragKind = "";
    dragIdx = -1;
    writeCurve();
    notifyclients();
    mgraphics.redraw();
}

function onidle(x, y) {
    var L = getLayout();
    var nk = L.mode === "c" ? -1 : (inRect(x, y, L.plot) ? knotHit(L, x, y) : -1);
    var nt = toolHit(L, x, y);
    if (nk !== hoverKnot || nt !== hoverTool) {
        hoverKnot = nk;
        hoverTool = nt;
        mgraphics.redraw();
    }
}

function onidleout() {
    if (hoverKnot !== -1 || hoverTool !== -1) {
        hoverKnot = -1;
        hoverTool = -1;
        mgraphics.redraw();
    }
}

onclick.local = 1;
ondrag.local = 1;
ondblclick.local = 1;

// ---------------------------------------------------------------- drawing helpers
function rgba(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? (c.length > 3 ? c[3] : 1) : a);
}

function fillRect(x, y, w, h, c, a) {
    rgba(c, a);
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
}

function roundRect(x, y, w, h, r, fillC, strokeC, fa, sa) {
    if (fillC) {
        rgba(fillC, fa);
        mgraphics.rectangle_rounded(x, y, w, h, r, r);
        mgraphics.fill();
    }
    if (strokeC) {
        mgraphics.set_line_width(1);
        rgba(strokeC, sa);
        mgraphics.rectangle_rounded(x + 0.5, y + 0.5, w - 1, h - 1, r, r);
        mgraphics.stroke();
    }
}

function textWidth(s, size) {
    return ("" + s).length * size * 0.56;
}

function drawText(s, x, y, size, c, a, align) {
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(size);
    rgba(c, a);
    var px = x;
    if (align === 1) px = x - textWidth(s, size) / 2;
    else if (align === 2) px = x - textWidth(s, size);
    mgraphics.move_to(px, y);
    mgraphics.show_text("" + s);
}

function line(x0, y0, x1, y1, c, a, lw) {
    mgraphics.set_line_width(lw || 1);
    rgba(c, a);
    mgraphics.move_to(x0, y0);
    mgraphics.line_to(x1, y1);
    mgraphics.stroke();
}

function dashedV(x, y0, y1, c, a) {
    for (var y = y0; y < y1; y += 5) line(x, y, x, Math.min(y + 2.5, y1), c, a, 1);
}

// ---------------------------------------------------------------- drawing: pieces
function trackActive() {
    return demo ? trackUI > 0 : trackLive > 0;
}

function pitchX() {
    if (trackActive()) return XM;
    var ms = pitchQ / Math.max(1, pitchSr) * 1000;
    return clamp(timeToX(Math.max(ms, TLO_MS)), 0, 1);
}

function pitchHz() {
    return pitchQ > 1 ? pitchSr / pitchQ : 0;
}

function drawGrid(L) {
    var P = L.plot;
    var compact = L.mode !== "a";
    var dbs = [12, 0, -12];
    var i;
    for (i = 0; i < dbs.length; i++) {
        var gy = plotY(L, dbs[i]);
        line(P[0] + 4, gy, P[0] + P[2] - 4 - (L.mode === "c" ? 12 : 0), gy, C_GRID, dbs[i] === 0 ? 0.80 : 0.38, 1);
        if (!compact || dbs[i] === 0) drawText(dbs[i] > 0 ? "+" + dbs[i] : "" + dbs[i], P[0] + 3, gy - 2, 6.5, C_TXT, 0.55, 0);
    }
    var ticks;
    var labels;
    if (trackActive()) {
        ticks = [0.25, 0.5, 1, 2, 4];
        labels = ["1/4", "1/2", "T", "2T", "4T"];
        for (i = 0; i < ticks.length; i++) {
            var tx = plotX(L, XM + Math.log(ticks[i]) / LOGSPAN);
            if (tx < P[0] + 8 || tx > P[0] + P[2] - 8) continue;
            line(tx, P[1] + 3, tx, P[1] + P[3] - 9, C_GRID, 0.30, 1);
            drawText(labels[i], tx, P[1] + P[3] - 2, 6.5, C_TXT, 0.7, 1);
        }
    } else {
        ticks = compact ? [1, 2, 5, 10, 20] : [0.5, 1, 2, 5, 10, 20];
        for (i = 0; i < ticks.length; i++) {
            var gx = plotX(L, timeToX(ticks[i]));
            line(gx, P[1] + 3, gx, P[1] + P[3] - 9, C_GRID, 0.30, 1);
            var lab = ticks[i] >= 20 ? "20 ms" : (ticks[i] + (ticks[i] === 1 ? " ms" : ""));
            drawText(lab, gx, P[1] + P[3] - 2, 6.5, C_TXT, 0.7, 1);
        }
    }
}

function drawGram(L) {
    var P = L.plot;
    var usable = P[2] - 12 - (L.mode === "c" ? 12 : 0);
    var cw = usable / GRAM_COLS;
    var top = P[1] + 3;
    var rowH = (P[3] - 12) / GRAM_ROWS;
    for (var r = 0; r < gram.length; r++) {
        var fade = 1 - r / (GRAM_ROWS + 4);
        for (var c = 0; c < GRAM_COLS; c++) {
            var v = gram[r][c];
            if (v < 0.30) continue;
            var a = clamp((v - 0.30) * 0.55, 0, 0.42) * fade;
            fillRect(P[0] + 6 + c * cw, top + r * rowH, cw + 0.4, rowH + 0.4, C_IN, a);
        }
    }
}

function drawCepTrace(L, arr, c, fillA, lineA, lw) {
    var P = L.plot;
    var base = P[1] + P[3] - 11;
    var span = (P[3] - 24) * 0.92;
    var x0 = plotX(L, 0.5 / COLS);
    mgraphics.set_line_width(lw);
    var i;
    if (fillA > 0) {
        rgba(c, fillA);
        mgraphics.move_to(x0, base);
        for (i = 0; i < COLS; i++) mgraphics.line_to(plotX(L, (i + 0.5) / COLS), base - arr[i] * span);
        mgraphics.line_to(plotX(L, (COLS - 0.5) / COLS), base);
        mgraphics.close_path();
        mgraphics.fill();
    }
    rgba(c, lineA);
    for (i = 0; i < COLS; i++) {
        var px = plotX(L, (i + 0.5) / COLS);
        var py = base - arr[i] * span;
        if (i === 0) mgraphics.move_to(px, py);
        else mgraphics.line_to(px, py);
    }
    mgraphics.stroke();
}

function drawCurve(L) {
    var P = L.plot;
    var steps = 96;
    var i;
    var depth = depthPct / 100;
    // curve fill toward the 0 dB line
    var zy = plotY(L, 0);
    rgba(C_CURVE, 0.13);
    mgraphics.move_to(plotX(L, 0), zy);
    for (i = 0; i <= steps; i++) {
        var fx = i / steps;
        mgraphics.line_to(plotX(L, fx), plotY(L, curveAt(fx)));
    }
    mgraphics.line_to(plotX(L, 1), zy);
    mgraphics.close_path();
    mgraphics.fill();
    // effective curve when Depth is not 100 %
    if (Math.abs(depth - 1) > 0.02) {
        mgraphics.set_line_width(1);
        rgba(C_OUT, 0.85);
        for (i = 0; i <= steps; i++) {
            var ex = i / steps;
            var ey = plotY(L, clamp(curveAt(ex) * depth, -DB_RANGE, DB_RANGE));
            if (i === 0) mgraphics.move_to(plotX(L, ex), ey);
            else mgraphics.line_to(plotX(L, ex), ey);
        }
        mgraphics.stroke();
    }
    mgraphics.set_line_width(1.8);
    rgba(C_CURVE, 0.98);
    for (i = 0; i <= steps; i++) {
        var cx = i / steps;
        var cy = plotY(L, curveAt(cx));
        if (i === 0) mgraphics.move_to(plotX(L, cx), cy);
        else mgraphics.line_to(plotX(L, cx), cy);
    }
    mgraphics.stroke();
    if (L.mode === "c") return;
    for (i = 0; i < knots.length; i++) {
        var kx = plotX(L, knots[i][0]);
        var ky = plotY(L, knots[i][1]);
        var hot = (i === hoverKnot || (dragKind === "knot" && i === dragIdx));
        rgba([0.05, 0.06, 0.08], 1);
        mgraphics.arc(kx, ky, hot ? 4.6 : 3.8, 0, 6.2831853);
        mgraphics.fill();
        rgba(C_CURVE, 1);
        mgraphics.set_line_width(1.6);
        mgraphics.arc(kx, ky, hot ? 4.0 : 3.1, 0, 6.2831853);
        mgraphics.stroke();
    }
    if (dragKind === "knot" && dragIdx >= 0 && dragIdx < knots.length) {
        var dk = knots[dragIdx];
        var ms = xToMs(dk[0]);
        var tip = (ms < 10 ? ms.toFixed(1) : ms.toFixed(0)) + " ms  " + (dk[1] > 0 ? "+" : "") + dk[1].toFixed(1) + " dB";
        var tw = textWidth(tip, 8) + 8;
        var tx = clamp(plotX(L, dk[0]) - tw / 2, P[0] + 2, P[0] + P[2] - tw - 2);
        var ty = plotY(L, dk[1]) < P[1] + 26 ? plotY(L, dk[1]) + 10 : plotY(L, dk[1]) - 22;
        roundRect(tx, ty, tw, 13, 3, [0.03, 0.04, 0.055], C_CURVE, 0.94, 0.8);
        drawText(tip, tx + 4, ty + 9.6, 8, [0.96, 0.96, 0.98], 1, 0);
    }
}

function drawMacro(L) {
    if (!macro) return;
    var mx = plotX(L, macro.c);
    var my = plotY(L, macro.db);
    var P = L.plot;
    dashedV(mx, P[1] + 3, P[1] + P[3] - 9, C_CURVE, 0.5);
    line(P[0] + 4, my, P[0] + P[2] - 16, my, C_CURVE, 0.4, 1);
    rgba(C_CURVE, 1);
    mgraphics.set_line_width(1.6);
    mgraphics.arc(mx, my, 5.5, 0, 6.2831853);
    mgraphics.stroke();
    rgba(C_CURVE, 0.95);
    mgraphics.arc(mx, my, 2.2, 0, 6.2831853);
    mgraphics.fill();
    if (dragKind === "pad") {
        var ms = xToMs(macro.c);
        var tip = (ms < 10 ? ms.toFixed(1) : ms.toFixed(0)) + " ms  " + (macro.db > 0 ? "+" : "") + macro.db.toFixed(1) + " dB";
        var tw = textWidth(tip, 8) + 8;
        roundRect(clamp(mx - tw / 2, P[0] + 2, P[0] + P[2] - tw - 16), my < P[1] + 26 ? my + 10 : my - 22, tw, 13, 3, [0.03, 0.04, 0.055], C_CURVE, 0.94, 0.8);
        drawText(tip, clamp(mx - tw / 2, P[0] + 2, P[0] + P[2] - tw - 16) + 4, (my < P[1] + 26 ? my + 10 : my - 22) + 9.6, 8, [0.96, 0.96, 0.98], 1, 0);
    }
}

function drawPitchMarker(L) {
    var P = L.plot;
    var hz = pitchHz();
    var show = demo || pitchConf > 0.2;
    var px = plotX(L, pitchX());
    var tracked = trackActive();
    if (tracked) {
        dashedV(plotX(L, XM), P[1] + 3, P[1] + P[3] - 9, C_PITCH, 0.35);
    }
    if (!show || hz <= 0) return;
    var a = 0.45 + 0.5 * clamp(pitchConf, 0, 1);
    line(px, P[1] + 3, px, P[1] + P[3] - 9, C_PITCH, a, 1.4);
    var label = Math.round(hz) + " Hz  " + Math.round(pitchConf * 100) + "%";
    var tw = textWidth(label, 8) + 8;
    var lx = px + 4;
    if (lx + tw > P[0] + P[2] - 4 - (L.mode === "c" ? 12 : 0)) lx = px - 4 - tw;
    roundRect(lx, P[1] + 3, tw, 12, 3, [0.03, 0.05, 0.06], C_PITCH, 0.88, 0.7);
    drawText(label, lx + 4, P[1] + 12, 8, C_PITCH, 1, 0);
}

function drawHeader(L) {
    var H = L.hdr;
    if (!H) return;
    drawText("CEPSTRUM", 4, 11, 8, C_TXT, 0.9, 0);
    // legend
    fillRect(62, 6, 10, 3, C_IN, 0.9);
    drawText("in", 75, 11, 7.5, C_IN, 0.95, 0);
    fillRect(92, 6, 10, 3, C_OUT, 0.9);
    drawText("out", 105, 11, 7.5, C_OUT, 0.95, 0);
    fillRect(126, 6, 10, 3, C_CURVE, 0.9);
    drawText("curve", 139, 11, 7.5, C_CURVE, 0.95, 0);
    var sizes = ["512", "1024", "2048", "4096"];
    drawText("N " + sizes[sizeIdx], H[2] - 4, 11, 8, C_TXT, 0.9, 2);
    var tr = trackActive();
    drawText(tr ? "TRACK" : "FREE", H[2] - 52, 11, 8, tr ? C_PITCH : C_TXT, tr ? 1 : 0.6, 2);
}

function drawSpectrum(L) {
    var S = L.spec;
    if (!S) return;
    roundRect(S[0], S[1], S[2], S[3], 3, C_PLOT, C_EDGE, 1, 1);
    var x0 = S[0] + 4;
    var w = S[2] - 8;
    var yb = S[1] + S[3] - 2;
    var hh = S[3] - 4;
    var i;
    rgba(C_IN, 0.2);
    mgraphics.move_to(x0, yb);
    for (i = 0; i < SPEC_COLS; i++) mgraphics.line_to(x0 + w * i / (SPEC_COLS - 1), yb - clamp((specIn[i] + 90) / 90, 0, 1) * hh);
    mgraphics.line_to(x0 + w, yb);
    mgraphics.close_path();
    mgraphics.fill();
    mgraphics.set_line_width(1);
    rgba(C_IN, 0.85);
    for (i = 0; i < SPEC_COLS; i++) {
        var yi = yb - clamp((specIn[i] + 90) / 90, 0, 1) * hh;
        if (i === 0) mgraphics.move_to(x0, yi);
        else mgraphics.line_to(x0 + w * i / (SPEC_COLS - 1), yi);
    }
    mgraphics.stroke();
    rgba(C_OUT, 0.95);
    for (i = 0; i < SPEC_COLS; i++) {
        var yo = yb - clamp((specOut[i] + 90) / 90, 0, 1) * hh;
        if (i === 0) mgraphics.move_to(x0, yo);
        else mgraphics.line_to(x0 + w * i / (SPEC_COLS - 1), yo);
    }
    mgraphics.stroke();
}

function levelFrac(v) {
    return clamp((20 * Math.log(Math.max(v, 1e-5)) / Math.LN10 + 60) / 60, 0, 1);
}

function drawMeters(L) {
    var M = L.meters;
    if (!M) return;
    var vi = levelFrac(pkIn);
    var vo = levelFrac(pkOut);
    if (L.mode === "b") {
        roundRect(M[0], M[1], M[2], M[3], 3, C_PLOT, C_EDGE, 1, 1);
        fillRect(M[0] + 3, M[1] + 3, (M[2] - 6) * vi, 5, C_IN, 0.9);
        fillRect(M[0] + 3, M[1] + 10, (M[2] - 6) * vo, 5, vo > 0.98 ? [0.96, 0.42, 0.38] : C_OUT, 0.95);
    } else {
        var hh = M[3];
        roundRect(M[0], M[1], M[2], hh, 3, C_PLOT, C_EDGE, 0.9, 1);
        var bw = 3;
        fillRect(M[0] + 2, M[1] + hh - 2 - (hh - 4) * vi, bw, (hh - 4) * vi, C_IN, 0.9);
        fillRect(M[0] + 6, M[1] + hh - 2 - (hh - 4) * vo, bw, (hh - 4) * vo, vo > 0.98 ? [0.96, 0.42, 0.38] : C_OUT, 0.95);
    }
}

function drawIcon(id, cx, cy, c, a) {
    var hw = 7;
    mgraphics.set_line_width(1.5);
    rgba(c, a);
    if (id === "undo" || id === "redo") {
        var d = id === "undo" ? 1 : -1;
        mgraphics.move_to(cx + d * 5, cy + 3.5);
        mgraphics.line_to(cx + d * 5, cy - 1.5);
        mgraphics.line_to(cx - d * 4, cy - 1.5);
        mgraphics.stroke();
        mgraphics.move_to(cx - d * 1.2, cy - 4.8);
        mgraphics.line_to(cx - d * 4.6, cy - 1.5);
        mgraphics.line_to(cx - d * 1.2, cy + 1.8);
        mgraphics.stroke();
        return;
    }
    var pts;
    if (id === "flat") pts = [[-hw, 0], [hw, 0]];
    else if (id === "whisper") pts = [[-hw, -3], [-3.5, -3], [-1.5, 3.5], [1.5, 3.5], [3.5, -3], [hw, -3]];
    else if (id === "robot") pts = [[-hw, 3], [-3.5, 3], [-1.5, -3.5], [1.5, -3.5], [3.5, 3], [hw, 3]];
    else if (id === "body") pts = [[-hw, -3], [-2.5, -3], [0.5, 3.5], [hw, 3.5]];
    else pts = [[-hw, 0], [-5, -3.5], [-2.5, 3.5], [0, -3.5], [2.5, 3.5], [5, -3.5], [hw, 0]];
    for (var i = 0; i < pts.length; i++) {
        if (i === 0) mgraphics.move_to(cx + pts[i][0], cy + pts[i][1]);
        else mgraphics.line_to(cx + pts[i][0], cy + pts[i][1]);
    }
    mgraphics.stroke();
}

function drawToolbar(L) {
    var T = L.tool;
    roundRect(T[0], T[1], T[2], T[3], 3, C_PLOT, C_EDGE, 1, 1);
    var act = activePreset();
    for (var i = 0; i < TOOLS.length; i++) {
        var id = TOOLS[i];
        var x = T[0] + i * TOOL_W;
        var dim = (id === "undo" && !undoStack.length) || (id === "redo" && !redoStack.length);
        var on = (id === act);
        if (on) {
            roundRect(x + 2, T[1] + 2, TOOL_W - 4, T[3] - 4, 3, C_CURVE, null, 0.22, 1);
        } else if (i === hoverTool && !dim) {
            roundRect(x + 2, T[1] + 2, TOOL_W - 4, T[3] - 4, 3, C_TXT, null, 0.14, 1);
        }
        drawIcon(id, x + TOOL_W / 2, T[1] + T[3] / 2, on ? C_CURVE : C_TXT, dim ? 0.30 : (on ? 1 : 0.88));
        if (i === 1) line(x + TOOL_W, T[1] + 4, x + TOOL_W, T[1] + T[3] - 4, C_EDGE, 1, 1);
    }
}

function drawToolTip(L) {
    if (hoverTool < 0) return;
    var T = L.tool;
    var s = TOOL_TITLES[TOOLS[hoverTool]];
    var tw = textWidth(s, 8) + 10;
    var x = clamp(T[0] + hoverTool * TOOL_W + TOOL_W / 2 - tw / 2, 2, L.w - tw - 2);
    var y = T[1] - 16;
    roundRect(x, y, tw, 14, 3, [0.02, 0.03, 0.045], C_TXT, 0.96, 0.6);
    drawText(s, x + 5, y + 10.4, 8, [0.95, 0.96, 0.98], 1, 0);
}

function drawWidthSlider(L) {
    var W = L.wslider;
    if (!W) return;
    roundRect(W[0], W[1], W[2], W[3], 3, C_PLOT, C_EDGE, 1, 1);
    drawText("WIDTH", W[0] + 6, W[1] + 11, 7.5, C_TXT, 0.8, 0);
    var tx0 = W[0] + 40;
    var tw = W[2] - 48;
    line(tx0, W[1] + W[3] / 2, tx0 + tw, W[1] + W[3] / 2, C_GRID, 0.8, 2);
    var fx = tx0 + (bellW - 0.04) / 0.26 * tw;
    line(tx0, W[1] + W[3] / 2, fx, W[1] + W[3] / 2, C_CURVE, 0.95, 2);
    rgba(C_CURVE, 1);
    mgraphics.arc(fx, W[1] + W[3] / 2, 3.4, 0, 6.2831853);
    mgraphics.fill();
}

function drawPadHint(L) {
    if (L.mode !== "c" || macro) return;
    var P = L.plot;
    drawText("drag to shape", P[0] + 8, P[1] + 12, 8, C_TXT, 0.5, 0);
}

// ---------------------------------------------------------------- paint
function paint() {
    var L = getLayout();
    var P = L.plot;
    roundRect(0, 0, L.w, L.h, 4, C_BG, C_EDGE, 1, 1);
    roundRect(P[0], P[1], P[2], P[3], 3, C_PLOT, C_EDGE, 1, 1);
    drawHeader(L);
    drawGrid(L);
    drawGram(L);
    drawCepTrace(L, cepIn, C_IN, 0.20, 0.80, 1.1);
    drawCepTrace(L, cepOut, C_OUT, 0.10, 0.92, 1.3);
    drawPitchMarker(L);
    drawCurve(L);
    drawMacro(L);
    drawPadHint(L);
    drawSpectrum(L);
    drawMeters(L);
    drawToolbar(L);
    drawWidthSlider(L);
    drawToolTip(L);
}
