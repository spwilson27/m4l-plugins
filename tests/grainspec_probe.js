// Max audio & telemetry probe for scripts/run_grainspec_audio_tests.py.
// Populates #0-gssample and #0-gsslices with deterministic test signals,
// then inspects recorded output from buffer~ "rec" and visual telemetry from #0-gsstate.

inlets = 4;
outlets = 3;

var mode = jsarguments.length > 1 ? jsarguments[1] : "default_trig";
var peaks = { genL: -1, ctl: -1, genR: -1 };
var armed = false;
var sampleName = "";
var sliceName = "";
var stateName = "";

function loadbang() {
    post("GS_PROBE_LOADED " + mode + "\n");
}

function setbuffer(sBuf, slBuf, stBuf) {
    sampleName = sBuf ? ("" + sBuf) : "";
    sliceName = slBuf ? ("" + slBuf) : "";
    stateName = stBuf ? ("" + stBuf) : "";
    populateTestBuffers(mode);
}

function populateTestBuffers(kind) {
    if (!sampleName || !sliceName) return;
    var samp = new Buffer(sampleName);
    var sl = new Buffer(sliceName);
    var frames = samp.framecount();
    var sr = 44100;
    var n = Math.min(frames, sr * 2);

    var left = new Array(n);
    var right = new Array(n);
    var i;
    for (i = 0; i < n; i++) {
        left[i] = 0;
        right[i] = 0;
    }

    // Slice 0 (frames 0..11025, 250 ms):
    // First 20 ms (882 samples): sharp high-amplitude drum attack (0.85 peak)
    // Remaining 230 ms (frames 882..11025): moderate 220 Hz tonal body (0.30 peak)
    for (i = 0; i < 11025 && i < n; i++) {
        var t = i / sr;
        if (i < 882) {
            var envA = Math.exp(-t * 95);
            var sigA = Math.sin(2 * Math.PI * (140 + 220 * envA) * t) * 0.88;
            left[i] = sigA;
            right[i] = sigA;
        } else {
            var envB = Math.exp(-(t - 0.02) * 4.5);
            var sigB = Math.sin(2 * Math.PI * 220 * t) * 0.32 * envB;
            left[i] = sigB;
            right[i] = sigB * 0.95;
        }
    }

    // Slice 1 (frames 11025..22050, 250 ms):
    // Short 80 ms percussive hit (frames 11025..14553) followed by silence inside the slice
    // Used to verify that slow Speed stretches a short hit while 100% Speed finishes quickly.
    for (i = 11025; i < 22050 && i < n; i++) {
        var k = i - 11025;
        var t1 = k / sr;
        if (k < 3528) { // first 80 ms
            var hitEnv = Math.sin((k / 3528) * Math.PI);
            var hit = (Math.sin(2 * Math.PI * 165 * t1) + 0.4 * Math.sin(2 * Math.PI * 330 * t1)) * 0.55 * hitEnv;
            left[i] = hit;
            right[i] = hit;
        } else {
            left[i] = 0;
            right[i] = 0;
        }
    }

    samp.poke(1, 0, left);
    samp.poke(2, 0, right);

    var sliceData = new Array(512);
    for (i = 0; i < 512; i++) sliceData[i] = 0;
    // Slice 0: 0..11025, transient = 882 frames (20 ms), pitch = 220 Hz
    sliceData[0] = 0;
    sliceData[1] = 11025;
    sliceData[2] = 882;
    sliceData[3] = 220;
    // Slice 1: 11025..14553 (80 ms hit), transient = 441 frames (10 ms), pitch = 165 Hz
    sliceData[4] = 11025;
    sliceData[5] = 14553;
    sliceData[6] = 441;
    sliceData[7] = 165;

    sl.poke(1, 0, sliceData);
    post("GS_PROBE_READY " + sampleName + " frames " + frames + "\n");
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
    var n = Math.max(0, Math.min(frames, Math.floor((sr * durMs) / 1000)));
    var left = readChannel(rec, 1, n);
    var right = readChannel(rec, 2, n);
    var env = envelope(left, right, sr);
    var stats = scan(left, right);
    var zcr = zeroCrossingRate(left, Math.floor(sr * 0.04), Math.min(n, Math.floor(sr * 0.5)));
    var stateInfo = readStateTelemetry();

    var report = new File("/tmp/grainspec_audio.txt", "write", "TEXT");
    report.writestring(
        "genL " + peaks.genL + "\n" +
        "genR " + peaks.genR + "\n" +
        "ctl " + peaks.ctl + "\n" +
        "sr " + sr + "\n" +
        "frames " + n + "\n" +
        "nan " + stats.nan + "\n" +
        "peak " + stats.peak + "\n" +
        "zcr " + zcr + "\n" +
        "meter " + stateInfo.meter + "\n" +
        "combHz " + stateInfo.combHz + "\n" +
        "env " + env.join(" ") + "\n"
    );
    report.close();
    post("GS_PROBE_DONE peak " + stats.peak + " meter " + stateInfo.meter + "\n");
    outlet(0, "bang");
}

function readStateTelemetry() {
    if (!stateName) return { meter: 0, combHz: 0 };
    var st = new Buffer(stateName);
    var chunk = st.peek(1, 0, 16);
    if (!chunk || !chunk.length) return { meter: 0, combHz: 0 };
    var peakMeter = 0;
    for (var i = 6; i <= 11 && i < chunk.length; i++) {
        var v = Math.abs(chunk[i] || 0);
        if (v > peakMeter) peakMeter = v;
    }
    return {
        meter: peakMeter,
        combHz: chunk.length > 14 ? chunk[14] : 0
    };
}

function readChannel(buf, channel, n) {
    var out = [];
    for (var i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var chunk = buf.peek(channel, i, count);
        if (!chunk) {
            for (var z = 0; z < count; z++) out.push(0);
            continue;
        }
        if (typeof chunk === "number") {
            out.push(chunk);
            continue;
        }
        for (var k = 0; k < chunk.length; k++) out.push(chunk[k]);
    }
    return out;
}

function envelope(left, right, sr) {
    var hop = Math.max(1, Math.round(sr / 1000));
    var bins = [];
    for (var i = 0; i < left.length; i += hop) {
        var pk = 0;
        for (var k = i; k < i + hop && k < left.length; k++) {
            var a = Math.abs(left[k]);
            var b = Math.abs(right[k]);
            if (a > pk) pk = a;
            if (b > pk) pk = b;
        }
        bins.push(Math.round(pk * 1e6) / 1e6);
    }
    return bins;
}

function scan(left, right) {
    var nan = 0;
    var peak = 0;
    for (var i = 0; i < left.length; i++) {
        var l = left[i];
        var r = right[i];
        if (l !== l || l === Infinity || l === -Infinity) nan++;
        else if (Math.abs(l) > peak) peak = Math.abs(l);
        if (r !== r || r === Infinity || r === -Infinity) nan++;
        else if (Math.abs(r) > peak) peak = Math.abs(r);
    }
    return { nan: nan, peak: peak };
}

function zeroCrossingRate(samples, i0, i1) {
    var start = Math.max(1, i0 || 1);
    var end = Math.min(samples.length, i1 || samples.length);
    if (end <= start + 1) return 0;
    var crosses = 0;
    for (var i = start; i < end; i++) {
        if ((samples[i - 1] >= 0 && samples[i] < 0) || (samples[i - 1] < 0 && samples[i] >= 0)) {
            crosses++;
        }
    }
    return crosses / (end - start);
}
