// Deviate Matrix face: LED dot-matrix history of the last 16 draws (columns, newest right), 8 rows = the 8 metas. Cell brightness = the drawn
// value (5 levels), colour = the chain the meta mostly lives in (T amber, B white, L red). A Chance-rejected hit is a dark column. A Value/Range
// gauge ends every row, a 32-band spectrum strip and the T/B/L peaks sit on top, the Ring envelope pulses the border.

var MX_PAL = { bg: [0.02, 0.02, 0.025, 1], t: [1.0, 0.66, 0.12, 1], b: [0.95, 0.96, 1.0, 1], l: [0.96, 0.36, 0.30, 1], dim: [0.20, 0.17, 0.10, 1], text: [0.93, 0.94, 0.97, 1] };
var MX_CHAIN = [0, 1, 1, 1, 2, 2, 0, 2]; // meta -> chain 0 T, 1 B, 2 L
var MX_COLS = 16, MX_GX = 3, MX_GP = 10, MX_GY = 14, MX_RP = 19, MX_CW = 8, MX_CH = 13;
var MX_BX = 168, MX_BW = 21; // gauge x / width
var mxHist = []; // [{m: [8], g}]
var mxFlash = 0;

var hitZones = [[0, 0, 192, 163]];

dvPoll(30);
dvNeed({ spec: true });

function mxSnap(t) {
    return { m: t.metas.slice(0, 8), g: t.gate };
}

function onFrame(t) {
    if (t.hitNew || t.serialNew) {
        mxHist.push(mxSnap(t));
        if (mxHist.length > MX_COLS) mxHist.shift();
        mxFlash = 1;
        dvAnimate(500);
    } else if (mxFlash > 0) {
        mxFlash = Math.max(0, mxFlash - 0.08);
    }
    return true;
}

function onclick() {
    dvManualHit();
}

function preview() {
    var st = dvPreviewBase();
    mxHist = [];
    mxFlash = 0;
    if (st.kind === "idle") return;
    var rng = dvRng(31), c, i;
    for (c = 0; c < MX_COLS - 1; c++) {
        var m = [];
        for (i = 0; i < 8; i++) m.push(Math.round(rng() * 100));
        mxHist.push({ m: m, g: c % 5 === 3 ? 0 : 1 });
    }
    mxHist.push(mxSnap(dvTel));
    mxFlash = dvTel.hitNew ? 1 : 0;
}

/** the 16 columns to show, oldest first; the newest follows the live metas */
function mxColumns() {
    var arr = mxHist.slice(-MX_COLS), live = [], i;
    for (i = 0; i < 8; i++) live.push(dvMetaValue(i));
    var cur = { m: live, g: dvTel.gate, fresh: dvTel.hits > 0 || dvTel.serial > 0 };
    if (!arr.length || !cur.fresh) arr.push(cur);
    else arr[arr.length - 1] = cur;
    return arr;
}

function mxRect(x, y, w, h) {
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
}

function mxLevel(v) {
    return v <= 0.5 ? 0 : Math.min(5, Math.ceil(v / 20));
}

function paint() {
    var W = mgraphics.size[0], H = mgraphics.size[1], i, c, k;
    dvColor(MX_PAL.bg);
    mgraphics.rectangle(0, 0, W, H);
    mgraphics.fill();
    var chainC = [MX_PAL.t, MX_PAL.b, MX_PAL.l];

    // spectrum strip (top, 32 columns) in one path
    var spec = dvTel.spec;
    dvColor(MX_PAL.t, 0.55);
    for (i = 0; i < 32; i++) {
        var db = spec ? spec[i] : -100;
        var hh = Math.round(dvClamp((db + 80) / 80, 0, 1) * 10);
        mxRect(MX_GX + i * 5, 12 - 1 - hh, 4, hh + 1);
    }
    // chain peaks T / B / L (own scale each, dB-ish)
    var pk = [dvTel.pk.t, dvTel.pk.b, dvTel.pk.l];
    for (i = 0; i < 3; i++) {
        var lv = pk[i] > 0.0003 ? dvClamp((20 * Math.log(pk[i]) / Math.LN10 + 48) / 48, 0, 1) : 0;
        var bh = Math.round(lv * 10);
        dvColor(chainC[i], 0.25);
        mgraphics.rectangle(MX_BX + i * 7, 2, 5, 10);
        mgraphics.fill();
        dvColor(chainC[i], 1);
        mgraphics.rectangle(MX_BX + i * 7, 12 - bh, 5, bh);
        mgraphics.fill();
    }

    // dot matrix: empty cells in one path, lit cells batched by chain x level
    var cols = mxColumns(), n = cols.length, x0 = MX_COLS - n;
    dvColor(MX_PAL.dim, 0.5);
    for (i = 0; i < 8; i++) mxRect(MX_GX - 1, MX_GY + i * MX_RP + 1, MX_COLS * MX_GP, MX_CH);
    dvColor(MX_PAL.bg, 1);
    for (c = 1; c < MX_COLS; c++) mxRect(MX_GX + c * MX_GP - 2, MX_GY, 2, 8 * MX_RP - 4);
    var lvAlpha = [0.14, 0.32, 0.5, 0.7, 0.88, 1.0];
    var lit = {}, dark = [];
    for (c = 0; c < n; c++) {
        var col = cols[c], cx = MX_GX + (x0 + c) * MX_GP;
        if (!col.g) { dark.push(cx); continue; }
        for (i = 0; i < 8; i++) {
            var L = mxLevel(col.m[i]);
            if (!L) continue;
            var key = MX_CHAIN[i] * 6 + L;
            (lit[key] || (lit[key] = [])).push(cx, MX_GY + i * MX_RP + 1);
        }
    }
    for (k in lit) {
        var kk = +k, arr = lit[k];
        dvColor(chainC[Math.floor(kk / 6)], lvAlpha[kk % 6] * (n && cols[n - 1].fresh === false ? 0.45 : 1));
        for (i = 0; i < arr.length; i += 2) mxRect(arr[i], arr[i + 1], MX_CW, MX_CH);
    }
    // rejected hits: dark column with a thin coral stem
    if (dark.length) {
        dvColor(MX_PAL.bg, 1);
        for (i = 0; i < dark.length; i++) mxRect(dark[i] - 1, MX_GY, MX_CW + 2, 8 * MX_RP - 4);
        dvColor(MX_PAL.l, 0.7);
        for (i = 0; i < dark.length; i++) mxRect(dark[i] + 3, MX_GY + 1, 2, 8 * MX_RP - 6);
    }
    // newest column: hit flash outline (stronger while fresh)
    var nx = MX_GX + (MX_COLS - 1) * MX_GP;
    var fl = Math.max(mxFlash, dvTel.hitNew ? 1 : 0);
    if (fl > 0.02 && n && cols[n - 1].g) {
        dvColor(MX_PAL.b, 0.35 * fl);
        mgraphics.rectangle(nx - 1, MX_GY, MX_CW + 2, 8 * MX_RP - 4);
        mgraphics.fill();
    }
    dvColor(MX_PAL.b, dvTel.hits > 0 ? 0.9 : 0.35);
    mgraphics.set_line_width(1);
    mgraphics.rectangle(nx - 1.5, MX_GY - 0.5, MX_CW + 3, 8 * MX_RP - 3);
    mgraphics.stroke();

    // gauges: Range band, Value marker, drawn value dot
    for (i = 0; i < 8; i++) {
        var kname = DV_META_KEYS[i], gy = MX_GY + i * MX_RP + 1;
        var v = dvClamp(dvParam("v_" + kname), 0, 100), r = dvClamp(dvParam("r_" + kname), 0, 100);
        var lo = dvClamp(v - r, 0, 100), hi = dvClamp(v + r, 0, 100);
        var col2 = chainC[MX_CHAIN[i]];
        dvColor(MX_PAL.dim, 0.5);
        mgraphics.rectangle(MX_BX, gy, MX_BW, MX_CH);
        mgraphics.fill();
        dvColor(col2, 0.3);
        mgraphics.rectangle(MX_BX + lo / 100 * (MX_BW - 2), gy + 1, Math.max(1, (hi - lo) / 100 * (MX_BW - 2)), MX_CH - 2);
        mgraphics.fill();
        dvColor(MX_PAL.b, 0.95);
        mgraphics.rectangle(MX_BX + v / 100 * (MX_BW - 2), gy, 2, MX_CH);
        mgraphics.fill();
        var d = dvClamp(dvMetaValue(i), 0, 100);
        dvColor(col2, dvTel.gate ? 1 : 0.35);
        mgraphics.rectangle(MX_BX + d / 100 * (MX_BW - 2) - 1, gy + 4, 4, MX_CH - 8);
        mgraphics.fill();
    }

    // border pulses with the Ring envelope
    dvColor(MX_PAL.t, 0.18 + 0.82 * dvTel.ringEnv);
    mgraphics.set_line_width(1.5);
    mgraphics.rectangle(0.75, 0.75, W - 1.5, H - 1.5);
    mgraphics.stroke();
    dvDrawDspPill(W - 4, 16, 8, { amber: MX_PAL.t, coral: MX_PAL.l });
}
