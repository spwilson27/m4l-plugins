// Probe for scripts/measure_glitch_loadtime.py: reports the rendered length so the run is valid.
inlets = 1;
outlets = 1;
var resultPath = "/tmp/glitch_loadtime.txt";
function resultpath(p) { resultPath = String(p); }
function analyze(durMs) {
    var rec = new Buffer("rec");
    var f = new File(resultPath, "write", "TEXT");
    f.eof = 0;
    f.writestring("frames " + rec.framecount() + "\n");
    f.close();
    outlet(0, "bang");
}
