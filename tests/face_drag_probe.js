// Records the last gate / ceiling / wtpos / warp list the face v8ui sends.
// Harness contract: resultpath at load, analyze at the end of the window.

inlets = 1;
outlets = 1;

var resultPath = "";
var gateV = -999;
var ceilV = -999;
var wtposV = -999;
var warpV = -999;

function resultpath(p) {
    resultPath = String(p);
}

function gate(v) { gateV = Number(v); }
function ceiling(v) { ceilV = Number(v); }
function wtpos(v) { wtposV = Number(v); }
function warp(v) { warpV = Number(v); }

function analyze() {
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring("gate " + gateV + "\nceiling " + ceilV + "\nwtpos " + wtposV + "\nwarp " + warpV + "\n");
    report.close();
    outlet(0, "bang");
}
