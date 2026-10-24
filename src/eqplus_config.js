// EQ+ shared math and buffer layout (Bitwig EQ+ clone).
// Global script: prepended to the v8ui by the build, and require()-able from Node.
// The face pokes one biquad per band into buffer~ #0-eqpluscfg; both the curve
// (eqpBandResponseDb) and src/eqplus_core.genexpr apply that biquad `sections`
// times (1, 2 or 4), so the drawn curve and the DSP match at steady state.
//
// Shift and Adaptive-Q are baked into the coefficients before they are poked.
// eqpBandResponseDb / eqpTotalResponseDb apply the same shift and Adaptive-Q,
// so a curve built from the band objects matches a curve built from the coeffs.

var EQP_NUM_BANDS = 8;

var EQP_FREQ_MIN = 20.0;
var EQP_FREQ_MAX = 20000.0;

var EQP_GAIN_MIN = -30.0;
var EQP_GAIN_MAX = 30.0;

var EQP_Q_MIN = 0.1;
var EQP_Q_MAX = 40.0;
var EQP_Q_DEFAULT = 0.7071;

var EQP_SHIFT_MIN = -36.0;
var EQP_SHIFT_MAX = 36.0;

var EQP_OUTGAIN_MIN = -24.0;
var EQP_OUTGAIN_MAX = 24.0;

// Display range ±dB (the vertical scale of the curve).
var EQP_RANGES = [10, 20, 30];

// Spectrum analyzer resolution (UI FFT of the time-domain ring) and ballistics.
var EQP_RESOLUTIONS = ["Small", "Medium", "Large", "Huge"];
var EQP_FFT_SIZES = [1024, 2048, 4096, 8192];
var EQP_SPEEDS = ["Fast", "Medium", "Slow", "Freeze"];

// Visual tilt of the spectrum, dB per octave. Default index 2 = 4.5 dB/oct.
var EQP_TILTS = [0.0, 3.0, 4.5, 6.0];
var EQP_TILT_LABELS = ["0.0 dB/oct", "3.0 dB/oct", "4.5 dB/oct", "6.0 dB/oct"];
var EQP_TILT_DEFAULT = 2;

// Filter modes, indices 0..12. Cuts and Notch ignore gain (the face drags Q).
// Low-Cut 4 / High-Cut 4 and Low-Cut 8 / High-Cut 8 are 2 and 4 cascaded copies
// of the matching 2-pole (same Q). The cfg slot holds one biquad, so a
// Butterworth Q stagger is not representable; repeating the section is what
// makes the UI magnitude and the DSP magnitude the same number.
var EQP_MODES = [
    "Off",          // 0
    "Low-Cut 1",    // 1  1-pole  6 dB/oct highpass
    "Low-Cut 2",    // 2  2-pole 12 dB/oct resonant highpass
    "Low-Cut 4",    // 3  4-pole 24 dB/oct (2 cascaded copies)
    "Low-Cut 8",    // 4  8-pole 48 dB/oct (4 cascaded copies)
    "Low-Shelf",    // 5  2-pole resonant low shelf
    "Bell",         // 6  peaking bell
    "Notch",        // 7  band-reject
    "High-Shelf",   // 8  2-pole resonant high shelf
    "High-Cut 1",   // 9  1-pole  6 dB/oct lowpass
    "High-Cut 2",   // 10 2-pole 12 dB/oct resonant lowpass
    "High-Cut 4",   // 11 4-pole 24 dB/oct (2 cascaded copies)
    "High-Cut 8"    // 12 8-pole 48 dB/oct (4 cascaded copies)
];

var EQP_DEFAULT_BAND_FREQS = [60, 125, 250, 500, 1000, 2000, 4000, 8000];

// buffer~ #0-eqpluscfg : 64 floats, 8 bands x 8.
//   base = band * EQP_CFG_STRIDE
//   +0 sections (0 bypass, 1, 2, 4)
//   +1 b0  +2 b1  +3 b2  +4 a1  +5 a2     (a0 is normalized to 1)
//   +6 +7 reserved
var EQP_CFG_STRIDE = 8;
var EQP_CFG_SIZE = 64;
var EQP_CFG_OFF_SECTIONS = 0;
var EQP_CFG_OFF_B0 = 1;
var EQP_CFG_OFF_B1 = 2;
var EQP_CFG_OFF_B2 = 3;
var EQP_CFG_OFF_A1 = 4;
var EQP_CFG_OFF_A2 = 5;

// buffer~ #0-eqplusspec : 8200 frames, 2 channels.
//   frame 0 ch 0 : write index 0..8191 (next frame the gen will write)
//   frame 0 ch 1 : DSP heartbeat (advances every 64 samples)
//   frame 1 ch 0 : sample rate
//   frames 8 .. 8+8191 : ch 0 pre mono (L+R)*0.5, ch 1 post mono (L+R)*0.5
var EQP_SPEC_RING = 8192;
var EQP_SPEC_BUF_FRAMES = 8200;
var EQP_SPEC_WRITE_FRAME = 0;
var EQP_SPEC_SR_FRAME = 1;
var EQP_SPEC_AUDIO_FRAME = 8;

// normX stops along the log frequency axis, then r, g, b. Screenshot rainbow.
var EQP_RAINBOW_STOPS = [
    [0.00, 0.88, 0.22, 0.20],
    [0.18, 0.95, 0.52, 0.15],
    [0.33, 0.92, 0.88, 0.18],
    [0.50, 0.25, 0.90, 0.35],
    [0.66, 0.20, 0.82, 0.92],
    [0.82, 0.42, 0.48, 0.96],
    [0.92, 0.72, 0.58, 0.96],
    [1.00, 0.88, 0.88, 0.92]
];

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function eqpClamp(v, lo, hi) {
    var x = Number(v);
    if (!isFinite(x)) x = lo;
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
}

/**
 * Global Shift: freqHz * 2^(semitones/12), clamped to 20..20000 Hz.
 * @param {number} freqHz
 * @param {number} shiftSt
 * @returns {number}
 */
function eqpEffectiveFreq(freqHz, shiftSt) {
    var f = Number(freqHz);
    if (!isFinite(f) || f <= 0) f = 1000;
    var st = Number(shiftSt);
    if (!isFinite(st)) st = 0;
    var out = f * Math.pow(2, st / 12);
    if (!isFinite(out)) return EQP_FREQ_MIN;
    return eqpClamp(out, EQP_FREQ_MIN, EQP_FREQ_MAX);
}

/**
 * Adaptive-Q (Bell only): Q * 2^(|gainDb|/12), then clamped to 0.1..40.
 * Shelves, cuts and Notch return the clamped Q unchanged.
 * @param {number} q
 * @param {number} gainDb
 * @param {number|boolean} adaptiveQ
 * @param {number} mode
 * @returns {number}
 */
function eqpEffectiveQ(q, gainDb, adaptiveQ, mode) {
    var qq = Number(q);
    if (!isFinite(qq) || qq <= 0) qq = EQP_Q_DEFAULT;
    if (adaptiveQ && (mode | 0) === 6) {
        var g = Number(gainDb);
        if (!isFinite(g)) g = 0;
        qq = qq * Math.pow(2, Math.abs(g) / 12);
    }
    return eqpClamp(qq, EQP_Q_MIN, EQP_Q_MAX);
}

/**
 * Bell, Low-Shelf and High-Shelf use gain. Off, cuts and Notch do not
 * (a vertical drag on those bands edits Q in log space).
 * @param {number} mode
 * @returns {boolean}
 */
function eqpBandUsesGain(mode) {
    var m = mode | 0;
    return m === 5 || m === 6 || m === 8;
}

/**
 * Cascaded biquad sections for this mode: 0 off, 1 for 1-pole / 2-pole /
 * shelf / bell / notch, 2 for the 4-pole cuts, 4 for the 8-pole cuts.
 * @param {number} mode
 * @returns {number}
 */
function eqpModePoles(mode) {
    var m = mode | 0;
    if (m === 3 || m === 11) return 2;
    if (m === 4 || m === 12) return 4;
    if (m >= 1 && m <= 12) return 1;
    return 0;
}

/**
 * @param {number} b0
 * @param {number} b1
 * @param {number} b2
 * @param {number} a0
 * @param {number} a1
 * @param {number} a2
 * @param {number} sections
 * @returns {{b0: number, b1: number, b2: number, a1: number, a2: number, sections: number}}
 */
function eqpNormalizeBiquad(b0, b1, b2, a0, a1, a2, sections) {
    var inv = (a0 !== 0 && isFinite(a0)) ? (1 / a0) : 0;
    return {
        b0: b0 * inv,
        b1: b1 * inv,
        b2: b2 * inv,
        a1: a1 * inv,
        a2: a2 * inv,
        sections: sections
    };
}

/**
 * RBJ Audio EQ Cookbook biquad, a0 normalized to 1.
 * Low-Cut 1 / High-Cut 1 are an exact 1-pole bilinear section (b2 = a2 = 0).
 * 4-pole and 8-pole cuts return the 2-pole once, with `sections` 2 or 4:
 * the caller (and the gen) runs that same biquad that many times.
 * @param {number} mode
 * @param {number} freqHz
 * @param {number} gainDb
 * @param {number} q
 * @param {number} sr
 * @returns {{b0: number, b1: number, b2: number, a1: number, a2: number, sections: number}}
 */
function eqpBiquadCoeffs(mode, freqHz, gainDb, q, sr) {
    var unity = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, sections: 0 };
    var m = mode | 0;
    var sections = eqpModePoles(m);
    if (sections <= 0) return unity;

    var srN = Number(sr);
    if (!isFinite(srN) || srN < 1000) srN = 48000;
    var fHi = Math.min(EQP_FREQ_MAX, srN * 0.49);
    var f = eqpClamp(Number(freqHz) || 1000, EQP_FREQ_MIN, fHi);
    var qq = eqpClamp(Number(q) || EQP_Q_DEFAULT, EQP_Q_MIN, EQP_Q_MAX);
    var gd = eqpClamp(Number(gainDb) || 0, EQP_GAIN_MIN, EQP_GAIN_MAX);

    var w0 = 2 * Math.PI * f / srN;
    var cosw = Math.cos(w0);
    var sinw = Math.sin(w0);
    var alpha = sinw / (2 * qq);

    if (m === 1 || m === 9) {
        var g = Math.tan(Math.PI * f / srN);
        var nrm = 1 / (1 + g);
        var a1p = (g - 1) * nrm;
        if (m === 9) {
            return { b0: g * nrm, b1: g * nrm, b2: 0, a1: a1p, a2: 0, sections: sections };
        }
        return { b0: nrm, b1: -nrm, b2: 0, a1: a1p, a2: 0, sections: sections };
    }

    if (m === 2 || m === 3 || m === 4) {
        var hp = (1 + cosw) * 0.5;
        return eqpNormalizeBiquad(hp, -(1 + cosw), hp, 1 + alpha, -2 * cosw, 1 - alpha, sections);
    }
    if (m === 10 || m === 11 || m === 12) {
        var lp = (1 - cosw) * 0.5;
        return eqpNormalizeBiquad(lp, 1 - cosw, lp, 1 + alpha, -2 * cosw, 1 - alpha, sections);
    }
    if (m === 7) {
        return eqpNormalizeBiquad(1, -2 * cosw, 1, 1 + alpha, -2 * cosw, 1 - alpha, sections);
    }

    var A = Math.pow(10, gd / 40);
    if (m === 6) {
        return eqpNormalizeBiquad(
            1 + alpha * A, -2 * cosw, 1 - alpha * A,
            1 + alpha / A, -2 * cosw, 1 - alpha / A,
            sections
        );
    }
    var twoSqA = 2 * Math.sqrt(A) * alpha;
    if (m === 5) {
        return eqpNormalizeBiquad(
            A * ((A + 1) - (A - 1) * cosw + twoSqA),
            2 * A * ((A - 1) - (A + 1) * cosw),
            A * ((A + 1) - (A - 1) * cosw - twoSqA),
            (A + 1) + (A - 1) * cosw + twoSqA,
            -2 * ((A - 1) + (A + 1) * cosw),
            (A + 1) + (A - 1) * cosw - twoSqA,
            sections
        );
    }
    if (m === 8) {
        return eqpNormalizeBiquad(
            A * ((A + 1) + (A - 1) * cosw + twoSqA),
            -2 * A * ((A - 1) + (A + 1) * cosw),
            A * ((A + 1) + (A - 1) * cosw - twoSqA),
            (A + 1) - (A - 1) * cosw + twoSqA,
            2 * ((A - 1) - (A + 1) * cosw),
            (A + 1) - (A - 1) * cosw - twoSqA,
            sections
        );
    }
    return unity;
}

/**
 * Exact |H(e^{jw})|^2 of one normalized biquad (a0 = 1).
 * phi = sin^2(w/2) form, algebraically identical to the cosine expansion.
 * @param {number} b0
 * @param {number} b1
 * @param {number} b2
 * @param {number} a1
 * @param {number} a2
 * @param {number} w normalized radians (2 * pi * f / sr)
 * @returns {number}
 */
function eqpBiquadMagSq(b0, b1, b2, a1, a2, w) {
    var half = Math.sin(w * 0.5);
    var phi = half * half;
    var num = (b0 + b1 + b2) * (b0 + b1 + b2)
        - 4 * (b0 * b1 + 4 * b0 * b2 + b1 * b2) * phi
        + 16 * b0 * b2 * phi * phi;
    var den = (1 + a1 + a2) * (1 + a1 + a2)
        - 4 * (a1 + 4 * a2 + a1 * a2) * phi
        + 16 * a2 * phi * phi;
    if (!(den > 1e-30)) return 0;
    var mag = num / den;
    if (!(mag > 0) || !isFinite(mag)) return 0;
    return mag;
}

/**
 * dB magnitude of one band at f Hz. 0 when the band is off.
 * `sections` copies of the biquad multiply, so dB scales by `sections`.
 * @param {{enabled: number|boolean, mode: number, freq: number, gain: number, q: number}} band
 * @param {number} f
 * @param {number} sr
 * @param {number} shiftSt
 * @param {number|boolean} adaptiveQ
 * @returns {number}
 */
function eqpBandResponseDb(band, f, sr, shiftSt, adaptiveQ) {
    if (!band || !band.enabled || (band.mode | 0) === 0) return 0;
    var srN = Number(sr);
    if (!isFinite(srN) || srN < 1000) srN = 48000;
    var freq = eqpEffectiveFreq(band.freq, shiftSt);
    var q = eqpEffectiveQ(band.q, band.gain, adaptiveQ, band.mode);
    var c = eqpBiquadCoeffs(band.mode, freq, band.gain, q, srN);
    if (!c.sections) return 0;
    var ff = Number(f);
    if (!isFinite(ff) || ff < 0) ff = 0;
    var magSq = eqpBiquadMagSq(c.b0, c.b1, c.b2, c.a1, c.a2, 2 * Math.PI * ff / srN);
    if (!(magSq > 1e-30)) magSq = 1e-30;
    return c.sections * 10 * Math.log10(magSq);
}

/**
 * Sum of every band's dB response, plus outGainDb.
 * @param {Array<{enabled: number|boolean, mode: number, freq: number, gain: number, q: number}>} bands
 * @param {number} f
 * @param {number} sr
 * @param {number} shiftSt
 * @param {number|boolean} adaptiveQ
 * @param {number} [outGainDb]
 * @returns {number}
 */
function eqpTotalResponseDb(bands, f, sr, shiftSt, adaptiveQ, outGainDb) {
    var extra = Number(outGainDb);
    var sum = isFinite(extra) ? extra : 0;
    var list = bands || [];
    var n = list.length < EQP_NUM_BANDS ? list.length : EQP_NUM_BANDS;
    for (var i = 0; i < n; i++) {
        sum += eqpBandResponseDb(list[i], f, sr, shiftSt, adaptiveQ);
    }
    return sum;
}

/**
 * Log map 20..20000 Hz onto 0..1.
 * @param {number} f
 * @returns {number}
 */
function eqpFreqToNorm(f) {
    var ff = eqpClamp(Number(f) || EQP_FREQ_MIN, EQP_FREQ_MIN, EQP_FREQ_MAX);
    return Math.log(ff / EQP_FREQ_MIN) / Math.log(EQP_FREQ_MAX / EQP_FREQ_MIN);
}

/**
 * Inverse of eqpFreqToNorm.
 * @param {number} n
 * @returns {number}
 */
function eqpNormToFreq(n) {
    var nn = eqpClamp(Number(n) || 0, 0, 1);
    return EQP_FREQ_MIN * Math.pow(EQP_FREQ_MAX / EQP_FREQ_MIN, nn);
}

/**
 * Linear map -rangeDb..+rangeDb onto 0..1 (0 = bottom, 0.5 = 0 dB, 1 = top).
 * @param {number} db
 * @param {number} rangeDb
 * @returns {number}
 */
function eqpDbToNorm(db, rangeDb) {
    var r = Number(rangeDb);
    if (!(r > 0) || !isFinite(r)) r = 30;
    var x = Number(db);
    if (!isFinite(x)) x = 0;
    return eqpClamp((x + r) / (2 * r), 0, 1);
}

/**
 * Inverse of eqpDbToNorm.
 * @param {number} n
 * @param {number} rangeDb
 * @returns {number}
 */
function eqpNormToDb(n, rangeDb) {
    var r = Number(rangeDb);
    if (!(r > 0) || !isFinite(r)) r = 30;
    var nn = eqpClamp(Number(n) || 0, 0, 1);
    return (nn * 2 - 1) * r;
}

/**
 * Log map Q 0.1..40 onto 0..1.
 * @param {number} q
 * @returns {number}
 */
function eqpQToNorm(q) {
    var qq = eqpClamp(Number(q) || EQP_Q_DEFAULT, EQP_Q_MIN, EQP_Q_MAX);
    return Math.log(qq / EQP_Q_MIN) / Math.log(EQP_Q_MAX / EQP_Q_MIN);
}

/**
 * Inverse of eqpQToNorm.
 * @param {number} n
 * @returns {number}
 */
function eqpNormToQ(n) {
    var nn = eqpClamp(Number(n) || 0, 0, 1);
    return EQP_Q_MIN * Math.pow(EQP_Q_MAX / EQP_Q_MIN, nn);
}

/**
 * Bitwig EQ+ horizontal spectrum rainbow. normX is 0 at 20 Hz and 1 at 20 kHz.
 * @param {number} normX
 * @returns {number[]} r, g, b in 0..1
 */
function eqpRainbowColor(normX) {
    var x = Number(normX);
    if (!isFinite(x) || x < 0) x = 0;
    if (x > 1) x = 1;
    var stops = EQP_RAINBOW_STOPS;
    var i = 0;
    while (i < stops.length - 2 && x > stops[i + 1][0]) i++;
    var lo = stops[i];
    var hi = stops[i + 1];
    var span = hi[0] - lo[0];
    var t = span > 0 ? (x - lo[0]) / span : 0;
    return [
        lo[1] + (hi[1] - lo[1]) * t,
        lo[2] + (hi[2] - lo[2]) * t,
        lo[3] + (hi[3] - lo[3]) * t
    ];
}

/**
 * Drawable gesture zones. normX is left-to-right, normY is bottom-to-top
 * (0 = -Range, 1 = +Range). curveNormY is the composite curve at normX.
 * Bottom edge wins, then a hit on the curve, then the far-left / far-right
 * empty areas, then a bell.
 * @param {number} normX
 * @param {number} normY
 * @param {number} curveNormY
 * @returns {{mode: number, name: string}}
 */
function eqpClassifyGestureZone(normX, normY, curveNormY) {
    var x = Number(normX);
    var y = Number(normY);
    var curve = Number(curveNormY);
    if (!isFinite(x)) x = 0;
    if (!isFinite(y)) y = 0;
    if (!isFinite(curve)) curve = 0.5;
    if (y < 0.12) return { mode: 7, name: "Notch" };
    if (Math.abs(y - curve) <= 0.14) {
        if (x < 0.12) return { mode: 5, name: "Low-Shelf" };
        if (x > 0.88) return { mode: 8, name: "High-Shelf" };
        return { mode: 6, name: "Bell" };
    }
    if (x < 0.12) return { mode: 2, name: "Low-Cut 2" };
    if (x > 0.88) return { mode: 10, name: "High-Cut 2" };
    return { mode: 6, name: "Bell" };
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        EQP_NUM_BANDS: EQP_NUM_BANDS,
        EQP_FREQ_MIN: EQP_FREQ_MIN,
        EQP_FREQ_MAX: EQP_FREQ_MAX,
        EQP_GAIN_MIN: EQP_GAIN_MIN,
        EQP_GAIN_MAX: EQP_GAIN_MAX,
        EQP_Q_MIN: EQP_Q_MIN,
        EQP_Q_MAX: EQP_Q_MAX,
        EQP_Q_DEFAULT: EQP_Q_DEFAULT,
        EQP_SHIFT_MIN: EQP_SHIFT_MIN,
        EQP_SHIFT_MAX: EQP_SHIFT_MAX,
        EQP_OUTGAIN_MIN: EQP_OUTGAIN_MIN,
        EQP_OUTGAIN_MAX: EQP_OUTGAIN_MAX,
        EQP_RANGES: EQP_RANGES,
        EQP_RESOLUTIONS: EQP_RESOLUTIONS,
        EQP_FFT_SIZES: EQP_FFT_SIZES,
        EQP_SPEEDS: EQP_SPEEDS,
        EQP_TILTS: EQP_TILTS,
        EQP_TILT_LABELS: EQP_TILT_LABELS,
        EQP_TILT_DEFAULT: EQP_TILT_DEFAULT,
        EQP_MODES: EQP_MODES,
        EQP_DEFAULT_BAND_FREQS: EQP_DEFAULT_BAND_FREQS,
        EQP_CFG_STRIDE: EQP_CFG_STRIDE,
        EQP_CFG_SIZE: EQP_CFG_SIZE,
        EQP_CFG_OFF_SECTIONS: EQP_CFG_OFF_SECTIONS,
        EQP_CFG_OFF_B0: EQP_CFG_OFF_B0,
        EQP_CFG_OFF_B1: EQP_CFG_OFF_B1,
        EQP_CFG_OFF_B2: EQP_CFG_OFF_B2,
        EQP_CFG_OFF_A1: EQP_CFG_OFF_A1,
        EQP_CFG_OFF_A2: EQP_CFG_OFF_A2,
        EQP_SPEC_RING: EQP_SPEC_RING,
        EQP_SPEC_BUF_FRAMES: EQP_SPEC_BUF_FRAMES,
        EQP_SPEC_WRITE_FRAME: EQP_SPEC_WRITE_FRAME,
        EQP_SPEC_SR_FRAME: EQP_SPEC_SR_FRAME,
        EQP_SPEC_AUDIO_FRAME: EQP_SPEC_AUDIO_FRAME,
        EQP_RAINBOW_STOPS: EQP_RAINBOW_STOPS,
        eqpEffectiveFreq: eqpEffectiveFreq,
        eqpEffectiveQ: eqpEffectiveQ,
        eqpBandUsesGain: eqpBandUsesGain,
        eqpModePoles: eqpModePoles,
        eqpBiquadCoeffs: eqpBiquadCoeffs,
        eqpBiquadMagSq: eqpBiquadMagSq,
        eqpBandResponseDb: eqpBandResponseDb,
        eqpTotalResponseDb: eqpTotalResponseDb,
        eqpFreqToNorm: eqpFreqToNorm,
        eqpNormToFreq: eqpNormToFreq,
        eqpDbToNorm: eqpDbToNorm,
        eqpNormToDb: eqpNormToDb,
        eqpQToNorm: eqpQToNorm,
        eqpNormToQ: eqpNormToQ,
        eqpRainbowColor: eqpRainbowColor,
        eqpClassifyGestureZone: eqpClassifyGestureZone
    };
}
