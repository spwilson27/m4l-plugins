// Delay+ deferred DSP, shared by Start and End (AGENTS.md 1d). The device ships without its gen~,
// so Live shows the face at once. One Task tick after live.thisdevice (init_link) the face writes
// the embedded gen patch (GEN_DSP_TEXT, injected by scripts/build_delayplus.py) to
// /tmp/<DP_DSP_PREFIX>_<hash>.gendsp, creates `gen~ @gen <file>` and wires it: the dp_genin hub
// (gate 1 1, every gen-bound message) -> gen, dp_plugin -> gen -> dp_plugout.
//
// Until that wiring exists the outlets are silent (no plugin~ -> plugout~ cords in the file). A
// dry cord during deferral made a rack of pairs louder than the mix and let the chain hear
// unprocessed audio. dpHost.disconnect of those cords is kept, and ignored when they are absent.
//
// The gen drops messages while it compiles. The face re-sends the buffer binding (and, on Start,
// every gen parameter from DP_GEN_PARAMS) every 150 ms until the scope frame counter moves, then
// once more 300 ms later. Start watches DP_SCOPE.FRAMES; End watches DP_ESCOPE.FRAMES, which the
// End gen increments every 64 samples even in silence.
//
// One instance creates its gen~ at a time. Start and End share Global("delayplus_dspq"): creating
// several gen~ within a second of each other left one of them out of the DSP chain (measured on
// Reverb+). The claim is released when the gen runs or has failed.
//
// Load trace: Global("delayplus_trace").text. Start logs "dsp ready after <ms> ms"
// (scripts/test_delayplus_live.js counts that phrase). End logs "end-dsp ready after <ms> ms"
// so the same count stays the number of Starts.

var dpHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var dpDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null };
var DP_DSP_CONFIRM_MS = 150;
var DP_DSP_SETTLE_MS = 300;
var DP_DSP_TIMEOUT_MS = 10000;
var DP_DSP_CLAIM_MS = 15000;
var DP_DSP_QUEUE_POLL_MS = 100;
var dpDspToken = Math.random();

// Load trace for scripts/test_delayplus_live.js: Global("delayplus_trace").text, one line per event,
// stamped with ms since the script loaded.
var dpTraceT0 = Date.now();
function dpTrace(tag, msg) {
    try {
        var g = new Global("delayplus_trace");
        var line = "+" + (Date.now() - dpTraceT0) + " " + tag + (msg ? " " + msg : "");
        var lines = (g.text ? String(g.text).split("\n") : []).concat([line]);
        g.text = lines.slice(-60).join("\n");
    } catch (_) {}
}

function dpDspPath() {
    var prefix = (typeof DP_DSP_PREFIX !== "undefined" && DP_DSP_PREFIX) ? DP_DSP_PREFIX : "delayplus_start";
    return "/tmp/" + prefix + "_" + GEN_DSP_HASH + ".gendsp";
}

/** @param {string} path */
function dpDspWriteFile(path) {
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

function dpDspFrameSlot() {
    if (typeof DP_ROLE !== "undefined" && DP_ROLE === "end") return DP_ESCOPE.FRAMES;
    return DP_SCOPE.FRAMES;
}

function dpDspFrames() {
    if (!dpOwnNames.scope) return -1;
    try {
        var v = new Buffer(dpOwnNames.scope).peek(1, dpDspFrameSlot(), 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (_) {
        return -1;
    }
}

// Start: own buffer names and every gen parameter (dpRaw holds the raw set_<key> values).
// End: own scope / xfer / hdr, then the partner's xfer and hdr when already linked (scope stays
// End's, so the frame counter the confirm loop watches does not move to the Start buffer).
function dpDspResend() {
    if (typeof DP_ROLE !== "undefined" && DP_ROLE === "end") {
        if (dpOwnNames.scope) outlet(0, "scope", dpOwnNames.scope);
        if (dpOwnNames.xfer) outlet(0, "xfer", dpOwnNames.xfer);
        if (dpOwnNames.hdr) outlet(0, "hdr", dpOwnNames.hdr);
        if (dpLink.paired && dpLink.partnerId) {
            try {
                var entry = dpBus().reg[dpLink.partnerId];
                if (entry && entry.xfer && entry.hdr) {
                    outlet(0, "xfer", entry.xfer);
                    outlet(0, "hdr", entry.hdr);
                }
            } catch (_) {}
        }
        return;
    }
    if (dpOwnNames.xfer) outlet(0, "xfer", dpOwnNames.xfer);
    if (dpOwnNames.hdr) outlet(0, "hdr", dpOwnNames.hdr);
    if (dpOwnNames.scope) outlet(0, "scope", dpOwnNames.scope);
    if (dpOwnNames.spec) outlet(0, "spec", dpOwnNames.spec);
    if (typeof DP_GEN_PARAMS === "undefined") return;
    for (var key in DP_GEN_PARAMS) {
        if (!(key in dpRaw)) continue;
        var g = DP_GEN_PARAMS[key];
        outlet(0, g[0], g[1] ? dpRaw[key] / 100 : dpRaw[key]);
    }
}

function dpDspClaim() {
    var q = new Global("delayplus_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== dpDspToken && now - Number(q.t) < DP_DSP_CLAIM_MS) return false;
    q.owner = dpDspToken;
    q.t = now;
    return true;
}

function dpDspTouch() {
    try {
        var q = new Global("delayplus_dspq");
        if (q.owner === dpDspToken) q.t = Date.now();
    } catch (_) {}
}

function dpDspRelease() {
    try {
        var q = new Global("delayplus_dspq");
        if (q.owner === dpDspToken) q.owner = 0;
    } catch (_) {}
}

// The file has no dry cords. If a cord is there anyway, drop it once the gen is wired; Max throws
// when the cord is already gone, so a missing cord is not a load failure.
function dpDspUncord(pin, pout) {
    try { dpHost.disconnect(pin, 0, pout, 0); } catch (_) {}
    try { dpHost.disconnect(pin, 1, pout, 1); } catch (_) {}
}

function dpDspWho() {
    return (typeof DP_ROLE !== "undefined" && DP_ROLE === "end") ? "Delay+ End" : "Delay+";
}

function dpDspLoad() {
    if (dpDsp.ready || dpDsp.createdAt || !dpHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!dpDspClaim()) {
        if (!dpDsp.task) dpDsp.task = new Task(dpDspLoad, this);
        dpDsp.task.schedule(DP_DSP_QUEUE_POLL_MS);
        return;
    }
    dpTrace("dsp-start", "creating gen~");
    try {
        var g = dpHost.getnamed("dp_gen");
        if (!g) {
            var path = dpDspPath();
            if (!dpDspWriteFile(path)) throw new Error("cannot write " + path);
            g = dpHost.newdefault(20, 120, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "dp_gen";
            var hub = dpHost.getnamed("dp_genin");
            var pin = dpHost.getnamed("dp_plugin");
            var pout = dpHost.getnamed("dp_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            dpHost.connect(hub, 0, g, 0);
            dpHost.connect(pin, 0, g, 0);
            dpHost.connect(pin, 1, g, 1);
            dpHost.connect(g, 0, pout, 0);
            dpHost.connect(g, 1, pout, 1);
            dpDspUncord(pin, pout);
        }
        dpDsp.createdAt = Date.now();
        dpDsp.counter0 = dpDspFrames();
        dpTrace("dsp-created", "frames " + dpDsp.counter0);
        dpDspConfirm();
    } catch (err) {
        dpDsp.error = String(err && err.message ? err.message : err);
        dpDspRelease();
        dpTrace("dsp-error", dpDsp.error);
        post(dpDspWho() + ": DSP load failed: " + dpDsp.error + "\n");
    }
    mgraphics.redraw();
}

function dpDspConfirm() {
    dpDspTouch();
    var c = dpDspFrames();
    if (dpDsp.counter0 >= 0 && c >= 0 && c !== dpDsp.counter0) {
        dpDsp.ready = 1;
        dpDsp.error = "";
        dpDspRelease();
        // Start: "dsp ready after N ms" (the Live test counts this). End uses another tag so those
        // lines are not counted as Starts.
        var readyTag = (typeof DP_ROLE !== "undefined" && DP_ROLE === "end") ? "end-dsp" : "dsp";
        dpTrace(readyTag, "ready after " + (Date.now() - dpDsp.createdAt) + " ms");
        // the last re-send may have reached the gen while it was still compiling: once more now, and
        // again when it has settled
        dpDspResend();
        if (!dpDsp.settleTask) dpDsp.settleTask = new Task(dpDspResend, this);
        dpDsp.settleTask.schedule(DP_DSP_SETTLE_MS);
        mgraphics.redraw();
        return;
    }
    if (Date.now() - dpDsp.createdAt > DP_DSP_TIMEOUT_MS) {
        dpDsp.error = "not running";
        dpDspRelease();
        dpTrace("dsp-error", dpDsp.error + " (frames " + dpDsp.counter0 + " / " + c + ")");
        mgraphics.redraw();
        return;
    }
    dpDspResend();
    if (dpDsp.counter0 < 0) dpDsp.counter0 = c;
    if (!dpDsp.confirmTask) dpDsp.confirmTask = new Task(dpDspConfirm, this);
    dpDsp.confirmTask.schedule(DP_DSP_CONFIRM_MS);
}

// From init_link (live.thisdevice): let the face paint first, then build the DSP.
function dpDspSchedule() {
    if (dpDsp.ready || dpDsp.createdAt) return;
    if (!dpDsp.task) dpDsp.task = new Task(dpDspLoad, this);
    dpDsp.task.schedule(30);
}

// Header pill while the DSP is not running: {label, alert} or null.
// End draws this only after creation has started (see delayplus_end_ui.js) so the static preview,
// which never calls init_link, stays as it was.
function dpDspState() {
    if (dpDsp.ready || typeof GEN_DSP_TEXT === "undefined") return null;
    if (dpDsp.error) return { label: "DSP FAILED: " + dpDsp.error.toUpperCase(), alert: true };
    return { label: "DSP LOADING…", alert: false };
}
