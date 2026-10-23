// loudsplit_ui.js — Loud Split face (v8ui, one canvas) + spectral_link wiring. The build concatenates
//   loudsplit_config.js, spectral_link.js, this file  into the v8ui script.
//
// Canvas (LS_VIZ_W x LS_VIZ_H), laid out like Bitwig's Loud Split display: top row = `Relative Loudness Mode` toggle (left) and
// `Rise` value (right), bottom row = `Tilt` value (left) and `Fall` value (right) (click the toggle, drag a value vertically,
// double-click resets; Rise / Fall are logarithmic, Tilt linear); a second HUD row holds the resolved channel pill, chain chip and
// the PRE/POST and SPEC/SONO toggles; between them a log-frequency level plot (-110..0 dB): the Mid spectrum coloured by the Quiet / Mid / Loud share of each column (or the three channels after
// the masks, or a scrolling sonogram) with the two threshold lines on top. A line is dragged vertically; Alt / Shift / Ctrl-drag
// sets its Knee (the shaded band is the crossfade). The line follows Tilt (it is the weighted level that is classified) and, in
// Relative mode, the loudest bin of the frame. A dot at the right end of each line is a momentary band solo: while it is held
// this instance outputs that threshold's outer band (Higher: Loud, Lower: Quiet). Double-click a line resets the threshold.
//
// Messages in:  set_<key> <value> for hithr lothr rhithr rlothr hiknee loknee relative rise fall tilt size output dispost disstyle,
//               setnames <scope buffer> <ring buffer>, init_link (live.thisdevice), dsp_restart <chain> (test hook), preview helpers.
// Outlets:      0 [key value]  edits made on the canvas -> route -> the live.* object (which then drives gen as usual)
//               1 [key value]  values applied from a rack peer -> route -> `prepend set` into the live.* object + gen
//               2 gen messages -> the ss_genin hub (gate 1 1; the gen~ is created after load, src/spectral_dsp.js): outsel <0..3> (0 = all
//                 channels summed, including a held solo), scope / ring / lead <buffer name>, role, serve, epoch (rack sharing, src/spectral_link.js),
//                 parameters (re-sent)
//               3 act_abs|act_rel <0|1>  greys out the unused threshold pair (route -> prepend active)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 4;

var LS_VIZ_W = 284;
var LS_VIZ_H = 141;
var LS_PLOT = { x: 1, y: 1, w: 262, h: 90 };     // inside the 284 x 92 LCD rectangle
var LS_LCD = { x: 0, y: 0, w: 284, h: 92 };
var LS_DOT_X = 274;
var LS_DOT_GAP = 10;                              // min distance between the two solo handles
var LS_LABEL_GAP = 10;                            // min distance between the two threshold labels
var LS_DOT_MIN_Y = 20;                            // handles stay below the Post / Sono buttons
var LS_SONO_COLS = 64;
var LS_SONO_ROWS = 22;
var LS_DEFAULTS = { hithr: -30, lothr: -85, rhithr: -12, rlothr: -36, rise: 2, fall: 8, tilt: 0 };

var lsVals = { hithr: -30, lothr: -85, rhithr: -12, rlothr: -36, hiknee: 6, loknee: 6, relative: 0, rise: 2, fall: 8, tilt: 0,
    mix: 100, size: 1, output: 0, dispost: 0, disstyle: 0 };
var lsPre = [];
var lsQ = [];
var lsM = [];
var lsL = [];
var lsSono = [];          // rows of {lv: [...64], w: [[q, m, l] ...]}, newest last
var lsScalars = { frame: 0, awake: 0, sr: 48000, n: 2048, level: 0, mean: 0, lmax: -20 };
var lsLmaxS = -20;        // smoothed loudest-bin level (Relative mode lines)
var lsNames = { scope: "", ring: "" };
var lsBufName = "";            // the buffer the display is drawn from (the leader's scope while following)
var lsBuf = null;
var lsOwnBuf = null;
var lsTask = null;
var lsLastFrame = -1;
var lsIdleDrawn = false;
var lsDrag = null;
var lsSolo = "";          // "hi" | "lo" while a solo dot is held
var lsLink = null;
var lsInfo = { instanceId: "", isInRack: false, chainIndex: 0, chainCount: 0, peers: 1, linked: false, autoChannel: -1 };
var lsSel = 0;
var lsLastSel = -1;
var lsLastAct = -1;

(function initArrays() {
    for (var i = 0; i < LS_NCOLS; i++) {
        lsPre.push(0);
        lsQ.push(0);
        lsM.push(0);
        lsL.push(0);
    }
})();

// ---------------------------------------------------------------- state in
function lsSetVal(key, v) {
    if (typeof v !== "number" || !isFinite(v)) return;     // a NaN / Infinity would poison every y mapping
    var changed = lsVals[key] !== v;
    lsVals[key] = v;
    if (key === "output") lsEmitSel();
    if (key === "relative") lsEmitActive();
    if (lsLink && LS_LINKED_KEYS.indexOf(key) >= 0) lsLink.notify(key, v);
    if (changed) mgraphics.redraw();
}

function set_hithr(v) { lsSetVal("hithr", Number(v)); }
function set_lothr(v) { lsSetVal("lothr", Number(v)); }
function set_rhithr(v) { lsSetVal("rhithr", Number(v)); }
function set_rlothr(v) { lsSetVal("rlothr", Number(v)); }
function set_hiknee(v) { lsSetVal("hiknee", Number(v)); }
function set_loknee(v) { lsSetVal("loknee", Number(v)); }
function set_relative(v) { lsSetVal("relative", Number(v) ? 1 : 0); }
function set_rise(v) { lsSetVal("rise", Number(v)); }
function set_fall(v) { lsSetVal("fall", Number(v)); }
function set_tilt(v) { lsSetVal("tilt", Number(v)); }
function set_mix(v) { lsSetVal("mix", Number(v)); }
function set_size(v) { lsSetVal("size", Number(v)); }
function set_output(v) { lsSetVal("output", Number(v)); }
function set_dispost(v) { lsSetVal("dispost", Number(v) ? 1 : 0); }
function set_disstyle(v) { lsSetVal("disstyle", Number(v) ? 1 : 0); }

function lsEmitSel() {
    var base = lsResolveSel(lsVals.output, lsInfo.autoChannel);
    lsSel = lsSolo === "hi" ? 1 : (lsSolo === "lo" ? 3 : base);
    if (lsSel !== lsLastSel) {
        lsLastSel = lsSel;
        outlet(2, "outsel", lsSel);
    }
}

// grey out the threshold pair that Relative mode does not use
function lsEmitActive() {
    var rel = lsVals.relative ? 1 : 0;
    if (rel === lsLastAct) return;
    lsLastAct = rel;
    outlet(3, "act_abs", rel ? 0 : 1);
    outlet(3, "act_rel", rel);
}

// ---------------------------------------------------------------- link
function init_link() {
    lsLastAct = -1;
    lsEmitActive();
    if (lsLink) return;
    if (typeof LiveAPI === "undefined" || typeof Global === "undefined") return;
    lsLink = splCreateLink({
        kind: "loudsplit",
        keys: LS_LINKED_KEYS,
        channelCount: 3,
        rack: {
            channels: LS_RACK_CHANNELS,
            ring: function () { return lsNames.ring; },
            genState: function () { return { alive: lsGenValue(LS_SC_ALIVE), fb: Math.max(0, lsGenValue(LS_SC_FB)) }; },
            send: function (name, value) { outlet(2, name, value); }
        },
        getLocal: function (key) { return lsVals[key]; },
        apply: function (key, value) {
            lsVals[key] = value;
            outlet(1, key, value);
            if (key === "relative") lsEmitActive();
            mgraphics.redraw();
        },
        onInfo: function (info) {
            lsInfo = info;
            ssDspDry(0);
            lsEmitSel();
            mgraphics.redraw();
        }
    });
    lsLink.init();
    lsStartPolling();
    ssDspSchedule(lsInfo.instanceId);
}

function setnames(scopeName, ringName) {
    lsNames.scope = scopeName ? String(scopeName) : "";
    lsNames.ring = ringName ? String(ringName) : "";
    splNoteScope(lsNames.scope);
    lsBuf = null;
    lsOwnBuf = null;
    lsStartPolling();
}

// Kept for tools that only know the scope buffer.
function setbuffer(name) {
    setnames(name, lsNames.ring);
}

// ---------------------------------------------------------------- deferred DSP (src/spectral_dsp.js) and rack messages
function lsGenValue(idx) {
    if (!lsNames.scope) return -1;
    try {
        if (!lsOwnBuf) lsOwnBuf = new Buffer(lsNames.scope);
        var v = lsOwnBuf.peek(1, idx, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (err) {
        lsOwnBuf = null;
        return -1;
    }
}

function ssGenAlive() {
    return lsGenValue(LS_SC_ALIVE);
}

// Every gen-bound message from the values the face holds (a deferred gen~ drops messages until it runs).
function ssDevResend() {
    if (lsNames.scope) outlet(2, "scope", lsNames.scope);
    if (lsNames.ring) outlet(2, "ring", lsNames.ring);
    for (var key in LS_GEN_PARAMS) {
        if (key in lsVals) outlet(2, LS_GEN_PARAMS[key][0], lsVals[key] * LS_GEN_PARAMS[key][1]);
    }
    outlet(2, "fftn", 1024 * Math.pow(2, lsVals.size));
    outlet(2, "outsel", lsSel);
    if (lsLink && lsLink.rack) {
        var m = lsLink.rack.messages();
        for (var i = 0; i < m.length; i++) outlet(2, m[i][0], m[i][1]);
    }
}

function ssDevChanged() {
    mgraphics.redraw();
}

// Test hook (receive #0-sstest): restart the DSP of the instance in chain <c> [of device <kind> = SS_PREFIX] (a late start: a new gen~ with a new sample counter).
function dsp_restart(c, kind) {
    if (kind !== undefined && String(kind) !== SS_PREFIX) return;   // optional device filter: several racks share one test set
    if (lsInfo.chainIndex === Number(c) || Number(c) < 0) ssDspRestart();
}

function lsDispName() {
    var lead = lsLink && lsLink.rack ? lsLink.rack.displayScope() : "";
    return lead || lsNames.scope;
}

function lsStartPolling() {
    if (lsTask || typeof Task === "undefined") return;
    lsTask = new Task(lsPoll, this);
    lsTask.interval = 66;
    lsTask.repeat();
}

function lsPoll() {
    var name = lsDispName();
    if (!name) return;
    try {
        if (!lsBuf || name !== lsBufName) {
            lsBuf = new Buffer(name);
            lsBufName = name;
            lsLastFrame = -1;
        }
        // header first (frame counter, awake): the other floats are only read when a new telemetry frame exists
        var h = lsBuf.peek(1, LS_SC_FRAME, 4);
        if (!h || h.length < 4) return;
        var frame = h[0];
        var aw = h[3];
        if (frame === lsLastFrame && aw === lsScalars.awake) return;
        if (aw < 0.5 && lsScalars.awake < 0.5 && lsIdleDrawn) {
            lsLastFrame = frame;
            return;
        }
        var d = lsBuf.peek(1, 0, LS_SCOPE_SAMPS);
        if (!d || d.length < LS_SC_LMAX + 1) return;
        lsLastFrame = frame;
        for (var c = 0; c < LS_NCOLS; c++) {
            lsPre[c] = d[LS_SC_PRE + c];
            lsQ[c] = d[LS_SC_QUIET + c];
            lsM[c] = d[LS_SC_MID + c];
            lsL[c] = d[LS_SC_LOUD + c];
        }
        lsScalars.frame = frame;
        lsScalars.awake = aw;
        lsScalars.sr = d[LS_SC_SR];
        lsScalars.n = d[LS_SC_N];
        lsScalars.level = d[LS_SC_LEVEL];
        lsScalars.mean = d[LS_SC_LOUDMEAN];
        lsScalars.lmax = d[LS_SC_LMAX];
        if (aw > 0.5 && isFinite(lsScalars.lmax)) lsLmaxS = sptClamp(lsLmaxS + (lsScalars.lmax - lsLmaxS) * 0.5, -200, 100);
        lsPushSono();
        lsIdleDrawn = aw < 0.5;
        mgraphics.redraw();
    } catch (err) {
        lsBuf = null;
    }
}

// linear amplitude of a 0..1 (-100..0 dB) telemetry value
function lsAmp(v) {
    return !(v > 0) ? 0 : Math.pow(10, (Math.min(v, 1) * 100 - 100) / 20);
}

// Quiet / Mid / Loud shares [q, m, l] of a column (amplitudes after the masks)
function lsShares(c) {
    var q = lsAmp(lsQ[c]);
    var m = lsAmp(lsM[c]);
    var l = lsAmp(lsL[c]);
    var s = q + m + l;
    if (s < 1e-12) return [0, 1, 0];
    return [q / s, m / s, l / s];
}

function lsPushSono() {
    var lv = [];
    var w = [];
    var per = LS_NCOLS / LS_SONO_COLS;
    for (var c = 0; c < LS_SONO_COLS; c++) {
        var mx = 0;
        var acc = [0, 0, 0];
        var ws = 0;
        for (var j = 0; j < per; j++) {
            var i = c * per + j;
            var l = lsPre[i];
            if (l > mx) mx = l;
            var sh = lsShares(i);
            var wt = lsAmp(l) + 1e-9;
            acc[0] += sh[0] * wt;
            acc[1] += sh[1] * wt;
            acc[2] += sh[2] * wt;
            ws += wt;
        }
        lv.push(mx);
        w.push([acc[0] / ws, acc[1] / ws, acc[2] / ws]);
    }
    lsSono.push({ lv: lv, w: w });
    while (lsSono.length > LS_SONO_ROWS) lsSono.shift();
}

// ---------------------------------------------------------------- theme (colours from spectral_theme.js, one orange accent)
// Channels: 1 Loud = display line two (cyan), 2 Mid = display line one (orange), 3 Quiet = Live's grey scale text. Always drawn muted:
// 1 px outlines and faint fills. Threshold lines and their handles use the handle colour (orange, hollow circles).
function lsColQ() { return sptColor("live_display_scale_text"); }
function lsColM() { return sptColor("live_display_line_one"); }
function lsColL() { return sptColor("live_display_line_two"); }
var LS_PANELS = [["obj-panel-body", "live_surface_bg"], ["obj-panel-det", "live_desktop"], ["obj-panel-thr", "live_desktop"], ["obj-panel-out", "live_desktop"]];
var lsThemeTask = sptThemeWatch(function () { sptApplyPanelTheme(LS_PANELS); });

// blend of the three channel colours by the [q, m, l] shares
function lsMix3(w) {
    var q = lsColQ();
    var m = lsColM();
    var l = lsColL();
    return [q[0] * w[0] + m[0] * w[1] + l[0] * w[2], q[1] * w[0] + m[1] * w[1] + l[1] * w[2], q[2] * w[0] + m[2] * w[1] + l[2] * w[2], 1];
}

// dB (-90..0) <-> plot y
function lsYdb(db) {
    return LS_PLOT.y + (1 - (db - LS_DB_MIN) / (LS_DB_MAX - LS_DB_MIN)) * LS_PLOT.h;
}

function lsDbY(y) {
    return LS_DB_MIN + (1 - (y - LS_PLOT.y) / LS_PLOT.h) * (LS_DB_MAX - LS_DB_MIN);
}

// 0..1 telemetry level (-100..0 dB) -> plot height fraction
function lsLv(v) {
    var t = (v * 100 - 100 - LS_DB_MIN) / (LS_DB_MAX - LS_DB_MIN);
    return !(t > 0) ? 0 : (t > 1 ? 1 : t);
}

var LS_LOG_SPAN = Math.log(LS_FMAX / LS_FMIN);
var LS_COL_X = [];
for (var lsColInit = 0; lsColInit < LS_NCOLS; lsColInit++) LS_COL_X.push(LS_PLOT.x + (lsColInit + 0.5) * LS_PLOT.w / LS_NCOLS);

function lsColX(c) {
    return LS_COL_X[c];
}

function lsFreqX(f) {
    var t = Math.log(f / LS_FMIN) / LS_LOG_SPAN;
    return LS_PLOT.x + t * LS_PLOT.w;
}
var LS_GRID_X = [lsFreqX(100), lsFreqX(1000), lsFreqX(10000)];

// tilt weight (dB) at a plot x: the classified level is the signal level plus this
function lsTiltAtX(x) {
    var f = LS_FMIN * Math.pow(LS_FMAX / LS_FMIN, (x - LS_PLOT.x) / LS_PLOT.w);
    return lsVals.tilt * Math.log(f / LS_TILT_REF_HZ) * 1.4426950408889634;
}

// Effective thresholds shown (dB, in the tilted level domain): Relative adds the loudest bin of the frame.
function lsEffHi() {
    return lsVals.relative ? lsLmaxS + lsVals.rhithr : lsVals.hithr;
}

function lsEffLo() {
    var lo = lsVals.relative ? lsLmaxS + lsVals.rlothr : lsVals.lothr;
    return Math.min(lo, lsEffHi());
}

// The tilt is log-frequency, so each threshold is a straight line in x. Endpoints are cached until Tilt
// or either effective threshold changes; hit-testing interpolates them.
var lsLineCache = null;
function lsLineEnds() {
    var hi = lsEffHi();
    var lo = lsEffLo();
    var tilt = lsVals.tilt;
    if (lsLineCache && lsLineCache.hi === hi && lsLineCache.lo === lo && lsLineCache.tilt === tilt) return lsLineCache;
    var x0 = LS_PLOT.x;
    var x1 = x0 + LS_PLOT.w;
    lsLineCache = {
        hi: hi, lo: lo, tilt: tilt, x0: x0, x1: x1,
        hi0: lsLineY(hi, x0), hi1: lsLineY(hi, x1),
        lo0: lsLineY(lo, x0), lo1: lsLineY(lo, x1)
    };
    return lsLineCache;
}
function lsLineAt(which, x) {
    var e = lsLineEnds();
    var y0 = which === "hi" ? e.hi0 : e.lo0;
    var y1 = which === "hi" ? e.hi1 : e.lo1;
    return y0 + (y1 - y0) * ((x - e.x0) / (e.x1 - e.x0));
}

function lsLineY(eff, x) {
    return lsYdb(eff - lsTiltAtX(x));
}

function lsToggleRects() {
    return {
        post: { x: LS_VIZ_W - 66, y: 3, w: 30, h: 13 },
        style: { x: LS_VIZ_W - 34, y: 3, w: 30, h: 13 },
        rise: { x: 0, y: 109, w: 134, h: 14 },
        fall: { x: 142, y: 109, w: 134, h: 14 },
        tilt: { x: 0, y: 123, w: 134, h: 14 },
        rel: { x: 142, y: 123, w: 62, h: 13 }
    };
}

// y of both solo handles (kept clear of the buttons in the LCD's top-right corner, inside the plot, and never on top of each other)
function lsDotYs() {
    var e = lsLineEnds();
    var maxY = LS_PLOT.y + LS_PLOT.h - 6;
    var lo = sptClamp(e.lo1, LS_DOT_MIN_Y + LS_DOT_GAP, maxY);
    var hi = sptClamp(e.hi1, LS_DOT_MIN_Y, maxY);
    if (lo - hi < LS_DOT_GAP) hi = lo - LS_DOT_GAP;
    return { hi: hi, lo: lo };
}

// baseline y of both threshold labels: inside the plot, above the axis-label row, and not on top of each other
function lsLabelYs() {
    var out = {};
    var e = lsLineEnds();
    var top = LS_PLOT.y + 10;
    var bot = LS_PLOT.y + LS_PLOT.h - 11;            // axis labels (100 / 1k / 10k) sit on the row below
    var ws = ["hi", "lo"];
    for (var i = 0; i < 2; i++) {
        var hi = ws[i] === "hi";
        var kp = (hi ? lsVals.hiknee : lsVals.loknee) * 0.5 * LS_PLOT.h / (LS_DB_MAX - LS_DB_MIN);
        out[ws[i]] = sptClamp((hi ? e.hi0 : e.lo0) - kp - 3, top, bot);
    }
    if (out.lo - out.hi < LS_LABEL_GAP) {
        out.lo = Math.min(bot, out.hi + LS_LABEL_GAP);
        out.hi = Math.max(top, out.lo - LS_LABEL_GAP);
    }
    return out;
}

function lsInside(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function lsKeys(which) {
    var rel = lsVals.relative ? 1 : 0;
    if (which === "hi") return { thr: rel ? "rhithr" : "hithr", knee: "hiknee" };
    return { thr: rel ? "rlothr" : "lothr", knee: "loknee" };
}

// ---------------------------------------------------------------- paint
function paint() {
    var W = LS_VIZ_W;
    var drag = lsDrag && lsDrag.kind === "val" ? lsDrag.key : "";
    var gx = LS_GRID_X;
    var gy = [];
    for (var d = -100; d <= -20; d += 20) gy.push(lsYdb(d));
    sptLcd(0, 0, W, LS_PLOT.h + 2, { xs: gx, ys: gy });
    var scale = sptColor("live_display_scale_text");
    var labels = ["100", "1k", "10k"];
    for (var g = 0; g < labels.length; g++) sptText(labels[g], gx[g] + 3, LS_PLOT.y + LS_PLOT.h - 3, scale, SPT_SIZE_SMALL - 1, 0);
    for (var e = 0; e < gy.length - 1; e++) sptText(String(-100 + e * 20), LS_PLOT.x + LS_PLOT.w - 2, gy[e] - 4, scale, SPT_SIZE_SMALL - 1.5, 2);

    if (lsVals.disstyle) lsPaintSono();
    else if (lsVals.dispost) lsPaintPost();
    else lsPaintPre();
    if (lsScalars.awake < 0.5) sptText("no signal", LS_PLOT.x + LS_PLOT.w * 0.5, LS_PLOT.y + 40, scale, SPT_SIZE, 1);

    lsPaintThreshold("lo");
    lsPaintThreshold("hi");

    // display toggles (top right of the LCD)
    var t = lsToggleRects();
    sptButton(t.post.x, t.post.y, t.post.w, t.post.h, "Post", lsVals.dispost ? 1 : 0);
    sptButton(t.style.x, t.style.y, t.style.w, t.style.h, "Sono", lsVals.disstyle ? 1 : 0);

    // legend row: the output channel of this instance (a held solo overrides it) is the bright one; chain chip on the right
    var ly = 105;
    var names = ["Loud", "Mid", "Quiet"];
    var cols = [lsColL(), lsColM(), lsColQ()];
    var lx = 2;
    for (var i = 0; i < 3; i++) {
        var on = lsSel === 0 || lsSel === i + 1;
        sptLegendSwatch(lx, ly - 5, sptMuted(cols[i], on ? 1 : 0.55));
        sptText(names[i], lx + 9, ly, on ? sptColor("live_control_fg") : scale, SPT_SIZE_SMALL, 0);
        lx += 9 + sptTextW(names[i], SPT_SIZE_SMALL) + 12;
    }
    var chip = lsSolo ? ("Solo " + lsSelName(lsSel)) : (lsInfo.isInRack ? ("Chain " + (lsInfo.chainIndex + 1) + "/" + Math.max(lsInfo.chainCount, 1)
        + (lsInfo.linked ? ", linked" : "")) : "No rack");
    var pill = ssDspPill();     // DSP loading... / DSP failed: ... takes the place of the chain chip until the gen runs
    if (pill) sptText(pill, W - 2, ly, sptColor(ssDsp.error ? "live_alert" : "live_control_selection"), SPT_SIZE_SMALL, 2);
    else sptText(chip, W - 2, ly, scale, SPT_SIZE_SMALL, 2);

    // value rows: Rise / Fall, Tilt and the Relative Loudness Mode toggle
    sptLabelValue("Rise", lsVals.rise.toFixed(2), t.rise.x, t.rise.y + 11, 0, drag === "rise", 32);
    sptLabelValue("Fall", lsVals.fall.toFixed(2), t.fall.x, t.fall.y + 11, 0, drag === "fall", 32);
    sptLabelValue("Tilt", lsVals.tilt.toFixed(1) + " dB/oct", t.tilt.x, t.tilt.y + 11, 0, drag === "tilt", 32);
    sptButton(t.rel.x, t.rel.y, t.rel.w, t.rel.h, "Relative", lsVals.relative ? 1 : 0);
}

// PRE: the Mid spectrum, one thin line per column in the blend of the channel colours where its energy goes, over a faint fill.
function lsPaintPre() {
    var base = LS_PLOT.y + LS_PLOT.h;
    var cw = LS_PLOT.w / LS_NCOLS;
    var prev = null;
    for (var c = 0; c < LS_NCOLS; c++) {
        var h = lsLv(lsPre[c]) * (LS_PLOT.h - 6);
        var col = lsMix3(lsShares(c));
        var x = lsColX(c);
        if (h >= 0.5) {
            sptRgba(sptMuted(col, 1), 0.14);
            mgraphics.rectangle(LS_PLOT.x + c * cw, base - h, Math.max(cw, 1), h);
            mgraphics.fill();
        }
        var pt = [x, base - h];
        if (prev) sptCurve([prev, pt], sptMuted(col, 0.85));
        prev = pt;
    }
}

function lsArea(arr, col, a, lineA) {
    var base = LS_PLOT.y + LS_PLOT.h;
    mgraphics.move_to(LS_PLOT.x, base);
    for (var c = 0; c < LS_NCOLS; c++) mgraphics.line_to(lsColX(c), base - lsLv(arr[c]) * (LS_PLOT.h - 6));
    mgraphics.line_to(LS_PLOT.x + LS_PLOT.w, base);
    mgraphics.close_path();
    sptRgba(sptMuted(col, 1), a);
    mgraphics.fill();
    var pts = [];
    for (var k = 0; k < LS_NCOLS; k++) pts.push([lsColX(k), base - lsLv(arr[k]) * (LS_PLOT.h - 6)]);
    sptCurve(pts, sptMuted(col, lineA));
}

function lsPaintPost() {
    // the selected channel is bright, the others dimmed (All: all bright)
    var aq = (lsSel === 0 || lsSel === 3) ? 0.2 : 0.06;
    var am = (lsSel === 0 || lsSel === 2) ? 0.2 : 0.06;
    var al = (lsSel === 0 || lsSel === 1) ? 0.2 : 0.06;
    lsArea(lsQ, lsColQ(), aq, aq > 0.1 ? 0.95 : 0.45);
    lsArea(lsM, lsColM(), am, am > 0.1 ? 0.95 : 0.45);
    lsArea(lsL, lsColL(), al, al > 0.1 ? 0.95 : 0.45);
}

function lsPaintSono() {
    var cw = LS_PLOT.w / LS_SONO_COLS;
    var rh = LS_PLOT.h / LS_SONO_ROWS;
    var off = LS_SONO_ROWS - lsSono.length;
    for (var r = 0; r < lsSono.length; r++) {
        var row = lsSono[r];
        var y = LS_PLOT.y + (off + r) * rh;
        for (var c = 0; c < LS_SONO_COLS; c++) {
            var a = lsLv(row.lv[c]);
            if (a < 0.04) continue;
            sptRgba(sptMuted(lsMix3(row.w[c]), 1), 0.06 + 0.6 * a);
            mgraphics.rectangle(LS_PLOT.x + c * cw, y, cw + 0.3, rh + 0.3);
            mgraphics.fill();
        }
    }
}

// One threshold: knee band, 1 px line (follows Tilt), value label and the hollow solo handle at the right. At a parameter extreme
// (a threshold at its minimum, Relative on a loud frame, Tilt at +-6) the line can leave the plot: it is clipped to the plot rect.
function lsPaintThreshold(which) {
    var hi = which === "hi";
    var col = sptColor("live_display_handle_one");
    var e = lsLineEnds();
    var knee = hi ? lsVals.hiknee : lsVals.loknee;
    var x0 = e.x0;
    var x1 = e.x1;
    var y0 = hi ? e.hi0 : e.lo0;
    var y1 = hi ? e.hi1 : e.lo1;
    var kp = knee * 0.5 * LS_PLOT.h / (LS_DB_MAX - LS_DB_MIN);
    var dragging = lsDrag && lsDrag.which === which;
    if (kp > 0.3) {
        sptFillPolyIn([[x0, y0 - kp], [x1, y1 - kp], [x1, y1 + kp], [x0, y0 + kp]], col, dragging && lsDrag.kind === "knee" ? 0.2 : 0.09, LS_PLOT);
    }
    sptCurveIn([[x0, y0], [x1, y1]], col, dragging ? 1 : 0.7, LS_PLOT);
    // stub to the handle and the handle itself (both inside the LCD, right of the plot)
    var dy = lsDotYs()[which];
    sptCurveIn([[x1, sptClamp(y1, LS_PLOT.y, LS_PLOT.y + LS_PLOT.h)], [LS_DOT_X, dy]], col, 0.45, LS_LCD);
    var held = lsSolo === which;
    if (held) {
        sptRgba(col);
        mgraphics.arc(LS_DOT_X, dy, 4.5, 0, Math.PI * 2);
        mgraphics.fill();
        sptText(hi ? "H" : "L", LS_DOT_X, dy + 2.6, sptColor("live_lcd_bg"), 7, 1);
    } else {
        sptHandle(LS_DOT_X, dy, col, hi ? "H" : "L", 4.5);
    }
    // value label above the line at the left (value as set, "rel" in Relative mode; same precision as the Live box)
    var keys = lsKeys(which);
    var v = lsVals[keys.thr];
    var txt = (hi ? "Higher " : "Lower ") + v.toFixed(1) + (lsVals.relative ? " dB rel" : " dB");
    if (dragging && lsDrag.kind === "knee") txt = "Knee " + knee.toFixed(1) + " dB";
    sptTextIn(txt, LS_PLOT.x + 4, lsLabelYs()[which], sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 0, LS_PLOT);
}

// ---------------------------------------------------------------- interaction
function lsEmitEdit(key, v) {
    outlet(0, key, v);
}

function onclick(x, y, but, cmd, shift, capslock, option, ctrl) {
    lsHandleDown(x, y, false, !!(shift || option || ctrl));
}

function ondblclick(x, y) {
    lsHandleDown(x, y, true, false);
}

// nearest of the two threshold lines (or dots) under the pointer
function lsPick(x, y) {
    var best = null;
    var which = ["hi", "lo"];
    for (var i = 0; i < 2; i++) {
        var w = which[i];
        var dyDot = lsDotYs()[w];
        if (Math.abs(x - LS_DOT_X) < 9 && Math.abs(y - dyDot) < 9) {
            var dd = Math.abs(y - dyDot);
            if (!best || dd < best.dist) best = { which: w, dot: true, dist: dd };
        } else if (x >= LS_PLOT.x - 2 && x <= LS_PLOT.x + LS_PLOT.w + 2) {
            var dl = Math.abs(y - lsLineAt(w, Math.max(LS_PLOT.x, Math.min(LS_PLOT.x + LS_PLOT.w, x))));
            if (dl < 6 && (!best || dl < best.dist)) best = { which: w, dot: false, dist: dl };
        }
    }
    return best;
}

function lsHandleDown(x, y, dbl, mod) {
    var t = lsToggleRects();
    if (lsInside(t.post, x, y)) {
        lsEmitEdit("dispost", lsVals.dispost ? 0 : 1);
        return;
    }
    if (lsInside(t.style, x, y)) {
        lsEmitEdit("disstyle", lsVals.disstyle ? 0 : 1);
        return;
    }
    if (lsInside(t.rel, x, y)) {
        if (!dbl) lsEmitEdit("relative", lsVals.relative ? 0 : 1);
        return;
    }
    var vk = ["rise", "fall", "tilt"];
    for (var vi = 0; vi < vk.length; vi++) {
        if (lsInside(t[vk[vi]], x, y)) {
            if (dbl) lsEmitEdit(vk[vi], LS_DEFAULTS[vk[vi]]);
            else lsDrag = { kind: "val", key: vk[vi], startY: y, startVal: lsVals[vk[vi]] };
            mgraphics.redraw();
            return;
        }
    }
    var hit = lsPick(x, y);
    if (!hit) return;
    var keys = lsKeys(hit.which);
    if (hit.dot) {
        if (dbl) return;
        lsSolo = hit.which;
        lsDrag = { kind: "solo", which: hit.which };
        lsEmitSel();
        mgraphics.redraw();
        return;
    }
    if (dbl) {
        lsEmitEdit(keys.thr, LS_DEFAULTS[keys.thr]);
        return;
    }
    var eff = hit.which === "hi" ? lsEffHi() : lsEffLo();
    var knee = lsVals[keys.knee];
    if (mod) {
        var d0 = Math.abs(lsDbY(y) - (eff - lsTiltAtX(x)));
        lsDrag = { kind: "knee", which: hit.which, x: x, off: 2 * d0 - knee };
    } else {
        lsDrag = { kind: "thr", which: hit.which, startY: y, startVal: lsVals[keys.thr] };
    }
    mgraphics.redraw();
}

function ondrag(x, y, but, cmd, shift, capslock, option, ctrl) {
    if (!but) {
        if (lsDrag && lsDrag.kind === "solo") {
            lsSolo = "";
            lsEmitSel();
        }
        lsDrag = null;
        mgraphics.redraw();
        return;
    }
    lsDragTo(x, y);
}

function lsDragTo(x, y) {
    if (!lsDrag || lsDrag.kind === "solo") return;
    if (lsDrag.kind === "val") {
        var nv;
        if (lsDrag.key === "tilt") {
            nv = Math.round(Math.max(-6, Math.min(6, lsDrag.startVal + (lsDrag.startY - y) * 12 / 150)) * 10) / 10;
        } else {
            nv = lsDrag.startVal * Math.exp((lsDrag.startY - y) * Math.log(LS_BLOCKS_MAX / LS_BLOCKS_MIN) / 150);
            nv = Math.round(Math.max(LS_BLOCKS_MIN, Math.min(LS_BLOCKS_MAX, nv)) * 100) / 100;
        }
        if (nv !== lsVals[lsDrag.key]) lsEmitEdit(lsDrag.key, nv);
        return;
    }
    var keys = lsKeys(lsDrag.which);
    if (lsDrag.kind === "thr") {
        var v = lsDrag.startVal + (lsDrag.startY - y) * (LS_DB_MAX - LS_DB_MIN) / LS_PLOT.h;
        v = Math.round(v * 2) / 2;
        var rel = lsVals.relative ? 1 : 0;
        var other = lsDrag.which === "hi" ? lsVals[rel ? "rlothr" : "lothr"] : lsVals[rel ? "rhithr" : "hithr"];
        v = lsDrag.which === "hi" ? Math.max(v, other) : Math.min(v, other);
        v = Math.max(LS_DB_MIN, Math.min(LS_DB_MAX, v));
        if (v !== lsVals[keys.thr]) lsEmitEdit(keys.thr, v);
    } else if (lsDrag.kind === "knee") {
        var eff = lsDrag.which === "hi" ? lsEffHi() : lsEffLo();
        var d = Math.abs(lsDbY(y) - (eff - lsTiltAtX(lsDrag.x)));
        var kn = Math.round((2 * d - lsDrag.off) * 2) / 2;
        kn = Math.max(LS_MIN_KNEE, Math.min(LS_MAX_KNEE, kn));
        if (kn !== lsVals[keys.knee]) lsEmitEdit(keys.knee, kn);
    }
}

function onidle() {}
function onidleout() {}

// ---------------------------------------------------------------- preview (scripts/render_preview.py calls preview() then paint())
function preview() {
    ssDsp.ready = 1;
    lsInfo = { instanceId: "p", isInRack: true, chainIndex: 0, chainCount: 3, peers: 3, linked: true, autoChannel: 0 };
    // demo state = the live.* parameter defaults (Higher -30, Lower -85, knees 6 dB, Rise 2, Fall 8, Tilt 0)
    lsVals.hithr = -30;
    lsVals.lothr = -85;
    lsVals.hiknee = 6;
    lsVals.loknee = 6;
    lsVals.tilt = 0;
    lsVals.dispost = 0;
    lsSel = 1;
    lsScalars.awake = 1;
    var q = [0, 0, 0];
    for (var c = 0; c < LS_NCOLS; c++) {
        var f = LS_FMIN * Math.pow(LS_FMAX / LS_FMIN, c / LS_NCOLS);
        var db = -62 - 34 * Math.log(f / 100) / Math.log(100) + 3 * Math.sin(c * 1.7)
            + 50 * Math.exp(-Math.pow((f - 440) / 50, 2)) + 42 * Math.exp(-Math.pow((f - 1320) / 120, 2))
            + 22 * Math.exp(-Math.pow((f - 3100) / 300, 2));
        db = Math.max(-106, db);
        lsPre[c] = (db + 100) / 100;
        var tl = lsVals.tilt * Math.log(f / LS_TILT_REF_HZ) * 1.4426950408889634;
        lsBandMasks(db + tl, lsVals.hithr, lsVals.lothr, lsVals.hiknee, lsVals.loknee, q);
        lsQ[c] = Math.max(0, (db + 100 + 20 * Math.log(q[0] + 1e-5) / Math.LN10) / 100);
        lsM[c] = Math.max(0, (db + 100 + 20 * Math.log(q[1] + 1e-5) / Math.LN10) / 100);
        lsL[c] = Math.max(0, (db + 100 + 20 * Math.log(q[2] + 1e-5) / Math.LN10) / 100);
    }
    for (var r = 0; r < LS_SONO_ROWS; r++) lsPushSono();
}
