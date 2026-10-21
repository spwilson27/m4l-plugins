// Delay+ Filter Display: HP / LP response (12 dB/oct each) with draggable handles, like Echo's filter
// panel, over a spectrogram of the dry input and the wet delay (src/delayplus_spectrum.js, Multiband
// Split's 8192-point FFT): a fading waterfall of recent frames plus the current spectra. It shows
// with the filter on or off. The two handles can pass each other (HP above LP cuts the middle out).
// Inputs: set_<param> (incl. specdry / specwet), `names <xfer> <hdr> <scope> <spec>` from loadbang.
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 1;

var hp = 50, lp = 5000, hpres = 0, lpres = 0, filton = 1, modfilt = 0;
var drag = 0, lastX = 0, lastY = 0;
var fdPal = null;
var FMIN = 20, FMAX = 20000, DBHI = 12, DBLO = -24;
var LOGR = Math.log(FMAX / FMIN);
var filtdisp = 1;

// ---- spectrogram ------------------------------------------------------------------------------
// Two layers from buffer~ ---dpspec: wet (the delay tap after the loop filter) and dry (the input),
// each shown or hidden by the Options page (Spectrum Dry / Wet). Both: the waterfall follows the
// wet, and each gets its own current-spectrum trace (dry in the scale colour, wet in line two).
var FD_ROWS = 16; // waterfall frames kept (one per 40 ms)
var fdSpecName = "", fdSpecBuf = null, fdTask = null, fdSr = 48000;
var fdCols = 0, fdColF = [];
var fdLayers = [
    { key: "wet", on: 1, ring: 32, pk: 2, db: [], hist: [] },
    { key: "dry", on: 1, ring: 32 + DP_FFT_N, pk: 3, db: [], hist: [] },
];
var fdFrame = new Array(DP_FFT_N);
var fdLastHead = -1;

function fdSpecCols(w) {
    var n = Math.max(2, Math.floor(w));
    if (n === fdCols) return;
    fdCols = n;
    fdColF = [];
    for (var c = 0; c <= n; c++) fdColF.push(FMIN * Math.exp(LOGR * c / n));
    for (var l = 0; l < fdLayers.length; l++) {
        fdLayers[l].db = [];
        for (var k = 0; k < n; k++) fdLayers[l].db.push(DP_SPEC_DB_MIN);
        fdLayers[l].hist = [];
    }
}

/** @param {{on: number, ring: number, pk: number, db: number[], hist: number[][]}} L */
function fdLayerFrame(L, head, peak) {
    var row = new Array(fdCols);
    if (L.on && peak > 1e-4) {
        var ring = fdSpecBuf.peek(1, L.ring, DP_FFT_N);
        if (!ring || ring.length < DP_FFT_N) return;
        for (var n = 0; n < DP_FFT_N; n++) fdFrame[n] = ring[(head + n) % DP_FFT_N];
        var db = dpFftDbBins(fdFrame, fdSr);
        for (var c = 0; c < fdCols; c++) {
            var raw = dpFftPixelDb(fdColF[c], fdColF[c + 1], db, fdSr);
            var prev = L.db[c];
            L.db[c] = raw > prev ? prev * 0.25 + raw * 0.75 : prev * 0.78 + raw * 0.22;
            row[c] = L.db[c];
        }
    } else {
        for (var c2 = 0; c2 < fdCols; c2++) {
            L.db[c2] = Math.max(DP_SPEC_DB_MIN, L.db[c2] - 2.5);
            row[c2] = L.db[c2];
        }
    }
    L.hist.unshift(row);
    if (L.hist.length > FD_ROWS) L.hist.pop();
}

function fdSpecFrame() {
    if (!filtdisp) return; // only while the Filter Display is open
    if (!fdSpecBuf && fdSpecName) {
        try { fdSpecBuf = new Buffer(fdSpecName); } catch (e) { fdSpecBuf = null; }
    }
    if (!fdSpecBuf) return;
    var hdr;
    try { hdr = fdSpecBuf.peek(1, 0, 4); } catch (e2) { return; }
    if (!hdr || hdr.length < 4) return;
    var head = Math.round(Number(hdr[0]) || 0);
    if (head === fdLastHead) return; // no audio running
    fdLastHead = head;
    fdSr = Number(hdr[1]) || fdSr;
    fdSpecCols(mgraphics.size[0]);
    for (var l = 0; l < fdLayers.length; l++) fdLayerFrame(fdLayers[l], head, Number(hdr[fdLayers[l].pk]) || 0);
    mgraphics.redraw();
}

function fdSpecY(db, h) {
    return h - 2 - dpClamp((db + 56) / 54, 0, 1) * (h - 10);
}

/** @param {{hist: number[][]}} L */
function fdDrawWaterfall(mg, L, w, h, col) {
    var cw = w / fdCols, rowH = (h - 4) / FD_ROWS;
    for (var r = 0; r < L.hist.length; r++) {
        var hr = L.hist[r], fade = 1 - (r / FD_ROWS) * 0.65;
        for (var c = 0; c < fdCols; c++) {
            var it = dpClamp((hr[c] + 54) / 52, 0, 1);
            if (it <= 0.08) continue;
            var a = Math.pow(it, 1.65) * fade * 0.3;
            if (a < 0.015) continue;
            mg.set_source_rgba(col[0], col[1], col[2], a);
            mg.rectangle(c * cw, 2 + r * rowH, Math.max(1.15, cw + 0.25), rowH + 0.35);
            mg.fill();
        }
    }
}

/** @param {{db: number[]}} L */
function fdDrawTrace(mg, L, w, h, col, fillA, lineA) {
    var cw = w / fdCols;
    mg.set_source_rgba(col[0], col[1], col[2], fillA);
    mg.move_to(0, h);
    for (var i = 0; i < fdCols; i++) mg.line_to((i + 0.5) * cw, fdSpecY(L.db[i], h));
    mg.line_to(w, h);
    mg.close_path();
    mg.fill();
    mg.set_source_rgba(col[0], col[1], col[2], lineA);
    mg.set_line_width(0.85);
    for (var j = 0; j < fdCols; j++) {
        var x = (j + 0.5) * cw, y = fdSpecY(L.db[j], h);
        if (j === 0) mg.move_to(x, y);
        else mg.line_to(x, y);
    }
    mg.stroke();
}

function fdDrawSpectrogram(mg, w, h, wetCol, dryCol) {
    if (!fdCols) return;
    var wet = fdLayers[0], dry = fdLayers[1];
    var wfl = wet.on ? wet : (dry.on ? dry : null);
    if (wfl) fdDrawWaterfall(mg, wfl, w, h, wfl === wet ? wetCol : dryCol);
    if (dry.on) fdDrawTrace(mg, dry, w, h, dryCol, wet.on ? 0.08 : 0.16, 0.5);
    if (wet.on) fdDrawTrace(mg, wet, w, h, wetCol, 0.16, 0.6);
}

function fdStartTask() {
    if (fdTask) return;
    try {
        fdTask = new Task(fdSpecFrame, this);
        fdTask.interval = 40;
        fdTask.repeat();
    } catch (e) { fdTask = null; }
}

function fdClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fdFx(f, w) { return Math.log(f / FMIN) / LOGR * w; }
function fdDbY(db, h) { return (DBHI - fdClamp(db, DBLO - 6, DBHI + 6)) / (DBHI - DBLO) * h; }

function fdMag(f) {
    var kh = 1.4142 * (1 - 0.95 * hpres), kl = 1.4142 * (1 - 0.95 * lpres);
    var wh = f / hp, wl = f / lp;
    var h2 = wh * wh, l2 = wl * wl;
    var hm = h2 / Math.sqrt((1 - h2) * (1 - h2) + kh * kh * h2);
    var lm = 1 / Math.sqrt((1 - l2) * (1 - l2) + kl * kl * l2);
    return 20 * Math.log(Math.max(1e-6, hm * lm)) / Math.LN10;
}

function fdHandle(i, w, h) {
    var f = i === 0 ? hp : lp;
    return [fdFx(f, w), fdDbY(fdMag(f), h)];
}

var fdThemeTask = dpThemeWatch();

function paint() {
    var BG = dpTheme("live_lcd_bg", [0.075, 0.075, 0.075, 1]);
    var LINE = dpTheme("live_display_line_one", [0.43, 0.78, 0.94, 1]);
    var H1 = dpTheme("live_display_handle_one", [0.96, 0.64, 0.23, 1]);
    var H2 = dpTheme("live_display_handle_two", [0.96, 0.64, 0.23, 1]);
    var SCALE = dpTheme("live_display_scale_text", [0.6, 0.6, 0.6, 1]);
    var SPEC = dpTheme("live_display_line_two", [0.36, 0.78, 0.96, 1]);
    var DRY = dpTheme("live_lcd_title", [0.8, 0.8, 0.8, 1]);
    fdPal = { bg: BG, line: LINE, h1: H1, h2: H2, scale: SCALE, spec: SPEC, dry: DRY };
    var mg = mgraphics, w = mg.size[0], h = mg.size[1], i, f, x;
    var dim = !filton;
    mg.set_source_rgba(fdPal.bg[0], fdPal.bg[1], fdPal.bg[2], 1);
    mg.rectangle(0, 0, w, h);
    mg.fill();
    fdSpecCols(w);
    fdDrawSpectrogram(mg, w, h, fdPal.spec, fdPal.dry);
    // grid: decades + minor lines
    var decs = [10, 100, 1000, 10000];
    for (var d = 0; d < decs.length; d++) {
        for (var m = 1; m <= 9; m++) {
            f = decs[d] * m;
            if (f < FMIN || f > FMAX) continue;
            x = Math.round(fdFx(f, w)) + 0.5;
            mg.set_source_rgba(1, 1, 1, m === 1 ? 0.16 : 0.07);
            mg.set_line_width(1);
            mg.move_to(x, 0);
            mg.line_to(x, h);
            mg.stroke();
        }
    }
    for (var db = 0; db >= DBLO; db -= 12) {
        var gy = Math.round(fdDbY(db, h)) + 0.5;
        mg.set_source_rgba(1, 1, 1, db === 0 ? 0.12 : 0.05);
        mg.move_to(0, gy);
        mg.line_to(w, gy);
        mg.stroke();
    }
    // curve
    var pts = [], n = Math.max(2, Math.floor(w));
    for (i = 0; i <= n; i++) {
        f = FMIN * Math.exp(LOGR * i / n);
        pts.push([i / n * w, fdDbY(fdMag(f), h)]);
    }
    var cr = dim ? 0.5 : fdPal.line[0], cg = dim ? 0.5 : fdPal.line[1], cb = dim ? 0.5 : fdPal.line[2];
    mg.set_source_rgba(cr, cg, cb, 0.14);
    mg.move_to(0, h);
    for (i = 0; i < pts.length; i++) mg.line_to(pts[i][0], pts[i][1]);
    mg.line_to(w, h);
    mg.close_path();
    mg.fill();
    mg.set_source_rgba(cr, cg, cb, 1);
    mg.set_line_width(1.6);
    mg.move_to(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) mg.line_to(pts[i][0], pts[i][1]);
    mg.stroke();
    // labels
    mg.select_font_face("Arial");
    mg.set_font_size(8.5);
    mg.set_source_rgba(fdPal.scale[0], fdPal.scale[1], fdPal.scale[2], 1);
    var labF = [100, 1000, 10000], labT = ["100", "1k", "10k"];
    for (i = 0; i < labF.length; i++) {
        var tw = mg.text_measure(labT[i])[0];
        mg.move_to(Math.round(fdFx(labF[i], w) - tw / 2), h - 3);
        mg.show_text(labT[i]);
    }
    // handles
    mg.set_font_size(9);
    for (i = 0; i < 2; i++) {
        var p = fdHandle(i, w, h), px = p[0], py = fdClamp(p[1], 7, h - 7);
        var act = drag === i + 1;
        var oc = dim ? [0.5, 0.5, 0.5] : (i === 0 ? fdPal.h1 : fdPal.h2);
        mg.ellipse(px - 6.5, py - 6.5, 13, 13);
        if (act) {
            mg.set_source_rgba(oc[0], oc[1], oc[2], 1);
            mg.fill();
            mg.set_source_rgba(fdPal.bg[0], fdPal.bg[1], fdPal.bg[2], 1);
        } else {
            mg.set_source_rgba(fdPal.bg[0], fdPal.bg[1], fdPal.bg[2], 1);
            mg.fill_preserve();
            mg.set_source_rgba(oc[0], oc[1], oc[2], 1);
            mg.set_line_width(1.5);
            mg.stroke();
        }
        var t = String(i + 1), tw2 = mg.text_measure(t)[0];
        mg.move_to(px - tw2 / 2, py + 3.2);
        mg.show_text(t);
    }
}

function fdHit(x, y) {
    var w = mgraphics.size[0], h = mgraphics.size[1], best = 0, bd = 10;
    for (var i = 0; i < 2; i++) {
        var p = fdHandle(i, w, h);
        var dx = x - p[0], dy = y - fdClamp(p[1], 7, h - 7), dd = Math.sqrt(dx * dx + dy * dy);
        if (dd <= bd) { bd = dd; best = i + 1; }
    }
    return best;
}

function onclick(x, y) {
    drag = fdHit(x, y);
    lastX = x;
    lastY = y;
    mgraphics.redraw();
}

function ondblclick(x, y) {
    var i = fdHit(x, y);
    if (i === 1) { hp = 50; hpres = 0; outlet(0, "hp", hp); outlet(0, "hpres", hpres); }
    else if (i === 2) { lp = 5000; lpres = 0; outlet(0, "lp", lp); outlet(0, "lpres", lpres); }
    else return;
    drag = 0;
    mgraphics.redraw();
}

function ondrag(x, y, but, cmd, shift) {
    if (!drag) return;
    var w = mgraphics.size[0], dx = x - lastX, dy = y - lastY;
    lastX = x;
    lastY = y;
    var fine = shift ? 0.1 : 1;
    var fac = Math.exp(dx / w * LOGR * fine);
    if (drag === 1) {
        hp = fdClamp(hp * fac, FMIN, FMAX);
        hpres = fdClamp(hpres - dy / 60 * fine, 0, 1);
        outlet(0, "hp", hp);
        outlet(0, "hpres", hpres);
    } else {
        lp = fdClamp(lp * fac, FMIN, FMAX);
        lpres = fdClamp(lpres - dy / 60 * fine, 0, 1);
        outlet(0, "lp", lp);
        outlet(0, "lpres", lpres);
    }
    mgraphics.redraw();
}

function onidle() {}
function onidleout() {}

function anything() {
    var m = messagename;
    if (m === "names") {
        fdSpecName = arguments.length > 3 ? String(arguments[3]) : "";
        fdSpecBuf = null;
        fdStartTask();
        return;
    }
    if (m.indexOf("set_") !== 0) return;
    var v = Number(arguments[0]);
    var k = m.substring(4);
    if (k === "hp") hp = fdClamp(v, FMIN, FMAX);
    else if (k === "lp") lp = fdClamp(v, FMIN, FMAX);
    else if (k === "hpres") hpres = fdClamp(v, 0, 1);
    else if (k === "lpres") lpres = fdClamp(v, 0, 1);
    else if (k === "filton") filton = v ? 1 : 0;
    else if (k === "modfilt") modfilt = v;
    else if (k === "filtdisp") filtdisp = v ? 1 : 0;
    else if (k === "specwet") fdLayers[0].on = v ? 1 : 0;
    else if (k === "specdry") fdLayers[1].on = v ? 1 : 0;
    mgraphics.redraw();
}

// scripts/render_preview.py: dry = a 98 Hz sawtooth (Multiband Split's preview signal), wet = the
// same through the filter curve.
function preview() {
    hp = 120; lp = 6000; hpres = 0.2; lpres = 0.35;
    fdSpecCols(260);
    for (var n = 0; n < DP_FFT_N; n++) {
        var s = 0;
        for (var k = 1; k * 98 < 20000; k++) s += Math.sin(2 * Math.PI * k * 98 * n / 48000) / k;
        fdFrame[n] = s * 0.3;
    }
    var db = dpFftDbBins(fdFrame, 48000);
    var wet = fdLayers[0], dry = fdLayers[1];
    for (var c = 0; c < fdCols; c++) {
        dry.db[c] = dpFftPixelDb(fdColF[c], fdColF[c + 1], db, 48000);
        wet.db[c] = dry.db[c] + fdMag(Math.sqrt(fdColF[c] * fdColF[c + 1])) - 6;
    }
    for (var r = 0; r < FD_ROWS; r++) wet.hist.push(wet.db.map(function (v, i) { return v - r * 0.4 + 1.5 * Math.sin(r * 0.35 + i * 0.09); }));
}
