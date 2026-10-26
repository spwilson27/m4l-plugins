// Shared Degrade DSP math, reorderable 5-stage pipeline helpers, and UI simulation.
// Prepended into src/degrade_ui.js at build time and exported for Node tests.

const DEG_STATE_VERSION = 1;
const SCOPE_FLOATS = 32; // #0-degscope telemetry buffer size
const SCOPE_COLS = 96;

// Stage IDs:
//   0: BIT     (Bit Reduction, Integer Wrap & Dither)
//   1: SR      (Sample-Rate Reduction & Clock Jitter)
//   2: CODEC   (Lossy MP3/AAC/Opus Spectral Holes, Pre-Echo & Birdies)
//   3: TELE    (Telephone Companding: u-Law, A-Law, ADPCM, GSM)
//   4: FFT     (Spectral Frame Glitch: Freeze, Scramble, Comb, Phase Splat)
const STAGE_COUNT = 5;
const DEFAULT_ORDER = [0, 1, 2, 3, 4];

const STAGE_META = [
    { id: 0, key: "bit",   label: "BIT",   full: "1. BIT / WRAP",   color: [0.98, 0.56, 0.24] },
    { id: 1, key: "sr",    label: "SR",    full: "2. SR / JITTER",  color: [0.26, 0.84, 0.96] },
    { id: 2, key: "codec", label: "CODEC", full: "3. CODEC LOSS",   color: [0.76, 0.46, 0.98] },
    { id: 3, key: "tele",  label: "TELE",  full: "4. TELECOM",      color: [0.32, 0.90, 0.58] },
    { id: 4, key: "fft",   label: "FFT",   full: "5. FFT GLITCH",   color: [0.98, 0.36, 0.54] },
];

const TELE_MODES = ["u-Law", "A-Law", "ADPCM", "GSM"];
const FFT_MODES = ["Denois", "Scrmbl", "Splat", "Comb"];
const SR_MODES = ["S&H", "Filter"];

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function wrapVal(v, lo, hi) {
    const span = hi - lo;
    if (span <= 0) return lo;
    let r = (v - lo) % span;
    if (r < 0) r += span;
    return lo + r;
}

function dbToLin(db) {
    return Math.pow(10, db / 20);
}

function linToDb(lin) {
    return 20 * Math.log10(Math.max(lin, 1e-6));
}

// Validate & normalize any array into a valid permutation of [0, 1, 2, 3, 4].
function normalizeOrder(arr) {
    const seen = [false, false, false, false, false];
    const out = [];
    if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
            const v = Math.round(Number(arr[i]));
            if (v >= 0 && v < STAGE_COUNT && !seen[v]) {
                seen[v] = true;
                out.push(v);
            }
        }
    }
    for (let s = 0; s < STAGE_COUNT; s++) {
        if (!seen[s]) out.push(s);
    }
    return out;
}

// Reorder a stage from slot `fromIdx` to slot `toIdx` (0..4).
function moveStageInOrder(orderArr, fromIdx, toIdx) {
    const clean = normalizeOrder(orderArr);
    const f = clamp(Math.round(fromIdx), 0, STAGE_COUNT - 1);
    const t = clamp(Math.round(toIdx), 0, STAGE_COUNT - 1);
    if (f === t) return clean;
    const item = clean.splice(f, 1)[0];
    clean.splice(t, 0, item);
    return clean;
}

// Pack a 5-stage permutation into a base-10 integer (e.g. [0,1,2,3,4] -> 1234) or unpack it.
function encodeOrderCode(orderArr) {
    const clean = normalizeOrder(orderArr);
    let code = 0;
    for (let i = 0; i < STAGE_COUNT; i++) {
        code = code * 10 + clean[i];
    }
    return code;
}

function decodeOrderCode(code) {
    let n = Math.max(0, Math.round(Number(code) || 0));
    const digits = [0, 0, 0, 0, 0];
    for (let i = STAGE_COUNT - 1; i >= 0; i--) {
        digits[i] = n % 10;
        n = Math.floor(n / 10);
    }
    return normalizeOrder(digits);
}

// Section 1: Bit Reduction + Signal-Following Grit + Integer Wrap + Dither
function processBitSample(x, bits, wrapAmt, ditherAmt, envLevel, randBipolar) {
    const b = clamp(bits, 1.0, 16.0);
    const w = clamp(wrapAmt, 0.0, 1.0);
    const d = clamp(ditherAmt, 0.0, 1.0);
    const env = clamp(envLevel, 0.0, 1.5);
    const r = clamp(randBipolar || 0.0, -1.0, 1.0);

    // Integer wrap drive: at w > 0, boosts gain and folds overflow like 8/16-bit integer registers
    const drive = 1.0 + w * 3.5;
    const driven = x * drive;
    const clipped = clamp(driven, -1.0, 1.0);
    const wrapped = wrapVal(driven + 1.0, 0.0, 2.0) - 1.0;
    const preQuant = clipped * (1.0 - w) + wrapped * w;

    // Signal-following noise floor + explicit dither injection before quantization
    const steps = Math.pow(2.0, b);
    const stepSize = 2.0 / steps;
    const sigFollowGrit = r * env * (16.0 - b) * 0.008;
    const ditherNoise = r * d * Math.max(stepSize * 0.85, 0.015);
    const noisy = preQuant + sigFollowGrit + ditherNoise;

    // Uniform mid-tread staircase quantizer
    const q = Math.round(noisy * (steps * 0.5)) / (steps * 0.5);
    return clamp(q, -1.0, 1.0);
}

// Section 2: Sample-Rate Reduction (S&H vs Filtered) + Clock Jitter
function computeEffectiveSrRatio(targetHz, sr, jitterAmt, randBipolar) {
    const safeSr = Math.max(sr || 44100, 1);
    const baseRatio = clamp(targetHz / safeSr, 100 / safeSr, 1.0);
    const jit = clamp(jitterAmt, 0.0, 1.0) * (randBipolar || 0.0) * 0.65;
    return clamp(baseRatio * Math.pow(2.0, jit), 0.001, 1.0);
}

// Section 3: Perceptual Codec Masking Gate (spectral holes + packet starvation + birdies)
function computeCodecBandGain(bandEnv, avgEnv, damageAmt, birdieMod) {
    const dmg = clamp(damageAmt, 0.0, 1.0);
    if (dmg <= 0.0001) return 1.0;
    const bMod = clamp(birdieMod || 0.0, -1.0, 1.0);
    const starveZone = clamp((dmg - 0.62) / 0.38, 0.0, 1.0);
    const starveCurve = starveZone * starveZone * (3.0 - 2.0 * starveZone);
    const glitchBurst = Math.abs(bMod) > 0.88 ? (1.8 + starveCurve * 6.5) : 1.0;
    const effEnv = bandEnv * glitchBurst;
    const thresh = Math.max(avgEnv * (0.35 + dmg * 1.85 + starveCurve * 5.0), 0.002);
    const ratio = effEnv / Math.max(thresh, 0.0001);
    // Spectral hole: sub-bands below psychoacoustic masking threshold drop out
    let holeGain = ratio < 1.0 ? Math.pow(ratio, 1.0 + dmg * 6.0 + starveCurve * 8.0) : 1.0;
    const scaleSteps = Math.max(2.0, 20.0 - dmg * 17.0);
    holeGain = Math.round(holeGain * scaleSteps) / scaleSteps;
    // Above 70% damage, stochastic packet starvation silences most frames except isolated birdie glitches
    const dropCeil = dmg * dmg * 0.90;
    const packetAlive = dmg > 0.65 ? clamp((Math.abs(bMod) - dropCeil) / Math.max(1.0 - dropCeil, 0.05), 0.0, 1.0) : 1.0;
    const birdie = 1.0 + bMod * dmg * 0.45;
    return clamp(holeGain * packetAlive * birdie, 0.0, 1.35);
}

// Section 4: Telecom Companding (u-Law, A-Law, ADPCM, GSM)
function processTelecomSample(x, mode, lineAmt, prevPred) {
    const m = clamp(Math.round(mode || 0), 0, 3);
    const amt = clamp(lineAmt, 0.0, 1.0);
    const sgn = x >= 0 ? 1.0 : -1.0;
    const ax = clamp(Math.abs(x), 0.0, 1.0);
    const qSteps = Math.max(4.0, Math.round(64.0 - amt * 56.0));

    if (m === 0) {
        // u-Law (mu = 255) logarithmic compander
        const mu = 255.0;
        const comp = sgn * (Math.log(1.0 + mu * ax) / Math.log(1.0 + mu));
        const qComp = Math.round(comp * qSteps) / qSteps;
        const expand = (qComp >= 0 ? 1.0 : -1.0) * ((Math.pow(1.0 + mu, Math.abs(qComp)) - 1.0) / mu);
        return clamp(x * (1.0 - amt * 0.85) + expand * (amt * 0.85), -1.0, 1.0);
    }
    if (m === 1) {
        // A-Law (A = 87.6) European telephone compander
        const A = 87.6;
        const lnA = 1.0 + Math.log(A);
        const comp = ax < (1.0 / A)
            ? sgn * (A * ax) / lnA
            : sgn * (1.0 + Math.log(A * ax)) / lnA;
        const qComp = Math.round(comp * qSteps) / qSteps;
        const aq = Math.abs(qComp);
        const expand = (qComp >= 0 ? 1.0 : -1.0) * (
            aq < (1.0 / lnA)
                ? (aq * lnA) / A
                : Math.exp(aq * lnA - 1.0) / A
        );
        return clamp(x * (1.0 - amt * 0.85) + expand * (amt * 0.85), -1.0, 1.0);
    }
    if (m === 2) {
        // IMA ADPCM differential slope-overload & step quantization
        const prev = clamp(prevPred || 0.0, -1.0, 1.0);
        const maxSlew = Math.max(0.025, 0.45 - amt * 0.40);
        const diff = clamp(x - prev, -maxSlew, maxSlew);
        const step = maxSlew / 3.5;
        const qDiff = Math.round(diff / Math.max(step, 0.002)) * step;
        const adpcm = clamp(prev * 0.94 + qDiff, -1.0, 1.0);
        // Blend by amt so Line = 0% is identity (matches u-Law/A-Law and gen~ telActive gate)
        return clamp(x * (1.0 - amt * 0.85) + adpcm * (amt * 0.85), -1.0, 1.0);
    }
    // Mode 3: GSM 06.10 RPE-LTP coarse block pulse quantization + nasal harmonic clip
    const gsmGrid = Math.max(3.0, 24.0 - amt * 20.0);
    const pulsed = Math.round(Math.tanh(x * (1.4 + amt * 2.2)) * gsmGrid) / gsmGrid;
    return clamp(x * (1.0 - amt * 0.85) + pulsed * (amt * 0.85), -1.0, 1.0);
}

// Section 5: FFT Spectral Glitch helper for UI & test simulation (4 modes: 0=Den, 1=Scr, 2=Spl, 3=Cmb)
function computeFftGlitchBands(bands, mode, glitchAmt, phaseVal) {
    const m = clamp(Math.round(mode || 0), 0, 3);
    const g = clamp(glitchAmt, 0.0, 1.0);
    const n = bands.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const raw = bands[i] || 0;
        let mod = raw;
        if (m === 0) {
            // Denoise: musical-noise spectral gate (identity at g=0)
            const bubble = raw > 0.35 ? raw * (1.0 + 0.35 * g) : raw * (1.0 - g * 0.95);
            mod = clamp(bubble, 0.0, 1.2);
        } else if (m === 1) {
            // Bin Scramble: permute spectral bins
            const srcIdx = (i * 3 + Math.floor(phaseVal * 5)) % n;
            mod = raw * (1.0 - g) + (bands[srcIdx] || 0) * g;
        } else if (m === 2) {
            // Phase Splat: dispersive allpass smear across adjacent bins
            const prev = bands[(i + n - 1) % n] || 0;
            const next = bands[(i + 1) % n] || 0;
            mod = raw * (1.0 - g * 0.65) + (prev + next) * 0.5 * (g * 0.85);
        } else {
            // Spectral Contrast / Comb: winner-take-all bin gating (identity at g=0)
            const comb = (i % 2 === 0) ? raw * (1.0 + 0.45 * g) : raw * (1.0 - g * 0.95);
            mod = clamp(comb, 0.0, 1.2);
        }
        out[i] = clamp(mod, 0.0, 1.2);
    }
    return out;
}

// Export through a local so this file stays a global script for the type checker (see AGENTS.md 1c).
var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        DEG_STATE_VERSION,
        SCOPE_FLOATS,
        SCOPE_COLS,
        STAGE_COUNT,
        DEFAULT_ORDER,
        STAGE_META,
        TELE_MODES,
        FFT_MODES,
        SR_MODES,
        clamp,
        wrapVal,
        dbToLin,
        linToDb,
        normalizeOrder,
        moveStageInOrder,
        encodeOrderCode,
        decodeOrderCode,
        processBitSample,
        computeEffectiveSrRatio,
        computeCodecBandGain,
        processTelecomSample,
        computeFftGlitchBands,
    };
}
