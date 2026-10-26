// freqsplit_ui.js — Freq Split face (v8ui, one canvas) + spectral_link wiring + the deferred DSP. The build concatenates
//   (deferred-DSP constants), freqsplit_config.js, spectral_link.js, spectral_theme.js, spectral_dsp.js, this file  into the v8ui script.
//
// Canvas (FV_W x FV_H): a HUD (resolved channel pill, chain chip) and a log-frequency plot (20 Hz..20 kHz) with
//   - the channel regions: stacked, channel coloured mask columns (crossfades show as blends), from the same fsPattern / fsMaskAt as
//     the DSP; regions wider than 13 px carry their channel number, split lines are drawn up to 120 splits;
//   - the white XY dot: x = Bend (the centre frequency, midpoint 0.5 + 0.4 Bend), y = Pinch; drag it, double-click resets both;
//   - the orange Spectral Limiter line (drag vertically, double-click resets to 0 dB; solid while the limiter is on);
//   - dragging anywhere else in the plot slides the whole split pattern = Split Spin (wrapping), double-click resets Spin;
//   - the Mid spectrum (Pre, coloured by the channel mix of each column) or the four channels after the masks (Post).
// The Splits / Crossfade / Nudge / Spin / Bend / Pinch / Mix / Limiter values are the real live.* objects around the canvas;
// the direction arrows and the crossfade ramp glyph live in the small header v8ui (src/freqsplit_top_ui.js).
//
// Messages in:  set_<key> <value> for splits dir xfade nudge spin bend pinch limon limthr mix size output dispost,
//               setnames <scope buffer> <ring buffer>, init_link (live.thisdevice), dsp_restart <chain> (test hook), preview helpers.
// Outlets:      0 [key value]  edits made on the canvas (bend pinch limthr spin) -> route -> the live.* object (which then drives gen)
//               1 [key value]  values applied from a rack peer -> route -> `prepend set` into the live.* object + gen
//               2 gen messages -> the ss_genin hub (gate 1 1; the gen~ is created after load, src/spectral_dsp.js): outsel <0..4> (0 = all
//                 channels summed), scope / ring / lead <buffer name>, role, serve, epoch (rack sharing, src/spectral_link.js), parameters (re-sent)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 3;

var FV_W = 328;
var FV_H = 100;
// the four channel colours (red, blue, yellow, magenta): the only non-theme colours, always drawn muted (thin lines / faint tints)
var FV_COLS = [[1.0, 0.42, 0.38], [0.32, 0.62, 1.0], [1.0, 0.80, 0.25], [0.92, 0.42, 0.85]];
var FV_NAMES = ["Red", "Blue", "Yellow", "Magenta"];
var FV_PLOT = { x: 1, y: 1, w: 326, h: 82 };     // inside the LCD rectangle (0, 0, FV_W, 84); the legend row sits below it
var FV_PANELS = [["obj-panel-body", "live_surface_bg"], ["obj-panel-spl", "live_desktop"], ["obj-panel-spc", "live_desktop"], ["obj-panel-out", "live_desktop"]];
var fvThemeTask = sptThemeWatch(function () { sptApplyPanelTheme(FV_PANELS); });
var FV_DB_LO = -80;          // plot level range
var FV_DB_HI = 6;
var FV_DENSE = 120;          // above this many splits the split lines are not drawn

var fvVals = { splits: 16, dir: 0, xfade: 0, nudge: 0, spin: 0, bend: 0, pinch: 0, limon: 0, limthr: 0, mix: 100, size: 2, output: 0, dispost: 0 };
var fvPat = fsPattern(fsPatternFromVals(fvVals));
var fvRegion = [];           // per display column mask [m0..m3] (cache of fsMaskAt)
var fvColRgb = [];           // per telemetry column blended channel colour
var fvSplitXs = [];
var fvSegs = [];             // [{x0, x1, ch}] regions for the channel numbers
var fvPre = [];
var fvCh = [[], [], [], []];
var fvScalars = { frame: 0, awake: 0, sr: 48000, n: 4096, level: 0 };
var fvNames = { scope: "", ring: "" };
var fvBufName = "";            // the buffer the display is drawn from (the leader's scope while following)
var fvBuf = null;
var fvOwnBuf = null;
var fvTask = null;
var fvLastFrame = -1;
var fvIdleDrawn = false;
var fvDrag = null;
var fvLink = null;
var fvInfo = { instanceId: "", isInRack: false, chainIndex: 0, chainCount: 0, peers: 1, linked: false, autoChannel: -1 };
var fvSel = 0;
var fvLastSel = -1;
var FV_PATTERN_KEYS = ["splits", "dir", "xfade", "nudge", "spin", "bend", "pinch"];

(function fvInitArrays() {
    for (var i = 0; i < FS_NCOLS; i++) {
        fvPre.push(0);
        fvColRgb.push([0.6, 0.6, 0.6]);
        for (var c = 0; c < 4; c++) fvCh[c].push(0);
    }
})();

// Rebuild everything derived from the pattern (region columns, colours, split lines, labelled regions).
function fvRebuild() {
    fvPat = fsPattern(fsPatternFromVals(fvVals));
    var cols = Math.floor(FV_PLOT.w / 2);
    fvRegion = [];
    for (var i = 0; i < cols; i++) fvRegion.push(fsMaskAt(fvPat, (i + 0.5) / cols));
    for (var c = 0; c < FS_NCOLS; c++) {
        var m = fsMaskAt(fvPat, (c + 0.5) / FS_NCOLS);
        var rgb = [0, 0, 0];
        for (var ch = 0; ch < 4; ch++) for (var q = 0; q < 3; q++) rgb[q] += m[ch] * FV_COLS[ch][q];
        fvColRgb[c] = rgb;
    }
    fvSplitXs = fsSplitXs(fvPat);
    var edges = [0].concat(fvSplitXs, [1]);
    fvSegs = [];
    if (fvSplitXs.length < FV_DENSE) {
        for (var j = 0; j + 1 < edges.length; j++) {
            if ((edges[j + 1] - edges[j]) * FV_PLOT.w < 13) continue;
            fvSegs.push({ x0: edges[j], x1: edges[j + 1], ch: fsChannelAt(fvPat, (edges[j] + edges[j + 1]) * 0.5) });
        }
    }
}

// ---------------------------------------------------------------- state in
function fvSetVal(key, v) {
    if (!isFinite(v)) return;
    var pr = FS_PARAMS[key];
    if (pr) v = Math.max(pr[2], Math.min(pr[3], v));
    var changed = fvVals[key] !== v;
    fvVals[key] = v;
    if (key === "output") fvEmitSel();
    else if (changed && FV_PATTERN_KEYS.indexOf(key) >= 0) fvRebuild();
    if (fvLink && FS_LINKED_KEYS.indexOf(key) >= 0) fvLink.notify(key, v);
    if (changed) mgraphics.redraw();
}

function set_splits(v) { fvSetVal("splits", Number(v)); }
function set_dir(v) { fvSetVal("dir", Number(v)); }
function set_xfade(v) { fvSetVal("xfade", Number(v)); }
function set_nudge(v) { fvSetVal("nudge", Number(v)); }
function set_spin(v) { fvSetVal("spin", Number(v)); }
function set_bend(v) { fvSetVal("bend", Number(v)); }
function set_pinch(v) { fvSetVal("pinch", Number(v)); }
function set_limon(v) { fvSetVal("limon", Number(v) ? 1 : 0); }
function set_limthr(v) { fvSetVal("limthr", Number(v)); }
function set_mix(v) { fvSetVal("mix", Number(v)); }
function set_size(v) { fvSetVal("size", Number(v)); }
function set_output(v) { fvSetVal("output", Number(v)); }
function set_dispost(v) { fvSetVal("dispost", Number(v) ? 1 : 0); }

function fvEmitSel() {
    fvSel = fsResolveSel(fvVals.output, fvInfo.autoChannel);
    if (fvSel !== fvLastSel) {
        fvLastSel = fvSel;
        outlet(2, "outsel", fvSel);
    }
}

// ---------------------------------------------------------------- link
function init_link() {
    if (fvLink) return;
    if (typeof LiveAPI === "undefined" || typeof Global === "undefined") return;
    fvLink = splCreateLink({
        kind: "freqsplit",
        keys: FS_LINKED_KEYS,
        channelCount: 4,
        rack: {
            channels: FS_RACK_CHANNELS,
            ring: function () { return fvNames.ring; },
            genState: function () { return { alive: fvGenValue(FS_SC_ALIVE), fb: Math.max(0, fvGenValue(FS_SC_FB)) }; },
            send: function (name, value) { outlet(2, name, value); }
        },
        getLocal: function (key) { return fvVals[key]; },
        apply: function (key, value) {
            fvVals[key] = value;
            if (FV_PATTERN_KEYS.indexOf(key) >= 0) fvRebuild();
            outlet(1, key, value);
            mgraphics.redraw();
        },
        onInfo: function (info) {
            fvInfo = info;
            ssDspDry(0);
            fvEmitSel();
            mgraphics.redraw();
        }
    });
    fvLink.init();
    fvStartPolling();
    ssDspSchedule(fvInfo.instanceId);
}

function setnames(scopeName, ringName) {
    fvNames.scope = scopeName ? String(scopeName) : "";
    fvNames.ring = ringName ? String(ringName) : "";
    splNoteScope(fvNames.scope);
    fvBuf = null;
    fvOwnBuf = null;
    fvStartPolling();
}

// Kept for tools that only know the scope buffer.
function setbuffer(name) {
    setnames(name, fvNames.ring);
}

// ---------------------------------------------------------------- deferred DSP (src/spectral_dsp.js) and rack messages
function fvGenValue(idx) {
    if (!fvNames.scope) return -1;
    try {
        if (!fvOwnBuf) fvOwnBuf = new Buffer(fvNames.scope);
        var v = fvOwnBuf.peek(1, idx, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (err) {
        fvOwnBuf = null;
        return -1;
    }
}

function ssGenAlive() {
    return fvGenValue(FS_SC_ALIVE);
}

// Every gen-bound message from the values the face holds (a deferred gen~ drops messages until it runs).
function ssDevResend() {
    if (fvNames.scope) outlet(2, "scope", fvNames.scope);
    if (fvNames.ring) outlet(2, "ring", fvNames.ring);
    for (var key in FS_GEN_PARAMS) {
        if (key in fvVals) outlet(2, FS_GEN_PARAMS[key][0], fvVals[key] * FS_GEN_PARAMS[key][1]);
    }
    outlet(2, "fftn", 1024 * Math.pow(2, fvVals.size));
    outlet(2, "outsel", fvSel);
    if (fvLink && fvLink.rack) {
        var m = fvLink.rack.messages();
        for (var i = 0; i < m.length; i++) outlet(2, m[i][0], m[i][1]);
    }
}

function ssDevChanged() {
    mgraphics.redraw();
}

// Test hook (receive #0-sstest): restart the DSP of the instance in chain <c> [of device <kind> = SS_PREFIX] (a late start: a new gen~ with a new sample counter).
function dsp_restart(c, kind) {
    if (kind !== undefined && String(kind) !== SS_PREFIX) return;   // optional device filter: several racks share one test set
    if (fvInfo.chainIndex === Number(c) || Number(c) < 0) ssDspRestart();
}

function fvStartPolling() {
    if (fvTask || typeof Task === "undefined") return;
    fvTask = new Task(fvPoll, this);
    fvTask.interval = 66;
    fvTask.repeat();
}

function fvDispName() {
    var lead = fvLink && fvLink.rack ? fvLink.rack.displayScope() : "";
    return lead || fvNames.scope;
}

function fvPoll() {
    var name = fvDispName();
    if (!name) return;
    try {
        if (!fvBuf || name !== fvBufName) {
            fvBuf = new Buffer(name);
            fvBufName = name;
            fvLastFrame = -1;
        }
        // header first (frame counter, awake): the other 670 floats are only read when a new telemetry frame exists
        var h = fvBuf.peek(1, FS_SC_FRAME, 4);
        if (!h || h.length < 4) return;
        var frame = h[0];
        var aw = h[3];
        if (frame === fvLastFrame && aw === fvScalars.awake) return;
        if (aw < 0.5 && fvScalars.awake < 0.5 && fvIdleDrawn) {
            fvLastFrame = frame;
            return;
        }
        var d = fvBuf.peek(1, 0, FS_SCOPE_SAMPS);
        if (!d || d.length < FS_SC_FRAME + 6) return;
        fvLastFrame = frame;
        for (var c = 0; c < FS_NCOLS; c++) {
            fvPre[c] = d[FS_SC_PRE + c];
            for (var ch = 0; ch < 4; ch++) fvCh[ch][c] = d[FS_SC_CH + ch * FS_NCOLS + c];
        }
        fvScalars.frame = frame;
        fvScalars.awake = aw;
        fvScalars.sr = d[FS_SC_SR];
        fvScalars.n = d[FS_SC_N];
        fvScalars.level = d[FS_SC_LEVEL];
        fvIdleDrawn = aw < 0.5;
        mgraphics.redraw();
    } catch (err) {
        fvBuf = null;
    }
}

// ---------------------------------------------------------------- drawing helpers
function fvMute(ch, amount) {
    return sptMuted(FV_COLS[ch], amount);
}

// telemetry level 0..1 (-100..0 dB) -> plot height fraction (-80..+6 dB)
function fvLv(v) {
    if (!(v === v)) return 0;
    var t = (v * 100 - 100 - FV_DB_LO) / (FV_DB_HI - FV_DB_LO);
    return t < 0 ? 0 : (t > 1 ? 1 : t);
}

function fvUX(u) {
    return FV_PLOT.x + u * FV_PLOT.w;
}

var FV_COL_X = [];
for (var fvColInit = 0; fvColInit < FS_NCOLS; fvColInit++) FV_COL_X.push(FV_PLOT.x + (fvColInit + 0.5) * FV_PLOT.w / FS_NCOLS);
var FV_GRID_X = [fvUX(fsHzToU(100)), fvUX(fsHzToU(1000)), fvUX(fsHzToU(10000))];

function fvColX(c) {
    return FV_COL_X[c];
}

function fvLimY() {
    var frac = Math.max(0, Math.min(1, (fvVals.limthr - FV_DB_LO) / (FV_DB_HI - FV_DB_LO)));
    return FV_PLOT.y + FV_PLOT.h - frac * (FV_PLOT.h - 2);
}

function fvDot() {
    return {
        x: fvUX(fsBendMid(fvVals.bend / 100)),
        y: FV_PLOT.y + FV_PLOT.h * (0.5 - 0.42 * fvVals.pinch / 100)
    };
}

function fvPts(arr) {
    var base = FV_PLOT.y + FV_PLOT.h;
    var pts = [];
    for (var c = 0; c < FS_NCOLS; c++) pts.push([fvColX(c), base - fvLv(arr[c]) * (FV_PLOT.h - 2)]);
    return pts;
}

// ---------------------------------------------------------------- paint
function paint() {
    var W = FV_W;
    var yb = FV_PLOT.y + FV_PLOT.h;
    var gx = FV_GRID_X;
    var gy = [FV_PLOT.y + FV_PLOT.h * 0.25, FV_PLOT.y + FV_PLOT.h * 0.5, FV_PLOT.y + FV_PLOT.h * 0.75];
    var labels = ["100", "1k", "10k"];
    sptLcd(0, 0, W, FV_PLOT.h + 2, { xs: gx, ys: gy });

    fvPaintRegions();
    for (var l = 0; l < labels.length; l++) sptText(labels[l], gx[l] + 3, yb - 3, sptColor("live_display_scale_text"), SPT_SIZE_SMALL - 1, 0);
    if (fvVals.dispost) fvPaintPost();
    else fvPaintPre();
    if (fvScalars.awake < 0.5) sptText("no signal", FV_PLOT.x + FV_PLOT.w * 0.5, FV_PLOT.y + 40, sptColor("live_display_scale_text"), SPT_SIZE, 1);
    var pill = ssDspPill();
    if (pill) sptText(pill, FV_PLOT.x + FV_PLOT.w * 0.5, FV_PLOT.y + 26, sptColor(ssDsp.error ? "live_alert" : "live_control_selection"), SPT_SIZE_SMALL, 1);

    fvPaintSplits();
    fvPaintLimiter();
    fvPaintDot();

    // legend row under the display: channel swatches (this instance's output bright), chain chip right-aligned
    var ly = FV_PLOT.h + 13;
    var lx = 2;
    for (var c = 0; c < 4; c++) {
        var on = fvSel === 0 || fvSel === c + 1;
        sptLegendSwatch(lx, ly - 5, fvMute(c, on ? 1 : 0.55));
        sptText(FV_NAMES[c], lx + 9, ly, on ? sptColor("live_control_fg") : sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 0);
        lx += 9 + sptTextW(FV_NAMES[c], SPT_SIZE_SMALL) + 12;
    }
    var chip = fvInfo.isInRack ? ("Chain " + (fvInfo.chainIndex + 1) + "/" + Math.max(fvInfo.chainCount, 1)
        + (fvInfo.linked ? ", linked" : "")) : "No rack";
    sptText(chip, W - 2, ly, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 2);
}

// Stacked channel masks as faint tints, one 2 px column at a time (the crossfades show as blends).
function fvPaintRegions() {
    var cols = fvRegion.length;
    var cw = FV_PLOT.w / cols;
    for (var i = 0; i < cols; i++) {
        var m = fvRegion[i];
        var y = FV_PLOT.y + FV_PLOT.h;
        for (var c = 0; c < 4; c++) {
            if (m[c] <= 0.001) continue;
            var h = FV_PLOT.h * m[c];
            var dim = fvSel >= 1 && fvSel <= 4 && fvSel - 1 !== c;
            sptRgba(FV_COLS[c], dim ? 0.05 : 0.15);
            mgraphics.rectangle(FV_PLOT.x + i * cw, y - h, cw + 0.4, h);
            mgraphics.fill();
            y -= h;
        }
    }
}

// Pre: the Mid spectrum as a thin outline + faint fill, each column in the muted colour of the channel mix it is sorted into.
function fvPaintPre() {
    var base = FV_PLOT.y + FV_PLOT.h;
    var cw = FV_PLOT.w / FS_NCOLS;
    var bg = sptColor("live_lcd_bg");
    var prev = null;
    for (var c = 0; c < FS_NCOLS; c++) {
        var h = fvLv(fvPre[c]) * (FV_PLOT.h - 2);
        var col = sptMix(bg, fvColRgb[c], 0.8);
        if (h >= 0.5) {
            sptRgba(col, 0.28);
            mgraphics.rectangle(FV_PLOT.x + c * cw, base - h, Math.max(cw - 0.4, 1), h);
            mgraphics.fill();
        }
        var pt = [fvColX(c), base - h, col];
        if (prev) sptCurve([[prev[0], prev[1]], [pt[0], pt[1]]], pt[2], 0.95);
        prev = pt;
    }
}

function fvPaintPost() {
    for (var c = 0; c < 4; c++) {
        var dim = fvSel >= 1 && fvSel <= 4 && fvSel - 1 !== c;
        var pts = fvPts(fvCh[c]);
        var base = FV_PLOT.y + FV_PLOT.h;
        sptRgba(FV_COLS[c], dim ? 0.05 : 0.16);
        mgraphics.move_to(pts[0][0], base);
        for (var k = 0; k < pts.length; k++) mgraphics.line_to(pts[k][0], pts[k][1]);
        mgraphics.line_to(pts[pts.length - 1][0], base);
        mgraphics.close_path();
        mgraphics.fill();
        sptCurve(pts, fvMute(c, 0.8), dim ? 0.4 : 0.95);
    }
}

function fvPaintSplits() {
    var S = fvSplitXs.length;
    if (S < FV_DENSE) {
        for (var j = 0; j < S; j++) {
            var x = Math.max(FV_PLOT.x + 0.5, Math.min(FV_PLOT.x + FV_PLOT.w - 0.5, Math.round(fvUX(fvSplitXs[j])) + 0.5));
            sptCurve([[x, FV_PLOT.y], [x, FV_PLOT.y + FV_PLOT.h]], sptColor("live_display_scale_text"), 0.5);
        }
    }
    var lb = fvLimLabel();
    for (var i = 0; i < fvSegs.length; i++) {
        var sg = fvSegs[i];
        var nx = fvUX((sg.x0 + sg.x1) * 0.5);
        // the limiter readout wins where it would sit on a region number
        if (lb && nx + 4 > lb.x0 && lb.y0 < FV_PLOT.y + 14) continue;     // (text and handle together span lb.x0 .. plot right)
        sptText(String(sg.ch + 1), nx, FV_PLOT.y + 10, fvMute(sg.ch, 0.85), SPT_SIZE_SMALL, 1);
    }
}

// Limiter threshold: thin orange line with a hollow "T" handle, drawn only while the limiter is on (or being dragged).
function fvPaintLimiter() {
    var on = fvVals.limon === 1;
    var y = fvLimY();
    var x1 = FV_PLOT.x + FV_PLOT.w;
    if (!on && !(fvDrag && fvDrag.kind === "limiter")) return;
    var hc = sptColor("live_display_handle_one");
    sptCurve([[FV_PLOT.x, y], [x1, y]], hc, on ? 0.8 : 0.4);
    var lb = fvLimLabel();
    sptHandle(x1 - 9, lb.py, hc, "T", 4.5);
    sptText(lb.text, x1 - 17, lb.base, hc, SPT_SIZE_SMALL, 2);
}

// Limiter handle + readout geometry. The handle stays inside the plot; the readout never sits in the axis label row (100 / 1k / 10k)
// along the plot bottom, so it is lifted above it at the low end of the threshold range.
function fvLimLabel() {
    if (!(fvVals.limon === 1 || (fvDrag && fvDrag.kind === "limiter"))) return null;
    var py = Math.min(Math.max(fvLimY(), FV_PLOT.y + 8), FV_PLOT.y + FV_PLOT.h - 8);
    var text = fsFormatDb(fvVals.limthr);
    var w = sptTextW(text, SPT_SIZE_SMALL);
    var axisTop = FV_PLOT.y + FV_PLOT.h - 3 - (SPT_SIZE_SMALL - 1) * 0.8;     // top of the axis label boxes
    var base = Math.min(py + 3, axisTop - 1 - SPT_SIZE_SMALL * 0.2);
    var x1 = FV_PLOT.x + FV_PLOT.w - 17;
    return { py: py, text: text, base: base, x0: x1 - w, x1: x1, y0: base - SPT_SIZE_SMALL * 0.8, y1: base + SPT_SIZE_SMALL * 0.2 };
}

// XY dot: a hollow handle with faint crosshair lines.
function fvPaintDot() {
    var d = fvDot();
    var active = fvDrag && fvDrag.kind === "dot";
    var hc = sptColor("live_display_handle_one");
    var gc = sptColor("live_display_scale_text");
    sptCurve([[Math.round(d.x) + 0.5, FV_PLOT.y], [Math.round(d.x) + 0.5, FV_PLOT.y + FV_PLOT.h]], gc, 0.35);
    sptCurve([[FV_PLOT.x, Math.round(d.y) + 0.5], [FV_PLOT.x + FV_PLOT.w, Math.round(d.y) + 0.5]], gc, 0.35);
    sptHandle(d.x, d.y, active ? sptMix(hc, [1, 1, 1, 1], 0.4) : hc, "", 4);
    if (fvVals.bend !== 0 || fvVals.pinch !== 0 || active) {
        var txt = "Bend " + (fvVals.bend > 0 ? "+" : "") + Math.round(fvVals.bend) + " %   Pinch " + (fvVals.pinch > 0 ? "+" : "") + Math.round(fvVals.pinch) + " %";
        sptText(txt, FV_PLOT.x + 4, FV_PLOT.y + FV_PLOT.h - 14, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 0);
    }
}

// ---------------------------------------------------------------- interaction
function fvEmitEdit(key, v) {
    outlet(0, key, v);
}

function onclick(x, y) {
    fvHandleDown(x, y, false);
}

function ondblclick(x, y) {
    fvHandleDown(x, y, true);
}

function fvHit(x, y) {
    if (x < FV_PLOT.x - 3 || x > FV_PLOT.x + FV_PLOT.w + 3 || y < FV_PLOT.y - 3 || y > FV_PLOT.y + FV_PLOT.h + 3) return "";
    var d = fvDot();
    if (Math.abs(x - d.x) < 8 && Math.abs(y - d.y) < 8) return "dot";
    // limiter handle is only interactive while on (or mid-drag); hit the painted (clamped) handle and the threshold line
    if (fvVals.limon === 1 || (fvDrag && fvDrag.kind === "limiter")) {
        var lb = fvLimLabel();
        var hy = lb ? lb.py : fvLimY();
        if (Math.abs(y - hy) < 4 || Math.abs(y - fvLimY()) < 4) return "limiter";
    }
    return "plot";
}

function fvXN(x) {
    return Math.max(0, Math.min(1, (x - FV_PLOT.x) / FV_PLOT.w));
}

function fvHandleDown(x, y, dbl) {
    var hit = fvHit(x, y);
    if (hit === "dot") {
        if (dbl) {
            fvEmitEdit("bend", 0);
            fvEmitEdit("pinch", 0);
            return;
        }
        fvDrag = { kind: "dot" };
        fvDragTo(x, y);
    } else if (hit === "limiter") {
        if (dbl) {
            fvEmitEdit("limthr", 0);
            return;
        }
        fvDrag = { kind: "limiter" };
        // no fvDragTo on press: an out-of-plot threshold (e.g. +12 / -120) would jump to the plot edge
    } else if (hit === "plot") {
        if (dbl) {
            fvEmitEdit("spin", 0);
            return;
        }
        fvDrag = { kind: "spin", p0: fsWarpInv(fvXN(x), fvPat.bend, fvPat.pinch), spin0: fvVals.spin / 100 };
    }
}

function ondrag(x, y, but) {
    if (!but) {
        fvDrag = null;
        mgraphics.redraw();
        return;
    }
    fvDragTo(x, y);
}

function fvDragTo(x, y) {
    if (!fvDrag) return;
    var v;
    if (fvDrag.kind === "dot") {
        var m = (x - FV_PLOT.x) / FV_PLOT.w;
        var bend = Math.round((m - 0.5) / FS_BEND_RANGE * 100);
        bend = Math.max(-100, Math.min(100, bend));
        if (Math.abs(bend) < 3) bend = 0;
        var pinch = Math.round(-(y - (FV_PLOT.y + FV_PLOT.h * 0.5)) / (FV_PLOT.h * 0.42) * 100);
        pinch = Math.max(-100, Math.min(100, pinch));
        if (Math.abs(pinch) < 3) pinch = 0;
        if (bend !== fvVals.bend) fvEmitEdit("bend", bend);
        if (pinch !== fvVals.pinch) fvEmitEdit("pinch", pinch);
    } else if (fvDrag.kind === "limiter") {
        var frac = (FV_PLOT.y + FV_PLOT.h - y) / (FV_PLOT.h - 2);
        v = Math.round((FV_DB_LO + frac * (FV_DB_HI - FV_DB_LO)) * 2) / 2;
        v = Math.max(FV_DB_LO, Math.min(FV_DB_HI, v));
        if (v !== fvVals.limthr) fvEmitEdit("limthr", v);
    } else if (fvDrag.kind === "spin") {
        // the pattern slides with the mouse: the spin changes by the pattern-space distance the cursor moved, wrapping at +-50 %
        var p1 = fsWarpInv(fvXN(x), fvPat.bend, fvPat.pinch);
        var sp = fvDrag.spin0 + (p1 - fvDrag.p0);
        sp = sp - Math.floor(sp + 0.5);
        var pct = Math.round(sp * 1000) / 10;
        if (pct !== fvVals.spin) fvEmitEdit("spin", pct);
    }
}

function onidle() {}
function onidleout() {}

// ---------------------------------------------------------------- preview (scripts/render_preview.py calls preview() then paint())
function preview() {
    ssDsp.ready = 1;
    fvInfo = { instanceId: "p", isInRack: true, chainIndex: 1, chainCount: 4, peers: 4, linked: true, autoChannel: 1 };
    // demo state = the live.* parameter defaults (Splits 16, High, XFade 0 %, Nudge / Spin / Bend / Pinch 0, Limiter Off at 0 dB,
    // Mix 100 %, Display Pre), so the display never contradicts the controls shown next to it
    fvVals = { splits: 16, dir: 0, xfade: 0, nudge: 0, spin: 0, bend: 0, pinch: 0, limon: 0, limthr: 0, mix: 100, size: 2, output: 0, dispost: 0 };
    fvRebuild();
    fvSel = 2;
    fvScalars.awake = 1;
    for (var c = 0; c < FS_NCOLS; c++) {
        var f = FS_FMIN * Math.pow(FS_FMAX / FS_FMIN, c / FS_NCOLS);
        var base = 0.80 - 0.26 * Math.log(f / 100) / Math.log(100) + 0.04 * Math.sin(c * 1.7);
        var peak = 0.20 * Math.exp(-Math.pow((f - 220) / 40, 2)) + 0.22 * Math.exp(-Math.pow((f - 1500) / 300, 2)) + 0.12 * Math.exp(-Math.pow((f - 6000) / 900, 2));
        fvPre[c] = Math.max(0.05, base * 0.75 + peak);
        var m = fsMaskAt(fvPat, (c + 0.5) / FS_NCOLS);
        for (var ch = 0; ch < 4; ch++) {
            var lv = m[ch] < 0.003 ? 0 : fvPre[c] + Math.log(m[ch]) / Math.LN10 * 0.2;
            fvCh[ch][c] = Math.max(0, Math.min(lv, 0.76));
        }
    }
}

fvRebuild();
