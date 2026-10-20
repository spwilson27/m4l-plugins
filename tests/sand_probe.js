// Audio probe for scripts/run_sand_audio_tests.py.
// Migrated to scripts/max_harness.py: rec holds 3 channels (gen L, gen R, control tone).
// jsarguments: mode.
// The patch sends `setbuffer <expanded #0-sandwave name>` before DSP.
// `analyze <durationMs>` peeks the recording buffer "rec" and writes the report.

inlets = 1;
outlets = 1;

var mode = jsarguments.length > 1 ? jsarguments[1] : "sine";
var peaks = { gen: -1, ctl: -1, genR: -1 };
var resultPath = "/tmp/sand_audio.txt";
function resultpath(p) { resultPath = String(p); }
var armed = false;
var waveName = "";

function loadbang() {
    post("PROBE_LOADED " + mode + "\n");
}

function setbuffer(name) {
    waveName = name ? ("" + name) : "";
    post("PROBE_WAVE " + waveName + "\n");
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
    var ctl = readChannel(rec, 3, n);
    // Peaks are measured from the recorded window (ch1 = gen L, ch2 = gen R, ch3 = control tone).
    peaks.gen = maxAbs(left);
    peaks.genR = maxAbs(right);
    peaks.ctl = maxAbs(ctl);
    var stats = scan(left, right);
    var corr = correlation(left, right, Math.floor(sr * 0.02));
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(
        "genL " + peaks.gen + "\n" +
        "genR " + peaks.genR + "\n" +
        "ctl " + peaks.ctl + "\n" +
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + stats.nan + "\n" +
        "peak " + stats.peak + "\n" +
        "corr " + corr + "\n" +
        "wave " + waveMax() + "\n" +
        "ch " + rec.channelcount() + "\n"
    );
    report.close();
    post("PROBE_SHUTDOWN " + peaks.gen + " " + peaks.ctl + " " + peaks.genR + " peak " + stats.peak + "\n");
    outlet(0, "bang");
}

function waveMax() {
    if (!waveName) return -1;
    var buf = new Buffer(waveName);
    var chunk = buf.peek(1, 0, 128);
    var peak = 0;
    var i;
    var n = chunk && chunk.length ? chunk.length : 0;
    for (i = 0; i < n; i++) {
        var v = Math.abs(chunk[i]);
        if (v > peak) peak = v;
    }
    return peak;
}

function maxAbs(a) {
    var m = 0;
    for (var i = 0; i < a.length; i++) { var v = Math.abs(a[i]); if (v > m) m = v; }
    return m;
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
        for (k = 0; k < count; k++) out.push(chunk[k]);
    }
    return out;
}

function scan(left, right) {
    var nan = 0;
    var peak = 0;
    var i;
    var v;
    for (i = 0; i < left.length; i++) {
        v = left[i];
        if (v !== v || v === Infinity || v === -Infinity) nan++;
        else if (Math.abs(v) > peak) peak = Math.abs(v);
        v = right[i];
        if (v !== v || v === Infinity || v === -Infinity) nan++;
        else if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    return { nan: nan, peak: peak };
}

function correlation(left, right, skip) {
    var sl = 0;
    var sr = 0;
    var sp = 0;
    var i;
    for (i = skip; i < left.length; i++) {
        sl += left[i] * left[i];
        sr += right[i] * right[i];
        sp += left[i] * right[i];
    }
    if (sl < 1e-12 || sr < 1e-12) return 0;
    return sp / Math.sqrt(sl * sr);
}
