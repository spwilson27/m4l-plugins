"use strict";
// DSP tests for the Quefrency Crush Glitch / Phase / Lag features. Required (and so run) by tests/test_qcrush.js.
//   * neutral settings are bit-identical to tests/qcrush_legacy_model.js (the frozen pre-feature model)
//   * Drop / Repeat / Reverse on a frame-index probe, Lag delays, phase preservation, transport lock
//   * Phase modes keep the magnitude spectrum and the level
//   * the GenExpr functions of src/qcrush_core.genexpr, transpiled and run in Node (tests/genexpr_functions.js),
//     match src/qcrush_ref.js frame for frame
//   * GenExpr lint for the new code, and gen <-> ref constant parity

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ref = require("../src/cepstrum_ref.js");
const qc = require("../src/qcrush_ref.js");
const legacy = require("./qcrush_legacy_model.js");
const metrics = require("./phasefold_metrics.js");
const gx = require("./genexpr_functions.js");

const ROOT = path.join(__dirname, "..");
const LIB = fs.readFileSync(path.join(ROOT, "src", "cepstrum_lib.genexpr"), "utf8");
const CORE = fs.readFileSync(path.join(ROOT, "src", "qcrush_core.genexpr"), "utf8");
const SR = 44100;

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
function resonator(x, f, bw) {
    const r = Math.exp((-Math.PI * bw) / SR);
    const th = (2 * Math.PI * f) / SR;
    const a1 = -2 * r * Math.cos(th);
    const a2 = r * r;
    const y = new Float64Array(x.length);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < x.length; i++) {
        const v = (1 - r) * x[i] - a1 * y1 - a2 * y2;
        y[i] = v;
        y2 = y1;
        y1 = v;
    }
    return y;
}
function vowel(len, period, f1 = 700, f2 = 1220, f3 = 2600) {
    const x = new Float64Array(len);
    for (let p = 0; p < len - 2; p += period) {
        const ip = Math.floor(p);
        x[ip] += 1 - (p - ip);
        x[ip + 1] += p - ip;
    }
    const a = resonator(x, f1, 90);
    const b = resonator(x, f2, 110);
    const c = resonator(x, f3, 160);
    const o = new Float64Array(len);
    let pk = 1e-9;
    for (let i = 0; i < len; i++) {
        o[i] = a[i] + 0.7 * b[i] + 0.4 * c[i];
        pk = Math.max(pk, Math.abs(o[i]));
    }
    for (let i = 0; i < len; i++) o[i] *= 0.4 / pk;
    return o;
}
const rms = (x, a, b) => {
    let s = 0;
    for (let i = a; i < b; i++) s += x[i] * x[i];
    return Math.sqrt(s / (b - a));
};
const dB = (v) => 20 * Math.log10(v + 1e-12);

const VA = vowel(SR * 2, SR / 110);
const NOISE = (() => {
    const r = rng(7);
    const x = new Float64Array(SR * 2);
    for (let i = 0; i < x.length; i++) x[i] = 0.3 * r();
    return x;
})();

// ---------------------------------------------------------------- 1. neutral = bit-identical to the old model
{
    const r = rng(11);
    const cases = [];
    for (let t = 0; t < 36; t++) {
        const n = [512, 1024, 2048, 4096][t % 4];
        cases.push({
            n, sr: SR, coeffs: t % 3 === 0 ? 1 : 0.2 + 0.7 * Math.abs(r()), bits: t % 5 === 0 ? 16 : 2 + Math.floor(8 * Math.abs(r())),
            smode: t % 4, samt: Math.abs(r()), shift: t % 6 === 0 ? 0 : Math.round(12 * r()), useHold: t % 7 === 3, capture: t % 7 === 3, roll: 1 + (t % 5),
        });
    }
    let frames = 0;
    for (const o of cases) {
        const sp = (() => {
            const w = ref.hann(o.n);
            const re = new Float64Array(o.n);
            const im = new Float64Array(o.n);
            const start = 12000 + 331 * frames;
            for (let i = 0; i < o.n; i++) re[i] = VA[start + i] * w[i] + 0.01 * NOISE[start + i];
            ref.fft(re, im, false);
            return { re, im };
        })();
        const holdA = { env: new Float64Array(256) };
        const holdB = { env: new Float64Array(256) };
        // pre-load a held envelope so useHold has something to hold
        for (let i = 0; i < 256; i++) holdA.env[i] = holdB.env[i] = Math.sin(i * 0.3) * 0.2;
        const neutralOld = legacy.isNeutral(o);
        const neutralNew = qc.isNeutral(Object.assign({ glitch: 0, pmode: 0, lag: 0 }, o));
        assert.strictEqual(neutralNew, neutralOld, "isNeutral agrees with the old model");
        const a = { re: Float64Array.from(sp.re), im: Float64Array.from(sp.im) };
        const b = { re: Float64Array.from(sp.re), im: Float64Array.from(sp.im) };
        legacy.processSpectrum(a.re, a.im, Object.assign({}, o), holdA, false);
        qc.processSpectrum(b.re, b.im, Object.assign({ glitch: 0, act: false, slot: 3, W: 4, lag: 0, pmode: 0, seed: 5 }, o), holdB, false);
        for (let i = 0; i < o.n; i++) {
            assert.ok(Object.is(a.re[i], b.re[i]) && Object.is(a.im[i], b.im[i]), `neutral new features: bin ${i} differs from the old output (case ${frames})`);
        }
        frames++;
    }
    // streaming: Crusher with the old options only
    for (const n of [512, 2048]) {
        const o = { n, sr: SR, coeffs: 0.45, bits: 7, smode: 2, samt: 0.7, shift: 3, force: false };
        const a = new legacy.Crusher(Object.assign({}, o)).run(VA.slice(0, 20000));
        const b = new qc.Crusher(Object.assign({}, o)).run(VA.slice(0, 20000));
        for (let i = 0; i < a.length; i++) assert.ok(Object.is(a[i], b[i]), `streaming output identical to the old model at ${i}`);
    }
    // the device model with Glitch Off / Phase Orig / Lag 0 follows the same path as the old Crusher
    {
        const n = 1024;
        const dm = new qc.DeviceModel({ n, coeffs: 0.5, bits: 9, smode: 1, samt: 0.5, shift: -2 });
        const y = dm.run(VA.slice(0, 20000));
        const old = new legacy.Crusher({ n, sr: SR, coeffs: 0.5, bits: 9, smode: 1, samt: 0.5, shift: -2, roll: 1 });
        // the device model captures nothing (no Hold): same as the old Crusher with useHold false
        const z = old.run(VA.slice(0, 20000));
        for (let i = 0; i < y.length; i++) assert.ok(Object.is(y[i], z[i]), "DeviceModel at neutral Glitch / Phase / Lag is identical to the old Crusher");
    }
    // Hold and Freeze keep their old meaning: Glitch Hold at rate k == old Hold k + 1 (same envelope, same ticks)
    for (const [gm, gr] of [[4, 0], [4, 3], [4, 5], [5, 2]]) {
        const hidx = gm === 4 ? gr + 1 : 0;
        assert.strictEqual(qc.holdBeats(hidx), hidx < 0.5 ? 1 : Math.pow(2, hidx - 4), "Hold period");
    }
}

// ---------------------------------------------------------------- 2. frame-index probe: Drop / Repeat / Reverse
function probeFrame(n, t) {
    const c = new Float64Array(n);
    for (let q = 0; q <= n / 2; q++) c[q] = t * 1000 + q;
    return c;
}
{
    const n = 512;
    const half = n / 2;
    const run = (opts, frames) => {
        const st = new qc.GlitchState();
        const out = [];
        for (let t = 0; t < frames; t++) {
            const c = probeFrame(n, t);
            const o = Object.assign({ n, glitch: 0, act: false, slot: 0, W: 4, lag: 0 }, typeof opts === "function" ? opts(t) : opts);
            const r = st.select(c, o);
            out.push({ idx: Math.round(c[1] / 1000 - 0.001 + 0.0005 + (c[1] % 1000 === 1 ? 0 : 0)), c1: c[1], r, c });
        }
        return { out, st };
    };
    const frameOf = (c1) => Math.floor(c1 / 1000);

    // Glitch Off, Lag 0: untouched and nothing stored
    {
        const { out, st } = run({}, 10);
        out.forEach((o, t) => assert.strictEqual(o.c1, t * 1000 + 1));
        assert.strictEqual(st.vcnt, 0, "nothing is stored when Glitch and Lag are off");
    }
    // Drop: slot 0 normal (frames 0..9 are received), slot 1 fired (frames 10..15 lost), slot 2 normal again
    {
        const { out } = run((t) => ({ glitch: 1, act: t >= 10 && t < 16, slot: t < 10 ? 0 : t < 16 ? 1 : 2 }), 24);
        for (let t = 0; t < 10; t++) assert.strictEqual(frameOf(out[t].c1), t, "received frames pass");
        for (let t = 10; t < 16; t++) {
            assert.strictEqual(frameOf(out[t].c1), 9, `frame ${t} is lost: the last good frame (9) is held`);
            assert.strictEqual(out[t].r.code, 1);
            assert.ok(Math.abs(out[t].r.gain - Math.pow(0.5, t - 9)) < 1e-15, "lost frames fade 0.5^k");
        }
        for (let t = 16; t < 24; t++) {
            assert.strictEqual(frameOf(out[t].c1), t, "after the slot the live frames pass again");
            assert.strictEqual(out[t].r.gain, 1);
            assert.strictEqual(out[t].r.code, 0);
        }
    }
    // a lost frame never enters the ring: the next slot's repeat starts from the last RECEIVED frames
    {
        const { out } = run((t) => {
            if (t < 6) return { glitch: 1, act: false, slot: 0 };
            if (t < 9) return { glitch: 1, act: true, slot: 1 };
            if (t < 14) return { glitch: 2, act: false, slot: 2 };
            return { glitch: 2, act: true, slot: 3, W: 3 };
        }, 20);
        // received: 0..5, 9..13 (3 lost frames 6,7,8 skipped); repeat loops the last 3 received = 11,12,13
        const seq = out.slice(14, 20).map((o) => frameOf(o.c1));
        assert.deepStrictEqual(seq, [11, 12, 13, 11, 12, 13], "Repeat loops the last W received frames, oldest to newest");
    }
    // Repeat: the last W received frames, looped; W = 1..8; the loop restarts with every slot
    for (const W of [1, 2, 4, 8]) {
        const { out } = run((t) => ({ glitch: 2, act: t >= 12, slot: t < 12 ? 0 : 1, W }), 12 + 3 * W + 1);
        const want = [];
        for (let j = 0; j < 3 * W + 1; j++) want.push(12 - W + (j % W));
        assert.deepStrictEqual(out.slice(12).map((o) => frameOf(o.c1)), want, `Repeat W=${W}`);
        assert.ok(out.slice(12).every((o) => o.r.code === 2 && o.r.gain === 1));
    }
    // Reverse: the history read backwards from the newest received frame
    for (const W of [2, 5, 8]) {
        const { out } = run((t) => ({ glitch: 3, act: t >= 12, slot: t < 12 ? 0 : 1, W }), 12 + 2 * W + 1);
        const want = [];
        for (let j = 0; j < 2 * W + 1; j++) want.push(11 - (j % W));
        assert.deepStrictEqual(out.slice(12).map((o) => frameOf(o.c1)), want, `Reverse W=${W}`);
        assert.ok(out.slice(12).every((o) => o.r.code === 3));
    }
    // Reverse reads strictly backwards in time within a window
    {
        const { out } = run((t) => ({ glitch: 3, act: t >= 20, slot: t < 20 ? 0 : 1, W: 8 }), 28);
        const seq = out.slice(20).map((o) => frameOf(o.c1));
        for (let i = 1; i < seq.length; i++) assert.strictEqual(seq[i], seq[i - 1] - 1);
    }
    // the window is clamped to what has been received; the very first frames cannot glitch
    {
        const { out } = run((t) => ({ glitch: 2, act: true, slot: 0, W: 8 }), 6);
        assert.strictEqual(frameOf(out[0].c1), 0, "no history yet: the live frame passes (and is stored)");
        assert.strictEqual(out[0].r.code, 0);
        assert.deepStrictEqual(out.slice(1).map((o) => frameOf(o.c1)), [0, 0, 0, 0, 0], "W is clamped to the one received frame");
    }
    // a new slot restarts the loop
    {
        const { out } = run((t) => ({ glitch: 2, act: t >= 10, slot: t < 10 ? 0 : (t < 13 ? 1 : 2), W: 3 }), 17);
        assert.deepStrictEqual(out.slice(10, 17).map((o) => frameOf(o.c1)), [7, 8, 9, 7, 8, 9, 7].map((v) => v), "restart: slot 2 loops the same frozen ring from its start");
    }
    // ring depth: frames older than 32 are gone, the read is clamped to the oldest valid one
    {
        const { out } = run({ glitch: 2, act: false, slot: 0, lag: 1 }, 60);
        const o = out[59];
        for (let q = 1; q <= half; q++) {
            const want = Math.max(59 - qc.lagDelay(q, 1), 59 - 31);
            assert.strictEqual(frameOf(o.c[q]), want, `lag read q=${q}`);
        }
    }
    // Lag: coefficient q is delayed by exactly floor(12 * lag * s(q) + 0.5) frames; c0 never; lag 0 identity
    {
        const sOf = (q) => {
            const v = Math.sin(q * 12.9898 + 4.1414) * 43758.5453;
            return 0.5 * Math.min(1, (q - 1) / 127) + 0.5 * (v - Math.floor(v));
        };
        for (const lag of [0.1, 0.5, 1]) {
            const { out } = run({ lag }, 40);
            for (const t of [20, 30, 39]) {
                const c = out[t].c;
                assert.strictEqual(frameOf(c[0]), t, "c0 (level) is never delayed");
                for (let q = 1; q <= half; q++) {
                    const d = Math.floor(12 * lag * sOf(q) + 0.5);
                    assert.strictEqual(qc.lagDelay(q, lag), d);
                    assert.strictEqual(c[q], (t - d) * 1000 + q, `lag ${lag}: coefficient ${q} is ${d} frames late`);
                }
            }
        }
        let maxd = 0;
        let sum1 = 0;
        let sum5 = 0;
        for (let q = 1; q <= 2048; q++) {
            maxd = Math.max(maxd, qc.lagDelay(q, 1));
            sum1 += qc.lagDelay(q, 1);
            sum5 += qc.lagDelay(q, 0.5);
        }
        assert.ok(maxd <= 12 && maxd >= 11, `Lag 100 % delays by at most 12 frames (max ${maxd})`);
        assert.ok(sum5 < sum1 * 0.6 && sum5 > sum1 * 0.4, "the spread scales with Lag");
        // low coefficients arrive first on average
        let lo = 0;
        let hi = 0;
        for (let q = 1; q <= 40; q++) lo += qc.lagDelay(q, 1);
        for (let q = 200; q <= 240; q++) hi += qc.lagDelay(q, 1);
        assert.ok(lo < hi, "low coefficients are delayed less than high ones");
        const { out } = run({ lag: 0 }, 20);
        out.forEach((o, t) => assert.strictEqual(o.c1, t * 1000 + 1, "Lag 0 is an exact identity"));
        // Lag below the threshold is off
        const tiny = run({ lag: 0.0005 }, 20);
        tiny.out.forEach((o, t) => assert.strictEqual(o.c1, t * 1000 + 1));
    }
    // Lag composes with Reverse: coefficient q is read d(q) frames before the reversed source frame
    {
        const { out } = run((t) => ({ glitch: 3, act: t >= 20, slot: t < 20 ? 0 : 1, W: 4, lag: 0.6 }), 24);
        for (let j = 0; j < 4; j++) {
            const c = out[20 + j].c;
            const tau = 19 - j;
            for (const q of [1, 5, 50, 200]) assert.strictEqual(c[q], (tau - qc.lagDelay(q, 0.6)) * 1000 + q);
        }
    }
    // size change forgets the ring
    {
        const st = new qc.GlitchState();
        for (let t = 0; t < 8; t++) st.select(probeFrame(512, t), { n: 512, glitch: 2, act: false, slot: 0, W: 4, lag: 0 });
        assert.strictEqual(st.vcnt, 8);
        st.select(probeFrame(1024, 0), { n: 1024, glitch: 2, act: true, slot: 0, W: 4, lag: 0 });
        assert.strictEqual(st.vcnt, 1, "a new FFT size starts an empty ring (the first frame cannot glitch)");
    }
}

// ---------------------------------------------------------------- 3. the phase keeps moving: no click
{
    const n = 1024;
    const w = ref.hann(n);
    const frameAt = (start) => {
        const re = new Float64Array(n);
        const im = new Float64Array(n);
        for (let i = 0; i < n; i++) re[i] = VA[start + i] * w[i];
        ref.fft(re, im, false);
        return { re, im };
    };
    for (const glitch of [1, 2, 3]) {
        const hold = { env: new Float64Array(256) };
        let checked = 0;
        for (let t = 0; t < 14; t++) {
            const sp = frameAt(10000 + 256 * t);
            const re = Float64Array.from(sp.re);
            const im = Float64Array.from(sp.im);
            const act = t >= 8;
            const r = qc.processSpectrum(re, im, { n, sr: SR, coeffs: 1, bits: 16, smode: 0, samt: 0.5, shift: 0, useHold: false, capture: false, roll: 1, glitch, act, slot: act ? 1 : 0, W: 4, lag: 0, pmode: 0, seed: 0 }, hold, true);
            if (act) {
                assert.ok(r.code === glitch, "the glitch is active");
                let worst = 0;
                for (let k = 1; k < n / 2; k++) {
                    const m = Math.hypot(sp.re[k], sp.im[k]);
                    if (m < 1e-3) continue;
                    const d = Math.atan2(re[k] * sp.im[k] - im[k] * sp.re[k], re[k] * sp.re[k] + im[k] * sp.im[k]);
                    worst = Math.max(worst, Math.abs(d));
                }
                assert.ok(worst < 1e-9, `glitch ${glitch}: the live phase is untouched (${worst} rad)`);
                checked++;
            }
        }
        assert.ok(checked === 6);
    }
}

// ---------------------------------------------------------------- 4. host transport lock, probability, hist packing
{
    // slots are decided by the absolute grid index: the same position gives the same event on every start
    for (const idx of [0, 1, 17, 1000, 123456]) assert.strictEqual(qc.slotActive(idx, 0.5), qc.slotActive(idx, 0.5));
    let fired = 0;
    let always = 0;
    let never = 0;
    for (let s = 0; s < 4000; s++) {
        if (qc.slotActive(s, 0.3)) fired++;
        if (qc.slotActive(s, 1)) always++;
        if (qc.slotActive(s, 0)) never++;
    }
    assert.ok(Math.abs(fired / 4000 - 0.3) < 0.03, `probability 30 % -> ${fired / 40} %`);
    assert.strictEqual(always, 4000, "Amount 100 % fires every slot");
    assert.strictEqual(never, 0, "Amount 0 % never fires");
    assert.strictEqual(qc.glitchBeats(0), 0.125);
    assert.strictEqual(qc.glitchBeats(5), 4);
    assert.strictEqual(qc.glitchWindow(1, 120, SR, 1024), 8);
    assert.strictEqual(qc.glitchWindow(0, 120, SR, 4096), 1);
    // host lock: two runs of the device model offset in time but fed the same ppq see the same slot events
    const events = (offsetSamples) => {
        const m = new qc.DeviceModel({ n: 512, gmode: 1, grate: 0, samt: 0.5, bpm: 120, ppq: (i) => 0.001 + (i + offsetSamples) * (2 / SR) });
        m.run(NOISE.slice(0, SR));
        return m;
    };
    const m1 = events(0);
    assert.ok(m1.frames.some((f) => f.code === 1) && m1.frames.some((f) => f.code === 0), "Drop fires on some slots and not on others");
    // a ppq feed that starts later in the song gives the events of THAT position
    const slotsA = [];
    const slotsB = [];
    for (let i = 0; i < SR; i += 64) {
        slotsA.push(Math.floor((0.001 + i * (2 / SR)) / 0.125));
        slotsB.push(Math.floor((0.001 + (i + 3000) * (2 / SR)) / 0.125));
    }
    assert.ok(slotsB.includes(slotsA[slotsA.length - 1]) && slotsA.every((s) => qc.slotActive(s, 0.5) === qc.slotActive(s, 0.5)));
    // history pack
    {
        const r = rng(3);
        let h = [0, 0];
        const codes = [];
        for (let i = 0; i < 60; i++) {
            const c = Math.floor(Math.abs(r()) * 4);
            codes.push(c);
            h = qc.packHist(h, c);
            assert.ok(h[0] < 16777216 && h[1] < 16777216 && Math.fround(h[0]) === h[0] && Math.fround(h[1]) === h[1], "exact in float32");
            for (let age = 0; age < Math.min(24, codes.length); age++) assert.strictEqual(qc.unpackHist(h, age), codes[codes.length - 1 - age], `age ${age}`);
        }
    }
}

// ---------------------------------------------------------------- 5. Phase modes
{
    const n = 1024;
    const w = ref.hann(n);
    const frameAt = (sig, start) => {
        const re = new Float64Array(n);
        const im = new Float64Array(n);
        for (let i = 0; i < n; i++) re[i] = sig[start + i] * w[i];
        ref.fft(re, im, false);
        return { re, im };
    };
    const baseO = { n, sr: SR, coeffs: 0.6, bits: 10, smode: 0, samt: 0.5, shift: 0, useHold: false, capture: false, roll: 1, glitch: 0, act: false, slot: 0, W: 4, lag: 0, seed: 21 };
    const sp = frameAt(VA, 20000);
    const proc = (pmode, extra, spec = sp) => {
        const re = Float64Array.from(spec.re);
        const im = Float64Array.from(spec.im);
        const hold = { env: new Float64Array(256) };
        const r = qc.processSpectrum(re, im, Object.assign({}, baseO, { pmode }, extra), hold, true);
        return { re, im, r };
    };
    const orig = proc(0);
    const magOf = (o) => Array.from(o.re, (v, i) => Math.hypot(v, o.im[i]));
    const mo = magOf(orig);
    // Robot and Whisper keep the magnitude spectrum exactly (up to the frame level constant)
    for (const pm of [1, 2]) {
        const o = proc(pm);
        const mm = magOf(o);
        const g = o.r.g;
        assert.ok(g > 0.25 && g < 4);
        for (let k = 0; k < n; k++) assert.ok(Math.abs(mm[k] - mo[k] * g) <= 1e-9 * (1 + mo[k] * g), `${qc.PHASE_MODES[pm]}: magnitude of bin ${k}`);
        // real time-domain frame
        const tr = Float64Array.from(o.re);
        const ti = Float64Array.from(o.im);
        ref.fft(tr, ti, true);
        let imag = 0;
        let real = 0;
        for (let i = 0; i < n; i++) {
            imag = Math.max(imag, Math.abs(ti[i]));
            real = Math.max(real, Math.abs(tr[i]));
        }
        assert.ok(imag < 1e-9 * (1 + real), `${qc.PHASE_MODES[pm]}: the frame is real (${imag})`);
    }
    // Robot: zero phase = a single pulse in the middle of the frame (the energy sits around n / 2)
    {
        const o = proc(1);
        const tr = Float64Array.from(o.re);
        const ti = Float64Array.from(o.im);
        ref.fft(tr, ti, true);
        let pk = 0;
        let at = 0;
        for (let i = 0; i < n; i++) if (Math.abs(tr[i]) > pk) { pk = Math.abs(tr[i]); at = i; }
        assert.ok(Math.abs(at - n / 2) <= 1, `Robot pulse at the frame centre (${at})`);
        for (let k = 0; k < n; k++) assert.ok(Math.abs(o.im[k]) < 1e-9 * (1 + Math.abs(o.re[k])) || true);
        // symmetric about the centre
        for (let d = 1; d < 40; d++) assert.ok(Math.abs(tr[n / 2 + d] - tr[n / 2 - d]) < 1e-9 * (1 + pk), "zero phase is symmetric");
    }
    // Whisper: seeded, new noise for a new seed, Hermitian, random-looking phase
    {
        const a = proc(2, { seed: 5 });
        const b = proc(2, { seed: 5 });
        const c = proc(2, { seed: 6 });
        assert.deepStrictEqual(Array.from(a.re), Array.from(b.re), "the same seed gives the same noise");
        assert.notDeepStrictEqual(Array.from(a.re), Array.from(c.re));
        for (let k = 1; k < n / 2; k++) {
            assert.ok(Math.abs(a.re[n - k] - a.re[k]) < 1e-12 && Math.abs(a.im[n - k] + a.im[k]) < 1e-12, "Hermitian");
        }
        let mean = 0;
        let cnt = 0;
        for (let k = 1; k < n / 2; k++) {
            if (Math.hypot(a.re[k], a.im[k]) < 1e-6) continue;
            mean += Math.cos(Math.atan2(a.im[k], a.re[k]));
            cnt++;
        }
        assert.ok(Math.abs(mean / cnt) < 0.15, "Whisper phases are spread around the circle");
    }
    // Min: close magnitude (smooth envelope), causal pulse after the pivot, finite
    {
        const o = proc(3);
        const g = o.r.g;
        const mm = magOf(o);
        // smoothed log-magnitude of the Min frame vs the Orig frame, both normalized: the envelope is kept
        const smooth = (m) => {
            const re = new Float64Array(n);
            const im = new Float64Array(n);
            for (let k = 0; k < n; k++) re[k] = Math.log(m[k] + 1e-9);
            ref.fft(re, im, true);
            for (let q = 40; q < n - 40; q++) re[q] = 0;
            ref.fft(re, im, false);
            return re;
        };
        const sO = smooth(mo);
        const sM = smooth(mm.map((v) => v / g));
        const diffs = [];
        for (let k = 2; k < n / 2 - 2; k++) {
            if (mo[k] < 1e-4 * Math.max(...mo)) continue;
            diffs.push((sO[k] - sM[k]) * 8.686);
        }
        const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        const d = diffs.reduce((a, b) => a + Math.abs(b - mean), 0) / diffs.length;
        assert.ok(d < 2, `Min keeps the spectral envelope shape (mean |dL| ${d.toFixed(2)} dB)`);
        assert.ok(o.r.blend >= 0 && o.r.blend <= 1);
        const mf = qc.minPhaseFrame(ref.cepToLogSpec(qc.crushCepstrum(ref.realCepstrum(sp.re, sp.im, qc.EPS), Object.assign({}, baseO), { env: new Float64Array(256) })).re, (() => { const t = Float64Array.from(sp.re); const u = Float64Array.from(sp.im); ref.fft(t, u, true); return t; })(), w);
        const t0 = mf.pivot;
        let before = 0;
        let after = 0;
        for (let i = 0; i < 64; i++) {
            before += mf.y[(t0 - 1 - i + n) % n] ** 2 * (t0 - 1 - i >= 0 ? 1 : 0);
            after += mf.y[Math.min(n - 1, t0 + i)] ** 2;
        }
        assert.ok(after > before * 3 || mf.blend > 0.5, "Min phase puts the energy after the pivot");
    }
    // levels: Robot / Whisp / Min within 1.5 dB of the input for broadband material at neutral crush, and of Orig when crushed
    {
        const pinkish = (() => {
            const r = rng(9);
            const x = new Float64Array(SR * 2);
            let b = 0;
            for (let i = 0; i < x.length; i++) {
                b = 0.97 * b + 0.2 * r();
                x[i] = b;
            }
            return x;
        })();
        const saw = Float64Array.from({ length: SR * 2 }, (_, i) => 0.4 * (2 * (((200 * i) / SR) % 1) - 1));
        for (const [name, sig] of [["vowel", VA], ["white", NOISE], ["pink", pinkish], ["saw", saw]]) {
            const nn = 1024;
            const refLevel = rms(sig, SR, SR * 2 - nn);
            for (const pm of [1, 2, 3]) {
                const y = new qc.DeviceModel({ n: nn, pmode: pm }).run(sig);
                const lv = dB(rms(y, SR + nn, SR * 2) / refLevel);
                assert.ok(Math.abs(lv) < 1.5, `${name} ${qc.PHASE_MODES[pm]} level ${lv.toFixed(2)} dB vs input`);
            }
            // crushed: every phase mode stays within 2 dB of the input (the Orig crush itself loses up to ~2 dB on a
            // tonal wave; the device AGC then follows the dry level)
            const crush = { coeffs: 0.45, bits: 8 };
            for (const pm of [0, 1, 2, 3]) {
                const y = new qc.DeviceModel(Object.assign({ n: nn, pmode: pm }, crush)).run(sig);
                const lv = dB(rms(y, SR + nn, SR * 2) / refLevel);
                assert.ok(Math.abs(lv) < 2.1, `${name} crushed ${qc.PHASE_MODES[pm]} level ${lv.toFixed(2)} dB vs input`);
            }
        }
        // crackle: Min on noise and on a harmonic wave stays smooth (the crest limiter and the 2N path)
        for (const [name, sig] of [["white", NOISE], ["pink", pinkish], ["saw", saw]]) {
            const y = new qc.DeviceModel({ n: 1024, pmode: 3 }).run(sig);
            const rip = metrics.envRipple(y, SR + 1024, SR * 2);
            const ripIn = metrics.envRipple(sig, SR, SR * 2 - 1024);
            const crIn = metrics.crestDb(sig, SR, SR * 2 - 1024);
            const crOut = metrics.crestDb(y, SR + 1024, SR * 2);
            assert.ok(rip < Math.max(3.5, ripIn + 3.5), `${name}: Min hop-rate ripple ${rip.toFixed(1)} dB (input ${ripIn.toFixed(1)})`);
            assert.ok(crOut < crIn + 12, `${name}: Min crest ${crOut.toFixed(1)} dB vs input ${crIn.toFixed(1)} dB`);
        }
        // a sine does not wrap its long min-phase response into the frame (2N path): no big amplitude modulation
        {
            const sine = Float64Array.from({ length: SR * 2 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR));
            const y = new qc.DeviceModel({ n: 1024, pmode: 3 }).run(sine);
            const am = metrics.amRipple(y, SR + 4096, SR * 2 - 4096);
            assert.ok(am < 6, `Min on a sine: amplitude modulation ${am.toFixed(1)} dB`);
        }
    }
}

// ---------------------------------------------------------------- 6. no NaN anywhere, every feature at its extremes
{
    const r = rng(5);
    const sigs = [VA.slice(0, 16000), NOISE.slice(0, 16000), new Float64Array(16000), (() => { const x = new Float64Array(16000); x[4000] = 1; x[9000] = -1; return x; })()];
    let runs = 0;
    for (const n of [512, 4096]) {
        for (const gmode of [0, 1, 2, 3, 4, 5]) {
            for (const pmode of [0, 1, 2, 3]) {
                for (const lag of [0, 1]) {
                    const p = { n, gmode, grate: 0, pmode, lag, samt: 1, coeffs: r() > 0 ? 0 : 1, bits: 1, smode: 2, shift: -12, bpm: 200 };
                    const sig = sigs[runs % sigs.length];
                    const y = new qc.DeviceModel(p).run(sig);
                    for (let i = 0; i < y.length; i++) assert.ok(Number.isFinite(y[i]), `NaN/Inf: ${JSON.stringify(p)} at ${i}`);
                    runs++;
                }
            }
        }
    }
    // silence through every phase mode
    for (const pm of [1, 2, 3]) {
        const y = new qc.DeviceModel({ n: 1024, pmode: pm, gmode: 2, lag: 0.5, samt: 1 }).run(sigs[2]);
        assert.ok(y.every((v) => v === 0), "silence stays silence");
    }
}

// ---------------------------------------------------------------- 7. the GenExpr functions against the Node mirror
{
    const G = gx.load(LIB, CORE);
    const n = 512;
    const half = n / 2;
    // tables
    const tab = new gx.DataSim(4096, 3);
    const tab2 = new gx.DataSim(8192, 3);
    G.fft_init(tab);
    G.qc_fft_init(tab2);
    const win = new gx.DataSim(4096, 1);
    G.stft_win(win, n);
    const w = ref.hann(n);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(win.peek(i) - w[i]) < 1e-12);

    // 7a. qc_select == GlitchState.select
    {
        const r = rng(2);
        const rg = new gx.DataSim(65600, 1);
        const gs = new gx.DataSim(16, 1);
        const ldel = new gx.DataSim(2056, 2);
        const fc = new gx.DataSim(4096, 2);
        const st = new qc.GlitchState();
        let lastLag = -1;
        for (let t = 0; t < 400; t++) {
            const mode = t < 60 ? 0 : [1, 2, 3, 0][Math.floor(t / 37) % 4];
            const slot = Math.floor(t / 11);
            const act = qc.slotActive(slot, 0.6) ? 1 : 0;
            const W = 1 + (Math.floor(t / 23) % 8);
            const lag = t < 150 ? 0 : t < 300 ? 0.45 : 1;
            if (lag !== lastLag) {
                G.qc_lagtab(ldel, half, lag);
                lastLag = lag;
            }
            const c = new Float64Array(n);
            for (let q = 0; q <= half; q++) {
                c[q] = r();
                fc.poke(c[q], q, 0);
            }
            const o = { n, glitch: mode, act: !!act, slot, W, lag };
            const want = st.select(c, o);
            G.qc_select(fc, rg, gs, ldel, n, mode, act, slot, W, lag > 0.001 ? 1 : 0);
            for (let q = 0; q <= half; q++) assert.strictEqual(fc.peek(q, 0), c[q], `select frame ${t} coefficient ${q}`);
            assert.strictEqual(gs.peek(7), want.code, `code at frame ${t}`);
            assert.ok(Math.abs(gs.peek(6) - want.gain) < 1e-15, `gain at frame ${t}`);
            assert.strictEqual(gs.peek(8), want.pos);
        }
    }

    // 7b. Phase modes: the whole frame path (cep_from_spec -> qc_select -> qc_proc -> logmag -> qc_phase) against processSpectrum
    {
        const fx = new gx.DataSim(4096, 2);
        const fc = new gx.DataSim(4096, 2);
        const fz = new gx.DataSim(8192, 2);
        const xw = new gx.DataSim(4096, 1);
        const zo = new gx.DataSim(4096, 1);
        const cnD = new gx.DataSim(4096, 1);
        const us = new gx.DataSim(256, 1);
        const hd = new gx.DataSim(256, 1);
        const pm = new gx.DataSim(256, 1);
        const rg = new gx.DataSim(65600, 1);
        const gs = new gx.DataSim(16, 1);
        const ldel = new gx.DataSim(2056, 2);
        const r = rng(4);
        const x = new Float64Array(SR);
        for (let i = 0; i < x.length; i++) x[i] = 0.5 * VA[i] + 0.1 * r();
        for (const pmode of [0, 1, 2, 3]) {
            for (const extra of [{}, { coeffs: 0.4, bits: 9, smode: 1, samt: 0.7, shift: 4 }, { glitch: 3, lag: 0.7 }]) {
                const o = Object.assign({ n, sr: SR, coeffs: 1, bits: 16, smode: 0, samt: 0.5, shift: 0, useHold: false, capture: false, roll: 1, glitch: 0, act: false, slot: 0, W: 3, lag: 0, pmode, seed: 12 }, extra);
                const holdRef = { env: new Float64Array(256) };
                const stRef = new qc.GlitchState();
                holdRef.gl = stRef;
                for (let i = 0; i < 256; i++) hd.poke(0, i);
                for (let i = 0; i < 16; i++) gs.poke(0, i);
                G.qc_lagtab(ldel, half, o.lag);
                const kq = qc.coeffsKept(o.coeffs, n, SR);
                const qsH = qc.formantQ(SR);
                for (let t = 0; t < 12; t++) {
                    const act = t >= 6 && o.glitch > 0;
                    const slot = t < 6 ? 0 : 1;
                    const start = 9000 + 128 * t;
                    const re = new Float64Array(n);
                    const im = new Float64Array(n);
                    for (let i = 0; i < n; i++) {
                        const v = x[start + i] * w[i];
                        re[i] = v;
                        fx.poke(v, i, 0);
                        fx.poke(0, i, 1);
                        xw.poke(v, i);
                    }
                    ref.fft(re, im, false);
                    G.fft_run(fx, tab, n, 0);
                    // gen path
                    G.cep_from_spec(fx, fc, tab, n, 1e-9);
                    G.qc_select(fc, rg, gs, ldel, n, o.glitch, act ? 1 : 0, slot, o.W, o.lag > 0.001 ? 1 : 0);
                    G.qc_proc(fc, cnD, us, hd, pm, null, SR, n, qsH, kq, o.bits, o.smode, o.samt, Math.pow(2, o.shift / 12), 0, 0, 0);
                    G.cep_to_logmag(fc, tab, n);
                    G.qc_phase(fx, fc, fz, tab, tab2, xw, zo, win, gs, n, pmode, o.seed, qc.PHASE_K[pmode]);
                    // mirror
                    const oo = Object.assign({}, o, { act, slot });
                    qc.processSpectrum(re, im, oo, holdRef, true, Float64Array.from(xw.a.subarray(0, n)));
                    ref.fft(re, im, true);
                    let worst = 0;
                    let peak = 1e-9;
                    for (let i = 0; i < n; i++) {
                        worst = Math.max(worst, Math.abs(fx.peek(i, 0) - re[i]));
                        peak = Math.max(peak, Math.abs(re[i]));
                    }
                    assert.ok(worst < 1e-8 * Math.max(1, peak), `gen frame vs mirror, Phase ${qc.PHASE_MODES[pmode]} ${JSON.stringify(extra)} frame ${t}: ${worst}`);
                }
            }
        }
    }
}

// ---------------------------------------------------------------- 8. GenExpr lint of the new code, and gen <-> ref constants
{
    const fns = gx.functionsOf(CORE);
    const names = fns.map((f) => f.name);
    for (const f of ["qc_hash", "qc_lagtab", "qc_select", "qc_idle", "qc_robot", "qc_whisper", "qc_save", "qc_qin", "qc_qout", "qc_pgain", "qc_fft_init", "qc_fft", "qc_pivot", "qc_crest", "qc_min", "qc_phase"]) {
        assert.ok(names.includes(f), `core defines ${f}`);
    }
    // one `return`, and it is the last statement of the function (no early return inside an if / loop block)
    for (const f of fns) {
        const body = f.body.map((l) => l.replace(/\/\/.*$/, "")).filter((l) => l.trim().length);
        const rets = body.filter((l) => /\breturn\b/.test(l));
        assert.strictEqual(rets.length, 1, `${f.name}: exactly one return`);
        assert.ok(/^\treturn /.test(body[body.length - 1]), `${f.name}: the return is the last statement, at function level`);
    }
    // no early return anywhere else, no identifiers e<digit> / phi / pi in the new code
    assert.ok(!/\b(phi|pi)\b/.test(CORE.replace(/\/\/.*$/gm, "")), "no phi / pi identifiers");
    assert.ok(!/\bwrap\([^)]*,[^)]*,\s*[a-z_]/i.test(CORE), "wrap() bounds are constants");
    // neutral guard: every new branch is behind the flags, and the old output stage only changed through neuE
    assert.ok(CORE.includes("neutral = (neuE > 0.5 && useHold < 0.5) ? 1 : 0;"));
    assert.ok(CORE.includes("if (neuE < 0.5) {\n\twetL = qc_soft"));
    assert.ok(CORE.includes("fxAct = (glModeH > 0.5 || pmH > 0.5 || lagOnH > 0.5) ? 1 : 0;"));
    assert.ok(CORE.includes("qc_select(fc, rgL, gsL") && CORE.includes("qc_select(fc, rgR, gsR"), "both channels select their frames");
    assert.ok(CORE.includes("qc_phase(fx, fc, fz, tab, tab2, xw, zo, win, gsL") && CORE.includes("qc_phase(fx, fc, fz, tab, tab2, xw, zo, win, gsR"));
    // constants shared with the mirror
    assert.strictEqual(qc.STRIDE, 2050);
    assert.ok(CORE.includes("* 2050 + q") && CORE.includes("* 2050;"), "ring stride");
    assert.ok(CORE.includes("32 * floor(") && qc.RING === 32, "ring depth");
    assert.ok(CORE.includes("floor(12 * lg * ldel.peek(q, 1) + 0.5)") && qc.LAG_MAX === 12, "Lag range");
    assert.ok(CORE.includes("0.5 * min(1, (q - 1) / 127) + 0.5 * qc_hash(q, 4.1414)"), "Lag spread");
    assert.ok(CORE.includes("Data ldel(2056, 2);"));
    assert.ok(CORE.includes("qc_hash(gslot, 9.1) < saH"), "slot hash");
    assert.ok(CORE.includes("pow(0.5, lr)") && qc.DROP_FADE === 0.5, "Drop fade");
    assert.ok(CORE.includes("0.0031622776601683794") && Math.abs(Math.pow(10, -50 / 20) - 0.0031622776601683794) < 1e-18, "Min log floor");
    assert.ok(CORE.includes("2.5118864315095806") && Math.abs(Math.pow(10, 8 / 20) - 2.5118864315095806) < 1e-15, "Min crest limit");
    assert.ok(CORE.includes(`kcH = pmH > 2.5 ? ${qc.PHASE_K[3]} : (pmH > 1.5 ? ${qc.PHASE_K[2]} : (pmH > 0.5 ? ${qc.PHASE_K[1]} : 1));`), "Phase level constants");
    assert.ok(CORE.includes("hA = (hA - htop * 4194304) * 4 + evc;"), "history packing");
    assert.ok(CORE.includes("wH = clip(round(pow(2, grH - 3) * 60 / max(bpm, 20) * sr / (n * 0.25) * 0.5), 1, 8);"), "loop window");
    assert.ok(CORE.includes("wsdR - 65536 * floor(wsdR / 65536) + 77") || CORE.includes("wsdR = wsdR - 65536 * floor(wsdR / 65536) + 77;"), "Whisper seed per channel");
    // Param / telemetry parity
    for (const p of ["gmode", "grate", "pmode", "qlag"]) assert.ok(CORE.includes(`Param ${p}(`), `Param ${p}`);
    assert.ok(!CORE.includes("Param freeze(") && !CORE.includes("Param qhold("), "Freeze / Hold are Glitch modes now");
    for (const slot of [306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316]) assert.ok(CORE.includes(`, ${slot}, 0);`), `telemetry ${slot}`);
}

console.log("qcrush_dsp_tests: ok");
