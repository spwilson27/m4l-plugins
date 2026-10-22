// Reverb+ face `b` ("Hybrid tabs", scripts/reverbplus_layouts/b.py): the display of a Hybrid-Reverb-style device.
//   canvas   394 x 104, between the page tabs (a hidden-state live.tab above it) and the LCD row of real live.* widgets below
//   page 0   Reverb: the decay waterfall (pseudo-3D wet spectrum, amber predicted-decay ghost, band pick, dry / wet strip;
//            Convolution: the impulse response's spectrogram behind it). The LCD row under the display is Algorithm,
//            Decay / Size / Diffusion / Mod (tank) or the IR box, IR Start / Stretch / Decay / Reverse (Convolution).
//   page 1   Tone: an EQ-style view. Cyan = output filters (Low Cut, High Cut), amber = how fast the tail decays per
//            frequency (Bass Mult below the Crossover, HF Damping shelf). Four draggable numbered nodes; double-click resets.
//   page 2   Loop: the outer-loop diagram (Reverb -> your devices -> clip -> back into the reverb) with Loop amount,
//            time, clip mode / level, MIN warning and the clip LED.
// Show / hide of the widgets under the display: outlet 1 sends `g_<group> <0|1>` (1 = hide) per group, see rbVis.
// Build order: config + face_common + face_b_math + this file.

outlets = 2; // 0 = parameter / command stream (prelude), 1 = g_<group> hide flags for the widgets under the display

var RCS = {
    hist: rcHistNew(),
    wet: new Float32Array(RC.BANDS).fill(-120),
    dry: new Float32Array(RC.BANDS).fill(-120),
    band: -1, drag: false, lastPush: 0, clipAt: 0, now: 0,
    irRows: null, irVer: -1, irLen: 0, irBusy: null, irName: "",
    node: -1, hover: -1, last: {},
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
}

function onParam(key) {
    if (key === "algo" || key === "page") {
        rbEmitVis();
        if (key === "algo" && rpAlgo() === RP_ALGO.CONV) rcIrEnsure();
        RCS.node = -1;
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
            rpColor(RPC.amber, 0.95);
            mgraphics.set_line_width(1.2);
            mgraphics.move_to(6, 22); mgraphics.line_to(16, 22); mgraphics.stroke();
            rpText("predicted decay", 19, 24.5, 7, RPC.amber, true);
        }
    }
    if (RCS.band >= 0 && n >= 2) rcDrawRibbon(hist, RCS.band);
    if (conv && !rpState.ir.loaded) {
        var msg = rpState.ir.status === "loading" || rpState.ir.status === "processing" ? "loading impulse response…" : "drop an impulse response on the IR box below";
        rpText(msg, w * 0.5 - 68, 52, 8.5, RPC.dim, true);
    } else if (conv && !RCS.irRows) {
        rpText("analysing impulse response…", w * 0.5 - 58, 40, 8, RPC.dim, true);
    }
    var ticks = [[100, "100"], [1000, "1k"], [10000, "10k"]];
    for (var i = 0; i < ticks.length; i++) rpText(ticks[i][1], rcFreqX(ticks[i][0], sr, 1) - 5, 86.5, 7, RPC.dim);
    var rowSec = rcRowSec(hist);
    if (conv && RCS.irRows) {
        rpText("IR " + rpFormatSec(RCS.irLen / (RCS.irSr || sr)), w - 48, 21, 7, RPC.dim);
    } else {
        rpText("now", w - 20, 86.5, 7, RPC.dim);
        rpText("back -" + rpFormatSec(rowSec * (RC.ROWS - 1)), w - 58, 21, 7, RPC.dim);
    }
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
    if (RCS.band >= 0) {
        rpColor(RPC.text, 0.16);
        mgraphics.rectangle(S.x + S.w * RCS.band / RC.BANDS, S.y, S.w / RC.BANDS, S.h);
        mgraphics.fill();
    }
    rpText("WET", S.x + S.w - 52, S.y + 8, 6.5, RPC.cyan, true);
    rpText("DRY", S.x + S.w - 28, S.y + 8, 6.5, RPC.dim, true);
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
    var i, f;
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
    // decay profile (amber): area to the zero line, then the line
    var step = 2;
    var zy = rbToneY(0);
    mgraphics.move_to(T.x0, zy);
    for (f = T.x0; f <= T.x1; f += step) mgraphics.line_to(f, rbToneY(rbDecayDb(rbToneF(f), bassOn ? p.bassmult : 1, p.xover, p.damp)));
    mgraphics.line_to(T.x1, zy);
    mgraphics.close_path();
    rpColor(RPC.amber, 0.12);
    mgraphics.fill();
    for (f = T.x0; f <= T.x1; f += step) {
        var ya = rbToneY(rbDecayDb(rbToneF(f), bassOn ? p.bassmult : 1, p.xover, p.damp));
        if (f === T.x0) mgraphics.move_to(f, ya);
        else mgraphics.line_to(f, ya);
    }
    rpColor(RPC.amber, 0.95);
    mgraphics.set_line_width(1.2);
    mgraphics.stroke();
    // output filter (cyan)
    for (f = T.x0; f <= T.x1; f += step) {
        var yc = rbToneY(rbFilterDb(rbToneF(f), p.lowcut, p.highcut));
        if (f === T.x0) mgraphics.move_to(f, yc);
        else mgraphics.line_to(f, yc);
    }
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

// ---- Loop page: outer-loop diagram -----------------------------------------------------------------------------------

function rbBox(r, title, sub, col, subCol) {
    rpColor(RPC.frame, 0.5);
    mgraphics.rectangle_rounded(r.x, r.y, r.w, r.h, 6, 6);
    mgraphics.fill();
    rpColor(col, 0.9);
    mgraphics.set_line_width(1.1);
    mgraphics.rectangle_rounded(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 6, 6);
    mgraphics.stroke();
    rpText(title, r.x + (r.w - rpTextW(title, 7, true)) / 2, r.y + 12, 7, RPC.dim, true);
    rpText(sub, r.x + (r.w - rpTextW(sub, 8.5, true)) / 2, r.y + 26, 8.5, subCol || RPC.text, true);
}

function rbArrow(x0, y0, x1, y1, col, alpha, wd) {
    mgraphics.move_to(x0, y0); mgraphics.line_to(x1, y1);
    rpColor(col, alpha);
    mgraphics.set_line_width(wd);
    mgraphics.stroke();
    var a = Math.atan2(y1 - y0, x1 - x0);
    mgraphics.move_to(x1, y1);
    mgraphics.line_to(x1 - 6 * Math.cos(a - 0.45), y1 - 6 * Math.sin(a - 0.45));
    mgraphics.line_to(x1 - 6 * Math.cos(a + 0.45), y1 - 6 * Math.sin(a + 0.45));
    mgraphics.close_path();
    rpColor(col, alpha);
    mgraphics.fill();
}

function rbDrawLoop(L, w) {
    var G = rbLoopGeom(w);
    var s = rpT.s;
    var loop = rpNum("loop", 0);
    var on = loop > 0;
    var clipNames = ["Soft", "Hard", "Limit"];
    var algo = rpAlgo();
    rbBox(G.tank, "REVERB", RP_ALGOS[algo].toUpperCase(), RPC.cyan);
    var lat = rpState.link.paired ? "L " + rpState.link.latency + " smp" : "no Reverb+ End";
    rbBox(G.chain, "YOUR DEVICES", lat, rpState.link.paired ? RPC.dim : RPC.amber, rpState.link.paired ? RPC.text : RPC.amber);
    var clip = clipNames[rpIndex(rpNum("loopclip", 0), 3)] + "  " + rpNum("looplevel", 0).toFixed(1) + " dB";
    rbBox(G.clip, "CLIP", clip, RPC.amber);
    var y = G.tank.y + G.tank.h / 2;
    rbArrow(G.tank.x + G.tank.w + 2, y, G.chain.x - 2, y, RPC.dim, 0.9, 1.2);
    rbArrow(G.chain.x + G.chain.w + 2, y, G.clip.x - 2, y, RPC.dim, 0.9, 1.2);
    // output to Reverb+ End
    rbArrow(G.clip.x + G.clip.w + 2, y, G.clip.x + G.clip.w + 13, y, RPC.dim, 0.9, 1.2);
    // return path: clip -> down -> left -> up into the reverb
    var cx = G.clip.x + G.clip.w / 2, tx = G.tank.x + G.tank.w / 2;
    var wd = 1 + 2.2 * Math.min(1.1, loop / 100);
    var col = on ? RPC.amber : RPC.frame;
    mgraphics.move_to(cx, G.clip.y + G.clip.h + 1);
    mgraphics.line_to(cx, G.returnY);
    mgraphics.line_to(tx, G.returnY);
    rpColor(col, on ? 0.95 : 0.9);
    mgraphics.set_line_width(wd);
    mgraphics.stroke();
    rbArrow(tx, G.returnY, tx, G.tank.y + G.tank.h + 2, col, on ? 0.95 : 0.9, wd);
    var lab = on ? "LOOP " + loop.toFixed(0) + " %   " + rpFormatMs(s ? s[RP_SCOPE.LOOP_MS] : rpNum("looptime", 120)) : "LOOP OFF";
    var lw = rpTextW(lab, 8.5, true);
    rpText(lab, (cx + tx) / 2 - lw / 2, G.returnY - 5, 8.5, on ? RPC.text : RPC.dim, true);
    if (on && s && s[RP_SCOPE.CLAMPED] > 0.5) {
        var mt = "MIN " + rpFormatMs(s[RP_SCOPE.MIN_MS]);
        var mw = rpTextW(mt, 7.5, true) + 12;
        rpPill((cx + tx) / 2 - mw / 2, G.returnY + 4, mw, 11, RPC.amber, 0.2);
        rpText(mt, (cx + tx) / 2 - mw / 2 + 6, G.returnY + 12.3, 7.5, RPC.amber, true);
    }
    // clip LED (lights while the clip reduces the loop)
    var age = RCS.now - RCS.clipAt;
    var lit = RCS.clipAt > 0 && age < 1500 ? (age < 1000 ? 1 : 1 - (age - 1000) / 500) : 0;
    rpColor(RPC.coral, 0.25 + 0.75 * lit);
    mgraphics.ellipse(G.clip.x + G.clip.w - 10, G.clip.y + 4, 6, 6);
    mgraphics.fill();
    var note = "Devices between Reverb+ and Reverb+ End process the tail; what comes out feeds back in.";
    rpText(note, 6, 100, 7, RPC.dim);
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
    var s = rpT.s;
    var txt = "";
    var col = RPC.dim;
    if (page === 0) {
        var name = RP_ALGOS[algo].toUpperCase();
        rpText(name, 4, 9, 8.5, RPC.text, true);
        var x = 4 + rpTextW(name, 8.5, true) * 1.12 + 10;
        if (RCS.band >= 0) {
            var b = RCS.band;
            var meas2 = rcMeasured(RCS.hist, b, info.sr);
            txt = rcFmtHz(rcBandHz(b, info.sr)) + "Hz  RT " + rpFormatSec(info.curve[b]) + (meas2 ? " / " + rpFormatSec(meas2) : " / —");
            col = RPC.text;
        } else if (!s) {
            txt = "waiting for the device";
        } else {
            var meas = s[RP_SCOPE.RT60_MEAS];
            txt = (algo === RP_ALGO.CONV ? "IR" : "RT60 " + rpFormatSec(rpNum("decay", 2.5))) + (meas > 0.05 ? "  meas " + rpFormatSec(meas) : "");
        }
        rpText(txt, x, 9, 8, col, true);
    } else if (page === 1) {
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
    } else {
        rpText("OUTER LOOP", 4, 9, 8.5, RPC.text, true);
        rpText("through your devices", 4 + rpTextW("OUTER LOOP", 8.5, true) * 1.12 + 10, 9, 8, RPC.dim, true);
    }
    rcDrawPills(w, page === 1 ? 190 : (page === 2 ? 170 : 150));
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
        rbDrawLoop(L, w);
    }
}

// ---- mouse ---------------------------------------------------------------------------------------------------------

function rcPick(x, y) {
    var L = rcLayout(mgraphics.size[0], mgraphics.size[1]);
    if (rcInRect(L.strip, x, y)) return rcStripBand(x);
    if (rcInRect(L.plot, x, y)) return rcHitBand(x, y);
    return -1;
}

function rbNodesNow() {
    return rbNodes(rbParams(), rpActive("bassmult"));
}

function onclick(x, y, but) {
    if (!but) return;
    var page = rbPage();
    if (page === 1) {
        RCS.node = rbHitNode(rbNodesNow(), x, y, 10);
        mgraphics.redraw();
        return;
    }
    if (page !== 0) return;
    var L = rcLayout(mgraphics.size[0], mgraphics.size[1]);
    var conv = rpAlgo() === RP_ALGO.CONV;
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
    var page = rbPage();
    if (page === 1) {
        var nodes = rbNodesNow();
        if (RCS.node < 0 || RCS.node >= nodes.length) return;
        var vals = rbNodeDrag(nodes[RCS.node], x, y);
        for (var k in vals) {
            var cur = rpNum(k, vals[k]);
            if (Math.abs(vals[k] - cur) > Math.abs(cur) * 0.002) rpSend(k, vals[k]);
        }
        return;
    }
    if (!RCS.drag) return;
    var b = rcPick(x, y);
    if (b >= 0 && b !== RCS.band) { RCS.band = b; mgraphics.redraw(); }
}

function onidle(x, y) {
    if (rbPage() !== 1) return;
    var h = rbHitNode(rbNodesNow(), x, y, 10);
    if (h !== RCS.hover) { RCS.hover = h; mgraphics.redraw(); }
}

function onidleout() {
    if (RCS.hover >= 0) { RCS.hover = -1; mgraphics.redraw(); }
}

function ondblclick(x, y) {
    if (rbPage() === 1) {
        var nodes = rbNodesNow();
        var i = rbHitNode(nodes, x, y, 10);
        if (i < 0) return;
        var key = nodes[i].key;
        if (key === "lowcut") rpSend("lowcut", 60);
        else if (key === "highcut") rpSend("highcut", 16000);
        else if (key === "damp") rpSend("damp", 7000);
        else { rpSend("xover", 350); rpSend("bassmult", 1.2); }
        return;
    }
    RCS.band = -1;
    mgraphics.redraw();
}

// ---- scripts/render_preview.py ----------------------------------------------------------------------------------------

/** RCB_PAGE (0..2) and RCB_ALGO (0..5) pick the preview state: `RCB_PAGE=1 python3 scripts/render_preview.py ...`. */
function preview() {
    var g = /** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : {});
    var env = g.process && g.process.env ? g.process.env : {};
    var page = env.RCB_PAGE ? Number(env.RCB_PAGE) : 0;
    var algo = env.RCB_ALGO ? Number(env.RCB_ALGO) : 1;
    rpPreviewBase(algo, 2.5);
    rpP.algo = algo; rpP.page = page; rpP.decay = 2.5; rpP.bassmult = 1.3; rpP.xover = 350; rpP.damp = 7000; rpP.loop = 40; rpP.predelay = 20;
    rpP.lowcut = 60; rpP.highcut = 16000; rpP.looptime = 120; rpP.loopclip = 0; rpP.looplevel = 0;
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
    RCS.band = page === 0 ? 14 : -1;
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
