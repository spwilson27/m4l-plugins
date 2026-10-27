// Audio probe for scripts/run_analyzer_audio_tests.py.
// Reads buffer~ #0-analyzerscope (the tap) and buffer~ rec (the pass-through).

inlets = 1;
outlets = 1;

var resultPath = "/tmp/analyzer_audio.txt";
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

function analyze(durMs) {
    var scope = new Buffer("#0-analyzerscope");
    var hdr = chunk(scope, 0, 9);
    var head = Math.round(hdr[4]) % 64;
    var last = (head + 63) % 64;
    var pkt = chunk(scope, 32 + last * 24, 21);
    var n = pkt[8] || 480;
    var z = n > 0 ? (pkt[0] + pkt[1]) / n : 0;
    var mean = n > 0 ? (pkt[2] + pkt[3]) / (2 * n) : 0;
    var lufs = z > 1e-20 ? -0.691 + 10 * Math.log(z) / Math.LN10 : -200;
    var rms = mean > 1e-20 ? 10 * Math.log(mean) / Math.LN10 : -200;
    var pk = Math.max(pkt[6], pkt[7]);
    var tp = Math.max(pkt[4], pkt[5]);
    var loud = 0;
    var corr = 0;
    var energy = [0, 0, 0, 0];
    var b;
    for (b = 0; b < 4; b++) {
        var ll = pkt[9 + b * 3];
        var rr = pkt[10 + b * 3];
        var lr = pkt[11 + b * 3];
        energy[b] = ll + rr;
        var d = Math.sqrt(Math.max(ll, 0) * Math.max(rr, 0));
        var c = d > 1e-12 ? lr / d : 0;
        if (energy[b] >= loud) {
            loud = energy[b];
            corr = c;
        }
    }
    var ring = chunk(scope, 1568, 16384);
    var scopePk = 0;
    var i;
    for (i = 0; i < ring.length; i++) scopePk = Math.max(scopePk, Math.abs(ring[i]));

    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var pass = 0;
    var audio = chunk(rec, 0, Math.min(frames, 48000));
    for (i = 0; i < audio.length; i++) pass = Math.max(pass, Math.abs(audio[i]));

    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(
        "frame " + hdr[0] + "\n" +
        "sr " + hdr[1] + "\n" +
        "pk " + pk + "\n" +
        "tp " + tp + "\n" +
        "rms " + rms + "\n" +
        "lufs " + lufs + "\n" +
        "corr " + corr + "\n" +
        "b0 " + energy[0] + "\n" +
        "b1 " + energy[1] + "\n" +
        "b2 " + energy[2] + "\n" +
        "b3 " + energy[3] + "\n" +
        "scopepk " + scopePk + "\n" +
        "pass " + pass + "\n" +
        "dur " + durMs + "\n"
    );
    report.close();
    outlet(0, "bang");
}
