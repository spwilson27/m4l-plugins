// Amp: a neural amp built on the open NAM model format (Tone 3000 / Neural Amp Modeler, .nam files).
// Shared by every Amp face script and required by tests/test_amp.js. Plain script (no module.exports at
// top level, AGENTS 1c): Node gets it through ampNodeModule at the end.
//
// What lives here:
//  - ampParseNam(json): a .nam document -> a normalised model {kind, layers | lstm, weights, ...}.
//    Classic files (head_size / head_bias / "Tanh") and the newer export ("head" object, activation
//    objects, kernel_sizes) both parse. Supported: WaveNet (non-gated or gated, any activation in
//    AMP_ACTS, any channels / kernel / dilations, layer1x1 on, head1x1 off, no FiLM, no post head)
//    and LSTM (any layers / hidden size, input size 1).
//  - ampForward(model, x): the reference forward pass in double precision (tests compare it with the
//    official torch implementation and with the generated gen code running in Max).
//  - ampGenNam(model): the GenExpr for that architecture (declarations + per-sample body) that
//    replaces //@NAM_DECL and //@NAM_BODY in the template src/amp_core.genexpr. Loop bounds, ring
//    offsets and weight offsets are constants of the architecture; the WEIGHTS are read from buffer~
//    ---ampw at offset `wb` (two banks), so models of one architecture share one compile.
//  - the tone stack / cab biquads (written by the engine into buffer~ ---ampcf), parameters, telemetry.

var AMP_VERSION = 1;
var AMP_WBANK = 65536;              // weights per bank in ---ampw (two banks)
var AMP_WMAX = AMP_WBANK - 16;
var AMP_MAX_CH = 32;
var AMP_MAX_LAYERS = 48;
var AMP_MAX_RING = 2000000;         // doubles of WaveNet history per architecture
var AMP_NORM_TARGET_DB = -18;       // NAM plugin's "Normalize" target
var AMP_FILE_INDEX = 12;            // Model enum: 12 built-in captures, then File
var AMP_NBQ = 10;                   // biquads in ---ampcf: 0..3 tone stack, 4..9 cab
var AMP_CF_SAMPS = AMP_NBQ * 5 + 6;

// Telemetry ---ampscope. Header 0..63, XY ring 64.. (pairs: left input after Gain, left model output,
// one pair every 4 samples), output ring (final output, mid of L / R, every sample).
var AMP_SCOPE = {
    FRAMES: 0, SR: 1, IN_PK: 2, OUT_PK: 3, GATE: 4, SAT: 5, IN_RMS: 6, OUT_RMS: 7, MODEL_OK: 8,
    NLAYERS: 9, NAM_PK: 10, ASLEEP: 11, XY_HEAD: 12, OUT_HEAD: 13, SWITCHING: 14, ALIVE: 15,
    LAYER: 16, LAYER_N: 48,
    XY: 64, XY_N: 512,
    OUT: 1088, OUT_N: 2048,
    SAMPS: 3136
};

var AMP_ACTS = ["Tanh", "Fasttanh", "ReLU", "LeakyReLU", "Sigmoid", "Hardtanh", "SiLU", "Softsign"];

// Parameters shared by every face. key: [long name, short, lo, hi, init, type (0 float 1 int 2 enum),
// unitstyle, gen message (null = engine only), enum, help]
/** @type {Object<string, [string, string, number, number, number, number, number, (string|null), (string[]|null), string]>} */
var AMP_PARAMS = {
    model: ["Model", "Model", 0, 12, 4, 2, 0, null, ["Clean", "Chime", "Bass", "Drive", "Crunch", "Lead", "Metal", "Fuzz", "Magna", "DS-1", "Splawn", "Mark IV", "File"], "Built-in capture or the .nam file you loaded. Magna, DS-1, Splawn and Mark IV are trained from community NAM captures licensed GPL-3.0 (github.com/pelennor2170/NAM_models)."],
    gain: ["Gain", "Gain", -24, 24, 0, 0, 4, "indb", null, "Level into the model, in decibels. Captures react to level like the real amp: more gain, more drive."],
    gate: ["Gate", "Gate", -100, -20, -100, 0, 4, "gatedb", null, "Noise gate threshold. -100 dB is off."],
    bass: ["Bass", "Bass", 0, 10, 5, 0, 1, null, null, "Low shelf at 150 Hz (NAM tone stack)."],
    mid: ["Middle", "Middle", 0, 10, 5, 0, 1, null, null, "Peak at 425 Hz."],
    treble: ["Treble", "Treble", 0, 10, 5, 0, 1, null, null, "High shelf at 1.8 kHz."],
    presence: ["Presence", "Presence", 0, 10, 5, 0, 1, null, null, "High shelf at 4.5 kHz."],
    cab: ["Cabinet", "Cabinet", 0, 3, 2, 2, 0, null, ["Off", "1x12", "4x12", "2x12"], "Speaker voicing after the amp. Off for a capture that already includes a cab."],
    stereo: ["Output Mode", "Output", 0, 1, 0, 2, 0, "stmode", ["Mono", "Stereo"], "Mono runs one model on the summed input. Stereo runs a model per channel (twice the CPU)."],
    normalize: ["Normalize", "Normalize", 0, 1, 1, 2, 0, null, ["Off", "On"], "Level-match captures to -18 dB using the file's loudness metadata."],
    eqpos: ["EQ Position", "EQ Pos", 0, 1, 0, 2, 0, "eqpre", ["Post", "Pre"], "Post: the tone stack shapes the amp's output. Pre: it shapes the signal going into the model, so a boosted band also drives the amp harder."],
    volume: ["Volume", "Volume", -40, 12, 0, 0, 4, "outdb", null, "Output level after the amp and cab."],
    mix: ["Dry/Wet", "Dry/Wet", 0, 100, 100, 0, 5, "mixamt", null, "Dry / amp blend."]
};
var AMP_PARAM_KEYS = ["model", "gain", "gate", "bass", "mid", "treble", "presence", "cab", "stereo", "normalize", "eqpos", "volume", "mix"];

/** @param {string} key @param {number} v */
function ampGenValue(key, v) {
    if (key === "mix") return v / 100;
    return v;
}

// ---------------------------------------------------------------------------------------------
// .nam parsing

/** @param {any} a */
function ampActName(a) {
    var n = a;
    if (a && typeof a === "object") n = a.type || a.name;
    n = String(n || "Tanh");
    for (var i = 0; i < AMP_ACTS.length; i++) if (AMP_ACTS[i].toLowerCase() === n.toLowerCase()) return AMP_ACTS[i];
    return "";
}

/** @param {any} lc @param {number} key */
function ampListOrScalar(lc, key) {
    return lc[key];
}

/**
 * Parse a .nam document (object or JSON text). Throws an Error with a short reason when the file is
 * not a model this device can run.
 * @param {any} doc
 */
function ampParseNam(doc) {
    var d = typeof doc === "string" ? JSON.parse(doc) : doc;
    if (!d || typeof d !== "object") throw new Error("not a .nam file");
    var arch = String(d.architecture || "");
    var cfg = d.config || {};
    var w = d.weights;
    if (!w || typeof w.length !== "number") throw new Error("no weights");
    var meta = d.metadata || {};
    var model = {
        kind: "", name: String(meta.name || meta.modeled_by || ""), loudness: (typeof meta.loudness === "number") ? meta.loudness : null,
        sampleRate: Number(d.sample_rate || 48000), layers: /** @type {any[]} */ ([]), lstm: /** @type {any} */ (null),
        headScale: 1, weights: /** @type {number[]} */ ([]), nWeights: 0, receptiveField: 1, gear: String(meta.gear_type || ""),
        tone: String(meta.tone_type || ""), credit: String(meta.credit || ""), license: String(meta.license || "")
    };
    var weights = [];
    for (var i = 0; i < w.length; i++) weights.push(Number(w[i]));
    model.weights = weights;
    if (arch === "WaveNet") {
        if (cfg.head) throw new Error("WaveNet with a post head is not supported");
        if (cfg.condition_dsp) throw new Error("condition DSP is not supported");
        var ls = cfg.layers || cfg.layers_configs;
        if (!ls || !ls.length) throw new Error("no layers");
        var n = 0, rf = 1, prevHead = -1;
        for (var a = 0; a < ls.length; a++) {
            var lc = ls[a];
            var ch = Number(lc.channels);
            var dil = (lc.dilations || []).map(Number);
            var ks = lc.kernel_size;
            if (ks == null && lc.kernel_sizes) ks = lc.kernel_sizes;
            var ksz = Array.isArray(ks) ? ks.map(Number) : dil.map(function () { return Number(ks); });
            var headSize = lc.head_size != null ? Number(lc.head_size) : (lc.head ? Number(lc.head.out_channels) : NaN);
            var headBias = lc.head_bias != null ? !!lc.head_bias : !!(lc.head && lc.head.bias);
            if (lc.head && Number(lc.head.kernel_size || 1) !== 1) throw new Error("head kernel > 1 not supported");
            var acts = Array.isArray(lc.activation) ? lc.activation : dil.map(function () { return lc.activation; });
            var gated = !!lc.gated;
            if (lc.gating_mode) {
                var gm = Array.isArray(lc.gating_mode) ? lc.gating_mode[0] : lc.gating_mode;
                if (gm && gm !== "none") gated = gm === "gated" ? true : null;
            }
            if (gated === null) throw new Error("blended gating is not supported");
            if (lc.bottleneck != null && Number(lc.bottleneck) !== ch) throw new Error("bottleneck layers are not supported");
            if (lc.head1x1 && lc.head1x1.active) throw new Error("head1x1 is not supported");
            if (lc.layer1x1 && lc.layer1x1.active === false) throw new Error("layer1x1 off is not supported");
            var groups = Number(lc.groups_input || lc.groups || 1);
            if (groups !== 1) throw new Error("grouped convolutions are not supported");
            ["conv_pre_film", "conv_post_film", "input_mixin_pre_film", "input_mixin_post_film", "activation_pre_film",
             "activation_post_film", "layer1x1_post_film", "head1x1_post_film"].forEach(function (k) {
                if (lc[k] && lc[k].active) throw new Error("FiLM layers are not supported");
            });
            var actNames = acts.map(ampActName);
            for (var q = 0; q < actNames.length; q++) if (!actNames[q]) throw new Error("activation " + JSON.stringify(acts[q]) + " is not supported");
            var inSize = Number(lc.input_size), cond = Number(lc.condition_size || 1);
            if (!(ch >= 1 && ch <= AMP_MAX_CH)) throw new Error("channels " + ch + " out of range");
            if (cond !== 1) throw new Error("condition size " + cond + " not supported");
            if (a === 0 && inSize !== 1) throw new Error("input size must be 1");
            if (a > 0 && inSize !== Number(ls[a - 1].channels)) throw new Error("layer arrays do not chain");
            if (a > 0 && prevHead !== ch) throw new Error("head size does not match the next array");
            if (!(headSize >= 1 && headSize <= AMP_MAX_CH)) throw new Error("bad head size");
            var layers = [];
            for (var l = 0; l < dil.length; l++) {
                if (!(ksz[l] >= 1 && ksz[l] <= 8) || !(dil[l] >= 1 && dil[l] <= 8192)) throw new Error("bad kernel / dilation");
                layers.push({ d: dil[l], k: ksz[l], act: actNames[l] });
                rf += (ksz[l] - 1) * dil[l];
            }
            var cz = gated ? 2 * ch : ch;
            n += inSize * ch;
            for (l = 0; l < layers.length; l++) n += cz * ch * layers[l].k + cz + cz + ch * ch + ch;
            n += ch * headSize + (headBias ? headSize : 0);
            model.layers.push({ inSize: inSize, ch: ch, head: headSize, headBias: headBias, gated: gated, layers: layers });
            prevHead = headSize;
        }
        if (prevHead !== 1) throw new Error("last head size must be 1");
        n += 1;
        if (weights.length !== n) throw new Error("expected " + n + " weights, file has " + weights.length);
        model.kind = "WaveNet";
        model.headScale = weights[n - 1];
        model.receptiveField = rf;
    } else if (arch === "LSTM") {
        var hs = Number(cfg.hidden_size), nl = Number(cfg.num_layers || 1), ins = Number(cfg.input_size || 1);
        if (ins !== 1) throw new Error("LSTM input size must be 1");
        if (!(hs >= 1 && hs <= 64) || !(nl >= 1 && nl <= 4)) throw new Error("LSTM size out of range");
        var nn = 0, ii = 1;
        for (var k = 0; k < nl; k++) { nn += 4 * hs * (ii + hs) + 4 * hs + 2 * hs; ii = hs; }
        nn += hs + 1;
        if (weights.length !== nn) throw new Error("expected " + nn + " weights, file has " + weights.length);
        model.kind = "LSTM";
        model.lstm = { hidden: hs, layers: nl };
    } else {
        throw new Error("architecture " + (arch || "?") + " is not supported");
    }
    model.nWeights = weights.length;
    if (model.nWeights > AMP_WMAX) throw new Error("model too large (" + model.nWeights + " weights)");
    if (ampRingSize(model) > AMP_MAX_RING) throw new Error("model history too large");
    return model;
}

/** Architecture key: models with the same key run on the same compiled gen. @param {any} m */
function ampArchKey(m) {
    if (m.kind === "LSTM") return "L" + m.lstm.layers + "x" + m.lstm.hidden;
    return "W" + m.layers.map(function (/** @type {any} */ a) {
        return a.ch + (a.gated ? "g" : "") + "h" + a.head + (a.headBias ? "b" : "") + ":" +
            a.layers.map(function (/** @type {any} */ l) { return l.d + (l.k !== 3 ? "k" + l.k : "") + (l.act !== "Tanh" ? l.act[0] + l.act.slice(-2) : ""); }).join(",");
    }).join("|");
}

/** Short human label, e.g. "WaveNet 16/8 · 13.8k". @param {any} m */
function ampArchLabel(m) {
    var kw = m.nWeights >= 1000 ? (m.nWeights / 1000).toFixed(1) + "k" : String(m.nWeights);
    if (m.kind === "LSTM") return "LSTM " + m.lstm.layers + "x" + m.lstm.hidden + " · " + kw;
    var preset = "";
    var chs = m.layers.map(function (/** @type {any} */ a) { return a.ch; }).join("/");
    if (chs === "16/8") preset = "Standard"; else if (chs === "12/6") preset = "Lite";
    else if (chs === "8/4") preset = "Feather"; else if (chs === "4/2") preset = "Nano";
    return (preset || "WaveNet " + chs) + " · " + kw;
}

/** @param {number} n */
function ampPow2(n) { var p = 1; while (p < n) p *= 2; return p; }

/** Doubles of history the generated WaveNet needs. @param {any} m */
function ampRingSize(m) {
    if (m.kind !== "WaveNet") return 0;
    var t = 0;
    for (var a = 0; a < m.layers.length; a++) {
        for (var l = 0; l < m.layers[a].layers.length; l++) {
            var L = m.layers[a].layers[l];
            t += m.layers[a].ch * ampPow2((L.k - 1) * L.d + 1);
        }
    }
    return t;
}

/** Number of layers drawn in telemetry. @param {any} m */
function ampLayerCount(m) {
    if (m.kind === "LSTM") return m.lstm.layers;
    var n = 0;
    for (var a = 0; a < m.layers.length; a++) n += m.layers[a].layers.length;
    return n;
}

// ---------------------------------------------------------------------------------------------
// Reference forward (double precision). Tests only; the faces never call it.

/**
 * NAM's fast tanh (nam::activations::fast_tanh, what the NAM plugin uses by default): a rational approximation,
 * within 9e-4 of tanh for |x| <= 12 (it tends to 1.008, not 1), several times cheaper than tanh in gen. WaveNet Tanh / Fasttanh activations use it (in the gen
 * and in ampForward); LSTM gates keep the exact tanh / sigmoid.
 * @param {number} x
 */
function ampFastTanh(x) {
    var ax = Math.abs(x), x2 = x * x;
    return x * (2.45550750702956 + 2.45550750702956 * ax + (0.893229853513558 + 0.821226666969744 * ax) * x2)
        / (2.44506634652299 + (2.44506634652299 + x2) * Math.abs(x + 0.814642734961073 * x * ax));
}

/** @param {string} name @param {number} x @param {boolean} [exact] exact tanh (the torch comparison) */
function ampAct(name, x, exact) {
    switch (name) {
        case "Tanh": case "Fasttanh": return exact ? Math.tanh(x) : ampFastTanh(x);
        case "ReLU": return x > 0 ? x : 0;
        case "LeakyReLU": return x > 0 ? x : 0.01 * x;
        case "Sigmoid": return 1 / (1 + Math.exp(-x));
        case "Hardtanh": return x < -1 ? -1 : (x > 1 ? 1 : x);
        case "SiLU": return x / (1 + Math.exp(-x));
        case "Softsign": return x / (1 + Math.abs(x));
    }
    return x;
}

/**
 * @param {any} m model from ampParseNam
 * @param {ArrayLike<number>} x input samples
 * @param {{exactTanh?: boolean}} [opts] exactTanh: Math.tanh instead of the fast tanh the gen runs (the torch comparison)
 * @returns {number[]}
 */
function ampForward(m, x, opts) {
    var exact = !!(opts && opts.exactTanh);
    var w = m.weights, out = [];
    if (m.kind === "LSTM") {
        var H = m.lstm.hidden, NL = m.lstm.layers, p = 0, cells = [];
        for (var l = 0; l < NL; l++) {
            var I = l === 0 ? 1 : H;
            var cell = { I: I, W: p, B: p + 4 * H * (I + H), h: [], c: [] };
            p = cell.B + 4 * H;
            for (var j = 0; j < H; j++) cell.h.push(w[p + j]);
            for (j = 0; j < H; j++) cell.c.push(w[p + H + j]);
            p += 2 * H;
            cells.push(cell);
        }
        var headW = p, headB = p + H;
        for (var t = 0; t < x.length; t++) {
            var inp = [x[t]];
            for (l = 0; l < NL; l++) {
                var C = cells[l], z = [];
                for (var g = 0; g < 4 * H; g++) {
                    var s = w[C.B + g], row = C.W + g * (C.I + H);
                    for (j = 0; j < C.I; j++) s += w[row + j] * inp[j];
                    for (j = 0; j < H; j++) s += w[row + C.I + j] * C.h[j];
                    z.push(s);
                }
                for (j = 0; j < H; j++) {
                    var ig = 1 / (1 + Math.exp(-z[j])), fg = 1 / (1 + Math.exp(-z[H + j]));
                    var gg = Math.tanh(z[2 * H + j]), og = 1 / (1 + Math.exp(-z[3 * H + j]));
                    C.c[j] = fg * C.c[j] + ig * gg;
                    C.h[j] = og * Math.tanh(C.c[j]);
                }
                inp = C.h.slice();
            }
            var y = w[headB];
            for (j = 0; j < H; j++) y += w[headW + j] * inp[j];
            out.push(y);
        }
        return out;
    }
    // WaveNet: per array weight pointers, then a sample loop with full history arrays.
    var arrs = [], q = 0;
    for (var a = 0; a < m.layers.length; a++) {
        var A = m.layers[a], cz = A.gated ? 2 * A.ch : A.ch;
        var info = { A: A, rech: q, ls: /** @type {any[]} */ ([]), head: 0, headB: -1, hist: /** @type {number[][][]} */ ([]) };
        q += A.inSize * A.ch;
        for (var li = 0; li < A.layers.length; li++) {
            var L = A.layers[li];
            var lw = { conv: q, convB: q + cz * A.ch * L.k, mix: 0, w1: 0, b1: 0 };
            lw.mix = lw.convB + cz;
            lw.w1 = lw.mix + cz;
            lw.b1 = lw.w1 + A.ch * A.ch;
            q = lw.b1 + A.ch;
            info.ls.push(lw);
            info.hist.push([]);
        }
        info.head = q;
        q += A.ch * A.head;
        if (A.headBias) { info.headB = q; q += A.head; }
        arrs.push(info);
    }
    var headScale = w[q];
    for (t = 0; t < x.length; t++) {
        var xin = [x[t]], cnd = x[t], headIn = null;
        for (a = 0; a < arrs.length; a++) {
            var R = arrs[a], A2 = R.A, ch = A2.ch, czz = A2.gated ? 2 * ch : ch;
            var v = [];
            for (var c = 0; c < ch; c++) {
                var sv = 0;
                for (var i = 0; i < A2.inSize; i++) sv += w[R.rech + c * A2.inSize + i] * xin[i];
                v.push(sv);
            }
            var hacc = [];
            for (c = 0; c < ch; c++) hacc.push(headIn ? headIn[c] : 0);
            for (li = 0; li < A2.layers.length; li++) {
                var LL = A2.layers[li], W = R.ls[li], hist = R.hist[li];
                hist.push(v.slice());
                var zz = [];
                for (var o = 0; o < czz; o++) {
                    var sz = w[W.convB + o] + w[W.mix + o] * cnd;
                    for (i = 0; i < ch; i++) {
                        for (var k = 0; k < LL.k; k++) {
                            var back = (LL.k - 1 - k) * LL.d;
                            var hv = hist.length - 1 - back >= 0 ? hist[hist.length - 1 - back][i] : 0;
                            sz += w[W.conv + (o * ch + i) * LL.k + k] * hv;
                        }
                    }
                    zz.push(sz);
                }
                var pa = [];
                for (o = 0; o < ch; o++) {
                    var av = ampAct(LL.act, zz[o], exact);
                    if (A2.gated) av *= 1 / (1 + Math.exp(-zz[o + ch]));
                    pa.push(av);
                    hacc[o] += av;
                }
                var nv = [];
                for (o = 0; o < ch; o++) {
                    var s1 = w[W.b1 + o];
                    for (i = 0; i < ch; i++) s1 += w[W.w1 + o * ch + i] * pa[i];
                    nv.push(v[o] + s1);
                }
                v = nv;
                var maxBack = (LL.k - 1) * LL.d + 1;
                if (hist.length > maxBack + 8) hist.splice(0, hist.length - maxBack - 1);
            }
            var hout = [];
            for (var h = 0; h < A2.head; h++) {
                var sh = R.headB >= 0 ? w[R.headB + h] : 0;
                for (c = 0; c < ch; c++) sh += w[R.head + h * ch + c] * hacc[c];
                hout.push(sh);
            }
            headIn = hout;
            xin = v;
        }
        out.push(headScale * headIn[0]);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// GenExpr generation

/** @param {string} name @param {string} x */
function ampGenAct(name, x) {
    switch (name) {
        case "Tanh": case "Fasttanh":   // ampFastTanh; `x` is a local, read several times
            return "(" + x + " * (2.45550750702956 + 2.45550750702956 * abs(" + x + ") + (0.893229853513558 + 0.821226666969744 * abs(" + x + ")) * " + x + " * " + x
                + ") / (2.44506634652299 + (2.44506634652299 + " + x + " * " + x + ") * abs(" + x + " + 0.814642734961073 * " + x + " * abs(" + x + "))))";
        case "ReLU": return "max(" + x + ", 0)";
        case "LeakyReLU": return "(" + x + " > 0 ? " + x + " : 0.01 * " + x + ")";
        case "Sigmoid": return "(1 / (1 + exp(-(" + x + "))))";
        case "Hardtanh": return "clip(" + x + ", -1, 1)";
        case "SiLU": return "(" + x + " / (1 + exp(-(" + x + "))))";
        case "Softsign": return "(" + x + " / (1 + abs(" + x + ")))";
    }
    return x;
}

/**
 * GenExpr for one architecture. Returns {decl, locals, body, layers, nWeights}: `decl` goes where the template has
 * //@NAM_DECL (Data declarations), `locals` where it has //@NAM_LOCALS (top-level zero assignments of the
 * unrolled temporaries, so they are visible inside every block), `body` where it has //@NAM_BODY. The body runs
 * the network once per channel (`nch` = 1 mono, 2 stereo): channel `chn` reads its input from Data `nib` and
 * writes its output into Data `nob`; the recurrent / history state is per channel (offset `so`), scratch is
 * shared. It reads the weights from Data `wd` (the template copies the active bank of buffer~ ---ampw into it,
 * a slice per sample, on a model switch), `tp` (sample counter), `ninit` (1 on the first sample after a model
 * switch) and assigns `nsat` (mean |activation| of the first layer array).
 *
 * Speed (the per-sample cost is almost all multiply-adds): small WaveNets (AMP_FULL_UNROLL_MACS) are fully
 * unrolled, with constant weight indices, taps / activations in locals and the residual updated in place; bigger
 * ones keep a loop per dot product (ampGenWaveLoop). LSTMs keep the gate loop and unroll its inner sums over the
 * hidden state gathered into locals (8 x LSTM 1x16: 17.4 % -> 11.2 % adstatus cpu in the VM).
 * @param {any} m
 * @param {{fullMacs?: number}} [opts] test hook: override AMP_FULL_UNROLL_MACS
 */
function ampGenNam(m, opts) {
    var g = ampGenNamRaw(m, opts);
    var body = g.init + (g.init ? "\n" : "")
        + "for (chn = 0; chn < nch; chn += 1) {\n"
        + "xin = peek(nib, chn);\n"
        + "so = chn * " + g.state + ";\n"
        + g.body + "\n"
        + "poke(nob, nout, chn);\n"
        + "}";
    return { decl: "Data wd(" + m.nWeights + ");\n" + g.decl, locals: g.locals, body: body, layers: g.layers, nWeights: m.nWeights };
}

/**
 * WaveNets with at most this many multiply-adds per sample (Nano 656, Feather 2624: every built-in) are generated fully
 * unrolled: every weight index a constant, the taps and activations in locals. Bigger ones (Lite 5904, Standard 12800)
 * keep one loop per dot product (ampGenWaveLoop): a fully unrolled Standard (340 KB) did not compile.
 * Measured (VM, real-time adstatus cpu, 8 Feather instances): looped 10.1 / 10.6 %, fully unrolled 6.8 / 4.8 %.
 */
var AMP_FULL_UNROLL_MACS = 3000;

/** Multiply-adds per sample of a WaveNet's convolutions and 1x1s. @param {any} m */
function ampWaveMacs(m) {
    var n = 0;
    m.layers.forEach(function (/** @type {any} */ A) {
        var cz = A.gated ? 2 * A.ch : A.ch;
        A.layers.forEach(function (/** @type {any} */ Ly) { n += cz * A.ch * Ly.k + A.ch * A.ch; });
    });
    return n;
}

/**
 * The network for one channel. `init` runs once per model switch (outside the channel loop, sets the
 * state of both channels), `body` once per channel; `state` = per-channel state size (Data offset `so`).
 * @param {any} m
 * @param {{fullMacs?: number}} [opts] test hook: override AMP_FULL_UNROLL_MACS
 */
function ampGenNamRaw(m, opts) {
    var D = [], B = [], I0 = [];
    var fullMacs = opts && typeof opts.fullMacs === "number" ? opts.fullMacs : AMP_FULL_UNROLL_MACS;
    /** @type {Object<string, number>} */
    var loc = {};
    /** @param {string} name */
    function L(name) { loc[name] = 1; return name; }
    /** @param {Array<string>} terms */
    function sum(terms) { return terms.length ? terms.join(" + ") : "0"; }
    var nl = Math.min(ampLayerCount(m), AMP_MAX_LAYERS);
    D.push("Data lact(" + AMP_MAX_LAYERS + ");");
    if (m.kind === "LSTM") {
        var H = m.lstm.hidden, NL = m.lstm.layers, SZ = H * NL;
        D.push("Data hs(" + (2 * SZ) + ");", "Data cs(" + (2 * SZ) + ");", "Data gz(" + (4 * H) + ");", "Data hin(" + H + ");");
        var p = 0, cells = [];
        for (var l = 0; l < NL; l++) {
            var I = l === 0 ? 1 : H;
            var cell = { I: I, W: p, B: p + 4 * H * (I + H), H0: 0 };
            cell.H0 = cell.B + 4 * H;
            p = cell.H0 + 2 * H;
            cells.push(cell);
        }
        // Initial state from the weights on every model switch, for both channels.
        I0.push("if (ninit > 0) {");
        for (l = 0; l < NL; l++) {
            for (var half = 0; half < 2; half++) {
                var off = half * SZ + l * H;
                I0.push("  for (j = 0; j < " + H + "; j += 1) { poke(hs, peek(wd, " + cells[l].H0 + " + j), " + off + " + j); poke(cs, peek(wd, " + (cells[l].H0 + H) + " + j), " + off + " + j); }");
            }
        }
        I0.push("}");
        for (l = 0; l < NL; l++) {
            var C = cells[l], stride = C.I + H, jj;
            // The layer input (x or the previous layer's h) and this layer's h, gathered once.
            if (l > 0) for (jj = 0; jj < H; jj++) B.push(L("xq" + jj) + " = peek(hin, " + jj + ");");
            for (jj = 0; jj < H; jj++) B.push(L("hq" + jj) + " = peek(hs, so + " + (l * H + jj) + ");");
            var terms = [];
            if (l === 0) terms.push("peek(wd, row) * xin");
            else for (jj = 0; jj < H; jj++) terms.push("peek(wd, row + " + jj + ") * xq" + jj);
            for (jj = 0; jj < H; jj++) terms.push("peek(wd, row + " + (C.I + jj) + ") * hq" + jj);
            B.push("for (g = 0; g < " + (4 * H) + "; g += 1) {");
            B.push("  row = " + C.W + " + g * " + stride + ";");
            B.push("  poke(gz, peek(wd, " + C.B + " + g) + " + sum(terms) + ", g);");
            B.push("}");
            B.push("acc = 0;");
            B.push("for (j = 0; j < " + H + "; j += 1) {");
            B.push("  gi = 1 / (1 + exp(-peek(gz, j)));");
            B.push("  gf = 1 / (1 + exp(-peek(gz, " + H + " + j)));");
            B.push("  gg = tanh(peek(gz, " + (2 * H) + " + j));");
            B.push("  go = 1 / (1 + exp(-peek(gz, " + (3 * H) + " + j)));");
            B.push("  cc = gf * peek(cs, so + " + (l * H) + " + j) + gi * gg;");
            B.push("  hh = go * tanh(cc);");
            B.push("  poke(cs, cc, so + " + (l * H) + " + j); poke(hs, hh, so + " + (l * H) + " + j); poke(hin, hh, j);");
            B.push("  acc += abs(hh);");
            B.push("}");
            if (l < AMP_MAX_LAYERS) B.push("poke(lact, acc / " + H + ", " + l + ");");
            if (l === 0) B.push("nsat = acc / " + H + ";");
        }
        var ht = [];
        for (jj = 0; jj < H; jj++) ht.push("peek(wd, " + (p + jj) + ") * peek(hin, " + jj + ")");
        B.push("nout = peek(wd, " + (p + H) + ") + " + sum(ht) + ";");
        return { decl: D.join("\n"), locals: ampGenLocals(loc), init: I0.join("\n"), body: B.join("\n"), state: SZ, layers: nl };
    }
    if (ampWaveMacs(m) > fullMacs) return ampGenWaveLoop(m, D, nl);
    var maxCh = 1, ring = 0, li = 0;
    m.layers.forEach(function (/** @type {any} */ A) { maxCh = Math.max(maxCh, A.gated ? 2 * A.ch : A.ch, A.head); });
    D.push("Data va(" + maxCh + ");", "Data vh(" + maxCh + ");");
    var ringDecl = D.length;
    D.push("");
    var q = 0, c2, i2, o2;
    B.push("poke(va, xin, 0);");
    for (var a = 0; a < m.layers.length; a++) {
        var A = m.layers[a], ch = A.ch, cz = A.gated ? 2 * ch : ch;
        // Rechannel (1x1, no bias) from the previous residual (or the input) into va.
        if (A.inSize === 1) {
            for (c2 = 0; c2 < ch; c2++) B.push("poke(va, peek(wd, " + (q + c2) + ") * xin, " + c2 + ");");
        } else {
            for (i2 = 0; i2 < A.inSize; i2++) B.push(L("hq" + i2) + " = peek(va, " + i2 + ");");
            for (c2 = 0; c2 < ch; c2++) {
                var rt = [];
                for (i2 = 0; i2 < A.inSize; i2++) rt.push("peek(wd, " + (q + c2 * A.inSize + i2) + ") * hq" + i2);
                B.push("poke(va, " + sum(rt) + ", " + c2 + ");");
            }
        }
        if (a === 0) for (c2 = 0; c2 < ch; c2++) B.push("poke(vh, 0, " + c2 + ");");
        q += A.inSize * ch;
        if (a === 0) B.push("sat = 0;");
        for (var l2 = 0; l2 < A.layers.length; l2++) {
            var Ly = A.layers[l2], Lr = ampPow2((Ly.k - 1) * Ly.d + 1);
            var conv = q, convB = q + cz * ch * Ly.k, mix = convB + cz, w1 = mix + cz, b1 = w1 + ch * ch;
            q = b1 + ch;
            var rb = ring;
            ring += ch * Lr;
            var nt = ch * Ly.k, k;
            B.push("// array " + a + " layer " + l2 + " d " + Ly.d);
            // No bitwise & in GenExpr (it kills the compile): pow2 modulo by floor, then one wrap per tap.
            B.push("pos = tp - " + Lr + " * floor(tp * " + (1 / Lr) + ");");
            for (i2 = 0; i2 < ch; i2++) B.push("poke(st, peek(va, " + i2 + "), so + " + (rb + i2 * Lr) + " + pos);");
            // One wrapped read position per kernel tap, then the ch * k taps into locals.
            for (k = 0; k < Ly.k; k++) {
                var back = (Ly.k - 1 - k) * Ly.d;
                if (back === 0) B.push(L("pk" + k) + " = so + pos;");
                else B.push(L("pk" + k) + " = so + (pos < " + back + " ? pos + " + (Lr - back) + " : pos - " + back + ");");
            }
            for (i2 = 0; i2 < ch; i2++) {
                for (k = 0; k < Ly.k; k++) B.push(L("tq" + (i2 * Ly.k + k)) + " = peek(st, pk" + k + " + " + (rb + i2 * Lr) + ");");
            }
            // The dilated convolution: one sum per output channel, every weight index a constant.
            for (o2 = 0; o2 < cz; o2++) {
                var ct = [];
                for (var t2 = 0; t2 < nt; t2++) ct.push("peek(wd, " + (conv + o2 * nt + t2) + ") * tq" + t2);
                B.push(L("zq" + o2) + " = peek(wd, " + (convB + o2) + ") + peek(wd, " + (mix + o2) + ") * xin + " + sum(ct) + ";");
            }
            // Activations into locals (the 1x1 below reads them as constants), the head sum, the layer activity.
            var aa = [];
            for (o2 = 0; o2 < ch; o2++) {
                B.push(L("zv") + " = zq" + o2 + ";");
                var av = ampGenAct(Ly.act, "zv");
                if (A.gated) B.push(L("pq" + o2) + " = " + av + " / (1 + exp(-zq" + (o2 + ch) + "));");
                else B.push(L("pq" + o2) + " = " + av + ";");
                B.push("poke(vh, peek(vh, " + o2 + ") + pq" + o2 + ", " + o2 + ");");
                aa.push("abs(pq" + o2 + ")");
            }
            B.push("acc = " + sum(aa) + ";");
            if (li < AMP_MAX_LAYERS) B.push("poke(lact, acc / " + ch + ", " + li + ");");
            if (a === 0) B.push("sat += acc / " + ch + ";");
            // 1x1 + bias, added to the residual in place (output o only reads the activations and va[o]).
            for (o2 = 0; o2 < ch; o2++) {
                var pt = [];
                for (i2 = 0; i2 < ch; i2++) pt.push("peek(wd, " + (w1 + o2 * ch + i2) + ") * pq" + i2);
                B.push("poke(va, peek(va, " + o2 + ") + (peek(wd, " + (b1 + o2) + ") + " + sum(pt) + "), " + o2 + ");");
            }
            li++;
        }
        if (a === 0) B.push("nsat = sat / " + A.layers.length + ";");
        // Head rechannel: vh (ch) -> vh (head), via locals.
        var hw = q;
        q += ch * A.head;
        var hb = -1;
        if (A.headBias) { hb = q; q += A.head; }
        for (c2 = 0; c2 < ch; c2++) B.push(L("hq" + c2) + " = peek(vh, " + c2 + ");");
        for (var h2 = 0; h2 < A.head; h2++) {
            var hterms = hb >= 0 ? ["peek(wd, " + (hb + h2) + ")"] : [];
            for (c2 = 0; c2 < ch; c2++) hterms.push("peek(wd, " + (hw + h2 * ch + c2) + ") * hq" + c2);
            B.push("poke(vh, " + sum(hterms) + ", " + h2 + ");");
        }
    }
    B.push("nout = peek(wd, " + q + ") * peek(vh, 0);");
    D[ringDecl] = "Data st(" + Math.max(1, 2 * ring) + ");";
    return { decl: D.join("\n"), locals: ampGenLocals(loc), init: "", body: B.join("\n"), state: Math.max(1, ring), layers: nl };
}

/**
 * The looped WaveNet body (one loop per dot product, taps gathered into Data tv), used for models bigger than
 * AMP_FULL_UNROLL_MACS. Measured in the VM (scripts/measure_amp_cpu.py mode=rt), unrolling only the inner loops
 * of these was slower than this, not faster.
 * @param {any} m @param {Array<string>} D declarations so far @param {number} nl
 */
function ampGenWaveLoop(m, D, nl) {
    var B = [];
    var maxCh = 1, ring = 0, li = 0;
    m.layers.forEach(function (/** @type {any} */ A) { maxCh = Math.max(maxCh, A.gated ? 2 * A.ch : A.ch, A.head); });
    var maxTaps = 1;
    m.layers.forEach(function (/** @type {any} */ A) { A.layers.forEach(function (/** @type {any} */ L) { maxTaps = Math.max(maxTaps, A.ch * L.k); }); });
    D.push("Data tv(" + maxTaps + ");");
    D.push("Data va(" + maxCh + ");", "Data vz(" + maxCh + ");", "Data vp(" + maxCh + ");", "Data vh(" + maxCh + ");", "Data vt(" + maxCh + ");");
    var ringDecl = D.length;
    D.push("");
    var q = 0;
    B.push("poke(va, xin, 0);");
    for (var a = 0; a < m.layers.length; a++) {
        var A = m.layers[a], ch = A.ch, cz = A.gated ? 2 * ch : ch;
        // Rechannel (1x1, no bias) from the previous residual (or the input) into vt, then va.
        B.push("for (c = 0; c < " + ch + "; c += 1) {");
        B.push("  s = 0;");
        if (A.inSize === 1) B.push("  s = peek(wd, " + q + " + c) * xin;");
        else B.push("  for (i = 0; i < " + A.inSize + "; i += 1) { s += peek(wd, " + q + " + c * " + A.inSize + " + i) * peek(va, i); }");
        B.push("  poke(vt, s, c);");
        B.push("}");
        B.push("for (c = 0; c < " + ch + "; c += 1) { poke(va, peek(vt, c), c); " + (a === 0 ? "poke(vh, 0, c);" : "") + " }");
        q += A.inSize * ch;
        if (a === 0) B.push("sat = 0;");
        for (var l2 = 0; l2 < A.layers.length; l2++) {
            var L = A.layers[l2], Lr = ampPow2((L.k - 1) * L.d + 1);
            var conv = q, convB = q + cz * ch * L.k, mix = convB + cz, w1 = mix + cz, b1 = w1 + ch * ch;
            q = b1 + ch;
            var rb = ring;
            ring += ch * Lr;
            B.push("// array " + a + " layer " + l2 + " d " + L.d);
            // No bitwise & in GenExpr (it kills the compile): pow2 modulo by floor, then one wrap per tap.
            B.push("pos = tp - " + Lr + " * floor(tp * " + (1 / Lr) + ");");
            B.push("for (i = 0; i < " + ch + "; i += 1) { poke(st, peek(va, i), so + " + rb + " + i * " + Lr + " + pos); }");
            // Gather the ch * k taps once (tv), then each output channel is one contiguous dot product.
            var nt = ch * L.k;
            B.push("for (i = 0; i < " + ch + "; i += 1) {");
            B.push("  rr = so + " + rb + " + i * " + Lr + ";");
            for (var k = 0; k < L.k; k++) {
                var back = (L.k - 1 - k) * L.d;
                if (back === 0) {
                    B.push("  poke(tv, peek(st, rr + pos), i * " + L.k + " + " + k + ");");
                } else {
                    B.push("  pb = pos - " + back + ";");
                    B.push("  poke(tv, peek(st, rr + (pb < 0 ? pb + " + Lr + " : pb)), i * " + L.k + " + " + k + ");");
                }
            }
            B.push("}");
            B.push("for (o = 0; o < " + cz + "; o += 1) {");
            B.push("  s = peek(wd, " + convB + " + o) + peek(wd, " + mix + " + o) * xin;");
            B.push("  wo = " + conv + " + o * " + nt + ";");
            B.push("  for (j = 0; j < " + nt + "; j += 1) { s += peek(wd, wo + j) * peek(tv, j); }");
            B.push("  poke(vz, s, o);");
            B.push("}");
            B.push("acc = 0;");
            B.push("for (o = 0; o < " + ch + "; o += 1) {");
            B.push("  zv = peek(vz, o);");
            var av = ampGenAct(L.act, "zv");
            if (A.gated) B.push("  av = " + av + " / (1 + exp(-peek(vz, o + " + ch + ")));");
            else B.push("  av = " + av + ";");
            B.push("  poke(vp, av, o); poke(vh, peek(vh, o) + av, o); acc += abs(av);");
            B.push("}");
            if (li < AMP_MAX_LAYERS) B.push("poke(lact, acc / " + ch + ", " + li + ");");
            if (a === 0) B.push("sat += acc / " + ch + ";");
            B.push("for (o = 0; o < " + ch + "; o += 1) {");
            B.push("  s = peek(wd, " + b1 + " + o);");
            B.push("  for (i = 0; i < " + ch + "; i += 1) { s += peek(wd, " + w1 + " + o * " + ch + " + i) * peek(vp, i); }");
            B.push("  poke(vt, peek(va, o) + s, o);");
            B.push("}");
            B.push("for (o = 0; o < " + ch + "; o += 1) { poke(va, peek(vt, o), o); }");
            li++;
        }
        if (a === 0) B.push("nsat = sat / " + A.layers.length + ";");
        // Head rechannel: vh (ch) -> vt (head), then vh = vt for the next array.
        var hw = q;
        q += ch * A.head;
        var hb = -1;
        if (A.headBias) { hb = q; q += A.head; }
        B.push("for (h = 0; h < " + A.head + "; h += 1) {");
        B.push("  s = " + (hb >= 0 ? "peek(wd, " + hb + " + h)" : "0") + ";");
        B.push("  for (c = 0; c < " + ch + "; c += 1) { s += peek(wd, " + hw + " + h * " + ch + " + c) * peek(vh, c); }");
        B.push("  poke(vt, s, h);");
        B.push("}");
        B.push("for (h = 0; h < " + A.head + "; h += 1) { poke(vh, peek(vt, h), h); }");
    }
    B.push("nout = peek(wd, " + q + ") * peek(vh, 0);");
    D[ringDecl] = "Data st(" + Math.max(1, 2 * ring) + ");";
    return { decl: D.join("\n"), locals: "", init: "", body: B.join("\n"), state: Math.max(1, ring), layers: nl };
}

/** Zero assignments of the generated locals, for the template's top level. @param {Object<string, number>} loc */
function ampGenLocals(loc) {
    var names = Object.keys(loc);
    var out = [];
    for (var i = 0; i < names.length; i += 16) out.push(names.slice(i, i + 16).map(function (n) { return n + " = 0;"; }).join(" "));
    return out.join("\n");
}

/**
 * Full gen code for a model: the template with the NAM part filled in.
 * @param {string} template src/amp_core.genexpr (comments stripped by the build)
 * @param {any} m
 * @param {{fullMacs?: number}} [opts] test hook: override AMP_FULL_UNROLL_MACS
 */
function ampGenCode(template, m, opts) {
    var g = ampGenNam(m, opts);
    // Placeholders only count on a line of their own (the template's comments mention them too).
    return template.replace(/^[ \t]*\/\/@NAM_DECL[ \t]*$/m, function () { return g.decl; })
        .replace(/^[ \t]*\/\/@NAM_LOCALS[ \t]*$/m, function () { return g.locals; })
        .replace(/^[ \t]*\/\/@NAM_BODY[ \t]*$/m, function () { return g.body; })
        .split("@@NLAYERS@@").join(String(g.layers)).split("@@RF@@").join(String(m.receptiveField || 1))
        .split("@@NW@@").join(String(g.nWeights));
}

/** The gen patcher (in 1 / in 2 -> codebox -> out 1 / out 2) as .gendsp JSON. @param {string} code */
function ampGendsp(code) {
    /** @param {string} id @param {string} text @param {number} x @param {number} y @param {number} ni @param {number} no @param {any} [extra] */
    function b(id, text, x, y, ni, no, extra) {
        var box = { id: id, maxclass: "newobj", numinlets: ni, numoutlets: no, outlettype: [], patching_rect: [x, y, 200, 22], text: text };
        for (var i = 0; i < no; i++) box.outlettype.push("");
        if (extra) { for (var k in extra) box[k] = extra[k]; }
        return { box: box };
    }
    var code0 = b("obj-code", "", 20, 60, 2, 2, { maxclass: "codebox", code: code, fontname: "<Monospaced>", fontsize: 12 });
    delete code0.box.text;
    return JSON.stringify({ patcher: {
        fileversion: 1, appversion: { major: 9, minor: 1, revision: 0, architecture: "x64", modernui: 1 },
        classnamespace: "dsp.gen", rect: [50, 50, 600, 450],
        boxes: [b("obj-in1", "in 1", 20, 20, 0, 1), b("obj-in2", "in 2", 120, 20, 0, 1), code0,
            b("obj-out1", "out 1", 20, 400, 1, 0), b("obj-out2", "out 2", 120, 400, 1, 0)],
        lines: [
            { patchline: { source: ["obj-in1", 0], destination: ["obj-code", 0] } },
            { patchline: { source: ["obj-in2", 0], destination: ["obj-code", 1] } },
            { patchline: { source: ["obj-code", 0], destination: ["obj-out1", 0] } },
            { patchline: { source: ["obj-code", 1], destination: ["obj-out2", 0] } }
        ]
    } });
}

/** Small stable hash (FNV-1a, hex). @param {string} s */
function ampHash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ("00000000" + h.toString(16)).slice(-8);
}

// ---------------------------------------------------------------------------------------------
// Tone stack and cab (RBJ biquads; the engine writes them into ---ampcf, faces draw their response)

/**
 * @param {string} type "ls" | "hs" | "pk" | "lp" | "hp"
 * @param {number} f @param {number} q @param {number} gdb @param {number} sr
 * @returns {number[]} [b0, b1, b2, a1, a2]
 */
function ampBiquad(type, f, q, gdb, sr) {
    var A = Math.pow(10, gdb / 40), w0 = 2 * Math.PI * Math.min(f, sr * 0.45) / sr;
    var cw = Math.cos(w0), sw = Math.sin(w0), al = sw / (2 * q);
    var b0, b1, b2, a0, a1, a2;
    if (type === "pk") {
        b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
    } else if (type === "ls" || type === "hs") {
        var sA = 2 * Math.sqrt(A) * al, s = type === "ls" ? 1 : -1;
        b0 = A * ((A + 1) - s * (A - 1) * cw + sA);
        b1 = 2 * s * A * ((A - 1) - s * (A + 1) * cw);
        b2 = A * ((A + 1) - s * (A - 1) * cw - sA);
        a0 = (A + 1) + s * (A - 1) * cw + sA;
        a1 = -2 * s * ((A - 1) + s * (A + 1) * cw);
        a2 = (A + 1) + s * (A - 1) * cw - sA;
    } else if (type === "lp") {
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
    } else if (type === "hp") {
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al;
    } else {
        return [1, 0, 0, 0, 0];
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

// Cab voicings: [type, f, q, gain dB] x up to 6 (the rest is identity).
/** @type {Array<Array<[string, number, number, number]>>} */
var AMP_CABS = [
    [],
    [["hp", 75, 0.71, 0], ["pk", 115, 1.1, 3], ["pk", 2300, 1.2, 4], ["pk", 3900, 2.5, -5], ["lp", 5600, 0.75, 0], ["lp", 7200, 0.6, 0]],
    [["hp", 95, 0.8, 0], ["pk", 125, 1.0, 5], ["pk", 420, 1.0, -3], ["pk", 1800, 1.3, 3], ["lp", 4300, 0.8, 0], ["lp", 5200, 0.6, 0]],
    [["hp", 85, 0.71, 0], ["pk", 160, 1.0, 2], ["pk", 1200, 1.0, -2], ["pk", 2800, 1.5, 5], ["lp", 6500, 0.9, 0], ["lp", 8500, 0.6, 0]]
];

/**
 * All 10 biquads for the current tone settings. @param {any} p raw parameter values @param {number} sr
 * @returns {number[][]}
 */
function ampToneBiquads(p, sr) {
    var out = [
        ampBiquad("ls", 150, 0.707, 4 * (Number(p.bass) - 5), sr),
        ampBiquad("pk", 425, 0.707, 3 * (Number(p.mid) - 5), sr),
        ampBiquad("hs", 1800, 0.707, 2 * (Number(p.treble) - 5), sr),
        ampBiquad("hs", 4500, 0.707, 1.6 * (Number(p.presence) - 5), sr)
    ];
    var cab = AMP_CABS[Math.max(0, Math.min(3, Math.round(Number(p.cab) || 0)))] || [];
    for (var i = 0; i < 6; i++) {
        var c = cab[i];
        out.push(c ? ampBiquad(c[0], c[1], c[2], c[3], sr) : [1, 0, 0, 0, 0]);
    }
    return out;
}

/** Magnitude in dB of a biquad list at f. @param {number[][]} bqs @param {number} f @param {number} sr */
function ampResponseDb(bqs, f, sr) {
    var w0 = 2 * Math.PI * f / sr, cr = Math.cos(w0), ci = -Math.sin(w0), c2r = Math.cos(2 * w0), c2i = -Math.sin(2 * w0);
    var mag = 1;
    for (var i = 0; i < bqs.length; i++) {
        var b = bqs[i];
        var nr = b[0] + b[1] * cr + b[2] * c2r, ni = b[1] * ci + b[2] * c2i;
        var dr = 1 + b[3] * cr + b[4] * c2r, di = b[3] * ci + b[4] * c2i;
        mag *= Math.sqrt((nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di));
    }
    return 20 * Math.log(Math.max(1e-12, mag)) / Math.LN10;
}

/** Normalize gain in dB for a model (NAM: loudness -> -18 dB). @param {any} m */
function ampNormDb(m) {
    if (!m || m.loudness == null || !isFinite(m.loudness)) return 0;
    return Math.max(-36, Math.min(36, AMP_NORM_TARGET_DB - m.loudness));
}

var ampNodeModule = (typeof module !== "undefined") ? module : undefined;
if (ampNodeModule && ampNodeModule.exports) ampNodeModule.exports = {
    AMP_VERSION: AMP_VERSION, AMP_WBANK: AMP_WBANK, AMP_SCOPE: AMP_SCOPE, AMP_PARAMS: AMP_PARAMS, AMP_PARAM_KEYS: AMP_PARAM_KEYS,
    AMP_NBQ: AMP_NBQ, AMP_CF_SAMPS: AMP_CF_SAMPS, AMP_CABS: AMP_CABS, AMP_MAX_LAYERS: AMP_MAX_LAYERS,
    ampParseNam: ampParseNam, ampForward: ampForward, ampFastTanh: ampFastTanh, ampGenNam: ampGenNam, ampGenCode: ampGenCode, ampWaveMacs: ampWaveMacs, ampGendsp: ampGendsp,
    ampArchKey: ampArchKey, ampArchLabel: ampArchLabel, ampRingSize: ampRingSize, ampLayerCount: ampLayerCount,
    ampHash: ampHash, ampBiquad: ampBiquad, ampToneBiquads: ampToneBiquads, ampResponseDb: ampResponseDb,
    ampNormDb: ampNormDb, AMP_FILE_INDEX: AMP_FILE_INDEX, ampGenValue: ampGenValue, ampAct: ampAct
};
