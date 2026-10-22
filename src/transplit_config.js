// transplit_config.js — Transient Split: constants, parameter table, formatting helpers and the plain-JS
// reference of the mask maths in src/transplit_core.genexpr (the core mirrors ts_masks() line for line).
// Node-requirable (nodeModule pattern, AGENTS.md 1c) and also prepended to the v8ui script by the build.
//
// Mask contract: for every bin the Transients and Tones masks sum to exactly 1 while Tilt = 0 and
// Blend = 50 % (Bitwig's Transients/Tones Blend, a Mix-style control). Tilt (+-12 dB, opposite sign on the two
// channels) and Blend (gains min(1, 2 b) on the Transients and min(1, 2 (1 - b)) on the Tones, b = 0..1) are
// explicit gains, so the sum identity does not hold when they are used.

var TS_NCOLS = 128;          // display columns (log frequency)
var TS_FMIN = 30.0;
var TS_FMAX = 20000.0;
var TS_MAX_TILT_DB = 12.0;
var TS_LATENCY = 5120;       // 4096 (largest STFT latency, padded) + 1024 margin for the host block: the rack machinery reads the leader's data that late
var TS_CH_NAMES = ["Transients", "Tones"];
var TS_SIZES = [512, 1024, 2048, 4096];
var TS_SIZE_ENUM = ["512", "1k", "2k", "4k"];
var TS_OUT_ENUM = ["Auto", "Transients", "Tones", "All"];

// Telemetry buffer layout (---transplitscope, TS_SCOPE_SAMPS floats)
var TS_SC_PRE = 0;                     // 128 input (Mid) levels, 0..1 over -100..0 dB
var TS_SC_TR = TS_NCOLS;               // 128 Transients channel (mask applied), same scale
var TS_SC_TONE = TS_NCOLS * 2;         // 128 Tones channel
var TS_SC_FRAC = TS_NCOLS * 3;         // 128 transient fraction of the column's energy, 0..1
var TS_SC_FRAME = TS_NCOLS * 4;        // frame counter (telemetry frames)
var TS_SC_SR = TS_SC_FRAME + 1;
var TS_SC_N = TS_SC_FRAME + 2;
var TS_SC_AWAKE = TS_SC_FRAME + 3;
var TS_SC_LEVEL = TS_SC_FRAME + 4;     // input peak (decaying)
var TS_SC_TRMEAN = TS_SC_FRAME + 5;    // energy-weighted mean transient mask
var TS_SC_LATENCY = TS_SC_FRAME + 6;
var TS_SC_SEL = TS_SC_FRAME + 7;       // output selection the gen is running (0 sum, 1, 2)
// Rack machinery scalars (written by the template src/spectral_split_rack_main.genexpr every 1024 samples, by every instance)
var TS_SC_CMP = TS_SC_FRAME + 8;       // 1 = this instance runs the STFT pipeline (leader or alone), 0 = it follows
var TS_SC_FOL = TS_SC_FRAME + 9;       // 1 = following a leader
var TS_SC_ALIGNED = TS_SC_FRAME + 10;  // 1 = the offset to the leader's sample counter is known (content aligned)
var TS_SC_FB = TS_SC_FRAME + 11;       // fallback: 0 none, 1 the input differs from the leader's, 2 the leader's data stopped, 3 ring underrun
var TS_SC_DOFF = TS_SC_FRAME + 12;     // counter offset to the leader (modulo 2^22)
var TS_SC_UNDER = TS_SC_FRAME + 13;    // underrun counter
var TS_SC_LAG = TS_SC_FRAME + 14;      // leader's newest fingerprint counter minus this instance's own counter (samples)
var TS_SC_SERVE = TS_SC_FRAME + 15;    // channel mask this instance computes
var TS_SC_ROLE = TS_SC_FRAME + 16;     // role the face asked for (0 self, 1 leader, 2 follower)
var TS_SC_ALIVE = TS_SC_FRAME + 17;    // counter that moves every 1024 samples while the gen runs, also in silence (DSP ready detection)
var TS_RACK_CHANNELS = 2;
// Waveform ring: one entry per telemetry frame (frame f at slot f mod TS_WAVE_FRAMES), 4 floats per entry:
// pre Transients rms, pre Tones rms (analysis masks), post Transients rms, post Tones rms (after Tilt / Blend), linear amplitude.
var TS_WAVE_FRAMES = 64;
var TS_WAVE_STRIDE = 4;
var TS_FRAME_WRAP = 102400;            // frame counter wrap (a multiple of TS_WAVE_FRAMES)
var TS_SC_WAVE = TS_SC_FRAME + 18;
var TS_SCOPE_SAMPS = TS_SC_WAVE + TS_WAVE_FRAMES * TS_WAVE_STRIDE;

// Percussive onset thresholds (dB of A_t / H_t) and history time constants; Noise (phase deviation) thresholds.
var TS_ONSET_DB0 = 4.5;
var TS_ONSET_SPAN = 5.5;
var TS_BIAS_DB = 12.0;
var TS_HIST_RISE_S = 0.014;
var TS_HIST_FALL_S = 0.040;
var TS_DEV0 = 0.10;
var TS_DEV1 = 0.30;
var TS_DEV_BIAS0 = 0.12;
var TS_DEV_BIAS1 = 0.27;

// key: [long name, short name, min, max, initial, ptype (0 float, 1 int), unitstyle, unit text]
var TS_PARAMS = {
    bias: ["Analysis Bias", "Bias", -100.0, 100.0, 0.0, 0, 5],
    tdecay: ["Transients Decay", "Decay", 1.0, 125.0, 8.0, 0, 9],
    tsmooth: ["Tones Smoothing", "Smoothing", 1.0, 64.0, 1.5, 0, 9],
    tilt: ["Tilt Amount", "Tilt", -100.0, 100.0, 0.0, 0, 5],
    blend: ["Transients Tones Blend", "Blend", 0.0, 100.0, 50.0, 0, 5],
    mix: ["Mix", "Mix", 0.0, 100.0, 100.0, 0, 5]
};
// enumerated: key: [long name, short name, values, initial]
var TS_ENUMS = {
    ttype: ["Transient Type", "Type", ["Percussive", "Noise"], 0],
    tmode: ["Tilt Mode", "Tilt Mode", ["Standard", "Contour"], 0],
    size: ["Size", "Size", TS_SIZE_ENUM, 1],
    output: ["Output", "Output", TS_OUT_ENUM, 0]
};
// gen messages for the live.* parameters, key -> [message, scale] (size -> fftn = 512 * 2^index); the face re-sends them until the deferred gen runs
var TS_GEN_PARAMS = {
    bias: ["anbias", 0.01], tdecay: ["tdecay", 1], tsmooth: ["tsmooth", 1], tilt: ["tiltamt", 0.01], blend: ["blendamt", 0.01],
    mix: ["mixamt", 0.01], ttype: ["ttype", 1], tmode: ["tmode", 1]
};
// keys shared between all instances in a rack (everything except Output and the display toggles)
var TS_LINKED_KEYS = ["ttype", "bias", "tdecay", "tsmooth", "tilt", "tmode", "blend", "mix", "size"];

function tsClip(x, lo, hi) {
    return x < lo ? lo : (x > hi ? hi : x);
}

function tsSmooth01(x) {
    var c = tsClip(x, 0, 1);
    return c * c * (3 - 2 * c);
}

// Output selector for the gen from the Output menu and the resolved Auto channel (0-based, -1 = no rack).
// Returns 0 = sum of both channels, 1 = Transients, 2 = Tones.
function tsResolveSel(outputIdx, autoChannel) {
    var o = Math.round(outputIdx);
    if (o === 1) return 1;
    if (o === 2) return 2;
    if (o === 3) return 0;
    if (autoChannel < 0) return 0;
    return autoChannel === 0 ? 1 : 2;
}

// Resolved channel name for the face pill (index 0 / 1) or "ALL".
function tsSelName(sel) {
    return sel === 1 ? TS_CH_NAMES[0] : (sel === 2 ? TS_CH_NAMES[1] : "All");
}

// Bitwig style value text: two decimals ("8.00"), percentages with a unit ("0.00 %").
function tsFormatBlocks(blocks) {
    return (Math.round(blocks * 100) / 100).toFixed(2);
}

function tsFormatPct(v) {
    return (Math.round(v * 100) / 100).toFixed(2) + " %";
}

// Blend (0..1) -> channel gains: 50 % is the identity (both 1); 100 % only Transients, 0 % only Tones.
function tsBlendGains(b) {
    var c = tsClip(b, 0, 1);
    return [Math.min(1, 2 * c), Math.min(1, 2 * (1 - c))];
}

// Bin of a display column edge (c = 0..ncols), log spaced.
function tsColBin(c, ncols, n, sr, fmin, fmax) {
    return fmin * Math.pow(fmax / fmin, c / ncols) * n / sr;
}

// Tilt position weight per bin, -1 (lows) .. +1 (highs) for Standard; Contour is +1 at the mids and -1 at the
// lows and highs (a positive Tilt Amount raises the highs and the lows together, Bitwig's Contour). Anchored on a log axis 100 Hz .. 10 kHz (centre ~1 kHz). Returns [std, contour] arrays.
function tsTiltTables(n, sr) {
    var half = n / 2;
    var std = new Float64Array(half + 1);
    var con = new Float64Array(half + 1);
    for (var k = 0; k <= half; k++) {
        var f = Math.max(k * sr / n, 20.0);
        var u = tsClip(Math.log(f / 100.0) / Math.log(100.0), 0, 1);       // 0 at 100 Hz, 1 at 10 kHz
        std[k] = 2 * u - 1;
        con[k] = 2 * Math.abs(2 * u - 1) - 1;                               // -1 centre, +1 edges
    }
    return [std, con];
}

function tsNewState(n) {
    var half = n / 2;
    return {
        n: n,
        A: new Float64Array(half + 1),
        H: new Float64Array(half + 1),
        Ap: new Float64Array(half + 1),
        ph1: new Float64Array(half + 1),
        ph2: new Float64Array(half + 1),
        dev: new Float64Array(half + 1),
        tx: new Float64Array(half + 1),
        qx: new Float64Array(half + 1).fill(1),
        age: 0           // frames since the state was (re)started; 0 resets it, 1 has a history, 2 has a 2nd phase difference
    };
}

// One analysis frame. mag: Mid amplitude per bin (0..n/2), ph: Mid phase. p = {ttype, bias (-1..1),
// tdecay (1..125), tsmooth (1..64) in blocks, tilt (-1..1), tmode, blend (0..1, 0.5 = neutral)}. sr for the time-based history.
// Fills outTr / outTone (length n/2 + 1) with the final per-bin masks (the gen applies mask[k] to bins k and n-k).
// st.age is advanced here (the gen core does the same with its History `age`).
// Mirrors ts_masks() in src/transplit_core.genexpr.
function tsMasks(st, mag, ph, p, sr, tilts, outTr, outTone) {
    var n = st.n;
    var half = n / 2;
    var hop = n / 4;
    var age = st.age;
    var k, j;
    // frequency-smoothed amplitude (rms over +-2 bins)
    for (k = 0; k <= half; k++) {
        var s = 0;
        for (j = -2; j <= 2; j++) {
            var kk = tsClip(k + j, 0, half);
            s += mag[kk] * mag[kk];
        }
        st.A[k] = Math.sqrt(s * 0.2);
    }
    var rsK = 1 - Math.exp(-hop / (sr * TS_HIST_RISE_S));
    var flK = 1 - Math.exp(-hop / (sr * TS_HIST_FALL_S));
    var bs = tsClip(p.bias, -1, 1);
    var d0 = TS_ONSET_DB0 - TS_BIAS_DB * bs;
    var d1 = d0 + TS_ONSET_SPAN;
    var t0 = TS_DEV0 - TS_DEV_BIAS0 * bs;
    var t1 = Math.max(TS_DEV1 - TS_DEV_BIAS1 * bs, t0 + 0.02);
    var dk = Math.exp(-1 / tsClip(p.tdecay, 1, 125));
    var dtn = Math.exp(-1 / tsClip(p.tsmooth, 1, 64));
    var nzMode = p.ttype > 0.5 ? 1 : 0;
    for (k = 0; k <= half; k++) {
        var pd = ph[k] - 2 * st.ph1[k] + st.ph2[k];
        pd -= 6.283185307179586 * Math.floor((pd + 3.141592653589793) / 6.283185307179586);
        st.dev[k] = st.A[k] > 1e-7 ? Math.abs(pd) * 0.3183098861837907 : 0.5;
    }
    for (k = 0; k <= half; k++) {
        var a = st.A[k];
        var hh = age < 0.5 ? a : st.H[k];
        var db = 8.685889638065035 * Math.log((a + 1e-9) / (hh + 1e-9));
        var evp = age < 0.5 ? 0 : tsSmooth01((db - d0) / (d1 - d0));
        st.H[k] = hh + (a - hh) * (a > hh ? rsK : flK);
        var dl = st.dev[Math.max(k - 1, 0)];
        var dr = st.dev[Math.min(k + 1, half)];
        var dv = 0.25 * dl + 0.5 * st.dev[k] + 0.25 * dr;
        var evn = age < 1.5 ? 0 : tsSmooth01((dv - t0) / (t1 - t0));
        var ev = nzMode > 0.5 ? evn : evp;
        var txp = age < 0.5 ? 0 : st.tx[k];
        var qxp = age < 0.5 ? 1 : st.qx[k];
        var app = age < 0.5 ? a : st.Ap[k];
        var txn = Math.max(ev, txp * dk);
        var leak = Math.min(1, qxp * dtn * app / (a + 1e-9));
        var qxn = Math.max(1 - txn, leak);
        st.tx[k] = txn;
        st.qx[k] = qxn;
        st.Ap[k] = a;
    }
    for (k = 0; k <= half; k++) {
        st.ph2[k] = st.ph1[k];
        st.ph1[k] = ph[k];
    }
    st.age = Math.min(age + 1, 3);
    // Tilt (+-12 dB, opposite on the tones) and Blend (Mix-style channel gains), explicit gains
    var tl = tsClip(p.tilt, -1, 1);
    var bg = tsBlendGains(p.blend);
    var w = p.tmode > 0.5 ? tilts[1] : tilts[0];
    for (k = 0; k <= half; k++) {
        var g = Math.exp(tl * TS_MAX_TILT_DB * w[k] * 0.11512925464970229);
        var q0 = st.qx[k];
        outTr[k] = (1 - q0) * g * bg[0];
        outTone[k] = q0 / g * bg[1];
    }
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        TS_NCOLS: TS_NCOLS, TS_FMIN: TS_FMIN, TS_FMAX: TS_FMAX, TS_LATENCY: TS_LATENCY, TS_CH_NAMES: TS_CH_NAMES,
        TS_SIZES: TS_SIZES, TS_PARAMS: TS_PARAMS, TS_ENUMS: TS_ENUMS, TS_LINKED_KEYS: TS_LINKED_KEYS,
        TS_SC_PRE: TS_SC_PRE, TS_SC_TR: TS_SC_TR, TS_SC_TONE: TS_SC_TONE, TS_SC_FRAC: TS_SC_FRAC,
        TS_SC_FRAME: TS_SC_FRAME, TS_SC_SR: TS_SC_SR, TS_SC_N: TS_SC_N, TS_SC_AWAKE: TS_SC_AWAKE,
        TS_SC_LEVEL: TS_SC_LEVEL, TS_SC_TRMEAN: TS_SC_TRMEAN, TS_SC_LATENCY: TS_SC_LATENCY, TS_SC_SEL: TS_SC_SEL, TS_SC_CMP: TS_SC_CMP, TS_SC_FOL: TS_SC_FOL, TS_SC_ALIGNED: TS_SC_ALIGNED, TS_SC_FB: TS_SC_FB, TS_SC_DOFF: TS_SC_DOFF, TS_SC_UNDER: TS_SC_UNDER, TS_SC_LAG: TS_SC_LAG, TS_SC_SERVE: TS_SC_SERVE, TS_SC_ROLE: TS_SC_ROLE, TS_SC_ALIVE: TS_SC_ALIVE, TS_RACK_CHANNELS: TS_RACK_CHANNELS, TS_GEN_PARAMS: TS_GEN_PARAMS,
        TS_SCOPE_SAMPS: TS_SCOPE_SAMPS, TS_MAX_TILT_DB: TS_MAX_TILT_DB,
        TS_ONSET_DB0: TS_ONSET_DB0, TS_ONSET_SPAN: TS_ONSET_SPAN, TS_BIAS_DB: TS_BIAS_DB,
        TS_HIST_RISE_S: TS_HIST_RISE_S, TS_HIST_FALL_S: TS_HIST_FALL_S,
        TS_DEV0: TS_DEV0, TS_DEV1: TS_DEV1, TS_DEV_BIAS0: TS_DEV_BIAS0, TS_DEV_BIAS1: TS_DEV_BIAS1,
        tsClip: tsClip, tsSmooth01: tsSmooth01, tsResolveSel: tsResolveSel, tsSelName: tsSelName,
        tsFormatBlocks: tsFormatBlocks, tsFormatPct: tsFormatPct, tsBlendGains: tsBlendGains,
        TS_WAVE_FRAMES: TS_WAVE_FRAMES, TS_WAVE_STRIDE: TS_WAVE_STRIDE, TS_FRAME_WRAP: TS_FRAME_WRAP, TS_SC_WAVE: TS_SC_WAVE, tsColBin: tsColBin, tsTiltTables: tsTiltTables, tsNewState: tsNewState,
        tsMasks: tsMasks
    };
}
