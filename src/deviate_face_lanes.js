// Deviate Lanes face: the Ableton-native display. Three lanes T (transient) / B (body) / L (long) scroll the recent level history (the span is measured and labelled)
// (one column per telemetry frame, newest on the right; the span depends on the poll rate). The long lane adds a filled Ring area and the output waveform as a backdrop, the
// body lane faint spectrum bars. A hit leaves a hairline through the lanes with a tick per drawn meta; a hit Chance rejected (gate 0) gets an
// alert-coloured hairline with a cross cap. The right gutter of each lane has one gauge per meta of that lane (fill = drawn value, tick =
// the Value). Colours only through sptColor (src/spectral_theme.js is prepended by the build). The canvas only draws (ignoreclick).

var LN_COLS = 72;          // history columns (3 px each)
var LN_COL_PX = 3;
var LN_PLOT_X = 12;        // plot left edge
var LN_PLOT_W = LN_COLS * LN_COL_PX; // 216
var LN_GUT_X = 230;        // gauge gutter
var LN_GAUGE_W = 4;
var LN_GAUGE_PITCH = 5;
var LN_RIGHT_MARGIN = 4;   // free px between the last gauge (tick included) and the canvas edge
var LN_CANVAS_W = 250;
var LN_CANVAS_H = 159;
var LN_AXIS_Y = 155;       // axis label baseline: leaves descender room above the canvas bottom
var LN_Y0 = 14;            // first lane top inside the canvas
var LN_PITCH = 47;
var LN_H = 44;
var LN_LANES = [{ name: "T", metas: [0, 6] }, { name: "B", metas: [1, 2, 3] }, { name: "L", metas: [4, 5, 7] }];
var LN_FLOOR_DB = 48;

var lnLvl = [[], [], []];  // per lane level 0..1 per column
var lnRing = [];           // ring envelope x Ring meta per column
var lnHit = [];            // 0 none, 1 drew, 2 Chance-rejected
var lnDraw = [];           // per column: the 8 raw draws (dvTel.draws) at a hit (or null)
var lnTime = [];           // per column: capture time in ms
var lnFlash = 0;
var lnLive = 0;            // frames left before the display counts as settled
var lnWave = null;         // 36 decimated output-waveform values 0..1
var PAINT_REGIONS = [[0, 0, LN_CANVAS_W, LN_CANVAS_H]];

function lnReset() {
    var i, c;
    for (i = 0; i < 3; i++) { lnLvl[i] = []; for (c = 0; c < LN_COLS; c++) lnLvl[i].push(0); }
    lnRing = []; lnHit = []; lnDraw = []; lnTime = [];
    for (c = 0; c < LN_COLS; c++) { lnRing.push(0); lnHit.push(0); lnDraw.push(null); lnTime.push(null); }
}
lnReset();

function lnLevel(v) {
    var x = dvNum(v);
    if (x <= 0.0005) return 0;
    return dvClamp((20 * Math.log(x) / Math.LN10 + LN_FLOOR_DB) / LN_FLOOR_DB, 0, 1);
}

function lnPush(pkT, pkB, pkL, ringV, hit, draws, ts) {
    var vals = [lnLevel(pkT), lnLevel(pkB), lnLevel(pkL)];
    for (var i = 0; i < 3; i++) { lnLvl[i].push(vals[i]); lnLvl[i].shift(); }
    lnRing.push(dvClamp(ringV, 0, 1)); lnRing.shift();
    lnHit.push(hit); lnHit.shift();
    lnDraw.push(hit === 1 ? draws.slice(0) : null); lnDraw.shift();
    lnTime.push(ts === undefined ? new Date().getTime() : ts); lnTime.shift();
}

/** Axis label for the oldest column, from the measured capture times (independent of the poll rate). */
function lnSpanLabel() {
    var a = lnTime[0], b = lnTime[LN_COLS - 1];
    if (a === null || b === null || b <= a) return "";
    return "-" + ((b - a) / 1000).toFixed(1) + " s";
}

/** 36 values 0..1: peak |output| of the waveform ring over the history, decimated. */
function lnWaveProfile() {
    var w = dvTel.wave;
    if (!w || w.length < DV_SCOPE.WAVE + DV_WAVE_BLOCKS * DV_WAVE_STRIDE) return null;
    var out = [], nb = 225, per = nb / 36, head = dvTel.waveHead, i, j, m, idx, a, b2;
    for (i = 0; i < 36; i++) {
        m = 0;
        for (j = 0; j < per; j++) {
            idx = ((head - 1 - Math.floor((35 - i) * per + (per - 1 - j))) % DV_WAVE_BLOCKS + DV_WAVE_BLOCKS) % DV_WAVE_BLOCKS;
            a = Math.abs(dvNum(w[DV_SCOPE.WAVE + idx * DV_WAVE_STRIDE + 2]));
            b2 = Math.abs(dvNum(w[DV_SCOPE.WAVE + idx * DV_WAVE_STRIDE + 3]));
            m = Math.max(m, a, b2);
        }
        out.push(dvClamp(m, 0, 1));
    }
    return out;
}

dvNeed({ wave: true, spec: true });
dvPoll(30);
sptThemeWatch(function () {});

function onFrame(t) {
    var hit = 0;
    if (t.hitNew) hit = t.gate ? 1 : 2;
    lnPush(t.pk.t, t.pk.b, t.pk.l, t.ringEnv * (0.25 + 0.75 * t.ring), hit, t.draws);
    lnWave = lnWaveProfile();
    lnFlash = t.hitNew ? 1 : lnFlash * 0.8;
    if (lnFlash < 0.03) lnFlash = 0;
    var quiet = t.pk.t < 0.003 && t.pk.b < 0.003 && t.pk.l < 0.003 && t.ringEnv < 0.003 && !hit;
    lnLive = quiet ? lnLive - 1 : LN_COLS;
    return lnLive > 0 || lnFlash > 0 || dvAnimating();
}

function preview() {
    var st = dvPreviewBase();
    var kind = st.kind, ageMs = dvTel.ageMs, rng = dvRng(5), c, i, newest = LN_COLS - 1;
    lnReset();
    var hitCols = [];
    if (kind !== "idle") {
        var back = ageMs >= 0 ? Math.round(ageMs / 33) : 0;
        hitCols = [[newest - back, kind === "extreme" ? 2 : 1]];
        if (kind !== "extreme") hitCols.push([newest - back - 24, 1], [newest - back - 46, 2]);
    }
    var tr = dvTel.trS;
    for (c = 0; c < LN_COLS; c++) {
        var t = 0.01 + 0.004 * rng(), b = 0.01 + 0.004 * rng(), l = 0.005 + 0.002 * rng(), ring = 0;
        for (i = 0; i < hitCols.length; i++) {
            var dt = (c - hitCols[i][0]) * 0.033;
            if (dt < 0) continue;
            var a = hitCols[i][1] === 2 ? 0.3 : 0.85;
            t += a * Math.exp(-dt / 0.045); b += 0.8 * a * Math.exp(-dt / 0.28);
            l += 0.55 * a * Math.exp(-dt / (0.25 + tr));
            ring = Math.max(ring, dvRingEnv(dt, tr) * (0.25 + 0.75 * dvTel.ring));
        }
        if (kind === "extreme") { t = b = l = 1; ring = 1; }
        var h = 0, ds = null;
        for (i = 0; i < hitCols.length; i++) if (hitCols[i][0] === c) h = hitCols[i][1];
        if (h === 1) ds = dvTel.metas.map(function (v, k) { return dvClamp(v + (c % 7) * 3 * (k % 2 ? 1 : -1), 0, 100); });
        lnPush(t, b, l, ring, h, ds || dvTel.draws, (c - newest) * 33);
    }
    lnPush(dvTel.pk.t, dvTel.pk.b, dvTel.pk.l, dvTel.ringEnv * (0.25 + 0.75 * dvTel.ring), hitCols.length && hitCols[0][0] === newest ? hitCols[0][1] : 0, dvTel.draws, 0);
    lnFlash = dvTel.hitNew ? 1 : 0;
    lnWave = lnWaveProfile();
}

// ---- drawing -----------------------------------------------------------------------------------------------------------------
function lnLaneColor(r) {
    return r === 0 ? sptColor("live_display_line_one") : r === 1 ? sptColor("live_display_line_two") : sptColor("live_display_scale_text");
}

function lnColX(c) { return LN_PLOT_X + c * LN_COL_PX; }

function lnPoints(arr, bottom, hgt) {
    var pts = [], i, m;
    for (i = 0; i < LN_COLS / 2; i++) {
        m = Math.max(arr[2 * i], arr[2 * i + 1]);
        pts.push([LN_PLOT_X + i * 6 + 3, bottom - m * hgt]);
    }
    return pts;
}

function lnFillArea(pts, bottom, col, a) {
    sptRgba(col, a);
    mgraphics.move_to(pts[0][0], bottom);
    for (var i = 0; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.line_to(pts[pts.length - 1][0], bottom);
    mgraphics.close_path();
    mgraphics.fill();
}

function lnPaintLane(r) {
    var y = LN_Y0 + r * LN_PITCH, bottom = y + LN_H - 3, hgt = LN_H - 7, col = lnLaneColor(r), i, j;
    sptLcd(0, y, 250, LN_H, { xs: [lnColX(24), lnColX(48)] });
    if (lnFlash > 0) {
        sptRgba(sptColor("live_control_selection"), 0.16 * lnFlash);
        mgraphics.rectangle(1, y + 1, 248, LN_H - 2);
        mgraphics.fill();
    }
    if (r === 1 && dvTel.spec && dvTel.spec.length >= 32) {
        sptRgba(sptColor("live_display_line_two"), 0.2);
        for (i = 0; i < 32; i++) {
            var sh = dvClamp((dvNum(dvTel.spec[i], -100) + 90) / 90, 0, 1) * (hgt - 4);
            mgraphics.rectangle(LN_PLOT_X + i * 6.75 + 0.5, bottom - sh, 5.75, Math.max(0.5, sh));
        }
        mgraphics.fill();
    }
    if (r === 2) {
        var mid = y + LN_H / 2;
        if (lnWave) {
            var up = [], dn = [];
            for (i = 0; i < 36; i++) {
                up.push([LN_PLOT_X + i * 6 + 3, mid - lnWave[i] * (hgt / 2)]);
                dn.push([LN_PLOT_X + i * 6 + 3, mid + lnWave[i] * (hgt / 2)]);
            }
            sptRgba(sptColor("live_lcd_title"), 0.16);
            mgraphics.move_to(up[0][0], up[0][1]);
            for (i = 1; i < 36; i++) mgraphics.line_to(up[i][0], up[i][1]);
            for (i = 35; i >= 0; i--) mgraphics.line_to(dn[i][0], dn[i][1]);
            mgraphics.close_path();
            mgraphics.fill();
        }
        var rp = lnPoints(lnRing, bottom, hgt);
        lnFillArea(rp, bottom, sptColor("live_control_selection"), 0.2);
    }
    var pts = lnPoints(lnLvl[r], bottom, hgt);
    lnFillArea(pts, bottom, col, 0.22);
    sptRgba(col, 0.95);
    mgraphics.set_line_width(1);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.stroke();
    sptText(LN_LANES[r].name, 3, y + 11, col, 8, 0);

    // hit hairlines (newest 8) with draw ticks (newest 4 drawing hits)
    var seen = 0, ticks = 0, cols = [], rej = [];
    for (j = LN_COLS - 1; j >= 0 && seen < 8; j--) {
        if (lnHit[j]) { seen++; (lnHit[j] === 1 ? cols : rej).push(j); }
    }
    if (cols.length) {
        sptRgba(sptColor("live_control_selection"), 0.9);
        for (i = 0; i < cols.length; i++) mgraphics.rectangle(lnColX(cols[i]) + 1, y + 1, 1, LN_H - 2);
        mgraphics.fill();
        sptRgba(lnLaneColor(r), 1);
        for (i = 0; i < cols.length && ticks < 4; i++, ticks++) {
            var ds = lnDraw[cols[i]];
            if (!ds) continue;
            for (j = 0; j < LN_LANES[r].metas.length; j++) {
                var ty = bottom - dvClamp(ds[LN_LANES[r].metas[j]] / 100, 0, 1) * hgt;
                mgraphics.rectangle(lnColX(cols[i]) - 2, ty - 1, 7, 2);
            }
        }
        mgraphics.fill();
    }
    if (rej.length) {
        sptRgba(sptColor("live_alert"), 0.75);
        for (i = 0; i < rej.length; i++) mgraphics.rectangle(lnColX(rej[i]) + 1, y + 1, 1, LN_H - 2);
        mgraphics.fill();
        if (r === 0) {
            mgraphics.set_line_width(1);
            for (i = 0; i < rej.length; i++) {
                var cx = lnColX(rej[i]) + 1.5;
                mgraphics.move_to(cx - 3, y + 3); mgraphics.line_to(cx + 3, y + 9);
                mgraphics.move_to(cx + 3, y + 3); mgraphics.line_to(cx - 3, y + 9);
            }
            mgraphics.stroke();
        }
    }

    // gutter gauges: drawn value (fill) against the Value (tick)
    var lane = LN_LANES[r], fillCol = dvTel.gate ? col : sptColor("live_alert");
    for (i = 0; i < lane.metas.length; i++) {
        var gx = LN_GUT_X + i * LN_GAUGE_PITCH, k = lane.metas[i], top = y + 3, gh = LN_H - 6;
        sptRgba(sptColor("live_lcd_frame"), 0.7);
        mgraphics.rectangle(gx, top, LN_GAUGE_W, gh);
        mgraphics.fill();
        var m = dvClamp(dvMetaValue(k) / 100, 0, 1) * gh;
        sptRgba(fillCol, dvTel.gate ? 0.9 : 0.5);
        mgraphics.rectangle(gx, top + gh - m, LN_GAUGE_W, Math.max(0.5, m));
        mgraphics.fill();
        var vy = top + gh - dvNorm("v_" + DV_META_KEYS[k]) * gh;
        sptRgba(sptColor("live_lcd_control_fg_alt"), 1);
        mgraphics.rectangle(gx - 1, vy - 0.5, 6, 1);
        mgraphics.fill();
    }
}

function paint() {
    var r;
    sptTitle("Lanes", 4, 10);
    var right = 246;
    if (!dvState.dsp.ready) {
        var txt = dvDspPillText();
        var pw = sptTextW(txt, SPT_SIZE_SMALL) + 10;
        sptRgba(dvState.dsp.error ? sptColor("live_alert") : sptColor("live_control_selection"), 0.95);
        mgraphics.rectangle_rounded(right - pw, 1, pw, 12, 6, 6);
        mgraphics.fill();
        sptText(txt, right - pw / 2, 10, sptColor("live_lcd_bg"), SPT_SIZE_SMALL, 1);
    } else {
        var drew = dvTel.hits > 0 || dvTel.serial > 0;
        var gateTxt = !drew ? "-" : dvTel.gate ? "Draw" : "Kept";
        sptText(gateTxt, right, 10, drew && !dvTel.gate ? sptColor("live_alert") : sptColor("live_control_selection"), SPT_SIZE_SMALL, 2);
        sptText(dvTel.split ? "Spectral" : "Envelope", right - 40, 10, sptColor("live_lcd_title"), SPT_SIZE_SMALL, 2);
    }
    for (r = 0; r < 3; r++) lnPaintLane(r);
    var ay = LN_AXIS_Y, span = lnSpanLabel();
    if (span) sptText(span, LN_PLOT_X, ay, sptColor("live_display_scale_text"), 7, 0);
    sptText("now", LN_PLOT_X + LN_PLOT_W, ay, sptColor("live_display_scale_text"), 7, 2);
}
