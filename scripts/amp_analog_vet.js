#!/usr/bin/env node
"use strict";
// Vetting of the Neural Amp's analog circuits: every circuit must have its own tone AND its own dynamics.
// Runs the exact DSP (tests/amp_analog_sim.js: the GenExpr transpiled to Node) on deterministic stimuli and
// measures a fingerprint per circuit, at Gain 0 and Gain +12 dB, knobs at noon, speaker on:
//   E  small-signal response in octave bands 63 Hz..8 kHz, rel. 1 kHz (-40 dBFS noise)
//   S  static drive: THD and the H2..H6 vector, even / odd balance, at -24 / -12 / -3 dBFS (200 Hz and 1 kHz)
//   C  compression curve: output level of 400 Hz bursts from -40 to 0 dBFS -> knee and slope above it
//   B  burst dynamics: a 400 ms burst at -6 dBFS with a quiet 2350 Hz probe tone under it: attack overshoot,
//      sag (level 5 ms vs 300 ms into the burst), probe gain during and 50 / 200 / 800 ms after (recovery)
//   I  intermodulation ducking: 100 Hz at -6 + 2 kHz at -30: how much the 2 kHz envelope moves with the bass
//   H  hysteresis: a 1 kHz tone ramped up then down, the level gap at equal input
//   T  transient: crest factor of a plucked string, first 30 ms vs 300 ms
// plus a sanity gate: under a steady tone the output stays periodic (aperiodic(): energy off the harmonics)
// Distance per group = |difference| / unit after removing twice the measurement noise (two stimulus seeds),
// units from tests/test_amp.js (3 dB rms of EQ ~ 0.7 of log-THD ~ one unit). Gates (see GATES) for every
// pair of circuits and against every built-in neural capture (whose dynamics are near memoryless).
//
//   node scripts/amp_analog_vet.js [--quick] [--circuits a,b] [--calibrate] [--wav] [--json out.json]
// Writes tests/out/amp_analog/report.md (+ fingerprints.json, audition WAVs with --wav).

const fs = require("fs");
const path = require("path");
const S = require("../tests/amp_analog_sim.js");
const A = require("../src/amp_config.js");
const AA = S.AA;

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "tests", "out", "amp_analog");
const SR = 48000;
const BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
const GATES = { pairTotal: 2.0, pairDyn: 0.75, neuralTotal: 1.5, neuralDyn: 0.5 };
const UNITS = { E: 3, S: 0.7, C: 1.5, B: 1.5, I: 1.5, H: 1.5, T: 1.5 };   // dB / ln units per distance unit
const DYN = ["C", "B", "I", "H", "T"];

const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const pick = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; }; }
const db = (v) => 20 * Math.log10(Math.max(1e-12, v));
const rms = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); };
function goertzel(y, i0, n, f) { let r = 0, im = 0; for (let i = 0; i < n; i++) { const p = 2 * Math.PI * f * i / SR; r += y[i0 + i] * Math.cos(p); im += y[i0 + i] * Math.sin(p); } return 2 * Math.hypot(r, im) / n; }

/** A processor for one circuit: (x) -> y, fresh settled instance per call. */
function proc(idx, gainDb) { return (x) => S.create(idx, { gainDb }).run(x); }

// ---- features -----------------------------------------------------------------------------------

// Periodicity: a steady 110 Hz sine at -12 dBFS (mains moved to 55 Hz so ripple products land on harmonics); the energy
// off the harmonics of 110 Hz (exact bins of a 1 s window after 4 s) in dB. Unconverged solvers and blocking cycles
// show up here as subharmonic / broadband energy; a driven amp should stay periodic.
function aperiodic(idx, lv) {
    const m = S.create(idx), k = AA.aaRecipe(idx).chain.findIndex((s) => s && s.k === "pwr");
    if (k >= 0) m.tb.poke(55, 64 + k * 32 + 12);
    const n = 5 * SR, x = new Float64Array(n), a = Math.pow(10, lv / 20);
    for (let i = 0; i < n; i++) x[i] = a * Math.sin(2 * Math.PI * 110 * i / SR) * Math.min(1, i / 2400);
    const y = m.run(x).slice(4 * SR), N = y.length;
    let et = 0, eh = 0;
    for (const v of y) et += v * v;
    for (let h = 0; h * 110 <= N / 2; h++) {
        const kk = 110 * h; let re = 0, im = 0;
        for (let i = 0; i < N; i++) { const p = 2 * Math.PI * kk * i / N; re += y[i] * Math.cos(p); im += y[i] * Math.sin(p); }
        const e = (re * re + im * im) / N; eh += (kk === 0 || 2 * kk === N) ? e : 2 * e;
    }
    return 10 * Math.log10(Math.max(1e-20, (et - eh) / et));
}
const APERIODIC_MAX = -35;

function eqBands(p, seed) {
    const r = rng(seed), skip = 6000, N = 4096, x = new Float64Array(skip + 3 * N);
    for (let i = 0; i < x.length; i++) x[i] = r() * 2 * 0.01 * Math.sqrt(3);
    const y = p(x), ein = new Float64Array(8), eout = new Float64Array(8);
    for (let st = skip; st + N <= x.length; st += N) {
        for (let k = 2; k < N / 2; k += 2) {
            const f = k * SR / N, bi = BANDS.findIndex((c) => f >= c / Math.SQRT2 && f < c * Math.SQRT2);
            if (bi < 0) continue;
            let xr = 0, xi = 0, yr = 0, yi = 0;
            for (let n = 0; n < N; n++) {
                const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N), a = 2 * Math.PI * k * n / N, c = Math.cos(a), s = Math.sin(a);
                xr += w * x[st + n] * c; xi += w * x[st + n] * s; yr += w * y[st + n] * c; yi += w * y[st + n] * s;
            }
            ein[bi] += xr * xr + xi * xi; eout[bi] += yr * yr + yi * yi;
        }
    }
    const g = BANDS.map((_, i) => 10 * Math.log10(eout[i] / ein[i]));
    return g.map((v) => v - g[4]);
}

function harmonics(p, lv, f0) {
    const per = Math.round(SR / f0), skip = 9600, n = per * Math.floor(4800 / per), x = new Float64Array(skip + n), a = Math.pow(10, lv / 20);
    for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * f0 * i / SR) * Math.min(1, i / 2400);
    const y = p(x), h = [];
    for (let k = 1; k <= 6; k++) h.push(goertzel(y, skip, n, f0 * k));
    const thd = 100 * Math.sqrt(h.slice(1).reduce((e, v) => e + v * v, 0)) / Math.max(h[0], 1e-12);
    const even = h[1] * h[1] + h[3] * h[3] + h[5] * h[5], odd = h[2] * h[2] + h[4] * h[4];
    return { thd, vec: h.slice(1).map((v) => db(v / Math.max(h[0], 1e-12))), eo: 10 * Math.log10((even + 1e-24) / (odd + 1e-24)), g1: h[0] / a };
}

function compression(p) {
    const lv = [], out = [];
    for (let L = -40; L <= 0; L += 4) {
        const n = Math.round(0.35 * SR), x = new Float64Array(n), a = Math.pow(10, L / 20);
        for (let i = 0; i < n; i++) x[i] = a * Math.sin(2 * Math.PI * 400 * i / SR) * Math.min(1, i / 480);
        const y = p(x);
        lv.push(L); out.push(db(rms(y, n - Math.round(0.2 * SR), n) * Math.SQRT2 / a) + L);
    }
    const sl = [];
    for (let i = 1; i < lv.length; i++) sl.push((out[i] - out[i - 1]) / 4);
    let knee = 0;
    for (let i = 0; i < sl.length; i++) if (sl[i] < 0.7) { knee = lv[i]; break; }
    const top = sl.slice(-2).reduce((a, b) => a + b, 0) / 2;
    return { knee, top, out };
}

function burst(p, seed) {
    const r = rng(seed), pre = Math.round(0.3 * SR), bl = Math.round(0.4 * SR), post = Math.round(1.0 * SR), n = pre + bl + post;
    const x = new Float64Array(n), pa = Math.pow(10, -30 / 20), ba = Math.pow(10, -6 / 20);
    for (let i = 0; i < n; i++) {
        const probe = pa * Math.sin(2 * Math.PI * 2350 * i / SR);
        const inB = i >= pre && i < pre + bl;
        const bv = inB ? ba * (Math.sin(2 * Math.PI * 110 * i / SR) + 0.3 * r()) * Math.min(1, (i - pre) / 48) : 0;
        x[i] = probe + bv;
    }
    const y = p(x);
    const lvl = (i0, len) => db(rms(y, i0, i0 + len));
    const pg = (i0) => db(goertzel(y, i0, 4800, 2350));       // probe level over 100 ms (2350 Hz fits 235 cycles)
    const base = pg(pre - 4800 - 480);
    const att = lvl(pre, 480) - lvl(pre + Math.round(0.05 * SR), 2400);
    const sag = lvl(pre + 240, 480) - lvl(pre + Math.round(0.3 * SR), 2400);
    const during = pg(pre + Math.round(0.15 * SR)) - base;
    const rec = [0.05, 0.2, 0.8].map((t) => pg(pre + bl + Math.round(t * SR)) - base);
    return { att, sag, during, rec };
}

function imd(p) {
    const n = Math.round(0.6 * SR), x = new Float64Array(n), a1 = Math.pow(10, -6 / 20), a2 = Math.pow(10, -30 / 20);
    for (let i = 0; i < n; i++) x[i] = a1 * Math.sin(2 * Math.PI * 100 * i / SR) + a2 * Math.sin(2 * Math.PI * 2000 * i / SR);
    const y = p(x);
    // envelope of the 2 kHz band (complex demodulation, 4 ms smoothing), its depth at 100 / 200 Hz
    const i0 = Math.round(0.2 * SR), m = Math.round(0.4 * SR), env = new Float64Array(m);
    let er = 0, ei = 0; const k = 1 - Math.exp(-2 * Math.PI * 500 / SR);
    for (let i = 0; i < m; i++) { const ph = 2 * Math.PI * 2000 * (i0 + i) / SR; er += k * (y[i0 + i] * Math.cos(ph) - er); ei += k * (y[i0 + i] * Math.sin(ph) - ei); env[i] = Math.hypot(er, ei); }
    let mean = 0; for (const v of env) mean += v; mean /= m;
    const g = (f) => goertzel(env, 0, m - m % (SR / f), f) / Math.max(1e-12, mean);
    return { d100: db(g(100) + 1e-4), d200: db(g(200) + 1e-4) };
}

function hysteresis(p) {
    const n = Math.round(1.6 * SR), x = new Float64Array(n);
    const env = (i) => { const t = i / n; return Math.pow(10, (-36 + 36 * (t < 0.5 ? 2 * t : 2 - 2 * t)) / 20); };
    for (let i = 0; i < n; i++) x[i] = env(i) * Math.sin(2 * Math.PI * 1000 * i / SR);
    const y = p(x), seg = 1200, up = [], dn = [];
    for (let s = 0; s + seg <= n; s += seg) { const v = db(rms(y, s, s + seg)) - db(rms(x, s, s + seg)); (s < n / 2 ? up : dn).push(v); }
    dn.reverse();
    let gap = 0, c = 0;
    for (let i = 2; i < Math.min(up.length, dn.length) - 2; i++) { gap += dn[i] - up[i]; c++; }
    return { gap: gap / Math.max(1, c) };
}

function pluck(seed) {
    const r = rng(seed), n = Math.round(0.6 * SR), x = new Float64Array(n), L = Math.round(SR / 110), buf = new Float64Array(L);
    for (let i = 0; i < L; i++) buf[i] = r() * 0.9;
    let p = 0;
    for (let i = 0; i < n; i++) { const q = (p + 1) % L; const v = 0.5 * (buf[p] + buf[q]) * 0.996; x[i] = buf[p]; buf[p] = v; p = q; }
    return x;
}
function transient(p, seed) {
    const x = pluck(seed), y = p(x);
    const crest = (a, i0, i1) => { let pk = 0; for (let i = i0; i < i1; i++) pk = Math.max(pk, Math.abs(a[i])); return db(pk / Math.max(1e-12, rms(a, i0, i1))); };
    const w = Math.round(0.03 * SR), l = Math.round(0.3 * SR);
    return { d: (crest(y, 0, w) - crest(y, l, l + w)) - (crest(x, 0, w) - crest(x, l, l + w)) };
}

/** The full fingerprint of a processor (two seeds where randomness enters). */
function fingerprint(p, seed) {
    const fp = { E: eqBands(p, seed) };
    const lvls = QUICK ? [-24, -3] : [-24, -12, -3];
    const H = [];
    for (const f0 of QUICK ? [200] : [200, 1000]) for (const lv of lvls) H.push(harmonics(p, lv, f0));
    fp.S = [].concat(...H.map((h) => [Math.log(h.thd + 0.5), h.eo / 10]));
    fp.Svec = H.map((h) => h.vec);
    const C = compression(p);
    fp.C = [C.knee / 8, C.top * 4];
    const B = burst(p, seed);
    fp.B = [B.att, B.sag, B.during, B.rec[0], B.rec[1], B.rec[2]];
    const I = imd(p);
    fp.I = [I.d100 / 4, I.d200 / 4];
    fp.H = [hysteresis(p).gap];
    fp.T = [transient(p, seed).d];
    fp.raw = { thd: H.map((h) => +h.thd.toFixed(3)), comp: C, burst: B, imd: I };
    return fp;
}

function groupDist(a, b, g, noise) {
    let s = 0;
    for (let i = 0; i < a[g].length; i++) {
        const nz = noise ? 2 * Math.abs(noise[g][i] || 0) : 0;
        const d = Math.max(0, Math.abs(a[g][i] - b[g][i]) - nz);
        s += d * d;
    }
    return Math.sqrt(s / a[g].length) / UNITS[g];
}
function distance(a, b, noise) {
    const parts = {};
    for (const g of Object.keys(UNITS)) parts[g] = groupDist(a, b, g, noise);
    const dyn = Math.hypot(...DYN.map((g) => parts[g]));
    const total = Math.hypot(...Object.keys(UNITS).map((g) => parts[g]));
    return { total, dyn, parts };
}

// ---- tuning: each circuit's marked pot / pedal level / input sensitivity -> its THD target at -12 dBFS ----

// THD % of a 200 Hz sine at -24 / -12 / -3 dBFS, Gain 0, knobs at noon. Anchored on measured gear
// (scripts/amp_fit_circuits.py TARGETS: TwinVerb 0.1 / 0.5 / 1.5, AC15 7 / 34 / 52, JCM2000 10 / 24 / 26, 5150 19 / 19 / 23).
const THD_TARGET = { tweed: [3, 15, 35], twin: [0.1, 0.5, 2], ac30: [5, 25, 45], plexi: [4, 15, 30], jcm: [10, 22, 28], modern: [19, 20, 24],
    svt: [0.5, 3, 10], hiwatt: [0.1, 0.3, 1.5], ts: [4, 12, 15], rat: [20, 30, 35], fuzz: [15, 40, 60], muff: [25, 35, 45],
    tape: [0.3, 1.5, 5], opto: [0.3, 1, 3], desk: [0.1, 0.5, 3], jc120: [0.05, 0.3, 3] };

// Two parameters per circuit, fitted together to the -24 / -12 dBFS targets (the -3 point weighs a quarter):
//   amps: A = input sensitivity (vref, sets where the first stages break up), B = the marked pot (tune: 1);
//   high-gain amps (a pot marked tuneA): A = the preamp pot, B = the master;
//   pedals: the Level only (the drive stays at its characteristic setting); studio devices: A = vref only.
function tunables(r) {
    const out = [];
    const gk = r.chain.findIndex((s) => s && s.tune === 1), ak = r.chain.findIndex((s) => s && s.tuneA === 1);
    const pk = r.chain.findIndex((s) => s && s.tune === "level");
    if (pk >= 0) {
        // the pedal keeps its characteristic drive (a fitted drive went to the minimum: the pedal became a clean boost)
        out.push({ name: `${r.chain[pk].k}.level`, lo: 0.01, hi: 5, log: true, get: (x) => x.chain[pk].level, set: (x, v) => { x.chain[pk].level = v; } });
        return out;
    }
    if (ak >= 0) out.push({ name: `slot ${ak} g`, lo: 0.005, hi: 1, log: true, get: (x) => x.chain[ak].g, set: (x, v) => { x.chain[ak].g = v; } });
    // a guitar amp's input sees a guitar (at least 0.1 V at full scale); line-level studio devices may go lower
    else out.push({ name: "vref", lo: r.spk ? 0.1 : 0.01, hi: 2, log: true, get: (x) => x.vref, set: (x, v) => { x.vref = v; } });
    if (gk >= 0) out.push({ name: `slot ${gk} g`, lo: 0.0005, hi: 2, log: true, get: (x) => x.chain[gk].g, set: (x, v) => { x.chain[gk].g = v; } });
    return out;
}
function thdOf(rec, lv) {
    const p = (x) => S.create(0, { recipe: rec }).run(x);
    return harmonics(p, lv, 200).thd;
}
function tune(id) {
    const idx = AA.AMP_ANALOG.findIndex((r) => r.id === id), base = JSON.parse(JSON.stringify(AA.aaRecipe(idx)));
    const T = tunables(base), tgt = THD_TARGET[id];
    const lg = (v) => Math.log(v + 0.05);
    const toU = (t, v) => (t.log ? (Math.log(v) - Math.log(t.lo)) / (Math.log(t.hi) - Math.log(t.lo)) : (v - t.lo) / (t.hi - t.lo));
    const fromU = (t, u) => { u = Math.max(0, Math.min(1, u)); return t.log ? Math.exp(Math.log(t.lo) + u * (Math.log(t.hi) - Math.log(t.lo))) : t.lo + u * (t.hi - t.lo); };
    const evalU = (us) => {
        const rec = JSON.parse(JSON.stringify(base));
        T.forEach((t, k) => t.set(rec, fromU(t, us[k])));
        const c = [-24, -12, -3].map((lv) => thdOf(rec, lv));
        return { cost: (lg(c[0]) - lg(tgt[0])) ** 2 + (lg(c[1]) - lg(tgt[1])) ** 2 + 0.25 * (lg(c[2]) - lg(tgt[2])) ** 2, c, us };
    };
    let best = null;
    const g = T.length > 1 ? [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95] : [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
    if (T.length > 1) { for (const a of g) for (const b of g) { const r = evalU([a, b]); if (!best || r.cost < best.cost) best = r; } }
    else { for (const a of g) { const r = evalU([a]); if (!best || r.cost < best.cost) best = r; } }
    let step = 0.08;
    for (let round = 0; round < 12 && step > 0.004; round++) {
        let moved = false;
        for (let k = 0; k < T.length; k++) for (const d of [-step, step]) {
            const us = best.us.slice(); us[k] += d;
            const r = evalU(us);
            if (r.cost < best.cost) { best = r; moved = true; }
        }
        if (!moved) step *= 0.5;
    }
    const vals = T.map((t, k) => `${t.name} = ${fromU(t, best.us[k]).toPrecision(3)}`);
    console.log(`${id.padEnd(7)} ${vals.join(", ")}  THD ${best.c.map((c) => c.toFixed(2)).join(" / ")}  target ${tgt.join(" / ")}  cost ${best.cost.toFixed(3)}`);
    return best;
}

// ---- calibration: output level for a reference phrase -------------------------------------------

function phrase() {
    const x = new Float64Array(Math.round(2.4 * SR)), notes = [[0, 82.41, 1], [0.6, 110, 0.7], [1.2, 146.8, 0.9], [1.8, 98, 0.5]];
    for (const [t0, f, a] of notes) {
        const r = rng(Math.round(f)), L = Math.round(SR / f), buf = new Float64Array(L);
        for (let i = 0; i < L; i++) buf[i] = r();
        let p = 0;
        for (let i = Math.round(t0 * SR); i < x.length; i++) { const q = (p + 1) % L; const v = 0.5 * (buf[p] + buf[q]) * 0.997; x[i] += a * buf[p]; buf[p] = v; p = q; }
    }
    let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
    const g = Math.pow(10, -12 / 20) / pk;
    return x.map((v) => v * g);
}

function loudness(idx, gainDb) {
    const y = S.create(idx, { gainDb }).run(phrase());
    return db(rms(y, 0, y.length));
}

function wav16(file, data) {
    const n = data.length, b = Buffer.alloc(44 + n * 2);
    b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(32767 * Math.max(-1, Math.min(1, data[i]))), 44 + 2 * i);
    fs.writeFileSync(file, b);
}

// ---- main ---------------------------------------------------------------------------------------

function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const only = pick("--circuits");
    const ids = AA.AMP_ANALOG.map((r) => r.id).filter((id) => !only || only.split(",").includes(id));
    if (args.includes("--tune")) {
        for (const id of ids) tune(id);
        return;
    }
    if (args.includes("--calibrate")) {
        for (const id of ids) {
            const idx = AA.AMP_ANALOG.findIndex((r) => r.id === id);
            const l = loudness(idx, 0);
            console.log(`${id}: loudness ${l.toFixed(1)} dB, outDb now ${AA.AMP_ANALOG[idx].outDb || 0}, set outDb ${((AA.AMP_ANALOG[idx].outDb || 0) - 18 - l).toFixed(1)}`);
        }
        return;
    }
    const gains = QUICK ? [0] : [0, 12];
    const fps = {}, noise = {};
    for (const id of ids) {
        const idx = AA.AMP_ANALOG.findIndex((r) => r.id === id);
        const t0 = Date.now();
        fps[id] = gains.map((g) => fingerprint(proc(idx, g), 1));
        if (!noise.done) {   // measurement noise: the same circuit with another stimulus seed
            const alt = fingerprint(proc(idx, 0), 2);
            for (const g of Object.keys(UNITS)) noise[g] = fps[id][0][g].map((v, i) => alt[g][i] - v);
            noise.done = 1;
        }
        fps[id][0].aper = aperiodic(idx, -12);
        const r = fps[id][0].raw;
        console.log(`${id.padEnd(7)} THD ${r.thd.join(" / ")} %  knee ${r.comp.knee} slope ${r.comp.top.toFixed(2)}  sag ${r.burst.sag.toFixed(1)} dB  probe ${r.burst.during.toFixed(1)} / ${r.burst.rec.map((v) => v.toFixed(1)).join(" ")} dB  IMD ${r.imd.d100.toFixed(1)} dB  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        if (args.includes("--wav")) wav16(path.join(OUT, `${id}.wav`), S.create(idx, {}).run(phrase()).map((v) => v * 2));
    }
    const aperFails = ids.filter((id) => fps[id][0].aper > APERIODIC_MAX);
    // neural captures (memoryless-ish): the same fingerprint through ampForward
    const neural = {};
    if (!QUICK && !args.includes("--no-neural")) {
        for (const name of ["clean", "chime", "bass", "drive", "crunch", "lead", "metal", "fuzz", "magna", "ds1", "splawn", "markiv"]) {
            const m = A.ampParseNam(fs.readFileSync(path.join(ROOT, "src", "amp_models", name + ".nam"), "utf8"));
            neural[name] = fingerprint((x) => A.ampForward(m, x), 1);
        }
    }
    // pairwise
    const rows = [], fails = [];
    let minPair = { total: Infinity };
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        let best = null;
        for (let g = 0; g < gains.length; g++) {
            const d = distance(fps[ids[i]][g], fps[ids[j]][g], noise);
            if (!best || d.total > best.total) best = d;   // distinct if distinct at either gain
        }
        rows.push([ids[i], ids[j], best]);
        if (best.total < minPair.total) minPair = Object.assign({ a: ids[i], b: ids[j] }, best);
        if (best.total < GATES.pairTotal || best.dyn < GATES.pairDyn) fails.push(`${ids[i]} / ${ids[j]}: total ${best.total.toFixed(2)}, dynamics ${best.dyn.toFixed(2)}`);
    }
    const nrows = [];
    for (const id of ids) for (const nm of Object.keys(neural)) {
        const d = distance(fps[id][0], neural[nm], noise);
        nrows.push([id, nm, d]);
        if (d.total < GATES.neuralTotal || d.dyn < GATES.neuralDyn) fails.push(`${id} vs neural ${nm}: total ${d.total.toFixed(2)}, dynamics ${d.dyn.toFixed(2)}`);
    }
    for (const id of aperFails) fails.push(`${id}: not periodic under a steady tone (${fps[id][0].aper.toFixed(1)} dB off the harmonics, max ${APERIODIC_MAX})`);
    // report
    const md = ["# Analog circuit vetting", "", `Gates: pair total >= ${GATES.pairTotal} and dynamics >= ${GATES.pairDyn}; vs neural total >= ${GATES.neuralTotal} and dynamics >= ${GATES.neuralDyn}.`, ""];
    md.push("| circuit | THD % (200 Hz -24/-12/-3, 1 kHz) | knee dBFS | slope | sag dB | probe during / +50 / +200 / +800 ms dB | IMD 100 Hz dB | hyst dB | crest dB | aperiodic dB |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const id of ids) {
        const r = fps[id][0].raw, f = fps[id][0];
        md.push(`| ${id} | ${r.thd.join(", ")} | ${r.comp.knee} | ${r.comp.top.toFixed(2)} | ${r.burst.sag.toFixed(1)} | ${r.burst.during.toFixed(1)} / ${r.burst.rec.map((v) => v.toFixed(1)).join(" / ")} | ${r.imd.d100.toFixed(1)} | ${f.H[0].toFixed(2)} | ${f.T[0].toFixed(2)} | ${f.aper.toFixed(1)} |`);
    }
    rows.sort((a, b) => a[2].total - b[2].total);
    md.push("", "Closest pairs:", "", "| a | b | total | dynamics | E | S | C | B | I | H | T |", "|---|---|---|---|---|---|---|---|---|---|---|");
    for (const [a, b, d] of rows.slice(0, 12)) md.push(`| ${a} | ${b} | ${d.total.toFixed(2)} | ${d.dyn.toFixed(2)} | ${Object.keys(UNITS).map((g) => d.parts[g].toFixed(2)).join(" | ")} |`);
    if (nrows.length) {
        nrows.sort((a, b) => a[2].total - b[2].total);
        md.push("", "Closest to a neural capture:", "", "| circuit | capture | total | dynamics |", "|---|---|---|---|");
        for (const [a, b, d] of nrows.slice(0, 8)) md.push(`| ${a} | ${b} | ${d.total.toFixed(2)} | ${d.dyn.toFixed(2)} |`);
    }
    md.push("", fails.length ? "## FAIL\n\n" + fails.map((f) => "- " + f).join("\n") : "All gates pass.");
    fs.writeFileSync(path.join(OUT, "report.md"), md.join("\n") + "\n");
    fs.writeFileSync(path.join(OUT, "fingerprints.json"), JSON.stringify({ gains, fps, neural, noise }, null, 1));
    console.log(`closest pair ${minPair.a} / ${minPair.b}: total ${minPair.total.toFixed(2)}, dynamics ${minPair.dyn.toFixed(2)}`);
    console.log(fails.length ? `${fails.length} gate failures (see ${path.relative(ROOT, path.join(OUT, "report.md"))})` : "all gates pass");
    process.exitCode = fails.length ? 1 : 0;
}

main();
