// Deviate Roulette face. One 194 x 157 canvas: a casino wheel (the 8 metas are the 8 spokes of a radar), a legend column on the right.
// Click = manual hit. Outer to inner: 32 studs (output spectrum), the pocket ring (spins on a hit, the ball lands in pocket drawSerial mod 8,
// that pocket is dark "0" when Chance rejected the hit), three rim rings (transient / body / long peaks), the radar (the draw, tweened 120 ms,
// Value polygon, Range bands, brass pins on locked spokes) and the hub (halo = the Ring envelope).

var RL = {
    felt: [0.035, 0.13, 0.085, 1], felt2: [0.02, 0.085, 0.055, 1], ivory: [0.95, 0.92, 0.82, 1], brass: [0.86, 0.68, 0.28, 1],
    red: [0.80, 0.14, 0.16, 1], black: [0.06, 0.06, 0.07, 1], dim: [0.45, 0.58, 0.50, 1], t: [0.97, 0.38, 0.30, 1], b: [0.95, 0.92, 0.82, 1],
    l: [0.50, 0.88, 0.66, 1], zero: [0.01, 0.02, 0.02, 1],
};
var RL_CX = 76, RL_CY = 79;
var RL_NAMES = ["SNAP", "PITCH", "BODY", "MOTION", "SPACE", "ECHO", "GRIT", "RING"];
var PAINT_REGIONS = [[0, 0, 194, 157]];
var hitZones = [[0, 0, 194, 157]];

var rlPreview = false, rlClock = 1000000;
var rlTo = null, rlFrom = null, rlT0 = 0;
var rlBase = 0, rlSpinT0 = -1e9, rlFlash = 0;

dvPoll(30);
dvNeed({ spec: true });

function rlNow() { return rlPreview ? rlClock : Date.now(); }
function rlCurMetas() {
    var o = [], i;
    for (i = 0; i < 8; i++) o.push(dvClamp(dvNum(dvMetaValue(i)), 0, 100));
    return o;
}
/** the tweened radar values (0..100) */
function rlShown() {
    var i, out = [], f;
    if (!rlTo) rlTo = rlCurMetas();
    if (!rlFrom) rlFrom = rlTo.slice();
    f = dvClamp((rlNow() - rlT0) / 120, 0, 1);
    for (i = 0; i < 8; i++) out.push(rlFrom[i] + (rlTo[i] - rlFrom[i]) * f);
    return out;
}
function rlWheelAt(t) { return 10 * 0.5 * (1 - Math.exp(-Math.max(0, t) / 500)); }
function rlWheel(now) { return rlBase + rlWheelAt(Math.min(now - rlSpinT0, 4000)); }
/** an angle wrapped into [0, 2 pi) */
function rlWrap(a) { var t = Math.PI * 2; return a - Math.floor(a / t) * t; }
/** the Range band: draws are uniform in Value +- Range, clamped to 0..1 */
function rlBand(v, rg) { return [Math.max(0, v - rg), Math.min(1, v + rg)]; }
/** true once a hit has happened (a rejected hit still counts: its pocket is the dark zero) */
function rlHadHit(hits, serial, spinT0) { return hits > 0 || serial > 0 || spinT0 > -1e8; }
/** the DSP pill rectangle: the free bottom-right corner under the legend, clear of the wheel disc */
function rlPillRect(W, H, textW) { var w = textW + 10; return [W - 2 - w, H - 13, w, 12]; }
function rlPillText() { return dvState.dsp.ready ? "" : (dvState.dsp.error ? "DSP failed" : "DSP loading..."); }

function onFrame(t) {
    var now = rlNow(), cur = rlCurMetas(), i, changed = false;
    if (!rlTo) { rlTo = cur; rlFrom = cur.slice(); }
    for (i = 0; i < 8; i++) if (Math.abs(cur[i] - rlTo[i]) > 0.01) changed = true;
    if (changed) { rlFrom = rlShown(); rlTo = cur; rlT0 = now; dvAnimate(160); }
    if (t.hitNew) {
        rlBase = rlWrap(rlWheel(now));
        rlSpinT0 = now;
        rlFlash = 1;
        dvAnimate(2600);
    } else rlFlash = Math.max(0, rlFlash - 0.1);
    return true;
}

function onclick() { dvManualHit(); }

function preview() {
    var st = dvPreviewBase(), k = st.kind, i;
    rlPreview = true;
    rlTo = rlCurMetas();
    rlFrom = rlTo.slice();
    rlT0 = rlClock - 500;
    rlBase = 0.4;
    rlSpinT0 = -1e9;
    rlFlash = 0;
    if (k === "hit") { rlSpinT0 = rlClock - 260; rlFlash = 0.8; rlFrom = rlTo.map(function (v, j) { return v * 0.75 + (j % 2) * 8; }); rlT0 = rlClock - 70; }
    if (k === "extreme") { rlSpinT0 = rlClock - 700; rlFlash = 0.3; }
    for (i = 0; i < 8; i++) if (k === "extreme") dvP["l_" + DV_META_KEYS[i]] = i % 3 === 0 ? 1 : 0;
    if (k === "hit") { dvP.l_pitch = 1; dvP.l_space = 1; }
}

function rlPt(a, r) { return [RL_CX + Math.cos(a) * r, RL_CY + Math.sin(a) * r]; }
function rlFill(c, a) { dvColor(c, a); mgraphics.fill(); }
function rlLevel(p) { return Math.sqrt(dvClamp(dvNum(p), 0, 1)); }

function paint() {
    var W = mgraphics.size[0], H = mgraphics.size[1], i, a, now = rlNow(), g = dvTel.gate ? 1 : 0;
    var wheel = rlWheel(now), tSpin = now - rlSpinT0, pk = dvTel.pk, metas = rlShown();
    var serial = dvTel.serial > 0 ? dvTel.serial : 0, pocket = ((serial % 8) + 8) % 8;
    var pal = RL, hadHit = rlHadHit(dvTel.hits, dvTel.serial, rlSpinT0);

    // background disc
    dvColor(pal.felt);
    mgraphics.rectangle(0, 0, W, H); mgraphics.fill();
    dvColor(pal.felt2); dvCircle(RL_CX, RL_CY, 75); mgraphics.fill();
    dvColor(pal.brass, 0.9); dvCircle(RL_CX, RL_CY, 75); mgraphics.set_line_width(1.2); mgraphics.stroke();
    if (rlFlash > 0.02) { dvColor(pal.ivory, 0.22 * rlFlash); dvCircle(RL_CX, RL_CY, 75); mgraphics.fill(); }

    // 32 rim studs = output spectrum
    var sp = dvTel.spec, lit = [], lv;
    dvColor(pal.brass, 0.35);
    for (i = 0; i < 32; i++) {
        a = -Math.PI / 2 + (i + 0.5) * Math.PI / 16;
        lv = sp ? dvClamp((dvNum(sp[i], -100) + 80) / 80, 0, 1) : 0;
        var p = rlPt(a, 71.5);
        dvCircle(p[0], p[1], 1.2);
        if (lv > 0.05) lit.push([p[0], p[1], lv]);
    }
    mgraphics.fill();
    dvColor(pal.ivory, 0.95);
    for (i = 0; i < lit.length; i++) dvCircle(lit[i][0], lit[i][1], 1.3 + 1.7 * lit[i][2]);
    mgraphics.fill();

    // pocket ring (rotates)
    for (i = 0; i < 8; i++) {
        var a0 = wheel + i * Math.PI / 4 - Math.PI / 2, zero = (hadHit && g === 0 && i === pocket);
        dvRingSeg(RL_CX, RL_CY, 57, 66, a0, a0 + Math.PI / 4 - 0.04, 3);
        dvColor(zero ? pal.zero : (i % 2 ? pal.black : pal.red), 1);
        mgraphics.fill();
        if (zero) {
            var zp = rlPt(a0 + Math.PI / 8, 61.5);
            dvText("0", zp[0] - 2, zp[1] + 3, 8, pal.ivory, true);
        }
    }
    dvColor(pal.brass, 0.8); dvCircle(RL_CX, RL_CY, 56.5); mgraphics.set_line_width(0.8); mgraphics.stroke();

    // rim rings: transient / body / long peaks
    var rings = [[pk.t, pal.t, 53], [pk.b, pal.b, 49.5], [pk.l, pal.l, 46]], r;
    for (i = 0; i < 3; i++) {
        r = rings[i];
        dvColor(pal.dim, 0.35); dvCircle(RL_CX, RL_CY, r[2] - 1.4); mgraphics.set_line_width(2.6); mgraphics.stroke();
        var sw = rlLevel(r[0]) * Math.PI * 2 * 0.98;
        if (sw > 0.05) { dvRingSeg(RL_CX, RL_CY, r[2] - 2.7, r[2], -Math.PI / 2, -Math.PI / 2 + sw, Math.ceil(sw / 0.4)); rlFill(r[1], 0.95); }
    }

    // radar: grid
    var RM = 42, RH = 9;
    function rad(n) { return RH + n * (RM - RH); }
    dvColor(pal.dim, 0.22); dvCircle(RL_CX, RL_CY, rad(1)); mgraphics.set_line_width(0.6); mgraphics.stroke();
    dvCircle(RL_CX, RL_CY, rad(0.5)); mgraphics.stroke();
    for (i = 0; i < 8; i++) { a = -Math.PI / 2 + i * Math.PI / 4; var q0 = rlPt(a, RH), q1 = rlPt(a, RM); mgraphics.move_to(q0[0], q0[1]); mgraphics.line_to(q1[0], q1[1]); }
    mgraphics.stroke();

    // Range annulus bands around each Value
    var vpts = [], dpts = [], key, v, rg, lo, hi;
    for (i = 0; i < 8; i++) {
        key = DV_META_KEYS[i];
        v = dvNorm("v_" + key); rg = dvNorm("r_" + key);
        a = -Math.PI / 2 + i * Math.PI / 4;
        lo = rlBand(v, rg)[0]; hi = rlBand(v, rg)[1];
        if (hi - lo > 0.005) { dvRingSeg(RL_CX, RL_CY, rad(lo), rad(hi), a - 0.2, a + 0.2, 2); rlFill(pal.brass, 0.28); }
        vpts.push(rlPt(a, rad(v)));
        dpts.push(rlPt(a, rad(metas[i] / 100)));
    }
    // Value polygon (brass outline)
    dvPoly(vpts, true); dvColor(pal.brass, 0.9); mgraphics.set_line_width(1); mgraphics.stroke();
    // the current draw (tweened)
    dvPoly(dpts, true); rlFill(g ? pal.ivory : pal.dim, g ? 0.22 : 0.14);
    dvPoly(dpts, true); dvColor(g ? pal.ivory : pal.dim, g ? 0.95 : 0.6); mgraphics.set_line_width(1.2); mgraphics.stroke();
    // target dots (the new draw), Value dots and pins
    for (i = 0; i < 8; i++) {
        a = -Math.PI / 2 + i * Math.PI / 4;
        var tp = rlPt(a, rad(rlTo ? rlTo[i] / 100 : 0));
        dvColor(g ? pal.red : pal.dim, 1); dvCircle(tp[0], tp[1], 2.4); mgraphics.fill();
        if (dvParam("l_" + DV_META_KEYS[i]) > 0.5) {
            var o = rlPt(a, RM + 1.5), o2 = rlPt(a, RM + 5);
            dvColor(pal.brass, 1); mgraphics.move_to(o[0], o[1]); mgraphics.line_to(o2[0], o2[1]); mgraphics.set_line_width(1.4); mgraphics.stroke();
            dvCircle(o2[0], o2[1], 2); mgraphics.fill();
        }
    }

    // hub: halo = ring envelope, Ring meta thickens the brass cap
    var env = dvClamp(dvTel.ringEnv, 0, 1), rm = dvClamp(dvTel.ring, 0, 1);
    dvColor(g ? pal.l : pal.red, 0.12 + 0.55 * env); dvCircle(RL_CX, RL_CY, RH - 1 + 3 * env + 3 * rm); mgraphics.fill();
    dvColor(pal.brass, 1); dvCircle(RL_CX, RL_CY, 4 + 2 * rm); mgraphics.fill();
    dvColor(pal.felt2, 1); dvCircle(RL_CX, RL_CY, 1.6); mgraphics.fill();

    // ball: spirals in and rests in the pocket drawSerial mod 8
    var pa = wheel + pocket * Math.PI / 4 - Math.PI / 2 + Math.PI / 8;
    var u = Math.exp(-Math.min(Math.max(tSpin, 0), 3000) / 450);
    var ba = pa - 14 * (tSpin < 3000 ? u : 0), br = 61.5 + 7 * (tSpin < 3000 ? u : 0);
    var bp = rlPt(ba, br);
    dvColor(pal.ivory, 1); dvCircle(bp[0], bp[1], 2.6); mgraphics.fill();
    dvColor(pal.black, 0.5); dvCircle(bp[0], bp[1], 2.6); mgraphics.set_line_width(0.6); mgraphics.stroke();

    // legend column: draw per meta
    var lx = 154, head = !hadHit ? "READY" : (g ? "DRAW" : "ZERO");
    dvText(head, lx, 19, 8, !hadHit ? pal.dim : (g ? pal.ivory : pal.red), true);
    if (dvTel.src) dvText("MIDI", lx + dvTextW(head, 8, true) + 4, 19, 6.5, pal.dim, true);
    for (i = 0; i < 8; i++) {
        var ly = 28 + i * 14, m = metas[i] / 100;
        dvText(RL_NAMES[i], lx, ly + 7, 7.5, pal.dim, true);
        dvColor(pal.black, 0.7); mgraphics.rectangle(lx, ly + 9, 38, 2.4); mgraphics.fill();
        dvColor(g ? pal.brass : pal.dim, 1); mgraphics.rectangle(lx, ly + 9, Math.max(1, 38 * m), 2.4); mgraphics.fill();
    }
    var pt = rlPillText();
    if (pt) {
        var pr = rlPillRect(W, H, dvTextW(pt, 7, true));
        dvPill(pr[0], pr[1], pr[2], pr[3], dvState.dsp.error ? DVC.coral : DVC.amber, 0.9);
        dvText(pt, pr[0] + 5, pr[1] + 9, 7, [0.08, 0.08, 0.08, 1], true);
    }
}
