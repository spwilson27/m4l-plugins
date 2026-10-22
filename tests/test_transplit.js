#!/usr/bin/env node
"use strict";
/**
 * Verification suite for devices/Transient Split.amxd + .adg (Spectral Split suite, slug `transplit`).
 *
 *  1. Mask reference (src/transplit_config.js): sum identity at Tilt 0 / Blend 0, Tilt and Blend as gains, Bias direction,
 *     Perc / Noise behaviour on bursts, steady noise and steady sines, a full packed-stereo STFT split that nulls against the input.
 *  2. The GenExpr functions (src/spectral_split_lib.genexpr + ts_* in src/transplit_core.genexpr), transpiled to JS with
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
const cfg = require(path.join(ROOT, "src", "transplit_config.js"));
const ref = require(path.join(ROOT, "src", "cepstrum_ref.js"));
const { DataSim, load, functionsOf } = require("./genexpr_functions.js");
const { runLinkTests } = require("./spectral_link_tests.js");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const LIB_SRC = read("src/cepstrum_lib.genexpr");
const SS_SRC = read("src/spectral_split_lib.genexpr");
const CORE_SRC = read("src/transplit_core.genexpr");
const RACK_SRC = read("src/spectral_split_rack.genexpr");
const RACK_MAIN = read("src/spectral_split_rack_main.genexpr");
// The gen code the device really embeds (the face writes it to a .gendsp file): lib + ss lib + rack functions + the expanded core.
function builtGenCode() {
    const raw = fs.readFileSync(path.join(ROOT, "devices", "Transient Split.amxd"));
    const p = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    const face = p.boxes.map((b) => b.box).find((b) => b.id === "obj-viz").textfile.text;
    const m = /^var GEN_DSP_TEXT = (".*");$/m.exec(face);
    assert.ok(m, "face carries GEN_DSP_TEXT");
    const gendsp = JSON.parse(JSON.parse(m[1]));
    return gendsp.patcher.boxes.find((b) => b.box.maxclass === "codebox").box.code;
}
const GEN_CODE = builtGenCode();

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

// ---- a Node mirror of the packed-stereo mask STFT (reference path, uses tsMasks) ----
function splitRef(L, R, n, sr, p) {
    const hop = n / 4;
    const win = ref.hann(n);
    const half = n / 2;
    const st = cfg.tsNewState(n);
    const tilts = cfg.tsTiltTables(n, sr);
    const out = [0, 1].map(() => ({ L: new Float64Array(L.length + 2 * n), R: new Float64Array(L.length + 2 * n) }));
    const mag = new Float64Array(half + 1);
    const ph = new Float64Array(half + 1);
    const mt = new Float64Array(half + 1);
    const mq = new Float64Array(half + 1);
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
            ph[k] = Math.atan2(xi, xr);
        }
        cfg.tsMasks(st, mag, ph, p, sr, tilts, mt, mq);
        trace.push({ mt: Float64Array.from(mt), mq: Float64Array.from(mq), mag: Float64Array.from(mag) });
        [mt, mq].forEach((m, ch) => {
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
    return { tr: out[0], tone: out[1], trace };
}

const P0 = { ttype: 0, bias: 0, tdecay: 8, tsmooth: 1.5, tilt: 0, tmode: 0, blend: 0.5 };

// ======================================================================
// 1. Reference behaviour
// ======================================================================
const SR = 48000;
{
    // drum-like stimulus: decaying noise bursts every 400 ms over a steady sine
    const N = SR * 3;
    const r = rng(5);
    const drums = new Float64Array(N);
    const sine = new Float64Array(N);
    const ons = [];
    for (let t = 0.3; t < 2.8; t += 0.4) ons.push(Math.round(t * SR));
    for (let i = 0; i < N; i++) {
        sine[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / SR);
        drums[i] = sine[i];
    }
    for (const o of ons) for (let i = 0; i < SR * 0.4 && o + i < N; i++) drums[o + i] += 0.5 * r() * Math.exp(-i / (SR * 0.06));

    for (const n of [512, 1024, 2048, 4096]) {
        for (const ttype of [0, 1]) {
            const p = Object.assign({}, P0, { ttype });
            const o = splitRef(drums, drums, n, SR, p);
            // sum identity: the two channels add up to the input (no latency in this offline mirror)
            let err = 0, tot = 0;
            for (let i = n; i < N - n; i++) {
                const d = o.tr.L[i] + o.tone.L[i] - drums[i];
                err += d * d;
                tot += drums[i] * drums[i];
            }
            assert.ok(10 * Math.log10(err / tot + 1e-300) < -250, `sum of channels must null at Size ${n}, type ${ttype} (got ${10 * Math.log10(err / tot + 1e-300)} dB)`);
            for (const tr of o.trace) for (let k = 0; k < tr.mt.length; k++) assert.ok(Math.abs(tr.mt[k] + tr.mq[k] - 1) < 1e-12, "per-bin masks sum to 1");
            // onset energy lands in Transients at the default-ish sizes
            let etr = 0, eto = 0;
            for (const on of ons) {
                etr += energy(o.tr.L, on, on + 1920);
                eto += energy(o.tone.L, on, on + 1920);
            }
            const frac = etr / (etr + eto);
            if (n <= 1024) assert.ok(frac > 0.4, `onsets mostly to Transients at Size ${n} type ${ttype} (got ${frac.toFixed(3)})`);
            // steady sine in a quiet gap stays in Tones
            const g0 = Math.round(0.12 * SR), g1 = Math.round(0.25 * SR);
            const sTr = energy(o.tr.L, g0, g1), sTo = energy(o.tone.L, g0, g1);
            assert.ok(sTo / (sTr + sTo) > (n >= 4096 ? 0.8 : 0.95), `steady sine stays in Tones (size ${n}, type ${ttype}: ${(sTo / (sTr + sTo)).toFixed(3)})`);
            if (n === 1024) console.log(`[ref] size 1024 type ${ttype}: onset transient fraction ${frac.toFixed(3)}, quiet-gap sine tone fraction ${(sTo / (sTr + sTo)).toFixed(3)}`);
        }
    }

    // Bias moves energy monotonically (Perc and Noise) on bursts + sine, 1k
    for (const ttype of [0, 1]) {
        let prev = -1;
        for (const bias of [-1, -0.5, 0, 0.5, 1]) {
            const o = splitRef(drums, drums, 1024, SR, Object.assign({}, P0, { ttype, bias }));
            const a = energy(o.tr.L, SR / 4, SR * 2.5), b = energy(o.tone.L, SR / 4, SR * 2.5);
            const f = a / (a + b);
            assert.ok(f >= prev - 1e-9, `Bias must not reduce Transients (type ${ttype}, bias ${bias}: ${f.toFixed(3)} < ${prev.toFixed(3)})`);
            prev = f;
        }
        assert.ok(prev > 0.6, `Bias +100 sends most of the signal to Transients (type ${ttype}: ${prev.toFixed(3)})`);
    }

    // steady noise: Perc keeps it out of Transients, Noise mode sends it there; steady sines: Tones in both
    const nz = new Float64Array(SR * 2), ss = new Float64Array(SR * 2), rr = rng(9);
    for (let i = 0; i < nz.length; i++) {
        nz[i] = 0.3 * rr();
        ss[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR) + 0.2 * Math.sin((2 * Math.PI * 1330 * i) / SR);
    }
    const fr = (x, ttype) => {
        const o = splitRef(x, x, 1024, SR, Object.assign({}, P0, { ttype }));
        const a = energy(o.tr.L, SR / 2, SR * 1.5), b = energy(o.tone.L, SR / 2, SR * 1.5);
        return a / (a + b);
    };
    assert.ok(fr(nz, 0) < 0.05, "Perc: steady noise is not a transient");
    assert.ok(fr(nz, 1) > 0.8, "Noise: steady noise goes to Transients");
    assert.ok(fr(ss, 0) < 0.02 && fr(ss, 1) < 0.02, "steady sines are Tones in both types");

    // Tilt and Blend are gains: the sum identity no longer holds, and they act as described
    const probe = splitRef(drums, drums, 1024, SR, Object.assign({}, P0, { tilt: 1 }));
    let anyOff = false;
    for (const tr of probe.trace) for (let k = 0; k < tr.mt.length; k++) if (Math.abs(tr.mt[k] + tr.mq[k] - 1) > 1e-6) anyOff = true;
    assert.ok(anyOff, "Tilt changes the sum (explicit gain)");
    const tt = cfg.tsTiltTables(1024, SR);
    assert.ok(tt[0][2] < -0.9 && tt[0][512] > 0.99, "Standard tilt weight: lows -1, highs +1");
    assert.ok(tt[1][Math.round(1000 * 1024 / SR)] < -0.9 && tt[1][400] > 0.9 && tt[1][2] > 0.9, "Contour weight: -1 at 1 kHz, +1 at the lows and highs (raises both together)");
    const mkState = () => ({ st: cfg.tsNewState(1024), mag: new Float64Array(513).fill(0.1), ph: new Float64Array(513), mt: new Float64Array(513), mq: new Float64Array(513) });
    const probeMask = (p, frames) => {
        const s = mkState();
        for (let f = 0; f < (frames || 4); f++) cfg.tsMasks(s.st, s.mag, s.ph, Object.assign({}, P0, p), SR, tt, s.mt, s.mq);
        return s;
    };
    const base = probeMask({});
    const hi = Math.round(8000 * 1024 / SR), lo = Math.round(200 * 1024 / SR);
    const tl = probeMask({ tilt: 1 });
    assert.ok(tl.mt[hi] > base.mt[hi] || base.mt[hi] === 0, "Tilt +: Transients louder in the highs (or unchanged at 0)");
    assert.ok(tl.mq[hi] < base.mq[hi] - 0.1, "Tilt +: Tones quieter in the highs");
    assert.ok(tl.mq[lo] > base.mq[lo] + 0.1, "Tilt +: Tones louder in the lows (reversed)");
    const bl = probeMask({ blend: 1 });
    assert.ok(bl.mq[100] === 0 && Math.abs(bl.mt[100] - base.mt[100]) < 1e-12, "Blend 100 %: only the transient portions (Tones silent, Transients unchanged)");
    const bm = probeMask({ blend: 0 });
    assert.ok(bm.mt[100] === 0 && Math.abs(bm.mq[100] - base.mq[100]) < 1e-12, "Blend 0 %: only the tone portions");
    const b75 = probeMask({ blend: 0.75 });
    assert.ok(Math.abs(b75.mt[100] - base.mt[100]) < 1e-12 && Math.abs(b75.mq[100] - 0.5 * base.mq[100]) < 1e-12, "Blend 75 %: Transients full, Tones half");
    assert.deepStrictEqual(cfg.tsBlendGains(0.5), [1, 1], "Blend 50 % is the identity");
    assert.strictEqual(cfg.tsFormatBlocks(8), "8.00");
    assert.strictEqual(cfg.tsFormatBlocks(1.5), "1.50");
    assert.strictEqual(cfg.tsFormatPct(0), "0.00 %");
    assert.strictEqual(cfg.TS_PARAMS.tdecay[2], 1); assert.strictEqual(cfg.TS_PARAMS.tdecay[3], 125); assert.strictEqual(cfg.TS_PARAMS.tdecay[4], 8);
    assert.strictEqual(cfg.TS_PARAMS.tsmooth[2], 1); assert.strictEqual(cfg.TS_PARAMS.tsmooth[3], 64); assert.strictEqual(cfg.TS_PARAMS.tsmooth[4], 1.5);
    assert.strictEqual(cfg.TS_PARAMS.blend[4], 50); assert.strictEqual(cfg.TS_PARAMS.mix[4], 100);

    // decay / smoothing arguments are in blocks: a larger Decay holds the transient mask longer
    const decayFrames = (d) => {
        const s = mkState();
        const run = (amp) => {
            for (let k = 0; k < 513; k++) s.mag[k] = amp;
            cfg.tsMasks(s.st, s.mag, s.ph, Object.assign({}, P0, { tdecay: d }), SR, tt, s.mt, s.mq);
        };
        for (let f = 0; f < 5; f++) run(0.001);
        run(0.5);                             // onset
        let held = 0;
        for (let f = 0; f < 40; f++) {
            run(0.5);
            if (s.mt[100] > 0.5) held++;
        }
        return held;
    };
    assert.ok(decayFrames(12) > decayFrames(2), "Transients Decay extends the transient mask");
    assert.ok(decayFrames(8.5) >= decayFrames(8), "fractional Decay values act as fractional block counts");
    // silence (zero amplitude) is a Tone with mask 1 (so a silent bin never invents a transient)
    const sil = probeMask({}, 6);
    assert.strictEqual(sil.mq[100], 1);

    // the full pipeline is silent for silence
    const z = splitRef(new Float64Array(8192), new Float64Array(8192), 1024, SR, P0);
    assert.strictEqual(energy(z.tr.L, 0, 8192) + energy(z.tone.L, 0, 8192), 0, "silence in -> exact zeros out");

    // stereo image: left-only input keeps right silent
    const lonly = splitRef(sine, new Float64Array(sine.length), 1024, SR, P0);
    assert.ok(energy(lonly.tr.R, 2048, 40000) + energy(lonly.tone.R, 2048, 40000) < 1e-20, "a left-only signal stays left-only (stereo image kept)");
    console.log("[ref] mask reference tests passed");
}

// ======================================================================
// 2. GenExpr functions transpiled to JS: lib + ts_* match the reference
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
        const gx = loadGx();      // fresh History state (fft_init / stft_win remember their tables) for every run
        // the same per-sample chain as the core, with bounds-checked Data
        const half = n / 2;
        const tab = new DataSim(4096, 3), win = new DataSim(4096), fx = new DataSim(4096, 2);
        const ringL = new DataSim(4096), ringR = new DataSim(4096), accL = new DataSim(4096), accR = new DataSim(4096);
        const stt = new DataSim(8), ms = new DataSim(2049, 2), tsd = new DataSim(2049, 11), tw = new DataSim(2049, 2);
        const cols = new DataSim(512), scope = new DataSim(800);
        const outL = new Float64Array(x.length), outR = new Float64Array(x.length);
        let age = 0;
        const masks = [];
        for (let i = 0; i < x.length; i++) {
            gx.fft_init(tab);
            gx.stft_win(win, n);
            if (i === 0) gx.ts_tilttab(tw, n, SR);
            const rdy = gx.ss_in(ringL, ringR, stt, x[i], y[i], n);
            if (rdy > 0.5) {
                gx.ss_frame(fx, ringL, ringR, stt, win, n);
                gx.fft_run(fx, tab, n, 0);
                gx.ss_mid(fx, ms, n);
                gx.ts_masks(ms, tsd, tw, n, SR, p.ttype, p.bias, p.tdecay, p.tsmooth, p.tilt, p.tmode, p.blend, age);
                age = Math.min(age + 1, 3);
                if (masks.length < frames) {
                    masks.push({ mag: Array.from({ length: half + 1 }, (_, k) => ms.peek(k, 0)), ph: Array.from({ length: half + 1 }, (_, k) => ms.peek(k, 1)),
                        mt: Array.from({ length: half + 1 }, (_, k) => tsd.peek(k, 8)), mq: Array.from({ length: half + 1 }, (_, k) => tsd.peek(k, 9)) });
                }
                gx.ss_apply(fx, tsd, sel === 2 ? 9 : (sel === 1 ? 8 : 10), n);
                if (i % 4096 < 256) {
                    gx.ss_cols(ms, 0, tsd, -1, cols, 0, n, SR, 128, 30, 20000);
                    gx.ss_cols(ms, 0, tsd, 8, cols, 1, n, SR, 128, 30, 20000);
                    gx.ss_cols(ms, 0, tsd, 9, cols, 2, n, SR, 128, 30, 20000);
                    gx.ss_tele(cols, scope, 128, 3, 0);
                    gx.ts_frac(cols, scope, 128, 384);
                    gx.ts_mean(ms, tsd, n);
                    gx.ts_wave(ms, tsd, scope, n, 3);
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
        x[i] = 0.2 * Math.sin(i * 0.05) + 0.4 * burst * r();
        y[i] = 0.15 * Math.sin(i * 0.031) + 0.3 * burst * r();
    }
    for (const sel of [0, 1, 2]) {
        const g = run(n, sel, P0, x, y, 6);
        // latency n - 1 and identity: sum selection (0) equals the input delayed by n - 1
        if (sel === 0) {
            let e = 0, t = 0;
            for (let i = n; i < N; i++) {
                const dl = g.outL[i] - x[i - (n - 1)], dr = g.outR[i] - y[i - (n - 1)];
                e += dl * dl + dr * dr;
                t += x[i - (n - 1)] ** 2 + y[i - (n - 1)] ** 2;
            }
            assert.ok(10 * Math.log10(e / t) < -250, `ss_* chain is an exact delayed identity (got ${10 * Math.log10(e / t)} dB)`);
        }
    }
    {
        const g = run(n, 1, P0, x, y, 6);
        const o = cfg.TS_SC_WAVE + 3 * cfg.TS_WAVE_STRIDE;
        const [pt, pq, ot, oq] = [0, 1, 2, 3].map((i) => g.scope.peek(o + i, 0));
        assert.ok(pt >= 0 && pq > 0 && ot >= 0 && oq > 0, "waveform ring entry written");
        assert.ok(Math.abs(pt - ot) < 1e-9 && Math.abs(pq - oq) < 1e-9, "pre and post waveform values agree at neutral Tilt / Blend");
    }
    // Transients + Tones outputs add up to the input delayed by n - 1, for all types and a few settings
    for (const p of [P0, Object.assign({}, P0, { ttype: 1, bias: 0.4, tdecay: 7, tsmooth: 5 }), Object.assign({}, P0, { bias: -0.6, tdecay: 1, tsmooth: 1 })]) {
        const a = run(n, 1, p, x, y, 6), b = run(n, 2, p, x, y, 6);
        let e = 0, t = 0;
        for (let i = n; i < N; i++) {
            const dl = a.outL[i] + b.outL[i] - x[i - (n - 1)], dr = a.outR[i] + b.outR[i] - y[i - (n - 1)];
            e += dl * dl + dr * dr;
            t += x[i - (n - 1)] ** 2 + y[i - (n - 1)] ** 2;
        }
        assert.ok(10 * Math.log10(e / t) < -250, `Transients + Tones null against the delayed input (got ${10 * Math.log10(e / t)} dB)`);
        assert.ok(energy(a.outL, 0, N) > 0 && energy(b.outL, 0, N) > 0, "both channels carry signal");
    }
    // GenExpr masks match the reference frame for frame (several parameter sets, incl. Tilt / Blend)
    for (const p of [P0, Object.assign({}, P0, { ttype: 1, bias: 0.3 }), Object.assign({}, P0, { tilt: 0.6, tmode: 1, blend: 0.35, tdecay: 9.5, tsmooth: 3.25 }),
        Object.assign({}, P0, { ttype: 1, tilt: -0.8, blend: 0.8, bias: -0.4 })]) {
        const g = run(n, 1, p, x, y, 60);
        const st = cfg.tsNewState(n);
        const tilts = cfg.tsTiltTables(n, SR);
        const mt = new Float64Array(n / 2 + 1), mq = new Float64Array(n / 2 + 1);
        let maxd = 0;
        for (const f of g.masks) {
            cfg.tsMasks(st, f.mag, f.ph, p, SR, tilts, mt, mq);
            for (let k = 0; k <= n / 2; k++) {
                maxd = Math.max(maxd, Math.abs(mt[k] - f.mt[k]), Math.abs(mq[k] - f.mq[k]));
            }
        }
        assert.ok(maxd < 1e-9, `GenExpr masks equal the JS reference (max diff ${maxd})`);
    }
    // the GenExpr Mid analysis equals a direct transform of the Hann windowed (L + R) / 2 (frame 4 covers samples 0..n-1)
    {
        const g = run(n, 1, P0, x, y, 4);
        const w = ref.hann(n);
        const re = new Float64Array(n), im = new Float64Array(n);
        for (let i = 0; i < n; i++) re[i] = w[i] * 0.5 * (x[i] + y[i]);
        ref.fft(re, im, false);
        let maxd = 0;
        for (let k = 0; k <= n / 2; k++) {
            maxd = Math.max(maxd, Math.abs(g.masks[3].mag[k] - Math.hypot(re[k], im[k]) * 4 / n));
            if (Math.hypot(re[k], im[k]) > 1e-6) {
                let dp = Math.abs(g.masks[3].ph[k] - Math.atan2(im[k], re[k]));
                dp = Math.min(dp, 2 * Math.PI - dp);
                assert.ok(dp < 1e-6 || Math.hypot(re[k], im[k]) * 4 / n < 1e-9, `Mid phase at bin ${k}`);
            }
        }
        assert.ok(maxd < 1e-9, `ss_mid amplitude equals the direct Mid transform (max diff ${maxd})`);
    }
    // telemetry columns land in 0..1 and the transient fraction in 0..1
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
    console.log("[genexpr] transpiled lib + ts_* tests passed");
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
        for (const l of fn.body) assert.ok(!/\bif\s*\(\s*[^)]*\b(ss2?|ts|stft|fft|cep)_\w+\(/.test(l), `${fn.name}: no function call inside an if condition`);
    }
    for (const src of [SS_SRC, RACK_SRC, GEN_CODE]) {
        const code = src.replace(/\/\/.*$/gm, "");
        assert.ok(!/\bpoke\([^;]*\b(ss2?|ts|stft|fft|cep)_\w+\(/.test(code), "no user function call inside poke() arguments (silent compile failure in Max)");
        assert.ok(!/\be\d\b/.test(code), "no identifier e<digit>");
        assert.ok(!/\b(phi|pi)\s*=/.test(code), "no phi / pi assignments");
    }
    // statements of the expanded core: no function call in an if condition either
    for (const l of GEN_CODE.split("\n")) {
        if (/^\s*(\}\s*else\s*)?if\s*\(/.test(l)) assert.ok(!/\b(ss2?|ts|stft|fft|cep)_\w+\(/.test(l.replace(/\/\/.*$/, "")), `no function call inside an if condition: ${l.trim()}`);
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
    // Param names used by the build exist
    for (const name of ["fftn", "ttype", "anbias", "tdecay", "tsmooth", "tiltamt", "tmode", "blendamt", "mixamt", "outsel", "role", "serve", "epoch"]) assert.ok(new RegExp(`^Param ${name}\\(`, "m").test(GEN_CODE), `Param ${name}`);
    assert.ok(/Buffer scope\("transplitscope"\)/.test(CORE_SRC), "Buffer bound by the GenExpr variable name `scope` (no set prefix)");
    // the scope layout matches the config constants
    const m = GEN_CODE.match(/poke\(scope, frameNo, (\d+), 0\)/);
    assert.strictEqual(Number(m[1]), cfg.TS_SC_FRAME, "telemetry frame counter slot");
    assert.ok(GEN_CODE.includes(`poke(scope, trm, ${cfg.TS_SC_TRMEAN}, 0)`) && GEN_CODE.includes("trm = ts_mean(ms, tsd, n);"), "mean slot");
    // the rack template writes the common scalars at SCB + offset (SCB = TS_SC_FRAME): every offset is the config's
    const scal = { 1: "TS_SC_SR", 2: "TS_SC_N", 3: "TS_SC_AWAKE", 4: "TS_SC_LEVEL", 6: "TS_SC_LATENCY", 7: "TS_SC_SEL", 8: "TS_SC_CMP", 9: "TS_SC_FOL", 10: "TS_SC_ALIGNED",
        11: "TS_SC_FB", 12: "TS_SC_DOFF", 13: "TS_SC_UNDER", 14: "TS_SC_LAG", 15: "TS_SC_SERVE", 16: "TS_SC_ROLE", 17: "TS_SC_ALIVE" };
    for (const [off, key] of Object.entries(scal)) {
        assert.strictEqual(cfg.TS_SC_FRAME + Number(off), cfg[key], `${key} = TS_SC_FRAME + ${off}`);
        assert.ok(GEN_CODE.includes(`, ${cfg.TS_SC_FRAME} + ${off}, 0);`), `gen writes scope slot ${key}`);
    }
    assert.ok(cfg.TS_SC_FRAME + 18 <= cfg.TS_SC_WAVE, "the scalars stay below the waveform ring");
    assert.ok(GEN_CODE.includes(`ts_frac(cols, scope, 128, ${cfg.TS_SC_FRAC})`), "fraction block offset");
    assert.ok(cfg.TS_SCOPE_SAMPS <= 800, "scope buffer big enough");
    assert.ok(GEN_CODE.includes(`o = ${cfg.TS_SC_WAVE} + slot * 4;`) && GEN_CODE.includes("ts_wave(ms, tsd, scope, n, frameNo % 64);"), "waveform ring offset / slot");
    assert.strictEqual(cfg.TS_WAVE_FRAMES, 64);
    assert.ok(GEN_CODE.includes(`wrap(frameNo + 1, 0, ${cfg.TS_FRAME_WRAP})`) && cfg.TS_FRAME_WRAP % cfg.TS_WAVE_FRAMES === 0, "frame counter wraps on a ring multiple");
    assert.ok(GEN_CODE.includes("ss2_zeroscope(scope, 512)"), "sleep zeroes the 512 telemetry columns");
    assert.ok(/^Param blendamt\(0\.5\)/m.test(GEN_CODE) && /^Param mixamt\(1\)/m.test(GEN_CODE) && /^Param tdecay\(8\)/m.test(GEN_CODE) && /^Param tsmooth\(1\.5\)/m.test(GEN_CODE), "gen Param defaults match the parameter table");
    assert.ok(!/@@/.test(GEN_CODE) && !/\/\/@(hook|endhook|SS_)/.test(GEN_CODE), "the template is fully expanded");
    assert.ok(GEN_CODE.includes(`Delay dryL(${cfg.TS_LATENCY + 1})`) && GEN_CODE.includes(`dryL.read(${cfg.TS_LATENCY})`), "dry delay = the reported latency");

    runLinkTests();
    // tsResolveSel / names
    assert.strictEqual(cfg.tsResolveSel(0, 0), 1);
    assert.strictEqual(cfg.tsResolveSel(0, 1), 2);
    assert.strictEqual(cfg.tsResolveSel(0, 5), 2);
    assert.strictEqual(cfg.tsResolveSel(0, -1), 0, "Auto outside a rack = all");
    assert.strictEqual(cfg.tsResolveSel(1, 1), 1);
    assert.strictEqual(cfg.tsResolveSel(2, 0), 2);
    assert.strictEqual(cfg.tsResolveSel(3, 0), 0);
    assert.strictEqual(cfg.tsSelName(1), "Transients");
    console.log("[lint] genexpr lint and link module tests passed");
}

// ======================================================================
// 4. The built device and rack preset
// ======================================================================
{
    const amxd = path.join(ROOT, "devices", "Transient Split.amxd");
    const raw = fs.readFileSync(amxd);
    assert.strictEqual(raw.slice(0, 4).toString(), "ampf");
    assert.strictEqual(raw.slice(8, 12).toString(), "aaaa", "audio effect");
    assert.strictEqual(raw.readUInt32LE(28), raw.length - 32);
    const p = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    assert.strictEqual(p.latency, cfg.TS_LATENCY, "latency attribute = TS_LATENCY (5120)");
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
    // deferred DSP (AGENTS.md 1d): no gen~ in the saved device, a gate 1 1 hub, scripting names, no static audio cords
    assert.ok(!byId["obj-gen"], "the device ships without its gen~");
    assert.strictEqual(byId["obj-genin"].text, "gate 1 1");
    assert.deepStrictEqual([byId["obj-genin"].varname, byId["obj-plugin"].varname, byId["obj-plugout"].varname], ["ss_genin", "ss_plugin", "ss_plugout"]);
    const allLines = p.lines.map((l) => l.patchline);
    assert.ok(!allLines.some((l) => l.source[0] === "obj-plugin" || l.destination[0] === "obj-plugout"), "no static audio cord (the face wires plugin~ -> gen~ -> plugout~)");
    assert.ok(allLines.every((l) => l.destination[0] !== "obj-gen"), "no cord into a gen~ that is not there");
    assert.ok(allLines.some((l) => l.source[0] === "obj-viz" && l.source[1] === 2 && l.destination[0] === "obj-genin" && l.destination[1] === 1), "face outlet 2 -> hub data inlet");
    // the embedded gen = lib + ss lib + rack functions + the expanded core
    assert.ok(GEN_CODE.indexOf("fft_run(") < GEN_CODE.indexOf("ss_in(") && GEN_CODE.indexOf("ss_in(") < GEN_CODE.indexOf("ss2_align(") && GEN_CODE.indexOf("ss2_align(") < GEN_CODE.indexOf("ts_masks("), "library functions come first");
    assert.ok(GEN_CODE.startsWith(LIB_SRC.replace(/\s+$/, "") + "\n"), "gen code starts with cepstrum_lib");
    assert.ok(GEN_CODE.includes(SS_SRC.replace(/\s+$/, "") + "\n") && GEN_CODE.includes(RACK_SRC.replace(/\s+$/, "") + "\n"), "gen code contains spectral_split_lib and spectral_split_rack verbatim");
    const faceTxt = byId["obj-viz"].textfile.text;
    assert.ok(/var GEN_DSP_HASH = "[0-9a-f]{12}";/.test(faceTxt) && /var SS_PREFIX = "transplit";/.test(faceTxt), "face carries the gen patch hash and prefix");
    assert.ok(faceTxt.includes("function ssDspLoad") && faceTxt.includes("function ssDspRestart"), "face carries the deferred-DSP module");
    // buffers: `---` per instance
    assert.ok(byId["obj-scope-buf"].text.startsWith("buffer~ ---transplitscope"), "per-instance buffer name");
    assert.ok(Number(byId["obj-scope-buf"].text.match(/@samps (\d+)/)[1]) >= cfg.TS_SCOPE_SAMPS, "scope buffer length");
    assert.ok(byId["obj-ring-buf"].text.startsWith("buffer~ ---ssring @samps "), "per-instance ring buffer");
    assert.ok(Number(byId["obj-ring-buf"].text.match(/@samps (\d+)/)[1]) === 16 + 8192 * 7, "ring length = header + slots * stride");
    assert.strictEqual(byId["obj-msg-ui-names"].text, "setnames ---transplitscope ---ssring", "the face learns both per-instance buffer names");
    assert.ok(!boxes.some((b) => /#0/.test(b.text || "") && b.text !== "r #0-sstest"), "no #0 names in a top-level device (the test hook receive #0-sstest is the one deliberate shared name)");
    // panels last with background 1
    const firstPanel = boxes.findIndex((b) => b.maxclass === "panel");
    assert.ok(firstPanel > 0 && boxes.slice(firstPanel).every((b) => b.maxclass === "panel"), "panels are the last boxes");
    for (const b of boxes.slice(firstPanel)) {
        assert.strictEqual(b.maxclass, "panel");
        assert.strictEqual(b.background, 1, `${b.id} background 1`);
    }
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
    for (const [key, spec] of Object.entries(cfg.TS_PARAMS)) {
        const v = byId[`obj-ctrl-${key}`].saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_longname, spec[0], `${key} long name`);
        assert.strictEqual(v.parameter_shortname, spec[1]);
        assert.deepStrictEqual([v.parameter_mmin, v.parameter_mmax, v.parameter_initial[0], v.parameter_type], [spec[2], spec[3], spec[4], spec[5]], `${key} range / initial / type`);
        if (v.parameter_type === 1) assert.ok(v.parameter_mmax <= 255, "native Int parameters stay <= 255");
        assert.ok(!names.has(v.parameter_shortname), "unique short name");
        names.add(v.parameter_shortname);
    }
    for (const [key, spec] of Object.entries(cfg.TS_ENUMS)) {
        const v = byId[`obj-ctrl-${key}`].saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_longname, spec[0]);
        assert.deepStrictEqual(v.parameter_enum.length, spec[2].length, `${key} enum size`);
        assert.strictEqual(v.parameter_initial[0], spec[3], `${key} initial`);
        assert.ok(!names.has(v.parameter_shortname), "unique short name");
        names.add(v.parameter_shortname);
    }
    assert.strictEqual(byId["obj-ctrl-size"].saved_attribute_attributes.valueof.parameter_initial[0], 1, "Size defaults to 1k");
    for (const key of ["dispost", "disstyle"]) {
        const b = byId[`obj-ctrl-${key}`];
        assert.strictEqual(b.saved_attribute_attributes.valueof.parameter_invisible, 1, `${key} is UI state only`);
        assert.ok(b.presentation !== 1, `${key} is not in the presentation`);
    }
    // wiring: every control reaches the gen with the right message, linked keys have a route + `prepend set` back path
    const lines = p.lines.map((l) => l.patchline);
    const from = (id) => lines.filter((l) => l.source[0] === id).map((l) => l.destination[0]);
    const GEN = { bias: "anbias", tdecay: "tdecay", tsmooth: "tsmooth", tilt: "tiltamt", blend: "blendamt", mix: "mixamt", ttype: "ttype", tmode: "tmode", size: "fftn" };
    for (const [key, msg] of Object.entries(GEN)) {
        assert.strictEqual(byId[`obj-prep-${key}`].text, `prepend ${msg}`);
        assert.ok(from(`obj-prep-${key}`).includes("obj-genin"), `${key} -> hub -> gen`);
        assert.ok(from(`obj-ui-${key}`).includes("obj-viz") && byId[`obj-ui-${key}`].text === `prepend set_${key}`, `${key} -> face`);
    }
    assert.strictEqual(byId["obj-scale-bias"].text, "* 0.01");
    assert.strictEqual(byId["obj-scale-tilt"].text, "* 0.01");
    assert.strictEqual(byId["obj-scale-blend"].text, "* 0.01");
    assert.strictEqual(byId["obj-scale-mix"].text, "* 0.01");
    assert.deepStrictEqual(byId["obj-ctrl-disstyle"].saved_attribute_attributes.valueof.parameter_enum, ["Waveform", "Sonogram"], "Display Style Waveform / Sonogram");
    assert.deepStrictEqual(byId["obj-ctrl-ttype"].saved_attribute_attributes.valueof.parameter_enum, ["Percussive", "Noise"]);
    assert.deepStrictEqual(byId["obj-ctrl-tmode"].saved_attribute_attributes.valueof.parameter_enum, ["Standard", "Contour"]);
    assert.ok(byId["obj-expr-size"].text.startsWith("expr 512 * pow(2"), "Size -> 512 * 2^i");
    assert.ok(from("obj-ctrl-output").includes("obj-ui-output") && !from("obj-ctrl-output").includes("obj-prep-output"), "Output goes to the face only (it resolves Auto)");
    const linkRoute = byId["obj-route-link"].text.split(" ").slice(1);
    assert.deepStrictEqual(linkRoute, cfg.TS_LINKED_KEYS, "link route lists the linked keys, in order");
    assert.ok(!linkRoute.includes("output") && !linkRoute.includes("dispost"), "Output and the display toggles are not linked");
    linkRoute.forEach((key, i) => {
        const dests = lines.filter((l) => l.source[0] === "obj-route-link" && l.source[1] === i).map((l) => l.destination[0]);
        assert.ok(dests.includes(`obj-lset-${key}`), `${key}: peer value -> prepend set`);
        assert.strictEqual(byId[`obj-lset-${key}`].text, "prepend set");
        assert.ok(from(`obj-lset-${key}`).includes(`obj-ctrl-${key}`), `${key}: prepend set -> control`);
        assert.ok(dests.length === 2, `${key}: peer value also feeds the gen path`);
        assert.ok(!dests.includes("obj-gen"), `${key}: only through the hub`);
    });
    assert.ok(lines.some((l) => l.source[0] === "obj-r-sstest" && l.destination[0] === "obj-viz"), "test hook receive #0-sstest -> face");
    assert.ok(lines.some((l) => l.source[0] === "obj-thisdevice" && l.destination[0] === "obj-msg-init") && byId["obj-msg-init"].text === "init_link", "init from live.thisdevice, not loadbang");
    // the face script carries config + link + ui, and no forbidden globals
    const face = byId["obj-viz"].textfile.text;
    assert.ok(face.includes("function splCreateLink") && face.includes("function tsMasks") && face.includes("function paint"), "face = config + link + ui");
    assert.ok(/mgraphics\.relative_coords\s*=\s*0/.test(face) && /mgraphics\.autofill\s*=\s*0/.test(face), "v8ui pixel coordinates");
    assert.ok(!/\bvar\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(face), "no declared v8ui globals");
    // .adg
    const adg = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "devices", "Transient Split.adg"))).toString("utf8");
    const branches = adg.match(/<AudioEffectBranchPreset Id="\d+">/g);
    assert.strictEqual(branches.length, 2, "two chains");
    const names2 = [...adg.matchAll(/<AudioEffectBranchPreset Id="\d+">\s*<Name Value="([^"]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(names2, ["Transients", "Tones"], "chains are named after the channels, in order");
    assert.strictEqual((adg.match(/<MxDeviceAudioEffect /g) || []).length, 2, "one device per chain");
    assert.strictEqual((adg.match(/<UserName Value="Transient Split"/g) || []).length, 1, "rack name");
    assert.strictEqual((adg.match(/Transient Split\.amxd/g) || []).length >= 4, true, "each chain references the .amxd (relative and absolute)");
    console.log("[device] built device and rack preset checks passed");
}

console.log("All Transient Split tests passed");
require("./test_spectral_rack.js");
require("./test_spectral_dsp.js");
require("./test_transplit_paint_bounds.js");
