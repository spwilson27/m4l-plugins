// Clip+ audio probe. rec is the gen output (L, R). jsarguments after the filename are frequencies
// to measure. Also reports the 4x true peak of the left channel with the same 97-tap FIR the device uses.

inlets = 1;
outlets = 1;

var resultPath = "/tmp/clipplus_audio.txt";
var armed = false;

function resultpath(p) { resultPath = String(p); }

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000) : 48000;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var left = readCh(rec, 1, n);
    var right = readCh(rec, 2, n);
    var peak = 0;
    var rpeak = 0;
    var mean = 0;
    var nans = 0;
    var i;
    for (i = 0; i < left.length; i++) {
        var v = left[i];
        if (v !== v || v === Infinity || v === -Infinity) nans++;
        else {
            var a = v < 0 ? -v : v;
            if (a > peak) peak = a;
            mean += v;
        }
    }
    for (i = 0; i < right.length; i++) {
        var rv = right[i];
        if (rv !== rv || rv === Infinity || rv === -Infinity) nans++;
        else {
            var ra = rv < 0 ? -rv : rv;
            if (ra > rpeak) rpeak = ra;
        }
    }
    if (left.length) mean /= left.length;
    var midSq = 0;
    var sideSq = 0;
    var nch = Math.min(left.length, right.length);
    for (i = 0; i < nch; i++) {
        var sm = left[i] + right[i];
        var ss = left[i] - right[i];
        midSq += sm * sm;
        sideSq += ss * ss;
    }
    var midRms = nch ? Math.sqrt(midSq / nch) : 0;
    var sideRms = nch ? Math.sqrt(sideSq / nch) : 0;
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    var scope = scopeBuffer();
    var grDb = peek1(scope, 5);
    var drvPk = peek1(scope, 11);
    var inMs = peek1(scope, 2);
    var frameN = peek1(scope, 8);
    report.writestring("peak " + peak + "\nrpeak " + rpeak + "\nmean " + mean + "\nnan " + nans + "\ntp " + truePeak(left, 400) + "\nsr " + sr + "\nframes " + n + "\ngr " + grDb + "\ndrvpk " + drvPk + "\ninms " + inMs + "\nscframe " + frameN + "\nmidrms " + midRms + "\nsiderms " + sideRms + "\n");
    for (i = 1; i < jsarguments.length; i++) {
        var f = parseFloat(jsarguments[i]);
        if (!(f > 0)) continue;
        report.writestring("m" + (i - 1) + " " + goertzel(left, f, sr) + "\n");
        report.writestring("rm" + (i - 1) + " " + goertzel(right, f, sr) + "\n");
    }
    report.close();
    post("PROBE_SHUTDOWN peak " + peak + "\n");
    outlet(0, "bang");
}

// peek(ch, index, 1) returns a number; a count above 1 returns an array.
function peek1(buf, index) {
    var v = buf.peek(1, index, 1);
    if (typeof v === "number") return v;
    if (v && v.length) return v[0];
    return 0;
}

// #0 in a js string is literal. The patcher's buffer~ has the expanded name.
function scopeBuffer() {
    var found = "";
    if (this.patcher) {
        this.patcher.apply(function (b) {
            if (found) return;
            var name = "";
            try { name = String(b.getattr("name")); } catch (e) { name = ""; }
            if (name.indexOf("clipscope") >= 0) found = name;
        });
    }
    return new Buffer(found || "#0-clipscope");
}

function readCh(buf, ch, n) {
    var out = [];
    var i = 0;
    while (i < n) {
        var take = Math.min(8192, n - i);
        var chunk = buf.peek(ch, i, take);
        var k;
        if (!chunk || !chunk.length) break;
        for (k = 0; k < chunk.length; k++) out.push(chunk[k]);
        i += chunk.length;
    }
    return out;
}

function goertzel(samples, freq, sr) {
    var n = samples.length;
    var w = 6.283185307179586 * freq / sr;
    var cw = Math.cos(w);
    var coeff = 2 * cw;
    var s0 = 0;
    var s1 = 0;
    var s2 = 0;
    var i;
    for (i = 0; i < n; i++) {
        s0 = samples[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    var re = s1 - s2 * cw;
    var im = s2 * Math.sin(w);
    return Math.sqrt(re * re + im * im) * 2 / n;
}

function firCoef() {
    var c = [];
    var sum = 0;
    var i, k, x, sinc, ww;
    for (i = 0; i < 97; i++) {
        x = i - 48;
        sinc = x === 0 ? 0.25 : Math.sin(6.283185307179586 * 0.125 * x) / (3.141592653589793 * x);
        ww = 0.42 - 0.5 * Math.cos(6.283185307179586 * i / 96) + 0.08 * Math.cos(12.566370614359172 * i / 96);
        c.push(sinc * ww);
        sum += c[i];
    }
    for (k = 0; k < 97; k++) c[k] /= sum;
    return c;
}

function truePeak(samples, skip) {
    var coef = firCoef();
    var up = [];
    var i, p, acc, ins, a, pk;
    for (i = 0; i < 97; i++) up.push(0);
    pk = 0;
    for (i = 0; i < samples.length; i++) {
        for (p = 0; p < 4; p++) {
            ins = p === 0 ? samples[i] * 4 : 0;
            for (a = 96; a >= 1; a--) up[a] = up[a - 1];
            up[0] = ins;
            acc = 0;
            for (a = 0; a < 97; a++) acc += up[a] * coef[a];
            if (i >= skip) {
                if (acc < 0) acc = -acc;
                if (acc > pk) pk = acc;
            }
        }
    }
    return pk;
}
