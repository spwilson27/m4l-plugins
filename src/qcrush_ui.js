// Quefrency Crush view (v8ui). One script, three layouts: 0 = A (coefficient canvas hero),
// 1 = B (compact view beside an LCD matrix), 2 = C (Coeffs x Bits crush pad over the bars).
// scripts/build_qcrush.py prepends `var QC_LAYOUT_DEFAULT = <0|1|2>;`; `set_layout <n>` also works.
//
// Telemetry buffer #0-qcrushscope (written by src/qcrush_core.genexpr), 320 floats:
//   0..95 original cepstrum c[1..96], 96..191 crushed, 192 N, 193 K, 194 bits, 195 held, 196 clock phase,
//   197 tick counter, 198 shuffle roll, 199 level, 200 pitch quefrency, 201 confidence, 202 shifted pitch quefrency,
//   203 frame counter, 204 samplerate, 205 Qs, 206 scramble mode, 207 amount, 208 shift ratio, 209 neutral,
//   210..257 excitation strip original (48 bins, 1..25 ms), 258..305 crushed.
// Messages in: setbuffer <name>, set_layout, set_size <idx>, set_coeffs <pct>, set_bits, set_smode <0..3>,
//   set_samt <pct>, set_shift <st>, set_freeze <0|1>, set_hold <0..6>, set_mix <pct>, set_out <dB>.
// Messages out (outlet 0): ["coeffs", pct] and ["bits", n] from dragging in layouts A and C.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var QC_NC = 96;
var QC_NSTRIP = 48;
var QC_NENV = 72;
var QC_SCOPE_FLOATS = 320;
var SIZES = [512, 1024, 2048, 4096];
var HOLD_NAMES = ["Off", "1/32", "1/16", "1/8", "1/4", "1/2", "1 bar"];
var SCR_NAMES = ["Off", "REV", "SHUF", "ROT"];

var COL_BG = [0.043, 0.055, 0.075];
var COL_GRID = [0.16, 0.2, 0.26];
var COL_GHOST = [0.50, 0.58, 0.68];
var COL_POS = [1.0, 0.52, 0.36];
var COL_NEG = [0.30, 0.82, 0.88];
var COL_ENV = [1.0, 0.77, 0.30];
var COL_ICE = [0.62, 0.82, 1.0];
var COL_VIOLET = [0.74, 0.56, 1.0];
var COL_TEXT = [0.82, 0.87, 0.93];
var COL_DIM = [0.52, 0.60, 0.70];
var COL_PINK = [1.0, 0.42, 0.62];

var layout = (typeof QC_LAYOUT_DEFAULT !== "undefined") ? QC_LAYOUT_DEFAULT : 0;

// parameter mirrors (set by the patcher)
var curSize = 1;
var curCoeffs = 100;
var curBits = 16;
var curSmode = 0;
var curSamt = 50;
var curShift = 0;
var curFreeze = 0;
var curHold = 0;
var curMix = 100;
var curOut = 0;

// telemetry mirrors
var scopeBuf = null;
var scopeTask = null;
var haveTelemetry = false;
var cO = [];
var cC = [];
var exO = [];
var exC = [];
var envIn = [];
var envOut = [];
var tele = {
    n: 2048, k: 1024, bits: 16, held: 0, clock: 0, tick: 0, roll: 1, level: 0, q0: 401, conf: 0.8, q0s: 401,
    frame: 0, sr: 44100, qs: 88, smode: 0, samt: 0.5, rho: 1, neutral: 1,
};
var lastTick = -1;
var tickFlash = 0;
var lastRoll = -1;
var rollFlash = 0;
var uiSettled = false;
var animPhase = 0;
var demoFrozen = null;
var cosTab = null;
var cosTabSr = 0;
var dragging = false;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function sgn(v) { return v < 0 ? -1 : 1; }
function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// ----- numeric helpers shared with the DSP (same formulas as qcrush_core.genexpr) -----

function qsNow() { return clamp(Math.round((tele.sr > 1000 ? tele.sr : 44100) * 0.002), 16, 96); }

function kOfCf(cf, n) {
    cf = clamp(cf, 0, 1);
    var qs = qsNow();
    if (cf >= 0.995) return n / 2;
    return cf < 0.75 ? 2 * Math.pow(qs / 2, cf / 0.75) : qs + (n / 2 - qs) * (cf - 0.75) / 0.25;
}

function cfOfK(k, n) {
    var qs = qsNow();
    k = clamp(k, 2, n / 2);
    if (k <= qs) return 0.75 * Math.log(k / 2) / Math.log(qs / 2);
    return 0.75 + 0.25 * (k - qs) / (n / 2 - qs);
}

function quantStep(bits) { return 1.5 * Math.pow(2, -(bits - 1) * 0.75); }

// ----- demo state: a vowel-like cepstrum pushed through the current settings until telemetry arrives -----

function demoBase(seed) {
    var out = [];
    var M = 128;
    var forms = seed ? [[300, 90, 2.4], [2200, 160, 1.8], [3000, 200, 1.1]] : [[700, 110, 2.6], [1220, 130, 1.9], [2600, 180, 1.2]];
    var L = [];
    var k, q;
    for (k = 0; k <= M; k++) {
        var f = k / M * 22050;
        var v = -0.5 * Math.log(1 + f / 900);
        for (var i = 0; i < forms.length; i++) {
            var d = (f - forms[i][0]) / (forms[i][1] * 2.4);
            v += forms[i][2] * Math.exp(-d * d);
        }
        L.push(v);
    }
    for (q = 1; q <= QC_NC; q++) {
        var s = 0;
        for (k = 0; k <= M; k++) {
            var wgt = (k === 0 || k === M) ? 0.5 : 1;
            s += wgt * L[k] * Math.cos(Math.PI * q * k / M);
        }
        var dec = 1 / Math.pow(q, 0.62);
        var ripple = (seed ? -1 : 1) * 0.5 * dec * Math.cos(0.43 * q + 0.8 + seed) + 0.34 * dec * Math.sin(1.37 * q + 2 * seed);
        out.push(s / M * 3.2 + ripple);
    }
    return out;
}

function cumulativeStrip(q0, amp) {
    var out = [];
    var qlo = 44.1;
    var qhi = 1102.5;
    for (var b = 0; b < QC_NSTRIP; b++) {
        var qc = qlo * Math.pow(qhi / qlo, (b + 0.5) / QC_NSTRIP);
        var d = Math.log(qc / q0) / 0.035;
        var v = amp * Math.exp(-d * d);
        var d2 = Math.log(qc / (q0 * 2)) / 0.035;
        v += amp * 0.45 * Math.exp(-d2 * d2);
        out.push(v);
    }
    return out;
}

function quantize(v, bits) {
    if (bits >= 15.5) return v;
    var st = quantStep(bits);
    return Math.round(v / st) * st;
}

function crushList(src, frozenSrc, kq, bits, smode, samt, held, qsv) {
    var c = (held && frozenSrc) ? frozenSrc.slice() : src.slice();
    var rr = Math.max(2, Math.min(Math.floor(kq), Math.floor(qsv)));
    var q;
    if (smode > 0.5 && samt > 0.001) {
        var u = [];
        for (q = 1; q <= rr; q++) u[q] = c[q - 1] * q;
        var perm = [];
        for (q = 1; q <= rr; q++) perm[q] = q;
        if (smode > 1.5 && smode < 2.5) {
            for (var t = 0; t < rr - 1; t++) {
                var i = rr - t;
                var hv = Math.sin(i * 12.9898 + 77 * 78.233) * 43758.5453;
                var j = Math.min(1 + Math.floor((hv - Math.floor(hv)) * i), i);
                var tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
            }
        }
        for (q = 1; q <= rr; q++) {
            var u0 = u[q];
            var u1 = u0;
            if (smode < 1.5) u1 = u[rr + 1 - q];
            else if (smode < 2.5) u1 = u[perm[q]];
            else {
                var p0 = q - 1 - samt * rr * 0.5;
                p0 -= rr * Math.floor(p0 / rr);
                var i0 = Math.floor(p0) + 1;
                var fr = p0 - Math.floor(p0);
                var i1 = i0 + 1 > rr ? 1 : i0 + 1;
                u1 = u[i0] * (1 - fr) + u[i1] * fr;
            }
            if (smode < 2.5) u1 = u0 + (u1 - u0) * samt;
            c[q - 1] = u1 / q;
        }
    }
    var tw = Math.max(2, kq * 0.2);
    for (q = 1; q <= QC_NC; q++) {
        var g = 1;
        if (kq < 1e5) {
            g = 0;
            if (q <= kq) {
                g = 1;
                if (q > kq - tw) g = 0.5 + 0.5 * Math.cos(Math.PI * (q - (kq - tw)) / tw);
            }
        }
        c[q - 1] = quantize(c[q - 1] * g, bits);
    }
    return c;
}

function stripCrush(ex, kq, bits, rho, q0) {
    var out = [];
    var qlo = 44.1;
    var qhi = 1102.5;
    for (var b = 0; b < QC_NSTRIP; b++) {
        var qc = qlo * Math.pow(qhi / qlo, (b + 0.5) / QC_NSTRIP);
        var src = qc * rho;
        var pos = Math.log(src / qlo) / Math.log(qhi / qlo) * QC_NSTRIP - 0.5;
        var i0 = Math.floor(pos);
        var fr = pos - i0;
        var a = (i0 >= 0 && i0 < QC_NSTRIP) ? ex[i0] : 0;
        var bb = (i0 + 1 >= 0 && i0 + 1 < QC_NSTRIP) ? ex[i0 + 1] : 0;
        var v = a + (bb - a) * fr;
        if (qc > kq) v = 0;
        out.push(quantize(v, bits));
    }
    return out;
}

function rebuildDemo() {
    if (haveTelemetry) return;
    var n = SIZES[clamp(curSize, 0, 3)];
    var kq = kOfCf(curCoeffs / 100, n);
    if (kq >= n / 2 - 0.5) kq = 1e6;
    var base = demoBase(0);
    if (!demoFrozen) demoFrozen = demoBase(1);
    cO = base;
    var held = (curFreeze > 0.5 || curHold > 0.5) ? 1 : 0;
    cC = crushList(base, demoFrozen, kq, curBits, curSmode, curSamt / 100, held, 88);
    var rho = Math.pow(2, curShift / 12);
    exO = cumulativeStrip(401, 0.5);
    exC = stripCrush(exO, kq, curBits, rho, 401);
    tele.n = n;
    tele.k = Math.min(kq, n / 2);
    tele.bits = curBits;
    tele.held = held;
    tele.smode = curSmode;
    tele.samt = curSamt / 100;
    tele.rho = rho;
    tele.q0 = 401;
    tele.q0s = 401 / rho;
    tele.level = 0.3;
    tele.neutral = (kq > 1e5 && curBits >= 15.5 && curSmode < 0.5 && Math.abs(curShift) < 0.01 && !held) ? 1 : 0;
    updateEnvelopes();
}

// Spectral envelope shape (dB) on QC_NENV log-spaced frequencies from the first 96 cepstral coefficients.
function buildCosTab() {
    var sr = tele.sr > 1000 ? tele.sr : 44100;
    if (cosTab && cosTabSr === sr) return;
    cosTabSr = sr;
    cosTab = [];
    for (var b = 0; b < QC_NENV; b++) {
        var f = 70 * Math.pow(10000 / 70, b / (QC_NENV - 1));
        var row = [];
        for (var q = 1; q <= QC_NC; q++) row.push(Math.cos(2 * Math.PI * q * f / sr));
        cosTab.push(row);
    }
}

function envFrom(c) {
    var out = [];
    for (var b = 0; b < QC_NENV; b++) {
        var row = cosTab[b];
        var s = 0;
        for (var q = 0; q < QC_NC; q++) s += c[q] * row[q];
        out.push(2 * s * 8.685889);
    }
    return out;
}

function updateEnvelopes() {
    buildCosTab();
    envIn = envFrom(cO);
    envOut = envFrom(cC);
}

// ----- telemetry -----

function setbuffer(name) {
    if (!name) return;
    scopeBuf = new Buffer("" + name);
}

function sampleAt(chunk, idx) {
    if (typeof chunk === "number") return idx === 0 ? chunk : 0;
    if (!chunk || !chunk.length || idx >= chunk.length) return 0;
    var v = chunk[idx];
    return (v === v) ? v : 0;
}

function pullScope() {
    if (!scopeBuf) return;
    var ch = scopeBuf.peek(1, 0, QC_SCOPE_FLOATS);
    var level = sampleAt(ch, 199);
    var frame = sampleAt(ch, 203);
    // the clock phase and tick counter are written every sample, even asleep
    var tick = sampleAt(ch, 197);
    tele.clock = clamp(sampleAt(ch, 196), 0, 1);
    var silent = (level < 0.0003) && (!haveTelemetry || frame === tele.frame);
    if (tick !== lastTick) {
        if (lastTick >= 0) tickFlash = 1;
        lastTick = tick;
    }
    if (silent && uiSettled && tickFlash <= 0.02) return;
    if (frame > 0 && frame !== tele.frame) {
        haveTelemetry = true;
        var i;
        if (cO.length !== QC_NC || cC.length !== QC_NC || exO.length !== QC_NSTRIP) {
            cO = []; cC = []; exO = []; exC = [];
            for (i = 0; i < QC_NC; i++) { cO.push(0); cC.push(0); }
            for (i = 0; i < QC_NSTRIP; i++) { exO.push(0); exC.push(0); }
        }
        for (i = 0; i < QC_NC; i++) {
            cO[i] += (sampleAt(ch, i) - cO[i]) * 0.6;
            cC[i] += (sampleAt(ch, 96 + i) - cC[i]) * 0.6;
        }
        for (i = 0; i < QC_NSTRIP; i++) {
            exO[i] += (sampleAt(ch, 210 + i) - exO[i]) * 0.6;
            exC[i] += (sampleAt(ch, 258 + i) - exC[i]) * 0.6;
        }
        tele.n = sampleAt(ch, 192) || tele.n;
        tele.k = sampleAt(ch, 193) || tele.k;
        tele.bits = sampleAt(ch, 194) || 16;
        tele.held = sampleAt(ch, 195);
        tele.tick = tick;
        tele.roll = sampleAt(ch, 198);
        tele.level = level;
        tele.q0 = sampleAt(ch, 200);
        tele.conf = sampleAt(ch, 201);
        tele.q0s = sampleAt(ch, 202);
        tele.frame = frame;
        tele.sr = sampleAt(ch, 204) || 44100;
        tele.qs = sampleAt(ch, 205) || 88;
        tele.smode = sampleAt(ch, 206);
        tele.samt = sampleAt(ch, 207);
        tele.rho = sampleAt(ch, 208) || 1;
        tele.neutral = sampleAt(ch, 209);
        if (tele.roll !== lastRoll) {
            if (lastRoll >= 0 && tele.smode > 1.5 && tele.smode < 2.5) rollFlash = 1;
            lastRoll = tele.roll;
        }
        updateEnvelopes();
    }
    tele.level = level;
    if (level < 0.0003) {
        uiSettled = true;
    } else {
        uiSettled = false;
    }
    tickFlash *= 0.8;
    rollFlash *= 0.85;
    animPhase = (animPhase + 0.12) % (Math.PI * 2);
    mgraphics.redraw();
}

if (typeof Task !== "undefined") {
    scopeTask = new Task(pullScope, this);
    scopeTask.interval = 40;
    scopeTask.repeat();
}

// ----- parameter setters -----

function set_layout(v) { layout = clamp(Math.round(Number(v) || 0), 0, 3); mgraphics.redraw(); }
function set_size(v) { curSize = clamp(Math.round(Number(v)), 0, 3); rebuildDemo(); mgraphics.redraw(); }
function set_coeffs(v) { curCoeffs = clamp(Number(v), 0, 100); rebuildDemo(); mgraphics.redraw(); }
function set_bits(v) { curBits = clamp(Math.round(Number(v)), 1, 16); rebuildDemo(); mgraphics.redraw(); }
function set_smode(v) { curSmode = clamp(Math.round(Number(v)), 0, 3); rebuildDemo(); mgraphics.redraw(); }
function set_samt(v) { curSamt = clamp(Number(v), 0, 100); rebuildDemo(); mgraphics.redraw(); }
function set_shift(v) { curShift = clamp(Number(v), -12, 12); rebuildDemo(); mgraphics.redraw(); }
function set_freeze(v) { curFreeze = Number(v) > 0.5 ? 1 : 0; rebuildDemo(); mgraphics.redraw(); }
function set_hold(v) { curHold = clamp(Math.round(Number(v)), 0, 6); rebuildDemo(); mgraphics.redraw(); }
function set_mix(v) { curMix = clamp(Number(v), 0, 100); mgraphics.redraw(); }
function set_out(v) { curOut = clamp(Number(v), -36, 12); mgraphics.redraw(); }

// What the preview renderer shows (no audio there): the demo telemetry for the *current* control values.
// Control state (Size, Coeffs, Bits, Scramble, Shift, Hold, Freeze) is never faked, only the audio telemetry.
function preview() {
    haveTelemetry = false;
    tele.clock = 0.62;
    tickFlash = 0;
    rebuildDemo();
}

rebuildDemo();

// ----- drawing helpers -----

function rgba(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? 1 : a);
}

function frect(x, y, w, h, c, a) {
    if (w <= 0 || h <= 0) return;
    rgba(c, a);
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
}

function rrect(x, y, w, h, r, c, a) {
    rgba(c, a);
    mgraphics.rectangle_rounded(x, y, w, h, r, r);
    mgraphics.fill();
}

function srect(x, y, w, h, c, a, lw) {
    rgba(c, a);
    mgraphics.set_line_width(lw || 1);
    mgraphics.rectangle(x, y, w, h);
    mgraphics.stroke();
}

function hline(x0, x1, y, c, a, lw) {
    rgba(c, a);
    mgraphics.set_line_width(lw || 1);
    mgraphics.move_to(x0, y);
    mgraphics.line_to(x1, y);
    mgraphics.stroke();
}

function vline(x, y0, y1, c, a, lw) {
    rgba(c, a);
    mgraphics.set_line_width(lw || 1);
    mgraphics.move_to(x, y0);
    mgraphics.line_to(x, y1);
    mgraphics.stroke();
}

function tw(str, size) {
    return ("" + str).length * size * 0.58;
}

// align: 0 left, 1 center, 2 right
function label(str, x, y, size, c, a, align) {
    str = "" + str;
    var xx = x;
    if (align === 1) xx = x - tw(str, size) * 0.5;
    else if (align === 2) xx = x - tw(str, size);
    rgba(c, a);
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(size);
    mgraphics.move_to(xx, y);
    mgraphics.show_text(str);
}

function chip(x, y, str, c, on) {
    var w = tw(str, 8) + 8;
    rrect(x, y, w, 11, 3, c, on ? 0.9 : 0.16);
    if (!on) {
        rgba(c, 0.55);
        mgraphics.set_line_width(1);
        mgraphics.rectangle_rounded(x, y, w, 11, 3, 3);
        mgraphics.stroke();
    }
    label(str, x + 4, y + 8.6, 8, on ? COL_BG : c, on ? 1 : 0.9, 0);
    return w;
}

// Value -> -1..1 for the bars: companded so small coefficients stay visible.
function cmp(v) {
    return sgn(v) * Math.log(1 + Math.abs(v) * 5) / Math.log(1 + 5 * 1.7);
}

function regionRR() {
    return Math.max(2, Math.min(Math.floor(tele.k), Math.floor(tele.qs)));
}

function xOfK(k, x, w) {
    var pw = w * 0.9;
    if (k <= QC_NC) return x + (k - 0.5) / QC_NC * pw;
    return x + pw + Math.log(k / QC_NC) / Math.log(Math.max(tele.n * 0.5, 100) / QC_NC) * (w - pw);
}

function kOfX(px, x, w) {
    var pw = w * 0.9;
    var rel = px - x;
    if (rel <= pw) return clamp(rel / pw * QC_NC + 0.5, 2, QC_NC);
    var f = clamp((rel - pw) / (w - pw), 0, 1);
    return QC_NC * Math.pow(Math.max(tele.n * 0.5, 100) / QC_NC, f);
}

// ----- the three drawing blocks -----

// Cepstral coefficient bars: ghost = original, colored = crushed, quantizer ladder, K marker, state tints.
function drawBars(x, y, w, h, pad, noMarker) {
    var yb = y + h * 0.5;
    var amp = h * 0.5 - 2;
    var pw = pad ? w * 0.9 : w;
    var sw = (w * 0.9) / QC_NC;
    var held = tele.held > 0.5;
    var qsv = tele.qs;
    var rr = regionRR();
    var scrOn = tele.smode > 0.5 && tele.samt > 0.001;
    var q;
    frect(x, y, w, h, [0.03, 0.04, 0.055], 1);
    // held envelope region backdrop
    if (held) {
        frect(x, y, (Math.min(qsv * 1.25, QC_NC)) * sw, h, COL_ICE, 0.07);
    }
    // quantizer ladder
    if (tele.bits < 15.5) {
        var st = quantStep(tele.bits);
        for (var kk = 1; kk <= 8; kk++) {
            var ly = cmp(kk * st) * amp;
            if (ly > amp * 0.98) break;
            hline(x, x + w, yb - ly, COL_PINK, 0.16, 1);
            hline(x, x + w, yb + ly, COL_PINK, 0.16, 1);
        }
    }
    hline(x, x + w, yb, COL_GRID, 1, 1);
    // bars
    for (q = 1; q <= QC_NC; q++) {
        var bx = x + (q - 1) * sw;
        var vo = cmp(cO[q - 1]) * amp;
        var vc = cmp(cC[q - 1]) * amp;
        // ghost (original)
        if (Math.abs(vo) > 0.3) {
            frect(bx + 0.2, vo >= 0 ? yb - vo : yb, sw * 0.92, Math.abs(vo), COL_GHOST, 0.62);
        }
        // crushed: sign colors, pulled toward ice while the envelope is held and toward violet inside the scramble region
        var col = vc >= 0 ? COL_POS : COL_NEG;
        var a = 0.95;
        if (held && q <= qsv * 1.25) col = mixc(col, COL_ICE, 0.62);
        if (scrOn && q <= rr) col = mixc(col, COL_VIOLET, held ? 0.3 : 0.55);
        if (q > tele.k) a = 0.0;
        if (Math.abs(vc) > 0.3) {
            frect(bx + sw * 0.18, vc >= 0 ? yb - vc : yb, sw * 0.62, Math.abs(vc), col, a);
        } else if (q <= tele.k) {
            frect(bx + sw * 0.18, yb - 0.5, sw * 0.62, 1, col, 0.5);
        }
    }
    // K marker and the veil beyond it
    var xk = xOfK(tele.k, x, w);
    if (!noMarker && tele.k < tele.n * 0.5 - 0.5) {
        frect(xk, y, x + w - xk, h, COL_BG, 0.55);
        vline(xk, y, y + h, COL_PINK, 0.95, 1.4);
        mgraphics.set_source_rgba(COL_PINK[0], COL_PINK[1], COL_PINK[2], 0.95);
        mgraphics.move_to(xk - 3.5, y);
        mgraphics.line_to(xk + 3.5, y);
        mgraphics.line_to(xk, y + 5);
        mgraphics.close_path();
        mgraphics.fill();
    }
    // scramble bracket
    if (scrOn) {
        var xr = x + rr * sw;
        hline(x, xr, y + 2.5, COL_VIOLET, 0.9, 1.2);
        vline(x + 0.5, y + 2.5, y + 6, COL_VIOLET, 0.9, 1.2);
        vline(xr, y + 2.5, y + 6, COL_VIOLET, 0.9, 1.2);
        if (rollFlash > 0.05) frect(x, y, xr - x, h, COL_VIOLET, 0.16 * rollFlash);
    }
    // held bracket along the bottom of the envelope region, with a padlock
    if (held) {
        var xe = x + Math.min(qsv * 1.25, QC_NC) * sw;
        hline(x, xe, y + h - 2.5, COL_ICE, 0.9, 1.2);
        vline(x + 0.5, y + h - 6, y + h - 2.5, COL_ICE, 0.9, 1.2);
        vline(xe, y + h - 6, y + h - 2.5, COL_ICE, 0.9, 1.2);
        if (!noMarker) {
            rrect(x + 4, y + h - 13, 7, 5.5, 1.2, COL_ICE, 0.95);
            rgba(COL_ICE, 0.95);
            mgraphics.set_line_width(1.1);
            mgraphics.arc(x + 7.5, y + h - 13, 2.2, 0, 6.2832);
            mgraphics.stroke();
        }
    }
}

// Excitation lane: where the harmonic comb sits (original ghost, crushed colored), shifted by Shift.
function drawStrip(x, y, w, h) {
    frect(x, y, w, h, [0.03, 0.04, 0.055], 1);
    var bw = w / QC_NSTRIP;
    var mx = 0.0001;
    var b;
    for (b = 0; b < QC_NSTRIP; b++) mx = Math.max(mx, exO[b] || 0, exC[b] || 0);
    mx = Math.max(mx, 0.12);
    for (b = 0; b < QC_NSTRIP; b++) {
        var vo = clamp((exO[b] || 0) / mx, 0, 1) * (h - 2);
        var vc = clamp((exC[b] || 0) / mx, 0, 1) * (h - 2);
        if (vo > 0.4) frect(x + b * bw + 0.2, y + h - 1 - vo, bw * 0.9, vo, COL_GHOST, 0.4);
        if (vc > 0.4) frect(x + b * bw + bw * 0.18, y + h - 1 - vc, bw * 0.62, vc, tele.held > 0.5 ? COL_ICE : COL_ENV, 0.95);
    }
    hline(x, x + w, y + h - 0.5, COL_GRID, 1, 1);
}

// Spectral envelope overlay: input envelope (ghost, filled) vs the one rebuilt from the crushed coefficients.
function drawEnvelope(x, y, w, h) {
    frect(x, y, w, h, [0.03, 0.04, 0.055], 1);
    var i;
    var mean = 0;
    for (i = 0; i < QC_NENV; i++) mean += envIn[i];
    mean /= QC_NENV;
    var scale = (h - 4) / 56;
    var yc = y + h * 0.5;
    hline(x, x + w, yc, COL_GRID, 0.7, 1);
    var step = w / (QC_NENV - 1);
    // filled ghost
    rgba(COL_GHOST, 0.2);
    mgraphics.move_to(x, y + h);
    for (i = 0; i < QC_NENV; i++) mgraphics.line_to(x + i * step, clamp(yc - (envIn[i] - mean) * scale, y + 1, y + h - 1));
    mgraphics.line_to(x + w, y + h);
    mgraphics.close_path();
    mgraphics.fill();
    rgba(COL_GHOST, 0.9);
    mgraphics.set_line_width(1.1);
    mgraphics.move_to(x, clamp(yc - (envIn[0] - mean) * scale, y + 1, y + h - 1));
    for (i = 1; i < QC_NENV; i++) mgraphics.line_to(x + i * step, clamp(yc - (envIn[i] - mean) * scale, y + 1, y + h - 1));
    mgraphics.stroke();
    rgba(tele.held > 0.5 ? COL_ICE : COL_ENV, 1);
    mgraphics.set_line_width(1.6);
    mgraphics.move_to(x, clamp(yc - (envOut[0] - mean) * scale, y + 1, y + h - 1));
    for (i = 1; i < QC_NENV; i++) mgraphics.line_to(x + i * step, clamp(yc - (envOut[i] - mean) * scale, y + 1, y + h - 1));
    mgraphics.stroke();
}

// Hold clock: tick marks across the strip, a fill for the phase, a flash on each tick, ice tint while held.
function drawClock(x, y, w, h) {
    var rate = curHold;
    var held = tele.held > 0.5;
    var col = held ? COL_ICE : COL_DIM;
    rrect(x, y, w, h, 2, [0.05, 0.065, 0.09], 1);
    if (rate > 0.5 || curFreeze > 0.5) {
        var ph = curFreeze > 0.5 ? 1 : tele.clock;
        frect(x + 1, y + 1, (w - 2) * ph, h - 2, curFreeze > 0.5 ? COL_ICE : COL_ENV, curFreeze > 0.5 ? 0.35 : 0.5);
        if (tickFlash > 0.05) frect(x + 1, y + 1, w - 2, h - 2, COL_ICE, 0.45 * tickFlash);
    }
    var nt = 8;
    for (var i = 1; i < nt; i++) vline(x + w * i / nt, y + 2, y + h - 2, col, 0.35, 1);
    srect(x + 0.5, y + 0.5, w - 1, h - 1, col, 0.55, 1);
}

function statusChips(x, y, maxw) {
    var cx = x;
    var cy = y;
    var t;
    var kAll = curCoeffs >= 99.5;
    var kText = kAll ? "K ALL" : "K " + Math.round(tele.k);
    cx += chip(cx, cy, kText, COL_PINK, !kAll) + 3;
    var bText = Math.round(curBits) + " BIT";
    cx += chip(cx, cy, bText, COL_PINK, curBits < 15.5) + 3;
    var scrOn = curSmode > 0 && curSamt > 0.05;
    t = scrOn ? SCR_NAMES[clamp(Math.round(curSmode), 0, 3)] + " " + Math.round(curSamt) : "SCR OFF";
    if (cx + tw(t, 8) + 8 < x + maxw) cx += chip(cx, cy, t, COL_VIOLET, scrOn) + 3;
    var st = Math.round(curShift);
    var shOn = Math.abs(curShift) > 0.05;
    t = (st > 0 ? "+" : "") + st + " ST";
    if (cx + tw(t, 8) + 8 < x + maxw) cx += chip(cx, cy, t, COL_ENV, shOn) + 3;
    if (tele.held > 0.5) {
        t = curFreeze > 0.5 ? "FROZEN" : "HOLD " + HOLD_NAMES[curHold];
        if (cx + tw(t, 8) + 8 < x + maxw) cx += chip(cx, cy, t, COL_ICE, true) + 3;
    }
    return cx;
}

function pitchText() {
    if (tele.q0 > 8 && tele.conf > 0.05 && tele.sr > 1000) {
        var f0 = tele.sr / tele.q0;
        var f1 = tele.sr / Math.max(tele.q0s, 1);
        if (Math.abs(tele.rho - 1) > 0.001) return "f0 " + Math.round(f0) + " > " + Math.round(f1) + " Hz";
        return "f0 " + Math.round(f0) + " Hz";
    }
    return "f0 --";
}

// ----- layouts -----

function paintA(w, h) {
    // chips row
    statusChips(2, 1, w - 86);
    label(pitchText(), w - 3, 9.6, 8.5, COL_ENV, 0.95, 2);
    // bars (hero)
    var by = 14;
    var bh = 64;
    drawBars(0, by, w, bh, true);
    // lane labels and hold clock
    drawStrip(0, by + bh + 3, w - 74, 12);
    label("EXC", 3, by + bh + 12, 7, COL_DIM, 0.8, 0);
    drawClock(w - 70, by + bh + 3, 70, 12);
    label(curFreeze > 0.5 ? "FREEZE" : (curHold > 0.5 ? HOLD_NAMES[curHold] : "HOLD"), w - 35, by + bh + 12, 7.5, curHold > 0.5 || curFreeze > 0.5 ? COL_TEXT : COL_DIM, 0.95, 1);
    // envelope
    var ey = by + bh + 18;
    drawEnvelope(0, ey, w, h - ey);
    label("ENV", 3, ey + 9, 7, COL_DIM, 0.85, 0);
    label("in", w - 36, ey + 9, 7, COL_GHOST, 0.95, 0);
    label("out", w - 18, ey + 9, 7, tele.held > 0.5 ? COL_ICE : COL_ENV, 1, 0);
}

function paintB(w, h) {
    statusChips(1, 1, w - 2);
    drawBars(0, 14, w, 52, true);
    drawStrip(0, 68, w, 10);
    drawEnvelope(0, 80, w, 38);
    label("ENV", 3, 89, 7, COL_DIM, 0.85, 0);
    label("in", w - 36, 89, 7, COL_GHOST, 0.95, 0);
    label("out", w - 18, 89, 7, tele.held > 0.5 ? COL_ICE : COL_ENV, 1, 0);
    // footer: hold clock + pitch
    drawClock(0, 121, w * 0.5, 12);
    label(curFreeze > 0.5 ? "FROZEN" : (curHold > 0.5 ? "HOLD " + HOLD_NAMES[curHold] : "HOLD OFF"), 4, 130, 7.5, curHold > 0.5 || curFreeze > 0.5 ? COL_TEXT : COL_DIM, 0.95, 0);
    label(pitchText(), w - 2, 130, 8.5, COL_ENV, 0.95, 2);
}

function padRect(w, h) {
    return { x: 0, y: 0, w: w, h: h };
}

function paintC(w, h) {
    var r = padRect(w, h);
    // bars as the pad backdrop
    drawBars(0, 0, w, h, true, true);
    // pad grid: bits on the vertical axis (16 at the top, 1 at the bottom)
    for (var g = 1; g < 4; g++) hline(0, w, h * g / 4, COL_TEXT, 0.05, 1);
    for (var g2 = 1; g2 < 4; g2++) vline(w * g2 / 4, 0, h, COL_TEXT, 0.05, 1);
    // puck: x = Coeffs, y = Bits
    var px = clamp(curCoeffs / 100, 0, 1) * (w - 12) + 6;
    var py = (1 - (curBits - 1) / 15) * (h - 12) + 6;
    hline(0, w, py, COL_PINK, 0.35, 1);
    vline(px, 0, h, COL_PINK, 0.35, 1);
    rgba(COL_BG, 0.9);
    mgraphics.arc(px, py, 6.5, 0, 6.2832);
    mgraphics.fill();
    rgba(COL_PINK, 1);
    mgraphics.set_line_width(2);
    mgraphics.arc(px, py, 6, 0, 6.2832);
    mgraphics.stroke();
    mgraphics.arc(px, py, 1.6, 0, 6.2832);
    mgraphics.fill();
    // axis labels
    label("COEFFS >", w - 4, h - 4, 7.5, COL_TEXT, 0.7, 2);
    label("BITS", 4, 10, 7.5, COL_TEXT, 0.7, 0);
    label("16", 4, 20, 7, COL_DIM, 0.9, 0);
    label("1", 4, h - 14, 7, COL_DIM, 0.9, 0);
    var kt = curCoeffs >= 99.5 ? "K all" : "K " + Math.round(tele.k);
    var padTxt = kt + "  " + Math.round(curBits) + " bit";
    if (px > w * 0.55) label(padTxt, px - 10, Math.max(py + 3, 22), 8, COL_PINK, 1, 2);
    else label(padTxt, px + 10, Math.max(py + 3, 22), 8, COL_PINK, 1, 0);
    // hold clock along the top edge
    drawClock(w - 62, 2, 60, 9);
    label(pitchText(), 22, h - 4, 8, COL_ENV, 0.95, 0);
    // envelope mini-curves along the bottom third, behind the label row
}

function snowflake(cx, cy, r, c, a, lw) {
    rgba(c, a);
    mgraphics.set_line_width(lw);
    for (var i = 0; i < 3; i++) {
        var an = i * Math.PI / 3;
        var dx = Math.cos(an) * r;
        var dy = Math.sin(an) * r;
        mgraphics.move_to(cx - dx, cy - dy);
        mgraphics.line_to(cx + dx, cy + dy);
        for (var sgn = -1; sgn <= 1; sgn += 2) {
            var bx = cx + dx * 0.62 * sgn;
            var by = cy + dy * 0.62 * sgn;
            for (var sd = -1; sd <= 1; sd += 2) {
                var ba = an + (sgn < 0 ? Math.PI : 0) + sd * 0.75;
                mgraphics.move_to(bx, by);
                mgraphics.line_to(bx + Math.cos(ba) * r * 0.3, by + Math.sin(ba) * r * 0.3);
            }
        }
    }
    mgraphics.stroke();
}

// Layout 3: the Freeze pad face above the Freeze button. Idle: snowflake + hint. Frozen: ice fill, held envelope bars.
function paintFreeze(w, h) {
    var on = curFreeze > 0.5;
    rrect(0, 0, w, h, 5, on ? [0.10, 0.17, 0.26] : [0.055, 0.07, 0.095], 1);
    if (on) {
        // frozen envelope coefficient bars behind the icon
        var nb = 24;
        var bw = (w - 8) / nb;
        for (var i = 0; i < nb; i++) {
            var qi = Math.min(QC_NC - 1, Math.floor(i * QC_NC / nb * 0.5));
            var v = Math.abs(cmp(cC.length > qi ? cC[qi] : 0));
            var bh = Math.max(2, v * (h - 22));
            frect(4 + i * bw + 0.5, h - 4 - bh, bw - 1.5, bh, COL_ICE, 0.35);
        }
    }
    snowflake(w * 0.5, h * 0.4, on ? 17 : 15, COL_ICE, on ? 1 : 0.55, on ? 2 : 1.5);
    label(on ? "FROZEN" : "FREEZE", w * 0.5, h - 15, 8.5, on ? COL_TEXT : COL_ICE, on ? 1 : 0.75, 1);
    label(on ? "click to release" : "click to hold", w * 0.5, h - 5, 6.5, COL_DIM, 0.9, 1);
    srect(0.5, 0.5, w - 1, h - 1, COL_ICE, on ? 1 : 0.45, on ? 1.6 : 1);
}

function paint() {
    var sz = mgraphics.size;
    var w = sz[0];
    var h = sz[1];
    frect(0, 0, w, h, COL_BG, 1);
    if (layout === 3) paintFreeze(w, h);
    else if (layout === 1) paintB(w, h);
    else if (layout === 2) paintC(w, h);
    else paintA(w, h);
}

// ----- interaction -----

function barsRect() {
    var sz = mgraphics.size;
    if (layout === 0) return { x: 0, y: 14, w: sz[0], h: 64 };
    return null;
}

function applyDragA(px) {
    var r = barsRect();
    var k = kOfX(px, r.x, r.w);
    var cf = cfOfK(k, tele.n);
    // the right 10 % zone reaches K = N/2 (Coeffs 100 %)
    var pct = px >= r.x + r.w * 0.995 ? 100 : Math.round(cf * 1000) / 10;
    curCoeffs = pct;
    outlet(0, "coeffs", pct);
    rebuildDemo();
    mgraphics.redraw();
}

function applyDragC(px, py) {
    var sz = mgraphics.size;
    var cf = clamp((px - 6) / (sz[0] - 12), 0, 1);
    var bt = clamp(Math.round((1 - (py - 6) / (sz[1] - 12)) * 15 + 1), 1, 16);
    curCoeffs = Math.round(cf * 1000) / 10;
    curBits = bt;
    outlet(0, "coeffs", curCoeffs);
    outlet(0, "bits", bt);
    rebuildDemo();
    mgraphics.redraw();
}

function onclick(x, y) {
    if (layout === 3) {
        outlet(0, "freeze", curFreeze > 0.5 ? 0 : 1);
        return;
    }
    if (layout === 0) {
        var r = barsRect();
        if (y >= r.y && y <= r.y + r.h) { dragging = true; applyDragA(x); }
    } else if (layout === 2) {
        dragging = true;
        applyDragC(x, y);
    }
}

function ondrag(x, y, but) {
    if (!dragging) return;
    if (!but) { dragging = false; return; }
    if (layout === 0) applyDragA(x);
    else if (layout === 2) applyDragC(x, y);
}

function ondblclick(x, y) {
    if (layout === 0 || layout === 2) {
        curCoeffs = 100;
        outlet(0, "coeffs", 100);
        if (layout === 2) {
            curBits = 16;
            outlet(0, "bits", 16);
        }
        rebuildDemo();
        mgraphics.redraw();
    }
}

function onidle() {}
function onidleout() {}
