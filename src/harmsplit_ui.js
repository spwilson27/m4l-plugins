// harmsplit_ui.js — Harmonic Split face (v8ui, one canvas) + spectral_link wiring. The build concatenates
//   harmsplit_config.js, spectral_link.js, spectral_theme.js, this file  into the v8ui script. Ableton-native (Reverb-like) display:
//
// Canvas (HS_VIZ_W x HS_VIZ_H = 280 x 141): a 280 x 92 near-black LCD (faint grid, 1 px lines, log-frequency plot: the Mid spectrum
// in the colour of where each column's energy goes, or the three channels after the masks, as thin outlines with faint fills),
// harmonic ticks in the A / B colours, the tracked fundamental as a small hollow circle with faint crosshairs, hollow orange
// handles with 1 px lines for Low (L) / High (H) / Detection Threshold (T; dragged all the way down it reads Automatic), and a Post
// toggle button top right. Below it: the channel legend (this instance's output channel bright) + chain chip, then the value rows
// `Low` / `High` / `Tilt` / `Threshold` (draggable, double-click resets). All colours come from spectral_theme.js. The
// Low / High / Tilt / Threshold parameters live in hidden live.* objects (automatable from Live's parameter lists); Pattern,
// Sensitivity, Max Harm, Mix, Size and Output are real widgets in the sections beside / under it.
//
// Messages in:  set_<key> <value> for pattern maxh sens tilt thr lowcut highcut mix size output dispost,
//               setnames <scope buffer> <ring buffer>, init_link (live.thisdevice), dsp_restart <chain> (test hook), preview helpers.
// Outlets:      0 [key value]  edits made on the canvas -> route -> the live.* object (which then drives gen as usual)
//               1 [key value]  values applied from a rack peer -> route -> `prepend set` into the live.* object + gen
//               2 gen messages -> the ss_genin hub (gate 1 1; the gen~ is created after load, src/spectral_dsp.js): outsel <0..3> (0 = all
//                 channels summed), scope / ring / lead <buffer name>, role, serve, epoch (rack sharing, src/spectral_link.js), parameters (re-sent)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 3;

var HS_VIZ_W = 280;
var HS_VIZ_H = 141;
var HS_PLOT = { x: 1, y: 1, w: 278, h: 90 };    // inside the 280 x 92 LCD rectangle
var HS_ZONE = 6;                           // px strip below the -100 dB line: -120 dB (Automatic) .. -100 dB
var HS_DEFAULTS = { thr: -120, lowcut: 80, highcut: 1500, tilt: 0 };
var HS_RANGES = { thr: [-120, 0], lowcut: [19.4, 19900], highcut: [19.4, 19900], tilt: [-12, 12] };
var HS_FIELDS = {
    lowcut: { x: 2, y: 107, w: 130, h: 14 },
    highcut: { x: 140, y: 107, w: 138, h: 14 },
    tilt: { x: 2, y: 121, w: 130, h: 14 },
    thr: { x: 140, y: 121, w: 138, h: 14 }
};

// pattern = control index (0..23 = Harmonics Pattern 1..24); maxh 0 = Off; thr -120 = Automatic
var hsVals = { pattern: 1, maxh: 0, sens: 50, tilt: 0, thr: -120, lowcut: 80, highcut: 1500, mix: 100, size: 1, output: 0, dispost: 0 };
var hsPre = [];
var hsNh = [];
var hsA = [];
var hsB = [];
var hsScalars = { frame: 0, awake: 0, sr: 48000, n: 2048, level: 0, f0: 0, series: 0, rootH: 0, odd: 0, conf: 0, voiced: 0, lvl: -100, nact: 0, threff: -120 };
var hsNames = { scope: "", ring: "" };
var hsBufName = "";            // the buffer the display is drawn from (the leader's scope while following)
var hsBuf = null;
var hsOwnBuf = null;
var hsTask = null;
var hsLastFrame = -1;
var hsIdleDrawn = false;
var hsDrag = null;
var hsLink = null;
var hsInfo = { instanceId: "", isInRack: false, chainIndex: 0, chainCount: 0, peers: 1, linked: false, autoChannel: -1 };
var hsSel = 0;
var hsLastSel = -1;

(function initArrays() {
    for (var i = 0; i < HS_NCOLS; i++) {
        hsPre.push(0);
        hsNh.push(0);
        hsA.push(0);
        hsB.push(0);
    }
})();

// ---------------------------------------------------------------- state in
function hsSetVal(key, v) {
    var changed = hsVals[key] !== v;
    hsVals[key] = v;
    if (key === "output") hsEmitSel();
    if (hsLink && HS_LINKED_KEYS.indexOf(key) >= 0) hsLink.notify(key, v);
    if (changed) mgraphics.redraw();
}

function set_pattern(v) { hsSetVal("pattern", Number(v)); }
function set_maxh(v) { hsSetVal("maxh", Number(v)); }
function set_sens(v) { hsSetVal("sens", Number(v)); }
function set_tilt(v) { hsSetVal("tilt", Number(v)); }
function set_thr(v) { hsSetVal("thr", Number(v)); }
function set_lowcut(v) { hsSetVal("lowcut", Number(v)); }
function set_highcut(v) { hsSetVal("highcut", Number(v)); }
function set_mix(v) { hsSetVal("mix", Number(v)); }
function set_size(v) { hsSetVal("size", Number(v)); }
function set_output(v) { hsSetVal("output", Number(v)); }
function set_dispost(v) { hsSetVal("dispost", Number(v) ? 1 : 0); }

function hsEmitSel() {
    hsSel = hsResolveSel(hsVals.output, hsInfo.autoChannel);
    if (hsSel !== hsLastSel) {
        hsLastSel = hsSel;
        outlet(2, "outsel", hsSel);
    }
}

// ---------------------------------------------------------------- link
function init_link() {
    if (hsLink) return;
    if (typeof LiveAPI === "undefined" || typeof Global === "undefined") return;
    hsLink = splCreateLink({
        kind: "harmsplit",
        keys: HS_LINKED_KEYS,
        channelCount: 3,
        rack: {
            channels: HS_RACK_CHANNELS,
            ring: function () { return hsNames.ring; },
            genState: function () { return { alive: hsGenValue(HS_SC_ALIVE), fb: Math.max(0, hsGenValue(HS_SC_FB)) }; },
            send: function (name, value) { outlet(2, name, value); }
        },
        getLocal: function (key) { return hsVals[key]; },
        apply: function (key, value) {
            hsVals[key] = value;
            outlet(1, key, value);
            mgraphics.redraw();
        },
        onInfo: function (info) {
            hsInfo = info;
            ssDspDry(0);
            hsEmitSel();
            mgraphics.redraw();
        }
    });
    hsLink.init();
    hsStartPolling();
    ssDspSchedule(hsInfo.instanceId);
}

function setnames(scopeName, ringName) {
    hsNames.scope = scopeName ? String(scopeName) : "";
    hsNames.ring = ringName ? String(ringName) : "";
    splNoteScope(hsNames.scope);
    hsBuf = null;
    hsOwnBuf = null;
    hsStartPolling();
}

// Kept for tools that only know the scope buffer.
function setbuffer(name) {
    setnames(name, hsNames.ring);
}

// ---------------------------------------------------------------- deferred DSP (src/spectral_dsp.js) and rack messages
function hsGenValue(idx) {
    if (!hsNames.scope) return -1;
    try {
        if (!hsOwnBuf) hsOwnBuf = new Buffer(hsNames.scope);
        var v = hsOwnBuf.peek(1, idx, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (err) {
        hsOwnBuf = null;
        return -1;
    }
}

function ssGenAlive() {
    return hsGenValue(HS_SC_ALIVE);
}

// Every gen-bound message from the values the face holds (a deferred gen~ drops messages until it runs).
function ssDevResend() {
    if (hsNames.scope) outlet(2, "scope", hsNames.scope);
    if (hsNames.ring) outlet(2, "ring", hsNames.ring);
    var m = hsGenMessages(hsVals);
    for (var i = 0; i < m.length; i++) outlet(2, m[i][0], m[i][1]);
    outlet(2, "outsel", hsSel);
    if (hsLink && hsLink.rack) {
        var rm = hsLink.rack.messages();
        for (var j = 0; j < rm.length; j++) outlet(2, rm[j][0], rm[j][1]);
    }
}

function ssDevChanged() {
    mgraphics.redraw();
}

// Test hook (receive #0-sstest): restart the DSP of the instance in chain <c> [of device <kind> = SS_PREFIX] (a late start: a new gen~ with a new sample counter).
function dsp_restart(c, kind) {
    if (kind !== undefined && String(kind) !== SS_PREFIX) return;   // optional device filter: several racks share one test set
    if (hsInfo.chainIndex === Number(c) || Number(c) < 0) ssDspRestart();
}

function hsStartPolling() {
    if (hsTask || typeof Task === "undefined") return;
    hsTask = new Task(hsPoll, this);
    hsTask.interval = 66;
    hsTask.repeat();
}

function hsDispName() {
    var lead = hsLink && hsLink.rack ? hsLink.rack.displayScope() : "";
    return lead || hsNames.scope;
}

function hsPoll() {
    var name = hsDispName();
    if (!name) return;
    try {
        if (!hsBuf || name !== hsBufName) {
            hsBuf = new Buffer(name);
            hsBufName = name;
            hsLastFrame = -1;
        }
        // header first (frame counter, awake): the other 540 floats are only read when a new telemetry frame exists
        var h = hsBuf.peek(1, HS_SC_FRAME, 4);
        if (!h || h.length < 4) return;
        var frame = h[0];
        var aw = h[3];
        if (frame === hsLastFrame && aw === hsScalars.awake) return;
        if (aw < 0.5 && hsScalars.awake < 0.5 && hsIdleDrawn) {
            hsLastFrame = frame;
            return;
        }
        var d = hsBuf.peek(1, 0, HS_SCOPE_SAMPS);
        if (!d || d.length < HS_SC_ODD + 1) return;
        hsLastFrame = frame;
        for (var c = 0; c < HS_NCOLS; c++) {
            hsPre[c] = d[HS_SC_PRE + c];
            hsNh[c] = d[HS_SC_NH + c];
            hsA[c] = d[HS_SC_A + c];
            hsB[c] = d[HS_SC_B + c];
        }
        hsScalars.frame = frame;
        hsScalars.awake = aw;
        hsScalars.sr = d[HS_SC_SR];
        hsScalars.n = d[HS_SC_N];
        hsScalars.level = d[HS_SC_LEVEL];
        // the computing instance leaves its last analysis in the buffer when it falls asleep: show it as empty
        var live = aw > 0.5;
        hsScalars.f0 = live ? d[HS_SC_F0] : 0;
        hsScalars.series = live ? d[HS_SC_SERIES] : 0;
        hsScalars.rootH = live ? d[HS_SC_ROOTH] : 0;
        hsScalars.odd = live ? d[HS_SC_ODD] : 0;
        hsScalars.conf = live ? d[HS_SC_CONF] : 0;
        hsScalars.voiced = live ? d[HS_SC_VOICED] : 0;
        hsScalars.lvl = live ? d[HS_SC_LVL] : -100;
        hsScalars.nact = live ? d[HS_SC_NACT] : 0;
        hsScalars.threff = live ? d[HS_SC_THREFF] : HS_THR_MIN;
        hsIdleDrawn = aw < 0.5;
        mgraphics.redraw();
    } catch (err) {
        hsBuf = null;
    }
}

// ---------------------------------------------------------------- theme (colours from spectral_theme.js, one orange accent)
// Channels: 1 Nonharmonics = Live's grey scale text, 2 Harmonics A = display line one (orange), 3 Harmonics B = display line two
// (cyan). Always drawn muted: 1 px outlines and faint fills. Interactive handles use the handle colour (orange, hollow circles).
function hsColNh() { return sptColor("live_display_scale_text"); }
function hsColA() { return sptColor("live_display_line_one"); }
function hsColB() { return sptColor("live_display_line_two"); }
var HS_PANELS = [["obj-panel-body", "live_surface_bg"], ["obj-panel-det", "live_desktop"], ["obj-panel-harm", "live_desktop"], ["obj-panel-out", "live_desktop"]];
var hsThemeTask = sptThemeWatch(function () { sptApplyPanelTheme(HS_PANELS); });


function hsBase() {
    return HS_PLOT.y + HS_PLOT.h;
}

// dB -> y: -100..0 dB over the plot (spectra grow from the -100 dB line), -120..-100 dB in the strip below it
function hsYOfDb(db) {
    var base = hsBase();
    if (!(db === db)) db = HS_THR_MIN;
    if (db < -100) return base - 1 - (Math.max(db, -120) + 120) / 20 * (HS_ZONE - 1);
    var t = Math.min(db, 0) + 100;
    return base - HS_ZONE - t / 100 * (HS_PLOT.h - HS_ZONE - 6);
}

function hsDbOfY(y) {
    var base = hsBase();
    var yb = base - HS_ZONE;
    if (y >= yb) return -120 + (base - 1 - y) / (HS_ZONE - 1) * 20;
    return -100 + (yb - y) / (HS_PLOT.h - HS_ZONE - 6) * 100;
}

// telemetry level 0..1 (-100..0 dB) -> height in px above the -100 dB line
function hsLvH(v) {
    var t = !(v > 0) ? 0 : (v > 1 ? 1 : v);      // NaN / negative -> 0
    return t * (HS_PLOT.h - HS_ZONE - 6);
}

function hsLin(v) {
    if (!(v > 0)) v = 0;
    else if (v > 1) v = 1;
    return Math.pow(10, (v * 100 - 100) / 20);
}

var HS_LOG_SPAN = Math.log(HS_FMAX / HS_FMIN);
var HS_COL_X = [];
for (var hsColInit = 0; hsColInit < HS_NCOLS; hsColInit++) HS_COL_X.push(HS_PLOT.x + (hsColInit + 0.5) * HS_PLOT.w / HS_NCOLS);
var HS_EDGE_CACHE = { lo: NaN, hi: NaN, xlo: 0, xhi: 0 };

function hsColX(c) {
    return HS_COL_X[c];
}

function hsFreqX(f) {
    var t = Math.log(f / HS_FMIN) / HS_LOG_SPAN;
    t = !(t > 0) ? 0 : (t > 1 ? 1 : t);      // NaN / below FMIN -> left edge
    return HS_PLOT.x + t * HS_PLOT.w;
}
var HS_GRID_X = [hsFreqX(100), hsFreqX(1000), hsFreqX(10000)];

function hsEdges() {
    var lo = hsVals.lowcut;
    var hi = hsVals.highcut;
    if (HS_EDGE_CACHE.lo !== lo || HS_EDGE_CACHE.hi !== hi) {
        HS_EDGE_CACHE.lo = lo;
        HS_EDGE_CACHE.hi = hi;
        HS_EDGE_CACHE.xlo = hsFreqX(lo);
        HS_EDGE_CACHE.xhi = hsFreqX(hi);
    }
    return HS_EDGE_CACHE;
}

function hsXFreq(x) {
    var t = (x - HS_PLOT.x) / HS_PLOT.w;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return HS_FMIN * Math.pow(HS_FMAX / HS_FMIN, t);
}

function hsToggleRect() {
    return { x: HS_VIZ_W - 34, y: 4, w: 30, h: 13 };
}

// x of the L / H flag handles: the line keeps the true frequency x, the handle stays fully inside the canvas and clear of the Post button
function hsFlagX(x) {
    var t = hsToggleRect();
    return sptClamp(x, HS_PLOT.x + 5, t.x - 6);
}

function hsInside(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function hsPatternNumber() {
    return Math.round(hsVals.pattern) + 1;
}

function hsMaxHarm() {
    return hsVals.maxh < 0.5 ? HS_MAXH : Math.round(hsVals.maxh);
}

// ---------------------------------------------------------------- paint
function paint() {
    var W = HS_VIZ_W;
    var drag = hsDrag ? hsDrag.kind : "";
    var yb = hsBase() - HS_ZONE;

    // display: near-black LCD with a faint grid (100 Hz / 1 kHz / 10 kHz, -20 .. -80 dB)
    var gx = HS_GRID_X;
    var gy = [hsYOfDb(-20), hsYOfDb(-40), hsYOfDb(-60), hsYOfDb(-80), yb];
    sptLcd(0, 0, W, HS_PLOT.h + 2, { xs: gx, ys: gy });
    var labels = ["100", "1k", "10k"];

    if (hsVals.dispost) hsPaintPost();
    else hsPaintPre();
    for (var g = 0; g < labels.length; g++) sptText(labels[g], gx[g] + 3, yb - 3, sptColor("live_display_scale_text"), SPT_SIZE_SMALL - 1, 0);
    hsPaintHarmonics();
    hsPaintAnalysis();
    if (hsScalars.awake < 0.5) sptText("no signal", HS_PLOT.x + HS_PLOT.w * 0.5, HS_PLOT.y + 40, sptColor("live_display_scale_text"), SPT_SIZE, 1);
    var pill = ssDspPill();
    if (pill) sptText(pill, HS_PLOT.x + 4, HS_PLOT.y + 11, sptColor(ssDsp.error ? "live_alert" : "live_control_selection"), SPT_SIZE_SMALL, 0);

    // display / post toggle (top right of the LCD)
    var t = hsToggleRect();
    sptButton(t.x, t.y, t.w, t.h, "Post", hsVals.dispost ? 1 : 0);

    // legend row: the output channel of this instance is the bright one; chain chip on the right
    var ly = 105;
    var names = ["Nonharm", "Harm A", "Harm B"];
    var cols = [hsColNh(), hsColA(), hsColB()];
    var lx = 2;
    for (var i = 0; i < 3; i++) {
        var on = hsSel === 0 || hsSel === i + 1;
        sptLegendSwatch(lx, ly - 5, sptMuted(cols[i], on ? 1 : 0.55));
        var tc = on ? sptColor("live_control_fg") : sptColor("live_display_scale_text");
        sptText(names[i], lx + 9, ly, tc, SPT_SIZE_SMALL, 0);
        lx += 9 + sptTextW(names[i], SPT_SIZE_SMALL) + 12;
    }
    var chip = hsInfo.isInRack ? ("Chain " + (hsInfo.chainIndex + 1) + "/" + Math.max(hsInfo.chainCount, 1)
        + (hsInfo.linked ? ", linked" : "")) : "No rack";
    if (sptTextW(chip, SPT_SIZE_SMALL) > W - 2 - (lx - 12) - 8) chip = hsInfo.isInRack ? ("Chain " + (hsInfo.chainIndex + 1)) : "No rack";
    sptTextIn(chip, W - 2, ly, sptColor("live_display_scale_text"), SPT_SIZE_SMALL, 2, { x: lx - 4, y: ly - 8, w: W - (lx - 4), h: 11 });

    // value rows: Low / High (detection band), Tilt / Threshold
    var f = HS_FIELDS;
    sptLabelValue("Low", hsFmtFreq(hsVals.lowcut), f.lowcut.x, f.lowcut.y + 11, 0, drag === "lowcut", 32);
    sptLabelValue("High", hsFmtFreq(hsVals.highcut), f.highcut.x, f.highcut.y + 11, 0, drag === "highcut", 56);
    sptLabelValue("Tilt", sptClamp(hsVals.tilt, -99, 99).toFixed(1) + " dB", f.tilt.x, f.tilt.y + 11, 0, drag === "tilt", 32);
    sptLabelValue("Threshold", hsFmtThr(hsVals.thr), f.thr.x, f.thr.y + 11, 0, drag === "thr", 56);
}

// y of the top of a column's line / bar
function hsColTop(arr, c) {
    return hsBase() - HS_ZONE - hsLvH(arr[c]);
}

// PRE: the Mid spectrum, one thin line per column in the colour of where its energy goes (blend of the three channel colours),
// over a faint fill of the same colour.
function hsPaintPre() {
    var yb = hsBase() - HS_ZONE;
    var cw = HS_PLOT.w / HS_NCOLS;
    var cn = hsColNh(), ca = hsColA(), cb = hsColB();
    var prev = null;
    for (var c = 0; c < HS_NCOLS; c++) {
        var h = hsLvH(hsPre[c]);
        var wn = hsLin(hsNh[c]);
        var wa = hsLin(hsA[c]);
        var wb = hsLin(hsB[c]);
        var s = wn + wa + wb + 1e-12;
        var col = [(cn[0] * wn + ca[0] * wa + cb[0] * wb) / s, (cn[1] * wn + ca[1] * wa + cb[1] * wb) / s, (cn[2] * wn + ca[2] * wa + cb[2] * wb) / s, 1];
        var x = hsColX(c);
        var y = yb - h;
        if (h >= 0.5) {
            sptRgba(col, 0.16);
            mgraphics.rectangle(HS_PLOT.x + c * cw, y, Math.max(cw, 1), h);
            mgraphics.fill();
        }
        if (prev) sptCurve([[prev[0], prev[1]], [x, y]], prev[2], 0.9);
        prev = [x, y, col];
    }
}

// POST: the three channels as thin outlines with a faint fill; the one this instance outputs is brighter.
function hsPaintPost() {
    var arrs = [hsNh, hsB, hsA];
    var cols = [hsColNh(), hsColB(), hsColA()];
    var chan = [1, 3, 2];
    for (var i = 0; i < 3; i++) {
        var on = hsSel === chan[i] || hsSel === 0;
        hsArea(arrs[i], cols[i], on ? 0.16 : 0.06, on ? 0.95 : 0.4);
    }
}

function hsArea(arr, col, a, lineA) {
    var yb = hsBase() - HS_ZONE;
    mgraphics.move_to(HS_PLOT.x, yb);
    for (var c = 0; c < HS_NCOLS; c++) mgraphics.line_to(hsColX(c), yb - hsLvH(arr[c]));
    mgraphics.line_to(HS_PLOT.x + HS_PLOT.w, yb);
    mgraphics.close_path();
    sptRgba(col, a);
    mgraphics.fill();
    var pts = [];
    for (var k = 0; k < HS_NCOLS; k++) pts.push([hsColX(k), yb - hsLvH(arr[k])]);
    sptCurve(pts, col, lineA);
}

// Analysis parameters: Low / High lines with hollow L / H handles and the Detection Threshold line with its handle.
function hsPaintAnalysis() {
    var top = HS_PLOT.y;
    var hc = sptColor("live_display_handle_one");
    // outside the detection band (fundamental search range) the plot is dimmed; an empty band (Low >= High) dims all of it
    var dimH = HS_PLOT.h - HS_ZONE - 12;
    var edge = hsEdges();
    var xlo = edge.xlo, xhi = edge.xhi;
    var px0 = HS_PLOT.x, px1 = HS_PLOT.x + HS_PLOT.w;
    sptRgba(sptColor("live_lcd_bg"), 0.6);
    if (hsVals.lowcut >= hsVals.highcut) {
        mgraphics.rectangle(px0, top + 12, px1 - px0, dimH);
        mgraphics.fill();
    } else {
        if (xlo > px0) { mgraphics.rectangle(px0, top + 12, xlo - px0, dimH); mgraphics.fill(); }
        if (xhi < px1) { mgraphics.rectangle(xhi, top + 12, px1 - xhi, dimH); mgraphics.fill(); }
    }
    var edges = [{ x: xlo, k: "lowcut", t: "L" }, { x: xhi, k: "highcut", t: "H" }];
    for (var i = 0; i < 2; i++) {
        var e = edges[i];
        var on = hsDrag && hsDrag.kind === e.k;
        sptRgba(hc, on ? 1 : 0.5);
        mgraphics.rectangle(Math.round(e.x) - 0.5, top + 11, 1, HS_PLOT.h - 12);
        mgraphics.fill();
        // the handle stays fully inside the canvas at the extreme frequencies (the line keeps the true x)
        sptHandle(hsFlagX(e.x), top + 6.5, hc, e.t, 4.5);
    }
    // Detection Threshold: 1 px line (Automatic sits on the bottom axis), faint dashed effective level while Automatic
    var auto = hsVals.thr <= HS_THR_MIN + 0.5;
    var y = hsYOfDb(hsVals.thr);
    var x0 = HS_PLOT.x + 1;
    var x1 = HS_PLOT.x + HS_PLOT.w - 1;
    var onT = hsDrag && hsDrag.kind === "thr";
    if (auto && hsScalars.awake > 0.5 && hsScalars.threff > -119) {
        var ye = hsYOfDb(hsScalars.threff);
        sptRgba(hc, 0.35);
        for (var xd = x0; xd < x1 - 6; xd += 6) {
            mgraphics.rectangle(xd, Math.round(ye) - 0.5, 3, 1);
            mgraphics.fill();
        }
    }
    sptRgba(hc, onT ? 1 : 0.5);
    mgraphics.rectangle(x0, Math.round(y) - 0.5, x1 - x0, 1);
    mgraphics.fill();
    // the T handle sits at the right edge; near the top (threshold close to 0 dB) it moves left of the Post button and the flags
    var tg = hsToggleRect();
    var hy = Math.min(y, hsBase() - 6.5);
    sptHandle(hy - 4.5 < tg.y + tg.h + 1 ? tg.x - 22 : x1 - 9, hy, hc, "T", 4.5);
}

// Harmonic markers (A / B colours by the Pattern rule) and the ROOT (small hollow circle with faint crosshairs).
// The root is the lowest present partial of the tracked series inside the band; the series fundamental may lie below the band, so the
// markers are placed at the series positions (hr + j) * fs, numbered h' = j + 1 from the root (odd-only series: even positions skipped).
function hsPaintHarmonics() {
    var f0 = hsScalars.f0;
    if (!(f0 > 0)) return;
    // the root lies inside the detection band by construction (half an octave of soft edge kept for the demo state)
    if (!(hsVals.lowcut < hsVals.highcut) || f0 < hsVals.lowcut * 0.7071 || f0 > hsVals.highcut * 1.4142) return;
    var hr = hsScalars.rootH >= 1 ? hsScalars.rootH : 1;
    var fs = hsScalars.series > 0 ? hsScalars.series : f0 / hr;
    var odd = hsScalars.odd > 0.5;
    var top = HS_PLOT.y;
    var yb = hsBase() - HS_ZONE;
    var va = 0.35 + 0.65 * hsScalars.voiced;
    var maxh = Math.min(hsMaxHarm(), 404);
    var pat = hsPatternNumber();
    var ca = hsColA(), cb = hsColB();
    for (var j = 0; j < maxh && hr + j <= 404; j++) {
        var hs = hr + j;
        if (odd && (hs % 2) === 0) continue;
        var f = hs * fs;
        if (f > HS_FMAX * 0.99) break;
        if (f < HS_FMIN) continue;
        var x = hsFreqX(f);
        if (hsFreqX(f + fs * (odd ? 2 : 1)) - x < 3) break;      // markers merge into a smear: stop where they get denser than 3 px
        var col = hsIsA(j + 1, pat) > 0.5 ? ca : cb;
        sptRgba(col, 0.75 * va);
        mgraphics.rectangle(Math.round(x) - 0.5, top + 14, 1, 5);
        mgraphics.fill();
        sptRgba(col, 0.14 * va);
        mgraphics.rectangle(Math.round(x) - 0.5, top + 19, 1, yb - top - 19);
        mgraphics.fill();
    }
    // fundamental: hollow circle on the pre spectrum, faint crosshairs through it
    var fg = sptColor("live_control_fg");
    var cx = hsFreqX(f0);
    var cidx = Math.round(Math.log(f0 / HS_FMIN) / HS_LOG_SPAN * HS_NCOLS - 0.5);
    cidx = cidx < 0 ? 0 : (cidx > HS_NCOLS - 1 ? HS_NCOLS - 1 : cidx);
    var cy = yb - hsLvH(hsPre[cidx]);
    cy = Math.max(top + 16, Math.min(yb - 3, cy));
    sptRgba(fg, 0.3);
    mgraphics.rectangle(Math.round(cx) - 0.5, top + 12, 1, HS_PLOT.h - HS_ZONE - 12);
    mgraphics.fill();
    mgraphics.rectangle(HS_PLOT.x, Math.round(cy) - 0.5, HS_PLOT.w, 1);
    mgraphics.fill();
    var hx = sptClamp(cx, HS_PLOT.x + 4, HS_PLOT.x + HS_PLOT.w - 4);
    sptHandle(hx, cy, fg, "", 3);
    var ft = hsFmtFreq(f0);
    var sub = hr > 1 && fs > 0 ? "f0 " + hsFmtFreq(fs) + "  h" + hr : "";
    var wide = Math.max(sptTextW(ft, SPT_SIZE_SMALL), sptTextW(sub, SPT_SIZE_SMALL - 1));
    var tx = hx + 7;
    var al = 0;
    if (tx + wide > HS_PLOT.x + HS_PLOT.w - 2) {
        tx = hx - 7;
        al = 2;
    }
    // the label rows stay above the axis labels (100 / 1k / 10k, baseline yb - 3) and inside the plot
    var axisTop = yb - 3 - (SPT_SIZE_SMALL - 1) * 0.8 - 1;
    var ty = Math.min(Math.max(top + 26, cy - 5), axisTop - 1.5 - (sub ? 9 : 0));
    var lr = { x: HS_PLOT.x, y: top, w: HS_PLOT.w, h: yb - top };
    sptTextIn(ft, tx, ty, fg, SPT_SIZE_SMALL, al, lr);
    // series fundamental below the root (the root is its h-th harmonic): small dim note under the label
    if (sub) sptTextIn(sub, tx, ty + 9, sptColor("live_display_scale_text"), SPT_SIZE_SMALL - 1, al, lr);
}

// ---------------------------------------------------------------- interaction
function hsEmitEdit(key, v) {
    outlet(0, key, v);
}

function onclick(x, y) {
    hsHandleDown(x, y, false);
}

function ondblclick(x, y) {
    hsHandleDown(x, y, true);
}

function hsClampKey(key, v) {
    var r = HS_RANGES[key];
    v = Math.max(r[0], Math.min(r[1], v));
    if (key === "lowcut") v = Math.min(v, hsVals.highcut);
    if (key === "highcut") v = Math.max(v, hsVals.lowcut);
    return v;
}

function hsRound(key, v) {
    if (key === "thr") return v <= HS_THR_MIN + 0.4 ? HS_THR_MIN : Math.round(v * 10) / 10;
    if (key === "tilt") return Math.round(v * 10) / 10;
    return Math.round(v * 10) / 10;
}

function hsHandleDown(x, y, dbl) {
    hsDrag = null;
    var t = hsToggleRect();
    if (hsInside(t, x, y)) {
        hsEmitEdit("dispost", hsVals.dispost ? 0 : 1);
        return;
    }
    // value fields (vertical drag, double-click resets)
    for (var key in HS_FIELDS) {
        if (hsInside(HS_FIELDS[key], x, y)) {
            if (dbl) {
                hsEmitEdit(key, HS_DEFAULTS[key]);
                return;
            }
            hsDrag = { kind: key, field: true, y0: y, v0: hsVals[key] };
            return;
        }
    }
    if (x < HS_PLOT.x || x > HS_PLOT.x + HS_PLOT.w || y < HS_PLOT.y || y > HS_PLOT.y + HS_PLOT.h) return;
    var ty = hsYOfDb(hsVals.thr);
    var xl = hsEdges().xlo;
    var xh = hsEdges().xhi;
    var dT = Math.abs(y - ty);
    var dL = Math.abs(x - xl);
    var dH = Math.abs(x - xh);
    // In the top flag strip, honour the painted L/H flag x (hsFlagX may inset them).
    // Do not zero the threshold distance: the thr line / T handle sit in this same strip
    // when Threshold is high, and must stay grabbable away from the flags.
    if (y < HS_PLOT.y + 12) {
        dL = Math.abs(x - hsFlagX(xl)) <= 6 ? 0 : dL;
        dH = Math.abs(x - hsFlagX(xh)) <= 6 ? 0 : dH;
    }
    var best = Math.min(dT, Math.min(dL, dH));
    if (best > 5) return;
    var kind = best === dL ? "lowcut" : (best === dH ? "highcut" : "thr");
    if (dbl) {
        hsEmitEdit(kind, HS_DEFAULTS[kind]);
        return;
    }
    // x0 / v0: the pointer is on the painted handle, which hsFlagX may have pulled in from the cutoff line
    hsDrag = { kind: kind, field: false, x0: x, v0: hsVals[kind] };
    hsDragTo(x, y);
}

function ondrag(x, y, but) {
    if (!but) {
        hsDrag = null;
        mgraphics.redraw();
        return;
    }
    hsDragTo(x, y);
}

function hsDragTo(x, y) {
    if (!hsDrag) return;
    var key = hsDrag.kind;
    var v;
    if (hsDrag.field) {
        var r = HS_RANGES[key];
        var d = (hsDrag.y0 - y) / 120;
        if (key === "lowcut" || key === "highcut") v = hsDrag.v0 * Math.pow(r[1] / r[0], d);
        else v = hsDrag.v0 + d * (r[1] - r[0]);
    } else if (key === "thr") {
        v = hsDbOfY(y);
    } else {
        // Move the cutoff's own line by the pointer delta. A click on the inset handle (and any
        // pointer still on that same line pixel) keeps the stored frequency: below the axis every
        // cutoff shares the left pixel, so hsXFreq of that pixel is not the stored value.
        var origin = hsFreqX(hsDrag.v0);
        var nx = origin + (x - hsDrag.x0);
        v = hsXFreq(nx);
        if (Math.abs(hsFreqX(v) - origin) < 0.5) v = hsDrag.v0;
    }
    v = hsRound(key, hsClampKey(key, v));
    if (v !== hsVals[key]) hsEmitEdit(key, v);
}

function onidle() {}
function onidleout() {}

// ---------------------------------------------------------------- preview (scripts/render_preview.py calls preview() then paint())
function preview() {
    ssDsp.ready = 1;
    hsInfo = { instanceId: "p", isInRack: true, chainIndex: 1, chainCount: 3, peers: 3, linked: true, autoChannel: 1 };
    hsVals.dispost = 1;
    // demo state = the live.* parameter defaults (Low 80 Hz, High 1.5 kHz, Tilt 0, Threshold Automatic, Pattern Every 2nd, Max Harm Off, Sens 50 %)
    hsVals.sens = 50;
    hsVals.thr = -120;
    hsVals.tilt = 0;
    hsVals.lowcut = 80;
    hsVals.highcut = 1500;
    hsVals.pattern = 1;
    hsVals.maxh = 0;
    hsSel = 2;
    var f0 = 196;
    hsScalars = { frame: 5, awake: 1, sr: 48000, n: 2048, level: 0.2, f0: f0, series: f0, rootH: 1, odd: 0, conf: 0.66, voiced: 1, lvl: -14, nact: 40, threff: -54 };
    for (var c = 0; c < HS_NCOLS; c++) {
        var f = HS_FMIN * Math.pow(HS_FMAX / HS_FMIN, (c + 0.5) / HS_NCOLS);
        var floorLv = 0.30 - 0.12 * Math.log(f / 100) / Math.log(100);
        var h = Math.round(f / f0);
        var near = h >= 1 ? Math.abs(f - h * f0) / (f0 * 0.5) : 1;
        var peak = h >= 1 && h <= hsMaxHarm() ? Math.exp(-near * near * 14) * (0.62 - 0.16 * Math.log(h + 1) / Math.log(40)) : 0;
        var pre = Math.max(floorLv, floorLv + peak);
        var isA = h >= 1 && hsIsA(h, hsPatternNumber()) > 0.5;
        hsPre[c] = Math.min(0.97, pre);
        hsNh[c] = Math.max(0.03, floorLv - 0.03);
        hsA[c] = isA ? Math.max(0.03, hsPre[c] - 0.02) : 0.03 + peak * 0.1;
        hsB[c] = !isA && peak > 0.02 ? Math.max(0.03, hsPre[c] - 0.02) : 0.03 + peak * 0.1;
        if (peak < 0.02) {
            hsA[c] = 0.03;
            hsB[c] = 0.03;
            hsNh[c] = hsPre[c];
        }
    }
}
