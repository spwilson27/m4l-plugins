// transplit_ui.js — Transient Split face (v8ui, one canvas, Bitwig Transient Split (Spectral) display) + spectral_link wiring.
// The build concatenates transplit_config.js, spectral_link.js, this file into the v8ui script.
//
// Canvas (TS_VIZ_W x TS_VIZ_H), like Bitwig's display:
//   top row     `Tilt 0.00 %` (yellow) and `Decay 8.00` (yellow): drag the value vertically, double-click resets
//   left slider Analysis Bias (-100..+100 %, centre marker), right slider Transients/Tones Blend (0..100 %, 50 % centre)
//   plot        Display Style Waveform: scrolling amplitude view, Transients above zero (yellow), Tones below (blue);
//               Display Style Sonogram: frequency-domain history, cells coloured yellow (transient) .. blue (tone)
//   bottom row  Display Style icons (Waveform | Sonogram), PRE | POST toggle, `Smoothing 1.50` (blue, drag to edit)
// The live.* objects stay outside the canvas (right column); canvas edits go out of outlet 0 into them.
//
// Messages in:  set_<key> <value> for ttype bias tdecay tsmooth tilt tmode blend mix size output dispost disstyle,
//               setnames <scope buffer> <ring buffer>, init_link (live.thisdevice), dsp_restart <chain> (test hook), names / preview helpers.
// Outlets:      0 [key value]  edits made on the canvas -> route -> the live.* object (which then drives gen as usual)
//               1 [key value]  values applied from a rack peer -> route -> `prepend set` into the live.* object + gen
//               2 gen messages -> the ss_genin hub (gate 1 1; the gen~ is created after load, src/spectral_dsp.js): outsel <0|1|2> (0 = all
//                 channels summed), scope / ring / lead <buffer name>, role, serve, epoch (rack sharing, src/spectral_link.js), parameters (re-sent)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 3;

var TS_VIZ_W = 280;
var TS_VIZ_H = 141;
var TS_LCD_H = 92;
var TS_PLOT = { x: 20, y: 4, w: 240, h: 84 };
var TS_SLIDER_L = { x: 5, y: 6, w: 10, h: 80 };
var TS_SLIDER_R = { x: 265, y: 6, w: 10, h: 80 };
var TS_PANELS = [["obj-panel-body", "live_surface_bg"], ["obj-panel-det", "live_desktop"], ["obj-panel-ana", "live_desktop"], ["obj-panel-out", "live_desktop"]];
var tsThemeTask = sptThemeWatch(function () { sptApplyPanelTheme(TS_PANELS); });
function tsColTr() { return sptColor("live_display_line_one"); }
function tsColTone() { return sptColor("live_display_line_two"); }
var TS_SONO_COLS = 60;
var TS_SONO_ROWS = 22;
var TS_WAVE_VIEW = 80;                 // telemetry frames shown by the waveform (3 px each)
var TS_DEFAULTS = { tilt: 0, tdecay: 8, tsmooth: 1.5, bias: 0, blend: 50 };

var tsVals = { ttype: 0, bias: 0, tdecay: 8, tsmooth: 1.5, tilt: 0, tmode: 0, blend: 50, mix: 100, size: 1, output: 0, dispost: 0, disstyle: 0 };
var tsPre = [];
var tsTr = [];
var tsTone = [];
var tsFrac = [];
var tsSono = [];          // rows of {lv: [...60], fr: [...60]}, newest last
var tsWave = [];          // {pt, pq, ot, oq} linear rms per telemetry frame, newest last
var tsScalars = { frame: 0, awake: 0, sr: 48000, n: 1024, level: 0, mean: 0 };
var tsNames = { scope: "", ring: "" };
var tsBufName = "";            // the buffer the display is drawn from (the leader's scope while following)
var tsBuf = null;
var tsOwnBuf = null;
var tsTask = null;
var tsLastFrame = -1;
var tsIdleDrawn = false;
var tsDrag = null;
var tsLink = null;
var tsInfo = { instanceId: "", isInRack: false, chainIndex: 0, chainCount: 0, peers: 1, linked: false, autoChannel: -1 };
var tsSel = 0;
var tsLastSel = -1;

(function initArrays() {
    for (var i = 0; i < TS_NCOLS; i++) {
        tsPre.push(0);
        tsTr.push(0);
        tsTone.push(0);
        tsFrac.push(0);
    }
})();

// ---------------------------------------------------------------- state in
function tsSetVal(key, v) {
    var changed = tsVals[key] !== v;
    tsVals[key] = v;
    if (key === "output") tsEmitSel();
    if (tsLink && TS_LINKED_KEYS.indexOf(key) >= 0) tsLink.notify(key, v);
    if (changed) mgraphics.redraw();
}

function set_ttype(v) { tsSetVal("ttype", Number(v)); }
function set_bias(v) { tsSetVal("bias", Number(v)); }
function set_tdecay(v) { tsSetVal("tdecay", Number(v)); }
function set_tsmooth(v) { tsSetVal("tsmooth", Number(v)); }
function set_tilt(v) { tsSetVal("tilt", Number(v)); }
function set_tmode(v) { tsSetVal("tmode", Number(v)); }
function set_blend(v) { tsSetVal("blend", Number(v)); }
function set_mix(v) { tsSetVal("mix", Number(v)); }
function set_size(v) { tsSetVal("size", Number(v)); }
function set_output(v) { tsSetVal("output", Number(v)); }
function set_dispost(v) { tsSetVal("dispost", Number(v) ? 1 : 0); }
function set_disstyle(v) { tsSetVal("disstyle", Number(v) ? 1 : 0); }

function tsEmitSel() {
    tsSel = tsResolveSel(tsVals.output, tsInfo.autoChannel);
    if (tsSel !== tsLastSel) {
        tsLastSel = tsSel;
        outlet(2, "outsel", tsSel);
    }
}

// ---------------------------------------------------------------- link
function init_link() {
    if (tsLink) return;
    if (typeof LiveAPI === "undefined" || typeof Global === "undefined") return;
    tsLink = splCreateLink({
        kind: "transplit",
        keys: TS_LINKED_KEYS,
        channelCount: 2,
        rack: {
            channels: TS_RACK_CHANNELS,
            ring: function () { return tsNames.ring; },
            genState: function () { return { alive: tsGenValue(TS_SC_ALIVE), fb: Math.max(0, tsGenValue(TS_SC_FB)) }; },
            send: function (name, value) { outlet(2, name, value); }
        },
        getLocal: function (key) { return tsVals[key]; },
        apply: function (key, value) {
            tsVals[key] = value;
            outlet(1, key, value);
            mgraphics.redraw();
        },
        onInfo: function (info) {
            tsInfo = info;
            ssDspDry(0);
            tsEmitSel();
            mgraphics.redraw();
        }
    });
    tsLink.init();
    tsStartPolling();
    ssDspSchedule(tsInfo.instanceId);
}

function setnames(scopeName, ringName) {
    tsNames.scope = scopeName ? String(scopeName) : "";
    tsNames.ring = ringName ? String(ringName) : "";
    splNoteScope(tsNames.scope);
    tsBuf = null;
    tsOwnBuf = null;
    tsStartPolling();
}

// Kept for tools that only know the scope buffer.
function setbuffer(name) {
    setnames(name, tsNames.ring);
}

// ---------------------------------------------------------------- deferred DSP (src/spectral_dsp.js) and rack messages
function tsGenValue(idx) {
    if (!tsNames.scope) return -1;
    try {
        if (!tsOwnBuf) tsOwnBuf = new Buffer(tsNames.scope);
        var v = tsOwnBuf.peek(1, idx, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (err) {
        tsOwnBuf = null;
        return -1;
    }
}

function ssGenAlive() {
    return tsGenValue(TS_SC_ALIVE);
}

// Every gen-bound message from the values the face holds (a deferred gen~ drops messages until it runs).
function ssDevResend() {
    if (tsNames.scope) outlet(2, "scope", tsNames.scope);
    if (tsNames.ring) outlet(2, "ring", tsNames.ring);
    for (var key in TS_GEN_PARAMS) {
        if (key in tsVals) outlet(2, TS_GEN_PARAMS[key][0], tsVals[key] * TS_GEN_PARAMS[key][1]);
    }
    outlet(2, "fftn", 512 * Math.pow(2, tsVals.size));
    outlet(2, "outsel", tsSel);
    if (tsLink && tsLink.rack) {
        var m = tsLink.rack.messages();
        for (var i = 0; i < m.length; i++) outlet(2, m[i][0], m[i][1]);
    }
}

function ssDevChanged() {
    mgraphics.redraw();
}

// Test hook (receive #0-sstest): restart the DSP of the instance in chain <c> [of device <kind> = SS_PREFIX] (a late start: a new gen~ with a new sample counter).
function dsp_restart(c, kind) {
    if (kind !== undefined && String(kind) !== SS_PREFIX) return;   // optional device filter: several racks share one test set
    if (tsInfo.chainIndex === Number(c) || Number(c) < 0) ssDspRestart();
}

function tsStartPolling() {
    if (tsTask || typeof Task === "undefined") return;
    tsTask = new Task(tsPoll, this);
    tsTask.interval = 66;
    tsTask.repeat();
}

function tsPushWave(pt, pq, ot, oq) {
    tsWave.push({ pt: pt, pq: pq, ot: ot, oq: oq });
    while (tsWave.length > TS_WAVE_VIEW) tsWave.shift();
}

function tsDispName() {
    var lead = tsLink && tsLink.rack ? tsLink.rack.displayScope() : "";
    return lead || tsNames.scope;
}

function tsPoll() {
    var name = tsDispName();
    if (!name) return;
    try {
        if (!tsBuf || name !== tsBufName) {
            tsBuf = new Buffer(name);
            tsBufName = name;
            tsLastFrame = -1;
        }
        // header first (frame counter, awake): the other 800 floats are only read when a new telemetry frame exists
        var h = tsBuf.peek(1, TS_SC_FRAME, 4);
        if (!h || h.length < 4) return;
        var frame = h[0];
        var aw = h[3];
        if (frame === tsLastFrame && aw === tsScalars.awake) return;
        if (aw < 0.5 && tsScalars.awake < 0.5 && tsIdleDrawn) {
            tsLastFrame = frame;
            return;
        }
        var d = tsBuf.peek(1, 0, TS_SCOPE_SAMPS);
        if (!d || d.length < TS_SC_WAVE + 4) return;
        // new waveform ring entries since the last poll (the ring holds TS_WAVE_FRAMES frames)
        if (aw > 0.5) {
            var delta = tsLastFrame < 0 ? Math.min(frame, TS_WAVE_FRAMES) : ((frame - tsLastFrame + TS_FRAME_WRAP) % TS_FRAME_WRAP);
            if (delta > TS_WAVE_FRAMES) delta = TS_WAVE_FRAMES;
            for (var i = frame - delta; i < frame; i++) {
                var f = ((i % TS_FRAME_WRAP) + TS_FRAME_WRAP) % TS_FRAME_WRAP;
                var o = TS_SC_WAVE + (f % TS_WAVE_FRAMES) * TS_WAVE_STRIDE;
                tsPushWave(d[o], d[o + 1], d[o + 2], d[o + 3]);
            }
        } else if (tsScalars.awake > 0.5) {
            for (var z = 0; z < 8; z++) tsPushWave(0, 0, 0, 0);
        }
        tsLastFrame = frame;
        for (var c = 0; c < TS_NCOLS; c++) {
            tsPre[c] = d[TS_SC_PRE + c];
            tsTr[c] = d[TS_SC_TR + c];
            tsTone[c] = d[TS_SC_TONE + c];
            tsFrac[c] = d[TS_SC_FRAC + c];
        }
        tsScalars.frame = frame;
        tsScalars.awake = aw;
        tsScalars.sr = d[TS_SC_SR];
        tsScalars.n = d[TS_SC_N];
        tsScalars.level = d[TS_SC_LEVEL];
        tsScalars.mean = d[TS_SC_TRMEAN];
        tsPushSono();
        tsIdleDrawn = aw < 0.5;
        mgraphics.redraw();
    } catch (err) {
        tsBuf = null;
    }
}

function tsPushSono() {
    var lv = [];
    var fr = [];
    var per = TS_NCOLS / TS_SONO_COLS;
    for (var c = 0; c < TS_SONO_COLS; c++) {
        var m = 0;
        var f = 0;
        var wsum = 0;
        for (var j = 0; j < per; j++) {
            var i = Math.min(Math.floor(c * per + j), TS_NCOLS - 1);
            var l = tsSel === 1 ? tsTr[i] : (tsSel === 2 ? tsTone[i] : tsPre[i]);
            if (tsVals.dispost === 0) l = tsPre[i];
            if (l > m) m = l;
            f += tsFrac[i] * (l + 0.01);
            wsum += l + 0.01;
        }
        lv.push(m);
        fr.push(f / wsum);
    }
    tsSono.push({ lv: lv, fr: fr });
    while (tsSono.length > TS_SONO_ROWS) tsSono.shift();
}

// ---------------------------------------------------------------- drawing helpers
// 0..1 level (-100..0 dB) -> plot height fraction, floor at -80 dB
function tsLv(v) {
    var t = (v * 100 - 20) / 80;
    return !(t > 0) ? 0 : (t > 1 ? 1 : t);      // NaN / negative -> 0
}

// linear rms -> 0..1 (-60..0 dB)
function tsAmp(v) {
    if (!(v > 1e-9)) return 0;
    var t = (20 * Math.log(v) / Math.LN10 + 60) / 60;
    return t < 0 ? 0 : (t > 1 ? 1 : t);
}

var TS_LOG_SPAN = Math.log(TS_FMAX / TS_FMIN);
function tsFreqX(f) {
    var t = Math.log(f / TS_FMIN) / TS_LOG_SPAN;
    return TS_PLOT.x + t * TS_PLOT.w;
}

function tsInside(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// ---------------------------------------------------------------- layout (hit rects shared by paint and interaction)
function tsRects() {
    return {
        tilt: { x: 0, y: 112, w: 92, h: 14 },
        decay: { x: 94, y: 112, w: 92, h: 14 },
        smooth: { x: 188, y: 112, w: 92, h: 14 },
        wave: { x: 156, y: 96, w: 16, h: 12 },
        sono: { x: 176, y: 96, w: 16, h: 12 },
        post: { x: TS_PLOT.x + TS_PLOT.w - 34, y: TS_PLOT.y + 3, w: 30, h: 13 }
    };
}

function tsSliderY(sl, frac) {
    return sl.y + sl.h * (1 - sptClamp(frac, 0, 1));
}

// ---------------------------------------------------------------- paint
function paint() {
    var W = TS_VIZ_W;
    var drag = tsDrag ? tsDrag.kind : "";
    var R = tsRects();
    var cTr = tsColTr();
    var cTone = tsColTone();
    var mid = TS_PLOT.y + TS_PLOT.h * 0.5;

    // display: near-black LCD with a faint grid (zero line and quarter levels)
    sptLcd(0, 0, W, TS_LCD_H, { xs: [TS_PLOT.x - 3, TS_PLOT.x + TS_PLOT.w + 3], ys: [mid - TS_PLOT.h * 0.25, mid, mid + TS_PLOT.h * 0.25] });

    if (tsVals.disstyle) tsPaintSono();
    else tsPaintWave();
    if (tsScalars.awake < 0.5) sptText("no signal", TS_PLOT.x + TS_PLOT.w * 0.5, mid - 4, sptColor("live_display_scale_text"), SPT_SIZE, 1);
    var pill = ssDspPill();
    if (pill) sptText(pill, TS_PLOT.x + 4, TS_PLOT.y + 11, sptColor(ssDsp.error ? "live_alert" : "live_control_selection"), SPT_SIZE_SMALL, 0);

    tsPaintSlider(TS_SLIDER_L, (tsVals.bias + 100) / 200, drag === "bias");
    tsPaintSlider(TS_SLIDER_R, tsVals.blend / 100, drag === "blend");

    // Pre / Post toggle (top right of the LCD)
    sptButton(R.post.x, R.post.y, R.post.w, R.post.h, "Post", tsVals.dispost ? 1 : 0);

    // legend row: the output channel of this instance is the bright one; display style icons; chain chip on the right
    var ly = 105;
    var names = ["Transients", "Tones"];
    var cols = [cTr, cTone];
    var lx = 2;
    for (var i = 0; i < 2; i++) {
        var on = tsSel === 0 || tsSel === i + 1;
        sptLegendSwatch(lx, ly - 5, sptMuted(cols[i], on ? 1 : 0.55));
        sptText(names[i], lx + 9, ly, on ? sptColor("live_control_fg") : sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 0);
        lx += 9 + sptTextW(names[i], SPT_SIZE_SMALL) + 12;
    }
    tsPaintIcon(R.wave, 0, tsVals.disstyle === 0);
    tsPaintIcon(R.sono, 1, tsVals.disstyle === 1);
    var chip = tsInfo.isInRack ? ("Chain " + (tsInfo.chainIndex + 1) + "/" + Math.max(tsInfo.chainCount, 1)
        + (tsInfo.linked ? ", linked" : "")) : "No rack";
    // the chip must not run into the display style icons (x 156..192): shorten it when needed
    var chipMinX = R.sono.x + R.sono.w + 3;
    if (W - 2 - sptTextW(chip, SPT_SIZE_SMALL) < chipMinX) chip = tsInfo.isInRack ? ("Chain " + (tsInfo.chainIndex + 1)) : "No rack";
    sptTextIn(chip, W - 2, ly, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 2, { x: chipMinX, y: ly - 8, w: W - chipMinX, h: 11 });

    // value rows: Tilt / Decay / Smoothing (drag to edit), latency footnote
    sptLabelValue("Tilt", tsFormatPct(sptClamp(tsVals.tilt, -999, 999)), R.tilt.x, R.tilt.y + 11, 0, drag === "tilt", 36);
    sptLabelValue("Decay", tsFormatBlocks(sptClamp(tsVals.tdecay, 0, 999)), R.decay.x, R.decay.y + 11, 0, drag === "tdecay", 40);
    sptLabelValue("Smoothing", tsFormatBlocks(sptClamp(tsVals.tsmooth, 0, 999)), R.smooth.x, R.smooth.y + 11, 0, drag === "tsmooth", 56);
    sptText("Latency " + TS_LATENCY + " smp", 0, 138, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 0);
}

function tsPaintIcon(r, kind, on) {
    var col = on ? sptColor("live_control_selection") : sptColor("live_display_scale_text");
    sptRgba(col);
    mgraphics.set_line_width(1);
    var i;
    if (kind === 0) {
        // decaying burst
        var hs = [0.9, 0.55, 0.8, 0.35, 0.5, 0.2, 0.3, 0.12];
        for (i = 0; i < hs.length; i++) {
            var cx = r.x + 1.5 + i * 1.9;
            mgraphics.move_to(cx, r.y + r.h * 0.5 - hs[i] * r.h * 0.5);
            mgraphics.line_to(cx, r.y + r.h * 0.5 + hs[i] * r.h * 0.5);
        }
        mgraphics.stroke();
    } else {
        var bh = [0.35, 0.7, 0.5, 0.9, 0.3, 0.55, 0.2];
        for (i = 0; i < bh.length; i++) {
            mgraphics.rectangle(r.x + 1 + i * 2.2, r.y + r.h - 1 - bh[i] * (r.h - 2), 1.4, bh[i] * (r.h - 2));
            mgraphics.fill();
        }
    }
}

// centre-marked vertical slider inside the LCD: 1 px track, centre tick, line from the centre to a hollow orange handle
function tsPaintSlider(s, frac, active) {
    var hc = sptColor("live_display_handle_one");
    var tx = s.x + s.w * 0.5;
    var cy = s.y + s.h * 0.5;
    var hy = tsSliderY(s, frac);
    sptRgba(sptColor("live_display_scale_text"), 0.5);
    mgraphics.rectangle(tx - 0.5, s.y, 1, s.h);
    mgraphics.fill();
    sptRgba(sptColor("live_display_scale_text"), 0.9);
    mgraphics.rectangle(tx - 3.5, Math.round(cy) - 0.5, 7, 1);
    mgraphics.fill();
    sptRgba(hc, 0.75);
    mgraphics.rectangle(tx - 0.5, Math.min(hy, cy), 1, Math.abs(cy - hy));
    mgraphics.fill();
    sptHandle(tx, hy, active ? sptMix(hc, [1, 1, 1, 1], 0.35) : hc, "", 3.5);
}

// Waveform: Transients above zero (orange), Tones below (cyan), newest on the right; thin muted outline over a faint fill.
// Post dims the channel that is not this instance's output; Pre shows the analysis split before Tilt / Blend.
function tsPaintWave() {
    var mid = TS_PLOT.y + TS_PLOT.h * 0.5;
    var half = TS_PLOT.h * 0.5 - 3;
    var fw = TS_PLOT.w / TS_WAVE_VIEW;
    var cTr = tsColTr();
    var cTone = tsColTone();
    var post = tsVals.dispost === 1;
    var trA = post && tsSel === 2 ? 0.35 : 1;
    var toA = post && tsSel === 1 ? 0.35 : 1;
    var off = TS_WAVE_VIEW - tsWave.length;
    var ptsT = [];
    var ptsQ = [];
    var wfill = Math.max(fw - 0.5, 1);
    for (var i = 0; i < tsWave.length; i++) {
        var w = tsWave[i];
        var t = tsAmp(post ? w.ot : w.pt) * half;
        var q = tsAmp(post ? w.oq : w.pq) * half;
        var x = TS_PLOT.x + (off + i) * fw;
        if (t > 0.4) {
            sptRgba(cTr, 0.18 * trA);
            mgraphics.rectangle(x, mid - t, wfill, t);
            mgraphics.fill();
        }
        if (q > 0.4) {
            sptRgba(cTone, 0.18 * toA);
            mgraphics.rectangle(x, mid, wfill, q);
            mgraphics.fill();
        }
        ptsT.push([x, mid - t]);
        ptsT.push([x + wfill, mid - t]);
        ptsQ.push([x, mid + q]);
        ptsQ.push([x + wfill, mid + q]);
    }
    sptCurve(ptsT, sptMuted(cTr, 0.75), trA);
    sptCurve(ptsQ, sptMuted(cTone, 0.75), toA);
    sptCurve([[TS_PLOT.x, mid], [TS_PLOT.x + TS_PLOT.w, mid]], sptColor("live_display_scale_text"), 0.8);
}

function tsPaintSono() {
    var cw = TS_PLOT.w / TS_SONO_COLS;
    var rh = TS_PLOT.h / TS_SONO_ROWS;
    var off = TS_SONO_ROWS - tsSono.length;
    var cTr = tsColTr();
    var cTone = tsColTone();
    for (var r = 0; r < tsSono.length; r++) {
        var row = tsSono[r];
        var y = TS_PLOT.y + (off + r) * rh;
        for (var c = 0; c < TS_SONO_COLS; c++) {
            var a = tsLv(row.lv[c]);
            if (a < 0.04) continue;
            sptRgba(sptMuted(sptMix(cTone, cTr, sptClamp(row.fr[c], 0, 1)), 0.85), 0.10 + 0.75 * a);
            mgraphics.rectangle(TS_PLOT.x + c * cw, y, cw + 0.3, rh + 0.3);
            mgraphics.fill();
        }
    }
}

// ---------------------------------------------------------------- interaction
function tsEmitEdit(key, v) {
    outlet(0, key, v);
}

function onclick(x, y) {
    tsHandleDown(x, y, false);
}

function ondblclick(x, y) {
    tsHandleDown(x, y, true);
}

function tsSliderHit(s, x, y) {
    return x >= s.x - 3 && x <= s.x + s.w + 3 && y >= s.y - 4 && y <= s.y + s.h + 4;
}

function tsHandleDown(x, y, dbl) {
    var R = tsRects();
    if (tsInside(R.post, x, y)) {
        tsEmitEdit("dispost", tsVals.dispost ? 0 : 1);
        return;
    }
    if (tsInside(R.wave, x, y)) {
        tsEmitEdit("disstyle", 0);
        return;
    }
    if (tsInside(R.sono, x, y)) {
        tsEmitEdit("disstyle", 1);
        return;
    }
    var keys = [["tilt", R.tilt], ["tdecay", R.decay], ["tsmooth", R.smooth]];
    for (var i = 0; i < keys.length; i++) {
        if (tsInside(keys[i][1], x, y)) {
            if (dbl) tsEmitEdit(keys[i][0], TS_DEFAULTS[keys[i][0]]);
            else tsDrag = { kind: keys[i][0], y0: y, v0: tsVals[keys[i][0]] };
            return;
        }
    }
    if (tsSliderHit(TS_SLIDER_L, x, y)) {
        if (dbl) tsEmitEdit("bias", 0);
        else {
            tsDrag = { kind: "bias" };
            tsDragTo(x, y);
        }
        return;
    }
    if (tsSliderHit(TS_SLIDER_R, x, y)) {
        if (dbl) tsEmitEdit("blend", 50);
        else {
            tsDrag = { kind: "blend" };
            tsDragTo(x, y);
        }
    }
}

function ondrag(x, y, but) {
    if (!but) {
        tsDrag = null;
        return;
    }
    tsDragTo(x, y);
}

function tsRound2(v) {
    return Math.round(v * 100) / 100;
}

function tsDragTo(x, y) {
    if (!tsDrag) return;
    var v;
    if (tsDrag.kind === "bias") {
        v = Math.round((1 - (y - TS_SLIDER_L.y) / TS_SLIDER_L.h) * 200 - 100);
        v = Math.max(-100, Math.min(100, v));
        if (Math.abs(v) < 3) v = 0;
        if (v !== tsVals.bias) tsEmitEdit("bias", v);
    } else if (tsDrag.kind === "blend") {
        v = Math.round((1 - (y - TS_SLIDER_R.y) / TS_SLIDER_R.h) * 100);
        v = Math.max(0, Math.min(100, v));
        if (Math.abs(v - 50) < 2) v = 50;
        if (v !== tsVals.blend) tsEmitEdit("blend", v);
    } else if (tsDrag.kind === "tilt") {
        v = Math.max(-100, Math.min(100, tsRound2(tsDrag.v0 + (tsDrag.y0 - y) * 1.0)));
        if (Math.abs(v) < 1) v = 0;
        if (v !== tsVals.tilt) tsEmitEdit("tilt", v);
    } else if (tsDrag.kind === "tdecay") {
        v = Math.max(1, Math.min(125, tsRound2(tsDrag.v0 * Math.pow(2, (tsDrag.y0 - y) / 24))));
        if (v !== tsVals.tdecay) tsEmitEdit("tdecay", v);
    } else if (tsDrag.kind === "tsmooth") {
        v = Math.max(1, Math.min(64, tsRound2(tsDrag.v0 * Math.pow(2, (tsDrag.y0 - y) / 24))));
        if (v !== tsVals.tsmooth) tsEmitEdit("tsmooth", v);
    }
}

function onidle() {}
function onidleout() {}

// ---------------------------------------------------------------- preview (scripts/render_preview.py calls preview() then paint())
function preview() {
    ssDsp.ready = 1;
    tsInfo = { instanceId: "p", isInRack: true, chainIndex: 0, chainCount: 2, peers: 2, linked: true, autoChannel: 0 };
    // demo state = the live.* parameter defaults (Tilt 0, Decay 8, Smoothing 1.5, Bias 0, Blend 50)
    tsVals.dispost = 1;
    tsVals.disstyle = 0;
    tsSel = 1;
    tsScalars.awake = 1;
    // drum hits (sharp transients with decaying tails) over a sustained tone
    for (var i = 0; i < TS_WAVE_VIEW; i++) {
        var ph = i % 20;
        var hit = i >= 4 ? Math.exp(-ph / 1.6) * (0.55 - 0.004 * (i % 40)) : 0;
        var tone = 0.012 + 0.006 * Math.sin(i * 0.35) + (i > 30 ? 0.008 : 0);
        tsPushWave(hit, tone, hit * 0.98, tone * 0.98);
    }
    for (var c = 0; c < TS_NCOLS; c++) {
        var f = TS_FMIN * Math.pow(TS_FMAX / TS_FMIN, c / TS_NCOLS);
        var base = 0.72 - 0.22 * Math.log(f / 100) / Math.log(100) + 0.04 * Math.sin(c * 1.7);
        tsPre[c] = Math.max(0.05, base * 0.8);
        tsFrac[c] = c > 55 ? 0.6 : 0.1;
        tsTr[c] = tsPre[c] * 0.8;
        tsTone[c] = tsPre[c] * 0.8;
    }
}
