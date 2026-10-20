// Timbre Follower — audio-reactive v8ui for all three layouts (A / B / C).
// The build script prepends `var TIMBRE_LAYOUT = "a" | "b" | "c";`, so the same script, the same DSP and the
// same parameters serve three canvases:
//   a  heatmap hero : scrolling MFCC fingerprint on top, mapped-target chips, novelty + output strip below
//   b  utility      : a small Envelope-Follower style trace (novelty ghost, output fill) with a 1 px timbre strip
//   c  performance  : one big novelty curve with a draggable threshold, trigger flashes, thin fingerprint strip
// Telemetry (src/timbre_core.genexpr): Buffer `#0-timbrescope`, 2064 floats, written by gen, read here every 33 ms.
//   header: 0 hop counter  1 head column  2 gate  3 threshold  4 control  5 novelty  6 samplerate  7 mode
//           8 trigger count  9 idle (analysis asleep)  10 level dB
//   column j (0..127) at 16 + 16 j: c1..c13, novelty, control, trigger flag.
// Redraws only when a new hop arrived, a flash is fading or the pointer changed something: silence and idle cost nothing.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var LAYOUT = (typeof TIMBRE_LAYOUT !== "undefined") ? String(TIMBRE_LAYOUT) : "a";

// Shared constants (tests/test_timbre.js checks them against src/timbre_ref.js)
var TIMBRE_THR_BASE = 0.02;
var TIMBRE_THR_SPAN = 0.6;
var TIMBRE_NC = 13;
var TIMBRE_COLS = 128;        // telemetry columns
var TIMBRE_HDR = 16;
var TIMBRE_BUF_LEN = 16 + 128 * 16;
var TIMBRE_HOP_MS_DEFAULT = 5.8;

var NCOL = 128;               // display columns
var DEC = 3;                  // hops merged into one display column (about 17 ms)

// Palette
var C_BG = [0.040, 0.044, 0.072];
var C_NOV = [0.93, 0.36, 0.72];
var C_THR = [1.0, 0.72, 0.22];
var C_ENV = [0.36, 0.90, 0.95];
var C_SLOT = [[0.42, 0.95, 0.68], [1.0, 0.52, 0.48]];
var C_TXT = [0.80, 0.84, 0.92];
var C_DIM = [0.46, 0.50, 0.60];

// Parameters mirrored from the Live controls
var curSens = 50;
var curAttack = 8;
var curRelease = 250;
var curFocus = 0;
var curMode = 0;
var viewMode = 0;             // 0 fingerprint, 1 deviation from the recent average (saved in the Set)

var slotNames = ["", ""];
var slotMapped = [0, 0];
var slotsLive = false;

// Display history (oldest first)
var dMfcc = [];
var dNov = [];
var dCtl = [];
var dTrg = [];
var demoActive = true;
var scopeBufName = "";
var lastCounter = -1;
var lastIdle = -1;
var lastTrigCount = -1;
var flashT0 = 0;
var accN = 0;
var accM = [];
var accNov = 0;
var accCtl = 0;
var accTrg = 0;
var levelDb = -200;
var gateOpen = 0;
var needRedraw = false;
var isDeleted = false;

var dragThr = false;
var hoverThr = false;
var lastClickT = 0;

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function resetAcc() {
    accN = 0;
    accM = [];
    for (var k = 0; k < TIMBRE_NC; k++) accM.push(0);
    accNov = 0;
    accCtl = 0;
    accTrg = 0;
}

function emptyHistory() {
    dMfcc = [];
    dNov = [];
    dCtl = [];
    dTrg = [];
    for (var i = 0; i < NCOL; i++) {
        var z = [];
        for (var k = 0; k < TIMBRE_NC; k++) z.push(0);
        dMfcc.push(z);
        dNov.push(0);
        dCtl.push(0);
        dTrg.push(0);
    }
    resetAcc();
}

// ---------------------------------------------------------------------------------------------
// Threshold <-> Sens (same law as the gen core: thr = 0.02 + 0.6 * (1 - Sens / 100))
// ---------------------------------------------------------------------------------------------
function sensToThr(s) {
    return TIMBRE_THR_BASE + TIMBRE_THR_SPAN * (1 - clamp(s, 0, 100) * 0.01);
}

function thrToSens(t) {
    return clamp((1 - (t - TIMBRE_THR_BASE) / TIMBRE_THR_SPAN) * 100, 0, 100);
}

// ---------------------------------------------------------------------------------------------
// Demo state (preview and first moments in Live, until real telemetry arrives)
// ---------------------------------------------------------------------------------------------
var DEMO_PROTOS = {
    sine: [7.5, 7.2, 6.6, 5.9, 5.0, 4.1, 3.1, 2.1, 1.3, 0.5, -0.1, -0.6, -0.9],
    saw: [-0.5, -5.6, -2.7, -2.9, -2.5, -1.4, 0.7, 2.5, 3.7, 3.6, 1.9, -1.2, -3.5],
    noise: [-0.2, -0.2, 0.0, -0.5, -0.8, -0.4, -0.3, 0.0, 0.1, -0.1, 0.4, 1.2, 0.5],
    square: [8.2, 0.4, 1.6, 1.3, 1.9, 2.1, 2.1, 1.3, 0.4, -0.8, -1.9, -2.8, -3.1],
    bass: [11.1, 1.9, 1.9, 0.8, 0.8, 0.5, 0.5, 0.3, 0.3, 0.2, 0.2, 0.2, 0.2]
};

function buildDemo() {
    var segs = [["sine", 28], ["saw", 26], ["noise", 32], ["square", 24], ["bass", 18]];
    var cols = [];
    var protoAt = [];
    for (var s = 0; s < segs.length; s++) {
        for (var n = 0; n < segs[s][1]; n++) protoAt.push(segs[s][0]);
    }
    while (protoAt.length < NCOL) protoAt.push("bass");
    // cross-fade over 4 columns at each boundary, small deterministic texture
    var smooth = [];
    for (var i = 0; i < NCOL; i++) {
        var v = [];
        for (var k = 0; k < TIMBRE_NC; k++) {
            var acc = 0;
            var wsum = 0;
            for (var d = -2; d <= 2; d++) {
                var j = clamp(i + d, 0, NCOL - 1);
                var w = 3 - Math.abs(d);
                acc += DEMO_PROTOS[protoAt[j]][k] * w;
                wsum += w;
            }
            var tex = 0.35 * Math.sin(i * 1.7 + k * 2.3) * (protoAt[i] === "noise" ? 1.6 : 0.6);
            v.push(acc / wsum + tex);
        }
        smooth.push(v);
    }
    emptyHistory();
    var hist = smooth[0].slice();
    var thr = sensToThr(curSens);
    var env = 0;
    var ca = 1 - Math.exp(-2.3 / Math.max(curAttack / 17.4, 0.5));
    var cr = 1 - Math.exp(-2.3 / Math.max(curRelease / 17.4, 1));
    var novs = [];
    for (var c = 0; c < NCOL; c++) {
        var sum = 0;
        for (var q = 0; q < TIMBRE_NC; q++) {
            var dl = smooth[c][q] - hist[q];
            sum += dl * dl / TIMBRE_NC;
            hist[q] += 0.16 * dl;
        }
        var dist = c < 3 ? 0 : Math.sqrt(sum);
        var nv = 1 - Math.exp(-Math.max(dist - 0.6, 0) / 1.3);
        novs.push(nv);
        var tgt = clamp((nv - thr) / (1 - thr), 0, 1);
        env += (tgt > env ? ca : cr) * (tgt - env);
        dMfcc[c] = smooth[c];
        dNov[c] = nv;
        dCtl[c] = env;
    }
    for (var p = 1; p < NCOL - 1; p++) {
        dTrg[p] = (novs[p] > thr && novs[p] >= novs[p - 1] && novs[p] > novs[p + 1]) ? 1 : 0;
    }
}

function preview() {
    demoActive = true;
    slotsLive = false;
    curMode = 0;
    buildDemo();
    flashT0 = 0;
}

// ---------------------------------------------------------------------------------------------
// Messages from the patcher
// ---------------------------------------------------------------------------------------------
function setbuffer(name) {
    scopeBufName = String(name || "");
}

function loadbang() {
    isDeleted = false;
    slotsLive = true;
    needRedraw = true;
    mgraphics.redraw();
}

function notifydeleted() {
    isDeleted = true;
    if (typeof pollTask !== "undefined" && pollTask) {
        try { pollTask.cancel(); } catch (err) {}
    }
}

function freebang() {
    notifydeleted();
}

function layout(l) {
    LAYOUT = String(l || "a");
    needRedraw = true;
    mgraphics.redraw();
}

function set_sens(v) {
    v = clamp(Number(v), 0, 100);
    if (v === curSens) return;
    curSens = v;
    needRedraw = true;
    mgraphics.redraw();
}

function set_attack(v) {
    curAttack = Number(v);
}

function set_release(v) {
    curRelease = Number(v);
}

function set_focus(v) {
    curFocus = Number(v);
    needRedraw = true;
    mgraphics.redraw();
}

function set_mode(v) {
    curMode = Number(v) > 0.5 ? 1 : 0;
    needRedraw = true;
    mgraphics.redraw();
}

function slot_name(n) {
    var args = Array.prototype.slice.call(arguments, 1);
    var idx = Math.round(Number(n)) - 1;
    if (idx < 0 || idx > 1) return;
    var nm = args.join(" ");
    slotNames[idx] = (nm === "Map" || nm === "") ? "" : nm;
    slotsLive = true;
    needRedraw = true;
    mgraphics.redraw();
}

function slot_mapped(n, flag) {
    var idx = Math.round(Number(n)) - 1;
    if (idx < 0 || idx > 1) return;
    slotMapped[idx] = Number(flag) > 0.5 ? 1 : 0;
    if (!slotMapped[idx]) slotNames[idx] = "";
    slotsLive = true;
    needRedraw = true;
    mgraphics.redraw();
}

// Saved with the Set: version 1 = [1, viewMode]. Unknown or older shapes keep the defaults.
function getvalueof() {
    return [1, viewMode];
}

function setvalueof() {
    var args = Array.prototype.slice.call(arguments);
    if (args.length === 1 && Array.isArray(args[0])) args = args[0];
    if (!args || args.length === 0) return;
    var ver = Math.round(Number(args[0]) || 0);
    if (ver >= 1 && args.length >= 2) {
        viewMode = Number(args[1]) > 0.5 ? 1 : 0;
    }
    needRedraw = true;
    mgraphics.redraw();
}

// ---------------------------------------------------------------------------------------------
// Telemetry polling
// ---------------------------------------------------------------------------------------------
function commitAcc() {
    var z = true;
    var k;
    var col = [];
    for (k = 0; k < TIMBRE_NC; k++) {
        col.push(accM[k] / Math.max(accN, 1));
        if (Math.abs(accM[k]) > 1e-9) z = false;
    }
    dMfcc.push(col);
    dNov.push(accNov);
    dCtl.push(accCtl);
    dTrg.push(accTrg);
    dMfcc.shift();
    dNov.shift();
    dCtl.shift();
    dTrg.shift();
    resetAcc();
}

function pushHop(d, base) {
    for (var k = 0; k < TIMBRE_NC; k++) accM[k] += Number(d[base + k]) || 0;
    var nv = Number(d[base + 13]) || 0;
    var ct = Number(d[base + 14]) || 0;
    if (nv > accNov) accNov = nv;
    if (ct > accCtl) accCtl = ct;
    if ((Number(d[base + 15]) || 0) > 0.5) accTrg = 1;
    accN++;
    if (accN >= DEC) commitAcc();
}

function pullScope() {
    if (isDeleted) return;
    if (scopeBufName && typeof Buffer !== "undefined") {
        try {
            var buf = new Buffer(scopeBufName);
            var d = buf.peek(1, 0, TIMBRE_BUF_LEN);
            if (d && d.length >= TIMBRE_BUF_LEN) {
                var counter = Number(d[0]) || 0;
                var idle = (Number(d[9]) || 0) > 0.5 ? 1 : 0;
                if (counter !== lastCounter) {
                    if (demoActive) {
                        emptyHistory();
                        demoActive = false;
                    }
                    var fresh = lastCounter < 0 ? TIMBRE_COLS : (counter - lastCounter + 1000000) % 1000000;
                    if (fresh > TIMBRE_COLS) fresh = TIMBRE_COLS;
                    var head = clamp(Math.floor(Number(d[1]) || 0), 0, TIMBRE_COLS - 1);
                    for (var j = fresh - 1; j >= 0; j--) {
                        var colIdx = (head - j + TIMBRE_COLS) % TIMBRE_COLS;
                        pushHop(d, TIMBRE_HDR + colIdx * 16);
                    }
                    lastCounter = counter;
                    gateOpen = Number(d[2]) || 0;
                    levelDb = Number(d[10]) || -200;
                    var tc = Number(d[8]) || 0;
                    if (lastTrigCount >= 0 && tc !== lastTrigCount) flashT0 = Date.now();
                    lastTrigCount = tc;
                    needRedraw = true;
                }
                if (idle !== lastIdle) {
                    lastIdle = idle;
                    needRedraw = true;
                }
            }
        } catch (err) {}
    }
    if (flashT0 > 0 && Date.now() - flashT0 < 320) needRedraw = true;
    if (needRedraw) {
        needRedraw = false;
        mgraphics.redraw();
    }
}

var pollTask = null;
if (typeof Task !== "undefined") {
    try {
        pollTask = new Task(pullScope, this);
        pollTask.interval = 33;
        pollTask.repeat();
    } catch (err) {}
}

// ---------------------------------------------------------------------------------------------
// Geometry per layout
// ---------------------------------------------------------------------------------------------
function geom(w, h) {
    if (LAYOUT === "b") {
        return {
            fs: 6.4, heat: [3, h - 14, w - 6, 11], gutter: false,
            strip: [3, 14, w - 6, h - 31], chips: [[6, 3], [Math.floor(w * 0.5) + 2, 3]], chipW: Math.floor(w * 0.5) - 8,
            readout: false, nameSz: 6.4
        };
    }
    if (LAYOUT === "c") {
        return {
            fs: 8, heat: [3, h - 14, w - 6, 11], gutter: false,
            strip: [3, 3, w - 6, h - 20], chips: [[8, 8], [8, 21]], chipW: 150, readout: true,
            nameSz: 8
        };
    }
    return {
        fs: 6.8, heat: [19, 3, w - 23, 56], gutter: true,
        strip: [3, 77, w - 6, h - 80], chips: [[3, 62], [Math.floor(w * 0.5) + 1, 62]], chipW: Math.floor(w * 0.5) - 5, readout: true,
        nameSz: 6.8
    };
}

function plotRect(g) {
    // inner plot area of the novelty strip (leaves room for the border)
    var s = g.strip;
    var padT = LAYOUT === "c" ? 5 : 3;
    var padB = 3;
    return [s[0] + 2, s[1] + padT, s[2] - 4, s[3] - padT - padB];
}

function thrToY(g, thr) {
    var p = plotRect(g);
    return p[1] + p[3] - thr * p[3];
}

function yToThr(g, y) {
    var p = plotRect(g);
    return (p[1] + p[3] - y) / p[3];
}

// ---------------------------------------------------------------------------------------------
// Text helpers (Arial Bold metrics, no text_measure so the preview and Max agree)
// ---------------------------------------------------------------------------------------------
function charW(ch) {
    if (ch === " ") return 0.278;
    if ("ijl.,:;'|!".indexOf(ch) >= 0) return 0.278;
    if ("tfrI()-/".indexOf(ch) >= 0) return 0.36;
    if ("mM".indexOf(ch) >= 0) return 0.89;
    if ("wW".indexOf(ch) >= 0) return 0.82;
    if ("0123456789".indexOf(ch) >= 0) return 0.556;
    if (ch >= "A" && ch <= "Z") return 0.72;
    return 0.6;
}

function textW(s, size) {
    var t = 0;
    for (var i = 0; i < s.length; i++) t += charW(s.charAt(i));
    return t * size;
}

function fitText(s, size, maxW) {
    if (textW(s, size) <= maxW) return s;
    var out = s;
    while (out.length > 1 && textW(out + "..", size) > maxW) out = out.substring(0, out.length - 1);
    return out + "..";
}

function text(s, x, y, size, c, a) {
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(size);
    mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? 1 : a);
    mgraphics.move_to(x, y);
    mgraphics.show_text(s);
}

// ---------------------------------------------------------------------------------------------
// Colour map for the fingerprint
// ---------------------------------------------------------------------------------------------
var CM_STOPS = [
    [-1.0, 0.20, 0.62, 0.98],
    [-0.5, 0.10, 0.30, 0.62],
    [0.0, 0.046, 0.052, 0.085],
    [0.35, 0.50, 0.14, 0.52],
    [0.70, 0.96, 0.40, 0.34],
    [1.0, 1.0, 0.90, 0.58]
];
var CM_N = 41;
var cmLut = [];
(function buildLut() {
    for (var i = 0; i < CM_N; i++) {
        var t = -1 + 2 * i / (CM_N - 1);
        var lo = CM_STOPS[0];
        var hi = CM_STOPS[CM_STOPS.length - 1];
        for (var s = 0; s < CM_STOPS.length - 1; s++) {
            if (t >= CM_STOPS[s][0] && t <= CM_STOPS[s + 1][0]) {
                lo = CM_STOPS[s];
                hi = CM_STOPS[s + 1];
                break;
            }
        }
        var f = (t - lo[0]) / Math.max(hi[0] - lo[0], 1e-6);
        cmLut.push([lo[1] + (hi[1] - lo[1]) * f, lo[2] + (hi[2] - lo[2]) * f, lo[3] + (hi[3] - lo[3]) * f]);
    }
})();

var ROW_SCALE = [9, 7, 6, 5, 5, 4, 4, 3.5, 3.5, 3.5, 3, 3, 3];

function lutIndex(v, scale) {
    var t = v / scale;
    t = t < 0 ? -Math.pow(Math.min(-t, 1.4), 0.8) : Math.pow(Math.min(t, 1.4), 0.8);
    t = clamp(t, -1, 1);
    return Math.round((t + 1) * 0.5 * (CM_N - 1));
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------
function drawHeat(g) {
    var r = g.heat;
    var x0 = r[0];
    var y0 = r[1];
    var w = r[2];
    var h = r[3];
    mgraphics.set_source_rgba(cmLut[(CM_N - 1) / 2][0], cmLut[(CM_N - 1) / 2][1], cmLut[(CM_N - 1) / 2][2], 1);
    mgraphics.rectangle(x0, y0, w, h);
    mgraphics.fill();
    var cw = w / NCOL;
    var ch = h / TIMBRE_NC;
    var run = [];
    var k;
    for (k = 0; k < TIMBRE_NC; k++) run.push(dMfcc[0][k]);
    for (var i = 0; i < NCOL; i++) {
        var col = dMfcc[i];
        for (k = 0; k < TIMBRE_NC; k++) {
            var v = col[k];
            var sc = ROW_SCALE[k];
            if (viewMode === 1) {
                v = (col[k] - run[k]) * 2.2;
                run[k] += 0.1 * (col[k] - run[k]);
            }
            var li = lutIndex(v, sc);
            if (li === (CM_N - 1) / 2) continue;
            var c = cmLut[li];
            mgraphics.set_source_rgba(c[0], c[1], c[2], 1);
            mgraphics.rectangle(x0 + i * cw, y0 + k * ch, cw + 0.5, ch + 0.4);
            mgraphics.fill();
        }
    }
    // frame
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.16, 0.18, 0.28, 1);
    mgraphics.rectangle(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    mgraphics.stroke();
    if (g.gutter) {
        var lab = [[0, "c1"], [6, "c7"], [12, "c13"]];
        for (var l = 0; l < lab.length; l++) {
            text(lab[l][1], 3, y0 + (lab[l][0] + 0.5) * ch + 2.3, 6.2, C_DIM, 0.9);
        }
        if (viewMode === 1) text("d", 3, y0 + h - 1, 6.2, C_THR, 0.9);
    }
}

function drawChip(g, idx) {
    var pos = g.chips[idx];
    var col = C_SLOT[idx];
    var mapped = idx === 0 ? (slotNames[0] !== "" || slotMapped[0]) : (slotNames[1] !== "" || slotMapped[1]);
    var nm = slotNames[idx];
    var sz = g.nameSz;
    var x = pos[0];
    var y = pos[1];
    var a = mapped ? 1 : 0.55;
    mgraphics.set_source_rgba(col[0], col[1], col[2], a);
    mgraphics.arc(x + 3, y + sz * 0.15 + 1.5, mapped ? 2.4 : 1.8, 0, Math.PI * 2);
    mgraphics.fill();
    var label = (idx + 1) + "  " + (mapped ? (nm !== "" ? nm : "mapped") : "\u2014 not mapped");
    label = fitText(label, sz, g.chipW - 9);
    text(label, x + 8, y + sz * 0.62 + 1, sz, mapped ? C_TXT : C_DIM, mapped ? 1 : 0.8);
}

function drawNames(g) {
    drawChip(g, 0);
    drawChip(g, 1);
}

function curvePoints(g, arr) {
    var p = plotRect(g);
    var pts = [];
    for (var i = 0; i < NCOL; i++) {
        pts.push([p[0] + (i + 0.5) * p[2] / NCOL, p[1] + p[3] - clamp(arr[i], 0, 1) * p[3]]);
    }
    return pts;
}

function drawStrip(g) {
    var s = g.strip;
    var p = plotRect(g);
    // well
    mgraphics.set_source_rgba(0.028, 0.032, 0.056, 1);
    mgraphics.rectangle_rounded(s[0], s[1], s[2], s[3], 3, 3);
    mgraphics.fill();
    // grid
    mgraphics.set_line_width(1);
    var gl = [0.25, 0.5, 0.75];
    for (var gi = 0; gi < gl.length; gi++) {
        var gy = Math.round(p[1] + p[3] - gl[gi] * p[3]) + 0.5;
        mgraphics.set_source_rgba(0.14, 0.16, 0.26, 0.5);
        mgraphics.move_to(p[0], gy);
        mgraphics.line_to(p[0] + p[2], gy);
        mgraphics.stroke();
    }
    var thr = sensToThr(curSens);
    var ty = thrToY(g, thr);
    var base = p[1] + p[3];
    // novelty area
    var pts = curvePoints(g, dNov);
    var i;
    mgraphics.set_source_rgba(C_NOV[0], C_NOV[1], C_NOV[2], 0.20);
    mgraphics.move_to(pts[0][0], base);
    for (i = 0; i < NCOL; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.line_to(pts[NCOL - 1][0], base);
    mgraphics.close_path();
    mgraphics.fill();
    // the part above the threshold is what drives the output: brighter
    mgraphics.set_source_rgba(C_NOV[0], C_NOV[1], C_NOV[2], 0.38);
    for (i = 0; i < NCOL - 1; i++) {
        var a = pts[i];
        var b = pts[i + 1];
        if (a[1] < ty || b[1] < ty) {
            var ya = Math.min(a[1], ty);
            var yb = Math.min(b[1], ty);
            mgraphics.move_to(a[0], ty);
            mgraphics.line_to(a[0], ya);
            mgraphics.line_to(b[0], yb);
            mgraphics.line_to(b[0], ty);
            mgraphics.close_path();
            mgraphics.fill();
        }
    }
    // novelty line
    mgraphics.set_line_width(LAYOUT === "c" ? 1.6 : 1.2);
    mgraphics.set_source_rgba(C_NOV[0], C_NOV[1], C_NOV[2], 0.95);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (i = 1; i < NCOL; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.stroke();
    // output envelope: soft underlay then a crisp line
    var ep = curvePoints(g, dCtl);
    mgraphics.set_source_rgba(C_ENV[0], C_ENV[1], C_ENV[2], 0.18);
    mgraphics.set_line_width(LAYOUT === "c" ? 4.5 : 3.2);
    mgraphics.move_to(ep[0][0], ep[0][1]);
    for (i = 1; i < NCOL; i++) mgraphics.line_to(ep[i][0], ep[i][1]);
    mgraphics.stroke();
    mgraphics.set_source_rgba(C_ENV[0], C_ENV[1], C_ENV[2], 1);
    mgraphics.set_line_width(LAYOUT === "c" ? 1.8 : 1.3);
    mgraphics.move_to(ep[0][0], ep[0][1]);
    for (i = 1; i < NCOL; i++) mgraphics.line_to(ep[i][0], ep[i][1]);
    mgraphics.stroke();

    drawEvents(g, pts, thr);

    // threshold line (dashed) and handle
    var active = dragThr || hoverThr;
    mgraphics.set_line_width(active ? 1.6 : 1.1);
    mgraphics.set_source_rgba(C_THR[0], C_THR[1], C_THR[2], active ? 1 : 0.85);
    for (var dx = p[0]; dx < p[0] + p[2]; dx += 6) {
        mgraphics.move_to(dx, Math.round(ty) + 0.5);
        mgraphics.line_to(Math.min(dx + 3.4, p[0] + p[2]), Math.round(ty) + 0.5);
        mgraphics.stroke();
    }
    var hx = p[0] + p[2] - 9;
    mgraphics.set_source_rgba(C_THR[0], C_THR[1], C_THR[2], active ? 1 : 0.9);
    mgraphics.rectangle_rounded(hx, ty - 3.5, 8, 7, 2, 2);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.12, 0.08, 0.02, 0.9);
    mgraphics.move_to(hx + 2, ty - 1);
    mgraphics.line_to(hx + 6, ty - 1);
    mgraphics.stroke();
    mgraphics.move_to(hx + 2, ty + 1.4);
    mgraphics.line_to(hx + 6, ty + 1.4);
    mgraphics.stroke();

    // labels
    var fs = g.fs;
    if (LAYOUT === "a") {
        text("NOVELTY", s[0] + 5, s[1] + fs + 1, fs - 0.6, C_NOV, 0.9);
        text("OUT", s[0] + 5 + textW("NOVELTY ", fs - 0.6) + 2, s[1] + fs + 1, fs - 0.6, C_ENV, 0.95);
    }
    var ro = "Sens " + Math.round(curSens) + "% \u00b7 thr " + Math.round(thr * 100) + "%";
    if (g.readout) {
        var rs = LAYOUT === "c" ? 8 : fs;
        var rw = textW(ro, rs);
        text(ro, s[0] + s[2] - rw - 14, s[1] + rs + 2, rs, C_THR, active ? 1 : 0.8);
        var ml = curMode ? "TRIG" : "ENV";
        if (LAYOUT === "c") {
            var mw = textW(ml, rs);
            text(ml, s[0] + s[2] - rw - mw - 26, s[1] + rs + 2, rs, curMode ? C_NOV : C_ENV, 0.95);
        }
    }
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.16, 0.18, 0.28, 1);
    mgraphics.rectangle_rounded(s[0] + 0.5, s[1] + 0.5, s[2] - 1, s[3] - 1, 3, 3);
    mgraphics.stroke();
}

// Peak markers (every layout) and fired triggers (Trig mode: telemetry flag).
function drawEvents(g, pts, thr) {
    var p = plotRect(g);
    var age = flashT0 > 0 ? (Date.now() - flashT0) / 320 : 2;
    var last = -1;
    var i;
    for (i = 0; i < NCOL; i++) if (dTrg[i] > 0.5) last = i;
    for (i = 1; i < NCOL - 1; i++) {
        var isPeak = dNov[i] > thr && dNov[i] >= dNov[i - 1] && dNov[i] > dNov[i + 1];
        var fired = dTrg[i] > 0.5 && curMode === 1;
        if (fired) {
            var fa = 0.35;
            if (i === last && age < 1) fa = 0.35 + 0.55 * (1 - age);
            mgraphics.set_line_width(i === last && age < 1 ? 2 : 1.2);
            mgraphics.set_source_rgba(1, 0.86, 0.94, fa);
            mgraphics.move_to(pts[i][0], g.strip[1] + 2);
            mgraphics.line_to(pts[i][0], g.strip[1] + g.strip[3] - 2);
            mgraphics.stroke();
            var rad = (LAYOUT === "c" ? 4.5 : 3) + (i === last && age < 1 ? 7 * age : 0);
            mgraphics.set_source_rgba(1, 0.86, 0.94, i === last && age < 1 ? 0.9 * (1 - age) + 0.25 : 0.6);
            mgraphics.set_line_width(1.2);
            mgraphics.arc(pts[i][0], pts[i][1], rad, 0, Math.PI * 2);
            mgraphics.stroke();
        } else if (isPeak) {
            mgraphics.set_source_rgba(C_THR[0], C_THR[1], C_THR[2], 0.95);
            mgraphics.arc(pts[i][0], pts[i][1], LAYOUT === "c" ? 2.2 : 1.7, 0, Math.PI * 2);
            mgraphics.fill();
        }
    }
    // trigger flash across the whole canvas edge in Trig mode
    if (curMode === 1 && age < 1) {
        mgraphics.set_source_rgba(1, 0.86, 0.94, 0.16 * (1 - age));
        mgraphics.rectangle(g.strip[0], g.strip[1], g.strip[2], g.strip[3]);
        mgraphics.fill();
    }
}

function paint() {
    var sz = mgraphics.size;
    var defW = LAYOUT === "b" ? 184 : (LAYOUT === "c" ? 396 : 270);
    var defH = LAYOUT === "b" ? 58 : (LAYOUT === "c" ? 80 : 110);
    var w = sz[0] || defW;
    var h = sz[1] || defH;
    if (dMfcc.length === 0) {
        if (demoActive) buildDemo();
        else emptyHistory();
    }
    var g = geom(w, h);
    mgraphics.set_source_rgba(C_BG[0], C_BG[1], C_BG[2], 1);
    mgraphics.rectangle_rounded(0, 0, w, h, 4, 4);
    mgraphics.fill();
    drawHeat(g);
    if (LAYOUT === "a") {
        drawNames(g);
        drawStrip(g);
    } else {
        drawStrip(g);
        drawNames(g);
    }
}

// ---------------------------------------------------------------------------------------------
// Mouse: drag the threshold line (synced with the Sens control); double-click resets; click the heatmap (A) to
// switch between the fingerprint and its deviation from the recent average.
// ---------------------------------------------------------------------------------------------
function inRect(x, y, r) {
    return x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];
}

function setSensFromY(g, y) {
    var s = Math.round(thrToSens(clamp(yToThr(g, y), TIMBRE_THR_BASE, TIMBRE_THR_BASE + TIMBRE_THR_SPAN)));
    if (s !== curSens) {
        curSens = s;
        outlet(0, "ui_sens", s);
    }
    needRedraw = true;
    mgraphics.redraw();
}

function onclick(x, y, but) {
    var sz = mgraphics.size;
    var g = geom(sz[0], sz[1]);
    var now = Date.now();
    if (inRect(x, y, g.strip)) {
        if (now - lastClickT < 320) {
            lastClickT = 0;
            curSens = 50;
            outlet(0, "ui_sens", 50);
            dragThr = false;
            needRedraw = true;
            mgraphics.redraw();
            return;
        }
        lastClickT = now;
        dragThr = true;
        setSensFromY(g, y);
        return;
    }
    if (LAYOUT === "a" && inRect(x, y, g.heat)) {
        viewMode = viewMode ? 0 : 1;
        notifyclients();
        needRedraw = true;
        mgraphics.redraw();
    }
}

function ondrag(x, y, but) {
    if (!dragThr) return;
    if (!but) {
        dragThr = false;
        needRedraw = true;
        mgraphics.redraw();
        return;
    }
    var sz = mgraphics.size;
    setSensFromY(geom(sz[0], sz[1]), y);
}

function onidle(x, y) {
    var sz = mgraphics.size;
    var g = geom(sz[0], sz[1]);
    var h = inRect(x, y, g.strip) && Math.abs(y - thrToY(g, sensToThr(curSens))) < 7;
    if (h !== hoverThr) {
        hoverThr = h;
        needRedraw = true;
        mgraphics.redraw();
    }
}

function onidleout() {
    if (hoverThr) {
        hoverThr = false;
        needRedraw = true;
        mgraphics.redraw();
    }
}

emptyHistory();
