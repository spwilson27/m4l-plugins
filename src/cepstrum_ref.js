"use strict";
// Node (CommonJS) reference for src/cepstrum_lib.genexpr. Same math, same
// sample-by-sample STFT structure, so device unit tests can predict what the
// gen code does. Complex data is two Float64Arrays (re, im).

const MAX_N = 4096;

// Snap a requested size to a power of two in 512..4096 (cep_n).
function snapN(req) {
    const k = Math.min(12, Math.max(9, Math.round(Math.log2(Math.max(req, 1)))));
    return 2 ** k;
}

// Naive O(N^2) DFT for tests. sign = -1 forward, +1 inverse (unscaled).
function dft(re, im, sign) {
    const n = re.length;
    const or = new Float64Array(n);
    const oi = new Float64Array(n);
    for (let k = 0; k < n; k++) {
        let sr = 0;
        let si = 0;
        for (let t = 0; t < n; t++) {
            const a = (sign * 2 * Math.PI * ((k * t) % n)) / n;
            const c = Math.cos(a);
            const s = Math.sin(a);
            sr += re[t] * c - im[t] * s;
            si += re[t] * s + im[t] * c;
        }
        or[k] = sr;
        oi[k] = si;
    }
    return { re: or, im: oi };
}

const TW_CACHE = new Map();
function twiddles(n) {
    let t = TW_CACHE.get(n);
    if (!t) {
        t = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
        for (let k = 0; k < n / 2; k++) {
            t.c[k] = Math.cos((2 * Math.PI * k) / n);
            t.s[k] = Math.sin((2 * Math.PI * k) / n);
        }
        TW_CACHE.set(n, t);
    }
    return t;
}

// In-place iterative radix-2 FFT (fft_run). inverse scales by 1 / n.
function fft(re, im, inverse) {
    const n = re.length;
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error("fft length must be a power of two");
    let bits = 0;
    while (1 << bits < n) bits++;
    for (let i = 0; i < n; i++) {
        let j = 0;
        for (let b = 0; b < bits; b++) j |= ((i >> b) & 1) << (bits - 1 - b);
        if (j > i) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    const sgn = inverse ? 1 : -1;
    const tw = twiddles(n);
    for (let len = 2; len <= n; len *= 2) {
        const half = len / 2;
        const stride = n / len;
        for (let s = 0; s < n; s += len) {
            for (let k = 0; k < half; k++) {
                const wr = tw.c[k * stride];
                const wi = sgn * tw.s[k * stride];
                const p = s + k;
                const q = p + half;
                const tr = re[q] * wr - im[q] * wi;
                const ti = re[q] * wi + im[q] * wr;
                re[q] = re[p] - tr;
                im[q] = im[p] - ti;
                re[p] += tr;
                im[p] += ti;
            }
        }
    }
    if (inverse) {
        for (let i = 0; i < n; i++) {
            re[i] /= n;
            im[i] /= n;
        }
    }
}

// Periodic Hann window (stft_win).
function hann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    return w;
}

// Streaming STFT, hop n / 4, Hann analysis and synthesis, scale 2/3.
// process(re, im) edits the spectrum of each frame in place. push(x) returns
// the output sample, delayed by latency() = n - 1 samples.
class Stft {
    constructor(n, process) {
        this.n = n;
        this.process = process || null;
        this.win = hann(n);
        this.ring = new Float64Array(n);
        this.acc = new Float64Array(n);
        this.wp = 0;
        this.cnt = 0;
        this.re = new Float64Array(n);
        this.im = new Float64Array(n);
    }

    static latency(n) {
        return n - 1;
    }

    push(x) {
        const n = this.n;
        this.ring[this.wp] = x;
        this.wp = (this.wp + 1) % n;
        this.cnt++;
        if (this.cnt >= n / 4) {
            this.cnt = 0;
            for (let i = 0; i < n; i++) {
                this.re[i] = this.ring[(this.wp + i) % n] * this.win[i];
                this.im[i] = 0;
            }
            fft(this.re, this.im, false);
            if (this.process) this.process(this.re, this.im);
            fft(this.re, this.im, true);
            for (let i = 0; i < n; i++) {
                const j = (this.wp + i) % n;
                this.acc[j] += this.re[i] * this.win[i] * (2 / 3);
            }
        }
        const y = this.acc[this.wp];
        this.acc[this.wp] = 0;
        return y;
    }

    run(signal) {
        const out = new Float64Array(signal.length);
        for (let i = 0; i < signal.length; i++) out[i] = this.push(signal[i]);
        return out;
    }
}

// Real cepstrum c = IFFT(log(|X| + eps)) of a complex spectrum (cep_from_spec).
function realCepstrum(xr, xi, eps) {
    const n = xr.length;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.log(Math.hypot(xr[i], xi[i]) + eps);
    fft(re, im, true);
    return re;
}

// Cepstrum (real array or {re, im}) -> complex log spectrum (cep_to_logmag).
function cepToLogSpec(c) {
    const re = Float64Array.from(c.re || c);
    const im = c.im ? Float64Array.from(c.im) : new Float64Array(re.length);
    fft(re, im, false);
    return { re, im };
}

// Minimum-phase fold: c[0], 2c[i] for 0 < i < n/2, c[n/2], 0 above.
function foldMinPhase(c) {
    const n = c.length;
    const out = new Float64Array(n);
    out[0] = c[0];
    for (let i = 1; i < n / 2; i++) out[i] = 2 * c[i];
    out[n / 2] = c[n / 2];
    return out;
}

// Maximum-phase fold: the minimum-phase one mirrored, c_max[i] = c_min[n - i].
function foldMaxPhase(c) {
    const n = c.length;
    const mn = foldMinPhase(c);
    const out = new Float64Array(n);
    out[0] = mn[0];
    out[n / 2] = mn[n / 2];
    for (let i = 1; i < n / 2; i++) out[n - i] = mn[i];
    return out;
}

// exp of a complex log spectrum, minus eps from the magnitude (cep_exp_spec).
function expSpec(logRe, logIm, eps) {
    const n = logRe.length;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const m = Math.max(Math.exp(logRe[i]) - eps, 0);
        re[i] = m * Math.cos(logIm[i]);
        im[i] = m * Math.sin(logIm[i]);
    }
    return { re, im };
}

// Put the magnitude exp(logRe) - eps on the phase of (xr, xi) (cep_remag).
function remag(xr, xi, logRe, eps) {
    const n = xr.length;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const mag = Math.hypot(xr[i], xi[i]);
        const m = Math.max(Math.exp(logRe[i]) - eps, 0);
        if (mag > 1e-20) {
            re[i] = (xr[i] * m) / mag;
            im[i] = (xi[i] * m) / mag;
        } else {
            re[i] = m;
        }
    }
    return { re, im };
}

// Whole-frame min-phase transform: same magnitude, minimum-phase spectrum.
function minPhaseSpectrum(xr, xi, eps) {
    const folded = foldMinPhase(realCepstrum(xr, xi, eps));
    const ls = cepToLogSpec(folded);
    return expSpec(ls.re, ls.im, eps);
}

// Cepstral pitch peak (cep_peak, cep_peak_conf, cep_peak_refine): argmax of
// c over [lo, hi] samples, z-score confidence 0..1 and parabolic quefrency.
function pitchPeak(c, lo, hi) {
    let q = lo;
    for (let i = lo; i <= hi; i++) if (c[i] > c[q]) q = i;
    const cnt = hi - lo + 1;
    let sm = 0;
    let sq = 0;
    for (let i = lo; i <= hi; i++) {
        sm += c[i];
        sq += c[i] * c[i];
    }
    const mu = sm / cnt;
    const sd = Math.sqrt(Math.max(sq / cnt - mu * mu, 1e-20));
    const conf = Math.min(1, Math.max(0, ((c[q] - mu) / sd - 3) / 7));
    const a = c[q - 1];
    const b = c[q];
    const d = c[q + 1];
    const den = a - 2 * b + d;
    const frac = Math.abs(den) > 1e-20 ? Math.min(0.5, Math.max(-0.5, (0.5 * (a - d)) / den)) : 0;
    return { q, conf, qFrac: q + frac };
}

module.exports = {
    MAX_N,
    snapN,
    dft,
    fft,
    hann,
    Stft,
    realCepstrum,
    cepToLogSpec,
    foldMinPhase,
    foldMaxPhase,
    expSpec,
    remag,
    minPhaseSpectrum,
    pitchPeak,
};
