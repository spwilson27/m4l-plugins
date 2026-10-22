// Reverb+ (Start) deferred DSP: the device ships without its gen~, so Live shows the face at once
// (AGENTS.md 1d). One Task tick after live.thisdevice (init_link) the face writes the embedded gen
// patch (GEN_DSP_TEXT, injected by scripts/build_reverbplus.py) to a .gendsp file named by its hash,
// creates `gen~ @gen <file>` and wires it: the rp_genin hub (gate 1 1, every gen-bound message) ->
// gen, dp_plugin -> gen -> dp_plugout. Until then plugin~ goes straight to plugout~ (dry passes, so
// the chain keeps sounding while the gen loads); those two cords are removed once the gen is wired.
// The gen drops messages while it compiles, so the face re-sends the buffer binding and every gen
// parameter (from the values it holds, RP_GEN_PARAMS) every 150 ms until the gen's frame counter
// (scope FRAMES) moves, then twice more. The header shows "DSP loading…" / "DSP failed" meanwhile.

var rpHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var rpDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null };
var RP_DSP_CONFIRM_MS = 150;
var RP_DSP_SETTLE_MS = 300;
var RP_DSP_TIMEOUT_MS = 10000;

// Load trace for scripts/test_reverbplus_live.js: Global("reverbplus_trace").text, one line per event,
// stamped with ms since the script loaded.
var rpTraceT0 = Date.now();
function rpTrace(tag, msg) {
    try {
        var g = new Global("reverbplus_trace");
        var line = "+" + (Date.now() - rpTraceT0) + " " + tag + (msg ? " " + msg : "");
        var lines = (g.text ? String(g.text).split("\n") : []).concat([line]);
        g.text = lines.slice(-60).join("\n");
    } catch (_) {}
}

function rpDspPath() {
    return "/tmp/reverbplus_start_" + GEN_DSP_HASH + ".gendsp";
}

/** @param {string} path */
function rpDspWriteFile(path) {
    try {
        var rf = new File(path, "read");
        var have = rf.isopen && rf.eof === GEN_DSP_TEXT.length;
        rf.close();
        if (have) return true;
    } catch (_) {}
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) return false;
    f.eof = 0;
    for (var i = 0; i < GEN_DSP_TEXT.length; i += 16384) f.writestring(GEN_DSP_TEXT.substring(i, i + 16384));
    f.close();
    return true;
}

function rpDspFrames() {
    if (!rpOwnNames.scope) return -1;
    try {
        var v = new Buffer(rpOwnNames.scope).peek(1, RP_SCOPE.FRAMES, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (_) {
        return -1;
    }
}

// Buffer binding and every gen parameter, from the values the face holds (rpRaw: the raw parameter
// values as they arrived through set_<key>).
function rpDspResend() {
    if (rpOwnNames.xfer) outlet(0, "xfer", rpOwnNames.xfer);
    if (rpOwnNames.hdr) outlet(0, "hdr", rpOwnNames.hdr);
    if (rpOwnNames.scope) outlet(0, "scope", rpOwnNames.scope);
    if (rpOwnNames.spec) outlet(0, "spec", rpOwnNames.spec);
    if (rpOwnNames.irspec) outlet(0, "irs", rpOwnNames.irspec);
    for (var key in RP_GEN_PARAMS) {
        if (!(key in rpRaw)) continue;
        var g = RP_GEN_PARAMS[key];
        outlet(0, g[0], rpRaw[key] / g[1]);
    }
}

function rpDspLoad() {
    if (rpDsp.ready || rpDsp.createdAt || !rpHost || typeof GEN_DSP_TEXT === "undefined") return;
    rpTrace("dsp-start", "creating gen~");
    try {
        var g = rpHost.getnamed("rp_gen");
        if (!g) {
            var path = rpDspPath();
            if (!rpDspWriteFile(path)) throw new Error("cannot write " + path);
            g = rpHost.newdefault(20, 120, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "rp_gen";
            var hub = rpHost.getnamed("rp_genin");
            var pin = rpHost.getnamed("rp_plugin");
            var pout = rpHost.getnamed("rp_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            rpHost.connect(hub, 0, g, 0);
            rpHost.connect(pin, 0, g, 0);
            rpHost.connect(pin, 1, g, 1);
            rpHost.connect(g, 0, pout, 0);
            rpHost.connect(g, 1, pout, 1);
            rpHost.disconnect(pin, 0, pout, 0);
            rpHost.disconnect(pin, 1, pout, 1);
        }
        rpDsp.createdAt = Date.now();
        rpDsp.counter0 = rpDspFrames();
        rpTrace("dsp-created", "frames " + rpDsp.counter0);
        rpDspConfirm();
    } catch (err) {
        rpDsp.error = String(err && err.message ? err.message : err);
        rpTrace("dsp-error", rpDsp.error);
        post("Reverb+: DSP load failed: " + rpDsp.error + "\n");
    }
    rpBroadcastDsp();
}

function rpDspConfirm() {
    var c = rpDspFrames();
    if (rpDsp.counter0 >= 0 && c >= 0 && c !== rpDsp.counter0) {
        rpDsp.ready = 1;
        rpDsp.error = "";
        rpTrace("dsp", "ready after " + (Date.now() - rpDsp.createdAt) + " ms");
        // the last re-send may have reached the gen while it was still compiling: once more now, and
        // again when it has settled
        rpDspResend();
        if (!rpDsp.settleTask) rpDsp.settleTask = new Task(rpDspResend, this);
        rpDsp.settleTask.schedule(RP_DSP_SETTLE_MS);
        rpBroadcastDsp();
        return;
    }
    if (Date.now() - rpDsp.createdAt > RP_DSP_TIMEOUT_MS) {
        rpDsp.error = "not running";
        rpTrace("dsp-error", rpDsp.error + " (frames " + rpDsp.counter0 + " / " + c + ")");
        rpBroadcastDsp();
        return;
    }
    rpDspResend();
    if (rpDsp.counter0 < 0) rpDsp.counter0 = c;
    if (!rpDsp.confirmTask) rpDsp.confirmTask = new Task(rpDspConfirm, this);
    rpDsp.confirmTask.schedule(RP_DSP_CONFIRM_MS);
}

// From init_link (live.thisdevice): let the face paint first, then build the DSP.
function rpDspSchedule() {
    if (rpDsp.ready || rpDsp.createdAt) return;
    if (!rpDsp.task) rpDsp.task = new Task(rpDspLoad, this);
    rpDsp.task.schedule(30);
}

// Faces show the pill: `state dsp <ready 0|1> <error text or ->` on the state bus (outlet 1).
function rpBroadcastDsp() {
    outlet(1, "state", "dsp", rpDsp.ready ? 1 : 0, rpDsp.error ? rpDsp.error.replace(/\s+/g, "_") : "-");
}
// Tell a face that comes up later (or a new one): called from `bang`.
function rpDspState() {
    return rpDsp.ready || typeof GEN_DSP_TEXT === "undefined" ? null : { error: rpDsp.error };
}
