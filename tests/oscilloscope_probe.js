// Audio probe for scripts/run_oscilloscope_audio_tests.py.
// The runner prepends src/oscilloscope_config.js so oscComputeFrame is in scope.
// Reads the scope rings the device UI reads and reports one 1 Cyc frame.

inlets = 1;
outlets = 1;

var resultPath = "/tmp/oscilloscope_audio.txt";
function resultpath(p) { resultPath = String(p); }

function chunk(buf, start, count) {
    var out = [];
    var i;
    for (i = 0; i < count; i += 2048) {
        var n = Math.min(2048, count - i);
        var part = buf.peek(1, start + i, n);
        var k;
        if (typeof part === "number") {
            out.push(part);
            continue;
        }
        if (!part) {
            for (k = 0; k < n; k++) out.push(0);
            continue;
        }
        for (k = 0; k < n; k++) out.push(part[k] || 0);
    }
    return out;
}

function wrapped(buf, base, len, head, count) {
    var start = head - count;
    while (start < 0) start += len;
    if (start + count <= len) return chunk(buf, base + start, count);
    var first = len - start;
    var a = chunk(buf, base + start, first);
    var b = chunk(buf, base, count - first);
    var out = new Array(count);
    var i;
    for (i = 0; i < first; i++) out[i] = a[i];
    for (i = 0; i < b.length; i++) out[first + i] = b[i];
    return out;
}

function rises(wave) {
    var pk = 0;
    var i;
    for (i = 0; i < wave.length; i++) pk = Math.max(pk, Math.abs(wave[i]));
    // A quiet gap sits on numerical dust. Those wiggles are not extra cycles.
    if (pk < 0.01) return 0;
    var c = 0;
    for (i = 1; i < wave.length; i++) {
        if (wave[i - 1] <= 0 && wave[i] > 0) c++;
    }
    return c;
}

function analyze(durMs) {
    var scope = new Buffer("#0-analyzerscope");
    var hdr = chunk(scope, 0, 3);
    var sr = hdr[OSC_HDR_SR] > 1000 ? hdr[OSC_HDR_SR] : 48000;
    var head = Math.round(hdr[OSC_HDR_SCOPE]) % OSC_RING_N;
    if (head < 0) head += OSC_RING_N;
    var l = wrapped(scope, OSC_SCOPE_L, OSC_RING_N, head, OSC_RING_N);
    var r = wrapped(scope, OSC_SCOPE_R, OSC_RING_N, head, OSC_RING_N);
    var scopePk = 0;
    var i;
    for (i = 0; i < l.length; i++) scopePk = Math.max(scopePk, Math.abs(l[i]), Math.abs(r[i]));
    var frame = oscComputeFrame(l, r, sr, {
        chMode: 0,
        cycleMode: 0,
        points: 200,
        pitchState: oscCreatePitchState()
    });
    var wave = frame.wave1 || [];
    var y0 = wave.length ? wave[0] : 0;
    var wavPk = 0;
    var wavN = 0;
    try {
        var drums = new Buffer("drums");
        wavN = drums.framecount();
        var clip = chunk(drums, 0, Math.min(wavN, 2048));
        var j;
        for (j = 0; j < clip.length; j++) wavPk = Math.max(wavPk, Math.abs(clip[j]));
    } catch (err) {}
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var audio = chunk(rec, 0, Math.min(frames, 48000));
    var pass = 0;
    for (i = 0; i < audio.length; i++) pass = Math.max(pass, Math.abs(audio[i]));
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(
        "frame " + hdr[OSC_HDR_FRAME] + "\n" +
        "sr " + sr + "\n" +
        "scopepk " + scopePk + "\n" +
        "wavpk " + wavPk + "\n" +
        "wavn " + wavN + "\n" +
        "pass " + pass + "\n" +
        "zc " + rises(wave) + "\n" +
        "freq " + frame.freq + "\n" +
        "windowms " + frame.windowMs + "\n" +
        "y0 " + y0 + "\n" +
        "locked " + (frame.trigLocked ? 1 : 0) + "\n" +
        "dur " + durMs + "\n"
    );
    report.close();
    outlet(0, "bang");
}
