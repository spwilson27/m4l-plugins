// Audio probe for scripts/run_degrade_audio_tests.py.
// Records stereo output of src/degrade_core.genexpr into `buffer~ rec` and inspects
// `#0-degscope` telemetry buffer.

inlets = 1;
outlets = 1;

var resultPath = "/tmp/degrade_audio.txt";
function resultpath(p) { resultPath = String(p); }

var mode = jsarguments.length > 1 ? jsarguments[1] : "bypass";
var armed = false;
var scopeName = "";

function loadbang() {
    post("DEGRADE_PROBE_LOADED " + mode + "\n");
}

function setbuffer(name) {
    scopeName = name ? ("" + name) : "";
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

    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(
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
    var firstActive = -1;
    var lastActive = -1;

    for (var k = 0; k < left.length; k++) {
        var lv = left[k];
        var rv = right[k];
        if (lv !== lv || lv === Infinity || lv === -Infinity) nan++;
        else if (Math.abs(lv) > peak) peak = Math.abs(lv);
        if (rv !== rv || rv === Infinity || rv === -Infinity) nan++;
        else if (Math.abs(rv) > peak) peak = Math.abs(rv);
        if (Math.abs(lv) > 1e-4 || Math.abs(rv) > 1e-4) {
            if (firstActive < 0) firstActive = k;
            lastActive = k;
        }
    }

    var start = firstActive >= 0 ? Math.min(lastActive, firstActive + 128) : 0;
    var end = lastActive >= 0 ? Math.max(start, lastActive - 128) : 0;
    var winPeak = 0;
    var count = 0;
    var activeSteps = 0;
    var d2Sq = 0;

    for (var i = start; i < end; i++) {
        var v = left[i];
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
