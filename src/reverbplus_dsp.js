// Reverb+ deferred DSP, shared by Start and End (AGENTS.md 1d). The device ships without its gen~,
// so Live shows the face at once. One Task tick after live.thisdevice (init_link) this script writes
// the embedded gen patch (GEN_DSP_TEXT, injected by scripts/build_reverbplus.py) to
// /tmp/<RP_DSP_PREFIX>_<hash>.gendsp, creates `gen~ @gen <file>` and wires it:
// rp_genin (gate 1 1, every gen-bound message) -> gen, rp_plugin -> gen -> rp_plugout.
// There is no plugin~ -> plugout~ cord: the device stays silent until the gen~ is running.
// The gen drops messages while it compiles, so the script re-sends buffer bindings (and, on Start,
// every gen parameter) every 150 ms until the scope frame counter moves, then once more 300 ms later.
// Start and End instances share Global("reverbplus_dspq") and create one gen~ at a time.
// Trace lines go to Global("reverbplus_trace"): Start logs "dsp ready", End logs "end-dsp ready"
// (the live test matches " dsp ready " for Starts only).

var rpHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var rpDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null, retries: 0 };
var RP_DSP_RETRIES = 2;
var RP_DSP_CLAIM_MS = 15000;
var RP_DSP_QUEUE_POLL_MS = 100;
var rpDspToken = Math.random();
var RP_DSP_CONFIRM_MS = 150;
var RP_DSP_SETTLE_MS = 300;
// A healthy gen~ runs about 1.8 s after its creation in Live (158 ms when the compile is cached); the first gen~ the
// Live process creates is sometimes never added to the DSP chain. The first attempt is therefore given 3.5 s (about
// twice the healthy time) before it is rebuilt, later attempts 6 s (before: 6 s for every attempt).
var RP_DSP_FIRST_TIMEOUT_MS = 3500;
var RP_DSP_TIMEOUT_MS = 6000;
function rpDspTimeout() {
    return rpDsp.retries === 0 ? RP_DSP_FIRST_TIMEOUT_MS : RP_DSP_TIMEOUT_MS;
}

function rpDspIsEnd() {
    return typeof RP_ROLE !== "undefined" && RP_ROLE === "end";
}

// End's ready line is "end-dsp ready", which does not match the Start test's " dsp ready ".
function rpDspTag(tag) {
    return rpDspIsEnd() ? "end-" + tag : tag;
}

// Load trace for scripts/test_reverbplus_live.js: Global("reverbplus_trace").text, one line per event,
// stamped with ms since the script loaded.
var rpTraceT0 = Date.now();
function rpTrace(tag, msg) {
    try {
        var g = new Global("reverbplus_trace");
        var line = "+" + (Date.now() - rpTraceT0) + " " + tag + (msg ? " " + msg : "") + " [#" + rpSelfId + " @" + (Date.now() % 1000000) + "]";
        var lines = (g.text ? String(g.text).split("\n") : []).concat([line]);
        g.text = lines.slice(-60).join("\n");
    } catch (_) {}
}

function rpDspPath() {
    var pre = (typeof RP_DSP_PREFIX !== "undefined" && RP_DSP_PREFIX) ? RP_DSP_PREFIX : "reverbplus_start";
    return "/tmp/" + pre + "_" + GEN_DSP_HASH + ".gendsp";
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

// Start writes FRAMES at scope[0]. End writes its counter at scope[7] (RP_ESCOPE.FRAMES) and that
// slot advances every 64 samples even in silence; scope[0] on End is the link flag and can sit still.
function rpDspFrameIndex() {
    return rpDspIsEnd() ? RP_ESCOPE.FRAMES : RP_SCOPE.FRAMES;
}
function rpDspScopeName() {
    if (rpOwnNames.scope) return rpOwnNames.scope;
    return rpDspIsEnd() ? "---rpscopeE" : "";
}
function rpDspFrames() {
    var name = rpDspScopeName();
    if (!name) return -1;
    try {
        var v = new Buffer(name).peek(1, rpDspFrameIndex(), 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (_) {
        return -1;
    }
}

// Start: own buffer binding and every gen parameter (rpRaw holds the raw values from set_<key>).
// End: own scope / xfer / hdr, then the Start partner's xfer / hdr when the link is already up
// (those messages are lost while the gen is still compiling).
function rpDspResend() {
    if (rpDspIsEnd()) {
        var scope = rpDspScopeName();
        var xfer = rpOwnNames.xfer || "---rpxferE";
        var hdr = rpOwnNames.hdr || "---rphdrE";
        if (scope) outlet(0, "scope", scope);
        if (xfer) outlet(0, "xfer", xfer);
        if (hdr) outlet(0, "hdr", hdr);
        if (rpLink.paired && rpLink.boundTo && rpLink.boundTo !== "own") {
            var parts = String(rpLink.boundTo).split("|");
            if (parts[0]) outlet(0, "xfer", parts[0]);
            if (parts[1]) outlet(0, "hdr", parts[1]);
        }
        return;
    }
    if (rpOwnNames.xfer) outlet(0, "xfer", rpOwnNames.xfer);
    if (rpOwnNames.hdr) outlet(0, "hdr", rpOwnNames.hdr);
    if (rpOwnNames.scope) outlet(0, "scope", rpOwnNames.scope);
    if (rpOwnNames.spec) outlet(0, "spec", rpOwnNames.spec);
    if (rpOwnNames.irspec) outlet(0, "irs", rpOwnNames.irspec);
    if (typeof RP_GEN_PARAMS === "undefined" || typeof rpRaw === "undefined") return;
    for (var key in RP_GEN_PARAMS) {
        if (!(key in rpRaw)) continue;
        var g = RP_GEN_PARAMS[key];
        outlet(0, g[0], rpRaw[key] / g[1]);
    }
}

// Only one instance creates its gen~ at a time (Start and End share the queue). Measured in Live
// (3 pairs in one set): when several gens are created within a second, one of them is never added
// to the DSP chain. The Global holds the token of the instance that is creating; it is released
// when that gen~ runs (or has failed for good). A claim older than RP_DSP_CLAIM_MS is stale.
function rpDspClaim() {
    var q = new Global("reverbplus_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== rpDspToken && now - Number(q.t) < RP_DSP_CLAIM_MS) return false;
    q.owner = rpDspToken;
    q.t = now;
    return true;
}
function rpDspRelease() {
    var q = new Global("reverbplus_dspq");
    if (q.owner === rpDspToken) q.owner = 0;
}

function rpDspLoad() {
    if (rpDsp.ready || rpDsp.createdAt || !rpHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!rpDspClaim()) {
        if (!rpDsp.task) rpDsp.task = new Task(rpDspLoad, this);
        rpDsp.task.schedule(RP_DSP_QUEUE_POLL_MS);
        return;
    }
    rpTrace(rpDspTag("dsp-start"), "creating gen~" + (rpDsp.retries ? " (retry " + rpDsp.retries + ")" : ""));
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
        }
        rpDsp.createdAt = Date.now();
        rpDsp.counter0 = rpDspFrames();
        rpTrace(rpDspTag("dsp-created"), "frames " + rpDsp.counter0);
        rpDspConfirm();
    } catch (err) {
        rpDsp.error = String(err && err.message ? err.message : err);
        rpDspRelease();
        rpTrace(rpDspTag("dsp-error"), rpDsp.error);
        post((rpDspIsEnd() ? "Reverb+ End" : "Reverb+") + ": DSP load failed: " + rpDsp.error + "\n");
    }
    rpBroadcastDsp();
}

function rpDspConfirm() {
    var c = rpDspFrames();
    if (rpDsp.counter0 >= 0 && c >= 0 && c !== rpDsp.counter0) {
        rpDsp.ready = 1;
        rpDsp.error = "";
        rpTrace(rpDspTag("dsp"), "ready after " + (Date.now() - rpDsp.createdAt) + " ms");
        rpDspRelease();
        // the last re-send may have reached the gen while it was still compiling: once more now, and
        // again when it has settled (300 ms)
        rpDspResend();
        if (!rpDsp.settleTask) rpDsp.settleTask = new Task(rpDspResend, this);
        rpDsp.settleTask.schedule(RP_DSP_SETTLE_MS);
        rpBroadcastDsp();
        return;
    }
    if (Date.now() - rpDsp.createdAt > rpDspTimeout() && rpDsp.retries < RP_DSP_RETRIES) {
        // the gen~ was never added to the DSP chain: build a new one
        rpDsp.retries++;
        rpTrace(rpDspTag("dsp-retry"), "gen~ frames stayed " + c);
        try {
            var old = rpHost.getnamed("rp_gen");
            if (old) rpHost.remove(old);
        } catch (_) {}
        rpDsp.createdAt = 0;
        rpDsp.counter0 = -1;
        rpDspLoad();
        return;
    }
    if (Date.now() - rpDsp.createdAt > rpDspTimeout()) {
        rpDsp.error = "not running";
        rpDspRelease();
        rpTrace(rpDspTag("dsp-error"), rpDsp.error + " (frames " + rpDsp.counter0 + " / " + c + ")");
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

// Start faces show the pill via the state bus. End draws it itself from rpDsp (one outlet, the gen hub).
function rpBroadcastDsp() {
    if (rpDspIsEnd()) {
        if (typeof mgraphics !== "undefined") mgraphics.redraw();
        return;
    }
    outlet(1, "state", "dsp", rpDsp.ready ? 1 : 0, rpDsp.error ? rpDsp.error.replace(/\s+/g, "_") : "-");
}
