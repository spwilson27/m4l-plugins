// Audio probe for scripts/run_reciprocator_audio_tests.py.
// jsarguments: mode, scopeBufferName.
// Modes:
//   sine      — steady 220 Hz sine at 0.25 amplitude
//   twotone   — loud 0.50 sine for 0..350 ms, then quiet 0.035 sine for 350..800 ms
//   silence   — microscopic 0.0004 noise/tone well below Gate (-42 dB = 0.0079)
//   transient — sharp full-scale 0.95 burst to test Lookahead + Ceiling clamp
//
// Under scripts/max_harness.py the report path arrives via resultpath. The report file /tmp/reciprocator_audio.txt is created ONLY inside analyze()
// so the Python runner never reads a partial or empty file.

var resultPath = "/tmp/reciprocator_audio.txt";
function resultpath(p) { resultPath = String(p); }

inlets = 1;
outlets = 1;

var mode = jsarguments.length > 1 ? jsarguments[1] : "sine";
var peaks = { genL: -1, ctl: -1, genR: -1 };
var armed = false;
var scopeName = "";

function loadbang() {
    post("RECIP_PROBE_LOADED " + mode + "\n");
}

function setbuffer(name) {
    scopeName = name ? ("" + name) : "";
    if (scopeName) {
        var sb = new Buffer(scopeName);
        post("RECIP_SCOPE_EARLY frames " + sb.framecount() + "\n");
    }
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
    peaks.genL = chanPeak(left);
    peaks.genR = chanPeak(right);
    if (rec.channelcount() >= 3) peaks.ctl = chanPeak(readChannel(rec, 3, n));
    var env = envelope(left, right, sr);
    var stats = scan(left, right, sr);
    var scopeStats = readScope();

    var report = new File(resultPath, "write", "TEXT");
    report.writestring(
        "genL " + peaks.genL + "\n" +
        "genR " + peaks.genR + "\n" +
        "ctl " + peaks.ctl + "\n" +
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + stats.nan + "\n" +
        "peak " + stats.peak + "\n" +
        "dc " + stats.dc + "\n" +
        "zcr " + stats.zcr + "\n" +
        "crest " + stats.crest + "\n" +
        "scopeEnv " + scopeStats.env + "\n" +
        "scopeOut " + scopeStats.out + "\n" +
        "scopeGate " + scopeStats.gate + "\n" +
        "envbins " + env.length + "\n"
    );
    // max_harness parses only 2-token lines, so the envelope is written one bin per line.
    for (var ei = 0; ei < env.length; ei++) report.writestring("env_" + ei + " " + env[ei] + "\n");
    report.close();
    post("RECIP_SHUTDOWN peak " + stats.peak + " scopeOut " + scopeStats.out + "\n");
    outlet(0, "bang");
}

function readScope() {
    if (!scopeName) return { env: -1, out: -1, gate: -1 };
    var buf = new Buffer(scopeName);
    var chunk = buf.peek(1, 0, 8);
    if (!chunk || !chunk.length) return { env: 0, out: 0, gate: 0 };
    post("RECIP_SCOPE s0=" + chunk[0] + " s1=" + chunk[1] + " s2=" + chunk[2] + " s4=" + chunk[4] + "\n");
    return {
        env: chunk[1] || 0,
        gate: chunk[2] || 0,
        out: chunk[4] || 0,
    };
}

function readChannel(buf, channel, n) {
    var out = [];
    var i;
    for (i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var chunk = buf.peek(channel, i, count);
        var k;
        if (!chunk) {
            for (k = 0; k < count; k++) out.push(0);
            continue;
        }
        if (typeof chunk === "number") {
            out.push(chunk);
            continue;
        }
        for (k = 0; k < count; k++) out.push(chunk[k]);
    }
    return out;
}

function envelope(left, right, sr) {
    var hop = Math.max(1, Math.round(sr / 1000));
    var bins = [];
    var i, k, peak;
    for (i = 0; i < left.length; i += hop) {
        peak = 0;
        for (k = i; k < i + hop && k < left.length; k++) {
            var a = Math.abs(left[k]);
            var b = Math.abs(right[k]);
            if (a > peak) peak = a;
            if (b > peak) peak = b;
        }
        bins.push(Math.round(peak * 1e6) / 1e6);
    }
    return bins;
}

function scan(left, right, sr) {
    var nan = 0;
    var peak = 0;
    var sum = 0;
    var sq = 0;
    var zc = 0;
    var start = Math.min(left.length, Math.floor(sr * 0.05));
    var end = Math.max(start, Math.min(left.length, Math.floor(sr * 0.25)));
    var winPeak = 0;
    var count = 0;
    var i, v;
    for (i = 0; i < left.length; i++) {
        v = left[i];
        if (v !== v || v === Infinity || v === -Infinity) nan++;
        else if (Math.abs(v) > peak) peak = Math.abs(v);
        var vr = right[i];
        if (vr !== vr || vr === Infinity || vr === -Infinity) nan++;
        else if (Math.abs(vr) > peak) peak = Math.abs(vr);
        if (i >= start && i < end) {
            if (Math.abs(v) > winPeak) winPeak = Math.abs(v);
            sum += v;
            sq += v * v;
            if (i > start && ((left[i - 1] >= 0 && v < 0) || (left[i - 1] < 0 && v >= 0))) {
                zc++;
            }
            count++;
        }
    }
    var rms = count > 0 ? Math.sqrt(sq / count) : 0;
    var dc = count > 0 ? Math.abs(sum / count) : 0;
    var crest = rms > 1e-6 ? winPeak / rms : 0;
    return { nan: nan, peak: peak, dc: dc, zcr: zc, crest: crest };
}

function chanPeak(a) {
    var p = 0, i;
    for (i = 0; i < a.length; i++) if (Math.abs(a[i]) > p) p = Math.abs(a[i]);
    return p;
}
