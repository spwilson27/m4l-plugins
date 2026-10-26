// Percipitator deferred DSP: the device ships without its gen~, so Live shows the face at once (AGENTS.md 1d).
// One Task tick after live.thisdevice (`init_dsp`) the face writes the embedded gen patch (GEN_DSP_TEXT, injected by
// scripts/build_percipitator.py) to /tmp/percipitator_core_<hash>.gendsp, creates `gen~ @gen <file>` and wires it:
// pcp_genin (gate 1 1, every gen-bound message) -> gen, pcp_plugin -> gen -> pcp_plugout. Until then the device
// outputs silence (plugin~ is not connected to plugout~). The gen drops messages while it compiles, so the face
// re-sends the buffer bindings, the wavetable poke and every gen parameter every 150 ms until the scope frame
// counter (slot 35) moves, then once more after 300 ms. The first gen~ a Live process creates is sometimes never
// added to the DSP chain (retry at 3.5 s, then 6 s, up to 2 retries). Instances create one at a time (Global queue).

var pcpHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var pcpDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null, retries: 0 };
var PCP_DSP_RETRIES = 2;
var PCP_DSP_CLAIM_MS = 15000;
var PCP_DSP_QUEUE_POLL_MS = 100;
var PCP_DSP_CONFIRM_MS = 150;
var PCP_DSP_SETTLE_MS = 300;
var PCP_DSP_FIRST_TIMEOUT_MS = 3500;
var PCP_DSP_TIMEOUT_MS = 6000;
var pcpDspToken = Math.random();

function pcpDspTimeout() {
    return pcpDsp.retries === 0 ? PCP_DSP_FIRST_TIMEOUT_MS : PCP_DSP_TIMEOUT_MS;
}

function pcpDspPath() {
    return "/tmp/percipitator_core_" + GEN_DSP_HASH + ".gendsp";
}

/** @param {string} path */
function pcpDspWriteFile(path) {
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

// Only one instance creates its gen~ at a time.
function pcpDspClaim() {
    var q = new Global("percipitator_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== pcpDspToken && now - Number(q.t) < PCP_DSP_CLAIM_MS) return false;
    q.owner = pcpDspToken;
    q.t = now;
    return true;
}
function pcpDspRelease() {
    var q = new Global("percipitator_dspq");
    if (q.owner === pcpDspToken) q.owner = 0;
}

function pcpDspLoad() {
    if (pcpDsp.ready || pcpDsp.createdAt || !pcpHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!pcpDspClaim()) {
        if (!pcpDsp.task) pcpDsp.task = new Task(pcpDspLoad, this);
        pcpDsp.task.schedule(PCP_DSP_QUEUE_POLL_MS);
        return;
    }
    try {
        var g = pcpHost.getnamed("pcp_gen");
        if (!g) {
            var path = pcpDspPath();
            if (!pcpDspWriteFile(path)) throw new Error("cannot write " + path);
            g = pcpHost.newdefault(120, 300, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "pcp_gen";
            var hub = pcpHost.getnamed("pcp_genin");
            var pin = pcpHost.getnamed("pcp_plugin");
            var pout = pcpHost.getnamed("pcp_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            pcpHost.connect(hub, 0, g, 0);
            pcpHost.connect(pin, 0, g, 0);
            pcpHost.connect(pin, 1, g, 1);
            pcpHost.connect(g, 0, pout, 0);
            pcpHost.connect(g, 1, pout, 1);
        }
        pcpDsp.createdAt = Date.now();
        pcpDsp.counter0 = pcpDspFrames();
        pcpDspConfirm();
    } catch (err) {
        pcpDsp.error = String(err && err.message ? err.message : err);
        pcpDspRelease();
        if (typeof post === "function") post("Percipitator: DSP load failed: " + pcpDsp.error + "\n");
    }
    pcpDspChanged();
}

function pcpDspConfirm() {
    var c = pcpDspFrames();
    if (pcpDsp.counter0 >= 0 && c >= 0 && c !== pcpDsp.counter0) {
        pcpDsp.ready = 1;
        pcpDsp.error = "";
        pcpDspRelease();
        // the last re-send may have reached the gen while it was still compiling: once more now and when settled
        pcpDspResend();
        if (!pcpDsp.settleTask) pcpDsp.settleTask = new Task(pcpDspResend, this);
        pcpDsp.settleTask.schedule(PCP_DSP_SETTLE_MS);
        pcpDspChanged();
        return;
    }
    if (Date.now() - pcpDsp.createdAt > pcpDspTimeout() && pcpDsp.retries < PCP_DSP_RETRIES) {
        pcpDsp.retries++;
        try {
            var old = pcpHost.getnamed("pcp_gen");
            if (old) pcpHost.remove(old);
        } catch (_) {}
        pcpDsp.createdAt = 0;
        pcpDsp.counter0 = -1;
        pcpDspLoad();
        return;
    }
    if (Date.now() - pcpDsp.createdAt > pcpDspTimeout()) {
        pcpDsp.error = "not running";
        // Clear load-in-progress markers and the dead gen so a later init_dsp can retry.
        // Leaving createdAt set made pcpDspSchedule / pcpDspLoad permanent no-ops.
        try {
            var dead = pcpHost.getnamed("pcp_gen");
            if (dead) pcpHost.remove(dead);
        } catch (_) {}
        pcpDsp.createdAt = 0;
        pcpDsp.counter0 = -1;
        pcpDsp.retries = 0;
        pcpDspRelease();
        pcpDspChanged();
        return;
    }
    pcpDspResend();
    if (pcpDsp.counter0 < 0) pcpDsp.counter0 = c;
    if (!pcpDsp.confirmTask) pcpDsp.confirmTask = new Task(pcpDspConfirm, this);
    pcpDsp.confirmTask.schedule(PCP_DSP_CONFIRM_MS);
}

// From live.thisdevice (`init_dsp`): let the face paint first, then build the DSP.
function pcpDspSchedule() {
    if (pcpDsp.ready || pcpDsp.createdAt) return;
    if (!pcpDsp.task) pcpDsp.task = new Task(pcpDspLoad, this);
    pcpDsp.task.schedule(30);
}

function init_dsp() {
    pcpDspSchedule();
}

function pcpDspChanged() {
    mgraphics.redraw();
}
