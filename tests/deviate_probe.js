// Audio probe for scripts/run_deviate_audio_tests.py (v8: ES6). The runner prepends src/deviate_config.js to this file, so the
// probe compares against the real mirrors (dvStep, dvHiddenFromMetas, DV_SCOPE ...).
// jsarguments: case name, latency to test (samples).
// Messages (from the patch's loadbang): `setbuffers <scope> <tap>`, `tapnames n0 n1 ...` (the columns of the tap buffer),
// `dparams v0..v7 r0..r7 l0..l7 chance seed drift` (optional: draws expected for a sequence of hits).
// scripts/max_harness.py records the measured window (settle 0) into buffer~ rec, 3 channels: ch1 out L, ch2 out R, ch3 source L.
// The tap buffer holds one row per 16 samples, one column per tapnames entry (the tap gen peeks the scope buffer).
// The `key value` report at resultPath is created LAST (one token per value; lists are comma separated).

inlets = 1;
outlets = 1;

var caseName = jsarguments.length > 1 ? String(jsarguments[1]) : "x";
var latArg = jsarguments.length > 2 ? Number(jsarguments[2]) : 256;
var names = { scope: "", tap: "" };
var tapNames = [];
var drawP = null;
var resultPath = "/tmp/deviate_audio.txt";
var armed = false;

function setbuffers(scope, tap) {
    names.scope = String(scope);
    names.tap = String(tap);
}

function tapnames() {
    tapNames = Array.prototype.slice.call(arguments).map(String);
}

function dparams() {
    var a = Array.prototype.slice.call(arguments).map(Number);
    drawP = { v: a.slice(0, 8), r: a.slice(8, 16), lock: a.slice(16, 24), chance: a[24], seed: a[25], drift: a[26] };
}

function resultpath(p) {
    resultPath = String(p);
}

function readChannel(buf, channel, n) {
    var out = new Float64Array(n);
    for (var i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var chunk = buf.peek(channel, i, count);
        if (!chunk) continue;
        if (typeof chunk === "number") { out[i] = chunk; continue; }
        for (var k = 0; k < count; k++) out[i + k] = chunk[k];
    }
    return out;
}

function firstAbove(a, thr) {
    for (var i = 0; i < a.length; i++) if (Math.abs(a[i]) > thr) return i;
    return -1;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var n = rec.framecount();
    var out = "";
    var kv = function (k, v) { out += k + " " + v + "\n"; };
    var L = readChannel(rec, 1, n);
    var R = readChannel(rec, 2, n);
    var S = readChannel(rec, 3, n);
    var nan = 0, maxL = 0, maxR = 0, diffL = 0, diffR = 0, prefmax = 0, tailmax = 0;
    for (var i = 0; i < n; i++) {
        var l = L[i], r = R[i];
        if (!isFinite(l) || !isFinite(r)) { nan++; continue; }
        maxL = Math.max(maxL, Math.abs(l));
        maxR = Math.max(maxR, Math.abs(r));
        if (i >= n - 24000) tailmax = Math.max(tailmax, Math.abs(l), Math.abs(r));
        if (i < latArg) prefmax = Math.max(prefmax, Math.abs(l), Math.abs(r));
        else {
            diffL = Math.max(diffL, Math.abs(l - S[i - latArg]));
            diffR = Math.max(diffR, Math.abs(r - S[i - latArg]));
        }
    }
    var sf = firstAbove(S, 0.5), df = firstAbove(L, 0.5);
    kv("n", n); kv("nan", nan); kv("maxL", maxL); kv("maxR", maxR); kv("diffL", diffL); kv("diffR", diffR);
    kv("prefmax", prefmax); kv("tailmax", tailmax); kv("srcfirst", sf); kv("devfirst", df);
    kv("unity", sf >= 0 && df >= 0 && S[sf] !== 0 ? L[df] / S[sf] : 0);

    // ---- the tap rows ----
    var stride = tapNames.length;
    var col = {};
    for (var c = 0; c < stride; c++) col[tapNames[c]] = c;
    var rows = 0;
    var tap = null;
    if (names.tap && stride > 0) {
        var tb = new Buffer(names.tap);
        rows = Math.min(Math.floor(tb.framecount() / stride), Math.floor(n / 16));
        tap = readChannel(tb, 1, rows * stride);
    }
    var get = function (name, r) { return tap[r * stride + col[name]]; };
    var hitRows = [], appliedRows = [];
    if (rows > 1) {
        for (var q = 0; q < tapNames.length; q++) {
            var nm = tapNames[q];
            kv("f_" + nm, get(nm, 0));
            kv("t_" + nm, get(nm, rows - 1));
            if (nm.indexOf("pk") === 0 || nm === "ringenv") {
                var mx = 0;
                for (var rr = 0; rr < rows; rr++) mx = Math.max(mx, get(nm, rr));
                kv("max_" + nm, mx);
            }
        }
        for (var r2 = 1; r2 < rows; r2++) {
            if (get("hits", r2) !== get("hits", r2 - 1)) hitRows.push(r2);
            if (get("applied", r2) !== get("applied", r2 - 1)) appliedRows.push(r2);
        }
        kv("hit_samples", hitRows.length ? hitRows.map(function (x) { return x * 16 + 15; }).join(",") : "none");
        kv("applied_samples", appliedRows.length ? appliedRows.map(function (x) { return x * 16 + 15; }).join(",") : "none");
        // per hit: the draws / metas / serial / gate a few rows after the hit (settled), and the expected draws from dvStep
        var st = dvNewState();
        for (var h = 0; h < Math.min(hitRows.length, 12); h++) {
            var rh = Math.min(rows - 1, hitRows[h] + 4);
            var dr = [], me = [];
            for (var i2 = 0; i2 < 8; i2++) { dr.push(get("d" + i2, rh)); me.push(get("m" + i2, rh)); }
            kv("draws" + h, dr.join(","));
            kv("metas" + h, me.join(","));
            kv("ser" + h, get("serial", rh));
            kv("gate" + h, get("gate", rh));
            if (drawP) {
                dvStep(st, drawP, "hit");
                var e1 = 0, e2 = 0;
                for (var i3 = 0; i3 < 8; i3++) {
                    e1 = Math.max(e1, Math.abs(dr[i3] - Math.fround(st.T[i3])));
                    e2 = Math.max(e2, Math.abs(me[i3] - Math.fround(st.E[i3])));
                }
                kv("drawerr" + h, e1);
                kv("metaserr" + h, e2);
            }
        }
    }

    // ---- the scope buffer at the end ----
    if (names.scope) {
        var sb = new Buffer(names.scope);
        var sc = readChannel(sb, 1, DV_SCOPE_SAMPS);
        for (var s = 0; s < 160; s++) kv("s" + s, sc[s]);
        // hidden values against dvHiddenFromMetas of the telemetry metas / draws
        var metas = [], draws = [];
        for (var k = 0; k < 8; k++) { metas.push(sc[DV_SCOPE.METAS + k]); draws.push(sc[DV_SCOPE.DRAWS + k]); }
        var hv = dvHiddenFromMetas(metas, draws);
        var maxerr = 0, stepbad = 0;
        for (var j = 0; j < DV_HIDDEN_COUNT; j++) {
            var row = DV_HIDDEN[j];
            var got = sc[DV_SCOPE.HIDDEN + j];
            if (row.curve === "step") { if (got !== hv[j]) stepbad++; }
            else maxerr = Math.max(maxerr, Math.abs(got - hv[j]) / (Math.abs(row.hi - row.lo) || 1));
        }
        kv("hidden_maxerr", maxerr);
        kv("hidden_stepbad", stepbad);
        kv("irtag_expected", hv[DV_HIDDEN_INDEX.conv_ir]);
        // waveform ring
        var nz = 0, fl = 0;
        for (var b = 0; b < DV_WAVE_BLOCKS; b++) {
            var o = DV_SCOPE.WAVE + b * DV_WAVE_STRIDE;
            if (sc[o] !== 0 || sc[o + 1] !== 0 || sc[o + 2] !== 0 || sc[o + 3] !== 0) nz++;
            if (sc[o + 4] > 0.5) fl++;
        }
        kv("wavenz", nz);
        kv("waveflag", fl);
        kv("wavehead", sc[DV_SCOPE.WAVE_HEAD]);
    }

    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(out);
    report.close();
    post("DEVIATE_SHUTDOWN\n");
    outlet(0, "bang");
}
