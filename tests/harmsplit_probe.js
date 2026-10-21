// Probe for scripts/run_harmsplit_audio_tests.py (classic js object inside the scripts/max_harness.py scaffold, ES5).
// The harness sends `resultpath <file>` at load and `analyze <durMs>` once buffer~ rec holds the measured window.
// Inlet 0: `setbuffer <telemetry buffer name>` (sent from loadbang), `analyze <durMs>`.
// buffer~ rec holds 6 channels:
//   1 Nonharmonics (left)   2 Harmonics A (left)   3 Harmonics B (left)   4 dry (the stimulus, delayed 4096 samples, or raw in the
//   latency case)   5 All (left, Output = All)   6 Harmonics A (right; the stimulus' right channel is half the left)
// Writes `key value` lines: energies, the sum null, per-harmonic energies (Goertzel at 220 * h, h = 1..12) and at the points half
// way between harmonics (220 * (h + 0.5), h = 1..6) for the three channels, impulse positions, telemetry scalars.

inlets = 1;
outlets = 1;

var resultPath = "";
var scopeName = "";
var armed = false;
var F0 = 220.0;

function resultpath(p) { resultPath = String(p); }
function setbuffer(name) { scopeName = name ? String(name) : ""; }

function readChannel(buf, channel, n) {
    var out = [];
    for (var i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var chunk = buf.peek(channel, i, count);
        if (typeof chunk === "number") chunk = [chunk];
        if (!chunk) {
            for (var k = 0; k < count; k++) out.push(0);
            continue;
        }
        for (var j = 0; j < chunk.length; j++) out.push(chunk[j]);
    }
    return out;
}

function peakIndex(a) {
    var best = -1;
    var idx = -1;
    for (var i = 0; i < a.length; i++) {
        var v = Math.abs(a[i]);
        if (v > best) {
            best = v;
            idx = i;
        }
    }
    return { idx: idx, peak: best < 0 ? 0 : best };
}

// energy (amplitude squared) of the component at f Hz, recursive Goertzel
function goertzel(x, f, sr) {
    var w = 2 * Math.PI * f / sr;
    var c = 2 * Math.cos(w);
    var s1 = 0, s2 = 0;
    for (var i = 0; i < x.length; i++) {
        var s0 = x[i] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    var p = s1 * s1 + s2 * s2 - c * s1 * s2;
    var amp = 2 * Math.sqrt(Math.max(p, 0)) / x.length;
    return amp * amp;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var sr = rec.length() > 0 ? frames / (rec.length() / 1000.0) : 48000.0;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000.0 + 0.5)));
    var N = readChannel(rec, 1, n);
    var A = readChannel(rec, 2, n);
    var B = readChannel(rec, 3, n);
    var D = readChannel(rec, 4, n);
    var ALL = readChannel(rec, 5, n);
    var AR = readChannel(rec, 6, n);

    var nan = 0;
    var eN = 0, eA = 0, eB = 0, eD = 0, eAll = 0, eAR = 0, nullE = 0, nullAll = 0;
    for (var i = 0; i < n; i++) {
        var a = N[i], b = A[i], c = B[i], d = D[i], t = ALL[i], r = AR[i];
        if (!isFinite(a + b + c + d + t + r)) {
            nan++;
            continue;
        }
        eN += a * a;
        eA += b * b;
        eB += c * c;
        eD += d * d;
        eAll += t * t;
        eAR += r * r;
        var s = a + b + c - d;
        nullE += s * s;
        var s2 = t - d;
        nullAll += s2 * s2;
    }
    var pn = peakIndex(N), pa = peakIndex(A), pb = peakIndex(B), pall = peakIndex(ALL), pd = peakIndex(D);

    var lines = "";
    if (n > 4096) {
        var chans = [N, A, B];
        var names = ["n", "a", "b"];
        for (var ch = 0; ch < 3; ch++) {
            for (var h = 1; h <= 12; h++) lines += "g" + names[ch] + h + " " + goertzel(chans[ch], F0 * h, sr) + "\n";
            for (var m = 1; m <= 6; m++) lines += "m" + names[ch] + m + " " + goertzel(chans[ch], F0 * (m + 0.5), sr) + "\n";
            lines += "g" + names[ch] + "15 " + goertzel(chans[ch], F0 * 15, sr) + "\n";
            lines += "g" + names[ch] + "20 " + goertzel(chans[ch], F0 * 20, sr) + "\n";
        }
    }

    // telemetry
    var scopeFrame = 0, scopeN = 0, scopeAwake = 0, scopeLat = 0, scopeSel = 0, preMax = 0, nhMax = 0, aMax = 0, bMax = 0;
    var f0 = 0, conf = 0, voiced = 0, lvl = 0, nact = 0, threff = 0;
    if (scopeName) {
        var vals = new Buffer(scopeName).peek(1, 0, 544);
        if (vals && vals.length >= 524) {
            for (var q = 0; q < 128; q++) {
                if (vals[q] > preMax) preMax = vals[q];
                if (vals[128 + q] > nhMax) nhMax = vals[128 + q];
                if (vals[256 + q] > aMax) aMax = vals[256 + q];
                if (vals[384 + q] > bMax) bMax = vals[384 + q];
            }
            scopeFrame = vals[512];
            scopeN = vals[514];
            scopeAwake = vals[515];
            f0 = vals[517];
            conf = vals[518];
            voiced = vals[519];
            lvl = vals[520];
            scopeLat = vals[521];
            scopeSel = vals[522];
            nact = vals[523];
            threff = vals[524];
        }
    }

    var report = new File(resultPath, "write", "TEXT");
    report.writestring(
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + nan + "\n" +
        "energyN " + eN + "\n" +
        "energyA " + eA + "\n" +
        "energyB " + eB + "\n" +
        "energyD " + eD + "\n" +
        "energyAll " + eAll + "\n" +
        "nullE " + nullE + "\n" +
        "nullAll " + nullAll + "\n" +
        "ratioR " + (eA > 0 ? Math.sqrt(eAR / eA) : 0) + "\n" +
        "peakN " + pn.peak + "\n" +
        "peakA " + pa.peak + "\n" +
        "peakB " + pb.peak + "\n" +
        "peakAll " + pall.peak + "\n" +
        "peakD " + pd.peak + "\n" +
        "idxAll " + pall.idx + "\n" +
        "idxD " + pd.idx + "\n" +
        "scopeFrame " + scopeFrame + "\n" +
        "scopeN " + scopeN + "\n" +
        "scopeAwake " + scopeAwake + "\n" +
        "scopeLat " + scopeLat + "\n" +
        "scopeSel " + scopeSel + "\n" +
        "scopePreMax " + preMax + "\n" +
        "scopeNhMax " + nhMax + "\n" +
        "scopeAMax " + aMax + "\n" +
        "scopeBMax " + bMax + "\n" +
        "scopeF0 " + f0 + "\n" +
        "scopeConf " + conf + "\n" +
        "scopeVoiced " + voiced + "\n" +
        "scopeLvl " + lvl + "\n" +
        "scopeNact " + nact + "\n" +
        "scopeThrEff " + threff + "\n" +
        lines
    );
    report.close();
    outlet(0, "bang");
}
