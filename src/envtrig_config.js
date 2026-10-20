// Shared Envelope Trigger math, UI geometry & LOM routing helpers.
// Prepended into src/envtrig_ui.js at build time and exported for Node tests.

const SCOPE_COLS = 110;
// buffer~ #0-trigscope layout (written by src/envtrig_core.genexpr): header 0..6, then the
// oscilloscope ring of SCOPE_BLOCKS x (min, max, onset flag) from SCOPE_RING_OFFSET.
const SCOPE_BLOCKS = 256;
const SCOPE_RING_OFFSET = 32;
const SCOPE_BUFFER_SAMPS = 800;
const THR_MIN_DB = -60.0;
const THR_MAX_DB = 0.0;
// Device width with the MIDI To panel collapsed / expanded (live.thisdevice setwidth).
const WIDTH_COLLAPSED = 228;
const WIDTH_EXPANDED = 342;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const ROUTING_PATH = "this_device midi_outputs 0";

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function dbToLin(db) {
    return Math.pow(10, db / 20);
}

function linToDb(lin) {
    return 20 * Math.log10(Math.max(lin, 1e-6));
}

// Live's note naming (C3 = 60).
function noteName(n) {
    const v = clamp(Math.round(Number(n) || 0), 0, 127);
    return NOTE_NAMES[v % 12] + (Math.floor(v / 12) - 2);
}

// Required fast/slow ratio for an onset: Sens 100% -> 0 dB (threshold only), Sens 0% -> 12 dB.
function onsetRatio(sens01) {
    return dbToLin((1 - clamp(sens01, 0, 1)) * 12);
}

// Mirrors the GenExpr velocity map: captured peak between threshold and 0 dBFS -> velLo..velHi.
function velocityFromPeak(peakLin, thrDb, velLo, velHi) {
    const lo = clamp(velLo, 1, 127);
    const hi = clamp(Math.max(velHi, lo), 1, 127);
    const thr = clamp(thrDb, THR_MIN_DB, THR_MAX_DB);
    const t = clamp((linToDb(peakLin) - thr) / Math.max(-thr, 1), 0, 1);
    return clamp(Math.floor(lo + t * (hi - lo) + 0.5), 1, 127);
}

// Display mapping for the scope: 0 dBFS at the top, -60 dB at the bottom of the plot.
function dbToPlot01(db) {
    return clamp((db - THR_MIN_DB) / (THR_MAX_DB - THR_MIN_DB), 0, 1);
}

function linToPlot01(lin) {
    if (lin <= 1e-6) return 0;
    return dbToPlot01(linToDb(lin));
}

function plot01ToDb(v01) {
    return THR_MIN_DB + clamp(v01, 0, 1) * (THR_MAX_DB - THR_MIN_DB);
}

// LiveAPI hands back dictionary properties in three shapes; normalise them all:
//   get()             -> ["{json}"]
//   observer callback -> [property, <Max Dict>] in v8 (a handle like {name: "u0950..."}, read via stringify())
//   classic js        -> [property, parsed object]
function lomValue(raw, key) {
    let v = raw;
    if (Array.isArray(v)) v = v.length > 1 ? v[1] : v[0];
    if (v && typeof v === "object" && typeof v.stringify === "function") v = v.stringify();
    if (typeof v === "string") {
        try { v = JSON.parse(v); } catch (err) { return null; }
    }
    if (v && typeof v === "object" && key in v) return v[key];
    return null;
}

// Menu items for the "MIDI To" type chooser.
function routingTypeRange(types) {
    if (!types || !types.length) return ["No Output", "-"];
    const names = types.map((t) => String(t.display_name));
    return names.length === 1 ? [names[0], "-"] : names;
}

// Menu state for the channel chooser: single/empty channel lists are shown but disabled.
function routingChannelState(channels) {
    if (!channels || !channels.length) return { range: ["-", "-"], active: 0 };
    if (channels.length === 1) {
        const n = String(channels[0].display_name || "");
        return { range: [n || "-", "-"], active: 0 };
    }
    return { range: channels.map((c) => String(c.display_name)), active: 1 };
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        SCOPE_COLS,
        SCOPE_BLOCKS,
        SCOPE_RING_OFFSET,
        SCOPE_BUFFER_SAMPS,
        THR_MIN_DB,
        THR_MAX_DB,
        WIDTH_COLLAPSED,
        WIDTH_EXPANDED,
        ROUTING_PATH,
        clamp,
        dbToLin,
        linToDb,
        noteName,
        onsetRatio,
        velocityFromPeak,
        dbToPlot01,
        linToPlot01,
        plot01ToDb,
        lomValue,
        routingTypeRange,
        routingChannelState,
    };
}
