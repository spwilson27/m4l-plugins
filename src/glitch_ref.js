"use strict";
// Node twin of the testable parts of src/glitch_core.genexpr (the gen functions are transpiled and compared to these in
// tests/test_glitch.js). The cepstral crusher's twin is crushCepstrum() in src/cepcrush_ref.js; the morph's twin is
// blendVectors() in src/glitch_config.js.

const qc = require("./cepcrush_ref.js");

// Drive shapes: 0 soft (tanh), 1 fold (sin), 2 hard clip, 3 asymmetric tanh (DC removed by the module).
function saturate(u, mode) {
    if (mode < 0.5) return Math.tanh(u);
    if (mode < 1.5) return Math.sin(u);
    if (mode < 2.5) return Math.max(-1, Math.min(1, u));
    return Math.tanh(u + 0.4) - Math.tanh(0.4);
}
// Fractional mode: linear crossfade between neighbouring shapes.
function saturateMorph(u, m) {
    const i0 = Math.floor(m);
    const fr = m - i0;
    const a = saturate(u, i0);
    const b = saturate(u, Math.min(i0 + 1, 3));
    return a + (b - a) * fr;
}

// TPT state variable filter. type 0 LP, 1 BP (unity at the centre), 2 HP, 3 Notch; fractional = crossfade.
class Svf {
    constructor() {
        this.ic1 = 0;
        this.ic2 = 0;
    }
    process(x, g, k, ty) {
        const a1 = 1 / (1 + g * (g + k));
        const a2 = g * a1;
        const a3 = g * a2;
        const v3 = x - this.ic2;
        const v1 = a1 * this.ic1 + a2 * v3;
        const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
        this.ic1 = 2 * v1 - this.ic1;
        this.ic2 = 2 * v2 - this.ic2;
        const o = [v2, k * v1, x - k * v1 - v2, x - k * v1];
        const i0 = Math.floor(ty);
        const fr = ty - i0;
        const sa = o[Math.min(i0, 3)];
        const sb = o[Math.min(i0 + 1, 3)];
        return sa + (sb - sa) * fr;
    }
}
function svfCoefs(cutoffHz, res, sr) {
    const fc = Math.max(20, Math.min(sr * 0.45, cutoffHz));
    return { g: Math.tan((Math.PI * fc) / sr), k: 2 - 1.96 * Math.max(0, Math.min(1, res)) };
}

function quantize(x, bits) {
    const step = Math.pow(2, 1 - bits);
    return Math.round(x / step) * step;
}

const DIV_BEATS = [0.0625, 0.125, 0.25, 0.375, 0.5, 0.75, 1, 2];
function chopBit(pattern, step) {
    return (Math.floor(pattern) >> step) & 1;
}
function hash(x, a) {
    const v = Math.sin(x * 12.9898 + a) * 43758.5453;
    return v - Math.floor(v);
}

// Cepstral Crush + Scramble amounts -> the crusher's own parameters (the main body of the core does the same).
function crushParams(ccAmt, coeffs, bits) {
    return { coeffs: 1 - ccAmt * (1 - coeffs), bits: 16 - ccAmt * (16 - bits) };
}
// The crusher without Hold / Shift, via the cepstral crusher reference.
function crushCepstrum(c, o) {
    return qc.crushCepstrum(c, { n: o.n, sr: o.sr, coeffs: o.coeffs, bits: o.bits, smode: o.smode, samt: o.samt, shift: 0, useHold: 0, capture: 0, roll: o.roll }, { env: new Float64Array(256) });
}



// ---------------------------------------------------------------------------------------------------------------
// Phase 2 modules. Each class mirrors one gen function: process(xl, xr, p, ...) returns [yl, yr], p = the module's params by
// key plus w (the smoothed wet). Compared sample by sample with the transpiled gen functions in tests/test_glitch.js.
// ---------------------------------------------------------------------------------------------------------------
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const VOWELS = [[800, 1150, 2900], [400, 1600, 2700], [350, 1700, 2700], [450, 800, 2830], [325, 700, 2700]];
const LFO_BEATS = [0.5, 1, 2, 4, 8, 16, 32];
const SEQ_DIV = [0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 1, 4 / 3, 2, 4];

// formant j (0..2) for a vowel position 0..4
function vowelFormant(v, j) {
    const i0 = clip(Math.floor(v), 0, 3);
    const fr = clip(v - i0, 0, 1);
    const a = VOWELS[i0][j], b = VOWELS[i0 + 1][j];
    return a + (b - a) * fr;
}
// linear-interpolated read from a ring (mono slice of ln samples at off)
function rd1(ring, off, ln, pos) {
    const p = pos - ln * Math.floor(pos / ln);
    const i0 = Math.floor(p);
    const fr = p - i0;
    const i1 = i0 + 1 >= ln ? 0 : i0 + 1;
    return ring[off + i0] * (1 - fr) + ring[off + i1] * fr;
}

class Formant {
    constructor() {
        this.f = [0, 1, 2].map(() => [new Svf(), new Svf()]);
    }
    process(xl, xr, p, sr) {
        const rs = 1.6 - 1.5 * clip(p.res, 0, 1);
        const sh = Math.pow(2, p.shift / 12);
        const vw = clip(p.vowel, 0, 4);
        let sl = 0, sq = 0;
        for (let j = 0; j < 3; j++) {
            const fq = clip(vowelFormant(vw, j) * sh, 50, sr * 0.45);
            const g = Math.tan((Math.PI * fq) / sr);
            const am = j < 0.5 ? 1 : (j < 1.5 ? 0.55 : 0.3);
            sl += am * this.f[j][0].process(xl, g, rs, 1);
            sq += am * this.f[j][1].process(xr, g, rs, 1);
        }
        return [xl + (sl * 2.2 - xl) * p.w, xr + (sq * 2.2 - xr) * p.w];
    }
}

class Comb {
    constructor() {
        this.ring = new Float64Array(8192);
        this.wp = 0;
        this.ds = 0;
        this.lp = [0, 0];
    }
    process(xl, xr, p, sr) {
        const dt = clip(sr / Math.max(p.freq, 20), 2, 4000);
        this.ds = this.ds < 1 ? dt : this.ds + (dt - this.ds) * 0.002;
        const fb = clip(p.fb, -0.97, 0.97);
        const dc = 1 - Math.exp((-6.283185307179586 * p.damp) / sr);
        const gn = 1 - 0.7 * Math.abs(fb);
        const out = [0, 0];
        const xs = [xl, xr];
        for (let c = 0; c < 2; c++) {
            const x = xs[c];
            const r = rd1(this.ring, c * 4096, 4096, this.wp - this.ds);
            this.lp[c] = this.lp[c] + (r - this.lp[c]) * dc;
            const y = x + fb * this.lp[c];
            this.ring[c * 4096 + this.wp] = clip(y, -8, 8);
            out[c] = x + (y * gn - x) * p.w;
        }
        this.wp = this.wp + 1 >= 4096 ? 0 : this.wp + 1;
        return out;
    }
}

class Phaser {
    constructor() {
        this.ph = 0;
        this.fb = [0, 0];
        this.z = [new Float64Array(8), new Float64Array(8)];
    }
    // p: stages 0..3, sync 0/1, hz, div, depth, fb
    process(xl, xr, p, beat, sr) {
        const nst = 2 * (Math.floor(p.stages + 0.5) + 1);
        const lb = LFO_BEATS[Math.max(0, Math.min(6, Math.round(p.div)))];
        this.ph = this.ph + p.hz / sr;
        this.ph = this.ph - Math.floor(this.ph);
        let pp = p.sync > 0.5 ? beat / lb : this.ph;
        pp = pp - Math.floor(pp);
        const lfo = 0.5 - 0.5 * Math.cos(6.283185307179586 * pp);
        const pos = 0.5 + (lfo - 0.5) * p.depth;
        const fcen = Math.min(200 * Math.pow(25, pos), sr * 0.45);
        const tn = Math.tan((Math.PI * fcen) / sr);
        const ac = (tn - 1) / (tn + 1);
        const out = [0, 0];
        const xs = [xl, xr];
        for (let c = 0; c < 2; c++) {
            const x = xs[c];
            let v = x + p.fb * this.fb[c];
            for (let s = 0; s < 8; s++) {
                if (s < nst) {
                    const z = this.z[c][s];
                    const y = ac * v + z;
                    this.z[c][s] = v - ac * y;
                    v = y;
                }
            }
            this.fb[c] = clip(v, -4, 4);
            out[c] = x + (0.5 * (x + v) - x) * p.w;
        }
        return out;
    }
}

class Rectify {
    constructor() {
        this.x1 = [0, 0];
        this.y1 = [0, 0];
    }
    process(xl, xr, p) {
        const out = [0, 0];
        const xs = [xl, xr];
        for (let c = 0; c < 2; c++) {
            const x = xs[c];
            const r = p.mode < 0.5 ? Math.max(x, 0) : (p.mode < 1.5 ? Math.abs(x) : (x > 0 ? x : -0.4 * x));
            const y = r;
            const hp = y - this.x1[c] + 0.995 * this.y1[c];
            this.x1[c] = y;
            this.y1[c] = hp;
            out[c] = x + (hp - x) * p.w;
        }
        return out;
    }
}

class DelayFm {
    constructor() {
        this.ring = new Float64Array(4096);
        this.wp = 0;
        this.ph = 0;
    }
    process(xl, xr, p, sr) {
        const am = p.index * 0.003 * sr;
        this.ph = this.ph + (110 * p.ratio) / sr;
        this.ph = this.ph - Math.floor(this.ph);
        const osc = Math.sin(6.283185307179586 * this.ph);
        const out = [0, 0];
        const xs = [xl, xr];
        for (let c = 0; c < 2; c++) {
            const x = xs[c];
            this.ring[c * 2048 + this.wp] = x;
            const m = p.mode > 0.5 ? Math.tanh(x * p.ratio) : osc;
            const d = 1 + am * (1 + m);
            const y = rd1(this.ring, c * 2048, 2048, this.wp - d);
            out[c] = x + (y - x) * p.w;
        }
        this.wp = this.wp + 1 >= 2048 ? 0 : this.wp + 1;
        return out;
    }
}

// flip bit `bt` of the 16-bit offset-binary form of x
function flipBit(x, bt) {
    const u = Math.floor((clip(x, -1, 1) * 0.5 + 0.5) * 65535 + 0.5);
    const pw = Math.pow(2, bt);
    const bit = Math.floor(u / pw) - 2 * Math.floor(u / (pw * 2));
    const u2 = u + (bit > 0.5 ? -pw : pw);
    return (u2 / 65535 - 0.5) * 2;
}
class Corrupt {
    constructor() {
        this.slot = 0;
        this.on = 0;
        this.ea = 0;
        this.held = [0, 0];
        this.bits = [0, 0, 0];
        this.cnt = 0;
    }
    process(xl, xr, p, beat) {
        const db = DIV_BEATS[Math.max(0, Math.min(7, Math.round(p.div)))];
        const slot = Math.floor(beat / db);
        if (slot !== this.slot) {
            this.slot = slot;
            this.on = hash(slot, 9.1) < p.chance ? 1 : 0;
            this.bits = [6 + Math.floor(hash(slot, 1.7) * 9), 6 + Math.floor(hash(slot, 2.9) * 9), 6 + Math.floor(hash(slot, 4.3) * 9)];
        }
        this.ea = this.ea + (this.on - this.ea) * 0.02;
        this.cnt = this.cnt + 1;
        this.cnt = this.cnt > 10000000 ? 0 : this.cnt;
        const blk = Math.floor(this.cnt / 48);
        const dh = hash(blk + slot * 131, 6.6);
        const dr = this.on > 0.5 && dh < p.drop ? 1 : 0;
        const wr = 1 + p.wrap * 7;
        const nf = p.flips < 0.01 ? 0 : 1 + Math.floor(p.flips * 2.999);
        const out = [0, 0];
        const xs = [xl, xr];
        for (let c = 0; c < 2; c++) {
            const x = xs[c];
            let x2 = x * wr;
            x2 = x2 - 2 * Math.floor((x2 + 1) * 0.5);
            let x3 = x2;
            for (let q = 0; q < 3; q++) {
                const xf = flipBit(x3, this.bits[q]);
                x3 = q < nf ? xf : x3;
            }
            const y = dr > 0.5 ? this.held[c] : x3;
            this.held[c] = y;
            out[c] = x + (y - x) * this.ea * p.w;
        }
        return out;
    }
}

// Granular engine; kind 0 pitch, 1 stretch. One instance per module.
class Grain {
    constructor(kind) {
        this.kind = kind;
        this.ring = [new Float64Array(262144), new Float64Array(262144)];
        this.wp = 0;
        this.gap = 0;
        this.prevAct = 0;
        this.cnt = 0;
        this.gr = [{ g: 0, anc: 0, rate: 0, size: 0 }, { g: 0.5, anc: 0, rate: 0, size: 0 }];
    }
    rd(c, pos) {
        const p = pos - 262144 * Math.floor(pos / 262144);
        const i0 = Math.floor(p);
        const fr = p - i0;
        const i1 = i0 + 1 >= 262144 ? 0 : i0 + 1;
        return this.ring[c][i0] * (1 - fr) + this.ring[c][i1] * fr;
    }
    // p: p1 (pitch st | speed), size ms, p3 (jitter | spread), w, act
    process(xl, xr, p, sr, act) {
        const kind = this.kind;
        const szs = clip(p.size * 0.001 * sr, 64, 24000);
        const frz = act > 0.5 && kind > 0.5 && p.p1 < 0.01 ? 1 : 0;
        if (act > 0.5 && this.prevAct < 0.5) {
            this.gr[0].g = 0; this.gr[0].size = 0;
            this.gr[1].g = 0.5; this.gr[1].size = 0;
        }
        this.prevAct = act;
        let yl = xl, yr = xr;
        if (act > 0.5) {
            let gp = this.gap;
            if (kind > 0.5 && frz < 0.5) {
                gp = Math.min(gp + 1 - p.p1, 200000);
                this.gap = gp;
            }
            yl = 0; yr = 0;
            for (let q = 0; q < 2; q++) {
                const G = this.gr[q];
                const fst = G.size < 1 ? 1 : 0;
                let g = G.g + 1 / Math.max(G.size, 1);
                const nw = g >= 1 || fst > 0.5 ? 1 : 0;
                if (nw > 0.5) {
                    g = fst > 0.5 ? G.g : g - 1;
                    this.cnt = this.cnt + 1;
                    const h1 = hash(this.cnt + q * 0.5, 2.2);
                    const rr = Math.pow(2, p.p1 / 12);
                    const dd = szs * Math.max(rr - 1, 0) + 4 + p.p3 * szs * 0.5 * h1;
                    const gpl = clip(gp, szs + 4, 200000);
                    G.anc = kind > 0.5 ? this.wp - gpl - p.p3 * szs * 2 * h1 : this.wp - dd;
                    G.rate = kind > 0.5 ? 1 : rr;
                    G.size = szs;
                }
                G.g = g;
                let wn = Math.sin(Math.PI * g);
                wn = wn * wn;
                const ps = G.anc + G.rate * G.size * g;
                yl += wn * this.rd(0, ps);
                yr += wn * this.rd(1, ps);
            }
        }
        if (frz < 0.5) {
            this.ring[0][this.wp] = xl;
            this.ring[1][this.wp] = xr;
            this.wp = this.wp + 1 >= 262144 ? 0 : this.wp + 1;
        }
        return [xl + (yl - xl) * p.w, xr + (yr - xr) * p.w];
    }
}

// ring read, 262144-sample stereo ring, linear interpolation
function ringRead(ring, c, pos) {
    const p = pos - 262144 * Math.floor(pos / 262144);
    const i0 = Math.floor(p);
    const fr = p - i0;
    const i1 = i0 + 1 >= 262144 ? 0 : i0 + 1;
    return ring[c][i0] * (1 - fr) + ring[c][i1] * fr;
}

class ReverseSlices {
    constructor() {
        this.ring = [new Float64Array(262144), new Float64Array(262144)];
        this.wp = 0;
        this.slot = 0;
        this.wp0 = 0;
        this.len = 0;
        this.fire = 0;
        this.el = 0;
    }
    process(xl, xr, p, beat, bpm, sr, act) {
        this.ring[0][this.wp] = xl;
        this.ring[1][this.wp] = xr;
        let ol = xl, or = xr;
        if (act > 0.5) {
            const db = DIV_BEATS[Math.max(0, Math.min(7, Math.round(p.div)))];
            const slot = Math.floor(beat / db);
            if (slot !== this.slot) {
                this.slot = slot;
                this.wp0 = this.wp;
                this.len = clip(Math.floor((db * 60) / bpm * sr + 0.5), 64, 120000);
                this.fire = hash(slot, 5.5) < p.chance ? 1 : 0;
                this.el = 0;
            }
            const el = this.el;
            let fa = clip(Math.min(el + 1, this.len - el) / 96, 0, 1);
            fa = fa * this.fire * (el < this.len ? 1 : 0);
            const pos = this.wp0 - 1 - el;
            const rl = ringRead(this.ring, 0, pos), rr = ringRead(this.ring, 1, pos);
            const yl = xl + (rl - xl) * fa, yr = xr + (rr - xr) * fa;
            ol = xl + (yl - xl) * p.w;
            or = xr + (yr - xr) * p.w;
            this.el = Math.min(el + 1, 1000000);
        }
        this.wp = this.wp + 1 >= 262144 ? 0 : this.wp + 1;
        return [ol, or];
    }
}

class SliceShuffle {
    constructor() {
        this.ring = [new Float64Array(262144), new Float64Array(262144)];
        this.wp = 0;
        this.slot = 0;
        this.wp0 = 0;
        this.len = 0;
        this.nsl = 0;
        this.permSlot = 0;
        this.permSeed = 0;
        this.pm = new Float64Array(32);
    }
    process(xl, xr, p, beat, bpm, sr, act) {
        this.ring[0][this.wp] = xl;
        this.ring[1][this.wp] = xr;
        let ol = xl, or = xr;
        if (act > 0.5) {
            const nsl = Math.pow(2, Math.floor(p.slices + 0.5) + 1);
            const spn = Math.pow(2, Math.floor(p.span + 0.5));
            const sd = Math.floor(p.seed + 0.5);
            const bt = beat / spn;
            const slot = Math.floor(bt);
            const fr = bt - slot;
            if (slot !== this.slot) {
                this.slot = slot;
                this.wp0 = this.wp;
                this.len = clip(Math.floor((spn * 60) / bpm * sr + 0.5), 256, 120000);
            }
            if (slot !== this.permSlot || nsl !== this.nsl || sd !== this.permSeed) {
                this.permSlot = slot;
                this.nsl = nsl;
                this.permSeed = sd;
                this.pm = qcPerm(nsl, slot * 7.31 + sd * 13.7);
            }
            const sp = fr * nsl;
            const k = Math.min(Math.floor(sp), nsl - 1);
            const of = sp - k;
            const sln = this.len / nsl;
            const pj = this.pm[k + 1];
            const chn = hash(slot * 17 + k, 3.1) < p.chance ? 1 : 0;
            const pos = this.wp0 - this.len + (pj - 1) * sln + of * sln;
            const fa = clip(Math.min(of * sln, (1 - of) * sln) / 96, 0, 1) * chn;
            const rl = ringRead(this.ring, 0, pos), rr = ringRead(this.ring, 1, pos);
            ol = xl + (rl - xl) * fa * p.w;
            or = xr + (rr - xr) * fa * p.w;
        }
        this.wp = this.wp + 1 >= 262144 ? 0 : this.wp + 1;
        return [ol, or];
    }
}
const qcPerm = (r, seed) => qc.perm(r, seed);

class Slapback {
    constructor() {
        this.ring = new Float64Array(65536);
        this.wp = 0;
        this.ds = [0, 0];
        this.lp = [0, 0];
    }
    process(xl, xr, p, sr) {
        const tm = p.time * 0.001 * sr;
        const cf = 1 - Math.exp((-6.283185307179586 * p.tone) / sr);
        const out = [0, 0];
        const xs = [xl, xr];
        for (let c = 0; c < 2; c++) {
            const tg = tm + (c < 0.5 ? Math.max(-p.offset, 0) : Math.max(p.offset, 0)) * 0.015 * sr;
            this.ds[c] = this.ds[c] < 1 ? tg : this.ds[c] + (tg - this.ds[c]) * 0.001;
            const r = rd1(this.ring, c * 32768, 32768, this.wp - this.ds[c]);
            this.lp[c] = this.lp[c] + (r - this.lp[c]) * cf;
            this.ring[c * 32768 + this.wp] = xs[c];
            out[c] = xs[c] + this.lp[c] * p.w;
        }
        this.wp = this.wp + 1 >= 32768 ? 0 : this.wp + 1;
        return out;
    }
}

// Spectral bin remap on re / im arrays (length n, Hermitian), crossfaded by amt. Twin of gl_binmap.
function binMap(re, im, n, mode, amt, p1, nb, pm) {
    const half = n / 2;
    const wb = Math.max(Math.floor(p1), 2);
    const pc = Math.floor(p1 + 0.5);
    const pcm = Math.min(pc, half - pc);
    const tr = new Float64Array(half + 1), ti = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) {
        const bq = Math.floor(k / wb);
        const bi = Math.min(bq, nb - 1);
        const wi = k - bq * wb;
        const pj = pm[bi + 1];
        const skS = k < nb * wb ? (pj - 1) * wb + wi : k;
        const skM = k >= pc - pcm && k <= pc + pcm ? 2 * pc - k : k;
        const skH = k - pc;
        let sk = mode < 0.5 ? skS : (mode < 1.5 ? skM : skH);
        const ok = sk >= 0 && sk <= half ? 1 : 0;
        sk = clip(sk, 0, half);
        tr[k] = re[sk] * ok;
        ti[k] = im[sk] * ok;
    }
    for (let k = 0; k <= half; k++) {
        const yr = re[k] + (tr[k] - re[k]) * amt;
        let yi = im[k] + (ti[k] - im[k]) * amt;
        yi = k > 0 && k < half ? yi : 0;
        re[k] = yr;
        im[k] = yi;
        if (k > 0 && k < half) {
            re[n - k] = yr;
            im[n - k] = -yi;
        }
    }
}
// Spectral gate / lofi on re / im (Hermitian). Twin of gl_sgate. Returns the threshold.
function specGate(re, im, n, mode, amt, kk, step) {
    const half = n / 2;
    const mag = new Float64Array(half + 1);
    let mx = 1e-12;
    for (let k = 0; k <= half; k++) {
        mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        mx = Math.max(mx, mag[k]);
    }
    let lo = Math.log(mx * 1e-6), hi = Math.log(mx);
    const its = mode < 0.5 ? 14 : 0;
    for (let it = 0; it < its; it++) {
        const md = (lo + hi) * 0.5;
        const th = Math.exp(md);
        let cnt = 0;
        for (let k = 0; k <= half; k++) cnt += mag[k] >= th ? 1 : 0;
        lo = cnt > kk ? md : lo;
        hi = cnt > kk ? hi : md;
    }
    const thr = Math.exp(hi);
    const sn = step / 8.685889638065035;
    for (let k = 0; k <= half; k++) {
        const m = mag[k];
        const ml = Math.max(m, 1e-12);
        const gq = Math.exp(Math.round(Math.log(ml) / sn) * sn) / ml;
        let gk = mode < 0.5 ? (m >= thr ? 1 : 0) : gq;
        gk = 1 + (gk - 1) * amt;
        re[k] *= gk;
        im[k] *= gk;
        if (k > 0 && k < half) {
            re[n - k] = re[k];
            im[n - k] = -im[k];
        }
    }
    return thr;
}


// ---- phase 4: Ratchet / Scratch (twins of gl_ratchet / gl_scratch) ----
function lfoSmoothRandom(x, salt) {
    const cyc = Math.floor(x);
    const ph = x - cyc;
    const rA = hash(cyc + salt, 3.7) * 2 - 1;
    const rB = hash(cyc + salt + 1, 3.7) * 2 - 1;
    const sm = 0.5 - 0.5 * Math.cos(ph * 3.141592653589793);
    return rA + (rB - rA) * sm;
}
class Ratchet {
    constructor() {
        this.ring = [new Float64Array(262144), new Float64Array(262144)];
        this.st = new Float64Array(16);
    }
    // p: {w, div, count, accel, pitch, decay, prob}
    process(xl, xr, p, beat, bpm, sr, act) {
        const st = this.st;
        let wp = st[0];
        let eng = st[2];
        if (act > 0.5) {
            const sb = DIV_BEATS[Math.max(0, Math.min(7, Math.round(p.div)))];
            const slot = Math.floor(beat / sb);
            if (slot !== st[1]) {
                st[1] = slot;
                const tl = Math.min((sb * 60) / bpm * sr, 190000);
                const nn = clip(Math.floor(p.count + 0.5), 2, 16);
                const qq = Math.pow(2, (-3 * p.accel) / (nn - 1));
                const d0 = Math.abs(1 - qq) < 0.0001 ? tl / nn : (tl * (1 - qq)) / (1 - Math.pow(qq, nn));
                const gc = clip(Math.floor(Math.max(d0, d0 * Math.pow(qq, nn - 1)) * Math.pow(2, Math.max(p.pitch, 0) / 12) + 0.5), 64, 120000);
                const hh = hash(slot, 6.6);
                eng = hh < p.prob && tl > 256 ? 1 : 0;
                let cs = wp - gc;
                cs = cs < 0 ? cs + 262144 : cs;
                st[2] = eng;
                st[3] = 0;
                st[4] = 0;
                st[5] = d0;
                st[7] = cs;
                st[8] = gc;
                st[9] = d0;
                st[10] = qq;
                st[11] = nn;
            }
        } else {
            eng = 0;
            st[2] = 0;
        }
        let eg = st[6];
        eg = eg + (eng - eg) * 0.01;
        eg = eng < 0.5 && eg < 0.0005 ? 0 : eg;
        st[6] = eg;
        let ol = xl, or = xr;
        if (eg > 0) {
            let idx = st[3];
            let pos = st[4];
            const ln = Math.max(st[5], 2);
            const nn = st[11];
            const fq = nn > 1.5 ? idx / (nn - 1) : 0;
            const rt = Math.pow(2, (p.pitch * fq) / 12);
            const gr = Math.pow(1 - p.decay * 0.6, idx);
            const rd = st[7] + pos * rt;
            let fe = Math.min(1, Math.min(pos + 1, ln - pos) / 24);
            fe = fe * clip((st[8] - pos * rt) / 24, 0, 1);
            const x = [xl, xr], y = [0, 0];
            for (let c = 0; c < 2; c++) {
                const lp = ringRead(this.ring, c, rd);
                const mx = x[c] * (1 - eg) + lp * fe * gr * eg;
                y[c] = x[c] + (mx - x[c]) * p.w;
            }
            ol = y[0];
            or = y[1];
            pos = pos + 1;
            if (pos >= ln) {
                pos = 0;
                idx = idx + 1;
                st[3] = idx;
                if (idx >= nn) st[2] = 0;
                else st[5] = st[9] * Math.pow(st[10], idx);
            }
            st[4] = pos;
        }
        this.ring[0][wp] = xl;
        this.ring[1][wp] = xr;
        wp = wp + 1;
        wp = wp >= 262144 ? 0 : wp;
        st[0] = wp;
        return [ol, or];
    }
}
class Scratch {
    constructor() {
        this.ring = [new Float64Array(262144), new Float64Array(262144)];
        this.st = new Float64Array(8);
    }
    // p: {w, size, shape, rate, depth}
    process(xl, xr, p, beat, bpm, sr, act) {
        const st = this.st;
        let wp = st[0];
        this.ring[0][wp] = xl;
        this.ring[1][wp] = xr;
        let ol = xl, or = xr;
        if (act > 0.5) {
            const bl = clip((DIV_BEATS[Math.max(0, Math.min(7, Math.round(p.size)))] * 60) / bpm * sr, 256, 130000);
            const am = p.depth * (bl - 8) * 0.5;
            const xc = beat / DIV_BEATS[Math.max(0, Math.min(7, Math.round(p.rate)))];
            const ph = xc - Math.floor(xc);
            const pSin = Math.sin(6.283185307179586 * ph);
            const pSaw = ph < 0.85 ? -1 + (2 * ph) / 0.85 : 1 - (2 * (ph - 0.85)) / 0.15;
            const pRnd = lfoSmoothRandom(xc, 3.3);
            const pp = p.shape < 0.5 ? pSin : (p.shape < 1.5 ? pSaw : pRnd);
            const tg = 4 + am * (1 + pp);
            const lo = st[1];
            const ls = st[2] < 0.5 ? tg : lo + (tg - lo) * 0.0103;
            st[1] = ls;
            st[2] = 1;
            st[3] = 1 - (ls - lo);
            st[4] = 2 * am;
            const yl = ringRead(this.ring, 0, wp - ls), yr = ringRead(this.ring, 1, wp - ls);
            ol = xl + (yl - xl) * p.w;
            or = xr + (yr - xr) * p.w;
        } else {
            st[2] = 0;
            st[3] = 0;
        }
        wp = wp + 1;
        wp = wp >= 262144 ? 0 : wp;
        st[0] = wp;
        return [ol, or];
    }
}

// ---- phase 4 spectral sub-ops on re / im arrays (length n, Hermitian). Twins of gl_mapfx / gl_magfx / gl_phasefx. ----
const BARK_BANDS = 21;
function barkEdges(n, sr) {
    const half = n / 2;
    const e = [];
    let prev = 0;
    for (let bb = 0; bb < BARK_BANDS; bb++) {
        const z1 = ((bb + 1) * 24) / 21;
        let k1 = bb > 19.5 ? half + 1 : Math.floor((1960 * (z1 + 0.53)) / (26.28 - z1) * n / sr + 0.5);
        k1 = clip(k1, prev, half + 1);
        e.push(k1);
        prev = k1;
    }
    return e;
}
function applyComplex(re, im, tr, ti, n, amt) {
    const half = n / 2;
    for (let k = 0; k <= half; k++) {
        const xr = re[k], xi = im[k];
        const yr = xr + (tr[k] - xr) * amt;
        let yi = xi + (ti[k] - xi) * amt;
        yi = k > 0 && k < half ? yi : 0;
        re[k] = yr;
        im[k] = yi;
        if (k > 0 && k < half) { re[n - k] = yr; im[n - k] = -yi; }
    }
}
// state gs: {slot: [a, b], frames: [a, b], gh: [Float64Array(2 * 1024) x 2 (re, im)]}
function newHoldState() {
    return { slot: [0, 0], frames: [0, 0], re: [new Float64Array(1024), new Float64Array(1024)], im: [new Float64Array(1024), new Float64Array(1024)] };
}
function mapFx(re, im, n, op, amt, p1, p2, p3, chn, seed, beat, sr, cap, hold) {
    const half = n / 2;
    const tr = new Float64Array(half + 1), ti = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) { tr[k] = re[k]; ti[k] = im[k]; }
    if (op < 0.5) {
        const slot = Math.floor(beat / DIV_BEATS[Math.max(0, Math.min(7, Math.round(p2)))]);
        const cp = cap > 0.5 || slot !== hold.slot[chn] ? 1 : 0;
        hold.slot[chn] = slot;
        const fr = cp > 0.5 ? 0 : Math.min(hold.frames[chn] + 1, 1000000);
        hold.frames[chn] = fr;
        const fm = fr - 4 * Math.floor(fr / 4);
        const hd = slot * 3.31 + 0.7;
        for (let k = 0; k <= half; k++) {
            if (cp > 0.5) { hold.re[chn][k] = re[k]; hold.im[chn][k] = im[k]; }
            const hr = hold.re[chn][k], hq = hold.im[chn][k];
            const r4 = k * fm - 4 * Math.floor((k * fm) / 4);
            const rr = r4 < 0.5 ? hr : (r4 < 1.5 ? 0 - hq : (r4 < 2.5 ? 0 - hr : hq));
            const ri = r4 < 0.5 ? hq : (r4 < 1.5 ? hr : (r4 < 2.5 ? 0 - hq : 0 - hr));
            const hld = hash(k, hd) < p1 ? 1 : 0;
            tr[k] = hld > 0.5 ? rr : re[k];
            ti[k] = hld > 0.5 ? ri : im[k];
        }
    } else if (op < 1.5) {
        const mag = new Float64Array(half + 1);
        for (let k = 0; k <= half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        const stq = p1 < 0.5 ? Math.floor(p2 + 0.5) : p2;
        const r0 = Math.pow(2, stq / 12);
        const ih = p1 < 0.5 ? 0 : p3;
        for (let k = 0; k <= half; k++) {
            const ra = Math.max(r0 * (1 + (ih * k) / 256), 0.25);
            const sp = k / ra;
            const ok = sp <= half ? 1 : 0;
            const s0 = Math.min(Math.floor(sp), half);
            const s1 = Math.min(s0 + 1, half);
            const sf = sp - s0;
            const mm = (mag[s0] * (1 - sf) + mag[s1] * sf) * ok;
            const sn = clip(Math.floor(sp + 0.5), 0, half);
            const mn = mag[sn];
            const ur = mn > 1e-12 ? re[sn] / mn : 1;
            const ui = mn > 1e-12 ? im[sn] / mn : 0;
            const kd = (k - sn) * seed;
            const r4 = kd - 4 * Math.floor(kd / 4);
            const cr = r4 < 0.5 ? ur : (r4 < 1.5 ? 0 - ui : (r4 < 2.5 ? 0 - ur : ui));
            const ci = r4 < 0.5 ? ui : (r4 < 1.5 ? ur : (r4 < 2.5 ? 0 - ui : 0 - ur));
            tr[k] = mm * cr;
            ti[k] = k > 0 && k < half ? mm * ci : 0;
        }
    } else {
        const spn = clip(Math.floor(p1 + 0.5), 1, 8);
        const sd = seed * 78.233;
        for (let k = 1; k < half; k++) {
            if (hash(k, sd) < p2) {
                for (let j = 1; j <= spn; j++) {
                    const ka = k - j, kb = k + j;
                    if (ka >= 1) { tr[ka] = re[k]; ti[ka] = im[k]; }
                    if (kb < half) { tr[kb] = re[k]; ti[kb] = im[k]; }
                }
            }
        }
    }
    applyComplex(re, im, tr, ti, n, amt);
}
// op 0 MP3ify, 1 Duststorm, 2 Thinner, 3 Decapitate, 4 Noisify, 5 Clipper. Returns the per-bin gain array (before the amount crossfade).
function magFx(re, im, n, op, amt, p1, p2, p3, p4, seed, beat, sr) {
    const half = n / 2;
    const mag = new Float64Array(half + 1);
    let mx = 1e-12;
    for (let k = 0; k <= half; k++) { mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]); mx = Math.max(mx, mag[k]); }
    const g = new Float64Array(half + 1).fill(1);
    if (op < 1.5) {
        const tb = clip(Math.log(p1 / 16) / 2.995732273553991, 0, 1);
        const lv = 1 + Math.floor(31 * Math.pow(tb, 1.5) + 0.5);
        const cutHz = 2500 * Math.pow(10, tb);
        const thr = (op < 0.5 ? p2 : 0.5) * (0.1 + 0.4 * (1 - tb));
        const dmode = op < 0.5 ? 0 : p2;
        const dd = op < 0.5 ? 0 : p3;
        const slot = Math.floor(beat / DIV_BEATS[Math.max(0, Math.min(7, Math.round(p4)))]);
        const hs = hash(slot, 9.1);
        const pa = hs < 0.1667 ? 1 : (hs < 0.3333 ? 5 : (hs < 0.5 ? 11 : (hs < 0.6667 ? 13 : (hs < 0.8333 ? 17 : 19))));
        const ps = Math.floor(hash(slot, 2.9) * 21);
        const edges = barkEdges(n, sr);
        const sfs = [];
        let k0 = 0;
        for (let bb = 0; bb < BARK_BANDS; bb++) {
            let pk = 1e-12;
            for (let k = k0; k < edges[bb]; k++) pk = Math.max(pk, mag[k]);
            sfs.push(Math.exp(Math.floor(Math.log(pk) / 0.1727 + 0.5) * 0.1727));
            k0 = edges[bb];
        }
        let kp = 0;
        for (let bb = 0; bb < BARK_BANDS; bb++) {
            const k1 = edges[bb];
            const sf = sfs[bb];
            let pb = bb * pa + ps;
            pb = pb - 21 * Math.floor(pb / 21);
            const so = sfs[pb];
            const hv = hash(bb + slot * 31, 4.4);
            const sfo = sf * Math.pow(10, ((hv * 2 - 1) * 24 * dd) / 20);
            const sfp = Math.exp(Math.log(sf) * (1 - dd) + Math.log(so) * dd);
            const sfd = op < 0.5 ? sf : (dmode < 0.5 ? sfo : sfp);
            for (let k = kp; k < k1; k++) {
                const m = mag[k];
                const xn = m / sf;
                const qn = Math.floor(Math.pow(Math.min(xn, 1), 0.75) * lv + 0.5) / lv;
                const deq = Math.pow(qn, 1.3333333333333333) * sfd;
                const kf = xn >= thr && (k * sr) / n <= cutHz ? 1 : 0;
                g[k] = m > 1e-12 ? (deq * kf) / m : 1;
            }
            kp = k1;
        }
    } else if (op < 2.5) {
        const nb = clip(Math.floor(p1 + 0.5), 1, 16);
        for (let k = 0; k <= half; k++) {
            const m = mag[k];
            let mq = 0;
            for (let j = -nb; j <= nb; j++) {
                const kj = clip(k + j, 0, half);
                mq = k + j >= 0 && k + j <= half ? Math.max(mq, mag[kj]) : mq;
            }
            g[k] = m >= mq ? 1 : (p2 * m) / Math.max(mq, 1e-12);
        }
    } else if (op < 3.5) {
        const kk = clip(Math.floor(p1 + 0.5), 1, 32);
        const th2 = [0, 0];
        for (let pass = 0; pass < 2; pass++) {
            const tk = (pass + 1) * kk;
            let lo = Math.log(mx * 1e-6), hi = Math.log(mx);
            for (let it = 0; it < 14; it++) {
                const md = (lo + hi) * 0.5;
                const th = Math.exp(md);
                let cnt = 0;
                for (let k = 0; k <= half; k++) cnt = cnt + (mag[k] >= th ? 1 : 0);
                lo = cnt > tk ? md : lo;
                hi = cnt > tk ? hi : md;
            }
            th2[pass] = Math.exp(hi);
        }
        const bg = Math.pow(10, p2 / 20);
        for (let k = 0; k <= half; k++) g[k] = mag[k] >= th2[0] ? 0 : (mag[k] >= th2[1] ? bg : 1);
    } else if (op < 4.5) {
        const grn = clip(Math.floor(p2 + 0.5), 1, 16);
        const sd = seed * 78.233;
        for (let k = 0; k <= half; k++) {
            const hv = hash(Math.floor(k / grn), sd);
            g[k] = Math.pow(10, ((hv * 2 - 1) * p1) / 20);
        }
        let en0 = 1e-12, en1 = 1e-12;
        for (let k = 0; k <= half; k++) { en0 = en0 + mag[k] * mag[k]; en1 = en1 + mag[k] * mag[k] * g[k] * g[k]; }
        const gn = Math.sqrt(en0 / en1);
        for (let k = 0; k <= half; k++) g[k] = g[k] * gn;
    } else {
        const cl = Math.max(mx * Math.pow(10, p2 / 20), 1e-12);
        for (let k = 0; k <= half; k++) {
            const m = mag[k];
            g[k] = m > 1e-12 ? (p1 < 0.5 ? (cl * Math.tanh(m / cl)) / m : Math.min(m, cl) / m) : 1;
        }
    }
    for (let k = 0; k <= half; k++) {
        const gk = 1 + (g[k] - 1) * amt;
        const xr = re[k] * gk, xi = im[k] * gk;
        re[k] = xr;
        im[k] = xi;
        if (k > 0 && k < half) { re[n - k] = xr; im[n - k] = -xi; }
    }
    return g;
}
// level match of the re-phased modes (see gl_phasefx): gain kb * (2 / kb)^(random^1.3)
const PHASE_K_ROBOT = 1.5;
const PHASE_K_WHISPER = 1.0;
function phaseFx(re, im, n, op, amt, p1, p2, seed) {
    const half = n / 2;
    const sd = seed * 78.233;
    const wb = clip(Math.floor(p1 + 0.5), 8, 512);
    const kb = p1 < 0.5 ? PHASE_K_ROBOT : PHASE_K_WHISPER;
    const kq = kb * Math.pow(2 / kb, Math.pow(p2, 1.3));
    const tr = new Float64Array(half + 1), ti = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) {
        const xr = re[k], xi = im[k];
        const m = Math.sqrt(xr * xr + xi * xi);
        const isEdge = k < 0.5 || k > half - 0.5 ? 1 : 0;
        let zr = xr, zi = 0;
        if (op < 0.5) {
            const bq = Math.floor(k / wb);
            const pk = clip(bq * wb + (wb - 1) - (k - bq * wb), 0, half);
            const qr = re[pk], qi = im[pk];
            const mp = Math.sqrt(qr * qr + qi * qi);
            const gq = mp > 1e-12 ? m / mp : 0;
            zr = isEdge > 0.5 ? xr : qr * gq * 1.6;
            zi = isEdge > 0.5 ? 0 : qi * gq * 1.6;
        } else {
            const ang = p2 * 6.283185307179586 * hash(k, sd);
            const br = p1 < 0.5 ? ((k - 2 * Math.floor(k / 2)) > 0.5 ? 0 - m : m) : xr;
            const bi = p1 < 0.5 ? 0 : xi;
            zr = isEdge > 0.5 ? br * kq : (br * Math.cos(ang) - bi * Math.sin(ang)) * kq;
            zi = isEdge > 0.5 ? 0 : (br * Math.sin(ang) + bi * Math.cos(ang)) * kq;
        }
        let yr = xr + (zr - xr) * amt;
        let yi = xi + (zi - xi) * amt;
        yi = isEdge > 0.5 ? 0 : yi;
        tr[k] = yr;
        ti[k] = yi;
    }
    for (let k = 0; k <= half; k++) {
        re[k] = tr[k];
        im[k] = ti[k];
        if (k > 0 && k < half) { re[n - k] = tr[k]; im[n - k] = -ti[k]; }
    }
}

module.exports = {
    saturate, saturateMorph, Svf, svfCoefs, quantize, DIV_BEATS, chopBit, hash, crushParams, crushCepstrum,
    VOWELS, LFO_BEATS, SEQ_DIV, vowelFormant, rd1, Formant, Comb, Phaser, Rectify, DelayFm, flipBit, Corrupt, Grain, ReverseSlices,
    SliceShuffle, Slapback, binMap, specGate, Ratchet, Scratch, mapFx, magFx, phaseFx, newHoldState, barkEdges, PHASE_K_ROBOT, PHASE_K_WHISPER, lfoSmoothRandom,
};
