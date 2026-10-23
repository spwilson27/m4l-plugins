// Envelope Trigger deferred DSP (AGENTS.md 1d). The device ships without its gen~.
// One Task tick after live.thisdevice the face writes the embedded gen patch (GEN_DSP_TEXT,
// injected by scripts/build_envtrig.py) to /tmp/envtrig_core_<hash>.gendsp, creates
// `gen~ @gen <file>` and wires it:
//   et_genin (gate 1 1) -> gen
//   et_plugin -> gen inlets 0 and 1
//   gen outlets 0 and 1 -> et_plugout
//   gen outlet 2 -> et_edge (gate into edge~)
//   gen outlet 3 -> et_snap (held velocity into snapshot~)
// Until that gen~ is running the device outputs silence: plugin~ is not tied to plugout~.
// The gen drops messages while it compiles, so the face re-sends `scope #0-trigscope` and
// thr / sens / holdms / velmin / velmax every 150 ms until scope slot 3 (the roll counter)
// moves, then once more after 300 ms. The first gen~ a Live process creates is sometimes
// never added to the DSP chain (retry at 3.5 s, then 6 s, up to 2 retries). Instances take
// the Global("envtrig_dspq") token one at a time.

var etHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var etDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null, retries: 0 };
var ET_DSP_RETRIES = 2;
var ET_DSP_CLAIM_MS = 15000;
var ET_DSP_QUEUE_POLL_MS = 100;
var ET_DSP_CONFIRM_MS = 150;
var ET_DSP_SETTLE_MS = 300;
var ET_DSP_FIRST_TIMEOUT_MS = 3500;
var ET_DSP_TIMEOUT_MS = 6000;
var etDspToken = Math.random();

function etDspTimeout() {
    return etDsp.retries === 0 ? ET_DSP_FIRST_TIMEOUT_MS : ET_DSP_TIMEOUT_MS;
}

function etDspPath() {
    return "/tmp/envtrig_core_" + GEN_DSP_HASH + ".gendsp";
}

/** @param {string} path */
function etDspWriteFile(path) {
    try {
        var rf = new File(path, "read");
        var have = rf.isopen && rf.eof === GEN_DSP_TEXT.length;
        rf.close();
        if (have) return true;
    } catch (err) {}
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) return false;
    f.eof = 0;
    for (var i = 0; i < GEN_DSP_TEXT.length; i += 16384) f.writestring(GEN_DSP_TEXT.substring(i, i + 16384));
    f.close();
    return true;
}

// scope[3] is the 64-sample roll counter. It advances even while the track is silent.
function etDspFrames() {
    if (typeof scopeBuf === "undefined" || !scopeBuf || typeof Buffer === "undefined") return -1;
    try {
        var v = scopeBuf.peek(1, 3, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (err2) {
        return -1;
    }
}

// Bang the scope-bind message and every gen-bound live.* control (their current values).
function etDspResend() {
    outlet(0, "dsp_resend");
}

function etDspClaim() {
    var q = new Global("envtrig_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== etDspToken && now - Number(q.t) < ET_DSP_CLAIM_MS) return false;
    q.owner = etDspToken;
    q.t = now;
    return true;
}

function etDspRelease() {
    var q = new Global("envtrig_dspq");
    if (q.owner === etDspToken) q.owner = 0;
}

function etDspLoad() {
    if (this && this.patcher) etHost = this.patcher;
    if (etDsp.ready || etDsp.createdAt || !etHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!etDspClaim()) {
        if (!etDsp.task) etDsp.task = new Task(etDspLoad, this);
        etDsp.task.schedule(ET_DSP_QUEUE_POLL_MS);
        return;
    }
    try {
        var g = etHost.getnamed("et_gen");
        if (!g) {
            var path = etDspPath();
            if (!etDspWriteFile(path)) throw new Error("cannot write " + path);
            g = etHost.newdefault(120, 300, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "et_gen";
            var hub = etHost.getnamed("et_genin");
            var pin = etHost.getnamed("et_plugin");
            var pout = etHost.getnamed("et_plugout");
            var edge = etHost.getnamed("et_edge");
            var snap = etHost.getnamed("et_snap");
            if (!hub || !pin || !pout || !edge || !snap) throw new Error("missing hub / plugin~ / plugout~ / edge~ / snapshot~");
            etHost.connect(hub, 0, g, 0);
            etHost.connect(pin, 0, g, 0);
            etHost.connect(pin, 1, g, 1);
            etHost.connect(g, 0, pout, 0);
            etHost.connect(g, 1, pout, 1);
            etHost.connect(g, 2, edge, 0);
            etHost.connect(g, 3, snap, 0);
        }
        etDsp.createdAt = Date.now();
        etDsp.counter0 = etDspFrames();
        etDspConfirm();
    } catch (err) {
        etDsp.error = String(err && err.message ? err.message : err);
        etDspRelease();
        post("Envelope Trigger: DSP load failed: " + etDsp.error + "\n");
    }
    etDspChanged();
}

function etDspConfirm() {
    if (this && this.patcher) etHost = this.patcher;
    var c = etDspFrames();
    if (etDsp.counter0 >= 0 && c >= 0 && c !== etDsp.counter0) {
        etDsp.ready = 1;
        etDsp.error = "";
        etDspRelease();
        // the last re-send may have reached the gen while it was still compiling
        etDspResend();
        if (!etDsp.settleTask) etDsp.settleTask = new Task(etDspResend, this);
        etDsp.settleTask.schedule(ET_DSP_SETTLE_MS);
        etDspChanged();
        return;
    }
    if (Date.now() - etDsp.createdAt > etDspTimeout() && etDsp.retries < ET_DSP_RETRIES) {
        etDsp.retries++;
        try {
            var old = etHost.getnamed("et_gen");
            if (old) etHost.remove(old);
        } catch (err3) {}
        etDsp.createdAt = 0;
        etDsp.counter0 = -1;
        etDspLoad();
        return;
    }
    if (Date.now() - etDsp.createdAt > etDspTimeout()) {
        etDsp.error = "not running";
        etDspRelease();
        etDspChanged();
        return;
    }
    etDspResend();
    if (etDsp.counter0 < 0) etDsp.counter0 = c;
    if (!etDsp.confirmTask) etDsp.confirmTask = new Task(etDspConfirm, this);
    etDsp.confirmTask.schedule(ET_DSP_CONFIRM_MS);
}

// From live.thisdevice: let the face paint, then build the DSP.
function etDspSchedule() {
    if (etDsp.ready || etDsp.createdAt) return;
    if (!etDsp.task) etDsp.task = new Task(etDspLoad, this);
    etDsp.task.schedule(30);
}

function init_dsp() {
    etDspSchedule();
}

function etDspChanged() {
    mgraphics.redraw();
}
