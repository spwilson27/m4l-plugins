// Fill — hit sampling, experimental modal page, and impulse-response math.
// Prepended into the v8ui and required by tests/test_fill.js. No module.exports at top level:
// a CommonJS export would hide these functions from the concatenated face script.

var FILL_W = 768;
var FILL_H = 169;
var FILL_LAT_LOOK = 256;
var FILL_LAT_PITCH = 1024;
var FILL_LAT_CONV = 256;
var FILL_LATENCY = FILL_LAT_LOOK + FILL_LAT_PITCH + FILL_LAT_CONV;

var FILL_PHRASES = [1, 2, 4, 8];
var FILL_CURVES = ["Linear", "Ease In", "Ease Out", "S"];
var FILL_MODES = ["Resonator", "Pitch", "Freq"];
var FILL_BODY_MODELS = ["Tom", "Snare", "Kick", "Hat"];
var FILL_AIR_MODELS = ["Wires", "Room", "Hat", "Sizzle"];

// Uniform partition, same layout the gen MAC reads.
// Head: 32 x 128 = 4096 samples. Tail: 6 x 2048 = 12288. Cap 16384.
var FILL_CONV = {
    P1: 128,
    N1: 256,
    NB1: 129,
    HEAD: 32,
    H: 4096,
    P2: 2048,
    N2: 4096,
    NB2: 2049,
    TAIL: 6,
    BODY_MAX: 16384,
    AIR_MAX: 8192,
};
FILL_CONV.HEAD_FLOATS = FILL_CONV.HEAD * FILL_CONV.NB1 * 4;
FILL_CONV.TAIL_FLOATS = FILL_CONV.TAIL * FILL_CONV.NB2 * 4;
FILL_CONV.BANK_FLOATS = FILL_CONV.HEAD_FLOATS + FILL_CONV.TAIL_FLOATS;
FILL_CONV.BANKS = 4;

// Display inside the center v8ui, and the widget rows the build must match.
var FILL_LAYOUT = {
    width: FILL_W,
    height: FILL_H,
    viz: [200, 32, 368, 94],
    startCol: [4, 30, 188, 135],
    endCol: [576, 30, 188, 135],
    rowY: [48, 66, 84, 102, 120, 138],
    rowH: 14,
    modelY: [130, 148],
    modelH: 15,
};

var FILL_COLOR_KEYS = ["tune", "strike", "damp", "beater", "metal", "space"];
var FILL_MODEL_KEYS = ["bmodel", "bdecay", "bsize", "bcolor", "bmix", "amodel", "adecay", "asize", "acolor", "amix"];
var FILL_LINK_KEYS = FILL_COLOR_KEYS.concat(FILL_MODEL_KEYS);

var FILL_BODY = {
    Tom: { f0: 140, ratios: [1, 1.59, 2.14, 2.3, 2.92, 3.4], decay: [1, 0.55, 0.35, 0.28, 0.2, 0.15], noise: 0, ms: 280 },
    Snare: { f0: 190, ratios: [1, 1.72, 2.4, 3.1], decay: [0.7, 0.35, 0.22, 0.12], noise: 0.18, ms: 160 },
    Kick: { f0: 55, ratios: [1, 1.6, 2.1, 2.8], decay: [1, 0.4, 0.18, 0.08], noise: 0, ms: 220 },
    Hat: { f0: 420, ratios: [1, 1.42, 1.9, 2.55, 3.3], decay: [0.28, 0.22, 0.16, 0.12, 0.08], noise: 0.08, ms: 70 },
};

var FILL_AIR = {
    Wires: { ms: 80, hp: 0.85, color: 0.4 },
    Room: { ms: 160, hp: 0.15, color: -0.2 },
    Hat: { ms: 28, hp: 0.95, color: 0.6 },
    Sizzle: { ms: 110, hp: 0.7, color: 0.5 },
};

function fillClamp(v, lo, hi) {
    var x = Number(v);
    if (x !== x) x = lo;
    return Math.max(lo, Math.min(hi, x));
}

function fillLerp(a, b, t) {
    return a + (b - a) * t;
}

function fillMod(x, m) {
    if (m === 0) return 0;
    var r = x - m * Math.floor(x / m);
    return r < 0 ? r + m : r;
}

function fillDbToLin(db) {
    return Math.pow(10, db / 20);
}

function fillCurve(u, shape) {
    var x = fillClamp(u, 0, 1);
    var k = Math.round(shape) | 0;
    if (k === 1) return x * x;
    if (k === 2) return 1 - (1 - x) * (1 - x);
    if (k === 3) return x * x * (3 - 2 * x);
    return x;
}

function fillPhraseBars(index) {
    var i = fillClamp(Math.round(index) || 0, 0, FILL_PHRASES.length - 1);
    return FILL_PHRASES[i];
}

// Position inside the phrase, in quarter notes. The fill is the last `lengthBeats`.
function fillWindow(ppq, phraseIndex, lengthBeats) {
    var beats = fillPhraseBars(phraseIndex) * 4;
    var len = fillClamp(lengthBeats, 0.25, Math.min(4, beats));
    var pos = fillMod(Number(ppq) || 0, beats);
    var start = beats - len;
    var inside = pos >= start - 1e-9;
    var u = inside ? fillClamp((pos - start) / len, 0, 1) : 0;
    return { inside: inside ? 1 : 0, u: u, pos: pos, start: start, len: len, beats: beats };
}

function fillHoldMorph(playing, inside, shaped, held) {
    if (playing < 0.5) return held;
    return inside ? shaped : 0;
}

function fillStepU(hit, hits) {
    var n = fillClamp(Math.round(hits) || 2, 2, 16);
    var h = fillClamp(Math.round(hit) || 0, 0, n - 1);
    return h / (n - 1);
}

// Sens 100% fires on any rise over the slow envelope. Sens 0% needs +12 dB. Holdoff is 40 ms.
function fillOnset(fast, slow, sens01, samplesSince, sr) {
    var hold = Math.max(1, Math.round(0.04 * (sr || 48000)));
    if (samplesSince < hold) return 0;
    var ratio = fillDbToLin((1 - fillClamp(sens01, 0, 1)) * 12);
    if (fast > 1e-5 && fast > slow * ratio) return 1;
    return 0;
}

function fillHash(seed, hit, lane) {
    // Seed 0 is a real parked value (0..1000); do not collapse it to 1.
    var s = Math.round(Number(seed));
    if (!isFinite(s)) s = 1;
    var x = (Math.imul(s, 374761393) + Math.imul(Math.round(hit) + 1, 668265263) + Math.imul(lane + 1, 144067397)) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function fillBipolar(seed, hit, lane) {
    return fillHash(seed, hit, lane) * 2 - 1;
}

// One draw per hit. master is 0..1, range is in center's units and clamps to the lo..hi span.
// master 0 or range 0 is the clamped center; otherwise center + bipolar * range * master.
function fillHitDraw(center, range, lo, hi, seed, hit, lane, master) {
    var span = Number(hi) - Number(lo);
    var m = fillClamp(master, 0, 1);
    var r = fillClamp(range, 0, span > 0 ? span : 0);
    if (m === 0 || r === 0) return fillClamp(center, lo, hi);
    return fillClamp(Number(center) + fillBipolar(seed, hit, lane) * r * m, lo, hi);
}

// One shared 0..1 roll for the whole body group (lane 100) or air group (lane 101).
function fillBodyRoll(seed, hit) {
    return (fillBipolar(seed, hit, 100) + 1) * 0.5;
}

function fillAirRoll(seed, hit) {
    return (fillBipolar(seed, hit, 101) + 1) * 0.5;
}

// Amount 0 is no nudge. Amount 1 is ±40 cents, ±3 dB of brightness, ±0.15 of damping.
function fillDrift(seed, hit, amount01) {
    var a = fillClamp(amount01, 0, 1);
    return {
        cents: fillBipolar(seed, hit, 1) * 40 * a,
        brightDb: fillBipolar(seed, hit, 2) * 3 * a,
        damp: fillBipolar(seed, hit, 3) * 0.15 * a,
    };
}

function fillIdentitySnap() {
    return {
        tune: 0, strike: 0, damp: 0, beater: 100, metal: 100, space: 0,
        bmodel: 0, bdecay: 40, bsize: 100, bcolor: 0, bmix: 0,
        amodel: 0, adecay: 40, asize: 100, acolor: 0, amix: 0,
    };
}

function fillDemoStart() {
    return {
        tune: 0, strike: 20, damp: 25, beater: 100, metal: 30, space: 8,
        bmodel: 0, bdecay: 40, bsize: 80, bcolor: 0, bmix: 15,
        amodel: 0, adecay: 30, asize: 70, acolor: 10, amix: 20,
    };
}

function fillDemoEnd() {
    return {
        tune: -7, strike: 75, damp: 80, beater: 140, metal: 90, space: 28,
        bmodel: 0, bdecay: 85, bsize: 140, bcolor: -20, bmix: 70,
        amodel: 1, adecay: 60, asize: 120, acolor: -10, amix: 55,
    };
}

function fillCloneSnap(s) {
    var o = fillIdentitySnap();
    var k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(s, k)) o[k] = s[k];
    return o;
}

function fillMorphSnap(a, b, t) {
    var o = fillCloneSnap(a);
    var i;
    for (i = 0; i < FILL_COLOR_KEYS.length; i++) {
        var k = FILL_COLOR_KEYS[i];
        o[k] = fillLerp(a[k], b[k], t);
    }
    o.bdecay = fillLerp(a.bdecay, b.bdecay, t);
    o.bsize = fillLerp(a.bsize, b.bsize, t);
    o.bcolor = fillLerp(a.bcolor, b.bcolor, t);
    o.bmix = fillLerp(a.bmix, b.bmix, t);
    o.adecay = fillLerp(a.adecay, b.adecay, t);
    o.asize = fillLerp(a.asize, b.asize, t);
    o.acolor = fillLerp(a.acolor, b.acolor, t);
    o.amix = fillLerp(a.amix, b.amix, t);
    o.bmodel = t < 0.5 ? a.bmodel : b.bmodel;
    o.amodel = t < 0.5 ? a.amodel : b.amodel;
    return o;
}

function fillBlankState() {
    var link = {};
    var i;
    for (i = 0; i < FILL_LINK_KEYS.length; i++) link[FILL_LINK_KEYS[i]] = 0;
    return { s: fillIdentitySnap(), e: fillIdentitySnap(), link: link, selected: 0 };
}

// A change from either side. Linked keys copy onto the other side (the caller must not re-enter).
function fillApplyChange(st, side, key, value) {
    var next = { s: fillCloneSnap(st.s), e: fillCloneSnap(st.e), link: st.link, selected: st.selected };
    next[side][key] = value;
    var sets = [];
    if (st.link[key]) {
        var other = side === "s" ? "e" : "s";
        if (next[other][key] !== value) {
            next[other][key] = value;
            sets.push({ side: other, key: key, value: value });
        }
    }
    return { state: next, sets: sets };
}

// Turning a link on copies the selected column onto the other. Turning it off leaves both values.
function fillSetLink(st, key, on) {
    var link = {};
    var i;
    for (i = 0; i < FILL_LINK_KEYS.length; i++) link[FILL_LINK_KEYS[i]] = st.link[FILL_LINK_KEYS[i]];
    var next = { s: fillCloneSnap(st.s), e: fillCloneSnap(st.e), link: link, selected: st.selected };
    var sets = [];
    if (on) {
        var src = st.selected === 1 ? "e" : "s";
        var dst = src === "s" ? "e" : "s";
        link[key] = 1;
        if (next[dst][key] !== next[src][key]) {
            next[dst][key] = next[src][key];
            sets.push({ side: dst, key: key, value: next[src][key] });
        }
    } else {
        link[key] = 0;
    }
    return { state: next, sets: sets };
}

function fillLengthFromDrag(x, width) {
    var w = Math.max(1, width);
    var u = fillClamp(x / w, 0, 1);
    var beats = (1 - u) * 4;
    return fillClamp(Math.round(beats * 4) / 4, 0.25, 4);
}

function fillModelName(list, index) {
    var i = fillClamp(Math.round(index) || 0, 0, list.length - 1);
    return list[i];
}

function fillRadix2(re, im) {
    var n = re.length;
    var i, j, bit, len, half, k, s, ur, ui, vr, vi, ang, wr, wi;
    j = 0;
    for (i = 1; i < n; i++) {
        bit = n >> 1;
        while (j & bit) {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if (i < j) {
            ur = re[i]; re[i] = re[j]; re[j] = ur;
            ui = im[i]; im[i] = im[j]; im[j] = ui;
        }
    }
    for (len = 2; len <= n; len <<= 1) {
        half = len >> 1;
        ang = -2 * Math.PI / len;
        wr = Math.cos(ang);
        wi = Math.sin(ang);
        for (s = 0; s < n; s += len) {
            var cr = 1, ci = 0;
            for (k = 0; k < half; k++) {
                var a = s + k;
                var b = a + half;
                vr = re[b] * cr - im[b] * ci;
                vi = re[b] * ci + im[b] * cr;
                ur = re[a]; ui = im[a];
                re[a] = ur + vr; im[a] = ui + vi;
                re[b] = ur - vr; im[b] = ui - vi;
                var nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
    }
}

function fillIrLength(ms, sizePct, decayPct, cap, sr) {
    var size = fillClamp(sizePct, 50, 200) / 100;
    var decay = fillClamp(decayPct, 0, 100) / 100;
    var n = Math.round(ms * size * (0.25 + 0.75 * decay) * sr / 1000);
    return fillClamp(n, 32, cap);
}

function fillTiltSample(prev, cur, colorPct) {
    var c = fillClamp(colorPct, -100, 100) / 100;
    return cur + c * 0.85 * (cur - prev);
}

function fillRenderBody(modelIndex, decayPct, sizePct, colorPct, tuneSt, sr) {
    var name = fillModelName(FILL_BODY_MODELS, modelIndex);
    var spec = FILL_BODY[name];
    var rate = sr || 48000;
    var n = fillIrLength(spec.ms, sizePct, decayPct, FILL_CONV.BODY_MAX, rate);
    var size = fillClamp(sizePct, 50, 200) / 100;
    var f0 = spec.f0 / size * Math.pow(2, (Number(tuneSt) || 0) / 12);
    var ir = new Float32Array(n);
    var i, m, prev = 0, peak = 0;
    var rng = 0.5;
    for (i = 0; i < n; i++) {
        var t = i / rate;
        var s = 0;
        for (m = 0; m < spec.ratios.length; m++) {
            var tau = (spec.decay[m] * spec.ms / 1000) * (0.25 + 0.75 * fillClamp(decayPct, 0, 100) / 100) * size;
            var f = f0 * spec.ratios[m];
            if (f < rate * 0.45) s += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / Math.max(0.005, tau));
        }
        if (spec.noise) {
            rng = fillMod(rng * 16807, 2147483647);
            s += spec.noise * ((rng / 2147483647) * 2 - 1) * Math.exp(-t / Math.max(0.005, spec.ms / 1000 * size));
        }
        var y = fillTiltSample(prev, s, colorPct);
        prev = s;
        ir[i] = y;
        var a = Math.abs(y);
        if (a > peak) peak = a;
    }
    if (peak > 1e-8) {
        var g = 0.5 / peak;
        for (i = 0; i < n; i++) ir[i] *= g;
    }
    return ir;
}

function fillRenderAir(modelIndex, decayPct, sizePct, colorPct, seed, sr) {
    var name = fillModelName(FILL_AIR_MODELS, modelIndex);
    var spec = FILL_AIR[name];
    var rate = sr || 48000;
    var n = fillIrLength(spec.ms, sizePct, decayPct, FILL_CONV.AIR_MAX, rate);
    var size = fillClamp(sizePct, 50, 200) / 100;
    var ir = new Float32Array(n);
    var i, prev = 0, hp = 0, peak = 0;
    var tau = Math.max(0.004, spec.ms / 1000 * size * (0.25 + 0.75 * fillClamp(decayPct, 0, 100) / 100));
    for (i = 0; i < n; i++) {
        var white = fillBipolar(seed, i, 4);
        hp = hp * (1 - spec.hp) + white * spec.hp;
        var env = Math.exp(-(i / rate) / tau);
        var y = fillTiltSample(prev, hp * env, colorPct + spec.color * 100);
        prev = hp * env;
        ir[i] = y;
        var a = Math.abs(y);
        if (a > peak) peak = a;
    }
    if (peak > 1e-8) {
        var g = 0.5 / peak;
        for (i = 0; i < n; i++) ir[i] *= g;
    }
    return ir;
}

function fillPackPartition(ir, offset, block, nfft) {
    var re = new Float32Array(nfft);
    var im = new Float32Array(nfft);
    var i;
    for (i = 0; i < block && offset + i < ir.length; i++) re[i] = ir[offset + i];
    fillRadix2(re, im);
    var bins = nfft / 2 + 1;
    var out = new Float32Array(bins * 4);
    for (i = 0; i < bins; i++) {
        out[i * 4] = re[i];
        out[i * 4 + 1] = im[i];
        out[i * 4 + 2] = re[i];
        out[i * 4 + 3] = im[i];
    }
    return out;
}

function fillIrUsed(ir) {
    var n = ir.length;
    while (n > 1 && ir[n - 1] === 0) n--;
    return n;
}

function fillSpectra(ir) {
    var C = FILL_CONV;
    var used = Math.min(fillIrUsed(ir), C.BODY_MAX);
    var nHead = Math.min(C.HEAD, Math.max(1, Math.ceil(Math.min(used, C.H) / C.P1)));
    var tailSamps = Math.max(0, used - C.H);
    var nTail = Math.min(C.TAIL, Math.ceil(tailSamps / C.P2));
    var head = new Float32Array(C.HEAD_FLOATS);
    var tail = new Float32Array(C.TAIL_FLOATS);
    var p, q, part;
    for (p = 0; p < nHead; p++) {
        part = fillPackPartition(ir, p * C.P1, C.P1, C.N1);
        head.set(part, p * C.NB1 * 4);
    }
    for (q = 0; q < nTail; q++) {
        part = fillPackPartition(ir, C.H + q * C.P2, C.P2, C.N2);
        tail.set(part, q * C.NB2 * 4);
    }
    return { head: head, tail: tail, nHead: nHead, nTail: nTail, length: used };
}

function fillSnapIR(snap, band, sr) {
    if (band === "air") {
        return fillRenderAir(snap.amodel, snap.adecay, snap.asize, snap.acolor, 3, sr);
    }
    return fillRenderBody(snap.bmodel, snap.bdecay, snap.bsize, snap.bcolor, snap.tune, sr);
}

// One experimental resonator page, sampled once per hit. Length 408:
//   [0, 384)    48 modes × 8 floats
//               0 phase increment (rad/sample) = freq/sr*2*pi
//               1 pole radius r in (0, 1)
//               2 gain
//               3 pan -1..1
//               4 excitation weight (the 48 weights sum to 1)
//               5 extra high-mode damp 0..1
//               6 tilt -1..1
//               7 group id 0..7
//   [384, 404)  10 allpass pairs (delaySamples, g)
//               delay in 1 .. min(40 ms, 0.04*sr, 4094), g in [-0.45, 0.45]
//               air amount 0 or rand 0 forces every g to 0
//   [404, 408)  couple 0..1, bite drive 1..3, air amount 0..1, rt60 seconds
// metas mass/scatter/decay/couple/bite/air are 0..100 with matching *R ranges.
// rand (0..1) is the master for fillHitDraw on lanes 21..26 and for allpass g.
// Stability (band, spacing, RT60, pole radius, allpass bounds) runs after the draw.
function fillExperimentalPage(metas, seed, hit, sr) {
    var rate = Number(sr);
    if (!(rate > 0)) rate = 48000;
    var src = metas || {};
    var rand = fillClamp(src.rand, 0, 1);
    function drawn(name, lane) {
        return fillHitDraw(src[name], src[name + "R"], 0, 100, seed, hit, lane, rand);
    }
    var mass = drawn("mass", 21);
    var scatter = drawn("scatter", 22);
    var decay = drawn("decay", 23);
    var couple = drawn("couple", 24);
    var bite = drawn("bite", 25);
    var air = drawn("air", 26);

    var scatter01 = scatter / 100;
    var bite01 = bite / 100;
    var airAmt = air / 100;
    var couple01 = couple / 100;
    var rt60 = 0.02 + (decay / 100) * (0.50 - 0.02);
    if (rt60 < 0.02) rt60 = 0.02;
    if (rt60 > 0.50) rt60 = 0.50;
    var drive = 1 + bite01 * 2;
    if (drive < 1) drive = 1;
    if (drive > 3) drive = 3;
    var fCenter = 60 * Math.pow(33, mass / 100);

    var anchors = [1, 1.6, 2.2, 2.8];
    var freqs = new Array(48);
    var i;
    for (i = 0; i < 48; i++) {
        var replica = (i / 4) | 0;
        var near = anchors[i % 4] * Math.pow(1.008, replica - 5.5);
        var spread = 0.5 * Math.pow(16, i / 47);
        var ratio = Math.exp(Math.log(near) * (1 - scatter01) + Math.log(spread) * scatter01);
        var hz = fCenter * ratio;
        if (!(hz > 0) || hz === Infinity) hz = fCenter;
        freqs[i] = hz;
    }
    freqs.sort(function (a, b) { return a - b; });
    var minMul = 1 + 0.04 * scatter01;
    for (i = 1; i < 48; i++) {
        var need = freqs[i - 1] * minMul;
        if (freqs[i] < need) freqs[i] = need;
    }

    var loF = 40;
    var hiF = 0.45 * rate / 2;
    if (!(hiF > loF)) hiF = loF + 48;
    var gap = (hiF - loF) / 47;
    if (gap > 2) gap = 2;
    for (i = 0; i < 48; i++) {
        var f = freqs[i];
        if (f !== f || f === Infinity || f === -Infinity) f = fCenter;
        if (f < loF) f = loF;
        if (f > hiF) f = hiF;
        freqs[i] = f;
    }
    for (i = 1; i < 48; i++) {
        if (freqs[i] < freqs[i - 1] + gap) freqs[i] = freqs[i - 1] + gap;
    }
    if (freqs[47] > hiF) {
        freqs[47] = hiF;
        for (i = 46; i >= 0; i--) {
            if (freqs[i] > freqs[i + 1] - gap) freqs[i] = freqs[i + 1] - gap;
        }
    }
    for (i = 0; i < 48; i++) {
        if (freqs[i] < loF) freqs[i] = loF;
        if (freqs[i] > hiF) freqs[i] = hiF;
    }

    var sharp = (1 - bite01) * 10;
    var weight = new Array(48);
    var sumW = 0;
    for (i = 0; i < 48; i++) {
        weight[i] = Math.exp(-sharp * i);
        sumW += weight[i];
    }
    if (!(sumW > 0)) sumW = 1;

    var rCap = Math.exp(-6.91 / (0.50 * rate));
    var page = new Array(408);
    for (i = 0; i < 408; i++) page[i] = 0;
    for (i = 0; i < 48; i++) {
        var modeRt = rt60 * (1 - 0.75 * (i / 47));
        var r = Math.exp(-6.91 / (modeRt * rate));
        if (!(r > 0)) r = 1e-12;
        if (r > rCap) r = rCap;
        if (!(r < 1)) r = rCap;
        var group = (i / 6) | 0;
        var base = i * 8;
        page[base] = freqs[i] / rate * (2 * Math.PI);
        page[base + 1] = r;
        page[base + 2] = 0.5 / Math.sqrt(1 + i);
        page[base + 3] = (group / 7) * 2 - 1;
        page[base + 4] = weight[i] / sumW;
        page[base + 5] = i / 47;
        page[base + 6] = (i / 47) * 2 - 1;
        page[base + 7] = group;
    }

    // Cap matches fillApPair clip(delay, 1, 4094) and 4096-sample apMem lines.
    var cap = Math.min(0.040 * rate, 4094);
    if (!(cap >= 1)) cap = 1;
    var capI = Math.floor(cap);
    if (capI < 1) capI = 1;
    var p;
    for (p = 0; p < 10; p++) {
        var delay = Math.pow(capI, p / 9);
        if (delay < 1) delay = 1;
        if (delay > cap) delay = cap;
        var g = 0;
        if (airAmt > 0 && rand > 0) {
            g = fillBipolar(seed, hit, 110 + p) * 0.45 * airAmt * rand;
            if (g > 0.45) g = 0.45;
            if (g < -0.45) g = -0.45;
        }
        page[384 + p * 2] = delay;
        page[384 + p * 2 + 1] = g;
    }
    page[404] = couple01;
    page[405] = drive;
    page[406] = airAmt;
    page[407] = rt60;
    return page;
}

var fillNode = (typeof module !== "undefined") ? module : undefined;
if (fillNode && fillNode.exports) {
    fillNode.exports = {
        FILL_W: FILL_W,
        FILL_H: FILL_H,
        FILL_LATENCY: FILL_LATENCY,
        FILL_LAT_LOOK: FILL_LAT_LOOK,
        FILL_LAT_PITCH: FILL_LAT_PITCH,
        FILL_LAT_CONV: FILL_LAT_CONV,
        FILL_PHRASES: FILL_PHRASES,
        FILL_CURVES: FILL_CURVES,
        FILL_MODES: FILL_MODES,
        FILL_BODY_MODELS: FILL_BODY_MODELS,
        FILL_AIR_MODELS: FILL_AIR_MODELS,
        FILL_CONV: FILL_CONV,
        FILL_LAYOUT: FILL_LAYOUT,
        FILL_COLOR_KEYS: FILL_COLOR_KEYS,
        FILL_MODEL_KEYS: FILL_MODEL_KEYS,
        FILL_LINK_KEYS: FILL_LINK_KEYS,
        FILL_BODY: FILL_BODY,
        fillClamp: fillClamp,
        fillCurve: fillCurve,
        fillWindow: fillWindow,
        fillHoldMorph: fillHoldMorph,
        fillStepU: fillStepU,
        fillOnset: fillOnset,
        fillDrift: fillDrift,
        fillHitDraw: fillHitDraw,
        fillBodyRoll: fillBodyRoll,
        fillAirRoll: fillAirRoll,
        fillExperimentalPage: fillExperimentalPage,
        fillIrUsed: fillIrUsed,
        fillIdentitySnap: fillIdentitySnap,
        fillDemoStart: fillDemoStart,
        fillDemoEnd: fillDemoEnd,
        fillMorphSnap: fillMorphSnap,
        fillBlankState: fillBlankState,
        fillApplyChange: fillApplyChange,
        fillSetLink: fillSetLink,
        fillLengthFromDrag: fillLengthFromDrag,
        fillRenderBody: fillRenderBody,
        fillRenderAir: fillRenderAir,
        fillSpectra: fillSpectra,
        fillSnapIR: fillSnapIR,
        fillPackPartition: fillPackPartition,
    };
}
