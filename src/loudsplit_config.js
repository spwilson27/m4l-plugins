// loudsplit_config.js — Loud Split: constants, parameter table, formatting helpers and the plain-JS reference of the
// mask maths in src/loudsplit_core.genexpr (the core mirrors ls_masks() line for line).
// Node-requirable (nodeModule pattern, AGENTS.md 1c) and also prepended to the v8ui script by the build.
//
// Three channels (chain order): 1 Quiet (green), 2 Mid (yellow), 3 Loud (red). Per bin the (tilted) Mid level is classified
// against the Higher and Lower Threshold, each with a Knee (crossfade width in dB); the three masks sum to exactly 1 for
// every setting (Tilt only weights the ANALYSIS level, it never changes the output gain).

var LS_NCOLS = 128;          // display columns (log frequency)
var LS_FMIN = 30.0;
var LS_FMAX = 20000.0;
var LS_LATENCY = 4096;
var LS_CH_NAMES = ["Quiet", "Mid", "Loud"];
var LS_SIZES = [1024, 2048, 4096];
var LS_SIZE_ENUM = ["1k", "2k", "4k"];
var LS_OUT_ENUM = ["Auto", "Quiet", "Mid", "Loud", "All"];
var LS_DB_MIN = -110.0;      // display / threshold floor (Bitwig: thresholds -110..0 dB)
var LS_DB_MAX = 0.0;
var LS_LEVEL_FLOOR = -150.0; // classification level floor (dB)
var LS_AMP_FLOOR = 1e-6;     // -120 dB: amplitude floor before the log
var LS_TILT_REF_HZ = 1000.0;
var LS_MAX_KNEE = 24.0;
var LS_MIN_KNEE = 1.0;
var LS_BLOCKS_MIN = 0.13;    // Rise / Fall Time range in blocks (hops of N / 4 samples)
var LS_BLOCKS_MAX = 125.0;

// Telemetry buffer layout (---loudsplitscope, LS_SCOPE_SAMPS floats)
var LS_SC_PRE = 0;                     // 128 input (Mid) levels, 0..1 over -100..0 dB
var LS_SC_QUIET = LS_NCOLS;            // 128 Quiet channel (mask applied), same scale
var LS_SC_MID = LS_NCOLS * 2;          // 128 Mid channel
var LS_SC_LOUD = LS_NCOLS * 3;         // 128 Loud channel
var LS_SC_FRAME = LS_NCOLS * 4;        // frame counter (telemetry frames)
var LS_SC_SR = LS_SC_FRAME + 1;
var LS_SC_N = LS_SC_FRAME + 2;
var LS_SC_AWAKE = LS_SC_FRAME + 3;
var LS_SC_LEVEL = LS_SC_FRAME + 4;     // input peak (decaying)
var LS_SC_LOUDMEAN = LS_SC_FRAME + 5;  // amplitude-weighted mean Loud mask
var LS_SC_LATENCY = LS_SC_FRAME + 6;
var LS_SC_SEL = LS_SC_FRAME + 7;       // output selection the gen is running (0 sum, 1 Quiet, 2 Mid, 3 Loud)
var LS_SC_THI = LS_SC_FRAME + 8;       // effective Higher Threshold, dB at 1 kHz (relative mode: frame max + relative value)
var LS_SC_TLO = LS_SC_FRAME + 9;       // effective Lower Threshold (clamped to <= Higher)
var LS_SC_LMAX = LS_SC_FRAME + 10;     // loudest (tilted) bin level of the frame, dB
var LS_SCOPE_SAMPS = LS_SC_FRAME + 16;

// key: [long name, short name, min, max, initial, ptype (0 float, 1 int), unitstyle, unit text]
var LS_PARAMS = {
    hithr: ["Higher Threshold", "Higher", -110.0, 0.0, -30.0, 0, 4],
    lothr: ["Lower Threshold", "Lower", -110.0, 0.0, -85.0, 0, 4],
    rhithr: ["Relative Higher Threshold", "Rel Higher", -110.0, 0.0, -12.0, 0, 4],
    rlothr: ["Relative Lower Threshold", "Rel Lower", -110.0, 0.0, -36.0, 0, 4],
    hiknee: ["Higher Knee", "Hi Knee", LS_MIN_KNEE, LS_MAX_KNEE, 6.0, 0, 9, "%.1f dB"],
    loknee: ["Lower Knee", "Lo Knee", LS_MIN_KNEE, LS_MAX_KNEE, 6.0, 0, 9, "%.1f dB"],
    rise: ["Rise Time", "Rise", LS_BLOCKS_MIN, LS_BLOCKS_MAX, 2.0, 0, 9, "%.2f"],
    fall: ["Fall Time", "Fall", LS_BLOCKS_MIN, LS_BLOCKS_MAX, 8.0, 0, 9, "%.2f"],
    tilt: ["Tilt", "Tilt", -6.0, 6.0, 0.0, 0, 9, "%.1f dB/oct"],
    mix: ["Mix", "Mix", 0.0, 100.0, 100.0, 0, 9, "%.0f %"]
};
// enumerated: key: [long name, short name, values, initial]
var LS_ENUMS = {
    relative: ["Relative Loudness Mode", "Relative", ["Absolute", "Relative"], 0],
    size: ["Size", "Size", LS_SIZE_ENUM, 1],
    output: ["Output", "Output", LS_OUT_ENUM, 0]
};
// keys shared between all instances in a rack (everything except Output and the display toggles)
var LS_LINKED_KEYS = ["hithr", "lothr", "rhithr", "rlothr", "hiknee", "loknee", "relative", "rise", "fall", "tilt", "mix", "size"];

function lsClip(x, lo, hi) {
    return x < lo ? lo : (x > hi ? hi : x);
}

// Output of one instance: Mix crossfades this chain's channel (wet) with its share of the dry input (dry / K, K = chains in the
// rack), so the rack sum is mix * wet_sum + (1 - mix) * dry.
function lsMixOut(wetOwn, dry, mix, k) {
    return mix * wetOwn + (1 - mix) * dry / k;
}

// Rise / Fall one-pole coefficient per hop from a time in blocks (fractional down to 0.13)
function lsBlockCoef(blocks) {
    return 1 - Math.exp(-1 / lsClip(blocks, LS_BLOCKS_MIN, LS_BLOCKS_MAX));
}

function lsSmooth01(x) {
    var c = lsClip(x, 0, 1);
    return c * c * (3 - 2 * c);
}

// Output selector for the gen from the Output menu and the resolved Auto channel (0-based, -1 = no rack).
// Returns 0 = all channels summed, 1 = Quiet, 2 = Mid, 3 = Loud.
function lsResolveSel(outputIdx, autoChannel) {
    var o = Math.round(outputIdx);
    if (o >= 1 && o <= 3) return o;
    if (o === 4) return 0;
    if (autoChannel < 0) return 0;
    return lsClip(autoChannel, 0, 2) + 1;
}

// Resolved channel name for the face pill or "All".
function lsSelName(sel) {
    return sel >= 1 && sel <= 3 ? LS_CH_NAMES[sel - 1] : "All";
}

// Tilt weighting of a bin in dB: tilt dB/oct about 1 kHz (analysis only).
function lsTiltDb(k, n, sr, tilt) {
    var f = Math.max(k * sr / n, 20);
    return tilt * Math.log(f * 0.001) * 1.4426950408889634;
}

// Bin of a display column edge (c = 0..ncols), log spaced.
function lsColBin(c, ncols, n, sr, fmin, fmax) {
    return fmin * Math.pow(fmax / fmin, c / ncols) * n / sr;
}

function lsNewState(n) {
    var half = n / 2;
    return {
        n: n,
        lv: new Float64Array(half + 1),     // instantaneous tilted level (dB)
        ls: new Float64Array(half + 1),     // smoothed classification level (dB)
        lmax: 0,
        age: 0                              // 0: the smoothing state is (re)started from the instantaneous level
    };
}

// Three band masks from a smoothed level, thresholds and knees (all dB). Sum is exactly 1 (up to rounding).
// out = [quiet, mid, loud].
function lsBandMasks(level, thi, tlo, khi, klo, out) {
    var lo = Math.min(tlo, thi);
    var sH, sL;
    if (khi > 0.01) sH = lsSmooth01((level - (thi - khi * 0.5)) / khi);
    else sH = level >= thi ? 1 : 0;
    if (klo > 0.01) sL = lsSmooth01((level - (lo - klo * 0.5)) / klo);
    else sL = level >= lo ? 1 : 0;
    sH = Math.min(sH, sL);
    out[0] = 1 - sL;
    out[1] = sL - sH;
    out[2] = sH;
}

// One analysis frame. mag: Mid amplitude per bin (0..n/2). p = {relative, hithr, lothr, rhithr, rlothr, hiknee, loknee, rise,
// fall, tilt}. Fills outQ / outM / outL (length n/2 + 1) with the per-bin masks (the gen applies mask[k] to bins k and n-k).
// st.age is advanced here (the gen core does the same with its History `age`). Mirrors ls_masks() in src/loudsplit_core.genexpr.
function lsMasks(st, mag, p, sr, outQ, outM, outL) {
    var n = st.n;
    var half = n / 2;
    var age = st.age;
    var k;
    var tlt = lsClip(p.tilt, -6, 6);
    var lmax = -200;
    for (k = 0; k <= half; k++) {
        var lv = 20 * Math.log10(Math.max(mag[k], LS_AMP_FLOOR)) + lsTiltDb(k, n, sr, tlt);
        st.lv[k] = lv;
        if (k >= 1 && k < half && lv > lmax) lmax = lv;
    }
    st.lmax = lmax;
    var rel = p.relative > 0.5;
    var thi = rel ? p.rhithr : p.hithr;
    var tlo = rel ? p.rlothr : p.lothr;
    var khi = lsClip(p.hiknee, LS_MIN_KNEE, LS_MAX_KNEE);
    var klo = lsClip(p.loknee, LS_MIN_KNEE, LS_MAX_KNEE);
    var rk = lsBlockCoef(p.rise);
    var fk = lsBlockCoef(p.fall);
    var q = [0, 0, 0];
    for (k = 0; k <= half; k++) {
        var lev = rel ? st.lv[k] - lmax : st.lv[k];
        lev = Math.max(lev, LS_LEVEL_FLOOR);
        var prev = age < 0.5 ? lev : st.ls[k];
        var ls = prev + (lev - prev) * (lev > prev ? rk : fk);
        st.ls[k] = ls;
        lsBandMasks(ls, thi, tlo, khi, klo, q);
        outQ[k] = q[0];
        outM[k] = q[1];
        outL[k] = q[2];
    }
    st.age = Math.min(age + 1, 3);
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        LS_NCOLS: LS_NCOLS, LS_FMIN: LS_FMIN, LS_FMAX: LS_FMAX, LS_LATENCY: LS_LATENCY, LS_CH_NAMES: LS_CH_NAMES,
        LS_SIZES: LS_SIZES, LS_PARAMS: LS_PARAMS, LS_ENUMS: LS_ENUMS, LS_LINKED_KEYS: LS_LINKED_KEYS,
        LS_DB_MIN: LS_DB_MIN, LS_DB_MAX: LS_DB_MAX, LS_MAX_KNEE: LS_MAX_KNEE, LS_MIN_KNEE: LS_MIN_KNEE,
        LS_BLOCKS_MIN: LS_BLOCKS_MIN, LS_BLOCKS_MAX: LS_BLOCKS_MAX, lsMixOut: lsMixOut, lsBlockCoef: lsBlockCoef,
        LS_SC_PRE: LS_SC_PRE, LS_SC_QUIET: LS_SC_QUIET, LS_SC_MID: LS_SC_MID, LS_SC_LOUD: LS_SC_LOUD,
        LS_SC_FRAME: LS_SC_FRAME, LS_SC_SR: LS_SC_SR, LS_SC_N: LS_SC_N, LS_SC_AWAKE: LS_SC_AWAKE,
        LS_SC_LEVEL: LS_SC_LEVEL, LS_SC_LOUDMEAN: LS_SC_LOUDMEAN, LS_SC_LATENCY: LS_SC_LATENCY, LS_SC_SEL: LS_SC_SEL,
        LS_SC_THI: LS_SC_THI, LS_SC_TLO: LS_SC_TLO, LS_SC_LMAX: LS_SC_LMAX, LS_SCOPE_SAMPS: LS_SCOPE_SAMPS,
        lsClip: lsClip, lsSmooth01: lsSmooth01, lsResolveSel: lsResolveSel, lsSelName: lsSelName, lsTiltDb: lsTiltDb,
        lsColBin: lsColBin, lsNewState: lsNewState, lsBandMasks: lsBandMasks, lsMasks: lsMasks
    };
}
