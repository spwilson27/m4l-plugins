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
var rWins = [];      // [a, b] ms pairs: max residue (output - delayed source) inside
var clickMs = [];    // click start times (ms) of the spec_t source
var exactFromMs = -1; // exdiff: max |output - delayed source| from this time on (exactness of Mix 0 after a settling time)
var dumpWins = [];   // [start sample, count] windows of the signed residue (output L - delayed source), dumped as `dump<k>`
var resultPath = "/tmp/deviate_audio.txt";
var armed = false;

// `archmap <buffer> <arch> [mode]`: write the hidden map of an Architecture (under an Arch Mode) into the device's ---deviatemap stand-in,
// as the engine does (idle bank, bank index, then the version last). `maprow <buffer> <row id> <lo> <hi>` then pins one row to lo..hi
// (linear in its meta; a discrete row to the integer lo) and writes the map again, so a case can switch on a single module.
// The hidden-value check below uses the last map written.
var probeArch = 0, probeMode = 0;
var probeMapVer = 0;
var probeMap = dvArchMap(0, 0);
function probeWrite(name) {
    var b = new Buffer(String(name));
    var nb = probeMapVer % 2;
    b.poke(1, DV_MAP.BASE + nb * DV_MAP.BANK_STRIDE, dvMapFloats(probeMap));
    b.poke(1, DV_MAP.ARCH, [probeArch, DV_HIDDEN_COUNT]);
    b.poke(1, DV_MAP.BANK, [nb]);
    probeMapVer++;
    b.poke(1, DV_MAP.VER, [probeMapVer]);
}
function archmap(name, arch, mode) {
    probeArch = Math.round(Number(arch) || 0);
    probeMode = Math.round(Number(mode) || 0);
    probeMap = dvArchMap(probeArch, probeMode).map(function (r) { return { meta: r.meta, src: r.src, curve: r.curve, lo: r.lo, hi: r.hi, jit: r.jit }; });
    probeWrite(name);
}
function maprow(name, id, lo, hi) {
    var i = DV_HIDDEN_INDEX[String(id)];
    if (i === undefined) { post("maprow: unknown row " + id + "\n"); return; }
    var d = DV_HIDDEN[i].kind === "D";
    probeMap[i] = { meta: probeMap[i].meta, src: d ? 1 : 0, curve: d ? DV_CURVE_CODE.step : DV_CURVE_CODE.lin, lo: Number(lo), hi: d ? Number(lo) : Number(hi), jit: 1 };
    probeWrite(name);
}
// `tones <start sample> <count> <f1> <f2> ...`: Goertzel amplitudes of the residue (output L - delayed source) in that window, as tone_<f>
var toneWin = null;
function tones() {
    var a = Array.prototype.slice.call(arguments).map(Number);
    toneWin = { start: a[0], count: a[1], f: a.slice(2) };
}

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

function rwindows() {
    rWins = Array.prototype.slice.call(arguments).map(function (s) {
        var q = String(s).split(":");
        return [Number(q[0]), Number(q[1])];
    });
}

function exactfrom(ms) {
    exactFromMs = Number(ms);
}

function dumps() {
    dumpWins = Array.prototype.slice.call(arguments).map(function (w) {
        var q = String(w).split(":");
        return [Number(q[0]), Number(q[1])];
    });
}

function clicks() {
    clickMs = Array.prototype.slice.call(arguments).map(Number);
}

// CPU % from `adstatus cpu` (audio_device mode); NonRealTime has no meaningful real-time load.
var cpuMax = 0, cpuSum = 0, cpuCount = 0;
function cpu(v) {
    cpuMax = Math.max(cpuMax, v);
    cpuSum += v;
    cpuCount++;
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
    // residue = output - the source delayed by the latency (exactly the Mix-scaled effect sum, since the dry path is a bit-exact delay)
    var srcSq = 0, resSq = 0, cntR = 0, maxStep = 0;
    var RES = new Float64Array(n);
    for (var i5 = latArg; i5 < n; i5++) {
        var rl = L[i5] - S[i5 - latArg], rr = R[i5] - S[i5 - latArg];
        RES[i5] = Math.max(Math.abs(rl), Math.abs(rr));
        srcSq += S[i5 - latArg] * S[i5 - latArg];
        resSq += rl * rl;
        cntR++;
        if (i5 > 0) maxStep = Math.max(maxStep, Math.abs(L[i5] - L[i5 - 1]));
    }
    if (exactFromMs >= 0) {
        var exL = 0, exR = 0, ex0 = Math.max(latArg, Math.round(exactFromMs * 48));
        for (var ie = ex0; ie < n; ie++) {
            exL = Math.max(exL, Math.abs(L[ie] - S[ie - latArg]));
            exR = Math.max(exR, Math.abs(R[ie] - S[ie - latArg]));
        }
        kv("exdiffL", exL);
        kv("exdiffR", exR);
    }
    for (var dw = 0; dw < dumpWins.length; dw++) {
        var dv = [];
        for (var id = dumpWins[dw][0]; id < dumpWins[dw][0] + dumpWins[dw][1] && id < n; id++) {
            dv.push(Number((L[id] - (id >= latArg ? S[id - latArg] : 0)).toPrecision(7)));
        }
        kv("dump" + dw, dv.join(","));
    }
    if (toneWin) {
        for (var tf = 0; tf < toneWin.f.length; tf++) {
            var gc = 0, gs = 0, gn = 0;
            for (var it = toneWin.start; it < toneWin.start + toneWin.count && it < n; it++) {
                var rv = L[it] - (it >= latArg ? S[it - latArg] : 0);
                var wv = 2 * Math.PI * toneWin.f[tf] * (it - toneWin.start) / 48000;
                gc += rv * Math.cos(wv);
                gs += rv * Math.sin(wv);
                gn++;
            }
            kv("tone_" + toneWin.f[tf], gn ? 2 * Math.sqrt(gc * gc + gs * gs) / gn : 0);
        }
    }
    kv("src_rms", cntR ? Math.sqrt(srcSq / cntR) : 0);
    kv("res_rms", cntR ? Math.sqrt(resSq / cntR) : 0);
    kv("maxstep", maxStep);
    for (var w = 0; w < rWins.length; w++) {
        var i0 = Math.round(rWins[w][0] * 48), i1 = Math.min(n, Math.round(rWins[w][1] * 48));
        var mxr = 0;
        for (var i6 = i0; i6 < i1; i6++) if (RES[i6] > mxr) mxr = RES[i6];
        kv("rmax_" + rWins[w][0] + "_" + rWins[w][1], mxr);
    }
    if (clickMs.length && rec.channelcount() >= 4) {
        // Spectral stage output T (ch4, aligned with the source delayed by 1279): energy around the clicks and in the tone-only gaps
        var T4 = readChannel(rec, 4, n);
        var clickE = 0, clickT = 0, toneE = 0, toneT = 0, LATS = 1279;
        for (var c4 = 0; c4 < clickMs.length; c4++) {
            var c0 = Math.round(clickMs[c4] * 48);
            clickE += 2 * 0.8 * 0.8;
            for (var i7 = c0 - 100; i7 < c0 + 1400; i7++) if (i7 + LATS < n) clickT += T4[i7 + LATS] * T4[i7 + LATS];
            for (var i8 = c0 + 2400; i8 < c0 + 7200; i8++) if (i8 + LATS < n) {
                toneE += S[i8] * S[i8];
                toneT += T4[i8 + LATS] * T4[i8 + LATS];
            }
        }
        kv("clickE", clickE); kv("clickT", clickT); kv("clickRatio", clickE ? clickT / clickE : 0);
        kv("toneE", toneE); kv("toneT", toneT); kv("toneRatio", toneE ? toneT / toneE : 0);
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
    var hitRows = [], appliedRows = [], serialRows = [];
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
        // the largest fall of the Ring envelope telemetry between two consecutive rows, and its highest value (a jump to 0 is a click)
        var envDrop = 0, envHi = 0;
        for (var r3 = 1; r3 < rows; r3++) {
            envDrop = Math.max(envDrop, get("ringenv", r3 - 1) - get("ringenv", r3));
            envHi = Math.max(envHi, get("ringenv", r3));
        }
        kv("ringenv_maxdrop", envDrop);
        kv("ringenv_hi", envHi);
        for (var r2 = 1; r2 < rows; r2++) {
            if (get("hits", r2) !== get("hits", r2 - 1)) hitRows.push(r2);
            if (get("applied", r2) !== get("applied", r2 - 1)) appliedRows.push(r2);
            if (get("serial", r2) !== get("serial", r2 - 1)) serialRows.push(r2);
        }
        for (var sq = 0; sq < Math.min(serialRows.length, 12); sq++) {
            var rs = Math.min(rows - 1, serialRows[sq] + 4);
            var sd = [];
            for (var i4 = 0; i4 < 8; i4++) sd.push(get("d" + i4, rs));
            kv("sdraws" + sq, sd.join(","));
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
            kv("hitsrc" + h, get("hitsrc", rh));
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
        var amap = probeMap;
        var hv = dvHiddenFromMetas(metas, draws, amap);
        var maxerr = 0, stepbad = 0;
        for (var j = 0; j < DV_HIDDEN_COUNT; j++) {
            var row = amap[j];
            var got = sc[DV_SCOPE.HIDDEN + j];
            if (row.curve === DV_CURVE_CODE.step) { if (got !== hv[j]) stepbad++; }
            else maxerr = Math.max(maxerr, Math.abs(got - hv[j]) / (Math.abs(row.hi - row.lo) || 1));
        }
        kv("arch", probeArch);
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

    kv("cpuAvg", cpuCount ? cpuSum / cpuCount : 0); kv("cpuMax", cpuMax); kv("cpuCount", cpuCount);
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(out);
    report.close();
    post("DEVIATE_SHUTDOWN\n");
    outlet(0, "bang");
}
