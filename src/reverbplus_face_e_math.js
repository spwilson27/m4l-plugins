// Reverb+ face `e` ("Direct manipulation") pure helpers: a copy of reverbplus_face_math.js (waterfall geometry, RT60
// curve, history, ghost, IR spectrogram) with the display re-laid for 396 x 161 px, plus the handle model: parameter
// scales, handle positions and their inverses, the readout bar, the TAIL page rows. Prepended (after
// reverbplus_config.js + reverbplus_face_common.js) to the face script, and loaded by tests/test_reverbplus_face_e.js.

var RC = { BANDS: 32, ROWS: 28, ROW_MS: 150, IR_ROWS: 28, F0: 40, FMAX: 18000 };

// Plot geometry in the display v8ui's own pixels (396 x 161).
var RCG = { x0: 30, x1: 366, cx: 198, yFront: 102, yBack: 62, hFront: 40, backScale: 0.55 };

// Handle geometry: predelay ruler, decay track, RT60-ratio strip (K px per octave of decay multiplier).
var REG = { rulerX: 40, rulerW: 176, rulerY: 26, decTop: 36, decBot: 96, stripY: 106, stripH: 28, K: 5.2, decX: 0 };

// Parameter scales (lo, hi, exponent: value = lo + (hi - lo) * pos^exp, like the live.* objects) and defaults;
// tests/test_reverbplus_face_e.js compares them with the build's parameter table.
var REP = {
    decay: [0.1, 60, 3, 2.5], predelay: [0, 500, 3, 20], damp: [1000, 20000, 3, 7000], bassmult: [0.25, 4, 2.32, 1.2],
    xover: [100, 1000, 2, 350], lowcut: [20, 1000, 3, 60], highcut: [1000, 20000, 3, 16000], irdecay: [0, 100, 1, 100],
    modrate: [0.05, 5, 3, 0.6], moddepth: [0, 100, 1, 25], erlevel: [-70, 6, 1, 0], latelevel: [-70, 6, 1, 0],
    width: [0, 150, 1, 100], duck: [0, 100, 1, 0], duckrel: [10, 2000, 3, 250], output: [-36, 12, 1, 0], looplevel: [-18, 6, 1, 0],
};

/** Parameter value -> 0..1 slider position. */
function rcPos(key, v) {
    var e = REP[key];
    return rpClamp(Math.pow(rpClamp((v - e[0]) / (e[1] - e[0]), 0, 1), 1 / e[2]), 0, 1);
}

/** 0..1 slider position -> parameter value. */
function rcVal(key, pos) {
    var e = REP[key];
    return e[0] + (e[1] - e[0]) * Math.pow(rpClamp(pos, 0, 1), e[2]);
}

/**
 * Every hit / draw rectangle of the display, from the v8ui size.
 * @param {number} w
 * @param {number} h
 */
function rcLayout(w, h) {
    return {
        tabs: [{ id: "page", index: 0, x: 4, y: 1, w: 46, h: 13 }, { id: "page", index: 1, x: 52, y: 1, w: 46, h: 13 }],
        info: { x: 0, y: 15, w: w, h: 14 },
        ruler: { x: REG.rulerX, y: REG.rulerY - 6, w: REG.rulerW, h: 12 },
        plot: { x: 0, y: 30, w: w, h: 74 },
        strip: { x: RCG.x0, y: REG.stripY, w: RCG.x1 - RCG.x0, h: REG.stripH },
        bar: { x: 4, y: 138, w: w - 8, h: 22 },
        browse: { id: "browse", x: w - 36, y: 16, w: 16, h: 11 },
        clear: { id: "clear", x: w - 17, y: 16, w: 14, h: 11 },
        pillMinX: 104,
    };
}

function rcInRect(r, x, y) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

function rcTop(sr) {
    return Math.min(RC.FMAX, (sr || 48000) * 0.45);
}

/** Lower / upper edge (Hz) of band b of rpSpectrum32. */
function rcBandEdges(b, sr) {
    var f1 = rcTop(sr);
    return [RC.F0 * Math.pow(f1 / RC.F0, b / RC.BANDS), RC.F0 * Math.pow(f1 / RC.F0, (b + 1) / RC.BANDS)];
}

function rcBandHz(b, sr) {
    var e = rcBandEdges(b, sr);
    return Math.sqrt(e[0] * e[1]);
}

/** 0..1 position of a frequency on the band axis. */
function rcFreqPos(f, sr) {
    return rpClamp(Math.log(f / RC.F0) / Math.log(rcTop(sr) / RC.F0), 0, 1);
}

/**
 * Perspective of waterfall row t (0 = newest / front, 1 = oldest / back).
 * @param {number} t
 */
function rcRowGeom(t) {
    var s = 1 - (1 - RCG.backScale) * t;
    return { s: s, base: RCG.yFront - (RCG.yFront - RCG.yBack) * t, hmax: RCG.hFront * s };
}

/** x of band b (centre) on a row of perspective scale s. */
function rcBandX(b, s) {
    var xf = RCG.x0 + (RCG.x1 - RCG.x0) * (b + 0.5) / RC.BANDS;
    return RCG.cx + (xf - RCG.cx) * s;
}

/** x (px) at the front row of a frequency. */
function rcFreqX(f, sr, s) {
    var xf = RCG.x0 + (RCG.x1 - RCG.x0) * rcFreqPos(f, sr);
    return RCG.cx + (xf - RCG.cx) * (s === undefined ? 1 : s);
}

/** Band under a click in the waterfall plot (inverse of the perspective at the click's depth). Always 0..31. */
function rcHitBand(x, y) {
    var t = rpClamp((RCG.yFront - y) / (RCG.yFront - RCG.yBack), 0, 1);
    var s = rcRowGeom(t).s;
    var xf = (x - RCG.cx) / s + RCG.cx;
    return rpClamp(Math.floor((xf - RCG.x0) / (RCG.x1 - RCG.x0) * RC.BANDS), 0, RC.BANDS - 1);
}

/** Band under an x in the flat dry / wet strip. */
function rcStripBand(x) {
    return rpClamp(Math.floor((x - RCG.x0) / (RCG.x1 - RCG.x0) * RC.BANDS), 0, RC.BANDS - 1);
}

/** wet / dry level in dB (full-scale sine = 0) -> 0..1 for the surface. */
function rcLevel01(db) {
    return rpClamp((db + 80) / 60, 0, 1);
}

// ---- RT60 per band ----------------------------------------------------------------------------------

/**
 * Expected RT60 (s) of each of the 32 bands. Tank algorithms: the telemetry's low / mid values (bass
 * multiplier below the crossover) times the HF damping shelf (what the tank does above HF Damping).
 * Convolution: the telemetry's low / mid / high values interpolated over log frequency.
 * @param {{lo: number, mid: number, hi: number}} t  RT60 telemetry (s)
 * @param {{conv: boolean, damp: number, xover: number}} p
 * @param {number} sr
 * @returns {Float32Array}
 */
function rcRt60Curve(t, p, sr) {
    var out = new Float32Array(RC.BANDS);
    var mid = Math.max(t.mid, 0.05);
    var g = rpClamp(t.lo / mid, 0.2, 5);
    var damp = rpClamp(p.damp, 1000, 20000);
    var xo = rpClamp(p.xover, 100, 1000);
    var ratio = function (f) { return 0.2 + 0.8 / (1 + Math.pow(f / damp, 2)); };
    var r1k = ratio(1000);
    for (var b = 0; b < RC.BANDS; b++) {
        var f = rcBandHz(b, sr);
        var v;
        if (p.conv) {
            var lo = t.lo > 0 ? t.lo : mid, hi = t.hi > 0 ? t.hi : mid;
            if (f < 250) v = lo;
            else if (f < 1000) v = lo + (mid - lo) * Math.log(f / 250) / Math.log(4);
            else if (f < 8000) v = mid + (hi - mid) * Math.log(f / 1000) / Math.log(8);
            else v = hi;
        } else {
            var wl = 1 / (1 + Math.pow(f / xo, 4));
            v = mid * (1 + (g - 1) * wl) * Math.min(1, ratio(f) / r1k);
        }
        out[b] = rpClamp(v, 0.05, 60);
    }
    return out;
}

// ---- waterfall history ---------------------------------------------------------------------------------

/** @returns {{rows: Float32Array[], tot: number[], t: number[]}} index 0 = newest */
function rcHistNew() {
    return { rows: [], tot: [], t: [] };
}

/** Mean power of the bands in dB. */
function rcTotalDb(row) {
    var e = 0;
    for (var i = 0; i < row.length; i++) e += Math.pow(10, row[i] / 10);
    return 10 * Math.log10(Math.max(e / row.length, 1e-12));
}

function rcHistPush(hist, wetDb, nowMs) {
    var row = new Float32Array(RC.BANDS);
    for (var i = 0; i < RC.BANDS; i++) row[i] = wetDb[i];
    hist.rows.unshift(row);
    hist.tot.unshift(rcTotalDb(row));
    hist.t.unshift(nowMs);
    if (hist.rows.length > RC.ROWS) {
        hist.rows.length = RC.ROWS;
        hist.tot.length = RC.ROWS;
        hist.t.length = RC.ROWS;
    }
}

/** Seconds between rows (measured from the time stamps). */
function rcRowSec(hist) {
    var n = hist.t.length;
    if (n < 4) return RC.ROW_MS / 1000;
    return Math.max(0.02, (hist.t[0] - hist.t[n - 1]) / (n - 1) / 1000);
}

/** Row index of the loudest entry (the hit the decay is measured from), or -1 when nothing audible. */
function rcFindHit(hist) {
    var best = -1;
    var bv = -75;
    for (var i = 0; i < hist.tot.length; i++) {
        if (hist.tot[i] > bv + 0.01) { bv = hist.tot[i]; best = i; }
    }
    return best;
}

/**
 * The decay the settings predict: rows newer than the hit, each band falling 60 dB per RT60 from where it
 * stood at the hit. Row r (0 newest) is (hit - r) rows after the hit.
 * @returns {Array<Float32Array | null>}
 */
function rcGhost(hist, rt, hit, rowSec) {
    var out = [];
    for (var r = 0; r < hist.rows.length; r++) {
        if (hit < 0 || r >= hit) { out.push(null); continue; }
        var src = hist.rows[hit];
        var row = new Float32Array(RC.BANDS);
        for (var b = 0; b < RC.BANDS; b++) row[b] = src[b] - 60 * (hit - r) * rowSec / Math.max(rt[b], 0.05);
        out.push(row);
    }
    return out;
}

/** dB of one band over the history, oldest first. */
function rcBandSeries(hist, b) {
    var n = hist.rows.length;
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) out[i] = hist.rows[n - 1 - i][b];
    return out;
}

// ---- impulse-response spectrogram (from the partition spectra the engine writes) --------------------------

/** Per band bin range [k0, k1) of an rfft of `nfft` points (nbins = nfft / 2 + 1). */
function rcIrMap(nbins, nfft, sr) {
    var k0 = new Int32Array(RC.BANDS);
    var k1 = new Int32Array(RC.BANDS);
    for (var b = 0; b < RC.BANDS; b++) {
        var e = rcBandEdges(b, sr);
        var a = rpClamp(Math.floor(e[0] * nfft / sr), 0, nbins - 1);
        var z = rpClamp(Math.ceil(e[1] * nfft / sr), a + 1, nbins);
        k0[b] = a;
        k1[b] = z;
    }
    return { k0: k0, k1: k1, nbins: nbins };
}

/**
 * Power per sample in each band of one partition spectrum (4 floats per bin: Lre Lim Rre Rim).
 * @param {ArrayLike<number>} part
 * @param {number} off
 * @param {{k0: Int32Array, k1: Int32Array}} map
 * @param {number} P  partition length in samples (128 or 2048)
 * @param {Float64Array} out
 */
function rcIrPsd(part, off, map, P, out) {
    for (var b = 0; b < RC.BANDS; b++) {
        var s = 0;
        for (var k = map.k0[b]; k < map.k1[b]; k++) {
            var o = off + k * 4;
            s += (part[o] * part[o] + part[o + 1] * part[o + 1] + part[o + 2] * part[o + 2] + part[o + 3] * part[o + 3]) * 0.5;
        }
        out[b] = s / Math.max(1, map.k1[b] - map.k0[b]) / P;
    }
}

function rcIrNew(len) {
    return { len: Math.max(1, len), acc: new Float64Array(RC.IR_ROWS * RC.BANDS), cnt: new Int32Array(RC.IR_ROWS) };
}

/** Add one partition (its centre at sample `pos`) to the row it falls in. */
function rcIrAdd(st, pos, psd) {
    var row = rpClamp(Math.floor(pos / st.len * RC.IR_ROWS), 0, RC.IR_ROWS - 1);
    for (var b = 0; b < RC.BANDS; b++) st.acc[row * RC.BANDS + b] += psd[b];
    st.cnt[row]++;
}

/**
 * Rows in dB relative to the loudest cell (0 = loudest, -120 = floor); empty rows repeat the one before.
 * @returns {Float32Array}  IR_ROWS * BANDS, row 0 = the start of the IR
 */
function rcIrFinish(st) {
    var rows = new Float32Array(RC.IR_ROWS * RC.BANDS);
    var mx = 1e-30;
    var r, b;
    for (r = 0; r < RC.IR_ROWS; r++) {
        for (b = 0; b < RC.BANDS; b++) {
            var v = st.cnt[r] ? st.acc[r * RC.BANDS + b] / st.cnt[r] : (r ? rows[(r - 1) * RC.BANDS + b] : 0);
            rows[r * RC.BANDS + b] = v;
            mx = Math.max(mx, v);
        }
    }
    for (var i = 0; i < rows.length; i++) rows[i] = Math.max(-120, 10 * Math.log10(Math.max(rows[i], 1e-30) / mx));
    return rows;
}

/** IR cell dB (relative) -> 0..1. */
function rcIrLevel01(db) {
    return rpClamp((db + 60) / 60, 0, 1);
}

// ---- handles: positions, inverses, readout ---------------------------------------------------------------------

/** Frequency (Hz) at an x of the front axis (inverse of rcFreqX at s = 1). */
function rcXToFreq(x, sr) {
    var pos = rpClamp((x - RCG.x0) / (RCG.x1 - RCG.x0), 0, 1);
    return RC.F0 * Math.pow(rcTop(sr) / RC.F0, pos);
}

function rcStripMid() {
    return REG.stripY + REG.stripH / 2;
}

/** y in the RT60-ratio strip of a decay multiplier (1 = the Decay value; up = longer). */
function rcStripY(ratio) {
    var y = rcStripMid() - Math.log(Math.max(ratio, 0.01)) / Math.LN2 * REG.K;
    return rpClamp(y, REG.stripY + 3, REG.stripY + REG.stripH - 3);
}

function rcRatioFromY(y) {
    return Math.pow(2, (rcStripMid() - y) / REG.K);
}

/** Decay multiplier of the tank at f (Hz): bass multiplier below the crossover times the HF damping shelf. */
function rcRatioTank(f, damp, xover, bass) {
    var g = rpClamp(bass, 0.2, 5);
    var d = rpClamp(damp, 1000, 20000);
    var xo = rpClamp(xover, 100, 1000);
    var ratio = function (q) { return 0.2 + 0.8 / (1 + Math.pow(q / d, 2)); };
    var wl = 1 / (1 + Math.pow(f / xo, 4));
    return (1 + (g - 1) * wl) * Math.min(1, ratio(f) / ratio(1000));
}

// The six handles. colour = a key of RPC (Live theme colours), cell = their place in the readout bar.
var RCH = [
    { id: 0, num: 1, key: "decay", label: "DECAY", color: "cyan" },
    { id: 1, num: 2, key: "damp", label: "HF DAMP", color: "amber" },
    { id: 2, num: 3, key: "xover", label: "BASS / X-OVER", color: "green" },
    { id: 3, num: 4, key: "lowcut", label: "LOW CUT", color: "violet" },
    { id: 4, num: 5, key: "highcut", label: "HIGH CUT", color: "violet" },
    { id: 5, num: 6, key: "predelay", label: "PRE-DELAY", color: "text" },
];

/**
 * Handle positions for the current parameters.
 * @param {(k: string, d: number) => number} get  parameter value (key, default)
 * @param {number} algo
 * @param {number} sr
 * @param {((f: number) => number) | null} [ratioAt]  decay multiplier at f for the HF Damp node (Convolution)
 */
function rcHandles(get, algo, sr, ratioAt) {
    var conv = algo === RP_ALGO.CONV;
    var inact = RP_INACTIVE[rpIndex(algo, RP_ALGOS.length)];
    var out = [];
    for (var i = 0; i < RCH.length; i++) {
        var d = RCH[i];
        var h = { id: d.id, num: d.num, label: d.label, color: d.color, key: d.key, vis: true, on: true, x: 0, y: 0 };
        if (d.id === 0) {
            h.key = conv ? "irdecay" : "decay";
            h.label = conv ? "IR DECAY" : "DECAY";
            var pos = rcPos(h.key, get(h.key, REP[h.key][3]));
            h.x = rcFreqX(1000, sr, 1);
            h.y = REG.decBot - pos * (REG.decBot - REG.decTop);
        } else if (d.id === 1) {
            var damp = get("damp", REP.damp[3]);
            h.x = rcFreqX(damp, sr, 1);
            var r = ratioAt ? ratioAt(damp) : rcRatioTank(damp, damp, get("xover", 350), get("bassmult", 1.2));
            h.y = rcStripY(r);
        } else if (d.id === 2) {
            h.x = rcFreqX(get("xover", REP.xover[3]), sr, 1);
            h.y = rcStripY(get("bassmult", REP.bassmult[3]));
            h.vis = !conv;
            h.on = inact.indexOf("xover") < 0;
        } else if (d.id === 3 || d.id === 4) {
            h.x = rcFreqX(get(d.key, REP[d.key][3]), sr, 1);
            h.y = RCG.yFront;
        } else {
            h.x = REG.rulerX + REG.rulerW * rcPos("predelay", get("predelay", REP.predelay[3]));
            h.y = REG.rulerY;
        }
        out.push(h);
    }
    return out;
}

/** Nearest visible, active handle within `rad` px, or -1. Ties go to the lower id. */
function rcHitHandle(hs, x, y, rad) {
    var best = -1;
    var bd = rad * rad;
    for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        if (!h.vis || !h.on) continue;
        var d = (h.x - x) * (h.x - x) + (h.y - y) * (h.y - y);
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}

/**
 * The parameter writes a drag of handle `id` to (x, y) makes: [[key, value], ...].
 * @returns {Array<[string, number]>}
 */
function rcDragWrites(id, x, y, sr, algo) {
    var conv = algo === RP_ALGO.CONV;
    var atL = x <= RCG.x0 + 1, atR = x >= RCG.x1 - 1;
    if (id === 0) {
        var pos = (REG.decBot - y) / (REG.decBot - REG.decTop);
        return [[conv ? "irdecay" : "decay", rcVal(conv ? "irdecay" : "decay", pos)]];
    }
    if (id === 1) return [["damp", atR ? 20000 : rpClamp(rcXToFreq(x, sr), 1000, 20000)]];
    if (id === 2) return [["xover", rpClamp(rcXToFreq(x, sr), 100, 1000)], ["bassmult", rpClamp(rcRatioFromY(y), 0.25, 4)]];
    if (id === 3) return [["lowcut", atL ? 20 : rpClamp(rcXToFreq(x, sr), 20, 1000)]];
    if (id === 4) return [["highcut", atR ? 20000 : rpClamp(rcXToFreq(x, sr), 1000, 20000)]];
    return [["predelay", rcVal("predelay", (x - REG.rulerX) / REG.rulerW)]];
}

/** Double-click on a handle: the writes that reset it. */
function rcResetWrites(id, algo) {
    var conv = algo === RP_ALGO.CONV;
    if (id === 0) return [[conv ? "irdecay" : "decay", REP[conv ? "irdecay" : "decay"][3]]];
    if (id === 2) return [["xover", REP.xover[3]], ["bassmult", REP.bassmult[3]]];
    var k = RCH[id].key;
    return [[k, REP[k][3]]];
}

/**
 * Readout bar text per handle (LCD values).
 * @returns {Array<{label: string, value: string, vis: boolean}>}
 */
function rcReadout(get, algo) {
    var conv = algo === RP_ALGO.CONV;
    return [
        { label: conv ? "IR DECAY" : "DECAY", value: conv ? get("irdecay", 100).toFixed(0) + " %" : rpFormatSec(get("decay", 2.5)), vis: true },
        { label: "HF DAMP", value: rpFormatHz(get("damp", 7000)), vis: true },
        { label: "BASS / X-OVER", value: conv ? "n/a" : "x" + get("bassmult", 1.2).toFixed(2) + " " + rpFormatHz(get("xover", 350)), vis: !conv },
        { label: "LOW CUT", value: rpFormatHz(get("lowcut", 60)), vis: true },
        { label: "HIGH CUT", value: rpFormatHz(get("highcut", 16000)), vis: true },
        { label: "PRE-DELAY", value: rpFormatMs(get("predelay", 20)), vis: true },
    ];
}

/** Rectangle of cell i of the readout bar. */
function rcCellRect(bar, i) {
    var cw = bar.w / 6;
    return { x: bar.x + i * cw, y: bar.y, w: cw, h: bar.h };
}

// ---- TAIL page ---------------------------------------------------------------------------------------------------------

/** Text of a TAIL-page value. */
function rcFormatTail(key, v) {
    if (key === "modrate") return v.toFixed(2) + " Hz";
    if (key === "moddepth" || key === "duck" || key === "width") return v.toFixed(0) + " %";
    if (key === "duckrel") return rpFormatMs(v);
    if (key === "erlevel" || key === "latelevel") return v <= -69.9 ? "Off" : (v > 0 ? "+" : "") + v.toFixed(1) + " dB";
    return (v > 0 ? "+" : "") + v.toFixed(1) + " dB";
}

/** Layout of the TAIL page: group titles (with hairlines), value bars and the clip-mode chips. */
function rcTailLayout(w) {
    var colA = 8, colB = 204, lw = 52, bw = 112;
    var rows = [], titles = [];
    function title(text, x, y) { titles.push({ text: text, x: x, y: y, w: lw + 4 + bw }); }
    function bar(key, label, x, y) { rows.push({ key: key, label: label, kind: "bar", x: x + lw + 4, y: y, w: bw, h: 12, lx: x, ly: y }); }
    title("MODULATION", colA, 20); bar("modrate", "Rate", colA, 34); bar("moddepth", "Depth", colA, 50);
    title("LEVELS", colA, 70); bar("erlevel", "Early", colA, 84); bar("latelevel", "Late", colA, 100); bar("width", "Width", colA, 116);
    title("DUCKING", colB, 20); bar("duck", "Amount", colB, 34); bar("duckrel", "Release", colB, 50);
    title("OUTPUT", colB, 70); bar("output", "Output", colB, 84); bar("looplevel", "Clip Level", colB, 100);
    rows.push({ key: "loopclip", label: "Clip Mode", kind: "chips", x: colB + lw + 4, y: 116, w: bw, h: 12, lx: colB, ly: 116 });
    return { rows: rows, titles: titles, div: { x: 198, y0: 20, y1: 130 } };
}

/** Hit test of the TAIL page: {key, chip?} or null. */
function rcTailHit(w, x, y) {
    var T = rcTailLayout(w);
    for (var i = 0; i < T.rows.length; i++) {
        var r = T.rows[i];
        if (!rcInRect({ x: r.x, y: r.y - 1, w: r.w, h: r.h + 2 }, x, y)) continue;
        if (r.kind === "chips") return { key: r.key, chip: rpClamp(Math.floor((x - r.x) / (r.w / 3)), 0, 2) };
        return { key: r.key, chip: -1 };
    }
    return null;
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        RC, RCG, rcLayout, rcInRect, rcBandEdges, rcBandHz, rcFreqPos, rcRowGeom, rcBandX, rcFreqX, rcHitBand, rcStripBand, rcLevel01,
        rcRt60Curve, rcHistNew, rcHistPush, rcRowSec, rcFindHit, rcGhost, rcBandSeries, rcIrMap, rcIrPsd, rcIrNew, rcIrAdd, rcIrFinish,
        rcIrLevel01, rcTotalDb, REG, REP, RCH, rcPos, rcVal, rcXToFreq, rcStripY, rcRatioFromY, rcRatioTank, rcHandles, rcHitHandle,
        rcDragWrites, rcResetWrites, rcReadout, rcCellRect, rcFormatTail, rcTailLayout, rcTailHit, rcStripMid,
    };
}
