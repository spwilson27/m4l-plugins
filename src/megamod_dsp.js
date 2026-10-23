// Mega Modulator deferred DSP (AGENTS.md 1d, section 21 "Load time"): the device ships WITHOUT its gen~ objects (the engine and the 8 routers
// were most of the load: a Set load blocked for the gen compiles before any face was up). The face is up first; right after
// live.thisdevice (`init_dsp`, one Task tick after `init_lom`) this module builds the DSP graph and loads the code:
//   1. SHELLS: a tiny file-backed gen~ per object (same ports, no work: its outputs are zeros, identical shells share one compile). The engine
//      (2 in, 32 out) is wired from plugin~ and from the `mm_genin` hub (`gate 1 1`, every engine message arrives there; a scripted connect from
//      `t a` makes no cord); router r (32 in, 32 out) is wired from the engine's 32 outlets and to its 32 live.modulate~ AND 32 live.remote~
//      pool objects (`mm_mod_k`, `mm_rem_k`: SAVED objects, a runtime-scripted live.* never attaches to a parameter, only gen / MSP objects are
//      created here). One router per Task tick, so the face stays responsive; plugin~ -> plugout~ is never touched (audio passes throughout).
//   2. HOT-LOAD: `setattr gen <file>` on each shell (the engine first; the 8 routers share ONE file, so Max compiles the router once; each router
//      learns its first pool slot from `Param rbase` = 32 * r). Adding / removing a gen~ in a running device silences it for the compile, which a
//      hot-load into an existing shell does not (Glitch measured 2 - 24 ms).
//   3. CONFIRM: a new gen drops messages while it compiles, so every 150 ms the module re-sends the buffer binding and every stored Param
//      (`MM.dspResend()`, `route` / `curve` / `rbase` / `smooth` for each router) until the engine's frame counter (scope) has moved and each
//      router's heartbeat (route[ROUTE_HB_AT + r]) has moved and echoes `32 r + 1` (ROUTE_HB_ECHO_AT + r). Then `MM.dspSetState(true)` flushes the
//      queued messages (the mapper holds only the latest value of each) and the face's `DSP loading` pill goes away.
// One instance builds at a time (Global `megamod_dspq`): Reverb+ measured that Starts creating gen~ objects within a second of each other
// can leave one never added to the DSP chain. A graph that is not running after MMD_TIMEOUT_MS is torn down and built again (MMD_RETRIES).
// Load trace: Global("megamod_load_trace").text, one line per event with the epoch ms (scripts/measure_megamod_load.py reads it).

var MMD = {
    state: "idle", // idle -> wiring -> loading -> confirming -> ready | error
    error: "",
    step: 0,
    retries: 0,
    task: null,
    confirmTask: null,
    settleTask: null,
    t0: 0, // epoch ms of the first step (dsp-start)
    loadedAt: 0,
    engBase: -1,
    hbBase: [],
    cords: 0,
    token: Math.random(),
};
var MMD_STEP_MS = 4;
var MMD_CONFIRM_MS = 150;
var MMD_SETTLE_MS = 300;
var MMD_QUEUE_POLL_MS = 100;
var MMD_CLAIM_MS = 20000;
var MMD_TIMEOUT_MS = 5000;
var MMD_RETRIES = 2;
var MMD_T_LOAD = Date.now();

function mmdHost() {
    return (typeof MM_THIS !== "undefined" && MM_THIS && MM_THIS.patcher) ? MM_THIS.patcher : null;
}

var mmdSelfId = "?";
function mmdTrace(tag, msg) {
    try {
        if (mmdSelfId === "?" && typeof LiveAPI !== "undefined") {
            try { mmdSelfId = String(new LiveAPI(function () {}, "this_device").id); } catch (e) { mmdSelfId = "0"; }
        }
        var g = new Global("megamod_load_trace");
        var line = tag + " t=" + Date.now() + " +" + (Date.now() - MMD_T_LOAD) + (msg ? " " + msg : "") + " [#" + mmdSelfId + "]";
        var lines = (g.text ? String(g.text).split("\n") : []).concat([line]);
        g.text = lines.slice(-80).join("\n");
    } catch (e) {}
}

function mmdPath(kind) {
    return "/tmp/megamod_" + kind + "_" + MM_GEN[kind].hash + ".gendsp";
}
/** @param {string} path @param {string} text */
function mmdWriteFile(path, text) {
    try {
        var rf = new File(path, "read");
        var have = rf.isopen && rf.eof === text.length;
        rf.close();
        if (have) return true;
    } catch (e) {}
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) return false;
    f.eof = 0;
    for (var i = 0; i < text.length; i += 16384) f.writestring(text.substring(i, i + 16384));
    f.close();
    return true;
}

function mmdObj(name) {
    var h = mmdHost();
    if (!h) return null;
    try { return h.getnamed(name) || null; } catch (e) { return null; }
}
function mmdConnect(a, ao, b, bi) {
    var h = mmdHost();
    if (!a || !b) throw new Error("connect: missing object");
    h.connect(a, ao, b, bi);
    MMD.cords++;
}

// ---- the single-builder token -----------------------------------------------------------------------------------------------------------
function mmdClaim() {
    var q = new Global("megamod_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== MMD.token && now - Number(q.t) < MMD_CLAIM_MS) return false;
    q.owner = MMD.token;
    q.t = now;
    return true;
}
function mmdRelease() {
    try {
        var q = new Global("megamod_dspq");
        if (q.owner === MMD.token) q.owner = 0;
    } catch (e) {}
}

// ---- messages to the routers (direct, they are not wired to any message source) ---------------------------------------------------------
/** A message to every router gen~ (no-op while there are none). Called by the mapper for `smooth`. */
function mmdRouterMsg(key, value) {
    for (var r = 0; r < ROUTERS; r++) {
        var o = mmdObj("mm_router_" + r);
        if (!o) continue;
        try { o.message(key, value); } catch (e) {}
    }
}
function mmdBindMessages() {
    var n = MM.bufferNames();
    if (!n) return;
    // what the static message box used to send to the engine at loadbang
    outlet(0, "gen", "cfg", n[BUF_CFG]);
    outlet(0, "gen", "mseg", n[BUF_MSEG]);
    outlet(0, "gen", "steps", n[BUF_STEPS]);
    outlet(0, "gen", "scope", n[BUF_SCOPE]);
    if (n[BUF_INT]) outlet(0, "gen", "ibuf", n[BUF_INT]);
    if (n[BUF_ICURVE]) outlet(0, "gen", "icurve", n[BUF_ICURVE]);
    outlet(0, "gen", "route", n[BUF_ROUTE]);
    for (var r = 0; r < ROUTERS; r++) {
        var o = mmdObj("mm_router_" + r);
        if (!o) continue;
        try {
            o.message("route", n[BUF_ROUTE]);
            o.message("curve", n[BUF_CURVE]);
            o.message("rbase", r * ROUTER_SLOTS);
        } catch (e) {}
    }
}
/** Everything a gen that has just been created needs: the buffer binding, the transport state, every stored Param, the routers' smoothing. */
function mmdResendAll() {
    mmdBindMessages();
    outlet(0, "transport", "bang");
    MM.dspResend();
}

// ---- telemetry the confirm loop reads --------------------------------------------------------------------------------------------------
function mmdPeek(name, index) {
    if (!name) return -1;
    try {
        var v = new Buffer(name).peek(1, index, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (e) { return -1; }
}
function mmdEngineFrames() {
    var n = MM.bufferNames();
    return n ? mmdPeek(n[BUF_SCOPE], SCOPE_FRAME) : -1;
}
function mmdHeartbeat(r) {
    var n = MM.bufferNames();
    return n ? mmdPeek(n[BUF_ROUTE], ROUTE_HB_AT + r) : -1;
}
function mmdEcho(r) {
    var n = MM.bufferNames();
    return n ? mmdPeek(n[BUF_ROUTE], ROUTE_HB_ECHO_AT + r) : -1;
}

// ---- the build --------------------------------------------------------------------------------------------------------------------------
function mmdSchedule() {
    if (MMD.state !== "idle") return;
    if (!MMD.task) MMD.task = new Task(mmdTick, MM_THIS);
    MMD.task.schedule(30); // let the face paint first
}
function mmdNext(ms) {
    if (!MMD.task) MMD.task = new Task(mmdTick, MM_THIS);
    MMD.task.schedule(ms === undefined ? MMD_STEP_MS : ms);
}

function mmdFail(err) {
    MMD.state = "error";
    MMD.error = String(err && err.message ? err.message : err);
    mmdRelease();
    mmdTrace("dsp-error", MMD.error);
    post("Mega Modulator: DSP load failed: " + MMD.error + "\n");
    MM.dspSetState(false, MMD.error);
}

function mmdWireEngine(h) {
    mmdWriteShells();
    var path = mmdPath("shellEngine");
    var g = h.newdefault(120, 520, "gen~", "@gen", path);
    if (!g) throw new Error("no engine gen~");
    g.varname = "mm_engine";
    var hub = mmdObj("mm_genin"), pin = mmdObj("mm_plugin");
    if (!hub || !pin) throw new Error("missing hub / plugin~");
    mmdConnect(hub, 0, g, 0);
    mmdConnect(pin, 0, g, 0);
    mmdConnect(pin, 1, g, 1);
}
function mmdWriteShells() {
    if (!mmdWriteFile(mmdPath("shellEngine"), MM_GEN.shellEngine.text)) throw new Error("cannot write the engine shell");
    if (!mmdWriteFile(mmdPath("shellRouter"), MM_GEN.shellRouter.text)) throw new Error("cannot write the router shell");
}
function mmdWireRouter(h, r) {
    var path = mmdPath("shellRouter");
    var g = h.newdefault(20 + 60 * r, 1000, "gen~", "@gen", path);
    if (!g) throw new Error("no router gen~ " + r);
    g.varname = "mm_router_" + r;
    var eng = mmdObj("mm_engine");
    for (var i = 0; i < ENGINE_OUTS; i++) mmdConnect(eng, i, g, i);
    for (var j = 0; j < ROUTER_SLOTS; j++) {
        var k = r * ROUTER_SLOTS + j;
        mmdConnect(g, j, mmdObj("mm_mod_" + k), 0);
        mmdConnect(g, j, mmdObj("mm_rem_" + k), 0);
    }
}
function mmdTearDown(h) {
    for (var r = 0; r < ROUTERS; r++) { var o = mmdObj("mm_router_" + r); if (o) { try { h.remove(o); } catch (e) {} } }
    var e = mmdObj("mm_engine");
    if (e) { try { h.remove(e); } catch (x) {} }
    MMD.cords = 0;
}

// step 0 claims, 1 wires the engine, 2..9 wire one router each, 10 hot-loads the engine, 11..18 hot-load one router each, then confirms
function mmdTick() {
    try {
        var h = mmdHost();
        if (!h || typeof MM_GEN === "undefined") throw new Error("no patcher / gen text");
        if (MMD.state === "error" || MMD.state === "ready") return;
        var s = MMD.step;
        if (s === 0) {
            if (!mmdClaim()) { mmdNext(MMD_QUEUE_POLL_MS); return; }
            MMD.state = "wiring";
            MMD.t0 = Date.now();
            mmdTrace("dsp-start", MMD.retries ? "retry " + MMD.retries : "");
            MM.dspSetState(false, ""); // (redraw the pill)
        } else if (s === 1) {
            mmdWireEngine(h);
            mmdTrace("engine-wired", "cords " + MMD.cords);
        } else if (s >= 2 && s < 2 + ROUTERS) {
            mmdWireRouter(h, s - 2);
            if (s === 1 + ROUTERS) mmdTrace("routers-wired", "cords " + MMD.cords + " in " + (Date.now() - MMD.t0) + " ms");
        } else if (s === 2 + ROUTERS) {
            MMD.state = "loading";
            var nm = MM.bufferNames();
            MMD.engBase = mmdEngineFrames();
            MMD.hbBase = [];
            for (var q = 0; q < ROUTERS; q++) MMD.hbBase.push(mmdHeartbeat(q));
            if (!mmdWriteFile(mmdPath("engine"), MM_GEN.engine.text) || !mmdWriteFile(mmdPath("router"), MM_GEN.router.text)) throw new Error("cannot write the gen files");
            var t1 = Date.now();
            mmdObj("mm_engine").setattr("gen", mmdPath("engine"));
            mmdTrace("engine-loaded", (Date.now() - t1) + " ms" + (nm ? "" : " (no buffer names yet)"));
        } else if (s > 2 + ROUTERS && s <= 2 + 2 * ROUTERS) {
            var r = s - 3 - ROUTERS;
            var t2 = Date.now();
            mmdObj("mm_router_" + r).setattr("gen", mmdPath("router"));
            if (r === 0 || r === ROUTERS - 1) mmdTrace("router-loaded", r + " " + (Date.now() - t2) + " ms");
            if (r === ROUTERS - 1) {
                MMD.loadedAt = Date.now();
                MMD.state = "confirming";
                mmdResendAll();
                mmdConfirm();
                MMD.step++;
                return;
            }
        } else {
            return;
        }
        MMD.step++;
        mmdNext(s === 0 ? 1 : MMD_STEP_MS);
    } catch (err) {
        mmdFail(err);
    }
}

function mmdRunning() {
    var f = mmdEngineFrames();
    if (f < 0 || f === MMD.engBase) return false;
    for (var r = 0; r < ROUTERS; r++) {
        var hb = mmdHeartbeat(r);
        if (hb < 0 || hb === MMD.hbBase[r]) return false;
        if (mmdEcho(r) !== r * ROUTER_SLOTS + 1) return false;
    }
    return true;
}

function mmdConfirm() {
    try {
        if (MMD.state !== "confirming") return;
        if (mmdRunning()) {
            MMD.state = "ready";
            MMD.error = "";
            mmdTrace("dsp-ready", "after " + (Date.now() - MMD.t0) + " ms (loaded " + (Date.now() - MMD.loadedAt) + " ms ago)");
            mmdRelease();
            mmdResendAll();
            MM.dspSetState(true, "");
            if (!MMD.settleTask) MMD.settleTask = new Task(mmdResendAll, MM_THIS);
            MMD.settleTask.schedule(MMD_SETTLE_MS); // the last re-send may have reached a gen that was still compiling
            return;
        }
        if (Date.now() - MMD.loadedAt > MMD_TIMEOUT_MS) {
            var h = mmdHost();
            if (MMD.retries < MMD_RETRIES && h) {
                MMD.retries++;
                mmdTrace("dsp-retry", "engine frames " + mmdEngineFrames() + " heartbeats " + [0, 1, 2, 3, 4, 5, 6, 7].map(mmdHeartbeat).join(","));
                mmdTearDown(h);
                MMD.step = 1; // (keeps the claim: the token stays ours until ready / failed)
                MMD.state = "wiring";
                mmdNext(1);
                return;
            }
            mmdFail("not running (engine frames " + mmdEngineFrames() + ")");
            return;
        }
        mmdResendAll();
        if (!MMD.confirmTask) MMD.confirmTask = new Task(mmdConfirm, MM_THIS);
        MMD.confirmTask.schedule(MMD_CONFIRM_MS);
    } catch (err) {
        mmdFail(err);
    }
}

/** Test / diagnostics: the objects and cord counts of the graph (hook `dsp_diag`). */
function mmdDiag() {
    var d = { state: MMD.state, error: MMD.error, retries: MMD.retries, cords: MMD.cords, engineFrames: mmdEngineFrames(), routers: [] };
    var e = mmdObj("mm_engine");
    d.engine = e ? { cls: e.maxclass } : null;
    d.plug = { plugin: !!mmdObj("mm_plugin"), plugout: !!mmdObj("mm_plugout"), hub: !!mmdObj("mm_genin") };
    for (var r = 0; r < ROUTERS; r++) {
        var o = mmdObj("mm_router_" + r);
        d.routers.push({ present: !!o, hb: mmdHeartbeat(r), echo: mmdEcho(r) });
    }
    return d;
}

/** Test hook (`dsp_restart`): tear the graph down and build it again, as a fresh load would (the stored Params must be re-sent: the queued-then-flushed path). */
function mmdRestart() {
    var h = mmdHost();
    if (!h) return;
    var tasks = [MMD.task, MMD.confirmTask, MMD.settleTask];
    for (var i = 0; i < tasks.length; i++) { if (tasks[i]) { try { tasks[i].cancel(); } catch (e) {} } }
    mmdRelease();
    mmdTearDown(h);
    MMD.state = "idle";
    MMD.step = 0;
    MMD.retries = 0;
    MMD.error = "";
    MM.dspSetState(false, "");
    mmdSchedule();
}
