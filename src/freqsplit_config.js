// freqsplit_config.js — Freq Split (Bitwig Freq Split (Spectral) style): constants, parameter table and the plain-JS reference of
// the split-pattern and mask maths in src/freqsplit_core.genexpr (the core mirrors fs_pattern() / fs_masks() / fs_limit()).
// Node-requirable (nodeModule pattern, AGENTS.md 1c) and also prepended to the v8ui script by the build.
//
// MODEL. A spectral SORTER: the log-frequency axis 20 Hz .. 20 kHz (x = 0..1, f = 20 Hz * 1000^x; bins below 20 Hz / above
// 20 kHz are clamped to the edges) is cut by `splits` (1..1024, continuous) splits into many narrow regions that are dealt
// to four channels in rotation (1 red, 2 blue, 3 yellow, 4 magenta). Every bin gets one mask per channel; the four masks sum
// to 1 (partition of unity), so the chains of an Audio Effect Rack sum back to the input. Only the Spectral Limiter, an explicit
// gain, breaks the identity. Masks are evaluated at the BIN CENTRES: regions narrower than a bin alias (modulation joy).
//
// PATTERN (the same for every bin, evaluated in "pattern space" p = 0..1 and then bent onto the axis):
//   splits n = K + f (K = floor(n), f = fraction). The pattern has F = K + 1 full regions of weight 1 and one PARTIAL region of
//   weight f, inserted where new splits come in: slots in axis order
//       High (arrow <-, splits inserted at the right / high end):  [1 x F, f]
//       Mid  (arrow <->, in the middle):                           [1 x Lc, f, 1 x (F - Lc)],  Lc = ceil(F / 2)
//       Low  (arrow ->, at the left / low end):                    [f, 1 x F]
//   Total weight T = F + f = n + 1, so the regions always span the whole axis (the others shrink as the partial one grows: the
//   newest split grows in smoothly at its insertion point). A slot's channel base is stable when the count rises (High: s;
//   Low: s + 3 - F, anchored at the top; Mid: lower part from the bottom, upper part from the top), so no region is recoloured
//   when the partial one becomes full. Channel = (base + floor(Nudge mod 4)) mod 4, and the fractional part of Nudge crossfades
//   the assignment between adjacent channels (mask_c = (1 - phi) m[c - a] + phi m[c - a - 1], still summing to 1).
// WARP / SPIN. x -> p: inverse of the Bend / Pinch warp, then the Spin shift: q = wrap(p - spin), spin = -0.5..0.5 (fraction of the
//   axis), so the whole pattern slides along the spectrum and wraps around. t = q * T selects the slot.
//   Bend: midpoint m = 0.5 + 0.4 * Bend (the white dot's x); forward warp u -> u^gamma, gamma = ln m / ln 0.5 (negative Bend packs the
//   splits low, positive high). Pinch around m: q = 3^Pinch, the distance to m (per side, normalised) is raised to q (positive
//   bunches around m, negative pushes to the edges). Both are monotonic and analytically invertible, so a bin costs 2 pow.
// CROSSFADE X (0..1): at the boundary between two adjacent slots a raised-cosine transition of half width X * 0.5 * min(width of
//   the two slots) (in pattern units), so neighbouring transitions never overlap and X = 1 overlaps the full half widths. The seam of
//   the wrapped pattern (and the axis ends) is a hard edge. A split growing in at the middle (Mid) starts as a hard edge (the new
//   thin region narrows the crossfade at that boundary).

var FS_NCOLS = 128;             // display columns (log frequency)
var FS_FMIN = 20.0;
var FS_FMAX = 20000.0;
var FS_LN_RATIO = Math.log(FS_FMAX / FS_FMIN);
var FS_MAX_SPLITS = 1024;
var FS_LATENCY = 5120;          // 4096 (largest STFT latency, padded) + 1024 margin for the host block: the rack machinery reads the leader's data that late
var FS_CH_NAMES = ["Red", "Blue", "Yellow", "Magenta"];
var FS_SIZES = [1024, 2048, 4096];
var FS_SIZE_ENUM = ["1k", "2k", "4k"];
var FS_DIR_ENUM = ["High", "Mid", "Low"];   // arrows <- (inserted at the right), <-> (middle), -> (left)
var FS_OUT_ENUM = ["Auto", "Ch 1", "Ch 2", "Ch 3", "Ch 4", "All"];
var FS_DISPLAY_ENUM = ["Pre", "Post"];
var FS_BEND_RANGE = 0.4;        // midpoint = 0.5 + 0.4 * Bend
var FS_PINCH_BASE = 3.0;        // q = 3^Pinch
var FS_SPIN_MAX = 0.5;          // Spin +-50 % of the axis

// Telemetry buffer layout (---freqsplitscope, FS_SCOPE_SAMPS floats). Columns 0..639 are written by the instance that computes (the rack's leader or a lone
// instance) only; the scalars FRAME + 0..17 come from the rack template (src/spectral_split_rack_main.genexpr) and are written by every instance.
var FS_SC_PRE = 0;                     // 128 input (Mid) levels, 0..1 over -100..0 dB
var FS_SC_CH = FS_NCOLS;               // 4 x 128 channel levels after the masks (and the limiter), same scale
var FS_SC_FRAME = FS_NCOLS * 5;        // frame counter (telemetry frames)
var FS_SC_SR = FS_SC_FRAME + 1;
var FS_SC_N = FS_SC_FRAME + 2;
var FS_SC_AWAKE = FS_SC_FRAME + 3;
var FS_SC_LEVEL = FS_SC_FRAME + 4;     // input peak (decaying)
var FS_SC_LATENCY = FS_SC_FRAME + 6;
var FS_SC_SEL = FS_SC_FRAME + 7;       // output selection the gen is running (0 all, 1..4 channel)
// Rack machinery scalars (template)
var FS_SC_CMP = FS_SC_FRAME + 8;       // 1 = this instance runs the STFT pipeline (leader or alone), 0 = it follows
var FS_SC_FOL = FS_SC_FRAME + 9;       // 1 = following a leader
var FS_SC_ALIGNED = FS_SC_FRAME + 10;  // 1 = the offset to the leader's sample counter is known (content aligned)
var FS_SC_FB = FS_SC_FRAME + 11;       // fallback: 0 none, 1 the input differs from the leader's, 2 the leader's data stopped, 3 ring underrun
var FS_SC_DOFF = FS_SC_FRAME + 12;     // counter offset to the leader (modulo 2^22)
var FS_SC_UNDER = FS_SC_FRAME + 13;    // underrun counter
var FS_SC_LAG = FS_SC_FRAME + 14;      // leader's newest fingerprint counter minus this instance's own counter (samples)
var FS_SC_SERVE = FS_SC_FRAME + 15;    // channel mask this instance computes
var FS_SC_ROLE = FS_SC_FRAME + 16;     // role the face asked for (0 self, 1 leader, 2 follower)
var FS_SC_ALIVE = FS_SC_FRAME + 17;    // counter that moves every 1024 samples while the gen runs, also in silence (DSP ready detection)
var FS_SC_LIM = FS_SC_FRAME + 18;      // limiter on (0 / 1), written by the computing instance with its telemetry frame
var FS_SCOPE_SAMPS = FS_SC_FRAME + 32;
var FS_RACK_CHANNELS = 4;

// key: [long name, short name, min, max, initial, ptype (0 float, 1 int), unitstyle]
var FS_PARAMS = {
    splits: ["Frequency Splits", "Splits", 1.0, 1024.0, 16.0, 0, 9],
    xfade: ["Crossfade Amount", "XFade", 0.0, 100.0, 0.0, 0, 9],
    nudge: ["Split Nudge", "Nudge", -4.0, 4.0, 0.0, 0, 9],
    spin: ["Split Spin", "Spin", -50.0, 50.0, 0.0, 0, 9],
    bend: ["Split Bend", "Bend", -100.0, 100.0, 0.0, 0, 9],
    pinch: ["Split Pinch", "Pinch", -100.0, 100.0, 0.0, 0, 9],
    limthr: ["Limiter Threshold", "Lim Thr", -120.0, 12.0, 0.0, 0, 9],
    mix: ["Mix", "Mix", 0.0, 100.0, 100.0, 0, 9]
};
var FS_UNITS = { splits: "%.2f", xfade: "%.2f %", nudge: "%.2f", spin: "%.1f %", bend: "%.0f %", pinch: "%.0f %", limthr: "%.1f dB", mix: "%.0f %" };
// enumerated: key: [long name, short name, values, initial]
var FS_ENUMS = {
    dir: ["Split Insertion Direction", "Insert", FS_DIR_ENUM, 0],
    limon: ["Spectral Limiter", "Limiter", ["Off", "On"], 0],
    size: ["Size", "Size", FS_SIZE_ENUM, 2],
    output: ["Output", "Output", FS_OUT_ENUM, 0],
    dispost: ["Spectrum Display", "Display", FS_DISPLAY_ENUM, 0]
};
// gen messages for the live.* parameters, key -> [message, scale] (size -> fftn = 1024 * 2^index); the face re-sends them until the deferred gen runs
var FS_GEN_PARAMS = {
    splits: ["nsplit", 1], dir: ["sdir", 1], xfade: ["xfadeamt", 0.01], nudge: ["nudgeamt", 1], spin: ["spinamt", 0.01], bend: ["bendamt", 0.01],
    pinch: ["pinchamt", 0.01], limon: ["limon", 1], limthr: ["limdb", 1], mix: ["mixamt", 0.01]
};
// keys shared between all instances in a rack (everything except Output and the display choice)
var FS_LINKED_KEYS = ["splits", "dir", "xfade", "nudge", "spin", "bend", "pinch", "limon", "limthr", "mix", "size"];

function fsClip(x, lo, hi) {
    return x < lo ? lo : (x > hi ? hi : x);
}

// Output selector for the gen from the Output menu index (0 Auto, 1..4 Ch n, 5 All) and the resolved Auto channel
// (0-based chain index, -1 = no rack). Returns 0 = all channels summed, 1..4 = channel.
function fsResolveSel(outputIdx, autoChannel) {
    var o = Math.round(outputIdx);
    if (o >= 1 && o <= 4) return o;
    if (o >= 5) return 0;
    if (autoChannel < 0) return 0;
    return Math.min(Math.floor(autoChannel), 3) + 1;
}

function fsSelName(sel) {
    return sel >= 1 && sel <= 4 ? FS_CH_NAMES[sel - 1] : "All";
}

function fsFormatDb(db) {
    return (db > 0 ? "+" : "") + (Math.round(db * 10) / 10).toFixed(1) + " dB";
}

// dB -> linear amplitude
function fsDbToLin(db) {
    return Math.pow(10, db / 20);
}

// Share of the dry signal one instance adds: 1 for Output All, 1 / 4 when it outputs one channel AND holds a rack role
// (leader/follower; role > 0.5). Standalone / pending (role <= 0.5) keep full dry — matches kShare in spectral_split_rack_main.genexpr.
// role defaults to 1 so existing rack-sum callers (sel only) still get the 1 / 4 chain share.
function fsDryShare(sel, role) {
    if (role === undefined) role = 1;
    if (sel < 1) return 1.0;
    return role > 0.5 ? 0.25 : 1.0;
}

// Continuous bin of position x (0..1) / position x of bin k. n = FFT size.
function fsBinOf(x, n, sr) {
    return FS_FMIN * Math.exp(x * FS_LN_RATIO) * n / sr;
}

function fsXOf(k, n, sr) {
    return fsClip(Math.log(Math.max(k * sr / n, FS_FMIN) / FS_FMIN) / FS_LN_RATIO, 0, 1);
}

// x -> Hz and back (display)
function fsUToHz(u) {
    return FS_FMIN * Math.exp(fsClip(u, 0, 1) * FS_LN_RATIO);
}

function fsHzToU(f) {
    return fsClip(Math.log(Math.max(f, FS_FMIN) / FS_FMIN) / FS_LN_RATIO, 0, 1);
}

// Bend midpoint (white dot x) from Bend in -1..1.
function fsBendMid(bend) {
    return 0.5 + FS_BEND_RANGE * fsClip(bend, -1, 1);
}

function fsMod4(b) {
    return b - 4 * Math.floor(b / 4);
}

// Forward warp of a pattern position p (0..1) by Bend / Pinch. Monotonic, 0 -> 0, 1 -> 1.
function fsWarp(u, bend, pinch) {
    var m = fsBendMid(bend);
    var gam = Math.log(m) / Math.log(0.5);
    var q = Math.exp(fsClip(pinch, -1, 1) * Math.log(FS_PINCH_BASE));
    var w = Math.pow(u, gam);
    var t1 = w < m ? (m - w) / m : (w - m) / (1 - m);
    t1 = Math.pow(t1, q);
    return w < m ? m - m * t1 : m + (1 - m) * t1;
}

// Inverse of fsWarp: axis position x -> pattern position p.
function fsWarpInv(x, bend, pinch) {
    var m = fsBendMid(bend);
    var gam = Math.log(m) / Math.log(0.5);
    var qi = 1 / Math.exp(fsClip(pinch, -1, 1) * Math.log(FS_PINCH_BASE));
    var below = x < m;
    var tq = below ? (m - x) / m : (x - m) / (1 - m);
    var t0 = Math.pow(Math.max(tq, 0), qi);
    var wv = below ? m - m * t0 : m + (1 - m) * t0;
    return Math.pow(Math.max(wv, 0), 1 / gam);
}

// p = {splits (1..1024), dir (0 High, 1 Mid, 2 Low), xfade (0..1), nudge, spin (-0.5..0.5), bend (-1..1), pinch (-1..1)}.
// Returns the pattern description used by fsSlotAt / fsMaskAt (mirrors fs_pattern() in the core).
function fsPattern(p) {
    var n = fsClip(p.splits, 1, FS_MAX_SPLITS);
    var K = Math.floor(n);
    var f = n - K;
    var F = K + 1;
    var dir = fsClip(Math.floor(p.dir + 0.5), 0, 2);
    var Lc = Math.floor((F + 1) / 2);
    var sp = dir === 0 ? F : (dir === 2 ? 0 : Lc);
    var nd = p.nudge - 4 * Math.floor(p.nudge / 4);
    var a = Math.floor(nd);
    return {
        K: K, f: f, F: F, T: F + f, dir: dir, Lc: Lc, sp: sp, xf: fsClip(p.xfade, 0, 1),
        a: a, phi: nd - a, spin: fsClip(p.spin, -FS_SPIN_MAX, FS_SPIN_MAX),
        bend: fsClip(p.bend, -1, 1), pinch: fsClip(p.pinch, -1, 1),
        off: 3 - F, pmid: (F % 2 === 0) ? Lc : 3 - F + Lc
    };
}

// Channel base (before Nudge) of slot s.
function fsSlotBase(pat, s) {
    if (pat.dir === 0) return s;
    if (pat.dir === 2) return s + pat.off;
    return s < pat.Lc ? s : (s > pat.Lc ? s + pat.off : pat.pmid);
}

function fsSlotWidth(pat, s) {
    return s === pat.sp ? pat.f : 1;
}

// Lower edge (pattern units, 0..T) of slot s.
function fsSlotEdge(pat, s) {
    return s < pat.sp ? s : (s === pat.sp ? pat.sp : s + pat.f - 1);
}

// Slot (0..F) containing pattern coordinate t (0..T).
function fsSlotAt(pat, t) {
    var s = t < pat.sp ? Math.floor(t) : (t < pat.sp + pat.f ? pat.sp : pat.sp + 1 + Math.floor(t - pat.sp - pat.f));
    s = Math.max(0, Math.min(s, pat.F));
    return s === pat.sp && pat.f <= 0 ? s - 1 : s;       // the top axis end (t = T) never lands in an empty partial slot
}

// Pattern coordinate q (0..1, spin applied) of axis position x.
function fsPatternPos(pat, x) {
    var pp = fsWarpInv(x, pat.bend, pat.pinch);
    var q = pp - pat.spin;
    return q < 0 ? q + 1 : (q > 1 ? q - 1 : q);
}

// Direct evaluation of the four channel masks at axis position x (0..1). Returns [m0, m1, m2, m3] summing to 1.
// Mirrors the per-bin body of fs_masks().
function fsMaskAt(pat, x) {
    var t = fsPatternPos(pat, x) * pat.T;
    var s = fsSlotAt(pat, t);
    var e = fsSlotEdge(pat, s);
    var w = fsSlotWidth(pat, s);
    var wl = s - 1 === pat.sp ? pat.f : 1;
    var wu = s + 1 === pat.sp ? pat.f : 1;
    var hL = s > 0 ? pat.xf * 0.5 * Math.min(wl, w) : 0;
    var hU = s < pat.F ? pat.xf * 0.5 * Math.min(w, wu) : 0;
    var dl = t - e;
    var du = e + w - t;
    var inL = dl < hL;
    var inU = !inL && du < hU;
    var nb = inL ? s - 1 : (inU ? s + 1 : s);
    var tt = inL ? (dl + hL) / (2 * Math.max(hL, 1e-12)) : (inU ? (hU - du) / (2 * Math.max(hU, 1e-12)) : 0);
    var sw = 0.5 - 0.5 * Math.cos(Math.PI * tt);
    var wS = inL ? sw : (inU ? 1 - sw : 1);
    var wN = 1 - wS;
    var cS = fsMod4(fsSlotBase(pat, s) + pat.a);
    var cN = fsMod4(fsSlotBase(pat, nb) + pat.a);
    var out = [0, 0, 0, 0];
    var ph = pat.phi;
    out[cS] += (1 - ph) * wS;
    out[cN] += (1 - ph) * wN;
    out[(cS + 1) % 4] += ph * wS;
    out[(cN + 1) % 4] += ph * wN;
    return out;
}

// Hard channel (0..3, nudge floor applied) of axis position x, for labelling regions in the display.
function fsChannelAt(pat, x) {
    var m = fsMaskAt(pat, x);
    var best = 0;
    for (var c = 1; c < 4; c++) if (m[c] > m[best]) best = c;
    return best;
}

// Split positions on the axis (x, ascending): the boundaries between regions of non-zero width, plus the seam of the wrapped
// pattern when Spin is not 0. Used by the display and the tests.
function fsSplitXs(pat) {
    var xs = [];
    var last = -1;
    for (var s = 1; s <= pat.F; s++) {
        var wPrev = fsSlotWidth(pat, s - 1);
        if (wPrev <= 0) continue;
        var edge = fsSlotEdge(pat, s);
        if (edge <= 1e-12 || edge >= pat.T - 1e-12) continue;      // a boundary at the end of the pattern is not a split
        if (edge - last < 1e-12 && last >= 0) continue;
        last = edge;
        var p = edge / pat.T + pat.spin;
        p = p > 1 ? p - 1 : (p < 0 ? p + 1 : p);
        xs.push(fsWarp(p, pat.bend, pat.pinch));
    }
    if (pat.spin !== 0) xs.push(fsWarp(pat.spin < 0 ? 1 + pat.spin : pat.spin, pat.bend, pat.pinch));
    xs.sort(function (a, b) { return a - b; });
    return xs;
}

// Pattern-space interval [lo, hi] (0..1, before Spin / Bend / Pinch) of the partial (newest) region.
function fsPartialRange(pat) {
    return [pat.sp / pat.T, (pat.sp + pat.f) / pat.T];
}

// Fill the per-bin masks. mk = array of 5 Float64Array(n / 2 + 1): channels 0..3 and the all-ones mask 4. Mirrors fs_masks().
function fsMasksFill(pat, n, sr, mk) {
    var half = n / 2;
    for (var k = 0; k <= half; k++) {
        var m = fsMaskAt(pat, fsXOf(k, n, sr));
        for (var c = 0; c < 4; c++) mk[c][k] = m[c];
        mk[4][k] = 1;
    }
}

// Limiter gain of one bin: mask m, pre-mask bin amplitude amp (max of L and R), linear threshold thr.
function fsLimitGain(m, amp, thr) {
    return Math.min(1, thr / Math.max(m * amp, 1e-12));
}

// The face's parameter values (percent units) -> fsPattern input.
function fsPatternFromVals(v) {
    return {
        splits: v.splits, dir: v.dir, xfade: v.xfade / 100, nudge: v.nudge,
        spin: v.spin / 100, bend: v.bend / 100, pinch: v.pinch / 100
    };
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        FS_NCOLS: FS_NCOLS, FS_FMIN: FS_FMIN, FS_FMAX: FS_FMAX, FS_MAX_SPLITS: FS_MAX_SPLITS, FS_LATENCY: FS_LATENCY,
        FS_CH_NAMES: FS_CH_NAMES, FS_SIZES: FS_SIZES, FS_PARAMS: FS_PARAMS, FS_UNITS: FS_UNITS, FS_ENUMS: FS_ENUMS,
        FS_LINKED_KEYS: FS_LINKED_KEYS, FS_DIR_ENUM: FS_DIR_ENUM, FS_OUT_ENUM: FS_OUT_ENUM, FS_BEND_RANGE: FS_BEND_RANGE,
        FS_SPIN_MAX: FS_SPIN_MAX,
        FS_SC_PRE: FS_SC_PRE, FS_SC_CH: FS_SC_CH, FS_SC_FRAME: FS_SC_FRAME, FS_SC_SR: FS_SC_SR, FS_SC_N: FS_SC_N,
        FS_SC_AWAKE: FS_SC_AWAKE, FS_SC_LEVEL: FS_SC_LEVEL, FS_SC_LATENCY: FS_SC_LATENCY, FS_SC_SEL: FS_SC_SEL,
        FS_SC_LIM: FS_SC_LIM, FS_SCOPE_SAMPS: FS_SCOPE_SAMPS, FS_SC_CMP: FS_SC_CMP, FS_SC_FOL: FS_SC_FOL, FS_SC_ALIGNED: FS_SC_ALIGNED,
        FS_SC_FB: FS_SC_FB, FS_SC_DOFF: FS_SC_DOFF, FS_SC_UNDER: FS_SC_UNDER, FS_SC_LAG: FS_SC_LAG, FS_SC_SERVE: FS_SC_SERVE,
        FS_SC_ROLE: FS_SC_ROLE, FS_SC_ALIVE: FS_SC_ALIVE, FS_RACK_CHANNELS: FS_RACK_CHANNELS, FS_GEN_PARAMS: FS_GEN_PARAMS,
        fsClip: fsClip, fsResolveSel: fsResolveSel, fsSelName: fsSelName, fsFormatDb: fsFormatDb, fsDbToLin: fsDbToLin,
        fsDryShare: fsDryShare, fsBinOf: fsBinOf, fsXOf: fsXOf, fsUToHz: fsUToHz, fsHzToU: fsHzToU, fsBendMid: fsBendMid,
        fsWarp: fsWarp, fsWarpInv: fsWarpInv, fsPattern: fsPattern, fsSlotBase: fsSlotBase, fsSlotWidth: fsSlotWidth,
        fsSlotEdge: fsSlotEdge, fsSlotAt: fsSlotAt, fsPatternPos: fsPatternPos, fsMaskAt: fsMaskAt, fsChannelAt: fsChannelAt,
        fsSplitXs: fsSplitXs, fsPartialRange: fsPartialRange, fsMasksFill: fsMasksFill, fsLimitGain: fsLimitGain,
        fsPatternFromVals: fsPatternFromVals
    };
}
