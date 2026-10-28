// Operator+ face (scripts/build_opplus.py concatenates: OP_PARAMS / OP_LAYOUT / OP_REGION / GEN_DSP_*, spectral_theme.js,
// opplus_config.js, this file). Two v8ui boxes run it:
//   OP_REGION "main"  : the whole 725 x 169 face, ignoreclick (it only draws). Owns the engine: parameter values, the ---opcfg
//                       block, wavetables, the voice allocator (MIDI), the deferred gen~, the visibility of the transparent
//                       live.* objects that sit over the drawn controls, and the blob state (user waveforms).
//   OP_REGION "graph" : the interactive strip at the top of the display (envelope handles, harmonics editor, filter curve,
//                       algorithm picker). It changes parameters through their live.* objects (automation / undo work).
// Every live.* object outputs `pv <key> <value>` into both. Non-parameter clicks (section select, view headers) arrive as
// `click <what> [arg]` from transparent ubuttons.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
outlets = 2;

var OP_IS_MAIN = (typeof OP_REGION === "undefined") || OP_REGION === "main";
var opHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
/** @type {Object<string, number>} */
var opVals = {};
for (var _k = 0; _k < OP_P.length; _k++) opVals[OP_P[_k].key] = OP_P[_k].init;
var opNames = { cfg: "", voices: "", waves: "", scope: "" };
/** @type {number[][]} */
var opUser = [opDefaultUser(), opDefaultUser(), opDefaultUser(), opDefaultUser()];
var opUserN = [64, 64, 64, 64];   // partials shown in the harmonics editor (16 / 32 / 64)
var opRt = { bpm: 120, playing: 0, bend: 0, mw: 0, at: 0 };
var opSr = 48000, opWavesSr = 0;
var opTel = { stage: [0, 0, 0, 0, 0, 0, 0], lvl: [0, 0, 0, 0, 0, 0, 0], active: 0, lfo: 0, fc: 0, frame: -1 };
var opAlloc = opCreateAllocator();
var opHidden = {};
var opGraphH = 61;
var opDrag = null;
var OP_GX = 215, OP_GY = 0, OP_GW = 294, OP_GH = 61;   // graph strip in device px (origin of the graph v8ui)
var OP_GH_GLOBAL = 23;   // in Global the strip is only the algorithm row (the matrix menus sit below it)

// ---------------- colours (Live theme names; Operator's own operator colours are fixed) ----------------
function opCol(name) { return sptColor(name); }
var OP_OSC_COL = [[0.91, 0.85, 0.14, 1], [0.15, 0.82, 0.78, 1], [0.42, 0.42, 0.93, 1], [0.95, 0.42, 0.11, 1]];   // A yellow, B cyan, C blue, D orange
function opSurface() { return sptColor("live_surface_bg"); }
function opLighter() { return sptMix(sptColor("live_surface_bg"), sptColor("live_control_fg"), 0.11); }
function opCyan() { return sptColor("live_lcd_control_fg_alt"); }
function opOrange() { return sptColor("live_lcd_control_fg"); }
function opLabelCol() { return sptColor("live_control_fg"); }
function opShellText() { return sptMix(sptColor("live_control_fg"), [1, 1, 1, 1], 0.28); }
function opDim(c, on) { return on ? c : sptMix(c, sptColor("live_surface_bg"), 0.55); }
/** Display colour of a value / label of a section that is switched off: Operator greys its whole display. */
function opOff() { return sptMix(sptColor("live_lcd_title"), sptColor("live_lcd_bg"), 0.3); }
function opDisp(c, on) { return on ? c : opOff(); }

// ---------------- state helpers ----------------
function opSel() { return Math.round(opVals.ui_section || 0); }
function opSecKey(i) { return ["a", "b", "c", "d", "lfo", "filter", "pitch"][i]; }
function opView(i) { var k = opSecKey(i); return k ? Math.round(opVals["ui_view_" + k] || 0) : 0; }
function opEnvPx(i) { return ["ae", "be", "ce", "de", "le", "fe", "pe"][i]; }
function opSectionOn(i) {
    if (i < 4) return opVals["osc_" + "abcd"[i] + "_on"] > 0.5;
    if (i === 4) return opVals.lfo_on > 0.5;
    if (i === 5) return opVals.filter_on > 0.5;
    if (i === 6) return opVals.pe_on > 0.5;
    return true;
}

function opCond(c) {
    if (!c) return true;
    var m;
    if ((m = /^nofix([A-D])$/.exec(c))) return opVals[m[1].toLowerCase() + "_fix_on"] < 0.5;
    if ((m = /^fix([A-D])$/.exec(c))) return opVals[m[1].toLowerCase() + "_fix_on"] > 0.5;
    if (c === "lfosync") return Math.round(opVals.lfo_range) === 2;
    if (c === "lfonosync") return Math.round(opVals.lfo_range) !== 2;
    if (c === "lphp") return Math.round(opVals.filter_type) <= 1;
    if (c === "nolphp") return Math.round(opVals.filter_type) > 1;
    if (c === "morph") return Math.round(opVals.filter_type) === 4;
    if (c === "drive") {
        var t = Math.round(opVals.filter_type);
        var ci = t <= 1 ? opVals.filter_circuit_lp_hp : opVals.filter_circuit_bp_no_morph;
        return t <= 2 && Math.round(ci) > 0;
    }
    if ((m = /^(times|slopes)s(\d)$/.exec(c))) {
        var s = Number(m[2]);
        var sl = s === 5 ? opVals.ui_slope_fe : (s === 6 ? opVals.ui_slope_pe : 0);
        return m[1] === "times" ? sl < 0.5 : sl > 0.5;
    }
    if ((m = /^mloop(\w+)$/.exec(c))) return Math.round(opVals[m[1] + "_mode"]) === 1;
    if ((m = /^mbeat(\w+)$/.exec(c))) { var md = Math.round(opVals[m[1] + "_mode"]); return md === 2 || md === 3; }
    return true;
}

function opItemVisible(it) {
    if (it.g !== "shell" && it.g !== "s" + opSel()) return false;
    return opCond(it.cond);
}

// ---------------- parameter input ----------------
/** From every live.* object: pv <key> <value>. */
function pv(key, v) {
    key = String(key);
    var n = Number(v);
    if (!(key in opVals) || !isFinite(n)) return;
    if (opVals[key] === n) return;
    opVals[key] = n;
    if (OP_IS_MAIN) {
        opWriteCfg();
        if (/^ui_|_fix_on$|^lfo_range$|^filter_type$|^filter_circuit|_mode$/.test(key)) opApplyVisibility();
        if (/^osc_[abcd]_wave$/.test(key) && Math.round(n) === 22) opWriteUser("abcd".indexOf(key.charAt(4)));
    }
    mgraphics.redraw();
}

/** Change a parameter from the face: through its live.* object, so Live records automation and undo. */
function opSet(key, v) {
    var p = OP_BY_KEY[key];
    if (!p) return;
    v = Math.max(p.min, Math.min(p.max, v));
    if (p.enum) v = Math.round(v);
    var o = opHost ? opHost.getnamed("op_" + key) : null;
    if (o) o.message("float", v);
    else pv(key, v);
}

// ---------------- engine (main region) ----------------
function setnames(cfg, voices, waves, scope) {
    opNames = { cfg: String(cfg), voices: String(voices), waves: String(waves), scope: String(scope) };
    if (OP_IS_MAIN) opWriteCfg();
}

function opBuf(name) {
    try { return name ? new Buffer(name) : null; } catch (e) { return null; }
}

function opWriteCfg() {
    var b = opBuf(opNames.cfg);
    if (!b) return;
    var c = opCfg(opVals, opRt);
    try { b.poke(1, 0, c); } catch (e) {}
}

var opSinTab = null;
function opBuildWaves() {
    var b = opBuf(opNames.waves);
    if (!b) return false;
    var N = OP_TBL;
    if (!opSinTab) { opSinTab = []; for (var i = 0; i < N; i++) opSinTab.push(Math.sin(2 * Math.PI * i / N)); }
    for (var w = 0; w < 22; w++) {
        for (var m = 0; m < OP_NMIP; m++) {
            var t = opFastTable(w, m, opSr, null);
            try { b.poke(1, (w * OP_NMIP + m) * (N + 1), t); } catch (e) { return false; }
        }
    }
    for (var o = 0; o < 4; o++) opWriteUser(o);
    opWavesSr = opSr;
    return true;
}

/** opWaveTable with a sine lookup table (the build of all 22 x 8 tables takes a few ms). */
function opFastTable(w, m, sr, user) {
    var N = OP_TBL, h = w >= 22 ? user : opWaveHarmonics(w);
    if (!h) return opWaveTable(w, m, sr, user, 12345 + w);
    var lim = Math.max(1, Math.floor((sr * 0.5) / (40 * Math.pow(2, m)) - 0.0001));
    var out = new Array(N + 1), i, n;
    for (i = 0; i < N; i++) out[i] = 0;
    for (n = 1; n < h.length; n++) {
        var a = h[n];
        if (!a || n > lim) continue;
        for (i = 0; i < N; i++) out[i] += a * opSinTab[(n * i) % N];
    }
    if (w >= 22) {
        var pk = 0;
        for (i = 0; i < N; i++) pk = Math.max(pk, Math.abs(out[i]));
        if (pk > 1e-9) for (i = 0; i < N; i++) out[i] /= pk;
    }
    out[N] = out[0];
    return out;
}

function opWriteUser(o) {
    var b = opBuf(opNames.waves);
    if (!b || !opSinTab) return;
    for (var m = 0; m < OP_NMIP; m++) {
        try { b.poke(1, ((22 + o) * OP_NMIP + m) * (OP_TBL + 1), opFastTable(22, m, opSr, opUser[o])); } catch (e) {}
    }
}

/** From the graph region: user <osc> <count> <a1> ... <a64> */
function user() {
    var a = arrayfromargs(arguments);
    var o = Math.round(a[0]);
    if (o < 0 || o > 3) return;
    opUserN[o] = Math.round(a[1]) || 64;
    var u = [0];
    for (var n = 1; n <= 64; n++) u[n] = Number(a[1 + n]) || 0;
    opUser[o] = u;
    if (OP_IS_MAIN) {
        opWriteUser(o);
        try { notifyclients(); } catch (e) {}
    }
    mgraphics.redraw();
}

function opSendUser(o) {
    var msg = ["user", o, opUserN[o]];
    for (var n = 1; n <= 64; n++) msg.push(Math.round(opUser[o][n] * 1000) / 1000);
    outlet(OP_IS_MAIN ? 1 : 0, msg);
}

// blob state (main): [1, userN x 4, user partials 4 x 64]
function getvalueof() {
    var out = [1];
    for (var o = 0; o < 4; o++) out.push(opUserN[o]);
    for (o = 0; o < 4; o++) for (var n = 1; n <= 64; n++) out.push(Math.round(opUser[o][n] * 10000) / 10000);
    return out;
}
function setvalueof() {
    var a = arrayfromargs(arguments);
    if (a.length < 5 || Number(a[0]) !== 1) return;
    for (var o = 0; o < 4; o++) {
        opUserN[o] = Number(a[1 + o]) || 64;
        var u = [0];
        for (var n = 1; n <= 64; n++) u[n] = Number(a[5 + o * 64 + n - 1]) || 0;
        opUser[o] = u;
        if (OP_IS_MAIN) { opWriteUser(o); opSendUser(o); }
    }
    mgraphics.redraw();
}

// ---------------- voices / MIDI (main) ----------------
function opWriteVoice(i) {
    var b = opBuf(opNames.voices);
    if (!b) return;
    var f = opAlloc.floats(i), base = i * OP_VSTRIDE;
    try {
        b.poke(1, base + 1, [f[1], f[2]]);
        b.poke(1, base + 4, [f[4], f[5], f[6], f[7]]);
        b.poke(1, base, f[0]);
        b.poke(1, base + 3, f[3]);
    } catch (e) {}
}

function opVoicesMax() { return [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 32][Math.round(opVals.voices)] || 6; }

function midi_note(note, vel) {
    var n = Math.round(Number(note)), v = Math.round(Number(vel));
    var list = v > 0 ? opAlloc.noteOn(n, v, opVoicesMax(), opVals.glide_on > 0.5, opVals.retrigger > 0.5) : opAlloc.noteOff(n, opVoicesMax());
    for (var i = 0; i < list.length; i++) opWriteVoice(list[i]);
}
function midi_bend(v) {
    var n = Number(v);
    if (!(n <= 1 && n >= -1)) n = ((Number(v) || 8192) - 8192) / 8192;
    opRt.bend = Math.max(-1, Math.min(1, n));
    opWriteCfg();
}
function midi_touch(p) { opRt.at = Math.max(0, Math.min(1, (Number(p) || 0) / 127)); opWriteCfg(); }
function midi_cc(a, b) {
    var c = Math.round(Number(a) || 0), val = Math.round(Number(b) || 0);
    if (c === 123 || (c === 0 && val === 123)) { all_notes_off(); return; }
    if (c === 1) { opRt.mw = val / 127; opWriteCfg(); }
}
function all_notes_off() {
    var l = opAlloc.allOff();
    for (var i = 0; i < l.length; i++) opWriteVoice(l[i]);
}
function playing(v) { opRt.playing = Number(v) > 0 ? 1 : 0; opWriteCfg(); }
function tempo(v) { if (Number(v) > 0) { opRt.bpm = Number(v); opWriteCfg(); } }

// test hooks (receive opplus_test): note <pitch> <vel>, diag
function note(p, v) { midi_note(p, v); }
function diag() {
    var g = new Global("opplus_diag");
    var d = { ready: opDsp.ready, error: opDsp.error, createdAt: opDsp.createdAt, retries: opDsp.retries };
    g[OP_IS_MAIN ? "main" : "graph"] = JSON.stringify({ dsp: d, names: opNames, inits: opInits, err: opInitErr, sec: opSel(),
        alive: opAlive(), click: opLastClick, sr: opSr, wavesSr: opWavesSr, active: opTel.active });
}

// ---------------- deferred DSP (AGENTS.md 1d; pattern of src/spectral_dsp.js) ----------------
var opDsp = { ready: 0, error: "", createdAt: 0, c0: -1, task: null, conf: null, retries: 0 };
function opTrace(tag, msg) {
    try {
        var g = new Global("opplus_trace");
        var lines = (g.text ? String(g.text).split("\n") : []).concat(["+" + Date.now() % 1000000 + " " + tag + (msg ? " " + msg : "")]);
        g.text = lines.slice(-60).join("\n");
    } catch (e) {}
}
function opAlive() {
    var b = opBuf(opNames.scope);
    if (!b) return -1;
    try { var v = b.peek(1, 0, 1); return Number(v && v.length !== undefined ? v[0] : v); } catch (e) { return -1; }
}
function opDspClaim() {
    var q = new Global("opplus_dspq"), now = Date.now();
    if (q.owner && q.owner !== opDspToken && now - Number(q.t) < 15000) return false;
    q.owner = opDspToken; q.t = now;
    return true;
}
var opDspToken = Math.random();
function opDspRelease() { var q = new Global("opplus_dspq"); if (q.owner === opDspToken) q.owner = 0; }
function opDspResend() {
    outlet(0, "cfgb", opNames.cfg);
    outlet(0, "vbuf", opNames.voices);
    outlet(0, "wtab", opNames.waves);
    outlet(0, "scope", opNames.scope);
    opWriteCfg();
}
function opDspLoad() {
    if (opDsp.ready || opDsp.createdAt || !opHost) return;
    if (!opDspClaim()) { opDsp.task = new Task(opDspLoad, this); opDsp.task.schedule(100); return; }
    opTrace("dsp-start", opDsp.retries ? "retry " + opDsp.retries : "");
    try {
        var g = opHost.getnamed("op_gen");
        if (!g) {
            var path = "/tmp/opplus_core_" + GEN_DSP_HASH + ".gendsp";
            var have = false;
            try { var rf = new File(path, "read"); have = rf.isopen && rf.eof === GEN_DSP_TEXT.length; rf.close(); } catch (e) {}
            if (!have) {
                var f = new File(path, "write", "TEXT");
                if (!f.isopen) throw new Error("cannot write " + path);
                f.eof = 0;
                for (var i = 0; i < GEN_DSP_TEXT.length; i += 16384) f.writestring(GEN_DSP_TEXT.substring(i, i + 16384));
                f.close();
            }
            g = opHost.newdefault(20, 140, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "op_gen";
            var hub = opHost.getnamed("op_genin"), ph = opHost.getnamed("op_phasor"), pout = opHost.getnamed("op_plugout");
            if (!hub || !ph || !pout) throw new Error("missing hub / plugphasor~ / plugout~");
            opHost.connect(hub, 0, g, 0);
            opHost.connect(ph, 0, g, 0);
            opHost.connect(g, 0, pout, 0);
            opHost.connect(g, 1, pout, 1);
        }
        opDsp.createdAt = Date.now();
        opDsp.c0 = opAlive();
        opDspConfirm();
    } catch (err) {
        opDsp.error = String(err && err.message ? err.message : err);
        opDspRelease();
        opTrace("dsp-error", opDsp.error);
    }
    mgraphics.redraw();
}
function opDspConfirm() {
    var c = opAlive();
    if (opDsp.c0 >= 0 && c >= 0 && c !== opDsp.c0) {
        opDsp.ready = 1;
        opDsp.error = "";
        opTrace("dsp", "ready after " + (Date.now() - opDsp.createdAt) + " ms");
        opDspRelease();
        opDspResend();
        var sr = opReadSr();
        if (sr > 0 && sr !== opWavesSr) { opSr = sr; opBuildWaves(); }
        mgraphics.redraw();
        return;
    }
    var limit = opDsp.retries === 0 ? 3500 : 6000;
    if (Date.now() - opDsp.createdAt > limit) {
        if (opDsp.retries < 2) {
            opDsp.retries++;
            opTrace("dsp-retry", "alive " + c);
            try { var old = opHost.getnamed("op_gen"); if (old) opHost.remove(old); } catch (e) {}
            opDsp.createdAt = 0;
            opDsp.c0 = -1;
            opDspLoad();
            return;
        }
        opDsp.error = "not running";
        opDspRelease();
        opTrace("dsp-error", "not running");
        mgraphics.redraw();
        return;
    }
    opDspResend();
    if (opDsp.c0 < 0) opDsp.c0 = c;
    if (!opDsp.conf) opDsp.conf = new Task(opDspConfirm, this);
    opDsp.conf.schedule(150);
}
function opReadSr() {
    var b = opBuf(opNames.scope);
    if (!b) return 0;
    try { var v = b.peek(1, 1, 1); return Number(v && v.length !== undefined ? v[0] : v) || 0; } catch (e) { return 0; }
}
function dsp_restart() {
    try { var old = opHost.getnamed("op_gen"); if (old) opHost.remove(old); } catch (e) {}
    opDsp.ready = 0; opDsp.createdAt = 0; opDsp.c0 = -1; opDsp.retries = 0;
    opDspLoad();
}

// ---------------- init (live.thisdevice) ----------------
var opTempoApi = null, opPlayApi = null, opPoll = null, opFrontTasks = [];
var opInitErr = "", opInits = 0, opLoadTask = null;
function init() {
    opInits++;
    if (!OP_IS_MAIN) { opStartPoll(); return; }
    opWriteCfg();
    opLoadTask = new Task(function () {
        try { opBuildWaves(); } catch (e) { opInitErr = "waves: " + e; }
        try { opDspLoad(); } catch (e2) { opInitErr += " dsp: " + e2; }
    }, this);
    opLoadTask.schedule(30);
    try {
        opTempoApi = new LiveAPI(function (a) { var v = arrayfromargs(a); if (v[0] === "tempo") tempo(v[1]); }, "live_set");
        opTempoApi.property = "tempo";
        tempo(opTempoApi.get("tempo"));
        opPlayApi = new LiveAPI(function (a) { var v = arrayfromargs(a); if (v[0] === "is_playing") playing(v[1]); }, "live_set");
        opPlayApi.property = "is_playing";
    } catch (e) {}
    opApplyVisibility();
    for (var i = 0; i < 3; i++) {
        var ft = new Task(opBringFront, this);
        ft.schedule([400, 1500, 4000][i]);
        opFrontTasks.push(ft);
    }
    opStartPoll();
}

/** Live draws v8ui canvases over live.* boxes: bring every transparent control and click zone to the front. */
function opBringFront() {
    if (!opHost) return;
    try { var gv = opHost.getnamed("op_graph"); if (gv) opHost.bringtofront(gv); } catch (e) {}
    var names = [];
    for (var i = 0; i < OP_LAYOUT.length; i++) if (OP_LAYOUT[i].key && !opHidden[OP_LAYOUT[i].key]) names.push("op_" + OP_LAYOUT[i].key);
    for (i = 0; i < OP_UBUTTONS.length; i++) {
        try { var u = opHost.getnamed(OP_UBUTTONS[i]); if (u) opHost.bringtofront(u); } catch (e) {}
    }
    for (i = 0; i < names.length; i++) {
        try { var o = opHost.getnamed(names[i]); if (o) opHost.bringtofront(o); } catch (e) {}
    }
}

function opApplyVisibility() {
    if (!opHost) return;
    try {
        var gv = opHost.getnamed("op_graph");
        var gh = opSel() === 7 ? OP_GH_GLOBAL : OP_GH;
        if (gv && opGraphH !== gh) { gv.setattr("presentation_rect", OP_GX, OP_GY, OP_GW, gh); opGraphH = gh; }
    } catch (e) {}
    for (var i = 0; i < OP_LAYOUT.length; i++) {
        var it = OP_LAYOUT[i];
        if (!it.key) continue;
        var hide = !opItemVisible(it);
        if (opHidden[it.key] === hide) continue;
        opHidden[it.key] = hide;
        try {
            var o = opHost.getnamed("op_" + it.key);
            if (!o) continue;
            o.setattr("hidden", hide ? 1 : 0);
            if (!hide) opHost.bringtofront(o);
        } catch (e) {}
    }
}

/** From the ubuttons: click sel <i> | click view <0|1> | click slopes */
var opLastClick = "";
function click(what, arg) {
    what = String(what);
    opLastClick = what + " " + arg + " @" + (Date.now() % 100000);
    if (what === "sel") opSet("ui_section", Number(arg));
    else if (what === "view") { var k = opSecKey(opSel()); if (k) opSet("ui_view_" + k, Number(arg)); }
    else if (what === "slopes") {
        if (opSel() === 5) opSet("ui_slope_fe", opVals.ui_slope_fe > 0.5 ? 0 : 1);
        if (opSel() === 6) opSet("ui_slope_pe", opVals.ui_slope_pe > 0.5 ? 0 : 1);
    }
}

// ---------------- telemetry (both regions) ----------------
function opStartPoll() {
    if (opPoll) return;
    opPoll = new Task(opPollTel, this);
    opPoll.interval = 33;
    opPoll.repeat();
}
function opPollTel() {
    var b = opBuf(opNames.scope);
    if (!b) return;
    var h;
    try { h = b.peek(1, 0, 4); } catch (e) { return; }
    var act = Number(h[2]) || 0;
    if (!act && !opTel.active) return;
    opTel.active = act;
    var v = opAlloc.newest();
    if (!OP_IS_MAIN) v = opTelVoice;
    var a;
    try { a = b.peek(1, 8 + v * 16, 16); } catch (e) { return; }
    for (var e = 0; e < 7; e++) { opTel.lvl[e] = Number(a[e]); opTel.stage[e] = Number(a[7 + e]); }
    opTel.lfo = Number(a[14]);
    opTel.fc = Number(a[15]);
    if (OP_IS_MAIN && v !== opTelVoiceSent) { opTelVoiceSent = v; outlet(1, "telvoice", v); }
    if (!OP_IS_MAIN) mgraphics.redraw();
}
var opTelVoice = 0, opTelVoiceSent = -1;
function telvoice(v) { opTelVoice = Math.round(Number(v)) || 0; }

// ---------------- drawing ----------------
var OP_FS = 10.5;        // display labels / values (Operator: about 12 % larger than SPT_SIZE)
var OP_FS_SHELL = 10.8;  // shell labels
function opT(str, x, y, col, size, align) { var sz = size || OP_FS; sptText(str, x, y + sz * 0.37, col, sz, align || 0); }
function opRect(x, y, w, h, col) { sptRgba(col); mgraphics.rectangle(x, y, w, h); mgraphics.fill(); }
function opStroke(x, y, w, h, col, lw) { sptRgba(col); mgraphics.set_line_width(lw || 1); mgraphics.rectangle(x + 0.5, y + 0.5, w - 1, h - 1); mgraphics.stroke(); }

function opDial(it, on) {
    var p = OP_BY_KEY[it.key], v = opVals[it.key];
    var cx = it.x, cy = it.y, r = 8.5;
    var n = (v - p.min) / ((p.max - p.min) || 1);
    var a0 = Math.PI * 0.5, sweep = Math.PI * 1.5;
    var bip = p.min < 0 && p.max > 0;
    opT(it.label, it.lx - 1, it.ly, opShellText(), OP_FS_SHELL);
    mgraphics.set_line_width(2.5);
    sptRgba(sptMix(sptColor("live_control_bg"), [0, 0, 0, 1], 0.4));
    mgraphics.arc(cx, cy, r, a0, a0 + sweep);
    mgraphics.stroke();
    var s = bip ? a0 + sweep * ((0 - p.min) / (p.max - p.min)) : a0;
    var e = a0 + sweep * n;
    if (Math.abs(e - s) > 0.02) {
        sptRgba(on ? opCyan() : sptMix(opLabelCol(), sptColor("live_surface_bg"), 0.45));
        mgraphics.arc(cx, cy, r, Math.min(s, e), Math.max(s, e));
        mgraphics.stroke();
    }
    sptRgba(sptMix(sptColor("live_control_bg"), [0, 0, 0, 1], 0.5));
    mgraphics.set_line_width(1.5);
    mgraphics.move_to(cx, cy);
    mgraphics.line_to(cx + Math.cos(e) * (r + 0.5), cy + Math.sin(e) * (r + 0.5));
    mgraphics.stroke();
    opT(opFormat(p, v).replace("-inf", "-\u221e"), cx + 3, cy + 12, opShellText(), OP_FS);
}

var OP_WAVE_SHORT = ["Sin", "Sin4", "Sin8", "Sw3", "Sw4", "Sw6", "Sw8", "Sw16", "Sw32", "Sw64", "SwD", "Sq3", "Sq4", "Sq6", "Sq8", "Sq16",
    "Sq32", "Sq64", "SqD", "Tri", "NsL", "NsW", "Usr"];

function opMenuText(key, v) {
    var p = OP_BY_KEY[key], i = Math.round(v);
    if (/^osc_[abcd]_wave$/.test(key)) return OP_WAVE_SHORT[i] || "";
    if (key === "lfo_range") return ["L", "H", "S"][i] || "";
    if (key === "lfo_type") return ["Sine", "Square", "Triangle", "Saw Up", "Saw Down", "S&H", "Noise"][i] || p.items[i];
    return p.items[i] || "";
}

function opArrow(x, y, col) {
    sptRgba(col);
    mgraphics.move_to(x - 3, y - 1.5);
    mgraphics.line_to(x + 3, y - 1.5);
    mgraphics.line_to(x, y + 1.5);
    mgraphics.close_path();
    mgraphics.fill();
}

function opFilterIcon(x, y, w, h, t, col) {
    sptRgba(col);
    mgraphics.set_line_width(1.2);
    var m = y + h * 0.5;
    if (t === 0) { mgraphics.move_to(x, y + 2); mgraphics.line_to(x + w * 0.65, y + 2); mgraphics.line_to(x + w, y + h); }
    else if (t === 1) { mgraphics.move_to(x, y + h); mgraphics.line_to(x + w * 0.35, y + 2); mgraphics.line_to(x + w, y + 2); }
    else if (t === 2) { mgraphics.move_to(x, y + h); mgraphics.line_to(x + w * 0.5, y + 2); mgraphics.line_to(x + w, y + h); }
    else if (t === 3) { mgraphics.move_to(x, y + 2); mgraphics.line_to(x + w * 0.4, y + 2); mgraphics.line_to(x + w * 0.5, y + h); mgraphics.line_to(x + w * 0.6, y + 2); mgraphics.line_to(x + w, y + 2); }
    else { mgraphics.move_to(x, m); mgraphics.line_to(x + w * 0.3, y + 2); mgraphics.line_to(x + w * 0.7, y + h); mgraphics.line_to(x + w, m); }
    mgraphics.stroke();
}

function opMenu(it, on) {
    var v = opVals[it.key], st = it.style || "lcd";
    if (it.label) opT(it.label, it.lx, it.ly, opDisp(sptColor("live_lcd_title"), on), 9.5);
    if (st === "box" || st === "icon") {
        opRect(it.x, it.y, it.w, it.h, opDim(sptColor("live_control_bg"), on));
        opStroke(it.x, it.y, it.w, it.h, sptMix(sptColor("live_control_bg"), [0, 0, 0, 1], 0.4));
        if (st === "icon") opFilterIcon(it.x + 4, it.y + 2, it.w - 16, it.h - 4, Math.round(v), opDim(opLabelCol(), on));
        else opT(opMenuText(it.key, v), it.x + 3, it.y + it.h * 0.5, opDim(sptMix(opLabelCol(), [1, 1, 1, 1], 0.2), on), 9.5);
        opArrow(it.x + it.w - 6, it.y + it.h * 0.5, opDim(opLabelCol(), on));
        return;
    }
    var col = st === "lcdalt" ? opOrange() : opCyan();
    if (/^mx_/.test(it.key) && Math.round(v) === 0) col = opOrange();
    var c = opDisp(col, on);
    if (/^osc_[abcd]_repeat$/.test(it.key) && Math.round(opVals["osc_" + it.key.charAt(4) + "_wave"]) !== 22) c = sptColor("live_lcd_title");
    opT(opMenuText(it.key, v), it.x, it.y + 6, c, 9.5);
    opArrow(it.x + it.w - 5, it.y + 6, c);
}

function opToggle(it, on) {
    var v = opVals[it.key] > 0.5, st = it.style;
    var x = it.x, y = it.y, w = it.w, h = it.h;
    if (st === "square") {
        opRect(x, y, w, h, v ? opCyan() : sptMix(sptColor("live_control_bg"), [0, 0, 0, 1], 0.2));
        if (!v) opStroke(x, y, w, h, sptMix(sptColor("live_control_bg"), [0, 0, 0, 1], 0.5));
    } else if (st === "letter") {
        var k = "ABCD".indexOf(it.text), oc = OP_OSC_COL[k];
        opRect(x, y, w, h, v ? oc : sptColor("live_control_bg"));
        opStroke(x, y, w, h, v ? sptMix(oc, [0, 0, 0, 1], 0.35) : oc);
        opT(it.text, x + w * 0.5, y + h * 0.5, v ? [0.08, 0.08, 0.08, 1] : oc, 8.5, 1);
    } else if (st === "rbox") {
        var oc2 = opOrange();   // Operator keeps R / Q / G orange even while the section is switched off
        if (it.g === "shell") oc2 = v ? sptMix(opLabelCol(), sptColor("live_surface_bg"), 0.2) : sptMix(opLabelCol(), sptColor("live_surface_bg"), 0.5);
        if (v) { opRect(x, y, w, h, oc2); opT(it.text, x + w * 0.5, y + h * 0.5, [0.1, 0.1, 0.1, 1], 8, 1); }
        else { opStroke(x, y, w, h, oc2); opT(it.text, x + w * 0.5, y + h * 0.5, oc2, 8, 1); }
    } else if (st === "dbtn") {
        var dc = on ? opOrange() : opOff();
        if (v) { opRect(x, y, w, h, dc); opT(it.text, x + w * 0.5, y + h * 0.5, [0.1, 0.1, 0.1, 1], 7.5, 1); }
        else { opStroke(x, y, w, h, dc); opT(it.text, x + w * 0.5, y + h * 0.5, dc, 7.5, 1); }
    } else if (st === "fill") {
        if (v) opRect(x, y, w, h, opDisp(opOrange(), on));
        else opStroke(x, y, w, h, opDisp(opOrange(), on));
    }
}

function opTab(it, on) {
    var v = Math.round(opVals[it.key]), n = it.items.length, cw = [17, 18], x = it.x;
    for (var i = 0; i < n; i++) {
        var w = cw[i] || 18, sel = i === v;
        var xx = i === 0 ? it.x : it.x + 22;
        opRect(xx, it.y, w, it.h, sel ? opDim(sptColor("live_control_selection"), on) : sptColor("live_control_bg"));
        opT(it.items[i], xx + w * 0.5, it.y + it.h * 0.5, sel ? [0.1, 0.1, 0.1, 1] : opDim(opLabelCol(), on), 9.5, 1);
    }
    void x;
}

function opLcd(it, on) {
    var p = OP_BY_KEY[it.key], v = opVals[it.key];
    if (it.label) opT(it.label, it.lx, it.ly, opDisp(sptColor("live_lcd_title"), on), 9.5);
    var col = it.style === "alt" ? opOrange() : (it.style === "dim" ? sptColor("live_lcd_title") : opCyan());
    if (/^osc_[abcd]_(phase)$/.test(it.key) || /^[abcd]_freq_lt_vel$/.test(it.key)) col = opOrange();
    var dim = !on;
    if (/^osc_[abcd]_feedb$/.test(it.key)) {
        var k = "abcd".indexOf(it.key.charAt(4)), A = OP_ALGOS[Math.round(opVals.algorithm)], mod = false;
        for (var i = 0; i < A.e.length; i++) if (A.e[i][1] === k) mod = true;
        if (mod) dim = true;
    }
    if (/^osc_[abcd]_repeat$/.test(it.key) && Math.round(opVals["osc_" + it.key.charAt(4) + "_wave"]) !== 22) dim = true;
    if (/^mx_(\w+)_amt_(a|b)$/.test(it.key)) {
        var m = /^mx_(\w+)_amt_(a|b)$/.exec(it.key);
        if (Math.round(opVals["mx_" + m[1] + "_dst_" + m[2]]) === 0) dim = true;
    }
    var txt = opFormat(p, v).replace("-inf", "-∞");
    var vc = !on ? opOff() : (dim ? sptColor("live_lcd_title") : col);
    if (it.rlabel) opT(txt, it.x + it.w - 4, it.y, vc, 9.5, 2);
    else opT(txt, it.x, it.y, vc, 9.5);
}

function opPanels() {
    opRect(0, 0, 725, 169, opLighter());
    var sel = opSel();
    var rows = [3, 2, 1, 0];   // osc row r shows osc index 3 - r (D C B A)
    for (var r = 0; r < 4; r++) {
        var y = [0, 43, 86, 129][r];
        if (rows[r] !== sel) opRect(0, y, 210, 40, opSurface());
        if (4 + r !== sel) opRect(514, y, 210, 40, opSurface());
    }
    // the display, except the graph strip at its top: the graph v8ui paints that (painting it here covered it in Live)
    var gh = sel === 7 ? OP_GH_GLOBAL : OP_GH;
    opRect(215, gh, 294, 167 - gh, sptColor("live_lcd_bg"));
}

function opPeIcon(it, on) {
    var c = opDim(opLabelCol(), on);
    sptRgba(c);
    mgraphics.set_line_width(1);
    mgraphics.move_to(it.x, it.y + 6);
    mgraphics.line_to(it.x, it.y);
    mgraphics.line_to(it.x + 18, it.y);
    mgraphics.stroke();
}

function opAlgIcon(it) {
    var A = OP_ALGOS[Math.round(opVals.algorithm)];
    void A;
    for (var k = 3; k >= 0; k--) {
        var yy = it.y + (3 - k) * 8;
        opRect(it.x, yy, 5, 5, OP_OSC_COL[k]);
    }
}

function opWaveIcon(it, on) {
    var o = it.osc, w = Math.round(opVals["osc_" + "abcd"[o] + "_wave"]);
    var t = opFastTableCached(w, o);
    sptRgba(opDisp(opCyan(), on));
    mgraphics.set_line_width(1.5);
    for (var i = 0; i <= 40; i++) {
        var y = it.y + it.h * 0.5 - t[Math.floor(i / 40 * (OP_TBL - 1))] * it.h * 0.45;
        if (i === 0) mgraphics.move_to(it.x, y); else mgraphics.line_to(it.x + i * it.w / 40, y);
    }
    mgraphics.stroke();
}
var opIconCache = {};
function opFastTableCached(w, o) {
    var key = w + ":" + (w >= 22 ? o + ":" + opUser[o].join(",") : "");
    if (!opIconCache[key]) {
        if (!opSinTab) { opSinTab = []; for (var i = 0; i < OP_TBL; i++) opSinTab.push(Math.sin(2 * Math.PI * i / OP_TBL)); }
        opIconCache = {};
        opIconCache[key] = opFastTable(w, 0, 48000, opUser[o]);
    }
    return opIconCache[key];
}

function opHeaders() {
    var s = opSel();
    if (s === 7) {
        sptRgba(sptColor("live_lcd_frame"));
        mgraphics.rectangle(222, 23, 282, 1); mgraphics.fill();
        mgraphics.rectangle(222, 133, 282, 1); mgraphics.fill();
        return;
    }
    var on = opSectionOn(s);
    var v = opView(s);
    var right = ["Oscillator", "Oscillator", "Oscillator", "Oscillator", "LFO", "Filter", "Aux"][s];
    var hasView = s < 4 || s === 5;
    var tc = opDisp(sptColor("live_lcd_title"), on);
    var lc = sptColor("live_lcd_frame");
    // left: Envelope
    if (hasView) {
        if (v === 0) opRect(218, 62.5, 7, 7, opDisp(opCyan(), on)); else opStroke(218, 62.5, 7, 7, tc);
    }
    opT("Envelope", hasView ? 227.5 : 219.5, HEAD_Y, tc, 11.5);
    if (hasView) {
        if (v === 1) opRect(406.5, 62.5, 7, 7, opDisp(opCyan(), on)); else opStroke(406.5, 62.5, 7, 7, tc);
    }
    opT(right, hasView ? 416 : 408, HEAD_Y, tc, 11.5);
    opRect(219, 71, 183, 1, lc);
    opRect(407, 71, 98, 1, lc);
    if (s === 5 || s === 6) {
        var sl = s === 5 ? opVals.ui_slope_fe : opVals.ui_slope_pe;
        if (sl > 0.5) opRect(216.5, LBL_Y0 - 2.5, 4, 4, tc); else opStroke(216.5, LBL_Y0 - 2.5, 4, 4, tc);
    }
}
var HEAD_Y = 66.0, LBL_Y0 = 81.0;

function opDspPill() {
    if (opDsp.ready || !OP_IS_MAIN) return;
    var txt = opDsp.error ? "DSP failed: " + opDsp.error : "DSP loading...";
    var w = sptTextW(txt, 8.5) + 8;
    opRect(509 - w - 4, 150, w, 12, sptMix(sptColor("live_lcd_bg"), opOrange(), 0.25));
    opT(txt, 509 - w, 156, opDsp.error ? sptColor("live_alert") : opOrange(), 8.5);
}

function opPaintMain() {
    opPanels();
    var sel = opSel();
    for (var i = 0; i < OP_LAYOUT.length; i++) {
        var it = OP_LAYOUT[i];
        if (!opItemVisible(it)) continue;
        var secOn = it.g === "shell" ? opShellOn(it) : opSectionOn(sel);
        switch (it.t) {
            case "dial": opDial(it, secOn); break;
            case "lcd": opLcd(it, secOn); break;
            case "menu": opMenu(it, secOn); break;
            case "toggle": opToggle(it, secOn); break;
            case "tab": opTab(it, secOn); break;
            case "label": opT(it.label, it.lx - (it.g === "shell" ? 1 : 0), it.ly, it.g === "shell" ? opShellText() : opDisp(sptColor("live_lcd_title"), secOn), it.big ? 11.3 : (it.g === "shell" ? OP_FS_SHELL : OP_FS)); break;
            case "glabel": opT(it.label, it.lx, it.ly, sptColor("live_lcd_title"), OP_FS); break;
            case "peicon": opPeIcon(it, opVals.pe_on > 0.5); break;
            case "algicon": opAlgIcon(it); break;
            case "waveicon": opWaveIcon(it, secOn); break;
        }
    }
    opHeaders();
    opDspPill();
}

/** Shell dials dim with their section's on switch (LFO: Rate / Amount, Filter: Freq / Res, Pitch: Pitch Env); other shell controls do not. */
function opShellOn(it) {
    var k = it.key;
    if (it.t !== "dial" || !k) return true;
    if (k === "lfo_rate" || k === "lfo_sync" || k === "lfo_amt") return opVals.lfo_on > 0.5;
    if (k === "filter_freq" || k === "filter_res") return opVals.filter_on > 0.5;
    if (k === "pe_amount") return opVals.pe_on > 0.5;
    return true;
}

// ---------------- graph region ----------------
function opEnvTimes(s) {
    var px = opEnvPx(s);
    var at = opAttackMs(opNorm(OP_BY_KEY[px + "_attack"], opVals[px + "_attack"]));
    var dc = opDecayMs(opNorm(OP_BY_KEY[px + "_decay"], opVals[px + "_decay"]));
    var rl = opDecayMs(opNorm(OP_BY_KEY[px + "_release"], opVals[px + "_release"]));
    return [at, dc, rl];
}
/** Segment width as a fraction of the graph (fitted to Operator's display: 50 ms 0.05, 400 ms 0.165, 1 s 0.226). */
function opSegW(ms) { return 0.0721 * Math.log(1 + ms / 50); }

/** Envelope geometry in graph coordinates: points init, peak, decay end, sustain end, release end. */
function opEnvGeom(s) {
    var px = opEnvPx(s), T = opEnvTimes(s);
    var x0 = 8, x1 = OP_GW - 8, y0 = 6, y1 = OP_GH - 6;
    var W = x1 - x0, wa = opSegW(T[0]), wd = opSegW(T[1]), wr = opSegW(T[2]);
    var sc = Math.min(1, 0.95 / Math.max(wa + wd + 0.12 + wr, 0.01));
    var k = W * sc;
    var lv = function (suffix) {
        var key = px + "_" + suffix, p = OP_BY_KEY[key];
        if (!p) return 0;
        return (opVals[key] - p.min) / ((p.max - p.min) || 1);
    };
    var yv = function (n) { return y1 - n * (y1 - y0); };
    var xa = x0 + wa * k, xd = xa + wd * k, xs = Math.max(xd + 0.12 * k, x0 + 0.63 * W), xr = Math.min(x1, xs + wr * k);
    var end = OP_BY_KEY[px + "_end"] ? lv("end") : (s === 6 ? 0.5 : 0);
    return { px: px, x: [x0, xa, xd, xs, xr], y: [yv(lv("init")), yv(lv("peak")), yv(lv("sustain")), yv(lv("sustain")), yv(end)], k: k, x0: x0, y0: y0, y1: y1 };
}

function opSlopeF(u, s) {
    var kk = 6 * Math.abs(s) + 1e-6, dn = 1 - Math.exp(-kk);
    if (s > 0.0001) return (1 - Math.exp(-kk * u)) / dn;
    if (s < -0.0001) return 1 - (1 - Math.exp(-kk * (1 - u))) / dn;
    return u;
}

function opDrawEnv(s, on) {
    var G = opEnvGeom(s), px = G.px;
    var sl = function (k, d) { return OP_BY_KEY[px + "_" + k] ? opVals[px + "_" + k] : d; };
    var segs = [[0, 1, sl("a_slope", 0), 0], [1, 2, sl("d_slope", 1), 1], [2, 3, 0, 0], [3, 4, sl("r_slope", 1), 1]];
    var c = opDisp(sptColor("live_display_line_two"), on);
    // corner brackets
    var bc = opDisp(sptColor("live_lcd_title"), on);
    sptRgba(bc);
    mgraphics.set_line_width(1);
    var corners = [[OP_GW - 3, 3, -1, 1], [OP_GW - 3, OP_GH - 3, -1, -1]];
    for (var i = 0; i < 2; i++) {
        var q = corners[i];
        mgraphics.move_to(q[0] + q[2] * 6, q[1]); mgraphics.line_to(q[0], q[1]); mgraphics.line_to(q[0], q[1] + q[3] * 6);
        mgraphics.stroke();
    }
    sptRgba(c);
    mgraphics.set_line_width(1.5);
    mgraphics.move_to(G.x[0], G.y[0]);
    for (i = 0; i < segs.length; i++) {
        var a = segs[i][0], b = segs[i][1];
        for (var j = 1; j <= 24; j++) {
            var u = j / 24, f = segs[i][3] ? 1 - opSlopeF(u, segs[i][2]) : opSlopeF(u, segs[i][2]);
            var yy = segs[i][3] ? G.y[b] + (G.y[a] - G.y[b]) * f : G.y[a] + (G.y[b] - G.y[a]) * f;
            mgraphics.line_to(G.x[a] + (G.x[b] - G.x[a]) * u, yy);
        }
    }
    mgraphics.stroke();
    var hc = opDisp(sptColor("live_display_handle_one"), on);
    for (i = 0; i < 5; i++) {
        if (i === 3) continue;
        var hcol = (i === 4 && !OP_BY_KEY[px + "_end"]) ? sptColor("live_lcd_title") : hc;
        sptRgba(hcol);
        mgraphics.set_line_width(1);
        mgraphics.rectangle(G.x[i] - 2.5, G.y[i] - 2.5, 5, 5);
        mgraphics.stroke();
    }
    // playing position of the newest voice
    if (opTel.active && on) {
        var st = opTel.stage[s], stg = Math.floor(st), fr = st - stg;
        if (stg >= 1 && stg <= 4) {
            var xa = stg === 3 ? G.x[2] + (G.x[3] - G.x[2]) * 0.5 : G.x[stg - 1] + (G.x[stg === 4 ? 4 : stg] - G.x[stg === 4 ? 3 : stg - 1]) * fr;
            if (stg === 4) xa = G.x[3] + (G.x[4] - G.x[3]) * fr;
            var yy2 = opEnvLevelY(s, opTel.lvl[s], G);
            sptRgba(sptColor("live_display_handle_two"));
            mgraphics.arc(xa, yy2, 2.2, 0, Math.PI * 2);
            mgraphics.fill();
        }
    }
}
function opEnvLevelY(s, lvl, G) {
    var n;
    if (s === 6) n = (lvl + 48) / 96;
    else if (s === 5) n = lvl;
    else {
        var db = lvl > 1e-7 ? 20 * Math.log(lvl) / Math.LN10 : -999;
        var p = OP_BY_KEY[opEnvPx(s) + "_peak"], t = p.table, i;
        n = 0;
        for (i = 0; i < t.length - 1; i++) if (db >= t[i] && db <= t[i + 1]) { n = (i + (db - t[i]) / ((t[i + 1] - t[i]) || 1)) / (t.length - 1); break; }
        if (db > t[t.length - 1]) n = 1;
    }
    return G.y1 - Math.max(0, Math.min(1, n)) * (G.y1 - G.y0);
}

function opDrawHarmonics(o, on) {
    var w = Math.round(opVals["osc_" + "abcd"[o] + "_wave"]);
    var h = w === 22 ? opUser[o] : (opWaveHarmonics(w) || [0, 1]);
    var N = opUserN[o], bx = 6, bw = (OP_GW - 40) / N;
    var bc = opDisp(sptColor("live_lcd_title"), on);
    for (var n = 1; n <= N; n++) {
        var a = Math.abs(h[n] || 0) / (w === 22 ? 1 : (h[1] || 1));
        var hh = Math.min(1, a) * (OP_GH - 8);
        opRect(bx + (n - 1) * bw, OP_GH - 4 - hh, Math.max(1, bw - 1), hh, a > 0 ? opDisp(opCyan(), on) : bc);
        if (a <= 0) opRect(bx + (n - 1) * bw, OP_GH - 5, Math.max(1, bw - 1), 1, bc);
    }
    var labs = [16, 32, 64];
    for (var i = 0; i < 3; i++) {
        var yy = 20 + i * 11, sel = labs[i] === N;
        if (sel) opRect(OP_GW - 26, yy, 18, 9, bc); else opStroke(OP_GW - 26, yy, 18, 9, bc);
        opT(String(labs[i]), OP_GW - 17, yy + 4.5, sel ? sptColor("live_lcd_bg") : bc, 7.5, 1);
    }
}

/** Magnitude response (dB) of the current filter at frequency f (approximation of the SVF, used for display only). */
function opFilterDb(f) {
    var fc = opFilterHz(opNorm(OP_BY_KEY.filter_freq, opVals.filter_freq));
    var res = opVals.filter_res;
    var lq = res < 0.5 ? -0.693 + res * 2.25 : (res < 0.9 ? 0.432 + (res - 0.5) * 1.15 : (res < 1 ? 0.892 + (res - 0.9) * 4.16 : 1.308 + (res - 1) * 7.65));
    var k = 1 / Math.exp(lq);
    var t = Math.round(opVals.filter_type), w = f / fc, ns = opVals.filter_slope > 0.5 ? 2 : 1;
    var re = 1 - w * w, im = k * w, den = Math.sqrt(re * re + im * im);
    var lp = 1 / den, hp = w * w / den, bp = k * w / den, nt = Math.abs(1 - w * w) / den;
    var m = opVals.filter_morph * 4, seg = Math.min(Math.floor(m), 3), fr = m - seg;
    var arr = [lp, bp, hp, nt, lp];
    var g = t === 0 ? lp : (t === 1 ? hp : (t === 2 ? bp : (t === 3 ? nt : arr[seg] + (arr[seg + 1] - arr[seg]) * fr)));
    return 20 * Math.log(Math.max(Math.pow(g, ns), 1e-6)) / Math.LN10;
}

function opDrawFilter(on) {
    var gc = sptColor("live_lcd_frame"), x0 = 6, x1 = OP_GW - 6;
    var fx = function (f) { return x0 + (Math.log(f / 20) / Math.log(1000)) * (x1 - x0); };
    var dy = function (d) { return 8 + (24 - Math.max(-36, Math.min(24, d))) / 60 * (OP_GH - 16); };
    var fs = [100, 1000, 10000];
    for (var i = 0; i < fs.length; i++) {
        opRect(fx(fs[i]), 2, 1, OP_GH - 4, gc);
        opT(["100", "1k", "10k"][i], fx(fs[i]) + 2, OP_GH - 8, sptColor("live_display_scale_text"), 8);
    }
    for (var d = -24; d <= 12; d += 12) opRect(x0, dy(d), x1 - x0, 1, gc);
    sptRgba(opDisp(sptColor("live_display_line_two"), on));
    mgraphics.set_line_width(1.5);
    for (i = 0; i <= 120; i++) {
        var f = 20 * Math.pow(1000, i / 120), y = dy(opFilterDb(f));
        if (i === 0) mgraphics.move_to(fx(f), y); else mgraphics.line_to(fx(f), y);
    }
    mgraphics.stroke();
    var fc = opFilterHz(opNorm(OP_BY_KEY.filter_freq, opVals.filter_freq));
    var hy = dy(Math.min(24, opFilterDb(fc)));
    sptRgba(opDisp(sptColor("live_display_handle_one"), on));
    mgraphics.set_line_width(1.5);
    mgraphics.arc(fx(fc), hy, 4, 0, Math.PI * 2);
    mgraphics.stroke();
    void opFilterXY;
}
var opFilterXY = null;

// algorithm thumbnails: [x, y] of A, B, C, D squares per algorithm in graph px (measured from Operator's Global display)
var OP_ALG_POS = [
    [[21.8, 20.9], [21.8, 14.5], [21.8, 8.3], [21.8, 2.0]],
    [[39.0, 17.8], [39.0, 11.5], [35.0, 5.3], [43.0, 5.3]],
    [[59.8, 17.8], [55.8, 11.5], [55.8, 5.3], [63.8, 11.5]],
    [[80.8, 17.8], [76.8, 11.5], [84.8, 11.5], [80.8, 5.3]],
    [[105.8, 17.8], [98.0, 17.8], [101.8, 11.5], [101.8, 5.3]],
    [[118.8, 17.8], [126.8, 17.8], [126.8, 11.5], [126.8, 5.3]],
    [[147.8, 14.5], [139.8, 8.3], [147.8, 8.3], [155.8, 8.3]],
    [[168.8, 14.5], [168.8, 8.3], [176.8, 14.5], [176.8, 8.3]],
    [[189.7, 14.5], [198.0, 14.5], [205.8, 14.5], [198.0, 8.3]],
    [[218.8, 14.5], [226.8, 14.5], [235.0, 14.5], [235.0, 8.3]],
    [[247.8, 11.5], [255.8, 11.5], [263.8, 11.5], [271.8, 11.5]]
];

function opDrawAlgos() {
    var sel = Math.round(opVals.algorithm);
    for (var a = 0; a < 11; a++) {
        var P = OP_ALG_POS[a], s = a === sel ? 5 : 4;
        if (a === sel) {
            sptRgba(sptColor("live_lcd_title"));
            mgraphics.set_line_width(1);
            var E = OP_ALGOS[a].e;
            for (var i = 0; i < E.length; i++) {
                mgraphics.move_to(P[E[i][0]][0], P[E[i][0]][1]);
                mgraphics.line_to(P[E[i][1]][0], P[E[i][1]][1]);
                mgraphics.stroke();
            }
        }
        for (var k = 0; k < 4; k++) {
            var x = P[k][0] - s * 0.5, y = P[k][1] - s * 0.5;
            if (a === sel) opRect(x, y, s, s, OP_OSC_COL[k]);
            else { opRect(x, y, s, s, sptColor("live_lcd_bg")); opStroke(x, y, s, s, OP_OSC_COL[k]); }
        }
    }
}

function opPaintGraph() {
    opRect(0, 0, OP_GW, OP_GH, sptColor("live_lcd_bg"));
    var s = opSel(), on = opSectionOn(s);
    if (s === 7) { opDrawAlgos(); return; }
    if (s < 4 && opView(s) === 1) { opDrawHarmonics(s, on); return; }
    if (s === 5 && opView(s) === 1) { opDrawFilter(on); return; }
    opDrawEnv(s, on);
}

function paint() {
    if (OP_IS_MAIN) opPaintMain(); else opPaintGraph();
}

// ---------------- graph interaction ----------------
function opHit(x, y) {
    var s = opSel();
    if (s === 7) {
        var best = -1, bd = 1e9;
        for (var a = 0; a < 11; a++) {
            var P = OP_ALG_POS[a];
            for (var k = 0; k < 4; k++) {
                var d = Math.abs(P[k][0] - x) + Math.abs(P[k][1] - y);
                if (d < bd) { bd = d; best = a; }
            }
        }
        return bd < 12 ? { kind: "alg", a: best } : null;
    }
    if (s < 4 && opView(s) === 1) {
        if (x > OP_GW - 28) {
            var i = Math.floor((y - 20) / 11);
            return i >= 0 && i < 3 ? { kind: "hn", n: [16, 32, 64][i] } : null;
        }
        return { kind: "harm", o: s };
    }
    if (s === 5 && opView(s) === 1) return { kind: "filt" };
    var G = opEnvGeom(s), bi = -1, bdd = 9;
    for (var j = 0; j < 5; j++) {
        if (j === 3) continue;
        var dd = Math.max(Math.abs(G.x[j] - x), Math.abs(G.y[j] - y));
        if (dd < bdd) { bdd = dd; bi = j; }
    }
    return bi >= 0 ? { kind: "env", s: s, h: bi, G: G } : null;
}

function opEnvSetLevel(px, suffix, y, G) {
    var key = px + "_" + suffix, p = OP_BY_KEY[key];
    if (!p) return;
    var n = Math.max(0, Math.min(1, (G.y1 - y) / (G.y1 - G.y0)));
    opSet(key, p.min + n * (p.max - p.min));
}
/** Inverse of opSegW for a segment width in px -> time ms -> parameter value. */
function opEnvSetTime(px, suffix, wpx, G) {
    var key = px + "_" + suffix, p = OP_BY_KEY[key];
    var ms = Math.max(0, (Math.exp(Math.max(0, wpx) / G.k / 0.0721) - 1) * 50);
    var lo = suffix === "attack" ? 0.1 : 1, span = suffix === "attack" ? 200000 : 60000;
    var n = ms <= lo ? 0 : Math.log(ms / lo) / Math.log(span);
    opSet(key, p.min + Math.max(0, Math.min(1, n)) * (p.max - p.min));
}

function onclick(x, y, but, cmd, shift) {
    if (OP_IS_MAIN) return;
    var h = opHit(x, y);
    opDrag = h;
    if (!h) return;
    if (h.kind === "alg") { opSet("algorithm", h.a); opDrag = null; return; }
    if (h.kind === "hn") { opUserN[opSel()] = h.n; opSendUser(opSel()); mgraphics.redraw(); opDrag = null; return; }
    ondrag(x, y, 1, cmd, shift);
}

function ondrag(x, y, but, cmd, shift) {
    if (OP_IS_MAIN || !opDrag) return;
    if (!but) { opDrag = null; return; }
    var h = opDrag;
    if (h.kind === "harm") {
        var o = h.o, N = opUserN[o], bw = (OP_GW - 40) / N, n = Math.floor((x - 6) / bw) + 1;
        if (n < 1 || n > N) return;
        var w = Math.round(opVals["osc_" + "abcd"[o] + "_wave"]);
        if (w !== 22) {
            var src = opWaveHarmonics(w) || [0, 1], u = [0];
            for (var i = 1; i <= 64; i++) u[i] = Math.min(1, Math.abs(src[i] || 0) / (src[1] || 1));
            opUser[o] = u;
            opSet("osc_" + "abcd"[o] + "_wave", 22);
        }
        opUser[o][n] = Math.max(0, Math.min(1, (OP_GH - 4 - y) / (OP_GH - 8)));
        opSendUser(o);
        mgraphics.redraw();
        return;
    }
    if (h.kind === "filt") {
        var f = 20 * Math.pow(1000, Math.max(0, Math.min(1, (x - 6) / (OP_GW - 12))));
        opSet("filter_freq", Math.log(Math.max(30, f) / 30) / Math.log(18500 / 30));
        opSet("filter_res", Math.max(0, Math.min(1.25, (OP_GH - 8 - y) / (OP_GH - 16) * 1.25)));
        return;
    }
    if (h.kind === "env") {
        var G = h.G, px = opEnvPx(h.s);
        if (h.h === 0) opEnvSetLevel(px, "init", y, G);
        else if (h.h === 1) { opEnvSetTime(px, "attack", x - G.x[0], G); opEnvSetLevel(px, "peak", y, G); }
        else if (h.h === 2) { opEnvSetTime(px, "decay", x - G.x[1], G); opEnvSetLevel(px, "sustain", y, G); }
        else if (h.h === 4) { opEnvSetTime(px, "release", x - G.x[3], G); if (OP_BY_KEY[px + "_end"]) opEnvSetLevel(px, "end", y, G); }
    }
}

function ondblclick(x, y) {
    if (OP_IS_MAIN) return;
    var h = opHit(x, y);
    if (h && h.kind === "harm") {
        var o = h.o, N = opUserN[o], n = Math.floor((x - 6) / ((OP_GW - 40) / N)) + 1;
        if (opUser[o][n] !== undefined) { opUser[o][n] = opUser[o][n] > 0 ? 0 : 1; opSendUser(o); mgraphics.redraw(); }
    }
}

// ---------------- preview (scripts/render_preview.py) ----------------
function preview() {
    if (typeof OP_PREVIEW_SECTION !== "undefined") opVals.ui_section = OP_PREVIEW_SECTION;
    if (typeof OP_PREVIEW_VIEW !== "undefined") { var k = opSecKey(opSel()); if (k) opVals["ui_view_" + k] = OP_PREVIEW_VIEW; }
    opDsp.ready = 1;
    mgraphics.redraw();
}

sptThemeWatch(function () { mgraphics.redraw(); });
