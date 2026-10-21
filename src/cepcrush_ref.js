"use strict";
// Node reference for the cepstral crusher (ported from the retired Quefrency Crush device), built on
// src/cepstrum_ref.js. Glitch's Cepstral Crush / Scramble mirror it (src/glitch_ref.js, tests/test_glitch.js).

const ref = require("./cepstrum_ref.js");

const EPS = 1e-9;
const NC = 96; // coefficients in the telemetry
const UP_NEPERS = 3.45;
const DOWN_NEPERS = 8;
const HOLD_RATES = ["Off", "1/32", "1/16", "1/8", "1/4", "1/2", "1 bar"];
const SCRAMBLE_MODES = ["Off", "Rev", "Shuf", "Rot"];
const GLITCH_MODES = ["Off", "Drop", "Rpt", "Rev", "Hold", "Frz"];
const GLITCH_RATES = ["1/32", "1/16", "1/8", "1/4", "1/2", "1 bar"];
const PHASE_MODES = ["Orig", "Robot", "Whisp", "Min"];

// ---- Glitch / Lag / Phase constants (from the retired Quefrency Crush core) ----
const RING = 32; // cepstral frames kept per channel (only frames that were "received", see GlitchState)
const STRIDE = 2050; // floats per ring frame: c[0..N/2] for N up to 4096
const LAG_MAX = 12; // Lag 100 %: the slowest coefficient arrives 12 frames late
const W_MAX = 8; // Repeat / Reverse loop at most this many frames
const DROP_RUN_MAX = 40; // after this many lost frames in a row the held frame is exactly silent (0.5^40 = -241 dB); avoids a denormal tail
const DROP_FADE = 0.5; // a dropped frame is held at 0.5^k after k lost frames in a row (packet loss concealment)
const FLOOR_REL = Math.pow(10, -50 / 20); // Min phase: log floor 50 dB under the frame's peak magnitude
const LIM_DB = 8; // Min phase crest limiter: a frame may be at most this much spikier than the input frame
const LIM_STEPS = 8;
const AGC_POLE = 0.25; // per-frame one-pole of the smoothed input / output frame energies
const AGC_MIN = 0.25;
const AGC_MAX = 4;
// Level match per Phase mode (Orig, Robot, Whisp, Min): re-phased frames add as powers, not as amplitudes; calibrated
// against Orig on speech-like, noise and sine material (from the retired Quefrency Crush tests).
const PHASE_K = [1, 1.45, 1.41, 1.1];

function clip(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// Formant quefrency (2 ms) in samples, 16..96.
function formantQ(sr) {
    return clip(Math.round(sr * 0.002), 16, 96);
}

// Coefficients kept for Coeffs 0..1 at FFT size n: 2 .. Qs logarithmically over the first 75 % of the knob, Qs .. n/2
// linearly over the last 25 % (the pitch comb returns there). 1 = all of them (neutral).
function coeffsKept(cf, n, sr) {
    const c = clip(cf, 0, 1);
    const qs = formantQ(sr || 44100);
    if (c >= 0.995) return n / 2;
    return c < 0.75 ? 2 * Math.pow(qs / 2, c / 0.75) : qs + ((n / 2 - qs) * (c - 0.75)) / 0.25;
}

function quantStep(bits) {
    return 1.5 * Math.pow(2, -(bits - 1) * 0.75);
}

function holdBeats(idx) {
    return idx < 0.5 ? 1 : Math.pow(2, Math.round(idx) - 4);
}

// Smooth 0..1 crossover between envelope (q well below qs) and excitation (q well above).
function hi(q, qs) {
    const w = Math.max(qs * 0.25, 1);
    const t = clip((q - (qs - w)) / (2 * w), 0, 1);
    return t * t * (3 - 2 * t);
}

// Seeded Fisher-Yates permutation of 1..r (pm[1..r]), the same hash as qc_perm.
function perm(r, seed) {
    const pm = new Float64Array(r + 2);
    for (let i = 1; i <= r; i++) pm[i] = i;
    for (let t = 0; t < r - 1; t++) {
        const i = r - t;
        const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
        let j = 1 + Math.floor((v - Math.floor(v)) * i);
        j = Math.min(j, i);
        const a = pm[i];
        pm[i] = pm[j];
        pm[j] = a;
    }
    return pm;
}

function isNeutral(o) {
    const n = o.n;
    const kq = coeffsKept(o.coeffs, n, o.sr);
    const scr = o.smode > 0.5 && o.samt > 0.001;
    return kq >= n / 2 - 0.5 && o.bits >= 15.5 && !scr && Math.abs(o.shift) < 0.005 && !o.useHold && !fxActive(o);
}

// Any of the Glitch (Drop / Rpt / Rev), Phase or Lag features on.
function fxActive(o) {
    return (o.glitch | 0) > 0 || (o.pmode | 0) > 0 || o.lag > 0.001;
}

function frac(x) {
    return x - Math.floor(x);
}

// Seeded hash in 0..1 (the GenExpr qc_hash).
function hash(x, a) {
    return frac(Math.sin(x * 12.9898 + a) * 43758.5453);
}

// Lag: coefficient q is read s(q) of the way back through the frame ring. s mixes an index ramp (low coefficients
// first) with a fixed seeded spread, so timbre changes smear and arrive out of sync.
function lagSpread(q) {
    return 0.5 * Math.min(1, (q - 1) / 127) + 0.5 * hash(q, 4.1414);
}

// Frames of delay of coefficient q at Lag lag (0..1). q = 0 (level) is never delayed.
function lagDelay(q, lag) {
    return q < 1 ? 0 : Math.floor(LAG_MAX * lag * lagSpread(q) + 0.5);
}

// Slot length in beats of Rate index 0..5 (1/32 .. 1 bar).
function glitchBeats(ridx) {
    return Math.pow(2, Math.round(ridx) - 3);
}

// Glitch slot s (an absolute grid index, so the host position decides) fires with probability prob.
function slotActive(gidx, prob) {
    return hash(gidx, 9.1) < prob;
}

// Frames in the Repeat / Reverse window: half a slot, 1..8.
function glitchWindow(ridx, bpm, sr, n) {
    const slotFrames = (glitchBeats(ridx) * 60 / Math.max(bpm, 20) * sr) / (n * 0.25);
    return clip(Math.round(slotFrames * 0.5), 1, W_MAX);
}

// Seed of the Whisper phases: the host-locked hop index (same frame, same noise on every render).
function whisperSeed(beat, bpm, sr, n, ch) {
    const f = Math.floor(((beat * 60 * sr) / Math.max(bpm, 20)) / (n * 0.25));
    return f - 65536 * Math.floor(f / 65536) + ch * 77;
}

// Event history: 12 two-bit codes per float (exact in float32), newest in the low bits of h[0], carry into h[1].
function packHist(h, code) {
    const top = Math.floor(h[0] / 4194304);
    const a = (h[0] - top * 4194304) * 4 + code;
    const b = (h[1] - Math.floor(h[1] / 4194304) * 4194304) * 4 + top;
    return [a, b];
}

function unpackHist(h, age) {
    const v = age < 12 ? h[0] : h[1];
    return Math.floor(v / Math.pow(4, age % 12)) % 4;
}

// Frame ring + glitch / lag source selection of one channel (qc_select). The ring holds only frames that were
// "received": while a Drop / Repeat / Reverse slot is active the live frame is not stored, so the ring is frozen
// and Repeat / Reverse loop over the last W received frames, Drop holds the last good one. Phase is never stored:
// the live phase keeps moving, so a repeated spectrum does not click.
class GlitchState {
    constructor() {
        this.ring = new Float64Array(RING * STRIDE);
        this.nSeen = 0;
        this.reset();
    }

    reset() {
        this.ft = 0; // frames stored
        this.vcnt = 0; // valid frames in the ring (<= RING)
        this.chSlot = -999999;
        this.j = 0; // frames since the slot started
        this.lostRun = 0;
    }

    // c: real cepstrum (length n), replaced in place over 0..n/2 by the selected, lagged frame.
    // o: {n, glitch 0..3, act, slot, W, lag}. Returns {code 0..3, gain, pos}.
    select(c, o) {
        const n = o.n;
        const half = n / 2;
        if (n !== this.nSeen) {
            this.nSeen = n;
            this.reset();
        }
        const lagOn = o.lag > 0.001;
        const mode = o.glitch | 0;
        let code = 0;
        let gain = 1;
        let pos = 0;
        if (mode < 1 && !lagOn) {
            this.vcnt = 0;
            this.lostRun = 0;
            return { code, gain, pos };
        }
        if (o.slot !== this.chSlot) {
            this.chSlot = o.slot;
            this.j = 0;
        }
        const active = mode > 0 && !!o.act && this.vcnt >= 1;
        if (!active) {
            const base = (this.ft - 32 * Math.floor(this.ft / 32)) * STRIDE;
            for (let q = 0; q <= half; q++) this.ring[base + q] = c[q];
            this.ft += 1;
            this.vcnt = Math.min(this.vcnt + 1, RING);
            this.lostRun = 0;
        }
        const nw = this.ft - 1;
        let tau = nw;
        if (active) {
            const wc = Math.max(1, Math.min(o.W, this.vcnt));
            const jm = this.j - wc * Math.floor(this.j / wc);
            if (mode === 1) {
                code = 1;
                this.lostRun += 1;
                gain = this.lostRun > DROP_RUN_MAX ? 0 : Math.pow(DROP_FADE, this.lostRun);
            } else if (mode === 2) {
                code = 2;
                tau = nw - (wc - 1) + jm;
                pos = jm;
            } else {
                code = 3;
                tau = nw - jm;
                pos = jm;
            }
            if (mode !== 1) this.lostRun = 0;
            this.j += 1;
        }
        if (lagOn || active) {
            const oldest = nw - (this.vcnt - 1);
            for (let q = 0; q <= half; q++) {
                const d = lagOn ? lagDelay(q, o.lag) : 0;
                const idx = Math.max(tau - d, oldest);
                c[q] = this.ring[(idx - 32 * Math.floor(idx / 32)) * STRIDE + q];
            }
        }
        return { code, gain, pos };
    }
}

// ---- Phase modes ----

// Zero phase (the pulse is moved to the frame centre by the (-1)^k linear phase): a monotone buzz at the hop rate.
function robotSpectrum(re, im) {
    const n = re.length;
    for (let k = 0; k < n; k++) {
        const mag = Math.hypot(re[k], im[k]);
        re[k] = (k & 1) ? -mag : mag;
        im[k] = 0;
    }
}

// Random phase per bin and frame (Hermitian: bin n-k is the conjugate of bin k).
function whisperSpectrum(re, im, seed) {
    const n = re.length;
    const half = n / 2;
    const a = seed * 78.233;
    for (let k = 1; k < half; k++) {
        const mag = Math.hypot(re[k], im[k]);
        const th = 6.283185307179586 * hash(k, a);
        const cr = mag * Math.cos(th);
        const ci = mag * Math.sin(th);
        re[k] = cr;
        im[k] = ci;
        re[n - k] = cr;
        im[n - k] = -ci;
    }
    re[0] = Math.hypot(re[0], im[0]);
    re[half] = Math.hypot(re[half], im[half]);
    im[0] = 0;
    im[half] = 0;
}

// Signed moving-sum peak of the windowed input frame (window n/64, centred): where the frame's sharpest event is.
function findPivot(prof) {
    const n = prof.length;
    const L = Math.max(8, Math.round(n / 64));
    let s = 0;
    let best = -1e30;
    let bi = n * 0.5;
    for (let i = 0; i < n; i++) {
        s += prof[i];
        if (i >= L) s -= prof[i - L];
        if (i >= L - 1 && s > best) {
            best = s;
            bi = i - Math.floor(L * 0.5);
        }
    }
    return bi;
}

function crestOf(z, n) {
    let m = 0;
    let e = 0;
    for (let i = 0; i < n; i++) {
        const a = Math.abs(z[i]);
        if (a > m) m = a;
        e += z[i] * z[i];
    }
    return m / Math.sqrt(e / n + 1e-30);
}

// Minimum-phase frame for the crushed log spectrum L (n bins, log|X'| + EPS): the cepstrum of the floored log
// magnitude is folded causal, evaluated on a zero-padded 2N grid (so the tail of a narrow-band response is dropped
// instead of wrapped into the frame), delayed to the input frame's pivot, truncated to N, and blended toward the
// input frame until it is at most LIM_DB spikier than it. Returns the time frame before the synthesis window.
function minPhaseFrame(L, xw, win) {
    const n = L.length;
    const half = n / 2;
    const m2 = n * 2;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
        const mg = Math.max(Math.exp(L[i]) - EPS, 0);
        re[i] = mg;
        if (mg > peak) peak = mg;
    }
    const epsr = Math.max(peak * FLOOR_REL, EPS);
    for (let i = 0; i < n; i++) re[i] = Math.log(re[i] + epsr);
    ref.fft(re, im, true);
    const zr = new Float64Array(m2);
    const zi = new Float64Array(m2);
    zr[0] = re[0];
    for (let q = 1; q < half; q++) zr[q] = 2 * re[q];
    zr[half] = re[half];
    ref.fft(zr, zi, false);
    const t0 = findPivot(xw);
    const yr = new Float64Array(m2);
    const yi = new Float64Array(m2);
    for (let k = 0; k < m2; k++) {
        const mg = Math.max(Math.exp(zr[k]) - epsr, 0);
        const a = zi[k] - (6.283185307179586 * ((k * t0) % m2)) / m2;
        yr[k] = mg * Math.cos(a);
        yi[k] = mg * Math.sin(a);
    }
    ref.fft(yr, yi, true);
    const zo = new Float64Array(n);
    for (let i = 0; i < n; i++) zo[i] = xw[i] * win[i];
    const lim = crestOf(zo, n) * Math.pow(10, LIM_DB / 20);
    const z = new Float64Array(n);
    let b = 1;
    for (let s = 0; s <= LIM_STEPS; s++) {
        const bb = s / LIM_STEPS;
        for (let i = 0; i < n; i++) z[i] = (1 - bb) * yr[i] * win[i] + bb * zo[i];
        if (crestOf(z, n) <= lim) {
            b = bb;
            break;
        }
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = (1 - b) * yr[i] + b * xw[i];
    return { y, blend: b, pivot: t0 };
}


// The crusher. c: real cepstrum (length n, even). hold: {env: Float64Array(256), valid} state shared across frames.
// o: {n, sr, coeffs, bits, smode, samt, shift (st), useHold, capture, roll}.
// Returns the crushed, mirrored cepstrum (length n).
function crushCepstrum(c, o, hold) {
    const n = o.n;
    const half = n / 2;
    const qs = formantQ(o.sr);
    const w = Math.max(qs * 0.25, 1);
    const qe = Math.min(Math.floor(qs + w) + 1, half - 1);
    const kq = coeffsKept(o.coeffs, n, o.sr);
    const rr = Math.max(2, Math.min(Math.floor(kq), Math.floor(qs)));
    const smode = Math.round(clip(o.smode, 0, 3));
    const samt = clip(o.samt, 0, 1);
    const rho = Math.pow(2, clip(o.shift, -12, 12) / 12);
    const bits = clip(Math.round(o.bits), 1, 16);
    const cn = new Float64Array(half + 2);
    cn[0] = c[0];
    for (let q = 1; q <= qe; q++) {
        let ev = c[q] * (1 - hi(q, qs));
        if (o.capture) hold.env[q] = ev;
        if (o.useHold) ev = hold.env[q];
        cn[q] = ev;
    }
    if (smode > 0.5 && samt > 0.001) {
        const us = new Float64Array(rr + 2);
        for (let q = 1; q <= rr; q++) us[q] = cn[q] * q;
        const pm = smode > 1.5 && smode < 2.5 ? perm(rr, o.roll === undefined ? 1 : o.roll) : null;
        for (let q = 1; q <= rr; q++) {
            const u0 = us[q];
            let u1 = u0;
            if (smode < 1.5) {
                u1 = us[rr + 1 - q];
            } else if (smode < 2.5) {
                u1 = us[pm[q]];
            } else {
                let p0 = q - 1 - samt * rr * 0.5;
                p0 -= rr * Math.floor(p0 / rr);
                const i0 = Math.floor(p0) + 1;
                const fr = p0 - Math.floor(p0);
                let i1 = i0 + 1;
                if (i1 > rr) i1 = 1;
                u1 = us[i0] * (1 - fr) + us[i1] * fr;
            }
            if (smode < 2.5) u1 = u0 + (u1 - u0) * samt;
            cn[q] = u1 / q;
        }
    }
    const shifting = Math.abs(rho - 1) > 0.0002;
    for (let q = qe + 1; q <= half; q++) cn[q] = 0;
    if (shifting) {
        const inr = 1 / rho;
        for (let s = 1; s <= half; s++) {
            const ex = c[s] * hi(s, qs);
            const dq = s * inr;
            if (dq >= 1) {
                const i0 = Math.floor(dq);
                const fr = dq - i0;
                if (i0 <= half) cn[i0] += ex * (1 - fr);
                if (i0 + 1 <= half) cn[i0 + 1] += ex * fr;
            }
        }
    } else {
        for (let q = 1; q <= half; q++) cn[q] += c[q] * hi(q, qs);
    }
    if (kq < half - 0.5) {
        const tw = Math.max(2, kq * 0.2);
        for (let q = 1; q <= half; q++) {
            let g = 0;
            if (q <= kq) {
                g = 1;
                if (q > kq - tw) g = 0.5 + 0.5 * Math.cos((Math.PI * (q - (kq - tw))) / tw);
            }
            cn[q] *= g;
        }
    }
    if (bits < 15.5) {
        const stp = quantStep(bits);
        const inv = 1 / stp;
        for (let q = 1; q <= half; q++) cn[q] = Math.round(cn[q] * inv) * stp;
    }
    const out = new Float64Array(n);
    out[0] = cn[0];
    for (let q = 1; q < half; q++) {
        out[q] = cn[q];
        out[n - q] = cn[q];
    }
    out[half] = cn[half];
    return out;
}

// Apply a crushed cepstrum to a spectrum: magnitude from exp(FFT(c')), original phase, per-bin gain limited, then the
// frame is scaled back to the input frame's energy.
function remagLimited(xr, xi, logRe, eps) {
    const n = xr.length;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    let ein = 0;
    let eout = 0;
    for (let i = 0; i < n; i++) {
        const mag = Math.hypot(xr[i], xi[i]);
        let g = 1;
        if (mag > 1e-20) {
            const d = clip(logRe[i] - Math.log(mag + eps), -DOWN_NEPERS, UP_NEPERS);
            g = Math.max(((mag + eps) * Math.exp(d) - eps) / mag, 0);
        }
        re[i] = xr[i] * g;
        im[i] = xi[i] * g;
        ein += mag * mag;
        eout += mag * mag * g * g;
    }
    let gn = 1;
    if (eout > 1e-30 && ein > 1e-30) gn = clip(Math.sqrt(ein / eout), 0.05, 20);
    if (Math.abs(gn - 1) > 1e-6) {
        for (let i = 0; i < n; i++) {
            re[i] *= gn;
            im[i] *= gn;
        }
    }
    return { re, im, gn };
}

// Process one spectrum frame in place (the Stft callback). Neutral settings leave it alone.
// o adds to the crush options: glitch 0..3 (Off, Drop, Rpt, Rev), act, slot, W (see GlitchState.select), lag 0..1,
// pmode 0..3 (Orig, Robot, Whisp, Min), seed (Whisper). hold is the per-channel state: {env, gl, eiS, eoS}.
// xw: the Hann-windowed input frame (time domain) when the caller has it, else it is recovered from the spectrum.
// Returns {c, cn, code, gain, g, blend} or null when neutral.
function processSpectrum(re, im, o, hold, force, xw) {
    if (!hold.gl) hold.gl = new GlitchState();
    if (!force && isNeutral(o)) {
        hold.gl.vcnt = 0;
        hold.gl.lostRun = 0;
        hold.eiS = 0;
        hold.eoS = 0;
        return null;
    }
    const n = re.length;
    const pm = o.pmode | 0;
    const win = hold.win && hold.win.length === n ? hold.win : (hold.win = ref.hann(n));
    if (pm > 0 && !xw) {
        const tr = Float64Array.from(re);
        const ti = Float64Array.from(im);
        ref.fft(tr, ti, true);
        xw = tr;
    }
    const c = ref.realCepstrum(re, im, EPS);
    const sel = hold.gl.select(c, o);
    const cn = crushCepstrum(c, o, hold);
    const ls = ref.cepToLogSpec(cn);
    let g = 1;
    let blend = 0;
    if (pm === 3) {
        const mf = minPhaseFrame(ls.re, xw, win);
        blend = mf.blend;
        let qi = 0;
        let qo = 0;
        for (let i = 0; i < n; i++) {
            const a = xw[i] * win[i];
            const b = mf.y[i] * win[i];
            qi += a * a;
            qo += b * b;
        }
        g = phaseGain(hold, qi, qo, pm);
        const fr = mf.y;
        const fi = new Float64Array(n);
        ref.fft(fr, fi, false);
        re.set(fr);
        im.set(fi);
    } else {
        const out = remagLimited(re, im, ls.re, EPS);
        if (pm === 1) robotSpectrum(out.re, out.im);
        else if (pm === 2) whisperSpectrum(out.re, out.im, o.seed || 0);
        if (pm > 0) {
            const yr = Float64Array.from(out.re);
            const yi = Float64Array.from(out.im);
            ref.fft(yr, yi, true);
            let qi = 0;
            let qo = 0;
            for (let i = 0; i < n; i++) {
                const a = xw[i] * win[i];
                const b = yr[i] * win[i];
                qi += a * a;
                qo += b * b;
            }
            g = phaseGain(hold, qi, qo, pm);
        } else {
            hold.eiS = 0;
            hold.eoS = 0;
        }
        re.set(out.re);
        im.set(out.im);
    }
    const gt = g * sel.gain;
    if (gt !== 1) {
        for (let i = 0; i < n; i++) {
            re[i] *= gt;
            im[i] *= gt;
        }
    }
    return { c, cn, code: sel.code, pos: sel.pos, gain: sel.gain, g, blend };
}

// Frame-energy level match for the re-phased modes: sqrt of the ratio of the one-poled input and output frame energies.
function phaseGain(hold, qi, qo, pm) {
    hold.eiS = hold.eiS > 1e-20 ? hold.eiS + (qi - hold.eiS) * AGC_POLE : qi;
    hold.eoS = hold.eoS > 1e-20 ? hold.eoS + (qo - hold.eoS) * AGC_POLE : qo;
    if (hold.eiS > 1e-20 && hold.eoS > 1e-20) return clip(Math.sqrt(hold.eiS / hold.eoS) * PHASE_K[pm], AGC_MIN, AGC_MAX);
    return 1;
}

// Mono streaming crusher: push(x) returns the output sample, delayed n - 1 samples. The old option names
// (useHold, capture, roll) still work; glitch / act / slot / W / lag / pmode / seed are passed straight to the frame.
class Crusher {
    constructor(o) {
        this.o = Object.assign({ n: 1024, sr: 44100, coeffs: 1, bits: 16, smode: 0, samt: 0.5, shift: 0, useHold: false, capture: false, roll: 1, glitch: 0, act: false, slot: 0, W: 4, lag: 0, pmode: 0, seed: 0 }, o);
        this.hold = { env: new Float64Array(256) };
        this.frames = [];
        this.force = !!this.o.force;
        this.stft = new ref.Stft(this.o.n, (re, im) => {
            const r = processSpectrum(re, im, this.o, this.hold, this.force);
            if (r) this.frames.push(r);
            this.o.capture = false;
        });
    }

    run(signal) {
        return this.stft.run(signal);
    }
}

// The hold clock of the gen core: free-runs on the tempo, locks to the host position whenever it changes.
class HoldClock {
    constructor() {
        this.beat = 0;
        this.ppqPrev = 0;
        this.lastIdx = 0;
    }

    // One sample. Returns 1 on a tick.
    step(sr, bpm, ppq, hidx) {
        const per = holdBeats(hidx);
        if (ppq !== this.ppqPrev) {
            this.beat = ppq;
            this.ppqPrev = ppq;
        } else {
            this.beat += Math.max(bpm, 20) / (60 * sr);
        }
        const cidx = Math.floor(this.beat / per);
        let tick = 0;
        if (cidx > this.lastIdx) {
            tick = 1;
            this.lastIdx = cidx;
        } else if (cidx < this.lastIdx - 1) {
            this.lastIdx = cidx;
        }
        return tick;
    }
}

// Node twin of the gen core's control block + one channel's frame path (everything except the Delay pad, the
// loudness-match AGC, the soft knee and the mix): Glitch (Off, Drop, Rpt, Rev, Hold, Frz) with its Rate clock,
// Phase mode, Lag, and the crush chain. push(x) returns the wet sample delayed n - 1 samples.
// p: {n, sr, coeffs, bits, smode, samt, shift, gmode 0..5, grate 0..5, pmode 0..3, lag 0..1, bpm, ppq (function of
// the sample index, optional), ch 0|1}. frames[] collects the processSpectrum results.
class DeviceModel {
    constructor(p) {
        this.p = Object.assign({ n: 1024, sr: 44100, coeffs: 1, bits: 16, smode: 0, samt: 0.5, shift: 0, gmode: 0, grate: 1, pmode: 0, lag: 0, bpm: 120, ch: 0 }, p);
        this.clock = new HoldClock();
        this.hold = { env: new Float64Array(256) };
        this.cap = true;
        this.vld = false;
        this.fzPrev = 0;
        this.roll = 1;
        this.tickCnt = 0;
        this.i = 0;
        this.act = false;
        this.slot = -999999;
        this.frames = [];
        this.hist = [0, 0];
        this.stft = new ref.Stft(this.p.n, (re, im) => this.frame(re, im));
    }

    get useHold() {
        const gm = this.p.gmode | 0;
        return gm === 5 || gm === 4;
    }

    frame(re, im) {
        const p = this.p;
        const gm = p.gmode | 0;
        const glitch = gm >= 1 && gm <= 3 ? gm : 0;
        const capNow = this.cap || (this.useHold && !this.vld);
        const o = {
            n: p.n, sr: p.sr, coeffs: p.coeffs, bits: p.bits, smode: p.smode, samt: p.samt, shift: p.shift,
            useHold: this.useHold, capture: capNow, roll: this.roll,
            glitch, act: this.act, slot: this.slot, W: glitchWindow(p.grate, p.bpm, p.sr, p.n), lag: p.lag, pmode: p.pmode,
            seed: whisperSeed(this.clock.beat, p.bpm, p.sr, p.n, p.ch),
        };
        const r = processSpectrum(re, im, o, this.hold, false);
        if (r) {
            if (capNow) {
                this.vld = true;
                this.cap = false;
            }
            this.frames.push(r);
        }
        this.hist = packHist(this.hist, r ? r.code : 0);
    }

    push(x) {
        const p = this.p;
        const gm = p.gmode | 0;
        const fz = gm === 5;
        const hidx = gm === 4 ? Math.round(p.grate) + 1 : 0;
        const ppq = p.ppq ? p.ppq(this.i) : 0;
        const tick = this.clock.step(p.sr, p.bpm, ppq, hidx);
        if (tick) {
            this.tickCnt += 1;
            this.roll += 1;
            if (hidx > 0 && !fz) this.cap = true;
        }
        if (fz && !this.fzPrev) this.cap = true;
        this.fzPrev = fz ? 1 : 0;
        if (!this.useHold) this.vld = false;
        const slot = Math.floor(this.clock.beat / glitchBeats(p.grate));
        if (slot !== this.slot) {
            this.slot = slot;
            this.act = gm >= 1 && gm <= 3 && slotActive(slot, p.samt); // latched at the slot start, like gActH
        }
        this.i += 1;
        return this.stft.push(x);
    }

    run(signal) {
        const out = new Float64Array(signal.length);
        for (let i = 0; i < signal.length; i++) out[i] = this.push(signal[i]);
        return out;
    }
}

module.exports = {
    HoldClock,
    DeviceModel,
    GlitchState,
    EPS,
    NC,
    HOLD_RATES,
    SCRAMBLE_MODES,
    GLITCH_MODES,
    GLITCH_RATES,
    PHASE_MODES,
    RING,
    STRIDE,
    LAG_MAX,
    W_MAX,
    DROP_FADE,
    DROP_RUN_MAX,
    PHASE_K,
    clip,
    formantQ,
    coeffsKept,
    quantStep,
    holdBeats,
    hi,
    perm,
    isNeutral,
    fxActive,
    hash,
    lagSpread,
    lagDelay,
    glitchBeats,
    slotActive,
    glitchWindow,
    whisperSeed,
    packHist,
    unpackHist,
    robotSpectrum,
    whisperSpectrum,
    findPivot,
    crestOf,
    minPhaseFrame,
    phaseGain,
    crushCepstrum,
    remagLimited,
    processSpectrum,
    Crusher,
};
