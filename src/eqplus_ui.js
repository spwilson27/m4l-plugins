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
// #0-eqpluscfg ch 1: 8 bands * EQP_CFG_STRIDE
//   (sections, b0, b1, b2, a1, a2). Disabled / Off bands are all zeros.

// Live 12 default dark, the same measured values as spectral_theme.js. paint() refreshes these
// from max.getcolor so the face follows the user's Live theme.
var EQP_LIVE = {
    live_desktop: [0.165, 0.165, 0.165, 1],
    live_surface_bg: [0.212, 0.212, 0.212, 1],
    live_lcd_bg: [0.094, 0.094, 0.094, 1],
    live_lcd_frame: [0.243, 0.243, 0.243, 1],
    live_lcd_title: [0.71, 0.71, 0.71, 1],
    live_lcd_control_fg: [1, 0.678, 0.337, 1],
    live_lcd_control_fg_alt: [0.012, 0.765, 0.835, 1],
    live_display_line_one: [1, 0.678, 0.337, 1],
    live_display_line_two: [0.012, 0.765, 0.835, 1],
    live_display_handle_two: [1, 0.412, 0.498, 1],
    live_display_scale_text: [0.525, 0.525, 0.525, 1],
    live_control_bg: [0.118, 0.118, 0.118, 1],
    live_control_fg: [0.71, 0.71, 0.71, 1],
    live_control_selection: [1, 0.678, 0.337, 1],
    live_control_zombie: [0.459, 0.459, 0.459, 1],
    live_alert: [0.906, 0.412, 0.259, 1]
};
var COL_CHROME = EQP_LIVE.live_surface_bg;
var COL_BEZEL = EQP_LIVE.live_desktop;
var COL_PLOT = EQP_LIVE.live_lcd_bg;
var COL_LABEL = EQP_LIVE.live_lcd_title;
var COL_ORANGE = EQP_LIVE.live_control_selection;
var COL_VALUE = EQP_LIVE.live_lcd_control_fg;
var COL_CURVE = EQP_LIVE.live_display_line_one;
var COL_FOCUS = EQP_LIVE.live_lcd_control_fg_alt;
var COL_SPEC = EQP_LIVE.live_display_line_two;
var COL_REF = EQP_LIVE.live_display_handle_two;
var COL_DIM = EQP_LIVE.live_control_zombie;
var COL_AXIS = EQP_LIVE.live_display_scale_text;
var COL_GRID = EQP_LIVE.live_lcd_frame;
var COL_AQ_OFF = EQP_LIVE.live_control_zombie;
var COL_BTN = EQP_LIVE.live_control_bg;
var COL_BTN_TEXT = EQP_LIVE.live_control_fg;
var COL_BTN_ON_TEXT = EQP_LIVE.live_lcd_bg;
var COL_DROP = EQP_LIVE.live_control_bg;
var COL_DROP_EDGE = EQP_LIVE.live_lcd_frame;
var COL_CARET = EQP_LIVE.live_control_fg;
var COL_WHITE = EQP_LIVE.live_control_fg;
var COL_INK = EQP_LIVE.live_lcd_bg;
var COL_ALERT = EQP_LIVE.live_alert;

var MODE_NAMES = [
    "Off",
    "Low-Cut 1", "Low-Cut 2", "Low-Cut 4", "Low-Cut 8",
    "Low-Shelf", "Bell", "Notch", "High-Shelf",
    "High-Cut 1", "High-Cut 2", "High-Cut 4", "High-Cut 8"
];
var MODE_FACE = [
    "Off",
    "Low-cut 1\u1d56", "Low-cut 2\u1d56", "Low-cut 4\u1d56", "Low-cut 8\u1d56",
    "Low-shelf", "Bell", "Notch", "High-shelf",
    "High-cut 1\u1d56", "High-cut 2\u1d56", "High-cut 4\u1d56", "High-cut 8\u1d56"
];

var COLS = 140;
// One display column per plot pixel is not enough once a column covers
// several harmonics. 640 keeps the nulls between them out past a few kHz
// and leaves a real 1/n envelope, instead of a blob, on the rest of the band.
var SPEC_COLS = 640;
var EQP_STATE_VERSION = 1;
var HIT_R = 8.25;
var NODE_R = 5.25;
var QH_R = 4.875;
var QH_GAP = 13.5;

var cfgBufName = "#0-eqpluscfg";
var specBufName = "#0-eqplusspec";
var currentSr = 48000;

var shiftSt = 0;
var outGainDb = 0;
var tiltEqDb = 0;
var phaseMode = 0;
var irBufName = "#0-eqplusir";
var irSerial = 0;
var eqpReportedLatency = -1;
var rangeIdx = 0;
var adaptiveQ = 1;
var analyzerPre = 1;
var analyzerPost = 1;
var resIdx = 3;
var speedIdx = 0;
var tiltIdx = 2;
var rangeMinDb = -100;
var rangeMaxDb = 0;
var selectedBand = 0;
var bottomAnalyzer = 0;
var soloBand = -1;
var showFiltersShelf = 0;
var showAnalyzerShelf = 0;
var EQP_SC_TAB_W = 18;
var EQP_SIDECHAIN_FOLD_W = 128;
var showSidechainFold = 0;
var refEnabled = 0;
var refGainDb = 0;
var scRoutingName = "Ext. In";
var scChannelName = "1/2";
var inspectorMode = 0;
var selectedBands = [0];

// 0 Stereo (one curve on both channels), 1 Left, 2 Right, 3 Mid, 4 Side.
// Stereo keeps one curve. The other four edit one channel and leave the
// other curve where it was. bands always points at the curve on screen.
var EQP_ROUTES = ["Stereo", "Left", "Right", "Mid", "Side"];
var routeMode = 0;
var bandsA = [];
var bandsB = [];
var bands = bandsA;
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
var cursorHidden = false;
var currentHoverMode = 6;

var popup = null;
var lastGeo = null;

var specPre = [];
var specPost = [];
var specRef = [];
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
var specEdge = new Array(SPEC_COLS + 1);
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
    for (var s = 0; s <= SPEC_COLS; s++) specEdge[s] = Math.exp(a + (b - a) * (s / SPEC_COLS));
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
function copyBand(src, dst) {
    dst.enabled = src.enabled ? 1 : 0;
    dst.mode = src.mode;
    dst.freq = src.freq;
    dst.gain = src.gain;
    dst.q = src.q;
}
function copyBands(src, dst) {
    for (var i = 0; i < EQP_NUM_BANDS; i++) copyBand(src[i], dst[i]);
}
function routeEditsB(mode) { return mode === 2 || mode === 4; }
function routeLinked(mode) { return mode === 0; }
function routeSplit(mode) { return !routeLinked(mode); }
function resetBands() {
    bandsA = [];
    bandsB = [];
    for (var i = 0; i < EQP_NUM_BANDS; i++) {
        bandsA.push(makeBand(i));
        bandsB.push(makeBand(i));
    }
    bands = bandsA;
    routeMode = 0;
}
function focusRoute(n) {
    var was = routeMode;
    if (routeLinked(n)) {
        if (routeEditsB(was)) copyBands(bandsB, bandsA);
        bands = bandsA;
        routeMode = n;
        copyBands(bandsA, bandsB);
    } else {
        routeMode = n;
        bands = routeEditsB(n) ? bandsB : bandsA;
    }
}
function decodeRoute(v) {
    if (typeof v === "string") {
        for (var i = 0; i < EQP_ROUTES.length; i++) {
            if (EQP_ROUTES[i].toLowerCase() === String(v).toLowerCase()) return i;
        }
    }
    return clamp(Math.round(finite(v, routeMode)), 0, EQP_ROUTES.length - 1);
}
function allocSpec() {
    specPre = new Array(SPEC_COLS);
    specPost = new Array(SPEC_COLS);
    for (var i = 0; i < SPEC_COLS; i++) {
        specPre[i] = rangeMinDb;
        specPost[i] = rangeMinDb;
    }
    specRef = new Array(SPEC_COLS);
    for (var r = 0; r < SPEC_COLS; r++) specRef[r] = -120;
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

function isBandSelected(i) {
    return i === selectedBand || selectedBands.indexOf(i) >= 0;
}
function setSingleSelection(i) {
    selectedBand = i;
    selectedBands = i >= 0 ? [i] : [];
}
function toggleBandSelection(i) {
    var at = selectedBands.indexOf(i);
    if (at >= 0) {
        selectedBands.splice(at, 1);
        if (selectedBand === i) selectedBand = selectedBands.length ? selectedBands[0] : -1;
    } else {
        selectedBands.push(i);
        selectedBand = i;
    }
}
function getSelectedBands() {
    return selectedBands.slice();
}
function panelX() {
    return showSidechainFold ? EQP_SIDECHAIN_FOLD_W : EQP_SC_TAB_W;
}
function deviceWidthPx() {
    try { return eqpComputeDeviceWidth(showFiltersShelf, showAnalyzerShelf, showSidechainFold); }
    catch (e) { return 360 + (showSidechainFold ? EQP_SIDECHAIN_FOLD_W : EQP_SC_TAB_W); }
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
function fromScreenFreq(screenF) {
    return toStoredFreq(screenF);
}

function geo() {
    var full = deviceWidthPx() - 8;
    if (!(full >= 352)) full = 352;
    var ox = panelX();
    var g = { w: full, h: 161, sx: 1, sy: 1, mainX: ox, mainW: 352, fullW: full };
    g.plotX = ox + 2;
    g.plotY = 23;
    g.plotW = 348;
    g.plotH = 115;
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
    var ox = g.mainX || 0;
    var yb = 141;
    var hb = 16;
    var L = {
        shift: sc(g, ox + 8, 2, 84, 19),
        gain: sc(g, ox + 96, 2, 76, 19),
        tilt: sc(g, ox + 174, 2, 54, 19),
        range: sc(g, ox + 268, 3, 44, 16),
        aq: sc(g, ox + 316, 3, 30, 17),
        route: { x: g.plotX + 20 * g.sx, y: g.plotY + 1 * g.sy, w: 58 * g.sx, h: 13 * g.sy },
        bandSel: sc(g, ox + 6, yb, 22, hb),
        solo: sc(g, ox + 30, yb, 16, hb),
        power: sc(g, ox + 49, yb, 16, hb),
        mode: sc(g, ox + 68, yb, 96, hb),
        freq: sc(g, ox + 168, yb, 52, hb),
        bandGain: sc(g, ox + 222, yb, 50, hb),
        q: sc(g, ox + 274, yb, 40, hb),
        filtersToggle: sc(g, ox + 324, yb, 12, hb),
        analyzerToggle: sc(g, ox + 338, yb, 12, hb),
        azLabel: sc(g, ox + 32, yb, 60, hb),
        pre: sc(g, ox + 96, yb, 30, hb),
        post: sc(g, ox + 130, yb, 34, hb),
        resLabel: sc(g, ox + 170, yb, 22, hb),
        res: sc(g, ox + 192, yb, 54, hb),
        speedLabel: sc(g, ox + 250, yb, 22, hb),
        speed: sc(g, ox + 272, yb, 46, hb)
    };
    L.icon = L.bandSel;
    L.cards = filterCards();
    L.az = analyzerShelf();
    L.sc = sidechainFoldLayout();
    return L;
}
function filterCards() {
    var cards = [];
    if (!showFiltersShelf) return cards;
    var x0 = panelX() + 352 + 4;
    for (var i = 0; i < EQP_NUM_BANDS; i++) {
        var col = i < 4 ? 0 : 1;
        var row = i % 4;
        var x = x0 + col * (118 + 3);
        var y = 2 + row * (37 + 3);
        cards.push({
            i: i, x: x, y: y, w: 118, h: 37,
            power: { x: x + 4, y: y + 3, w: 14, h: 14 },
            mode: { x: x + 20, y: y + 2, w: 94, h: 16 },
            freq: { x: x + 4, y: y + 19, w: 44, h: 15 },
            gain: { x: x + 48, y: y + 19, w: 38, h: 15 },
            q: { x: x + 86, y: y + 19, w: 28, h: 15 }
        });
    }
    return cards;
}
function analyzerShelf() {
    if (!showAnalyzerShelf) return null;
    var x = panelX() + 352 + (showFiltersShelf ? EQP_FILTERS_SHELF_W : 0);
    return {
        x: x, y: 4, w: EQP_ANALYZER_SHELF_W - 8, h: 153,
        pre: { x: x + 70, y: 34, w: 30, h: 16 },
        post: { x: x + 104, y: 34, w: 34, h: 16 },
        res: { x: x + 68, y: 58, w: 70, h: 16 },
        speed: { x: x + 68, y: 82, w: 70, h: 16 },
        tilt: { x: x + 68, y: 106, w: 70, h: 16 },
        rmin: { x: x + 72, y: 130, w: 32, h: 16 },
        rmax: { x: x + 108, y: 130, w: 28, h: 16 },
        phase: { x: x + 50, y: 6, w: 86, h: 15 }
    };
}
function sidechainFoldLayout() {
    var tab = {
        x: 0, y: 0, w: EQP_SC_TAB_W, h: 161,
        arrow: { x: 2, y: 4, w: 14, h: 14 },
        label: { x: 0, y: 20, w: EQP_SC_TAB_W, h: 124 }
    };
    var lay = { tab: tab, open: showSidechainFold ? 1 : 0 };
    if (!showSidechainFold) return lay;
    var x = EQP_SC_TAB_W + 8;
    lay.x = EQP_SC_TAB_W;
    lay.y = 0;
    lay.w = EQP_SIDECHAIN_FOLD_W - EQP_SC_TAB_W;
    lay.h = 161;
    lay.route = { x: x, y: 28, w: 96, h: 16 };
    lay.chan = { x: x, y: 50, w: 96, h: 16 };
    lay.gain = { x: x + 46, y: 80, w: 50, h: 16 };
    lay.meter = { x: x, y: 112, w: 96, h: 6 };
    return lay;
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
function eqYFree(g, db) {
    var r = rangeDb();
    if (!(r > 0) || !isFinite(r)) r = 12;
    var x = Number(db);
    if (!isFinite(x)) x = 0;
    var n = (x + r) / (2 * r);
    var t = normUp ? (1 - n) : n;
    return g.plotY + t * g.plotH;
}
function clipYSeg(x0, y0, x1, y1, top, bot) {
    var s0 = y0 < top ? -1 : (y0 > bot ? 1 : 0);
    var s1 = y1 < top ? -1 : (y1 > bot ? 1 : 0);
    if (s0 && s0 === s1) return null;
    var ax = x0, ay = y0, bx = x1, by = y1;
    var dy = y1 - y0;
    if (s0) {
        var edge0 = s0 < 0 ? top : bot;
        var t0 = (edge0 - y0) / dy;
        ax = x0 + (x1 - x0) * t0;
        ay = edge0;
    }
    if (s1) {
        var edge1 = s1 < 0 ? top : bot;
        var t1 = (edge1 - y0) / dy;
        bx = x0 + (x1 - x0) * t1;
        by = edge1;
    }
    return [ax, ay, bx, by];
}
function strokeClipped(x0, y0, x1, y1, g) {
    var seg = clipYSeg(x0, y0, x1, y1, g.plotY, g.plotY + g.plotH);
    if (!seg) return;
    mgraphics.move_to(seg[0], seg[1]);
    mgraphics.line_to(seg[2], seg[3]);
    mgraphics.stroke();
}
function zeroY(g) { return eqY(g, 0); }
function specY(g, db) {
    var lo = rangeMinDb, hi = rangeMaxDb;
    if (!(hi > lo)) { lo = -100; hi = 0; }
    var t = clamp01((db - lo) / (hi - lo));
    return g.plotY + (1 - t) * g.plotH;
}

function responseDbOf(list, f) {
    var db = 0;
    try { db = eqpTotalResponseDb(list, f, currentSr, shiftSt, adaptiveQ, 0, tiltEqDb); }
    catch (e) { db = 0; }
    return finite(db, 0);
}
function responseDb(f) {
    return responseDbOf(bands, f);
}
function bandDb(b, f) {
    var db = 0;
    try { db = eqpBandResponseDb(b, f, currentSr, shiftSt, adaptiveQ); }
    catch (e) { db = 0; }
    return finite(db, 0);
}
function colFreq(i) {
    return Math.sqrt(colEdge[i] * colEdge[i + 1]);
}
function specFreq(i) {
    return Math.sqrt(specEdge[i] * specEdge[i + 1]);
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

function eqpColor(name) {
    var fb = EQP_LIVE[name] || [0.5, 0.5, 0.5, 1];
    if (typeof m4lColor === "function" && typeof m4lIsActive === "function" && m4lIsActive()) {
        return m4lColor(name, fb);
    }
    try {
        if (typeof max !== "undefined" && max.getcolor) {
            var c = max.getcolor(name);
            if (c && c.length >= 3 && !(c.length > 3 && c[3] === 0 && c[0] === 0 && c[1] === 0 && c[2] === 0)) {
                return [c[0], c[1], c[2], c.length > 3 ? c[3] : 1];
            }
        }
    } catch (e) {}
    return [fb[0], fb[1], fb[2], fb.length > 3 ? fb[3] : 1];
}
function eqpApplyTheme() {
    COL_CHROME = eqpColor("live_surface_bg");
    COL_BEZEL = eqpColor("live_desktop");
    COL_PLOT = eqpColor("live_lcd_bg");
    COL_LABEL = eqpColor("live_lcd_title");
    COL_ORANGE = eqpColor("live_control_selection");
    COL_VALUE = eqpColor("live_lcd_control_fg");
    COL_CURVE = eqpColor("live_display_line_one");
    COL_FOCUS = eqpColor("live_lcd_control_fg_alt");
    COL_SPEC = eqpColor("live_display_line_two");
    COL_REF = eqpColor("live_display_handle_two");
    COL_DIM = eqpColor("live_control_zombie");
    COL_AXIS = eqpColor("live_display_scale_text");
    COL_GRID = eqpColor("live_lcd_frame");
    COL_AQ_OFF = eqpColor("live_control_zombie");
    COL_BTN = eqpColor("live_control_bg");
    COL_BTN_TEXT = eqpColor("live_control_fg");
    COL_BTN_ON_TEXT = eqpColor("live_lcd_bg");
    COL_DROP = eqpColor("live_control_bg");
    COL_DROP_EDGE = eqpColor("live_lcd_frame");
    COL_CARET = eqpColor("live_control_fg");
    COL_WHITE = eqpColor("live_control_fg");
    COL_INK = eqpColor("live_lcd_bg");
    COL_ALERT = eqpColor("live_alert");
}
var eqpThemeKey = "";
var eqpThemeTask = null;
function eqpThemeWatch() {
    if (eqpThemeTask || typeof Task !== "function") return;
    var t = new Task(function () {
        var names = ["live_lcd_bg", "live_control_selection", "live_display_line_one", "live_display_line_two", "live_surface_bg"];
        var k = "";
        for (var i = 0; i < names.length; i++) k += String(eqpColor(names[i]));
        if (k !== eqpThemeKey) {
            eqpThemeKey = k;
            mgraphics.redraw();
        }
    }, this);
    t.interval = 1000;
    t.repeat();
    eqpThemeTask = t;
}
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
    if (c && typeof c === "object" && typeof c.length === "number") {
        for (var k = 0; k < stride && k < c.length; k++) row[k] = finite(c[k], 0);
        return row;
    }
    if (!c || typeof c !== "object") return row;
    var b0 = finite(c.b0, 0), b1 = finite(c.b1, 0), b2 = finite(c.b2, 0);
    var a1 = finite(c.a1, 0), a2 = finite(c.a2, 0);
    if (c.a0 !== undefined) {
        var a0 = finite(c.a0, 1);
        if (a0 !== 0 && a0 !== 1) {
            b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
        }
    }
    row[EQP_CFG_OFF_SECTIONS] = finite(c.sections, 0);
    row[EQP_CFG_OFF_B0] = b0;
    row[EQP_CFG_OFF_B1] = b1;
    row[EQP_CFG_OFF_B2] = b2;
    row[EQP_CFG_OFF_A1] = a1;
    row[EQP_CFG_OFF_A2] = a2;
    return row;
}

function updateDeviceLatency() {
    var want = 0;
    if (phaseMode === 1) want = eqpNaturalLatency(currentSr);
    else if (phaseMode === 2) want = EQP_LINEAR_LATENCY;
    if (want === eqpReportedLatency) return;
    eqpReportedLatency = want;
    var host = hostPatcher();
    if (!host || typeof host.setattr !== "function") return;
    try { host.setattr("latency", want); }
    catch (e) {}
}
function updatePhaseKernel() {
    outlet(1, ["phaseMode", phaseMode]);
    outlet(1, ["chroute", routeMode]);
    updateDeviceLatency();
    if (phaseMode === 0 || typeof Buffer === "undefined") return;
    try {
        var designedA = eqpDesignPhase(bandsA, currentSr, shiftSt, adaptiveQ, tiltEqDb);
        var designedB = routeSplit(routeMode) ? eqpDesignPhase(bandsB, currentSr, shiftSt, adaptiveQ, tiltEqDb) : designedA;
        var buf = new Buffer(irBufName);
        buf.poke(1, 0, designedA.linear);
        buf.poke(1, 2048, designedB.linear);
        buf.poke(2, 0, designedA.fir);
        buf.poke(2, 128, designedB.fir);
        irSerial = (irSerial + 1) % 100000;
        if (irSerial === 0) irSerial = 1;
        outlet(1, ["irGen", irSerial]);
    } catch (e) {}
}
function emitTilt() {
    var c;
    try { c = eqpTiltCoeffs(tiltEqDb, currentSr); }
    catch (e) { return; }
    var secs = c.sections || [];
    outlet(1, ["tGain", finite(c.gain, 1)]);
    for (var i = 0; i < secs.length; i++) {
        var s = secs[i];
        outlet(1, ["t" + i + "b0", finite(s.b0, 1)]);
        outlet(1, ["t" + i + "b1", finite(s.b1, 0)]);
        outlet(1, ["t" + i + "a1", finite(s.a1, 0)]);
    }
    outlet(1, ["tiltOn", c.on]);
}
function appendCoeffRows(all, list) {
    var stride = EQP_CFG_STRIDE;
    for (var i = 0; i < EQP_NUM_BANDS; i++) {
        var b = list[i];
        var row;
        if (bandLive(b)) {
            var effF = eqpEffectiveFreq(b.freq, shiftSt);
            var effQ = eqpEffectiveQ(b.q, b.gain, adaptiveQ, b.mode);
            row = coeffRow(eqpBiquadCoeffs(b.mode, effF, b.gain, effQ, currentSr));
        } else {
            row = coeffRow(null);
        }
        for (var k = 0; k < stride; k++) all.push(row[k]);
    }
}
function updateCoeffBuffer() {
    emitTilt();
    if (routeLinked(routeMode)) copyBands(bandsA, bandsB);
    if (typeof Buffer === "undefined") return;
    try {
        var buf = new Buffer(cfgBufName);
        var all = [];
        appendCoeffRows(all, bandsA);
        appendCoeffRows(all, bandsB);
        buf.poke(1, 0, all);
    } catch (e) {}
    updatePhaseKernel();
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
    emitParam("tilt_eq", tiltEqDb);
    emitParam("filters_shelf", showFiltersShelf ? 1 : 0);
    emitParam("analyzer_shelf", showAnalyzerShelf ? 1 : 0);
    emitParam("ref_enable", refEnabled ? 1 : 0);
    emitParam("route", routeMode);
    emitParam("sidechain_fold", showSidechainFold ? 1 : 0);
    emitParam("ref_gain", refGainDb);
    emitParam("phase_mode", phaseMode);
    for (var i = 0; i < EQP_NUM_BANDS; i++) emitBand(i);
}

function getvalueof() {
    var out = [
        EQP_STATE_VERSION,
        shiftSt, outGainDb, rangeIdx,
        adaptiveQ ? 1 : 0, analyzerPre ? 1 : 0, analyzerPost ? 1 : 0,
        resIdx, speedIdx, tiltIdx, rangeMinDb, rangeMaxDb
    ];
    function pushCurve(list) {
        for (var i = 0; i < EQP_NUM_BANDS; i++) {
            var b = list[i];
            out.push(b.enabled ? 1 : 0, b.mode, b.freq, b.gain, b.q);
        }
    }
    pushCurve(bandsA);
    out.push(showFiltersShelf ? 1 : 0, showAnalyzerShelf ? 1 : 0);
    out.push(showSidechainFold ? 1 : 0, refEnabled ? 1 : 0, refGainDb, tiltEqDb, phaseMode, routeMode);
    pushCurve(bandsB);
    return out;
}

function applyStateArray(args) {
    if (!args || !args.length) return;
    var ver = Math.round(finite(args[0], 0));
    if (ver !== 1) return;
    if (args.length > 1) shiftSt = clamp(finite(args[1], 0), EQP_SHIFT_MIN, EQP_SHIFT_MAX);
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
    function readCurve(list, at) {
        for (var i = 0; i < EQP_NUM_BANDS; i++) {
            var o = at + i * 5;
            if (args.length <= o) return;
            var b = list[i];
            b.enabled = finite(args[o], 0) > 0.5 ? 1 : 0;
            if (args.length > o + 1) b.mode = clamp(Math.round(finite(args[o + 1], 0)), 0, 12);
            if (args.length > o + 2) b.freq = clamp(finite(args[o + 2], b.freq), EQP_FREQ_MIN, EQP_FREQ_MAX);
            if (args.length > o + 3) b.gain = clamp(finite(args[o + 3], 0), EQP_GAIN_MIN, EQP_GAIN_MAX);
            if (args.length > o + 4) b.q = clamp(finite(args[o + 4], EQP_Q_DEFAULT), EQP_Q_MIN, EQP_Q_MAX);
            if (b.mode === 0) b.enabled = 0;
        }
    }
    readCurve(bandsA, 12);
    var shelfAt = 12 + EQP_NUM_BANDS * 5;
    if (args.length > shelfAt) showFiltersShelf = finite(args[shelfAt], 0) > 0.5 ? 1 : 0;
    if (args.length > shelfAt + 1) showAnalyzerShelf = finite(args[shelfAt + 1], 0) > 0.5 ? 1 : 0;
    if (args.length > shelfAt + 2) showSidechainFold = finite(args[shelfAt + 2], 0) > 0.5 ? 1 : 0;
    if (args.length > shelfAt + 3) refEnabled = finite(args[shelfAt + 3], 0) > 0.5 ? 1 : 0;
    if (args.length > shelfAt + 4) refGainDb = clamp(finite(args[shelfAt + 4], 0), -24, 24);
    if (args.length > shelfAt + 5) tiltEqDb = clamp(finite(args[shelfAt + 5], 0), -24, 24);
    if (args.length > shelfAt + 6) {
        var rawPhase = finite(args[shelfAt + 6], 0);
        var pm = Math.round(rawPhase);
        if ((pm === 0 || pm === 1 || pm === 2) && Math.abs(rawPhase - pm) < 1e-4) phaseMode = pm;
        else phaseMode = 0;
    }
    var routeAt = shelfAt + 7;
    if (args.length > routeAt) routeMode = clamp(Math.round(finite(args[routeAt], 0)), 0, EQP_ROUTES.length - 1);
    else routeMode = 0;
    if (args.length > routeAt + 5) readCurve(bandsB, routeAt + 1);
    else copyBands(bandsA, bandsB);
    if (routeLinked(routeMode)) copyBands(bandsA, bandsB);
    bands = routeEditsB(routeMode) ? bandsB : bandsA;
    updateCoeffBuffer();
    resizeDeviceBoxes();
    emitAll();
    updateSoloState();
    mgraphics.redraw();
}

function resizeDeviceBoxes() {
    var devW = deviceWidthPx();
    var vizW = devW - 8;
    outlet(0, "setwidth_cmd", devW);
    var host = hostPatcher();
    if (!host || typeof host.getnamed !== "function") return;
    try {
        var ui = host.getnamed("obj-viz");
        if (ui && typeof ui.setattr === "function") ui.setattr("presentation_rect", 4, 4, vizW, 161);
        var panel = host.getnamed("obj-panel-bg");
        if (panel && typeof panel.setattr === "function") panel.setattr("presentation_rect", 0, 0, devW, 169);
    } catch (e2) {}
}
function applyDeviceWidth() {
    resizeDeviceBoxes();
    emitParam("filters_shelf", showFiltersShelf ? 1 : 0);
    emitParam("analyzer_shelf", showAnalyzerShelf ? 1 : 0);
    mgraphics.redraw();
}
function updateSoloState() {
    if (soloBand < 0 || soloBand >= EQP_NUM_BANDS || !bands[soloBand]) {
        outlet(1, ["soloBand", -1]);
        return;
    }
    var b = bands[soloBand];
    var q = b.q;
    try { q = eqpEffectiveQ(b.q, b.gain, adaptiveQ, b.mode); }
    catch (e) { q = b.q; }
    var sc = eqpSoloBandCoeffs(toScreenFreq(b.freq), q, currentSr);
    outlet(1, ["soloB0", sc.b0]);
    outlet(1, ["soloB1", sc.b1]);
    outlet(1, ["soloB2", sc.b2]);
    outlet(1, ["soloA1", sc.a1]);
    outlet(1, ["soloA2", sc.a2]);
    outlet(1, ["soloBand", soloBand]);
}
function noteSolo(i) {
    if (soloBand < 0) return;
    if (i === undefined || i === soloBand) updateSoloState();
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

// Delete disables the selection. Up / down move bell and shelf gain by 0.5 dB.
// Left / right move every selected filter by one semitone. The patcher's `key`
// object and a focused onkeydown can both deliver one press, so the same
// action inside KEY_DEDUP_MS is ignored. Key repeat is slower than that.
var KEY_DEDUP_MS = 20;
var lastKeyAt = { disable: 0, gain: 0, freq: 0 };
function keyOnce(action) {
    var now = Date.now();
    if (now - (lastKeyAt[action] || 0) < KEY_DEDUP_MS) return false;
    lastKeyAt[action] = now;
    return true;
}
function eachSelected(fn) {
    var changed = false;
    for (var i = 0; i < EQP_NUM_BANDS; i++) {
        if (!isBandSelected(i) || !bands[i]) continue;
        if (fn(i, bands[i])) {
            changed = true;
            emitBand(i);
            noteSolo(i);
        }
    }
    return changed;
}
function commitHotkey(action, mutate) {
    if (!keyOnce(action)) return;
    if (gesture.kind) finishGesture();
    var snapshot = getvalueof();
    if (!mutate()) return;
    undoStack.push(snapshot);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    updateCoeffBuffer();
    if (typeof notifyclients === "function") notifyclients();
    mgraphics.redraw();
}
function disableSelectedFilters() {
    commitHotkey("disable", function () {
        return eachSelected(function (i, b) {
            if (!b.enabled) return false;
            b.enabled = 0;
            return true;
        });
    });
}
function nudgeSelectedGain(dir) {
    var step = dir < 0 ? -0.5 : 0.5;
    commitHotkey("gain", function () {
        return eachSelected(function (i, b) {
            if (!usesGain(b.mode)) return false;
            var n = clamp(roundTo(b.gain + step, 0.1), EQP_GAIN_MIN, EQP_GAIN_MAX);
            if (n === b.gain) return false;
            b.gain = n;
            return true;
        });
    });
}
function nudgeSelectedFreq(dir) {
    var ratio = Math.pow(2, (dir < 0 ? -1 : 1) / 12);
    commitHotkey("freq", function () {
        return eachSelected(function (i, b) {
            var n = clamp(b.freq * ratio, EQP_FREQ_MIN, EQP_FREQ_MAX);
            if (n === b.freq) return false;
            b.freq = n;
            return true;
        });
    });
}
function hotkey_disable() {
    if (!hotkeyAllowed()) return;
    disableSelectedFilters();
}
function hotkey_gain(dir) {
    if (!hotkeyAllowed()) return;
    nudgeSelectedGain(dir);
}
function hotkey_freq(dir) {
    if (!hotkeyAllowed()) return;
    nudgeSelectedFreq(dir);
}
function onkeydown(keycode, textcharacter, down) {
    if (down === 0) return;
    var code = Number(keycode);
    var ch = Number(textcharacter);
    var name = String(keycode == null ? "" : keycode);
    if (code === 127 || code === 8 || code === -5 || ch === 127 || ch === 8) {
        disableSelectedFilters();
        return;
    }
    if (code === 30 || name === "ArrowUp" || name === "up") nudgeSelectedGain(1);
    else if (code === 31 || name === "ArrowDown" || name === "down") nudgeSelectedGain(-1);
    else if (code === 28 || name === "ArrowLeft" || name === "left") nudgeSelectedFreq(-1);
    else if (code === 29 || name === "ArrowRight" || name === "right") nudgeSelectedFreq(1);
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

function binMag(dbBins, idx, bins) {
    var i0 = idx | 0;
    if (i0 < 1) i0 = 1;
    if (i0 > bins - 2) i0 = bins - 2;
    var t = idx - i0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var m0 = Math.pow(10, dbBins[i0] / 20);
    var m1 = Math.pow(10, dbBins[i0 + 1] / 20);
    if (!(m0 > 0)) m0 = 0;
    if (!(m1 > 0)) m1 = 0;
    return m0 + (m1 - m0) * t;
}
function columnDbAt(dbBins, n, sr, fLo, fHi, fc) {
    var bins = n >> 1;
    var scale = n / Math.max(8000, sr);
    var bLo = fLo * scale;
    var bHi = fHi * scale;
    if (bLo < 1) bLo = 1;
    if (bHi < bLo) bHi = bLo;
    var last = bins - 1;
    if (bLo > last) bLo = last;
    if (bHi > last) bHi = last;
    // A column narrower than one bin follows the lobe in linear magnitude.
    // Taking the peak of every overlapped bin painted a flat step. A wider
    // column still keeps the peak so a harmonic between samples is not lost.
    // Interpolating in dB landed on the null and notched the lobe.
    var span = bHi - bLo;
    var mag;
    if (span <= 1.25) {
        mag = binMag(dbBins, 0.5 * (bLo + bHi), bins);
    } else {
        mag = binMag(dbBins, bLo, bins);
        var i0 = Math.max(1, Math.floor(bLo));
        var i1 = Math.min(last, Math.ceil(bHi));
        for (var b = i0; b <= i1; b++) {
            var m = Math.pow(10, dbBins[b] / 20);
            if (m > mag) mag = m;
        }
        var edge = binMag(dbBins, bHi, bins);
        if (edge > mag) mag = edge;
    }
    var db = 20 * Math.log(Math.max(mag, 1e-12)) / Math.LN10;
    var tilt = EQP_TILTS[tiltIdx] || 0;
    if (tilt && !(tilt > 0 && db <= -108)) {
        db += tilt * (Math.log(fc / 1000) / Math.LN2);
    }
    return finite(db, rangeMinDb);
}
function columnDb(dbBins, n, sr, i) {
    return columnDbAt(dbBins, n, sr, colEdge[i], colEdge[i + 1], colFreq(i));
}
function specColumnDb(dbBins, n, sr, i) {
    return columnDbAt(dbBins, n, sr, specEdge[i], specEdge[i + 1], specFreq(i));
}
// Display-only. A short gaussian in linear magnitude turns a one-bin
// spike into a rounded arch. The radius stays inside the gap between
// resolved harmonics, so they do not melt into one slope.
function smoothSpectrumLine(cols) {
    var n = cols.length;
    var mag = new Array(n);
    var out = new Array(n);
    var radius = 6;
    var sigma = 2.2;
    var denom = 2 * sigma * sigma;
    var w = new Array(radius * 2 + 1);
    var k, i;
    for (k = -radius; k <= radius; k++) w[k + radius] = Math.exp(-(k * k) / denom);
    for (i = 0; i < n; i++) {
        var db = cols[i];
        mag[i] = Math.pow(10, ((db === db) ? db : -240) / 20);
    }
    for (i = 0; i < n; i++) {
        var acc = 0;
        var ws = 0;
        for (k = -radius; k <= radius; k++) {
            var j = i + k;
            if (j < 0 || j >= n) continue;
            acc += mag[j] * w[k + radius];
            ws += w[k + radius];
        }
        out[i] = 20 * Math.log(Math.max(ws ? acc / ws : mag[i], 1e-12)) / Math.LN10;
    }
    return out;
}

function smoothInto(dst, raw) {
    if (speedIdx === 3) return false;
    var atk = [0.80, 0.45, 0.18, 0][speedIdx];
    var rel = [0.42, 0.20, 0.08, 0][speedIdx];
    var moved = false;
    for (var i = 0; i < dst.length; i++) {
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
    if (!analyzerPre && !analyzerPost && !refEnabled) return;
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
        var raw = new Array(SPEC_COLS);
        function eat(channel, dst, extraDb) {
            var ring = peekMany(buf, channel, 8, EQP_SPEC_RING);
            if (!ring || ring.length < 256) ring = peekMany(buf, channel, 0, EQP_SPEC_RING);
            if (!ring || ring.length < 16) return false;
            var fn = fitFftN(n, ring.length);
            if (!fn) return false;
            var frame = unwrapRing(ring, fn, writePos);
            if (frameEnergy(frame) < 1e-12) return false;
            if (specHoldPreview) specHoldPreview = false;
            specHasSignal = 1;
            var bins = fftDbBins(frame, frame.length, currentSr);
            for (var c = 0; c < SPEC_COLS; c++) raw[c] = specColumnDb(bins, frame.length, currentSr, c) + (extraDb || 0);
            if (smoothInto(dst, raw)) moved = true;
            return true;
        }
        var got = false;
        if (analyzerPre) got = eat(1, specPre, 0) || got;
        if (analyzerPost) got = eat(2, specPost, 0) || got;
        if (refEnabled && chans >= 4) got = eat(4, specRef, refGainDb) || got;
        if (!got) {
            if (specHoldPreview) return;
            var floor = rangeMinDb;
            for (var i = 0; i < SPEC_COLS; i++) {
                if (analyzerPre && specPre[i] > floor + 0.4) {
                    specPre[i] += (floor - specPre[i]) * 0.18;
                    moved = true;
                }
                if (analyzerPost && specPost[i] > floor + 0.4) {
                    specPost[i] += (floor - specPost[i]) * 0.18;
                    moved = true;
                }
                if (refEnabled && specRef[i] > floor + 0.4) {
                    specRef[i] += (floor - specRef[i]) * 0.18;
                    moved = true;
                }
            }
        }
    } catch (e) {}
    if (moved) mgraphics.redraw();
}

function seedPreviewSpectrum() {
    for (var i = 0; i < SPEC_COLS; i++) {
        var nrm = i / (SPEC_COLS - 1);
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
    outlet(1, ["irspec", irBufName]);
    outlet(1, ["outgain", outGainDb]);
    outlet(1, ["chroute", routeMode]);
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
            try {
                host.connect(pin, 2, g, 2);
                host.connect(pin, 3, g, 3);
            } catch (side) {}
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
// The patcher's `key` object hears every keystroke in Live. Hotkeys from that
// path run only when this device is the selected device. A focused onkeydown
// is not gated. Unknown Live state means not selected.
var eqpSelfApi = null;
var eqpSelfId = "";
var eqpSelTrackObs = null;
var eqpSelDevObs = null;
var eqpSelGen = 0;
var eqpIsSelected = false;
var eqpSelForced = null;
var eqpSelTasks = [];
function hotkeyAllowed() {
    if (eqpSelForced !== null) return eqpSelForced === 1;
    if (typeof LiveAPI !== "function") return true;
    return eqpIsSelected;
}
function eqpIdStr(v) {
    var n = Number(v);
    return (isFinite(n) && n > 0) ? String(Math.round(n)) : "";
}
function eqpLomId(raw) {
    var flat = [];
    var walk = function (a) {
        if (a && typeof a === "object" && typeof a.length === "number") {
            for (var i = 0; i < a.length; i++) walk(a[i]);
        } else if (typeof a === "string" && /^id\s+\d+$/.test(a)) {
            flat.push("id");
            flat.push(Number(a.slice(3)));
        } else flat.push(a);
    };
    walk(raw);
    for (var j = 0; j < flat.length - 1; j++) if (flat[j] === "id") return eqpIdStr(flat[j + 1]);
    return "";
}
function eqpIsNotify(raw, prop) {
    var head = (raw[0] && typeof raw[0] === "object" && typeof raw[0].length === "number") ? raw[0][0] : raw[0];
    return head === prop;
}
function eqpDefer(fn) {
    if (typeof Task !== "function") {
        try { fn(); } catch (e) { eqpIsSelected = false; }
        return;
    }
    var t = new Task(function () {
        var at = eqpSelTasks.indexOf(t);
        if (at >= 0) eqpSelTasks.splice(at, 1);
        try { fn(); } catch (e2) { eqpIsSelected = false; }
    }, this);
    eqpSelTasks.push(t);
    t.schedule(0);
}
function eqpSetSelectedDevice(devId) {
    var sel = !!devId && !!eqpSelfId && devId === eqpSelfId;
    if (!sel && devId && eqpSelfApi && typeof LiveAPI === "function") {
        try {
            var mine = String(eqpSelfApi.unquotedpath || "");
            var theirs = String(new LiveAPI("id " + devId).unquotedpath || "");
            sel = !!mine && mine === theirs;
        } catch (e) {}
    }
    eqpIsSelected = sel;
}
function eqpRefreshTrack(trackId) {
    eqpSelGen++;
    var gen = eqpSelGen;
    if (eqpSelDevObs) {
        try { eqpSelDevObs.property = ""; } catch (e) {}
        eqpSelDevObs = null;
    }
    if (!trackId) { eqpSetSelectedDevice(""); return; }
    var trackApi = new LiveAPI("id " + trackId);
    var viewId = "";
    try { viewId = eqpLomId(trackApi.get("view")); } catch (e2) {}
    var viewPath = viewId ? ("id " + viewId) : (String(trackApi.unquotedpath || "") + " view");
    var onDev = function () {
        var raw = Array.prototype.slice.call(arguments);
        if (!eqpIsNotify(raw, "selected_device")) return;
        var id = eqpLomId(raw);
        eqpDefer(function () { if (gen === eqpSelGen) eqpSetSelectedDevice(id); });
    };
    eqpSelDevObs = new LiveAPI(onDev, viewPath);
    eqpSelDevObs.property = "selected_device";
    eqpSetSelectedDevice(eqpLomId(eqpSelDevObs.get("selected_device")));
}
function init_selection() {
    if (eqpSelTrackObs || typeof LiveAPI !== "function") return;
    try {
        eqpSelfApi = new LiveAPI("this_device");
        eqpSelfId = eqpIdStr(eqpSelfApi.id);
        var onTrack = function () {
            var raw = Array.prototype.slice.call(arguments);
            if (!eqpIsNotify(raw, "selected_track")) return;
            var id = eqpLomId(raw);
            eqpDefer(function () { eqpRefreshTrack(id); });
        };
        eqpSelTrackObs = new LiveAPI(onTrack, "live_set view");
        eqpSelTrackObs.property = "selected_track";
        eqpRefreshTrack(eqpLomId(eqpSelTrackObs.get("selected_track")));
    } catch (e) {
        eqpIsSelected = false;
    }
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
    var colPick = 78;
    if (kind === "bandmode") colPick = 118;
    if (kind === "phase") colPick = 124;
    var colW = Math.max(anchor.w, colPick * g.sx);
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
    bottomAnalyzer = 0;
    if (bandIdx >= 0) setSingleSelection(bandIdx);
    else if (selectedBand < 0) {
        var a = firstActive();
        setSingleSelection(a >= 0 ? a : 0);
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
    setSingleSelection(i);
}
function deactivateBand(i) {
    bands[i].enabled = 0;
    bands[i].mode = 0;
    var at = selectedBands.indexOf(i);
    if (at >= 0) selectedBands.splice(at, 1);
    if (selectedBand === i) selectedBand = selectedBands.length ? selectedBands[0] : -1;
    if (recentCreate.band === i) recentCreate.band = -1;
    emitBand(i);
    updateCoeffBuffer();
}

function beginCreate(g, x, y, opt) {
    var idx = firstInactive();
    if (idx < 0) return false;
    var nx = xToNorm(g, x);
    var ny = yToNorm(g, y);
    var mode = resolveGestureMode(nx, ny, 0.5);
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
function armReadout(kind, i, y) {
    gesture.kind = kind;
    gesture.band = i;
    gesture.y0 = y;
    gesture.freq0 = bands[i].freq;
    gesture.bandGain0 = bands[i].gain;
    gesture.q0 = bands[i].q;
}
function toggleBandPower(i) {
    discreteEdit(function () {
        var b = bands[i];
        if (bandLive(b)) b.enabled = 0;
        else {
            b.enabled = 1;
            if (b.mode === 0) b.mode = 6;
        }
        emitBand(i);
        updateCoeffBuffer();
        noteSolo(i);
    });
}
function qHandlePos(g, i) {
    var p = bandXY(g, bands[i]);
    var y = p.y - QH_GAP;
    if (y - QH_R < g.plotY) y = p.y + QH_GAP;
    return { x: p.x, y: y };
}
function hitQHandle(g, x, y) {
    var focus = hoverBand >= 0 ? hoverBand : selectedBand;
    if (focus < 0 || !bands[focus] || !bandLive(bands[focus])) return -1;
    var p = qHandlePos(g, focus);
    var dx = x - p.x;
    var dy = y - p.y;
    if (dx * dx + dy * dy <= 41) return focus;
    return -1;
}
function dragQHandle(g, x, y) {
    var b = bands[gesture.band];
    if (!b) return;
    var dx = (x - gesture.x0) / Math.max(0.001, g.sx);
    var dy = (gesture.y0 - y) / Math.max(0.001, g.sy);
    var d = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    var n0 = eqpQToNorm(gesture.q0);
    var nq = clamp(eqpNormToQ(clamp01(n0 + d / 140)), EQP_Q_MIN, EQP_Q_MAX);
    if (nq === b.q) return;
    markDirty();
    b.q = nq;
    emitBand(gesture.band);
    updateCoeffBuffer();
    noteSolo(gesture.band);
}
function beginDragBand(i, x, y, opt) {
    bottomAnalyzer = 0;
    var g = lastGeo || geo();
    gesture.kind = "band";
    gesture.band = i;
    gesture.qOnly = !!opt;
    gesture.x0 = x;
    gesture.y0 = y;
    gesture.freq0 = bands[i].freq;
    gesture.bandGain0 = bands[i].gain;
    gesture.q0 = bands[i].q;
    gesture.multiSnap = [];
    gesture.startNormX = xToNorm(g, x);
    gesture.startNormY = yToNorm(g, y);
    for (var s = 0; s < selectedBands.length; s++) {
        var idx = selectedBands[s];
        var sb = bands[idx];
        if (!sb || !bandLive(sb)) continue;
        gesture.multiSnap.push({
            idx: idx,
            freq: sb.freq,
            freqNorm: eqpFreqToNorm(toScreenFreq(sb.freq)),
            gain: sb.gain,
            qNorm: eqpQToNorm(sb.q),
            q: sb.q
        });
    }
}
function freqFromPaintedDrag(freq0, screenNow) {
    var painted = toScreenFreq(freq0);
    if (!(painted > 0) || !(screenNow > 0)) return freq0;
    return clamp(freq0 * (screenNow / painted), EQP_FREQ_MIN, EQP_FREQ_MAX);
}
function gainFromPaintedDrag(gain0, dbNow) {
    var painted = clamp(gain0, -rangeDb(), rangeDb());
    return clamp(gain0 + (dbNow - painted), EQP_GAIN_MIN, EQP_GAIN_MAX);
}
function dragBand(g, x, y) {
    if (gesture.multiSnap && gesture.multiSnap.length > 1) {
        var dNormX = xToNorm(g, x) - gesture.startNormX;
        var dNormY = yToNorm(g, y) - gesture.startNormY;
        var dGain = dNormY * 2 * rangeDb();
        var changed = false;
        for (var s = 0; s < gesture.multiSnap.length; s++) {
            var snap = gesture.multiSnap[s];
            var mb = bands[snap.idx];
            if (!mb) continue;
            var pf = mb.freq, pg = mb.gain, pq = mb.q;
            if (gesture.qOnly) {
                mb.q = clamp(snap.q * Math.exp(dNormY * 3.0), EQP_Q_MIN, EQP_Q_MAX);
            } else {
                mb.freq = freqFromPaintedDrag(snap.freq, eqpNormToFreq(clamp01(snap.freqNorm + dNormX)));
                if (usesGain(mb.mode)) mb.gain = clamp(snap.gain + dGain, EQP_GAIN_MIN, EQP_GAIN_MAX);
                else mb.q = eqpNormToQ(clamp01(snap.qNorm + dNormY));
            }
            if (mb.freq !== pf || mb.gain !== pg || mb.q !== pq) {
                changed = true;
                emitBand(snap.idx);
            }
        }
        if (changed) {
            markDirty();
            updateCoeffBuffer();
            noteSolo();
            mgraphics.redraw();
        }
        return;
    }
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
        b.freq = freqFromPaintedDrag(gesture.freq0, xToFreq(g, x));
        b.q = clamp(eqpNormToQ(yToNorm(g, y)), EQP_Q_MIN, EQP_Q_MAX);
    } else {
        b.freq = freqFromPaintedDrag(gesture.freq0, xToFreq(g, x));
        b.gain = gainFromPaintedDrag(gesture.bandGain0, eqpNormToDb(yToNorm(g, y), rangeDb()));
    }
    if (b.freq !== pf || b.gain !== pg || b.q !== pq) {
        markDirty();
        emitBand(gesture.band);
        updateCoeffBuffer();
        noteSolo(gesture.band);
    }
}
function dragShift(g, y) {
    var dy = (gesture.y0 - y) / Math.max(0.001, g.sy);
    var sens = gesture.fine ? 0.02 : 0.08;
    var v = clamp(roundTo(gesture.shift0 + dy * sens, 0.01), EQP_SHIFT_MIN, EQP_SHIFT_MAX);
    if (v === shiftSt) return;
    markDirty();
    shiftSt = v;
    emitParam("shift", shiftSt);
    updateCoeffBuffer();
    noteSolo();
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
function dragTiltEq(g, y) {
    var dy = (gesture.y0 - y) / Math.max(0.001, g.sy);
    var sens = gesture.fine ? 0.04 : 0.15;
    var v = clamp(roundTo(gesture.gain0 + dy * sens, 0.1), -24, 24);
    if (v === tiltEqDb) return;
    markDirty();
    tiltEqDb = v;
    emitParam("tilt_eq", tiltEqDb);
    emitTilt();
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
        noteSolo(gesture.band);
    }
}

function adjustQ(i, dy, fine) {
    var b = bands[i];
    if (!bandLive(b) || !dy) return;
    var now = Date.now();
    if (!undoArmed && now - wheelUndoT > 320) {
        pushUndoState();
        wheelUndoT = now;
    }
    var d = clamp(dy, -3, 3);
    // A plain scroll is four times the old step. Shift keeps that old step.
    var rate = fine ? 0.12 : 0.48;
    b.q = clamp(b.q * Math.exp(d * rate), EQP_Q_MIN, EQP_Q_MAX);
    b.q = roundTo(b.q, 0.001);
    emitBand(i);
    updateCoeffBuffer();
    noteSolo(i);
    if (typeof notifyclients === "function") notifyclients();
    mgraphics.redraw();
}
function wheelShift(args) {
    var last = args.length ? args[args.length - 1] : null;
    if (last && typeof last === "object") return last.shiftKey ? 1 : 0;
    if (args.length >= 6) return Number(args[5]) ? 1 : 0;
    return 0;
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
    if (n === 12 || n === 24 || n === 36 || n === 10 || n === 20 || n === 30) {
        var mapped = n;
        if (n === 10) mapped = 12;
        else if (n === 20) mapped = 24;
        else if (n === 30) mapped = 36;
        for (var i = 0; i < EQP_RANGES.length; i++) if (EQP_RANGES[i] === mapped) return i;
    }
    if (typeof v === "string") {
        if (v.indexOf("36") >= 0 || v.indexOf("30") >= 0) return 2;
        if (v.indexOf("24") >= 0 || v.indexOf("20") >= 0) return 1;
        if (v.indexOf("12") >= 0 || v.indexOf("10") >= 0) return 0;
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
    if (hit(L.tilt, x, y)) return "tilteq";
    if (hit(L.range, x, y)) return "range";
    if (hit(L.aq, x, y)) return "aq";
    if (hit(L.route, x, y)) return "route";
    if (hit(L.bandSel, x, y)) return "bandsel";
    if (hit(L.filtersToggle, x, y)) return "toggle_filters_shelf";
    if (hit(L.analyzerToggle, x, y)) return "toggle_analyzer_shelf";
    if (bottomAnalyzer) {
        if (hit(L.pre, x, y)) return "pre";
        if (hit(L.post, x, y)) return "post";
        if (hit(L.res, x, y)) return "res";
        if (hit(L.speed, x, y)) return "speed";
    } else {
        if (hit(L.solo, x, y)) return "solo";
        if (hit(L.power, x, y)) return "power";
        if (hit(L.mode, x, y)) return "mode";
        if (hit(L.freq, x, y)) return "freq";
        if (hit(L.bandGain, x, y)) return "bandgain";
        if (hit(L.q, x, y)) return "q";
    }
    if (L.az) {
        if (hit(L.az.phase, x, y)) return "phase";
        if (hit(L.az.pre, x, y)) return "pre";
        if (hit(L.az.post, x, y)) return "post";
        if (hit(L.az.res, x, y)) return "res";
        if (hit(L.az.speed, x, y)) return "speed";
        if (hit(L.az.tilt, x, y)) return "tilt";
        if (hit(L.az.rmin, x, y)) return "rmin";
        if (hit(L.az.rmax, x, y)) return "rmax";
    }
    if (L.sc && L.sc.tab) {
        if (hit(L.sc.tab.arrow, x, y) || hit(L.sc.tab.label, x, y)) return "scfold";
        if (L.sc.open) {
            if (hit(L.sc.route, x, y)) return "scroute";
            if (hit(L.sc.chan, x, y)) return "scchan";
            if (hit(L.sc.gain, x, y)) return "scgain";
        }
    }
    for (var c = 0; c < L.cards.length; c++) {
        var card = L.cards[c];
        if (hit(card, x, y)) return "card" + card.i;
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
        } else if (kind === "range") {
            rangeIdx = item.value;
            emitParam("range", rangeIdx);
        } else if (kind === "phase") {
            phaseMode = item.value;
            emitParam("phase_mode", phaseMode);
            updatePhaseKernel();
        } else if (kind === "bandmode") {
            setBandMode(band, item.value);
        } else if (kind === "bandsel") {
            if (item.value < 0) bottomAnalyzer = 1;
            else {
                bottomAnalyzer = 0;
                setSingleSelection(item.value);
            }
        } else if (kind === "route") {
            set_route(item.value);
        } else if (kind === "scroute") {
            scRoutingName = item.label;
        } else if (kind === "scchan") {
            scChannelName = item.label;
        }
    });
}

function toggleSidechainFold() {
    showSidechainFold = showSidechainFold ? 0 : 1;
    emitParam("sidechain_fold", showSidechainFold);
    applyDeviceWidth();
}
function handleSidechainPointer(g, L, x, y, right) {
    var scp = L.sc;
    if (!scp || !scp.tab) return false;
    if (hit(scp.tab.arrow, x, y) || hit(scp.tab.label, x, y)) {
        toggleSidechainFold();
        return true;
    }
    if (!scp.open || x >= g.plotX) return false;
    if (hit(scp.route, x, y)) {
        var routes = ["Ext. In", "No Input", "Track In"];
        if (right) {
            var ri = 0;
            for (var r = 0; r < routes.length; r++) if (routes[r] === scRoutingName) ri = r;
            scRoutingName = routes[(ri + 1) % routes.length];
            mgraphics.redraw();
        } else {
            var ritems = [];
            for (var r2 = 0; r2 < routes.length; r2++) ritems.push({ label: routes[r2], value: r2 });
            openPopup("scroute", scp.route, ritems, 0, -1);
        }
        return true;
    }
    if (hit(scp.chan, x, y)) {
        var chans = ["1/2", "3/4", "1", "2"];
        if (right) {
            var ci0 = 0;
            for (var c = 0; c < chans.length; c++) if (chans[c] === scChannelName) ci0 = c;
            scChannelName = chans[(ci0 + 1) % chans.length];
            mgraphics.redraw();
        } else {
            var citems = [];
            for (var c2 = 0; c2 < chans.length; c2++) citems.push({ label: chans[c2], value: c2 });
            openPopup("scchan", scp.chan, citems, 0, -1);
        }
        return true;
    }
    if (hit(scp.gain, x, y)) {
        gesture.kind = "refgain";
        gesture.y0 = y;
        gesture.gain0 = refGainDb;
        return true;
    }
    return true;
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
            || (was === "tilt" && key0 === "tilt") || (was === "range" && key0 === "range")
            || (was === "bandmode" && (key0 === "mode" || key0.indexOf("card") === 0))
            || (was === "bandsel" && key0 === "bandsel")
            || (was === "route" && key0 === "route");
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
    if (hit(L.tilt, x, y)) {
        gesture.kind = "tilteq";
        gesture.y0 = y;
        gesture.gain0 = tiltEqDb;
        return;
    }
    if (hit(L.range, x, y)) {
        if (right) {
            discreteEdit(function () {
                rangeIdx = (rangeIdx + 1) % EQP_RANGES.length;
                emitParam("range", rangeIdx);
            });
        } else {
            var ritems = [];
            for (var ri = 0; ri < EQP_RANGES.length; ri++) ritems.push({ label: "\u00b1" + EQP_RANGES[ri], value: ri });
            openPopup("range", L.range, ritems, rangeIdx, -1);
        }
        return;
    }
    if (hit(L.aq, x, y)) {
        discreteEdit(function () {
            adaptiveQ = adaptiveQ ? 0 : 1;
            emitParam("adaptiveq", adaptiveQ);
            updateCoeffBuffer();
        });
        return;
    }
    if (hit(L.route, x, y)) {
        if (right) {
            discreteEdit(function () { set_route((routeMode + 1) % EQP_ROUTES.length); });
        } else {
            var routeItems = [];
            for (var rti = 0; rti < EQP_ROUTES.length; rti++) routeItems.push({ label: EQP_ROUTES[rti], value: rti });
            openPopup("route", L.route, routeItems, routeMode, -1);
        }
        return;
    }
    if (handleSidechainPointer(g, L, x, y, right)) return;
    if (hit(L.bandSel, x, y)) {
        var menu = [];
        for (var bi = 0; bi < EQP_NUM_BANDS; bi++) menu.push({ label: String(bi + 1), value: bi });
        menu.push({ label: "Analyzer", value: -1 });
        var selVal = bottomAnalyzer ? -1 : selectedBand;
        openPopup("bandsel", L.bandSel, menu, selVal, -1);
        return;
    }
    if (hit(L.filtersToggle, x, y)) {
        showFiltersShelf = showFiltersShelf ? 0 : 1;
        applyDeviceWidth();
        return;
    }
    if (hit(L.analyzerToggle, x, y)) {
        showAnalyzerShelf = showAnalyzerShelf ? 0 : 1;
        applyDeviceWidth();
        return;
    }
    if (bottomAnalyzer) {
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
            } else openPopup("res", L.res, itemsFrom(EQP_RESOLUTIONS), resIdx, -1);
            return;
        }
        if (hit(L.speed, x, y)) {
            if (right) {
                discreteEdit(function () {
                    speedIdx = (speedIdx + 1) % EQP_SPEEDS.length;
                    emitParam("speed", speedIdx);
                });
            } else openPopup("speed", L.speed, itemsFrom(EQP_SPEEDS), speedIdx, -1);
            return;
        }
    } else if (selectedBand >= 0) {
        var sb = selectedBand;
        if (hit(L.solo, x, y)) {
            soloBand = (soloBand === sb) ? -1 : sb;
            updateSoloState();
            mgraphics.redraw();
            return;
        }
        if (hit(L.power, x, y)) {
            toggleBandPower(sb);
            return;
        }
        if (hit(L.mode, x, y)) {
            if (right) discreteEdit(function () { cycleBandMode(sb, 1); });
            else openPopup("bandmode", L.mode, modeItems(), bands[sb].mode, sb);
            return;
        }
        if (hit(L.freq, x, y)) { armReadout("freq", sb, y); return; }
        if (hit(L.bandGain, x, y)) { armReadout("bandgain", sb, y); return; }
        if (hit(L.q, x, y)) { armReadout("qread", sb, y); return; }
    }
    if (L.az) {
        if (hit(L.az.phase, x, y)) {
            if (right) {
                discreteEdit(function () {
                    phaseMode = (phaseMode + 1) % EQP_PHASE_MODES.length;
                    emitParam("phase_mode", phaseMode);
                    updatePhaseKernel();
                });
            } else openPopup("phase", L.az.phase, itemsFrom(EQP_PHASE_MODES), phaseMode, -1);
            return;
        }
        if (hit(L.az.pre, x, y)) {
            discreteEdit(function () {
                analyzerPre = analyzerPre ? 0 : 1;
                emitParam("pre", analyzerPre);
            });
            return;
        }
        if (hit(L.az.post, x, y)) {
            discreteEdit(function () {
                analyzerPost = analyzerPost ? 0 : 1;
                emitParam("post", analyzerPost);
            });
            return;
        }
        if (hit(L.az.res, x, y)) {
            if (right) {
                discreteEdit(function () {
                    resIdx = (resIdx + 1) % EQP_RESOLUTIONS.length;
                    emitParam("resolution", resIdx);
                });
            } else openPopup("res", L.az.res, itemsFrom(EQP_RESOLUTIONS), resIdx, -1);
            return;
        }
        if (hit(L.az.speed, x, y)) {
            if (right) {
                discreteEdit(function () {
                    speedIdx = (speedIdx + 1) % EQP_SPEEDS.length;
                    emitParam("speed", speedIdx);
                });
            } else openPopup("speed", L.az.speed, itemsFrom(EQP_SPEEDS), speedIdx, -1);
            return;
        }
        if (hit(L.az.tilt, x, y)) {
            if (right) {
                discreteEdit(function () {
                    tiltIdx = (tiltIdx + 1) % EQP_TILTS.length;
                    emitParam("tilt", tiltIdx);
                });
            } else openPopup("tilt", L.az.tilt, tiltItems(), tiltIdx, -1);
            return;
        }
        if (hit(L.az.rmin, x, y)) { gesture.kind = "rmin"; gesture.y0 = y; gesture.gain0 = rangeMinDb; return; }
        if (hit(L.az.rmax, x, y)) { gesture.kind = "rmax"; gesture.y0 = y; gesture.gain0 = rangeMaxDb; return; }
    }
    for (var ci = 0; ci < L.cards.length; ci++) {
        var card = L.cards[ci];
        if (!hit(card, x, y)) continue;
        setSingleSelection(card.i);
        bottomAnalyzer = 0;
        if (hit(card.power, x, y)) { toggleBandPower(card.i); return; }
        if (!bandLive(bands[card.i]) || hit(card.mode, x, y)) {
            if (right) discreteEdit(function () { cycleBandMode(card.i, 1); });
            else openPopup("bandmode", card.mode, modeItems(), bands[card.i].mode, card.i);
            return;
        }
        if (hit(card.freq, x, y)) { armReadout("freq", card.i, y); return; }
        if (hit(card.gain, x, y)) { armReadout("bandgain", card.i, y); return; }
        if (hit(card.q, x, y)) { armReadout("qread", card.i, y); return; }
        mgraphics.redraw();
        return;
    }
    if (!insidePlot(g, x, y)) return;
    var qh = hitQHandle(g, x, y);
    if (qh >= 0 && !right) {
        setSingleSelection(qh);
        bottomAnalyzer = 0;
        gesture.kind = "qhandle";
        gesture.band = qh;
        gesture.x0 = x;
        gesture.y0 = y;
        gesture.q0 = bands[qh].q;
        mgraphics.redraw();
        return;
    }
    var hb = hitBand(g, x, y);
    if (hb >= 0) {
        if (right) {
            enterInspector(hb);
            setSingleSelection(hb);
            var pxy = bandXY(g, bands[hb]);
            openPopup("bandmode", { x: pxy.x - 8, y: pxy.y, w: 16, h: 16 }, modeItems(), bands[hb].mode, hb);
            mgraphics.redraw();
            return;
        }
        if (shift) {
            toggleBandSelection(hb);
            mgraphics.redraw();
            return;
        }
        if (isBandSelected(hb) && selectedBands.length > 1) selectedBand = hb;
        else setSingleSelection(hb);
        beginDragBand(hb, x, y, option);
        mgraphics.redraw();
        return;
    }
    if (!anyLive()) {
        beginCreate(g, x, y, option);
        mgraphics.redraw();
        return;
    }
    gesture.kind = "marquee";
    gesture.startX = x;
    gesture.startY = y;
    gesture.curX = x;
    gesture.curY = y;
    gesture.moved = false;
    gesture.shift = !!shift;
    gesture.initialSel = selectedBands.slice();
    mgraphics.redraw();
}

function applyMarquee(g, x, y) {
    var x0 = Math.min(gesture.startX, x);
    var y0 = Math.min(gesture.startY, y);
    var x1 = Math.max(gesture.startX, x);
    var y1 = Math.max(gesture.startY, y);
    var hits = [];
    for (var i = 0; i < bands.length; i++) {
        if (!bandLive(bands[i])) continue;
        var p = bandXY(g, bands[i]);
        if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) hits.push(i);
    }
    if (gesture.shift && gesture.initialSel) {
        for (var s = 0; s < gesture.initialSel.length; s++) {
            if (hits.indexOf(gesture.initialSel[s]) < 0) hits.push(gesture.initialSel[s]);
        }
    }
    selectedBands = hits;
    selectedBand = hits.length ? hits[0] : -1;
}
function ondrag(x, y, but, cmd, shift, capslock, option, ctrl) {
    var g = geo();
    gesture.fine = !!shift;
    if (gesture.kind === "marquee") {
        if (but === 0) {
            if (!gesture.moved) {
                if (selectedBands.length > 1) {
                    setSingleSelection(selectedBand >= 0 ? selectedBand : selectedBands[0]);
                } else {
                    beginCreate(g, gesture.startX, gesture.startY, false);
                }
            }
            finishGesture();
            return;
        }
        gesture.curX = x;
        gesture.curY = y;
        if (Math.abs(x - gesture.startX) > 4 || Math.abs(y - gesture.startY) > 4) {
            gesture.moved = true;
            applyMarquee(g, x, y);
        }
        mgraphics.redraw();
        return;
    }
    if (but === 0) {
        finishGesture();
        return;
    }
    hoverX = x;
    hoverY = y;
    if (gesture.kind === "shift") dragShift(g, y);
    else if (gesture.kind === "gain" || gesture.kind === "refgain") {
        if (gesture.kind === "refgain") {
            var dyG = (gesture.y0 - y) / Math.max(0.001, g.sy);
            var sensG = gesture.fine ? 0.04 : 0.15;
            var gv = clamp(roundTo(gesture.gain0 + dyG * sensG, 0.1), -24, 24);
            if (gv !== refGainDb) {
                markDirty();
                refGainDb = gv;
                emitParam("ref_gain", refGainDb);
            }
        } else dragOutGain(g, y);
    }
    else if (gesture.kind === "tilteq") dragTiltEq(g, y);
    else if (gesture.kind === "band") dragBand(g, x, y);
    else if (gesture.kind === "freq" || gesture.kind === "bandgain" || gesture.kind === "qread") dragReadout(g, y);
    else if (gesture.kind === "qhandle") dragQHandle(g, x, y);
    else if (gesture.kind === "rmin" || gesture.kind === "rmax") {
        var dyR = (gesture.y0 - y) / Math.max(0.001, g.sy);
        if (gesture.kind === "rmin") rangeMinDb = clamp(Math.round(gesture.gain0 + dyR * 0.6), -144, -21);
        else rangeMaxDb = clamp(Math.round(gesture.gain0 + dyR * 0.6), -120, 30);
        markDirty();
    }
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
    if (hit(L.tilt, x, y)) {
        if (Math.abs(tiltEqDb) > 0.05) {
            if (!undoArmed) pushUndoState();
            tiltEqDb = 0;
            emitParam("tilt_eq", tiltEqDb);
            updateCoeffBuffer();
            if (typeof notifyclients === "function") notifyclients();
        }
        undoArmed = false;
        gesture.dirty = false;
        mgraphics.redraw();
        return;
    }
    if (L.sc && hit(L.sc.gain, x, y)) {
        if (Math.abs(refGainDb) > 0.05) {
            if (!undoArmed) pushUndoState();
            refGainDb = 0;
            emitParam("ref_gain", refGainDb);
            if (typeof notifyclients === "function") notifyclients();
        }
        undoArmed = false;
        gesture.dirty = false;
        mgraphics.redraw();
        return;
    }
    if (selectedBand >= 0) {
        var sb = selectedBand;
        var reset = hit(L.freq, x, y) || hit(L.bandGain, x, y) || hit(L.q, x, y);
        var card = null;
        for (var ci = 0; ci < L.cards.length; ci++) if (L.cards[ci].i === sb && hit(L.cards[ci], x, y)) card = L.cards[ci];
        if (card && !bandLive(bands[sb])) {
            discreteEdit(function () {
                bands[sb].enabled = 1;
                bands[sb].mode = 6;
                if (!(bands[sb].q > 0)) bands[sb].q = EQP_Q_DEFAULT;
                emitBand(sb);
                updateCoeffBuffer();
            });
            undoArmed = false;
            return;
        }
        if (card) {
            if (hit(card.freq, x, y) || hit(card.gain, x, y) || hit(card.q, x, y)) reset = true;
        }
        if (reset) {
            discreteEdit(function () {
                var b = bands[sb];
                if (hit(L.freq, x, y) || (card && hit(card.freq, x, y))) b.freq = EQP_DEFAULT_BAND_FREQS[sb];
                if (hit(L.bandGain, x, y) || (card && hit(card.gain, x, y))) b.gain = 0;
                if (hit(L.q, x, y) || (card && hit(card.q, x, y))) b.q = EQP_Q_DEFAULT;
                emitBand(sb);
                updateCoeffBuffer();
                noteSolo(sb);
            });
            undoArmed = false;
            return;
        }
    }
    var qHit = hitQHandle(g, x, y);
    if (qHit >= 0) {
        var qBand = bands[qHit];
        if (qBand && Math.abs(qBand.q - EQP_Q_DEFAULT) > 0.0001) {
            discreteEdit(function () {
                qBand.q = EQP_Q_DEFAULT;
                emitBand(qHit);
                updateCoeffBuffer();
                noteSolo(qHit);
            });
        }
        undoArmed = false;
        gesture.dirty = false;
        mgraphics.redraw();
        return;
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
    var fine = wheelShift(arguments);
    if (popup) closePopup();
    var g = geo();
    var L = uiLayout(g);
    if (inspectorMode && selectedBand >= 0 && hit(L.q, x, y)) {
        adjustQ(selectedBand, dy, fine);
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
    if (hb >= 0) adjustQ(hb, dy, fine);
}

function onidle(x, y) {
    pointerIn = true;
    var g = geo();
    var moved = x !== hoverX || y !== hoverY;
    hoverX = x;
    hoverY = y;
    var key = hoverTarget(g, x, y);
    var band = insidePlot(g, x, y) ? hitBand(g, x, y) : -1;
    var pop = hitPopup(x, y);
    var changed = key !== hoverKey || band !== hoverBand || pop !== hoverPop;
    hoverKey = key;
    hoverBand = band;
    hoverPop = pop;
    syncHoverCursor(g);
    if (changed || (insidePlot(g, x, y) && moved)) mgraphics.redraw();
}
function onidleout() {
    pointerIn = false;
    var was = cursorHidden || !!hoverKey || hoverBand >= 0 || hoverPop >= 0;
    hoverKey = "";
    hoverBand = -1;
    hoverPop = -1;
    setCursorHidden(false);
    if (was) mgraphics.redraw();
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
    setRgb(COL_GRID, 0.45);
    for (var m = 0; m < minors.length; m++) {
        var x = freqToX(g, minors[m]);
        mgraphics.move_to(x, g.plotY);
        mgraphics.line_to(x, g.plotY + g.plotH);
        mgraphics.stroke();
    }
    setRgb(COL_GRID, 0.85);
    for (var a = 0; a < majors.length; a++) {
        var mx = freqToX(g, majors[a][0]);
        mgraphics.move_to(mx, g.plotY);
        mgraphics.line_to(mx, g.plotY + g.plotH);
        mgraphics.stroke();
    }
    var zy = zeroY(g);
    var mid = g.plotY + g.plotH * 0.5;
    setRgb(COL_GRID, 0.55);
    mgraphics.move_to(g.plotX, g.plotY + g.plotH * 0.25);
    mgraphics.line_to(g.plotX + g.plotW, g.plotY + g.plotH * 0.25);
    mgraphics.stroke();
    mgraphics.move_to(g.plotX, g.plotY + g.plotH * 0.75);
    mgraphics.line_to(g.plotX + g.plotW, g.plotY + g.plotH * 0.75);
    mgraphics.stroke();
    setRgb(COL_AXIS, 0.9);
    mgraphics.move_to(g.plotX, zy);
    mgraphics.line_to(g.plotX + g.plotW, zy);
    mgraphics.stroke();
    if (Math.abs(zy - mid) > 1.5) {
        setRgb(COL_GRID, 0.4);
        mgraphics.move_to(g.plotX, mid);
        mgraphics.line_to(g.plotX + g.plotW, mid);
        mgraphics.stroke();
    }
    var labelSize = fs(g, 8.5);
    var labelY = g.plotY + 11 * g.sy;
    var rd = rangeDb();
    var scalePad = textW("+" + rd, labelSize, false) + 6 * g.sx;
    var rightLimit = g.plotX + g.plotW - scalePad;
    for (var t = 0; t < majors.length; t++) {
        var lineX = freqToX(g, majors[t][0]);
        var label = majors[t][1];
        var tw = textW(label, labelSize, false);
        var lx = lineX + 3 * g.sx;
        if (lx + tw > rightLimit) lx = lineX - tw - 3 * g.sx;
        drawText(label, lx, labelY, labelSize, COL_AXIS, "left", false);
    }
    var rx = g.plotX + g.plotW - 4 * g.sx;
    drawText("+" + rd, rx, g.plotY + 10 * g.sy, labelSize, COL_AXIS, "right", false);
    drawText("-" + rd, rx, g.plotY + g.plotH - 4 * g.sy, labelSize, COL_AXIS, "right", false);
}

function paintSpectrum(g) {
    if (!specHasSignal) return;
    if (!analyzerPre && !analyzerPost && !refEnabled) return;
    var bottom = g.plotY + g.plotH;
    var floorGate = rangeMinDb + 0.5;
    function hasEnergy(series) {
        for (var i = 0; i < series.length; i++) if (series[i] > floorGate) return true;
        return false;
    }
    function traceTop(series) {
        var n = series.length;
        if (!n || !hasEnergy(series)) return;
        mgraphics.move_to(freqToX(g, specFreq(0)), specY(g, series[0]));
        for (var i = 1; i < n; i++) mgraphics.line_to(freqToX(g, specFreq(i)), specY(g, series[i]));
    }
    function fillSpans(series) {
        var n = series.length;
        if (!n || !hasEnergy(series)) return;
        mgraphics.move_to(freqToX(g, specFreq(0)), bottom);
        for (var i = 0; i < n; i++) mgraphics.line_to(freqToX(g, specFreq(i)), specY(g, series[i]));
        mgraphics.line_to(freqToX(g, specFreq(n - 1)), bottom);
        mgraphics.close_path();
    }
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("round");
    if (mgraphics.set_line_join) mgraphics.set_line_join("round");
    var preDraw = analyzerPre ? smoothSpectrumLine(specPre) : null;
    var postDraw = analyzerPost ? smoothSpectrumLine(specPost) : null;
    var refDraw = refEnabled ? smoothSpectrumLine(specRef) : null;
    if (preDraw) {
        fillSpans(preDraw);
        setRgb(COL_LABEL, 0.16);
        mgraphics.fill();
        traceTop(preDraw);
        setRgb(COL_LABEL, 0.4);
        mgraphics.set_line_width(1);
        mgraphics.stroke();
    }
    if (postDraw) {
        traceTop(postDraw);
        setRgb(COL_SPEC, 0.85);
        mgraphics.set_line_width(1.25);
        mgraphics.stroke();
    }
    if (refDraw) {
        fillSpans(refDraw);
        setRgb(COL_REF, 0.14);
        mgraphics.fill();
        traceTop(refDraw);
        setRgb(COL_REF, 0.9);
        mgraphics.set_line_width(1.35);
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
        ys[i] = eqYFree(g, responseDb(f));
    }
    return { xs: xs, ys: ys };
}

function focusIndex() {
    if ((gesture.kind === "band" || gesture.kind === "qhandle") && gesture.band >= 0) return gesture.band;
    if (hoverBand >= 0 && bands[hoverBand] && bandLive(bands[hoverBand])) return hoverBand;
    return selectedBand;
}
function paintCurve(g) {
    var c = sampleCurve();
    if (routeSplit(routeMode)) {
        var other = bands === bandsB ? bandsA : bandsB;
        setRgb(COL_LABEL, 0.45);
        mgraphics.set_line_width(1);
        for (var gi = 0; gi < COLS - 1; gi++) {
            strokeClipped(c.xs[gi], eqYFree(g, responseDbOf(other, colFreq(gi))), c.xs[gi + 1], eqYFree(g, responseDbOf(other, colFreq(gi + 1))), g);
        }
    }
    var focus = focusIndex();
    if (focus >= 0 && focus < bands.length && bandLive(bands[focus])) {
        for (var si = 0; si < bands.length; si++) {
            if (si === focus || !bandLive(bands[si]) || !isBandSelected(si)) continue;
            setRgb(COL_LABEL, 0.4);
            mgraphics.set_line_width(1);
            for (var ks = 0; ks < COLS - 1; ks++) {
                strokeClipped(c.xs[ks], eqYFree(g, bandDb(bands[si], colFreq(ks))), c.xs[ks + 1], eqYFree(g, bandDb(bands[si], colFreq(ks + 1))), g);
            }
        }
        var b = bands[focus];
        setRgb(COL_FOCUS, 0.95);
        mgraphics.set_line_width(1.2);
        for (var k = 0; k < COLS - 1; k++) {
            strokeClipped(c.xs[k], eqYFree(g, bandDb(b, colFreq(k))), c.xs[k + 1], eqYFree(g, bandDb(b, colFreq(k + 1))), g);
        }
    }
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("round");
    if (mgraphics.set_line_join) mgraphics.set_line_join("round");
    mgraphics.set_line_width(3);
    setRgb(COL_CURVE, 0.22);
    for (var s = 0; s < COLS - 1; s += 2) {
        var j = Math.min(COLS - 1, s + 2);
        strokeClipped(c.xs[s], c.ys[s], c.xs[j], c.ys[j], g);
    }
    mgraphics.set_line_width(1.5);
    setRgb(COL_CURVE, 1);
    for (var s2 = 0; s2 < COLS - 1; s2 += 2) {
        var j2 = Math.min(COLS - 1, s2 + 2);
        strokeClipped(c.xs[s2], c.ys[s2], c.xs[j2], c.ys[j2], g);
    }
}

function paintMarquee(g) {
    if (gesture.kind !== "marquee" || !gesture.moved) return;
    var x0 = Math.min(gesture.startX, gesture.curX);
    var y0 = Math.min(gesture.startY, gesture.curY);
    var w = Math.abs(gesture.curX - gesture.startX);
    var h = Math.abs(gesture.curY - gesture.startY);
    mgraphics.rectangle(x0, y0, w, h);
    setRgb(COL_LABEL, 0.12);
    mgraphics.fill();
    mgraphics.rectangle(x0, y0, w, h);
    setRgb(COL_LABEL, 0.55);
    mgraphics.set_line_width(1);
    mgraphics.stroke();
}
function paintHandles(g) {
    var focus = focusIndex();
    if (focus >= 0 && bands[focus] && bandLive(bands[focus])) {
        var fp = bandXY(g, bands[focus]);
        mgraphics.move_to(fp.x, g.plotY);
        mgraphics.line_to(fp.x, g.plotY + g.plotH);
        setRgb(COL_LABEL, 0.75);
        mgraphics.set_line_width(1);
        mgraphics.stroke();
    }
    var r = NODE_R;
    var ink = COL_INK;
    for (var i = 0; i < bands.length; i++) {
        if (!bandLive(bands[i])) continue;
        var p = bandXY(g, bands[i]);
        var ring = (i === selectedBand) || (selectedBands.length > 1 && selectedBands.indexOf(i) >= 0);
        if (ring) {
            mgraphics.ellipse(p.x - r - 1.65, p.y - r - 1.65, (r + 1.65) * 2, (r + 1.65) * 2);
            setRgb(COL_ORANGE, 1);
            mgraphics.set_line_width(1.05);
            mgraphics.stroke();
        }
        mgraphics.ellipse(p.x - r, p.y - r, r * 2, r * 2);
        mgraphics.set_source_rgba(1, 1, 1, 1);
        mgraphics.fill();
        drawText(String(i + 1), p.x, p.y + fs(g, 2.3), fs(g, 6), ink, "center", true);
    }
    if (focus >= 0 && bands[focus] && bandLive(bands[focus])) {
        var qp = qHandlePos(g, focus);
        var qr = QH_R;
        mgraphics.ellipse(qp.x - qr, qp.y - qr, qr * 2, qr * 2);
        mgraphics.set_source_rgba(1, 1, 1, 1);
        mgraphics.fill();
        drawHArrow(qp.x, qp.y);
    }
}
function drawHArrow(x, y) {
    var s = 0.75;
    setRgb(COL_INK, 1);
    mgraphics.set_line_width(1.15 * s);
    mgraphics.move_to(x - 4.2 * s, y);
    mgraphics.line_to(x + 4.2 * s, y);
    mgraphics.stroke();
    mgraphics.move_to(x - 4.2 * s, y);
    mgraphics.line_to(x - 2.1 * s, y - 1.8 * s);
    mgraphics.move_to(x - 4.2 * s, y);
    mgraphics.line_to(x - 2.1 * s, y + 1.8 * s);
    mgraphics.stroke();
    mgraphics.move_to(x + 4.2 * s, y);
    mgraphics.line_to(x + 2.1 * s, y - 1.8 * s);
    mgraphics.move_to(x + 4.2 * s, y);
    mgraphics.line_to(x + 2.1 * s, y + 1.8 * s);
    mgraphics.stroke();
}

function setCursorHidden(hide) {
    hide = !!hide;
    if (hide === cursorHidden) return;
    cursorHidden = hide;
    try {
        if (typeof max !== "undefined" && max) {
            if (hide && typeof max.hidecursor === "function") max.hidecursor();
            if (!hide && typeof max.showcursor === "function") max.showcursor();
        }
    } catch (e) {}
}
function syncHoverCursor(g) {
    if (!g) g = geo();
    var inPlot = pointerIn && insidePlot(g, hoverX, hoverY);
    var overQ = inPlot && hitQHandle(g, hoverX, hoverY) >= 0;
    if (inPlot) {
        var nx = xToNorm(g, hoverX);
        var ny = yToNorm(g, hoverY);
        currentHoverMode = resolveGestureMode(nx, ny, 0.5);
    }
    var shapeCursor = currentHoverMode !== 6;
    var hide = inPlot && !popup && !gesture.kind && hoverBand < 0 && !overQ && shapeCursor;
    setCursorHidden(hide);
}
function getHoverCursorState() {
    return {
        hidden: cursorHidden,
        mode: currentHoverMode,
        name: hintForMode(currentHoverMode),
        x: hoverX,
        y: hoverY
    };
}

function cursorPt(px, py, ox, oy, s) {
    return [ox + px * s, oy + py * s];
}
function traceFilterShape(mode, up, ox, oy, s) {
    function M(px, py) {
        var p = cursorPt(px, py, ox, oy, s);
        mgraphics.move_to(p[0], p[1]);
    }
    function L(px, py) {
        var p = cursorPt(px, py, ox, oy, s);
        mgraphics.line_to(p[0], p[1]);
    }
    function C(x1, y1, x2, y2, x3, y3) {
        var a = cursorPt(x1, y1, ox, oy, s);
        var b = cursorPt(x2, y2, ox, oy, s);
        var c = cursorPt(x3, y3, ox, oy, s);
        mgraphics.curve_to(a[0], a[1], b[0], b[1], c[0], c[1]);
    }
    function bell(down) {
        var wing = down ? 2.0 : 8.4;
        var peak = down ? 9.6 : 1.2;
        M(0.2, wing);
        L(3.8, wing);
        C(5.6, wing, 6.6, peak, 8, peak);
        C(9.4, peak, 10.4, wing, 12.2, wing);
        L(15.8, wing);
    }
    if (mode === 7) {
        M(0.2, 1.6);
        L(5.4, 1.6);
        L(8, 10.4);
        L(10.6, 1.6);
        L(15.8, 1.6);
        return;
    }
    if (mode === 5 || mode === 8) {
        // Sideways tuning fork: handle, then tines splitting up and down.
        M(0.6, 5.5);
        L(4.6, 5.5);
        C(6.4, 5.5, 7.0, 2.0, 8.8, 2.0);
        L(15.2, 2.0);
        M(4.6, 5.5);
        C(6.4, 5.5, 7.0, 9.0, 8.8, 9.0);
        L(15.2, 9.0);
        return;
    }
    if (mode >= 1 && mode <= 4) {
        M(0.4, 10.2);
        C(2.8, 10.0, 4.2, 2.0, 7.0, 1.8);
        L(15.8, 1.8);
        return;
    }
    if (mode >= 9 && mode <= 12) {
        M(0.2, 1.8);
        L(9.0, 1.8);
        C(11.6, 2.0, 13.0, 10.0, 15.6, 10.2);
        return;
    }
    bell(!up);
}
function drawFilterCursor(g, x, y, mode, ny) {
    var s = Math.min(g.sx, g.sy);
    var up = ny >= 0.5;
    if (mode === 7) {
        var halo = 3.2 * s;
        var ay = zeroY(g);
        mgraphics.ellipse(x - halo, ay - halo, halo * 2, halo * 2);
        mgraphics.set_source_rgba(0, 0, 0, 0.55);
        mgraphics.fill();
        var r = 2.5 * s;
        mgraphics.ellipse(x - r, ay - r, r * 2, r * 2);
        mgraphics.set_source_rgba(1, 1, 1, 0.96);
        mgraphics.fill();
    }
    var ox = x - 8 * s;
    var oy = y - 5.5 * s;
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("round");
    if (mgraphics.set_line_join) mgraphics.set_line_join("round");
    traceFilterShape(mode, up, ox, oy, s);
    mgraphics.set_line_width(3.2 * s);
    mgraphics.set_source_rgba(0, 0, 0, 0.88);
    mgraphics.stroke();
    traceFilterShape(mode, up, ox, oy, s);
    mgraphics.set_line_width(1.6 * s);
    mgraphics.set_source_rgba(1, 1, 1, 0.98);
    mgraphics.stroke();
}

function paintFilterCursor(g) {
    if (!pointerIn || gesture.kind || popup) return;
    if (!insidePlot(g, hoverX, hoverY) || hoverBand >= 0) return;
    if (hitQHandle(g, hoverX, hoverY) >= 0) return;
    if (currentHoverMode === 6) return;
    var ny = yToNorm(g, hoverY);
    drawFilterCursor(g, hoverX, hoverY, currentHoverMode, ny);
}

function drawBellIcon(r, on) {
    var c = on ? COL_ORANGE : COL_AQ_OFF;
    var x = r.x + 1 * (r.w / 30);
    var y = r.y + 2 * (r.h / 17);
    var h = r.h - 4 * (r.h / 17);
    var bellW = r.w * 0.56;
    setRgb(c, 1);
    mgraphics.set_line_width(Math.max(1.2, r.h / 12));
    var steps = 10;
    for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        var gx = x + t * bellW;
        var z = (t - 0.5) * 2.4;
        var bell = Math.exp(-z * z);
        var gy = y + h - bell * (h * 0.78);
        if (i === 0) mgraphics.move_to(gx, gy);
        else mgraphics.line_to(gx, gy);
    }
    mgraphics.stroke();
    var ax = x + bellW + 6 * (r.w / 30);
    var top = y + 0.5;
    var bot = y + h - 0.5;
    var head = Math.max(2.6, r.h * 0.22);
    mgraphics.set_line_width(Math.max(1.15, r.h / 14));
    mgraphics.move_to(ax, top + head * 0.7);
    mgraphics.line_to(ax, bot - head * 0.7);
    mgraphics.stroke();
    setRgb(c, 1);
    mgraphics.move_to(ax, top);
    mgraphics.line_to(ax - head * 0.72, top + head);
    mgraphics.line_to(ax + head * 0.72, top + head);
    mgraphics.close_path();
    mgraphics.fill();
    mgraphics.move_to(ax, bot);
    mgraphics.line_to(ax - head * 0.72, bot - head);
    mgraphics.line_to(ax + head * 0.72, bot - head);
    mgraphics.close_path();
    mgraphics.fill();
}
function drawSpecIcon(r) {
    var bars = [0.42, 0.78, 0.55, 1];
    var bw = Math.max(1.4, 2 * (r.w / 28));
    var gap = Math.max(1, 1.6 * (r.w / 28));
    var x0 = r.x + 3 * (r.w / 28);
    var base = r.y + r.h - 4 * (r.h / 17);
    var maxH = r.h - 8 * (r.h / 17);
    setRgb(COL_BTN_TEXT, 1);
    for (var i = 0; i < bars.length; i++) {
        var bh = Math.max(1, maxH * bars[i]);
        mgraphics.rectangle(x0 + i * (bw + gap), base - bh, bw, bh);
        mgraphics.fill();
    }
    caret(r.x + r.w - 9 * (r.w / 28), r.y + r.h * 0.58, Math.max(4, 5 * (r.w / 28)), COL_CARET);
}
function drawPower(r, on, col) {
    var s = Math.min(r.w, r.h);
    var side = Math.round(s * 0.68);
    if (s >= 15) side = Math.max(6, side - 4);
    var x = Math.round(r.x + (r.w - side) * 0.5);
    var y = Math.round(r.y + (r.h - side) * 0.5);
    if (on) {
        fillRound(x, y, side, side, 1.5, col || COL_ORANGE, 1);
        return;
    }
    fillRound(x, y, side, side, 1.5, COL_BTN, 1);
    rrect(x, y, side, side, 1.5);
    setRgb(COL_DIM, 1);
    mgraphics.set_line_width(1);
    mgraphics.stroke();
}
function cutPoles(mode) {
    var n = mode >= 9 ? mode - 8 : mode;
    if (n === 2) return 2;
    if (n === 3) return 4;
    if (n === 4) return 8;
    return 1;
}
function cutTimes(poles) {
    if (poles >= 8) return "\u00d74";
    if (poles >= 4) return "\u00d72";
    if (poles >= 2) return "\u00d71";
    return "";
}
function drawCutIcon(cx, cy, col, poles, high) {
    var mark = cutTimes(poles);
    var steep = poles >= 8 ? 1.7 : poles >= 4 ? 2.7 : poles >= 2 ? 3.8 : 5.2;
    var top = cy - 3.4;
    var bot = cy + 3.3;
    var left = cx - (mark ? (high ? 7.4 : 2.2) : 6.2);
    var right = cx + (mark ? (high ? 2.2 : 7.4) : 6.2);
    setRgb(col, 1);
    mgraphics.set_line_width(1.2);
    if (!high) {
        mgraphics.move_to(left, bot);
        mgraphics.curve_to(left + steep * 0.2, bot, left + steep, top, left + steep + 0.7, top);
        mgraphics.line_to(right, top);
    } else {
        mgraphics.move_to(left, top);
        mgraphics.line_to(right - steep - 0.7, top);
        mgraphics.curve_to(right - steep, top, right - steep * 0.2, bot, right, bot);
    }
    mgraphics.stroke();
    if (mark) drawText(mark, high ? cx + 7.6 : cx - 7.6, cy + 3.5, 6, col, high ? "right" : "left", false);
}
function drawModeGlyph(mode, x, y, col) {
    setRgb(col, 1);
    mgraphics.set_line_width(1.2);
    if (mode === 0) {
        mgraphics.move_to(x - 3.2, y);
        mgraphics.line_to(x + 3.2, y);
        mgraphics.stroke();
    } else if (mode === 6) {
        mgraphics.move_to(x - 6.4, y);
        mgraphics.line_to(x - 3.2, y - 3.5);
        mgraphics.line_to(x + 3.2, y - 3.5);
        mgraphics.line_to(x + 6.4, y);
        mgraphics.line_to(x + 3.2, y + 3.5);
        mgraphics.line_to(x - 3.2, y + 3.5);
        mgraphics.close_path();
        mgraphics.stroke();
    } else if (mode === 7) {
        mgraphics.move_to(x - 6.4, y - 1.6);
        mgraphics.line_to(x - 2.1, y - 1.6);
        mgraphics.line_to(x, y + 3.6);
        mgraphics.line_to(x + 2.1, y - 1.6);
        mgraphics.line_to(x + 6.4, y - 1.6);
        mgraphics.stroke();
    } else if (mode >= 1 && mode <= 4) {
        drawCutIcon(x, y, col, cutPoles(mode), false);
    } else if (mode >= 9) {
        drawCutIcon(x, y, col, cutPoles(mode), true);
    } else if (mode === 5) {
        mgraphics.move_to(x - 6.2, y - 3.3);
        mgraphics.line_to(x - 1.2, y - 3.3);
        mgraphics.line_to(x - 1.2, y + 3.3);
        mgraphics.line_to(x + 6.2, y + 3.3);
        mgraphics.stroke();
    } else if (mode === 8) {
        mgraphics.move_to(x - 6.2, y + 3.3);
        mgraphics.line_to(x + 1.2, y + 3.3);
        mgraphics.line_to(x + 1.2, y - 3.3);
        mgraphics.line_to(x + 6.2, y - 3.3);
        mgraphics.stroke();
    }
}
function drawHeadphones(r, on) {
    var col = on ? COL_ORANGE : COL_LABEL;
    var pad = 2;
    r = {
        x: r.x + pad,
        y: r.y + pad,
        w: Math.max(4, r.w - pad * 2),
        h: Math.max(4, r.h - pad * 2)
    };
    var w = r.w;
    var h = r.h;
    var cupW = w * 0.26;
    var cupH = h * 0.40;
    var leftX = r.x + w * 0.12;
    var rightX = r.x + w * 0.62;
    var cupY = r.y + h * 0.42;
    var bandY = r.y + h * 0.18;
    setRgb(col, 1);
    mgraphics.set_line_width(Math.max(1, Math.min(w, h) * 0.08));
    mgraphics.move_to(leftX + cupW * 0.42, cupY + cupH * 0.12);
    mgraphics.curve_to(leftX + cupW * 0.1, bandY, rightX + cupW * 0.9, bandY, rightX + cupW * 0.58, cupY + cupH * 0.12);
    mgraphics.stroke();
    mgraphics.ellipse(leftX, cupY, cupW, cupH);
    mgraphics.stroke();
    mgraphics.ellipse(rightX, cupY, cupW, cupH);
    mgraphics.stroke();
}
function drawListIcon(r, on) {
    var col = on ? COL_ORANGE : COL_DIM;
    var rowH = 3.1;
    var blockH = rowH * 3;
    var blockW = 8.6;
    var x0 = r.x + (r.w - blockW) * 0.5;
    var y0 = r.y + (r.h - blockH) * 0.5;
    setRgb(col, 1);
    for (var i = 0; i < 3; i++) {
        var y = y0 + i * rowH;
        mgraphics.rectangle(x0, y + 0.45, 5.6, 1.1);
        mgraphics.fill();
        mgraphics.ellipse(x0 + 6.3, y, 2, 2);
        mgraphics.fill();
    }
}
function drawBarsIcon(r, on) {
    var col = on ? COL_ORANGE : COL_DIM;
    var bars = [0.45, 0.85, 0.55, 1];
    var bw = 1.5;
    var gap = 1.15;
    var maxH = 9;
    var blockW = bars.length * bw + (bars.length - 1) * gap;
    var x0 = r.x + (r.w - blockW) * 0.5;
    var base = r.y + (r.h + maxH) * 0.5;
    setRgb(col, 1);
    for (var i = 0; i < bars.length; i++) {
        var bh = Math.max(2, maxH * bars[i]);
        mgraphics.rectangle(x0 + i * (bw + gap), base - bh, bw, bh);
        mgraphics.fill();
    }
}
function bandInk(b) {
    if (!bandLive(b)) return COL_AQ_OFF;
    return COL_ORANGE;
}
function bottomTextY(r, size) {
    return r.y + r.h - 4;
}
function rowMid(r) {
    return r.y + r.h * 0.5;
}
function paintBottom(g) {
    var L = uiLayout(g);
    var base = bottomTextY(L.bandSel, 9);
    var mid = rowMid(L.bandSel);
    if (bottomAnalyzer) {
        drawSpecIcon(L.bandSel);
        drawText("Analyzer", L.azLabel.x, bottomTextY(L.azLabel, 9), fs(g, 9), COL_LABEL, "left", false);
        drawPillButton(L.pre, "Pre", analyzerPre === 1, g);
        drawPillButton(L.post, "Post", analyzerPost === 1, g);
        drawText("Res", L.resLabel.x, bottomTextY(L.resLabel, 8), fs(g, 8), COL_LABEL, "left", false);
        drawDropdown(L.res, EQP_RESOLUTIONS[resIdx] || "Huge", g);
        drawText("Spd", L.speedLabel.x, bottomTextY(L.speedLabel, 8), fs(g, 8), COL_LABEL, "left", false);
        drawDropdown(L.speed, EQP_SPEEDS[speedIdx] || "Fast", g);
    } else {
        var sb = selectedBand;
        if (sb < 0 || sb >= bands.length) sb = 0;
        var b = bands[sb];
        var live = bandLive(b);
        var col = bandInk(b);
        var grey = COL_BTN_TEXT;
        drawText(String(sb + 1), L.bandSel.x + 7, bottomTextY(L.bandSel, 10), fs(g, 10), COL_WHITE, "center", true);
        caret(L.bandSel.x + L.bandSel.w - 6, mid, 4, COL_DIM);
        drawHeadphones(L.solo, soloBand === sb);
        drawPower(L.power, live, col);
        if (live) {
            drawModeGlyph(b.mode, L.mode.x + 11, mid, col);
            var face = MODE_FACE[b.mode] || "Bell";
            var faceSize = fs(g, 9);
            var faceMax = L.mode.w - 30;
            while (faceSize > fs(g, 7) && textW(face, faceSize, false) > faceMax) faceSize -= 0.5;
            drawText(face, L.mode.x + 22, base, faceSize, col, "left", false);
            caret(L.mode.x + L.mode.w - 6, mid, 4, col);
            drawText(fmtFreq(b.freq), L.freq.x + 2, base, fs(g, 9), col, "left", false);
            var gtxt = fmtSignedDb(b.gain);
            var gcol = usesGain(b.mode) ? col : [col[0], col[1], col[2], 0.35];
            drawText(gtxt, L.bandGain.x + 2, base, fs(g, 9), gcol, "left", false);
            drawText(b.q.toFixed(2), L.q.x + 2, base, fs(g, 9), col, "left", false);
        } else {
            drawText("\u2014 Off", L.mode.x + 2, base, fs(g, 9), grey, "left", false);
            caret(L.mode.x + L.mode.w - 6, mid, 4, grey);
            drawText(fmtFreq(b.freq), L.freq.x + 2, base, fs(g, 9), COL_DIM, "left", false);
            drawText(fmtSignedDb(b.gain), L.bandGain.x + 2, base, fs(g, 9), COL_DIM, "left", false);
            drawText(b.q.toFixed(2), L.q.x + 2, base, fs(g, 9), COL_DIM, "left", false);
        }
    }
    drawListIcon(L.filtersToggle, showFiltersShelf === 1);
    drawBarsIcon(L.analyzerToggle, showAnalyzerShelf === 1);
}
function drawDropdown(r, label, g, textSize, textY) {
    var rad = 2.5 * Math.min(g.sx, g.sy);
    fillRound(r.x, r.y, r.w, r.h, rad, COL_DROP, 1);
    rrect(r.x, r.y, r.w, r.h, rad);
    setRgb(COL_DROP_EDGE, 1);
    mgraphics.set_line_width(1);
    mgraphics.stroke();
    var size = textSize || fs(g, 9);
    var maxW = r.w - 14 * g.sx;
    while (size > fs(g, 7) + 0.1 && textW(label, size, false) > maxW) size -= 0.5;
    drawText(label, r.x + 4 * g.sx, textY == null ? r.y + r.h - 4 * g.sy : textY, size, COL_WHITE, "left", false);
    caret(r.x + r.w - 9 * g.sx, r.y + r.h * 0.58, 5 * g.sx, COL_CARET);
}
function drawPillButton(r, label, on, g) {
    var rad = 2.5 * Math.min(g.sx, g.sy);
    fillRound(r.x, r.y, r.w, r.h, rad, on ? COL_ORANGE : COL_BTN, 1);
    drawText(label, r.x + r.w * 0.5, r.y + r.h - 4 * g.sy, fs(g, 9), on ? COL_BTN_ON_TEXT : COL_BTN_TEXT, "center", false);
}

function drawSideways(str, cx, cy, size, c) {
    mgraphics.save();
    mgraphics.translate(cx, cy);
    mgraphics.rotate(-Math.PI / 2);
    drawText(str, 0, size * 0.35, size, c, "center", false);
    mgraphics.restore();
}
function sidechainPeakDb() {
    var peak = -144;
    if (specRef && specRef.length) {
        for (var i = 0; i < specRef.length; i++) if (specRef[i] > peak) peak = specRef[i];
    }
    return peak;
}
function paintSidechainTab(g, tab) {
    var open = showSidechainFold === 1;
    var on = refEnabled === 1;
    var a = tab.arrow;
    fillRound(a.x, a.y, a.w, a.h, 2, COL_BTN, 1);
    var acx = a.x + a.w * 0.5;
    var acy = a.y + a.h * 0.5;
    setRgb(COL_BTN_TEXT, 1);
    if (open) {
        mgraphics.move_to(acx - 3.4, acy + 1.4);
        mgraphics.line_to(acx + 3.4, acy + 1.4);
        mgraphics.line_to(acx, acy - 2.2);
    } else {
        mgraphics.move_to(acx - 3.4, acy - 1.4);
        mgraphics.line_to(acx + 3.4, acy - 1.4);
        mgraphics.line_to(acx, acy + 2.2);
    }
    mgraphics.close_path();
    mgraphics.fill();
    drawSideways("Sidechain", tab.w * 0.5 + 0.5, 86, fs(g, 9), COL_LABEL);
    var hot = on && sidechainPeakDb() > rangeMinDb + 8;
    mgraphics.arc(tab.w * 0.5, g.h - 11, 2.05, 0, Math.PI * 2);
    setRgb(hot ? COL_ORANGE : COL_DIM, 1);
    mgraphics.fill();
}
function paintSidechain(g) {
    var L = uiLayout(g);
    var scp = L.sc;
    if (!scp || !scp.tab) return;
    var tab = scp.tab;
    setRgb(COL_BEZEL, 1);
    mgraphics.rectangle(0, 0, tab.w, g.h);
    mgraphics.fill();
    setRgb(COL_GRID, 1);
    mgraphics.rectangle(tab.w - 1, 0, 1, g.h);
    mgraphics.fill();
    paintSidechainTab(g, tab);
    if (!scp.open) return;
    var split = g.mainX || EQP_SIDECHAIN_FOLD_W;
    setRgb(COL_GRID, 1);
    mgraphics.rectangle(split - 1, 0, 1, g.h);
    mgraphics.fill();
    drawText("Audio From", scp.route.x, scp.route.y - 6, fs(g, 8), COL_LABEL, "left", false);
    drawShelfDrop(scp.route, scRoutingName, g);
    drawShelfDrop(scp.chan, scChannelName, g);
    drawText("Gain", scp.route.x, scp.gain.y + scp.gain.h - 4, fs(g, 8), COL_LABEL, "left", false);
    drawText(fmtSignedDb(refGainDb), scp.gain.x + scp.gain.w, scp.gain.y + scp.gain.h - 4, fs(g, 9), COL_REF, "right", false);
    var meter = scp.meter;
    fillRound(meter.x, meter.y, meter.w, meter.h, 2, COL_PLOT, 1);
    var frac = clamp01((sidechainPeakDb() - rangeMinDb) / Math.max(1, rangeMaxDb - rangeMinDb));
    if (refEnabled && frac > 0.02) {
        mgraphics.rectangle(meter.x, meter.y, Math.max(2, meter.w * frac), meter.h);
        setRgb(COL_REF, 0.9);
        mgraphics.fill();
    }
}
function init_routing() {
    try {
        if (typeof LiveAPI !== "function") return;
        var api = new LiveAPI(function (args) {
            if (!args) return;
            var name = "";
            for (var i = 0; i < args.length; i++) {
                var token = args[i];
                if (typeof token !== "string") continue;
                if (token === "id" || token === "audio_inputs" || token === "audio_input") continue;
                if (token.length) name = token;
            }
            if (name) {
                scRoutingName = name;
                mgraphics.redraw();
            }
        }, "this_device");
        if (api && api.id) api.property = "audio_inputs";
    } catch (e) {}
}
function paintTop(g) {
    var L = uiLayout(g);
    var ox = g.mainX || 0;
    var size = fs(g, 10);
    var base = 16 * g.sy;
    var val = COL_VALUE;
    drawText("Shift", ox + 10 * g.sx, base, size, COL_LABEL, "left", false);
    drawText(fmtSt(shiftSt), ox + 44 * g.sx, base, size, val, "left", true);
    var gv = COL_VALUE;
    drawText("Gain", ox + 98 * g.sx, base, size, COL_LABEL, "left", false);
    drawText(fmtOut(outGainDb), ox + 130 * g.sx, base, size, gv, "left", true);
    var tv = COL_VALUE;
    drawText("Tilt", L.tilt.x, base, size, COL_LABEL, "left", false);
    drawText(fmtSignedDb(tiltEqDb).replace(" dB", ""), L.tilt.x + L.tilt.w, base, size, tv, "right", true);
    drawText("Range", L.range.x - 36 * g.sx, base, size, COL_LABEL, "left", false);
    drawDropdown(L.range, "\u00b1" + EQP_RANGES[rangeIdx], g, size, base);
    drawBellIcon(L.aq, adaptiveQ === 1);
    drawDropdown(L.route, EQP_ROUTES[routeMode] || "Stereo", g);
}

function paintShelves(g) {
    var L = uiLayout(g);
    for (var i = 0; i < L.cards.length; i++) paintFilterCard(g, L.cards[i]);
    if (L.az) paintAnalyzerShelf(g, L.az);
}
function paintFilterCard(g, card) {
    var b = bands[card.i];
    var live = bandLive(b);
    var sel = card.i === selectedBand;
    var bg = (live || sel) ? COL_BTN : COL_PLOT;
    fillRound(card.x, card.y, card.w, card.h, 3, bg, 1);
    rrect(card.x, card.y, card.w, card.h, 3);
    var edge = sel ? COL_ORANGE : COL_GRID;
    setRgb(edge, 1);
    mgraphics.set_line_width(1);
    mgraphics.stroke();
    var y1 = card.y + 14;
    var y2 = card.y + 32;
    if (!live) {
        var off = COL_DIM;
        drawText("\u2014 Off", card.x + 8, y1 + 8, fs(g, 9), off, "left", false);
        caret(card.x + card.w - 10, card.y + 10, 4, off);
        return;
    }
    var col = sel ? bandInk(b) : COL_LABEL;
    drawPower(card.power, true, col);
    drawModeGlyph(b.mode, card.mode.x + 9, card.mode.y + 8, col);
    drawText(MODE_FACE[b.mode] || "Bell", card.mode.x + 20, y1, fs(g, 8), col, "left", false);
    caret(card.x + card.w - 10, card.y + 10, 4, col);
    drawText(fmtFreq(b.freq), card.freq.x, y2, fs(g, 8), col, "left", false);
    var gcol = usesGain(b.mode) ? col : [col[0], col[1], col[2], 0.35];
    drawText(fmtSignedDb(b.gain), card.gain.x + card.gain.w, y2, fs(g, 8), gcol, "right", false);
    drawText(b.q.toFixed(2), card.q.x + card.q.w, y2, fs(g, 8), col, "right", false);
}
function paintAnalyzerShelf(g, az) {
    fillRound(az.x, az.y, az.w, az.h, 4, COL_BEZEL, 1);
    fillRound(az.x + 4, az.y + 22, az.w - 8, az.h - 28, 3, COL_PLOT, 1);
    var label = COL_LABEL;
    drawText("Phase", az.x + 8, az.phase.y + az.phase.h - 3, fs(g, 8), label, "left", false);
    drawShelfDrop(az.phase, EQP_PHASE_SHORT[phaseMode] || "Zero", g);
    drawText("Enable", az.x + 8, az.pre.y + 12, fs(g, 8), label, "left", false);
    drawPillButton(az.pre, "Pre", analyzerPre === 1, g);
    drawPillButton(az.post, "Post", analyzerPost === 1, g);
    drawText("Resolution", az.x + 8, az.res.y + 12, fs(g, 8), label, "left", false);
    drawShelfDrop(az.res, EQP_RESOLUTIONS[resIdx] || "Huge", g);
    drawText("Speed", az.x + 8, az.speed.y + 12, fs(g, 8), label, "left", false);
    drawShelfDrop(az.speed, EQP_SPEEDS[speedIdx] || "Fast", g);
    var tv = EQP_TILTS[tiltIdx];
    drawText("Tilt", az.x + 8, az.tilt.y + 12, fs(g, 8), label, "left", false);
    drawShelfDrop(az.tilt, (tv === 0 ? "0" : tv.toFixed(1)) + " dB/oct", g);
    drawText("Range (dB)", az.x + 8, az.rmin.y + 12, fs(g, 8), label, "left", false);
    drawValueBox(az.rmin, String(Math.round(rangeMinDb)), g);
    drawValueBox(az.rmax, String(Math.round(rangeMaxDb)), g);
}
function drawShelfDrop(r, label, g) {
    fillRound(r.x, r.y, r.w, r.h, 3, COL_DROP, 1);
    var size = fs(g, 8);
    while (size > 6.5 && textW(label, size, false) > r.w - 12) size -= 0.5;
    drawText(label, r.x + 4, r.y + r.h - 4, size, COL_WHITE, "left", false);
    caret(r.x + r.w - 8, r.y + r.h * 0.58, 4, COL_CARET);
}
function drawValueBox(r, label, g) {
    fillRound(r.x, r.y, r.w, r.h, 2, COL_PLOT, 1);
    rrect(r.x, r.y, r.w, r.h, 2);
    setRgb(COL_DROP_EDGE, 1);
    mgraphics.set_line_width(1);
    mgraphics.stroke();
    drawText(label, r.x + r.w * 0.5, r.y + r.h - 4, fs(g, 8), COL_VALUE, "center", false);
}

function paintPopup(g) {
    if (!popup) return;
    fillRound(popup.x, popup.y, popup.w, popup.h, 4 * g.sx, COL_PLOT, 0.98);
    rrect(popup.x, popup.y, popup.w, popup.h, 4 * g.sx);
    setRgb(COL_GRID, 1);
    mgraphics.set_line_width(1);
    mgraphics.stroke();
    for (var i = 0; i < popup.rects.length; i++) {
        var r = popup.rects[i];
        var sel = popup.selected === r.item.value;
        if (i === hoverPop) {
            fillRound(r.x, r.y, r.w, r.h, 2, COL_LABEL, 0.12);
        }
        var col = sel ? COL_ORANGE : COL_LABEL;
        var labelX = r.x + 4 * g.sx;
        if (popup.kind === "bandmode") {
            drawModeGlyph(r.item.value, r.x + 12 * g.sx, r.y + r.h * 0.5, col);
            labelX = r.x + 24 * g.sx;
        }
        drawText(r.item.label, labelX, r.y + r.h - 3 * g.sy, fs(g, 8.5), col, "left", sel);
    }
}

// Transparent live.* faces sit on the drawn controls so Live's right-click menu
// (Show Automation, Map to Macro, MIDI/Key map) lands on the real parameter.
// The curve nodes stay on the v8ui: one node is both frequency and gain.
var eqpFaceCache = {};
var eqpFaceOrigin = null;
function eqpFacePatcher() {
    var host = hostPatcher();
    return host || null;
}
function eqpFaceOriginXY() {
    if (eqpFaceOrigin) return eqpFaceOrigin;
    var o = [4, 4];
    var p = eqpFacePatcher();
    try {
        var ui = p && p.getnamed ? p.getnamed("obj-viz") : null;
        var r = ui ? ui.getattr("presentation_rect") : null;
        if (r && r.length >= 2) o = [Number(r[0]) || 0, Number(r[1]) || 0];
    } catch (e) {}
    eqpFaceOrigin = o;
    return o;
}
function eqpFacesWanted(g) {
    var want = {};
    if (popup) return want;
    var L = uiLayout(g);
    function put(name, r) {
        if (!r || !(r.w > 1) || !(r.h > 1)) return;
        want[name] = [r.x, r.y, r.w, r.h];
    }
    put("Global Shift", L.shift);
    put("Output Gain", L.gain);
    put("Tilt Filter", L.tilt);
    put("Stereo Route", L.route);
    var onBar = {};
    if (!bottomAnalyzer) {
        var sb = selectedBand;
        if (sb < 0 || sb >= bands.length) sb = 0;
        var n = sb + 1;
        put("Band " + n + " Enable", L.power);
        put("Band " + n + " Freq", L.freq);
        put("Band " + n + " Gain", L.bandGain);
        put("Band " + n + " Q", L.q);
        onBar[sb] = 1;
    }
    if (showFiltersShelf) {
        for (var c = 0; c < L.cards.length; c++) {
            var card = L.cards[c];
            if (onBar[card.i]) continue;
            var cn = card.i + 1;
            put("Band " + cn + " Enable", card.power);
            put("Band " + cn + " Freq", card.freq);
            put("Band " + cn + " Gain", card.gain);
            put("Band " + cn + " Q", card.q);
        }
    }
    return want;
}
function eqpFaceApply(want) {
    var p = eqpFacePatcher();
    if (!p || !p.getnamed) return;
    var origin = eqpFaceOriginXY();
    var name;
    for (name in eqpFaceCache) {
        if (!eqpFaceCache.hasOwnProperty(name) || want[name]) continue;
        var hide = p.getnamed(name);
        if (hide) {
            try {
                hide.setattr("hidden", 1);
                hide.setattr("presentation_rect", 0, 0, 1, 1);
            } catch (e1) {}
        }
        delete eqpFaceCache[name];
    }
    for (name in want) {
        if (!want.hasOwnProperty(name)) continue;
        var r = want[name];
        var x = Math.round((origin[0] + r[0]) * 100) / 100;
        var y = Math.round((origin[1] + r[1]) * 100) / 100;
        var w = Math.round(r[2] * 100) / 100;
        var h = Math.round(r[3] * 100) / 100;
        var sig = x + "," + y + "," + w + "," + h;
        if (eqpFaceCache[name] === sig) continue;
        var face = p.getnamed(name);
        if (!face) continue;
        var wasHidden = eqpFaceCache[name] === undefined;
        try {
            face.setattr("presentation_rect", x, y, w, h);
            if (wasHidden) {
                face.setattr("hidden", 0);
                var front = p["bringtofront"];
                if (typeof front === "function") front.call(p, face);
            }
        } catch (e2) { continue; }
        eqpFaceCache[name] = sig;
    }
}
function paintDsp(g) {
    if (!eqpDsp.started || eqpDsp.ready) return;
    var msg = eqpDsp.error ? ("DSP failed: " + eqpDsp.error) : "DSP loading…";
    var col = eqpDsp.error ? COL_ALERT : COL_ORANGE;
    drawText(msg, g.plotX + 6 * g.sx, g.plotY + g.plotH - 6 * g.sy, fs(g, 8), col, "left", false);
}

function paint() {
    try {
        eqpApplyTheme();
        var g = geo();
        syncHoverCursor(g);
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
        paintMarquee(g);
        var ox = g.mainX || 0;
        var mainW = g.mainW || 352;
        setRgb(COL_CHROME, 1);
        mgraphics.rectangle(ox, 0, mainW, g.plotY);
        mgraphics.fill();
        mgraphics.rectangle(ox, g.plotY + g.plotH, mainW, g.h - (g.plotY + g.plotH));
        mgraphics.fill();
        if (g.plotX > ox + 0.5) {
            mgraphics.rectangle(ox, 0, g.plotX - ox, g.h);
            mgraphics.fill();
        }
        var rightSliver = ox + mainW - (g.plotX + g.plotW);
        if (rightSliver > 0.5) {
            mgraphics.rectangle(g.plotX + g.plotW, 0, rightSliver, g.h);
            mgraphics.fill();
        }
        paintSidechain(g);
        paintTop(g);
        paintBottom(g);
        paintShelves(g);
        paintFilterCursor(g);
        paintDsp(g);
        rrect(0.5, 0.5, ox + mainW - 1, g.h - 1, 5);
        setRgb(COL_BEZEL, 1);
        mgraphics.set_line_width(1);
        mgraphics.stroke();
        paintPopup(g);
        eqpFaceApply(eqpFacesWanted(g));
    } catch (err) {
        post("EQ+: paint " + err + "\n");
    }
}

// ---------------------------------------------------------------------------------------------
// Inlet messages (automation echo and buffer / rate binding)
// ---------------------------------------------------------------------------------------------

function set_shift(v) {
    if (gesture.kind === "shift") return;
    var n = clamp(roundTo(finite(v, shiftSt), 0.01), EQP_SHIFT_MIN, EQP_SHIFT_MAX);
    if (n === shiftSt) return;
    shiftSt = n;
    updateCoeffBuffer();
    noteSolo();
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
function set_route(v) {
    var n = decodeRoute(v);
    if (n === routeMode) return;
    if (gesture.kind) finishGesture();
    focusRoute(n);
    for (var i = 0; i < EQP_NUM_BANDS; i++) emitBand(i);
    emitParam("route", routeMode);
    updateCoeffBuffer();
    updateSoloState();
    mgraphics.redraw();
}
function set_phase_mode(v) {
    var m = Math.round(finite(v, phaseMode));
    if (m !== 0 && m !== 1 && m !== 2) m = 0;
    if (m === phaseMode) return;
    phaseMode = m;
    updatePhaseKernel();
    mgraphics.redraw();
}
function set_tilt_eq(v) {
    if (gesture.kind === "tilteq") return;
    var n = clamp(roundTo(finite(v, tiltEqDb), 0.1), -24, 24);
    if (n === tiltEqDb) return;
    tiltEqDb = n;
    updateCoeffBuffer();
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
    noteSolo();
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
function set_filters_shelf(v) {
    var n = finite(v, showFiltersShelf) > 0.5 ? 1 : 0;
    if (n === showFiltersShelf) return;
    showFiltersShelf = n;
    resizeDeviceBoxes();
    mgraphics.redraw();
}
function set_analyzer_shelf(v) {
    var n = finite(v, showAnalyzerShelf) > 0.5 ? 1 : 0;
    if (n === showAnalyzerShelf) return;
    showAnalyzerShelf = n;
    resizeDeviceBoxes();
    mgraphics.redraw();
}
function set_sidechain_fold(v) {
    var n = finite(v, showSidechainFold) > 0.5 ? 1 : 0;
    if (n === showSidechainFold) return;
    showSidechainFold = n;
    resizeDeviceBoxes();
    mgraphics.redraw();
}
function set_ref(v) {
    var n = finite(v, refEnabled) > 0.5 ? 1 : 0;
    if (n === refEnabled) return;
    refEnabled = n;
    emitParam("ref_enable", refEnabled);
    mgraphics.redraw();
}
function set_ref_enable(v) { set_ref(v); }
function set_ref_gain(v) {
    var n = clamp(roundTo(finite(v, refGainDb), 0.1), -24, 24);
    if (n === refGainDb) return;
    refGainDb = n;
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
    if (mode === 0) b.enabled = 0;
    if (b.enabled && !(b.q > 0)) b.q = EQP_Q_DEFAULT;
    updateCoeffBuffer();
    noteSolo(i);
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
    noteSolo(i);
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
    noteSolo(i);
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
    noteSolo(i);
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
    noteSolo(i);
    mgraphics.redraw();
}
function set_selected(i) {
    setSingleSelection(clamp(Math.round(finite(i, -1)), -1, EQP_NUM_BANDS - 1));
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
function setbuffers(cfgName, specName, irName) {
    if (cfgName) cfgBufName = String(cfgName);
    if (specName) specBufName = String(specName);
    if (irName) irBufName = String(irName);
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
    else if (name === "TiltEQ" || name === "TiltFilter") set_tilt_eq(a0);
    else if (name === "PhaseMode" || name === "Phase" || name === "Processing") set_phase_mode(a0);
    else if (name === "RangeMin") set_rangemin(a0);
    else if (name === "RangeMax") set_rangemax(a0);
    else if (name === "sr" || name === "samplerate") sr(a0);
    else if (name === "frametick") frametick(a0);
}

function loadbang() {
    updateCoeffBuffer();
    eqpDspResend();
    eqpThemeWatch();
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
    tiltEqDb = 0;
    phaseMode = 0;
    rangeMinDb = -100;
    rangeMaxDb = 0;
    inspectorMode = 0;
    setSingleSelection(0);
    bottomAnalyzer = 0;
    soloBand = -1;
    showFiltersShelf = 0;
    showAnalyzerShelf = 0;
    showSidechainFold = 0;
    refEnabled = 0;
    refGainDb = 0;
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
    setCursorHidden(false);
    recentCreate.band = -1;
}
function preview() {
    resetPreviewChrome();
    resetBands();
    bands[0].enabled = 1;
    bands[0].mode = 10;
    bands[0].freq = 11100;
    bands[0].gain = 0;
    bands[0].q = 2.13;
    bands[1].enabled = 1;
    bands[1].mode = 6;
    bands[1].freq = 1450;
    bands[1].gain = 4.2;
    bands[1].q = 0.90;
    setSingleSelection(1);
    specHasSignal = 0;
    specHoldPreview = false;
    allocSpec();
    updateCoeffBuffer();
    resizeDeviceBoxes();
    mgraphics.redraw();
}
function preview_shelves() {
    preview();
    showFiltersShelf = 1;
    showAnalyzerShelf = 1;
    applyDeviceWidth();
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
