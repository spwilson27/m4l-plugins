// Audio probe for scripts/run_delayplus_audio_tests.py.
// jsarguments: case name, dump flag (1 = write the recorded channels to <result>.data),
// buffer~ names arrive via `setbuffers xfer hdr scope scopeE`.
// scripts/max_harness.py records the measured window (exact duration) into buffer~ rec, 3 channels:
//   ch1: Delay+ End out L   ch2: End out R   ch3: reference marker (source impulse)
//
// <result>.data (channels, each sample stored as round((v + 8) * 1e5), a non-negative integer so text wrapping cannot split a sign) is written first; the `key value` report at resultPath is created LAST.

inlets = 1;
outlets = 1;

var mode = jsarguments.length > 1 ? jsarguments[1] : "timing";
var dump = jsarguments.length > 2 ? Number(jsarguments[2]) : 0;
var armed = false;
var names = {
    xfer: jsarguments.length > 3 ? jsarguments[3] : "dpxfer",
    hdr: jsarguments.length > 4 ? jsarguments[4] : "dphdr",
    scope: jsarguments.length > 5 ? jsarguments[5] : "dpscope",
    scopeE: jsarguments.length > 6 ? jsarguments[6] : "dpscopeE"
};
var resultPath = "/tmp/delayplus_audio.txt";

// Instance-local buffer names (#0-...) arrive as a message from the patch at load.
function setbuffers(xfer, hdr, scope, scopeE) {
    names.xfer = "" + xfer;
    names.hdr = "" + hdr;
    names.scope = "" + scope;
    names.scopeE = "" + scopeE;
}

function resultpath(p) {
    resultPath = String(p);
}

function loadbang() {
    post("DELAYPLUS_PROBE_LOADED " + mode + "\n");
}

function readChannel(buf, channel, n) {
    var out = [];
    for (var i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var chunk = buf.peek(channel, i, count);
        var k;
        if (!chunk) {
            for (k = 0; k < count; k++) out.push(0);
            continue;
        }
        if (typeof chunk === "number") {
            out.push(chunk);
            continue;
        }
        for (k = 0; k < count; k++) out.push(chunk[k]);
    }
    return out;
}

function readHead(name, n) {
    if (!name) return [];
    var b = new Buffer(name);
    var v = b.peek(1, 0, n);
    if (typeof v === "number") return [v];
    var out = [];
    for (var i = 0; v && i < v.length; i++) out.push(v[i]);
    return out;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var n = rec.framecount();
    var ch = [readChannel(rec, 1, n), readChannel(rec, 2, n), readChannel(rec, 3, n)];
    var nan = 0;
    var maxabs = [0, 0];
    var i, c;
    for (c = 0; c < 3; c++) {
        for (i = 0; i < n; i++) {
            var v = ch[c][i];
            if (v !== v || v === Infinity || v === -Infinity) nan++;
            else if (c < 2 && Math.abs(v) > maxabs[c]) maxabs[c] = Math.abs(v);
        }
    }

    if (dump) {
        var data = new File(resultPath + ".data", "write", "TEXT");
        data.eof = 0;
        for (c = 0; c < 3; c++) {
            data.writestring("ch" + (c + 1));
            for (i = 0; i < n; i += 4096) {
                var parts = [];
                for (var k = i; k < Math.min(n, i + 4096); k++) parts.push(Math.round((ch[c][k] + 8) * 100000));
                data.writestring(" " + parts.join(" "));
            }
            data.writestring("\n");
        }
        data.close();
    }

    var out = "n " + n + "\nnan " + nan + "\nmaxabs1 " + maxabs[0] + "\nmaxabs2 " + maxabs[1] + "\n";
    var hdr = readHead(names.hdr, 20);
    var sc = readHead(names.scope, 24);
    for (i = 0; i < hdr.length; i++) out += "h" + i + " " + hdr[i] + "\n";
    for (i = 0; i < sc.length; i++) out += "s" + i + " " + sc[i] + "\n";
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(out);
    report.close();
    post("DELAYPLUS_SHUTDOWN\n");
    outlet(0, "bang");
}
