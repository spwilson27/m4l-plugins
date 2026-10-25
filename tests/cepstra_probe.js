// Audio probe for scripts/run_cepstra_audio_tests.py.
// Synthesizes the vowel-like test stimulus (impulse train -> three formant resonators, optional noise) into
// buffer~ src on `setbuffer`, then analyzes the recorded buffer~ rec (ch1 = Cepstra out L, ch2 = raw input L)
// and the telemetry in ---cepscope. Run through scripts/max_harness.py: `resultpath <file>` is sent at load,
// `analyze <dur_ms>` once `rec` holds exactly the measured window (NonRealTime, 48 kHz). Writes the result ONLY
// inside analyze(). `cpu <percent>` messages (audio_device mode only) feed the CPU statistics.

inlets = 1;
outlets = 1;

var STIM_SR = 48000; // the harness forces `dsp sr 48000`
var resultPath = "/tmp/cepstra_audio.txt";

var mode = jsarguments.length > 1 ? jsarguments[1] : "vowel";
var ltot = jsarguments.length > 2 ? Number(jsarguments[2]) : 2304;
var f0Hz = 120;
var cpuMax = 0;
var cpuSum = 0;
var cpuCount = 0;
var armed = false;
var scopeName = "";

function loadbang() {
    post("CEPSTRA_PROBE_LOADED " + mode + "\n");
}

function lcg(seed) {
    var s = seed % 4294967296;
    return function () {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };
}

function resonator(x, freq, bw, sr) {
    var r = Math.exp(-Math.PI * bw / sr);
    var th = 2 * Math.PI * freq / sr;
    var a1 = -2 * r * Math.cos(th);
    var a2 = r * r;
    var g = 1 - r;
    var y = new Array(x.length);
    var y1 = 0, y2 = 0;
    for (var i = 0; i < x.length; i++) {
        var v = g * x[i] - a1 * y1 - a2 * y2;
        y[i] = v;
        y2 = y1;
        y1 = v;
    }
    return y;
}

function makeStimulus(n, sr) {
    var x = new Array(n);
    var i;
    for (i = 0; i < n; i++) x[i] = 0;
    if (mode === "silent") return x;
    var period = sr / f0Hz;
    for (var p = 0; p < n; p += period) x[Math.round(p)] = 1;
    var a = resonator(x, 700, 90, sr);
    var b = resonator(x, 1220, 110, sr);
    var c = resonator(x, 2600, 160, sr);
    var out = new Array(n);
    var pk = 1e-9;
    for (i = 0; i < n; i++) {
        out[i] = a[i] + 0.7 * b[i] + 0.4 * c[i];
        if (Math.abs(out[i]) > pk) pk = Math.abs(out[i]);
    }
    var rnd = lcg(12345);
    var noiseAmp = (mode === "vowelnoise") ? 0.012 : ((mode === "vowelgaps") ? 0.03 : 0);
    for (i = 0; i < n; i++) {
        // vowelgaps: vowel on for the first 0.25 s of every 0.5 s, noise throughout (voicing-gate test)
        var on = (mode !== "vowelgaps") || ((i / sr) % 0.5 < 0.25);
        out[i] = (on ? 0.4 * out[i] / pk : 0) + noiseAmp * (rnd() * 2 - 1);
    }
    return out;
}

function setbuffer(sName) {
    scopeName = sName ? ("" + sName) : "";
    var src = new Buffer("cepstra_src");
    var n = src.framecount();
    var ms = src.length();
    var sr = STIM_SR; // buffer~ src is sized in samples (1 s at 48 kHz), so its stamped sr may differ from the DSP rate
    src.poke(1, 0, makeStimulus(n, sr));
    post("CEPSTRA_SRC_POKED frames " + n + " sr " + sr + "\n");
}

function resultpath(p) {
    resultPath = "" + p;
}

// CPU % from `adstatus cpu` (audio_device mode); NonRealTime has no meaningful real-time load.
function cpu(v) {
    cpuMax = Math.max(cpuMax, v);
    cpuSum += v;
    cpuCount++;
}

function readChannel(buf, channel, n) {
    var out = [];
    var i, k;
    for (i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var chunk = buf.peek(channel, i, count);
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

// In-place radix-2 FFT (ES5).
function fft(re, im) {
    var n = re.length;
    var i, j, k, m;
    for (i = 1, j = 0; i < n; i++) {
        var bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            var tr = re[i]; re[i] = re[j]; re[j] = tr;
            var ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }
    for (m = 2; m <= n; m <<= 1) {
        var ang = -2 * Math.PI / m;
        var wr = Math.cos(ang), wi = Math.sin(ang);
        for (i = 0; i < n; i += m) {
            var cr = 1, ci = 0;
            for (k = 0; k < m / 2; k++) {
                var ur = re[i + k], ui = im[i + k];
                var xr = re[i + k + m / 2], xi = im[i + k + m / 2];
                var vr = xr * cr - xi * ci, vi = xr * ci + xi * cr;
                re[i + k] = ur + vr; im[i + k] = ui + vi;
                re[i + k + m / 2] = ur - vr; im[i + k + m / 2] = ui - vi;
                var nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
    }
}

function powerSpectrum(x, start, size) {
    var re = new Array(size), im = new Array(size);
    var i;
    for (i = 0; i < size; i++) {
        var w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size);
        re[i] = (x[start + i] || 0) * w;
        im[i] = 0;
    }
    fft(re, im);
    var p = new Array(size / 2);
    for (i = 0; i < size / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
    return p;
}

function centroid(p, sr, size, lo, hi) {
    var num = 0, den = 1e-30;
    var k0 = Math.floor(lo * size / sr), k1 = Math.min(p.length - 1, Math.floor(hi * size / sr));
    for (var k = k0; k <= k1; k++) {
        num += (k * sr / size) * p[k];
        den += p[k];
    }
    return num / den;
}

function estimateF0(x, start, len, sr) {
    var lagLo = Math.floor(sr / 400), lagHi = Math.floor(sr / 60);
    var best = -1e30, bestLag = lagLo, lag, i;
    var r0 = 1e-30;
    for (i = 0; i < len; i++) r0 += x[start + i] * x[start + i];
    for (lag = lagLo; lag <= lagHi; lag++) {
        var s = 0;
        for (i = 0; i < len - lag; i++) s += x[start + i] * x[start + i + lag];
        if (s > best) { best = s; bestLag = lag; }
    }
    return sr / bestLag;
}

// Energy between partials vs at partials (f0 harmonics +/- 1 bin), 300 Hz..4 kHz, in dB.
function valleyToPeakDb(p, sr, size, f0) {
    var peakE = 1e-30, valE = 1e-30, peakN = 0, valN = 0;
    var kLo = Math.floor(300 * size / sr), kHi = Math.floor(4000 * size / sr);
    for (var k = kLo; k <= kHi; k++) {
        var hz = k * sr / size;
        var h = hz / f0;
        var dist = Math.abs(h - Math.round(h)) * f0 * size / sr; // bins from nearest partial
        if (dist <= 1.5) { peakE += p[k]; peakN++; }
        else if (dist >= 0.35 * f0 * size / sr) { valE += p[k]; valN++; }
    }
    return 10 * Math.log(valE / Math.max(1, valN) / (peakE / Math.max(1, peakN))) / Math.LN10;
}

// Power in +/-1.5 bins around a frequency.
function bandPower(p, sr, size, hz) {
    var kc = Math.round(hz * size / sr), e = 0;
    for (var k = kc - 1; k <= kc + 1; k++) e += p[k];
    return e;
}

// Total power between partials (300 Hz .. 4 kHz, farther than 0.35 f0 from any harmonic).
function betweenPower(p, sr, size, f0) {
    var e = 0;
    var kLo = Math.floor(300 * size / sr), kHi = Math.floor(4000 * size / sr);
    for (var k = kLo; k <= kHi; k++) {
        var h = (k * sr / size) / f0;
        if (Math.abs(h - Math.round(h)) * f0 * size / sr >= 0.35 * f0 * size / sr) e += p[k];
    }
    return e;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    try {
        analyzeImpl(durMs);
    } catch (err) {
        var ef = new File(resultPath + ".err", "write", "TEXT");
        ef.writestring("ERR " + err + " line " + err.lineNumber + "\n");
        ef.close();
        var rf = new File(resultPath, "write", "TEXT");
        rf.eof = 0;
        rf.writestring("probeError 1\n");
        rf.close();
        outlet(0, "bang");
    }
}

function analyzeImpl(durMs) {
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000) : STIM_SR;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var outL = readChannel(rec, 1, n);
    var inL = readChannel(rec, 2, n);

    var nan = 0, peak = 0, i;
    for (i = 0; i < n; i++) {
        var v = outL[i];
        if (v !== v || v === Infinity || v === -Infinity) nan++;
        else if (Math.abs(v) > peak) peak = Math.abs(v);
    }

    // Null / alignment test vs the input delayed by ltot samples, over the last 60% of the capture.
    var d0 = Math.floor(n * 0.4), d1 = n;
    var errSq = 1e-30, refSq = 1e-30, outSq = 1e-30;
    var bestLag = ltot, bestErr = 1e30;
    var lags = [ltot - 2, ltot - 1, ltot, ltot + 1, ltot + 2];
    for (var li = 0; li < lags.length; li++) {
        var e = 0;
        for (i = d0; i < d1; i++) { var dd = outL[i] - (inL[i - lags[li]] || 0); e += dd * dd; }
        if (e < bestErr) { bestErr = e; bestLag = lags[li]; }
    }
    for (i = d0; i < d1; i++) {
        var ref = inL[i - ltot] || 0;
        var df = outL[i] - ref;
        errSq += df * df;
        refSq += ref * ref;
        outSq += outL[i] * outL[i];
    }
    var nullDb = 10 * Math.log(errSq / refSq) / Math.LN10;

    // Spectral analysis of the final 16384 samples
    var segStart = Math.max(0, n - 16384);
    var size = 8192;
    var pOut = powerSpectrum(outL, segStart, size);
    var pIn = powerSpectrum(inL, segStart, size);
    var cOut = centroid(pOut, sr, size, 100, 8000);
    var cIn = centroid(pIn, sr, size, 100, 8000);
    var f0Est = estimateF0(outL, segStart, 6000, sr);
    var f0In = estimateF0(inL, segStart, 6000, sr);
    var vOut = valleyToPeakDb(pOut, sr, size, f0Hz);
    var vIn = valleyToPeakDb(pIn, sr, size, f0Hz);
    var f0Level = 10 * Math.log(bandPower(pOut, sr, size, f0Hz) + 1e-30) / Math.LN10;
    var noiseLevel = 10 * Math.log(betweenPower(pOut, sr, size, f0Hz) + 1e-30) / Math.LN10;

    // Level of the output vs the input in vowel-on and noise-only stretches (classified by the input's own 1024-sample
    // window RMS, skipping windows next to a transition), for the voicing-gate test. dB, output re input.
    var wsz = 1024, nw = Math.floor((n - ltot) / wsz), wr = [], wmax = 0, wmin = 1e30;
    for (var wi = 0; wi < nw; wi++) {
        var es = 0;
        for (i = wi * wsz; i < (wi + 1) * wsz; i++) es += inL[i] * inL[i];
        wr.push(Math.sqrt(es / wsz));
        wmax = Math.max(wmax, wr[wi]);
        wmin = Math.min(wmin, wr[wi]);
    }
    var gapIn = 1e-30, gapOut = 1e-30, voxIn = 1e-30, voxOut = 1e-30;
    for (wi = 1; wi < nw - 1; wi++) {
        var nb = function (r) { return (r < 1.5 * wmin && r < 0.5 * wmax) ? 0 : ((r > 0.5 * wmax) ? 1 : -1); };
        var cls = nb(wr[wi]);
        if (cls < 0 || nb(wr[wi - 1]) !== cls || nb(wr[wi + 1]) !== cls) continue;
        var ei = 0, eo = 0;
        for (i = wi * wsz; i < (wi + 1) * wsz; i++) { ei += inL[i] * inL[i]; eo += outL[i + ltot] * outL[i + ltot]; }
        if (cls === 0) { gapIn += ei; gapOut += eo; } else { voxIn += ei; voxOut += eo; }
    }
    var gapDb = 10 * Math.log(gapOut / gapIn) / Math.LN10, voxDb = 10 * Math.log(voxOut / voxIn) / Math.LN10;

    var sc = readScope();
    var lastQuarter = 0;
    for (i = Math.floor(n * 0.75); i < n; i++) lastQuarter = Math.max(lastQuarter, Math.abs(outL[i]));

    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + nan + "\n" +
        "peak " + peak + "\n" +
        "tailPeak " + lastQuarter + "\n" +
        "nullDb " + nullDb + "\n" +
        "bestLag " + bestLag + "\n" +
        
        "outRms " + Math.sqrt(outSq / (d1 - d0)) + "\n" +
        "refRms " + Math.sqrt(refSq / (d1 - d0)) + "\n" +
        "centOut " + cOut + "\n" +
        "centIn " + cIn + "\n" +
        "f0Out " + f0Est + "\n" +
        "f0In " + f0In + "\n" +
        "f0Level " + f0Level + "\n" +
        "noiseLevel " + noiseLevel + "\n" +
        "gapDb " + gapDb + "\n" +
        "voxDb " + voxDb + "\n" +
        "valleyOut " + vOut + "\n" +
        "valleyIn " + vIn + "\n" +
        "cpuMax " + cpuMax + "\n" +
        "cpuAvg " + (cpuCount ? cpuSum / cpuCount : 0) + "\n" +
        "scopeNonZero " + sc.nonZero + "\n" +
        "scopeCepMax " + sc.envMax + "\n" +
        "scopeCepPeakMs " + sc.cepPeakMs + "\n" +
        "scopeCepPeakV " + sc.cepPeakV + "\n" +
        "scopeL " + sc.L + "\n" +
        "scopeF0 " + sc.f0 + "\n" +
        "scopeLevel " + sc.level + "\n" +
        "scopeFrame " + sc.frame + "\n" +
        "scopeN " + sc.n + "\n" +
        "scopeVoiced " + sc.voiced + "\n"
    );
    report.close();
    post("CEPSTRA_SHUTDOWN nullDb " + nullDb + " peak " + peak + " nan " + nan + "\n");
    outlet(0, "bang");
}

function readScope() {
    var z = { nonZero: -1, envMax: 0, specMax: 0, cepPeakMs: 0, cepPeakV: 0, L: 0, f0: 0, level: 0, frame: 0, n: 0, voiced: 0 };
    if (!scopeName) return z;
    var buf = new Buffer(scopeName);
    var chunk = buf.peek(1, 0, 272);
    if (!chunk || !chunk.length) { z.nonZero = 0; return z; }
    var nz = 0, i;
    var cepMax = -1e9, peakMs = 0, peakV = 0;
    for (i = 0; i < 192; i++) {
        var v = chunk[i];
        if (v >= 9000) continue; // sentinel: beyond N/2
        if (v !== 0) nz++;
        if (v > cepMax) cepMax = v;
        // pitch peak: largest |c| (with its sign) between 2 ms and 20 ms, linear axis, column centres
        var ms = (i + 0.5) * 20 / 192;
        if (ms >= 2 && Math.abs(v) > Math.abs(peakV)) { peakV = v; peakMs = ms; }
    }
    z.cepPeakMs = peakMs;
    z.cepPeakV = peakV;
    z.nonZero = nz;
    z.envMax = cepMax;
    z.specMax = 0;
    z.L = chunk[256] || 0;
    z.f0 = chunk[257] || 0;
    z.level = chunk[258] || 0;
    z.frame = chunk[259] || 0;
    z.n = chunk[260] || 0;
    z.voiced = chunk[261] || 0;
    return z;
}
