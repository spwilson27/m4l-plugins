/**
 * xo_stretch.js - offline time-stretch / pitch engines for XO Sample Map (plain global script, also requirable).
 *
 *   stretchAudio(channels, sampleRate, opts)      -> Float32Array[]           
 *   stretchAudioEx(channels, sampleRate, opts)    -> { channels, engine, note } (engine = what actually ran)
 *
 * opts: { mode: "granular" | "complex" | "texture",
 *         speed    0.1..4, 1 = original (output length = round(inLength / speed)),
 *         pitchSt  semitones, grainMs 5..250 (granular), amount 0..1 (texture window size, granular grain mix is n/a),
 *         transients, phaseLock (complex only, default true; false/false = plain phase vocoder, used as a test baseline),
 *         fftSize (complex, default 4096 at 44.1 kHz; 2048 = cheaper, pre-echo window smaller, polyphony worse),
 *         legacyPitchCoupling (granular only, see below), levelMatch (granular only, default true) }
 *
 * What each mode does:
 *  - granular   Faithful copy of the Hann-grain engine in xo_node_engine.js (grains hop = grain/4, 4x overlap, first
 *               10 ms are copied straight into the granular body). Grain length = grainMs. Pitch: grains are read at
 *               the pitch ratio while the scan position advances at `speed` source frames per output frame, so pitch
 *               is independent of speed. (The old device engine scanned at speed*pitch and had length in/(speed*pitch);
 *               pass legacyPitchCoupling: true to get that.) With levelMatch: false and pitch 0 it is
 *               identical to the device engine; levelMatch (default) adds a smooth gain so the level follows the input
 *               (the raw engine loses 3..6 dB on noise and polyphony because grains add incoherently).
 *  - complex    Phase vocoder, FFT 4096 (x sr/44100, power of two; 2048 via fftSize), synthesis hop N/4, Hann/Hann with exact OLA
 *               normalisation, Laroche-Dolson identity phase locking on spectral peaks, one shared rotation per bin for
 *               all channels (stereo image and inter-channel phase stay exact). Onsets (spectral flux + energy rise)
 *               get a 1:1 "hold" region in the time map where phases are reset to the analysis phases, so the output
 *               reproduces the attack sample-exactly and the rest of the audio takes the extra stretch. Pitch: stretch by
 *               pitchRatio/speed, then windowed-sinc resample by pitchRatio (speed and pitch independent).
 *  - texture    PaulStretch-style: window 4096..32768 samples (x sr/44100) = 4096 * 8^amount, magnitudes kept, phases
 *               random per bin and frame (same phases for every channel, rotated against the channel sum so the stereo
 *               image stays), Hann/Hann OLA at hop W/8. Pitch by resampling afterwards. Edges are mirror-padded.
 *  speed 1 and pitch 0 is a bit-exact copy in every mode except texture.
 */

var XS_PI = Math.PI;
var XS_TWO_PI = 2 * XS_PI;
var XS_INV_TWO_PI = 1 / XS_TWO_PI;

function xsClamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/* ------------------------------------------------------------------ FFT */

/** @typedef {{size: number, half: number, cos: Float64Array, sin: Float64Array}} XsFftStage */
/** @type {Object<number, {cos: Float64Array, sin: Float64Array, rev: Uint32Array, stages: XsFftStage[]}>} */
var xsFftPlans = {};

/** @param {number} n power of two */
function xsFftPlan(n) {
  var plan = xsFftPlans[n];
  if (plan) return plan;
  var cs = new Float64Array(n >> 1);
  var sn = new Float64Array(n >> 1);
  for (var i = 0; i < (n >> 1); i++) {
    cs[i] = Math.cos(XS_TWO_PI * i / n);
    sn[i] = Math.sin(XS_TWO_PI * i / n);
  }
  var rev = new Uint32Array(n);
  var bits = Math.round(Math.log2(n));
  for (var j = 0; j < n; j++) {
    var r = 0;
    for (var b = 0; b < bits; b++) if (j & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[j] = r;
  }
  // Per-stage twiddles so the butterfly indexes sequentially instead of striding through the full table.
  /** @type {XsFftStage[]} */
  var stages = [];
  for (var size = 2; size <= n; size <<= 1) {
    var half = size >> 1;
    var step = n / size;
    var stC = new Float64Array(half);
    var stS = new Float64Array(half);
    for (var k = 0, t = 0; k < half; k++, t += step) {
      stC[k] = cs[t];
      stS[k] = sn[t];
    }
    stages.push({ size: size, half: half, cos: stC, sin: stS });
  }
  plan = { cos: cs, sin: sn, rev: rev, stages: stages };
  xsFftPlans[n] = plan;
  return plan;
}

/**
 * In-place radix-2 complex FFT, unnormalised (inverse does not divide by n).
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @param {number} n
 * @param {boolean} inverse
 */
function xsFft(re, im, n, inverse) {
  var plan = xsFftPlan(n);
  var rev = plan.rev;
  for (var i = 0; i < n; i++) {
    var j = rev[i];
    if (j > i) {
      var tr = re[i]; re[i] = re[j]; re[j] = tr;
      var ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  var sgn = inverse ? 1 : -1;
  var stages = plan.stages;
  for (var si = 0; si < stages.length; si++) {
    var st = stages[si];
    var half = st.half;
    var size = st.size;
    var stC = st.cos;
    var stS = st.sin;
    for (var s = 0; s < n; s += size) {
      for (var k = 0; k < half; k++) {
        var wr = stC[k];
        var wi = sgn * stS[k];
        var a = s + k;
        var b = a + half;
        var xr = re[b] * wr - im[b] * wi;
        var xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** Hann windows cached by length (4096, 8192, 16384, 32768, and grain sizes). @type {Object<number, Float64Array>} */
var xsHannCache = {};

/** @param {number} n */
function xsHann(n) {
  var w = xsHannCache[n];
  if (w) return w;
  w = new Float64Array(n);
  for (var i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(XS_TWO_PI * i / n));
  xsHannCache[n] = w;
  return w;
}

/** Power of two nearest (in log terms) to base * sr / 44100. */
function xsScaledPow2(base, sr) {
  var v = Math.log2(base * Math.max(8000, sr) / 44100);
  return 1 << Math.max(6, Math.round(v));
}

/**
 * Real-signal spectra of several channels, two channels per complex FFT.
 * @param {Float64Array[]} frames windowed time frames, one per channel (length n)
 * @param {number} n
 * @param {Float64Array} wr scratch
 * @param {Float64Array} wi scratch
 * @param {Float64Array[]} outRe per channel, length n/2+1
 * @param {Float64Array[]} outIm
 */
function xsSpectra(frames, n, wr, wi, outRe, outIm) {
  var C = frames.length;
  var h = n >> 1;
  for (var g = 0; g < C; g += 2) {
    var a = frames[g];
    var b = g + 1 < C ? frames[g + 1] : null;
    for (var i = 0; i < n; i++) { wr[i] = a[i]; wi[i] = b ? b[i] : 0; }
    xsFft(wr, wi, n, false);
    var aRe = outRe[g], aIm = outIm[g];
    var bRe = b ? outRe[g + 1] : null, bIm = b ? outIm[g + 1] : null;
    for (var k = 0; k <= h; k++) {
      var k2 = (n - k) & (n - 1);
      aRe[k] = 0.5 * (wr[k] + wr[k2]);
      aIm[k] = 0.5 * (wi[k] - wi[k2]);
      if (bRe && bIm) {
        bRe[k] = 0.5 * (wi[k] + wi[k2]);
        bIm[k] = -0.5 * (wr[k] - wr[k2]);
      }
    }
  }
}

/**
 * Inverse of xsSpectra: half spectra -> real time frames (scaled by 1/n).
 * @param {Float64Array[]} inRe
 * @param {Float64Array[]} inIm
 * @param {number} n
 * @param {Float64Array} wr scratch
 * @param {Float64Array} wi scratch
 * @param {Float64Array[]} outFrames per channel, length n
 */
function xsInverse(inRe, inIm, n, wr, wi, outFrames) {
  var C = inRe.length;
  var h = n >> 1;
  var inv = 1 / n;
  for (var g = 0; g < C; g += 2) {
    var aRe = inRe[g], aIm = inIm[g];
    var hasB = g + 1 < C;
    var bRe = hasB ? inRe[g + 1] : null, bIm = hasB ? inIm[g + 1] : null;
    for (var k = 0; k <= h; k++) {
      var ar = aRe[k], ai = k === 0 || k === h ? 0 : aIm[k];
      var br = bRe ? bRe[k] : 0, bi = bIm && k !== 0 && k !== h ? bIm[k] : 0;
      // Z[k] = A[k] + jB[k]; Z[n-k] = conj(A[k]) + j conj(B[k])
      wr[k] = ar - bi;
      wi[k] = ai + br;
      if (k !== 0 && k !== h) {
        wr[n - k] = ar + bi;
        wi[n - k] = -ai + br;
      }
    }
    xsFft(wr, wi, n, true);
    var oa = outFrames[g];
    var ob = hasB ? outFrames[g + 1] : null;
    for (var i = 0; i < n; i++) {
      oa[i] = wr[i] * inv;
      if (ob) ob[i] = wi[i] * inv;
    }
  }
}

/* ------------------------------------------------------------- helpers */

/** @param {Float32Array[]} chans @param {number} len */
function xsMono(chans, len) {
  var m = new Float64Array(len);
  var C = chans.length;
  for (var c = 0; c < C; c++) {
    var x = chans[c];
    for (var i = 0; i < len; i++) m[i] += x[i];
  }
  if (C > 1) for (var j = 0; j < len; j++) m[j] /= C;
  return m;
}

/** Knee limiter: transparent below 0.95, asymptotes to 1.0. @param {Float32Array} x */
function xsSoftLimit(x) {
  for (var i = 0; i < x.length; i++) {
    var v = x[i];
    var a = Math.abs(v);
    if (a > 0.95) x[i] = (v < 0 ? -1 : 1) * (0.95 + 0.05 * Math.tanh((a - 0.95) / 0.05));
  }
}

/** @param {Float32Array} x */
function xsSanitize(x) {
  for (var i = 0; i < x.length; i++) if (!isFinite(x[i])) x[i] = 0;
}

var xsKaiserCache = {};

/**
 * Windowed-sinc resampler: out[n] = in(n * ratio). ratio > 1 raises pitch (band-limited to the output Nyquist).
 * @param {Float32Array|Float64Array} x
 * @param {number} ratio
 * @param {number} outLen
 * @returns {Float32Array}
 */
function xsResample(x, ratio, outLen) {
  var out = new Float32Array(outLen);
  var fc = ratio > 1 ? 0.97 / ratio : 0.97;
  var Z = 14; // zero crossings per side at cutoff
  var half = Math.ceil(Z / fc);
  var RES = 256;
  var key = fc.toFixed(5);
  var table = xsKaiserCache[key];
  if (!table) {
    table = new Float32Array((2 * half + 2) * RES);
    var beta = 8.0;
    var i0 = function (v) {
      var s = 1, t = 1;
      for (var k = 1; k < 30; k++) { t *= (v / (2 * k)) * (v / (2 * k)); s += t; }
      return s;
    };
    var norm = i0(beta);
    for (var i = 0; i < table.length; i++) {
      var d = i / RES - half;
      var arg = d * fc;
      var sinc = Math.abs(arg) < 1e-9 ? 1 : Math.sin(XS_PI * arg) / (XS_PI * arg);
      var u = d / half;
      var win = Math.abs(u) >= 1 ? 0 : i0(beta * Math.sqrt(1 - u * u)) / norm;
      table[i] = fc * sinc * win;
    }
    xsKaiserCache[key] = table;
  }
  var n = x.length;
  for (var o = 0; o < outLen; o++) {
    var pos = o * ratio;
    var base = Math.floor(pos);
    var frac = pos - base;
    var acc = 0;
    for (var j = -half + 1; j <= half; j++) {
      var idx = base + j;
      if (idx < 0 || idx >= n) continue;
      var tpos = (half + (j - frac)) * RES; // table index of d = j - frac
      var ti = Math.floor(tpos);
      var tf = tpos - ti;
      acc += x[idx] * (table[ti] + tf * (table[ti + 1] - table[ti]));
    }
    out[o] = acc;
  }
  return out;
}

/* ------------------------------------------------------------ granular */

/**
 * Faithful copy of the granular engine in xo_node_engine.js (renderEditedAudioSamples), one channel.
 * @param {Float32Array} src
 * @param {number} outFrames
 * @param {number} sr
 * @param {number} grainMs
 * @param {number} pitchRatio grain read rate
 * @param {number} scanRate source frames per output frame
 * @param {boolean} preserveAttack
 */
function xsGranularChannel(src, outFrames, sr, grainMs, pitchRatio, scanRate, preserveAttack) {
  var srcLen = src.length;
  var grainBuf = new Float32Array(outFrames);
  var grainLen = Math.max(64, Math.round((grainMs / 1000.0) * sr));
  var hop = Math.max(16, Math.floor(grainLen / 4));
  var normGain = 0.5; // 4x Hann overlap sums to 2.0 -> * 0.5 = 1.0
  var win = xsHann(grainLen);
  for (var g0 = -grainLen + hop; g0 < outFrames; g0 += hop) {
    var srcOrigin = Math.max(0, g0 * scanRate);
    for (var n = 0; n < grainLen; n++) {
      var outIdx = g0 + n;
      if (outIdx < 0 || outIdx >= outFrames) continue;
      var srcPos = srcOrigin + n * pitchRatio;
      if (srcPos >= srcLen) break;
      var idx0 = Math.floor(srcPos);
      var frac = srcPos - idx0;
      var s0 = src[idx0];
      var s1 = (idx0 + 1) < srcLen ? src[idx0 + 1] : s0;
      var samp = s0 + frac * (s1 - s0);
      grainBuf[outIdx] += samp * win[n] * normGain;
    }
  }
  // Preserve initial attack transient (first 10 ms) and crossfade into the granular body
  var transLen = preserveAttack ? Math.min(Math.floor(sr * 0.010), Math.floor(outFrames * 0.25)) : 0;
  for (var i = 0; i < transLen; i++) {
    var sp = i * pitchRatio;
    var i0 = Math.floor(sp);
    var fr = sp - i0;
    var a0 = i0 < srcLen ? src[i0] : 0;
    var a1 = (i0 + 1) < srcLen ? src[i0 + 1] : a0;
    var direct = a0 + fr * (a1 - a0);
    var xfade = 0.5 * (1.0 - Math.cos((XS_PI * i) / Math.max(1, transLen)));
    grainBuf[i] = direct * (1.0 - xfade) + grainBuf[i] * xfade;
  }
  return grainBuf;
}

/**
 * @param {Float32Array[]} chans
 * @param {number} sr
 * @param {{speed:number, pitchSt:number, grainMs:number, legacyPitchCoupling?:boolean, levelMatch?:boolean}} o
 */
function xsGranular(chans, sr, o) {
  var len = chans[0].length;
  var pitchRatio = Math.pow(2, o.pitchSt / 12);
  var scan = o.legacyPitchCoupling ? o.speed * pitchRatio : o.speed;
  var outFrames = Math.max(16, Math.round(len / (o.legacyPitchCoupling ? Math.max(0.05, scan) : o.speed)));
  var res = chans.map(function (ch) {
    return xsGranularChannel(ch, outFrames, sr, o.grainMs, pitchRatio, scan, true);
  });
  if (o.levelMatch) {
    xsMatchLevel(chans, res, Math.max(2048, Math.round(o.grainMs / 1000 * sr * 4)), 0.9);
    res.forEach(xsSoftLimit);
  }
  return res;
}

/**
 * Smooth gain that makes the local mean square of `out` follow that of `inp` (uniform time ratio). Modifies `out`.
 * @param {Float32Array[]} inp
 * @param {Float32Array[]} out
 * @param {number} blk window length in output samples
 * @param {number} maxBoost largest gain in nepers (attenuation is limited to -1.4)
 */
function xsMatchLevel(inp, out, blk, maxBoost) {
  var C = inp.length;
  var lenIn = inp[0].length, lenOut = out[0].length;
  var ratio = lenIn / lenOut;
  var cumIn = new Float64Array(lenIn + 1), cumOut = new Float64Array(lenOut + 1);
  for (var c = 0; c < C; c++) {
    var a = inp[c], b = out[c];
    for (var i = 0; i < lenIn; i++) cumIn[i + 1] += a[i] * a[i];
    for (var j = 0; j < lenOut; j++) cumOut[j + 1] += b[j] * b[j];
  }
  for (var i2 = 0; i2 < lenIn; i2++) cumIn[i2 + 1] += cumIn[i2];
  for (var j2 = 0; j2 < lenOut; j2++) cumOut[j2 + 1] += cumOut[j2];
  var msOf = function (cum, len, lo, hi) {
    lo = Math.max(0, Math.round(lo)); hi = Math.min(len, Math.round(hi));
    return hi > lo ? (cum[hi] - cum[lo]) / (hi - lo) : 0;
  };
  var hopB = Math.max(1, blk >> 1);
  var nb = Math.ceil(lenOut / hopB) + 2;
  var lg = new Float64Array(nb);
  for (var k = 0; k < nb; k++) {
    var cen = k * hopB;
    var mi = msOf(cumIn, lenIn, (cen - blk / 2) * ratio, (cen + blk / 2) * ratio);
    var mo = msOf(cumOut, lenOut, cen - blk / 2, cen + blk / 2);
    lg[k] = (mi > 1e-10 && mo > 1e-12) ? xsClamp(0.5 * Math.log(mi / mo), -1.4, maxBoost) : 0;
  }
  var sm = new Float64Array(nb);
  for (var k2 = 0; k2 < nb; k2++) sm[k2] = 0.25 * lg[Math.max(0, k2 - 1)] + 0.5 * lg[k2] + 0.25 * lg[Math.min(nb - 1, k2 + 1)];
  for (var c2 = 0; c2 < C; c2++) {
    var o = out[c2];
    for (var n = 0; n < lenOut; n++) {
      var pos = n / hopB, f0 = Math.floor(pos), fr = pos - f0;
      o[n] *= Math.exp(sm[f0] * (1 - fr) + sm[Math.min(nb - 1, f0 + 1)] * fr);
    }
  }
}

/* --------------------------------------------------------------- onsets */

/**
 * Onset detector: log-magnitude spectral flux with an adaptive threshold plus an energy-rise test, refined to the
 * sample where the short-term energy rises fastest.
 * @param {Float64Array} x mono
 * @param {number} sr
 * @returns {Array<{pos:number, strength:number}>}
 */
function xsDetectOnsets(x, sr) {
  var len = x.length;
  var Nd = xsScaledPow2(1024, sr);
  var hop = Nd >> 3;
  var win = xsHann(Nd);
  var re = new Float64Array(Nd), im = new Float64Array(Nd);
  var kmax = Math.min(Nd >> 1, Math.floor(16000 / sr * Nd));
  var nFrames = Math.floor(len / hop) + 1;
  var prev = new Float64Array(kmax + 1);
  var cur = new Float64Array(kmax + 1);
  var flux = new Float64Array(nFrames);
  var scale = 1000 / (Nd / 4);
  for (var f = 0; f < nFrames; f++) {
    var start = f * hop - (Nd >> 1);
    for (var n = 0; n < Nd; n++) {
      var idx = start + n;
      re[n] = (idx >= 0 && idx < len) ? x[idx] * win[n] : 0;
      im[n] = 0;
    }
    xsFft(re, im, Nd, false);
    var sum = 0;
    for (var k = 1; k <= kmax; k++) {
      cur[k] = Math.log(1 + scale * Math.hypot(re[k], im[k]));
      var d = cur[k] - prev[k];
      if (f > 0 && d > 0) sum += d;
    }
    flux[f] = sum;
    var t = prev; prev = cur; cur = t;
  }
  // prefix sums of energy
  var cum = new Float64Array(len + 1);
  for (var i = 0; i < len; i++) cum[i + 1] = cum[i] + x[i] * x[i];
  var energy = function (a, b) {
    a = Math.max(0, a); b = Math.min(len, b);
    return b > a ? (cum[b] - cum[a]) / (b - a) : 0;
  };
  var out = [];
  var W = 12;
  var nextW = Math.max(16, Math.round(sr * 0.0015)), prevW = Math.max(64, Math.round(sr * 0.006));
  for (var j = 1; j < nFrames; j++) {
    var v = flux[j];
    if (v < 5) continue;
    var isMax = true, mean = 0, cnt = 0;
    for (var q = Math.max(0, j - W); q <= Math.min(nFrames - 1, j + W); q++) {
      mean += flux[q]; cnt++;
      if (q !== j && Math.abs(q - j) <= 3 && flux[q] > v) isMax = false;
    }
    mean /= cnt;
    if (!isMax || v < 1.7 * mean + 3) continue;
    // refine: the strongest short-term energy step within the analysis window
    var centre = j * hop;
    var lo = Math.max(0, centre - (Nd >> 1)), hi = Math.min(len - 1, centre + (Nd >> 1));
    var best = centre, bestScore = -1e9;
    for (var p = lo; p <= hi; p += 4) {
      var sc = Math.log(energy(p, p + nextW) + 1e-10) - Math.log(energy(p - prevW, p) + 1e-10);
      if (sc > bestScore) { bestScore = sc; best = p; }
    }
    var eAfter = energy(best, best + 384), eBefore = energy(best - 1024, best - 64);
    if (eAfter < 1e-8 || eAfter < 2.5 * eBefore) continue; // needs a ~4 dB rise
    out.push({ pos: best, strength: v / (mean + 1) });
  }
  // minimum spacing 50 ms, keep the stronger
  out.sort(function (a, b) { return a.pos - b.pos; });
  var minGap = Math.round(sr * 0.05);
  var kept = [];
  for (var m = 0; m < out.length; m++) {
    var o = out[m];
    var last = kept[kept.length - 1];
    if (last && o.pos - last.pos < minGap) {
      if (o.strength > last.strength) kept[kept.length - 1] = o;
    } else kept.push(o);
  }
  // an attack at the very start of the sample
  var headE = energy(0, Math.round(sr * 0.02));
  if (headE > 1e-7 && (!kept.length || kept[0].pos > Math.round(sr * 0.05))) kept.unshift({ pos: 0, strength: 1e6 });
  return kept;
}

/* ------------------------------------------------------------- time map */

/**
 * Piecewise-linear map from output time to input time. Every accepted onset t gets a hold segment that runs 1:1
 * (phases are reset there) and is anchored so the onset lands exactly at alpha * t; the audio between holds takes
 * whatever stretch is needed to get from one anchor to the next. Rhythm therefore follows the tempo ratio exactly.
 * @param {number} lenIn
 * @param {number} lenOut
 * @param {Array<{pos:number, strength:number}>} onsets
 * @param {number} N frame length
 * @param {number} sr
 * @returns {{out0:Float64Array, in0:Float64Array, ratio:Float64Array, hold:Uint8Array, count:number}}
 */
function xsBuildTimeMap(lenIn, lenOut, onsets, N, sr) {
  var alpha = lenOut / lenIn;
  var pre = Math.round(0.4 * N + 0.003 * sr);
  var post = Math.round(0.4 * N + 0.015 * sr);
  var span = (pre + post) * 1.25;
  var cand = onsets.slice().sort(function (a, b) { return b.strength - a.strength; });
  /** @type {Array<{pos:number, strength:number}>} */
  var acc = [];
  for (var i = 0; i < cand.length; i++) {
    var t = cand[i].pos, ok = true;
    for (var j = 0; j < acc.length; j++) {
      var d = Math.abs(t - acc[j].pos);
      if (d < span || alpha * d < span) { ok = false; break; }
    }
    if (ok) acc.push(cand[i]);
  }
  acc.sort(function (a, b) { return a.pos - b.pos; });
  var cap = acc.length * 2 + 3;
  var out0 = new Float64Array(cap), in0 = new Float64Array(cap), ratio = new Float64Array(cap);
  var hold = new Uint8Array(cap);
  var count = 0, inPos = 0, outPos = 0;
  var pushSeg = function (i0, o0, i1, o1, isHold) {
    out0[count] = o0; in0[count] = i0;
    ratio[count] = (i1 - i0) / Math.max(1e-9, o1 - o0);
    hold[count] = isHold ? 1 : 0;
    count++;
  };
  for (var k = 0; k < acc.length; k++) {
    var tk = acc[k].pos;
    var h0 = Math.max(0, tk - pre, tk - alpha * tk);
    var h1 = Math.min(lenIn, tk + post, tk + (lenOut - alpha * tk));
    var o0 = alpha * tk - (tk - h0), o1 = alpha * tk + (h1 - tk);
    var gapIn = h0 - inPos, gapOut = o0 - outPos;
    if (h1 - h0 < 16 || gapIn < 1 || gapOut < 1 || gapOut < 0.1 * gapIn) continue;
    pushSeg(inPos, outPos, h0, o0, false);
    pushSeg(h0, o0, h1, o1, true);
    inPos = h1; outPos = o1;
  }
  if (lenIn - inPos >= 1 && lenOut - outPos >= 1) pushSeg(inPos, outPos, lenIn, lenOut, false);
  else if (count > 0) { in0[count - 1] = in0[count - 1]; }
  if (count === 0) { out0[0] = 0; in0[0] = 0; ratio[0] = lenIn / Math.max(1, lenOut); count = 1; }
  return { out0: out0, in0: in0, ratio: ratio, hold: hold, count: count };
}

/* -------------------------------------------------------------- complex */

/** @param {number} a */
function xsWrap(a) {
  return a - XS_TWO_PI * Math.round(a * XS_INV_TWO_PI);
}

/**
 * Phase vocoder with identity phase locking and transient hold regions.
 * @param {Float32Array[]} chans
 * @param {number} sr
 * @param {number} lenOut stretched length (before any pitch resampling)
 * @param {{transients:boolean, phaseLock:boolean, fftSize?:number}} o
 */
function xsComplexStretch(chans, sr, lenOut, o) {
  var C = chans.length;
  var lenIn = chans[0].length;
  var N = xsScaledPow2(o.fftSize || 4096, sr);
  var Hs = N >> 2;
  var half = N >> 1;
  var win = xsHann(N);
  var onsets = o.transients ? xsDetectOnsets(xsMono(chans, lenIn), sr) : [];
  var map = xsBuildTimeMap(lenIn, lenOut, onsets, N, sr);
  var outs = chans.map(function () { return new Float64Array(lenOut + N * 4); });
  var offset = N * 2; // output index of time 0
  var frames = [], specRe = [], specIm = [], yRe = [], yIm = [];
  for (var c = 0; c < C; c++) {
    frames.push(new Float64Array(N));
    specRe.push(new Float64Array(half + 1)); specIm.push(new Float64Array(half + 1));
    yRe.push(new Float64Array(half + 1)); yIm.push(new Float64Array(half + 1));
  }
  var wr = new Float64Array(N), wi = new Float64Array(N);
  var ana = new Float64Array(half + 1), prevAna = new Float64Array(half + 1), prevSyn = new Float64Array(half + 1);
  var mag = new Float64Array(half + 1);
  var rotC = new Float64Array(half + 1), rotS = new Float64Array(half + 1);
  var peaks = new Int32Array(half + 1);
  var pkRot = new Float64Array(half + 1); // reused across hops (no per-hop Float64Array)
  var expectedAdv = new Float64Array(half + 1);
  var invN = 1 / N;
  for (var ek = 0; ek <= half; ek++) expectedAdv[ek] = XS_TWO_PI * ek * invN;
  var m0 = -3;
  var mEnd = Math.ceil((lenOut + half) / Hs) + 1;
  var anaEnergy = new Float64Array(mEnd - m0 + 1);
  var seg = 0;
  var prevP = 0;
  var first = true;
  for (var m = m0; m <= mEnd; m++) {
    var cen = m * Hs;
    while (seg < map.count - 1 && cen >= map.out0[seg + 1]) seg++;
    var p = Math.round(map.in0[seg] + (cen - map.out0[seg]) * map.ratio[seg]);
    var isHold = map.hold[seg] === 1;
    for (var ch = 0; ch < C; ch++) {
      var x = chans[ch], fr = frames[ch];
      var st = p - half;
      for (var n = 0; n < N; n++) {
        var ix = st + n;
        fr[n] = (ix >= 0 && ix < lenIn) ? x[ix] * win[n] : 0;
        anaEnergy[m - m0] += fr[n] * fr[n];
      }
    }
    xsSpectra(frames, N, wr, wi, specRe, specIm);
    // reference spectrum = channel sum
    for (var k = 0; k <= half; k++) {
      var sr_ = 0, si_ = 0;
      for (var cc = 0; cc < C; cc++) { sr_ += specRe[cc][k]; si_ += specIm[cc][k]; }
      mag[k] = Math.sqrt(sr_ * sr_ + si_ * si_);
      ana[k] = Math.atan2(si_, sr_);
    }
    if (isHold || first) {
      for (var k0 = 0; k0 <= half; k0++) { rotC[k0] = 1; rotS[k0] = 0; prevSyn[k0] = ana[k0]; }
    } else {
      var Ha = Math.max(1, p - prevP);
      var np = 0;
      if (o.phaseLock) {
        for (var k1 = 2; k1 < half - 1; k1++) {
          var mv = mag[k1];
          if (mv > mag[k1 - 1] && mv >= mag[k1 + 1]) peaks[np++] = k1;
        }
      }
      if (np === 0) {
        // plain per-bin propagation (also the fallback with no peaks)
        for (var k2 = 0; k2 <= half; k2++) {
          var w0 = expectedAdv[k2];
          var dp = xsWrap(ana[k2] - prevAna[k2] - w0 * Ha);
          var syn = prevSyn[k2] + Hs * (w0 + dp / Ha);
          var rot = syn - ana[k2];
          rotC[k2] = Math.cos(rot); rotS[k2] = Math.sin(rot);
          prevSyn[k2] = syn;
        }
      } else {
        for (var q = 0; q < np; q++) {
          var pkb = peaks[q];
          var wk = expectedAdv[pkb];
          var dphi = xsWrap(ana[pkb] - prevAna[pkb] - wk * Ha);
          var synPk = prevSyn[pkb] + Hs * (wk + dphi / Ha);
          pkRot[q] = synPk - ana[pkb];
        }
        var pi = 0;
        var rc = Math.cos(pkRot[0]), rs = Math.sin(pkRot[0]);
        for (var k3 = 0; k3 <= half; k3++) {
          if (pi < np - 1 && k3 > ((peaks[pi] + peaks[pi + 1]) >> 1)) {
            pi++;
            rc = Math.cos(pkRot[pi]); rs = Math.sin(pkRot[pi]);
          }
          rotC[k3] = rc; rotS[k3] = rs;
          prevSyn[k3] = ana[k3] + pkRot[pi];
        }
      }
    }
    prevAna.set(ana);
    prevP = p;
    first = false;
    // rotate every channel by the shared per-bin rotation
    for (var c2 = 0; c2 < C; c2++) {
      var sRe = specRe[c2], sIm = specIm[c2], oRe = yRe[c2], oIm = yIm[c2];
      for (var kk = 0; kk <= half; kk++) {
        oRe[kk] = sRe[kk] * rotC[kk] - sIm[kk] * rotS[kk];
        oIm[kk] = sRe[kk] * rotS[kk] + sIm[kk] * rotC[kk];
      }
    }
    xsInverse(yRe, yIm, N, wr, wi, frames);
    var base = offset + cen - half;
    for (var c3 = 0; c3 < C; c3++) {
      var fo = frames[c3], dst = outs[c3];
      for (var n2 = 0; n2 < N; n2++) {
        var di = base + n2;
        if (di >= 0 && di < dst.length) dst[di] += fo[n2] * win[n2];
      }
    }
  }
  var norm = 1 / 1.5; // sum of Hann^2 at hop N/4
  // Loudness match: scale the output so its Hann-weighted energy around each frame centre equals that of the
  // analysis frame it was built from (phase vocoders lose level on noise and dense polyphony).
  var nFr = mEnd - m0 + 1;
  var logG = new Float64Array(nFr);
  for (var f = 0; f < nFr; f++) {
    var cen2 = (f + m0) * Hs;
    var eo = 0;
    for (var c4 = 0; c4 < C; c4++) {
      var d4 = outs[c4];
      for (var n3 = 0; n3 < N; n3 += 2) {
        var v = d4[offset + cen2 - half + n3] * norm * win[n3];
        eo += v * v;
      }
    }
    eo *= 2;
    var ea = anaEnergy[f];
    logG[f] = (ea > 1e-9 && eo > 1e-12) ? 0.5 * Math.log(ea / eo) : 0;
    logG[f] = xsClamp(logG[f], -1.0, 1.0);
  }
  var smoothG = new Float64Array(nFr);
  for (var f2 = 0; f2 < nFr; f2++) {
    smoothG[f2] = 0.25 * logG[Math.max(0, f2 - 1)] + 0.5 * logG[f2] + 0.25 * logG[Math.min(nFr - 1, f2 + 1)];
  }
  return outs.map(function (d) {
    var r = new Float32Array(lenOut);
    for (var i = 0; i < lenOut; i++) {
      var pos = i / Hs - m0;
      var f0 = Math.floor(pos), fr2 = pos - f0;
      var lg = smoothG[Math.min(nFr - 1, Math.max(0, f0))] * (1 - fr2) + smoothG[Math.min(nFr - 1, Math.max(0, f0 + 1))] * fr2;
      r[i] = d[offset + i] * norm * Math.exp(lg);
    }
    return r;
  });
}

/* -------------------------------------------------------------- texture */

/**
 * PaulStretch-style texture: random phases, large windows.
 * @param {Float32Array[]} chans
 * @param {number} sr
 * @param {number} lenOut
 * @param {number} amount 0..1
 */
function xsTexture(chans, sr, lenOut, amount) {
  var C = chans.length;
  var lenIn = chans[0].length;
  var N = xsScaledPow2(4096 * Math.pow(8, xsClamp(amount, 0, 1)), sr);
  var half = N >> 1;
  var OV = 8; // overlap: more frames averaged = less amplitude flutter on tonal input
  var Hs = N / OV;
  var win = xsHann(N);
  var outs = chans.map(function () { return new Float64Array(lenOut + N * 4); });
  var offset = N * 2;
  var frames = [], specRe = [], specIm = [];
  for (var c = 0; c < C; c++) {
    frames.push(new Float64Array(N));
    specRe.push(new Float64Array(half + 1)); specIm.push(new Float64Array(half + 1));
  }
  var wr = new Float64Array(N), wi = new Float64Array(N);
  var seed = 0x9e3779b9;
  var rnd = function () { // xorshift32, deterministic
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };
  var ratio = lenIn / Math.max(1, lenOut);
  var reflect = function (x, i) {
    if (lenIn < 2) return lenIn ? x[0] : 0;
    var period = 2 * (lenIn - 1);
    var j = ((i % period) + period) % period;
    return x[j < lenIn ? j : period - j];
  };
  var mEnd = Math.ceil((lenOut + half) / Hs) + 1;
  for (var m = -(OV - 1); m <= mEnd; m++) {
    var cen = m * Hs;
    var p = Math.round(cen * ratio);
    for (var ch = 0; ch < C; ch++) {
      var x = chans[ch], fr = frames[ch];
      var st = p - half;
      for (var n = 0; n < N; n++) fr[n] = reflect(x, st + n) * win[n];
    }
    xsSpectra(frames, N, wr, wi, specRe, specIm);
    for (var k = 0; k <= half; k++) {
      var sr_ = 0, si_ = 0;
      for (var cc = 0; cc < C; cc++) { sr_ += specRe[cc][k]; si_ += specIm[cc][k]; }
      var ang = Math.atan2(si_, sr_);
      var phi = 2 * XS_PI * rnd();
      var rot = phi - ang;
      var rc = Math.cos(rot), rs = Math.sin(rot);
      for (var c2 = 0; c2 < C; c2++) {
        var a = specRe[c2][k], b = specIm[c2][k];
        specRe[c2][k] = a * rc - b * rs;
        specIm[c2][k] = a * rs + b * rc;
      }
    }
    xsInverse(specRe, specIm, N, wr, wi, frames);
    var base = offset + cen - half;
    for (var c3 = 0; c3 < C; c3++) {
      var fo = frames[c3], dst = outs[c3];
      for (var n2 = 0; n2 < N; n2++) {
        var di = base + n2;
        if (di >= 0 && di < dst.length) dst[di] += fo[n2] * win[n2];
      }
    }
  }
  // random-phase frames add in power: Hann analysis (mean square 3/8) x Hann^2 sum (OV * 3/8)
  var gain = 1 / Math.sqrt(OV * 0.375 * 0.375);
  return outs.map(function (d) {
    var r = new Float32Array(lenOut);
    for (var i = 0; i < lenOut; i++) r[i] = d[offset + i] * gain;
    return r;
  });
}

/* ------------------------------------------------------------------ API */

/**
 * @typedef {{mode?: string, speed?: number, pitchSt?: number, grainMs?: number, amount?: number,
 *   transients?: boolean, phaseLock?: boolean, fftSize?: number, legacyPitchCoupling?: boolean, levelMatch?: boolean}} StretchOpts
 */

/**
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {StretchOpts} [opts]
 * @returns {{channels: Float32Array[], engine: string, note: string}}
 */
function stretchAudioEx(channels, sampleRate, opts) {
  opts = opts || {};
  var mode = opts.mode || "complex";
  var speed = xsClamp(Number(opts.speed) || 1, 0.1, 4);
  var pitchSt = Number(opts.pitchSt) || 0;
  var grainMs = xsClamp(opts.grainMs === undefined ? 45 : Number(opts.grainMs) || 45, 5, 250);
  var amount = xsClamp(Number(opts.amount) || 0, 0, 1);
  var sr = sampleRate || 44100;
  var C = channels.length;
  if (!C || !channels[0].length) return { channels: channels.map(function (c) { return new Float32Array(c); }), engine: mode, note: "empty" };
  var lenIn = channels[0].length;
  var pitchRatio = Math.pow(2, pitchSt / 12);
  var lenOut = Math.max(16, Math.round(lenIn / speed));
  var bypass = Math.abs(speed - 1) < 1e-6 && Math.abs(pitchSt) < 1e-6;
  var note = "";
  var engine = mode;
  /** @type {Float32Array[]} */
  var res;
  if (bypass && mode !== "texture") {
    return { channels: channels.map(function (c) { return new Float32Array(c); }), engine: mode, note: "bypass" };
  }
  if (mode === "granular") {
    res = xsGranular(channels, sr, { speed: speed, pitchSt: pitchSt, grainMs: grainMs, legacyPitchCoupling: !!opts.legacyPitchCoupling, levelMatch: opts.levelMatch !== false });
  } else if (mode === "texture") {
    var tex = xsTexture(channels, sr, Math.round(pitchRatio === 1 ? lenOut : lenIn * pitchRatio / speed), amount);
    res = pitchRatio === 1 ? tex : tex.map(function (t) { return xsResample(t, pitchRatio, lenOut); });
    res.forEach(xsSoftLimit);
  } else {
    engine = "complex"; // "complex" and any unknown mode name
    var stretched = Math.max(16, Math.round(lenIn * pitchRatio / speed));
    var cx = xsComplexStretch(channels, sr, stretched, {
      transients: opts.transients !== false,
      phaseLock: opts.phaseLock !== false,
      fftSize: opts.fftSize
    });
    res = pitchRatio === 1 ? cx : cx.map(function (t) { return xsResample(t, pitchRatio, lenOut); });
    res.forEach(xsSoftLimit);
  }
  res.forEach(xsSanitize);
  return { channels: res, engine: engine, note: note };
}

/**
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {StretchOpts} [opts]
 * @returns {Float32Array[]}
 */
function stretchAudio(channels, sampleRate, opts) {
  return stretchAudioEx(channels, sampleRate, opts).channels;
}

if (typeof module !== "undefined" && module.exports) module.exports = {
  stretchAudio: stretchAudio,
  stretchAudioEx: stretchAudioEx,
  xsFft: xsFft,
  xsDetectOnsets: xsDetectOnsets,
  xsMono: xsMono,
  xsResample: xsResample
};
