// Amp engine, shared by every Amp face (concatenated into the face's main v8ui after amp_config.js,
// before the face file). The face draws; the engine owns the DSP, the model and the parameters.
//
// Build header globals: AMP_TEMPLATE (src/amp_core.genexpr without comments), AMP_BUILTIN (the
// built-in .nam documents, one per Model enum entry before "File"), AMP_FACE (design slug).
//
// Patcher contract (scripts/build_amp.py):
//   in : setnames <scope> <weights> <coeffs> <scopeA> <tableA> <coeffsA>   (loadbang; the --- names expanded by the patcher;
//                                             the A buffers belong to the Analog shell)
//        set_<key> <v>                          (every parameter's live.* object, AMP_PARAMS)
//        init_dsp                               (live.thisdevice)
//        dropfile <path>                        (the Model File live.drop, also Live's replay on load)
//        browsed <path>                         (opendialog)
//   out 0: param <key> <v> | browse | dropset <path>  -> route -> live.* / opendialog / live.drop
//   out 1: gen messages                               -> route a -> amp_genin (gate 1 1) -> gen~ amp_gen (Neural)
//                                                      "a <msg>" -> amp_genin_a -> gen~ amp_gen_a (Analog)
// Engine = Analog (src/amp_analog.js, src/amp_analog_core.genexpr): a second gen~ runs the modelled circuits from
// a table (aaBank) in ---ampa, two banks: a Circuit change writes the idle bank and the gen fades over to it
// (no recompile). The two gens sit on the same plugout~ and crossfade by `active` (the inactive one sleeps).
// Each shell is created the first time its engine is selected.
// The device ships without its gen~ (AGENTS 1d). The gen code depends on the model's architecture,
// so it is generated here (ampGenCode) and written to /tmp/amp_<hash>.gendsp: models of the same
// architecture share one file / compile and switch by weight bank (`wbase`, a 128-sample fade and a
// receptive-field mute in the gen); a new architecture hot-loads the file into the same gen~
// (`setattr gen`), which is silent only for its compile.
//
// API for faces:
//   ampP[key]                raw parameter values (AMP_PARAMS units)
//   ampSet(key, v)           change a parameter (through its live.* object: automation, undo)
//   ampBrowse()              open the file dialog for a .nam file
//   amp.model                {name, label, arch, kind, layers, rf, error, file, weights,
//                             arrays: [{ch, head, gated, dilations}], dilations (all layers in order)}
//   amp.dsp                  {ready, error}
//   ampTel                   telemetry header (AMP_SCOPE names, lowercase) of the latest frame
//   ampLayers()              per-layer activity array (0..1-ish), length = model layer count
//   ampXY(n)                 last n [in, out] pairs of the model (n <= 512)
//   ampOutRing(n)            last n output samples (n <= 2048)
//   ampToneCurve(f)          tone stack + cab response in dB at f
//   ampModelNames()          Model enum labels with the loaded file's name for "File"
// Face hooks (optional): ampFaceFrame() -> true to redraw on a new telemetry frame; ampFaceChanged(what).

inlets = 1;
outlets = 2;     // without this the v8ui has one outlet and every gen message (outlet 1) is dropped
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var ampHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var ampP = {};
for (var ampK in AMP_PARAMS) ampP[ampK] = AMP_PARAMS[ampK][4];
var amp = {
    dsp: { ready: 0, error: "", createdAt: 0, alive0: -1, retries: 0, fastUntil: 0, waited: 0, lastTick: 0 },
    dspA: { ready: 0, error: "", createdAt: 0, alive0: -1, retries: 0, fastUntil: 0, waited: 0, lastTick: 0 },
    analog: { idx: -1, info: /** @type {any} */ (null), bank: 1, path: "", sr: 0, speaker: -1, error: "" },
    model: { name: "", label: "", arch: "", kind: "", layers: 0, rf: 1, error: "", file: "", arrays: /** @type {any[]} */ ([]), dilations: /** @type {number[]} */ ([]), weights: 0 },
    names: { scope: "", w: "", cf: "", scopeA: "", a: "", cfa: "" },
    bank: 1, testAmp: 0, genPath: "", genArch: "", sr: 48000, loudDb: 0, filePath: "", fileModel: null,
    frame: -1, idle: 0, poll: null, resend: null, confirm: null, started: 0,
    initTask: /** @type {any} */ (null), waitTask: /** @type {any} */ (null), claimTask: /** @type {any} */ (null)
};
var ampTel = { frames: 0, sr: 48000, in_pk: 0, out_pk: 0, gate: 1, sat: 0, in_rms: 0, out_rms: 0, model_ok: 0, nlayers: 0, nam_pk: 0, asleep: 0, switching: 0, alive: 0 };
var ampLayerVals = [];
var AMP_TEL_KEYS = ["frames", "sr", "in_pk", "out_pk", "gate", "sat", "in_rms", "out_rms", "model_ok", "nlayers", "nam_pk", "asleep", "xy_head", "out_head", "switching", "alive"];
var ampToneCache = null;
var ampMeterVals = { sag: 0, gr: 0, exc: 0, bias: 0 };
/** @returns {boolean} */
function ampIsAnalog() { return Math.round(Number(ampP.engine) || 0) === AMP_ENGINE.ANALOG; }

/** @param {string} msg */
function ampLog(msg) {
    if (typeof Global === "undefined") return;
    var g = new Global("amp_trace");
    var t = String(g.text || "");
    if (t.length > 6000) t = t.slice(-4000);
    g.text = t + Date.now() % 1000000 + " " + AMP_FACE + " " + msg + "\n";
}

// ---- patcher messages ---------------------------------------------------------------------------

function setnames(scope, w, cf, scopeA, a, cfa) {
    ampLog("setnames " + scope + " " + w + " " + cf + " " + scopeA + " " + a + " " + cfa);
    amp.names.scope = String(scope);
    amp.names.w = String(w);
    amp.names.cf = String(cf);
    amp.names.scopeA = scopeA === undefined ? "" : String(scopeA);
    amp.names.a = a === undefined ? "" : String(a);
    amp.names.cfa = cfa === undefined ? "" : String(cfa);
    ampWriteTone();
    ampSendGen();
}

function anything() {
    var m = String(messagename);
    if (m.indexOf("set_") === 0) {
        var key = m.slice(4);
        if (!(key in AMP_PARAMS)) return;
        var v = Number(arguments[0]);
        if (!isFinite(v)) return;
        ampP[key] = v;
        ampOnParam(key, v);
    }
}

/** @param {string} key @param {number} v */
function ampOnParam(key, v) {
    var spec = AMP_PARAMS[key];
    if (spec[7]) {
        ampGen(spec[7], ampGenValue(key, v));
        ampGenA(spec[7], key === "eqpos" ? 0 : ampGenValue(key, v));
    }
    if (key === "bass" || key === "mid" || key === "treble" || key === "presence" || key === "cab" || key === "speaker") ampWriteTone();
    if (key === "normalize") ampGen("normdb", v > 0.5 ? amp.loudDb : 0);
    if (key === "engine") {
        ampApplyLayout();
        if (amp.started) ampEngineSoon();
    }
    if ((key === "circuit" || key === "speaker") && amp.started && ampIsAnalog()) ampEngineSoon();
    if (key === "model" && amp.started && !ampIsAnalog()) {
        // Next tick: a model load (parse, weights, maybe a gen hot-load) must not run inside Live's parameter
        // notification (the LOM set that caused it waits for it, and so does the bridge's eval).
        var mi = Math.round(v);
        amp.modelTask = new Task(function () { ampSelectModel(mi); }, this);
        amp.modelTask.schedule(5);
    }
    if (typeof ampFaceChanged === "function") ampFaceChanged(key);
    mgraphics.redraw();
}

function init_dsp() {
    ampLog("init_dsp started=" + amp.started + " names=" + amp.names.w);
    if (amp.started) return;
    amp.started = 1;
    // Tasks are kept on `amp`: a Task held only by a local can be garbage-collected before it fires
    // (seen in Live: some instances never loaded a model).
    amp.initTask = new Task(function () { ampEngineApply(); }, this);
    amp.initTask.schedule(30);
    // The Model / Circuit tabs and the Load / Speaker buttons share their rects: show the engine's (the patcher can
    // still be loading at the first call, so it is repeated).
    amp.layoutTasks = [];
    [30, 400, 1500].forEach(function (ms) { var t = new Task(ampApplyLayout, this); t.schedule(ms); amp.layoutTasks.push(t); });
    // Live draws v8ui canvases in front of live.* boxes (Deviate): bring a drop zone that lies over the display
    // forward so it gets the drag. Retried, the patcher can still be loading.
    amp.frontTask = new Task(function () {
        var d = ampHost ? ampHost.getnamed("Model File") : null;
        if (d) ampHost.bringtofront(d);
    }, this);
    amp.frontTask.schedule(400);
    if (!amp.poll) { amp.poll = new Task(ampPoll, this); amp.poll.interval = 33; amp.poll.repeat(); }
    if (!amp.resend) { amp.resend = new Task(ampResendTick, this); amp.resend.interval = 150; amp.resend.repeat(); }
}

function ampJoin(args) {
    var a = [];
    for (var i = 0; i < args.length; i++) a.push(String(args[i]));
    return a.join(" ");
}

function dropfile() {
    var p = ampJoin(arguments);
    if (!p || p === "none" || p === "0") return;
    if (p === amp.filePath && amp.fileModel) return;     // Live replaying the loaded path
    ampLoadFile(p, Math.round(ampP.model) === AMP_FILE_INDEX || !amp.started);
}

function browsed() {
    var p = ampJoin(arguments);
    if (!p) return;
    outlet(0, "dropset", p);
    ampLoadFile(p, true);
}

// ---- test hooks (receive #0-amptest; the Live check drives them through the MCP bridge) ----------

// Every hook takes the face slug (or "all") first: the hook name is shared by every Amp instance.
/** @param {string} face */
function ampTestMine(face) { return String(face) === "all" || String(face) === AMP_FACE; }

/** @param {string} face @param {number} a */
// The level is kept and re-sent with the gen state, so a shell created later (the first switch to Analog) gets it too.
function test_tone(face, a) { if (ampTestMine(face)) { amp.testAmp = Number(a) || 0; ampGen("testamp", amp.testAmp); ampGenA("testamp", amp.testAmp); } }

function test_load() {
    var a = Array.prototype.slice.call(arguments);
    if (!ampTestMine(a.shift())) return;
    // Deferred: the bridge's eval waits for this call, and a parse + gen hot-load can outlast its timeout.
    var path = ampJoin(a);
    amp.testLoadTask = new Task(function () { ampLoadFile(path, true); }, this);
    amp.testLoadTask.schedule(10);
}

/** @param {string} face */
function test_report(face) {
    if (typeof Global === "undefined" || !ampTestMine(face)) return;
    var g = new Global("amp_test");
    var bi = {};
    try {
        var gg = ampHost ? ampHost.getnamed("amp_gen") : null;
        bi.gen = gg ? { cls: gg.maxclass, gen: String(gg.getattr("gen")) } : null;
        bi.scopeFrames = new Buffer(amp.names.scope).framecount();
        bi.wFrames = new Buffer(amp.names.w).framecount();
        bi.w0 = new Buffer(amp.names.w).peek(1, amp.bank * AMP_WBANK, 4);
        bi.cf50 = new Buffer(amp.names.cf).peek(1, 50, 1);
    } catch (err) { bi.err = String(err); }
    try {
        var ga = ampHost ? ampHost.getnamed("amp_gen_a") : null;
        bi.genA = ga ? { cls: ga.maxclass, gen: String(ga.getattr("gen")) } : null;
        bi.a0 = amp.names.a ? new Buffer(amp.names.a).peek(1, amp.analog.bank * AA_BANK, 6) : null;
        bi.cfa50 = amp.names.cfa ? new Buffer(amp.names.cfa).peek(1, 50, 1) : null;
        var lay = {};
        ["Model", "Circuit", "Speaker", "amp_load"].forEach(function (n) { var o = ampHost ? ampHost.getnamed(n) : null; lay[n] = o ? o.getattr("hidden") : null; });
        bi.layout = lay;
    } catch (err) { bi.errA = String(err); }
    g["report_" + AMP_FACE] = JSON.stringify({ names: amp.names, started: amp.started, bi: bi, face: AMP_FACE, dsp: amp.dsp, dspA: amp.dspA, model: amp.model, file: amp.filePath, genArch: amp.genArch,
        engine: ampIsAnalog() ? "analog" : "neural", analog: { idx: amp.analog.idx, bank: amp.analog.bank, speaker: amp.analog.speaker, error: amp.analog.error, id: amp.analog.info ? amp.analog.info.id : "" }, meters: ampMeterVals,
        bank: amp.bank, tel: ampTel, layers: ampLayerVals.slice(0, 48), p: ampP, frame: amp.frame });
}

// ---- face API -----------------------------------------------------------------------------------

/** @param {string} key @param {number} v */
function ampSet(key, v) {
    var s = AMP_PARAMS[key];
    if (!s) return;
    v = Math.max(s[2], Math.min(s[3], Number(v)));
    if (s[5] !== 0) v = Math.round(v);
    ampP[key] = v;
    outlet(0, "param", key, v);
}

function ampBrowse() { outlet(0, "browse"); }

function ampModelNames() {
    var e = AMP_PARAMS.model[8].slice();
    if (amp.fileModel) e[AMP_FILE_INDEX] = amp.fileModel.name || ampBaseName(amp.filePath);
    return e;
}

/** @param {string} p */
function ampBaseName(p) {
    var s = String(p || "").replace(/^.*[\/:]/, "");
    return s.replace(/\.nam$/i, "");
}

// ---- model loading ------------------------------------------------------------------------------

/** @param {number} i */
function ampSelectModel(i) {
    if (i >= 0 && i < AMP_BUILTIN.length) {
        ampLoadModel(AMP_BUILTIN[i], AMP_PARAMS.model[8][i], "");
    } else if (amp.fileModel) {
        ampLoadModel(amp.fileModel.doc, amp.fileModel.name, amp.filePath);
    } else {
        amp.model.error = amp.filePath ? amp.model.error : "No file: drop or load a .nam";
        mgraphics.redraw();
    }
}

/** @param {string} path */
function ampReadText(path) {
    var f = new File(path, "read");
    if (!f.isopen) throw new Error("cannot open file");
    var parts = [], guard = 0;
    while (f.position < f.eof && guard < 100000) {
        parts.push(f.readstring(16384));
        guard++;
    }
    f.close();
    return parts.join("");
}

/** @param {string} path @param {boolean} activate */
function ampLoadFile(path, activate) {
    var doc;
    try {
        doc = JSON.parse(ampReadText(path));
        ampParseNam(doc);   // validate before keeping it
    } catch (err) {
        amp.model.error = ampBaseName(path) + ": " + String(err && err.message ? err.message : err);
        ampLog("file error " + amp.model.error);
        mgraphics.redraw();
        return;
    }
    amp.filePath = path;
    var meta = doc.metadata || {};
    amp.fileModel = { doc: doc, name: String(meta.name || ampBaseName(path)) };
    if (activate) {
        if (ampIsAnalog()) ampSet("engine", AMP_ENGINE.NEURAL);   // a dropped .nam plays on the Neural engine
        if (Math.round(ampP.model) !== AMP_FILE_INDEX) ampSet("model", AMP_FILE_INDEX);   // its echo loads it
        else if (amp.started) ampSelectModel(AMP_FILE_INDEX);
    }
    if (typeof ampFaceChanged === "function") ampFaceChanged("file");
    mgraphics.redraw();
}

/** @param {any} doc @param {string} label @param {string} file */
function ampLoadModel(doc, label, file) {
    ampLog("load model " + label + " names=" + amp.names.w);
    var m;
    try {
        m = ampParseNam(doc);
    } catch (err) {
        amp.model.error = String(err && err.message ? err.message : err);
        mgraphics.redraw();
        return;
    }
    if (!amp.names.w || typeof Buffer === "undefined") {
        if (typeof Task !== "undefined" && amp.started) { amp.waitTask = new Task(function () { ampLoadModel(doc, label, file); }, this); amp.waitTask.schedule(100); }
        return;
    }
    var code = ampGenCode(AMP_TEMPLATE, m);
    var arch = ampArchKey(m);
    var path = "/tmp/amp_" + ampHash(code) + ".gendsp";
    try {
        ampWriteGendsp(path, ampGendsp(code));
    } catch (err) {
        amp.dsp.error = "cannot write " + path;
        mgraphics.redraw();
        return;
    }
    var bank = 1 - amp.bank;
    var wbuf = new Buffer(amp.names.w);
    var off = bank * AMP_WBANK;
    for (var i = 0; i < m.weights.length; i += 2048) {
        wbuf.poke(1, off + i, m.weights.slice(i, Math.min(m.weights.length, i + 2048)));
    }
    amp.bank = bank;
    amp.loudDb = ampNormDb(m);
    amp.model = ampModelInfo(m, label || m.name, arch, file);
    ampLayerVals = [];
    var g = ampHost ? ampHost.getnamed("amp_gen") : null;
    if (!g) {
        amp.genPath = path;
        amp.genArch = arch;
        ampDspCreate();
    } else if (arch !== amp.genArch || path !== amp.genPath) {
        amp.genPath = path;
        amp.genArch = arch;
        g.setattr("gen", path);
        amp.dsp.fastUntil = Date.now() + 4000;
        ampLog("hot-load " + arch);
    }
    ampSendGen();
    if (typeof ampFaceChanged === "function") ampFaceChanged("model");
    mgraphics.redraw();
}

/** Face-facing description of a parsed model. @param {any} m @param {string} name @param {string} arch @param {string} file */
function ampModelInfo(m, name, arch, file) {
    var arrays = [], dil = [];
    if (m.kind === "WaveNet") {
        for (var a = 0; a < m.layers.length; a++) {
            var ds = m.layers[a].layers.map(function (/** @type {any} */ l) { return l.d; });
            arrays.push({ ch: m.layers[a].ch, head: m.layers[a].head, gated: m.layers[a].gated, dilations: ds });
            dil = dil.concat(ds);
        }
    } else {
        for (var l = 0; l < m.lstm.layers; l++) arrays.push({ ch: m.lstm.hidden, head: 1, gated: false, dilations: [1] });
    }
    return { name: name, label: ampArchLabel(m), arch: arch, kind: m.kind, layers: ampLayerCount(m), rf: m.receptiveField,
        error: "", file: file, arrays: arrays, dilations: dil, weights: m.nWeights, credit: m.credit || "" };
}

/** @param {string} path @param {string} text */
function ampWriteGendsp(path, text) {
    try {
        var rf = new File(path, "read");
        var have = rf.isopen && rf.eof === text.length;
        rf.close();
        if (have) return;
    } catch (_) {}
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) throw new Error("cannot write");
    f.eof = 0;
    for (var i = 0; i < text.length; i += 16384) f.writestring(text.substring(i, i + 16384));
    f.close();
}

// ---- DSP ----------------------------------------------------------------------------------------
// Two shells: "n" (Neural: gen~ amp_gen, hub amp_genin) and "a" (Analog: gen~ amp_gen_a, hub amp_genin_a). Each is
// created the first time its engine plays and kept; an Engine change crossfades them by `active`.

/** @param {string} k */
function ampShell(k) {
    return k === "a" ? { dsp: amp.dspA, gen: "amp_gen_a", hub: "amp_genin_a", path: amp.analog.path, scope: amp.names.scopeA, x: 0 }
        : { dsp: amp.dsp, gen: "amp_gen", hub: "amp_genin", path: amp.genPath, scope: amp.names.scope, x: 1 };
}

function ampDspClaim() {
    var q = new Global("amp_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== amp.names.scope && now - Number(q.t) < 15000) return false;
    q.owner = amp.names.scope;
    q.t = now;
    return true;
}

function ampDspRelease() {
    var q = new Global("amp_dspq");
    if (q.owner === amp.names.scope) q.owner = 0;
}

/** @param {string} [k] "n" (default) or "a" */
function ampDspCreate(k) {
    var key = k === "a" ? "a" : "n", sh = ampShell(key);
    if (!ampHost || !sh.path) return;
    if (!ampDspClaim()) {
        var ct = new Task(function () { ampDspCreate(key); }, this);
        if (key === "a") amp.claimTaskA = ct; else amp.claimTask = ct;
        ct.schedule(100);
        return;
    }
    try {
        var g = ampHost.getnamed(sh.gen);
        if (!g) {
            g = ampHost.newdefault(key === "a" ? 200 : 40, 460, "gen~", "@gen", sh.path);
            if (!g) throw new Error("no gen~");
            g.varname = sh.gen;
            var hub = ampHost.getnamed(sh.hub), pin = ampHost.getnamed("amp_plugin"), pout = ampHost.getnamed("amp_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            ampHost.connect(hub, 0, g, 0);
            ampHost.connect(pin, 0, g, 0);
            ampHost.connect(pin, 1, g, 1);
            ampHost.connect(g, 0, pout, 0);
            ampHost.connect(g, 1, pout, 1);
        }
        sh.dsp.createdAt = Date.now();
        sh.dsp.waited = 0;
        sh.dsp.lastTick = 0;
        sh.dsp.alive0 = ampPeekOf(sh.scope, AMP_SCOPE.ALIVE);
        sh.dsp.fastUntil = Date.now() + 4000;
        ampLog("gen created " + (key === "a" ? "analog" : amp.genArch));
    } catch (err) {
        sh.dsp.error = String(err && err.message ? err.message : err);
        ampDspRelease();
        ampLog("dsp error " + sh.dsp.error);
    }
}

/** @param {string} msg @param {number} v */
function ampGen(msg, v) { outlet(1, msg, v); }
/** Message to the Analog shell. @param {string} msg @param {number|string} v */
function ampGenA(msg, v) { if (amp.names.a) outlet(1, "a", msg, v); }

function ampSendGen() {
    var an = ampIsAnalog() ? 1 : 0;
    if (amp.names.w) {
        outlet(1, "w", amp.names.w);
        outlet(1, "cf", amp.names.cf);
        outlet(1, "scope", amp.names.scope);
    }
    for (var k in AMP_PARAMS) {
        if (AMP_PARAMS[k][7]) outlet(1, AMP_PARAMS[k][7], ampGenValue(k, ampP[k]));
    }
    outlet(1, "normdb", ampP.normalize > 0.5 ? amp.loudDb : 0);
    outlet(1, "sagref", amp.loudDb);
    outlet(1, "active", 1 - an);
    if (amp.testAmp) outlet(1, "testamp", amp.testAmp);
    if (amp.model.arch) {
        outlet(1, "wbase", amp.bank * AMP_WBANK);
        outlet(1, "mok", 1);
    }
    if (amp.names.a) {
        ampGenA("w", amp.names.a);
        ampGenA("cf", amp.names.cfa);
        ampGenA("scope", amp.names.scopeA);
        for (var ka in AMP_PARAMS) {
            if (AMP_PARAMS[ka][7]) ampGenA(AMP_PARAMS[ka][7], ka === "eqpos" ? 0 : ampGenValue(ka, ampP[ka]));
        }
        ampGenA("normdb", 0);
        ampGenA("sagref", 0);
        ampGenA("active", an);
        if (amp.testAmp) ampGenA("testamp", amp.testAmp);
        if (amp.analog.idx >= 0) {
            ampGenA("wbase", amp.analog.bank * AA_BANK);
            ampGenA("mok", 1);
        }
    }
}

// Confirms each gen runs (its alive counter moves, also in silence), retries a gen~ that never starts,
// and keeps re-sending the gen state: fast for 4 s after a create / hot-load (a compiling gen drops
// messages), then once a second as a safety net (same values change nothing in the gen).
var ampResendCount = 0;
/** @param {string} key */
function ampConfirm(key) {
    var sh = ampShell(key), d = sh.dsp, now = Date.now();
    if (!d.createdAt || d.ready) return;
    var a = ampPeekOf(sh.scope, AMP_SCOPE.ALIVE);
    // The gen compiles on Max's main thread, which also runs this Task: a 12 s compile on a busy machine
    // arrives here as one long gap. Count only time the scheduler saw pass (at most 300 ms per tick), so a
    // slow compile is not mistaken for a gen~ that never runs (the retry used to compile it a second time).
    d.waited = (d.waited || 0) + (d.lastTick ? Math.min(now - d.lastTick, 300) : 0);
    d.lastTick = now;
    if (d.alive0 >= 0 && a >= 0 && a !== d.alive0) {
        d.ready = 1;
        d.error = "";
        ampDspRelease();
        ampLog((key === "a" ? "analog " : "") + "dsp ready after " + (now - d.createdAt) + " ms");
        mgraphics.redraw();
    } else if (d.alive0 < 0) {
        d.alive0 = a;
    } else if (d.waited > (d.retries ? 12000 : 8000)) {
        if (d.retries < 2) {
            d.retries++;
            try { var old = ampHost.getnamed(sh.gen); if (old) ampHost.remove(old); } catch (_) {}
            d.createdAt = 0;
            ampLog("dsp retry " + key);
            ampDspCreate(key);
        } else {
            d.error = "not running";
            ampDspRelease();
            mgraphics.redraw();
        }
    }
}
function ampResendTick() {
    var now = Date.now();
    ampConfirm("n");
    ampConfirm("a");
    ampResendCount++;
    if (now < amp.dsp.fastUntil || now < amp.dspA.fastUntil || ampResendCount % 7 === 0) ampSendGen();
}

// ---- engines ------------------------------------------------------------------------------------

function ampEngineSoon() {
    // Next tick: a load must not run inside Live's parameter notification (see ampOnParam's model case).
    amp.engineTask = new Task(ampEngineApply, this);
    amp.engineTask.schedule(5);
}

/** Load what the current Engine needs (the other shell keeps its state, muted by `active`). */
function ampEngineApply() {
    if (ampIsAnalog()) ampLoadAnalog(Math.round(Number(ampP.circuit) || 0));
    else ampSelectModel(Math.round(ampP.model));
    ampSendGen();
    ampWriteTone();
    ampApplyLayout();
    if (typeof ampFaceChanged === "function") ampFaceChanged("engine");
    mgraphics.redraw();
}

var AMP_ANALOG_CODE = "";
/** The circuit idx on the Analog shell: its table into the idle bank of ---ampa (the gen fades over to it). @param {number} idx */
function ampLoadAnalog(idx) {
    idx = Math.max(0, Math.min(AMP_ANALOG.length - 1, idx));
    if (!amp.names.a || typeof Buffer === "undefined") {
        if (typeof Task !== "undefined" && amp.started) { amp.waitTaskA = new Task(function () { ampLoadAnalog(idx); }, this); amp.waitTaskA.schedule(100); }
        return;
    }
    var spk = ampP.speaker > 0.5 ? 1 : 0;
    var info = aaInfo(idx);
    amp.analog.info = info;
    if (idx === amp.analog.idx && spk === amp.analog.speaker && amp.sr === amp.analog.sr) { ampSendGen(); return; }
    try {
        if (!AMP_ANALOG_CODE) AMP_ANALOG_CODE = aaGenCode(AMP_TEMPLATE, AMP_ANALOG_SRC);
        var path = "/tmp/amp_" + ampHash(AMP_ANALOG_CODE) + ".gendsp";
        ampWriteGendsp(path, ampGendsp(AMP_ANALOG_CODE));
        amp.analog.path = path;
        var tbl = aaBank(idx, amp.sr, spk);
        var bank = 1 - amp.analog.bank, buf = new Buffer(amp.names.a), off = bank * AA_BANK, arr = [];
        for (var i = 0; i < tbl.length; i++) arr.push(tbl[i]);
        for (i = 0; i < arr.length; i += 1024) buf.poke(1, off + i, arr.slice(i, Math.min(arr.length, i + 1024)));
        amp.analog.bank = bank;
        amp.analog.idx = idx;
        amp.analog.speaker = spk;
        amp.analog.sr = amp.sr;
        amp.analog.error = "";
    } catch (err) {
        amp.analog.error = String(err && err.message ? err.message : err);
        ampLog("analog error " + amp.analog.error);
        mgraphics.redraw();
        return;
    }
    ampLog("analog " + info.id + " bank " + amp.analog.bank);
    if (ampHost && !ampHost.getnamed("amp_gen_a")) ampDspCreate("a");
    ampWriteTone();
    ampSendGen();
    if (typeof ampFaceChanged === "function") ampFaceChanged("circuit");
    mgraphics.redraw();
}

// The Model / Circuit tabs and the Load / Speaker buttons share their rects; widgets the Analog circuit has no use for are dimmed.
function ampApplyLayout() {
    if (!ampHost) return;
    var an = ampIsAnalog();
    var show = function (name, on) {
        var o = ampHost.getnamed(name);
        if (!o) return;
        try { o.setattr("hidden", on ? 0 : 1); if (on) ampHost.bringtofront(o); } catch (_) {}
    };
    show("Model", !an);
    show("amp_load", !an);
    show("Circuit", an);
    show("Speaker", an);
    var role = an && amp.analog.info ? amp.analog.info.toneRole : null;
    var dim = function (name, on) {
        var o = ampHost.getnamed(name);
        if (o) { try { o.setattr("active", on ? 1 : 0); } catch (_) {} }
    };
    dim("Bass", !role || !!role.bass);
    dim("Middle", !role || !!role.mid);
    dim("Treble", !role || !!role.treble);
    dim("Presence", !role || role.presence !== "none");
    dim("Normalize", !an);
    dim("EQ Position", !an);
    dim("Cabinet", !an || ampP.speaker < 0.5 || !amp.analog.info || !amp.analog.info.hasSpeaker);
    dim("Speaker", !an || !amp.analog.info || amp.analog.info.hasSpeaker);
}

// ---- tone stack / cab coefficients ----------------------------------------------------------------

var ampCfVer = 0;

function ampWriteTone() {
    ampToneCache = ampToneBiquads(ampP, amp.sr);
    if (!amp.names.cf || typeof Buffer === "undefined") return;
    var flat = [];
    for (var i = 0; i < ampToneCache.length; i++) flat = flat.concat(ampToneCache[i]);
    var b = new Buffer(amp.names.cf);
    b.poke(1, 0, flat);
    // Slot 50 is a counter (> 0.5 = valid): the gen copies the coefficients once each time it changes.
    ampCfVer = ampCfVer >= 1000000 ? 1 : ampCfVer + 1;
    b.poke(1, 50, ampCfVer);
    ampWriteToneA();
}

// The Analog shell's ---ampcfa: the circuit's tone-stack coefficients (from its component values and the knobs) at 0..17,
// Presence at 18, then the cab biquads 4..9 at 20..49 (the Cabinet voicing only while the speaker is off or absent).
function ampWriteToneA() {
    if (!amp.names.cfa || typeof Buffer === "undefined") return;
    var idx = Math.round(Number(ampP.circuit) || 0), info = aaInfo(idx);
    var flat = aaToneTable(idx, ampP, amp.sr);
    var cab = ampToneBiquads(ampP, amp.sr);
    var useCab = !(ampP.speaker > 0.5 && info.hasSpeaker);
    for (var q = 4; q < 10; q++) flat = flat.concat(useCab ? cab[q] : [1, 0, 0, 0, 0]);
    var b = new Buffer(amp.names.cfa);
    b.poke(1, 0, flat);
    ampCfVer = ampCfVer >= 1000000 ? 1 : ampCfVer + 1;
    b.poke(1, 50, ampCfVer);
}

/** @param {number} f */
function ampToneCurve(f) {
    if (!ampToneCache) ampToneCache = ampToneBiquads(ampP, amp.sr);
    return ampResponseDb(ampToneCache, f, amp.sr);
}

// ---- telemetry ------------------------------------------------------------------------------------

/** The telemetry of the engine that plays. */
function ampScopeName() { return ampIsAnalog() ? amp.names.scopeA : amp.names.scope; }
/** @param {number} i */
function ampPeek(i) { return ampPeekOf(ampScopeName(), i); }
/** @param {string} name @param {number} i */
function ampPeekOf(name, i) {
    if (!name || typeof Buffer === "undefined") return -1;
    try {
        var v = new Buffer(name).peek(1, i, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (_) { return -1; }
}

/** @param {number} at @param {number} n */
function ampPeekN(at, n) {
    var nm = ampScopeName();
    if (!nm || typeof Buffer === "undefined") return [];
    var out = [];
    try {
        var b = new Buffer(nm);
        for (var i = 0; i < n; i += 1024) {
            var k = Math.min(1024, n - i);
            var v = b.peek(1, at + i, k);
            if (typeof v === "number") v = [v];
            for (var j = 0; j < k; j++) out.push(Number(v[j]) || 0);
        }
    } catch (_) {}
    return out;
}

function ampLayers() { return ampLayerVals; }
/** Analog meters: power-supply sag (0..1), compressor gain reduction (0..1), cone excursion (1 = xmax / 3), bias shift. */
function ampMeters() { return ampMeterVals; }

// Preview / test data (render_preview.py and the Node tests have no Buffer / Task): plausible telemetry
// for a driven Feather capture. drive 0..1.
var ampPreviewData = null;
/** @param {number} [drive] @param {number} [circuit] an Analog circuit index (previews of the Analog face) */
function ampPreviewSetup(drive, circuit) {
    var d = drive == null ? 0.7 : drive;
    amp.dsp.ready = 1;
    amp.dspA.ready = 1;
    if (circuit != null && circuit >= 0) {
        ampP.engine = AMP_ENGINE.ANALOG;
        ampP.circuit = circuit;
        amp.analog.idx = circuit;
        amp.analog.info = aaInfo(circuit);
        ampMeterVals = { sag: 0.12 * d, gr: amp.analog.info.blocks.some(function (b) { return b.kind === "opto" || b.kind === "fet"; }) ? 0.4 * d : 0, exc: 0.5 * d, bias: 0.2 * d };
    }
    amp.model = ampModelInfo(ampParseNam(AMP_BUILTIN[5]), "Crunch", "preview", "");
    ampP.model = 1;
    ampTel = { frames: 100, sr: 48000, in_pk: 0.35 * d + 0.05, out_pk: 0.5 * d + 0.1, gate: 1, sat: 0.25 + 0.55 * d,
        in_rms: 0.12 * d + 0.02, out_rms: 0.2 * d + 0.03, model_ok: 1, nlayers: 20, nam_pk: 0.6 * d + 0.1, asleep: 0, switching: 0, alive: 100 };
    ampLayerVals = [];
    for (var i = 0; i < 20; i++) ampLayerVals.push(0.15 + 0.6 * d * Math.abs(Math.sin(i * 1.7 + 0.4)) * (i < 7 ? 1 : 0.7));
    if (circuit != null && circuit >= 0) { ampLayerVals = []; for (i = 0; i < AA_NSLOT; i++) ampLayerVals.push(0.1 + 0.7 * d * Math.abs(Math.sin(i * 1.3 + 0.2))); }
    var xy = [], out = [];
    for (i = 0; i < 512; i++) {
        var x = Math.sin(i * 0.11) * (0.6 * d + 0.1) + 0.05 * Math.sin(i * 0.53);
        xy.push([x, Math.tanh(3 * x + 0.2 * x * x) * 0.6]);
    }
    for (i = 0; i < 2048; i++) {
        var t = i / 48000, v = Math.sin(2 * Math.PI * 110 * t) * 0.9 + 0.3 * Math.sin(2 * Math.PI * 220 * t + 0.5);
        out.push(Math.tanh(3 * d * v) * 0.5 * Math.exp(-((i % 1024) / 3000)));
    }
    ampPreviewData = { xy: xy, out: out };
    amp.idle = 0;
}

/** @param {number} n */
function ampXY(n) {
    n = Math.min(AMP_SCOPE.XY_N, n);
    if (ampPreviewData) return ampPreviewData.xy.slice(AMP_SCOPE.XY_N - n);
    var raw = ampPeekN(AMP_SCOPE.XY, AMP_SCOPE.XY_N * 2);
    var head = Math.round(ampPeek(AMP_SCOPE.XY_HEAD));
    var out = [];
    if (raw.length < 2) return out;
    for (var i = n - 1; i >= 0; i--) {
        var k = ((head - i) % AMP_SCOPE.XY_N + AMP_SCOPE.XY_N) % AMP_SCOPE.XY_N;
        out.push([raw[2 * k], raw[2 * k + 1]]);
    }
    return out;
}

/** @param {number} n */
function ampOutRing(n) {
    n = Math.min(AMP_SCOPE.OUT_N, n);
    if (ampPreviewData) return ampPreviewData.out.slice(AMP_SCOPE.OUT_N - n);
    var raw = ampPeekN(AMP_SCOPE.OUT, AMP_SCOPE.OUT_N);
    var head = Math.round(ampPeek(AMP_SCOPE.OUT_HEAD));
    var out = [];
    if (!raw.length) return out;
    for (var i = n - 1; i >= 0; i--) {
        var k = ((head - i) % AMP_SCOPE.OUT_N + AMP_SCOPE.OUT_N) % AMP_SCOPE.OUT_N;
        out.push(raw[k]);
    }
    return out;
}

function ampPoll() {
    var hdr = ampPeekN(0, 16 + AMP_SCOPE.LAYER_N);
    if (hdr.length < 16) return;
    if (hdr[0] === amp.frame) return;
    amp.frame = hdr[0];
    for (var i = 0; i < AMP_TEL_KEYS.length; i++) ampTel[AMP_TEL_KEYS[i]] = hdr[i];
    if (ampIsAnalog()) {
        ampLayerVals = hdr.slice(16, 16 + AA_NSLOT);
        ampMeterVals = { sag: hdr[56] || 0, gr: hdr[57] || 0, exc: hdr[58] || 0, bias: hdr[59] || 0 };
    } else {
        var nl = Math.max(0, Math.min(AMP_SCOPE.LAYER_N, Math.round(hdr[9])));
        ampLayerVals = hdr.slice(16, 16 + nl);
    }
    if (hdr[1] > 1000 && Math.abs(hdr[1] - amp.sr) > 1) {
        amp.sr = hdr[1];
        ampWriteTone();
        if (ampIsAnalog()) ampLoadAnalog(Math.round(Number(ampP.circuit) || 0));   // the cab IR and the tape filters depend on the rate
    }
    var busy = hdr[2] > 0.0005 || hdr[3] > 0.0005 || hdr[14] > 0;
    amp.idle = busy ? 0 : amp.idle + 1;
    var want = typeof ampFaceFrame === "function" ? ampFaceFrame() : true;
    if (want && amp.idle < 45) mgraphics.redraw();
}
