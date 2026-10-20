// Delay+ (Start) face: shared state, time computation, telemetry polling and the status header.
// Build order: delayplus_config.js + `var DP_ROLE = "start"` + delayplus_link.js + this file +
// one of src/delayplus_viz_{a,b,c}.js, which defines
//   VIZ_NAME, vizDraw(mg, x, y, w, h, st)   and optionally   vizIdle(st) (true = keep animating).
//
// Outlet 0 -> gen (`tms <ms>`, `lat <samples>`).
// Inputs: set_<param> from the live.* objects, `names` from loadbang, `init_link` from
// live.thisdevice.

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var DP_COL = {
    bg: [0.055, 0.062, 0.075, 1],
    frame: [0.20, 0.23, 0.28, 1],
    text: [0.80, 0.84, 0.90, 1],
    dim: [0.45, 0.50, 0.58, 1],
    cyan: [0.30, 0.82, 0.95, 1],
    amber: [0.97, 0.68, 0.26, 1],
    coral: [0.98, 0.42, 0.38, 1],
    green: [0.40, 0.88, 0.52, 1],
    violet: [0.66, 0.55, 0.98, 1],
};

var st = {
    sync: 1, timeMs: 375, div: DP_DIV_DEFAULT, offset: 0, fb: 0.4, wet: 0.35, hp: 20, lp: 20000,
    drive: 0, mrate: 0.5, mdepth: 0, duck: 0, width: 1, pp: 0, tmode: 0, freeze: 0, debug: 0,
    tms: 375, link: dpLink,
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

function dpSendTime() {
    var ms = dpTargetMs(st.sync > 0.5, st.timeMs, st.div, dpLink.bpm);
    if (Math.abs(ms - st.tms) > 1e-6 || !st.sentOnce) {
        st.tms = ms;
        st.sentOnce = true;
        outlet(0, "tms", ms);
        dpHdrPoke(31, ms);
    }
    mgraphics.redraw();
}

// Re-asserted into the gen header by the link poll (see dpHdrPoke).
function dpTimeMs() {
    return dpTargetMs(st.sync > 0.5, st.timeMs, st.div, dpLink.bpm);
}

dpOnChange = function () {
    dpSendTime();
};

function set_sync(v) { st.sync = v; dpSendTime(); }
function set_time(v) { st.timeMs = v; dpSendTime(); }
function set_div(v) { st.div = v; dpSendTime(); }
function set_offset(v) { st.offset = v / 100; mgraphics.redraw(); }
function set_fb(v) { st.fb = v / 100; mgraphics.redraw(); }
function set_wet(v) { st.wet = v / 100; mgraphics.redraw(); }
function set_hp(v) { st.hp = v; mgraphics.redraw(); }
function set_lp(v) { st.lp = v; mgraphics.redraw(); }
function set_drive(v) { st.drive = v / 100; mgraphics.redraw(); }
function set_mrate(v) { st.mrate = v; mgraphics.redraw(); }
function set_mdepth(v) { st.mdepth = v / 100; mgraphics.redraw(); }
function set_duck(v) { st.duck = v / 100; mgraphics.redraw(); }
function set_width(v) { st.width = v / 100; mgraphics.redraw(); }
function set_pp(v) { st.pp = v; mgraphics.redraw(); }
function set_tmode(v) { st.tmode = v; mgraphics.redraw(); }
function set_freeze(v) { st.freeze = v; mgraphics.redraw(); }
function set_debug(v) { st.debug = v; mgraphics.redraw(); }

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

// Shared readout of the effective time, used by all variants.
function dpTimeLabel() {
    var sr = st.sr || 44100;
    var ms = Math.max(st.TL, st.TR) * 1000 / sr;
    if (!ms) ms = st.tms;
    if (st.sync > 0.5) return DP_DIVISIONS[dpDivisionIndex(st.div)][0] + "  " + dpFormatMs(ms);
    return dpFormatMs(ms);
}

function paint() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    dpColor(DP_COL.bg);
    mgraphics.rectangle_rounded(0, 0, w, h, 6, 6);
    mgraphics.fill();
    vizDraw(mgraphics, 4, 19, w - 8, h - 23, st);
    dpDrawHeader(w);
    dpColor(DP_COL.frame);
    mgraphics.set_line_width(1);
    mgraphics.rectangle_rounded(0.5, 0.5, w - 1, h - 1, 6, 6);
    mgraphics.stroke();
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
    var hist = [];
    for (var i = 0; i < DP_HIST_BLOCKS; i++) {
        var beat = (i % 64) < 6 ? 0.8 * Math.exp(-(i % 64) / 2) : 0.04;
        var echo = 0.35 * Math.exp(-((i + 40) % 64) / 5) * (0.6 + 0.4 * Math.sin(i * 0.07));
        hist.push(beat, echo, echo * 0.85);
    }
    st.hist = hist;
    st.histHead = 200;
    if (typeof vizPreview === "function") vizPreview(st);
}
