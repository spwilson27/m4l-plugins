// Audio probe for scripts/run_percipitator_audio_tests.py.
// Pokes the 4-frame Sine -> Triangle -> Saw -> Square wavetable into #0-percipwt on setbuffer,
// then analyzes the recorded stereo output in buffer~ rec and the 16-band telemetry in #0-percipscope.
// Writes /tmp/percipitator_audio.txt ONLY inside analyze().

inlets = 4;
outlets = 3;

var mode = jsarguments.length > 1 ? jsarguments[1] : "sine";
var peaks = { genL: -1, ctl: -1, genR: -1 };
var armed = false;
var wtName = "";
var scopeName = "";

function loadbang() {
    post("PERCIP_PROBE_LOADED " + mode + "\n");
}

function makeStandardWt() {
    var total = 4 * 2048;
    var out = new Array(total);
    var twoPi = Math.PI * 2;
    var f, i, h;
    for (f = 0; f < 4; f++) {
        var base = f * 2048;
        var peak = 1e-6;
        for (i = 0; i < 2048; i++) {
            var ph = i / 2048;
            var w = ph * twoPi;
            var v = 0;
            if (f === 0) {
                v = Math.sin(w);
            } else if (f === 1) {
                if (ph < 0.25) v = ph * 4.0;
                else if (ph < 0.75) v = 2.0 - ph * 4.0;
                else v = ph * 4.0 - 4.0;
            } else if (f === 2) {
                for (h = 1; h <= 16; h++) {
                    var sigSaw = Math.sin((h * Math.PI) / 17) / ((h * Math.PI) / 17);
                    v += (Math.sin(h * w) / h) * sigSaw;
                }
            } else {
                for (h = 1; h <= 15; h += 2) {
                    var sigSqr = Math.sin((h * Math.PI) / 16) / ((h * Math.PI) / 16);
                    v += (Math.sin(h * w) / h) * sigSqr;
                }
            }
            out[base + i] = v;
            if (Math.abs(v) > peak) peak = Math.abs(v);
        }
        var scale = 0.98 / peak;
        for (i = 0; i < 2048; i++) out[base + i] *= scale;
    }
    return out;
}

function setbuffer(wName, sName) {
    wtName = wName ? ("" + wName) : "";
    scopeName = sName ? ("" + sName) : "";
    if (wtName) {
        var wb = new Buffer(wtName);
        wb.poke(1, 0, makeStandardWt());
        post("PERCIP_WT_POKED " + wtName + " frames " + wb.framecount() + "\n");
    }
}

function msg_float(v) {
    if (inlet === 0) peaks.genL = v;
    else if (inlet === 1) peaks.ctl = v;
    else if (inlet === 2) peaks.genR = v;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000) : 44100;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var left = readChannel(rec, 1, n);
    var right = readChannel(rec, 2, n);
    var env = envelope(left, right, sr);
    var stats = scan(left, right, sr);
    var sc = readScope();

    var report = new File("/tmp/percipitator_audio.txt", "write", "TEXT");
    report.writestring(
        "genL " + peaks.genL + "\n" +
        "genR " + peaks.genR + "\n" +
        "ctl " + peaks.ctl + "\n" +
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + stats.nan + "\n" +
        "peak " + stats.peak + "\n" +
        "zcr " + stats.zcr + "\n" +
        "slopeRms " + stats.slopeRms + "\n" +
        "corr " + stats.corr + "\n" +
        "scopeBandMax " + sc.bandMax + "\n" +
        "scopeActive " + sc.active + "\n" +
        "scopeMidi3 " + sc.midi3 + "\n" +
        "env " + env.join(" ") + "\n"
    );
    report.close();
    post("PERCIP_SHUTDOWN peak " + stats.peak + " bandMax " + sc.bandMax + " zcr " + stats.zcr + "\n");
    outlet(0, "bang");
}

function readScope() {
    if (!scopeName) return { bandMax: -1, active: -1, midi3: -1 };
    var buf = new Buffer(scopeName);
    var chunk = buf.peek(1, 0, 36);
    if (!chunk || !chunk.length) return { bandMax: 0, active: 0, midi3: 0 };
    var bMax = 0;
    var i;
    for (i = 0; i < 16; i++) {
        if (chunk[i] > bMax) bMax = chunk[i];
    }
    return {
        bandMax: bMax,
        active: chunk[33] || 0,
        midi3: chunk[16 + 3] || 0,
    };
}

function readChannel(buf, channel, n) {
    var out = [];
    var i;
    for (i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var chunk = buf.peek(channel, i, count);
        var k;
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

function envelope(left, right, sr) {
    var hop = Math.max(1, Math.round(sr / 1000));
    var bins = [];
    var i, k, peak;
    for (i = 0; i < left.length; i += hop) {
        peak = 0;
        for (k = i; k < i + hop && k < left.length; k++) {
            var a = Math.abs(left[k]);
            var b = Math.abs(right[k]);
            if (a > peak) peak = a;
            if (b > peak) peak = b;
        }
        bins.push(Math.round(peak * 1e6) / 1e6);
    }
    return bins;
}

function scan(left, right, sr) {
    var nan = 0;
    var peak = 0;
    var start = Math.min(left.length, Math.floor(sr * 0.02));
    var end = Math.max(start, Math.min(left.length, Math.floor(sr * 0.25)));
    var zc = 0;
    var diffSq = 0;
    var sigSq = 0;
    var sl = 0, sr2 = 0, sp = 0;
    var count = 0;
    var i;
    for (i = 0; i < left.length; i++) {
        var v = left[i];
        var vr = right[i];
        if (v !== v || v === Infinity || v === -Infinity) nan++;
        else if (Math.abs(v) > peak) peak = Math.abs(v);
        if (vr !== vr || vr === Infinity || vr === -Infinity) nan++;
        else if (Math.abs(vr) > peak) peak = Math.abs(vr);

        if (i >= start && i < end) {
            sigSq += v * v;
            if (i > start) {
                var dv = v - left[i - 1];
                diffSq += dv * dv;
                if ((left[i - 1] >= 0 && v < 0) || (left[i - 1] < 0 && v >= 0)) {
                    zc++;
                }
            }
            sl += v * v;
            sr2 += vr * vr;
            sp += v * vr;
            count++;
        }
    }
    var rms = count > 0 ? Math.sqrt(sigSq / count) : 0;
    var dRms = count > 0 ? Math.sqrt(diffSq / count) : 0;
    var slopeRms = rms > 1e-5 ? dRms / rms : 0;
    var corr = (sl > 1e-12 && sr2 > 1e-12) ? (sp / Math.sqrt(sl * sr2)) : 0;
    return { nan: nan, peak: peak, zcr: zc, slopeRms: slopeRms, corr: corr };
}
