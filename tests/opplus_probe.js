// Probe for scripts/run_opplus_audio_tests.py (v8 object in the shared Max harness). The runner prepends
// `var OP_PARAMS = ...; var CASE = {...};` and src/opplus_config.js. At load (`init`) it writes the gen's buffers
// exactly like the face does (cfg block, the wavetables a case needs, voice table); events `noteon <k> <v>` /
// `noteoff <k>` play notes through the real allocator; `analyze <ms>` measures the recorded window.
autowatch = 0;
inlets = 1;
outlets = 1;
var resultPath = "";
var alloc = opCreateAllocator();
var names = { cfg: "#0-opcfg", voices: "#0-opvoices", waves: "#0-opwaves", scope: "#0-opscope" };

function resultpath(p) { resultPath = String(p); }
function setnames(c, v, w, s) { names = { cfg: String(c), voices: String(v), waves: String(w), scope: String(s) }; }

function init() {
    var cfg = new Buffer(names.cfg);
    cfg.poke(1, 0, opCfg(CASE.vals || {}, { bpm: 120, playing: 0 }));
    var wb = new Buffer(names.waves);
    var need = { 0: 1, 9: 1 };   // Saw 64: Supersaw / PWM
    for (var f = 0; f < 8; f++) need[OP_WT0 + f] = 1;   // wavetable frames
    var L = ["a", "b", "c", "d"];
    for (var k = 0; k < 4; k++) need[Math.round((CASE.vals || {})["osc_" + L[k] + "_wave"] || 0)] = 1;
    for (var w in need) {
        var wi = Number(w);
        if (wi >= 21 && wi < OP_WT0) continue;
        for (var m = 0; m < OP_NMIP; m++) wb.poke(1, (wi * OP_NMIP + m) * (OP_TBL + 1), opWaveTable(wi, m, 48000, null, 12345 + wi));
    }
    for (k = 0; k < 4; k++) {
        var u = opDefaultUser();
        for (m = 0; m < OP_NMIP; m++) wb.poke(1, ((22 + k) * OP_NMIP + m) * (OP_TBL + 1), opWaveTable(22, m, 48000, u, 1));
    }
}

function writeVoice(i) {
    var b = new Buffer(names.voices), f = alloc.floats(i), base = i * OP_VSTRIDE;
    b.poke(1, base + 1, [f[1], f[2]]);
    b.poke(1, base + 4, [f[4], f[5], f[6], f[7]]);
    b.poke(1, base, f[0]);
    b.poke(1, base + 3, f[3]);
}
function vmax() { return [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 32][Math.round(opV(CASE.vals || {}, "voices"))] || 6; }
function noteon(k, v) {
    var l = alloc.noteOn(Math.round(k), Math.round(v), vmax(), opV(CASE.vals || {}, "glide_on") > 0.5, opV(CASE.vals || {}, "retrigger") > 0.5);
    for (var i = 0; i < l.length; i++) writeVoice(l[i]);
}
function noteoff(k) {
    var l = alloc.noteOff(Math.round(k), vmax());
    for (var i = 0; i < l.length; i++) writeVoice(l[i]);
}

function goertzel(x, a, b, f, sr) {
    var n = b - a, k = 2 * Math.cos(2 * Math.PI * f / sr), s1 = 0, s2 = 0;
    for (var i = 0; i < n; i++) {
        var w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
        var s0 = x[a + i] * w + k * s1 - s2;
        s2 = s1; s1 = s0;
    }
    return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / (n * 0.5);
}
function zcFreq(x, a, b, sr) {
    var z = [];
    for (var i = a; i < b - 1; i++) if (x[i] <= 0 && x[i + 1] > 0) z.push(i + x[i] / (x[i] - x[i + 1]));
    return z.length > 2 ? (z.length - 1) * sr / (z[z.length - 1] - z[0]) : 0;
}

function analyze(ms) {
    var rec = new Buffer("rec");
    var n = rec.framecount(), sr = n / (rec.length() / 1000);
    var L = rec.peek(1, 0, n), R = rec.peek(2, 0, n);
    var out = [];
    var peak = 0, nan = 0, i;
    for (i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
    out.push("frames " + n, "sr " + sr, "peak " + peak, "nan " + nan);
    var a = Math.round((CASE.from_ms || 100) * sr / 1000), b = Math.min(n, a + Math.round((CASE.win_ms || 200) * sr / 1000));
    out.push("f0 " + zcFreq(L, a, b, sr));
    var ss = 0;
    for (i = a; i < b; i++) ss += L[i] * L[i];
    out.push("rms " + Math.sqrt(ss / Math.max(1, b - a)));
    var f0 = CASE.f0 || 220;
    for (var h = 1; h <= 8; h++) out.push("h" + h + " " + goertzel(L, a, b, f0 * h, sr));
    for (i = 0; i < (CASE.extra_f || []).length; i++) out.push("x" + i + " " + goertzel(L, a, b, CASE.extra_f[i], sr));
    var blk = Math.round(sr / 100);
    var env = [];
    for (i = 0; i + blk <= n; i += blk) {
        var p = 0;
        for (var j = i; j < i + blk; j++) p = Math.max(p, Math.abs(L[j]));
        env.push(Math.round(p * 1e6) / 1e6);
    }
    out.push("env " + env.join(","));
    var lr = 0;
    for (i = 0; i < n; i++) lr = Math.max(lr, Math.abs(L[i] - R[i]));
    out.push("lrdiff " + lr);
    var sc = new Buffer(names.scope);
    out.push("alive " + sc.peek(1, 0, 1));
    out.push("voices " + sc.peek(1, 2, 1));
    var fz = [];
    if (CASE.track) {
        var win = Math.round(sr * 0.02);
        for (i = 0; i + win <= n; i += win) fz.push(Math.round(zcFreq(L, i, i + win, sr) * 10) / 10);
        out.push("track " + fz.join(","));
    }
    var fh = new File(resultPath, "write", "TEXT");
    fh.eof = 0;
    fh.writeline(out.join("\n"));
    fh.close();
    outlet(0, "bang");
}
