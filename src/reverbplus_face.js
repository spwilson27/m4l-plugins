// Reverb+ face (scripts/reverbplus_layouts/base.py, 444 x 169): the display of a Hybrid-Reverb-style device.
//   canvas   316 x 104 (316 x 135 on the Tail tab, it takes over the LCD row's space), between the tabs [Reverb | Tone | Tail]
//            (a hidden-state live.tab above it) and the LCD row of real live.* widgets below
//   tab 0    Reverb: the decay waterfall (pseudo-3D wet spectrum, amber predicted-decay ghost, dry / wet strip;
//            Convolution: the impulse response's spectrogram behind it). The LCD row under the display is Algorithm,
//            Size / Diffusion (tank) or the IR box, IR Start / Stretch / Reverse (Convolution).
//   tab 1    Tone: an EQ-style view. Cyan = output filters (Low Cut, High Cut), amber = how fast the tail decays per
//            frequency (Bass Mult below the Crossover, HF Damping shelf). Four draggable numbered nodes; double-click resets.
//   tab 2    Tail: nine rarely used parameters as drawn value bars / chips (Mod Rate / Depth, Early, Late, Output, Ducking
//            Amount / Release, Clip Level / Mode) driving off-face live.* parameters through rpSend, plus the clip LED.
// Show / hide of the widgets under the display: outlet 1 sends `g_<group> <0|1>` (1 = hide) per group, see rbVis, and
// `viz_tall <0|1>` (the canvas grows on the Tail tab).
// Build order: config + face_common + face_math + this file.

outlets = 2; // 0 = parameter / command stream (prelude), 1 = g_<group> hide flags and viz_tall for the layout's wiring

var RCS = {
    hist: rcHistNew(),
    wet: new Float32Array(RC.BANDS).fill(-120),
    dry: new Float32Array(RC.BANDS).fill(-120),
    lastPush: 0, clipAt: 0, now: 0, sig: "",
    irRows: null, irVer: -1, irLen: 0, irBusy: null, irName: "",
    node: -1, hover: -1, tailDrag: "", last: {},
};

rpPoll(20);

// ---- parameters / state -------------------------------------------------------------------------------------

function rbPage() {
    return rpIndex(rpNum("page", 0), 3);
}

/** Show / hide the groups of widgets under the display for the current page and algorithm (only what changed). */
function rbEmitVis() {
    var v = rbVis(rbPage(), rpAlgo());
    for (var i = 0; i < RB_GROUPS.length; i++) {
        var g = RB_GROUPS[i];
        var hide = v[g] ? 0 : 1;
        if (RCS.last[g] !== hide) { RCS.last[g] = hide; outlet(1, "g_" + g, hide); }
    }
    var tall = rbTall(rbPage()) ? 1 : 0;
    if (RCS.last.tall !== tall) { RCS.last.tall = tall; outlet(1, "viz_tall", tall); }
}

function onParam(key) {
    if (key === "algo" || key === "page") {
        rbEmitVis();
        if (key === "algo" && rpAlgo() === RP_ALGO.CONV) rcIrEnsure();
        RCS.node = -1;
        RCS.tailDrag = "";
    }
}

function onState(kind) {
    if (kind === "ir") rcIrEnsure();
    rbEmitVis();
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

/**
 * Telemetry poll (20 fps, only while the device is not idle). Only the Reverb tab needs the two 4096-point FFTs and the
 * waterfall history; the Tone tab is drawn from parameters alone and the Tail tab only follows the clip LED, so those
 * redraw (return true) only when something they show changed. Leaving the Reverb tab drops the history (its time stamps
 * would span the gap when the tab comes back).
 */
function onFrame(t) {
    if (!t.active) return false;
    var now = Date.now();
    RCS.now = now;
    var s = t.s;
    if (s && s[RP_SCOPE.CLIP_DB] < -0.1) RCS.clipAt = now;
    var page = rbPage();
    if (page === 0) {
        RCS.sig = "";
        rcSample(now);
        return true;
    }
    if (RCS.hist.rows.length) { RCS.hist = rcHistNew(); RCS.lastPush = 0; }
    var sig = (now - RCS.clipAt < 1700 ? 1 : 0) + "|" + (s ? s[RP_SCOPE.CLAMPED] + "|" + s[RP_SCOPE.MIN_MS] + "|" + s[RP_SCOPE.PAIRED] : "");
    if (sig === RCS.sig) return false;
    RCS.sig = sig;
    return true;
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
        rpText("play audio into the device", w * 0.5 - 48, 52, 8.5, RPC.dim, true);
    }
    if (frozen) {
        rpColor([0.55, 0.82, 1, 1], 0.07);
        mgraphics.rectangle(L.plot.x, L.plot.y, L.plot.w, L.plot.h);
        mgraphics.fill();
    }
    if (n >= 2 && !frozen) {
        var hit = rcFindHit(hist);
        if (hit > 0) {
            rcDrawGhost(hist, info.curve, hit, rcRowSec(hist));
        }
    }
    if (conv && !rpState.ir.loaded) {
        var msg = rpState.ir.status === "loading" || rpState.ir.status === "processing" ? "loading impulse response…" : "drop an impulse response anywhere";
        rpText(msg, w * 0.5 - 68, 52, 8.5, RPC.dim, true);
    } else if (conv && !RCS.irRows) {
        rpText("analysing impulse response…", w * 0.5 - 58, 40, 8, RPC.dim, true);
    }
    var ticks = [[100, "100"], [1000, "1k"], [10000, "10k"]];
    for (var i = 0; i < ticks.length; i++) rpText(ticks[i][1], rcFreqX(ticks[i][0], sr, 1) - 5, 86.5, 7, RPC.dim);
    if (conv && RCS.irRows) rpText("IR " + rpFormatSec(RCS.irLen / (RCS.irSr || sr)), w - 48, 21, 7, RPC.dim);
    if (frozen) {
        rpPill(w - 56, 24, 48, 11, [0.55, 0.82, 1, 1], 0.22);
        rpText("FROZEN", w - 50, 32, 7.5, [0.7, 0.9, 1, 1], true);
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
}

// ---- Tone page: EQ view ---------------------------------------------------------------------------------------------

function rbParams() {
    return { lowcut: rpNum("lowcut", 60), highcut: rpNum("highcut", 16000), damp: rpNum("damp", 7000), bassmult: rpNum("bassmult", 1.2),
        xover: rpNum("xover", 350) };
}

function rbNodeColor(nd) {
    return nd.decay ? RPC.amber : RPC.cyan;
}

function rbDrawTone(L, w) {
    var p = rbParams();
    var bassOn = rpActive("bassmult");
    var T = RBT;
    var i;
    // grid: decades, 0 dB and +-12 dB
    var fl = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    for (i = 0; i < fl.length; i++) {
        var gx = rbToneX(fl[i]);
        mgraphics.move_to(gx, T.y0); mgraphics.line_to(gx, T.y1);
        rpColor(RPC.frame, fl[i] === 100 || fl[i] === 1000 || fl[i] === 10000 ? 0.75 : 0.35);
        mgraphics.set_line_width(0.8);
        mgraphics.stroke();
    }
    var gl = [12, 0, -12];
    for (i = 0; i < gl.length; i++) {
        var gy = rbToneY(gl[i]);
        mgraphics.move_to(T.x0, gy); mgraphics.line_to(T.x1, gy);
        rpColor(RPC.frame, gl[i] === 0 ? 0.95 : 0.4);
        mgraphics.set_line_width(gl[i] === 0 ? 1 : 0.8);
        mgraphics.stroke();
        rpText(gl[i] > 0 ? "+" + gl[i] : String(gl[i]), 6, gy + 2.5, 7, RPC.dim);
    }
    var tk = [[100, "100"], [1000, "1k"], [10000, "10k"]];
    for (i = 0; i < tk.length; i++) rpText(tk[i][1], rbToneX(tk[i][0]) - 5, 100, 7, RPC.dim);
    // decay profile (amber): area to the zero line, then the line. Curves are cached while the parameters hold.
    var cv = rbToneCurves(p, bassOn);
    var zy = cv.zy;
    mgraphics.move_to(cv.xs[0], zy);
    for (i = 0; i < cv.n; i++) mgraphics.line_to(cv.xs[i], cv.decay[i]);
    mgraphics.line_to(T.x1, zy);
    mgraphics.close_path();
    rpColor(RPC.amber, 0.12);
    mgraphics.fill();
    mgraphics.move_to(cv.xs[0], cv.decay[0]);
    for (i = 1; i < cv.n; i++) mgraphics.line_to(cv.xs[i], cv.decay[i]);
    rpColor(RPC.amber, 0.95);
    mgraphics.set_line_width(1.2);
    mgraphics.stroke();
    // output filter (cyan)
    mgraphics.move_to(cv.xs[0], cv.filt[0]);
    for (i = 1; i < cv.n; i++) mgraphics.line_to(cv.xs[i], cv.filt[i]);
    rpColor(RPC.cyan, 1);
    mgraphics.set_line_width(1.6);
    mgraphics.stroke();
    // nodes
    var nodes = rbNodes(p, bassOn);
    for (i = 0; i < nodes.length; i++) {
        var nd = nodes[i];
        var nx = rbToneX(nd.f), ny = rbToneY(nd.db);
        var on = i === RCS.node || (RCS.node < 0 && i === RCS.hover);
        var col = rbNodeColor(nd);
        mgraphics.ellipse(nx - 6.5, ny - 6.5, 13, 13);
        rpColor(RPC.bg, 1);
        mgraphics.fill();
        mgraphics.ellipse(nx - 6.5, ny - 6.5, 13, 13);
        rpColor(col, on ? 1 : 0.85);
        mgraphics.set_line_width(on ? 1.8 : 1.2);
        mgraphics.stroke();
        if (on) {
            mgraphics.ellipse(nx - 6.5, ny - 6.5, 13, 13);
            rpColor(col, 0.25);
            mgraphics.fill();
        }
        rpText(String(nd.id), nx - 2.3, ny + 2.6, 7.5, col, true);
    }
    return nodes;
}

// ---- Tail tab: drawn value bars -----------------------------------------------------------------------------------------

var RB_CLIPS = ["Soft", "Hard", "Limit"];

function rbDrawTail(w) {
    var T = rbTailLayout(w);
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
        var al = rpActive(r.key) ? 1 : 0.35;
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
                rpText(RB_CLIPS[k], cx + cw / 2 - rpTextW(RB_CLIPS[k], 7.5, true) / 2, r.y + 9, 7.5, k === sel ? RPC.text : RPC.dim, true);
            }
            continue;
        }
        var v = rpNum(r.key, REP[r.key][3]);
        rpColor(RPC.frame, 0.5 * al);
        mgraphics.rectangle_rounded(r.x, r.y, r.w, r.h, 3, 3);
        mgraphics.fill();
        var fw = Math.max(0, (r.w - 2) * rcPos(r.key, v));
        if (fw > 0.5) {
            rpColor(r.key === "looplevel" ? RPC.amber : RPC.cyan, 0.34 * al);
            mgraphics.rectangle_rounded(r.x + 1, r.y + 1, Math.max(fw, 2), r.h - 2, 2, 2);
            mgraphics.fill();
        }
        var txt = rcFormatTail(r.key, v);
        rpText(txt, r.x + r.w / 2 - rpTextW(txt, 7.5, true) / 2, r.y + 9, 7.5, RPC.text, true);
    }
    // clip LED (lights while the Feedback Clip reduces the loop)
    var age = RCS.now - RCS.clipAt;
    var lit = RCS.clipAt > 0 && age < 1500 ? (age < 1000 ? 1 : 1 - (age - 1000) / 500) : 0;
    rpColor(RPC.coral, 0.25 + 0.75 * lit);
    mgraphics.ellipse(T.led.x, T.led.y, 6, 6);
    mgraphics.fill();
    rpText("drag a bar to set it, double-click to reset", T.hint.x, T.hint.y, 7, RPC.dim, true);
}

// ---- info row -------------------------------------------------------------------------------------------------------

function rcDrawPills(w, minX) {
    var pills = rpHeaderPills();
    var x = w - 2;
    for (var i = 0; i < pills.length; i++) {
        var pw = rpTextW(pills[i].label, 7.5, true) + 12;
        if (x - pw < minX) break;
        x -= pw;
        rpPill(x, 0, pw, 11, pills[i].color, 0.16);
        rpText(pills[i].label, x + 6, 8.4, 7.5, pills[i].color, true);
        x -= 4;
    }
}

function rbDrawInfo(w, page, algo, info) {
    // Reverb page: no top-left text (algorithm name / RT60 readout removed from the face)
    if (page === 1) {
        var names = { lowcut: "LOW CUT", highcut: "HIGH CUT", damp: "HF DAMP", bassmult: "BASS" };
        var nodes = rbNodes(rbParams(), rpActive("bassmult"));
        var k = RCS.node >= 0 ? RCS.node : RCS.hover;
        if (k >= 0 && k < nodes.length) {
            var nd = nodes[k];
            var val = nd.key === "bassmult" ? "x" + rpNum("bassmult", 1.2).toFixed(2) + " below " + rpFormatHz(rpNum("xover", 350)) : rpFormatHz(nd.f);
            rpText(names[nd.key], 4, 9, 8.5, rbNodeColor(nd), true);
            rpText(val, 4 + rpTextW(names[nd.key], 8.5, true) * 1.12 + 10, 9, 8, RPC.text, true);
        } else {
            rpColor(RPC.cyan, 1); mgraphics.rectangle(4, 4, 8, 2.5); mgraphics.fill();
            rpText("output filter", 16, 9, 7.5, RPC.dim, true);
            rpColor(RPC.amber, 1); mgraphics.rectangle(80, 4, 8, 2.5); mgraphics.fill();
            rpText("decay by frequency", 92, 9, 7.5, RPC.dim, true);
        }
    } else if (page === 2) {
        rpText("TAIL", 4, 9, 8.5, RPC.text, true);
        rpText("modulation, levels, ducking, clip", 4 + rpTextW("TAIL", 8.5, true) * 1.12 + 10, 9, 8, RPC.dim, true);
    }
    rcDrawPills(w, page === 1 ? 150 : (page === 2 ? 170 : 150));
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
    var L = rcLayout(w, h);
    var algo = rpAlgo();
    var page = rbPage();
    var frozen = rcFrozen();
    var info = rcRtInfo();
    rbDrawInfo(w, page, algo, info);
    if (page === 0) {
        rcDrawPlot(L, w, algo, frozen, info);
        rcDrawStrip(L, info);
    } else if (page === 1) {
        rbDrawTone(L, w);
    } else {
        rbDrawTail(w);
    }
}

// ---- mouse ---------------------------------------------------------------------------------------------------------

function rbNodesNow() {
    return rbNodes(rbParams(), rpActive("bassmult"));
}

function rbTailSet(key, x) {
    var T = rbTailLayout(mgraphics.size[0]);
    for (var i = 0; i < T.rows.length; i++) {
        var r = T.rows[i];
        if (r.key !== key || r.kind !== "bar") continue;
        rpSend(key, rcVal(key, (x - r.x - 1) / (r.w - 2)));
    }
}

// Test hook (scripts/test_reverbplus_live.js): while Global("reverbplus_test").hoverOn is set, the display records where the real
// pointer is / was clicked (display-local x, y) and its tab, so a test can locate the device on screen and prove clicks and hovers
// reach the display through the whole-face drop target.
var rcTestG = null;
function rcTestNote(kind, x, y, but) {
    try {
        if (!rcTestG) rcTestG = new Global("reverbplus_test");
        if (!rcTestG.hoverOn) return;
        rcTestG[kind] = JSON.stringify({ x: x, y: y, but: but, page: rbPage(), t: Date.now() });
    } catch (e) { /* no Global: ignore */ }
}

function onclick(x, y, but) {
    rcTestNote("click", x, y, but);
    if (!but) return;
    var page = rbPage();
    if (page === 1) {
        RCS.node = rbHitNode(rbNodesNow(), x, y, 10);
        mgraphics.redraw();
        return;
    }
    if (page === 2) {
        var th = rbTailHit(mgraphics.size[0], x, y);
        if (!th || !rpActive(th.key)) return;
        if (th.chip >= 0) { rpSend("loopclip", th.chip); return; }
        RCS.tailDrag = th.key;
        rbTailSet(th.key, x);
        return;
    }
    var L = rcLayout(mgraphics.size[0], mgraphics.size[1]);
    var conv = rpAlgo() === RP_ALGO.CONV;
    if (conv && !rpState.ir.loaded && rcInRect(L.plot, x, y)) rpCmd("browse_ir");
}

function ondrag(x, y, but) {
    if (!but) { RCS.tailDrag = ""; return; }
    var page = rbPage();
    if (page === 2) {
        if (RCS.tailDrag) rbTailSet(RCS.tailDrag, x);
        return;
    }
    if (page === 1) {
        var nodes = rbNodesNow();
        if (RCS.node < 0 || RCS.node >= nodes.length) return;
        var vals = rbNodeDrag(nodes[RCS.node], x, y);
        for (var k in vals) {
            var cur = rpNum(k, vals[k]);
            if (Math.abs(vals[k] - cur) > Math.abs(cur) * 0.002) rpSend(k, vals[k]);
        }
    }
}

function onidle(x, y) {
    rcTestNote("hover", x, y, 0);
    if (rbPage() !== 1) return;
    var h = rbHitNode(rbNodesNow(), x, y, 10);
    if (h !== RCS.hover) { RCS.hover = h; mgraphics.redraw(); }
}

function onidleout() {
    if (RCS.hover >= 0) { RCS.hover = -1; mgraphics.redraw(); }
}

function ondblclick(x, y) {
    if (rbPage() === 2) {
        var th = rbTailHit(mgraphics.size[0], x, y);
        if (th && rpActive(th.key) && th.chip < 0) rpSend(th.key, REP[th.key][3]);
        return;
    }
    if (rbPage() === 1) {
        var nodes = rbNodesNow();
        var i = rbHitNode(nodes, x, y, 10);
        if (i < 0) return;
        var key = nodes[i].key;
        if (key === "lowcut") rpSend("lowcut", 60);
        else if (key === "highcut") rpSend("highcut", 16000);
        else if (key === "damp") rpSend("damp", 7000);
        else { rpSend("xover", 350); rpSend("bassmult", 1.2); }
    }
}

// ---- scripts/render_preview.py ----------------------------------------------------------------------------------------

/** RC_PAGE (0..2) and RC_ALGO (0..5) pick the preview state (the build reads them too, they set the saved state): `RC_PAGE=1 python3 scripts/build_reverbplus.py`. */
function preview() {
    var g = /** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : {});
    var env = g.process && g.process.env ? g.process.env : {};
    var page = env.RC_PAGE ? Number(env.RC_PAGE) : 0;
    var algo = env.RC_ALGO ? Number(env.RC_ALGO) : 1;
    rpPreviewBase(algo, 2.5);
    rpP.algo = algo; rpP.page = page; rpP.decay = 2.5; rpP.bassmult = 1.3; rpP.xover = 350; rpP.damp = 7000; rpP.predelay = 20;
    rpP.lowcut = 60; rpP.highcut = 16000; rpP.loopclip = 0; rpP.looplevel = 0; rpP.modrate = 0.6; rpP.moddepth = 25; rpP.erlevel = 0;
    rpP.latelevel = 0; rpP.duck = 20; rpP.duckrel = 250; rpP.output = 0;
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
    RCS.node = page === 1 ? 2 : -1;
    RCS.now = 1;
    RCS.clipAt = 0;
    if (algo === 5) {
        rpT.s = rpFakeScope(5, 2.2);
        var st = rcIrNew(100000);
        var psd = new Float64Array(RC.BANDS);
        for (var q = 0; q < 50; q++) {
            for (var b2 = 0; b2 < RC.BANDS; b2++) psd[b2] = Math.exp(-q / (6 + 22 * (1 - b2 / RC.BANDS))) * (1 + 0.3 * Math.sin(b2 * 0.9 + q * 0.3)) * Math.pow(10, -b2 * 0.02);
            rcIrAdd(st, q * 2000, psd);
        }
        RCS.irRows = rcIrFinish(st);
        RCS.irLen = 100000;
        RCS.irSr = 48000;
        RCS.irVer = 1;
    }
}
