"use strict";

const assert = require("assert");
const C = require("../src/fill_config.js");

function near(a, b, eps, msg) {
    assert.ok(Math.abs(a - b) <= eps, (msg || "") + " " + a + " vs " + b);
}

// Hit draw: master 0 and range 0 hold the center. A live range moves, and stays inside lo..hi.
{
    assert.strictEqual(C.fillHitDraw(42, 30, 0, 100, 3, 1, 21, 0), 42, "master 0 is the center");
    assert.strictEqual(C.fillHitDraw(42, 0, 0, 100, 3, 1, 21, 1), 42, "range 0 is the center");
    assert.strictEqual(C.fillHitDraw(140, 0, 0, 100, 3, 1, 21, 1), 100, "center clamps");
    assert.notStrictEqual(
        C.fillHitDraw(50, 25, 0, 100, 3, 1, 21, 1),
        C.fillHitDraw(50, 25, 0, 100, 3, 2, 21, 1),
        "two hits differ"
    );
    for (let h = 0; h < 16; h++) {
        const y = C.fillHitDraw(90, 80, 10, 40, 6, h, 21, 1);
        assert.ok(y >= 10 && y <= 40, "draw stays inside " + y);
    }
}

// One shared roll per group, mapped from bipolar into 0..1.
{
    const body = C.fillBodyRoll(3, 1);
    const air = C.fillAirRoll(3, 1);
    assert.ok(body >= 0 && body <= 1 && air >= 0 && air <= 1);
    assert.strictEqual(body, C.fillBodyRoll(3, 1), "body roll is stable");
    assert.notStrictEqual(body, air, "body and air rolls use different lanes");
    assert.notStrictEqual(body, C.fillBodyRoll(3, 2), "hits do not share a body roll");
}

// Experimental page: 48 modes, 10 allpass pairs, 4 globals.
{
    const sr = 48000;
    const rMax = Math.exp(-6.91 / (0.50 * sr));
    const delayMax = 0.04 * sr;
    function metas(over) {
        return Object.assign({
            mass: 50, massR: 100,
            scatter: 40, scatterR: 100,
            decay: 50, decayR: 100,
            couple: 50, coupleR: 100,
            bite: 40, biteR: 100,
            air: 60, airR: 100,
            rand: 1,
        }, over);
    }
    function assertStable(page, label) {
        assert.strictEqual(page.length, 408, label + " length");
        assert.ok(Array.isArray(page) && !(page instanceof Float32Array), label + " plain array");
        for (let i = 0; i < page.length; i++) {
            assert.ok(Number.isFinite(page[i]), label + " finite " + i);
        }
        for (let m = 0; m < 48; m++) {
            const r = page[m * 8 + 1];
            assert.ok(r > 0 && r < 1 && r <= rMax, label + " pole " + r);
        }
        assert.ok(page[407] <= 0.50, label + " rt60 " + page[407]);
        for (let p = 0; p < 10; p++) {
            const delay = page[384 + p * 2];
            const g = page[384 + p * 2 + 1];
            assert.ok(delay >= 1 && delay <= delayMax, label + " delay " + delay);
            assert.ok(Math.abs(g) <= 0.45, label + " g " + g);
        }
    }
    for (const decay of [0, 100]) {
        for (const couple of [0, 100]) {
            for (const hit of [1, 2]) {
                assertStable(
                    C.fillExperimentalPage(metas({ decay: decay, couple: couple }), 3, hit, sr),
                    "decay " + decay + " couple " + couple + " hit " + hit
                );
            }
        }
    }
    const hitA = C.fillExperimentalPage(metas({ mass: 45, massR: 40, scatter: 50, scatterR: 40 }), 3, 1, sr);
    const hitB = C.fillExperimentalPage(metas({ mass: 45, massR: 40, scatter: 50, scatterR: 40 }), 3, 2, sr);
    let phaseDiff = false;
    for (let m = 0; m < 48; m++) if (hitA[m * 8] !== hitB[m * 8]) phaseDiff = true;
    assert.ok(phaseDiff, "seed 3 hit 1 and hit 2 differ in phase increment");

    function centers(range, rand) {
        return {
            mass: 42, massR: range,
            scatter: 18, scatterR: range,
            decay: 55, decayR: range,
            couple: 33, coupleR: range,
            bite: 12, biteR: range,
            air: 77, airR: range,
            rand: rand,
        };
    }
    assert.deepStrictEqual(
        C.fillExperimentalPage(centers(100, 0), 3, 1, sr),
        C.fillExperimentalPage(centers(0, 0), 3, 1, sr),
        "rand 0 ignores meta ranges"
    );

    const noAir = C.fillExperimentalPage(metas({ air: 0, airR: 0, rand: 1 }), 4, 2, sr);
    for (let p = 0; p < 10; p++) assert.strictEqual(noAir[384 + p * 2 + 1], 0, "air 0 clears allpass g");

    const quiet = C.fillExperimentalPage(centers(0, 0), 1, 0, sr);
    assert.ok(quiet[4] * quiet[2] > 0.05, "mode 0 stays an audible partial");
    const massLo = C.fillExperimentalPage(Object.assign({}, centers(0, 0), { mass: 0 }), 1, 0, sr);
    const massHi = C.fillExperimentalPage(Object.assign({}, centers(0, 0), { mass: 100 }), 1, 0, sr);
    assert.ok(massHi[0] > massLo[0] * 4, "Mass moves the fundamental");
    const decayLo = C.fillExperimentalPage(Object.assign({}, centers(0, 0), { decay: 0 }), 1, 0, sr);
    const decayHi = C.fillExperimentalPage(Object.assign({}, centers(0, 0), { decay: 100 }), 1, 0, sr);
    assert.ok(decayHi[407] > decayLo[407] + 0.2, "Decay lengthens the tail");
}

// Onset: 40 ms holdoff, sens 0 needs +12 dB
assert.strictEqual(C.fillOnset(1, 0.1, 1, 100, 48000), 0, "holdoff");
assert.strictEqual(C.fillOnset(1, 0.1, 1, 2000, 48000), 1, "sens 100 fires");
assert.strictEqual(C.fillOnset(0.2, 0.1, 0, 2000, 48000), 0, "sens 0 rejects a small rise");
assert.strictEqual(C.fillOnset(0.5, 0.1, 0, 2000, 48000), 1, "sens 0 accepts +12 dB");

// Drift is stable and bounded
{
    const a = C.fillDrift(3, 4, 1);
    const b = C.fillDrift(3, 4, 1);
    near(a.cents, b.cents, 0, "seeded");
    assert.ok(Math.abs(a.cents) <= 40 && Math.abs(a.brightDb) <= 3 && Math.abs(a.damp) <= 0.15);
    const z = C.fillDrift(3, 4, 0);
    near(z.cents, 0, 0, "amount 0");
    assert.notStrictEqual(C.fillDrift(9, 4, 1).cents, a.cents);
}

// Link
{
    let st = C.fillBlankState();
    st.s.tune = 0;
    st.e.tune = -7;
    st.selected = 0;
    let on = C.fillSetLink(st, "tune", 1);
    assert.strictEqual(on.state.link.tune, 1);
    assert.strictEqual(on.state.e.tune, 0, "link copies the selected column");
    assert.strictEqual(on.sets.length, 1);
    let moved = C.fillApplyChange(on.state, "e", "tune", -3);
    assert.strictEqual(moved.state.s.tune, -3);
    assert.strictEqual(moved.state.e.tune, -3);
    assert.strictEqual(moved.sets.length, 1, "one silent copy");
    let off = C.fillSetLink(moved.state, "tune", 0);
    assert.strictEqual(off.sets.length, 0, "unlink leaves both values");
    let solo = C.fillApplyChange(off.state, "s", "tune", 2);
    assert.strictEqual(solo.state.e.tune, -3, "unlinked side stays");
    assert.strictEqual(solo.sets.length, 0);
    assert.strictEqual(C.fillBlankState().link.tune, 0, "default unlinked");
}

// Drag maps the ruler to a quarter-beat length
near(C.fillLengthFromDrag(0, 100), 4, 0, "left edge is 4 beats");
near(C.fillLengthFromDrag(100, 100), 0.25, 0, "right edge clamps to a 16th");
near(C.fillLengthFromDrag(75, 100), 1, 0, "last quarter of the bar is 1 beat");

// Identity morph and demo walk
{
    const id = C.fillIdentitySnap();
    const m = C.fillMorphSnap(id, id, 0.4);
    assert.strictEqual(m.tune, 0);
    assert.strictEqual(m.bmix, 0);
    const d = C.fillMorphSnap(C.fillDemoStart(), C.fillDemoEnd(), 1);
    assert.strictEqual(d.tune, -7);
    assert.strictEqual(d.amodel, 1);
    const mid = C.fillMorphSnap(C.fillDemoStart(), C.fillDemoEnd(), 0.25);
    assert.ok(mid.bmodel === 0 && mid.amodel === 0, "models switch at the midpoint");
}

// Body IR: size lengthens and lowers, decay shortens energy, spectra pack an impulse
{
    const sr = 48000;
    const a = C.fillRenderBody(0, 80, 100, 0, 0, sr);
    const big = C.fillRenderBody(0, 80, 200, 0, 0, sr);
    const low = C.fillRenderBody(0, 80, 100, 0, -12, sr);
    assert.ok(big.length > a.length, "size 200% is longer");
    assert.ok(a.length <= C.FILL_CONV.BODY_MAX && a.length >= 32);
    function zc(ir) {
        let n = 0;
        for (let i = 1; i < Math.min(ir.length, 4000); i++) if (ir[i - 1] <= 0 && ir[i] > 0) n++;
        return n;
    }
    assert.ok(zc(low) < zc(a), "−12 st crosses zero less often");
    const short = C.fillRenderBody(0, 10, 100, 0, 0, sr);
    let eShort = 0, eLong = 0;
    for (let i = 0; i < short.length; i++) eShort += short[i] * short[i];
    for (let i = 0; i < a.length; i++) eLong += a[i] * a[i];
    assert.ok(short.length < a.length, "decay 10% is shorter than 80%");
    assert.ok(eShort > 0 && eLong > 0);
    const air = C.fillRenderAir(0, 50, 100, 0, 3, sr);
    const air2 = C.fillRenderAir(0, 50, 100, 0, 3, sr);
    assert.strictEqual(air.length, air2.length);
    near(air[10], air2[10], 0, "air noise is seeded");
    assert.ok(air.length <= C.FILL_CONV.AIR_MAX);

    const trimmed = new Float32Array([0.2, -0.1, 0, 0, 0]);
    assert.strictEqual(C.fillIrUsed(trimmed), 2, "trailing zeros trim");
    const kept = new Float32Array([0, 0, 0.3]);
    assert.strictEqual(C.fillIrUsed(kept), 3, "an interior zero stays");
    assert.strictEqual(C.fillIrUsed(new Float32Array([0])), 1, "a single sample stays");

    const impulse = new Float32Array(C.FILL_CONV.H);
    impulse[0] = 1;
    const spec = C.fillSpectra(impulse);
    assert.strictEqual(spec.nHead, 1, "a one-sample IR is one head partition");
    assert.strictEqual(spec.nTail, 0);
    near(spec.head[0], 1, 1e-6, "bin 0 real");
    near(spec.head[1], 0, 1e-6, "bin 0 imag");
    near(spec.head[2], 1, 1e-6, "mono IR copied to R");
    const bodySpec = C.fillSpectra(a);
    assert.ok(bodySpec.nHead >= 1 && bodySpec.nHead <= C.FILL_CONV.HEAD);
    assert.strictEqual(bodySpec.head.length, C.FILL_CONV.HEAD_FLOATS);
    assert.strictEqual(bodySpec.tail.length, C.FILL_CONV.TAIL_FLOATS);
}

// GenExpr: one return per function, none nested in a block, no e<digit> names.
{
    const fs = require("fs");
    const path = require("path");
    for (const name of ["fill_conv.genexpr", "fill_core.genexpr"]) {
        const text = fs.readFileSync(path.join(__dirname, "..", "src", name), "utf8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (/^\t{2,}return\b/.test(lines[i])) {
                throw new Error(name + ":" + (i + 1) + " return inside a block");
            }
            if (/\be\d+\b/.test(lines[i])) {
                throw new Error(name + ":" + (i + 1) + " identifier e<digit>");
            }
        }
    }
}

console.log("fill math ok");
