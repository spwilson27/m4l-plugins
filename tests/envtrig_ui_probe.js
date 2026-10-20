// UI probe for scripts/run_envtrig_ui_tests.py, run by scripts/max_harness.py as a `v8` object
// (classic `js` and `v8` Globals clash on the same name, and the device's strip writes from v8).
//
// Harness contract: `resultpath <file>` at load, `analyze <dur_ms>` at the end of the window.
// Sample-timed harness events send `step test_report` / `step test_click`; each step is forwarded
// to the device's test hook (`receive envtrig-test`), and each report the strip writes to
// Global("envtrig_test").last is recorded. analyze writes one `key value` line per field:
//   reports <n>
//   r<i>_open, r<i>_toggle, r<i>_width   strip state, MIDI To Panel value, last setwidth
//   r<i>_hidden, r<i>_shown, r<i>_missing   panel widgets hidden / visible / not found

inlets = 1;
outlets = 1;

var resultPath = "";
var reports = [];

function resultpath(p) {
    resultPath = String(p);
}

function step(kind) {
    var g = new Global("envtrig_test");
    if (kind === "test_report") g.last = "";
    messnamed("envtrig-test", String(kind));
    if (kind === "test_report") reports.push(g.last ? String(g.last) : "");
}

function analyze() {
    var lines = ["reports " + reports.length];
    for (var i = 0; i < reports.length; i++) {
        var r = null;
        try {
            r = reports[i] ? JSON.parse(reports[i]) : null;
        } catch (err) {
            r = null;
        }
        if (!r) {
            lines.push("r" + i + "_open -1");
            continue;
        }
        var hidden = 0;
        var shown = 0;
        var missing = 0;
        for (var name in r.hidden) {
            if (r.hidden[name] === 1) hidden++;
            else if (r.hidden[name] === 0) shown++;
            else missing++;
        }
        lines.push("r" + i + "_open " + r.open);
        lines.push("r" + i + "_toggle " + r.toggle);
        lines.push("r" + i + "_width " + r.width);
        lines.push("r" + i + "_hidden " + hidden);
        lines.push("r" + i + "_shown " + shown);
        lines.push("r" + i + "_missing " + missing);
    }
    var f = new File(resultPath, "write", "TEXT");
    for (var k = 0; k < lines.length; k++) f.writeline(lines[k]);
    f.close();
    outlet(0, "bang");
}
