// Oscilloscope — configuration, buffer map, stabilized pitch-locked single-cycle & multi-cycle windowing,
// EQ-Eight style Mode selection + channel focus toggle, Auto-Normalize + Gain Scale slider, Refresh Rate slider,
// Overlay/Split toggle, and backward-compatible v3 blob serialization.
// Pure (no Max objects at load time). Prepended into the v8ui and required by Node tests.
//
// buffer~ ---analyzerscope (OSC_BUF_SAMPS = 17952):
//   0 frame (heartbeat, +1 every 480-sample packet)
//   1 sample rate (e.g. 48000)
//   2 scope write head (0..OSC_RING_N-1)
//   32..1567 packet ring (64 packets x 24 floats: L/R RMS, peak, true peak)
//   1568..5663 scope L ring (4096 samples)
//   5664..9759 scope R ring (4096 samples)

var OSC_VERSION = 5;
var OSC_W = 460;
var OSC_H = 169;

// Buffer layout (compatible with src/analyzer_core.genexpr)
var OSC_HDR_FRAME = 0;
var OSC_HDR_SR = 1;
var OSC_HDR_SCOPE = 2;
var OSC_PKT_STRIDE = 24;
var OSC_PKT_COUNT = 64;
var OSC_PKT_BASE = 32;
var OSC_RING_N = 4096;
var OSC_SCOPE_L = OSC_PKT_BASE + OSC_PKT_COUNT * OSC_PKT_STRIDE; // 1568
var OSC_SCOPE_R = OSC_SCOPE_L + OSC_RING_N;                       // 5664
var OSC_FFT_N = 8192;
var OSC_BUF_SAMPS = OSC_SCOPE_R + OSC_RING_N + OSC_FFT_N;         // 17952

// EQ-Eight Style Mode Selection Box (`routingMode` 0..1) + Tristate Channel Toggle Button (`editSub` 0..2):
//   - routingMode 0: "Stereo" — Tristate Ch button cycles: 0 = "L / R" (both), 1 = "L" (Left only), 2 = "R" (Right only)
//   - routingMode 1: "M / S"  — Tristate Ch button cycles: 0 = "M / S" (both), 1 = "M" (Mid only),  2 = "S" (Side only)
var OSC_MODE_NAMES = ["Stereo", "M / S"];

// Legacy 6-channel names kept for compatibility with existing callers
var OSC_CH_NAMES = ["L / R", "M / S", "Left", "Right", "Mid", "Side"];

// Display Layout Toggle (`splitMode` 0..1):
//   0: "Overlay" — Both active channels superimposed on a single full-height calibrated graticule
//   1: "Split"   — Dual stacked oscilloscope lanes (Top: Ch 1 L/Mid, Bottom: Ch 2 R/Side)
var OSC_VIEW_NAMES = ["Overlay", "Split"];

// Window Size Selection Box (`cycleMode` 0..6):
//   0: "1 Cyc"   — Pitch-tracked Single-Cycle display (1 fundamental period, phase-locked to zero-crossing)
//   1: "2 Cyc"   — Pitch-tracked 2-Cycle display (2 fundamental periods)
//   2: "4 Cyc"   — Pitch-tracked 4-Cycle display (4 fundamental periods)
//   3: "8 Cyc"   — Pitch-tracked 8-Cycle display (8 fundamental periods)
//   4: "5 ms"    — Fixed 5 ms multi-cycle time window
//   5: "20 ms"   — Fixed 20 ms multi-cycle time window
//   6: "50 ms"   — Fixed 50 ms multi-cycle time window
var OSC_CYCLE_NAMES = ["1 Cyc", "2 Cyc", "4 Cyc", "8 Cyc", "5 ms", "20 ms", "50 ms"];
var OSC_CYCLE_COUNTS = [1, 2, 4, 8, 0, 0, 0];
var OSC_FIXED_MS = [0, 0, 0, 0, 5, 20, 50];

// Continuous Refresh Rate Slider range (`rateHz` in 1..60 Hz, default 30 Hz)
var OSC_RATE_MIN = 1;
var OSC_RATE_MAX = 60;
var OSC_RATE_DEFAULT = 30;
// Legacy arrays kept for compatibility
var OSC_RATE_HZ = [15, 30, 45, 60];
var OSC_RATE_MS = [67, 33, 22, 16];
var OSC_RATE_NAMES = ["15 Hz", "30 Hz", "45 Hz", "60 Hz"];

// Continuous Gain Scale Slider range (`gainDb` in -18..+24 dB, default 0.0 dB)
var OSC_GAIN_MIN_DB = -18.0;
var OSC_GAIN_MAX_DB = 24.0;
var OSC_GAIN_DEFAULT_DB = 0.0;
var OSC_GAIN_DB = [-6, 0, 6, 12];
var OSC_GAIN_LIN = [0.5, 1.0, 2.0, 4.0];
var OSC_GAIN_NAMES = ["-6 dB", "0 dB", "+6 dB", "+12 dB"];

var OSC_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Clamps `v` into `[lo, hi]`, returning `lo` if `v` is NaN.
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function oscClamp(v, lo, hi) {
    var n = Number(v);
    if (n !== n) return lo;
    return n < lo ? lo : (n > hi ? hi : n);
}

/**
 * Point-in-rect test for `r = [x, y, w, h]`.
 * @param {number[]} r
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function oscInside(r, x, y) {
    return !!r && x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
}

/**
 * Converts `rateHz` (1..60 Hz) to a Task interval in milliseconds.
 * @param {number} rateHz
 * @returns {number}
 */
function oscRateToMs(rateHz) {
    var hz = oscClamp(Number(rateHz) || OSC_RATE_DEFAULT, OSC_RATE_MIN, OSC_RATE_MAX);
    return Math.max(12, Math.round(1000 / hz));
}

/**
 * Converts `gainDb` (-18..+24 dB) to a linear multiplier.
 * @param {number} gainDb
 * @returns {number}
 */
function oscDbToLin(gainDb) {
    var db = oscClamp(Number(gainDb) || 0, OSC_GAIN_MIN_DB, OSC_GAIN_MAX_DB);
    return Math.pow(10, db / 20);
}

/**
 * Maps `(routingMode, editSub)` to internal `chMode` (`0..5`) and tristate button label:
 *   - `routingMode === 0` ("Stereo"):
 *       `editSub === 0`: Dual L & R (`chMode = 0`, button `"L / R"`)
 *       `editSub === 1`: Left only  (`chMode = 2`, button `"L"`)
 *       `editSub === 2`: Right only (`chMode = 3`, button `"R"`)
 *   - `routingMode === 1` ("M / S"):
 *       `editSub === 0`: Dual M & S (`chMode = 1`, button `"M / S"`)
 *       `editSub === 1`: Mid only   (`chMode = 4`, button `"M"`)
 *       `editSub === 2`: Side only  (`chMode = 5`, button `"S"`)
 * @param {number} routingMode
 * @param {number} editSub
 * @returns {{ chMode: number, editLabel: string, editActive: boolean }}
 */
function oscResolveRouting(routingMode, editSub) {
    var m = oscClamp(Math.round(Number(routingMode) || 0), 0, 1);
    var s = ((Math.round(Number(editSub) || 0) % 3) + 3) % 3;
    if (m === 0) {
        if (s === 1) return { chMode: 2, editLabel: "L", editActive: true };
        if (s === 2) return { chMode: 3, editLabel: "R", editActive: true };
        return { chMode: 0, editLabel: "L / R", editActive: true };
    }
    if (s === 1) return { chMode: 4, editLabel: "M", editActive: true };
    if (s === 2) return { chMode: 5, editLabel: "S", editActive: true };
    return { chMode: 1, editLabel: "M / S", editActive: true };
}

/**
 * Converts `chMode` (`0..5`) back into `{ routingMode, editSub }`.
 * @param {number} chMode
 * @returns {{ routingMode: number, editSub: number }}
 */
function oscRoutingFromChMode(chMode) {
    var c = oscClamp(Math.round(Number(chMode) || 0), 0, 5);
    if (c === 0) return { routingMode: 0, editSub: 0 };
    if (c === 2) return { routingMode: 0, editSub: 1 };
    if (c === 3) return { routingMode: 0, editSub: 2 };
    if (c === 1) return { routingMode: 1, editSub: 0 };
    if (c === 4) return { routingMode: 1, editSub: 1 };
    return { routingMode: 1, editSub: 2 };
}

/**
 * Converts a frequency in Hz to a musical note label (e.g. `440` -> `"A4"`).
 * @param {number} freq
 * @returns {string}
 */
function oscFreqToNote(freq) {
    if (!(freq >= 20 && freq <= 20000)) return "\u2014";
    var midi = Math.round(69 + 12 * Math.log(freq / 440) / Math.LN2);
    if (midi < 12 || midi > 127) return "\u2014";
    var name = OSC_NOTE_NAMES[((midi % 12) + 12) % 12];
    var oct = Math.floor(midi / 12) - 1;
    return name + oct;
}

/**
 * Computes the two display channels `{ ch1, ch2, label1, label2, dual, show1, show2 }` from raw Left and Right
 * sample arrays according to `chMode`:
 *   0: L / R   (dual = true,  show1 = true,  show2 = true,  ch1 = L, ch2 = R)
 *   1: M / S   (dual = true,  show1 = true,  show2 = true,  ch1 = Mid, ch2 = Side)
 *   2: Left    (dual = false, show1 = true,  show2 = false, ch1 = L, ch2 = R)
 *   3: Right   (dual = false, show1 = false, show2 = true,  ch1 = L, ch2 = R) -> Slot 2 (Blue/Cyan, Bottom lane in Split!)
 *   4: Mid     (dual = false, show1 = true,  show2 = false, ch1 = Mid, ch2 = Side)
 *   5: Side    (dual = false, show1 = false, show2 = true,  ch1 = Mid, ch2 = Side) -> Slot 2 (Blue/Cyan, Bottom lane in Split!)
 * @param {number[]} l
 * @param {number[]} r
 * @param {number} chMode
 * @returns {{ ch1: number[], ch2: number[], label1: string, label2: string, dual: boolean, show1: boolean, show2: boolean }}
 */
function oscExtractChannels(l, r, chMode) {
    var a = l || [];
    var b = r || [];
    var n = Math.min(a.length, b.length);
    var mode = oscClamp(Math.round(Number(chMode) || 0), 0, 5);
    var ch1 = new Array(n);
    var ch2 = new Array(n);
    var i;
    if (mode === 0 || mode === 2 || mode === 3) {
        for (i = 0; i < n; i++) {
            ch1[i] = Number(a[i]) || 0;
            ch2[i] = Number(b[i]) || 0;
        }
        if (mode === 0) {
            return { ch1: ch1, ch2: ch2, label1: "L", label2: "R", dual: true, show1: true, show2: true };
        }
        if (mode === 2) {
            return { ch1: ch1, ch2: ch2, label1: "L", label2: "R", dual: false, show1: true, show2: false };
        }
        return { ch1: ch1, ch2: ch2, label1: "L", label2: "R", dual: false, show1: false, show2: true };
    }
    for (i = 0; i < n; i++) {
        var lv = Number(a[i]) || 0;
        var rv = Number(b[i]) || 0;
        ch1[i] = (lv + rv) * 0.5;
        ch2[i] = (lv - rv) * 0.5;
    }
    if (mode === 1) {
        return { ch1: ch1, ch2: ch2, label1: "Mid", label2: "Side", dual: true, show1: true, show2: true };
    }
    if (mode === 4) {
        return { ch1: ch1, ch2: ch2, label1: "Mid", label2: "Side", dual: false, show1: true, show2: false };
    }
    return { ch1: ch1, ch2: ch2, label1: "Mid", label2: "Side", dual: false, show1: false, show2: true };
}

/**
 * Creates a persistent pitch tracker state with temporal hysteresis, octave-jump protection,
 * and hold frames so pitch readouts and single-cycle locks stay rock-solid on real music.
 * @returns {{ period: number, freq: number, confidence: number, holdFrames: number, lockPhase: number, lockPeriod: number }}
 */
function oscCreatePitchState() {
    return {
        period: 0,
        freq: 0,
        confidence: 0,
        holdFrames: 0,
        lockPhase: -1,
        lockPeriod: 0
    };
}

/**
 * Estimates the fundamental period in samples (fractional) of a signal `sig` at sample rate `sr`
 * using DC-removed normalized autocorrelation (NSDF) with optional `trackerState` for temporal
 * continuity, octave-jump rejection, and hold-on-dropout.
 * Supports 24 Hz .. 4000 Hz.
 * @param {number[]} sig
 * @param {number} sr
 * @param {{ period: number, freq: number, confidence: number, holdFrames: number }} [trackerState]
 * @returns {{ period: number, freq: number, confidence: number, held: boolean }}
 */
function oscEstimatePeriod(sig, sr, trackerState) {
    var rate = sr > 1000 ? sr : 48000;
    var holdMax = 36; // Hold last valid pitch for ~1.2s at 30fps during brief dropouts/transients

    function fallbackOrHold() {
        if (trackerState && trackerState.period > 0 && trackerState.holdFrames < holdMax) {
            trackerState.holdFrames++;
            var decayConf = Math.max(0.18, trackerState.confidence * 0.94);
            trackerState.confidence = decayConf;
            return {
                period: trackerState.period,
                freq: trackerState.freq,
                confidence: decayConf,
                held: true
            };
        }
        if (trackerState) {
            trackerState.period = 0;
            trackerState.freq = 0;
            trackerState.confidence = 0;
        }
        return { period: 0, freq: 0, confidence: 0, held: false };
    }

    if (!sig || sig.length < 128) return fallbackOrHold();

    // Use up to 4096 samples so low bass notes (down to 20 Hz, period ~2400 samples) fit cleanly
    var winLen = Math.min(sig.length, 4096);
    var offset = sig.length - winLen;

    // Compute mean (DC) and RMS
    var mean = 0;
    var i;
    for (i = 0; i < winLen; i++) mean += Number(sig[offset + i]) || 0;
    mean /= winLen;

    var sumSq = 0;
    for (i = 0; i < winLen; i++) {
        var d0 = (Number(sig[offset + i]) || 0) - mean;
        sumSq += d0 * d0;
    }
    var rms = Math.sqrt(sumSq / winLen);
    // Sensitive gate (-72 dBFS = 0.00025) so decaying tails keep tracking
    if (rms < 0.00025) return fallbackOrHold();

    var minLag = Math.max(8, Math.floor(rate / 3200));
    var maxLag = Math.min(Math.floor(winLen * 0.64), Math.ceil(rate / 20));
    if (maxLag <= minLag) return fallbackOrHold();

    var corrLen = Math.min(winLen - maxLag - 2, 1200);
    if (corrLen < 64) return fallbackOrHold();
    var corrStart = offset + winLen - maxLag - corrLen;
    if (corrStart < offset + 1) corrStart = offset + 1;

    // Pre-compute smoothed, DC-removed signal buffer once in O(winLen) so the autocorrelation inner loop
    // is a pure Float64Array dot product with zero Number() conversions or repeated neighbour reads.
    var spanTotal = corrLen + maxLag + 2;
    var clean = new Float64Array(spanTotal);
    var prefixSq = new Float64Array(spanTotal + 1);
    for (i = 0; i < spanTotal; i++) {
        var idx = corrStart + i;
        var sm = 0.25 * (Number(sig[idx - 1]) || 0) + 0.5 * (Number(sig[idx]) || 0) + 0.25 * (Number(sig[idx + 1]) || 0) - mean;
        clean[i] = sm;
        prefixSq[i + 1] = prefixSq[i] + sm * sm;
    }

    var nsdf = new Float64Array(maxLag + 2);
    var lag;
    var step = maxLag > 400 ? 2 : 1;
    var eaFixed = prefixSq[corrLen] - prefixSq[0];
    for (lag = minLag; lag <= maxLag; lag += step) {
        var ac = 0;
        for (i = 0; i < corrLen; i += 4) {
            ac += clean[i] * clean[i + lag] + clean[i + 1] * clean[i + 1 + lag];
        }
        ac *= 2.0; // compensate for sampling 2 out of every 4 points
        var eb = prefixSq[corrLen + lag] - prefixSq[lag];
        var denom = eaFixed + eb;
        nsdf[lag] = denom > 1e-12 ? (2 * ac) / denom : 0;
    }
    if (step === 2) {
        for (lag = minLag + 1; lag <= maxLag; lag += 2) {
            nsdf[lag] = 0.5 * (nsdf[lag - 1] + (lag + 1 <= maxLag ? nsdf[lag + 1] : nsdf[lag - 1]));
        }
    }

    // McLeod Peak Picking: require a real negative lobe (< -0.10) after lag=0 so high-frequency overtone
    // ripples on the initial positive slope of a bass note never trigger a false ~1.3 kHz period.
    var seenNeg = false;
    var inPosLobe = false;
    var lobeMax = -1;
    var lobeLag = 0;
    var peaks = [];
    var globalMax = 0;

    for (lag = minLag; lag <= maxLag; lag++) {
        var v = nsdf[lag];
        if (!seenNeg) {
            if (v < -0.10) seenNeg = true;
            continue;
        }
        if (v < 0) {
            if (inPosLobe && lobeLag > 0) {
                peaks.push({ lag: lobeLag, val: lobeMax });
                if (lobeMax > globalMax) globalMax = lobeMax;
            }
            inPosLobe = false;
            lobeMax = -1;
        } else if (v > 0) {
            inPosLobe = true;
            if (v > lobeMax) {
                lobeMax = v;
                lobeLag = lag;
            }
        }
    }
    if (inPosLobe && lobeLag > 0) {
        peaks.push({ lag: lobeLag, val: lobeMax });
        if (lobeMax > globalMax) globalMax = lobeMax;
    }

    // Relaxed threshold when already locked (hysteresis: 0.14 to stay locked, 0.20 to acquire)
    var minConf = (trackerState && trackerState.period > 0) ? 0.14 : 0.20;
    if (!peaks.length || globalMax < minConf) {
        return fallbackOrHold();
    }

    var threshold = 0.85 * globalMax;
    var chosen = peaks[0];
    for (i = 0; i < peaks.length; i++) {
        if (peaks[i].val >= threshold) {
            chosen = peaks[i];
            break;
        }
    }

    // If trackerState has a recent lock, check if one of the strong candidate peaks is within 12% of the tracked period
    // (prevents octave-jumping between fundamental and 2nd harmonic on complex timbres)
    if (trackerState && trackerState.period > 0 && trackerState.holdFrames < 15) {
        var prevP = trackerState.period;
        for (i = 0; i < peaks.length; i++) {
            if (peaks[i].val >= 0.72 * globalMax && Math.abs(peaks[i].lag - prevP) <= prevP * 0.12) {
                chosen = peaks[i];
                break;
            }
        }
    }

    // Fine 1-sample search in [chosen.lag - 2 .. chosen.lag + 2] + parabolic refinement
    var centerLag = oscClamp(chosen.lag, minLag + 2, maxLag - 2);
    var fineVals = new Float64Array(5);
    var bestSubIdx = 2;
    var bestSubVal = -2;
    var d;
    for (d = -2; d <= 2; d++) {
        var L = centerLag + d;
        var ac2 = 0;
        for (i = 0; i < corrLen; i++) {
            ac2 += clean[i] * clean[i + L];
        }
        var eb2 = prefixSq[corrLen + L] - prefixSq[L];
        var vFine = (eaFixed + eb2) > 1e-12 ? (2 * ac2) / (eaFixed + eb2) : 0;
        fineVals[d + 2] = vFine;
        if (vFine > bestSubVal) {
            bestSubVal = vFine;
            bestSubIdx = d + 2;
        }
    }
    var bestLag = centerLag + (bestSubIdx - 2);
    var idxP = oscClamp(bestSubIdx, 1, 3);
    var y1 = fineVals[idxP - 1], y2 = fineVals[idxP], y3 = fineVals[idxP + 1];
    var denomP = y1 - 2 * y2 + y3;
    var delta = Math.abs(denomP) > 1e-9 ? oscClamp(0.5 * (y1 - y3) / denomP, -0.5, 0.5) : 0;
    var rawPeriod = (centerLag + (idxP - 2)) + delta;
    var conf = oscClamp(Math.max(y2, chosen.val), 0, 1);

    if (trackerState) {
        if (trackerState.period > 0 && Math.abs(rawPeriod - trackerState.period) <= trackerState.period * 0.08) {
            // Smooth jitter on steady notes (70% new, 30% previous)
            rawPeriod = trackerState.period * 0.30 + rawPeriod * 0.70;
        }
        trackerState.period = rawPeriod;
        trackerState.freq = rawPeriod > 0 ? rate / rawPeriod : 0;
        trackerState.confidence = conf;
        trackerState.holdFrames = 0;
    }

    var freq = rawPeriod > 0 ? rate / rawPeriod : 0;
    return { period: rawPeriod, freq: freq, confidence: conf, held: false };
}

/**
 * DC-removed copy of `sig` plus its peak amplitude.
 * @param {number[]} sig
 * @returns {{ ac: Float64Array, peak: number }}
 */
function oscMeanPeak(sig) {
    var n = sig ? sig.length : 0;
    var ac = new Float64Array(n);
    if (n < 1) return { ac: ac, peak: 0 };
    var mean = 0;
    var i;
    for (i = 0; i < n; i++) mean += Number(sig[i]) || 0;
    mean /= n;
    var peak = 0;
    for (i = 0; i < n; i++) {
        var v = (Number(sig[i]) || 0) - mean;
        ac[i] = v;
        var a = Math.abs(v);
        if (a > peak) peak = a;
    }
    return { ac: ac, peak: peak };
}

/**
 * Centered moving average. `win` samples, no group delay, so zero crossings stay
 * aligned with the fundamental instead of sliding forward.
 * @param {Float64Array | number[]} src
 * @param {number} win
 * @returns {Float64Array}
 */
function oscBoxSmooth(src, win) {
    var n = src ? src.length : 0;
    var w = Math.max(1, win | 0);
    var out = new Float64Array(n);
    if (n < 1 || w <= 1) {
        var c;
        for (c = 0; c < n; c++) out[c] = src[c];
        return out;
    }
    var prefix = new Float64Array(n + 1);
    var i;
    for (i = 0; i < n; i++) prefix[i + 1] = prefix[i] + src[i];
    var half = w >> 1;
    for (i = 0; i < n; i++) {
        var a = i - half;
        var b = a + w;
        if (a < 0) a = 0;
        if (b > n) b = n;
        var den = b - a;
        out[i] = den > 0 ? (prefix[b] - prefix[a]) / den : 0;
    }
    return out;
}

/**
 * Fractional rising-edge positions. With `hyst > 0`, an edge is armed only after
 * the signal has fallen to `-hyst`, so one-sample dips and harmonic ripples do not
 * each count as a new cycle.
 * @param {Float64Array | number[]} sig
 * @param {number} hyst
 * @param {number} minIndex
 * @returns {number[]}
 */
function oscRisingEdges(sig, hyst, minIndex) {
    /** @type {number[]} */
    var edges = [];
    var n = sig ? sig.length : 0;
    var armed = !(hyst > 0);
    var i;
    for (i = Math.max(1, minIndex | 0); i < n; i++) {
        var s1 = sig[i];
        var s0 = sig[i - 1];
        if (hyst > 0 && s1 <= -hyst) armed = true;
        if (armed && s0 <= 0 && s1 > 0) {
            var den = s1 - s0;
            var frac = den > 1e-9 ? oscClamp(-s0 / den, 0, 1) : 0;
            edges.push((i - 1) + frac);
            if (hyst > 0) armed = false;
        }
    }
    return edges;
}

/**
 * Rising-zero count of `sig` inside `[start, start + span]`.
 * @param {number[]} sig
 * @param {number} start
 * @param {number} span
 * @returns {number}
 */
function oscRisingCountSpan(sig, start, span) {
    var n = sig ? sig.length : 0;
    var a = Math.max(1, Math.floor(start));
    var b = Math.min(n - 1, Math.ceil(start + span));
    var count = 0;
    var i;
    for (i = a; i <= b; i++) {
        if ((Number(sig[i - 1]) || 0) <= 0 && (Number(sig[i]) || 0) > 0) count++;
    }
    return count;
}

/**
 * Median spacing of rising edges.
 * @param {number[]} edges
 * @returns {number}
 */
function oscMedianInterval(edges) {
    /** @type {number[]} */
    var iv = [];
    var i;
    for (i = 1; i < edges.length; i++) {
        var d = edges[i] - edges[i - 1];
        if (d >= 3) iv.push(d);
    }
    if (!iv.length) return 0;
    iv.sort(function (a, b) { return a - b; });
    return iv[iv.length >> 1];
}

/**
 * Energy-weighted period of the loud swings. A short click does not outvote a kick
 * body, and a hat's bright ticks outvote a fake low lock.
 * @param {number[]} sig
 * @returns {number}
 */
function oscEnergyPeriod(sig) {
    var info = oscMeanPeak(sig);
    if (!(info.peak > 1e-5)) return 0;
    var hyst = Math.max(info.peak * 0.08, 1e-5);
    var edges = oscRisingEdges(info.ac, hyst, 1);
    /** @type {{ d: number, e: number }[]} */
    var iv = [];
    var i;
    for (i = 1; i < edges.length; i++) {
        var d = edges[i] - edges[i - 1];
        if (d < 4 || d > sig.length * 0.55) continue;
        var a = Math.max(0, Math.floor(edges[i - 1]));
        var b = Math.min(info.ac.length, Math.floor(edges[i]));
        var energy = 0;
        var k;
        for (k = a; k < b; k++) energy += info.ac[k] * info.ac[k];
        iv.push({ d: d, e: energy > 1e-12 ? energy : 1e-12 });
    }
    if (iv.length < 2) return 0;
    iv.sort(function (p, q) { return p.d - q.d; });
    var tot = 0;
    for (i = 0; i < iv.length; i++) tot += iv[i].e;
    var acc = 0;
    var med = iv[0].d;
    for (i = 0; i < iv.length; i++) {
        acc += iv[i].e;
        if (acc >= tot * 0.5) {
            med = iv[i].d;
            break;
        }
    }
    return med;
}

/**
 * If `period` still holds several visible repetitions, shrink to one of them.
 * A kick or a sine already has one rise and is left alone. A snare rattle, a hat,
 * or a folded wave with a stack of lobes is cut down to a single hump.
 * @param {number[]} sig
 * @param {number} period
 * @returns {number}
 */
function oscShrinkToVisible(sig, period) {
    var span = period;
    var guard = 0;
    while (guard < 3 && span > 4) {
        var trig = oscFindTrigger(sig, span, 0, 0);
        var start = trig.index + trig.frac;
        if (oscRisingCountSpan(sig, start, span) <= 2) return span;
        var a = Math.max(0, Math.floor(start));
        var b = Math.min(sig.length, Math.ceil(start + span));
        /** @type {number[]} */
        var slice = [];
        var i;
        for (i = a; i < b; i++) slice.push(Number(sig[i]) || 0);
        var inner = oscMedianInterval(oscRisingEdges(oscMeanPeak(slice).ac, 0, 1));
        if (!(inner >= 3) || inner > span * 0.85) return span;
        span = inner;
        guard++;
    }
    return span;
}

/**
 * One-cycle length to display. A confident pitch is kept when that window is already
 * a single rise (sine, saw, kick). Anything that still draws a stack of cycles is
 * shortened to one visible repetition, which is what 1 Cyc has to show on drums.
 * @param {number[]} sig
 * @param {{ period: number, confidence: number, held?: boolean }} pitch
 * @returns {number}
 */
function oscChooseCyclePeriod(sig, pitch) {
    if (!sig || sig.length < 128) return pitch && pitch.period > 4 ? pitch.period : 48;
    var pitched = pitch && !pitch.held && pitch.period > 8 && pitch.confidence >= 0.45;
    if (pitched) return oscShrinkToVisible(sig, pitch.period);
    var vis = oscEnergyPeriod(sig);
    if (vis > 4) return oscShrinkToVisible(sig, vis);
    if (pitch && pitch.period > 4) return oscShrinkToVisible(sig, pitch.period);
    return 48;
}

/**
 * Latest edge at or before `maxStart`. When `prevPhase` is set, keep the edge whose
 * position inside the period matches the previous frame, so the drawing does not hop
 * between harmonic ripples.
 * @param {number[]} edges
 * @param {number} maxStart
 * @param {number} period
 * @param {number} prevPhase
 * @returns {number}
 */
function oscPickEdge(edges, maxStart, period, prevPhase) {
    var matchPhase = prevPhase >= 0 && period > 8;
    var minEdge = matchPhase ? Math.max(1, maxStart - period * 1.35) : 1;
    var best = -1;
    var bestScore = 1e9;
    var i;
    for (i = edges.length - 1; i >= 0; i--) {
        var e = edges[i];
        if (e < minEdge || e > maxStart) continue;
        if (!matchPhase) return e;
        var phase = e - Math.floor(e / period) * period;
        var d = Math.abs(phase - prevPhase);
        if (d > period * 0.5) d = period - d;
        var score = d + (maxStart - e) * 0.015;
        if (score < bestScore) {
            bestScore = score;
            best = e;
        }
    }
    if (best >= 0) return best;
    for (i = edges.length - 1; i >= 0; i--) {
        if (edges[i] >= 1 && edges[i] <= maxStart) return edges[i];
    }
    return -1;
}

/**
 * Snaps `edge` to the nearest raw rising zero within `radius`, so the drawn sample
 * sits on the graticule zero even when the fundamental smoother is a little off.
 * @param {number[]} rawEdges
 * @param {number} edge
 * @param {number} maxStart
 * @param {number} radius
 * @returns {number}
 */
function oscSnapZero(rawEdges, edge, maxStart, radius) {
    var best = -1;
    var bestD = radius;
    var i;
    for (i = rawEdges.length - 1; i >= 0; i--) {
        var e = rawEdges[i];
        if (e < 1 || e > maxStart) continue;
        var d = Math.abs(e - edge);
        if (d <= bestD) {
            bestD = d;
            best = e;
        }
    }
    return best >= 0 ? best : edge;
}

/**
 * Splits a fractional sample position into an index plus a fraction in `[0, 1)`.
 * @param {number} edge
 * @returns {{ index: number, frac: number, locked: boolean }}
 */
function oscEdgeToTrigger(edge) {
    var index = Math.floor(edge);
    var frac = edge - index;
    if (frac >= 0.999) {
        index += 1;
        frac = 0;
    }
    return { index: index, frac: frac, locked: true };
}

/**
 * Finds a sub-sample trigger index in `sig` so that `[trigIdx, trigIdx + span]` lies inside `[0, sig.length - 1]`.
 * Any rising (or falling) crossing counts. A monotonic-neighbour test rejected the
 * gritty, folded, and noisy crossings a real synth actually produces, so 1 Cyc
 * free-ran and the trace never sat on the centre line.
 * @param {number[]} sig
 * @param {number} span
 * @param {number} trigMode
 * @param {number} trigLevel
 * @returns {{ index: number, frac: number, locked: boolean }}
 */
function oscFindTrigger(sig, span, trigMode, trigLevel) {
    var n = sig ? sig.length : 0;
    var need = Math.max(4, Math.ceil(span) + 2);
    if (n <= need || trigMode === 2) {
        return { index: Math.max(0, n - need), frac: 0, locked: false };
    }
    var lvl = typeof trigLevel === "number" && isFinite(trigLevel) ? trigLevel : 0;
    var maxStart = n - need;
    var falling = trigMode === 1;
    var i;
    for (i = maxStart; i >= 2; i--) {
        var s0 = sig[i - 1] - lvl;
        var s1 = sig[i] - lvl;
        if (!falling) {
            if (s0 <= 0 && s1 > 0) {
                var den = s1 - s0;
                var frac = den > 1e-9 ? oscClamp(-s0 / den, 0, 1) : 0;
                return { index: i - 1, frac: frac, locked: true };
            }
        } else if (s0 >= 0 && s1 < 0) {
            var denF = s0 - s1;
            var fracF = denF > 1e-9 ? oscClamp(s0 / denF, 0, 1) : 0;
            return { index: i - 1, frac: fracF, locked: true };
        }
    }
    return { index: maxStart, frac: 0, locked: false };
}

/**
 * Phase-locks a cycle window to the fundamental's rising zero, then snaps onto the
 * nearest raw zero so the trace starts on the centre line and holds still across frames.
 * @param {number[]} sig
 * @param {number} span
 * @param {number} basePeriod
 * @param {{ lockPhase: number, lockPeriod: number }} [tracker]
 * @returns {{ index: number, frac: number, locked: boolean }}
 */
function oscPhaseLock(sig, span, basePeriod, tracker) {
    var n = sig ? sig.length : 0;
    var need = Math.max(4, Math.ceil(span) + 2);
    var maxStart = n - need;
    if (n < need + 2 || maxStart < 2) {
        return { index: Math.max(0, n - need), frac: 0, locked: false };
    }
    var period = basePeriod > 8 ? basePeriod : span;
    var prevPhase = -1;
    if (tracker && tracker.lockPhase >= 0 && tracker.lockPeriod > 8 &&
        Math.abs(period - tracker.lockPeriod) <= tracker.lockPeriod * 0.12) {
        prevPhase = tracker.lockPhase;
    }
    var info = oscMeanPeak(sig);
    var win = Math.max(3, Math.round(Math.min(period, span) / 4));
    var smooth = oscBoxSmooth(info.ac, win);
    var smoothEdges = oscRisingEdges(smooth, 0, win);
    var edge = oscPickEdge(smoothEdges, maxStart, period, prevPhase);
    var rawEdges = oscRisingEdges(info.ac, 0, 1);
    var lockedEdge = -1;
    if (edge >= 0) lockedEdge = oscSnapZero(rawEdges, edge, maxStart, Math.max(4, period * 0.22));
    if (!(lockedEdge >= 0)) {
        var hyst = Math.max(info.peak * 0.12, 1e-5);
        lockedEdge = oscPickEdge(oscRisingEdges(info.ac, hyst, 1), maxStart, period, prevPhase);
    }
    if (!(lockedEdge >= 0)) lockedEdge = oscPickEdge(rawEdges, maxStart, period, -1);
    if (!(lockedEdge >= 0)) return { index: maxStart, frac: 0, locked: false };
    if (tracker) {
        tracker.lockPeriod = period;
        tracker.lockPhase = lockedEdge - Math.floor(lockedEdge / period) * period;
    }
    return oscEdgeToTrigger(lockedEdge);
}

/**
 * Resamples a continuous window `[startPos, startPos + spanSamples]` of `sig` into `outPoints` points
 * using cubic Hermite interpolation.
 * @param {number[]} sig
 * @param {number} startPos
 * @param {number} spanSamples
 * @param {number} outPoints
 * @returns {number[]}
 */
function oscResampleWindow(sig, startPos, spanSamples, outPoints) {
    var n = sig ? sig.length : 0;
    var pts = Math.max(16, Math.round(outPoints) || 256);
    var out = new Array(pts);
    if (n < 2) {
        for (var z = 0; z < pts; z++) out[z] = 0;
        return out;
    }
    var span = Math.max(2, spanSamples);
    var i;
    for (i = 0; i < pts; i++) {
        var t = pts <= 1 ? 0 : i / (pts - 1);
        var pos = oscClamp(startPos + t * span, 0, n - 1.0001);
        var idx = Math.floor(pos);
        var f = pos - idx;
        var ym1 = sig[Math.max(0, idx - 1)];
        var y0 = sig[idx];
        var y1 = sig[Math.min(n - 1, idx + 1)];
        var y2 = sig[Math.min(n - 1, idx + 2)];
        var c0 = y0;
        var c1 = 0.5 * (y1 - ym1);
        var c2 = ym1 - 2.5 * y0 + 2 * y1 - 0.5 * y2;
        var c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1);
        out[i] = ((c3 * f + c2) * f + c1) * f + c0;
    }
    return out;
}

/**
 * Computes the effective display gain multiplier when `autoGain` (normalize) and `gainDb` are applied:
 * - When `autoGain` is ON (`1`): normalizes the waveform so its peak reaches `0.80` (`0.80 / max(peak, 1e-4)`,
 *   leaving 20% headroom to the ±1.0 full-scale rails so 0 dB normalized waves never clip), and THEN multiplies
 *   by `oscDbToLin(gainDb)`!
 * - When `autoGain` is OFF (`0`): applies `oscDbToLin(gainDb)` directly.
 * @param {number} peak
 * @param {number} gainDb
 * @param {number | boolean} autoGain
 * @returns {{ totalGain: number, normGain: number, userGain: number }}
 */
function oscComputeEffectiveGain(peak, gainDb, autoGain) {
    var userGain = oscDbToLin(gainDb);
    var normGain = 1.0;
    if (autoGain) {
        var pk = Number(peak) || 0;
        if (pk > 1e-4) {
            normGain = oscClamp(1.0 / pk, 0.25, 64.0);
        }
    }
    return {
        totalGain: normGain * userGain,
        normGain: normGain,
        userGain: userGain
    };
}

/**
 * Computes the complete oscilloscope frame (`wave1`, `wave2`, `stats`, `windowMs`, `cycles`, `pitch`)
 * from raw Left/Right ring samples according to user settings.
 * @param {number[]} rawL
 * @param {number[]} rawR
 * @param {number} sr
 * @param {{ chMode: number, cycleMode: number, trigMode?: number, trigLevel?: number, points?: number, pitchState?: any }} [opts]
 */
function oscComputeFrame(rawL, rawR, sr, opts) {
    var rate = sr > 1000 ? sr : 48000;
    /** @type {{ chMode: number, cycleMode: number, trigMode?: number, trigLevel?: number, points?: number, pitchState?: any }} */
    var o = opts || { chMode: 0, cycleMode: 0 };
    var ch = oscExtractChannels(rawL, rawR, o.chMode);
    var cycIdx = oscClamp(Math.round(Number(o.cycleMode) || 0), 0, OSC_CYCLE_NAMES.length - 1);
    var outPoints = o.points || 280;

    var st1 = oscStats(ch.ch1);
    var st2 = oscStats(ch.ch2);

    // Choose reference signal for pitch estimation & triggering from the visible channel(s):
    // - If only Slot 2 is shown (R solo or Side solo), trigger & track pitch on ch2!
    // - If only Slot 1 is shown (L solo or Mid solo), trigger & track pitch on ch1!
    // - If both are shown, use whichever active channel has stronger RMS.
    var refSig = ch.ch1;
    if (!ch.show1 && ch.show2) {
        refSig = ch.ch2;
    } else if (ch.show1 && ch.show2 && st2.rms > st1.rms * 1.25) {
        refSig = ch.ch2;
    }

    var pitch = oscEstimatePeriod(refSig, rate, o.pitchState);
    // If primary channel was unvoiced (e.g. Side-only silence), also check Mid `(L+R)*0.5` so pitch stays available
    if (!(pitch.period > 0) && rawL && rawR && rawL.length >= 128) {
        var midFallback = new Array(Math.min(rawL.length, rawR.length));
        for (var mi = 0; mi < midFallback.length; mi++) {
            midFallback[mi] = ((Number(rawL[mi]) || 0) + (Number(rawR[mi]) || 0)) * 0.5;
        }
        pitch = oscEstimatePeriod(midFallback, rate, o.pitchState);
    }

    var numCycles = OSC_CYCLE_COUNTS[cycIdx];
    var spanSamples = 0;
    var isSingleCycleMode = numCycles > 0;
    var basePeriod = pitch.period > 0 ? pitch.period : 0;

    var trig;
    if (isSingleCycleMode) {
        basePeriod = oscChooseCyclePeriod(refSig, pitch);
        // A bright hat can be only a few samples long. Stretching that out to 10 ms
        // draws dozens of cycles and labels them as one.
        if (!(basePeriod >= 3)) basePeriod = Math.max(3, Math.round(rate / 2000));
        // The first estimate is checked at one trigger. Phase lock can land on a
        // busier part of the same buffer, so measure the window that will be drawn
        // and shorten it until that window is a single rise.
        var shrinkPass = 0;
        while (shrinkPass < 3) {
            spanSamples = oscClamp(basePeriod * numCycles, 3, Math.floor(ch.ch1.length * 0.90));
            trig = oscPhaseLock(refSig, spanSamples, basePeriod, o.pitchState);
            var oneSpan = Math.min(basePeriod, spanSamples);
            if (oscRisingCountSpan(refSig, trig.index + trig.frac, oneSpan) <= 2) break;
            var cut = oscMedianInterval(oscRisingEdges(
                oscMeanPeak(refSig.slice(trig.index, Math.min(refSig.length, trig.index + Math.ceil(oneSpan)))).ac, 0, 1));
            if (!(cut >= 3) || cut > basePeriod * 0.85) break;
            basePeriod = cut;
            shrinkPass++;
        }
    } else {
        var ms = OSC_FIXED_MS[cycIdx] || 20;
        spanSamples = oscClamp((rate * ms) / 1000, 32, Math.floor(ch.ch1.length * 0.90));
        trig = oscFindTrigger(refSig, spanSamples, 0, o.trigLevel || 0);
    }
    var startPos = trig.index + trig.frac;

    var w1 = ch.show1 ? oscResampleWindow(ch.ch1, startPos, spanSamples, outPoints) : [];
    var w2 = ch.show2 ? oscResampleWindow(ch.ch2, startPos, spanSamples, outPoints) : [];

    var corr = oscCorrelation(rawL, rawR);
    var winPk1 = ch.show1 ? oscStats(w1).peak : 0;
    var winPk2 = ch.show2 ? oscStats(w2).peak : 0;
    var bufPk1 = ch.show1 ? st1.peak : 0;
    var bufPk2 = ch.show2 ? st2.peak : 0;
    var winMax = Math.max(winPk1, winPk2);
    var maxPeak = winMax > 1e-3 ? winMax : Math.max(bufPk1, bufPk2);

    return {
        wave1: w1,
        wave2: w2,
        label1: ch.label1,
        label2: ch.label2,
        dual: ch.dual,
        show1: ch.show1,
        show2: ch.show2,
        isCycleLocked: isSingleCycleMode,
        cycles: numCycles,
        spanSamples: spanSamples,
        windowMs: (spanSamples * 1000) / rate,
        freq: isSingleCycleMode && basePeriod >= 3 ? (rate / basePeriod) : pitch.freq,
        note: oscFreqToNote(isSingleCycleMode && basePeriod >= 3 ? (rate / basePeriod) : pitch.freq),
        confidence: pitch.confidence,
        trigLocked: trig.locked,
        stats1: st1,
        stats2: st2,
        winPeak1: winPk1,
        winPeak2: winPk2,
        maxPeak: maxPeak,
        corr: corr
    };
}

/**
 * Signal amplitude statistics (`peak`, `rms`, `vpp`, `dc`).
 * @param {number[]} sig
 * @returns {{ peak: number, rms: number, vpp: number, dc: number }}
 */
function oscStats(sig) {
    if (!sig || !sig.length) return { peak: 0, rms: 0, vpp: 0, dc: 0 };
    var n = Math.min(sig.length, 1024);
    var off = sig.length - n;
    var minV = 1e9;
    var maxV = -1e9;
    var sumSq = 0;
    var sum = 0;
    var i;
    for (i = 0; i < n; i++) {
        var v = Number(sig[off + i]) || 0;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
        sumSq += v * v;
        sum += v;
    }
    var peak = Math.max(Math.abs(minV), Math.abs(maxV));
    return {
        peak: peak,
        rms: Math.sqrt(sumSq / n),
        vpp: maxV - minV,
        dc: sum / n
    };
}

/**
 * Pearson stereo correlation in `[-1, +1]` between Left and Right arrays.
 * @param {number[]} l
 * @param {number[]} r
 * @returns {number}
 */
function oscCorrelation(l, r) {
    if (!l || !r) return 0;
    var n = Math.min(l.length, r.length, 1024);
    if (n < 2) return 0;
    var offL = l.length - n;
    var offR = r.length - n;
    var ll = 0, rr = 0, lr = 0;
    var i;
    for (i = 0; i < n; i++) {
        var a = Number(l[offL + i]) || 0;
        var b = Number(r[offR + i]) || 0;
        ll += a * a;
        rr += b * b;
        lr += a * b;
    }
    var d = Math.sqrt(ll * rr);
    return d > 1e-12 ? oscClamp(lr / d, -1, 1) : 0;
}

// ---------------------------------------------------------------------------------------------
// UI Geometry (`460 x 169 px`)
// ---------------------------------------------------------------------------------------------
function oscGeom() {
    // Top Header Bar (`y = 6..21`):
    //   - `Mode` selection box (`Stereo`, `M / S`) + tristate `Ch` toggle button (`L / R`, `L`, `R` or `M / S`, `M`, `S`)
    //   - `Layout` single toggle button (`Overlay` / `Split`)
    //   - `Window` selection box (`1 Cyc`, `2 Cyc`, `4 Cyc`, `8 Cyc`, `5 ms`, `20 ms`, `50 ms`)
    //   - `Freeze` toggle button on far right
    var modeBox = [36, 6, 54, 15];
    var editBtn = [118, 6, 36, 15];
    var splitBtn = [184, 6, 48, 15];
    var winBox = [276, 6, 56, 15];
    var freezeBtn = [408, 6, 44, 15];

    // Main Oscilloscope Viewport (`x = 8..340, y = 25..162`, height 137 px)
    var lcd = [8, 25, 332, 137];
    var plot = [lcd[0] + 22, lcd[1] + 4, lcd[2] - 26, lcd[3] - 8];

    // Dropdown Popup Menus (when open, rendered on top of LCD):
    //   - `modeMenuItems`: 2 rows (`Stereo`, `M / S`)
    //   - `winMenuItems`:  7 rows (`1 Cyc` .. `50 ms`)
    var modeMenuItems = [];
    var i;
    for (i = 0; i < OSC_MODE_NAMES.length; i++) {
        modeMenuItems.push([modeBox[0], modeBox[1] + modeBox[3] + 1 + i * 15, modeBox[2], 15]);
    }
    var winMenuItems = [];
    for (i = 0; i < OSC_CYCLE_NAMES.length; i++) {
        winMenuItems.push([winBox[0], winBox[1] + winBox[3] + 1 + i * 15, winBox[2], 15]);
    }

    // Right Telemetry & Sliders Sidebar (`x = 346..452, y = 25..162`, height 137 px)
    var side = [346, 25, 106, 137];
    // Refresh Rate value slider (`1..60 Hz`)
    var rateSlider = [352, 113, 94, 14];
    // Gain Scale value slider (`-18..+24 dB`) + Auto Normalize toggle button (`Auto`)
    var autoBtn = [418, 131, 28, 12];
    var gainSlider = [352, 145, 94, 14];

    return {
        modeBox: modeBox,
        editBtn: editBtn,
        splitBtn: splitBtn,
        winBox: winBox,
        freeze: freezeBtn,
        lcd: lcd,
        plot: plot,
        side: side,
        rateSlider: rateSlider,
        autoBtn: autoBtn,
        gainSlider: gainSlider,
        modeMenuItems: modeMenuItems,
        winMenuItems: winMenuItems
    };
}

function oscHits(openMenu) {
    var g = oscGeom();
    var hits = [];
    var i;
    if (openMenu === "mode") {
        for (i = 0; i < g.modeMenuItems.length; i++) {
            hits.push({ kind: "mode_item", index: i, rect: g.modeMenuItems[i] });
        }
    } else if (openMenu === "window") {
        for (i = 0; i < g.winMenuItems.length; i++) {
            hits.push({ kind: "win_item", index: i, rect: g.winMenuItems[i] });
        }
    }
    hits.push({ kind: "mode_box", index: 0, rect: g.modeBox });
    hits.push({ kind: "edit_btn", index: 0, rect: g.editBtn });
    hits.push({ kind: "split_btn", index: 0, rect: g.splitBtn });
    hits.push({ kind: "win_box", index: 0, rect: g.winBox });
    hits.push({ kind: "freeze", index: 0, rect: g.freeze });
    hits.push({ kind: "rate_slider", index: 0, rect: g.rateSlider });
    hits.push({ kind: "auto_btn", index: 0, rect: g.autoBtn });
    hits.push({ kind: "gain_slider", index: 0, rect: g.gainSlider });
    return hits;
}

function oscHitAt(x, y, openMenu) {
    var hits = oscHits(openMenu);
    var i;
    // Check popup items first (they are at the beginning when a menu is open)
    for (i = 0; i < hits.length; i++) {
        if ((hits[i].kind === "mode_item" || hits[i].kind === "win_item") && oscInside(hits[i].rect, x, y)) {
            return hits[i];
        }
    }
    for (i = hits.length - 1; i >= 0; i--) {
        if (oscInside(hits[i].rect, x, y)) return hits[i];
    }
    return null;
}

// ---------------------------------------------------------------------------------------------
// State Blob Serialization (v5, backward-compatible with v1, v2, v3, and v4 blobs)
// ---------------------------------------------------------------------------------------------
function oscDefaultState() {
    return {
        routingMode: 0, // 0 = Stereo, 1 = M / S
        editSub: 0,     // 0 = L/R or M/S (both), 1 = L or M, 2 = R or S
        chMode: 0,      // derived 0..5
        viewMode: 0,    // 0 = Overlay, 1 = Split
        cycleMode: 1,   // 0 = 1 Cyc, 1 = 2 Cyc, 2 = 4 Cyc, 3 = 8 Cyc, 4 = 5 ms, 5 = 20 ms, 6 = 50 ms
        rateHz: OSC_RATE_DEFAULT,     // 1..60 Hz
        gainDb: OSC_GAIN_DEFAULT_DB,  // -18..+24 dB
        autoGain: 0,    // 0 = Off, 1 = Auto Normalize On
        trigLevel: 0    // armed trigger amp (-1..1); 0 = cleared
    };
}

function oscBlob(st) {
    var s = st || oscDefaultState();
    var rMode = s.routingMode !== undefined ? s.routingMode : oscRoutingFromChMode(s.chMode).routingMode;
    var eSub = s.editSub !== undefined ? s.editSub : oscRoutingFromChMode(s.chMode).editSub;
    return [
        OSC_VERSION,
        oscClamp(rMode, 0, 1) | 0,
        oscClamp(eSub, 0, 2) | 0,
        oscClamp(s.viewMode, 0, 1) | 0,
        oscClamp(s.cycleMode, 0, 6) | 0,
        Math.round(oscClamp(s.rateHz !== undefined ? s.rateHz : OSC_RATE_DEFAULT, OSC_RATE_MIN, OSC_RATE_MAX)),
        Math.round(oscClamp(s.gainDb !== undefined ? s.gainDb : OSC_GAIN_DEFAULT_DB, OSC_GAIN_MIN_DB, OSC_GAIN_MAX_DB) * 10) / 10,
        s.autoGain ? 1 : 0,
        Math.round(oscClamp(s.trigLevel !== undefined ? s.trigLevel : 0, -1, 1) * 1000) / 1000
    ];
}

function oscFromBlob(arr) {
    var d = oscDefaultState();
    if (!arr || !arr.length) return d;
    var ver = Number(arr[0]);
    if (ver === OSC_VERSION && arr.length >= 9) {
        d.routingMode = oscClamp(arr[1], 0, 1) | 0;
        d.editSub = oscClamp(arr[2], 0, 2) | 0;
        d.chMode = oscResolveRouting(d.routingMode, d.editSub).chMode;
        d.viewMode = oscClamp(arr[3], 0, 1) | 0;
        d.cycleMode = oscClamp(arr[4], 0, 6) | 0;
        d.rateHz = oscClamp(arr[5], OSC_RATE_MIN, OSC_RATE_MAX);
        d.gainDb = oscClamp(arr[6], OSC_GAIN_MIN_DB, OSC_GAIN_MAX_DB);
        d.autoGain = arr[7] ? 1 : 0;
        d.trigLevel = oscClamp(arr[8], -1, 1);
        return d;
    }
    if (ver === 4 && arr.length >= 8) {
        d.routingMode = oscClamp(arr[1], 0, 1) | 0;
        d.editSub = oscClamp(arr[2], 0, 2) | 0;
        d.chMode = oscResolveRouting(d.routingMode, d.editSub).chMode;
        d.viewMode = oscClamp(arr[3], 0, 1) | 0;
        d.cycleMode = oscClamp(arr[4], 0, 6) | 0;
        d.rateHz = oscClamp(arr[5], OSC_RATE_MIN, OSC_RATE_MAX);
        d.gainDb = oscClamp(arr[6], OSC_GAIN_MIN_DB, OSC_GAIN_MAX_DB);
        d.autoGain = arr[7] ? 1 : 0;
        return d;
    }
    if (ver === 3 && arr.length >= 9) {
        // v3 had routingMode 0=Stereo, 1=L/R (editSub 0=L, 1=R), 2=M/S (editSub 0=M/S, 1=M, 2=S)
        var oldR = oscClamp(arr[1], 0, 2) | 0;
        var oldSub = oscClamp(arr[2], 0, 2) | 0;
        if (oldR === 0) {
            d.routingMode = 0;
            d.editSub = 0;
        } else if (oldR === 1) {
            d.routingMode = 0;
            d.editSub = (oldSub % 2) === 1 ? 2 : 1; // L -> 1, R -> 2
        } else {
            d.routingMode = 1;
            d.editSub = oldSub;
        }
        d.chMode = oscResolveRouting(d.routingMode, d.editSub).chMode;
        d.viewMode = oscClamp(arr[3], 0, 1) | 0;
        d.cycleMode = oscClamp(arr[4], 0, 6) | 0;
        d.rateHz = oscClamp(arr[6], OSC_RATE_MIN, OSC_RATE_MAX);
        d.gainDb = oscClamp(arr[7], OSC_GAIN_MIN_DB, OSC_GAIN_MAX_DB);
        d.autoGain = arr[8] ? 1 : 0;
        return d;
    }
    if (ver === 2 && arr.length >= 7) {
        var ch = oscClamp(arr[1], 0, 5) | 0;
        var rt = oscRoutingFromChMode(ch);
        d.routingMode = rt.routingMode;
        d.editSub = rt.editSub;
        d.chMode = ch;
        d.viewMode = oscClamp(arr[2], 0, 1) | 0;
        d.cycleMode = oscClamp(arr[3], 0, 6) | 0;
        var rIdx = oscClamp(arr[5], 0, 3) | 0;
        var gIdx = oscClamp(arr[6], 0, 3) | 0;
        d.rateHz = OSC_RATE_HZ[rIdx] || OSC_RATE_DEFAULT;
        d.gainDb = OSC_GAIN_DB[gIdx] !== undefined ? OSC_GAIN_DB[gIdx] : 0;
        d.autoGain = 0;
        return d;
    }
    if (ver === 1 && arr.length >= 7) {
        var oldMode = oscClamp(arr[4], 0, 3) | 0;
        if (oldMode === 1) {
            d.routingMode = 1;
            d.editSub = 1;
        } else if (oldMode === 2) {
            d.routingMode = 1;
            d.editSub = 2;
        } else {
            d.routingMode = 0;
            d.editSub = 0;
        }
        d.chMode = oscResolveRouting(d.routingMode, d.editSub).chMode;
        d.viewMode = 0;
        var oldTime = oscClamp(arr[5], 0, 2) | 0;
        d.cycleMode = 4 + oldTime;
        return d;
    }
    return d;
}

var _oscNodeModule = (typeof module !== "undefined") ? module : undefined;
if (_oscNodeModule && _oscNodeModule.exports) {
    _oscNodeModule.exports = {
        OSC_VERSION: OSC_VERSION,
        OSC_W: OSC_W,
        OSC_H: OSC_H,
        OSC_HDR_FRAME: OSC_HDR_FRAME,
        OSC_HDR_SR: OSC_HDR_SR,
        OSC_HDR_SCOPE: OSC_HDR_SCOPE,
        OSC_RING_N: OSC_RING_N,
        OSC_SCOPE_L: OSC_SCOPE_L,
        OSC_SCOPE_R: OSC_SCOPE_R,
        OSC_BUF_SAMPS: OSC_BUF_SAMPS,
        OSC_MODE_NAMES: OSC_MODE_NAMES,
        OSC_CH_NAMES: OSC_CH_NAMES,
        OSC_VIEW_NAMES: OSC_VIEW_NAMES,
        OSC_CYCLE_NAMES: OSC_CYCLE_NAMES,
        OSC_CYCLE_COUNTS: OSC_CYCLE_COUNTS,
        OSC_FIXED_MS: OSC_FIXED_MS,
        OSC_RATE_MIN: OSC_RATE_MIN,
        OSC_RATE_MAX: OSC_RATE_MAX,
        OSC_RATE_DEFAULT: OSC_RATE_DEFAULT,
        OSC_RATE_HZ: OSC_RATE_HZ,
        OSC_RATE_MS: OSC_RATE_MS,
        OSC_RATE_NAMES: OSC_RATE_NAMES,
        OSC_GAIN_MIN_DB: OSC_GAIN_MIN_DB,
        OSC_GAIN_MAX_DB: OSC_GAIN_MAX_DB,
        OSC_GAIN_DEFAULT_DB: OSC_GAIN_DEFAULT_DB,
        OSC_GAIN_DB: OSC_GAIN_DB,
        OSC_GAIN_LIN: OSC_GAIN_LIN,
        OSC_GAIN_NAMES: OSC_GAIN_NAMES,
        oscClamp: oscClamp,
        oscInside: oscInside,
        oscRateToMs: oscRateToMs,
        oscDbToLin: oscDbToLin,
        oscResolveRouting: oscResolveRouting,
        oscRoutingFromChMode: oscRoutingFromChMode,
        oscFreqToNote: oscFreqToNote,
        oscExtractChannels: oscExtractChannels,
        oscCreatePitchState: oscCreatePitchState,
        oscEstimatePeriod: oscEstimatePeriod,
        oscFindTrigger: oscFindTrigger,
        oscResampleWindow: oscResampleWindow,
        oscComputeEffectiveGain: oscComputeEffectiveGain,
        oscComputeFrame: oscComputeFrame,
        oscStats: oscStats,
        oscCorrelation: oscCorrelation,
        oscGeom: oscGeom,
        oscHits: oscHits,
        oscHitAt: oscHitAt,
        oscDefaultState: oscDefaultState,
        oscBlob: oscBlob,
        oscFromBlob: oscFromBlob
    };
}
