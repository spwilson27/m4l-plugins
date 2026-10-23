#!/usr/bin/env node
"use strict";
/**
 * Reverb+ offline tests (host, no Max). Run: node tests/test_reverbplus.js
 *
 *  1. Config math: RT60 -> loop gain, size scale, loop timing (MIN clamp, exact read delay), pre-delay, RT60 bands,
 *     pairing helpers, telemetry helpers (decay ring, RT60 estimate, 32-band spectrum).
 *  2. IR pipeline: Reverse / Start / Stretch / Decay / length cap / normalisation, partition spectra, and the real GenExpr
 *     convolution functions (src/reverbplus_conv.genexpr, transpiled by tests/genexpr_functions.js with bounds-checked Data)
 *     against direct convolution, sample by sample (two stages, 3 IR lengths, bank / count changes).
 *  3. GenExpr lint: functions first, one return per function, no e<digit>, no user call nested in poke(), no function-local
 *     variable named like a global Data / Buffer, Param names, buffer names, telemetry / header slots used by the cores
 *     are the ones in src/reverbplus_config.js.
 *  4. EVERY layout in scripts/reverbplus_layouts is built into a temp dir and checked against the contract
 *     (scripts/reverbplus_layouts/README.md): each parameter once, no overlap, 169 px, panels last, mgraphics init lines,
 *     no Max globals as script variables, wiring (engine, state bus, faces, gen hub), tsconfig, and every face v8ui runs
 *     (preview() + paint()) against a mock mgraphics. tests/test_reverbplus_face_*.js are run as sub-tests.
 *  5. The built base device and End device.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const C = require(path.join(ROOT, "src", "reverbplus_config.js"));
const { DataSim, load, functionsOf } = require("./genexpr_functions.js");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
let passes = 0;
function test(name, fn) {
    try {
        fn();
        passes++;
        console.log("PASS " + name);
    } catch (err) {
        failures++;
        console.log("FAIL " + name + ": " + (err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n") : err));
    }
}
function near(a, b, tol, msg) {
    assert(Math.abs(a - b) <= tol, `${msg || ""} expected ${b} got ${a}`);
}

// ---- 1. config ----------------------------------------------------------------------------------------
test("RT60 loop gain: -60 dB over the decay time, per pass of a loop", () => {
    near(C.rpLineGain(48000, 1, 48000), 0.001, 1e-9); // one second of loop in a one-second RT60
    near(C.rpLineGain(24000, 1, 48000), Math.sqrt(0.001), 1e-9);
    near(20 * Math.log10(C.rpLineGain(4800, 2.5, 48000) ** (2.5 / 0.1)), -60, 1e-9);
});

test("size scale 0.4..1.6, effective pre-delay (Convolution cannot go below its 256-sample latency)", () => {
    near(C.rpSizeScale(0), 0.4, 1e-12);
    near(C.rpSizeScale(1), 1.6, 1e-12);
    near(C.rpSizeScale(0.6), 1.12, 1e-12);
    assert.strictEqual(C.rpEffectivePredelayMs(C.RP_ALGO.HALL, 0, 48000), 0);
    near(C.rpEffectivePredelayMs(C.RP_ALGO.CONV, 1, 48000), 256 * 1000 / 48000, 1e-9);
    near(C.rpEffectivePredelayMs(C.RP_ALGO.CONV, 100, 48000), 100, 1e-12);
    near(C.rpEffectivePredelayMs(C.RP_ALGO.PLATE, 900, 48000), 500, 1e-12);
});

test("outer loop timing: MIN = B + L + 4, the period lands exactly on the derived time, clamped otherwise", () => {
    const e = C.rpEffectiveLoop(4800, 64, 256, 48000);
    assert.strictEqual(e.samples, 4800);
    assert.strictEqual(e.minSamples, 324);
    assert.strictEqual(e.clamped, false);
    const m = C.rpEffectiveLoop(100, 64, 256, 48000);
    assert.strictEqual(m.samples, 324);
    assert.strictEqual(m.clamped, true);
    near(m.minMs, 324 * 1000 / 48000, 1e-9);
    assert.strictEqual(C.rpEffectiveLoop(500000, 64, 256, 48000).samples, 96000); // 2 s cap
    // a wet sample emitted at s0 returns at s0 + B + L, waits rpLoopReadDelay more, and re-enters at s0 + T
    for (const [B, L, T] of [[64, 0, 400], [64, 256, 4800], [1024, 1000, 20000], [8192, 4000, 96000]]) {
        const s0 = 123456;
        const arrive = s0 + B + L;
        assert.strictEqual(arrive + C.rpLoopReadDelay(T, B, L), s0 + T, `B ${B} L ${L} T ${T}`);
        assert(C.rpLoopReadDelay(C.rpMinLoopSamples(B, L), B, L) >= 4);
    }
});

test("derived loop time: K x the tank's characteristic period, 25..150 ms at the default Size, Convolution from the IR length", () => {
    const A = C.RP_ALGO;
    for (const [algo, tc] of [[A.HALL, 2945], [A.ROOM, 577.75], [A.CHAMBER, 1035.25]]) {
        near(C.rpTankPeriod(algo, 0.5, 48000), tc * 1.0, 1);
        near(C.rpTankPeriod(algo, 0, 48000), tc * 0.4, 1);
        near(C.rpTankPeriod(algo, 1, 48000), tc * 1.6, 1);
    }
    // Plate: mean of the two branch loops, 0.75 x Size scale; Spring: mean spring + 48
    near(C.rpTankPeriod(A.PLATE, 0.5, 48000), (10645 + 10944) * 0.5 * (48000 / 29761) * 0.75, 1e-6);
    near(C.rpTankPeriod(A.SPRING, 0.5, 48000), 1820 + 48, 1e-6);
    for (let algo = 0; algo < 5; algo++) {
        for (const size of [0, 0.6, 1]) {
            const ms = C.rpLoopPeriod(algo, size, 48000, 0) * 1000 / 48000;
            assert(ms >= 4 && ms <= 250, `${algo} size ${size}: ${ms} ms`);
        }
        const d = C.rpLoopPeriod(algo, 0.6, 48000, 0) * 1000 / 48000;
        assert(d >= 45 && d <= 150, `default size loop time ${algo}: ${d} ms`);
    }
    // grows with Size and with the sample rate (samples)
    for (let algo = 0; algo < 5; algo++) assert(C.rpLoopPeriod(algo, 1, 48000, 0) > C.rpLoopPeriod(algo, 0, 48000, 0));
    assert.strictEqual(C.rpLoopPeriod(A.CONV, 0.6, 48000, 600 * 48), Math.round(0.15 * 600 * 48)); // 15 % of a 600 ms IR = 90 ms
    assert.strictEqual(C.rpLoopPeriod(A.CONV, 0.6, 48000, 100), Math.round(0.04 * 48000)); // short IR: 40 ms floor
    assert.strictEqual(C.rpLoopPeriod(A.CONV, 0.6, 48000, 6 * 48000), Math.round(0.15 * 48000)); // 150 ms cap
    // never below MIN once clamped by the link layer
    assert.strictEqual(C.rpEffectiveLoop(C.rpLoopPeriod(A.ROOM, 0, 48000, 0), 512, 4096, 48000).samples, 512 + 4096 + 4);
});

const { simTank, schroederRt, transferStats } = require("./reverbplus_loopsim.js");

test("reference model: tank at 0.3 x Decay + the recirculating chain loop (unity chain) decays in Decay, whatever the loop time", () => {
    const sr = 48000;
    let worst = [9, 0], eMin = 9, eMax = 0;
    for (const size of [0.2, 0.6, 1]) {
        for (const decay of [1, 2.5, 6]) {
            const rtT = C.rpTankRt60(C.RP_ALGO.HALL, decay, true);
            const dur = decay * 1.6 + 0.8;
            const tankOnly = simTank({ tankRt: rtT, dur, size });
            const e0 = tankOnly.wl.reduce((t, v) => t + v * v, 0);
            for (const tm of [1, 0.7, 1.9]) {
                const Tl = Math.max(324, Math.round(C.rpLoopPeriod(C.RP_ALGO.HALL, size, sr, 0) * tm));
                const g = C.rpLoopGain(C.RP_ALGO.HALL, { decay }, Tl, sr, 0);
                const r = simTank({ tankRt: rtT, g, loopSamples: Tl, chain: 1, dur, size });
                const rt = schroederRt(r.wl, sr) / decay;
                worst = [Math.min(worst[0], rt), Math.max(worst[1], rt)];
                assert(Math.abs(rt - 1) < 0.15, `decay ${decay} size ${size} loop ${Tl}: RT60 ${rt.toFixed(3)} x Decay`);
                // the loop's share of the tail: the energy after the tank's own decay is mostly the chain loop's (g > 0.3)
                const eTot = r.wl.reduce((t, v) => t + v * v, 0);
                const ratio = eTot / e0;
                eMin = Math.min(eMin, ratio); eMax = Math.max(eMax, ratio);
                assert(ratio > 0.8 && ratio < 1.25, `energy ${ratio.toFixed(3)} x the tank's (sqrt(1 - g^2) normalisation), decay ${decay} size ${size}`);
            }
        }
    }
    console.log(`  tank + loop RT60 / Decay over 3 sizes x 3 Decays x 3 loop times: ${worst[0].toFixed(3)}..${worst[1].toFixed(3)}; total energy / tank alone ${eMin.toFixed(2)}..${eMax.toFixed(2)}`);
});

test("recirculating loop: allpasses are exactly unity, |loop| <= g max(1, shelf) at every frequency, with damping and bass shelf", () => {
    const START = read("src/reverbplus_start.genexpr");
    const G = load(START);
    const a = C.rpLoopApGain(0.8);
    // (1) the gen's own rp_ap (transpiled): impulse response of the 4-stage chain has unit energy, and its spectrum is flat
    const lens = C.RP_LOOP.AP_LEN_L;
    const dats = lens.map(() => new DataSim(8192, 1));
    let e = 0;
    const N = 1 << 15, re = new Float64Array(N), im = new Float64Array(N);
    for (let t = 0; t < N; t++) {
        let x = t === 0 ? 1 : 0;
        for (let j = 0; j < 4; j++) x = G.rp_ap(dats[j], 0, 8192, t, lens[j], a, x);
        re[t] = x;
        e += x * x;
    }
    near(e, 1, 1e-6, "AP chain energy");
    C.rpFft(re, im, N, false);
    let lo = 9, hi = 0;
    for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); lo = Math.min(lo, m); hi = Math.max(hi, m); }
    assert(lo > 0.999 && hi < 1.001, `AP chain |H| ${lo}..${hi}`);
    // (2) the analytic bound for the whole recirculating path: g x shelf x damping x allpasses
    let worstRatio = 0;
    for (const bass of [0.25, 1, 2, 4]) for (const g of [0.3, 0.7, 0.97]) for (const diff of [0, 0.8, 1]) for (const damp of [0, 0.1, 0.5]) {
        const shelf = C.rpLoopBassShelf(C.RP_ALGO.HALL, g, bass);
        const bound = g * Math.max(1, shelf);
        assert(bound <= Math.pow(g, 1 / bass) + 1e-12 || bass < 1, `bound ${bound}`);
        for (let k = 0; k < 4000; k++) {
            const w = Math.PI * (k + 0.5) / 4000;
            const m = C.rpLoopMagnitude(w, g, C.rpLoopApGain(diff), C.RP_LOOP.AP_LEN_R, damp, shelf, 0.04);
            assert(m <= bound + 1e-9, `|loop| ${m} > ${bound} (bass ${bass}, g ${g})`);
            worstRatio = Math.max(worstRatio, m / g);
        }
        assert(bound < 1, "loop gain below 1 with a unity chain: " + bound);
    }
    // flat: with no damping and no shelf the magnitude is g at every frequency
    for (let k = 0; k < 500; k++) near(C.rpLoopMagnitude(0.003 + k * 0.006, 0.8, a, lens, 0, 1, 0), 0.8, 1e-9);
    console.log(`  loop |H| / g: exactly 1 undamped, at most ${worstRatio.toFixed(3)} with the bass shelf; AP chain energy ${e.toFixed(8)}`);
});

test("reference model: the loop never runs away (Decay 60 s, chain gain 1.5 and 3 with the clip), peaks stay bounded; unity chain decays", () => {
    const sr = 48000;
    const rtT = C.rpTankRt60(C.RP_ALGO.HALL, 60, true);
    const Tl = 4800;
    const g = C.rpLoopGain(C.RP_ALGO.HALL, { decay: 60 }, Tl, sr, 0);
    assert(g <= C.RP_LOOP.G_MAX + 1e-12 && g > 0.9, "g " + g);
    for (const [chain, clipLevel] of [[1, 1], [1.5, 1], [3, 1]]) {
        const r = simTank({ tankRt: rtT, g, loopSamples: Tl, chain, clipLevel, dur: 12 });
        let pk = 0;
        for (let i = 0; i < r.wl.length; i++) { assert(Number.isFinite(r.wl[i])); pk = Math.max(pk, Math.abs(r.wl[i])); }
        assert(pk < 1.5, `chain ${chain}: peak ${pk}`);
        const e1 = r.wl.slice(48000, 96000).reduce((t, v) => t + v * v, 0), e2 = r.wl.slice(528000, 576000).reduce((t, v) => t + v * v, 0);
        if (chain === 1) assert(e2 < e1, `unity chain: the tail must decay: ${e1} -> ${e2}`);
        else assert(Number.isFinite(e2) && e2 < 48000 * 1.5 * 1.5, `chain ${chain}: bounded by the clip (e2 ${e2})`);
    }
    // the unity chain decays by at least g^2 per recirculation: energy in successive loop periods of an impulse through the loop alone
    const r = simTank({ tankRt: 0.1, g: 0.8, loopSamples: 4800, chain: 1, dur: 3 });
    const win = (i) => r.wl.slice(i * 4800, (i + 1) * 4800).reduce((t, v) => t + v * v, 0);
    for (let i = 4; i < 12; i++) assert(win(i + 1) <= win(i) * 0.8 * 0.8 * 1.15 + 1e-12, `pass ${i}: ${win(i + 1) / win(i)}`);
});

test("derived loop gain g = 10^(-3 (T + allpass delay) / Decay), 0.5..0.9 at typical settings, capped at 0.97; tank at 0.3 x Decay while paired", () => {
    const T = 4800, sr = 48000;
    const apd = C.rpLoopApDelay(sr);
    near(apd, 0.75 * (149 + 233 + 367 + 523 + 163 + 257 + 389 + 547), 1e-9);
    near(C.rpLoopApDelay(96000), 2 * apd, 1e-9);
    for (const algo of [0, 1, 2, 3, 4]) {
        for (const decay of [1, 2.5, 6]) {
            const g = C.rpLoopGain(algo, { decay }, T, sr, 0);
            near(g, Math.min(Math.pow(10, -3 * (T + apd) / (sr * decay)), 0.97), 1e-12);
            assert(g > 0.2 && g <= 0.97);
        }
    }
    assert(C.rpLoopGain(1, { decay: 2.5 }, T, sr, 0) > 0.5 && C.rpLoopGain(1, { decay: 2.5 }, T, sr, 0) < 0.9);
    near(C.rpLoopGain(1, { decay: 60 }, T, sr, 0), 0.97, 1e-12);
    // longer loop or shorter Decay -> smaller gain
    assert(C.rpLoopGain(1, { decay: 2.5 }, 9600, sr, 0) < C.rpLoopGain(1, { decay: 2.5 }, T, sr, 0));
    assert(C.rpLoopGain(1, { decay: 1 }, T, sr, 0) < C.rpLoopGain(1, { decay: 6 }, T, sr, 0));
    // Convolution: reference = half the processed IR length (min 0.1 s)
    near(C.rpLoopGain(5, { decay: 9 }, T, sr, 48000), Math.pow(10, -3 * (T + apd) / (sr * 0.5)), 1e-12);
    // wet scale keeps the energy: s^2 / (1 - g^2) = 1
    for (const g of [0.3, 0.8, 0.97]) near(C.rpLoopWetScale(g) ** 2 / (1 - g * g), 1, 1e-12);
    // bass shelf only for the FDN algorithms; low band decays `bass` times slower
    near(C.rpLoopBassShelf(1, 0.8, 2) * 0.8, Math.pow(0.8, 0.5), 1e-12);
    assert.strictEqual(C.rpLoopBassShelf(0, 0.8, 2), 1);
    // the share
    near(C.rpTankRt60(1, 2, true), 2 * C.RP_LOOP.TANK_FRAC, 1e-12);
    near(C.rpTankRt60(1, 2, false), 2, 1e-12);
    near(C.rpTankRt60(5, 2, true), 2, 1e-12);
});

test("RT60 bands: bass multiplier below the crossover only for the FDN algorithms, high band from the damping", () => {
    const p = { algo: 1, decay: 2, bassmult: 1.5, damp: 7000 };
    const b = C.rpRt60Bands(p);
    near(b.low, 3, 1e-12);
    near(b.mid, 2, 1e-12);
    assert(b.high < 2 && b.high > 0.1);
    near(C.rpRt60Bands({ algo: 0, decay: 2, bassmult: 1.5, damp: 7000 }).low, 2, 1e-12);
    assert(C.rpRt60Bands({ algo: 1, decay: 2, bassmult: 1, damp: 2000 }).high < b.high);
});

test("inactive parameters per algorithm: Convolution drops the tank controls, keeps pre-delay, damping, cuts", () => {
    const conv = C.RP_INACTIVE[C.RP_ALGO.CONV];
    for (const k of ["size", "decay", "diffusion", "bassmult", "xover", "modrate", "moddepth", "erlevel", "freeze"]) assert(conv.includes(k), k);
    for (const k of ["predelay", "damp", "latelevel", "lowcut", "highcut", "width", "irstretch", "irdecay"]) assert(!conv.includes(k), k);
    for (let a = 0; a < 5; a++) assert(C.RP_INACTIVE[a].includes("irstretch"));
    assert.deepStrictEqual(C.RP_ALGOS, ["Plate", "Hall", "Room", "Chamber", "Spring", "Convolution"]);
});

test("pairing: bracket matching, chain latency of racks (copied from Delay+)", () => {
    const r = ["start", null, "start", null, "end", null, "end"];
    assert.strictEqual(C.rpFindPartner(r, 0), 6);
    assert.strictEqual(C.rpFindPartner(r, 2), 4);
    assert.strictEqual(C.rpFindPartner(["start", null], 0), -1);
    assert.strictEqual(C.rpChainLatency([0, 256, 100, 0, 999], 0, 3), 356);
    assert.strictEqual(C.rpDeviceLatency({ lat: 0, chains: [[{ lat: 64 }, { lat: 128 }], [{ lat: 100 }]] }), 192);
    assert.deepStrictEqual(C.rpParseDevicePath("live_set tracks 0 devices 0 chains 1 devices 3"), { parent: "live_set tracks 0 devices 0 chains 1", index: 3 });
    assert.deepStrictEqual(C.rpExtractIds(["id", 4, "id", 9]), [4, 9]);
    assert.strictEqual(C.rpRoleOf({ 4: { role: "start", t: 1000 } }, 4, 1000 + C.RP_REG_STALE_MS + 1), null);
});

test("layout constants: scope / header / spec sizes agree", () => {
    const S = C.RP_SCOPE;
    assert(Math.max(...Object.values(S)) < C.RP_SCOPE_SAMPS);
    assert.strictEqual(new Set(Object.values(S)).size, Object.keys(S).length, "scope slots are unique");
    assert.strictEqual(C.RP_CONV.HEAD_FLOATS, 16512);
    assert.strictEqual(C.RP_CONV.BANK_FLOATS, 1163952);
    assert.strictEqual(C.RP_CONV.IRSPEC_SAMPS, 2327904);
    assert.strictEqual(C.RP_IR_MAX, 290816);
    assert.strictEqual(C.RP_SPEC.DRY, C.RP_SPEC.WET + C.RP_SPEC.N);
    assert.strictEqual(C.RP_SPEC_SAMPS, 32 + 2 * C.RP_SPEC.N);
});

test("32-band spectrum of a ring: a 1 kHz sine peaks in the band that holds 1 kHz", () => {
    const buf = new Float32Array(C.RP_SPEC_SAMPS);
    buf[C.RP_SPEC.SR] = 48000;
    buf[C.RP_SPEC.HEAD] = 77;
    for (let i = 0; i < C.RP_SPEC.N; i++) buf[C.RP_SPEC.WET + i] = 0.5 * Math.sin(2 * Math.PI * 1000 * ((i - 77 + 4096) % 4096) / 48000);
    const b = C.rpSpectrum32(buf, C.RP_SPEC.WET);
    let k = 0;
    for (let i = 1; i < 32; i++) if (b[i] > b[k]) k = i;
    const lo = 40 * Math.pow(18000 / 40, k / 32), hi = 40 * Math.pow(18000 / 40, (k + 1) / 32);
    assert(lo <= 1000 * 1.05 && hi >= 1000 / 1.05, `band ${k} ${lo}..${hi}`);
    near(b[k], -6, 1.5, "0.5 amplitude sine is about -6 dB");
});

// ---- 2. IR pipeline and the convolution engine -------------------------------------------------------------
function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
}
function noiseIr(n, seed, tau) {
    const r = lcg(seed);
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = r() * Math.exp(-i / tau);
    return a;
}

test("IR process: normalised energy (a Dirac stays a Dirac), mono -> both channels", () => {
    const d = C.rpIrProcess({ chans: [Float32Array.from([1])], sr: 48000 }, {}, 48000);
    assert.strictEqual(d.len, 1);
    near(d.L[0], 1, 1e-12);
    const n = noiseIr(5000, 3, 1000);
    const p = C.rpIrProcess({ chans: [n], sr: 48000 }, {}, 48000);
    let e = 0;
    for (let i = 0; i < p.len; i++) e += (p.L[i] ** 2 + p.R[i] ** 2) / 2;
    near(e, 1, 1e-9, "mean channel energy");
    for (let i = 0; i < p.len; i++) assert.strictEqual(p.L[i], p.R[i]);
    assert.strictEqual(p.channels, 1);
});

test("IR process: Reverse, Start trim, Stretch (length x stretch, sample-rate ratio), Decay envelope, length cap", () => {
    const n = noiseIr(4000, 5, 1e9); // flat noise
    const base = C.rpIrProcess({ chans: [n, n], sr: 48000 }, {}, 48000);
    const rev = C.rpIrProcess({ chans: [n, n], sr: 48000 }, { reverse: true }, 48000);
    const k = base.L[0] !== 0 ? 1 / (base.L[0] / n[0]) : 1;
    near(rev.L[0] * k, n[3999], 1e-6);
    const st = C.rpIrProcess({ chans: [n, n], sr: 48000 }, { start: 25 }, 48000);
    assert.strictEqual(st.len, 3000);
    const s2 = C.rpIrProcess({ chans: [n, n], sr: 48000 }, { stretch: 150 }, 48000);
    assert.strictEqual(s2.len, 6000);
    const half = C.rpIrProcess({ chans: [n, n], sr: 48000 }, { stretch: 50 }, 48000);
    assert.strictEqual(half.len, 2000);
    const sr2 = C.rpIrProcess({ chans: [n, n], sr: 96000 }, {}, 48000); // a 96 kHz file on a 48 kHz device: half the samples
    assert.strictEqual(sr2.len, 2000);
    assert(sr2.srMismatch);
    const dec = C.rpIrProcess({ chans: [n, n], sr: 48000 }, { decay: 20 }, 48000);
    let e0 = 0, e1 = 0;
    for (let i = 0; i < 400; i++) e0 += dec.L[i] ** 2;
    for (let i = 3000; i < 3400; i++) e1 += dec.L[i] ** 2;
    assert(10 * Math.log10(e1 / e0) < -40, "Decay 20 % fades to -60 dB by 20 % of the IR: " + 10 * Math.log10(e1 / e0));
    const long = C.rpIrProcess({ chans: [new Float32Array(400000).fill(0.1)], sr: 48000 }, {}, 48000);
    assert.strictEqual(long.len, C.RP_IR_MAX);
    assert(Math.abs(long.L[C.RP_IR_MAX - 1]) < Math.abs(long.L[C.RP_IR_MAX - 9000]) * 0.01, "truncated IR fades out");
    const id = C.rpIrProcess({ chans: [n], sr: 48000 }, { stretch: 100, decay: 100, start: 0 }, 48000);
    assert.strictEqual(id.len, 4000); // all neutral: unchanged length
});

test("IR view: envelope (dB) and min / max waveform", () => {
    const L = new Float64Array(10000), R = new Float64Array(10000);
    for (let i = 0; i < 10000; i++) L[i] = R[i] = Math.exp(-i / 1500) * Math.sin(i * 0.3);
    const v = C.rpIrView(L, R, 10000);
    assert.strictEqual(v.env.length, C.RP_IR_VIEW_N);
    assert(v.env[0] > v.env[200] && v.env[200] > v.env[500]);
    assert(v.wave[1] > 0.1 && v.wave[0] < -0.1);
});

const LIB_SRC = read("src/cepstrum_lib.genexpr");
const CONV_SRC = read("src/reverbplus_conv.genexpr");
const START_SRC = read("src/reverbplus_start.genexpr");
const END_SRC = read("src/reverbplus_end.genexpr");

function runConv(irLen, bank, nSamples, seed) {
    const G = load(LIB_SRC, CONV_SRC);
    const tab = new DataSim(4096, 3);
    G.fft_init(tab);
    const r = lcg(seed);
    const hL = new Float64Array(irLen), hR = new Float64Array(irLen);
    for (let i = 0; i < irLen; i++) { const e = Math.exp(-i / (irLen / 4)); hL[i] = r() * e; hR[i] = r() * e; }
    hL[0] = 1; hR[3] = 0.5;
    const sp = C.rpIrSpectra(hL, hR, irLen);
    const irs = new DataSim(C.RP_CONV.IRSPEC_SAMPS, 1);
    const b0 = bank * C.RP_CONV.BANK_FLOATS;
    irs.a.set(sp.head, b0);
    irs.a.set(sp.tail, b0 + C.RP_CONV.HEAD_FLOATS);
    const cp = new DataSim(4, 1);
    cp.a[0] = bank; cp.a[1] = sp.nHead; cp.a[2] = sp.nTail; cp.a[3] = 1;
    const cvr = new DataSim(8192, 2), cxh = new DataSim(256, 2), cxt = new DataSim(4096, 2);
    const fdh = new DataSim(32 * 129 * 4, 1), fdt = new DataSim(142 * 2049 * 4, 1);
    const ohr = new DataSim(512, 2), otr = new DataSim(8192, 2), ach = new DataSim(256, 1), cout = new DataSim(2, 1);
    const xl = new Float64Array(nSamples), xr = new Float64Array(nSamples);
    for (let i = 0; i < nSamples; i++) { xl[i] = r(); xr[i] = r() * 0.5; }
    let maxerr = 0, maxv = 0;
    for (let n = 0; n < nSamples; n++) {
        G.rpc_tick(n, xl[n], xr[n], tab, cvr, cxh, cxt, fdh, fdt, ohr, otr, irs, cp, ach, cout);
        const t = n - C.RP_CONV.LAT;
        if (t < 0) continue;
        let yl = 0, yr = 0;
        for (let k = 0; k < irLen && k <= t; k++) { yl += hL[k] * xl[t - k]; yr += hR[k] * xr[t - k]; }
        maxerr = Math.max(maxerr, Math.abs(cout.a[0] - yl), Math.abs(cout.a[1] - yr));
        maxv = Math.max(maxv, Math.abs(yl), Math.abs(yr));
    }
    return { maxerr, maxv, nHead: sp.nHead, nTail: sp.nTail };
}

test("convolution engine (GenExpr functions in Node): head only, head + tail, bank 1, == direct convolution delayed by 256", () => {
    const a = runConv(3000, 0, 9000, 1); // only head partitions (3000 < 4096)
    assert.strictEqual(a.nTail, 0);
    assert(a.maxerr < 1e-4 * Math.max(1, a.maxv), `head-only error ${a.maxerr}`);
    const b = runConv(12000, 1, 24000, 2); // 4 tail partitions, second bank
    assert.strictEqual(b.nTail, 4);
    assert(b.maxerr < 1e-4 * Math.max(1, b.maxv), `head + tail error ${b.maxerr} (peak ${b.maxv})`);
    const c = runConv(4097, 0, 14000, 3); // one-sample tail
    assert.strictEqual(c.nTail, 1);
    assert(c.maxerr < 1e-4 * Math.max(1, c.maxv), `edge error ${c.maxerr}`);
});

// ---- 3. GenExpr lint ----------------------------------------------------------------------------------------------
function stripComments(src) {
    return src.replace(/\/\/.*$/gm, "");
}

function lintCore(label, sources, opts) {
    const joined = sources.join("\n");
    const code = stripComments(joined);
    // function order: every function definition precedes the first declaration
    const fnStart = [...code.matchAll(/^([A-Za-z_]\w*)\([^)]*\) \{$/gm)].map((m) => m.index);
    const declStart = code.search(/^(Buffer|Data|Param|History|Delay)\b/m);
    assert(fnStart.length > 0 && declStart > 0, label + ": functions and declarations");
    assert(Math.max(...fnStart) < declStart, label + ": a function is defined after a declaration");
    // the first statement after the declarations must not be a declaration of those kinds again later
    const lastDecl = [...code.matchAll(/^(Buffer|Data|Param|History|Delay)\b.*$/gm)].pop().index;
    const firstStmt = code.slice(declStart).search(/^(?!Buffer|Data|Param|History|Delay|\s*$)[A-Za-z_]/m);
    assert(firstStmt < 0 || declStart + firstStmt > lastDecl, label + ": declarations after the first statement");
    assert(!/\be\d\b/.test(code), label + ": identifier e<digit> (parsed as Euler's constant)");
    for (const bad of ["phi", "pi", "noise", "rise", "fall", "bias", "mix"]) {
        assert(!new RegExp("^\\s*(?:Param|History|Data|Buffer)\\s+" + bad + "\\b", "m").test(code), label + ": reserved name " + bad);
    }
    // functions: one return at function level, last statement
    const fns = functionsOf(joined);
    const fnNames = new Set(fns.map((f) => f.name));
    for (const f of fns) {
        const body = f.body.map((l) => l.replace(/\/\/.*$/, "")).filter((l) => l.trim());
        const rets = body.map((l, i) => [l, i]).filter(([l]) => /\breturn\b/.test(l));
        assert.strictEqual(rets.length, 1, `${label}: function ${f.name} needs exactly one return (found ${rets.length})`);
        assert(/^\treturn /.test(body[rets[0][1]]) && rets[0][1] === body.length - 1, `${label}: ${f.name}: the return must be the last statement at function level`);
    }
    // no user function call nested in a poke() argument list
    for (const line of code.split("\n")) {
        const m = /poke\((.*)\);/.exec(line);
        if (!m) continue;
        for (const fnm of fnNames) {
            assert(!new RegExp("\\b" + fnm + "\\(").test(m[1]), `${label}: user function ${fnm} nested in poke(): ${line.trim()}`);
        }
    }
    // a function-local variable named like a global Data / Buffer silently breaks the compile (parameters of the
    // same name are the documented pattern: tab, win, fx ...)
    const globals = new Set([...code.matchAll(/^(?:Data|Buffer)\s+(\w+)/gm)].map((m) => m[1]));
    for (const f of fns) {
        const params = new Set(f.params);
        const assigned = new Set([...f.body.join("\n").replace(/\/\/.*$/gm, "").matchAll(/(?:^|[;{(,\s])([A-Za-z_]\w*)\s*(?:[+\-*/]?=)(?!=)/g)].map((m) => m[1]));
        for (const a of assigned) assert(!(globals.has(a) && !params.has(a)), `${label}: ${f.name} assigns ${a}, which is also a global Data / Buffer`);
    }
    return { code, globals };
}

test("GenExpr lint: Start (library + conv + core) and End", () => {
    const start = lintCore("start", [LIB_SRC, CONV_SRC, START_SRC]);
    const end = lintCore("end", [END_SRC]);
    // buffer names: the Start binds these by loadbang messages built by scripts/build_reverbplus.py
    for (const n of ["rpxfer", "rphdr", "rpscope", "rpspec", "rpirspec"]) assert(START_SRC.includes(`("${n}")`), "Start Buffer " + n);
    for (const n of ["rpxferE", "rphdrE", "rpscopeE"]) assert(END_SRC.includes(`("${n}")`), "End Buffer " + n);
    // Data sizes the conv functions and the core agree on
    assert(/Data fdt\(1163832\)/.test(START_SRC) && 142 * 2049 * 4 === 1163832);
    assert(/Data fdh\(16512\)/.test(START_SRC) && C.RP_CONV.HEAD_FLOATS === 16512);
    assert(START_SRC.includes("Data otr(8192, 2)") && START_SRC.includes("Data ohr(512, 2)"));
    assert(CONV_SRC.includes(String(C.RP_CONV.BANK_FLOATS)));
    assert(/clrPos >= 2212408/.test(START_SRC) && 1048576 + 1163832 === 2212408);
    // Param names the build wires (gen messages) exist in the Start
    const build = fs.readFileSync(path.join(ROOT, "scripts", "build_reverbplus.py"), "utf8");
    const msgs = [...build.matchAll(/^    "(\w+)": \("[^"]+", "[^"]+", [^\n]*?, "(\w+)", \d+,\s*$/gm)];
    assert(msgs.length === 0 || msgs.length > 10);
    void start; void end;
});

test("the Start gen's loop constants are the config's (K, tank share, gain cap, allpass lengths / gain, Convolution, spring allpass)", () => {
    const code = stripComments(START_SRC).replace(/\s+/g, " ");
    const L = C.RP_LOOP;
    assert(code.includes(`klp = algoCur == 1 ? ${L.K[1]} : (algoCur == 2 ? ${L.K[2]} : ${L.K[3]});`), "K hall / room / chamber");
    assert(code.includes(`klp = ${L.K[0]};`) && code.includes(`klp = ${L.K[4]};`), "K plate / spring");
    assert(code.includes(`rtT = rt * (1 - ${Number((1 - L.TANK_FRAC).toFixed(6))} * lkS`), "tank share");
    assert(code.includes(`lgT = min(rp_gain(tlE + apSum, rtG, sr), ${L.G_MAX});`), "gain");
    assert(code.includes(`apAt = ${L.AP_GAIN_MIN} + ${L.AP_GAIN_SPAN} * clip(diffp, 0, 1);`), "allpass gain");
    L.AP_LEN_L.forEach((v, i) => assert(code.includes(`apl.poke(floor(${v} * sfc + 0.5), ${i});`), "AP L " + i));
    L.AP_LEN_R.forEach((v, i) => assert(code.includes(`apl.poke(floor(${v} * sfc + 0.5), ${4 + i});`), "AP R " + i));
    assert(code.includes("bshT = (algoCur == 1 || algoCur == 2 || algoCur == 3) ? pow(lgT, 1 / clip(bassm, 0.25, 4) - 1) : 1;"), "bass shelf");
    assert(code.includes("scs + ((1 + lkS * (sqrt(max(1 - lgT * lgT, 0)) - 1)) - scs)"), "wet scale");
    assert(code.includes("tL = xL * ig * inS;") && !/tL = xL \* ig \* inS \+/.test(code), "the return does not enter the tank (only the Input-scaled input does)");
    assert(code.includes(`* 0.5 + ${L.SPRING_AP};`), "spring allpass samples");
    assert(code.includes(`clip(${L.CONV_FRAC} * irLen, ${L.CONV_MIN_S} * sr, ${L.CONV_MAX_S} * sr)`), "Convolution loop time");
    assert(code.includes(`clip(tlN, 0, ${L.MAX_S} * sr)`), "longest loop");
    assert(code.includes("max(0.5 * irLen / sr, 0.1)"), "Convolution decay reference");
    assert(L.K.length === 5);
});

test("telemetry / header slots written by the cores are slots of RP_SCOPE / RP_HDR / RP_ESCOPE", () => {
    const S = C.RP_SCOPE;
    const scalar = new Set(Object.values(S));
    const code = stripComments(START_SRC);
    const idx = new Set();
    for (const m of code.matchAll(/poke\(scope, [^;]*, (\d+)\);/g)) idx.add(Number(m[1]));
    for (const i of idx) assert(scalar.has(i), "scope slot " + i + " is not in RP_SCOPE");
    for (const k of ["FRAMES", "SR", "ALGO", "FREEZE", "PAIRED", "B", "L", "K", "MIN_MS", "LOOP_MS", "PREDELAY_MS", "CLAMPED", "IN_PK", "ASLEEP", "WET_PK", "RET_PK",
        "CLIP_DB", "RT60_LO", "RT60_MID", "RT60_HI", "IR_LOADED", "IR_LEN", "IR_VER", "IR_SRMIS",
        "ALGO_STATE", "LOOP_GAIN", "TANK_RT", "MUTE_N", "MUTE_L", "MUTE_B", "MUTE_K", "GLINK"]) assert(idx.has(S[k]), "Start never writes scope " + k);
    // header
    const H = C.RP_HDR;
    const known = new Set(Object.values(H));
    for (const g of [START_SRC, END_SRC]) {
        const c2 = stripComments(g);
        for (const m of c2.matchAll(/poke\(hdr, .*, (\d+)\);/g)) assert(known.has(Number(m[1])), "hdr slot " + m[1] + " is not in RP_HDR");
        for (const m of c2.matchAll(/peek\(hdr, (\d+)\)/g)) assert(known.has(Number(m[1])), "hdr slot " + m[1] + " is not in RP_HDR");
    }
    for (const m of stripComments(END_SRC).matchAll(/poke\(scope, [^;]*, (\d+)\);/g)) assert(Object.values(C.RP_ESCOPE).includes(Number(m[1])), "End scope slot " + m[1]);
});

test("anydrop (a file dropped anywhere on the face): every algorithm, audio files only, switches to Convolution, also stored in the IR File parameter", () => {
    const src = fs.readFileSync(path.join(ROOT, "src", "reverbplus_engine.js"), "utf8");
    const grab = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert(a >= 0 && b > a, from); return src.slice(a, b); };
    const code = grab("function rpIrPathFromArgs", "var rpLastDropped") + grab("var RP_DROP_DEFER_MS", "function browsed");
    const calls = [];
    const tasks = []; // Task stub: the drop is deferred, run it by hand
    const ctx = { RP_ALGO: { CONV: 5 }, rpRaw: { algo: 5 }, Task: function (fn) { this.schedule = (ms) => { assert(ms > 0, "deferred"); tasks.push(fn); }; }, outlet: (...a) => calls.push(["outlet", ...a]), rpIrLoad: (p) => calls.push(["load", p]), Array, String, RegExp };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    const drop = (algo, ...args) => { calls.length = 0; ctx.rpRaw.algo = algo; vm.runInContext("anydrop", ctx).apply(null, args); assert.strictEqual(calls.length, 0, "nothing happens inside the drop callback"); while (tasks.length) tasks.shift()(); return calls.slice(); };
    assert.deepStrictEqual(drop(5, "Macintosh HD:/tmp/My", "IR.WAV"), [["outlet", 4, "Macintosh HD:/tmp/My IR.WAV"], ["load", "Macintosh HD:/tmp/My IR.WAV"]], "in Convolution: loads, stores in the parameter, rejoins a split path, no switch");
    for (let a = 0; a < 5; a++) assert.deepStrictEqual(drop(a, "/x/ir.wav"), [["outlet", 5, "algo", 5], ["outlet", 4, "/x/ir.wav"], ["load", "/x/ir.wav"]], "algorithm " + a + " switches to Convolution, then loads");
    for (const ext of ["wav", "aif", "aiff", "flac", "mp3", "m4a", "caf"]) assert.strictEqual(drop(5, "/x/ir." + ext).length, 2, ext);
    for (const bad of ["/x/notes.txt", "/x/folder", "/x/song.als", "/x/ir.wav.zip", "none", ""]) for (const a of [1, 5]) assert.strictEqual(drop(a, bad).length, 0, `ignored (no switch either): ${bad} in algorithm ${a}`);
});

test("no face / engine script declares Max's reserved v8ui globals", () => {
    const reserved = ["box", "patcher", "max", "messagename", "inlet", "jsarguments"];
    for (const f of fs.readdirSync(path.join(ROOT, "src")).filter((n) => /^reverbplus_.*\.js$/.test(n))) {
        const code = read("src/" + f);
        for (const r of reserved) {
            assert(!new RegExp("(^|\\n)\\s*(var|let|const|function)\\s+" + r + "\\b").test(code), `${f} declares ${r}`);
            assert(!new RegExp("(^|[^.\\w])" + r + "\\s*=[^=]").test(code), `${f} assigns ${r}`);
        }
    }
});

// ---- 4. layouts -----------------------------------------------------------------------------------------------------
const layoutDir = path.join(ROOT, "scripts", "reverbplus_layouts");
const layouts = fs.readdirSync(layoutDir).filter((f) => f.endsWith(".py") && !f.startsWith("_")).map((f) => f.slice(0, -3)).sort();

function readAmxd(p) {
    const buf = fs.readFileSync(p);
    assert.strictEqual(buf.slice(0, 4).toString(), "ampf");
    assert.strictEqual(buf.slice(8, 12).toString(), "aaaa", "audio effect");
    const len = buf.readUInt32LE(28);
    return JSON.parse(buf.slice(32, 32 + len).toString("utf8"));
}

function mockMgraphics(w, h) {
    const calls = [];
    const mg = new Proxy({ size: [w, h], text_measure: (t) => [String(t).length * 5, 8], _calls: calls }, {
        get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return 0; }), set: (t, k, v) => { t[k] = v; return true; },
    });
    return mg;
}

function runFace(code, w, h) {
    const mg = mockMgraphics(w, h);
    const noop = () => {};
    const ctx = {
        mgraphics: mg, outlet: noop, post: noop, Math, Number, String, Array, JSON, isNaN, Float32Array, Float64Array, Object, Date,
        console, parseFloat, parseInt, Infinity, NaN, Uint8Array, Int32Array, Error,
        Buffer: function () { this.peek = () => []; this.poke = noop; }, Global: function () {}, Task: function () { this.schedule = noop; this.repeat = noop; this.cancel = noop; },
    };
    ctx.messagename = "";
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return { ctx, mg };
}

function checkDevice(name, doc, lay) {
    const p = doc.patcher;
    assert.strictEqual(p.openrect[3], 169, "169 px high");
    assert.strictEqual(p.openinpresentation, 1);
    const boxes = p.boxes.map((b) => b.box);
    const ids = boxes.map((b) => b.id);
    assert.strictEqual(new Set(ids).size, ids.length, "box ids unique");
    // background panels are the last boxes
    const firstPanel = boxes.findIndex((b) => b.maxclass === "panel");
    if (firstPanel >= 0) for (const b of boxes.slice(firstPanel)) assert(b.maxclass === "panel" && b.background === 1, "panels last, background 1: " + b.id);
    // every parameter once with a unique long and short name
    const ctrl = boxes.filter((b) => b.id.startsWith("obj-ctrl-"));
    const longs = new Set(), shorts = new Set();
    for (const b of ctrl) {
        const v = b.saved_attribute_attributes.valueof;
        assert(!longs.has(v.parameter_longname) && !shorts.has(v.parameter_shortname), "unique names: " + v.parameter_longname);
        longs.add(v.parameter_longname); shorts.add(v.parameter_shortname);
        assert.strictEqual(b.parameter_enable, 1);
    }
    for (const k of ["algo", "predelay", "size", "decay", "diffusion", "damp", "bassmult", "xover", "modrate", "moddepth", "erlevel", "latelevel", "lowcut", "highcut", "width",
        "freeze", "loopclip", "looplevel", "duck", "duckrel", "drywet", "output", "irstretch", "irstart", "irreverse", "irdecay", "irfile", "input"]) {
        assert(ids.includes("obj-ctrl-" + k), "parameter " + k);
    }
    const drops = boxes.filter((b) => b.maxclass === "live.drop");
    assert.strictEqual(drops.length, 1, "exactly one live.drop");
    const d = drops[0];
    assert.strictEqual(d.saved_attribute_attributes.valueof.parameter_type, 4);
    assert.strictEqual(d.saved_attribute_attributes.valueof.parameter_invisible, 1);
    assert.strictEqual(d.parameter_enable, 1);
    // gen hub, no cord from the deferred gen, plugin~/plugout~ names
    const lines = p.lines.map((l) => l.patchline);
    // whole-face drop target (Convolution IR): Max's `dropfile`, not a parameter, invisible, ignoreclick (every click reaches the
    // widgets behind it), the whole 444 x 169 face, in front of every control and v8ui (only the background panels follow)
    if (name === "Reverb+") {
        const dfs = boxes.filter((b) => b.maxclass === "dropfile");
        assert.strictEqual(dfs.length, 1, "exactly one dropfile");
        const df = dfs[0];
        assert.strictEqual(df.ignoreclick, 1, "dropfile ignoreclick 1 (rule 4: never captures a click)");
        assert.strictEqual(df.presentation, 1);
        assert.deepStrictEqual(df.presentation_rect, [0, 0, doc.patcher.openrect[2], 169], "covers the whole face");
        assert.strictEqual(df.border, 0, "no frame");
        assert.strictEqual(df.bordercolor[3], 0, "invisible");
        assert.strictEqual(df.bgcolor[3], 0);
        assert(!("parameter_enable" in df) || !df.parameter_enable, "not a parameter: IR File stays the only parameter drop");
        const di = ids.indexOf(df.id);
        for (const b of boxes) if (b.presentation === 1 && b.maxclass !== "panel" && b.id !== df.id) assert(ids.indexOf(b.id) < di, `${b.id} is behind the drop target`);
        const hasL = (a, ao, c, ci) => lines.some((l) => l.source[0] === a && l.source[1] === ao && l.destination[0] === c && l.destination[1] === ci);
        const prep = boxes.find((b) => b.text === "prepend anydrop");
        const dfr = boxes.find((b) => b.text === "defer");
        assert(dfr && prep && hasL(df.id, 0, dfr.id, 0) && hasL(dfr.id, 0, prep.id, 0) && hasL(prep.id, 0, "obj-engine", 0), "dropfile -> defer -> prepend anydrop -> engine (nothing runs inside the drag callback)");
        assert(hasL("obj-engine", 5, "obj-route-key", 0), "engine outlet 5 -> route-key (switches the real Algorithm object)");
        assert(!df.hidden, "the drop target exists in every algorithm");
    }
    assert(!lines.some((l) => l.source[0] === "obj-gen"), "nothing reads the deferred gen's outlets");
    assert(!ids.includes("obj-gen") && !boxes.some((b) => /^gen/.test(String(b.maxclass || "")) || /^gen~/.test(String(b.text || ""))), "the Start ships without gen~");
    const hub = boxes.find((b) => b.id === "obj-gen-in");
    assert(hub && hub.text === "gate 1 1" && hub.varname === "rp_genin");
    assert.strictEqual(boxes.find((b) => b.id === "obj-plugin").varname, "rp_plugin");
    assert.strictEqual(boxes.find((b) => b.id === "obj-plugout").varname, "rp_plugout");
    assert(!lines.some((l) => l.source[0] === "obj-plugin" || l.destination[0] === "obj-plugout"), "silence during deferral: no static plugin~ / plugout~ cord");
    // wiring: every parameter -> prepend set_<key> -> engine; the face keys also reach their v8ui
    const eng = boxes.find((b) => b.id === "obj-engine");
    assert(eng && eng.maxclass === "v8ui" && eng.numoutlets === 6 && !eng.presentation, "engine v8ui, not in presentation");
    const has = (a, ao, b, bi) => lines.some((l) => l.source[0] === a && l.source[1] === ao && l.destination[0] === b && l.destination[1] === bi);
    for (const b of ctrl) {
        const k = b.id.slice("obj-ctrl-".length);
        if (k === "irfile") continue;
        assert(has(b.id, 0, "obj-ui-" + k, 0) && has("obj-ui-" + k, 0, "obj-engine", 0), "set_" + k + " reaches the engine");
        assert.strictEqual(boxes.find((x) => x.id === "obj-ui-" + k).text, "prepend set_" + k);
    }
    for (const u of lay.v8uis) {
        const box = boxes.find((b) => b.id === u.id);
        assert(box && box.maxclass === "v8ui", "v8ui " + u.id);
        for (const k of u.keys || []) assert(has("obj-ui-" + k, 0, u.id, 0), `${u.id} subscribes to ${k}`);
        assert(has(u.id, 0, "obj-route-face", 0), u.id + " outlet 0 -> route param cmd");
        if (u.state !== false) assert(has("obj-state-recv", 0, u.id, 0), u.id + " listens to the state bus");
    }
    // the gen messages reach the hub only
    for (const k of ["algo", "decay", "wet"]) void k;
    const toGen = lines.filter((l) => l.destination[0] === "obj-gen-in");
    assert(toGen.every((l) => l.destination[1] === 1), "gen messages go into the hub's data inlet");
    assert(toGen.some((l) => l.source[0] === "obj-engine"), "the engine's resend reaches the hub");
    for (const b of boxes) {
        if (b.maxclass !== "newobj" && b.maxclass !== "message") continue;
        if (b.text && /^(buffer~|s |r )/.test(b.text) && b.text !== "r #0-rptest") assert(!b.text.includes("#0"), "use --- names: " + b.text);
    }
    assert(boxes.some((b) => b.text && b.text.startsWith("buffer~ ---rpirspec @samps " + C.RP_CONV.IRSPEC_SAMPS)));
    // scripts: mgraphics init lines, no reserved globals, every face runs
    for (const u of boxes.filter((b) => b.maxclass === "v8ui")) {
        const code = u.textfile.text;
        if (u.id !== "obj-engine") {
            assert(/mgraphics\.init\(\);\s*mgraphics\.relative_coords = 0;\s*mgraphics\.autofill = 0;/.test(code), u.id + ": mgraphics init lines");
            const r = u.presentation_rect;
            const { ctx, mg } = runFace(code, r[2], r[3]);
            if (typeof ctx.preview === "function") ctx.preview();
            assert(typeof ctx.paint === "function", u.id + " defines paint()");
            ctx.paint();
            assert(mg._calls.length > 0, u.id + " draws something");
        } else {
            const mgr = ["box", "patcher", "max", "messagename", "inlet", "jsarguments"];
            for (const r of mgr) assert(!new RegExp("(^|\\n)\\s*(var|let|const)\\s+" + r + "\\b").test(code), "engine declares " + r);
            new vm.Script(code); // syntax
            assert(code.includes("var GEN_DSP_TEXT") && code.includes("var RP_GEN_PARAMS") && code.includes("var RP_PANEL_THEME") && code.includes('var RP_DSP_PREFIX = "reverbplus_start"'));
        }
        assert(Buffer.byteLength(code) < 16 * 1024 * 1024);
    }
    // rule 4: live.* never over an interactive v8ui (also checked by the build; this reads the saved device)
    const faces = boxes.filter((b) => b.maxclass === "v8ui" && b.presentation === 1 && !b.hidden);
    const ov = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    for (const f of faces) {
        for (const b of boxes) {
            if (!String(b.maxclass).startsWith("live.") || b.presentation !== 1 || b.hidden) continue;
            if (b.maxclass === "live.comment" || b.maxclass === "live.line") continue;
            if (ov(b.presentation_rect, f.presentation_rect)) {
                assert(f.ignoreclick === 1 && boxes.indexOf(b) > boxes.indexOf(f), `${b.id} over ${f.id}: only allowed over an ignoreclick face, in front of it`);
            }
        }
    }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rp_layouts_"));
for (const name of layouts) {
    test(`layout ${name}: contract (build + validate), device structure, faces run`, () => {
        const outDir = path.join(tmp, name);
        const r = spawnSync("python3", [path.join(ROOT, "scripts", "build_reverbplus.py"), "--variant", name, "--no-sets", "--out-dir", outDir], { encoding: "utf8" });
        assert.strictEqual(r.status, 0, "build failed: " + (r.stderr || r.stdout));
        const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".amxd") && !f.endsWith("End.amxd"));
        assert.strictEqual(files.length, 1, "one Start device " + files);
        assert(name === "base" ? files[0] === "Reverb+.amxd" : files[0].startsWith("Reverb+ "), "device name " + files[0]);
        const doc = readAmxd(path.join(outDir, files[0]));
        // the layout module's own declaration, via python, for the v8ui list
        const info = JSON.parse(execFileSync("python3", ["-c",
            "import sys,json; sys.path.insert(0,'scripts'); import build_reverbplus as b; m,l=b.load_layout(sys.argv[1]); print(json.dumps({'v8uis': l['v8uis'], 'width': l['width']}))", name],
            { cwd: ROOT, encoding: "utf8" }));
        assert(info.width > 100 && info.width <= 1200, "width " + info.width);
        checkDevice(name, doc, { v8uis: info.v8uis });
        assert.strictEqual(doc.patcher.devicewidth, info.width);
        assert(fs.existsSync(path.join(ROOT, `tsconfig.reverbplus-${name === "base" ? "face" : name}.json`)), `tsconfig.reverbplus-${name === "base" ? "face" : name}.json (type-checks the face scripts)`);
    });
}

test("every tests/test_reverbplus_face*.js sub-test passes", () => {
    for (const f of fs.readdirSync(__dirname).filter((n) => /^test_reverbplus_face(_.*)?\.js$/.test(n))) {
        const r = spawnSync("node", [path.join(__dirname, f)], { encoding: "utf8" });
        assert.strictEqual(r.status, 0, `${f}: ${(r.stdout + r.stderr).split("\n").slice(-6).join("\n")}`);
    }
});

// ---- 5. built base + End device --------------------------------------------------------------------------------------
test("Input parameter: -36..+12 dB, default 0, unique short name, appended last, `%.1f dB` like Output", () => {
    const doc = readAmxd(path.join(ROOT, "devices", "Reverb+.amxd"));
    const boxes = doc.patcher.boxes.map((b) => b.box);
    const i = boxes.find((b) => b.id === "obj-ctrl-input"), o = boxes.find((b) => b.id === "obj-ctrl-output");
    const v = i.saved_attribute_attributes.valueof, ov = o.saved_attribute_attributes.valueof;
    assert.strictEqual(v.parameter_longname, "Input");
    assert.strictEqual(v.parameter_shortname, "Input");
    assert.deepStrictEqual(v.parameter_mmin, -36); assert.deepStrictEqual(v.parameter_mmax, 12);
    assert.strictEqual(v.parameter_initial[0], 0);
    assert.strictEqual(v.parameter_unitstyle, ov.parameter_unitstyle);
    assert.strictEqual(v.parameter_units, ov.parameter_units);
    assert.strictEqual(i.maxclass, "live.dial");
    assert.strictEqual(boxes.filter((b) => b.saved_attribute_attributes && b.saved_attribute_attributes.valueof && b.saved_attribute_attributes.valueof.parameter_shortname === "Input").length, 1);
});

test("built devices/Reverb+.amxd: gen patch embedded for the deferred DSP, IR spectra buffer sized for two banks", () => {
    const doc = readAmxd(path.join(ROOT, "devices", "Reverb+.amxd"));
    const eng = doc.patcher.boxes.map((b) => b.box).find((b) => b.id === "obj-engine").textfile.text;
    const gen = JSON.parse(JSON.parse(/var GEN_DSP_TEXT = (".*");/.exec(eng)[1]));
    const code = gen.patcher.boxes.find((b) => b.box.id === "obj-code").box.code;
    assert(code.includes("rpc_tick(") && code.includes("fft_init") && code.includes("Buffer irs(\"rpirspec\")"));
    assert.strictEqual(gen.patcher.classnamespace, "dsp.gen");
    const params = JSON.parse(/var RP_GEN_PARAMS = (\{.*\});/.exec(eng)[1]);
    for (const [key, [msg, div]] of Object.entries(params)) {
        assert(new RegExp("^Param " + msg + "\\(", "m").test(code), `gen Param ${msg} for ${key}`);
        assert(div >= 1);
    }
    assert.strictEqual(params.size[1], 100);
    assert.strictEqual(params.decay[1], 1);
    assert.strictEqual(params.drywet[0], "wetmix");
    assert.deepStrictEqual(params.input, ["indb", 1], "Input -> gen indb (dB, no divisor)");
    assert(!("irstretch" in params), "IR controls are the engine's, not the gen's");
});

test("built devices/Reverb+ End.amxd: deferred gen~, silence during deferral, link layer, 124 px wide", () => {
    const doc = readAmxd(path.join(ROOT, "devices", "Reverb+ End.amxd"));
    assert.strictEqual(doc.patcher.devicewidth, 124);
    const boxes = doc.patcher.boxes.map((b) => b.box);
    const lines = doc.patcher.lines.map((l) => l.patchline);
    const ids = boxes.map((b) => b.id);
    assert(!ids.includes("obj-gen") && !boxes.some((b) => /^gen/.test(String(b.maxclass || "")) || /^gen~/.test(String(b.text || ""))), "End ships without gen~");
    const hub = boxes.find((b) => b.id === "obj-gen-in");
    assert(hub && hub.text === "gate 1 1" && hub.varname === "rp_genin");
    assert.strictEqual(boxes.find((b) => b.id === "obj-plugin").varname, "rp_plugin");
    assert.strictEqual(boxes.find((b) => b.id === "obj-plugout").varname, "rp_plugout");
    assert(!lines.some((l) => l.source[0] === "obj-plugin" || l.destination[0] === "obj-plugout"), "silence during deferral: no static audio cord");
    assert(!lines.some((l) => l.source[0] === "obj-gen"), "nothing reads a gen that is not in the file");
    for (const id of ["obj-msg-local", "obj-prep-xfer", "obj-prep-hdr"]) {
        assert(lines.some((l) => l.source[0] === id && l.destination[0] === "obj-gen-in" && l.destination[1] === 1), id + " -> hub data inlet");
    }
    assert(boxes.some((b) => b.text === "buffer~ ---rpxferE @samps 64 @chans 5"));
    assert.strictEqual(boxes.filter((b) => b.maxclass === "v8ui").length, 1);
    const viz = boxes.find((b) => b.id === "obj-viz").textfile.text;
    assert(viz.includes('var RP_DSP_PREFIX = "reverbplus_end"') && viz.includes("var GEN_DSP_TEXT") && viz.includes("function rpDspLoad"), "End face carries the deferred loader");
    const gen = JSON.parse(JSON.parse(/var GEN_DSP_TEXT = (".*");/.exec(viz)[1]));
    const code = gen.patcher.boxes.find((b) => b.box.id === "obj-code").box.code;
    assert(code.includes('Buffer scope("rpscopeE")') && code.includes("poke(scope, frames, 7)"), "End scope frame counter is in the embedded gen");
    assert.strictEqual(gen.patcher.classnamespace, "dsp.gen");
    const { ctx } = runFace(viz, 116, 161);
    ctx.preview();
    ctx.paint();
    assert.strictEqual(ctx.rpDsp.ready, 0);
    assert.strictEqual(ctx.rpDsp.createdAt, 0);
});

test("no Reverb+ script redeclares Max's reserved v8ui / js globals", () => {
    // Delay+: `var box = ...` crashed Live on the first mouse drag (Max reads its own `box` accessor in pointer events).
    // inlets / outlets are meant to be assigned (a js script sets its own counts), so they are only checked as declarations.
    const reserved = ["box", "patcher", "max", "messagename", "inlet", "jsarguments", "outlet", "inlets", "outlets", "arguments"];
    const files = fs.readdirSync(path.join(ROOT, "src")).filter((n) => /^reverbplus_.*\.js$/.test(n));
    assert(files.length >= 8, "found " + files.join(", "));
    for (const f of files) {
        const code = fs.readFileSync(path.join(ROOT, "src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        for (const r of reserved) {
            assert(!new RegExp("(^|[^.\\w$])(var|let|const|function|class)\\s+" + r + "\\b").test(code), `${f} declares ${r}`);
            // a function parameter or catch binding with that name shadows the built-in too
            for (const m of code.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) assert(!m[1].split(",").map((x) => x.trim().replace(/=.*/, "").trim()).includes(r), `${f} has a parameter named ${r}`);
            if (!["inlets", "outlets"].includes(r)) assert(!new RegExp("(^|[^.\\w$])" + r + "\\s*=[^=]").test(code), `${f} assigns ${r}`);
        }
    }
});

test("devices/Reverb+.adg: [Reverb+] [empty nested 'Reverb+ FX' rack, one empty chain] [Reverb+ End folded]", () => {
    require("./adg_check.js").checkRackPreset(path.join(ROOT, "devices", "Reverb+.adg"), "Reverb+", "Reverb+.amxd", "Reverb+ End.amxd");
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
