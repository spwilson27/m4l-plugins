// UI probe for scripts/run_envtrig_ui_tests.py (standalone Max, runs in a `v8` object:
// classic `js` and `v8` Globals clash on the same name).
// Drives the device's test hook (`receive envtrig-test`) and records the panel state
// the strip reports into Global("envtrig_test").last after each step.
// Steps: report, click, report, click, report, click, report.
// The report file /tmp/envtrig_ui.txt is created ONLY at the end so the runner never
// reads a partial file.

inlets = 1;
outlets = 1;

var STEPS = ["test_report", "test_click", "test_report", "test_click", "test_report", "test_click", "test_report"];
var results = [];
var step = 0;
var task = null;

function run() {
    step = 0;
    results = [];
    task = new Task(next, this);
    task.interval = 250;
    task.repeat(STEPS.length + 1);
}

function next() {
    if (step < STEPS.length) {
        messnamed("envtrig-test", STEPS[step]);
        if (STEPS[step] === "test_report") {
            var g = new Global("envtrig_test");
            results.push(g.last ? String(g.last) : "null");
        }
        step++;
        return;
    }
    var f = new File("/tmp/envtrig_ui.txt", "write", "TEXT");
    for (var i = 0; i < results.length; i++) f.writeline(results[i]);
    f.close();
    post("ENVTRIG_UI_DONE " + results.length + "\n");
    outlet(0, "bang");
}
