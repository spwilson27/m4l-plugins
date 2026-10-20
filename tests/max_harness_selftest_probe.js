// Probe for scripts/run_max_harness_selftest.py. ch1 = absolute sample index (1-based), ch2 = event step.
inlets = 1;
outlets = 1;
var resultPath = "/tmp/max_harness_selftest.txt";
function resultpath(p) { resultPath = String(p); }
function analyze(durMs) {
    var rec = new Buffer("rec");
    var n = rec.framecount();
    var a = rec.peek(1, 0, n), b = rec.peek(2, 0, n);
    var eventAt = -1, mono = 1;
    for (var i = 0; i < n; i++) {
        if (i > 0 && a[i] !== a[i - 1] + 1) mono = 0;
        if (eventAt < 0 && b[i] > 0.5) eventAt = a[i];
    }
    var f = new File(resultPath, "write", "TEXT");
    f.eof = 0;
    f.writestring("frames " + n + "\nfirst " + a[0] + "\nlast " + a[n - 1] + "\ncontiguous " + mono +
                  "\neventAt " + eventAt + "\nbufms " + rec.length() + "\n");
    f.close();
    outlet(0, "bang");
}
