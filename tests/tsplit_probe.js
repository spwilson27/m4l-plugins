// Result writer for scripts/run_tsplit_audio_tests.py (legacy [js], ES5, run by scripts/max_harness.py).
// The stimulus is loaded by `buffer~ src <wav>` at patch load, so this probe only
//   * pokes the learned centroids into buffer~ tscent on `fillcent <64 floats>` (centroid k at k * 16),
//   * on `analyze <durMs>` writes buffer~ rec (6 channels: chain sum, dry input, chain 1, 2, 3, all-class chain) as a
//     headerless float32 file to jsarguments[1] and the first 32 floats of buffer~ tsscope1 into the result file as
//     `s0 .. s31`, bangs outlet 0.
// The harness sends `resultpath <file>` at load.

inlets = 1;
outlets = 1;

var rawPath = jsarguments.length > 1 ? String(jsarguments[1]) : "/tmp/tsplit_rec.raw";
var resultPath = "/tmp/tsplit_result.txt";

function resultpath(p) { resultPath = String(p); }

function fillcent() {
    var a = arrayfromargs(arguments);
    var buf = new Buffer("tscent");
    buf.poke(1, 0, a);
    post("TSPLIT_CENT " + a.length + " floats\n");
}

function analyze(durMs) {
    var rec = new Buffer("rec");
    rec.send("samptype", "float32");
    rec.send("writeraw", rawPath);
    var sc = new Buffer("tsscope1");
    var d = sc.peek(1, 0, 32);
    var f = new File(resultPath, "write", "TEXT");
    f.eof = 0;
    var out = "frames " + rec.framecount() + "\n";
    for (var i = 0; i < d.length; i++) out += "s" + i + " " + d[i] + "\n";
    f.writestring(out);
    f.close();
    post("TSPLIT_RESULT counter " + d[0] + "\n");
    outlet(0, "bang");
}
