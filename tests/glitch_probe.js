// Probe for scripts/run_glitch_audio_tests.py (js object inside the scripts/max_harness.py scaffold, ES5).
// Inlet 0 messages: fill (synthesize the stimulus into buffer~ stim), slots <floats> (write the 8 slot vectors),
//   weights <floats> (write the 8 weights), analyze <durMs> (harness). Inlet 1: floats from [adstatus cpu].
// buffer~ rec holds 4 channels: 1 = device out L, 2 = device in L (the stimulus), 3 = device out R, 4 = stimulus phasor.
// jsarguments: stimulus, latency (samples), weights offset in the slots buffer, sequencer block offset, then any number of
//   "sc:NAME=offset" tokens (the GL_SCOPE layout from src/glitch_config.js), "dump:N" (write the output's rms per N-sample block
//   as e0, e1, ...), "xc:name:outStart:inStart:len:rev[:search]" (normalized correlation of out[outStart + i] with in[inStart + i], or
//   in[inStart - i] when rev = 1, reported as x_<name>, the output shift -search..search that correlates best as xd_<name>; window sample indices) and plain numbers = lags (samples) for the correlations.
// Inlet 0 also takes: seq <24 floats> (write the sequencer block at the sequencer offset), meta <floats> (the constants block at the
//   offset given by the "meta:N" token).

inlets = 2;
outlets = 1;

var stimMode = jsarguments.length > 1 ? jsarguments[1] : "mix";
var LAG = jsarguments.length > 2 ? Number(jsarguments[2]) : 1023;
var WOFF = jsarguments.length > 3 ? Number(jsarguments[3]) : 432;
var SQOFF = jsarguments.length > 4 ? Number(jsarguments[4]) : 912;
var LAGS = [];
var SC = {};
var DUMP = 0;
var DIPS = 0; // "dips:N": block rms with N-sample blocks; report the centres of the dips (>= 2 blocks below 0.5 x the median or one below 0.3 x) as dip0, dip1, ...
var XC = [];
var METAOFF = 936;
for (var ja = 5; ja < jsarguments.length; ja++) {
    var tok = String(jsarguments[ja]);
    if (tok.indexOf("sc:") === 0) { var eq = tok.indexOf("="); SC[tok.substring(3, eq)] = Number(tok.substring(eq + 1)); }
    else if (tok.indexOf("dump:") === 0) DUMP = Number(tok.substring(5));
    else if (tok.indexOf("dips:") === 0) DIPS = Number(tok.substring(5));
    else if (tok.indexOf("meta:") === 0) METAOFF = Number(tok.substring(5));
    else if (tok.indexOf("xc:") === 0) XC.push(tok.substring(3).split(":"));
    else LAGS.push(Number(tok));
}
var reportPath = "/tmp/glitch_audio.txt";
function resultpath(p) { reportPath = String(p); }
var PERIOD = 3.0;
var armed = false;
var cpuMax = 0, cpuSum = 0, cpuCount = 0;

function lcg(seed) {
    var s = seed % 4294967296;
    return function () {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };
}
function resonator(x, freq, bw, sr) {
    var r = Math.exp(-Math.PI * bw / sr), th = 2 * Math.PI * freq / sr;
    var a1 = -2 * r * Math.cos(th), a2 = r * r, g = 1 - r;
    var y = new Array(x.length), y1 = 0, y2 = 0;
    for (var i = 0; i < x.length; i++) {
        var v = g * x[i] - a1 * y1 - a2 * y2;
        y[i] = v; y2 = y1; y1 = v;
    }
    return y;
}
function vowel(n, sr, f1, f2, f3) {
    var x = new Array(n), i;
    for (i = 0; i < n; i++) x[i] = 0;
    var period = sr / 110;
    for (var p = 0; p < n - 2; p += period) {
        var ip = Math.floor(p), fr = p - ip;
        x[ip] += 1 - fr; x[ip + 1] += fr;
    }
    var a = resonator(x, f1, 90, sr), b = resonator(x, f2, 110, sr), c = resonator(x, f3, 160, sr);
    var out = new Array(n), pk = 1e-9;
    for (i = 0; i < n; i++) { out[i] = a[i] + 0.7 * b[i] + 0.4 * c[i]; if (Math.abs(out[i]) > pk) pk = Math.abs(out[i]); }
    for (i = 0; i < n; i++) out[i] = 0.4 * out[i] / pk;
    return out;
}

function fill() {
    var buf = new Buffer("stim");
    var n = buf.framecount();
    var sr = n / PERIOD;
    var x = new Array(n), i;
    for (i = 0; i < n; i++) x[i] = 0;
    var rnd = lcg(4242);
    if (stimMode === "sine") for (i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr);
    else if (stimMode === "sine1k") for (i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr);
    else if (stimMode === "mix") for (i = 0; i < n; i++) x[i] = 0.2 * (rnd() * 2 - 1) + 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
    else if (stimMode === "noise") for (i = 0; i < n; i++) x[i] = 0.4 * (rnd() * 2 - 1);
    else if (stimMode === "levels") for (i = 0; i < n; i++) x[i] = ((Math.floor(i / sr * 4 / PERIOD) % 2) ? 0.5 : 0.05) * (rnd() * 2 - 1); // noise, loud / quiet every 0.75 s
    else if (stimMode === "burst") for (i = 0; i < Math.floor(0.15 * sr); i++) x[i] = 0.5 * (rnd() * 2 - 1);
    else if (stimMode === "sweep2") for (i = 0; i < n; i++) x[i] = 0.4 * Math.sin(2 * Math.PI * (i < n / 2 ? 440 : 1320) * i / sr);
    else if (stimMode === "ramp") for (i = 0; i < n; i++) x[i] = -0.6 + 1.2 * i / n; // one slow linear ramp per stimulus period (phase 4: Scratch direction / continuity)
    else if (stimMode === "clicks") for (i = 0; i < n; i += Math.floor(0.25 * sr)) x[i] = 0.8;
    else if (stimMode === "vowel") x = vowel(n, sr, 700, 1220, 2600);
    // silent: zeros
    buf.poke(1, 0, x);
    post("GLITCH_STIM_POKED " + stimMode + " frames " + n + "\n");
}

// gen re-reads the slot vectors and the constants only when the version at SEQ+5 changes: every write below bumps it
var packVer = 0;
function bump() {
    packVer += 1;
    new Buffer("glitchslots").poke(1, SQOFF + 5, [packVer]);
}
function slots() {
    var a = arrayfromargs(arguments);
    var buf = new Buffer("glitchslots");
    buf.poke(1, 0, a);
    bump();
}
function weights() {
    var a = arrayfromargs(arguments);
    var buf = new Buffer("glitchslots");
    buf.poke(1, WOFF, a);
}
function meta() {
    // the layout constants block of the engine buffer (param kinds / groups, defaults, wet indices): gen no longer has an init block
    var a = arrayfromargs(arguments);
    var buf = new Buffer("glitchslots");
    buf.poke(1, METAOFF, a);
    bump();
}
function seq() {
    var a = arrayfromargs(arguments);
    var buf = new Buffer("glitchslots");
    buf.poke(1, SQOFF, a);
    bump();
}
function msg_float(v) {
    if (inlet === 1) { cpuMax = Math.max(cpuMax, v); cpuSum += v; cpuCount++; }
}

function readChannel(buf, channel, n) {
    var out = [], i, k;
    for (i = 0; i < n; i += 2048) {
        var count = Math.min(2048, n - i);
        var chunk = buf.peek(channel, i, count);
        if (!chunk) { for (k = 0; k < count; k++) out.push(0); continue; }
        if (typeof chunk === "number") { out.push(chunk); continue; }
        for (k = 0; k < count; k++) out.push(chunk[k]);
    }
    return out;
}
function fft(re, im) {
    var n = re.length, i, j, k, m;
    for (i = 1, j = 0; i < n; i++) {
        var bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { var tr = re[i]; re[i] = re[j]; re[j] = tr; var ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (m = 2; m <= n; m <<= 1) {
        var ang = -2 * Math.PI / m, wr = Math.cos(ang), wi = Math.sin(ang);
        for (i = 0; i < n; i += m) {
            var cr = 1, ci = 0;
            for (k = 0; k < m / 2; k++) {
                var ur = re[i + k], ui = im[i + k], xr = re[i + k + m / 2], xi = im[i + k + m / 2];
                var vr = xr * cr - xi * ci, vi = xr * ci + xi * cr;
                re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + m / 2] = ur - vr; im[i + k + m / 2] = ui - vi;
                var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
            }
        }
    }
}
var SEG = 8192;
function specAvg(x, i0, i1) {
    var acc = new Array(SEG / 2), i;
    for (i = 0; i < SEG / 2; i++) acc[i] = 0;
    var count = 0;
    for (var s = i0; s === i0 || s + SEG <= i1; s += SEG / 2) {
        var re = new Array(SEG), im = new Array(SEG);
        for (i = 0; i < SEG; i++) { var w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / SEG); re[i] = (x[s + i] || 0) * w; im[i] = 0; }
        fft(re, im);
        for (i = 0; i < SEG / 2; i++) acc[i] += re[i] * re[i] + im[i] * im[i];
        count++;
    }
    for (i = 0; i < SEG / 2; i++) acc[i] /= count;
    return acc;
}
function bandE(p, sr, lo, hi) {
    var k0 = Math.max(1, Math.floor(lo * SEG / sr)), k1 = Math.min(p.length - 1, Math.floor(hi * SEG / sr)), s = 1e-30;
    for (var k = k0; k <= k1; k++) s += p[k];
    return s;
}
function db(v) { return 10 * Math.log(Math.max(v, 1e-30)) / Math.LN10; }
function corrAt(a, b, from, len, lagA, lagB) {
    // normalized correlation of a[from + t + lagA] with b[from + t + lagB]
    var d = 0, ea = 1e-30, eb = 1e-30;
    for (var t = 0; t < len; t++) {
        var x = a[from + t + lagA] || 0, y = b[from + t + lagB] || 0;
        d += x * y; ea += x * x; eb += y * y;
    }
    return d / Math.sqrt(ea * eb);
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    try { analyzeImpl(durMs); } catch (err) {
        var ef = new File(reportPath, "write", "TEXT");
        ef.writestring("error 1\n");
        ef.close();
        post("GLITCH_ERR " + err + " line " + err.lineNumber + "\n");
        outlet(0, "bang");
    }
}

function analyzeImpl(durMs) {
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var sr = frames / (rec.length() / 1000);
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var outL = readChannel(rec, 1, n), inL = readChannel(rec, 2, n), outR = readChannel(rec, 3, n), ph = readChannel(rec, 4, n);
    var R = {}, i;
    R.sr = sr;
    R.frames = n;
    var nan = 0, peak = 0, nz = 0;
    for (i = 0; i < n; i++) {
        var v = outL[i], w = outR[i];
        if (v !== v || Math.abs(v) === Infinity || w !== w || Math.abs(w) === Infinity) { nan++; continue; }
        peak = Math.max(peak, Math.abs(v));
        if (v !== 0) nz++;
    }
    R.nan = nan; R.peak = peak; R.nonzero = nz;
    var p0 = ph[200], t0 = p0 * PERIOD - 200 / sr;
    function idxOf(tau) { var ix = Math.round((tau - t0) * sr); if (ix < 0) ix += Math.round(PERIOD * sr); return ix; }
    function rms(x, a, b) { var s = 0; a = Math.max(0, a); b = Math.min(x.length, b); for (var k = a; k < b; k++) s += x[k] * x[k]; return Math.sqrt(s / Math.max(1, b - a)); }

    var skip = Math.min(Math.floor(sr * 0.3), Math.floor(n / 4));
    var len = Math.min(24000, n - skip - LAG - 8);
    // identity at the fixed latency
    var e2 = 0, d2 = 0, o2 = 0, maxErr = 0;
    for (var t = 0; t < len; t++) {
        var o = outL[skip + t + LAG], x = inL[skip + t], er = o - x;
        e2 += er * er; d2 += x * x; o2 += o * o; maxErr = Math.max(maxErr, Math.abs(er));
    }
    R.errdb = d2 > 0 ? db(e2 / d2) : 0;
    R.gaindb = d2 > 0 && o2 > 0 ? db(o2 / d2) : -200;
    R.maxerr = maxErr;
    R.inrms = Math.sqrt(d2 / Math.max(1, len));
    R.outrms = Math.sqrt(o2 / Math.max(1, len));
    // best lag around LAG (identity cases)
    var bestC = -2, bestLag = 0;
    for (var lg = LAG - 40; lg <= LAG + 40; lg++) {
        var c = corrAt(outL, inL, skip, Math.min(len, 8192), lg, 0);
        if (c > bestC) { bestC = c; bestLag = lg; }
    }
    R.lag = bestLag; R.corr = bestC;
    // click metrics: largest second difference of the output vs the input
    var d2o = 0, d2i = 0;
    for (i = Math.floor(sr * 0.6); i < n - 2; i++) {
        d2o = Math.max(d2o, Math.abs(outL[i + 2] - 2 * outL[i + 1] + outL[i]));
        d2i = Math.max(d2i, Math.abs(inL[i + 2] - 2 * inL[i + 1] + inL[i]));
    }
    R.maxd2 = d2o; R.maxd2in = d2i;
    var ms = 0;
    for (i = Math.floor(sr * 0.6); i < n - 1; i++) ms = Math.max(ms, Math.abs(outL[i + 1] - outL[i]));
    R.maxstep = ms;
    // correlations with the input at extra lags (echoes), and of the output with itself (stutter)
    for (var q = 0; q < LAGS.length; q++) {
        R["xc" + q] = corrAt(outL, inL, Math.floor(sr * 0.5), Math.min(24000, n - Math.floor(sr * 0.5) - LAG - LAGS[q] - 8), LAG + LAGS[q], 0);
        var from = n - 24000 - LAGS[q] - 100;
        R["ac" + q] = corrAt(outL, outL, from, 24000, LAGS[q], 0);
    }
    // spectra over the second half of the take
    var a0 = Math.floor(n * 0.5), a1 = n - 100;
    var pin = specAvg(inL, a0 - LAG, a1 - LAG), pout = specAvg(outL, a0, a1);
    var bands = [[60, 300], [300, 1000], [1000, 3000], [3000, 8000], [8000, 20000]];
    for (var b = 0; b < bands.length; b++) {
        R["bin" + b] = db(bandE(pin, sr, bands[b][0], bands[b][1]));
        R["bout" + b] = db(bandE(pout, sr, bands[b][0], bands[b][1]));
    }
    // dominant frequency and the energy outside +-40 Hz of it
    var bk = 1, bv = 0;
    for (i = 4; i < SEG / 2; i++) if (pout[i] > bv) { bv = pout[i]; bk = i; }
    R.peakhz = bk * sr / SEG;
    var tot = 1e-30, near = 0;
    for (i = 1; i < SEG / 2; i++) { tot += pout[i]; if (Math.abs(i * sr / SEG - R.peakhz) < 40) near += pout[i]; }
    R.nonfunddb = db((tot - near) / tot);
    var binpk = 1, binv = 0;
    for (i = 4; i < SEG / 2; i++) if (pin[i] > binv) { binv = pin[i]; binpk = i; }
    R.inpeakhz = binpk * sr / SEG;
    // spectral energy at selected frequencies (Hz given by the runner through jsarguments are not needed: fixed probes)
    var probes = [440, 700, 1000, 1300, 1320];
    for (var pi2 = 0; pi2 < probes.length; pi2++) {
        var kk = Math.round(probes[pi2] * SEG / sr);
        R["pk" + probes[pi2]] = db(pout[kk - 1] + pout[kk] + pout[kk + 1]);
        R["pi" + probes[pi2]] = db(pin[kk - 1] + pin[kk] + pin[kk + 1]);
    }
    // phase 4: slow-ramp stimulus: direction and continuity of the output (the wrap of the stimulus and its echo are excluded)
    if (stimMode === "ramp") {
        var iw = -1;
        for (i = Math.floor(sr * 0.3); i < n - 1; i++) if (inL[i + 1] - inL[i] < -0.5) { iw = i; break; }
        var rneg = 0, rpos = 0, rmax = 0;
        for (i = Math.floor(sr * 0.5); i < n - 1; i++) {
            if (iw >= 0 && i >= iw - 8 && i < iw + 40000) continue;
            var dd = outL[i + 1] - outL[i];
            if (dd < -1e-9) rneg++; else if (dd > 1e-9) rpos++;
            if (Math.abs(dd) > rmax) rmax = Math.abs(dd);
        }
        R.rampNeg = rneg; R.rampPos = rpos; R.rampMaxStep = rmax; R.rampWrap = iw;
        R.rampSlope = 1.2 / n;
    }
    // phase 4: how sparse the output spectrum is (fraction of bins 3..400 of 1024-point frames below 3 % of the frame's rms bin), and the
    // strength of a comb at multiples of sr / 256 (the hop rate: Robot's buzz) against the mid points, 300..5000 Hz
    var spf = function (x, i0, i1) {
        var cnt = 0, tot = 0, s0;
        for (s0 = i0; s0 + 1024 <= i1; s0 += 3072) {
            var fr = new Array(1024), fi = new Array(1024), q;
            for (q = 0; q < 1024; q++) { fr[q] = (x[s0 + q] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * q / 1024)); fi[q] = 0; }
            fft(fr, fi);
            var mm = [], ms = 0;
            for (q = 3; q < 400; q++) { var mg = Math.sqrt(fr[q] * fr[q] + fi[q] * fi[q]); mm.push(mg); ms += mg * mg; }
            var rm = Math.sqrt(ms / mm.length) + 1e-12;
            for (q = 0; q < mm.length; q++) { tot++; if (mm[q] < 0.03 * rm) cnt++; }
        }
        return cnt / Math.max(tot, 1);
    };
    R.sparse = spf(outL, Math.floor(n * 0.4), n - 100);
    R.sparsein = spf(inL, Math.floor(n * 0.4) - LAG, n - 100 - LAG);
    var combE = 0, midE = 0, hopHz = sr / 256, kc;
    for (kc = 2; kc * hopHz < 5000; kc++) {
        var kb = Math.round(kc * hopHz * SEG / sr), km = Math.round((kc + 0.5) * hopHz * SEG / sr);
        combE += pout[kb - 1] + pout[kb] + pout[kb + 1];
        midE += pout[km - 1] + pout[km] + pout[km + 1];
    }
    R.combratio = combE / Math.max(midE, 1e-30);
    var combEi = 0, midEi = 0;
    for (kc = 2; kc * hopHz < 5000; kc++) {
        var kbi = Math.round(kc * hopHz * SEG / sr), kmi = Math.round((kc + 0.5) * hopHz * SEG / sr);
        combEi += pin[kbi - 1] + pin[kbi] + pin[kbi + 1];
        midEi += pin[kmi - 1] + pin[kmi] + pin[kmi + 1];
    }
    R.combratioin = combEi / Math.max(midEi, 1e-30);
    // block rms (256 samples) of the output: gating depth
    var mn = 1e9, mx = 0;
    for (i = Math.floor(sr * 0.8); i + 256 < n; i += 256) { var br = rms(outL, i, i + 256); mn = Math.min(mn, br); mx = Math.max(mx, br); }
    R.blockmin = mn; R.blockmax = mx;
    var nbA = 0, nbAi = 0, nbT = 0;
    for (i = Math.floor(sr * 0.8); i + 256 < n; i += 256) { nbT++; if (rms(outL, i, i + 256) > 0.0001) nbA++; if (rms(inL, i, i + 256) > 0.0001) nbAi++; }
    R.activefrac = nbA / Math.max(nbT, 1); R.activefracin = nbAi / Math.max(nbT, 1);
    // crest factor
    R.crest = peak / Math.max(rms(outL, skip, n), 1e-30);
    R.crestin = (function () { var pk = 0; for (var k = skip; k < n; k++) pk = Math.max(pk, Math.abs(inL[k])); return pk / Math.max(rms(inL, skip, n), 1e-30); })();
    // stimulus-time windows of the output (tails): rms between two stimulus times, lag corrected
    var wins = [[0.5, 1.0], [1.0, 2.0], [2.0, 2.9]];
    for (var wi = 0; wi < wins.length; wi++) {
        var i0 = idxOf(wins[wi][0]), i1 = idxOf(wins[wi][1]);
        R["win" + wi] = (i0 + LAG < n && i1 > i0) ? rms(outL, i0 + LAG, Math.min(n, i1 + LAG)) : -1;
        R["winin" + wi] = (i0 < n && i1 > i0) ? rms(inL, i0, Math.min(n, i1)) : -1;
    }
    // first half vs second half level of the take (sweeps, freezes)
    R.rmsA = rms(outL, Math.floor(n * 0.2), Math.floor(n * 0.45));
    R.rmsB = rms(outL, Math.floor(n * 0.7), n - 100);
    // stereo
    var l2 = 0, r2 = 0, lr = 0;
    for (i = skip; i < skip + len; i++) { l2 += outL[i + LAG] * outL[i + LAG]; r2 += outR[i + LAG] * outR[i + LAG]; lr += outL[i + LAG] * outR[i + LAG]; }
    R.lrcorr = lr / Math.sqrt(Math.max(l2 * r2, 1e-30));

    // telemetry
    var tb = new Buffer("glitchscope");
    var ch = tb.peek(1, 0, (SC.END || 470) + (SC.DBGN || 0));
    if (ch && ch.length) {
        R.scFrame = ch[SC.FRAME]; R.scSr = ch[SC.SR]; R.scInPeak = ch[SC.IN_PEAK]; R.scOutPeak = ch[SC.OUT_PEAK]; R.scSpecRun = ch[SC.SPEC_RUN]; R.scSpecMix = ch[SC.SPEC_MIX];
        R.scBeat = ch[SC.BEAT]; R.scBpm = ch[SC.BPM]; R.scStut = ch[SC.STUT_ENGAGED]; R.scChopPat = ch[SC.CHOP_PATTERN];
        var act = 0, lvl = 0, bi = 0, bo = 0, cp = 0, wv = 0;
        var nInst = SC.LEVEL - SC.ACTIVITY;
        for (i = 0; i < nInst; i++) { act += ch[SC.ACTIVITY + i]; lvl += ch[SC.LEVEL + i]; R["scAct" + i] = ch[SC.ACTIVITY + i]; R["scLvl" + i] = ch[SC.LEVEL + i]; }
        for (i = 0; i < 64; i++) { bi += ch[SC.BANDS_IN + i]; bo += ch[SC.BANDS_OUT + i]; cp += Math.abs(ch[SC.CEP_IN + i]) + Math.abs(ch[SC.CEP_OUT + i]); wv += Math.abs(ch[SC.WAVE_IN + i]) + Math.abs(ch[SC.WAVE_OUT + i]); }
        R.scActSum = act; R.scLvlSum = lvl; R.scBandsIn = bi; R.scBandsOut = bo; R.scCep = cp; R.scWave = wv; R.scSpecFrames = ch[SC.SPEC_FRAMES];
        for (i = 0; i < 8; i++) R["scW" + i] = ch[SC.WEIGHTS + i];
        R.scSeqOn = ch[SC.SEQ_ON]; R.scSeqPlay = ch[SC.SEQ_PLAY]; R.scSeqStep = ch[SC.SEQ_STEP]; R.scSeqSlot = ch[SC.SEQ_SLOT]; R.scSeqPrev = ch[SC.SEQ_PREV];
        for (i = SC.END; i < ch.length; i++) R['scx' + i] = ch[i]; // debug slots beyond END (the runner asks for a larger END)
        if (SC.MOVE_ON !== undefined) for (i = 0; i < nInst; i++) { R["scMvOn" + i] = ch[SC.MOVE_ON + i]; R["scMvOfs" + i] = ch[SC.MOVE_OFS + i]; R["scMvPos" + i] = ch[SC.MOVE_POS + i]; R["scMvPh" + i] = ch[SC.MOVE_PH + i]; }
        R.scSeqGlide = ch[SC.SEQ_GLIDE]; R.scSeqFrac = ch[SC.SEQ_FRAC]; R.scSeqCount = ch[SC.SEQ_COUNT];
    }
    for (var xi = 0; xi < XC.length; xi++) {
        var xo = Number(XC[xi][1]), xs = Number(XC[xi][2]), xn = Number(XC[xi][3]), xr = Number(XC[xi][4]) > 0.5;
        var xsearch = XC[xi].length > 5 ? Number(XC[xi][5]) : 0; // also try output shifts -S..S and keep the best correlation
        var bestX = -2, bestD = 0;
        for (var xdd = -xsearch; xdd <= xsearch; xdd++) {
            var xd = 0, xa = 1e-30, xb = 1e-30;
            for (i = 0; i < xn; i++) {
                var xv = outL[xo + xdd + i], xw = inL[xr ? xs - i : xs + i];
                if (xv === undefined || xw === undefined) continue;
                xd += xv * xw; xa += xv * xv; xb += xw * xw;
            }
            var xcv = xd / Math.sqrt(xa * xb);
            if (xcv > bestX) { bestX = xcv; bestD = xdd; }
        }
        R["x_" + XC[xi][0]] = bestX;
        R["xd_" + XC[xi][0]] = bestD;
    }
    if (DUMP > 0) {
        // rms of the output per block (sequencer / gating timing is read from this by the runner)
        for (i = 0; i * DUMP < n; i++) R["e" + i] = rms(outL, i * DUMP, (i + 1) * DUMP);
    }
    if (DIPS > 0) {
        var eb = [], bi2;
        for (bi2 = 0; bi2 * DIPS < n; bi2++) eb.push(rms(outL, bi2 * DIPS, (bi2 + 1) * DIPS));
        var sorted = eb.slice().sort(function (a, b) { return a - b; });
        var med = sorted[Math.floor(sorted.length / 2)];
        var run0 = -1, nd = 0, runMin = 9;
        for (bi2 = 0; bi2 <= eb.length; bi2++) {
            var low = bi2 < eb.length && eb[bi2] < 0.5 * med;
            if (low) { if (run0 < 0) { run0 = bi2; runMin = 9; } runMin = Math.min(runMin, eb[bi2] / med); }
            if (!low && run0 >= 0) {
                // a dip: two or more neighbouring blocks below 0.5 x the median, or one block below 0.3 x (white noise alone rarely does either)
                if (bi2 - run0 >= 2 || runMin < 0.3) { if (nd < 80) R["dip" + nd] = (run0 + bi2) * DIPS / 2; nd++; }
                run0 = -1;
            }
        }
        R.dipn = Math.min(nd, 80); R.dipmed = med;
    }
    R.cpuMax = cpuMax;
    R.cpuAvg = cpuCount ? cpuSum / cpuCount : 0;

    var report = new File(reportPath, "write", "TEXT");
    var text = "";
    for (var key in R) text += key + " " + R[key] + "\n";
    report.writestring(text);
    report.close();
    post("GLITCH_DONE lag " + R.lag + " errdb " + R.errdb + " nan " + nan + "\n");
    outlet(0, "bang");
}
