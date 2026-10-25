// Shared Cepstra helpers: parameter mapping, cutoff-quefrency math, telemetry bin layout, Mid/Side lock,
// and a reference implementation of the cepstral split used by src/cepstra_core.genexpr.
// Prepended into src/cepstra_display.js at build time and exported for Node tests.

const SCOPE_SAMPS = 272; // 0..191 signed Mid cepstrum c[n], linear n = 0..20 ms (9999 = beyond N/2), 256 L, 257 f0, 258 level, 259 frame, 260 N, 261 voiced, 262 mode
const NUM_QUEF = 192;
const QUEF_MIN_MS = 0;
const QUEF_MAX_MS = 20;
const QUEF_SENTINEL = 9999; // telemetry column beyond N/2
const NUM_BINS = 128;
const BIN_FMIN = 40;
const BIN_FMAX = 10000;
const FFT_SIZES = [1024, 2048, 4096];
const MODE_NAMES = ["Man", "Auto", "MIDI"];
const QUALITY_NAMES = ["1k", "2k", "4k"];
const SHIFT_RANGE_ST = 36;
const LIFTER_MIN_MS = 0.3;
const LIFTER_MAX_MS = 15.0;
const DEFAULT_RES_PCT = 57;
const GATE_RANGE_MIN_DB = 8;  // Spec gate range at 100%
const GATE_RANGE_SPAN_DB = 40; // extra range at 0+ (48 dB total)
const EPS_MAG = 1e-9;

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function fftSizeForQuality(q) {
    return FFT_SIZES[clamp(Math.round(q), 0, 2)];
}

// Samples of latency: N (analysis) + N/8 (time-sliced frame work).
function latencySamples(n) {
    return n + n / 8;
}

function shiftRatio(semis) {
    return Math.pow(2, clamp(semis, -SHIFT_RANGE_ST, SHIFT_RANGE_ST) / 12);
}

// Manual cutoff: Res 0..1 maps logarithmically from 0.3 ms to 15 ms of quefrency, converted to samples (< N/2).
function manualLagSamples(res01, sr, n) {
    const r = clamp(res01, 0, 1);
    const ms = LIFTER_MIN_MS * Math.pow(LIFTER_MAX_MS / LIFTER_MIN_MS, r);
    return clamp(ms * 0.001 * sr, 2, n / 2 - 4);
}

// Auto / MIDI: Res scales k from 0.3 to 1.0 of the pitch period.
function periodScale(res01) {
    return 0.3 + 0.7 * clamp(res01, 0, 1);
}

function midiToHz(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
}

function midiPeriodSamples(note, sr) {
    return sr / midiToHz(note);
}

// Cutoff L in samples for a given mode: 0 = Manual, 1 = Auto (needs periodSamples), 2 = MIDI (needs a note).
function lifterLagSamples(mode, res01, sr, n, periodSamples) {
    if (mode === 0 || !(periodSamples > 0)) return manualLagSamples(res01, sr, n);
    return clamp(periodScale(res01) * periodSamples, 2, n / 2 - 4);
}

// Inverse mapping used by the UI cutoff strip: lag in samples -> Res 0..1.
function resFromLag(mode, lagSamples, sr, n, periodSamples) {
    if (mode === 0 || !(periodSamples > 0)) {
        const ms = (lagSamples / sr) * 1000;
        const r = Math.log(Math.max(ms, LIFTER_MIN_MS) / LIFTER_MIN_MS) / Math.log(LIFTER_MAX_MS / LIFTER_MIN_MS);
        return clamp(r, 0, 1);
    }
    return clamp(((lagSamples / periodSamples) - 0.3) / 0.7, 0, 1);
}

function lagToMs(lagSamples, sr) {
    return (lagSamples / sr) * 1000;
}

// 128 log-spaced telemetry bins between BIN_FMIN and min(BIN_FMAX, 0.45 sr).
function binFreq(b, sr) {
    const fmax = Math.min(BIN_FMAX, (sr || 44100) * 0.45);
    return BIN_FMIN * Math.pow(fmax / BIN_FMIN, b / (NUM_BINS - 1));
}

function freqToBinPos(hz, sr) {
    const fmax = Math.min(BIN_FMAX, (sr || 44100) * 0.45);
    return (Math.log(Math.max(hz, BIN_FMIN) / BIN_FMIN) / Math.log(fmax / BIN_FMIN)) * (NUM_BINS - 1);
}

// Spec gate: 0..1 -> how far below the local partial peak a fine-structure bin may sit before it is cut
// (8 + 40 * (1 - g)^3 dB: 48 dB at 0+, ~17 dB at 40%, 8 dB at 100%).
function gateRangeNepers(gate01) {
    const om = 1 - clamp(gate01, 0, 1);
    return (GATE_RANGE_MIN_DB + GATE_RANGE_SPAN_DB * om * om * om) / 8.685889638;
}

// Peak envelope of the fine structure: P[k] = max_j (H[j] - d |k - j|), d = 1 neper per half harmonic spacing
// implied by the lifter (W = N / 2L). Mirrors the part-0 passes in job_spec().
function specPeakEnvelope(H, lag, n) {
    const nh = n / 2, d = 1 / Math.max(1, 0.5 * n / Math.max(lag, 2)), P = new Float64Array(nh + 1);
    let run = -1000;
    for (let k = 0; k <= nh; k++) { run = Math.max(H[k], run - d); P[k] = run; }
    run = -1000;
    for (let k = nh; k >= 0; k--) { run = Math.max(H[k], run - d); P[k] = Math.max(P[k], run); }
    return P;
}

// Soft-knee Spec gate on the fine structure h (nepers) relative to its local peak p. Mirrors gate_h() in the GenExpr core.
function gateFineStructure(h, gate01, p) {
    if (gate01 <= 0.0005) return h;
    const kn = 0.6;
    const t = clamp((h - p + gateRangeNepers(gate01) + kn) / (2 * kn), 0, 1);
    const g = t * t * (3 - 2 * t);
    const depth = 6.9 * clamp(gate01 * 10, 0, 1);
    return h - (1 - g) * depth;
}

// Mid/Side Lock: moving one shifts the other by the same delta (clamped to +/-36 st).
function applyLock(lockOn, changed, newValue, curMid, curSide) {
    let mid = curMid;
    let side = curSide;
    if (changed === "mid") {
        const d = newValue - curMid;
        mid = clamp(newValue, -SHIFT_RANGE_ST, SHIFT_RANGE_ST);
        if (lockOn) side = clamp(curSide + d, -SHIFT_RANGE_ST, SHIFT_RANGE_ST);
    } else {
        const d = newValue - curSide;
        side = clamp(newValue, -SHIFT_RANGE_ST, SHIFT_RANGE_ST);
        if (lockOn) mid = clamp(curMid + d, -SHIFT_RANGE_ST, SHIFT_RANGE_ST);
    }
    return { mid, side };
}


// ---------------------------------------------------------------------------------------------
// Cepstrum display axis (linear quefrency, 0 .. 20 ms) and cutoff-bar <-> Res mapping helpers
// ---------------------------------------------------------------------------------------------

// Linear quefrency axis: telemetry column b covers [b, b + 1) * QUEF_MAX_MS / NUM_QUEF.
function quefMsAt(b) {
    return (b * QUEF_MAX_MS) / NUM_QUEF;
}

function msToAxis01(ms) {
    return clamp(ms / QUEF_MAX_MS, 0, 1);
}

function axis01ToMs(t) {
    return clamp(t, 0, 1) * QUEF_MAX_MS;
}

// Cutoff bar position (0..1 along the quefrency axis) for a Res value, and the inverse.
function resToAxis01(mode, res01, sr, n, periodSamples) {
    return msToAxis01(lagToMs(lifterLagSamples(mode, res01, sr, n, periodSamples), sr));
}

function axis01ToRes(mode, t01, sr, n, periodSamples) {
    return resFromLag(mode, (axis01ToMs(t01) / 1000) * sr, sr, n, periodSamples);
}

// Display height -1..1 for a signed cepstral value: sign * asinh(K |c| / ref) / asinh(K) * 0.85, so |c| = ref
// (the 95th percentile over n >= 2) lands at 85% of the half-height; small stems stay visible; big values clip.
const DISPLAY_K = 20;
function cepstrumDisplayHeight(c, ref) {
    const r = Math.max(ref, 1e-6);
    const h = (Math.asinh((DISPLAY_K * Math.abs(c)) / r) / Math.asinh(DISPLAY_K)) * 0.85;
    return clamp(c < 0 ? -h : h, -1, 1);
}

// p-th percentile (0..1) of |values[i]| for i >= skip, ignoring the sentinel.
function percentileAbs(values, skip, p) {
    const a = [];
    for (let i = skip; i < values.length; i++) if (Math.abs(values[i]) < QUEF_SENTINEL) a.push(Math.abs(values[i]));
    if (!a.length) return 0;
    a.sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}

// Auto-gain reference: fast attack, slow release.
function adaptRef(ref, target) {
    return target > ref ? ref + (target - ref) * 0.6 : ref + (target - ref) * 0.03;
}

// Telemetry columns [i0, i1) that display column j of `cols` covers (disjoint, covers all NUM_QUEF).
function columnRange(j, cols) {
    return [Math.floor((j * NUM_QUEF) / cols), Math.max(Math.floor(((j + 1) * NUM_QUEF) / cols), Math.floor((j * NUM_QUEF) / cols) + 1)];
}

// Display-column bounds, rebuilt only when the column count, quefrency span or FFT size changes.
// The numeric edges follow columnRange (the 192 telemetry columns); qmax and n are part of the cache key
// so a sample-rate or quality change does not keep a stale table.
var cepColKey = "";
var cepColTable = [];
function columnBounds(cols, qmax, n) {
    var key = cols + ":" + qmax + ":" + n;
    if (key === cepColKey && cepColTable.length === cols) return cepColTable;
    var out = new Array(cols);
    for (var j = 0; j < cols; j++) out[j] = columnRange(j, cols);
    cepColKey = key;
    cepColTable = out;
    return out;
}

// Signed value with the largest |c| over telemetry columns [i0, i1); valid = at least one real (non-sentinel) column.
function poolSigned(values, i0, i1) {
    let best = 0;
    let valid = false;
    for (let i = i0; i < Math.min(i1, values.length); i++) {
        if (Math.abs(values[i]) >= QUEF_SENTINEL) continue;
        valid = true;
        if (Math.abs(values[i]) > Math.abs(best)) best = values[i];
    }
    return { v: best, valid };
}


// ---------------------------------------------------------------------------------------------
// Reference cepstral split (plain JS, mirrors the GenExpr pipeline for one real channel)
// ---------------------------------------------------------------------------------------------

function fftInPlace(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    for (let m = 2; m <= n; m <<= 1) {
        const ang = (inverse ? 2 : -2) * Math.PI / m;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        for (let i = 0; i < n; i += m) {
            let cr = 1, ci = 0;
            for (let k = 0; k < m / 2; k++) {
                const a = i + k, b = i + k + m / 2;
                const vr = re[b] * cr - im[b] * ci;
                const vi = re[b] * ci + im[b] * cr;
                re[b] = re[a] - vr; im[b] = im[a] - vi;
                re[a] += vr; im[a] += vi;
                const nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
    }
    if (inverse) {
        for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
}

function hannWindow(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    return w;
}

// Lifter weight at quefrency q (q = min(n, N - n)) for cutoff L: 1 below L - taper, half-Hann to 0 at L.
function lifterWeight(q, lag) {
    const tw = clamp(lag * 0.25, 2, 6);
    if (q >= lag) return 0;
    if (q <= lag - tw) return 1;
    return 0.5 + 0.5 * Math.cos(Math.PI * (q - (lag - tw)) / tw);
}

// frame: windowed real frame (length N). Returns the spectrum, log-magnitude, cepstrum, formant cepstrum,
// log envelope E and harmonic fine structure H = logmag - E.
function cepstralSplit(frame, lag) {
    const n = frame.length;
    const xr = Float64Array.from(frame);
    const xi = new Float64Array(n);
    fftInPlace(xr, xi, false);
    const logmag = new Float64Array(n);
    for (let k = 0; k < n; k++) logmag[k] = Math.log(Math.hypot(xr[k], xi[k]) + EPS_MAG);
    const cr = Float64Array.from(logmag);
    const ci = new Float64Array(n);
    fftInPlace(cr, ci, true);
    const fr = new Float64Array(n);
    const fi = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const q = i <= n / 2 ? i : n - i;
        fr[i] = cr[i] * lifterWeight(q, lag);
    }
    fftInPlace(fr, fi, false);
    const E = new Float64Array(n);
    const H = new Float64Array(n);
    for (let k = 0; k < n; k++) {
        E[k] = fr[k];
        H[k] = logmag[k] - E[k];
    }
    return { lag, xr, xi, logmag, cepstrum: cr, E, H, formantCepstrum: Float64Array.from(cr.map((v, i) => v * lifterWeight(i <= n / 2 ? i : n - i, lag))) };
}

function interpEnv(E, kf, nh) {
    const kc = clamp(kf, 0, nh);
    const i0 = Math.floor(kc);
    const i1 = Math.min(i0 + 1, nh);
    const fr = kc - i0;
    return E[i0] * (1 - fr) + E[i1] * fr;
}

// Output log-magnitude for bin k (0..N/2): clip(E'(k) + gate(H), -21, 12).
function shiftedLogMag(split, k, ratio, gate01) {
    const nh = split.E.length / 2;
    const ep = interpEnv(split.E, k / ratio, nh);
    if (gate01 > 0.0005 && !split.peakEnv) split.peakEnv = specPeakEnvelope(split.H, split.lag, split.E.length);
    const h = gateFineStructure(split.H[k], gate01, split.peakEnv ? split.peakEnv[k] : split.H[k]);
    return clamp(ep + h, -21, 12);
}


// ---------------------------------------------------------------------------------------------
// Ceps gate = voicing-keyed gate: reference mirroring job_cgate() in src/cepstra_core.genexpr
// ---------------------------------------------------------------------------------------------
const GATE_MODE_NAMES = ["Spec", "Ceps"];
const VOICING_T0 = 3.5;  // pitchedness threshold at Gate 0+ (noise scores ~3-4.5 at any level)
const VOICING_T1 = 14.5; // Gate 100%. A clean vowel scores about 16, so it still passes; noise and a noisy vowel (~9) do not.

// Pitchedness of a frame: largest cepstral peak in max(L, 1 ms)..1/60 s over the RMS of that region.
function cepstralVoicing(c, lag, sr, n) {
    const nh = n / 2, qlo = Math.max(Math.ceil(lag), Math.floor(sr / 1000)), qhi = Math.min(nh - 2, Math.floor(sr / 60));
    let pk = 0, ss = 0, cnt = 0;
    for (let i = qlo; i <= qhi; i++) { pk = Math.max(pk, c[i]); ss += c[i] * c[i]; cnt++; }
    const rms = Math.sqrt(ss / Math.max(cnt, 1) + 1e-20);
    return { v: pk / rms, rms };
}

function voicingThreshold(gate01) {
    return VOICING_T0 + (VOICING_T1 - VOICING_T0) * clamp(gate01, 0, 1);
}

// One frame of the gate: smoothed openness (open 0.7, close 0.25) and the log gain (up to -60 dB) for both channels.
function voicingGateStep(open, v, gate01) {
    if (gate01 <= 0.0005) return { open: 1, logGain: 0 };
    const t = clamp((v - voicingThreshold(gate01) + 1) / 2, 0, 1), tgt = t * t * (3 - 2 * t);
    const op = open + (tgt - open) * (tgt > open ? 0.7 : 0.25);
    return { open: op, logGain: -(1 - op) * 6.9 * clamp(gate01 * 10, 0, 1) };
}

// Export through a local so this file stays a global script for the type checker (see AGENTS.md 1c).
var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        GATE_MODE_NAMES, VOICING_T0, VOICING_T1, cepstralVoicing, voicingThreshold, voicingGateStep,
        SCOPE_SAMPS, NUM_QUEF, QUEF_MIN_MS, QUEF_MAX_MS, QUEF_SENTINEL, quefMsAt, msToAxis01, axis01ToMs, resToAxis01, axis01ToRes, DISPLAY_K, cepstrumDisplayHeight, percentileAbs, adaptRef, columnRange, poolSigned, NUM_BINS, BIN_FMIN, BIN_FMAX, FFT_SIZES, MODE_NAMES, QUALITY_NAMES, SHIFT_RANGE_ST,
        LIFTER_MIN_MS, LIFTER_MAX_MS, DEFAULT_RES_PCT, GATE_RANGE_MIN_DB, GATE_RANGE_SPAN_DB, EPS_MAG,
        clamp, fftSizeForQuality, latencySamples, shiftRatio, manualLagSamples, periodScale, midiToHz,
        midiPeriodSamples, lifterLagSamples, resFromLag, lagToMs, binFreq, freqToBinPos,
        gateRangeNepers, specPeakEnvelope, gateFineStructure, applyLock,
        fftInPlace, hannWindow, lifterWeight, cepstralSplit, interpEnv, shiftedLogMag,
        columnBounds,
    };
}
