// Shared Cepstra helpers: parameter mapping, cutoff-quefrency math, telemetry bin layout, Mid/Side lock,
// and a reference implementation of the cepstral split used by src/cepstra_core.genexpr.
// Prepended into src/cepstra_ui.js at build time and exported for Node tests.

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
const GATE_MAX_DB = 30;
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

// Gate: 0..1 -> threshold in nepers above the envelope (0 -> off, 1 -> +30 dB).
function gateThresholdNepers(gate01) {
    return clamp(gate01, 0, 1) * (GATE_MAX_DB / 8.685889638);
}

// Soft-knee harmonic gate on the fine structure h (nepers). Mirrors gate_h() in the GenExpr core.
function gateFineStructure(h, gate01) {
    if (gate01 <= 0.0005) return h;
    const thr = gateThresholdNepers(gate01);
    const kn = 0.6;
    const t = clamp((h - (thr - kn)) / (2 * kn), 0, 1);
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
// Cepstrum display axis (log quefrency, 0.2 ms .. 20 ms) and glyph-knob mapping helpers
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

// Knob table in face order. step = value quantization.
const KNOBS = [
    { key: "res", msg: "res", label: "Res", min: 0, max: 100, def: 57, step: 0.1, unit: "%" },
    { key: "mid", msg: "mid", label: "Mid", min: -36, max: 36, def: 0, step: 0.1, unit: " st" },
    { key: "mix", msg: "mix", label: "Mix", min: 0, max: 100, def: 100, step: 0.1, unit: "%" },
    { key: "side", msg: "side", label: "Side", min: -36, max: 36, def: 0, step: 0.1, unit: " st" },
    { key: "gate", msg: "gate", label: "Gate", min: 0, max: 100, def: 0, step: 0.1, unit: "%" },
];
const SLIDERS = [
    { key: "fmt", msg: "fmt", label: "Formant", min: 0, max: 200, def: 100, step: 1, unit: "%" },
    { key: "harm", msg: "harm", label: "Harmonic", min: 0, max: 200, def: 100, step: 1, unit: "%" },
];
const KNOB_DRAG_PX = 120; // pixels of vertical drag for the full range

function specFor(key) {
    return KNOBS.concat(SLIDERS).filter((k) => k.key === key)[0];
}

function quantizeTo(spec, v) {
    return clamp(Math.round(v / spec.step) * spec.step, spec.min, spec.max);
}

// Vertical drag (dyPx > 0 = mouse moved down) -> value. Shift = 8x finer.
function knobDragValue(spec, startVal, dyPx, fine) {
    const per = (spec.max - spec.min) / KNOB_DRAG_PX / (fine ? 8 : 1);
    return clamp(startVal - dyPx * per, spec.min, spec.max);
}

// Horizontal dot slider: absolute position -> value.
function sliderValueAt(spec, x, x0, w) {
    return quantizeTo(spec, spec.min + clamp((x - x0) / w, 0, 1) * (spec.max - spec.min));
}

function valueToNorm(spec, v) {
    return clamp((v - spec.min) / (spec.max - spec.min), 0, 1);
}

function formatValue(spec, v) {
    if (spec.unit === " st") return (v >= 0 ? "+" : "") + v.toFixed(1) + " st";
    return (spec.max > 100 ? Math.round(v) : v.toFixed(1)) + "%";
}

// Glyph geometry (all pure, drawn by the v8ui)
const GATE_BAR_BASE = [0.5, 0.8, 0.35, 1.0, 0.6, 0.9, 0.4, 0.7, 0.3];
function resGridCount(norm) { return 4 + Math.round(clamp(norm, 0, 1) * 4); }
function mixRingCount(norm) { return Math.ceil(clamp(norm, 0, 1) * 5 - 1e-9); }
function gateBarHeights(norm) {
    const g = clamp(norm, 0, 1);
    return GATE_BAR_BASE.map((h) => (h < g * 0.9 ? 0.06 : h * (1 - 0.35 * g)));
}
function shiftOffsetNorm(st) { return clamp(st / SHIFT_RANGE_ST, -1, 1); }

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
    return { xr, xi, logmag, cepstrum: cr, E, H, formantCepstrum: Float64Array.from(cr.map((v, i) => v * lifterWeight(i <= n / 2 ? i : n - i, lag))) };
}

function interpEnv(E, kf, nh) {
    const kc = clamp(kf, 0, nh);
    const i0 = Math.floor(kc);
    const i1 = Math.min(i0 + 1, nh);
    const fr = kc - i0;
    return E[i0] * (1 - fr) + E[i1] * fr;
}

// Output log-magnitude for bin k (0..N/2): exp(fmt * E'(k) + harm * gate(H)).
function shiftedLogMag(split, k, ratio, fmt, harm, gate01) {
    const nh = split.E.length / 2;
    const ep = interpEnv(split.E, k / ratio, nh);
    const h = gateFineStructure(split.H[k], gate01);
    return clamp(fmt * ep + harm * h, -21, 12);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        SCOPE_SAMPS, NUM_QUEF, QUEF_MIN_MS, QUEF_MAX_MS, QUEF_SENTINEL, quefMsAt, msToAxis01, axis01ToMs, resToAxis01, axis01ToRes, DISPLAY_K, cepstrumDisplayHeight, percentileAbs, adaptRef, columnRange, poolSigned, KNOBS, SLIDERS, KNOB_DRAG_PX, specFor, quantizeTo, knobDragValue, sliderValueAt, valueToNorm, formatValue, GATE_BAR_BASE, resGridCount, mixRingCount, gateBarHeights, shiftOffsetNorm, NUM_BINS, BIN_FMIN, BIN_FMAX, FFT_SIZES, MODE_NAMES, QUALITY_NAMES, SHIFT_RANGE_ST,
        LIFTER_MIN_MS, LIFTER_MAX_MS, DEFAULT_RES_PCT, GATE_MAX_DB, EPS_MAG,
        clamp, fftSizeForQuality, latencySamples, shiftRatio, manualLagSamples, periodScale, midiToHz,
        midiPeriodSamples, lifterLagSamples, resFromLag, lagToMs, binFreq, freqToBinPos,
        gateThresholdNepers, gateFineStructure, applyLock,
        fftInPlace, hannWindow, lifterWeight, cepstralSplit, interpEnv, shiftedLogMag,
    };
}
