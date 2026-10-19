// Audio probe for scripts/run_degrade_audio_tests.py.
// Records stereo output of src/degrade_core.genexpr into `buffer~ rec` and inspects
// `#0-degscope` telemetry buffer.

inlets = 4;
outlets = 3;

var mode = jsarguments.length > 1 ? jsarguments[1] : "bypass";
var peaks = { genL: -1, ctl: -1, genR: -1 };
var armed = false;
var scopeName = "";

function loadbang() {
    post("DEGRADE_PROBE_LOADED " + mode + "\n");
}

function setbuffer(name) {
    scopeName = name ? ("" + name) : "";
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
    var stats = scan(left, right, sr);
    var scopeStats = readScope();

    var report = new File("/tmp/degrade_audio.txt", "write", "TEXT");
    report.writestring(
        "genL " + peaks.genL + "\n" +
        "genR " + peaks.genR + "\n" +
        "ctl " + peaks.ctl + "\n" +
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + stats.nan + "\n" +
        "peak " + stats.peak + "\n" +
        "rms " + stats.rms + "\n" +
        "zcr " + stats.zcr + "\n" +
        "crest " + stats.crest + "\n" +
        "stepDiff " + stats.stepDiff + "\n" +
        "roughness " + stats.roughness + "\n" +
        "hash " + stats.hash + "\n" +
        "scopeIn " + scopeStats.inPk + "\n" +
        "scopeOut " + scopeStats.outPk + "\n" +
        "scopeMask " + scopeStats.mask + "\n" +
        "scopeOrder " + scopeStats.order + "\n"
    );
    report.close();
    post("DEGRADE_SHUTDOWN peak " + stats.peak + " mask " + scopeStats.mask + "\n");
    outlet(0, "bang");
}

function readScope() {
    if (!scopeName) return { inPk: -1, outPk: -1, mask: -1, order: -1 };
    var buf = new Buffer(scopeName);
    var chunk = buf.peek(1, 0, 32);
    if (!chunk || !chunk.length) return { inPk: 0, outPk: 0, mask: 0, order: 0 };
    return {
        inPk: chunk[0] || 0,
        outPk: chunk[1] || 0,
        mask: chunk[30] || 0,
        order: chunk[31] || 0,
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

function scan(left, right, sr) {
    var nan = 0;
    var peak = 0;
    var sq = 0;
    var zc = 0;
    var zeroSteps = 0;
    var hashAcc = 0;
    var start = Math.floor(left.length * 0.35);
    var end = Math.floor(left.length * 0.95);
    var winPeak = 0;
    var count = 0;
    var activeSteps = 0;
    var d2Sq = 0;

    for (var i = 0; i < left.length; i++) {
        var v = left[i];
        var vr = right[i];
        if (v !== v || v === Infinity || v === -Infinity) nan++;
        else if (Math.abs(v) > peak) peak = Math.abs(v);
        if (vr !== vr || vr === Infinity || vr === -Infinity) nan++;
        else if (Math.abs(vr) > peak) peak = Math.abs(vr);

        if (i >= start && i < end) {
            if (Math.abs(v) > winPeak) winPeak = Math.abs(v);
            sq += v * v;
            if (i > start + 1) {
                var d2 = v - 2.0 * left[i - 1] + left[i - 2];
                d2Sq += d2 * d2;
            }
            if (i > start && (Math.abs(v) > 1e-4 || Math.abs(left[i - 1]) > 1e-4)) {
                if ((left[i - 1] >= 0 && v < 0) || (left[i - 1] < 0 && v >= 0)) zc++;
                if (Math.abs(v - left[i - 1]) < 1e-6) zeroSteps++;
                activeSteps++;
            }
            if ((count % 16) === 0) {
                hashAcc += Math.round(v * 1000) * ((count % 97) + 1);
            }
            count++;
        }
    }
    var rms = count > 0 ? Math.sqrt(sq / count) : 0;
    var d2Rms = count > 2 ? Math.sqrt(d2Sq / (count - 2)) : 0;
    var roughness = rms > 1e-6 ? d2Rms / rms : 0;
    var crest = rms > 1e-6 ? winPeak / rms : 0;
    var stepRatio = activeSteps > 1 ? zeroSteps / activeSteps : 0;
    return {
        nan: nan,
        peak: peak,
        rms: rms,
        zcr: zc,
        crest: crest,
        stepDiff: stepRatio,
        roughness: roughness,
        hash: hashAcc,
    };
}
