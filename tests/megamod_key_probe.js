// v8 probe for scripts/run_megamod_key_tests.py (loaded through scripts/max_harness.py as `v8`).
// The runner prepends `var CASE = {dir: "<exchange dir>"};` to a temp copy of this file.
// It keeps the Max session alive and answers commands that the runner appends to <dir>/cmd.txt
// (one per line: `<n> <verb> [args]`), so the runner can interleave real OS keys / clicks with state reads:
//   seed <file>      send `setvalueof <list>` (the list is in <file>, space separated) to obj-viz (`receive mmkeyseed` -> obj-viz)
//   report <tag>     send test_report through the device's hook, append {tag, report} to <dir>/reports.jsonl
//   geom <tag>       append the window / patcher geometry to <dir>/geom.jsonl
//   quit             write the result file and bang outlet 0 (the harness then ends Max)
// Acks go to <dir>/ack.txt (last command number). <dir>/ready appears when the harness reaches `analyze`.
// Polling uses a Task (wall clock); the DSP window itself is tiny and ignored.

inlets = 1;
outlets = 2;

var resultPath = "/tmp/megamod_keys_result.txt";
function resultpath(p) { resultPath = String(p); }

var done = 0;
var seen = 0;
var tick = null;
var reportsText = "";
var geomText = "";

function writeText(path, text) {
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) return false;
    f.writestring(text);
    f.close();
    return true;
}
function readLines(path) {
    var f = new File(path, "read", "TEXT");
    if (!f.isopen) return [];
    var out = [];
    var s;
    while ((s = f.readline(4000000)) !== null && s !== undefined) out.push(String(s));
    f.close();
    return out;
}

function loadbang() { }

function analyze() {
    // the harness's end-of-recording message: stay alive instead of finishing
    writeText(CASE.dir + "/ready", "1\n");
    if (!tick) {
        tick = new Task(poll, this);
        tick.interval = 100;
        tick.repeat();
    }
}

function wind() {
    var w = null;
    try { w = this.patcher.wind; } catch (e) {}
    return w;
}

function doCmd(n, line) {
    var sp = line.indexOf(" ");
    var verb = sp < 0 ? line : line.slice(0, sp);
    var arg = sp < 0 ? "" : line.slice(sp + 1);
    if (verb === "seed") {
        var items = readLines(arg)[0].split(" ");
        var msg = [];
        for (var i = 0; i < items.length; i++) msg.push(/^-?\d+$/.test(items[i]) ? Number(items[i]) : items[i]);
        messnamed.apply(null, ["mmkeyseed"].concat(msg));
    } else if (verb === "report") {
        var g = new Global("megamod_test");
        g.last = "";
        messnamed("megamod-test", "test_report");
        var rep = g.last ? JSON.parse(String(g.last)) : null;
        // keep only what the runner needs (the full report is several kB per mapping)
        var small = rep ? { mods: rep.mods, mappings: rep.mappings.map(function (m) { return { id: m.id, mod: m.mod, mode: m.mode }; }) } : null;
        reportsText += JSON.stringify({ tag: arg, report: small }) + "\n";
        writeText(CASE.dir + "/reports.jsonl", reportsText);
    } else if (verb === "geom") {
        var info = { tag: arg };
        try { info.locked = this.patcher.locked; } catch (e) { info.lockedErr = String(e); }
        try { var w = wind(); info.location = Array.prototype.slice.call(w.location); info.size = Array.prototype.slice.call(w.size); info.hasMenu = 1; } catch (e) { info.windErr = String(e); }
        try { var b = this.patcher.getnamed("MegaModState"); info.vizRect = Array.prototype.slice.call(b.rect); info.vizPresentation = b.getattr("presentation"); info.vizPresRect = Array.prototype.slice.call(b.getattr("presentation_rect")); } catch (e) { info.vizErr = String(e); }
        geomText += JSON.stringify(info) + "\n";
        writeText(CASE.dir + "/geom.jsonl", geomText);
    } else if (verb === "quit") {
        writeText(resultPath, "ok 1\ncommands " + n + "\n");
        done = 1;
        if (tick) tick.cancel();
        outlet(0, "bang");
    }
}

function poll() {
    if (done) return;
    var lines = readLines(CASE.dir + "/cmd.txt");
    while (seen < lines.length && !done) {
        var l = lines[seen];
        seen++;
        var sp = l.indexOf(" ");
        var n = Number(sp < 0 ? l : l.slice(0, sp));
        try { doCmd(n, sp < 0 ? "" : l.slice(sp + 1)); } catch (e) { writeText(CASE.dir + "/error.txt", String(e) + "\n"); }
        writeText(CASE.dir + "/ack.txt", String(n) + "\n");
    }
}
