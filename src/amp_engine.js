// Amp engine, shared by every Amp face (concatenated into the face's main v8ui after amp_config.js,
// before the face file). The face draws; the engine owns the DSP, the model and the parameters.
//
// Build header globals: AMP_TEMPLATE (src/amp_core.genexpr without comments), AMP_BUILTIN (the
// built-in .nam documents, one per Model enum entry before "File"), AMP_FACE (design slug).
//
// Patcher contract (scripts/build_amp.py):
//   in : setnames <scope> <weights> <coeffs>   (loadbang; the --- names expanded by the patcher)
//        set_<key> <v>                          (every parameter's live.* object, AMP_PARAMS)
//        init_dsp                               (live.thisdevice)
//        dropfile <path>                        (the Model File live.drop, also Live's replay on load)
//        browsed <path>                         (opendialog)
//   out 0: param <key> <v> | browse | dropset <path>  -> route -> live.* / opendialog / live.drop
//   out 1: gen messages                               -> amp_genin (gate 1 1) -> gen~
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
    dsp: { ready: 0, error: "", createdAt: 0, alive0: -1, retries: 0, fastUntil: 0 },
    model: { name: "", label: "", arch: "", kind: "", layers: 0, rf: 1, error: "", file: "", arrays: /** @type {any[]} */ ([]), dilations: /** @type {number[]} */ ([]), weights: 0 },
    names: { scope: "", w: "", cf: "" },
    bank: 1, genPath: "", genArch: "", sr: 48000, filePath: "", fileModel: null,
    frame: -1, idle: 0, poll: null, resend: null, confirm: null, started: 0,
    initTask: /** @type {any} */ (null), waitTask: /** @type {any} */ (null), claimTask: /** @type {any} */ (null)
};
var ampTel = { frames: 0, sr: 48000, in_pk: 0, out_pk: 0, gate: 1, sat: 0, in_rms: 0, out_rms: 0, model_ok: 0, nlayers: 0, nam_pk: 0, asleep: 0, switching: 0, alive: 0 };
var ampLayerVals = [];
var AMP_TEL_KEYS = ["frames", "sr", "in_pk", "out_pk", "gate", "sat", "in_rms", "out_rms", "model_ok", "nlayers", "nam_pk", "asleep", "xy_head", "out_head", "switching", "alive"];
var ampToneCache = null;

/** @param {string} msg */
function ampLog(msg) {
    if (typeof Global === "undefined") return;
    var g = new Global("amp_trace");
    var t = String(g.text || "");
    if (t.length > 6000) t = t.slice(-4000);
    g.text = t + Date.now() % 1000000 + " " + AMP_FACE + " " + msg + "\n";
}

// ---- patcher messages ---------------------------------------------------------------------------

function setnames(scope, w, cf) {
    ampLog("setnames " + scope + " " + w + " " + cf);
    amp.names.scope = String(scope);
    amp.names.w = String(w);
    amp.names.cf = String(cf);
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
    if (spec[7]) ampGen(spec[7], ampGenValue(key, v));
    if (key === "bass" || key === "mid" || key === "treble" || key === "presence" || key === "cab") ampWriteTone();
    if (key === "model" && amp.started) ampSelectModel(Math.round(v));
    if (typeof ampFaceChanged === "function") ampFaceChanged(key);
    mgraphics.redraw();
}

function init_dsp() {
    ampLog("init_dsp started=" + amp.started + " names=" + amp.names.w);
    if (amp.started) return;
    amp.started = 1;
    // Tasks are kept on `amp`: a Task held only by a local can be garbage-collected before it fires
    // (seen in Live: some instances never loaded a model).
    amp.initTask = new Task(function () { ampSelectModel(Math.round(ampP.model)); }, this);
    amp.initTask.schedule(30);
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
    ampLoadFile(p, Math.round(ampP.model) === 3 || !amp.started);
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
function test_tone(face, a) { if (ampTestMine(face)) ampGen("testamp", Number(a) || 0); }

function test_load() {
    var a = Array.prototype.slice.call(arguments);
    if (ampTestMine(a.shift())) ampLoadFile(ampJoin(a), true);
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
    g["report_" + AMP_FACE] = JSON.stringify({ names: amp.names, started: amp.started, bi: bi, face: AMP_FACE, dsp: amp.dsp, model: amp.model, file: amp.filePath, genArch: amp.genArch,
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
    if (amp.fileModel) e[3] = amp.fileModel.name || ampBaseName(amp.filePath);
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
        if (Math.round(ampP.model) !== 3) ampSet("model", 3);   // its echo loads it
        else if (amp.started) ampSelectModel(3);
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
        error: "", file: file, arrays: arrays, dilations: dil, weights: m.nWeights };
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

function ampDspCreate() {
    if (!ampHost || !amp.genPath) return;
    if (!ampDspClaim()) {
        if (!amp.claimTask) amp.claimTask = new Task(ampDspCreate, this);
        amp.claimTask.schedule(100);
        return;
    }
    try {
        var g = ampHost.getnamed("amp_gen");
        if (!g) {
            g = ampHost.newdefault(40, 460, "gen~", "@gen", amp.genPath);
            if (!g) throw new Error("no gen~");
            g.varname = "amp_gen";
            var hub = ampHost.getnamed("amp_genin"), pin = ampHost.getnamed("amp_plugin"), pout = ampHost.getnamed("amp_plugout");
            if (!hub || !pin || !pout) throw new Error("missing hub / plugin~ / plugout~");
            ampHost.connect(hub, 0, g, 0);
            ampHost.connect(pin, 0, g, 0);
            ampHost.connect(pin, 1, g, 1);
            ampHost.connect(g, 0, pout, 0);
            ampHost.connect(g, 1, pout, 1);
        }
        amp.dsp.createdAt = Date.now();
        amp.dsp.alive0 = ampPeek(AMP_SCOPE.ALIVE);
        amp.dsp.fastUntil = Date.now() + 4000;
        ampLog("gen created " + amp.genArch);
    } catch (err) {
        amp.dsp.error = String(err && err.message ? err.message : err);
        ampDspRelease();
        ampLog("dsp error " + amp.dsp.error);
    }
}

/** @param {string} msg @param {number} v */
function ampGen(msg, v) { outlet(1, msg, v); }

function ampSendGen() {
    if (amp.names.w) {
        outlet(1, "w", amp.names.w);
        outlet(1, "cf", amp.names.cf);
        outlet(1, "scope", amp.names.scope);
    }
    for (var k in AMP_PARAMS) {
        if (AMP_PARAMS[k][7]) outlet(1, AMP_PARAMS[k][7], ampGenValue(k, ampP[k]));
    }
    if (amp.model.arch) {
        outlet(1, "wbase", amp.bank * AMP_WBANK);
        outlet(1, "mok", 1);
    }
}

// Confirms the gen runs (the alive counter moves, also in silence), retries a gen~ that never starts,
// and keeps re-sending the gen state: fast for 4 s after a create / hot-load (a compiling gen drops
// messages), then once a second as a safety net (same values change nothing in the gen).
var ampResendCount = 0;
function ampResendTick() {
    var now = Date.now();
    if (amp.dsp.createdAt && !amp.dsp.ready) {
        var a = ampPeek(AMP_SCOPE.ALIVE);
        if (amp.dsp.alive0 >= 0 && a >= 0 && a !== amp.dsp.alive0) {
            amp.dsp.ready = 1;
            amp.dsp.error = "";
            ampDspRelease();
            ampLog("dsp ready after " + (now - amp.dsp.createdAt) + " ms");
            mgraphics.redraw();
        } else if (amp.dsp.alive0 < 0) {
            amp.dsp.alive0 = a;
        } else if (now - amp.dsp.createdAt > (amp.dsp.retries ? 12000 : 8000)) {
            if (amp.dsp.retries < 2) {
                amp.dsp.retries++;
                try { var old = ampHost.getnamed("amp_gen"); if (old) ampHost.remove(old); } catch (_) {}
                amp.dsp.createdAt = 0;
                ampLog("dsp retry");
                ampDspCreate();
            } else {
                amp.dsp.error = "not running";
                ampDspRelease();
                mgraphics.redraw();
            }
        }
    }
    ampResendCount++;
    if (now < amp.dsp.fastUntil || ampResendCount % 7 === 0) ampSendGen();
}

// ---- tone stack / cab coefficients ----------------------------------------------------------------

function ampWriteTone() {
    ampToneCache = ampToneBiquads(ampP, amp.sr);
    if (!amp.names.cf || typeof Buffer === "undefined") return;
    var flat = [];
    for (var i = 0; i < ampToneCache.length; i++) flat = flat.concat(ampToneCache[i]);
    var b = new Buffer(amp.names.cf);
    b.poke(1, 0, flat);
    b.poke(1, 50, 1);
}

/** @param {number} f */
function ampToneCurve(f) {
    if (!ampToneCache) ampToneCache = ampToneBiquads(ampP, amp.sr);
    return ampResponseDb(ampToneCache, f, amp.sr);
}

// ---- telemetry ------------------------------------------------------------------------------------

/** @param {number} i */
function ampPeek(i) {
    if (!amp.names.scope || typeof Buffer === "undefined") return -1;
    try {
        var v = new Buffer(amp.names.scope).peek(1, i, 1);
        return typeof v === "number" ? v : (v && v.length ? Number(v[0]) : -1);
    } catch (_) { return -1; }
}

/** @param {number} at @param {number} n */
function ampPeekN(at, n) {
    if (!amp.names.scope || typeof Buffer === "undefined") return [];
    var out = [];
    try {
        var b = new Buffer(amp.names.scope);
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

// Preview / test data (render_preview.py and the Node tests have no Buffer / Task): plausible telemetry
// for a driven Feather capture. drive 0..1.
var ampPreviewData = null;
/** @param {number} [drive] */
function ampPreviewSetup(drive) {
    var d = drive == null ? 0.7 : drive;
    amp.dsp.ready = 1;
    amp.model = ampModelInfo(ampParseNam(AMP_BUILTIN[1]), "Crunch", "preview", "");
    ampP.model = 1;
    ampTel = { frames: 100, sr: 48000, in_pk: 0.35 * d + 0.05, out_pk: 0.5 * d + 0.1, gate: 1, sat: 0.25 + 0.55 * d,
        in_rms: 0.12 * d + 0.02, out_rms: 0.2 * d + 0.03, model_ok: 1, nlayers: 20, nam_pk: 0.6 * d + 0.1, asleep: 0, switching: 0, alive: 100 };
    ampLayerVals = [];
    for (var i = 0; i < 20; i++) ampLayerVals.push(0.15 + 0.6 * d * Math.abs(Math.sin(i * 1.7 + 0.4)) * (i < 7 ? 1 : 0.7));
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
    var nl = Math.max(0, Math.min(AMP_SCOPE.LAYER_N, Math.round(hdr[9])));
    ampLayerVals = hdr.slice(16, 16 + nl);
    if (hdr[1] > 1000 && Math.abs(hdr[1] - amp.sr) > 1) { amp.sr = hdr[1]; ampWriteTone(); }
    var busy = hdr[2] > 0.0005 || hdr[3] > 0.0005 || hdr[14] > 0;
    amp.idle = busy ? 0 : amp.idle + 1;
    var want = typeof ampFaceFrame === "function" ? ampFaceFrame() : true;
    if (want && amp.idle < 45) mgraphics.redraw();
}
