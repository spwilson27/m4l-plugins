// Scatter — draw math and macro -> underlying-parameter mapping (JS reference).
// Prepended into the v8ui face by scripts/build_scatter.py and required by node tests the way
// tests/test_fill.js requires src/fill_config.js. No module.exports at top level: a CommonJS export
// would hide these functions from the concatenated face script (a guarded export sits at the bottom).
//
// This file is the reference implementation of the draw math in src/scatter_core.genexpr. The two
// MUST stay in lockstep: same stream, same order, same mappings, same clamps.
//
// Draw stream: a 32-bit LCG, state' = (state * 1664525 + 1013904223) mod 2^32, u = state' / 2^32.
// Every intermediate product is below 2^53, so the stream is bit-identical in float64 JS and in
// GenExpr (doubles). The stream is seeded from (seed, hit) by scatterStreamSeed and consumed in
// exactly the order of SCATTER_MACRO_KEYS followed by SCATTER_UNDERLYING — never reorder either list.

var SCATTER_LATENCY = 5120;
var SCATTER_FFT = 1024;
var SCATTER_HOP = 256;
var SCATTER_HOLDOFF_MS = 40;

var SCATTER_MACRO_KEYS = ["snap", "body", "metal", "motion", "space", "grit", "warp", "ring"];
var SCATTER_MACRO_DEFS = {
    snap:   { label: "Snap",   centre: 50, depth: 25 },
    body:   { label: "Body",   centre: 50, depth: 25 },
    metal:  { label: "Metal",  centre: 30, depth: 25 },
    motion: { label: "Motion", centre: 35, depth: 25 },
    space:  { label: "Space",  centre: 30, depth: 20 },
    grit:   { label: "Grit",   centre: 20, depth: 15 },
    warp:   { label: "Warp",   centre: 25, depth: 20 },
    ring:   { label: "Ring",   centre: 40, depth: 20 },
};
var SCATTER_GLOBALS = { sens: 45, master: 50, mix: 100, splitMode: 0, seed: 0, lock: 0 };

// Underlying parameters, in stream order. centre(m) maps the drawn macro value (0..100) onto the
// parameter's centre in its own units; a parameter then draws around that centre with
// offset = (u * 2 - 1) * spread * (hi - lo) * (depth / 100) * master, clamped to [lo, hi].
// depth is the owning macro's Rand depth (0..100) and master is 0..1, so depth 0 or master 0
// holds every parameter of that macro exactly at its mapped centre.
var SCATTER_UNDERLYING = [
    { key: "snapDrive",    macro: "snap",   lo: 1,    hi: 4,     spread: 0.20, centre: function (m) { return 1 + (m / 100) * 3; } },
    { key: "snapFilterHz", macro: "snap",   lo: 800,  hi: 14000, spread: 0.25, log: true, centre: function (m) { return 800 * Math.pow(14000 / 800, m / 100); } },
    { key: "snapPhaserMix",macro: "snap",   lo: 0,    hi: 0.8,   spread: 0.25, centre: function (m) { return (m / 100) * 0.8; } },
    { key: "snapBlipSt",   macro: "snap",   lo: -12,  hi: 12,    spread: 0.30, centre: function (m) { return (m / 100) * 12; } },
    { key: "bodyFreqHz",   macro: "body",   lo: 60,   hi: 420,   spread: 0.20, log: true, centre: function (m) { return 60 * Math.pow(420 / 60, m / 100); } },
    { key: "bodyDecayS",   macro: "body",   lo: 0.05, hi: 0.9,   spread: 0.25, centre: function (m) { return 0.05 + (m / 100) * 0.85; } },
    { key: "bodyMix",      macro: "body",   lo: 0,    hi: 1,     spread: 0.20, centre: function (m) { return m / 100; } },
    { key: "metalFreqHz",  macro: "metal",  lo: 800,  hi: 9000,  spread: 0.25, log: true, centre: function (m) { return 800 * Math.pow(9000 / 800, m / 100); } },
    { key: "metalDecayS",  macro: "metal",  lo: 0.1,  hi: 2.5,   spread: 0.25, centre: function (m) { return 0.1 + (m / 100) * 2.4; } },
    { key: "metalMix",     macro: "metal",  lo: 0,    hi: 1,     spread: 0.20, centre: function (m) { return m / 100; } },
    { key: "motionDelayMs",macro: "motion", lo: 40,   hi: 480,   spread: 0.30, centre: function (m) { return 40 + (m / 100) * 440; } },
    { key: "motionRateHz", macro: "motion", lo: 0.05, hi: 7,     spread: 0.30, log: true, centre: function (m) { return 0.05 * Math.pow(7 / 0.05, m / 100); } },
    { key: "motionDepth",  macro: "motion", lo: 0,    hi: 1,     spread: 0.25, centre: function (m) { return m / 100; } },
    { key: "spaceDecayS",  macro: "space",  lo: 0.25, hi: 5,     spread: 0.25, centre: function (m) { return 0.25 + (m / 100) * 4.75; } },
    { key: "spaceSize",    macro: "space",  lo: 0.2,  hi: 1,     spread: 0.25, centre: function (m) { return 0.2 + (m / 100) * 0.8; } },
    { key: "spaceMix",     macro: "space",  lo: 0,    hi: 1,     spread: 0.20, centre: function (m) { return m / 100; } },
    { key: "gritDriveDb",  macro: "grit",   lo: 0,    hi: 24,    spread: 0.25, centre: function (m) { return (m / 100) * 24; } },
    { key: "gritTone",     macro: "grit",   lo: -1,   hi: 1,     spread: 0.25, centre: function (m) { return (m / 50) - 1; } },
    { key: "warpShiftHz",  macro: "warp",   lo: -600, hi: 600,   spread: 0.30, centre: function (m) { return ((m / 50) - 1) * 300; } },
    { key: "warpPitchSt",  macro: "warp",   lo: -12,  hi: 12,    spread: 0.30, centre: function (m) { return ((m / 50) - 1) * 6; } },
    { key: "ringDecayS",   macro: "ring",   lo: 0.05, hi: 2.0,   spread: 0.15, log: true, centre: function (m) { return 0.05 * Math.pow(2.0 / 0.05, m / 100); } },
];

function scatterClamp(v, lo, hi) {
    var x = Number(v);
    if (x !== x) x = lo;
    return Math.max(lo, Math.min(hi, x));
}

function scatterStreamSeed(seed, hit) {
    var s = (Math.floor(Math.abs(Number(seed) || 0)) % 100000) * 2654435761;
    var h = (Math.floor(Math.abs(Number(hit) || 0)) % 100000) + 1;
    s = (s + h * 2246822519) % 4294967296;
    return s;
}

function scatterStreamNext(state) {
    return (state * 1664525 + 1013904223) % 4294967296;
}

// scatterMap(drawnMacros) -> the centre of every underlying parameter for a set of drawn macro
// values (0..100 each), with no secondary draw applied. This is the macro -> underlying mapping.
function scatterMap(drawnMacros) {
    var out = {};
    for (var i = 0; i < SCATTER_UNDERLYING.length; i++) {
        var p = SCATTER_UNDERLYING[i];
        out[p.key] = scatterClamp(p.centre(scatterClamp(drawnMacros[p.macro], 0, 100)), p.lo, p.hi);
    }
    return out;
}

// scatterDraw(seed, hit, centres, depths, master)
//   centres / depths: {snap: 0..100, ...} (missing keys fall back to the contract defaults)
//   master: 0..1 (the face sends Master Rand / 100)
// Returns { seed, hit, macros: {drawn macro values}, params: {every underlying parameter},
//           ringDecayS } — deterministic in (seed, hit): the same pair always draws the same values,
// a different hit draws different values. Ring decay is always within 0.05..2.0 s (hard cap).
function scatterDraw(seed, hit, centres, depths, master) {
    var c = centres || {};
    var d = depths || {};
    var m01 = scatterClamp(master, 0, 1);
    var state = scatterStreamSeed(seed, hit);
    function nextU() { state = scatterStreamNext(state); return state / 4294967296; }
    var macros = {};
    var i, key;
    for (i = 0; i < SCATTER_MACRO_KEYS.length; i++) {
        key = SCATTER_MACRO_KEYS[i];
        var centre = scatterClamp(c[key] !== undefined ? c[key] : SCATTER_MACRO_DEFS[key].centre, 0, 100);
        var depth = scatterClamp(d[key] !== undefined ? d[key] : SCATTER_MACRO_DEFS[key].depth, 0, 100);
        var u = nextU();
        macros[key] = (depth === 0 || m01 === 0) ? centre : scatterClamp(centre + (u * 2 - 1) * depth * m01, 0, 100);
    }
    var centresMapped = scatterMap(macros);
    var params = {};
    for (i = 0; i < SCATTER_UNDERLYING.length; i++) {
        var p = SCATTER_UNDERLYING[i];
        var pdepth = scatterClamp(d[p.macro] !== undefined ? d[p.macro] : SCATTER_MACRO_DEFS[p.macro].depth, 0, 100);
        var pu = nextU();
        var off = (pu * 2 - 1) * p.spread * (p.hi - p.lo) * (pdepth / 100) * m01;
        params[p.key] = (pdepth === 0 || m01 === 0) ? centresMapped[p.key] : scatterClamp(centresMapped[p.key] + off, p.lo, p.hi);
    }
    params.ringDecayS = scatterClamp(params.ringDecayS, 0.05, 2.0);
    return { seed: Number(seed) || 0, hit: Math.floor(Number(hit) || 0), macros: macros, params: params, ringDecayS: params.ringDecayS };
}

// Onset detector, same shape as fillOnset: fast/slow envelope comparison, Sens 100% fires on any
// rise over the slow envelope, Sens 0% needs +12 dB, 40 ms holdoff after the previous hit.
function scatterOnset(fast, slow, sens01, samplesSince, sr) {
    var hold = Math.max(1, Math.round((SCATTER_HOLDOFF_MS / 1000) * (sr || 48000)));
    if (samplesSince < hold) return 0;
    var ratio = Math.pow(10, ((1 - scatterClamp(sens01, 0, 1)) * 12) / 20);
    if (fast > 1e-5 && fast > slow * ratio) return 1;
    return 0;
}

var scatterNode = (typeof module !== "undefined") ? module : undefined;
if (scatterNode && scatterNode.exports) {
    scatterNode.exports = {
        SCATTER_LATENCY: SCATTER_LATENCY, SCATTER_FFT: SCATTER_FFT, SCATTER_HOP: SCATTER_HOP,
        SCATTER_MACRO_KEYS: SCATTER_MACRO_KEYS, SCATTER_MACRO_DEFS: SCATTER_MACRO_DEFS,
        SCATTER_GLOBALS: SCATTER_GLOBALS, SCATTER_UNDERLYING: SCATTER_UNDERLYING,
        scatterClamp: scatterClamp, scatterStreamSeed: scatterStreamSeed, scatterStreamNext: scatterStreamNext,
        scatterMap: scatterMap, scatterDraw: scatterDraw, scatterOnset: scatterOnset,
    };
}
