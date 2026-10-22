// Reverb+ face `e` ("Direct manipulation", scripts/reverbplus_layouts/e.py): the waterfall is the control surface.
//   page SPACE   waterfall of the wet spectrum with the predicted-decay ghost (as the shipped face), over it six numbered
//                handles like Hybrid Reverb's EQ nodes: 1 Decay (vertical track on the ghost), 2 HF Damp and 3 Bass Mult /
//                Crossover (nodes on an RT60-ratio strip: x = frequency, y = how much that band decays longer / shorter),
//                4 Low Cut and 5 High Cut (on the front frequency axis), 6 Pre-Delay (ruler above the plot). A readout bar
//                at the bottom shows each handle's LCD value, the touched one highlighted; hairlines in the handle's
//                colour tie handle, guide and readout cell together.
//   page TAIL    the rarely used parameters as drawn value bars: Mod Rate / Depth, Early, Late, Ducking, Output, Clip.
// Convolution: handle 1 drives IR Decay, handle 3 is gone, the browse / clear buttons appear. Page, selection and drag
// state are display-only (not parameters). Build order: config + face_common + face_e_math + this file.

outlets = 2; // 0 = parameter / command stream (prelude), 1 = hide_tank / hide_ir flags for the swap block (left column)

var RCS = {
    hist: rcHistNew(),
    wet: new Float32Array(RC.BANDS).fill(-120),
    dry: new Float32Array(RC.BANDS).fill(-120),
    band: -1, lastPush: 0, clipAt: 0, now: 0,
    irRows: null, irVer: -1, irLen: 0, irBusy: null, irName: "",
    hideTank: -1, hideIr: -1,
    page: 0, sel: -1, drag: -1, tailDrag: "", bandDrag: false, hover: -1,
};

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
        if (rpAlgo() === RP_ALGO.CONV && RCS.sel === 2) RCS.sel = -1;
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
    if (s && s[RP_SCOPE.CLIP_DB] < -0.1) RCS.clipAt = now;
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

// ---- plot ------------------------------------------------------------------------------------------------------

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
        rpText("play audio into the device", w * 0.5 - 48, 70, 8.5, RPC.dim, true);
    }
    if (frozen) {
        rpColor([0.55, 0.82, 1, 1], 0.07);
        mgraphics.rectangle(L.plot.x, L.plot.y, L.plot.w, L.plot.h);
        mgraphics.fill();
    }
    if (n >= 2 && !frozen && !conv) {
        var hit = rcFindHit(hist);
        if (hit > 0) {
            rcDrawGhost(hist, info.curve, hit, rcRowSec(hist));
            rpColor(RPC.amber, 0.95);
            mgraphics.set_line_width(1.2);
            mgraphics.move_to(6, 52); mgraphics.line_to(16, 52); mgraphics.stroke();
            rpText("predicted", 19, 54.5, 7, RPC.amber, true);
        }
    }
    if (RCS.band >= 0 && n >= 2) {
        rcDrawRibbon(hist, RCS.band);
        var bb = RCS.band;
        var meas2 = rcMeasured(hist, bb, sr);
        var lab = rcFmtHz(rcBandHz(bb, sr)) + "Hz  " + rpFormatSec(info.curve[bb]) + (meas2 ? " / " + rpFormatSec(meas2) : " / —");
        rpPill(4, 32, rpTextW(lab, 7.5, true) + 10, 11, RPC.text, 0.12);
        rpText(lab, 9, 40.5, 7.5, RPC.text, true);
    }
    if (conv && !rpState.ir.loaded) {
        var msg = rpState.ir.status === "loading" || rpState.ir.status === "processing" ? "loading impulse response…" : "click to load an impulse response";
        rpText(msg, w * 0.5 - 58, 70, 8.5, RPC.dim, true);
    } else if (conv && !RCS.irRows) {
        rpText("analysing impulse response…", w * 0.5 - 58, 56, 8, RPC.dim, true);
    }
    var rowSec = rcRowSec(hist);
    if (conv && RCS.irRows) rpText("IR " + rpFormatSec(RCS.irLen / (RCS.irSr || sr)), w - 48, 40, 7, RPC.dim);
    else rpText("back -" + rpFormatSec(rowSec * (RC.ROWS - 1)), w - 58, 40, 7, RPC.dim);
}

// ---- ruler (pre-delay), info row ----------------------------------------------------------------------------------------

function rcDrawRuler(L, hs) {
    var R = L.ruler;
    var y = REG.rulerY;
    rpText("PRE-DELAY", 4, y + 3, 6, RPC.dim, true);
    rpColor(RPC.frame, 0.9);
    mgraphics.set_line_width(1);
    mgraphics.move_to(R.x, y); mgraphics.line_to(R.x + R.w, y); mgraphics.stroke();
    var t = [10, 50, 100, 250, 500];
    for (var i = 0; i < t.length; i++) {
        var x = R.x + R.w * rcPos("predelay", t[i]);
        rpColor(RPC.frame, 0.9);
        mgraphics.move_to(x, y - 2); mgraphics.line_to(x, y + 2); mgraphics.stroke();
        rpText(String(t[i]), x - 4.5, y - 4, 6, RPC.dim);
    }
    var h = hs[5];
    rpColor(RPC[h.color], 0.45);
    mgraphics.set_line_width(2);
    mgraphics.move_to(R.x, y); mgraphics.line_to(h.x, y); mgraphics.stroke();
}

function rcDrawInfo(L, w, algo, info) {
    var s = rpT.s;
    var name = RP_ALGOS[algo].toUpperCase();
    var x0 = REG.rulerX + REG.rulerW + 14;
    rpText(name, x0, 24, 8.5, RPC.text, true);
    var x = x0 + rpTextW(name, 8.5, true) + 8;
    var txt;
    if (!s) txt = "waiting for the device";
    else {
        var meas = s[RP_SCOPE.RT60_MEAS];
        txt = (algo === RP_ALGO.CONV ? "IR" : "RT60 " + rpFormatSec(rpNum("decay", 2.5))) + (meas > 0.05 ? "  meas " + rpFormatSec(meas) : "");
    }
    if (algo === RP_ALGO.CONV) txt = "";
    var maxW = algo === RP_ALGO.CONV ? L.browse.x - x - 70 : w - x - 4;
    if (rpTextW(txt, 7.5, true) > maxW) txt = txt.replace(/ +meas.*/, "");
    rpText(txt, x, 24, 7.5, RPC.dim, true);
    if (algo === RP_ALGO.CONV) {
        var nm = rpState.ir.loaded ? (rpState.ir.name || "impulse response") : "no IR";
        if (nm.length > 14) nm = nm.substring(0, 13) + "…";
        rpText(nm, L.browse.x - rpTextW(nm, 7.5, true) - 4, 24, 7.5, rpState.ir.loaded ? RPC.text : RPC.amber, true);
        var b = L.browse, c = L.clear;
        rpColor(RPC.dim, 1);
        mgraphics.set_line_width(1.1);
        mgraphics.rectangle(b.x + 1, b.y + 3, 13, 7);
        mgraphics.stroke();
        mgraphics.move_to(b.x + 1, b.y + 3); mgraphics.line_to(b.x + 4, b.y + 1); mgraphics.line_to(b.x + 7, b.y + 1); mgraphics.line_to(b.x + 8, b.y + 3);
        mgraphics.stroke();
        rpColor(rpState.ir.loaded ? RPC.dim : RPC.frame, 1);
        mgraphics.move_to(c.x + 3, c.y + 2); mgraphics.line_to(c.x + 11, c.y + 9);
        mgraphics.move_to(c.x + 11, c.y + 2); mgraphics.line_to(c.x + 3, c.y + 9);
        mgraphics.stroke();
    }
}

// ---- RT60-ratio strip with the dry / wet spectra behind it ----------------------------------------------------------------

function rcRatioFn(algo, info) {
    if (algo === RP_ALGO.CONV) {
        var mid = Math.max(info.t.mid, 0.05);
        return function (f) { return info.curve[rpClamp(Math.floor(rcFreqPos(f, info.sr) * RC.BANDS), 0, RC.BANDS - 1)] / mid; };
    }
    var damp = rpNum("damp", 7000), xo = rpNum("xover", 350), bm = rpNum("bassmult", 1.2);
    return function (f) { return rcRatioTank(f, damp, xo, bm); };
}

function rcDrawStrip(L, algo, info, hs) {
    var S = L.strip;
    var i;
    rpColor(RPC.frame, 0.28);
    mgraphics.rectangle(S.x, S.y, S.w, S.h);
    mgraphics.fill();
    var arr = [[RCS.dry, RPC.dim, 0.20, 0.55], [RCS.wet, RPC.cyan, 0.16, 0.7]];
    for (var k = 0; k < arr.length; k++) {
        var a = arr[k];
        mgraphics.move_to(S.x, S.y + S.h);
        for (i = 0; i < RC.BANDS; i++) mgraphics.line_to(S.x + S.w * (i + 0.5) / RC.BANDS, S.y + S.h - rcLevel01(a[0][i]) * (S.h - 2));
        mgraphics.line_to(S.x + S.w, S.y + S.h);
        mgraphics.close_path();
        rpColor(a[1], a[2]);
        mgraphics.fill();
    }
    // 1x line, then the decay-multiplier curve
    var my = rcStripMid();
    rpColor(RPC.frame, 0.9);
    mgraphics.set_line_width(0.8);
    mgraphics.move_to(S.x, my); mgraphics.line_to(S.x + S.w, my); mgraphics.stroke();
    var ratio = rcRatioFn(algo, info);
    for (var x = S.x; x <= S.x + S.w + 0.1; x += 3) {
        var y = rcStripY(ratio(rcXToFreq(x, info.sr)));
        if (x === S.x) mgraphics.move_to(x, y);
        else mgraphics.line_to(x, y);
    }
    rpColor(RPC.text, 0.9);
    mgraphics.set_line_width(1.3);
    mgraphics.stroke();
    // the output band-pass: dim everything the Low Cut / High Cut remove
    rpColor(RPC.bg, 0.6);
    mgraphics.rectangle(S.x, S.y, Math.max(0, hs[3].x - S.x), S.h);
    mgraphics.fill();
    mgraphics.rectangle(hs[4].x, S.y, Math.max(0, S.x + S.w - hs[4].x), S.h);
    mgraphics.fill();
    rpText("longer", 4, S.y + 7, 6, RPC.dim);
    rpText("shorter", 4, S.y + S.h - 1, 6, RPC.dim);
    var ticks = [[100, "100"], [1000, "1k"], [10000, "10k"]];
    for (i = 0; i < ticks.length; i++) rpText(ticks[i][1], rcFreqX(ticks[i][0], info.sr, 1) + 2, S.y + S.h + 5, 6, RPC.dim);
}

// ---- handles ----------------------------------------------------------------------------------------------------------

function rcHandleList(algo, info) {
    return rcHandles(rpNum, algo, info.sr, algo === RP_ALGO.CONV ? rcRatioFn(algo, info) : null);
}

function rcNode(h, selected, dragging, valueText) {
    var r = 5.5;
    var c = RPC[h.color];
    var a = h.on ? 1 : 0.35;
    if (selected) {
        rpColor(c, 0.9 * a);
        mgraphics.set_line_width(1);
        mgraphics.ellipse(h.x - r - 2.5, h.y - r - 2.5, 2 * r + 5, 2 * r + 5);
        mgraphics.stroke();
    }
    rpColor(c, 0.92 * a);
    mgraphics.ellipse(h.x - r, h.y - r, 2 * r, 2 * r);
    mgraphics.fill();
    rpColor(RPC.bg, 1);
    mgraphics.set_line_width(1);
    mgraphics.ellipse(h.x - r, h.y - r, 2 * r, 2 * r);
    mgraphics.stroke();
    rpText(String(h.num), h.x - 2.3, h.y + 2.8, 7.5, RPC.bg, true);
    if (dragging && valueText) {
        var tw = rpTextW(valueText, 7.5, true) + 10;
        var bx = rpClamp(h.x - tw / 2, 2, 396 - tw - 2);
        var by = h.y - r - 17 < 31 ? h.y + r + 4 : h.y - r - 16;
        rpPill(bx, by, tw, 12, RPC.bg, 0.92);
        rpColor(c, 0.9);
        mgraphics.set_line_width(0.8);
        mgraphics.rectangle_rounded(bx + 0.5, by + 0.5, tw - 1, 11, 11, 11);
        mgraphics.stroke();
        rpText(valueText, bx + 5, by + 9, 7.5, RPC.text, true);
    }
}

function rcDrawHandles(L, hs, ro) {
    var S = L.strip;
    var i, h;
    // guides: a hairline in the handle's colour from the plot down through the strip for the frequency handles
    for (i = 1; i <= 4; i++) {
        h = hs[i];
        if (!h.vis) continue;
        rpColor(RPC[h.color], (RCS.sel === i ? 0.7 : 0.28) * (h.on ? 1 : 0.4));
        mgraphics.set_line_width(0.8);
        mgraphics.move_to(h.x, i >= 3 ? h.y : RCG.yBack - 12); mgraphics.line_to(h.x, S.y + S.h);
        mgraphics.stroke();
    }
    // the decay stalk: from the handle down to the front axis
    h = hs[0];
    rpColor(RPC[h.color], RCS.sel === 0 ? 0.8 : 0.4);
    mgraphics.set_line_width(0.8);
    mgraphics.move_to(h.x, h.y); mgraphics.line_to(h.x, RCG.yFront); mgraphics.stroke();
    for (i = 0; i < hs.length; i++) {
        h = hs[i];
        if (!h.vis) continue;
        rcNode(h, RCS.sel === i, RCS.drag === i, ro[i].value);
    }
}

// ---- readout bar ----------------------------------------------------------------------------------------------------------

var RC_BAR_LABEL = ["DECAY", "HF DAMP", "BASS/XOVR", "LOW CUT", "HIGH CUT", "PRE-DLY"];

function rcDrawBar(L, hs, ro, algo) {
    rpColor(RPC.frame, 0.28);
    mgraphics.rectangle_rounded(L.bar.x, L.bar.y, L.bar.w, L.bar.h, 3, 3);
    mgraphics.fill();
    for (var i = 0; i < 6; i++) {
        var c = rcCellRect(L.bar, i);
        var h = hs[i];
        var col = RPC[h.color];
        var sel = RCS.sel === i;
        if (sel) {
            rpPill(c.x + 1, c.y + 1, c.w - 2, c.h - 2, col, 0.20);
        }
        // the colour tie: a hairline across the top of the cell
        rpColor(col, (sel ? 1 : 0.5) * (h.on ? 1 : 0.4));
        mgraphics.set_line_width(sel ? 2 : 1);
        mgraphics.move_to(c.x + 4, c.y + 1.5); mgraphics.line_to(c.x + c.w - 4, c.y + 1.5); mgraphics.stroke();
        var label = i === 0 && algo === RP_ALGO.CONV ? "IR DECAY" : RC_BAR_LABEL[i];
        rpColor(col, h.vis ? 0.9 : 0.3);
        mgraphics.ellipse(c.x + 5, c.y + 6, 5, 5);
        mgraphics.fill();
        rpText(label, c.x + 12, c.y + 10.5, 6, sel ? RPC.text : RPC.dim, true);
        rpText(h.vis ? ro[i].value : "—", c.x + 5, c.y + 19.5, 7.5, h.vis && h.on ? RPC.text : RPC.dim, true);
        if (i > 0) {
            rpColor(RPC.frame, 0.7);
            mgraphics.set_line_width(0.8);
            mgraphics.move_to(c.x, c.y + 4); mgraphics.line_to(c.x, c.y + c.h - 4); mgraphics.stroke();
        }
    }
}

// ---- TAIL page --------------------------------------------------------------------------------------------------------------

var RC_CLIPS = ["Soft", "Hard", "Limit"];

function rcDrawTail(w) {
    var T = rcTailLayout(w);
    var i;
    for (i = 0; i < T.titles.length; i++) {
        var t = T.titles[i];
        rpText(t.text, t.x, t.y + 8, 7.5, RPC.dim, true);
        rpColor(RPC.frame, 0.9);
        mgraphics.set_line_width(1);
        mgraphics.move_to(t.x, t.y + 11.5); mgraphics.line_to(t.x + t.w, t.y + 11.5); mgraphics.stroke();
    }
    rpColor(RPC.frame, 0.7);
    mgraphics.set_line_width(1);
    mgraphics.move_to(T.div.x, T.div.y0); mgraphics.line_to(T.div.x, T.div.y1); mgraphics.stroke();
    for (i = 0; i < T.rows.length; i++) {
        var r = T.rows[i];
        var on = rpActive(r.key);
        var al = on ? 1 : 0.35;
        rpText(r.label, r.lx, r.ly + 9, 7.5, RPC.dim, true);
        if (r.kind === "chips") {
            var sel = rpIndex(rpNum("loopclip", 0), 3);
            for (var k = 0; k < 3; k++) {
                var cw = r.w / 3;
                var cx = r.x + k * cw;
                if (k === sel) {
                    rpPill(cx + 1, r.y, cw - 2, r.h, RPC.amber, 0.28 * al);
                    rpColor(RPC.amber, 0.9 * al);
                    mgraphics.set_line_width(0.8);
                    mgraphics.rectangle_rounded(cx + 1.5, r.y + 0.5, cw - 3, r.h - 1, r.h, r.h);
                    mgraphics.stroke();
                } else {
                    rpPill(cx + 1, r.y, cw - 2, r.h, RPC.frame, 0.4 * al);
                }
                rpText(RC_CLIPS[k], cx + cw / 2 - rpTextW(RC_CLIPS[k], 7.5, true) / 2, r.y + 9, 7.5, k === sel ? RPC.text : RPC.dim, true);
            }
            continue;
        }
        var v = rpNum(r.key, REP[r.key][3]);
        rpColor(RPC.frame, 0.5 * al);
        mgraphics.rectangle_rounded(r.x, r.y, r.w, r.h, 3, 3);
        mgraphics.fill();
        var fw = Math.max(0, (r.w - 2) * rcPos(r.key, v));
        if (fw > 0.5) {
            rpColor(RPC.cyan, 0.34 * al);
            mgraphics.rectangle_rounded(r.x + 1, r.y + 1, Math.max(fw, 2), r.h - 2, 2, 2);
            mgraphics.fill();
        }
        var txt = rcFormatTail(r.key, v);
        rpText(txt, r.x + r.w / 2 - rpTextW(txt, 7.5, true) / 2, r.y + 9, 7.5, RPC.text, true);
    }
    rpText("drag a bar to set it, double-click to reset", 6, 154, 7, RPC.dim, true);
}

// ---- pills, tabs -------------------------------------------------------------------------------------------------------------

function rcDrawPills(w, minX) {
    var pills = rpHeaderPills();
    var x = w - 2;
    for (var i = 0; i < pills.length; i++) {
        var pw = rpTextW(pills[i].label, 8, true) + 12;
        if (x - pw < minX) break;
        x -= pw;
        rpPill(x, 1, pw, 13, pills[i].color, 0.16);
        rpText(pills[i].label, x + 6, 10.6, 8, pills[i].color, true);
        x -= 4;
    }
}

var RC_TABS = ["SPACE", "TAIL"];

function rcDrawTabs(L) {
    for (var i = 0; i < 2; i++) {
        var t = L.tabs[i];
        var on = RCS.page === i;
        var tw = rpTextW(RC_TABS[i], 8, true);
        rpText(RC_TABS[i], t.x + (t.w - tw) / 2, t.y + 9.5, 8, on ? RPC.text : RPC.dim, true);
        if (on) {
            rpColor(RPC.cyan, 1);
            mgraphics.rectangle(t.x + 6, t.y + t.h, t.w - 12, 2);
            mgraphics.fill();
        }
    }
}

/** FROZEN pill and the loop CLIP LED after the tabs. @returns {number} x where the status ends */
function rcDrawStatus(frozen) {
    var x = 104;
    if (frozen) {
        rpPill(x, 2, 44, 11, [0.55, 0.82, 1, 1], 0.22);
        rpText("FROZEN", x + 6, 10.5, 7.5, [0.7, 0.9, 1, 1], true);
        x += 50;
    }
    if (rpNum("loop", 0) > 0) {
        var age = RCS.now - RCS.clipAt;
        var lit = RCS.clipAt > 0 && age < 1500 ? (age < 1000 ? 1 : 1 - (age - 1000) / 500) : 0;
        rpColor(RPC.coral, 0.25 + 0.75 * lit);
        mgraphics.ellipse(x, 4, 6, 6);
        mgraphics.fill();
        rpText("CLIP", x + 9, 10.5, 7, lit > 0 ? RPC.coral : RPC.dim, true);
        x += 36;
    }
    return x;
}

// ---- paint -------------------------------------------------------------------------------------------------------------------

function paint() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    rpRefreshTheme();
    rpColor(RPC.bg);
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();
    if (!RCS.now) RCS.now = Date.now();
    var L = rcLayout(w, h);
    var algo = rpAlgo();
    var frozen = rcFrozen();
    rcDrawTabs(L);
    rcDrawPills(w, rcDrawStatus(frozen));
    // hairline under the header line
    rpColor(RPC.frame, 0.9);
    mgraphics.set_line_width(1);
    mgraphics.move_to(0, 15.5); mgraphics.line_to(w, 15.5); mgraphics.stroke();
    if (RCS.page === 1) {
        rcDrawTail(w);
        return;
    }
    var info = rcRtInfo();
    var hs = rcHandleList(algo, info);
    var ro = rcReadout(rpNum, algo);
    rcDrawRuler(L, hs);
    rcDrawInfo(L, w, algo, info);
    rcDrawPlot(L, w, algo, frozen, info);
    rcDrawStrip(L, algo, info, hs);
    rcDrawHandles(L, hs, ro);
    rcDrawBar(L, hs, ro, algo);
}

// ---- mouse ------------------------------------------------------------------------------------------------------------------

function rcPick(x, y) {
    var L = rcLayout(mgraphics.size[0], mgraphics.size[1]);
    if (rcInRect(L.strip, x, y)) return rcStripBand(x);
    if (rcInRect(L.plot, x, y)) return rcHitBand(x, y);
    return -1;
}

function rcTailSet(w, key, x) {
    var T = rcTailLayout(w);
    for (var i = 0; i < T.rows.length; i++) {
        var r = T.rows[i];
        if (r.key !== key || r.kind !== "bar") continue;
        rpSend(key, rcVal(key, (x - r.x - 1) / (r.w - 2)));
    }
}

function onclick(x, y, but) {
    if (!but) return;
    var w = mgraphics.size[0];
    var L = rcLayout(w, mgraphics.size[1]);
    var i;
    for (i = 0; i < 2; i++) {
        if (rcInRect(L.tabs[i], x, y)) { RCS.page = i; RCS.drag = -1; RCS.tailDrag = ""; mgraphics.redraw(); return; }
    }
    if (RCS.page === 1) {
        var th = rcTailHit(w, x, y);
        if (!th || !rpActive(th.key)) return;
        if (th.chip >= 0) { rpSend("loopclip", th.chip); return; }
        RCS.tailDrag = th.key;
        rcTailSet(w, th.key, x);
        return;
    }
    var algo = rpAlgo();
    var conv = algo === RP_ALGO.CONV;
    if (conv && rcInRect(L.browse, x, y)) { rpCmd("browse_ir"); return; }
    if (conv && rcInRect(L.clear, x, y)) { rpCmd("clear_ir"); return; }
    var hs = rcHandleList(algo, rcRtInfo());
    var id = rcHitHandle(hs, x, y, 10);
    if (id >= 0) { RCS.sel = id; RCS.drag = id; mgraphics.redraw(); return; }
    for (i = 0; i < 6; i++) {
        if (rcInRect(rcCellRect(L.bar, i), x, y)) { if (hs[i].vis) RCS.sel = i; mgraphics.redraw(); return; }
    }
    if (conv && !rpState.ir.loaded && rcInRect(L.plot, x, y)) { rpCmd("browse_ir"); return; }
    var b = rcPick(x, y);
    if (b >= 0) {
        RCS.band = b === RCS.band ? -1 : b;
        RCS.bandDrag = true;
        mgraphics.redraw();
    }
}

function ondrag(x, y, but) {
    if (!but) { RCS.drag = -1; RCS.tailDrag = ""; RCS.bandDrag = false; mgraphics.redraw(); return; }
    if (RCS.drag >= 0) {
        var info = rcRtInfo();
        var wr = rcDragWrites(RCS.drag, x, y, info.sr, rpAlgo());
        for (var i = 0; i < wr.length; i++) rpSend(wr[i][0], wr[i][1]);
        return;
    }
    if (RCS.tailDrag) { rcTailSet(mgraphics.size[0], RCS.tailDrag, x); return; }
    if (!RCS.bandDrag) return;
    var b = rcPick(x, y);
    if (b >= 0 && b !== RCS.band) { RCS.band = b; mgraphics.redraw(); }
}

function ondblclick(x, y) {
    var w = mgraphics.size[0];
    var algo = rpAlgo();
    if (RCS.page === 1) {
        var th = rcTailHit(w, x, y);
        if (th && rpActive(th.key) && th.chip < 0) rpSend(th.key, REP[th.key][3]);
        return;
    }
    var hs = rcHandleList(algo, rcRtInfo());
    var id = rcHitHandle(hs, x, y, 10);
    if (id >= 0) {
        var wr = rcResetWrites(id, algo);
        for (var i = 0; i < wr.length; i++) rpSend(wr[i][0], wr[i][1]);
        RCS.sel = id;
        return;
    }
    RCS.band = -1;
    mgraphics.redraw();
}

// ---- scripts/render_preview.py ----------------------------------------------------------------------------------------

function preview() {
    rpPreviewBase(1, 2.5);
    rpP.algo = 1; rpP.decay = 2.5; rpP.bassmult = 1.6; rpP.xover = 350; rpP.damp = 7000; rpP.loop = 40; rpP.predelay = 20;
    rpP.lowcut = 60; rpP.highcut = 16000; rpP.modrate = 0.6; rpP.moddepth = 25; rpP.erlevel = 0; rpP.latelevel = 0;
    rpP.duck = 20; rpP.duckrel = 250; rpP.output = 0; rpP.looplevel = 0; rpP.loopclip = 0; rpP.irdecay = 100;
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
    RCS.sel = 2;
    RCS.now = 1;
    RCS.clipAt = 0;
    rcPreviewExtra();
}

// Extra preview states for a human check (RC_PREVIEW=conv|freeze|tail|drag python3 scripts/render_preview.py ...); inert in Max.
function rcPreviewExtra() {
    var g = /** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : {});
    var mode = g.process && g.process.env ? g.process.env.RC_PREVIEW : "";
    if (mode === "freeze") {
        rpP.freeze = 1;
        rpT.s[RP_SCOPE.FREEZE] = 1;
        RCS.band = -1;
    } else if (mode === "tail") {
        RCS.page = 1;
    } else if (mode === "drag") {
        RCS.sel = 0;
        RCS.drag = 0;
    } else if (mode === "conv") {
        rpP.algo = 5;
        RCS.sel = 1;
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
