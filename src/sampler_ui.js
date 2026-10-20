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
var lastEngine = 0;       // engine restored when leaving Sliced

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
    if (curMode < 3) lastEngine = curMode;
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

function trace(event, detail) {
    if (!loadTrace) return;
    try {
        var lines = String(loadTrace.text || "").split("\n").filter(function (l) { return l.length > 0; });
        lines.push(event + " " + (detail === undefined ? "" : String(detail)));
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
        sampleDurationMs = Math.round((frames / 44.1));
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
    } catch (err) {
        lastLoadError = String(err);
        trace("refresh-error", lastLoadError);
        if (typeof post === "function") post("Better Sampler: waveform refresh failed: " + lastLoadError + "\n");
    }
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
    trace("setbuffers", sName + " " + vName + " " + scName);
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

function clampInt(n, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(n))); }
function clampF(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function paramValue(key) {
    if (Object.prototype.hasOwnProperty.call(paramVals, key)) return paramVals[key];
    var p = (typeof FACE_PARAMS !== "undefined") ? FACE_PARAMS[key] : null;
    return p ? p.init : 0;
}

// Single entry point for live.* echoes and face edits; mirrors the values the voice logic needs
function storeParam(key, v) {
    var n = Number(v);
    if (!isFinite(n)) return;
    paramVals[key] = n;
    switch (key) {
        case "mode": curMode = clampInt(n, 0, 3); if (curMode < 3) lastEngine = curMode; break;
        case "freeze": curFreeze = n > 0.5 ? 1 : 0; break;
        case "reverse": curReverse = n > 0.5 ? 1 : 0; break;
        case "loop_mode": curLoopMode = clampInt(n, 0, 2); break;
        case "samp_start": curStart = clampF(n * 0.01, 0.0, 0.98); break;
        case "samp_end": curEnd = clampF(n * 0.01, curStart + 0.01, 1.0); break;
        case "loop_start": curLoopStart = clampF(n * 0.01, 0.0, 0.98); break;
        case "loop_end": curLoopEnd = clampF(n * 0.01, curLoopStart + 0.01, 1.0); break;
        case "loop_xfade": curXfade = clampF(n * 0.0045, 0.0, 0.45); break;
        case "play_pos": curPlayPos = clampF(n * 0.01, 0.0, 1.0); break;
        case "root_note": curRootNote = clampInt(n, 0, 127); break;
        case "poly_voices": curPolyVoices = clampInt(n, 1, 16); voiceAlloc.setMaxVoices(curPolyVoices); break;
        case "mono_legato": curMonoLegato = n > 0.5 ? 1 : 0; break;
        case "filt_on": curFiltOn = n > 0.5 ? 1 : 0; break;
        case "filt_cutoff": curFiltCutoff = n; break;
    }
    mgraphics.redraw();
}

// Parameter setters from the hidden live.* widgets
function set_mode(v) { storeParam("mode", v); }
function set_freeze(v) { storeParam("freeze", v); }
function set_reverse(v) { storeParam("reverse", v); }
function set_loop_mode(v) { storeParam("loop_mode", v); }
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
function set_out_gain(v) { storeParam("out_gain", v); }

// Demo state for screenshots (render_preview.py calls preview())
function preview() {
    hasLoadedSample = 1;
    sampleFileName = "(Crash) Cymbal - 707 - 525.wav";
    sampleFrames = 53800;
    sampleDurationMs = 1220;
    curMode = 0;
    lastEngine = 0;
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
        curMode = Math.max(0, Math.min(3, Math.round(a[1])));
        if (curMode < 3) lastEngine = curMode;
        curStart = Math.max(0, Math.min(0.99, a[2] / 10000.0));
        curEnd = Math.max(curStart + 0.01, Math.min(1.0, a[3] / 10000.0));
        curLoopMode = Math.max(0, Math.min(2, Math.round(a[4])));
        curLoopStart = Math.max(0, Math.min(0.99, a[5] / 10000.0));
        curLoopEnd = Math.max(curLoopStart + 0.01, Math.min(1.0, a[6] / 10000.0));
        curXfade = Math.max(0, Math.min(0.45, a[7] / 10000.0));
        curPlayPos = Math.max(0, Math.min(1.0, a[8] / 10000.0));
        envPage = Math.max(0, Math.min(3, Math.round(a[9])));
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
