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
function computeGateFactor(env, gateLin) {
    const g = Math.max(gateLin, MIN_ENV_FLOOR);
    const lo = g * 0.5;
    const hi = g * 1.41421356;
    if (env <= lo) return 0;
    if (env >= hi) return 1;
    const t = (env - lo) / Math.max(hi - lo, MIN_ENV_FLOOR);
    return t * t * (3 - 2 * t);
}

// Reciprocal gain multiplier:
//   amount = 0   -> unity gain (1.0) when above gate
//   amount = 1   -> ceilingLin / env (flat output at ceilingLin)
//   amount = 1.5 -> ceilingLin * env^(-1.5) (quiet details boosted above loud peaks)
// Smoothly muted by the gate when env falls below gateLin.
function computeRecipGain(env, amount, gateDb, ceilingDb) {
    const p = clamp(amount, 0, 1.5);
    const gateLin = dbToLin(clamp(gateDb, -72, -6));
    const ceilLin = dbToLin(clamp(ceilingDb, -18, 0));
    const gate = computeGateFactor(env, gateLin);
    if (gate <= 0) return 0;
    const safeEnv = Math.max(env, gateLin * 0.5, MIN_ENV_FLOOR);
    const rawRecip = Math.pow(safeEnv, -p);
    const over = Math.max(p - 1.0, 0.0);
    const targetScale = Math.pow(ceilLin, Math.min(p, 1.0)) * Math.pow(0.05, over);
    const gain = Math.min(rawRecip * targetScale, MAX_GAIN_LIN) * gate;
    return gain;
}

// Output limiter: softclip == 1 applies smooth tanh saturation to ceilingLin;
// softclip == 0 clamps hard to [-ceilingLin, +ceilingLin].
function applyCeiling(x, ceilingLin, softclip) {
    const c = Math.max(ceilingLin, 0.05);
    if (softclip > 0.5) {
        return c * Math.tanh(x / c);
    }
    return clamp(x, -c, c);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
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
