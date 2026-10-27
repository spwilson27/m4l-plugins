// Amp face "Lab": a scope-style analyzer. Three panels: TRANSFER (model input vs output as a fading
// phosphor trace), TONE (tone stack + cab response with four draggable nodes) and SPECTRUM (output
// FFT with peak hold and the fundamental / harmonics marked). Header: model buttons, LOAD, status.
// Gain staging lives in native live.* boxes to the right of this canvas.

var LAB = {
    W: 510, H: 169, PY: 22, PH: 143,
    bg: [0.02, 0.04, 0.047], grid: [0.1, 0.26, 0.28], teal: [0.25, 0.9, 0.85], amber: [1.0, 0.7, 0.2],
    dim: [0.35, 0.62, 0.62],
    nodes: [
        { key: "bass", f: 150, g: 4, tag: "B" }, { key: "mid", f: 425, g: 3, tag: "M" },
        { key: "treble", f: 1800, g: 2, tag: "T" }, { key: "presence", f: 4500, g: 1.6, tag: "P" }
    ],
    drag: null, hover: "", frame: 0,
    NC: 64, spec: [], pk: [], pkHold: [], f0: 0, harm: [], bins: [],
    win: null, rev: null, cosT: null, sinT: null
};
var LAB_N = 2048;

function labRgb(c, a) { mgraphics.set_source_rgba(c[0], c[1], c[2], a == null ? 1 : a); }
function labClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function labIn(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

function labText(t, x, y, size, align) {
    mgraphics.set_font_size(size);
    var w = mgraphics.text_measure(t)[0];
    mgraphics.move_to(align === 1 ? x - w / 2 : (align === 2 ? x - w : x), y);
    mgraphics.show_text(t);
}

/** Shorten text to a pixel width. @param {string} t @param {number} size @param {number} maxw */
function labFit(t, size, maxw) {
    mgraphics.set_font_size(size);
    if (mgraphics.text_measure(t)[0] <= maxw) return t;
    while (t.length > 3 && mgraphics.text_measure(t + "…")[0] > maxw) t = t.slice(0, -1);
    return t + "…";
}

function labLine(x0, y0, x1, y1, w) {
    mgraphics.set_line_width(w || 1);
    mgraphics.move_to(x0, y0);
    mgraphics.line_to(x1, y1);
    mgraphics.stroke();
}

function labCircle(x, y, r) { mgraphics.ellipse(x - r, y - r, 2 * r, 2 * r); }

/** Panel frame with a title. */
function labPanel(r, title, accent) {
    labRgb(LAB.bg);
    mgraphics.rectangle(r.x, r.y, r.w, r.h);
    mgraphics.fill();
    labRgb(LAB.grid, 0.9);
    mgraphics.set_line_width(1);
    mgraphics.rectangle(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    mgraphics.stroke();
    labRgb(accent || LAB.teal);
    mgraphics.select_font_face("Menlo");
    labText(title, r.x + 6, r.y + 10, 7.5, 0);
}

var LAB_R = {
    xfer: { x: 4, y: 22, w: 148, h: 143 },
    tone: { x: 158, y: 22, w: 188, h: 143 },
    spec: { x: 352, y: 22, w: 156, h: 143 }
};

// ---- header -------------------------------------------------------------------------------------

function labModelRects() {
    var out = [], names = ["CLEAN", "CRUNCH", "LEAD", "FILE"], ws = [38, 44, 34, 34], x = 6;
    for (var i = 0; i < 4; i++) { out.push({ i: i, x: x, y: 3, w: ws[i], h: 15, label: names[i] }); x += ws[i] + 3; }
    return out;
}
function labLoadRect() { return { x: 164, y: 3, w: 38, h: 15 }; }

function labHeader() {
    var sel = Math.round(ampP.model), rs = labModelRects();
    mgraphics.select_font_face("Menlo");
    for (var i = 0; i < rs.length; i++) {
        var r = rs[i], on = r.i === sel;
        if (on) { labRgb(LAB.teal); mgraphics.rectangle(r.x, r.y, r.w, r.h); mgraphics.fill(); }
        else {
            labRgb(LAB.grid, LAB.hover === "mdl" + r.i ? 1 : 0.8);
            mgraphics.set_line_width(1);
            mgraphics.rectangle(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
            mgraphics.stroke();
        }
        if (on) labRgb([0.02, 0.08, 0.08]); else labRgb(LAB.hover === "mdl" + r.i ? LAB.teal : LAB.dim);
        labText(r.label, r.x + r.w / 2, r.y + 10.5, 7, 1);
    }
    var l = labLoadRect();
    labRgb(LAB.amber, LAB.hover === "load" ? 1 : 0.8);
    mgraphics.set_line_width(1);
    mgraphics.rectangle(l.x + 0.5, l.y + 0.5, l.w - 1, l.h - 1);
    mgraphics.stroke();
    labText("LOAD", l.x + l.w / 2, l.y + 10.5, 7, 1);
    var info = amp.model.error ? amp.model.error : (amp.model.name ? amp.model.name + " · " + amp.model.label : "no model");
    labRgb(amp.model.error ? [1, 0.35, 0.25] : LAB.dim);
    labText(labFit(info, 7, 190), 210, 13, 7, 0);
    var st = amp.dsp.error ? "DSP " + amp.dsp.error : (amp.dsp.ready ? "DSP READY" : "DSP LOADING");
    labRgb(amp.dsp.error ? [1, 0.35, 0.25] : (amp.dsp.ready ? LAB.teal : LAB.amber), 0.9);
    labText(labFit(st, 7, 90), 504, 13, 7, 2);
}

// ---- transfer -----------------------------------------------------------------------------------

function labTransfer() {
    var R = LAB_R.xfer;
    labPanel(R, "TRANSFER  IN/OUT");
    var s = 104, px = R.x + 6, py = R.y + 16, cx = px + s / 2, cy = py + s / 2;
    labRgb([0.01, 0.025, 0.03]);
    mgraphics.rectangle(px, py, s, s);
    mgraphics.fill();
    labRgb(LAB.grid, 0.45);
    for (var g = 1; g < 4; g++) {
        labLine(px + g * s / 4, py, px + g * s / 4, py + s, 0.5);
        labLine(px, py + g * s / 4, px + s, py + g * s / 4, 0.5);
    }
    labRgb(LAB.grid, 0.9);
    labLine(cx, py, cx, py + s, 0.75);
    labLine(px, cy, px + s, cy, 0.75);
    // y = x reference
    labRgb(LAB.amber, 0.35);
    labLine(px + 1, py + s - 1, px + s - 1, py + 1, 0.75);
    var pts = ampXY(512), q = [];
    for (var i = 0; i < pts.length; i += 2) {
        q.push([cx + labClamp(pts[i][0], -1, 1) * (s / 2 - 1), cy - labClamp(pts[i][1], -1, 1) * (s / 2 - 1)]);
    }
    var B = 8, n = q.length;
    for (var b = 0; b < B && n > 1; b++) {
        var a0 = Math.floor(n * b / B), a1 = Math.min(n - 1, Math.floor(n * (b + 1) / B));
        var f = (b + 1) / B;
        labRgb(LAB.teal, 0.06 + 0.8 * f * f);
        mgraphics.set_line_width(0.75 + 0.5 * f);
        mgraphics.move_to(q[a0][0], q[a0][1]);
        for (var k = a0 + 1; k <= a1; k++) mgraphics.line_to(q[k][0], q[k][1]);
        mgraphics.stroke();
    }
    for (var d = Math.max(0, n - 10); d < n; d++) {
        labRgb(d === n - 1 ? [1, 0.95, 0.8] : LAB.teal, 0.2 + 0.7 * (d - (n - 10)) / 10);
        labCircle(q[d][0], q[d][1], d === n - 1 ? 1.8 : 1.1);
        mgraphics.fill();
    }
    // frame
    labRgb(LAB.grid);
    mgraphics.set_line_width(1);
    mgraphics.rectangle(px + 0.5, py + 0.5, s - 1, s - 1);
    mgraphics.stroke();
    // gate / saturation bars
    var bx = [R.x + 120, R.x + 134], vals = [labClamp(ampTel.gate, 0, 1), labClamp(ampTel.sat, 0, 1)];
    var cols = [LAB.teal, LAB.amber], tag = ["G", "S"];
    for (var j = 0; j < 2; j++) {
        labRgb(LAB.grid);
        mgraphics.set_line_width(1);
        mgraphics.rectangle(bx[j] + 0.5, py + 0.5, 8, s - 1);
        mgraphics.stroke();
        var h = Math.round((s - 4) * vals[j]);
        labRgb(cols[j], 0.9);
        mgraphics.rectangle(bx[j] + 2, py + s - 2 - h, 5, h);
        mgraphics.fill();
        labRgb(cols[j], 0.8);
        labText(tag[j], bx[j] + 4.5, py + s + 9, 7, 1);
    }
    labRgb(LAB.dim);
    labText("GATE " + Math.round(ampTel.gate * 100) + "%  SAT " + ampTel.sat.toFixed(2), R.x + 6, R.y + 139, 7, 0);
    labRgb(LAB.dim, 0.7);
    labText("x in  y out", R.x + 6, R.y + 131 + 0, 6.5, 0);
}

// ---- tone ---------------------------------------------------------------------------------------

function labToneGeom() { var R = LAB_R.tone; return { x: R.x + 22, y: R.y + 16, w: R.w - 28, h: 96 }; }
function labFx(G, f) { return G.x + Math.log(f / 20) / Math.log(1000) * G.w; }
function labDy(G, db) { return G.y + G.h / 2 - labClamp(db, -24, 24) / 24 * G.h / 2; }
function labNodeDb(nd) { return (ampP[nd.key] - 5) * nd.g; }
function labCabRects() {
    var out = [], R = LAB_R.tone, names = AMP_PARAMS.cab[8];
    for (var i = 0; i < 4; i++) out.push({ i: i, x: R.x + 26 + i * 39, y: R.y + 124, w: 37, h: 14, label: String(names[i]).toUpperCase() });
    return out;
}

function labTone() {
    var R = LAB_R.tone, G = labToneGeom();
    labPanel(R, "TONE + CAB  RESPONSE", LAB.amber);
    labRgb([0.01, 0.025, 0.03]);
    mgraphics.rectangle(G.x, G.y, G.w, G.h);
    mgraphics.fill();
    // grid: decades and dB lines
    var fs = [30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
    for (var i = 0; i < fs.length; i++) {
        labRgb(LAB.grid, (fs[i] === 100 || fs[i] === 1000 || fs[i] === 10000) ? 0.7 : 0.25);
        labLine(labFx(G, fs[i]), G.y, labFx(G, fs[i]), G.y + G.h, 0.5);
    }
    var dbs = [-24, -12, 0, 12, 24];
    for (i = 0; i < dbs.length; i++) {
        labRgb(LAB.grid, dbs[i] === 0 ? 0.95 : 0.4);
        labLine(G.x, labDy(G, dbs[i]), G.x + G.w, labDy(G, dbs[i]), dbs[i] === 0 ? 0.9 : 0.5);
        labRgb(LAB.dim, 0.8);
        labText((dbs[i] > 0 ? "+" : "") + dbs[i], G.x - 3, labDy(G, dbs[i]) + 2.5, 6.5, 2);
    }
    var lf = [[100, "100"], [1000, "1k"], [10000, "10k"]];
    for (i = 0; i < lf.length; i++) { labRgb(LAB.dim, 0.8); labText(lf[i][1], labFx(G, lf[i][0]), G.y + G.h + 9, 6.5, 1); }
    // curve
    var N = 96, px = [], py = [];
    for (i = 0; i <= N; i++) {
        var f = 20 * Math.pow(1000, i / N);
        px.push(G.x + G.w * i / N);
        py.push(labDy(G, ampToneCurve(f)));
    }
    for (var pass = 0; pass < 2; pass++) {
        labRgb(LAB.teal, pass === 0 ? 0.22 : 1);
        mgraphics.set_line_width(pass === 0 ? 3.2 : 1.2);
        mgraphics.move_to(px[0], py[0]);
        for (i = 1; i <= N; i++) mgraphics.line_to(px[i], py[i]);
        mgraphics.stroke();
    }
    labRgb(LAB.grid);
    mgraphics.set_line_width(1);
    mgraphics.rectangle(G.x + 0.5, G.y + 0.5, G.w - 1, G.h - 1);
    mgraphics.stroke();
    // nodes
    for (i = 0; i < LAB.nodes.length; i++) {
        var nd = LAB.nodes[i], x = labFx(G, nd.f), y = labDy(G, labNodeDb(nd));
        var act = LAB.hover === nd.key || (LAB.drag && LAB.drag.key === nd.key);
        labRgb(LAB.amber, 0.35);
        labLine(x, labDy(G, 0), x, y, 0.75);
        labRgb([0.01, 0.025, 0.03]);
        labCircle(x, y, act ? 5 : 4);
        mgraphics.fill();
        labRgb(LAB.amber, act ? 1 : 0.85);
        mgraphics.set_line_width(1.2);
        labCircle(x, y, act ? 5 : 4);
        mgraphics.stroke();
        labRgb(LAB.amber, 0.9);
        labText(nd.tag, x, G.y + G.h - 3, 6.5, 1);
        if (act) {
            var t = nd.key.toUpperCase().slice(0, 4) + " " + ampP[nd.key].toFixed(1), tw = 42;
            var tx = labClamp(x - tw / 2, G.x + 1, G.x + G.w - tw - 1), ty = y < G.y + 22 ? y + 15 : y - 14;
            labRgb([0.03, 0.07, 0.08]);
            mgraphics.rectangle(tx, ty - 7, tw, 10);
            mgraphics.fill();
            labRgb(LAB.amber);
            labText(t, tx + tw / 2, ty + 1, 7, 1);
        }
    }
    // cab selector
    var cab = Math.round(ampP.cab), rs = labCabRects();
    labRgb(LAB.dim);
    labText("CAB", R.x + 6, R.y + 134, 7, 0);
    for (i = 0; i < rs.length; i++) {
        var r = rs[i], on = r.i === cab;
        if (on) { labRgb(LAB.amber); mgraphics.rectangle(r.x, r.y, r.w, r.h); mgraphics.fill(); }
        else {
            labRgb(LAB.grid, LAB.hover === "cab" + r.i ? 1 : 0.8);
            mgraphics.set_line_width(1);
            mgraphics.rectangle(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
            mgraphics.stroke();
        }
        if (on) labRgb([0.1, 0.06, 0.01]); else labRgb(LAB.hover === "cab" + r.i ? LAB.amber : LAB.dim);
        labText(r.label, r.x + r.w / 2, r.y + 10, 7, 1);
    }
}

// ---- spectrum -----------------------------------------------------------------------------------

function labFftInit() {
    if (LAB.win) return;
    LAB.win = []; LAB.rev = []; LAB.cosT = []; LAB.sinT = [];
    var bits = 11, i;
    for (i = 0; i < LAB_N; i++) {
        LAB.win.push(0.5 - 0.5 * Math.cos(2 * Math.PI * i / LAB_N));
        var r = 0;
        for (var b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
        LAB.rev.push(r);
    }
    for (i = 0; i < LAB_N / 2; i++) { LAB.cosT.push(Math.cos(2 * Math.PI * i / LAB_N)); LAB.sinT.push(-Math.sin(2 * Math.PI * i / LAB_N)); }
    for (i = 0; i < LAB.NC; i++) { LAB.spec.push(-120); LAB.pk.push(-120); LAB.pkHold.push(0); }
}

function labColFreq(c) { return 40 * Math.pow(18000 / 40, c / LAB.NC); }

function labAnalyze() {
    labFftInit();
    var ring = ampOutRing(LAB_N), n = ring.length, re = new Array(LAB_N), im = new Array(LAB_N), i;
    var off = LAB_N - n;
    for (i = 0; i < LAB_N; i++) { re[LAB.rev[i]] = (i >= off ? ring[i - off] : 0) * LAB.win[i]; im[LAB.rev[i]] = 0; }
    for (var size = 2; size <= LAB_N; size *= 2) {
        var half = size / 2, step = LAB_N / size;
        for (var s = 0; s < LAB_N; s += size) {
            for (var k = 0; k < half; k++) {
                var wr = LAB.cosT[k * step], wi = LAB.sinT[k * step];
                var a = s + k, b = a + half;
                var tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
            }
        }
    }
    var nb = LAB_N / 2, bins = [];
    for (i = 0; i < nb; i++) bins.push(20 * Math.log(2 * Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (LAB_N / 2) + 1e-7) / Math.LN10);
    LAB.bins = bins;
    var sr = ampTel.sr || 48000, bh = sr / LAB_N;
    for (var c = 0; c < LAB.NC; c++) {
        var lo = Math.floor(labColFreq(c) / bh), hi = Math.max(lo, Math.floor(labColFreq(c + 1) / bh) - 1);
        var m = -120;
        for (i = Math.max(1, lo); i <= Math.min(nb - 1, hi); i++) if (bins[i] > m) m = bins[i];
        LAB.spec[c] = Math.max(m, LAB.spec[c] - 4);
        if (LAB.spec[c] >= LAB.pk[c]) { LAB.pk[c] = LAB.spec[c]; LAB.pkHold[c] = 12; }
        else if (LAB.pkHold[c] > 0) LAB.pkHold[c]--;
        else LAB.pk[c] = Math.max(LAB.spec[c], LAB.pk[c] - 2);
    }
    // fundamental: strongest bin 60 Hz .. 1.2 kHz, clearly above the median of that range
    var b0 = Math.ceil(60 / bh), b1 = Math.floor(1200 / bh), best = b0, sum = 0;
    for (i = b0; i <= b1; i++) { if (bins[i] > bins[best]) best = i; sum += bins[i]; }
    var mean = sum / (b1 - b0 + 1);
    LAB.f0 = 0; LAB.harm = [];
    if (bins[best] > -62 && bins[best] - mean > 18) {
        var l = bins[best - 1], cc = bins[best], r2 = bins[best + 1];
        var den = l - 2 * cc + r2, d = den !== 0 ? 0.5 * (l - r2) / den : 0;
        LAB.f0 = (best + labClamp(d, -0.5, 0.5)) * bh;
        for (var h = 2; h <= 6; h++) {
            var bi = Math.round(LAB.f0 * h / bh), mx = -120;
            if (bi + 1 >= nb) break;
            for (var q = bi - 1; q <= bi + 1; q++) if (bins[q] > mx) mx = bins[q];
            LAB.harm.push({ h: h, db: mx - bins[best], f: LAB.f0 * h });
        }
    }
}

function labSpecX(P, f) { return P.x + Math.log(f / 40) / Math.log(18000 / 40) * P.w; }
function labSpecY(P, db) { return P.y + P.h - labClamp((db + 96) / 96, 0, 1) * P.h; }

function labSpectrum() {
    var R = LAB_R.spec, P = { x: R.x + 6, y: R.y + 16, w: R.w - 12, h: 94 };
    labPanel(R, "SPECTRUM  OUT");
    labRgb([0.01, 0.025, 0.03]);
    mgraphics.rectangle(P.x, P.y, P.w, P.h);
    mgraphics.fill();
    var dbs = [-72, -48, -24];
    for (var i = 0; i < dbs.length; i++) {
        labRgb(LAB.grid, 0.4);
        labLine(P.x, labSpecY(P, dbs[i]), P.x + P.w, labSpecY(P, dbs[i]), 0.5);
    }
    var fl = [100, 1000, 10000];
    for (i = 0; i < fl.length; i++) {
        labRgb(LAB.grid, 0.6);
        labLine(labSpecX(P, fl[i]), P.y, labSpecX(P, fl[i]), P.y + P.h, 0.5);
        labRgb(LAB.dim, 0.8);
        labText(fl[i] >= 1000 ? (fl[i] / 1000) + "k" : String(fl[i]), labSpecX(P, fl[i]), P.y + P.h + 9, 6.5, 1);
    }
    var cw = P.w / LAB.NC;
    for (i = 0; i < LAB.NC && LAB.spec.length; i++) {
        var y = labSpecY(P, LAB.spec[i]), x = P.x + i * cw;
        if (y < P.y + P.h - 0.5) {
            labRgb(LAB.teal, 0.85);
            mgraphics.rectangle(x + 0.3, y, Math.max(0.8, cw - 0.6), P.y + P.h - y);
            mgraphics.fill();
        }
        if (LAB.pk[i] > -90) {
            labRgb(LAB.amber, 0.9);
            mgraphics.rectangle(x + 0.3, labSpecY(P, LAB.pk[i]) - 0.5, Math.max(0.8, cw - 0.6), 1);
            mgraphics.fill();
        }
    }
    // fundamental + harmonics
    if (LAB.f0 > 0) {
        labRgb(LAB.amber, 0.7);
        var x0 = labSpecX(P, LAB.f0);
        labLine(x0, P.y, x0, P.y + P.h, 0.75);
        for (i = 0; i < LAB.harm.length; i++) {
            if (LAB.harm[i].f > 18000) break;
            var hx = labSpecX(P, LAB.harm[i].f);
            labRgb(LAB.amber, 0.45);
            labLine(hx, P.y, hx, P.y + 6, 0.75);
            labRgb(LAB.amber, 0.8);
            labText(String(LAB.harm[i].h), hx, P.y + 13, 6, 1);
        }
    }
    labRgb(LAB.grid);
    mgraphics.set_line_width(1);
    mgraphics.rectangle(P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1);
    mgraphics.stroke();
    labRgb(LAB.f0 > 0 ? LAB.amber : LAB.dim);
    labText(LAB.f0 > 0 ? "f0 " + LAB.f0.toFixed(1) + " Hz" : "f0 --", R.x + 6, R.y + 130, 7, 0);
    var hs = "";
    for (i = 0; i < Math.min(3, LAB.harm.length); i++) hs += (i ? " " : "") + "H" + LAB.harm[i].h + " " + Math.round(LAB.harm[i].db);
    labRgb(LAB.dim);
    labText(LAB.harm.length ? hs + " dB" : "harmonics --", R.x + 6, R.y + 140, 6.5, 0);
}

// ---- paint --------------------------------------------------------------------------------------

function paint() {
    labRgb([0.008, 0.016, 0.02]);
    mgraphics.rectangle(0, 0, LAB.W, LAB.H);
    mgraphics.fill();
    mgraphics.select_font_face("Menlo");
    labHeader();
    labTransfer();
    labTone();
    labSpectrum();
}

function ampFaceFrame() {
    LAB.frame++;
    if (LAB.frame % 3 === 0) labAnalyze();
    return true;
}
function ampFaceChanged(what) { }

// ---- interaction --------------------------------------------------------------------------------

/** @param {number} x @param {number} y */
function labHit(x, y) {
    var G = labToneGeom(), i;
    for (i = 0; i < LAB.nodes.length; i++) {
        var nd = LAB.nodes[i], dx = x - labFx(G, nd.f), dy = y - labDy(G, labNodeDb(nd));
        if (dx * dx + dy * dy <= 100) return nd.key;
    }
    var rs = labModelRects();
    for (i = 0; i < rs.length; i++) if (labIn(x, y, rs[i])) return "mdl" + i;
    if (labIn(x, y, labLoadRect())) return "load";
    var cs = labCabRects();
    for (i = 0; i < cs.length; i++) if (labIn(x, y, cs[i])) return "cab" + i;
    return "";
}

function onclick(x, y, but, cmd, shift) {
    var h = labHit(x, y);
    LAB.drag = null;
    if (!h) return;
    if (h === "load") ampBrowse();
    else if (h.indexOf("mdl") === 0) { var c = Number(h.slice(3)); if (c === 3 && !amp.fileModel) ampBrowse(); else ampSet("model", c); }
    else if (h.indexOf("cab") === 0) ampSet("cab", Number(h.slice(3)));
    else {
        var nd = null;
        for (var i = 0; i < LAB.nodes.length; i++) if (LAB.nodes[i].key === h) nd = LAB.nodes[i];
        if (nd) LAB.drag = { key: h, y: y, p: ampP[h], g: nd.g, fine: !!shift };
    }
    mgraphics.redraw();
}

function ondrag(x, y, but, cmd, shift) {
    if (!LAB.drag) return;
    if (!but) { LAB.drag = null; mgraphics.redraw(); return; }
    var d = LAB.drag, G = labToneGeom();
    var dDb = (d.y - y) / (G.h / 2) * 24 * (shift ? 0.2 : 1);
    ampSet(d.key, labClamp(d.p + dDb / d.g, 0, 10));
    mgraphics.redraw();
}

function ondblclick(x, y) {
    var h = labHit(x, y);
    if (h && AMP_PARAMS[h] && h !== "model") ampSet(h, 5);
    mgraphics.redraw();
}

function onidle(x, y) {
    var h = labHit(x, y);
    if (h !== LAB.hover) { LAB.hover = h; mgraphics.redraw(); }
}
function onidleout() { LAB.hover = ""; mgraphics.redraw(); }

function preview() {
    ampPreviewSetup(0.75);
    ampP.input = 6; ampP.bass = 6.5; ampP.mid = 3.5; ampP.treble = 7; ampP.presence = 6;
    for (var i = 0; i < 8; i++) labAnalyze();
}
