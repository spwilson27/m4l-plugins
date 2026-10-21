// Delay+ (Start) deferred DSP: the device ships without its gen~, so Live shows the face at once
// (AGENTS.md 1d). One Task tick after live.thisdevice (init_link) the face writes the embedded gen
// patch (GEN_DSP_TEXT, injected by scripts/build_delayplus.py) to a .gendsp file named by its hash,
// creates `gen~ @gen <file>` and wires it: the dp_genin hub (gate 1 1, every gen-bound message) ->
// gen, dp_plugin -> gen -> dp_plugout. Until then plugin~ goes straight to plugout~ (dry passes, so
// the chain keeps sounding while the gen loads); those two cords are removed once the gen is wired.
// The gen drops messages while it compiles, so the face re-sends the buffer binding and every gen
// parameter (from the values it holds, DP_GEN_PARAMS) every 150 ms until the gen's frame counter
// (scope FRAMES) moves, then twice more. The header shows "DSP loading…" / "DSP failed" meanwhile.

var dpHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var dpDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, confirmTask: null, settleTask: null };
var DP_DSP_CONFIRM_MS = 150;
var DP_DSP_SETTLE_MS = 300;
var DP_DSP_TIMEOUT_MS = 10000;

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
    return "/tmp/delayplus_start_" + GEN_DSP_HASH + ".gendsp";
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

function dpDspFrames() {
    if (!dpOwnNames.scope) return -1;
    try {
        var v = new Buffer(dpOwnNames.scope).peek(1, DP_SCOPE.FRAMES, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (_) {
        return -1;
    }
}

// Buffer binding and every gen parameter, from the values the face holds (dpRaw: the raw parameter
// values as they arrived through set_<key>).
function dpDspResend() {
    if (dpOwnNames.xfer) outlet(0, "xfer", dpOwnNames.xfer);
    if (dpOwnNames.hdr) outlet(0, "hdr", dpOwnNames.hdr);
    if (dpOwnNames.scope) outlet(0, "scope", dpOwnNames.scope);
    if (dpOwnNames.spec) outlet(0, "spec", dpOwnNames.spec);
    for (var key in DP_GEN_PARAMS) {
        if (!(key in dpRaw)) continue;
        var g = DP_GEN_PARAMS[key];
        outlet(0, g[0], g[1] ? dpRaw[key] / 100 : dpRaw[key]);
    }
}

function dpDspLoad() {
    if (dpDsp.ready || dpDsp.createdAt || !dpHost || typeof GEN_DSP_TEXT === "undefined") return;
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
            dpHost.disconnect(pin, 0, pout, 0);
            dpHost.disconnect(pin, 1, pout, 1);
        }
        dpDsp.createdAt = Date.now();
        dpDsp.counter0 = dpDspFrames();
        dpTrace("dsp-created", "frames " + dpDsp.counter0);
        dpDspConfirm();
    } catch (err) {
        dpDsp.error = String(err && err.message ? err.message : err);
        dpTrace("dsp-error", dpDsp.error);
        post("Delay+: DSP load failed: " + dpDsp.error + "\n");
    }
    mgraphics.redraw();
}

function dpDspConfirm() {
    var c = dpDspFrames();
    if (dpDsp.counter0 >= 0 && c >= 0 && c !== dpDsp.counter0) {
        dpDsp.ready = 1;
        dpDsp.error = "";
        dpTrace("dsp", "ready after " + (Date.now() - dpDsp.createdAt) + " ms");
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
function dpDspState() {
    if (dpDsp.ready || typeof GEN_DSP_TEXT === "undefined") return null;
    if (dpDsp.error) return { label: "DSP FAILED: " + dpDsp.error.toUpperCase(), alert: true };
    return { label: "DSP LOADING…", alert: false };
}
