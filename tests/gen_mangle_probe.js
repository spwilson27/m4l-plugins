// Compare original and mangled gen~ outputs. Channels are original 1..N then mangled 1..N.
// jsarguments: N (outlet count being compared).

inlets = 1;
outlets = 1;

var half = jsarguments.length > 1 ? parseInt(jsarguments[1], 10) : 2;
var resultPath = "/tmp/gen_mangle.txt";

function resultpath(p) { resultPath = String(p); }

function analyze(durMs) {
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000) : 48000;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var maxDiff = 0;
    var peak = 0;
    var nans = 0;
    var c;
    var i;
    for (c = 0; c < half; c++) {
        var a = readChannel(rec, c + 1, n);
        var b = readChannel(rec, c + 1 + half, n);
        for (i = 0; i < n; i++) {
            var av = a[i];
            var bv = b[i];
            if (av !== av || bv !== bv) nans += 1;
            var d = Math.abs(av - bv);
            if (d > maxDiff) maxDiff = d;
            var p = Math.abs(av);
            if (p > peak) peak = p;
        }
    }
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring("maxdiff " + maxDiff + "\npeak " + peak + "\nnan " + nans + "\nframes " + n + "\n");
    report.close();
    outlet(0, "bang");
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
        for (k = 0; k < chunk.length; k++) out.push(chunk[k]);
    }
    return out;
}
