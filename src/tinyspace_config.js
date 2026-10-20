// Seeded delay-line configuration for Tiny Space.
// The float layout written into buffer~ #0-tsconfig is the contract with
// src/tinyspace_core.genexpr — keep the indices in sync.

const LINE_COUNT = 20;
const SEED_MAX = 1000;
const CFG_ACTIVE = 0;
const CFG_CHARACTER = 1;
const CFG_AP_LEN = 2; // 4 allpass lengths, ms
const CFG_AP_GAIN = 6; // 4 allpass gains
const CFG_LEN = 10; // 20 nominal delay times, ms
const CFG_DAMP = 30; // 20 per-line damping offsets
const CFG_MOD = 50; // 20 per-line mod rates, Hz
const CFG_MODEL = 70; // Room model index (0..7)
const CFG_FLOATS = 72;

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71];

// 8 selectable acoustic / algorithmic room models:
const CHAR_MODE_COMB   = 0; // Parallel metallic combs
const CHAR_MODE_HYBRID = 1; // Comb-to-Householder blend
const CHAR_MODE_ROOM   = 2; // Diffused Householder small room
const CHAR_MODE_PLATE  = 3; // Dense Hadamard / Velvet plate
const CHAR_MODE_TANK   = 4; // Dattorro-style daisy-chained figure-8 ring loop
const CHAR_MODE_BOX    = 5; // 3D Shoebox room standing-wave eigenmodes (Lx, Ly, Lz)
const CHAR_MODE_SPRING = 6; // Dispersive high-allpass spring / tube chirp
const CHAR_MODE_BOUNCE = 7; // Geometric bouncing-ball reflection cluster

const CHAR_MODES = [
    "COMB",
    "HYBRID",
    "ROOM",
    "PLATE",
    "TANK",
    "BOX",
    "SPRING",
    "BOUNCE"
];

// 20 3D room eigenmode tuples (nx, ny, nz) covering axial, tangential, and oblique modes
const BOX_MODES = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1],
    [1, 1, 0], [1, 0, 1], [0, 1, 1],
    [1, 1, 1], [2, 0, 0], [0, 2, 0], [0, 0, 2],
    [2, 1, 0], [1, 2, 0], [2, 0, 1], [1, 0, 2], [0, 2, 1], [0, 1, 2],
    [2, 1, 1], [1, 2, 1], [1, 1, 2], [2, 2, 1]
];

function mulberry32(seed) {
    let a = seed >>> 0;
    return function rand() {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function buildConfig(seed, charMode) {
    const s = clamp(seed | 0, 0, SEED_MAX);
    const rand = mulberry32(s >>> 0);
    // Lower seeds have fewer delay lines (starting at 4: 2 L + 2 R),
    // and higher seeds scale up monotonically to the 20-line cap (10 L + 10 R).
    const seedNorm = s / SEED_MAX;
    const tier = Math.min(8, Math.floor(seedNorm * 9));
    const activeCount = 4 + tier * 2;
    const rawChar = rand();

    let model = CHAR_MODE_COMB;
    let character = rawChar;
    if (charMode !== undefined && charMode !== null) {
        model = clamp(charMode | 0, 0, CHAR_MODES.length - 1);
        if (model === CHAR_MODE_COMB) {
            character = 0.04 + rawChar * 0.22;
        } else if (model === CHAR_MODE_HYBRID) {
            character = 0.38 + rawChar * 0.26;
        } else if (model === CHAR_MODE_ROOM) {
            character = 0.74 + rawChar * 0.24;
        } else if (model === CHAR_MODE_PLATE) {
            character = 0.85 + rawChar * 0.14;
        } else if (model === CHAR_MODE_TANK) {
            character = 0.65 + rawChar * 0.30;
        } else if (model === CHAR_MODE_BOX) {
            character = 0.55 + rawChar * 0.35;
        } else if (model === CHAR_MODE_SPRING) {
            character = 0.32 + rawChar * 0.28;
        } else {
            character = 0.15 + rawChar * 0.25;
        }
    }

    const lens = [];
    if (model === CHAR_MODE_BOX) {
        // 3D Shoebox Room: derive delay times from physical (Lx, Ly, Lz) standing-wave modes
        const lx = 1.6 + rand() * 2.8;
        const ly = 1.3 + rand() * 2.2;
        const lz = 1.1 + rand() * 1.8;
        const scaleMs = 8.5 + rand() * 5.5;
        for (let i = 0; i < LINE_COUNT; i++) {
            const m = BOX_MODES[i];
            const kNorm = Math.sqrt(
                (m[0] / lx) * (m[0] / lx) +
                (m[1] / ly) * (m[1] / ly) +
                (m[2] / lz) * (m[2] / lz)
            );
            const detune = (i >= 10) ? (1.012 + rand() * 0.03) : (0.988 + rand() * 0.024);
            const ms = (scaleMs / Math.max(0.32, kNorm)) * detune;
            lens.push(clamp(ms, 1.2, 46));
        }
    } else if (model === CHAR_MODE_PLATE) {
        // Velvet / Hadamard Plate: tightly clustered prime delays (2.2 .. 28 ms) for instant density
        const bandMin = 2.0 + rand() * 1.2;
        const bandMax = 22.0 + rand() * 8.0;
        for (let i = 0; i < LINE_COUNT; i++) {
            const t = Math.pow(PRIMES[i] / 71, 0.68);
            const jitter = 0.94 + rand() * 0.12;
            lens.push(clamp((bandMin + (bandMax - bandMin) * t) * jitter, 1.4, 34));
        }
    } else if (model === CHAR_MODE_BOUNCE) {
        // Bouncing-Ball Geometric Cluster: exponential spacing r^k
        const baseL = 1.2 + rand() * 1.6;
        const baseR = baseL * (1.06 + rand() * 0.08);
        const ratio = 1.34 + rand() * 0.09;
        for (let i = 0; i < LINE_COUNT; i++) {
            const k = i % 10;
            const b = (i < 10) ? baseL : baseR;
            const ms = b * Math.pow(ratio, k) * (0.96 + rand() * 0.08);
            lens.push(clamp(ms, 0.9, 48));
        }
    } else if (model === CHAR_MODE_SPRING) {
        // Dispersive Spring / Tube: short resonant tube delays + high allpass chirp
        const bandMin = 1.1 + rand() * 1.4;
        const bandMax = 11.0 + rand() * 9.0;
        for (let i = 0; i < LINE_COUNT; i++) {
            const t = Math.pow(PRIMES[i] / 71, 0.75);
            const jitter = 0.92 + rand() * 0.16;
            lens.push(clamp((bandMin + (bandMax - bandMin) * t) * jitter, 0.9, 26));
        }
    } else {
        // COMB, HYBRID, ROOM, TANK: prime-spaced lines scaled by character
        const bandMin = 1.15 + (6.0 - 1.15) * character;
        const bandMax = 14.0 + (46.0 - 14.0) * character;
        for (let i = 0; i < LINE_COUNT; i++) {
            const t = Math.pow(PRIMES[i] / 71, 0.82);
            const jitter = 0.9 + rand() * 0.22;
            const inharmonic = 1 + 0.013 * ((i * 3) % 7);
            lens.push(clamp((bandMin + (bandMax - bandMin) * t) * jitter * inharmonic, 0.8, 48));
        }
        // Room-leaning seeds always keep one line long enough that Size at maximum
        // reaches about 100 ms (48 ms nominal * sizeScale(1)).
        if (character > 0.65) {
            const target = 36 + character * 12;
            const longest = Math.max.apply(null, lens);
            const gain = target / longest;
            for (let i = 0; i < lens.length; i++) lens[i] = clamp(lens[i] * gain, 0.8, 48);
        }
    }

    const apLens = [];
    const apGain = [];
    for (let i = 0; i < 4; i++) {
        if (model === CHAR_MODE_SPRING) {
            // High-dispersion chirp allpasses
            const ms = 0.55 + i * 0.65 + rand() * 0.85;
            apLens.push(clamp(ms, 0.35, 5.5));
            apGain.push(0.68);
        } else if (model === CHAR_MODE_PLATE) {
            const ms = 0.9 + i * 1.15 + rand() * 1.4;
            apLens.push(clamp(ms, 0.5, 7.5));
            apGain.push(clamp(0.58 + rand() * 0.1, 0, 0.7));
        } else if (model === CHAR_MODE_BOUNCE) {
            const ms = 0.1 + rand() * 0.35;
            apLens.push(clamp(ms, 0.05, 1.2));
            apGain.push(clamp(0.06 + rand() * 0.12, 0, 0.25));
        } else {
            const ms = (0.08 + rand() * 0.3) + character * (0.35 + rand() * 5.2);
            apLens.push(clamp(ms, 0.05, 8));
            apGain.push(clamp(character * (0.22 + rand() * 0.5), 0, 0.7));
        }
    }

    const dampOffset = [];
    const modHz = [];
    for (let i = 0; i < LINE_COUNT; i++) {
        dampOffset.push(rand() * 0.35);
        modHz.push(0.07 + rand() * 3.4);
    }

    return { activeCount, character, model, apLens, apGain, lens, dampOffset, modHz };
}

function isLineActive(index, activeCount) {
    return (index % 10) < (activeCount / 2);
}

// Size knob 0..1. 0.22x is a tight comb; 2.15x puts a 48 ms nominal line near 100 ms.
function sizeScale(size01) {
    return 0.22 + clamp(size01, 0, 1) * 1.93;
}

function delayMs(nominalMs, size01) {
    return nominalMs * sizeScale(size01);
}

// Delay-style RT60 in seconds. The knob is not linear: 50% is a short slap,
// and only the top of the knob opens into a long resonator.
//   0%    0 s
//   25%   ~0.18 s
//   50%   ~0.70 s
//   75%   ~2.7 s
//   90%   ~8.4 s
//   100%  ~27.5 s
// rt = 2.90663 k^2 - 0.81561 k^4 + 7.05921 k^6 - 1.60268 k^10 + 19.9526 k^16
// Matches ringGain() in tinyspace_core.genexpr.
const RT60_C2 = 2.90663;
const RT60_C4 = -0.81561;
const RT60_C6 = 7.05921;
const RT60_C10 = -1.60268;
const RT60_C16 = 19.9526;

function feedbackRt60(knob01) {
    const k = clamp(knob01, 0, 1);
    if (!(k >= 0.001)) return 0;
    const k2 = k * k;
    const k4 = k2 * k2;
    const k6 = k4 * k2;
    const k10 = k6 * k4;
    const k16 = k10 * k6;
    return RT60_C2 * k2 + RT60_C4 * k4 + RT60_C6 * k6 + RT60_C10 * k10 + RT60_C16 * k16;
}

// Per-loop coefficient. Higher for short lines so a 1 ms comb rings about as
// long as a 40 ms one. The room matrix is orthogonal and crossfeed is a
// rotation, so this gain is the whole decay law.
function feedbackGain(knob01, delayMs) {
    const rt = feedbackRt60(knob01);
    if (!(rt > 0)) return 0;
    const secs = Math.max(delayMs, 1000 / 48000) / 1000;
    const g = Math.exp(-6.90775527898 * secs / rt);
    return Math.min(g, 0.9999995);
}

// Amplitude left after `seconds` when feedback is `knob01` and the mix is unitary.
function tailAmplitude(knob01, seconds) {
    const rt = feedbackRt60(knob01);
    if (!(rt > 0)) return 0;
    return Math.exp(-6.90775527898 * seconds / rt);
}

// One-pole lowpass pole for a feedback loop. Damp 0 is a bypass.
// Matches dampCoef() in tinyspace_core.genexpr. On an 8 ms line the cutoff
// is about 5 kHz at 20%, about 1.8 kHz at 50%, and a few hundred hertz at 100%.
function dampPole(delayMs, damp01, offset, sr) {
    const rate = sr > 0 ? sr : 44100;
    const amtIn = clamp(damp01, 0, 1);
    if (!(amtIn >= 0.001)) return 0;
    const off = clamp(offset, 0, 0.35);
    const amt = Math.min(1, amtIn * (0.85 + 0.30 * off));
    const fcBase = 16000 * Math.pow(0.015, Math.pow(Math.max(amt, 0.00001), 0.75));
    const span = Math.max(delayMs * rate / 1000, 1);
    const scale = clamp(Math.pow(0.008 * rate / span, 0.45), 0.6, 3.2);
    const fc = fcBase * scale;
    return Math.min(Math.exp(-6.28318530718 * fc / rate), 0.995);
}

// Plane orthogonal to (1, 1, 1). A rotation here is orthogonal for every angle
// and leaves the all-ones vector fixed, so the output sum is not attenuated.
const SPIN_U = [0.7071067811865476, -0.7071067811865476, 0];
const SPIN_V = [0.40824829046386302, 0.40824829046386302, -0.81649658092772603];
const SPRING_THETA = 1.15;

function spin3(x0, x1, x2, c, s) {
    const x = [x0, x1, x2];
    let pu = 0;
    let pv = 0;
    for (let i = 0; i < 3; i++) {
        pu += x[i] * SPIN_U[i];
        pv += x[i] * SPIN_V[i];
    }
    const f = c - 1;
    const y = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        y[i] = x[i]
            + f * (pu * SPIN_U[i] + pv * SPIN_V[i])
            + s * (pu * SPIN_V[i] - pv * SPIN_U[i]);
    }
    return y;
}

// Unitary 10-line mix for one side of the tank. Mirrors house() in
// tinyspace_core.genexpr. Inactive slots (index >= n) stay 0.
// Every model satisfies M^T M = I and |sum(M 1)| = |sum(1)|, so audible
// decay is exactly feedbackGain / ringGain.
function fdnMix(model, n, character, input) {
    const nn = Math.max(0, Math.min(10, n | 0));
    const z = new Array(10).fill(0);
    for (let i = 0; i < nn; i++) z[i] = +input[i] || 0;
    const modelI = clamp(model | 0, 0, 7);
    const ch = clamp(character, 0, 1);

    let sum = 0;
    for (let i = 0; i < nn; i++) sum += z[i];
    const kk = 2 / Math.max(nn, 1);
    const hh = new Array(10).fill(0);
    for (let i = 0; i < nn; i++) hh[i] = z[i] - sum * kk;

    const hy = z.slice();
    const hc = Math.cos(ch * Math.PI);
    const hs = Math.sin(ch * Math.PI);
    for (let b = 0; b + 2 < nn; b += 3) {
        const r = spin3(hy[b], hy[b + 1], hy[b + 2], hc, hs);
        hy[b] = r[0];
        hy[b + 1] = r[1];
        hy[b + 2] = r[2];
    }

    function cycleNeg(arr) {
        const y = new Array(10).fill(0);
        if (nn < 1) return y;
        y[0] = -arr[nn - 1];
        for (let i = 1; i < nn; i++) y[i] = -arr[i - 1];
        return y;
    }

    function pairNegSwap(arr) {
        const y = new Array(10).fill(0);
        for (let i = 0; i + 1 < nn; i += 2) {
            y[i] = -arr[i + 1];
            y[i + 1] = -arr[i];
        }
        if (nn % 2 === 1) y[nn - 1] = -arr[nn - 1];
        return y;
    }

    function reverseNeg(arr) {
        const y = new Array(10).fill(0);
        for (let i = 0; i < nn; i++) y[i] = -arr[nn - 1 - i];
        return y;
    }

    const sp = z.slice();
    if (nn >= 3) {
        const sc = Math.cos(SPRING_THETA);
        const ss = Math.sin(SPRING_THETA);
        for (let i = 0; i + 2 < nn; i++) {
            const r = spin3(sp[i], sp[i + 1], sp[i + 2], sc, ss);
            sp[i] = r[0];
            sp[i + 1] = r[1];
            sp[i + 2] = r[2];
        }
    } else {
        for (let i = 0; i < nn; i++) sp[i] = -z[i];
    }

    let out = z;
    if (modelI === 1) out = hy;
    else if (modelI === 2) out = hh;
    else if (modelI === 3) out = cycleNeg(hh);
    else if (modelI === 4) out = cycleNeg(z);
    else if (modelI === 5) out = pairNegSwap(hh);
    else if (modelI === 6) out = sp;
    else if (modelI === 7) out = reverseNeg(z);
    return out;
}

function configToFloats(cfg) {
    const out = new Array(CFG_FLOATS).fill(0);
    out[CFG_ACTIVE] = cfg.activeCount;
    out[CFG_CHARACTER] = cfg.character;
    for (let i = 0; i < 4; i++) {
        out[CFG_AP_LEN + i] = cfg.apLens[i];
        out[CFG_AP_GAIN + i] = cfg.apGain[i];
    }
    for (let i = 0; i < LINE_COUNT; i++) {
        out[CFG_LEN + i] = cfg.lens[i];
        out[CFG_DAMP + i] = cfg.dampOffset[i];
        out[CFG_MOD + i] = cfg.modHz[i];
    }
    out[CFG_MODEL] = cfg.model || 0;
    return out;
}

// Export through a local so this file stays a global script for the type checker (see AGENTS.md 1c).
var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        LINE_COUNT,
        SEED_MAX,
        CHAR_MODES,
        CHAR_MODE_COMB,
        CHAR_MODE_HYBRID,
        CHAR_MODE_ROOM,
        CHAR_MODE_PLATE,
        CHAR_MODE_TANK,
        CHAR_MODE_BOX,
        CHAR_MODE_SPRING,
        CHAR_MODE_BOUNCE,
        CFG_ACTIVE,
        CFG_CHARACTER,
        CFG_AP_LEN,
        CFG_AP_GAIN,
        CFG_LEN,
        CFG_DAMP,
        CFG_MOD,
        CFG_MODEL,
        CFG_FLOATS,
        buildConfig,
        isLineActive,
        sizeScale,
        delayMs,
        feedbackRt60,
        feedbackGain,
        tailAmplitude,
        dampPole,
        fdnMix,
        SPRING_THETA,
        configToFloats
    };
}
