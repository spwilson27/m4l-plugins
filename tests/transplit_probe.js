// Probe for scripts/run_transplit_audio_tests.py (classic js object inside the scripts/max_harness.py scaffold, ES5).
// The harness sends `resultpath <file>` at load and `analyze <durMs>` once buffer~ rec holds the measured window.
// Inlet 0: `setbuffer <telemetry buffer name>` (sent from loadbang), `analyze <durMs>`.
// buffer~ rec holds 6 channels:
//   1 Transients (left)   2 Tones (left)   3 dry (the stimulus, delayed 4096 samples, or raw in the latency case)
//   4 window flag (the stimulus' marker, aligned with channel 3): 1 = first 40 ms after a burst onset, 2 = a quiet gap
//     (200..360 ms after an onset), 0 otherwise
//   5 All (left, Output = sum of both masks)   6 Transients (right; the stimulus' right channel is half the left)
// Writes `key value` lines: sample counts, energies, fractions, the sum null, impulse positions, telemetry scalars.

inlets = 1;
outlets = 1;

var resultPath = "";
var scopeName = "";
var armed = false;

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

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var sr = rec.length() > 0 ? frames / (rec.length() / 1000.0) : 48000.0;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000.0 + 0.5)));
    var T = readChannel(rec, 1, n);
    var Q = readChannel(rec, 2, n);
    var D = readChannel(rec, 3, n);
    var F = readChannel(rec, 4, n);
    var A = readChannel(rec, 5, n);
    var TR = readChannel(rec, 6, n);

    var nan = 0, nanC = [0, 0, 0, 0, 0, 0];
    var eT = 0, eQ = 0, eD = 0, eA = 0, eTR = 0, nullE = 0, nullD = 0, mixNullE = 0, mixRefE = 0;
    var onT = 0, onQ = 0, gapT = 0, gapQ = 0, onN = 0, gapN = 0;
    for (var i = 0; i < n; i++) {
        var t = T[i], q = Q[i], d = D[i], a = A[i], tr = TR[i];
        if (isNaN(t) || isNaN(q) || isNaN(d) || isNaN(a) || isNaN(tr) || !isFinite(t + q + d + a + tr) || isNaN(F[i])) {
            nan++;
            if (!isFinite(t)) nanC[0]++;
            if (!isFinite(q)) nanC[1]++;
            if (!isFinite(d)) nanC[2]++;
            if (!isFinite(F[i])) nanC[3]++;
            if (!isFinite(a)) nanC[4]++;
            if (!isFinite(tr)) nanC[5]++;
            continue;
        }
        eT += t * t;
        eQ += q * q;
        eD += d * d;
        eA += a * a;
        eTR += tr * tr;
        var s = t + q - d;
        nullE += s * s;
        var mr = 0.5 * a + 0.5 * d;
        mixNullE += (t + q - mr) * (t + q - mr);
        mixRefE += mr * mr;
        var f = Math.round(F[i]);
        if (f === 1) {
            onT += t * t;
            onQ += q * q;
            onN++;
        } else if (f === 2) {
            gapT += t * t;
            gapQ += q * q;
            gapN++;
        }
    }
    var pt = peakIndex(T), pq = peakIndex(Q), pa = peakIndex(A), pd = peakIndex(D);

    // telemetry
    var waveMaxT = 0, waveMaxQ = 0, waveMaxPT = 0, waveMaxPQ = 0;
    var scopeFrame = 0, scopeN = 0, scopeAwake = 0, scopeLat = 0, scopeSel = 0, preMax = 0, trMax = 0, toneMax = 0, fracMax = 0, trMean = 0;
    if (scopeName) {
        var vals = new Buffer(scopeName).peek(1, 0, 800);
        if (vals && vals.length >= 520) {
            for (var c = 0; c < 128; c++) {
                if (vals[c] > preMax) preMax = vals[c];
                if (vals[128 + c] > trMax) trMax = vals[128 + c];
                if (vals[256 + c] > toneMax) toneMax = vals[256 + c];
                if (vals[384 + c] > fracMax) fracMax = vals[384 + c];
            }
            for (var w = 0; w < 64 && vals.length >= 530 + 256; w++) {
                if (vals[530 + w * 4] > waveMaxPT) waveMaxPT = vals[530 + w * 4];
                if (vals[531 + w * 4] > waveMaxPQ) waveMaxPQ = vals[531 + w * 4];
                if (vals[532 + w * 4] > waveMaxT) waveMaxT = vals[532 + w * 4];
                if (vals[533 + w * 4] > waveMaxQ) waveMaxQ = vals[533 + w * 4];
            }
            scopeFrame = vals[512];
            scopeN = vals[514];
            scopeAwake = vals[515];
            trMean = vals[517];
            scopeLat = vals[518];
            scopeSel = vals[519];
        }
    }

    var report = new File(resultPath, "write", "TEXT");
    report.writestring(
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + nan + "\n" +
        "nanT " + nanC[0] + "\nnanQ " + nanC[1] + "\nnanD " + nanC[2] + "\nnanF " + nanC[3] + "\nnanA " + nanC[4] + "\nnanTR " + nanC[5] + "\n" +
        "d100 " + D[100] + "\nd30000 " + D[30000] + "\nt30000 " + T[30000] + "\n" +
        "energyT " + eT + "\n" +
        "energyQ " + eQ + "\n" +
        "energyD " + eD + "\n" +
        "energyA " + eA + "\n" +
        "nullE " + nullE + "\n" +
        "mixNullE " + mixNullE + "\nmixRefE " + mixRefE + "\n" +
        "waveMaxT " + waveMaxT + "\nwaveMaxQ " + waveMaxQ + "\nwaveMaxPT " + waveMaxPT + "\nwaveMaxPQ " + waveMaxPQ + "\n" +
        "onsetT " + onT + "\n" +
        "onsetQ " + onQ + "\n" +
        "onsetN " + onN + "\n" +
        "gapT " + gapT + "\n" +
        "gapQ " + gapQ + "\n" +
        "gapN " + gapN + "\n" +
        "ratioR " + (eT > 0 ? Math.sqrt(eTR / eT) : 0) + "\n" +
        "peakT " + pt.peak + "\n" +
        "peakQ " + pq.peak + "\n" +
        "peakA " + pa.peak + "\n" +
        "peakD " + pd.peak + "\n" +
        "idxA " + pa.idx + "\n" +
        "idxD " + pd.idx + "\n" +
        "scopeFrame " + scopeFrame + "\n" +
        "scopeN " + scopeN + "\n" +
        "scopeAwake " + scopeAwake + "\n" +
        "scopeLat " + scopeLat + "\n" +
        "scopeSel " + scopeSel + "\n" +
        "scopePreMax " + preMax + "\n" +
        "scopeTrMax " + trMax + "\n" +
        "scopeToneMax " + toneMax + "\n" +
        "scopeFracMax " + fracMax + "\n" +
        "scopeTrMean " + trMean + "\n"
    );
    report.close();
    outlet(0, "bang");
}
