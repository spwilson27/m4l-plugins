// Degrade deferred DSP: the device ships without its gen~, so Live shows the face at once (AGENTS.md 1d).
// One Task tick after live.thisdevice (`init_dsp`) the face writes the embedded gen patch (GEN_DSP_TEXT, injected by
// scripts/build_degrade.py) to /tmp/degrade_core_<hash>.gendsp, creates `gen~ @gen <file>` (varname deg_gen) and wires
// it: the deg_genin hub (gate 1 1, every gen-bound message) -> gen, deg_plugin -> gen -> deg_plugout. Until then the
// device outputs silence (plugin~ is not connected to plugout~).
// The gen drops messages while it compiles, so the face re-sends the buffer binding, the chain order, and every
// gen-bound parameter every 150 ms until the gen's frame counter (#0-degscope slot 7) moves, then once more after
// 300 ms. The first gen~ a Live process creates is sometimes never added to the DSP chain (retry at 3.5 s, then 6 s,
// up to 2 retries), and instances create one at a time (Global "degrade_dspq").

var degHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var degDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null, retries: 0 };
var DEG_DSP_RETRIES = 2;
var DEG_DSP_CLAIM_MS = 15000;
var DEG_DSP_QUEUE_POLL_MS = 100;
var DEG_DSP_CONFIRM_MS = 150;
var DEG_DSP_SETTLE_MS = 300;
var DEG_DSP_FIRST_TIMEOUT_MS = 3500;
var DEG_DSP_TIMEOUT_MS = 6000;
var degDspToken = Math.random();

function degDspTimeout() {
    return degDsp.retries === 0 ? DEG_DSP_FIRST_TIMEOUT_MS : DEG_DSP_TIMEOUT_MS;
}

function degDspPath() {
    return "/tmp/degrade_core_" + GEN_DSP_HASH + ".gendsp";
}

/** @param {string} path */
function degDspWriteFile(path) {
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

var degScopeName = "---degscope";
// Slot 7 is the rolling frame counter. It advances every 64 samples, including silence.
function degDspFrames() {
    if (typeof Buffer === "undefined") return -1;
    try {
        var v = new Buffer(degScopeName).peek(1, 7, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (_) {
        return -1;
    }
}

// Scope binding, chain order, stage enables, and every gen-bound live.* parameter.
// `dsp_resend` bangs the scope message and each live.* control (they output their current value into the hub).
function degDspResend() {
    outlet(0, "order_code", encodeOrderCode(stageOrder));
    outlet(0, "dsp_resend", "bang");
}

function degDspClaim() {
    var q = new Global("degrade_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== degDspToken && now - Number(q.t) < DEG_DSP_CLAIM_MS) return false;
    q.owner = degDspToken;
    q.t = now;
    return true;
}

function degDspRelease() {
    var q = new Global("degrade_dspq");
    if (q.owner === degDspToken) q.owner = 0;
}

function degDspLoad() {
    if (degDsp.ready || degDsp.createdAt || !degHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!degDspClaim()) {
        if (!degDsp.task) degDsp.task = new Task(degDspLoad, this);
        degDsp.task.schedule(DEG_DSP_QUEUE_POLL_MS);
        return;
    }
    try {
        var g = degHost.getnamed("deg_gen");
        if (!g) {
            var path = degDspPath();
            if (!degDspWriteFile(path)) throw new Error("cannot write " + path);
            g = degHost.newdefault(40, 420, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "deg_gen";
            var hub = degHost.getnamed("deg_genin");
            var pin = degHost.getnamed("deg_plugin");
            var pout = degHost.getnamed("deg_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            degHost.connect(hub, 0, g, 0);
            degHost.connect(pin, 0, g, 0);
            degHost.connect(pin, 1, g, 1);
            degHost.connect(g, 0, pout, 0);
            degHost.connect(g, 1, pout, 1);
        }
        degDsp.createdAt = Date.now();
        degDsp.counter0 = degDspFrames();
        degDspConfirm();
    } catch (err) {
        degDsp.error = String(err && err.message ? err.message : err);
        degDspRelease();
        if (typeof post === "function") post("Degrade: DSP load failed: " + degDsp.error + "\n");
    }
    mgraphics.redraw();
}

function degDspConfirm() {
    var c = degDspFrames();
    if (degDsp.counter0 >= 0 && c >= 0 && c !== degDsp.counter0) {
        degDsp.ready = 1;
        degDsp.error = "";
        degDspRelease();
        degDspResend();
        if (typeof Task !== "undefined") {
            if (!degDsp.settleTask) degDsp.settleTask = new Task(degDspResend, this);
            degDsp.settleTask.schedule(DEG_DSP_SETTLE_MS);
        }
        mgraphics.redraw();
        return;
    }
    if (Date.now() - degDsp.createdAt > degDspTimeout() && degDsp.retries < DEG_DSP_RETRIES) {
        degDsp.retries++;
        try {
            var old = degHost.getnamed("deg_gen");
            if (old) degHost.remove(old);
        } catch (_) {}
        degDsp.createdAt = 0;
        degDsp.counter0 = -1;
        degDspLoad();
        return;
    }
    if (Date.now() - degDsp.createdAt > degDspTimeout()) {
        degDsp.error = "not running";
        degDspRelease();
        mgraphics.redraw();
        return;
    }
    degDspResend();
    if (degDsp.counter0 < 0) degDsp.counter0 = c;
    if (typeof Task === "undefined") return;
    if (!degDsp.confirmTask) degDsp.confirmTask = new Task(degDspConfirm, this);
    degDsp.confirmTask.schedule(DEG_DSP_CONFIRM_MS);
}

// From live.thisdevice (`init_dsp`): let the face paint first, then build the DSP.
function init_dsp() {
    if (degDsp.ready || degDsp.createdAt) return;
    if (typeof Task === "undefined") return;
    if (!degDsp.task) degDsp.task = new Task(degDspLoad, this);
    degDsp.task.schedule(30);
}
