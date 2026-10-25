// Records play_pos (sampler wavetable drag) and thr (Envelope Trigger scope line).
// Harness contract: resultpath at load, analyze at the end of the window.

inlets = 1;
outlets = 1;

var resultPath = "";
var playPos = [];
var thrV = -999;

function resultpath(p) {
    resultPath = String(p);
}

function param(key, v) {
    if (String(key) === "play_pos") playPos.push(Number(v));
}

function thr(v) {
    thrV = Number(v);
}

function analyze() {
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    var line = playPos.length ? playPos.join(",") : "none";
    report.writestring("play_pos " + line + "\nthr " + thrV + "\n");
    report.close();
    outlet(0, "bang");
}
