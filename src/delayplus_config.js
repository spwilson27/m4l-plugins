// Shared Delay+ math, telemetry layout and pairing helpers.
// Prepended into the Start / End v8ui scripts at build time and exported for Node tests.

// Delay sync note values (quarter-note beats) and modes, LFO sync values; the enums are in
// scripts/build_delayplus.py (NOTES, SYNC_MODES, LFO_DIVS).
const DP_NOTE_BEATS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16];
const DP_NOTE_NAMES = ["1/64", "1/32", "1/16", "1/8", "1/4", "1/2", "1", "2", "4"];
const DP_MODE_MULT = [1, 2 / 3, 1.5]; // Notes, Triplet, Dotted
const DP_LFO_BEATS = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32];
const DP_DIV_DEFAULT = 3; // 1/8
const DP_TIME_MAX_MS = 8000; // the gen core clips tms here (and to its 524288-sample tank)
const DP_TANK = 524288;

// buffer~ #0-dpscope (Start telemetry, see src/delayplus_start.genexpr)
const DP_SCOPE = {
    TL: 0, TR: 1, CLAMPED: 2, TMIN: 3, B: 4, K: 5, L: 6, PING_L: 7, PAIRED: 8, IN_PK: 9,
    TAP_L: 10, TAP_R: 11, RET_L: 12, RET_R: 13, FRAMES: 14, SR: 15, FREEZE: 16, DUCK: 17,
    WET_PK: 18, HIST_HEAD: 19, TGT_L: 20, TGT_R: 21, DEBUG: 23, LFO_L: 24, LFO_R: 25, ENV: 26, GATE: 27,
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

// Live theme colours (Max for Live dynamic colours): follow Live's theme and hue settings. Outside Live
// (node tests, the preview renderer) the fallback is used.
function dpTheme(name, fallback) {
    try {
        if (typeof max !== "undefined" && max.getcolor) {
            const c = max.getcolor(name);
            if (c && c.length >= 3) return [c[0], c[1], c[2], c.length > 3 ? c[3] : 1];
        }
    } catch (e) {}
    return fallback;
}

// Redraw a display when Live's theme changes (checked once a second, even while idle); a script may
// also define dpOnThemeChange() to recolour patcher objects.
var dpOnThemeChange = null;
function dpThemeWatch() {
    if (typeof Task === "undefined" || typeof mgraphics === "undefined") return null;
    let last = "";
    const t = new Task(function () {
        const k = String(dpTheme("live_lcd_bg", [0, 0, 0, 1])) + String(dpTheme("live_display_line_one", [0, 0, 0, 1]))
            + String(dpTheme("live_surface_bg", [0, 0, 0, 1])) + String(dpTheme("live_control_selection", [0, 0, 0, 1]));
        if (k !== last) {
            last = k;
            mgraphics.redraw();
            if (typeof dpOnThemeChange === "function") dpOnThemeChange();
        }
    });
    t.interval = 1000;
    t.repeat();
    return t;
}

function dpClamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function dpIndex(i, n) {
    return dpClamp(Math.round(Number(i) || 0), 0, n - 1);
}

// One side's delay time in ms (Echo: Time or Sync x mode, then the offset in %).
function dpSideMs(sync, timeMs, div, mode, offsetPct, bpm) {
    let ms;
    if (sync) {
        const beats = DP_NOTE_BEATS[dpIndex(div, DP_NOTE_BEATS.length)] * DP_MODE_MULT[dpIndex(mode, DP_MODE_MULT.length)];
        ms = beats * 60000 / dpClamp(Number(bpm) || 120, 20, 999);
    } else {
        ms = Number(timeMs) || 0;
    }
    return dpClamp(ms * (1 + dpClamp(Number(offsetPct) || 0, -33, 33) / 100), 1, DP_TIME_MAX_MS);
}

// LFO rate in Hz: free in Hz, or one cycle per note value when synced.
function dpLfoHz(sync, hz, div, bpm) {
    if (!sync) return dpClamp(Number(hz) || 0.5, 0.01, 40);
    const beats = DP_LFO_BEATS[dpIndex(div, DP_LFO_BEATS.length)];
    return dpClamp(dpClamp(Number(bpm) || 120, 20, 999) / 60 / beats, 0.01, 40);
}

// Label of one side's time for the face: "1/8", "1/8 T", "1/8 D" or "375 ms".
function dpSideLabel(sync, timeMs, div, mode) {
    if (!sync) return dpFormatMs(Number(timeMs) || 0);
    return DP_NOTE_NAMES[dpIndex(div, DP_NOTE_NAMES.length)] + ["", " T", " D"][dpIndex(mode, 3)];
}

// Shortest time the tank can honour: one return slice (B) + chain latency (L) + the modulation
// sweep + the 4-sample interpolation margin (mirrors `tmin` in the gen core).
function dpMinTimeSamples(B, L, modDepth01, sr) {
    return B + L + dpClamp(modDepth01, 0, 1) * 0.008 * sr + 4;
}

function dpEffectiveTimes(msL, msR, sr, B, L, modDepth01) {
    const tmin = dpMinTimeSamples(B, L, modDepth01, sr);
    const tmax = DP_TANK - 8;
    const tl = msL * sr / 1000;
    const tr = msR * sr / 1000;
    return { L: dpClamp(tl, tmin, tmax), R: dpClamp(tr, tmin, tmax), tmin, clamped: tl < tmin || tr < tmin };
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

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        DP_NOTE_BEATS, DP_NOTE_NAMES, DP_MODE_MULT, DP_LFO_BEATS, DP_DIV_DEFAULT, DP_TIME_MAX_MS, DP_TANK, DP_SCOPE, DP_HIST_OFFSET, DP_HIST_BLOCKS,
        DP_HIST_BLOCK_SAMPS, DP_SCOPE_SAMPS, DP_ESCOPE, DP_ESCOPE_SAMPS, DP_BUS_NAME, DP_REG_STALE_MS,
        dpTheme, dpThemeWatch, dpClamp, dpIndex, dpSideMs, dpLfoHz, dpSideLabel, dpMinTimeSamples, dpEffectiveTimes,
        dpReturnWriteIndex, dpEchoTaps, dpParseDevicePath, dpFindPartner, dpChainLatency, dpExtractIds,
        dpRoleOf, dpFormatMs,
    };
}
