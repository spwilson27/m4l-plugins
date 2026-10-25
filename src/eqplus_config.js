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

// Shelves and bells. Cuts and notches ignore gain.
var EQP_GAIN_MIN = -36.0;
var EQP_GAIN_MAX = 36.0;

var EQP_Q_MIN = 0.1;
var EQP_Q_MAX = 40.0;
var EQP_Q_DEFAULT = 0.7071;

var EQP_SHIFT_MIN = -64.0;
var EQP_SHIFT_MAX = 64.0;

var EQP_OUTGAIN_MIN = -24.0;
var EQP_OUTGAIN_MAX = 24.0;

// Display range ±dB (the vertical scale of the curve).
var EQP_RANGES = [12, 24, 36];

// Flat tilt: a straight slope of `tiltDb` dB per decade on a log-frequency
// plot, 0 dB at 1 kHz. +12 is about +12 dB at 10 kHz and -12 dB at 100 Hz.
// The drawn curve includes it. Output gain does not.
var EQP_TILT_PIVOT = 1000;
var EQP_TILT_DB_MAX = 24;
// First-order low shelves, one per octave. Each shelf's gain is
// -tiltDb * EQP_TILT_SCALE, and a makeup gain puts the pivot at 0 dB.
// Scale 0.316 keeps the cascade within about 0.8 dB of a straight line
// from 40 Hz to 16 kHz at ±12 dB/decade.
var EQP_TILT_FC = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800];
var EQP_TILT_SCALE = 0.316;

// Shelf vs cut. Within 9.5 px of the 0 dB line (the plot is 115 px tall)
// the cursor places a shelf. Further from the line is a cut.
var EQP_SHELF_PX = 9.5;
var EQP_SHELF_BAND = EQP_SHELF_PX / 115;

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

// Device width. The main panel is 4 px + 352 px plot + 4 px. Each pop-out
// shelf adds its width on the right: the 8-band filter cards, then the
// spectrum-analyzer inspector.
var EQP_MAIN_W = 360;
var EQP_FILTERS_SHELF_W = 248;
var EQP_ANALYZER_SHELF_W = 148;
// The sidechain tab is always on the left (Ableton Compressor). Opening the
// fold grows that column to EQP_SIDECHAIN_FOLD_W, which includes the tab.
var EQP_SC_TAB_W = 18;
var EQP_SIDECHAIN_FOLD_W = 128;
// soloBand param: -1 is off, 0..7 auditions that band through a bandpass.
var EQP_SOLO_OFF = -1;

// buffer~ #0-eqpluscfg : 128 floats, two curves of 8 bands x 8.
// Curve A (the left channel, or the mid) starts at 0. Curve B (the right
// channel, or the side) starts at 64. Stereo writes the same
// curve into both halves; the gen reads the second half only when the
// channels are split.
//   base = band * EQP_CFG_STRIDE
//   +0 sections (0 bypass, 1, 2, 4)
//   +1 b0  +2 b1  +3 b2  +4 a1  +5 a2     (a0 is normalized to 1)
//   +6 +7 reserved
var EQP_CFG_STRIDE = 8;
var EQP_CFG_SIZE = 128;
var EQP_CFG_OFF_SECTIONS = 0;
var EQP_CFG_OFF_B0 = 1;
var EQP_CFG_OFF_B1 = 2;
var EQP_CFG_OFF_B2 = 3;
var EQP_CFG_OFF_A1 = 4;
var EQP_CFG_OFF_A2 = 5;

// buffer~ #0-eqplusspec : 8200 frames.
//   ch 0 pre mono, ch 1 post mono (frames 8 .. 8+8191). Header on those
//   channels: frame 0 ch 0 write index, frame 0 ch 1 heartbeat, frame 1 ch 0 sample rate.
//   ch 2 metadata: index 0 frameTick, index 1 writeIdx, index 2 samplerate.
//   ch 3 sidechain reference mono (in3/in4 only). It never reaches out1/out2.
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
 * First-order low shelf. DC gain is `db`, high frequencies are 0 dB.
 * b2 and a2 are 0 so it runs as one pole in the tilt cascade.
 * @param {number} fc
 * @param {number} db
 * @param {number} sr
 * @returns {{b0: number, b1: number, b2: number, a1: number, a2: number}}
 */
function eqpTiltShelf1(fc, db, sr) {
    var srN = Number(sr);
    if (!isFinite(srN) || srN < 1000) srN = 48000;
    var A = Math.pow(10, Number(db) / 40);
    if (!isFinite(A) || A < 1e-6) A = 1e-6;
    var f = Number(fc);
    if (!isFinite(f) || f < 1) f = 1;
    if (f > srN * 0.45) f = srN * 0.45;
    var K = Math.tan(Math.PI * f / srN);
    var a0 = 1 + K / A;
    if (!(Math.abs(a0) > 1e-12)) a0 = 1;
    return {
        b0: (1 + K * A) / a0,
        b1: (-1 + K * A) / a0,
        b2: 0,
        a1: (-1 + K / A) / a0,
        a2: 0
    };
}

/**
 * Flat tilt as octave-spaced first-order low shelves plus a makeup gain
 * that holds 1 kHz at 0 dB. tilt 0 is unity. The gen runs these same sections.
 * @param {number} tiltDb
 * @param {number} sr
 * @returns {{on: number, gain: number, sections: Array<{b0: number, b1: number, b2: number, a1: number, a2: number}>}}
 */
function eqpTiltCoeffs(tiltDb, sr) {
    var srN = Number(sr);
    if (!isFinite(srN) || srN < 1000) srN = 48000;
    var t = Number(tiltDb);
    var on = 1;
    if (!isFinite(t) || Math.abs(t) < 0.05) {
        on = 0;
        t = 0;
    } else {
        t = eqpClamp(t, -EQP_TILT_DB_MAX, EQP_TILT_DB_MAX);
    }
    var g = -t * EQP_TILT_SCALE;
    var sections = [];
    var i;
    for (i = 0; i < EQP_TILT_FC.length; i++) sections.push(eqpTiltShelf1(EQP_TILT_FC[i], g, srN));
    var pivot = 0;
    if (on) {
        var w0 = 2 * Math.PI * EQP_TILT_PIVOT / srN;
        for (i = 0; i < sections.length; i++) {
            var s = sections[i];
            var m = eqpBiquadMagSq(s.b0, s.b1, s.b2, s.a1, s.a2, w0);
            if (!(m > 1e-30)) m = 1e-30;
            pivot += 10 * Math.log10(m);
        }
    }
    var gain = Math.pow(10, -pivot / 20);
    if (!isFinite(gain) || gain <= 0) gain = 1;
    return { on: on, gain: gain, sections: sections };
}

/**
 * dB of the flat tilt at f Hz. 0 when the tilt is off.
 * A positive tilt rises by about `tiltDb` dB per decade through 1 kHz.
 * @param {number} tiltDb
 * @param {number} f
 * @param {number} sr
 * @returns {number}
 */
function eqpTiltResponseDb(tiltDb, f, sr) {
    var c = eqpTiltCoeffs(tiltDb, sr);
    if (!c.on) return 0;
    var srN = Number(sr);
    if (!isFinite(srN) || srN < 1000) srN = 48000;
    var ff = Number(f);
    if (!isFinite(ff) || ff < 0) ff = 0;
    var w = 2 * Math.PI * ff / srN;
    var db = 20 * Math.log10(c.gain);
    for (var i = 0; i < c.sections.length; i++) {
        var s = c.sections[i];
        var m = eqpBiquadMagSq(s.b0, s.b1, s.b2, s.a1, s.a2, w);
        if (!(m > 1e-30)) m = 1e-30;
        db += 10 * Math.log10(m);
    }
    return db;
}

/**
 * Sum of every band's dB response, plus an optional output-gain offset and the tilt filter.
 * The face draws the curve with outGainDb 0: output gain is applied after the EQ and
 * does not move the line.
 * @param {Array<{enabled: number|boolean, mode: number, freq: number, gain: number, q: number}>} bands
 * @param {number} f
 * @param {number} sr
 * @param {number} shiftSt
 * @param {number|boolean} adaptiveQ
 * @param {number} [outGainDb]
 * @param {number} [tiltDb]
 * @returns {number}
 */
function eqpTotalResponseDb(bands, f, sr, shiftSt, adaptiveQ, outGainDb, tiltDb) {
    var extra = Number(outGainDb);
    var sum = isFinite(extra) ? extra : 0;
    sum += eqpTiltResponseDb(tiltDb, f, sr);
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
 * (0 = -Range, 1 = +Range). The bands are fixed to the 0 dB center
 * (normY 0.5), not the drawn curve, so a low shelf still appears at 0 dB
 * after a shelf has moved the line. Bottom edge wins (normY < 0.14), then
 * the center band (|y - 0.5| <= EQP_SHELF_BAND, 9.5 px on the 115 px plot),
 * then the far-left / far-right empty areas (normX < 0.14 / > 0.86),
 * then a bell. The third argument is ignored. The fourth is the reach around
 * 0 dB as a fraction of the plot; omitted, it is EQP_SHELF_BAND.
 * @param {number} normX
 * @param {number} normY
 * @param {number} [_curveNormY]
 * @param {number} [band]
 * @returns {{mode: number, name: string}}
 */
function eqpClassifyGestureZone(normX, normY, _curveNormY, band) {
    var x = Number(normX);
    var y = Number(normY);
    var reach = Number(band);
    if (!isFinite(x)) x = 0;
    if (!isFinite(y)) y = 0;
    if (!isFinite(reach)) reach = EQP_SHELF_BAND;
    if (y < 0.14) return { mode: 7, name: "Notch" };
    if (Math.abs(y - 0.5) <= reach + 1e-9) {
        if (x < 0.14) return { mode: 5, name: "Low-Shelf" };
        if (x > 0.86) return { mode: 8, name: "High-Shelf" };
        return { mode: 6, name: "Bell" };
    }
    if (x < 0.14) return { mode: 2, name: "Low-Cut 2" };
    if (x > 0.86) return { mode: 10, name: "High-Cut 2" };
    return { mode: 6, name: "Bell" };
}

/**
 * Presentation width: main panel, the always-visible sidechain tab, right-hand
 * shelves, and the opened sidechain fold. The third argument is optional.
 * Closed, the tab adds EQP_SC_TAB_W. Open, the fold width replaces the tab
 * (the tab is the left edge of that column).
 * @param {number|boolean} showFiltersShelf
 * @param {number|boolean} showAnalyzerShelf
 * @param {number|boolean} [showSidechainFold]
 * @returns {number}
 */
function eqpComputeDeviceWidth(showFiltersShelf, showAnalyzerShelf, showSidechainFold) {
    return EQP_MAIN_W
        + (showFiltersShelf ? EQP_FILTERS_SHELF_W : 0)
        + (showAnalyzerShelf ? EQP_ANALYZER_SHELF_W : 0)
        + (showSidechainFold ? EQP_SIDECHAIN_FOLD_W : EQP_SC_TAB_W);
}

/**
 * 2-pole RBJ bandpass (constant 0 dB peak) for the speaker-icon audition.
 * Pass the band's shifted frequency and effective Q. The gen isolates the
 * dry input through this biquad while Param soloBand is 0..7; -1 is the
 * full EQ. Messages: soloB0, soloB1, soloB2, soloA1, soloA2.
 * b0 = alpha, b1 = 0, b2 = -alpha, a0 = 1 + alpha, a1 = -2*cos(w0), a2 = 1 - alpha.
 * @param {number} freqHz
 * @param {number} q
 * @param {number} sr
 * @returns {{b0: number, b1: number, b2: number, a1: number, a2: number, sections: number}}
 */
function eqpSoloBandCoeffs(freqHz, q, sr) {
    var srN = Number(sr);
    if (!isFinite(srN) || srN < 1000) srN = 48000;
    var fHi = Math.min(EQP_FREQ_MAX, srN * 0.49);
    var f = eqpClamp(Number(freqHz) || 1000, EQP_FREQ_MIN, fHi);
    var qq = eqpClamp(Number(q) || EQP_Q_DEFAULT, EQP_Q_MIN, EQP_Q_MAX);
    var w0 = 2 * Math.PI * f / srN;
    var alpha = Math.sin(w0) / (2 * qq);
    return eqpNormalizeBiquad(alpha, 0, -alpha, 1 + alpha, -2 * Math.cos(w0), 1 - alpha, 1);
}

// Processing mode, matching FabFilter Pro-Q 3:
//   0 Zero Latency — the biquad cascade, no delay
//   1 Natural Phase — the same cascade plus a short minimum-phase correction
//     toward the analog prototype, then a pure delay of 7.3 ms (322 samples
//     at 44.1 kHz). Pro-Q's middle mode. Not a per-band dynamic EQ.
//   2 Linear Phase — FFT overlap-add of a symmetric IR. Hop 2048, peak at
//     sample 1025, so the peak leaves the convolver at sample 3072. That is
//     Pro-Q 3 Linear Phase Low at 44.1 kHz. Medium and above need a longer
//     transform than the 4096-point FFT.
var EQP_PHASE_MODES = ["Zero Latency", "Natural Phase", "Linear Phase"];
var EQP_PHASE_SHORT = ["Zero", "Natural", "Linear"];
var EQP_PHASE_FFT = 4096;
var EQP_PHASE_HOP = 2048;
var EQP_PHASE_IR = 2048;
var EQP_PHASE_PEAK = 1025;
var EQP_LINEAR_LATENCY = (EQP_PHASE_HOP - 1) + EQP_PHASE_PEAK;
var EQP_PHASE_FIR = 128;
var EQP_NATURAL_AT_44K = 322;

/**
 * Natural Phase latency in samples. 322 at 44.1 kHz (about 7.3 ms), scaled
 * with the sample rate the way Pro-Q's measured figure scales.
 * @param {number} sr
 * @returns {number}
 */
function eqpNaturalLatency(sr) {
    var srN = Number(sr);
    if (!isFinite(srN) || srN < 1000) srN = 48000;
    return Math.round(EQP_NATURAL_AT_44K * srN / 44100);
}

/**
 * In-place radix-2 FFT. Inverse divides by n. Used to design the IRs; the
 * gen convolves with its own fft_run of the same time-domain taps.
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @param {boolean} inverse
 */
function eqpFft(re, im, inverse) {
    var n = re.length;
    var i, j, k, len, half, ang, wRe, wIm, wlenRe, wlenIm, uRe, uIm, vRe, vIm, nwRe;
    j = 0;
    for (i = 1; i < n; i++) {
        half = n >> 1;
        while (j & half) {
            j ^= half;
            half >>= 1;
        }
        j ^= half;
        if (i < j) {
            uRe = re[i]; re[i] = re[j]; re[j] = uRe;
            uIm = im[i]; im[i] = im[j]; im[j] = uIm;
        }
    }
    for (len = 2; len <= n; len <<= 1) {
        ang = (inverse ? 2 : -2) * Math.PI / len;
        wlenRe = Math.cos(ang);
        wlenIm = Math.sin(ang);
        half = len >> 1;
        for (i = 0; i < n; i += len) {
            wRe = 1;
            wIm = 0;
            for (k = 0; k < half; k++) {
                vRe = re[i + k + half] * wRe - im[i + k + half] * wIm;
                vIm = re[i + k + half] * wIm + im[i + k + half] * wRe;
                uRe = re[i + k];
                uIm = im[i + k];
                re[i + k] = uRe + vRe;
                im[i + k] = uIm + vIm;
                re[i + k + half] = uRe - vRe;
                im[i + k + half] = uIm - vIm;
                nwRe = wRe * wlenRe - wIm * wlenIm;
                wIm = wRe * wlenIm + wIm * wlenRe;
                wRe = nwRe;
            }
        }
    }
    if (inverse) {
        for (i = 0; i < n; i++) {
            re[i] /= n;
            im[i] /= n;
        }
    }
}

function eqpCmul(ar, ai, br, bi) {
    return { re: ar * br - ai * bi, im: ar * bi + ai * br };
}
function eqpCdiv(nr, ni, dr, di) {
    var m = dr * dr + di * di;
    if (!(m > 1e-24)) return { re: 0, im: 0 };
    return { re: (nr * dr + ni * di) / m, im: (ni * dr - nr * di) / m };
}
function eqpCpow(re, im, n) {
    var r = 1, i = 0, k, m;
    var p = n | 0;
    for (k = 0; k < p; k++) {
        m = eqpCmul(r, i, re, im);
        r = m.re;
        i = m.im;
    }
    return { re: r, im: i };
}
function eqpBiquadH(c, w) {
    var c1 = Math.cos(w), s1 = Math.sin(w);
    var c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    var nr = c.b0 + c.b1 * c1 + c.b2 * c2;
    var ni = -c.b1 * s1 - c.b2 * s2;
    var dr = 1 + c.a1 * c1 + c.a2 * c2;
    var di = -c.a1 * s1 - c.a2 * s2;
    return eqpCdiv(nr, ni, dr, di);
}

/**
 * One analog RBJ section at radian frequency w (not prewarped).
 * @returns {{re: number, im: number}}
 */
function eqpAnalogSection(mode, freq, gainDb, q, f) {
    var m = mode | 0;
    var w0 = 2 * Math.PI * freq;
    var w = 2 * Math.PI * Math.max(0, f);
    var A = Math.pow(10, (Number(gainDb) || 0) / 40);
    var qq = q > 1e-6 ? q : 1e-6;
    var sqA = Math.sqrt(A);
    if (m === 1) return eqpCdiv(0, w, w0, w);
    if (m === 9) return eqpCdiv(w0, 0, w0, w);
    var n2 = 1, n1 = w0 / qq, n0 = w0 * w0;
    var d2 = 1, d1 = w0 / qq, d0 = w0 * w0;
    if (m === 2 || m === 3 || m === 4) {
        n2 = 1; n1 = 0; n0 = 0;
    } else if (m === 10 || m === 11 || m === 12) {
        n2 = 0; n1 = 0; n0 = w0 * w0;
    } else if (m === 7) {
        n2 = 1; n1 = 0; n0 = w0 * w0;
    } else if (m === 6) {
        n1 = (A / qq) * w0;
        d1 = (1 / (A * qq)) * w0;
    } else if (m === 5) {
        n2 = 1; n1 = (sqA / qq) * w0; n0 = A * w0 * w0;
        d2 = A; d1 = (sqA / qq) * w0; d0 = w0 * w0;
    } else if (m === 8) {
        n2 = A; n1 = (sqA / qq) * w0; n0 = w0 * w0;
        d2 = 1; d1 = (sqA / qq) * w0; d0 = A * w0 * w0;
    }
    var nr = n2 * (-w * w) + n0;
    var ni = n1 * w;
    var dr = d2 * (-w * w) + d0;
    var di = d1 * w;
    var h = eqpCdiv(nr, ni, dr, di);
    if (m === 5 || m === 8) h = eqpCmul(h.re, h.im, A, 0);
    return h;
}

function eqpCollectPhaseBands(bands, sr, shiftSt, adaptiveQ) {
    var srN = Number(sr);
    if (!isFinite(srN) || srN < 1000) srN = 48000;
    var out = [];
    var list = bands || [];
    var n = list.length < EQP_NUM_BANDS ? list.length : EQP_NUM_BANDS;
    var i;
    for (i = 0; i < n; i++) {
        var b = list[i];
        if (!b || !b.enabled || (b.mode | 0) === 0) continue;
        var freq = eqpEffectiveFreq(b.freq, shiftSt);
        var q = eqpEffectiveQ(b.q, b.gain, adaptiveQ, b.mode);
        var c = eqpBiquadCoeffs(b.mode, freq, b.gain, q, srN);
        if (!c || !c.sections) continue;
        out.push({
            mode: b.mode | 0,
            freq: freq,
            gain: Number(b.gain) || 0,
            q: q,
            c: c,
            sections: c.sections | 0
        });
    }
    return out;
}

function eqpTiltH(tiltDb, f, sr) {
    var c = eqpTiltCoeffs(tiltDb, sr);
    if (!c.on) return { re: 1, im: 0 };
    var srN = Number(sr);
    var w = 2 * Math.PI * Math.max(0, f) / srN;
    var r = c.gain, im = 0, i, h, m;
    for (i = 0; i < c.sections.length; i++) {
        h = eqpBiquadH(c.sections[i], w);
        m = eqpCmul(r, im, h.re, h.im);
        r = m.re;
        im = m.im;
    }
    return { re: r, im: im };
}

/**
 * Complex digital (biquad) and analog responses at f Hz, both including the tilt.
 * @returns {{digital: {re: number, im: number}, analog: {re: number, im: number}}}
 */
function eqpPhaseH(bands, f, sr, shiftSt, adaptiveQ, tiltDb) {
    var srN = Number(sr);
    if (!isFinite(srN) || srN < 1000) srN = 48000;
    var ff = Number(f);
    if (!isFinite(ff) || ff < 0) ff = 0;
    var w = 2 * Math.PI * ff / srN;
    var parts = eqpCollectPhaseBands(bands, srN, shiftSt, adaptiveQ);
    var dr = 1, di = 0, ar = 1, ai = 0, i, p, h, ah, m;
    for (i = 0; i < parts.length; i++) {
        p = parts[i];
        h = eqpBiquadH(p.c, w);
        h = eqpCpow(h.re, h.im, p.sections);
        m = eqpCmul(dr, di, h.re, h.im);
        dr = m.re;
        di = m.im;
        ah = eqpAnalogSection(p.mode, p.freq, p.gain, p.q, ff);
        ah = eqpCpow(ah.re, ah.im, p.sections);
        m = eqpCmul(ar, ai, ah.re, ah.im);
        ar = m.re;
        ai = m.im;
    }
    h = eqpTiltH(tiltDb, ff, srN);
    m = eqpCmul(dr, di, h.re, h.im);
    dr = m.re;
    di = m.im;
    m = eqpCmul(ar, ai, h.re, h.im);
    ar = m.re;
    ai = m.im;
    return { digital: { re: dr, im: di }, analog: { re: ar, im: ai } };
}

function eqpMagDb(re, im) {
    var m = Math.sqrt(re * re + im * im);
    if (!(m > 1e-12)) m = 1e-12;
    return 20 * Math.log10(m);
}

/**
 * dB of a real FIR at f Hz.
 * @param {Array<number>|Float64Array} ir
 * @param {number} f
 * @param {number} sr
 * @returns {number}
 */
function eqpIrDb(ir, f, sr) {
    var srN = Number(sr);
    if (!isFinite(srN) || srN < 1000) srN = 48000;
    var w = 2 * Math.PI * Math.max(0, Number(f) || 0) / srN;
    var re = 0, im = 0, n;
    for (n = 0; n < ir.length; n++) {
        var s = ir[n] || 0;
        re += s * Math.cos(w * n);
        im += -s * Math.sin(w * n);
    }
    return eqpMagDb(re, im);
}

function eqpFadeEdges(ir, fade) {
    var n = ir.length;
    var i, w;
    var f = fade | 0;
    if (f < 2 || f * 2 >= n) return;
    for (i = 0; i < f; i++) {
        w = 0.5 * (1 - Math.cos(Math.PI * i / f));
        ir[i] *= w;
        ir[n - 1 - i] *= w;
    }
}

/**
 * Time-domain kernels for Natural and Linear. `linear` is 2048 samples with
 * the zero-phase center at EQP_PHASE_PEAK. `fir` is the 128-tap minimum-phase
 * correction the natural mode runs after the biquads (an impulse when the
 * biquads already match the analog magnitude).
 * @param {Array} bands
 * @param {number} sr
 * @param {number} shiftSt
 * @param {number|boolean} adaptiveQ
 * @param {number} tiltDb
 * @returns {{linear: Array<number>, fir: Array<number>}}
 */
function eqpDesignPhase(bands, sr, shiftSt, adaptiveQ, tiltDb) {
    var srN = Number(sr);
    if (!isFinite(srN) || srN < 1000) srN = 48000;
    var N = EQP_PHASE_FFT;
    var parts = eqpCollectPhaseBands(bands, srN, shiftSt, adaptiveQ);
    var tilt = eqpTiltCoeffs(tiltDb, srN);
    var magD = new Float64Array(N);
    var magC = new Float64Array(N);
    var k, f, w, dr, di, ar, ai, i, p, h, ah, m, md, ma;
    for (k = 0; k <= N / 2; k++) {
        f = k * srN / N;
        w = 2 * Math.PI * f / srN;
        dr = 1; di = 0; ar = 1; ai = 0;
        for (i = 0; i < parts.length; i++) {
            p = parts[i];
            h = eqpBiquadH(p.c, w);
            h = eqpCpow(h.re, h.im, p.sections);
            m = eqpCmul(dr, di, h.re, h.im);
            dr = m.re; di = m.im;
            ah = eqpAnalogSection(p.mode, p.freq, p.gain, p.q, f);
            ah = eqpCpow(ah.re, ah.im, p.sections);
            m = eqpCmul(ar, ai, ah.re, ah.im);
            ar = m.re; ai = m.im;
        }
        if (tilt.on) {
            h = eqpTiltH(tiltDb, f, srN);
            m = eqpCmul(dr, di, h.re, h.im);
            dr = m.re; di = m.im;
            m = eqpCmul(ar, ai, h.re, h.im);
            ar = m.re; ai = m.im;
        }
        md = Math.sqrt(dr * dr + di * di);
        ma = Math.sqrt(ar * ar + ai * ai);
        if (!(md > 1e-8)) md = 1e-8;
        if (!(ma > 1e-8)) ma = 1e-8;
        magD[k] = md;
        // The analog/digital ratio only matters where the filter still
        // passes signal. Deep in a cut both are quiet and the ratio becomes
        // a huge Nyquist boost the short FIR cannot hold, so blend it back
        // to 1 as the digital magnitude falls through -12..-36 dB, and cap
        // the remaining correction at ±12 dB.
        var ratio = ma / md;
        if (!(ratio > 0) || !isFinite(ratio)) ratio = 1;
        if (ratio > 4) ratio = 4;
        if (ratio < 0.25) ratio = 0.25;
        var digDb = 20 * Math.log10(md);
        var blend = (digDb + 36) / 24;
        if (blend < 0) blend = 0;
        if (blend > 1) blend = 1;
        magC[k] = 1 + blend * (ratio - 1);
        if (k > 0 && k < N / 2) {
            magD[N - k] = magD[k];
            magC[N - k] = magC[k];
        }
    }
    var re = new Float64Array(N);
    var im = new Float64Array(N);
    for (k = 0; k < N; k++) re[k] = magD[k];
    eqpFft(re, im, true);
    var linear = [];
    var peak = EQP_PHASE_PEAK;
    for (i = 0; i < EQP_PHASE_IR; i++) {
        var src = (i - peak + N) % N;
        linear.push(re[src]);
    }
    eqpFadeEdges(linear, 48);

    for (k = 0; k < N; k++) {
        re[k] = Math.log(magC[k] > 1e-8 ? magC[k] : 1e-8);
        im[k] = 0;
    }
    eqpFft(re, im, true);
    var half = N >> 1;
    for (k = 1; k < half; k++) re[k] *= 2;
    for (k = half + 1; k < N; k++) re[k] = 0;
    for (k = 0; k < N; k++) im[k] = 0;
    eqpFft(re, im, false);
    for (k = 0; k < N; k++) {
        var mm = Math.exp(re[k]);
        var ph = im[k];
        re[k] = mm * Math.cos(ph);
        im[k] = mm * Math.sin(ph);
    }
    eqpFft(re, im, true);
    var fir = [];
    for (i = 0; i < EQP_PHASE_FIR; i++) fir.push(re[i]);
    var fadeN = 24;
    for (i = 0; i < fadeN; i++) {
        var ww = 0.5 * (1 - Math.cos(Math.PI * (fadeN - i) / fadeN));
        fir[EQP_PHASE_FIR - 1 - i] *= ww;
    }
    return { linear: linear, fir: fir };
}

/**
 * Sample index of an impulse placed at EQP_PHASE_PEAK after the linear-phase
 * overlap-add. This is the latency the gen reports for Linear Phase.
 * @returns {number}
 */
function eqpMeasureLinearLatency() {
    var N = EQP_PHASE_FFT;
    var HOP = EQP_PHASE_HOP;
    var RING = 8192;
    var re = new Float64Array(N);
    var im = new Float64Array(N);
    re[EQP_PHASE_PEAK] = 1;
    eqpFft(re, im, false);
    var Hre = new Float64Array(re);
    var Him = new Float64Array(im);
    var inL = new Float64Array(RING);
    var acc = new Float64Array(RING);
    var peakT = -1;
    var peakV = 0;
    var t, i, k, frm, a, b;
    for (t = 0; t < 5000; t++) {
        inL[t % RING] = t === 0 ? 1 : 0;
        if (t >= HOP - 1 && (t % HOP) === HOP - 1) {
            frm = t - (HOP - 1);
            var xr = new Float64Array(N);
            var xi = new Float64Array(N);
            for (i = 0; i < HOP; i++) xr[i] = inL[(frm + i) % RING];
            eqpFft(xr, xi, false);
            for (k = 0; k < N; k++) {
                a = xr[k];
                b = xi[k];
                xr[k] = a * Hre[k] - b * Him[k];
                xi[k] = a * Him[k] + b * Hre[k];
            }
            eqpFft(xr, xi, true);
            for (i = 0; i < N; i++) acc[(frm + i) % RING] += xr[i];
        }
        if (t >= HOP - 1) {
            var ri = (t - (HOP - 1)) % RING;
            var y = acc[ri];
            acc[ri] = 0;
            if (y > peakV) {
                peakV = y;
                peakT = t;
            }
        }
    }
    return peakT;
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
        EQP_SHELF_PX: EQP_SHELF_PX,
        EQP_SHELF_BAND: EQP_SHELF_BAND,
        EQP_RESOLUTIONS: EQP_RESOLUTIONS,
        EQP_FFT_SIZES: EQP_FFT_SIZES,
        EQP_SPEEDS: EQP_SPEEDS,
        EQP_TILTS: EQP_TILTS,
        EQP_TILT_LABELS: EQP_TILT_LABELS,
        EQP_TILT_DEFAULT: EQP_TILT_DEFAULT,
        EQP_MODES: EQP_MODES,
        EQP_DEFAULT_BAND_FREQS: EQP_DEFAULT_BAND_FREQS,
        EQP_MAIN_W: EQP_MAIN_W,
        EQP_FILTERS_SHELF_W: EQP_FILTERS_SHELF_W,
        EQP_ANALYZER_SHELF_W: EQP_ANALYZER_SHELF_W,
        EQP_SC_TAB_W: EQP_SC_TAB_W,
        EQP_SIDECHAIN_FOLD_W: EQP_SIDECHAIN_FOLD_W,
        EQP_SOLO_OFF: EQP_SOLO_OFF,
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
        eqpTiltCoeffs: eqpTiltCoeffs,
        eqpTiltResponseDb: eqpTiltResponseDb,
        eqpFreqToNorm: eqpFreqToNorm,
        eqpNormToFreq: eqpNormToFreq,
        eqpDbToNorm: eqpDbToNorm,
        eqpNormToDb: eqpNormToDb,
        eqpQToNorm: eqpQToNorm,
        eqpNormToQ: eqpNormToQ,
        eqpRainbowColor: eqpRainbowColor,
        eqpClassifyGestureZone: eqpClassifyGestureZone,
        eqpComputeDeviceWidth: eqpComputeDeviceWidth,
        eqpSoloBandCoeffs: eqpSoloBandCoeffs,
        EQP_PHASE_MODES: EQP_PHASE_MODES,
        EQP_PHASE_SHORT: EQP_PHASE_SHORT,
        EQP_PHASE_FFT: EQP_PHASE_FFT,
        EQP_PHASE_HOP: EQP_PHASE_HOP,
        EQP_PHASE_IR: EQP_PHASE_IR,
        EQP_PHASE_PEAK: EQP_PHASE_PEAK,
        EQP_LINEAR_LATENCY: EQP_LINEAR_LATENCY,
        EQP_PHASE_FIR: EQP_PHASE_FIR,
        EQP_NATURAL_AT_44K: EQP_NATURAL_AT_44K,
        eqpNaturalLatency: eqpNaturalLatency,
        eqpDesignPhase: eqpDesignPhase,
        eqpIrDb: eqpIrDb,
        eqpPhaseH: eqpPhaseH,
        eqpMagDb: eqpMagDb,
        eqpMeasureLinearLatency: eqpMeasureLinearLatency
    };
}
