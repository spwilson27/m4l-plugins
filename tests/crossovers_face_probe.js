// Records the last Low / High cutoff the Harmonic Split face sends.
// Harness contract: resultpath at load, analyze at the end of the window.
// "none" means the click did not send that cutoff (the value stayed put).

inlets = 1;
outlets = 1;

var resultPath = "";
var lowV = "none";
var highV = "none";
var dirV = "none";

function resultpath(p) {
    resultPath = String(p);
}

function lowcut(v) { lowV = String(v); }
function highcut(v) { highV = String(v); }
function msg_int(v) { dirV = String(v); }
function msg_float(v) { dirV = String(v); }

function analyze() {
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring("lowcut " + lowV + "\nhighcut " + highV + "\ndir " + dirV + "\n");
    report.close();
    outlet(0, "bang");
}
