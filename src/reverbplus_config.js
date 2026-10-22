// Shared Reverb+ math, telemetry / header layouts, pairing helpers and the IR pipeline.
// Prepended into the Start engine, every Start face and the End face at build time, and exported for
// the Node tests (tests/test_reverbplus.js). Pure functions only (no Max objects at load time).

const RP_ALGOS = ["Plate", "Hall", "Room", "Chamber", "Spring", "Convolution"];
const RP_ALGO = { PLATE: 0, HALL: 1, ROOM: 2, CHAMBER: 3, SPRING: 4, CONV: 5 };

// Parameters that do not apply to an algorithm (a face greys them; the audio path ignores them).
const RP_INACTIVE = {
    0: ["bassmult", "xover", "erlevel", "irstretch", "irstart", "irreverse", "irdecay"],
    1: ["irstretch", "irstart", "irreverse", "irdecay"],
    2: ["irstretch", "irstart", "irreverse", "irdecay"],
    3: ["irstretch", "irstart", "irreverse", "irdecay"],
    4: ["bassmult", "xover", "erlevel", "irstretch", "irstart", "irreverse", "irdecay"],
    5: ["size", "decay", "diffusion", "bassmult", "xover", "modrate", "moddepth", "erlevel", "freeze"],
};

// Convolution: two uniform-partition stages (head: short blocks for the first 4096 samples, tail: long
// blocks for the rest). See src/reverbplus_conv.genexpr.
const RP_CONV = {
    P1: 128, N1: 256, NB1: 129, HEAD_PARTS: 32, H: 4096,
    P2: 2048, N2: 4096, NB2: 2049, TAIL_MAX: 140,
    LAT: 256, // samples the whole engine delays the wet by (2 * P1); hidden inside the pre-delay
};
RP_CONV.HEAD_FLOATS = RP_CONV.HEAD_PARTS * RP_CONV.NB1 * 4;
RP_CONV.BANK_FLOATS = RP_CONV.HEAD_FLOATS + RP_CONV.TAIL_MAX * RP_CONV.NB2 * 4;
RP_CONV.IRSPEC_SAMPS = 2 * RP_CONV.BANK_FLOATS;
const RP_IR_MAX = RP_CONV.H + RP_CONV.TAIL_MAX * RP_CONV.P2; // 290816 samples (6.06 s at 48 kHz)
const RP_IR_VIEW_N = 512;
// buffer ---rpirview (2048 samples): 0 version, 1 length, 2 sr, 3 channels, 16.. env (512), 528.. min/max (1024)

// buffer~ ---rphdr (shared Start <-> End header, 64 samples). Layout comment in reverbplus_start.genexpr.
const RP_HDR = {
    CS: 0, CE: 1, K: 2, B: 3, L: 4, WET: 5, DUCK: 6, END_WET_PK: 12, FREEZE: 13, START_SEES: 14, END_SEES: 15,
    END_DUCK: 16, END_OUT_L: 17, CALIBRATED: 18, END_OUT_R: 19,
    DIAG_START_LO: 20, DIAG_START_HI: 21, DIAG_END_LO: 22, DIAG_END_HI: 23, DIAG_WINDOWS: 24, LAT_JS: 30,
    IR_VER: 32, IR_BANK: 33, IR_NHEAD: 34, IR_NTAIL: 35, IR_LEN: 36, IR_LOADED: 37, IR_CH: 38, IR_SRMIS: 39,
    DUCK_REL: 40, OUT_GAIN: 41,
};

// buffer~ ---rpscope (Start telemetry, written every 64 samples by the Start gen).
const RP_SCOPE = {
    FRAMES: 0, SR: 1, ALGO: 2, FREEZE: 3, PAIRED: 4, B: 5, L: 6, K: 7, MIN_MS: 8, LOOP_MS: 9, PREDELAY_MS: 10,
    CLAMPED: 11, IN_PK: 12, ASLEEP: 13, WET_PK: 14, RET_PK: 15, CLIP_DB: 18,
    RT60_LO: 22, RT60_MID: 23, RT60_HI: 24,
    IR_LOADED: 25, IR_LEN: 26, IR_VER: 27, IR_SRMIS: 28,
    ALGO_STATE: 29, LOOP_GAIN: 30, TANK_RT: 31,
    MUTE_N: 32, MUTE_L: 33, MUTE_B: 34, MUTE_K: 35, GLINK: 36,
};
const RP_SCOPE_SAMPS = 64;
// buffer~ ---rpscopeE (End telemetry, 32 samples)
const RP_ESCOPE = { LINKED: 0, K: 1, L: 2, WET_PK: 4, DRY_PK: 5, DUCK: 6, FRAMES: 7, B: 8, OUT_L: 9, OUT_R: 10 };
const RP_ESCOPE_SAMPS = 32;
// buffer~ ---rpspec: 0 write head (0..4095), 1 sr, 2 / 3 wet / dry peak, then two mono rings of 4096:
// 32.. wet (what leaves the Start), 4128.. dry (the input)
const RP_SPEC = { HEAD: 0, SR: 1, WET_PK: 2, DRY_PK: 3, WET: 32, DRY: 4128, N: 4096 };
const RP_SPEC_SAMPS = 32 + 2 * 4096;

const RP_BUS_NAME = "reverbplus_bus";
const RP_REG_STALE_MS = 3000;
const RP_PREDELAY_MAX_MS = 500;

// Live theme colours (Max for Live dynamic colours), with a fallback outside Live.
function rpTheme(name, fallback) {
    try {
        if (typeof max !== "undefined" && max.getcolor) {
            const c = max.getcolor(name);
            if (c && c.length >= 3) return [c[0], c[1], c[2], c.length > 3 ? c[3] : 1];
        }
    } catch (e) {}
    return fallback;
}

// Redraw a display when Live's theme changes (checked once a second, even while idle).
var rpOnThemeChange = null;
function rpThemeWatch() {
    if (typeof Task === "undefined" || typeof mgraphics === "undefined") return null;
    let last = "";
    const t = new Task(function () {
        const k = String(rpTheme("live_lcd_bg", [0, 0, 0, 1])) + String(rpTheme("live_display_line_one", [0, 0, 0, 1]))
            + String(rpTheme("live_surface_bg", [0, 0, 0, 1])) + String(rpTheme("live_control_selection", [0, 0, 0, 1]));
        if (k !== last) {
            last = k;
            mgraphics.redraw();
            if (typeof rpOnThemeChange === "function") rpOnThemeChange();
        }
    });
    t.interval = 1000;
    t.repeat();
    return t;
}

function rpClamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function rpIndex(i, n) {
    return rpClamp(Math.round(Number(i) || 0), 0, n - 1);
}

function rpLinDb(v) {
    return 20 * Math.log10(Math.max(v, 1e-12));
}

/**
 * Per-pass gain of a loop of `delaySamples` that decays 60 dB in `rt60` seconds.
 * @param {number} delaySamples
 * @param {number} rt60  seconds
 * @param {number} sr
 */
function rpLineGain(delaySamples, rt60, sr) {
    return Math.pow(10, -3 * (delaySamples / sr) / Math.max(rt60, 1e-3));
}

// Size 0..1 -> scale of every line length (mirrors `sz` in the Start gen).
function rpSizeScale(size01) {
    return 0.4 + 1.2 * rpClamp(size01, 0, 1);
}

// Shortest loop the outer FX loop can honour: one return slice (B) + chain latency (L) + margin.
function rpMinLoopSamples(B, L) {
    return B + L + 4;
}

/**
 * Effective outer-loop period in samples: the derived period, never below MIN (mirrors the Start gen).
 * @param {number} wantSamples  derived period (rpLoopPeriod)
 * @returns {{samples: number, minSamples: number, clamped: boolean, ms: number, minMs: number}}
 */
function rpEffectiveLoop(wantSamples, B, L, sr) {
    const minS = rpMinLoopSamples(B, L);
    const maxS = Math.floor(2 * sr);
    const s = rpClamp(Math.max(wantSamples, minS), 1, maxS);
    return { samples: s, minSamples: minS, clamped: wantSamples < minS, ms: s * 1000 / sr, minMs: minS * 1000 / sr };
}

// Where the loop return is read from the loop ring: it arrived B + L samples after it left, so it
// waits `period - B - L` more samples (the period lands exactly on the loop time).
function rpLoopReadDelay(periodSamples, B, L) {
    return periodSamples - B - L;
}

// ---- the derived outer loop (the user sets neither its time nor its amount) -----------------------------------------
// Line lengths at 48 kHz of the tank algorithms (mirror the layout in the Start gen).
const RP_TANK_LINES = {
    hall: [1031, 1327, 1559, 1823, 2087, 2293, 2531, 2791, 3067, 3323, 3571, 3833, 4093, 4339, 4591, 4861],
    room: [263, 349, 433, 521, 617, 709, 811, 919],
    chamber: [541, 673, 811, 953, 1103, 1249, 1399, 1553],
    plateL: [672, 4453, 1800, 3720], // at 29761 Hz, x 0.75 x Size scale
    plateR: [908, 4217, 2656, 3163],
    spring: [1536, 2104],
};
const RP_LOOP = {
    TANK_FRAC: 0.3,            // while an End is paired the tank runs at Decay x TANK_FRAC; the recirculating chain loop carries the rest of the tail
    G_MAX: 0.97,               // the loop gain never exceeds this (Decay 60 s would ask for 0.997)
    K: [0.3, 1.25, 6, 3.5, 1.5], // period = K x the tank's characteristic period (Plate, Hall, Room, Chamber, Spring); Spring's K is not an
                                 // integer: its two loops would line up with an integer loop time and reinforce every resonance alike
    MAX_S: 0.25,               // longest derived period, seconds
    SPRING_AP: 48,             // the spring's dispersion allpass chain counts as that many samples of loop
    CONV_FRAC: 0.15, CONV_MIN_S: 0.04, CONV_MAX_S: 0.15, // Convolution: 15 % of the IR length, 40..150 ms
    // The recirculating path (return from End -> delay -> 4 Schroeder allpasses per channel -> HF damping -> bass shelf -> gain g -> clip -> back
    // into the chain input). Its magnitude is flat: allpasses are exactly unity, the damping one-pole has |H| <= 1 and the bass shelf at most
    // g^(1/bass - 1), so |loop| <= g max(1, bass shelf) <= g^(1/bass) < 1 at every frequency for a unity chain.
    AP_LEN_L: [149, 233, 367, 523], AP_LEN_R: [163, 257, 389, 547], // samples at 48 kHz (x min(sr / 48000, 2))
    AP_GAIN_MIN: 0.3, AP_GAIN_SPAN: 0.4, // allpass coefficient = 0.3 + 0.4 x Diffusion
};
function rpMean(a) {
    let t = 0;
    for (let i = 0; i < a.length; i++) t += a[i];
    return t / a.length;
}

/**
 * The tank's characteristic period in samples: the mean line length (Hall / Room / Chamber), the mean Plate
 * branch loop, the mean spring loop; Convolution has none (its loop time comes from the IR length).
 * @param {number} algo
 * @param {number} size01  Size 0..1
 * @param {number} sr
 */
function rpTankPeriod(algo, size01, sr) {
    const szS = rpSizeScale(size01);
    const sfc = Math.min(sr / 48000, 2);
    const psr = Math.min(sr / 29761, 3.3);
    if (algo === RP_ALGO.HALL) return rpMean(RP_TANK_LINES.hall) * sfc * szS;
    if (algo === RP_ALGO.ROOM) return rpMean(RP_TANK_LINES.room) * sfc * szS;
    if (algo === RP_ALGO.CHAMBER) return rpMean(RP_TANK_LINES.chamber) * sfc * szS;
    if (algo === RP_ALGO.PLATE) {
        const sum = (a) => a.reduce((t, v) => t + v, 0) * psr * szS * 0.75;
        return (sum(RP_TANK_LINES.plateL) + sum(RP_TANK_LINES.plateR)) * 0.5;
    }
    if (algo === RP_ALGO.SPRING) return rpMean(RP_TANK_LINES.spring) * sfc * szS + RP_LOOP.SPRING_AP;
    return 0;
}

/**
 * Derived outer-loop period in samples (before the MIN clamp), rounded like the gen.
 * @param {number} algo
 * @param {number} size01
 * @param {number} sr
 * @param {number} irLenSamples  processed IR length (Convolution)
 */
function rpLoopPeriod(algo, size01, sr, irLenSamples) {
    let want;
    if (algo === RP_ALGO.CONV) want = rpClamp(RP_LOOP.CONV_FRAC * (irLenSamples || 0), RP_LOOP.CONV_MIN_S * sr, RP_LOOP.CONV_MAX_S * sr);
    else want = RP_LOOP.K[rpIndex(algo, 5)] * rpTankPeriod(algo, size01, sr);
    return Math.floor(rpClamp(want, 0, RP_LOOP.MAX_S * sr) + 0.5);
}

/**
 * RT60 the tank itself runs at: Decay x (1 - TANK_SHARE) while an End is paired (the loop provides the rest), Decay
 * otherwise and for Convolution (the IR cannot be shortened).
 */
function rpTankRt60(algo, decay, paired) {
    const rt = rpClamp(decay, 0.1, 60);
    return algo === RP_ALGO.CONV || !paired ? rt : rt * RP_LOOP.TANK_FRAC;
}

/**
 * Per-pass gain of the recirculating chain loop: 10^(-3 T / RT60), so the tail that goes round the chain decays 60 dB in Decay.
 * Convolution's reference is half the processed IR length (min 0.1 s). Capped at G_MAX.
 * @param {number} algo
 * @param {{decay: number}} p
 * @param {number} periodSamples  the loop time in use (>= MIN)
 * @param {number} sr
 * @param {number} irLenSamples  Convolution only
 */
function rpLoopGain(algo, p, periodSamples, sr, irLenSamples) {
    const a = rpIndex(algo, 6);
    const rt = a === RP_ALGO.CONV ? Math.max(0.5 * (irLenSamples || 0) / sr, 0.1) : rpClamp(p.decay, 0.1, 60);
    return Math.min(rpLineGain(periodSamples + rpLoopApDelay(sr), rt, sr), RP_LOOP.G_MAX);
}

/** Effective extra loop time of the allpass chain in samples: 1.5 x the mean of the two channels' summed lengths (the mean group delay is the sum itself; the smear of each recirculation lengthens the measured decay a further half of it). */
function rpLoopApDelay(sr) {
    const sum = (a) => a.reduce((t, v) => t + v, 0);
    const sfc = Math.min(sr / 48000, 2);
    return 0.75 * (sum(RP_LOOP.AP_LEN_L.map((v) => Math.floor(v * sfc + 0.5))) + sum(RP_LOOP.AP_LEN_R.map((v) => Math.floor(v * sfc + 0.5))));
}

/** Energy scale of the tank wet entering the chain while paired, so the wet's total energy (first pass + all recirculations, 1 / (1 - g^2)) stays that of the tank alone. */
function rpLoopWetScale(g) {
    return Math.sqrt(Math.max(1 - g * g, 0));
}

/** Gain of the bass shelf in the loop (FDN algorithms only): the low band decays `bass` times slower, g_low = g^(1/bass). */
function rpLoopBassShelf(algo, g, bass) {
    return algo === RP_ALGO.HALL || algo === RP_ALGO.ROOM || algo === RP_ALGO.CHAMBER ? Math.pow(g, 1 / rpClamp(bass, 0.25, 4) - 1) : 1;
}

/** Allpass coefficient of the loop diffusers for a Diffusion 0..1. */
function rpLoopApGain(diffusion) {
    return RP_LOOP.AP_GAIN_MIN + RP_LOOP.AP_GAIN_SPAN * rpClamp(diffusion, 0, 1);
}

/**
 * Magnitude of the loop's transfer (without the chain) at normalised frequency w (rad / sample): g x shelf x damping x allpasses.
 * Used by the tests: it must be <= g max(1, shelf) at every frequency.
 */
function rpLoopMagnitude(w, g, apGain, apLens, dampCoef, shelf, shelfCoef) {
    let re = 1, im = 0;
    for (const D of apLens) { // (-a + z^-D) / (1 - a z^-D)
        const c = Math.cos(w * D), s = -Math.sin(w * D);
        const nr = -apGain + c, ni = s, dr = 1 - apGain * c, di = -apGain * s;
        const den = dr * dr + di * di;
        const hr = (nr * dr + ni * di) / den, hi = (ni * dr - nr * di) / den;
        const t = re * hr - im * hi;
        im = re * hi + im * hr;
        re = t;
    }
    if (dampCoef > 0) { // one-pole lowpass y += c (x - y): c / (1 - (1 - c) z^-1)
        const dr = 1 - (1 - dampCoef) * Math.cos(w), di = (1 - dampCoef) * Math.sin(w);
        const den = dr * dr + di * di;
        const hr = dampCoef * dr / den, hi = -dampCoef * di / den;
        const t = re * hr - im * hi;
        im = re * hi + im * hr;
        re = t;
    }
    if (shelfCoef > 0) { // y = x + (shelf - 1) lowpass(x)
        const dr = 1 - (1 - shelfCoef) * Math.cos(w), di = (1 - shelfCoef) * Math.sin(w);
        const den = dr * dr + di * di;
        const lr = shelfCoef * dr / den, li = -shelfCoef * di / den;
        const hr = 1 + (shelf - 1) * lr, hi = (shelf - 1) * li;
        const t = re * hr - im * hi;
        im = re * hi + im * hr;
        re = t;
    }
    return g * Math.hypot(re, im);
}

// Pre-delay in ms actually in use: Convolution cannot go below its engine latency (hidden in the pre-delay).
function rpEffectivePredelayMs(algo, pdMs, sr) {
    const pd = rpClamp(pdMs, 0, RP_PREDELAY_MAX_MS);
    return algo === RP_ALGO.CONV ? Math.max(pd, RP_CONV.LAT * 1000 / sr) : pd;
}

/**
 * RT60 (seconds) per band as the tank is set: low (below the crossover), mid, high (10 kHz, from the
 * HF damping one-pole). Mirrors the telemetry the Start gen writes.
 */
function rpRt60Bands(p) {
    const algo = rpIndex(p.algo, RP_ALGOS.length);
    const decay = rpClamp(p.decay, 0.1, 60);
    const lo = algo === RP_ALGO.HALL || algo === RP_ALGO.ROOM || algo === RP_ALGO.CHAMBER ? decay * rpClamp(p.bassmult, 0.25, 4) : decay;
    // above HF Damping a line decays up to 5x faster (the HF shelf of the FDN lines); at 10 kHz the shelf is mostly there
    const hiRatio = 0.2 + 0.8 / (1 + Math.pow(10000 / rpClamp(p.damp, 1000, 20000), 2));
    return { low: lo, mid: decay, high: decay * hiRatio };
}

function rpFormatMs(ms) {
    if (ms >= 1000) return (ms / 1000).toFixed(2) + " s";
    if (ms >= 100) return ms.toFixed(0) + " ms";
    return ms.toFixed(1) + " ms";
}

function rpFormatHz(hz) {
    return hz >= 1000 ? (hz / 1000).toFixed(hz >= 10000 ? 1 : 2) + " kHz" : hz.toFixed(0) + " Hz";
}

function rpFormatSec(s) {
    return s >= 10 ? s.toFixed(1) + " s" : s.toFixed(2) + " s";
}

// ---- pairing helpers (copied from Delay+, roles "start" / "end") -----------------------------------

function rpParseDevicePath(path) {
    const s = String(path || "").replace(/"/g, "").trim();
    const m = s.match(/^(.*) devices (\d+)$/);
    if (!m) return null;
    return { parent: m[1], index: parseInt(m[2], 10) };
}

function rpFindPartner(roles, self) {
    const role = roles[self];
    if (role === "start") {
        let depth = 0;
        for (let i = self + 1; i < roles.length; i++) {
            if (roles[i] === "start") depth++;
            else if (roles[i] === "end") {
                if (depth === 0) return i;
                depth--;
            }
        }
    } else if (role === "end") {
        let depth = 0;
        for (let i = self - 1; i >= 0; i--) {
            if (roles[i] === "end") depth++;
            else if (roles[i] === "start") {
                if (depth === 0) return i;
                depth--;
            }
        }
    }
    return -1;
}

function rpChainLatency(latencies, a, b) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    let sum = 0;
    for (let i = lo + 1; i < hi; i++) sum += Math.max(0, Math.round(Number(latencies[i]) || 0));
    return sum;
}

/**
 * Latency of one device in samples, counting what is inside a rack (a rack counts as its longest
 * chain; Live reports 0 as the rack's own latency).
 * @param {{lat?: number, chains?: Array<Array<any>>}} node
 * @returns {number}
 */
function rpDeviceLatency(node) {
    let lat = Math.max(0, Math.round(Number(node && node.lat) || 0));
    const chains = node && Array.isArray(node.chains) ? node.chains : [];
    for (let c = 0; c < chains.length; c++) {
        let sum = 0;
        for (let d = 0; d < chains[c].length; d++) sum += rpDeviceLatency(chains[c][d]);
        lat = Math.max(lat, sum);
    }
    return lat;
}

function rpExtractIds(arr) {
    const ids = [];
    const a = Array.isArray(arr) ? arr : [];
    for (let i = 0; i < a.length; i++) {
        if (a[i] === "id" && i + 1 < a.length) ids.push(Number(a[++i]));
    }
    return ids;
}

function rpRoleOf(reg, id, now) {
    const e = reg ? reg[id] : null;
    if (!e || now - e.t > RP_REG_STALE_MS) return null;
    return e.role;
}

// ---- FFT and the IR pipeline ----------------------------------------------------------------------

const rpTwiddles = {};
/**
 * In-place radix-2 FFT (forward e^-j, inverse e^+j without scaling).
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @param {number} n  power of two
 * @param {boolean} [inverse]
 */
function rpFft(re, im, n, inverse) {
    let tw = rpTwiddles[n];
    if (!tw) {
        tw = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
        for (let k = 0; k < n / 2; k++) {
            tw.c[k] = Math.cos(2 * Math.PI * k / n);
            tw.s[k] = -Math.sin(2 * Math.PI * k / n);
        }
        rpTwiddles[n] = tw;
    }
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    const sg = inverse ? -1 : 1;
    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const step = n / len;
        for (let s = 0; s < n; s += len) {
            for (let k = 0; k < half; k++) {
                const wr = tw.c[k * step];
                const wi = sg * tw.s[k * step];
                const a = s + k;
                const b = a + half;
                const tr = re[b] * wr - im[b] * wi;
                const ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr; im[b] = im[a] - ti;
                re[a] += tr; im[a] += ti;
            }
        }
    }
}

function rpHermite(a, pos) {
    const n = a.length;
    const i = Math.floor(pos);
    const f = pos - i;
    const g = (k) => (k < 0 ? 0 : (k >= n ? 0 : a[k]));
    const xm1 = g(i - 1), x0 = g(i), x1 = g(i + 1), x2 = g(i + 2);
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
}

/**
 * Turn a loaded IR into what the engine convolves with. Order: Reverse, Start trim (% of the IR),
 * Stretch (resample by stretch % and the sample-rate ratio, Hermite), Decay envelope (100 = original,
 * lower = exponential fade reaching -60 dB at that fraction of the IR), length cap (RP_IR_MAX, a
 * 4096-sample fade when truncated), energy normalisation (mean energy of the two channels = 1, so a
 * Dirac stays a Dirac and a typical tail is level-matched to the dry signal).
 * @param {{chans: Array<Float32Array | Float64Array | number[]>, sr: number}} ir  1 or 2 channels
 * @param {{stretch?: number, start?: number, reverse?: boolean, decay?: number}} opts
 * @param {number} devSr
 * @returns {{L: Float64Array, R: Float64Array, len: number, srMismatch: boolean, channels: number}}
 */
function rpIrProcess(ir, opts, devSr) {
    const o = opts || {};
    const stretch = rpClamp(o.stretch === undefined ? 100 : o.stretch, 50, 200) / 100;
    const start = rpClamp(o.start || 0, 0, 50) / 100;
    const dec = rpClamp(o.decay === undefined ? 100 : o.decay, 0, 100);
    const channels = ir.chans.length > 1 ? 2 : 1;
    const out = [];
    for (let c = 0; c < 2; c++) {
        let a = Array.prototype.slice.call(ir.chans[Math.min(c, channels - 1)]);
        if (o.reverse) a.reverse();
        a = a.slice(Math.floor(start * a.length));
        out.push(a);
    }
    const ratio = stretch * devSr / Math.max(ir.sr || devSr, 1);
    let n = Math.max(1, Math.floor(out[0].length * ratio));
    const res = out.map((a) => {
        if (Math.abs(ratio - 1) < 1e-12) return Float64Array.from(a);
        const r = new Float64Array(n);
        for (let i = 0; i < n; i++) r[i] = rpHermite(a, i / ratio);
        return r;
    });
    if (dec < 100) {
        const tau = Math.max(dec, 1) / 100 * n;
        for (const r of res) for (let i = 0; i < n; i++) r[i] *= Math.exp(-6.907755 * i / tau);
    }
    let len = n;
    if (n > RP_IR_MAX) {
        len = RP_IR_MAX;
        const f = Math.min(4096, len >> 2);
        for (const r of res) for (let i = 0; i < f; i++) r[len - f + i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i + 1) / f);
    }
    const L = res[0].slice(0, len);
    const R = res[1].slice(0, len);
    let e = 0;
    for (let i = 0; i < len; i++) e += L[i] * L[i] + R[i] * R[i];
    e *= 0.5;
    const g = e > 1e-20 ? 1 / Math.sqrt(e) : 1;
    for (let i = 0; i < len; i++) { L[i] *= g; R[i] *= g; }
    return { L, R, len, srMismatch: Math.abs((ir.sr || devSr) - devSr) > 0.5, channels };
}

function rpIrCounts(len) {
    return {
        nHead: Math.min(RP_CONV.HEAD_PARTS, Math.ceil(len / RP_CONV.P1)),
        nTail: len > RP_CONV.H ? Math.min(RP_CONV.TAIL_MAX, Math.ceil((len - RP_CONV.H) / RP_CONV.P2)) : 0,
    };
}

/**
 * Spectrum of one partition (offset `off`, `size` samples) of the stereo IR, zero-padded to n = 2 size,
 * as [Lre, Lim, Rre, Rim] for bins 0..n/2 (one packed FFT of L + jR, then unpacked).
 * @param {Float64Array} L
 * @param {Float64Array} R
 * @param {number} off
 * @param {number} size
 * @param {Float32Array} dst
 * @param {number} dstOff
 */
function rpPartitionSpectrum(L, R, off, size, dst, dstOff) {
    const n = 2 * size;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < size && off + i < L.length; i++) { re[i] = L[off + i]; im[i] = R[off + i]; }
    rpFft(re, im, n, false);
    for (let k = 0; k <= n / 2; k++) {
        const nk = (n - k) % n;
        const o = dstOff + k * 4;
        dst[o] = (re[k] + re[nk]) * 0.5;
        dst[o + 1] = (im[k] - im[nk]) * 0.5;
        dst[o + 2] = (im[k] + im[nk]) * 0.5;
        dst[o + 3] = -(re[k] - re[nk]) * 0.5;
    }
}

/**
 * Partition spectra for the engine: head partitions (128-sample) for IR[0, 4096) and tail partitions
 * (2048-sample) for the rest, in the bank layout of buffer ~ ---rpirspec (see RP_CONV).
 * @returns {{head: Float32Array, tail: Float32Array, nHead: number, nTail: number}}
 */
function rpIrSpectra(L, R, len) {
    const c = rpIrCounts(len);
    const head = new Float32Array(c.nHead * RP_CONV.NB1 * 4);
    for (let p = 0; p < c.nHead; p++) rpPartitionSpectrum(L, R, p * RP_CONV.P1, RP_CONV.P1, head, p * RP_CONV.NB1 * 4);
    const tail = new Float32Array(c.nTail * RP_CONV.NB2 * 4);
    for (let q = 0; q < c.nTail; q++) rpPartitionSpectrum(L, R, RP_CONV.H + q * RP_CONV.P2, RP_CONV.P2, tail, q * RP_CONV.NB2 * 4);
    return { head, tail, nHead: c.nHead, nTail: c.nTail };
}

/**
 * Display data of a processed IR: RMS envelope in dB (RP_IR_VIEW_N points over the IR length) and
 * min / max of the mono mix (RP_IR_VIEW_N columns).
 * @returns {{env: Float32Array, wave: Float32Array}}
 */
function rpIrView(L, R, len) {
    const N = RP_IR_VIEW_N;
    const env = new Float32Array(N);
    const wave = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
        const a = Math.floor(i * len / N);
        const b = Math.max(a + 1, Math.floor((i + 1) * len / N));
        let e = 0, mn = 0, mx = 0;
        for (let k = a; k < b && k < len; k++) {
            const m = (L[k] + R[k]) * 0.5;
            e += m * m;
            mn = Math.min(mn, m);
            mx = Math.max(mx, m);
        }
        env[i] = 10 * Math.log10(Math.max(e / (b - a), 1e-12));
        wave[2 * i] = mn;
        wave[2 * i + 1] = mx;
    }
    return { env, wave };
}

// ---- telemetry helpers (faces) ---------------------------------------------------------------------

/**
 * 32 log-spaced bands (40 Hz..18 kHz) of one 4096-sample mono ring from the spectrum buffer, in dB
 * (full-scale sine = 0 dB). `buf` = contents of ---rpspec, which = RP_SPEC.WET or RP_SPEC.DRY.
 * @param {ArrayLike<number>} buf
 * @param {number} which
 * @returns {Float32Array}
 */
function rpSpectrum32(buf, which) {
    const n = RP_SPEC.N;
    const sr = buf[RP_SPEC.SR] || 48000;
    const head = Math.round(buf[RP_SPEC.HEAD]) % n;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
        re[i] = buf[which + (head + i) % n] * w;
    }
    rpFft(re, im, n, false);
    const out = new Float32Array(32);
    const f0 = 40, f1 = Math.min(18000, sr * 0.45);
    for (let b = 0; b < 32; b++) {
        const lo = f0 * Math.pow(f1 / f0, b / 32), hi = f0 * Math.pow(f1 / f0, (b + 1) / 32);
        const k0 = Math.max(1, Math.floor(lo * n / sr)), k1 = Math.max(k0 + 1, Math.ceil(hi * n / sr));
        let m = 0;
        for (let k = k0; k < k1 && k < n / 2; k++) m = Math.max(m, Math.hypot(re[k], im[k]));
        out[b] = rpLinDb(m * 4 / n);
    }
    return out;
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        RP_ALGOS, RP_ALGO, RP_INACTIVE, RP_CONV, RP_IR_MAX, RP_IR_VIEW_N, RP_HDR, RP_SCOPE,
        RP_SCOPE_SAMPS, RP_ESCOPE, RP_ESCOPE_SAMPS, RP_SPEC, RP_SPEC_SAMPS, RP_BUS_NAME,
        RP_REG_STALE_MS, RP_PREDELAY_MAX_MS, RP_LOOP, RP_TANK_LINES,
        rpTheme, rpThemeWatch, rpClamp, rpIndex, rpLinDb, rpLineGain, rpSizeScale, rpMinLoopSamples,
        rpEffectiveLoop, rpLoopReadDelay, rpTankPeriod, rpLoopPeriod, rpTankRt60, rpLoopGain, rpLoopApDelay, rpLoopWetScale, rpLoopBassShelf, rpLoopApGain, rpLoopMagnitude, rpEffectivePredelayMs, rpRt60Bands, rpFormatMs, rpFormatHz, rpFormatSec,
        rpParseDevicePath, rpFindPartner, rpChainLatency, rpDeviceLatency, rpExtractIds, rpRoleOf,
        rpFft, rpIrProcess, rpIrCounts, rpPartitionSpectrum, rpIrSpectra, rpIrView,
        rpSpectrum32,
    };
}
