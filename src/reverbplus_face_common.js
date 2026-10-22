// Reverb+ face prelude: what every face v8ui gets before its own script (scripts/build_reverbplus.py
// prepends reverbplus_config.js, then this file, then the layout's face files). A face is a pure display /
// controller: it never touches the gen, the link layer or the IR pipeline (the engine v8ui does).
//
// Receives (inlet 0):
//   set_<key> <value>   raw parameter values, only for the keys the layout lists in the v8ui's "keys"
//   names <xfer> <hdr> <scope> <spec> <ir> <irspec> <irview>   buffer~ names of this device instance
//   state dsp <ready> <error|->
//   state link <paired> <status> <latency smp> <partner index>
//   state ir <status> <loaded> <len smp> <sr> <channels> <srMismatch> <name|->
// Sends (outlet 0):
//   rpSend(key, value)  -> `param <key> <value>`: drives the live.* parameter object (undo, automation, echo)
//   rpCmd(name)         -> `cmd <name>`: browse_ir | clear_ir
// Telemetry: rpPoll(fps) reads buffer~ ---rpscope (layout RP_SCOPE in reverbplus_config.js) into rpT.s and
// calls onFrame(rpT) when the gen's frame counter moved (then mgraphics.redraw()). Read other buffers
// with rpBuf(name) (names in rpNames). Hooks a face may define: paint(), onFrame(t), onParam(key, v),
// onState(kind), preview() (scripts/render_preview.py), onclick / ondrag / ... as in any v8ui.

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

/** @type {{[key: string]: number}} */
var rpP = {};
var rpNames = { xfer: "", hdr: "", scope: "", spec: "", ir: "", irspec: "", irview: "" };
var rpState = {
    dsp: { ready: 0, error: "" },
    link: { paired: 0, status: "init", latency: 0, partner: -1 },
    ir: { status: "idle", loaded: 0, len: 0, sr: 0, channels: 0, srMismatch: 0, name: "" },
};
// Telemetry: s = the scope buffer contents (RP_SCOPE_SAMPS), frames = counter seen last, idle = frames
// without signal, active = whether a display should keep animating.
var rpT = { s: null, frames: -1, idle: 0, active: false };

// Palette: Live theme colours with fallbacks (call rpTheme in paint so a theme change shows).
var RPC = {
    bg: [0.075, 0.075, 0.075, 1], frame: [0.20, 0.23, 0.28, 1], text: [0.80, 0.84, 0.90, 1],
    dim: [0.45, 0.50, 0.58, 1], cyan: [0.30, 0.82, 0.95, 1], amber: [0.97, 0.68, 0.26, 1],
    coral: [0.98, 0.42, 0.38, 1], green: [0.40, 0.88, 0.52, 1], violet: [0.66, 0.55, 0.98, 1],
};

function rpRefreshTheme() {
    RPC.bg = rpTheme("live_lcd_bg", [0.075, 0.075, 0.075, 1]);
    RPC.cyan = rpTheme("live_display_line_one", [0.30, 0.82, 0.95, 1]);
    RPC.amber = rpTheme("live_display_line_two", [0.97, 0.68, 0.26, 1]);
    RPC.coral = rpTheme("live_alert", [0.98, 0.42, 0.38, 1]);
    RPC.text = rpTheme("live_lcd_control_fg", [0.80, 0.84, 0.90, 1]);
    RPC.dim = rpTheme("live_lcd_title", [0.45, 0.50, 0.58, 1]);
}

function rpNum(key, dflt) {
    return key in rpP ? rpP[key] : dflt;
}

/** Algorithm index 0..5 as currently set. */
function rpAlgo() {
    return rpIndex(rpNum("algo", 1), RP_ALGOS.length);
}

/** True when the parameter applies to the current algorithm (a face greys the others). */
function rpActive(key) {
    return RP_INACTIVE[rpAlgo()].indexOf(key) < 0;
}

function rpSend(key, value) {
    outlet(0, "param", key, value);
}

function rpCmd(name) {
    outlet(0, "cmd", name);
}

// ---- messages from the patcher ----------------------------------------------------------------------
function anything() {
    var name = messagename;
    var a = arguments;
    if (name.indexOf("set_") === 0) {
        var key = name.substring(4);
        rpP[key] = a.length ? Number(a[0]) : 0;
        if (typeof onParam === "function") onParam(key, rpP[key]);
        mgraphics.redraw();
    } else if (name === "state" && a.length) {
        var kind = String(a[0]);
        if (kind === "dsp") {
            rpState.dsp.ready = Number(a[1]) ? 1 : 0;
            rpState.dsp.error = a[2] === "-" || a[2] === undefined ? "" : String(a[2]).replace(/_/g, " ");
        } else if (kind === "link") {
            rpState.link = { paired: Number(a[1]) ? 1 : 0, status: String(a[2]).replace(/_/g, " "), latency: Number(a[3]) || 0,
                partner: Number(a[4]) };
        } else if (kind === "ir") {
            rpState.ir = { status: String(a[1]), loaded: Number(a[2]) ? 1 : 0, len: Number(a[3]) || 0, sr: Number(a[4]) || 0,
                channels: Number(a[5]) || 0, srMismatch: Number(a[6]) ? 1 : 0, name: a[7] === "-" ? "" : String(a[7]).replace(/_/g, " ") };
        }
        if (typeof onState === "function") onState(kind);
        mgraphics.redraw();
    }
}

function names(xferName, hdrName, scopeName, specName, irName, irSpecName, irViewName) {
    rpNames.xfer = String(xferName);
    rpNames.hdr = String(hdrName);
    rpNames.scope = String(scopeName);
    rpNames.spec = specName === undefined ? "" : String(specName);
    rpNames.ir = irName === undefined ? "" : String(irName);
    rpNames.irspec = irSpecName === undefined ? "" : String(irSpecName);
    rpNames.irview = irViewName === undefined ? "" : String(irViewName);
}

// ---- telemetry --------------------------------------------------------------------------------------
var rpBufs = {};
/** @param {string} name  a buffer~ name from rpNames */
function rpBuf(name) {
    if (!name) return null;
    if (!rpBufs[name]) {
        try { rpBufs[name] = new Buffer(name); } catch (e) { return null; }
    }
    return rpBufs[name];
}

var rpPollTask = null;
function rpPoll(fps) {
    if (typeof Task === "undefined" || rpPollTask) return;
    rpPollTask = new Task(rpFrame, this);
    rpPollTask.interval = Math.round(1000 / (fps || 30));
    rpPollTask.repeat();
}

function rpFrame() {
    var b = rpBuf(rpNames.scope);
    if (!b) return;
    var h = b.peek(1, 0, RP_SCOPE_SAMPS);
    if (!h || h.length < RP_SCOPE.ALGO_STATE + 1) return;
    var S = RP_SCOPE;
    var moved = h[S.FRAMES] !== rpT.frames;
    rpT.frames = h[S.FRAMES];
    rpT.s = h;
    var sig = h[S.IN_PK] + h[S.WET_PK] + h[S.RET_PK];
    rpT.idle = sig > 0.00002 ? 0 : rpT.idle + 1;
    // keep animating for as long as the decay ring can still show something (about 2 s after silence)
    rpT.active = rpT.idle < 90;
    if (!moved) return;
    if (typeof onFrame === "function") onFrame(rpT);
    if (rpT.active) mgraphics.redraw();
}

// ---- drawing helpers ------------------------------------------------------------------------------------
function rpColor(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? c[3] : a);
}

function rpText(str, x, y, size, c, bold) {
    mgraphics.select_font_face(bold ? "Arial Bold" : "Arial");
    mgraphics.set_font_size(size);
    rpColor(c);
    mgraphics.move_to(x, y);
    mgraphics.show_text(String(str));
}

function rpTextW(str, size, bold) {
    mgraphics.select_font_face(bold ? "Arial Bold" : "Arial");
    mgraphics.set_font_size(size);
    return mgraphics.text_measure(String(str))[0];
}

function rpPill(x, y, w, h, fill, alpha) {
    rpColor(fill, alpha);
    mgraphics.rectangle_rounded(x, y, w, h, h, h);
    mgraphics.fill();
}

/**
 * Header pills a face may show: DSP loading / failed, no End, loop clamped (MIN), IR status.
 * @returns {Array<{label: string, color: number[]}>}
 */
function rpHeaderPills() {
    var out = [];
    if (!rpState.dsp.ready) {
        out.push(rpState.dsp.error ? { label: "DSP FAILED: " + rpState.dsp.error.toUpperCase(), color: RPC.coral }
            : { label: "DSP LOADING…", color: RPC.amber });
        return out;
    }
    if (!rpState.link.paired) {
        out.push({ label: rpState.link.status === "no End" ? "NO END — add Reverb+ End" : String(rpState.link.status).toUpperCase(),
            color: RPC.amber });
    }
    var s = rpT.s;
    if (s && s[RP_SCOPE.CLAMPED] > 0.5 && rpNum("loop", 0) > 0) out.push({ label: "LOOP MIN " + rpFormatMs(s[RP_SCOPE.MIN_MS]), color: RPC.amber });
    var algo = rpAlgo();
    if (algo === RP_ALGO.CONV) {
        var ir = rpState.ir;
        if (ir.status === "loading" || ir.status === "processing") out.push({ label: "IR " + ir.status.toUpperCase() + "…", color: RPC.amber });
        else if (ir.status === "error") out.push({ label: "IR ERROR", color: RPC.coral });
        else if (!ir.loaded) out.push({ label: "DROP AN IR FILE", color: RPC.amber });
        else if (ir.srMismatch) out.push({ label: "IR RESAMPLED", color: RPC.dim });
    }
    return out;
}

/** Draw the header pills right-aligned in a strip of width w at y. */
function rpDrawHeader(w, y) {
    var pills = rpHeaderPills();
    var x = w - 2;
    for (var i = 0; i < pills.length; i++) {
        var pw = rpTextW(pills[i].label, 8.5, true) + 12;
        x -= pw;
        rpPill(x, y, pw, 13, pills[i].color, 0.16);
        rpText(pills[i].label, x + 6, y + 9.6, 8.5, pills[i].color, true);
        x -= 4;
    }
}

/** dB (-120..0) -> 0..1 for level displays. */
function rpDb01(db, floorDb) {
    var f = floorDb === undefined ? -90 : floorDb;
    return rpClamp((db - f) / -f, 0, 1);
}

/**
 * A representative telemetry buffer for scripts/render_preview.py (and tests): decay ring of an
 * exponential tail, line energies, early reflections, waveform ring.
 * @param {number} algo
 * @param {number} rt60
 */
function rpFakeScope(algo, rt60) {
    var S = RP_SCOPE;
    var s = new Float32Array(RP_SCOPE_SAMPS);
    s[S.FRAMES] = 10; s[S.SR] = 48000; s[S.ALGO] = algo; s[S.PAIRED] = 1; s[S.B] = 64; s[S.L] = 256; s[S.K] = 0;
    s[S.MIN_MS] = 6.7; s[S.LOOP_MS] = 120; s[S.PREDELAY_MS] = 20;
    s[S.IN_PK] = 0.4; s[S.TANK_PK] = 0.4; s[S.WET_PK] = 0.25; s[S.RET_PK] = 0.05;
    s[S.RT60_MEAS] = rt60; s[S.RT60_LO] = rt60 * 1.2; s[S.RT60_MID] = rt60; s[S.RT60_HI] = rt60 * 0.4;
    s[S.NLINES] = algo === 1 ? 16 : (algo === 0 ? 4 : (algo === 5 ? 0 : 8));
    for (var i = 0; i < S.N_LINES; i++) s[S.LINES + i] = i < s[S.NLINES] ? 0.35 + 0.4 * Math.abs(Math.sin(i * 1.7)) : 0;
    for (var k = 0; k < S.N_ER; k++) {
        var ms = 4 + k * k * 0.27;
        s[S.ER + 2 * k] = ms;
        s[S.ER + 2 * k + 1] = (k % 2 ? -1 : 1) * 0.5 * Math.exp(-ms / 40);
    }
    s[S.DECAY_HEAD] = 0;
    for (var j = 0; j < S.N_DECAY; j++) {
        var age = (j - 40 + S.N_DECAY) % S.N_DECAY; // entries since the hit at slot 40
        s[S.DECAY + j] = j < 40 ? -90 : -12 - 60 * (age * RP_DECAY_BLOCK / 48000) / rt60;
    }
    s[S.WAVE_HEAD] = 0;
    for (var w = 0; w < S.N_WAVE; w++) {
        var e = w < 20 ? 0 : Math.exp(-(w - 20) * RP_WAVE_BLOCK / 48000 * 6.9 / rt60) * 0.5;
        s[S.WAVE + 2 * w] = -e * (0.5 + 0.5 * Math.sin(w * 2.3));
        s[S.WAVE + 2 * w + 1] = e * (0.5 + 0.5 * Math.cos(w * 1.9));
    }
    return s;
}

/** Preview state: DSP running, paired, Hall, representative telemetry. Faces call it from preview(). */
function rpPreviewBase(algo, rt60) {
    rpState.dsp.ready = 1;
    rpState.link = { paired: 1, status: "linked", latency: 256, partner: 3 };
    rpState.ir = { status: "ready", loaded: 1, len: 96000, sr: 48000, channels: 2, srMismatch: 0, name: "Cathedral.wav" };
    rpT.s = rpFakeScope(algo === undefined ? 1 : algo, rt60 || 2.5);
    rpT.active = true;
}

var rpThemeTask = rpThemeWatch();
