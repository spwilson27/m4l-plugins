// Shared Delay+ math, telemetry layout and pairing helpers.
// Prepended into the Start / End v8ui scripts at build time and exported for Node tests.

// Delay sync note values: the straight values (quarter-note beats) and, built from them, every
// straight / triplet / dotted value sorted by length, the "L/R Division" dial's enum (DIVS in
// scripts/build_delayplus.py), so the dial always turns the time one way. LFO sync values: LFO_DIVS.
const DP_NOTE_BEATS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16];
const DP_NOTE_NAMES = ["1/64", "1/32", "1/16", "1/8", "1/4", "1/2", "1", "2", "4"];
const DP_DIV = DP_NOTE_BEATS.flatMap((b, i) => [{ sfx: "", m: 1, kind: 0 }, { sfx: " T", m: 2 / 3, kind: 1 },
    { sfx: " D", m: 1.5, kind: 2 }].map((v) => ({ beats: b * v.m, name: DP_NOTE_NAMES[i] + v.sfx, kind: v.kind })))
    .sort((a, b) => a.beats - b.beats);
const DP_DIV_BEATS = DP_DIV.map((d) => d.beats);
const DP_DIV_NAMES = DP_DIV.map((d) => d.name);
const DP_DIV_KIND = DP_DIV.map((d) => d.kind); // 0 straight, 1 triplet, 2 dotted
const DP_DIV_DEFAULT = DP_DIV_NAMES.indexOf("1/8");
// Per-side time modes (the "L/R Time Mode" menus). Sync is a note value times a free multiplier;
// Pitch and MIDI set the time to one period of a note (the loop rings as a comb at that pitch).
const DP_TMODES = ["Time", "Sync", "Pitch", "MIDI"];
const DP_TM = { TIME: 0, SYNC: 1, PITCH: 2, MIDI: 3 };
const DP_MULT_MIN = 0.02; // Sync multiplier range (the `L/R Mult` parameters)
const DP_MULT_MAX = 50;
const DP_NOTE_DEFAULT = 57; // A2 = 220 Hz in Live's note names (60 = C3, 69 = A3 = 440 Hz)
const DP_PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const DP_LFO_BEATS = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32];
const DP_TIME_MAX_MS = 8000; // the gen core clips tms here (and to its 524288-sample tank)
const DP_TANK = 524288;

// buffer~ #0-dpscope (Start telemetry, see src/delayplus_start.genexpr)
const DP_SCOPE = {
    TL: 0, TR: 1, CLAMPED: 2, TMIN: 3, B: 4, K: 5, L: 6, PAIRED: 8, IN_PK: 9,
    TAP_L: 10, TAP_R: 11, RET_L: 12, RET_R: 13, FRAMES: 14, SR: 15, FREEZE: 16, DUCK: 17,
    WET_PK: 18, HIST_HEAD: 19, TGT_L: 20, TGT_R: 21, LFO_L: 24, LFO_R: 25, ENV: 26, GATE: 27,
    CLIP_DB: 28,
};
const DP_HIST_OFFSET = 32;
const DP_HIST_BLOCKS = 512;
const DP_HIST_BLOCK_SAMPS = 256;
const DP_SCOPE_SAMPS = DP_HIST_OFFSET + 3 * DP_HIST_BLOCKS;
// buffer~ #0-dpscopeE (End telemetry, see src/delayplus_end.genexpr)
const DP_ESCOPE = { LINKED: 0, K: 1, L: 2, WET_PK: 4, DRY_PK: 5, DUCK: 6, FRAMES: 7, B: 8 };
const DP_ESCOPE_SAMPS = 32;

const DP_BUS_NAME = "delayplus_bus";
const DP_REG_STALE_MS = 3000;

// Live theme colours (Max for Live dynamic colours): follow Live's theme and hue settings. Outside Live
// (node tests, the preview renderer) the fallback is used.
function dpTheme(name, fallback) {
    if (typeof m4lColor === "function" && typeof m4lIsActive === "function" && m4lIsActive()) {
        return m4lColor(name, fallback);
    }
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

// Clip LED: a clip event (the Feedback Clip reducing the loop by more than 0.1 dB) is held for
// DP_CLIP_HOLD display frames (33 ms each, about 1 s) and then fades over DP_CLIP_FADE frames.
// `db` keeps the deepest reduction seen while held.
const DP_CLIP_HOLD = 30;
const DP_CLIP_FADE = 12;

/**
 * @param {{hold: number, db: number}} c  indicator state, updated in place
 * @param {number} reductionDb  this frame's reduction (<= 0)
 * @param {number} active  1 when this frame clipped
 * @returns {number} indicator level 0..1 (1 while held, fading after)
 */
function dpClipStep(c, reductionDb, active) {
    if (active) {
        c.db = c.hold > 0 ? Math.min(c.db, reductionDb) : reductionDb;
        c.hold = DP_CLIP_HOLD + DP_CLIP_FADE;
    } else if (c.hold > 0) {
        c.hold--;
    }
    return c.hold <= 0 ? 0 : Math.min(1, c.hold / DP_CLIP_FADE);
}

// Live's note name for a MIDI note number (60 = C3).
function dpNoteName(n) {
    const k = Math.round(Number(n) || 0);
    return DP_PITCH_NAMES[((k % 12) + 12) % 12] + (Math.floor(k / 12) - 2);
}

// One period of a MIDI note (plus cents), in ms.
function dpNotePeriodMs(note, cents) {
    const hz = 440 * Math.pow(2, ((Number(note) || 0) + (Number(cents) || 0) / 100 - 69) / 12);
    return 1000 / hz;
}

// Highest note whose period still fits the tank's minimum loop (tminMs), i.e. the highest note
// Pitch / MIDI play at their own pitch; higher ones are folded down by whole periods (dpSideMs).
function dpMaxNote(tminMs) {
    if (!(tminMs > 0)) return 127;
    return dpClamp(Math.floor(69 + 12 * Math.log2(1000 / tminMs / 440) + 1e-9), 0, 127);
}

/**
 * True when a Pitch / MIDI side's note is above dpMaxNote, so its period is folded.
 * @param {{tmode?: number, note?: number, cents?: number, offs?: number}} side
 * @param {{midiNote?: number, tminMs?: number}} [ctx]
 */
function dpPitchFolded(side, ctx) {
    const tm = dpIndex(side.tmode, DP_TMODES.length);
    if ((tm !== DP_TM.PITCH && tm !== DP_TM.MIDI) || !ctx || !(ctx.tminMs > 0)) return false;
    if (tm === DP_TM.MIDI && !(ctx.midiNote >= 0)) return false;
    const note = tm === DP_TM.MIDI ? ctx.midiNote : side.note;
    const offs = 1 + dpClamp(Number(side.offs) || 0, -33, 33) / 100;
    return dpNotePeriodMs(dpClamp(Number(note), 0, 127), dpClamp(Number(side.cents) || 0, -100, 100)) * offs < ctx.tminMs;
}

/**
 * Range warning for one side, in the side's own terms, or null when its time fits: the loop can't
 * be shorter than tminMs (slice + chain latency) or longer than DP_TIME_MAX_MS.
 *   Time "MIN 16.1 ms"   Sync "MIN x0.38", "MAX x32.00" (the multiplier that fits)
 *   Pitch / MIDI "MAX B0" (the highest note played at its own pitch; higher ones fold down)
 * @param {{tmode?: number, time?: number, div?: number, mult?: number, note?: number, cents?: number,
 *          offs?: number}} side
 * @param {number} bpm
 * @param {{midiNote?: number, tminMs?: number}} [ctx]
 * @returns {string | null}
 */
function dpSideWarn(side, bpm, ctx) {
    const tm = dpIndex(side.tmode, DP_TMODES.length);
    const tmin = ctx && ctx.tminMs > 0 ? ctx.tminMs : 0;
    const tmax = DP_TIME_MAX_MS;
    const beat = 60000 / dpClamp(Number(bpm) || 120, 20, 999);
    const offs = 1 + dpClamp(Number(side.offs) || 0, -33, 33) / 100;
    if (tm === DP_TM.PITCH || tm === DP_TM.MIDI) {
        if (!dpPitchFolded(side, ctx)) return null;
        // highest note whose period (with this side's fine tune and offset) still fits
        const cents = dpClamp(Number(side.cents) || 0, -100, 100);
        const top = Math.floor(69 + 12 * Math.log2(1000 * offs / tmin / 440) - cents / 100 + 1e-9);
        return "MAX " + dpNoteName(dpClamp(top, 0, 127));
    }
    if (tm === DP_TM.SYNC) {
        const base = DP_DIV_BEATS[dpDivIndex(side)] * beat * offs;
        const ms = base * dpMult(side);
        if (ms < tmin) return "MIN x" + (Math.ceil(tmin / base * 100) / 100).toFixed(2);
        if (ms > tmax) return "MAX x" + (Math.floor(tmax / base * 100) / 100).toFixed(2);
        return null;
    }
    const ms = (Number(side.time) || 0) * offs;
    return ms < tmin ? "MIN " + dpFormatMs(Math.ceil(tmin * 10) / 10) : null;
}

/** @param {{div?: number}} side  index into DP_DIV */
function dpDivIndex(side) {
    return side.div === undefined ? DP_DIV_DEFAULT : dpIndex(side.div, DP_DIV.length);
}
/** @param {{mult?: number}} side */
function dpMult(side) {
    return dpClamp(Number(side.mult) || 1, DP_MULT_MIN, DP_MULT_MAX);
}

/**
 * Whether Division value i is offered with the Options page's Triplet / Dotted switches.
 * @param {number} i
 * @param {any} trip
 * @param {any} dot
 */
function dpDivAllowed(i, trip, dot) {
    const k = DP_DIV_KIND[dpIndex(i, DP_DIV.length)];
    return k === 0 || (k === 1 && !!trip) || (k === 2 && !!dot);
}

/**
 * The Division value to use for a dial value v when triplets and / or dotted values are switched
 * off: v itself if offered, else the next offered value in the direction the dial moved from
 * prev (so turning the dial skips them), or the nearest by length when there is no direction
 * (a switch was just turned off, or prev is unknown). Straight values are always offered.
 * @param {number} v
 * @param {number} prev
 * @param {any} trip
 * @param {any} dot
 */
function dpDivSnap(v, prev, trip, dot) {
    const n = DP_DIV.length, i = dpIndex(v, n);
    if (dpDivAllowed(i, trip, dot)) return i;
    const dir = prev === undefined || prev === null || isNaN(Number(prev)) ? 0 : Math.sign(i - Number(prev));
    const find = (step) => {
        for (let j = i + step; j >= 0 && j < n; j += step) if (dpDivAllowed(j, trip, dot)) return j;
        return -1;
    };
    if (dir !== 0) {
        const j = find(dir);
        return j >= 0 ? j : find(-dir);
    }
    const up = find(1), dn = find(-1);
    if (up < 0) return dn;
    if (dn < 0) return up;
    const lb = Math.log(DP_DIV_BEATS[i]);
    return Math.log(DP_DIV_BEATS[up]) - lb < lb - Math.log(DP_DIV_BEATS[dn]) ? up : dn;
}

/**
 * One side's delay time in ms.
 * @param {{tmode?: number, time?: number, div?: number, mult?: number, note?: number, cents?: number,
 *          offs?: number}} side  the side's parameter values
 * @param {number} bpm
 * @param {{midiNote?: number, tminMs?: number}} [ctx]  last MIDI note (-1 = none yet) and the
 *        shortest loop the tank can honour (chain latency + slice), in ms
 * Time: ms. Sync: a straight, triplet or dotted note value (div, an index into DP_DIV) x a free
 * multiplier (0.02..50).
 * Pitch / MIDI: one period of the note; a period shorter than tminMs is replaced by the smallest
 * whole multiple of it that fits, so the comb still rings on that note's harmonics instead of
 * being clamped to an unrelated time. The offset (%) applies to every mode.
 */
function dpSideMs(side, bpm, ctx) {
    const tm = dpIndex(side.tmode, DP_TMODES.length);
    const beat = 60000 / dpClamp(Number(bpm) || 120, 20, 999);
    const offs = 1 + dpClamp(Number(side.offs) || 0, -33, 33) / 100;
    let ms;
    if (tm === DP_TM.SYNC) ms = DP_DIV_BEATS[dpDivIndex(side)] * dpMult(side) * beat;
    else if (tm === DP_TM.PITCH || tm === DP_TM.MIDI) {
        const midi = ctx && ctx.midiNote !== undefined ? Number(ctx.midiNote) : -1;
        const note = tm === DP_TM.MIDI && midi >= 0 ? midi : (tm === DP_TM.MIDI ? DP_NOTE_DEFAULT : side.note);
        ms = dpNotePeriodMs(dpClamp(Number(note), 0, 127), dpClamp(Number(side.cents) || 0, -100, 100)) * offs;
        const tmin = ctx && ctx.tminMs > 0 ? ctx.tminMs : 0;
        if (ms < tmin) ms *= Math.ceil(tmin / ms - 1e-9);
        return dpClamp(ms, 0.05, DP_TIME_MAX_MS);
    } else ms = Number(side.time) || 0;
    return dpClamp(ms * offs, 1, DP_TIME_MAX_MS);
}

// LFO rate in Hz: free in Hz, or one cycle per note value when synced.
function dpLfoHz(sync, hz, div, bpm) {
    if (!sync) return dpClamp(Number(hz) || 0.5, 0.01, 40);
    const beats = DP_LFO_BEATS[dpIndex(div, DP_LFO_BEATS.length)];
    return dpClamp(dpClamp(Number(bpm) || 120, 20, 999) / 60 / beats, 0.01, 40);
}

/**
 * Short label of one side's setting, e.g. "375 ms", "1/8 D", "1/8 x1.37", "A2 +12 ct", "MIDI A2".
 * @param {{tmode?: number, time?: number, div?: number, mult?: number, note?: number, cents?: number}} side
 * @param {number} [midiNote]  last MIDI note, -1 = none yet
 */
function dpSideLabel(side, midiNote) {
    const tm = dpIndex(side.tmode, DP_TMODES.length);
    const c = Math.round(Number(side.cents) || 0);
    const ct = c ? (c > 0 ? " +" : " ") + c + " ct" : "";
    if (tm === DP_TM.SYNC) {
        const m = dpMult(side);
        return DP_DIV_NAMES[dpDivIndex(side)] + (Math.abs(m - 1) < 1e-9 ? "" : " x" + m.toFixed(2));
    }
    if (tm === DP_TM.PITCH) return dpNoteName(side.note) + ct;
    if (tm === DP_TM.MIDI) return "MIDI " + (midiNote >= 0 ? dpNoteName(midiNote) + ct : "-");
    return dpFormatMs(Number(side.time) || 0);
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

/**
 * Latency of one device in samples, counting what is inside a rack. Live reports 0 as a rack's own
 * latency_in_samples even when a device inside it has latency (measured in Live 12.4.6: a Limiter
 * at 64 samples inside an Audio Effect Rack -> the rack reports 0), and it delays a rack's parallel
 * chains to the slowest one, so a rack counts as its longest chain (a chain = the sum of its
 * devices, racks inside it counted the same way).
 * @param {{lat?: number, chains?: Array<Array<any>>}} node  {lat, chains: [[node, ...], ...]}
 * @returns {number}
 */
function dpDeviceLatency(node) {
    let lat = Math.max(0, Math.round(Number(node && node.lat) || 0));
    const chains = node && Array.isArray(node.chains) ? node.chains : [];
    for (let c = 0; c < chains.length; c++) {
        let sum = 0;
        for (let d = 0; d < chains[c].length; d++) sum += dpDeviceLatency(chains[c][d]);
        lat = Math.max(lat, sum);
    }
    return lat;
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
        DP_NOTE_BEATS, DP_NOTE_NAMES, DP_DIV_BEATS, DP_DIV_NAMES, DP_DIV_KIND, DP_TMODES, DP_TM, DP_NOTE_DEFAULT, DP_MULT_MIN, DP_MULT_MAX, dpDivAllowed, dpDivSnap, dpNoteName, dpNotePeriodMs, dpMaxNote, dpPitchFolded, dpSideWarn, dpClipStep, DP_CLIP_HOLD, DP_CLIP_FADE, DP_LFO_BEATS, DP_DIV_DEFAULT, DP_TIME_MAX_MS, DP_TANK, DP_SCOPE, DP_HIST_OFFSET, DP_HIST_BLOCKS,
        DP_HIST_BLOCK_SAMPS, DP_SCOPE_SAMPS, DP_ESCOPE, DP_ESCOPE_SAMPS, DP_BUS_NAME, DP_REG_STALE_MS,
        dpTheme, dpThemeWatch, dpClamp, dpIndex, dpSideMs, dpLfoHz, dpSideLabel, dpMinTimeSamples, dpEffectiveTimes,
        dpReturnWriteIndex, dpDeviceLatency, dpEchoTaps, dpParseDevicePath, dpFindPartner, dpChainLatency, dpExtractIds,
        dpRoleOf, dpFormatMs,
    };
}
