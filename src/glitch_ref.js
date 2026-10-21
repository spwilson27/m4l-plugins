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
            const y = x + (r - x) * p.blend;
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

module.exports = {
    saturate, saturateMorph, Svf, svfCoefs, quantize, DIV_BEATS, chopBit, hash, crushParams, crushCepstrum,
    VOWELS, LFO_BEATS, SEQ_DIV, vowelFormant, rd1, Formant, Comb, Phaser, Rectify, DelayFm, flipBit, Corrupt, Grain, ReverseSlices,
    SliceShuffle, Slapback, binMap, specGate,
};
