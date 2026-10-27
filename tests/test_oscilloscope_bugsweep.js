#!/usr/bin/env node
"use strict";

// Oscilloscope bugsweep — Pass 1 RED tests.
// Each test below fails BECAUSE of a real bug in src/oscilloscope_config.js (see BUGS.md).
// Style follows tests/test_oscilloscope.js (same ok/near helpers); the only deviation is
// that each bug test runs inside try/catch so a single run reports EVERY failure instead
// of aborting at the first one. The process exits 1 while any bug is present.

const assert = require("assert");
const osc = require("../src/oscilloscope_config.js");

let checks = 0;
let failures = 0;

function ok(cond, msg) {
    assert.ok(cond, msg);
    checks++;
}

function near(got, want, tol, msg) {
    assert.ok(Math.abs(got - want) <= tol, msg + " (got " + got + ", want " + want + ")");
    checks++;
}

function test(name, fn) {
    try {
        fn();
        console.log("PASS " + name);
    } catch (err) {
        failures++;
        console.log("FAIL " + name + ": " + err.message);
    }
}

const sr = 48000;

function sine(freq, n, amp) {
    const a = new Array(n || 4096);
    const g = amp === undefined ? 0.8 : amp;
    for (let i = 0; i < a.length; i++) a[i] = g * Math.sin((2 * Math.PI * freq * i) / sr);
    return a;
}

function frameOf(sig, cycleMode, trigLevel) {
    return osc.oscComputeFrame(sig, sig, sr, {
        chMode: 0,
        cycleMode: cycleMode,
        trigLevel: trigLevel,
        points: 336,
        pitchState: osc.oscCreatePitchState()
    });
}

function maxDiff(a, b) {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
}

// ---------------------------------------------------------------------------------------------
// Bug 1: The armed trigger level is ignored in the pitch-locked cycle windows
// (1 Cyc / 2 Cyc / 4 Cyc / 8 Cyc). oscComputeFrame only passes o.trigLevel to
// oscFindTrigger in the fixed-ms branch; the cycle branch phase-locks to the zero
// crossing via oscPhaseLock and never looks at the level. The face lets the user
// drag the threshold in every window mode and paints the guide there, so in 4 of
// the 7 Window modes the control is a silent no-op.
// ---------------------------------------------------------------------------------------------
test("cycle windows honor the armed trigger level (1 Cyc)", () => {
    const sig = sine(220);
    const atZero = frameOf(sig, 0, 0);
    const atHalf = frameOf(sig, 0, 0.5);
    ok(maxDiff(atZero.wave1, atHalf.wave1) > 0.2, "1 Cyc wave must change when the trigger level is armed at 0.5");
    near(atHalf.wave1[0], 0.5, 0.06, "1 Cyc window starts at the rising 0.5 trigger crossing");
});

test("cycle windows honor the armed trigger level (2 Cyc)", () => {
    const sig = sine(220);
    const atZero = frameOf(sig, 1, 0);
    const atHalf = frameOf(sig, 1, 0.5);
    ok(maxDiff(atZero.wave1, atHalf.wave1) > 0.2, "2 Cyc wave must change when the trigger level is armed at 0.5");
    near(atHalf.wave1[0], 0.5, 0.06, "2 Cyc window starts at the rising 0.5 trigger crossing");
});

// Control for Bug 1: the fixed-ms windows DO honor the level today. This test
// passes now and must keep passing after the fix; it pins the intended semantics
// that the cycle windows are missing.
test("control: fixed-ms windows honor the armed trigger level (20 ms)", () => {
    const sig = sine(220);
    const atZero = frameOf(sig, 5, 0);
    const atHalf = frameOf(sig, 5, 0.5);
    ok(maxDiff(atZero.wave1, atHalf.wave1) > 0.2, "20 ms wave changes when the trigger level is armed at 0.5");
    near(atHalf.wave1[0], 0.5, 0.06, "20 ms window starts at the rising 0.5 trigger crossing");
});

// ---------------------------------------------------------------------------------------------
// Bug 2: The pitch estimator cannot detect anything above 3200 Hz at 48 kHz,
// despite documenting "Supports 24 Hz .. 4000 Hz". minLag is
// Math.floor(rate / 3200), so at 48 kHz the shortest searchable period is
// 15 samples; a 3500 Hz tone (period ~13.7) or 4000 Hz tone (period 12) can
// never match, and the NSDF peak at twice the period wins instead — the
// readout confidently reports exactly one octave down.
// ---------------------------------------------------------------------------------------------
test("pitch estimator detects 3500 Hz (documented ceiling is 4000 Hz)", () => {
    const est = osc.oscEstimatePeriod(sine(3500), sr, osc.oscCreatePitchState());
    near(est.freq, 3500, 3500 * 0.015, "Detected frequency at 3500 Hz");
    ok(est.confidence > 0.8, "High pitch confidence at 3500 Hz");
});

test("pitch estimator detects 4000 Hz (documented ceiling is 4000 Hz)", () => {
    const est = osc.oscEstimatePeriod(sine(4000), sr, osc.oscCreatePitchState());
    near(est.freq, 4000, 4000 * 0.015, "Detected frequency at 4000 Hz");
    ok(est.confidence > 0.8, "High pitch confidence at 4000 Hz");
});


// ---------------------------------------------------------------------------------------------
// Bug 3 (iteration 1): The pitch estimator's low-frequency floor rises with the
// sample rate, despite documenting "Supports 24 Hz .. 4000 Hz" with no sample-rate
// qualification. oscEstimatePeriod caps maxLag at min(winLen * 0.64, rate / 20); the
// face always passes the 4096-sample scope ring, so at 96 kHz the longest searchable
// period is 2621 samples (~36.6 Hz). Tones below that are not reported as
// undetected: a 36 Hz tone (period 2667) is confidently reported at the cap
// (36.63 Hz, confidence 0.99) and a 30 Hz tone (period 3200) is reported as
// 36.65 Hz / D1 instead of 30 Hz / B0, and a 1 Cyc frame phase-locks to the wrong
// 2619.5-sample span. At 48 kHz the same tones are detected exactly.
// ---------------------------------------------------------------------------------------------
function sineAt(freq, rate, n, amp) {
    const a = new Array(n || 4096);
    const g = amp === undefined ? 0.8 : amp;
    for (let i = 0; i < a.length; i++) a[i] = g * Math.sin((2 * Math.PI * freq * i) / rate);
    return a;
}

function frameAt(sig, rate, cycleMode, trigLevel) {
    return osc.oscComputeFrame(sig, sig, rate, {
        chMode: 0,
        cycleMode: cycleMode,
        trigLevel: trigLevel || 0,
        points: 336,
        pitchState: osc.oscCreatePitchState()
    });
}

test("pitch estimator detects 36 Hz at 96 kHz (documented floor is 24 Hz)", () => {
    const est = osc.oscEstimatePeriod(sineAt(36, 96000), 96000, osc.oscCreatePitchState());
    near(est.freq, 36, 36 * 0.015, "Detected frequency at 36 Hz / 96 kHz");
    ok(est.confidence > 0.8, "High pitch confidence at 36 Hz / 96 kHz");
});

test("pitch estimator detects 30 Hz at 96 kHz (documented floor is 24 Hz)", () => {
    const est = osc.oscEstimatePeriod(sineAt(30, 96000), 96000, osc.oscCreatePitchState());
    near(est.freq, 30, 30 * 0.015, "Detected frequency at 30 Hz / 96 kHz");
    ok(est.confidence > 0.8, "High pitch confidence at 30 Hz / 96 kHz");
});

// Control for Bug 3: 40 Hz at 96 kHz (period 2400, inside the current lag cap)
// is detected today and must keep working after the fix.
test("control: pitch estimator detects 40 Hz at 96 kHz", () => {
    const est = osc.oscEstimatePeriod(sineAt(40, 96000), 96000, osc.oscCreatePitchState());
    near(est.freq, 40, 40 * 0.015, "Detected frequency at 40 Hz / 96 kHz");
    ok(est.confidence > 0.8, "High pitch confidence at 40 Hz / 96 kHz");
});

test("1 Cyc frame at 96 kHz locks to a 30 Hz tone at 30 Hz", () => {
    const f = frameAt(sineAt(30, 96000), 96000, 0);
    near(f.freq, 30, 30 * 0.015, "1 Cyc frame frequency at 30 Hz / 96 kHz");
    near(f.spanSamples, 3200, 3200 * 0.02, "1 Cyc frame spans one 3200-sample period at 30 Hz / 96 kHz");
});

// ---------------------------------------------------------------------------------------------
// Bug 4 (iteration 1): The fixed timebase windows silently shrink at high sample
// rates. The face feeds exactly OSC_RING_N (4096) ring samples (oscTakeScope) and
// oscComputeFrame clamps the fixed-ms span to 90% of the buffer, so at 96 kHz the
// 50 ms window delivers only 38.40 ms (and fails to trigger on a steady 220 Hz
// sine that locks at 44.1/48 kHz), and at 192 kHz the 20 ms and 50 ms settings
// produce the identical 19.20 ms window — while the scale footer
// (oscPaintScaleFooter) still labels the axis with the nominal OSC_FIXED_MS
// values, so the printed time scale is wrong. The fix likely belongs to the
// shared scope-ring layout (OSC_RING_N / the analyzer gen ring) and is flagged
// here per the sweep plan's shared-code rule; the contract asserted is the
// labelled one: a selected 50 ms window spans 50 ms.
// ---------------------------------------------------------------------------------------------
test("50 ms window spans 50 ms at 96 kHz", () => {
    const f = frameAt(sineAt(220, 96000, osc.OSC_RING_N), 96000, 6);
    near(f.windowMs, 50, 0.6, "50 ms window reports 50 ms at 96 kHz");
    near(f.spanSamples, 4800, 50, "50 ms window spans 4800 samples at 96 kHz");
});

test("20 ms and 50 ms windows are different windows at 192 kHz", () => {
    const f20 = frameAt(sineAt(220, 192000, osc.OSC_RING_N), 192000, 5);
    const f50 = frameAt(sineAt(220, 192000, osc.OSC_RING_N), 192000, 6);
    ok(Math.abs(f50.windowMs - f20.windowMs) > 5, "50 ms and 20 ms windows must differ at 192 kHz (both were " + f20.windowMs + " ms)");
    near(f50.windowMs, 50, 1, "50 ms window reports 50 ms at 192 kHz");
});

console.log("oscilloscope bugsweep: " + checks + " checks passed, " + failures + " failing test(s)");
if (failures > 0) process.exit(1);
