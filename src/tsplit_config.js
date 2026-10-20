// Timbre Split — pure shared math: class memberships, online k-means, state blob, Rack/chain scoping and
// class-mask assignment. Prepended to src/tsplit_ui.js by scripts/build_tsplit.py (one v8ui script scope) and
// `require`d by tests/test_tsplit.js and src/tsplit_ref.js. Nothing here touches Max.
// The membership math mirrors src/tsplit_core.genexpr operation for operation.

var TSPLIT_MAX_CLASSES = 4;
var TSPLIT_NC = 13;               // MFCC c1..c13 (c0 is a separate level feature)
var TSPLIT_HOP = 256;
var TSPLIT_FRAME = 1024;
var TSPLIT_LATENCY = 2048;        // samples, = patcher "latency" attribute = audio delay in gen
var TSPLIT_SMOOTH_HALF = 3;       // temporal smoothing kernel half width, in hops (anticipation = latency - 768 - 256 * 3)
var TSPLIT_HYST_DIST = 1.0;       // MFCC distance units of "stickiness" for the incumbent class
var TSPLIT_STATE_VERSION = 1;
var TSPLIT_DEFAULT_CLASSES = 3;
var TSPLIT_DEFAULT_SHARP = 60;
var TSPLIT_DEFAULT_SMOOTH = 8;
var TSPLIT_MIN_GAIN_DB = -70.0;
var TSPLIT_MAX_GAIN_DB = 18.0;
var TSPLIT_LEARN_BARS = 6;
var TSPLIT_LEARN_MIN_FRAMES = 40;

var TSPLIT_CLASS_COLORS = [
    [0.36, 0.90, 0.95], // class 1: cyan
    [1.00, 0.72, 0.22], // class 2: amber
    [0.93, 0.36, 0.72], // class 3: pink
    [0.42, 0.95, 0.68]  // class 4: emerald
];

// Factory prior used until the user learns classes (ordered by c1, darkest first):
// bass-like, sine-like, noise-like, saw-like MFCC prototypes (same shapes as Timbre Follower's demo).
var TSPLIT_PRIOR_CENTROIDS = [
    [11.1, 1.9, 1.9, 0.8, 0.8, 0.5, 0.5, 0.3, 0.3, 0.2, 0.2, 0.2, 0.2],
    [7.5, 7.2, 6.6, 5.9, 5.0, 4.1, 3.1, 2.1, 1.3, 0.5, -0.1, -0.6, -0.9],
    [-0.2, -0.2, 0.0, -0.5, -0.8, -0.4, -0.3, 0.0, 0.1, -0.1, 0.4, 1.2, 0.5],
    [-0.5, -5.6, -2.7, -2.9, -2.5, -1.4, 0.7, 2.5, 3.7, 3.6, 1.9, -1.2, -3.5]
];

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function dbToLin(db) {
    return Math.pow(10.0, db / 20.0);
}

function linToDb(lin) {
    return 20.0 * Math.log10(Math.max(lin, 1e-9));
}

function formatGainDb(db) {
    var g = Number(db);
    if (isNaN(g)) g = 0.0;
    if (g <= -69.5) return "-inf dB";
    var sign = g > 0.04 ? "+" : "";
    return sign + g.toFixed(1) + " dB";
}

/** Output gain for the gen core: -70 dB and below is -inf (0). */
function gainDbToLinear(db) {
    var g = Number(db);
    if (isNaN(g)) g = 0.0;
    return g <= -69.5 ? 0.0 : Math.pow(10.0, g / 20.0);
}

function gainDbToSliderNorm(db) {
    var g = clamp(Number(db), TSPLIT_MIN_GAIN_DB, TSPLIT_MAX_GAIN_DB);
    if (isNaN(g) || g <= -69.5) return 0.0;
    if (g >= 0.0) return clamp(0.72 + 0.28 * (g / 18.0), 0.0, 1.0);
    return clamp(0.72 * Math.pow((g + 70.0) / 70.0, 1.75), 0.0, 0.72);
}

function sliderNormToGainDb(norm) {
    var n = clamp(Number(norm) || 0.0, 0.0, 1.0);
    if (n <= 0.015) return TSPLIT_MIN_GAIN_DB;
    if (n >= 0.72) return clamp(((n - 0.72) / 0.28) * 18.0, 0.0, 18.0);
    return clamp(-70.0 + 70.0 * Math.pow(n / 0.72, 1.0 / 1.75), -70.0, 0.0);
}

// =========================================================================
// MEMBERSHIPS (mirror of ts_classify / ts_smooth in src/tsplit_core.genexpr)
// =========================================================================

/** Sharp 0..100 % -> softmax inverse temperature on MFCC distance: 0.1 .. 4 (0.91 at the default 60 %). */
function sharpToBeta(sharpPct) {
    return 0.1 * Math.pow(40.0, clamp(Number(sharpPct) || 0, 0, 100) * 0.01);
}

/**
 * Soft class memberships of one MFCC frame. logit_k = -beta * (d_k - d_min - bonus) where the incumbent class
 * `cur` gets `bonus = TSPLIT_HYST_DIST` (hysteresis: a challenger must be that much closer to take over).
 * Returns { p: [4] (sums to 1 over the first K, zeros after), winner, dist: [4] }.
 */
function classifyFrame(feat, cents, K, beta, cur) {
    var nk = clamp(Math.round(K), 1, TSPLIT_MAX_CLASSES);
    var dist = [0, 0, 0, 0];
    var mn = 1e9;
    var k, d;
    for (k = 0; k < nk; k++) {
        var s = 0;
        for (d = 0; d < TSPLIT_NC; d++) {
            var df = feat[d] - cents[k][d];
            s += df * df;
        }
        dist[k] = Math.sqrt(s);
        if (dist[k] < mn) mn = dist[k];
    }
    var p = [0, 0, 0, 0];
    var tot = 0;
    for (k = 0; k < nk; k++) {
        var bonus = k === cur ? TSPLIT_HYST_DIST : 0;
        p[k] = Math.exp(-beta * (dist[k] - mn - bonus));
        tot += p[k];
    }
    var best = 0;
    var bv = -1;
    for (k = 0; k < nk; k++) {
        p[k] = p[k] / tot;
        if (p[k] > bv) {
            bv = p[k];
            best = k;
        }
    }
    return { p: p, winner: best, dist: dist };
}

/** Smooth (ms) -> 7 symmetric kernel weights (hop -3..+3), normalised to sum 1 (a delta below sigma 0.05 hops). */
function smoothKernel(smoothMs, sr) {
    var half = TSPLIT_SMOOTH_HALF;
    var sigma = Math.max(Number(smoothMs) || 0, 0) * 0.001 * sr / TSPLIT_HOP;
    var w = [];
    var sum = 0;
    var i;
    for (i = -half; i <= half; i++) {
        var v = sigma < 0.05 ? (i === 0 ? 1 : 0) : Math.exp(-(i * i) / (2 * sigma * sigma));
        w.push(v);
        sum += v;
    }
    for (i = 0; i < w.length; i++) w[i] = w[i] / sum;
    return w;
}

// =========================================================================
// CLASS-MASK ASSIGNMENT (which classes this Rack chain passes)
// =========================================================================

/**
 * classMode: 0 = Auto (chain rank N passes class N), 1..4 = solo class, 5 = multi (customMask, 4 bits).
 * Auto keeps the sum of all chains equal to the input: with fewer linked chains than classes the LAST chain also
 * passes every leftover class; with more chains than classes the extra chains pass nothing (mask 0).
 */
function resolveEffectiveClassMask(classMode, rank, peerCount, numClasses, customMask) {
    var K = clamp(Math.round(Number(numClasses) || TSPLIT_DEFAULT_CLASSES), 2, TSPLIT_MAX_CLASSES);
    var full = (1 << K) - 1;
    var P = Math.max(1, Math.round(Number(peerCount) || 1));
    var r = Math.max(0, Math.round(Number(rank) || 0));
    var mode = clamp(Math.round(Number(classMode) || 0), 0, 5);
    if (mode === 0) {
        if (r >= K) return 0;
        if (r >= P - 1 && P < K) return full & ~((1 << r) - 1);
        return 1 << r;
    }
    if (mode >= 1 && mode <= 4) return (1 << Math.min(mode - 1, K - 1)) & full;
    var cm = Math.round(Number(customMask));
    if (isNaN(cm) || cm < 0) cm = 1;
    return cm & full;
}

// =========================================================================
// ONLINE K-MEANS (leader instance, fed by the MFCC telemetry)
// =========================================================================

function centroidSortKey(c) {
    return -c[0]; // c1 large = energy in the lows: class 1 is the darkest, the last class the brightest
}

function cloneFeat(x) {
    var o = [];
    for (var d = 0; d < TSPLIT_NC; d++) o.push(Number(x[d]) || 0);
    return o;
}

function distSq(a, b) {
    var s = 0;
    for (var d = 0; d < TSPLIT_NC; d++) {
        var df = a[d] - b[d];
        s += df * df;
    }
    return s;
}

function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/**
 * Online k-means with a bounded reservoir. add(frame) does farthest-first lazy seeding and MacQueen updates, and
 * centroids() is usable at any moment (live fingerprints while learning): the online centroids at first, then a warm-
 * started Lloyd refinement of the reservoir. finalize() polishes the take with k-means++ restarts + Lloyd iterations
 * over the whole reservoir. Both sort by centroidSortKey (stable class order, darkest first).
 * @param {number} k classes (2..4)
 * @param {number} [seed]
 */
function createKMeansLearner(k, seed) {
    var K = clamp(Math.round(k), 1, TSPLIT_MAX_CLASSES);
    var rng = makeRng(seed === undefined ? 12345 : seed);
    var MAX_FRAMES = 4096;
    var SEED_DIST = 4.0;
    /** @type {number[][]} */
    var frames = [];
    /** @type {number[][]} */
    var cents = [];
    /** @type {number[]} */
    var counts = [];
    var seen = 0;

    function nearest(x, list) {
        var bi = 0;
        var bd = Infinity;
        for (var i = 0; i < list.length; i++) {
            var dd = distSq(x, list[i]);
            if (dd < bd) {
                bd = dd;
                bi = i;
            }
        }
        return { index: bi, dist: Math.sqrt(bd) };
    }

    function add(x) {
        var f = cloneFeat(x);
        seen++;
        if (frames.length < MAX_FRAMES) frames.push(f);
        else {
            var j = Math.floor(rng() * seen);
            if (j < MAX_FRAMES) frames[j] = f;
        }
        if (cents.length === 0) {
            cents.push(f);
            counts.push(1);
            return;
        }
        var nn = nearest(f, cents);
        if (cents.length < K && nn.dist > SEED_DIST) {
            cents.push(f);
            counts.push(1);
            return;
        }
        counts[nn.index]++;
        var eta = Math.max(1 / counts[nn.index], 0.005);
        for (var d = 0; d < TSPLIT_NC; d++) cents[nn.index][d] += eta * (f[d] - cents[nn.index][d]);
    }

    function sorted(list) {
        var out = list.map(cloneFeat);
        out.sort(function (a, b) { return centroidSortKey(a) - centroidSortKey(b); });
        return out;
    }

    function fillMissing(list) {
        // Classes not found yet keep their factory prior so a short take still gives K usable centroids.
        var out = list.map(cloneFeat);
        var pr = 0;
        while (out.length < K) out.push(cloneFeat(TSPLIT_PRIOR_CENTROIDS[(pr++) % TSPLIT_PRIOR_CENTROIDS.length]));
        return out;
    }

    function lloyd(initial, data) {
        var c = initial.map(cloneFeat);
        var assign = new Array(data.length);
        for (var it = 0; it < 30; it++) {
            var changed = 0;
            var sums = [];
            var cnt = [];
            var i, d, j;
            for (j = 0; j < K; j++) {
                sums.push(new Array(TSPLIT_NC).fill(0));
                cnt.push(0);
            }
            for (i = 0; i < data.length; i++) {
                var a = nearest(data[i], c).index;
                if (a !== assign[i]) changed++;
                assign[i] = a;
                cnt[a]++;
                for (d = 0; d < TSPLIT_NC; d++) sums[a][d] += data[i][d];
            }
            for (j = 0; j < K; j++) {
                if (cnt[j] > 0) {
                    for (d = 0; d < TSPLIT_NC; d++) c[j][d] = sums[j][d] / cnt[j];
                } else {
                    // empty cluster: move it onto the frame farthest from its centroid
                    var far = 0;
                    var fd = -1;
                    for (i = 0; i < data.length; i++) {
                        var dd = distSq(data[i], c[assign[i]]);
                        if (dd > fd) {
                            fd = dd;
                            far = i;
                        }
                    }
                    c[j] = cloneFeat(data[far]);
                }
            }
            if (changed === 0) break;
        }
        var inertia = 0;
        for (var q = 0; q < data.length; q++) inertia += distSq(data[q], c[nearest(data[q], c).index]);
        return { c: c, inertia: inertia };
    }

    function plusPlusSeeds(data) {
        var c = [cloneFeat(data[Math.floor(rng() * data.length)])];
        while (c.length < K) {
            var ds = [];
            var tot = 0;
            for (var i = 0; i < data.length; i++) {
                var dd = distSq(data[i], c[nearest(data[i], c).index]);
                ds.push(dd);
                tot += dd;
            }
            if (tot <= 1e-12) {
                c.push(cloneFeat(data[Math.floor(rng() * data.length)]));
                continue;
            }
            var r = rng() * tot;
            var pick = data.length - 1;
            for (var j = 0; j < data.length; j++) {
                r -= ds[j];
                if (r <= 0) {
                    pick = j;
                    break;
                }
            }
            c.push(cloneFeat(data[pick]));
        }
        return c;
    }

    function refine(data, restarts) {
        var best = lloyd(fillMissing(cents), data); // warm start from the online centroids
        for (var r = 0; r < restarts; r++) {
            var res = lloyd(plusPlusSeeds(data), data);
            if (res.inertia < best.inertia) best = res;
        }
        return sorted(best.c);
    }

    var liveCache = null;
    var liveCacheSeen = -1;

    // Live estimate while learning: the online (MacQueen) centroids until there is enough data, then a warm-started
    // k-means++ / Lloyd refinement of a bounded subsample of the reservoir (cached until new frames arrive).
    function liveCentroids() {
        if (frames.length < K * 12) return sorted(fillMissing(cents));
        if (liveCache && liveCacheSeen === seen) return liveCache.map(cloneFeat);
        var stride = Math.max(1, Math.ceil(frames.length / 800));
        var data = [];
        for (var i = 0; i < frames.length; i += stride) data.push(frames[i]);
        liveCache = refine(data, 2);
        liveCacheSeen = seen;
        return liveCache.map(cloneFeat);
    }

    function finalize() {
        if (frames.length < K) return sorted(fillMissing(cents));
        return refine(frames, 4);
    }

    return {
        add: add,
        finalize: finalize,
        centroids: liveCentroids,
        frameCount: function () { return seen; },
        stored: function () { return frames.length; }
    };
}

// =========================================================================
// STATE BLOB (getvalueof / setvalueof) — versioned, older / shorter arrays still load
// =========================================================================

function defaultState() {
    return {
        classes: TSPLIT_DEFAULT_CLASSES,
        sharp: TSPLIT_DEFAULT_SHARP,
        smooth: TSPLIT_DEFAULT_SMOOTH,
        adapt: 0,
        classMode: 0,
        customMask: 1,
        linkGroup: 0,
        gainDb: 0.0,
        showLinkStatus: 1,
        learned: 0,
        centroids: TSPLIT_PRIOR_CENTROIDS.map(cloneFeat)
    };
}

/**
 * Version 1 layout (63 numbers):
 * [1, classes, sharp, smooth, adapt, classMode, customMask, linkGroup, gainDb, showLinkStatus, learned,
 *  centroid[0][0..12], centroid[1][0..12], centroid[2][0..12], centroid[3][0..12]]
 */
function encodeStateBlob(st) {
    var out = [
        TSPLIT_STATE_VERSION, st.classes, st.sharp, st.smooth, st.adapt ? 1 : 0, st.classMode, st.customMask,
        st.linkGroup, st.gainDb, st.showLinkStatus ? 1 : 0, st.learned ? 1 : 0
    ];
    for (var k = 0; k < TSPLIT_MAX_CLASSES; k++) {
        for (var d = 0; d < TSPLIT_NC; d++) out.push(st.centroids[k][d]);
    }
    return out;
}

/**
 * Parses any blob into a complete state. `base` supplies every field the blob lacks (shorter arrays, older
 * versions). Unknown future versions parse the version-1 prefix they are required to keep.
 */
function decodeStateBlob(args, base) {
    var st = base ? JSON.parse(JSON.stringify(base)) : defaultState();
    if (!args || !args.length) return st;
    var ver = Math.round(Number(args[0]) || 0);
    if (ver < 1) return st;
    if (args.length >= 4) {
        st.classes = clamp(Math.round(Number(args[1]) || TSPLIT_DEFAULT_CLASSES), 2, TSPLIT_MAX_CLASSES);
        st.sharp = clamp(Number(args[2]), 0, 100);
        st.smooth = clamp(Number(args[3]), 0, 60);
        if (isNaN(st.sharp)) st.sharp = TSPLIT_DEFAULT_SHARP;
        if (isNaN(st.smooth)) st.smooth = TSPLIT_DEFAULT_SMOOTH;
    }
    if (args.length >= 5) st.adapt = Number(args[4]) > 0.5 ? 1 : 0;
    if (args.length >= 6) st.classMode = clamp(Math.round(Number(args[5]) || 0), 0, 5);
    if (args.length >= 7) st.customMask = clamp(Math.round(Number(args[6]) || 0), 0, 15);
    if (args.length >= 8) st.linkGroup = clamp(Math.round(Number(args[7]) || 0), 0, 5);
    if (args.length >= 9) st.gainDb = clamp(Number(args[8]) || 0, TSPLIT_MIN_GAIN_DB, TSPLIT_MAX_GAIN_DB);
    if (args.length >= 10) st.showLinkStatus = Number(args[9]) > 0.5 ? 1 : 0;
    if (args.length >= 11) st.learned = Number(args[10]) > 0.5 ? 1 : 0;
    if (args.length >= 11 + TSPLIT_MAX_CLASSES * TSPLIT_NC) {
        var cents = [];
        var ok = true;
        for (var k = 0; k < TSPLIT_MAX_CLASSES; k++) {
            var c = [];
            for (var d = 0; d < TSPLIT_NC; d++) {
                var v = Number(args[11 + k * TSPLIT_NC + d]);
                if (isNaN(v) || !isFinite(v)) ok = false;
                c.push(v);
            }
            cents.push(c);
        }
        if (ok) st.centroids = cents;
    }
    return st;
}

/** Flat 64-float layout of the `tsplitcent` buffer: centroid k at k * 16 (c1..c13), slots 13..15 unused. */
function centroidsToBufferArray(cents) {
    var out = new Array(TSPLIT_MAX_CLASSES * 16).fill(0);
    for (var k = 0; k < TSPLIT_MAX_CLASSES; k++) {
        for (var d = 0; d < TSPLIT_NC; d++) out[k * 16 + d] = cents[k][d];
    }
    return out;
}

// =========================================================================
// LEARN TIMING + LEADER ELECTION (pure)
// =========================================================================

/** Hops of audio in `bars` 4/4 bars at `bpm`. */
function learnHopsForBars(bars, bpm, sr) {
    var b = clamp(Number(bpm) || 120, 20, 400);
    return Math.max(1, Math.round(bars * 4 * 60 / b * sr / TSPLIT_HOP));
}

/** Sort peer descriptors {chainIndex, deviceIndex, order, id} the way chains read left to right. */
function sortPeerDescriptors(list) {
    return list.slice().sort(function (a, b) {
        var ca = Number(a.chainIndex) || 0, cb = Number(b.chainIndex) || 0;
        if (ca !== cb) return ca - cb;
        var da = Number(a.deviceIndex) || 0, db = Number(b.deviceIndex) || 0;
        if (da !== db) return da - db;
        var oa = Number(a.order) || 0, ob = Number(b.order) || 0;
        if (oa !== ob) return oa - ob;
        return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    });
}

/** The leader (the one instance that learns and adapts) is the first chain, left-most device. */
function electLeaderId(list) {
    var s = sortPeerDescriptors(list);
    return s.length ? s[0].id : null;
}

// =========================================================================
// RACK / CHAIN SCOPING (same LOM parsing as Multiband Split)
// =========================================================================

/**
 * Parses an Ableton Live Object Model (LOM) device path to extract the IMMEDIATE enclosing RackDevice path
 * (parentRackPath), the enclosing `chains <N>` index, the device index inside that chain and the nesting depth.
 */
function parseRackContextFromPath(lomPath) {
    var clean = String(lomPath || "").replace(/^["']+|["']+$/g, "").trim();
    if (!clean) {
        return {
            parentRackPath: "standalone_default", chainIndex: 0, deviceIndex: 0, nestingDepth: 0,
            isInRack: false, shortLabel: "LOCAL"
        };
    }
    var chainRegex = /^(.*?\bdevices\s+\d+)\s+chains\s+(\d+)\s+devices\s+(\d+)\s*$/;
    var m = clean.match(chainRegex);
    if (m) {
        var parentRackPath = m[1].trim();
        var chainIndex = parseInt(m[2], 10) || 0;
        var deviceIndex = parseInt(m[3], 10) || 0;
        var allChains = clean.match(/\bchains\s+\d+/g) || [];
        var depth = allChains.length;
        var rackDevMatch = parentRackPath.match(/devices\s+(\d+)$/);
        var rackNum = rackDevMatch ? (parseInt(rackDevMatch[1], 10) + 1) : 1;
        var shortLabel = depth > 1
            ? ("SUB-RACK L" + depth + " CH" + (chainIndex + 1))
            : ("RACK #" + rackNum + " CH" + (chainIndex + 1));
        return {
            parentRackPath: parentRackPath, chainIndex: chainIndex, deviceIndex: deviceIndex,
            nestingDepth: depth, isInRack: true, shortLabel: shortLabel
        };
    }
    var trackMatch = clean.match(/^(live_set\s+(?:tracks|return_tracks)\s+\d+|live_set\s+master_track)/);
    var trackPath = trackMatch ? trackMatch[1] : clean;
    var devMatch = clean.match(/\bdevices\s+(\d+)\s*$/);
    var trackDevIdx = devMatch ? (parseInt(devMatch[1], 10) || 0) : 0;
    return {
        parentRackPath: trackPath, chainIndex: 0, deviceIndex: trackDevIdx, nestingDepth: 0,
        isInRack: false, shortLabel: "TRACK CH1"
    };
}

/** Link group key: 0 = Auto (same immediate parent Rack), 1..4 = manual group A..D, 5 = Off (unlinked). */
function resolveLinkGroupKey(linkGroup, parentRackPath) {
    var lg = Math.round(Number(linkGroup) || 0);
    if (lg === 5) return null;
    if (lg >= 1 && lg <= 4) {
        var letters = ["A", "B", "C", "D"];
        return "manual_group_" + letters[lg - 1];
    }
    return "rack_group::" + (parentRackPath || "standalone_default");
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        TSPLIT_MAX_CLASSES: TSPLIT_MAX_CLASSES,
        TSPLIT_NC: TSPLIT_NC,
        TSPLIT_HOP: TSPLIT_HOP,
        TSPLIT_FRAME: TSPLIT_FRAME,
        TSPLIT_LATENCY: TSPLIT_LATENCY,
        TSPLIT_SMOOTH_HALF: TSPLIT_SMOOTH_HALF,
        TSPLIT_HYST_DIST: TSPLIT_HYST_DIST,
        TSPLIT_STATE_VERSION: TSPLIT_STATE_VERSION,
        TSPLIT_DEFAULT_CLASSES: TSPLIT_DEFAULT_CLASSES,
        TSPLIT_DEFAULT_SHARP: TSPLIT_DEFAULT_SHARP,
        TSPLIT_DEFAULT_SMOOTH: TSPLIT_DEFAULT_SMOOTH,
        TSPLIT_LEARN_BARS: TSPLIT_LEARN_BARS,
        TSPLIT_LEARN_MIN_FRAMES: TSPLIT_LEARN_MIN_FRAMES,
        TSPLIT_CLASS_COLORS: TSPLIT_CLASS_COLORS,
        TSPLIT_PRIOR_CENTROIDS: TSPLIT_PRIOR_CENTROIDS,
        clamp: clamp,
        dbToLin: dbToLin,
        linToDb: linToDb,
        formatGainDb: formatGainDb,
        gainDbToLinear: gainDbToLinear,
        gainDbToSliderNorm: gainDbToSliderNorm,
        sliderNormToGainDb: sliderNormToGainDb,
        sharpToBeta: sharpToBeta,
        classifyFrame: classifyFrame,
        smoothKernel: smoothKernel,
        resolveEffectiveClassMask: resolveEffectiveClassMask,
        createKMeansLearner: createKMeansLearner,
        centroidSortKey: centroidSortKey,
        defaultState: defaultState,
        encodeStateBlob: encodeStateBlob,
        decodeStateBlob: decodeStateBlob,
        centroidsToBufferArray: centroidsToBufferArray,
        learnHopsForBars: learnHopsForBars,
        sortPeerDescriptors: sortPeerDescriptors,
        electLeaderId: electLeaderId,
        parseRackContextFromPath: parseRackContextFromPath,
        resolveLinkGroupKey: resolveLinkGroupKey
    };
}
