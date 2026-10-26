#!/usr/bin/env node
/**
 * RED suite for Fill bugsweep (bugsweep/fill, PASS 1: hunt + red tests, NO fixes).
 * These checks are expected to FAIL on current production code until a later pass.
 * See the Fill section of BUGS.md. Do not "fix" by editing src/ or scripts/ in PASS 1.
 * Failures are collected and reported together so one run shows every red.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const C = require(path.join(ROOT, "src", "fill_config.js"));
const coreGen = fs.readFileSync(path.join(ROOT, "src", "fill_core.genexpr"), "utf8");

let checks = 0;
const failures = [];
function check(name, fn) {
    checks++;
    try {
        fn();
        console.log("ok - " + name);
    } catch (e) {
        failures.push(name + ": " + e.message);
        console.log("FAIL - " + name + ": " + e.message);
    }
}

function metas(over) {
    return Object.assign({
        mass: 50, massR: 100, scatter: 40, scatterR: 100, decay: 50, decayR: 100,
        couple: 50, coupleR: 100, bite: 40, biteR: 100, air: 60, airR: 100, rand: 1,
    }, over);
}

// ---------------------------------------------------------------------------------------------
// Bug A — Seed 0 is a real parameter value (0..1000) but every JS draw treats it as Seed 1:
// fillHash uses (Math.round(seed) || 1) and fillRenderAir uses (seed || 1), while the gen
// (fillUnit in fill_core.genexpr) uses the seed as passed. Seed 0 and Seed 1 must differ.
// ---------------------------------------------------------------------------------------------
check("Bug A: fillBodyRoll seed 0 differs from seed 1", () => {
    assert.notStrictEqual(C.fillBodyRoll(0, 1), C.fillBodyRoll(1, 1));
});
check("Bug A: fillAirRoll seed 0 differs from seed 1", () => {
    assert.notStrictEqual(C.fillAirRoll(0, 3), C.fillAirRoll(1, 3));
});
check("Bug A: fillRenderAir seed 0 differs from seed 1", () => {
    const a = C.fillRenderAir(0, 50, 100, 0, 0, 48000);
    const b = C.fillRenderAir(0, 50, 100, 0, 1, 48000);
    assert.strictEqual(a.length, b.length);
    let same = true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) same = false;
    assert.ok(!same, "air IR for seed 0 is byte-identical to seed 1");
});
check("Bug A: fillExperimentalPage seed 0 differs from seed 1", () => {
    assert.notDeepStrictEqual(
        C.fillExperimentalPage(metas({}), 0, 1, 48000),
        C.fillExperimentalPage(metas({}), 1, 1, 48000)
    );
});

// ---------------------------------------------------------------------------------------------
// Bug B — Master Rand 0 must hold the experimental page: every meta draw goes through
// fillHitDraw with rand as master, but the allpass g values are drawn per hit with
// fillBipolar(seed, hit, 110 + p) directly, so with Air > 0 the page still changes per hit.
// ---------------------------------------------------------------------------------------------
check("Bug B: rand 0 page is identical across hits when Air > 0", () => {
    assert.deepStrictEqual(
        C.fillExperimentalPage(metas({ rand: 0, air: 50, airR: 0 }), 3, 1, 48000),
        C.fillExperimentalPage(metas({ rand: 0, air: 50, airR: 0 }), 3, 2, 48000)
    );
});
check("Bug B control: rand 0 page is identical across hits when Air is 0", () => {
    assert.deepStrictEqual(
        C.fillExperimentalPage(metas({ rand: 0, air: 0, airR: 0 }), 3, 1, 48000),
        C.fillExperimentalPage(metas({ rand: 0, air: 0, airR: 0 }), 3, 2, 48000)
    );
});

// ---------------------------------------------------------------------------------------------
// Bug C — the JS page allows allpass delays up to 0.04 * sr (7680 samples at 192 kHz),
// but the gen allpass lines are 4096 long and fillApPair clips delay to 4094, so the
// longest stages cannot be realised at 192 kHz. The page must stay inside the gen bound.
// ---------------------------------------------------------------------------------------------
const clipMatch = coreGen.match(/clip\(delay, 1, (\d+)\)/);
const genDelayMax = clipMatch ? Number(clipMatch[1]) : 0;
function maxPageDelay(sr) {
    const page = C.fillExperimentalPage(metas({}), 3, 1, sr);
    let mx = 0;
    for (let p = 0; p < 10; p++) mx = Math.max(mx, page[384 + p * 2]);
    return mx;
}
check("Bug C setup: gen allpass delay clip found in fill_core.genexpr", () => {
    assert.ok(genDelayMax > 0, "clip(delay, 1, N) not found");
});
check("Bug C control: page delays fit the gen bound at 96 kHz", () => {
    assert.ok(maxPageDelay(96000) <= genDelayMax, maxPageDelay(96000) + " > " + genDelayMax);
});
check("Bug C: page delays fit the gen bound at 192 kHz", () => {
    assert.ok(maxPageDelay(192000) <= genDelayMax, maxPageDelay(192000) + " > " + genDelayMax);
});

if (failures.length) {
    console.log("test_fill_bugsweep: " + failures.length + " of " + checks + " checks FAILED");
    process.exit(1);
}
console.log("test_fill_bugsweep: ok (" + checks + " checks)");
