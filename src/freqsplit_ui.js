// freqsplit_ui.js — Freq Split face (v8ui, one canvas) + spectral_link wiring. The build concatenates
//   freqsplit_config.js, spectral_link.js, this file  into the v8ui script.
//
// Canvas (FV_W x FV_H): a HUD (resolved channel pill, chain chip) and a log-frequency plot (20 Hz..20 kHz) with
//   - the channel regions: stacked, channel coloured mask columns (crossfades show as blends), from the same fsPattern / fsMaskAt as
//     the DSP; regions wider than 13 px carry their channel number, split lines are drawn up to 120 splits;
//   - the white XY dot: x = Bend (the centre frequency, midpoint 0.5 + 0.4 Bend), y = Pinch; drag it, double-click resets both;
//   - the orange Spectral Limiter line (drag vertically, double-click resets to 0 dB; solid while the limiter is on);
//   - dragging anywhere else in the plot slides the whole split pattern = Split Spin (wrapping), double-click resets Spin;
//   - the Mid spectrum (Pre, coloured by the channel mix of each column) or the four channels after the masks (Post).
// The Splits / Crossfade / Nudge / Spin / Bend / Pinch / Mix / Limiter values are the real live.* objects around the canvas;
// the direction arrows and the crossfade ramp glyph live in the small header v8ui (src/freqsplit_top_ui.js).
//
// Messages in:  set_<key> <value> for splits dir xfade nudge spin bend pinch limon limthr mix size output dispost,
//               setbuffer <name>, init_link (live.thisdevice), preview helpers.
// Outlets:      0 [key value]  edits made on the canvas (bend pinch limthr spin) -> route -> the live.* object (which then drives gen)
//               1 [key value]  values applied from a rack peer -> route -> `prepend set` into the live.* object + gen
//               2 outsel <0..4>  resolved output selection for the gen (0 = all channels summed)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 3;

var FV_W = 330;
var FV_H = 119;
var FV_COLS = [[1.0, 0.42, 0.38], [0.32, 0.62, 1.0], [1.0, 0.80, 0.25], [0.92, 0.42, 0.85]];
var FV_ORANGE = [1.0, 0.62, 0.20];
var FV_PLOT = { x: 4, y: 18, w: 322, h: 97 };
var FV_DB_LO = -80;          // plot level range
var FV_DB_HI = 6;
var FV_DENSE = 120;          // above this many splits the split lines are not drawn

var fvVals = { splits: 16, dir: 0, xfade: 0, nudge: 0, spin: 0, bend: 0, pinch: 0, limon: 0, limthr: 0, mix: 100, size: 2, output: 0, dispost: 0 };
var fvPat = fsPattern(fsPatternFromVals(fvVals));
var fvRegion = [];           // per display column mask [m0..m3] (cache of fsMaskAt)
var fvColRgb = [];           // per telemetry column blended channel colour
var fvSplitXs = [];
var fvSegs = [];             // [{x0, x1, ch}] regions for the channel numbers
var fvPre = [];
var fvCh = [[], [], [], []];
var fvScalars = { frame: 0, awake: 0, sr: 48000, n: 4096, level: 0 };
var fvBufName = "";
var fvBuf = null;
var fvTask = null;
var fvLastFrame = -1;
var fvDrag = null;
var fvLink = null;
var fvInfo = { instanceId: "", isInRack: false, chainIndex: 0, chainCount: 0, peers: 1, linked: false, autoChannel: -1 };
var fvSel = 0;
var fvLastSel = -1;
var FV_PATTERN_KEYS = ["splits", "dir", "xfade", "nudge", "spin", "bend", "pinch"];

(function fvInitArrays() {
    for (var i = 0; i < FS_NCOLS; i++) {
        fvPre.push(0);
        fvColRgb.push([0.6, 0.6, 0.6]);
        for (var c = 0; c < 4; c++) fvCh[c].push(0);
    }
})();

// Rebuild everything derived from the pattern (region columns, colours, split lines, labelled regions).
function fvRebuild() {
    fvPat = fsPattern(fsPatternFromVals(fvVals));
    var cols = Math.floor(FV_PLOT.w / 2);
    fvRegion = [];
    for (var i = 0; i < cols; i++) fvRegion.push(fsMaskAt(fvPat, (i + 0.5) / cols));
    for (var c = 0; c < FS_NCOLS; c++) {
        var m = fsMaskAt(fvPat, (c + 0.5) / FS_NCOLS);
        var rgb = [0, 0, 0];
        for (var ch = 0; ch < 4; ch++) for (var q = 0; q < 3; q++) rgb[q] += m[ch] * FV_COLS[ch][q];
        fvColRgb[c] = rgb;
    }
    fvSplitXs = fsSplitXs(fvPat);
    var edges = [0].concat(fvSplitXs, [1]);
    fvSegs = [];
    if (fvSplitXs.length < FV_DENSE) {
        for (var j = 0; j + 1 < edges.length; j++) {
            if ((edges[j + 1] - edges[j]) * FV_PLOT.w < 13) continue;
            fvSegs.push({ x0: edges[j], x1: edges[j + 1], ch: fsChannelAt(fvPat, (edges[j] + edges[j + 1]) * 0.5) });
        }
    }
}

// ---------------------------------------------------------------- state in
function fvSetVal(key, v) {
    fvVals[key] = v;
    if (key === "output") fvEmitSel();
    else if (FV_PATTERN_KEYS.indexOf(key) >= 0) fvRebuild();
    if (fvLink && FS_LINKED_KEYS.indexOf(key) >= 0) fvLink.notify(key, v);
    mgraphics.redraw();
}

function set_splits(v) { fvSetVal("splits", Number(v)); }
function set_dir(v) { fvSetVal("dir", Number(v)); }
function set_xfade(v) { fvSetVal("xfade", Number(v)); }
function set_nudge(v) { fvSetVal("nudge", Number(v)); }
function set_spin(v) { fvSetVal("spin", Number(v)); }
function set_bend(v) { fvSetVal("bend", Number(v)); }
function set_pinch(v) { fvSetVal("pinch", Number(v)); }
function set_limon(v) { fvSetVal("limon", Number(v) ? 1 : 0); }
function set_limthr(v) { fvSetVal("limthr", Number(v)); }
function set_mix(v) { fvSetVal("mix", Number(v)); }
function set_size(v) { fvSetVal("size", Number(v)); }
function set_output(v) { fvSetVal("output", Number(v)); }
function set_dispost(v) { fvSetVal("dispost", Number(v) ? 1 : 0); }

function fvEmitSel() {
    fvSel = fsResolveSel(fvVals.output, fvInfo.autoChannel);
    if (fvSel !== fvLastSel) {
        fvLastSel = fvSel;
        outlet(2, "outsel", fvSel);
    }
}

// ---------------------------------------------------------------- link
function init_link() {
    if (fvLink) return;
    if (typeof LiveAPI === "undefined" || typeof Global === "undefined") return;
    fvLink = splCreateLink({
        kind: "freqsplit",
        keys: FS_LINKED_KEYS,
        channelCount: 4,
        getLocal: function (key) { return fvVals[key]; },
        apply: function (key, value) {
            fvVals[key] = value;
            if (FV_PATTERN_KEYS.indexOf(key) >= 0) fvRebuild();
            outlet(1, key, value);
            mgraphics.redraw();
        },
        onInfo: function (info) {
            fvInfo = info;
            fvEmitSel();
            mgraphics.redraw();
        }
    });
    fvLink.init();
    fvStartPolling();
}

function setbuffer(name) {
    splNoteScope(name);
    fvBufName = name ? String(name) : "";
    fvBuf = null;
    fvStartPolling();
}

function fvStartPolling() {
    if (fvTask || typeof Task === "undefined") return;
    fvTask = new Task(fvPoll, this);
    fvTask.interval = 66;
    fvTask.repeat();
}

function fvPoll() {
    if (!fvBufName) return;
    try {
        if (!fvBuf) fvBuf = new Buffer(fvBufName);
        var d = fvBuf.peek(1, 0, FS_SCOPE_SAMPS);
        if (!d || d.length < FS_SC_FRAME + 6) return;
        var frame = d[FS_SC_FRAME];
        var aw = d[FS_SC_AWAKE];
        if (frame === fvLastFrame && aw === fvScalars.awake) return;
        fvLastFrame = frame;
        for (var c = 0; c < FS_NCOLS; c++) {
            fvPre[c] = d[FS_SC_PRE + c];
            for (var ch = 0; ch < 4; ch++) fvCh[ch][c] = d[FS_SC_CH + ch * FS_NCOLS + c];
        }
        fvScalars.frame = frame;
        fvScalars.awake = aw;
        fvScalars.sr = d[FS_SC_SR];
        fvScalars.n = d[FS_SC_N];
        fvScalars.level = d[FS_SC_LEVEL];
        mgraphics.redraw();
    } catch (err) {
        fvBuf = null;
    }
}

// ---------------------------------------------------------------- drawing helpers
function fvRgba(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a);
}

function fvText(str, x, y, size, col, a, align) {
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(size);
    var xx = x;
    if (align === 1 || align === 2) {
        var w = mgraphics.text_measure(str)[0];
        xx = align === 1 ? x - w * 0.5 : x - w;
    }
    fvRgba(col, a);
    mgraphics.move_to(xx, y);
    mgraphics.show_text(str);
}

function fvRRect(x, y, w, h, r) {
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
}

// telemetry level 0..1 (-100..0 dB) -> plot height fraction (-80..+6 dB)
function fvLv(v) {
    var t = (v * 100 - 100 - FV_DB_LO) / (FV_DB_HI - FV_DB_LO);
    return t < 0 ? 0 : (t > 1 ? 1 : t);
}

function fvUX(u) {
    return FV_PLOT.x + u * FV_PLOT.w;
}

function fvColX(c) {
    return FV_PLOT.x + (c + 0.5) * FV_PLOT.w / FS_NCOLS;
}

function fvLimY() {
    var frac = Math.max(0, Math.min(1, (fvVals.limthr - FV_DB_LO) / (FV_DB_HI - FV_DB_LO)));
    return FV_PLOT.y + FV_PLOT.h - frac * (FV_PLOT.h - 2);
}

function fvDot() {
    return {
        x: fvUX(fsBendMid(fvVals.bend / 100)),
        y: FV_PLOT.y + FV_PLOT.h * (0.5 - 0.42 * fvVals.pinch / 100)
    };
}

function fvArea(arr, col, a, lineA) {
    var base = FV_PLOT.y + FV_PLOT.h;
    mgraphics.move_to(FV_PLOT.x, base);
    for (var c = 0; c < FS_NCOLS; c++) mgraphics.line_to(fvColX(c), base - fvLv(arr[c]) * (FV_PLOT.h - 2));
    mgraphics.line_to(FV_PLOT.x + FV_PLOT.w, base);
    mgraphics.close_path();
    fvRgba(col, a);
    mgraphics.fill();
    mgraphics.set_line_width(1.0);
    mgraphics.move_to(fvColX(0), base - fvLv(arr[0]) * (FV_PLOT.h - 2));
    for (var k = 1; k < FS_NCOLS; k++) mgraphics.line_to(fvColX(k), base - fvLv(arr[k]) * (FV_PLOT.h - 2));
    fvRgba(col, lineA);
    mgraphics.stroke();
}

// ---------------------------------------------------------------- paint
function paint() {
    var W = FV_W;
    var H = FV_H;
    mgraphics.set_source_rgba(0.045, 0.06, 0.08, 1);
    fvRRect(0, 0, W, H, 5);
    mgraphics.fill();

    // HUD: resolved channel pill and chain chip
    var pillCol = fvSel >= 1 && fvSel <= 4 ? FV_COLS[fvSel - 1] : [0.78, 0.84, 0.9];
    var pillText = fvSel === 0 ? "OUT ALL" : "OUT " + fvSel + " " + fsSelName(fvSel).toUpperCase();
    var pw = pillText.length * 5.2 + 12;
    fvRgba(pillCol, 0.22);
    fvRRect(4, 3, pw, 13, 6);
    mgraphics.fill();
    fvRgba(pillCol, 0.9);
    mgraphics.set_line_width(1);
    fvRRect(4, 3, pw, 13, 6);
    mgraphics.stroke();
    fvText(pillText, 10, 12.6, 7.5, pillCol, 1, 0);
    var chip = fvInfo.isInRack ? ("CH " + (fvInfo.chainIndex + 1) + "/" + Math.max(fvInfo.chainCount, 1)
        + (fvInfo.linked ? " LINKED" : "")) : "NO RACK";
    fvText(chip, 4 + pw + 6, 12.6, 7.0, [0.55, 0.64, 0.74], 1, 0);
    fvText(fvVals.dispost ? "POST" : "PRE", W - 6, 12.6, 7.0, [0.55, 0.64, 0.74], 1, 2);

    // plot background
    mgraphics.set_source_rgba(0.075, 0.095, 0.12, 1);
    fvRRect(FV_PLOT.x, FV_PLOT.y, FV_PLOT.w, FV_PLOT.h, 3);
    mgraphics.fill();
    fvPaintRegions();

    var freqs = [100, 1000, 10000];
    var labels = ["100", "1k", "10k"];
    for (var g = 0; g < freqs.length; g++) {
        var gx = fvUX(fsHzToU(freqs[g]));
        mgraphics.set_source_rgba(0.5, 0.6, 0.7, 0.16);
        mgraphics.rectangle(gx, FV_PLOT.y, 1, FV_PLOT.h);
        mgraphics.fill();
        fvText(labels[g], gx + 2, FV_PLOT.y + FV_PLOT.h - 2, 6.5, [0.5, 0.6, 0.7], 0.8, 0);
    }

    if (fvVals.dispost) fvPaintPost();
    else fvPaintPre();
    if (fvScalars.awake < 0.5) fvText("no signal", FV_PLOT.x + FV_PLOT.w * 0.5, FV_PLOT.y + FV_PLOT.h * 0.5, 8, [0.5, 0.6, 0.7], 0.8, 1);

    fvPaintSplits();
    fvPaintLimiter();
    fvPaintDot();
}

// Stacked channel masks, one 2 px column at a time (the crossfades show as blends).
function fvPaintRegions() {
    var cols = fvRegion.length;
    var cw = FV_PLOT.w / cols;
    for (var i = 0; i < cols; i++) {
        var m = fvRegion[i];
        var y = FV_PLOT.y + FV_PLOT.h;
        for (var c = 0; c < 4; c++) {
            if (m[c] <= 0.001) continue;
            var h = FV_PLOT.h * m[c];
            var dim = fvSel >= 1 && fvSel <= 4 && fvSel - 1 !== c;
            fvRgba(FV_COLS[c], dim ? 0.08 : 0.24);
            mgraphics.rectangle(FV_PLOT.x + i * cw, y - h, cw + 0.4, h);
            mgraphics.fill();
            y -= h;
        }
    }
}

// Pre: the Mid spectrum, each column coloured by the channel mix it is sorted into.
function fvPaintPre() {
    var base = FV_PLOT.y + FV_PLOT.h;
    var cw = FV_PLOT.w / FS_NCOLS;
    for (var c = 0; c < FS_NCOLS; c++) {
        var h = fvLv(fvPre[c]) * (FV_PLOT.h - 2);
        if (h < 0.5) continue;
        fvRgba(fvColRgb[c], 0.85);
        mgraphics.rectangle(FV_PLOT.x + c * cw, base - h, Math.max(cw - 0.4, 1), h);
        mgraphics.fill();
    }
}

function fvPaintPost() {
    for (var c = 0; c < 4; c++) {
        var dim = fvSel >= 1 && fvSel <= 4 && fvSel - 1 !== c;
        fvArea(fvCh[c], FV_COLS[c], dim ? 0.15 : 0.5, dim ? 0.45 : 0.95);
    }
}

function fvPaintSplits() {
    var S = fvSplitXs.length;
    if (S < FV_DENSE) {
        mgraphics.set_line_width(1);
        for (var j = 0; j < S; j++) {
            var x = Math.round(fvUX(fvSplitXs[j])) + 0.5;
            mgraphics.set_source_rgba(0.95, 0.97, 1.0, 0.55);
            mgraphics.move_to(x, FV_PLOT.y);
            mgraphics.line_to(x, FV_PLOT.y + FV_PLOT.h);
            mgraphics.stroke();
        }
    }
    for (var i = 0; i < fvSegs.length; i++) {
        var sg = fvSegs[i];
        fvText(String(sg.ch + 1), fvUX((sg.x0 + sg.x1) * 0.5), FV_PLOT.y + 9, 7.5, FV_COLS[sg.ch], 1, 1);
    }
}

function fvPaintLimiter() {
    var on = fvVals.limon === 1;
    var y = fvLimY();
    var x0 = FV_PLOT.x;
    var x1 = FV_PLOT.x + FV_PLOT.w;
    // Bitwig draws the threshold line only while the limiter is active (kept visible while it is being dragged)
    if (!on && !(fvDrag && fvDrag.kind === "limiter")) return;
    if (on) {
        fvRgba(FV_ORANGE, 0.10);
        mgraphics.rectangle(x0, FV_PLOT.y, FV_PLOT.w, y - FV_PLOT.y);
        mgraphics.fill();
    }
    mgraphics.set_line_width(on ? 1.5 : 1);
    fvRgba(FV_ORANGE, on ? 0.95 : 0.35);
    mgraphics.move_to(x0, y);
    mgraphics.line_to(x1, y);
    mgraphics.stroke();
    var tag = fsFormatDb(fvVals.limthr);
    var tw = tag.length * 4.6 + 8;
    var py = Math.min(Math.max(y, FV_PLOT.y + 14), FV_PLOT.y + FV_PLOT.h - 6);
    fvRgba(FV_ORANGE, 0.95);
    fvRRect(x1 - tw - 2, py - 6, tw, 11, 3);
    mgraphics.fill();
    fvText(tag, x1 - tw * 0.5 - 2, py + 2.6, 6.5, [0.1, 0.07, 0.03], 1, 1);
}

function fvPaintDot() {
    var d = fvDot();
    var active = fvDrag && fvDrag.kind === "dot";
    mgraphics.set_source_rgba(1, 1, 1, 0.18);
    mgraphics.rectangle(Math.round(d.x), FV_PLOT.y, 1, FV_PLOT.h);
    mgraphics.fill();
    mgraphics.rectangle(FV_PLOT.x, Math.round(d.y), FV_PLOT.w, 1);
    mgraphics.fill();
    mgraphics.set_source_rgba(1, 1, 1, active ? 1 : 0.95);
    mgraphics.arc(d.x, d.y, 3.8, 0, Math.PI * 2);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.05, 0.06, 0.08, 0.9);
    mgraphics.set_line_width(1);
    mgraphics.arc(d.x, d.y, 3.8, 0, Math.PI * 2);
    mgraphics.stroke();
    if (fvVals.bend !== 0 || fvVals.pinch !== 0 || active) {
        var txt = "BEND " + (fvVals.bend > 0 ? "+" : "") + Math.round(fvVals.bend) + "%  PINCH " + (fvVals.pinch > 0 ? "+" : "") + Math.round(fvVals.pinch) + "%";
        fvText(txt, FV_PLOT.x + 4, FV_PLOT.y + FV_PLOT.h - 12, 6.5, [0.92, 0.96, 1.0], 0.8, 0);
    }
}

// ---------------------------------------------------------------- interaction
function fvEmitEdit(key, v) {
    outlet(0, key, v);
}

function onclick(x, y) {
    fvHandleDown(x, y, false);
}

function ondblclick(x, y) {
    fvHandleDown(x, y, true);
}

function fvHit(x, y) {
    if (x < FV_PLOT.x - 3 || x > FV_PLOT.x + FV_PLOT.w + 3 || y < FV_PLOT.y - 3 || y > FV_PLOT.y + FV_PLOT.h + 3) return "";
    var d = fvDot();
    if (Math.abs(x - d.x) < 8 && Math.abs(y - d.y) < 8) return "dot";
    if (Math.abs(y - fvLimY()) < 4) return "limiter";
    return "plot";
}

function fvXN(x) {
    return Math.max(0, Math.min(1, (x - FV_PLOT.x) / FV_PLOT.w));
}

function fvHandleDown(x, y, dbl) {
    var hit = fvHit(x, y);
    if (hit === "dot") {
        if (dbl) {
            fvEmitEdit("bend", 0);
            fvEmitEdit("pinch", 0);
            return;
        }
        fvDrag = { kind: "dot" };
        fvDragTo(x, y);
    } else if (hit === "limiter") {
        if (dbl) {
            fvEmitEdit("limthr", 0);
            return;
        }
        fvDrag = { kind: "limiter" };
        fvDragTo(x, y);
    } else if (hit === "plot") {
        if (dbl) {
            fvEmitEdit("spin", 0);
            return;
        }
        fvDrag = { kind: "spin", p0: fsWarpInv(fvXN(x), fvPat.bend, fvPat.pinch), spin0: fvVals.spin / 100 };
    }
}

function ondrag(x, y, but) {
    if (!but) {
        fvDrag = null;
        mgraphics.redraw();
        return;
    }
    fvDragTo(x, y);
}

function fvDragTo(x, y) {
    if (!fvDrag) return;
    var v;
    if (fvDrag.kind === "dot") {
        var m = (x - FV_PLOT.x) / FV_PLOT.w;
        var bend = Math.round((m - 0.5) / FS_BEND_RANGE * 100);
        bend = Math.max(-100, Math.min(100, bend));
        if (Math.abs(bend) < 3) bend = 0;
        var pinch = Math.round(-(y - (FV_PLOT.y + FV_PLOT.h * 0.5)) / (FV_PLOT.h * 0.42) * 100);
        pinch = Math.max(-100, Math.min(100, pinch));
        if (Math.abs(pinch) < 3) pinch = 0;
        if (bend !== fvVals.bend) fvEmitEdit("bend", bend);
        if (pinch !== fvVals.pinch) fvEmitEdit("pinch", pinch);
    } else if (fvDrag.kind === "limiter") {
        var frac = (FV_PLOT.y + FV_PLOT.h - y) / (FV_PLOT.h - 2);
        v = Math.round((FV_DB_LO + frac * (FV_DB_HI - FV_DB_LO)) * 2) / 2;
        v = Math.max(FV_DB_LO, Math.min(FV_DB_HI, v));
        if (v !== fvVals.limthr) fvEmitEdit("limthr", v);
    } else if (fvDrag.kind === "spin") {
        // the pattern slides with the mouse: the spin changes by the pattern-space distance the cursor moved, wrapping at +-50 %
        var p1 = fsWarpInv(fvXN(x), fvPat.bend, fvPat.pinch);
        var sp = fvDrag.spin0 + (p1 - fvDrag.p0);
        sp = sp - Math.floor(sp + 0.5);
        var pct = Math.round(sp * 1000) / 10;
        if (pct !== fvVals.spin) fvEmitEdit("spin", pct);
    }
}

function onidle() {}
function onidleout() {}

// ---------------------------------------------------------------- preview (scripts/render_preview.py calls preview() then paint())
function preview() {
    fvInfo = { instanceId: "p", isInRack: true, chainIndex: 1, chainCount: 4, peers: 4, linked: true, autoChannel: 1 };
    // demo state = the live.* parameter defaults (Splits 16, High, XFade 0 %, Nudge / Spin / Bend / Pinch 0, Limiter Off at 0 dB,
    // Mix 100 %, Display Pre), so the display never contradicts the controls shown next to it
    fvVals = { splits: 16, dir: 0, xfade: 0, nudge: 0, spin: 0, bend: 0, pinch: 0, limon: 0, limthr: 0, mix: 100, size: 2, output: 0, dispost: 0 };
    fvRebuild();
    fvSel = 2;
    fvScalars.awake = 1;
    for (var c = 0; c < FS_NCOLS; c++) {
        var f = FS_FMIN * Math.pow(FS_FMAX / FS_FMIN, c / FS_NCOLS);
        var base = 0.80 - 0.26 * Math.log(f / 100) / Math.log(100) + 0.04 * Math.sin(c * 1.7);
        var peak = 0.20 * Math.exp(-Math.pow((f - 220) / 40, 2)) + 0.22 * Math.exp(-Math.pow((f - 1500) / 300, 2)) + 0.12 * Math.exp(-Math.pow((f - 6000) / 900, 2));
        fvPre[c] = Math.max(0.05, base * 0.75 + peak);
        var m = fsMaskAt(fvPat, (c + 0.5) / FS_NCOLS);
        for (var ch = 0; ch < 4; ch++) {
            var lv = m[ch] < 0.003 ? 0 : fvPre[c] + Math.log(m[ch]) / Math.LN10 * 0.2;
            fvCh[ch][c] = Math.max(0, Math.min(lv, 0.76));
        }
    }
}

fvRebuild();
