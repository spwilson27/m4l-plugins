// Probe for scripts/run_freqsplit_audio_tests.py (classic js object inside the scripts/max_harness.py scaffold, ES5).
// The harness sends `resultpath <file>` at load and `analyze <durMs>` once buffer~ rec holds the measured window.
// Inlet 0: `setbuffer <telemetry buffer name>` and `freqs f1 f2 ...` (sent from loadbang), `analyze <durMs>`.
// buffer~ rec holds 6 channels:
//   1..4 channel 1..4 (left)   5 dry (the stimulus, delayed 4096 samples, or raw in the latency case)   6 All (left, Output = All)
// Writes `key value` lines: energies, the sum null (nullE: four channels vs dry; nullA: Output All vs dry), per-channel amplitude at each stimulus frequency (Hann-windowed
// correlation: amp_<channel>_<freq index>), impulse positions, telemetry scalars.

inlets = 1;
outlets = 1;

var resultPath = "";
var scopeName = "";
var freqList = [];
var armed = false;

function resultpath(p) { resultPath = String(p); }
function setbuffer(name) { scopeName = name ? String(name) : ""; }
function freqs() {
    freqList = [];
    for (var i = 0; i < arguments.length; i++) freqList.push(Number(arguments[i]));
}

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

// Amplitude of the sine at f in x (Hann-windowed single-bin DFT, 2 |sum w x e^-jwt| / sum w).
function amplitudeAt(x, f, sr) {
    var n = x.length;
    var w0 = 2 * Math.PI * f / sr;
    var cr = Math.cos(w0), ci = Math.sin(w0);
    var er = 1, ei = 0;
    var re = 0, im = 0, sw = 0;
    for (var i = 0; i < n; i++) {
        var w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / n);
        re += w * x[i] * er;
        im -= w * x[i] * ei;
        sw += w;
        var nr = er * cr - ei * ci;
        ei = er * ci + ei * cr;
        er = nr;
        if ((i & 4095) === 4095) {
            var mag = Math.sqrt(er * er + ei * ei);
            er /= mag;
            ei /= mag;
        }
    }
    return 2 * Math.sqrt(re * re + im * im) / sw;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var sr = rec.length() > 0 ? frames / (rec.length() / 1000.0) : 48000.0;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000.0 + 0.5)));
    var C = [];
    for (var c = 0; c < 6; c++) C.push(readChannel(rec, c + 1, n));

    var nan = 0;
    var en = [0, 0, 0, 0, 0, 0];
    var nullE = 0;
    var nullA = 0;
    for (var i = 0; i < n; i++) {
        var bad = false;
        var s = 0;
        for (var c2 = 0; c2 < 6; c2++) {
            var v = C[c2][i];
            if (isNaN(v) || !isFinite(v)) bad = true;
        }
        if (bad) {
            nan++;
            continue;
        }
        for (var c3 = 0; c3 < 6; c3++) en[c3] += C[c3][i] * C[c3][i];
        s = C[0][i] + C[1][i] + C[2][i] + C[3][i] - C[4][i];
        nullE += s * s;
        var da = C[5][i] - C[4][i];
        nullA += da * da;
    }
    var peaks = [];
    for (var c4 = 0; c4 < 6; c4++) peaks.push(peakIndex(C[c4]));

    var lines = "";
    for (var f = 0; f < freqList.length; f++) {
        for (var c5 = 0; c5 < 4; c5++) lines += "amp_" + c5 + "_" + f + " " + amplitudeAt(C[c5], freqList[f], sr) + "\n";
        lines += "ampD_" + f + " " + amplitudeAt(C[4], freqList[f], sr) + "\n";
    }

    var scopeFrame = 0, scopeN = 0, scopeAwake = 0, scopeLat = 0, scopeSel = 0, scopeLim = 0, preMax = 0, chMax = [0, 0, 0, 0], chSum = [0, 0, 0, 0];
    if (scopeName) {
        var vals = new Buffer(scopeName).peek(1, 0, 704);
        if (vals && vals.length >= 648) {
            for (var k = 0; k < 128; k++) {
                if (vals[k] > preMax) preMax = vals[k];
                for (var q = 0; q < 4; q++) {
                    var tv = vals[128 + q * 128 + k];
                    if (tv > chMax[q]) chMax[q] = tv;
                    chSum[q] += tv;
                }
            }
            scopeFrame = vals[640];
            scopeN = vals[642];
            scopeAwake = vals[643];
            scopeLat = vals[645];
            scopeSel = vals[646];
            scopeLim = vals[647];
        }
    }

    var report = new File(resultPath, "write", "TEXT");
    report.writestring(
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + nan + "\n" +
        "energy0 " + en[0] + "\nenergy1 " + en[1] + "\nenergy2 " + en[2] + "\nenergy3 " + en[3] + "\nenergyD " + en[4] + "\nenergyA " + en[5] + "\n" +
        "nullE " + nullE + "\n" +
        "nullA " + nullA + "\n" +
        "peak0 " + peaks[0].peak + "\npeak1 " + peaks[1].peak + "\npeak2 " + peaks[2].peak + "\npeak3 " + peaks[3].peak + "\n" +
        "peakD " + peaks[4].peak + "\npeakA " + peaks[5].peak + "\n" +
        "idxA " + peaks[5].idx + "\nidxD " + peaks[4].idx + "\n" +
        lines +
        "scopeFrame " + scopeFrame + "\n" +
        "scopeN " + scopeN + "\n" +
        "scopeAwake " + scopeAwake + "\n" +
        "scopeLat " + scopeLat + "\n" +
        "scopeSel " + scopeSel + "\n" +
        "scopeLim " + scopeLim + "\n" +
        "scopePreMax " + preMax + "\n" +
        "scopeCh0Max " + chMax[0] + "\nscopeCh1Max " + chMax[1] + "\nscopeCh2Max " + chMax[2] + "\nscopeCh3Max " + chMax[3] + "\n" +
        "scopeCh0Sum " + chSum[0] + "\nscopeCh1Sum " + chSum[1] + "\nscopeCh2Sum " + chSum[2] + "\nscopeCh3Sum " + chSum[3] + "\n"
    );
    report.close();
    outlet(0, "bang");
}
