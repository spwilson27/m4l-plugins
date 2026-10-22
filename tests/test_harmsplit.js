#!/usr/bin/env node
"use strict";
/**
 * Verification suite for devices/Harmonic Split.amxd + .adg (Spectral Split suite, slug `harmsplit`).
 *
 *  1. Analysis / mask reference (src/harmsplit_config.js, hsFrame): sum identity of the three channels, fundamental tracking
 *     (220 Hz sawtooth within 0.5 %, missing fundamental, glide, noise only), the Pattern rule (P = 2, 4, 1), Maximum Harmonics,
 *     Low-cut / High-cut, Detection Threshold, Sensitivity, noise rejection, no flicker, stereo image, silence.
 *  2. The GenExpr functions (src/spectral_split_lib.genexpr + hs_* in src/harmsplit_core.genexpr), transpiled to JS with
 *     tests/genexpr_functions.js (bounds-checked Data), run as a sample-by-sample pipeline and compared with the reference.
 *  3. GenExpr lint (function order, single return, no e<digit> identifiers, Param names) and the shared link module.
 *  4. The built device: header, latency, 169 px, widget geometry (no overlap, no live.* over the v8ui), panels last,
 *     buffer names, wiring, parameter table versus the reference, and the .adg rack preset.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const cfg = require(path.join(ROOT, "src", "harmsplit_config.js"));
const ref = require(path.join(ROOT, "src", "cepstrum_ref.js"));
const { DataSim, load, functionsOf } = require("./genexpr_functions.js");
const { runLinkTests } = require("./spectral_link_tests.js");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const LIB_SRC = read("src/cepstrum_lib.genexpr");
const SS_SRC = read("src/spectral_split_lib.genexpr");
const CORE_SRC = read("src/harmsplit_core.genexpr");

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    };
}

const SR = 48000;
const energy = (a, s, e) => {
    let v = 0;
    for (let i = s; i < e; i++) v += a[i] * a[i];
    return v;
};
const goertzel = (x, s, e, f, sr) => {
    let re = 0, im = 0;
    for (let i = s; i < e; i++) {
        const w = (2 * Math.PI * f * i) / (sr || SR);
        re += x[i] * Math.cos(w);
        im += x[i] * Math.sin(w);
    }
    return (2 * Math.hypot(re, im)) / (e - s);
};

// ---- a Node mirror of the packed-stereo mask STFT (reference path, uses hsFrame) ----
function splitRef(L, R, n, p, sr) {
    sr = sr || SR;
    const hop = n / 4;
    const win = ref.hann(n);
    const half = n / 2;
    const st = cfg.hsNewState(n);
    const out = [0, 1, 2].map(() => ({ L: new Float64Array(L.length + 2 * n), R: new Float64Array(L.length + 2 * n) }));
    const mag = new Float64Array(half + 1);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const trace = [];
    for (let t = n; t <= L.length; t += hop) {
        const s0 = t - n;
        for (let i = 0; i < n; i++) {
            re[i] = L[s0 + i] * win[i];
            im[i] = R[s0 + i] * win[i];
        }
        ref.fft(re, im, false);
        for (let k = 0; k <= half; k++) {
            const k2 = (n - k) % n;
            const ar = re[k], ai = im[k], br = re[k2], bi = -im[k2];
            const xr = (ar + ai + (br - bi)) / 4;
            const xi = (ai - ar + (bi + br)) / 4;
            mag[k] = Math.hypot(xr, xi) * 4 / n;
        }
        cfg.hsFrame(st, mag, p, sr);
        trace.push({ f0: st.hst[20], series: st.hst[0], hr: st.hst[21], conf: st.hst[11], v: st.hst[4], nact: st.hst[16], lvl: st.hst[9], mN: Float64Array.from(st.mN), mA: Float64Array.from(st.mA), mB: Float64Array.from(st.mB) });
        [st.mN, st.mA, st.mB].forEach((m, ch) => {
            const r2 = Float64Array.from(re);
            const i2 = Float64Array.from(im);
            for (let k = 0; k <= half; k++) {
                r2[k] *= m[k];
                i2[k] *= m[k];
                if (k > 0 && k < half) {
                    r2[n - k] *= m[k];
                    i2[n - k] *= m[k];
                }
            }
            ref.fft(r2, i2, true);
            for (let i = 0; i < n; i++) {
                out[ch].L[s0 + i] += r2[i] * win[i] * (2 / 3);
                out[ch].R[s0 + i] += i2[i] * win[i] * (2 / 3);
            }
        });
    }
    return { nh: out[0], a: out[1], b: out[2], trace };
}

// device defaults: Pattern Every 2nd, Max Harmonics Off (0), Sensitivity 50 %, Tilt 0 dB, Threshold Automatic (-120), Low 80 Hz, High 1.5 kHz
const P0 = { hpat: 2, hmaxp: 0, sens: 0.5, tilt: 0, thr: -120, flo: 80, fhi: 1500 };
const NS = SR * 2;
const sawSig = (f0, hmin, amp, len) => {
    const x = new Float64Array(len || NS);
    for (let i = 0; i < x.length; i++) {
        let s = 0;
        for (let h = hmin; h * f0 < 20000; h++) s += Math.sin((2 * Math.PI * f0 * h * i) / SR) / h;
        x[i] = amp * s;
    }
    return x;
};
const sawAt = (f0, sr, len, amp) => {
    const x = new Float64Array(len);
    for (let i = 0; i < len; i++) {
        let v = 0;
        for (let h = 1; h * f0 < sr * 0.45; h++) v += Math.sin((2 * Math.PI * f0 * h * i) / sr) / h;
        x[i] = amp * v;
    }
    return x;
};
const noiseSig = (amp, seed, len) => {
    const r = rng(seed);
    const x = new Float64Array(len || NS);
    for (let i = 0; i < x.length; i++) x[i] = amp * r();
    return x;
};
const add = (a, b) => a.map((v, i) => v + b[i]);
const W0 = SR * 1.0, W1 = SR * 1.8;      // measurement window (state settled)
const share = (o, f, which, sr) => {
    const w0 = sr ? Math.round(sr * 1.0) : W0, w1 = sr ? Math.round(sr * 1.8) : W1;
    const e = [goertzel(o.nh.L, w0, w1, f, sr) ** 2, goertzel(o.a.L, w0, w1, f, sr) ** 2, goertzel(o.b.L, w0, w1, f, sr) ** 2];
    return which === undefined ? e : e[which] / (e[0] + e[1] + e[2] + 1e-30);
};

// ======================================================================
// 1. Reference behaviour
// ======================================================================
{
    const saw = sawSig(220, 1, 0.25);
    for (const n of [1024, 2048, 4096]) {
        const o = splitRef(saw, saw, n, P0);
        let err = 0, tot = 0;
        for (let i = n; i < NS - n; i++) {
            const d = o.nh.L[i] + o.a.L[i] + o.b.L[i] - saw[i];
            err += d * d;
            tot += saw[i] * saw[i];
        }
        const nullDb = 10 * Math.log10(err / tot + 1e-300);
        assert.ok(nullDb < -250, `sum of channels must null at Size ${n} (got ${nullDb} dB)`);
        for (const f of o.trace) for (let k = 0; k < f.mN.length; k++) {
            assert.ok(Math.abs(f.mN[k] + f.mA[k] + f.mB[k] - 1) < 1e-12 && f.mN[k] >= 0 && f.mA[k] >= 0 && f.mB[k] >= 0, "per-bin masks sum to 1 and are non-negative");
        }
        if (n >= 2048) {
            const last = o.trace[o.trace.length - 1];
            assert.ok(Math.abs(last.f0 / 220 - 1) < 0.005, `f0 of a 220 Hz sawtooth within 0.5 % at Size ${n} (got ${last.f0})`);
        }
    }

    // --- sawtooth 220 Hz, Size 2k: odd harmonics in A, even in B, almost nothing in Nonharmonics ---
    const o = splitRef(saw, saw, 2048, P0);
    const last = o.trace[o.trace.length - 1];
    console.log(`[ref] saw 220 / 2k: f0 ${last.f0.toFixed(2)} Hz, salience ${last.conf.toFixed(2)}, ${last.nact} active harmonics`);
    assert.ok(last.v > 0.99 && last.nact >= 50, "voiced, about 54 harmonics below 12 kHz");
    for (let h = 1; h <= 12; h++) {
        const e = share(o, 220 * h);
        const own = h % 2 === 1 ? 1 : 2;
        assert.ok(e[own] / (e[0] + e[1] + e[2]) > 0.985, `harmonic ${h} lands in ${own === 1 ? "A" : "B"} (shares ${e.map((v) => (v / (e[0] + e[1] + e[2])).toFixed(4))})`);
    }
    const eN = energy(o.nh.L, W0, W1), eA = energy(o.a.L, W0, W1), eB = energy(o.b.L, W0, W1);
    assert.ok(eN / (eN + eA + eB) < 0.01, `a clean sawtooth leaves under 1 % in Nonharmonics (${(eN / (eN + eA + eB)).toFixed(4)})`);
    assert.ok(eA / eB > 2.5 && eA / eB < 3.6, `odd / even energy ratio of a sawtooth is about 3 (${(eA / eB).toFixed(2)})`);

    // --- Harmonics Pattern ---
    const o4 = splitRef(saw, saw, 2048, Object.assign({}, P0, { hpat: 4 }));
    for (let h = 1; h <= 12; h++) {
        const inA = (h - 1) % 4 === 0;
        assert.ok(share(o4, 220 * h, inA ? 1 : 2) > 0.985, `P = 4: harmonic ${h} goes to ${inA ? "A" : "B"}`);
    }
    const o1 = splitRef(saw, saw, 2048, Object.assign({}, P0, { hpat: 1 }));
    assert.ok(share(o1, 220, 1) > 0.985, "P = 1: the fundamental goes to A");
    for (let h = 2; h <= 12; h++) assert.ok(share(o1, 220 * h, 2) > 0.985, `P = 1: harmonic ${h} goes to B`);
    const r1 = energy(o1.a.L, W0, W1) / energy(o1.b.L, W0, W1);
    assert.ok(r1 > 1.3 && r1 < 1.8, `P = 1: A carries just the fundamental (energy A / B ${r1.toFixed(2)}, expected 1 / 0.645)`);
    const o3 = splitRef(saw, saw, 2048, Object.assign({}, P0, { hpat: 3 }));
    for (let h = 1; h <= 9; h++) assert.ok(share(o3, 220 * h, (h - 1) % 3 === 0 ? 1 : 2) > 0.985, `P = 3: harmonic ${h}`);
    for (let h = 1; h <= 40; h++) assert.strictEqual(cfg.hsIsA(h, 2), h % 2 === 1 ? 1 : 0, "hsIsA pattern 2");
    assert.strictEqual(cfg.hsIsA(1, 1), 1);
    assert.strictEqual(cfg.hsIsA(2, 1), 0);
    assert.strictEqual(cfg.hsIsA(5, 4), 1);
    assert.strictEqual(cfg.hsIsA(6, 4), 0);

    // --- Maximum Harmonics, Low-cut, High-cut ---
    const om = splitRef(saw, saw, 2048, Object.assign({}, P0, { hmaxp: 8 }));
    assert.ok(share(om, 220 * 8, 2) > 0.95 && share(om, 220 * 10, 0) > 0.95 && share(om, 220 * 15, 0) > 0.95, "Maximum Harmonics 8: harmonic 8 stays, 10 and 15 go to Nonharmonics");
    // Maximum Harmonics 0 = Off: no limit (harmonic 60 = 13.2 kHz is still sorted into B / A)
    assert.ok(share(splitRef(saw, saw, 2048, P0), 220 * 20, 2) > 0.95, "Max Harmonics Off: harmonic 20 (even) is sorted into B");
    // Detection Low-cut / High-cut LIMIT WHERE THE FUNDAMENTAL IS SEARCHED (candidate grid inside the band); once f0 is found, harmonics
    // above High-cut (and below Low-cut) are still sorted.
    const f0of = (sig, n, q) => { const o = splitRef(sig, sig, n, Object.assign({}, P0, q)); return o.trace[o.trace.length - 1].f0; };
    const base0 = splitRef(saw, saw, 2048, P0);
    for (const q of [{ fhi: 2000 }, { flo: 150, fhi: 400 }, { flo: 19.4, fhi: 19900 }]) {
        const oc = splitRef(saw, saw, 2048, Object.assign({}, P0, q));
        const lc = oc.trace[oc.trace.length - 1];
        assert.ok(Math.abs(lc.f0 / 220 - 1) < 0.01, `band ${JSON.stringify(q)}: 220 Hz is inside it and is found (${lc.f0})`);
        for (const h of [1, 2, 3, 8, 11, 20]) assert.ok(share(oc, 220 * h, h % 2 === 1 ? 1 : 2) > 0.95, `band ${JSON.stringify(q)}: harmonic ${h} outside the band is still sorted into ${h % 2 === 1 ? "A" : "B"}`);
    }
    {
        const lc = base0.trace[base0.trace.length - 1];
        assert.ok(Math.abs(lc.f0 / 220 - 1) < 0.005, "defaults (80 Hz .. 1.5 kHz): 110 Hz saw below tracks 220 here");
        const s110 = sawSig(110, 1, 0.25);
        assert.ok(Math.abs(f0of(s110, 2048, {}) / 110 - 1) < 0.01, "110 Hz saw with the defaults tracks 110");
        // fundamental below Low-cut: not found as 110. Documented result: the comb has no candidate below Low/sqrt2 and a candidate
        // inside the band (e.g. 220, 330) is a sub-/non-harmonic of the real series, so f0 is either 0 or a candidate inside [Low/sqrt2, High*sqrt2]
        const lo = f0of(s110, 2048, { flo: 300 });
        console.log("  110 Hz saw, Low 300:", lo);
        assert.ok(Math.abs(lo / 330 - 1) < 0.01, `Low-cut 300 Hz: the root of a 110 Hz saw is its lowest in-band partial, 330 Hz (got ${lo})`);
        const hi = f0of(saw, 2048, { fhi: 100, flo: 19.4 });
        console.log("  220 Hz saw, High 100:", hi);
        assert.ok(Math.abs(hi / 220 - 1) > 0.05 && (hi === 0 || hi <= 100 * 1.4143), `High-cut 100 Hz: f0 of a 220 Hz saw is not 220 (got ${hi})`);
        // the search reaches the full 19.4 Hz .. 19.9 kHz range: a 2.5 kHz saw (above the old 1.75 kHz limit)
        const s25 = sawSig(2500, 1, 0.25);
        assert.ok(Math.abs(f0of(s25, 2048, { flo: 80, fhi: 19900 }) / 2500 - 1) < 0.01, "2.5 kHz saw with High-cut 19.9 kHz tracks 2.5 kHz");
        assert.ok(Math.abs(f0of(s25, 2048, { flo: 80, fhi: 1500 }) / 2500 - 1) > 0.05, "2.5 kHz saw with the default High-cut 1.5 kHz is not tracked as 2.5 kHz");
        // empty band
        for (const q of [{ flo: 1000, fhi: 1000 }, { flo: 2000, fhi: 500 }]) {
            const oe = splitRef(saw, saw, 2048, Object.assign({}, P0, q));
            assert.strictEqual(oe.trace[oe.trace.length - 1].f0, 0, `empty band ${JSON.stringify(q)}: no fundamental`);
            assert.ok(energy(oe.a.L, W0, W1) + energy(oe.b.L, W0, W1) < 1e-9 * energy(oe.nh.L, W0, W1), `empty band ${JSON.stringify(q)}: all Nonharmonics`);
        }
        // 60 Hz saw: tracked when the band reaches it, not when Low-cut is 300 Hz
        const f60 = sawSig(60, 1, 0.25);
        assert.ok(Math.abs(f0of(f60, 4096, { flo: 19.4 }) / 60 - 1) < 0.02, "60 Hz saw tracked with Low-cut 19.4 Hz");
        const l60 = f0of(f60, 4096, { flo: 300 });
        assert.ok(Math.abs(l60 / 60 - 1) > 0.05, `60 Hz saw is not tracked as 60 with Low-cut 300 Hz (got ${l60})`);
    }
    // Detection filters attenuate only the analysis: a strong in-band sine beats an out-of-band one in the level (hs_prep att)
    {
        const lvA = splitRef(sawSig(220, 1, 0.25), sawSig(220, 1, 0.25), 2048, P0).trace[40].lvl;
        const lvB = splitRef(sawSig(220, 1, 0.25), sawSig(220, 1, 0.25), 2048, Object.assign({}, P0, { flo: 1000, fhi: 1400 })).trace[40].lvl;
        assert.ok(lvB < lvA - 6, `the detection level is measured through the cut filters (${lvA.toFixed(1)} vs ${lvB.toFixed(1)} dB)`);
    }

    // --- Detection Threshold ---
    const oth = splitRef(saw, saw, 2048, Object.assign({}, P0, { thr: -10 }));
    assert.ok(energy(oth.a.L, W0, W1) + energy(oth.b.L, W0, W1) < 1e-6 * energy(oth.nh.L, W0, W1), "level below the Detection Threshold: everything in Nonharmonics");
    const oq = splitRef(sawSig(220, 1, 0.0003), sawSig(220, 1, 0.0003), 2048, Object.assign({}, P0, { thr: -60 }));
    assert.ok(energy(oq.a.L, W0, W1) + energy(oq.b.L, W0, W1) < 1e-6 * energy(oq.nh.L, W0, W1), "a -70 dB signal is below a -60 dB threshold");
    // Automatic (Threshold at -120 dB): follows the running level, so a quiet signal is still split ...
    const oqa = splitRef(sawSig(220, 1, 0.0003), sawSig(220, 1, 0.0003), 2048, P0);
    assert.ok(energy(oqa.nh.L, W0, W1) < 0.05 * (energy(oqa.a.L, W0, W1) + energy(oqa.b.L, W0, W1)), "Automatic threshold: a -70 dB sawtooth is still split into A / B");
    // ... and the effective threshold sits 40 dB under the running level (never below -100 dB)
    {
        const tr = oqa.trace;
        const f = tr[tr.length - 1];
        assert.ok(f.lvl > -75 && f.lvl < -50, `-70 dB sawtooth: level ${f.lvl.toFixed(1)} dB`);
        const quietNoise = noiseSig(1e-6, 3);
        const oqn = splitRef(quietNoise, quietNoise, 2048, P0);
        assert.ok(oqn.trace.slice(5).every((fr) => fr.f0 === 0), "Automatic threshold: very quiet noise is never tracked");
    }
    // Automatic: a note that decays 50 dB below the running peak is dropped (everything to Nonharmonics), an explicit -120 dB-free threshold is not needed
    {
        const ln = SR * 3;
        const dec = new Float64Array(ln);
        for (let i = 0; i < ln; i++) {
            let sv = 0;
            for (let h = 1; h * 220 < 20000; h++) sv += Math.sin((2 * Math.PI * 220 * h * i) / SR) / h;
            const env = i < SR * 0.5 ? 0.25 : 0.25 * Math.pow(10, -(Math.min(i - SR * 0.5, SR * 0.1)) / SR * 600 / 20);  // 600 dB/s: -60 dB within 0.1 s, then constant
            dec[i] = env * sv;
        }
        const od = splitRef(dec, dec, 2048, P0);
        const early = od.trace[Math.floor(SR * 0.4 / 512)];
        const late = od.trace[Math.floor(SR * 0.7 / 512)];
        assert.ok(early.v > 0.9, "Automatic: the loud note is voiced");
        assert.ok(late.f0 === 0 || late.v < 0.05, `Automatic: a level 60 dB below the recent peak is not split (v ${late.v.toFixed(2)})`);
        const early2 = splitRef(dec, dec, 2048, Object.assign({}, P0, { thr: -100 })).trace[Math.floor(SR * 0.7 / 512)];
        assert.ok(early2.v > 0.9, "an explicit -100 dB threshold keeps splitting the decayed note");
    }

    // --- fundamental missing / tilt ---
    const nf = sawSig(220, 2, 0.25);
    const onf = splitRef(nf, nf, 2048, P0);
    {
        const lf = onf.trace[onf.trace.length - 1];
        assert.ok(Math.abs(lf.series / 220 - 1) < 0.01, `series f0 found with the fundamental missing (${lf.series})`);
        // the root is the lowest PRESENT partial inside the band: 440 Hz (series harmonic 2), numbered 1 for the pattern
        assert.ok(Math.abs(lf.f0 / 440 - 1) < 0.01 && lf.hr === 2, `missing fundamental: root is the 2nd series harmonic, 440 Hz (got ${lf.f0}, h ${lf.hr})`);
    }
    for (const f of [60, 110, 440, 1000]) {
        const o2 = splitRef(sawSig(f, 1, 0.25), sawSig(f, 1, 0.25), 4096, Object.assign({}, P0, { flo: 19.4 }));
        assert.ok(Math.abs(o2.trace[o2.trace.length - 1].f0 / f - 1) < 0.01, `f0 ${f} Hz tracked within 1 % (${o2.trace[o2.trace.length - 1].f0})`);
    }

    // --- noise only goes to Nonharmonics; sine alone is not a harmonic series ---
    const nz = noiseSig(0.3, 9);
    const onz = splitRef(nz, nz, 2048, P0);
    assert.ok(energy(onz.nh.L, W0, W1) / (energy(onz.nh.L, W0, W1) + energy(onz.a.L, W0, W1) + energy(onz.b.L, W0, W1)) > 0.999, "white noise: everything in Nonharmonics");
    assert.ok(onz.trace.slice(10).every((f) => f.f0 === 0), "white noise: no fundamental is ever tracked");

    for (const n of [1024, 2048, 4096]) {
        for (const seed of [1, 7, 13, 21]) {
            const nz2 = noiseSig(0.3, seed, SR * 2);
            const o2 = splitRef(nz2, nz2, n, P0);
            assert.ok(o2.trace.slice(5).every((f) => f.f0 === 0), `white noise (seed ${seed}, Size ${n}): the tracker never locks (needs salience >= ${cfg.HS_ACCEPT} twice in a row)`);
        }
    }

    // --- saw + noise: noise mostly in Nonharmonics, partials in A / B; no flicker ---
    // the weak upper partials (above harmonic 40) flicker in and out under noise, so the stability checks use Max Harmonics 40
    const PSN = Object.assign({}, P0, { hmaxp: 40 });
    const sn = add(sawSig(220, 1, 0.15), noiseSig(0.02, 4));
    const osn = splitRef(sn, sn, 2048, PSN);
    const settled = osn.trace.slice(12);
    assert.ok(settled.every((f) => f.f0 > 218 && f.f0 < 222 && f.v > 0.99), "saw + noise: f0 stays within 1 % and voiced in every settled frame (no flicker)");
    const nact = settled.map((f) => f.nact);
    assert.ok(Math.max(...nact) - Math.min(...nact) <= 2, `saw + noise: the number of active harmonics is stable (${Math.min(...nact)}..${Math.max(...nact)})`);
    let nhMid = 0, hMid = 0;
    for (const f of [330, 550, 770, 990, 1210, 1430]) {      // half way between the harmonics
        nhMid += share(osn, f, 0);
        hMid += 1 - share(osn, f, 0);
    }
    assert.ok(nhMid / 6 > 0.9, `noise between the partials is mostly in Nonharmonics (${(nhMid / 6).toFixed(3)})`);
    for (let h = 1; h <= 6; h++) assert.ok(share(osn, 220 * h, 0) < 0.02, `partial ${h} stays out of Nonharmonics with noise present`);
    const noiseOnly = noiseSig(0.02, 4);
    const nzTotal = energy(noiseOnly, W0, W1);
    const nhShare = (energy(osn.nh.L, W0, W1) - energy(splitRef(sawSig(220, 1, 0.15), sawSig(220, 1, 0.15), 2048, PSN).nh.L, W0, W1)) / nzTotal;
    console.log(`[ref] saw + noise: ${(100 * nhShare).toFixed(0)} % of the noise energy lands in Nonharmonics`);
    assert.ok(nhShare > 0.6, "most of the noise energy lands in Nonharmonics");

    // --- Sensitivity: more of the signal goes to the harmonics ---
    let prevShare = 2;
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
        const os = splitRef(sn, sn, 2048, Object.assign({}, PSN, { sens: s }));
        const eN2 = energy(os.nh.L, W0, W1), eT = eN2 + energy(os.a.L, W0, W1) + energy(os.b.L, W0, W1);
        assert.ok(eN2 / eT <= prevShare + 1e-9, `Sensitivity ${s} does not increase the Nonharmonics share`);
        prevShare = eN2 / eT;
    }

    // --- glide: the tracker follows within a few percent ---
    {
        const x = new Float64Array(NS);
        let ph = 0;
        const fAt = (i) => 150 * Math.pow(2, (i / NS) * 1.5);
        for (let i = 0; i < NS; i++) {
            ph += (2 * Math.PI * fAt(i)) / SR;
            let s = 0;
            for (let h = 1; h <= 30; h++) s += Math.sin(h * ph) / h;
            x[i] = 0.25 * s;
        }
        const og = splitRef(x, x, 2048, P0);
        let worst = 0;
        og.trace.forEach((f, idx) => {
            if (idx < 20 || idx > og.trace.length - 5) return;
            const centre = 2048 + idx * 512 - 1024;
            worst = Math.max(worst, Math.abs(f.f0 / fAt(centre) - 1));
        });
        console.log(`[ref] glide 150 -> 424 Hz: worst tracking error ${(100 * worst).toFixed(1)} %`);
        assert.ok(worst < 0.08, "the tracker follows a glide");
    }

    // --- an f0 jump takes two consistent frames (no one-frame octave errors); stereo image; silence ---
    const lonly = splitRef(saw, new Float64Array(NS), 2048, P0);
    assert.ok(energy(lonly.nh.R, 4096, 60000) + energy(lonly.a.R, 4096, 60000) + energy(lonly.b.R, 4096, 60000) < 1e-20, "a left-only signal stays left-only (stereo image kept)");
    const z = splitRef(new Float64Array(16384), new Float64Array(16384), 2048, P0);
    assert.strictEqual(energy(z.nh.L, 0, 16384) + energy(z.a.L, 0, 16384) + energy(z.b.L, 0, 16384), 0, "silence in -> exact zeros out");
    console.log("[ref] analysis and mask reference tests passed");
}

// Mix: the rack sum of K = 3 chains is mix * wet + (1 - mix) * dry
{
    for (const m of [0, 0.25, 0.5, 1]) {
        const wet = [0.7, -0.2, 0.1], dry = 0.6;
        const sum = wet.reduce((a, w) => a + cfg.hsMixOut(w, dry, m, 3), 0);
        assert.ok(Math.abs(sum - (m * (wet[0] + wet[1] + wet[2]) + (1 - m) * dry)) < 1e-12, `rack sum at Mix ${m}`);
    }
    assert.ok(Math.abs(cfg.hsMixOut(0.3, 0.6, 0.5, 1) - 0.45) < 1e-12, "Output All: ordinary dry / wet");
    assert.strictEqual(cfg.hsFmtThr(-120), "Automatic");
    assert.strictEqual(cfg.hsFmtThr(-42.5), "-42.5 dB");
    assert.strictEqual(cfg.hsFmtFreq(80), "80.0 Hz");
    assert.strictEqual(cfg.hsFmtFreq(1500), "1.50 kHz");
    assert.strictEqual(cfg.hsFmtFreq(19900), "19.9 kHz");
}

// Odd-only and gapped spectra (square, triangle, pulse): the comb must not need every harmonic.
// Reproduced bug: a square wave never reached the 0.38 accept (salience 0.23..0.35, f0 = 0) because the even comb terms added nothing.
{
    // waveforms by phase; band-limited (additive, below 0.45 sr) or naive
    const wave = (kind, f0, sr, len, amp, naive) => {
        const x = new Float64Array(len);
        for (let i = 0; i < len; i++) {
            let v = 0;
            const t = (f0 * i / sr) % 1;
            if (naive) v = kind === "square" ? (t < 0.5 ? 1 : -1) : kind === "tri" ? (t < 0.5 ? 4 * t - 1 : 3 - 4 * t) : (t < 0.25 ? 1 : -1);
            else {
                for (let h = 1; h * f0 < sr * 0.45; h++) {
                    let c = 0;
                    if (kind === "square") c = h % 2 ? 4 / (Math.PI * h) : 0;
                    else if (kind === "tri") c = h % 2 ? (8 / (Math.PI * Math.PI * h * h)) * (h % 4 === 1 ? 1 : -1) : 0;
                    else c = (2 * Math.sin(Math.PI * h * 0.25)) / (Math.PI * h);
                    if (c) v += c * Math.sin((2 * Math.PI * f0 * h * i) / sr);
                }
            }
            x[i] = amp * v;
        }
        return x;
    };
    // run hsFrame on a mono signal (Mid = the signal) and return the last frame's tracker state
    const frames = (sig, sr, n, p) => {
        const win = ref.hann(n), half = n / 2, st = cfg.hsNewState(n);
        const mag = new Float64Array(half + 1), re = new Float64Array(n), im = new Float64Array(n);
        let maxSal = 0, locked = 0;
        for (let t = n; t <= sig.length; t += n / 4) {
            for (let i = 0; i < n; i++) { re[i] = sig[t - n + i] * win[i]; im[i] = sig[t - n + i] * win[i]; }
            ref.fft(re, im, false);
            for (let k = 0; k <= half; k++) {
                const k2 = (n - k) % n;
                const ar = re[k], ai = im[k], br = re[k2], bi = -im[k2];
                mag[k] = (Math.hypot((ar + ai + (br - bi)) / 4, (ai - ar + (bi + br)) / 4) * 4) / n;
            }
            cfg.hsFrame(st, mag, p, sr);
            maxSal = Math.max(maxSal, st.hst[11]);
            if (st.hst[20] > 0) locked++;
        }
        return { f0: st.hst[20], series: st.hst[0], hr: st.hst[21], sal: st.hst[11], maxSal, locked };
    };
    const results = [];
    // square waves: every octave from 110 Hz to 880 Hz (the default band reaches 1.5 kHz), both sample rates, both levels
    for (const sr of [44100, 48000]) {
        for (const naive of [false, true]) {
            for (const db of [-6, -30]) {
                for (const f0 of [110, 220, 440, 880]) {
                    const r = frames(wave("square", f0, sr, sr, 0.5 * Math.pow(10, db / 20), naive), sr, 2048, P0);
                    results.push(`sq${f0}`);
                    assert.ok(Math.abs(r.f0 / f0 - 1) < 0.01, `square ${f0} Hz (${naive ? "naive" : "band-limited"}, ${sr}, ${db} dB) tracked within 1 % (f0 ${r.f0.toFixed(2)}, salience ${r.sal.toFixed(2)})`);
                    assert.ok(r.sal > 0.42, `square ${f0} Hz salience ${r.sal.toFixed(2)} has margin over the accept ${cfg.HS_ACCEPT}`);
                }
            }
        }
        // triangle (odd, 1/h^2), 25 % pulse (every 4th harmonic missing)
        for (const f0 of [110, 220]) {
            const r = frames(wave("tri", f0, sr, sr, 0.3, false), sr, 2048, P0);
            assert.ok(Math.abs(r.f0 / f0 - 1) < 0.01, `triangle ${f0} Hz tracked (${sr}): f0 ${r.f0.toFixed(2)}, salience ${r.sal.toFixed(2)}`);
        }
        for (const f0 of [110, 220, 440, 880]) {
            const r = frames(wave("pulse", f0, sr, sr, 0.3, false), sr, 2048, P0);
            assert.ok(Math.abs(r.f0 / f0 - 1) < 0.01, `25 % pulse ${f0} Hz tracked (${sr}): f0 ${r.f0.toFixed(2)}, salience ${r.sal.toFixed(2)}`);
        }
    }
    // no octave errors with the full range open, also a triangle up to 1.76 kHz
    const wide = Object.assign({}, P0, { flo: 19.4, fhi: 19900 });
    for (const f0 of [110, 220, 440, 880, 1760]) {
        for (const kind of ["square", "tri"]) {
            const r = frames(wave(kind, f0, SR, SR, 0.3, false), SR, 2048, wide);
            assert.ok(Math.abs(r.f0 / f0 - 1) < 0.01, `${kind} ${f0} Hz with the full range tracked (f0 ${r.f0.toFixed(2)})`);
        }
    }
    // 55 Hz square needs Size 4k and Low 30 Hz
    {
        const r = frames(wave("square", 55, SR, SR * 2, 0.3, false), SR, 4096, Object.assign({}, P0, { flo: 30 }));
        assert.ok(Math.abs(r.f0 / 55 - 1) < 0.01, `square 55 Hz at Size 4k, Low 30 Hz (f0 ${r.f0.toFixed(2)})`);
    }
    // the band still limits the search for a square: 220 Hz with High 100 Hz finds nothing, with Low 500 Hz it never reports 220
    assert.strictEqual(frames(wave("square", 220, SR, SR, 0.3, false), SR, 2048, Object.assign({}, P0, { fhi: 100 })).f0, 0, "square 220 Hz with High 100 Hz: nothing");
    {
        const r = frames(wave("square", 220, SR, SR, 0.3, false), SR, 2048, Object.assign({}, P0, { flo: 500, fhi: 1500 }));
        assert.ok(r.f0 === 0 || r.f0 >= 500 * 0.7, `square 220 Hz with Low 500 Hz is not reported below the band (f0 ${r.f0})`);
    }
    // white noise: highest salience of any frame stays well under the accept (6 seeds x 3 sizes), and it never locks
    {
        let worst = 0, locks = 0;
        for (const n of [1024, 2048, 4096]) {
            for (let seed = 1; seed <= 6; seed++) {
                const r = frames(noiseSig(0.3, seed, SR / 2), SR, n, P0);
                worst = Math.max(worst, r.maxSal);
                locks += r.locked;
            }
        }
        console.log(`[ref] white noise: highest salience ${worst.toFixed(3)} (accept ${cfg.HS_ACCEPT})`);
        assert.ok(worst < 0.31, `white noise salience ${worst.toFixed(3)} keeps its margin below the accept`);
        assert.strictEqual(locks, 0, "white noise never locks");
    }
    // sorting of a 220 Hz square: Pattern 2 = all odd harmonics in A; Pattern 4 = 1, 5, 9 in A and 3, 7, 11 in B
    const sq = wave("square", 220, SR, NS, 0.25, false);
    const sq2 = splitRef(sq, sq, 2048, P0);
    const lq = sq2.trace[sq2.trace.length - 1];
    assert.ok(Math.abs(lq.f0 / 220 - 1) < 0.005, `square 220 Hz through the full split: f0 ${lq.f0.toFixed(2)}`);
    for (const h of [1, 3, 5, 7, 9, 11]) assert.ok(share(sq2, 220 * h, 1) > 0.985, `square, Pattern 2: harmonic ${h} in A`);
    const eqN = energy(sq2.nh.L, W0, W1), eqA = energy(sq2.a.L, W0, W1), eqB = energy(sq2.b.L, W0, W1);
    assert.ok(eqN / (eqN + eqA + eqB) < 0.02 && eqB / (eqN + eqA + eqB) < 0.02, "square, Pattern 2: A carries it all (NH and B under 2 %)");
    const sq4 = splitRef(sq, sq, 2048, Object.assign({}, P0, { hpat: 4 }));
    for (const h of [1, 5, 9]) assert.ok(share(sq4, 220 * h, 1) > 0.985, `square, Pattern 4: harmonic ${h} in A`);
    for (const h of [3, 7, 11]) assert.ok(share(sq4, 220 * h, 2) > 0.985, `square, Pattern 4: harmonic ${h} in B`);
    {
        let err = 0, tot = 0;
        for (let i = 2048; i < NS - 2048; i++) { const d = sq4.nh.L[i] + sq4.a.L[i] + sq4.b.L[i] - sq[i]; err += d * d; tot += sq[i] * sq[i]; }
        assert.ok(10 * Math.log10(err / tot + 1e-300) < -250, "square: three channels still null against the input");
    }

    // ---- ROOT detection: the user's report (C1 square, Low 156.1 Hz, High 2.90 kHz, Every 8th, NH Sens 50 %, Automatic, Size 2k) ----
    // The series fundamental (32.7 Hz) lies below the band; the ROOT is the lowest present partial inside it (5th harmonic, 163.5 Hz) and the
    // pattern counts from it: h' = h - hr + 1. Series partials below the root (32.7, 98.1 Hz) are Nonharmonics.
    {
        const PU = { hpat: 8, hmaxp: 0, sens: 0.5, tilt: 0, thr: -120, flo: 156.1, fhi: 2900 };
        const rootRes = [];
        for (const sr of [48000, 44100]) {
            const sqc = wave("square", 32.7, sr, Math.round(sr * 2), 0.25, false);
            const r = frames(sqc, sr, 2048, PU);
            rootRes.push(`${sr}: root ${r.f0.toFixed(2)} (series ${r.series.toFixed(2)}, h ${r.hr}, salience ${r.sal.toFixed(2)})`);
            assert.ok(Math.abs(r.f0 / 163.5 - 1) < 0.01, `C1 square (${sr}): root ${r.f0.toFixed(2)} Hz is the 5th harmonic, 163.5 Hz`);
            assert.ok(Math.abs(r.series / 32.7 - 1) < 0.01 && r.hr === 5, `C1 square (${sr}): series f0 ${r.series.toFixed(2)} Hz, root harmonic ${r.hr}`);
            assert.ok(r.sal > 0.42, `C1 square (${sr}): salience ${r.sal.toFixed(2)} has margin over the accept`);
            // every settled frame has the root (no flicker)
            const o = splitRef(sqc, sqc, 2048, PU, sr);
            const tr = o.trace.slice(14);
            assert.ok(tr.every((f) => Math.abs(f.f0 / 163.5 - 1) < 0.01), `C1 square (${sr}): the root is reported in every settled frame`);
            // Pattern 8 counting from the root: h' = 1, 9, 17 (series h = 5, 13, 21 = 163.5, 425.1, 686.7 Hz) in A, the other odd partials in B
            for (const h of [5, 13, 21, 29]) assert.ok(share(o, 32.7 * h, 1, sr) > 0.9, `C1 square (${sr}), Every 8th: series harmonic ${h} (h' ${h - 4}) in A (${share(o, 32.7 * h, 1, sr).toFixed(3)})`);
            for (const h of [7, 9, 11, 15, 17, 19, 23, 25]) assert.ok(share(o, 32.7 * h, 2, sr) > 0.9, `C1 square (${sr}), Every 8th: series harmonic ${h} (h' ${h - 4}) in B (${share(o, 32.7 * h, 2, sr).toFixed(3)})`);
            for (const h of [1, 3]) assert.ok(share(o, 32.7 * h, 0, sr) > 0.9, `C1 square (${sr}): series harmonic ${h} is below the root and goes to Nonharmonics (${share(o, 32.7 * h, 0, sr).toFixed(3)})`);
            let err = 0, tot = 0;
            for (let i = 2048; i < sqc.length - 2048; i++) { const d = o.nh.L[i] + o.a.L[i] + o.b.L[i] - sqc[i]; err += d * d; tot += sqc[i] * sqc[i]; }
            assert.ok(10 * Math.log10(err / tot + 1e-300) < -250, `C1 square (${sr}): three channels null against the input`);
        }
        console.log("[ref] C1 square, band 156.1 Hz .. 2.9 kHz, Size 2k:", rootRes.join("; "));
        // also at Size 4k and 1k, and quieter
        for (const [n, db] of [[4096, 0], [2048, -30], [2048, -6]]) {
            const r = frames(wave("square", 32.7, SR, SR * 2, 0.25 * Math.pow(10, db / 20), false), SR, n, PU);
            assert.ok(Math.abs(r.f0 / 163.5 - 1) < 0.01, `C1 square Size ${n}, ${db} dB: root ${r.f0.toFixed(2)}`);
        }
        // naive (aliased) square
        {
            const r = frames(wave("square", 32.7, SR, SR * 2, 0.25, true), SR, 2048, PU);
            assert.ok(Math.abs(r.f0 / 163.5 - 1) < 0.01, `C1 naive square: root ${r.f0.toFixed(2)}`);
        }
        // C1 sawtooth (all harmonics, 1.4 bins apart at Size 2k): needs Size 4k (2.8 bins); the root is again the 5th harmonic
        {
            const r = frames(sawAt(32.7, SR, SR * 2, 0.25), SR, 4096, PU);
            console.log(`[ref] C1 saw, Size 4k: root ${r.f0.toFixed(2)} (series ${r.series.toFixed(2)}, h ${r.hr}, salience ${r.sal.toFixed(2)})`);
            assert.ok(Math.abs(r.f0 / 163.5 - 1) < 0.01 && r.hr === 5, `C1 saw at Size 4k: root ${r.f0.toFixed(2)}`);
            const sw = sawAt(32.7, SR, SR * 2, 0.25);
            const o = splitRef(sw, sw, 4096, PU);
            for (const h of [5, 13, 21]) assert.ok(share(o, 32.7 * h, 1) > 0.85, `C1 saw Size 4k, Every 8th: series harmonic ${h} in A (${share(o, 32.7 * h, 1).toFixed(3)})`);
            for (const h of [6, 7, 8, 9, 10, 14]) assert.ok(share(o, 32.7 * h, 2) > 0.85, `C1 saw Size 4k, Every 8th: series harmonic ${h} in B (${share(o, 32.7 * h, 2).toFixed(3)})`);
            const r2 = frames(sawAt(32.7, 44100, 44100 * 2, 0.25), 44100, 4096, PU);
            assert.ok(Math.abs(r2.f0 / 163.5 - 1) < 0.01, `C1 saw Size 4k (44.1 kHz): root ${r2.f0.toFixed(2)}`);
            // at Size 2k its partials are only 1.4 bins apart (a 2048 sample frame holds 1.4 periods): not resolvable, so nothing is reported rather than a wrong root
            const r3 = frames(sawAt(32.7, SR, SR * 2, 0.25), SR, 2048, PU);
            assert.ok(r3.f0 === 0, `C1 saw at Size 2k is not resolvable: no root (got ${r3.f0})`);
        }
        // 110 Hz sawtooth with Low 300 Hz: series 110, root 330 (3rd harmonic), pattern counts from it (h' = h - 2): 110 / 220 Hz to Nonharmonics
        {
            const s110 = sawSig(110, 1, 0.25);
            const P3 = Object.assign({}, P0, { flo: 300 });
            const o = splitRef(s110, s110, 2048, P3);
            const lt = o.trace[o.trace.length - 1];
            assert.ok(Math.abs(lt.f0 / 330 - 1) < 0.01 && Math.abs(lt.series / 110 - 1) < 0.01 && lt.hr === 3, `110 Hz saw, Low 300: root ${lt.f0.toFixed(2)}, series ${lt.series.toFixed(2)}, h ${lt.hr}`);
            for (const h of [3, 5, 7, 9]) assert.ok(share(o, 110 * h, 1) > 0.985, `110 Hz saw, Low 300, Every 2nd: harmonic ${h} (h' ${h - 2}, odd) in A`);
            for (const h of [4, 6, 8]) assert.ok(share(o, 110 * h, 2) > 0.985, `110 Hz saw, Low 300, Every 2nd: harmonic ${h} (h' ${h - 2}, even) in B`);
            for (const h of [1, 2]) assert.ok(share(o, 110 * h, 0) > 0.95, `110 Hz saw, Low 300: harmonic ${h} is below the root, Nonharmonics`);
        }
        // Maximum Harmonics counts from the root: 4 keeps series harmonics 5, 6, 7, 8 (only 5 and 7 exist in a square), 9 and up go to Nonharmonics
        {
            const sqc = wave("square", 32.7, SR, SR * 2, 0.25, false);
            const o = splitRef(sqc, sqc, 2048, Object.assign({}, PU, { hmaxp: 4, hpat: 2 }));
            for (const h of [5, 7]) assert.ok(share(o, 32.7 * h, 1) > 0.9, `C1 square, Max Harm 4: series harmonic ${h} (h' ${h - 4}) is still sorted (${share(o, 32.7 * h, 1).toFixed(3)})`);
            for (const h of [9, 11, 13]) assert.ok(share(o, 32.7 * h, 0) > 0.9, `C1 square, Max Harm 4: series harmonic ${h} (h' ${h - 4}) is beyond the limit, Nonharmonics (${share(o, 32.7 * h, 0).toFixed(3)})`);
            // Pattern 1st only: only the root is in A
            const o1 = splitRef(sqc, sqc, 2048, Object.assign({}, PU, { hpat: 1 }));
            assert.ok(share(o1, 163.5, 1) > 0.9 && share(o1, 32.7 * 7, 2) > 0.9 && share(o1, 32.7 * 9, 2) > 0.9, "C1 square, Pattern 1st only: the root alone in A, the other partials in B");
        }
        // an empty band or Low >= High reports nothing; with the full range the C1 series is found at its own fundamental (root = series f0)
        {
            const sqc = wave("square", 32.7, SR, SR * 2, 0.25, false);
            assert.strictEqual(frames(sqc, SR, 2048, Object.assign({}, PU, { flo: 2900, fhi: 156.1 })).locked, 0, "Low >= High: no root");
            const rw = frames(sqc, SR, 4096, Object.assign({}, PU, { flo: 19.4, fhi: 19900 }));
            assert.ok(Math.abs(rw.f0 / 32.7 - 1) < 0.01 && rw.hr === 1, `C1 square with the full range at Size 4k: root = fundamental (${rw.f0.toFixed(2)}, h ${rw.hr})`);
        }
        // white noise in the user's band never gets a root or a series, all three sizes
        for (const n of [1024, 2048, 4096]) for (const seed of [2, 5, 11]) {
            const r = frames(noiseSig(0.3, seed, SR), SR, n, PU);
            assert.strictEqual(r.locked, 0, `white noise (seed ${seed}, Size ${n}, band 156.1 .. 2900 Hz): no root`);
            assert.ok(r.maxSal < 0.34, `white noise salience ${r.maxSal.toFixed(3)} in the user's band (Size ${n}) stays under the accept ${cfg.HS_ACCEPT} (a lock also needs two consecutive hops)`);
        }
        // A 220 Hz saw / square with the defaults is unchanged: root = f0, numbering untouched
        for (const kind of ["saw", "square"]) {
            const r = frames(wave(kind, 220, SR, SR, 0.25, false), SR, 2048, P0);
            assert.ok(Math.abs(r.f0 / 220 - 1) < 0.005 && r.hr === 1 && Math.abs(r.series / 220 - 1) < 0.005, `${kind} 220 Hz defaults: root = series = 220 (${r.f0.toFixed(2)}, h ${r.hr})`);
        }
        // a series wholly above High (2.5 kHz saw, default band) has no root
        assert.strictEqual(frames(sawSig(2500, 1, 0.25), SR, 2048, P0).f0, 0, "2.5 kHz saw with High 1.5 kHz: no root");
    }
    console.log("[ref] square / triangle / pulse tracking tests passed");
}

// ======================================================================
// 2. GenExpr functions transpiled to JS: lib + hs_* match the reference
// ======================================================================
function prep(src) {
    return src
        .replace(/(?<![.\w])poke\((\w+),\s*/g, "$1.poke(")
        .replace(/\blog10\(/g, "Math.log10(")
        .replace(/\batan2\(/g, "Math.atan2(");
}
{
    const loadGx = () => load(prep(LIB_SRC), prep(SS_SRC), prep(CORE_SRC.split("\nBuffer scope(")[0]));
    const run = (n, sel, p, x, y, frames) => {
        const gx = loadGx();
        const half = n / 2;
        const tab = new DataSim(4096, 3), win = new DataSim(4096), fx = new DataSim(4096, 2);
        const ringL = new DataSim(4096), ringR = new DataSim(4096), accL = new DataSim(4096), accR = new DataSim(4096);
        const stt = new DataSim(8), ms = new DataSim(2049, 2), hsd = new DataSim(2049, 10), hp = new DataSim(406, 5), hst = new DataSim(32), sal = new DataSim(710, 5);
        const cols = new DataSim(512), scope = new DataSim(544);
        const outL = new Float64Array(x.length), outR = new Float64Array(x.length);
        let age = 0;
        const masks = [];
        for (let i = 0; i < x.length; i++) {
            gx.fft_init(tab);
            gx.stft_win(win, n);
            const rdy = gx.ss_in(ringL, ringR, stt, x[i], y[i], n);
            if (rdy > 0.5) {
                gx.ss_frame(fx, ringL, ringR, stt, win, n);
                gx.fft_run(fx, tab, n, 0);
                gx.ss_mid(fx, ms, n);
                if (age < 0.5) gx.hs_reset(hst, hp);
                gx.hs_prep(ms, hsd, hst, n, SR, p.flo, p.fhi, p.tilt);
                gx.hs_sal(hsd, sal, hst, n, SR, p.flo, p.fhi);
                gx.hs_decide(hst, p.thr, cfg.HS_ACCEPT, 3 * n / SR);
                gx.hs_harm(hsd, hp, hst, n, SR);
                gx.hs_post(hst);
                gx.hs_masks(hsd, hp, hst, n, SR, p.sens, p.hpat, p.hmaxp < 0.5 ? 404 : p.hmaxp, p.flo, p.fhi);
                age = Math.min(age + 1, 3);
                if (masks.length < frames) {
                    masks.push({
                        mag: Array.from({ length: half + 1 }, (_, k) => ms.peek(k, 0)),
                        mN: Array.from({ length: half + 1 }, (_, k) => hsd.peek(k, 0)),
                        mA: Array.from({ length: half + 1 }, (_, k) => hsd.peek(k, 1)),
                        mB: Array.from({ length: half + 1 }, (_, k) => hsd.peek(k, 2)),
                        hst: Array.from({ length: 26 }, (_, k) => hst.peek(k))
                    });
                }
                gx.ss_apply(fx, hsd, sel === 3 ? 2 : (sel === 2 ? 1 : (sel === 1 ? 0 : 3)), n);
                if (i % 4096 < 600) {
                    gx.ss_cols(ms, 0, hsd, -1, cols, 0, n, SR, 128, 30, 20000);
                    gx.ss_cols(ms, 0, hsd, 0, cols, 1, n, SR, 128, 30, 20000);
                    gx.ss_cols(ms, 0, hsd, 1, cols, 2, n, SR, 128, 30, 20000);
                    gx.ss_cols(ms, 0, hsd, 2, cols, 3, n, SR, 128, 30, 20000);
                    gx.ss_tele(cols, scope, 128, 4, 0);
                }
                gx.fft_run(fx, tab, n, 1);
                gx.ss_ola(accL, accR, stt, fx, win, n);
            }
            outL[i] = gx.ss_out(accL, stt, n, 3);
            outR[i] = gx.ss_out(accR, stt, n, 4);
        }
        return { outL, outR, masks, scope };
    };

    const n = 2048;
    const N = 40000;
    const x = add(sawSig(220, 1, 0.12, N), noiseSig(0.02, 21, N));
    const y = x.map((v, i) => 0.7 * v + 0.01 * Math.sin(i * 0.031));
    // latency n - 1 and identity: the All selection equals the input delayed by n - 1
    {
        const g = run(n, 0, P0, x, y, 4);
        let e = 0, t = 0;
        for (let i = n; i < N; i++) {
            const dl = g.outL[i] - x[i - (n - 1)], dr = g.outR[i] - y[i - (n - 1)];
            e += dl * dl + dr * dr;
            t += x[i - (n - 1)] ** 2 + y[i - (n - 1)] ** 2;
        }
        assert.ok(10 * Math.log10(e / t) < -250, `ss_* chain with the All selection is an exact delayed identity (got ${10 * Math.log10(e / t)} dB)`);
    }
    // the three outputs add up to the input delayed by n - 1, for a few settings
    for (const p of [P0, Object.assign({}, P0, { hpat: 4, sens: 0.9, tilt: 5 }), Object.assign({}, P0, { hpat: 1, hmaxp: 12, flo: 150, fhi: 3000, thr: -50 })]) {
        const a = run(n, 1, p, x, y, 4), b = run(n, 2, p, x, y, 4), c = run(n, 3, p, x, y, 4);
        let e = 0, t = 0;
        for (let i = n; i < N; i++) {
            const dl = a.outL[i] + b.outL[i] + c.outL[i] - x[i - (n - 1)], dr = a.outR[i] + b.outR[i] + c.outR[i] - y[i - (n - 1)];
            e += dl * dl + dr * dr;
            t += x[i - (n - 1)] ** 2 + y[i - (n - 1)] ** 2;
        }
        assert.ok(10 * Math.log10(e / t) < -250, `Nonharmonics + A + B null against the delayed input (got ${10 * Math.log10(e / t)} dB)`);
        assert.ok(energy(a.outL, 0, N) > 0 && energy(b.outL, 0, N) > 0 && energy(c.outL, 0, N) > 0, "all three channels carry signal");
    }
    // GenExpr masks and tracker state match the reference frame for frame
    for (const p of [P0, Object.assign({}, P0, { hpat: 3, sens: 0.8, tilt: -6, hmaxp: 30 }), Object.assign({}, P0, { hpat: 1, flo: 300, fhi: 5000, thr: -40 }), Object.assign({}, P0, { thr: -120, flo: 150, fhi: 8000, tilt: 3 }), Object.assign({}, P0, { flo: 150, fhi: 400 }), Object.assign({}, P0, { flo: 400, fhi: 400 }), Object.assign({}, P0, { flo: 19.4, fhi: 19900 })]) {
        const g = run(n, 1, p, x, y, 60);
        const st = cfg.hsNewState(n);
        let maxd = 0, maxs = 0;
        for (const f of g.masks) {
            cfg.hsFrame(st, Float64Array.from(f.mag), p, SR);
            for (let k = 0; k <= n / 2; k++) maxd = Math.max(maxd, Math.abs(st.mN[k] - f.mN[k]), Math.abs(st.mA[k] - f.mA[k]), Math.abs(st.mB[k] - f.mB[k]));
            for (const i of [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) maxs = Math.max(maxs, Math.abs(st.hst[i] - f.hst[i]));
        }
        assert.ok(maxd < 1e-9, `GenExpr masks equal the JS reference (max diff ${maxd})`);
        assert.ok(maxs < 1e-9, `GenExpr tracker state equals the JS reference (max diff ${maxs})`);
        const f0g = g.masks[g.masks.length - 1].hst[0];
        if (p.flo >= p.fhi) assert.strictEqual(f0g, 0, "the transpiled tracker finds nothing in an empty band");
        else if (p.flo > 220 * 1.5) assert.ok(Math.abs(f0g / 220 - 1) > 0.05, "the transpiled tracker does not report 220 Hz when it is below Low-cut");
        else assert.ok(Math.abs(f0g / 220 - 1) < 0.01, "the transpiled tracker finds the sawtooth " + JSON.stringify(p) + " f0=" + f0g);
    }
    // a square wave (odd comb) in the transpiled GenExpr: same tracker state as the reference, and f0 found
    {
        const xs = new Float64Array(N), ys = new Float64Array(N);
        for (let i = 0; i < N; i++) {
            let v = 0;
            for (let h = 1; h * 220 < 20000; h += 2) v += Math.sin((2 * Math.PI * 220 * h * i) / SR) / h;
            xs[i] = 0.25 * v;
            ys[i] = 0.5 * xs[i];
        }
        const g = run(n, 1, P0, xs, ys, 60);
        const st = cfg.hsNewState(n);
        let maxd = 0, maxs = 0;
        for (const f of g.masks) {
            cfg.hsFrame(st, Float64Array.from(f.mag), P0, SR);
            for (let k = 0; k <= n / 2; k++) maxd = Math.max(maxd, Math.abs(st.mN[k] - f.mN[k]), Math.abs(st.mA[k] - f.mA[k]), Math.abs(st.mB[k] - f.mB[k]));
            for (const i of [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) maxs = Math.max(maxs, Math.abs(st.hst[i] - f.hst[i]));
        }
        assert.ok(maxd < 1e-9 && maxs < 1e-9, `GenExpr equals the reference on a square wave (masks ${maxd}, state ${maxs})`);
        assert.ok(Math.abs(g.masks[g.masks.length - 1].hst[0] / 220 - 1) < 0.01, "the transpiled tracker finds the square wave");
    }
    // ROOT detection in the transpiled GenExpr (series below the band, unresolved ripple regime): C1 square at Size 2k and C1 sawtooth at 4k, the user's band
    {
        const PU = { hpat: 8, hmaxp: 0, sens: 0.5, tilt: 0, thr: -120, flo: 156.1, fhi: 2900 };
        for (const [kind, nn, expectRoot] of [["square", 2048, 163.5], ["saw", 4096, 163.5], ["square", 4096, 163.5]]) {
            const xs = new Float64Array(N), ys = new Float64Array(N);
            for (let i = 0; i < N; i++) {
                let v = 0;
                for (let h = 1; h * 32.7 < SR * 0.45; h++) {
                    if (kind === "square" && h % 2 === 0) continue;
                    v += (kind === "square" ? 4 / (Math.PI * h) : 1 / h) * Math.sin((2 * Math.PI * 32.7 * h * i) / SR);
                }
                xs[i] = 0.25 * v;
                ys[i] = 0.5 * xs[i];
            }
            const g = run(nn, 1, PU, xs, ys, 80);
            const st = cfg.hsNewState(nn);
            let maxd = 0, maxs = 0;
            for (const f of g.masks) {
                cfg.hsFrame(st, Float64Array.from(f.mag), PU, SR);
                for (let k = 0; k <= nn / 2; k++) maxd = Math.max(maxd, Math.abs(st.mN[k] - f.mN[k]), Math.abs(st.mA[k] - f.mA[k]), Math.abs(st.mB[k] - f.mB[k]));
                for (const i of [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) maxs = Math.max(maxs, Math.abs(st.hst[i] - f.hst[i]));
            }
            assert.ok(maxd < 1e-9 && maxs < 1e-9, `GenExpr equals the reference on the C1 ${kind} at Size ${nn} (masks ${maxd}, state ${maxs})`);
            const lastH = g.masks[g.masks.length - 1].hst;
            assert.ok(Math.abs(lastH[20] / expectRoot - 1) < 0.01 && lastH[21] === 5 && Math.abs(lastH[0] / 32.7 - 1) < 0.01, `the transpiled tracker finds root ${lastH[20]} (series ${lastH[0]}, h ${lastH[21]}) of the C1 ${kind} at Size ${nn}`);
        }
        // sum identity with the root numbering (Every 8th counts from the root)
        const xs = new Float64Array(N), ys = new Float64Array(N);
        for (let i = 0; i < N; i++) {
            let v = 0;
            for (let h = 1; h * 32.7 < SR * 0.45; h += 2) v += (4 / (Math.PI * h)) * Math.sin((2 * Math.PI * 32.7 * h * i) / SR);
            xs[i] = 0.25 * v;
            ys[i] = 0.5 * xs[i];
        }
        const a = run(2048, 1, PU, xs, ys, 4), b = run(2048, 2, PU, xs, ys, 4), c = run(2048, 3, PU, xs, ys, 4);
        let e = 0, t = 0;
        for (let i = 2048; i < N; i++) {
            const dl = a.outL[i] + b.outL[i] + c.outL[i] - xs[i - 2047], dr = a.outR[i] + b.outR[i] + c.outR[i] - ys[i - 2047];
            e += dl * dl + dr * dr;
            t += xs[i - 2047] ** 2 + ys[i - 2047] ** 2;
        }
        assert.ok(10 * Math.log10(e / t) < -250, `C1 square: Nonharmonics + A + B null against the delayed input (got ${10 * Math.log10(e / t)} dB)`);
    }
    // the GenExpr Mid analysis equals a direct transform of the Hann windowed (L + R) / 2 (frame 4 covers samples 0..n-1)
    {
        const g = run(n, 1, P0, x, y, 4);
        const w = ref.hann(n);
        const re = new Float64Array(n), im = new Float64Array(n);
        for (let i = 0; i < n; i++) re[i] = w[i] * 0.5 * (x[i] + y[i]);
        ref.fft(re, im, false);
        let maxd = 0;
        for (let k = 0; k <= n / 2; k++) maxd = Math.max(maxd, Math.abs(g.masks[3].mag[k] - Math.hypot(re[k], im[k]) * 4 / n));
        assert.ok(maxd < 1e-9, `ss_mid amplitude equals the direct Mid transform (max diff ${maxd})`);
    }
    // telemetry columns land in 0..1
    {
        const g = run(n, 1, P0, x, y, 2);
        let nonzero = 0;
        for (let i = 0; i < 512; i++) {
            const v = g.scope.peek(i);
            assert.ok(v >= 0 && v <= 1.0000001, `telemetry value ${i} in 0..1 (${v})`);
            if (v > 0) nonzero++;
        }
        assert.ok(nonzero > 100, "telemetry columns are filled");
    }
    console.log("[genexpr] transpiled lib + hs_* tests passed");
}

// ======================================================================
// 3. GenExpr lint, link module
// ======================================================================
{
    const fnsLib = functionsOf(SS_SRC);
    const fnsCore = functionsOf(CORE_SRC);
    for (const fn of fnsLib.concat(fnsCore)) {
        const rets = fn.body.filter((l) => /^\s*return\b/.test(l));
        assert.strictEqual(rets.length, 1, `${fn.name}: exactly one return`);
        assert.ok(/^\treturn\b/.test(fn.body[fn.body.length - 1]), `${fn.name}: the return is the last statement, at function level`);
        for (const l of fn.body) assert.ok(!/\bif\s*\(\s*[^)]*\b(ss|hs|stft|fft|cep)_\w+\(/.test(l), `${fn.name}: no function call inside an if condition`);
    }
    for (const src of [SS_SRC, CORE_SRC]) {
        const code = src.replace(/\/\/.*$/gm, "");
        assert.ok(!/\bpoke\([^;]*\b(ss|hs|stft|fft|cep)_\w+\(/.test(code), "no user function call inside poke() arguments (silent compile failure in Max)");
        assert.ok(!/\be\d\b/.test(code), "no identifier e<digit>");
        assert.ok(!/\b(phi|pi)\b/.test(code), "no phi / pi identifiers");
    }
    // ordering: all functions, then Buffer, Data, Param, History, Delay, then statements
    const lines = CORE_SRC.split("\n");
    const firstDecl = lines.findIndex((l) => /^(Buffer|Data|Param|History|Delay)\b/.test(l));
    const lastFnHeader = lines.reduce((m, l, i) => (/^[A-Za-z_]\w*\([^)]*\) \{$/.test(l) ? i : m), -1);
    assert.ok(lastFnHeader > 0 && lastFnHeader < firstDecl, "every function sits before the first Buffer / Data / Param / History / Delay declaration");
    const lastDecl = lines.reduce((m, l, i) => (/^(Buffer|Data|Param|History|Delay)\b/.test(l) ? i : m), -1);
    const firstStmt = lines.findIndex((l, i) => i > lastDecl && /^[a-zA-Z_]/.test(l));
    assert.ok(firstStmt > lastDecl, "statements follow the declarations");
    for (const l of lines.slice(firstDecl, lastDecl + 1)) assert.ok(l.trim() === "" || /^(Buffer|Data|Param|History|Delay)\b|^\/\//.test(l), `declaration block only holds declarations: ${l}`);
    // the series-estimation constants of the reference are the literals of the core (kept in agreement by hand: this catches a one-sided edit)
    for (const [label, val, re] of [
        ["HS_COS_K", cfg.HS_COS_K, /0\.056 \* /], ["HS_PWIDE", cfg.HS_PWIDE, /pers < 4\.5/], ["HS_PMIN", cfg.HS_PMIN, /pers >= 2\.2/], ["HS_COS_BINS", cfg.HS_COS_BINS, new RegExp(`kst \\+ ${cfg.HS_COS_BINS - 1}\\)`)],
        ["HS_COS_SUBOFF", cfg.HS_COS_SUBOFF, /\* 0\.0038\)/], ["HS_REG0", cfg.HS_REG0, /\+ 0\.8 \+ 0\.6 \* clip/], ["HS_REGX", cfg.HS_REGX, /0\.8 \+ 0\.6 \* clip/],
        ["HS_JPOS", cfg.HS_JPOS, /for \(j = 0; j < 10;/], ["HS_DETREND", cfg.HS_DETREND, /a0 = max\(k - 8, 0\)/], ["HS_PRES_WIDE", cfg.HS_PRES_WIDE, /prom >= 10\) \? 1 : 0/], ["HS_PRES_NARROW", cfg.HS_PRES_NARROW, /prom >= 4 \? 1 : 0/]]) {
        assert.ok(re.test(CORE_SRC), `core literal for ${label} = ${val} matches the reference`);
    }
    assert.ok(/pr3 = narrow > 0\.5 \? 2\.5 : 7;/.test(CORE_SRC) && cfg.HS_PRES_NARROW - 1.5 === 2.5 && cfg.HS_PRES_WIDE - 3 === 7, "root hold bars (presence - 1.5 / - 3 dB)");
    // Param names used by the build exist
    for (const name of ["fftn", "hpat", "hmaxp", "sensamt", "tiltamt", "thrdb", "flocut", "fhicut", "outsel", "wetamt"]) assert.ok(new RegExp(`^Param ${name}\\(`, "m").test(CORE_SRC), `Param ${name}`);
    assert.ok(/Buffer scope\("harmsplitscope"\)/.test(CORE_SRC), "Buffer bound by the GenExpr variable name `scope` (no set prefix)");
    // the scope layout matches the config constants
    const m = CORE_SRC.match(/poke\(scope, frameNo, (\d+), 0\)/);
    assert.strictEqual(Number(m[1]), cfg.HS_SC_FRAME, "telemetry frame counter slot");
    assert.ok(CORE_SRC.includes(`poke(scope, tf0, ${cfg.HS_SC_F0}, 0)`), "f0 slot");
    assert.ok(CORE_SRC.includes(`poke(scope, tsal, ${cfg.HS_SC_CONF}, 0)`), "salience slot");
    assert.ok(CORE_SRC.includes(`poke(scope, tfs, ${cfg.HS_SC_SERIES}, 0)`) && CORE_SRC.includes(`poke(scope, thr0, ${cfg.HS_SC_ROOTH}, 0)`) && CORE_SRC.includes(`poke(scope, tod, ${cfg.HS_SC_ODD}, 0)`), "series / root harmonic / odd-only slots");
    assert.ok(cfg.HS_SC_ODD < cfg.HS_SCOPE_SAMPS, "telemetry slots inside the buffer");
    assert.ok(CORE_SRC.includes(`poke(scope, tv, ${cfg.HS_SC_VOICED}, 0)`), "voiced slot");
    assert.ok(CORE_SRC.includes(`poke(scope, tlv, ${cfg.HS_SC_LVL}, 0)`), "level slot");
    assert.ok(CORE_SRC.includes(`poke(scope, 4096, ${cfg.HS_SC_LATENCY}, 0)`), "latency slot");
    assert.ok(CORE_SRC.includes(`poke(scope, selH, ${cfg.HS_SC_SEL}, 0)`), "selection slot");
    assert.ok(CORE_SRC.includes(`poke(scope, tnact, ${cfg.HS_SC_NACT}, 0)`), "active harmonics slot");
    assert.ok(CORE_SRC.includes(`poke(scope, tte, ${cfg.HS_SC_THREFF}, 0)`), "effective threshold slot");
    assert.ok(CORE_SRC.includes("ov1 = fixnan(fixdenorm(wmU * wetL * gFade + (1 - wmU) * dL * kdry))") && CORE_SRC.includes("kdry = selH > 0.5 ? 0.3333333333333333 : 1;") && CORE_SRC.includes("dryL.read(4096)"), "Mix: wet / dry-share crossfade with the 4096-delayed dry");
    assert.ok(cfg.HS_SCOPE_SAMPS <= 544, "scope buffer big enough");
    assert.ok(/Data hsd\(2049, 10\)/.test(CORE_SRC) && /Data hp\(406, 5\)/.test(CORE_SRC) && /Data sal\(710, 5\)/.test(CORE_SRC), "Data sizes");
    assert.strictEqual(cfg.HS_NCAND, 642);
    assert.ok(CORE_SRC.includes("for (i = 0; i < 642; i += 1)"), "candidate count in the core");

    runLinkTests();
    assert.strictEqual(cfg.hsResolveSel(0, 0), 1);
    assert.strictEqual(cfg.hsResolveSel(0, 1), 2);
    assert.strictEqual(cfg.hsResolveSel(0, 2), 3);
    assert.strictEqual(cfg.hsResolveSel(0, 7), 3, "Auto clamps to the last channel");
    assert.strictEqual(cfg.hsResolveSel(0, -1), 0, "Auto outside a rack = all");
    assert.strictEqual(cfg.hsResolveSel(1, 2), 1);
    assert.strictEqual(cfg.hsResolveSel(2, 0), 2);
    assert.strictEqual(cfg.hsResolveSel(3, 0), 3);
    assert.strictEqual(cfg.hsResolveSel(4, 0), 0);
    assert.strictEqual(cfg.hsSelName(2), "Harmonics A");
    console.log("[lint] genexpr lint and link module tests passed");
}

// ======================================================================
// 4. The built device and rack preset
// ======================================================================
{
    const amxd = path.join(ROOT, "devices", "Harmonic Split.amxd");
    const raw = fs.readFileSync(amxd);
    assert.strictEqual(raw.slice(0, 4).toString(), "ampf");
    assert.strictEqual(raw.slice(8, 12).toString(), "aaaa", "audio effect");
    assert.strictEqual(raw.readUInt32LE(28), raw.length - 32);
    const p = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    assert.strictEqual(p.latency, cfg.HS_LATENCY, "latency attribute 4096");
    assert.strictEqual(p.openrect[3], 169, "169 px high");
    assert.strictEqual(p.openrect[2], p.devicewidth);
    assert.strictEqual(p.openinpresentation, 1);
    const boxes = p.boxes.map((b) => b.box);
    const byId = {};
    for (const b of boxes) {
        assert.ok(!byId[b.id], `unique id ${b.id}`);
        byId[b.id] = b;
    }
    for (const l of p.lines) {
        assert.ok(byId[l.patchline.source[0]] && byId[l.patchline.destination[0]], `line endpoints exist ${JSON.stringify(l.patchline)}`);
    }
    const gen = byId["obj-gen"];
    assert.strictEqual(gen.code, [LIB_SRC, SS_SRC, CORE_SRC].map((s) => s.replace(/\s+$/, "") + "\n").join("\n"), "gen code = cepstrum_lib + spectral_split_lib + harmsplit_core");
    assert.ok(gen.code.indexOf("fft_run(") < gen.code.indexOf("ss_in(") && gen.code.indexOf("ss_in(") < gen.code.indexOf("hs_masks("), "library functions come first");
    assert.ok(byId["obj-scope-buf"].text.startsWith("buffer~ ---harmsplitscope"), "per-instance buffer name");
    assert.ok(Number(byId["obj-scope-buf"].text.match(/@samps (\d+)/)[1]) >= cfg.HS_SCOPE_SAMPS, "scope buffer length");
    for (const id of ["obj-msg-ui-buf", "obj-msg-gen-buf"]) assert.ok(byId[id].text.includes("---harmsplitscope"), `${id} uses the --- name`);
    assert.ok(!boxes.some((b) => /#0/.test(b.text || "")), "no #0 names in a top-level device");
    const firstPanel = boxes.findIndex((b) => b.maxclass === "panel");
    assert.ok(firstPanel > 0 && boxes.slice(firstPanel).every((b) => b.maxclass === "panel"), "panels are the last boxes");
    for (const b of boxes.slice(firstPanel)) assert.strictEqual(b.background, 1, `${b.id} background 1`);
    // geometry
    const pres = boxes.filter((b) => b.presentation === 1 && b.maxclass !== "panel");
    const viz = byId["obj-viz"].presentation_rect;
    const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    for (const b of pres) {
        const r = b.presentation_rect;
        assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= p.devicewidth && r[1] + r[3] <= 169, `${b.id} inside the device`);
        if (b.id !== "obj-viz") assert.ok(!overlap(viz, r), `${b.id} must not overlap the v8ui canvas`);
    }
    const inter = pres.filter((b) => /^live\./.test(b.maxclass) && b.maxclass !== "live.comment");
    for (let i = 0; i < inter.length; i++) for (let j = i + 1; j < inter.length; j++) assert.ok(!overlap(inter[i].presentation_rect, inter[j].presentation_rect), `${inter[i].id} and ${inter[j].id} overlap`);
    for (const b of pres) {
        if (b.maxclass !== "live.comment") continue;
        for (const o of inter) assert.ok(!overlap(b.presentation_rect, o.presentation_rect), `label ${b.id} overlaps ${o.id}`);
    }
    assert.strictEqual(boxes.filter((b) => b.maxclass === "v8ui").length, 1, "one v8ui");
    // parameters: table versus the reference
    const names = new Set();
    for (const [key, spec] of Object.entries(cfg.HS_PARAMS)) {
        const v = byId[`obj-ctrl-${key}`].saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_longname, spec[0], `${key} long name`);
        assert.strictEqual(v.parameter_shortname, spec[1]);
        assert.deepStrictEqual([v.parameter_mmin, v.parameter_mmax, v.parameter_initial[0], v.parameter_type, v.parameter_unitstyle], [spec[2], spec[3], spec[4], spec[5], spec[6]], `${key} range / initial / type / unit`);
        if (v.parameter_type === 1) assert.ok(v.parameter_mmax <= 255, "native Int parameters stay <= 255");
        assert.ok(!names.has(v.parameter_shortname), "unique short name");
        names.add(v.parameter_shortname);
    }
    for (const [key, spec] of Object.entries(cfg.HS_ENUMS)) {
        const v = byId[`obj-ctrl-${key}`].saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_longname, spec[0]);
        assert.deepStrictEqual(v.parameter_enum, spec[2], `${key} enum`);
        assert.strictEqual(v.parameter_initial[0], spec[3], `${key} initial`);
        assert.ok(!names.has(v.parameter_shortname), "unique short name");
        names.add(v.parameter_shortname);
    }
    assert.strictEqual(byId["obj-ctrl-size"].saved_attribute_attributes.valueof.parameter_initial[0], 1, "Size defaults to 2k");
    assert.strictEqual(byId["obj-ctrl-pattern"].saved_attribute_attributes.valueof.parameter_initial[0], 1, "Pattern defaults to index 1 = Every 2nd");
    assert.strictEqual(cfg.HS_PATTERN_ENUM.length, 24, "Pattern 1..24");
    assert.deepStrictEqual([cfg.hsPatternLabel(1), cfg.hsPatternLabel(2), cfg.hsPatternLabel(3), cfg.hsPatternLabel(11), cfg.hsPatternLabel(12), cfg.hsPatternLabel(13), cfg.hsPatternLabel(21), cfg.hsPatternLabel(22), cfg.hsPatternLabel(24)],
        ["1st only", "Every 2nd", "Every 3rd", "Every 11th", "Every 12th", "Every 13th", "Every 21st", "Every 22nd", "Every 24th"], "ordinal labels");
    const pd = (k) => byId[`obj-ctrl-${k}`].saved_attribute_attributes.valueof;
    assert.deepStrictEqual([pd("lowcut").parameter_mmin, pd("lowcut").parameter_mmax, pd("lowcut").parameter_initial[0]], [19.4, 19900, 80], "Low-cut 19.4 Hz .. 19.9 kHz, 80 Hz");
    assert.deepStrictEqual([pd("highcut").parameter_mmin, pd("highcut").parameter_mmax, pd("highcut").parameter_initial[0]], [19.4, 19900, 1500], "High-cut 19.4 Hz .. 19.9 kHz, 1.5 kHz");
    assert.deepStrictEqual([pd("tilt").parameter_mmin, pd("tilt").parameter_mmax, pd("tilt").parameter_initial[0]], [-12, 12, 0], "Tilt +-12 dB");
    assert.deepStrictEqual([pd("thr").parameter_mmin, pd("thr").parameter_mmax, pd("thr").parameter_initial[0]], [-120, 0, -120], "Threshold -120..0 dB, default Automatic (-120)");
    assert.deepStrictEqual([pd("sens").parameter_mmin, pd("sens").parameter_mmax, pd("sens").parameter_initial[0]], [1, 100, 50], "Sensitivity 1..100 %, 50");
    assert.deepStrictEqual([pd("maxh").parameter_mmin, pd("maxh").parameter_mmax, pd("maxh").parameter_initial[0], pd("maxh").parameter_type], [0, 404, 0, 0], "Max Harmonics 0..404 (float: Live Int stops at 255), 0 = Off");
    assert.deepStrictEqual([pd("mix").parameter_mmin, pd("mix").parameter_mmax, pd("mix").parameter_initial[0]], [0, 100, 100], "Mix 0..100 %, 100");
    // Low / High / Tilt / Threshold are drawn and edited by the display: automatable but not on the face
    for (const key of ["lowcut", "highcut", "tilt", "thr"]) {
        assert.ok(byId[`obj-ctrl-${key}`].presentation !== 1 && pd(key).parameter_enable !== 0 && byId[`obj-ctrl-${key}`].parameter_enable === 1, `${key}: hidden automatable parameter`);
    }
    for (const key of ["pattern", "sens", "maxh", "mix", "size", "output"]) assert.strictEqual(byId[`obj-ctrl-${key}`].presentation, 1, `${key} is on the face`);
    for (const key of ["dispost"]) {
        const b = byId[`obj-ctrl-${key}`];
        assert.strictEqual(b.saved_attribute_attributes.valueof.parameter_invisible, 1, `${key} is UI state only`);
        assert.ok(b.presentation !== 1, `${key} is not in the presentation`);
    }
    // wiring
    const lines = p.lines.map((l) => l.patchline);
    const from = (id) => lines.filter((l) => l.source[0] === id).map((l) => l.destination[0]);
    const GEN = { pattern: "hpat", maxh: "hmaxp", sens: "sensamt", tilt: "tiltamt", thr: "thrdb", lowcut: "flocut", highcut: "fhicut", mix: "wetamt", size: "fftn" };
    for (const [key, msg] of Object.entries(GEN)) {
        assert.strictEqual(byId[`obj-prep-${key}`].text, `prepend ${msg}`);
        assert.ok(from(`obj-prep-${key}`).includes("obj-gen"), `${key} -> gen`);
        assert.ok(from(`obj-ui-${key}`).includes("obj-viz") && byId[`obj-ui-${key}`].text === `prepend set_${key}`, `${key} -> face`);
    }
    assert.strictEqual(byId["obj-expr-sens"].text, "expr ($f1 - 1.) / 99.", "Sensitivity 1..100 % -> 0..1");
    assert.strictEqual(byId["obj-expr-pattern"].text, "expr $f1 + 1", "Pattern menu index -> 1..24");
    assert.strictEqual(byId["obj-scale-mix"].text, "* 0.01", "Mix % -> 0..1");
    assert.ok(!byId["obj-scale-tilt"], "Tilt goes to the gen in dB");
    assert.ok(byId["obj-expr-size"].text.startsWith("expr 1024 * pow(2"), "Size -> 1024 * 2^i");
    assert.ok(from("obj-ctrl-output").includes("obj-ui-output") && !from("obj-ctrl-output").includes("obj-prep-output"), "Output goes to the face only (it resolves Auto)");
    const linkRoute = byId["obj-route-link"].text.split(" ").slice(1);
    assert.deepStrictEqual(linkRoute, cfg.HS_LINKED_KEYS, "link route lists the linked keys, in order");
    assert.ok(!linkRoute.includes("output") && !linkRoute.includes("dispost"), "Output and the display toggle are not linked");
    linkRoute.forEach((key, i) => {
        const dests = lines.filter((l) => l.source[0] === "obj-route-link" && l.source[1] === i).map((l) => l.destination[0]);
        assert.ok(dests.includes(`obj-lset-${key}`), `${key}: peer value -> prepend set`);
        assert.strictEqual(byId[`obj-lset-${key}`].text, "prepend set");
        assert.ok(from(`obj-lset-${key}`).includes(`obj-ctrl-${key}`), `${key}: prepend set -> control`);
        assert.ok(dests.length === 2, `${key}: peer value also feeds the gen path`);
    });
    const canvasRoute = byId["obj-route-canvas"].text.split(" ").slice(1);
    for (const key of ["lowcut", "highcut", "tilt", "thr", "dispost"]) assert.ok(canvasRoute.includes(key), `${key} can be edited from the canvas`);
    assert.ok(lines.some((l) => l.source[0] === "obj-viz" && l.source[1] === 2 && l.destination[0] === "obj-gen"), "face outlet 2 -> gen (outsel)");
    assert.ok(lines.some((l) => l.source[0] === "obj-thisdevice" && l.destination[0] === "obj-msg-init") && byId["obj-msg-init"].text === "init_link", "init from live.thisdevice, not loadbang");
    const face = byId["obj-viz"].textfile.text;
    assert.ok(face.includes("function splCreateLink") && face.includes("function hsFrame") && face.includes("function paint"), "face = config + link + ui");
    assert.ok(/mgraphics\.relative_coords\s*=\s*0/.test(face) && /mgraphics\.autofill\s*=\s*0/.test(face), "v8ui pixel coordinates");
    assert.ok(!/\bvar\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(face), "no declared v8ui globals");
    // .adg
    const adg = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "devices", "Harmonic Split.adg"))).toString("utf8");
    const branches = adg.match(/<AudioEffectBranchPreset Id="\d+">/g);
    assert.strictEqual(branches.length, 3, "three chains");
    const names2 = [...adg.matchAll(/<AudioEffectBranchPreset Id="\d+">\s*<Name Value="([^"]+)"/g)].map((mm) => mm[1]);
    assert.deepStrictEqual(names2, ["Nonharmonics", "Harmonics A", "Harmonics B"], "chains are named after the channels, in order");
    assert.strictEqual((adg.match(/<MxDeviceAudioEffect /g) || []).length, 3, "one device per chain");
    assert.strictEqual((adg.match(/<UserName Value="Harmonic Split"/g) || []).length, 1, "rack name");
    assert.strictEqual((adg.match(/Harmonic Split\.amxd/g) || []).length >= 6, true, "each chain references the .amxd (relative and absolute)");
    console.log("[device] built device and rack preset checks passed");
}

console.log("All Harmonic Split tests passed");
