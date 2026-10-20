// Shared Delay+ math, telemetry layout and pairing helpers.
// Prepended into the Start / End v8ui scripts at build time and exported for Node tests.

// Tempo-sync divisions, ordered by length. Beats are quarter notes.
const DP_DIVISIONS = [
    ["1/64", 1 / 16], ["1/32T", 1 / 12], ["1/32", 1 / 8], ["1/16T", 1 / 6], ["1/32D", 3 / 16],
    ["1/16", 1 / 4], ["1/8T", 1 / 3], ["1/16D", 3 / 8], ["1/8", 1 / 2], ["1/4T", 2 / 3],
    ["1/8D", 3 / 4], ["1/4", 1], ["1/2T", 4 / 3], ["1/4D", 3 / 2], ["1/2", 2],
    ["1/1T", 8 / 3], ["1/2D", 3], ["1/1", 4], ["2/1", 8], ["4/1", 16],
];
const DP_DIV_DEFAULT = 10; // 1/8D
const DP_TIME_MAX_MS = 8000; // the gen core clips tms here (and to its 524288-sample tank)
const DP_TANK = 524288;

// buffer~ #0-dpscope (Start telemetry, see src/delayplus_start.genexpr)
const DP_SCOPE = {
    TL: 0, TR: 1, CLAMPED: 2, TMIN: 3, B: 4, K: 5, L: 6, PING_L: 7, PAIRED: 8, IN_PK: 9,
    TAP_L: 10, TAP_R: 11, RET_L: 12, RET_R: 13, FRAMES: 14, SR: 15, FREEZE: 16, DUCK: 17,
    WET_PK: 18, HIST_HEAD: 19, TGT_L: 20, TGT_R: 21, DEBUG: 23,
};
const DP_HIST_OFFSET = 32;
const DP_HIST_BLOCKS = 512;
const DP_HIST_BLOCK_SAMPS = 256;
const DP_SCOPE_SAMPS = DP_HIST_OFFSET + 3 * DP_HIST_BLOCKS;
// buffer~ #0-dpscopeE (End telemetry, see src/delayplus_end.genexpr)
const DP_ESCOPE = { LINKED: 0, K: 1, L: 2, PING_L: 3, WET_PK: 4, DRY_PK: 5, DUCK: 6, FRAMES: 7, B: 8, DEBUG: 9 };
const DP_ESCOPE_SAMPS = 32;

const DP_BUS_NAME = "delayplus_bus";
const DP_REG_STALE_MS = 3000;

function dpClamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function dpDivisionIndex(i) {
    return dpClamp(Math.round(Number(i) || 0), 0, DP_DIVISIONS.length - 1);
}

function dpSyncMs(divIndex, bpm) {
    const beats = DP_DIVISIONS[dpDivisionIndex(divIndex)][1];
    return beats * 60000 / dpClamp(Number(bpm) || 120, 20, 999);
}

// Target delay time in ms sent to gen as `tms`.
function dpTargetMs(sync, timeMs, divIndex, bpm) {
    const ms = sync ? dpSyncMs(divIndex, bpm) : Number(timeMs) || 0;
    return dpClamp(ms, 1, DP_TIME_MAX_MS);
}

// Shortest time the tank can honour: one return slice (B) + chain latency (L) + the modulation
// sweep + the 4-sample interpolation margin (mirrors `tmin` in the gen core).
function dpMinTimeSamples(B, L, modDepth01, sr) {
    return B + L + dpClamp(modDepth01, 0, 1) * 0.008 * sr + 4;
}

// Per-channel delay in samples, before clamping. Offset > 0 delays the right channel by
// offset * T, offset < 0 delays the left by |offset| * T (offset is -1..1, the UI shows +-50%
// as -0.5..0.5).
function dpChannelTimes(ms, offset, sr) {
    const base = ms * sr / 1000;
    const o = dpClamp(offset, -1, 1);
    return { L: base * (1 + Math.max(-o, 0)), R: base * (1 + Math.max(o, 0)) };
}

function dpEffectiveTimes(ms, offset, sr, B, L, modDepth01) {
    const t = dpChannelTimes(ms, offset, sr);
    const tmin = dpMinTimeSamples(B, L, modDepth01, sr);
    const tmax = DP_TANK - 8;
    return {
        L: dpClamp(t.L, tmin, tmax),
        R: dpClamp(t.R, tmin, tmax),
        tmin,
        clamped: t.L < tmin || t.R < tmin,
    };
}

// Where Start adds the feedback return in its tank: the tap's original emit position.
// A return read at Start sample s left Start at s - B - L.
function dpReturnWriteIndex(s, B, L) {
    return s - B - L;
}

// Echo n (1-based) arrives n * T after the input, with gain fb^(n-1) times the chain gain^n.
function dpEchoTaps(timeSamples, fb, chainGain, count, sr) {
    const out = [];
    let g = chainGain;
    for (let n = 1; n <= count; n++) {
        out.push({ n, ms: n * timeSamples * 1000 / sr, gain: g });
        g *= fb * chainGain;
    }
    return out;
}

// LOM path helpers: ".. chains C devices D" -> chain path + device index.
function dpParseDevicePath(path) {
    const s = String(path || "").replace(/"/g, "").trim();
    const m = s.match(/^(.*) devices (\d+)$/);
    if (!m) return null;
    return { parent: m[1], index: parseInt(m[2], 10) };
}

// Pairs Starts and Ends in one device list like brackets: roles[i] is "start", "end" or null.
// Returns the partner index of roles[self] or -1.
function dpFindPartner(roles, self) {
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

// Sum of the latencies of the devices strictly between a and b.
function dpChainLatency(latencies, a, b) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    let sum = 0;
    for (let i = lo + 1; i < hi; i++) sum += Math.max(0, Math.round(Number(latencies[i]) || 0));
    return sum;
}

// `get("devices")` returns ["id", 4, "id", 5, ...].
function dpExtractIds(arr) {
    const ids = [];
    const a = Array.isArray(arr) ? arr : [];
    for (let i = 0; i < a.length; i++) {
        if (a[i] === "id" && i + 1 < a.length) ids.push(Number(a[++i]));
    }
    return ids;
}

function dpRoleOf(reg, id, now) {
    const e = reg ? reg[id] : null;
    if (!e || now - e.t > DP_REG_STALE_MS) return null;
    return e.role;
}

function dpFormatMs(ms) {
    if (ms >= 1000) return (ms / 1000).toFixed(2) + " s";
    if (ms >= 100) return ms.toFixed(0) + " ms";
    return ms.toFixed(1) + " ms";
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        DP_DIVISIONS, DP_DIV_DEFAULT, DP_TIME_MAX_MS, DP_TANK, DP_SCOPE, DP_HIST_OFFSET, DP_HIST_BLOCKS,
        DP_HIST_BLOCK_SAMPS, DP_SCOPE_SAMPS, DP_ESCOPE, DP_ESCOPE_SAMPS, DP_BUS_NAME, DP_REG_STALE_MS,
        dpClamp, dpDivisionIndex, dpSyncMs, dpTargetMs, dpMinTimeSamples, dpChannelTimes, dpEffectiveTimes,
        dpReturnWriteIndex, dpEchoTaps, dpParseDevicePath, dpFindPartner, dpChainLatency, dpExtractIds,
        dpRoleOf, dpFormatMs,
    };
}
