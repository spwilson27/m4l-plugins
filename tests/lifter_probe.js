// Probe for scripts/run_lifter_audio_tests.py (scripts/max_harness.py contract).
// Patch messages: `resultpath <file>`, `setbuffer <scope> <curve>` and `curve <256 dB values>` (any order),
// `analyze <dur_ms>` once buffer "rec" holds the measured window.
// "rec" channels: 1 = out L, 2 = dry input, 3 = out R.
// jsarguments: maxLag (0 = skip the alignment), f0 (0 = skip the harmonicity measure).

inlets = 1;
outlets = 1;

var reportPath = "/tmp/lifter_audio.txt";
var maxLagArg = jsarguments.length > 1 ? parseInt(jsarguments[1], 10) : 0;
var f0Arg = jsarguments.length > 2 ? parseFloat(jsarguments[2]) : 0;
var skip = 0;
var scopeName = "";
var curveName = "";
var curveVals = null;
var curveApplied = false;
var snapHop = -1;
var armed = false;

function resultpath(p) {
    reportPath = "" + p;
}

function loadbang() {
    post("PROBE_LOADED\n");
}

function setbuffer(a, b) {
    scopeName = "" + a;
    curveName = "" + b;
    tryApply();
}

function curve() {
    curveVals = arrayfromargs(arguments);
    tryApply();
}

function tryApply() {
    if (curveApplied || !curveName || !curveVals) return;
    var b = new Buffer(curveName);
    b.poke(1, 0, curveVals);
    curveApplied = true;
    post("PROBE_CURVE " + curveVals.length + "\n");
}

function readScope() {
    if (!scopeName) return null;
    var b = new Buffer(scopeName);
    return b.peek(1, 0, 400);
}

function readChannel(rec, ch, n) {
    var out = [];
    for (var i = 0; i < n; i += 8192) {
        var count = Math.min(8192, n - i);
        var chunk = rec.peek(ch, i, count);
        if (typeof chunk === "number") chunk = [chunk];
        for (var k = 0; k < count; k++) out.push(chunk && k < chunk.length ? chunk[k] : 0);
    }
    return out;
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

function maxStep(sig, from, to) {
    var m = 0;
    for (var i = from + 1; i < to; i++) {
        var d = Math.abs(sig[i] - sig[i - 1]);
        if (d > m) m = d;
    }
    return m;
}

// Lag (0..maxLag) where out[t + lag] best matches in[t].
function align(out, dry, from, len, maxLag) {
    var best = -1e9;
    var bestLag = 0;
    var ed = 0;
    for (var t = 0; t < len; t++) ed += dry[from + t] * dry[from + t];
    for (var lag = 0; lag <= maxLag; lag++) {
        var d = 0;
        var eo = 0;
        for (var t2 = 0; t2 < len; t2++) {
            var o = out[from + t2 + lag];
            d += o * dry[from + t2];
            eo += o * o;
        }
        var c = d / Math.sqrt(Math.max(ed * eo, 1e-30));
        if (c > best) { best = c; bestLag = lag; }
    }
    return { lag: bestLag, corr: best };
}

function fftInPlace(re, im) {
    var n = re.length;
    var j = 0;
    var i;
    for (i = 0; i < n - 1; i++) {
        if (i < j) {
            var tr = re[i]; re[i] = re[j]; re[j] = tr;
            var ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
        var m = n >> 1;
        while (m >= 1 && j >= m) { j -= m; m >>= 1; }
        j += m;
    }
    for (var len = 2; len <= n; len <<= 1) {
        var half = len >> 1;
        var ang = -2 * Math.PI / len;
        for (var s = 0; s < n; s += len) {
            for (var k = 0; k < half; k++) {
                var wr = Math.cos(ang * k);
                var wi = Math.sin(ang * k);
                var a = s + k;
                var b = a + half;
                var xr = re[b] * wr - im[b] * wi;
                var xi = re[b] * wi + im[b] * wr;
                re[b] = re[a] - xr;
                im[b] = im[a] - xi;
                re[a] += xr;
                im[a] += xi;
            }
        }
    }
}

// Mean (harmonic peak dB - valley dB) over harmonics 2.. of f0; same metric as tests/lifter_ref.js.
function peakToValley(sig, start, len, f0, sr) {
    var re = [];
    var im = [];
    var i;
    for (i = 0; i < len; i++) {
        re.push(sig[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / len)));
        im.push(0);
    }
    fftInPlace(re, im);
    var df = sr / len;
    var sum = 0;
    var cnt = 0;
    function db(k) { return 20 * Math.log(Math.sqrt(re[k] * re[k] + im[k] * im[k]) + 1e-12) / Math.LN10; }
    for (var h = 2; h * f0 < 9000 && h <= 30; h++) {
        var kp = Math.round(h * f0 / df);
        var kv = Math.round((h + 0.5) * f0 / df);
        var pk = -1e9;
        var k;
        for (k = kp - 2; k <= kp + 2; k++) pk = Math.max(pk, db(k));
        var vs = 0;
        for (k = kv - 3; k <= kv + 3; k++) vs += db(k);
        sum += pk - vs / 7;
        cnt++;
    }
    return cnt ? sum / cnt : 0;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var maxLag = maxLagArg;
    var f0 = f0Arg;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var sr = frames / (rec.length() / 1000);
    var n = frames;
    var outL = readChannel(rec, 1, n);
    var dry = readChannel(rec, 2, n);
    var outR = readChannel(rec, 3, n);
    var so = stats(outL, skip, n);
    var sr2 = stats(outR, skip, n);
    var sd = stats(dry, skip, n);
    var lag = 0;
    var corr = 0;
    var gainDb = 0;
    var errDb = 0;
    var maxErr = 0;
    var errR = 0;
    if (maxLag > 0) {
        var len = Math.min(8192, n - skip - maxLag - 1);
        var al = align(outL, dry, skip, len, maxLag);
        lag = al.lag;
        corr = al.corr;
        var e2 = 0, d2 = 0, o2 = 0;
        for (var t = 0; t < len; t++) {
            var o = outL[skip + t + lag];
            var x = dry[skip + t];
            var er = o - x;
            e2 += er * er;
            d2 += x * x;
            o2 += o * o;
            if (Math.abs(er) > maxErr) maxErr = Math.abs(er);
            var erR = Math.abs(outR[skip + t + lag] - x);
            if (erR > errR) errR = erR;
        }
        gainDb = d2 > 0 && o2 > 0 ? 10 * Math.log(o2 / d2) / Math.LN10 : -200;
        errDb = d2 > 0 ? 10 * Math.log(Math.max(e2, 1e-30) / d2) / Math.LN10 : 0;
    }
    var p2vOut = 0;
    var p2vDry = 0;
    if (f0 > 0 && n - skip >= 16384 + 4096) {
        p2vOut = peakToValley(outL, skip + 4096, 16384, f0, sr);
        p2vDry = peakToValley(dry, skip, 16384, f0, sr);
    }
    var stepOut = maxStep(outL, 2048, n);
    var stepDry = maxStep(dry, 2048, n);
    var d = readScope();
    var tele = { hop: -1, q: 0, conf: 0, sr: 0, n: 0, inpk: 0, outpk: 0, silent: -1, specn: 0, specin: -999, cepmax: 0 };
    if (d && d.length >= 394) {
        tele.hop = d[386]; tele.q = d[384]; tele.conf = d[385]; tele.sr = d[389]; tele.n = d[390];
        tele.inpk = d[387]; tele.outpk = d[388]; tele.silent = d[392];
        for (var c = 0; c < 64; c++) {
            if (d[256 + c] > -900) { tele.specn++; if (d[256 + c] > tele.specin) tele.specin = d[256 + c]; }
        }
        for (var q = 0; q < 128; q++) if (d[q] > tele.cepmax) tele.cepmax = d[q];
    }
    var report = new File(reportPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(
        "frames " + n + "\n" +
        "sr " + sr + "\n" +
        "lag " + lag + "\n" +
        "corr " + corr + "\n" +
        "gaindb " + gainDb + "\n" +
        "errdb " + errDb + "\n" +
        "maxerr " + maxErr + "\n" +
        "errr " + errR + "\n" +
        "outrms " + so.rms + "\n" +
        "outpeak " + so.peak + "\n" +
        "dryrms " + sd.rms + "\n" +
        "nan " + (so.nan + sr2.nan) + "\n" +
        "tiny " + (so.tiny + sr2.tiny) + "\n" +
        "p2vout " + p2vOut + "\n" +
        "p2vdry " + p2vDry + "\n" +
        "stepout " + stepOut + "\n" +
        "stepdry " + stepDry + "\n" +
        "thop " + tele.hop + "\n" +
        "thop0 " + snapHop + "\n" +
        "tq " + tele.q + "\n" +
        "tconf " + tele.conf + "\n" +
        "tsr " + tele.sr + "\n" +
        "tn " + tele.n + "\n" +
        "tinpk " + tele.inpk + "\n" +
        "toutpk " + tele.outpk + "\n" +
        "tsilent " + tele.silent + "\n" +
        "tspecn " + tele.specn + "\n" +
        "tspecin " + tele.specin + "\n" +
        "tcepmax " + tele.cepmax + "\n" +
        "tdbg0 " + (d && d.length > 396 ? d[394] : 0) + "\ntdbg1 " + (d && d.length > 396 ? d[395] : 0) + "\ntdbg2 " + (d && d.length > 396 ? d[396] : 0) + "\n"
    );
    report.close();
    post("PROBE_DONE lag " + lag + " gain " + gainDb + " p2v " + p2vOut + "/" + p2vDry + "\n");
    outlet(0, "bang");
}
