// Source generator and result writer for scripts/run_timbre_audio_tests.py (legacy [js], ES5, run by
// scripts/max_harness.py). Message `fill <samplerate>` writes the scenario named by jsarguments[1] into
// buffer~ src (mono). The harness sends `resultpath <file>` at load and `analyze <durMs>` once buffer~ rec
// (4 channels: out1, dry input, control out3, out2) holds the measured window: `analyze` writes that
// buffer as a headerless float32 file to jsarguments[2], the first 16 floats of buffer~ timbrescope into the result
// file as `s0 .. s15` and bangs outlet 0. Segments are [kind, seconds, rms dBFS]; the
// oscillator phase runs on across segments and the noise is a fixed LCG, so every run
// produces the same stimulus (the runner re-reads the recorded dry channel anyway).

inlets = 1;
outlets = 1;

var scenario = jsarguments.length > 1 ? String(jsarguments[1]) : "switches";
var rawPath = jsarguments.length > 2 ? String(jsarguments[2]) : "/tmp/timbre_rec.raw";
var resultPath = "/tmp/timbre_result.txt";

function resultpath(p) { resultPath = String(p); }

var SCEN = {
    // sine -> saw -> noise -> saw (timbre switches at 1, 2, 3 s at equal loudness),
    // then the same saw +12 dB at 4 s and back at 5 s (level changes only), silence tail.
    switches: [
        ["sine", 1.0, -18], ["saw", 1.0, -18], ["noise", 1.0, -18], ["saw", 1.0, -18],
        ["saw", 1.0, -6], ["saw", 1.0, -18], ["sil", 0.6, 0]
    ],
    silence: [["sil", 3.0, 0]]
};

function fill(sr) {
    var segs = SCEN[scenario] || SCEN.switches;
    sr = Number(sr) || 44100;
    var total = 0;
    var i;
    for (i = 0; i < segs.length; i++) total += Math.round(segs[i][1] * sr);
    var arr = new Array(total);
    var ph = 0;
    var inc = 220.0 / sr;
    var seed = 12345;
    var pos = 0;
    for (var s = 0; s < segs.length; s++) {
        var kind = segs[s][0];
        var len = Math.round(segs[s][1] * sr);
        var rms = Math.pow(10, segs[s][2] / 20);
        for (i = 0; i < len; i++) {
            var v = 0;
            if (kind === "sine") {
                v = rms * Math.SQRT2 * Math.sin(2 * Math.PI * ph);
            } else if (kind === "saw") {
                v = rms * Math.sqrt(3) * (2 * ph - 1);
            } else if (kind === "noise") {
                // 32-bit LCG; the product stays below 2^53, so the double arithmetic is exact
                seed = (seed * 1664525 + 1013904223) % 4294967296;
                v = rms * Math.sqrt(3) * (seed / 2147483648 - 1);
            }
            arr[pos++] = v;
            ph += inc;
            if (ph >= 1) ph -= 1;
        }
    }
    var buf = new Buffer("src");
    buf.send("sizeinsamps", total);
    buf.poke(1, 0, arr);
    post("TIMBRE_FILL " + scenario + " " + total + " " + sr + "\n");
}

function analyze(durMs) {
    var rec = new Buffer("rec");
    // interleaved 4-channel float32 with no header (buffer~ writes WAV as 16-bit only)
    rec.send("samptype", "float32");
    rec.send("writeraw", rawPath);
    var buf = new Buffer("timbrescope");
    var d = buf.peek(1, 0, 16);
    var f = new File(resultPath, "write", "TEXT");
    f.eof = 0;
    var out = "frames " + rec.framecount() + "\n";
    for (var i = 0; i < d.length; i++) out += "s" + i + " " + d[i] + "\n";
    f.writestring(out);
    f.close();
    post("TIMBRE_RESULT counter " + d[0] + "\n");
    outlet(0, "bang");
}
