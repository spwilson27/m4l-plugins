#!/usr/bin/env node
"use strict";
/**
 * Verification suite for devices/Freq Split.amxd + .adg (Spectral Split suite, slug `freqsplit`).
 *
 *  1. Pattern reference (src/freqsplit_config.js): split positions stay sorted and inside the range for every insertion
 *     direction / fractional count (1..1024) / Bend / Pinch / Spin / Crossfade, masks sum to 1, fractional Nudge crossfades and
 *     wraps, Spin slides and wraps, a fractional split grows in at the right place for each direction and recolours nothing when it
 *     becomes full, Bend and Pinch do what they say, the Python port used by the audio runner agrees.
 *  2. The GenExpr functions (src/spectral_split_lib.genexpr + fs_* in src/freqsplit_core.genexpr), transpiled to JS with
 *     tests/genexpr_functions.js (bounds-checked Data) and run as a sample-by-sample pipeline: masks vs the reference, the four
 *     channels null against the delayed input at many settings, sines land in the predicted channel, Nudge rotates, the
 *     Spectral Limiter caps a loud sine and leaves a quiet one alone, silence gives exact zeros, telemetry bounds.
 *  3. GenExpr lint and the shared link module.
 *  4. The built device: header, latency, 169 px, geometry, panels last, buffer names, parameter table, wiring and the .adg.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { minifyGen, builderGen } = require("./minify_gen.js");

const ROOT = path.resolve(__dirname, "..");
const cfg = require(path.join(ROOT, "src", "freqsplit_config.js"));
const { DataSim, load, functionsOf } = require("./genexpr_functions.js");
const { runLinkTests } = require("./spectral_link_tests.js");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const LIB_SRC = read("src/cepstrum_lib.genexpr");
const SS_SRC = read("src/spectral_split_lib.genexpr");
const CORE_SRC = read("src/freqsplit_core.genexpr");
const RACK_SRC = read("src/spectral_split_rack.genexpr");
const RACK_MAIN = read("src/spectral_split_rack_main.genexpr");
// The gen code the device really embeds (the face writes it to a .gendsp file): lib + ss lib + rack functions + the expanded core.
function builtGenCode() {
    const raw = fs.readFileSync(path.join(ROOT, "devices", "Freq Split.amxd"));
    const p = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    const face = p.boxes.map((b) => b.box).find((b) => b.id === "obj-viz").textfile.text;
    const m = /var GEN_DSP_TEXT\s*=\s*("(?:\\.|[^"\\])*")\s*;/.exec(face);
    assert.ok(m, "face carries GEN_DSP_TEXT");
    const gendsp = JSON.parse(JSON.parse(m[1]));
    return gendsp.patcher.boxes.find((b) => b.box.maxclass === "codebox").box.code;
}
const GEN_CODE = builderGen("build_freqsplit");

const SR = 48000;
const energy = (a, s, e) => {
    let v = 0;
    for (let i = s; i < e; i++) v += a[i] * a[i];
    return v;
};
const dbr = (x) => 10 * Math.log10(x + 1e-300);

// layout parameter sets: dirs (0 High, 1 Mid, 2 Low), counts, shape controls. spin is a fraction of the axis (+-0.5).
const P0 = { splits: 16, dir: 0, xfade: 0, nudge: 0, spin: 0, bend: 0, pinch: 0 };
const withP = (p) => Object.assign({}, P0, p);
const xsGrid = (n) => Array.from({ length: n }, (_, i) => (i + 0.5) / n);
const xsOff = (n) => Array.from({ length: n }, (_, i) => (i + 0.4137) / (n + 0.171));   // not aligned with region edges

// ======================================================================
// 1. Pattern and mask reference
// ======================================================================
{
    let sets = 0;
    let maxSumErr = 0;
    for (const dir of [0, 1, 2]) {
        for (const splits of [1, 1.25, 2.5, 3, 3.999, 7.5, 16, 16.5, 100.3, 1024]) {
            for (const bend of [-1, -0.5, 0, 0.5, 1]) {
                for (const pinch of [-1, 0, 0.6, 1]) {
                    for (const spin of [-0.5, -0.37, 0, 0.25, 0.5]) {
                        for (const xfade of [0, 0.5, 1]) {
                            for (const nudge of [0, 0.5, 1.75, -2.3]) {
                                const pat = cfg.fsPattern({ splits, dir, xfade, nudge, spin, bend, pinch });
                                sets++;
                                const xs = cfg.fsSplitXs(pat);
                                for (let j = 0; j < xs.length; j++) {
                                    assert.ok(xs[j] >= 0 && xs[j] <= 1, `split position inside the axis (${xs[j]})`);
                                    if (j > 0) assert.ok(xs[j] >= xs[j - 1], `split positions monotonic (dir ${dir} n ${splits} bend ${bend} pinch ${pinch} spin ${spin})`);
                                }
                                if (spin === 0) {
                                    const K = Math.floor(splits);
                                    const want = splits - K > 0 ? K + 1 : K;
                                    assert.strictEqual(xs.length, want, `split count (n ${splits}, dir ${dir}): regions = splits + 1`);
                                }
                                if (sets % 7 === 0 || splits <= 3) {
                                    for (const x of xsGrid(97)) {
                                        const m = cfg.fsMaskAt(pat, x);
                                        const sum = m[0] + m[1] + m[2] + m[3];
                                        maxSumErr = Math.max(maxSumErr, Math.abs(sum - 1));
                                        for (const v of m) assert.ok(v >= -1e-15 && v <= 1 + 1e-15, "mask in 0..1");
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    assert.ok(maxSumErr < 1e-14, `masks along the axis sum to 1 (max err ${maxSumErr})`);
    console.log(`[layout] ${sets} parameter sets: split positions sorted and on the axis, region counts, masks sum to 1 (max err ${maxSumErr.toExponential(1)})`);
}

{
    // warp: monotonic, end points fixed, exact inverse
    let maxInv = 0;
    for (const bend of [-1, -0.6, 0, 0.3, 1]) {
        assert.ok(Math.abs(cfg.fsWarp(0.5, bend, 0) - cfg.fsBendMid(bend)) < 1e-12, `bend ${bend}: pattern 0.5 -> the midpoint (dot x)`);
        for (const pinch of [-1, -0.3, 0, 0.7, 1]) {
            let prev = -1;
            for (let i = 0; i <= 200; i++) {
                const u = i / 200;
                const v = cfg.fsWarp(u, bend, pinch);
                assert.ok(v >= prev - 1e-12, "warp monotonic");
                prev = v;
                maxInv = Math.max(maxInv, Math.abs(cfg.fsWarpInv(v, bend, pinch) - u));
            }
            assert.ok(Math.abs(cfg.fsWarp(0, bend, pinch)) < 1e-12 && Math.abs(cfg.fsWarp(1, bend, pinch) - 1) < 1e-12, "warp keeps the end points");
        }
    }
    assert.ok(maxInv < 1e-6, `fsWarpInv inverts fsWarp (max err ${maxInv})`);

    // default: 16 splits = 17 regions, channels 1 2 3 4 1 2 ... from low to high (High); 3 splits give 1 2 3 4 in every direction
    const regionChannels = (pat) => {
        const edges = [0].concat(cfg.fsSplitXs(pat), [1]);
        const out = [];
        for (let j = 0; j + 1 < edges.length; j++) out.push(cfg.fsChannelAt(pat, (edges[j] + edges[j + 1]) / 2));
        return out;
    };
    assert.deepStrictEqual(regionChannels(cfg.fsPattern(P0)), Array.from({ length: 17 }, (_, i) => i % 4), "default pattern: 17 regions dealt in rotation");
    for (const dir of [0, 1, 2]) {
        const pat = cfg.fsPattern(withP({ splits: 3, dir }));
        assert.deepStrictEqual(cfg.fsSplitXs(pat).map((v) => Math.round(v * 1e9) / 1e9), [0.25, 0.5, 0.75]);
        assert.deepStrictEqual(regionChannels(pat), [0, 1, 2, 3], `3 splits, dir ${dir}`);
    }
    assert.ok(Math.abs(cfg.fsUToHz(0.25) - 112.5) < 0.5 && Math.abs(cfg.fsUToHz(0.5) - 632.5) < 0.5, "axis: 20 Hz * 1000^x");

    // Nudge: integer values rotate; +2 moves channel 1 -> 3 and 4 -> 2; +-4 wrap to 0
    const base3 = withP({ splits: 3 });
    assert.deepStrictEqual(regionChannels(cfg.fsPattern(withP({ splits: 3, nudge: 1 }))), [1, 2, 3, 0]);
    assert.deepStrictEqual(regionChannels(cfg.fsPattern(withP({ splits: 3, nudge: 2 }))), [2, 3, 0, 1], "Nudge +2: channel 1 -> 3, channel 4 -> 2");
    assert.deepStrictEqual(regionChannels(cfg.fsPattern(withP({ splits: 3, nudge: -1 }))), [3, 0, 1, 2]);
    for (const nu of [4, -4, 8]) assert.deepStrictEqual(regionChannels(cfg.fsPattern(Object.assign({}, base3, { nudge: nu }))), [0, 1, 2, 3], `Nudge ${nu} wraps to 0`);
    // fractional Nudge crossfades the assignment between adjacent channels (masks still sum to 1)
    for (const x of xsGrid(60)) {
        const m0 = cfg.fsMaskAt(cfg.fsPattern(withP({ nudge: 1 })), x);
        const m1 = cfg.fsMaskAt(cfg.fsPattern(withP({ nudge: 2 })), x);
        for (const ph of [0.25, 0.5, 0.9]) {
            const mf = cfg.fsMaskAt(cfg.fsPattern(withP({ nudge: 1 + ph })), x);
            for (let c = 0; c < 4; c++) assert.ok(Math.abs(mf[c] - ((1 - ph) * m0[c] + ph * m1[c])) < 1e-12, "fractional Nudge = linear crossfade of the two neighbouring assignments");
            assert.ok(Math.abs(mf[0] + mf[1] + mf[2] + mf[3] - 1) < 1e-14);
        }
        const wrapA = cfg.fsMaskAt(cfg.fsPattern(withP({ nudge: 3.999999 })), x);
        const wrapB = cfg.fsMaskAt(cfg.fsPattern(withP({ nudge: -0.000001 })), x);
        const zero = cfg.fsMaskAt(cfg.fsPattern(withP({ nudge: 0 })), x);
        for (let c = 0; c < 4; c++) assert.ok(Math.abs(wrapA[c] - zero[c]) < 1e-5 && Math.abs(wrapB[c] - zero[c]) < 1e-5, "Nudge wraps continuously at +-4");
    }
    const half = cfg.fsMaskAt(cfg.fsPattern(withP({ splits: 3, nudge: 0.5 })), 0.1);
    assert.ok(Math.abs(half[0] - 0.5) < 1e-12 && Math.abs(half[1] - 0.5) < 1e-12, "Nudge 0.5: region 1 shared between channels 1 and 2");

    // Spin: slides the pattern (bend 0, pinch 0: mask(spin s, x) = mask(0, x - s) with wrap) and wraps; +-50 % is the same pattern
    for (const splits of [3, 16, 16.4, 100.7]) {
        for (const dir of [0, 1, 2]) {
            for (const s of [-0.5, -0.31, 0.07, 0.25, 0.5]) {
                const a = cfg.fsPattern(withP({ splits, dir, spin: s, xfade: 0.4, nudge: 0.3 }));
                const b = cfg.fsPattern(withP({ splits, dir, spin: 0, xfade: 0.4, nudge: 0.3 }));
                for (const x of [0.011, 0.173, 0.4021, 0.5503, 0.8117, 0.9731]) {
                    let xb = x - s;
                    xb = xb < 0 ? xb + 1 : (xb > 1 ? xb - 1 : xb);
                    const ma = cfg.fsMaskAt(a, x), mb = cfg.fsMaskAt(b, xb);
                    for (let c = 0; c < 4; c++) assert.ok(Math.abs(ma[c] - mb[c]) < 1e-9, `Spin ${s} slides the pattern (n ${splits}, dir ${dir}, x ${x})`);
                }
            }
        }
    }
    const pPlus = cfg.fsPattern(withP({ spin: 0.5 })), pMinus = cfg.fsPattern(withP({ spin: -0.5 }));
    for (const x of [0.013, 0.31, 0.6, 0.91]) assert.deepStrictEqual(cfg.fsMaskAt(pPlus, x).map((v) => Math.round(v * 1e9)), cfg.fsMaskAt(pMinus, x).map((v) => Math.round(v * 1e9)), "Spin +50 % == -50 %");
    // seam: with Spin the pattern has its start inside the axis
    assert.ok(cfg.fsSplitXs(cfg.fsPattern(withP({ spin: 0.2 }))).length === 17, "Spin adds the seam of the wrapped pattern as a (hard) edge");

    // Bend / Pinch
    const meanPos = (p) => { const xs = cfg.fsSplitXs(cfg.fsPattern(withP(Object.assign({ splits: 15 }, p)))); return xs.reduce((a, b) => a + b, 0) / xs.length; };
    assert.ok(meanPos({ bend: -1 }) < 0.3 && meanPos({ bend: 1 }) > 0.7 && Math.abs(meanPos({}) - 0.5) < 1e-9, "negative Bend packs the splits low, positive high");
    const spread = (p) => {
        const xs = cfg.fsSplitXs(cfg.fsPattern(withP(Object.assign({ splits: 15 }, p))));
        const m = cfg.fsBendMid(p.bend || 0);
        return xs.reduce((a, b) => a + Math.abs(b - m), 0) / xs.length;
    };
    assert.ok(spread({ pinch: 1 }) < spread({}) - 0.05 && spread({ pinch: -1 }) > spread({}) + 0.05, "Pinch + bunches the splits around the midpoint, - pushes them to the edges");
    assert.ok(spread({ pinch: 1, bend: 0.5 }) < spread({ bend: 0.5 }), "Pinch acts around the bent midpoint");
    assert.ok(cfg.fsSplitXs(cfg.fsPattern(withP({ splits: 7 }))).every((v, i) => Math.abs(v - (i + 1) / 8) < 1e-12), "Bend 0 / Pinch 0 leave the even layout alone");

    // Crossfade: 0 = hard masks, wide above zero; transitions of neighbouring splits never overlap (masks stay in 0..1 above)
    const hard = cfg.fsPattern(withP({ xfade: 0 })), soft = cfg.fsPattern(withP({ xfade: 1 }));
    let mixed0 = 0, mixed1 = 0;
    for (const x of xsGrid(2000)) {
        if (cfg.fsMaskAt(hard, x).some((v) => v > 1e-9 && v < 1 - 1e-9)) mixed0++;
        if (cfg.fsMaskAt(soft, x).some((v) => v > 1e-9 && v < 1 - 1e-9)) mixed1++;
    }
    assert.strictEqual(mixed0, 0, "Crossfade 0: isolated regions");
    assert.ok(mixed1 > 800, `Crossfade 100 %: adjacent regions overlap over their half widths (${mixed1} of 2000 samples mixed)`);
    console.log("[layout] defaults, Nudge (integer / fractional / wrap), Spin slide + wrap, Bend, Pinch, Crossfade verified");
}

{
    // Fractional splits grow in at the insertion point of each direction
    for (const dir of [0, 1, 2]) {
        for (const K of [1, 2, 3, 6, 15, 16, 63]) {
            const F = K + 1;
            let prevW = 0;
            for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) {
                const pat = cfg.fsPattern(withP({ splits: K + f, dir }));
                const [lo, hi] = cfg.fsPartialRange(pat);
                assert.ok(Math.abs((hi - lo) - f / (F + f)) < 1e-12, "the partial region's width is f / (n + 1) of the axis");
                assert.ok(hi - lo > prevW, "the new region widens monotonically with the fraction");
                prevW = hi - lo;
                if (dir === 0) assert.ok(Math.abs(hi - 1) < 1e-12, "High (<-): the new split grows in at the top");
                if (dir === 2) assert.ok(Math.abs(lo) < 1e-12, "Low (->): the new split grows in at the bottom");
                if (dir === 1) assert.ok(Math.abs((lo + hi) / 2 - 0.5) < 1 / (F + f), `Mid (<->): the new split grows in at the middle (centre ${((lo + hi) / 2).toFixed(4)})`);
                // the partial region carries the channel it will keep when it becomes full: same channel mid-growth and at the next integer
                const mid = cfg.fsChannelAt(pat, (lo + hi) / 2);
                const next = cfg.fsPattern(withP({ splits: K + 1, dir }));
                // find the channel of the region of `next` that contains the (shifted) partial region: its edges in `next`
                const slotNext = dir === 0 ? F : (dir === 2 ? 0 : Math.floor((F + 1) / 2));
                const xNext = (cfg.fsSlotEdge(next, slotNext) + 0.5) / next.T;
                assert.strictEqual(cfg.fsChannelAt(next, xNext), mid, `dir ${dir}, K ${K}, f ${f}: the growing region keeps its channel when it becomes full`);
            }
            // becoming full recolours nothing: masks just below and at the integer count agree (hard masks, continuous positions)
            const below = cfg.fsPattern(withP({ splits: K + 1 - 1e-9, dir }));
            const at = cfg.fsPattern(withP({ splits: K + 1, dir }));
            let diff = 0;
            for (const x of xsOff(500)) {
                const a = cfg.fsMaskAt(below, x), b = cfg.fsMaskAt(at, x);
                if (a.some((v, c) => Math.abs(v - b[c]) > 1e-6)) diff++;
            }
            assert.ok(diff <= 1, `dir ${dir}, K ${K}: no region is recoloured when the count passes an integer (${diff} samples differ)`);
            // sweeping the count by a tiny step moves the splits by a tiny amount only (smooth growth)
            const s1 = cfg.fsPattern(withP({ splits: K + 0.3, dir })), s2 = cfg.fsPattern(withP({ splits: K + 0.3001, dir }));
            let moved = 0;
            for (const x of xsOff(1000)) if (cfg.fsChannelAt(s1, x) !== cfg.fsChannelAt(s2, x)) moved++;
            assert.ok(moved <= 4 + F / 10, `dir ${dir}, K ${K}: a tiny count step changes ${moved} of 1000 samples`);
        }
    }
    console.log("[layout] fractional counts grow in at the right place (top / middle / bottom), keep their channel and recolour nothing");
}

{
    // bin masks at the extremes: sum 1 for every size / rate / count, edge bins, 1024 splits
    let maxSum = 0;
    let bins = 0;
    for (const n of [1024, 2048, 4096]) {
        for (const sr of [44100, 48000, 96000]) {
            const half = n / 2;
            const mk = [0, 1, 2, 3, 4].map(() => new Float64Array(half + 1));
            for (const dir of [0, 1, 2]) {
                for (const splits of [1, 3.5, 16, 100.5, 1024]) {
                    for (const [bend, pinch, spin, xfade, nudge] of [[0, 0, 0, 0, 0], [0.4, -0.5, 0.3, 0.5, 0.5], [-0.8, 0.9, -0.4, 1, 2.25]]) {
                        cfg.fsMasksFill(cfg.fsPattern({ splits, dir, xfade, nudge, spin, bend, pinch }), n, sr, mk);
                        for (let k = 0; k <= half; k++) {
                            maxSum = Math.max(maxSum, Math.abs(mk[0][k] + mk[1][k] + mk[2][k] + mk[3][k] - 1));
                            assert.strictEqual(mk[4][k], 1, "Output All mask is one");
                            bins++;
                        }
                    }
                }
            }
        }
    }
    assert.ok(maxSum < 1e-14, `bin masks sum to 1 (max err ${maxSum})`);
    const mk = [0, 1, 2, 3, 4].map(() => new Float64Array(1025));
    cfg.fsMasksFill(cfg.fsPattern(withP({ splits: 3 })), 2048, SR, mk);
    assert.strictEqual(mk[0][0], 1, "bins below 20 Hz belong to the first region");
    assert.strictEqual(mk[3][1024], 1, "bins above 20 kHz belong to the last region");
    assert.deepStrictEqual([0, 1, 2, 3].map((c) => mk[c][4]), [1, 0, 0, 0], "bin 4 (94 Hz at 2k) is below the first split (112.5 Hz) -> channel 1");
    assert.deepStrictEqual([0, 1, 2, 3].map((c) => mk[c][5]), [0, 1, 0, 0], "bin 5 (117 Hz at 2k) is above it -> channel 2");
    console.log(`[masks] ${bins} bin masks over 3 sizes x 3 rates x counts up to 1024: sum err ${maxSum.toExponential(1)}`);
    assert.strictEqual(cfg.fsResolveSel(0, 2), 3);
    assert.strictEqual(cfg.fsResolveSel(0, 7), 4);
    assert.strictEqual(cfg.fsResolveSel(0, -1), 0, "Auto outside a rack = all");
    assert.strictEqual(cfg.fsResolveSel(2, 0), 2);
    assert.strictEqual(cfg.fsResolveSel(5, 0), 0);
    assert.strictEqual(cfg.fsSelName(4), "Magenta");
    assert.ok(Math.abs(cfg.fsLimitGain(1, 1, 0.1) - 0.1) < 1e-12 && cfg.fsLimitGain(1, 0.05, 0.1) === 1 && cfg.fsLimitGain(0, 5, 0.1) === 1);
}

{
    // Mix identity of the 4-instance rack sum: sum_c [mix wet_c + (1 - mix) dry / 4] = mix * sum_c wet_c + (1 - mix) dry, and the
    // wet masks sum to 1, so the rack sum is mix * input + (1 - mix) * input = input for every Mix. Output All is a plain dry/wet.
    assert.strictEqual(cfg.fsDryShare(1), 0.25);
    assert.strictEqual(cfg.fsDryShare(4), 0.25);
    assert.strictEqual(cfg.fsDryShare(0), 1);
    for (const mix of [0, 0.3, 0.77, 1]) {
        for (const x of xsGrid(40)) {
            const m = cfg.fsMaskAt(cfg.fsPattern(withP({ splits: 40.5, dir: 1, xfade: 0.6, nudge: 0.4, spin: 0.2 })), x);
            let sum = 0;
            for (let c = 0; c < 4; c++) sum += mix * m[c] * 1.0 + (1 - mix) * cfg.fsDryShare(c + 1) * 1.0;
            assert.ok(Math.abs(sum - 1) < 1e-14, "rack sum of mix * wet + (1 - mix) * dry / 4 = 1 per bin");
        }
    }
    console.log("[mix] 4-chain sum identity of mix * mask + (1 - mix) / 4 verified");
}

{
    // The Python port used by scripts/run_freqsplit_audio_tests.py predicts the same masks
    const { execFileSync } = require("child_process");
    const sets = [
        withP({}), withP({ splits: 3, dir: 1, xfade: 0.5 }), withP({ splits: 16.4, dir: 2, xfade: 1, nudge: 0.5, spin: -0.2, bend: 0.3, pinch: -0.4 }),
        withP({ splits: 1024, dir: 1, xfade: 0.3, nudge: 2.7, spin: 0.45, bend: -0.7, pinch: 0.8 }), withP({ splits: 100.9, dir: 0, spin: 0.5, nudge: -1.5 })
    ];
    const xs = xsGrid(150).concat([0, 1]);
    let out = null;
    try {
        out = JSON.parse(execFileSync("python3", [path.join(ROOT, "scripts", "run_freqsplit_audio_tests.py"), "--dump-masks"], { input: JSON.stringify({ sets, xs }), encoding: "utf8" }));
    } catch (e) {
        console.log("[python] python3 not available, skipping the port cross-check");
    }
    if (out) {
        let md = 0;
        sets.forEach((p, i) => xs.forEach((x, j) => {
            const m = cfg.fsMaskAt(cfg.fsPattern(p), x);
            for (let c = 0; c < 4; c++) md = Math.max(md, Math.abs(m[c] - out[i][j][c]));
        }));
        assert.ok(md < 1e-9, `Python mask port equals the JS reference (max diff ${md})`);
        console.log(`[python] the audio runner's mask port equals the reference (max diff ${md.toExponential(1)})`);
    }
}

// ======================================================================
// 2. GenExpr functions transpiled to JS: lib + fs_* match the reference and behave
// ======================================================================
function prep(src) {
    return src
        .replace(/(?<![.\w])poke\((\w+),\s*/g, "$1.poke(")
        .replace(/\blog10\(/g, "Math.log10(")
        .replace(/\batan2\(/g, "Math.atan2(");
}
{
    const loadGx = () => load(prep(LIB_SRC), prep(SS_SRC), prep(CORE_SRC.split("\nBuffer scope(")[0]));
    // p in gen units: {nsplit, sdir, xf (0..1), nudge, spin (+-0.5), bend, pinch, limon, limdb}
    const G0 = { nsplit: 16, sdir: 0, xf: 0, nudge: 0, spin: 0, bend: 0, pinch: 0, limon: 0, limdb: 0 };
    const run = (n, sel, p, x, y, opt) => {
        const o = opt || {};
        const gx = loadGx();
        const half = n / 2;
        const tab = new DataSim(4096, 3), win = new DataSim(4096), fx = new DataSim(4096, 2);
        const ringL = new DataSim(4096), ringR = new DataSim(4096), accL = new DataSim(4096), accR = new DataSim(4096);
        const stt = new DataSim(8), ms = new DataSim(2049, 2), fsd = new DataSim(2049, 11), pc = new DataSim(32);
        const cols = new DataSim(640), scope = new DataSim(704);
        const outL = new Float64Array(x.length), outR = new Float64Array(x.length);
        let masks = null;
        let filled = false;
        const thr = Math.pow(10, p.limdb / 20);
        for (let i = 0; i < x.length; i++) {
            gx.fft_init(tab);
            gx.stft_win(win, n);
            const rdy = gx.ss_in(ringL, ringR, stt, x[i], y[i], n);
            if (rdy > 0.5) {
                gx.ss_frame(fx, ringL, ringR, stt, win, n);
                gx.fft_run(fx, tab, n, 0);
                const tele = o.tele && i > x.length - 2 * n;
                if (tele) gx.ss_mid(fx, ms, n);
                if (!filled) { // the core refills the masks only when a control, N or the sample rate changed
                    gx.fs_pattern(pc, p.nsplit, p.sdir, p.xf, p.nudge, p.spin, p.bend, p.pinch);
                    gx.fs_masks(fsd, pc, n, SR);
                    filled = true;
                    masks = [0, 1, 2, 3, 4].map((c) => Array.from({ length: half + 1 }, (_, k) => fsd.peek(k, c)));
                }
                if (p.limon > 0.5) gx.fs_limit(fx, fsd, thr, n);
                const applyCh = sel < 0.5 ? 9 : 4 + sel;      // the template applies the FINAL mask rows 5 + c (c = 4 is the All row 9)
                gx.ss_apply(fx, fsd, applyCh, n);
                if (tele) {
                    const tch = 5;
                    gx.ss_cols(ms, 0, fsd, -1, cols, 0, n, SR, 128, 20, 20000);
                    for (let c = 0; c < 4; c++) gx.ss_cols(ms, 0, fsd, tch + c, cols, 1 + c, n, SR, 128, 20, 20000);
                    gx.ss_tele(cols, scope, 128, 5, 0);
                }
                gx.fft_run(fx, tab, n, 1);
                gx.ss_ola(accL, accR, stt, fx, win, n);
            }
            outL[i] = gx.ss_out(accL, stt, n, 3);
            outR[i] = gx.ss_out(accR, stt, n, 4);
        }
        return { outL, outR, masks, scope };
    };
    const toGen = (lp) => ({ nsplit: lp.splits, sdir: lp.dir, xf: lp.xfade, nudge: lp.nudge, spin: lp.spin, bend: lp.bend, pinch: lp.pinch, limon: 0, limdb: 0 });
    const predictCh = (lp, f) => cfg.fsChannelAt(cfg.fsPattern(lp), cfg.fsHzToU(f));

    // --- GenExpr pattern / masks equal the reference ---
    {
        let maxd = 0;
        let cnt = 0;
        const cases = [
            P0,
            withP({ splits: 1 }),
            withP({ splits: 1024, dir: 1, bend: 0.7, pinch: -0.8, spin: 0.4, xfade: 1, nudge: 5.3 }),
            withP({ splits: 9.25, dir: 2, bend: -0.6, pinch: 0.9, spin: -0.45, xfade: 0.6, nudge: -3.4 }),
            withP({ splits: 17.9, dir: 1, bend: 0.2, pinch: 0.2, spin: 0.5, xfade: 0.9 }),
            withP({ splits: 5.5, dir: 0, bend: -1, pinch: 1, spin: -0.5, xfade: 0 }),
            withP({ splits: 64.001, dir: 1, xfade: 0.5, nudge: 3.999 }),
            withP({ splits: 63.5, dir: 2, xfade: 1 })
        ];
        for (const n of [1024, 4096]) {
            const half = n / 2;
            for (const lp of cases) {
                const gx = loadGx();
                const pc = new DataSim(32), fsd = new DataSim(2049, 11);
                gx.fs_pattern(pc, lp.splits, lp.dir, lp.xfade, lp.nudge, lp.spin, lp.bend, lp.pinch);
                gx.fs_masks(fsd, pc, n, SR);
                const mk = [0, 1, 2, 3, 4].map(() => new Float64Array(half + 1));
                cfg.fsMasksFill(cfg.fsPattern(lp), n, SR, mk);
                for (let c = 0; c < 5; c++) for (let k = 0; k <= half; k++) {
                    maxd = Math.max(maxd, Math.abs(mk[c][k] - fsd.peek(k, c)));
                    maxd = Math.max(maxd, Math.abs(mk[c][k] - fsd.peek(k, 5 + c)));      // the final-mask rows 5..9 start as copies of the raw masks
                    cnt++;
                }
            }
        }
        assert.ok(maxd < 1e-9, `GenExpr pattern and masks equal the JS reference (max diff ${maxd})`);
        console.log(`[genexpr] fs_pattern / fs_masks equal the reference over ${cnt} mask values (max diff ${maxd.toExponential(1)})`);
    }

    // --- sum of the four channels nulls against the input delayed by n - 1 (stereo, mixed signal) ---
    {
        const n = 1024;
        const N = 14000;
        let seed = 11;
        const rnd = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296 * 2 - 1;
        };
        const x = new Float64Array(N), y = new Float64Array(N);
        for (let i = 0; i < N; i++) {
            x[i] = 0.3 * Math.sin(i * 0.07) + 0.2 * rnd();
            y[i] = 0.25 * Math.sin(i * 0.031) + 0.2 * rnd();
        }
        const settings = [
            toGen(P0),
            toGen(withP({ splits: 1, xfade: 0 })),
            toGen(withP({ splits: 7.5, dir: 2, xfade: 0.5, nudge: 2 })),
            toGen(withP({ splits: 1024, dir: 1, xfade: 1, bend: 0.6, pinch: -0.5, spin: 0.35 })),
            toGen(withP({ splits: 100.3, dir: 0, xfade: 0, bend: -0.9, pinch: 0.8, spin: -0.4, nudge: 0.5 })),
            toGen(withP({ splits: 4, xfade: 1, spin: 0.5, nudge: -3.3 })),
            toGen(withP({ splits: 63.4, dir: 1, xfade: 0.7, nudge: 1.5 }))
        ];
        let worst = -400;
        for (const p of settings) {
            const ch = [1, 2, 3, 4].map((c) => run(n, c, p, x, y));
            let e = 0, t = 0;
            for (let i = n; i < N; i++) {
                const dl = ch[0].outL[i] + ch[1].outL[i] + ch[2].outL[i] + ch[3].outL[i] - x[i - (n - 1)];
                const dr = ch[0].outR[i] + ch[1].outR[i] + ch[2].outR[i] + ch[3].outR[i] - y[i - (n - 1)];
                e += dl * dl + dr * dr;
                t += x[i - (n - 1)] ** 2 + y[i - (n - 1)] ** 2;
            }
            const nul = dbr(e / t);
            worst = Math.max(worst, nul);
            assert.ok(nul < -250, `the four channels null against the delayed input (${nul.toFixed(1)} dB, ${JSON.stringify(p)})`);
            for (let c = 0; c < 4; c++) if (p.nsplit >= 3) assert.ok(energy(ch[c].outL, 0, N) > 0, `channel ${c + 1} carries signal`);
            const all = run(n, 0, p, x, y);
            let e2 = 0;
            for (let i = n; i < N; i++) e2 += (all.outL[i] - x[i - (n - 1)]) ** 2 + (all.outR[i] - y[i - (n - 1)]) ** 2;
            assert.ok(dbr(e2 / t) < -250, "Output All is the exact delayed identity");
        }
        console.log(`[genexpr] four-channel sum nulls at ${settings.length} settings incl. 1024 splits and fractional counts / Nudge (worst ${worst.toFixed(1)} dB), Output All is an identity`);
    }

    // --- sines land in the predicted channel (reference prediction); Nudge rotates, fractional Nudge splits energy; stereo image kept ---
    {
        const n = 4096;
        const N = 24000;
        const mix = (freqs, amp) => {
            const x = new Float64Array(N);
            for (let i = 0; i < N; i++) x[i] = freqs.reduce((a, f) => a + amp * Math.sin(2 * Math.PI * f * i / SR), 0);
            return x;
        };
        // 16 splits: regions 5, 8, 11, 14 at their log centres (187 Hz .. 1.6k .. 8k, far wider than a bin at 4k)
        const lay = (extra) => withP(Object.assign({ xfade: 0 }, extra));
        const centre = (T, j) => cfg.fsUToHz((j + 0.5) / T);
        const worstIso = [];
        const cases = [
            [lay({}), 17, [5, 8, 11, 14]],
            [lay({ nudge: 1 }), 17, [5, 8, 11, 14]],
            [lay({ nudge: 2 }), 17, [5, 8, 11, 14]],
            [lay({ dir: 1, splits: 11 }), 12, [4, 6, 9, 10]],
            [lay({ dir: 2, splits: 9 }), 10, [2, 4, 6, 8]],
            [lay({ spin: 0.2 }), 17, [5, 8, 11, 12]]
        ];
        for (const [lp, T, regs] of cases) {
            const p = toGen(lp);
            for (const j of regs) {
                // with Spin the pattern slides: probe the pattern region centre translated along the axis
                const f = lp.spin ? cfg.fsUToHz(((j + 0.5) / T + lp.spin) % 1) : centre(T, j);
                const x = mix([f], 0.3);
                const y = x.map((v) => v * 0.5);
                const want = predictCh(lp, f);
                const e = [1, 2, 3, 4].map((c) => run(n, c, p, x, y));
                const en = e.map((o) => energy(o.outL, 12000, 22000));
                const other = Math.max(...en.filter((_, c) => c !== want));
                const iso = dbr(en[want] / Math.max(other, 1e-300));
                worstIso.push(iso);
                assert.ok(iso > 40, `${f.toFixed(0)} Hz (dir ${lp.dir}, nudge ${lp.nudge}, spin ${lp.spin}) lands in channel ${want + 1} with > 40 dB isolation (${iso.toFixed(1)} dB)`);
                if (lp.nudge === 0 && !lp.spin && j === regs[0]) {
                    const r = Math.sqrt(energy(e[want].outR, 12000, 22000) / energy(e[want].outL, 12000, 22000));
                    assert.ok(Math.abs(r - 0.5) < 0.01, `stereo image kept (R/L ${r.toFixed(3)})`);
                }
            }
        }
        // fractional Nudge 0.5: a sine splits its energy equally between two adjacent channels
        {
            const lp = lay({ nudge: 0.5 });
            const f = centre(17, 8);
            const x = mix([f], 0.3);
            const e = [1, 2, 3, 4].map((c) => energy(run(n, c, toGen(lp), x, x).outL, 12000, 22000));
            const c0 = predictCh(lay({}), f);
            const top = [e[c0], e[(c0 + 1) % 4]];
            assert.ok(Math.abs(top[0] / top[1] - 1) < 0.02, `Nudge 0.5 shares the sine equally between channels ${c0 + 1} and ${(c0 + 1) % 4 + 1} (${top[0].toFixed(4)} / ${top[1].toFixed(4)})`);
            assert.ok(Math.max(e[(c0 + 2) % 4], e[(c0 + 3) % 4]) < 1e-9 * top[0], "no energy in the other two channels");
        }
        console.log(`[genexpr] sines land in the predicted channel at Size 4k, several directions / Nudge / Spin: isolation min ${Math.min(...worstIso).toFixed(1)} dB; fractional Nudge splits evenly`);
    }

    // --- Spectral Limiter ---
    {
        const n = 2048;
        const N = 20000;
        const sine = (f, a) => Float64Array.from({ length: N }, (_, i) => a * Math.sin(2 * Math.PI * f * i / SR));
        const lp = withP({ xfade: 0 });
        const p = Object.assign(toGen(lp), { limon: 1, limdb: -20 });
        const thr = 0.1;
        const peak = (a) => {
            let m = 0;
            for (let i = 12000; i < 19000; i++) m = Math.max(m, Math.abs(a[i]));
            return m;
        };
        // loud sine in the middle of region 8 against a -20 dB (0.1) limit, quiet sine in region 5 (another channel)
        const fL = cfg.fsUToHz(8.5 / 17), fQ = cfg.fsUToHz(5.5 / 17);
        const chL = predictCh(lp, fL), chQ = predictCh(lp, fQ);
        assert.notStrictEqual(chL, chQ);
        const loud = sine(fL, 0.8);
        const lo = run(n, chL + 1, p, loud, loud);
        const loPeak = peak(lo.outL);
        assert.ok(loPeak < 0.8 * 0.35 && loPeak > thr * 0.6 && loPeak < thr * 1.9, `loud sine capped near the threshold (peak ${loPeak.toFixed(3)} vs limit ${thr})`);
        const quiet = sine(fQ, 0.04);
        const qOn = run(n, chQ + 1, p, quiet, quiet);
        const qOff = run(n, chQ + 1, Object.assign({}, p, { limon: 0 }), quiet, quiet);
        let md = 0;
        for (let i = 4000; i < N; i++) md = Math.max(md, Math.abs(qOn.outL[i] - qOff.outL[i]));
        assert.ok(md < 1e-12, `a sine below the threshold is unaffected (diff ${md})`);
        const two = sine(fQ, 0.03).map((v, i) => v + 0.8 * Math.sin(2 * Math.PI * fL * i / SR));
        const t3 = run(n, chL + 1, p, two, two), t2 = run(n, chQ + 1, p, two, two), t2off = run(n, chQ + 1, Object.assign({}, p, { limon: 0 }), two, two);
        assert.ok(peak(t3.outL) < 0.2, "loud region capped in its own channel");
        let md2 = 0;
        for (let i = 4000; i < N; i++) md2 = Math.max(md2, Math.abs(t2.outL[i] - t2off.outL[i]));
        assert.ok(md2 < 1e-12, "the quiet sine in another channel passes unchanged");
        // a threshold above the signal (+12 dB) leaves the exact sum
        const hi = Object.assign({}, p, { limdb: 12 });
        const sum = [1, 2, 3, 4].map((c) => run(n, c, hi, quiet, quiet));
        let e = 0;
        for (let i = n; i < N; i++) e += (sum[0].outL[i] + sum[1].outL[i] + sum[2].outL[i] + sum[3].outL[i] - quiet[i - (n - 1)]) ** 2;
        assert.ok(dbr(e / energy(quiet, 0, N)) < -250, "limiter above the signal level leaves the exact sum");
        console.log(`[genexpr] limiter: ${loPeak.toFixed(3)} peak for a 0.8 sine at -20 dB (limit 0.1), quiet sine diff ${md.toExponential(1)}`);
    }

    // --- silence, telemetry ---
    {
        const n = 1024;
        const z = run(n, 1, toGen(P0), new Float64Array(6000), new Float64Array(6000));
        assert.strictEqual(energy(z.outL, 0, 6000) + energy(z.outR, 0, 6000), 0, "silence in -> exact zeros out");
        const N = 12000;
        const x = Float64Array.from({ length: N }, (_, i) => 0.3 * Math.sin(i * 0.05) + 0.1 * Math.sin(i * 0.9));
        const g = run(n, 1, Object.assign(toGen(P0), { limon: 1, limdb: -30 }), x, x, { tele: true });
        let nonzero = 0;
        for (let i = 0; i < 640; i++) {
            const v = g.scope.peek(i);
            assert.ok(v >= 0 && v <= 1.0000001, `telemetry value ${i} in 0..1 (${v})`);
            if (v > 0) nonzero++;
        }
        assert.ok(nonzero > 100, "telemetry columns are filled");
        console.log("[genexpr] silence gives exact zeros; telemetry columns in range");
    }
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
        for (const l of fn.body) assert.ok(!/\bif\s*\(\s*[^)]*\b(ss2?|fs|stft|fft|cep)_\w+\(/.test(l), `${fn.name}: no function call inside an if condition`);
    }
    for (const src of [SS_SRC, RACK_SRC, GEN_CODE]) {
        const code = src.replace(/\/\/.*$/gm, "");
        assert.ok(!/\bpoke\([^;]*\b(ss2?|fs|stft|fft|cep)_\w+\(/.test(code), "no user function call inside poke() arguments (silent compile failure in Max)");
        assert.ok(!/\be\d\b/.test(code), "no identifier e<digit>");
        assert.ok(!/\b(phi|pi)\s*=/.test(code), "no phi / pi assignments");
    }
    // statements of the expanded core: no function call in an if condition either
    for (const l of GEN_CODE.split("\n")) {
        if (/^\s*(\}\s*else\s*)?if\s*\(/.test(l)) assert.ok(!/\b(ss2?|fs|stft|fft|cep)_\w+\(/.test(l.replace(/\/\/.*$/, "")), `no function call inside an if condition: ${l.trim()}`);
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
    for (const name of ["fftn", "nsplit", "sdir", "xfadeamt", "nudgeamt", "spinamt", "bendamt", "pinchamt", "limon", "limdb", "mixamt", "outsel", "role", "serve", "epoch"]) assert.ok(new RegExp(`^Param ${name}\\(`, "m").test(GEN_CODE), `Param ${name}`);
    assert.ok(/Buffer scope\("freqsplitscope"\)/.test(CORE_SRC), "Buffer bound by the GenExpr variable name `scope` (no set prefix)");
    assert.ok(!/@@/.test(GEN_CODE) && !/\/\/@(hook|endhook|SS_)/.test(GEN_CODE), "the template is fully expanded");
    // Mix: the dry share is 1 / 4 per chain (1 for Output All), the dry is delayed by the reported latency (template)
    assert.ok(GEN_CODE.includes("kShare = (selH > 0.5 && roleH > 0.5) ? 0.25 : 1;"), "Mix: dry share is 1/4 per rack chain (role-gated; standalone single-channel keeps full dry)");
    assert.ok(GEN_CODE.includes(`Delay dryL(${cfg.FS_LATENCY + 1})`) && GEN_CODE.includes(`dryL.read(${cfg.FS_LATENCY})`), "the dry signal is delayed by the reported latency");
    assert.ok(GEN_CODE.includes("if (chg > 0.000000001) {") && GEN_CODE.includes("abs(loH - loU)"), "masks are only refilled when a control, N, the sample rate or the limiter switch changed");
    // the template writes the common scalars at SCB + offset (SCB = FS_SC_FRAME): every offset is the config's
    const scal = { 1: "FS_SC_SR", 2: "FS_SC_N", 3: "FS_SC_AWAKE", 4: "FS_SC_LEVEL", 6: "FS_SC_LATENCY", 7: "FS_SC_SEL", 8: "FS_SC_CMP", 9: "FS_SC_FOL", 10: "FS_SC_ALIGNED",
        11: "FS_SC_FB", 12: "FS_SC_DOFF", 13: "FS_SC_UNDER", 14: "FS_SC_LAG", 15: "FS_SC_SERVE", 16: "FS_SC_ROLE", 17: "FS_SC_ALIVE" };
    for (const [off, key] of Object.entries(scal)) {
        assert.strictEqual(cfg.FS_SC_FRAME + Number(off), cfg[key], `${key} = FS_SC_FRAME + ${off}`);
        assert.ok(GEN_CODE.includes(`, ${cfg.FS_SC_FRAME} + ${off}, 0);`), `gen writes scope slot ${key}`);
    }
    const m = GEN_CODE.match(/poke\(scope, frameNo, (\d+) \+ 0, 0\)|poke\(scope, frameNo, (\d+), 0\)/);
    assert.strictEqual(Number(m[1] || m[2]), cfg.FS_SC_FRAME, "telemetry frame counter slot");
    assert.ok(GEN_CODE.includes(`poke(scope, loH, ${cfg.FS_SC_LIM}, 0)`), "limiter slot");
    assert.ok(GEN_CODE.includes(`ss2_zeroscope(scope, ${cfg.FS_SC_FRAME})`), "sleep clears the columns");
    assert.ok(GEN_CODE.includes("ss_tele(cols, scope, 128, 4, 0)") && GEN_CODE.includes("ss_tele(cols, scope, 128, 1, 512)") && /Data cols\(512\)/.test(GEN_CODE),
        "five telemetry slots of 128 columns through the template's four-slot cols");
    assert.ok(cfg.FS_SC_LIM + 1 <= cfg.FS_SCOPE_SAMPS && cfg.FS_SCOPE_SAMPS <= 704, "scope buffer big enough");
    assert.ok(RACK_MAIN.includes("@@SCB@@ + 17"), "template alive counter at SCB + 17");

    runLinkTests();
    console.log("[lint] genexpr lint and link module tests passed");
}

// ======================================================================
// 4. The built device and rack preset
// ======================================================================
{
    const amxd = path.join(ROOT, "devices", "Freq Split.amxd");
    const raw = fs.readFileSync(amxd);
    assert.strictEqual(raw.slice(0, 4).toString(), "ampf");
    assert.strictEqual(raw.slice(8, 12).toString(), "aaaa", "audio effect");
    assert.strictEqual(raw.readUInt32LE(28), raw.length - 32);
    const p = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    assert.strictEqual(p.latency, cfg.FS_LATENCY, "latency attribute = FS_LATENCY (5120)");
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
    // deferred DSP (AGENTS.md 1d): no gen~ in the saved device, a gate 1 1 hub, scripting names, no static audio cords
    assert.ok(!byId["obj-gen"], "the device ships without its gen~");
    assert.strictEqual(byId["obj-genin"].text, "gate 1 1");
    assert.deepStrictEqual([byId["obj-genin"].varname, byId["obj-plugin"].varname, byId["obj-plugout"].varname], ["ss_genin", "ss_plugin", "ss_plugout"]);
    const allLines = p.lines.map((l) => l.patchline);
    assert.ok(!allLines.some((l) => l.source[0] === "obj-plugin" || l.destination[0] === "obj-plugout"), "no static audio cord (the face wires plugin~ -> gen~ -> plugout~)");
    assert.ok(allLines.every((l) => l.destination[0] !== "obj-gen"), "no cord into a gen~ that is not there");
    assert.ok(allLines.some((l) => l.source[0] === "obj-viz" && l.source[1] === 2 && l.destination[0] === "obj-genin" && l.destination[1] === 1), "face outlet 2 -> hub data inlet");
    // the embedded gen = lib + ss lib + rack functions + the expanded core
    assert.strictEqual(builtGenCode(), minifyGen(GEN_CODE), "embedded gen is the mangled core");
    assert.ok(GEN_CODE.indexOf("fft_run(") < GEN_CODE.indexOf("ss_in(") && GEN_CODE.indexOf("ss_in(") < GEN_CODE.indexOf("ss2_align(") && GEN_CODE.indexOf("ss2_align(") < GEN_CODE.indexOf("fs_pattern("), "library functions come first");
    assert.ok(GEN_CODE.startsWith(LIB_SRC.replace(/\s+$/, "") + "\n"), "gen code starts with cepstrum_lib");
    assert.ok(GEN_CODE.includes(SS_SRC.replace(/\s+$/, "") + "\n") && GEN_CODE.includes(RACK_SRC.replace(/\s+$/, "") + "\n"), "gen code contains spectral_split_lib and spectral_split_rack verbatim");
    const faceTxt = byId["obj-viz"].textfile.text;
    assert.ok(/var GEN_DSP_HASH\s*=\s*"[0-9a-f]{12}"\s*;/.test(faceTxt) && /var SS_PREFIX\s*=\s*"freqsplit"\s*;/.test(faceTxt), "face carries the gen patch hash and prefix");
    assert.ok(faceTxt.includes("function ssDspLoad") && faceTxt.includes("function ssDspRestart"), "face carries the deferred-DSP module");
    assert.ok(byId["obj-scope-buf"].text.startsWith("buffer~ ---freqsplitscope"), "per-instance buffer name");
    assert.ok(Number(byId["obj-scope-buf"].text.match(/@samps (\d+)/)[1]) >= cfg.FS_SCOPE_SAMPS, "scope buffer length");
    assert.ok(byId["obj-ring-buf"].text.startsWith("buffer~ ---ssring @samps "), "per-instance ring buffer");
    assert.ok(Number(byId["obj-ring-buf"].text.match(/@samps (\d+)/)[1]) === 16 + 8192 * 11, "ring length = header + slots * stride (4 channels + the All row)");
    assert.strictEqual(byId["obj-msg-ui-names"].text, "setnames ---freqsplitscope ---ssring", "the face learns both per-instance buffer names");
    assert.ok(!boxes.some((b) => /#0/.test(b.text || "") && b.text !== "r #0-sstest"), "no #0 names in a top-level device (the test hook receive #0-sstest is the one deliberate shared name)");
    assert.ok(allLines.some((l) => l.source[0] === "obj-r-sstest" && l.destination[0] === "obj-viz"), "test hook receive #0-sstest -> face");
    const firstPanel = boxes.findIndex((b) => b.maxclass === "panel");
    assert.ok(firstPanel > 0 && boxes.slice(firstPanel).every((b) => b.maxclass === "panel"), "panels are the last boxes");
    for (const b of boxes.slice(firstPanel)) assert.strictEqual(b.background, 1, `${b.id} background 1`);
    const pres = boxes.filter((b) => b.presentation === 1 && b.maxclass !== "panel");
    const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    for (const b of pres) {
        const r = b.presentation_rect;
        assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= p.devicewidth && r[1] + r[3] <= 169, `${b.id} inside the device`);
        if (b.maxclass !== "v8ui") for (const v of pres.filter((o) => o.maxclass === "v8ui")) assert.ok(!overlap(v.presentation_rect, r), `${b.id} must not overlap the v8ui ${v.id}`);
    }
    assert.ok(!overlap(byId["obj-viz"].presentation_rect, byId["obj-viz-top"].presentation_rect), "the two v8uis do not overlap");
    assert.ok(byId["obj-ctrl-dir"].presentation !== 1, "the Insert tab is off the face (the header v8ui draws the arrows)");
    const inter = pres.filter((b) => /^live\./.test(b.maxclass) && b.maxclass !== "live.comment");
    for (let i = 0; i < inter.length; i++) for (let j = i + 1; j < inter.length; j++) assert.ok(!overlap(inter[i].presentation_rect, inter[j].presentation_rect), `${inter[i].id} and ${inter[j].id} overlap`);
    for (const b of pres) {
        if (b.maxclass !== "live.comment") continue;
        for (const o of inter) assert.ok(!overlap(b.presentation_rect, o.presentation_rect), `label ${b.id} overlaps ${o.id}`);
        for (const o of pres) if (o !== b && o.maxclass === "live.comment") assert.ok(!overlap(b.presentation_rect, o.presentation_rect), `labels ${b.id} and ${o.id} overlap`);
    }
    assert.strictEqual(boxes.filter((b) => b.maxclass === "v8ui").length, 2, "main canvas + header strip");
    // parameters: table versus the reference
    const names = new Set();
    for (const [key, spec] of Object.entries(cfg.FS_PARAMS)) {
        const v = byId[`obj-ctrl-${key}`].saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_longname, spec[0], `${key} long name`);
        assert.strictEqual(v.parameter_shortname, spec[1]);
        assert.deepStrictEqual([v.parameter_mmin, v.parameter_mmax, v.parameter_initial[0], v.parameter_type], [spec[2], spec[3], spec[4], spec[5]], `${key} range / initial / type`);
        assert.strictEqual(v.parameter_units, cfg.FS_UNITS[key], `${key} display units`);
        if (v.parameter_type === 1) assert.ok(v.parameter_mmax <= 255 && v.parameter_mmax - v.parameter_mmin <= 255, "native Int parameters stay within 255");
        assert.ok(!names.has(v.parameter_shortname), "unique short name");
        names.add(v.parameter_shortname);
    }
    for (const [key, spec] of Object.entries(cfg.FS_ENUMS)) {
        const v = byId[`obj-ctrl-${key}`].saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_longname, spec[0]);
        assert.deepStrictEqual(v.parameter_enum, spec[2], `${key} enum`);
        assert.strictEqual(v.parameter_initial[0], spec[3], `${key} initial`);
        assert.ok(!names.has(v.parameter_shortname), "unique short name");
        names.add(v.parameter_shortname);
    }
    assert.strictEqual(byId["obj-ctrl-size"].saved_attribute_attributes.valueof.parameter_initial[0], 2, "Size defaults to 4k");
    assert.strictEqual(byId["obj-ctrl-splits"].saved_attribute_attributes.valueof.parameter_initial[0], 16, "16 splits by default");
    assert.strictEqual(byId["obj-ctrl-dispost"].saved_attribute_attributes.valueof.parameter_initial[0], 0, "Spectrum Display defaults to Pre");
    assert.strictEqual(byId["obj-ctrl-limon"].maxclass, "live.text", "Spectral Limiter is a toggle");
    assert.strictEqual(byId["obj-ctrl-mix"].maxclass, "live.dial", "Mix is a dial");
    // wiring
    const lines = p.lines.map((l) => l.patchline);
    const from = (id) => lines.filter((l) => l.source[0] === id).map((l) => l.destination[0]);
    const GEN = { splits: "nsplit", dir: "sdir", xfade: "xfadeamt", nudge: "nudgeamt", spin: "spinamt", bend: "bendamt", pinch: "pinchamt", limon: "limon", limthr: "limdb", mix: "mixamt", size: "fftn" };
    for (const [key, msg] of Object.entries(GEN)) {
        assert.strictEqual(byId[`obj-prep-${key}`].text, `prepend ${msg}`);
        assert.ok(from(`obj-prep-${key}`).includes("obj-genin"), `${key} -> hub -> gen`);
        assert.ok(from(`obj-ui-${key}`).includes("obj-viz") && byId[`obj-ui-${key}`].text === `prepend set_${key}`, `${key} -> face`);
    }
    for (const key of ["xfade", "spin", "bend", "pinch", "mix"]) assert.strictEqual(byId[`obj-scale-${key}`].text, "* 0.01");
    assert.ok(byId["obj-expr-size"].text.startsWith("expr 1024 * pow(2"), "Size -> 1024 * 2^i");
    assert.ok(from("obj-ctrl-output").includes("obj-ui-output") && !from("obj-ctrl-output").includes("obj-prep-output"), "Output goes to the face only (it resolves Auto)");
    assert.ok(from("obj-ctrl-dispost").includes("obj-ui-dispost") && !from("obj-ctrl-dispost").includes("obj-prep-dispost"), "the Spectrum Display choice goes to the face only");
    assert.ok(lines.some((l) => l.source[0] === "obj-viz-top" && l.destination[0] === "obj-ctrl-dir"), "the header arrows drive the Insert tab");
    assert.ok(from("obj-top-prep-dir").includes("obj-viz-top") && byId["obj-top-prep-dir"].text === "prepend set_dir", "the header strip follows Insert (echo and rack peers)");
    assert.ok(lines.some((l) => l.source[0] === "obj-route-link" && l.destination[0] === "obj-top-prep-dir"), "rack peer Insert values reach the header strip");
    const linkRoute = byId["obj-route-link"].text.split(" ").slice(1);
    assert.deepStrictEqual(linkRoute, cfg.FS_LINKED_KEYS, "link route lists the linked keys, in order");
    assert.ok(!linkRoute.includes("output") && !linkRoute.includes("dispost"), "Output and the display choice are not linked");
    assert.ok(linkRoute.includes("mix"), "Mix is linked (the rack sum identity needs every instance on the same Mix)");
    linkRoute.forEach((key, i) => {
        const dests = lines.filter((l) => l.source[0] === "obj-route-link" && l.source[1] === i).map((l) => l.destination[0]);
        assert.ok(dests.includes(`obj-lset-${key}`), `${key}: peer value -> prepend set`);
        assert.strictEqual(byId[`obj-lset-${key}`].text, "prepend set");
        assert.ok(from(`obj-lset-${key}`).includes(`obj-ctrl-${key}`), `${key}: prepend set -> control`);
        assert.ok(dests.length === (key === "dir" ? 3 : 2), `${key}: peer value also feeds the gen path`);
        assert.ok(!dests.includes("obj-gen"), `${key}: only through the hub`);
    });
    const canvas = byId["obj-route-canvas"].text.split(" ").slice(1);
    for (const key of ["bend", "pinch", "limthr", "spin"]) {
        assert.ok(canvas.includes(key), `canvas can edit ${key}`);
        assert.ok(from("obj-route-canvas").includes(`obj-ctrl-${key}`));
    }
    assert.ok(lines.some((l) => l.source[0] === "obj-thisdevice" && l.destination[0] === "obj-msg-init") && byId["obj-msg-init"].text === "init_link", "init from live.thisdevice, not loadbang");
    const face = byId["obj-viz"].textfile.text;
    assert.ok(face.includes("function splCreateLink") && face.includes("function fsPattern") && face.includes("function paint") && face.includes("function ssDspLoad"), "face = config + link + theme + deferred DSP + ui");
    const topFace = byId["obj-viz-top"].textfile.text;
    assert.ok(topFace.includes("function paint") && /mgraphics\.relative_coords\s*=\s*0/.test(topFace) && !/\bvar\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(topFace), "header strip script");
    // The three arrows are drawn as 27 px cells at x 0 / 28 / 56. A click inside a painted cell selects that cell.
    {
        const { makeRecorder, loadFace } = require("./paint_bounds_lib");
        const outs = [];
        const ui = loadFace(topFace, makeRecorder(84, 15), { outlet() { outs.push(Array.from(arguments)); } });
        ui.set_dir(1);
        outs.length = 0;
        ui.onclick(28.5, 7);
        assert.strictEqual(ui.ftDir, 1, `click inside the painted middle arrow set Insert to ${ui.ftDir}`);
        ui.onclick(1, 7);
        assert.strictEqual(ui.ftDir, 0, "click inside the painted left arrow selects High");
        ui.onclick(70, 7);
        assert.strictEqual(ui.ftDir, 2, "click inside the painted right arrow selects Low");
    }
    assert.ok(/mgraphics\.relative_coords\s*=\s*0/.test(face) && /mgraphics\.autofill\s*=\s*0/.test(face), "v8ui pixel coordinates");
    assert.ok(!/\bvar\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(face), "no declared v8ui globals");
    // .adg
    const adg = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "devices", "Freq Split.adg"))).toString("utf8");
    const branches = adg.match(/<AudioEffectBranchPreset Id="\d+">/g);
    assert.strictEqual(branches.length, 4, "four chains");
    const names2 = [...adg.matchAll(/<AudioEffectBranchPreset Id="\d+">\s*<Name Value="([^"]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(names2, ["Red", "Blue", "Yellow", "Magenta"], "chains are named after the channels, in order");
    assert.strictEqual((adg.match(/<MxDeviceAudioEffect /g) || []).length, 4, "one device per chain");
    assert.strictEqual((adg.match(/<UserName Value="Freq Split"/g) || []).length, 1, "rack name");
    assert.ok((adg.match(/Freq Split\.amxd/g) || []).length >= 8, "each chain references the .amxd (relative and absolute)");
    console.log("[device] built device and rack preset checks passed");
}

console.log("All Freq Split tests passed");
require("./test_spectral_rack.js");
require("./test_spectral_dsp.js");

require("./test_freqsplit_paint_bounds.js");
