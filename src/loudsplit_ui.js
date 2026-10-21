// loudsplit_ui.js — Loud Split face (v8ui, one canvas) + spectral_link wiring. The build concatenates
//   loudsplit_config.js, spectral_link.js, this file  into the v8ui script.
//
// Canvas (LS_VIZ_W x LS_VIZ_H), laid out like Bitwig's Loud Split display: top row = `Relative Loudness Mode` toggle (left) and
// `Rise` value (right), bottom row = `Tilt` value (left) and `Fall` value (right) (click the toggle, drag a value vertically,
// double-click resets; Rise / Fall are logarithmic, Tilt linear); a second HUD row holds the resolved channel pill, chain chip and
// the PRE/POST and SPEC/SONO toggles; between them a log-frequency level plot (-110..0 dB): the Mid spectrum coloured by the Quiet / Mid / Loud share of each column (or the three channels after
// the masks, or a scrolling sonogram) with the two threshold lines on top. A line is dragged vertically; Alt / Shift / Ctrl-drag
// sets its Knee (the shaded band is the crossfade). The line follows Tilt (it is the weighted level that is classified) and, in
// Relative mode, the loudest bin of the frame. A dot at the right end of each line is a momentary band solo: while it is held
// this instance outputs that threshold's outer band (Higher: Loud, Lower: Quiet). Double-click a line resets the threshold.
//
// Messages in:  set_<key> <value> for hithr lothr rhithr rlothr hiknee loknee relative rise fall tilt size output dispost disstyle,
//               setbuffer <name>, init_link (live.thisdevice), preview helpers.
// Outlets:      0 [key value]  edits made on the canvas -> route -> the live.* object (which then drives gen as usual)
//               1 [key value]  values applied from a rack peer -> route -> `prepend set` into the live.* object + gen
//               2 outsel <0..3>  resolved output selection for the gen (0 = all channels summed), including a held solo
//               3 act_abs|act_rel <0|1>  greys out the unused threshold pair (route -> prepend active)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 4;

var LS_VIZ_W = 290;
var LS_VIZ_H = 157;
var LS_COL_Q = [0.45, 0.85, 0.45];
var LS_COL_M = [1.0, 0.80, 0.25];
var LS_COL_L = [1.0, 0.42, 0.38];
var LS_PLOT = { x: 4, y: 33, w: 262, h: 108 };
var LS_DOT_X = 278;
var LS_COL_RISE = [1.0, 0.62, 0.25];
var LS_COL_TILT = [0.78, 0.45, 1.0];
var LS_SONO_COLS = 64;
var LS_SONO_ROWS = 22;
var LS_DEFAULTS = { hithr: -30, lothr: -85, rhithr: -12, rlothr: -36, rise: 2, fall: 8, tilt: 0 };

var lsVals = { hithr: -30, lothr: -85, rhithr: -12, rlothr: -36, hiknee: 6, loknee: 6, relative: 0, rise: 2, fall: 8, tilt: 0,
    mix: 100, size: 1, output: 0, dispost: 0, disstyle: 0 };
var lsPre = [];
var lsQ = [];
var lsM = [];
var lsL = [];
var lsSono = [];          // rows of {lv: [...64], w: [[q, m, l] ...]}, newest last
var lsScalars = { frame: 0, awake: 0, sr: 48000, n: 2048, level: 0, mean: 0, lmax: -20 };
var lsLmaxS = -20;        // smoothed loudest-bin level (Relative mode lines)
var lsBufName = "";
var lsBuf = null;
var lsTask = null;
var lsLastFrame = -1;
var lsDrag = null;
var lsSolo = "";          // "hi" | "lo" while a solo dot is held
var lsLink = null;
var lsInfo = { instanceId: "", isInRack: false, chainIndex: 0, chainCount: 0, peers: 1, linked: false, autoChannel: -1 };
var lsSel = 0;
var lsLastSel = -1;
var lsLastAct = -1;

(function initArrays() {
    for (var i = 0; i < LS_NCOLS; i++) {
        lsPre.push(0);
        lsQ.push(0);
        lsM.push(0);
        lsL.push(0);
    }
})();

// ---------------------------------------------------------------- state in
function lsSetVal(key, v) {
    lsVals[key] = v;
    if (key === "output") lsEmitSel();
    if (key === "relative") lsEmitActive();
    if (lsLink && LS_LINKED_KEYS.indexOf(key) >= 0) lsLink.notify(key, v);
    mgraphics.redraw();
}

function set_hithr(v) { lsSetVal("hithr", Number(v)); }
function set_lothr(v) { lsSetVal("lothr", Number(v)); }
function set_rhithr(v) { lsSetVal("rhithr", Number(v)); }
function set_rlothr(v) { lsSetVal("rlothr", Number(v)); }
function set_hiknee(v) { lsSetVal("hiknee", Number(v)); }
function set_loknee(v) { lsSetVal("loknee", Number(v)); }
function set_relative(v) { lsSetVal("relative", Number(v) ? 1 : 0); }
function set_rise(v) { lsSetVal("rise", Number(v)); }
function set_fall(v) { lsSetVal("fall", Number(v)); }
function set_tilt(v) { lsSetVal("tilt", Number(v)); }
function set_mix(v) { lsSetVal("mix", Number(v)); }
function set_size(v) { lsSetVal("size", Number(v)); }
function set_output(v) { lsSetVal("output", Number(v)); }
function set_dispost(v) { lsSetVal("dispost", Number(v) ? 1 : 0); }
function set_disstyle(v) { lsSetVal("disstyle", Number(v) ? 1 : 0); }

function lsEmitSel() {
    var base = lsResolveSel(lsVals.output, lsInfo.autoChannel);
    lsSel = lsSolo === "hi" ? 3 : (lsSolo === "lo" ? 1 : base);
    if (lsSel !== lsLastSel) {
        lsLastSel = lsSel;
        outlet(2, "outsel", lsSel);
    }
}

// grey out the threshold pair that Relative mode does not use
function lsEmitActive() {
    var rel = lsVals.relative ? 1 : 0;
    if (rel === lsLastAct) return;
    lsLastAct = rel;
    outlet(3, "act_abs", rel ? 0 : 1);
    outlet(3, "act_rel", rel);
}

// ---------------------------------------------------------------- link
function init_link() {
    lsLastAct = -1;
    lsEmitActive();
    if (lsLink) return;
    if (typeof LiveAPI === "undefined" || typeof Global === "undefined") return;
    lsLink = splCreateLink({
        kind: "loudsplit",
        keys: LS_LINKED_KEYS,
        channelCount: 3,
        getLocal: function (key) { return lsVals[key]; },
        apply: function (key, value) {
            lsVals[key] = value;
            outlet(1, key, value);
            if (key === "relative") lsEmitActive();
            mgraphics.redraw();
        },
        onInfo: function (info) {
            lsInfo = info;
            lsEmitSel();
            mgraphics.redraw();
        }
    });
    lsLink.init();
    lsStartPolling();
}

function setbuffer(name) {
    splNoteScope(name);
    lsBufName = name ? String(name) : "";
    lsBuf = null;
    lsStartPolling();
}

function lsStartPolling() {
    if (lsTask || typeof Task === "undefined") return;
    lsTask = new Task(lsPoll, this);
    lsTask.interval = 66;
    lsTask.repeat();
}

function lsPoll() {
    if (!lsBufName) return;
    try {
        if (!lsBuf) lsBuf = new Buffer(lsBufName);
        var d = lsBuf.peek(1, 0, LS_SCOPE_SAMPS);
        if (!d || d.length < LS_SC_LMAX + 1) return;
        var frame = d[LS_SC_FRAME];
        var aw = d[LS_SC_AWAKE];
        if (frame === lsLastFrame && aw === lsScalars.awake) return;
        lsLastFrame = frame;
        for (var c = 0; c < LS_NCOLS; c++) {
            lsPre[c] = d[LS_SC_PRE + c];
            lsQ[c] = d[LS_SC_QUIET + c];
            lsM[c] = d[LS_SC_MID + c];
            lsL[c] = d[LS_SC_LOUD + c];
        }
        lsScalars.frame = frame;
        lsScalars.awake = aw;
        lsScalars.sr = d[LS_SC_SR];
        lsScalars.n = d[LS_SC_N];
        lsScalars.level = d[LS_SC_LEVEL];
        lsScalars.mean = d[LS_SC_LOUDMEAN];
        lsScalars.lmax = d[LS_SC_LMAX];
        if (aw > 0.5) lsLmaxS += (lsScalars.lmax - lsLmaxS) * 0.5;
        lsPushSono();
        mgraphics.redraw();
    } catch (err) {
        lsBuf = null;
    }
}

// linear amplitude of a 0..1 (-100..0 dB) telemetry value
function lsAmp(v) {
    return v <= 0 ? 0 : Math.pow(10, (v * 100 - 100) / 20);
}

// Quiet / Mid / Loud shares [q, m, l] of a column (amplitudes after the masks)
function lsShares(c) {
    var q = lsAmp(lsQ[c]);
    var m = lsAmp(lsM[c]);
    var l = lsAmp(lsL[c]);
    var s = q + m + l;
    if (s < 1e-12) return [0, 1, 0];
    return [q / s, m / s, l / s];
}

function lsPushSono() {
    var lv = [];
    var w = [];
    var per = LS_NCOLS / LS_SONO_COLS;
    for (var c = 0; c < LS_SONO_COLS; c++) {
        var mx = 0;
        var acc = [0, 0, 0];
        var ws = 0;
        for (var j = 0; j < per; j++) {
            var i = c * per + j;
            var l = lsPre[i];
            if (l > mx) mx = l;
            var sh = lsShares(i);
            var wt = lsAmp(l) + 1e-9;
            acc[0] += sh[0] * wt;
            acc[1] += sh[1] * wt;
            acc[2] += sh[2] * wt;
            ws += wt;
        }
        lv.push(mx);
        w.push([acc[0] / ws, acc[1] / ws, acc[2] / ws]);
    }
    lsSono.push({ lv: lv, w: w });
    while (lsSono.length > LS_SONO_ROWS) lsSono.shift();
}

// ---------------------------------------------------------------- drawing helpers
function lsRgba(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a);
}

function lsMix3(w) {
    return [LS_COL_Q[0] * w[0] + LS_COL_M[0] * w[1] + LS_COL_L[0] * w[2],
        LS_COL_Q[1] * w[0] + LS_COL_M[1] * w[1] + LS_COL_L[1] * w[2],
        LS_COL_Q[2] * w[0] + LS_COL_M[2] * w[1] + LS_COL_L[2] * w[2]];
}

function lsText(str, x, y, size, col, a, align) {
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(size);
    var xx = x;
    if (align === 1 || align === 2) {
        var w = mgraphics.text_measure(str)[0];
        xx = align === 1 ? x - w * 0.5 : x - w;
    }
    lsRgba(col, a);
    mgraphics.move_to(xx, y);
    mgraphics.show_text(str);
}

function lsRRect(x, y, w, h, r) {
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
}

// dB (-90..0) <-> plot y
function lsYdb(db) {
    return LS_PLOT.y + (1 - (db - LS_DB_MIN) / (LS_DB_MAX - LS_DB_MIN)) * LS_PLOT.h;
}

function lsDbY(y) {
    return LS_DB_MIN + (1 - (y - LS_PLOT.y) / LS_PLOT.h) * (LS_DB_MAX - LS_DB_MIN);
}

// 0..1 telemetry level (-100..0 dB) -> plot height fraction
function lsLv(v) {
    var t = (v * 100 - 100 - LS_DB_MIN) / (LS_DB_MAX - LS_DB_MIN);
    return t < 0 ? 0 : (t > 1 ? 1 : t);
}

function lsColX(c) {
    return LS_PLOT.x + (c + 0.5) * LS_PLOT.w / LS_NCOLS;
}

function lsFreqX(f) {
    var t = Math.log(f / LS_FMIN) / Math.log(LS_FMAX / LS_FMIN);
    return LS_PLOT.x + t * LS_PLOT.w;
}

// tilt weight (dB) at a plot x: the classified level is the signal level plus this
function lsTiltAtX(x) {
    var f = LS_FMIN * Math.pow(LS_FMAX / LS_FMIN, (x - LS_PLOT.x) / LS_PLOT.w);
    return lsVals.tilt * Math.log(f / LS_TILT_REF_HZ) * 1.4426950408889634;
}

// Effective thresholds shown (dB, in the tilted level domain): Relative adds the loudest bin of the frame.
function lsEffHi() {
    return lsVals.relative ? lsLmaxS + lsVals.rhithr : lsVals.hithr;
}

function lsEffLo() {
    var lo = lsVals.relative ? lsLmaxS + lsVals.rlothr : lsVals.lothr;
    return Math.min(lo, lsEffHi());
}

// y of a threshold line at plot x
function lsLineY(eff, x) {
    return lsYdb(eff - lsTiltAtX(x));
}

function lsToggleRects() {
    return {
        post: { x: LS_VIZ_W - 94, y: 18, w: 44, h: 13 },
        style: { x: LS_VIZ_W - 46, y: 18, w: 42, h: 13 },
        rel: { x: 4, y: 2, w: 132, h: 14 },
        rise: { x: LS_VIZ_W - 92, y: 2, w: 88, h: 14 },
        tilt: { x: 4, y: LS_VIZ_H - 16, w: 112, h: 14 },
        fall: { x: LS_VIZ_W - 92, y: LS_VIZ_H - 16, w: 88, h: 14 }
    };
}

function lsInside(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function lsKeys(which) {
    var rel = lsVals.relative ? 1 : 0;
    if (which === "hi") return { thr: rel ? "rhithr" : "hithr", knee: "hiknee" };
    return { thr: rel ? "rlothr" : "lothr", knee: "loknee" };
}

// ---------------------------------------------------------------- paint
function paint() {
    var W = LS_VIZ_W;
    var H = LS_VIZ_H;
    mgraphics.set_source_rgba(0.045, 0.06, 0.08, 1);
    lsRRect(0, 0, W, H, 5);
    mgraphics.fill();

    // HUD: resolved channel pill (a held solo dot overrides it) and chain chip
    var selName = lsSelName(lsSel);
    var pillCol = lsSel === 1 ? LS_COL_Q : (lsSel === 2 ? LS_COL_M : (lsSel === 3 ? LS_COL_L : [0.78, 0.84, 0.9]));
    var pillText = lsSel === 0 ? "OUT ALL" : (lsSolo ? "SOLO " : "OUT ") + lsSel + " " + selName.toUpperCase();
    var pw = pillText.length * 5.2 + 12;
    lsRgba(pillCol, 0.22);
    lsRRect(4, 18, pw, 13, 6);
    mgraphics.fill();
    lsRgba(pillCol, 0.9);
    mgraphics.set_line_width(1);
    lsRRect(4, 18, pw, 13, 6);
    mgraphics.stroke();
    lsText(pillText, 10, 27.6, 7.5, pillCol, 1, 0);
    var chip = lsInfo.isInRack ? ("CH " + (lsInfo.chainIndex + 1) + "/" + Math.max(lsInfo.chainCount, 1)
        + (lsInfo.linked ? " LINKED" : "")) : "NO RACK";
    lsText(chip, 4 + pw + 6, 27.6, 7.0, [0.55, 0.64, 0.74], 1, 0);

    var t = lsToggleRects();
    lsRgba([0.16, 0.2, 0.26], 1);
    lsRRect(t.post.x, t.post.y, t.post.w, t.post.h, 3);
    mgraphics.fill();
    lsRRect(t.style.x, t.style.y, t.style.w, t.style.h, 3);
    mgraphics.fill();
    lsText(lsVals.dispost ? "POST" : "PRE", t.post.x + t.post.w * 0.5, 27.4, 7.5, [0.92, 0.96, 1.0], 1, 1);
    lsText(lsVals.disstyle ? "SONO" : "SPEC", t.style.x + t.style.w * 0.5, 27.4, 7.5, [0.92, 0.96, 1.0], 1, 1);

    // plot background, frequency and level grid
    mgraphics.set_source_rgba(0.075, 0.095, 0.12, 1);
    lsRRect(LS_PLOT.x, LS_PLOT.y, LS_PLOT.w, LS_PLOT.h, 3);
    mgraphics.fill();
    var freqs = [100, 1000, 10000];
    var labels = ["100", "1k", "10k"];
    for (var g = 0; g < freqs.length; g++) {
        var gx = lsFreqX(freqs[g]);
        mgraphics.set_source_rgba(0.5, 0.6, 0.7, 0.16);
        mgraphics.rectangle(gx, LS_PLOT.y, 1, LS_PLOT.h);
        mgraphics.fill();
        lsText(labels[g], gx + 2, LS_PLOT.y + LS_PLOT.h - 2, 6.5, [0.5, 0.6, 0.7], 0.8, 0);
    }
    for (var d = -100; d <= -20; d += 20) {
        var gy = lsYdb(d);
        mgraphics.set_source_rgba(0.5, 0.6, 0.7, 0.12);
        mgraphics.rectangle(LS_PLOT.x, gy, LS_PLOT.w, 1);
        mgraphics.fill();
        lsText(String(d), LS_PLOT.x + LS_PLOT.w - 2, gy - 1.5, 6.0, [0.5, 0.6, 0.7], 0.7, 2);
    }

    if (lsVals.disstyle) lsPaintSono();
    else if (lsVals.dispost) lsPaintPost();
    else lsPaintPre();

    if (lsScalars.awake < 0.5) lsText("no signal", LS_PLOT.x + LS_PLOT.w * 0.5, LS_PLOT.y + 20, 8, [0.5, 0.6, 0.7], 0.8, 1);

    lsPaintThreshold("lo");
    lsPaintThreshold("hi");
    lsPaintCorners();
}

// Bitwig's four display values: Relative Loudness Mode toggle + Rise (top), Tilt + Fall (bottom)
function lsPaintCorners() {
    var t = lsToggleRects();
    var on = lsVals.relative ? 1 : 0;
    var cb = { x: t.rel.x, y: t.rel.y + 2, w: 9, h: 9 };
    mgraphics.set_line_width(1);
    lsRgba(on ? LS_COL_M : [0.5, 0.6, 0.7], 1);
    lsRRect(cb.x, cb.y, cb.w, cb.h, 2);
    if (on) mgraphics.fill();
    else mgraphics.stroke();
    lsText("Relative Loudness Mode", cb.x + 14, t.rel.y + 10.5, 8, on ? [0.92, 0.96, 1.0] : [0.62, 0.7, 0.78], 1, 0);
    var items = [{ lab: "Rise", txt: lsVals.rise.toFixed(2), r: t.rise, col: LS_COL_RISE, key: "rise" },
        { lab: "Fall", txt: lsVals.fall.toFixed(2), r: t.fall, col: LS_COL_RISE, key: "fall" },
        { lab: "Tilt", txt: lsVals.tilt.toFixed(1) + " dB/oct", r: t.tilt, col: LS_COL_TILT, key: "tilt" }];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var r = it.r;
        var act = lsDrag && lsDrag.kind === "val" && lsDrag.key === it.key;
        if (it.key === "tilt") {
            lsText(it.lab, r.x, r.y + 10.5, 8, [0.62, 0.7, 0.78], 1, 0);
            lsText(it.txt, r.x + 28, r.y + 10.5, 8, it.col, act ? 1 : 0.9, 0);
        } else {
            lsText(it.lab, r.x + 20, r.y + 10.5, 8, [0.62, 0.7, 0.78], 1, 0);
            lsText(it.txt, r.x + r.w, r.y + 10.5, 8, it.col, act ? 1 : 0.9, 2);
        }
    }
}

function lsPaintPre() {
    var base = LS_PLOT.y + LS_PLOT.h;
    var cw = LS_PLOT.w / LS_NCOLS;
    for (var c = 0; c < LS_NCOLS; c++) {
        var h = lsLv(lsPre[c]) * (LS_PLOT.h - 2);
        if (h < 0.5) continue;
        lsRgba(lsMix3(lsShares(c)), 0.85);
        mgraphics.rectangle(LS_PLOT.x + c * cw, base - h, Math.max(cw - 0.4, 1), h);
        mgraphics.fill();
    }
}

function lsArea(arr, col, a, lineA) {
    var base = LS_PLOT.y + LS_PLOT.h;
    mgraphics.move_to(LS_PLOT.x, base);
    for (var c = 0; c < LS_NCOLS; c++) mgraphics.line_to(lsColX(c), base - lsLv(arr[c]) * (LS_PLOT.h - 2));
    mgraphics.line_to(LS_PLOT.x + LS_PLOT.w, base);
    mgraphics.close_path();
    lsRgba(col, a);
    mgraphics.fill();
    mgraphics.set_line_width(1.0);
    mgraphics.move_to(lsColX(0), base - lsLv(arr[0]) * (LS_PLOT.h - 2));
    for (var k = 1; k < LS_NCOLS; k++) mgraphics.line_to(lsColX(k), base - lsLv(arr[k]) * (LS_PLOT.h - 2));
    lsRgba(col, lineA);
    mgraphics.stroke();
}

function lsPaintPost() {
    // the selected channel is bright, the others dimmed (All: all bright)
    var aq = (lsSel === 0 || lsSel === 1) ? 0.55 : 0.2;
    var am = (lsSel === 0 || lsSel === 2) ? 0.55 : 0.2;
    var al = (lsSel === 0 || lsSel === 3) ? 0.55 : 0.2;
    lsArea(lsQ, LS_COL_Q, aq, aq > 0.3 ? 0.95 : 0.4);
    lsArea(lsM, LS_COL_M, am, am > 0.3 ? 0.95 : 0.4);
    lsArea(lsL, LS_COL_L, al, al > 0.3 ? 0.95 : 0.4);
}

function lsPaintSono() {
    var cw = LS_PLOT.w / LS_SONO_COLS;
    var rh = LS_PLOT.h / LS_SONO_ROWS;
    var off = LS_SONO_ROWS - lsSono.length;
    for (var r = 0; r < lsSono.length; r++) {
        var row = lsSono[r];
        var y = LS_PLOT.y + (off + r) * rh;
        for (var c = 0; c < LS_SONO_COLS; c++) {
            var a = lsLv(row.lv[c]);
            if (a < 0.04) continue;
            lsRgba(lsMix3(row.w[c]), 0.12 + 0.88 * a);
            mgraphics.rectangle(LS_PLOT.x + c * cw, y, cw + 0.3, rh + 0.3);
            mgraphics.fill();
        }
    }
}

// One threshold: knee band, line (follows Tilt), value label and the solo dot at the right.
function lsPaintThreshold(which) {
    var hi = which === "hi";
    var col = hi ? LS_COL_L : LS_COL_Q;
    var eff = hi ? lsEffHi() : lsEffLo();
    var knee = hi ? lsVals.hiknee : lsVals.loknee;
    var x0 = LS_PLOT.x;
    var x1 = LS_PLOT.x + LS_PLOT.w;
    var y0 = lsLineY(eff, x0);
    var y1 = lsLineY(eff, x1);
    var kp = knee * 0.5 * LS_PLOT.h / (LS_DB_MAX - LS_DB_MIN);
    var dragging = lsDrag && lsDrag.which === which;
    if (kp > 0.3) {
        mgraphics.move_to(x0, y0 - kp);
        mgraphics.line_to(x1, y1 - kp);
        mgraphics.line_to(x1, y1 + kp);
        mgraphics.line_to(x0, y0 + kp);
        mgraphics.close_path();
        lsRgba(col, dragging && lsDrag.kind === "knee" ? 0.28 : 0.14);
        mgraphics.fill();
    }
    mgraphics.set_line_width(dragging ? 1.6 : 1.1);
    lsRgba(col, 0.95);
    mgraphics.move_to(x0, y0);
    mgraphics.line_to(x1, y1);
    mgraphics.stroke();
    // stub to the dot and the dot itself
    var dy = Math.max(LS_PLOT.y + 3, Math.min(LS_PLOT.y + LS_PLOT.h - 3, y1));
    mgraphics.set_line_width(1);
    lsRgba(col, 0.5);
    mgraphics.move_to(x1, y1);
    mgraphics.line_to(LS_DOT_X, dy);
    mgraphics.stroke();
    var held = lsSolo === which;
    lsRgba(col, held ? 1 : 0.85);
    mgraphics.arc(LS_DOT_X, dy, held ? 5.2 : 4.2, 0, Math.PI * 2);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.04, 0.05, 0.07, 1);
    mgraphics.arc(LS_DOT_X, dy, 1.6, 0, Math.PI * 2);
    mgraphics.fill();
    // label (value as set, "REL" in Relative mode) above the line at the left
    var keys = lsKeys(which);
    var v = lsVals[keys.thr];
    var txt = (hi ? "HI " : "LO ") + v.toFixed(1) + (lsVals.relative ? " REL" : " dB");
    if (dragging && lsDrag.kind === "knee") txt = "KNEE " + knee.toFixed(1) + " dB";
    var ly = Math.max(LS_PLOT.y + 8, Math.min(LS_PLOT.y + LS_PLOT.h - 3, y0 - kp - 2));
    if (hi && ly > LS_PLOT.y + LS_PLOT.h - 10) ly = y0 + kp + 8;
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(7);
    var tw = mgraphics.text_measure(txt)[0];
    mgraphics.set_source_rgba(0.045, 0.06, 0.08, 0.78);
    lsRRect(LS_PLOT.x + 2, ly - 8, tw + 6, 10, 3);
    mgraphics.fill();
    lsText(txt, LS_PLOT.x + 5, ly, 7, col, 1, 0);
}

// ---------------------------------------------------------------- interaction
function lsEmitEdit(key, v) {
    outlet(0, key, v);
}

function onclick(x, y, but, cmd, shift, capslock, option, ctrl) {
    lsHandleDown(x, y, false, !!(shift || option || ctrl));
}

function ondblclick(x, y) {
    lsHandleDown(x, y, true, false);
}

// nearest of the two threshold lines (or dots) under the pointer
function lsPick(x, y) {
    var best = null;
    var which = ["hi", "lo"];
    for (var i = 0; i < 2; i++) {
        var w = which[i];
        var eff = w === "hi" ? lsEffHi() : lsEffLo();
        var yr = lsLineY(eff, LS_PLOT.x + LS_PLOT.w);
        var dyDot = Math.max(LS_PLOT.y + 3, Math.min(LS_PLOT.y + LS_PLOT.h - 3, yr));
        if (Math.abs(x - LS_DOT_X) < 9 && Math.abs(y - dyDot) < 9) {
            var dd = Math.abs(y - dyDot);
            if (!best || dd < best.dist) best = { which: w, dot: true, dist: dd };
        } else if (x >= LS_PLOT.x - 2 && x <= LS_PLOT.x + LS_PLOT.w + 2) {
            var dl = Math.abs(y - lsLineY(eff, Math.max(LS_PLOT.x, Math.min(LS_PLOT.x + LS_PLOT.w, x))));
            if (dl < 6 && (!best || dl < best.dist)) best = { which: w, dot: false, dist: dl };
        }
    }
    return best;
}

function lsHandleDown(x, y, dbl, mod) {
    var t = lsToggleRects();
    if (lsInside(t.post, x, y)) {
        lsEmitEdit("dispost", lsVals.dispost ? 0 : 1);
        return;
    }
    if (lsInside(t.style, x, y)) {
        lsEmitEdit("disstyle", lsVals.disstyle ? 0 : 1);
        return;
    }
    if (lsInside(t.rel, x, y)) {
        if (!dbl) lsEmitEdit("relative", lsVals.relative ? 0 : 1);
        return;
    }
    var vk = ["rise", "fall", "tilt"];
    for (var vi = 0; vi < vk.length; vi++) {
        if (lsInside(t[vk[vi]], x, y)) {
            if (dbl) lsEmitEdit(vk[vi], LS_DEFAULTS[vk[vi]]);
            else lsDrag = { kind: "val", key: vk[vi], startY: y, startVal: lsVals[vk[vi]] };
            mgraphics.redraw();
            return;
        }
    }
    var hit = lsPick(x, y);
    if (!hit) return;
    var keys = lsKeys(hit.which);
    if (hit.dot) {
        if (dbl) return;
        lsSolo = hit.which;
        lsDrag = { kind: "solo", which: hit.which };
        lsEmitSel();
        mgraphics.redraw();
        return;
    }
    if (dbl) {
        lsEmitEdit(keys.thr, LS_DEFAULTS[keys.thr]);
        return;
    }
    var eff = hit.which === "hi" ? lsEffHi() : lsEffLo();
    var knee = lsVals[keys.knee];
    if (mod) {
        var d0 = Math.abs(lsDbY(y) - (eff - lsTiltAtX(x)));
        lsDrag = { kind: "knee", which: hit.which, x: x, off: 2 * d0 - knee };
    } else {
        lsDrag = { kind: "thr", which: hit.which, startY: y, startVal: lsVals[keys.thr] };
    }
    mgraphics.redraw();
}

function ondrag(x, y, but, cmd, shift, capslock, option, ctrl) {
    if (!but) {
        if (lsDrag && lsDrag.kind === "solo") {
            lsSolo = "";
            lsEmitSel();
        }
        lsDrag = null;
        mgraphics.redraw();
        return;
    }
    lsDragTo(x, y);
}

function lsDragTo(x, y) {
    if (!lsDrag || lsDrag.kind === "solo") return;
    if (lsDrag.kind === "val") {
        var nv;
        if (lsDrag.key === "tilt") {
            nv = Math.round(Math.max(-6, Math.min(6, lsDrag.startVal + (lsDrag.startY - y) * 12 / 150)) * 10) / 10;
        } else {
            nv = lsDrag.startVal * Math.exp((lsDrag.startY - y) * Math.log(LS_BLOCKS_MAX / LS_BLOCKS_MIN) / 150);
            nv = Math.round(Math.max(LS_BLOCKS_MIN, Math.min(LS_BLOCKS_MAX, nv)) * 100) / 100;
        }
        if (nv !== lsVals[lsDrag.key]) lsEmitEdit(lsDrag.key, nv);
        return;
    }
    var keys = lsKeys(lsDrag.which);
    if (lsDrag.kind === "thr") {
        var v = lsDrag.startVal + (lsDrag.startY - y) * (LS_DB_MAX - LS_DB_MIN) / LS_PLOT.h;
        v = Math.round(v * 2) / 2;
        var rel = lsVals.relative ? 1 : 0;
        var other = lsDrag.which === "hi" ? lsVals[rel ? "rlothr" : "lothr"] : lsVals[rel ? "rhithr" : "hithr"];
        v = lsDrag.which === "hi" ? Math.max(v, other) : Math.min(v, other);
        v = Math.max(LS_DB_MIN, Math.min(LS_DB_MAX, v));
        if (v !== lsVals[keys.thr]) lsEmitEdit(keys.thr, v);
    } else if (lsDrag.kind === "knee") {
        var eff = lsDrag.which === "hi" ? lsEffHi() : lsEffLo();
        var d = Math.abs(lsDbY(y) - (eff - lsTiltAtX(lsDrag.x)));
        var kn = Math.round((2 * d - lsDrag.off) * 2) / 2;
        kn = Math.max(LS_MIN_KNEE, Math.min(LS_MAX_KNEE, kn));
        if (kn !== lsVals[keys.knee]) lsEmitEdit(keys.knee, kn);
    }
}

function onidle() {}
function onidleout() {}

// ---------------------------------------------------------------- preview (scripts/render_preview.py calls preview() then paint())
function preview() {
    lsInfo = { instanceId: "p", isInRack: true, chainIndex: 2, chainCount: 3, peers: 3, linked: true, autoChannel: 2 };
    // demo state = the live.* parameter defaults (Higher -30, Lower -85, knees 6 dB, Rise 2, Fall 8, Tilt 0)
    lsVals.hithr = -30;
    lsVals.lothr = -85;
    lsVals.hiknee = 6;
    lsVals.loknee = 6;
    lsVals.tilt = 0;
    lsVals.dispost = 0;
    lsSel = 3;
    lsScalars.awake = 1;
    var q = [0, 0, 0];
    for (var c = 0; c < LS_NCOLS; c++) {
        var f = LS_FMIN * Math.pow(LS_FMAX / LS_FMIN, c / LS_NCOLS);
        var db = -62 - 34 * Math.log(f / 100) / Math.log(100) + 3 * Math.sin(c * 1.7)
            + 50 * Math.exp(-Math.pow((f - 440) / 50, 2)) + 42 * Math.exp(-Math.pow((f - 1320) / 120, 2))
            + 22 * Math.exp(-Math.pow((f - 3100) / 300, 2));
        db = Math.max(-106, db);
        lsPre[c] = (db + 100) / 100;
        var tl = lsVals.tilt * Math.log(f / LS_TILT_REF_HZ) * 1.4426950408889634;
        lsBandMasks(db + tl, lsVals.hithr, lsVals.lothr, lsVals.hiknee, lsVals.loknee, q);
        lsQ[c] = Math.max(0, (db + 100 + 20 * Math.log(q[0] + 1e-5) / Math.LN10) / 100);
        lsM[c] = Math.max(0, (db + 100 + 20 * Math.log(q[1] + 1e-5) / Math.LN10) / 100);
        lsL[c] = Math.max(0, (db + 100 + 20 * Math.log(q[2] + 1e-5) / Math.LN10) / 100);
    }
    for (var r = 0; r < LS_SONO_ROWS; r++) lsPushSono();
}
