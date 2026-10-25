// Probe for scripts/run_ampplus_audio_tests.py. Reads buffer rec channel 1.
inlets = 1;
outlets = 1;

var resultPath = "/tmp/ampplus_audio.txt";
function resultpath(p) { resultPath = String(p); }

function analyze(durMs) {
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000) : 48000;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var sum = 0;
    var peak = 0;
    var nan = 0;
    var i;
    for (i = 0; i < n; i++) {
        // peek(ch, index, 1) returns a number. A longer count returns an array.
        var x = rec.peek(1, i, 1);
        var v = (typeof x === "number") ? x : ((x && x.length) ? x[0] : 0);
        if (v !== v || v === Infinity || v === -Infinity) nan++;
        else {
            var a = v < 0 ? -v : v;
            if (a > peak) peak = a;
            sum += v * v;
        }
    }
    var rms = Math.sqrt(sum / Math.max(1, n));
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring("rms " + rms + "\npeak " + peak + "\nnan " + nan + "\nframes " + n + "\n");
    report.close();
    outlet(0, "bang");
}
