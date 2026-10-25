// Records the last amount / freq / res the face v8ui sends.
// Harness contract: resultpath at load, analyze at the end of the window.

inlets = 1;
outlets = 1;

var resultPath = "";
var amountV = -999;
var freqV = -999;
var resV = -999;

function resultpath(p) {
    resultPath = String(p);
}

function amount(v) { amountV = Number(v); }
function freq(v) { freqV = Number(v); }
function res(v) { resV = Number(v); }

function analyze() {
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring("amount " + amountV + "\nfreq " + freqV + "\nres " + resV + "\n");
    report.close();
    outlet(0, "bang");
}
