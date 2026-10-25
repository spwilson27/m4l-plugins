// Clip+ reference: the waveshaper, the spectral body/detail split, K-weighting and the
// loudness meters. The genexpr functions cp_curve / cp_body / cp_fir_coef are a line-for-line
// twin (tests/test_clipplus.js transpiles them and compares). The face draws the same curve.
//
// Detail 0 is this waveshaper. Detail 100 keeps quiet partials (below a quarter of the clip
// threshold) and clips the loud ones, which is the published spectral-clipper behaviour:
// a loud low sine no longer erases a quiet higher one. Drive's first 12 dB is the curve's
// small-signal gain; anything above that overdrives the same curve. At Drive 0 every shape
// is the same ceiling clamp. Symmetry hardens one polarity and softens the other.

var CLIP_N = 1024;
var CLIP_HOP = 256;
var CLIP_STFT_LAT = 1023;
var CLIP_FIR_N = 97;
var CLIP_OS_DELAY = 24;
var CLIP_TP_DELAY = 24;
// The oversampler delay is absorbed into the STFT alignment. Output latency is the STFT plus the true-peak filter.
var CLIP_LATENCY = CLIP_STFT_LAT + CLIP_TP_DELAY;
var CLIP_SCOPE = 1280;
var CLIP_WAVE_BASE = 32;
var CLIP_WAVE_FRAMES = 64;
var CLIP_SCATTER = 288;
var CLIP_METER_BASE = 400;
var CLIP_METER_FRAMES = 128;
var CLIP_BLOCK = 256;

function cpDbToLin(db) {
    return Math.pow(10, db / 20);
}

function cpLinToDb(lin) {
    var a = Math.abs(lin);
    if (!(a > 1e-12)) return -120;
    return 20 * Math.log10(a);
}

function cpCurve(x, driveDb, shapePct, symPct, ceilLin) {
    var drv = driveDb < 0 ? 0 : (driveDb > 24 ? 24 : driveDb);
    var t = drv / 0.5;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var k = t * t * (3 - 2 * t);
    var curveDb = drv < 12 ? drv : 12;
    var overDb = drv > 12 ? drv - 12 : 0;
    var g = Math.pow(10, curveDb / 20);
    var ov = Math.pow(10, overDb / 20);
    var uGain = ov * g;
    var c = ceilLin > 1e-6 ? ceilLin : 1e-6;
    var hardIn = uGain * x;
    var hard = hardIn < -c ? -c : (hardIn > c ? c : hardIn);
    var shp = shapePct / 100;
    if (shp < 0) shp = 0;
    if (shp > 1) shp = 1;
    var sy = symPct / 100;
    if (sy < -1) sy = -1;
    if (sy > 1) sy = 1;
    var sp = shp + sy;
    if (sp < 0) sp = 0;
    if (sp > 1) sp = 1;
    var sn = shp - sy;
    if (sn < 0) sn = 0;
    if (sn > 1) sn = 1;
    var lnA0 = Math.log(1.2);
    var lnA1 = Math.log(32);
    var aP = Math.exp(lnA0 + sp * (lnA1 - lnA0));
    var aN = Math.exp(lnA0 + sn * (lnA1 - lnA0));
    var u = uGain * x / c;
    var au = u < 0 ? -u : u;
    var aUse = u >= 0 ? aP : aN;
    var pw = au > 1e-20 ? Math.exp(aUse * Math.log(au)) : 0;
    var den = Math.exp(Math.log(1 + pw) / aUse);
    var soft = c * (u / den);
    return (1 - k) * hard + k * soft;
}

function cpDriveGain(driveDb) {
    var drv = driveDb < 0 ? 0 : (driveDb > 24 ? 24 : driveDb);
    return Math.pow(10, drv / 20);
}

// Gain reduction is how far the driven peak sits above the ceiling, in dB.
// Soft-knee sag below the ceiling and STFT windowing are not clipping.
function cpClipGrDb(drivenPeak, ceilLin) {
    var c = ceilLin > 1e-6 ? ceilLin : 1e-6;
    if (!(drivenPeak > c)) return 0;
    var gr = 20 * Math.log10(drivenPeak / c);
    if (gr < 0.08) return 0;
    if (gr > 60) return 60;
    return gr;
}

// chmode 0 = both, 1 = channel 0, 2 = channel 1. Peaks are linear, post drive gain.
function cpBlockGrDb(peakL, peakR, chmode, ceilLin) {
    var peak = peakL > peakR ? peakL : peakR;
    if (chmode > 1.5) peak = peakR;
    else if (chmode > 0.5 && chmode < 1.5) peak = peakL;
    return cpClipGrDb(peak, ceilLin);
}

function cpBody(amp, thresh) {
    var lo = thresh * 0.25;
    var hi = thresh > lo + 1e-12 ? thresh : lo + 1e-12;
    var t = (amp - lo) / (hi - lo);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
}

function cpFirRaw(i) {
    var n = CLIP_FIR_N;
    var mid = (n - 1) * 0.5;
    var fc = 0.125;
    var x = i - mid;
    var sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    var w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (n - 1));
    return sinc * w;
}

function cpFirCoef(i) {
    var s = 0;
    var k;
    for (k = 0; k < CLIP_FIR_N; k++) s += cpFirRaw(k);
    if (!(s > 0)) s = 1;
    return cpFirRaw(i) / s;
}

function cpFirTable() {
    var c = new Float64Array(CLIP_FIR_N);
    var i;
    for (i = 0; i < CLIP_FIR_N; i++) c[i] = cpFirCoef(i);
    return c;
}

function cpOsDelay() {
    return CLIP_OS_DELAY;
}

// 4x zero-stuff, lowpass, nonlinearity, lowpass, keep phase 0. Linear-phase delay is CLIP_OS_DELAY
// base samples when the nonlinearity is identity. `shapeFn(sample) -> sample`.
function cpOsProcess(up, dn, coef, x, shapeFn) {
    var n = CLIP_FIR_N;
    var out = 0;
    var p, i, acc, ins, upY, sh;
    for (p = 0; p < 4; p++) {
        ins = p === 0 ? x * 4 : 0;
        for (i = n - 1; i >= 1; i--) up[i] = up[i - 1];
        up[0] = ins;
        acc = 0;
        for (i = 0; i < n; i++) acc += up[i] * coef[i];
        upY = acc;
        sh = shapeFn(upY);
        for (i = n - 1; i >= 1; i--) dn[i] = dn[i - 1];
        dn[0] = sh;
        acc = 0;
        for (i = 0; i < n; i++) acc += dn[i] * coef[i];
        if (p === 0) out = acc;
    }
    return out;
}

function cpDelayWrite(line, w, x) {
    line[w] = x;
    w += 1;
    if (w >= line.length) w = 0;
    return w;
}

// `w` is the next write index. delay 0 is the sample just written.
function cpDelayRead(line, w, delay) {
    var i = w - 1 - delay;
    while (i < 0) i += line.length;
    return line[i];
}

function cpBiquadCoefShelf(sr) {
    var db = 3.999843853973347;
    var f0 = 1681.974450955533;
    var Q = 0.7071752369554196;
    var A = Math.pow(10, db / 40);
    var w0 = 2 * Math.PI * f0 / sr;
    var cw = Math.cos(w0);
    var alpha = Math.sin(w0) / (2 * Q);
    var b0 = A * ((A + 1) + (A - 1) * cw + 2 * Math.sqrt(A) * alpha);
    var b1 = -2 * A * ((A - 1) + (A + 1) * cw);
    var b2 = A * ((A + 1) + (A - 1) * cw - 2 * Math.sqrt(A) * alpha);
    var a0 = (A + 1) - (A - 1) * cw + 2 * Math.sqrt(A) * alpha;
    var a1 = 2 * ((A - 1) - (A + 1) * cw);
    var a2 = (A + 1) - (A - 1) * cw - 2 * Math.sqrt(A) * alpha;
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function cpBiquadCoefHp(sr) {
    var f0 = 38.13547087602444;
    var Q = 0.50053065135177;
    var w0 = 2 * Math.PI * f0 / sr;
    var cw = Math.cos(w0);
    var alpha = Math.sin(w0) / (2 * Q);
    var b0 = (1 + cw) * 0.5;
    var b1 = -(1 + cw);
    var b2 = (1 + cw) * 0.5;
    var a0 = 1 + alpha;
    var a1 = -2 * cw;
    var a2 = 1 - alpha;
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function cpBqStep(st, coef) {
    var y = coef[0] * st.x + coef[1] * st.x1 + coef[2] * st.x2 - coef[3] * st.y1 - coef[4] * st.y2;
    st.x2 = st.x1;
    st.x1 = st.x;
    st.y2 = st.y1;
    st.y1 = y;
    return y;
}

function cpKWeightSample(shelf, hp, x) {
    shelf.x = x;
    hp.x = cpBqStep(shelf, shelf.coef);
    return cpBqStep(hp, hp.coef);
}

function cpKCoefs(sr) {
    return { shelf: cpBiquadCoefShelf(sr), hp: cpBiquadCoefHp(sr) };
}

function cpLufs(ms) {
    if (!(ms > 1e-12)) return -120;
    return -0.691 + 10 * Math.log10(ms);
}

function CpMeter(sr) {
    this.sr = sr > 0 ? sr : 48000;
    this.momN = Math.max(1, Math.round(0.4 * this.sr / CLIP_BLOCK));
    this.reset();
}

CpMeter.prototype.reset = function () {
    this.kIn = [];
    this.kOut = [];
    this.msIn = [];
    this.msOut = [];
    this.pkIn = 0;
    this.pkOut = 0;
    this.histIn = new Float64Array(1400);
    this.histOut = new Float64Array(1400);
    this.absIn = 0;
    this.absOut = 0;
    this.absNIn = 0;
    this.absNOut = 0;
};

CpMeter.prototype._pushOne = function (ring, v) {
    ring.push(v);
    if (ring.length > this.momN) ring.shift();
};

CpMeter.prototype._gate = function (hist, absSum, absN, ms) {
    var l = cpLufs(ms);
    var nextSum = absSum;
    var nextN = absN;
    if (l > -70 && l < 60) {
        var bin = Math.round((l + 70) / 0.1);
        if (bin < 0) bin = 0;
        if (bin >= hist.length) bin = hist.length - 1;
        hist[bin] += 1;
        nextSum += ms;
        nextN += 1;
    }
    return [nextSum, nextN];
};

CpMeter.prototype.push = function (kIn, kOut, msIn, msOut, pkIn, pkOut) {
    this._pushOne(this.kIn, kIn);
    this._pushOne(this.kOut, kOut);
    this._pushOne(this.msIn, msIn);
    this._pushOne(this.msOut, msOut);
    if (pkIn > this.pkIn) this.pkIn = pkIn;
    if (pkOut > this.pkOut) this.pkOut = pkOut;
    var a = this._gate(this.histIn, this.absIn, this.absNIn, kIn);
    this.absIn = a[0];
    this.absNIn = a[1];
    var b = this._gate(this.histOut, this.absOut, this.absNOut, kOut);
    this.absOut = b[0];
    this.absNOut = b[1];
};

function cpMean(ring) {
    if (!ring.length) return 0;
    var s = 0;
    var i;
    for (i = 0; i < ring.length; i++) s += ring[i];
    return s / ring.length;
}

CpMeter.prototype.momentary = function () {
    return [cpLufs(cpMean(this.kIn)), cpLufs(cpMean(this.kOut))];
};

CpMeter.prototype.rms = function () {
    return [cpLufs(cpMean(this.msIn)) + 0.691, cpLufs(cpMean(this.msOut)) + 0.691];
};

CpMeter.prototype.peak = function () {
    return [cpLinToDb(this.pkIn), cpLinToDb(this.pkOut)];
};

CpMeter.prototype._integrated = function (hist, absSum, absN) {
    if (absN < 1) return -120;
    var ungated = cpLufs(absSum / absN);
    var rel = ungated - 10;
    var sum = 0;
    var n = 0;
    var i;
    for (i = 0; i < hist.length; i++) {
        if (hist[i] <= 0) continue;
        var l = -70 + i * 0.1;
        if (l < rel) continue;
        var ms = Math.pow(10, (l + 0.691) / 10);
        sum += hist[i] * ms;
        n += hist[i];
    }
    if (n < 1) return ungated;
    return cpLufs(sum / n);
};

CpMeter.prototype.integrated = function () {
    return [this._integrated(this.histIn, this.absIn, this.absNIn), this._integrated(this.histOut, this.absOut, this.absNOut)];
};

// ---- STFT (same Hann overlap-add as cepstrum_lib: hop N/4, synthesis 2/3, latency N-1) ----

function cpHann(n) {
    var w = new Float64Array(n);
    var i;
    for (i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    return w;
}

function cpFft(re, im, inv) {
    var n = re.length;
    var i, j, bit, len, ang, wlenRe, wlenIm, wr, wi, s, k, a, b, tr, ti, nwr;
    j = 0;
    for (i = 1; i < n; i++) {
        bit = n >> 1;
        while (j & bit) {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if (i < j) {
            tr = re[i]; re[i] = re[j]; re[j] = tr;
            tr = im[i]; im[i] = im[j]; im[j] = tr;
        }
    }
    for (len = 2; len <= n; len <<= 1) {
        ang = (inv ? 2 : -2) * Math.PI / len;
        wlenRe = Math.cos(ang);
        wlenIm = Math.sin(ang);
        for (s = 0; s < n; s += len) {
            wr = 1;
            wi = 0;
            for (k = 0; k < (len >> 1); k++) {
                a = s + k;
                b = a + (len >> 1);
                tr = re[b] * wr - im[b] * wi;
                ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                nwr = wr * wlenRe - wi * wlenIm;
                wi = wr * wlenIm + wi * wlenRe;
                wr = nwr;
            }
        }
    }
    if (inv) {
        for (i = 0; i < n; i++) {
            re[i] /= n;
            im[i] /= n;
        }
    }
}

function CpStft(n) {
    this.n = n;
    this.win = cpHann(n);
    this.ring = new Float64Array(n);
    this.acc = new Float64Array(n);
    this.wp = 0;
    this.cnt = 0;
    this.primed = false;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.frm = new Float64Array(n);
}

// Returns the overlap-add output for this input sample. `hop(frame, re, im)` may replace `re`
// with the time-domain frame to overlap-add (length n). It runs only when a hop completes.
CpStft.prototype.step = function (x, hop) {
    var n = this.n;
    if (!this.primed) {
        this.primed = true;
    }
    this.ring[this.wp] = x;
    this.wp += 1;
    if (this.wp >= n) this.wp = 0;
    this.cnt += 1;
    if (this.cnt >= n * 0.25) {
        this.cnt = 0;
        var wp = this.wp;
        var i, j;
        for (i = 0; i < n; i++) {
            j = wp + i;
            if (j >= n) j -= n;
            this.frm[i] = this.ring[j] * this.win[i];
            this.re[i] = this.frm[i];
            this.im[i] = 0;
        }
        if (hop) hop(this.frm, this.re, this.im);
        for (i = 0; i < n; i++) {
            j = wp + i;
            if (j >= n) j -= n;
            this.acc[j] += this.re[i] * this.win[i] * (2 / 3);
        }
    }
    var y = this.acc[this.wp];
    this.acc[this.wp] = 0;
    return y;
};

// Spectral hop: clip loud bins, keep quiet ones, small-signal gain matches the waveshaper.
function cpSpectralHop(frm, re, im, driveDb, shapePct, symPct, ceilLin) {
    var n = frm.length;
    var g = cpDriveGain(driveDb);
    var c = ceilLin > 1e-6 ? ceilLin : 1e-6;
    var thresh = c / (g > 1e-8 ? g : 1e-8);
    var i, mag, amp, w, body, det;
    cpFft(re, im, false);
    var wre = new Float64Array(n);
    var wim = new Float64Array(n);
    for (i = 0; i < n; i++) {
        mag = Math.hypot(re[i], im[i]);
        amp = mag * 4 / n;
        w = cpBody(amp, thresh);
        wre[i] = re[i] * w;
        wim[i] = im[i] * w;
    }
    for (i = 0; i < n; i++) {
        re[i] = wre[i];
        im[i] = wim[i];
    }
    cpFft(re, im, true);
    for (i = 0; i < n; i++) {
        body = re[i];
        det = frm[i] - body;
        re[i] = cpCurve(body, driveDb, shapePct, symPct, ceilLin) + g * det;
        im[i] = 0;
    }
}

function CpChannel(sr) {
    this.sr = sr;
    this.stft = new CpStft(CLIP_N);
    this.osUp = new Float64Array(CLIP_FIR_N);
    this.osDn = new Float64Array(CLIP_FIR_N);
    this.tpUp = new Float64Array(CLIP_FIR_N);
    this.tpHold = 0;
    this.coef = cpFirTable();
    this.osMem = new Float64Array(64);
    this.osW = 0;
    this.alMem = new Float64Array(2048);
    this.alW = 0;
    this.tpMem = new Float64Array(64);
    this.tpW = 0;
    this.dcX = 0;
    this.dcY = 0;
    this.shelf = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: cpBiquadCoefShelf(sr) };
    this.hp = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: cpBiquadCoefHp(sr) };
}

// Peak of one 4x upsample (the analysis half of the oversampler). A near-Nyquist
// square can read far above its samples; the true-peak stage turns the delayed
// signal down until this peak sits on the ceiling.
function cpTpPeak(up, coef, x) {
    var n = coef.length;
    var peak = 0;
    var p, i, acc, ins, a;
    for (p = 0; p < 4; p++) {
        ins = p === 0 ? x * 4 : 0;
        for (i = n - 1; i >= 1; i--) up[i] = up[i - 1];
        up[0] = ins;
        acc = 0;
        for (i = 0; i < n; i++) acc += up[i] * coef[i];
        a = acc < 0 ? -acc : acc;
        if (a > peak) peak = a;
    }
    return peak;
}

function cpDcStep(ch, x, on) {
    var r = Math.exp(-2 * Math.PI * 15 / ch.sr);
    var y = x - ch.dcX + r * ch.dcY;
    ch.dcX = x;
    ch.dcY = y;
    return on ? y : x;
}

// One channel, parameters already in engine units. Returns { spec, wave, wet } where wet is
// post limit / true-peak / makeup (pre delta, pre bypass).
function cpChannelStep(ch, x, p) {
    var inG = cpDbToLin(p.inDb);
    var ceilLin = cpDbToLin(p.ceilDb);
    var outG = cpDbToLin(p.outDb);
    var drive = p.driveDb;
    var xs = cpDcStep(ch, x, p.dcon) * inG;
    var self = ch;
    var shaped = p.oson
        ? cpOsProcess(ch.osUp, ch.osDn, ch.coef, xs, function (v) { return cpCurve(v, drive, p.shapePct, p.symPct, ceilLin); })
        : cpCurve(xs, drive, p.shapePct, p.symPct, ceilLin);
    ch.osW = cpDelayWrite(ch.osMem, ch.osW, shaped);
    var wave = p.oson ? shaped : cpDelayRead(ch.osMem, ch.osW, CLIP_OS_DELAY);
    var align = CLIP_STFT_LAT - CLIP_OS_DELAY;
    ch.alW = cpDelayWrite(ch.alMem, ch.alW, wave);
    var waveAl = cpDelayRead(ch.alMem, ch.alW, align);
    var spec = ch.stft.step(xs, function (frm, re, im) {
        cpSpectralHop(frm, re, im, drive, p.shapePct, p.symPct, ceilLin);
    });
    var det = p.detailPct / 100;
    if (det < 0) det = 0;
    if (det > 1) det = 1;
    var mixed = waveAl * (1 - det) + spec * det;
    var post = p.hlim ? (mixed < -ceilLin ? -ceilLin : (mixed > ceilLin ? ceilLin : mixed)) : mixed;
    var rel = Math.exp(-1 / (0.02 * ch.sr));
    var pk = p.tpeak ? cpTpPeak(ch.tpUp, ch.coef, post) : 0;
    ch.tpHold = Math.max(pk, ch.tpHold * rel);
    var gTp = p.tpeak && ch.tpHold > ceilLin ? ceilLin / ch.tpHold : 1;
    ch.tpW = cpDelayWrite(ch.tpMem, ch.tpW, post);
    var limited = cpDelayRead(ch.tpMem, ch.tpW, CLIP_TP_DELAY) * gTp;
    var mk = p.autog ? (1 / (inG > 1e-8 ? inG : 1e-8)) : outG;
    var wet = limited * mk;
    return { x: xs, spec: spec, wave: waveAl, wet: wet, pre: limited, driven: xs * cpDriveGain(drive) };
}

function CpEngine(sr) {
    this.sr = sr || 48000;
    this.L = new CpChannel(this.sr);
    this.R = new CpChannel(this.sr);
    this.dryL = new Float64Array(4096);
    this.dryR = new Float64Array(4096);
    this.dryW = 0;
    this.kShelfL = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: cpBiquadCoefShelf(this.sr) };
    this.kHpL = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: cpBiquadCoefHp(this.sr) };
    this.kShelfR = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: cpBiquadCoefShelf(this.sr) };
    this.kHpR = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: cpBiquadCoefHp(this.sr) };
    this.kShelfLo = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: cpBiquadCoefShelf(this.sr) };
    this.kHpLo = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: cpBiquadCoefHp(this.sr) };
    this.kShelfRo = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: cpBiquadCoefShelf(this.sr) };
    this.kHpRo = { x: 0, x1: 0, x2: 0, y1: 0, y2: 0, coef: cpBiquadCoefHp(this.sr) };
}

function cpDefaultParams() {
    return {
        inDb: 0, driveDb: 0, detailPct: 100, shapePct: 0, symPct: 0, ceilDb: 0, outDb: 0,
        on: 1, dlt: 0, dcon: 0, oson: 0, hlim: 1, tpeak: 0, autog: 1,
    };
}

CpEngine.prototype.step = function (xL, xR, p) {
    var L = cpChannelStep(this.L, xL, p);
    var R = cpChannelStep(this.R, xR, p);
    this.dryW = cpDelayWrite(this.dryL, this.dryW, xL);
    this.dryR[this.dryW === 0 ? this.dryL.length - 1 : this.dryW - 1] = xR;
    var dryL = cpDelayRead(this.dryL, this.dryW, CLIP_LATENCY);
    var dryR = cpDelayRead(this.dryR, this.dryW, CLIP_LATENCY);
    var wetL = L.wet;
    var wetR = R.wet;
    var sigL = p.dlt ? dryL - wetL : wetL;
    var sigR = p.dlt ? dryR - wetR : wetR;
    var outL = p.on ? sigL : dryL;
    var outR = p.on ? sigR : dryR;
    return { outL: outL, outR: outR, dryL: dryL, dryR: dryR, wetL: wetL, wetR: wetR, inL: L.x, inR: R.x, preL: L.pre, preR: R.pre, drvL: L.driven, drvR: R.driven };
};

function cpGoertzel(samples, freq, sr) {
    var n = samples.length;
    var w = 2 * Math.PI * freq / sr;
    var cw = Math.cos(w);
    var coeff = 2 * cw;
    var s0 = 0, s1 = 0, s2 = 0;
    var i;
    for (i = 0; i < n; i++) {
        s0 = samples[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    var re = s1 - s2 * cw;
    var im = s2 * Math.sin(w);
    return Math.hypot(re, im) * 2 / n;
}

function cpRender(samplesL, samplesR, p, sr) {
    var eng = new CpEngine(sr || 48000);
    var outL = new Float64Array(samplesL.length);
    var outR = new Float64Array(samplesR.length);
    var i;
    for (i = 0; i < samplesL.length; i++) {
        var y = eng.step(samplesL[i], samplesR ? samplesR[i] : samplesL[i], p);
        outL[i] = y.outL;
        outR[i] = y.outR;
    }
    return { outL: outL, outR: outR, eng: eng };
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        CLIP_N: CLIP_N, CLIP_HOP: CLIP_HOP, CLIP_STFT_LAT: CLIP_STFT_LAT, CLIP_FIR_N: CLIP_FIR_N,
        CLIP_OS_DELAY: CLIP_OS_DELAY, CLIP_TP_DELAY: CLIP_TP_DELAY, CLIP_LATENCY: CLIP_LATENCY,
        CLIP_SCOPE: CLIP_SCOPE, CLIP_WAVE_BASE: CLIP_WAVE_BASE, CLIP_WAVE_FRAMES: CLIP_WAVE_FRAMES,
        CLIP_SCATTER: CLIP_SCATTER, CLIP_METER_BASE: CLIP_METER_BASE, CLIP_METER_FRAMES: CLIP_METER_FRAMES,
        CLIP_BLOCK: CLIP_BLOCK,
        cpDbToLin: cpDbToLin, cpLinToDb: cpLinToDb, cpCurve: cpCurve, cpDriveGain: cpDriveGain, cpClipGrDb: cpClipGrDb, cpBlockGrDb: cpBlockGrDb, cpBody: cpBody,
        cpFirRaw: cpFirRaw, cpFirCoef: cpFirCoef, cpFirTable: cpFirTable, cpOsProcess: cpOsProcess, cpTpPeak: cpTpPeak,
        cpBiquadCoefShelf: cpBiquadCoefShelf, cpBiquadCoefHp: cpBiquadCoefHp, cpKWeightSample: cpKWeightSample,
        cpLufs: cpLufs, CpMeter: CpMeter, cpHann: cpHann, cpFft: cpFft, CpStft: CpStft, cpSpectralHop: cpSpectralHop,
        CpEngine: CpEngine, cpDefaultParams: cpDefaultParams, cpRender: cpRender, cpGoertzel: cpGoertzel,
        cpDelayWrite: cpDelayWrite, cpDelayRead: cpDelayRead,
    };
}
