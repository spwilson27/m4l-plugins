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

console.log("oscilloscope bugsweep: " + checks + " checks passed, " + failures + " failing test(s)");
if (failures > 0) process.exit(1);
