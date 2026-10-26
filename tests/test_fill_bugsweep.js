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

// ---------------------------------------------------------------------------------------------
// Bug D — A sample-rate change alone republishes neither the experimental bank page nor the
// convolution IRs: fillPublishBank builds its cache signature from hit, seed and metas only
// (src/fill_dsp.js fillBankSig), and fillPublishIr from the fillP IR fields only (fillIrSig).
// Neither includes fillSr(). Live can change the device sample rate (48k -> 96k) with no
// parameter change; the gen then keeps playing a page whose phase increments, pole radii and
// allpass delays were computed for the old rate, and IRs whose lengths were computed for it.
// ---------------------------------------------------------------------------------------------
const libD = require(path.join(ROOT, "tests", "paint_bounds_lib.js"));
const docD = JSON.parse(fs.readFileSync(path.join(ROOT, "devices", "Fill.amxd")).slice(32).toString("utf8"));
const vizD = docD.patcher.boxes.map(function (b) { return b.box; }).filter(function (b) { return b.id === "obj-viz"; })[0];
const patcherD = {
    getnamed: function () { return { valid: 1, message: function () {} }; },
    setattr: function () {}, newdefault: function () { return null; },
    connect: function () {}, remove: function () {},
};
const faceD = libD.loadFace(vizD.textfile.text, libD.makeRecorder(232, 147), { outlet: function () {}, patcher: patcherD });
let phaseD = null;
faceD.fillBufBank = {
    poke: function (ch, index, arr) { if (index === 16 && arr.length > 8) phaseD = arr[0]; },
    peek: function () { return [0]; },
};
faceD.fillP.page = 1; faceD.fillP.seed = 1; faceD.fillP.mass = 0; faceD.fillP.massr = 0; faceD.fillP.rand = 0;
faceD.fillBankGen = 0; faceD.fillBankSig = ""; faceD.fillTele.hit = 0; faceD.samplerate = 48000;
faceD.fillPublishBank();
const phase48D = phaseD;
const gen48D = faceD.fillBankGen;
faceD.samplerate = 96000;
faceD.fillPublishBank();
check("Bug D: bank republishes when only the sample rate changes", () => {
    assert.ok(gen48D >= 1, "setup: bank published at 48 kHz");
    assert.ok(faceD.fillBankGen > gen48D, "bank generation stuck at " + faceD.fillBankGen + " after sr 48000 -> 96000");
    assert.ok(phaseD < phase48D * 0.75, "fundamental phase " + phaseD + " not rescaled from " + phase48D);
});
check("Bug D control: bank stays cached when nothing changes", () => {
    const g = faceD.fillBankGen;
    faceD.fillPublishBank();
    assert.strictEqual(faceD.fillBankGen, g);
});
let pokesD = 0;
const mockD = { poke: function () { pokesD++; }, peek: function () { return [0]; } };
faceD.fillBufBody = mockD; faceD.fillBufAir = mockD;
faceD.samplerate = 48000; faceD.fillIrSig = ""; faceD.fillIrSlot.n = 0;
faceD.fillPublishIr();
const pokes48D = pokesD;
faceD.samplerate = 96000;
faceD.fillPublishIr();
check("Bug D: IR republishes when only the sample rate changes", () => {
    assert.ok(pokes48D > 0, "setup: IR published at 48 kHz");
    assert.ok(pokesD > pokes48D, "no IR buffer writes after sr 48000 -> 96000 (still " + pokesD + " pokes)");
});

if (failures.length) {
    console.log("test_fill_bugsweep: " + failures.length + " of " + checks + " checks FAILED");
    process.exit(1);
}
console.log("test_fill_bugsweep: ok (" + checks + " checks)");
