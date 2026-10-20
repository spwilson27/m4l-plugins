// Audio probe for scripts/run_sampler_audio_tests.py.
// Fills `#0-bsamp` with a rich synthetic harmonic stereo test waveform, pokes polyphonic/unison
// voice notes into `#0-bsvoices`, records the stereo output of `src/sampler_core.genexpr` into
// `buffer~ rec`, and inspects `#0-bsscope` telemetry.

inlets = 4;
outlets = 3;

var mode = jsarguments.length > 1 ? jsarguments[1] : "repitch_chord";
var peaks = { genL: -1, ctl: -1, genR: -1 };
var armed = false;
var sampName = "";
var voicesName = "";
var scopeName = "";
var trigSeq = 0;

function setbuffers(sName, vName, scName) {
    sampName = String(sName || "");
    voicesName = String(vName || "");
    scopeName = String(scName || "");
    trigSeq += 1;
    seedSampleAndVoices();
}

function seedSampleAndVoices() {
    if (!sampName || !voicesName) return;
    var sb = new Buffer(sampName);
    // Short dual-mono tone with a steep decay. Reverse can walk from the quiet
    // tail back into the attack inside one rendered window, and stereo width
    // comes from unison rather than from a baked-in L/R difference.
    sb.send("sizeinsamps", 12000);
    var frames = sb.framecount() || 12000;
    if (frames > 12000) frames = 12000;
    var ch1 = new Array(frames);
    var ch2 = new Array(frames);
    for (var i = 0; i < frames; i++) {
        var t = i / 44100.0;
        var env = Math.min(1.0, i / 32.0) * Math.exp(-i / 3500.0);
        var w = (
            0.55 * Math.sin(2.0 * Math.PI * 220.0 * t) +
            0.25 * Math.sin(2.0 * Math.PI * 440.0 * t) +
            0.15 * Math.sin(2.0 * Math.PI * 660.0 * t)
        ) * env;
        ch1[i] = w;
        ch2[i] = w;
    }
    sb.poke(1, 0, ch1);
    sb.poke(2, 0, ch2);

    var vb = new Buffer(voicesName);
    var vFlat = new Array(128);
    for (var k = 0; k < 128; k++) vFlat[k] = 0.0;

    if (mode === "idle_silent") {
        // All 16 voices gate = 0
        vb.poke(1, 0, vFlat);
        return;
    }

    // Trigger a 3-note polyphonic triad, a slice note, or one centered voice.
    // Centered single notes let Reverse / Freeze / 8-voice unison show up in the
    // recording instead of the triad's hardcoded pan seeds.
    var single = (mode === "forward_oneshot" || mode === "reverse_oneshot"
        || mode === "freeze_hold" || mode === "unison8_wide");
    var notes = (mode === "slice_trig") ? [38] : (single ? [60] : [60, 64, 67]);
    for (var v = 0; v < notes.length; v++) {
        var base = v * 8;
        vFlat[base + 0] = 1.0;        // gate
        vFlat[base + 1] = notes[v];   // MIDI note
        vFlat[base + 2] = 0.90;       // velocity
        vFlat[base + 3] = trigSeq;    // trigCount
        vFlat[base + 4] = (mode === "slice_trig") ? 0.25 : 0.0; // sliceStart
        vFlat[base + 5] = (mode === "slice_trig") ? 0.50 : 1.0; // sliceEnd
        vFlat[base + 6] = single ? 0.0 : ((v === 0) ? -0.4 : ((v === 1) ? 0.4 : 0.0)); // panSeed
        vFlat[base + 7] = 0.17 * (v + 1); // rndSeed
    }
    vb.poke(1, 0, vFlat);
}

function msg_float(v) {
    if (inlet === 0) peaks.genL = v;
    else if (inlet === 1) peaks.ctl = v;
    else if (inlet === 2) peaks.genR = v;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000) : 44100;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var left = readChannel(rec, 1, n);
    var right = readChannel(rec, 2, n);
    // record~ leaves exact zeros in the tail when the audio thread renders
    // fewer samples than the scheduler's delay. Measure the written prefix.
    var rendered = left.length;
    while (rendered > 0 && left[rendered - 1] === 0 && right[rendered - 1] === 0) rendered--;
    if (rendered >= 64) {
        left = left.slice(0, rendered);
        right = right.slice(0, rendered);
    }
    var stats = scan(left, right, sr);
    var earlyRms = bandRms(left, right, Math.floor(left.length * 0.12), Math.floor(left.length * 0.38));
    var lateRms = bandRms(left, right, Math.floor(left.length * 0.65), Math.floor(left.length * 0.92));
    var scopeStats = readScope();

    var report = new File("/tmp/sampler_audio.txt", "write", "TEXT");
    report.writestring(
        "genL " + peaks.genL + "\n" +
        "genR " + peaks.genR + "\n" +
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "rendered " + rendered + "\n" +
        "nan " + stats.nan + "\n" +
        "peak " + stats.peak + "\n" +
        "rms " + stats.rms + "\n" +
        "stereoDiff " + stats.stereoDiff + "\n" +
        "earlyRms " + earlyRms + "\n" +
        "lateRms " + lateRms + "\n" +
        "scopeActive " + scopeStats.activeVoices + "\n" +
        "scopePeakL " + scopeStats.peakL + "\n" +
        "scopeCutHz " + scopeStats.cutHz + "\n" +
        "scopeFrames " + scopeStats.sampFrames + "\n" +
        "scopeLen " + scopeStats.scopeLen + "\n" +
        "jsFrames " + scopeStats.jsFrames + "\n"
    );
    report.close();
    outlet(0, "bang");
}

function readScope() {
    var jsFrames = -1;
    if (sampName) {
        try {
            jsFrames = new Buffer(sampName).framecount() || 0;
        } catch (err) {
            jsFrames = -2;
        }
    }
    if (!scopeName) return { activeVoices: -1, peakL: -1, cutHz: -1, sampFrames: -1, scopeLen: 0, jsFrames: jsFrames };
    var buf = new Buffer(scopeName);
    var chunk = buf.peek(1, 0, 40);
    if (!chunk || !chunk.length) {
        return { activeVoices: 0, peakL: 0, cutHz: 0, sampFrames: 0, scopeLen: 0, jsFrames: jsFrames };
    }
    return {
        peakL: chunk[32] || 0,
        activeVoices: chunk[34] || 0,
        cutHz: chunk[37] || 0,
        sampFrames: (chunk.length > 38 && chunk[38] !== undefined) ? chunk[38] : -3,
        scopeLen: chunk.length,
        jsFrames: jsFrames,
    };
}

function readChannel(buf, channel, n) {
    var out = [];
    for (var i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var chunk = buf.peek(channel, i, count);
        if (!chunk) {
            for (var k = 0; k < count; k++) out.push(0);
            continue;
        }
        if (typeof chunk === "number") {
            out.push(chunk);
            continue;
        }
        for (var j = 0; j < count; j++) out.push(chunk[j]);
    }
    return out;
}

function bandRms(left, right, i0, i1) {
    var sq = 0;
    var count = 0;
    var a = Math.max(0, i0);
    var b = Math.min(left.length, i1);
    for (var k = a; k < b; k++) {
        var lv = left[k];
        var rv = right[k];
        sq += 0.5 * (lv * lv + rv * rv);
        count++;
    }
    return count > 0 ? Math.sqrt(sq / count) : 0;
}

function scan(left, right, sr) {
    var nan = 0;
    var peak = 0;
    var sq = 0;
    var diffSq = 0;
    var len = left.length;

    for (var k = 0; k < len; k++) {
        var lv = left[k];
        var rv = right[k];
        if (lv !== lv || lv === Infinity || lv === -Infinity) nan++;
        else if (Math.abs(lv) > peak) peak = Math.abs(lv);
        if (rv !== rv || rv === Infinity || rv === -Infinity) nan++;
        else if (Math.abs(rv) > peak) peak = Math.abs(rv);
        sq += 0.5 * (lv * lv + rv * rv);
        diffSq += (lv - rv) * (lv - rv);
    }

    var rms = len > 0 ? Math.sqrt(sq / len) : 0;
    var stereoDiff = len > 0 ? Math.sqrt(diffSq / len) : 0;
    return { nan: nan, peak: peak, rms: rms, stereoDiff: stereoDiff };
}
