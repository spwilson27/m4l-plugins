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

var WAVE_BINS = 360;
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

var curRootNote = 60;
var curPolyVoices = 8;
var curMonoLegato = 0;
var curFiltOn = 1;
var curFiltCutoff = 18000.0;

// Every parameter value in display units, keyed like FACE_PARAMS (filled by the set_<key> echoes)
var paramVals = {};
var curSliced = 0;        // 0 = Single (start / loop points), 1 = Sliced (each key plays a slice)
var curSliceFrom = 36;    // key that plays the first slice (C1)
var sliceMono = null;     // mono copy of the sample for the onset / pitch slicers
var sampleRateHz = 44100;
var showInspector = 0;
var curFaceTheme = 0;     // 0 = Bitwig look (default), 1 = Ableton look (src/sampler_theme_ableton.js)
var DEVICE_W = 600;
var INSPECTOR_W = 160;

// Slice markers (normalized 0..1)
var sliceMarkers = [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
var sliceSensitivity = 0.65;
var selectedSliceIdx = 0;

// Bottom-right envelope panel page: 0 = AMP, 1 = MOD, 2 = LFO, 3 = UNI
var envPage = 0;

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
// Per-voice envelope / filter telemetry (#0-bsscope 128..207, see AGENTS.md section 14): stage + fraction encoded as
// stage + frac (0 off, 1 attack, 2 decay, 3 sustain, 4 release), level 0..1, effective cutoff in Hz (0 = voice idle)
var voiceAmpStg = new Array(16);
var voiceAmpLvl = new Array(16);
var voiceModStg = new Array(16);
var voiceModLvl = new Array(16);
var voiceCutHz = new Array(16);
for (var vj = 0; vj < 16; vj++) {
    voiceAmpStg[vj] = 0; voiceAmpLvl[vj] = 0; voiceModStg[vj] = 0; voiceModLvl[vj] = 0; voiceCutHz[vj] = 0;
}

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
    paramVals.mode = curMode;
    outlet(0, "param", "mode", curMode);
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
        // The gen reads these slots on the audio thread while we write. A single poke goes slot by slot, so the
        // trigger counter (slot 3) would land before the slice bounds (4, 5) and a note-on could start on the
        // voice's previous slice. Write the bounds first, then the whole voice.
        b.poke(1, base + 4, [v.sliceStart, v.sliceEnd, v.panSeed, v.rndSeed]);
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

// Load trace in Global("better_sampler_trace").text (newest last), so the Ableton MCP bridge can read
// what a drop actually did inside Live: `return new Global("better_sampler_trace").text;`
var loadTrace = null;
try { if (typeof Global !== "undefined") loadTrace = new Global("better_sampler_trace"); } catch (_) {}

// Each line starts with "+<ms>" since this script was loaded (device load), so the bridge can time the load
var traceT0 = Date.now();

function trace(event, detail) {
    if (!loadTrace) return;
    try {
        var lines = String(loadTrace.text || "").split("\n").filter(function (l) { return l.length > 0; });
        lines.push("+" + (Date.now() - traceT0) + "ms " + event + " " + (detail === undefined ? "" : String(detail)));
        loadTrace.text = lines.slice(-40).join("\n");
    } catch (_) {}
}

// Last waveform-refresh failure, also posted to the Max console (a swallowed error once hid mono loads)
var lastLoadError = "";

function peakOf(data) {
    if (typeof data === "number") return Math.abs(data);
    var pk = 0.0;
    if (data && data.length) {
        for (var k = 0; k < data.length; k++) {
            var a = Math.abs(data[k]);
            if (a > pk) pk = a;
        }
    }
    return pk;
}

// The loaded file's sample rate in Hz from the buffer (frames / length in ms), snapped to the usual rates; 0 = unknown
var COMMON_SAMPLE_RATES = [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400, 192000];
function bufferSampleRate(b, frames) {
    try {
        var ms = (typeof b.length === "function") ? Number(b.length()) : 0;
        if (!(ms > 0) || !(frames > 0)) return 0;
        var raw = frames / (ms / 1000);
        for (var i = 0; i < COMMON_SAMPLE_RATES.length; i++) {
            if (Math.abs(raw / COMMON_SAMPLE_RATES[i] - 1) < 0.003) return COMMON_SAMPLE_RATES[i];
        }
        return (raw >= 1000 && raw <= 400000) ? Math.round(raw) : 0;
    } catch (_) {
        return 0;
    }
}

// File rate to the gen (0 = unknown: it plays at the DSP rate). Re-sent with every dsp_ready, because a gen that is
// still compiling drops messages.
var lastFileRate = 0;
function sendSampleRate(rate) {
    if (rate !== undefined) lastFileRate = rate;
    if (faceRegion === "main") outlet(0, "samp_rate", lastFileRate);
}

function refreshWaveformFromBuffer() {
    if (!sampBufName || typeof Buffer === "undefined") return;
    try {
        var b = new Buffer(sampBufName);
        var frames = (typeof b.framecount === "function") ? b.framecount() : 0;
        if (!frames || frames <= 4) {
            trace("refresh", sampBufName + " empty frames=" + frames);
            return;
        }
        // `replace` resizes the buffer to the file's channel count, so a mono file leaves 1 channel
        var chans = (typeof b.channelcount === "function") ? Math.max(1, b.channelcount()) : 2;
        sampleFrames = frames;
        // The file's own rate (buffer~ takes it from the file): readouts and the slicers use it, the gen gets it as
        // `samp_rate` and scales every read step by file rate / DSP rate (see sendSampleRate).
        var fileRate = bufferSampleRate(b, frames);
        sampleRateHz = fileRate > 0 ? fileRate : 44100;
        sampleDurationMs = Math.round(frames / sampleRateHz * 1000);
        sendSampleRate(fileRate);
        var step = Math.max(1, Math.floor(frames / WAVE_BINS));
        var readLen = Math.min(step, 4096);
        var maxEnergy = 0.0;

        for (var i = 0; i < WAVE_BINS; i++) {
            var startIdx = Math.min(frames - 1, i * step);
            var len = Math.max(1, Math.min(readLen, frames - startIdx));
            var pkL = peakOf(b.peek(1, startIdx, len));
            var pkR = chans > 1 ? peakOf(b.peek(2, startIdx, len)) : pkL;
            wavePeaksL[i] = Math.min(1.0, pkL);
            wavePeaksR[i] = Math.min(1.0, pkR);
            maxEnergy = Math.max(maxEnergy, pkL, pkR);
        }

        hasLoadedSample = maxEnergy > 0.0005 ? 1 : 0;
        lastLoadError = "";
        trace("refresh", sampBufName + " frames=" + frames + " chans=" + chans + " peak=" + maxEnergy.toFixed(4) + " loaded=" + hasLoadedSample);
        if (hasLoadedSample) {
            var midFrame = Math.min(Math.floor(frames * 0.15), Math.max(0, frames - 2048));
            var winLen = Math.min(2048, frames - midFrame);
            if (winLen >= 256) {
                var monoWin = b.peek(1, midFrame, winLen);
                if (monoWin && monoWin.length >= 256) {
                    detectedRootMidi = estimateRootMidiNote(monoWin, sampleRateHz);
                }
            }
            // The slicers' mono copy is built only when Onsets / Pitches need it (see requestSliceMono)
            cancelSliceMono();
            pitchCurve = null;
            pitchVoiced = null;
            if (rootDyn) ensurePitchCurve();
            if (restoredSlices) {
                sliceMarkers = restoredSlices;
                restoredSlices = null;
            } else {
                recomputeSlices();
            }
        }
    } catch (err) {
        lastLoadError = String(err);
        trace("refresh-error", lastLoadError);
        if (typeof post === "function") post("Better Sampler: waveform refresh failed: " + lastLoadError + "\n");
    }
}

// ---------------------------------------------------------------------------
// Analyzed Root Key (root_dyn): the sample's pitch at 4096 evenly spaced positions, tracked once per
// sample on the lazy mono copy and written to #0-bspitch, which the gen reads as the root at the
// playhead. The face draws it as the orange curve over the waveform.
// ---------------------------------------------------------------------------
var PITCH_POINTS = 4096;
var pitchBufName = "";
var rootDyn = 0;
var pitchCurve = null;    // Float32Array(PITCH_POINTS) of MIDI pitch, or null until analysed
var pitchVoiced = null;   // Uint8Array(PITCH_POINTS): 1 where the pitch is confident

function ensurePitchCurve() {
    if (!hasLoadedSample || pitchCurve) return;
    if (sliceMono) computePitchCurve();
    else requestSliceMono();
}

function computePitchCurve() {
    if (!sliceMono || typeof trackPitchCurve !== "function") return;
    try {
        var r = trackPitchCurve(sliceMono, sampleRateHz, PITCH_POINTS, curRootNote);
        pitchCurve = r.curve;
        pitchVoiced = r.voiced;
        trace("pitch-curve", "voiced=" + (r.voicedRatio === undefined ? "?" : Number(r.voicedRatio).toFixed(2)));
        writePitchCurve();
    } catch (err) {
        trace("pitch-error", String(err));
    }
    mgraphics.redraw();
}

function writePitchCurve() {
    if (!pitchCurve || !pitchBufName || typeof Buffer === "undefined") return;
    try {
        new Buffer(pitchBufName).poke(1, 0, Array.prototype.slice.call(pitchCurve));
    } catch (_) {}
}

// Mono downmix for the onset / pitch slicers (capped at 10 minutes). Built lazily, in chunks on a
// Task, so loading a sample stays light and a long file never blocks the UI.
var SLICE_MONO_CHUNK = 262144;
var sliceMonoJob = null;   // { mono, n, chans, pos, task } while the copy is in progress

function cancelSliceMono() {
    if (sliceMonoJob && sliceMonoJob.task && typeof sliceMonoJob.task.cancel === "function") sliceMonoJob.task.cancel();
    sliceMonoJob = null;
    sliceMono = null;
}

function sliceMonoStep() {
    var job = sliceMonoJob;
    if (!job) return true;
    try {
        var b = new Buffer(sampBufName);
        var len = Math.min(SLICE_MONO_CHUNK, job.n - job.pos);
        var l = b.peek(1, job.pos, len);
        var r = job.chans > 1 ? b.peek(2, job.pos, len) : null;
        for (var i = 0; i < len; i++) job.mono[job.pos + i] = r ? 0.5 * (l[i] + r[i]) : l[i];
        job.pos += len;
    } catch (_) {
        sliceMonoJob = null;
        return true;
    }
    if (job.pos < job.n) return false;
    sliceMono = job.mono;
    sliceMonoJob = null;
    recomputeSlices();
    if (rootDyn && !pitchCurve) computePitchCurve();
    return true;
}

function requestSliceMono() {
    if (sliceMono || sliceMonoJob || !sampBufName || !hasLoadedSample || typeof Buffer === "undefined") return;
    var chans = 1;
    try {
        var b = new Buffer(sampBufName);
        chans = (typeof b.channelcount === "function") ? Math.max(1, b.channelcount()) : 2;
    } catch (_) {}
    var n = Math.min(sampleFrames, 48000 * 600);
    if (n <= 0) return;
    sliceMonoJob = { mono: new Float32Array(n), n: n, chans: chans, pos: 0, task: null };
    if (typeof Task === "undefined") {
        while (!sliceMonoStep()) {}
        return;
    }
    var job = sliceMonoJob;
    job.task = new Task(function () {
        if (sliceMonoJob !== job) return;
        if (!sliceMonoStep()) job.task.schedule(1);
        mgraphics.redraw();
    });
    job.task.schedule(1);
}

function liveTempo() {
    try {
        if (typeof LiveAPI !== "undefined") {
            var t = Number(new LiveAPI("live_set").get("tempo"));
            if (t > 20) return t;
        }
    } catch (_) {}
    return 120;
}

// Slice markers from the "Slice at" mode; Manual keeps the user's markers
function recomputeSlices() {
    var at = Math.round(paramValue("slice_at"));
    var next = null;
    if (at === 0 && typeof sliceDivisions === "function") {
        next = sliceDivisions(curStart, curEnd, Math.round(paramValue("slice_div")));
    } else if (at === 1 && typeof sliceBeats === "function") {
        var bpm = (typeof bpmFromName === "function" ? bpmFromName(sampleFileName) : 0) || liveTempo();
        next = sliceBeats(curStart, curEnd, sampleFrames, sampleRateHz, bpm, Math.round(paramValue("slice_beat")));
    } else if ((at === 2 || at === 3) && !sliceMono && hasLoadedSample) {
        // Analysis needs the mono copy: start it and slice when it lands (markers stay as they are)
        requestSliceMono();
    } else if (at === 2 && sliceMono && typeof sliceOnsets === "function") {
        next = sliceOnsets(sliceMono, sampleRateHz, paramValue("slice_sens") * 0.01, 0, 1);
    } else if (at === 3 && sliceMono && typeof slicePitches === "function") {
        next = slicePitches(sliceMono, sampleRateHz, paramValue("slice_sens") * 0.01, 0, 1);
    } else if (at === 2 || at === 3) {
        next = detectTransientSlices(wavePeaksL, paramValue("slice_sens") * 0.01, 32);
    }
    if (next) {
        sliceMarkers = next;
        refreshHeldSlices();
        notifyclients();
    }
    mgraphics.redraw();
}

var GRAIN_SLOTS = 32;
var grainPos = [];
var grainAmp = [];
for (var gi0 = 0; gi0 < GRAIN_SLOTS; gi0++) { grainPos.push(-1); grainAmp.push(0); }

function pollTelemetryScope() {
    if (!scopeBufName || typeof Buffer === "undefined") return;
    try {
        var sb = new Buffer(scopeBufName);
        var data = sb.peek(1, 0, 128);
        if (!data || data.length < 40) return;
        // Grains (Textures / Fragments): read position 64..95 (-1 = unused), level 96..127
        for (var g = 0; g < GRAIN_SLOTS; g++) {
            grainPos[g] = data.length >= 128 ? data[64 + g] : -1;
            grainAmp[g] = data.length >= 128 ? data[96 + g] : 0;
        }
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
    try {
        var sb2 = new Buffer(scopeBufName);
        var tvd = sb2.peek(1, 128, 80);            // per-voice envelope / filter slots 128..207
        var hasTv = !!tvd && tvd.length >= 80;
        for (var tv = 0; tv < 16; tv++) {
            voiceAmpStg[tv] = hasTv ? tvd[tv] : 0;
            voiceAmpLvl[tv] = hasTv ? tvd[16 + tv] : 0;
            voiceModStg[tv] = hasTv ? tvd[32 + tv] : 0;
            voiceModLvl[tv] = hasTv ? tvd[48 + tv] : 0;
            voiceCutHz[tv] = hasTv ? tvd[64 + tv] : 0;
        }
    } catch (_) {}
}

var scopeTask = (typeof Task !== "undefined") ? new Task(function() {
    pollTelemetryScope();
    mgraphics.redraw();
    if (scopeTask) scopeTask.schedule(45);
}) : null;

function setbuffers(sName, vName, scName, pName) {
    trace("setbuffers", sName + " " + vName + " " + scName + " " + pName);
    sampBufName = String(sName || "");
    voicesBufName = String(vName || "");
    scopeBufName = String(scName || "");
    pitchBufName = String(pName || "");
    syncAllVoicesToBuffer();
    refreshWaveformFromBuffer();
    if (restorePath && !hasLoadedSample) outlet(0, "load_sample", restorePath);
    if (scopeTask) scopeTask.schedule(45);
    mgraphics.redraw();
}

function sample_loaded(fPath) {
    trace("sample_loaded", Array.prototype.slice.call(arguments).join(" | ") + " (args=" + arguments.length + ")");
    // buffer~ also reports a finished load as "sample_loaded bang"; only a real path renames the sample
    if (fPath !== undefined && String(fPath).length > 0 && String(fPath) !== "bang") {
        sampleFilePath = String(fPath);
        var parts = sampleFilePath.replace(/\\/g, "/").split("/");
        sampleFileName = parts[parts.length - 1] || sampleFilePath;
    }
    restorePath = "";
    refreshWaveformFromBuffer();
    notifyclients();
    mgraphics.redraw();
}

function pathFromArgs(args) {
    // A path with spaces can arrive split into several atoms
    return Array.prototype.slice.call(args).map(String).join(" ").trim();
}

function loadSamplePath(p) {
    sampleFilePath = p;
    var parts = p.replace(/\\/g, "/").split("/");
    sampleFileName = parts[parts.length - 1] || p;
    restorePath = "";
    restoredSlices = null;
    outlet(0, "load_sample", p);
    notifyclients();
    mgraphics.redraw();
}

// From the waveform live.drop (Live also replays its saved path when the Set loads)
function dropfile() {
    var p = pathFromArgs(arguments);
    trace("dropfile", p);
    // An empty live.drop reports "none" when the device loads
    if (!p || p === "none") return;
    // Replay of the sample SamplerStateData is already restoring, or already loaded: nothing to do
    if (p === sampleFilePath && (restorePath || hasLoadedSample)) return;
    loadSamplePath(p);
}

// From the file dialog (click the file name or LOAD)
function browsed() {
    var p = pathFromArgs(arguments);
    trace("browsed", p);
    if (!p) return;
    loadSamplePath(p);
    outlet(0, "drop_set", p);
}

// Slices mapped from C1: the first starts at the sample start point
function currentSliceStarts() {
    return activeSliceStarts(sliceMarkers, curStart, curEnd);
}

// Divisions and Beats are laid out from the start point, so they move with it
function regionMovedSlices() {
    var at = Math.round(paramValue("slice_at"));
    if (curSliced && (at === 0 || at === 1)) {
        var keep = sliceMarkers;
        recomputeSlices();
        if (!sliceMarkers) sliceMarkers = keep;
    } else {
        refreshHeldSlices();
    }
}

// Device width: 600 px, plus the inspector panel when it is shown
function applyDeviceWidth() {
    outlet(0, "setwidth_cmd", DEVICE_W + (showInspector ? INSPECTOR_W : 0));
}

// The Spectral engine renders voices 0..3 only (phase-vocoder CPU budget), so cap polyphony there
var SPECTRAL_MAX_VOICES = 4;
function voiceCap() {
    return curMode === 3 ? Math.min(curPolyVoices, SPECTRAL_MAX_VOICES) : curPolyVoices;
}

// Live's tempo for Fragments beat-synced grains (gen `tempo`) and Beats slicing
var tempoObserver = null;
function sendTempo(t) {
    var v = Number(t);
    if (v > 20) outlet(0, "tempo", v);
}

// ---------------------------------------------------------------------------
// Deferred DSP: the device ships without its gen~ so the GUI appears at once. Right after load the
// main face writes the embedded gen patch to a .gendsp file (named by its hash, so it is written once)
// and creates `gen~ @gen <file>`, wired to the bs_genin hub and plugin~ / plugout~. Then dsp_ready
// re-sends the buffer binding and every parameter value.
// ---------------------------------------------------------------------------
var hostPatcher = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var dspReady = 0;
var dspError = "";
var dspTask = null;

function dspFilePath() {
    return "/tmp/better_sampler_core_" + GEN_DSP_HASH + ".gendsp";
}

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

function loadDsp() {
    if (dspReady || dspCreatedAt || faceRegion !== "main" || typeof GEN_DSP_TEXT === "undefined" || !hostPatcher) return;
    trace("dsp-start", "creating gen~");
    try {
        var g = hostPatcher.getnamed("obj-gen");
        if (!g) {
            var path = dspFilePath();
            if (!writeDspFile(path)) throw new Error("no file");
            g = hostPatcher.newdefault(30, 435, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "obj-gen";
            var hub = hostPatcher.getnamed("bs_genin");
            var pin = hostPatcher.getnamed("bs_plugin");
            var pout = hostPatcher.getnamed("bs_plugout");
            if (hub) hostPatcher.connect(hub, 0, g, 0);
            if (pin) { hostPatcher.connect(pin, 0, g, 0); hostPatcher.connect(pin, 1, g, 1); }
            if (pout) { hostPatcher.connect(g, 0, pout, 0); hostPatcher.connect(g, 1, pout, 1); }
        }
        // The gen keeps compiling after creation and drops messages until it runs, so re-send the
        // buffer binding and parameters until its telemetry frame counter moves (dspConfirm)
        dspCreatedAt = Date.now();
        dspCounter0 = scopeFrameCounter();
        dspConfirm();
    } catch (err) {
        dspError = String(err && err.message ? err.message : err);
        trace("dsp-error", dspError);
        if (typeof post === "function") post("Better Sampler: DSP load failed: " + dspError + "\n");
    }
    mgraphics.redraw();
}

// Diagnostics, reachable from the Ableton MCP bridge with messnamed("#0-bsdebug", "dsp_diag")
// (#0 is not substituted in a top-level device); results land in the load trace
function dsp_diag() {
    var info = ["ready=" + dspReady, "err=" + dspError, "createdAt=" + dspCreatedAt, "counter=" + scopeFrameCounter(), "scope=" + scopeBufName];
    try {
        var g = hostPatcher ? hostPatcher.getnamed("obj-gen") : null;
        info.push("gen=" + (g ? g.maxclass : "none"));
        if (g) {
            try { info.push("genattr=" + String(g.getattr("gen"))); } catch (e1) { info.push("genattrErr=" + e1); }
            try {
                var pc = g.patchcords;
                info.push("cordsIn=" + (pc && pc.inputs ? pc.inputs.length : "?") + " cordsOut=" + (pc && pc.outputs ? pc.outputs.length : "?"));
            } catch (e2) { info.push("cordsErr=" + e2); }
        }
        info.push("hub=" + (hostPatcher && hostPatcher.getnamed("bs_genin") ? 1 : 0) + " in=" + (hostPatcher && hostPatcher.getnamed("bs_plugin") ? 1 : 0) + " out=" + (hostPatcher && hostPatcher.getnamed("bs_plugout") ? 1 : 0));
    } catch (e) { info.push("diagErr=" + e); }
    trace("dsp-diag", info.join(" "));
}

// Test entry points (messnamed("#0-bsdebug", ...), see scripts/test_sampler_live.js). dbg_param drives a parameter
// the way a click on the face does (face -> route -> hidden live.* -> prepend -> hub -> gen); dbg_state dumps what
// the face and the voice allocator hold into the load trace.
function dbg_param(key, v) {
    if (faceRegion === "main" && typeof setParamFromFace === "function") setParamFromFace(String(key), Number(v));
}

function dbg_state() {
    var vs = [];
    for (var i = 0; i < 16; i++) {
        var vo = voiceAlloc.voices[i];
        if (vo.gate > 0) vs.push(i + ":" + vo.note + "@" + vo.sliceStart.toFixed(3) + "-" + vo.sliceEnd.toFixed(3) + "#" + vo.trigCount);
    }
    var starts = currentSliceStarts().map(function (x) { return x.toFixed(3); });
    trace("dbg-state", "sliced=" + curSliced + " loop=" + curLoopMode + " from=" + curSliceFrom + " base=" + voiceAlloc.getSliceBaseNote() +
        " starts=" + starts.join("/") + " voices=" + vs.join(","));
}

// Telemetry recorder for the bridge: dbg_record <ms> samples #0-bsscope every 15 ms into Global("better_sampler_rec").text
// as "ms,voice,playhead,amp,peakL,active" rows (voice = the loudest one, -1 when none sounds).
var recTask = null;
var recRows = [];
var recT0 = 0;
var recUntil = 0;

function recTick() {
    try {
        var ch = new Buffer(scopeBufName).peek(1, 0, 49);
        var best = -1;
        var bestA = 0.002;
        for (var i = 0; i < 16; i++) if (ch[16 + i] > bestA) { bestA = ch[16 + i]; best = i; }
        recRows.push((Date.now() - recT0) + "," + best + "," + (best >= 0 ? ch[best].toFixed(4) : "-1") + "," + bestA.toFixed(3) + "," + ch[32].toFixed(3) + "," + ch[34]);
    } catch (_) {}
    if (Date.now() < recUntil && recTask) recTask.schedule(15);
    else new Global("better_sampler_rec").text = recRows.join(";");
}

function dbg_record(durMs) {
    if (faceRegion !== "main" || typeof Task === "undefined") return;
    recRows = [];
    recT0 = Date.now();
    recUntil = recT0 + Number(durMs);
    new Global("better_sampler_rec").text = "";
    if (!recTask) recTask = new Task(recTick);
    recTick();
}

function dsp_retry() {
    try {
        var g = hostPatcher ? hostPatcher.getnamed("obj-gen") : null;
        if (g) hostPatcher.remove(g);
    } catch (_) {}
    dspReady = 0; dspError = ""; dspCreatedAt = 0; dspCounter0 = -1;
    loadDsp();
}

var dspCreatedAt = 0;
var dspCounter0 = -1;
var dspConfirmTask = null;
var dspSettleTask = null;
var DSP_SETTLE_MS = 300;
var DSP_CONFIRM_MS = 150;
var DSP_TIMEOUT_MS = 10000;

function scopeFrameCounter() {
    if (!scopeBufName || typeof Buffer === "undefined") return -1;
    try {
        var v = new Buffer(scopeBufName).peek(1, 39, 1);
        return (typeof v === "number") ? v : (v && v.length ? v[0] : -1);
    } catch (_) {
        return -1;
    }
}

function dspConfirm() {
    var c = scopeFrameCounter();
    if (dspCounter0 >= 0 && c >= 0 && c !== dspCounter0) {
        dspReady = 1;
        dspError = "";
        trace("dsp", "ready after " + (Date.now() - dspCreatedAt) + " ms");
        // The last re-send went out while the gen was still compiling and was dropped; send every parameter once more
        // now that it runs, and once again after it has settled.
        sendSampleRate();
        outlet(0, "dsp_ready", "bang");
        if (typeof Task !== "undefined") {
            if (!dspSettleTask) dspSettleTask = new Task(function () { sendSampleRate(); outlet(0, "dsp_ready", "bang"); });
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
    sendSampleRate();
    outlet(0, "dsp_ready", "bang");
    if (dspCounter0 < 0) dspCounter0 = c;
    if (typeof Task === "undefined") return;
    if (!dspConfirmTask) dspConfirmTask = new Task(dspConfirm);
    dspConfirmTask.schedule(DSP_CONFIRM_MS);
}

function device_ready() {
    applyDeviceWidth();
    if (typeof abApplyLayout === "function") abApplyLayout();
    // Let the GUI paint first, then build the DSP
    if (faceRegion === "main" && !dspReady && typeof Task !== "undefined") {
        if (!dspTask) dspTask = new Task(loadDsp);
        dspTask.schedule(30);
    }
    if (faceRegion !== "main" || tempoObserver || typeof LiveAPI === "undefined") return;
    try {
        tempoObserver = new LiveAPI(function (args) {
            if (args && args[0] === "tempo") sendTempo(args[1]);
        }, "live_set");
        tempoObserver.property = "tempo";
        sendTempo(tempoObserver.get("tempo"));
    } catch (_) {
        tempoObserver = null;
    }
}

// Held Sliced-mode notes follow the start / end point live
function refreshHeldSlices() {
    if (!curSliced) return;
    var touched = voiceAlloc.updateSliceBounds(currentSliceStarts(), curEnd);
    for (var i = 0; i < touched.length; i++) writeVoiceToBuffer(touched[i]);
}

// Sliced keymap: slice k on key slice_from + k, nothing outside it
function sliceKeyMapped(n, count) {
    return n >= curSliceFrom && n < curSliceFrom + count;
}

// MIDI note handling from midiparse or test messages
function midi_note(note, vel) {
    var n = Math.round(Number(note) || 60);
    var v = Math.round(Number(vel) || 0);
    voiceAlloc.setMaxVoices(voiceCap());
    if (v > 0) {
        var starts = currentSliceStarts();
        if (curSliced && !sliceKeyMapped(n, starts.length)) {
            // Sliced: keys below the first slice key or past the last slice play nothing
            trace("unmapped", n);
            return;
        }
        var allocated = voiceAlloc.noteOn(n, v, curMonoLegato, starts, curEnd);
        writeVoiceToBuffer(allocated);
        if (curSliced) selectedSliceIdx = n - curSliceFrom;
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
    regionMovedSlices();
    var vals = [
        ["samp_start", Math.round(curStart * 1000) / 10],
        ["samp_end", Math.round(curEnd * 1000) / 10],
        ["loop_start", Math.round(curLoopStart * 1000) / 10],
        ["loop_end", Math.round(curLoopEnd * 1000) / 10],
        ["loop_xfade", Math.round((curXfade / 0.45) * 1000) / 10],
        ["play_pos", Math.round(curPlayPos * 1000) / 10]
    ];
    for (var i = 0; i < vals.length; i++) {
        expectEcho(vals[i][0], vals[i][1]);
        outlet(0, "param", vals[i][0], vals[i][1]);
    }
}

function clampInt(n, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(n))); }
function clampF(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function paramValue(key) {
    if (Object.prototype.hasOwnProperty.call(paramVals, key)) return paramVals[key];
    var p = (typeof FACE_PARAMS !== "undefined") ? FACE_PARAMS[key] : null;
    return p ? p.init : 0;
}

// Values the face sent to Live that have not echoed back yet, per key (oldest first). Live can echo
// a gesture's values late; an echo older than the newest value we sent must not drag state back.
var echoPending = {};

function expectEcho(key, v) {
    var q = echoPending[key] || (echoPending[key] = []);
    q.push(Number(v));
    if (q.length > 64) q.shift();
}

// true when this echo is a stale copy of something we already superseded
function isStaleEcho(key, n) {
    var q = echoPending[key];
    if (!q || q.length === 0) return false;
    for (var i = 0; i < q.length; i++) {
        if (Math.abs(q[i] - n) <= 1e-4 * Math.max(1, Math.abs(n))) {
            q.splice(0, i + 1);
            return q.length > 0;
        }
    }
    return false;  // not ours: automation or another control, apply it
}

// Single entry point for live.* echoes and face edits; mirrors the values the voice logic needs
function storeParam(key, v, fromFace) {
    var n = Number(v);
    if (!isFinite(n)) return;
    if (!fromFace && isStaleEcho(key, n)) return;
    paramVals[key] = n;
    switch (key) {
        case "mode": curMode = clampInt(n, 0, 4); voiceAlloc.setMaxVoices(voiceCap()); break;
        case "sliced": curSliced = n > 0.5 ? 1 : 0; refreshHeldSlices(); break;
        case "slice_from":
            curSliceFrom = clampInt(n, 0, 127);
            if (typeof voiceAlloc.setSliceBaseNote === "function") voiceAlloc.setSliceBaseNote(curSliceFrom);
            refreshHeldSlices();
            break;
        case "slice_at": case "slice_div": case "slice_beat": case "slice_sens": recomputeSlices(); break;
        case "env_page": envPage = clampInt(n, 0, 3); break;
        case "face_theme": curFaceTheme = (n > 0.5 && typeof FACE_PARAMS !== "undefined" && FACE_PARAMS.face_theme) ? 1 : 0; break;
        case "show_inspector": showInspector = n > 0.5 ? 1 : 0; applyDeviceWidth(); break;
        case "root_dyn": rootDyn = n > 0.5 ? 1 : 0; if (rootDyn) ensurePitchCurve(); break;
        case "freeze": curFreeze = n > 0.5 ? 1 : 0; break;
        case "reverse": curReverse = n > 0.5 ? 1 : 0; break;
        case "loop_mode": curLoopMode = clampInt(n, 0, 2); break;
        case "samp_start": curStart = clampF(n * 0.01, 0.0, 0.98); regionMovedSlices(); break;
        case "samp_end": curEnd = clampF(n * 0.01, curStart + 0.01, 1.0); regionMovedSlices(); break;
        case "loop_start": curLoopStart = clampF(n * 0.01, 0.0, 0.98); break;
        case "loop_end": curLoopEnd = clampF(n * 0.01, curLoopStart + 0.01, 1.0); break;
        case "loop_xfade": curXfade = clampF(n * 0.0045, 0.0, 0.45); break;
        case "play_pos": curPlayPos = clampF(n * 0.01, 0.0, 1.0); break;
        case "root_note": curRootNote = clampInt(n, 0, 127); break;
        case "poly_voices": curPolyVoices = clampInt(n, 1, 16); voiceAlloc.setMaxVoices(voiceCap()); break;
        case "mono_legato": curMonoLegato = n > 0.5 ? 1 : 0; break;
        case "filt_on": curFiltOn = n > 0.5 ? 1 : 0; break;
        case "filt_cutoff": curFiltCutoff = n; break;
    }
    if (typeof abOnParam === "function") abOnParam(key);
    mgraphics.redraw();
}

// Parameter setters from the hidden live.* widgets
function set_mode(v) { storeParam("mode", v); }
function set_freeze(v) { storeParam("freeze", v); }
function set_reverse(v) { storeParam("reverse", v); }
function set_loop_mode(v) { storeParam("loop_mode", v); }
function set_slice_play(v) { storeParam("slice_play", v); }
function set_root_dyn(v) { storeParam("root_dyn", v); }
function set_rp_dist(v) { storeParam("rp_dist", v); }
function set_rp_color(v) { storeParam("rp_color", v); }
function set_sp_shift(v) { storeParam("sp_shift", v); }
function set_sp_bend(v) { storeParam("sp_bend", v); }
function set_sp_quant_amt(v) { storeParam("sp_quant_amt", v); }
function set_sp_dispersion(v) { storeParam("sp_dispersion", v); }
function set_cy_width(v) { storeParam("cy_width", v); }
function set_cy_split(v) { storeParam("cy_split", v); }
function set_cy_fund(v) { storeParam("cy_fund", v); }
function set_cy_mod(v) { storeParam("cy_mod", v); }
function set_cy_harm(v) { storeParam("cy_harm", v); }
function set_fr_env(v) { storeParam("fr_env", v); }
function set_fr_repeats(v) { storeParam("fr_repeats", v); }
function set_fr_density(v) { storeParam("fr_density", v); }
function set_fr_motion(v) { storeParam("fr_motion", v); }
function set_fr_max_grains(v) { storeParam("fr_max_grains", v); }
function set_slice_div(v) { storeParam("slice_div", v); }
function set_slice_sens(v) { storeParam("slice_sens", v); }
function set_slice_from(v) { storeParam("slice_from", v); }
function set_sliced(v) { storeParam("sliced", v); }
function set_rp_char(v) { storeParam("rp_char", v); }
function set_rp_vsr(v) { storeParam("rp_vsr", v); }
function set_rp_imaging(v) { storeParam("rp_imaging", v); }
function set_sp_char(v) { storeParam("sp_char", v); }
function set_sp_quant(v) { storeParam("sp_quant", v); }
function set_sp_onsets(v) { storeParam("sp_onsets", v); }
function set_sp_formant_on(v) { storeParam("sp_formant_on", v); }
function set_sp_quality(v) { storeParam("sp_quality", v); }
function set_sp_live(v) { storeParam("sp_live", v); }
function set_sp_rel_formant(v) { storeParam("sp_rel_formant", v); }
function set_sp_key(v) { storeParam("sp_key", v); }
function set_sp_scale(v) { storeParam("sp_scale", v); }
function set_cy_char(v) { storeParam("cy_char", v); }
function set_cy_xfade(v) { storeParam("cy_xfade", v); }
function set_fr_sync(v) { storeParam("fr_sync", v); }
function set_fr_use_density(v) { storeParam("fr_use_density", v); }
function set_fr_direction(v) { storeParam("fr_direction", v); }
function set_fr_latch(v) { storeParam("fr_latch", v); }
function set_fr_repeat_init(v) { storeParam("fr_repeat_init", v); }
function set_fr_survive(v) { storeParam("fr_survive", v); }
function set_slice_at(v) { storeParam("slice_at", v); }
function set_slice_beat(v) { storeParam("slice_beat", v); }
function set_show_inspector(v) { storeParam("show_inspector", v); }
function set_face_theme(v) { storeParam("face_theme", v); }
function set_env_page(v) { storeParam("env_page", v); }
function set_samp_start(v) { storeParam("samp_start", v); }
function set_samp_end(v) { storeParam("samp_end", v); }
function set_loop_start(v) { storeParam("loop_start", v); }
function set_loop_end(v) { storeParam("loop_end", v); }
function set_loop_xfade(v) { storeParam("loop_xfade", v); }
function set_play_pos(v) { storeParam("play_pos", v); }
function set_pitch_st(v) { storeParam("pitch_st", v); }
function set_fine_cents(v) { storeParam("fine_cents", v); }
function set_root_note(v) { storeParam("root_note", v); }
function set_grain_size(v) { storeParam("grain_size", v); }
function set_grain_motion(v) { storeParam("grain_motion", v); }
function set_grain_spray(v) { storeParam("grain_spray", v); }
function set_formant(v) { storeParam("formant", v); }
function set_poly_voices(v) { storeParam("poly_voices", v); }
function set_mono_legato(v) { storeParam("mono_legato", v); }
function set_glide_ms(v) { storeParam("glide_ms", v); }
function set_unison_voices(v) { storeParam("unison_voices", v); }
function set_unison_detune(v) { storeParam("unison_detune", v); }
function set_unison_width(v) { storeParam("unison_width", v); }
function set_atk_ms(v) { storeParam("atk_ms", v); }
function set_dec_ms(v) { storeParam("dec_ms", v); }
function set_sus_lvl(v) { storeParam("sus_lvl", v); }
function set_rel_ms(v) { storeParam("rel_ms", v); }
function set_matk_ms(v) { storeParam("matk_ms", v); }
function set_mdec_ms(v) { storeParam("mdec_ms", v); }
function set_msus_lvl(v) { storeParam("msus_lvl", v); }
function set_mrel_ms(v) { storeParam("mrel_ms", v); }
function set_filt_on(v) { storeParam("filt_on", v); }
function set_filt_type(v) { storeParam("filt_type", v); }
function set_filt_cutoff(v) { storeParam("filt_cutoff", v); }
function set_filt_res(v) { storeParam("filt_res", v); }
function set_filt_drive(v) { storeParam("filt_drive", v); }
function set_filt_env_amt(v) { storeParam("filt_env_amt", v); }
function set_lfo_rate(v) { storeParam("lfo_rate", v); }
function set_lfo_shape(v) { storeParam("lfo_shape", v); }
function set_lfo_pitch(v) { storeParam("lfo_pitch", v); }
function set_lfo_filt(v) { storeParam("lfo_filt", v); }
function set_lfo_pos(v) { storeParam("lfo_pos", v); }
function set_menv_pitch(v) { storeParam("menv_pitch", v); }
function set_menv_pos(v) { storeParam("menv_pos", v); }
function set_vel_sens(v) { storeParam("vel_sens", v); }
function set_samp_gain(v) { storeParam("samp_gain", v); }
function set_atk_slope(v) { storeParam("atk_slope", v); }
function set_dec_slope(v) { storeParam("dec_slope", v); }
function set_rel_slope(v) { storeParam("rel_slope", v); }
function set_matk_slope(v) { storeParam("matk_slope", v); }
function set_mdec_slope(v) { storeParam("mdec_slope", v); }
function set_mrel_slope(v) { storeParam("mrel_slope", v); }
function set_filt_slope(v) { storeParam("filt_slope", v); }
function set_filt_circuit(v) { storeParam("filt_circuit", v); }
function set_filt_morph(v) { storeParam("filt_morph", v); }
function set_filt2_on(v) { storeParam("filt2_on", v); }
function set_filt2_type(v) { storeParam("filt2_type", v); }
function set_filt2_slope(v) { storeParam("filt2_slope", v); }
function set_filt2_circuit(v) { storeParam("filt2_circuit", v); }
function set_filt2_cutoff(v) { storeParam("filt2_cutoff", v); }
function set_filt2_res(v) { storeParam("filt2_res", v); }
function set_filt2_drive(v) { storeParam("filt2_drive", v); }
function set_filt2_morph(v) { storeParam("filt2_morph", v); }
function set_filt_route(v) { storeParam("filt_route", v); }
function set_osc2_on(v) { storeParam("osc2_on", v); }
function set_osc2_type(v) { storeParam("osc2_type", v); }
function set_osc2_pitch(v) { storeParam("osc2_pitch", v); }
function set_osc2_detune(v) { storeParam("osc2_detune", v); }
function set_osc2_pos(v) { storeParam("osc2_pos", v); }
function set_osc2_gain(v) { storeParam("osc2_gain", v); }
function set_sub_on(v) { storeParam("sub_on", v); }
function set_sub_oct(v) { storeParam("sub_oct", v); }
function set_sub_tone(v) { storeParam("sub_tone", v); }
function set_sub_gain(v) { storeParam("sub_gain", v); }
function set_out_gain(v) { storeParam("out_gain", v); }

// Demo state for screenshots (render_preview.py calls preview())
function preview() {
    hasLoadedSample = 1;
    dspReady = 1;
    sampleFileName = "(Crash) Cymbal - 707 - 525.wav";
    sampleFrames = 53800;
    sampleDurationMs = 1220;
    curMode = 0;
    curSliced = 0;
    curLoopMode = 1;
    curStart = 0.0;
    curEnd = 1.0;
    curLoopStart = 0.42;
    curLoopEnd = 0.86;
    curXfade = 0.06;
    storeParam("filt_cutoff", 2640);
    storeParam("filt_res", 18);
    storeParam("sus_lvl", 85);
    var seed = 7;
    for (var i = 0; i < WAVE_BINS; i++) {
        var t = i / WAVE_BINS;
        seed = (seed * 16807) % 2147483647;
        var jitter = 0.78 + 0.22 * (seed / 2147483647);
        var env = Math.exp(-t * 2.1) * (t < 0.01 ? t / 0.01 : 1.0);
        wavePeaksL[i] = Math.min(0.98, Math.max(0.03, env * jitter));
        wavePeaksR[i] = wavePeaksL[i] * 0.97;
    }
    voicePlayheads[0] = 0.31; voiceAmps[0] = 0.8;
    voicePlayheads[1] = 0.55; voiceAmps[1] = 0.5;
    liveActiveVoices = 2;
    livePeakL = 0.62;
    livePeakR = 0.58;
}

// Backward-compatible state serialization (rule #6)
function getvalueof() {
    /** @type {Array<number | string>} */
    var out = [
        3, // version 3: mode is the engine 0..4 (v1/v2: mode 3 was the Slice engine); v2+ add the sample path
        curMode,
        Math.round(curStart * 10000),
        Math.round(curEnd * 10000),
        curLoopMode,
        Math.round(curLoopStart * 10000),
        Math.round(curLoopEnd * 10000),
        Math.round(curXfade * 10000),
        Math.round(curPlayPos * 10000),
        envPage,
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
        var savedMode = Math.round(a[1]);
        if (ver < 3 && savedMode === 3) {
            // v1 / v2 blobs: mode 3 was the Slice engine (Sliced Repitch)
            curMode = 0;
            curSliced = 1;
            outlet(0, "param", "mode", 0);
            outlet(0, "param", "sliced", 1);
        } else {
            curMode = Math.max(0, Math.min(4, savedMode));
        }
        curStart = Math.max(0, Math.min(0.99, a[2] / 10000.0));
        curEnd = Math.max(curStart + 0.01, Math.min(1.0, a[3] / 10000.0));
        curLoopMode = Math.max(0, Math.min(2, Math.round(a[4])));
        curLoopStart = Math.max(0, Math.min(0.99, a[5] / 10000.0));
        curLoopEnd = Math.max(curLoopStart + 0.01, Math.min(1.0, a[6] / 10000.0));
        curXfade = Math.max(0, Math.min(0.45, a[7] / 10000.0));
        curPlayPos = Math.max(0, Math.min(1.0, a[8] / 10000.0));
        envPage = Math.max(0, Math.min(3, Math.round(a[9])));
        if (typeof abOnParam === "function") abOnParam("env_page");
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
