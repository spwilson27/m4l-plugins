// Better GrainSpec — Interactive Waveform, Slice Editor, and Audio-Reactive Grain/Spectral Visualizer.
// src/grainspec_slicer.js is prepended at build time.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 2;

var sampleBufName = "";
var sliceBufName = "";
var stateBufName = "";
var sampleBuf = null;
var sliceBuf = null;
var stateBuf = null;

var sampleName = "Synth Break";
var sampleRate = 44100;
var sampleFrames = 88200;
var monoSamples = [];
var waveBins = [];
var WAVE_BIN_COUNT = 184;

var sensitivity = 0.65; // 0..1
var keyMode = 0; // 0 = 128 Slice Map, 1 = Chromatic Pitch
var reverseSlice = 0;
var pitchSemi = 0;
var transAmount = 0.75;
var morphAmount = 0.35;
var captureActive = 0;

var slices = [];
var selectedSlice = 0;
var trigCounter = 0;

var undoStack = [];
var redoStack = [];
var MAX_UNDO = 32;

var draggingMarkerIdx = -1;
var draggingScrub = false;
var hoverMarkerIdx = -1;
var hoverBtnIdx = -1;

// Real-time DSP state telemetry from #0-gsstate
var uiState = {
    playhead: 0,
    activeSlice: 0,
    gPos: [0.1, 0.35, 0.6, 0.82],
    gEnv: [0, 0, 0, 0],
    outEnv: 0,
    transEnv: 0,
    capHead: 0,
    voiceActive: 0,
    combHz: 110,
    pitchRatio: 1
};

var pollTask = null;

var TOOLBAR_ITEMS = [
    { id: "undo", title: "Undo Slice Edit" },
    { id: "redo", title: "Redo Slice Edit" },
    { id: "detect", title: "Re-Detect Onsets" },
    { id: "add", title: "Add Slice Marker" },
    { id: "del", title: "Delete Selected Slice" },
    { id: "rand", title: "Trigger Random Slice" },
    { id: "rev", title: "Reverse Slice Playback" },
    { id: "keymode", title: "Toggle 128-Map / Chromatic" }
];

function canvasSize() {
    var s = mgraphics.size;
    if (!s || s.length < 2) return [368, 132];
    return [s[0], s[1]];
}

function cloneSlices(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
        var s = list[i];
        out.push({
            startFrame: s.startFrame,
            endFrame: s.endFrame,
            transientFrames: s.transientFrames,
            pitchHz: s.pitchHz
        });
    }
    return out;
}

function pushUndoState() {
    undoStack.push({
        slices: cloneSlices(slices),
        selectedSlice: selectedSlice,
        reverseSlice: reverseSlice,
        keyMode: keyMode
    });
    if (undoStack.length > MAX_UNDO) {
        undoStack.shift();
    }
    redoStack = [];
}

function undo() {
    if (!undoStack.length) return;
    redoStack.push({
        slices: cloneSlices(slices),
        selectedSlice: selectedSlice,
        reverseSlice: reverseSlice,
        keyMode: keyMode
    });
    var prev = undoStack.pop();
    slices = prev.slices;
    selectedSlice = gsClamp(prev.selectedSlice, 0, Math.max(0, slices.length - 1));
    reverseSlice = prev.reverseSlice ? 1 : 0;
    keyMode = prev.keyMode ? 1 : 0;
    pokeSliceBuffer();
    emitCurrentSliceState(false);
    notifyclients();
    mgraphics.redraw();
}

function redo() {
    if (!redoStack.length) return;
    undoStack.push({
        slices: cloneSlices(slices),
        selectedSlice: selectedSlice,
        reverseSlice: reverseSlice,
        keyMode: keyMode
    });
    var next = redoStack.pop();
    slices = next.slices;
    selectedSlice = gsClamp(next.selectedSlice, 0, Math.max(0, slices.length - 1));
    reverseSlice = next.reverseSlice ? 1 : 0;
    keyMode = next.keyMode ? 1 : 0;
    pokeSliceBuffer();
    emitCurrentSliceState(false);
    notifyclients();
    mgraphics.redraw();
}

function computeWaveBins(samples, binCount) {
    var n = samples ? samples.length : 0;
    var count = binCount || WAVE_BIN_COUNT;
    var bins = new Array(count);
    if (n < 1) {
        for (var z = 0; z < count; z++) bins[z] = 0;
        return bins;
    }
    var step = Math.max(1, n / count);
    var maxPeak = 0.001;
    for (var i = 0; i < count; i++) {
        var i0 = Math.floor(i * step);
        var i1 = Math.min(n, Math.max(i0 + 1, Math.floor((i + 1) * step)));
        var stride = Math.max(1, Math.floor((i1 - i0) / 32));
        var pk = 0;
        for (var j = i0; j < i1; j += stride) {
            var a = Math.abs(samples[j]);
            if (a > pk) pk = a;
        }
        bins[i] = pk;
        if (pk > maxPeak) maxPeak = pk;
    }
    var inv = 1 / maxPeak;
    for (var k = 0; k < count; k++) {
        bins[k] = gsClamp(bins[k] * inv, 0, 1);
    }
    return bins;
}

function rebuildDefaultSample() {
    var loop = synthesizeDefaultLoop(sampleRate);
    sampleFrames = loop.numFrames;
    monoSamples = new Array(sampleFrames);
    for (var i = 0; i < sampleFrames; i++) {
        monoSamples[i] = (loop.left[i] + loop.right[i]) * 0.5;
    }
    if (sampleBuf) {
        sampleBuf.poke(1, 0, loop.left);
        sampleBuf.poke(2, 0, loop.right);
    }
    waveBins = computeWaveBins(monoSamples, WAVE_BIN_COUNT);
    slices = detectOnsets(monoSamples, sampleRate, sensitivity, GS_MAX_SLICES);
    selectedSlice = gsClamp(selectedSlice, 0, Math.max(0, slices.length - 1));
    pokeSliceBuffer();
}

function readSampleFromBuffer() {
    if (!sampleBuf) return;
    var frames = sampleBuf.framecount ? sampleBuf.framecount() : 0;
    var lenMs = sampleBuf.length ? sampleBuf.length() : 0;
    if (frames < 64) {
        rebuildDefaultSample();
        return;
    }
    sampleFrames = frames;
    if (lenMs > 0) {
        sampleRate = Math.round(frames / (lenMs / 1000));
    }
    var maxRead = Math.min(frames, 44100 * 8);
    var out = new Array(maxRead);
    var chunkLen = 4096;
    var nonZero = 0;
    for (var i = 0; i < maxRead; i += chunkLen) {
        var c = Math.min(chunkLen, maxRead - i);
        var ch1 = sampleBuf.peek(1, i, c);
        if (typeof ch1 === "number") {
            out[i] = ch1;
            if (Math.abs(ch1) > 1e-5) nonZero++;
        } else if (ch1 && ch1.length) {
            for (var k = 0; k < ch1.length; k++) {
                var v = ch1[k] || 0;
                out[i + k] = v;
                if (Math.abs(v) > 1e-5) nonZero++;
            }
        } else {
            for (var z = 0; z < c; z++) out[i + z] = 0;
        }
    }
    if (nonZero < 16) {
        // Buffer is currently blank on initial load; populate with default breakbeat loop
        rebuildDefaultSample();
        return;
    }
    monoSamples = out;
    waveBins = computeWaveBins(monoSamples, WAVE_BIN_COUNT);
    slices = detectOnsets(monoSamples, sampleRate, sensitivity, GS_MAX_SLICES);
    selectedSlice = gsClamp(selectedSlice, 0, Math.max(0, slices.length - 1));
    pokeSliceBuffer();
}

function pokeSliceBuffer() {
    if (!sliceBuf) return;
    var floats = slicesToFloats(slices, sampleFrames);
    sliceBuf.poke(1, 0, floats);
}

function setbuffer(sName, slName, stName) {
    sampleBufName = sName ? ("" + sName) : "";
    sliceBufName = slName ? ("" + slName) : "";
    stateBufName = stName ? ("" + stName) : "";
    if (sampleBufName && typeof Buffer === "function") {
        sampleBuf = new Buffer(sampleBufName);
    }
    if (sliceBufName && typeof Buffer === "function") {
        sliceBuf = new Buffer(sliceBufName);
    }
    if (stateBufName && typeof Buffer === "function") {
        stateBuf = new Buffer(stateBufName);
    }
    readSampleFromBuffer();
    emitCurrentSliceState(true);
    mgraphics.redraw();
}

function emitCurrentSliceState(triggerNow) {
    var n = slices.length;
    selectedSlice = gsClamp(selectedSlice, 0, Math.max(0, n - 1));
    outlet(0, ["slice", selectedSlice]);
    outlet(0, ["keymode", keyMode]);
    outlet(0, ["rev", reverseSlice]);
    if (triggerNow) {
        trigCounter = (trigCounter % 100000) + 1;
        outlet(0, ["gate", 1.0]);
        outlet(0, ["trigcount", trigCounter]);
    }
}

function set_sensitivity(v) {
    var norm = v > 1.0001 ? gsClamp(v / 100, 0, 1) : gsClamp(v, 0, 1);
    sensitivity = norm;
    if (monoSamples && monoSamples.length >= 64) {
        slices = detectOnsets(monoSamples, sampleRate, sensitivity, GS_MAX_SLICES);
        selectedSlice = gsClamp(selectedSlice, 0, Math.max(0, slices.length - 1));
        pokeSliceBuffer();
        emitCurrentSliceState(false);
    }
    mgraphics.redraw();
}

function set_keymode(v) {
    keyMode = Number(v) ? 1 : 0;
    outlet(0, ["keymode", keyMode]);
    outlet(1, ["keymode_tab", keyMode]);
    mgraphics.redraw();
}

function set_capture(v) {
    var wasCap = captureActive;
    captureActive = Number(v) ? 1 : 0;
    outlet(0, ["capture", captureActive]);
    if (wasCap && !captureActive) {
        sampleName = "Captured Audio";
        readSampleFromBuffer();
        emitCurrentSliceState(true);
    }
    mgraphics.redraw();
}

function set_trans(v) {
    transAmount = v > 1.0001 ? gsClamp(v / 100, 0, 1) : gsClamp(v, 0, 1);
    mgraphics.redraw();
}

function set_morph(v) {
    morphAmount = v > 1.0001 ? gsClamp(v / 100, 0, 1) : gsClamp(v, 0, 1);
    mgraphics.redraw();
}

function set_pitch(v) {
    pitchSemi = gsClamp(Number(v) || 0, -24, 24);
    mgraphics.redraw();
}

function sample_loaded(filePath) {
    if (filePath) {
        var str = "" + filePath;
        var parts = str.split(/[\\/]/);
        sampleName = parts[parts.length - 1] || "Sample";
    }
    readSampleFromBuffer();
    emitCurrentSliceState(true);
    notifyclients();
    mgraphics.redraw();
}

// MIDI Note input from notein: `midi_in <note> <velocity>`
function midi_in(note, velocity) {
    var vel = Number(velocity) || 0;
    if (vel <= 0) {
        return;
    }
    var res = resolveMidiTrigger(note, vel, keyMode, selectedSlice, slices, pitchSemi);
    selectedSlice = res.sliceIndex;
    trigCounter = (trigCounter % 100000) + 1;
    outlet(0, ["midi_note", gsClamp(Math.round(note || 60), 0, 127)]);
    outlet(0, ["slice", selectedSlice]);
    outlet(0, ["gate", gsClamp(0.35 + res.velocity01 * 0.65, 0.2, 1.2)]);
    outlet(0, ["trigcount", trigCounter]);
    mgraphics.redraw();
}

function recalcSliceMetadata(idx) {
    if (idx < 0 || idx >= slices.length) return;
    var s = slices[idx];
    s.endFrame = idx + 1 < slices.length ? slices[idx + 1].startFrame : sampleFrames;
    if (s.endFrame <= s.startFrame) s.endFrame = Math.min(sampleFrames, s.startFrame + 64);
    if (monoSamples && monoSamples.length >= 64) {
        s.transientFrames = estimateTransientFrames(monoSamples, sampleRate, s.startFrame, s.endFrame);
        s.pitchHz = Math.round(estimateSlicePitchHz(monoSamples, sampleRate, s.startFrame, s.endFrame) * 100) / 100;
    }
}

function addSliceAtSelected() {
    if (!slices.length || slices.length >= GS_MAX_SLICES) return;
    var cur = slices[selectedSlice] || slices[0];
    var span = cur.endFrame - cur.startFrame;
    if (span < 256) return;
    pushUndoState();
    var mid = Math.floor(cur.startFrame + span * 0.5);
    var newSlice = {
        startFrame: mid,
        endFrame: cur.endFrame,
        transientFrames: cur.transientFrames,
        pitchHz: cur.pitchHz
    };
    cur.endFrame = mid;
    slices.splice(selectedSlice + 1, 0, newSlice);
    recalcSliceMetadata(selectedSlice);
    recalcSliceMetadata(selectedSlice + 1);
    selectedSlice = selectedSlice + 1;
    pokeSliceBuffer();
    emitCurrentSliceState(true);
    notifyclients();
    mgraphics.redraw();
}

function deleteSelectedSlice() {
    if (slices.length <= 1) return;
    pushUndoState();
    if (selectedSlice === 0) {
        slices.splice(0, 1);
        slices[0].startFrame = 0;
        recalcSliceMetadata(0);
    } else {
        var prevIdx = selectedSlice - 1;
        slices.splice(selectedSlice, 1);
        recalcSliceMetadata(prevIdx);
        selectedSlice = prevIdx;
    }
    pokeSliceBuffer();
    emitCurrentSliceState(false);
    notifyclients();
    mgraphics.redraw();
}

function pullStateTelemetry() {
    if (!stateBuf) return;
    var chunk = stateBuf.peek(1, 0, GS_STATE_FLOATS);
    if (!chunk || !chunk.length) return;
    uiState.playhead = gsClamp(chunk[0] || 0, 0, 1);
    uiState.activeSlice = gsClamp(Math.floor(chunk[1] || 0), 0, Math.max(0, slices.length - 1));
    for (var g = 0; g < 4; g++) {
        uiState.gPos[g] = gsClamp(chunk[2 + g] || 0, 0, 1);
        var rawEnv = gsClamp(chunk[6 + g] || 0, 0, 1);
        var coef = rawEnv > uiState.gEnv[g] ? 0.6 : 0.22;
        uiState.gEnv[g] = uiState.gEnv[g] + (rawEnv - uiState.gEnv[g]) * coef;
    }
    var outRaw = gsClamp(chunk[10] || 0, 0, 1);
    uiState.outEnv = uiState.outEnv + (outRaw - uiState.outEnv) * (outRaw > uiState.outEnv ? 0.6 : 0.2);
    var trRaw = gsClamp(chunk[11] || 0, 0, 1);
    uiState.transEnv = uiState.transEnv + (trRaw - uiState.transEnv) * (trRaw > uiState.transEnv ? 0.7 : 0.25);
    uiState.capHead = gsClamp(chunk[12] || 0, 0, 1);
    uiState.voiceActive = (chunk[13] || 0) > 0.5 ? 1 : 0;
    if (chunk[14] > 20) uiState.combHz = chunk[14];
    if (chunk[15] > 0.05) uiState.pitchRatio = chunk[15];
}

function loadbang() {
    if (!monoSamples || !monoSamples.length) {
        rebuildDefaultSample();
    }
    if (typeof Task === "function") {
        pollTask = new Task(function () {
            pullStateTelemetry();
            mgraphics.redraw();
        }, this);
        pollTask.interval = 33;
        pollTask.repeat();
    }
    mgraphics.redraw();
}

function preview() {
    if (!monoSamples || !monoSamples.length) {
        rebuildDefaultSample();
    }
    selectedSlice = Math.min(4, Math.max(0, slices.length - 1));
    uiState.activeSlice = selectedSlice;
    uiState.voiceActive = 1;
    uiState.playhead = 0.42;
    uiState.gPos = [0.22, 0.39, 0.54, 0.71];
    uiState.gEnv = [0.65, 0.85, 0.50, 0.40];
    uiState.outEnv = 0.58;
    uiState.transEnv = 0.45;
    uiState.combHz = slices[selectedSlice] ? slices[selectedSlice].pitchHz : 185;
}

// ============================================================================
// Serialization (getvalueof / setvalueof) — Versioned for Preset/Set Recall
// ============================================================================
function getvalueof() {
    var data = [
        1, // version 1
        Math.round(sensitivity * 1000),
        selectedSlice,
        keyMode ? 1 : 0,
        reverseSlice ? 1 : 0,
        slices.length
    ];
    for (var i = 0; i < slices.length; i++) {
        var s = slices[i];
        data.push(Math.round(s.startFrame));
        data.push(Math.round(s.endFrame));
        data.push(Math.round(s.transientFrames));
        data.push(Math.round((s.pitchHz || 110) * 100));
    }
    return data;
}

function setvalueof() {
    var args = arrayfromargs(arguments);
    if (!args || args.length < 2) return;
    var ver = Math.round(args[0]);
    if (ver >= 1 && args.length >= 6) {
        sensitivity = gsClamp((args[1] || 650) / 1000, 0, 1);
        selectedSlice = Math.max(0, Math.round(args[2] || 0));
        keyMode = args[3] ? 1 : 0;
        reverseSlice = args[4] ? 1 : 0;
        var count = gsClamp(Math.round(args[5] || 0), 0, GS_MAX_SLICES);
        var loaded = [];
        var idx = 6;
        for (var i = 0; i < count && idx + 3 < args.length; i++) {
            loaded.push({
                startFrame: Math.max(0, Math.round(args[idx])),
                endFrame: Math.max(1, Math.round(args[idx + 1])),
                transientFrames: Math.max(16, Math.round(args[idx + 2])),
                pitchHz: gsClamp((args[idx + 3] || 11000) / 100, 40, 2000)
            });
            idx += 4;
        }
        if (loaded.length > 0) {
            slices = loaded;
            selectedSlice = gsClamp(selectedSlice, 0, slices.length - 1);
            pokeSliceBuffer();
        }
    }
    mgraphics.redraw();
}

// ============================================================================
// Mouse Interaction (Waveform Slice Editing + Vector Toolbar)
// ============================================================================
function waveRect(w, h) {
    return { x: 6, y: 20, w: w - 12, h: h - 44 };
}

function findMarkerNearX(px, rect) {
    if (!slices.length || sampleFrames < 1) return -1;
    var bestIdx = -1;
    var bestDist = 4.5;
    for (var i = 1; i < slices.length; i++) {
        var mx = rect.x + (slices[i].startFrame / sampleFrames) * rect.w;
        var d = Math.abs(px - mx);
        if (d <= bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function findSliceAtFrame(frame) {
    for (var i = 0; i < slices.length; i++) {
        if (frame >= slices[i].startFrame && frame < slices[i].endFrame) {
            return i;
        }
    }
    return Math.max(0, slices.length - 1);
}

function toolbarHitTest(x, y, w, h) {
    var barY = h - 21;
    if (y < barY || y > h - 1) return -1;
    var cellW = 24;
    var startX = 6;
    var idx = Math.floor((x - startX) / cellW);
    if (idx >= 0 && idx < TOOLBAR_ITEMS.length) {
        return idx;
    }
    return -1;
}

function handleToolbarClick(idx) {
    var item = TOOLBAR_ITEMS[idx];
    if (!item) return;
    if (item.id === "undo") {
        undo();
    } else if (item.id === "redo") {
        redo();
    } else if (item.id === "detect") {
        pushUndoState();
        slices = detectOnsets(monoSamples, sampleRate, sensitivity, GS_MAX_SLICES);
        selectedSlice = gsClamp(selectedSlice, 0, Math.max(0, slices.length - 1));
        pokeSliceBuffer();
        emitCurrentSliceState(true);
        notifyclients();
        mgraphics.redraw();
    } else if (item.id === "add") {
        addSliceAtSelected();
    } else if (item.id === "del") {
        deleteSelectedSlice();
    } else if (item.id === "rand") {
        if (slices.length > 0) {
            selectedSlice = Math.floor(Math.random() * slices.length);
            emitCurrentSliceState(true);
            mgraphics.redraw();
        }
    } else if (item.id === "rev") {
        pushUndoState();
        reverseSlice = reverseSlice ? 0 : 1;
        emitCurrentSliceState(true);
        notifyclients();
        mgraphics.redraw();
    } else if (item.id === "keymode") {
        pushUndoState();
        set_keymode(keyMode ? 0 : 1);
        notifyclients();
    }
}

function onclick(x, y, but, cmd, shift) {
    var sz = canvasSize();
    var w = sz[0];
    var h = sz[1];
    draggingMarkerIdx = -1;
    draggingScrub = false;

    var btnIdx = toolbarHitTest(x, y, w, h);
    if (btnIdx >= 0) {
        handleToolbarClick(btnIdx);
        return;
    }

    var r = waveRect(w, h);
    if (y >= r.y && y <= r.y + r.h && x >= r.x && x <= r.x + r.w) {
        var nearMarker = findMarkerNearX(x, r);
        if (nearMarker > 0 && !shift) {
            pushUndoState();
            draggingMarkerIdx = nearMarker;
            selectedSlice = nearMarker;
            emitCurrentSliceState(true);
            mgraphics.redraw();
            return;
        }
        var normX = gsClamp((x - r.x) / r.w, 0, 0.9999);
        var frame = Math.floor(normX * sampleFrames);
        selectedSlice = findSliceAtFrame(frame);
        draggingScrub = true;
        emitCurrentSliceState(true);
        mgraphics.redraw();
    }
}

function ondrag(x, y, but) {
    var sz = canvasSize();
    var r = waveRect(sz[0], sz[1]);
    if (!but) {
        if (draggingMarkerIdx > 0) {
            pokeSliceBuffer();
            notifyclients();
        }
        draggingMarkerIdx = -1;
        draggingScrub = false;
        return;
    }
    if (draggingMarkerIdx > 0 && draggingMarkerIdx < slices.length) {
        var prevStart = slices[draggingMarkerIdx - 1].startFrame + 128;
        var nextEnd = (draggingMarkerIdx + 1 < slices.length ? slices[draggingMarkerIdx + 1].startFrame : sampleFrames) - 128;
        var normX = gsClamp((x - r.x) / r.w, 0, 1);
        var newStart = gsClamp(Math.round(normX * sampleFrames), prevStart, Math.max(prevStart, nextEnd));
        slices[draggingMarkerIdx].startFrame = newStart;
        slices[draggingMarkerIdx - 1].endFrame = newStart;
        recalcSliceMetadata(draggingMarkerIdx - 1);
        recalcSliceMetadata(draggingMarkerIdx);
        pokeSliceBuffer();
        mgraphics.redraw();
    } else if (draggingScrub && slices.length > 0) {
        var nx = gsClamp((x - r.x) / r.w, 0, 0.9999);
        var idx = findSliceAtFrame(Math.floor(nx * sampleFrames));
        if (idx !== selectedSlice) {
            selectedSlice = idx;
            emitCurrentSliceState(true);
            mgraphics.redraw();
        }
    }
}

function ondblclick(x, y) {
    var sz = canvasSize();
    var r = waveRect(sz[0], sz[1]);
    if (y < r.y || y > r.y + r.h || x < r.x || x > r.x + r.w) return;

    var nearMarker = findMarkerNearX(x, r);
    if (nearMarker > 0) {
        // Double-click existing slice marker -> remove it
        selectedSlice = nearMarker;
        deleteSelectedSlice();
        return;
    }

    // Double-click inside a slice -> insert a new slice marker at click position
    if (slices.length >= GS_MAX_SLICES) return;
    var normX = gsClamp((x - r.x) / r.w, 0, 0.9999);
    var frame = Math.floor(normX * sampleFrames);
    var idx = findSliceAtFrame(frame);
    var cur = slices[idx];
    if (!cur || frame - cur.startFrame < 128 || cur.endFrame - frame < 128) return;

    pushUndoState();
    var inserted = {
        startFrame: frame,
        endFrame: cur.endFrame,
        transientFrames: cur.transientFrames,
        pitchHz: cur.pitchHz
    };
    cur.endFrame = frame;
    slices.splice(idx + 1, 0, inserted);
    recalcSliceMetadata(idx);
    recalcSliceMetadata(idx + 1);
    selectedSlice = idx + 1;
    pokeSliceBuffer();
    emitCurrentSliceState(true);
    notifyclients();
    mgraphics.redraw();
}

function onidle(x, y) {
    var sz = canvasSize();
    var r = waveRect(sz[0], sz[1]);
    var oldBtn = hoverBtnIdx;
    var oldMkr = hoverMarkerIdx;
    hoverBtnIdx = toolbarHitTest(x, y, sz[0], sz[1]);
    hoverMarkerIdx = (y >= r.y && y <= r.y + r.h) ? findMarkerNearX(x, r) : -1;
    if (oldBtn !== hoverBtnIdx || oldMkr !== hoverMarkerIdx) {
        mgraphics.redraw();
    }
}

function onidleout() {
    hoverBtnIdx = -1;
    hoverMarkerIdx = -1;
    mgraphics.redraw();
}

// ============================================================================
// Vector Icon Drawing & Paint
// ============================================================================
function drawToolbarIcon(id, cx, cy) {
    mgraphics.set_line_width(1.3);
    if (id === "undo") {
        mgraphics.arc(cx + 1, cy + 1, 4.2, Math.PI * 1.15, Math.PI * 0.25);
        mgraphics.stroke();
        mgraphics.move_to(cx - 3.5, cy - 2.5);
        mgraphics.line_to(cx - 3.5, cy + 1.5);
        mgraphics.line_to(cx + 0.5, cy + 1.5);
        mgraphics.stroke();
    } else if (id === "redo") {
        mgraphics.arc(cx - 1, cy + 1, 4.2, Math.PI * 0.75, Math.PI * 1.85);
        mgraphics.stroke();
        mgraphics.move_to(cx + 3.5, cy - 2.5);
        mgraphics.line_to(cx + 3.5, cy + 1.5);
        mgraphics.line_to(cx - 0.5, cy + 1.5);
        mgraphics.stroke();
    } else if (id === "detect") {
        // Lightning / onset bolt icon
        mgraphics.move_to(cx + 1.0, cy - 5.0);
        mgraphics.line_to(cx - 3.0, cy + 0.5);
        mgraphics.line_to(cx + 0.5, cy + 0.5);
        mgraphics.line_to(cx - 1.0, cy + 5.0);
        mgraphics.line_to(cx + 3.0, cy - 0.5);
        mgraphics.line_to(cx - 0.5, cy - 0.5);
        mgraphics.close_path();
        mgraphics.stroke();
    } else if (id === "add") {
        // Plus marker
        mgraphics.move_to(cx, cy - 4.5);
        mgraphics.line_to(cx, cy + 4.5);
        mgraphics.move_to(cx - 4.5, cy);
        mgraphics.line_to(cx + 4.5, cy);
        mgraphics.stroke();
    } else if (id === "del") {
        // X marker
        mgraphics.move_to(cx - 3.8, cy - 3.8);
        mgraphics.line_to(cx + 3.8, cy + 3.8);
        mgraphics.move_to(cx + 3.8, cy - 3.8);
        mgraphics.line_to(cx - 3.8, cy + 3.8);
        mgraphics.stroke();
    } else if (id === "rand") {
        // Dice / scatter dots
        mgraphics.rectangle(cx - 4.5, cy - 4.5, 9, 9);
        mgraphics.stroke();
        mgraphics.arc(cx - 2.2, cy - 2.2, 0.9, 0, Math.PI * 2);
        mgraphics.fill();
        mgraphics.arc(cx + 2.2, cy + 2.2, 0.9, 0, Math.PI * 2);
        mgraphics.fill();
        mgraphics.arc(cx, cy, 0.9, 0, Math.PI * 2);
        mgraphics.fill();
    } else if (id === "rev") {
        // Left-pointing reverse triangle + bar
        mgraphics.move_to(cx + 3.5, cy - 4.0);
        mgraphics.line_to(cx - 2.5, cy);
        mgraphics.line_to(cx + 3.5, cy + 4.0);
        mgraphics.close_path();
        mgraphics.stroke();
        mgraphics.move_to(cx - 4.0, cy - 4.0);
        mgraphics.line_to(cx - 4.0, cy + 4.0);
        mgraphics.stroke();
    } else if (id === "keymode") {
        // Piano / grid icon
        mgraphics.rectangle(cx - 5.0, cy - 4.0, 10, 8);
        mgraphics.stroke();
        mgraphics.move_to(cx - 1.7, cy - 4.0);
        mgraphics.line_to(cx - 1.7, cy + 4.0);
        mgraphics.move_to(cx + 1.7, cy - 4.0);
        mgraphics.line_to(cx + 1.7, cy + 4.0);
        mgraphics.stroke();
    }
}

function paint() {
    var sz = canvasSize();
    var w = sz[0];
    var h = sz[1];
    var r = waveRect(w, h);

    // Outer dark canvas background
    mgraphics.set_source_rgba(0.06, 0.07, 0.09, 1.0);
    mgraphics.rectangle_rounded(0, 0, w, h, 5, 5);
    mgraphics.fill();

    // Top HUD strip (y = 0..19)
    mgraphics.set_source_rgba(0.10, 0.12, 0.15, 1.0);
    mgraphics.rectangle(2, 2, w - 4, 16);
    mgraphics.fill();

    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(9.0);

    var activeIdx = stateBuf ? uiState.activeSlice : selectedSlice;
    activeIdx = gsClamp(activeIdx, 0, Math.max(0, slices.length - 1));
    var curSlice = slices[activeIdx] || { startFrame: 0, endFrame: sampleFrames, transientFrames: 1024, pitchHz: 110 };
    var sliceHz = Math.round(curSlice.pitchHz || 110);

    if (hoverBtnIdx >= 0 && TOOLBAR_ITEMS[hoverBtnIdx]) {
        mgraphics.set_source_rgba(0.32, 0.86, 0.98, 1.0);
        mgraphics.move_to(8, 13);
        mgraphics.show_text(TOOLBAR_ITEMS[hoverBtnIdx].title);
    } else {
        mgraphics.set_source_rgba(0.86, 0.90, 0.95, 1.0);
        mgraphics.move_to(8, 13);
        mgraphics.show_text(sampleName + "  |  " + slices.length + " slices");
    }

    // Right side HUD: active slice + detected fundamental Hz + mode badge
    var modeStr = keyMode ? "CHROMA" : "128-MAP";
    var rightText = "#" + (activeIdx + 1) + "  " + sliceHz + " Hz  [" + modeStr + "]";
    mgraphics.set_source_rgba(0.95, 0.68, 0.28, 1.0);
    mgraphics.move_to(w - 138, 13);
    mgraphics.show_text(rightText);

    // Waveform plot background
    mgraphics.set_source_rgba(0.04, 0.05, 0.07, 1.0);
    mgraphics.rectangle(r.x, r.y, r.w, r.h);
    mgraphics.fill();

    // Selected/Active slice highlight & transient preservation punch zone
    if (slices.length > 0 && sampleFrames > 0) {
        var sX0 = r.x + (curSlice.startFrame / sampleFrames) * r.w;
        var sX1 = r.x + (curSlice.endFrame / sampleFrames) * r.w;
        var sW = Math.max(2, sX1 - sX0);

        // Cyan highlight for active slice body
        var bodyAlpha = 0.12 + (stateBuf ? uiState.outEnv * 0.22 : 0.08);
        mgraphics.set_source_rgba(0.20, 0.78, 0.95, bodyAlpha);
        mgraphics.rectangle(sX0, r.y + 1, sW, r.h - 2);
        mgraphics.fill();

        // Amber highlight at the start of the slice showing Transient Preservation zone
        var effTransFrames = Math.min(curSlice.endFrame - curSlice.startFrame, curSlice.transientFrames * transAmount * 1.35);
        var transW = Math.max(1.5, (effTransFrames / sampleFrames) * r.w);
        if (transAmount > 0.02) {
            mgraphics.set_source_rgba(0.98, 0.62, 0.18, 0.26);
            mgraphics.rectangle(sX0, r.y + 1, Math.min(sW, transW), r.h - 2);
            mgraphics.fill();
        }
    }

    // Center zero-line
    var midY = r.y + r.h * 0.5;
    mgraphics.set_source_rgba(0.18, 0.22, 0.27, 0.8);
    mgraphics.set_line_width(1.0);
    mgraphics.move_to(r.x, midY);
    mgraphics.line_to(r.x + r.w, midY);
    mgraphics.stroke();

    // Waveform bars
    var nBins = waveBins.length;
    if (nBins > 0) {
        var barStep = r.w / nBins;
        for (var b = 0; b < nBins; b++) {
            var bx = r.x + b * barStep;
            var bFrame = (b / nBins) * sampleFrames;
            var inActive = (bFrame >= curSlice.startFrame && bFrame < curSlice.endFrame);
            var amp = waveBins[b] * (r.h * 0.44);
            if (inActive) {
                // Blend cyan -> magenta/amber as Morph moves from Granular to Spectral
                var cr = 0.28 + morphAmount * 0.64;
                var cg = 0.84 - morphAmount * 0.22;
                var cb = 0.96 - morphAmount * 0.10;
                mgraphics.set_source_rgba(cr, cg, cb, 0.92);
            } else {
                mgraphics.set_source_rgba(0.36, 0.44, 0.52, 0.55);
            }
            mgraphics.set_line_width(Math.max(1.0, barStep * 0.72));
            mgraphics.move_to(bx, midY - Math.max(1, amp));
            mgraphics.line_to(bx, midY + Math.max(1, amp));
            mgraphics.stroke();
        }
    }

    // Slice boundary markers across all detected slices
    if (slices.length > 0 && sampleFrames > 0) {
        for (var m = 0; m < slices.length; m++) {
            var mx = r.x + (slices[m].startFrame / sampleFrames) * r.w;
            var isSel = (m === activeIdx);
            var isHov = (m === hoverMarkerIdx);
            if (isSel || isHov) {
                mgraphics.set_source_rgba(0.98, 0.68, 0.22, 0.95);
                mgraphics.set_line_width(1.5);
            } else {
                mgraphics.set_source_rgba(0.95, 0.55, 0.20, 0.42);
                mgraphics.set_line_width(1.0);
            }
            mgraphics.move_to(mx, r.y + 1);
            mgraphics.line_to(mx, r.y + r.h - 1);
            mgraphics.stroke();

            // Top flag triangle on slice marker
            mgraphics.move_to(mx, r.y + 1);
            mgraphics.line_to(mx + 4.5, r.y + 1);
            mgraphics.line_to(mx, r.y + 6);
            mgraphics.close_path();
            mgraphics.fill();
        }
    }

    // Audio-reactive grain cloud halos & playhead inside active slice
    var showReactive = stateBuf ? (uiState.voiceActive && uiState.outEnv > 0.002) : true;
    if (showReactive && slices.length > 0 && sampleFrames > 0) {
        var slStartNorm = curSlice.startFrame / sampleFrames;
        var slSpanNorm = Math.max(1, curSlice.endFrame - curSlice.startFrame) / sampleFrames;

        // 4 grain voices
        for (var g = 0; g < 4; g++) {
            var gEnv = stateBuf ? uiState.gEnv[g] : (0.35 + 0.15 * g);
            var vis = Math.min(1, Math.sqrt(Math.max(0, gEnv)) * 2.2);
            if (vis < 0.03) continue;
            var gx = r.x + (slStartNorm + uiState.gPos[g] * slSpanNorm) * r.w;
            var gy = r.y + (0.22 + g * 0.18) * r.h;
            var rad = 2.5 + vis * 8.5;

            // Outer grain halo
            mgraphics.set_source_rgba(0.28 + morphAmount * 0.65, 0.88 - morphAmount * 0.30, 0.98, 0.18 + vis * 0.32);
            mgraphics.arc(gx, gy, rad, 0, Math.PI * 2);
            mgraphics.fill();

            // Inner grain core
            mgraphics.set_source_rgba(0.92, 0.97, 1.0, 0.55 + vis * 0.45);
            mgraphics.arc(gx, gy, 1.6 + vis * 1.8, 0, Math.PI * 2);
            mgraphics.fill();
        }

        // Master slice scanning playhead
        var phX = r.x + (slStartNorm + uiState.playhead * slSpanNorm) * r.w;
        mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.92);
        mgraphics.set_line_width(1.6);
        mgraphics.move_to(phX, r.y + 1);
        mgraphics.line_to(phX, r.y + r.h - 1);
        mgraphics.stroke();
    }

    // Live capture write-head indicator when Capture is active
    if (captureActive) {
        var capX = r.x + uiState.capHead * r.w;
        mgraphics.set_source_rgba(0.98, 0.24, 0.28, 0.95);
        mgraphics.set_line_width(2.0);
        mgraphics.move_to(capX, r.y + 1);
        mgraphics.line_to(capX, r.y + r.h - 1);
        mgraphics.stroke();
    }

    // Waveform border
    mgraphics.set_source_rgba(0.20, 0.25, 0.32, 1.0);
    mgraphics.set_line_width(1.0);
    mgraphics.rectangle(r.x, r.y, r.w, r.h);
    mgraphics.stroke();

    // Bottom Vector Icon Toolbar (y = h - 21 .. h - 2)
    var barY = h - 20;
    var cellW = 24;
    var startX = 6;
    for (var t = 0; t < TOOLBAR_ITEMS.length; t++) {
        var item = TOOLBAR_ITEMS[t];
        var bx = startX + t * cellW;
        var toggled = (item.id === "rev" && reverseSlice) || (item.id === "keymode" && keyMode);
        var hovered = (t === hoverBtnIdx);

        if (toggled) {
            mgraphics.set_source_rgba(0.22, 0.62, 0.78, 0.85);
        } else if (hovered) {
            mgraphics.set_source_rgba(0.18, 0.22, 0.28, 1.0);
        } else {
            mgraphics.set_source_rgba(0.11, 0.13, 0.17, 1.0);
        }
        mgraphics.rectangle_rounded(bx, barY, cellW - 2, 17, 3, 3);
        mgraphics.fill();

        if (toggled || hovered) {
            mgraphics.set_source_rgba(0.95, 0.98, 1.0, 1.0);
        } else {
            mgraphics.set_source_rgba(0.68, 0.75, 0.82, 0.95);
        }
        drawToolbarIcon(item.id, bx + (cellW - 2) * 0.5, barY + 8.5);
    }

    // Right side status readout in bottom bar (x = 202..w-6): Granular <-> Spectral Morph & Output Meter
    var meterX = 204;
    var meterW = w - meterX - 8;
    mgraphics.set_source_rgba(0.10, 0.12, 0.16, 1.0);
    mgraphics.rectangle_rounded(meterX, barY, meterW, 17, 3, 3);
    mgraphics.fill();

    var outVis = stateBuf ? Math.min(1, Math.sqrt(Math.max(0, uiState.outEnv)) * 1.8) : 0.48;
    var fillW = Math.max(2, (meterW - 4) * outVis);
    mgraphics.set_source_rgba(0.24 + morphAmount * 0.66, 0.82 - morphAmount * 0.22, 0.95, 0.55);
    mgraphics.rectangle_rounded(meterX + 2, barY + 2, fillW, 13, 2, 2);
    mgraphics.fill();

    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(8.5);
    mgraphics.set_source_rgba(0.90, 0.94, 0.98, 0.95);
    var morphPct = Math.round(morphAmount * 100);
    var tag = morphPct < 20 ? "GRANULAR" : (morphPct > 80 ? "SPECTRAL" : ("G/S " + morphPct + "%"));
    if (reverseSlice) tag += " REV";
    mgraphics.move_to(meterX + 6, barY + 11.5);
    mgraphics.show_text(tag + "   Click/Dbl-Click Slice");
}
