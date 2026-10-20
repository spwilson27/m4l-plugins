// Better Sampler — Interactive v8ui Waveform, Loop/Slice, Envelope & Modulation Display.
//
// Inlets:  0 = control & MIDI messages
// Outlets: 0 = patcher / gen / parameter sync messages:
//              - ["param", <key>, <val>]
//              - ["root_note", <midi>]
//              - ["load_sample", <filepath>]
//              - ["patcher_cmd", ...]
//              - ["setwidth_cmd", <width>]

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var sampBufName = "";
var voicesBufName = "";
var scopeBufName = "";

var WAVE_BINS = 160;
var wavePeaksL = new Array(WAVE_BINS);
var wavePeaksR = new Array(WAVE_BINS);
for (var bi = 0; bi < WAVE_BINS; bi++) {
    wavePeaksL[bi] = 0.0;
    wavePeaksR[bi] = 0.0;
}

var hasLoadedSample = 0;
var sampleFilePath = "";
var restorePath = "";          // path restored from a saved Set/preset, re-sent once buffers are bound
var restoredSlices = null;     // saved slice markers that must survive the first post-restore waveform refresh
var sampleFileName = "Drop Audio Sample Here";
var sampleFrames = 0;
var sampleDurationMs = 0;
var detectedRootMidi = 60;

// Playback & Editor state
var curMode = 0;          // 0=Repitch, 1=Cycles, 2=Textures, 3=Slice
var curFreeze = 0;        // 0=Off, 1=Freeze
var curReverse = 0;       // 0=Fwd, 1=Rev
var curLoopMode = 1;      // 0=Off, 1=Forward, 2=Ping-Pong
var curStart = 0.0;       // 0..1
var curEnd = 1.0;         // 0..1
var curLoopStart = 0.15;  // 0..1
var curLoopEnd = 0.85;    // 0..1
var curXfade = 0.05;      // 0..0.45
var curPlayPos = 0.0;     // 0..1

// Granular / Cycles / Pitch state
var curPitchSt = 0.0;
var curFineCents = 0.0;
var curRootNote = 60;
var curGrainSize = 65.0;
var curGrainMotion = 100.0;
var curGrainSpray = 15.0;
var curFormant = 0.0;

// Voicing / Unison state
var curPolyVoices = 8;
var curMonoLegato = 0;
var curGlideMs = 0.0;
var curUnisonVoices = 1;
var curUnisonDetune = 15.0;
var curUnisonWidth = 65.0;

// Envelopes & Filter state
var curAtkMs = 2.5;
var curDecMs = 250.0;
var curSusPct = 85.0;
var curRelMs = 140.0;
var curMAtkMs = 5.0;
var curMDecMs = 320.0;
var curMSusPct = 25.0;
var curMRelMs = 220.0;

var curFiltOn = 1;
var curFiltType = 0;
var curFiltCutoff = 18000.0;
var curFiltRes = 15.0;
var curFiltDrive = 0.0;
var curFiltEnvAmt = 0.0;

// LFO state
var curLfoRate = 2.0;
var curLfoShape = 0;
var curLfoPitch = 0.0;
var curLfoFilt = 0.0;
var curLfoPos = 0.0;

// Slice markers (normalized 0..1)
var sliceMarkers = [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
var sliceSensitivity = 0.65;
var selectedSliceIdx = 0;

// Bottom sub-tab inside v8ui: 0=LOOP/GRAIN, 1=AMP ENV, 2=FILT/MOD, 3=SLICES
var bottomTab = 0;

// Dynamic multi-panel expand/collapse state
var uiVariant = (typeof DEFAULT_UI_VARIANT !== "undefined") ? DEFAULT_UI_VARIANT : "standard";
var showFiltAmpPanel = 1;
var showModUniPanel = 1;

// Live telemetry from #0-bsscope
var voicePlayheads = new Array(16);
var voiceAmps = new Array(16);
for (var vi = 0; vi < 16; vi++) {
    voicePlayheads[vi] = 0.0;
    voiceAmps[vi] = 0.0;
}
var livePeakL = 0.0;
var livePeakR = 0.0;
var liveActiveVoices = 0;
var liveLfoVal = 0.0;
var liveModEnvVal = 0.0;
var liveEffCutHz = 18000.0;

// Voice allocator instance
var voiceAlloc = createVoiceAllocator(16);

// Undo / Redo stacks (rule #7)
var undoStack = [];
var redoStack = [];
var MAX_UNDO = 24;

function captureStateSnapshot() {
    return {
        curMode: curMode,
        curStart: curStart,
        curEnd: curEnd,
        curLoopMode: curLoopMode,
        curLoopStart: curLoopStart,
        curLoopEnd: curLoopEnd,
        curXfade: curXfade,
        curPlayPos: curPlayPos,
        sliceMarkers: sliceMarkers.slice()
    };
}

function applyStateSnapshot(snap) {
    if (!snap) return;
    curMode = snap.curMode;
    curStart = snap.curStart;
    curEnd = snap.curEnd;
    curLoopMode = snap.curLoopMode;
    curLoopStart = snap.curLoopStart;
    curLoopEnd = snap.curLoopEnd;
    curXfade = snap.curXfade;
    curPlayPos = snap.curPlayPos;
    if (snap.sliceMarkers && snap.sliceMarkers.length) {
        sliceMarkers = snap.sliceMarkers.slice();
    }
    emitRegionParams();
    notifyclients();
    mgraphics.redraw();
}

function pushUndoState() {
    undoStack.push(captureStateSnapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
}

function performUndo() {
    if (undoStack.length === 0) return;
    redoStack.push(captureStateSnapshot());
    applyStateSnapshot(undoStack.pop());
}

function performRedo() {
    if (redoStack.length === 0) return;
    undoStack.push(captureStateSnapshot());
    applyStateSnapshot(redoStack.pop());
}

function writeVoiceToBuffer(v) {
    if (!voicesBufName || typeof Buffer === "undefined") return;
    try {
        var b = new Buffer(voicesBufName);
        var base = v.index * 8;
        b.poke(1, base + 0, [
            v.gate,
            v.note,
            v.vel,
            v.trigCount,
            v.sliceStart,
            v.sliceEnd,
            v.panSeed,
            v.rndSeed
        ]);
    } catch (_) {}
}

function syncAllVoicesToBuffer() {
    if (!voicesBufName || typeof Buffer === "undefined") return;
    try {
        var b = new Buffer(voicesBufName);
        var flat = [];
        for (var i = 0; i < 16; i++) {
            var v = voiceAlloc.voices[i];
            flat.push(
                v.gate,
                v.note,
                v.vel,
                v.trigCount,
                v.sliceStart,
                v.sliceEnd,
                v.panSeed,
                v.rndSeed
            );
        }
        b.poke(1, 0, flat);
    } catch (_) {}
}

function refreshWaveformFromBuffer() {
    if (!sampBufName || typeof Buffer === "undefined") return;
    try {
        var b = new Buffer(sampBufName);
        var frames = (typeof b.framecount === "function") ? b.framecount() : 0;
        if (!frames || frames <= 4) {
            return;
        }
        sampleFrames = frames;
        sampleDurationMs = Math.round((frames / 44.1));
        var step = Math.max(1, Math.floor(frames / WAVE_BINS));
        var maxEnergy = 0.0;

        for (var i = 0; i < WAVE_BINS; i++) {
            var startIdx = Math.min(frames - 1, i * step);
            var readLen = Math.min(64, frames - startIdx);
            var sL = b.peek(1, startIdx, readLen);
            var sR = b.peek(2, startIdx, readLen);
            var pkL = 0.0;
            var pkR = 0.0;
            if (typeof sL === "number") {
                pkL = Math.abs(sL);
                pkR = Math.abs(typeof sR === "number" ? sR : sL);
            } else if (sL && sL.length) {
                for (var k = 0; k < sL.length; k++) {
                    var aL = Math.abs(sL[k]);
                    var aR = (sR && sR.length > k) ? Math.abs(sR[k]) : aL;
                    if (aL > pkL) pkL = aL;
                    if (aR > pkR) pkR = aR;
                }
            }
            wavePeaksL[i] = Math.min(1.0, pkL);
            wavePeaksR[i] = Math.min(1.0, pkR);
            if (pkL > maxEnergy) maxEnergy = pkL;
        }

        hasLoadedSample = maxEnergy > 0.0005 ? 1 : 0;
        if (hasLoadedSample) {
            var midFrame = Math.min(Math.floor(frames * 0.15), Math.max(0, frames - 2048));
            var winLen = Math.min(2048, frames - midFrame);
            if (winLen >= 256) {
                var monoWin = b.peek(1, midFrame, winLen);
                if (monoWin && monoWin.length >= 256) {
                    detectedRootMidi = estimateRootMidiNote(monoWin, 44100);
                }
            }
            if (restoredSlices) {
                sliceMarkers = restoredSlices;
                restoredSlices = null;
            } else {
                sliceMarkers = detectTransientSlices(wavePeaksL, sliceSensitivity, 16);
            }
        }
    } catch (_) {}
}

function pollTelemetryScope() {
    if (!scopeBufName || typeof Buffer === "undefined") return;
    try {
        var sb = new Buffer(scopeBufName);
        var data = sb.peek(1, 0, 40);
        if (!data || data.length < 40) return;
        for (var i = 0; i < 16; i++) {
            voicePlayheads[i] = data[i];
            voiceAmps[i] = data[16 + i];
        }
        livePeakL = data[32];
        livePeakR = data[33];
        liveActiveVoices = Math.round(data[34]);
        liveLfoVal = data[35];
        liveModEnvVal = data[36];
        liveEffCutHz = data[37] > 10 ? data[37] : curFiltCutoff;
    } catch (_) {}
}

var scopeTask = (typeof Task !== "undefined") ? new Task(function() {
    pollTelemetryScope();
    mgraphics.redraw();
    if (scopeTask) scopeTask.schedule(45);
}) : null;

function setbuffers(sName, vName, scName) {
    sampBufName = String(sName || "");
    voicesBufName = String(vName || "");
    scopeBufName = String(scName || "");
    syncAllVoicesToBuffer();
    refreshWaveformFromBuffer();
    if (restorePath && !hasLoadedSample) outlet(0, "load_sample", restorePath);
    if (scopeTask) scopeTask.schedule(45);
    mgraphics.redraw();
}

function sample_loaded(fPath) {
    if (fPath !== undefined && String(fPath).length > 0) {
        sampleFilePath = String(fPath);
        var parts = sampleFilePath.replace(/\\/g, "/").split("/");
        sampleFileName = parts[parts.length - 1] || sampleFilePath;
    }
    restorePath = "";
    refreshWaveformFromBuffer();
    notifyclients();
    mgraphics.redraw();
}

function dropfile(fPath) {
    if (!fPath) return;
    sampleFilePath = String(fPath);
    var parts = sampleFilePath.replace(/\\/g, "/").split("/");
    sampleFileName = parts[parts.length - 1] || sampleFilePath;
    restorePath = "";
    restoredSlices = null;
    outlet(0, "load_sample", sampleFilePath);
    notifyclients();
    mgraphics.redraw();
}

// MIDI note handling from midiparse or test messages
function midi_note(note, vel) {
    var n = Math.round(Number(note) || 60);
    var v = Math.round(Number(vel) || 0);
    voiceAlloc.setMaxVoices(curPolyVoices);
    if (v > 0) {
        var allocated = voiceAlloc.noteOn(n, v, curMonoLegato, sliceMarkers);
        writeVoiceToBuffer(allocated);
        if (curMode === 3 && sliceMarkers.length > 0) {
            selectedSliceIdx = Math.max(0, n - 36) % sliceMarkers.length;
        }
    } else {
        var released = voiceAlloc.noteOff(n, curMonoLegato);
        for (var i = 0; i < released.length; i++) {
            writeVoiceToBuffer(released[i]);
        }
    }
    mgraphics.redraw();
}

function all_notes_off() {
    voiceAlloc.allNotesOff();
    syncAllVoicesToBuffer();
    mgraphics.redraw();
}

function emitRegionParams() {
    outlet(0, "param", "samp_start", Math.round(curStart * 1000) / 10);
    outlet(0, "param", "samp_end", Math.round(curEnd * 1000) / 10);
    outlet(0, "param", "loop_start", Math.round(curLoopStart * 1000) / 10);
    outlet(0, "param", "loop_end", Math.round(curLoopEnd * 1000) / 10);
    outlet(0, "param", "loop_xfade", Math.round((curXfade / 0.45) * 1000) / 10);
    outlet(0, "param", "play_pos", Math.round(curPlayPos * 1000) / 10);
}

// Parameter setters from Max live.* widgets
function set_mode(v) { curMode = Math.max(0, Math.min(3, Math.round(Number(v) || 0))); mgraphics.redraw(); }
function set_freeze(v) { curFreeze = (Number(v) > 0.5) ? 1 : 0; mgraphics.redraw(); }
function set_reverse(v) { curReverse = (Number(v) > 0.5) ? 1 : 0; mgraphics.redraw(); }
function set_loop_mode(v) { curLoopMode = Math.max(0, Math.min(2, Math.round(Number(v) || 0))); mgraphics.redraw(); }
function set_samp_start(v) { curStart = Math.max(0.0, Math.min(0.98, (Number(v) || 0) * 0.01)); mgraphics.redraw(); }
function set_samp_end(v) { curEnd = Math.max(curStart + 0.01, Math.min(1.0, (Number(v) || 100) * 0.01)); mgraphics.redraw(); }
function set_loop_start(v) { curLoopStart = Math.max(0.0, Math.min(0.98, (Number(v) || 15) * 0.01)); mgraphics.redraw(); }
function set_loop_end(v) { curLoopEnd = Math.max(curLoopStart + 0.01, Math.min(1.0, (Number(v) || 85) * 0.01)); mgraphics.redraw(); }
function set_loop_xfade(v) { curXfade = Math.max(0.0, Math.min(0.45, (Number(v) || 0) * 0.0045)); mgraphics.redraw(); }
function set_play_pos(v) { curPlayPos = Math.max(0.0, Math.min(1.0, (Number(v) || 0) * 0.01)); mgraphics.redraw(); }
function set_pitch_st(v) { curPitchSt = Number(v) || 0; mgraphics.redraw(); }
function set_fine_cents(v) { curFineCents = Number(v) || 0; mgraphics.redraw(); }
function set_root_note(v) { curRootNote = Math.max(0, Math.min(127, Math.round(Number(v) || 60))); mgraphics.redraw(); }
function set_grain_size(v) { curGrainSize = Number(v) || 65; mgraphics.redraw(); }
function set_grain_motion(v) { curGrainMotion = Number(v) || 100; mgraphics.redraw(); }
function set_grain_spray(v) { curGrainSpray = Number(v) || 15; mgraphics.redraw(); }
function set_formant(v) { curFormant = Number(v) || 0; mgraphics.redraw(); }
function set_poly_voices(v) { curPolyVoices = Math.max(1, Math.min(16, Math.round(Number(v) || 8))); voiceAlloc.setMaxVoices(curPolyVoices); mgraphics.redraw(); }
function set_mono_legato(v) { curMonoLegato = (Number(v) > 0.5) ? 1 : 0; mgraphics.redraw(); }
function set_glide_ms(v) { curGlideMs = Number(v) || 0; mgraphics.redraw(); }
function set_unison_voices(v) { curUnisonVoices = Math.max(1, Math.min(8, Math.round(Number(v) || 1))); mgraphics.redraw(); }
function set_unison_detune(v) { curUnisonDetune = Number(v) || 15; mgraphics.redraw(); }
function set_unison_width(v) { curUnisonWidth = Number(v) || 65; mgraphics.redraw(); }
function set_atk_ms(v) { curAtkMs = Number(v) || 2.5; mgraphics.redraw(); }
function set_dec_ms(v) { curDecMs = Number(v) || 250; mgraphics.redraw(); }
function set_sus_lvl(v) { curSusPct = Number(v) || 85; mgraphics.redraw(); }
function set_rel_ms(v) { curRelMs = Number(v) || 140; mgraphics.redraw(); }
function set_matk_ms(v) { curMAtkMs = Number(v) || 5.0; mgraphics.redraw(); }
function set_mdec_ms(v) { curMDecMs = Number(v) || 320; mgraphics.redraw(); }
function set_msus_lvl(v) { curMSusPct = Number(v) || 25; mgraphics.redraw(); }
function set_mrel_ms(v) { curMRelMs = Number(v) || 220; mgraphics.redraw(); }
function set_filt_on(v) { curFiltOn = (Number(v) > 0.5) ? 1 : 0; mgraphics.redraw(); }
function set_filt_type(v) { curFiltType = Math.round(Number(v) || 0); mgraphics.redraw(); }
function set_filt_cutoff(v) { curFiltCutoff = Number(v) || 18000; mgraphics.redraw(); }
function set_filt_res(v) { curFiltRes = Number(v) || 15; mgraphics.redraw(); }
function set_filt_drive(v) { curFiltDrive = Number(v) || 0; mgraphics.redraw(); }
function set_filt_env_amt(v) { curFiltEnvAmt = Number(v) || 0; mgraphics.redraw(); }
function set_lfo_rate(v) { curLfoRate = Number(v) || 2.0; mgraphics.redraw(); }
function set_lfo_shape(v) { curLfoShape = Math.round(Number(v) || 0); mgraphics.redraw(); }
function set_lfo_pitch(v) { curLfoPitch = Number(v) || 0; mgraphics.redraw(); }
function set_lfo_filt(v) { curLfoFilt = Number(v) || 0; mgraphics.redraw(); }
function set_lfo_pos(v) { curLfoPos = Number(v) || 0; mgraphics.redraw(); }

function set_variant(v) {
    uiVariant = String(v || "standard");
    mgraphics.redraw();
}

function set_panel_filt(v) {
    showFiltAmpPanel = (Number(v) > 0.5) ? 1 : 0;
    applyPanelCollapseLayout();
}

function set_panel_mod(v) {
    showModUniPanel = (Number(v) > 0.5) ? 1 : 0;
    applyPanelCollapseLayout();
}

function applyPanelCollapseLayout() {
    var lay = computeSamplerDynamicLayout(uiVariant, showFiltAmpPanel, showModUniPanel);
    // Slide Mod/Uni panel left into Filt/Amp's slot when Filt/Amp is collapsed
    if (typeof MOD_PANEL_BASE_RECTS !== "undefined" && MOD_PANEL_BASE_RECTS) {
        var shiftX = showFiltAmpPanel ? 0.0 : (lay.filtAmpW + 4.0);
        for (var boxId in MOD_PANEL_BASE_RECTS) {
            if (Object.prototype.hasOwnProperty.call(MOD_PANEL_BASE_RECTS, boxId)) {
                var r = MOD_PANEL_BASE_RECTS[boxId];
                outlet(0, "patcher_cmd", "script", "sendbox", boxId, "presentation_rect", r[0] - shiftX, r[1], r[2], r[3]);
            }
        }
    }
    outlet(0, "setwidth_cmd", lay.deviceWidth);
    outlet(0, "patcher_cmd", "window", "size", 0, 0, lay.deviceWidth, 169);
    outlet(0, "patcher_cmd", "window", "exec");
}

// Populate rich visual preview state for screenshots (render_preview.py calls preview())
function preview() {
    hasLoadedSample = 1;
    sampleFileName = "Bitwig_Prism_C3.wav";
    sampleFrames = 132300;
    sampleDurationMs = 3000;
    detectedRootMidi = 60;
    if (uiVariant === "compact") {
        curMode = 0; // Repitch + Loop crossfade showcase in Compact
        bottomTab = 1; // Show interactive graphical ADSR in Compact bottom strip
    } else if (uiVariant === "expanded") {
        curMode = 3; // Slice + Multi-voice + Filter scope showcase in Expanded
        bottomTab = 0;
    } else {
        curMode = 2; // Textures granular cloud showcase in Standard
        bottomTab = 0;
    }
    curLoopMode = 1;
    curStart = 0.04;
    curEnd = 0.96;
    curLoopStart = 0.18;
    curLoopEnd = 0.78;
    curXfade = 0.08;
    curPlayPos = 0.34;
    curUnisonVoices = 4;
    curFiltCutoff = 3400;
    curFiltRes = 42;
    curFiltEnvAmt = 45;
    liveEffCutHz = 4200;

    for (var i = 0; i < WAVE_BINS; i++) {
        var t = i / WAVE_BINS;
        var env = Math.pow(1.0 - t * 0.62, 1.25) * (0.55 + 0.45 * Math.sin(t * 28.0) * Math.cos(t * 11.0));
        var transientHit = (i % 20 < 3) ? 0.34 * Math.exp(-(i % 20) * 0.55) : 0.0;
        wavePeaksL[i] = Math.min(0.98, Math.max(0.06, Math.abs(env) + transientHit));
        wavePeaksR[i] = Math.min(0.98, Math.max(0.06, Math.abs(env * 0.90) + transientHit * 0.84));
    }
    sliceMarkers = [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
    selectedSliceIdx = 2;
    voicePlayheads[0] = 0.34; voiceAmps[0] = 0.88;
    voicePlayheads[1] = 0.43; voiceAmps[1] = 0.66;
    voicePlayheads[2] = 0.27; voiceAmps[2] = 0.54;
    voicePlayheads[3] = 0.58; voiceAmps[3] = 0.38;
    liveActiveVoices = 4;
    livePeakL = 0.76;
    livePeakR = 0.71;
    liveLfoVal = 0.42;
}

// Backward-compatible state serialization (rule #6)
function getvalueof() {
    var out = [
        2, // version 2 (v1 + trailing sample path)
        curMode,
        Math.round(curStart * 10000),
        Math.round(curEnd * 10000),
        curLoopMode,
        Math.round(curLoopStart * 10000),
        Math.round(curLoopEnd * 10000),
        Math.round(curXfade * 10000),
        Math.round(curPlayPos * 10000),
        bottomTab,
        sliceMarkers.length
    ];
    for (var i = 0; i < sliceMarkers.length; i++) {
        out.push(Math.round(sliceMarkers[i] * 10000));
    }
    out.push(sampleFilePath || "");
    return out;
}

function setvalueof() {
    var a = arrayfromargs(arguments);
    if (!a || a.length < 2) return;
    var ver = Math.round(a[0]);
    if (ver >= 1 && a.length >= 11) {
        curMode = Math.max(0, Math.min(3, Math.round(a[1])));
        curStart = Math.max(0, Math.min(0.99, a[2] / 10000.0));
        curEnd = Math.max(curStart + 0.01, Math.min(1.0, a[3] / 10000.0));
        curLoopMode = Math.max(0, Math.min(2, Math.round(a[4])));
        curLoopStart = Math.max(0, Math.min(0.99, a[5] / 10000.0));
        curLoopEnd = Math.max(curLoopStart + 0.01, Math.min(1.0, a[6] / 10000.0));
        curXfade = Math.max(0, Math.min(0.45, a[7] / 10000.0));
        curPlayPos = Math.max(0, Math.min(1.0, a[8] / 10000.0));
        bottomTab = Math.max(0, Math.min(3, Math.round(a[9])));
        var sCount = Math.max(1, Math.min(32, Math.round(a[10])));
        if (a.length >= 11 + sCount) {
            var restored = [];
            for (var i = 0; i < sCount; i++) {
                restored.push(Math.max(0, Math.min(0.999, a[11 + i] / 10000.0)));
            }
            if (restored.length > 0) sliceMarkers = restored;
            // v2 appends the dropped sample path after the slice markers
            var pathAt = 11 + sCount;
            if (ver >= 2 && a.length > pathAt && String(a[pathAt]).length > 0) {
                var p = String(a[pathAt]);
                var parts = p.replace(/\\/g, "/").split("/");
                sampleFilePath = p;
                sampleFileName = parts[parts.length - 1] || p;
                restorePath = p;
                restoredSlices = restored.length > 0 ? restored.slice() : null;
                outlet(0, "load_sample", p);
            }
        }
    }
    mgraphics.redraw();
}

// ============================================================================
// Drawing & Layout Coordinates inside v8ui
// ============================================================================

var dragTarget = "";
var dragStartX = 0;
var dragStartY = 0;
var dragInitVal = 0;

function getModeAccent() {
    var m = SAMPLER_MODES[curMode] || SAMPLER_MODES[0];
    return m.color;
}

function drawMiniFilterCurve(fx, fy, fw, fh) {
    // Mini TPT SVF frequency response & live cutoff dot for Expanded / MOD drawer
    mgraphics.set_source_rgba(0.03, 0.04, 0.055, 0.96);
    mgraphics.rectangle_rounded(fx, fy, fw, fh, 2.5, 2.5);
    mgraphics.fill();

    mgraphics.set_source_rgba(0.24, 0.28, 0.35, 0.65);
    mgraphics.set_line_width(0.8);
    mgraphics.rectangle_rounded(fx, fy, fw, fh, 2.5, 2.5);
    mgraphics.stroke();

    var fNorm = Math.log(Math.max(20, Math.min(20000, liveEffCutHz)) / 20.0) / Math.log(1000.0);
    var resNorm = Math.max(0.0, Math.min(1.0, curFiltRes * 0.01));
    var steps = 28;

    mgraphics.set_source_rgba(0.98, 0.62, 0.24, curFiltOn ? 0.92 : 0.35);
    mgraphics.set_line_width(1.3);
    for (var s = 0; s <= steps; s++) {
        var xN = s / steps;
        var d = xN - fNorm;
        var mag = 0.5;
        if (curFiltType === 0) {
            // LP
            mag = (d <= 0) ? 0.62 : Math.max(0.04, 0.62 * Math.exp(-d * 6.5));
        } else if (curFiltType === 1) {
            // BP
            mag = Math.max(0.05, 0.62 * Math.exp(-d * d * 18.0));
        } else {
            // HP
            mag = (d >= 0) ? 0.62 : Math.max(0.04, 0.62 * Math.exp(d * 6.5));
        }
        var resBump = resNorm * 0.34 * Math.exp(-d * d * 55.0);
        var yVal = Math.min(0.96, mag + resBump);
        var px = fx + 2.0 + xN * (fw - 4.0);
        var py = fy + fh - 2.0 - yVal * (fh - 5.0);
        if (s === 0) mgraphics.move_to(px, py);
        else mgraphics.line_to(px, py);
    }
    mgraphics.stroke();

    // Cutoff resonance dot
    var dotX = fx + 2.0 + Math.max(0, Math.min(1, fNorm)) * (fw - 4.0);
    var dotY = fy + fh - 2.0 - Math.min(0.94, 0.62 + resNorm * 0.30) * (fh - 5.0);
    mgraphics.set_source_rgba(1.0, 0.84, 0.42, 0.95);
    mgraphics.arc(dotX, dotY, 2.1, 0, 6.28318);
    mgraphics.fill();
}

function paint() {
    var sz = mgraphics.size;
    var w = sz[0];
    var h = sz[1];
    var acc = getModeAccent();
    var isExpanded = (w >= 312);
    var isCompact = (w <= 255);

    // 1. Outer Dark Glass Canvas Background
    mgraphics.set_source_rgba(0.052, 0.064, 0.082, 1.0);
    mgraphics.rectangle_rounded(0, 0, w, h, 5, 5);
    mgraphics.fill();

    mgraphics.set_source_rgba(acc[0] * 0.58, acc[1] * 0.58, acc[2] * 0.58, 0.72);
    mgraphics.set_line_width(1.0);
    mgraphics.rectangle_rounded(0.5, 0.5, w - 1, h - 1, 5, 5);
    mgraphics.stroke();

    // ------------------------------------------------------------------------
    // TOP BAR (y = 2.5..18): 4 Engine Mode Pills + 16-Voice LED Matrix + Root Badge
    // ------------------------------------------------------------------------
    var topY = 2.5;
    var topH = 15.5;
    var badgeW = isCompact ? 58.0 : 64.0;
    var badgeX = w - badgeW - 3.0;
    var matrixW = (!isCompact && w >= 280) ? 38.0 : 0.0;
    var modeAreaW = badgeX - matrixW - 6.0;
    var modeCellW = Math.min(isExpanded ? 54.0 : 42.0, Math.floor((modeAreaW - 6.0) / 4.0));

    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(7.8);

    for (var mi = 0; mi < 4; mi++) {
        var mSpec = SAMPLER_MODES[mi];
        var mx = 3.0 + mi * (modeCellW + 2.0);
        var isSel = (curMode === mi);
        var mc = mSpec.color;

        if (isSel) {
            mgraphics.set_source_rgba(mc[0], mc[1], mc[2], 0.94);
        } else {
            mgraphics.set_source_rgba(0.10, 0.125, 0.165, 0.95);
        }
        mgraphics.rectangle_rounded(mx, topY, modeCellW, topH, 3, 3);
        mgraphics.fill();

        mgraphics.set_source_rgba(mc[0], mc[1], mc[2], isSel ? 1.0 : 0.45);
        mgraphics.set_line_width(1.0);
        mgraphics.rectangle_rounded(mx, topY, modeCellW, topH, 3, 3);
        mgraphics.stroke();

        // Bold caps run ~0.68 em per glyph; shrink the font so the label keeps a 4 px inset per side
        var lbl = (modeCellW >= 48) ? mSpec.label : mSpec.shortLabel;
        var pillFont = Math.max(6.4, Math.min(7.8, (modeCellW - 8.0) / (lbl.length * 0.68)));
        var lblW = lbl.length * pillFont * 0.68;
        mgraphics.set_font_size(pillFont);
        mgraphics.set_source_rgba(isSel ? 0.04 : 0.84, isSel ? 0.06 : 0.88, isSel ? 0.08 : 0.94, 1.0);
        mgraphics.move_to(mx + (modeCellW - lblW) * 0.5, topY + 10.8);
        mgraphics.show_text(lbl);
        mgraphics.set_font_size(7.8);
    }

    // 16-Voice Polyphonic LED Activity Matrix + Stereo Peak Meter (in Standard & Expanded)
    if (matrixW > 0) {
        var matX = badgeX - matrixW - 2.0;
        mgraphics.set_source_rgba(0.08, 0.10, 0.13, 0.95);
        mgraphics.rectangle_rounded(matX, topY, matrixW, topH, 2.5, 2.5);
        mgraphics.fill();

        for (var vLed = 0; vLed < 16; vLed++) {
            var col = vLed % 8;
            var row = Math.floor(vLed / 8);
            var lx = matX + 3.0 + col * 3.4;
            var ly = topY + 3.2 + row * 5.2;
            var vLevel = voiceAmps[vLed];
            if (vLevel > 0.02) {
                mgraphics.set_source_rgba(acc[0], acc[1], acc[2], Math.min(1.0, 0.45 + vLevel * 0.55));
            } else {
                mgraphics.set_source_rgba(0.22, 0.27, 0.34, 0.55);
            }
            mgraphics.rectangle(lx, ly, 2.3, 3.4);
            mgraphics.fill();
        }

        // Dual L/R vertical peak bars on right edge of LED matrix
        var mtrH = topH - 4.0;
        var pkLh = Math.min(1.0, livePeakL) * mtrH;
        var pkRh = Math.min(1.0, livePeakR) * mtrH;
        mgraphics.set_source_rgba(0.30, 0.92, 0.62, 0.9);
        mgraphics.rectangle(matX + matrixW - 6.5, topY + 2.0 + (mtrH - pkLh), 2.0, pkLh);
        mgraphics.fill();
        mgraphics.rectangle(matX + matrixW - 3.5, topY + 2.0 + (mtrH - pkRh), 2.0, pkRh);
        mgraphics.fill();
    }

    // Right status pill: Root Note + Active Voices
    mgraphics.set_source_rgba(0.09, 0.11, 0.145, 0.96);
    mgraphics.rectangle_rounded(badgeX, topY, badgeW, topH, 3, 3);
    mgraphics.fill();
    mgraphics.set_source_rgba(acc[0] * 0.65, acc[1] * 0.65, acc[2] * 0.65, 0.75);
    mgraphics.rectangle_rounded(badgeX, topY, badgeW, topH, 3, 3);
    mgraphics.stroke();

    var rootStr = midiToNoteName(curRootNote) + " " + liveActiveVoices + "/" + curPolyVoices + "v";
    mgraphics.set_source_rgba(0.90, 0.94, 0.98, 0.96);
    mgraphics.set_font_size(7.6);
    mgraphics.move_to(badgeX + 4.5, topY + 10.8);
    mgraphics.show_text(rootStr);

    // ------------------------------------------------------------------------
    // MAIN WAVEFORM & LOOP / GRAIN / SLICE VIEWPORT (y = 21..94)
    // ------------------------------------------------------------------------
    var wfX = 4.0;
    var wfY = 21.0;
    var wfW = w - 8.0;
    var wfH = 72.0;
    var wfMidY = wfY + wfH * 0.5;

    // Viewport dark background + grid
    mgraphics.set_source_rgba(0.032, 0.042, 0.056, 1.0);
    mgraphics.rectangle_rounded(wfX, wfY, wfW, wfH, 3, 3);
    mgraphics.fill();

    mgraphics.set_source_rgba(0.15, 0.19, 0.25, 0.42);
    mgraphics.set_line_width(0.9);
    for (var gx = 1; gx < 8; gx++) {
        var gridX = wfX + (wfW * gx) / 8.0;
        mgraphics.move_to(gridX, wfY + 1);
        mgraphics.line_to(gridX, wfY + wfH - 1);
        mgraphics.stroke();
    }
    mgraphics.move_to(wfX + 1, wfMidY);
    mgraphics.line_to(wfX + wfW - 1, wfMidY);
    mgraphics.stroke();

    var startPx = wfX + curStart * wfW;
    var endPx = wfX + curEnd * wfW;
    var loopStartPx = wfX + curLoopStart * wfW;
    var loopEndPx = wfX + curLoopEnd * wfW;

    // Loop region highlight & equal-power crossfade ramp
    if (curMode !== 3 && curLoopMode > 0) {
        mgraphics.set_source_rgba(acc[0], acc[1], acc[2], 0.12);
        mgraphics.rectangle(loopStartPx, wfY + 1, Math.max(2, loopEndPx - loopStartPx), wfH - 2);
        mgraphics.fill();

        if (curXfade > 0.005) {
            var xfW = (loopEndPx - loopStartPx) * curXfade;
            var xfStartPx = Math.max(wfX + 1, loopStartPx - xfW);
            mgraphics.set_source_rgba(0.98, 0.76, 0.28, 0.24);
            mgraphics.move_to(xfStartPx, wfY + wfH - 1);
            mgraphics.line_to(loopStartPx, wfY + 1);
            mgraphics.line_to(loopStartPx, wfY + wfH - 1);
            mgraphics.close_path();
            mgraphics.fill();

            mgraphics.set_source_rgba(0.98, 0.78, 0.30, 0.85);
            mgraphics.set_line_width(1.1);
            mgraphics.move_to(xfStartPx, wfY + wfH - 1);
            mgraphics.line_to(loopStartPx, wfY + 1);
            mgraphics.stroke();
        }
    }

    // Draw stereo waveform bars (Top = L, Bottom = R)
    if (hasLoadedSample) {
        var numBars = Math.min(WAVE_BINS, Math.floor(wfW / 2.0));
        var barStep = wfW / numBars;
        for (var i = 0; i < numBars; i++) {
            var normPos = (i + 0.5) / numBars;
            var binIdx = Math.min(WAVE_BINS - 1, Math.floor(normPos * WAVE_BINS));
            var pkL = wavePeaksL[binIdx];
            var pkR = wavePeaksR[binIdx];
            var inActive = (normPos >= curStart && normPos <= curEnd);
            var inLoop = (curLoopMode > 0 && normPos >= curLoopStart && normPos <= curLoopEnd);

            var bx = wfX + i * barStep;
            var bw = Math.max(1.1, barStep - 0.65);
            var hTop = Math.max(1.2, pkL * (wfH * 0.44));
            var hBot = Math.max(1.2, pkR * (wfH * 0.44));

            if (!inActive) {
                mgraphics.set_source_rgba(0.26, 0.30, 0.36, 0.30);
            } else if (inLoop) {
                mgraphics.set_source_rgba(acc[0], acc[1], acc[2], 0.94);
            } else {
                mgraphics.set_source_rgba(acc[0] * 0.78, acc[1] * 0.78, acc[2] * 0.78, 0.70);
            }
            mgraphics.rectangle(bx, wfMidY - hTop, bw, hTop);
            mgraphics.fill();

            if (!inActive) {
                mgraphics.set_source_rgba(0.24, 0.28, 0.34, 0.26);
            } else if (inLoop) {
                mgraphics.set_source_rgba(acc[0] * 0.86, acc[1] * 0.92, Math.min(1.0, acc[2] * 1.08), 0.78);
            } else {
                mgraphics.set_source_rgba(acc[0] * 0.64, acc[1] * 0.68, acc[2] * 0.74, 0.56);
            }
            mgraphics.rectangle(bx, wfMidY + 0.5, bw, hBot);
            mgraphics.fill();
        }
    } else {
        mgraphics.set_source_rgba(0.58, 0.66, 0.76, 0.85);
        mgraphics.set_font_size(9.0);
        mgraphics.move_to(wfX + wfW * 0.5 - 66.0, wfMidY - 2.0);
        mgraphics.show_text("DROP AUDIO SAMPLE HERE");
        mgraphics.set_font_size(7.5);
        mgraphics.set_source_rgba(0.42, 0.50, 0.60, 0.80);
        mgraphics.move_to(wfX + wfW * 0.5 - 58.0, wfMidY + 10.0);
        mgraphics.show_text("WAV / AIFF / FLAC / MP3");
    }

    // Dimmed inactive regions outside [curStart, curEnd]
    if (curStart > 0.005) {
        mgraphics.set_source_rgba(0.02, 0.028, 0.04, 0.66);
        mgraphics.rectangle(wfX, wfY, startPx - wfX, wfH);
        mgraphics.fill();
    }
    if (curEnd < 0.995) {
        mgraphics.set_source_rgba(0.02, 0.028, 0.04, 0.66);
        mgraphics.rectangle(endPx, wfY, wfX + wfW - endPx, wfH);
        mgraphics.fill();
    }

    // Mode-specific overlays inside Waveform Viewport
    if (curMode === 3) {
        // SLICE MODE: Draw transient slice markers & active slice highlight
        for (var si = 0; si < sliceMarkers.length; si++) {
            var sNorm = sliceMarkers[si];
            var nextNorm = (si + 1 < sliceMarkers.length) ? sliceMarkers[si + 1] : 1.0;
            var sx = wfX + sNorm * wfW;
            var sw = (nextNorm - sNorm) * wfW;
            if (si === selectedSliceIdx) {
                mgraphics.set_source_rgba(0.98, 0.62, 0.24, 0.20);
                mgraphics.rectangle(sx, wfY + 1, Math.max(2, sw), wfH - 2);
                mgraphics.fill();
            }
            mgraphics.set_source_rgba(0.98, 0.68, 0.26, 0.90);
            mgraphics.set_line_width(1.2);
            mgraphics.move_to(sx, wfY + 1);
            mgraphics.line_to(sx, wfY + wfH - 1);
            mgraphics.stroke();

            // Top slice flag triangle
            mgraphics.move_to(sx, wfY + 1);
            mgraphics.line_to(sx + 6.0, wfY + 1);
            mgraphics.line_to(sx, wfY + 7.0);
            mgraphics.close_path();
            mgraphics.fill();
        }
    } else if (curMode === 2) {
        // TEXTURES MODE: Draw granular spray cloud halo around active playhead
        var gCenterNorm = curFreeze ? curPlayPos : (voiceAmps[0] > 0.02 ? voicePlayheads[0] : curPlayPos);
        var gCenterPx = wfX + gCenterNorm * wfW;
        var sprayPx = Math.max(8.0, (curGrainSpray * 0.01) * wfW * 0.28);
        mgraphics.set_source_rgba(0.30, 0.90, 0.58, 0.16);
        mgraphics.rectangle_rounded(Math.max(wfX, gCenterPx - sprayPx), wfY + 4, Math.min(wfW, sprayPx * 2.0), wfH - 8, 4, 4);
        mgraphics.fill();
        for (var gi = 0; gi < 8; gi++) {
            var gxOff = Math.sin(gi * 2.1 + liveLfoVal * 3.0) * sprayPx * 0.85;
            var gyOff = Math.cos(gi * 1.7) * (wfH * 0.32);
            mgraphics.set_source_rgba(0.42, 0.98, 0.70, 0.82);
            mgraphics.arc(gCenterPx + gxOff, wfMidY + gyOff, 2.2, 0, 6.28318);
            mgraphics.fill();
        }
    } else if (curMode === 1) {
        // CYCLES MODE: Highlight phase-locked cycle window
        var cCenterPx = wfX + (voiceAmps[0] > 0.02 ? voicePlayheads[0] : curPlayPos) * wfW;
        mgraphics.set_source_rgba(0.76, 0.46, 0.98, 0.26);
        mgraphics.rectangle_rounded(Math.max(wfX, cCenterPx - 10), wfY + 2, 20, wfH - 4, 3, 3);
        mgraphics.fill();
        mgraphics.set_source_rgba(0.84, 0.58, 1.0, 0.85);
        mgraphics.set_line_width(1.1);
        mgraphics.rectangle_rounded(Math.max(wfX, cCenterPx - 10), wfY + 2, 20, wfH - 4, 3, 3);
        mgraphics.stroke();
    }

    // Start / End / Loop boundary handles with top grip tabs
    mgraphics.set_source_rgba(0.92, 0.95, 1.0, 0.92);
    mgraphics.set_line_width(1.4);
    mgraphics.move_to(startPx, wfY);
    mgraphics.line_to(startPx, wfY + wfH);
    mgraphics.stroke();
    mgraphics.move_to(endPx, wfY);
    mgraphics.line_to(endPx, wfY + wfH);
    mgraphics.stroke();

    if (curMode !== 3 && curLoopMode > 0) {
        mgraphics.set_source_rgba(acc[0], acc[1], acc[2], 0.96);
        mgraphics.set_line_width(1.3);
        mgraphics.move_to(loopStartPx, wfY);
        mgraphics.line_to(loopStartPx, wfY + wfH);
        mgraphics.stroke();
        mgraphics.move_to(loopEndPx, wfY);
        mgraphics.line_to(loopEndPx, wfY + wfH);
        mgraphics.stroke();
    }

    // Live Multi-Voice Playheads with top triangular playhead caps
    for (var pv = 0; pv < 16; pv++) {
        var vAmp = voiceAmps[pv];
        if (vAmp > 0.02) {
            var phPx = wfX + Math.max(0, Math.min(1, voicePlayheads[pv])) * wfW;
            mgraphics.set_source_rgba(1.0, 0.94, 0.65, Math.min(1.0, 0.38 + vAmp * 0.62));
            mgraphics.set_line_width(1.6);
            mgraphics.move_to(phPx, wfY + 1);
            mgraphics.line_to(phPx, wfY + wfH - 1);
            mgraphics.stroke();

            mgraphics.move_to(phPx - 3.0, wfY + 1);
            mgraphics.line_to(phPx + 3.0, wfY + 1);
            mgraphics.line_to(phPx, wfY + 5.5);
            mgraphics.close_path();
            mgraphics.fill();
        }
    }

    // Sample filename caption overlay at top-left of waveform
    mgraphics.set_source_rgba(0.04, 0.05, 0.07, 0.76);
    mgraphics.rectangle_rounded(wfX + 3, wfY + 2, Math.min(wfW - 44, 152), 11.5, 2, 2);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.86, 0.91, 0.97, 0.94);
    mgraphics.set_font_size(7.5);
    var dispName = sampleFileName.length > 24 ? (sampleFileName.slice(0, 22) + "..") : sampleFileName;
    mgraphics.move_to(wfX + 6, wfY + 10.2);
    mgraphics.show_text(dispName + (curFreeze ? " [FREEZE]" : ""));

    // ------------------------------------------------------------------------
    // BOTTOM INTERACTIVE STRIP (y = 95.5..133.5): 4 Sub-Tabs + Live Graphic Strip
    // ------------------------------------------------------------------------
    var stripY = 95.5;
    var stripH = h - stripY - 2.5;
    var tabColW = 36.0;

    var tabNames = ["LOOP", "AMP", "MOD", "SLIC"];
    var tabRowH = (stripH - 3.0) / 4.0;
    for (var ti = 0; ti < 4; ti++) {
        var ty = stripY + ti * (tabRowH + 1.0);
        var tOn = (bottomTab === ti);
        mgraphics.set_source_rgba(tOn ? acc[0] : 0.10, tOn ? acc[1] : 0.12, tOn ? acc[2] : 0.16, tOn ? 0.94 : 0.90);
        mgraphics.rectangle_rounded(4.0, ty, tabColW, tabRowH, 2, 2);
        mgraphics.fill();
        mgraphics.set_source_rgba(tOn ? 0.04 : 0.76, tOn ? 0.06 : 0.82, tOn ? 0.08 : 0.88, 1.0);
        mgraphics.set_font_size(6.8);
        mgraphics.move_to(7.5, ty + tabRowH - 1.8);
        mgraphics.show_text(tabNames[ti]);
    }

    var plotX = 43.0;
    var fullPlotW = w - plotX - 4.0;
    // In Expanded mode, reserve right 78px of the bottom drawer for a live SVF Filter Response scope
    var filtInsetW = isExpanded ? 76.0 : 0.0;
    var plotW = fullPlotW - (filtInsetW > 0 ? (filtInsetW + 3.0) : 0.0);

    mgraphics.set_source_rgba(0.038, 0.048, 0.066, 0.96);
    mgraphics.rectangle_rounded(plotX, stripY, plotW, stripH, 3, 3);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.20, 0.25, 0.32, 0.78);
    mgraphics.set_line_width(1.0);
    mgraphics.rectangle_rounded(plotX, stripY, plotW, stripH, 3, 3);
    mgraphics.stroke();

    if (filtInsetW > 0) {
        drawMiniFilterCurve(plotX + plotW + 3.0, stripY, filtInsetW, stripH);
    }

    if (bottomTab === 0) {
        // LOOP / GRAIN / UNISON Summary Strip + Drag Bars
        mgraphics.set_font_size(7.4);
        mgraphics.set_source_rgba(acc[0], acc[1], acc[2], 0.96);
        var loopNames = ["1-SHOT", "FWD LOOP", "PING-PONG"];
        var infoLeft = loopNames[curLoopMode] + "  XF:" + Math.round((curXfade / 0.45) * 100) + "%";
        if (curMode === 2) {
            infoLeft = "GRAIN:" + Math.round(curGrainSize) + "ms  SPR:" + Math.round(curGrainSpray) + "%";
        } else if (curMode === 1) {
            infoLeft = "FORMANT:" + (curFormant >= 0 ? "+" : "") + Math.round(curFormant) + "st";
        } else if (curMode === 3) {
            infoLeft = "SLICES:" + sliceMarkers.length + " (C1.." + midiToNoteName(35 + sliceMarkers.length) + ")";
        }
        mgraphics.move_to(plotX + 5.0, stripY + 10.5);
        mgraphics.show_text(infoLeft);

        var uniTxt = "UNI:" + curUnisonVoices + "x" + (curMonoLegato ? " LEG" : "");
        mgraphics.set_source_rgba(0.84, 0.88, 0.94, 0.92);
        mgraphics.move_to(plotX + plotW - 52.0, stripY + 10.5);
        mgraphics.show_text(uniTxt);

        // Mini region bar showing Start..LoopStart..LoopEnd..End
        var barY = stripY + 15.0;
        var barH = stripH - 19.0;
        var bx0 = plotX + 5.0;
        var bwAll = plotW - 10.0;
        mgraphics.set_source_rgba(0.10, 0.13, 0.17, 1.0);
        mgraphics.rectangle_rounded(bx0, barY, bwAll, barH, 2, 2);
        mgraphics.fill();

        mgraphics.set_source_rgba(acc[0], acc[1], acc[2], 0.36);
        mgraphics.rectangle(bx0 + curStart * bwAll, barY + 1, Math.max(2, (curEnd - curStart) * bwAll), barH - 2);
        mgraphics.fill();

        if (curLoopMode > 0) {
            mgraphics.set_source_rgba(acc[0], acc[1], acc[2], 0.85);
            mgraphics.rectangle(bx0 + curLoopStart * bwAll, barY + 2, Math.max(2, (curLoopEnd - curLoopStart) * bwAll), barH - 4);
            mgraphics.fill();
        }
    } else if (bottomTab === 1 || bottomTab === 2) {
        // Graphical ADSR Curve (Tab 1 = AMP ADSR, Tab 2 = FILT/MOD ADSR)
        var isMod = (bottomTab === 2);
        var aMs = isMod ? curMAtkMs : curAtkMs;
        var dMs = isMod ? curMDecMs : curDecMs;
        var sNorm = (isMod ? curMSusPct : curSusPct) * 0.01;
        var rMs = isMod ? curMRelMs : curRelMs;

        var ax = plotX + 6.0;
        var ayBot = stripY + stripH - 4.0;
        var ayTop = stripY + 6.0;
        var availW = plotW - 12.0;

        var wA = Math.min(availW * 0.28, Math.max(6.0, Math.log(1 + aMs * 0.1) * 9.0));
        var wD = Math.min(availW * 0.28, Math.max(8.0, Math.log(1 + dMs * 0.05) * 9.0));
        var wR = Math.min(availW * 0.28, Math.max(8.0, Math.log(1 + rMs * 0.05) * 9.0));
        var wS = Math.max(12.0, availW - wA - wD - wR);

        var x1 = ax + wA;
        var x2 = x1 + wD;
        var x3 = x2 + wS;
        var x4 = x3 + wR;
        var ySus = ayBot - sNorm * (ayBot - ayTop);

        var envCol = isMod ? [0.76, 0.46, 0.98] : [0.38, 0.78, 0.98];
        mgraphics.set_source_rgba(envCol[0], envCol[1], envCol[2], 0.22);
        mgraphics.move_to(ax, ayBot);
        mgraphics.line_to(x1, ayTop);
        mgraphics.line_to(x2, ySus);
        mgraphics.line_to(x3, ySus);
        mgraphics.line_to(x4, ayBot);
        mgraphics.close_path();
        mgraphics.fill();

        mgraphics.set_source_rgba(envCol[0], envCol[1], envCol[2], 0.96);
        mgraphics.set_line_width(1.5);
        mgraphics.move_to(ax, ayBot);
        mgraphics.line_to(x1, ayTop);
        mgraphics.line_to(x2, ySus);
        mgraphics.line_to(x3, ySus);
        mgraphics.line_to(x4, ayBot);
        mgraphics.stroke();

        // Draw ADSR breakpoint nodes
        mgraphics.arc(x1, ayTop, 2.0, 0, 6.28318);
        mgraphics.fill();
        mgraphics.arc(x2, ySus, 2.0, 0, 6.28318);
        mgraphics.fill();
        mgraphics.arc(x3, ySus, 2.0, 0, 6.28318);
        mgraphics.fill();

        mgraphics.set_font_size(6.8);
        mgraphics.set_source_rgba(0.86, 0.90, 0.96, 0.88);
        mgraphics.move_to(plotX + plotW - 68.0, stripY + 9.5);
        mgraphics.show_text((isMod ? "MOD " : "AMP ") + Math.round(aMs) + "/" + Math.round(dMs) + "ms");
    } else {
        // Tab 3: SLICES Sensitivity & Auto-Slice Strip
        mgraphics.set_font_size(7.4);
        mgraphics.set_source_rgba(0.98, 0.68, 0.26, 0.95);
        mgraphics.move_to(plotX + 6.0, stripY + 11.5);
        mgraphics.show_text("SENS: " + Math.round(sliceSensitivity * 100) + "% (" + sliceMarkers.length + " SLICES)");
        mgraphics.set_source_rgba(0.20, 0.25, 0.33, 1.0);
        mgraphics.rectangle_rounded(plotX + 6.0, stripY + 16.0, plotW - 12.0, 9.0, 2, 2);
        mgraphics.fill();
        mgraphics.set_source_rgba(0.98, 0.62, 0.24, 0.88);
        mgraphics.rectangle_rounded(plotX + 6.0, stripY + 16.0, (plotW - 12.0) * sliceSensitivity, 9.0, 2, 2);
        mgraphics.fill();
    }
}

// ============================================================================
// Mouse Interaction (Mode selection, Waveform handles, Slice audition, Sub-tabs)
// ============================================================================

function onclick(x, y) {
    var sz = mgraphics.size;
    var w = sz[0];
    var h = sz[1];
    var isExpanded = (w >= 312);
    var isCompact = (w <= 255);
    dragStartX = x;
    dragStartY = y;
    dragTarget = "";

    // 1. Top Mode Bar click (y = 0..20)
    if (y >= 0 && y <= 20) {
        var badgeW = isCompact ? 58.0 : 64.0;
        var badgeX = w - badgeW - 3.0;
        var matrixW = (!isCompact && w >= 280) ? 38.0 : 0.0;
        var modeAreaW = badgeX - matrixW - 6.0;
        var modeCellW = Math.min(isExpanded ? 54.0 : 42.0, Math.floor((modeAreaW - 6.0) / 4.0));
        for (var mi = 0; mi < 4; mi++) {
            var mx = 3.0 + mi * (modeCellW + 2.0);
            if (x >= mx && x <= mx + modeCellW) {
                pushUndoState();
                curMode = mi;
                if (curMode === 3) bottomTab = 3;
                outlet(0, "param", "mode", curMode);
                notifyclients();
                mgraphics.redraw();
                return;
            }
        }
        // Clicking Root badge sets Root Note to detected root
        if (x >= badgeX) {
            curRootNote = detectedRootMidi;
            outlet(0, "root_note", curRootNote);
            mgraphics.redraw();
            return;
        }
    }

    // 2. Main Waveform Viewport click (y = 21..94)
    var wfX = 4.0;
    var wfY = 21.0;
    var wfW = w - 8.0;
    var wfH = 72.0;
    if (y >= wfY && y <= wfY + wfH && x >= wfX && x <= wfX + wfW) {
        pushUndoState();
        var normX = Math.max(0.0, Math.min(1.0, (x - wfX) / wfW));

        if (curMode === 3 && sliceMarkers.length > 0) {
            var sIdx = 0;
            for (var si = 0; si < sliceMarkers.length; si++) {
                if (normX >= sliceMarkers[si]) sIdx = si;
            }
            selectedSliceIdx = sIdx;
            midi_note(36 + sIdx, 110);
            dragTarget = "slice_audition";
            mgraphics.redraw();
            return;
        }

        var dLoopS = Math.abs(normX - curLoopStart) * wfW;
        var dLoopE = Math.abs(normX - curLoopEnd) * wfW;
        var dStart = Math.abs(normX - curStart) * wfW;
        var dEnd = Math.abs(normX - curEnd) * wfW;

        if (curLoopMode > 0 && dLoopS < 6.0) {
            dragTarget = "loop_start";
            dragInitVal = curLoopStart;
        } else if (curLoopMode > 0 && dLoopE < 6.0) {
            dragTarget = "loop_end";
            dragInitVal = curLoopEnd;
        } else if (dStart < 6.0) {
            dragTarget = "samp_start";
            dragInitVal = curStart;
        } else if (dEnd < 6.0) {
            dragTarget = "samp_end";
            dragInitVal = curEnd;
        } else {
            dragTarget = "play_pos";
            curPlayPos = normX;
            emitRegionParams();
        }
        mgraphics.redraw();
        return;
    }

    // 3. Bottom Strip Sub-Tabs or Control Strip (y >= 95)
    var stripY = 95.5;
    var stripH = h - stripY - 2.5;
    if (y >= stripY) {
        if (x <= 41.0) {
            var tabRowH = (stripH - 3.0) / 4.0;
            var tIdx = Math.max(0, Math.min(3, Math.floor((y - stripY) / (tabRowH + 1.0))));
            bottomTab = tIdx;
            notifyclients();
            mgraphics.redraw();
            return;
        }
        if (bottomTab === 3) {
            pushUndoState();
            dragTarget = "slice_sens";
            var plotX = 43.0;
            var filtInsetW = isExpanded ? 76.0 : 0.0;
            var plotW = (w - plotX - 4.0) - (filtInsetW > 0 ? (filtInsetW + 3.0) : 0.0);
            sliceSensitivity = Math.max(0.05, Math.min(0.98, (x - (plotX + 6.0)) / Math.max(10, plotW - 12.0)));
            sliceMarkers = detectTransientSlices(wavePeaksL, sliceSensitivity, 16);
            notifyclients();
            mgraphics.redraw();
        }
    }
}

function ondrag(x, y, but) {
    if (but === 0) {
        if (dragTarget === "slice_audition" && selectedSliceIdx >= 0) {
            midi_note(36 + selectedSliceIdx, 0);
        }
        dragTarget = "";
        notifyclients();
        return;
    }
    var sz = mgraphics.size;
    var w = sz[0];
    var isExpanded = (w >= 312);
    var wfX = 4.0;
    var wfW = w - 8.0;
    var normX = Math.max(0.0, Math.min(1.0, (x - wfX) / wfW));

    if (dragTarget === "loop_start") {
        curLoopStart = Math.max(curStart, Math.min(curLoopEnd - 0.01, normX));
        emitRegionParams();
    } else if (dragTarget === "loop_end") {
        curLoopEnd = Math.max(curLoopStart + 0.01, Math.min(curEnd, normX));
        emitRegionParams();
    } else if (dragTarget === "samp_start") {
        curStart = Math.max(0.0, Math.min(curEnd - 0.02, normX));
        if (curLoopStart < curStart) curLoopStart = curStart;
        emitRegionParams();
    } else if (dragTarget === "samp_end") {
        curEnd = Math.max(curStart + 0.02, Math.min(1.0, normX));
        if (curLoopEnd > curEnd) curLoopEnd = curEnd;
        emitRegionParams();
    } else if (dragTarget === "play_pos") {
        curPlayPos = normX;
        emitRegionParams();
    } else if (dragTarget === "slice_sens") {
        var plotX = 43.0;
        var filtInsetW = isExpanded ? 76.0 : 0.0;
        var plotW = (w - plotX - 4.0) - (filtInsetW > 0 ? (filtInsetW + 3.0) : 0.0);
        sliceSensitivity = Math.max(0.05, Math.min(0.98, (x - (plotX + 6.0)) / Math.max(10, plotW - 12.0)));
        sliceMarkers = detectTransientSlices(wavePeaksL, sliceSensitivity, 16);
    }
    mgraphics.redraw();
}

function ondblclick(x, y) {
    pushUndoState();
    curStart = 0.0;
    curEnd = 1.0;
    curLoopStart = 0.15;
    curLoopEnd = 0.85;
    emitRegionParams();
    notifyclients();
    mgraphics.redraw();
}
