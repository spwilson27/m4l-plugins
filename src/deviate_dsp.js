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
// The Spectral split stage lives in a second gen~ (dv_spec, 2 in / 2 out) that is created together with the main gen as a silent stub and
// hot-loaded with `setattr gen` the first time Split Mode becomes Spectral (AGENTS 1d.5: never add or remove a gen~ in a running device).
// state 0 = stub, 1 = loading, 2 = running, 3 = failed.
var dvSpec = { state: 0, createdAt: 0, counter0: -1, task: null, error: "", done: null };
var DV_SPEC_TIMEOUT_MS = 6000;
var DV_SPEC_POLL_MS = 100;
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

function dvDspWriteFile(path, text) {
    var body = text === undefined ? GEN_DSP_TEXT : text;
    try {
        var rf = new File(path, "read");
        var have = rf.isopen && rf.eof === body.length;
        rf.close();
        if (have) return true;
    } catch (_) {}
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) return false;
    f.eof = 0;
    for (var i = 0; i < body.length; i += 16384) f.writestring(body.substring(i, i + 16384));
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
            dvSpecShell(g, pin);
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
        dvRemoveGens();
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
    dvRemoveGens();
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

function dvRemoveGens() {
    ["dv_gen", "dv_spec"].forEach(function (name) {
        try {
            var old = dvHost.getnamed(name);
            if (old) dvHost.remove(old);
        } catch (_) {}
    });
    dvSpec.state = 0;
    dvSpec.createdAt = 0;
    dvSpec.counter0 = -1;
    dvSpec.error = "";
    // the new shell is a silent stub again: back to Envelope until the stage is loaded (dvDevChanged asks for Spectral again)
    if (typeof dvSplitEff !== "undefined" && dvSplitEff === 1) {
        dvSplitEff = 0;
        dvApplyLatency(dvLatency(0));
    }
}

// The Spectral shell: a stub gen~ (outputs zero) between dv_plugin and the main gen's inlets 3 / 4; the real stage is loaded into it later.
function dvSpecShell(mainGen, pin) {
    if (typeof GEN_SPEC_STUB === "undefined" || typeof DV_SPEC_STAGE === "undefined" || !DV_SPEC_STAGE) return;
    try {
        var path = "/tmp/" + DV_PREFIX + "_specstub_" + GEN_SPEC_STUB_HASH + ".gendsp";
        if (!dvDspWriteFile(path, GEN_SPEC_STUB)) throw new Error("cannot write " + path);
        var sp = dvHost.newdefault(160, 120, "gen~", "@gen", path);
        if (!sp) throw new Error("no spec gen~");
        sp.varname = "dv_spec";
        var hub = dvHost.getnamed("dv_specin");
        if (!hub) throw new Error("missing dv_specin");
        dvHost.connect(hub, 0, sp, 0);
        dvHost.connect(pin, 0, sp, 0);
        dvHost.connect(pin, 1, sp, 1);
        dvHost.connect(sp, 0, mainGen, 2);
        dvHost.connect(sp, 1, mainGen, 3);
        dvTrace("spec-shell", "stub created");
    } catch (err) {
        dvSpec.state = 3;
        dvSpec.error = String(err && err.message ? err.message : err);
        dvTrace("spec-error", dvSpec.error);
    }
}

// Hot-load the Spectral stage into the shell; calls `done(ok)` when its alive counter moves (or on failure / timeout).
function dvSpecLoad(done) {
    if (dvSpec.state === 2) { if (done) done(true); return; }
    if (dvSpec.state === 3 || !dvHost || typeof GEN_SPEC_TEXT === "undefined") { if (done) done(false); return; }
    dvSpec.done = done || dvSpec.done;
    if (dvSpec.state === 1) return;
    try {
        var sp = dvHost.getnamed("dv_spec");
        if (!sp) throw new Error("no spec shell");
        var path = "/tmp/" + DV_PREFIX + "_spec_" + GEN_SPEC_HASH + ".gendsp";
        if (!dvDspWriteFile(path, GEN_SPEC_TEXT)) throw new Error("cannot write " + path);
        dvSpec.counter0 = dvSpecAlive();
        sp.setattr("gen", path);
        dvSpec.state = 1;
        dvSpec.createdAt = Date.now();
        dvTrace("spec-load", "alive " + dvSpec.counter0);
        dvSpecPoll();
    } catch (err) {
        dvSpec.state = 3;
        dvSpec.error = String(err && err.message ? err.message : err);
        dvTrace("spec-error", dvSpec.error);
        dvSpecFinish(false);
    }
}

function dvSpecFinish(ok) {
    var cb = dvSpec.done;
    dvSpec.done = null;
    if (cb) cb(ok);
}

function dvSpecPoll() {
    if (dvSpec.state !== 1) return;
    var c = dvSpecAlive();
    if (c >= 0 && c !== dvSpec.counter0) {
        dvSpec.state = 2;
        dvTrace("spec", "ready after " + (Date.now() - dvSpec.createdAt) + " ms");
        dvSpecFinish(true);
        return;
    }
    if (Date.now() - dvSpec.createdAt > DV_SPEC_TIMEOUT_MS) {
        dvSpec.state = 3;
        dvSpec.error = "spec stage not running";
        dvTrace("spec-error", dvSpec.error);
        dvSpecFinish(false);
        return;
    }
    // the gen drops messages while it compiles: bind its telemetry buffer again on every poll
    if (typeof dvSpecBind === "function") dvSpecBind();
    if (!dvSpec.task) dvSpec.task = new Task(dvSpecPoll, this);
    dvSpec.task.schedule(DV_SPEC_POLL_MS);
}
