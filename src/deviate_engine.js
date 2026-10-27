// Deviate engine: the non-visual v8ui every face is built around. Build order (scripts/build_deviate.py):
//   GEN_DSP_TEXT / GEN_DSP_HASH, constants (DV_FACE, DV_ROLE, DV_GEN_PARAMS, DV_PANEL_THEME, DV_VARNAMES, DV_SPEC_STAGE),
//   deviate_config.js, deviate_ir.js, deviate_dsp.js, this file.
//
// It owns everything that is not drawing: the parameter store, the deferred gen~ (deviate_dsp.js), the latency attribute, the
// MIDI trigger counter and the MIDI From chooser, the IR bank generation, the state blob (DeviateStateData), the state bus the
// faces listen to, panel colours and the test hook.
//
// Inlet 0 messages:
//   set_<key> <value>   every parameter (prepend set_<key> from each live.* object)
//   names <scope> <ctl> <ir> <spec> <hook> <state>   the `---` buffer / receive / send names of this instance (from loadbang)
//   init_dsp            from live.thisdevice (the LOM is ready): DSP start, MIDI routing, hook registration
//   midi_note <pitch> [vel]   a note-on from stripnote: one MIDI-source hit (velocity and pitch are ignored)
//   settype <i>         the MIDI From menu
//   cmd hit | ui <ints...>   commands from a face: a manual hit; the face's saved UI integers
//   bang                re-broadcast the state (a face that comes up late)
//   test_report | test_hit | test_reroll | test_set <key> <v>   the test hook (receive ---deviatetest, see below)
// Outlets: 0 gen hub (messages for the gen~), 1 state bus (`state ...` -> s ---dvstate), 2 MIDI From menu
//   (`_parameter_range ...` / `setsymbol ..`), 3 `<key> <value>` -> route -> the real live.* object (test_set, reroll).
// State bus (all messages prefixed `state`):
//   state dsp <ready 0|1> <error|->
//   state midi <routing name|->
//   state ui <ints...>        the face's saved integers (Deviate blob section "UI")
// Test hook: Live does not expand `#0` in a top-level device and the static check forbids a literal `receive #0-...`, so the hook is
//   `r ---deviatetest`, whose expanded per-instance name the patcher passes in `names`. The engine publishes
//   Global("deviate_hooks").map = JSON {LOM device id: hook name}; the bridge sends messnamed(<hook name>, "test_hit") etc.
//   test_report writes Global("deviate_test").report_<LOM id> (JSON).

inlets = 1;
outlets = 4;

/** raw parameter values as they arrived (the deferred DSP re-sends the gen-bound ones) @type {{ [key: string]: number }} */
var dvRaw = {};
var dvNames = { scope: "", ctl: "", ir: "", spec: "", test: "", state: "" };
var dvPatcher = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var dvSelfId = "";
var dvInitDone = false;
var dvSplitEff = 0;
var dvMtrig = 0;
var dvHitsSent = 0;
var dvMidi = { type: "", hits: 0, available: [] };
/** the draw state restored from the blob / last seen in telemetry @type {{valid: number, reroll: number, T: number[], E: number[]} | null} */
var dvRestored = null;
/** tagged trailing blob sections, kept so presets interchange across faces @type {Array<{tag: string, face: string, vals: number[]}>} */
var dvSections = [];
var dvCtlGen = 0;
var dvBuildTag = "";

function dvTrimName(s) {
    return String(s === undefined ? "" : s);
}

// ---- parameters ----------------------------------------------------------------------------------------------------
function anything() {
    var name = messagename;
    if (!name || name.indexOf("set_") !== 0) return;
    var key = name.substring(4);
    // Spike S1 (e): the Button-mode live.text outputs a bare `bang` (not 1 / 0) when pressed, and nothing when set to 0 through the LOM
    if (key === "reroll") {
        if (!arguments.length || String(arguments[0]) === "bang" || Number(arguments[0]) > 0.5) dvOnReroll(1);
        return;
    }
    var v = arguments.length ? Number(arguments[0]) : 0;
    if (!isFinite(v)) return;
    dvRaw[key] = v;
    if (key === "split") dvOnSplit(v);
}

// Reroll: the Button-mode live.text sends a bare `bang` per press (a gen Param can neither hold nor see that: Spike S1 (e) counted
// nothing). So the engine owns the gen's dvreroll: every press becomes 0, then 1 after 25 ms, then 0 after 100 ms, a clean rising edge.
var dvRrBusy = false, dvRrPending = 0, dvRrTasks = [];
var dvRrCalls = 0, dvRrSent = [];
function dvOnReroll(v) {
    dvRrCalls++;
    if (!(v > 0.5)) return;
    if (dvRrBusy) { dvRrPending++; return; }
    dvRrBusy = true;
    outlet(0, "dvreroll", 0);
    var steps = [[25, 1], [100, 0]];
    steps.forEach(function (st, i) {
        var t = new Task(function () {
            outlet(0, "dvreroll", st[1]);
            dvRrSent.push(st[1]);
            if (i === steps.length - 1) {
                dvRrBusy = false;
                if (dvRrPending > 0) { dvRrPending--; dvOnReroll(1); }
            }
        }, this);
        t.schedule(st[0]);
        dvRrTasks.push(t);
    });
}

function names(scopeName, ctlName, irName, specName, testName, stateName) {
    dvNames.scope = dvTrimName(scopeName);
    dvNames.ctl = dvTrimName(ctlName);
    dvNames.ir = dvTrimName(irName);
    dvNames.spec = dvTrimName(specName);
    dvNames.test = dvTrimName(testName);
    dvNames.state = dvTrimName(stateName);
    dvRegisterHook();
    if (dvPendingCtl) dvWriteCtl(dvPendingCtl);
}

// ---- gen resend list (called by deviate_dsp.js until the gen runs, then twice more) ------------------------------------
function dvDevResend() {
    if (!dvNames.scope) return;
    outlet(0, "scope", dvNames.scope);
    outlet(0, "ctl", dvNames.ctl);
    outlet(0, "ir", dvNames.ir);
    outlet(0, "spec", dvNames.spec);
    for (var key in DV_GEN_PARAMS) {
        if (!(key in dvRaw)) continue;
        var g = DV_GEN_PARAMS[key];
        outlet(0, g[0], dvRaw[key] / g[1]);
    }
    outlet(0, "dvsplit", dvSplitEff);
    outlet(0, "dvmtrig", dvMtrig);
    if (!dvRrBusy) outlet(0, "dvreroll", 0);   // the gen takes the first value as its baseline
    if (dvSpec.state === 1 || dvSpec.state === 2) dvSpecBind();
}

// The Spectral stage's gen~ has its own message hub: `specmsg` messages are routed to it by the patcher.
function dvSpecBind() {
    if (dvNames.scope) outlet(0, "specmsg", "scope", dvNames.scope);
}

function dvSpecAlive() {
    try {
        if (!dvNames.scope) return -1;
        var v = new Buffer(dvNames.scope).peek(1, DV_SCOPE.SPEC_ALIVE, 1);
        var n = typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
        return isFinite(n) ? n : -1;
    } catch (e) {
        return -1;
    }
}

function dvGenAlive() {
    try {
        if (!dvNames.scope) return -1;
        var v = new Buffer(dvNames.scope).peek(1, DV_SCOPE.ALIVE, 1);
        var n = typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
        return isFinite(n) ? n : -1;
    } catch (e) {
        return -1;
    }
}

function dvDevChanged() {
    dvBroadcastDsp();
    if (dvDsp.ready) {
        dvIrStartSoon();
        dvStatePollStart();
        if (dvSplitWant && dvSplitEff !== 1) dvOnSplit(1); // Spectral was asked for before the DSP was up
    }
}

// Live only calls getvalueof() (to save a Set or duplicate a track) after notifyclients(): without it the blob it keeps is the
// initial one. Spike S1 (a): a duplicate_track clone got an empty draw state. So the engine polls the draw serial / reroll counter
// (300 ms, a Task that costs one 2-float peek) and notifies when either moved.
var dvStateTask = null;
var dvStateKey = -1;
function dvStatePollStart() {
    if (dvStateTask || typeof Task === "undefined") return;
    dvStateTask = new Task(dvStatePoll, this);
    dvStateTask.interval = 300;
    dvStateTask.repeat();
}

function dvStatePoll() {
    try {
        if (!dvNames.scope || !dvDsp.ready) return;
        var b = new Buffer(dvNames.scope);
        var ser = Number(b.peek(1, DV_SCOPE.DRAW_SERIAL, 1)), rr = Number(b.peek(1, DV_SCOPE.REROLL, 1));
        if (!isFinite(ser) || !isFinite(rr)) return;
        var key = ser * 65536 + rr;
        if (key !== dvStateKey) {
            var first = dvStateKey < 0;
            dvStateKey = key;
            if (!first && typeof notifyclients === "function") notifyclients();
        }
    } catch (e) {}
}

function dvDevSr() {
    try {
        if (!dvNames.scope) return 0;
        var v = new Buffer(dvNames.scope).peek(1, DV_SCOPE.SR, 1);
        var sr = typeof v === "number" ? v : (v && v.length ? Number(v[0]) : 0);
        return sr > 8000 ? sr : 0;
    } catch (e) {
        return 0;
    }
}

// ---- state bus ------------------------------------------------------------------------------------------------------
function dvBroadcastDsp() {
    outlet(1, "state", "dsp", dvDsp.ready ? 1 : 0, dvDsp.error ? String(dvDsp.error).replace(/\s+/g, "_") : "-");
}

function dvBroadcastMidi() {
    outlet(1, "state", "midi", dvMidi.type ? String(dvMidi.type).replace(/\s+/g, "_") : "-");
}

function dvBroadcastUi() {
    var vals = dvUiVals();
    outlet(1, "state", "ui", ...vals);
}

function dvUiVals() {
    for (var i = 0; i < dvSections.length; i++) if (dvSections[i].tag === "UI" && dvSections[i].face === DV_FACE) return dvSections[i].vals.slice();
    return [];
}

var dvInitTasks = [];
function bang() {
    dvBroadcastDsp();
    dvBroadcastMidi();
    dvBroadcastUi();
}

// ---- init ----------------------------------------------------------------------------------------------------------
function init_dsp() {
    if (dvInitDone) {
        dvDspSchedule(dvSelfId);
        return;
    }
    dvInitDone = true;
    try {
        if (typeof LiveAPI !== "undefined") {
            var api = new LiveAPI(function () {}, "this_device");
            dvSelfId = String(api.id);
        }
    } catch (e) {
        dvSelfId = "";
    }
    dvRegisterHook();
    dvMidiInit();
    dvApplyPanelTheme();
    dvDspSchedule(dvSelfId);
    [400, 1500, 4000].forEach(function (ms) {
        var t = new Task(dvFrontControls, this);
        t.schedule(ms);
        dvInitTasks.push(t);
    });
    [100, 700, 2500].forEach(function (ms) {
        var t = new Task(bang, this);
        t.schedule(ms);
        dvInitTasks.push(t);
    });
}

// Spike S1 (b): Live loads the canvases (v8ui) in front of the live.* widgets whatever their order in the saved file, so a canvas
// under widgets hid them. Bringing every live.* box (not comments / lines) to the front after load puts them back on top, in their
// saved relative order. Run a few times: Live finishes loading the patcher asynchronously.
var dvFrontN = 0;
function dvFrontControls() {
    try {
        if (!dvPatcher || typeof dvPatcher.bringtofront !== "function") return;
        var b = dvPatcher.firstobject, n = 0, list = [];
        while (b) {
            var mc = String(b.maxclass);
            if (mc.indexOf("live.") === 0 && mc !== "live.comment" && mc !== "live.line" && mc !== "live.thisdevice") list.push(b);
            b = b.nextobject;
        }
        for (var i = 0; i < list.length; i++) { dvPatcher.bringtofront(list[i]); n++; }
        dvFrontN = n;
    } catch (e) {
        dvFrontN = -1;
    }
}

function dvRegisterHook() {
    if (!dvSelfId || !dvNames.test) return;
    try {
        var g = new Global("deviate_hooks");
        var map = {};
        try { map = g.map ? JSON.parse(String(g.map)) : {}; } catch (e) { map = {}; }
        map[dvSelfId] = dvNames.test;
        g.map = JSON.stringify(map);
    } catch (e2) {}
}

// ---- latency / split -----------------------------------------------------------------------------------------------
function dvApplyLatency(samples) {
    try {
        if (dvPatcher) dvPatcher.setattr("latency", samples);
    } catch (e) {}
}

// Split Mode. Back to Envelope is immediate. To Spectral the stage is hot-loaded into its shell first (once); when its alive counter has moved
// the latency attribute and the gen's dvsplit change in the same tick (the gen fades its output over 256 samples around the tap move).
// Without a running DSP / spec shell the change waits (dvDevChanged) or, with no Spectral stage in the build, is immediate.
var dvSplitWant = 0;
function dvOnSplit(v) {
    var want = v > 0.5 ? 1 : 0;
    dvSplitWant = want;
    if (want === dvSplitEff) return;
    if (!want) { dvSetSplit(0); return; }
    if (typeof DV_SPEC_STAGE === "undefined" || !DV_SPEC_STAGE) { dvSetSplit(1); return; }
    if (!dvDsp.ready) return;
    dvSpecLoad(function (ok) {
        if (ok && dvSplitWant) dvSetSplit(1);
    });
}

function dvSetSplit(mode) {
    dvSplitEff = mode;
    dvApplyLatency(dvLatency(mode));
    outlet(0, "dvsplit", mode);
}

// ---- MIDI ------------------------------------------------------------------------------------------------------------
var DV_MIDI_IN = "this_device midi_inputs 0";
var dvMidiTypes = null, dvMidiType = null;

// LiveAPI hands dictionary properties back as ["{json}"], [property, <Dict>] or [property, object].
function dvLomValue(raw, key) {
    var v = raw;
    if (Array.isArray(v)) v = v.length > 1 ? v[1] : v[0];
    if (v && typeof v === "object" && typeof v.stringify === "function") v = v.stringify();
    if (typeof v === "string") {
        try { v = JSON.parse(v); } catch (err) { return null; }
    }
    return v && typeof v === "object" && key in v ? v[key] : null;
}

function dvMenuRange(items, empty) {
    if (!items || !items.length) return [empty, "-"];
    var ns = items.map(function (t) { return String(t.display_name); });
    return ns.length === 1 ? [ns[0], "-"] : ns;
}

function dvMidiInit() {
    if (typeof LiveAPI === "undefined" || dvMidiTypes) return;
    try {
        dvMidiTypes = new LiveAPI(function (args) {
            var types = dvLomValue(args, "available_routing_types");
            if (!types) return;
            dvMidi.available = types.map(function (t) { return String(t.display_name); });
            outlet(2, ["_parameter_range"].concat(dvMenuRange(types, "No Input")));
            if (dvMidiType) dvOnMidiType(dvMidiType.get("routing_type"));
        }, DV_MIDI_IN);
        dvMidiTypes.property = "available_routing_types";
        dvMidiType = new LiveAPI(dvOnMidiType, DV_MIDI_IN);
        dvMidiType.property = "routing_type";
    } catch (e) {
        post("Deviate: MIDI From routing unavailable: " + e + "\n");
    }
}

function dvOnMidiType(args) {
    var t = dvLomValue(args, "routing_type");
    if (t && t.display_name !== undefined) {
        dvMidi.type = String(t.display_name);
        outlet(2, ["setsymbol", dvMidi.type]);
        dvBroadcastMidi();
    }
}

function settype(i) {
    if (!dvMidiTypes || !dvMidiType) return;
    var types = dvLomValue(dvMidiTypes.get("available_routing_types"), "available_routing_types");
    var idx = Math.round(Number(i) || 0);
    if (types && types[idx]) dvMidiType.set("routing_type", types[idx]);
}

/** A note-on (stripnote): one hit from MIDI. Velocity and pitch are ignored. */
function midi_note() {
    dvMidi.hits++;
    dvTriggerHit();
}

/** The gen sees a changed dvmtrig counter as a MIDI-source hit. */
function dvTriggerHit() {
    dvMtrig = (dvMtrig + 1) % 100000;
    dvHitsSent++;
    outlet(0, "dvmtrig", dvMtrig);
}

function cmd(name) {
    var n = String(name);
    if (n === "hit") dvTriggerHit();
    else if (n === "ui") {
        var vals = [];
        for (var i = 1; i < arguments.length && vals.length < 64; i++) vals.push(Math.round(Number(arguments[i]) || 0));
        dvSetUiVals(vals);
    }
}

function dvSetUiVals(vals) {
    var found = false;
    for (var i = 0; i < dvSections.length; i++) {
        if (dvSections[i].tag === "UI" && dvSections[i].face === DV_FACE) { dvSections[i].vals = vals; found = true; }
    }
    if (!found) dvSections.push({ tag: "UI", face: DV_FACE, vals: vals });
    dvBroadcastUi();
    if (typeof notifyclients === "function") notifyclients();
}

// ---- state blob (DeviateStateData) ---------------------------------------------------------------------------------------
// The gen owns the draw state; the blob is read from its telemetry when Live saves. Before the gen has run it is whatever was restored.
function dvLiveState() {
    var st = dvRestored ? { valid: dvRestored.valid, reroll: dvRestored.reroll, T: dvRestored.T.slice(), E: dvRestored.E.slice() }
        : { valid: 0, reroll: 0, T: [0, 0, 0, 0, 0, 0, 0, 0], E: [0, 0, 0, 0, 0, 0, 0, 0] };
    try {
        if (dvNames.scope && dvGenAlive() > 0) {
            var s = new Buffer(dvNames.scope).peek(1, 0, 64);
            if (s && s.length >= 32 && s[DV_SCOPE.DRAW_SERIAL] > 0) {
                st.valid = 1;
                st.reroll = Math.max(0, Math.floor(s[DV_SCOPE.REROLL]));
                for (var i = 0; i < 8; i++) {
                    st.E[i] = dvClamp(Number(s[DV_SCOPE.METAS + i]) || 0, 0, 100);
                    st.T[i] = dvClamp(Number(s[DV_SCOPE.DRAWS + i]) || 0, 0, 100);
                }
            }
        }
    } catch (e) {}
    return st;
}

function getvalueof() {
    return dvBlobEncode(dvLiveState(), dvSections);
}

function setvalueof() {
    var arr = Array.prototype.slice.call(arguments);
    var dec = dvBlobDecode(arr);
    if (!dec) {
        dvRestored = null;
        dvSections = [];
        return;
    }
    dvRestored = { valid: dec.valid, reroll: dec.reroll, T: dec.T, E: dec.E };
    dvSections = dec.sections;
    dvWriteCtl(dec);
    dvBroadcastUi();
}

// Restore the gen's draw state: slots first, the generation LAST (the gen applies a new generation).
var dvPendingCtl = null;
function dvWriteCtl(dec) {
    try {
        if (!dvNames.ctl) {
            dvPendingCtl = dec; // the blob can be restored before `names` has told us the buffer name
            return;
        }
        dvPendingCtl = null;
        var b = new Buffer(dvNames.ctl);
        var a = [];
        var i;
        for (i = 0; i < 8; i++) a.push(dec.T[i]);
        for (i = 0; i < 8; i++) a.push(dec.E[i]);
        b.poke(1, DV_CTL.FLAGS, [dec.valid ? 1 : 0, dec.reroll, 0].concat(a));
        dvCtlGen = (dvCtlGen % 100000) + 1;
        b.poke(1, DV_CTL.GEN, [dvCtlGen]);
    } catch (e) {}
}

// ---- IR bank (built on a Task after the GUI and the gen are up; the spectra are written in small pieces) ---------------------
var dvIr = { sr: 0, builder: null, task: null, chunks: null, pos: 0, ver: 0, ready: 0, startTask: null, tries: 0 };

function dvIrStartSoon() {
    if (dvIr.ready || dvIr.builder || dvIr.startTask) return;
    dvIr.startTask = new Task(dvIrStart, this);
    dvIr.startTask.schedule(400);
}

function dvIrStart() {
    dvIr.startTask = null;
    if (dvIr.ready || dvIr.builder) return;
    var sr = dvDevSr();
    if (!sr) {
        if (++dvIr.tries < 40) dvIrStartSoon();
        return;
    }
    dvIr.sr = sr;
    dvIr.builder = dvIrBuilder(sr);
    dvIr.chunks = null;
    dvIr.pos = 0;
    dvIr.task = new Task(dvIrWork, this);
    dvIr.task.interval = 8;
    dvIr.task.repeat();
}

function dvIrWork() {
    var b = dvIr.builder;
    if (!b) {
        if (dvIr.task) dvIr.task.cancel();
        return;
    }
    var t0 = Date.now();
    if (!b.done()) {
        while (Date.now() - t0 < 6 && !b.done()) b.step(1);
        return;
    }
    if (!dvIr.chunks) {
        dvIr.chunks = b.chunks();
        dvIr.pos = 0;
    }
    try {
        var buf = new Buffer(dvNames.ir);
        while (Date.now() - t0 < 5 && dvIr.pos < dvIr.chunks.length) {
            var c = dvIr.chunks[dvIr.pos];
            if (dvIr.pos === dvIr.chunks.length - 1) {
                // the header goes last: version bumped, ready set
                c.data[DV_IR.VER] = ++dvIr.ver;
                c.data[DV_IR.READY] = 1;
            }
            buf.poke(1, c.offset, Array.prototype.slice.call(c.data));
            dvIr.pos++;
        }
    } catch (e) {
        post("Deviate: IR bank write failed: " + e + "\n");
        dvIr.task.cancel();
        dvIr.builder = null;
        return;
    }
    if (dvIr.pos >= dvIr.chunks.length) {
        dvIr.task.cancel();
        dvIr.ready = 1;
        dvIr.builder = null;
        dvIr.chunks = null;
        dvTrace("ir", "bank ready at " + dvIr.sr + " Hz");
    }
}

// ---- panel colours ----------------------------------------------------------------------------------------------------
// A face lists its background panels in panel_theme ([[box id, Live theme colour name, fallback rgba]]). They are coloured from
// max.getcolor on load and when the theme changes (attribute bindings on panels do not repaint in Live).
function dvThemeColor(name, fallback) {
    try {
        if (typeof max !== "undefined" && max && typeof max.getcolor === "function") {
            var c = max.getcolor(name);
            if (c && c.length >= 3) return [Number(c[0]), Number(c[1]), Number(c[2]), c.length > 3 ? Number(c[3]) : 1];
        }
    } catch (e) {}
    return fallback;
}

var dvThemeKey = "";
var dvThemeTask = null;

function dvApplyPanelTheme() {
    if (!dvPatcher || typeof DV_PANEL_THEME === "undefined" || !DV_PANEL_THEME.length) return;
    var key = "";
    for (var i = 0; i < DV_PANEL_THEME.length; i++) {
        var e = DV_PANEL_THEME[i];
        var c = dvThemeColor(e[1], e[2]);
        key += c.join(",") + ";";
        try {
            var o = dvPatcher.getnamed(e[0]);
            if (!o) continue;
            o.setattr("bgfillcolor", c[0], c[1], c[2], c[3]);
            o.setattr("bgcolor", c[0], c[1], c[2], c[3]);
            o.setattr("bordercolor", c[0], c[1], c[2], c[3]);
        } catch (err) {}
    }
    dvThemeKey = key;
    if (!dvThemeTask) {
        dvThemeTask = new Task(function () {
            var k = "";
            for (var j = 0; j < DV_PANEL_THEME.length; j++) k += dvThemeColor(DV_PANEL_THEME[j][1], DV_PANEL_THEME[j][2]).join(",") + ";";
            if (k !== dvThemeKey) dvApplyPanelTheme();
        }, this);
        dvThemeTask.interval = 1000;
        dvThemeTask.repeat();
    }
}

// ---- test hook (receive ---deviatetest; scripts/test_deviate_live.js) -----------------------------------------------------------
//   test_report            Global("deviate_test").report_<LOM id> = JSON of the engine / device state
//   test_blob              Global("deviate_test").blob_<LOM id> = getvalueof() and the restored state
//   test_hit               one hit as if a MIDI note arrived (dvmtrig counter)
//   test_reroll            press and release the Reroll button through the real object
//   test_set <key> <v>     set a parameter through its real live.* object (undo / automation / echo as for a user)
function test_report() {
    var g = new Global("deviate_test");
    var scope = null;
    try { scope = dvNames.scope ? new Buffer(dvNames.scope).peek(1, 0, 160) : null; } catch (e) { scope = null; }
    var hidden = null;
    try { hidden = dvNames.scope ? new Buffer(dvNames.scope).peek(1, DV_SCOPE.HIDDEN, DV_HIDDEN_COUNT) : null; } catch (e2) { hidden = null; }
    var geom = { canvases: [] };
    try {
        if (dvPatcher) {
            geom.latencyAttr = Number(dvPatcher.getattr("latency"));
            geom.devicewidth = Number(dvPatcher.getattr("devicewidth"));
            var pr = dvPatcher.getattr("openrect");
            geom.openrect = pr ? Array.prototype.slice.call(pr) : null;
        }
    } catch (e3) { geom.err = String(e3); }
    g["report_" + dvSelfId] = JSON.stringify({
        id: dvSelfId, face: DV_FACE, dsp: dvDsp.ready, dspError: dvDsp.error, split: dvSplitEff, latencyWanted: dvLatency(dvSplitEff),
        geom: geom, raw: dvRaw, hook: dvNames.test, mtrig: dvMtrig, hitsSent: dvHitsSent, midi: dvMidi,
        ir: { ready: dvIr.ready, ver: dvIr.ver, sr: dvIr.sr }, alive: dvGenAlive(),
        scope: scope ? Array.prototype.slice.call(scope) : null, hidden: hidden ? Array.prototype.slice.call(hidden) : null,
        ctlGen: dvCtlGen, frontN: dvFrontN, rr: { calls: dvRrCalls, sent: dvRrSent.slice(-8), busy: dvRrBusy }, restored: dvRestored, sections: dvSections.length,
    });
}

/** Spike S1 (a): the state blob exactly as Live would save it (getvalueof), plus what setvalueof restored. */
function test_blob() {
    var g = new Global("deviate_test");
    var b = null;
    try { b = Array.prototype.slice.call(getvalueof()); } catch (e) { b = ["err " + e]; }
    g["blob_" + dvSelfId] = JSON.stringify({ blob: b, restored: dvRestored, sections: dvSections.length, ctlGen: dvCtlGen });
}

function test_front() {
    dvFrontControls();
}

function test_hit() {
    dvTriggerHit();
}

function test_reroll() {
    outlet(3, "reroll", 1);
    var t = new Task(function () { outlet(3, "reroll", 0); }, this);
    t.schedule(60);
}

function test_set(key, value) {
    var k = String(key);
    if (!(k in DV_PARAM_INDEX)) return;
    var v = Number(value);
    if (!isFinite(v)) return;
    outlet(3, k, v);
}

