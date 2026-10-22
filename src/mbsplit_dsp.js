// Multiband Split deferred DSP: the device ships without its gen~, so Live shows the face at once (AGENTS.md 1d).
// One Task tick after live.thisdevice (`init_dsp`) the face writes the embedded gen patch (GEN_DSP_TEXT, injected by
// scripts/build_mbsplit.py) to a file named by its hash, creates `gen~ @gen <file>` and wires it: the mb_genin hub
// (gate 1 1, every gen-bound message) -> gen, mb_plugin -> gen -> mb_plugout. Until then the device outputs silence
// (plugin~ is not connected to plugout~): a pass-through would make a rack of K chains K times as loud while it loads.
// The gen drops messages while it compiles, so the face re-sends the buffer binding and every gen parameter
// (emitDspState) every 150 ms until the gen's beat counter (scope slot 23) moves, then once more after 300 ms.
// Same lessons as Reverb+: the first gen~ a Live process creates is sometimes never added to the DSP chain (retry after
// a timeout), and instances create one at a time (Global queue).

var mbHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var mbDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null, retries: 0, readyMs: 0 };
var MB_DSP_RETRIES = 2;
var MB_DSP_CLAIM_MS = 15000;
var MB_DSP_QUEUE_POLL_MS = 100;
var MB_DSP_CONFIRM_MS = 150;
var MB_DSP_SETTLE_MS = 300;
var MB_DSP_FIRST_TIMEOUT_MS = 3500;
var MB_DSP_TIMEOUT_MS = 6000;
var mbDspToken = Math.random();
var mbTraceT0 = Date.now();

function mbDspTimeout() {
    return mbDsp.retries === 0 ? MB_DSP_FIRST_TIMEOUT_MS : MB_DSP_TIMEOUT_MS;
}

// Load trace for scripts/test_mbsplit_live.js: Global("mbsplit_trace").text, one line per event.
function mbTrace(tag, msg) {
    try {
        var g = new Global("mbsplit_trace");
        var ln = "+" + (Date.now() - mbTraceT0) + " " + tag + (msg ? " " + msg : "") + " [#" + selfDeviceId + " @" + (Date.now() % 1000000) + "]";
        var lines = (g.text ? String(g.text).split("\n") : []).concat([ln]);
        g.text = lines.slice(-60).join("\n");
    } catch (_) {}
}

function mbDspPath() {
    return "/tmp/mbsplit_core_" + GEN_DSP_HASH + ".gendsp";
}

/** @param {string} path */
function mbDspWriteFile(path) {
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

// The gen's beat counter (scope slot 23, wraps at 1024): moves every 64 samples once the gen runs.
function mbDspFrames() {
    if (!scopeBufName || typeof Buffer === "undefined") return -1;
    try {
        var v = new Buffer(scopeBufName).peek(1, 23, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (_) {
        return -1;
    }
}

// Buffer binding and every gen parameter, from the values the face holds.
function mbDspResend() {
    if (scopeBufName) outlet(0, ["scope", scopeBufName]);
    emitDspState(false);
}

// Only one instance creates its gen~ at a time (Reverb+: with several creating within a second, one was never added to DSP).
function mbDspClaim() {
    var q = new Global("mbsplit_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== mbDspToken && now - Number(q.t) < MB_DSP_CLAIM_MS) return false;
    q.owner = mbDspToken;
    q.t = now;
    return true;
}
function mbDspRelease() {
    var q = new Global("mbsplit_dspq");
    if (q.owner === mbDspToken) q.owner = 0;
}

function mbDspLoad() {
    if (mbDsp.ready || mbDsp.createdAt || !mbHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!mbDspClaim()) {
        if (!mbDsp.task) mbDsp.task = new Task(mbDspLoad, this);
        mbDsp.task.schedule(MB_DSP_QUEUE_POLL_MS);
        return;
    }
    mbTrace("dsp-start", "creating gen~" + (mbDsp.retries ? " (retry " + mbDsp.retries + ")" : ""));
    try {
        var g = mbHost.getnamed("mb_gen");
        if (!g) {
            var path = mbDspPath();
            if (!mbDspWriteFile(path)) throw new Error("cannot write " + path);
            g = mbHost.newdefault(40, 420, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "mb_gen";
            var hub = mbHost.getnamed("mb_genin");
            var pin = mbHost.getnamed("mb_plugin");
            var pout = mbHost.getnamed("mb_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            mbHost.connect(hub, 0, g, 0);
            mbHost.connect(pin, 0, g, 0);
            mbHost.connect(pin, 1, g, 1);
            mbHost.connect(g, 0, pout, 0);
            mbHost.connect(g, 1, pout, 1);
        }
        mbDsp.createdAt = Date.now();
        mbDsp.counter0 = mbDspFrames();
        mbTrace("dsp-created", "frames " + mbDsp.counter0);
        mbDspConfirm();
    } catch (err) {
        mbDsp.error = String(err && err.message ? err.message : err);
        mbDspRelease();
        mbTrace("dsp-error", mbDsp.error);
        post("Multiband Split: DSP load failed: " + mbDsp.error + "\n");
    }
    mbDspChanged();
}

function mbDspConfirm() {
    var c = mbDspFrames();
    if (mbDsp.counter0 >= 0 && c >= 0 && c !== mbDsp.counter0) {
        mbDsp.ready = 1;
        mbDsp.error = "";
        mbDsp.readyMs = Date.now() - mbDsp.createdAt;
        mbTrace("dsp", "ready after " + mbDsp.readyMs + " ms");
        mbDspRelease();
        // the last re-send may have reached the gen while it was still compiling: once more now and when settled
        mbDspResend();
        if (!mbDsp.settleTask) mbDsp.settleTask = new Task(mbDspResend, this);
        mbDsp.settleTask.schedule(MB_DSP_SETTLE_MS);
        mbDspChanged();
        return;
    }
    if (Date.now() - mbDsp.createdAt > mbDspTimeout() && mbDsp.retries < MB_DSP_RETRIES) {
        // the gen~ was never added to the DSP chain: build a new one
        mbDsp.retries++;
        mbTrace("dsp-retry", "gen~ beat counter stayed " + c);
        try {
            var old = mbHost.getnamed("mb_gen");
            if (old) mbHost.remove(old);
        } catch (_) {}
        mbDsp.createdAt = 0;
        mbDsp.counter0 = -1;
        mbDspLoad();
        return;
    }
    if (Date.now() - mbDsp.createdAt > mbDspTimeout()) {
        mbDsp.error = "not running";
        mbDspRelease();
        mbTrace("dsp-error", mbDsp.error + " (counter " + mbDsp.counter0 + " / " + c + ")");
        mbDspChanged();
        return;
    }
    mbDspResend();
    if (mbDsp.counter0 < 0) mbDsp.counter0 = c;
    if (!mbDsp.confirmTask) mbDsp.confirmTask = new Task(mbDspConfirm, this);
    mbDsp.confirmTask.schedule(MB_DSP_CONFIRM_MS);
}

// From live.thisdevice (`init_dsp`): let the face paint first, then build the DSP.
function mbDspSchedule() {
    if (mbDsp.ready || mbDsp.createdAt) return;
    if (!mbDsp.task) mbDsp.task = new Task(mbDspLoad, this);
    mbDsp.task.schedule(30);
}

function init_dsp() {
    mbDspSchedule();
}

function mbDspChanged() {
    mgraphics.redraw();
}
