// Amp face "Rack": a 19-inch rack unit. Brushed silver faceplate with rack ears, a VFD window (model
// browser, segmented IN / OUT peak meters with hold, and a dot-matrix waterfall of per-layer activity)
// and a LOAD push button, all drawn here. The parameters are native live.* widgets right of this canvas.

var RK = {
    W: 372, H: 169, COLS: 35,
    vx: 20, vy: 8, vw: 342, vh: 112,
    hist: /** @type {number[][]} */ ([]),
    hi: -90, ho: -90, hiT: 0, hoT: 0,
    hover: "", press: 0, flick: 0
};
var RK_ACC = [0.34, 0.96, 0.78];

function rkRgb(r, g, b, a) { mgraphics.set_source_rgba(r, g, b, a == null ? 1 : a); }
function rkAcc(a, k) { var m = k == null ? 1 : k; rkRgb(RK_ACC[0] * m, RK_ACC[1] * m, RK_ACC[2] * m, a); }

/** @param {string} t @param {number} x @param {number} y @param {number} size @param {number} [align] */
function rkText(t, x, y, size, align) {
    mgraphics.set_font_size(size);
    var w = mgraphics.text_measure(t)[0];
    mgraphics.move_to(align === 1 ? x - w / 2 : (align === 2 ? x - w : x), y);
    mgraphics.show_text(t);
}

/** @param {string} t @param {number} maxw @param {number} size */
function rkFit(t, maxw, size) {
    mgraphics.set_font_size(size);
    if (mgraphics.text_measure(t)[0] <= maxw) return t;
    while (t.length > 1 && mgraphics.text_measure(t + "..")[0] > maxw) t = t.slice(0, -1);
    return t + "..";
}

function rkCircle(x, y, r) { mgraphics.ellipse(x - r, y - r, 2 * r, 2 * r); }
function rkIn(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

// ---- faceplate and ears -------------------------------------------------------------------------

function rkPlate() {
    rkRgb(0.17, 0.175, 0.18);
    mgraphics.rectangle(0, 0, RK.W, RK.H);
    mgraphics.fill();
    // brushed metal: fine horizontal streaks
    for (var y = 1; y < RK.H; y += 2) {
        rkRgb(1, 1, 1, ((y * 37) % 11 < 4) ? 0.045 : 0.012);
        mgraphics.rectangle(16, y, RK.W - 16, 1);
        mgraphics.fill();
    }
    rkRgb(0, 0, 0, 0.5);
    mgraphics.rectangle(RK.W - 3, 0, 1, RK.H);
    mgraphics.fill();
    rkRgb(1, 1, 1, 0.1);
    mgraphics.rectangle(RK.W - 2, 0, 1, RK.H);
    mgraphics.fill();
}

function rkEar() {
    rkRgb(0.3, 0.31, 0.33);
    mgraphics.rectangle(0, 0, 16, RK.H);
    mgraphics.fill();
    rkRgb(1, 1, 1, 0.12);
    mgraphics.rectangle(1, 0, 1, RK.H);
    mgraphics.fill();
    rkRgb(0, 0, 0, 0.45);
    mgraphics.rectangle(15, 0, 1, RK.H);
    mgraphics.fill();
    var ys = [24, 133];
    for (var i = 0; i < 2; i++) {
        var y = ys[i];
        rkRgb(0.03, 0.03, 0.035);
        mgraphics.rectangle_rounded(2, y - 2, 12, 18, 6, 6);
        mgraphics.fill();
        rkRgb(0.56, 0.57, 0.59);
        mgraphics.rectangle_rounded(4, y + 1, 8, 12, 4, 4);
        mgraphics.fill();
        rkRgb(1, 1, 1, 0.25);
        mgraphics.rectangle(5, y + 2, 4, 1);
        mgraphics.fill();
        rkRgb(0.1, 0.1, 0.11);
        mgraphics.rectangle(5, y + 6, 6, 2);
        mgraphics.fill();
    }
}

// ---- VFD ----------------------------------------------------------------------------------------

function rkModelRects() {
    var out = [], x = RK.vx + 8, y = RK.vy + 17;
    for (var i = 0; i < 4; i++) out.push({ i: i, x: x, y: y + i * 15, w: 104, h: 13 });
    return out;
}
function rkLoadRect() { return { x: 262, y: 130, w: 100, h: 28 }; }

/** @param {number} pk */
function rkDb(pk) { return 20 * Math.log(Math.max(pk, 0.00001)) / Math.LN10; }

/** One horizontal segmented bar: 24 segments over -48..0 dB with a peak-hold segment. */
function rkSegBar(x, y, label, db, hold) {
    rkAcc(0.9);
    mgraphics.select_font_face("Courier New");
    rkText(label, x, y + 7, 7, 0);
    var bx = x + 17;
    for (var i = 0; i < 24; i++) {
        var lo = -48 + i * 2, on = db >= lo, hot = i >= 21, warm = i >= 17 && i < 21;
        var r = hot ? 1.0 : (warm ? 0.95 : RK_ACC[0]), g = hot ? 0.35 : (warm ? 0.85 : RK_ACC[1]), b = hot ? 0.3 : (warm ? 0.35 : RK_ACC[2]);
        var isHold = hold > -48 && Math.floor((hold + 48) / 2) === i;
        rkRgb(r, g, b, on ? 1 : (isHold ? 0.95 : 0.09));
        mgraphics.rectangle(bx + i * 8, y, 7, 8);
        mgraphics.fill();
        if (on) {
            rkRgb(1, 1, 1, 0.22);
            mgraphics.rectangle(bx + i * 8, y, 7, 2);
            mgraphics.fill();
        }
    }
}

function rkVfd() {
    var x0 = RK.vx, y0 = RK.vy, w = RK.vw, h = RK.vh;
    // bezel and glass
    rkRgb(0.02, 0.02, 0.025);
    mgraphics.rectangle_rounded(x0 - 3, y0 - 3, w + 6, h + 6, 5, 5);
    mgraphics.fill();
    rkRgb(0.4, 0.42, 0.44, 0.6);
    mgraphics.set_line_width(1);
    mgraphics.rectangle_rounded(x0 - 2.5, y0 - 2.5, w + 5, h + 5, 5, 5);
    mgraphics.stroke();
    rkRgb(0.012, 0.035, 0.04);
    mgraphics.rectangle_rounded(x0, y0, w, h, 3, 3);
    mgraphics.fill();
    // glass tint glow in the middle
    rkAcc(0.035);
    mgraphics.rectangle(x0 + 4, y0 + 4, w - 8, h - 8);
    mgraphics.fill();
    mgraphics.select_font_face("Courier New");

    // ---- model browser
    rkAcc(0.6);
    rkText("MODEL", x0 + 8, y0 + 11, 7, 0);
    rkAcc(0.3);
    mgraphics.rectangle(x0 + 8, y0 + 14, 104, 1);
    mgraphics.fill();
    var names = ampModelNames(), sel = Math.round(ampP.model), rs = rkModelRects();
    for (var i = 0; i < rs.length; i++) {
        var r = rs[i], on = r.i === sel, hov = RK.hover === "m" + i;
        var nm = (i + 1) + " " + String(names[i]).toUpperCase();
        if (i === 3 && !amp.fileModel) nm = "4 FILE ...";
        nm = rkFit(nm, r.w - 12, 8);
        if (on) {
            rkAcc(0.92);
            mgraphics.rectangle(r.x, r.y, r.w, r.h);
            mgraphics.fill();
            rkRgb(0.01, 0.06, 0.05);
        } else {
            if (hov) { rkAcc(0.14); mgraphics.rectangle(r.x, r.y, r.w, r.h); mgraphics.fill(); }
            rkAcc(hov ? 1 : 0.75);
        }
        mgraphics.select_font_face("Courier New");
        rkText(nm, r.x + 6, r.y + 10, 8, 0);
    }
    // arch label and status
    rkAcc(0.55);
    mgraphics.rectangle(x0 + 8, y0 + 77, 104, 1);
    mgraphics.fill();
    rkAcc(0.95);
    var kind = amp.model.kind ? amp.model.kind.toUpperCase() : "NO MODEL";
    rkText(rkFit(kind, 100, 8), x0 + 8, y0 + 88, 8, 0);
    rkAcc(0.65);
    rkText(rkFit(amp.model.label || "", 100, 7), x0 + 8, y0 + 97, 7, 0);
    var st = "READY", sr = RK_ACC[0], sg = RK_ACC[1], sb = RK_ACC[2];
    if (amp.model.error) { st = amp.model.error; sr = 1; sg = 0.4; sb = 0.3; }
    else if (amp.dsp.error) { st = "DSP " + amp.dsp.error; sr = 1; sg = 0.4; sb = 0.3; }
    else if (!amp.dsp.ready) { st = "DSP LOADING"; sr = 1; sg = 0.8; sb = 0.3; }
    rkRgb(sr, sg, sb, 0.95);
    rkText(rkFit(st.toUpperCase(), 100, 7), x0 + 8, y0 + 106, 7, 0);

    // divider
    rkAcc(0.25);
    mgraphics.rectangle(x0 + 117, y0 + 8, 1, h - 16);
    mgraphics.fill();

    // ---- meters
    var gx = x0 + 122;
    rkSegBar(gx, y0 + 8, "IN", rkDb(ampTel.in_pk), RK.hi);
    rkSegBar(gx, y0 + 20, "OUT", rkDb(ampTel.out_pk), RK.ho);
    rkAcc(0.4);
    mgraphics.select_font_face("Courier New");
    rkText("-48", gx + 17, y0 + 38, 6.5, 0);
    rkText("-24", gx + 17 + 12 * 8, y0 + 38, 6.5, 1);
    rkText("0 dB", gx + 17 + 24 * 8, y0 + 38, 6.5, 2);

    // ---- activity waterfall
    rkAcc(0.6);
    rkText("LAYER ACTIVITY", gx, y0 + 52, 7, 0);
    var n0 = ampLayers().length;
    rkAcc(0.5);
    rkText(n0 ? n0 + " LAYERS" : "-", gx + 17 + 24 * 8, y0 + 52, 7, 2);
    rkWaterfall(gx, y0 + 57, 210, h - 57 - 7);
}

/** @param {number} x @param {number} y @param {number} w @param {number} h */
function rkWaterfall(x, y, w, h) {
    var n = ampLayers().length || 8;
    if (n > 24) n = 24;
    var cols = RK.COLS, pw = w / cols, ph = h / n, cw = Math.max(1, pw - 1), ch = Math.max(1, Math.min(ph - 1, 5));
    var hist = RK.hist, off = cols - hist.length;
    for (var c = 0; c < cols; c++) {
        var col = c >= off ? hist[c - off] : null;
        for (var r = 0; r < n; r++) {
            var v = 0;
            if (col && col.length) v = col[Math.min(col.length - 1, Math.floor(r * col.length / n))];
            var b = Math.max(0, Math.min(1, v));
            b = Math.pow(b, 0.7);
            var xx = x + c * pw, yy = y + r * ph + (ph - ch) / 2;
            if (b < 0.04) { rkAcc(0.07); }
            else rkRgb(RK_ACC[0] + 0.6 * b * b, RK_ACC[1], RK_ACC[2] + 0.15 * b, 0.25 + 0.75 * b);
            mgraphics.rectangle(xx, yy, cw, ch);
            mgraphics.fill();
        }
    }
    // scanline sheen over the glass
    rkRgb(1, 1, 1, 0.025);
    for (var s = 0; s < h; s += 4) { mgraphics.rectangle(x, y + s, w, 1); mgraphics.fill(); }
}

function rkGlassSheen() {
    rkRgb(1, 1, 1, 0.05);
    mgraphics.move_to(RK.vx + 2, RK.vy + 2);
    mgraphics.line_to(RK.vx + RK.vw - 2, RK.vy + 2);
    mgraphics.line_to(RK.vx + RK.vw - 2, RK.vy + 8);
    mgraphics.line_to(RK.vx + 2, RK.vy + 14);
    mgraphics.close_path();
    mgraphics.fill();
}

// ---- lower strip: badge, status LEDs, LOAD ------------------------------------------------------

function rkLed(x, y, label, lvl, hr, hg, hb) {
    rkRgb(0.02, 0.02, 0.025);
    rkCircle(x, y, 5);
    mgraphics.fill();
    rkRgb(hr * 0.25, hg * 0.25, hb * 0.25);
    rkCircle(x, y, 3.6);
    mgraphics.fill();
    if (lvl > 0.02) {
        rkRgb(hr, hg, hb, 0.18 * lvl);
        rkCircle(x, y, 6.5);
        mgraphics.fill();
        rkRgb(hr, hg, hb, 0.4 + 0.6 * lvl);
        rkCircle(x, y, 3.6);
        mgraphics.fill();
        rkRgb(1, 1, 1, 0.5 * lvl);
        rkCircle(x - 1, y - 1, 1);
        mgraphics.fill();
    }
    rkRgb(0.78, 0.8, 0.82, 0.85);
    mgraphics.select_font_face("Arial Bold");
    rkText(label, x, y + 14, 7, 1);
}

function rkStrip() {
    // badge plate
    rkRgb(0.075, 0.08, 0.085);
    mgraphics.rectangle_rounded(24, 128, 138, 32, 3, 3);
    mgraphics.fill();
    rkRgb(0.6, 0.62, 0.65, 0.5);
    mgraphics.set_line_width(1);
    mgraphics.rectangle_rounded(24.5, 128.5, 137, 31, 3, 3);
    mgraphics.stroke();
    mgraphics.select_font_face("Arial Bold");
    rkRgb(0.92, 0.94, 0.96);
    rkText("AMP RACK", 32, 145, 14, 0);
    rkAcc(0.9);
    rkText("NR-1U", 136, 143, 8, 0);
    rkRgb(0.6, 0.64, 0.66);
    rkText("NEURAL AMP MODELER", 32, 156, 7, 0);

    // status LEDs
    var sig = Math.min(1, ampTel.in_pk * 6), clip = ampTel.out_pk > 0.95 ? 1 : 0, gate = ampTel.gate < 0.9 ? 1 - ampTel.gate : 0;
    rkLed(184, 138, "SIG", sig, RK_ACC[0], RK_ACC[1], RK_ACC[2]);
    rkLed(213, 138, "CLIP", clip, 1, 0.25, 0.2);
    rkLed(242, 138, "GATE", gate, 1, 0.8, 0.25);

    // LOAD push button
    var l = rkLoadRect(), down = RK.press && (Date.now() - RK.press < 180), hov = RK.hover === "load";
    rkRgb(0.02, 0.02, 0.025);
    mgraphics.rectangle_rounded(l.x - 2, l.y - 2, l.w + 4, l.h + 4, 5, 5);
    mgraphics.fill();
    var o = down ? 1 : 0;
    rkRgb(down ? 0.3 : (hov ? 0.5 : 0.42), down ? 0.31 : (hov ? 0.52 : 0.44), down ? 0.33 : (hov ? 0.54 : 0.46));
    mgraphics.rectangle_rounded(l.x, l.y + o, l.w, l.h - 2, 4, 4);
    mgraphics.fill();
    rkRgb(1, 1, 1, down ? 0.05 : 0.22);
    mgraphics.rectangle_rounded(l.x + 2, l.y + 1 + o, l.w - 4, 6, 3, 3);
    mgraphics.fill();
    rkRgb(0, 0, 0, 0.3);
    mgraphics.rectangle(l.x + 3, l.y + l.h - 5 + o, l.w - 6, 2);
    mgraphics.fill();
    mgraphics.select_font_face("Arial Bold");
    rkRgb(0.08, 0.1, 0.1);
    rkText("LOAD .NAM", l.x + l.w / 2, l.y + 16 + o, 9, 1);
    rkAcc(down || hov ? 1 : 0.7);
    mgraphics.rectangle(l.x + 8, l.y + 20 + o, 6, 2);
    mgraphics.fill();
}

function paint() {
    rkPlate();
    rkEar();
    rkVfd();
    rkGlassSheen();
    rkStrip();
}

// ---- telemetry ----------------------------------------------------------------------------------

function ampFaceFrame() {
    var ly = ampLayers(), col = [];
    for (var i = 0; i < ly.length; i++) col.push(ly[i]);
    RK.hist.push(col);
    while (RK.hist.length > RK.COLS) RK.hist.shift();
    var di = rkDb(ampTel.in_pk), dd = rkDb(ampTel.out_pk);
    if (di >= RK.hi || RK.hiT <= 0) { RK.hi = Math.max(di, RK.hi - 1.5); if (di >= RK.hi) RK.hiT = 30; }
    else { RK.hiT--; }
    if (RK.hiT <= 0) RK.hi = Math.max(di, RK.hi - 1.5);
    if (dd >= RK.ho || RK.hoT <= 0) { RK.ho = Math.max(dd, RK.ho - 1.5); if (dd >= RK.ho) RK.hoT = 30; }
    else { RK.hoT--; }
    if (RK.hoT <= 0) RK.ho = Math.max(dd, RK.ho - 1.5);
    return true;
}
function ampFaceChanged(what) { }

// ---- interaction --------------------------------------------------------------------------------

/** @param {number} x @param {number} y */
function rkHit(x, y) {
    var rs = rkModelRects();
    for (var i = 0; i < rs.length; i++) if (rkIn(x, y, rs[i])) return "m" + i;
    if (rkIn(x, y, rkLoadRect())) return "load";
    return "";
}

function onclick(x, y) {
    var h = rkHit(x, y);
    if (!h) return;
    if (h === "load") { RK.press = Date.now(); ampBrowse(); }
    else {
        var c = Number(h.slice(1));
        if (c === 3 && !amp.fileModel) ampBrowse(); else ampSet("model", c);
    }
    mgraphics.redraw();
}

function ondrag(x, y, but) { if (!but) { RK.press = 0; mgraphics.redraw(); } }

function onidle(x, y) {
    var h = rkHit(x, y);
    if (h !== RK.hover) { RK.hover = h; mgraphics.redraw(); }
}
function onidleout() { RK.hover = ""; mgraphics.redraw(); }

function preview() {
    ampPreviewSetup(0.75);
    var ly = ampLayers();
    RK.hist = [];
    for (var c = 0; c < RK.COLS; c++) {
        var col = [];
        for (var i = 0; i < ly.length; i++) {
            var wave = Math.max(0, 0.5 + 0.9 * Math.sin(c * 0.55 + i * 0.8) * Math.cos(c * 0.21 - i * 0.3));
            col.push(c > RK.COLS - 4 ? ly[i] : Math.max(0, ly[i] * wave * (0.4 + 0.6 * c / RK.COLS) * 1.5));
        }
        RK.hist.push(col);
    }
    RK.hi = -5; RK.ho = -3;
    ampP.input = 4; ampP.bass = 6.5; ampP.mid = 4; ampP.treble = 7; ampP.presence = 6;
}
