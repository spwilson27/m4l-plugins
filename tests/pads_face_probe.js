// Records what a pads/maps face already sends: param outlets, and the engine
// buffers the face pokes (glitch slot weights, Mega Modulator cfg and steps).
// Harness contract: resultpath at load, analyze at the end of the window.

inlets = 1;
outlets = 1;

var resultPath = "";
var slotsName = "";
var cfgName = "";
var stepsName = "";
var wIdx = 6816;
var cfgX = 24;
var cfgY = 25;
var stepIdx = 0;
var morphx = -999;
var morphy = -999;
var morphxN = 0;
var morphyN = 0;

function resultpath(p) { resultPath = String(p); }
function slotsbuf(n) { slotsName = String(n); }
function cfgbuf(n) { cfgName = String(n); }
function stepsbuf(n) { stepsName = String(n); }
function widx(i) { wIdx = Number(i); }
function cfgxy(x, y) { cfgX = Number(x); cfgY = Number(y); }
function stepidx(i) { stepIdx = Number(i); }

function param(key, v) {
    if (String(key) === "morphx") { morphx = Number(v); morphxN++; }
    else if (String(key) === "morphy") { morphy = Number(v); morphyN++; }
}

function anything() {}

function peek1(name, index) {
    if (!name) return -999;
    try {
        var b = new Buffer(name);
        var v = b.peek(1, index, 1);
        if (typeof v === "number") return v;
        if (v && v.length) return v[0];
    } catch (e) {}
    return -999;
}

function analyze() {
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring("morphx " + morphx + "\n");
    report.writestring("morphy " + morphy + "\n");
    report.writestring("morphx_n " + morphxN + "\n");
    report.writestring("morphy_n " + morphyN + "\n");
    report.writestring("weight0 " + peek1(slotsName, wIdx) + "\n");
    report.writestring("weight1 " + peek1(slotsName, wIdx + 1) + "\n");
    report.writestring("cfgx " + peek1(cfgName, cfgX) + "\n");
    report.writestring("cfgy " + peek1(cfgName, cfgY) + "\n");
    report.writestring("step0 " + peek1(stepsName, stepIdx) + "\n");
    report.close();
    outlet(0, "bang");
}
