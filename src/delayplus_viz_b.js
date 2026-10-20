// Delay+ visualization B — "Tape Loop".
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

function vizDraw(mg, x, y, w, h, s) {
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

    var R0 = 38;
    var cx = x + 58;
    var cy = y + h * 0.5;
    var top = -Math.PI / 2;
    var ringCol = frozen ? DP_COL.violet : DP_COL.frame;

    // tape track
    dpColor(ringCol, frozen ? 0.55 : 0.35 + 0.5 * fb);
    mg.set_line_width(frozen ? 3 : 2);
    dpvbArc(mg, cx, cy, R0, 0, TAU);
    mg.stroke();
    // lane guides
    dpColor(DP_COL.frame, 0.45);
    mg.set_line_width(1);
    dpvbArc(mg, cx, cy, R0 - 14, 0, TAU);
    mg.stroke();
    dpvbArc(mg, cx, cy, R0 + 14, 0, TAU);
    mg.stroke();

    // signal bars
    var hist = s.hist;
    var N = 72;
    var BS = (typeof DP_HIST_BLOCK_SAMPS === "number") ? DP_HIST_BLOCK_SAMPS : 256;
    var NB = (typeof DP_HIST_BLOCKS === "number") ? DP_HIST_BLOCKS : 512;
    var head = s.histHead || 0;
    if (hist && hist.length >= NB * 3) {
        var per = T / N;
        var nb = Math.max(1, Math.min(8, Math.round(per / BS)));
        mg.set_line_width(2);
        for (var i = 0; i < N; i++) {
            var age0 = i * per;
            var b0 = Math.floor(age0 / BS);
            if (b0 >= NB) break;
            var mi = 0, ml = 0, mr = 0;
            for (var k = 0; k < nb && b0 + k < NB; k++) {
                var idx = (((head - 1 - (b0 + k)) % NB) + NB) % NB;
                mi = Math.max(mi, hist[idx * 3] || 0);
                ml = Math.max(ml, hist[idx * 3 + 1] || 0);
                mr = Math.max(mr, hist[idx * 3 + 2] || 0);
            }
            var a = top + TAU * i / N;
            var age = 1 - i / N * 0.6;
            var hi = dpClamp(Math.pow(mi, 0.5) * 13, 0, 12);
            if (hi > 0.6) {
                dpColor(DP_COL.text, 0.85 * age);
                dpvbBar(mg, cx, cy, a, R0 - 2.5, R0 - 2.5 - hi);
            }
            var hl = dpClamp(Math.pow(ml, 0.5) * 13, 0, 12);
            var hr = dpClamp(Math.pow(mr, 0.5) * 13, 0, 12);
            var ppOn = s.pp > 0.5;
            var swap = ppOn && (Math.floor(i / 9) % 2 === 1);
            var cl = swap ? DP_COL.amber : DP_COL.cyan;
            var cr = swap ? DP_COL.cyan : DP_COL.amber;
            if (hl > 0.6) {
                dpColor(cl, 0.9 * age);
                dpvbBar(mg, cx, cy, a - 0.012, R0 + 2.5, R0 + 2.5 + hl);
            }
            if (hr > 0.6) {
                dpColor(cr, 0.9 * age);
                dpvbBar(mg, cx, cy, a + 0.025, R0 + 2.5, R0 + 2.5 + hr);
            }
        }
    }

    // chain arc: ends at the write head, spans Lc of the loop (counter-clockwise from it)
    var aw = top;
    var ar = top - TAU * Math.max(frac, 0.04);
    var chainCol = clamped ? DP_COL.amber : DP_COL.violet;
    dpColor(chainCol, 0.22);
    mg.set_line_width(9);
    dpvbArc(mg, cx, cy, R0, ar, aw);
    mg.stroke();
    dpColor(chainCol, 0.95);
    mg.set_line_width(2.5);
    dpvbArc(mg, cx, cy, R0 + 17, ar, aw);
    mg.stroke();

    // read (tap) head at the start of the chain arc
    var pr = dpvbPol(cx, cy, R0, ar);
    dpColor(DP_COL.cyan, 1);
    mg.arc(pr[0], pr[1], 4, 0, TAU);
    mg.fill();
    dpColor(DP_COL.bg, 1);
    mg.arc(pr[0], pr[1], 1.6, 0, TAU);
    mg.fill();

    // write head
    var p0 = dpvbPol(cx, cy, R0 - 16, aw);
    var p1 = dpvbPol(cx, cy, R0 + 19, aw);
    dpColor(DP_COL.text, 1);
    mg.set_line_width(2);
    mg.move_to(p0[0], p0[1]);
    mg.line_to(p1[0], p1[1]);
    mg.stroke();
    mg.move_to(cx - 4, p0[1] - 4);
    mg.line_to(cx + 4, p0[1] - 4);
    mg.line_to(cx, p0[1] + 1);
    mg.close_path();
    mg.fill();

    // centre
    var fbs = "FB " + Math.round(fb * 100) + "%";
    var fw = dpTextW(fbs, 10, true);
    dpText(fbs, cx - fw / 2, cy + 4, 10, frozen ? DP_COL.violet : DP_COL.text, true);

    // right column
    var cxr = x + 122;
    var colW = x + w - 4 - cxr;
    var tl = dpTimeLabel();
    var tsz = dpTextW(tl, 10, true) > colW ? 8.5 : 10;
    dpText(tl, cxr, y + 22, tsz, DP_COL.text, true);

    var ms = Lc * 1000 / sr;
    var fx = "FX " + (ms < 10 ? ms.toFixed(1) : Math.round(ms)) + " ms";
    var mark = clamped ? "MIN" : "";
    dpColor(chainCol, 0.9);
    mg.set_line_width(2.5);
    mg.move_to(cxr, y + 46);
    mg.line_to(cxr + 12, y + 46);
    mg.stroke();
    dpText(fx, cxr + 17, y + 49.5, 9, chainCol, true);
    if (mark) {
        var mw = dpTextW(mark, 8, true);
        dpPill(cxr + 17, y + 54, mw + 10, 12, DP_COL.amber, 0.22);
        dpText(mark, cxr + 22, y + 63, 8, DP_COL.amber, true);
    }

    // legend
    var ly = y + 82;
    var items = [["IN", DP_COL.text], ["ECHO L", DP_COL.cyan], ["ECHO R", DP_COL.amber]];
    for (var q = 0; q < items.length; q++) {
        dpColor(items[q][1], 0.9);
        mg.set_line_width(2);
        mg.move_to(cxr + 1, ly + q * 13 - 3);
        mg.line_to(cxr + 1, ly + q * 13 + 5);
        mg.stroke();
        dpText(items[q][0], cxr + 8, ly + q * 13 + 4, 8, DP_COL.dim, false);
    }
    var tag = frozen ? "FREEZE" : (s.pp > 0.5 ? "PING-PONG" : "");
    if (tag) dpText(tag, cxr, y + h - 3, 8, frozen ? DP_COL.violet : DP_COL.dim, true);
}
