// Reverb+ face `b` ("Hybrid tabs", scripts/reverbplus_layouts/b.py) pure helpers: layout rectangles, band tables,
// perspective geometry, RT60-per-band curve, waterfall history, expected-decay ghost, impulse-response spectrogram
// (copied from reverbplus_face_math.js, geometry changed for the 394 x 104 display canvas) plus the Tone page's EQ view
// (filter + decay curves and their four nodes), the Loop page diagram rectangles and the page / algorithm visibility
// rules that show / hide the live.* widgets under the display. Prepended (after reverbplus_config.js +
// reverbplus_face_common.js) to the face script and loaded by tests/test_reverbplus_face_b.js.

var RC = { BANDS: 32, ROWS: 28, ROW_MS: 150, IR_ROWS: 28, F0: 40, FMAX: 18000 };

// Waterfall geometry in the display canvas's own pixels (the v8ui is 394 x 104).
var RCG = { x0: 6, x1: 388, cx: 197, yFront: 79, yBack: 41, hFront: 34, backScale: 0.55 };

// Tone page: EQ view rectangle, axis ranges.
var RBT = { x0: 30, x1: 386, y0: 15, y1: 91, fLo: 20, fHi: 20000, dbMax: 15 };

/**
 * Every hit / draw rectangle of the display, from the v8ui size (394 x 104).
 * @param {number} w
 * @param {number} h
 */
function rcLayout(w, h) {
    return {
        info: { x: 0, y: 0, w: w, h: 11 },
        plot: { x: 0, y: 12, w: w, h: 74 },
        strip: { x: RCG.x0, y: 90, w: RCG.x1 - RCG.x0, h: 13 },
        tone: { x: RBT.x0, y: RBT.y0, w: RBT.x1 - RBT.x0, h: RBT.y1 - RBT.y0 },
        pillMinX: 150,
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

// ---- Tone page: EQ view -----------------------------------------------------------------------------------------

/** x (px) of a frequency in the EQ view. */
function rbToneX(f) {
    return RBT.x0 + (RBT.x1 - RBT.x0) * Math.log(rpClamp(f, RBT.fLo, RBT.fHi) / RBT.fLo) / Math.log(RBT.fHi / RBT.fLo);
}

/** Frequency at an x in the EQ view. */
function rbToneF(x) {
    var t = rpClamp((x - RBT.x0) / (RBT.x1 - RBT.x0), 0, 1);
    return RBT.fLo * Math.pow(RBT.fHi / RBT.fLo, t);
}

/** y (px) of a dB value in the EQ view (zero in the middle, +-dbMax at the edges). */
function rbToneY(db) {
    var mid = (RBT.y0 + RBT.y1) / 2;
    return mid - rpClamp(db, -RBT.dbMax, RBT.dbMax) / RBT.dbMax * (RBT.y1 - RBT.y0) / 2;
}

function rbToneDb(y) {
    var mid = (RBT.y0 + RBT.y1) / 2;
    return (mid - y) / ((RBT.y1 - RBT.y0) / 2) * RBT.dbMax;
}

/** Response (dB) of the output filters: 12 dB/oct high-pass at Low Cut and low-pass at High Cut (-3 dB at each cutoff). */
function rbFilterDb(f, lowcut, highcut) {
    return -10 * Math.log10(1 + Math.pow(lowcut / f, 4)) - 10 * Math.log10(1 + Math.pow(f / highcut, 4));
}

/** Decay speed (relative RT60, dB): the bass multiplier below the crossover and the HF damping shelf, as rcRt60Curve. */
function rbDecayDb(f, bass, xover, damp) {
    var ratio = function (g) { return 0.2 + 0.8 / (1 + Math.pow(g / damp, 2)); };
    var wl = 1 / (1 + Math.pow(f / xover, 4));
    var v = (1 + (bass - 1) * wl) * Math.min(1, ratio(f) / ratio(1000));
    return 20 * Math.log10(Math.max(v, 1e-3));
}

/**
 * The four draggable nodes (1 Low Cut, 2 High Cut on the filter curve; 3 HF Damp, 4 Bass on the decay curve).
 * @param {{lowcut: number, highcut: number, damp: number, bassmult: number, xover: number}} p
 * @param {boolean} bassOn  Bass Mult / Crossover apply to the algorithm
 * @returns {Array<{id: number, key: string, f: number, db: number, decay: boolean}>}
 */
function rbNodes(p, bassOn) {
    var bass = bassOn ? p.bassmult : 1;
    var out = [
        { id: 1, key: "lowcut", f: p.lowcut, db: -3, decay: false },
        { id: 2, key: "highcut", f: p.highcut, db: -3, decay: false },
        { id: 3, key: "damp", f: p.damp, db: rbDecayDb(p.damp, bass, p.xover, p.damp), decay: true },
    ];
    if (bassOn) out.push({ id: 4, key: "bassmult", f: p.xover, db: rbDecayDb(p.xover, p.bassmult, p.xover, p.damp), decay: true });
    return out;
}

/** Index of the node under (x, y), the nearest one within r px, or -1. */
function rbHitNode(nodes, x, y, r) {
    var best = -1;
    var bd = (r || 9) * (r || 9);
    for (var i = 0; i < nodes.length; i++) {
        var dx = rbToneX(nodes[i].f) - x, dy = rbToneY(nodes[i].db) - y;
        var d = dx * dx + dy * dy;
        if (d <= bd) { bd = d; best = i; }
    }
    return best;
}

/** Parameter values a drag of `node` to (x, y) writes: {key: value}. */
function rbNodeDrag(node, x, y) {
    var f = rbToneF(x);
    if (node.key === "lowcut") return { lowcut: rpClamp(f, 20, 1000) };
    if (node.key === "highcut") return { highcut: rpClamp(f, 1000, 20000) };
    if (node.key === "damp") return { damp: rpClamp(f, 1000, 20000) };
    // Bass node: x = Crossover, y = decay at the crossover. The weight at the crossover is 0.5, so v = (1 + bass) / 2.
    var v = Math.pow(10, rbToneDb(y) / 20);
    return { xover: rpClamp(f, 100, 1000), bassmult: rpClamp(2 * v - 1, 0.25, 4) };
}

// ---- Loop page diagram ------------------------------------------------------------------------------------------

/** Rectangles of the outer-loop diagram in the 394 x 104 canvas. */
function rbLoopGeom(w) {
    var bw = 100, gap = (w - 3 * bw - 28) / 2;
    var x0 = 14;
    return {
        tank: { x: x0, y: 24, w: bw, h: 34 },
        chain: { x: x0 + bw + gap, y: 24, w: bw, h: 34 },
        clip: { x: x0 + 2 * (bw + gap), y: 24, w: bw, h: 34 },
        returnY: 84,
    };
}

// ---- page / algorithm visibility ----------------------------------------------------------------------------------

/**
 * Which groups of live.* widgets under the display are visible for a page (0 Reverb, 1 Tone, 2 Loop) and an algorithm.
 * The layout (scripts/reverbplus_layouts/b.py) wires one `route g_<name>` -> `prepend hidden` per group.
 * @param {number} page
 * @param {number} algo
 * @returns {{[group: string]: boolean}}
 */
function rbVis(page, algo) {
    var off = RP_INACTIVE[algo];
    var on = function (k) { return off.indexOf(k) < 0; };
    return {
        rev: page === 0,
        tank: page === 0 && on("size"),
        ir: page === 0 && on("irstretch"),
        tone: page === 1,
        tonebass: page === 1 && on("bassmult"),
        loop: page === 2,
        freeze: on("freeze"),
    };
}

var RB_GROUPS = ["rev", "tank", "ir", "tone", "tonebass", "loop", "freeze"];

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        RC, RCG, rcLayout, rcInRect, rcBandEdges, rcBandHz, rcFreqPos, rcRowGeom, rcBandX, rcFreqX, rcHitBand, rcStripBand, rcLevel01,
        rcRt60Curve, rcHistNew, rcHistPush, rcRowSec, rcFindHit, rcGhost, rcBandSeries, rcIrMap, rcIrPsd, rcIrNew, rcIrAdd, rcIrFinish,
        rcIrLevel01, rcTotalDb,
        RBT, rbToneX, rbToneF, rbToneY, rbToneDb, rbFilterDb, rbDecayDb, rbNodes, rbHitNode, rbNodeDrag, rbLoopGeom, rbVis, RB_GROUPS,
    };
}
