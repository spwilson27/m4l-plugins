// Probe for scripts/run_phasefold_audio_tests.py (Max js object).
// Patch inlet 0: `analyze <samples>`.
// buffer~ "rec" holds 4 channels: 1 = Phase Fold out1, 2 = dry source,
// 3 = Phase Fold out2, 4 = samplerate / 100000 (from the source generator).
// buffer~ "pfscope" is the device's telemetry buffer.
// jsarguments: result file path, skip (samples ignored at the start).

inlets = 1;
outlets = 1;

var reportPath = jsarguments.length > 1 ? jsarguments[1] : "/tmp/phasefold_audio.txt";
var skip = jsarguments.length > 2 ? parseInt(jsarguments[2], 10) : 24000;
var armed = false;
var LAG = 4096;

function loadbang() {
    post("PROBE_LOADED\n");
}

function stats(sig, from, to) {
    var s = 0;
    var peak = 0;
    var nan = 0;
    var tiny = 0;
    for (var i = from; i < to; i++) {
        var v = sig[i];
        if (v !== v || Math.abs(v) === Infinity) { nan++; continue; }
        s += v * v;
        var a = Math.abs(v);
        if (a > peak) peak = a;
        if (a > 0 && a < 1e-30) tiny++;
    }
    return { rms: Math.sqrt(s / Math.max(1, to - from)), peak: peak, nan: nan, tiny: tiny };
}

function median(arr) {
    var a = arr.slice().sort(function (p, q) { return p - q; });
    return a.length ? a[Math.floor(a.length / 2)] : 0;
}

function peekOne(buf, ch, idx) {
    var v = buf.peek(ch, idx, 1);
    if (typeof v === "number") return v;
    return v && v.length ? v[0] : 0;
}

function analyze(nSamples) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var n = Math.max(0, Math.min(rec.framecount(), nSamples));
    var out = rec.peek(1, 0, n);
    var dry = rec.peek(2, 0, n);
    var outR = rec.peek(3, 0, n);
    var srv = rec.peek(4, 0, n);
    var sr = Math.round(median([srv[n - 100], srv[n - 2000], srv[n - 4000], srv[n - 6000], srv[n - 8000]]) * 1e5);

    var so = stats(out, skip, n);
    var sr2 = stats(outR, skip, n);
    var end = n - LAG - 1;

    // Level at the constant lag: out[t + 4096] against dry[t].
    var o2 = 0;
    var d2 = 0;
    var e2 = 0;
    var maxStep = 0;
    var prev = out[skip];
    for (var t = skip; t < end; t++) {
        var o = out[t + LAG];
        var x = dry[t];
        o2 += o * o;
        d2 += x * x;
        e2 += (o - x) * (o - x);
    }
    for (var s = skip + 1; s < n; s++) {
        var st = Math.abs(out[s] - out[s - 1]);
        if (st > maxStep) maxStep = st;
    }
    var gainDb = d2 > 0 && o2 > 0 ? 10 * Math.log(o2 / d2) / Math.LN10 : -200;
    var errDb = d2 > 0 ? 10 * Math.log(Math.max(e2, 1e-30) / d2) / Math.LN10 : 0;

    // Best lag by correlation, searched around 4096 (and 0..8191 coarse for stray latency).
    var len = Math.min(8000, end - skip);
    var best = -1e9;
    var bestLag = -1;
    var ed = 0;
    for (var i = 0; i < len; i++) ed += dry[skip + i] * dry[skip + i];
    for (var lag = 3900; lag <= 4300; lag++) {
        var dd = 0;
        var eo = 0;
        for (var k = 0; k < len; k++) {
            var oo = out[skip + k + lag];
            dd += oo * dry[skip + k];
            eo += oo * oo;
        }
        var c = dd / Math.sqrt(Math.max(ed * eo, 1e-30));
        if (c > best) { best = c; bestLag = lag; }
    }

    // Pre-ring: output energy before each dry onset (in the delayed timeline).
    var dpk = 0;
    for (var q = skip; q < n; q++) if (Math.abs(dry[q]) > dpk) dpk = Math.abs(dry[q]);
    var thr = dpk * 0.25;
    var preSum = 0;
    var preCnt = 0;
    var preWin = 1800;
    var post = 9000;
    var p = skip;
    while (p < n - LAG - post - 10) {
        if (Math.abs(dry[p]) > thr) {
            var a = p + LAG - preWin;
            var pre = 0;
            var all = 0;
            for (var u = a; u < p + LAG + post; u++) {
                var ee = out[u] * out[u];
                all += ee;
                if (u < p + LAG - 50) pre += ee;
            }
            if (all > 0) { preSum += pre / all; preCnt++; }
            p += Math.floor(sr * 0.3);
        } else {
            p++;
        }
    }

    // Telemetry buffer.
    var tb = new Buffer("pfscope");
    var tail = [];
    var wenv = 0;
    var e = tb.peek(3, 0, 256);
    for (var m = 0; m < 256; m++) if (Math.abs(e[m]) > wenv) wenv = Math.abs(e[m]);
    tail.push("beat " + peekOne(tb, 2, 256));
    tail.push("nact " + peekOne(tb, 3, 256));
    tail.push("wgate " + peekOne(tb, 4, 256));
    tail.push("cin " + peekOne(tb, 1, 257));
    tail.push("cout " + peekOne(tb, 2, 257));
    tail.push("pivot " + peekOne(tb, 3, 257));
    tail.push("gdb " + peekOne(tb, 4, 257));
    tail.push("wenv " + wenv);

    // Level of the last second of the sine switch tests (rms of the tail).
    var tailOut = stats(out, n - 8192, n);
    var tailDry = stats(dry, n - 8192 - LAG, n - LAG);

    var report = new File(reportPath, "write", "TEXT");
    report.writestring(
        "frames " + n + "\n" +
        "sr " + sr + "\n" +
        "lag " + bestLag + "\n" +
        "corr " + best + "\n" +
        "gaindb " + gainDb + "\n" +
        "errdb " + errDb + "\n" +
        "maxstep " + maxStep + "\n" +
        "outrms " + so.rms + "\n" +
        "outpeak " + so.peak + "\n" +
        "outrpeak " + sr2.peak + "\n" +
        "dryrms " + Math.sqrt(d2 / Math.max(1, end - skip)) + "\n" +
        "nan " + (so.nan + sr2.nan) + "\n" +
        "tiny " + so.tiny + "\n" +
        "pre " + (preCnt ? preSum / preCnt : -1) + "\n" +
        "onsets " + preCnt + "\n" +
        "tailout " + tailOut.rms + "\n" +
        "taildry " + tailDry.rms + "\n" +
        tail.join("\n") + "\n"
    );
    report.close();
    post("PROBE_DONE lag " + bestLag + " gain " + gainDb + " pre " + (preCnt ? preSum / preCnt : -1) + "\n");
    outlet(0, "bang");
}
