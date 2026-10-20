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
            captureSliceMono(b, frames, chans);
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

// Mono downmix for the onset / pitch slicers (capped at 10 minutes)
function captureSliceMono(b, frames, chans) {
    try {
        var n = Math.min(frames, 48000 * 600);
        var l = b.peek(1, 0, n);
        var r = chans > 1 ? b.peek(2, 0, n) : null;
        var mono = new Float32Array(n);
        for (var i = 0; i < n; i++) mono[i] = r ? 0.5 * (l[i] + r[i]) : l[i];
        sliceMono = mono;
    } catch (_) {
        sliceMono = null;
    }
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

function device_ready() {
    applyDeviceWidth();
}

// Held Sliced-mode notes follow the start / end point live
function refreshHeldSlices() {
    if (!curSliced) return;
    var touched = voiceAlloc.updateSliceBounds(currentSliceStarts(), curEnd);
    for (var i = 0; i < touched.length; i++) writeVoiceToBuffer(touched[i]);
}

// MIDI note handling from midiparse or test messages
function midi_note(note, vel) {
    var n = Math.round(Number(note) || 60);
    var v = Math.round(Number(vel) || 0);
    voiceAlloc.setMaxVoices(curPolyVoices);
    if (v > 0) {
        var starts = currentSliceStarts();
        var allocated = voiceAlloc.noteOn(n, v, curMonoLegato, starts, curEnd);
        writeVoiceToBuffer(allocated);
        if (curSliced) {
            selectedSliceIdx = Math.max(0, n - curSliceFrom) % starts.length;
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
        case "mode": curMode = clampInt(n, 0, 4); break;
        case "sliced": curSliced = n > 0.5 ? 1 : 0; refreshHeldSlices(); break;
        case "slice_from":
            curSliceFrom = clampInt(n, 0, 127);
            if (typeof voiceAlloc.setSliceBaseNote === "function") voiceAlloc.setSliceBaseNote(curSliceFrom);
            refreshHeldSlices();
            break;
        case "slice_at": case "slice_div": case "slice_beat": case "slice_sens": recomputeSlices(); break;
        case "show_inspector": showInspector = n > 0.5 ? 1 : 0; applyDeviceWidth(); break;
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
function set_slice_play(v) { storeParam("slice_play", v); }
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
