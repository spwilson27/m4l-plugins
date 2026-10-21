// Glitch UI (v8ui). ONE canvas that covers the whole device (0,0 .. width,169); every control is drawn here and the Live
// parameters (Morph X / Y, Chaos, Mix, Output, Randomize, Mutate, Mode) are real live.* objects kept OFF the face (Better
// Sampler pattern): the face sends ["param", key, value] through `route`, the object echoes through `prepend set_<key>`
// and is dropped when it is a stale echo of something the face sent (expectEcho / isStaleEcho).
//
// scripts/build_glitch.py prepends src/glitch_config.js (data model + layout, see its header) and injects
// GEN_DSP_TEXT / GEN_DSP_HASH (the gen patch as .gendsp JSON, AGENTS.md 1d: deferred DSP) and UI_PREVIEW_EDITOR.
//
// Sections (collapse / expand, device width follows through live.thisdevice setwidth): CORE (morph pad, glitch view with
// module tiles, action bar; the Options view replaces it), EDIT (module editor), SLOTS (8 slots; the phase 2 sequencer goes
// next to it). Layout lives in glitchFaceLayout() (config) so the tests can check every rect.
//
// Messages in (inlet 0): setbuffer <slots> <scope>, set_<param> <v> (echo of a live.* object), device_ready, dbg_* / test_*
//   (via receive #0-glitchdebug), randomize [seed], mutate [amount 0..1], audition working|morph|seq, xy x y, save|recall|clearslot <1..8>,
//   getvalueof / setvalueof (blob GlitchStateData).
// Messages out (outlet 0): param <key> <value> | setwidth_cmd <px> | dsp_ready bang | dsp_on 2

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var COL_BG = [0.043, 0.055, 0.075];
var COL_CARD = [0.075, 0.088, 0.112];
var COL_PANEL = [0.105, 0.12, 0.15];
var COL_ROW = [0.15, 0.17, 0.21];
var COL_LINE = [0.22, 0.26, 0.32];
var COL_TEXT = [0.84, 0.88, 0.94];
var COL_DIM = [0.52, 0.60, 0.70];
var COL_CORAL = [1.0, 0.45, 0.38];
var COL_AMBER = [1.0, 0.77, 0.30];
var COL_CYAN = [0.30, 0.82, 0.88];
var SLOT_COL = [[1.0, 0.42, 0.42], [1.0, 0.64, 0.26], [0.96, 0.84, 0.30], [0.50, 0.86, 0.46], [0.30, 0.82, 0.88], [0.40, 0.58, 0.98], [0.68, 0.48, 0.96], [0.96, 0.48, 0.78]];
var CAT_COL = { Distort: [1.0, 0.52, 0.36], Filter: [0.30, 0.82, 0.88], Pitch: [0.74, 0.56, 1.0], Time: [1.0, 0.77, 0.30], Spectral: [0.46, 0.86, 0.56], Space: [0.44, 0.62, 1.0], Utility: [0.64, 0.70, 0.78] };

// ---------------------------------------------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------------------------------------------
var gState = defaultState();
var gLayout = glitchFaceLayout(gState.ui);
var gSlotsBuf = null;
var gScopeBuf = null;
var gSlotsName = "";
var gScopeName = "";
var gTele = null;
var gHaveTele = false;
var gDemo = false;
var gReady = 0;
var gFocus = false;
var gHover = "";
var gHint = "";
var gDrag = null;
var gArmSave = false;
var gArmClear = false;
var gLastSlot = -1;
var gFlash = { dice: 0, mutate: 0, slot: -1, slotT: 0 };
var gUndo = [];
var gRedo = [];
var gTiles = [];
var gVec = null;
var gModelDirty = true;
var gParamVals = {};
var gTileSig = "";
var hostPatcher = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function trace(event, detail) {
    if (typeof Global === "undefined") return;
    try {
        var gl = new Global("glitch_trace");
        var lines = String(gl.text || "").split("\n").filter(function (l) { return l.length > 0; });
        lines.push("+" + (Date.now() - traceT0) + "ms " + event + " " + (detail === undefined ? "" : String(detail)));
        gl.text = lines.slice(-40).join("\n");
    } catch (_) {}
}
var traceT0 = Date.now();
if (typeof Global !== "undefined") { try { new Global("glitch_trace").text = ""; } catch (_) {} }

// ---------------------------------------------------------------------------------------------------------------
// engine buffers, model, parameters
// ---------------------------------------------------------------------------------------------------------------
function setbuffer(slotsName, scopeName) {
    if (slotsName) { gSlotsName = "" + slotsName; gSlotsBuf = new Buffer(gSlotsName); }
    if (scopeName) { gScopeName = "" + scopeName; gScopeBuf = new Buffer(gScopeName); }
    pushEngine();
}
function pushEngine() {
    gModelDirty = true;
    if (!gSlotsBuf) return;
    gSlotsBuf.poke(1, 0, packEngineBuffer(gState));
}
function refreshModel() {
    if (!gModelDirty && gVec) return;
    gVec = currentVector(gState);
    gTiles = glitchTiles(gVec);
    if (gTiles.length > GL_FACE.MAX_TILES) gTiles = gTiles.slice(0, GL_FACE.MAX_TILES);
    gModelDirty = false;
    var sig = gTiles.map(function (t) { return t.key; }).join(",");
    if (sig !== gTileSig) gTileSig = sig;
}
function modelChanged() { gModelDirty = true; pushEngine(); mgraphics.redraw(); }

// Values the face sent to Live that have not echoed back yet (oldest first); an echo older than the newest value we sent
// must not drag the state back. Values the face never sent (automation, MIDI map, the LOM) always apply.
var echoPending = {};
function expectEcho(key, v) {
    var q = echoPending[key] || (echoPending[key] = []);
    q.push(Number(v));
    if (q.length > 64) q.shift();
}
function isStaleEcho(key, n) {
    var q = echoPending[key];
    if (!q || q.length === 0) return false;
    for (var i = 0; i < q.length; i++) {
        if (Math.abs(q[i] - n) <= 1e-4 * Math.max(1, Math.abs(n))) {
            q.splice(0, i + 1);
            return q.length > 0;
        }
    }
    return false;
}
function sendParam(key, v) {
    expectEcho(key, v);
    gParamVals[key] = Number(v);
    outlet(0, "param", key, v);
}
function paramFromState(key) {
    switch (key) {
        case "morphx": return gState.xy[0] * 100;
        case "morphy": return gState.xy[1] * 100;
        case "chaos": return gState.chaos * 100;
        case "mode": return engineMode(gState);
        case "seqrate": return gState.seq.rate;
        case "glide": return gState.seq.glide * 100;
        case "seqlen": return gState.seq.length;
        case "mix": return gParamVals.mix === undefined ? GL_PARAMS.mix.init : gParamVals.mix;
        case "out": return gParamVals.out === undefined ? GL_PARAMS.out.init : gParamVals.out;
    }
    return 0;
}
// Push the state's morph / chaos / mode into the live.* objects (load, preset recall, device ready)
function syncParamsOut() {
    var keys = ["morphx", "morphy", "chaos", "mode", "seqrate", "glide", "seqlen"];
    for (var i = 0; i < keys.length; i++) sendParam(keys[i], paramFromState(keys[i]));
}

function setAudition(mode, fromFace) {
    var m = mode === "morph" ? "morph" : (mode === "seq" ? "seq" : "working");
    var changed = gState.audition !== m;
    gState.audition = m;
    if (fromFace) sendParam("mode", engineMode(gState));
    pushEngine();
    if (changed) mgraphics.redraw();
}
function setXY(x, y, fromFace) {
    gState.xy = [clamp(x, 0, 1), clamp(y, 0, 1)];
    if (fromFace) {
        sendParam("morphx", gState.xy[0] * 100);
        sendParam("morphy", gState.xy[1] * 100);
    }
    pushEngine();
    mgraphics.redraw();
}

function onParamIn(key, n) {
    if (!isFinite(n)) return;
    if (isStaleEcho(key, n)) return;
    var prev = gParamVals[key];
    gParamVals[key] = n;
    switch (key) {
        case "morphx":
        case "morphy": {
            var idx = key === "morphx" ? 0 : 1;
            var v = clamp(n / 100, 0, 1);
            if (Math.abs(v - gState.xy[idx]) < 1e-6) return;
            gState.xy[idx] = v;
            // moving Morph X / Y from outside (automation, MIDI map, the LOM) makes the morph audible
            if (gReady && gState.audition !== "morph") setAudition("morph", true);
            else pushEngine();
            break;
        }
        case "chaos": gState.chaos = clamp(n / 100, 0, 1); break;
        case "mode": setAudition(n > 1.5 ? "seq" : (n > 0.5 ? "morph" : "working"), false); break;
        case "seqrate": setSeqRate(gState, Math.round(n)); pushEngine(); break;
        case "glide": setSeqGlide(gState, n / 100); pushEngine(); break;
        case "seqlen": setSeqLength(gState, Math.round(n)); pushEngine(); break;
        case "randomize":
            if (n > 0.5 && !(prev > 0.5) && gReady) { doRandomize(null); sendParam("randomize", 0); }
            break;
        case "mutate":
            if (n > 0.5 && !(prev > 0.5) && gReady) { doMutate(); sendParam("mutate", 0); }
            break;
    }
    mgraphics.redraw();
}
function set_morphx(v) { onParamIn("morphx", Number(v)); }
function set_morphy(v) { onParamIn("morphy", Number(v)); }
function set_chaos(v) { onParamIn("chaos", Number(v)); }
function set_mix(v) { onParamIn("mix", Number(v)); }
function set_out(v) { onParamIn("out", Number(v)); }
function set_randomize(v) { onParamIn("randomize", Number(v)); }
function set_mutate(v) { onParamIn("mutate", Number(v)); }
function set_mode(v) { onParamIn("mode", Number(v)); }
function set_seqrate(v) { onParamIn("seqrate", Number(v)); }
function set_glide(v) { onParamIn("glide", Number(v)); }
function set_seqlen(v) { onParamIn("seqlen", Number(v)); }

// ---------------------------------------------------------------------------------------------------------------
// actions (each one gesture: one undo snapshot, notifyclients when it is done)
// ---------------------------------------------------------------------------------------------------------------
function undoPush() {
    gUndo.push(glitchUndoSnapshot(gState));
    if (gUndo.length > 16) gUndo.shift();
    gRedo = [];
}
function done() { if (typeof notifyclients === "function") notifyclients(); }
function undo() {
    if (!gUndo.length) return;
    gRedo.push(glitchUndoSnapshot(gState));
    glitchUndoRestore(gState, gUndo.pop());
    afterEdit();
}
function redo() {
    if (!gRedo.length) return;
    gUndo.push(glitchUndoSnapshot(gState));
    glitchUndoRestore(gState, gRedo.pop());
    afterEdit();
}
function afterEdit() {
    fixSelection();
    modelChanged();
    done();
}
function fixSelection() {
    var ui = gState.ui;
    if (ui.sel && !glitchTileInfo(ui.sel)) ui.sel = "";
}
function doRandomize(seed) {
    undoPush();
    if (seed !== null && seed !== undefined && !isNaN(Number(seed))) gState.seed = Math.max(1, Math.floor(Number(seed)));
    rerollWorking(gState);
    gState.audition = "working";
    sendParam("mode", 0);
    gFlash.dice = 1;
    gLastSlot = -1;
    refreshModel();
    selectFirstIfNone();
    modelChanged();
    done();
}
function doMutate() {
    undoPush();
    mutateWorking(gState);
    gState.audition = "working";
    sendParam("mode", 0);
    gFlash.mutate = 1;
    refreshModel();
    modelChanged();
    done();
}
function selectFirstIfNone() {
    var ui = gState.ui;
    refreshModel();
    var has = false;
    for (var i = 0; i < gTiles.length; i++) if (gTiles[i].key === ui.sel) has = true;
    if (!has && !(ui.sel && glitchTileInfo(ui.sel) && gState.working.modules[glitchTileInfo(ui.sel).inst])) ui.sel = gTiles.length ? gTiles[0].key : "";
}
// Test / message entry points
function randomize(seed) { doRandomize(seed); }
function mutate(amount) {
    if (amount !== undefined && !isNaN(Number(amount))) {
        undoPush();
        gState.working = mutateGlitch(gState.working, gState.seed++, clamp(Number(amount), 0, 1), gState.allow);
        gState.audition = "working";
        modelChanged();
        done();
    } else doMutate();
}
function audition(mode) { setAudition(String(mode), true); mgraphics.redraw(); }
// Sequencer hooks (no sequencer UI yet; the phase 2 UI builds on these): seqrandomize [seed], seqstep <0..15> <slot -1..7>
function seqrandomize(seed) {
    undoPush();
    if (seed !== undefined && !isNaN(Number(seed))) gState.seed = Math.max(1, Math.floor(Number(seed)));
    rerollSequence(gState);
    modelChanged();
    done();
}
function seqstep(i, slot) { undoPush(); setSeqStep(gState, Number(i), Number(slot)); modelChanged(); done(); }
function xy(x, y) { setXY(Number(x), Number(y), true); }
function save(i) { var s = clamp(Math.floor(Number(i)) - 1, 0, 7); undoPush(); saveToSlot(gState, s); gLastSlot = s; modelChanged(); done(); }
function recall(i) { var s = clamp(Math.floor(Number(i)) - 1, 0, 7); recallAction(s); }
function clearslot(i) { var s = clamp(Math.floor(Number(i)) - 1, 0, 7); undoPush(); clearSlot(gState, s); modelChanged(); done(); }
function chaos(v) { gState.chaos = clamp(Number(v) / 100, 0, 1); sendParam("chaos", gState.chaos * 100); mgraphics.redraw(); }

function recallAction(s) {
    if (!gState.slots[s]) return;
    undoPush();
    recallSlot(gState, s);
    gState.audition = "working";
    sendParam("mode", 0);
    gLastSlot = s;
    refreshModel();
    fixSelection();
    modelChanged();
    done();
}

// ---------------------------------------------------------------------------------------------------------------
// layout / device width
// ---------------------------------------------------------------------------------------------------------------
function applyLayout() {
    gLayout = glitchFaceLayout(gState.ui);
    gState.ui = gLayout.ui;
    outlet(0, "setwidth_cmd", gLayout.width);
    resizeFace(gLayout.width);
    mgraphics.redraw();
}
function resizeFace(w) {
    if (!hostPatcher || typeof hostPatcher.getnamed !== "function") return;
    try {
        var ui = hostPatcher.getnamed("obj-viz");
        if (ui) {
            var r = ui.getattr("presentation_rect");
            if (Array.isArray(r) && r.length >= 4) ui.setattr("presentation_rect", r[0], r[1], w, r[3]);
        }
    } catch (e) {}
}
function toggleSection(name) {
    var ui = gState.ui;
    ui[name] = ui[name] ? 0 : 1;
    if (name === "editor" && ui.editor) { ui.options = 0; selectFirstIfNone(); }
    applyLayout();
    done();
}
function setOptions(on) {
    gState.ui.options = on ? 1 : 0;
    gLayout = glitchFaceLayout(gState.ui);
    mgraphics.redraw();
    done();
}

// ---------------------------------------------------------------------------------------------------------------
// state blob
// ---------------------------------------------------------------------------------------------------------------
function getvalueof() { return stateToBlob(gState); }
function setvalueof() {
    var a = typeof arrayfromargs === "function" ? arrayfromargs(arguments) : Array.prototype.slice.call(arguments);
    gState = stateFromBlob(a.length === 1 && Array.isArray(a[0]) ? a[0] : a);
    gUndo = []; gRedo = [];
    pushEngine();
    if (gReady) { syncParamsOut(); applyLayout(); } else gLayout = glitchFaceLayout(gState.ui);
    mgraphics.redraw();
}

// ---------------------------------------------------------------------------------------------------------------
// Deferred DSP (AGENTS.md 1d): the device ships without its gen~. After device_ready + one Task tick the face writes the
// embedded gen patch to /tmp/glitch_core_<hash>.gendsp, creates `gen~ @gen <file>` and wires the gl_genin hub, plugin~ and
// the two output selectors. The gen keeps compiling after creation and drops messages, so dsp_ready is re-sent every 150 ms
// until its frame counter (scope slot 0) moves; then the selectors switch from the dry path to the gen.
// ---------------------------------------------------------------------------------------------------------------
var dspReady = 0;
var dspError = "";
var dspCreatedAt = 0;
var dspCounter0 = -1;
var dspTask = null;
var dspConfirmTask = null;
var dspSettleTask = null;
var DSP_SETTLE_MS = 300;
var DSP_CONFIRM_MS = 150;
var DSP_TIMEOUT_MS = 12000;

function dspFilePath() { return "/tmp/glitch_core_" + GEN_DSP_HASH + ".gendsp"; }
function writeDspFile(path) {
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
function scopeFrameCounter() {
    if (!gScopeName || typeof Buffer === "undefined") return -1;
    try {
        var v = new Buffer(gScopeName).peek(1, GL_SCOPE.FRAME, 1);
        return (typeof v === "number") ? v : (v && v.length ? v[0] : -1);
    } catch (_) { return -1; }
}
function loadDsp() {
    if (dspReady || dspCreatedAt || typeof GEN_DSP_TEXT === "undefined" || !hostPatcher) return;
    trace("dsp-start", "creating gen~");
    try {
        var g = hostPatcher.getnamed("obj-gen");
        if (!g) {
            var path = dspFilePath();
            if (!writeDspFile(path)) throw new Error("no file");
            g = hostPatcher.newdefault(30, 435, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "obj-gen";
            var hub = hostPatcher.getnamed("gl_genin");
            var pin = hostPatcher.getnamed("gl_plugin");
            var selL = hostPatcher.getnamed("gl_selL");
            var selR = hostPatcher.getnamed("gl_selR");
            if (hub) hostPatcher.connect(hub, 0, g, 0);
            if (pin) { hostPatcher.connect(pin, 0, g, 0); hostPatcher.connect(pin, 1, g, 1); }
            if (selL) hostPatcher.connect(g, 0, selL, 2);
            if (selR) hostPatcher.connect(g, 1, selR, 2);
        }
        dspCreatedAt = Date.now();
        dspCounter0 = scopeFrameCounter();
        dspConfirm();
    } catch (err) {
        dspError = String(err && err.message ? err.message : err);
        trace("dsp-error", dspError);
        if (typeof post === "function") post("Glitch: DSP load failed: " + dspError + "\n");
    }
    mgraphics.redraw();
}
function dspConfirm() {
    var c = scopeFrameCounter();
    if (dspCounter0 >= 0 && c >= 0 && c !== dspCounter0) {
        dspReady = 1;
        dspError = "";
        trace("dsp", "ready after " + (Date.now() - dspCreatedAt) + " ms");
        outlet(0, "dsp_ready", "bang");
        pushEngine();
        outlet(0, "dsp_on", 2);
        if (typeof Task !== "undefined") {
            if (!dspSettleTask) dspSettleTask = new Task(function () { outlet(0, "dsp_ready", "bang"); pushEngine(); });
            dspSettleTask.schedule(DSP_SETTLE_MS);
        }
        mgraphics.redraw();
        return;
    }
    if (Date.now() - dspCreatedAt > DSP_TIMEOUT_MS) {
        dspError = "not running (counter " + dspCounter0 + "/" + scopeFrameCounter() + ")";
        trace("dsp-error", dspError);
        mgraphics.redraw();
        return;
    }
    outlet(0, "dsp_ready", "bang");
    pushEngine();
    if (dspCounter0 < 0) dspCounter0 = c;
    if (typeof Task === "undefined") return;
    if (!dspConfirmTask) dspConfirmTask = new Task(dspConfirm);
    dspConfirmTask.schedule(DSP_CONFIRM_MS);
}
function dsp_retry() {
    try { var g = hostPatcher ? hostPatcher.getnamed("obj-gen") : null; if (g) hostPatcher.remove(g); } catch (_) {}
    dspReady = 0; dspError = ""; dspCreatedAt = 0; dspCounter0 = -1;
    loadDsp();
}
function dsp_diag() {
    var info = ["ready=" + dspReady, "err=" + dspError, "createdAt=" + dspCreatedAt, "counter=" + scopeFrameCounter(), "scope=" + gScopeName];
    try {
        var g = hostPatcher ? hostPatcher.getnamed("obj-gen") : null;
        info.push("gen=" + (g ? g.maxclass : "none"));
        if (g) {
            try { info.push("genattr=" + String(g.getattr("gen"))); } catch (e1) { info.push("genattrErr=" + e1); }
            try { var pc = g.patchcords; info.push("cordsIn=" + (pc && pc.inputs ? pc.inputs.length : "?") + " cordsOut=" + (pc && pc.outputs ? pc.outputs.length : "?")); } catch (e2) { info.push("cordsErr=" + e2); }
        }
        info.push("hub=" + (hostPatcher && hostPatcher.getnamed("gl_genin") ? 1 : 0) + " sel=" + (hostPatcher && hostPatcher.getnamed("gl_selL") ? 1 : 0));
    } catch (e) { info.push("diagErr=" + e); }
    trace("dsp-diag", info.join(" "));
}
function device_ready() {
    gReady = 1;
    syncParamsOut();
    applyLayout();
    pushEngine();
    if (!dspReady && typeof Task !== "undefined" && typeof GEN_DSP_TEXT !== "undefined") {
        if (!dspTask) dspTask = new Task(loadDsp);
        dspTask.schedule(30);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// telemetry (buffer #0-glitchscope, layout GL_SCOPE); skip redraws while silent
// ---------------------------------------------------------------------------------------------------------------
var quietDrawn = false;
var lastFrame = -1;
function pullScope() {
    decayFlashes();
    if (!gScopeBuf || !dspReady) { if (gFlashLive()) mgraphics.redraw(); return; }
    var arr = null;
    try { arr = gScopeBuf.peek(1, 0, GL_SCOPE.END); } catch (_) { arr = null; }
    if (!arr || !arr.length) return;
    var level = Math.max(arr[GL_SCOPE.IN_PEAK] || 0, arr[GL_SCOPE.OUT_PEAK] || 0);
    var quiet = level < 0.0003 && !(arr[GL_SCOPE.SPEC_RUN] > 0.5 && level > 0.00005);
    if (arr[GL_SCOPE.FRAME] !== lastFrame) gHaveTele = true;
    lastFrame = arr[GL_SCOPE.FRAME];
    if (quiet && quietDrawn && !gFlashLive()) return;
    quietDrawn = quiet;
    gTele = arr;
    mgraphics.redraw();
}
function gFlashLive() { return gFlash.dice > 0.02 || gFlash.mutate > 0.02 || gFlash.slotT > 0.02; }
function decayFlashes() {
    gFlash.dice *= 0.8;
    gFlash.mutate *= 0.8;
    gFlash.slotT *= 0.8;
}
var gScopeTask = null;
if (typeof Task !== "undefined") {
    gScopeTask = new Task(pullScope, this);
    gScopeTask.interval = 40;
    gScopeTask.repeat();
}
// the telemetry the face draws: the real one, or (preview only, and only until the first real frame) a demo
function T() {
    if (gHaveTele && gTele) return gTele;
    return gDemo ? demoTele() : null;
}
var demoCache = null;
function demoTele() {
    if (demoCache) return demoCache;
    var S = GL_SCOPE;
    var a = new Array(S.END);
    for (var i = 0; i < S.END; i++) a[i] = 0;
    refreshModel();
    var L = glitchLayout();
    a[S.FRAME] = 1; a[S.SR] = 48000; a[S.IN_PEAK] = 0.62; a[S.OUT_PEAK] = 0.7; a[S.SPEC_RUN] = 1; a[S.SPEC_MIX] = 1;
    for (var k = 0; k < GL_NINST; k++) {
        a[S.ACTIVITY + k] = clamp(gVec[L.base[GL_INSTANCES[k].id]] || 0, 0, 1);
        a[S.LEVEL + k] = a[S.ACTIVITY + k] > 0 ? 0.25 + 0.45 * Math.abs(Math.sin(k * 1.7 + 0.6)) : 0;
    }
    a[S.STUT_ENGAGED] = 1; a[S.STUT_PHASE] = 0.37; a[S.CHOP_STEP] = 5; a[S.CHOP_GATE] = 1; a[S.TIME_PHASE] = 0.42;
    for (var b = 0; b < GL_BANDS; b++) {
        var f = b / GL_BANDS;
        a[S.BANDS_IN + b] = clamp(0.78 - f * 0.55 + 0.16 * Math.sin(b * 0.9), 0, 1);
        a[S.BANDS_OUT + b] = clamp(0.62 - f * 0.35 + 0.28 * Math.sin(b * 0.55 + 1.2) * Math.sin(b * 0.2), 0, 1);
    }
    for (var c = 0; c < GL_CEP_BINS; c++) {
        a[S.CEP_IN + c] = Math.sin(c * 1.9) * Math.exp(-c / 22);
        a[S.CEP_OUT + c] = (c < 18 ? 1 : 0.15) * Math.sin(c * 1.9) * Math.exp(-c / 22);
    }
    for (var w = 0; w < GL_WAVE_LEN; w++) {
        a[S.WAVE_IN + w] = 0.55 + 0.3 * Math.sin(w * 0.5);
        a[S.WAVE_OUT + w] = 0.45 + 0.4 * Math.abs(Math.sin(w * 0.37));
    }
    demoCache = a;
    return a;
}

// ---------------------------------------------------------------------------------------------------------------
// drawing helpers
// ---------------------------------------------------------------------------------------------------------------
function rgba(c, a) { mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? 1 : a); }
function frect(x, y, w, h, c, a) { if (w <= 0 || h <= 0) return; rgba(c, a); mgraphics.rectangle(x, y, w, h); mgraphics.fill(); }
function rrect(x, y, w, h, r, c, a) { if (w <= 0 || h <= 0) return; rgba(c, a); mgraphics.rectangle_rounded(x, y, w, h, r, r); mgraphics.fill(); }
function rsrect(x, y, w, h, r, c, a, lw) { if (w <= 0 || h <= 0) return; rgba(c, a); mgraphics.set_line_width(lw || 1); mgraphics.rectangle_rounded(x, y, w, h, r, r); mgraphics.stroke(); }
function hline(x0, x1, y, c, a, lw) { rgba(c, a); mgraphics.set_line_width(lw || 1); mgraphics.move_to(x0, y); mgraphics.line_to(x1, y); mgraphics.stroke(); }
function vline(x, y0, y1, c, a, lw) { rgba(c, a); mgraphics.set_line_width(lw || 1); mgraphics.move_to(x, y0); mgraphics.line_to(x, y1); mgraphics.stroke(); }
function disc(x, y, r, c, a) { rgba(c, a); mgraphics.arc(x, y, r, 0, 6.2832); mgraphics.fill(); }
function ring(x, y, r, c, a, lw) { rgba(c, a); mgraphics.set_line_width(lw || 1); mgraphics.arc(x, y, r, 0, 6.2832); mgraphics.stroke(); }
// text width estimate for Arial: capitals are wide, lower case narrow
function tw(str, size) {
    str = "" + str;
    var w = 0;
    for (var i = 0; i < str.length; i++) {
        var ch = str.charCodeAt(i);
        w += (ch >= 65 && ch <= 90) ? 0.70 : (ch >= 48 && ch <= 57) ? 0.58 : (ch === 32 ? 0.3 : (ch === 105 || ch === 108 || ch === 46 || ch === 58 || ch === 124) ? 0.3 : 0.55);
    }
    return w * size;
}
// align: 0 left, 1 centre, 2 right
function label(str, x, y, size, c, a, align) {
    str = "" + str;
    var xx = x;
    if (align === 1) xx = x - tw(str, size) * 0.5;
    else if (align === 2) xx = x - tw(str, size);
    rgba(c, a === undefined ? 1 : a);
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(size);
    mgraphics.move_to(xx, y);
    mgraphics.show_text(str);
}
function fit(str, maxW, size) {
    str = "" + str;
    if (tw(str, size) <= maxW) return str;
    var n = str.length;
    while (n > 1 && tw(str.substring(0, n) + ".", size) > maxW) n--;
    return str.substring(0, n) + ".";
}
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function tileColor(tile) { return CAT_COL[tile.category] || COL_DIM; }

// ---------------------------------------------------------------------------------------------------------------
// painting
// ---------------------------------------------------------------------------------------------------------------
function paint() {
    var L = gLayout;
    refreshModel();
    rrect(2, 2, L.width - 4, 165, 7, COL_CARD, 1);
    paintHeader(L);
    if (L.options) paintOptions(L.options);
    else {
        paintPad(L.pad, L);
        paintView(L.view);
        paintActions(L);
    }
    if (L.editor) paintEditor(L.editor);
    if (L.slots) paintSlots(L.slots);
    paintSide(L.side);
    if (gDrag && gDrag.kind === "slot" && gDrag.moved) {
        rrect(gDrag.x - 16, gDrag.y - 11, 32, 22, 4, SLOT_COL[gDrag.i], 0.85);
        label(gDrag.i + 1, gDrag.x, gDrag.y + 4, 11, COL_BG, 1, 1);
    }
}

function chip(r, text, on, c) {
    rrect(r.x, r.y, r.w, r.h, 3, on ? c : COL_ROW, on ? 0.95 : 1);
    rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 3, on ? c : COL_LINE, 1, 1);
    label(text, r.x + r.w / 2, r.y + r.h / 2 + 3, 7.5, on ? COL_BG : COL_TEXT, 1, 1);
}

function hoverIs(id) { return gHover === id; }

function paintHeader(L) {
    chip(L.toggles.editor, L.ui.editor ? "EDIT <" : "EDIT >", !!L.ui.editor, COL_AMBER);
    chip(L.toggles.slots, L.ui.slots ? "SLOTS <" : "SLOTS >", !!L.ui.slots, COL_CYAN);
    var h = L.hint;
    var cy = h.y + h.h / 2;
    if (typeof GEN_DSP_TEXT !== "undefined" && !dspReady && !gDemo) {
        var failed = dspError !== "";
        var txt = failed ? "DSP failed: " + dspError : "DSP loading…";
        var pw = Math.min(h.w, tw(txt, 8) + 14);
        rrect(h.x + h.w - pw, cy - 7, pw, 14, 7, failed ? [0.55, 0.12, 0.14] : [0.45, 0.28, 0.06], 1);
        label(fit(txt, pw - 8, 8), h.x + h.w - pw / 2, cy + 3, 8, failed ? [1, 0.82, 0.82] : [1, 0.86, 0.55], 1, 1);
        return;
    }
    var text = gHint;
    var c = COL_DIM;
    if (!text) {
        if (gState.audition === "morph") {
            var w4 = xyWeights(gState.xy[0], gState.xy[1]);
            var parts = [];
            for (var i = 0; i < 4; i++) if (w4[i] > 0.01) parts.push((gState.corners[i] + 1) + ":" + Math.round(w4[i] * 100) + "%");
            text = "MORPH  " + parts.join("  ");
        } else {
            text = "WORKING  " + gTiles.length + (gTiles.length === 1 ? " module" : " modules");
        }
    } else c = COL_TEXT;
    label(fit(text, h.w - 4, 8), h.x + h.w - 2, cy + 3, 8, c, 1, 2);
}

function weightedColor(cw) {
    var r = 0, g = 0, b = 0, s = 0;
    for (var c = 0; c < 4; c++) {
        var col = SLOT_COL[gState.corners[c]];
        r += col[0] * cw[c]; g += col[1] * cw[c]; b += col[2] * cw[c]; s += cw[c];
    }
    return s > 0 ? [r / s, g / s, b / s] : COL_CORAL;
}

function paintPad(r, L) {
    var morph = gState.audition === "morph";
    var cw = xyWeights(gState.xy[0], gState.xy[1]);
    var col = weightedColor(cw);
    var t = T();
    rrect(r.x, r.y, r.w, r.h, 5, COL_BG, 1);
    // audio-reactive backdrop: the output spectrum rises from the bottom, tinted by the blended slot colour
    if (t) {
        var ncol = 28;
        var bw = (r.w - 4) / ncol;
        for (var i = 0; i < ncol; i++) {
            var v = 0;
            for (var k = 0; k < 2; k++) v = Math.max(v, t[GL_SCOPE.BANDS_OUT + Math.floor(i * GL_BANDS / ncol) + k] || 0);
            var hh = v * r.h * 0.62;
            frect(r.x + 2 + i * bw, r.y + r.h - 2 - hh, bw - 1, hh, col, morph ? 0.26 : 0.14);
        }
    }
    for (var g = 1; g < 4; g++) { hline(r.x + 2, r.x + r.w - 2, r.y + r.h * g / 4, COL_TEXT, 0.045, 1); vline(r.x + r.w * g / 4, r.y + 2, r.y + r.h - 2, COL_TEXT, 0.045, 1); }
    // corner glows follow the live blend weights
    var cx = [r.x, r.x + r.w, r.x, r.x + r.w];
    var cy = [r.y, r.y, r.y + r.h, r.y + r.h];
    for (var c = 0; c < 4; c++) {
        var sc = SLOT_COL[gState.corners[c]];
        var filled = !!gState.slots[gState.corners[c]];
        var wgt = cw[c];
        disc(cx[c] + (c % 2 ? -8 : 8), cy[c] + (c < 2 ? 8 : -8), 12 + 34 * wgt, sc, (filled ? 0.07 : 0.03) + (morph ? 0.26 : 0.1) * wgt);
    }
    var px = r.x + 8 + gState.xy[0] * (r.w - 16);
    var py = r.y + 8 + gState.xy[1] * (r.h - 16);
    hline(r.x + 2, r.x + r.w - 2, py, col, morph ? 0.4 : 0.18, 1);
    vline(px, r.y + 2, r.y + r.h - 2, col, morph ? 0.4 : 0.18, 1);
    // corner badges: the assigned slot's number and colour (click cycles, or drop a slot pad on one)
    var drop = gDrag && gDrag.kind === "slot" && gDrag.moved ? dropCorner(gDrag.x, gDrag.y) : -1;
    for (var b = 0; b < 4; b++) {
        var br = L.corners[b];
        var slot = gState.corners[b];
        var fill = !!gState.slots[slot];
        rrect(br.x, br.y, br.w, br.h, 3, SLOT_COL[slot], fill ? (0.4 + 0.55 * cw[b]) : 0.12);
        rsrect(br.x + 0.5, br.y + 0.5, br.w - 1, br.h - 1, 3, SLOT_COL[slot], fill ? 0.9 : 0.55, drop === b ? 2 : 1);
        label(slot + 1, br.x + br.w / 2, br.y + br.h - 3, 8.5, fill ? COL_BG : SLOT_COL[slot], 1, 1);
    }
    // the puck: filled while the morph is what you hear, hollow while Working plays
    var pk = t ? 1 + 2.5 * clamp(t[GL_SCOPE.OUT_PEAK] || 0, 0, 1) : 1;
    if (morph) { disc(px, py, 7 + pk, col, 0.16); disc(px, py, 6, COL_BG, 0.95); ring(px, py, 6, col, 1, 2); disc(px, py, 1.8, col, 1); }
    else { ring(px, py, 6, col, 0.6, 1.5); disc(px, py, 1.4, col, 0.6); }
    label(morph ? "MORPH" : "WORKING", r.x + r.w / 2, r.y + r.h - 5, 6.5, morph ? col : COL_DIM, 0.9, 1);
    rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 5, morph ? col : COL_LINE, morph ? 0.75 : 1, morph ? 1.4 : 1);
}

// ----- glitch view: module tiles -----
function tilePrimary(tile) {
    var v = gVec;
    var L = glitchLayout();
    function g(id, key) { return v[L.index[id + "." + key]]; }
    function pick(spec, val) { return glitchFormatValue(spec, val); }
    var inst = glInstance(tile.inst);
    function spec(key) { for (var i = 0; i < inst.params.length; i++) if (inst.params[i].key === key) return inst.params[i]; return inst.params[0]; }
    switch (tile.key) {
        case "drvA": case "drvB": return pick(spec("mode"), g(tile.key, "mode")) + " " + g(tile.key, "drive").toFixed(0) + "dB";
        case "filt": return pick(spec("type"), g("filt", "type")) + " " + pick(spec("cutoff"), g("filt", "cutoff"));
        case "crush": return Math.round(g("crush", "bits")) + "b " + g("crush", "rate").toFixed(1) + "x";
        case "ring": return pick(spec("mode"), g("ring", "mode")) + " " + Math.round(g("ring", "freq")) + "Hz";
        case "stut": return pick(spec("div"), g("stut", "div"));
        case "time": return pick(spec("mode"), g("time", "mode")) + " " + pick(spec("div"), g("time", "div"));
        case "chop": return pick(spec("div"), g("chop", "div")) + " " + pick(spec("pattern"), g("chop", "pattern"));
        case "dly": return pick(spec("div"), g("dly", "div")) + " fb " + Math.round(g("dly", "fb") * 100);
        case "rev": return "size " + Math.round(g("rev", "size") * 100) + "%";
        case "wid": return "W " + Math.round(g("wid", "width") * 100) + "% " + g("wid", "gain").toFixed(0) + "dB";
        case "freeze": return pick(spec("frz_rate"), g("spec", "frz_rate"));
        case "smear": return "blur " + Math.round(g("spec", "smr_blur") * 100) + "%";
        case "ccrush": return "K " + Math.round(g("spec", "cc_coeffs") * 100) + "% " + Math.round(g("spec", "cc_bits")) + "b";
        case "scramble": return pick(spec("sc_mode"), g("spec", "sc_mode"));
    }
    return "";
}

function paintTileBody(tile, x, y, w, h, c, act) {
    var t = T();
    var S = GL_SCOPE;
    if (h < 10) return;
    switch (tile.key) {
        case "stut": {
            var cxs = x + w / 2, cys = y + h / 2, rs = Math.min(w, h) / 2 - 1;
            ring(cxs, cys, rs, c, 0.35, 1);
            var ph = t ? t[S.STUT_PHASE] || 0 : 0;
            var eng = t ? t[S.STUT_ENGAGED] || 0 : 0;
            if (eng > 0.05) {
                mgraphics.set_line_width(2); rgba(c, 0.9);
                mgraphics.arc(cxs, cys, rs, -1.5708, -1.5708 + ph * 6.2832); mgraphics.stroke();
            }
            break;
        }
        case "chop": {
            var pat = Math.floor(gVec[glitchLayout().index["chop.pattern"]]);
            var step = t ? Math.floor(t[S.CHOP_STEP] || 0) : -1;
            var pw = (w - 15) / 16;
            for (var i = 0; i < 16; i++) {
                var on = (pat >> i) & 1;
                var ph2 = Math.min(h - 2, 14);
                frect(x + i * (pw + 1), y + (h - ph2) / 2 + (on ? 0 : ph2 - 3), Math.max(pw, 1), on ? ph2 : 3, c, on ? (i === step ? 1 : 0.5) : 0.25);
            }
            break;
        }
        case "time": {
            var tp = t ? t[S.TIME_PHASE] || 0 : 0;
            frect(x, y + h / 2 - 2, w, 4, c, 0.2);
            frect(x, y + h / 2 - 2, w * tp, 4, c, 0.85);
            break;
        }
        case "freeze": case "smear": {
            var nb = Math.max(6, Math.floor(w / 3));
            for (var b = 0; b < nb; b++) {
                var bi = Math.floor(b * GL_BANDS / nb);
                var vin = t ? t[S.BANDS_IN + bi] || 0 : 0;
                var vout = t ? t[S.BANDS_OUT + bi] || 0 : 0;
                frect(x + b * (w / nb), y + h - vin * h, w / nb - 1, vin * h, COL_DIM, 0.25);
                frect(x + b * (w / nb), y + h - vout * h, w / nb - 1, vout * h, c, 0.8);
            }
            break;
        }
        case "ccrush": case "scramble": {
            var nc = Math.max(8, Math.floor(w / 3));
            hline(x, x + w, y + h / 2, COL_DIM, 0.35, 1);
            for (var k = 0; k < nc; k++) {
                var ki = Math.floor(k * GL_CEP_BINS / nc);
                var co = t ? t[S.CEP_IN + ki] || 0 : 0;
                var cn = t ? t[S.CEP_OUT + ki] || 0 : 0;
                var bw = w / nc;
                frect(x + k * bw, y + h / 2 - (co > 0 ? co * h / 2 : 0), bw - 1, Math.abs(co) * h / 2, COL_DIM, 0.3);
                frect(x + k * bw, y + h / 2 - (cn > 0 ? cn * h / 2 : 0), bw - 1, Math.abs(cn) * h / 2, c, 0.85);
            }
            break;
        }
        default: {
            var lv = t ? clamp(t[S.LEVEL + tile.chain] || 0, 0, 1) : 0;
            var nbar = Math.max(6, Math.floor(w / 5));
            for (var q = 0; q < nbar; q++) {
                var thr = (q + 1) / nbar;
                frect(x + q * (w / nbar), y + h / 2 - 3, w / nbar - 1.5, 6, c, lv >= thr - 0.5 / nbar ? 0.9 : 0.18);
            }
        }
    }
}

function paintView(r) {
    var tiles = gTiles;
    var rects = glitchTileRects(tiles.length, r);
    var morph = gState.audition === "morph";
    if (!tiles.length) {
        rrect(r.x, r.y, r.w, r.h, 5, COL_BG, 1);
        rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 5, COL_LINE, 1, 1);
        label(morph ? "Nothing in the morph yet" : "No glitch yet", r.x + r.w / 2, r.y + r.h / 2 - 2, 10, COL_TEXT, 0.9, 1);
        label(morph ? "save glitches into slots, assign corners" : "press RANDOMIZE", r.x + r.w / 2, r.y + r.h / 2 + 12, 8, COL_DIM, 0.9, 1);
        return;
    }
    var t = T();
    for (var i = 0; i < tiles.length; i++) {
        var tile = tiles[i];
        var q = rects[i];
        var c = tileColor(tile);
        var act = t ? clamp(t[GL_SCOPE.ACTIVITY + tile.chain] || 0, 0, 1) : tile.wet;
        var sel = gState.ui.sel === tile.key;
        var small = q.h < 34 || q.w < 44;
        rrect(q.x, q.y, q.w, q.h, 4, mix3(COL_BG, c, 0.1 + 0.2 * act), 1);
        rsrect(q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1, 4, sel ? COL_TEXT : c, sel ? 1 : 0.55, sel ? 1.6 : 1);
        label(fit(tile.name, q.w - 16, small ? 6.5 : 7.5), q.x + 4, q.y + (small ? 8 : 10), small ? 6.5 : 7.5, c, 1, 0);
        if (glitchIsLocked(gState.working, tile.key)) paintLockGlyph(q.x + q.w - 8, q.y + 7, COL_AMBER, 0.95);
        var by = q.y + q.h - 4;
        frect(q.x + 3, by, q.w - 6, 2, c, 0.2);
        frect(q.x + 3, by, (q.w - 6) * clamp(tile.wet, 0, 1), 2, c, 0.9);
        var top = q.y + (small ? 11 : 13);
        var bodyH = small ? Math.max(0, by - top - 2) : Math.max(0, by - top - (q.h > 44 ? 12 : 2));
        paintTileBody(tile, q.x + 4, top, q.w - 8, bodyH, c, act);
        if (!small && q.h > 44) label(fit(tilePrimary(tile), q.w - 6, 6.5), q.x + q.w / 2, q.y + q.h - 8, 6.5, COL_TEXT, 0.8, 1);
    }
}

function paintLockGlyph(x, y, c, a) {
    frect(x - 3, y - 0.5, 6, 4.5, c, a);
    rgba(c, a); mgraphics.set_line_width(1.2);
    mgraphics.arc(x, y - 0.5, 2.2, 3.1416, 6.2832); mgraphics.stroke();
}

// ----- options view -----
function paintOptions(O) {
    var P = O.panel;
    rrect(P.x, P.y, P.w, P.h, 5, COL_PANEL, 1);
    rsrect(P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1, 5, COL_LINE, 1, 1);
    label("OPTIONS  –  what Randomize may use", P.x + 8, P.y + 14, 8.5, COL_TEXT, 1, 0);
    chip(O.close, "DONE", false, COL_CYAN);
    var n = 0;
    for (var i = 0; i < GL_TYPES.length; i++) {
        var ty = GL_TYPES[i];
        var on = !!gState.allow[ty.id];
        if (on) n++;
        var r = O.items[i];
        var c = CAT_COL[ty.category] || COL_DIM;
        rrect(r.x, r.y, r.w, r.h, 3, on ? mix3(COL_BG, c, 0.28) : COL_ROW, 1);
        rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 3, c, on ? 0.9 : 0.3, 1);
        disc(r.x + 7, r.y + r.h / 2, 3, c, on ? 1 : 0.3);
        label(fit(ty.name, r.w - 32, 7.5), r.x + 14, r.y + r.h / 2 + 2.8, 7.5, on ? COL_TEXT : COL_DIM, 1, 0);
        rsrect(r.x + r.w - 14, r.y + r.h / 2 - 4, 8, 8, 2, c, on ? 1 : 0.4, 1);
        if (on) frect(r.x + r.w - 12, r.y + r.h / 2 - 2, 4, 4, c, 1);
    }
    var ra = O.all;
    var allOn = n === GL_TYPES.length;
    chip(ra, allOn ? "ALL OFF" : "ALL ON", false, COL_AMBER);
    label(n + " of " + GL_TYPES.length + " module types allowed  ·  used by Randomize and Mutate", O.note.x, O.note.y + 10, 7.5, n ? COL_DIM : COL_CORAL, 1, 0);
}

// ----- action bar -----
function paintActions(L) {
    var A = L.action;
    var d = A.dice;
    var f = gFlash.dice;
    rrect(d.x, d.y, d.w, d.h, 5, mix3(COL_CORAL, [1, 1, 1], 0.4 * f), hoverIs("act_dice") ? 1 : 0.92);
    paintDice(d.x + 5, d.y + 6.5, 12, COL_BG);
    label("RANDOMIZE", d.x + 21, d.y + d.h / 2 + 3, 7, COL_BG, 1, 0);
    var m = A.mutate;
    rrect(m.x, m.y, m.w, m.h, 5, mix3(COL_ROW, COL_AMBER, 0.55 * gFlash.mutate), 1);
    rsrect(m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1, 5, COL_AMBER, hoverIs("act_mutate") ? 1 : 0.7, 1);
    // mutate glyph: a small wave that gets nudged
    mgraphics.set_line_width(1.4); rgba(COL_AMBER, 1);
    mgraphics.move_to(m.x + 5, m.y + 14); mgraphics.curve_to(m.x + 7, m.y + 6, m.x + 9, m.y + 6, m.x + 11, m.y + 12); mgraphics.curve_to(m.x + 13, m.y + 18, m.x + 15, m.y + 18, m.x + 17, m.y + 10); mgraphics.stroke();
    label("MUTATE", m.x + 21, m.y + m.h / 2 + 3, 7, COL_TEXT, 1, 0);
    var c = A.chaos;
    rrect(c.x, c.y, c.w, c.h, 5, COL_ROW, 1);
    var cf = (c.w - 8) * gState.chaos;
    rrect(c.x + 4, c.y + 14, c.w - 8, 6, 3, COL_BG, 1);
    if (cf > 1) rrect(c.x + 4, c.y + 14, cf, 6, 3, COL_CORAL, 0.9);
    label("CHAOS", c.x + 6, c.y + 10, 7, COL_DIM, 1, 0);
    label(Math.round(gState.chaos * 100) + "%", c.x + c.w - 5, c.y + 10, 7.5, COL_TEXT, 1, 2);
    var o = A.opt;
    rrect(o.x, o.y, o.w, o.h, 5, COL_ROW, 1);
    rsrect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1, 5, COL_CYAN, hoverIs("act_opt") ? 1 : 0.55, 1);
    paintCog(o.x + o.w / 2, o.y + o.h / 2, 7, COL_CYAN);
    var ab = A.ab;
    var morph = gState.audition === "morph";
    rrect(ab.x, ab.y, ab.w, ab.h, 5, COL_ROW, 1);
    rrect(ab.x + 2, ab.y + 2, ab.w / 2 - 2, ab.h - 4, 4, morph ? COL_ROW : COL_CORAL, morph ? 0 : 0.95);
    rrect(ab.x + ab.w / 2, ab.y + 2, ab.w / 2 - 2, ab.h - 4, 4, morph ? gState.corners.length ? weightedColor(xyWeights(gState.xy[0], gState.xy[1])) : COL_CORAL : COL_ROW, morph ? 0.95 : 0);
    label("WORK", ab.x + ab.w / 4 + 0.5, ab.y + ab.h / 2 + 3, 6.5, morph ? COL_DIM : COL_BG, 1, 1);
    label("MORPH", ab.x + ab.w * 3 / 4 - 0.5, ab.y + ab.h / 2 + 3, 6.5, morph ? COL_BG : COL_DIM, 1, 1);
}
function paintDice(x, y, s, c) {
    rrect(x, y, s, s, 3, c, 0.95);
    var dots = [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]];
    for (var i = 0; i < dots.length; i++) disc(x + dots[i][0] * s, y + dots[i][1] * s, 1.5, COL_CORAL, 1);
}
function paintCog(x, y, r, c) {
    ring(x, y, r * 0.55, c, 0.95, 1.6);
    for (var i = 0; i < 8; i++) {
        var a = i * 0.7854;
        mgraphics.set_line_width(2); rgba(c, 0.95);
        mgraphics.move_to(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7);
        mgraphics.line_to(x + Math.cos(a) * r, y + Math.sin(a) * r);
        mgraphics.stroke();
    }
}

// ----- side column: Mix and Output knobs -----
function paintKnob(r, name, norm, text, c) {
    rrect(r.x, r.y, r.w, r.h, 5, COL_PANEL, 1);
    label(name, r.x + r.w / 2, r.y + 11, 7.5, COL_DIM, 1, 1);
    var cx = r.x + r.w / 2, cy = r.y + 34, rad = 15;
    mgraphics.set_line_width(3); rgba(COL_LINE, 1);
    mgraphics.arc(cx, cy, rad, 2.356, 7.069); mgraphics.stroke();
    if (norm > 0.003) { rgba(c, 1); mgraphics.arc(cx, cy, rad, 2.356, 2.356 + norm * 4.712); mgraphics.stroke(); }
    var a = 2.356 + norm * 4.712;
    mgraphics.set_line_width(2); rgba(COL_TEXT, 1);
    mgraphics.move_to(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4);
    mgraphics.line_to(cx + Math.cos(a) * (rad - 4), cy + Math.sin(a) * (rad - 4));
    mgraphics.stroke();
    label(text, r.x + r.w / 2, r.y + 64, 8, COL_TEXT, 1, 1);
}
function mixValue() { return gParamVals.mix === undefined ? GL_PARAMS.mix.init : gParamVals.mix; }
function outValue() { return gParamVals.out === undefined ? GL_PARAMS.out.init : gParamVals.out; }
function paintSide(S) {
    var mx = mixValue(), ov = outValue();
    paintKnob(S.mix, "MIX", mx / 100, Math.round(mx) + "%", COL_CYAN);
    paintKnob(S.out, "OUT", (ov + 36) / 48, (ov >= 0 ? "+" : "") + ov.toFixed(1) + "dB", COL_AMBER);
}

// ----- editor -----
function editorTarget() {
    var key = gState.ui.sel;
    if (!key || !glitchTileInfo(key)) return null;
    return key;
}
function paintEditor(ed) {
    rrect(ed.x, ed.y, ed.w, ed.h, 5, COL_PANEL, 1);
    var key = editorTarget();
    var morph = gState.audition === "morph";
    var rows = key ? glitchEditorRows(key) : [];
    var E = glitchEditorLayout(ed, rows.length);
    if (!key) {
        label("MODULE EDITOR", ed.x + 8, ed.y + 15, 8.5, COL_DIM, 1, 0);
        label("Click a tile in the glitch view", ed.x + ed.w / 2, ed.y + 70, 8, COL_DIM, 1, 1);
        label("to edit its module here.", ed.x + ed.w / 2, ed.y + 82, 8, COL_DIM, 1, 1);
        paintEditorClose(E);
        return;
    }
    var info = glitchTileInfo(key);
    var c = CAT_COL[info.category] || COL_DIM;
    label(fit(info.name, ed.w - 90, 9), ed.x + 8, ed.y + 15, 9, c, 1, 0);
    var locked = glitchIsLocked(gState.working, key);
    var lk = E.lock;
    rrect(lk.x, lk.y, lk.w, lk.h, 3, locked ? COL_AMBER : COL_ROW, 1);
    paintLockGlyph(lk.x + lk.w / 2, lk.y + 6, locked ? COL_BG : COL_DIM, 1);
    var rm = E.remove;
    rrect(rm.x, rm.y, rm.w, rm.h, 3, COL_ROW, 1);
    rgba(COL_CORAL, 1); mgraphics.set_line_width(1.6);
    mgraphics.move_to(rm.x + 4.5, rm.y + 4.5); mgraphics.line_to(rm.x + rm.w - 4.5, rm.y + rm.h - 4.5);
    mgraphics.move_to(rm.x + rm.w - 4.5, rm.y + 4.5); mgraphics.line_to(rm.x + 4.5, rm.y + rm.h - 4.5);
    mgraphics.stroke();
    paintEditorClose(E);
    var g = gState.working;
    var dim = morph ? 0.4 : 1;
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var r = E.rows[i];
        var spec = row.spec;
        var v = glitchGetValue(g, key, row.id);
        rrect(r.x, r.y, r.w, r.h, 3, COL_ROW, dim);
        if (spec.patterns) {
            label("Pattern", r.x + 4, r.y + 9, 7, COL_DIM, dim, 0);
            var cw2 = (r.w - 46) / 16;
            for (var b = 0; b < 16; b++) {
                var on = (Math.floor(v) >> b) & 1;
                frect(r.x + 42 + b * cw2, r.y + 2, cw2 - 1, r.h - 4, c, on ? 0.9 * dim : 0.2 * dim);
            }
            continue;
        }
        if (spec.kind !== "disc") {
            var n = glParamToNorm(spec, v);
            if (row.id === "wet" || spec.kind === "wet") n = clamp(v, 0, 1);
            frect(r.x + 1, r.y + 1, (r.w - 2) * n, r.h - 2, c, 0.4 * dim);
        } else rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 3, c, 0.35 * dim, 1);
        label(fit(row.name, r.w * 0.55, 7), r.x + 4, r.y + 9, 7, COL_TEXT, dim, 0);
        label(fit(glitchFormatValue(spec, v), r.w * 0.45, 7), r.x + r.w - 4, r.y + 9, 7, c, dim, 2);
    }
    if (morph) label("Morph is playing: switch to WORK to edit", ed.x + ed.w / 2, ed.y + ed.h - 5, 7, COL_AMBER, 0.9, 1);
    else label(locked ? "locked: kept by Randomize / Mutate" : "drag = set  ·  dbl-click = reset", ed.x + ed.w / 2, ed.y + ed.h - 5, 7, COL_DIM, 0.9, 1);
}
function paintEditorClose(E) {
    var cl = E.close;
    rrect(cl.x, cl.y, cl.w, cl.h, 3, COL_ROW, 1);
    rgba(COL_TEXT, 1); mgraphics.set_line_width(1.6);
    mgraphics.move_to(cl.x + cl.w / 2 + 2.5, cl.y + 3.5); mgraphics.line_to(cl.x + cl.w / 2 - 2.5, cl.y + cl.h / 2); mgraphics.line_to(cl.x + cl.w / 2 + 2.5, cl.y + cl.h - 3.5);
    mgraphics.stroke();
}

// ----- slots -----
function paintSlots(S) {
    var P = S.rect;
    rrect(P.x, P.y, P.w, P.h, 5, COL_PANEL, 1);
    label("SLOTS", P.x + 6, P.y + 15, 8.5, COL_DIM, 1, 0);
    var cornersOf = [];
    for (var i = 0; i < GL_NSLOT; i++) cornersOf.push([]);
    for (var cc = 0; cc < 4; cc++) cornersOf[gState.corners[cc]].push(cc);
    for (var s = 0; s < GL_NSLOT; s++) {
        var r = S.pads[s];
        var g = gState.slots[s];
        var c = SLOT_COL[s];
        var fl = gFlash.slot === s ? gFlash.slotT : 0;
        if (g) {
            rrect(r.x, r.y, r.w, r.h, 4, mix3(c, [1, 1, 1], 0.5 * fl), hoverIs("slot" + s) ? 1 : 0.86);
            var sig = glitchSignature(g);
            // 12 dots for the GL_NINST chain positions: a dot is lit when any module of its share of the chain is on
            for (var k = 0; k < 12; k++) {
                var lit = false;
                for (var q2 = Math.floor(k * sig.length / 12); q2 < Math.floor((k + 1) * sig.length / 12); q2++) if (sig[q2]) lit = true;
                disc(r.x + 16 + (k % 6) * 3.6, r.y + 8 + Math.floor(k / 6) * 5, 1.2, COL_BG, lit ? 0.9 : 0.18);
            }
            label(s + 1, r.x + 5, r.y + 11, 9, COL_BG, 1, 0);
        } else {
            rrect(r.x, r.y, r.w, r.h, 4, COL_ROW, 1);
            rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 4, c, hoverIs("slot" + s) ? 0.9 : 0.35, 1);
            label(s + 1, r.x + 5, r.y + 11, 9, c, 0.7, 0);
        }
        if (gLastSlot === s) rsrect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, 5, COL_TEXT, 0.95, 1.4);
        // which XY corners point at this slot
        var cs = cornersOf[s];
        for (var q = 0; q < cs.length; q++) {
            var cxx = r.x + r.w - 5 - (cs[q] % 2 ? 0 : 5), cyy = r.y + r.h - 5 - (cs[q] < 2 ? 5 : 0);
            frect(cxx - 1.5, cyy - 1.5, 3, 3, g ? COL_BG : c, 0.95);
        }
    }
    var sv = S.save, cl = S.clear;
    rrect(sv.x, sv.y, sv.w, sv.h, 5, gArmSave ? COL_CORAL : COL_ROW, 1);
    rsrect(sv.x + 0.5, sv.y + 0.5, sv.w - 1, sv.h - 1, 5, COL_CORAL, gArmSave ? 1 : 0.6, 1);
    label("SAVE", sv.x + sv.w / 2, sv.y + sv.h / 2 + 3, 7.5, gArmSave ? COL_BG : COL_TEXT, 1, 1);
    rrect(cl.x, cl.y, cl.w, cl.h, 5, gArmClear ? COL_AMBER : COL_ROW, 1);
    rsrect(cl.x + 0.5, cl.y + 0.5, cl.w - 1, cl.h - 1, 5, COL_AMBER, gArmClear ? 1 : 0.6, 1);
    label("CLEAR", cl.x + cl.w / 2, cl.y + cl.h / 2 + 3, 7.5, gArmClear ? COL_BG : COL_TEXT, 1, 1);
}

// ---------------------------------------------------------------------------------------------------------------
// interaction
// ---------------------------------------------------------------------------------------------------------------
function currentRows() {
    var key = editorTarget();
    return key ? glitchEditorRows(key) : [];
}
function hitAt(x, y) {
    var ui = gState.ui;
    var map = glitchHitMap(ui, gTiles.length, ui.editor ? currentRows().length : 0);
    var best = null;
    for (var i = 0; i < map.length; i++) {
        if (!glHit(map[i].r, x, y)) continue;
        if (!best || map[i].layer >= best.layer) best = map[i];
    }
    return best;
}
function dropCorner(x, y) {
    var p = gLayout.pad;
    if (!glHit(p, x, y)) return -1;
    return (y > p.y + p.h / 2 ? 2 : 0) + (x > p.x + p.w / 2 ? 1 : 0);
}
function padToXY(x, y) {
    var p = gLayout.pad;
    return [clamp((x - (p.x + 8)) / (p.w - 16), 0, 1), clamp((y - (p.y + 8)) / (p.h - 16), 0, 1)];
}
function knobDelta(key, d, fine) {
    var sp = fine ? 0.1 : 1;
    if (key === "mix") { var m = clamp(mixValue() + d * 100 / 120 * sp, 0, 100); sendParam("mix", m); }
    else { var o = clamp(outValue() + d * 48 / 120 * sp, -36, 12); sendParam("out", Math.round(o * 10) / 10); }
    mgraphics.redraw();
}
function setRowFromX(rowIdx, x, shift, d) {
    var key = editorTarget();
    if (!key) return;
    var rows = glitchEditorRows(key);
    var row = rows[rowIdx];
    if (!row) return;
    var spec = row.spec;
    var E = glitchEditorLayout(gLayout.editor, rows.length);
    var r = E.rows[rowIdx];
    var n;
    if (shift && d) n = clamp(d.n0 + (x - d.x0) / (r.w * 8), 0, 1);
    else n = clamp((x - r.x) / r.w, 0, 1);
    var v = row.id === "wet" || spec.kind === "wet" ? n : glNormToParam(spec, n);
    if (glitchSetValue(gState.working, key, row.id, v)) modelChanged();
}
function onclick(x, y, but, cmd, shift, caps, opt) {
    gFocus = true;
    var h = hitAt(x, y);
    if (!h) { gDrag = null; return; }
    var id = h.id;
    var morph = gState.audition === "morph";
    var m;
    if (id === "tg_editor") { toggleSection("editor"); return; }
    if (id === "tg_slots") { toggleSection("slots"); return; }
    if (id === "opt_close") { setOptions(0); return; }
    if (id === "opt_all") {
        undoPush();
        var any = false;
        for (var t in gState.allow) if (!gState.allow[t]) any = true;
        setAllowAll(gState, any);
        mgraphics.redraw(); done();
        return;
    }
    if ((m = /^opt_(\d+)$/.exec(id))) {
        undoPush();
        var ty = GL_TYPES[Number(m[1])];
        setAllow(gState, ty.id, !gState.allow[ty.id]);
        mgraphics.redraw(); done();
        return;
    }
    if (id === "pad") {
        gDrag = { kind: "pad" };
        if (gState.audition !== "morph") setAudition("morph", true);
        var p = padToXY(x, y);
        setXY(p[0], p[1], true);
        return;
    }
    if ((m = /^corner(\d)$/.exec(id))) {
        undoPush();
        var c = Number(m[1]);
        assignCorner(gState, c, (gState.corners[c] + (shift ? 7 : 1)) % GL_NSLOT);
        modelChanged(); done();
        return;
    }
    if ((m = /^tile(\d+)$/.exec(id))) {
        var tile = gTiles[Number(m[1])];
        if (!tile) return;
        if (morph) { gHint = "Morph is playing: switch to WORK to edit modules"; mgraphics.redraw(); return; }
        var ui = gState.ui;
        if (ui.editor && ui.sel === tile.key) { toggleSection("editor"); return; }
        ui.sel = tile.key;
        if (!ui.editor) { ui.editor = 1; ui.options = 0; applyLayout(); } else mgraphics.redraw();
        done();
        return;
    }
    if (id === "act_dice") { doRandomize(null); return; }
    if (id === "act_mutate") { doMutate(); return; }
    if (id === "act_opt") { setOptions(1); return; }
    if (id === "act_ab") {
        var left = x < gLayout.action.ab.x + gLayout.action.ab.w / 2;
        setAudition(left ? "working" : "morph", true);
        done();
        return;
    }
    if (id === "act_chaos") {
        gDrag = { kind: "chaos" };
        var cr = gLayout.action.chaos;
        gState.chaos = clamp((x - (cr.x + 4)) / (cr.w - 8), 0, 1);
        sendParam("chaos", gState.chaos * 100);
        mgraphics.redraw();
        return;
    }
    if (id === "side_mix" || id === "side_out") { gDrag = { kind: "knob", key: id === "side_mix" ? "mix" : "out", y0: y }; return; }
    if (id === "ed_close") { toggleSection("editor"); return; }
    if (id === "ed_lock" || id === "ed_remove") {
        var key = editorTarget();
        if (!key || morph) return;
        undoPush();
        if (id === "ed_lock") glitchToggleLock(gState.working, key);
        else { glitchRemoveTile(gState.working, key); refreshModel(); gState.ui.sel = ""; selectFirstIfNone(); }
        modelChanged(); done();
        return;
    }
    if ((m = /^ed_row(\d+)$/.exec(id))) {
        var ri = Number(m[1]);
        var key2 = editorTarget();
        if (!key2 || morph) return;
        var row = glitchEditorRows(key2)[ri];
        if (!row) return;
        undoPush();
        var spec = row.spec;
        if (spec.patterns) {
            var E = glitchEditorLayout(gLayout.editor, glitchEditorRows(key2).length);
            var rr = E.rows[ri];
            var bit = Math.floor((x - (rr.x + 42)) / ((rr.w - 46) / 16));
            if (bit >= 0 && bit < 16) {
                var nv = Math.floor(glitchGetValue(gState.working, key2, row.id)) ^ (1 << bit);
                if (nv === 0) nv = 1 << bit;
                glitchSetValue(gState.working, key2, row.id, nv);
                modelChanged();
            }
            gDrag = { kind: "rowdone" };
            return;
        }
        if (spec.kind === "disc") {
            var cur = Math.round(glitchGetValue(gState.working, key2, row.id));
            var span = spec.max - spec.min + 1;
            var nxt = ((cur - spec.min + (shift ? span - 1 : 1)) % span) + spec.min;
            glitchSetValue(gState.working, key2, row.id, nxt);
            modelChanged();
            gDrag = { kind: "rowdone" };
            return;
        }
        gDrag = { kind: "row", idx: ri, x0: x, n0: glParamToNorm(spec, glitchGetValue(gState.working, key2, row.id)), shift: shift };
        setRowFromX(ri, x, false, null);
        return;
    }
    if ((m = /^slot(\d)$/.exec(id))) {
        gDrag = { kind: "slot", i: Number(m[1]), x0: x, y0: y, x: x, y: y, moved: false, shift: !!shift, opt: !!opt };
        return;
    }
    if (id === "slot_save") { gArmSave = !gArmSave; gArmClear = false; gHint = gArmSave ? "click a slot to save the working glitch" : ""; mgraphics.redraw(); return; }
    if (id === "slot_clear") { gArmClear = !gArmClear; gArmSave = false; gHint = gArmClear ? "click a slot to clear it" : ""; mgraphics.redraw(); return; }
}
function ondrag(x, y, but, cmd, shift) {
    if (!gDrag) return;
    if (but === 0) { endDrag(x, y); return; }
    var d = gDrag;
    if (d.kind === "pad") { var p = padToXY(x, y); setXY(p[0], p[1], true); }
    else if (d.kind === "chaos") {
        var cr = gLayout.action.chaos;
        gState.chaos = clamp((x - (cr.x + 4)) / (cr.w - 8), 0, 1);
        sendParam("chaos", gState.chaos * 100);
        mgraphics.redraw();
    } else if (d.kind === "knob") { knobDelta(d.key, d.y0 - y, shift); d.y0 = y; }
    else if (d.kind === "row") setRowFromX(d.idx, x, shift, d);
    else if (d.kind === "slot") {
        d.x = x; d.y = y;
        if (!d.moved && Math.abs(x - d.x0) + Math.abs(y - d.y0) > 5) d.moved = true;
        if (d.moved) mgraphics.redraw();
    }
}
function endDrag(x, y) {
    var d = gDrag;
    gDrag = null;
    if (!d) return;
    if (d.kind === "slot") {
        if (d.moved) {
            var c = dropCorner(x, y);
            if (c >= 0) { undoPush(); assignCorner(gState, c, d.i); gFlash.slot = d.i; gFlash.slotT = 1; modelChanged(); done(); }
            else mgraphics.redraw();
            return;
        }
        slotClick(d.i, d.shift, d.opt);
        return;
    }
    if (d.kind === "pad" || d.kind === "row" || d.kind === "rowdone" || d.kind === "chaos") done();
    mgraphics.redraw();
}
function slotClick(i, shift, opt) {
    if (shift || gArmSave) {
        undoPush();
        saveToSlot(gState, i);
        gLastSlot = i;
        gArmSave = false;
        gFlash.slot = i; gFlash.slotT = 1;
        gHint = "saved to slot " + (i + 1);
        modelChanged(); done();
    } else if (opt || gArmClear) {
        gArmClear = false;
        if (gState.slots[i]) { undoPush(); clearSlot(gState, i); if (gLastSlot === i) gLastSlot = -1; gHint = "cleared slot " + (i + 1); modelChanged(); done(); }
        else mgraphics.redraw();
    } else if (gState.slots[i]) {
        recallAction(i);
        gFlash.slot = i; gFlash.slotT = 1;
        gHint = "";
    } else {
        gHint = "slot " + (i + 1) + " is empty: shift-click to save";
        mgraphics.redraw();
    }
}
function ondblclick(x, y) {
    var h = hitAt(x, y);
    if (!h) return;
    var id = h.id;
    var m;
    if (id === "pad") { gDrag = null; setXY(0.5, 0.5, true); done(); }
    else if (id === "act_chaos") { gState.chaos = 0.5; sendParam("chaos", 50); mgraphics.redraw(); done(); }
    else if (id === "side_mix") { sendParam("mix", GL_PARAMS.mix.init); mgraphics.redraw(); }
    else if (id === "side_out") { sendParam("out", GL_PARAMS.out.init); mgraphics.redraw(); }
    else if ((m = /^ed_row(\d+)$/.exec(id)) && gState.audition !== "morph") {
        var key = editorTarget();
        var row = key ? glitchEditorRows(key)[Number(m[1])] : null;
        if (row && !row.spec.patterns) {
            gDrag = null;
            glitchSetValue(gState.working, key, row.id, row.id === "wet" || row.spec.kind === "wet" ? 1 : row.spec.def);
            modelChanged(); done();
        }
    }
}
function onidle(x, y) {
    var h = hitAt(x, y);
    var id = h ? h.id : "";
    var hint = "";
    if (h) {
        var m;
        if (id === "pad") hint = "drag to morph · dbl-click centre";
        else if (/^corner/.test(id)) hint = "click: next slot  ·  or drop a slot here";
        else if (/^tile/.test(id)) hint = "click: edit this module";
        else if (id === "act_dice") hint = "roll a new glitch (Chaos shapes it)";
        else if (id === "act_mutate") hint = "nudge the working glitch";
        else if (id === "act_opt") hint = "which module types Randomize may use";
        else if (id === "act_ab") hint = "what you hear: working glitch or morph";
        else if (id === "act_chaos") hint = "Chaos: how wild Randomize / Mutate go";
        else if (/^slot\d$/.test(id)) hint = "click: recall · shift: save · alt: clear · drag to a corner";
        else if (id === "ed_lock") hint = "keep this module through Randomize / Mutate";
        else if (id === "ed_remove") hint = "remove this module";
        else if (id === "side_mix") hint = "Mix (drag, dbl-click = 100%)";
        else if (id === "side_out") hint = "Output (drag, dbl-click = 0 dB)";
        else if ((m = /^opt_(\d+)$/.exec(id))) hint = "click to allow / forbid";
    }
    if (id !== gHover || hint !== gHint) {
        if (!(gArmSave || gArmClear) || hint) { gHover = id; gHint = hint; mgraphics.redraw(); }
    }
}
function onidleout() { if (gHover || gHint) { gHover = ""; if (!(gArmSave || gArmClear)) gHint = ""; mgraphics.redraw(); } }
function onfocus() { gFocus = true; }
function onblur() { gFocus = false; }
function onkeydown(keycode, textcharacter, down, cmd, shift) {
    if (!gFocus || down === 0) return;
    var ch = typeof textcharacter === "string" ? textcharacter.toLowerCase() : String.fromCharCode(textcharacter || 0).toLowerCase();
    if (cmd && ch === "z") { if (shift) redo(); else undo(); }
}

// ---------------------------------------------------------------------------------------------------------------
// test / debug entry points (messnamed("#0-glitchdebug", ...); scripts/test_glitch_live.js)
// ---------------------------------------------------------------------------------------------------------------
function test_fill() {
    // deterministic slots: 0 = loud drive, 1 = a 60 Hz low pass (almost silent), 2 = width, 3 = delay; corners 0, 1, 0, 1
    undoPush();
    var a = defaultGlitch();
    glitchSetValue(a, "drvA", "wet", 1); glitchSetValue(a, "drvA", "drive", 24);
    var b = defaultGlitch();
    glitchSetValue(b, "filt", "wet", 1); glitchSetValue(b, "filt", "type", 0); glitchSetValue(b, "filt", "cutoff", 60); glitchSetValue(b, "filt", "res", 0.1);
    gState.working = a; saveToSlot(gState, 0);
    gState.working = b; saveToSlot(gState, 1);
    gState.corners = [0, 1, 0, 1];
    gState.working = glCopy(a);
    gState.audition = "working";
    gState.xy = [0.5, 0.5];
    syncParamsOut();
    modelChanged(); done();
}
function test_click(x, y) { onclick(Number(x), Number(y), 1, 0, 0, 0, 0); ondrag(Number(x), Number(y), 0); }
function test_report() {
    refreshModel();
    var rep = {
        ready: dspReady, err: dspError, counter: scopeFrameCounter(), haveTele: gHaveTele, audition: gState.audition, seq: gState.seq, xy: gState.xy, chaos: gState.chaos,
        tiles: gTiles.map(function (t) { return t.key; }), slotsFilled: gState.slots.map(function (s) { return s ? 1 : 0; }), corners: gState.corners,
        ui: gState.ui, width: gLayout.width, seed: gState.seed, allow: gState.allow, locks: gState.working.locks || {}, parts: gParamVals,
    };
    if (gScopeBuf) {
        try {
            var a = gScopeBuf.peek(1, 0, GL_SCOPE.END);
            rep.weights = a.slice(GL_SCOPE.WEIGHTS, GL_SCOPE.WEIGHTS + 8);
            rep.inPeak = a[GL_SCOPE.IN_PEAK]; rep.outPeak = a[GL_SCOPE.OUT_PEAK];
            rep.activity = a.slice(GL_SCOPE.ACTIVITY, GL_SCOPE.ACTIVITY + GL_NINST);
            rep.seqTele = { on: a[GL_SCOPE.SEQ_ON], step: a[GL_SCOPE.SEQ_STEP], slot: a[GL_SCOPE.SEQ_SLOT], prev: a[GL_SCOPE.SEQ_PREV], glide: a[GL_SCOPE.SEQ_GLIDE] };
        } catch (_) {}
    }
    if (typeof Global !== "undefined") new Global("glitch_test").text = JSON.stringify(rep);
    return rep;
}
function test_section(name, on) { gState.ui[String(name)] = Number(on) ? 1 : 0; applyLayout(); done(); }
function test_select(key) { gState.ui.sel = String(key); fixSelection(); mgraphics.redraw(); }

// ---------------------------------------------------------------------------------------------------------------
// preview (scripts/render_preview.py calls preview() once, then paint())
// ---------------------------------------------------------------------------------------------------------------
// The control state shown is the REAL model: the working glitch is what Randomize produces (seed 11) and the slots hold
// what Randomize / Mutate produce too, with default corners / XY / Chaos. Only the audio telemetry is a demo, and the
// face uses it only until the first real telemetry frame (gDemo && !gHaveTele).
function preview() {
    gDemo = true;
    gHaveTele = false;
    gState = defaultState();
    gState.seed = 11;
    rerollWorking(gState);
    for (var s = 0; s < 5; s++) {
        var g = s === 0 ? gState.working : randomizeGlitch(20 + s * 7, gState.chaos, gState.allow);
        gState.slots[s] = glCopy(g);
        gState.slots[s].name = "Glitch " + (s + 1);
    }
    gState.corners = [0, 1, 2, 3];
    gState.xy = [0.5, 0.5];
    gLastSlot = 0;
    gParamVals.mix = 100;
    gParamVals.out = 0;
    gModelDirty = true;
    refreshModel();
    if (typeof UI_PREVIEW_EDITOR !== "undefined" && UI_PREVIEW_EDITOR) {
        gState.ui.editor = 1;
        gState.ui.sel = gTiles.length ? gTiles[Math.min(1, gTiles.length - 1)].key : "";
        glitchToggleLock(gState.working, gState.ui.sel);
    }
    gLayout = glitchFaceLayout(gState.ui);
    demoCache = null;
}
