mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 2;

// EQ+ face (v8ui). src/eqplus_config.js is concatenated in front of this file.
// Outlet 0: param <key> <value> for Live parameters (keys match scripts/build_eqplus.py).
// Outlet 1: gen hub — ["eqcfg", buf], ["spec", buf], ["outgain", dB].
//
// #0-eqplusspec (Max channels are 1-based):
//   ch 1 Pre ring, ch 2 Post ring (EQP_SPEC_RING samples each),
//   ch 3 optional telemetry: [frameTick, writeIndex, sampleRate].
//   Inlet `frametick <n>` is the same counter when ch 3 is absent.
// #0-eqpluscfg ch 1: 8 bands * EQP_CFG_STRIDE, the eqpBiquadCoeffs array
//   (object form stored as b0,b1,b2,a1,a2). Disabled / Off bands are mode 0.

var COL_CHROME = [0x23 / 255, 0x23 / 255, 0x23 / 255, 1];
var COL_BEZEL = [0x2b / 255, 0x2b / 255, 0x2b / 255, 1];
var COL_PLOT = [0x14 / 255, 0x14 / 255, 0x14 / 255, 1];
var COL_LABEL = [0xb8 / 255, 0xb8 / 255, 0xb8 / 255, 1];
var COL_ORANGE = [1, 0x99 / 255, 0x22 / 255, 1];
var COL_DIM = [0x9a / 255, 0x9a / 255, 0x9a / 255, 1];
var COL_AXIS = [0x77 / 255, 0x77 / 255, 0x77 / 255, 1];
var COL_AQ_OFF = [0x78 / 255, 0x78 / 255, 0x78 / 255, 1];
var COL_BTN = [0x36 / 255, 0x36 / 255, 0x36 / 255, 1];
var COL_BTN_TEXT = [0xb0 / 255, 0xb0 / 255, 0xb0 / 255, 1];
var COL_BTN_ON_TEXT = [0x18 / 255, 0x18 / 255, 0x18 / 255, 1];
var COL_DROP = [0x3c / 255, 0x3c / 255, 0x3c / 255, 1];
var COL_DROP_EDGE = [0x52 / 255, 0x52 / 255, 0x52 / 255, 1];
var COL_CARET = [0xcc / 255, 0xcc / 255, 0xcc / 255, 1];
var COL_WHITE = [1, 1, 1, 1];
var COL_INK = [0.10, 0.07, 0.03, 1];

var MODE_NAMES = [
    "Off",
    "Low-Cut 1", "Low-Cut 2", "Low-Cut 4", "Low-Cut 8",
    "Low-Shelf", "Bell", "Notch", "High-Shelf",
    "High-Cut 1", "High-Cut 2", "High-Cut 4", "High-Cut 8"
];
var MODE_SHORT = [
    "Off", "LC1", "LC2", "LC4", "LC8", "LSh", "Bell", "Nch", "HSh", "HC1", "HC2", "HC4", "HC8"
];

var COLS = 140;
var EQP_STATE_VERSION = 1;
var HIT_R = 11;

var cfgBufName = "#0-eqpluscfg";
var specBufName = "#0-eqplusspec";
var currentSr = 48000;

var shiftSt = 0;
var outGainDb = 0;
var rangeIdx = 0;
var adaptiveQ = 1;
var analyzerPre = 1;
var analyzerPost = 1;
var resIdx = 3;
var speedIdx = 0;
var tiltIdx = 2;
var rangeMinDb = -100;
var rangeMaxDb = 0;
var selectedBand = -1;
var inspectorMode = 0;

var bands = [];
var normUp = true;
var freqRight = true;

var undoStack = [];
var redoStack = [];
var MAX_UNDO = 32;
var undoArmed = false;

var gesture = {
    kind: "", band: -1, qOnly: false, dirty: false,
    x0: 0, y0: 0, shift0: 0, gain0: 0, freq0: 0, bandGain0: 0, q0: 0
};
var recentCreate = { band: -1, t: 0 };
var wheelUndoT = 0;

var hoverX = -1;
var hoverY = -1;
var hoverKey = "";
var hoverBand = -1;
var hoverPop = -1;
var pointerIn = false;

var popup = null;
var lastGeo = null;

var specPre = [];
var specPost = [];
var specHoldPreview = false;
var specHasSignal = 0;
var specTask = null;

var frameTick = -1;
var eqpHost = null;
var eqpDsp = {
    ready: 0, error: "", createdAt: 0, counter0: -1, started: 0, retries: 0,
    task: null, confirmTask: null, settleTask: null
};
var EQP_DSP_RETRIES = 2;
var EQP_DSP_CLAIM_MS = 15000;
var EQP_DSP_QUEUE_POLL_MS = 100;
var EQP_DSP_CONFIRM_MS = 150;
var EQP_DSP_SETTLE_MS = 300;
var eqpDspToken = Math.random();

var colEdge = new Array(COLS + 1);
var fftN = 0;
var fftRev = null;
var fftWin = null;
var fftRe = null;
var fftIm = null;
var fftDb = null;
var fftFrame = null;

function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}
function clamp01(v) { return clamp(v, 0, 1); }
function roundTo(v, step) { return Math.round(v / step) * step; }
function finite(v, fb) {
    v = Number(v);
    return (v === v && v !== Infinity && v !== -Infinity) ? v : fb;
}

function probeAxes() {
    var r = EQP_RANGES[0];
    normUp = eqpDbToNorm(r, r) >= eqpDbToNorm(-r, r);
    freqRight = eqpFreqToNorm(EQP_FREQ_MAX) >= eqpFreqToNorm(EQP_FREQ_MIN);
}

function buildEdges() {
    var a = Math.log(EQP_FREQ_MIN);
    var b = Math.log(EQP_FREQ_MAX);
    for (var i = 0; i <= COLS; i++) colEdge[i] = Math.exp(a + (b - a) * (i / COLS));
}

function makeBand(i) {
    return {
        enabled: 0,
        mode: 0,
        freq: EQP_DEFAULT_BAND_FREQS[i],
        gain: 0,
        q: EQP_Q_DEFAULT
    };
}
function resetBands() {
    bands = [];
    for (var i = 0; i < EQP_NUM_BANDS; i++) bands.push(makeBand(i));
}
function allocSpec() {
    specPre = new Array(COLS);
    specPost = new Array(COLS);
    for (var i = 0; i < COLS; i++) {
        specPre[i] = rangeMinDb;
        specPost[i] = rangeMinDb;
    }
}

resetBands();
allocSpec();
buildEdges();
probeAxes();

function rangeDb() {
    var i = clamp(rangeIdx | 0, 0, EQP_RANGES.length - 1);
    return EQP_RANGES[i];
}
function usesGain(mode) {
    try { return !!eqpBandUsesGain(mode); }
    catch (e) { return mode === 5 || mode === 6 || mode === 8; }
}
function bandLive(b) {
    return !!(b && b.enabled && b.mode > 0);
}
function anyLive() {
    for (var i = 0; i < bands.length; i++) if (bandLive(bands[i])) return true;
    return false;
}
function firstInactive() {
    for (var i = 0; i < bands.length; i++) {
        if (!bands[i].enabled || bands[i].mode === 0) return i;
    }
    return -1;
}
function firstActive() {
    for (var i = 0; i < bands.length; i++) if (bandLive(bands[i])) return i;
    return -1;
}

function toScreenFreq(stored) {
    var f = eqpEffectiveFreq(stored, shiftSt);
    if (!(f > 0)) f = stored;
    return clamp(f, EQP_FREQ_MIN, EQP_FREQ_MAX);
}
function toStoredFreq(screenF) {
    if (Math.abs(shiftSt) < 1e-8) return clamp(screenF, EQP_FREQ_MIN, EQP_FREQ_MAX);
    var lo = EQP_FREQ_MIN, hi = EQP_FREQ_MAX;
    if (eqpEffectiveFreq(lo, shiftSt) > screenF) return lo;
    if (eqpEffectiveFreq(hi, shiftSt) < screenF) return hi;
    for (var i = 0; i < 24; i++) {
        var mid = Math.sqrt(lo * hi);
        if (eqpEffectiveFreq(mid, shiftSt) < screenF) lo = mid;
        else hi = mid;
    }
    return clamp(Math.sqrt(lo * hi), EQP_FREQ_MIN, EQP_FREQ_MAX);
}

function geo() {
    var w = 352, h = 161;
    try {
        var s = mgraphics.size;
        if (s && s.length >= 2 && s[0] >= 16 && s[1] >= 16) {
            w = s[0];
            h = s[1];
        }
    } catch (e) {}
    var g = { w: w, h: h, sx: w / 352, sy: h / 161 };
    g.plotX = 2 * g.sx;
    g.plotY = 23 * g.sy;
    g.plotW = 348 * g.sx;
    g.plotH = 115 * g.sy;
    lastGeo = g;
    return g;
}
function sc(g, x, y, w, h) {
    return { x: x * g.sx, y: y * g.sy, w: w * g.sx, h: h * g.sy };
}
function hit(r, x, y) {
    return !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}
function insidePlot(g, x, y) {
    return x >= g.plotX && x < g.plotX + g.plotW && y >= g.plotY && y < g.plotY + g.plotH;
}
function fs(g, px) { return px * Math.min(g.sx, g.sy); }

function uiLayout(g) {
    var L = {
        shift: sc(g, 8, 2, 84, 19),
        gain: sc(g, 96, 2, 76, 19),
        range: [sc(g, 214, 4, 28, 16), sc(g, 244, 4, 28, 16), sc(g, 276, 4, 28, 16)],
        aq: sc(g, 316, 3, 30, 17),
        icon: sc(g, 6, 141, 28, 17),
        pre: sc(g, 95, 141, 28, 16),
        post: sc(g, 127, 141, 32, 16),
        res: sc(g, 217, 141, 48, 16),
        speed: sc(g, 303, 141, 44, 16)
    };
    var y = 141 * g.sy;
    var h = 16 * g.sy;
    var x = 36 * g.sx;
    var pw = 12 * g.sx;
    var gap = 1 * g.sx;
    L.pills = [];
    for (var i = 0; i < EQP_NUM_BANDS; i++) {
        L.pills.push({ x: x, y: y, w: pw, h: h, i: i });
        x += pw + gap;
    }
    x = 142 * g.sx;
    L.power = { x: x, y: y, w: 14 * g.sx, h: h };
    L.mode = { x: 158 * g.sx, y: y, w: 48 * g.sx, h: h };
    L.freq = { x: 208 * g.sx, y: y, w: 36 * g.sx, h: h };
    L.bandGain = { x: 246 * g.sx, y: y, w: 32 * g.sx, h: h };
    L.q = { x: 280 * g.sx, y: y, w: 28 * g.sx, h: h };
    L.tilt = { x: 310 * g.sx, y: y, w: 38 * g.sx, h: h };
    return L;
}

function xToNorm(g, x) {
    var t = clamp01((x - g.plotX) / g.plotW);
    return freqRight ? t : (1 - t);
}
function normToX(g, n) {
    var t = freqRight ? n : (1 - n);
    return g.plotX + clamp01(t) * g.plotW;
}
function freqToX(g, f) {
    return normToX(g, eqpFreqToNorm(clamp(f, EQP_FREQ_MIN, EQP_FREQ_MAX)));
}
function xToFreq(g, x) {
    return clamp(eqpNormToFreq(xToNorm(g, x)), EQP_FREQ_MIN, EQP_FREQ_MAX);
}
function yToNorm(g, y) {
    var t = clamp01((y - g.plotY) / g.plotH);
    return normUp ? (1 - t) : t;
}
function normToY(g, n) {
    if (!(n > -4 && n < 5)) n = 0.5;
    n = clamp01(n);
    var t = normUp ? (1 - n) : n;
    return g.plotY + t * g.plotH;
}
function eqY(g, db) {
    return normToY(g, eqpDbToNorm(db, rangeDb()));
}
function zeroY(g) { return eqY(g, 0); }
function specY(g, db) {
    var lo = rangeMinDb, hi = rangeMaxDb;
    if (!(hi > lo)) { lo = -100; hi = 0; }
    var t = clamp01((db - lo) / (hi - lo));
    return g.plotY + (1 - t) * g.plotH;
}

function responseDb(f) {
    var db = 0;
    try { db = eqpTotalResponseDb(bands, f, currentSr, shiftSt, adaptiveQ, outGainDb); }
    catch (e) { db = 0; }
    return finite(db, 0);
}
function bandDb(b, f) {
    var db = 0;
    try { db = eqpBandResponseDb(b, f, currentSr, shiftSt, adaptiveQ); }
    catch (e) { db = 0; }
    return finite(db, 0);
}
function curveNormAt(nx) {
    var n = eqpDbToNorm(responseDb(eqpNormToFreq(nx)), rangeDb());
    return finite(n, 0.5);
}
function colFreq(i) {
    return Math.sqrt(colEdge[i] * colEdge[i + 1]);
}

function bandXY(g, b) {
    return {
        x: freqToX(g, toScreenFreq(b.freq)),
        y: normToY(g, usesGain(b.mode) ? eqpDbToNorm(b.gain, rangeDb()) : eqpQToNorm(b.q))
    };
}
function hitBand(g, x, y) {
    var r = HIT_R * Math.min(g.sx, g.sy);
    var best = -1;
    var bestD = r * r;
    for (var i = 0; i < bands.length; i++) {
        if (!bandLive(bands[i])) continue;
        var p = bandXY(g, bands[i]);
        var dx = p.x - x, dy = p.y - y;
        var d = dx * dx + dy * dy;
        if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
}
function nearCurve(g, x, y) {
    var cy = eqY(g, responseDb(xToFreq(g, x)));
    return Math.abs(y - cy) <= 8 * g.sy;
}

function modeFromLabel(s) {
    var t = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!t) return 6;
    if (t === "bell" || t === "peak" || t === "peaking") return 6;
    if (t === "notch") return 7;
    if (t.indexOf("lowshelf") === 0 || t === "lshelf" || t === "lowshelf") return 5;
    if (t.indexOf("highshelf") === 0 || t === "hshelf") return 8;
    if (t.indexOf("lowcut") === 0 || t.indexOf("highpass") === 0 || t === "lc" || t === "hp") {
        if (t.indexOf("8") >= 0) return 4;
        if (t.indexOf("4") >= 0) return 3;
        if (t.indexOf("2") >= 0) return 2;
        return 1;
    }
    if (t.indexOf("highcut") === 0 || t.indexOf("lowpass") === 0 || t === "hc" || t === "lp") {
        if (t.indexOf("8") >= 0) return 12;
        if (t.indexOf("4") >= 0) return 11;
        if (t.indexOf("2") >= 0) return 10;
        return 9;
    }
    if (t === "off") return 0;
    for (var i = 0; i < MODE_NAMES.length; i++) {
        if (MODE_NAMES[i].toLowerCase().replace(/[^a-z0-9]+/g, "") === t) return i;
    }
    return 6;
}
function resolveGestureMode(nx, ny, curveNy) {
    var zone = eqpClassifyGestureZone(nx, ny, curveNy);
    var mode = 6;
    if (zone && typeof zone.mode === "number") mode = Math.round(zone.mode);
    else if (zone && typeof zone.name === "string") mode = modeFromLabel(zone.name);
    mode = clamp(mode, 0, 12);
    if (mode === 0) mode = 6;
    return mode;
}
function hintForMode(mode) {
    if (mode === 7) return "Notch";
    if (mode === 5) return "Low-Shelf";
    if (mode === 8) return "High-Shelf";
    if (mode >= 1 && mode <= 4) return "Low-Cut";
    if (mode >= 9 && mode <= 12) return "High-Cut";
    return "Bell";
}
function modeName(mode) {
    mode = clamp(mode | 0, 0, 12);
    return MODE_NAMES[mode];
}

function fmtSt(v) {
    if (Math.abs(v) < 0.005) v = 0;
    return v.toFixed(2) + " st";
}
function fmtOut(v) {
    if (Math.abs(v) < 0.05) v = 0;
    return v.toFixed(1) + " dB";
}
function fmtSignedDb(v) {
    var n = Math.round(v * 10) / 10;
    if (Math.abs(n) < 0.05) return "0.0 dB";
    return (n > 0 ? "+" : "") + n.toFixed(1) + " dB";
}
function fmtFreq(f) {
    if (!(f > 0)) f = EQP_FREQ_MIN;
    if (f >= 1000) {
        var k = f / 1000;
        return (k >= 10 ? k.toFixed(1) : k.toFixed(2)) + " kHz";
    }
    return (f >= 100 ? f.toFixed(0) : f.toFixed(1)) + " Hz";
}
function fmtFreqShort(f) {
    if (f >= 1000) return (f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.00$/, "") + "k";
    return String(Math.round(f));
}
function fmtQ(q) { return "Q " + finite(q, EQP_Q_DEFAULT).toFixed(2); }

function colorOf(c) {
    var r = 1, g = 0.55, b = 0.2, a = 1;
    if (c && typeof c === "object") {
        if (typeof c.length === "number") {
            r = Number(c[0]); g = Number(c[1]); b = Number(c[2]);
            if (c.length > 3 && c[3] !== undefined) a = Number(c[3]);
        } else {
            r = Number(c.r !== undefined ? c.r : 1);
            g = Number(c.g !== undefined ? c.g : 0.55);
            b = Number(c.b !== undefined ? c.b : 0.2);
            if (c.a !== undefined) a = Number(c.a);
        }
    }
    if (r > 1 || g > 1 || b > 1) { r /= 255; g /= 255; b /= 255; }
    if (!(r >= 0)) r = 1;
    if (!(g >= 0)) g = 1;
    if (!(b >= 0)) b = 1;
    if (!(a >= 0)) a = 1;
    return [r, g, b, a];
}
function rainbow(nx) {
    return colorOf(eqpRainbowColor(clamp01(nx)));
}
function lum(c) { return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; }

function setRgb(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? c[3] : a);
}
function rrect(x, y, w, h, r) {
    if (!(w > 0) || !(h > 0)) return;
    r = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
}
function fillRound(x, y, w, h, r, c, a) {
    rrect(x, y, w, h, r);
    setRgb(c, a);
    mgraphics.fill();
}
function textW(str, size, bold) {
    try {
        mgraphics.select_font_face("Ableton Sans Medium");
        mgraphics.set_font_size(size);
        var m = mgraphics.text_measure(String(str));
        if (m && m.length) return m[0];
    } catch (e) {}
    return String(str).length * size * 0.55;
}
function drawText(str, x, y, size, c, align, bold) {
    var s = String(str);
    if (align === "center" || align === "right") {
        var tw = textW(s, size, bold);
        if (align === "center") x -= tw * 0.5;
        else x -= tw;
    }
    mgraphics.select_font_face("Ableton Sans Medium");
    mgraphics.set_font_size(size);
    setRgb(c);
    mgraphics.move_to(x, y);
    mgraphics.show_text(s);
}
function caret(x, y, s, c) {
    setRgb(c);
    mgraphics.move_to(x, y - s * 0.35);
    mgraphics.line_to(x + s, y - s * 0.35);
    mgraphics.line_to(x + s * 0.5, y + s * 0.45);
    mgraphics.close_path();
    mgraphics.fill();
}

// ---------------------------------------------------------------------------------------------
// Coefficients, parameters, undo, serialization
// ---------------------------------------------------------------------------------------------

function coeffRow(c) {
    var stride = EQP_CFG_STRIDE;
    var row = [];
    for (var i = 0; i < stride; i++) row.push(0);
    if (typeof c === "number" && c === c) {
        row[0] = c;
        return row;
    }
    if (c && typeof c === "object" && typeof c.length === "number") {
        for (var k = 0; k < stride && k < c.length; k++) row[k] = finite(c[k], 0);
        return row;
    }
    if (c && typeof c === "object") {
        var b0 = finite(c.b0, 1), b1 = finite(c.b1, 0), b2 = finite(c.b2, 0);
        var a1 = finite(c.a1, 0), a2 = finite(c.a2, 0);
        var a0 = finite(c.a0, 1);
        if (a0 !== 0 && a0 !== 1) {
            b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
        }
        row[0] = b0; row[1] = b1; row[2] = b2; row[3] = a1; row[4] = a2;
    } else {
        row[0] = 1;
    }
    return row;
}

function updateCoeffBuffer() {
    if (typeof Buffer === "undefined") return;
    try {
        var buf = new Buffer(cfgBufName);
        var stride = EQP_CFG_STRIDE;
        var all = [];
        for (var i = 0; i < EQP_NUM_BANDS; i++) {
            var b = bands[i];
            var mode = bandLive(b) ? b.mode : 0;
            var effF = eqpEffectiveFreq(b.freq, shiftSt);
            var effQ = eqpEffectiveQ(b.q, b.gain, adaptiveQ, mode);
            var row = coeffRow(eqpBiquadCoeffs(mode, effF, b.gain, effQ, currentSr));
            for (var k = 0; k < stride; k++) all.push(row[k]);
        }
        buf.poke(1, 0, all);
    } catch (e) {}
}

function emitParam(name, value) {
    outlet(0, "param", name, value);
}
function emitOutGain() {
    outlet(1, ["outgain", outGainDb]);
}
function emitBand(i) {
    var n = i + 1;
    var b = bands[i];
    emitParam("b" + n + "_enable", b.enabled ? 1 : 0);
    emitParam("b" + n + "_mode", b.mode);
    emitParam("b" + n + "_freq", b.freq);
    emitParam("b" + n + "_gain", b.gain);
    emitParam("b" + n + "_q", b.q);
}
function emitAll() {
    emitParam("shift", shiftSt);
    emitParam("gain", outGainDb);
    emitOutGain();
    emitParam("range", rangeIdx);
    emitParam("adaptiveq", adaptiveQ ? 1 : 0);
    emitParam("pre", analyzerPre ? 1 : 0);
    emitParam("post", analyzerPost ? 1 : 0);
    emitParam("resolution", resIdx);
    emitParam("speed", speedIdx);
    emitParam("tilt", tiltIdx);
    for (var i = 0; i < EQP_NUM_BANDS; i++) emitBand(i);
}

function getvalueof() {
    var out = [
        EQP_STATE_VERSION,
        shiftSt, outGainDb, rangeIdx,
        adaptiveQ ? 1 : 0, analyzerPre ? 1 : 0, analyzerPost ? 1 : 0,
        resIdx, speedIdx, tiltIdx, rangeMinDb, rangeMaxDb
    ];
    for (var i = 0; i < EQP_NUM_BANDS; i++) {
        var b = bands[i];
        out.push(b.enabled ? 1 : 0, b.mode, b.freq, b.gain, b.q);
    }
    return out;
}

function applyStateArray(args) {
    if (!args || !args.length) return;
    var ver = Math.round(finite(args[0], 0));
    if (ver !== 1) return;
    if (args.length > 1) shiftSt = clamp(finite(args[1], 0), -36, 36);
    if (args.length > 2) outGainDb = clamp(finite(args[2], 0), -24, 24);
    if (args.length > 3) rangeIdx = clamp(Math.round(finite(args[3], 0)), 0, EQP_RANGES.length - 1);
    if (args.length > 4) adaptiveQ = finite(args[4], 1) > 0.5 ? 1 : 0;
    if (args.length > 5) analyzerPre = finite(args[5], 1) > 0.5 ? 1 : 0;
    if (args.length > 6) analyzerPost = finite(args[6], 1) > 0.5 ? 1 : 0;
    if (args.length > 7) resIdx = clamp(Math.round(finite(args[7], 3)), 0, EQP_RESOLUTIONS.length - 1);
    if (args.length > 8) speedIdx = clamp(Math.round(finite(args[8], 0)), 0, EQP_SPEEDS.length - 1);
    if (args.length > 9) tiltIdx = clamp(Math.round(finite(args[9], 2)), 0, EQP_TILTS.length - 1);
    if (args.length > 10) rangeMinDb = clamp(finite(args[10], -100), -144, -21);
    if (args.length > 11) rangeMaxDb = clamp(finite(args[11], 0), -120, 30);
    var base = 12;
    for (var i = 0; i < EQP_NUM_BANDS; i++) {
        var o = base + i * 5;
        if (args.length <= o) break;
        var b = bands[i];
        b.enabled = finite(args[o], 0) > 0.5 ? 1 : 0;
        if (args.length > o + 1) b.mode = clamp(Math.round(finite(args[o + 1], 0)), 0, 12);
        if (args.length > o + 2) b.freq = clamp(finite(args[o + 2], b.freq), EQP_FREQ_MIN, EQP_FREQ_MAX);
        if (args.length > o + 3) b.gain = clamp(finite(args[o + 3], 0), EQP_GAIN_MIN, EQP_GAIN_MAX);
        if (args.length > o + 4) b.q = clamp(finite(args[o + 4], EQP_Q_DEFAULT), EQP_Q_MIN, EQP_Q_MAX);
        if (b.mode === 0) b.enabled = 0;
    }
    updateCoeffBuffer();
    emitAll();
    mgraphics.redraw();
}

function setvalueof() {
    var args = Array.prototype.slice.call(arguments);
    if (args.length === 1 && args[0] && typeof args[0].length === "number" && typeof args[0] !== "string") args = args[0];
    applyStateArray(args);
}

function pushUndoState() {
    undoStack.push(getvalueof());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
}
function markDirty() {
    if (!undoArmed) {
        pushUndoState();
        undoArmed = true;
    }
    gesture.dirty = true;
}
function finishGesture() {
    var notify = undoArmed && gesture.dirty;
    gesture.kind = "";
    gesture.qOnly = false;
    gesture.dirty = false;
    undoArmed = false;
    if (notify && typeof notifyclients === "function") notifyclients();
    updateCoeffBuffer();
    mgraphics.redraw();
}
function undo() {
    if (!undoStack.length) return;
    redoStack.push(getvalueof());
    applyStateArray(undoStack.pop());
    if (typeof notifyclients === "function") notifyclients();
}
function redo() {
    if (!redoStack.length) return;
    undoStack.push(getvalueof());
    applyStateArray(redoStack.pop());
    if (typeof notifyclients === "function") notifyclients();
}
function discreteEdit(fn) {
    if (gesture.kind) finishGesture();
    pushUndoState();
    fn();
    if (typeof notifyclients === "function") notifyclients();
    mgraphics.redraw();
}

// ---------------------------------------------------------------------------------------------
// Spectrum: Hann radix-2 FFT, tilt around 1 kHz, speed smoothing
// ---------------------------------------------------------------------------------------------

function ensureFft(n) {
    if (fftN === n && fftRev) return;
    fftN = n;
    var bits = Math.round(Math.log(n) / Math.LN2);
    fftRev = new Array(n);
    fftWin = new Array(n);
    fftRe = new Array(n);
    fftIm = new Array(n);
    fftDb = new Array(n >> 1);
    var twoPi = 2 * Math.PI;
    var scale = 4 / n;
    for (var i = 0; i < n; i++) {
        var rev = 0, v = i;
        for (var b = 0; b < bits; b++) {
            rev = (rev << 1) | (v & 1);
            v >>= 1;
        }
        fftRev[i] = rev;
        fftWin[i] = 0.5 * (1 - Math.cos((twoPi * i) / (n - 1))) * scale;
    }
}

function fftDbBins(frame, n, sr) {
    ensureFft(n);
    var re = fftRe, im = fftIm;
    for (var i = 0; i < n; i++) {
        var ri = fftRev[i];
        var s = i < frame.length ? finite(frame[i], 0) : 0;
        re[ri] = s * fftWin[i];
        im[ri] = 0;
    }
    for (var size = 2; size <= n; size <<= 1) {
        var half = size >> 1;
        var theta = (-2 * Math.PI) / size;
        var sRe = Math.cos(theta), sIm = Math.sin(theta);
        for (var start = 0; start < n; start += size) {
            var wr = 1, wi = 0;
            for (var j = 0; j < half; j++) {
                var e = start + j, o = e + half;
                var tr = wr * re[o] - wi * im[o];
                var ti = wr * im[o] + wi * re[o];
                re[o] = re[e] - tr;
                im[o] = im[e] - ti;
                re[e] += tr;
                im[e] += ti;
                var nwr = wr * sRe - wi * sIm;
                wi = wr * sIm + wi * sRe;
                wr = nwr;
            }
        }
    }
    var bins = n >> 1;
    var out = fftDb;
    for (var k = 0; k < bins; k++) {
        var mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        out[k] = 20 * Math.log(Math.max(mag, 1e-12)) / Math.LN10;
    }
    return out;
}

function columnDb(dbBins, n, sr, i) {
    var bins = n >> 1;
    var scale = n / Math.max(8000, sr);
    var bLo = colEdge[i] * scale;
    var bHi = colEdge[i + 1] * scale;
    if (bLo < 1) bLo = 1;
    if (bHi < bLo) bHi = bLo;
    var last = bins - 1;
    if (bLo > last) bLo = last;
    if (bHi > last) bHi = last;
    var db;
    if (bHi - bLo <= 1.25) {
        var mid = 0.5 * (bLo + bHi);
        var idx = Math.floor(mid);
        if (idx < 1) idx = 1;
        if (idx > bins - 2) idx = bins - 2;
        var t = mid - idx;
        db = dbBins[idx] + (dbBins[idx + 1] - dbBins[idx]) * t;
    } else {
        var i0 = Math.max(1, Math.floor(bLo));
        var i1 = Math.min(last, Math.ceil(bHi));
        db = -240;
        for (var b = i0; b <= i1; b++) if (dbBins[b] > db) db = dbBins[b];
    }
    var tilt = EQP_TILTS[tiltIdx] || 0;
    if (tilt) {
        var fc = colFreq(i);
        db += tilt * (Math.log(fc / 1000) / Math.LN2);
    }
    return finite(db, rangeMinDb);
}

function smoothInto(dst, raw) {
    if (speedIdx === 3) return false;
    var atk = [0.80, 0.45, 0.18, 0][speedIdx];
    var rel = [0.42, 0.20, 0.08, 0][speedIdx];
    var moved = false;
    for (var i = 0; i < COLS; i++) {
        var prev = dst[i];
        var target = raw[i];
        var c = target > prev ? atk : rel;
        var next = prev + (target - prev) * c;
        if (Math.abs(next - prev) > 0.25) moved = true;
        dst[i] = next;
    }
    return moved;
}

function frameEnergy(frame) {
    var e = 0;
    var step = Math.max(1, (frame.length / 64) | 0);
    for (var i = 0; i < frame.length; i += step) e += frame[i] * frame[i];
    return e;
}

function unwrapRing(ring, n, writePos) {
    var len = ring.length;
    if (!fftFrame || fftFrame.length !== n) fftFrame = new Array(n);
    var start = 0;
    if (writePos === writePos && writePos >= 0 && len > 0) {
        var w = Math.floor(writePos) % len;
        if (w < 0) w += len;
        start = (w - n + len) % len;
    }
    for (var i = 0; i < n; i++) {
        var v = len ? Number(ring[(start + i) % len]) : 0;
        fftFrame[i] = v === v ? v : 0;
    }
    return fftFrame;
}

function peekOne(buf, ch, index) {
    var v = buf.peek(ch, index, 1);
    if (typeof v === "number") return v;
    if (v && typeof v.length === "number" && v.length) return Number(v[0]);
    return NaN;
}
function peekMany(buf, ch, index, n) {
    var v = buf.peek(ch, index, n);
    if (typeof v === "number") return n === 1 ? [v] : null;
    if (!v || typeof v.length !== "number") return null;
    return v;
}
function bufferChannels(buf) {
    try {
        if (typeof buf.channelcount === "function") return buf.channelcount() || 0;
        if (typeof buf.channelcount === "number") return buf.channelcount;
    } catch (e) {}
    return 0;
}

function readFrameTick() {
    var n = frameTick;
    if (typeof Buffer === "undefined") return n;
    try {
        var buf = new Buffer(specBufName);
        if (bufferChannels(buf) >= 3) {
            var p = peekOne(buf, 3, 0);
            if (p === p) return p;
        }
    } catch (e) {}
    return n;
}

function fitFftN(want, have) {
    var n = want < have ? want : have;
    if (n < 256) return 0;
    var p = 256;
    while (p * 2 <= n) p *= 2;
    return p;
}

function pullSpectrum() {
    if (speedIdx === 3) return;
    if (!analyzerPre && !analyzerPost) return;
    if (typeof Buffer === "undefined") return;
    var n = EQP_FFT_SIZES[resIdx] || 8192;
    var moved = false;
    try {
        var buf = new Buffer(specBufName);
        var chans = bufferChannels(buf);
        var writePos = -1;
        if (chans >= 3) {
            var tick = peekOne(buf, 3, 0);
            if (tick === tick) frameTick = tick;
            writePos = peekOne(buf, 3, 1);
            var rate = peekOne(buf, 3, 2);
            if (rate > 8000 && rate < 384000 && Math.abs(rate - currentSr) > 1) {
                currentSr = rate;
                updateCoeffBuffer();
            }
        }
        var raw = new Array(COLS);
        function eat(channel, dst) {
            var ring = peekMany(buf, channel, 0, EQP_SPEC_RING);
            if (!ring || ring.length < 16) return false;
            var fn = fitFftN(n, ring.length);
            if (!fn) return false;
            var frame = unwrapRing(ring, fn, writePos);
            if (frameEnergy(frame) < 1e-12) return false;
            if (specHoldPreview) specHoldPreview = false;
            specHasSignal = 1;
            var bins = fftDbBins(frame, frame.length, currentSr);
            for (var c = 0; c < COLS; c++) raw[c] = columnDb(bins, frame.length, currentSr, c);
            if (smoothInto(dst, raw)) moved = true;
            return true;
        }
        var got = false;
        if (analyzerPre) got = eat(1, specPre) || got;
        if (analyzerPost) got = eat(2, specPost) || got;
        if (!got) {
            if (specHoldPreview) return;
            var floor = rangeMinDb;
            for (var i = 0; i < COLS; i++) {
                if (analyzerPre && specPre[i] > floor + 0.4) {
                    specPre[i] += (floor - specPre[i]) * 0.18;
                    moved = true;
                }
                if (analyzerPost && specPost[i] > floor + 0.4) {
                    specPost[i] += (floor - specPost[i]) * 0.18;
                    moved = true;
                }
            }
        }
    } catch (e) {}
    if (moved) mgraphics.redraw();
}

function seedPreviewSpectrum() {
    for (var i = 0; i < COLS; i++) {
        var nrm = i / (COLS - 1);
        var db = -82
            + 16 * Math.exp(-Math.pow((nrm - 0.38) / 0.22, 2))
            + 8 * Math.exp(-Math.pow((nrm - 0.70) / 0.10, 2))
            + 3.5 * Math.sin(nrm * 22);
        specPre[i] = db + 2.5;
        specPost[i] = db;
    }
    specHoldPreview = true;
}

// ---------------------------------------------------------------------------------------------
// Deferred gen~
// ---------------------------------------------------------------------------------------------

function hostPatcher() {
    if (eqpHost) return eqpHost;
    try {
        if (typeof this !== "undefined" && this && this.patcher) eqpHost = this.patcher;
    } catch (e) {}
    if (!eqpHost && typeof patcher !== "undefined" && patcher) eqpHost = patcher;
    return eqpHost;
}
function eqpDspTimeout() {
    return eqpDsp.retries === 0 ? 3500 : 6000;
}
function eqpDspPath() {
    return "/tmp/eqplus_core_" + GEN_DSP_HASH + ".gendsp";
}
function eqpDspWriteFile(path) {
    try {
        var rf = new File(path, "read");
        var have = rf.isopen && rf.eof === GEN_DSP_TEXT.length;
        rf.close();
        if (have) return true;
    } catch (e) {}
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) return false;
    f.eof = 0;
    for (var i = 0; i < GEN_DSP_TEXT.length; i += 16384) f.writestring(GEN_DSP_TEXT.substring(i, i + 16384));
    f.close();
    return true;
}
function eqpDspResend() {
    outlet(1, ["eqcfg", cfgBufName]);
    outlet(1, ["spec", specBufName]);
    outlet(1, ["outgain", outGainDb]);
    updateCoeffBuffer();
}
function eqpDspClaim() {
    if (typeof Global !== "function") return true;
    var q = new Global("eqplus_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== eqpDspToken && now - Number(q.t) < EQP_DSP_CLAIM_MS) return false;
    q.owner = eqpDspToken;
    q.t = now;
    return true;
}
function eqpDspRelease() {
    if (typeof Global !== "function") return;
    try {
        var q = new Global("eqplus_dspq");
        if (q.owner === eqpDspToken) q.owner = 0;
    } catch (e) {}
}
function loadDsp() {
    if (eqpDsp.ready || eqpDsp.createdAt) return;
    var host = hostPatcher();
    if (!host || typeof GEN_DSP_TEXT === "undefined" || typeof GEN_DSP_HASH === "undefined") return;
    if (!eqpDspClaim()) {
        if (typeof Task === "function") {
            if (!eqpDsp.task) eqpDsp.task = new Task(loadDsp, this);
            eqpDsp.task.schedule(EQP_DSP_QUEUE_POLL_MS);
        }
        return;
    }
    try {
        var g = host.getnamed("eq_gen");
        if (!g) {
            var path = eqpDspPath();
            if (!eqpDspWriteFile(path)) throw new Error("cannot write " + path);
            g = host.newdefault(40, 420, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "eq_gen";
            var hub = host.getnamed("eq_genin");
            var pin = host.getnamed("eq_plugin");
            var pout = host.getnamed("eq_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            host.connect(hub, 0, g, 0);
            host.connect(pin, 0, g, 0);
            host.connect(pin, 1, g, 1);
            host.connect(g, 0, pout, 0);
            host.connect(g, 1, pout, 1);
        }
        eqpDsp.createdAt = Date.now();
        eqpDsp.counter0 = readFrameTick();
        eqpDspConfirm();
    } catch (err) {
        eqpDsp.error = String(err && err.message ? err.message : err);
        eqpDspRelease();
        post("EQ+: DSP load failed: " + eqpDsp.error + "\n");
    }
    mgraphics.redraw();
}
function eqpDspConfirm() {
    var c = readFrameTick();
    if (eqpDsp.counter0 < 0 && c >= 0) eqpDsp.counter0 = c;
    if (eqpDsp.counter0 >= 0 && c >= 0 && c !== eqpDsp.counter0) {
        frameTick = c;
        eqpDsp.ready = 1;
        eqpDsp.error = "";
        eqpDspRelease();
        eqpDspResend();
        if (typeof Task === "function") {
            if (!eqpDsp.settleTask) eqpDsp.settleTask = new Task(eqpDspResend, this);
            eqpDsp.settleTask.schedule(EQP_DSP_SETTLE_MS);
        }
        mgraphics.redraw();
        return;
    }
    if (eqpDsp.createdAt && Date.now() - eqpDsp.createdAt > eqpDspTimeout() && eqpDsp.retries < EQP_DSP_RETRIES) {
        eqpDsp.retries++;
        try {
            var old = hostPatcher() && hostPatcher().getnamed("eq_gen");
            if (old) hostPatcher().remove(old);
        } catch (e) {}
        eqpDsp.createdAt = 0;
        eqpDsp.counter0 = -1;
        loadDsp();
        return;
    }
    if (eqpDsp.createdAt && Date.now() - eqpDsp.createdAt > eqpDspTimeout()) {
        eqpDsp.error = "not running";
        eqpDspRelease();
        mgraphics.redraw();
        return;
    }
    eqpDspResend();
    if (typeof Task !== "function") return;
    if (!eqpDsp.confirmTask) eqpDsp.confirmTask = new Task(eqpDspConfirm, this);
    eqpDsp.confirmTask.schedule(EQP_DSP_CONFIRM_MS);
}
function init_dsp() {
    specHoldPreview = false;
    specHasSignal = 0;
    allocSpec();
    eqpDsp.started = 1;
    if (eqpDsp.ready || eqpDsp.createdAt) return;
    if (typeof Task !== "function") return;
    if (!eqpDsp.task) eqpDsp.task = new Task(loadDsp, this);
    eqpDsp.task.schedule(30);
}
function frametick(n) {
    var v = Number(n);
    if (v === v) frameTick = v;
}
function dsp_diag() {
    post("EQ+ dsp ready=" + eqpDsp.ready + " err=" + eqpDsp.error + " frame=" + readFrameTick() + "\n");
}

// ---------------------------------------------------------------------------------------------
// Popups and edits
// ---------------------------------------------------------------------------------------------

function itemsFrom(names) {
    var out = [];
    for (var i = 0; i < names.length; i++) out.push({ label: String(names[i]), value: i });
    return out;
}
function modeItems() {
    var out = [];
    for (var i = 0; i < MODE_NAMES.length; i++) out.push({ label: MODE_NAMES[i], value: i });
    return out;
}
function tiltItems() {
    var out = [];
    for (var i = 0; i < EQP_TILTS.length; i++) {
        var v = EQP_TILTS[i];
        out.push({ label: (v === 0 ? "0" : v.toFixed(1)) + " dB/oct", value: i });
    }
    return out;
}
function openPopup(kind, anchor, items, selected, band) {
    var g = lastGeo || geo();
    var rowH = 14 * g.sy;
    var cols = items.length > 8 ? 2 : 1;
    var rowsN = Math.ceil(items.length / cols);
    var colW = Math.max(anchor.w, (kind === "bandmode" ? 92 : 78) * g.sx);
    var w = colW * cols + 4 * g.sx;
    var h = rowsN * rowH + 4 * g.sy;
    var x = anchor.x;
    var y = anchor.y - h - 3 * g.sy;
    if (y < 2) y = anchor.y + anchor.h + 3 * g.sy;
    if (x + w > g.w - 2) x = g.w - w - 2;
    if (x < 2) x = 2;
    if (y + h > g.h - 2) y = Math.max(2, g.h - h - 2);
    var rects = [];
    for (var i = 0; i < items.length; i++) {
        var col = (cols === 2 && i >= rowsN) ? 1 : 0;
        var row = (cols === 2 && i >= rowsN) ? (i - rowsN) : i;
        rects.push({
            x: x + 2 * g.sx + col * colW,
            y: y + 2 * g.sy + row * rowH,
            w: colW - 2 * g.sx,
            h: rowH - 1,
            item: items[i]
        });
    }
    popup = {
        kind: kind, x: x, y: y, w: w, h: h,
        items: items, selected: selected, rects: rects, band: band
    };
    mgraphics.redraw();
}
function closePopup() {
    if (!popup) return;
    popup = null;
    hoverPop = -1;
    mgraphics.redraw();
}
function hitPopup(x, y) {
    if (!popup) return -1;
    for (var i = 0; i < popup.rects.length; i++) if (hit(popup.rects[i], x, y)) return i;
    return -1;
}
function popupContains(x, y) {
    return popup && x >= popup.x && x < popup.x + popup.w && y >= popup.y && y < popup.y + popup.h;
}

function setBandMode(i, mode) {
    var b = bands[i];
    mode = clamp(mode | 0, 0, 12);
    b.mode = mode;
    b.enabled = mode === 0 ? 0 : 1;
    if (b.enabled && !(b.q > 0)) b.q = EQP_Q_DEFAULT;
    selectedBand = i;
    emitBand(i);
    updateCoeffBuffer();
}
function cycleBandMode(i, dir) {
    var m = bands[i].mode;
    if (m < 1 || m > 12) m = dir > 0 ? 0 : 13;
    m += dir;
    if (m > 12) m = 1;
    if (m < 1) m = 12;
    setBandMode(i, m);
}
function enterInspector(bandIdx) {
    inspectorMode = 1;
    if (bandIdx >= 0) selectedBand = bandIdx;
    else if (selectedBand < 0) {
        var a = firstActive();
        selectedBand = a >= 0 ? a : 0;
    }
}

function placeBand(i, mode, x, y, g) {
    var b = bands[i];
    var ny = yToNorm(g, y);
    b.enabled = 1;
    b.mode = mode;
    b.freq = toStoredFreq(xToFreq(g, x));
    if (usesGain(mode)) b.gain = clamp(eqpNormToDb(ny, rangeDb()), EQP_GAIN_MIN, EQP_GAIN_MAX);
    else b.q = clamp(eqpNormToQ(ny), EQP_Q_MIN, EQP_Q_MAX);
    selectedBand = i;
}
function deactivateBand(i) {
    bands[i].enabled = 0;
    bands[i].mode = 0;
    if (selectedBand === i) selectedBand = -1;
    if (recentCreate.band === i) recentCreate.band = -1;
    emitBand(i);
    updateCoeffBuffer();
}

function beginCreate(g, x, y, opt) {
    var idx = firstInactive();
    if (idx < 0) return false;
    var nx = xToNorm(g, x);
    var ny = yToNorm(g, y);
    var mode = resolveGestureMode(nx, ny, curveNormAt(nx));
    markDirty();
    placeBand(idx, mode, x, y, g);
    recentCreate.band = idx;
    recentCreate.t = Date.now();
    gesture.kind = "band";
    gesture.band = idx;
    gesture.qOnly = !!opt;
    gesture.x0 = x;
    gesture.y0 = y;
    gesture.freq0 = bands[idx].freq;
    gesture.bandGain0 = bands[idx].gain;
    gesture.q0 = bands[idx].q;
    emitBand(idx);
    updateCoeffBuffer();
    return true;
}
function beginDragBand(i, x, y, opt) {
    selectedBand = i;
    gesture.kind = "band";
    gesture.band = i;
    gesture.qOnly = !!opt;
    gesture.x0 = x;
    gesture.y0 = y;
    gesture.freq0 = bands[i].freq;
    gesture.bandGain0 = bands[i].gain;
    gesture.q0 = bands[i].q;
}
function dragBand(g, x, y) {
    var b = bands[gesture.band];
    if (!b) return;
    var pf = b.freq, pg = b.gain, pq = b.q;
    if (gesture.qOnly && usesGain(b.mode)) {
        var dy = (gesture.y0 - y) / Math.max(0.001, g.sy);
        var n0 = eqpQToNorm(gesture.q0);
        b.q = clamp(eqpNormToQ(clamp01(n0 + dy / 115)), EQP_Q_MIN, EQP_Q_MAX);
    } else if (gesture.qOnly) {
        b.q = clamp(eqpNormToQ(yToNorm(g, y)), EQP_Q_MIN, EQP_Q_MAX);
    } else if (!usesGain(b.mode)) {
        b.freq = toStoredFreq(xToFreq(g, x));
        b.q = clamp(eqpNormToQ(yToNorm(g, y)), EQP_Q_MIN, EQP_Q_MAX);
    } else {
        b.freq = toStoredFreq(xToFreq(g, x));
        b.gain = clamp(eqpNormToDb(yToNorm(g, y), rangeDb()), EQP_GAIN_MIN, EQP_GAIN_MAX);
    }
    if (b.freq !== pf || b.gain !== pg || b.q !== pq) {
        markDirty();
        emitBand(gesture.band);
        updateCoeffBuffer();
    }
}
function dragShift(g, y) {
    var dy = (gesture.y0 - y) / Math.max(0.001, g.sy);
    var sens = gesture.fine ? 0.02 : 0.08;
    var v = clamp(roundTo(gesture.shift0 + dy * sens, 0.01), -36, 36);
    if (v === shiftSt) return;
    markDirty();
    shiftSt = v;
    emitParam("shift", shiftSt);
    updateCoeffBuffer();
}
function dragOutGain(g, y) {
    var dy = (gesture.y0 - y) / Math.max(0.001, g.sy);
    var sens = gesture.fine ? 0.04 : 0.15;
    var v = clamp(roundTo(gesture.gain0 + dy * sens, 0.1), -24, 24);
    if (v === outGainDb) return;
    markDirty();
    outGainDb = v;
    emitParam("gain", outGainDb);
    emitOutGain();
}
function dragReadout(g, y) {
    var b = bands[gesture.band];
    if (!b) return;
    var dy = (gesture.y0 - y) / Math.max(0.001, g.sy);
    var sens = gesture.fine ? 0.25 : 1;
    var pf = b.freq, pg = b.gain, pq = b.q;
    if (gesture.kind === "freq") {
        b.freq = clamp(gesture.freq0 * Math.exp(dy * 0.01 * sens), EQP_FREQ_MIN, EQP_FREQ_MAX);
    } else if (gesture.kind === "bandgain") {
        b.gain = clamp(roundTo(gesture.bandGain0 + dy * 0.12 * sens, 0.1), EQP_GAIN_MIN, EQP_GAIN_MAX);
    } else if (gesture.kind === "qread") {
        b.q = clamp(gesture.q0 * Math.exp(dy * 0.012 * sens), EQP_Q_MIN, EQP_Q_MAX);
    }
    if (b.freq !== pf || b.gain !== pg || b.q !== pq) {
        markDirty();
        emitBand(gesture.band);
        updateCoeffBuffer();
    }
}

function adjustQ(i, dy) {
    var b = bands[i];
    if (!bandLive(b) || !dy) return;
    var now = Date.now();
    if (!undoArmed && now - wheelUndoT > 320) {
        pushUndoState();
        wheelUndoT = now;
    }
    var d = clamp(dy, -3, 3);
    b.q = clamp(b.q * Math.exp(d * 0.12), EQP_Q_MIN, EQP_Q_MAX);
    b.q = roundTo(b.q, 0.001);
    emitBand(i);
    updateCoeffBuffer();
    if (typeof notifyclients === "function") notifyclients();
    mgraphics.redraw();
}
function wheelDy(args) {
    var last = args.length ? args[args.length - 1] : null;
    if (args.length <= 9 && !(last && typeof last === "object")) {
        var iy = Number(args[3]);
        return iy === iy ? iy : 0;
    }
    if (last && typeof last === "object") {
        if (last.deltaY !== undefined) return -Number(last.deltaY) || 0;
        if (last.wheelDeltaY !== undefined) return Number(last.wheelDeltaY) || 0;
    }
    var nums = [];
    for (var i = 2; i < args.length; i++) {
        var n = Number(args[i]);
        if (n === n) nums.push(n);
    }
    if (nums.length >= 2) return nums[nums.length - 1];
    if (nums.length === 1) return nums[0];
    return 0;
}

function recentBand() {
    if (recentCreate.band >= 0 && Date.now() - recentCreate.t < 500) return recentCreate.band;
    return -1;
}
function makeBellAt(i, g, x, y) {
    placeBand(i, 6, x, y, g);
    bands[i].q = EQP_Q_DEFAULT;
    emitBand(i);
    updateCoeffBuffer();
}

function decodeRange(v) {
    var n = Number(v);
    if (n === 10 || n === 20 || n === 30) {
        for (var i = 0; i < EQP_RANGES.length; i++) if (EQP_RANGES[i] === n) return i;
    }
    if (typeof v === "string") {
        if (v.indexOf("30") >= 0) return 2;
        if (v.indexOf("20") >= 0) return 1;
        if (v.indexOf("10") >= 0) return 0;
    }
    return clamp(Math.round(finite(n, 0)), 0, EQP_RANGES.length - 1);
}
function decodeName(list, v) {
    if (typeof v === "string") {
        for (var i = 0; i < list.length; i++) if (String(list[i]).toLowerCase() === v.toLowerCase()) return i;
    }
    return clamp(Math.round(finite(v, 0)), 0, list.length - 1);
}

function hoverTarget(g, x, y) {
    var L = uiLayout(g);
    if (hit(L.shift, x, y)) return "shift";
    if (hit(L.gain, x, y)) return "gain";
    for (var i = 0; i < L.range.length; i++) if (hit(L.range[i], x, y)) return "range" + i;
    if (hit(L.aq, x, y)) return "aq";
    if (hit(L.icon, x, y)) return "icon";
    if (!inspectorMode) {
        if (hit(L.pre, x, y)) return "pre";
        if (hit(L.post, x, y)) return "post";
        if (hit(L.res, x, y)) return "res";
        if (hit(L.speed, x, y)) return "speed";
    } else {
        for (var p = 0; p < L.pills.length; p++) if (hit(L.pills[p], x, y)) return "pill" + p;
        if (hit(L.power, x, y)) return "power";
        if (hit(L.mode, x, y)) return "mode";
        if (hit(L.freq, x, y)) return "freq";
        if (hit(L.bandGain, x, y)) return "bandgain";
        if (hit(L.q, x, y)) return "q";
        if (hit(L.tilt, x, y)) return "tilt";
    }
    if (insidePlot(g, x, y)) return "plot";
    return "";
}

function applyPopupItem(item) {
    var kind = popup.kind;
    var band = popup.band;
    popup = null;
    hoverPop = -1;
    discreteEdit(function () {
        if (kind === "res") {
            resIdx = item.value;
            emitParam("resolution", resIdx);
        } else if (kind === "speed") {
            speedIdx = item.value;
            emitParam("speed", speedIdx);
        } else if (kind === "tilt") {
            tiltIdx = item.value;
            emitParam("tilt", tiltIdx);
        } else if (kind === "bandmode") {
            setBandMode(band, item.value);
        }
    });
}

function onclick(x, y, but, cmd, shift, capslock, option, ctrl) {
    if (gesture.kind) finishGesture();
    var g = geo();
    var right = (but === 2) || !!ctrl;
    gesture.fine = !!shift;
    var pi = hitPopup(x, y);
    if (popup) {
        if (pi >= 0) {
            applyPopupItem(popup.rects[pi].item);
            return;
        }
        var was = popup.kind;
        closePopup();
        var key0 = hoverTarget(g, x, y);
        var same = (was === "res" && key0 === "res") || (was === "speed" && key0 === "speed")
            || (was === "tilt" && key0 === "tilt") || (was === "bandmode" && key0 === "mode");
        if (same || popupContains(x, y)) return;
    }
    var L = uiLayout(g);
    if (hit(L.shift, x, y)) {
        gesture.kind = "shift";
        gesture.y0 = y;
        gesture.shift0 = shiftSt;
        return;
    }
    if (hit(L.gain, x, y)) {
        gesture.kind = "gain";
        gesture.y0 = y;
        gesture.gain0 = outGainDb;
        return;
    }
    for (var ri = 0; ri < L.range.length; ri++) {
        if (hit(L.range[ri], x, y)) {
            if (rangeIdx !== ri) {
                discreteEdit(function () {
                    rangeIdx = ri;
                    emitParam("range", rangeIdx);
                });
            }
            return;
        }
    }
    if (hit(L.aq, x, y)) {
        discreteEdit(function () {
            adaptiveQ = adaptiveQ ? 0 : 1;
            emitParam("adaptiveq", adaptiveQ);
            updateCoeffBuffer();
        });
        return;
    }
    if (hit(L.icon, x, y)) {
        if (inspectorMode) inspectorMode = 0;
        else enterInspector(-1);
        mgraphics.redraw();
        return;
    }
    if (!inspectorMode) {
        if (hit(L.pre, x, y)) {
            discreteEdit(function () {
                analyzerPre = analyzerPre ? 0 : 1;
                emitParam("pre", analyzerPre);
            });
            return;
        }
        if (hit(L.post, x, y)) {
            discreteEdit(function () {
                analyzerPost = analyzerPost ? 0 : 1;
                emitParam("post", analyzerPost);
            });
            return;
        }
        if (hit(L.res, x, y)) {
            if (right) {
                discreteEdit(function () {
                    resIdx = (resIdx + 1) % EQP_RESOLUTIONS.length;
                    emitParam("resolution", resIdx);
                });
            } else {
                openPopup("res", L.res, itemsFrom(EQP_RESOLUTIONS), resIdx, -1);
            }
            return;
        }
        if (hit(L.speed, x, y)) {
            if (right) {
                discreteEdit(function () {
                    speedIdx = (speedIdx + 1) % EQP_SPEEDS.length;
                    emitParam("speed", speedIdx);
                });
            } else {
                openPopup("speed", L.speed, itemsFrom(EQP_SPEEDS), speedIdx, -1);
            }
            return;
        }
    } else {
        for (var p = 0; p < L.pills.length; p++) {
            if (hit(L.pills[p], x, y)) {
                selectedBand = p;
                mgraphics.redraw();
                return;
            }
        }
        var sb = selectedBand;
        if (sb < 0 && (hit(L.power, x, y) || hit(L.mode, x, y) || hit(L.freq, x, y) || hit(L.bandGain, x, y) || hit(L.q, x, y))) {
            sb = firstActive();
            if (sb < 0) sb = 0;
            selectedBand = sb;
        }
        if (sb >= 0 && hit(L.power, x, y)) {
            discreteEdit(function () {
                var b = bands[sb];
                if (bandLive(b)) {
                    b.enabled = 0;
                } else {
                    b.enabled = 1;
                    if (b.mode === 0) b.mode = 6;
                }
                emitBand(sb);
                updateCoeffBuffer();
            });
            return;
        }
        if (sb >= 0 && hit(L.mode, x, y)) {
            if (right) {
                discreteEdit(function () { cycleBandMode(sb, 1); });
            } else {
                openPopup("bandmode", L.mode, modeItems(), bands[sb].mode, sb);
            }
            return;
        }
        if (sb >= 0 && hit(L.freq, x, y)) {
            gesture.kind = "freq";
            gesture.band = sb;
            gesture.y0 = y;
            gesture.freq0 = bands[sb].freq;
            return;
        }
        if (sb >= 0 && hit(L.bandGain, x, y)) {
            gesture.kind = "bandgain";
            gesture.band = sb;
            gesture.y0 = y;
            gesture.bandGain0 = bands[sb].gain;
            return;
        }
        if (sb >= 0 && hit(L.q, x, y)) {
            gesture.kind = "qread";
            gesture.band = sb;
            gesture.y0 = y;
            gesture.q0 = bands[sb].q;
            return;
        }
        if (hit(L.tilt, x, y)) {
            if (right) {
                discreteEdit(function () {
                    tiltIdx = (tiltIdx + 1) % EQP_TILTS.length;
                    emitParam("tilt", tiltIdx);
                });
            } else {
                openPopup("tilt", L.tilt, tiltItems(), tiltIdx, -1);
            }
            return;
        }
    }
    if (!insidePlot(g, x, y)) return;
    var hb = hitBand(g, x, y);
    if (hb >= 0) {
        if (right) {
            enterInspector(hb);
            var pxy = bandXY(g, bands[hb]);
            openPopup("bandmode", { x: pxy.x - 8, y: pxy.y, w: 16, h: 16 }, modeItems(), bands[hb].mode, hb);
            mgraphics.redraw();
            return;
        }
        beginDragBand(hb, x, y, option);
        mgraphics.redraw();
        return;
    }
    beginCreate(g, x, y, option);
    mgraphics.redraw();
}

function ondrag(x, y, but, cmd, shift, capslock, option, ctrl) {
    var g = geo();
    gesture.fine = !!shift;
    if (but === 0) {
        finishGesture();
        return;
    }
    hoverX = x;
    hoverY = y;
    if (gesture.kind === "shift") dragShift(g, y);
    else if (gesture.kind === "gain") dragOutGain(g, y);
    else if (gesture.kind === "band") dragBand(g, x, y);
    else if (gesture.kind === "freq" || gesture.kind === "bandgain" || gesture.kind === "qread") dragReadout(g, y);
    else return;
    mgraphics.redraw();
}

function ondblclick(x, y, but, cmd, shift, capslock, option, ctrl) {
    var g = geo();
    var L = uiLayout(g);
    var created = recentBand();
    gesture.kind = "";
    if (hit(L.shift, x, y)) {
        if (Math.abs(shiftSt) > 0.0001) {
            if (!undoArmed) pushUndoState();
            shiftSt = 0;
            emitParam("shift", shiftSt);
            updateCoeffBuffer();
            if (typeof notifyclients === "function") notifyclients();
        }
        undoArmed = false;
        gesture.dirty = false;
        mgraphics.redraw();
        return;
    }
    if (hit(L.gain, x, y)) {
        if (Math.abs(outGainDb) > 0.0001) {
            if (!undoArmed) pushUndoState();
            outGainDb = 0;
            emitParam("gain", outGainDb);
            emitOutGain();
            if (typeof notifyclients === "function") notifyclients();
        }
        undoArmed = false;
        gesture.dirty = false;
        mgraphics.redraw();
        return;
    }
    if (inspectorMode && selectedBand >= 0) {
        var sb = selectedBand;
        if (hit(L.freq, x, y) || hit(L.bandGain, x, y) || hit(L.q, x, y)) {
            discreteEdit(function () {
                var b = bands[sb];
                if (hit(L.freq, x, y)) b.freq = EQP_DEFAULT_BAND_FREQS[sb];
                if (hit(L.bandGain, x, y)) b.gain = 0;
                if (hit(L.q, x, y)) b.q = EQP_Q_DEFAULT;
                emitBand(sb);
                updateCoeffBuffer();
            });
            undoArmed = false;
            return;
        }
    }
    if (!insidePlot(g, x, y)) {
        undoArmed = false;
        return;
    }
    var hb = hitBand(g, x, y);
    if (hb >= 0 && hb === created) {
        makeBellAt(hb, g, x, y);
        if (typeof notifyclients === "function") notifyclients();
        undoArmed = false;
        gesture.dirty = false;
        mgraphics.redraw();
        return;
    }
    if (hb >= 0) {
        if (!undoArmed) pushUndoState();
        deactivateBand(hb);
        if (typeof notifyclients === "function") notifyclients();
        undoArmed = false;
        gesture.dirty = false;
        mgraphics.redraw();
        return;
    }
    if (created >= 0) {
        var cp = bandXY(g, bands[created]);
        var nearNew = Math.abs(cp.x - x) <= 24 * g.sx && Math.abs(cp.y - y) <= 24 * g.sy;
        if (nearNew) {
            makeBellAt(created, g, x, y);
            if (typeof notifyclients === "function") notifyclients();
            undoArmed = false;
            gesture.dirty = false;
            mgraphics.redraw();
            return;
        }
    }
    if (nearCurve(g, x, y)) {
        undoArmed = false;
        return;
    }
    var idx = firstInactive();
    if (idx < 0) {
        undoArmed = false;
        return;
    }
    if (!undoArmed) pushUndoState();
    makeBellAt(idx, g, x, y);
    recentCreate.band = idx;
    recentCreate.t = Date.now();
    if (typeof notifyclients === "function") notifyclients();
    undoArmed = false;
    gesture.dirty = false;
    mgraphics.redraw();
}

function onwheel(x, y, inc_x, inc_y) {
    var dy = wheelDy(arguments);
    if (!dy) return;
    if (popup) closePopup();
    var g = geo();
    var L = uiLayout(g);
    if (inspectorMode && selectedBand >= 0 && hit(L.q, x, y)) {
        adjustQ(selectedBand, dy);
        return;
    }
    if (!insidePlot(g, x, y)) return;
    var hb = hitBand(g, x, y);
    if (hb < 0) {
        var r = 16 * Math.min(g.sx, g.sy);
        var best = -1, bestD = r * r;
        for (var i = 0; i < bands.length; i++) {
            if (!bandLive(bands[i])) continue;
            var p = bandXY(g, bands[i]);
            var d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
            if (d <= bestD) { bestD = d; best = i; }
        }
        hb = best;
    }
    if (hb >= 0) adjustQ(hb, dy);
}

function onidle(x, y) {
    pointerIn = true;
    hoverX = x;
    hoverY = y;
    var g = geo();
    var key = hoverTarget(g, x, y);
    var band = insidePlot(g, x, y) ? hitBand(g, x, y) : -1;
    var pop = hitPopup(x, y);
    if (key !== hoverKey || band !== hoverBand || pop !== hoverPop) {
        hoverKey = key;
        hoverBand = band;
        hoverPop = pop;
        mgraphics.redraw();
    }
}
function onidleout() {
    pointerIn = false;
    if (hoverKey || hoverBand >= 0 || hoverPop >= 0) {
        hoverKey = "";
        hoverBand = -1;
        hoverPop = -1;
        mgraphics.redraw();
    }
}
function onresize() { mgraphics.redraw(); }

// ---------------------------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------------------------

function paintGrid(g) {
    var majors = [[20, "20"], [100, "100"], [1000, "1k"], [10000, "10k"]];
    var minors = [30, 40, 50, 60, 70, 80, 90];
    var d;
    for (d = 2; d <= 9; d++) minors.push(100 * d);
    for (d = 2; d <= 9; d++) minors.push(1000 * d);
    minors.push(20000);
    mgraphics.set_line_width(1);
    setRgb([1, 1, 1], 0.035);
    for (var m = 0; m < minors.length; m++) {
        var x = freqToX(g, minors[m]);
        mgraphics.move_to(x, g.plotY);
        mgraphics.line_to(x, g.plotY + g.plotH);
        mgraphics.stroke();
    }
    setRgb([1, 1, 1], 0.08);
    for (var a = 0; a < majors.length; a++) {
        var mx = freqToX(g, majors[a][0]);
        mgraphics.move_to(mx, g.plotY);
        mgraphics.line_to(mx, g.plotY + g.plotH);
        mgraphics.stroke();
    }
    var zy = zeroY(g);
    var mid = g.plotY + g.plotH * 0.5;
    setRgb([1, 1, 1], 0.05);
    mgraphics.move_to(g.plotX, g.plotY + g.plotH * 0.25);
    mgraphics.line_to(g.plotX + g.plotW, g.plotY + g.plotH * 0.25);
    mgraphics.stroke();
    mgraphics.move_to(g.plotX, g.plotY + g.plotH * 0.75);
    mgraphics.line_to(g.plotX + g.plotW, g.plotY + g.plotH * 0.75);
    mgraphics.stroke();
    setRgb([1, 1, 1], 0.20);
    mgraphics.move_to(g.plotX, zy);
    mgraphics.line_to(g.plotX + g.plotW, zy);
    mgraphics.stroke();
    if (Math.abs(zy - mid) > 1.5) {
        setRgb([1, 1, 1], 0.06);
        mgraphics.move_to(g.plotX, mid);
        mgraphics.line_to(g.plotX + g.plotW, mid);
        mgraphics.stroke();
    }
    var labelSize = fs(g, 8.5);
    var labelY = g.plotY + 11 * g.sy;
    for (var t = 0; t < majors.length; t++) {
        var lx = freqToX(g, majors[t][0]) + 3 * g.sx;
        drawText(majors[t][1], lx, labelY, labelSize, COL_AXIS, "left", false);
    }
    var rd = rangeDb();
    var rx = g.plotX + g.plotW - 4 * g.sx;
    drawText("+" + rd, rx, g.plotY + 10 * g.sy, labelSize, COL_AXIS, "right", false);
    drawText("-" + rd, rx, g.plotY + g.plotH - 4 * g.sy, labelSize, COL_AXIS, "right", false);
}

function paintSpectrum(g) {
    if (!specHasSignal) return;
    if (!analyzerPre && !analyzerPost) return;
    function traceTop(series) {
        var started = false;
        for (var i = 0; i < COLS; i++) {
            var x = freqToX(g, colFreq(i));
            var y = specY(g, series[i]);
            if (!started) { mgraphics.move_to(x, y); started = true; }
            else mgraphics.line_to(x, y);
        }
    }
    if (analyzerPre) {
        mgraphics.move_to(freqToX(g, colFreq(0)), g.plotY + g.plotH);
        for (var i = 0; i < COLS; i++) {
            mgraphics.line_to(freqToX(g, colFreq(i)), specY(g, specPre[i]));
        }
        mgraphics.line_to(freqToX(g, colFreq(COLS - 1)), g.plotY + g.plotH);
        mgraphics.close_path();
        mgraphics.set_source_rgba(155 / 255, 165 / 255, 180 / 255, 0.16);
        mgraphics.fill();
        traceTop(specPre);
        mgraphics.set_source_rgba(185 / 255, 195 / 255, 210 / 255, 0.35);
        mgraphics.set_line_width(1);
        mgraphics.stroke();
    }
    if (analyzerPost) {
        traceTop(specPost);
        mgraphics.set_source_rgba(215 / 255, 225 / 255, 240 / 255, 0.62);
        mgraphics.set_line_width(1.25);
        mgraphics.stroke();
    }
}

function sampleCurve() {
    var ys = new Array(COLS);
    var xs = new Array(COLS);
    var g = lastGeo;
    for (var i = 0; i < COLS; i++) {
        var f = colFreq(i);
        xs[i] = freqToX(g, f);
        ys[i] = eqY(g, responseDb(f));
    }
    return { xs: xs, ys: ys };
}

function paintCurve(g) {
    var c = sampleCurve();
    var focus = hoverBand >= 0 ? hoverBand : (gesture.kind === "band" ? gesture.band : selectedBand);
    var showFill = anyLive() || hoverBand >= 0;
    var z = zeroY(g);
    if (showFill) {
        for (var i = 0; i < COLS - 1; i++) {
            var nx = (i + 0.5) / (COLS - 1);
            var col = rainbow(nx);
            mgraphics.move_to(c.xs[i], c.ys[i]);
            mgraphics.line_to(c.xs[i + 1], c.ys[i + 1]);
            mgraphics.line_to(c.xs[i + 1], z);
            mgraphics.line_to(c.xs[i], z);
            mgraphics.close_path();
            mgraphics.set_source_rgba(col[0], col[1], col[2], 0.14);
            mgraphics.fill();
        }
    }
    if (focus >= 0 && focus < bands.length && (bandLive(bands[focus]) || focus === hoverBand)) {
        var b = bands[focus];
        if (bandLive(b)) {
            var colB = rainbow(eqpFreqToNorm(toScreenFreq(b.freq)));
            var started = false;
            for (var k = 0; k < COLS; k++) {
                var x = c.xs[k];
                var y = eqY(g, bandDb(b, colFreq(k)));
                if (!started) { mgraphics.move_to(x, y); started = true; }
                else mgraphics.line_to(x, y);
            }
            mgraphics.set_source_rgba(colB[0], colB[1], colB[2], 0.38);
            mgraphics.set_line_width(1.5);
            mgraphics.stroke();
        }
    }
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("round");
    if (mgraphics.set_line_join) mgraphics.set_line_join("round");
    // ~70 colored segments across the 140-column sample (two columns per stroke).
    mgraphics.set_line_width(4);
    for (var s = 0; s < COLS - 1; s += 2) {
        var j = Math.min(COLS - 1, s + 2);
        var colG = rainbow((s + 0.5) / (COLS - 1));
        mgraphics.move_to(c.xs[s], c.ys[s]);
        mgraphics.line_to(c.xs[j], c.ys[j]);
        mgraphics.set_source_rgba(colG[0], colG[1], colG[2], 0.22);
        mgraphics.stroke();
    }
    mgraphics.set_line_width(2);
    for (var s2 = 0; s2 < COLS - 1; s2 += 2) {
        var j2 = Math.min(COLS - 1, s2 + 2);
        var colC = rainbow((s2 + 0.5) / (COLS - 1));
        mgraphics.move_to(c.xs[s2], c.ys[s2]);
        mgraphics.line_to(c.xs[j2], c.ys[j2]);
        mgraphics.set_source_rgba(colC[0], colC[1], colC[2], 1);
        mgraphics.stroke();
    }
}

function paintHandles(g) {
    var r = 7.5 * Math.min(g.sx, g.sy);
    var order = [];
    for (var i = 0; i < bands.length; i++) if (bandLive(bands[i])) order.push(i);
    order.sort(function (a, b) {
        var as = (a === selectedBand) ? 1 : 0;
        var bs = (b === selectedBand) ? 1 : 0;
        return as - bs;
    });
    for (var n = 0; n < order.length; n++) {
        var idx = order[n];
        var p = bandXY(g, bands[idx]);
        var col = rainbow(eqpFreqToNorm(toScreenFreq(bands[idx].freq)));
        var sel = idx === selectedBand;
        var hov = idx === hoverBand;
        if (sel || hov) {
            var ring = sel ? COL_ORANGE : COL_WHITE;
            mgraphics.ellipse(p.x - r - 1.6, p.y - r - 1.6, (r + 1.6) * 2, (r + 1.6) * 2);
            setRgb(ring, sel ? 1 : 0.9);
            mgraphics.set_line_width(1.6);
            mgraphics.stroke();
        }
        mgraphics.ellipse(p.x - r, p.y - r, r * 2, r * 2);
        setRgb(col, 1);
        mgraphics.fill();
        mgraphics.ellipse(p.x - r, p.y - r, r * 2, r * 2);
        mgraphics.set_source_rgba(0, 0, 0, 0.35);
        mgraphics.set_line_width(1);
        mgraphics.stroke();
        var ink = lum(col) > 0.62 ? [0.08, 0.08, 0.08, 1] : [1, 1, 1, 0.96];
        drawText(String(idx + 1), p.x, p.y + fs(g, 3.1), fs(g, 8), ink, "center", true);
    }
}

function paintGhost(g) {
    if (!pointerIn || gesture.kind || popup) return;
    if (!insidePlot(g, hoverX, hoverY) || hoverBand >= 0) return;
    var nx = xToNorm(g, hoverX);
    var ny = yToNorm(g, hoverY);
    var mode = resolveGestureMode(nx, ny, curveNormAt(nx));
    var col = rainbow(nx);
    var r = 7 * Math.min(g.sx, g.sy);
    mgraphics.ellipse(hoverX - r, hoverY - r, r * 2, r * 2);
    mgraphics.set_source_rgba(col[0], col[1], col[2], 0.16);
    mgraphics.fill();
    mgraphics.ellipse(hoverX - r, hoverY - r, r * 2, r * 2);
    mgraphics.set_source_rgba(col[0], col[1], col[2], 0.7);
    mgraphics.set_line_width(1.25);
    mgraphics.stroke();
    var label = hintForMode(mode);
    var tx = hoverX + r + 5 * g.sx;
    var ty = hoverY + fs(g, 3);
    if (tx + textW(label, fs(g, 8), false) > g.plotX + g.plotW - 4) tx = hoverX - r - 5 * g.sx - textW(label, fs(g, 8), false);
    drawText(label, tx, ty, fs(g, 8), [0.78, 0.78, 0.78, 0.9], "left", false);
}

function hudText(i) {
    var b = bands[i];
    var parts = ["Band " + (i + 1), modeName(b.mode), fmtFreq(toScreenFreq(b.freq))];
    if (usesGain(b.mode)) parts.push(fmtSignedDb(b.gain));
    parts.push(fmtQ(b.q));
    return parts.join(" · ");
}
function paintHud(g) {
    var i = -1;
    if (gesture.kind === "band" || gesture.kind === "freq" || gesture.kind === "bandgain" || gesture.kind === "qread") i = gesture.band;
    else if (hoverBand >= 0) i = hoverBand;
    if (i < 0 || !bands[i] || (!bandLive(bands[i]) && gesture.band !== i)) return;
    if (!bandLive(bands[i])) return;
    var label = hudText(i);
    var size = fs(g, 8.5);
    var tw = textW(label, size, false);
    var pad = 6 * g.sx;
    var w = tw + pad * 2;
    var h = 15 * g.sy;
    var p = bandXY(g, bands[i]);
    var x = p.x - w * 0.5;
    var y = p.y - 7.5 * g.sy - h - 6 * g.sy;
    if (y < g.plotY + 2) y = p.y + 7.5 * g.sy + 6 * g.sy;
    if (x < g.plotX + 2) x = g.plotX + 2;
    if (x + w > g.plotX + g.plotW - 2) x = g.plotX + g.plotW - 2 - w;
    fillRound(x, y, w, h, 3 * g.sx, [0.08, 0.08, 0.08], 0.92);
    rrect(x, y, w, h, 3 * g.sx);
    mgraphics.set_source_rgba(1, 1, 1, 0.12);
    mgraphics.set_line_width(1);
    mgraphics.stroke();
    drawText(label, x + pad, y + h - 4 * g.sy, size, [0.93, 0.93, 0.93, 1], "left", false);
}

function drawBellIcon(r, on) {
    var c = on ? COL_ORANGE : COL_AQ_OFF;
    var x = r.x + 2 * (r.w / 30);
    var y = r.y + 2 * (r.h / 17);
    var w = r.w - 4 * (r.w / 30);
    var h = r.h - 4 * (r.h / 17);
    var bw = w * 0.62;
    setRgb(c, 1);
    mgraphics.set_line_width(Math.max(1, r.h / 14));
    var steps = 8;
    for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        var gx = x + t * bw;
        var z = (t - 0.5) * 2.6;
        var bell = Math.exp(-z * z * 1.15);
        var gy = y + h - 1 - bell * (h - 2);
        if (i === 0) mgraphics.move_to(gx, gy);
        else mgraphics.line_to(gx, gy);
    }
    mgraphics.stroke();
    var cx = x + w - 2;
    var top = y + 1;
    var bot = y + h - 1;
    mgraphics.move_to(cx, top + 2.2);
    mgraphics.line_to(cx, bot - 2.2);
    mgraphics.stroke();
    mgraphics.move_to(cx - 2.3, top + 3.4);
    mgraphics.line_to(cx, top);
    mgraphics.line_to(cx + 2.3, top + 3.4);
    mgraphics.stroke();
    mgraphics.move_to(cx - 2.3, bot - 3.4);
    mgraphics.line_to(cx, bot);
    mgraphics.line_to(cx + 2.3, bot - 3.4);
    mgraphics.stroke();
}
function drawSpecIcon(r) {
    var bars = [0.42, 0.78, 0.55, 1];
    var bw = Math.max(1.4, 2 * (r.w / 28));
    var gap = Math.max(1, 1.6 * (r.w / 28));
    var x0 = r.x + 3 * (r.w / 28);
    var base = r.y + r.h - 4 * (r.h / 17);
    var maxH = r.h - 8 * (r.h / 17);
    setRgb([0.82, 0.82, 0.82], 1);
    for (var i = 0; i < bars.length; i++) {
        var bh = Math.max(1, maxH * bars[i]);
        mgraphics.rectangle(x0 + i * (bw + gap), base - bh, bw, bh);
        mgraphics.fill();
    }
    caret(r.x + r.w - 9 * (r.w / 28), r.y + r.h * 0.58, Math.max(4, 5 * (r.w / 28)), [0.82, 0.82, 0.82, 1]);
}
function drawPower(r, on) {
    var c = on ? COL_ORANGE : [0.45, 0.45, 0.45, 1];
    var cx = r.x + r.w * 0.5;
    var cy = r.y + r.h * 0.52;
    var rad = Math.min(r.w, r.h) * 0.32;
    setRgb(c, 1);
    mgraphics.set_line_width(Math.max(1, rad * 0.38));
    mgraphics.arc(cx, cy + rad * 0.15, rad, Math.PI * 0.72, Math.PI * 2.28);
    mgraphics.stroke();
    mgraphics.move_to(cx, cy - rad * 0.95);
    mgraphics.line_to(cx, cy + rad * 0.15);
    mgraphics.stroke();
}
function drawDropdown(r, label, g) {
    var rad = 2.5 * Math.min(g.sx, g.sy);
    fillRound(r.x, r.y, r.w, r.h, rad, COL_DROP, 1);
    rrect(r.x, r.y, r.w, r.h, rad);
    setRgb(COL_DROP_EDGE, 1);
    mgraphics.set_line_width(1);
    mgraphics.stroke();
    var size = fs(g, 9);
    var maxW = r.w - 14 * g.sx;
    while (size > fs(g, 7) + 0.1 && textW(label, size, false) > maxW) size -= 0.5;
    drawText(label, r.x + 4 * g.sx, r.y + r.h - 4 * g.sy, size, COL_WHITE, "left", false);
    caret(r.x + r.w - 9 * g.sx, r.y + r.h * 0.58, 5 * g.sx, COL_CARET);
}
function drawPillButton(r, label, on, g) {
    var rad = 2.5 * Math.min(g.sx, g.sy);
    fillRound(r.x, r.y, r.w, r.h, rad, on ? COL_ORANGE : COL_BTN, 1);
    drawText(label, r.x + r.w * 0.5, r.y + r.h - 4 * g.sy, fs(g, 9), on ? COL_BTN_ON_TEXT : COL_BTN_TEXT, "center", false);
}

function paintTop(g) {
    var L = uiLayout(g);
    var size = fs(g, 10);
    var base = 16 * g.sy;
    var val = hoverKey === "shift" || gesture.kind === "shift" ? [1, 0.68, 0.25, 1] : COL_ORANGE;
    drawText("Shift", 10 * g.sx, base, size, COL_LABEL, "left", false);
    drawText(fmtSt(shiftSt), 44 * g.sx, base, size, val, "left", true);
    var gv = hoverKey === "gain" || gesture.kind === "gain" ? [1, 0.68, 0.25, 1] : COL_ORANGE;
    drawText("Gain", 98 * g.sx, base, size, COL_LABEL, "left", false);
    drawText(fmtOut(outGainDb), 130 * g.sx, base, size, gv, "left", true);
    drawText("Range", 178 * g.sx, base, size, COL_LABEL, "left", false);
    for (var i = 0; i < 3; i++) {
        var r = L.range[i];
        var on = rangeIdx === i;
        var label = "±" + EQP_RANGES[i];
        var col = on ? COL_WHITE : (hoverKey === "range" + i ? [0.78, 0.78, 0.78, 1] : COL_DIM);
        drawText(label, r.x + r.w * 0.5, r.y + r.h - 3 * g.sy, size, col, "center", on);
        if (on) {
            var tw = textW(label, size, true);
            mgraphics.rectangle(r.x + (r.w - tw) * 0.5, r.y + r.h - 1.5 * g.sy, tw, 2 * g.sy);
            setRgb(COL_ORANGE, 1);
            mgraphics.fill();
        }
    }
    drawBellIcon(L.aq, adaptiveQ === 1);
}

function paintBottom(g) {
    var L = uiLayout(g);
    var base = 153 * g.sy;
    var size = fs(g, 9);
    if (inspectorMode && selectedBand >= 0) {
        drawText("B" + (selectedBand + 1), L.icon.x + L.icon.w * 0.5, L.icon.y + L.icon.h - 4 * g.sy, fs(g, 9), COL_ORANGE, "center", true);
    } else {
        drawSpecIcon(L.icon);
    }
    if (!inspectorMode) {
        drawText("Analyzer", 50 * g.sx, base, fs(g, 8), COL_LABEL, "left", false);
        drawPillButton(L.pre, "Pre", analyzerPre === 1, g);
        drawPillButton(L.post, "Post", analyzerPost === 1, g);
        drawText("Resolution", 166 * g.sx, base, fs(g, 8), COL_LABEL, "left", false);
        drawDropdown(L.res, EQP_RESOLUTIONS[resIdx] || "Huge", g);
        drawText("Speed", 271 * g.sx, base, size, COL_LABEL, "left", false);
        drawDropdown(L.speed, EQP_SPEEDS[speedIdx] || "Fast", g);
        return;
    }
    for (var i = 0; i < L.pills.length; i++) {
        var pill = L.pills[i];
        var on = i === selectedBand;
        var live = bandLive(bands[i]);
        var bg = on ? COL_ORANGE : (live ? [0.23, 0.23, 0.23, 1] : [0.16, 0.16, 0.16, 1]);
        fillRound(pill.x, pill.y, pill.w, pill.h, 2 * g.sx, bg, 1);
        var fg = on ? COL_INK : (live ? COL_WHITE : COL_DIM);
        drawText(String(i + 1), pill.x + pill.w * 0.5, pill.y + pill.h - 4 * g.sy, fs(g, 8), fg, "center", true);
        if (live && !on) {
            var rc = rainbow(eqpFreqToNorm(toScreenFreq(bands[i].freq)));
            mgraphics.rectangle(pill.x + 2, pill.y + pill.h - 2 * g.sy, pill.w - 4, 1.5 * g.sy);
            setRgb(rc, 0.9);
            mgraphics.fill();
        }
    }
    var sb = selectedBand;
    if (sb < 0) sb = 0;
    var b = bands[sb];
    drawPower(L.power, bandLive(b));
    drawDropdown(L.mode, MODE_SHORT[b.mode] || "Off", g);
    var fcol = (hoverKey === "freq" || gesture.kind === "freq") ? [1, 0.72, 0.3, 1] : COL_ORANGE;
    var gcol = (hoverKey === "bandgain" || gesture.kind === "bandgain") ? [1, 0.72, 0.3, 1] : COL_ORANGE;
    var qcol = (hoverKey === "q" || gesture.kind === "qread") ? [1, 0.72, 0.3, 1] : COL_ORANGE;
    drawText(fmtFreqShort(b.freq), L.freq.x + L.freq.w * 0.5, L.freq.y + L.freq.h - 4 * g.sy, fs(g, 8), fcol, "center", true);
    var gtxt = usesGain(b.mode) ? (Math.abs(b.gain) < 0.05 ? "0.0" : ((b.gain > 0 ? "+" : "") + b.gain.toFixed(1))) : "—";
    drawText(gtxt, L.bandGain.x + L.bandGain.w * 0.5, L.bandGain.y + L.bandGain.h - 4 * g.sy, fs(g, 8), usesGain(b.mode) ? gcol : COL_DIM, "center", true);
    drawText(b.q >= 10 ? b.q.toFixed(1) : b.q.toFixed(2), L.q.x + L.q.w * 0.5, L.q.y + L.q.h - 4 * g.sy, fs(g, 8), qcol, "center", true);
    var tv = EQP_TILTS[tiltIdx];
    drawDropdown(L.tilt, (tv === 0 ? "0 dB" : tv.toFixed(1) + " dB"), g);
}

function paintPopup(g) {
    if (!popup) return;
    fillRound(popup.x, popup.y, popup.w, popup.h, 4 * g.sx, [0.12, 0.12, 0.12, 0.98], 1);
    rrect(popup.x, popup.y, popup.w, popup.h, 4 * g.sx);
    mgraphics.set_source_rgba(1, 1, 1, 0.14);
    mgraphics.set_line_width(1);
    mgraphics.stroke();
    for (var i = 0; i < popup.rects.length; i++) {
        var r = popup.rects[i];
        var sel = popup.selected === r.item.value;
        if (i === hoverPop) {
            fillRound(r.x, r.y, r.w, r.h, 2, [1, 1, 1], 0.06);
        }
        var col = sel ? COL_ORANGE : [0.88, 0.88, 0.88, 1];
        drawText(r.item.label, r.x + 4 * g.sx, r.y + r.h - 3 * g.sy, fs(g, 8.5), col, "left", sel);
    }
}

function paintDsp(g) {
    if (!eqpDsp.started || eqpDsp.ready) return;
    var msg = eqpDsp.error ? ("DSP failed: " + eqpDsp.error) : "DSP loading…";
    var col = eqpDsp.error ? [0.95, 0.42, 0.32, 1] : COL_ORANGE;
    drawText(msg, g.plotX + 6 * g.sx, g.plotY + g.plotH - 6 * g.sy, fs(g, 8), col, "left", false);
}

function paint() {
    try {
        var g = geo();
        setRgb(COL_CHROME, 1);
        mgraphics.rectangle(0, 0, g.w, g.h);
        mgraphics.fill();
        setRgb(COL_PLOT, 1);
        mgraphics.rectangle(g.plotX, g.plotY, g.plotW, g.plotH);
        mgraphics.fill();
        paintGrid(g);
        paintSpectrum(g);
        paintCurve(g);
        paintHandles(g);
        paintGhost(g);
        setRgb(COL_CHROME, 1);
        mgraphics.rectangle(0, 0, g.w, g.plotY);
        mgraphics.fill();
        mgraphics.rectangle(0, g.plotY + g.plotH, g.w, g.h - (g.plotY + g.plotH));
        mgraphics.fill();
        if (g.plotX > 0.5) {
            mgraphics.rectangle(0, 0, g.plotX, g.h);
            mgraphics.fill();
            mgraphics.rectangle(g.plotX + g.plotW, 0, g.w - g.plotX - g.plotW, g.h);
            mgraphics.fill();
        }
        paintTop(g);
        paintBottom(g);
        paintHud(g);
        paintDsp(g);
        rrect(0.5, 0.5, g.w - 1, g.h - 1, 5 * Math.min(g.sx, g.sy));
        setRgb(COL_BEZEL, 1);
        mgraphics.set_line_width(1);
        mgraphics.stroke();
        paintPopup(g);
    } catch (err) {
        post("EQ+: paint " + err + "\n");
    }
}

// ---------------------------------------------------------------------------------------------
// Inlet messages (automation echo and buffer / rate binding)
// ---------------------------------------------------------------------------------------------

function set_shift(v) {
    if (gesture.kind === "shift") return;
    var n = clamp(roundTo(finite(v, shiftSt), 0.01), -36, 36);
    if (n === shiftSt) return;
    shiftSt = n;
    updateCoeffBuffer();
    mgraphics.redraw();
}
function set_gain(v) {
    if (gesture.kind === "gain") return;
    var n = clamp(roundTo(finite(v, outGainDb), 0.1), -24, 24);
    if (n === outGainDb) return;
    outGainDb = n;
    emitOutGain();
    mgraphics.redraw();
}
function set_outgain(v) { set_gain(v); }
function set_range(v) {
    var n = decodeRange(v);
    if (n === rangeIdx) return;
    rangeIdx = n;
    mgraphics.redraw();
}
function set_adaptiveq(v) {
    var n = finite(v, adaptiveQ) > 0.5 ? 1 : 0;
    if (n === adaptiveQ) return;
    adaptiveQ = n;
    updateCoeffBuffer();
    mgraphics.redraw();
}
function set_pre(v) {
    analyzerPre = finite(v, analyzerPre) > 0.5 ? 1 : 0;
    mgraphics.redraw();
}
function set_post(v) {
    analyzerPost = finite(v, analyzerPost) > 0.5 ? 1 : 0;
    mgraphics.redraw();
}
function set_resolution(v) {
    resIdx = decodeName(EQP_RESOLUTIONS, v);
    mgraphics.redraw();
}
function set_speed(v) {
    speedIdx = decodeName(EQP_SPEEDS, v);
    mgraphics.redraw();
}
function set_tilt(v) {
    if (typeof v === "string") {
        var key = v.toLowerCase();
        for (var s = 0; s < EQP_TILTS.length; s++) {
            if (String(EQP_TILTS[s]) === v || key.indexOf(String(EQP_TILTS[s])) === 0) {
                tiltIdx = s;
                mgraphics.redraw();
                return;
            }
        }
    }
    var n = Number(v);
    if (n === Math.round(n) && n >= 0 && n < EQP_TILTS.length) tiltIdx = n;
    else {
        var best = 0, bd = 1e9;
        for (var i = 0; i < EQP_TILTS.length; i++) {
            var d = Math.abs(EQP_TILTS[i] - n);
            if (d < bd) { bd = d; best = i; }
        }
        tiltIdx = best;
    }
    mgraphics.redraw();
}
function set_rangemin(v) {
    rangeMinDb = clamp(finite(v, rangeMinDb), -144, -21);
    mgraphics.redraw();
}
function set_rangemax(v) {
    rangeMaxDb = clamp(finite(v, rangeMaxDb), -120, 30);
    mgraphics.redraw();
}
function set_band_enable(idx, v) {
    var i = Math.round(finite(idx, -1));
    if (i < 0 || i >= EQP_NUM_BANDS) return;
    if (gesture.band === i && gesture.kind) return;
    var b = bands[i];
    var n = finite(v, b.enabled) > 0.5 ? 1 : 0;
    if (n === (b.enabled ? 1 : 0)) return;
    b.enabled = n;
    updateCoeffBuffer();
    mgraphics.redraw();
}
function set_band_mode(idx, v) {
    var i = Math.round(finite(idx, -1));
    if (i < 0 || i >= EQP_NUM_BANDS) return;
    if (gesture.band === i && gesture.kind) return;
    var b = bands[i];
    var mode = clamp(Math.round(finite(v, b.mode)), 0, 12);
    if (mode === b.mode) return;
    b.mode = mode;
    if (b.enabled && !(b.q > 0)) b.q = EQP_Q_DEFAULT;
    updateCoeffBuffer();
    mgraphics.redraw();
}
function set_band_freq(idx, v) {
    var i = Math.round(finite(idx, -1));
    if (i < 0 || i >= EQP_NUM_BANDS) return;
    if (gesture.band === i && gesture.kind) return;
    var b = bands[i];
    var n = clamp(finite(v, b.freq), EQP_FREQ_MIN, EQP_FREQ_MAX);
    if (n === b.freq) return;
    b.freq = n;
    updateCoeffBuffer();
    mgraphics.redraw();
}
function set_band_gain(idx, v) {
    var i = Math.round(finite(idx, -1));
    if (i < 0 || i >= EQP_NUM_BANDS) return;
    if (gesture.band === i && gesture.kind) return;
    var b = bands[i];
    var n = clamp(finite(v, b.gain), EQP_GAIN_MIN, EQP_GAIN_MAX);
    if (n === b.gain) return;
    b.gain = n;
    updateCoeffBuffer();
    mgraphics.redraw();
}
function set_band_q(idx, v) {
    var i = Math.round(finite(idx, -1));
    if (i < 0 || i >= EQP_NUM_BANDS) return;
    if (gesture.band === i && gesture.kind) return;
    var b = bands[i];
    var n = clamp(finite(v, b.q), EQP_Q_MIN, EQP_Q_MAX);
    if (n === b.q) return;
    b.q = n;
    updateCoeffBuffer();
    mgraphics.redraw();
}
function set_band(i, en, mode, freq, gain, q) {
    i = Math.round(finite(i, -1));
    if (i < 0 || i >= EQP_NUM_BANDS) return;
    if (gesture.band === i && gesture.kind) return;
    var b = bands[i];
    if (en !== undefined) b.enabled = finite(en, b.enabled) > 0.5 ? 1 : 0;
    if (mode !== undefined) b.mode = clamp(Math.round(finite(mode, b.mode)), 0, 12);
    if (freq !== undefined) b.freq = clamp(finite(freq, b.freq), EQP_FREQ_MIN, EQP_FREQ_MAX);
    if (gain !== undefined) b.gain = clamp(finite(gain, b.gain), EQP_GAIN_MIN, EQP_GAIN_MAX);
    if (q !== undefined) b.q = clamp(finite(q, b.q), EQP_Q_MIN, EQP_Q_MAX);
    if (b.mode === 0) b.enabled = 0;
    updateCoeffBuffer();
    mgraphics.redraw();
}
function set_selected(i) {
    selectedBand = clamp(Math.round(finite(i, -1)), -1, EQP_NUM_BANDS - 1);
    mgraphics.redraw();
}
function sr(v) {
    var n = finite(v, currentSr);
    if (n < 8000 || n > 384000) return;
    if (Math.abs(n - currentSr) < 0.5) return;
    currentSr = n;
    updateCoeffBuffer();
    mgraphics.redraw();
}
function samplerate(v) { sr(v); }
function specbuf(name) {
    if (name) specBufName = String(name);
}
function cfgbuf(name) {
    if (!name) return;
    cfgBufName = String(name);
    updateCoeffBuffer();
}
function setbuffers(cfgName, specName) {
    if (cfgName) cfgBufName = String(cfgName);
    if (specName) specBufName = String(specName);
    updateCoeffBuffer();
}
function bang() { mgraphics.redraw(); }

function anything() {
    var name = messagename;
    var a0 = arguments.length ? arguments[0] : 0;
    if (name === "Shift") set_shift(a0);
    else if (name === "Gain" || name === "OutputGain") set_gain(a0);
    else if (name === "Range") set_range(a0);
    else if (name === "AdaptiveQ") set_adaptiveq(a0);
    else if (name === "AnalyzerPre") set_pre(a0);
    else if (name === "AnalyzerPost") set_post(a0);
    else if (name === "Resolution") set_resolution(a0);
    else if (name === "Speed") set_speed(a0);
    else if (name === "Tilt") set_tilt(a0);
    else if (name === "RangeMin") set_rangemin(a0);
    else if (name === "RangeMax") set_rangemax(a0);
    else if (name === "sr" || name === "samplerate") sr(a0);
    else if (name === "frametick") frametick(a0);
}

function loadbang() {
    updateCoeffBuffer();
    eqpDspResend();
    if (typeof Task === "function") {
        specTask = new Task(pullSpectrum, this);
        specTask.interval = 70;
        specTask.repeat();
    }
    mgraphics.redraw();
}

function resetPreviewChrome() {
    shiftSt = 0;
    outGainDb = 0;
    rangeIdx = 0;
    adaptiveQ = 1;
    analyzerPre = 1;
    analyzerPost = 1;
    resIdx = 3;
    speedIdx = 0;
    tiltIdx = 2;
    rangeMinDb = -100;
    rangeMaxDb = 0;
    inspectorMode = 0;
    selectedBand = -1;
    popup = null;
    gesture.kind = "";
    gesture.dirty = false;
    undoArmed = false;
    undoStack = [];
    redoStack = [];
    hoverKey = "";
    hoverBand = -1;
    hoverPop = -1;
    pointerIn = false;
    recentCreate.band = -1;
}
function preview() {
    resetPreviewChrome();
    resetBands();
    specHasSignal = 0;
    specHoldPreview = false;
    allocSpec();
    updateCoeffBuffer();
    mgraphics.redraw();
}
function preview_active() {
    resetPreviewChrome();
    resetBands();
    function arm(i, mode, freq, gain) {
        var b = bands[i];
        b.enabled = 1;
        b.mode = mode;
        b.freq = freq;
        b.gain = gain;
        b.q = EQP_Q_DEFAULT;
    }
    arm(0, 2, 38, 0);
    arm(1, 5, 110, 3.5);
    arm(3, 6, 650, -4.5);
    arm(5, 6, 3200, 5.5);
    arm(7, 8, 10000, 3);
    seedPreviewSpectrum();
    specHasSignal = 1;
    updateCoeffBuffer();
    mgraphics.redraw();
}
