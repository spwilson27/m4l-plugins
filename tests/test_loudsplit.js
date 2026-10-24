#!/usr/bin/env node
"use strict";
/**
 * Verification suite for devices/Loud Split.amxd + .adg (Spectral Split suite, slug `loudsplit`).
 *
 *  1. Mask reference (src/loudsplit_config.js): sum identity for every setting (threshold, knee, Relative, Tilt, Rise / Fall,
 *     crossed thresholds) through a packed-stereo STFT split, thresholds and knees, Relative gain invariance, Tilt as an
 *     analysis weight only, Rise / Fall step responses, loud and quiet partials, silence.
 *  2. The GenExpr functions (src/spectral_split_lib.genexpr + ls_* in src/loudsplit_core.genexpr), transpiled to JS with
 *     tests/genexpr_functions.js (bounds-checked Data), run as a sample-by-sample pipeline and compared with the reference.
 *  3. GenExpr lint (function order, single return, no e<digit> identifiers, Param names) and the shared link module.
 *  4. The built device: header, latency, 169 px, widget geometry (no overlap, no live.* over the v8ui), panels last,
 *     buffer names, wiring, parameter table versus the reference, and the .adg rack preset.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { minifyGen, builderGen } = require("./minify_gen.js");

const ROOT = path.resolve(__dirname, "..");
const cfg = require(path.join(ROOT, "src", "loudsplit_config.js"));
const ref = require(path.join(ROOT, "src", "cepstrum_ref.js"));
const { DataSim, load, functionsOf } = require("./genexpr_functions.js");
const { runLinkTests } = require("./spectral_link_tests.js");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const LIB_SRC = read("src/cepstrum_lib.genexpr");
const SS_SRC = read("src/spectral_split_lib.genexpr");
const CORE_SRC = read("src/loudsplit_core.genexpr");
const RACK_SRC = read("src/spectral_split_rack.genexpr");
// The gen code the device really embeds (the face writes it to a .gendsp file): lib + ss lib + rack functions + the expanded core.
function builtGenCode() {
    const raw = fs.readFileSync(path.join(ROOT, "devices", "Loud Split.amxd"));
    const p = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    const face = p.boxes.map((b) => b.box).find((b) => b.id === "obj-viz").textfile.text;
    const m = /var GEN_DSP_TEXT\s*=\s*("(?:\\.|[^"\\])*")\s*;/.exec(face);
    assert.ok(m, "face carries GEN_DSP_TEXT");
    const gendsp = JSON.parse(JSON.parse(m[1]));
    return gendsp.patcher.boxes.find((b) => b.box.maxclass === "codebox").box.code;
}
const GEN_CODE = builderGen("build_loudsplit");

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

const energy = (a, s, e) => {
    let v = 0;
    for (let i = s; i < e; i++) v += a[i] * a[i];
    return v;
};

// amplitude of the component at f Hz (Goertzel style projection) over [s, e)
const SR = 48000;
function amp(a, f, s, e) {
    let re = 0, im = 0;
    for (let i = s; i < e; i++) {
        re += a[i] * Math.cos((2 * Math.PI * f * i) / SR);
        im += a[i] * Math.sin((2 * Math.PI * f * i) / SR);
    }
    return (2 * Math.hypot(re, im)) / (e - s);
}

// ---- a Node mirror of the packed-stereo mask STFT (reference path, uses lsMasks) ----
function splitRef(L, R, n, sr, p) {
    const hop = n / 4;
    const win = ref.hann(n);
    const half = n / 2;
    const st = cfg.lsNewState(n);
    const out = [0, 1, 2].map(() => ({ L: new Float64Array(L.length + 2 * n), R: new Float64Array(L.length + 2 * n) }));
    const mag = new Float64Array(half + 1);
    const m = [0, 1, 2].map(() => new Float64Array(half + 1));
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
        cfg.lsMasks(st, mag, p, sr, m[0], m[1], m[2]);
        trace.push({ m: m.map((a) => Float64Array.from(a)), mag: Float64Array.from(mag) });
        m.forEach((mk, ch) => {
            const r2 = Float64Array.from(re);
            const i2 = Float64Array.from(im);
            for (let k = 0; k <= half; k++) {
                r2[k] *= mk[k];
                i2[k] *= mk[k];
                if (k > 0 && k < half) {
                    r2[n - k] *= mk[k];
                    i2[n - k] *= mk[k];
                }
            }
            ref.fft(r2, i2, true);
            for (let i = 0; i < n; i++) {
                const w = win[i] * (2 / 3);
                out[ch].L[s0 + i] += r2[i] * w;
                out[ch].R[s0 + i] += i2[i] * w;
            }
        });
    }
    return { q: out[0], m: out[1], l: out[2], trace };
}

const P0 = { relative: 0, hithr: -24, lothr: -48, rhithr: -12, rlothr: -36, hiknee: 6, loknee: 6, rise: 0.13, fall: 0.13, tilt: 0 };
const P = (o) => Object.assign({}, P0, o);

// ======================================================================
// 1. Reference behaviour
// ======================================================================
{
    // stimulus: loud 500 Hz (-8 dB), mid 1.5 kHz (-36 dB), quiet 3 kHz (-54 dB) + faint noise
    const N = SR * 2;
    const r = rng(5);
    const mixL = new Float64Array(N);
    const mixR = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        mixL[i] = 0.4 * Math.sin(2 * Math.PI * 500 * t) + 0.0158 * Math.sin(2 * Math.PI * 1500 * t) + 0.002 * Math.sin(2 * Math.PI * 3000 * t) + 0.01 * r();
        mixR[i] = 0.5 * mixL[i];
    }
    const settings = [
        ["default", P0],
        ["relative", P({ relative: 1 })],
        ["tilt +", P({ tilt: 4 })],
        ["tilt -", P({ tilt: -5 })],
        ["rise / fall", P({ rise: 8, fall: 12 })],
        ["knee 1", P({ hiknee: 1, loknee: 1 })],
        ["knee 24", P({ hiknee: 24, loknee: 24 })],
        ["crossed thresholds", P({ lothr: -10, hithr: -40 })],
        ["relative + tilt + rise", P({ relative: 1, tilt: -3, rise: 5, fall: 3, hiknee: 2 })],
    ];
    for (const n of [1024, 2048, 4096]) {
        for (const [name, p] of settings) {
            if (n !== 2048 && name !== "default" && name !== "relative + tilt + rise") continue;
            const o = splitRef(mixL, mixR, n, SR, p);
            let err = 0, tot = 0;
            for (let i = n; i < N - n; i++) {
                const d = o.q.L[i] + o.m.L[i] + o.l.L[i] - mixL[i];
                const dr = o.q.R[i] + o.m.R[i] + o.l.R[i] - mixR[i];
                err += d * d + dr * dr;
                tot += mixL[i] * mixL[i] + mixR[i] * mixR[i];
            }
            const db = 10 * Math.log10(err / tot + 1e-300);
            assert.ok(db < -250, `sum of channels must null at Size ${n}, "${name}" (got ${db} dB)`);
            for (const tr of o.trace) {
                for (let k = 0; k < tr.mag.length; k++) {
                    const a = tr.m[0][k], b = tr.m[1][k], c = tr.m[2][k];
                    assert.ok(Math.abs(a + b + c - 1) < 1e-12, `per-bin masks sum to 1 ("${name}")`);
                    assert.ok(a >= -1e-12 && b >= -1e-12 && c >= -1e-12, `masks are not negative ("${name}")`);
                }
            }
        }
    }
    console.log("[ref] sum identity (< -250 dB, masks sum to 1, non negative) at all sizes and settings");

    // loud / mid / quiet partials land in Loud / Mid / Quiet (default thresholds -24 / -48, 2k)
    {
        const o = splitRef(mixL, mixR, 2048, SR, P0);
        const s = SR / 2, e = SR * 3 / 2;
        const a = (ch, f) => amp(o[ch].L, f, s, e);
        const lo500 = a("l", 500) / (a("q", 500) + a("m", 500) + a("l", 500));
        const mi1500 = a("m", 1500) / (a("q", 1500) + a("m", 1500) + a("l", 1500));
        const qu3000 = a("q", 3000) / (a("q", 3000) + a("m", 3000) + a("l", 3000));
        console.log(`[ref] 500 Hz Loud share ${lo500.toFixed(3)}, 1.5 kHz Mid share ${mi1500.toFixed(3)}, 3 kHz Quiet share ${qu3000.toFixed(3)}`);
        assert.ok(lo500 > 0.95 && mi1500 > 0.95 && qu3000 > 0.95, "partials land in their bands");
    }

    // Relative mode: scaling the whole input does not change the split; Absolute mode does
    {
        const g = 0.03;
        const sL = Float64Array.from(mixL, (v) => v * g), sR = Float64Array.from(mixR, (v) => v * g);
        const share = (L, R, p) => {
            const o = splitRef(L, R, 2048, SR, p);
            const s = SR / 2, e = SR * 3 / 2;
            const lq = amp(o.l.L, 500, s, e), mq = amp(o.m.L, 500, s, e), qq = amp(o.q.L, 500, s, e);
            return lq / (lq + mq + qq);
        };
        const rel1 = share(mixL, mixR, P({ relative: 1 })), rel2 = share(sL, sR, P({ relative: 1 }));
        const abs1 = share(mixL, mixR, P0), abs2 = share(sL, sR, P0);
        console.log(`[ref] 500 Hz Loud share: Relative ${rel1.toFixed(3)} -> ${rel2.toFixed(3)} at -30 dB input, Absolute ${abs1.toFixed(3)} -> ${abs2.toFixed(3)}`);
        assert.ok(rel1 > 0.95 && rel2 > 0.95, "Relative mode: the loudest partial stays Loud at any input level");
        assert.ok(abs1 > 0.95 && abs2 < 0.2, "Absolute mode: the same partial drops out of Loud at -30 dB");
    }

    // thresholds and knees, per bin (flat magnitude spectrum at a given dB)
    {
        const n = 1024, half = 512;
        const mk = () => ({ st: cfg.lsNewState(n), mag: new Float64Array(half + 1), q: new Float64Array(half + 1), m: new Float64Array(half + 1), l: new Float64Array(half + 1) });
        const at = (db, p, frames) => {
            const s = mk();
            s.mag.fill(Math.pow(10, db / 20));
            for (let f = 0; f < (frames || 3); f++) cfg.lsMasks(s.st, s.mag, Object.assign({}, P0, p), SR, s.q, s.m, s.l);
            return [s.q[100], s.m[100], s.l[100]];
        };
        // hard knees: step exactly at the thresholds
        const hard = { hiknee: 1, loknee: 1 };
        assert.deepStrictEqual(at(-60, hard), [1, 0, 0], "below Lower: Quiet");
        assert.deepStrictEqual(at(-36, hard), [0, 1, 0], "between: Mid");
        assert.deepStrictEqual(at(-10, hard), [0, 0, 1], "above Higher: Loud");
        // smooth knees: centre of the knee is 50 / 50, edges are pure, monotonic
        const kn = { hiknee: 10, loknee: 10 };
        const c = at(-24, kn);
        assert.ok(Math.abs(c[1] - 0.5) < 1e-9 && Math.abs(c[2] - 0.5) < 1e-9, "Higher knee centre: Mid / Loud 50 / 50");
        const c2 = at(-48, kn);
        assert.ok(Math.abs(c2[0] - 0.5) < 1e-9 && Math.abs(c2[1] - 0.5) < 1e-9, "Lower knee centre: Quiet / Mid 50 / 50");
        assert.ok(at(-19.01, kn)[2] > 0.99 && at(-28.99, kn)[1] > 0.99, "knee edges are pure bands");
        let prev = -1;
        for (let db = -90; db <= 0; db += 1) {
            const v = at(db, kn);
            assert.ok(v[2] >= prev - 1e-12, "Loud share rises monotonically with level");
            prev = v[2];
            assert.ok(Math.abs(v[0] + v[1] + v[2] - 1) < 1e-12);
        }
        // thresholds move the boundary
        assert.ok(at(-30, { hithr: -35, hiknee: 1 })[2] === 1 && at(-30, { hithr: -20, hiknee: 1 })[2] === 0, "Higher Threshold moves the Loud boundary");
        assert.ok(at(-60, { lothr: -70, loknee: 1 })[0] === 0 && at(-60, { lothr: -50, loknee: 1 })[0] === 1, "Lower Threshold moves the Quiet boundary");
        // crossed thresholds: Lower is clamped to Higher, still a valid split
        const x = at(-30, { lothr: -10, hithr: -40, hiknee: 1, loknee: 1 });
        assert.ok(Math.abs(x[0] + x[1] + x[2] - 1) < 1e-12 && x[1] === 0, "crossed thresholds leave no Mid band");
        // silence is Quiet
        assert.deepStrictEqual(at(-200, {}), [1, 0, 0], "silent bins are Quiet");
        // relative: the loudest bin is 0 dB; Relative thresholds -12 / -36
        const s = mk();
        s.mag.fill(Math.pow(10, -60 / 20));
        s.mag[50] = 0.5;
        s.mag[60] = 0.5 * Math.pow(10, -20 / 20);
        s.mag[70] = 0.5 * Math.pow(10, -50 / 20);
        for (let f = 0; f < 3; f++) cfg.lsMasks(s.st, s.mag, P({ relative: 1, hiknee: 1, loknee: 1 }), SR, s.q, s.m, s.l);
        assert.ok(s.l[50] === 1 && s.m[60] === 1 && s.q[70] === 1, "Relative: 0 dB bin Loud, -20 dB Mid, -50 dB Quiet");
        // Tilt weights the analysis: +6 dB/oct lifts the highs, no gain on the output
        const tl = (db, f, tilt) => {
            const s2 = mk();
            s2.mag.fill(Math.pow(10, db / 20));
            for (let ff = 0; ff < 3; ff++) cfg.lsMasks(s2.st, s2.mag, P({ tilt, hiknee: 1, loknee: 1 }), SR, s2.q, s2.m, s2.l);
            const k = Math.round(f * n / SR);
            return [s2.q[k], s2.m[k], s2.l[k]];
        };
        assert.deepStrictEqual(tl(-30, 8000, 0), [0, 1, 0]);
        assert.deepStrictEqual(tl(-30, 8000, 6), [0, 0, 1], "positive Tilt favours highs (8 kHz is +18 dB)");
        assert.deepStrictEqual(tl(-32, 125, 6), [1, 0, 0], "positive Tilt pushes the lows down (125 Hz is -18 dB: -50 dB)");
        assert.deepStrictEqual(tl(-30, 125, -6), [0, 0, 1], "negative Tilt favours lows");
        assert.ok(Math.abs(cfg.lsTiltDb(Math.round(1000 * 1024 / SR), 1024, SR, 6) - 6 * Math.log2(Math.round(1000 * 1024 / SR) * SR / 1024 / 1000)) < 1e-9);
    }

    // Rise / Fall: step responses in blocks
    {
        const n = 1024, half = 512;
        const mkRun = (p) => {
            const st = cfg.lsNewState(n);
            const mag = new Float64Array(half + 1), q = new Float64Array(half + 1), m = new Float64Array(half + 1), l = new Float64Array(half + 1);
            return (db) => {
                mag.fill(Math.pow(10, db / 20));
                cfg.lsMasks(st, mag, Object.assign({}, P0, { hiknee: 1, loknee: 1 }, p), SR, q, m, l);
                return [q[100], m[100], l[100]];
            };
        };
        const framesTo = (run, from, to, pick, level) => {
            for (let i = 0; i < 4; i++) run(from);
            let f = 0;
            for (; f < 200; f++) if (run(to)[pick] >= level) break;
            return f;
        };
        const r0 = framesTo(mkRun({}), -60, -10, 2, 1);
        const r8 = framesTo(mkRun({ rise: 8 }), -60, -10, 2, 1);
        const r16 = framesTo(mkRun({ rise: 16 }), -60, -10, 2, 1);
        assert.strictEqual(r0, 0, "Rise 0: Loud at once");
        assert.ok(r8 > 2 && r16 > r8, `Rise delays the move into a louder band (blocks to Loud: 0 / ${r8} / ${r16})`);
        const f0 = framesTo(mkRun({}), -10, -60, 0, 1);
        const f8 = framesTo(mkRun({ fall: 8 }), -10, -60, 0, 1);
        const f16 = framesTo(mkRun({ fall: 16 }), -10, -60, 0, 1);
        assert.strictEqual(f0, 0, "Fall 0: Quiet at once");
        assert.ok(f8 > 0 && f16 > f8, `Fall delays the drop into a quieter band (blocks to Quiet: 0 / ${f8} / ${f16})`);
        // Rise does not slow a fall and Fall does not slow a rise
        assert.strictEqual(framesTo(mkRun({ rise: 16 }), -10, -60, 0, 1), 0);
        assert.strictEqual(framesTo(mkRun({ fall: 16 }), -60, -10, 2, 1), 0);
        console.log(`[ref] Rise blocks to Loud 0 / ${r8} / ${r16}, Fall blocks to Quiet 0 / ${f8} / ${f16}`);
    }

    // the full pipeline is silent for silence; a left-only signal stays left-only
    const z = splitRef(new Float64Array(8192), new Float64Array(8192), 1024, SR, P0);
    assert.strictEqual(energy(z.q.L, 0, 8192) + energy(z.m.L, 0, 8192) + energy(z.l.L, 0, 8192), 0, "silence in -> exact zeros out");
    const lonly = splitRef(mixL, new Float64Array(mixL.length), 1024, SR, P0);
    assert.ok(energy(lonly.q.R, 2048, 40000) + energy(lonly.m.R, 2048, 40000) + energy(lonly.l.R, 2048, 40000) < 1e-20, "a left-only signal stays left-only (stereo image kept)");
    console.log("[ref] mask reference tests passed");
}

// ======================================================================
// 2. GenExpr functions transpiled to JS: lib + ls_* match the reference
// ======================================================================
function prep(src) {
    return src
        .replace(/(?<![.\w])poke\((\w+),\s*/g, "$1.poke(")
        .replace(/\blog10\(/g, "Math.log10(")
        .replace(/\batan2\(/g, "Math.atan2(");
}
{
    const loadGx = () => load(prep(LIB_SRC), prep(SS_SRC), prep(CORE_SRC.split("//@SS_DECL")[0]));
    const run = (n, sel, p, x, y, frames) => {
        const gx = loadGx();      // fresh History state (fft_init / stft_win remember their tables) for every run
        const half = n / 2;
        const tab = new DataSim(4096, 3), win = new DataSim(4096), fx = new DataSim(4096, 2);
        const ringL = new DataSim(4096), ringR = new DataSim(4096), accL = new DataSim(4096), accR = new DataSim(4096);
        const stt = new DataSim(8), ms = new DataSim(2049, 2), lsd = new DataSim(2049, 8);
        const cols = new DataSim(512), scope = new DataSim(544);
        const outL = new Float64Array(x.length), outR = new Float64Array(x.length);
        let age = 0;
        gx.ls_tilttab(lsd, n, SR);
        const masks = [];
        const rel = p.relative > 0.5;
        const thi = rel ? p.rhithr : p.hithr, tlo = rel ? p.rlothr : p.lothr;
        for (let i = 0; i < x.length; i++) {
            gx.fft_init(tab);
            gx.stft_win(win, n);
            const rdy = gx.ss_in(ringL, ringR, stt, x[i], y[i], n);
            if (rdy > 0.5) {
                gx.ss_frame(fx, ringL, ringR, stt, win, n);
                gx.fft_run(fx, tab, n, 0);
                gx.ss_mid(fx, ms, n);
                gx.ls_masks(ms, lsd, n, SR, rel ? 1 : 0, thi, tlo, p.hiknee, p.loknee, p.rise, p.fall, p.tilt, age);
                age = Math.min(age + 1, 3);
                if (masks.length < frames) {
                    masks.push({ mag: Array.from({ length: half + 1 }, (_, k) => ms.peek(k, 0)),
                        m: [4, 3, 2].map((ch) => Array.from({ length: half + 1 }, (_, k) => lsd.peek(k, ch))),
                        sum: Array.from({ length: half + 1 }, (_, k) => lsd.peek(k, 5)) });
                }
                gx.ss_apply(fx, lsd, sel === 0 ? 5 : sel + 1, n);   // outsel 1 Loud = lsd ch 2, 2 Mid = 3, 3 Quiet = 4
                if (i % 4096 < 256) {
                    gx.ss_cols(ms, 0, lsd, -1, cols, 0, n, SR, 128, 30, 20000);
                    for (let c = 1; c <= 3; c++) gx.ss_cols(ms, 0, lsd, 5 - c, cols, c, n, SR, 128, 30, 20000);
                    gx.ss_tele(cols, scope, 128, 4, 0);
                    gx.ls_mean(ms, lsd, n);
                }
                gx.fft_run(fx, tab, n, 1);
                gx.ss_ola(accL, accR, stt, fx, win, n);
            }
            outL[i] = gx.ss_out(accL, stt, n, 3);
            outR[i] = gx.ss_out(accR, stt, n, 4);
        }
        return { outL, outR, masks, scope };
    };

    const n = 1024;
    const N = 24000;
    const r = rng(21);
    const x = new Float64Array(N), y = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        const burst = (i % 6000) < 1500 ? Math.exp(-(i % 6000) / 300) : 0;
        x[i] = 0.2 * Math.sin(i * 0.05) + 0.4 * burst * r() + 0.003 * Math.sin(i * 0.2);
        y[i] = 0.15 * Math.sin(i * 0.031) + 0.3 * burst * r();
    }
    // All (sel 0, sum of masks) is an exact delayed identity
    {
        const g = run(n, 0, P0, x, y, 6);
        let e = 0, t = 0;
        for (let i = n; i < N; i++) {
            const dl = g.outL[i] - x[i - (n - 1)], dr = g.outR[i] - y[i - (n - 1)];
            e += dl * dl + dr * dr;
            t += x[i - (n - 1)] ** 2 + y[i - (n - 1)] ** 2;
        }
        assert.ok(10 * Math.log10(e / t) < -250, `ss_* chain is an exact delayed identity (got ${10 * Math.log10(e / t)} dB)`);
    }
    const sets = [P0, P({ relative: 1 }), P({ tilt: 3.5, rise: 6, fall: 9 }), P({ relative: 1, tilt: -2, hiknee: 1, loknee: 14, rise: 3 }),
        P({ lothr: -10, hithr: -40 }), P({ hiknee: 24, loknee: 1, rise: 20, fall: 1 })];
    for (const p of sets) {
        const a = run(n, 1, p, x, y, 6), b = run(n, 2, p, x, y, 6), c = run(n, 3, p, x, y, 6);
        let e = 0, t = 0;
        for (let i = n; i < N; i++) {
            const dl = a.outL[i] + b.outL[i] + c.outL[i] - x[i - (n - 1)], dr = a.outR[i] + b.outR[i] + c.outR[i] - y[i - (n - 1)];
            e += dl * dl + dr * dr;
            t += x[i - (n - 1)] ** 2 + y[i - (n - 1)] ** 2;
        }
        assert.ok(10 * Math.log10(e / t) < -250, `Quiet + Mid + Loud null against the delayed input (got ${10 * Math.log10(e / t)} dB)`);
        const crossed = p.lothr > p.hithr;     // no Mid band when Lower is above Higher
        assert.ok(energy(a.outL, 0, N) > 0 && (crossed || energy(b.outL, 0, N) > 0) && energy(c.outL, 0, N) > 0, `all three channels carry signal (${JSON.stringify(p)})`);
    }
    // GenExpr masks match the reference frame for frame
    for (const p of sets) {
        const g = run(n, 1, p, x, y, 60);
        const st = cfg.lsNewState(n);
        const q = new Float64Array(n / 2 + 1), m = new Float64Array(n / 2 + 1), l = new Float64Array(n / 2 + 1);
        let maxd = 0;
        for (const f of g.masks) {
            cfg.lsMasks(st, Float64Array.from(f.mag), p, SR, q, m, l);
            for (let k = 0; k <= n / 2; k++) {
                maxd = Math.max(maxd, Math.abs(q[k] - f.m[0][k]), Math.abs(m[k] - f.m[1][k]), Math.abs(l[k] - f.m[2][k]));
                assert.ok(Math.abs(f.sum[k] - 1) < 1e-12, "GenExpr sum channel is 1");
            }
        }
        assert.ok(maxd < 1e-9, `GenExpr masks equal the JS reference (max diff ${maxd}) for ${JSON.stringify(p)}`);
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
        const g = run(n, 3, P0, x, y, 2);
        let nonzero = 0;
        for (let i = 0; i < 512; i++) {
            const v = g.scope.peek(i);
            assert.ok(v >= 0 && v <= 1.0000001, `telemetry value ${i} in 0..1 (${v})`);
            if (v > 0) nonzero++;
        }
        assert.ok(nonzero > 100, "telemetry columns are filled");
    }
    console.log("[genexpr] transpiled lib + ls_* tests passed");
}

// ======================================================================
// 3. GenExpr lint, link module
// ======================================================================
{
    const fnsLib = functionsOf(SS_SRC).concat(functionsOf(RACK_SRC));
    const fnsCore = functionsOf(CORE_SRC);
    for (const fn of fnsLib.concat(fnsCore)) {
        const rets = fn.body.filter((l) => /^\s*return\b/.test(l));
        assert.strictEqual(rets.length, 1, `${fn.name}: exactly one return`);
        assert.ok(/^\treturn\b/.test(fn.body[fn.body.length - 1]), `${fn.name}: the return is the last statement, at function level`);
        for (const l of fn.body) assert.ok(!/\bif\s*\(\s*[^)]*\b(ss2?|ls|stft|fft|cep)_\w+\(/.test(l), `${fn.name}: no function call inside an if condition`);
    }
    for (const src of [SS_SRC, RACK_SRC, GEN_CODE]) {
        const code = src.replace(/\/\/.*$/gm, "");
        assert.ok(!/\bpoke\([^;]*\b(ss2?|ls|stft|fft|cep)_\w+\(/.test(code), "no user function call inside poke() arguments (silent compile failure in Max)");
        assert.ok(!/\be\d\b/.test(code), "no identifier e<digit>");
        assert.ok(!/\b(phi|pi)\s*=/.test(code), "no phi / pi assignments");
        assert.ok(!/\b(rise|fall|noise|bias)\s*[=,)]/.test(code.replace(/Param \w+\(/g, "")), "no operator-named identifiers (rise, fall, noise, bias)");
    }
    // statements of the expanded core: no function call in an if condition either
    for (const l of GEN_CODE.split("\n")) {
        if (/^\s*(\}\s*else\s*)?if\s*\(/.test(l)) assert.ok(!/\b(ss2?|ls|stft|fft|cep)_\w+\(/.test(l.replace(/\/\/.*$/, "")), `no function call inside an if condition: ${l.trim()}`);
    }
    // ordering: all functions, then Buffer, Data, Param, History, Delay, then statements
    const lines = GEN_CODE.split("\n");
    const firstDecl = lines.findIndex((l) => /^(Buffer|Data|Param|History|Delay)\b/.test(l));
    const lastFnHeader = lines.reduce((m, l, i) => (/^[A-Za-z_]\w*\([^)]*\) \{$/.test(l) ? i : m), -1);
    assert.ok(lastFnHeader > 0 && lastFnHeader < firstDecl, "every function sits before the first Buffer / Data / Param / History / Delay declaration");
    const lastDecl = lines.reduce((m, l, i) => (/^(Buffer|Data|Param|History|Delay)\b/.test(l) ? i : m), -1);
    const firstStmt = lines.findIndex((l, i) => i > lastDecl && /^[a-zA-Z_]/.test(l));
    assert.ok(firstStmt > lastDecl, "statements follow the declarations");
    for (const l of lines.slice(firstDecl, lastDecl + 1)) assert.ok(l.trim() === "" || /^(Buffer|Data|Param|History|Delay)\b|^\/\//.test(l), `declaration block only holds declarations: ${l}`);
    for (const name of ["fftn", "thrhi", "thrlo", "rthrhi", "rthrlo", "kneehi", "kneelo", "relmode", "risebl", "fallbl", "tiltdb", "outsel", "mixamt", "role", "serve", "epoch"]) assert.ok(new RegExp(`^Param ${name}\\(`, "m").test(GEN_CODE), `Param ${name}`);
    assert.ok(/Buffer scope\("loudsplitscope"\)/.test(CORE_SRC), "Buffer bound by the GenExpr variable name `scope` (no set prefix)");
    // the scope layout matches the config constants
    const m = GEN_CODE.match(/poke\(scope, frameNo, (\d+), 0\)/);
    assert.strictEqual(Number(m[1]), cfg.LS_SC_FRAME, "telemetry frame counter slot");
    assert.ok(GEN_CODE.includes(`poke(scope, lmean, ${cfg.LS_SC_LOUDMEAN}, 0)`) && GEN_CODE.includes("lmean = ls_mean(ms, lsd, n);"), "mean slot");
    // the rack template writes the common scalars at SCB + offset (SCB = LS_SC_FRAME): every offset is the config's
    const scal = { 1: "LS_SC_SR", 2: "LS_SC_N", 3: "LS_SC_AWAKE", 4: "LS_SC_LEVEL", 6: "LS_SC_LATENCY", 7: "LS_SC_SEL", 8: "LS_SC_CMP", 9: "LS_SC_FOL", 10: "LS_SC_ALIGNED",
        11: "LS_SC_FB", 12: "LS_SC_DOFF", 13: "LS_SC_UNDER", 14: "LS_SC_LAG", 15: "LS_SC_SERVE", 16: "LS_SC_ROLE", 17: "LS_SC_ALIVE" };
    for (const [off, key] of Object.entries(scal)) {
        assert.strictEqual(cfg.LS_SC_FRAME + Number(off), cfg[key], `${key} = LS_SC_FRAME + ${off}`);
        assert.ok(GEN_CODE.includes(`, ${cfg.LS_SC_FRAME} + ${off}, 0);`), `gen writes scope slot ${key}`);
    }
    assert.ok(cfg.LS_SC_THI >= cfg.LS_SC_FRAME + 18 && cfg.LS_SC_LMAX < cfg.LS_SCOPE_SAMPS, "the device's threshold slots sit above the rack scalars");
    assert.ok(GEN_CODE.includes(`poke(scope, thEff, ${cfg.LS_SC_THI}, 0)`) && GEN_CODE.includes(`poke(scope, tlEff, ${cfg.LS_SC_TLO}, 0)`) && GEN_CODE.includes(`poke(scope, lmx, ${cfg.LS_SC_LMAX}, 0)`), "threshold / loudest-bin slots");
    assert.ok(GEN_CODE.includes("ss_tele(cols, scope, 128, 4, 0)"), "four telemetry slots (pre + 3 channels)");
    assert.ok(cfg.LS_SC_QUIET === 128 && cfg.LS_SC_MID === 256 && cfg.LS_SC_LOUD === 384, "column blocks");
    assert.ok(cfg.LS_SCOPE_SAMPS <= 544, "scope buffer big enough");
    assert.ok(GEN_CODE.includes("ss2_zeroscope(scope, 512)"), "sleep zeroes the 512 telemetry columns");
    assert.ok(!/@@/.test(GEN_CODE) && !/\/\/@(hook|endhook|SS_)/.test(GEN_CODE), "the template is fully expanded");
    assert.ok(GEN_CODE.includes(`Delay dryL(${cfg.LS_LATENCY + 1})`) && GEN_CODE.includes(`dryL.read(${cfg.LS_LATENCY})`), "dry delay = the reported latency");
    // channel rows of the mask Data: Loud 2, Mid 3, Quiet 4 (template MKB = 2, K = 3), their sum in row 5
    assert.ok(GEN_CODE.includes("ss_apply(fy, lsd, 2 + c, n)"), "the template applies mask rows MKB + c of lsd");
    assert.ok(/lsd\.poke\(sh, k, 2\);\s*lsd\.poke\(mm, k, 3\);\s*lsd\.poke\(mq, k, 4\);\s*lsd\.poke\(mq \+ mm \+ sh, k, 5\);/.test(CORE_SRC), "Loud / Mid / Quiet / sum rows");

    runLinkTests();
    // lsResolveSel / names
    assert.strictEqual(cfg.lsResolveSel(0, 0), 1);
    assert.strictEqual(cfg.lsResolveSel(0, 1), 2);
    assert.strictEqual(cfg.lsResolveSel(0, 2), 3);
    assert.strictEqual(cfg.lsResolveSel(0, 7), 3, "Auto clamps to the last channel");
    assert.strictEqual(cfg.lsResolveSel(0, -1), 0, "Auto outside a rack = all");
    assert.strictEqual(cfg.lsResolveSel(1, 2), 1);
    assert.strictEqual(cfg.lsResolveSel(2, 0), 2);
    assert.strictEqual(cfg.lsResolveSel(3, 0), 3);
    assert.strictEqual(cfg.lsResolveSel(4, 0), 0);
    assert.strictEqual(cfg.lsSelName(1), "Loud");
    assert.strictEqual(cfg.lsSelName(3), "Quiet");
    console.log("[lint] genexpr lint and link module tests passed");
}

// ======================================================================
// 4. The built device and rack preset
// ======================================================================
{
    const amxd = path.join(ROOT, "devices", "Loud Split.amxd");
    const raw = fs.readFileSync(amxd);
    assert.strictEqual(raw.slice(0, 4).toString(), "ampf");
    assert.strictEqual(raw.slice(8, 12).toString(), "aaaa", "audio effect");
    assert.strictEqual(raw.readUInt32LE(28), raw.length - 32);
    const p = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    assert.strictEqual(p.latency, cfg.LS_LATENCY, "latency attribute = LS_LATENCY (5120)");
    assert.strictEqual(cfg.LS_LATENCY, 5120);
    assert.strictEqual(p.openrect[3], 169, "169 px high");
    assert.strictEqual(p.openrect[2], p.devicewidth);
    assert.strictEqual(p.openinpresentation, 1);
    const boxes = p.boxes.map((b) => b.box);
    const byId = {};
    for (const b of boxes) {
        assert.ok(!byId[b.id], `unique id ${b.id}`);
        byId[b.id] = b;
    }
    for (const l of p.lines) assert.ok(byId[l.patchline.source[0]] && byId[l.patchline.destination[0]], `line endpoints exist ${JSON.stringify(l.patchline)}`);
    // deferred DSP (AGENTS.md 1d): no gen~ in the saved device, a gate 1 1 hub, scripting names, no static audio cord
    assert.ok(!byId["obj-gen"], "the device ships without its gen~");
    assert.strictEqual(byId["obj-genin"].text, "gate 1 1");
    assert.deepStrictEqual([byId["obj-genin"].varname, byId["obj-plugin"].varname, byId["obj-plugout"].varname], ["ss_genin", "ss_plugin", "ss_plugout"]);
    const allLines = p.lines.map((l) => l.patchline);
    assert.ok(!allLines.some((l) => l.source[0] === "obj-plugin" || l.destination[0] === "obj-plugout"), "no static audio cord (the face wires plugin~ -> gen~ -> plugout~)");
    assert.ok(allLines.every((l) => l.destination[0] !== "obj-gen"), "no cord into a gen~ that is not there");
    assert.ok(allLines.some((l) => l.source[0] === "obj-viz" && l.source[1] === 2 && l.destination[0] === "obj-genin" && l.destination[1] === 1), "face outlet 2 -> hub data inlet");
    // the embedded gen = lib + ss lib + rack functions + the expanded core
    assert.strictEqual(builtGenCode(), minifyGen(GEN_CODE), "embedded gen is the mangled core");
    assert.ok(GEN_CODE.indexOf("fft_run(") < GEN_CODE.indexOf("ss_in(") && GEN_CODE.indexOf("ss_in(") < GEN_CODE.indexOf("ss2_align(") && GEN_CODE.indexOf("ss2_align(") < GEN_CODE.indexOf("ls_masks("), "library functions come first");
    assert.ok(GEN_CODE.startsWith(LIB_SRC.replace(/\s+$/, "") + "\n"), "gen code starts with cepstrum_lib");
    assert.ok(GEN_CODE.includes(SS_SRC.replace(/\s+$/, "") + "\n") && GEN_CODE.includes(RACK_SRC.replace(/\s+$/, "") + "\n"), "gen code contains spectral_split_lib and spectral_split_rack verbatim");
    const faceTxt = byId["obj-viz"].textfile.text;
    assert.ok(/var GEN_DSP_HASH\s*=\s*"[0-9a-f]{12}"\s*;/.test(faceTxt) && /var SS_PREFIX\s*=\s*"loudsplit"\s*;/.test(faceTxt), "face carries the gen patch hash and prefix");
    assert.ok(faceTxt.includes("function ssDspLoad") && faceTxt.includes("function ssDspRestart"), "face carries the deferred-DSP module");
    assert.ok(byId["obj-scope-buf"].text.startsWith("buffer~ ---loudsplitscope"), "per-instance buffer name");
    assert.ok(Number(byId["obj-scope-buf"].text.match(/@samps (\d+)/)[1]) >= cfg.LS_SCOPE_SAMPS, "scope buffer length");
    assert.ok(byId["obj-ring-buf"].text.startsWith("buffer~ ---ssring @samps "), "per-instance ring buffer");
    assert.ok(Number(byId["obj-ring-buf"].text.match(/@samps (\d+)/)[1]) === 16 + 8192 * 9, "ring length = header + slots * stride (3 channels + All row)");
    assert.strictEqual(byId["obj-msg-ui-names"].text, "setnames ---loudsplitscope ---ssring", "the face learns both per-instance buffer names");
    assert.ok(!boxes.some((b) => /#0/.test(b.text || "") && b.text !== "r #0-sstest"), "no #0 names in a top-level device (the test hook receive #0-sstest is the one deliberate shared name)");
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
    for (const [key, spec] of Object.entries(cfg.LS_PARAMS)) {
        const v = byId[`obj-ctrl-${key}`].saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_longname, spec[0], `${key} long name`);
        assert.strictEqual(v.parameter_shortname, spec[1]);
        assert.deepStrictEqual([v.parameter_mmin, v.parameter_mmax, v.parameter_initial[0], v.parameter_type], [spec[2], spec[3], spec[4], spec[5]], `${key} range / initial / type`);
        if (v.parameter_type === 1) assert.ok(v.parameter_mmax <= 255, "native Int parameters stay <= 255");
        assert.ok(!names.has(v.parameter_shortname), "unique short name");
        names.add(v.parameter_shortname);
    }
    for (const [key, spec] of Object.entries(cfg.LS_ENUMS)) {
        const v = byId[`obj-ctrl-${key}`].saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_longname, spec[0]);
        assert.deepStrictEqual(v.parameter_enum, spec[2], `${key} enum`);
        assert.strictEqual(v.parameter_initial[0], spec[3], `${key} initial`);
        assert.ok(!names.has(v.parameter_shortname), "unique short name");
        names.add(v.parameter_shortname);
    }
    assert.strictEqual(byId["obj-ctrl-size"].saved_attribute_attributes.valueof.parameter_initial[0], 1, "Size defaults to 2k");
    assert.deepStrictEqual(byId["obj-ctrl-output"].saved_attribute_attributes.valueof.parameter_enum, ["Auto", "Loud", "Mid", "Quiet", "All"]);
    for (const key of ["dispost", "disstyle"]) {
        const b = byId[`obj-ctrl-${key}`];
        assert.strictEqual(b.saved_attribute_attributes.valueof.parameter_invisible, 1, `${key} is UI state only`);
        assert.ok(b.presentation !== 1, `${key} is not in the presentation`);
    }
    // wiring
    const lines = p.lines.map((l) => l.patchline);
    const from = (id) => lines.filter((l) => l.source[0] === id).map((l) => l.destination[0]);
    const GEN = { hithr: "thrhi", lothr: "thrlo", rhithr: "rthrhi", rlothr: "rthrlo", hiknee: "kneehi", loknee: "kneelo", relative: "relmode", rise: "risebl", fall: "fallbl", tilt: "tiltdb", size: "fftn" };
    for (const [key, msg] of Object.entries(GEN)) {
        assert.strictEqual(byId[`obj-prep-${key}`].text, `prepend ${msg}`);
        assert.ok(from(`obj-prep-${key}`).includes("obj-genin"), `${key} -> hub -> gen`);
        assert.ok(from(`obj-ui-${key}`).includes("obj-viz") && byId[`obj-ui-${key}`].text === `prepend set_${key}`, `${key} -> face`);
    }
    assert.ok(byId["obj-expr-size"].text.startsWith("expr 1024 * pow(2"), "Size -> 1024 * 2^i");
    assert.ok(from("obj-ctrl-output").includes("obj-ui-output") && !from("obj-ctrl-output").includes("obj-prep-output"), "Output goes to the face only (it resolves Auto)");
    const linkRoute = byId["obj-route-link"].text.split(" ").slice(1);
    assert.deepStrictEqual(linkRoute, cfg.LS_LINKED_KEYS, "link route lists the linked keys, in order");
    assert.ok(!linkRoute.includes("output") && !linkRoute.includes("dispost"), "Output and the display toggles are not linked");
    linkRoute.forEach((key, i) => {
        const dests = lines.filter((l) => l.source[0] === "obj-route-link" && l.source[1] === i).map((l) => l.destination[0]);
        assert.ok(dests.includes(`obj-lset-${key}`), `${key}: peer value -> prepend set`);
        assert.strictEqual(byId[`obj-lset-${key}`].text, "prepend set");
        assert.ok(from(`obj-lset-${key}`).includes(`obj-ctrl-${key}`), `${key}: prepend set -> control`);
        assert.ok(dests.length === 2, `${key}: peer value also feeds the gen path`);
        assert.ok(!dests.includes("obj-gen"), `${key}: only through the hub`);
    });
    // canvas edits reach the controls
    const canvas = byId["obj-route-canvas"].text.split(" ").slice(1);
    for (const key of ["hithr", "lothr", "rhithr", "rlothr", "hiknee", "loknee", "dispost", "disstyle"]) {
        const i = canvas.indexOf(key);
        assert.ok(i >= 0 && lines.some((l) => l.source[0] === "obj-route-canvas" && l.source[1] === i && l.destination[0] === `obj-ctrl-${key}`), `canvas edit ${key} -> control`);
    }
    // Relative mode greys out the unused pair
    assert.strictEqual(byId["obj-route-active"].text, "route act_abs act_rel");
    assert.ok(lines.some((l) => l.source[0] === "obj-viz" && l.source[1] === 3 && l.destination[0] === "obj-route-active"), "face outlet 3 -> active route");
    for (const key of ["hithr", "lothr"]) assert.ok(lines.some((l) => l.source[0] === "obj-act-abs" && l.destination[0] === `obj-ctrl-${key}`), `${key} greyed in Relative mode`);
    for (const key of ["rhithr", "rlothr"]) assert.ok(lines.some((l) => l.source[0] === "obj-act-rel" && l.destination[0] === `obj-ctrl-${key}`), `${key} greyed in Absolute mode`);
    assert.ok(lines.some((l) => l.source[0] === "obj-r-sstest" && l.destination[0] === "obj-viz"), "test hook receive #0-sstest -> face");
    assert.ok(lines.some((l) => l.source[0] === "obj-thisdevice" && l.destination[0] === "obj-msg-init") && byId["obj-msg-init"].text === "init_link", "init from live.thisdevice, not loadbang");
    // the face script
    const face = byId["obj-viz"].textfile.text;
    assert.ok(face.includes("function splCreateLink") && face.includes("function lsMasks") && face.includes("function paint"), "face = config + link + ui");
    assert.ok(/mgraphics\.relative_coords\s*=\s*0/.test(face) && /mgraphics\.autofill\s*=\s*0/.test(face), "v8ui pixel coordinates");
    assert.ok(!/\bvar\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(face), "no declared v8ui globals");
    assert.ok(/outlets\s*=\s*4/.test(face) && byId["obj-viz"].numoutlets === 4, "four face outlets");
    // .adg
    const adg = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "devices", "Loud Split.adg"))).toString("utf8");
    const branches = adg.match(/<AudioEffectBranchPreset Id="\d+">/g);
    assert.strictEqual(branches.length, 3, "three chains");
    const names2 = [...adg.matchAll(/<AudioEffectBranchPreset Id="\d+">\s*<Name Value="([^"]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(names2, ["Loud", "Mid", "Quiet"], "chains are named after the channels, in order");
    assert.strictEqual((adg.match(/<MxDeviceAudioEffect /g) || []).length, 3, "one device per chain");
    assert.strictEqual((adg.match(/<UserName Value="Loud Split"/g) || []).length, 1, "rack name");
    assert.strictEqual((adg.match(/Loud Split\.amxd/g) || []).length >= 6, true, "each chain references the .amxd (relative and absolute)");
    console.log("[device] built device and rack preset checks passed");
}

// ======================================================================
// 5. Bitwig redesign: ranges / defaults, fractional Rise / Fall, Mix
// ======================================================================
{
    const L = cfg.LS_PARAMS;
    assert.deepStrictEqual([L.hithr[2], L.hithr[3], L.hithr[4], L.lothr[2], L.lothr[3], L.lothr[4]], [-110, 0, -30, -110, 0, -85], "thresholds -110..0, defaults -30 / -85");
    assert.deepStrictEqual([L.hiknee[2], L.hiknee[3], L.hiknee[4], L.loknee[2], L.loknee[3], L.loknee[4]], [1, 24, 6, 1, 24, 6], "knees 1..24, default 6");
    assert.deepStrictEqual([L.rise[2], L.rise[3], L.rise[4], L.fall[2], L.fall[3], L.fall[4]], [0.13, 125, 2, 0.13, 125, 8], "Rise / Fall 0.13..125, defaults 2 / 8");
    assert.deepStrictEqual([L.tilt[2], L.tilt[3]], [-6, 6]);
    assert.deepStrictEqual([L.mix[2], L.mix[3], L.mix[4]], [0, 100, 100]);
    assert.ok(L.rise[5] === 0 && L.fall[5] === 0, "Rise / Fall are float parameters");
    // fractional blocks: the coefficient is monotone, 0.13 is (nearly) instant, 2 and 8 give 0.393 / 0.118
    let pc = 0;
    for (const b of [0.13, 0.25, 0.5, 1, 2, 4, 8, 32, 125]) {
        const c = cfg.lsBlockCoef(b);
        assert.ok(c < (pc || 1.0001) && c > 0, `coefficient falls with the time (${b})`);
        pc = c;
    }
    assert.ok(cfg.lsBlockCoef(0.13) > 0.999 && Math.abs(cfg.lsBlockCoef(2) - (1 - Math.exp(-0.5))) < 1e-12 && Math.abs(cfg.lsBlockCoef(8) - (1 - Math.exp(-0.125))) < 1e-12);
    assert.strictEqual(cfg.lsBlockCoef(0), cfg.lsBlockCoef(0.13), "times clamp to 0.13");
    // fractional Rise: 0.5 blocks reaches Loud within 2 frames and 1.5 takes longer than 0.5
    {
        const n = 1024, half = 512;
        const run = (p) => {
            const st = cfg.lsNewState(n);
            const mag = new Float64Array(half + 1), q = new Float64Array(half + 1), m = new Float64Array(half + 1), l = new Float64Array(half + 1);
            const f = (db) => { mag.fill(Math.pow(10, db / 20)); cfg.lsMasks(st, mag, Object.assign({}, P0, p), SR, q, m, l); return l[100]; };
            for (let i = 0; i < 4; i++) f(-90);
            let k = 0;
            while (k < 400 && f(-10) < 0.999) k++;
            return k;
        };
        const a = run({ rise: 0.5 }), b = run({ rise: 1.5 }), c = run({ rise: 2 }), d = run({ rise: 125 });
        assert.ok(a <= 12 && b > a && c >= b && d > 100, `fractional Rise blocks to Loud: 0.5 -> ${a}, 1.5 -> ${b}, 2 -> ${c}, 125 -> ${d}`);
    }
    // Mix: K chains sum to mix * wet + (1 - mix) * dry
    for (const mix of [0, 0.5, 1]) {
        const wet = [0.3, -0.2, 0.5], dry = 0.8;
        let sum = 0;
        for (const w of wet) sum += cfg.lsMixOut(w, dry, mix, 3);
        const ref = mix * (wet[0] + wet[1] + wet[2]) + (1 - mix) * dry;
        assert.ok(Math.abs(sum - ref) < 1e-12, `Mix ${mix}: rack sum = mix * wet + (1 - mix) * dry`);
    }
    // built device: Mix wiring, Bitwig on-face / off-face split
    const dev = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "devices", "Loud Split.amxd")).slice(32).toString("utf8"));
    const bx = {};
    for (const b of dev.patcher.boxes) bx[b.box.id] = b.box;
    assert.ok(bx["obj-ctrl-mix"].presentation === 1, "Mix is on the face");
    for (const k of ["rise", "fall", "tilt", "relative"]) assert.ok(bx[`obj-ctrl-${k}`] && bx[`obj-ctrl-${k}`].presentation !== 1 && bx[`obj-ctrl-${k}`].parameter_enable === 1, `${k} is a real parameter drawn in the display`);
    assert.ok(dev.patcher.lines.some((l) => l.patchline.source[0] === "obj-prep-mix" && l.patchline.destination[0] === "obj-genin"), "Mix -> hub -> gen");
    assert.ok(bx["obj-scale-mix"] && /0\.01/.test(bx["obj-scale-mix"].text) && bx["obj-prep-mix"].text === "prepend mixamt", "Mix % -> mixamt 0..1");
    console.log("[bitwig] ranges, defaults, fractional Rise / Fall and Mix tests passed");
}

console.log("All Loud Split tests passed");
require("./test_spectral_rack.js");
require("./test_spectral_dsp.js");
require("./test_loudsplit_paint_bounds.js");
