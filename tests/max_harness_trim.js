// Shared by scripts/max_harness.py. Copies the measured window out of `rec_full` into `rec`
// (dropping the settle period), stamps both buffers with the real DSP sample rate, writes a
// small harness report, then bangs so the scaffold sends `analyze <dur_ms>` to the probe.

inlets = 1;
outlets = 1;

var dspSr = 0;
var infoPath = jsarguments.length > 1 ? String(jsarguments[1]) : "";

function sr(v) {
    dspSr = Number(v) || 0;
}

// Probe finished: tell scripts/max_harness.py to SIGTERM this Max (never `; max quit`, it crashes).
function done() {
    if (!infoPath) return;
    var f = new File(infoPath + ".done", "write", "TEXT");
    f.eof = 0;
    f.writestring("done\n");
    f.close();
}

function trim(settle, dur, channels) {
    settle = Math.round(settle);
    dur = Math.round(dur);
    channels = Math.round(channels);
    var full = new Buffer("rec_full");
    var rec = new Buffer("rec");
    if (dspSr > 0) {
        full.send("sr", dspSr);
        rec.send("sr", dspSr);
    }
    var copied = 0;
    for (var ch = 1; ch <= channels; ch++) {
        for (var i = 0; i < dur; i += 4096) {
            var count = Math.min(4096, dur - i);
            var chunk = full.peek(ch, settle + i, count);
            if (typeof chunk === "number") chunk = [chunk];
            rec.poke(ch, i, chunk);
            if (ch === 1) copied += chunk.length;
        }
    }
    if (infoPath) {
        var f = new File(infoPath, "write", "TEXT");
        f.eof = 0;
        f.writestring("sr " + dspSr + "\nsettle " + settle + "\ndur " + dur + "\ncopied " + copied + "\n");
        f.close();
    }
    outlet(0, "bang");
}
