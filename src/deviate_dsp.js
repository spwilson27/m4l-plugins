// deviate_dsp.js: deferred DSP for Deviate (AGENTS.md 1d; a fork of src/spectral_dsp.js with Deviate names, no rack).
// The device ships WITHOUT its gen~: Live shows the face at once. One Task tick after live.thisdevice (init_dsp) the engine writes the embedded gen
// patch (GEN_DSP_TEXT, GEN_DSP_HASH and DV_PREFIX are injected by scripts/build_deviate.py) to /tmp/<prefix>_core_<hash>.gendsp, creates
// `gen~ @gen <file>` (scripting name dv_gen) and wires it: the dv_genin hub (gate 1 1, every gen-bound message goes into its data inlet) -> gen,
// dv_plugin -> gen -> dv_plugout. File-backed identical gen~ share ONE compile. Until the gen runs the device outputs SILENCE (there is no
// dv_plugin -> dv_plugout cord); the faces show `DSP loading...` / `DSP failed: <reason>` (state bus, dvDspPill).
// The gen drops messages while it compiles, so dvDevResend() (defined by the engine: buffer bindings, every gen parameter, the split mode) runs every
// 150 ms until the gen's ALIVE counter (DV_SCOPE.ALIVE, moves also in silence) moves, then once more at once and 300 ms later.
// One instance creates its gen~ at a time (Global deviate_dspq) and a gen~ that never starts is removed and created again (twice): the first gen~
// of a Live process sometimes never joins the DSP chain (measured for Reverb+). Load trace: Global("deviate_trace").text, one line per event
// (`+<ms since script load> deviate <tag> <message> [#<LOM id> @<epoch ms mod 1e6>]`).
// Hooks supplied by the engine: dvDevResend(), dvGenAlive() (-1 when unknown), dvDevChanged().

var dvHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var dvDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null, retries: 0, restarts: 0 };
var DV_DSP_RETRIES = 2;
var DV_DSP_CLAIM_MS = 15000;
var DV_DSP_QUEUE_POLL_MS = 100;
var DV_DSP_CONFIRM_MS = 150;
var DV_DSP_SETTLE_MS = 300;
var DV_DSP_FIRST_TIMEOUT_MS = 3500;
var DV_DSP_TIMEOUT_MS = 6000;
var dvDspToken = Math.random();
var dvTraceT0 = Date.now();
var dvTraceId = "";

function dvDspTimeout() {
    return dvDsp.retries === 0 ? DV_DSP_FIRST_TIMEOUT_MS : DV_DSP_TIMEOUT_MS;
}

function dvTrace(tag, msg) {
    try {
        var g = new Global("deviate_trace");
        var line = "+" + (Date.now() - dvTraceT0) + " " + DV_PREFIX + " " + tag + (msg ? " " + msg : "") + " [#" + dvTraceId + " @" + (Date.now() % 1000000) + "]";
        var lines = (g.text ? String(g.text).split("\n") : []).concat([line]);
        g.text = lines.slice(-80).join("\n");
    } catch (_) {}
}

function dvDspPath() {
    return "/tmp/" + DV_PREFIX + "_core_" + GEN_DSP_HASH + ".gendsp";
}

function dvDspWriteFile(path) {
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

// Only one instance creates its gen~ at a time; a claim older than DV_DSP_CLAIM_MS is stale.
function dvDspClaim() {
    var q = new Global("deviate_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== dvDspToken && now - Number(q.t) < DV_DSP_CLAIM_MS) return false;
    q.owner = dvDspToken;
    q.t = now;
    return true;
}
function dvDspRelease() {
    var q = new Global("deviate_dspq");
    if (q.owner === dvDspToken) q.owner = 0;
}

function dvDspNotify() {
    if (typeof dvDevChanged === "function") dvDevChanged();
}

// Kept so faces can call it from onInfo. It never connects ss_plugin to ss_plugout: deferral is silence
// inside a rack and outside one, until dvDspLoad wires ss_plugin -> gen -> ss_plugout.
function dvDspDry(on) {}

function dvDspLoad() {
    if (dvDsp.ready || dvDsp.createdAt || !dvHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!dvDspClaim()) {
        if (!dvDsp.task) dvDsp.task = new Task(dvDspLoad, this);
        dvDsp.task.schedule(DV_DSP_QUEUE_POLL_MS);
        return;
    }
    dvTrace("dsp-start", "creating gen~" + (dvDsp.retries ? " (retry " + dvDsp.retries + ")" : ""));
    try {
        var g = dvHost.getnamed("dv_gen");
        if (!g) {
            var path = dvDspPath();
            if (!dvDspWriteFile(path)) throw new Error("cannot write " + path);
            g = dvHost.newdefault(20, 120, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "dv_gen";
            var hub = dvHost.getnamed("dv_genin");
            var pin = dvHost.getnamed("dv_plugin");
            var pout = dvHost.getnamed("dv_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            dvHost.connect(hub, 0, g, 0);
            dvHost.connect(pin, 0, g, 0);
            dvHost.connect(pin, 1, g, 1);
            dvHost.connect(g, 0, pout, 0);
            dvHost.connect(g, 1, pout, 1);
        }
        dvDsp.createdAt = Date.now();
        dvDsp.counter0 = dvGenAlive();
        dvTrace("dsp-created", "alive " + dvDsp.counter0);
        dvDspConfirm();
    } catch (err) {
        dvDsp.error = String(err && err.message ? err.message : err);
        dvDspRelease();
        dvTrace("dsp-error", dvDsp.error);
        post(DV_PREFIX + ": DSP load failed: " + dvDsp.error + "\n");
    }
    dvDspNotify();
}

function dvDspConfirm() {
    var c = dvGenAlive();
    if (dvDsp.counter0 >= 0 && c >= 0 && c !== dvDsp.counter0) {
        dvDsp.ready = 1;
        dvDsp.error = "";
        dvTrace("dsp", "ready after " + (Date.now() - dvDsp.createdAt) + " ms");
        dvDspRelease();
        // the last re-send may have reached the gen while it was still compiling: once more now, and again when it has settled
        dvDevResend();
        if (!dvDsp.settleTask) dvDsp.settleTask = new Task(dvDevResend, this);
        dvDsp.settleTask.schedule(DV_DSP_SETTLE_MS);
        dvDspNotify();
        return;
    }
    if (Date.now() - dvDsp.createdAt > dvDspTimeout() && dvDsp.retries < DV_DSP_RETRIES) {
        // the gen~ was never added to the DSP chain: build a new one
        dvDsp.retries++;
        dvTrace("dsp-retry", "gen~ alive counter stayed " + c);
        try {
            var old = dvHost.getnamed("dv_gen");
            if (old) dvHost.remove(old);
        } catch (_) {}
        dvDsp.createdAt = 0;
        dvDsp.counter0 = -1;
        dvDspLoad();
        return;
    }
    if (Date.now() - dvDsp.createdAt > dvDspTimeout()) {
        dvDsp.error = "not running";
        dvDspRelease();
        dvTrace("dsp-error", dvDsp.error + " (alive " + dvDsp.counter0 + " / " + c + ")");
        dvDspNotify();
        return;
    }
    dvDevResend();
    if (dvDsp.counter0 < 0) dvDsp.counter0 = c;
    if (!dvDsp.confirmTask) dvDsp.confirmTask = new Task(dvDspConfirm, this);
    dvDsp.confirmTask.schedule(DV_DSP_CONFIRM_MS);
}

// From init_link (live.thisdevice): let the face paint first, then build the DSP.
function dvDspSchedule(id) {
    if (id) dvTraceId = id;
    if (dvDsp.ready || dvDsp.createdAt) return;
    if (!dvDsp.task) dvDsp.task = new Task(dvDspLoad, this);
    dvDsp.task.schedule(30);
}

// Test hook / recovery: remove the running gen~ and build a new one (a late start: new sample counter, state and framing).
function dvDspRestart() {
    if (!dvHost) return;
    dvDsp.restarts++;
    try {
        var old = dvHost.getnamed("dv_gen");
        if (old) dvHost.remove(old);
    } catch (_) {}
    dvDsp.ready = 0;
    dvDsp.createdAt = 0;
    dvDsp.counter0 = -1;
    dvDsp.retries = 0;
    dvTrace("dsp-restart", "#" + dvDsp.restarts);
    dvDspNotify();
    dvDspSchedule();
}

// Header pill text for the face ("" when the DSP runs).
function dvDspPill() {
    if (dvDsp.ready) return "";
    if (dvDsp.error) return "DSP failed: " + (dvDsp.error.length > 22 ? dvDsp.error.substring(0, 21) + "..." : dvDsp.error);
    return "DSP loading...";
}
