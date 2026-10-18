// Seeded delay-line configuration for Tiny Space.
// The float layout written into buffer~ #0-tsconfig is the contract with
// src/tinyspace_core.genexpr — keep the indices in sync.

const LINE_COUNT = 20;
const CFG_ACTIVE = 0;
const CFG_CHARACTER = 1;
const CFG_AP_LEN = 2; // 4 allpass lengths, ms
const CFG_AP_GAIN = 6; // 4 allpass gains
const CFG_LEN = 10; // 20 nominal delay times, ms
const CFG_DAMP = 30; // 20 per-line damping offsets
const CFG_MOD = 50; // 20 per-line mod rates, Hz
const CFG_FLOATS = 70;

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71];

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

function buildConfig(seed) {
    const rand = mulberry32(seed >>> 0);
    const activeCount = 4 + Math.floor(rand() * 9) * 2;
    const character = rand();

    // Low character: a few milliseconds (comb). High character: tens of ms (small room).
    const bandMin = 1.15 + (6.0 - 1.15) * character;
    const bandMax = 14.0 + (46.0 - 14.0) * character;
    const lens = [];
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

    const apLens = [];
    const apGain = [];
    for (let i = 0; i < 4; i++) {
        const ms = (0.08 + rand() * 0.3) + character * (0.35 + rand() * 5.2);
        apLens.push(clamp(ms, 0.05, 8));
        apGain.push(clamp(character * (0.22 + rand() * 0.5), 0, 0.7));
    }

    const dampOffset = [];
    const modHz = [];
    for (let i = 0; i < LINE_COUNT; i++) {
        dampOffset.push(rand() * 0.35);
        modHz.push(0.07 + rand() * 3.4);
    }

    return { activeCount, character, apLens, apGain, lens, dampOffset, modHz };
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

// Full feedback falls about 60 dB in 18 seconds. The per-loop coefficient is
// higher for short lines so a 5 ms comb rings about as long as a 40 ms one.
// Matches ringGain() in tinyspace_core.genexpr.
function feedbackGain(knob01, delayMs) {
    const rt = clamp(knob01, 0, 1) * 18;
    if (!(rt >= 0.05)) return 0;
    const secs = Math.max(delayMs, 1000 / 48000) / 1000;
    const g = Math.exp(-6.90775527898 * secs / rt);
    return Math.min(g, 0.99999);
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
    return out;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        LINE_COUNT,
        CFG_ACTIVE,
        CFG_CHARACTER,
        CFG_AP_LEN,
        CFG_AP_GAIN,
        CFG_LEN,
        CFG_DAMP,
        CFG_MOD,
        CFG_FLOATS,
        buildConfig,
        isLineActive,
        sizeScale,
        delayMs,
        feedbackGain,
        configToFloats
    };
}
