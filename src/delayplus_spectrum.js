// Delay+ spectrogram engine for the Filter Display: the same 8192-point Hann-windowed radix-2 FFT
// and per-pixel bin sampling as Multiband Split (src/mbsplit_config.js, computeFft8192DbBins /
// sampleFft8192DbForPixel), copied so the two devices stay independent. About 5.9 Hz per bin at
// 48 kHz, so single harmonics stay separate down low; above that each pixel keeps its loudest bin.

var DP_FFT_N = 8192;
var DP_FFT_BINS = 4096;
var DP_SPEC_DB_MIN = -72;
var DP_SPEC_DB_MAX = 6;
var dpFftRev = null, dpFftWin = null, dpFftRe = null, dpFftIm = null, dpFftDb = null;

function dpFftTables() {
    if (dpFftRev) return;
    var N = DP_FFT_N;
    dpFftRev = new Array(N);
    dpFftWin = new Array(N);
    dpFftRe = new Array(N);
    dpFftIm = new Array(N);
    dpFftDb = new Array(DP_FFT_BINS);
    for (var i = 0; i < N; i++) {
        var rev = 0, v = i;
        for (var b = 0; b < 13; b++) {
            rev = (rev << 1) | (v & 1);
            v >>= 1;
        }
        dpFftRev[i] = rev;
        // Hann, scaled so a full-scale sine reads about 0 dB
        dpFftWin[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1))) * (4 / N);
    }
}

/**
 * dB magnitude of the 4096 bins of one 8192-sample frame (oldest sample first), with Multiband
 * Split's gentle pink tilt so upper harmonics stay readable.
 * @param {ArrayLike<number>} frame
 * @param {number} sr
 */
function dpFftDbBins(frame, sr) {
    dpFftTables();
    var N = DP_FFT_N, re = dpFftRe, im = dpFftIm;
    for (var i = 0; i < N; i++) {
        var ri = dpFftRev[i];
        re[ri] = (Number(frame[i]) || 0) * dpFftWin[i];
        im[ri] = 0;
    }
    for (var size = 2; size <= N; size <<= 1) {
        var half = size >> 1;
        var theta = (-2 * Math.PI) / size;
        var sRe = Math.cos(theta), sIm = Math.sin(theta);
        for (var start = 0; start < N; start += size) {
            var wr = 1, wi = 0;
            for (var j = 0; j < half; j++) {
                var e = start + j, o = e + half;
                var tr = wr * re[o] - wi * im[o];
                var ti = wr * im[o] + wi * re[o];
                re[o] = re[e] - tr;
                im[o] = im[e] - ti;
                re[e] += tr;
                im[e] += ti;
                var nwr = wr * sRe - wi * sIm;
                wi = wr * sIm + wi * sRe;
                wr = nwr;
            }
        }
    }
    var rate = Number(sr) || 48000;
    for (var k = 0; k < DP_FFT_BINS; k++) {
        var mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        var f = (k * rate) / N;
        // Hold the tilt at the 60 Hz value so the slope does not step several dB between adjacent bins.
        var fTilt = f < 60 ? 60 : f;
        var tilt = k > 0 ? 2.2 * Math.log(fTilt / 250) / Math.LN2 : 0;
        dpFftDb[k] = dpClamp(20 * Math.log10(Math.max(mag, 1e-6)) + tilt, DP_SPEC_DB_MIN, DP_SPEC_DB_MAX);
    }
    return dpFftDb;
}

/**
 * dB of one screen pixel spanning [fLo, fHi] Hz: Catmull-Rom between bins when the pixel is
 * narrower than a bin or so, the loudest bin inside it otherwise (narrow peaks never average away).
 * @param {number} fLo
 * @param {number} fHi
 * @param {ArrayLike<number>} db
 * @param {number} sr
 */
function dpFftPixelDb(fLo, fHi, db, sr) {
    var scale = DP_FFT_N / Math.max(8000, Number(sr) || 48000);
    var bLo = dpClamp(fLo * scale, 1, DP_FFT_BINS - 3);
    var bHi = dpClamp(fHi * scale, bLo, DP_FFT_BINS - 2);
    if (bHi - bLo <= 1.15) {
        var bMid = 0.5 * (bLo + bHi), idx = Math.floor(bMid), t = bMid - idx;
        var p0 = db[Math.max(1, idx - 1)], p1 = db[idx];
        var p2 = db[Math.min(DP_FFT_BINS - 1, idx + 1)], p3 = db[Math.min(DP_FFT_BINS - 1, idx + 2)];
        var v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
            + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
        return dpClamp(v, DP_SPEC_DB_MIN, DP_SPEC_DB_MAX);
    }
    var m = DP_SPEC_DB_MIN;
    for (var b = Math.max(1, Math.floor(bLo)); b <= Math.min(DP_FFT_BINS - 1, Math.ceil(bHi)); b++) {
        if (db[b] > m) m = db[b];
    }
    return m;
}

var nodeModuleSpec = (typeof module !== "undefined") ? module : undefined;
if (nodeModuleSpec && nodeModuleSpec.exports) {
    nodeModuleSpec.exports = { DP_FFT_N, DP_FFT_BINS, dpFftDbBins, dpFftPixelDb };
}
