// Source generator for scripts/run_timbre_audio_tests.py (legacy [js], ES5).
// Message `fill <samplerate>` writes the scenario named by jsarguments[1] into buffer~ src
// (mono) and bangs outlet 0 when done. `dumpscope` writes the 2064 floats of buffer~ timbrescope as text to
// jsarguments[2] (one value per line) and bangs outlet 1. Segments are [kind, seconds, rms dBFS]; the
// oscillator phase runs on across segments and the noise is a fixed LCG, so every run
// produces the same stimulus (the runner re-reads the recorded dry channel anyway).

inlets = 1;
outlets = 2;

var scenario = jsarguments.length > 1 ? String(jsarguments[1]) : "switches";
var scopePath = jsarguments.length > 2 ? String(jsarguments[2]) : "/tmp/timbre_scope.txt";

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
    outlet(0, "bang");
}

function dumpscope() {
    var buf = new Buffer("timbrescope");
    var d = buf.peek(1, 0, 2064);
    var f = new File(scopePath, "write", "TEXT");
    var out = "";
    for (var i = 0; i < d.length; i++) out += d[i] + "\n";
    f.writestring(out);
    f.close();
    post("TIMBRE_SCOPE " + d.length + " counter " + d[0] + "\n");
    outlet(1, "bang");
}
