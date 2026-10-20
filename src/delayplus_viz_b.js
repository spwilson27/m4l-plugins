// Delay+ ring display — "Tape Loop" in Echo's palette (orange echoes, white heads, blue second lane).
// The tank as a circular tape loop: circumference = delay time T. The write head sits at 12 o'clock,
// tape travels clockwise. Inner bars = signal written to tape, outer bars = echoes tapped (L cyan, R amber).
// A violet arc bridges the last Lc = L + B samples before the write head: that is the Live device chain
// (amber + MIN mark when the time is clamped to the shortest possible).

var VIZ_NAME = "Tape Loop";

function vizIdle(s) {
    return false;
}

function vizPreview(s) {
    s.pp = 0;
    s.hp = 120;
    s.lp = 6000;
}

function dpvbPol(cx, cy, r, a) {
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

function dpvbArc(mg, cx, cy, r, a0, a1) {
    // polyline arc (a0 -> a1), so partial arcs render identically everywhere
    var n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 0.08));
    for (var i = 0; i <= n; i++) {
        var p = dpvbPol(cx, cy, r, a0 + (a1 - a0) * i / n);
        if (i === 0) mg.move_to(p[0], p[1]);
        else mg.line_to(p[0], p[1]);
    }
}

function dpvbBar(mg, cx, cy, a, r0, r1) {
    var p0 = dpvbPol(cx, cy, r0, a);
    var p1 = dpvbPol(cx, cy, r1, a);
    mg.move_to(p0[0], p0[1]);
    mg.line_to(p1[0], p1[1]);
    mg.stroke();
}

var DPVB_OR = [0.96, 0.64, 0.23, 1];
var DPVB_BL = [0.43, 0.78, 0.94, 1];
var DPVB_WH = [0.96, 0.96, 0.96, 1];
var DPVB_GR = [0.26, 0.27, 0.29, 1];
var DPVB_RD = [0.95, 0.35, 0.22, 1];

function vizDraw(mg, x, y, w, h, s) {
    DPVB_OR = dpTheme("live_display_line_two", [0.96, 0.64, 0.23, 1]);
    DPVB_BL = dpTheme("live_display_line_one", [0.43, 0.78, 0.94, 1]);
    DPVB_GR = dpTheme("live_lcd_frame", [0.26, 0.27, 0.29, 1]);
    DPVB_RD = dpTheme("live_alert", [0.95, 0.35, 0.22, 1]);
    var TAU = Math.PI * 2;
    var sr = s.sr || 44100;
    var T = Math.max(s.TL || 0, s.TR || 0);
    if (!(T > 0)) T = (s.tms || 375) * sr / 1000;
    if (!(T > 0)) T = sr * 0.375;
    var Lc = (s.L || 0) + (s.B || 0);
    var frac = Math.min(Lc / T, 0.9);
    var frozen = s.freezeOn > 0.5;
    var fb = frozen ? 1 : dpClamp(s.fb, 0, 1);
    var clamped = s.clamped > 0.5;
    var small = h < 80;

    // outer extent is 58 design units; fit it in the rect
    var Rmax = Math.max(12, Math.min(w, h) / 2 - 2);
    var k = Rmax / 60;
    var R0 = 38 * k;
    var cx = x + w / 2;
    var cy = y + h / 2;
    var top = -Math.PI / 2;
    var gap = 14 * k, off = 2.5 * k, maxBar = 12 * k;
    var lw = small ? 1.5 : 2;

    // tape track
    var ringCol = frozen ? DPVB_WH : DPVB_OR;
    dpColor(ringCol, frozen ? 0.55 : 0.18 + 0.5 * fb);
    mg.set_line_width(small ? 1.5 : (frozen ? 3 : 2));
    dpvbArc(mg, cx, cy, R0, 0, TAU);
    mg.stroke();
    if (!small) {
        dpColor(DPVB_GR, 0.7);
        mg.set_line_width(1);
        dpvbArc(mg, cx, cy, R0 - gap, 0, TAU);
        mg.stroke();
        dpvbArc(mg, cx, cy, R0 + gap, 0, TAU);
        mg.stroke();
    }
    // grid dots (eight equal divisions of the loop)
    var d, pd;
    dpColor(DPVB_WH, 0.55);
    for (d = 0; d < 8; d++) {
        pd = dpvbPol(cx, cy, R0 + gap + 4 * k, top + TAU * d / 8);
        mg.arc(pd[0], pd[1], small ? 0.9 : 1.2, 0, TAU);
        mg.fill();
    }

    // signal bars
    var hist = s.hist;
    var N = small ? 56 : 72;
    var BS = (typeof DP_HIST_BLOCK_SAMPS === "number") ? DP_HIST_BLOCK_SAMPS : 256;
    var NB = (typeof DP_HIST_BLOCKS === "number") ? DP_HIST_BLOCKS : 512;
    var head = s.histHead || 0;
    var twoLane = s.pp > 0.5 || s.chmode == 2;
    if (hist && hist.length >= NB * 3) {
        var per = T / N;
        var nb = Math.max(1, Math.min(8, Math.round(per / BS)));
        mg.set_line_width(lw);
        for (var i = 0; i < N; i++) {
            var age0 = i * per;
            var b0 = Math.floor(age0 / BS);
            if (b0 >= NB) break;
            var mi = 0, ml = 0, mr = 0;
            for (var q = 0; q < nb && b0 + q < NB; q++) {
                var idx = (((head - 1 - (b0 + q)) % NB) + NB) % NB;
                mi = Math.max(mi, hist[idx * 3] || 0);
                ml = Math.max(ml, hist[idx * 3 + 1] || 0);
                mr = Math.max(mr, hist[idx * 3 + 2] || 0);
            }
            var a = top + TAU * i / N;
            var age = 1 - i / N * 0.6;
            var hi = dpClamp(Math.pow(mi, 0.5) * 13 * k, 0, maxBar);
            if (hi > 0.5) {
                dpColor(DPVB_WH, 0.8 * age);
                dpvbBar(mg, cx, cy, a, R0 - off, R0 - off - hi);
            }
            var hl = dpClamp(Math.pow(ml, 0.5) * 13 * k, 0, maxBar);
            var hr = dpClamp(Math.pow(mr, 0.5) * 13 * k, 0, maxBar);
            var swap = s.pp > 0.5 && (Math.floor(i / 9) % 2 === 1);
            var cl = (twoLane && swap) ? DPVB_BL : DPVB_OR;
            var cr = twoLane ? (swap ? DPVB_OR : DPVB_BL) : DPVB_OR;
            if (hl > 0.5) {
                dpColor(cl, 0.95 * age);
                dpvbBar(mg, cx, cy, a - 0.012, R0 + off, R0 + off + hl);
            }
            if (hr > 0.5) {
                dpColor(cr, (twoLane ? 0.95 : 0.6) * age);
                dpvbBar(mg, cx, cy, a + 0.025, R0 + off, R0 + off + hr);
            }
        }
    }

    // chain-latency arc: thin and dim, ends at the write head
    var aw = top;
    var ar = top - TAU * Math.max(frac, 0.04);
    dpColor(clamped ? DPVB_RD : DPVB_WH, clamped ? 0.9 : 0.3);
    mg.set_line_width(small ? 1 : 1.5);
    dpvbArc(mg, cx, cy, R0 + 17 * k, ar, aw);
    mg.stroke();

    // read head
    var pr = dpvbPol(cx, cy, R0, ar);
    dpColor(DPVB_WH, 1);
    mg.arc(pr[0], pr[1], small ? 2.6 : 3.8, 0, TAU);
    mg.fill();
    dpColor(DP_COL.bg, 1);
    mg.arc(pr[0], pr[1], small ? 1 : 1.5, 0, TAU);
    mg.fill();

    // write head
    var p0 = dpvbPol(cx, cy, R0 - 16 * k, aw);
    var p1 = dpvbPol(cx, cy, R0 + 19 * k, aw);
    dpColor(DPVB_WH, 1);
    mg.set_line_width(2);
    mg.move_to(p0[0], p0[1]);
    mg.line_to(p1[0], p1[1]);
    mg.stroke();
}
