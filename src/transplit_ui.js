// transplit_ui.js — Transient Split face (v8ui, one canvas, Bitwig Transient Split (Spectral) display) + spectral_link wiring.
// The build concatenates transplit_config.js, spectral_link.js, this file into the v8ui script.
//
// Canvas (TS_VIZ_W x TS_VIZ_H), like Bitwig's display:
//   top row     `Tilt 0.00 %` (yellow) and `Decay 8.00` (yellow): drag the value vertically, double-click resets
//   left slider Analysis Bias (-100..+100 %, centre marker), right slider Transients/Tones Blend (0..100 %, 50 % centre)
//   plot        Display Style Waveform: scrolling amplitude view, Transients above zero (yellow), Tones below (blue);
//               Display Style Sonogram: frequency-domain history, cells coloured yellow (transient) .. blue (tone)
//   bottom row  Display Style icons (Waveform | Sonogram), PRE | POST toggle, `Smoothing 1.50` (blue, drag to edit)
// The live.* objects stay outside the canvas (right column); canvas edits go out of outlet 0 into them.
//
// Messages in:  set_<key> <value> for ttype bias tdecay tsmooth tilt tmode blend mix size output dispost disstyle,
//               setbuffer <name>, init_link (live.thisdevice), names / preview helpers.
// Outlets:      0 [key value]  edits made on the canvas -> route -> the live.* object (which then drives gen as usual)
//               1 [key value]  values applied from a rack peer -> route -> `prepend set` into the live.* object + gen
//               2 outsel <0|1|2>  resolved output selection for the gen (0 = all channels summed)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 3;

var TS_VIZ_W = 284;
var TS_VIZ_H = 112;
var TS_COL_TR = [1.0, 0.80, 0.25];
var TS_COL_TONE = [0.32, 0.62, 1.0];
var TS_COL_ORANGE = [1.0, 0.62, 0.15];
var TS_PLOT = { x: 22, y: 18, w: 240, h: 78 };
var TS_SLIDER_L = { x: 5, y: 18, w: 12, h: 78 };
var TS_SLIDER_R = { x: 267, y: 18, w: 12, h: 78 };
var TS_SONO_COLS = 60;
var TS_SONO_ROWS = 22;
var TS_WAVE_VIEW = 80;                 // telemetry frames shown by the waveform (3 px each)
var TS_DEFAULTS = { tilt: 0, tdecay: 8, tsmooth: 1.5, bias: 0, blend: 50 };

var tsVals = { ttype: 0, bias: 0, tdecay: 8, tsmooth: 1.5, tilt: 0, tmode: 0, blend: 50, mix: 100, size: 1, output: 0, dispost: 0, disstyle: 0 };
var tsPre = [];
var tsTr = [];
var tsTone = [];
var tsFrac = [];
var tsSono = [];          // rows of {lv: [...60], fr: [...60]}, newest last
var tsWave = [];          // {pt, pq, ot, oq} linear rms per telemetry frame, newest last
var tsScalars = { frame: 0, awake: 0, sr: 48000, n: 1024, level: 0, mean: 0 };
var tsBufName = "";
var tsBuf = null;
var tsTask = null;
var tsLastFrame = -1;
var tsDrag = null;
var tsLink = null;
var tsInfo = { instanceId: "", isInRack: false, chainIndex: 0, chainCount: 0, peers: 1, linked: false, autoChannel: -1 };
var tsSel = 0;
var tsLastSel = -1;

(function initArrays() {
    for (var i = 0; i < TS_NCOLS; i++) {
        tsPre.push(0);
        tsTr.push(0);
        tsTone.push(0);
        tsFrac.push(0);
    }
})();

// ---------------------------------------------------------------- state in
function tsSetVal(key, v) {
    tsVals[key] = v;
    if (key === "output") tsEmitSel();
    if (tsLink && TS_LINKED_KEYS.indexOf(key) >= 0) tsLink.notify(key, v);
    mgraphics.redraw();
}

function set_ttype(v) { tsSetVal("ttype", Number(v)); }
function set_bias(v) { tsSetVal("bias", Number(v)); }
function set_tdecay(v) { tsSetVal("tdecay", Number(v)); }
function set_tsmooth(v) { tsSetVal("tsmooth", Number(v)); }
function set_tilt(v) { tsSetVal("tilt", Number(v)); }
function set_tmode(v) { tsSetVal("tmode", Number(v)); }
function set_blend(v) { tsSetVal("blend", Number(v)); }
function set_mix(v) { tsSetVal("mix", Number(v)); }
function set_size(v) { tsSetVal("size", Number(v)); }
function set_output(v) { tsSetVal("output", Number(v)); }
function set_dispost(v) { tsSetVal("dispost", Number(v) ? 1 : 0); }
function set_disstyle(v) { tsSetVal("disstyle", Number(v) ? 1 : 0); }

function tsEmitSel() {
    tsSel = tsResolveSel(tsVals.output, tsInfo.autoChannel);
    if (tsSel !== tsLastSel) {
        tsLastSel = tsSel;
        outlet(2, "outsel", tsSel);
    }
}

// ---------------------------------------------------------------- link
function init_link() {
    if (tsLink) return;
    if (typeof LiveAPI === "undefined" || typeof Global === "undefined") return;
    tsLink = splCreateLink({
        kind: "transplit",
        keys: TS_LINKED_KEYS,
        channelCount: 2,
        getLocal: function (key) { return tsVals[key]; },
        apply: function (key, value) {
            tsVals[key] = value;
            outlet(1, key, value);
            mgraphics.redraw();
        },
        onInfo: function (info) {
            tsInfo = info;
            tsEmitSel();
            mgraphics.redraw();
        }
    });
    tsLink.init();
    tsStartPolling();
}

function setbuffer(name) {
    splNoteScope(name);
    tsBufName = name ? String(name) : "";
    tsBuf = null;
    tsStartPolling();
}

function tsStartPolling() {
    if (tsTask || typeof Task === "undefined") return;
    tsTask = new Task(tsPoll, this);
    tsTask.interval = 66;
    tsTask.repeat();
}

function tsPushWave(pt, pq, ot, oq) {
    tsWave.push({ pt: pt, pq: pq, ot: ot, oq: oq });
    while (tsWave.length > TS_WAVE_VIEW) tsWave.shift();
}

function tsPoll() {
    if (!tsBufName) return;
    try {
        if (!tsBuf) tsBuf = new Buffer(tsBufName);
        var d = tsBuf.peek(1, 0, TS_SCOPE_SAMPS);
        if (!d || d.length < TS_SC_WAVE + 4) return;
        var frame = d[TS_SC_FRAME];
        var aw = d[TS_SC_AWAKE];
        if (frame === tsLastFrame && aw === tsScalars.awake) return;
        // new waveform ring entries since the last poll (the ring holds TS_WAVE_FRAMES frames)
        if (aw > 0.5) {
            var delta = tsLastFrame < 0 ? Math.min(frame, TS_WAVE_FRAMES) : ((frame - tsLastFrame + TS_FRAME_WRAP) % TS_FRAME_WRAP);
            if (delta > TS_WAVE_FRAMES) delta = TS_WAVE_FRAMES;
            for (var i = frame - delta; i < frame; i++) {
                var f = ((i % TS_FRAME_WRAP) + TS_FRAME_WRAP) % TS_FRAME_WRAP;
                var o = TS_SC_WAVE + (f % TS_WAVE_FRAMES) * TS_WAVE_STRIDE;
                tsPushWave(d[o], d[o + 1], d[o + 2], d[o + 3]);
            }
        } else if (tsScalars.awake > 0.5) {
            for (var z = 0; z < 8; z++) tsPushWave(0, 0, 0, 0);
        }
        tsLastFrame = frame;
        for (var c = 0; c < TS_NCOLS; c++) {
            tsPre[c] = d[TS_SC_PRE + c];
            tsTr[c] = d[TS_SC_TR + c];
            tsTone[c] = d[TS_SC_TONE + c];
            tsFrac[c] = d[TS_SC_FRAC + c];
        }
        tsScalars.frame = frame;
        tsScalars.awake = aw;
        tsScalars.sr = d[TS_SC_SR];
        tsScalars.n = d[TS_SC_N];
        tsScalars.level = d[TS_SC_LEVEL];
        tsScalars.mean = d[TS_SC_TRMEAN];
        tsPushSono();
        mgraphics.redraw();
    } catch (err) {
        tsBuf = null;
    }
}

function tsPushSono() {
    var lv = [];
    var fr = [];
    var per = TS_NCOLS / TS_SONO_COLS;
    for (var c = 0; c < TS_SONO_COLS; c++) {
        var m = 0;
        var f = 0;
        var wsum = 0;
        for (var j = 0; j < per; j++) {
            var i = Math.min(Math.floor(c * per + j), TS_NCOLS - 1);
            var l = tsSel === 1 ? tsTr[i] : (tsSel === 2 ? tsTone[i] : tsPre[i]);
            if (tsVals.dispost === 0) l = tsPre[i];
            if (l > m) m = l;
            f += tsFrac[i] * (l + 0.01);
            wsum += l + 0.01;
        }
        lv.push(m);
        fr.push(f / wsum);
    }
    tsSono.push({ lv: lv, fr: fr });
    while (tsSono.length > TS_SONO_ROWS) tsSono.shift();
}

// ---------------------------------------------------------------- drawing helpers
function tsRgba(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a);
}

function tsMix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function tsText(str, x, y, size, col, a, align) {
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(size);
    var xx = x;
    if (align === 1 || align === 2) {
        var w = mgraphics.text_measure(str)[0];
        xx = align === 1 ? x - w * 0.5 : x - w;
    }
    tsRgba(col, a);
    mgraphics.move_to(xx, y);
    mgraphics.show_text(str);
}

function tsRRect(x, y, w, h, r) {
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
}

// 0..1 level (-100..0 dB) -> plot height fraction, floor at -80 dB
function tsLv(v) {
    var t = (v * 100 - 20) / 80;
    return t < 0 ? 0 : (t > 1 ? 1 : t);
}

// linear rms -> 0..1 (-60..0 dB)
function tsAmp(v) {
    if (!(v > 1e-9)) return 0;
    var t = (20 * Math.log(v) / Math.LN10 + 60) / 60;
    return t < 0 ? 0 : (t > 1 ? 1 : t);
}

function tsFreqX(f) {
    var t = Math.log(f / TS_FMIN) / Math.log(TS_FMAX / TS_FMIN);
    return TS_PLOT.x + t * TS_PLOT.w;
}

function tsInside(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// ---------------------------------------------------------------- layout (hit rects shared by paint and interaction)
function tsRects() {
    return {
        tilt: { x: 56, y: 2, w: 80, h: 14 },
        decay: { x: 146, y: 2, w: 80, h: 14 },
        smooth: { x: 140, y: 97, w: 100, h: 14 },
        wave: { x: 24, y: 98, w: 16, h: 12 },
        sono: { x: 44, y: 98, w: 16, h: 12 },
        post: { x: 66, y: 98, w: 36, h: 12 }
    };
}

function tsSliderY(sl, frac) {
    return sl.y + sl.h * (1 - frac);
}

// ---------------------------------------------------------------- paint
function tsValueLabel(rect, label, value, col, active) {
    tsText(label, rect.x, rect.y + 11, 9, [0.80, 0.84, 0.88], 0.75, 0);
    tsText(value, rect.x + rect.w, rect.y + 11, 9, col, active ? 1 : 0.95, 2);
}

function paint() {
    var W = TS_VIZ_W;
    var H = TS_VIZ_H;
    mgraphics.set_source_rgba(0.075, 0.078, 0.085, 1);
    tsRRect(0, 0, W, H, 5);
    mgraphics.fill();
    var R = tsRects();

    // top row: Tilt and Decay
    tsValueLabel(R.tilt, "Tilt", tsFormatPct(tsVals.tilt), TS_COL_TR, tsDrag && tsDrag.kind === "tilt");
    tsValueLabel(R.decay, "Decay", tsFormatBlocks(tsVals.tdecay), TS_COL_TR, tsDrag && tsDrag.kind === "tdecay");

    // plot background
    mgraphics.set_source_rgba(0.115, 0.118, 0.125, 1);
    tsRRect(TS_PLOT.x, TS_PLOT.y, TS_PLOT.w, TS_PLOT.h, 3);
    mgraphics.fill();

    if (tsVals.disstyle) tsPaintSono();
    else tsPaintWave();

    // channel pill and chain chip inside the plot corners
    var pillCol = tsSel === 1 ? TS_COL_TR : (tsSel === 2 ? TS_COL_TONE : [0.78, 0.84, 0.9]);
    var pillText = tsSel === 0 ? "OUT ALL" : "OUT " + tsSel + " " + tsSelName(tsSel).toUpperCase();
    tsText(pillText, TS_PLOT.x + 4, TS_PLOT.y + 8.5, 6.5, pillCol, 0.9, 0);
    var chip = tsInfo.isInRack ? ("CH " + (tsInfo.chainIndex + 1) + "/" + Math.max(tsInfo.chainCount, 1)
        + (tsInfo.linked ? " LINKED" : "")) : "NO RACK";
    tsText(chip, TS_PLOT.x + TS_PLOT.w - 4, TS_PLOT.y + 8.5, 6.5, [0.62, 0.66, 0.72], 0.9, 2);
    if (tsScalars.awake < 0.5) tsText("no signal", TS_PLOT.x + TS_PLOT.w * 0.5, TS_PLOT.y + 20, 8, [0.6, 0.64, 0.7], 0.8, 1);

    // bottom row: style icons, PRE | POST, Smoothing
    tsPaintIcon(R.wave, 0, tsVals.disstyle === 0);
    tsPaintIcon(R.sono, 1, tsVals.disstyle === 1);
    tsRgba([0.2, 0.21, 0.23], 1);
    tsRRect(R.post.x, R.post.y, R.post.w, R.post.h, 3);
    mgraphics.fill();
    tsText(tsVals.dispost ? "POST" : "PRE", R.post.x + R.post.w * 0.5, R.post.y + 9.2, 7.5, [0.9, 0.92, 0.95], 1, 1);
    tsValueLabel(R.smooth, "Smoothing", tsFormatBlocks(tsVals.tsmooth), TS_COL_TONE, tsDrag && tsDrag.kind === "tsmooth");

    tsPaintSlider(TS_SLIDER_L, (tsVals.bias + 100) / 200, tsVals.bias >= 0 ? TS_COL_TR : TS_COL_TONE);
    tsPaintSlider(TS_SLIDER_R, tsVals.blend / 100, tsVals.blend >= 50 ? TS_COL_TR : TS_COL_TONE);
}

function tsPaintIcon(r, kind, on) {
    var col = on ? TS_COL_ORANGE : [0.46, 0.48, 0.52];
    tsRgba(col, 1);
    mgraphics.set_line_width(1.2);
    var i;
    if (kind === 0) {
        // decaying burst
        var hs = [0.9, 0.55, 0.8, 0.35, 0.5, 0.2, 0.3, 0.12];
        for (i = 0; i < hs.length; i++) {
            var cx = r.x + 1.5 + i * 1.9;
            mgraphics.move_to(cx, r.y + r.h * 0.5 - hs[i] * r.h * 0.5);
            mgraphics.line_to(cx, r.y + r.h * 0.5 + hs[i] * r.h * 0.5);
        }
        mgraphics.stroke();
    } else {
        var bh = [0.35, 0.7, 0.5, 0.9, 0.3, 0.55, 0.2];
        for (i = 0; i < bh.length; i++) {
            mgraphics.rectangle(r.x + 1 + i * 2.2, r.y + r.h - 1 - bh[i] * (r.h - 2), 1.4, bh[i] * (r.h - 2));
            mgraphics.fill();
        }
    }
}

// centre-marked vertical slider: grey track, orange centre tick, fill from the centre to the orange handle
function tsPaintSlider(s, frac, col) {
    mgraphics.set_source_rgba(0.2, 0.21, 0.23, 1);
    tsRRect(s.x, s.y, s.w, s.h, 4);
    mgraphics.fill();
    var cy = s.y + s.h * 0.5;
    var hy = tsSliderY(s, frac);
    tsRgba(col, 0.42);
    mgraphics.rectangle(s.x + 3, Math.min(hy, cy), s.w - 6, Math.abs(cy - hy));
    mgraphics.fill();
    tsRgba(TS_COL_ORANGE, 1);
    mgraphics.rectangle(s.x - 1, cy - 0.5, s.w + 2, 1.5);
    mgraphics.fill();
    if (Math.abs(hy - cy) > 1) {
        tsRgba(TS_COL_ORANGE, 1);
        mgraphics.rectangle(s.x, hy - 1, s.w, 2.5);
        mgraphics.fill();
    }
}

// Waveform: Transients above zero (yellow), Tones below (blue), newest on the right. Post dims the channel that is not this
// instance's output; Pre shows the analysis split before Tilt / Blend.
function tsPaintWave() {
    var mid = TS_PLOT.y + TS_PLOT.h * 0.5;
    var half = TS_PLOT.h * 0.5 - 9;
    var fw = TS_PLOT.w / TS_WAVE_VIEW;
    mgraphics.set_source_rgba(0.55, 0.57, 0.6, 0.55);
    mgraphics.rectangle(TS_PLOT.x + 4, mid - 0.5, TS_PLOT.w - 8, 1);
    mgraphics.fill();
    var post = tsVals.dispost === 1;
    var trA = post && tsSel === 2 ? 0.3 : 0.95;
    var toA = post && tsSel === 1 ? 0.3 : 0.95;
    var off = TS_WAVE_VIEW - tsWave.length;
    for (var i = 0; i < tsWave.length; i++) {
        var w = tsWave[i];
        var t = tsAmp(post ? w.ot : w.pt) * half;
        var q = tsAmp(post ? w.oq : w.pq) * half;
        var x = TS_PLOT.x + (off + i) * fw;
        if (t > 0.4) {
            tsRgba(TS_COL_TR, trA);
            mgraphics.rectangle(x, mid - 0.5 - t, Math.max(fw - 0.5, 1), t);
            mgraphics.fill();
        }
        if (q > 0.4) {
            tsRgba(TS_COL_TONE, toA);
            mgraphics.rectangle(x, mid + 0.5, Math.max(fw - 0.5, 1), q);
            mgraphics.fill();
        }
    }
}

function tsPaintSono() {
    var cw = TS_PLOT.w / TS_SONO_COLS;
    var rh = TS_PLOT.h / TS_SONO_ROWS;
    var off = TS_SONO_ROWS - tsSono.length;
    for (var r = 0; r < tsSono.length; r++) {
        var row = tsSono[r];
        var y = TS_PLOT.y + (off + r) * rh;
        for (var c = 0; c < TS_SONO_COLS; c++) {
            var a = tsLv(row.lv[c]);
            if (a < 0.04) continue;
            tsRgba(tsMix(TS_COL_TONE, TS_COL_TR, row.fr[c]), 0.12 + 0.88 * a);
            mgraphics.rectangle(TS_PLOT.x + c * cw, y, cw + 0.3, rh + 0.3);
            mgraphics.fill();
        }
    }
}

// ---------------------------------------------------------------- interaction
function tsEmitEdit(key, v) {
    outlet(0, key, v);
}

function onclick(x, y) {
    tsHandleDown(x, y, false);
}

function ondblclick(x, y) {
    tsHandleDown(x, y, true);
}

function tsSliderHit(s, x, y) {
    return x >= s.x - 3 && x <= s.x + s.w + 3 && y >= s.y - 4 && y <= s.y + s.h + 4;
}

function tsHandleDown(x, y, dbl) {
    var R = tsRects();
    if (tsInside(R.post, x, y)) {
        tsEmitEdit("dispost", tsVals.dispost ? 0 : 1);
        return;
    }
    if (tsInside(R.wave, x, y)) {
        tsEmitEdit("disstyle", 0);
        return;
    }
    if (tsInside(R.sono, x, y)) {
        tsEmitEdit("disstyle", 1);
        return;
    }
    var keys = [["tilt", R.tilt], ["tdecay", R.decay], ["tsmooth", R.smooth]];
    for (var i = 0; i < keys.length; i++) {
        if (tsInside(keys[i][1], x, y)) {
            if (dbl) tsEmitEdit(keys[i][0], TS_DEFAULTS[keys[i][0]]);
            else tsDrag = { kind: keys[i][0], y0: y, v0: tsVals[keys[i][0]] };
            return;
        }
    }
    if (tsSliderHit(TS_SLIDER_L, x, y)) {
        if (dbl) tsEmitEdit("bias", 0);
        else {
            tsDrag = { kind: "bias" };
            tsDragTo(x, y);
        }
        return;
    }
    if (tsSliderHit(TS_SLIDER_R, x, y)) {
        if (dbl) tsEmitEdit("blend", 50);
        else {
            tsDrag = { kind: "blend" };
            tsDragTo(x, y);
        }
    }
}

function ondrag(x, y, but) {
    if (!but) {
        tsDrag = null;
        return;
    }
    tsDragTo(x, y);
}

function tsRound2(v) {
    return Math.round(v * 100) / 100;
}

function tsDragTo(x, y) {
    if (!tsDrag) return;
    var v;
    if (tsDrag.kind === "bias") {
        v = Math.round((1 - (y - TS_SLIDER_L.y) / TS_SLIDER_L.h) * 200 - 100);
        v = Math.max(-100, Math.min(100, v));
        if (Math.abs(v) < 3) v = 0;
        if (v !== tsVals.bias) tsEmitEdit("bias", v);
    } else if (tsDrag.kind === "blend") {
        v = Math.round((1 - (y - TS_SLIDER_R.y) / TS_SLIDER_R.h) * 100);
        v = Math.max(0, Math.min(100, v));
        if (Math.abs(v - 50) < 2) v = 50;
        if (v !== tsVals.blend) tsEmitEdit("blend", v);
    } else if (tsDrag.kind === "tilt") {
        v = Math.max(-100, Math.min(100, tsRound2(tsDrag.v0 + (tsDrag.y0 - y) * 1.0)));
        if (Math.abs(v) < 1) v = 0;
        if (v !== tsVals.tilt) tsEmitEdit("tilt", v);
    } else if (tsDrag.kind === "tdecay") {
        v = Math.max(1, Math.min(125, tsRound2(tsDrag.v0 * Math.pow(2, (tsDrag.y0 - y) / 24))));
        if (v !== tsVals.tdecay) tsEmitEdit("tdecay", v);
    } else if (tsDrag.kind === "tsmooth") {
        v = Math.max(1, Math.min(64, tsRound2(tsDrag.v0 * Math.pow(2, (tsDrag.y0 - y) / 24))));
        if (v !== tsVals.tsmooth) tsEmitEdit("tsmooth", v);
    }
}

function onidle() {}
function onidleout() {}

// ---------------------------------------------------------------- preview (scripts/render_preview.py calls preview() then paint())
function preview() {
    tsInfo = { instanceId: "p", isInRack: true, chainIndex: 0, chainCount: 2, peers: 2, linked: true, autoChannel: 0 };
    // demo state = the live.* parameter defaults (Tilt 0, Decay 8, Smoothing 1.5, Bias 0, Blend 50)
    tsVals.dispost = 1;
    tsVals.disstyle = 0;
    tsSel = 1;
    tsScalars.awake = 1;
    // drum hits (sharp transients with decaying tails) over a sustained tone
    for (var i = 0; i < TS_WAVE_VIEW; i++) {
        var ph = i % 20;
        var hit = i >= 4 ? Math.exp(-ph / 1.6) * (0.55 - 0.004 * (i % 40)) : 0;
        var tone = 0.012 + 0.006 * Math.sin(i * 0.35) + (i > 30 ? 0.008 : 0);
        tsPushWave(hit, tone, hit * 0.98, tone * 0.98);
    }
    for (var c = 0; c < TS_NCOLS; c++) {
        var f = TS_FMIN * Math.pow(TS_FMAX / TS_FMIN, c / TS_NCOLS);
        var base = 0.72 - 0.22 * Math.log(f / 100) / Math.log(100) + 0.04 * Math.sin(c * 1.7);
        tsPre[c] = Math.max(0.05, base * 0.8);
        tsFrac[c] = c > 55 ? 0.6 : 0.1;
        tsTr[c] = tsPre[c] * 0.8;
        tsTone[c] = tsPre[c] * 0.8;
    }
}
