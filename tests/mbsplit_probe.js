// Audio probe for scripts/run_mbsplit_audio_tests.py
// Analyzes recorded 2-channel buffer `rec` and telemetry buffer `#0-splitscope`
// and writes report to /tmp/mbsplit_audio.txt only after DSP recording completes.

inlets = 1;
outlets = 1;

var armed = false;
var resultPath = "/tmp/mbsplit_audio.txt";

function resultpath(p) {
    resultPath = String(p);
}
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
    var empty = { b1: 0, b2: 0, b3: 0, b4: 0, pkIn: 0, pkOut: 0, beat: 0, firD: 0, dyn: 0, need: 0, asleep: 0, ringon: 0 };
    if (!scopeName) return empty;
    var buf = new Buffer(scopeName);
    var vals = buf.peek(1, 0, 32);
    if (!vals || !vals.length) return empty;
    return {
        need: vals[28] || 0,
        asleep: vals[29] || 0,
        ringon: vals[30] || 0,
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

    // Raw sample dump (L R per line) for offline reference nulls in scripts/run_mbsplit_audio_tests.py
    var dump = new File(resultPath + ".dump", "write", "TEXT");
    dump.eof = 0;
    var chunk = "";
    for (var di = 0; di < n; di++) {
        chunk += left[di] + " " + right[di] + "\n";
        if (chunk.length > 24000) { dump.writestring(chunk); chunk = ""; }
    }
    if (chunk.length) dump.writestring(chunk);
    dump.close();

    var report = new File(resultPath, "write", "TEXT");
    report.writestring(
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + (stL.nan + stR.nan) + "\n" +
        "peakL " + stL.peak + "\n" +
        "peakR " + stR.peak + "\n" +
        "rmsL " + stL.rms + "\n" +
        "rmsR " + stR.rms + "\n" +
        "scopeNeed " + sc.need + "\n" +
        "scopeAsleep " + sc.asleep + "\n" +
        "scopeRingOn " + sc.ringon + "\n" +
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
