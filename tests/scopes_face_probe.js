// Records the last EQ parameter list and the oscilloscope trigger report.
// Harness contract: resultpath at load, analyze at the end of the window.

inlets = 1;
outlets = 1;

var resultPath = "";
var gain = "none";
var freq = "none";
var q = "none";
var extra = "none";
var trigV = "none";

function resultpath(p) {
    resultPath = String(p);
}

function param(name, value) {
    var key = String(name);
    if (key === "b1_gain") gain = String(value);
    else if (key === "b1_freq") freq = String(value);
    else if (key === "b1_q") q = String(value);
    else if (key === "b2_enable") extra = String(value);
}

function trig(v) {
    trigV = String(v);
}

function setwidth() {}

function analyze() {
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring("gain " + gain + "\nfreq " + freq + "\nq " + q + "\nextra " + extra + "\ntrig " + trigV + "\n");
    report.close();
    outlet(0, "bang");
}
