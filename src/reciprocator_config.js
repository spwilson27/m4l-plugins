// Shared Reciprocator DSP math & UI helpers.
// Prepended into src/reciprocator_ui.js at build time and exported for Node tests.

const SCOPE_COLS = 120;
const SCOPE_FLOATS = 32; // #0-recipscope buffer size (indices 0..7 hold live telemetry)
const MAX_GAIN_DB = 60.0;
const MAX_GAIN_LIN = 1000.0; // +60 dB cap
const MIN_ENV_FLOOR = 1e-5; // -100 dB safety floor

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function dbToLin(db) {
    return Math.pow(10, db / 20);
}

function linToDb(lin) {
    return 20 * Math.log10(Math.max(lin, 1e-6));
}

// Smooth noise gate factor in [0, 1] with a 6 dB soft knee around gateLin.
// When reverseGate > 0.5 (Reverse Gate / Duck mode), only signals BELOW gateLin
// are allowed through (while dead silence below MIN_ENV_FLOOR * 5 is still muted
// so an empty track does not hiss at 0 dBFS).
function computeGateFactor(env, gateLin, reverseGate = 0) {
    const g = Math.max(gateLin, MIN_ENV_FLOOR);
    const lo = g * 0.5;
    const hi = g * 1.41421356;
    let normalGate;
    if (env <= lo) normalGate = 0;
    else if (env >= hi) normalGate = 1;
    else {
        const t = (env - lo) / Math.max(hi - lo, MIN_ENV_FLOOR);
        normalGate = t * t * (3 - 2 * t);
    }
    if (!(reverseGate > 0.5)) {
        return normalGate;
    }
    // Reverse gate: open below gateLin, closed above gateLin, with a -86 dB floor guard
    const silenceLo = MIN_ENV_FLOOR * 2.0;
    const silenceHi = Math.min(lo * 0.5, MIN_ENV_FLOOR * 25.0);
    let floorGuard = 1.0;
    if (env <= silenceLo) floorGuard = 0.0;
    else if (env < silenceHi) {
        const tf = (env - silenceLo) / Math.max(silenceHi - silenceLo, MIN_ENV_FLOOR);
        floorGuard = tf * tf * (3 - 2 * tf);
    }
    return (1.0 - normalGate) * floorGuard;
}

// Reciprocal gain multiplier:
//   amount = 0   -> unity gain (1.0) when gate is open
//   amount = 1   -> ceilingLin / env (flat output at ceilingLin)
//   amount = 1.5 -> inverted dynamics (quiet details boosted above loud peaks)
// Smoothly gated by computeGateFactor(env, gateLin, reverseGate).
function computeRecipGain(env, amount, gateDb, ceilingDb, reverseGate = 0) {
    const p = clamp(amount, 0, 1.5);
    const gateLin = dbToLin(clamp(gateDb, -72, -6));
    const ceilLin = dbToLin(clamp(ceilingDb, -18, 0));
    const gate = computeGateFactor(env, gateLin, reverseGate);
    if (gate <= 0) return 0;
    const minEnv = reverseGate > 0.5 ? MIN_ENV_FLOOR * 5.0 : Math.max(gateLin * 0.5, MIN_ENV_FLOOR);
    const safeEnv = Math.max(env, minEnv);
    const rawRecip = Math.pow(safeEnv, -p);
    const over = Math.max(p - 1.0, 0.0);
    const targetScale = Math.pow(ceilLin, Math.min(p, 1.0)) * Math.pow(0.05, over);
    const gain = Math.min(rawRecip * targetScale, MAX_GAIN_LIN) * gate;
    return gain;
}

// Output ceiling stage (`outmode`):
//   0 = Soft (`tanh` soft saturation to ceilingLin)
//   1 = Hard (`clip` to [-ceilingLin, +ceilingLin])
//   2 = Lim  (Peak-envelope limiter to ceilingLin)
function applyCeiling(x, ceilingLin, outmode, limEnv = 0) {
    const c = Math.max(ceilingLin, 0.05);
    const m = Math.round(Number(outmode) || 0);
    if (m === 0) {
        return c * Math.tanh(x / c);
    }
    if (m === 1) {
        return clamp(x, -c, c);
    }
    const peak = Math.max(Math.abs(x), limEnv, c);
    return clamp(x * (c / peak), -c, c);
}

// Export through a local so this file stays a global script for the type checker (see AGENTS.md 1c).
var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        SCOPE_COLS,
        SCOPE_FLOATS,
        MAX_GAIN_DB,
        MAX_GAIN_LIN,
        MIN_ENV_FLOOR,
        clamp,
        dbToLin,
        linToDb,
        computeGateFactor,
        computeRecipGain,
        applyCeiling,
    };
}
