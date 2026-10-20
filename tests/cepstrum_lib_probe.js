// Probe for scripts/run_cepstrum_lib_audio_tests.py.
// Patch inlet 0: `analyze <samples> <maxLag>` (audio cases) or floats from [adstatus cpu] (cpu case).
// Inlet 1 (cpu case): [snapshot~] of the noise source, to prove the DSP chain is running.
// The recording buffer "rec" holds 4 channels: 1 = gen out1, 2 = dry input,
// 3 = gen out2 (pitch quefrency), 4 = gen out3 (pitch confidence).
// jsarguments: result file path, skip (samples to ignore at the start).

inlets = 2;
outlets = 1;

var reportPath = jsarguments.length > 1 ? jsarguments[1] : "/tmp/cepstrum_lib_audio.txt";
var skip = jsarguments.length > 2 ? parseInt(jsarguments[2], 10) : 16384;
var cpuSamples = [];
var armed = false;
var alive = 0;

function loadbang() {
    post("PROBE_LOADED\n");
}

function msg_float(v) {
    // Inlet 1: [snapshot~] of the noise source; nonzero means DSP is running.
    if (inlet === 1) { if (v !== 0) alive++; return; }
    cpuSamples.push(v);
}

function read(rec, ch, n) {
    return rec.peek(ch, 0, n);
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

// Lag (0..maxLag) where out[t + lag] best matches in[t], by normalized
// correlation over a window; then the gain and the error at that lag.
function align(out, dry, from, len, maxLag) {
    var best = -1e9;
    var bestLag = 0;
    var ed = 0;
    for (var t = 0; t < len; t++) ed += dry[from + t] * dry[from + t];
    for (var lag = 0; lag <= maxLag; lag++) {
        var d = 0;
        var eo = 0;
        for (var t2 = 0; t2 < len; t2 += 1) {
            var o = out[from + t2 + lag];
            d += o * dry[from + t2];
            eo += o * o;
        }
        var c = d / Math.sqrt(Math.max(ed * eo, 1e-30));
        if (c > best) { best = c; bestLag = lag; }
    }
    return { lag: bestLag, corr: best };
}

function median(arr) {
    var a = arr.slice().sort(function (p, q) { return p - q; });
    return a.length ? a[Math.floor(a.length / 2)] : 0;
}

function analyze(nSamples, maxLag) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var n = Math.max(0, Math.min(rec.framecount(), nSamples));
    var out = read(rec, 1, n);
    var dry = read(rec, 2, n);
    var qs = read(rec, 3, n);
    var cs = read(rec, 4, n);
    var so = stats(out, skip, n);
    var sd = stats(dry, skip, n);
    var len = Math.min(8192, n - skip - maxLag - 1);
    var al = align(out, dry, skip, len, maxLag);
    // Error and gain at the best lag.
    var e2 = 0;
    var d2 = 0;
    var o2 = 0;
    var maxErr = 0;
    var maxStep = 0;
    var prev = 0;
    for (var t = 0; t < len; t++) {
        var o = out[skip + t + al.lag];
        var x = dry[skip + t];
        var er = o - x;
        e2 += er * er;
        d2 += x * x;
        o2 += o * o;
        if (Math.abs(er) > maxErr) maxErr = Math.abs(er);
        if (t > 0 && Math.abs(o - prev) > maxStep) maxStep = Math.abs(o - prev);
        prev = o;
    }
    var gainDb = d2 > 0 && o2 > 0 ? 10 * Math.log(o2 / d2) / Math.LN10 : -200;
    var errDb = d2 > 0 ? 10 * Math.log(Math.max(e2, 1e-30) / d2) / Math.LN10 : 0;
    var tailQ = [];
    var tailC = [];
    for (var i = n - 4096; i < n; i += 64) { tailQ.push(qs[i]); tailC.push(cs[i]); }
    var report = new File(reportPath, "write", "TEXT");
    report.writestring(
        "frames " + n + "\n" +
        "lag " + al.lag + "\n" +
        "corr " + al.corr + "\n" +
        "gaindb " + gainDb + "\n" +
        "errdb " + errDb + "\n" +
        "maxerr " + maxErr + "\n" +
        "maxstep " + maxStep + "\n" +
        "outrms " + so.rms + "\n" +
        "outpeak " + so.peak + "\n" +
        "dryrms " + sd.rms + "\n" +
        "nan " + so.nan + "\n" +
        "tiny " + so.tiny + "\n" +
        "q " + median(tailQ) + "\n" +
        "conf " + median(tailC) + "\n"
    );
    report.close();
    post("PROBE_DONE lag " + al.lag + " gain " + gainDb + "\n");
    outlet(0, "bang");
}

// CPU case: mean of the samples after a warm-up (first 40% dropped).
function finish() {
    if (armed) return;
    armed = true;
    var from = Math.floor(cpuSamples.length * 0.4);
    var s = 0;
    var peak = 0;
    var cnt = 0;
    for (var i = from; i < cpuSamples.length; i++) {
        s += cpuSamples[i];
        if (cpuSamples[i] > peak) peak = cpuSamples[i];
        cnt++;
    }
    var report = new File(reportPath, "write", "TEXT");
    report.writestring("cpu " + (cnt ? s / cnt : -1) + "\ncpupeak " + peak + "\nsamples " + cnt + "\nalive " + alive + "\n");
    report.close();
    post("PROBE_CPU " + (cnt ? s / cnt : -1) + "\n");
    outlet(0, "bang");
}
