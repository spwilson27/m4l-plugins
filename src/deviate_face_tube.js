// Deviate Tube face: an amber-bezel CRT. Phase portrait (input block extremes against output block extremes, from the waveform ring) with
// 6-frame persistence, graticule, spectrum trace along the bottom; a hit blooms and flickers the glass; corner lamps T / B / L follow the three
// chain peaks; the Ring meta sets the trail length and the glow; 8 LED bars show the current draw (tick = the Value); a bezel label says ENV / SPEC.
// A Chance-rejected hit (HIT_GATE 0) tints the glass coral, holds the bars hollow and prints HELD. A click is a manual hit (role "hit").

var TB = {
    glass: [0.015, 0.045, 0.02, 1], phos: [0.42, 1.0, 0.52, 1], phosDim: [0.20, 0.55, 0.28, 1], amber: [0.97, 0.68, 0.26, 1],
    amberDim: [0.50, 0.34, 0.13, 1], coral: [1.0, 0.40, 0.34, 1], white: [1, 1, 0.9, 1], t: [1.0, 0.62, 0.22, 1], b: [0.62, 1.0, 0.45, 1], l: [0.45, 0.95, 0.9, 1],
};
// canvas layout (246 x 161)
var TB_SCR = [4, 4, 198, 153];
var TB_PORT = [8, 8, 190, 108];
var TB_SPEC = [8, 122, 190, 30];
var TB_BAR = { x: 207, pitch: 4.4, w: 3.4, y: 20, h: 90 };
var PAINT_REGIONS = [[0, 0, 246, 161]];
var hitZones = [[0, 0, 246, 161]];

var tbFlash = 0;
var tbHist = []; // previous frames' points (flat [x, y, ...], normalized -1..1), oldest first, at most 5
var TB_PERSIST = 5;

dvNeed({ wave: true, spec: true });
dvPoll(30);

/** trail length in ring blocks: the Ring meta (0..1) from 10 to 32 blocks */
function tbBlocks() {
    return 10 + Math.round(dvClamp(dvTel.ring, 0, 1) * 22);
}

/** The portrait points of the n newest waveform blocks ending before `head`: per block its (in, out) minimum and maximum, alternating order. */
function tbPoints(n, head) {
    var pts = [];
    var w = dvTel.wave;
    var S = DV_SCOPE;
    for (var k = 0; k < n; k++) {
        var x0 = 0, y0 = 0, x1 = 0, y1 = 0;
        if (w) {
            var blk = ((head - n + k) % DV_WAVE_BLOCKS + DV_WAVE_BLOCKS) % DV_WAVE_BLOCKS;
            var o = S.WAVE + blk * DV_WAVE_STRIDE;
            x0 = dvClamp(dvNum(w[o]), -1, 1); x1 = dvClamp(dvNum(w[o + 1]), -1, 1);
            y0 = dvClamp(dvNum(w[o + 2]), -1, 1); y1 = dvClamp(dvNum(w[o + 3]), -1, 1);
        }
        if (k % 2) pts.push(x1, y1, x0, y0);
        else pts.push(x0, y0, x1, y1);
    }
    return pts;
}

function tbPush() {
    var head = Math.round(dvNum(dvTel.waveHead));
    tbHist.push(tbPoints(tbBlocks(), head));
    if (tbHist.length > TB_PERSIST) tbHist.shift();
}

function onFrame(t) {
    if (t.hitNew) tbFlash = 1;
    else tbFlash = Math.max(0, tbFlash - 0.18);
    tbPush();
    return true;
}

function onclick() {
    tbFlash = Math.max(tbFlash, 0.6);
    dvManualHit();
    mgraphics.redraw();
}

function preview() {
    var st = dvPreviewBase();
    tbHist = [];
    var head = Math.round(dvNum(dvTel.waveHead)), n = tbBlocks();
    for (var j = TB_PERSIST; j >= 1; j--) tbHist.push(tbPoints(n, head - 2 * j));
    tbFlash = st.kind === "hit" || st.kind === "extreme" ? 1 : 0;
}

// ---- drawing ----------------------------------------------------------------------------------------------------------------------
function tbRect(r, c, a) {
    dvColor(c, a);
    mgraphics.rectangle(r[0], r[1], r[2], r[3]);
    mgraphics.fill();
}

function tbLamp(cx, cy, level, c, letter, tx) {
    var v = dvClamp(Math.sqrt(dvClamp(level, 0, 1)), 0, 1);
    if (v > 0.03) {
        dvColor(c, 0.14 * v); dvCircle(cx, cy, 7.5); mgraphics.fill();
        dvColor(c, 0.28 * v); dvCircle(cx, cy, 5.2); mgraphics.fill();
    }
    dvColor(c, 0.14 + 0.86 * v); dvCircle(cx, cy, 3.1); mgraphics.fill();
    dvText(letter, tx, cy + 2.6, 7, c, true, 0.55 + 0.45 * v);
}

function tbPolyline(pts, cx, cy, sx, sy, step) {
    var i, first = true;
    for (i = 0; i < pts.length; i += 2 * step) {
        var x = cx + pts[i] * sx, y = cy - pts[i + 1] * sy;
        if (first) { mgraphics.move_to(x, y); first = false; } else mgraphics.line_to(x, y);
    }
}

function paint() {
    var W = mgraphics.size[0], H = mgraphics.size[1], i;
    var gate = dvTel.gate !== 0;
    var tint = gate ? TB.phos : TB.coral;
    var P = TB_PORT, cx = P[0] + P[2] / 2, cy = P[1] + P[3] / 2;
    var sx = P[2] / 2 - 3, sy = P[3] / 2 - 3;
    var age = dvTel.ageMs >= 0 ? Math.exp(-dvTel.ageMs / 110) : 0;
    var bloom = dvClamp(Math.max(tbFlash, age), 0, 1);
    var ringEnv = dvClamp(dvTel.ringEnv, 0, 1), ring = dvClamp(dvTel.ring, 0, 1);

    // glass
    mgraphics.set_line_width(1.5);
    dvColor(TB.amberDim); mgraphics.rectangle_rounded(TB_SCR[0] - 1, TB_SCR[1] - 1, TB_SCR[2] + 2, TB_SCR[3] + 2, 12, 12); mgraphics.stroke();
    dvColor(TB.glass); mgraphics.rectangle_rounded(TB_SCR[0], TB_SCR[1], TB_SCR[2], TB_SCR[3], 11, 11); mgraphics.fill();
    // hit bloom on the glass: three growing rounded rects, flicker on every third frame
    if (bloom > 0.02) {
        var fl = dvTel.frames % 3 === 0 ? 1 : 0.55;
        for (i = 0; i < 3; i++) {
            var sc = (0.28 + 0.24 * i) + 0.4 * bloom;
            var bw = P[2] * Math.min(1, sc), bh = P[3] * Math.min(1, sc);
            dvColor(tint, bloom * fl * (0.13 - 0.03 * i));
            mgraphics.rectangle_rounded(cx - bw / 2, cy - bh / 2, bw, bh, 14, 14); mgraphics.fill();
        }
    }
    // scanlines
    mgraphics.set_line_width(1);
    dvColor([0, 0, 0, 1], 0.28);
    for (i = P[1] + 3; i < P[1] + P[3]; i += 6) { mgraphics.move_to(P[0], i); mgraphics.line_to(P[0] + P[2], i); }
    mgraphics.stroke();
    // graticule
    mgraphics.set_line_width(0.5);
    dvColor(tint, gate ? 0.16 : 0.22);
    for (i = 0; i <= 8; i++) { var gx = P[0] + P[2] * i / 8; mgraphics.move_to(gx, P[1]); mgraphics.line_to(gx, P[1] + P[3]); }
    for (i = 0; i <= 4; i++) { var gy = P[1] + P[3] * i / 4; mgraphics.move_to(P[0], gy); mgraphics.line_to(P[0] + P[2], gy); }
    mgraphics.stroke();
    mgraphics.set_line_width(1);
    dvColor(tint, 0.34);
    mgraphics.move_to(cx, P[1]); mgraphics.line_to(cx, P[1] + P[3]); mgraphics.move_to(P[0], cy); mgraphics.line_to(P[0] + P[2], cy);
    mgraphics.stroke();

    // persistence: older frames, decimated, fading
    var nh = tbHist.length;
    for (i = 0; i < nh; i++) {
        var a = 0.05 + 0.15 * (i + 1) / (nh + 1);
        dvColor(tint, a);
        mgraphics.set_line_width(1);
        tbPolyline(tbHist[i], cx, cy, sx, sy, 2);
        mgraphics.stroke();
    }
    // the current trace: glow layers + core, glow follows the Ring
    var cur = tbHist.length ? tbHist[nh - 1] : [];
    var glow = 0.06 + 0.16 * ringEnv + 0.10 * ring + 0.12 * bloom;
    var layers = ring > 0.45 || bloom > 0.4 ? 3 : 2;
    var widths = [5.5, 3.2, 1.2];
    for (i = 3 - layers; i < 3; i++) {
        dvColor(tint, i === 2 ? 0.95 : glow * (i === 0 ? 0.6 : 1));
        mgraphics.set_line_width(widths[i]);
        tbPolyline(cur, cx, cy, sx, sy, 1);
        mgraphics.stroke();
    }
    // beam spot at the newest point
    if (cur.length >= 2) {
        var bxp = cx + cur[cur.length - 2] * sx, byp = cy - cur[cur.length - 1] * sy;
        dvColor(TB.white, 0.5 + 0.5 * bloom); dvCircle(bxp, byp, 1.6); mgraphics.fill();
        dvColor(tint, 0.2 + 0.3 * bloom); dvCircle(bxp, byp, 3.4 + 2 * bloom); mgraphics.fill();
    }

    // spectrum trace along the bottom (ENV = green, SPEC = amber)
    var S = TB_SPEC, sp = dvTel.spec, spc = dvTel.split ? TB.amber : TB.phos;
    mgraphics.set_line_width(1);
    dvColor(TB.amberDim, 0.6); mgraphics.move_to(S[0], S[1] - 2.5); mgraphics.line_to(S[0] + S[2], S[1] - 2.5); mgraphics.stroke();
    var base = S[1] + S[3], pts = [[S[0], base]];
    for (i = 0; i < 32; i++) {
        var db = sp && sp.length > i ? dvNum(sp[i], -100) : -100;
        pts.push([S[0] + S[2] * (i + 0.5) / 32, base - dvClamp((db + 80) / 75, 0, 1) * S[3]]);
    }
    pts.push([S[0] + S[2], base]);
    dvColor(spc, 0.16); dvPoly(pts, true); mgraphics.fill();
    dvColor(spc, 0.85); dvPoly(pts.slice(1, 33), false); mgraphics.stroke();

    // corner lamps T / B / L
    tbLamp(P[0] + 7, P[1] + 7, dvTel.pk.t, TB.t, "T", P[0] + 13);
    tbLamp(P[0] + P[2] - 7, P[1] + 7, dvTel.pk.b, TB.b, "B", P[0] + P[2] - 21);
    tbLamp(P[0] + 7, P[1] + P[3] - 7, dvTel.pk.l, TB.l, "L", P[0] + 13);
    // glass status text
    if (!gate) {
        dvPill(cx - 21, P[1] + 3, 42, 11, TB.coral, 0.85);
        dvText("HELD", cx - 11, P[1] + 11.5, 8, [0.1, 0.02, 0.02, 1], true);
    }
    dvDrawDspPill(P[0] + P[2] - 22, P[1] + 20, 7, { coral: TB.coral, amber: TB.amber });

    // LED bars: the current draw, tick = Value
    var B = TB_BAR;
    dvText("DRAW", B.x - 1, 15, 6.5, TB.amber, true, 0.9);
    for (i = 0; i < 8; i++) {
        var bx = B.x + i * B.pitch;
        dvColor(TB.amberDim, 0.35); mgraphics.rectangle(bx, B.y, B.w, B.h); mgraphics.fill();
    }
    for (i = 0; i < 8; i++) {
        var v = dvClamp(dvMetaValue(i) / 100, 0, 1), bxx = B.x + i * B.pitch, hh = B.h * v;
        if (hh > 0.5) {
            dvColor(gate ? TB.phos : TB.coral, gate ? 0.92 : 0.45);
            mgraphics.rectangle(bxx, B.y + B.h - hh, B.w, hh); mgraphics.fill();
            dvColor(TB.amber, gate ? 1 : 0.5);
            mgraphics.rectangle(bxx, B.y + B.h - hh, B.w, 1.5); mgraphics.fill();
        }
    }
    dvColor(TB.glass, 0.95);
    for (i = 1; i < 10; i++) mgraphics.rectangle(B.x - 0.5, B.y + B.h * i / 10 - 0.5, 8 * B.pitch, 1);
    mgraphics.fill();
    dvColor(TB.white, 0.85);
    for (i = 0; i < 8; i++) {
        var vn = dvNorm("v_" + DV_META_KEYS[i]);
        mgraphics.rectangle(B.x + i * B.pitch - 0.8, B.y + B.h * (1 - vn) - 0.5, B.w + 1.6, 1);
    }
    mgraphics.fill();
    dvText("CH " + Math.round(dvParam("chance", 100)), B.x - 1, 121, 6.5, TB.amber, false, 0.85);

    // bezel label ENV / SPEC
    var lab = dvTel.split ? "SPEC" : "ENV";
    mgraphics.set_line_width(1);
    dvColor(TB.amber, 0.9); mgraphics.rectangle_rounded(206, 131, 36, 17, 5, 5); mgraphics.stroke();
    dvColor(TB.amber, dvTel.split ? 0.35 : 0.12); mgraphics.rectangle_rounded(206, 131, 36, 17, 5, 5); mgraphics.fill();
    dvText(lab, 224 - dvTextW(lab, 8, true) / 2, 143, 8, TB.amber, true);
    dvText("SPLIT", 212, 156, 6, TB.amber, false, 0.6);
}
