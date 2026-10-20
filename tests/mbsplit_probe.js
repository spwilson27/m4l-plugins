// Audio probe for scripts/run_mbsplit_audio_tests.py
// Analyzes recorded 2-channel buffer `rec` and telemetry buffer `#0-splitscope`
// and writes report to /tmp/mbsplit_audio.txt only after DSP recording completes.

inlets = 1;
outlets = 1;

var armed = false;
var scopeName = "";

function setbuffer(name) {
    scopeName = name ? ("" + name) : "";
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
        for (var j = 0; j < chunk.length; j++) {
            out.push(chunk[j]);
        }
    }
    return out;
}

function computeStats(arr, startIdx, endIdx) {
    var nanCount = 0;
    var peak = 0.0;
    var sumSq = 0.0;
    var count = 0;
    for (var i = startIdx; i < endIdx && i < arr.length; i++) {
        var v = arr[i];
        if (isNaN(v) || !isFinite(v)) {
            nanCount++;
            continue;
        }
        var a = Math.abs(v);
        if (a > peak) peak = a;
        sumSq += v * v;
        count++;
    }
    var rms = count > 0 ? Math.sqrt(sumSq / count) : 0.0;
    return { nan: nanCount, peak: peak, rms: rms };
}

function readScopeStats() {
    var empty = { specMax: 0, b1: 0, b2: 0, b3: 0, b4: 0, pkIn: 0, pkOut: 0, beat: 0, firD: 0, dyn: 0 };
    if (!scopeName) return empty;
    var buf = new Buffer(scopeName);
    var vals = buf.peek(1, 0, 28);
    if (!vals || !vals.length) return empty;
    var specMax = 0.0;
    for (var i = 0; i < 16; i++) {
        if ((vals[i] || 0) > specMax) specMax = vals[i];
    }
    return {
        specMax: specMax,
        b1: vals[16] || 0,
        b2: vals[17] || 0,
        b3: vals[18] || 0,
        b4: vals[19] || 0,
        pkIn: vals[20] || 0,
        pkOut: vals[21] || 0,
        beat: vals[23] || 0,
        firD: vals[26] || 0,
        dyn: vals[27] || 0
    };
}

function analyze(durMs) {
    if (armed) return;
    armed = true;

    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000.0) : 48000.0;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000.0)));

    var left = readChannel(rec, 1, n);
    var right = readChannel(rec, 2, n);

    // Measure steady state after first 120 ms of filter settling
    var startFrame = Math.min(Math.floor(sr * 0.12), Math.floor(n * 0.3));
    var endFrame = Math.max(startFrame + 512, n - Math.floor(sr * 0.02));

    var stL = computeStats(left, startFrame, endFrame);
    var stR = computeStats(right, startFrame, endFrame);
    var sc = readScopeStats();

    var report = new File("/tmp/mbsplit_audio.txt", "write", "TEXT");
    report.writestring(
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + (stL.nan + stR.nan) + "\n" +
        "peakL " + stL.peak + "\n" +
        "peakR " + stR.peak + "\n" +
        "rmsL " + stL.rms + "\n" +
        "rmsR " + stR.rms + "\n" +
        "scopeSpecMax " + sc.specMax + "\n" +
        "scopeB1 " + sc.b1 + "\n" +
        "scopeB2 " + sc.b2 + "\n" +
        "scopeB3 " + sc.b3 + "\n" +
        "scopeB4 " + sc.b4 + "\n" +
        "scopeIn " + sc.pkIn + "\n" +
        "scopeOut " + sc.pkOut + "\n" +
        "scopeBeat " + sc.beat + "\n" +
        "scopeFirD " + sc.firD + "\n" +
        "scopeDyn " + sc.dyn + "\n"
    );
    report.close();
    outlet(0, "bang");
}
