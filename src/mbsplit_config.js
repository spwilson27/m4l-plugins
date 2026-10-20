// Shared math, Linkwitz-Riley crossover response, LOM nested-rack scoping,
// and cross-instance linking helpers for Multiband Split.

var MBSPLIT_MIN_FREQ = 20.0;
var MBSPLIT_MAX_FREQ = 20000.0;
var MBSPLIT_MIN_GAP_OCT = 0.25; // Minimum ~1/4 octave separation between crossovers

var MBSPLIT_DEFAULT_F1 = 120.0;
var MBSPLIT_DEFAULT_F2 = 800.0;
var MBSPLIT_DEFAULT_F3 = 4500.0;

var MBSPLIT_BAND_NAMES_1 = ["FULL"];
var MBSPLIT_BAND_NAMES_2 = ["LOW", "HIGH"];
var MBSPLIT_BAND_NAMES_3 = ["LOW", "MID", "HIGH"];
var MBSPLIT_BAND_NAMES_4 = ["LOW", "LO-MID", "HI-MID", "HIGH"];

var MBSPLIT_BAND_COLORS = [
    [0.22, 0.74, 0.97], // Band 1 (Low): Cyan
    [0.20, 0.83, 0.60], // Band 2 (Lo-Mid / Mid): Emerald
    [0.98, 0.75, 0.15], // Band 3 (Hi-Mid / High): Amber
    [0.98, 0.44, 0.52]  // Band 4 (High): Coral/Rose
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

function freqToNorm(freq) {
    var f = clamp(Number(freq) || MBSPLIT_DEFAULT_F1, MBSPLIT_MIN_FREQ, MBSPLIT_MAX_FREQ);
    return Math.log(f / MBSPLIT_MIN_FREQ) / Math.log(MBSPLIT_MAX_FREQ / MBSPLIT_MIN_FREQ);
}

function normToFreq(norm) {
    var n = clamp(Number(norm) || 0.0, 0.0, 1.0);
    return MBSPLIT_MIN_FREQ * Math.pow(MBSPLIT_MAX_FREQ / MBSPLIT_MIN_FREQ, n);
}

function formatFreq(hz) {
    var f = clamp(Number(hz) || 0, MBSPLIT_MIN_FREQ, MBSPLIT_MAX_FREQ);
    if (f >= 1000.0) {
        var k = f / 1000.0;
        return (k >= 10.0 ? k.toFixed(1) : k.toFixed(2).replace(/0$/, "")) + "k";
    }
    return Math.round(f) + " Hz";
}

/**
 * Enforces monotonic ordering F1 < F2 < F3 with minimum octave separation.
 * activeIdx (0, 1, or 2) indicates which crossover is actively being moved so
 * neighbor crossovers are pushed or clamped cleanly.
 */
function sanitizeCrossovers(f1, f2, f3, activeIdx) {
    var ratio = Math.pow(2.0, MBSPLIT_MIN_GAP_OCT);
    var c1 = clamp(Number(f1) || MBSPLIT_DEFAULT_F1, MBSPLIT_MIN_FREQ, MBSPLIT_MAX_FREQ / (ratio * ratio));
    var c2 = clamp(Number(f2) || MBSPLIT_DEFAULT_F2, MBSPLIT_MIN_FREQ * ratio, MBSPLIT_MAX_FREQ / ratio);
    var c3 = clamp(Number(f3) || MBSPLIT_DEFAULT_F3, MBSPLIT_MIN_FREQ * ratio * ratio, MBSPLIT_MAX_FREQ);

    if (activeIdx === 0) {
        if (c2 < c1 * ratio) c2 = clamp(c1 * ratio, MBSPLIT_MIN_FREQ * ratio, MBSPLIT_MAX_FREQ / ratio);
        if (c3 < c2 * ratio) c3 = clamp(c2 * ratio, MBSPLIT_MIN_FREQ * ratio * ratio, MBSPLIT_MAX_FREQ);
        if (c1 > c2 / ratio) c1 = c2 / ratio;
    } else if (activeIdx === 1) {
        if (c1 > c2 / ratio) c1 = clamp(c2 / ratio, MBSPLIT_MIN_FREQ, MBSPLIT_MAX_FREQ / (ratio * ratio));
        if (c3 < c2 * ratio) c3 = clamp(c2 * ratio, MBSPLIT_MIN_FREQ * ratio * ratio, MBSPLIT_MAX_FREQ);
        c2 = clamp(c2, c1 * ratio, c3 / ratio);
    } else if (activeIdx === 2) {
        if (c2 > c3 / ratio) c2 = clamp(c3 / ratio, MBSPLIT_MIN_FREQ * ratio, MBSPLIT_MAX_FREQ / ratio);
        if (c1 > c2 / ratio) c1 = clamp(c2 / ratio, MBSPLIT_MIN_FREQ, MBSPLIT_MAX_FREQ / (ratio * ratio));
        if (c3 < c2 * ratio) c3 = c2 * ratio;
    } else {
        if (c2 < c1 * ratio) c2 = clamp(c1 * ratio, MBSPLIT_MIN_FREQ * ratio, MBSPLIT_MAX_FREQ / ratio);
        if (c3 < c2 * ratio) c3 = clamp(c2 * ratio, MBSPLIT_MIN_FREQ * ratio * ratio, MBSPLIT_MAX_FREQ);
        if (c2 > c3 / ratio) c2 = c3 / ratio;
        if (c1 > c2 / ratio) c1 = c2 / ratio;
    }

    return [c1, c2, c3];
}

/**
 * Parses an Ableton Live Object Model (LOM) device path to extract:
 *  - parentRackPath: canonical LOM path of the IMMEDIATE enclosing RackDevice
 *    (supports nested racks / chains within chains cleanly!)
 *  - chainIndex: 0-based index of the immediate enclosing chain within that Rack
 *  - nestingDepth: number of enclosing rack chain levels (1 = top rack, 2 = nested rack, etc.)
 *  - isInRack: true if inside an Audio Effect / Instrument / Drum Rack chain
 */
function parseRackContextFromPath(lomPath) {
    var clean = String(lomPath || "").replace(/^["']+|["']+$/g, "").trim();
    if (!clean) {
        return {
            parentRackPath: "standalone_default",
            chainIndex: 0,
            deviceIndex: 0,
            nestingDepth: 0,
            isInRack: false,
            shortLabel: "LOCAL"
        };
    }

    // Match all "chains <N>" segments in the path to support arbitrary nesting:
    // e.g. "live_set tracks 0 devices 0 chains 1 devices 1 chains 0 devices 0"
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
            parentRackPath: parentRackPath,
            chainIndex: chainIndex,
            deviceIndex: deviceIndex,
            nestingDepth: depth,
            isInRack: true,
            shortLabel: shortLabel
        };
    }

    // Fallback if placed directly on a track or return track outside a Rack:
    var trackMatch = clean.match(/^(live_set\s+(?:tracks|return_tracks)\s+\d+|live_set\s+master_track)/);
    var trackPath = trackMatch ? trackMatch[1] : clean;
    var devMatch = clean.match(/\bdevices\s+(\d+)\s*$/);
    var trackDevIdx = devMatch ? (parseInt(devMatch[1], 10) || 0) : 0;
    return {
        parentRackPath: trackPath,
        chainIndex: 0,
        deviceIndex: trackDevIdx,
        nestingDepth: 0,
        isInRack: false,
        shortLabel: "TRACK CH1"
    };
}

/**
 * Resolves the effective group key for cross-instance linking.
 * linkGroup:
 *   0 = Auto (links with instances sharing the same immediate parent Rack)
 *   1..4 = Manual Group A..D
 *   5 = Off (unlinked)
 */
function resolveLinkGroupKey(linkGroup, parentRackPath) {
    var lg = Math.round(Number(linkGroup) || 0);
    if (lg === 5) return null; // Unlinked
    if (lg >= 1 && lg <= 4) {
        var letters = ["A", "B", "C", "D"];
        return "manual_group_" + letters[lg - 1];
    }
    return "rack_group::" + (parentRackPath || "standalone_default");
}

function formatGainDb(db) {
    var g = Number(db);
    if (isNaN(g)) g = 0.0;
    if (g <= -69.5) return "-inf dB";
    var sign = g > 0.04 ? "+" : "";
    return sign + g.toFixed(1) + " dB";
}

/**
 * Resolves the active 4-bit band mask (bits 0..3 -> Band 1..4) for a chain instance.
 * bandMode:
 *   0 = Auto Chain (solos Band (chainIndex % numBands) + 1)
 *   1 = Band 1 Solo
 *   2 = Band 2 Solo
 *   3 = Band 3 Solo
 *   4 = Band 4 Solo
 *   5 = Custom Multi-Band Mask (uses customMask 0..15)
 */
function resolveEffectiveBandMask(bandMode, chainIndex, numBands, customMask) {
    var nb = clamp(Math.round(Number(numBands) || 1), 1, 4);
    var maxMask = (1 << nb) - 1;
    var mode = clamp(Math.round(Number(bandMode) || 0), 0, 5);
    if (mode === 0) {
        var idx = clamp(Math.round(Number(chainIndex) || 0), 0, nb - 1);
        return (1 << idx) & maxMask;
    }
    if (mode >= 1 && mode <= 4) {
        var bIdx = clamp(mode - 1, 0, nb - 1);
        return (1 << bIdx) & maxMask;
    }
    var cm = Math.round(Number(customMask));
    if (isNaN(cm) || cm < 0) cm = 1;
    return cm & maxMask;
}

/**
 * Computes the analytical magnitude squared |H(f)|^2 of a Linkwitz-Riley split
 * at frequency f for crossover fc and slopeMode:
 *   0 = 12 dB/oct (LR2, order N = 2, Butterworth order n = 1, power 2*n = 2)
 *   1 = 24 dB/oct (LR4, order N = 4, Butterworth order n = 2, power 2*n = 4)
 *   2 = 48 dB/oct (LR8, order N = 8, Butterworth order n = 4, power 2*n = 8)
 */
function computeCrossoverMagResponse(f, fc, slopeMode) {
    var ratio = Math.max(f, 1e-3) / Math.max(fc, 1e-3);
    var sm = clamp(Math.round(Number(slopeMode) || 1), 0, 2);
    var p = sm === 0 ? 2 : (sm === 1 ? 4 : 8);
    var rp = Math.pow(ratio, p);
    var denom = 1.0 + rp;
    var lpMag = 1.0 / denom;
    var hpMag = rp / denom;
    return { lp: lpMag, hp: hpMag };
}

/**
 * Computes per-band magnitude gains (linear 0..1) at frequency f (Hz)
 * for 1, 2, 3, or 4 bands and the composite active magnitude for bandMask.
 * Because our DSP crossover tree is allpass-compensated, adjacent bands summed
 * together reconstruct unity (1.0) across their shared crossover!
 */
function computeBandMagnitudesAtFreq(f, f1, f2, f3, numBands, slopeMode, bandMask) {
    var nb = clamp(Math.round(Number(numBands) || 1), 1, 4);
    var b1 = 0.0, b2 = 0.0, b3 = 0.0, b4 = 0.0;

    if (nb === 1) {
        b1 = 1.0;
    } else if (nb === 2) {
        var s1_2 = computeCrossoverMagResponse(f, f1, slopeMode);
        b1 = s1_2.lp;
        b2 = s1_2.hp;
    } else if (nb === 3) {
        var s1_3 = computeCrossoverMagResponse(f, f1, slopeMode);
        var s2_3 = computeCrossoverMagResponse(f, f2, slopeMode);
        b1 = s1_3.lp;
        b2 = s1_3.hp * s2_3.lp;
        b3 = s1_3.hp * s2_3.hp;
    } else {
        var s1_4 = computeCrossoverMagResponse(f, f1, slopeMode);
        var s2_4 = computeCrossoverMagResponse(f, f2, slopeMode);
        var s3_4 = computeCrossoverMagResponse(f, f3, slopeMode);
        b1 = s1_4.lp;
        b2 = s1_4.hp * s2_4.lp;
        b3 = s1_4.hp * s2_4.hp * s3_4.lp;
        b4 = s1_4.hp * s2_4.hp * s3_4.hp;
    }

    var mask = bandMask !== undefined ? bandMask : ((1 << nb) - 1);
    var activeMag =
        ((mask & 1) ? b1 : 0.0) +
        ((mask & 2) ? b2 : 0.0) +
        ((mask & 4) ? b3 : 0.0) +
        ((mask & 8) ? b4 : 0.0);

    return {
        bands: [b1, b2, b3, b4],
        activeSum: activeMag,
        totalSum: b1 + b2 + b3 + b4
    };
}

/**
 * Reference discrete-time TPT Linkwitz-Riley splitter (exact match to mbsplit_core.genexpr)
 * used for verifying sample-accurate allpass-compensated flat unity reconstruction.
 */
function createReferenceSplitterDsp(sampleRate) {
    var sr = sampleRate || 48000.0;

    function make1stState() { return { z: 0.0 }; }
    function step1st(st, x, g1) {
        var v = (x - st.z) * g1;
        var lp = v + st.z;
        st.z = lp + v;
        var hp = x - lp;
        var ap = lp - hp;
        return { lp: lp, hp: hp, ap: ap };
    }

    function makeSvfState() { return { ic1: 0.0, ic2: 0.0 }; }
    function stepSvf(st, x, g, k) {
        var a1 = 1.0 / (1.0 + g * (g + k));
        var a2 = g * a1;
        var a3 = g * a2;
        var v3 = x - st.ic2;
        var v1 = a1 * st.ic1 + a2 * v3;
        var v2 = st.ic2 + a2 * st.ic1 + a3 * v3;
        st.ic1 = 2.0 * v1 - st.ic1;
        st.ic2 = 2.0 * v2 - st.ic2;
        var lp = v2;
        var bp = v1;
        var hp = x - k * bp - lp;
        var ap = x - 2.0 * k * bp;
        return { lp: lp, bp: bp, hp: hp, ap: ap };
    }

    function makeSplitStage() {
        return {
            // LR2 (12 dB)
            l1a: make1stState(), l1b: make1stState(),
            h1a: make1stState(), h1b: make1stState(),
            // LR4 (24 dB)
            s4la: makeSvfState(), s4lb: makeSvfState(),
            s4ha: makeSvfState(), s4hb: makeSvfState(),
            // LR8 (48 dB)
            s8l1: makeSvfState(), s8l2: makeSvfState(), s8l3: makeSvfState(), s8l4: makeSvfState(),
            s8h1: makeSvfState(), s8h2: makeSvfState(), s8h3: makeSvfState(), s8h4: makeSvfState()
        };
    }

    function makeAllpassStage() {
        return {
            ap1: make1stState(),
            ap4: makeSvfState(),
            ap8a: makeSvfState(),
            ap8b: makeSvfState()
        };
    }

    var split1 = makeSplitStage();
    var split2 = makeSplitStage();
    var split3 = makeSplitStage();
    var ap2_on_b1 = makeAllpassStage();
    var ap3_on_b1 = makeAllpassStage();
    var ap3_on_b2 = makeAllpassStage();

    var K_BUTTER2 = Math.SQRT2;
    var K_BUTTER4_A = 1.8477590650225735; // 2 * cos(pi/8)
    var K_BUTTER4_B = 0.7653668647301796; // 2 * cos(3*pi/8)

    function runSplit(st, x, fc, slopeMode) {
        var f = clamp(fc, 20.0, sr * 0.48);
        var g = Math.tan(Math.PI * f / sr);
        var g1 = g / (1.0 + g);

        // LR2
        var r1la = step1st(st.l1a, x, g1);
        var r1lb = step1st(st.l1b, r1la.lp, g1);
        var r1ha = step1st(st.h1a, x, g1);
        var r1hb = step1st(st.h1b, r1ha.hp, g1);
        var lp12 = r1lb.lp;
        var hp12 = -r1hb.hp;

        // LR4
        var r4la = stepSvf(st.s4la, x, g, K_BUTTER2);
        var r4lb = stepSvf(st.s4lb, r4la.lp, g, K_BUTTER2);
        var r4ha = stepSvf(st.s4ha, x, g, K_BUTTER2);
        var r4hb = stepSvf(st.s4hb, r4ha.hp, g, K_BUTTER2);
        var lp24 = r4lb.lp;
        var hp24 = r4hb.hp;

        // LR8
        var r8l1 = stepSvf(st.s8l1, x, g, K_BUTTER4_A);
        var r8l2 = stepSvf(st.s8l2, r8l1.lp, g, K_BUTTER4_B);
        var r8l3 = stepSvf(st.s8l3, r8l2.lp, g, K_BUTTER4_A);
        var r8l4 = stepSvf(st.s8l4, r8l3.lp, g, K_BUTTER4_B);
        var r8h1 = stepSvf(st.s8h1, x, g, K_BUTTER4_A);
        var r8h2 = stepSvf(st.s8h2, r8h1.hp, g, K_BUTTER4_B);
        var r8h3 = stepSvf(st.s8h3, r8h2.hp, g, K_BUTTER4_A);
        var r8h4 = stepSvf(st.s8h4, r8h3.hp, g, K_BUTTER4_B);
        var lp48 = r8l4.lp;
        var hp48 = r8h4.hp;

        if (slopeMode === 0) return { lp: lp12, hp: hp12 };
        if (slopeMode === 2) return { lp: lp48, hp: hp48 };
        return { lp: lp24, hp: hp24 };
    }

    function runAllpass(st, x, fc, slopeMode) {
        var f = clamp(fc, 20.0, sr * 0.48);
        var g = Math.tan(Math.PI * f / sr);
        var g1 = g / (1.0 + g);

        var a12 = step1st(st.ap1, x, g1).ap;
        var a24 = stepSvf(st.ap4, x, g, K_BUTTER2).ap;
        var a48_1 = stepSvf(st.ap8a, x, g, K_BUTTER4_A).ap;
        var a48 = stepSvf(st.ap8b, a48_1, g, K_BUTTER4_B).ap;

        if (slopeMode === 0) return a12;
        if (slopeMode === 2) return a48;
        return a24;
    }

    function processSample(x, f1, f2, f3, numBands, slopeMode) {
        var nb = clamp(Math.round(numBands || 1), 1, 4);
        var sm = clamp(Math.round(slopeMode === undefined ? 1 : slopeMode), 0, 2);

        var s1 = runSplit(split1, x, f1, sm);
        var s2 = runSplit(split2, s1.hp, f2, sm);
        var b1_after2 = runAllpass(ap2_on_b1, s1.lp, f2, sm);

        var s3 = runSplit(split3, s2.hp, f3, sm);
        var b1_after3 = runAllpass(ap3_on_b1, b1_after2, f3, sm);
        var b2_after3 = runAllpass(ap3_on_b2, s2.lp, f3, sm);

        if (nb === 1) {
            return [x, 0.0, 0.0, 0.0];
        }
        if (nb === 2) {
            return [s1.lp, s1.hp, 0.0, 0.0];
        }
        if (nb === 3) {
            return [b1_after2, s2.lp, s2.hp, 0.0];
        }
        return [b1_after3, b2_after3, s3.lp, s3.hp];
    }

    return { processSample: processSample };
}

// =========================================================================
// BLOCK-SIZE 8192 RADIX-2 HANN-WINDOWED FFT SPECTROGRAM ENGINE
// Resolves fine narrowband harmonics (~5.86 Hz bin spacing at 48 kHz) so
// sawtooth and complex harmonic waveforms show distinct individual overtones.
// =========================================================================
var MBSPLIT_FFT_SIZE = 8192;
var MBSPLIT_FFT_BINS = 4096;
var _fftTablesReady = false;
var _fftBitRev = null;
var _fftHann = null;
var _fftRe = null;
var _fftIm = null;
var _fftDbOut = null;

function _ensureFft8192Tables() {
    if (_fftTablesReady) return;
    var N = MBSPLIT_FFT_SIZE;
    _fftBitRev = new Array(N);
    _fftHann = new Array(N);
    _fftRe = new Array(N);
    _fftIm = new Array(N);
    _fftDbOut = new Array(MBSPLIT_FFT_BINS);

    var bits = 13; // 2^13 = 8192
    for (var i = 0; i < N; i++) {
        var rev = 0;
        var v = i;
        for (var b = 0; b < bits; b++) {
            rev = (rev << 1) | (v & 1);
            v >>= 1;
        }
        _fftBitRev[i] = rev;
        // Coherent-gain normalized Hann window (sum of window = N/2 -> scale by 4/N for peak-preserving amplitude)
        var w = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (N - 1)));
        _fftHann[i] = w * (4.0 / N);
        _fftRe[i] = 0.0;
        _fftIm[i] = 0.0;
    }
    for (var k = 0; k < MBSPLIT_FFT_BINS; k++) {
        _fftDbOut[k] = -72.0;
    }
    _fftTablesReady = true;
}

/**
 * Computes the 4096-bin dB magnitude spectrum from an 8192-sample frame using an
 * in-place Radix-2 Cooley-Tukey FFT with Hann windowing.
 */
function computeFft8192DbBins(samples8192) {
    _ensureFft8192Tables();
    var N = MBSPLIT_FFT_SIZE;
    var re = _fftRe;
    var im = _fftIm;
    var rev = _fftBitRev;
    var win = _fftHann;
    var len = samples8192 ? samples8192.length : 0;

    for (var i = 0; i < N; i++) {
        var s = i < len ? (Number(samples8192[i]) || 0.0) : 0.0;
        var ri = rev[i];
        re[ri] = s * win[i];
        im[ri] = 0.0;
    }

    for (var size = 2; size <= N; size <<= 1) {
        var half = size >> 1;
        var theta = (-2.0 * Math.PI) / size;
        var wStepRe = Math.cos(theta);
        var wStepIm = Math.sin(theta);

        for (var start = 0; start < N; start += size) {
            var wr = 1.0;
            var wi = 0.0;
            for (var j = 0; j < half; j++) {
                var evenIdx = start + j;
                var oddIdx = evenIdx + half;
                var tr = wr * re[oddIdx] - wi * im[oddIdx];
                var ti = wr * im[oddIdx] + wi * re[oddIdx];

                re[oddIdx] = re[evenIdx] - tr;
                im[oddIdx] = im[evenIdx] - ti;
                re[evenIdx] = re[evenIdx] + tr;
                im[evenIdx] = im[evenIdx] + ti;

                var nextWr = wr * wStepRe - wi * wStepIm;
                wi = wr * wStepIm + wi * wStepRe;
                wr = nextWr;
            }
        }
    }

    var out = _fftDbOut;
    var halfN = MBSPLIT_FFT_BINS;
    for (var k = 0; k < halfN; k++) {
        var r = re[k];
        var m = im[k];
        var mag = Math.sqrt(r * r + m * m);
        // Slight +3 dB/oct pink tilt around 400 Hz so upper sawtooth harmonics remain bright and easy to read
        var freqApprox = (k * 48000.0) / N;
        var tiltDb = freqApprox > 60.0 ? (2.2 * Math.log(freqApprox / 250.0) / Math.LN2) : 0.0;
        var db = 20.0 * Math.log10(Math.max(mag, 1e-6)) + tiltDb;
        out[k] = clamp(db, -72.0, 6.0);
    }
    return out;
}

/**
 * Samples the 8192-point FFT dB spectrum across a screen pixel's frequency span [fLo, fHi].
 * - When a pixel spans less than 1.2 FFT bins (low/mid frequencies), uses peak-preserving
 *   raised-cosine / Catmull-Rom interpolation across fractional bins so individual sawtooth
 *   harmonics (e.g. 90 Hz, 180 Hz, 270 Hz, 360 Hz...) appear as sharp, distinct harmonic peaks.
 * - When a pixel spans multiple FFT bins (high frequencies), uses max-peak pooling across
 *   all bins inside [fLo, fHi] so narrow harmonic spikes are never averaged away between pixels.
 */
function sampleFft8192DbForPixel(fLo, fHi, dbBins, sampleRate) {
    if (!dbBins || dbBins.length < MBSPLIT_FFT_BINS) return -72.0;
    var sr = Math.max(8000.0, Number(sampleRate) || 48000.0);
    var binScale = MBSPLIT_FFT_SIZE / sr;
    var bLo = clamp(fLo * binScale, 1.0, MBSPLIT_FFT_BINS - 3.0);
    var bHi = clamp(fHi * binScale, bLo, MBSPLIT_FFT_BINS - 2.0);
    var span = bHi - bLo;

    if (span <= 1.15) {
        var bMid = 0.5 * (bLo + bHi);
        var idx = Math.floor(bMid);
        var t = bMid - idx;
        var p0 = dbBins[Math.max(1, idx - 1)];
        var p1 = dbBins[idx];
        var p2 = dbBins[Math.min(MBSPLIT_FFT_BINS - 1, idx + 1)];
        var p3 = dbBins[Math.min(MBSPLIT_FFT_BINS - 1, idx + 2)];
        var t2 = t * t;
        var t3 = t2 * t;
        var interp = 0.5 * (
            (2.0 * p1) +
            (-p0 + p2) * t +
            (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
            (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
        );
        return clamp(interp, -72.0, 6.0);
    }

    var iStart = Math.max(1, Math.floor(bLo));
    var iEnd = Math.min(MBSPLIT_FFT_BINS - 1, Math.ceil(bHi));
    var maxDb = -72.0;
    for (var b = iStart; b <= iEnd; b++) {
        if (dbBins[b] > maxDb) maxDb = dbBins[b];
    }
    return clamp(maxDb, -72.0, 6.0);
}

/**
 * Generates an 8192-sample band-limited sawtooth wave with rich harmonic series
 * (f0, 2*f0, 3*f0, ..., up to Nyquist) for preview and unit testing of the 8192-block spectrogram.
 */
function synthesizeSawWave8192(fundamentalHz, sampleRate) {
    var N = MBSPLIT_FFT_SIZE;
    var sr = Number(sampleRate) || 48000.0;
    var f0 = clamp(Number(fundamentalHz) || 110.0, 30.0, 2000.0);
    var out = new Array(N);
    var maxH = Math.min(180, Math.floor((sr * 0.46) / f0));
    for (var i = 0; i < N; i++) {
        out[i] = 0.0;
    }
    for (var h = 1; h <= maxH; h++) {
        var amp = (0.55 / Math.pow(h, 0.82)) * ((h % 2 === 1) ? 1.0 : -1.0);
        var w = (2.0 * Math.PI * f0 * h) / sr;
        var ph0 = (h * 0.37) % (2.0 * Math.PI);
        for (var n = 0; n < N; n++) {
            out[n] += amp * Math.sin(w * n + ph0);
        }
    }
    return out;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        MBSPLIT_MIN_FREQ: MBSPLIT_MIN_FREQ,
        MBSPLIT_MAX_FREQ: MBSPLIT_MAX_FREQ,
        MBSPLIT_MIN_GAP_OCT: MBSPLIT_MIN_GAP_OCT,
        MBSPLIT_DEFAULT_F1: MBSPLIT_DEFAULT_F1,
        MBSPLIT_DEFAULT_F2: MBSPLIT_DEFAULT_F2,
        MBSPLIT_DEFAULT_F3: MBSPLIT_DEFAULT_F3,
        MBSPLIT_BAND_NAMES_1: MBSPLIT_BAND_NAMES_1,
        MBSPLIT_BAND_NAMES_2: MBSPLIT_BAND_NAMES_2,
        MBSPLIT_BAND_NAMES_3: MBSPLIT_BAND_NAMES_3,
        MBSPLIT_BAND_NAMES_4: MBSPLIT_BAND_NAMES_4,
        MBSPLIT_BAND_COLORS: MBSPLIT_BAND_COLORS,
        MBSPLIT_FFT_SIZE: MBSPLIT_FFT_SIZE,
        MBSPLIT_FFT_BINS: MBSPLIT_FFT_BINS,
        clamp: clamp,
        dbToLin: dbToLin,
        linToDb: linToDb,
        freqToNorm: freqToNorm,
        normToFreq: normToFreq,
        formatFreq: formatFreq,
        formatGainDb: formatGainDb,
        sanitizeCrossovers: sanitizeCrossovers,
        parseRackContextFromPath: parseRackContextFromPath,
        resolveLinkGroupKey: resolveLinkGroupKey,
        resolveEffectiveBandMask: resolveEffectiveBandMask,
        computeCrossoverMagResponse: computeCrossoverMagResponse,
        computeBandMagnitudesAtFreq: computeBandMagnitudesAtFreq,
        createReferenceSplitterDsp: createReferenceSplitterDsp,
        computeFft8192DbBins: computeFft8192DbBins,
        sampleFft8192DbForPixel: sampleFft8192DbForPixel,
        synthesizeSawWave8192: synthesizeSawWave8192
    };
}
