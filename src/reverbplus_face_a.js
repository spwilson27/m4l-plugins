// Reverb+ face `a` ("Signal-flow sections", scripts/reverbplus_layouts/a.py): the SPACE section's display. A copy of
// reverbplus_face.js (the shared original stays untouched), resized to the section (210 x 88), without the algorithm
// icons (a live.menu in the section's title row picks the algorithm), pre-delay / loop footer and clip LED (the
// section LCD values and the deco script show those). Pseudo-3D waterfall of the wet spectrum with the predicted
// decay as an amber ghost, band pick, dry vs wet strip; Convolution: the IR spectrogram behind, IR name + browse / clear.
// Build order: config + face_common + face_math (unchanged) + this file.

outlets = 2; // 0 = parameter / command stream (prelude), 1 = hide_tank / hide_ir flags for the swap block

// The shared math file's plot geometry is for 340 x 161 pixels; this display is 210 x 88.
RCG.x0 = 4; RCG.x1 = 206; RCG.cx = 105; RCG.yFront = 62; RCG.yBack = 34; RCG.hFront = 27; RCG.backScale = 0.55;

/**
 * Hit / draw rectangles of the display, from the v8ui size (210 x 88).
 * @param {number} w
 * @param {number} h
 */
function rcaLayout(w, h) {
    return {
        plot: { x: 0, y: 13, w: w, h: 59 },
        strip: { x: RCG.x0, y: 73, w: RCG.x1 - RCG.x0, h: h - 74 },
        browse: { id: "browse", x: w - 34, y: 1, w: 16, h: 11 },
        clear: { id: "clear", x: w - 16, y: 1, w: 14, h: 11 },
        pillMinX: 120,
    };
}

var RCS = {
    hist: rcHistNew(),
    wet: new Float32Array(RC.BANDS).fill(-120),
    dry: new Float32Array(RC.BANDS).fill(-120),
    band: -1, drag: false, lastPush: 0, now: 0,
    irRows: null, irVer: -1, irLen: 0, irBusy: null, irName: "",
    hideTank: -1, hideIr: -1,
};
var RCA_W = 210;

rpPoll(20);

// ---- parameters / state -------------------------------------------------------------------------------------

/** Hide the tank-only bars (Size, Diffusion, Mod) and show the IR bars in Convolution, and back. */
function rcEmitSwap() {
    var conv = rpAlgo() === RP_ALGO.CONV;
    var ht = conv ? 1 : 0;
    var hi = conv ? 0 : 1;
    if (ht !== RCS.hideTank) { RCS.hideTank = ht; outlet(1, "hide_tank", ht); }
    if (hi !== RCS.hideIr) { RCS.hideIr = hi; outlet(1, "hide_ir", hi); }
}

function onParam(key) {
    if (key === "algo") {
        rcEmitSwap();
        if (rpAlgo() === RP_ALGO.CONV) rcIrEnsure();
    }
}

function onState(kind) {
    if (kind === "ir") rcIrEnsure();
    rcEmitSwap();
}

function rcFrozen() {
    var s = rpT.s;
    return rpNum("freeze", 0) > 0.5 && rpActive("freeze") || (!!s && s[RP_SCOPE.FREEZE] > 0.5);
}

// ---- telemetry -> history -----------------------------------------------------------------------------------

function rcSmooth(dst, src) {
    for (var i = 0; i < RC.BANDS; i++) {
        var v = Math.max(src[i], -120);
        dst[i] = dst[i] <= -119 ? v : dst[i] * 0.45 + v * 0.55;
    }
}

function rcSample(nowMs) {
    var b = rpBuf(rpNames.spec);
    if (!b) return;
    var d = b.peek(1, 0, RP_SPEC_SAMPS);
    if (!d || d.length < RP_SPEC_SAMPS) return;
    var wet = rpSpectrum32(d, RP_SPEC.WET);
    var dry = rpSpectrum32(d, RP_SPEC.DRY);
    rcSmooth(RCS.wet, wet);
    rcSmooth(RCS.dry, dry);
    if (!rcFrozen() && nowMs - RCS.lastPush >= RC.ROW_MS) {
        RCS.lastPush = nowMs;
        rcHistPush(RCS.hist, wet, nowMs);
    }
}

function onFrame(t) {
    if (!t.active) return;
    var now = Date.now();
    RCS.now = now;
    var s = t.s;
    rcSample(now);
}

// ---- impulse-response spectrogram (once per processed IR, in chunks) --------------------------------------------

function rcIrEnsure() {
    if (!rpState.ir.loaded || RCS.irBusy) return;
    var hb = rpBuf(rpNames.hdr);
    var ib = rpBuf(rpNames.irspec);
    if (!hb || !ib) return;
    var h = hb.peek(1, RP_HDR.IR_VER, 6);
    if (!h || h.length < 6) return;
    var ver = h[0], bank = h[1], nHead = h[2], nTail = h[3], len = h[4];
    if (!(len > 0) || ver === RCS.irVer) return;
    var sr = (rpT.s && rpT.s[RP_SCOPE.SR]) || 48000;
    RCS.irBusy = {
        ver: ver, bank: bank, nHead: nHead, nTail: nTail, len: len, sr: sr, p: 0, q: 0, st: rcIrNew(len),
        mapH: rcIrMap(RP_CONV.NB1, RP_CONV.N1, sr), mapT: rcIrMap(RP_CONV.NB2, RP_CONV.N2, sr), psd: new Float64Array(RC.BANDS),
        task: null,
    };
    var w = RCS.irBusy;
    if (typeof Task === "undefined") { rcIrStep(); return; }
    w.task = new Task(rcIrStep, this);
    w.task.interval = 20;
    w.task.repeat();
}

function rcIrStep() {
    var w = RCS.irBusy;
    if (!w) return;
    var ib = rpBuf(rpNames.irspec);
    var t0 = Date.now();
    var base = w.bank * RP_CONV.BANK_FLOATS;
    try {
        do {
            if (w.p < w.nHead) {
                var a = ib.peek(1, base + w.p * RP_CONV.NB1 * 4, RP_CONV.NB1 * 4);
                rcIrPsd(a, 0, w.mapH, RP_CONV.P1, w.psd);
                rcIrAdd(w.st, w.p * RP_CONV.P1 + RP_CONV.P1 / 2, w.psd);
                w.p++;
            } else if (w.q < w.nTail) {
                var c = ib.peek(1, base + RP_CONV.HEAD_FLOATS + w.q * RP_CONV.NB2 * 4, RP_CONV.NB2 * 4);
                rcIrPsd(c, 0, w.mapT, RP_CONV.P2, w.psd);
                rcIrAdd(w.st, RP_CONV.H + w.q * RP_CONV.P2 + RP_CONV.P2 / 2, w.psd);
                w.q++;
            } else {
                break;
            }
        } while (Date.now() - t0 < 8);
    } catch (e) {
        w.q = w.nTail; w.p = w.nHead; // unreadable: give up on this IR
    }
    if (w.p < w.nHead || w.q < w.nTail) return;
    if (w.task) w.task.cancel();
    RCS.irRows = rcIrFinish(w.st);
    RCS.irVer = w.ver;
    RCS.irLen = w.len;
    RCS.irSr = w.sr;
    RCS.irName = rpState.ir.name;
    RCS.irBusy = null;
    mgraphics.redraw();
}

// ---- colour ----------------------------------------------------------------------------------------------------

function rcMix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
}

/** level 0..1 -> colour: dark, cyan (ice when frozen), white-ish, coral at the top. */
function rcRamp(v, frozen) {
    var dark = [0.13, 0.19, 0.31, 1];
    var mid = frozen ? [0.62, 0.86, 1.0, 1] : RPC.cyan;
    if (v < 0.5) return rcMix(dark, mid, v / 0.5);
    if (v < 0.82) return rcMix(mid, RPC.text, (v - 0.5) / 0.32);
    return rcMix(RPC.text, RPC.coral, (v - 0.82) / 0.18);
}

function rcRampIr(v) {
    var dark = [0.16, 0.12, 0.30, 1];
    return rcMix(dark, RPC.violet, Math.min(1, v * 1.1));
}

// ---- icons -----------------------------------------------------------------------------------------------------

// ---- plot ------------------------------------------------------------------------------------------------------

function rcRowPoints(vals, t, toLevel) {
    var g = rcRowGeom(t);
    var xs = [], ys = [];
    for (var b = 0; b < RC.BANDS; b++) {
        xs.push(rcBandX(b, g.s));
        ys.push(g.base - toLevel(vals[b]) * g.hmax);
    }
    return { xs: xs, ys: ys, base: g.base, g: g };
}

/**
 * One waterfall row: an opaque fill under the ridge (hides the rows behind it), a coloured wash per band
 * segment and the ridge line.
 */
function rcDrawRow(vals, r, n, toLevel, ramp, occlude, wash, alphaMul, near) {
    var t = n > 1 ? r / (n - 1) : 0;
    var p = rcRowPoints(vals, t, toLevel);
    var xs = p.xs, ys = p.ys, i;
    if (occlude) {
        mgraphics.move_to(xs[0], p.base);
        for (i = 0; i < RC.BANDS; i++) mgraphics.line_to(xs[i], ys[i]);
        mgraphics.line_to(xs[RC.BANDS - 1], p.base);
        mgraphics.close_path();
        rpColor(RPC.bg, 1);
        mgraphics.fill();
    }
    var fade = (1 - 0.65 * t) * alphaMul;
    for (i = 0; i < RC.BANDS - 1; i++) {
        var lv = (toLevel(vals[i]) + toLevel(vals[i + 1])) * 0.5;
        if (wash && lv > 0.04) {
            mgraphics.move_to(xs[i], ys[i]); mgraphics.line_to(xs[i + 1], ys[i + 1]);
            mgraphics.line_to(xs[i + 1], p.base); mgraphics.line_to(xs[i], p.base); mgraphics.close_path();
            rpColor(ramp(lv), (0.10 + 0.22 * lv) * fade);
            mgraphics.fill();
        }
        if (near) {
            mgraphics.move_to(xs[i], ys[i]); mgraphics.line_to(xs[i + 1], ys[i + 1]);
            rpColor(ramp(Math.min(1, lv * 1.15)), 0.95 * fade);
            mgraphics.set_line_width(1);
            mgraphics.stroke();
        }
    }
    if (!near) {
        mgraphics.move_to(xs[0], ys[0]);
        for (i = 1; i < RC.BANDS; i++) mgraphics.line_to(xs[i], ys[i]);
        var m = 0;
        for (i = 0; i < RC.BANDS; i++) m = Math.max(m, toLevel(vals[i]));
        rpColor(ramp(m), 0.9 * fade);
        mgraphics.set_line_width(0.8);
        mgraphics.stroke();
    }
}

function rcDrawGuides(sr) {
    var f = [100, 1000, 10000];
    for (var i = 0; i < f.length; i++) {
        mgraphics.move_to(rcFreqX(f[i], sr, 1), RCG.yFront);
        mgraphics.line_to(rcFreqX(f[i], sr, RCG.backScale), RCG.yBack);
        rpColor(RPC.frame, 0.7);
        mgraphics.set_line_width(0.8);
        mgraphics.stroke();
    }
    var g0 = rcRowGeom(0), g1 = rcRowGeom(1);
    rpColor(RPC.frame, 0.9);
    mgraphics.move_to(RCG.x0, g0.base); mgraphics.line_to(RCG.x1, g0.base); mgraphics.stroke();
    mgraphics.move_to(rcBandX(0, g1.s) - 3, g1.base); mgraphics.line_to(rcBandX(RC.BANDS - 1, g1.s) + 3, g1.base); mgraphics.stroke();
}

function rcDrawGhost(hist, rt, hit, rowSec) {
    var ghost = rcGhost(hist, rt, hit, rowSec);
    var n = hist.rows.length;
    for (var r = 0; r < ghost.length; r++) {
        var gr = ghost[r];
        if (!gr) continue;
        var p = rcRowPoints(gr, r / (n - 1), rcLevel01);
        if (r === 0) {
            mgraphics.move_to(p.xs[0], p.base);
            for (var i = 0; i < RC.BANDS; i++) mgraphics.line_to(p.xs[i], p.ys[i]);
            mgraphics.line_to(p.xs[RC.BANDS - 1], p.base);
            mgraphics.close_path();
            rpColor(RPC.amber, 0.13);
            mgraphics.fill();
        }
        if (r % 3 !== 0) continue;
        mgraphics.move_to(p.xs[0], p.ys[0]);
        for (var j = 1; j < RC.BANDS; j++) mgraphics.line_to(p.xs[j], p.ys[j]);
        rpColor(RPC.amber, r === 0 ? 0.95 : 0.6);
        mgraphics.set_line_width(r === 0 ? 1.2 : 0.8);
        mgraphics.stroke();
    }
}

function rcDrawRibbon(hist, b) {
    var n = hist.rows.length;
    if (n < 2) return;
    mgraphics.move_to(0, 0);
    for (var r = 0; r < n; r++) {
        var g = rcRowGeom(r / (n - 1));
        var x = rcBandX(b, g.s), y = g.base - rcLevel01(hist.rows[r][b]) * g.hmax;
        if (r === 0) mgraphics.move_to(x, y);
        else mgraphics.line_to(x, y);
    }
    rpColor(RPC.text, 0.95);
    mgraphics.set_line_width(1.5);
    mgraphics.stroke();
    var g0 = rcRowGeom(0);
    mgraphics.move_to(rcBandX(b, 1), g0.base + 1);
    mgraphics.line_to(rcBandX(b, 1), g0.base + 5);
    rpColor(RPC.text, 0.95);
    mgraphics.set_line_width(1.5);
    mgraphics.stroke();
}

function rcRtInfo() {
    var s = rpT.s;
    var sr = (s && s[RP_SCOPE.SR]) || 48000;
    var algo = rpAlgo();
    var t = { lo: 0, mid: 0, hi: 0 };
    if (s) { t.lo = s[RP_SCOPE.RT60_LO]; t.mid = s[RP_SCOPE.RT60_MID]; t.hi = s[RP_SCOPE.RT60_HI]; }
    if (!(t.mid > 0.05)) {
        var bands = rpRt60Bands({ algo: algo, decay: rpNum("decay", 2.5), bassmult: rpNum("bassmult", 1.2), damp: rpNum("damp", 7000) });
        t = { lo: bands.low, mid: bands.mid, hi: bands.high };
    }
    return { t: t, sr: sr, curve: rcRt60Curve(t, { conv: algo === RP_ALGO.CONV, damp: rpNum("damp", 7000), xover: rpNum("xover", 350) }, sr) };
}

function rcMeasured(hist, b, sr) {
    if (hist.rows.length < 8) return null;
    return rpEstimateRt60(rcBandSeries(hist, b), rcRowSec(hist) * sr, sr);
}

function rcFmtHz(f) {
    return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + "k" : f.toFixed(0);
}

function rcDrawPlot(L, w, algo, frozen, info) {
    var hist = RCS.hist;
    var n = hist.rows.length;
    var conv = algo === RP_ALGO.CONV;
    var sr = info.sr;
    rcDrawGuides(sr);
    var irOn = conv && RCS.irRows;
    var r;
    if (irOn) {
        var nIr = RC.IR_ROWS;
        for (r = nIr - 1; r >= 0; r--) {
            rcDrawRow(RCS.irRows.subarray(r * RC.BANDS, (r + 1) * RC.BANDS), r, nIr, rcIrLevel01, rcRampIr, true, true, 0.7, r < 2);
        }
    }
    if (n >= 2) {
        for (r = n - 1; r >= 0; r--) rcDrawRow(hist.rows[r], r, n, rcLevel01, function (v) { return rcRamp(v, frozen); }, !irOn, true, 1, r < 8);
    } else if (!(conv && !rpState.ir.loaded)) {
        rpText("play audio into the device", w * 0.5 - 48, 46, 8, RPC.dim, true);
    }
    if (frozen) {
        rpColor([0.55, 0.82, 1, 1], 0.07);
        mgraphics.rectangle(L.plot.x, L.plot.y, L.plot.w, L.plot.h);
        mgraphics.fill();
        rpPill(6, 15, 44, 11, [0.55, 0.82, 1, 1], 0.22);
        rpText("FROZEN", 12, 23, 7.5, [0.7, 0.9, 1, 1], true);
    }
    if (n >= 2 && !frozen) {
        var hit = rcFindHit(hist);
        if (hit > 0) {
            rcDrawGhost(hist, info.curve, hit, rcRowSec(hist));
            rpColor(RPC.amber, 0.95);
            mgraphics.set_line_width(1.2);
            mgraphics.move_to(6, 19); mgraphics.line_to(16, 19); mgraphics.stroke();
            rpText("predicted decay", 19, 21.5, 7, RPC.amber, true);
        }
    }
    if (RCS.band >= 0 && n >= 2) rcDrawRibbon(hist, RCS.band);
    if (conv && !rpState.ir.loaded) {
        var msg = rpState.ir.status === "loading" || rpState.ir.status === "processing" ? "loading impulse response…" : "click to load an impulse response";
        rpText(msg, w * 0.5 - 58, 46, 8, RPC.dim, true);
    } else if (conv && !RCS.irRows) {
        rpText("analysing impulse response…", w * 0.5 - 58, 34, 8, RPC.dim, true);
    }
    // axis
    var ticks = [[100, "100"], [1000, "1k"], [10000, "10k"]];
    for (var i = 0; i < ticks.length; i++) rpText(ticks[i][1], rcFreqX(ticks[i][0], sr, 1) - 5, RCG.yFront + 7, 7, RPC.dim);
    var rowSec = rcRowSec(hist);
    if (conv && RCS.irRows) {
        rpText("IR " + rpFormatSec(RCS.irLen / (RCS.irSr || sr)), w - 44, 24, 7, RPC.dim);
    } else {
        rpText("back -" + rpFormatSec(rowSec * (RC.ROWS - 1)), w - 54, 24, 7, RPC.dim);
    }
}

// ---- strip: dry vs wet --------------------------------------------------------------------------------------------

function rcDrawStrip(L, info) {
    var S = L.strip;
    var i;
    rpColor(RPC.frame, 0.35);
    mgraphics.rectangle(S.x, S.y, S.w, S.h);
    mgraphics.fill();
    var arr = [[RCS.dry, RPC.dim, 0.30, 0.85], [RCS.wet, RPC.cyan, 0.24, 1]];
    for (var k = 0; k < arr.length; k++) {
        var a = arr[k];
        mgraphics.move_to(S.x, S.y + S.h);
        for (i = 0; i < RC.BANDS; i++) mgraphics.line_to(S.x + S.w * (i + 0.5) / RC.BANDS, S.y + S.h - rcLevel01(a[0][i]) * (S.h - 2));
        mgraphics.line_to(S.x + S.w, S.y + S.h);
        mgraphics.close_path();
        rpColor(a[1], a[2]);
        mgraphics.fill();
        mgraphics.move_to(S.x, S.y + S.h - rcLevel01(a[0][0]) * (S.h - 2));
        for (i = 0; i < RC.BANDS; i++) mgraphics.line_to(S.x + S.w * (i + 0.5) / RC.BANDS, S.y + S.h - rcLevel01(a[0][i]) * (S.h - 2));
        rpColor(a[1], a[3]);
        mgraphics.set_line_width(1.1);
        mgraphics.stroke();
    }
    if (RCS.band >= 0) {
        rpColor(RPC.text, 0.16);
        mgraphics.rectangle(S.x + S.w * RCS.band / RC.BANDS, S.y, S.w / RC.BANDS, S.h);
        mgraphics.fill();
    }
    rpText("WET", S.x + S.w - 52, S.y + 9, 6.5, RPC.cyan, true);
    rpText("DRY", S.x + S.w - 28, S.y + 9, 6.5, RPC.dim, true);
}

// ---- info row / footer -------------------------------------------------------------------------------------------

function rcDrawPills(minX, maxX) {
    var all = rpHeaderPills();
    var pills = [];
    for (var k = 0; k < all.length; k++) if (all[k].label.indexOf("LOOP MIN") !== 0) pills.push(all[k]); // MIN lives in the LOOP section
    var x = maxX;
    for (var i = 0; i < pills.length; i++) {
        var pw = rpTextW(pills[i].label, 7.5, true) + 10;
        if (x - pw < minX) break;
        x -= pw;
        rpPill(x, 0, pw, 12, pills[i].color, 0.16);
        rpText(pills[i].label, x + 5, 9, 7.5, pills[i].color, true);
        x -= 3;
    }
}

function rcDrawInfo(L, w, algo, info) {
    var s = rpT.s;
    var conv = algo === RP_ALGO.CONV;
    var txt;
    if (conv) {
        var nm = rpState.ir.loaded ? (rpState.ir.name || "impulse response") : "no impulse response";
        if (nm.length > 22) nm = nm.substring(0, 21) + "…";
        txt = nm;
    } else if (!s) {
        txt = "waiting for the device";
    } else {
        var meas = s[RP_SCOPE.RT60_MEAS];
        txt = "RT60 " + rpFormatSec(rpNum("decay", 2.5)) + (meas > 0.05 ? "  meas " + rpFormatSec(meas) : "");
    }
    rpText(txt, 2, 9, 8, conv && !rpState.ir.loaded ? RPC.amber : RPC.dim, true);
    var tw = rpTextW(txt, 8, true);
    if (RCS.band >= 0) {
        var b = RCS.band;
        var meas2 = rcMeasured(RCS.hist, b, info.sr);
        var lab = rcFmtHz(rcBandHz(b, info.sr)) + "Hz  " + rpFormatSec(info.curve[b]) + (meas2 ? " / " + rpFormatSec(meas2) : " / —");
        var lw = rpTextW(lab, 7.5, true);
        var bx = (conv ? L.browse.x - 6 : w - 2) - lw - 10;
        rpPill(bx, 0, lw + 10, 12, RPC.text, 0.12);
        rpText(lab, bx + 5, 9, 7.5, RPC.text, true);
    } else {
        rcDrawPills(Math.max(L.pillMinX, tw + 8), (conv ? L.browse.x - 4 : w - 2));
    }
    if (conv) {
        // browse = folder glyph, clear = x
        var bb = L.browse, c = L.clear;
        rpColor(RPC.dim, 1);
        mgraphics.set_line_width(1.1);
        mgraphics.rectangle(bb.x + 1, bb.y + 3, 13, 7);
        mgraphics.stroke();
        mgraphics.move_to(bb.x + 1, bb.y + 3); mgraphics.line_to(bb.x + 4, bb.y + 1); mgraphics.line_to(bb.x + 7, bb.y + 1); mgraphics.line_to(bb.x + 8, bb.y + 3);
        mgraphics.stroke();
        rpColor(rpState.ir.loaded ? RPC.dim : RPC.frame, 1);
        mgraphics.move_to(c.x + 3, c.y + 2); mgraphics.line_to(c.x + 11, c.y + 9);
        mgraphics.move_to(c.x + 11, c.y + 2); mgraphics.line_to(c.x + 3, c.y + 9);
        mgraphics.stroke();
    }
}

// ---- paint -------------------------------------------------------------------------------------------------------

function paint() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    rpRefreshTheme();
    rpColor(RPC.bg);
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();
    if (!RCS.now) RCS.now = Date.now();
    var L = rcaLayout(w, h);
    var algo = rpAlgo();
    var frozen = rcFrozen();
    var info = rcRtInfo();
    rcDrawInfo(L, w, algo, info);
    rcDrawPlot(L, w, algo, frozen, info);
    rcDrawStrip(L, info);
}

// ---- mouse ---------------------------------------------------------------------------------------------------------

function rcPick(x, y) {
    var L = rcaLayout(mgraphics.size[0], mgraphics.size[1]);
    if (rcInRect(L.strip, x, y)) return rcStripBand(x);
    if (rcInRect(L.plot, x, y)) return rcHitBand(x, y);
    return -1;
}

function onclick(x, y, but) {
    if (!but) return;
    var L = rcaLayout(mgraphics.size[0], mgraphics.size[1]);
    var conv = rpAlgo() === RP_ALGO.CONV;
    if (conv && rcInRect(L.browse, x, y)) { rpCmd("browse_ir"); return; }
    if (conv && rcInRect(L.clear, x, y)) { rpCmd("clear_ir"); return; }
    if (conv && !rpState.ir.loaded && rcInRect(L.plot, x, y)) { rpCmd("browse_ir"); return; }
    var b = rcPick(x, y);
    if (b >= 0) {
        RCS.band = b === RCS.band ? -1 : b;
        RCS.drag = true;
        mgraphics.redraw();
    }
}

function ondrag(x, y, but) {
    if (!but) { RCS.drag = false; return; }
    if (!RCS.drag) return;
    var b = rcPick(x, y);
    if (b >= 0 && b !== RCS.band) { RCS.band = b; mgraphics.redraw(); }
}

function ondblclick() {
    RCS.band = -1;
    mgraphics.redraw();
}

// ---- scripts/render_preview.py ----------------------------------------------------------------------------------------

function preview() {
    rpPreviewBase(1, 2.5);
    rpP.algo = 1; rpP.decay = 2.5; rpP.bassmult = 1.3; rpP.xover = 350; rpP.damp = 7000; rpP.loop = 40; rpP.predelay = 20;
    var sr = 48000;
    var rt = rcRt60Curve({ lo: 3.2, mid: 2.5, hi: 1.0 }, { conv: false, damp: 7000, xover: 350 }, sr);
    var hist = rcHistNew();
    // 28 rows, index 0 newest: a hit 17 rows after the oldest, then each band falls a bit slower than predicted
    for (var r = 0; r < RC.ROWS; r++) {
        var row = new Float32Array(RC.BANDS);
        var sinceHit = (RC.ROWS - 1 - r) * 0.15 - 2.5; // seconds after the hit
        for (var b = 0; b < RC.BANDS; b++) {
            var tilt = -22 - b * 0.55 + 6 * Math.sin(b * 0.45) * Math.cos(b * 0.2);
            var ripple = 2.2 * Math.sin(b * 1.9 + r * 0.7);
            var lvl = sinceHit < 0 ? tilt - 38 : tilt - 60 * sinceHit / (rt[b] * 1.12);
            row[b] = Math.max(-100, lvl + ripple);
        }
        hist.rows.push(row);
        hist.tot.push(rcTotalDb(row));
        hist.t.push(1000 + (RC.ROWS - 1 - r) * 150);
    }
    RCS.hist = hist;
    for (var k = 0; k < RC.BANDS; k++) {
        RCS.wet[k] = hist.rows[4][k];
        RCS.dry[k] = -30 - k * 0.7 + 5 * Math.sin(k * 0.8 + 1);
    }
    RCS.band = 14;
    RCS.now = 1;
    rcPreviewExtra();
}

// Extra preview states for a human check (RC_PREVIEW=conv|freeze python3 scripts/render_preview.py ...); inert in Max.
function rcPreviewExtra() {
    var g = /** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : {});
    var mode = g.process && g.process.env ? g.process.env.RC_PREVIEW : "";
    if (mode === "freeze") {
        rpP.freeze = 1;
        rpT.s[RP_SCOPE.FREEZE] = 1;
        RCS.band = -1;
    } else if (mode === "conv") {
        rpP.algo = 5;
        rpT.s = rpFakeScope(5, 2.2);
        var st = rcIrNew(100000);
        var psd = new Float64Array(RC.BANDS);
        for (var q = 0; q < 50; q++) {
            for (var b = 0; b < RC.BANDS; b++) psd[b] = Math.exp(-q / (6 + 22 * (1 - b / RC.BANDS))) * (1 + 0.3 * Math.sin(b * 0.9 + q * 0.3)) * Math.pow(10, -b * 0.02);
            rcIrAdd(st, q * 2000, psd);
        }
        RCS.irRows = rcIrFinish(st);
        RCS.irLen = 100000;
        RCS.irSr = 48000;
        RCS.irVer = 1;
    }
}
