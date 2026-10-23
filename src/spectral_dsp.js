// spectral_dsp.js — deferred DSP for the Spectral Split suite (AGENTS.md 1d, modelled on src/reverbplus_dsp.js).
// A device that adopts it ships WITHOUT its gen~: Live shows the face at once. One Task tick after live.thisdevice (init_link) the face writes the
// embedded gen patch (GEN_DSP_TEXT, injected by the build together with GEN_DSP_HASH and SS_PREFIX) to /tmp/<prefix>_core_<hash>.gendsp, creates
// `gen~ @gen <file>` (named ss_gen) and wires it: the ss_genin hub (gate 1 1, every gen-bound message goes into its data inlet) -> gen,
// ss_plugin -> gen -> ss_plugout. File-backed identical gen~ objects share ONE compile (AGENTS.md 1d), so a rack of K instances compiles once.
// Until the gen runs the device outputs SILENCE in every situation (no ss_plugin -> ss_plugout cord). A dry pass-through would make a rack of
// K chains K times too loud and the audio would jump when the delayed wet arrives; a lone instance stays silent for the same reason the user
// asked for: nothing is heard until ss_plugin -> gen -> ss_plugout is wired. The header pill shows `DSP loading...` / `DSP failed: <reason>`
// meanwhile (ssDsp.ready / ssDsp.error).
//
// The gen drops messages while it compiles, so the face re-sends the buffer bindings and every gen parameter every 150 ms until the gen's alive
// counter moves, then once more at once and again 300 ms later. The device supplies:
//   ssDevResend()          emit every gen-bound message from the values the face holds (buffer names, parameters, outsel, rack messages)
//   ssGenAlive()           the gen's alive counter read from its own telemetry buffer (-1 when unknown)
//   ssDevChanged()         optional: redraw
// Only one instance creates its gen~ at a time (Global spectral_split_dspq): when several gen~ are created within a second of each other one of
// them may never join the DSP chain (measured for Reverb+ in Live), and the very first gen~ of a Live process sometimes does not either, so a gen~
// whose counter has not moved after SS_DSP_FIRST_TIMEOUT_MS is removed and created again (twice).
// Load trace: Global("spectral_split_trace").text, one line per event (`+<ms since script load> <tag> <message> [#<id> @<epoch ms mod 1e6>]`).
// Test hook: ssDspRestart() (message dsp_restart <chain>) removes the gen~ and creates it again, a late start with a new sample counter.

var ssHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var ssDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null, retries: 0, restarts: 0 };
var SS_DSP_RETRIES = 2;
var SS_DSP_CLAIM_MS = 15000;
var SS_DSP_QUEUE_POLL_MS = 100;
var SS_DSP_CONFIRM_MS = 150;
var SS_DSP_SETTLE_MS = 300;
var SS_DSP_FIRST_TIMEOUT_MS = 3500;
var SS_DSP_TIMEOUT_MS = 6000;
var ssDspToken = Math.random();
var ssTraceT0 = Date.now();
var ssTraceId = "";

function ssDspTimeout() {
    return ssDsp.retries === 0 ? SS_DSP_FIRST_TIMEOUT_MS : SS_DSP_TIMEOUT_MS;
}

function ssTrace(tag, msg) {
    try {
        var g = new Global("spectral_split_trace");
        var line = "+" + (Date.now() - ssTraceT0) + " " + SS_PREFIX + " " + tag + (msg ? " " + msg : "") + " [#" + ssTraceId + " @" + (Date.now() % 1000000) + "]";
        var lines = (g.text ? String(g.text).split("\n") : []).concat([line]);
        g.text = lines.slice(-80).join("\n");
    } catch (_) {}
}

function ssDspPath() {
    return "/tmp/" + SS_PREFIX + "_core_" + GEN_DSP_HASH + ".gendsp";
}

function ssDspWriteFile(path) {
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

// Only one instance creates its gen~ at a time; a claim older than SS_DSP_CLAIM_MS is stale.
function ssDspClaim() {
    var q = new Global("spectral_split_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== ssDspToken && now - Number(q.t) < SS_DSP_CLAIM_MS) return false;
    q.owner = ssDspToken;
    q.t = now;
    return true;
}
function ssDspRelease() {
    var q = new Global("spectral_split_dspq");
    if (q.owner === ssDspToken) q.owner = 0;
}

function ssDspNotify() {
    if (typeof ssDevChanged === "function") ssDevChanged();
}

// Kept so faces can call it from onInfo. It never connects ss_plugin to ss_plugout: deferral is silence
// inside a rack and outside one, until ssDspLoad wires ss_plugin -> gen -> ss_plugout.
function ssDspDry(on) {}

function ssDspLoad() {
    if (ssDsp.ready || ssDsp.createdAt || !ssHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!ssDspClaim()) {
        if (!ssDsp.task) ssDsp.task = new Task(ssDspLoad, this);
        ssDsp.task.schedule(SS_DSP_QUEUE_POLL_MS);
        return;
    }
    ssTrace("dsp-start", "creating gen~" + (ssDsp.retries ? " (retry " + ssDsp.retries + ")" : ""));
    try {
        var g = ssHost.getnamed("ss_gen");
        if (!g) {
            var path = ssDspPath();
            if (!ssDspWriteFile(path)) throw new Error("cannot write " + path);
            g = ssHost.newdefault(20, 120, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "ss_gen";
            var hub = ssHost.getnamed("ss_genin");
            var pin = ssHost.getnamed("ss_plugin");
            var pout = ssHost.getnamed("ss_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            ssHost.connect(hub, 0, g, 0);
            ssHost.connect(pin, 0, g, 0);
            ssHost.connect(pin, 1, g, 1);
            ssHost.connect(g, 0, pout, 0);
            ssHost.connect(g, 1, pout, 1);
        }
        ssDsp.createdAt = Date.now();
        ssDsp.counter0 = ssGenAlive();
        ssTrace("dsp-created", "alive " + ssDsp.counter0);
        ssDspConfirm();
    } catch (err) {
        ssDsp.error = String(err && err.message ? err.message : err);
        ssDspRelease();
        ssTrace("dsp-error", ssDsp.error);
        post(SS_PREFIX + ": DSP load failed: " + ssDsp.error + "\n");
    }
    ssDspNotify();
}

function ssDspConfirm() {
    var c = ssGenAlive();
    if (ssDsp.counter0 >= 0 && c >= 0 && c !== ssDsp.counter0) {
        ssDsp.ready = 1;
        ssDsp.error = "";
        ssTrace("dsp", "ready after " + (Date.now() - ssDsp.createdAt) + " ms");
        ssDspRelease();
        // the last re-send may have reached the gen while it was still compiling: once more now, and again when it has settled
        ssDevResend();
        if (!ssDsp.settleTask) ssDsp.settleTask = new Task(ssDevResend, this);
        ssDsp.settleTask.schedule(SS_DSP_SETTLE_MS);
        ssDspNotify();
        return;
    }
    if (Date.now() - ssDsp.createdAt > ssDspTimeout() && ssDsp.retries < SS_DSP_RETRIES) {
        // the gen~ was never added to the DSP chain: build a new one
        ssDsp.retries++;
        ssTrace("dsp-retry", "gen~ alive counter stayed " + c);
        try {
            var old = ssHost.getnamed("ss_gen");
            if (old) ssHost.remove(old);
        } catch (_) {}
        ssDsp.createdAt = 0;
        ssDsp.counter0 = -1;
        ssDspLoad();
        return;
    }
    if (Date.now() - ssDsp.createdAt > ssDspTimeout()) {
        ssDsp.error = "not running";
        ssDspRelease();
        ssTrace("dsp-error", ssDsp.error + " (alive " + ssDsp.counter0 + " / " + c + ")");
        ssDspNotify();
        return;
    }
    ssDevResend();
    if (ssDsp.counter0 < 0) ssDsp.counter0 = c;
    if (!ssDsp.confirmTask) ssDsp.confirmTask = new Task(ssDspConfirm, this);
    ssDsp.confirmTask.schedule(SS_DSP_CONFIRM_MS);
}

// From init_link (live.thisdevice): let the face paint first, then build the DSP.
function ssDspSchedule(id) {
    if (id) ssTraceId = id;
    if (ssDsp.ready || ssDsp.createdAt) return;
    if (!ssDsp.task) ssDsp.task = new Task(ssDspLoad, this);
    ssDsp.task.schedule(30);
}

// Test hook / recovery: remove the running gen~ and build a new one (a late start: new sample counter, state and framing).
function ssDspRestart() {
    if (!ssHost) return;
    ssDsp.restarts++;
    try {
        var old = ssHost.getnamed("ss_gen");
        if (old) ssHost.remove(old);
    } catch (_) {}
    ssDsp.ready = 0;
    ssDsp.createdAt = 0;
    ssDsp.counter0 = -1;
    ssDsp.retries = 0;
    ssTrace("dsp-restart", "#" + ssDsp.restarts);
    ssDspNotify();
    ssDspSchedule();
}

// Header pill text for the face ("" when the DSP runs).
function ssDspPill() {
    if (ssDsp.ready) return "";
    if (ssDsp.error) return "DSP failed: " + (ssDsp.error.length > 22 ? ssDsp.error.substring(0, 21) + "..." : ssDsp.error);
    return "DSP loading...";
}
