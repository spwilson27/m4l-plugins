// Deviate IR bank (Node-requirable; concatenated into the engine v8ui script AFTER src/deviate_config.js).
//
// Ten procedural stereo impulse responses (deterministic, mulberry32 via dvRng), ordered tight -> weird -> big, plus the
// partition spectra the convolution engine (two-stage uniform partitioning, DV_CONV) needs, packed into the buffer
// ---deviateir (DV_IR: 128-float header, then the spectra of the IRs tightly packed in order).
//
// Engine usage (everything runs on a Task, nothing blocks):
//   var b = dvIrBuilder(sr);              // sr = the DSP sample rate; b.plan is the layout (dvIrPlan(sr))
//   // every Task tick (~10 ms apart):    b.step(2);   // do up to 2 work units (each unit is a few ms: one channel/part
//   //                                                 // of an IR, its post-processing, or one partition spectrum)
//   // until b.done() is true. Then write the chunks, a few per tick:
//   var c = b.chunks();                   // array of {offset, data: Float32Array}, each <= 8192 floats, body chunks tile
//   //                                    // [DV_IR.HDR, DV_IR.HDR + plan.total) in order, the LAST chunk is the header
//   //                                    // (offset 0, DV_IR.HDR floats, VER = 0 and READY = 0 in it).
//   //   buffer.poke(1, c[i].offset, Array.from(c[i].data))   // header chunk last; the engine then sets VER (bumped) and READY.
// `b.progress()` is 0..1. `b.irs` holds the fitted IRs ({name, L, R, len}) once generated (for display / view data).
//
// No Math.random, no Date. Depends on deviate_config.js only (copies of the radix-2 FFT and the packed L + jR
// partition-spectrum routine live here under dv names).

var dvIrCfg = (typeof DV_IR !== "undefined")
    ? { IR: DV_IR, CONV: DV_CONV, dvRng: dvRng }
    : (function () {
        // Node tests: load the config next to this file (module.require keeps this file a plain global script for tsc)
        var c = /** @type {any} */ (typeof module !== "undefined" ? module : undefined).require("./deviate_config");
        return { IR: c.DV_IR, CONV: c.DV_CONV, dvRng: c.dvRng };
    })();

var DV_IR_CAP = 98304; // samples per IR (48 partitions of 2048)
var DV_IR_FADE_SEC = 0.005;
var DV_IR_MAX_SEC = 2.0;

/** @type {Array<{name: string, dur: number, seed: number, parts: number}>} */
var DV_IR_TABLE = [
    { name: "Tight Room", dur: 0.25, seed: 1101, parts: 1 },
    { name: "Booth", dur: 0.4, seed: 1202, parts: 1 },
    { name: "Gated Burst", dur: 0.35, seed: 1303, parts: 1 },
    { name: "Small Plate", dur: 0.8, seed: 1404, parts: 1 },
    { name: "Spring", dur: 1.2, seed: 1505, parts: 1 },
    { name: "Reverse", dur: 1.0, seed: 1606, parts: 1 },
    { name: "Big Plate", dur: 1.8, seed: 1707, parts: 1 },
    { name: "Tuned", dur: 1.5, seed: 1808, parts: 2 },
    { name: "Metal", dur: 1.6, seed: 1909, parts: 1 },
    { name: "Hall", dur: 2.0, seed: 2010, parts: 1 },
];

/** @returns {string[]} */
function dvIrNames() {
    return DV_IR_TABLE.map(function (t) { return t.name; });
}

// ---- FFT (copy of rpFft) ---------------------------------------------------------------------------------------------
/** @type {Object<number, {c: Float64Array, s: Float64Array}>} */
var dvTwiddles = {};

/**
 * In-place radix-2 FFT.
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @param {number} n power of two
 * @param {boolean} [inverse]
 */
function dvFft(re, im, n, inverse) {
    var tw = dvTwiddles[n];
    if (!tw) {
        tw = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
        for (var k0 = 0; k0 < n / 2; k0++) {
            tw.c[k0] = Math.cos(2 * Math.PI * k0 / n);
            tw.s[k0] = -Math.sin(2 * Math.PI * k0 / n);
        }
        dvTwiddles[n] = tw;
    }
    for (var i = 1, j = 0; i < n; i++) {
        var bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            var t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    var sg = inverse ? -1 : 1;
    for (var len = 2; len <= n; len <<= 1) {
        var half = len >> 1;
        var step = n / len;
        for (var s = 0; s < n; s += len) {
            for (var k = 0; k < half; k++) {
                var wr = tw.c[k * step];
                var wi = sg * tw.s[k * step];
                var a = s + k;
                var b = a + half;
                var tr = re[b] * wr - im[b] * wi;
                var ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr; im[b] = im[a] - ti;
                re[a] += tr; im[a] += ti;
            }
        }
    }
}

/**
 * Spectrum of one partition (offset `off`, `size` samples) of the stereo IR, zero-padded to n = 2 size,
 * as [Lre, Lim, Rre, Rim] for bins 0..n/2 (one packed FFT of L + jR, then unpacked).
 * @param {Float64Array} L
 * @param {Float64Array} R
 * @param {number} off
 * @param {number} size
 * @param {Float32Array} dst
 * @param {number} dstOff
 */
function dvPartitionSpectrum(L, R, off, size, dst, dstOff) {
    var n = 2 * size;
    var re = new Float64Array(n);
    var im = new Float64Array(n);
    for (var i = 0; i < size && off + i < L.length; i++) { re[i] = L[off + i]; im[i] = R[off + i]; }
    dvFft(re, im, n, false);
    for (var k = 0; k <= n / 2; k++) {
        var nk = (n - k) % n;
        var o = dstOff + k * 4;
        dst[o] = (re[k] + re[nk]) * 0.5;
        dst[o + 1] = (im[k] - im[nk]) * 0.5;
        dst[o + 2] = (im[k] + im[nk]) * 0.5;
        dst[o + 3] = -(re[k] - re[nk]) * 0.5;
    }
}

// ---- generators ------------------------------------------------------------------------------------------------------
/**
 * Decaying noise with a one-pole low-pass whose cutoff glides exponentially from fc0 to fc1.
 * @param {() => number} rng
 * @param {Float64Array} out
 * @param {number} sr
 * @param {number} rt60 seconds
 * @param {number} fc0 Hz
 * @param {number} fc1 Hz
 * @param {number} startSamp first sample of the tail
 * @param {number} amp
 */
function dvAddNoiseTail(rng, out, sr, rt60, fc0, fc1, startSamp, amp) {
    var len = out.length;
    var n = len - startSamp;
    var y = 0;
    for (var i = 0; i < n; i++) {
        var t = i / sr;
        var env = Math.pow(10, -3 * t / rt60);
        var x = (2 * rng() - 1) * env * amp;
        var fc = fc0 * Math.pow(fc1 / fc0, i / Math.max(1, n - 1));
        var a = 1 - Math.exp(-2 * Math.PI * Math.min(fc, 0.45 * sr) / sr);
        y += a * (x - y);
        out[startSamp + i] += y;
    }
}

/**
 * Sparse early reflections.
 * @param {() => number} rng
 * @param {Float64Array} out
 * @param {number} sr
 * @param {number} count
 * @param {number} t0 ms
 * @param {number} t1 ms
 * @param {number} amp
 * @param {number} tau seconds (amplitude decay of the taps)
 */
function dvAddEarly(rng, out, sr, count, t0, t1, amp, tau) {
    for (var k = 0; k < count; k++) {
        var ms = t0 + (t1 - t0) * Math.pow(rng(), 1.3);
        var idx = Math.round(ms * 0.001 * sr);
        if (idx >= out.length) continue;
        var sgn = rng() < 0.5 ? -1 : 1;
        out[idx] += sgn * amp * Math.exp(-ms * 0.001 / tau) * (0.5 + 0.5 * rng());
    }
}

/**
 * Feedback comb in place.
 * @param {Float64Array} x
 * @param {number} d delay samples
 * @param {number} g feedback
 */
function dvComb(x, d, g) {
    for (var i = d; i < x.length; i++) x[i] += g * x[i - d];
}

/**
 * Generate one channel (or one part of it) of IR `idx` into `out` (accumulating; part 0 starts from zeros).
 * @param {number} idx IR index
 * @param {number} ch 0 = L, 1 = R
 * @param {number} part
 * @param {Float64Array} out
 * @param {number} sr
 */
function dvGenChannel(idx, ch, part, out, sr) {
    var t = DV_IR_TABLE[idx];
    var rng = dvIrCfg.dvRng(t.seed * 7 + ch * 1000003 + part * 77);
    var len = out.length;
    var i, k;
    switch (idx) {
        case 0: // Tight Room
            dvAddNoiseTail(rng, out, sr, 0.14, 9000, 2500, Math.round(0.0015 * sr), 1);
            dvAddEarly(rng, out, sr, 10, 1, 18, 1.2, 0.02);
            break;
        case 1: // Booth
            dvAddNoiseTail(rng, out, sr, 0.22, 5500, 1500, Math.round(0.002 * sr), 1);
            dvAddEarly(rng, out, sr, 8, 1.5, 22, 1.0, 0.03);
            break;
        case 2: // Gated Burst: loud noise burst, abrupt gate (applied in post)
            dvAddNoiseTail(rng, out, sr, 1.2, 12000, 6000, 0, 1);
            break;
        case 3: // Small Plate: bright noise plus three metallic combs
            dvAddNoiseTail(rng, out, sr, 0.75, 14000, 5000, Math.round(0.001 * sr), 1);
            dvAddEarly(rng, out, sr, 6, 1, 12, 0.5, 0.05);
            dvComb(out, Math.round((7.1 + ch * 0.4) * 0.001 * sr), 0.5);
            dvComb(out, Math.round((11.3 + ch * 0.6) * 0.001 * sr), 0.45);
            dvComb(out, Math.round((17.9 + ch * 0.9) * 0.001 * sr), 0.4);
            break;
        case 4: { // Spring: chirped echoes every ~33 ms
            var spacing = Math.round((33 + ch * 1.6) * 0.001 * sr);
            var cl = Math.round(0.02 * sr);
            for (var e = 0; e * spacing < len; e++) {
                var amp = Math.pow(0.84, e);
                if (amp < 1e-4) break;
                var ph = 0;
                var f0 = 3600 + 200 * ch, f1 = 220;
                for (i = 0; i < cl && e * spacing + i < len; i++) {
                    var u = i / cl;
                    var fr = f0 * Math.pow(f1 / f0, u);
                    ph += 2 * Math.PI * fr / sr;
                    out[e * spacing + i] += amp * Math.sin(ph) * Math.sin(Math.PI * u) * (e & 1 ? -1 : 1);
                }
            }
            dvAddNoiseTail(rng, out, sr, 0.5, 4000, 1200, 0, 0.08);
            break;
        }
        case 5: { // Reverse: a decaying tail played backwards
            var tmp = new Float64Array(len);
            dvAddNoiseTail(rng, tmp, sr, 0.33, 9000, 2500, 0, 1);
            dvAddEarly(rng, tmp, sr, 12, 1, 120, 1.0, 0.1);
            for (i = 0; i < len; i++) out[i] += tmp[len - 1 - i];
            break;
        }
        case 6: // Big Plate
            dvAddNoiseTail(rng, out, sr, 1.5, 16000, 6000, Math.round(0.002 * sr), 1);
            dvAddEarly(rng, out, sr, 8, 2, 25, 0.6, 0.08);
            break;
        case 7: { // Tuned: 32 harmonics of 110 Hz, L / R detuned (two parts of 16)
            var f0h = 110 * (ch ? 1.004 : 1);
            for (k = part * 16 + 1; k <= part * 16 + 16; k++) {
                var f = f0h * k;
                if (f > 0.45 * sr) break;
                var w = 2 * Math.PI * f / sr;
                var cw = Math.cos(w), sw = Math.sin(w);
                var phi = rng() * 2 * Math.PI;
                var x = Math.cos(phi), y = Math.sin(phi);
                var rt = 0.8 + 0.6 * rng();
                var df = Math.pow(10, -3 / (rt * sr));
                var a0 = 1 / k, env = a0;
                for (i = 0; i < len; i++) {
                    out[i] += env * x;
                    var nx = x * cw - y * sw;
                    y = x * sw + y * cw; x = nx;
                    env *= df;
                }
            }
            if (part === 0) dvAddNoiseTail(rng, out, sr, 0.25, 6000, 1500, 0, 0.05);
            break;
        }
        case 8: { // Metal: inharmonic bar modes
            var base = 210 * (ch ? 1.037 : 1);
            for (k = 0; k < 24; k++) {
                var ratio = Math.pow((k + 1.5) / 1.5, 2.0) * (1 + 0.013 * (rng() - 0.5));
                var fm = base * ratio;
                if (fm > 0.45 * sr) break;
                var wm = 2 * Math.PI * fm / sr;
                var cm = Math.cos(wm), sm = Math.sin(wm);
                var pm = rng() * 2 * Math.PI;
                var xm = Math.cos(pm), ym = Math.sin(pm);
                var rtm = 1.4 / (1 + 0.25 * k) + 0.15;
                var dm = Math.pow(10, -3 / (rtm * sr));
                var em = 1 / (1 + 0.15 * k);
                for (i = 0; i < len; i++) {
                    out[i] += em * xm;
                    var nxm = xm * cm - ym * sm;
                    ym = xm * sm + ym * cm; xm = nxm;
                    em *= dm;
                }
            }
            out[0] += 2;
            break;
        }
        default: // Hall
            dvAddNoiseTail(rng, out, sr, 1.7, 7000, 1400, Math.round(0.015 * sr), 1);
            dvAddEarly(rng, out, sr, 14, 15, 90, 0.8, 0.12);
            break;
    }
}

/**
 * Post-process a stereo IR in place: DC-block, optional abrupt gate, 5 ms end fade to exactly 0, energy normalisation.
 * @param {number} idx
 * @param {Float64Array} L
 * @param {Float64Array} R
 * @param {number} sr
 */
function dvIrFinish(idx, L, R, sr) {
    var len = L.length;
    var chans = [L, R];
    var c, i;
    for (c = 0; c < 2; c++) { // one-pole DC blocker (about 30 Hz at 48 kHz)
        var x = chans[c];
        var x1 = 0, y1 = 0;
        var r = 1 - 2 * Math.PI * 30 / sr;
        for (i = 0; i < len; i++) {
            var xi = x[i];
            var yi = xi - x1 + r * y1;
            x1 = xi; y1 = yi; x[i] = yi;
        }
    }
    if (idx === 2) { // Gated Burst: abrupt gate
        var gate = Math.round(0.25 * sr);
        for (c = 0; c < 2; c++) for (i = gate; i < len; i++) chans[c][i] = 0;
    }
    dvIrFade(L, R, sr);
    dvIrNormalise(L, R);
}

/**
 * @param {Float64Array} L
 * @param {Float64Array} R
 * @param {number} sr
 */
function dvIrFade(L, R, sr) {
    var len = L.length;
    var fn = Math.max(2, Math.min(Math.round(DV_IR_FADE_SEC * sr), len >> 2));
    for (var i = 0; i < fn; i++) {
        var u = (i + 1) / fn;
        var g = 0.5 * (1 + Math.cos(Math.PI * u));
        L[len - fn + i] *= g; R[len - fn + i] *= g;
    }
    L[len - 1] = 0; R[len - 1] = 0;
}

/**
 * Mean channel energy (sum L^2 + sum R^2) / 2 = 1.
 * @param {Float64Array} L
 * @param {Float64Array} R
 */
function dvIrNormalise(L, R) {
    var e = 0;
    for (var i = 0; i < L.length; i++) e += L[i] * L[i] + R[i] * R[i];
    e *= 0.5;
    var g = e > 1e-20 ? 1 / Math.sqrt(e) : 1;
    for (var j = 0; j < L.length; j++) { L[j] *= g; R[j] *= g; }
}

/**
 * Nominal length (samples) of IR `idx` at `sr`.
 * @param {number} idx
 * @param {number} sr
 */
function dvIrNominalLen(idx, sr) {
    return Math.min(Math.round(DV_IR_TABLE[idx].dur * sr), Math.round(DV_IR_MAX_SEC * sr));
}

/**
 * The whole bank at `sr`: 10 stereo IRs of exactly their listed durations.
 * @param {number} sr
 * @returns {Array<{name: string, idx: number, L: Float64Array, R: Float64Array, len: number}>}
 */
function dvIrBank(sr) {
    var bank = [];
    for (var idx = 0; idx < DV_IR_TABLE.length; idx++) {
        var len = dvIrNominalLen(idx, sr);
        var L = new Float64Array(len), R = new Float64Array(len);
        for (var p = 0; p < DV_IR_TABLE[idx].parts; p++) {
            dvGenChannel(idx, 0, p, L, sr);
            dvGenChannel(idx, 1, p, R, sr);
        }
        dvIrFinish(idx, L, R, sr);
        bank.push({ name: DV_IR_TABLE[idx].name, idx: idx, L: L, R: R, len: len });
    }
    return bank;
}

/**
 * Truncate an IR to `len` samples (new 5 ms fade, renormalised). Returns the same object when nothing changes.
 * @template {{name: string, idx: number, L: Float64Array, R: Float64Array, len: number}} T
 * @param {T} ir
 * @param {number} len
 * @param {number} sr
 * @returns {T}
 */
function dvIrFit(ir, len, sr) {
    if (len >= ir.len) return ir;
    var L = ir.L.slice(0, len), R = ir.R.slice(0, len);
    dvIrFade(L, R, sr);
    dvIrNormalise(L, R);
    return /** @type {any} */ ({ name: ir.name, idx: ir.idx, L: L, R: R, len: len });
}

// ---- plan ------------------------------------------------------------------------------------------------------------
/**
 * @param {number} len
 * @returns {{nHead: number, nTail: number}}
 */
function dvIrCounts(len) {
    var C = dvIrCfg.CONV;
    return {
        nHead: Math.min(C.HEAD_PARTS, Math.ceil(len / C.P1)),
        nTail: len > C.H ? Math.min(C.TAIL_MAX, Math.ceil((len - C.H) / C.P2)) : 0,
    };
}

/**
 * @param {number} nHead
 * @param {number} nTail
 */
function dvIrFloats(nHead, nTail) {
    var C = dvIrCfg.CONV;
    return nHead * C.NB1 * 4 + nTail * C.NB2 * 4;
}

/**
 * Layout of the bank in ---deviateir. Offsets are float offsets into the buffer (first IR at DV_IR.HDR, tightly packed).
 * @param {number} sr
 * @returns {{irs: Array<{len: number, srcLen: number, nHead: number, nTail: number, offset: number}>, total: number, scale: number, sr: number}}
 */
function dvIrPlan(sr) {
    var budget = dvIrCfg.IR.SAMPS - dvIrCfg.IR.HDR;
    var base = [];
    for (var i = 0; i < DV_IR_TABLE.length; i++) base.push(Math.min(dvIrNominalLen(i, sr), DV_IR_CAP));
    /** @param {number} s */
    function lens(s) {
        return base.map(function (b) { return s >= 1 ? b : Math.max(dvIrCfg.CONV.P1, Math.floor(b * s)); });
    }
    /** @param {number[]} ls */
    function totalOf(ls) {
        var t = 0;
        for (var j = 0; j < ls.length; j++) { var c = dvIrCounts(ls[j]); t += dvIrFloats(c.nHead, c.nTail); }
        return t;
    }
    var scale = 1;
    var ls = lens(1);
    if (totalOf(ls) > budget) {
        var lo = 0.01, hi = 1;
        for (var it = 0; it < 40; it++) {
            var mid = 0.5 * (lo + hi);
            if (totalOf(lens(mid)) > budget) hi = mid; else lo = mid;
        }
        scale = lo;
        ls = lens(lo);
    }
    var irs = [];
    var off = dvIrCfg.IR.HDR;
    for (var k = 0; k < ls.length; k++) {
        var c2 = dvIrCounts(ls[k]);
        irs.push({ len: ls[k], srcLen: dvIrNominalLen(k, sr), nHead: c2.nHead, nTail: c2.nTail, offset: off });
        off += dvIrFloats(c2.nHead, c2.nTail);
    }
    return { irs: irs, total: off - dvIrCfg.IR.HDR, scale: scale, sr: sr };
}

/**
 * Head (128-sample partitions of IR[0, 4096)) and tail (2048-sample partitions of the rest) spectra of one planned IR.
 * `plan` is the plan entry (`{nHead, nTail}`) of this IR, or the whole plan (then `ir.idx` picks the entry).
 * @param {{L: Float64Array, R: Float64Array, idx?: number}} ir
 * @param {{nHead?: number, nTail?: number, irs?: Array<{nHead: number, nTail: number}>}} plan
 * @returns {{head: Float32Array, tail: Float32Array}}
 */
function dvIrSpectra(ir, plan) {
    var C = dvIrCfg.CONV;
    var e = plan.irs ? plan.irs[ir.idx || 0] : plan;
    var head = new Float32Array(e.nHead * C.NB1 * 4);
    for (var p = 0; p < e.nHead; p++) dvPartitionSpectrum(ir.L, ir.R, p * C.P1, C.P1, head, p * C.NB1 * 4);
    var tail = new Float32Array(e.nTail * C.NB2 * 4);
    for (var q = 0; q < e.nTail; q++) dvPartitionSpectrum(ir.L, ir.R, C.H + q * C.P2, C.P2, tail, q * C.NB2 * 4);
    return { head: head, tail: tail };
}

/**
 * Header of ---deviateir (VER and READY are 0: the engine sets them after the body).
 * @param {{irs: Array<{len: number, nHead: number, nTail: number, offset: number}>, sr: number}} plan
 */
function dvIrHeader(plan) {
    var I = dvIrCfg.IR;
    var h = new Float32Array(I.HDR);
    h[I.VER] = 0;
    h[I.COUNT] = plan.irs.length;
    h[I.SR] = plan.sr;
    h[I.READY] = 0;
    for (var i = 0; i < plan.irs.length; i++) {
        var e = plan.irs[i];
        h[I.DIR + 4 * i] = e.offset;
        h[I.DIR + 4 * i + 1] = e.len;
        h[I.DIR + 4 * i + 2] = e.nHead;
        h[I.DIR + 4 * i + 3] = e.nTail;
    }
    return h;
}

// ---- sliced builder --------------------------------------------------------------------------------------------------
/**
 * Work-unit builder for the engine. Units per IR: 2 * parts channel generations, 1 post-process (+ fit), nHead + nTail
 * partition spectra. Each unit is a few ms at most (checked by tests/test_deviate_ir.js).
 * @param {number} sr
 */
function dvIrBuilder(sr) {
    var plan = dvIrPlan(sr);
    var C = dvIrCfg.CONV;
    var body = new Float32Array(plan.total);
    /** @type {Array<{name: string, idx: number, L: Float64Array, R: Float64Array, len: number}>} */
    var irs = [];
    var cur = 0;       // IR index
    var phase = 0;     // unit within the IR
    var L = null, R = null, fitted = null;
    var finished = false;
    var totalUnits = 0, doneUnits = 0;
    for (var i = 0; i < DV_IR_TABLE.length; i++) {
        totalUnits += 2 * DV_IR_TABLE[i].parts + 1 + plan.irs[i].nHead + plan.irs[i].nTail;
    }

    function unit() {
        var t = DV_IR_TABLE[cur];
        var e = plan.irs[cur];
        var gens = 2 * t.parts;
        if (phase === 0) {
            L = new Float64Array(e.srcLen); R = new Float64Array(e.srcLen);
        }
        if (phase < gens) {
            var part = Math.floor(phase / 2), ch = phase & 1;
            dvGenChannel(cur, ch, part, ch ? R : L, sr);
        } else if (phase === gens) {
            dvIrFinish(cur, L, R, sr);
            fitted = dvIrFit({ name: t.name, idx: cur, L: L, R: R, len: e.srcLen }, e.len, sr);
            irs.push(fitted);
            L = null; R = null;
        } else {
            var k = phase - gens - 1;
            var base = e.offset - dvIrCfg.IR.HDR;
            if (k < e.nHead) {
                dvPartitionSpectrum(fitted.L, fitted.R, k * C.P1, C.P1, body, base + k * C.NB1 * 4);
            } else {
                var q = k - e.nHead;
                dvPartitionSpectrum(fitted.L, fitted.R, C.H + q * C.P2, C.P2, body, base + e.nHead * C.NB1 * 4 + q * C.NB2 * 4);
            }
        }
        phase++;
        doneUnits++;
        if (phase >= gens + 1 + e.nHead + e.nTail) {
            phase = 0; cur++; fitted = null;
            if (cur >= DV_IR_TABLE.length) finished = true;
        }
    }

    return {
        plan: plan,
        total: plan.total,
        irs: irs,
        /** Do up to `units` work units; returns true when everything is built. @param {number} [units] */
        step: function (units) {
            var n = units === undefined ? 1 : units;
            while (n-- > 0 && !finished) unit();
            return finished;
        },
        done: function () { return finished; },
        progress: function () { return doneUnits / totalUnits; },
        /** Body chunks (<= 8192 floats, tiling [HDR, HDR + total)) then the header chunk LAST. Call when done(). */
        chunks: function () {
            var out = [];
            var CH = 8192;
            for (var o = 0; o < body.length; o += CH) {
                out.push({ offset: dvIrCfg.IR.HDR + o, data: body.subarray(o, Math.min(body.length, o + CH)) });
            }
            out.push({ offset: 0, data: dvIrHeader(plan) });
            return out;
        },
    };
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        DV_IR_CAP, DV_IR_TABLE, dvIrNames, dvFft, dvPartitionSpectrum, dvIrBank, dvIrFit, dvIrCounts, dvIrFloats, dvIrPlan,
        dvIrSpectra, dvIrHeader, dvIrBuilder, dvIrNominalLen,
    };
}
