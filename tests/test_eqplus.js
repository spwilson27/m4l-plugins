#!/usr/bin/env node
/**
 * Verification suite for devices/EQ+.amxd (378 x 169 — drawable eight-band EQ).
 * 18 px of that width is the always-visible sidechain tab.
 *
 *  1. Biquad math in src/eqplus_config.js: all 13 modes, shift, Adaptive-Q, gesture zones
 *  2. GenExpr lexer / ordering (no e0..e9, no return inside a block)
 *  3. .amxd header, 169 px presentation, hidden live.* parameters, --- buffers, wiring
 *  4. v8ui gestures in a mock Max environment (create, drag, wheel, double-click, analyzers, blob)
 *  5. Bidirectional sync with scripts/build_eqplus.py: route selectors out, inlets in, coeff buffer
 *  6. Hover cursor: shelf and cut zones hide the OS cursor and paint a fixed glyph; Bell, the Q handle, nodes and bars keep it
 *  7. Selected-band bottom bar (solo, power, freq/gain/Q, Q handle) and the filters / analyzer shelves
 *  8. Q-handle and shelf/cut cursor orientation, FFT floor gating, marquee multi-select, sidechain fold and reference curve
 *
 * Build first: python3 scripts/build_eqplus.py
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { minifyGen } = require("./minify_gen.js");

const ROOT = path.resolve(__dirname, "..");
const AMXD_PATH = path.join(ROOT, "devices", "EQ+.amxd");
const CONFIG_PATH = path.join(ROOT, "src", "eqplus_config.js");
const UI_PATH = path.join(ROOT, "src", "eqplus_ui.js");
const GEN_PATH = path.join(ROOT, "src", "eqplus_core.genexpr");

const cfg = require(CONFIG_PATH);

let checks = 0;
function ok(cond, msg) {
    checks++;
    assert.ok(cond, msg);
}
function eq(a, b, msg) {
    checks++;
    assert.strictEqual(a, b, msg);
}
function near(a, b, tol, msg) {
    checks++;
    assert.ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, expected ${b} +/- ${tol})`);
}
function deep(a, b, msg) {
    checks++;
    assert.deepStrictEqual(a, b, msg);
}

const SR = 48000;
const MODES = [
    "Off",
    "Low-Cut 1", "Low-Cut 2", "Low-Cut 4", "Low-Cut 8",
    "Low-Shelf", "Bell", "Notch", "High-Shelf",
    "High-Cut 1", "High-Cut 2", "High-Cut 4", "High-Cut 8",
];

// ---------------------------------------------------------------------------------------------
// 1. Config contract and filter response
// ---------------------------------------------------------------------------------------------
eq(cfg.EQP_NUM_BANDS, 8, "8 bands");
eq(cfg.EQP_FREQ_MIN, 20, "freq min");
eq(cfg.EQP_FREQ_MAX, 20000, "freq max");
eq(cfg.EQP_GAIN_MIN, -36, "gain min");
eq(cfg.EQP_GAIN_MAX, 36, "gain max");
eq(cfg.EQP_Q_MIN, 0.1, "Q min");
eq(cfg.EQP_Q_MAX, 40, "Q max");
near(cfg.EQP_Q_DEFAULT, 0.7071, 1e-9, "default Q");
eq(cfg.EQP_SHIFT_MIN, -64, "shift min");
eq(cfg.EQP_SHIFT_MAX, 64, "shift max");
eq(cfg.EQP_OUTGAIN_MIN, -24, "output gain min");
eq(cfg.EQP_OUTGAIN_MAX, 24, "output gain max");
deep(cfg.EQP_RANGES, [12, 24, 36], "display ranges");
deep(cfg.EQP_RESOLUTIONS, ["Small", "Medium", "Large", "Huge"], "resolution names");
deep(cfg.EQP_FFT_SIZES, [1024, 2048, 4096, 8192], "FFT sizes");
deep(cfg.EQP_SPEEDS, ["Fast", "Medium", "Slow", "Freeze"], "speed names");
deep(cfg.EQP_TILTS, [0, 3, 4.5, 6], "tilt amounts");
deep(cfg.EQP_MODES, MODES, "13 filter modes");
deep(cfg.EQP_DEFAULT_BAND_FREQS, [60, 125, 250, 500, 1000, 2000, 4000, 8000], "default band frequencies");
eq(cfg.EQP_CFG_STRIDE, 8, "config stride");
eq(cfg.EQP_CFG_SIZE, 128, "config buffer holds both curves");
eq(cfg.EQP_SPEC_RING, 8192, "spectrum ring");
eq(cfg.EQP_SPEC_BUF_FRAMES, 8200, "spectrum buffer frames");
deep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(cfg.eqpModePoles), [0, 1, 1, 2, 4, 1, 1, 1, 1, 1, 1, 2, 4], "cascaded section counts");
for (let mode = 0; mode <= 12; mode++) {
    eq(cfg.eqpBandUsesGain(mode), mode === 5 || mode === 6 || mode === 8, `${MODES[mode]} gain axis`);
}

for (const n of [0, 0.25, 0.5, 0.75, 1]) {
    near(cfg.eqpFreqToNorm(cfg.eqpNormToFreq(n)), n, 1e-9, `freq norm round trip ${n}`);
    near(cfg.eqpDbToNorm(cfg.eqpNormToDb(n, 20), 20), n, 1e-9, `dB norm round trip ${n}`);
    near(cfg.eqpQToNorm(cfg.eqpNormToQ(n)), n, 1e-9, `Q norm round trip ${n}`);
}
near(cfg.eqpNormToFreq(0), 20, 1e-6, "norm 0 is 20 Hz");
near(cfg.eqpNormToFreq(1), 20000, 1e-2, "norm 1 is 20 kHz");
near(cfg.eqpNormToDb(0, 10), -10, 1e-9, "bottom of \u00b110");
near(cfg.eqpNormToDb(0.5, 30), 0, 1e-9, "center is 0 dB");
near(cfg.eqpNormToDb(1, 30), 30, 1e-9, "top of \u00b130");
near(cfg.eqpNormToQ(0), 0.1, 1e-9, "Q norm 0");
near(cfg.eqpNormToQ(1), 40, 1e-6, "Q norm 1");
near(cfg.eqpEffectiveFreq(500, 12), 1000, 1e-6, "+12 st doubles frequency");
near(cfg.eqpEffectiveFreq(1000, -12), 500, 1e-6, "-12 st halves frequency");
near(cfg.eqpEffectiveFreq(18000, 12), 20000, 1e-4, "shift clamps at 20 kHz");
near(cfg.eqpEffectiveFreq(30, -36), 20, 1e-6, "shift clamps at 20 Hz");
near(cfg.eqpEffectiveFreq(1000, 64), 20000, 1e-4, "shift +64 clamps at 20 kHz");
near(cfg.eqpEffectiveFreq(50, -64), 20, 1e-4, "shift -64 clamps at 20 Hz");

near(cfg.eqpEffectiveQ(1.5, 12, 1, 6), 3, 1e-9, "Adaptive-Q doubles Q at +12 dB");
near(cfg.eqpEffectiveQ(1.5, -12, 1, 6), 3, 1e-9, "Adaptive-Q uses |gain|");
near(cfg.eqpEffectiveQ(1.5, 24, 1, 6), 6, 1e-6, "Adaptive-Q quadruples Q at +24 dB");
near(cfg.eqpEffectiveQ(1.5, 0, 1, 6), 1.5, 1e-9, "Adaptive-Q at 0 dB leaves Q");
near(cfg.eqpEffectiveQ(1.5, 12, 0, 6), 1.5, 1e-9, "Adaptive-Q off leaves Q");
near(cfg.eqpEffectiveQ(1.5, 12, false, 6), 1.5, 1e-9, "Adaptive-Q false leaves Q");
near(cfg.eqpEffectiveQ(1.5, 12, 1, 5), 1.5, 1e-9, "shelves do not adapt Q");
near(cfg.eqpEffectiveQ(1.5, 12, 1, 7), 1.5, 1e-9, "notch does not adapt Q");
eq(cfg.eqpEffectiveQ(30, 24, 1, 6), 40, "Adaptive-Q clamps at 40");

function nearRgb(c, rgb, msg) {
    near(c[0], rgb[0], 0.03, msg + " r");
    near(c[1], rgb[1], 0.03, msg + " g");
    near(c[2], rgb[2], 0.03, msg + " b");
}
nearRgb(cfg.eqpRainbowColor(0), [0.88, 0.22, 0.20], "rainbow 20 Hz");
nearRgb(cfg.eqpRainbowColor(0.5), [0.25, 0.90, 0.35], "rainbow mid");
nearRgb(cfg.eqpRainbowColor(1), [0.88, 0.88, 0.92], "rainbow 20 kHz");

function magDb(c, f) {
    const w = 2 * Math.PI * f / SR;
    const m2 = cfg.eqpBiquadMagSq(c.b0, c.b1, c.b2, c.a1, c.a2, w);
    ok(Number.isFinite(m2) && m2 >= 0, `magnitude at ${f} Hz is finite`);
    return 10 * Math.log10(Math.max(m2, 1e-24));
}
function repeatedDb(mode, freq, gain, q, f) {
    const c = cfg.eqpBiquadCoeffs(mode, freq, gain, q, SR);
    const n = c.sections > 0 ? c.sections : 1;
    return { db: magDb(c, f) * n, sections: c.sections };
}
function df2tDb(c, sections, freq) {
    const nSec = sections > 0 ? sections : 1;
    const state = [];
    for (let s = 0; s < nSec; s++) state.push({ s1: 0, s2: 0 });
    const n = Math.round(SR * 0.2);
    const skip = Math.round(SR * 0.05);
    const w = 2 * Math.PI * freq / SR;
    let sumIn = 0;
    let sumOut = 0;
    for (let i = 0; i < n; i++) {
        let x = Math.sin(w * i);
        for (let s = 0; s < nSec; s++) {
            const st = state[s];
            const y = c.b0 * x + st.s1;
            const s1n = c.b1 * x - c.a1 * y + st.s2;
            const s2n = c.b2 * x - c.a2 * y;
            st.s1 = s1n;
            st.s2 = s2n;
            x = y;
        }
        if (i >= skip) {
            const inn = Math.sin(w * i);
            sumIn += inn * inn;
            sumOut += x * x;
        }
    }
    return 10 * Math.log10(sumOut / Math.max(sumIn, 1e-24));
}
{
    const bellC = cfg.eqpBiquadCoeffs(6, 1000, 12, 0.7071, SR);
    near(df2tDb(bellC, bellC.sections, 1000), magDb(bellC, 1000) * bellC.sections, 0.15, "DF2T bell matches the magnitude formula");
    const notchC = cfg.eqpBiquadCoeffs(7, 1000, 0, 0.7071, SR);
    const notchDb = df2tDb(notchC, notchC.sections, 1000);
    ok(notchDb < -40, "DF2T notch at its centre is below -40 dB (" + notchDb.toFixed(1) + ")");
    const cutC = cfg.eqpBiquadCoeffs(3, 1000, 0, 0.7071, SR);
    near(df2tDb(cutC, cutC.sections, 200), magDb(cutC, 200) * cutC.sections, 0.25, "DF2T low-cut matches the magnitude formula");
    near(df2tDb(cutC, cutC.sections, 5000), magDb(cutC, 5000) * cutC.sections, 0.25, "DF2T low-cut passband matches the magnitude formula");
}
function nearResponse(actual, expected, tol, msg) {
    if (expected < -40 && actual < -40) {
        ok(actual < -40, msg);
        return;
    }
    near(actual, expected, tol, msg);
}

{
    const bell = { enabled: 1, mode: 6, freq: 1000, gain: 12, q: 0.7071 };
    near(cfg.eqpBandResponseDb(bell, 1000, SR, 0, 0), 12, 0.05, "bell +12 dB at 1 kHz");
    near(cfg.eqpBandResponseDb(bell, 20, SR, 0, 0), 0, 0.4, "bell is ~0 dB at 20 Hz");
    near(cfg.eqpBandResponseDb(bell, 23900, SR, 0, 0), 0, 0.4, "bell is ~0 dB near Nyquist");
    const cut = { enabled: 1, mode: 6, freq: 1000, gain: -12, q: 0.7071 };
    near(cfg.eqpBandResponseDb(cut, 1000, SR, 0, 0), -12, 0.05, "bell -12 dB at 1 kHz");
    const wide = { enabled: 1, mode: 6, freq: 1000, gain: 12, q: 1 };
    const offPeak = cfg.eqpBandResponseDb(wide, 1400, SR, 0, 0);
    const adapted = cfg.eqpBandResponseDb(wide, 1400, SR, 0, 1);
    ok(adapted < offPeak, `Adaptive-Q narrows the bell (${adapted} dB vs ${offPeak} dB at 1.4 kHz)`);
    near(cfg.eqpBandResponseDb(wide, 1000, SR, 0, 1), 12, 0.05, "adapted bell still peaks at +12 dB");
}
{
    const notch = { enabled: 1, mode: 7, freq: 1000, gain: 0, q: 2 };
    const depth = cfg.eqpBandResponseDb(notch, 1000, SR, 0, 0);
    ok(depth < -30, `notch at 1 kHz is deep (${depth} dB)`);
    near(cfg.eqpBandResponseDb(notch, 50, SR, 0, 0), 0, 1, "notch is ~0 dB at 50 Hz");
    near(cfg.eqpBandResponseDb(notch, 15000, SR, 0, 0), 0, 1, "notch is ~0 dB at 15 kHz");
}
{
    const at500 = {};
    for (const mode of [1, 2, 3, 4]) {
        const band = { enabled: 1, mode, freq: 1000, gain: 0, q: 0.7071 };
        at500[mode] = cfg.eqpBandResponseDb(band, 500, SR, 0, 0);
        near(cfg.eqpBandResponseDb(band, 10000, SR, 0, 0), 0, 0.6, `${MODES[mode]} is ~0 dB at 10 kHz`);
        ok(at500[mode] < -2, `${MODES[mode]} at 500 Hz is below -2 dB (${at500[mode]})`);
    }
    ok(at500[4] < at500[3] && at500[3] < at500[2] && at500[2] < at500[1],
        `Low-Cut steepens with pole count at 500 Hz (${[1, 2, 3, 4].map((m) => at500[m].toFixed(2)).join(" < ")})`);
}
{
    const at2k = {};
    for (const mode of [9, 10, 11, 12]) {
        const band = { enabled: 1, mode, freq: 1000, gain: 0, q: 0.7071 };
        at2k[mode] = cfg.eqpBandResponseDb(band, 2000, SR, 0, 0);
        near(cfg.eqpBandResponseDb(band, 100, SR, 0, 0), 0, 0.6, `${MODES[mode]} is ~0 dB at 100 Hz`);
        ok(at2k[mode] < -2, `${MODES[mode]} at 2 kHz is below -2 dB (${at2k[mode]})`);
    }
    ok(at2k[12] < at2k[11] && at2k[11] < at2k[10] && at2k[10] < at2k[9],
        `High-Cut steepens with pole count at 2 kHz (${[9, 10, 11, 12].map((m) => at2k[m].toFixed(2)).join(" < ")})`);
}
{
    const shelf = (mode, gain) => ({ enabled: 1, mode, freq: 1000, gain, q: 0.7071 });
    near(cfg.eqpBandResponseDb(shelf(5, 6), 30, SR, 0, 0), 6, 0.35, "low shelf +6 dB at 30 Hz");
    near(cfg.eqpBandResponseDb(shelf(5, 6), 15000, SR, 0, 0), 0, 0.35, "low shelf +6 dB is ~0 at 15 kHz");
    near(cfg.eqpBandResponseDb(shelf(5, -6), 30, SR, 0, 0), -6, 0.35, "low shelf -6 dB at 30 Hz");
    near(cfg.eqpBandResponseDb(shelf(8, 6), 15000, SR, 0, 0), 6, 0.35, "high shelf +6 dB at 15 kHz");
    near(cfg.eqpBandResponseDb(shelf(8, 6), 40, SR, 0, 0), 0, 0.35, "high shelf +6 dB is ~0 at 40 Hz");
    near(cfg.eqpBandResponseDb(shelf(8, -6), 15000, SR, 0, 0), -6, 0.35, "high shelf -6 dB at 15 kHz");
}
{
    const up = { enabled: 1, mode: 6, freq: 500, gain: 12, q: 8 };
    near(cfg.eqpBandResponseDb(up, 1000, SR, 12, 0), 12, 0.05, "+12 st moves a 500 Hz bell to 1 kHz");
    ok(cfg.eqpBandResponseDb(up, 500, SR, 12, 0) < 6, "+12 st bell is no longer peaked at 500 Hz");
    const down = { enabled: 1, mode: 6, freq: 1000, gain: 12, q: 8 };
    near(cfg.eqpBandResponseDb(down, 500, SR, -12, 0), 12, 0.05, "-12 st moves a 1 kHz bell to 500 Hz");
    ok(cfg.eqpBandResponseDb(down, 1000, SR, -12, 0) < 6, "-12 st bell is no longer peaked at 1 kHz");
}
eq(cfg.eqpBandResponseDb({ enabled: 0, mode: 6, freq: 1000, gain: 12, q: 1 }, 1000, SR, 0, 0), 0, "disabled band is 0 dB");
eq(cfg.eqpBandResponseDb({ enabled: 1, mode: 0, freq: 1000, gain: 12, q: 1 }, 1000, SR, 0, 0), 0, "Off mode is 0 dB");
near(cfg.eqpTiltResponseDb(0, 100, SR), 0, 1e-6, "tilt 0 is flat");
near(cfg.eqpTiltResponseDb(12, 1000, SR), 0, 0.05, "flat tilt is 0 dB at 1 kHz");
near(cfg.eqpTiltResponseDb(12, 100, SR), -12, 0.8, "flat tilt is about -12 dB at 100 Hz");
near(cfg.eqpTiltResponseDb(12, 10000, SR), 12, 0.8, "flat tilt is about +12 dB at 10 kHz");
near(cfg.eqpTiltResponseDb(-12, 100, SR), 12, 0.8, "negative tilt boosts 100 Hz by about 12 dB");
{
    const lowOct = cfg.eqpTiltResponseDb(12, 200, SR) - cfg.eqpTiltResponseDb(12, 100, SR);
    const highOct = cfg.eqpTiltResponseDb(12, 4000, SR) - cfg.eqpTiltResponseDb(12, 2000, SR);
    near(lowOct, highOct, 0.5, "flat tilt keeps about the same slope per octave");
    near(lowOct, 12 * Math.log10(2), 0.5, "flat tilt rises about 12 dB per decade");
    eq(cfg.eqpTiltCoeffs(12, SR).sections.length, 9, "flat tilt is nine first-order shelves");
}
eq(cfg.EQP_LINEAR_LATENCY, 3072, "linear phase latency is Pro-Q Low at 44.1 kHz");
eq(cfg.eqpNaturalLatency(44100), 322, "natural phase is 322 samples at 44.1 kHz");
eq(cfg.eqpNaturalLatency(48000), 350, "natural phase scales to 350 samples at 48 kHz");
eq(cfg.eqpMeasureLinearLatency(), cfg.EQP_LINEAR_LATENCY, "overlap-add peak lands on the reported latency");
{
    const bell = [{ enabled: 1, mode: 6, freq: 1000, gain: 6, q: 1 }];
    const designed = cfg.eqpDesignPhase(bell, SR, 0, 0, 0);
    for (const f of [100, 1000, 10000]) {
        const curve = cfg.eqpTotalResponseDb(bell, f, SR, 0, 0, 0, 0);
        near(cfg.eqpIrDb(designed.linear, f, SR), curve, 0.2, `linear IR matches the curve at ${f} Hz`);
        const H = cfg.eqpPhaseH(bell, f, SR, 0, 0, 0);
        const analog = cfg.eqpMagDb(H.analog.re, H.analog.im);
        const natural = cfg.eqpMagDb(H.digital.re, H.digital.im) + cfg.eqpIrDb(designed.fir, f, SR);
        near(natural, analog, 0.25, `natural phase matches analog at ${f} Hz`);
    }
    const cut = [{ enabled: 1, mode: 10, freq: 8000, gain: 0, q: 0.707 }];
    const cutIr = cfg.eqpDesignPhase(cut, SR, 0, 0, 0);
    const cutH = cfg.eqpPhaseH(cut, 12000, SR, 0, 0, 0);
    const cutNat = cfg.eqpMagDb(cutH.digital.re, cutH.digital.im) + cfg.eqpIrDb(cutIr.fir, 12000, SR);
    near(cutNat, cfg.eqpMagDb(cutH.analog.re, cutH.analog.im), 0.4, "natural phase pulls an 8 kHz cut toward analog at 12 kHz");
    const flat = cfg.eqpDesignPhase([], SR, 0, 0, 0);
    near(flat.fir[0], 1, 0.01, "natural correction is an impulse when nothing is on");
    ok(flat.fir.reduce((s, x) => s + x * x, 0) < 1.02, "flat natural FIR has no extra energy");
}
{
    const bands = cfg.EQP_DEFAULT_BAND_FREQS.map((freq) => ({ enabled: 0, mode: 0, freq, gain: 0, q: cfg.EQP_Q_DEFAULT }));
    near(cfg.eqpTotalResponseDb(bands, 1000, SR, 0, 0, -3), -3, 1e-6, "output gain argument still offsets the sum");
    near(cfg.eqpTotalResponseDb(bands, 100, SR, 0, 0, 0, 12), cfg.eqpTiltResponseDb(12, 100, SR), 1e-6, "tilt is part of the total curve");
    bands[2] = { enabled: 1, mode: 6, freq: 1000, gain: 12, q: 0.7071 };
    near(cfg.eqpTotalResponseDb(bands, 1000, SR, 0, 0, 0), 12, 0.05, "total response is the active bell");
    near(cfg.eqpTotalResponseDb(bands, 1000, SR, 0, 0, -3), 9, 0.05, "total response adds output gain");
}
for (let mode = 1; mode <= 12; mode++) {
    const gain = (mode === 5 || mode === 6 || mode === 8) ? 6 : 0;
    eq(cfg.eqpBiquadCoeffs(mode, 1000, gain, 0.7071, SR).sections, cfg.eqpModePoles(mode), `${MODES[mode]} section count`);
    for (const f of [80, 1000, 6000]) {
        const band = { enabled: 1, mode, freq: 1000, gain, q: 0.7071 };
        const actual = cfg.eqpBandResponseDb(band, f, SR, 0, 0);
        const expected = repeatedDb(mode, 1000, gain, 0.7071, f).db;
        nearResponse(actual, expected, 0.02, `${MODES[mode]} at ${f} Hz matches ${cfg.eqpModePoles(mode)} cascaded biquad(s)`);
        ok(Number.isFinite(actual), `${MODES[mode]} response is finite`);
    }
}
eq(cfg.eqpBiquadCoeffs(0, 1000, 0, 0.7071, SR).sections, 0, "Off has no sections");

function zone(nx, ny, curve) {
    return cfg.eqpClassifyGestureZone(nx, ny, curve == null ? 0.5 : curve);
}
eq(zone(0.5, 0.05).mode, 7, "bottom edge is a notch");
eq(zone(0.5, 0.05).name, "Notch", "notch name");
eq(zone(0.02, 0.02).mode, 7, "bottom edge wins over the far-left cut");
eq(zone(0.5, 0.119).mode, 7, "just inside the bottom edge is still a notch");
eq(zone(0.05, 0.5).mode, 5, "far-left curve is a low shelf");
eq(zone(0.05, 0.5).name, "Low-Shelf", "low shelf name");
eq(zone(0.139, 0.5).mode, 5, "normX 0.139 on the curve is a low shelf");
eq(zone(0.14, 0.5).mode, 6, "normX 0.14 on the curve is a bell");
eq(zone(0.95, 0.5).mode, 8, "far-right curve is a high shelf");
eq(zone(0.95, 0.5).name, "High-Shelf", "high shelf name");
eq(zone(0.861, 0.5).mode, 8, "normX 0.861 on the curve is a high shelf");
eq(zone(0.86, 0.5).mode, 6, "normX 0.86 on the curve is a bell");
eq(zone(0.05, 0.9).mode, 2, "far-left off the curve is Low-Cut 2");
eq(zone(0.05, 0.9).name, "Low-Cut 2", "low cut name");
near(cfg.EQP_SHELF_PX, 9.5, 1e-9, "shelf reach is 9.5 px");
near(cfg.EQP_SHELF_BAND, 9.5 / 115, 1e-12, "shelf band is 9.5 px of the 115 px plot");
eq(zone(0.05, 0.5 + cfg.EQP_SHELF_BAND).mode, 5, "the shelf holds out to 9.5 px from 0 dB");
eq(zone(0.05, 0.5 + cfg.EQP_SHELF_BAND + 0.01).mode, 2, "just past 9.5 px the far left is a low cut");
eq(zone(0.95, 0.5 - cfg.EQP_SHELF_BAND).mode, 8, "the high shelf holds to the same clearance below 0 dB");
eq(zone(0.95, 0.5 - cfg.EQP_SHELF_BAND - 0.01).mode, 10, "just past that clearance the far right is a high cut");
eq(zone(0.95, 0.9).mode, 10, "far-right off the curve is High-Cut 2");
eq(zone(0.95, 0.9).name, "High-Cut 2", "high cut name");
eq(zone(0.5, 0.5).mode, 6, "the curve is a bell");
eq(zone(0.5, 0.5).name, "Bell", "bell name");
eq(zone(0.5, 0.9).mode, 6, "center, off the curve, is still a bell");
eq(zone(0.5, 0.64).mode, 6, "center, outside the shelf band, is still a bell");
eq(zone(0.05, 0.5, 0.9).mode, 5, "far-left 0 dB stays a low shelf when the curve is elsewhere");
eq(zone(0.95, 0.5, 0.1).mode, 8, "far-right 0 dB stays a high shelf when the curve is elsewhere");
eq(zone(0.05, 0.8, 0.8).mode, 2, "far-left off 0 dB is a low cut even on a raised curve");

// ---------------------------------------------------------------------------------------------
// 2. Source scan: Max globals, GenExpr lexer
// ---------------------------------------------------------------------------------------------
function stripComments(code) {
    return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^\\])\/\/[^\n]*/g, "$1");
}
function assertNoMaxGlobals(file, code) {
    const src = stripComments(code);
    const reserved = ["box", "patcher", "max", "messagename", "inlet", "jsarguments"];
    for (const name of reserved) {
        ok(!new RegExp("(^|\\n)\\s*(var|let|const|function)\\s+" + name + "\\b").test(src), `${file} declares Max global ${name}`);
        ok(!new RegExp("(^|[^\\w.])" + name + "\\s*=(?!=)").test(src), `${file} assigns Max global ${name}`);
    }
}
const configSrc = fs.readFileSync(CONFIG_PATH, "utf8");
assertNoMaxGlobals("eqplus_config.js", configSrc);

const gen = fs.readFileSync(GEN_PATH, "utf8");
const genCode = stripComments(gen);
ok(!/\be[0-9]\b/.test(genCode), "no e0..e9 identifiers in GenExpr");
ok(!/\bdelay\s*\(/.test(genCode), "GenExpr must not use legacy delay()");
{
    const bufAt = gen.search(/^Buffer /m);
    const dataAt = gen.search(/^Data /m);
    const paramAt = gen.search(/^Param /m);
    const histAt = gen.search(/^History /m);
    ok(bufAt >= 0 && dataAt > bufAt && paramAt > dataAt && histAt > paramAt, "Order: Buffer -> Data -> Param -> History");
    const nested = [];
    let depth = 0;
    let fn = "";
    for (const line of genCode.split("\n")) {
        if (/^[A-Za-z_][\w]*\(.*\)\s*\{$/.test(line)) {
            fn = line;
            depth = 0;
        }
        depth += (line.match(/\{/g) || []).length;
        depth -= (line.match(/\}/g) || []).length;
        if (/\breturn\b/.test(line) && depth > 1) nested.push(fn.split("(")[0] + ": " + line.trim());
    }
    eq(nested.length, 0, `no return inside a GenExpr block (${nested.join("; ")})`);
    const tail = gen.slice(bufAt).split("\n");
    const late = tail.filter((line) => /^[A-Za-z_][\w]*\(.*\)\s*\{$/.test(line.trim()));
    eq(late.length, 0, `no helper function after Buffer (${late.join("; ")})`);
}
ok(gen.includes('Buffer eqcfg("eqpluscfg");'), 'Buffer eqcfg("eqpluscfg")');
ok(gen.includes('Buffer spec("eqplusspec");'), 'Buffer spec("eqplusspec")');
ok(gen.includes("Data zstate(128);"), "Data zstate(128)");
ok(gen.includes("Param tiltOn"), "tilt filter reaches the gen");
ok(gen.includes("Data tiltZ(18);") && gen.includes("Data tiltC(28);"), "flat tilt state is nine sections");
ok(gen.includes("for (s = 0; s < 9; s += 1)"), "flat tilt runs nine sections");
ok(!gen.includes("tLb0"), "the two-shelf tilt coefficients are gone");
ok(gen.includes('Buffer irspec("eqplusir")'), "phase IR buffer");
ok(gen.includes("Param phaseMode"), "processing mode reaches the gen");
ok(gen.includes("Data yRun(2);"), "biquad cascade keeps its sample in Data");
ok(gen.includes("poke(yRun,"), "biquad cascade writes through Data, not an inlet alias");
ok(!/\byL = xL;/.test(gen), "yL is not a plain alias of the inlet");
eq((gen.match(/fft_run\(/g) || []).length, 1, "one fft_run call site, so Zero Latency does not compile the FFT six times");
ok(gen.includes("fft_run(fx, tab, 4096, inv)"), "linear phase uses the shared FFT");
ok(gen.includes("phaseMode >= 1.5"), "the 4096-point FFT runs only in Linear Phase");
ok(gen.includes("floor(322 * samplerate / 44100 + 0.5)"), "natural phase delay is 7.3 ms");
ok(gen.includes("dryDL.read(3072"), "linear phase delay is 3072 samples");
ok(fs.readFileSync(path.join(ROOT, "scripts", "build_eqplus.py"), "utf8").includes("cepstrum_lib.genexpr"), "build prepends the FFT");
ok(gen.includes("Data cstate(128);"), "Data cstate(128)");
ok(gen.includes("Param chroute(0"), "stereo route reaches the gen");
ok(gen.includes("useB = slot > 0.5"), "split routes read the second curve");
ok(gen.includes("peek(hreB, p)"), "linear phase filters the right channel with curve B");
ok(gen.includes("peek(irspec, 128 + i, 1)"), "natural phase reads curve B's FIR");
ok(/Param outgain\(0/.test(gen), "Param outgain");
ok(/Param bypass\(0/.test(gen), "Param bypass");
ok(gen.includes("History initDone(0);") && gen.includes("History writeIdx(0);") && gen.includes("History frameTick(0);") && gen.includes("History linGain(1);"), "History state");

ok(fs.existsSync(UI_PATH), "src/eqplus_ui.js");
const uiSrc = fs.readFileSync(UI_PATH, "utf8");
assertNoMaxGlobals("eqplus_ui.js", uiSrc);
ok(/mgraphics\.init\(\)/.test(uiSrc), "v8ui calls mgraphics.init()");
ok(/mgraphics\.relative_coords\s*=\s*0/.test(uiSrc), "v8ui sets relative_coords 0");
ok(/mgraphics\.autofill\s*=\s*0/.test(uiSrc), "v8ui sets autofill 0");
ok(!uiSrc.includes("drawCursorPlus"), "filter cursor has no plus");
ok(/outlets\s*=\s*2/.test(uiSrc), "v8ui has two outlets");
ok(/function\s+init_dsp\b/.test(uiSrc), "deferred gen loader");
ok(uiSrc.includes("eq_plugin") && uiSrc.includes("eq_plugout") && uiSrc.includes("eq_genin"), "loader uses the scripting names");
ok(uiSrc.includes("/tmp/eqplus_core_"), "gendsp path is /tmp/eqplus_core_<hash>");

// ---------------------------------------------------------------------------------------------
// 3. .amxd header, layout, parameters, wiring
// ---------------------------------------------------------------------------------------------
ok(fs.existsSync(AMXD_PATH), "devices/EQ+.amxd exists (run scripts/build_eqplus.py)");
const raw = fs.readFileSync(AMXD_PATH);
eq(raw.slice(0, 4).toString("ascii"), "ampf", "ampf magic");
eq(raw.readUInt32LE(4), 4, "header version");
eq(raw.slice(8, 12).toString("ascii"), "aaaa", "audio-effect type");
eq(raw.readUInt32LE(8), 1633771873, "amxdtype aaaa");
eq(raw.slice(12, 16).toString("ascii"), "meta", "meta chunk");
eq(raw.readUInt32LE(16), 4, "meta size");
eq(raw.readUInt32LE(20), 0, "meta pad");
eq(raw.slice(24, 28).toString("ascii"), "ptch", "ptch chunk");
eq(raw.readUInt32LE(28), raw.length - 32, "payload length");

const patcher = JSON.parse(raw.slice(32).toString("utf8")).patcher;
eq(patcher.openinpresentation, 1, "opens in presentation");
eq(patcher.openrect[0], 0, "openrect x");
eq(patcher.openrect[1], 0, "openrect y");
eq(patcher.openrect[2], 378, "width 378");
eq(patcher.openrect[3], 169, "height 169");
eq(patcher.devicewidth, 378, "devicewidth 378");

const boxes = patcher.boxes.map((b) => b.box);
const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
const lines = patcher.lines.map((l) => l.patchline);
function connected(src, dst) {
    return lines.some((l) => l.source[0] === src && l.destination[0] === dst);
}
function connectedPort(src, outlet, dst) {
    return lines.some((l) => l.source[0] === src && l.source[1] === outlet && l.destination[0] === dst);
}
function intoHub(src) {
    return lines.some((l) => l.source[0] === src && l.destination[0] === "obj-gen-in" && l.destination[1] === 1);
}

eq(byId["obj-plugin"].text, "plugin~ 1 2 3 4", "plugin~ main plus sidechain");
eq(byId["obj-plugin"].numinlets, 2, "plugin~ inlets");
eq(byId["obj-plugin"].numoutlets, 4, "plugin~ main and sidechain outlets");
deep(byId["obj-plugin"].outlettype, ["signal", "signal", "signal", "signal"], "plugin~ signal outlets");
eq(byId["obj-plugin"].varname, "eq_plugin", "plugin scripting name");
eq(byId["obj-plugout"].text, "plugout~", "plugout~");
eq(byId["obj-plugout"].varname, "eq_plugout", "plugout scripting name");
eq(byId["obj-gen-in"].text, "gate 1 1", "gen hub is gate 1 1");
eq(byId["obj-gen-in"].varname, "eq_genin", "hub scripting name");
ok(!boxes.some((b) => b.maxclass === "gen~" || b.maxclass === "gen.codebox~"), "no static gen~");
ok(!connected("obj-plugin", "obj-plugout"), "plugin~ is not wired to plugout~");
eq(byId["obj-buf-cfg"].text, "buffer~ ---eqpluscfg @samps 128", "config buffer");
eq(byId["obj-buf-spec"].text, "buffer~ ---eqplusspec 200 4 @samps 8200", "spectrum buffer includes the sidechain ring");
for (const b of boxes) {
    const text = b.text || "";
    if (/^buffer~/.test(text) || /^(send|receive|s|r) /.test(text)) ok(text.includes("---"), `--- required: ${text}`);
}
eq(byId["obj-metro"].text, "qmetro 33 @active 1", "30 fps metro");
ok(connected("obj-metro", "obj-viz"), "metro bangs the canvas");
eq(byId["obj-thisdevice"].text, "live.thisdevice", "live.thisdevice");
eq(byId["obj-trig-init"].text, "t b b", "init trigger");
ok(connected("obj-thisdevice", "obj-trig-init"), "thisdevice bangs the trigger");
eq(byId["obj-msg-init"].text, "init_dsp", "init_dsp message");
eq(byId["obj-msg-setbuf"].text, "setbuffers ---eqpluscfg ---eqplusspec ---eqplusir", "UI buffer message");
eq(byId["obj-msg-gen-buf"].text, "eqcfg ---eqpluscfg, spec ---eqplusspec, irspec ---eqplusir", "gen buffer bind");
ok(connectedPort("obj-trig-init", 1, "obj-msg-setbuf") && connected("obj-msg-setbuf", "obj-viz"), "setbuffers reaches the canvas first");
ok(connectedPort("obj-trig-init", 1, "obj-msg-gen-buf") && intoHub("obj-msg-gen-buf"), "gen bind enters the hub");
ok(connectedPort("obj-trig-init", 0, "obj-msg-init") && connected("obj-msg-init", "obj-viz"), "init_dsp is the later bang");
ok(connectedPort("obj-trig-init", 0, "obj-msg-init-selection") && connected("obj-msg-init-selection", "obj-viz"), "selection tracking starts with the device");
eq(byId["obj-key"].text, "key", "key object");
eq(byId["obj-sel-key"].text, "sel 127 8 30 31 28 29", "delete and arrows");
ok(connectedPort("obj-key", 0, "obj-sel-key"), "key feeds sel");
ok(connectedPort("obj-sel-key", 0, "obj-msg-hotkey-disable") && connectedPort("obj-sel-key", 1, "obj-msg-hotkey-disable") && connected("obj-msg-hotkey-disable", "obj-viz"), "delete and backspace disable the selection");
ok(connectedPort("obj-sel-key", 2, "obj-msg-hotkey-gain-up") && connected("obj-msg-hotkey-gain-up", "obj-viz"), "up nudges gain");
ok(connectedPort("obj-sel-key", 3, "obj-msg-hotkey-gain-down") && connected("obj-msg-hotkey-gain-down", "obj-viz"), "down nudges gain");
ok(connectedPort("obj-sel-key", 4, "obj-msg-hotkey-freq-left") && connected("obj-msg-hotkey-freq-left", "obj-viz"), "left nudges frequency");
ok(connectedPort("obj-sel-key", 5, "obj-msg-hotkey-freq-right") && connected("obj-msg-hotkey-freq-right", "obj-viz"), "right nudges frequency");

const viz = byId["obj-viz"];
eq(viz.maxclass, "v8ui", "canvas is a v8ui");
eq(viz.parameter_enable, 1, "canvas stores the blob");
eq(viz.numoutlets, 2, "canvas has a param outlet and a gen outlet");
eq(viz.varname, "obj-viz", "canvas scripting name");
ok(!viz.ignoreclick, "canvas receives clicks");
deep(viz.presentation_rect, [4, 4, 370, 161], "canvas rect");
ok(viz.presentation_rect[0] + viz.presentation_rect[2] <= 378 && viz.presentation_rect[1] + viz.presentation_rect[3] <= 169, "canvas fits 378 x 169");
const blob = viz.saved_attribute_attributes.valueof;
eq(blob.parameter_longname, "EQPlusState", "blob name");
eq(blob.parameter_type, 3, "blob parameter");
eq(blob.parameter_invisible, 1, "blob is stored only");
ok(/mgraphics\.relative_coords\s*=\s*0/.test(viz.textfile.text), "built face keeps pixel coordinates");
ok(/mgraphics\.autofill\s*=\s*0/.test(viz.textfile.text), "built face keeps autofill 0");

function readJsString(src, quoteAt) {
    let i = quoteAt + 1;
    let out = "";
    const simple = { n: "\n", r: "\r", t: "\t", "\\": "\\", "\"": "\"", "/": "/", b: "\b", f: "\f" };
    while (i < src.length) {
        const c = src[i];
        if (c === "\\") {
            const n = src[i + 1];
            if (n === "u") {
                out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
                i += 6;
                continue;
            }
            out += Object.prototype.hasOwnProperty.call(simple, n) ? simple[n] : n;
            i += 2;
            continue;
        }
        if (c === "\"") return out;
        out += c;
        i++;
    }
    throw new Error("unterminated embedded string");
}
function extractAssignedString(src, name) {
    const token = "var " + name;
    const at = src.indexOf(token);
    ok(at >= 0, `${name} is embedded`);
    let i = at + token.length;
    while (src[i] === " " || src[i] === "\n" || src[i] === "\t") i++;
    eq(src[i], "=", `${name} assignment`);
    i++;
    while (src[i] === " " || src[i] === "\n" || src[i] === "\t") i++;
    eq(src[i], "\"", `${name} is a string`);
    return readJsString(src, i);
}
{
    const face = viz.textfile.text;
    const genText = extractAssignedString(face, "GEN_DSP_TEXT");
    const genHash = extractAssignedString(face, "GEN_DSP_HASH");
    eq(genHash, crypto.createHash("sha1").update(genText).digest("hex").slice(0, 12), "GEN_DSP_HASH");
    const gendsp = JSON.parse(genText);
    const gboxes = gendsp.patcher.boxes.map((b) => b.box);
    eq(gboxes.length, 5, "gendsp is 2-in, codebox, 2-out");
    const codebox = gboxes.find((b) => b.maxclass === "codebox");
    const fftSrc = fs.readFileSync(path.join(ROOT, "src", "cepstrum_lib.genexpr"), "utf8").replace(/\s+$/, "");
    eq(codebox.code, minifyGen(fftSrc + "\n" + gen), "embedded codebox is the FFT plus the mangled eqplus core");
    for (const text of ["in 1", "in 2", "out 1", "out 2"]) ok(gboxes.some((b) => b.text === text), `gendsp ${text}`);
}

function rectsOverlap(a, b) {
    return !(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]);
}
const visibleLive = boxes.filter((b) => b.presentation === 1 && !b.hidden && b.maxclass && b.maxclass.startsWith("live."));
eq(visibleLive.length, 0, "no live.* widget is on the presentation");
for (const w of visibleLive) ok(!rectsOverlap(viz.presentation_rect, w.presentation_rect), `${w.id} overlaps obj-viz`);
eq(boxes[boxes.length - 1].id, "obj-panel-bg", "background panel is the last box");
eq(boxes[boxes.length - 1].varname, "obj-panel-bg", "panel scripting name");
eq(boxes[boxes.length - 1].maxclass, "panel", "last box is a panel");
eq(boxes[boxes.length - 1].background, 1, "panel background flag");
eq(boxes[boxes.length - 1].presentation, 1, "panel is presented");
deep(boxes[boxes.length - 1].presentation_rect, [0, 0, 378, 169], "panel covers the device");
near(boxes[boxes.length - 1].bgcolor[0], 0.212, 0.002, "panel red");
near(boxes[boxes.length - 1].bgcolor[1], 0.212, 0.002, "panel green");
near(boxes[boxes.length - 1].bgcolor[2], 0.212, 0.002, "panel blue");
eq(boxes[boxes.length - 1].saved_attribute_attributes.bgfillcolor.expression, "themecolor.live_surface_bg", "panel follows Live's surface colour");

function vof(id) { return byId[id].saved_attribute_attributes.valueof; }
function isFace(id) {
    return id === "obj-ctrl-shift" || id === "obj-ctrl-gain" || id === "obj-ctrl-tilt-eq"
        || id === "obj-ctrl-route"
        || /^obj-ctrl-b\d+-(enable|freq|gain|q)$/.test(id);
}
function expectFace(id) {
    const b = byId[id];
    eq(b.presentation, 1, `${id} face is in presentation`);
    eq(b.hidden, 1, `${id} face starts hidden`);
    deep(b.presentation_rect, [0, 0, 1, 1], `${id} face is parked outside the canvas`);
    const ink = b.maxclass === "live.text" ? b.bgcolor : b.activebgcolor;
    eq(ink[3], 0, `${id} face is transparent`);
    if (b.maxclass === "live.text") {
        eq(b.text, "", `${id} face draws no caption`);
        eq(b.texton, "", `${id} face draws no on caption`);
    } else if (b.maxclass === "live.menu") {
        eq(b.textcolor[3], 0, `${id} face is transparent`);
    } else {
        eq(b.appearance, 0, `${id} face is a plain numbox`);
    }
}
function expectInfo(id) {
    const b = byId[id];
    const info = vof(id).parameter_info;
    ok(typeof info === "string" && info.length > 24, `${id} has Info View text`);
    eq(b.annotation, info, `${id} annotation matches the Info View`);
}
function expectFloat(id, longName, shortName, lo, hi, initial, unit, exponent) {
    const b = byId[id];
    const v = vof(id);
    eq(b.maxclass, "live.numbox", `${id} numbox`);
    if (isFace(id)) expectFace(id);
    else eq(b.presentation, 0, `${id} is off the presentation`);
    expectInfo(id);
    eq(b.parameter_enable, 1, `${id} is automatable`);
    eq(v.parameter_longname, longName, `${id} long name`);
    eq(v.parameter_shortname, shortName, `${id} short name`);
    eq(v.parameter_mmin, lo, `${id} min`);
    eq(v.parameter_mmax, hi, `${id} max`);
    near(v.parameter_initial[0], initial, 1e-6, `${id} initial`);
    eq(v.parameter_type, 0, `${id} is a float parameter`);
    eq(v.parameter_unitstyle, unit, `${id} unit`);
    eq(v.parameter_initial_enable, 1, `${id} stores its default`);
    if (exponent == null) ok(v.parameter_exponent == null || v.parameter_exponent === 1, `${id} linear`);
    else near(v.parameter_exponent, exponent, 1e-9, `${id} exponent`);
}
function expectEnum(id, maxclass, longName, shortName, enums, initial) {
    const b = byId[id];
    const v = vof(id);
    eq(b.maxclass, maxclass, `${id} class`);
    if (isFace(id)) expectFace(id);
    else eq(b.presentation, 0, `${id} is off the presentation`);
    expectInfo(id);
    eq(b.parameter_enable, 1, `${id} is automatable`);
    eq(v.parameter_longname, longName, `${id} long name`);
    eq(v.parameter_shortname, shortName, `${id} short name`);
    deep(v.parameter_enum, enums, `${id} enum`);
    eq(v.parameter_initial[0], initial, `${id} initial`);
    eq(v.parameter_type, 2, `${id} enum type`);
    eq(v.parameter_mmax, enums.length - 1, `${id} enum max`);
    eq(v.parameter_initial_enable, 1, `${id} stores its default`);
    if (maxclass === "live.text") eq(b.mode, 1, `${id} is a toggle`);
}

expectFloat("obj-ctrl-shift", "Global Shift", "Shift", -64, 64, 0, 7, null);
ok(/-64 to \+64/.test(vof("obj-ctrl-shift").parameter_info), "shift Info View states \u00b164");
expectFloat("obj-ctrl-gain", "Output Gain", "Gain", -24, 24, 0, 4, null);
expectEnum("obj-ctrl-adaptiveq", "live.text", "Adaptive-Q", "AdaptQ", ["Off", "On"], 1);
expectEnum("obj-ctrl-range", "live.tab", "Display Range", "Range", ["\u00b112", "\u00b124", "\u00b136"], 0);
expectEnum("obj-ctrl-pre", "live.text", "Analyzer Pre", "Pre", ["Off", "On"], 1);
expectEnum("obj-ctrl-post", "live.text", "Analyzer Post", "Post", ["Off", "On"], 1);
expectEnum("obj-ctrl-resolution", "live.menu", "Resolution", "Res", ["Small", "Medium", "Large", "Huge"], 3);
expectEnum("obj-ctrl-speed", "live.menu", "Speed", "Speed", ["Fast", "Medium", "Slow", "Freeze"], 0);
expectEnum("obj-ctrl-tilt", "live.menu", "Tilt", "Tilt", ["0.0 dB/oct", "3.0 dB/oct", "4.5 dB/oct", "6.0 dB/oct"], 2);
expectEnum("obj-ctrl-filters-shelf", "live.text", "Show Filters Shelf", "FiltShf", ["Off", "On"], 0);
expectEnum("obj-ctrl-analyzer-shelf", "live.text", "Show Analyzer Shelf", "AnaShf", ["Off", "On"], 0);
eq(vof("obj-ctrl-filters-shelf").parameter_invisible, 1, "filters shelf is stored only");
eq(vof("obj-ctrl-analyzer-shelf").parameter_invisible, 1, "analyzer shelf is stored only");
eq(byId["obj-ctrl-filters-shelf"].hidden, 1, "filters shelf is hidden");
eq(byId["obj-ctrl-analyzer-shelf"].hidden, 1, "analyzer shelf is hidden");
expectEnum("obj-ctrl-sidechain-fold", "live.text", "Show Sidechain Fold", "SCFold", ["Off", "On"], 0);
expectEnum("obj-ctrl-ref-enable", "live.text", "Reference Enable", "RefOn", ["Off", "On"], 0);
expectFloat("obj-ctrl-ref-gain", "Reference Gain", "RefGain", -24, 24, 0, 4, null);
expectFloat("obj-ctrl-tilt-eq", "Tilt Filter", "TiltEQ", -24, 24, 0, 4, null);
expectEnum("obj-ctrl-phase-mode", "live.menu", "Processing Mode", "Phase", ["Zero Latency", "Natural Phase", "Linear Phase"], 0);
expectEnum("obj-ctrl-route", "live.menu", "Stereo Route", "Route", ["Stereo", "Left", "Right", "Mid", "Side"], 0);
eq(vof("obj-ctrl-sidechain-fold").parameter_invisible, 1, "sidechain fold is stored only");
eq(byId["obj-ctrl-sidechain-fold"].hidden, 1, "sidechain fold is hidden");
ok(vof("obj-ctrl-ref-enable").parameter_invisible == null, "reference enable stays automatable");
ok(vof("obj-ctrl-ref-gain").parameter_invisible == null, "reference gain stays automatable");
for (let i = 1; i <= 8; i++) {
    const freq = [60, 125, 250, 500, 1000, 2000, 4000, 8000][i - 1];
    expectEnum(`obj-ctrl-b${i}-enable`, "live.text", `Band ${i} Enable`, `B${i} On`, ["Off", "On"], 0);
    expectEnum(`obj-ctrl-b${i}-mode`, "live.menu", `Band ${i} Mode`, `B${i} Mode`, MODES, 0);
    expectFloat(`obj-ctrl-b${i}-freq`, `Band ${i} Freq`, `B${i} Freq`, 20, 20000, freq, 3, 3);
    expectFloat(`obj-ctrl-b${i}-gain`, `Band ${i} Gain`, `B${i} Gain`, -36, 36, 0, 4, null);
    expectFloat(`obj-ctrl-b${i}-q`, `Band ${i} Q`, `B${i} Q`, 0.1, 40, 0.7071, 1, 2.5);
}
eq(boxes.filter((b) => isFace(b.id)).length, 36, "shift, gain, tilt, route and every band's on/off, frequency, gain and Q are faces");

const routeKeys = ["shift", "gain", "adaptiveq", "range", "pre", "post", "resolution", "speed", "tilt"];
const routeIds = ["obj-ctrl-shift", "obj-ctrl-gain", "obj-ctrl-adaptiveq", "obj-ctrl-range", "obj-ctrl-pre", "obj-ctrl-post", "obj-ctrl-resolution", "obj-ctrl-speed", "obj-ctrl-tilt"];
const routeUi = ["prepend set_shift", "prepend set_gain", "prepend set_adaptiveq", "prepend set_range", "prepend set_pre", "prepend set_post", "prepend set_resolution", "prepend set_speed", "prepend set_tilt"];
for (let i = 1; i <= 8; i++) {
    for (const part of ["enable", "mode", "freq", "gain", "q"]) {
        routeKeys.push(`b${i}_${part}`);
        routeIds.push(`obj-ctrl-b${i}-${part}`);
        routeUi.push(`prepend set_band_${part} ${i - 1}`);
    }
}
routeKeys.push("filters_shelf", "analyzer_shelf", "sidechain_fold", "ref_enable", "ref_gain", "tilt_eq", "phase_mode", "route");
routeIds.push("obj-ctrl-filters-shelf", "obj-ctrl-analyzer-shelf", "obj-ctrl-sidechain-fold", "obj-ctrl-ref-enable", "obj-ctrl-ref-gain", "obj-ctrl-tilt-eq", "obj-ctrl-phase-mode", "obj-ctrl-route");
routeUi.push("prepend set_filters_shelf", "prepend set_analyzer_shelf", "prepend set_sidechain_fold", "prepend set_ref_enable", "prepend set_ref_gain", "prepend set_tilt_eq", "prepend set_phase_mode", "prepend set_route");
eq(byId["obj-route-viz"].text, "route param setwidth_cmd", "viz router");
eq(byId["obj-route-viz"].numoutlets, 3, "viz router has param, setwidth_cmd, and unmatched");
eq(byId["obj-route-param"].text, "route " + routeKeys.join(" "), "name router");
ok(connectedPort("obj-viz", 0, "obj-route-viz") && connectedPort("obj-route-viz", 0, "obj-route-param"), "canvas -> route param -> names");
ok(connectedPort("obj-route-viz", 1, "obj-prep-setwidth"), "setwidth_cmd leaves the viz router");
eq(byId["obj-prep-setwidth"].text, "prepend setwidth", "setwidth prepend");
ok(lines.some((l) => l.source[0] === "obj-prep-setwidth" && l.destination[0] === "obj-thisdevice" && l.destination[1] === 0), "setwidth enters live.thisdevice inlet 0");
ok(intoHub("obj-viz") && lines.some((l) => l.source[0] === "obj-viz" && l.source[1] === 1 && l.destination[0] === "obj-gen-in"), "canvas outlet 1 enters the gen hub");
for (let i = 0; i < routeKeys.length; i++) {
    const setBox = boxes.find((b) => b.text === "prepend set" && connectedPort("obj-route-param", i, b.id));
    ok(!!setBox, `${routeKeys[i]} has a silent set`);
    ok(connected(setBox.id, routeIds[i]), `${routeKeys[i]} set -> ${routeIds[i]}`);
    const uiBox = boxes.find((b) => b.text === routeUi[i]);
    ok(!!uiBox && connected(routeIds[i], uiBox.id) && connected(uiBox.id, "obj-viz"), `${routeUi[i]} -> canvas`);
}
for (const b of boxes) {
    if (b.text !== "prepend set") continue;
    for (const l of lines) {
        if (l.source[0] === b.id) ok(/^obj-ctrl-/.test(l.destination[0]), "prepend set only drives live controls");
    }
}
{
    const outgain = boxes.find((b) => b.text === "prepend outgain");
    ok(!!outgain && connected("obj-ctrl-gain", outgain.id) && intoHub(outgain.id), "Output Gain -> outgain -> gen hub");
}

// ---------------------------------------------------------------------------------------------
// 4. v8ui gestures
// ---------------------------------------------------------------------------------------------
function loadFace() {
    const pokes = [];
    const sandbox = {
        pokes,
        paintError: null,
        posts: [],
        cursorLog: [],
        mgOps: null,
        _painting: false,
        post() {
            sandbox.posts.push(Array.prototype.map.call(arguments, String).join(" "));
        },
        error() {},
        cpost() {},
        notifyCount: 0,
        samplerate: SR,
        jsarguments: ["eqplus"],
        messagename: "",
        inlet: 0,
        setTimeout() { return 0; },
        clearTimeout() {},
        setInterval() { return 0; },
        clearInterval() {},
    };
    sandbox.notifyclients = function () { sandbox.notifyCount++; };
    sandbox.notifyclients.hook = true;
    sandbox.max = {
        hidecursor() { sandbox.cursorLog.push("hide"); },
        showcursor() { sandbox.cursorLog.push("show"); },
    };
    sandbox.outlet = function () {};
    function presentationBox(rect) {
        return {
            rect: rect.slice(),
            setattr(name, a, b, c, d) {
                if (name === "presentation_rect") this.rect = [a, b, c, d];
                else if (name === "hidden") this.hidden = a;
            },
            getattr(name) {
                if (name === "presentation_rect") return this.rect.slice();
                return 0;
            },
            message() {},
        };
    }
    const named = {
        "obj-viz": presentationBox([4, 4, 370, 161]),
        "obj-panel-bg": presentationBox([0, 0, 378, 169]),
    };
    sandbox.named = named;
    sandbox.latencySets = [];
    sandbox.patcher = {
        newdefault() {
            return { message() {}, getattr() { return 0; } };
        },
        connect() {},
        getnamed(name) { return named[name] || null; },
        message() {},
        setattr(name, value) { sandbox.latencySets.push([String(name), value]); },
    };
    function Buffer(name) {
        const rec = { name: String(name) };
        const buf = {
            name: rec.name,
            poke(ch, a, b) { pokes.push({ name: rec.name, ch, a, b }); },
            peek(ch, index, count) {
                if (count && count > 1) {
                    if (ch === 4 && /spec/.test(rec.name) && Array.isArray(sandbox.specSidechain)) {
                        const src = sandbox.specSidechain;
                        const out = [];
                        for (let i = 0; i < count; i++) out.push(Number(src[i]) || 0);
                        return out;
                    }
                    const out = [];
                    for (let i = 0; i < count; i++) out.push(0);
                    return out;
                }
                if (/spec/.test(rec.name) && index === 1 && (ch === 1 || ch == null)) return SR;
                return 0;
            },
            framecount() { return 8200; },
            channelcount() { return /spec/.test(rec.name) ? 4 : 1; },
            length() { return 8200; },
            send() {},
        };
        return new Proxy(buf, {
            get(target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop !== "string") return undefined;
                return function () { return 0; };
            },
        });
    }
    function Task(fn) {
        this.fn = fn;
        this._ran = false;
        const run = function () {
            if (this._ran) return;
            this._ran = true;
            if (typeof fn === "function") fn();
        };
        this.schedule = run;
        this.repeat = run;
        this.cancel = function () { this._ran = true; };
        this.interval = 0;
    }
    function File() {
        this.isopen = false;
        this.eof = 0;
        this.open = function () { this.isopen = true; return 1; };
        this.writestring = function () {};
        this.close = function () { this.isopen = false; };
    }
    const globals = {};
    function Global(name) {
        if (!globals[name]) globals[name] = { owner: 0, t: 0, text: "" };
        return globals[name];
    }
    function Dict() {
        this.get = function () { return null; };
        this.set = function () {};
        this.stringify = function () { return "{}"; };
    }
    const mg = {
        size: [352, 161],
        relative_coords: 1,
        autofill: 1,
        init() {},
        redraw() {
            if (sandbox._painting) return;
            sandbox._painting = true;
            try {
                if (typeof sandbox.paint === "function") sandbox.paint();
            } catch (err) {
                sandbox.paintError = sandbox.paintError || err;
            } finally {
                sandbox._painting = false;
            }
        },
    };
    sandbox.mgraphics = new Proxy(mg, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== "string") return undefined;
            return function () {
                if (Array.isArray(sandbox.mgOps)) {
                    sandbox.mgOps.push({ op: prop, args: Array.prototype.slice.call(arguments) });
                }
                if (prop === "text_measure" || prop === "text_measure_simple") {
                    const s = arguments[0] == null ? "" : String(arguments[0]);
                    return [Math.max(4, s.length * 5.6), 11];
                }
                if (prop === "get_current_point") return [0, 0];
                if (prop === "font_extents") {
                    const e = [8, 2];
                    e.ascent = 8;
                    e.descent = 2;
                    e.height = 10;
                    return e;
                }
                return undefined;
            };
        },
        set(target, prop, value) {
            target[prop] = value;
            return true;
        },
    });
    sandbox.Buffer = Buffer;
    sandbox.Task = Task;
    sandbox.File = File;
    sandbox.Global = Global;
    sandbox.Dict = Dict;
    vm.createContext(sandbox);
    const src = "var GEN_DSP_TEXT = \"{}\";\nvar GEN_DSP_HASH = \"abc123def456\";\n"
        + configSrc + "\n" + uiSrc;
    vm.runInContext(src, sandbox, { filename: "eqplus_ui.js" });
    if (!sandbox.notifyclients || !sandbox.notifyclients.hook) {
        const orig = sandbox.notifyclients;
        const hooked = function () {
            sandbox.notifyCount++;
            if (typeof orig === "function") return orig.apply(this, arguments);
        };
        hooked.hook = true;
        sandbox.notifyclients = hooked;
    }
    return sandbox;
}

function runFace() {
    const ui = loadFace();
    eq(ui.mgraphics.relative_coords, 0, "face relative_coords");
    eq(ui.mgraphics.autofill, 0, "face autofill");
    for (const name of ["onclick", "ondrag", "ondblclick", "onwheel", "onidle", "onidleout", "getHoverCursorState", "getvalueof", "setvalueof", "preview", "paint", "init_dsp"]) {
        eq(typeof ui[name], "function", `${name} is defined`);
    }
    for (const name of ["set_shift", "set_gain", "set_adaptiveq", "set_range", "set_pre", "set_post", "set_resolution", "set_speed", "set_tilt"]) {
        eq(typeof ui[name], "function", `${name} inlet`);
    }
    if (typeof ui.setbuffers === "function") ui.setbuffers("---eqpluscfg", "---eqplusspec");
    ui.preview();

    function take() { return Array.prototype.slice.call(ui.getvalueof()); }
    function put(v) { ui.setvalueof(v.slice()); }
    function bandAt(v, i) {
        const o = 12 + i * 5;
        return { enabled: Number(v[o]), mode: Number(v[o + 1]), freq: Number(v[o + 2]), gain: Number(v[o + 3]), q: Number(v[o + 4]) };
    }
    const base = take();
    eq(base[0], 1, "state version");
    eq(base.length, 100, "state length (version, globals, both curves, shelves, sidechain, tilt, phase, route)");
    near(base[1], 0, 1e-6, "preview shift");
    near(base[2], 0, 1e-6, "preview gain");
    eq(base[3], 0, "preview range \u00b112");
    near(base[57], 0, 1e-6, "preview tilt filter is 0");
    eq(base[58], 0, "preview processing mode is Zero Latency");
    const edged = base.slice();
    edged[58] = 6.5;
    put(edged);
    eq(ui.phaseMode, 0, "a saved Edge value stays Zero Latency");
    const linear = base.slice();
    linear[58] = 2;
    put(linear);
    eq(ui.phaseMode, 2, "phase mode 2 reloads as Linear");
    eq(ui.latencySets[ui.latencySets.length - 1][1], cfg.EQP_LINEAR_LATENCY, "Linear reports its latency");
    put(base);
    eq(ui.phaseMode, 0, "restoring the preview blob clears the phase mode");
    eq(base[4], 1, "preview Adaptive-Q");
    eq(base[5], 1, "preview pre");
    eq(base[6], 1, "preview post");
    eq(base[7], 3, "preview resolution Huge");
    eq(base[8], 0, "preview speed Fast");
    eq(base[9], 2, "preview tilt 4.5 dB/oct");
    near(base[10], -100, 1e-6, "analyzer floor");
    near(base[11], 0, 1e-6, "analyzer ceiling");
    eq(base[52], 0, "filters shelf starts closed");
    eq(base[53], 0, "analyzer shelf starts closed");
    eq(base[54], 0, "sidechain fold starts closed");
    eq(base[55], 0, "reference starts off");
    near(base[56], 0, 1e-6, "reference gain starts at 0");
    const shot0 = bandAt(base, 0);
    eq(shot0.enabled, 1, "preview band 1 is on");
    eq(shot0.mode, 10, "preview band 1 is High-Cut 2");
    near(shot0.freq, 11100, 1e-3, "preview band 1 frequency");
    near(shot0.gain, 0, 1e-6, "preview band 1 gain");
    near(shot0.q, 2.13, 1e-4, "preview band 1 Q");
    const shot1 = bandAt(base, 1);
    eq(shot1.enabled, 1, "preview band 2 is on");
    eq(shot1.mode, 6, "preview band 2 is Bell");
    near(shot1.freq, 1450, 1e-3, "preview band 2 frequency");
    near(shot1.gain, 4.2, 1e-3, "preview band 2 gain");
    near(shot1.q, 0.9, 1e-4, "preview band 2 Q");
    for (let i = 2; i < 8; i++) {
        const b = bandAt(base, i);
        eq(b.enabled, 0, `band ${i} starts off`);
        eq(b.mode, 0, `band ${i} starts Off`);
        near(b.freq, cfg.EQP_DEFAULT_BAND_FREQS[i], 1e-6, `band ${i} default freq`);
        near(b.gain, 0, 1e-6, `band ${i} default gain`);
        near(b.q, 0.7071, 1e-4, `band ${i} default Q`);
    }
    const blank = base.slice();
    for (let i = 0; i < 8; i++) {
        blank[12 + i * 5] = 0;
        blank[12 + i * 5 + 1] = 0;
    }
    const shortBlob = base.slice(0, 52);
    ui.showFiltersShelf = 1;
    put(shortBlob);
    eq(ui.showFiltersShelf, 1, "a version-1 blob without shelf flags keeps the current shelves");
    put(base);
    eq(ui.showFiltersShelf, 0, "preview state closes the filters shelf");
    put(blank);

    const PLOT_X = 20, PLOT_Y = 23, PLOT_W = 348, PLOT_H = 115;
    function at(nx, ny) {
        return [PLOT_X + nx * PLOT_W, PLOT_Y + (1 - ny) * PLOT_H];
    }
    function cursorGlyph(ops) {
        let widthAt = -1;
        for (let i = 0; i < ops.length; i++) {
            if (ops[i].op === "set_line_width" && Math.abs(Number(ops[i].args[0]) - 3.2) < 0.05) {
                widthAt = i;
                break;
            }
        }
        if (widthAt < 0) return null;
        let strokeAt = -1;
        for (let i = widthAt + 1; i < ops.length; i++) {
            if (ops[i].op === "stroke") { strokeAt = i; break; }
        }
        let start = 0;
        for (let i = widthAt - 1; i >= 0; i--) {
            if (ops[i].op === "stroke" || ops[i].op === "fill") { start = i + 1; break; }
        }
        const path = [];
        for (let i = start; i < widthAt; i++) {
            if (ops[i].op === "move_to" || ops[i].op === "line_to" || ops[i].op === "curve_to") path.push(ops[i]);
        }
        let second = false;
        for (let i = strokeAt + 1; i < ops.length; i++) {
            if (ops[i].op !== "set_line_width") continue;
            if (Math.abs(Number(ops[i].args[0]) - 1.6) > 0.05) break;
            for (let j = i + 1; j < ops.length; j++) {
                if (ops[j].op === "stroke") { second = true; break; }
                if (ops[j].op === "set_line_width") break;
            }
            break;
        }
        return { path, halo: strokeAt >= 0, core: second };
    }
    function paintWhileHovering(label) {
        ui.paintError = null;
        const postAt = ui.posts.length;
        ui.mgOps = [];
        ui.paint();
        const leaked = ui.posts.slice(postAt).some((line) => line.indexOf("EQ+: paint") >= 0);
        ok(!ui.paintError && !leaked, `${label} paint does not throw`);
        return ui.mgOps;
    }
    function enterEmptyPlot(nx, ny) {
        ui.onidleout();
        ui.cursorLog.length = 0;
        const p = at(nx, ny);
        ui.onidle(p[0], p[1]);
        return p;
    }
    const hoverZones = [
        { nx: 0.50, ny: 0.08, mode: 7, name: "Notch", curve: false, label: "bottom edge" },
        { nx: 0.08, ny: 0.50, mode: 5, name: "Low-Shelf", curve: true, label: "far-left near the 0 dB curve" },
        { nx: 0.92, ny: 0.50, mode: 8, name: "High-Shelf", curve: true, label: "far-right near the 0 dB curve" },
        { nx: 0.08, ny: 0.80, mode: 2, name: "Low-Cut", curve: true, label: "far-left off the curve" },
        { nx: 0.92, ny: 0.80, mode: 10, name: "High-Cut", curve: true, label: "far-right off the curve" },
        { nx: 0.50, ny: 0.50, mode: 6, name: "Bell", curve: true, label: "center on the curve" },
        { nx: 0.50, ny: 0.70, mode: 6, name: "Bell", curve: true, label: "center above the curve" },
        { nx: 0.50, ny: 0.30, mode: 6, name: "Bell", curve: true, label: "center below the curve" },
    ];
    for (let zi = 0; zi < hoverZones.length; zi++) {
        const z = hoverZones[zi];
        if (z.mode === 7) ok(z.ny < 0.14, "bottom edge is below 0.14");
        if (z.mode === 5 || z.mode === 2) ok(z.nx < 0.14, `${z.label} is left of 0.14`);
        if (z.mode === 8 || z.mode === 10) ok(z.nx > 0.86, `${z.label} is right of 0.86`);
        enterEmptyPlot(z.nx, z.ny);
        const st = ui.getHoverCursorState();
        const custom = z.mode !== 6;
        eq(st.hidden, custom, custom ? `${z.label} hides the OS cursor` : `${z.label} keeps the OS cursor`);
        eq(st.mode, z.mode, `${z.label} cursor mode`);
        eq(st.name, z.name, `${z.label} cursor name`);
        if (custom) ok(ui.cursorLog.indexOf("hide") >= 0 && ui.cursorLog.indexOf("show") < 0, `${z.label} calls hidecursor`);
        else ok(ui.cursorLog.indexOf("hide") < 0, `${z.label} does not hide the cursor`);
        eq(ui.hoverBand, -1, `${z.label} is not a band node`);
        if (z.mode === 5 || z.mode === 8) {
            const shelfOps = paintWhileHovering(z.label + " plus");
            ok(!shelfOps.some((op) => op.op === "set_line_width" && Math.abs(Number(op.args[0]) - 2.2) < 0.05), `${z.label} draws no plus`);
        }
        const ops = paintWhileHovering(z.label);
        const glyph = cursorGlyph(ops);
        if (!custom) {
            ok(!glyph, `${z.label} does not paint a filter cursor`);
        } else {
            ok(!!glyph && glyph.halo && glyph.core, `${z.label} strokes the filter cursor`);
            if (glyph) {
                const moves = glyph.path.filter((op) => op.op === "move_to").length;
                const lines = glyph.path.filter((op) => op.op === "line_to").length;
                const curves = glyph.path.filter((op) => op.op === "curve_to").length;
                ok(moves >= 1 && lines >= 1, `${z.label} cursor is a vector path`);
                if (z.curve) ok(curves >= 1, `${z.label} cursor uses curve_to`);
                else eq(curves, 0, `${z.label} cursor is a polyline`);
                const onZero = ops.some((op) => {
                    if (op.op !== "ellipse") return false;
                    const cy = Number(op.args[1]) + Number(op.args[3]) / 2;
                    return Number(op.args[0]) > 20 && Math.abs(cy - 80.5) < 6;
                });
                if (z.mode === 2 || z.mode === 10) ok(!onZero, `${z.label} draws no pass-filter dot`);
                if (z.mode === 7) ok(onZero, `${z.label} still marks the notch`);
            }
        }
    }
    put(blank);
    ui.set_band_mode(0, 5);
    ui.set_band_enable(0, 1);
    ui.set_band_freq(0, 180);
    ui.set_band_gain(0, 12);
    enterEmptyPlot(0.06, 0.5);
    eq(ui.getHoverCursorState().mode, 5, "0 dB on the left stays a low shelf after a shelf is applied");
    eq(ui.getHoverCursorState().name, "Low-Shelf", "0 dB on the left still names a low shelf");
    put(blank);
    function restoreOsCursor(x, y, label, band) {
        ui.cursorLog.length = 0;
        ui.onidle(x, y);
        const st = ui.getHoverCursorState();
        eq(st.hidden, false, `${label} shows the OS cursor`);
        ok(ui.cursorLog.indexOf("show") >= 0, `${label} calls showcursor`);
        if (band) ok(ui.hoverBand >= 0, `${label} sets hoverBand`);
        else eq(ui.hoverBand, -1, `${label} clears hoverBand`);
        const ops = paintWhileHovering(label);
        ok(!cursorGlyph(ops), `${label} does not paint the filter cursor`);
    }
    enterEmptyPlot(0.08, 0.5);
    restoreOsCursor(20, 10, "top bar", false);
    enterEmptyPlot(0.08, 0.8);
    restoreOsCursor(109, 149, "bottom bar", false);
    enterEmptyPlot(0.92, 0.8);
    ui.cursorLog.length = 0;
    ui.onidleout();
    eq(ui.getHoverCursorState().hidden, false, "onidleout shows the OS cursor");
    ok(ui.cursorLog.indexOf("show") >= 0, "onidleout calls showcursor");
    eq(ui.hoverBand, -1, "onidleout clears hoverBand");
    {
        const ops = paintWhileHovering("onidleout");
        ok(!cursorGlyph(ops), "onidleout does not paint the filter cursor");
    }
    const node = at(0.42, 0.62);
    ui.onclick(node[0], node[1], 1, 0, 0, 0, 0, 0);
    ui.ondrag(node[0], node[1], 0, 0, 0, 0, 0, 0);
    const hovered = bandAt(take(), 0);
    eq(hovered.enabled, 1, "active hover target is enabled");
    eq(hovered.mode, 6, "active hover target is a bell");
    enterEmptyPlot(0.05, 0.9);
    eq(ui.getHoverCursorState().hidden, true, "empty low-cut plot beside a node still hides the cursor");
    restoreOsCursor(node[0], node[1], "active band node", true);
    put(base);
    ui.onidleout();
    ui.mgOps = null;
    function mouseClick(x, y) {
        ui.onclick(x, y, 1, 0, 0, 0, 0, 0);
        ui.ondrag(x, y, 0, 0, 0, 0, 0, 0);
    }
    function createAt(nx, ny) {
        put(blank);
        const p = at(nx, ny);
        mouseClick(p[0], p[1]);
        return bandAt(take(), 0);
    }
    let made = createAt(0.5, 0.06);
    eq(made.mode, 7, "bottom-edge click creates a notch");
    eq(made.enabled, 1, "notch band is enabled");
    made = createAt(0.05, 0.5);
    eq(made.mode, 5, "far-left curve click creates a low shelf");
    made = createAt(0.95, 0.5);
    eq(made.mode, 8, "far-right curve click creates a high shelf");
    made = createAt(0.05, 0.9);
    eq(made.mode, 2, "far-left off-curve click creates Low-Cut 2");
    made = createAt(0.95, 0.9);
    eq(made.mode, 10, "far-right off-curve click creates High-Cut 2");
    made = createAt(0.5, 0.5);
    eq(made.mode, 6, "curve click creates a bell");
    near(made.freq, cfg.eqpNormToFreq(0.5), Math.abs(cfg.eqpNormToFreq(0.5)) * 0.12, "bell frequency follows the click");
    near(made.gain, cfg.eqpNormToDb(0.5, 10), 1.8, "bell gain follows the click");

    put(blank);
    const from = at(0.38, 0.58);
    const to = at(0.72, 0.82);
    ui.onclick(from[0], from[1], 1, 0, 0, 0, 0, 0);
    eq(bandAt(take(), 0).mode, 6, "drag starts on a bell");
    ui.pokes.length = 0;
    ui.ondrag(to[0], to[1], 1, 0, 0, 0, 0, 0);
    ui.ondrag(to[0], to[1], 0, 0, 0, 0, 0, 0);
    const dragged = bandAt(take(), 0);
    ok(dragged.freq > cfg.eqpNormToFreq(0.5), `drag raises frequency (${dragged.freq})`);
    ok(dragged.gain > 1, `drag raises gain (${dragged.gain})`);
    near(dragged.freq, cfg.eqpNormToFreq(0.72), Math.abs(cfg.eqpNormToFreq(0.72)) * 0.12, "dragged frequency");
    near(dragged.gain, cfg.eqpNormToDb(0.82, 10), 1.8, "dragged gain");
    ok(ui.pokes.some((p) => String(p.name).indexOf("eqpluscfg") >= 0), "drag pokes ---eqpluscfg");
    const qBefore = dragged.q;
    ui.onwheel(to[0], to[1], 0, 1, 0, 0, 0, 0, 0);
    const qAfter = bandAt(take(), 0).q;
    near(Math.log(qAfter / qBefore), 0.48, 0.04, "wheel scales Q by exp(dy * 0.48)");
    ui.onwheel(to[0], to[1], 0, 1, 0, 1, 0, 0, 0);
    const qShift = bandAt(take(), 0).q;
    near(Math.log(qShift / qAfter), 0.12, 0.04, "shift-wheel keeps the previous Q step");
    // A double-click that created the band must not immediately delete it; a later double-click does.
    const hold = Date.now() + 520;
    while (Date.now() < hold) {}
    ui.ondblclick(to[0], to[1], 1, 0, 0, 0, 0, 0);
    for (let i = 0; i < 8; i++) {
        eq(bandAt(take(), i).enabled, 0, `double-click clears band ${i}`);
        eq(bandAt(take(), i).mode, 0, `double-click sets band ${i} Off`);
    }

    let undos = 0;
    ui.pushUndoState = function () { undos++; };
    put(blank);
    const bellPt = at(0.5, 0.62);
    const undosAtStart = undos;
    ui.onclick(bellPt[0], bellPt[1], 1, 0, 0, 0, 0, 0);
    ok(undos === undosAtStart + 1, "a click pushes one undo state");
    ui.ondrag(bellPt[0] + 12, bellPt[1] - 8, 1, 0, 0, 0, 0, 0);
    ok(undos === undosAtStart + 1, "drag frames do not push undo");
    const notesBefore = ui.notifyCount;
    ui.ondrag(bellPt[0] + 12, bellPt[1] - 8, 0, 0, 0, 0, 0, 0);
    ok(ui.notifyCount > notesBefore, "releasing a gesture notifies clients");

    // Top-bar Range cells and the Adaptive-Q icon (canvas 352 x 161).
    put(base);
    ui.mgOps = [];
    ui.paint();
    {
        function headerSize(label) {
            for (let i = 0; i < ui.mgOps.length; i++) {
                const op = ui.mgOps[i];
                if (op.op !== "show_text" || String(op.args[0]) !== label) continue;
                for (let j = i; j >= 0; j--) {
                    if (ui.mgOps[j].op === "set_font_size") return Number(ui.mgOps[j].args[0]);
                }
            }
            return -1;
        }
        const shiftSize = headerSize("Shift");
        eq(shiftSize, 10, "header labels are 10 px");
        for (const label of ["Gain", "Tilt", "Range", "\u00b112"]) {
            eq(headerSize(label), shiftSize, `${label} matches the other header labels`);
        }
    }
    ui.mgOps = null;
    rightClick(308, 12);
    eq(take()[3], 1, "range box steps to \u00b124");
    rightClick(308, 12);
    eq(take()[3], 2, "range box steps to \u00b136");
    rightClick(308, 12);
    eq(take()[3], 0, "range box steps back to \u00b112");

    put(base);
    mouseClick(349, 11);
    eq(take()[4], 0, "Adaptive-Q turns off");
    mouseClick(349, 11);
    eq(take()[4], 1, "Adaptive-Q turns back on");

    put(base);
    ui.onclick(201, 11, 1, 0, 0, 0, 0, 0);
    ui.ondrag(201, 11 - 40, 1, 0, 0, 0, 0, 0);
    ui.ondrag(201, 11 - 40, 0, 0, 0, 0, 0, 0);
    ok(ui.tiltEqDb > 1, "top-bar tilt drag moves the tilt filter");

    put(base);
    for (let bi = 0; bi < 8; bi++) ui.set_band_enable(bi, 0);
    ui.set_band_mode(0, 10);
    ui.set_band_enable(0, 1);
    ui.set_band_freq(0, 300);
    ui.set_band_q(0, 0.7071);
    ui.selectedBand = -1;
    ui.selectedBands = [];
    ui.hoverBand = -1;
    ui.mgOps = [];
    ui.paint();
    {
        let width = 0;
        let flat = 0;
        const bot = 23 + 115;
        for (let i = 0; i < ui.mgOps.length; i++) {
            if (ui.mgOps[i].op === "set_line_width") width = Number(ui.mgOps[i].args[0]);
            if (Math.abs(width - 2) > 0.01 || ui.mgOps[i].op !== "move_to") continue;
            const line = ui.mgOps[i + 1];
            const stroke = ui.mgOps[i + 2];
            if (!line || line.op !== "line_to" || !stroke || stroke.op !== "stroke") continue;
            const y0 = Number(ui.mgOps[i].args[1]);
            const y1 = Number(line.args[1]);
            const dx = Math.abs(Number(line.args[0]) - Number(ui.mgOps[i].args[0]));
            if (Math.abs(y0 - bot) < 1.2 && Math.abs(y1 - bot) < 1.2 && Math.abs(y0 - y1) < 1.2) flat += dx;
        }
        ok(flat < 24, "high-cut leaves the plot instead of running along the bottom");
    }

    function rightClick(x, y) {
        ui.onclick(x, y, 2, 0, 0, 0, 0, 1);
        ui.ondrag(x, y, 0, 0, 0, 0, 0, 0);
    }
    function openAnalyzerShelf() {
        ui.showFiltersShelf = 0;
        ui.showAnalyzerShelf = 1;
        ui.applyDeviceWidth();
    }
    put(base);
    openAnalyzerShelf();
    mouseClick(455, 42);
    eq(take()[5], 0, "Pre click turns the shaded spectrum off");
    put(base);
    openAnalyzerShelf();
    mouseClick(491, 42);
    eq(take()[6], 0, "Post click turns the bright spectrum off");
    put(base);
    openAnalyzerShelf();
    rightClick(450, 66);
    ok(take()[7] !== 3, "Resolution click leaves Huge");
    put(base);
    openAnalyzerShelf();
    rightClick(450, 90);
    ok(take()[8] !== 0, "Speed click leaves Fast");
    put(base);
    openAnalyzerShelf();
    {
        const az = ui.analyzerShelf();
        const px = az.phase.x + az.phase.w * 0.5;
        const py = az.phase.y + az.phase.h * 0.5;
        rightClick(px, py);
        eq(ui.phaseMode, 1, "Phase right-click selects Natural");
        eq(take()[58], 1, "state stores Natural Phase");
        eq(ui.latencySets[ui.latencySets.length - 1][0], "latency", "phase mode writes the patcher latency");
        eq(ui.latencySets[ui.latencySets.length - 1][1], cfg.eqpNaturalLatency(ui.currentSr), "Natural reports 7.3 ms");
        rightClick(px, py);
        eq(ui.phaseMode, 2, "Phase right-click selects Linear");
        rightClick(px, py);
        eq(ui.phaseMode, 0, "Phase right-click returns to Zero Latency");
        eq(ui.latencySets[ui.latencySets.length - 1][1], 0, "Zero Latency reports no delay");
    }

    put(base);
    ui.ondrag(0, 0, 0, 0, 0, 0, 0, 0);
    ui.set_shift(-12.5);
    ui.set_gain(6.2);
    ui.set_range(2);
    ui.set_adaptiveq(0);
    ui.set_pre(0);
    ui.set_post(0);
    ui.set_resolution(1);
    ui.set_speed(3);
    ui.set_tilt(0);
    let mutated = take();
    near(mutated[1], -12.5, 1e-4, "set_shift");
    ui.set_shift(80);
    eq(ui.shiftSt, 64, "shift stops at +64");
    ui.set_shift(-80);
    eq(ui.shiftSt, -64, "shift stops at -64");
    ui.set_shift(-12.5);
    near(mutated[2], 6.2, 0.051, "set_gain");
    eq(mutated[3], 2, "set_range");
    eq(mutated[4], 0, "set_adaptiveq");
    eq(mutated[5], 0, "set_pre");
    eq(mutated[6], 0, "set_post");
    eq(mutated[7], 1, "set_resolution");
    eq(mutated[8], 3, "set_speed");
    eq(mutated[9], 0, "set_tilt");
    mutated = mutated.slice();
    for (let i = 0; i < 8; i++) {
        const o = 12 + i * 5;
        mutated[o] = i % 2;
        mutated[o + 1] = (i * 3) % 13;
        mutated[o + 2] = cfg.EQP_DEFAULT_BAND_FREQS[i] + 10;
        mutated[o + 3] = i - 3.5;
        mutated[o + 4] = 0.5 + i * 0.15;
    }
    if (typeof ui.set_band_enable === "function") {
        for (let i = 0; i < 8; i++) {
            ui.set_band_enable(i, mutated[12 + i * 5]);
            ui.set_band_mode(i, mutated[12 + i * 5 + 1]);
            ui.set_band_freq(i, mutated[12 + i * 5 + 2]);
            ui.set_band_gain(i, mutated[12 + i * 5 + 3]);
            ui.set_band_q(i, mutated[12 + i * 5 + 4]);
        }
        mutated = take();
    }
    eq(bandAt(mutated, 4).mode, 12, "band 4 mode survives in the blob");
    near(bandAt(mutated, 4).freq, cfg.EQP_DEFAULT_BAND_FREQS[4] + 10, 1e-3, "band 4 frequency survives in the blob");
    put(base);
    const restored = take();
    eq(restored.length, base.length, "restored length");
    for (let i = 0; i < base.length; i++) near(Number(restored[i]), Number(base[i]), Math.max(1e-4, Math.abs(base[i]) * 1e-6), `restore [${i}]`);
    put(mutated);
    const again = take();
    eq(again.length, mutated.length, "reapplied length");
    for (let i = 0; i < mutated.length; i++) near(Number(again[i]), Number(mutated[i]), Math.max(1e-4, Math.abs(Number(mutated[i])) * 1e-6), `reapply [${i}]`);
    verifyCursorFloorMarqueeSidechain();
    verifyBandBarAndShelves();
    verifyParamSync();
    if (ui.paintError) throw ui.paintError;

    function verifyParamSync() {
        const problems = [];
        function syncOk(cond, msg) {
            checks++;
            if (!cond) problems.push(msg);
        }
        function call(fn) {
            try {
                fn();
                return "";
            } catch (err) {
                return (err && err.message) ? err.message : String(err);
            }
        }
        const log = [];
        ui.outlet = function () {
            log.push(Array.prototype.slice.call(arguments));
        };
        function triples(from) {
            const out = [];
            for (let i = from; i < log.length; i++) {
                const args = log[i];
                if (args[0] !== 0) continue;
                let msg = args.slice(1);
                if (msg.length === 1 && msg[0] && typeof msg[0] !== "string" && typeof msg[0].length === "number") {
                    msg = Array.prototype.slice.call(msg[0]);
                }
                if (msg[0] === "param" && msg.length >= 3) out.push([String(msg[1]), msg[2]]);
            }
            return out;
        }
        let marked = 0;
        function mark() { marked = log.length; }
        function expectEmit(name, pred, why) {
            const rows = triples(marked).filter((row) => row[0] === name);
            const saw = triples(marked).map((row) => row[0]).filter((v, i, a) => a.indexOf(v) === i).join(" ");
            syncOk(rows.length > 0, `${why} emits param ${name}` + (saw ? ` (saw ${saw})` : " (no param messages)"));
            if (rows.length && pred) {
                const value = rows[rows.length - 1][1];
                syncOk(pred(value), `${why} param ${name} value ${value}`);
            }
        }
        function sawName(bufName) {
            return ui.pokes.some((p) => String(p.name) === bufName);
        }
        function coeffSnapshot(bufName, fromPoke) {
            const samples = [];
            for (let i = 0; i < 64; i++) samples.push(0);
            let saw = false;
            for (let i = fromPoke; i < ui.pokes.length; i++) {
                const p = ui.pokes[i];
                if (String(p.name) !== bufName) continue;
                saw = true;
                const list = (p.b && typeof p.b !== "string" && typeof p.b.length === "number") ? p.b : null;
                if (list && list.length > 1) {
                    for (let k = 0; k < list.length && p.a + k < 64; k++) samples[p.a + k] = Number(list[k]);
                } else if (typeof p.a === "number") {
                    samples[p.a] = Number(p.b);
                }
            }
            return saw ? samples : null;
        }
        function assertCfg(label, bufName, fromPoke) {
            const snap = coeffSnapshot(bufName, fromPoke);
            syncOk(!!snap, `${label} pokes ${bufName}`);
            if (!snap) return;
            const st = take();
            const shiftSt = Number(st[1]);
            const adaptive = Number(st[4]);
            const bad = [];
            for (let i = 0; i < 8; i++) {
                const b = bandAt(st, i);
                const live = b.enabled && b.mode !== 0;
                const q = cfg.eqpEffectiveQ(b.q, b.gain, adaptive, b.mode);
                const f = cfg.eqpEffectiveFreq(b.freq, shiftSt);
                const c = live
                    ? cfg.eqpBiquadCoeffs(b.mode, f, b.gain, q, SR)
                    : { sections: 0, b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 };
                const o = i * 8;
                const slots = ["sections", "b0", "b1", "b2", "a1", "a2"];
                const want = [c.sections, c.b0, c.b1, c.b2, c.a1, c.a2];
                for (let s = 0; s < (live ? 6 : 1); s++) {
                    const tol = s === 0 ? 1e-6 : 1e-3;
                    if (!Number.isFinite(snap[o + s]) || Math.abs(snap[o + s] - want[s]) > tol) {
                        bad.push(`band ${i + 1} ${slots[s]}=${snap[o + s]} expected ${want[s]}`);
                    }
                }
            }
            syncOk(bad.length === 0, `${label}: coeff buffer is sections,b0,b1,b2,a1,a2 per band (${bad.slice(0, 3).join("; ")}${bad.length > 3 ? `; +${bad.length - 3} more` : ""})`);
        }

        const postAt = ui.posts.length;
        let err = call(() => ui.preview());
        syncOk(!err, `preview() threw ${err}`);
        err = call(() => ui.paint());
        syncOk(!err, `paint() after preview threw ${err}`);
        if (typeof ui.preview_active === "function") {
            err = call(() => ui.preview_active());
            syncOk(!err, `preview_active() threw ${err}`);
            err = call(() => ui.paint());
            syncOk(!err, `paint() after preview_active threw ${err}`);
        }
        const paintNotes = ui.posts.slice(postAt).filter((line) => line.indexOf("EQ+: paint") >= 0);
        syncOk(paintNotes.length === 0, `paint reported ${paintNotes.join(" | ")}`);
        if (typeof ui.preview_shelves === "function") {
            err = call(() => ui.preview_shelves());
            syncOk(!err, `preview_shelves() threw ${err}`);
            err = call(() => ui.paint());
            syncOk(!err, `paint() after preview_shelves threw ${err}`);
            syncOk(ui.showFiltersShelf === 1 && ui.showAnalyzerShelf === 1, "preview_shelves opens both shelves");
        }
        err = call(() => ui.preview());
        syncOk(!err, `preview() reset threw ${err}`);

        mark();
        ui.onclick(40, 11, 1, 0, 0, 0, 0, 0);
        ui.ondrag(40, -80, 1, 0, 0, 0, 0, 0);
        ui.ondrag(40, -80, 0, 0, 0, 0, 0, 0);
        expectEmit("shift", (v) => Number(v) !== 0, "Shift drag");

        mark();
        ui.onclick(130, 11, 1, 0, 0, 0, 0, 0);
        ui.ondrag(130, -80, 1, 0, 0, 0, 0, 0);
        ui.ondrag(130, -80, 0, 0, 0, 0, 0, 0);
        expectEmit("gain", (v) => Number(v) !== 0, "Gain drag");

        mark();
        rightClick(308, 12);
        expectEmit("range", (v) => Number(v) === 1, "range box steps");
        mark();
        mouseClick(349, 11);
        expectEmit("adaptiveq", (v) => Number(v) === 0 || Number(v) === 1, "Adaptive-Q click");
        syncOk(Number(take()[4]) !== 1, "Adaptive-Q click changes the flag before the emit check");
        mark();
        openAnalyzerShelf();
        mouseClick(455, 42);
        expectEmit("pre", (v) => Number(v) === 0, "Pre click");
        mark();
        mouseClick(491, 42);
        expectEmit("post", (v) => Number(v) === 0, "Post click");
        mark();
        rightClick(450, 66);
        expectEmit("resolution", (v) => Number(v) !== 3, "Resolution click");
        mark();
        rightClick(450, 90);
        expectEmit("speed", (v) => Number(v) !== 0, "Speed click");
        mark();
        rightClick(450, 114);
        expectEmit("tilt", (v) => Number.isFinite(Number(v)), "Tilt click");

        err = call(() => ui.preview());
        syncOk(!err, `preview() before bands threw ${err}`);
        for (let bi = 0; bi < 8; bi++) {
            ui.set_band_enable(bi, 0);
            ui.set_band_mode(bi, 0);
        }
        mark();
        const spots = [0.18, 0.30, 0.42, 0.54, 0.66, 0.78, 0.90, 0.97];
        for (let i = 0; i < spots.length; i++) {
            const p = at(spots[i], 0.62);
            mouseClick(p[0], p[1]);
        }
        for (let n = 1; n <= 8; n++) {
            for (const part of ["enable", "mode", "freq", "gain", "q"]) {
                expectEmit(`b${n}_${part}`, (v) => Number.isFinite(Number(v)), `band ${n} create`);
            }
        }
        const first = at(spots[0], 0.62);
        const moved = at(spots[0] + 0.08, 0.8);
        mark();
        ui.onclick(first[0], first[1], 1, 0, 0, 0, 0, 0);
        ui.ondrag(moved[0], moved[1], 1, 0, 0, 0, 0, 0);
        ui.ondrag(moved[0], moved[1], 0, 0, 0, 0, 0, 0);
        expectEmit("b1_freq", (v) => Number(v) > 0, "band 1 drag");
        expectEmit("b1_gain", () => true, "band 1 drag");
        mark();
        ui.onwheel(moved[0], moved[1], 0, 1, 0, 0, 0, 0, 0);
        expectEmit("b1_q", (v) => Number(v) > 0, "band 1 wheel");

        const inlets = [
            "set_shift", "set_gain", "set_adaptiveq", "set_range", "set_pre", "set_post",
            "set_resolution", "set_speed", "set_tilt",
            "set_band_enable", "set_band_mode", "set_band_freq", "set_band_gain", "set_band_q",
            "setbuffers",
        ];
        const missing = inlets.filter((name) => typeof ui[name] !== "function");
        syncOk(missing.length === 0, `face handles builder inlets (missing ${missing.join(", ")})`);
        if (!missing.length) {
            err = call(() => ui.preview());
            syncOk(!err, `preview() before inlets threw ${err}`);
            ui.ondrag(0, 0, 0, 0, 0, 0, 0, 0);
            const freqs = [200, 400, 800, 1000, 1500, 3000, 6000, 10000];
            const cfgFrom = ui.pokes.length;
            err = call(() => {
                ui.set_adaptiveq(0);
                ui.set_shift(0);
                ui.setbuffers("---eqpluscfg", "---eqplusspec");
                for (let i = 0; i < 8; i++) {
                    ui.set_band_mode(i, i === 3 ? 7 : 6);
                    ui.set_band_enable(i, 1);
                    ui.set_band_freq(i, freqs[i]);
                    ui.set_band_gain(i, i === 3 ? 0 : (i - 3));
                    ui.set_band_q(i, 0.7 + i * 0.1);
                }
            });
            syncOk(!err, `band inlets threw ${err}`);
            for (let i = 0; i < 8; i++) {
                const b = bandAt(take(), i);
                syncOk(b.mode === (i === 3 ? 7 : 6), `set_band_mode ${i} -> ${b.mode}`);
                syncOk(b.enabled === 1, `set_band_enable ${i} -> ${b.enabled}`);
                syncOk(Math.abs(b.freq - freqs[i]) <= 1, `set_band_freq ${i} -> ${b.freq}`);
            }
            syncOk(Math.abs(bandAt(take(), 1).gain - (1 - 3)) <= 0.15, `set_band_gain -> ${bandAt(take(), 1).gain}`);
            syncOk(Math.abs(bandAt(take(), 1).q - (0.7 + 0.1)) <= 0.02, `set_band_q -> ${bandAt(take(), 1).q}`);
            err = call(() => ui.set_band_freq(0, 220));
            syncOk(!err, `set_band_freq repoke threw ${err}`);
            assertCfg("band inlets", "---eqpluscfg", cfgFrom);
            err = call(() => {
                ui.set_band_enable(3, 0);
                ui.set_shift(12);
                ui.set_adaptiveq(1);
            });
            syncOk(!err, `shift / adaptive / enable threw ${err}`);
            syncOk(bandAt(take(), 3).enabled === 0, "set_band_enable 3 turns band 4 off");
            syncOk(Math.abs(Number(take()[1]) - 12) <= 0.02, `set_shift -> ${take()[1]}`);
            syncOk(Number(take()[4]) === 1, "set_adaptiveq on");
            assertCfg("after shift and Adaptive-Q", "---eqpluscfg", cfgFrom);
            err = call(() => {
                ui.set_gain(-6);
                ui.set_range(2);
                ui.set_pre(0);
                ui.set_post(0);
                ui.set_resolution(1);
                ui.set_speed(2);
                ui.set_tilt(0);
            });
            syncOk(!err, `display inlets threw ${err}`);
            const st = take();
            syncOk(Math.abs(Number(st[2]) - -6) <= 0.15, `set_gain -> ${st[2]}`);
            syncOk(Number(st[3]) === 2, `set_range -> ${st[3]}`);
            syncOk(Number(st[5]) === 0, `set_pre -> ${st[5]}`);
            syncOk(Number(st[6]) === 0, `set_post -> ${st[6]}`);
            syncOk(Number(st[7]) === 1, `set_resolution -> ${st[7]}`);
            syncOk(Number(st[8]) === 2, `set_speed -> ${st[8]}`);
            syncOk(Number(st[9]) === 0, `set_tilt -> ${st[9]}`);
            assertCfg("display inlets leave coeffs matching state", "---eqpluscfg", cfgFrom);
            const alt = "---eqpluscfg-sync";
            ui.pokes.length = 0;
            err = call(() => {
                ui.setbuffers(alt, "---eqplusspec-sync");
                ui.set_band_freq(0, 250);
            });
            syncOk(!err, `setbuffers threw ${err}`);
            syncOk(sawName(alt), `setbuffers directs pokes to ${alt}`);
            assertCfg("renamed coeff buffer", alt, 0);
        }
        eq(problems.length, 0, problems.join(" | "));
    }

    function verifyCursorFloorMarqueeSidechain() {
        const savedOutlet = ui.outlet;
        const log = [];
        ui.outlet = function () { log.push(Array.prototype.slice.call(arguments)); };
        function widthCmds() {
            return log.filter((args) => args[1] === "setwidth_cmd").map((args) => Number(args[2]));
        }
        function glyphDy(ops) {
            const glyph = cursorGlyph(ops);
            if (!glyph || !glyph.path.length) return null;
            function yOf(op) {
                if (op.op === "curve_to") return Number(op.args[5]);
                return Number(op.args[1]);
            }
            return yOf(glyph.path[glyph.path.length - 1]) - yOf(glyph.path[0]);
        }
        function hoverShape(nx, ny, label) {
            enterEmptyPlot(nx, ny);
            return { st: ui.getHoverCursorState(), ops: paintWhileHovering(label) };
        }
        function expectShape(nx, samples, expect) {
            const dys = [];
            for (let i = 0; i < samples.length; i++) {
                const label = `${expect.name} ${samples[i].where}`;
                const h = hoverShape(nx, samples[i].ny, label);
                const dy = glyphDy(h.ops);
                eq(h.st.hidden, true, `${label} hides the OS cursor`);
                ok(ui.cursorLog.indexOf("hide") >= 0 && ui.cursorLog.indexOf("show") < 0, `${label} calls hidecursor`);
                eq(h.st.mode, expect.mode, `${label} mode`);
                eq(h.st.name, expect.name, `${label} name`);
                ok(dy != null, `${label} draws a curve`);
                if (dy != null && expect.rise) ok(dy < -4, `${label} draws a rising-from-left curve`);
                if (dy != null && expect.drop) ok(dy > 4, `${label} draws a dropping-on-right curve`);
                if (dy != null && expect.leftHigh) ok(dy > 4, `${label} draws a left-high curve`);
                if (dy != null && expect.rightHigh) ok(dy < -4, `${label} draws a right-high curve`);
                if (expect.fork) {
                    const fork = cursorGlyph(h.ops);
                    const ys = fork ? fork.path.map((op) => op.op === "curve_to" ? Number(op.args[5]) : Number(op.args[1])) : [];
                    ok(ys.length > 2 && Math.min.apply(null, ys) < ys[0] - 2 && Math.max.apply(null, ys) > ys[0] + 2, `${label} draws a tuning-fork shelf`);
                }
                dys.push(dy);
            }
            if (dys[0] != null && dys[1] != null) near(dys[0], dys[1], 0.25, `${expect.name} keeps the same curve on both sides of the response`);
        }

        ui.preview();
        ui.onidleout();
        const qh = ui.qHandlePos(ui.geo(), ui.selectedBand);
        ui.cursorLog.length = 0;
        ui.onidle(qh.x, qh.y);
        eq(ui.getHoverCursorState().hidden, false, "Q handle keeps the OS cursor visible");
        ok(ui.cursorLog.indexOf("hide") < 0, "Q handle does not call hidecursor");
        ok(!cursorGlyph(paintWhileHovering("Q handle")), "Q handle does not paint a filter cursor");

        put(blank);
        const bellSamples = [
            [0.50, 0.50, "Bell on the curve"],
            [0.50, 0.64, "Bell above the curve"],
            [0.50, 0.36, "Bell below the curve"],
        ];
        for (let i = 0; i < bellSamples.length; i++) {
            const label = bellSamples[i][2];
            const h = hoverShape(bellSamples[i][0], bellSamples[i][1], label);
            eq(h.st.hidden, false, `${label} keeps the OS cursor`);
            eq(h.st.mode, 6, `${label} mode`);
            eq(h.st.name, "Bell", `${label} name`);
            ok(!cursorGlyph(h.ops), `${label} does not draw a custom Bell cursor`);
        }
        expectShape(0.08, [
            { ny: 0.5 + cfg.EQP_SHELF_BAND * 0.5, where: "slightly above 0 dB" },
            { ny: 0.5 - cfg.EQP_SHELF_BAND * 0.5, where: "slightly below 0 dB" },
        ], { mode: 5, name: "Low-Shelf", fork: true });
        expectShape(0.08, [
            { ny: 0.22, where: "above and off the curve" },
            { ny: 0.80, where: "below and off the curve" },
        ], { mode: 2, name: "Low-Cut", rise: true });
        expectShape(0.92, [
            { ny: 0.5 + cfg.EQP_SHELF_BAND * 0.5, where: "slightly above 0 dB" },
            { ny: 0.5 - cfg.EQP_SHELF_BAND * 0.5, where: "slightly below 0 dB" },
        ], { mode: 8, name: "High-Shelf", fork: true });
        expectShape(0.92, [
            { ny: 0.22, where: "above and off the curve" },
            { ny: 0.80, where: "below and off the curve" },
        ], { mode: 10, name: "High-Cut", drop: true });

        ui.preview();
        eq(ui.rangeMinDb, -100, "analyzer floor is -100 dB");
        ui.specHasSignal = 1;
        ui.refEnabled = 0;
        for (let i = 0; i < ui.specPre.length; i++) {
            ui.specPre[i] = ui.rangeMinDb;
            ui.specPost[i] = ui.rangeMinDb;
            ui.specRef[i] = -120;
        }
        ui.mgOps = [];
        ui.paintSpectrum(ui.geo());
        const floorOps = ui.mgOps;
        const floorGeom = floorOps.filter((op) => op.op === "move_to" || op.op === "line_to" || op.op === "close_path" || op.op === "curve_to");
        eq(floorGeom.length, 0, "floor spectrum draws no path");
        ok(floorOps.every(function (op, i) {
            if (op.op !== "fill" && op.op !== "stroke") return true;
            for (let j = 0; j < i; j++) {
                const prev = floorOps[j].op;
                if (prev === "move_to" || prev === "line_to" || prev === "close_path" || prev === "curve_to") return false;
            }
            return true;
        }), "floor spectrum draws zero fill or stroke ops");
        let tiltCol = ui.COLS - 2;
        while (tiltCol > 1 && ui.colFreq(tiltCol) < 4000) tiltCol--;
        ok(ui.colFreq(tiltCol) > 4000, "tilt probe is above 1 kHz");
        const tiltAdd = 4.5 * Math.log(ui.colFreq(tiltCol) / 1000) / Math.LN2;
        ok(tiltAdd > 3, "4.5 dB/oct would lift the probe column");
        ui.tiltIdx = 2;
        const nBins = 4096;
        const silent = new Array(nBins);
        const deeper = new Array(nBins);
        const audible = new Array(nBins);
        for (let i = 0; i < nBins; i++) {
            silent[i] = -110;
            deeper[i] = -120;
            audible[i] = -30;
        }
        const silentOut = ui.columnDb(silent, 8192, 48000, tiltCol);
        const deepOut = ui.columnDb(deeper, 8192, 48000, tiltCol);
        const audibleOut = ui.columnDb(audible, 8192, 48000, tiltCol);
        near(silentOut, -110, 1e-3, "-110 dB bins are not tilted");
        near(deepOut, -120, 1e-3, "-120 dB bins are not tilted");
        ok(silentOut <= ui.rangeMinDb && deepOut <= ui.rangeMinDb, "silent bins stay at or below the floor");
        ok(audibleOut > -30 + 2, "a bin above the gate still receives the 4.5 dB/oct tilt");

        {
            const savedTilt = ui.tiltIdx;
            ui.tiltIdx = 2;
            const sr = 48000;
            const n = 8192;
            const f0 = 80;
            const frame = new Array(n);
            for (let i = 0; i < n; i++) {
                const ph = (f0 * i / sr) % 1;
                frame[i] = ph < 0.5 ? 0.6 : -0.6;
            }
            const bins = ui.fftDbBins(frame, n, sr);
            function legacyColumnDb(dbBins, nn, sampleRate, col) {
                const nBins = nn >> 1;
                const scale = nn / Math.max(8000, sampleRate);
                let bLo = ui.colEdge[col] * scale;
                let bHi = ui.colEdge[col + 1] * scale;
                if (bLo < 1) bLo = 1;
                if (bHi < bLo) bHi = bLo;
                const last = nBins - 1;
                if (bLo > last) bLo = last;
                if (bHi > last) bHi = last;
                let db;
                if (bHi - bLo <= 1.25) {
                    const mid = 0.5 * (bLo + bHi);
                    let idx = Math.floor(mid);
                    if (idx < 1) idx = 1;
                    if (idx > nBins - 2) idx = nBins - 2;
                    const t = mid - idx;
                    db = dbBins[idx] + (dbBins[idx + 1] - dbBins[idx]) * t;
                } else {
                    const i0 = Math.max(1, Math.floor(bLo));
                    const i1 = Math.min(last, Math.ceil(bHi));
                    db = -240;
                    for (let b = i0; b <= i1; b++) if (dbBins[b] > db) db = dbBins[b];
                }
                const tilt = ui.EQP_TILTS[ui.tiltIdx] || 0;
                if (tilt && !(tilt > 0 && db <= -108)) db += tilt * (Math.log(ui.colFreq(col) / 1000) / Math.LN2);
                return db;
            }
            const legacy = [];
            for (let i = 0; i < ui.COLS; i++) legacy.push(legacyColumnDb(bins, n, sr, i));
            const detailed = [];
            for (let i = 0; i < ui.SPEC_COLS; i++) detailed.push(ui.specColumnDb(bins, n, sr, i));
            function maxDrop(cols) {
                let m = 0;
                for (let i = 1; i < cols.length; i++) m = Math.max(m, Math.abs(cols[i] - cols[i - 1]));
                return m;
            }
            const legacyDrop = maxDrop(legacy);
            ok(legacyDrop > 40, `square-wave spectrum cliffs before the fix (${legacyDrop.toFixed(1)} dB)`);
            function peakNear(cols, freq) {
                const lo = freq / 1.08;
                const hi = freq * 1.08;
                let m = -240;
                for (let i = 0; i < cols.length; i++) {
                    const f = ui.specFreq(i);
                    if (f >= lo && f <= hi && cols[i] > m) m = cols[i];
                }
                return m;
            }
            function minBetween(cols, fLo, fHi) {
                let m = 240;
                let seen = false;
                for (let i = 0; i < cols.length; i++) {
                    const f = ui.specFreq(i);
                    if (f < fLo || f > fHi) continue;
                    seen = true;
                    if (cols[i] < m) m = cols[i];
                }
                return seen ? m : -240;
            }
            const fund = peakNear(detailed, f0);
            ok(fund > -30, `square fundamental is visible (${fund.toFixed(1)} dB)`);
            let teeth = 0;
            for (const harm of [3, 5, 7, 9, 11, 13, 15]) {
                const got = peakNear(detailed, f0 * harm);
                const tilt = 4.5 * Math.log2(harm);
                const expect = fund - 20 * Math.log(harm) / Math.LN10 + tilt;
                near(got, expect, 8, `harmonic ${harm} stays on the 1/n slope`);
                const valley = minBetween(detailed, f0 * harm * 1.2, f0 * (harm + 2) * 0.8);
                if (got - valley > 18) teeth++;
            }
            ok(teeth >= 5, `square-wave harmonics stay separate (${teeth})`);
            ui.tiltIdx = 0;
            const flat = [];
            for (let i = 0; i < ui.SPEC_COLS; i++) flat.push(ui.specColumnDb(bins, n, sr, i));
            const hi = peakNear(flat, 8000);
            ok(hi > ui.rangeMinDb + 25, `8 kHz harmonic stays above the old cutoff (${hi.toFixed(1)} dB)`);
            const hiFund = peakNear(flat, f0);
            const hiValley = minBetween(flat, f0 * 1.4, f0 * 2.4);
            ok(hiFund - hiValley > 25, `null under the fundamental stays deep (${(hiFund - hiValley).toFixed(1)} dB)`);
            const drawn = ui.smoothSpectrumLine(flat);
            const drawnValley = minBetween(drawn, f0 * 1.4, f0 * 2.4);
            ok(peakNear(drawn, f0) - drawnValley > 18, "smoothed spectrum keeps the harmonic null");
            let plateau = 1;
            let run = 1;
            for (let i = 1; i < drawn.length; i++) {
                const f = ui.specFreq(i);
                if (f < f0 * 0.75 || f > f0 * 1.35) { run = 1; continue; }
                if (Math.abs(drawn[i] - drawn[i - 1]) < 0.35) run++;
                else run = 1;
                if (run > plateau) plateau = run;
            }
            ok(plateau < 8, `fundamental is a curve, not a flat bin (${plateau} columns)`);
            let steep = 0;
            for (let i = 1; i < drawn.length; i++) {
                const f = ui.specFreq(i);
                if (f < 200 || f > 2500) continue;
                if (Math.max(drawn[i], drawn[i - 1]) < -48) continue;
                steep = Math.max(steep, Math.abs(drawn[i] - drawn[i - 1]));
            }
            ok(steep < 10, `smoothed spectrum has no bin-sized step (${steep.toFixed(1)} dB)`);
            let drawnTeeth = 0;
            for (const harm of [3, 5, 7, 9]) {
                const got = peakNear(drawn, f0 * harm);
                const valley = minBetween(drawn, f0 * harm * 1.25, f0 * (harm + 2) * 0.75);
                if (got - valley > 12) drawnTeeth++;
            }
            ok(drawnTeeth >= 3, `smoothed harmonics stay separate (${drawnTeeth})`);
            ui.tiltIdx = 2;
            const { execFileSync } = require("child_process");
            const outDir = path.join(ROOT, "tests", "out");
            fs.mkdirSync(outDir, { recursive: true });
            const jsonPath = path.join(outDir, "eq_square_spectrum.json");
            fs.writeFileSync(jsonPath, JSON.stringify({
                legacyFreqs: Array.from({ length: ui.COLS }, (_, i) => ui.colFreq(i)),
                freqs: Array.from({ length: ui.SPEC_COLS }, (_, i) => ui.specFreq(i)),
                legacy,
                shaped: drawn,
                floor: -100,
                ceil: 0,
            }));
            const glitchPng = path.join(outDir, "eq_square_glitch.png");
            const fixedPng = path.join(outDir, "eq_square_fixed.png");
            execFileSync("python3", ["-c", `
import json, sys
from PIL import Image, ImageDraw
data = json.load(open(sys.argv[1]))
floor, ceil = data["floor"], data["ceil"]
W, H, plotH = 740, 250, 170
left, top = 36, 28
def render(series, freqs, title, path):
    im = Image.new("RGB", (W, H), (18, 22, 28))
    d = ImageDraw.Draw(im)
    d.text((left, 8), title, fill=(180, 186, 194))
    def x_of(f):
        import math
        t = math.log(max(f, 20) / 20) / math.log(1000)
        return left + t * (W - left - 16)
    def y_of(db):
        t = (db - floor) / (ceil - floor)
        t = 0 if t < 0 else 1 if t > 1 else t
        return top + (1 - t) * plotH
    d.rectangle([left, top, W - 16, top + plotH], fill=(12, 14, 18))
    for f, label in ((100, "100"), (1000, "1k"), (10000, "10k")):
        x = x_of(f)
        d.line([(x, top), (x, top + plotH)], fill=(40, 46, 54))
        d.text((x + 3, top + 2), label, fill=(120, 126, 134))
    zy = y_of(0)
    d.line([(left, zy), (W - 16, zy)], fill=(210, 140, 60))
    pts = [(x_of(freqs[i]), y_of(series[i])) for i in range(len(series))]
    if len(pts) >= 2:
        d.line(pts, fill=(40, 190, 200), width=1)
    im.save(path)
render(data["legacy"], data["legacyFreqs"], "before: coarse columns", sys.argv[2])
render(data["shaped"], data["freqs"], "after: smoothed harmonic lines", sys.argv[3])
`, jsonPath, glitchPng, fixedPng]);
            ok(fs.existsSync(glitchPng) && fs.statSync(glitchPng).size > 1000, "glitch reproduction image was written");
            ok(fs.existsSync(fixedPng) && fs.statSync(fixedPng).size > 1000, "fixed spectrum image was written");
            ui.analyzerPre = 0;
            ui.analyzerPost = 1;
            ui.specHasSignal = 1;
            ui.tiltIdx = 0;
            for (let bi = 0; bi < ui.bands.length; bi++) {
                ui.bands[bi].enabled = 0;
                ui.bands[bi].mode = 0;
            }
            for (let i = 0; i < ui.SPEC_COLS; i++) ui.specPost[i] = flat[i];
            ui.mgOps = [];
            const painted = ui.geo();
            ui.paintSpectrum(painted);
            const x10k = ui.freqToX(painted, 10000);
            const floorY = painted.plotY + painted.plotH;
            let reached = 0;
            for (let i = 0; i < ui.mgOps.length; i++) {
                const op = ui.mgOps[i];
                if (op.op !== "line_to" && op.op !== "move_to") continue;
                const x = Number(op.args[0]);
                const y = Number(op.args[1]);
                if (x >= x10k - 2 && y < floorY - 8) reached++;
            }
            ok(reached > 0, "painted spectrum is still above the floor at 10 kHz");
            ui.tiltIdx = savedTilt;
        }

        ui.preview();
        const plot = ui.geo();
        const node0 = ui.bandXY(plot, ui.bands[0]);
        const node1 = ui.bandXY(plot, ui.bands[1]);
        const handle = ui.qHandlePos(plot, 1);
        const x0 = plot.plotX + 6;
        const y0 = plot.plotY + 4;
        const x1 = plot.plotX + plot.plotW - 6;
        const y1 = plot.plotY + plot.plotH - 6;
        function clearOf(pt) { return Math.hypot(x0 - pt.x, y0 - pt.y) > 20; }
        ok(clearOf(node0) && clearOf(node1) && clearOf(handle), "marquee starts in empty plot space");
        ok(node0.x >= x0 && node0.x <= x1 && node0.y >= y0 && node0.y <= y1, "band 1 sits inside the marquee");
        ok(node1.x >= x0 && node1.x <= x1 && node1.y >= y0 && node1.y <= y1, "band 2 sits inside the marquee");
        ui.onclick(x0, y0, 1, 0, 0, 0, 0, 0);
        ui.ondrag(x1, y1, 1, 0, 0, 0, 0, 0);
        const boxed = ui.getSelectedBands().slice().sort(function (a, b) { return a - b; });
        eq(boxed.length, 2, "marquee selects two bands");
        eq(boxed[0], 0, "marquee selects band 1");
        eq(boxed[1], 1, "marquee selects band 2");
        ui.mgOps = [];
        ui.paint();
        const boxX = Math.min(x0, x1);
        const boxY = Math.min(y0, y1);
        const boxW = Math.abs(x1 - x0);
        const boxH = Math.abs(y1 - y0);
        ok(ui.mgOps.some(function (op, i) {
            if (op.op !== "rectangle") return false;
            if (Math.abs(Number(op.args[0]) - boxX) > 1 || Math.abs(Number(op.args[1]) - boxY) > 1) return false;
            if (Math.abs(Number(op.args[2]) - boxW) > 1 || Math.abs(Number(op.args[3]) - boxH) > 1) return false;
            return ui.mgOps.slice(i, i + 8).some(function (next) {
                return next.op === "set_source_rgba" && Math.abs(Number(next.args[3]) - 0.55) < 0.05;
            });
        }), "marquee paint draws the selection rectangle");
        ui.ondrag(x1, y1, 0, 0, 0, 0, 0, 0);
        const kept = ui.getSelectedBands();
        ok(kept.indexOf(0) >= 0 && kept.indexOf(1) >= 0, "marquee selection survives mouseup");
        const dragFrom = ui.bandXY(ui.geo(), ui.bands[1]);
        const freq0 = ui.bands[0].freq;
        const freq1 = ui.bands[1].freq;
        const gain0 = ui.bands[0].gain;
        const gain1 = ui.bands[1].gain;
        const q0 = ui.bands[0].q;
        ui.onclick(dragFrom.x, dragFrom.y, 1, 0, 0, 0, 0, 0);
        ui.ondrag(dragFrom.x + 28, dragFrom.y - 22, 1, 0, 0, 0, 0, 0);
        const d0 = cfg.eqpFreqToNorm(ui.bands[0].freq) - cfg.eqpFreqToNorm(freq0);
        const d1 = cfg.eqpFreqToNorm(ui.bands[1].freq) - cfg.eqpFreqToNorm(freq1);
        ok(d0 > 0.02 && d1 > 0.02, "dragging one selected band moves both up in frequency");
        near(d0, d1, 0.015, "both selected bands share the frequency delta");
        ok(ui.bands[1].gain > gain1 + 0.4, "the bell's gain moves with the drag");
        near(ui.bands[0].gain, gain0, 1e-6, "the high-cut keeps its gain");
        ok(Math.abs(ui.bands[0].q - q0) > 0.05, "the high-cut's Q moves with the drag");
        ui.ondrag(dragFrom.x + 28, dragFrom.y - 22, 0, 0, 0, 0, 0, 0);
        const cutAt = ui.bandXY(ui.geo(), ui.bands[0]);
        ui.onclick(cutAt.x, cutAt.y, 1, 0, 1, 0, 0, 0);
        const removed = ui.getSelectedBands();
        ok(removed.indexOf(0) < 0, "shift-click removes band 1 from the selection");
        ok(removed.indexOf(1) >= 0, "shift-click leaves band 2 selected");
        ui.onclick(cutAt.x, cutAt.y, 1, 0, 1, 0, 0, 0);
        const added = ui.getSelectedBands();
        ok(added.indexOf(0) >= 0 && added.indexOf(1) >= 0, "shift-click adds band 1 back");

        ui.preview();
        log.length = 0;
        ui.set_sidechain_fold(1);
        eq(ui.showSidechainFold, 1, "set_sidechain_fold opens the fold");
        ok(widthCmds().indexOf(488) >= 0, "fold emits setwidth 488");
        eq(ui.geo().plotX, 130, "fold shifts the plot right by 128 px");
        eq(ui.named["obj-viz"].rect[2], 480, "fold viz width");
        eq(ui.named["obj-panel-bg"].rect[2], 488, "fold panel width");
        log.length = 0;
        ui.set_filters_shelf(1);
        ui.set_analyzer_shelf(1);
        ok(widthCmds().indexOf(884) >= 0, "fold plus both shelves emits setwidth 884");
        eq(ui.geo().plotX, 130, "plot stays shifted with every shelf open");
        eq(ui.named["obj-viz"].rect[2], 876, "all-open viz width");
        eq(ui.named["obj-panel-bg"].rect[2], 884, "all-open panel width");
        ui.preview();
        log.length = 0;
        eq(ui.geo().plotX, 20, "collapsed tab shifts the plot by 18 px");
        eq(cfg.eqpComputeDeviceWidth(0, 0, 0), 378, "collapsed width keeps the sidechain tab");
        ui.onclick(9, 11, 1, 0, 0, 0, 0, 0);
        eq(ui.showSidechainFold, 1, "sidechain disclosure opens the fold");
        ok(widthCmds().indexOf(488) >= 0, "disclosure emits setwidth 488");
        eq(ui.geo().plotX, 130, "disclosure shifts the plot right by 128 px");
        ui.mgOps = [];
        ui.paint();
        ok(ui.mgOps.some(function (op) {
            return op.op === "show_text" && String(op.args[0]) === "Sidechain";
        }), "sidechain tab paints its label");
        ok(!ui.mgOps.some(function (op) {
            return op.op === "show_text" && String(op.args[0]) === "S";
        }), "sidechain tab has no S button");

        ui.preview();
        const enableRef = typeof ui.set_ref_enable === "function" ? ui.set_ref_enable : ui.set_ref;
        enableRef(1);
        eq(ui.refEnabled, 1, "reference enable turns the reference on");
        const ring = new Array(8192);
        for (let i = 0; i < ring.length; i++) ring[i] = 0.8 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
        ui.specSidechain = ring;
        ui.pullSpectrum();
        ok(ui.specRef.some(function (v) { return v > ui.rangeMinDb + 1; }), "channel 4 lifts the reference off the floor");
        ui.mgOps = [];
        ui.paint();
        ok(ui.mgOps.some(function (op, i) {
            if (op.op !== "set_source_rgba") return false;
            const a = op.args;
            if (Math.abs(Number(a[0]) - 1) > 0.03) return false;
            if (Math.abs(Number(a[1]) - 0.412) > 0.03) return false;
            if (Math.abs(Number(a[2]) - 0.498) > 0.03) return false;
            if (Number(a[3]) < 0.5) return false;
            const before = ui.mgOps.slice(Math.max(0, i - 6), i);
            const after = ui.mgOps.slice(i, i + 5);
            return before.some(function (n) { return n.op === "move_to" || n.op === "line_to"; })
                && after.some(function (n) { return n.op === "stroke"; });
        }), "paint draws the reference spectrum in Live's second handle colour");
        ui.specSidechain = null;

        ui.preview();
        const blob = take();
        blob[54] = 1;
        blob[55] = 1;
        blob[56] = -6.4;
        put(blob);
        eq(ui.showSidechainFold, 1, "setvalueof restores the sidechain fold");
        eq(ui.refEnabled, 1, "setvalueof restores the reference enable");
        near(ui.refGainDb, -6.4, 1e-6, "setvalueof restores the reference gain");
        const round = take();
        eq(Number(round[54]), 1, "getvalueof keeps the sidechain fold");
        eq(Number(round[55]), 1, "getvalueof keeps the reference enable");
        near(Number(round[56]), -6.4, 1e-6, "getvalueof keeps the reference gain");

        ui.preview();
        ui.mgOps = null;
        ui.specSidechain = null;
        ui.outlet = savedOutlet;
    }

    function verifyBandBarAndShelves() {
        const savedOutlet = ui.outlet;
        const log = [];
        ui.outlet = function () { log.push(Array.prototype.slice.call(arguments)); };
        function unpack(args) {
            let rest = args.slice(1);
            if (rest.length === 1 && rest[0] && typeof rest[0] !== "string" && typeof rest[0].length === "number") {
                rest = Array.prototype.slice.call(rest[0]);
            }
            return { inlet: args[0], rest: rest };
        }
        function since(from) {
            const out = [];
            for (let i = from; i < log.length; i++) out.push(unpack(log[i]));
            return out;
        }
        function lastParam(from, name) {
            const rows = since(from).filter((m) => m.inlet === 0 && m.rest[0] === "param" && m.rest[1] === name);
            return rows.length ? rows[rows.length - 1].rest[2] : undefined;
        }
        function dragUp(x, y, dy) {
            ui.onclick(x, y, 1, 0, 0, 0, 0, 0);
            ui.ondrag(x, y - dy, 1, 0, 0, 0, 0, 0);
            ui.ondrag(x, y - dy, 0, 0, 0, 0, 0, 0);
        }
        function bandScreen(b) {
            const range = cfg.EQP_RANGES[ui.rangeIdx | 0];
            const freq = cfg.eqpEffectiveFreq(b.freq, ui.shiftSt);
            const x = PLOT_X + cfg.eqpFreqToNorm(freq) * 348;
            const n = cfg.eqpBandUsesGain(b.mode) ? cfg.eqpDbToNorm(b.gain, range) : cfg.eqpQToNorm(b.q);
            return [x, 23 + (1 - n) * 115];
        }
        function qHandleScreen(b) {
            const p = bandScreen(b);
            let y = p[1] - 13.5;
            if (y - 4.875 < 23) y = p[1] + 13.5;
            return [p[0], y];
        }
        function cardOf(i) {
            const x = (PLOT_X - 2) + 352 + 4 + (i < 4 ? 0 : 121);
            const y = 2 + (i % 4) * 40;
            return {
                power: [x + 11, y + 10],
                mode: [x + 60, y + 10],
                freq: [x + 24, y + 26],
                gain: [x + 66, y + 26],
                q: [x + 100, y + 26],
            };
        }
        function expectSize(filters, analyzer, label) {
            const dev = cfg.eqpComputeDeviceWidth(filters, analyzer);
            const viz = ui.named["obj-viz"].rect;
            const panel = ui.named["obj-panel-bg"].rect;
            deep(viz, [4, 4, dev - 8, 161], `${label} resizes obj-viz`);
            deep(panel, [0, 0, dev, 169], `${label} resizes obj-panel-bg`);
        }

        ui.preview();
        ui.selectedBand = 1;
        ui.bottomAnalyzer = 0;
        ui.hoverBand = -1;
        eq(ui.selectedBand, 1, "bottom bar edits the selected bell");
        const selected = bandAt(take(), 1);
        eq(selected.enabled, 1, "selected bell starts enabled");

        let mark = log.length;
        mouseClick(56, 149);
        eq(ui.soloBand, ui.selectedBand, "speaker soloes the selected band");
        const soloOn = since(mark).filter((m) => m.inlet === 1 && String(m.rest[0]).indexOf("solo") === 0);
        const soloNames = soloOn.map((m) => m.rest[0]);
        deep(soloNames, ["soloB0", "soloB1", "soloB2", "soloA1", "soloA2", "soloBand"], "speaker emits the solo biquad");
        const coeffs = cfg.eqpSoloBandCoeffs(
            cfg.eqpEffectiveFreq(selected.freq, ui.shiftSt),
            cfg.eqpEffectiveQ(selected.q, selected.gain, ui.adaptiveQ, selected.mode),
            SR
        );
        near(Number(soloOn[0].rest[1]), coeffs.b0, 1e-4, "soloB0");
        near(Number(soloOn[1].rest[1]), coeffs.b1, 1e-4, "soloB1");
        near(Number(soloOn[2].rest[1]), coeffs.b2, 1e-4, "soloB2");
        near(Number(soloOn[3].rest[1]), coeffs.a1, 1e-4, "soloA1");
        near(Number(soloOn[4].rest[1]), coeffs.a2, 1e-4, "soloA2");
        eq(Number(soloOn[5].rest[1]), 1, "soloBand message is the selected band");
        mark = log.length;
        mouseClick(56, 149);
        eq(ui.soloBand, -1, "speaker click again clears solo");
        const soloOff = since(mark).filter((m) => m.inlet === 1 && String(m.rest[0]).indexOf("solo") === 0);
        eq(soloOff.length, 1, "clearing solo sends one solo message");
        deep(soloOff[0].rest, ["soloBand", -1], "clearing solo emits soloBand -1");

        mark = log.length;
        mouseClick(75, 149);
        eq(bandAt(take(), 1).enabled, 0, "power turns the selected band off");
        eq(Number(lastParam(mark, "b2_enable")), 0, "power emits b2_enable 0");
        mark = log.length;
        mouseClick(75, 149);
        eq(bandAt(take(), 1).enabled, 1, "power turns the selected band back on");
        eq(Number(lastParam(mark, "b2_enable")), 1, "power emits b2_enable 1");
        eq(bandAt(take(), 1).mode, 6, "power leaves the bell mode alone");

        ui.mgOps = [];
        ui.paint();
        const soloCups = ui.mgOps.filter((op) => op.op === "ellipse" && op.args[0] >= 46 && op.args[0] <= 66 && op.args[1] >= 140);
        eq(soloCups.length, 2, "solo control draws Ableton headphone cups");
        const powerSq = ui.mgOps.filter((op) => op.op === "rectangle_rounded" && op.args[0] >= 66 && op.args[0] <= 84 && op.args[1] >= 140);
        ok(powerSq.length >= 1, "on/off control is an Ableton square");
        eq(powerSq[0].args[2], 7, "on/off square is about 4 px smaller");
        ok(soloCups.every((op) => Number(op.args[3]) <= 6), "headphone cups are drawn in the smaller box");
        const bar = ui.uiLayout(ui.geo());
        const iconMid = bar.bandSel.y + bar.bandSel.h * 0.5;
        const cupMid = soloCups.reduce((s, op) => s + Number(op.args[1]) + Number(op.args[3]) * 0.5, 0) / soloCups.length;
        const sqMid = Number(powerSq[0].args[1]) + Number(powerSq[0].args[3]) * 0.5;
        near(cupMid, iconMid, 3, "headphones sit on the bottom-row center");
        near(sqMid, iconMid, 1.5, "on/off square sits on the bottom-row center");
        function rectsOverlap(a, b) {
            return a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
        }
        ok(bar.freq.x <= bar.mode.x + bar.mode.w + 6, "frequency readout sits against the filter control");
        ok(bar.bandGain.x <= bar.freq.x + bar.freq.w + 6, "gain readout follows frequency");
        ok(bar.q.x + bar.q.w <= bar.filtersToggle.x - 4, "readouts stop before the shelf toggles");
        ok(bar.filtersToggle.x > bar.q.x && bar.analyzerToggle.x > bar.filtersToggle.x, "shelf toggles stay on the right");
        const azRects = [bar.bandSel, bar.azLabel, bar.pre, bar.post, bar.resLabel, bar.res, bar.speedLabel, bar.speed, bar.filtersToggle, bar.analyzerToggle];
        for (let a = 0; a < azRects.length; a++) {
            for (let b = a + 1; b < azRects.length; b++) {
                ok(!rectsOverlap(azRects[a], azRects[b]), `analyzer controls ${a} and ${b} do not overlap`);
            }
        }
        ok(bar.speed.x + bar.speed.w <= bar.filtersToggle.x - 2, "analyzer controls stop before the shelf toggles");
        ui.bottomAnalyzer = 1;
        ui.mgOps = [];
        ui.paint();
        const analyzerText = ui.mgOps.find((op, i) => op.op === "show_text" && String(op.args[0]) === "Analyzer" && ui.mgOps[i - 1] && ui.mgOps[i - 1].op === "move_to");
        ok(!!analyzerText, "analyzer mode paints Analyzer");
        const analyzerX = Number(ui.mgOps[ui.mgOps.indexOf(analyzerText) - 1].args[0]);
        ok(analyzerX >= bar.azLabel.x - 1 && analyzerX + 8 * 5.6 < bar.pre.x, "Analyzer label ends before Pre");
        ui.bottomAnalyzer = 0;
        ui.closePopup();
        mouseClick(bar.bandSel.x + 8, bar.bandSel.y + 8);
        const labels = (ui.popup && ui.popup.items || []).map((item) => item.label);
        ok(labels.indexOf("Analyzer") >= 0, "band menu offers Analyzer");
        ok(labels.every((label) => String(label).indexOf("|") < 0), "band menu does not append extra analyzer text");
        ui.closePopup();
        const bellSides = ui.mgOps.filter((op) => (op.op === "move_to" || op.op === "line_to") && op.args[0] >= 88 && op.args[0] <= 108 && op.args[1] >= 143 && op.args[1] <= 156);
        ok(bellSides.length >= 6, "bell icon is the Ableton hexagon");
        ui.set_band_mode(1, 4);
        ui.mgOps = [];
        ui.paint();
        ok(ui.mgOps.some((op) => op.op === "show_text" && String(op.args[0]) === "\u00d74"), "48 dB low cut shows \u00d74");
        ui.set_band_mode(1, 12);
        ui.mgOps = [];
        ui.paint();
        ok(ui.mgOps.some((op) => op.op === "show_text" && String(op.args[0]) === "\u00d74"), "48 dB high cut shows \u00d74");
        ui.set_band_mode(1, 6);

        function armKeys() {
            ui.lastKeyAt.disable = 0;
            ui.lastKeyAt.gain = 0;
            ui.lastKeyAt.freq = 0;
        }
        ui.set_band_mode(0, 6);
        ui.set_band_enable(0, 1);
        ui.set_band_freq(0, 1000);
        ui.set_band_gain(0, 1);
        ui.set_band_mode(1, 8);
        ui.set_band_enable(1, 1);
        ui.set_band_freq(1, 4000);
        ui.set_band_gain(1, 2);
        ui.set_band_mode(2, 7);
        ui.set_band_enable(2, 1);
        ui.set_band_freq(2, 800);
        ui.set_band_gain(2, 3);
        ui.selectedBands = [0, 1, 2];
        ui.selectedBand = 0;
        armKeys();
        const undoBefore = ui.undoStack.length;
        const notesBeforeKeys = ui.notifyCount;
        ui.hotkey_gain(1);
        near(bandAt(take(), 0).gain, 1.5, 1e-6, "up adds 0.5 dB to a bell");
        near(bandAt(take(), 1).gain, 2.5, 1e-6, "up adds 0.5 dB to a shelf");
        near(bandAt(take(), 2).gain, 3, 1e-6, "up leaves a notch gain alone");
        eq(ui.undoStack.length, undoBefore + 1, "one gain nudge is one undo");
        ok(ui.notifyCount > notesBeforeKeys, "a gain nudge notifies clients");
        ui.undo();
        near(bandAt(take(), 0).gain, 1, 1e-6, "undo restores the bell gain");
        armKeys();
        ui.onkeydown(31, 0, 1);
        near(bandAt(take(), 0).gain, 0.5, 1e-6, "down removes 0.5 dB");
        ui.onkeydown(31, 0, 0);
        near(bandAt(take(), 0).gain, 0.5, 1e-6, "key-up does not nudge again");
        ui.selectedBands = [0];
        ui.selectedBand = 0;
        ui.set_band_gain(0, 36);
        armKeys();
        const cappedNotes = ui.notifyCount;
        ui.hotkey_gain(1);
        near(bandAt(take(), 0).gain, 36, 1e-6, "gain nudge stops at +36 dB");
        eq(ui.notifyCount, cappedNotes, "a nudge that cannot move does not notify");
        ui.selectedBands = [0, 1, 2];
        ui.selectedBand = 0;
        ui.set_band_freq(0, 1000);
        armKeys();
        ui.hotkey_freq(1);
        near(bandAt(take(), 0).freq, 1000 * Math.pow(2, 1 / 12), 0.05, "right moves a filter up one semitone");
        near(bandAt(take(), 2).freq, 800 * Math.pow(2, 1 / 12), 0.05, "right also moves a notch");
        armKeys();
        ui.onkeydown("ArrowLeft", "", 1);
        near(bandAt(take(), 0).freq, 1000, 0.05, "left moves that filter back one semitone");
        ui.set_band_freq(0, 20);
        armKeys();
        ui.hotkey_freq(-1);
        near(bandAt(take(), 0).freq, 20, 1e-6, "left stops at 20 Hz");
        armKeys();
        ui.hotkey_disable();
        eq(bandAt(take(), 0).enabled, 0, "delete disables the bell");
        eq(bandAt(take(), 1).enabled, 0, "delete disables the shelf");
        eq(bandAt(take(), 2).enabled, 0, "delete disables the notch");
        eq(bandAt(take(), 0).mode, 6, "delete leaves the bell mode");
        eq(bandAt(take(), 2).mode, 7, "delete leaves the notch mode");
        armKeys();
        const offNotes = ui.notifyCount;
        ui.hotkey_disable();
        eq(ui.notifyCount, offNotes, "delete on bands that are already off does nothing");
        ui.set_band_enable(0, 1);
        ui.selectedBands = [];
        ui.selectedBand = -1;
        armKeys();
        ui.onkeydown(127, 127, 1);
        eq(bandAt(take(), 0).enabled, 1, "delete with nothing selected leaves bands on");

        ui.preview();
        ui.selectedBand = 1;
        ui.selectedBands = [1];
        ui.bottomAnalyzer = 0;
        ui.hoverBand = -1;

        const dy = 40;
        let before = bandAt(take(), 1);
        dragUp(213, 149, dy);
        let after = bandAt(take(), 1);
        near(after.freq, Math.min(20000, Math.max(20, before.freq * Math.exp(dy * 0.01))), 1e-3, "bottom-bar Freq drag");
        near(after.gain, before.gain, 1e-6, "Freq drag leaves gain");
        near(after.q, before.q, 1e-6, "Freq drag leaves Q");
        before = after;
        dragUp(267, 149, dy);
        after = bandAt(take(), 1);
        near(after.gain, Math.min(cfg.EQP_GAIN_MAX, Math.max(cfg.EQP_GAIN_MIN, Math.round((before.gain + dy * 0.12) / 0.1) * 0.1)), 1e-6, "bottom-bar Gain drag");
        near(after.freq, before.freq, 1e-6, "Gain drag leaves frequency");
        near(after.q, before.q, 1e-6, "Gain drag leaves Q");
        before = after;
        dragUp(325, 149, dy);
        after = bandAt(take(), 1);
        near(after.q, Math.min(40, Math.max(0.1, before.q * Math.exp(dy * 0.012))), 1e-4, "bottom-bar Q drag");
        near(after.freq, before.freq, 1e-6, "Q drag leaves frequency");
        near(after.gain, before.gain, 1e-6, "Q drag leaves gain");

        before = bandAt(take(), 1);
        const handle = qHandleScreen(before);
        const others = take().slice(12, 52);
        ui.onclick(handle[0], handle[1], 1, 0, 0, 0, 0, 0);
        ui.ondrag(handle[0], handle[1] - 36, 1, 0, 0, 0, 0, 0);
        ui.ondrag(handle[0], handle[1] - 36, 0, 0, 0, 0, 0, 0);
        after = bandAt(take(), 1);
        const n0 = cfg.eqpQToNorm(before.q);
        const wantQ = cfg.eqpNormToQ(Math.min(1, Math.max(0, n0 + 36 / 140)));
        near(after.q, wantQ, 1e-4, "Q handle drag");
        near(after.freq, before.freq, 1e-6, "Q handle leaves frequency");
        near(after.gain, before.gain, 1e-6, "Q handle leaves gain");
        eq(after.enabled, before.enabled, "Q handle leaves enable");
        eq(after.mode, before.mode, "Q handle leaves mode");
        const afterAll = take().slice(12, 52);
        for (let i = 0; i < 8; i++) {
            if (i === 1) continue;
            const o = i * 5;
            ok(afterAll[o] === others[o] && afterAll[o + 1] === others[o + 1]
                && afterAll[o + 2] === others[o + 2] && afterAll[o + 3] === others[o + 3]
                && afterAll[o + 4] === others[o + 4], `Q handle leaves band ${i + 1}`);
        }

        ui.set_range(0);
        ui.set_shift(0);
        ui.set_band_enable(0, 1);
        ui.set_band_mode(0, 6);
        ui.set_band_freq(0, 1000);
        ui.set_band_q(0, 1);
        ui.set_band_gain(0, 24);
        ui.selectedBand = 0;
        ui.selectedBands = [0];
        ui.hoverBand = -1;
        let painted = ui.bandXY(ui.geo(), ui.bands[0]);
        ui.onclick(painted.x, painted.y, 1, 0, 0, 0, 0, 0);
        ui.ondrag(painted.x, painted.y, 1, 0, 0, 0, 0, 0);
        ui.ondrag(painted.x, painted.y, 0, 0, 0, 0, 0, 0);
        near(ui.bands[0].gain, 24, 0.05, "click on a clamped gain dot keeps +24 dB");
        near(ui.bands[0].freq, 1000, 0.05, "clamped gain click leaves frequency");
        ui.set_band_gain(0, 0);
        ui.set_shift(-12);
        ui.set_band_freq(0, 40);
        painted = ui.bandXY(ui.geo(), ui.bands[0]);
        ui.onclick(painted.x, painted.y, 1, 0, 0, 0, 0, 0);
        ui.ondrag(painted.x, painted.y, 1, 0, 0, 0, 0, 0);
        ui.ondrag(painted.x, painted.y, 0, 0, 0, 0, 0, 0);
        near(ui.bands[0].freq, 40, 0.05, "click on a shift-clamped frequency dot keeps 40 Hz");
        ui.set_shift(0);
        ui.set_band_freq(0, 1000);
        ui.set_band_gain(0, 4);
        ui.set_band_q(0, 2.5);
        const liveBefore = ui.bands.filter(function (b) { return b.enabled; }).length;
        const qh = ui.qHandlePos(ui.geo(), 0);
        ui.ondblclick(qh.x, qh.y, 1, 0, 0, 0, 0, 0);
        near(ui.bands[0].q, cfg.EQP_Q_DEFAULT, 1e-4, "double-click on the Q handle resets Q");
        eq(ui.bands.filter(function (b) { return b.enabled; }).length, liveBefore, "Q-handle double-click does not create a band");

        eq(cfg.eqpComputeDeviceWidth(1, 0), 626, "filters shelf device width is 626");
        eq(cfg.eqpComputeDeviceWidth(1, 1), 774, "both shelves device width is 774");
        ui.preview();
        mark = log.length;
        mouseClick(348, 149);
        eq(ui.showFiltersShelf, 1, "filters shelf toggle opens");
        eq(ui.showAnalyzerShelf, 0, "filters toggle leaves the analyzer shelf closed");
        ok(since(mark).some((m) => m.inlet === 0 && m.rest[0] === "setwidth_cmd" && Number(m.rest[1]) === 626), "filters shelf emits setwidth_cmd 626");
        eq(Number(lastParam(mark, "filters_shelf")), 1, "filters shelf emits filters_shelf 1");
        expectSize(1, 0, "filters shelf");
        mark = log.length;
        mouseClick(362, 149);
        eq(ui.showAnalyzerShelf, 1, "analyzer shelf toggle opens");
        eq(ui.showFiltersShelf, 1, "analyzer toggle leaves the filters shelf open");
        ok(since(mark).some((m) => m.inlet === 0 && m.rest[0] === "setwidth_cmd" && Number(m.rest[1]) === 774), "analyzer shelf emits setwidth_cmd 774");
        eq(Number(lastParam(mark, "analyzer_shelf")), 1, "analyzer shelf emits analyzer_shelf 1");
        expectSize(1, 1, "both shelves");
        ui.mgOps = [];
        ui.paint();
        ok(!ui.mgOps.some((op) => op.op === "show_text" && /Reference|\u00d7 None/.test(String(op.args[0]))), "analyzer shelf has no Reference row");
        ui.showSidechainFold = 1;
        ui.mgOps = [];
        ui.paint();
        ok(ui.mgOps.some((op) => op.op === "show_text" && String(op.args[0]) === "Audio From"), "sidechain panel keeps Audio From");
        ok(ui.mgOps.some((op) => op.op === "show_text" && String(op.args[0]) === "Gain"), "sidechain panel keeps Gain");
        ui.showSidechainFold = 0;
        ui.applyDeviceWidth();
        ui.mgOps = null;
        eq(ui.refEnabled, 0, "the analyzer shelf does not own the reference");
        mouseClick(692, 144);
        eq(ui.refEnabled, 0, "the old analyzer Reference row no longer toggles");

        for (let i = 0; i < 8; i++) {
            const card = cardOf(i);
            const name = `b${i + 1}_enable`;
            const was = bandAt(take(), i).enabled;
            mark = log.length;
            mouseClick(card.power[0], card.power[1]);
            eq(bandAt(take(), i).enabled, was ? 0 : 1, `card ${i + 1} power toggles enable`);
            eq(Number(lastParam(mark, name)), was ? 0 : 1, `card ${i + 1} emits ${name}`);
            mouseClick(card.power[0], card.power[1]);
            eq(bandAt(take(), i).enabled, was ? 1 : 0, `card ${i + 1} power toggles back`);
            const modeBefore = bandAt(take(), i).mode;
            let stepped = modeBefore;
            if (stepped < 1 || stepped > 12) stepped = 0;
            stepped += 1;
            if (stepped > 12) stepped = 1;
            rightClick(card.mode[0], card.mode[1]);
            const steppedBand = bandAt(take(), i);
            eq(steppedBand.mode, stepped, `card ${i + 1} mode cycles`);
            eq(steppedBand.enabled, 1, `card ${i + 1} mode cycle keeps the band on`);
            before = steppedBand;
            dragUp(card.freq[0], card.freq[1], dy);
            after = bandAt(take(), i);
            near(after.freq, Math.min(20000, Math.max(20, before.freq * Math.exp(dy * 0.01))), 1e-2, `card ${i + 1} freq drag`);
            near(after.gain, before.gain, 1e-6, `card ${i + 1} freq drag leaves gain`);
            near(after.q, before.q, 1e-6, `card ${i + 1} freq drag leaves Q`);
            before = after;
            dragUp(card.gain[0], card.gain[1], dy);
            after = bandAt(take(), i);
            near(after.gain, Math.min(cfg.EQP_GAIN_MAX, Math.max(cfg.EQP_GAIN_MIN, Math.round((before.gain + dy * 0.12) / 0.1) * 0.1)), 1e-6, `card ${i + 1} gain drag`);
            near(after.freq, before.freq, 1e-3, `card ${i + 1} gain drag leaves frequency`);
            before = after;
            dragUp(card.q[0], card.q[1], dy);
            after = bandAt(take(), i);
            near(after.q, Math.min(40, Math.max(0.1, before.q * Math.exp(dy * 0.012))), 1e-3, `card ${i + 1} Q drag`);
            near(after.freq, before.freq, 1e-3, `card ${i + 1} Q drag leaves frequency`);
            near(after.gain, before.gain, 1e-6, `card ${i + 1} Q drag leaves gain`);
        }

        const az = { pre: [703, 42], post: [739, 42], res: [721, 66], speed: [721, 90], tilt: [721, 114], rmin: [706, 138], rmax: [740, 138] };
        mouseClick(az.pre[0], az.pre[1]);
        eq(take()[5], 0, "analyzer shelf Pre turns off");
        mouseClick(az.post[0], az.post[1]);
        eq(take()[6], 0, "analyzer shelf Post turns off");
        rightClick(az.res[0], az.res[1]);
        eq(take()[7], 0, "analyzer shelf Resolution cycles off Huge");
        rightClick(az.speed[0], az.speed[1]);
        eq(take()[8], 1, "analyzer shelf Speed cycles to Medium");
        rightClick(az.tilt[0], az.tilt[1]);
        eq(take()[9], 3, "analyzer shelf Tilt cycles to 6.0 dB/oct");
        dragUp(az.rmin[0], az.rmin[1], dy);
        near(take()[10], -76, 0.51, "analyzer shelf range floor drag");
        dragUp(az.rmax[0], az.rmax[1], dy);
        near(take()[11], 24, 0.51, "analyzer shelf range ceiling drag");
        eq(ui.showFiltersShelf, 1, "analyzer edits leave the filters shelf open");
        eq(ui.showAnalyzerShelf, 1, "analyzer edits leave the analyzer shelf open");

        let blob = take();
        blob[52] = 1;
        blob[53] = 0;
        put(blob);
        eq(take()[52], 1, "setvalueof stores the filters shelf");
        eq(take()[53], 0, "setvalueof stores the analyzer shelf closed");
        eq(ui.showFiltersShelf, 1, "setvalueof opens the filters shelf");
        eq(ui.showAnalyzerShelf, 0, "setvalueof closes the analyzer shelf");
        expectSize(1, 0, "restored filters shelf");
        blob = take();
        blob[52] = 0;
        blob[53] = 1;
        put(blob);
        eq(ui.showFiltersShelf, 0, "setvalueof closes the filters shelf");
        eq(ui.showAnalyzerShelf, 1, "setvalueof opens the analyzer shelf");
        expectSize(0, 1, "restored analyzer shelf");
        eq(take()[52], 0, "getvalueof reports the filters shelf closed");
        eq(take()[53], 1, "getvalueof reports the analyzer shelf open");
        blob = take();
        blob[52] = 1;
        blob[53] = 1;
        put(blob);
        eq(ui.showFiltersShelf, 1, "setvalueof round-trips both shelves on");
        eq(ui.showAnalyzerShelf, 1, "setvalueof round-trips the analyzer shelf on");
        expectSize(1, 1, "restored both shelves");
        eq(take()[52], 1, "getvalueof round-trips the filters shelf");
        eq(take()[53], 1, "getvalueof round-trips the analyzer shelf");

        ui.preview();
        ui.outlet = savedOutlet;
    }

    {
        function nearRect(got, r, name) {
            near(got[0], r.x, 0.02, `${name} x`);
            near(got[1], r.y, 0.02, `${name} y`);
            near(got[2], r.w, 0.02, `${name} w`);
            near(got[3], r.h, 0.02, `${name} h`);
        }
        ui.preview();
        ui.bottomAnalyzer = 0;
        ui.showFiltersShelf = 0;
        ui.popup = null;
        const closed = ui.eqpFacesWanted(ui.geo());
        const bar = ui.uiLayout(ui.geo());
        eq(Object.keys(closed).length, 8, "closed shelf faces the header, the route and the selected band");
        nearRect(closed["Stereo Route"], bar.route, "stereo route");
        nearRect(closed["Global Shift"], bar.shift, "shift");
        nearRect(closed["Output Gain"], bar.gain, "output gain");
        nearRect(closed["Tilt Filter"], bar.tilt, "tilt filter");
        nearRect(closed["Band 2 Enable"], bar.power, "selected enable");
        nearRect(closed["Band 2 Freq"], bar.freq, "selected frequency");
        nearRect(closed["Band 2 Gain"], bar.bandGain, "selected gain");
        nearRect(closed["Band 2 Q"], bar.q, "selected Q");
        ok(!closed["Band 1 Freq"], "an unselected band has no face while the shelf is closed");

        ui.showFiltersShelf = 1;
        const open = ui.eqpFacesWanted(ui.geo());
        const card = ui.filterCards()[0];
        nearRect(open["Band 1 Enable"], card.power, "card enable");
        nearRect(open["Band 1 Freq"], card.freq, "card frequency");
        nearRect(open["Band 1 Gain"], card.gain, "card gain");
        nearRect(open["Band 1 Q"], card.q, "card Q");
        nearRect(open["Band 2 Freq"], ui.uiLayout(ui.geo()).freq, "the selected band stays on the bottom bar");
        eq(Object.keys(open).length, 8 + 7 * 4, "the other seven bands get card faces");

        ui.showFiltersShelf = 0;
        ui.bottomAnalyzer = 1;
        const analyzer = ui.eqpFacesWanted(ui.geo());
        ok(!analyzer["Band 2 Freq"], "the analyzer bar is not covered");
        ok(!!analyzer["Global Shift"], "the header stays while the analyzer bar is showing");
        eq(Object.keys(analyzer).length, 4, "the header and the route stay while the analyzer bar is showing");

        ui.popup = { kind: "range", x: 0, y: 0, w: 40, h: 40, rects: [], selected: 0 };
        eq(Object.keys(ui.eqpFacesWanted(ui.geo())).length, 0, "a popup keeps the menu clickable");

        function faceBox() {
            return {
                hidden: 1,
                rect: [0, 0, 1, 1],
                front: 0,
                setattr(name, a, b, c, d) {
                    if (name === "presentation_rect") this.rect = [a, b, c, d];
                    else if (name === "hidden") this.hidden = a;
                },
                getattr() { return 0; },
            };
        }
        ui.popup = null;
        ui.bottomAnalyzer = 0;
        ui.showFiltersShelf = 0;
        ui.named["Global Shift"] = faceBox();
        ui.patcher.bringtofront = function (box) { box.front += 1; };
        ui.paint();
        const shift = ui.named["Global Shift"];
        const placed = ui.uiLayout(ui.geo()).shift;
        eq(shift.hidden, 0, "the shift face is shown");
        eq(shift.front, 1, "the shift face is brought in front of the canvas");
        near(shift.rect[0], 4 + placed.x, 0.02, "shift face device x");
        near(shift.rect[1], 4 + placed.y, 0.02, "shift face device y");
        near(shift.rect[2], placed.w, 0.02, "shift face width");
        near(shift.rect[3], placed.h, 0.02, "shift face height");
        ui.popup = { kind: "range", x: 0, y: 0, w: 40, h: 40, rects: [], selected: 0 };
        ui.paint();
        eq(shift.hidden, 1, "opening a popup hides the face");
        deep(shift.rect, [0, 0, 1, 1], "opening a popup parks the face");
        ui.popup = null;
        delete ui.named["Global Shift"];

        ui.preview();
        ui.popup = null;
        const pill = ui.uiLayout(ui.geo()).route;
        const liveBefore = ui.bands.filter((b) => b.enabled).length;
        ui.onclick(pill.x + 4, pill.y + 4, 1, 0, 0, 0, 0, 0);
        eq(ui.popup && ui.popup.kind, "route", "the plot pill opens the route menu");
        eq(ui.bands.filter((b) => b.enabled).length, liveBefore, "the route pill does not create a band");
        ui.popup = null;
        ui.onclick(pill.x + 4, pill.y + 4, 2, 0, 0, 0, 0, 1);
        eq(ui.routeMode, 1, "right-click steps from Stereo to Left");
        eq(ui.bands, ui.bandsA, "Left still edits the left curve");
        ui.set_route(2);
        eq(ui.bands, ui.bandsB, "Right edits the other curve");
        ui.bands[0].freq = 440;
        ui.set_route(0);
        eq(ui.routeMode, 0, "Stereo is linked");
        eq(ui.bands, ui.bandsA, "Stereo shows one curve");
        near(ui.bandsA[0].freq, 440, 0.01, "linking keeps the curve that was on screen");
        near(ui.bandsB[0].freq, 440, 0.01, "linking copies that curve onto the other channel");
        ui.set_route(4);
        eq(ui.bands, ui.bandsB, "Side edits the side curve");
        ui.bands[1].freq = 880;
        ui.set_route(3);
        eq(ui.bands, ui.bandsA, "Mid edits the mid curve");
        ok(Math.abs(ui.bandsB[1].freq - 880) < 0.01, "the side curve keeps its own frequency");
        ok(Math.abs(ui.bandsA[1].freq - 880) > 1, "the mid curve did not pick up the side edit");
        const saved = ui.getvalueof();
        eq(saved[59], 3, "the blob stores the route after the phase mode");
        ui.set_route(0);
        ui.setvalueof(saved);
        eq(ui.routeMode, 3, "setvalueof restores Mid");
        near(ui.bandsB[1].freq, 880, 0.01, "setvalueof restores the side curve");
        const legacy = saved.slice(0, 59);
        ui.setvalueof(legacy);
        eq(ui.routeMode, 0, "a blob from before the route stays on Stereo");
        near(ui.bandsB[0].freq, ui.bandsA[0].freq, 0.01, "an old blob copies its curve onto both channels");
    }
}

// ---------------------------------------------------------------------------------------------
// 9. Bug sweep Pass 1 — red tests (see BUGS.md; no fixes in this pass)
// ---------------------------------------------------------------------------------------------
function runBugSweepPass1() {
    const ui = loadFace();
    if (typeof ui.setbuffers === "function") ui.setbuffers("---eqpluscfg", "---eqplusspec", "---eqplusir");
    const irPokes = () => ui.pokes.filter((p) => /eqplusir/.test(p.name)).length;
    ui.set_phase_mode(2);
    eq(ui.phaseMode, 2, "bug sweep: Linear Phase engages");
    const linearBefore = irPokes();
    ok(linearBefore > 0, "bug sweep: entering Linear Phase pokes a designed IR");
    ui.set_tilt_eq(6);
    near(ui.tiltEqDb, 6, 1e-9, "bug sweep: tilt_eq automation lands on the face");
    ok(irPokes() > linearBefore, "bug sweep: set_tilt_eq redesigns the phase kernel in Linear Phase (stale IR: the gen convolves dry audio with the IR, so an automated Tilt EQ change is inaudible until an unrelated coeff update)");
    ui.set_phase_mode(1);
    eq(ui.phaseMode, 1, "bug sweep: Natural Phase engages");
    const naturalBefore = irPokes();
    ok(naturalBefore > linearBefore, "bug sweep: entering Natural Phase pokes a designed kernel");
    ui.set_tilt_eq(-6);
    near(ui.tiltEqDb, -6, 1e-9, "bug sweep: tilt_eq automation lands again");
    ok(irPokes() > naturalBefore, "bug sweep: set_tilt_eq redesigns the correction kernel in Natural Phase");

    // Sibling of Bug 1: face double-click reset on the Tilt EQ control only emitTilt()s
    // (shift dblclick correctly calls updateCoeffBuffer). In Linear Phase the IR stays stale.
    ui.set_phase_mode(2);
    ui.set_tilt_eq(9);
    const dblBefore = irPokes();
    const L = ui.uiLayout(ui.geo());
    ok(L.tilt && L.tilt.w > 0, "bug sweep: tilt EQ hitbox exists for dblclick");
    ui.ondblclick(L.tilt.x + L.tilt.w * 0.5, L.tilt.y + L.tilt.h * 0.5, 1, 0, 0, 0, 0, 0);
    near(ui.tiltEqDb, 0, 1e-9, "bug sweep: double-click on tilt EQ resets to 0 dB");
    ok(irPokes() > dblBefore, "bug sweep: tilt EQ double-click reset redesigns the Linear Phase IR (stale IR: ondblclick only emitTilt(), unlike shift dblclick which calls updateCoeffBuffer)");
}

runBugSweepPass1();

runFace();

console.log(`EQ+ tests passed (${checks} checks)`);
