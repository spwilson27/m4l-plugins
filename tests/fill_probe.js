// Audio probe for scripts/run_fill_audio_tests.py.
// Reports the lag between the input peak (rec channel 3) and the output peak
// (channel 1), the mean absolute error against a 1536-sample delay, and scope slot 7.

var resultPath = "/tmp/fill_audio.txt";
function resultpath(p) { resultPath = String(p); }

inlets = 1;
outlets = 1;

function analyze(durMs) {
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000) : 48000;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var left = readChannel(rec, 1, n);
    var input = rec.channelcount() >= 3 ? readChannel(rec, 3, n) : [];
    var outPeak = argmax(left);
    var inPeak = argmax(input);
    var lag = (input.length && left.length) ? (outPeak.idx - inPeak.idx) : -1;
    var err = 0;
    var count = 0;
    var nan = 0;
    var i;
    var delay = 1536;
    for (i = 0; i < left.length; i++) {
        if (left[i] !== left[i]) nan++;
        if (i >= delay && i - delay < input.length) {
            var d = left[i] - input[i - delay];
            err += d < 0 ? -d : d;
            count++;
        }
    }
    var g440 = goertzel(left, sr, 440);
    var g220 = goertzel(left, sr, 220);
    var zc = 0;
    var zi;
    for (zi = 1; zi < left.length; zi++) {
        if (left[zi - 1] <= 0 && left[zi] > 0) zc++;
    }
    var zcHz = left.length > 1 ? zc * sr / left.length : 0;
    var tailStart = Math.floor(left.length * 0.55);
    var tailSum = 0;
    var tailCount = 0;
    for (i = tailStart; i < left.length; i++) {
        var tv = left[i] < 0 ? -left[i] : left[i];
        tailSum += tv;
        tailCount++;
    }
    var tail = tailCount ? tailSum / tailCount : 0;
    var scopeFrame = -1;
    try {
        var scope = new Buffer("#0-fillscope");
        var chunk = scope.peek(1, 7, 1);
        if (typeof chunk === "number") scopeFrame = chunk;
        else if (chunk && chunk.length) scopeFrame = chunk[0];
    } catch (e2) {}
    var report = new File(resultPath, "write", "TEXT");
    report.writestring(
        "lag " + lag + "\n" +
        "outPeak " + outPeak.peak + "\n" +
        "inPeak " + inPeak.peak + "\n" +
        "meanAbs " + (count ? err / count : -1) + "\n" +
        "nan " + nan + "\n" +
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "g220 " + g220 + "\n" +
        "g440 " + g440 + "\n" +
        "zcHz " + zcHz + "\n" +
        "tail " + tail + "\n" +
        "scopeFrame " + scopeFrame + "\n"
    );
    report.close();
    outlet(0, "bang");
}

function argmax(ch) {
    var best = 0;
    var idx = 0;
    var i;
    for (i = 0; i < ch.length; i++) {
        var a = ch[i] < 0 ? -ch[i] : ch[i];
        if (a > best) { best = a; idx = i; }
    }
    return { idx: idx, peak: best };
}

function readChannel(buf, channel, n) {
    var out = [];
    var i, k;
    for (i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var chunk = buf.peek(channel, i, count);
        if (!chunk) {
            for (k = 0; k < count; k++) out.push(0);
        } else if (typeof chunk === "number") {
            out.push(chunk);
        } else {
            for (k = 0; k < count; k++) out.push(chunk[k] || 0);
        }
    }
    return out;
}

function goertzel(ch, sr, freq) {
    var w = 2 * Math.PI * freq / sr;
    var coeff = 2 * Math.cos(w);
    var s0 = 0, s1 = 0, s2 = 0;
    var i;
    for (i = 0; i < ch.length; i++) {
        s0 = ch[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    var power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    return power < 0 ? 0 : power;
}
