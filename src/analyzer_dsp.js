// Analyzer deferred DSP. The device ships without a gen~; plugin~ is already wired to plugout~,
// so audio passes while the tap is created. The face writes the embedded .gendsp (GEN_DSP_TEXT)
// and connects the gate hub plus both plugin~ channels into the gen. The gen's outlets stay
// unconnected. Ready when the packet frame counter (scope slot 0) moves.

var anHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var anDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null, retries: 0 };
var AN_DSP_RETRIES = 2;
var AN_DSP_CLAIM_MS = 15000;
var AN_DSP_QUEUE_POLL_MS = 100;
var AN_DSP_CONFIRM_MS = 150;
var AN_DSP_SETTLE_MS = 300;
var AN_DSP_FIRST_TIMEOUT_MS = 3500;
var AN_DSP_TIMEOUT_MS = 6000;
var anDspToken = Math.random();

function anDspTimeout() {
    return anDsp.retries === 0 ? AN_DSP_FIRST_TIMEOUT_MS : AN_DSP_TIMEOUT_MS;
}

function anDspPath() {
    return "/tmp/analyzer_core_" + GEN_DSP_HASH + ".gendsp";
}

function anDspWriteFile(path) {
    try {
        var rf = new File(path, "read");
        var have = rf.isopen && rf.eof === GEN_DSP_TEXT.length;
        rf.close();
        if (have) return true;
    } catch (err) {}
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) return false;
    f.eof = 0;
    var i;
    for (i = 0; i < GEN_DSP_TEXT.length; i += 16384) f.writestring(GEN_DSP_TEXT.substring(i, i + 16384));
    f.close();
    return true;
}

function anDspFrames() {
    if (!anBufName || typeof Buffer === "undefined") return -1;
    try {
        var v = new Buffer(anBufName).peek(1, 0, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (err) {
        return -1;
    }
}

function anDspResend() {
    if (anBufName) outlet(1, "scope", anBufName);
    if (typeof anSendXover === "function") anSendXover();
}

function anDspClaim() {
    var q = new Global("analyzer_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== anDspToken && now - Number(q.t) < AN_DSP_CLAIM_MS) return false;
    q.owner = anDspToken;
    q.t = now;
    return true;
}

function anDspRelease() {
    var q = new Global("analyzer_dspq");
    if (q.owner === anDspToken) q.owner = 0;
}

function anDspLoad() {
    if (anDsp.ready || anDsp.createdAt || !anHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!anDspClaim()) {
        if (!anDsp.task) anDsp.task = new Task(anDspLoad, this);
        anDsp.task.schedule(AN_DSP_QUEUE_POLL_MS);
        return;
    }
    try {
        var g = anHost.getnamed("an_gen");
        if (!g) {
            var path = anDspPath();
            if (!anDspWriteFile(path)) throw new Error("cannot write " + path);
            g = anHost.newdefault(40, 280, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "an_gen";
            var hub = anHost.getnamed("an_genin");
            var pin = anHost.getnamed("an_plugin");
            if (!hub || !pin) throw new Error("missing hub / plugin~");
            anHost.connect(hub, 0, g, 0);
            anHost.connect(pin, 0, g, 0);
            anHost.connect(pin, 1, g, 1);
        }
        anDsp.createdAt = Date.now();
        anDsp.counter0 = anDspFrames();
        anDspConfirm();
    } catch (err) {
        anDsp.error = String(err && err.message ? err.message : err);
        anDspRelease();
        post("Analyzer: DSP load failed: " + anDsp.error + "\n");
    }
    if (typeof mgraphics !== "undefined") mgraphics.redraw();
}

function anDspConfirm() {
    var c = anDspFrames();
    if (anDsp.counter0 >= 0 && c >= 0 && c !== anDsp.counter0) {
        anDsp.ready = 1;
        anDsp.error = "";
        anDspRelease();
        anDspResend();
        if (!anDsp.settleTask) anDsp.settleTask = new Task(anDspResend, this);
        anDsp.settleTask.schedule(AN_DSP_SETTLE_MS);
        if (typeof mgraphics !== "undefined") mgraphics.redraw();
        return;
    }
    if (Date.now() - anDsp.createdAt > anDspTimeout() && anDsp.retries < AN_DSP_RETRIES) {
        anDsp.retries++;
        try {
            var old = anHost.getnamed("an_gen");
            if (old) anHost.remove(old);
        } catch (err) {}
        anDsp.createdAt = 0;
        anDsp.counter0 = -1;
        anDspLoad();
        return;
    }
    if (Date.now() - anDsp.createdAt > anDspTimeout()) {
        anDsp.error = "not running";
        anDspRelease();
        if (typeof mgraphics !== "undefined") mgraphics.redraw();
        return;
    }
    anDspResend();
    if (anDsp.counter0 < 0) anDsp.counter0 = c;
    if (!anDsp.confirmTask) anDsp.confirmTask = new Task(anDspConfirm, this);
    anDsp.confirmTask.schedule(AN_DSP_CONFIRM_MS);
}

function anDspSchedule() {
    if (anDsp.ready || anDsp.createdAt) return;
    if (!anDsp.task) anDsp.task = new Task(anDspLoad, this);
    anDsp.task.schedule(30);
}

function init_dsp() {
    anDspSchedule();
}
