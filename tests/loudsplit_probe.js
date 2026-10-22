// Probe for scripts/run_loudsplit_audio_tests.py (classic js object inside the scripts/max_harness.py scaffold, ES5).
// The harness sends `resultpath <file>` at load and `analyze <durMs>` once buffer~ rec holds the measured window.
// Inlet 0: `setbuffer <telemetry buffer name>` (sent from loadbang), `analyze <durMs>`.
// js arguments: the tone frequencies (Hz) whose amplitude is measured per channel, e.g. `500 1500 3000`.
// buffer~ rec holds 6 channels:
//   1 Quiet (left)   2 Mid (left)   3 Loud (left)   (by name; the runner patches Quiet = outsel 3, Loud = outsel 1)   4 dry (the stimulus, delayed 4096 samples, or raw in the latency case)
//   5 window flag (the stimulus' marker, aligned with channel 4; 0 = none, 1..4 = case specific)   6 Loud (right)
// Writes `key value` lines: energies (total and per flag), the sum null, tone amplitudes per channel, impulse positions,
// telemetry scalars and column maxima.

inlets = 1;
outlets = 1;

var resultPath = "";
var scopeName = "";
var armed = false;
var freqs = [];
for (var ai = 1; ai < jsarguments.length; ai++) freqs.push(Number(jsarguments[ai]));

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

// amplitude of the component at f Hz over the whole window (a stationary sine of amplitude a reads a)
function toneAmp(x, f, cs, sn) {
    var re = 0, im = 0;
    for (var i = 0; i < x.length; i++) {
        re += x[i] * cs[i];
        im += x[i] * sn[i];
    }
    return 2 * Math.sqrt(re * re + im * im) / x.length;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var sr = rec.length() > 0 ? frames / (rec.length() / 1000.0) : 48000.0;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000.0 + 0.5)));
    var Q = readChannel(rec, 1, n);
    var M = readChannel(rec, 2, n);
    var L = readChannel(rec, 3, n);
    var D = readChannel(rec, 4, n);
    var F = readChannel(rec, 5, n);
    var LR = readChannel(rec, 6, n);

    var nan = 0;
    var eQ = 0, eM = 0, eL = 0, eD = 0, eLR = 0, nullE = 0;
    var fq = [0, 0, 0, 0, 0], fm = [0, 0, 0, 0, 0], fl = [0, 0, 0, 0, 0], fn = [0, 0, 0, 0, 0];
    var S = [];
    for (var i = 0; i < n; i++) {
        var q = Q[i], m = M[i], l = L[i], d = D[i], lr = LR[i];
        if (!isFinite(q + m + l + d + lr + F[i])) {
            nan++;
            S.push(0);
            continue;
        }
        eQ += q * q;
        eM += m * m;
        eL += l * l;
        eD += d * d;
        eLR += lr * lr;
        var s = q + m + l;
        S.push(s);
        nullE += (s - d) * (s - d);
        var f = Math.round(F[i]);
        if (f >= 1 && f <= 4) {
            fq[f] += q * q;
            fm[f] += m * m;
            fl[f] += l * l;
            fn[f]++;
        }
    }
    var pq = peakIndex(Q), pm = peakIndex(M), pl = peakIndex(L), ps = peakIndex(S), pd = peakIndex(D);

    // tone amplitudes per channel
    var tones = "";
    for (var t = 0; t < freqs.length; t++) {
        var cs = [], sn = [];
        for (var j = 0; j < n; j++) {
            cs.push(Math.cos(2 * Math.PI * freqs[t] * j / sr));
            sn.push(Math.sin(2 * Math.PI * freqs[t] * j / sr));
        }
        tones += "toneQ" + t + " " + toneAmp(Q, freqs[t], cs, sn) + "\n" +
            "toneM" + t + " " + toneAmp(M, freqs[t], cs, sn) + "\n" +
            "toneL" + t + " " + toneAmp(L, freqs[t], cs, sn) + "\n" +
            "toneD" + t + " " + toneAmp(D, freqs[t], cs, sn) + "\n";
    }

    // telemetry
    var sc = { frame: 0, n: 0, awake: 0, lat: 0, sel: 0, preMax: 0, qMax: 0, mMax: 0, lMax: 0, thi: 0, tlo: 0, lmax: 0, mean: 0 };
    if (scopeName) {
        var vals = new Buffer(scopeName).peek(1, 0, 544);
        if (vals && vals.length >= 523) {
            for (var c = 0; c < 128; c++) {
                if (vals[c] > sc.preMax) sc.preMax = vals[c];
                if (vals[128 + c] > sc.qMax) sc.qMax = vals[128 + c];
                if (vals[256 + c] > sc.mMax) sc.mMax = vals[256 + c];
                if (vals[384 + c] > sc.lMax) sc.lMax = vals[384 + c];
            }
            sc.frame = vals[512];
            sc.n = vals[514];
            sc.awake = vals[515];
            sc.mean = vals[517];
            sc.lat = vals[518];
            sc.sel = vals[519];
            sc.thi = vals[520];
            sc.tlo = vals[521];
            sc.lmax = vals[522];
        }
    }

    var out = "sr " + sr + "\nframes " + n + "\nnan " + nan + "\n" +
        "energyQ " + eQ + "\nenergyM " + eM + "\nenergyL " + eL + "\nenergyD " + eD + "\nnullE " + nullE + "\n" +
        "ratioR " + (eL > 0 ? Math.sqrt(eLR / eL) : 0) + "\n" +
        "peakQ " + pq.peak + "\npeakM " + pm.peak + "\npeakL " + pl.peak + "\npeakS " + ps.peak + "\npeakD " + pd.peak + "\n" +
        "idxS " + ps.idx + "\nidxD " + pd.idx + "\n";
    for (var g = 1; g <= 4; g++) {
        out += "fq" + g + " " + fq[g] + "\nfm" + g + " " + fm[g] + "\nfl" + g + " " + fl[g] + "\nfn" + g + " " + fn[g] + "\n";
    }
    out += tones +
        "scopeFrame " + sc.frame + "\nscopeN " + sc.n + "\nscopeAwake " + sc.awake + "\nscopeLat " + sc.lat + "\nscopeSel " + sc.sel + "\n" +
        "scopePreMax " + sc.preMax + "\nscopeQMax " + sc.qMax + "\nscopeMMax " + sc.mMax + "\nscopeLMax " + sc.lMax + "\n" +
        "scopeThi " + sc.thi + "\nscopeTlo " + sc.tlo + "\nscopeLmax " + sc.lmax + "\nscopeMean " + sc.mean + "\n";
    var report = new File(resultPath, "write", "TEXT");
    report.writestring(out);
    report.close();
    outlet(0, "bang");
}
