// Clip+ face. Flanking L/R (or M/S) VU columns, compact Better-Sampler-style inline hValueBars,
// adjustable-width bipolar Gain Curve / Waveform display, and a left-hand Filter popout panel
// (gain-compensated Low Shelf fork or Low Cut with Q resonance and live spectrogram).
//
//   - Optional left Filter popout panel (`x = 4..120`, 116 px wide) toggled by `Filter` in Options:
//     applies a gain-compensated Low Shelf or Low Cut to the pre-signal and inverts it on the output signal,
//     with a 64-bin live spectrogram and vertical dragging in Low-Cut mode adjusting Q.
//   - Left VU column: Input dB control directly above the tall dual-channel L/R (or M/S) IN VU meter (with Peak/RMS readouts & dB scale ticks).
//   - Center: Compact Better-Sampler-style inline hValueBars (`Drive`, `Detail`, `Ceil`, `Shape`, `Sym`)
//     at the top (`y = 6`), leaving a tall central bipolar Gain Curve / Waveform display (`obj-viz`),
//     whose width is dynamically adjustable via the `Mid Size` (`Width` 160..360 px) control!
//   - In Gain Curve mode: bipolar transfer curve (-X..+X -> -Y..+Y) with center tick-marked axes, ceiling lines, and a bright
//     highlighted active segment + live scatter dots + peak cursors showing the exact location where the signal hits the gain curve.
//   - Right VU column: Output dB / AUTO text-only `live.menu` selector directly above the tall vertical GR + dual-channel L/R OUT VU meters (with sticky max GR readout — click to clear).
//   - Right-hand `Options` panel: `Curve / Wave` text-only `live.menu` selection box, `Mid Size` width control, `L/R | M/S` + `All | L/M | R/S` channel selectors, `Filter` popout toggle, `Delta`, `DC`, `4x`, `Peak`, `Meters`.
// Uses `FACE_ROLE` ("viz", "in_meter", "out_meter", "filt_viz") injected by the build script.
// Colours come from spectral_theme.js. Do not declare Max's own globals.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var CS_ROLE = (typeof FACE_ROLE === "string") ? FACE_ROLE : "viz";
var csMidW = 180;
var CS_H = 157;
var CS_TAB_W = 20;
var CS_FILT_W = 120;
var CS_FW = 112;
var CS_FH = 66;
var CS_FPLOT = { x: 2, y: 2, w: 108, h: 62 };

var CP_DB_LO = -36;
var CP_DB_HI = 6;
var CS_SPAN = 1.25;

var cpIn = 0;
var cpDrive = 0;
var cpDetail = 100;
var cpShape = 0;
var cpSym = 0;
var cpCeil = 0;
var cpOut = 0;
var cpOn = 1;
var cpDlt = 0;
var cpDc = 0;
var cpOs = 0;
var cpHlim = 1;
var cpTp = 0;
var cpAuto = 1;
var cpMeters = 0;
var cpView = 0;
var cpMsMode = 0;
var cpChMode = 0;
var cpShowFilt = 0;
var cpFiltOn = 0;
var cpFiltType = 0;
var cpFiltFreq = 250;
var cpFiltGain = 6;
var cpFiltQ = 0.707;
var cpMaxGr = 0;
var cpDragOn = 0;
var cpDragKey = "";
var cpDragX = 0;
var cpDragY = 0;
var cpDragV0 = 0;
var cpDragDrive = 0;
var cpDragCeil = 0;
var cpDragFreq = 250;
var cpDragGain = 6;
var cpDragQ = 0.707;

var cpScope = {
    inPk: 0, outPk: 0, inMs: 0, outMs: 0, clip: 0, gr: 0, frame: -1, drvPk: 0, wetPk: 0,
    inPkL: 0, inPkR: 0, outPkL: 0, outPkR: 0, drvPkL: 0, drvPkR: 0, wetPkL: 0, wetPkR: 0
};
/** @type {Array<Array<number>>} */
var cpDots = [];
/** @type {Array<Array<number>>} */
var cpWave = [];
/** @type {Array<number>} */
var cpSpec = [];

var CP_METER_BOXES = ["obj-panel-meters", "obj-title-meters", "obj-rule-meters", "obj-meters", "obj-reset"];
var CP_FILT_BOXES = [
    "obj-title-filt", "obj-rule-filt", "obj-filt-viz",
    "obj-ctrl-filton", "obj-ctrl-filttype",
    "obj-lbl-filtfreq", "obj-ctrl-filtfreq",
    "obj-lbl-filtgain", "obj-ctrl-filtgain",
    "obj-lbl-filtq", "obj-ctrl-filtq"
];
var CP_PANELS = [
    ["obj-panel-body", "live_surface_bg"],
    ["obj-panel-filt", "live_desktop"],
    ["obj-panel-clip", "live_desktop"],
    ["obj-panel-opts", "live_desktop"],
    ["obj-panel-meters", "live_desktop"]
];

// Compute the 5 compact Better-Sampler-style inline horizontal value bars across `csMidW`
function csBars() {
    var w = csMidW;
    var gap = 4;
    var w3 = Math.floor((w - gap * 2) / 3);
    var w3Last = w - (w3 + gap) * 2;
    var w2 = Math.floor((w - gap) * 0.42);
    var x20 = Math.round((w - (w2 * 2 + gap)) * 0.5);
    return [
        { key: "drive", ctrl: "Drive", label: "Drive", x: 0, y: 0, w: w3, h: 15, lo: 0, hi: 24, init: 0, bip: false },
        { key: "detail", ctrl: "Detail", label: "Detail", x: w3 + gap, y: 0, w: w3, h: 15, lo: 0, hi: 100, init: 100, bip: false },
        { key: "ceiling", ctrl: "Ceiling", label: "Ceil", x: (w3 + gap) * 2, y: 0, w: w3Last, h: 15, lo: -12, hi: 0, init: 0, bip: false },
        { key: "shape", ctrl: "Shape", label: "Shape", x: x20, y: 18, w: w2, h: 15, lo: 0, hi: 100, init: 0, bip: false },
        { key: "sym", ctrl: "Symmetry", label: "Sym", x: x20 + w2 + gap, y: 18, w: w2, h: 15, lo: -100, hi: 100, init: 0, bip: true }
    ];
}

function csLcdRect() {
    return { x: 0, y: 36, w: csMidW, h: 121 };
}

function csPlotRect() {
    return { x: 2, y: 38, w: csMidW - 4, h: 117 };
}

function csDeviceWidth() {
    var closed = CS_TAB_W + csMidW + 206 + (cpShowFilt ? CS_FILT_W : 0);
    return cpMeters ? (closed + 140) : closed;
}

function csMoveBox(id, x, y, w, h) {
    if (!cpHost || !cpHost.getnamed) return;
    try {
        var o = cpHost.getnamed(id);
        if (o && o.setattr) o.setattr("presentation_rect", x, y, w, h);
    } catch (_) {}
}

// Dynamically repositions the left Filter fold/drawer, middle section, right OUTPUT column, Options panel, and Meters panel
function csApplyLayout() {
    if (CS_ROLE !== "viz") return;
    outlet(0, csDeviceWidth());
    if (!cpHost || !cpHost.getnamed) return;
    var i, o;
    for (i = 0; i < CP_FILT_BOXES.length; i++) {
        o = cpHost.getnamed(CP_FILT_BOXES[i]);
        if (o) o.setattr("hidden", cpShowFilt ? 0 : 1);
    }
    for (i = 0; i < CP_METER_BOXES.length; i++) {
        o = cpHost.getnamed(CP_METER_BOXES[i]);
        if (o) o.setattr("hidden", cpMeters ? 0 : 1);
    }
    var filtPanW = cpShowFilt ? (CS_TAB_W + CS_FILT_W - 4) : (CS_TAB_W - 2);
    csMoveBox("obj-panel-filt", 4, 4, filtPanW, 161);

    var dx = CS_TAB_W + (cpShowFilt ? CS_FILT_W : 0);
    var w = csMidW;
    var inX = 6 + dx;
    var vizX = 56 + dx;
    var outX = 58 + dx + w;
    var outW = 82;
    var clipPanelW = 54 + w + outW;
    var optsX = 4 + dx + clipPanelW + 6;
    var metX = optsX + 60;
    var openW = metX + 140;

    csMoveBox("Input", inX, 6, 46, 15);
    csMoveBox("cp_in_meter", inX, 24, 46, 139);

    csMoveBox("cp_face", vizX, 6, w, CS_H);

    csMoveBox("Output", outX, 6, 42, 15);
    csMoveBox("Auto", outX + 44, 6, 38, 15);
    csMoveBox("cp_out_meter", outX, 24, outW, 139);
    csMoveBox("obj-panel-clip", 4 + dx, 4, clipPanelW, 161);

    var optX = optsX + 4;
    csMoveBox("obj-title-opts", optX, 4, 44, 12);
    csMoveBox("obj-rule-opts", optX + 44, 9, 4, 2);
    csMoveBox("View", optX, 18, 48, 15);
    csMoveBox("Stereo Mode", optX, 36, 48, 15);
    csMoveBox("Channel Mode", optX, 54, 48, 15);
    csMoveBox("Delta", optX, 74, 48, 15);
    csMoveBox("DC", optX, 91, 48, 15);
    csMoveBox("Oversample", optX, 108, 48, 15);
    csMoveBox("Hard Limit", optX, 125, 48, 15);
    csMoveBox("Show Meters", optX, 145, 48, 15);
    csMoveBox("obj-panel-opts", optsX, 4, 56, 161);

    csMoveBox("obj-title-meters", metX + 4, 4, 42, 12);
    csMoveBox("obj-rule-meters", metX + 49, 9, 80, 2);
    csMoveBox("obj-meters", metX + 4, 20, 128, 122);
    csMoveBox("obj-reset", metX + 4, 146, 56, 15);
    csMoveBox("obj-panel-meters", metX, 4, 136, 161);
    csMoveBox("obj-panel-body", 0, 0, openW, 169);
}

function setbuffer(name) {
    if (name) cpBufName = String(name);
}

function set_ingain(v) { cpIn = Number(v) || 0; mgraphics.redraw(); }
function set_drive(v) { cpDrive = Number(v) || 0; mgraphics.redraw(); }
function set_detail(v) { cpDetail = Number(v) || 0; mgraphics.redraw(); }
function set_shape(v) { cpShape = Number(v) || 0; mgraphics.redraw(); }
function set_sym(v) { cpSym = Number(v) || 0; mgraphics.redraw(); }
function set_ceiling(v) { cpCeil = Number(v) || 0; mgraphics.redraw(); }
function set_outgain(v) { cpOut = Number(v) || 0; mgraphics.redraw(); }
function set_on(v) { cpOn = Number(v) ? 1 : 0; mgraphics.redraw(); }
function set_dlt(v) { cpDlt = Number(v) ? 1 : 0; mgraphics.redraw(); }
function set_dcon(v) { cpDc = Number(v) ? 1 : 0; mgraphics.redraw(); }
function set_oson(v) { cpOs = Number(v) ? 1 : 0; mgraphics.redraw(); }
function set_hlim(v) { cpHlim = Number(v) ? 1 : 0; mgraphics.redraw(); }
function set_tpeak(v) { cpTp = Number(v) ? 1 : 0; mgraphics.redraw(); }
function set_view(v) { cpView = Number(v) ? 1 : 0; mgraphics.redraw(); }
function cpUpdateChannelEnum() {
    if (CS_ROLE !== "viz" || !cpHost || !cpHost.getnamed) return;
    try {
        var chMenu = cpHost.getnamed("Channel Mode");
        if (chMenu && chMenu.setattr) {
            if (cpMsMode) {
                chMenu.setattr("_parameter_range", "Both", "M", "S");
            } else {
                chMenu.setattr("_parameter_range", "Both", "L", "R");
            }
        }
    } catch (_) {}
}

function set_msmode(v) {
    cpMsMode = Number(v) ? 1 : 0;
    cpUpdateChannelEnum();
    mgraphics.redraw();
}
function set_chmode(v) { cpChMode = Math.round(sptClamp(Number(v) || 0, 0, 2)); mgraphics.redraw(); }
function set_filton(v) { cpFiltOn = Number(v) ? 1 : 0; mgraphics.redraw(); }
function set_filttype(v) { cpFiltType = Number(v) ? 1 : 0; mgraphics.redraw(); }
function set_filtfreq(v) { cpFiltFreq = sptClamp(Number(v) || 250, 20, 12000); mgraphics.redraw(); }
function set_filtgain(v) { cpFiltGain = sptClamp(Number(v) || 0, 0, 24); mgraphics.redraw(); }
function set_filtq(v) { cpFiltQ = sptClamp(Number(v) || 0.707, 0.1, 10.0); mgraphics.redraw(); }

function set_showfilt(v) {
    cpShowFilt = Number(v) ? 1 : 0;
    csApplyLayout();
    mgraphics.redraw();
}

function cpApplyAutoUi() {
    if (CS_ROLE !== "viz" || !cpHost || !cpHost.getnamed) return;
    try {
        var outBox = cpHost.getnamed("Output");
        if (outBox) outBox.setattr("hidden", cpAuto ? 1 : 0);
    } catch (_) {}
}

function set_autog(v) {
    cpAuto = Number(v) ? 1 : 0;
    cpApplyAutoUi();
    mgraphics.redraw();
}

function clear_gr() {
    cpMaxGr = 0;
    mgraphics.redraw();
}

function set_meters(v) {
    cpMeters = Number(v) ? 1 : 0;
    csApplyLayout();
    mgraphics.redraw();
}

function cpResend() {
    if (CS_ROLE !== "viz") return;
    try {
        if (cpHost) {
            var bind = cpHost.getnamed("cp_bind");
            var setb = cpHost.getnamed("cp_setbuf");
            if (setb) setb.message("bang");
            if (bind) bind.message("bang");
        }
    } catch (_) {}
    cpApplyAutoUi();
    cpUpdateChannelEnum();
    csApplyLayout();
    outlet(1, "ingain", cpIn);
    outlet(1, "drive", cpDrive);
    outlet(1, "detail", cpDetail);
    outlet(1, "shape", cpShape);
    outlet(1, "sym", cpSym);
    outlet(1, "ceiling", cpCeil);
    outlet(1, "outgain", cpOut);
    outlet(1, "on", cpOn);
    outlet(1, "dlt", cpDlt);
    outlet(1, "dcon", cpDc);
    outlet(1, "oson", cpOs);
    outlet(1, "hlim", cpHlim);
    outlet(1, "tpeak", cpTp);
    outlet(1, "autog", cpAuto);
    outlet(1, "msmode", cpMsMode);
    outlet(1, "chmode", cpChMode);
    outlet(1, "filton", cpFiltOn);
    outlet(1, "filttype", cpFiltType);
    outlet(1, "filtfreq", cpFiltFreq);
    outlet(1, "filtgain", cpFiltGain);
    outlet(1, "filtq", cpFiltQ);
}

function cpNum(v) {
    var n = Number(v);
    return n === n ? n : 0;
}

function cpReadScope() {
    if (typeof Buffer !== "function") return;
    try {
        var b = new Buffer(cpBufName || "#0-clipscope");
        var head = b.peek(1, 0, 21);
        if (!head || head.length < 13) return;
        cpScope.inPk = cpNum(head[0]);
        cpScope.outPk = cpNum(head[1]);
        cpScope.inMs = cpNum(head[2]);
        cpScope.outMs = cpNum(head[3]);
        cpScope.clip = cpNum(head[4]);
        cpScope.gr = cpNum(head[5]);
        if (cpScope.gr > 60 || !(cpScope.gr > 0)) cpScope.gr = 0;
        if (cpScope.gr > cpMaxGr) cpMaxGr = cpScope.gr;
        cpScope.drvPk = cpNum(head[11]);
        cpScope.wetPk = cpNum(head[12]);
        cpScope.inPkL = head.length > 13 ? cpNum(head[13]) : cpScope.inPk;
        cpScope.inPkR = head.length > 14 ? cpNum(head[14]) : cpScope.inPk;
        cpScope.outPkL = head.length > 15 ? cpNum(head[15]) : cpScope.outPk;
        cpScope.outPkR = head.length > 16 ? cpNum(head[16]) : cpScope.outPk;
        cpScope.drvPkL = head.length > 17 ? cpNum(head[17]) : cpScope.drvPk;
        cpScope.drvPkR = head.length > 18 ? cpNum(head[18]) : cpScope.drvPk;
        cpScope.wetPkL = head.length > 19 ? cpNum(head[19]) : cpScope.wetPk;
        cpScope.wetPkR = head.length > 20 ? cpNum(head[20]) : cpScope.wetPk;
        var frame = cpNum(head[8]);
        if (frame === cpScope.frame) return;
        cpScope.frame = frame;
        var slot = frame - 1;
        if (slot < 0) slot = 0;
        var wave = b.peek(1, CLIP_WAVE_BASE + (slot % CLIP_WAVE_FRAMES) * 4, 4);
        if (wave && wave.length >= 4) {
            cpWave.push([cpNum(wave[0]), cpNum(wave[1]), cpNum(wave[2]), cpNum(wave[3])]);
            if (cpWave.length > CLIP_WAVE_FRAMES) cpWave.splice(0, cpWave.length - CLIP_WAVE_FRAMES);
        }
        var dots = b.peek(1, CLIP_SCATTER, 32);
        cpDots = [];
        if (dots && dots.length >= 2) {
            var i;
            for (i = 0; i + 1 < dots.length; i += 2) cpDots.push([cpNum(dots[i]), cpNum(dots[i + 1])]);
        }
        var sp = b.peek(1, 320, 64);
        if (sp && sp.length >= 64) {
            cpSpec = [];
            for (var sb = 0; sb < 64; sb++) cpSpec.push(cpNum(sp[sb]));
        }
    } catch (_) {}
}

function cpPollTick() {
    var prev = cpScope.frame;
    cpReadScope();
    if (cpScope.frame !== prev) mgraphics.redraw();
}

function cpMakeup() {
    var inLin = cpDbToLin(cpIn);
    if (cpAuto) {
        return 1 / (inLin > 1e-6 ? inLin : 1e-6);
    }
    return cpDbToLin(cpOut);
}

function cpDbUnit(db) {
    var t = (db - CP_DB_LO) / (CP_DB_HI - CP_DB_LO);
    if (!(t > 0)) t = 0;
    if (t > 1) t = 1;
    return t;
}

function cpFillIn(x, y, w, h, col, a, rect) {
    var x0 = x < rect.x ? rect.x : x;
    var y0 = y < rect.y ? rect.y : y;
    var x1 = x + w;
    var y1 = y + h;
    var xr = rect.x + rect.w;
    var yb = rect.y + rect.h;
    if (x1 > xr) x1 = xr;
    if (y1 > yb) y1 = yb;
    if (!(x1 > x0 + 0.4) || !(y1 > y0 + 0.4)) return;
    sptRgba(col, a);
    mgraphics.rectangle(x0, y0, x1 - x0, y1 - y0);
    mgraphics.fill();
}

function cpProximity() {
    var lin = cpScope.drvPk > 1e-8 ? cpScope.drvPk : 0;
    var drvDb = cpLinToDb(lin);
    var head = cpCeil - drvDb;
    var gr = cpScope.gr > 0 ? cpScope.gr : 0;
    var mode = "safe";
    if (cpScope.clip > 0.01 || head < 0.25 || gr > 0.5) mode = "clip";
    else if (head < 6) mode = "knee";
    return { mode: mode, head: head, gr: gr };
}

function csBipolarCurve(x, driveDb, shapePct, symPct, ceilLin) {
    var drv = sptClamp(driveDb, 0, 24);
    var curveDb = drv < 12 ? drv : 12;
    var overDb = drv > 12 ? drv - 12 : 0;
    var uGain = Math.pow(10, (curveDb + overDb) / 20);
    var c = ceilLin > 1e-6 ? ceilLin : 1e-6;
    var shp = sptClamp(shapePct / 100, 0, 1);
    var sy = sptClamp(symPct / 100, -1, 1);
    var sp = sptClamp(shp + 0.65 * sy, 0, 1);
    var sn = sptClamp(shp - 0.65 * sy, 0, 1);
    var u = uGain * x / c;
    var au = Math.abs(u);
    var sgn = u >= 0 ? 1 : -1;
    var sUse = u >= 0 ? sp : sn;
    var hardMag = Math.min(c, c * au);
    if (sUse >= 0.999) {
        return sgn * hardMag;
    }
    var lnA0 = Math.log(1.2);
    var lnA1 = Math.log(32);
    var aUse = Math.exp(lnA0 + sUse * (lnA1 - lnA0));
    var pw = au > 1e-20 ? Math.exp(aUse * Math.log(au)) : 0;
    var den = Math.exp(Math.log(1 + pw) / aUse);
    var softMag = Math.min(c, c * (au / den));
    var hardBlend = sptClamp((sUse - 0.85) / 0.15, 0, 1);
    return sgn * (softMag + hardBlend * (hardMag - softMag));
}

function cpVMeter(x, y, w, h, t, col, topDown) {
    var bh, fy;
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.rectangle(x, y, w, h);
    mgraphics.fill();
    if (!(t > 0)) return;
    if (t > 1) t = 1;
    bh = (h - 2) * t;
    if (bh < 0.4) return;
    fy = topDown ? (y + 1) : (y + h - 1 - bh);
    sptRgba(col);
    mgraphics.rectangle(x + 1, fy, w - 2, bh);
    mgraphics.fill();
}

function cpFmtDbShort(lin) {
    var db = cpLinToDb(lin);
    if (!(db > -90)) return "-inf";
    return db.toFixed(1);
}

// Left tall INPUT VU column (46 x 139) with independent L and R (or M and S) VU bars
function paintInMeter() {
    var W = 46;
    var H = 139;
    var rect = { x: 0, y: 0, w: W, h: H };
    sptLcd(0, 0, W, H);
    // Show driven input peak & RMS (inPk * driveGain) so the Input meter directly reflects how close the signal is to the Ceiling!
    var g = cpDriveGain(cpDrive);
    var drvPkShow = cpScope.drvPk > 0 ? cpScope.drvPk : (cpScope.inPk * g);
    var pkTxt = cpFmtDbShort(drvPkShow);
    var rmsLin = (cpScope.inMs > 0 ? Math.sqrt(cpScope.inMs * 0.5) : 0) * g;
    var rmsTxt = cpFmtDbShort(rmsLin);
    sptTextIn("Pk " + pkTxt, 3, 9, sptColor("live_lcd_title"), 6.5, 0, rect);
    sptTextIn("RMS " + rmsTxt, 3, 18, sptColor("live_display_scale_text"), 6.0, 0, rect);

    var barX = 24;
    var barY = 22;
    var barH = 107;
    var inTL = cpDbUnit(cpLinToDb(cpScope.drvPkL > 0 ? cpScope.drvPkL : cpScope.inPkL));
    var inTR = cpDbUnit(cpLinToDb(cpScope.drvPkR > 0 ? cpScope.drvPkR : cpScope.inPkR));
    var hot = cpScope.clip > 0.01;
    var inCol = sptMuted(sptColor(hot ? "live_alert" : "live_display_line_one"), 0.85);
    cpVMeter(barX, barY, 8, barH, inTL, inCol, false);
    cpVMeter(barX + 9, barY, 8, barH, inTR, inCol, false);
    sptTextIn(cpMsMode ? "M   S" : "L   R", barX + 8.5, H - 1.5, sptColor("live_lcd_title"), 6.0, 1, rect);

    var marks = [0, -6, -12, -24, -36];
    for (var i = 0; i < marks.length; i++) {
        var db = marks[i];
        var y = Math.round(barY + barH * (1 - cpDbUnit(db)));
        y = sptClamp(y, barY, barY + barH - 1);
        sptRgba(sptColor("live_lcd_frame"));
        mgraphics.rectangle(barX - 2, y, 2, 1);
        mgraphics.fill();
        sptTextIn(String(db), barX - 3, y + 2.2, sptColor("live_display_scale_text"), 6.5, 2, rect);
    }
}

// Right tall OUTPUT + GR VU column (82 x 139) with GR bar + independent L and R OUT VU bars
function paintOutMeter() {
    var W = 82;
    var H = 139;
    var rect = { x: 0, y: 0, w: W, h: H };
    sptLcd(0, 0, W, H);
    var holdGr = cpMaxGr > cpScope.gr ? cpMaxGr : cpScope.gr;
    var grTxt = holdGr > 0.05 ? ("-" + (holdGr >= 10 ? holdGr.toFixed(0) : holdGr.toFixed(1))) : "0.0";
    var pkTxt = cpFmtDbShort(cpScope.outPk);
    var grColTxt = holdGr > 0.4 ? sptColor("live_alert") : sptColor("live_lcd_control_fg_alt");
    sptTextIn("GR " + grTxt, 4, 9, grColTxt, 6.5, 0, rect);
    sptTextIn("Pk " + pkTxt, 4, 18, sptColor("live_lcd_title"), 6.0, 0, rect);

    var grX = 8;
    var outX = 24;
    var barY = 22;
    var barH = 107;
    var grT = sptClamp(cpScope.gr / 18, 0, 1);
    var outTL = cpDbUnit(cpLinToDb(cpScope.outPkL > 0 ? cpScope.outPkL : cpScope.wetPkL));
    var outTR = cpDbUnit(cpLinToDb(cpScope.outPkR > 0 ? cpScope.outPkR : cpScope.wetPkR));
    var grCol = sptMuted(sptColor(cpScope.gr > 0.4 ? "live_alert" : "live_display_scale_text"), 0.85);
    var outCol = sptMuted(sptColor("live_lcd_control_fg_alt"), 0.85);
    cpVMeter(grX, barY, 10, barH, grT, grCol, true);
    if (holdGr > 0.05) {
        var holdY = sptClamp(barY + 1 + (barH - 2) * sptClamp(holdGr / 18, 0, 1), barY + 1, barY + barH - 2);
        sptRgba(sptColor("live_alert"));
        mgraphics.rectangle(grX, holdY, 10, 1);
        mgraphics.fill();
    }
    cpVMeter(outX, barY, 10, barH, outTL, outCol, false);
    cpVMeter(outX + 12, barY, 10, barH, outTR, outCol, false);
    sptTextIn("G", grX + 5.0, H - 1.5, sptColor("live_lcd_title"), 6.0, 1, rect);
    sptTextIn(cpMsMode ? "M    S" : "L    R", outX + 11.0, H - 1.5, sptColor("live_lcd_title"), 6.0, 1, rect);

    var marks = [0, -6, -12, -24, -36];
    for (var i = 0; i < marks.length; i++) {
        var db = marks[i];
        var y = Math.round(barY + barH * (1 - cpDbUnit(db)));
        y = sptClamp(y, barY, barY + barH - 1);
        sptRgba(sptColor("live_lcd_frame"));
        mgraphics.rectangle(outX + 24, y, 2, 1);
        mgraphics.fill();
        sptTextIn(String(db), W - 4, y + 2.2, sptColor("live_display_scale_text"), 6.5, 2, rect);
    }
}

// Left-hand vertical Bass Filter fold tab (18 x 161 px, EQ+ Sidechain-tab style)
function paintFiltTab() {
    var W = 18;
    var H = 161;
    var open = cpShowFilt === 1;
    var on = cpFiltOn === 1;
    sptRgba(sptColor("live_desktop"));
    mgraphics.rectangle(0, 0, W, H);
    mgraphics.fill();

    // Right separator hairline
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.rectangle(W - 1, 0, 1, H);
    mgraphics.fill();

    // Top square arrow toggle button (2, 4, 14, 14)
    sptRgba(sptColor("live_control_bg"));
    mgraphics.rectangle_rounded(2, 4, 14, 14, 2, 2);
    mgraphics.fill();

    var acx = 9.0;
    var acy = 11.0;
    sptRgba(sptColor("live_control_fg"));
    if (open) {
        mgraphics.move_to(acx - 3.4, acy + 1.4);
        mgraphics.line_to(acx + 3.4, acy + 1.4);
        mgraphics.line_to(acx, acy - 2.2);
    } else {
        mgraphics.move_to(acx - 3.4, acy - 1.4);
        mgraphics.line_to(acx + 3.4, acy - 1.4);
        mgraphics.line_to(acx, acy + 2.2);
    }
    mgraphics.close_path();
    mgraphics.fill();

    // Vertical rotated "Bass Filter" label
    if (typeof mgraphics.save === "function" && typeof mgraphics.rotate === "function") {
        mgraphics.save();
        mgraphics.translate(9.5, 86);
        mgraphics.rotate(-Math.PI / 2);
        mgraphics.select_font_face(SPT_FONT, "normal", "normal");
        mgraphics.set_font_size(8.5);
        sptRgba(sptColor("live_lcd_title"));
        var m = mgraphics.text_measure("Bass Filter");
        var tw = (m && m.length) ? m[0] : 44;
        mgraphics.move_to(-tw * 0.5, 3.0);
        mgraphics.show_text("Bass Filter");
        mgraphics.restore();
    } else {
        var chars = ["B", "a", "s", "s", " ", "F", "i", "l", "t"];
        for (var ci = 0; ci < chars.length; ci++) {
            if (chars[ci] !== " ") {
                sptTextIn(chars[ci], 9, 44 + ci * 9.5, sptColor("live_lcd_title"), 7.0, 1, { x: 0, y: 0, w: W, h: H });
            }
        }
    }

    // Bottom status LED dot (click to toggle Filter On/Off, or glows orange when active)
    mgraphics.arc(9.0, H - 11, 2.2, 0, Math.PI * 2);
    sptRgba(on ? sptColor("live_control_selection") : sptColor("live_control_zombie"));
    mgraphics.fill();
}

// Pre-emphasis filter response curve in the left Filter popout canvas (112 x 66)
function csFiltFreqToX(f) {
    var t = Math.log(sptClamp(f, 20, 12000) / 20) / Math.log(12000 / 20);
    return CS_FPLOT.x + t * CS_FPLOT.w;
}

function csFiltXToFreq(x) {
    var t = sptClamp((x - CS_FPLOT.x) / CS_FPLOT.w, 0, 1);
    return 20 * Math.pow(12000 / 20, t);
}

function csFiltGainAt(f) {
    if (!cpFiltOn) return 0;
    var fc = sptClamp(cpFiltFreq, 20, 12000);
    var q = sptClamp(cpFiltQ, 0.1, 10.0);
    var kDamp = 1 / q;
    var gAmt = sptClamp(cpFiltGain, 0, 24);
    var aLo = cpFiltType > 0.5 ? 1.0 : Math.pow(10, -gAmt / 40);
    var aHi = cpFiltType > 0.5 ? 1.0 : Math.pow(10, gAmt / 80);
    var w = (f / fc) / Math.sqrt(Math.max(aLo, 1e-4));
    var w2 = w * w;
    var denRe = 1 - w2;
    var denIm = kDamp * w;
    var den2 = denRe * denRe + denIm * denIm;
    if (cpFiltType > 0.5) {
        var hpMag = (w2 * w2) / Math.max(den2, 1e-12);
        return 10 * Math.log10(Math.max(hpMag, 1e-6));
    }
    var numRe = (aLo * aLo) - (aHi * aHi) * w2;
    var numIm = kDamp * aLo * aHi * w;
    var num2 = numRe * numRe + numIm * numIm;
    return 10 * Math.log10(Math.max(num2 / Math.max(den2, 1e-12), 1e-6));
}

function csFiltDbToY(db) {
    var t = sptClamp((db + 24) / 36, 0, 1);
    return CS_FPLOT.y + (1 - t) * CS_FPLOT.h;
}

function csFiltQToY(q) {
    var t = Math.log(sptClamp(q, 0.1, 10.0) / 0.1) / Math.log(100);
    return CS_FPLOT.y + (1 - t) * CS_FPLOT.h;
}

function csFiltYToQ(y) {
    var t = sptClamp(1 - (y - CS_FPLOT.y) / CS_FPLOT.h, 0, 1);
    return 0.1 * Math.pow(100, t);
}

function paintFiltViz() {
    var rect = { x: 0, y: 0, w: CS_FW, h: CS_FH };
    sptLcd(0, 0, CS_FW, CS_FH);

    // Draw 64-bin live spectrogram (bars + crest outline) inside the XY filter panel
    var nSpec = cpSpec.length;
    var specCol = sptColor("live_display_line_two");
    var i, f, x, dbPre;
    if (nSpec >= 8) {
        var sPts = [];
        var sPoly = [[CS_FPLOT.x, CS_FPLOT.y + CS_FPLOT.h]];
        var colW = CS_FPLOT.w / nSpec;
        for (i = 0; i < nSpec; i++) {
            var u = sptClamp(cpSpec[i], 0, 1);
            var sx = CS_FPLOT.x + (i + 0.5) * colW;
            var sy = CS_FPLOT.y + (1 - u * 0.88) * CS_FPLOT.h;
            var bh = CS_FPLOT.y + CS_FPLOT.h - sy;
            if (bh > 0.5) {
                cpFillIn(CS_FPLOT.x + i * colW, sy, Math.max(0.8, colW - 0.4), bh, sptMuted(specCol, 0.72), 0.38, CS_FPLOT);
            }
            sPts.push([sx, sy]);
            sPoly.push([sx, sy]);
        }
        sPoly.push([CS_FPLOT.x + CS_FPLOT.w, CS_FPLOT.y + CS_FPLOT.h]);
        sptFillPolyIn(sPoly, sptMuted(specCol, 0.75), 0.18, CS_FPLOT);
        sptCurveIn(sPts, specCol, 0.9, CS_FPLOT);
    }

    var zeroY = Math.round(csFiltDbToY(0));
    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.rectangle(CS_FPLOT.x, zeroY, CS_FPLOT.w, 1);
    mgraphics.fill();

    var prePts = [];
    var invPts = [];
    for (i = 0; i <= 48; i++) {
        x = CS_FPLOT.x + (CS_FPLOT.w * i) / 48;
        f = csFiltXToFreq(x);
        dbPre = csFiltGainAt(f);
        prePts.push([x, csFiltDbToY(dbPre)]);
        invPts.push([x, csFiltDbToY(-dbPre)]);
    }
    var preCol = cpFiltOn ? sptColor("live_display_line_one") : sptColor("live_display_scale_text");
    var invCol = cpFiltOn ? sptColor("live_lcd_control_fg_alt") : sptColor("live_lcd_frame");
    sptCurveIn(invPts, sptMuted(invCol, 0.75), 0.85, CS_FPLOT);
    sptCurveIn(prePts, preCol, 1, CS_FPLOT);

    var hx = sptClamp(csFiltFreqToX(cpFiltFreq), CS_FPLOT.x + 5, CS_FPLOT.x + CS_FPLOT.w - 5);
    var hy = cpFiltType > 0.5
        ? sptClamp(csFiltQToY(cpFiltQ), CS_FPLOT.y + 5, CS_FPLOT.y + CS_FPLOT.h - 5)
        : sptClamp(csFiltDbToY(csFiltGainAt(cpFiltFreq)), CS_FPLOT.y + 5, CS_FPLOT.y + CS_FPLOT.h - 5);
    sptHandle(hx, hy, cpFiltOn ? sptColor("live_display_handle_one") : sptColor("live_display_scale_text"), "", 3.5);
    sptTextIn("Pre", CS_FPLOT.x + 3, CS_FPLOT.y + 9, preCol, 6.5, 0, rect);
    sptTextIn("Inv", CS_FPLOT.x + 22, CS_FPLOT.y + 9, invCol, 6.5, 0, rect);
}

function csGetVal(key) {
    if (key === "drive") return cpDrive;
    if (key === "detail") return cpDetail;
    if (key === "ceiling") return cpCeil;
    if (key === "shape") return cpShape;
    if (key === "sym") return cpSym;
    return 0;
}

function csFmtVal(key, v) {
    if (key === "drive" || key === "ceiling") return v.toFixed(1) + " dB";
    return Math.round(v) + " %";
}

function csDrawValueBar(b) {
    var v = csGetVal(b.key);
    var n = sptClamp((v - b.lo) / Math.max(1e-6, b.hi - b.lo), 0, 1);
    var bg = sptColor("live_lcd_bg");
    var frame = sptColor("live_lcd_frame");
    var acc = sptColor("live_lcd_control_fg_alt");
    var lblCol = sptColor("live_control_fg");

    sptRgba(bg);
    mgraphics.rectangle(b.x, b.y, b.w, b.h);
    mgraphics.fill();

    var bx0 = b.bip ? (b.x + b.w * 0.5 + Math.min(0, n - 0.5) * (b.w - 2)) : (b.x + 1);
    var bw0 = b.bip ? (Math.abs(n - 0.5) * (b.w - 2)) : (n * (b.w - 2));
    if (bw0 > 0.5) {
        sptRgba(sptMix(bg, acc, 0.38));
        mgraphics.rectangle(bx0, b.y + 1, bw0, b.h - 2);
        mgraphics.fill();
    }

    sptRgba(frame);
    mgraphics.set_line_width(1);
    mgraphics.rectangle(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    mgraphics.stroke();

    var rect = { x: b.x, y: b.y, w: b.w, h: b.h };
    var fs = b.w < 68 ? 6.5 : 7.5;
    sptTextIn(b.label, b.x + 3.0, b.y + b.h - 3.5, lblCol, fs, 0, rect);
    sptTextIn(csFmtVal(b.key, v), b.x + b.w - 3.0, b.y + b.h - 3.5, acc, fs, 2, rect);
}

function csXPix(v, plot) {
    return plot.x + (v + CS_SPAN) / (2 * CS_SPAN) * plot.w;
}

function csYPix(v, plot) {
    return plot.y + (1 - (v + CS_SPAN) / (2 * CS_SPAN)) * plot.h;
}

function paintViz() {
    var i;
    var bars = csBars();
    for (i = 0; i < bars.length; i++) {
        csDrawValueBar(bars[i]);
    }

    var lcd = csLcdRect();
    var plot = csPlotRect();
    var z = cpProximity();
    var hot = z.mode === "clip";
    var ceilLin = cpDbToLin(cpCeil);
    var lineCol = sptColor("live_display_line_one");
    var hitCol = sptColor("live_lcd_control_fg_alt");
    var alertCol = sptColor("live_alert");
    sptLcd(lcd.x, lcd.y, lcd.w, lcd.h);

    var midX = Math.round(csXPix(0, plot));
    var midY = Math.round(csYPix(0, plot));

    // Bipolar ceiling lines (+ceilLin and -ceilLin)
    var cyPos = sptClamp(Math.round(csYPix(ceilLin, plot)), plot.y, plot.y + plot.h - 1);
    var cyNeg = sptClamp(Math.round(csYPix(-ceilLin, plot)), plot.y, plot.y + plot.h - 1);
    sptRgba(hot ? alertCol : sptMuted(sptColor("live_control_selection"), 0.65), 0.75);
    mgraphics.rectangle(plot.x, cyPos, plot.w, 1);
    mgraphics.fill();
    mgraphics.rectangle(plot.x, cyNeg, plot.w, 1);
    mgraphics.fill();

    // Center tick-marked crosshair axes
    sptRgba(sptColor("live_lcd_frame"));
    var tx, ty;
    for (tx = plot.x + 8; tx < plot.x + plot.w - 4; tx += 14) {
        mgraphics.rectangle(tx, midY - 1, 1, 3);
        mgraphics.fill();
    }
    for (ty = plot.y + 4; ty < plot.y + plot.h - 2; ty += 10) {
        mgraphics.rectangle(midX - 1, ty, 3, 1);
        mgraphics.fill();
    }

    if (cpView) {
        var n = cpWave.length;
        if (n >= 2) {
            var dHi = [], dLo = [], wHi = [], wLo = [];
            var dw = plot.w / n;
            for (i = 0; i < n; i++) {
                var col = cpWave[i];
                var xx = plot.x + (i + 0.5) * dw;
                dLo.push([xx, sptClamp(csYPix(col[0], plot), plot.y, plot.y + plot.h)]);
                dHi.push([xx, sptClamp(csYPix(col[1], plot), plot.y, plot.y + plot.h)]);
                wLo.push([xx, sptClamp(csYPix(col[2], plot), plot.y, plot.y + plot.h)]);
                wHi.push([xx, sptClamp(csYPix(col[3], plot), plot.y, plot.y + plot.h)]);
                if (col[1] > ceilLin) {
                    var sy0 = csYPix(col[1], plot);
                    cpFillIn(plot.x + i * dw, Math.min(sy0, cyPos), Math.max(1, dw), Math.abs(cyPos - sy0), alertCol, 0.55, plot);
                }
                if (col[0] < -ceilLin) {
                    var sy1 = csYPix(col[0], plot);
                    cpFillIn(plot.x + i * dw, Math.min(sy1, cyNeg), Math.max(1, dw), Math.abs(sy1 - cyNeg), alertCol, 0.55, plot);
                }
            }
            sptCurveIn(dHi, sptMuted(lineCol, 0.75), 0.85, plot);
            sptCurveIn(dLo, sptMuted(lineCol, 0.75), 0.85, plot);
            sptCurveIn(wHi, hitCol, 1, plot);
            sptCurveIn(wLo, hitCol, 1, plot);
        }
    } else {
        var basePts = [];
        var g = cpDriveGain(cpDrive);
        var k, u, yVal;
        for (k = 0; k <= 96; k++) {
            u = -CS_SPAN + (2 * CS_SPAN) * k / 96;
            yVal = csBipolarCurve(u / (g > 1e-8 ? g : 1), cpDrive, cpShape, cpSym, ceilLin);
            basePts.push([csXPix(u, plot), csYPix(yVal, plot)]);
        }
        sptCurveIn(basePts, sptMuted(sptColor("live_control_fg"), 0.65), 0.9, plot);

        // Highlight the active region where the DRIVEN signal (xs * driveGain) is hitting the gain curve!
        var drvSpan = cpScope.drvPk > 1e-5 ? cpScope.drvPk : (cpScope.inPk * g);
        var negSpan = drvSpan;
        var posSpan = drvSpan;
        if (cpWave.length > 0) {
            var lastW = cpWave[cpWave.length - 1];
            var wNeg = Math.abs(lastW[0]);
            var wPos = Math.abs(lastW[1]);
            if (wNeg > 1e-4 || wPos > 1e-4) {
                negSpan = Math.max(drvSpan * 0.75, wNeg);
                posSpan = Math.max(drvSpan * 0.75, wPos);
            }
        }
        if (drvSpan > 1e-4) {
            var loU = Math.max(-CS_SPAN, -negSpan);
            var hiU = Math.min(CS_SPAN, posSpan);
            var activePts = [];
            var clipPosPts = [];
            var clipNegPts = [];
            var posPoly = [[midX, midY]];
            var negPoly = [[midX, midY]];
            var cThresh = ceilLin * 0.985;
            for (k = 0; k <= 64; k++) {
                u = loU + (hiU - loU) * k / 64;
                // Evaluate the curve at `u / g` because `u` is already in driven units!
                yVal = csBipolarCurve(u / (g > 1e-8 ? g : 1), cpDrive, cpShape, cpSym, ceilLin);
                var pt = [csXPix(u, plot), csYPix(yVal, plot)];
                activePts.push(pt);
                if (u >= 0) posPoly.push(pt);
                if (u <= 0) negPoly.push(pt);
                if (yVal >= cThresh) clipPosPts.push(pt);
                if (yVal <= -cThresh) clipNegPts.push(pt);
            }
            posPoly.push([csXPix(hiU, plot), midY]);
            negPoly.push([csXPix(loU, plot), midY]);
            if (posPoly.length >= 3) sptFillPolyIn(posPoly, hitCol, 0.16, plot);
            if (negPoly.length >= 3) sptFillPolyIn(negPoly, hitCol, 0.16, plot);

            sptCurveIn(activePts, hitCol, 1, plot);
            if (clipPosPts.length > 1) sptCurveIn(clipPosPts, alertCol, 1, plot);
            if (clipNegPts.length > 1) sptCurveIn(clipNegPts, alertCol, 1, plot);

            for (i = 0; i < cpDots.length; i++) {
                var dx = cpDots[i][0] * g;
                var dy = csBipolarCurve(cpDots[i][0], cpDrive, cpShape, cpSym, ceilLin);
                var px = csXPix(dx, plot);
                var py = csYPix(dy, plot);
                if (px < plot.x + 2 || px > plot.x + plot.w - 2) continue;
                if (py < plot.y + 2 || py > plot.y + plot.h - 2) continue;
                var isClipping = Math.abs(dy) >= cThresh;
                sptRgba(isClipping ? alertCol : hitCol);
                mgraphics.rectangle(px - 1.5, py - 1.5, 3, 3);
                mgraphics.fill();
            }

            var pkPosX = sptClamp(csXPix(hiU, plot), plot.x + 5, plot.x + plot.w - 5);
            var pkPosY = sptClamp(csYPix(csBipolarCurve(hiU / (g > 1e-8 ? g : 1), cpDrive, cpShape, cpSym, ceilLin), plot), plot.y + 5, plot.y + plot.h - 5);
            var pkNegX = sptClamp(csXPix(loU, plot), plot.x + 5, plot.x + plot.w - 5);
            var pkNegY = sptClamp(csYPix(csBipolarCurve(loU / (g > 1e-8 ? g : 1), cpDrive, cpShape, cpSym, ceilLin), plot), plot.y + 5, plot.y + plot.h - 5);
            sptHandle(pkNegX, pkNegY, hot ? alertCol : hitCol, "", 3.0);
            sptHandle(pkPosX, pkPosY, hot ? alertCol : sptColor("live_display_handle_one"), "", 3.5);
        }
    }

    if (cpDsp.createdAt && !cpDsp.ready) {
        sptTextIn(cpDsp.error ? "DSP failed" : "DSP loading", plot.x + plot.w - 2, plot.y + plot.h - 4, sptColor(cpDsp.error ? "live_alert" : "live_control_selection"), 8, 2, plot);
    }
}

function paint() {
    if (CS_ROLE === "filt_tab") {
        paintFiltTab();
    } else if (CS_ROLE === "filt_viz") {
        paintFiltViz();
    } else if (CS_ROLE === "in_meter") {
        paintInMeter();
    } else if (CS_ROLE === "out_meter") {
        paintOutMeter();
    } else {
        paintViz();
    }
}

function cpQuant(v, lo, hi, step) {
    var q = Math.round(v / step) * step;
    if (q < lo) q = lo;
    if (q > hi) q = hi;
    return Math.round(q * 1000) / 1000;
}

function cpWriteCtrl(name, value) {
    if (!cpHost || !cpHost.getnamed) return;
    var o = cpHost.getnamed(name);
    if (!o || !o.message) return;
    try { o.message(value); } catch (err) {}
}

function csSetBarVal(b, val) {
    var step = (b.key === "drive" || b.key === "ceiling") ? 0.1 : 1;
    var q = cpQuant(val, b.lo, b.hi, step);
    if (b.key === "drive") cpDrive = q;
    else if (b.key === "detail") cpDetail = q;
    else if (b.key === "ceiling") cpCeil = q;
    else if (b.key === "shape") cpShape = q;
    else if (b.key === "sym") cpSym = q;
    cpWriteCtrl(b.ctrl, q);
    mgraphics.redraw();
}

function csHitBar(x, y) {
    var bars = csBars();
    for (var i = 0; i < bars.length; i++) {
        var b = bars[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
}

function cpApplyDrag(drive, ceil) {
    if (drive === cpDrive && ceil === cpCeil) return;
    cpDrive = drive;
    cpCeil = ceil;
    cpWriteCtrl("Drive", drive);
    cpWriteCtrl("Ceiling", ceil);
    mgraphics.redraw();
}

function onclick(x, y) {
    if (CS_ROLE === "filt_tab") {
        if (y >= 140) {
            var nextOn = cpFiltOn ? 0 : 1;
            cpFiltOn = nextOn;
            cpWriteCtrl("obj-ctrl-filton", nextOn);
        } else {
            var nextShow = cpShowFilt ? 0 : 1;
            cpShowFilt = nextShow;
            cpWriteCtrl("Show Filter", nextShow);
        }
        mgraphics.redraw();
        return;
    }
    if (CS_ROLE === "filt_viz") {
        cpDragOn = 1;
        cpDragX = x;
        cpDragY = y;
        cpDragFreq = cpFiltFreq;
        cpDragGain = cpFiltGain;
        cpDragQ = cpFiltQ;
        return;
    }
    if (CS_ROLE === "out_meter") {
        if (y <= 22) {
            cpMaxGr = 0;
            cpScope.gr = 0;
            mgraphics.redraw();
        }
        return;
    }
    if (CS_ROLE !== "viz") return;
    var b = csHitBar(x, y);
    if (b) {
        cpDragOn = 2;
        cpDragKey = b.key;
        cpDragX = x;
        cpDragV0 = csGetVal(b.key);
        return;
    }
    var lcd = csLcdRect();
    if (y >= lcd.y) {
        cpDragOn = 1;
        cpDragKey = "";
        cpDragX = x;
        cpDragY = y;
        cpDragDrive = cpDrive;
        cpDragCeil = cpCeil;
    } else {
        cpDragOn = 0;
    }
}

function ondrag(x, y, but) {
    if (!cpDragOn || but === 0) {
        if (but === 0) cpDragOn = 0;
        return;
    }
    if (CS_ROLE === "filt_viz") {
        var nextFreq = cpQuant(csFiltXToFreq(csFiltFreqToX(cpDragFreq) + (x - cpDragX)), 20, 12000, 1);
        cpFiltFreq = nextFreq;
        cpWriteCtrl("Filter Freq", nextFreq);
        if (cpFiltType > 0.5) {
            // Low-cut filter: dragging up/down increases/decreases Q
            var nextQ = cpQuant(csFiltYToQ(csFiltQToY(cpDragQ) + (y - cpDragY)), 0.1, 10.0, 0.01);
            cpFiltQ = nextQ;
            cpWriteCtrl("Filter Q", nextQ);
        } else {
            // Low-shelf filter: dragging up/down adjusts shelf Emphasis gain
            var nextGain = cpQuant(cpDragGain + (cpDragY - y) / CS_FPLOT.h * 24, 0, 24, 0.1);
            cpFiltGain = nextGain;
            cpWriteCtrl("Filter Gain", nextGain);
        }
        mgraphics.redraw();
        return;
    }
    if (CS_ROLE !== "viz") return;
    if (cpDragOn === 2) {
        var bars = csBars();
        for (var i = 0; i < bars.length; i++) {
            var b = bars[i];
            if (b.key === cpDragKey) {
                var next = cpDragV0 + (x - cpDragX) / b.w * (b.hi - b.lo);
                csSetBarVal(b, next);
                return;
            }
        }
        return;
    }
    var plot = csPlotRect();
    var drive = cpQuant(cpDragDrive + (x - cpDragX) / plot.w * 24, 0, 24, 0.1);
    var ceil = cpQuant(cpDragCeil + (cpDragY - y) / plot.h * 12, -12, 0, 0.1);
    cpApplyDrag(drive, ceil);
}

function ondblclick(x, y) {
    if (CS_ROLE === "filt_viz") {
        cpFiltFreq = 250;
        cpFiltGain = 6;
        cpFiltQ = 0.707;
        cpWriteCtrl("Filter Freq", 250);
        cpWriteCtrl("Filter Gain", 6);
        cpWriteCtrl("Filter Q", 0.707);
        cpDragOn = 0;
        mgraphics.redraw();
        return;
    }
    if (CS_ROLE === "out_meter") {
        cpMaxGr = 0;
        cpScope.gr = 0;
        mgraphics.redraw();
        return;
    }
    if (CS_ROLE !== "viz") return;
    var b = csHitBar(x, y);
    if (b) {
        csSetBarVal(b, b.init);
        cpDragOn = 0;
        return;
    }
    var lcd = csLcdRect();
    if (y >= lcd.y) {
        cpApplyDrag(0, 0);
        cpDragOn = 0;
    }
}

function preview() {
    var ceilLin = cpDbToLin(-1.8);
    var g, mk, i, phase, env, x, drv, wetP, wetN, wet, drvPk, wetPk, gr;
    cpDrive = 10.0;
    cpShape = 50;
    cpSym = 25;
    cpCeil = -1.8;
    cpIn = 0;
    cpOut = 0;
    cpAuto = 1;
    cpOn = 1;
    cpView = 0;
    cpFiltOn = 1;
    cpFiltFreq = 320;
    cpFiltGain = 9;
    cpFiltQ = 1.4;
    cpSpec = [];
    for (i = 0; i < 64; i++) {
        var fNorm = i / 63;
        var sVal = 0.72 * Math.exp(-fNorm * 1.6) + 0.18 * Math.exp(-Math.pow((fNorm - 0.38) / 0.11, 2));
        cpSpec.push(sptClamp(sVal, 0.04, 0.95));
    }
    g = cpDriveGain(cpDrive);
    mk = cpMakeup();
    ceilLin = cpDbToLin(cpCeil);
    cpWave = [];
    drvPk = 0;
    wetPk = 0;
    for (i = 0; i < 64; i++) {
        phase = i % 16;
        env = 0.055 + 0.36 * Math.exp(-phase / 2.6);
        if (phase > 11) env *= 0.4;
        if (i > 48) env *= 0.72;
        x = env;
        drv = x * g;
        wetP = Math.abs(cpCurve(x, cpDrive, cpShape, cpSym, ceilLin));
        wetN = Math.abs(cpCurve(-x * 0.78, cpDrive, cpShape, cpSym, ceilLin));
        wet = wetP > wetN ? wetP : wetN;
        cpWave.push([-drv * 0.72, drv, -wetN, wetP]);
        if (drv > drvPk) drvPk = drv;
        if (wet > wetPk) wetPk = wet;
    }
    cpDots = [];
    for (i = 0; i < 8; i++) {
        x = -0.38 + i * (0.82 / 7);
        cpDots.push([x, csBipolarCurve(x, cpDrive, cpShape, cpSym, ceilLin) * mk]);
    }
    gr = drvPk > 1e-8 ? 20 * Math.log10(drvPk / (wetPk > 1e-8 ? wetPk : 1e-8)) : 0;
    if (!(gr > 0)) gr = 0;
    cpScope.drvPk = drvPk;
    cpScope.wetPk = wetPk;
    cpScope.inPk = drvPk / (g > 1e-8 ? g : 1);
    cpScope.outPk = wetPk;
    cpScope.inPkL = cpScope.inPk;
    cpScope.inPkR = cpScope.inPk * 0.84;
    cpScope.outPkL = wetPk;
    cpScope.outPkR = wetPk * 0.88;
    cpScope.drvPkL = drvPk;
    cpScope.drvPkR = drvPk * 0.84;
    cpScope.wetPkL = wetPk;
    cpScope.wetPkR = wetPk * 0.88;
    cpScope.inMs = cpScope.inPk * cpScope.inPk * 0.35;
    cpScope.outMs = cpScope.outPk * cpScope.outPk * 0.42;
    cpScope.gr = gr;
    cpMaxGr = gr;
    cpScope.clip = gr > 0.4 ? 0.46 : 0;
    cpScope.frame = 64;
}

if (CS_ROLE === "viz") {
    if (typeof sptThemeWatch === "function") {
        sptThemeWatch(function () {
            if (typeof sptApplyPanelTheme === "function") sptApplyPanelTheme(CP_PANELS, cpHost);
        });
    }
    if (typeof sptApplyPanelTheme === "function") sptApplyPanelTheme(CP_PANELS, cpHost);
}

if (typeof Task === "function") {
    var cpPollTask = new Task(cpPollTick, this);
    cpPollTask.interval = 33;
    cpPollTask.repeat();
}
