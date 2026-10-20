// Delay+ (Start) face: shared state, time computation, telemetry polling and the status header.
// Build order: delayplus_config.js + `var DP_ROLE = "start"` + delayplus_link.js + this file +
// one of src/delayplus_viz_{a,b,c}.js, which defines
//   VIZ_NAME, vizDraw(mg, x, y, w, h, st)   and optionally   vizIdle(st) (true = keep animating).
//
// Outlet 0 -> gen (unused in Live: times go through the gen header). Outlet 1 -> `mirror <key> <v>`
// for Stereo Link (routed to `prepend set` on the other side's control).
// Inputs: set_<param> from the live.* objects, `names` from loadbang, `init_link` from
// live.thisdevice.

inlets = 1;
outlets = 2;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var DP_COL = {
    bg: [0.075, 0.075, 0.075, 1], // the display panel's black (seamless, like Echo's display)
    frame: [0.20, 0.23, 0.28, 1],
    text: [0.80, 0.84, 0.90, 1],
    dim: [0.45, 0.50, 0.58, 1],
    cyan: [0.30, 0.82, 0.95, 1],
    amber: [0.97, 0.68, 0.26, 1],
    coral: [0.98, 0.42, 0.38, 1],
    green: [0.40, 0.88, 0.52, 1],
    violet: [0.66, 0.55, 0.98, 1],
};

// Parameter values arrive as set_<key> (raw parameter units); percent parameters the display uses
// are also kept as 0..1 (fb, wet, width, moddelay).
var st = {
    sync_l: 1, time_l: 375, div_l: DP_DIV_DEFAULT, mode_l: 0, offs_l: 0,
    sync_r: 1, time_r: 375, div_r: DP_DIV_DEFAULT, mode_r: 0, offs_r: 0, link: 1,
    fb: 0.5, wet: 0.5, width: 1, hp: 50, lp: 5000, hpres: 0, lpres: 0, filton: 1, chmode: 0, pp: 0,
    lfosync: 1, lfohz: 0.5, lfodiv: 3, moddelay: 0, freeze: 0, debug: 0, repitch: 0,
    msL: 250, msR: 250, lfoHzOut: 2,
    sr: 44100, TL: 0, TR: 0, tmin: 0, clamped: 0, B: 32, K: 0, L: 0, pingL: -1, paired: 0,
    inPk: 0, tapL: 0, tapR: 0, retL: 0, retR: 0, freezeOn: 0, duckGain: 1, wetPk: 0,
    hist: null, histHead: 0, chainGain: 1, frames: -1, idleFrames: 0, t: 0,
};

var dpScope = null;
var dpScopeName = "";
var dpFrameTask = null;

function dpScopeBind(name) {
    dpScopeName = name;
    dpScope = null;
    if (!dpFrameTask) {
        dpFrameTask = new Task(dpFrame, this);
        dpFrameTask.interval = 33;
        dpFrameTask.repeat();
    }
}

// Delay times (per side) and the LFO rate go straight into the gen header (see dpHdrPoke).
function dpPokeTimes() {
    var bpm = dpLink.bpm;
    st.msL = dpSideMs(st.sync_l > 0.5, st.time_l, st.div_l, st.mode_l, st.offs_l, bpm);
    st.msR = dpSideMs(st.sync_r > 0.5, st.time_r, st.div_r, st.mode_r, st.offs_r, bpm);
    st.lfoHzOut = dpLfoHz(st.lfosync > 0.5, st.lfohz, st.lfodiv, bpm);
    dpHdrPoke(31, st.msL);
    dpHdrPoke(28, st.msR);
    dpHdrPoke(27, st.lfoHzOut);
}

function dpSendTime() {
    dpPokeTimes();
    mgraphics.redraw();
}

dpOnChange = function () {
    dpSendTime();
};

var DP_PCT = { fb: 1, wet: 1, width: 1, moddelay: 1 };
// Stereo Link (Echo): a change of one side's time, Sync or Sync Mode is applied to the other side
// too. The other control is updated with `set` (outlet 1 -> route mirror -> prepend set), which
// does not output, so nothing loops back here.
var DP_LINKED = { sync: 1, time: 1, div: 1, mode: 1 };

function dpSet(key, v) {
    st[key] = DP_PCT[key] ? v / 100 : v;
    if (key === "chmode") st.pp = v === 1 ? 1 : 0;
    var m = key.match(/^(sync|time|div|mode)_(l|r)$/);
    if (m && st.link > 0.5 && DP_LINKED[m[1]]) {
        var other = m[1] + "_" + (m[2] === "l" ? "r" : "l");
        if (st[other] !== v) {
            st[other] = v;
            outlet(1, "mirror", other, v);
        }
    }
    dpSendTime();
}

// set_<key> <value> from the live.* objects (one generic handler for all parameters).
function anything() {
    var name = messagename;
    if (name.indexOf("set_") !== 0) return;
    dpSet(name.substring(4), arguments.length ? Number(arguments[0]) : 0);
}

function dpFrame() {
    st.t += 1;
    if (!dpScope && dpScopeName) {
        try { dpScope = new Buffer(dpScopeName); } catch (e) { dpScope = null; }
    }
    if (!dpScope) return;
    var h = dpScope.peek(1, 0, 32);
    if (!h || h.length < 24) return;
    var S = DP_SCOPE;
    var moving = h[S.FRAMES] !== st.frames;
    st.frames = h[S.FRAMES];
    st.TL = h[S.TL]; st.TR = h[S.TR]; st.clamped = h[S.CLAMPED]; st.tmin = h[S.TMIN];
    st.B = h[S.B]; st.K = h[S.K]; st.L = h[S.L]; st.pingL = h[S.PING_L]; st.paired = h[S.PAIRED];
    st.inPk = h[S.IN_PK]; st.tapL = h[S.TAP_L]; st.tapR = h[S.TAP_R];
    st.retL = h[S.RET_L]; st.retR = h[S.RET_R]; st.sr = h[S.SR] || 44100;
    st.freezeOn = h[S.FREEZE]; st.duckGain = h[S.DUCK]; st.wetPk = h[S.WET_PK];
    st.histHead = h[S.HIST_HEAD];
    // Chain gain estimate: return level over tap level, smoothed, only with signal present.
    var tap = Math.max(st.tapL, st.tapR);
    var ret = Math.max(st.retL, st.retR);
    if (tap > 0.003) st.chainGain += (dpClamp(ret / tap, 0, 4) - st.chainGain) * 0.05;
    var active = (tap + ret + st.inPk) > 0.00002;
    st.hist = dpScope.peek(1, DP_HIST_OFFSET, 3 * DP_HIST_BLOCKS);
    st.idleFrames = active ? 0 : st.idleFrames + 1;
    var keep = typeof vizIdle === "function" && vizIdle(st);
    if (!moving && !keep && st.idleFrames > 30) return;
    mgraphics.redraw();
}

function dpColor(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? c[3] : a);
}

function dpText(str, x, y, size, c, bold) {
    mgraphics.select_font_face(bold ? "Arial Bold" : "Arial");
    mgraphics.set_font_size(size);
    dpColor(c);
    mgraphics.move_to(x, y);
    mgraphics.show_text(String(str));
}

function dpTextW(str, size, bold) {
    mgraphics.select_font_face(bold ? "Arial Bold" : "Arial");
    mgraphics.set_font_size(size);
    return mgraphics.text_measure(String(str))[0];
}

function dpPill(x, y, w, h, fill, alpha) {
    dpColor(fill, alpha);
    mgraphics.rectangle_rounded(x, y, w, h, h, h);
    mgraphics.fill();
}

// Header: link + latency status (left), clamp / ping indicator (right).
function dpDrawHeader(w) {
    var linked = dpLink.paired && st.paired > 0.5;
    var sr = st.sr || 44100;
    var label;
    var col;
    if (!dpLink.paired) {
        label = dpLink.status === "init" ? "LINKING" : (dpLink.status === "no End" ? "NO END — add Delay+ End" : dpLink.status.toUpperCase());
        col = DP_COL.coral;
    } else {
        label = "LINK  L " + Math.round(dpLink.latency) + " smp · " + (dpLink.latency * 1000 / sr).toFixed(1) + " ms";
        col = linked ? DP_COL.cyan : DP_COL.amber;
    }
    dpPill(2, 2, dpTextW(label, 8.5, true) + 12, 13, col, 0.16);
    dpColor(col);
    mgraphics.arc(8, 8.5, 2, 0, Math.PI * 2);
    mgraphics.fill();
    dpText(label, 13, 11.6, 8.5, col, true);

    var rx = w - 2;
    if (st.debug > 0.5) {
        var pl = st.pingL;
        var ok = pl >= 0 && Math.abs(pl - dpLink.latency) <= 1;
        var ptxt = pl < 0 ? "PING …" : "PING " + Math.round(pl) + (ok ? " ✓" : " ≠ LOM");
        var pw = dpTextW(ptxt, 8.5, true) + 10;
        rx -= pw;
        dpPill(rx, 2, pw, 13, ok ? DP_COL.green : DP_COL.coral, 0.18);
        dpText(ptxt, rx + 5, 11.6, 8.5, ok ? DP_COL.green : DP_COL.coral, true);
        rx -= 4;
    }
    if (st.clamped > 0.5) {
        var ctxt = "MIN " + (st.tmin * 1000 / sr).toFixed(1) + " ms";
        var cw = dpTextW(ctxt, 8.5, true) + 10;
        rx -= cw;
        dpPill(rx, 2, cw, 13, DP_COL.amber, 0.2);
        dpText(ctxt, rx + 5, 11.6, 8.5, DP_COL.amber, true);
    }
}

// Effective time of both sides, e.g. "1/8 D | 1/8" or "375 ms | 410 ms".
function dpTimeLabel() {
    return dpSideLabel(st.sync_l > 0.5, st.time_l, st.div_l, st.mode_l) + " | "
        + dpSideLabel(st.sync_r > 0.5, st.time_r, st.div_r, st.mode_r);
}

var dpThemeTask = dpThemeWatch();

// Panels take Live's theme colours from here (max.getcolor), on load and whenever the theme
// changes: setting them through attribute bindings did not repaint them in Live.
var DP_PANEL_THEME = [
    ["obj-panel-body", "live_desktop", [0.165, 0.165, 0.165, 1]],
    ["obj-panel-left", "live_surface_bg", [0.235, 0.24, 0.25, 1]],
    ["obj-panel-right", "live_surface_bg", [0.235, 0.24, 0.25, 1]],
    ["obj-panel-display", "live_lcd_bg", [0.075, 0.075, 0.075, 1]],
    ["obj-panel-divider", "live_control_fg_off", [0.3, 0.3, 0.3, 1]],
    ["obj-panel-mod-sep", "live_lcd_frame", [0.3, 0.3, 0.3, 1]],
    ["obj-panel-char-v", "live_lcd_frame", [0.3, 0.3, 0.3, 1]],
    ["obj-panel-char-h", "live_lcd_frame", [0.3, 0.3, 0.3, 1]],
];
var dpPatcher = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;

function dpApplyPanelTheme() {
    if (!dpPatcher) return;
    var report = {};
    for (var i = 0; i < DP_PANEL_THEME.length; i++) {
        var e = DP_PANEL_THEME[i];
        var c = dpTheme(e[1], e[2]);
        try {
            var o = dpPatcher.getnamed(e[0]);
            if (!o) continue;
            o.setattr("bgfillcolor", c[0], c[1], c[2], c[3]);
            o.setattr("bgcolor", c[0], c[1], c[2], c[3]);
            o.setattr("bordercolor", c[0], c[1], c[2], c[3]);
            report[e[0]] = c.map(function (v) { return Math.round(v * 255); }).join(",");
        } catch (err) {
            report[e[0]] = "err " + err;
        }
    }
    new Global("delayplus_diag").panels = JSON.stringify(report);  // read via the MCP bridge
}
dpOnThemeChange = dpApplyPanelTheme;

function paint() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    DP_COL.bg = dpTheme("live_lcd_bg", [0.075, 0.075, 0.075, 1]);
    DP_COL.cyan = dpTheme("live_display_line_one", [0.30, 0.82, 0.95, 1]);
    DP_COL.amber = dpTheme("live_display_line_two", [0.97, 0.68, 0.26, 1]);
    DP_COL.coral = dpTheme("live_alert", [0.98, 0.42, 0.38, 1]);
    dpColor(DP_COL.bg);
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();
    vizDraw(mgraphics, 4, 19, w - 8, h - 23, st);
    dpDrawHeader(w);
}

// scripts/render_preview.py: representative state (linked, Limiter in the chain, music playing).
function preview() {
    dpLink.paired = true;
    dpLink.status = "linked";
    dpLink.latency = 256;
    dpLink.chainNames = ["start", "Limiter", "Echo", "end"];
    dpLink.latencies = [0, 256, 0, 0];
    dpLink.selfIndex = 0;
    dpLink.partnerIndex = 3;
    st.paired = 1; st.sr = 44100; st.L = 256; st.B = 32; st.tmin = 292;
    st.TL = 0.375 * 44100; st.TR = 0.375 * 44100 * 1.25; st.offset = 0.25;
    st.tapL = 0.3; st.tapR = 0.25; st.retL = 0.24; st.retR = 0.2; st.inPk = 0.6; st.wetPk = 0.3;
    st.chainGain = 0.8; st.fb = 0.55; st.wet = 0.35; st.duckGain = 0.8;
    // Realistic history: a hit every 1/4 note at 120 bpm (some accented), and taps that really are the
    // input delayed by n * T with feedback decay (L at TL, R at TR), so folds / pulses line up.
    var blk = DP_HIST_BLOCK_SAMPS;
    var tl = Math.round(st.TL / blk), tr = Math.round(st.TR / blk);
    var beat = Math.round(0.5 * 44100 / blk);
    var inp = [];
    for (var i = 0; i < DP_HIST_BLOCKS; i++) {
        var ph = i % beat;
        var acc = (Math.floor(i / beat) % 4 === 0) ? 0.9 : 0.5;
        inp.push(i > 40 && i < 420 ? (ph < 8 ? acc * Math.exp(-ph / 2.5) : 0.02) : 0.005);
    }
    var hist = [];
    for (var j = 0; j < DP_HIST_BLOCKS; j++) {
        var l = 0, r = 0;
        for (var n = 1; n <= 8; n++) {
            var g = 0.8 * Math.pow(st.fb * 0.8, n - 1);
            if (j - n * tl >= 0) l = Math.max(l, inp[j - n * tl] * g);
            if (j - n * tr >= 0) r = Math.max(r, inp[j - n * tr] * g);
        }
        hist.push(inp[j], l, r);
    }
    st.hist = hist;
    st.histHead = 0; // ring is full and the newest block is the last one
    if (typeof vizPreview === "function") vizPreview(st);
}
