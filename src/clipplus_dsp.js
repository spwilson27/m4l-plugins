// Clip+ deferred DSP. The device ships without its gen~, so the face paints before the compile
// (AGENTS.md 1d). One Task tick after live.thisdevice (`init_dsp`) this writes GEN_DSP_TEXT to
// /tmp/clipplus_core_<hash>.gendsp, creates `gen~ @gen <file>` (varname cp_gen) and wires
// cp_genin (gate 1 1) -> gen, cp_plugin -> gen -> cp_plugout. The gen drops messages while it
// compiles, so cpResend repeats the scope binding and every parameter until scope slot 8 moves.

var cpHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var cpDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null, retries: 0 };
var CP_DSP_RETRIES = 3;
var CP_DSP_CLAIM_MS = 15000;
var CP_DSP_QUEUE_POLL_MS = 100;
var CP_DSP_CONFIRM_MS = 150;
var CP_DSP_SETTLE_MS = 300;
var CP_DSP_FIRST_TIMEOUT_MS = 8000;
var CP_DSP_TIMEOUT_MS = 12000;
var cpDspToken = Math.random();
var cpBufName = "---clipscope";

function cpDspTimeout() {
    return cpDsp.retries === 0 ? CP_DSP_FIRST_TIMEOUT_MS : CP_DSP_TIMEOUT_MS;
}

function cpDspPath() {
    return "/tmp/clipplus_core_" + GEN_DSP_HASH + ".gendsp";
}

/** @param {string} path */
function cpDspWriteFile(path) {
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

// Slot 8 is the block counter. It advances every 256 samples, including silence.
function cpDspFrames() {
    if (typeof Buffer === "undefined") return -1;
    try {
        var v = new Buffer(cpBufName).peek(1, 8, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (_) {
        return -1;
    }
}

function cpDspClaim() {
    var q = new Global("clipplus_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== cpDspToken && now - Number(q.t) < CP_DSP_CLAIM_MS) return false;
    q.owner = cpDspToken;
    q.t = now;
    return true;
}

function cpDspRelease() {
    var q = new Global("clipplus_dspq");
    if (q.owner === cpDspToken) q.owner = 0;
}

function cpDspLoad() {
    if (cpDsp.ready || cpDsp.createdAt || !cpHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!cpDspClaim()) {
        if (!cpDsp.task) cpDsp.task = new Task(cpDspLoad, this);
        cpDsp.task.schedule(CP_DSP_QUEUE_POLL_MS);
        return;
    }
    try {
        var g = cpHost.getnamed("cp_gen");
        if (!g) {
            var path = cpDspPath();
            if (!cpDspWriteFile(path)) throw new Error("cannot write " + path);
            g = cpHost.newdefault(40, 420, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "cp_gen";
            var hub = cpHost.getnamed("cp_genin");
            var pin = cpHost.getnamed("cp_plugin");
            var pout = cpHost.getnamed("cp_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            cpHost.connect(hub, 0, g, 0);
            cpHost.connect(pin, 0, g, 0);
            cpHost.connect(pin, 1, g, 1);
            cpHost.connect(g, 0, pout, 0);
            cpHost.connect(g, 1, pout, 1);
        }
        cpDsp.createdAt = Date.now();
        cpDsp.counter0 = cpDspFrames();
        cpDspConfirm();
    } catch (err) {
        cpDsp.error = String(err && err.message ? err.message : err);
        cpDspRelease();
        if (typeof post === "function") post("Clip+: DSP load failed: " + cpDsp.error + "\n");
    }
    mgraphics.redraw();
}

function cpDspConfirm() {
    var c = cpDspFrames();
    if (cpDsp.counter0 >= 0 && c >= 0 && c !== cpDsp.counter0) {
        cpDsp.ready = 1;
        cpDsp.error = "";
        cpDspRelease();
        cpResend();
        if (typeof Task !== "undefined") {
            if (!cpDsp.settleTask) cpDsp.settleTask = new Task(cpResend, this);
            cpDsp.settleTask.schedule(CP_DSP_SETTLE_MS);
        }
        mgraphics.redraw();
        return;
    }
    if (Date.now() - cpDsp.createdAt > cpDspTimeout() && cpDsp.retries < CP_DSP_RETRIES) {
        cpDsp.retries++;
        try {
            var old = cpHost.getnamed("cp_gen");
            if (old) cpHost.remove(old);
        } catch (_) {}
        cpDsp.createdAt = 0;
        cpDsp.counter0 = -1;
        cpDspLoad();
        return;
    }
    if (Date.now() - cpDsp.createdAt > cpDspTimeout()) {
        cpDsp.error = "not running";
        cpDspRelease();
        mgraphics.redraw();
        return;
    }
    cpResend();
    if (cpDsp.counter0 < 0) cpDsp.counter0 = c;
    if (typeof Task === "undefined") return;
    if (!cpDsp.confirmTask) cpDsp.confirmTask = new Task(cpDspConfirm, this);
    cpDsp.confirmTask.schedule(CP_DSP_CONFIRM_MS);
}

// From live.thisdevice: let the face paint, then build the DSP.
function init_dsp() {
    if (cpDsp.ready || cpDsp.createdAt) return;
    if (typeof Task === "undefined") return;
    if (!cpDsp.task) cpDsp.task = new Task(cpDspLoad, this);
    cpDsp.task.schedule(30);
}
