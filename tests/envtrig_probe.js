// Audio probe for scripts/run_envtrig_audio_tests.py.
// jsarguments: mode.
// The harness records a single 2-channel buffer~ rec:
//   ch1: gate * velocity
//   ch2: audio out L
//
// The report file /tmp/envtrig_audio.txt is created ONLY inside analyze()
// so the Python runner never reads a partial or empty file.

inlets = 4;
outlets = 3;

var mode = jsarguments.length > 1 ? jsarguments[1] : "hits";
var peaks = { genL: -1, ctl: -1, genR: -1 };
var armed = false;
var scopeName = "";
var dspSr = 0;

function loadbang() {
    post("ENVTRIG_PROBE_LOADED " + mode + "\n");
}

function setbuffer(name) {
    scopeName = name ? ("" + name) : "";
}

// Actual DSP sample rate (dspstate~); the record buffer's nominal rate may differ.
function dspsr(v) {
    dspSr = Number(v) || 0;
}

function msg_float(v) {
    if (inlet === 0) peaks.genL = v;
    else if (inlet === 1) peaks.ctl = v;
    else if (inlet === 2) peaks.genR = v;
}

function readChannel(buf, channel, n) {
    var out = [];
    for (var i = 0; i < n; i += 2048) {
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

// Rising edges of the gate*velocity channel, as "velocity@ms".
function edges(lane, sr) {
    var out = [];
    for (var i = 1; i < lane.length; i++) {
        if (lane[i] > 0.5 && lane[i - 1] <= 0.5) {
            out.push(Math.round(lane[i]) + "@" + Math.round(i * 1000 / sr));
        }
    }
    return out;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = dspSr > 0 ? dspSr : (lengthMs > 0 ? frames / (lengthMs / 1000) : 44100);
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var lane0 = readChannel(rec, 1, n);
    var audio = readChannel(rec, 2, n);
    var nan = 0;
    for (var i = 0; i < n; i++) {
        if (lane0[i] !== lane0[i] || audio[i] !== audio[i]) nan++;
    }

    var scope = [0, 0, 0, 0, 0, 0, 0];
    var ringMax = 0;
    var ringOnsets = 0;
    if (scopeName) {
        var sb = new Buffer(scopeName);
        var chunk = sb.peek(1, 0, 7);
        if (chunk && chunk.length) scope = chunk;
        // Oscilloscope ring: 256 blocks of (min, max, onset flag) from index 32
        var ring = sb.peek(1, 32, 768);
        for (var r = 0; ring && r + 2 < ring.length; r += 3) {
            ringMax = Math.max(ringMax, ring[r + 1], -ring[r]);
            if (ring[r + 2] > 0.5) ringOnsets++;
        }
    }

    var report = new File("/tmp/envtrig_audio.txt", "write", "TEXT");
    report.writestring(
        "genL " + peaks.genL + "\n" +
        "ctl " + peaks.ctl + "\n" +
        "sr " + sr + "\n" +
        "nan " + nan + "\n" +
        "scopeFires0 " + scope[2] + "\n" +
        "scopeRoll " + scope[3] + "\n" +
        "ringMax " + ringMax + "\n" +
        "ringOnsets " + ringOnsets + "\n" +
        "lane0 " + edges(lane0, sr).join(" ") + "\n"
    );
    report.close();
    post("ENVTRIG_SHUTDOWN\n");
    outlet(0, "bang");
}
