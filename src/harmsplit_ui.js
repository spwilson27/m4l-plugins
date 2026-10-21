// harmsplit_ui.js — Harmonic Split face (v8ui, one canvas) + spectral_link wiring. The build concatenates
//   harmsplit_config.js, spectral_link.js, this file  into the v8ui script. Bitwig Harmonic Split (Spectral) display:
//
// Canvas (HS_VIZ_W x HS_VIZ_H): top row `Low 80.0 Hz` / `High 1.50 kHz` (Detection Low-cut / High-cut), bottom row
// `Tilt 0.0 dB` / `Threshold Automatic`, a log-frequency plot between them (Mid spectrum coloured by where its energy goes,
// or the three channels after the masks), harmonic markers in the A / B colours, the tracked fundamental as a white dot with
// crosshairs, and the purple interactive analysis parameters: vertical Low / High lines with L / H flags and the horizontal
// Detection Threshold line (dragged all the way down it reads Automatic). The four value fields are draggable too (vertical
// drag, double-click resets). The Low / High / Tilt / Threshold parameters live in hidden live.* objects (automatable from
// Live's parameter lists); Pattern, Sensitivity, Max Harm, Mix, Size and Output are real widgets on the device face.
//
// Messages in:  set_<key> <value> for pattern maxh sens tilt thr lowcut highcut mix size output dispost,
//               setbuffer <name>, init_link (live.thisdevice), preview helpers.
// Outlets:      0 [key value]  edits made on the canvas -> route -> the live.* object (which then drives gen as usual)
//               1 [key value]  values applied from a rack peer -> route -> `prepend set` into the live.* object + gen
//               2 outsel <0..3>  resolved output selection for the gen (0 = all channels summed)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 3;

var HS_VIZ_W = 284;
var HS_VIZ_H = 134;
var HS_COL_NH = [0.66, 0.70, 0.76];
var HS_COL_A = [1.0, 0.62, 0.25];
var HS_COL_B = [0.28, 0.84, 0.78];
var HS_COL_PURPLE = [0.72, 0.45, 1.0];     // interactive analysis parameters (Bitwig's purple)
var HS_COL_LABEL = [0.74, 0.78, 0.84];
var HS_PLOT = { x: 4, y: 18, w: 276, h: 98 };
var HS_ZONE = 6;                           // px strip below the -100 dB line: -120 dB (Automatic) .. -100 dB
var HS_DEFAULTS = { thr: -120, lowcut: 80, highcut: 1500, tilt: 0 };
var HS_RANGES = { thr: [-120, 0], lowcut: [19.4, 19900], highcut: [19.4, 19900], tilt: [-12, 12] };
var HS_FIELDS = {
    lowcut: { x: 4, y: 2, w: 76, h: 14 },
    highcut: { x: HS_VIZ_W - 86, y: 2, w: 82, h: 14 },
    tilt: { x: 4, y: 118, w: 64, h: 14 },
    thr: { x: HS_VIZ_W - 112, y: 118, w: 108, h: 14 }
};

// pattern = control index (0..23 = Harmonics Pattern 1..24); maxh 0 = Off; thr -120 = Automatic
var hsVals = { pattern: 1, maxh: 0, sens: 50, tilt: 0, thr: -120, lowcut: 80, highcut: 1500, mix: 100, size: 1, output: 0, dispost: 0 };
var hsPre = [];
var hsNh = [];
var hsA = [];
var hsB = [];
var hsScalars = { frame: 0, awake: 0, sr: 48000, n: 2048, level: 0, f0: 0, conf: 0, voiced: 0, lvl: -100, nact: 0, threff: -120 };
var hsBufName = "";
var hsBuf = null;
var hsTask = null;
var hsLastFrame = -1;
var hsDrag = null;
var hsLink = null;
var hsInfo = { instanceId: "", isInRack: false, chainIndex: 0, chainCount: 0, peers: 1, linked: false, autoChannel: -1 };
var hsSel = 0;
var hsLastSel = -1;

(function initArrays() {
    for (var i = 0; i < HS_NCOLS; i++) {
        hsPre.push(0);
        hsNh.push(0);
        hsA.push(0);
        hsB.push(0);
    }
})();

// ---------------------------------------------------------------- state in
function hsSetVal(key, v) {
    hsVals[key] = v;
    if (key === "output") hsEmitSel();
    if (hsLink && HS_LINKED_KEYS.indexOf(key) >= 0) hsLink.notify(key, v);
    mgraphics.redraw();
}

function set_pattern(v) { hsSetVal("pattern", Number(v)); }
function set_maxh(v) { hsSetVal("maxh", Number(v)); }
function set_sens(v) { hsSetVal("sens", Number(v)); }
function set_tilt(v) { hsSetVal("tilt", Number(v)); }
function set_thr(v) { hsSetVal("thr", Number(v)); }
function set_lowcut(v) { hsSetVal("lowcut", Number(v)); }
function set_highcut(v) { hsSetVal("highcut", Number(v)); }
function set_mix(v) { hsSetVal("mix", Number(v)); }
function set_size(v) { hsSetVal("size", Number(v)); }
function set_output(v) { hsSetVal("output", Number(v)); }
function set_dispost(v) { hsSetVal("dispost", Number(v) ? 1 : 0); }

function hsEmitSel() {
    hsSel = hsResolveSel(hsVals.output, hsInfo.autoChannel);
    if (hsSel !== hsLastSel) {
        hsLastSel = hsSel;
        outlet(2, "outsel", hsSel);
    }
}

// ---------------------------------------------------------------- link
function init_link() {
    if (hsLink) return;
    if (typeof LiveAPI === "undefined" || typeof Global === "undefined") return;
    hsLink = splCreateLink({
        kind: "harmsplit",
        keys: HS_LINKED_KEYS,
        channelCount: 3,
        getLocal: function (key) { return hsVals[key]; },
        apply: function (key, value) {
            hsVals[key] = value;
            outlet(1, key, value);
            mgraphics.redraw();
        },
        onInfo: function (info) {
            hsInfo = info;
            hsEmitSel();
            mgraphics.redraw();
        }
    });
    hsLink.init();
    hsStartPolling();
}

function setbuffer(name) {
    splNoteScope(name);
    hsBufName = name ? String(name) : "";
    hsBuf = null;
    hsStartPolling();
}

function hsStartPolling() {
    if (hsTask || typeof Task === "undefined") return;
    hsTask = new Task(hsPoll, this);
    hsTask.interval = 66;
    hsTask.repeat();
}

function hsPoll() {
    if (!hsBufName) return;
    try {
        if (!hsBuf) hsBuf = new Buffer(hsBufName);
        var d = hsBuf.peek(1, 0, HS_SCOPE_SAMPS);
        if (!d || d.length < HS_SC_FRAME + 13) return;
        var frame = d[HS_SC_FRAME];
        var aw = d[HS_SC_AWAKE];
        if (frame === hsLastFrame && aw === hsScalars.awake) return;
        hsLastFrame = frame;
        for (var c = 0; c < HS_NCOLS; c++) {
            hsPre[c] = d[HS_SC_PRE + c];
            hsNh[c] = d[HS_SC_NH + c];
            hsA[c] = d[HS_SC_A + c];
            hsB[c] = d[HS_SC_B + c];
        }
        hsScalars.frame = frame;
        hsScalars.awake = aw;
        hsScalars.sr = d[HS_SC_SR];
        hsScalars.n = d[HS_SC_N];
        hsScalars.level = d[HS_SC_LEVEL];
        hsScalars.f0 = d[HS_SC_F0];
        hsScalars.conf = d[HS_SC_CONF];
        hsScalars.voiced = d[HS_SC_VOICED];
        hsScalars.lvl = d[HS_SC_LVL];
        hsScalars.nact = d[HS_SC_NACT];
        hsScalars.threff = d[HS_SC_THREFF];
        mgraphics.redraw();
    } catch (err) {
        hsBuf = null;
    }
}

// ---------------------------------------------------------------- drawing helpers
function hsRgba(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a);
}

function hsMix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hsText(str, x, y, size, col, a, align) {
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(size);
    var xx = x;
    if (align === 1 || align === 2) {
        var w = mgraphics.text_measure(str)[0];
        xx = align === 1 ? x - w * 0.5 : x - w;
    }
    hsRgba(col, a);
    mgraphics.move_to(xx, y);
    mgraphics.show_text(str);
}

function hsRRect(x, y, w, h, r) {
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
}

// ---------------------------------------------------------------- drawing helpers
function hsRgba(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a);
}

function hsText(str, x, y, size, col, a, align) {
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(size);
    var xx = x;
    if (align === 1 || align === 2) {
        var w = mgraphics.text_measure(str)[0];
        xx = align === 1 ? x - w * 0.5 : x - w;
    }
    hsRgba(col, a);
    mgraphics.move_to(xx, y);
    mgraphics.show_text(str);
}

function hsTextW(str, size) {
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(size);
    return mgraphics.text_measure(str)[0];
}

function hsRRect(x, y, w, h, r) {
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
}

function hsBase() {
    return HS_PLOT.y + HS_PLOT.h;
}

// dB -> y: -100..0 dB over the plot (spectra grow from the -100 dB line), -120..-100 dB in the strip below it
function hsYOfDb(db) {
    var base = hsBase();
    if (db < -100) return base - 1 - (Math.max(db, -120) + 120) / 20 * (HS_ZONE - 1);
    var t = Math.min(db, 0) + 100;
    return base - HS_ZONE - t / 100 * (HS_PLOT.h - HS_ZONE - 6);
}

function hsDbOfY(y) {
    var base = hsBase();
    var yb = base - HS_ZONE;
    if (y >= yb) return -120 + (base - 1 - y) / (HS_ZONE - 1) * 20;
    return -100 + (yb - y) / (HS_PLOT.h - HS_ZONE - 6) * 100;
}

// telemetry level 0..1 (-100..0 dB) -> height in px above the -100 dB line
function hsLvH(v) {
    var t = v < 0 ? 0 : (v > 1 ? 1 : v);
    return t * (HS_PLOT.h - HS_ZONE - 6);
}

function hsLin(v) {
    return Math.pow(10, (v * 100 - 100) / 20);
}

function hsColX(c) {
    return HS_PLOT.x + (c + 0.5) * HS_PLOT.w / HS_NCOLS;
}

function hsFreqX(f) {
    var t = Math.log(f / HS_FMIN) / Math.log(HS_FMAX / HS_FMIN);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return HS_PLOT.x + t * HS_PLOT.w;
}

function hsXFreq(x) {
    var t = (x - HS_PLOT.x) / HS_PLOT.w;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return HS_FMIN * Math.pow(HS_FMAX / HS_FMIN, t);
}

function hsArea(arr, col, a, lineA) {
    var yb = hsBase() - HS_ZONE;
    mgraphics.move_to(HS_PLOT.x, yb);
    for (var c = 0; c < HS_NCOLS; c++) mgraphics.line_to(hsColX(c), yb - hsLvH(arr[c]));
    mgraphics.line_to(HS_PLOT.x + HS_PLOT.w, yb);
    mgraphics.close_path();
    hsRgba(col, a);
    mgraphics.fill();
    mgraphics.set_line_width(1.0);
    mgraphics.move_to(hsColX(0), yb - hsLvH(arr[0]));
    for (var k = 1; k < HS_NCOLS; k++) mgraphics.line_to(hsColX(k), yb - hsLvH(arr[k]));
    hsRgba(col, lineA);
    mgraphics.stroke();
}

function hsToggleRect() {
    return { x: 74, y: 119, w: 40, h: 13 };
}

function hsInside(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function hsPatternNumber() {
    return Math.round(hsVals.pattern) + 1;
}

function hsMaxHarm() {
    return hsVals.maxh < 0.5 ? HS_MAXH : Math.round(hsVals.maxh);
}

// "Low  80.0 Hz": dim label then the purple value; align 0 = starts at x, 2 = ends at x
function hsLabelValue(x, y, label, value, align, active) {
    var wl = hsTextW(label, 8);
    var wv = hsTextW(value, 8);
    var x0 = align === 2 ? x - (wl + 6 + wv) : x;
    hsText(label, x0, y, 8, HS_COL_LABEL, 0.95, 0);
    hsText(value, x0 + wl + 6, y, 8, HS_COL_PURPLE, active ? 1 : 0.92, 0);
}

// ---------------------------------------------------------------- paint
function paint() {
    var W = HS_VIZ_W;
    var H = HS_VIZ_H;
    mgraphics.set_source_rgba(0.045, 0.06, 0.08, 1);
    hsRRect(0, 0, W, H, 5);
    mgraphics.fill();
    var drag = hsDrag ? hsDrag.kind : "";

    // top row: detection cut frequencies; bottom row: tilt and detection threshold
    hsLabelValue(4, 12.5, "Low", hsFmtFreq(hsVals.lowcut), 0, drag === "lowcut");
    hsLabelValue(W - 4, 12.5, "High", hsFmtFreq(hsVals.highcut), 2, drag === "highcut");
    hsLabelValue(4, 128.5, "Tilt", hsVals.tilt.toFixed(1) + " dB", 0, drag === "tilt");
    hsLabelValue(W - 4, 128.5, "Threshold", hsFmtThr(hsVals.thr), 2, drag === "thr");

    // resolved channel pill (top middle)
    var selName = hsSelName(hsSel);
    var pillCol = hsSel === 1 ? HS_COL_NH : (hsSel === 2 ? HS_COL_A : (hsSel === 3 ? HS_COL_B : [0.86, 0.9, 0.94]));
    var pillText = hsSel === 0 ? "OUT ALL" : "OUT " + hsSel + " " + selName.toUpperCase();
    var pw = hsTextW(pillText, 7.0) + 18;
    var px = 86 + (104 - pw) * 0.5;
    hsRgba(pillCol, 0.22);
    hsRRect(px, 3, pw, 12, 6);
    mgraphics.fill();
    hsRgba(pillCol, 0.9);
    mgraphics.set_line_width(1);
    hsRRect(px, 3, pw, 12, 6);
    mgraphics.stroke();
    hsText(pillText, px + 6, 11.8, 7.0, pillCol, 1, 0);

    // bottom middle: PRE / POST and the chain chip
    var t = hsToggleRect();
    hsRgba([0.16, 0.2, 0.26], 1);
    hsRRect(t.x, t.y, t.w, t.h, 3);
    mgraphics.fill();
    hsText(hsVals.dispost ? "POST" : "PRE", t.x + t.w * 0.5, t.y + 9.6, 7.5, [0.92, 0.96, 1.0], 1, 1);
    var chip = hsInfo.isInRack ? ("CH " + (hsInfo.chainIndex + 1) + "/" + Math.max(hsInfo.chainCount, 1)
        + (hsInfo.linked ? " LINKED" : "")) : "NO RACK";
    hsText(chip, t.x + t.w + 6, 128.4, 6.5, [0.55, 0.64, 0.74], 1, 0);

    // plot background, -100 dB line and frequency grid
    mgraphics.set_source_rgba(0.075, 0.095, 0.12, 1);
    hsRRect(HS_PLOT.x, HS_PLOT.y, HS_PLOT.w, HS_PLOT.h, 3);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.03, 0.04, 0.05, 0.6);
    mgraphics.rectangle(HS_PLOT.x, hsBase() - HS_ZONE, HS_PLOT.w, HS_ZONE);
    mgraphics.fill();
    var freqs = [100, 1000, 10000];
    var labels = ["100", "1k", "10k"];
    for (var g = 0; g < freqs.length; g++) {
        var gx = hsFreqX(freqs[g]);
        mgraphics.set_source_rgba(0.5, 0.6, 0.7, 0.16);
        mgraphics.rectangle(gx, HS_PLOT.y, 1, HS_PLOT.h - HS_ZONE);
        mgraphics.fill();
        hsText(labels[g], gx + 2, hsBase() - HS_ZONE - 2, 6.5, [0.5, 0.6, 0.7], 0.8, 0);
    }

    if (hsVals.dispost) hsPaintPost();
    else hsPaintPre();

    hsPaintHarmonics();
    hsPaintAnalysis();
    if (hsScalars.awake < 0.5) hsText("no signal", HS_PLOT.x + HS_PLOT.w * 0.5, HS_PLOT.y + 34, 8, [0.5, 0.6, 0.7], 0.8, 1);
}

function hsPaintPre() {
    var yb = hsBase() - HS_ZONE;
    var cw = HS_PLOT.w / HS_NCOLS;
    for (var c = 0; c < HS_NCOLS; c++) {
        var h = hsLvH(hsPre[c]);
        if (h < 0.5) continue;
        var wn = hsLin(hsNh[c]);
        var wa = hsLin(hsA[c]);
        var wb = hsLin(hsB[c]);
        var s = wn + wa + wb + 1e-12;
        var col = [
            (HS_COL_NH[0] * wn + HS_COL_A[0] * wa + HS_COL_B[0] * wb) / s,
            (HS_COL_NH[1] * wn + HS_COL_A[1] * wa + HS_COL_B[1] * wb) / s,
            (HS_COL_NH[2] * wn + HS_COL_A[2] * wa + HS_COL_B[2] * wb) / s
        ];
        hsRgba(col, 0.85);
        mgraphics.rectangle(HS_PLOT.x + c * cw, yb - h, Math.max(cw - 0.4, 1), h);
        mgraphics.fill();
    }
}

function hsPaintPost() {
    var aN = hsSel === 1 || hsSel === 0 ? 0.55 : 0.2;
    var aA = hsSel === 2 || hsSel === 0 ? 0.55 : 0.2;
    var aB = hsSel === 3 || hsSel === 0 ? 0.55 : 0.2;
    hsArea(hsNh, HS_COL_NH, aN, aN > 0.3 ? 0.95 : 0.5);
    hsArea(hsB, HS_COL_B, aB, aB > 0.3 ? 0.95 : 0.5);
    hsArea(hsA, HS_COL_A, aA, aA > 0.3 ? 0.95 : 0.5);
}

// Purple analysis parameters: Low / High lines with L / H flags and the Detection Threshold line.
function hsPaintAnalysis() {
    var top = HS_PLOT.y;
    // outside the detection band (fundamental search range) the plot is dimmed; an empty band (Low >= High) dims all of it
    var dimH = HS_PLOT.h - HS_ZONE - 10;
    var xlo = hsFreqX(hsVals.lowcut), xhi = hsFreqX(hsVals.highcut);
    var px0 = HS_PLOT.x, px1 = HS_PLOT.x + HS_PLOT.w;
    mgraphics.set_source_rgba(0.04, 0.05, 0.08, 0.72);
    if (hsVals.lowcut >= hsVals.highcut) {
        mgraphics.rectangle(px0, top + 10, px1 - px0, dimH);
        mgraphics.fill();
    } else {
        if (xlo > px0) { mgraphics.rectangle(px0, top + 10, xlo - px0, dimH); mgraphics.fill(); }
        if (xhi < px1) { mgraphics.rectangle(xhi, top + 10, px1 - xhi, dimH); mgraphics.fill(); }
    }
    var edges = [{ x: hsFreqX(hsVals.lowcut), k: "lowcut", t: "L" }, { x: hsFreqX(hsVals.highcut), k: "highcut", t: "H" }];
    for (var i = 0; i < 2; i++) {
        var e = edges[i];
        var on = hsDrag && hsDrag.kind === e.k;
        hsRgba(HS_COL_PURPLE, on ? 1 : 0.8);
        mgraphics.rectangle(e.x - 0.5, top + 10, 1, HS_PLOT.h - 10 - 1);
        mgraphics.fill();
        hsRgba(HS_COL_PURPLE, 1);
        hsRRect(e.x - 5, top + 1, 10, 10, 2);
        mgraphics.fill();
        hsText(e.t, e.x, top + 9.2, 7, [0.1, 0.05, 0.16], 1, 1);
    }
    // Detection Threshold: solid line (Automatic sits on the bottom axis), faint dashed effective level while Automatic
    var auto = hsVals.thr <= HS_THR_MIN + 0.5;
    var y = hsYOfDb(hsVals.thr);
    var x0 = HS_PLOT.x + 2;
    var x1 = HS_PLOT.x + HS_PLOT.w - 2;
    var onT = hsDrag && hsDrag.kind === "thr";
    if (auto && hsScalars.awake > 0.5 && hsScalars.threff > -119) {
        var ye = hsYOfDb(hsScalars.threff);
        hsRgba(HS_COL_PURPLE, 0.35);
        for (var xd = x0; xd < x1 - 6; xd += 6) {
            mgraphics.rectangle(xd, ye - 0.5, 3, 1);
            mgraphics.fill();
        }
    }
    hsRgba(HS_COL_PURPLE, onT ? 1 : 0.85);
    mgraphics.rectangle(x0, y - 0.5, x1 - x0, 1);
    mgraphics.fill();
}

// Harmonic markers (A orange, B turquoise by the Pattern rule) and the fundamental (white dot with crosshairs).
function hsPaintHarmonics() {
    var f0 = hsScalars.f0;
    if (!(f0 > 0)) return;
    // the fundamental is only searched inside the detection band (half an octave of soft edge)
    if (!(hsVals.lowcut < hsVals.highcut) || f0 < hsVals.lowcut * 0.7071 || f0 > hsVals.highcut * 1.4142) return;
    var top = HS_PLOT.y;
    var yb = hsBase() - HS_ZONE;
    var va = 0.35 + 0.65 * hsScalars.voiced;
    var maxh = Math.min(hsMaxHarm(), 404);
    var pat = hsPatternNumber();
    for (var h = 1; h <= maxh; h++) {
        var f = h * f0;
        if (f > HS_FMAX * 0.99) break;
        if (f < HS_FMIN) continue;
        var x = hsFreqX(f);
        if (hsFreqX(f + f0) - x < 3) break;      // markers merge into a smear: stop where they get denser than 3 px
        var col = hsIsA(h, pat) > 0.5 ? HS_COL_A : HS_COL_B;
        mgraphics.set_source_rgba(col[0], col[1], col[2], 0.8 * va);
        mgraphics.rectangle(x - 0.5, top + 13, 1, 6);
        mgraphics.fill();
        mgraphics.set_source_rgba(col[0], col[1], col[2], 0.2 * va);
        mgraphics.rectangle(x - 0.5, top + 19, 1, yb - top - 19);
        mgraphics.fill();
    }
    // fundamental: dot on the pre spectrum, crosshairs through it
    var cx = hsFreqX(f0);
    var cidx = Math.round(Math.log(f0 / HS_FMIN) / Math.log(HS_FMAX / HS_FMIN) * HS_NCOLS - 0.5);
    cidx = cidx < 0 ? 0 : (cidx > HS_NCOLS - 1 ? HS_NCOLS - 1 : cidx);
    var cy = yb - hsLvH(hsPre[cidx]);
    cy = Math.max(top + 14, Math.min(yb - 2, cy));
    mgraphics.set_source_rgba(1, 1, 1, 0.5);
    mgraphics.rectangle(cx - 0.5, top, 1, HS_PLOT.h - HS_ZONE);
    mgraphics.fill();
    mgraphics.rectangle(HS_PLOT.x, cy - 0.5, HS_PLOT.w, 1);
    mgraphics.fill();
    mgraphics.set_source_rgba(1, 1, 1, 1);
    mgraphics.arc(cx, cy, 3.4, 0, Math.PI * 2);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.05, 0.07, 0.1, 1);
    mgraphics.arc(cx, cy, 1.4, 0, Math.PI * 2);
    mgraphics.fill();
    var ft = hsFmtFreq(f0);
    var tx = cx + 6;
    var al = 0;
    if (tx + hsTextW(ft, 6.5) > HS_PLOT.x + HS_PLOT.w - 2) {
        tx = cx - 6;
        al = 2;
    }
    hsText(ft, tx, Math.max(top + 24, cy - 4), 6.5, [1, 1, 1], 0.9, al);
}

// ---------------------------------------------------------------- interaction
function hsEmitEdit(key, v) {
    outlet(0, key, v);
}

function onclick(x, y) {
    hsHandleDown(x, y, false);
}

function ondblclick(x, y) {
    hsHandleDown(x, y, true);
}

function hsClampKey(key, v) {
    var r = HS_RANGES[key];
    v = Math.max(r[0], Math.min(r[1], v));
    if (key === "lowcut") v = Math.min(v, hsVals.highcut);
    if (key === "highcut") v = Math.max(v, hsVals.lowcut);
    return v;
}

function hsRound(key, v) {
    if (key === "thr") return v <= HS_THR_MIN + 0.4 ? HS_THR_MIN : Math.round(v * 10) / 10;
    if (key === "tilt") return Math.round(v * 10) / 10;
    return Math.round(v * 10) / 10;
}

function hsHandleDown(x, y, dbl) {
    hsDrag = null;
    var t = hsToggleRect();
    if (hsInside(t, x, y)) {
        hsEmitEdit("dispost", hsVals.dispost ? 0 : 1);
        return;
    }
    // value fields (vertical drag, double-click resets)
    for (var key in HS_FIELDS) {
        if (hsInside(HS_FIELDS[key], x, y)) {
            if (dbl) {
                hsEmitEdit(key, HS_DEFAULTS[key]);
                return;
            }
            hsDrag = { kind: key, field: true, y0: y, v0: hsVals[key] };
            return;
        }
    }
    if (x < HS_PLOT.x || x > HS_PLOT.x + HS_PLOT.w || y < HS_PLOT.y || y > HS_PLOT.y + HS_PLOT.h) return;
    var ty = hsYOfDb(hsVals.thr);
    var xl = hsFreqX(hsVals.lowcut);
    var xh = hsFreqX(hsVals.highcut);
    var dT = Math.abs(y - ty);
    var dL = Math.abs(x - xl);
    var dH = Math.abs(x - xh);
    // the flags at the top belong to the vertical lines
    if (y < HS_PLOT.y + 12) {
        dT = 99;
        dL = Math.abs(x - xl) <= 6 ? 0 : dL;
        dH = Math.abs(x - xh) <= 6 ? 0 : dH;
    }
    var best = Math.min(dT, Math.min(dL, dH));
    if (best > 5) return;
    var kind = best === dL ? "lowcut" : (best === dH ? "highcut" : "thr");
    if (dbl) {
        hsEmitEdit(kind, HS_DEFAULTS[kind]);
        return;
    }
    hsDrag = { kind: kind, field: false };
    hsDragTo(x, y);
}

function ondrag(x, y, but) {
    if (!but) {
        hsDrag = null;
        mgraphics.redraw();
        return;
    }
    hsDragTo(x, y);
}

function hsDragTo(x, y) {
    if (!hsDrag) return;
    var key = hsDrag.kind;
    var v;
    if (hsDrag.field) {
        var r = HS_RANGES[key];
        var d = (hsDrag.y0 - y) / 120;
        if (key === "lowcut" || key === "highcut") v = hsDrag.v0 * Math.pow(r[1] / r[0], d);
        else v = hsDrag.v0 + d * (r[1] - r[0]);
    } else if (key === "thr") {
        v = hsDbOfY(y);
    } else {
        v = hsXFreq(x);
    }
    v = hsRound(key, hsClampKey(key, v));
    if (v !== hsVals[key]) hsEmitEdit(key, v);
}

function onidle() {}
function onidleout() {}

// ---------------------------------------------------------------- preview (scripts/render_preview.py calls preview() then paint())
function preview() {
    hsInfo = { instanceId: "p", isInRack: true, chainIndex: 1, chainCount: 3, peers: 3, linked: true, autoChannel: 1 };
    hsVals.dispost = 1;
    // demo state = the live.* parameter defaults (Low 80 Hz, High 1.5 kHz, Tilt 0, Threshold Automatic, Pattern Every 2nd, Max Harm Off, Sens 50 %)
    hsVals.sens = 50;
    hsVals.thr = -120;
    hsVals.tilt = 0;
    hsVals.lowcut = 80;
    hsVals.highcut = 1500;
    hsVals.pattern = 1;
    hsVals.maxh = 0;
    hsSel = 2;
    var f0 = 196;
    hsScalars = { frame: 5, awake: 1, sr: 48000, n: 2048, level: 0.2, f0: f0, conf: 0.66, voiced: 1, lvl: -14, nact: 40, threff: -54 };
    for (var c = 0; c < HS_NCOLS; c++) {
        var f = HS_FMIN * Math.pow(HS_FMAX / HS_FMIN, (c + 0.5) / HS_NCOLS);
        var floorLv = 0.30 - 0.12 * Math.log(f / 100) / Math.log(100);
        var h = Math.round(f / f0);
        var near = h >= 1 ? Math.abs(f - h * f0) / (f0 * 0.5) : 1;
        var peak = h >= 1 && h <= hsMaxHarm() ? Math.exp(-near * near * 14) * (0.62 - 0.16 * Math.log(h + 1) / Math.log(40)) : 0;
        var pre = Math.max(floorLv, floorLv + peak);
        var isA = h >= 1 && hsIsA(h, hsPatternNumber()) > 0.5;
        hsPre[c] = Math.min(0.97, pre);
        hsNh[c] = Math.max(0.03, floorLv - 0.03);
        hsA[c] = isA ? Math.max(0.03, hsPre[c] - 0.02) : 0.03 + peak * 0.1;
        hsB[c] = !isA && peak > 0.02 ? Math.max(0.03, hsPre[c] - 0.02) : 0.03 + peak * 0.1;
        if (peak < 0.02) {
            hsA[c] = 0.03;
            hsB[c] = 0.03;
            hsNh[c] = hsPre[c];
        }
    }
}
