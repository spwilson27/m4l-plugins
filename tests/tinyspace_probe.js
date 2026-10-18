// Audio probe for scripts/run_tinyspace_audio_tests.py.
// jsarguments: mode, config kind.
// The patch sends `setbuffer <expanded #0-tsconfig name>` before DSP.
// `analyze <durationMs>` peeks the recording buffer "rec" and writes the report.
// The report file is created only here, so the runner does not treat an empty
// file as a finished measurement.

inlets = 4;
outlets = 3;

var mode = jsarguments.length > 1 ? jsarguments[1] : "sine";
var cfgKind = jsarguments.length > 2 ? jsarguments[2] : "single";
var peaks = { gen: -1, ctl: -1, genR: -1 };
var armed = false;
var meterName = "";

function loadbang() {
    post("PROBE_LOADED " + mode + " " + cfgKind + "\n");
}

function setbuffer(name, meters) {
    var data = buildData(cfgKind);
    var buf = new Buffer(name);
    buf.poke(1, 0, data);
    meterName = meters ? ("" + meters) : "";
    var early = 0;
    if (meterName) {
        var mb = new Buffer(meterName);
        var pre = mb.peek(1, 0, 4);
        early = pre && pre.length ? pre[0] : -1;
        post("PROBE_METERS_EARLY frames " + mb.framecount() + " s0 " + early + "\n");
    }
    post("PROBE_CONFIG " + name + " " + buf.framecount() + "\n");
}

function msg_float(v) {
    if (inlet === 0) peaks.gen = v;
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
    var env = envelope(left, right, sr);
    var stats = scan(left, right);
    var corr = correlation(left, right, Math.floor(sr * 0.02));
    var meterPeak = meterMax();
    var report = new File("/tmp/tinyspace_audio.txt", "write", "TEXT");
    report.writestring(
        "genL " + peaks.gen + "\n" +
        "genR " + peaks.genR + "\n" +
        "ctl " + peaks.ctl + "\n" +
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + stats.nan + "\n" +
        "peak " + stats.peak + "\n" +
        "corr " + corr + "\n" +
        "meter " + meterPeak + "\n" +
        "env " + env.join(" ") + "\n"
    );
    report.close();
    post("PROBE_SHUTDOWN " + peaks.gen + " " + peaks.ctl + " " + peaks.genR + " peak " + stats.peak + "\n");
    outlet(0, "bang");
}

function meterMax() {
    if (!meterName) return -1;
    var buf = new Buffer(meterName);
    var chunk = buf.peek(1, 0, 20);
    var peak = 0;
    var i;
    var n = chunk && chunk.length ? chunk.length : 0;
    for (i = 0; i < n; i++) {
        var v = Math.abs(chunk[i]);
        if (v > peak) peak = v;
    }
    post("PROBE_METERS name " + meterName + " frames " + buf.framecount() + " n " + n + " s0 " + (n ? chunk[0] : 0) + " s1 " + (n > 1 ? chunk[1] : 0) + " s3 " + (n > 3 ? chunk[3] : 0) + "\n");
    return peak;
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

function scan(left, right) {
    var nan = 0;
    var peak = 0;
    var i, v;
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

function blank() {
    var d = [];
    var i;
    for (i = 0; i < 70; i++) d.push(0);
    d[2] = 0.05;
    d[3] = 0.05;
    d[4] = 0.05;
    d[5] = 0.05;
    return d;
}

function buildData(kind) {
    var d = blank();
    var i;
    if (kind === "room") {
        d[0] = 10;
        d[1] = 1;
        d[2] = 0.6;
        d[3] = 1.3;
        d[4] = 2.4;
        d[5] = 4.2;
        d[6] = 0.6;
        d[7] = 0.55;
        d[8] = 0.5;
        d[9] = 0.45;
        var lensL = [5, 9, 14, 22, 36, 7, 12, 18, 28, 44];
        var lensR = [6, 11, 16, 25, 40, 8, 13, 20, 31, 47];
        for (i = 0; i < 10; i++) {
            d[10 + i] = lensL[i];
            d[20 + i] = lensR[i];
        }
        return d;
    }
    if (kind === "comb") {
        d[0] = 2;
        d[10] = 10;
        d[20] = 10;
        return d;
    }
    if (kind === "width") {
        d[0] = 2;
        d[10] = 12;
        d[20] = 27;
        return d;
    }
    if (kind === "decay") {
        d[0] = 2;
        d[10] = 6;
        d[20] = 6;
        return d;
    }
    d[0] = 2;
    d[10] = 20;
    d[20] = 20;
    return d;
}
