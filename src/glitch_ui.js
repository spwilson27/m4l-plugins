// Glitch UI (v8ui). ONE canvas that covers the whole device (0,0 .. width,169); every control is drawn here and the Live
// parameters (Morph X / Y, Chaos, Mix, Output, Randomize, Mutate, Mode) are real live.* objects kept OFF the face (Better
// Sampler pattern): the face sends ["param", key, value] through `route`, the object echoes through `prepend set_<key>`
// and is dropped when it is a stale echo of something the face sent (expectEcho / isStaleEcho).
//
// scripts/build_glitch.py prepends src/glitch_config.js (data model + layout, see its header) and injects
// GEN_STAGES (one entry per gen~ stage with its .gendsp JSON text and hash, AGENTS.md 1d: deferred, staged DSP) and UI_PREVIEW.
//
// Sections (collapse / expand, device width follows through live.thisdevice setwidth): CORE (morph pad, glitch view with
// module tiles, action bar; the Options view replaces it), EDIT (module editor), SLOTS (8 slots), SEQ (16-step slot
// sequencer). Layout lives in glitchFaceLayout() (config) so the tests can check every rect.
//
// Motion (phase 3): the editor has a PARAMS | MOTION tab. MOTION sets the module's movement source (Off / LFO / Steps / Env: target,
// rate or division, shape, depth, phase, a step painter); the live value comes back from the gen telemetry (MOVE_*) and is drawn
// as a band + marker on the target's param bar and as a small scope on the glitch-view tile. All edits go to the Working glitch
// (one undo step per gesture, like every other edit).
//
// Modes: Working (the working glitch), Morph (the XY pad over the corner slots), Seq (the sequencer plays the slots). In Morph
// and Seq the pad, the glitch view and the editor show the SOUNDING blend (soundingWeights). Editing a module there first
// copies the sounding blend into the Working glitch and switches to Working (beginWorkingEdit), so an edit is always audible.
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
var SEQ_COL = [0.74, 0.56, 1.0];
var COL_MV = GL_MV_COL; // motion (movement sources): magenta, used by the tiles, the param bars and the Motion panel
var CAT_COL = { Distort: [1.0, 0.52, 0.36], Filter: [0.30, 0.82, 0.88], Pitch: [0.74, 0.56, 1.0], Time: [1.0, 0.77, 0.30], Spectral: [0.46, 0.86, 0.56], Space: [0.44, 0.62, 1.0], Utility: [0.64, 0.70, 0.78], Movement: GL_MV_COL };

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
var gTilePage = 0;
var gSeqArm = -1; // the armed sequencer step (click a slot to assign it), -1 = none
var gSeqSig = "";
var gDemoBeat = 0; // preview only: the beat the demo sequencer sits at
var hostPatcher = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function trace(event, detail) {
    if (typeof Global === "undefined") return;
    try {
        var gl = new Global("glitch_trace");
        var lines = String(gl.text || "").split("\n").filter(function (l) { return l.length > 0; });
        lines.push("+" + (Date.now() - traceT0) + "ms " + event + " " + (detail === undefined ? "" : String(detail)));
        gl.text = lines.slice(-160).join("\n");
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
    if (dspCreatedAt) maybeLoadStages();
}
function refreshModel() {
    if (!gModelDirty && gVec) return;
    // the SOUNDING vector: Seq / Morph blend the slots by the weights that are audible right now (engine telemetry in Seq)
    gVec = blendVectors(engineVectors(gState), soundingWeights(gState, gHaveTele ? gTele : null, gDemo && !gHaveTele ? gDemoBeat : 0));
    gTiles = glitchTiles(gVec);
    gModelDirty = false;
    var sig = gTiles.map(function (t) { return t.key; }).join(",");
    if (sig !== gTileSig) gTileSig = sig;
    var pages = glitchViewLayout(gTiles.length, gLayout.view, 0).pages;
    if (gTilePage >= pages) gTilePage = pages - 1;
    if (gTilePage < 0) gTilePage = 0;
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
// Sequencer entry points (also used by the face): seqrandomize [seed], seqstep <0..15> <slot -1..7>, seqmode
function seqrandomize(seed) {
    undoPush();
    if (seed !== undefined && !isNaN(Number(seed))) gState.seed = Math.max(1, Math.floor(Number(seed)));
    rerollSequence(gState);
    if (filledSlots(gState).length) setAudition("seq", true);
    modelChanged();
    done();
}
function seqstep(i, slot) { undoPush(); setSeqStep(gState, Number(i), Number(slot)); modelChanged(); done(); }
function seqmode() { setAudition("seq", true); done(); }
function seqLengthSet(n) { setSeqLength(gState, n); sendParam("seqlen", gState.seq.length); pushEngine(); mgraphics.redraw(); }
function seqRateSet(r) { setSeqRate(gState, r); sendParam("seqrate", gState.seq.rate); pushEngine(); mgraphics.redraw(); }
function seqGlideSet(g) { setSeqGlide(gState, Math.round(clamp(g, 0, 1) * 100) / 100); sendParam("glide", gState.seq.glide * 100); pushEngine(); mgraphics.redraw(); }
// assign slot (-1 = hold) to step i
function seqAssign(i, slot) {
    undoPush();
    setSeqStep(gState, i, slot);
    modelChanged();
    done();
}
// Editing a module while Morph or Seq plays: copy what you hear into the Working glitch and switch to it, so the edit is audible.
// The caller has already pushed the undo snapshot of the gesture.
function beginWorkingEdit() {
    if (gState.audition === "working") return;
    var from = gState.audition;
    refreshModel();
    if (gTiles.length) {
        var cap = vectorToGlitch(gVec);
        if (gState.working.locks) cap.locks = glCopy(gState.working.locks);
        gState.working = cap;
    }
    setAudition("working", true);
    gHint = "editing the WORKING glitch (copied from " + from.toUpperCase() + ")";
    refreshModel();
}
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
    if (name === "seq" && !ui.seq) gSeqArm = -1;
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
// Deferred, STAGED, LAZY DSP (AGENTS.md 1d). The engine is several gen~ stages (GEN_STAGES, from src/glitch_config.js glitchStages()): the
// head (the one control engine), the tail (Mix, limiter) and one stage per chain module (the STFT is the spectral stage). Gen compiles every
// function definition it contains, and a gen costs about what its code costs, so only the stages a glitch NEEDS are compiled
// (glitchNeededStages: a sounding slot has the module on).
// Right after load (before anything is audible) the face creates every stage's gen~ as a tiny file-backed SHELL (same ports, Params, Buffers,
// no work; identical shells share one compile, embedding them in the device costs 0.8 s of load) and wires the whole graph. From then on the
// graph is STATIC: the selector~ chain (gl_bp<L|R>_<id>; the spectral stand-in is delay~ 1023) bypasses a module until its code runs. Adding a
// gen~ or a cord to a running device silences the whole device for as long as the new gen~ takes to compile (0.1 - 0.7 s, measured in Live),
// but replacing a gen~'s code with `setattr gen` does not (2 - 13 ms): so the code is hot-loaded, one stage per Task tick (the main thread is
// busy for the compile: 0.1 - 1.3 s per stage, the GUI repaints in between). A gen keeps starting after its code arrived and drops messages, so
// dsp_ready (bindings, Mix, Output, bpm, ppq, playing) is sent right after each load and re-sent every 60 ms until each stage's own frame
// counter (scope STAGE_FRAME + index) moves. A module stage that runs is switched in without a click: its selector~ moves to it while its Param
// `go` is 0 (its wets are 0, so it passes the input), then `go 1` ramps the wets in. The chain (output off the dry path) goes on as soon as the
// head and the tail run; the modules join as they compile. A stage a LATER glitch needs (Randomize, a slot, a morph corner, a sequencer step)
// is loaded when the engine buffer is pushed and joins the same way; its module is bypassed for the ~0.1 - 1.5 s that takes. dsp_retry puts
// the shells back (tests).
// ---------------------------------------------------------------------------------------------------------------
var dspReady = 0;
var dspError = "";
var dspCreatedAt = 0;
var dspTask = null;
var dspConfirmTask = null;
var dspPumpTask = null;
var dspSettleTask = null;
var DSP_SETTLE_MS = 300;
var DSP_CONFIRM_MS = 60;
var DSP_TIMEOUT_MS = 20000;
var STAGE_PRIME_MS = 120; // after a module stage runs: its first vectors are over, the binding is resent, then it is switched in
var SPEC_PRIME_MS = 250; // the spectral stage: its 1023-sample delay is long primed
var STAGE_TIMEOUT_MS = 20000;
var dspStages = {}; // id -> { loadedAt, loadMs, cnt0, running, runAt, on, onAt, failed }
var dspQueue = []; // ids waiting for their code

function stageList() { return typeof GEN_STAGES !== "undefined" ? GEN_STAGES : []; }
function stageById(id) { var l = stageList(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
function stageFilePath(st) { return "/tmp/glitch_" + st.id + "_" + st.hash + ".gendsp"; }
function shellFilePath(st) { return "/tmp/glitch_shell_" + st.shellKey + ".gendsp"; }
function writeDspFile(path, text) {
    try {
        var rf = new File(path, "read");
        var have = rf.isopen && rf.eof === text.length;
        rf.close();
        if (have) return true;
    } catch (_) {}
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) return false;
    f.eof = 0;
    for (var i = 0; i < text.length; i += 16384) f.writestring(text.substring(i, i + 16384));
    f.close();
    return true;
}
function scopeAt(slot) {
    if (!gScopeName || typeof Buffer === "undefined") return -1;
    try {
        var v = new Buffer(gScopeName).peek(1, slot, 1);
        return (typeof v === "number") ? v : (v && v.length ? v[0] : -1);
    } catch (_) { return -1; }
}
function scopeFrameCounter() { return scopeAt(GL_SCOPE.FRAME); }
function stageCounter(st) { return scopeAt(GL_SCOPE.STAGE_FRAME + st.index); }
function stageObj(id) { return hostPatcher ? hostPatcher.getnamed("obj-gen-" + id) : null; }
function patchNamed(n) { return hostPatcher ? hostPatcher.getnamed(n) : null; }
function stageNeedsGo(st) { return st.role === "group" || st.role === "spec"; }

function conn(src, so, dst, di) { if (src && dst) hostPatcher.connect(src, so, dst, di); }
/** The chain element before a module stage (null = plugin~): the previous module stage / the spectral stand-in selector. */
function prevElement(st) {
    var l = stageList(), prev = null;
    for (var i = 0; i < l.length; i++) {
        if (l[i].id === st.id) return prev;
        if (l[i].role === "group" || l[i].role === "spec") prev = l[i];
    }
    return prev;
}
function lastElement() {
    var l = stageList(), prev = null;
    for (var i = 0; i < l.length; i++) if (l[i].role === "group" || l[i].role === "spec") prev = l[i];
    return prev;
}
/** The signal after an element: its bypass selector~ (input 1 = the previous point, input 2 = the gen~), or plugin~ for the start. */
function elemOut(el, ch) { return el ? [patchNamed("gl_bp" + (ch ? "R" : "L") + "_" + el.id), 0] : [patchNamed("gl_plugin"), ch]; }
var graphBuilt = false;
/** Create every stage's gen~ as a shell and wire the whole graph (once, before anything is audible; the hubs, selectors and plugin~ are static). */
function buildGraph() {
    if (graphBuilt || !hostPatcher) return;
    var l = stageList();
    var head = null;
    // the objects first, then the cords
    for (var i = 0; i < l.length; i++) {
        var st = l[i];
        var sp = shellFilePath(st);
        if (!writeDspFile(sp, GEN_SHELLS[st.shellKey])) throw new Error("no shell file for stage " + st.id);
        var g = stageObj(st.id) || hostPatcher.newdefault(900 + 6 * st.index, 40 + 24 * (st.index % 20), "gen~", "@gen", sp);
        if (!g) throw new Error("no gen~ for stage " + st.id);
        g.varname = "obj-gen-" + st.id;
    }
    head = stageObj("h");
    for (var j = 0; j < l.length; j++) {
        var s2 = l[j], g2 = stageObj(s2.id);
        var ix = function (name) { return s2.ins.indexOf(name); };
        if (s2.role === "head") {
            conn(patchNamed("gl_genhead"), 0, g2, 0);
            var pl = patchNamed("gl_plugin");
            conn(pl, 0, g2, ix("L")); conn(pl, 1, g2, ix("R"));
        } else if (s2.role === "tail") {
            conn(patchNamed("gl_gentail"), 0, g2, 0);
            var last = lastElement();
            for (var c = 0; c < 2; c++) { var o = elemOut(last, c); conn(o[0], o[1], g2, ix(c ? "R" : "L")); }
            conn(patchNamed("gl_plugin"), 0, g2, ix("dryL")); conn(patchNamed("gl_plugin"), 1, g2, ix("dryR"));
            conn(g2, 0, patchNamed("gl_selL"), 2); conn(g2, 1, patchNamed("gl_selR"), 2);
        } else {
            conn(patchNamed("gl_genmod"), 0, g2, 0);
            var prev = prevElement(s2);
            for (var c2 = 0; c2 < 2; c2++) { var po = elemOut(prev, c2); conn(po[0], po[1], g2, ix(c2 ? "R" : "L")); }
            var names = ["tk", "bi", "bf", "quiet"];
            for (var q = 0; q < names.length; q++) if (ix(names[q]) >= 0) conn(head, stageById("h").outs.indexOf(names[q]), g2, ix(names[q]));
            conn(g2, 0, patchNamed("gl_bpL_" + s2.id), 2); conn(g2, 1, patchNamed("gl_bpR_" + s2.id), 2);
        }
    }
    graphBuilt = true;
    trace("graph", l.length + " shells created and wired");
}
/** Hot-load one stage's real code into its shell gen~ (the main thread is busy for the compile; audio keeps running). */
function loadStageCode(st) {
    var g = stageObj(st.id);
    if (!g) throw new Error("no gen~ shell for stage " + st.id);
    var path = stageFilePath(st);
    if (!writeDspFile(path, st.text)) throw new Error("no file for stage " + st.id);
    var t0 = Date.now();
    g.setattr("gen", path);
    dspStages[st.id] = { loadedAt: Date.now(), loadMs: Date.now() - t0, cnt0: stageCounter(st), running: false, runAt: 0, on: false, onAt: 0, failed: false };
    trace("stage-load", st.id + " " + (Date.now() - t0) + "ms");
}
function queueStage(id) {
    if (dspStages[id] || dspQueue.indexOf(id) >= 0) return;
    dspQueue.push(id);
}
/** One stage per tick: the GUI repaints and the progress pill moves between the (blocking) compiles. */
function pumpLoads() {
    if (!dspQueue.length) return;
    // the head and the tail first, and the chain goes on before any module is compiled (each compile keeps the main thread busy)
    if (!dspReady && dspQueue[0] !== "h" && dspQueue[0] !== "t") { scheduleConfirm(); return; }
    var id = dspQueue.shift();
    try { loadStageCode(stageById(id)); }
    catch (err) {
        dspStages[id] = { loadedAt: Date.now(), loadMs: 0, cnt0: -1, running: false, runAt: 0, on: false, onAt: 0, failed: true };
        trace("stage-error", id + " " + String(err && err.message ? err.message : err));
        if ((id === "h" || id === "t") && !dspReady) dspError = "stage " + id + ": " + String(err && err.message ? err.message : err);
    }
    // the new gen~ has no bindings yet: send them at once (bindings, Mix, Output, bpm, ppq, playing) instead of at the next confirm tick
    outlet(0, "dsp_ready", "bang");
    mgraphics.redraw();
    scheduleConfirm();
    if (dspQueue.length && typeof Task !== "undefined") {
        if (!dspPumpTask) dspPumpTask = new Task(pumpLoads);
        dspPumpTask.schedule(5);
    }
}
function loadDsp() {
    if (dspReady || dspCreatedAt || stageList().length === 0 || !hostPatcher) return;
    try { buildGraph(); }
    catch (err) {
        dspError = String(err && err.message ? err.message : err);
        trace("dsp-error", dspError);
        mgraphics.redraw();
        return;
    }
    trace("dsp-start", "loading stage code");
    dspCreatedAt = Date.now();
    dspQueue = [];
    queueStage("h");
    queueStage("t");
    var need = glitchNeededStages(gState);
    var l = stageList();
    for (var i = 0; i < l.length; i++) if (need.indexOf(l[i].id) >= 0) queueStage(l[i].id);
    pumpLoads();
}
/** Queue the stages a glitch that can sound needs and that have no code yet (never unloaded once loaded). */
function maybeLoadStages() {
    if (!dspCreatedAt || !hostPatcher || stageList().length === 0) return;
    var l = stageList();
    var missing = false;
    for (var m = 0; m < l.length; m++) if (!dspStages[l[m].id]) { missing = true; break; }
    if (!missing) return; // every stage has its code: nothing to decide (the vectors are not rebuilt on every edit)
    var need = glitchNeededStages(gState);
    var queued = false;
    for (var i = 0; i < l.length; i++) if (need.indexOf(l[i].id) >= 0 && !dspStages[l[i].id] && dspQueue.indexOf(l[i].id) < 0) { dspQueue.push(l[i].id); trace("stage-lazy", l[i].id); queued = true; }
    if (queued) {
        if (typeof Task === "undefined") { while (dspQueue.length) pumpLoads(); return; }
        if (!dspPumpTask) dspPumpTask = new Task(pumpLoads);
        dspPumpTask.schedule(1);
    }
}
function scheduleConfirm() {
    if (typeof Task === "undefined") return;
    if (!dspConfirmTask) dspConfirmTask = new Task(dspConfirm);
    dspConfirmTask.schedule(DSP_CONFIRM_MS);
}
function switchInStage(st) {
    // 1. the selector~ moves to the gen~ while go = 0 (its modules are off: it passes the input, sample for sample), 2. go 1 ramps them in
    var g = stageObj(st.id);
    var sl = patchNamed("gl_bpL_" + st.id), sr2 = patchNamed("gl_bpR_" + st.id);
    if (sl) sl.message("int", 2);
    if (sr2) sr2.message("int", 2);
    if (g) g.message("go", 1);
}
/** How many of the stages queued at load run (the chain goes on as soon as the head and the tail do: the modules join as they compile). */
function initialPending() {
    var h = dspStages.h, t = dspStages.t;
    var n = 0, m = 0;
    for (var id in dspStages) { m++; if (dspStages[id].running) n++; }
    return { done: n, total: m, core: !!(h && h.running && t && t.running) };
}
function dspConfirm() {
    var now = Date.now();
    var l = stageList();
    var pending = dspQueue.length > 0;
    for (var i = 0; i < l.length; i++) {
        var st = l[i], rt = dspStages[st.id];
        if (!rt || rt.failed) continue;
        if (!rt.running) {
            var c = stageCounter(st);
            if (rt.cnt0 < 0 && c >= 0) rt.cnt0 = c;
            if (rt.cnt0 >= 0 && c >= 0 && c !== rt.cnt0) { rt.running = true; rt.runAt = now; trace("stage-run", st.id + " +" + (now - rt.loadedAt) + "ms"); }
            else if (now - rt.loadedAt > STAGE_TIMEOUT_MS) {
                rt.failed = true; trace("stage-error", st.id + " not running");
                if ((st.id === "h" || st.id === "t") && !dspReady) dspError = "stage " + st.id + " not running";
                mgraphics.redraw();
            } else pending = true;
        }
        if (rt.running && stageNeedsGo(st) && !rt.on) {
            var head = dspStages.h, tailR = dspStages.t;
            var prime = st.role === "spec" ? SPEC_PRIME_MS : STAGE_PRIME_MS;
            if (head && head.running && tailR && tailR.running && now - rt.runAt >= prime) {
                switchInStage(st); rt.on = true; rt.onAt = now; trace("stage-on", st.id + " +" + (now - rt.loadedAt) + "ms");
                mgraphics.redraw();
            } else pending = true;
        }
        if (rt.on && now - rt.onAt < 600) { var g2 = stageObj(st.id); if (g2) g2.message("go", 1); pending = true; }
    }
    if (!dspReady && dspCreatedAt) {
        var ip = initialPending();
        if (ip.core) {
            dspReady = 1;
            dspError = "";
            trace("dsp", "ready after " + (now - dspCreatedAt) + " ms");
            if (dspQueue.length && typeof Task !== "undefined") { if (!dspPumpTask) dspPumpTask = new Task(pumpLoads); dspPumpTask.schedule(1); }
            outlet(0, "dsp_ready", "bang");
            pushEngine();
            outlet(0, "dsp_on", 2);
            if (typeof Task !== "undefined") {
                if (!dspSettleTask) dspSettleTask = new Task(function () { outlet(0, "dsp_ready", "bang"); pushEngine(); });
                dspSettleTask.schedule(DSP_SETTLE_MS);
            }
            mgraphics.redraw();
        } else if (dspError !== "" || now - dspCreatedAt > DSP_TIMEOUT_MS) {
            if (dspError === "") dspError = "not running (" + ip.done + "/" + ip.total + ")";
            trace("dsp-error", dspError);
            mgraphics.redraw();
            return;
        } else { pending = true; mgraphics.redraw(); }
    }
    if (pending) {
        outlet(0, "dsp_ready", "bang");
        pushEngine();
        scheduleConfirm();
    }
}
/** id -> "none" | "loading" | "running" | "on" | "failed" for every stage (the Live test reads it). */
function stageStates() {
    var out = {}, l = stageList();
    for (var i = 0; i < l.length; i++) {
        var rt = dspStages[l[i].id];
        out[l[i].id] = !rt ? (dspQueue.indexOf(l[i].id) >= 0 ? "loading" : "none") : (rt.failed ? "failed" : (rt.on ? "on" : (rt.running ? (stageNeedsGo(l[i]) ? "running" : "on") : "loading")));
    }
    return out;
}
function stagesFailed() {
    var out = [], l = stageList();
    for (var i = 0; i < l.length; i++) { var rt = dspStages[l[i].id]; if (rt && rt.failed && dspReady) out.push(l[i].id); }
    return out;
}
function dsp_retry() {
    // back to the shells (tests): every stage that has code gets its placeholder again, the selectors go back to the bypass, the output to dry
    try {
        var l = stageList();
        for (var i = 0; i < l.length; i++) {
            var g = stageObj(l[i].id);
            if (g && dspStages[l[i].id]) { var sp = shellFilePath(l[i]); writeDspFile(sp, GEN_SHELLS[l[i].shellKey]); g.setattr("gen", sp); }
            var a = patchNamed("gl_bpL_" + l[i].id), b = patchNamed("gl_bpR_" + l[i].id);
            if (a) a.message("int", 1);
            if (b) b.message("int", 1);
        }
    } catch (_) {}
    dspReady = 0; dspError = ""; dspCreatedAt = 0; dspStages = {}; dspQueue = [];
    outlet(0, "dsp_on", 1);
    loadDsp();
}
function dsp_diag() {
    var info = ["ready=" + dspReady, "err=" + dspError, "startedAt=" + dspCreatedAt, "counter=" + scopeFrameCounter(), "scope=" + gScopeName, "queue=" + dspQueue.join("")];
    try {
        var l = stageList();
        for (var i = 0; i < l.length; i++) {
            var g = stageObj(l[i].id);
            var rt = dspStages[l[i].id];
            var one = "stage " + l[i].id + ":" + (g ? g.maxclass : "none") + ":" + (rt ? "code" : "shell") + " cnt=" + stageCounter(l[i]) + " run=" + (rt && rt.running ? 1 : 0) + " on=" + (rt && rt.on ? 1 : 0);
            if (g) {
                try { var pc = g.patchcords; one += " in=" + (pc && pc.inputs ? pc.inputs.length : "?") + " out=" + (pc && pc.outputs ? pc.outputs.length : "?"); } catch (e2) { one += " cordsErr"; }
            }
            info.push(one);
        }
        info.push("hubs=" + (patchNamed("gl_genhead") ? 1 : 0) + (patchNamed("gl_genmod") ? 1 : 0) + (patchNamed("gl_gentail") ? 1 : 0) + " sel=" + (patchNamed("gl_selL") ? 1 : 0) + " sp=" + (patchNamed("gl_bpL_spec") ? 1 : 0));
    } catch (e) { info.push("diagErr=" + e); }
    trace("dsp-diag", info.join(" | "));
}
/** Test hook: how much audio time the tail lost in the next `ms` ms (its tick counter against the wall clock; 1500 ticks per second at 48 kHz). */
function test_watch(ms) {
    var tl = stageById("t");
    var c0 = stageCounter(tl), t0 = Date.now();
    var last = [0, c0];
    var tk = new Task(function () {
        last = [Date.now() - t0, stageCounter(tl)];
        if (last[0] < Number(ms)) { tk.schedule(2); return; }
        trace("watch", "audio time lost " + Math.round(last[0] - (last[1] - c0) / 1.5) + " ms in " + last[0] + " ms");
    });
    tk.schedule(2);
}
function device_ready() {
    gReady = 1;
    syncParamsOut();
    applyLayout();
    pushEngine();
    if (!dspReady && typeof Task !== "undefined" && stageList().length > 0) {
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
    // Seq: the sounding blend follows the sequencer, so the tiles / pad are rebuilt when its slot or crossfade moves
    var seqLive = gState.audition === "seq" && arr[GL_SCOPE.SEQ_ON] > 0.5;
    if (seqLive) {
        var sig = arr[GL_SCOPE.SEQ_SLOT] + "," + arr[GL_SCOPE.SEQ_PREV] + "," + Math.round(arr[GL_SCOPE.SEQ_GLIDE] * 10);
        if (sig !== gSeqSig) { gSeqSig = sig; gModelDirty = true; quietDrawn = false; }
    }
    var seqMoving = seqLive && arr[GL_SCOPE.SEQ_PLAY] > 0.5 && gState.ui.seq;
    var mvMoving = false;
    for (var mk = 0; mk < GL_NINST; mk++) if (arr[GL_SCOPE.MOVE_ON + mk] > 0.5) { mvMoving = true; break; }
    if (quiet && quietDrawn && !gFlashLive() && !seqMoving && !mvMoving) return;
    quietDrawn = quiet && !seqMoving && !mvMoving;
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
    for (var mk = 0; mk < GL_NINST; mk++) {
        var dmv = glMoveFromVector(gVec, GL_INSTANCES[mk].id);
        if (!dmv || !(a[S.ACTIVITY + mk] > 0)) continue;
        var dph = ((mk * 0.37 + 0.2) % 1);
        var dsg = dmv.type === 1 ? glMoveLfo(dmv.shape, dph, mk * 7.31) : (dmv.type === 2 ? dmv.steps[Math.floor(dph * dmv.nsteps)] : dph);
        a[S.MOVE_ON + mk] = 1;
        a[S.MOVE_PH + mk] = dph;
        a[S.MOVE_OFS + mk] = dmv.depth * dsg;
        var dinst = GL_INSTANCES[mk], dpos = glParamPos(dinst, dmv.target), dsp = dinst.params[dpos];
        a[S.MOVE_POS + mk] = clamp(glParamToNorm(dsp, gVec[L.base[dinst.id] + dpos]) + dmv.depth * dsg, 0, 1);
    }
    if (gState.audition === "seq") {
        var sw = seqWeights(gState.seq, gDemoBeat);
        var wsum = 0;
        for (var wi = 0; wi < 8; wi++) wsum += sw.weights[wi];
        for (var wj = 0; wj < 8; wj++) a[S.WEIGHTS + wj] = wsum > 0 ? sw.weights[wj] / wsum : 0;
        a[S.SEQ_ON] = 1; a[S.SEQ_PLAY] = 1; a[S.SEQ_STEP] = sw.idx; a[S.SEQ_SLOT] = sw.cur; a[S.SEQ_PREV] = sw.prev; a[S.SEQ_GLIDE] = sw.prog; a[S.SEQ_FRAC] = sw.frac; a[S.SEQ_COUNT] = sw.abs;
        a[S.BEAT] = gDemoBeat;
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
    if (L.seq) paintSeq(L.seq);
    paintSide(L.side);
    if (gDrag && (gDrag.kind === "slot" || gDrag.kind === "seqpal") && gDrag.moved) {
        var gi = gDrag.kind === "slot" ? gDrag.i : gDrag.slot;
        rrect(gDrag.x - 16, gDrag.y - 11, 32, 22, 4, gi >= 0 ? SLOT_COL[gi] : COL_DIM, 0.85);
        label(gi >= 0 ? gi + 1 : "hold", gDrag.x, gDrag.y + 4, gi >= 0 ? 11 : 8, COL_BG, 1, 1);
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
    chip(L.toggles.seq, L.ui.seq ? "SEQ <" : "SEQ >", !!L.ui.seq, SEQ_COL);
    var h = L.hint;
    var cy = h.y + h.h / 2;
    var pill = null;
    if (stageList().length > 0 && !gDemo) {
        var made = 0, runN = 0, onN = 0, hasSpec = false;
        var sts = stageStates();
        for (var pi = 0; pi < stageList().length; pi++) {
            var pst = stageList()[pi], stt = sts[pst.id];
            if (stt === "none" || stt === "failed") continue;
            made++;
            if (stt === "on" || stt === "running") runN++;
            if (stt === "on") onN++;
            if (pst.role === "spec" && stt !== "on") hasSpec = true;
        }
        if (!dspReady) pill = dspError !== "" ? { txt: "DSP failed: " + dspError, bad: true } : { txt: "DSP loading… " + runN + "/" + (dspCreatedAt ? made : "?"), bad: false };
        else if (stagesFailed().length) pill = { txt: "DSP failed: stage " + stagesFailed().join(","), bad: true };
        else if (onN < made) pill = { txt: (hasSpec ? "SPECTRAL " : "MODULES ") + onN + "/" + made + " loading…", bad: false };
    }
    if (pill) {
        var pw = Math.min(h.w, tw(pill.txt, 8) + 14);
        rrect(h.x + h.w - pw, cy - 7, pw, 14, 7, pill.bad ? [0.55, 0.12, 0.14] : [0.45, 0.28, 0.06], 1);
        label(fit(pill.txt, pw - 8, 8), h.x + h.w - pw / 2, cy + 3, 8, pill.bad ? [1, 0.82, 0.82] : [1, 0.86, 0.55], 1, 1);
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
        } else if (gState.audition === "seq") {
            var tt = T();
            var qn = gState.seq.length;
            if (tt && tt[GL_SCOPE.SEQ_ON] > 0.5) {
                var cs = tt[GL_SCOPE.SEQ_SLOT], ps = tt[GL_SCOPE.SEQ_PREV];
                text = "SEQ  step " + (tt[GL_SCOPE.SEQ_STEP] + 1) + "/" + qn + "  slot " + (cs >= 0 ? cs + 1 : "-");
                if (tt[GL_SCOPE.SEQ_GLIDE] < 0.98 && ps >= 0 && ps !== cs) text += " <- " + (ps + 1);
                if (tt[GL_SCOPE.SEQ_PLAY] < 0.5) text += "  (stopped)";
            } else text = "SEQ  " + filledSlots(gState).length + " slots, " + qn + " steps";
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

// Seq mode: the weight each XY corner carries = the audible weight of its slot (shared when two corners point at one slot)
function seqCornerWeights(sw) {
    var cw = [0, 0, 0, 0];
    for (var c = 0; c < 4; c++) {
        var same = 0;
        for (var d = 0; d < 4; d++) if (gState.corners[d] === gState.corners[c]) same++;
        cw[c] = (sw[gState.corners[c]] || 0) / same;
    }
    return cw;
}
function paintPad(r, L) {
    var seq = gState.audition === "seq";
    var morph = gState.audition === "morph" || seq; // "live": the pad shows the blend that is sounding
    var sw = morph ? soundingWeights(gState, gHaveTele ? gTele : null, gDemo && !gHaveTele ? gDemoBeat : 0) : null;
    var swSum = 0;
    if (sw) for (var q0 = 0; q0 < 8; q0++) swSum += sw[q0];
    var cw = seq ? seqCornerWeights(swSum > 0 ? sw.map(function (v) { return v / swSum; }) : sw) : xyWeights(gState.xy[0], gState.xy[1]);
    var col = seq ? (cw[0] + cw[1] + cw[2] + cw[3] > 0 ? weightedColor(cw) : SEQ_COL) : weightedColor(cw);
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
    var pxy = gState.xy;
    if (seq) {
        var csum = cw[0] + cw[1] + cw[2] + cw[3];
        pxy = csum > 1e-6 ? [(cw[1] + cw[3]) / csum, (cw[2] + cw[3]) / csum] : [0.5, 0.5];
    }
    var px = r.x + 8 + pxy[0] * (r.w - 16);
    var py = r.y + 8 + pxy[1] * (r.h - 16);
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
    // the slot weights that are sounding (Morph / Seq): 8 small bars between the top corner badges
    if (morph && swSum > 0) {
        for (var q1 = 0; q1 < 8; q1++) {
            var wn = sw[q1] / swSum;
            frect(r.x + 27 + q1 * 7.2, r.y + 3 + 10, 5.5, 1.5, SLOT_COL[q1], 0.3);
            if (wn > 0.01) frect(r.x + 27 + q1 * 7.2, r.y + 13 - 10 * wn, 5.5, 10 * wn, SLOT_COL[q1], 0.95);
        }
    }
    label(seq ? "SEQ" : (morph ? "MORPH" : "WORKING"), r.x + r.w / 2, r.y + r.h - 5, 6.5, morph ? col : COL_DIM, 0.9, 1);
    rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 5, morph ? col : COL_LINE, morph ? 0.75 : 1, morph ? 1.4 : 1);
}

// ----- glitch view: module tiles -----
function gv(id, key) { return gVec[glitchLayout().index[id + "." + key]]; }
function hash2(a, b) { var x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }
function tileBeat() { var t = T(); return t ? (t[GL_SCOPE.BEAT] || 0) : 0; }
function poly(pts, c, a, lw) {
    if (pts.length < 2) return;
    rgba(c, a); mgraphics.set_line_width(lw || 1);
    mgraphics.move_to(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.stroke();
}
function polyArea(pts, baseY, c, a) {
    if (pts.length < 2) return;
    rgba(c, a);
    mgraphics.move_to(pts[0][0], baseY);
    for (var i = 0; i < pts.length; i++) mgraphics.line_to(pts[i][0], pts[i][1]);
    mgraphics.line_to(pts[pts.length - 1][0], baseY);
    mgraphics.close_path();
    mgraphics.fill();
}
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
        case "form": return "vowel " + "aeiou".charAt(Math.round(clamp(g("form", "vowel"), 0, 4))) + " " + (g("form", "shift") >= 0 ? "+" : "") + g("form", "shift").toFixed(0) + "st";
        case "comb": return pick(spec("freq"), g("comb", "freq")) + "Hz fb " + Math.round(g("comb", "fb") * 100);
        case "phas": return pick(spec("stages"), g("phas", "stages")) + "st " + (g("phas", "sync") > 0.5 ? pick(spec("div"), g("phas", "div")) : g("phas", "hz").toFixed(1) + "Hz");
        case "crush": return Math.round(g("crush", "bits")) + "b " + g("crush", "rate").toFixed(1) + "x";
        case "rect": return pick(spec("mode"), g("rect", "mode")) + " " + Math.round(g("rect", "blend") * 100) + "%";
        case "fm": return pick(spec("mode"), g("fm", "mode")) + " x" + g("fm", "ratio").toFixed(1);
        case "corr": return pick(spec("div"), g("corr", "div")) + " " + Math.round(g("corr", "chance") * 100) + "%";
        case "ring": return pick(spec("mode"), g("ring", "mode")) + " " + Math.round(g("ring", "freq")) + "Hz";
        case "stut": return pick(spec("div"), g("stut", "div"));
        case "time": return pick(spec("mode"), g("time", "mode")) + " " + pick(spec("div"), g("time", "div"));
        case "gpit": return (g("gpit", "pitch") >= 0 ? "+" : "") + g("gpit", "pitch").toFixed(0) + "st " + Math.round(g("gpit", "size")) + "ms";
        case "gstr": return "speed " + Math.round(g("gstr", "speed") * 100) + "% " + Math.round(g("gstr", "size")) + "ms";
        case "rvs": return pick(spec("div"), g("rvs", "div")) + " " + Math.round(g("rvs", "chance") * 100) + "%";
        case "shuf": return pick(spec("slices"), g("shuf", "slices")) + " slices #" + Math.round(g("shuf", "seed"));
        case "chop": return pick(spec("div"), g("chop", "div")) + " " + pick(spec("pattern"), g("chop", "pattern"));
        case "dly": return pick(spec("div"), g("dly", "div")) + " fb " + Math.round(g("dly", "fb") * 100);
        case "slap": return Math.round(g("slap", "time")) + "ms";
        case "rev": return "size " + Math.round(g("rev", "size") * 100) + "%";
        case "wid": return "W " + Math.round(g("wid", "width") * 100) + "% " + g("wid", "gain").toFixed(0) + "dB";
        case "freeze": return pick(spec("frz_rate"), g("spec", "frz_rate"));
        case "smear": return "blur " + Math.round(g("spec", "smr_blur") * 100) + "%";
        case "ccrush": return "K " + Math.round(g("spec", "cc_coeffs") * 100) + "% " + Math.round(g("spec", "cc_bits")) + "b";
        case "scramble": return pick(spec("sc_mode"), g("spec", "sc_mode"));
        case "scatter": return "w " + Math.round(g("spec", "sct_w")) + " " + pick(spec("sct_rate"), g("spec", "sct_rate"));
        case "mirror": return "pivot " + pick(spec("mir_pivot"), g("spec", "mir_pivot")) + "Hz";
        case "binshift": return (g("spec", "bsh_bins") >= 0 ? "+" : "") + g("spec", "bsh_bins").toFixed(0) + " bins";
        case "specgate": return g("spec", "sgl_mode") > 0.5 ? "Lofi " + g("spec", "sgl_step").toFixed(0) + "dB" : "Top-K " + Math.round(g("spec", "sgl_k"));
        case "ratc": return pick(spec("div"), g("ratc", "div")) + " x" + Math.round(g("ratc", "count")) + (g("ratc", "accel") >= 0 ? " accel " : " decel ") + Math.round(Math.abs(g("ratc", "accel")) * 100) + "%";
        case "scrb": return pick(spec("shape"), g("scrb", "shape")) + " " + pick(spec("rate"), g("scrb", "rate")) + " " + Math.round(g("scrb", "depth") * 100) + "%";
        case "gfreeze": return Math.round(g("spec", "gfz_dens") * 100) + "% held " + pick(spec("gfz_rate"), g("spec", "gfz_rate"));
        case "stretch": return (g("spec", "str_mode") > 0.5 ? "harm " : "") + (g("spec", "str_st") >= 0 ? "+" : "") + (g("spec", "str_mode") > 0.5 ? g("spec", "str_st").toFixed(1) : Math.round(g("spec", "str_st"))) + "st";
        case "bubbler": return "spread " + Math.round(g("spec", "bub_spread")) + " " + Math.round(g("spec", "bub_dens") * 100) + "%";
        case "mp3ify": return Math.round(g("spec", "mp3_kbps")) + " kbps";
        case "duststorm": return pick(spec("dst_mode"), g("spec", "dst_mode")) + " " + Math.round(g("spec", "dst_kbps")) + "k " + pick(spec("dst_rate"), g("spec", "dst_rate"));
        case "thinner": return "+-" + Math.round(g("spec", "thn_n")) + " bins soft " + Math.round(g("spec", "thn_soft") * 100) + "%";
        case "decap": return "cut " + Math.round(g("spec", "dec_k")) + " boost " + g("spec", "dec_boost").toFixed(0) + "dB";
        case "noisify": return "+-" + g("spec", "nsf_depth").toFixed(0) + "dB /" + Math.round(g("spec", "nsf_grain"));
        case "clipper": return pick(spec("clp_mode"), g("spec", "clp_mode")) + " " + g("spec", "clp_db").toFixed(0) + "dB";
        case "pswap": return "width " + Math.round(g("spec", "psw_w"));
        case "rphase": return pick(spec("rph_mode"), g("spec", "rph_mode")) + " " + Math.round(g("spec", "rph_rand") * 100) + "%";
    }
    return "";
}

// The spectrum columns the spectral tiles draw: nb columns of BANDS_OUT (or BANDS_IN) values 0..1
function specCols(t, off, nb) {
    var out = [];
    for (var b = 0; b < nb; b++) out.push(t ? clamp(t[off + Math.min(GL_BANDS - 1, Math.floor(b * GL_BANDS / nb))] || 0, 0, 1) : 0);
    return out;
}

function paintTileBody(tile, x, y, w, h, c, act) {
    var t = T();
    var S = GL_SCOPE;
    if (h < 8 || w < 8) return;
    var lv = t ? clamp(t[S.LEVEL + tile.chain] || 0, 0, 1) : 0;
    var amp = 0.35 + 0.65 * lv;
    var beat = tileBeat();
    var i, j, k, pts, nb, vals;
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
            for (i = 0; i < 16; i++) {
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
            nb = Math.max(6, Math.floor(w / 3));
            var vin = specCols(t, S.BANDS_IN, nb), vout = specCols(t, S.BANDS_OUT, nb);
            for (i = 0; i < nb; i++) {
                frect(x + i * (w / nb), y + h - vin[i] * h, w / nb - 1, vin[i] * h, COL_DIM, 0.25);
                frect(x + i * (w / nb), y + h - vout[i] * h, w / nb - 1, vout[i] * h, c, 0.8);
            }
            break;
        }
        case "ccrush": case "scramble": {
            var nc = Math.max(8, Math.floor(w / 3));
            hline(x, x + w, y + h / 2, COL_DIM, 0.35, 1);
            for (k = 0; k < nc; k++) {
                var ki = Math.floor(k * GL_CEP_BINS / nc);
                var co = t ? t[S.CEP_IN + ki] || 0 : 0;
                var cn = t ? t[S.CEP_OUT + ki] || 0 : 0;
                var bw = w / nc;
                frect(x + k * bw, y + h / 2 - (co > 0 ? co * h / 2 : 0), bw - 1, Math.abs(co) * h / 2, COL_DIM, 0.3);
                frect(x + k * bw, y + h / 2 - (cn > 0 ? cn * h / 2 : 0), bw - 1, Math.abs(cn) * h / 2, c, 0.85);
            }
            break;
        }
        case "form": { // three formant peaks (vowel, shift, resonance) pulsing with the level
            var vw = clamp(gv("form", "vowel"), 0, 3.999), vi = Math.floor(vw), vf = vw - vi;
            var VA = GL_VOWELS[vi], VB = GL_VOWELS[vi + 1], kf = Math.pow(2, gv("form", "shift") / 12);
            var fwid = 0.16 / (0.6 + gv("form", "res") * 1.6);
            pts = [];
            for (i = 0; i <= 40; i++) {
                var xn = i / 40, yv = 0.05;
                for (j = 0; j < 3; j++) {
                    var ff = (VA[j] + (VB[j] - VA[j]) * vf) * kf;
                    var fxn = (Math.log(clamp(ff, 150, 6000)) - Math.log(150)) / (Math.log(6000) - Math.log(150));
                    var dd = (xn - fxn) / (fwid * (j ? 0.7 : 1));
                    yv = Math.max(yv, (j === 0 ? 1 : (j === 1 ? 0.8 : 0.6)) * Math.exp(-dd * dd));
                }
                pts.push([x + xn * w, y + h - 1 - yv * amp * (h - 2)]);
            }
            polyArea(pts, y + h - 1, c, 0.35);
            poly(pts, c, 0.95, 1.2);
            break;
        }
        case "comb": { // comb teeth: spacing from the frequency, height decays with the feedback (negative = odd teeth dim)
            var cnorm = Math.log(gv("comb", "freq") / 40) / Math.log(100);
            var cnt = 3 + Math.round(clamp(cnorm, 0, 1) * 10);
            var fbk = gv("comb", "fb");
            for (i = 0; i < cnt; i++) {
                var th = (0.3 + 0.7 * Math.pow(Math.abs(fbk), i * 0.12)) * amp;
                var odd = fbk < 0 && (i & 1);
                frect(x + (i + 0.5) * w / cnt - 1, y + h - th * h, 2, th * h, c, odd ? 0.4 : 0.95);
            }
            hline(x, x + w, y + h - 0.5, c, 0.4, 1);
            break;
        }
        case "phas": { // notches sweeping with the LFO (free in Hz or on the host beat)
            var psync = gv("phas", "sync") > 0.5;
            var pdiv = Math.round(clamp(gv("phas", "div"), 0, 6));
            var pph = psync ? beat / GL_LFO_BEATS[pdiv] : (Date.now() / 1000) * gv("phas", "hz");
            var sweep = 0.5 + 0.5 * Math.sin(pph * 6.2832);
            var nn = Math.round(gv("phas", "stages")) + 1, dep = gv("phas", "depth");
            pts = [];
            for (i = 0; i <= 40; i++) {
                var xq = i / 40, yq = 1;
                for (j = 0; j < nn; j++) { var xj = ((j + 0.5) / nn) * (0.3 + 0.7 * sweep); var dq = (xq - xj) / 0.05; yq -= dep * 0.85 * Math.exp(-dq * dq); }
                pts.push([x + xq * w, y + h - 1 - clamp(yq, 0.05, 1) * amp * (h - 2)]);
            }
            polyArea(pts, y + h - 1, c, 0.25);
            poly(pts, c, 0.95, 1.2);
            break;
        }
        case "rect": { // one sine cycle and what the rectifier makes of it
            var rmode = Math.round(gv("rect", "mode")), rbl = gv("rect", "blend");
            var rmid = y + h / 2, rh = (h / 2 - 1) * amp;
            var p0 = [], p1 = [];
            for (i = 0; i <= 40; i++) {
                var sv = Math.sin(i / 40 * 6.2832);
                var rv = rmode === 0 ? Math.max(sv, 0) : (rmode === 1 ? Math.abs(sv) : (sv > 0 ? sv : 0.35 * sv));
                p0.push([x + i / 40 * w, rmid - sv * rh]);
                p1.push([x + i / 40 * w, rmid - (sv + (rv - sv) * rbl) * rh]);
            }
            hline(x, x + w, rmid, COL_DIM, 0.3, 1);
            poly(p0, COL_DIM, 0.45, 1);
            poly(p1, c, 0.95, 1.4);
            break;
        }
        case "fm": { // a carrier phase-modulated by its modulator (index, ratio)
            var fidx = gv("fm", "index") * 6, frat = clamp(gv("fm", "ratio"), 0.5, 8);
            pts = [];
            for (i = 0; i <= 60; i++) {
                var tt2 = i / 60;
                pts.push([x + tt2 * w, y + h / 2 - Math.sin(6.2832 * (2 * tt2 + fidx * Math.sin(6.2832 * frat * tt2 * 0.5) * 0.3)) * (h / 2 - 1) * amp]);
            }
            hline(x, x + w, y + h / 2, COL_DIM, 0.3, 1);
            poly(pts, c, 0.95, 1.2);
            break;
        }
        case "corr": { // a grid of bits: how many flip is the Chance, the pattern re-rolls every Slot (host beat)
            var gc = Math.max(4, Math.floor(w / 5.5)), gr = Math.max(1, Math.floor(h / 5.5));
            var cslot = Math.floor(beat / GL_DIV_BEATS[Math.round(clamp(gv("corr", "div"), 0, 7))]);
            var cch = gv("corr", "chance") * (0.35 + 0.65 * Math.max(gv("corr", "flips"), gv("corr", "wrap"), gv("corr", "drop"), 0.2));
            for (i = 0; i < gc; i++) for (j = 0; j < gr; j++) {
                var lit = hash2(i + j * 31, cslot) < cch;
                frect(x + i * (w / gc), y + j * (h / gr), w / gc - 1.2, h / gr - 1.2, c, lit ? 0.4 + 0.55 * amp : 0.14);
            }
            break;
        }
        case "gpit": { // grains (size, jitter) lifted or dropped by the pitch
            var gsz = clamp(gv("gpit", "size") / 400, 0.1, 0.6) * w * 0.55, gjt = gv("gpit", "jitter"), gpt = clamp(gv("gpit", "pitch") / 24, -1, 1);
            var gslot = Math.floor(beat * 2);
            for (i = 0; i < 5; i++) {
                var gcx = x + (i + 0.5) / 5 * w * 0.86 + (hash2(i, gslot) - 0.5) * gjt * w * 0.18;
                var gbase = y + h - 2 - (gpt * 0.5 + 0.5) * h * 0.3;
                pts = [];
                for (j = 0; j <= 8; j++) { var uu = j / 8; pts.push([gcx - gsz / 2 + uu * gsz, gbase - Math.sin(uu * 3.1416) * h * 0.5 * amp]); }
                polyArea(pts, gbase, c, 0.5);
                poly(pts, c, 0.9, 1);
            }
            var ay = y + h / 2, ax = x + w - 4;
            poly(gpt >= 0 ? [[ax - 3, ay + 1], [ax, ay - 3], [ax + 3, ay + 1]] : [[ax - 3, ay - 1], [ax, ay + 3], [ax + 3, ay - 1]], COL_TEXT, 0.85, 1.4);
            break;
        }
        case "gstr": { // the source ticks and a playhead that crawls at the Speed, with the grain window around it
            var gspd = gv("gstr", "speed"), gsz2 = clamp(gv("gstr", "size") / 400, 0.1, 0.6) * w * 0.4;
            nb = Math.max(8, Math.floor(w / 3));
            for (i = 0; i < nb; i++) frect(x + i * (w / nb), y + h / 2 - (0.15 + 0.7 * hash2(i, 3)) * h / 2, w / nb - 1, (0.15 + 0.7 * hash2(i, 3)) * h, COL_DIM, 0.3);
            var gph = gspd < 0.02 ? 0.5 : (Date.now() % (600 + Math.round((1 - gspd) * 8000))) / (600 + Math.round((1 - gspd) * 8000));
            frect(x + gph * w - gsz2 / 2, y, gsz2, h, c, 0.25 + 0.3 * amp);
            vline(x + gph * w, y, y + h, c, 1, 1.6);
            break;
        }
        case "rvs": { // eight slices, each reversed (arrow left) or not by the seeded chance
            var rdv = GL_DIV_BEATS[Math.round(clamp(gv("rvs", "div"), 0, 7))];
            var rcur = Math.floor(beat / rdv) % 8, rgrp = Math.floor(beat / (8 * rdv));
            for (i = 0; i < 8; i++) {
                var rx = x + i * (w / 8), rw = w / 8 - 1.5;
                var rev = hash2(i + 5 * rgrp, 7) < gv("rvs", "chance");
                frect(rx, y, rw, h, c, i === rcur ? 0.5 : 0.18);
                var rm = y + h / 2;
                poly(rev ? [[rx + rw - 2, rm - 3], [rx + 2, rm], [rx + rw - 2, rm + 3]] : [[rx + 2, rm - 3], [rx + rw - 2, rm], [rx + 2, rm + 3]], c, rev ? 1 : 0.5, 1.2);
            }
            break;
        }
        case "shuf": { // the slices in their shuffled order: bar height = the slice that plays there
            var sn = GL_SLICE_COUNTS[Math.round(clamp(gv("shuf", "slices"), 0, 3))], sseed = gv("shuf", "seed");
            var sidx = [];
            for (i = 0; i < sn; i++) sidx.push(i);
            sidx.sort(function (a, b) { return hash2(a, sseed + 1) - hash2(b, sseed + 1); });
            var sspan = GL_SHUF_SPANS[Math.round(clamp(gv("shuf", "span"), 0, 2))];
            var scur = Math.floor(beat / (sspan / sn)) % sn;
            for (i = 0; i < sn; i++) frect(x + i * (w / sn), y + h - (sidx[i] + 1) / sn * h, w / sn - 1, (sidx[i] + 1) / sn * h, c, i === scur ? 1 : 0.4);
            break;
        }
        case "slap": { // the dry hit and its one short echo (time), left / right offset apart
            var stm = (gv("slap", "time") - 40) / 140, soff = gv("slap", "offset");
            frect(x + 2, y + 1, 3, h - 2, COL_DIM, 0.7);
            var ex = x + 8 + stm * (w - 22);
            frect(ex, y + h * 0.1, 3, (h * 0.8) * amp, c, 0.95);
            frect(clamp(ex + soff * w * 0.1, x + 6, x + w - 3), y + h * 0.1, 3, (h * 0.8) * amp * 0.8, mix3(c, [1, 1, 1], 0.5), 0.8);
            hline(x, x + w, y + h - 0.5, c, 0.3, 1);
            break;
        }
        case "scatter": { // spectral peaks thrown sideways by the width, re-rolled every beat division
            nb = Math.max(8, Math.floor(w / 3));
            vals = specCols(t, S.BANDS_OUT, nb);
            var sctw = gv("spec", "sct_w") / 32, sslot = Math.floor(beat / GL_DIV_BEATS[Math.round(clamp(gv("spec", "sct_rate"), 0, 7))]);
            for (i = 0; i < nb; i++) {
                var dxs = (hash2(i, sslot) - 0.5) * sctw * w * 0.5;
                frect(clamp(x + i * (w / nb) + dxs, x, x + w - 2.5), y + h - vals[i] * h, 2.5, Math.max(1.5, vals[i] * h), c, 0.85);
            }
            break;
        }
        case "mirror": { // the spectrum folded over the pivot (the right side is the mirror of the left)
            nb = Math.max(8, Math.floor(w / 3));
            vals = specCols(t, S.BANDS_OUT, nb);
            var mp = clamp((Math.log(gv("spec", "mir_pivot")) - Math.log(100)) / (Math.log(8000) - Math.log(100)), 0.12, 0.88);
            for (i = 0; i < nb; i++) {
                var xnn = (i + 0.5) / nb, src = xnn <= mp ? xnn : 2 * mp - xnn, mv = src >= 0 ? vals[Math.min(nb - 1, Math.floor(src * nb))] : 0;
                frect(x + i * (w / nb), y + h - mv * h, w / nb - 1, mv * h, c, xnn <= mp ? 0.85 : 0.5);
            }
            for (j = 0; j < h; j += 4) vline(x + mp * w, y + j, y + Math.min(h, j + 2), COL_TEXT, 0.8, 1);
            break;
        }
        case "binshift": { // the input spectrum (ghost) and the shifted result, with the shift arrow
            nb = Math.max(8, Math.floor(w / 3));
            var bin = specCols(t, S.BANDS_IN, nb), bout = specCols(t, S.BANDS_OUT, nb);
            for (i = 0; i < nb; i++) {
                frect(x + i * (w / nb), y + h - bin[i] * h, w / nb - 1, bin[i] * h, COL_DIM, 0.25);
                frect(x + i * (w / nb), y + h - bout[i] * h, w / nb - 1, bout[i] * h, c, 0.8);
            }
            var bsh = clamp(gv("spec", "bsh_bins") / 64, -1, 1), bax = x + w / 2, bay = y + 3;
            poly([[bax, bay], [bax + bsh * w * 0.45, bay]], COL_TEXT, 0.9, 1.5);
            poly(bsh >= 0 ? [[bax + bsh * w * 0.45 - 3, bay - 2.5], [bax + bsh * w * 0.45, bay], [bax + bsh * w * 0.45 - 3, bay + 2.5]] : [[bax + bsh * w * 0.45 + 3, bay - 2.5], [bax + bsh * w * 0.45, bay], [bax + bsh * w * 0.45 + 3, bay + 2.5]], COL_TEXT, 0.9, 1.5);
            break;
        }
        case "specgate": { // Top-K: only the loudest bins stay lit; Lofi: the levels are quantized into steps
            nb = Math.max(8, Math.floor(w / 3));
            vals = specCols(t, S.BANDS_OUT, nb);
            if (gv("spec", "sgl_mode") > 0.5) {
                var levels = clamp(Math.round(24 / gv("spec", "sgl_step")) + 1, 2, 12);
                for (i = 0; i < nb; i++) { var qv = Math.floor(vals[i] * levels) / levels; frect(x + i * (w / nb), y + h - qv * h, w / nb - 1, qv * h, c, 0.85); }
                for (j = 1; j < levels; j++) hline(x, x + w, y + h - j / levels * h, COL_TEXT, 0.12, 1);
            } else {
                var keep = Math.max(1, Math.ceil(clamp(Math.log(gv("spec", "sgl_k")) / Math.log(256), 0, 1) * nb));
                var sorted = vals.slice().sort(function (a, b) { return b - a; });
                var thr = sorted[Math.min(nb - 1, keep - 1)];
                for (i = 0; i < nb; i++) frect(x + i * (w / nb), y + h - vals[i] * h, w / nb - 1, vals[i] * h, vals[i] >= thr && vals[i] > 0 ? c : COL_DIM, vals[i] >= thr && vals[i] > 0 ? 0.95 : 0.22);
            }
            break;
        }
        case "ratc": { // the repeats of a roll: bar widths are the geometric lengths (accel), heights the decay; the playing repeat lights up
            var rn = Math.round(clamp(gv("ratc", "count"), 2, 16)), rq = Math.pow(2, -3 * gv("ratc", "accel") / (rn - 1)), rdc = gv("ratc", "decay");
            var rtot = 0, rwd = [];
            for (i = 0; i < rn; i++) { rwd.push(Math.pow(rq, i)); rtot += rwd[i]; }
            var rcur = t && (t[S.RAT_ON] || 0) > 0.05 ? Math.round(t[S.RAT_IDX] || 0) : -1;
            var rxx = x;
            for (i = 0; i < rn; i++) {
                var rbw = rwd[i] / rtot * w, rbh = h * (0.3 + 0.65 * Math.pow(1 - rdc * 0.6, i));
                frect(rxx, y + h - rbh, Math.max(rbw - 1.2, 1), rbh, c, i === rcur ? 1 : 0.45);
                rxx += rbw;
            }
            break;
        }
        case "scrb": { // one cycle of the scratch shape (sine / saw / random) with the platter dot riding it on the host beat; the live lag shows as a bar
            var sshp = Math.round(clamp(gv("scrb", "shape"), 0, 2)), sdp = gv("scrb", "depth");
            var scy = beat / GL_DIV_BEATS[Math.round(clamp(gv("scrb", "rate"), 0, 7))], sph = scy - Math.floor(scy);
            var scv = function (u) { return sshp === 0 ? Math.sin(6.2832 * u) : (sshp === 1 ? (u < 0.85 ? -1 + 2 * u / 0.85 : 1 - 2 * (u - 0.85) / 0.15) : glMoveLfo(5, Math.floor(scy) + u, 3.3)); };
            pts = [];
            for (i = 0; i <= 40; i++) pts.push([x + i / 40 * w, y + h / 2 - scv(i / 40) * sdp * (h / 2 - 2)]);
            hline(x, x + w, y + h / 2, COL_DIM, 0.3, 1);
            poly(pts, c, 0.9, 1.3);
            disc(x + sph * w, y + h / 2 - scv(sph) * sdp * (h / 2 - 2), 2.4, c, 1);
            var slg = t ? clamp(t[S.SCR_POS] || 0, 0, 1) : 0;
            frect(x + w - 3, y + h - slg * h, 3, slg * h, c, 0.7);
            break;
        }
        case "gfreeze": { // the spectrum with the held bins (hash of bin and re-roll slot) flat-lined in the accent colour
            nb = Math.max(8, Math.floor(w / 3));
            vals = specCols(t, S.BANDS_OUT, nb);
            var gfs = Math.floor(beat / GL_DIV_BEATS[Math.round(clamp(gv("spec", "gfz_rate"), 0, 7))]), gfd = gv("spec", "gfz_dens");
            for (i = 0; i < nb; i++) {
                var held = hash2(i, gfs) < gfd;
                frect(x + i * (w / nb), y + h - vals[i] * h, w / nb - 1, vals[i] * h, held ? c : COL_DIM, held ? 0.95 : 0.35);
                if (held) hline(x + i * (w / nb), x + (i + 1) * (w / nb) - 1, y + h - vals[i] * h, COL_TEXT, 0.9, 1);
            }
            break;
        }
        case "stretch": { // the spectrum with its partials re-spaced: ghost = input, bars = result, arrow = the pitch
            nb = Math.max(8, Math.floor(w / 3));
            var tin = specCols(t, S.BANDS_IN, nb), tout = specCols(t, S.BANDS_OUT, nb);
            for (i = 0; i < nb; i++) {
                frect(x + i * (w / nb), y + h - tin[i] * h, w / nb - 1, tin[i] * h, COL_DIM, 0.25);
                frect(x + i * (w / nb), y + h - tout[i] * h, w / nb - 1, tout[i] * h, c, 0.8);
            }
            var sts = clamp(gv("spec", "str_st") / 24, -1, 1), stx = x + w / 2, sty = y + 3;
            poly([[stx, sty], [stx + sts * w * 0.45, sty]], COL_TEXT, 0.9, 1.5);
            poly([[stx + sts * w * 0.45 - Math.sign(sts || 1) * 3, sty - 2.5], [stx + sts * w * 0.45, sty], [stx + sts * w * 0.45 - Math.sign(sts || 1) * 3, sty + 2.5]], COL_TEXT, 0.9, 1.5);
            if (gv("spec", "str_mode") > 0.5) for (j = 1; j < 4; j++) vline(x + w * (j / 4 + gv("spec", "str_inh") * 0.05 * j), y + h - 4, y + h, COL_TEXT, 0.7, 1);
            break;
        }
        case "bubbler": { // bars with bubbles rising off the chosen bins (density), as wide as the spread
            nb = Math.max(8, Math.floor(w / 3));
            vals = specCols(t, S.BANDS_OUT, nb);
            var bbs = Math.floor(beat * 8), bsp = gv("spec", "bub_spread"), bdn = gv("spec", "bub_dens");
            for (i = 0; i < nb; i++) frect(x + i * (w / nb), y + h - vals[i] * h, w / nb - 1, vals[i] * h, c, 0.6);
            for (i = 0; i < nb; i++) if (hash2(i, bbs) < bdn * 2.2) ring(x + (i + 0.5) * (w / nb), y + h - vals[i] * h - 3, Math.min(1 + bsp * 0.4, 4), c, 1, 1);
            break;
        }
        case "mp3ify": case "duststorm": { // the 21 Bark-like bands as stair-stepped bars (levels from the bitrate), HF cut at the cutoff; Duststorm scrambles the band heights
            var mkb = key2(tile.key === "mp3ify" ? "mp3_kbps" : "dst_kbps"), mtb = clamp(Math.log(mkb / 16) / Math.log(20), 0, 1), mlv = Math.min(12, 1 + Math.round(31 * Math.pow(mtb, 1.5)));
            nb = 21;
            vals = specCols(t, S.BANDS_OUT, nb);
            var mcut = 2500 * Math.pow(10, mtb), msr = (t && t[S.SR]) || 48000, mdust = tile.key === "duststorm";
            var mdd = mdust ? gv("spec", "dst_depth") : 0, mslot = Math.floor(beat / GL_DIV_BEATS[Math.round(clamp(gv("spec", mdust ? "dst_rate" : "mp3_amt") * (mdust ? 1 : 0), 0, 7))]);
            for (i = 0; i < nb; i++) {
                var mfq = 1960 * ((i * 24 / 21) + 0.53) / (26.28 - i * 24 / 21);
                var mqq = Math.max(1 / mlv, Math.round(vals[i] * mlv) / mlv) * (mfq <= mcut ? 1 : 0.06);
                mqq = clamp(mqq * (1 + mdd * (hash2(i, mslot) - 0.5) * 1.6), 0, 1);
                frect(x + i * (w / nb), y + h - mqq * h, w / nb - 1, mqq * h, mfq <= mcut ? c : COL_DIM, mfq <= mcut ? 0.9 : 0.3);
            }
            break;
        }
        case "thinner": { // only the local peaks stay lit
            nb = Math.max(8, Math.floor(w / 3));
            vals = specCols(t, S.BANDS_OUT, nb);
            var tnn = Math.max(1, Math.round(gv("spec", "thn_n") / 3)), tsf = gv("spec", "thn_soft");
            for (i = 0; i < nb; i++) {
                var tmx = 0;
                for (j = Math.max(0, i - tnn); j <= Math.min(nb - 1, i + tnn); j++) tmx = Math.max(tmx, vals[j]);
                var tpk = vals[i] >= tmx;
                frect(x + i * (w / nb), y + h - vals[i] * h * (tpk ? 1 : tsf), w / nb - 1, vals[i] * h * (tpk ? 1 : tsf), tpk ? c : COL_DIM, tpk ? 0.95 : 0.3);
            }
            break;
        }
        case "decap": { // the loudest bins are cut off (outline), the next ones stand taller
            nb = Math.max(8, Math.floor(w / 3));
            vals = specCols(t, S.BANDS_OUT, nb);
            var dsort = vals.slice().sort(function (a, b) { return b - a; });
            var dk = Math.max(1, Math.round(clamp(gv("spec", "dec_k"), 1, 32) / 32 * nb * 0.6)), dth = dsort[Math.min(nb - 1, dk - 1)], dth2 = dsort[Math.min(nb - 1, 2 * dk - 1)], dbg = Math.pow(10, gv("spec", "dec_boost") / 20);
            for (i = 0; i < nb; i++) {
                var dcut = vals[i] >= dth, dnx = !dcut && vals[i] >= dth2;
                var dh = dcut ? 0 : Math.min(1, vals[i] * (dnx ? dbg : 1));
                frect(x + i * (w / nb), y + h - dh * h, w / nb - 1, dh * h, dnx ? COL_TEXT : c, dnx ? 0.9 : 0.75);
                if (dcut) frect(x + i * (w / nb), y + h - vals[i] * h, w / nb - 1, 1.2, COL_CORAL, 0.9);
            }
            break;
        }
        case "noisify": { // every bar jittered by a random gain (depth dB, grain bins), re-rolled each frame
            nb = Math.max(8, Math.floor(w / 3));
            vals = specCols(t, S.BANDS_OUT, nb);
            var nfr = Math.floor(Date.now() / 90), nde = gv("spec", "nsf_depth"), ngr = Math.max(1, Math.round(gv("spec", "nsf_grain") / 2));
            for (i = 0; i < nb; i++) {
                var ngn = Math.pow(10, (hash2(Math.floor(i / ngr), nfr) * 2 - 1) * nde / 20);
                var nbh = clamp(vals[i] * ngn, 0, 1);
                frect(x + i * (w / nb), y + h - nbh * h, w / nb - 1, nbh * h, c, 0.85);
            }
            break;
        }
        case "clipper": { // bars flattened at the ceiling line (soft = rounded corner)
            nb = Math.max(8, Math.floor(w / 3));
            vals = specCols(t, S.BANDS_OUT, nb);
            var cdb = Math.pow(10, gv("spec", "clp_db") / 20), csoft = gv("spec", "clp_mode") < 0.5;
            var cpk = 0.001;
            for (i = 0; i < nb; i++) cpk = Math.max(cpk, vals[i]);
            var cceil = Math.min(1, cpk * cdb * 1.0 + 0.04);
            for (i = 0; i < nb; i++) {
                var cv2 = vals[i] > cceil ? cceil : vals[i];
                if (csoft && vals[i] > cceil) cv2 = cceil * (0.9 + 0.1 * Math.tanh(vals[i] - cceil));
                frect(x + i * (w / nb), y + h - cv2 * h, w / nb - 1, cv2 * h, vals[i] > cceil ? COL_AMBER : c, 0.85);
            }
            hline(x, x + w, y + h - cceil * h, COL_TEXT, 0.6, 1);
            break;
        }
        case "pswap": { // arcs joining the bins whose phases trade places (block width)
            var pw = Math.max(1, Math.round(Math.log(clamp(gv("spec", "psw_w"), 8, 512) / 8) / Math.log(64) * 3) + 1);
            var pbw = w / pw;
            for (i = 0; i < pw; i++) {
                var pa0 = x + i * pbw + 2, pa1 = x + (i + 1) * pbw - 2;
                mgraphics.set_line_width(1.2); rgba(c, 0.55 + 0.4 * amp);
                mgraphics.move_to(pa0, y + h - 2); mgraphics.curve_to(pa0, y + 1, pa1, y + 1, pa1, y + h - 2); mgraphics.stroke();
                disc(pa0, y + h - 2, 1.6, c, 1);
                disc(pa1, y + h - 2, 1.6, COL_TEXT, 0.9);
            }
            break;
        }
        case "rphase": { // Robot: evenly spaced pulses (hop-rate buzz); Whisper: scattered grains; Random blends them
            var rmd = gv("spec", "rph_mode") > 0.5, rrd = gv("spec", "rph_rand"), rslot = Math.floor(Date.now() / 120);
            var rnp = Math.max(6, Math.floor(w / 4));
            for (i = 0; i < rnp; i++) {
                var rjx = (hash2(i, rslot) - 0.5) * (rmd ? 1 : rrd) * (w / rnp) * 1.6;
                var rbh2 = (rmd ? 0.2 + 0.8 * hash2(i, rslot + 3) : 1) * (0.35 + 0.65 * amp) * h * 0.85;
                frect(clamp(x + (i + 0.5) * (w / rnp) + rjx - 0.8, x, x + w - 1.6), y + (h - rbh2) / 2, 1.6, rbh2, c, 0.9);
            }
            break;
        }
        default: {
            var nbar = Math.max(6, Math.floor(w / 5));
            for (var q = 0; q < nbar; q++) {
                var thr2 = (q + 1) / nbar;
                frect(x + q * (w / nbar), y + h / 2 - 3, w / nbar - 1.5, 6, c, lv >= thr2 - 0.5 / nbar ? 0.9 : 0.18);
            }
        }
    }
}

// The tile's motion indicator (a 10 x 6 px scope in the motion colour): a dot that travels with the movement's phase and rides the
// source value up and down. Without telemetry it rests at the start of the cycle.
function paintTileMotion(tile, x, y) {
    var live = moveLive(tile.inst);
    var mv = tile.mv;
    rrect(x, y, 11, 7, 2, COL_BG, 1);
    rsrect(x + 0.5, y + 0.5, 10, 6, 2, COL_MV, live ? 0.9 : 0.5, 1);
    var sg = live && Math.abs(mv.depth) > 0.002 ? clamp(live.ofs / mv.depth, -1, 1) : 0;
    var ph = live ? (mv.type === 3 ? 0.5 : live.ph) : 0;
    if (mv.type === 3) sg = live ? live.ph * 2 - 1 : -1;
    disc(x + 2 + 7 * ph, y + 3.5 - sg * 2.2, 1.5, COL_MV, 1);
}
function key2(k) { return gVec[glitchLayout().index["spec." + k]]; }
function chainBadge(tile) { return (tile.chain < 9 ? "0" : "") + (tile.chain + 1); }

function paintView(r) {
    var tiles = gTiles;
    var V = glitchViewLayout(tiles.length, r, gTilePage);
    var morph = gState.audition === "morph";
    var seq = gState.audition === "seq";
    if (!tiles.length) {
        rrect(r.x, r.y, r.w, r.h, 5, COL_BG, 1);
        rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 5, COL_LINE, 1, 1);
        label(seq ? "The sequence is silent" : (morph ? "Nothing in the morph yet" : "No glitch yet"), r.x + r.w / 2, r.y + r.h / 2 - 2, 10, COL_TEXT, 0.9, 1);
        label(seq ? "save glitches into slots, then fill steps" : (morph ? "save glitches into slots, assign corners" : "press RANDOMIZE"), r.x + r.w / 2, r.y + r.h / 2 + 12, 8, COL_DIM, 0.9, 1);
        return;
    }
    var t = T();
    for (var i = 0; i < V.rects.length; i++) {
        var ti = V.first + i;
        var tile = tiles[ti];
        var q = V.rects[i];
        var c = tileColor(tile);
        var act = t ? clamp(t[GL_SCOPE.ACTIVITY + tile.chain] || 0, 0, 1) : tile.wet;
        var sel = gState.ui.sel === tile.key;
        var compact = V.compact;
        var small = q.h < 34;
        rrect(q.x, q.y, q.w, q.h, 4, mix3(COL_BG, c, 0.1 + 0.2 * act), 1);
        rsrect(q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1, 4, sel ? COL_TEXT : c, sel ? 1 : 0.55, sel ? 1.6 : 1);
        var fs = compact ? 6 : 7.5;
        var badge = chainBadge(tile);
        var locked = glitchIsLocked(gState.working, tile.key);
        var showBadge = !(compact && locked && tile.mv); // a compact tile that is locked AND moving drops its chain number to keep the name
        var bw2 = showBadge ? tw(badge, 5.5) : 0;
        if (showBadge) label(badge, q.x + q.w - 3, q.y + (compact ? 7 : 9.5), 5.5, COL_DIM, 0.9, 2);
        var mvw = tile.mv ? 13 : 0;
        label(fit(compact ? (GL_TINY[tile.key] || tile.name) : tile.name, q.w - 8 - bw2 - (locked ? 8 : 0) - mvw, fs), q.x + 4, q.y + (compact ? 7.5 : 10), fs, c, 1, 0);
        if (locked) paintLockGlyph(q.x + q.w - 8 - bw2, q.y + (compact ? 5 : 7.5), COL_AMBER, 0.95);
        if (tile.mv) paintTileMotion(tile, q.x + q.w - 6 - bw2 - (locked ? 8 : 0) - 11, q.y + (compact ? 3 : 5.5));
        var by = q.y + q.h - 4;
        frect(q.x + 3, by, q.w - 6, 2, c, 0.2);
        frect(q.x + 3, by, (q.w - 6) * clamp(tile.wet, 0, 1), 2, c, 0.9);
        var top = q.y + (compact ? 10 : 13);
        var bodyH = (small || compact) ? Math.max(0, by - top - 2) : Math.max(0, by - top - (q.h > 44 ? 12 : 2));
        paintTileBody(tile, q.x + 4, top, q.w - 8, bodyH, c, act);
        if (!compact && !small && q.h > 44) label(fit(tilePrimary(tile), q.w - 6, 6.5), q.x + q.w / 2, q.y + q.h - 8, 6.5, COL_TEXT, 0.8, 1);
    }
    paintRibbon(V, tiles, r);
}
// The chain ribbon under the tiles: 25 ticks, one per chain position; a tick is lit (category colour) where a tile sits, bright
// for the tiles of this page. With more than 12 tiles the pager (prev / next, "page/pages +hidden") sits at the right.
function paintRibbon(V, tiles, view) {
    var R = V.ribbon;
    var tkw = R.w / GL_NINST;
    var onPage = {};
    for (var i = 0; i < V.rects.length; i++) onPage[tiles[V.first + i].chain] = true;
    var any = {};
    for (var k = 0; k < tiles.length; k++) if (!any[tiles[k].chain]) any[tiles[k].chain] = tiles[k];
    for (var p = 0; p < GL_NINST; p++) {
        var tx = R.x + p * tkw;
        if (any[p]) {
            var cc = tileColor(any[p]);
            frect(tx + 0.5, R.y + 3, tkw - 1, 6, cc, onPage[p] ? 0.95 : 0.4);
        } else frect(tx + 0.5, R.y + 6, tkw - 1, 2, COL_LINE, 0.7);
    }
    if (V.prev) {
        var hv = hoverIs("pg_prev"), hn = hoverIs("pg_next");
        rrect(V.prev.x, V.prev.y, V.prev.w, V.prev.h, 3, COL_ROW, 1);
        rrect(V.next.x, V.next.y, V.next.w, V.next.h, 3, COL_ROW, 1);
        var mp2 = V.prev.y + V.prev.h / 2;
        poly([[V.prev.x + 10, mp2 - 3.5], [V.prev.x + 5, mp2], [V.prev.x + 10, mp2 + 3.5]], COL_TEXT, V.page > 0 ? (hv ? 1 : 0.85) : 0.3, 1.6);
        poly([[V.next.x + 6, mp2 - 3.5], [V.next.x + 11, mp2], [V.next.x + 6, mp2 + 3.5]], COL_TEXT, V.page < V.pages - 1 ? (hn ? 1 : 0.85) : 0.3, 1.6);
        label((V.page + 1) + "/" + V.pages + " +" + (tiles.length - V.rects.length), V.pageText.x + V.pageText.w / 2, V.pageText.y + 9, 6.5, COL_AMBER, 1, 1);
    }
}

function paintLockGlyph(x, y, c, a) {
    frect(x - 3, y - 0.5, 6, 4.5, c, a);
    rgba(c, a); mgraphics.set_line_width(1.2);
    mgraphics.arc(x, y - 0.5, 2.2, 3.1416, 6.2832); mgraphics.stroke();
}

// ----- options view: categories on the left (toggle for the whole category + select), the selected category's types on the right -----
function paintCheck(x, y, s, st, c, hover) {
    rrect(x, y, s, s, 2, st ? mix3(COL_BG, c, 0.35) : COL_ROW, 1);
    rsrect(x + 0.5, y + 0.5, s - 1, s - 1, 2, c, st ? 1 : (hover ? 0.8 : 0.45), 1);
    if (st === 1) { rgba(c, 1); mgraphics.set_line_width(1.6); mgraphics.move_to(x + s * 0.22, y + s * 0.52); mgraphics.line_to(x + s * 0.42, y + s * 0.74); mgraphics.line_to(x + s * 0.78, y + s * 0.26); mgraphics.stroke(); }
    else if (st === 2) frect(x + s * 0.25, y + s * 0.42, s * 0.5, s * 0.16, c, 1);
}
function paintOptions(O) {
    var P = O.panel;
    rrect(P.x, P.y, P.w, P.h, 5, COL_PANEL, 1);
    rsrect(P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1, 5, COL_LINE, 1, 1);
    label("OPTIONS  –  what Randomize may use", P.x + 8, P.y + 14, 8.5, COL_TEXT, 1, 0);
    chip(O.close, "DONE", false, COL_CYAN);
    var cats = glitchOptionCategories();
    var cur = gState.ui.optCat;
    var n = 0;
    for (var i = 0; i < GL_ALLOW_ITEMS.length; i++) if (gState.allow[GL_ALLOW_ITEMS[i].id]) n++;
    chip(O.all, n === GL_ALLOW_ITEMS.length ? "ALL OFF" : "ALL ON", false, COL_AMBER);
    for (var c = 0; c < cats.length; c++) {
        var cc = CAT_COL[cats[c].name] || COL_DIM;
        var st = glitchCategoryState(gState, c);
        var row = O.cats[c];
        var selected = c === cur;
        rrect(row.select.x, row.select.y, row.select.w, row.select.h, 3, selected ? mix3(COL_BG, cc, 0.3) : COL_ROW, 1);
        rsrect(row.select.x + 0.5, row.select.y + 0.5, row.select.w - 1, row.select.h - 1, 3, cc, selected ? 0.95 : (hoverIs("optcat_sel" + c) ? 0.7 : 0.3), 1);
        var cnt = 0;
        for (var q = 0; q < cats[c].types.length; q++) if (gState.allow[GL_ALLOW_ITEMS[cats[c].types[q]].id]) cnt++;
        var cntText = cnt + "/" + cats[c].types.length;
        label(fit(cats[c].name.toUpperCase(), row.select.w - 12 - tw(cntText, 6.5), 7.5), row.select.x + 5, row.select.y + 10, 7.5, selected ? COL_TEXT : COL_DIM, 1, 0);
        label(cntText, row.select.x + row.select.w - 4, row.select.y + 10, 6.5, st ? cc : COL_DIM, 1, 2);
        paintCheck(row.toggle.x + 1, row.toggle.y + 1, 12, st, cc, hoverIs("optcat_tg" + c));
    }
    var cur3 = CAT_COL[cats[cur].name] || COL_DIM;
    var pg = glitchOptionPage(cur, gState.ui.optPage);
    for (var t = 0; t < pg.items.length; t++) {
        var ty = GL_ALLOW_ITEMS[pg.items[t]];
        var on = !!gState.allow[ty.id];
        var r = O.slots[t];
        rrect(r.x, r.y, r.w, r.h, 4, on ? mix3(COL_BG, cur3, 0.25) : COL_ROW, 1);
        rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 4, cur3, on ? 0.9 : (hoverIs("opt_" + pg.items[t]) ? 0.7 : 0.3), 1);
        label(fit(cats[cur].name === "Spectral" ? ty.name.replace(/^Spectral /, "") : ty.name, r.w - 26, 7.5), r.x + 6, r.y + r.h / 2 + 2.8, 7.5, on ? COL_TEXT : COL_DIM, 1, 0);
        paintCheck(r.x + r.w - 17, r.y + r.h / 2 - 6, 12, on ? 1 : 0, cur3, false);
    }
    label(fit(n + " of " + GL_ALLOW_ITEMS.length + " allowed  ·  Randomize / Mutate", O.note.w, 7), O.note.x, O.note.y + 10, 7, n ? COL_DIM : COL_CORAL, 1, 0);
    if (pg.pages > 1) {
        // pager of a long category (Spectral): [<] 1/3 [>]
        chip(O.prev, "<", false, cur3);
        chip(O.next, ">", false, cur3);
        label((pg.page + 1) + "/" + pg.pages, O.pageText.x + O.pageText.w / 2, O.pageText.y + 10, 7.5, COL_TEXT, 1, 1);
    }
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
    var mi = engineMode(gState);
    rrect(ab.x, ab.y, ab.w, ab.h, 5, COL_ROW, 1);
    var cw3 = (ab.w - 4) / 3;
    var mcols = [COL_CORAL, gState.corners.length ? weightedColor(xyWeights(gState.xy[0], gState.xy[1])) : COL_CORAL, SEQ_COL];
    var mnames = ["WORK", "MORPH", "SEQ"];
    for (var mm = 0; mm < 3; mm++) {
        var cx3 = ab.x + 2 + mm * cw3;
        if (mm === mi) rrect(cx3, ab.y + 2, cw3, ab.h - 4, 4, mcols[mm], 0.95);
        label(mnames[mm], cx3 + cw3 / 2, ab.y + ab.h / 2 + 3, 6.2, mm === mi ? COL_BG : COL_DIM, 1, 1);
    }
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
// The value the editor shows: the working glitch while Working plays, else the sounding blend (Morph / Seq)
function editorValue(key, id) {
    if (gState.audition === "working") return glitchGetValue(gState.working, key, id);
    var info = glitchTileInfo(key);
    var ix = info ? glitchLayout().index[info.inst + "." + id] : undefined;
    return ix === undefined || !gVec ? 0 : gVec[ix];
}
function chainPosOf(instId) {
    for (var i = 0; i < GL_INSTANCES.length; i++) if (GL_INSTANCES[i].id === instId) return i;
    return -1;
}
// The movement the editor shows for tile `key`: the Working glitch's, or (Morph / Seq) the one in the sounding blend.
function editorMove(key) {
    var info = glitchTileInfo(key);
    if (!info) return null;
    if (gState.audition === "working") return glitchGetMove(gState.working, key);
    if (!gVec) return null;
    var mv = glMoveFromVector(gVec, info.inst);
    return mv && glMoveInTile(glInstance(info.inst), mv.target, info.sub) ? mv : null;
}
function editorMoveType() {
    var key = editorTarget();
    var mv = key ? editorMove(key) : null;
    return mv ? mv.type : 0;
}
// live movement of an instance from the telemetry: { on, ofs, pos, ph } or null
function moveLive(instId) {
    var t = T();
    var k = chainPosOf(instId);
    if (!t || k < 0 || !(t[GL_SCOPE.MOVE_ON + k] > 0.5)) return null;
    return { on: 1, ofs: t[GL_SCOPE.MOVE_OFS + k] || 0, pos: t[GL_SCOPE.MOVE_POS + k] || 0, ph: t[GL_SCOPE.MOVE_PH + k] || 0 };
}
// glyphs of the movement types: Off (a dash), LFO (a sine), Steps (stairs), Env (attack / decay)
function mvTypeGlyph(ty, x, y, w, h, c, a) {
    var cx = x + w / 2, cy = y + h / 2, i;
    if (ty === 0) { hline(cx - 4, cx + 4, cy, c, a, 1.4); return; }
    var pts = [];
    if (ty === 1) for (i = 0; i <= 12; i++) pts.push([cx - 6 + i, cy - Math.sin(i / 12 * 6.2832) * 3.2]);
    else if (ty === 2) pts = [[cx - 6, cy + 2], [cx - 6, cy - 1], [cx - 3, cy - 1], [cx - 3, cy - 3.5], [cx, cy - 3.5], [cx, cy + 3], [cx + 3, cy + 3], [cx + 3, cy], [cx + 6, cy]];
    else for (i = 0; i <= 12; i++) pts.push([cx - 6 + i, i < 3 ? cy + 3 - i * 2.2 : cy - 3.6 + (i - 3) * 0.7]);
    poly(pts, c, a, 1.3);
}
function mvShapeGlyph(sh, x, y, w, h, c, a) {
    var pts = [], n = 12, cyc = sh >= 5 ? 2 : 1;
    for (var i = 0; i <= n; i++) pts.push([x + 3 + (w - 6) * i / n, y + h / 2 - glMoveLfo(sh, cyc * i / n, 0) * (h / 2 - 2.5)]);
    poly(pts, c, a, 1.2);
}
function mvBar(r, name, norm, text, hot, bip, dim) {
    rrect(r.x, r.y, r.w, r.h, 3, COL_ROW, dim);
    if (bip) {
        var mid = r.x + r.w / 2, w = (r.w - 2) * (norm - 0.5);
        frect(w >= 0 ? mid : mid + w, r.y + 1, Math.abs(w), r.h - 2, COL_MV, 0.45 * dim);
        vline(mid, r.y + 1, r.y + r.h - 1, COL_DIM, 0.55 * dim, 1);
    } else frect(r.x + 1, r.y + 1, (r.w - 2) * norm, r.h - 2, COL_MV, 0.4 * dim);
    if (hot) rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 3, COL_MV, 0.8, 1);
    label(name, r.x + 4, r.y + 9, 7, COL_TEXT, dim, 0);
    label(text, r.x + r.w - 4, r.y + 9, 7, COL_MV, dim, 2);
}
function mvLogNorm(v, lo, hi) { return clamp((Math.log(Math.max(v, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)), 0, 1); }
function mvLogVal(n, lo, hi) { return Math.exp(Math.log(lo) + clamp(n, 0, 1) * (Math.log(hi) - Math.log(lo))); }
function mvMs(v) { return v >= 100 ? Math.round(v) + " ms" : v.toFixed(v >= 10 ? 0 : 1) + " ms"; }
// norm (0..1) of a bar for a movement field, and its text
function mvFieldNorm(id, mv) {
    switch (id) {
        case "mv_rate": return mv.sync ? mv.div / (GL_MV_DIV_BEATS.length - 1) : mvLogNorm(mv.hz, 0.02, 20);
        case "mv_depth": return (mv.depth + 1) / 2;
        case "mv_phase": return mv.phase;
        case "mv_glide": return mv.glide;
        case "mv_atk": return mvLogNorm(mv.atk, 1, 500);
        case "mv_rel": return mvLogNorm(mv.rel, 5, 2000);
    }
    return 0;
}
function mvFieldText(id, mv) {
    switch (id) {
        case "mv_rate": return glitchMoveRateText(mv);
        case "mv_depth": return (mv.depth >= 0 ? "+" : "") + Math.round(mv.depth * 100) + "%";
        case "mv_phase": return Math.round(mv.phase * 100) + "%";
        case "mv_glide": return Math.round(mv.glide * 100) + "%";
        case "mv_atk": return mvMs(mv.atk);
        case "mv_rel": return mvMs(mv.rel);
    }
    return "";
}
function paintEditorTabs(E, key) {
    var mv = editorMove(key);
    var tabs = [[E.tabParams, "PARAMS", 0], [E.tabMotion, "MOTION", 1]];
    for (var i = 0; i < 2; i++) {
        var r = tabs[i][0], on = gState.ui.edTab === tabs[i][2];
        var col = i === 1 ? COL_MV : COL_TEXT;
        rrect(r.x, r.y, r.w, r.h, 3, on ? mix3(COL_BG, col, 0.3) : COL_ROW, 1);
        rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 3, i === 1 ? COL_MV : COL_LINE, on ? 0.95 : (hoverIs("ed_tab" + i) ? 0.7 : 0.35), 1);
        label(tabs[i][1], r.x + r.w / 2 + (i === 1 && mv ? 3 : 0), r.y + 9, 7, on ? COL_TEXT : COL_DIM, 1, 1);
        if (i === 1 && mv) disc(r.x + 8, r.y + r.h / 2, 2.2, COL_MV, 1);
    }
}
function paintMotion(ed, key, info, c, morph) {
    var mv = editorMove(key);
    var dim = morph ? 0.7 : 1;
    var cands = glitchMoveCandidates(key);
    var ML = glitchMotionLayout(ed, mv ? mv.type : 0);
    var ty = mv ? mv.type : 0;
    for (var i = 0; i < 4; i++) {
        var r = ML.type[i], on = i === ty;
        rrect(r.x, r.y, r.w, r.h, 3, on ? mix3(COL_BG, COL_MV, 0.35) : COL_ROW, 1);
        rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 3, COL_MV, on ? 0.95 : (hoverIs("mv_type" + i) ? 0.7 : 0.3), 1);
        mvTypeGlyph(i, r.x, r.y, r.w, r.h - 2, on ? COL_TEXT : COL_DIM, 1);
        label(GL_MV_TYPE_NAMES[i].toUpperCase(), r.x + r.w / 2, r.y + r.h - 1.5, 4.8, on ? COL_TEXT : COL_DIM, 0.9, 1);
    }
    if (!cands.length) {
        label("This module has no continuous", ed.x + ed.w / 2, ed.y + 88, 8, COL_DIM, 1, 1);
        label("parameter to move.", ed.x + ed.w / 2, ed.y + 100, 8, COL_DIM, 1, 1);
        return;
    }
    if (!mv) {
        label("Pick LFO, Steps or Env to make", ed.x + ed.w / 2, ed.y + 84, 8, COL_DIM, 1, 1);
        label(fit(info.name, ed.w - 20, 8) + " move over time.", ed.x + ed.w / 2, ed.y + 96, 8, COL_DIM, 1, 1);
        label("Default target: " + (glitchMainParam(key) || "-"), ed.x + ed.w / 2, ed.y + 112, 7, COL_MV, 0.9, 1);
        return;
    }
    var tr = ML.target;
    var tname = "";
    for (var ci = 0; ci < cands.length; ci++) if (cands[ci].id === mv.target) tname = cands[ci].name;
    rrect(tr.x, tr.y, tr.w, tr.h, 3, COL_ROW, dim);
    rsrect(tr.x + 0.5, tr.y + 0.5, tr.w - 1, tr.h - 1, 3, COL_MV, hoverIs("mv_target") ? 0.9 : 0.45, 1);
    label("Moves", tr.x + 4, tr.y + 9, 7, COL_DIM, dim, 0);
    label(fit(tname, tr.w - 60, 7.5), tr.x + 36, tr.y + 9, 7.5, COL_TEXT, dim, 0);
    if (cands.length > 1) label("click: next", tr.x + tr.w - 4, tr.y + 9, 6, COL_DIM, dim, 2);
    chip(ML.sync, mv.sync ? "SYNC" : "FREE", !!mv.sync, COL_MV);
    mvBar(ML.rate, ty === 2 ? "Step" : "Rate", mvFieldNorm("mv_rate", mv), mvFieldText("mv_rate", mv), hoverIs("mv_rate"), false, dim);
    if (ML.shape) {
        for (var si = 0; si < ML.shape.length; si++) {
            var sr2 = ML.shape[si], son = mv.shape === si;
            rrect(sr2.x, sr2.y, sr2.w, sr2.h, 2, son ? mix3(COL_BG, COL_MV, 0.35) : COL_ROW, dim);
            mvShapeGlyph(si, sr2.x, sr2.y, sr2.w, sr2.h, son ? COL_TEXT : COL_DIM, 1);
            if (hoverIs("mv_shape" + si)) rsrect(sr2.x + 0.5, sr2.y + 0.5, sr2.w - 1, sr2.h - 1, 2, COL_MV, 0.8, 1);
        }
    }
    if (ML.nsteps) {
        chip(ML.nsteps, mv.nsteps + " ST", false, COL_MV);
        mvBar(ML.glide, "Glide", mv.glide, mvFieldText("mv_glide", mv), hoverIs("mv_glide"), false, dim);
    }
    if (ML.atk) mvBar(ML.atk, "Attack", mvFieldNorm("mv_atk", mv), mvFieldText("mv_atk", mv), hoverIs("mv_atk"), false, dim);
    if (ML.rel) mvBar(ML.rel, "Release", mvFieldNorm("mv_rel", mv), mvFieldText("mv_rel", mv), hoverIs("mv_rel"), false, dim);
    mvBar(ML.depth, "Depth", mvFieldNorm("mv_depth", mv), mvFieldText("mv_depth", mv), hoverIs("mv_depth"), true, dim);
    if (ML.phase) mvBar(ML.phase, "Phase", mvFieldNorm("mv_phase", mv), mvFieldText("mv_phase", mv), hoverIs("mv_phase"), false, dim);
    // the display under the controls
    var A = ML.area;
    var live = moveLive(info.inst);
    rrect(A.x, A.y, A.w, A.h, 3, COL_BG, 1);
    rsrect(A.x + 0.5, A.y + 0.5, A.w - 1, A.h - 1, 3, COL_LINE, 1, 1);
    var cy = A.y + A.h / 2, hh = A.h / 2 - 3, k;
    hline(A.x + 2, A.x + A.w - 2, cy, COL_LINE, 0.8, 1);
    var sgNow = live && Math.abs(mv.depth) > 0.002 ? clamp(live.ofs / mv.depth, -1, 1) : 0;
    if (ty === 1) {
        var pts = [], ncyc = mv.shape >= 5 ? 2 : 1, np2 = 64;
        for (k = 0; k <= np2; k++) pts.push([A.x + 3 + (A.w - 6) * k / np2, cy - glMoveLfo(mv.shape, ncyc * k / np2, chainPosOf(info.inst) * 7.31) * hh]);
        poly(pts, COL_MV, 0.9, 1.3);
        if (live) {
            var px = A.x + 3 + (A.w - 6) * (live.ph / ncyc);
            vline(px, A.y + 2, A.y + A.h - 2, COL_TEXT, 0.35, 1);
            disc(px, cy - sgNow * hh, 2.6, COL_TEXT, 1);
        }
    } else if (ty === 2) {
        var ns = mv.nsteps, sw = (A.w - 6) / ns;
        var cur = live ? Math.floor(live.ph * ns) : -1;
        for (k = 0; k < ns; k++) {
            var sv = mv.steps[k];
            var bh = Math.abs(sv) * hh;
            frect(A.x + 3 + k * sw + 0.5, sv >= 0 ? cy - bh : cy, Math.max(sw - 1, 1), Math.max(bh, 1), COL_MV, k === cur ? 1 : 0.55);
        }
    } else {
        var lvl = live ? live.ph : 0;
        frect(A.x + 3, A.y + A.h - 9, (A.w - 6) * lvl, 5, COL_MV, 0.85);
        rsrect(A.x + 3.5, A.y + A.h - 8.5, A.w - 7, 4, 1, COL_LINE, 1, 1);
        label("input level  " + (live ? "" : "(no DSP)"), A.x + 5, A.y + 11, 7, COL_DIM, 1, 0);
    }
    if (live) label((live.ofs >= 0 ? "+" : "") + Math.round(live.ofs * 100) + "%", A.x + A.w - 4, A.y + 10, 7, COL_MV, 1, 2);
}
function paintEditor(ed) {
    rrect(ed.x, ed.y, ed.w, ed.h, 5, COL_PANEL, 1);
    var key = editorTarget();
    var morph = gState.audition !== "working"; // Morph or Seq: values are the sounding blend; an edit copies it to Working
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
    paintEditorTabs(E, key);
    var g = gState.working;
    var dim = morph ? 0.7 : 1;
    if (gState.ui.edTab) {
        paintMotion(ed, key, info, c, morph);
        if (morph) label(gState.audition === "seq" ? "SEQ is playing: an edit copies it to WORKING" : "MORPH is playing: an edit copies it to WORKING", ed.x + ed.w / 2, ed.y + ed.h - 5, 6.5, COL_AMBER, 0.95, 1);
        else label(locked ? "locked: kept by Randomize / Mutate" : "drag = set  ·  dbl-click = reset", ed.x + ed.w / 2, ed.y + ed.h - 5, 7, COL_DIM, 0.9, 1);
        return;
    }
    var mv = editorMove(key);
    var mvLive = mv ? moveLive(info.inst) : null;
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var r = E.rows[i];
        var spec = row.spec;
        var v = editorValue(key, row.id);
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
        var isTarget = !!mv && row.id === mv.target;
        if (spec.kind !== "disc") {
            var n = glParamToNorm(spec, v);
            if (row.id === "wet" || spec.kind === "wet") n = clamp(v, 0, 1);
            frect(r.x + 1, r.y + 1, (r.w - 2) * n, r.h - 2, c, 0.4 * dim);
            if (isTarget) {
                // the movement's target: the live modulated position as a band from the set value plus a moving marker
                if (mvLive) {
                    var x0 = r.x + 1 + (r.w - 2) * Math.min(n, mvLive.pos), bw = Math.abs(mvLive.pos - n) * (r.w - 2);
                    frect(x0, r.y + 1, Math.max(bw, 0.5), r.h - 2, COL_MV, 0.5);
                    vline(r.x + 1 + (r.w - 2) * mvLive.pos, r.y, r.y + r.h, COL_MV, 1, 2);
                } else rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 3, COL_MV, 0.55, 1);
            }
        } else rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 3, c, 0.35 * dim, 1);
        label(fit(row.name, r.w * 0.55, 7), r.x + 4, r.y + 9, 7, COL_TEXT, dim, 0);
        label(fit(glitchFormatValue(spec, v), r.w * 0.45, 7), r.x + r.w - 4, r.y + 9, 7, isTarget ? COL_MV : c, dim, 2);
    }
    if (morph) label(gState.audition === "seq" ? "SEQ is playing: an edit copies it to WORKING" : "MORPH is playing: an edit copies it to WORKING", ed.x + ed.w / 2, ed.y + ed.h - 5, 6.5, COL_AMBER, 0.95, 1);
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

// ----- sequencer -----
function seqBar(r, name, norm, text, hot) {
    rrect(r.x, r.y, r.w, r.h, 3, COL_ROW, 1);
    if (norm > 0.003) rrect(r.x + 1, r.y + 1, Math.max(2, (r.w - 2) * clamp(norm, 0, 1)), r.h - 2, 2, SEQ_COL, 0.38);
    rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 3, SEQ_COL, hot ? 0.9 : 0.35, 1);
    label(name, r.x + 5, r.y + 9, 6.5, COL_DIM, 1, 0);
    label(text, r.x + r.w - 5, r.y + 9, 7, COL_TEXT, 1, 2);
}
function seqPlayhead(t) { // { on, play, step, frac, slot, prev, glide } from the telemetry (or the preview demo)
    if (!t || !(t[GL_SCOPE.SEQ_ON] > 0.5)) return null;
    return { play: t[GL_SCOPE.SEQ_PLAY] > 0.5, step: Math.floor(t[GL_SCOPE.SEQ_STEP]), frac: clamp(t[GL_SCOPE.SEQ_FRAC] || 0, 0, 1), slot: t[GL_SCOPE.SEQ_SLOT], prev: t[GL_SCOPE.SEQ_PREV], glide: t[GL_SCOPE.SEQ_GLIDE] };
}
function paintSeq(S) {
    var P = S.rect;
    var q = normalizeSeq(gState.seq);
    var len = q.length;
    var seqOn = gState.audition === "seq";
    rrect(P.x, P.y, P.w, P.h, 5, COL_PANEL, 1);
    label("SEQUENCER", P.x + 8, P.y + 15, 8.5, seqOn ? SEQ_COL : COL_DIM, 1, 0);
    var on = S.on;
    rrect(on.x, on.y, on.w, on.h, 7, seqOn ? SEQ_COL : COL_ROW, 1);
    rsrect(on.x + 0.5, on.y + 0.5, on.w - 1, on.h - 1, 7, SEQ_COL, seqOn ? 1 : (hoverIs("seq_on") ? 0.9 : 0.55), 1);
    label(seqOn ? "SEQ ON" : "PLAY", on.x + on.w / 2, on.y + 10, 6.5, seqOn ? COL_BG : COL_TEXT, 1, 1);
    // length lane: a flag at the end of the active steps (drag it)
    var ln = S.lane;
    rrect(ln.x, ln.y, ln.w, ln.h, 3, COL_ROW, hoverIs("seq_lane") ? 1 : 0.8);
    var ex = S.x0 + len * S.pitch - 0.5;
    frect(S.x0, ln.y + 8, len * S.pitch - 0.5, 2.5, SEQ_COL, 0.85);
    mgraphics.set_line_width(1); rgba(SEQ_COL, 1);
    mgraphics.move_to(ex, ln.y + 1.5); mgraphics.line_to(ex, ln.y + 11); mgraphics.stroke();
    rgba(SEQ_COL, 1); mgraphics.move_to(ex, ln.y + 1.5); mgraphics.line_to(ex - 5, ln.y + 4.5); mgraphics.line_to(ex, ln.y + 7.5); mgraphics.close_path(); mgraphics.fill();
    label("LEN " + len, Math.min(ex + 3, P.x + P.w - 30), ln.y + 7.5, 6, COL_DIM, 1, 0);
    for (var b = 0; b < GL_SEQ_MAX; b += 4) if (b >= len) vline(S.x0 + b * S.pitch, ln.y + 8, ln.y + 11, COL_LINE, 0.8, 1);
    // steps
    var ph = seqPlayhead(T());
    for (var i = 0; i < GL_SEQ_MAX; i++) {
        var r = S.steps[i];
        var slot = q.steps[i];
        var inLen = i < len;
        var eff = seqSlotAt(q.steps, i, len);
        var a = inLen ? 1 : 0.28;
        if (slot >= 0) {
            rrect(r.x, r.y, r.w, r.h, 3, SLOT_COL[slot], 0.92 * a);
            label(slot + 1, r.x + r.w / 2, r.y + r.h / 2 + 3, 8, COL_BG, a, 1);
        } else {
            rrect(r.x, r.y, r.w, r.h, 3, COL_ROW, a);
            if (inLen) {
                // hold: a tie arrow in the colour of the slot it keeps playing
                var hc = eff >= 0 ? SLOT_COL[eff] : COL_DIM;
                var my = r.y + r.h / 2;
                rgba(hc, eff >= 0 ? 0.9 : 0.4); mgraphics.set_line_width(1.5);
                mgraphics.move_to(r.x + 1.5, my); mgraphics.line_to(r.x + r.w - 2, my);
                mgraphics.move_to(r.x + r.w - 5, my - 3); mgraphics.line_to(r.x + r.w - 1.5, my); mgraphics.line_to(r.x + r.w - 5, my + 3);
                mgraphics.stroke();
            }
        }
        if (inLen && i % 4 === 0) frect(r.x, r.y - 2, 1.5, 1.5, COL_TEXT, 0.5);
        rsrect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 3, gSeqArm === i ? COL_TEXT : SEQ_COL, gSeqArm === i ? 1 : (hoverIs("seq_step" + i) ? 0.8 : (slot >= 0 ? 0 : 0.25)), gSeqArm === i ? 1.8 : 1);
    }
    // glide lane: the crossfade between steps (stacked slot colours; the glide % is the share of the step the fade takes)
    var gl = S.glide;
    rrect(gl.x, gl.y, gl.w, gl.h, 3, COL_BG, 1);
    var lin = q.curve > 0.5;
    for (var k = 0; k < len; k++) {
        var cur = seqSlotAt(q.steps, k, len), prv = seqSlotAt(q.steps, k - 1, len);
        if (cur < 0) continue;
        var x0 = S.x0 + k * S.pitch;
        var colW = 2.5;
        for (var xs = 0; xs < S.pitch - 0.01; xs += colW) {
            var cw = Math.min(colW, S.pitch - xs);
            var pp = q.glide > 0.001 ? clamp((xs + cw / 2) / (q.glide * S.pitch), 0, 1) : 1;
            var wc = lin ? pp : Math.sin(pp * 1.5708), wp = lin ? 1 - pp : Math.cos(pp * 1.5708);
            var usePrev = prv >= 0 && prv !== cur && wp > 0.0001;
            var share = usePrev ? wc / (wc + wp) : 1;
            var hh = gl.h - 4;
            frect(x0 + xs, gl.y + 2 + hh * (1 - share), cw, hh * share, SLOT_COL[cur], 0.85);
            if (usePrev) frect(x0 + xs, gl.y + 2, cw, hh * (1 - share), SLOT_COL[prv], 0.85);
        }
    }
    for (var gb = 4; gb < len; gb += 4) vline(S.x0 + gb * S.pitch, gl.y + 1, gl.y + gl.h - 1, COL_BG, 0.7, 1);
    if (ph && ph.step < len && ph.step >= 0) {
        var phx = S.x0 + (ph.step + ph.frac) * S.pitch;
        vline(phx, S.lane.y + 9, gl.y + gl.h, COL_TEXT, ph.play ? 1 : 0.45, 1.6);
        rsrect(S.steps[ph.step].x - 0.5, S.steps[ph.step].y - 0.5, S.steps[ph.step].w + 1, S.steps[ph.step].h + 1, 3, COL_TEXT, ph.play ? 0.9 : 0.4, 1.4);
    }
    if (!filledSlots(gState).length) label("save glitches into slots, then fill the steps", gl.x + gl.w / 2, gl.y + gl.h / 2 + 3, 7, COL_DIM, 1, 1);
    // palette: click a step, then a slot here (or drag a slot onto a step)
    for (var s = 0; s < GL_NSLOT; s++) {
        var pr = S.palette[s];
        var filled = !!gState.slots[s];
        rrect(pr.x, pr.y, pr.w, pr.h, 3, filled ? SLOT_COL[s] : COL_ROW, filled ? (hoverIs("seq_pal" + s) ? 1 : 0.85) : 1);
        if (!filled) rsrect(pr.x + 0.5, pr.y + 0.5, pr.w - 1, pr.h - 1, 3, SLOT_COL[s], hoverIs("seq_pal" + s) ? 0.8 : 0.3, 1);
        label(s + 1, pr.x + pr.w / 2, pr.y + 10, 8, filled ? COL_BG : SLOT_COL[s], filled ? 1 : 0.6, 1);
    }
    var hr = S.palette[GL_NSLOT];
    rrect(hr.x, hr.y, hr.w, hr.h, 3, COL_ROW, 1);
    rsrect(hr.x + 0.5, hr.y + 0.5, hr.w - 1, hr.h - 1, 3, COL_TEXT, hoverIs("seq_pal8") ? 0.8 : 0.3, 1);
    rgba(COL_TEXT, 0.85); mgraphics.set_line_width(1.5);
    mgraphics.move_to(hr.x + 5, hr.y + 7); mgraphics.line_to(hr.x + hr.w - 5, hr.y + 7);
    mgraphics.move_to(hr.x + hr.w - 8, hr.y + 4); mgraphics.line_to(hr.x + hr.w - 5, hr.y + 7); mgraphics.line_to(hr.x + hr.w - 8, hr.y + 10);
    mgraphics.stroke();
    // controls
    seqBar(S.rate, "RATE", q.rate / (GL_SEQ_RATES.length - 1), GL_SEQ_RATE_NAMES[q.rate], hoverIs("seq_rate"));
    seqBar(S.glideBar, "GLIDE", q.glide, Math.round(q.glide * 100) + "%", hoverIs("seq_glide"));
    seqBar(S.len, "LENGTH", (len - 1) / (GL_SEQ_MAX - 1), "" + len, hoverIs("seq_len"));
    var cv = S.curve;
    rrect(cv.x, cv.y, cv.w, cv.h, 3, COL_ROW, 1);
    rrect(cv.x + 1 + (lin ? (cv.w - 2) / 2 : 0), cv.y + 1, (cv.w - 2) / 2, cv.h - 2, 2, SEQ_COL, 0.9);
    rsrect(cv.x + 0.5, cv.y + 0.5, cv.w - 1, cv.h - 1, 3, SEQ_COL, hoverIs("seq_curve") ? 0.95 : 0.4, 1);
    label("EQ POWER", cv.x + cv.w / 4, cv.y + 9, 6.5, lin ? COL_DIM : COL_BG, 1, 1);
    label("LINEAR", cv.x + cv.w * 3 / 4, cv.y + 9, 6.5, lin ? COL_BG : COL_DIM, 1, 1);
    var d = S.dice;
    rrect(d.x, d.y, d.w, d.h, 5, mix3(COL_CORAL, [1, 1, 1], 0.4 * gFlash.dice), hoverIs("seq_dice") ? 1 : 0.92);
    paintDice(d.x + 5, d.y + 2, 12, COL_BG);
    label("RANDOMIZE SEQUENCE", d.x + 22, d.y + d.h / 2 + 3, 7, COL_BG, 1, 0);
    var cl = S.clear;
    rrect(cl.x, cl.y, cl.w, cl.h, 5, COL_ROW, 1);
    rsrect(cl.x + 0.5, cl.y + 0.5, cl.w - 1, cl.h - 1, 5, COL_AMBER, hoverIs("seq_clear") ? 1 : 0.6, 1);
    label("CLEAR", cl.x + cl.w / 2, cl.y + cl.h / 2 + 3, 7, COL_TEXT, 1, 1);
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
    var map = glitchHitMap(ui, gTiles.length, ui.editor ? currentRows().length : 0, gTilePage, ui.editor && ui.edTab ? editorMoveType() : 0);
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
function barNorm(r, x) { return clamp((x - r.x - 2) / (r.w - 4), 0, 1); }
// ----- Motion panel editing (all on the Working glitch; the caller pushed the undo snapshot and called beginWorkingEdit) -----
function mvSetFromBar(id, x) {
    var key = editorTarget();
    var g = gState.working;
    var mv = key ? glitchGetMove(g, key) : null;
    if (!mv) return;
    var ML = glitchMotionLayout(gLayout.editor, mv.type);
    var r = ML[id.substring(3)];
    if (!r) return;
    var n = barNorm(r, x);
    if (id === "mv_rate") {
        if (mv.sync) glitchSetMove(g, key, "div", Math.round(n * (GL_MV_DIV_BEATS.length - 1)));
        else glitchSetMove(g, key, "hz", mvLogVal(n, 0.02, 20));
    } else if (id === "mv_depth") glitchSetMove(g, key, "depth", Math.abs(n * 2 - 1) < 0.04 ? 0 : n * 2 - 1);
    else if (id === "mv_phase") glitchSetMove(g, key, "phase", Math.round(n * 100) / 100);
    else if (id === "mv_glide") glitchSetMove(g, key, "glide", Math.round(n * 100) / 100);
    else if (id === "mv_atk") glitchSetMove(g, key, "atk", mvLogVal(n, 1, 500));
    else if (id === "mv_rel") glitchSetMove(g, key, "rel", mvLogVal(n, 5, 2000));
    modelChanged();
}
function mvSetStep(x, y) {
    var key = editorTarget();
    var mv = key ? glitchGetMove(gState.working, key) : null;
    if (!mv) return;
    var A = glitchMotionLayout(gLayout.editor, mv.type).area;
    if (!A) return;
    var ns = mv.nsteps;
    var i = clamp(Math.floor((x - A.x - 3) / ((A.w - 6) / ns)), 0, ns - 1);
    var v = 1 - 2 * clamp((y - A.y - 2) / (A.h - 4), 0, 1);
    if (Math.abs(v) < 0.1) v = 0;
    glitchSetMoveStep(gState.working, key, i, Math.round(v * 100) / 100);
    modelChanged();
}
function mvClick(id, x, y, shift) {
    var key = editorTarget();
    if (!key || !glitchMoveCandidates(key).length) return; // nothing to move on this tile (Freeze, Scramble)
    undoPush();
    beginWorkingEdit();
    var g = gState.working;
    var m;
    gDrag = { kind: "mvdone" };
    if ((m = /^mv_type(\d)$/.exec(id))) { glitchSetMoveType(g, key, Number(m[1])); modelChanged(); return; }
    var mv = glitchGetMove(g, key);
    if (!mv) return;
    if (id === "mv_target") {
        var cands = glitchMoveCandidates(key);
        var at = 0;
        for (var i = 0; i < cands.length; i++) if (cands[i].id === mv.target) at = i;
        glitchSetMove(g, key, "target", cands[(at + (shift ? cands.length - 1 : 1)) % cands.length].id);
        modelChanged();
    } else if (id === "mv_sync") { glitchSetMove(g, key, "sync", mv.sync ? 0 : 1); modelChanged(); }
    else if (id === "mv_nsteps") { glitchSetMove(g, key, "nsteps", mv.nsteps === 8 ? 16 : 8); modelChanged(); }
    else if ((m = /^mv_shape(\d)$/.exec(id))) { glitchSetMove(g, key, "shape", Number(m[1])); modelChanged(); }
    else if (id === "mv_steps" || id === "mv_area") { if (mv.type === 2) { gDrag = { kind: "mvsteps" }; mvSetStep(x, y); } }
    else { gDrag = { kind: "mvbar", id: id }; mvSetFromBar(id, x); }
}
function seqLenFromX(x) { var S = gLayout.seq; if (S) seqLengthSet(clamp(Math.floor((x - S.x0) / S.pitch) + 1, 1, GL_SEQ_MAX)); }
function seqDrag(kind, x) {
    var S = gLayout.seq;
    if (!S) return;
    if (kind === "seqlane") seqLenFromX(x);
    else if (kind === "seqlen") seqLengthSet(1 + Math.round(barNorm(S.len, x) * (GL_SEQ_MAX - 1)));
    else if (kind === "seqrate") seqRateSet(Math.round(barNorm(S.rate, x) * (GL_SEQ_RATES.length - 1)));
    else if (kind === "seqglide") seqGlideSet(barNorm(S.glideBar, x));
}
function dropStep(x, y) {
    var S = gLayout.seq;
    if (!S) return -1;
    for (var i = 0; i < GL_SEQ_MAX; i++) if (glHit(S.steps[i], x, y)) return i;
    return -1;
}
// assign `slot` (-1 = hold) to the armed step and move the arm to the next step (fast step entry: click a step, then slots)
function assignToArmed(slot) {
    if (gSeqArm < 0) { gHint = "click a step first, then a slot"; mgraphics.redraw(); return; }
    if (slot >= 0 && !gState.slots[slot]) { gHint = "slot " + (slot + 1) + " is empty: save a glitch into it first"; mgraphics.redraw(); return; }
    seqAssign(gSeqArm, slot);
    gHint = "step " + (gSeqArm + 1) + " = " + (slot >= 0 ? "slot " + (slot + 1) : "hold");
    if (gSeqArm + 1 < GL_SEQ_MAX) gSeqArm++;
    mgraphics.redraw();
}
function onclick(x, y, but, cmd, shift, caps, opt) {
    gFocus = true;
    var h = hitAt(x, y);
    if (!h) { gDrag = null; if (gSeqArm >= 0) { gSeqArm = -1; mgraphics.redraw(); } return; }
    var id = h.id;
    var m;
    if (!/^(seq_step|seq_pal|slot\d)/.test(id)) gSeqArm = -1;
    if (id === "tg_editor") { toggleSection("editor"); return; }
    if (id === "tg_slots") { toggleSection("slots"); return; }
    if (id === "tg_seq") { toggleSection("seq"); return; }
    if (id === "opt_close") { setOptions(0); return; }
    if (id === "opt_all") {
        undoPush();
        var any = false;
        for (var t in gState.allow) if (!gState.allow[t]) any = true;
        setAllowAll(gState, any);
        mgraphics.redraw(); done();
        return;
    }
    if (id === "opt_prev" || id === "opt_next") {
        var npg = glitchOptionPage(gState.ui.optCat, gState.ui.optPage).pages;
        gState.ui.optPage = Math.max(0, Math.min(npg - 1, gState.ui.optPage + (id === "opt_next" ? 1 : -1)));
        gLayout = glitchFaceLayout(gState.ui); mgraphics.redraw(); done(); return;
    }
    if ((m = /^optcat_sel(\d)$/.exec(id))) { gState.ui.optCat = Number(m[1]); gState.ui.optPage = 0; gLayout = glitchFaceLayout(gState.ui); mgraphics.redraw(); done(); return; }
    if ((m = /^optcat_tg(\d)$/.exec(id))) {
        undoPush();
        var cat = Number(m[1]);
        setAllowCategory(gState, cat, glitchCategoryState(gState, cat) !== 1);
        mgraphics.redraw(); done();
        return;
    }
    if ((m = /^opt_(\d+)$/.exec(id))) {
        undoPush();
        var ty = GL_ALLOW_ITEMS[Number(m[1])];
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
        var ui = gState.ui;
        if (ui.editor && ui.sel === tile.key) { toggleSection("editor"); return; }
        ui.sel = tile.key;
        if (!ui.editor) { ui.editor = 1; ui.options = 0; applyLayout(); } else mgraphics.redraw();
        done();
        return;
    }
    if (id === "pg_prev" || id === "pg_next") {
        var pgs = glitchViewLayout(gTiles.length, gLayout.view, 0).pages;
        gTilePage = clamp(gTilePage + (id === "pg_next" ? 1 : -1), 0, pgs - 1);
        mgraphics.redraw();
        return;
    }
    if (id === "act_dice") { doRandomize(null); return; }
    if (id === "act_mutate") { doMutate(); return; }
    if (id === "act_opt") { setOptions(1); return; }
    if (id === "act_ab") {
        var abr = gLayout.action.ab;
        var third = clamp(Math.floor((x - abr.x - 2) / ((abr.w - 4) / 3)), 0, 2);
        setAudition(["working", "morph", "seq"][third], true);
        if (third === 2 && !filledSlots(gState).length) gHint = "SEQ plays saved slots: save glitches into slots first";
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
        if (!key) return;
        undoPush();
        beginWorkingEdit();
        if (id === "ed_lock") glitchToggleLock(gState.working, key);
        else { glitchRemoveTile(gState.working, key); gModelDirty = true; refreshModel(); gState.ui.sel = ""; selectFirstIfNone(); }
        modelChanged(); done();
        return;
    }
    if (id === "ed_tab0" || id === "ed_tab1") {
        gState.ui.edTab = id === "ed_tab1" ? 1 : 0;
        mgraphics.redraw();
        done();
        return;
    }
    if (/^mv_/.test(id)) { mvClick(id, x, y, shift); return; }
    if ((m = /^ed_row(\d+)$/.exec(id))) {
        var ri = Number(m[1]);
        var key2 = editorTarget();
        if (!key2) return;
        var row = glitchEditorRows(key2)[ri];
        if (!row) return;
        undoPush();
        beginWorkingEdit();
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
    if (id === "seq_on") { setAudition(gState.audition === "seq" ? "working" : "seq", true); if (gState.audition === "seq" && !filledSlots(gState).length) gHint = "SEQ plays saved slots: save glitches into slots first"; done(); return; }
    if (id === "seq_lane" || id === "seq_len" || id === "seq_rate" || id === "seq_glide") {
        undoPush();
        var sk = id === "seq_lane" ? "seqlane" : id.replace("seq_", "seq");
        gDrag = { kind: sk };
        seqDrag(sk, x);
        return;
    }
    if ((m = /^seq_step(\d+)$/.exec(id))) {
        var si = Number(m[1]);
        gSeqArm = si;
        gDrag = { kind: "seqdone" };
        if (!filledSlots(gState).length) { gHint = "save glitches into slots first (shift-click a slot)"; mgraphics.redraw(); return; }
        undoPush();
        if (opt) setSeqStep(gState, si, -1); else seqCycleStep(gState, si, shift ? -1 : 1);
        gHint = "step " + (si + 1) + ": click again to cycle, or click a slot";
        modelChanged(); done();
        return;
    }
    if ((m = /^seq_pal(\d)$/.exec(id))) {
        var pi = Number(m[1]);
        gDrag = { kind: "seqpal", slot: pi === GL_NSLOT ? -1 : pi, x0: x, y0: y, x: x, y: y, moved: false };
        return;
    }
    if (id === "seq_curve") { undoPush(); setSeqCurve(gState, normalizeSeq(gState.seq).curve ? 0 : 1); modelChanged(); done(); return; }
    if (id === "seq_dice") {
        gFlash.dice = 1;
        seqrandomize();
        gSeqArm = -1;
        if (!filledSlots(gState).length) gHint = "save glitches into slots first";
        return;
    }
    if (id === "seq_clear") { undoPush(); seqClear(gState); gSeqArm = -1; modelChanged(); done(); return; }
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
    else if (d.kind === "mvbar") mvSetFromBar(d.id, x);
    else if (d.kind === "mvsteps") mvSetStep(x, y);
    else if (d.kind === "seqlane" || d.kind === "seqlen" || d.kind === "seqrate" || d.kind === "seqglide") seqDrag(d.kind, x);
    else if (d.kind === "seqpal") {
        d.x = x; d.y = y;
        if (!d.moved && Math.abs(x - d.x0) + Math.abs(y - d.y0) > 5) d.moved = true;
        if (d.moved) mgraphics.redraw();
    } else if (d.kind === "slot") {
        d.x = x; d.y = y;
        if (!d.moved && Math.abs(x - d.x0) + Math.abs(y - d.y0) > 5) d.moved = true;
        if (d.moved) mgraphics.redraw();
    }
}
function endDrag(x, y) {
    var d = gDrag;
    gDrag = null;
    if (!d) return;
    if (d.kind === "seqpal") {
        if (d.moved) {
            var ds = dropStep(x, y);
            if (ds >= 0 && (d.slot < 0 || gState.slots[d.slot])) { gSeqArm = ds; assignToArmed(d.slot); } else mgraphics.redraw();
        } else assignToArmed(d.slot);
        return;
    }
    if (d.kind === "slot") {
        if (d.moved) {
            var dstep = dropStep(x, y);
            if (dstep >= 0) {
                if (gState.slots[d.i]) { gSeqArm = dstep; assignToArmed(d.i); } else { gHint = "slot " + (d.i + 1) + " is empty"; mgraphics.redraw(); }
                return;
            }
            var c = dropCorner(x, y);
            if (c >= 0) { undoPush(); assignCorner(gState, c, d.i); gFlash.slot = d.i; gFlash.slotT = 1; modelChanged(); done(); }
            else mgraphics.redraw();
            return;
        }
        slotClick(d.i, d.shift, d.opt);
        return;
    }
    if (d.kind === "pad" || d.kind === "row" || d.kind === "rowdone" || d.kind === "mvdone" || d.kind === "mvbar" || d.kind === "mvsteps" || d.kind === "chaos" || /^seq(lane|len|rate|glide)$/.test(d.kind)) done();
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
    } else if (gState.ui.seq && gSeqArm >= 0) {
        assignToArmed(i);
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
    else if (id === "seq_glide") { seqGlideSet(0); done(); }
    else if (id === "seq_len") { seqLengthSet(8); done(); }
    else if (/^mv_(rate|depth|phase|glide|atk|rel)$/.test(id)) {
        var mkey = editorTarget();
        var mv0 = mkey ? editorMove(mkey) : null;
        if (mv0) {
            gDrag = null;
            undoPush();
            beginWorkingEdit();
            var df = defaultMove(glitchTileInfo(mkey).inst, mv0.target, mv0.type);
            var fld = { mv_rate: mv0.sync ? "div" : "hz", mv_depth: "depth", mv_phase: "phase", mv_glide: "glide", mv_atk: "atk", mv_rel: "rel" }[id];
            glitchSetMove(gState.working, mkey, fld, df[fld]);
            modelChanged(); done();
        }
    }
    else if ((m = /^ed_row(\d+)$/.exec(id))) {
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
        else if (id === "act_ab") hint = "what you hear: working glitch, morph or sequence";
        else if (id === "act_chaos") hint = "Chaos: how wild Randomize / Mutate go";
        else if (/^slot\d$/.test(id)) hint = "click: recall · shift: save · alt: clear · drag to a corner";
        else if (id === "ed_lock") hint = "keep this module through Randomize / Mutate";
        else if (id === "ed_remove") hint = "remove this module";
        else if (id === "ed_tab0") hint = "the module's parameters";
        else if (id === "ed_tab1") hint = "motion: an LFO, steps or envelope that moves a parameter";
        else if (/^mv_type/.test(id)) hint = "movement source: off, LFO, steps or envelope follower";
        else if (id === "mv_target") hint = "which parameter moves (click: next, shift: previous)";
        else if (id === "mv_sync") hint = "locked to the host beat, or free in Hz";
        else if (id === "mv_rate") hint = "LFO cycle / step length (dbl-click = default)";
        else if (/^mv_shape/.test(id)) hint = "LFO shape";
        else if (id === "mv_depth") hint = "how far it moves, as a share of the range (+/-)";
        else if (id === "mv_steps") hint = "drag across the steps to paint their values";
        else if (id === "mv_nsteps") hint = "8 or 16 steps";
        else if (id === "side_mix") hint = "Mix (drag, dbl-click = 100%)";
        else if (id === "side_out") hint = "Output (drag, dbl-click = 0 dB)";
        else if ((m = /^opt_(\d+)$/.exec(id))) hint = "click to allow / forbid";
        else if (/^optcat_tg/.test(id)) hint = "allow / forbid the whole category";
        else if (/^optcat_sel/.test(id)) hint = "show this category's module types";
        else if (id === "opt_prev" || id === "opt_next") hint = "more types of this category";
        else if (id === "tg_seq") hint = "the 16-step slot sequencer";
        else if (id === "seq_on") hint = "play the sequencer (Mode = Seq)";
        else if (id === "seq_lane") hint = "drag: sequence length";
        else if (/^seq_step/.test(id)) hint = "click: cycle slot / hold  ·  shift: back  ·  alt: hold  ·  then click a slot";
        else if (/^seq_pal/.test(id)) hint = gSeqArm >= 0 ? "assign to the armed step (or drag onto a step)" : "click a step first, or drag onto a step";
        else if (id === "seq_rate") hint = "step length (Seq Rate)";
        else if (id === "seq_glide") hint = "crossfade between steps (Glide, dbl-click = 0)";
        else if (id === "seq_len") hint = "number of steps (Seq Length, dbl-click = 8)";
        else if (id === "seq_curve") hint = "crossfade curve: equal power or linear";
        else if (id === "seq_dice") hint = "roll a new sequence from the filled slots";
        else if (id === "seq_clear") hint = "all steps hold (a silent sequence)";
        else if (id === "pg_prev" || id === "pg_next") hint = "more modules: next / previous page";
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
    else if (keycode === 27 && gSeqArm >= 0) { gSeqArm = -1; mgraphics.redraw(); }
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
        ready: dspReady, err: dspError, stages: stageStates(), stagesRunning: Object.keys(dspStages).filter(function (k) { return dspStages[k].running; }), counter: scopeFrameCounter(), haveTele: gHaveTele, audition: gState.audition, seq: gState.seq, xy: gState.xy, chaos: gState.chaos,
        tiles: gTiles.map(function (t) { return t.key; }), slotsFilled: gState.slots.map(function (s) { return s ? 1 : 0; }), corners: gState.corners,
        ui: gState.ui, width: gLayout.width, seed: gState.seed, allow: gState.allow, locks: gState.working.locks || {}, parts: gParamVals,
    };
    if (gScopeBuf) {
        try {
            var a = gScopeBuf.peek(1, 0, GL_SCOPE.END);
            rep.weights = a.slice(GL_SCOPE.WEIGHTS, GL_SCOPE.WEIGHTS + 8);
            rep.inPeak = a[GL_SCOPE.IN_PEAK]; rep.outPeak = a[GL_SCOPE.OUT_PEAK];
            rep.activity = a.slice(GL_SCOPE.ACTIVITY, GL_SCOPE.ACTIVITY + GL_NINST);
            rep.moveOn = a.slice(GL_SCOPE.MOVE_ON, GL_SCOPE.MOVE_ON + GL_NINST);
            rep.moveOfs = a.slice(GL_SCOPE.MOVE_OFS, GL_SCOPE.MOVE_OFS + GL_NINST);
            rep.movePos = a.slice(GL_SCOPE.MOVE_POS, GL_SCOPE.MOVE_POS + GL_NINST);
            rep.movePh = a.slice(GL_SCOPE.MOVE_PH, GL_SCOPE.MOVE_PH + GL_NINST);
            rep.seqTele = { on: a[GL_SCOPE.SEQ_ON], play: a[GL_SCOPE.SEQ_PLAY], step: a[GL_SCOPE.SEQ_STEP], slot: a[GL_SCOPE.SEQ_SLOT], prev: a[GL_SCOPE.SEQ_PREV], glide: a[GL_SCOPE.SEQ_GLIDE], frac: a[GL_SCOPE.SEQ_FRAC], count: a[GL_SCOPE.SEQ_COUNT], beat: a[GL_SCOPE.BEAT] };
        } catch (_) {}
    }
    rep.moves = gTiles.filter(function (t) { return t.mv; }).map(function (t) { return t.key; });
    rep.arm = gSeqArm; rep.page = gTilePage; rep.tileCount = gTiles.length;
    if (gSlotsBuf) { try { rep.seqHdr = gSlotsBuf.peek(1, glitchLayout().seqOffset, GL_SEQ_HDR).slice(0, 5); } catch (_) {} }
    if (typeof Global !== "undefined") new Global("glitch_test").text = JSON.stringify(rep);
    return rep;
}
// A working glitch whose only module is Width / Gain (-3 dB) with a synced sine LFO on the gain: 1/4 note cycle (one beat), depth 0.5 =
// +-9 dB around -3 dB. scripts/test_glitch_live.js uses it to check that movement is audible and locked to the host beat.
function test_move() {
    var g = defaultGlitch();
    glitchSetValue(g, "wid", "wet", 1);
    glitchSetValue(g, "wid", "gain", -3);
    glitchSetMoveType(g, "wid", 1);
    glitchSetMove(g, "wid", "target", "gain");
    glitchSetMove(g, "wid", "depth", 0.5);
    glitchSetMove(g, "wid", "div", 8);
    glitchSetMove(g, "wid", "sync", 1);
    gState.working = g;
    gState.audition = "working";
    sendParam("mode", 0);
    modelChanged();
    done();
}
// phase 4 test hook: kind "mods" = Ratchet + Scratch on, "spec" = the 11 phase 4 spectral sub-ops on at once, "p4all" = both
function test_p4(kind) {
    var g = defaultGlitch();
    kind = String(kind);
    if (kind === "mods" || kind === "p4all") {
        glitchSetValue(g, "ratc", "wet", 1); glitchSetValue(g, "ratc", "div", 5); glitchSetValue(g, "ratc", "count", 8); glitchSetValue(g, "ratc", "accel", 0.6);
        glitchSetValue(g, "scrb", "wet", 0.8); glitchSetValue(g, "scrb", "shape", 2); glitchSetValue(g, "scrb", "rate", 3); glitchSetValue(g, "scrb", "depth", 0.7);
    }
    if (kind === "spec" || kind === "p4all") {
        var keys = ["gfreeze", "stretch", "bubbler", "mp3ify", "duststorm", "thinner", "decap", "noisify", "clipper", "pswap", "rphase"];
        for (var i = 0; i < keys.length; i++) { glitchSetValue(g, keys[i], "wet", 1); glitchSetValue(g, keys[i], glitchTileInfo(keys[i]).sub, 0.55); }
    }
    gState.working = g;
    gState.audition = "working";
    sendParam("mode", 0);
    modelChanged();
    done();
}
function test_spec(kind) {
    // "quiet": the Spectral module on with a transparent Smear (identity within -76 dB, like the harness case spec_latency): the lazy spectral
    // gen~ is needed, but the sound must not change. "off": the working glitch without any spectral module.
    var g = defaultGlitch();
    if (String(kind) === "quiet") { glitchSetValue(g, "smear", "wet", 1); glitchSetValue(g, "smear", "smr_amt", 0.001); }
    else glitchSetValue(g, "filt", "wet", 0);
    gState.working = g;
    gState.audition = "working";
    sendParam("mode", 0);
    modelChanged();
    done();
}
function test_load(kind) {
    // load-time probe: the working glitch a restored device would have, then the whole stage load again (dsp_retry): "empty", "typical" (6 modules in
    // 5 groups: filter, crush, stutter, shuffle, delay, width), "spectral" (typical + a transparent smear), "all" (every module on)
    var g = defaultGlitch();
    kind = String(kind);
    if (kind === "typical" || kind === "spectral" || kind === "all") {
        var ids = ["filt", "crush", "stut", "shuf", "dly", "wid"];
        for (var i = 0; i < ids.length; i++) glitchSetValue(g, ids[i], "wet", 0.8);
    }
    if (kind === "spectral" || kind === "all") { glitchSetValue(g, "smear", "wet", 1); glitchSetValue(g, "smear", "smr_amt", 0.001); }
    if (kind === "all") for (var q = 0; q < GL_INSTANCES.length; q++) glitchSetValue(g, GL_INSTANCES[q].id, "wet", 0.5);
    gState.working = g;
    gState.audition = "working";
    sendParam("mode", 0);
    gModelDirty = true;
    done();
    dsp_retry();
}
function test_module(id, wet) {
    // the working glitch = one module at a given wet (a lazy stage is created when the module is first needed), for the Live load / swap tests
    var g = defaultGlitch();
    glitchSetValue(g, String(id), "wet", wet === undefined ? 0.3 : Number(wet));
    gState.working = g;
    gState.audition = "working";
    sendParam("mode", 0);
    modelChanged();
    done();
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
    var pv = typeof UI_PREVIEW !== "undefined" ? UI_PREVIEW : "";
    // make sure the preview shows movement: if Randomize gave none, the first two tiles that can move get one (LFO, then Steps)
    var anyMv = false;
    for (var mi = 0; mi < gTiles.length; mi++) if (gTiles[mi].mv) anyMv = true;
    if (!anyMv) {
        var want = [1, 2];
        for (var mj = 0; mj < gTiles.length && want.length; mj++) {
            if (glitchMainParam(gTiles[mj].key) && glitchSetMoveType(gState.working, gTiles[mj].key, want[0])) want.shift();
        }
        gState.slots[0] = glCopy(gState.working);
        gModelDirty = true;
        refreshModel();
    }
    if (pv === "motion") {
        gState.ui.editor = 1;
        gState.ui.edTab = 1;
        var mvKey = "";
        for (var mk2 = 0; mk2 < gTiles.length; mk2++) if (gTiles[mk2].mv && !mvKey) mvKey = gTiles[mk2].key;
        gState.ui.sel = mvKey || (gTiles.length ? gTiles[0].key : "");
        if (!glitchGetMove(gState.working, gState.ui.sel)) glitchSetMoveType(gState.working, gState.ui.sel, 2);
        gModelDirty = true;
        refreshModel();
    } else if (pv === "editor") {
        gState.ui.editor = 1;
        gState.ui.sel = gTiles.length ? gTiles[Math.min(1, gTiles.length - 1)].key : "";
        glitchToggleLock(gState.working, gState.ui.sel);
    } else if (pv === "seq") {
        // sequencer open, all 8 slots filled, the sequence playing (demo telemetry: step 5, 40 % into it)
        for (var s2 = 5; s2 < 8; s2++) { gState.slots[s2] = randomizeGlitch(40 + s2 * 5, gState.chaos, gState.allow); gState.slots[s2].name = "Glitch " + (s2 + 1); }
        gState.ui.seq = 1;
        gState.audition = "seq";
        gState.seq = normalizeSeq({ steps: [0, -1, 1, -1, 2, 2, -1, 3, 0, -1, 1, 4, 5, 6, 7, -1], length: 12, rate: 4, glide: 0.4, curve: 0 });
        gSeqArm = 8;
        gDemoBeat = 5.4 * GL_SEQ_RATES[4];
    } else if (pv === "options") {
        gState.ui.options = 1;
        gState.ui.optCat = 4;
        gState.allow.mirror = false;
        gState.allow.rectify = false;
    } else if (pv === "new" || pv === "specedit") {
        // the phase 4 modules and sub-ops: "new" = a page of 12 of their tiles, "specedit" = the editor of Duststorm
        var nw = defaultGlitch();
        var newKeys = ["ratc", "scrb", "mp3ify", "duststorm", "thinner", "decap", "noisify", "clipper", "stretch", "gfreeze", "bubbler", "rphase"];
        for (var nk = 0; nk < newKeys.length; nk++) {
            var ninfo = glitchTileInfo(newKeys[nk]);
            glitchSetValue(nw, newKeys[nk], "wet", 0.6 + 0.04 * nk);
            if (ninfo.sub) glitchSetValue(nw, newKeys[nk], ninfo.sub, 0.7 + 0.025 * nk);
        }
        glitchSetValue(nw, "rphase", "rph_mode", 1);
        glitchSetValue(nw, "mp3ify", "mp3_kbps", 48);
        glitchSetMoveType(nw, "scrb", 1);
        glitchSetMoveType(nw, "mp3ify", 2);
        gState.working = nw;
        gState.slots[0] = glCopy(nw);
        gModelDirty = true;
        gLayout = glitchFaceLayout(gState.ui);
        refreshModel();
        if (pv === "specedit") { gState.ui.editor = 1; gState.ui.sel = "duststorm"; }
        else gState.ui.sel = "mp3ify";
    } else if (pv === "options2") {
        gState.ui.options = 1;
        gState.ui.optCat = 4;
        gState.ui.optPage = 1;
        gState.allow.noisify = false;
        gState.allow.thinner = false;
    } else if (pv === "many" || pv === "many2") {
        // every module on: 24 instances + 19 spectral sub-ops = 43 tiles: "many" = page 1 of the glitch view, "many2" = page 2
        var big = defaultGlitch();
        for (var ii = 0; ii < GL_INSTANCES.length; ii++) glitchSetValue(big, GL_INSTANCES[ii].id, "wet", 0.4 + 0.5 * ((ii * 7) % 10) / 10);
        for (var tt = 0; tt < GL_TYPES.length; tt++) if (GL_TYPES[tt].amountKey) glitchSetValue(big, GL_TYPES[tt].id, GL_TYPES[tt].amountKey, 0.5 + 0.05 * tt);
        for (var mm = 0; mm < GL_INSTANCES.length; mm += 3) if (glitchMainParam(GL_INSTANCES[mm].id)) glitchSetMoveType(big, GL_INSTANCES[mm].id, 1 + (mm / 3) % 3); // every third module moves
        gState.working = big;
        gState.slots[0] = glCopy(big);
        gModelDirty = true;
        gLayout = glitchFaceLayout(gState.ui);
        refreshModel();
        gTilePage = pv === "many2" ? 1 : 0;
        gState.ui.sel = "form";
        glitchToggleLock(gState.working, "comb");
    }
    gLayout = glitchFaceLayout(gState.ui);
    demoCache = null;
}
