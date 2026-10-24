// Peak of every recorded channel. jsarguments: channel count.

inlets = 1;
outlets = 1;

var channels = jsarguments.length > 1 ? parseInt(jsarguments[1], 10) : 1;
var resultPath = "/tmp/gen_name.txt";

function resultpath(p) { resultPath = String(p); }

function analyze(durMs) {
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000) : 48000;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    var c;
    for (c = 0; c < channels; c++) {
        var a = readChannel(rec, c + 1, n);
        var peak = 0;
        var i;
        for (i = 0; i < a.length; i++) {
            var v = a[i];
            if (v !== v) peak = -1;
            else if (Math.abs(v) > peak) peak = Math.abs(v);
        }
        report.writestring("ch" + c + " " + peak + "\n");
    }
    report.writestring("frames " + n + "\n");
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
