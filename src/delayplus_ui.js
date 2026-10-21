// Delay+ (Start) face: shared state, time computation, telemetry polling and the status header.
// Build order: delayplus_config.js + `var DP_ROLE = "start"` + delayplus_link.js + this file +
// one of src/delayplus_viz_{a,b,c}.js, which defines
//   VIZ_NAME, vizDraw(mg, x, y, w, h, st)   and optionally   vizIdle(st) (true = keep animating).
//
// Outlet 0 -> gen (unused in Live: times go through the gen header). Outlet 1 -> `mirror <key> <v>`
// for Stereo Link (routed to `prepend set` on the other side's control). Outlets 2 / 3 -> the MIDI
// From type / channel menus.
// Inputs: set_<param> from the live.* objects, `names` from loadbang, `init_link` from
// live.thisdevice, `midi_note <n>` (note-ons from the MIDI input), `settype` / `setchannel` from
// the MIDI From menus.

inlets = 1;
outlets = 4;

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
    tmode_l: DP_TM.SYNC, time_l: 375, div_l: DP_DIV_DEFAULT, mode_l: 0, offs_l: 0,
    note_l: DP_NOTE_DEFAULT, cents_l: 0, fluid_l: 1,
    tmode_r: DP_TM.SYNC, time_r: 375, div_r: DP_DIV_DEFAULT, mode_r: 0, offs_r: 0,
    note_r: DP_NOTE_DEFAULT, cents_r: 0, fluid_r: 1, link: 1, midiNote: -1,
    fb: 0.5, wet: 0.5, width: 1, hp: 50, lp: 5000, hpres: 0, lpres: 0, filton: 1, chmode: 0, pp: 0,
    showlat: 0, lfosync: 1, lfohz: 0.5, lfodiv: 3, moddelay: 0, freeze: 0, repitch: 0,
    msL: 250, msR: 250, lfoHzOut: 2,
    sr: 44100, TL: 0, TR: 0, tmin: 0, clamped: 0, B: 32, K: 0, L: 0, paired: 0,
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

function dpUsesPitch() {
    var p = function (m) { return m === DP_TM.PITCH || m === DP_TM.MIDI; };
    return p(Math.round(st.tmode_l)) || p(Math.round(st.tmode_r));
}

/** @param {string} s  "l" or "r" */
function dpSide(s) {
    return { tmode: st["tmode_" + s], time: st["time_" + s], div: st["div_" + s], mode: st["mode_" + s],
        note: st["note_" + s], cents: st["cents_" + s], fluid: st["fluid_" + s], offs: st["offs_" + s] };
}

// Delay times (per side) and the LFO rate go straight into the gen header (see dpHdrPoke).
// Pitch / MIDI periods shorter than the tank's minimum loop are folded to a whole multiple of the
// period (dpSideMs), using the minimum the gen core reports (scope TMIN, samples).
function dpPokeTimes() {
    var bpm = dpLink.bpm;
    var ctx = { midiNote: st.midiNote, tminMs: st.tmin > 0 ? st.tmin * 1000 / (st.sr || 44100) : 0 };
    st.msL = dpSideMs(dpSide("l"), bpm, ctx);
    st.msR = dpSideMs(dpSide("r"), bpm, ctx);
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
// too, and switching Link on copies Left onto Right. The other control is updated with `set`
// (outlet 1 -> route mirror -> prepend set), which does not output, so nothing loops back here; the
// layout also feeds a mirrored Sync into that side's Time / Division swap.
var DP_LINKED = { tmode: 1, time: 1, div: 1, mode: 1, note: 1, cents: 1, fluid: 1 };

function dpMirror(other, v) {
    if (st[other] === v) return;
    st[other] = v;
    outlet(1, "mirror", other, v);
}

function dpSet(key, v) {
    st[key] = DP_PCT[key] ? v / 100 : v;
    if (key === "chmode") st.pp = v === 1 ? 1 : 0;
    var m = key.match(/^([a-z]+)_(l|r)$/);
    if (m && st.link > 0.5 && DP_LINKED[m[1]]) dpMirror(m[1] + "_" + (m[2] === "l" ? "r" : "l"), v);
    // Link switched on by the user: Right takes Left's settings. Not while the Set loads (dpLoaded is
    // set once live.thisdevice has fired), when the saved values arrive in no particular order.
    if (key === "link" && v > 0.5 && dpLoaded) {
        for (var k in DP_LINKED) dpMirror(k + "_r", st[k + "_l"]);
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
    var tminWas = st.tmin;
    st.TL = h[S.TL]; st.TR = h[S.TR]; st.clamped = h[S.CLAMPED]; st.tmin = h[S.TMIN];
    // Pitch / MIDI fold their period above the tank minimum: re-send when that minimum moves
    // (it depends on the chain latency and the slice, not on the times, so this cannot loop).
    if (Math.abs(st.tmin - tminWas) >= 1 && dpUsesPitch()) dpPokeTimes();
    st.B = h[S.B]; st.K = h[S.K]; st.L = h[S.L]; st.paired = h[S.PAIRED];
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

// Header: range warnings (left), link status (right). The link pill shows only when Delay+ End is
// missing or not linked yet, or when the Options page's Link Latency is on (then with the latency).
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
    if (!linked || st.showlat > 0.5) {
        var lw = dpTextW(label, 8.5, true) + 12;
        var lx = w - 2 - lw;
        dpPill(lx, 2, lw, 13, col, 0.16);
        dpColor(col);
        mgraphics.arc(lx + 6, 8.5, 2, 0, Math.PI * 2);
        mgraphics.fill();
        dpText(label, lx + 11, 11.6, 8.5, col, true);
    }

    // Left: each side's range warning in that side's own terms (dpSideWarn: MIN 16.1 ms, MIN 1/32,
    // MAX x32.00, MAX B0). Both sides alike -> one pill; otherwise each is prefixed with its side.
    var ctx = { midiNote: st.midiNote, tminMs: st.tmin * 1000 / sr };
    var wl = dpSideWarn(dpSide("l"), dpLink.bpm, ctx);
    var wr = dpSideWarn(dpSide("r"), dpLink.bpm, ctx);
    var ms = Math.round(st.chmode) === 2;
    var pills = wl === wr ? (wl ? [wl] : []) : [wl && (ms ? "M " : "L ") + wl, wr && (ms ? "S " : "R ") + wr].filter(Boolean);
    var x = 2;
    for (var i = 0; i < pills.length; i++) {
        var cw = dpTextW(pills[i], 8.5, true) + 10;
        dpPill(x, 2, cw, 13, DP_COL.amber, 0.2);
        dpText(pills[i], x + 5, 11.6, 8.5, DP_COL.amber, true);
        x += cw + 4;
    }
}

// Effective time of both sides, e.g. "1/8 D | 1/8" or "375 ms | A2 +12 ct".
function dpTimeLabel() {
    return dpSideLabel(dpSide("l"), st.midiNote) + " | " + dpSideLabel(dpSide("r"), st.midiNote);
}

// ---- MIDI input -----------------------------------------------------------------------------
// Note-ons from `midiin` (stripnote): the note sides in MIDI mode play.
function midi_note(n) {
    st.midiNote = dpClamp(Math.round(Number(n) || 0), 0, 127);
    dpSendTime();
}

// MIDI From: the device's MIDI input routing (LOM DeviceIO), mirrored into two hidden menus like
// Envelope Trigger's MIDI To. Started from init_link (live.thisdevice): the LOM is not ready at
// loadbang. The DeviceIO exists because the patch has a `midiin`.
var DP_MIDI_IN = "this_device midi_inputs 0";
var dpMidiTypes = null, dpMidiChans = null, dpMidiType = null, dpMidiChan = null;

// LiveAPI hands dictionary properties back as ["{json}"], [property, <Dict>] or [property, object].
function dpLomValue(raw, key) {
    var v = raw;
    if (Array.isArray(v)) v = v.length > 1 ? v[1] : v[0];
    if (v && typeof v === "object" && typeof v.stringify === "function") v = v.stringify();
    if (typeof v === "string") {
        try { v = JSON.parse(v); } catch (err) { return null; }
    }
    return v && typeof v === "object" && key in v ? v[key] : null;
}

function dpMenuRange(items, empty) {
    if (!items || !items.length) return [empty, "-"];
    var names = items.map(function (t) { return String(t.display_name); });
    return names.length === 1 ? [names[0], "-"] : names;
}

function dpInitMidiRouting() {
    if (typeof LiveAPI === "undefined" || dpMidiTypes) return;
    try {
        dpMidiTypes = new LiveAPI(function (args) {
            var types = dpLomValue(args, "available_routing_types");
            if (!types) return;
            outlet(2, ["_parameter_range"].concat(dpMenuRange(types, "No Input")));
            if (dpMidiType) dpOnMidiType(dpMidiType.get("routing_type"));
        }, DP_MIDI_IN);
        dpMidiTypes.property = "available_routing_types";
        dpMidiChans = new LiveAPI(function (args) {
            var chans = dpLomValue(args, "available_routing_channels");
            if (!chans) return;
            outlet(3, ["_parameter_range"].concat(dpMenuRange(chans, "-")));
            if (dpMidiChan) dpOnMidiChan(dpMidiChan.get("routing_channel"));
        }, DP_MIDI_IN);
        dpMidiChans.property = "available_routing_channels";
        dpMidiType = new LiveAPI(dpOnMidiType, DP_MIDI_IN);
        dpMidiType.property = "routing_type";
        dpMidiChan = new LiveAPI(dpOnMidiChan, DP_MIDI_IN);
        dpMidiChan.property = "routing_channel";
    } catch (e) {
        post("Delay+: MIDI From routing unavailable: " + e + "\n");
    }
}

function dpOnMidiType(args) {
    var t = dpLomValue(args, "routing_type");
    if (t && t.display_name !== undefined) outlet(2, ["setsymbol", String(t.display_name)]);
}

function dpOnMidiChan(args) {
    var c = dpLomValue(args, "routing_channel");
    if (c && c.display_name !== undefined) outlet(3, ["setsymbol", String(c.display_name)]);
}

function settype(i) {
    if (!dpMidiTypes || !dpMidiType) return;
    var types = dpLomValue(dpMidiTypes.get("available_routing_types"), "available_routing_types");
    var idx = Math.round(Number(i) || 0);
    if (types && types[idx]) dpMidiType.set("routing_type", types[idx]);
}

function setchannel(i) {
    if (!dpMidiChans || !dpMidiChan) return;
    var chans = dpLomValue(dpMidiChans.get("available_routing_channels"), "available_routing_channels");
    var idx = Math.round(Number(i) || 0);
    if (chans && chans.length > 1 && chans[idx]) dpMidiChan.set("routing_channel", chans[idx]);
}

var dpThemeTask = dpThemeWatch();

// Panels take Live's theme colours from here (max.getcolor), on load and whenever the theme
// changes: setting them through attribute bindings did not repaint them in Live. Echo's look: a
// Desktop-coloured body with the left, display and right panels on it.
/** @type {Array<[string, string, number[]]>} */
var DP_PANEL_THEME = [
    ["obj-panel-body", "live_desktop", [0.165, 0.165, 0.165, 1]],
    ["obj-panel-left", "live_surface_bg", [0.235, 0.24, 0.25, 1]],
    ["obj-panel-right", "live_surface_bg", [0.235, 0.24, 0.25, 1]],
    ["obj-panel-display", "live_lcd_bg", [0.075, 0.075, 0.075, 1]],
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
