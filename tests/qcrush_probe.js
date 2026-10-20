// Probe for scripts/run_qcrush_audio_tests.py (js object inside the real-Max harness, ES5).
// Inlet 0: messages `fill` (synthesize the stimulus into buffer~ stim), `setbuffer <telemetry buffer>`,
//          `mark` (rec starts), `analyze <durMs>` (write the report).
// Inlet 1: floats from [adstatus cpu].
// buffer~ rec holds 4 channels: 1 = device out L, 2 = device in L (the stimulus), 3 = device out R,
// 4 = the stimulus phasor (0..1 over PERIOD seconds), which tells where in the stimulus the recording is.
// jsarguments: stimulus ("vowels2", "sine", "mix", "silent"), report path, latency (samples).

inlets = 2;
outlets = 1;

var stimMode = jsarguments.length > 1 ? jsarguments[1] : "vowels2";
var reportPath = jsarguments.length > 2 ? jsarguments[2] : "/tmp/qcrush_audio.txt";
var LAG = jsarguments.length > 3 ? Number(jsarguments[3]) : 4096;
var PERIOD = 3.0;
var F0 = 110;
var scopeName = "";
var armed = false;
var markTime = 0;
var tickAtMark = 0;
var cpuMax = 0;
var cpuSum = 0;
var cpuCount = 0;

function loadbang() {
    post("QCRUSH_PROBE_LOADED " + stimMode + "\n");
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

// Impulse train at F0 (fractional positions split between the two neighbours) through three formants.
function vowel(n, sr, f1, f2, f3) {
    var x = new Array(n);
    var i;
    for (i = 0; i < n; i++) x[i] = 0;
    var period = sr / F0;
    for (var p = 0; p < n - 2; p += period) {
        var ip = Math.floor(p);
        var fr = p - ip;
        x[ip] += 1 - fr;
        x[ip + 1] += fr;
    }
    var a = resonator(x, f1, 90, sr);
    var b = resonator(x, f2, 110, sr);
    var c = resonator(x, f3, 160, sr);
    var out = new Array(n);
    var pk = 1e-9;
    for (i = 0; i < n; i++) {
        out[i] = a[i] + 0.7 * b[i] + 0.4 * c[i];
        if (Math.abs(out[i]) > pk) pk = Math.abs(out[i]);
    }
    for (i = 0; i < n; i++) out[i] = 0.4 * out[i] / pk;
    return out;
}

function fill() {
    var buf = new Buffer("stim");
    var n = buf.framecount();
    var sr = n / PERIOD;
    var x = new Array(n);
    var i;
    for (i = 0; i < n; i++) x[i] = 0;
    if (stimMode === "vowels2") {
        var va = vowel(n, sr, 700, 1220, 2600);
        var vb = vowel(n, sr, 300, 2200, 3000);
        var half = n / 2;
        var xf = Math.round(0.03 * sr);
        for (i = 0; i < n; i++) {
            var wb = 0;
            if (i >= half - xf / 2 && i < half + xf / 2) wb = (i - (half - xf / 2)) / xf;
            else if (i >= half + xf / 2) wb = 1;
            // wrap the end back into the start: B fades to A over the last xf samples
            if (i >= n - xf) wb = Math.min(wb, (n - 1 - i) / xf);
            x[i] = va[i] * (1 - wb) + vb[i] * wb;
        }
    } else if (stimMode === "sine") {
        for (i = 0; i < n; i++) x[i] = 0.25 * Math.sin(2 * Math.PI * 220 * i / sr);
    } else if (stimMode === "mix") {
        var rnd = lcg(4242);
        for (i = 0; i < n; i++) x[i] = 0.2 * (rnd() * 2 - 1) + 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    }
    buf.poke(1, 0, x);
    post("QCRUSH_STIM_POKED " + stimMode + " frames " + n + " sr " + sr + "\n");
}

function setbuffer(name) {
    scopeName = name ? ("" + name) : "";
}

function scopeVal(idx) {
    if (!scopeName) return 0;
    var chunk = new Buffer(scopeName).peek(1, idx, 1);
    if (chunk && chunk.length !== undefined) return chunk[0];
    return chunk || 0;
}

function mark() {
    markTime = new Date().getTime();
    tickAtMark = scopeVal(197);
}

function msg_float(v) {
    if (inlet === 1) {
        cpuMax = Math.max(cpuMax, v);
        cpuSum += v;
        cpuCount++;
    }
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

var SEG = 8192;

// Average Hann power spectrum over the 8192-sample segments of x inside [i0, i1) (at least one).
function specAvg(x, i0, i1) {
    var acc = new Array(SEG / 2);
    var i;
    for (i = 0; i < SEG / 2; i++) acc[i] = 0;
    var count = 0;
    for (var s = i0; s === i0 || s + SEG <= i1; s += SEG / 2) {
        var re = new Array(SEG), im = new Array(SEG);
        for (i = 0; i < SEG; i++) {
            var w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / SEG);
            re[i] = (x[s + i] || 0) * w;
            im[i] = 0;
        }
        fft(re, im);
        for (i = 0; i < SEG / 2; i++) acc[i] += re[i] * re[i] + im[i] * im[i];
        count++;
    }
    for (i = 0; i < SEG / 2; i++) acc[i] /= count;
    return acc;
}

function bandE(p, sr, lo, hi) {
    var k0 = Math.max(1, Math.floor(lo * SEG / sr));
    var k1 = Math.min(p.length - 1, Math.floor(hi * SEG / sr));
    var s = 1e-30;
    for (var k = k0; k <= k1; k++) s += p[k];
    return s;
}

function db(v) {
    return 10 * Math.log(Math.max(v, 1e-30)) / Math.LN10;
}

// F2(B) band over F2(A) band, in dB: a vowel A / B detector.
function ratioF2(p, sr) {
    return db(bandE(p, sr, 2050, 2350) / bandE(p, sr, 1150, 1350));
}

function valleyToPeakDb(p, sr) {
    var peakE = 1e-30, valE = 1e-30, peakN = 0, valN = 0;
    var kLo = Math.floor(300 * SEG / sr), kHi = Math.floor(4000 * SEG / sr);
    var spacing = F0 * SEG / sr;
    for (var k = kLo; k <= kHi; k++) {
        var h = (k * sr / SEG) / F0;
        var dist = Math.abs(h - Math.round(h)) * spacing;
        if (dist <= 1.5) { peakE += p[k]; peakN++; }
        else if (dist >= 0.35 * spacing) { valE += p[k]; valN++; }
    }
    return db(valE / Math.max(1, valN) / (peakE / Math.max(1, peakN)));
}

// Energy at odd harmonics of F0 over even harmonics (harmonics 3..16), in dB.
function oddEvenDb(p, sr) {
    var odd = 1e-30, even = 1e-30;
    for (var h = 3; h <= 16; h++) {
        var k = Math.round(h * F0 * SEG / sr);
        var e = p[k - 1] + p[k] + p[k + 1];
        if (h % 2) odd += e; else even += e;
    }
    return db(odd / even);
}

function align(out, dry, from, len, maxLag) {
    var best = -1e9, bestLag = 0, ed = 0, t;
    for (t = 0; t < len; t++) ed += dry[from + t] * dry[from + t];
    for (var lag = 0; lag <= maxLag; lag += 1) {
        var d = 0, eo = 0;
        for (var t2 = 0; t2 < len; t2 += 8) {
            var o = out[from + t2 + lag];
            d += o * dry[from + t2];
            eo += o * o;
        }
        var c = d / Math.sqrt(Math.max(ed * eo / 8, 1e-30));
        if (c > best) { best = c; bestLag = lag; }
    }
    return { lag: bestLag, corr: best };
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    try {
        analyzeImpl(durMs);
    } catch (err) {
        var ef = new File(reportPath, "write", "TEXT");
        ef.writestring("error 1\n");
        ef.close();
        post("QCRUSH_ERR " + err + " line " + err.lineNumber + "\n");
        outlet(0, "bang");
    }
}

function analyzeImpl(durMs) {
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var sr = frames / (rec.length() / 1000);
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var outL = readChannel(rec, 1, n);
    var inL = readChannel(rec, 2, n);
    var outR = readChannel(rec, 3, n);
    var ph = readChannel(rec, 4, n);
    var R = {};
    R.sr = sr;
    R.frames = n;

    var nan = 0, tiny = 0, peak = 0, i;
    for (i = 0; i < n; i++) {
        var v = outL[i];
        var w = outR[i];
        if (v !== v || Math.abs(v) === Infinity || w !== w || Math.abs(w) === Infinity) { nan++; continue; }
        var a = Math.abs(v);
        if (a > peak) peak = a;
        if (a > 0 && a < 1e-30) tiny++;
    }
    R.nan = nan;
    R.tiny = tiny;
    R.peak = peak;

    // stimulus time of recording index 0 (first loop of the stimulus)
    var p0 = ph[200];
    var t0 = p0 * PERIOD - 200 / sr;
    R.t0 = t0;
    function idxOf(tau) {
        var ix = Math.round((tau - t0) * sr);
        if (ix < 0) ix += Math.round(PERIOD * sr);
        return ix;
    }

    // dry level, lag, gain and residual against the delayed input
    var skip = Math.min(Math.floor(sr * 0.45), Math.floor(n / 4));
    var len = Math.min(8192, n - skip - LAG - 8);
    var dry2 = 0;
    for (i = skip; i < skip + len; i++) dry2 += inL[i] * inL[i];
    R.dryrms = Math.sqrt(dry2 / Math.max(1, len));
    var al = align(outL, inL, skip, len, LAG + 64);
    R.lag = al.lag;
    R.corr = al.corr;
    var e2 = 0, o2 = 0, d2 = 0, maxErr = 0;
    for (var t = 0; t < len; t++) {
        var o = outL[skip + t + LAG];
        var x = inL[skip + t];
        var er = o - x;
        e2 += er * er;
        o2 += o * o;
        d2 += x * x;
        if (Math.abs(er) > maxErr) maxErr = Math.abs(er);
    }
    R.gaindb = d2 > 0 && o2 > 0 ? db(o2 / d2) : -200;
    R.errdb = d2 > 0 ? db(e2 / d2) : 0;
    R.maxerr = maxErr;

    // largest sample-to-sample step of the output vs the input after the start-up
    var ms = 0, mi = 0;
    for (i = Math.floor(sr * 0.7); i < n - 1; i++) {
        var s1 = Math.abs(outL[i + 1] - outL[i]);
        if (s1 > ms) ms = s1;
        var s2 = Math.abs(inL[i + 1] - inL[i]);
        if (s2 > mi) mi = s2;
    }
    R.maxstep = ms;
    R.maxstepin = mi;
    // steps of the output where the input (4096 samples earlier) is smooth: a click would show up here
    var mc = 0, mcAt = 0, miAt = 0;
    var glitches = [];
    for (i = 1; i < n - 1; i++) if (Math.abs(inL[i + 1] - inL[i]) > 0.05) glitches.push(i);
    if (glitches.length > 20) glitches = []; // noise stimulus: every step is large, nothing to mask
    if (glitches.length) miAt = glitches[0];
    for (i = Math.floor(sr * 0.7); i < n - 1; i++) {
        if (i - LAG < 1) continue;
        var near = false;
        for (var gi = 0; gi < glitches.length; gi++) {
            if (Math.abs((i - LAG) - glitches[gi]) < 9000) { near = true; break; }
        }
        if (near) continue;
        var s3 = Math.abs(outL[i + 1] - outL[i]);
        if (s3 > mc) { mc = s3; mcAt = i; }
    }
    R.maxstepclean = mc;
    R.stepcleanAt = mcAt / sr;
    R.stepinAt = miAt / sr;
    var tailPk = 0;
    for (i = Math.floor(n * 0.8); i < n; i++) tailPk = Math.max(tailPk, Math.abs(outL[i]));
    R.tailpeak = tailPk;
    var rms = 0;
    for (i = skip; i < skip + len; i++) rms += outL[i + LAG] * outL[i + LAG];
    R.outrms = Math.sqrt(rms / Math.max(1, len));

    // spectra in named stimulus windows: A = vowel A, HB = start of B, B = settled vowel B
    var wins = { A: [0.95, 1.4], HB: [1.7, 1.95], B: [2.2, 2.9] };
    for (var name in wins) {
        var a0 = idxOf(wins[name][0]);
        var a1 = idxOf(wins[name][1]);
        if (a0 + LAG + 100 >= n || a1 <= a0) { R["Rin" + name] = -999; R["Rout" + name] = -999; continue; }
        var pin = specAvg(inL, a0, a1);
        var pout = specAvg(outL, a0 + LAG, a1 + LAG);
        R["Rin" + name] = ratioF2(pin, sr);
        R["Rout" + name] = ratioF2(pout, sr);
        if (name === "A") {
            R.valleyIn = valleyToPeakDb(pin, sr);
            R.valleyOut = valleyToPeakDb(pout, sr);
            R.oddevenIn = oddEvenDb(pin, sr);
            R.oddevenOut = oddEvenDb(pout, sr);
            var bands = [[100, 500], [500, 1500], [1500, 3000], [3000, 6000]];
            var maxDiff = 0;
            for (var b = 0; b < bands.length; b++) {
                var bi = db(bandE(pin, sr, bands[b][0], bands[b][1]));
                var bo = db(bandE(pout, sr, bands[b][0], bands[b][1]));
                R["bandIn" + b] = bi;
                R["bandOut" + b] = bo;
                maxDiff = Math.max(maxDiff, Math.abs(bo - bi));
            }
            R.bandmaxdiff = maxDiff;
            // spectral centroid 100 Hz .. 6 kHz
            var cn = 0, cd = 1e-30;
            var cnI = 0, cdI = 1e-30;
            for (var k = Math.floor(100 * SEG / sr); k <= Math.floor(6000 * SEG / sr); k++) {
                cn += k * pout[k]; cd += pout[k];
                cnI += k * pin[k]; cdI += pin[k];
            }
            R.centOut = (cn / cd) * sr / SEG;
            R.centIn = (cnI / cdI) * sr / SEG;
        }
    }

    // right channel vs left (stereo identity)
    var l2 = 0, r2 = 0, lr = 0;
    for (i = skip; i < skip + len; i++) {
        l2 += outL[i + LAG] * outL[i + LAG];
        r2 += outR[i + LAG] * outR[i + LAG];
        lr += outL[i + LAG] * outR[i + LAG];
    }
    R.lrcorr = lr / Math.sqrt(Math.max(l2 * r2, 1e-30));
    R.rrms = Math.sqrt(r2 / Math.max(1, len));

    // telemetry
    if (scopeName) {
        var buf = new Buffer(scopeName);
        var ch = buf.peek(1, 0, 320);
        var nz = 0, sumO = 0, sumC = 0, diff = 0;
        for (i = 0; i < 192; i++) {
            if (ch[i] !== 0) nz++;
        }
        for (i = 0; i < 96; i++) {
            sumO += Math.abs(ch[i]);
            sumC += Math.abs(ch[96 + i]);
            diff += Math.abs(ch[i] - ch[96 + i]);
        }
        R.scNonZero = nz;
        R.scSumOrig = sumO;
        R.scSumCrush = sumC;
        R.scDiff = diff;
        var names = ["scN", "scK", "scBits", "scHeld", "scClock", "scTick", "scRoll", "scLevel", "scQ0", "scConf",
            "scQ0s", "scFrame", "scSr", "scQs", "scSmode", "scSamt", "scRho", "scNeutral"];
        for (i = 0; i < names.length; i++) R[names[i]] = ch[192 + i];
        var smo = 0, smc = 0;
        for (i = 0; i < 48; i++) { smo += ch[210 + i]; smc += ch[258 + i]; }
        R.scStripOrig = smo;
        R.scStripCrush = smc;
        // strip peak bin (index of the largest bin) for original and crushed
        var bo2 = 0, bc2 = 0;
        for (i = 1; i < 48; i++) {
            if (ch[210 + i] > ch[210 + bo2]) bo2 = i;
            if (ch[258 + i] > ch[258 + bc2]) bc2 = i;
        }
        R.scPeakBinOrig = bo2;
        R.scPeakBinCrush = bc2;
        var wallSec = Math.max(0.001, (new Date().getTime() - markTime) / 1000);
        R.tickDelta = ch[197] >= tickAtMark ? ch[197] - tickAtMark : ch[197] + 100000 - tickAtMark;
        R.wallSec = wallSec;
    }
    R.cpuMax = cpuMax;
    R.cpuAvg = cpuCount ? cpuSum / cpuCount : 0;

    var report = new File(reportPath, "write", "TEXT");
    var text = "";
    for (var key in R) text += key + " " + R[key] + "\n";
    report.writestring(text);
    report.close();
    post("QCRUSH_DONE lag " + R.lag + " gain " + R.gaindb + " nan " + nan + "\n");
    outlet(0, "bang");
}
