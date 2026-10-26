mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 2;

var AN_PREVIEW = 0;

// Ableton Live 12 native pro strip. Same buffer, blob and hit targets as the
// shipping face; the drawing is a flat card layout with calibrated plots.

var anMask = AN_PREVIEW > 0 ? (AN_PREVIEW & 15) : AN_DEFAULT_FOLD;
var anOrder = anDefaultOrder();
var anSpecType = 0;
var anScopeMode = 0;
var anScopeTime = 1;
var anTrigger = 0;
var anF = [AN_XOVER_DEFAULT[0], AN_XOVER_DEFAULT[1], AN_XOVER_DEFAULT[2]];
var anBufName = "---analyzerscope";
var anFrozen = 0;
/** @type {{ mom: number, short: number, rms: number, tp: number, lra: number | null, spark: number[] } | null} */
var anHold = null;
/** @type {{ kind: string, index: number, x0: number, y0: number, moved: number } | null} */
var anDrag = null;
var anHoverKind = "";
var anHoverSlot = -1;
var AN_MAX_UNDO = 32;
/** @type {Array<{ mask: number, order: number[], specType: number, scopeMode: number, scopeTime: number, trigger: number, f1: number, f2: number, f3: number }>} */
var anUndoStack = [];
/** @type {Array<{ mask: number, order: number[], specType: number, scopeMode: number, scopeTime: number, trigger: number, f1: number, f2: number, f3: number }>} */
var anRedoStack = [];
var anLoud = anLoudCreate();
/** @type {number[][]} */
var anHeat = [];
/** @type {number[]} */
var anBars = [];
/** @type {number[]} */
var anPeak = [];
/** @type {Array<{ corr: number, width: number, bal: number }> | null} */
var anBands = null;
/** @type {number[] | null} */
var anScopeL = null;
/** @type {number[] | null} */
var anScopeR = null;
var anSr = 48000;
var anFrame = 0;
var anPktSeen = -1;
/** @type {Task | null} */
var anPollTask = null;
var anThemeOn = 0;
var anSpecTick = 0;
var anDemoReady = 0;
/** @type {number[] | null} */
var anFftRev = null;
/** @type {number[] | null} */
var anFftWin = null;
/** @type {number[] | null} */
var anFftRe = null;
/** @type {number[] | null} */
var anFftIm = null;
/** @type {number[] | null} */
var anFftPow = null;

var AN_SPEC_NAMES = ["Heat", "Fall", "Bars"];
var AN_MODE_NAMES = ["L/R", "Mid", "Side", "XY"];
var AN_TRIG_NAMES = ["Auto", "Free"];
var AN_BAND_NAMES = ["Low", "L-M", "H-M", "High"];
var AN_ZONE_NAMES = ["Low", "Lo-M", "Hi-M", "High"];
var AN_TIP_NAMES = ["Spectrum", "Oscilloscope", "Stereo", "Loudness"];
var AN_LOUD_ROWS = [
    ["INT", "LU"],
    ["SHORT", "LU"],
    ["MOM", "LU"],
    ["RMS", "dB"],
    ["TP", "dBTP"],
    ["LRA", "LU"]
];
var AN_HZ_GRID = [60, 100, 250, 500, 1000, 2000, 4000, 8000, 16000];
var AN_HZ_LABELS = [50, 100, 250, 500, 1000, 2000, 5000, 10000, 18000];

function anLive() {
    return typeof Task !== "undefined" && !(AN_PREVIEW > 0);
}

function anSendXover() {
    outlet(1, "f1", anF[0]);
    outlet(1, "f2", anF[1]);
    outlet(1, "f3", anF[2]);
}

function anApplyWidth() {
    var w = anFoldWidth(anMask, anOrder);
    outlet(0, "setwidth", w);
    if (!anHost) return;
    try {
        var viz = anHost.getnamed("AnalyzerViz");
        if (viz) viz.setattr("presentation_rect", 0, 0, w, AN_H);
        var body = anHost.getnamed("obj-panel-body");
        if (body) body.setattr("presentation_rect", 0, 0, w, AN_H);
    } catch (err) {}
}

function anPeek(start, count) {
    if (!anBufName || typeof Buffer !== "function") return null;
    try {
        var buf = new Buffer(anBufName);
        if (!buf || typeof buf.peek !== "function") return null;
        var chunk = buf.peek(1, start, count);
        if (typeof chunk === "number") return [chunk];
        if (!chunk || !chunk.length) return null;
        return chunk;
    } catch (err) {
        return null;
    }
}

function anPeekN(start, count) {
    /** @type {number[]} */
    var out = [];
    var i;
    for (i = 0; i < count; i += 2048) {
        var n = Math.min(2048, count - i);
        var chunk = anPeek(start + i, n);
        if (!chunk) return null;
        var k;
        for (k = 0; k < n; k++) out.push(Number(chunk[k]) || 0);
    }
    return out;
}

function anReadWrapped(base, len, head, count) {
    if (count > len) count = len;
    var start = head - count;
    while (start < 0) start += len;
    if (start + count <= len) return anPeekN(base + start, count);
    var first = len - start;
    var a = anPeekN(base + start, first);
    var b = anPeekN(base, count - first);
    if (!a || !b) return null;
    var out = new Array(count);
    var i;
    for (i = 0; i < first; i++) out[i] = a[i];
    for (i = 0; i < b.length; i++) out[first + i] = b[i];
    return out;
}

function anConsume() {
    var hdr = anPeek(0, 9);
    if (!hdr || hdr.length < 5) return 0;
    if (hdr[AN_HDR_SR] > 1000) anSr = hdr[AN_HDR_SR];
    anFrame = hdr[AN_HDR_FRAME] | 0;
    var head = hdr[AN_HDR_PKT] | 0;
    if (head < 0 || head >= AN_PKT_COUNT) return 0;
    if (anPktSeen < 0) anPktSeen = head;
    var guard = 0;
    var n = 0;
    while (anPktSeen !== head && guard < AN_PKT_COUNT) {
        var floats = anPeek(AN_PKT_BASE + anPktSeen * AN_PKT_STRIDE, AN_PKT_STRIDE);
        if (floats) anLoudPush(anLoud, anPktFromFloats(floats));
        anPktSeen = (anPktSeen + 1) % AN_PKT_COUNT;
        guard++;
        n++;
    }
    return n;
}

function anFftTables() {
    if (anFftRev) return;
    var n = AN_FFT_N;
    anFftRev = new Array(n);
    anFftWin = new Array(n);
    anFftRe = new Array(n);
    anFftIm = new Array(n);
    anFftPow = new Array(n / 2);
    var i;
    for (i = 0; i < n; i++) {
        var rev = 0;
        var v = i;
        var b;
        for (b = 0; b < 13; b++) {
            rev = (rev << 1) | (v & 1);
            v >>= 1;
        }
        anFftRev[i] = rev;
        anFftWin[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))) * (4 / n);
    }
}

function anFftPower(frame) {
    anFftTables();
    var n = AN_FFT_N;
    var re = anFftRe;
    var im = anFftIm;
    if (!re || !im || !anFftRev || !anFftWin || !anFftPow) return anFftPow || [];
    var i;
    for (i = 0; i < n; i++) {
        var ri = anFftRev[i];
        re[ri] = (Number(frame[i]) || 0) * anFftWin[i];
        im[ri] = 0;
    }
    var size;
    for (size = 2; size <= n; size <<= 1) {
        var half = size >> 1;
        var theta = (-2 * Math.PI) / size;
        var sRe = Math.cos(theta);
        var sIm = Math.sin(theta);
        var start;
        for (start = 0; start < n; start += size) {
            var wr = 1;
            var wi = 0;
            var j;
            for (j = 0; j < half; j++) {
                var even = start + j;
                var odd = even + half;
                var tr = wr * re[odd] - wi * im[odd];
                var ti = wr * im[odd] + wi * re[odd];
                re[odd] = re[even] - tr;
                im[odd] = im[even] - ti;
                re[even] += tr;
                im[even] += ti;
                var nwr = wr * sRe - wi * sIm;
                wi = wr * sIm + wi * sRe;
                wr = nwr;
            }
        }
    }
    var halfN = n / 2;
    for (i = 0; i < halfN; i++) anFftPow[i] = re[i] * re[i] + im[i] * im[i];
    return anFftPow;
}

function anColFromPower(power, sr) {
    var col = new Array(AN_HEAT_ROWS);
    var row;
    for (row = 0; row < AN_HEAT_ROWS; row++) {
        var f0 = 30 * Math.pow(18000 / 30, row / AN_HEAT_ROWS);
        var f1 = 30 * Math.pow(18000 / 30, (row + 1) / AN_HEAT_ROWS);
        var b0 = Math.max(1, Math.floor(f0 * AN_FFT_N / sr));
        var b1 = Math.min(AN_FFT_N / 2 - 1, Math.ceil(f1 * AN_FFT_N / sr));
        if (b1 < b0) b1 = b0;
        var peak = 0;
        var b;
        for (b = b0; b <= b1; b++) if (power[b] > peak) peak = power[b];
        col[row] = anClamp(10 * Math.log10(Math.max(peak, 1e-12)), AN_DB_LO, AN_DB_HI);
    }
    return col;
}

function anTakeSpectrum() {
    anSpecTick++;
    if (anSpecTick % 2) return;
    var hdr = anPeek(0, 4);
    if (!hdr) return;
    var head = hdr[AN_HDR_FFT] | 0;
    var frame = anReadWrapped(AN_FFT_BASE, AN_FFT_N, head, AN_FFT_N);
    if (!frame || frame.length !== AN_FFT_N) return;
    var power = anFftPower(frame);
    anHeat.push(anColFromPower(power, anSr));
    if (anHeat.length > AN_HEAT_COLS) anHeat.shift();
    var energy = anBandEnergies(power, AN_FFT_N, anSr);
    var i;
    anBars = [];
    for (i = 0; i < energy.length; i++) {
        var db = anClamp(10 * Math.log10(Math.max(energy[i], 1e-12)), AN_DB_LO, AN_DB_HI);
        anBars.push(db);
        if (anPeak[i] === undefined || db > anPeak[i]) anPeak[i] = db;
        else anPeak[i] = Math.max(db, anPeak[i] - 1);
    }
}

function anScopeSig(l, r) {
    if (anScopeMode === 1) return (l + r) * 0.5;
    if (anScopeMode === 2) return (l - r) * 0.5;
    return l;
}

function anScopeCut(l, r, count) {
    var n = l.length;
    if (anTrigger || n <= count) return Math.max(0, n - count);
    var at = -1;
    var i;
    for (i = 1; i < n; i++) {
        var a = anScopeSig(l[i - 1], r[i - 1]);
        var b = anScopeSig(l[i], r[i]);
        if (a <= 0 && b > 0 && i + count <= n) at = i;
    }
    if (at < 0) return Math.max(0, n - count);
    return at;
}

function anTakeScope() {
    var hdr = anPeek(0, 4);
    if (!hdr) return;
    var head = hdr[AN_HDR_SCOPE] | 0;
    var ms = AN_SCOPE_MS[anScopeTime] || 20;
    var count = Math.max(32, Math.round(anSr * ms / 1000));
    if (count > AN_SCOPE_N) count = AN_SCOPE_N | 0;
    var want = Math.min(AN_SCOPE_N, count * 2);
    var l = anReadWrapped(AN_SCOPE_L, AN_SCOPE_N, head, want);
    var r = anReadWrapped(AN_SCOPE_R, AN_SCOPE_N, head, want);
    if (!l || !r) return;
    var cut = anScopeCut(l, r, count);
    anScopeL = l.slice(cut, cut + count);
    anScopeR = r.slice(cut, cut + count);
}

function anUpdateVisual() {
    if (!anFrame) return;
    if ((anMask & 1) && !anFrozen) anTakeSpectrum();
    if (((anMask & 2) || (anMask & 4)) && !anFrozen) anTakeScope();
    if ((anMask & 4) && !anFrozen) anBands = anBandsAvg(anLoud.pkts, 8);
}

function anPoll() {
    var before = anLoud.integ;
    var n = anConsume();
    anUpdateVisual();
    if (n || (anFrozen && (anMask & 8) && anLoud.integ !== before)) mgraphics.redraw();
}

function anStartPoll() {
    if (!anLive() || anPollTask) return;
    anPollTask = new Task(anPoll, this);
    anPollTask.interval = 40;
    anPollTask.repeat();
}

function anSnapHold() {
    anHold = {
        mom: anLoud.mom,
        short: anLoud.short,
        rms: anLoud.rms,
        tp: anLoud.tp,
        lra: anLoud.lra,
        spark: anLoud.spark.slice()
    };
}

function anView() {
    if (anFrozen && anHold) {
        return {
            mom: anHold.mom,
            short: anHold.short,
            rms: anHold.rms,
            tp: anHold.tp,
            lra: anHold.lra,
            spark: anHold.spark,
            integ: anLoud.integ
        };
    }
    return anLoud;
}

function anDoReset() {
    anLoudReset(anLoud);
    if (anHold) anSnapHold();
}

function anFmt(v, digits) {
    if (!(v > -190) || v !== v) return "\u2014";
    return Number(v).toFixed(digits);
}

function anSigned(v, digits) {
    if (!(v > -190) || v !== v) return "\u2014";
    var n = Math.abs(v).toFixed(digits);
    if (v < -0.0005) return "-" + n;
    if (v > 0.0005) return "+" + n;
    return Number(0).toFixed(digits);
}

function anHzTick(freq) {
    if (freq >= 1000) {
        var k = freq / 1000;
        if (Math.abs(k - Math.round(k)) < 0.06) return String(Math.round(k)) + "k";
        return k.toFixed(1) + "k";
    }
    return String(Math.round(freq));
}

function anHzCross(freq) {
    if (freq >= 1000) return (freq / 1000).toFixed(1) + "k";
    return String(Math.round(freq));
}

function anPlotBox(rect) {
    return { x: rect[0], y: rect[1], w: rect[2], h: rect[3] };
}

function anFillIn(col, x, y, w, h, bounds) {
    var x1 = anClamp(x, bounds[0], bounds[0] + bounds[2]);
    var y1 = anClamp(y, bounds[1], bounds[1] + bounds[3]);
    var x2 = anClamp(x + w, bounds[0], bounds[0] + bounds[2]);
    var y2 = anClamp(y + h, bounds[1], bounds[1] + bounds[3]);
    if (x2 - x1 < 0.15 || y2 - y1 < 0.15) return;
    sptRgba(col);
    mgraphics.rectangle(x1, y1, x2 - x1, y2 - y1);
    mgraphics.fill();
}

function anDbY(db, plot) {
    var t = anClamp((db - AN_DB_LO) / (AN_DB_HI - AN_DB_LO), 0, 1);
    return plot[1] + (1 - t) * plot[3];
}

function anRowFreq(row, n) {
    return 30 * Math.pow(18000 / 30, (row + 0.5) / Math.max(1, n));
}

function anRowX(row, n, plot) {
    var freq = anRowFreq(row, n);
    return anLogX(freq, plot[0], plot[2]);
}

function anHeatStops() {
    var bg = sptColor("live_lcd_bg");
    var alt = sptColor("live_lcd_control_fg_alt");
    var sel = sptColor("live_control_selection");
    return [
        bg,
        sptMix(bg, alt, 0.35),
        sptMix(alt, sel, 0.45),
        sel,
        sptMix(sel, [1, 1, 1, 1], 0.55)
    ];
}

function anHeatColor(db, stops) {
    var t = anClamp((db - AN_DB_LO) / (AN_DB_HI - AN_DB_LO), 0, 1);
    var u = t * (stops.length - 1);
    var i = Math.floor(u);
    if (i >= stops.length - 1) return stops[stops.length - 1];
    return sptMix(stops[i], stops[i + 1], u - i);
}

function anDemoDb(col, row) {
    var f = 30 * Math.pow(18000 / 30, (row + 0.5) / AN_HEAT_ROWS);
    var db = -76;
    db += 30 * Math.exp(-Math.pow(Math.log(f / 90) / Math.LN2, 2) / 0.4);
    db += 18 * Math.exp(-Math.pow(Math.log(f / 650) / Math.LN2, 2) / 0.85);
    db += 14 * Math.exp(-Math.pow(Math.log(f / 3400) / Math.LN2, 2) / 1.3);
    db += 5 * Math.sin(col * 0.41 + row * 0.17);
    return anClamp(db, AN_DB_LO, AN_DB_HI);
}

function anEnsureDemo() {
    if (anDemoReady) return;
    anDemoReady = 1;
    anSr = 48000;
    var c;
    var r;
    anHeat = [];
    for (c = 0; c < AN_HEAT_COLS; c++) {
        var col = [];
        for (r = 0; r < AN_HEAT_ROWS; r++) col.push(anDemoDb(c, r));
        anHeat.push(col);
    }
    var centers = anThirdCenters();
    anBars = [];
    anPeak = [];
    for (r = 0; r < centers.length; r++) {
        var db = anDemoDb(36, Math.max(0, Math.min(AN_HEAT_ROWS - 1, Math.round(Math.log(centers[r] / 30) / Math.log(18000 / 30) * AN_HEAT_ROWS))));
        anBars.push(db);
        anPeak.push(Math.min(AN_DB_HI, db + 6));
    }
    var n = 960;
    anScopeL = [];
    anScopeR = [];
    for (c = 0; c < n; c++) {
        var t = c / anSr;
        var w = 2 * Math.PI * 180 * t;
        anScopeL.push(0.68 * Math.sin(w) + 0.08 * Math.sin(3 * w));
        anScopeR.push(0.5 * Math.sin(w + 1.05) + 0.06 * Math.sin(3 * w + 1.05));
    }
    anBands = [
        { corr: 0.94, width: 0.16, bal: -0.08 },
        { corr: 0.62, width: 0.4, bal: 0.14 },
        { corr: 0.18, width: 0.7, bal: -0.22 },
        { corr: -0.28, width: 0.84, bal: 0.3 }
    ];
    anLoud.mom = -18.4;
    anLoud.short = -16.1;
    anLoud.integ = -17.2;
    anLoud.rms = -20.6;
    anLoud.tp = Math.pow(10, -6.4 / 20);
    anLoud.lra = 4.6;
    anLoud.spark = [];
    for (c = 0; c < 56; c++) anLoud.spark.push(-24 + 7 * Math.sin(c / 5) + (c % 9) * 0.25);
}

function anInk(on) {
    return on ? sptColor("live_control_selection") : sptColor("live_control_fg");
}

function anRoundRect(x, y, w, h, r, col) {
    sptRgba(col);
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
    mgraphics.fill();
}

function anStrokeRound(x, y, w, h, r, col) {
    sptRgba(col);
    mgraphics.set_line_width(1);
    mgraphics.rectangle_rounded(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1), r, r);
    mgraphics.stroke();
}

function anRailButton(rect, on) {
    var x = rect[0];
    var y = rect[1];
    var w = rect[2];
    var h = rect[3];
    if (on) {
        anRoundRect(x, y, w, h, 2, sptMix(sptColor("live_lcd_bg"), sptColor("live_control_selection"), 0.22));
        sptRgba(sptColor("live_control_selection"));
        mgraphics.rectangle(x, y + 2, 2, h - 4);
        mgraphics.fill();
        anStrokeRound(x, y, w, h, 2, sptColor("live_control_selection"));
    } else {
        anRoundRect(x, y, w, h, 2, sptColor("live_control_bg"));
    }
}

function anGlyphSpec(rect, on) {
    var heights = [4, 8, 12, 6, 10];
    var bw = 1.6;
    var gap = 1;
    var total = heights.length * bw + (heights.length - 1) * gap;
    var x0 = rect[0] + (rect[2] - total) * 0.5;
    var base = rect[1] + rect[3] - 2.5;
    sptRgba(anInk(on));
    var i;
    for (i = 0; i < heights.length; i++) {
        mgraphics.rectangle(x0 + i * (bw + gap), base - heights[i], bw, heights[i]);
    }
    mgraphics.fill();
}

function anGlyphScope(rect, on) {
    var x0 = rect[0] + 2.5;
    var y0 = rect[1] + rect[3] * 0.5;
    var w = rect[2] - 5;
    sptRgba(anInk(on));
    mgraphics.set_line_width(1.15);
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("round");
    if (mgraphics.set_line_join) mgraphics.set_line_join("round");
    mgraphics.move_to(x0, y0);
    var i;
    for (i = 1; i <= 15; i++) {
        var t = i / 15;
        mgraphics.line_to(x0 + t * w, y0 - Math.sin(t * Math.PI * 2) * 4.2);
    }
    mgraphics.stroke();
    mgraphics.set_line_width(1);
    mgraphics.move_to(x0 + w * 0.5, y0 - 2.4);
    mgraphics.line_to(x0 + w * 0.5, y0 + 2.4);
    mgraphics.stroke();
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("butt");
}

function anGlyphStereo(rect, on) {
    var cx = rect[0] + rect[2] * 0.5;
    var cy = rect[1] + rect[3] * 0.5;
    sptRgba(anInk(on));
    mgraphics.set_line_width(1.15);
    mgraphics.move_to(cx, cy - 5);
    mgraphics.line_to(cx + 5, cy);
    mgraphics.line_to(cx, cy + 5);
    mgraphics.line_to(cx - 5, cy);
    mgraphics.close_path();
    mgraphics.stroke();
    mgraphics.arc(cx, cy, 1.15, 0, Math.PI * 2);
    mgraphics.fill();
}

function anGlyphLoud(rect, on) {
    sptRgba(anInk(on));
    mgraphics.rectangle(rect[0] + 3.4, rect[1] + 4.2, 2.3, 9);
    mgraphics.rectangle(rect[0] + 8.4, rect[1] + 7.2, 2.3, 6);
    mgraphics.fill();
    mgraphics.rectangle(rect[0] + 2.8, rect[1] + 2.8, 3.5, 1.15);
    mgraphics.rectangle(rect[0] + 7.8, rect[1] + 5.6, 3.5, 1.15);
    mgraphics.fill();
}

function anGlyphFreeze(rect, on) {
    var cx = rect[0] + rect[2] * 0.5;
    var cy = rect[1] + rect[3] * 0.5;
    sptRgba(anInk(on));
    mgraphics.set_line_width(1.15);
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("round");
    var k;
    for (k = 0; k < 6; k++) {
        var a = k * Math.PI / 3 - Math.PI / 2;
        var dx = Math.cos(a);
        var dy = Math.sin(a);
        mgraphics.move_to(cx, cy);
        mgraphics.line_to(cx + dx * 5, cy + dy * 5);
        var px = -dy;
        var py = dx;
        var ex = cx + dx * 3.2;
        var ey = cy + dy * 3.2;
        mgraphics.move_to(ex - px * 1.25, ey - py * 1.25);
        mgraphics.line_to(ex + px * 1.25, ey + py * 1.25);
    }
    mgraphics.stroke();
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("butt");
}

function anGlyph(section, rect, on) {
    if (section === 0) anGlyphSpec(rect, on);
    else if (section === 1) anGlyphScope(rect, on);
    else if (section === 2) anGlyphStereo(rect, on);
    else anGlyphLoud(rect, on);
}

function anPaintRail() {
    anRoundRect(3, 4, 22, 161, 3, sptColor("live_desktop"));
    anStrokeRound(3, 4, 22, 161, 3, sptColor("live_lcd_frame"));
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.rectangle(5, 140, 18, 1);
    mgraphics.fill();
    var g = anRailGeom();
    var i;
    for (i = 0; i < g.buttons.length; i++) {
        var on = (anMask & (1 << anOrder[i])) !== 0;
        anRailButton(g.buttons[i], on);
        anGlyph(anOrder[i], g.buttons[i], on);
    }
    anRailButton(g.freeze, anFrozen !== 0);
    anGlyphFreeze(g.freeze, anFrozen !== 0);
}

function anPaintTip(width) {
    if (!anHoverKind) return;
    var name = anHoverKind === "freeze" ? "Freeze" : AN_TIP_NAMES[anOrder[anHoverSlot]];
    var y = anHoverKind === "freeze" ? anRailGeom().freeze[1] : anRailGeom().buttons[anHoverSlot][1];
    var tw = Math.ceil(sptTextW(name, SPT_SIZE_SMALL) + 14);
    var tip = [AN_SEC_X0 + 2, y, tw, 16];
    if (tip[0] + tip[2] > width - 2) return;
    anRoundRect(tip[0], tip[1], tip[2], tip[3], 3, sptColor("live_lcd_bg"));
    anStrokeRound(tip[0], tip[1], tip[2], tip[3], 3, sptColor("live_control_selection"));
    sptText(name, tip[0] + 7, tip[1] + 12, sptColor("live_lcd_control_fg"), SPT_SIZE_SMALL, 0);
}

function anStatus() {
    if (!anLive() || anDsp.ready) return "";
    if (anDsp.error) return "DSP failed: " + anDsp.error;
    return "DSP loading\u2026";
}

function anPaintCard(panel) {
    anRoundRect(panel.x, 4, panel.w, AN_H - 8, 3, sptColor("live_desktop"));
    anStrokeRound(panel.x, 4, panel.w, AN_H - 8, 3, sptColor("live_lcd_frame"));
}

function anHeaderRule(panel) {
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.rectangle(panel.x + 8, 24, panel.w - 16, 1);
    mgraphics.fill();
}

function anPill(rect, text, on) {
    var x = rect[0];
    var y = rect[1];
    var w = rect[2];
    var h = rect[3];
    if (on) {
        anRoundRect(x, y, w, h, 2, sptColor("live_control_selection"));
        sptText(text, x + w * 0.5, y + h - 3, sptColor("live_lcd_bg"), SPT_SIZE_SMALL, 1);
    } else {
        anRoundRect(x, y, w, h, 2, sptColor("live_control_bg"));
        anStrokeRound(x, y, w, h, 2, sptColor("live_lcd_frame"));
        sptText(text, x + w * 0.5, y + h - 3, sptColor("live_control_fg"), SPT_SIZE_SMALL, 1);
    }
}

function anStatusPill(panel, status) {
    var col = anDsp.error ? sptColor("live_alert") : sptColor("live_control_selection");
    var tw = sptTextW(status, 7.5);
    var w = Math.min(panel.w - 16, tw + 12);
    anRoundRect(panel.x + 8, 7, w, 14, 2, sptMix(sptColor("live_lcd_bg"), col, 0.22));
    anStrokeRound(panel.x + 8, 7, w, 14, 2, col);
    sptText(status, panel.x + 14, 17, col, 7.5, 0);
}

function anPeakLabel() {
    if (!anHeat.length) return "";
    var col = anHeat[anHeat.length - 1];
    if (!col || !col.length) return "";
    var best = 0;
    var r;
    for (r = 1; r < col.length; r++) if (col[r] > col[best]) best = r;
    var freq = anRowFreq(best, col.length);
    if (freq >= 1000) return "Peak " + (freq / 1000).toFixed(1) + " kHz";
    return "Peak " + String(Math.round(freq)) + " Hz";
}

function anPeakBadge(panel, text) {
    if (!text) return;
    var tw = sptTextW(text, 7.5);
    var w = tw + 12;
    var x = panel.x + 78;
    var limit = panel.x + panel.w - 6 - (3 * 46 + 2 * 3) - 6;
    if (x + w > limit) return;
    anRoundRect(x, 8, w, 14, 2, sptColor("live_control_bg"));
    sptText(text, x + w * 0.5, 18, sptColor("live_lcd_control_fg_alt"), 7.5, 1);
}

function anAnalyzerGrid(plot) {
    var xs = [];
    var i;
    for (i = 0; i < AN_HZ_GRID.length; i++) xs.push(anLogX(AN_HZ_GRID[i], plot[0], plot[2]));
    return {
        xs: xs,
        ys: [plot[1] + plot[3] * 0.25, plot[1] + plot[3] * 0.5, plot[1] + plot[3] * 0.75]
    };
}

function anPaintDbScale(lcd, plot) {
    var marks = [0, -20, -40, -60];
    var gutter = { x: lcd[0] + 1, y: lcd[1] + 1, w: Math.max(10, plot[0] - lcd[0] - 2), h: lcd[3] - 2 };
    var col = sptColor("live_display_scale_text");
    var i;
    for (i = 0; i < marks.length; i++) {
        var y = plot[1] + ((0 - marks[i]) / 80) * plot[3] + 2.4;
        sptTextIn(String(marks[i]), gutter.x + gutter.w, y, col, 7.5, 2, gutter);
    }
}

function anPaintHzScale(lcd, plot) {
    var strip = {
        x: plot[0],
        y: plot[1] + plot[3],
        w: plot[2],
        h: Math.max(8, lcd[1] + lcd[3] - plot[1] - plot[3])
    };
    var col = sptColor("live_display_scale_text");
    var i;
    for (i = 0; i < AN_HZ_LABELS.length; i++) {
        var x = anLogX(AN_HZ_LABELS[i], plot[0], plot[2]);
        sptTextIn(anHzTick(AN_HZ_LABELS[i]), x, strip.y + strip.h - 1, col, 7.5, 1, strip);
    }
}

function anPaintNewestTrace(plot, col) {
    if (!col || col.length < 2) return;
    var clip = anPlotBox(plot);
    /** @type {number[][]} */
    var pts = [];
    var r;
    var n = col.length;
    var top = Math.max(2, Math.floor(n * 0.82));
    for (r = 0; r < n; r++) {
        pts.push([anRowX(r, n, plot), anDbY(col[r], plot)]);
    }
    var poly = pts.slice();
    poly.push([pts[n - 1][0], plot[1] + plot[3]]);
    poly.push([pts[0][0], plot[1] + plot[3]]);
    sptFillPolyIn(poly, sptColor("live_control_selection"), 0.08, clip);
    sptCurveIn(pts, sptMix(sptColor("live_lcd_control_fg_alt"), [1, 1, 1, 1], 0.2), 0.45, clip);
    sptCurveIn(pts.slice(top), sptMix(sptColor("live_control_selection"), [1, 1, 1, 1], 0.55), 0.95, clip);
}

function anPaintHeat(plot) {
    var shown = Math.min(AN_HEAT_COLS, anHeat.length);
    if (!shown) return;
    var stops = anHeatStops();
    var bg = stops[0];
    var start = anHeat.length - shown;
    var rh = plot[3] / shown;
    var c;
    for (c = 0; c < shown; c++) {
        var col = anHeat[start + c];
        var y = plot[1] + (c / shown) * plot[3];
        var fade = (shown - 1 - c) / Math.max(1, shown - 1);
        var row;
        for (row = 0; row < col.length; row++) {
            var x0 = anRowX(row, col.length, plot);
            var x1 = row + 1 < col.length ? anRowX(row + 1, col.length, plot) : plot[0] + plot[2];
            var color = anHeatColor(col[row], stops);
            if (fade > 0) color = sptMix(color, bg, Math.min(0.62, fade * 0.62));
            anFillIn(color, x0, y, Math.max(0.6, x1 - x0 + 0.4), rh + 0.45, plot);
        }
    }
    anPaintNewestTrace(plot, anHeat[anHeat.length - 1]);
}

function anPaintFall(plot) {
    var n = Math.min(AN_FALL_ROWS, anHeat.length);
    if (n < 1) return;
    var clip = anPlotBox(plot);
    var pitch = Math.min(2.5, Math.max(1.5, (plot[3] * 0.34) / Math.max(1, n)));
    var age;
    for (age = n - 1; age >= 0; age--) {
        var col = anHeat[anHeat.length - 1 - age];
        if (!col || col.length < 2) continue;
        var lift = age * pitch;
        var floorY = plot[1] + plot[3] - lift;
        var ridge = [];
        var r;
        for (r = 0; r < col.length; r++) {
            ridge.push([anRowX(r, col.length, plot), anDbY(col[r], plot) - lift]);
        }
        var poly = ridge.slice();
        poly.push([ridge[ridge.length - 1][0], floorY]);
        poly.push([ridge[0][0], floorY]);
        var ink = age === 0
            ? sptColor("live_control_selection")
            : sptMix(sptColor("live_lcd_frame"), sptColor("live_control_selection"), Math.max(0.08, 1 - age / Math.max(1, n - 1)));
        sptFillPolyIn(poly, sptMix(sptColor("live_lcd_bg"), ink, 0.14), 0.88, clip);
        sptCurveIn(ridge, ink, age === 0 ? 1 : 0.42 + 0.5 * (1 - age / n), clip);
    }
}

function anPaintBars(plot) {
    if (!anBars.length) return;
    var clip = anPlotBox(plot);
    var centers = anThirdCenters();
    var alt = sptColor("live_lcd_control_fg_alt");
    var sel = sptColor("live_control_selection");
    var track = sptColor("live_control_bg");
    var capCol = sptColor("live_display_line_one");
    var n = anBars.length;
    var spacing = plot[2] / n;
    var bw = Math.max(1.4, spacing - 1.4);
    var nSeg = 12;
    var gap = 1;
    var segH = (plot[3] - gap * (nSeg - 1)) / nSeg;
    /** @type {number[][]} */
    var env = [];
    var best = 0;
    var i;
    for (i = 1; i < n; i++) if ((anPeak[i] || AN_DB_LO) > (anPeak[best] || AN_DB_LO)) best = i;
    for (i = 0; i < n; i++) {
        var cx = anLogX(centers[i] || 1000, plot[0], plot[2]);
        var x = anClamp(cx - bw * 0.5, plot[0], plot[0] + plot[2] - bw);
        anFillIn(track, x, plot[1], bw, plot[3], plot);
        var t = anClamp((anBars[i] - AN_DB_LO) / (AN_DB_HI - AN_DB_LO), 0, 1);
        var lit = Math.round(t * nSeg);
        var s;
        for (s = 0; s < lit; s++) {
            var sy = plot[1] + plot[3] - (s + 1) * segH - s * gap;
            anFillIn(sptMix(alt, sel, (s + 0.5) / nSeg), x + 0.4, sy, Math.max(1, bw - 0.8), segH, plot);
        }
        env.push([x + bw * 0.5, anDbY(anBars[i], plot)]);
        if (anPeak.length > i) {
            anFillIn(capCol, x, anDbY(anPeak[i], plot) - 0.75, bw, 1.5, plot);
        }
    }
    sptCurveIn(env, sptMix(alt, [1, 1, 1, 1], 0.25), 1, clip);
    if (anPeak.length > best) {
        sptTextIn(anFmt(anPeak[best], 0), env[best][0], anDbY(anPeak[best], plot) - 1, capCol, 7.5, 1, clip);
    }
}

function anPaintSpec(panel) {
    var g = anSpecGeom(panel);
    var status = anStatus();
    anHeaderRule(panel);
    if (status) anStatusPill(panel, status);
    else {
        sptTitle("Spectrum", panel.x + 8, 17);
        anPeakBadge(panel, anPeakLabel());
    }
    var i;
    for (i = 0; i < g.pills.length; i++) anPill(g.pills[i], AN_SPEC_NAMES[i], anSpecType === i);
    sptLcd(g.lcd[0], g.lcd[1], g.lcd[2], g.lcd[3], anAnalyzerGrid(g.plot));
    if (anSpecType === 0) anPaintHeat(g.plot);
    else if (anSpecType === 1) anPaintFall(g.plot);
    else anPaintBars(g.plot);
    anPaintDbScale(g.lcd, g.plot);
    anPaintHzScale(g.lcd, g.plot);
}

function anAmpY(v, rect) {
    return rect[1] + (1 - (anClamp(v, -1, 1) + 1) * 0.5) * rect[3];
}

function anWavePts(sig, rect) {
    /** @type {number[][]} */
    var pts = [];
    if (!sig || sig.length < 2) return pts;
    var n = sig.length;
    var step = Math.max(1, Math.floor(n / Math.max(8, rect[2])));
    var i;
    for (i = 0; i < n; i += step) {
        pts.push([rect[0] + (n <= 1 ? 0 : i / (n - 1)) * rect[2], anAmpY(sig[i], rect)]);
    }
    if ((n - 1) % step !== 0) pts.push([rect[0] + rect[2], anAmpY(sig[n - 1], rect)]);
    return pts;
}

function anPaintWave(sig, rect, col) {
    var pts = anWavePts(sig, rect);
    if (pts.length < 2) return;
    var clip = anPlotBox(rect);
    var mid = rect[1] + rect[3] * 0.5;
    var poly = pts.slice();
    poly.push([pts[pts.length - 1][0], mid]);
    poly.push([pts[0][0], mid]);
    sptFillPolyIn(poly, col, 0.16, clip);
    sptCurveIn(pts, col, 1, clip);
}

function anScopePlot(lcd) {
    return [lcd[0] + 18, lcd[1] + 18, lcd[2] - 22, lcd[3] - 48];
}

function anScopeGrid(plot) {
    return {
        xs: [plot[0] + plot[2] * 0.25, plot[0] + plot[2] * 0.5, plot[0] + plot[2] * 0.75],
        ys: [anAmpY(0.5, plot), anAmpY(0, plot), anAmpY(-0.5, plot)]
    };
}

function anPaintScopeScale(lcd, plot) {
    var gutter = { x: lcd[0] + 1, y: lcd[1] + 1, w: Math.max(8, plot[0] - lcd[0] - 2), h: lcd[3] - 2 };
    var col = sptColor("live_display_scale_text");
    var marks = [{ t: "+1", v: 1 }, { t: "0", v: 0 }, { t: "\u22121", v: -1 }];
    var i;
    for (i = 0; i < marks.length; i++) {
        sptTextIn(marks[i].t, gutter.x + gutter.w, anAmpY(marks[i].v, plot) + 2.4, col, 7.5, 2, gutter);
    }
}

function anPaintZeroTicks(plot) {
    var clip = anPlotBox(plot);
    var y = anAmpY(0, plot);
    var col = sptColor("live_lcd_frame");
    var i;
    for (i = 0; i <= 8; i++) {
        var x = plot[0] + (i / 8) * plot[2];
        var h = i % 2 === 0 ? 4.5 : 2.4;
        sptCurveIn([[x, y - h], [x, y + h]], col, 1, clip);
    }
}

function anSigStats(sig) {
    var n = sig ? sig.length : 0;
    if (!n) return { vpp: 0, rms: 0 };
    var lo = 1;
    var hi = -1;
    var s = 0;
    var i;
    for (i = 0; i < n; i++) {
        var v = Number(sig[i]) || 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        s += v * v;
    }
    return { vpp: hi - lo, rms: Math.sqrt(s / n) };
}

function anPaintScopeBadge(lcd, vpp, rms) {
    var trig = anTrigger ? "Free" : "Auto";
    var line1 = String(AN_SCOPE_MS[anScopeTime] || 20) + " ms  \u2022  " + trig;
    var line2 = "Vpp " + vpp.toFixed(2) + "   RMS " + rms.toFixed(2);
    var tw = Math.max(sptTextW(line1, 7.5), sptTextW(line2, 7.5));
    var w = tw + 10;
    var h = 22;
    var x = lcd[0] + lcd[2] - w - 4;
    var y = lcd[1] + lcd[3] - h - 3;
    anRoundRect(x, y, w, h, 2, sptMix(sptColor("live_lcd_bg"), sptColor("live_control_bg"), 0.35));
    sptText(line1, x + w - 5, y + 9, sptColor("live_lcd_control_fg_alt"), 7.5, 2);
    sptText(line2, x + w - 5, y + 19, sptColor("live_display_scale_text"), 7.5, 2);
}

function anPaintScopeTitle(lcd) {
    var text = "Oscilloscope";
    var tw = sptTextW(text, 7.5);
    anRoundRect(lcd[0] + 3, lcd[1] + 3, tw + 8, 12, 2, sptColor("live_lcd_bg"));
    sptText(text, lcd[0] + 7, lcd[1] + 12, sptColor("live_lcd_title"), 7.5, 0);
}

function anOvalPts(cx, cy, rx, ry, n) {
    /** @type {number[][]} */
    var pts = [];
    var i;
    for (i = 0; i <= n; i++) {
        var a = (i / n) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return pts;
}

function anMsPts(l, r, cx, cy, rad) {
    /** @type {number[][]} */
    var pts = [];
    if (!l || !r) return pts;
    var n = Math.min(l.length, r.length);
    if (n < 2) return pts;
    var step = Math.max(1, Math.floor(n / 260));
    var i;
    for (i = 0; i < n; i += step) {
        var mid = (Number(l[i]) + Number(r[i])) * 0.5;
        var side = (Number(l[i]) - Number(r[i])) * 0.5;
        pts.push([cx - anClamp(side, -1, 1) * rad, cy - anClamp(mid, -1, 1) * rad]);
    }
    return pts;
}

function anCloud(pts, clip, col) {
    var step = Math.max(1, Math.floor(pts.length / 80));
    var i;
    for (i = 0; i < pts.length; i += step) {
        var p = pts[i];
        var s = 2.3;
        sptFillPolyIn([
            [p[0] - s, p[1]],
            [p[0], p[1] - s * 0.65],
            [p[0] + s, p[1]],
            [p[0], p[1] + s * 0.65]
        ], col, 0.09, clip);
    }
}

function anPaintVectorscope(lcd, l, r) {
    var clip = anPlotBox(lcd);
    var side = Math.min(lcd[2] - 28, lcd[3] - 48);
    var sx = lcd[0] + (lcd[2] - side) * 0.5;
    var sy = lcd[1] + 18;
    var cx = sx + side * 0.5;
    var cy = sy + side * 0.5;
    var rad = side * 0.4;
    var frame = sptColor("live_lcd_frame");
    var axis = sptMix(frame, sptColor("live_lcd_title"), 0.65);
    var square = [[sx, sy], [sx + side, sy], [sx + side, sy + side], [sx, sy + side], [sx, sy]];
    sptCurveIn(square, frame, 1, clip);
    sptCurveIn(anOvalPts(cx, cy, rad, rad, 72), axis, 1, clip);
    var inner = rad * Math.pow(10, -6 / 20);
    sptCurveIn(anOvalPts(cx, cy, inner, inner, 56), frame, 1, clip);
    sptCurveIn([[cx, cy - rad], [cx, cy + rad]], axis, 1, clip);
    sptCurveIn([[cx - rad, cy], [cx + rad, cy]], axis, 1, clip);
    var d = rad * 0.7071;
    sptCurveIn([[cx - d, cy + d], [cx + d, cy - d]], frame, 1, clip);
    sptCurveIn([[cx - d, cy - d], [cx + d, cy + d]], frame, 1, clip);
    var label = sptColor("live_display_scale_text");
    sptTextIn("M", cx, cy - rad + 9, label, 7.5, 1, clip);
    sptTextIn("S", cx + rad - 2, cy + 3, label, 7.5, 2, clip);
    sptTextIn("L", cx - d, cy - d + 3, label, 7.5, 1, clip);
    sptTextIn("R", cx + d, cy - d + 3, label, 7.5, 1, clip);
    var pts = anMsPts(l, r, cx, cy, rad * 0.92);
    if (pts.length < 2) return;
    anCloud(pts, clip, sptColor("live_display_line_two"));
    var mid = Math.max(1, Math.floor(pts.length * 0.55));
    sptCurveIn(pts.slice(0, mid + 1), sptColor("live_display_line_two"), 0.95, clip);
    sptCurveIn(pts.slice(mid), sptColor("live_display_line_one"), 1, clip);
}

function anMixSignal() {
    /** @type {number[]} */
    var sig = [];
    var a = anScopeL || [];
    var b = anScopeR || [];
    var m = Math.min(a.length, b.length);
    var i;
    for (i = 0; i < m; i++) sig.push(anScopeMode === 1 ? (a[i] + b[i]) * 0.5 : (a[i] - b[i]) * 0.5);
    return sig;
}

function anPaintScope(panel) {
    var g = anScopeGeom(panel);
    anHeaderRule(panel);
    var i;
    for (i = 0; i < g.modes.length; i++) anPill(g.modes[i], AN_MODE_NAMES[i], anScopeMode === i);
    for (i = 0; i < g.times.length; i++) anPill(g.times[i], String(AN_SCOPE_MS[i]), anScopeTime === i);
    anPill(g.trig, AN_TRIG_NAMES[anTrigger ? 1 : 0], anTrigger === 0);
    var plot = anScopePlot(g.lcd);
    if (anScopeMode === 3) {
        sptLcd(g.lcd[0], g.lcd[1], g.lcd[2], g.lcd[3]);
        anPaintVectorscope(g.lcd, anScopeL, anScopeR);
    } else {
        sptLcd(g.lcd[0], g.lcd[1], g.lcd[2], g.lcd[3], anScopeGrid(plot));
        anPaintZeroTicks(plot);
        if (anScopeMode === 0) {
            anPaintWave(anScopeR, plot, sptColor("live_display_line_two"));
            anPaintWave(anScopeL, plot, sptColor("live_display_line_one"));
        } else {
            var col = anScopeMode === 1 ? sptColor("live_display_line_one") : sptColor("live_display_line_two");
            anPaintWave(anMixSignal(), plot, col);
        }
        anPaintScopeScale(g.lcd, plot);
    }
    anPaintScopeTitle(g.lcd);
    var statsL = anSigStats(anScopeL);
    var statsR = anSigStats(anScopeR);
    anPaintScopeBadge(g.lcd, Math.max(statsL.vpp, statsR.vpp), Math.sqrt((statsL.rms * statsL.rms + statsR.rms * statsR.rms) * 0.5));
}

function anZoneAccent(index) {
    var accents = [
        sptColor("live_display_line_two"),
        sptMix(sptColor("live_display_line_two"), sptColor("live_control_selection"), 0.5),
        sptColor("live_lcd_control_fg"),
        sptColor("live_control_selection")
    ];
    return accents[index] || accents[0];
}

function anBandRange(index, freqs) {
    if (index === 0) return "<" + anHzTick(freqs[0]);
    if (index === 1) return anHzTick(freqs[0]) + "\u2013" + anHzTick(freqs[1]);
    if (index === 2) return anHzTick(freqs[1]) + "\u2013" + anHzTick(freqs[2]);
    return ">" + anHzTick(freqs[2]);
}

function anRecessed(rect) {
    anRoundRect(rect[0], rect[1], rect[2], rect[3], 1.5, sptColor("live_lcd_bg"));
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.set_line_width(1);
    mgraphics.rectangle(rect[0] + 0.5, rect[1] + 0.5, rect[2] - 1, rect[3] - 1);
    mgraphics.stroke();
}

function anPaintCorrMeter(rect, corr) {
    anRecessed(rect);
    var c = anClamp(corr, -1, 1);
    var mid = rect[0] + rect[2] * 0.5;
    var x = mid + c * rect[2] * 0.5;
    var col = c < 0 ? sptColor("live_alert") : sptColor("live_display_line_two");
    if (c >= 0) anFillIn(col, mid, rect[1] + 1, Math.max(0, x - mid), rect[3] - 2, rect);
    else anFillIn(col, x, rect[1] + 1, Math.max(0, mid - x), rect[3] - 2, rect);
    sptRgba(sptColor("live_display_scale_text"));
    mgraphics.rectangle(rect[0] + 1, rect[1], 1, rect[3]);
    mgraphics.rectangle(rect[0] + rect[2] - 2, rect[1], 1, rect[3]);
    mgraphics.fill();
    sptRgba(sptColor("live_lcd_title"));
    mgraphics.rectangle(mid, rect[1] - 1, 1, rect[3] + 2);
    mgraphics.fill();
    var text = anSigned(c, 2);
    var tc = c < 0 ? sptColor("live_alert") : sptColor("live_lcd_control_fg_alt");
    sptText(text, rect[0] + rect[2] * 0.5, rect[1] + rect[3] + 10, tc, 7.5, 1);
}

function anPaintWidthMeter(rect, width) {
    anRecessed(rect);
    var t = anClamp(width, 0, 1);
    anFillIn(sptColor("live_control_selection"), rect[0] + 1, rect[1] + 1, Math.max(0, (rect[2] - 2) * t), rect[3] - 2, rect);
    sptText(String(Math.round(t * 100)) + "%", rect[0] + rect[2] * 0.5, rect[1] + rect[3] + 10, sptColor("live_lcd_control_fg_alt"), 7.5, 1);
}

function anPaintBalMeter(rect, bal) {
    anRecessed(rect);
    var b = anClamp(bal, -1, 1);
    var mid = rect[0] + rect[2] * 0.5;
    var cy = rect[1] + rect[3] * 0.5;
    var x = mid + b * (rect[2] * 0.5 - 3);
    sptRgba(sptColor("live_lcd_title"));
    mgraphics.rectangle(mid, rect[1] + 1, 1, rect[3] - 2);
    mgraphics.fill();
    var col = b < 0 ? sptColor("live_display_line_two") : sptColor("live_control_selection");
    if (b >= 0) anFillIn(col, mid, cy - 1.3, Math.max(0, x - mid), 2.6, rect);
    else anFillIn(col, x, cy - 1.3, Math.max(0, mid - x), 2.6, rect);
    sptRgba(col);
    mgraphics.arc(anClamp(x, rect[0] + 2, rect[0] + rect[2] - 2), cy, 2.1, 0, Math.PI * 2);
    mgraphics.fill();
}

function anPaintCrossover(panel, g) {
    var axis = g.axis;
    anRoundRect(axis[0], axis[1], axis[2], axis[3], 2, sptColor("live_lcd_bg"));
    var edges = [40, g.freqs[0], g.freqs[1], g.freqs[2], 18000];
    var i;
    for (i = 0; i < 4; i++) {
        var x0 = anLogX(edges[i], axis[0], axis[2]);
        var x1 = anLogX(edges[i + 1], axis[0], axis[2]);
        var zw = Math.max(0, x1 - x0);
        anFillIn(sptMix(sptColor("live_lcd_bg"), anZoneAccent(i), 0.3), x0, axis[1] + 1, zw, axis[3] - 2, axis);
        if (zw > 28) {
            sptText(AN_ZONE_NAMES[i], x0 + zw * 0.5, axis[1] + 9, sptColor("live_lcd_title"), 7.5, 1);
        }
    }
    sptRgba(sptColor("live_lcd_frame"));
    for (i = 0; i < 3; i++) {
        var sx = anLogX(g.freqs[i], axis[0], axis[2]);
        mgraphics.rectangle(sx, axis[1] + 1, 1, axis[3] - 2);
    }
    mgraphics.fill();
    anStrokeRound(axis[0], axis[1], axis[2], axis[3], 2, sptColor("live_lcd_frame"));
    for (i = 0; i < g.handles.length; i++) {
        var hx = g.handles[i][0] + g.handles[i][2] * 0.5;
        var hy = g.handles[i][1] + g.handles[i][3] * 0.5;
        var active = anDrag && anDrag.kind === "xover" && anDrag.index === i;
        var hcol = active ? sptMix(sptColor("live_control_selection"), [1, 1, 1, 1], 0.25) : sptColor("live_control_selection");
        sptHandle(hx, hy, hcol, String(i + 1), 5);
        var label = anHzCross(g.freqs[i]);
        var tw = sptTextW(label, 7.5);
        var lx = hx;
        var align = 1;
        if (hx - tw * 0.5 < panel.x + 58) {
            lx = hx + 9;
            align = 0;
        } else if (hx + tw * 0.5 > panel.x + panel.w - 6) {
            lx = hx - 9;
            align = 2;
        }
        sptText(label, lx, 16, sptColor("live_lcd_control_fg_alt"), 7.5, align);
    }
}

function anPaintGonio(rect, l, r) {
    sptLcd(rect[0], rect[1], rect[2], rect[3]);
    var clip = anPlotBox(rect);
    var cx = rect[0] + rect[2] * 0.5;
    var cy = rect[1] + rect[3] * 0.5;
    var rad = Math.min(rect[2], rect[3]) * 0.34;
    var frame = sptColor("live_lcd_frame");
    var axis = sptMix(frame, sptColor("live_lcd_title"), 0.7);
    sptCurveIn(anOvalPts(cx, cy, rad, rad, 64), axis, 1, clip);
    var diamond = [[cx, cy - rad], [cx + rad, cy], [cx, cy + rad], [cx - rad, cy], [cx, cy - rad]];
    sptCurveIn(diamond, frame, 1, clip);
    var label = sptColor("live_display_scale_text");
    sptTextIn("M", cx, cy - rad + 8, label, 7.5, 1, clip);
    sptTextIn("+S", cx + rad - 1, cy + 3, label, 7.5, 2, clip);
    sptTextIn("L", cx - rad * 0.62, cy - rad * 0.62 + 2, label, 7.5, 1, clip);
    sptTextIn("R", cx + rad * 0.62, cy - rad * 0.62 + 2, label, 7.5, 1, clip);
    var pts = anMsPts(l, r, cx, cy, rad * 0.9);
    if (pts.length < 2) return;
    sptCurveIn(pts, sptColor("live_lcd_control_fg_alt"), 0.92, clip);
    var core = [];
    var i;
    for (i = 0; i < pts.length; i++) core.push([cx + (pts[i][0] - cx) * 0.42, cy + (pts[i][1] - cy) * 0.42]);
    sptCurveIn(core, sptColor("live_control_selection"), 0.95, clip);
}

function anPaintPhaseBox(rect, bands) {
    anRoundRect(rect[0], rect[1], rect[2], rect[3], 2, sptColor("live_lcd_bg"));
    anStrokeRound(rect[0], rect[1], rect[2], rect[3], 2, sptColor("live_lcd_frame"));
    var corr = 0;
    var width = 0;
    var n = 0;
    var i;
    for (i = 0; i < bands.length; i++) {
        corr += Number(bands[i].corr) || 0;
        width += Number(bands[i].width) || 0;
        n++;
    }
    if (n) {
        corr /= n;
        width /= n;
    }
    var corrCol = corr < 0 ? sptColor("live_alert") : sptColor("live_lcd_control_fg_alt");
    sptText("AVG CORR", rect[0] + 4, rect[1] + 13, sptColor("live_lcd_title"), 7.5, 0);
    sptText(anSigned(corr, 2), rect[0] + rect[2] - 4, rect[1] + 13, corrCol, 7.5, 2);
    sptText("WIDTH", rect[0] + 4, rect[1] + 27, sptColor("live_lcd_title"), 7.5, 0);
    sptText(String(Math.round(anClamp(width, 0, 1) * 100)) + "%", rect[0] + rect[2] - 4, rect[1] + 27, sptColor("live_lcd_control_fg_alt"), 7.5, 2);
}

function anPaintStereo(panel) {
    var g = anStereoGeom(panel, anF);
    sptTitle("Stereo", panel.x + 8, 17);
    anPaintCrossover(panel, g);
    sptText("Corr", g.rows[0].corr[0] + g.rows[0].corr[2] * 0.5, 39, sptColor("live_control_fg"), 7.5, 1);
    sptText("Width", g.rows[0].width[0] + g.rows[0].width[2] * 0.5, 39, sptColor("live_control_fg"), 7.5, 1);
    sptText("Bal", g.rows[0].bal[0] + g.rows[0].bal[2] * 0.5, 39, sptColor("live_control_fg"), 7.5, 1);
    var bands = anBands || [
        { corr: 0, width: 0, bal: 0 },
        { corr: 0, width: 0, bal: 0 },
        { corr: 0, width: 0, bal: 0 },
        { corr: 0, width: 0, bal: 0 }
    ];
    var i;
    for (i = 0; i < g.rows.length; i++) {
        var row = g.rows[i];
        var band = bands[i] || { corr: 0, width: 0, bal: 0 };
        var backX = panel.x + 4;
        var backW = g.gonio[0] - backX - 4;
        anRoundRect(backX, row.y, backW, 22, 2, sptMix(sptColor("live_lcd_bg"), sptColor("live_desktop"), 0.4));
        sptRgba(anZoneAccent(i));
        mgraphics.rectangle(backX, row.y + 4, 2, 14);
        mgraphics.fill();
        sptText(AN_BAND_NAMES[i], row.label[0], row.y + 9, sptColor("live_lcd_title"), SPT_SIZE_SMALL, 0);
        sptText(anBandRange(i, g.freqs), row.label[0], row.y + 21, sptColor("live_display_scale_text"), 7, 0);
        anPaintCorrMeter(row.corr, band.corr);
        anPaintWidthMeter(row.width, band.width);
        anPaintBalMeter(row.bal, band.bal);
    }
    anPaintGonio(g.gonio, anScopeL, anScopeR);
    anPaintPhaseBox([g.gonio[0], 122, g.gonio[2], 34], bands);
}

function anLoudScale(index) {
    if (index === 5) return { lo: 0, hi: 20, tick: null };
    if (index === 4) return { lo: -36, hi: 0, tick: -1 };
    return { lo: -48, hi: 0, tick: -14 };
}

function anLoudValue(view, index) {
    if (index === 0) return view.integ;
    if (index === 1) return view.short;
    if (index === 2) return view.mom;
    if (index === 3) return view.rms;
    if (index === 4) return anDbtp(view.tp);
    return view.lra;
}

function anLoudFillColor(index, hot) {
    if (hot) return sptColor("live_alert");
    if (index === 0 || index === 2) return sptColor("live_control_selection");
    if (index === 1 || index === 3) return sptColor("live_lcd_control_fg_alt");
    if (index === 4) return sptColor("live_lcd_control_fg");
    return sptColor("live_control_fg");
}

function anPaintLoudRow(row, index, view) {
    var pair = anLoudNumber(view, index);
    var hot = pair[1];
    var scale = anLoudScale(index);
    var value = anLoudValue(view, index);
    var bx = row[0] + 40;
    var by = row[1] + 3;
    var bw = row[2] - 98;
    var bh = 8;
    anRoundRect(bx, by, bw, bh, 1.5, sptColor("live_lcd_bg"));
    var t = 0;
    if (value !== null && value !== undefined && value > -190) {
        t = anClamp((value - scale.lo) / (scale.hi - scale.lo), 0, 1);
    }
    if (t > 0) anFillIn(anLoudFillColor(index, hot), bx, by, Math.max(1, bw * t), bh, [bx, by, bw, bh]);
    if (scale.tick !== null) {
        var tx = bx + anClamp((scale.tick - scale.lo) / (scale.hi - scale.lo), 0, 1) * bw;
        sptRgba(sptColor("live_lcd_title"));
        mgraphics.rectangle(Math.round(tx), by - 1, 1, bh + 2);
        mgraphics.fill();
    }
    sptText(AN_LOUD_ROWS[index][0], row[0], row[1] + 11, sptColor("live_lcd_title"), SPT_SIZE, 0);
    var text = pair[0] + " " + AN_LOUD_ROWS[index][1];
    var col = hot ? sptColor("live_alert") : sptColor("live_lcd_control_fg_alt");
    sptText(text, row[0] + row[2], row[1] + 11, col, SPT_SIZE, 2);
}

function anLoudNumber(view, index) {
    if (index === 0) return [anFmt(view.integ, 1), false];
    if (index === 1) return [anFmt(view.short, 1), false];
    if (index === 2) return [anFmt(view.mom, 1), false];
    if (index === 3) return [anFmt(view.rms, 1), false];
    if (index === 4) {
        var db = anDbtp(view.tp);
        return [anFmt(db, 1), db > -1];
    }
    return [view.lra === null || view.lra === undefined ? "\u2014" : anFmt(view.lra, 1), false];
}

function anSparkY(v, rect) {
    var t = anClamp((v - (-36)) / 36, 0, 1);
    return rect[1] + rect[3] - 2 - t * (rect[3] - 4);
}

function anPaintSpark(rect, spark) {
    var y14 = anSparkY(-14, rect);
    var y23 = anSparkY(-23, rect);
    sptLcd(rect[0], rect[1], rect[2], rect[3], { ys: [y14, y23] });
    var clip = anPlotBox([rect[0] + 1, rect[1] + 1, rect[2] - 2, rect[3] - 2]);
    sptTextIn("3s HIST", rect[0] + 4, rect[1] + 9, sptColor("live_display_scale_text"), 7.5, 0, clip);
    if (!spark || spark.length < 2) return;
    /** @type {number[][]} */
    var pts = [];
    var i;
    for (i = 0; i < spark.length; i++) {
        var x = rect[0] + 2 + (spark.length <= 1 ? 0 : i / (spark.length - 1)) * (rect[2] - 4);
        pts.push([x, anSparkY(spark[i], rect)]);
    }
    var poly = pts.slice();
    poly.push([pts[pts.length - 1][0], rect[1] + rect[3] - 1]);
    poly.push([pts[0][0], rect[1] + rect[3] - 1]);
    var ink = sptColor("live_control_selection");
    sptFillPolyIn(poly, ink, 0.22, clip);
    sptCurveIn(pts, ink, 1, clip);
}

function anPaintLoud(panel) {
    var g = anLoudGeom(panel);
    var status = (anMask & 1) ? "" : anStatus();
    anHeaderRule(panel);
    if (status) anStatusPill(panel, status);
    else sptTitle("Loudness", panel.x + 8, 17);
    anPill(g.reset, "Reset", 0);
    var view = anView();
    var i;
    for (i = 0; i < g.rows.length; i++) anPaintLoudRow(g.rows[i], i, view);
    anPaintSpark(g.spark, view.spark || []);
}

function paint() {
    if (!anLive()) anEnsureDemo();
    if (mgraphics.set_line_cap) mgraphics.set_line_cap("butt");
    if (mgraphics.set_line_join) mgraphics.set_line_join("miter");
    var w = anFoldWidth(anMask, anOrder);
    var bw = w;
    if (mgraphics.size && mgraphics.size[0] > bw) bw = mgraphics.size[0];
    sptRgba(sptColor("live_surface_bg"));
    mgraphics.rectangle(0, 0, bw, AN_H);
    mgraphics.fill();
    var panels = anSectionRects(anMask, anOrder);
    var i;
    for (i = 0; i < panels.length; i++) {
        anPaintCard(panels[i]);
        if (panels[i].id === "spec") anPaintSpec(panels[i]);
        else if (panels[i].id === "scope") anPaintScope(panels[i]);
        else if (panels[i].id === "stereo") anPaintStereo(panels[i]);
        else if (panels[i].id === "loud") anPaintLoud(panels[i]);
    }
    if (!(anMask & 1) && !(anMask & 8) && panels.length) {
        var status = anStatus();
        if (status) anStatusPill(panels[0], status);
    }
    anPaintRail();
    anPaintTip(w);
}

function anSlotAtY(y) {
    var s = Math.round((y - 16) / 34);
    if (s < 0) s = 0;
    if (s > AN_SECTIONS.length - 1) s = AN_SECTIONS.length - 1;
    return s;
}

function anSnapshot() {
    return {
        mask: anMask,
        order: anOrder.slice(),
        specType: anSpecType,
        scopeMode: anScopeMode,
        scopeTime: anScopeTime,
        trigger: anTrigger,
        f1: anF[0],
        f2: anF[1],
        f3: anF[2]
    };
}

function pushUndoState() {
    anUndoStack.push(anSnapshot());
    if (anUndoStack.length > AN_MAX_UNDO) anUndoStack.shift();
    anRedoStack = [];
}

function anApplySnapshot(snap) {
    if (!snap) return;
    anMask = snap.mask;
    anOrder = snap.order.slice();
    anSpecType = snap.specType;
    anScopeMode = snap.scopeMode;
    anScopeTime = snap.scopeTime;
    anTrigger = snap.trigger;
    anF = [snap.f1, snap.f2, snap.f3];
    anApplyWidth();
    anSendXover();
    notifyclients();
    mgraphics.redraw();
}

function undo() {
    if (anUndoStack.length === 0) return;
    anRedoStack.push(anSnapshot());
    anApplySnapshot(anUndoStack.pop());
}

function redo() {
    if (anRedoStack.length === 0) return;
    anUndoStack.push(anSnapshot());
    anApplySnapshot(anRedoStack.pop());
}

function anClick(hit) {
    if (hit.kind === "freeze") {
        anFrozen = anFrozen ? 0 : 1;
        if (anFrozen) anSnapHold();
        else anHold = null;
    } else if (hit.kind === "spec") anSpecType = hit.index;
    else if (hit.kind === "mode") anScopeMode = hit.index;
    else if (hit.kind === "time") anScopeTime = hit.index;
    else if (hit.kind === "trig") anTrigger = anTrigger ? 0 : 1;
    else if (hit.kind === "reset") anDoReset();
    else return;
    notifyclients();
    mgraphics.redraw();
}

function onclick(x, y) {
    var hit = anHitAt(x, y, anMask, anOrder, anF);
    anDrag = null;
    if (!hit) return;
    if (hit.kind === "rail" || hit.kind === "xover") {
        pushUndoState();
        anDrag = { kind: hit.kind, index: hit.index, x0: x, y0: y, moved: 0 };
        return;
    }
    // freeze / loudness reset are session-only; blob fields need undo.
    if (hit.kind !== "freeze" && hit.kind !== "reset") pushUndoState();
    anClick(hit);
}

function ondrag(x, y, but) {
    if (!anDrag) return;
    if (!but) {
        anEndDrag();
        return;
    }
    if (anDrag.kind === "rail") {
        if (Math.abs(y - anDrag.y0) < 4) return;
        anDrag.moved = 1;
        var slot = anSlotAtY(y);
        if (slot !== anDrag.index) {
            var order = anOrder.slice();
            var item = order.splice(anDrag.index, 1)[0];
            order.splice(slot, 0, item);
            anOrder = order;
            anDrag.index = slot;
            mgraphics.redraw();
        }
    } else if (anDrag.kind === "xover") {
        anDrag.moved = 1;
        var f = [anF[0], anF[1], anF[2]];
        var panels = anSectionRects(anMask, anOrder);
        var p = null;
        var i;
        for (i = 0; i < panels.length; i++) if (panels[i].id === "stereo") p = panels[i];
        if (!p) return;
        var axis = anStereoGeom(p, anF).axis;
        f[anDrag.index] = anXToFreq(x, axis[0], axis[2]);
        anF = anClampXover(f[0], f[1], f[2]);
        anSendXover();
        mgraphics.redraw();
    }
}

function anEndDrag() {
    var d = anDrag;
    anDrag = null;
    if (!d) return;
    if (d.kind === "rail" && !d.moved) {
        anMask = anMask ^ (1 << anOrder[d.index]);
        anApplyWidth();
    }
    if (d.kind === "xover") anSendXover();
    notifyclients();
    mgraphics.redraw();
}

function ondblclick(x, y) {
    var hit = anHitAt(x, y, anMask, anOrder, anF);
    if (!hit || hit.kind !== "xover") return;
    pushUndoState();
    var f = [anF[0], anF[1], anF[2]];
    f[hit.index] = AN_XOVER_DEFAULT[hit.index];
    anF = anClampXover(f[0], f[1], f[2]);
    anSendXover();
    notifyclients();
    mgraphics.redraw();
}

function onidle(x, y) {
    var hit = anHitAt(x, y, anMask, anOrder, anF);
    var kind = "";
    var slot = -1;
    if (hit && hit.kind === "rail") {
        kind = "rail";
        slot = hit.index;
    } else if (hit && hit.kind === "freeze") kind = "freeze";
    if (kind !== anHoverKind || slot !== anHoverSlot) {
        anHoverKind = kind;
        anHoverSlot = slot;
        mgraphics.redraw();
    }
}

function onidleout() {
    if (!anHoverKind) return;
    anHoverKind = "";
    anHoverSlot = -1;
    mgraphics.redraw();
}

function getvalueof() {
    return anBlob({
        mask: anMask,
        order: anOrder,
        specType: anSpecType,
        scopeMode: anScopeMode,
        scopeTime: anScopeTime,
        trigger: anTrigger,
        f1: anF[0],
        f2: anF[1],
        f3: anF[2]
    });
}

function setvalueof() {
    var saved = anFromBlob(arrayfromargs(arguments));
    anMask = saved.mask;
    anOrder = saved.order;
    anSpecType = saved.specType;
    anScopeMode = saved.scopeMode;
    anScopeTime = saved.scopeTime;
    anTrigger = saved.trigger;
    anF = [saved.f1, saved.f2, saved.f3];
    anApplyWidth();
    anSendXover();
    mgraphics.redraw();
}

function setbuffer(name) {
    if (name) anBufName = String(name);
}

function loadbang() {
    anApplyWidth();
    anStartPoll();
    if (typeof sptApplyPanelTheme === "function") {
        sptApplyPanelTheme([["obj-panel-body", "live_surface_bg"]], anHost);
    }
    if (!anThemeOn && typeof sptThemeWatch === "function") {
        anThemeOn = 1;
        sptThemeWatch(function () {
            if (typeof sptApplyPanelTheme === "function") {
                sptApplyPanelTheme([["obj-panel-body", "live_surface_bg"]], anHost);
            }
            mgraphics.redraw();
        });
    }
}

function notifydeleted() {
    if (anPollTask) {
        try { anPollTask.cancel(); } catch (err) {}
        anPollTask = null;
    }
}
