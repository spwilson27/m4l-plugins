"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mx = require("../src/sampler_modmatrix.js");

const rows = mx.modDefaultRows();
assert.deepStrictEqual(mx.modPack(rows, {}, 100), [0], "no cells, no routes");
assert.strictEqual(mx.modOffset(3, -36, 36, 0, 1), 3, "zero depth is the base");
assert.strictEqual(mx.modOffset(-2, -36, 36, 0, -1), -2, "zero depth keeps a negative base");
assert.strictEqual(mx.modSmooth(0, 0, 0.9), 0, "a resting smoother stays at zero");
assert.ok(Math.abs(mx.modSmooth(0, 1, 0.5) - 0.5) < 1e-9, "a smoother moves toward the offset");

const legacy = mx.modPack({ 1: ["pitch_st", "play_pos", "filt_cutoff"], 2: ["samp_gain"], 3: [] }, {
    "1:0:1": 40, "1:1:1": 20, "1:2:1": 10, "1:0:3": 15, "1:1:3": 8, "1:2:3": 4, "2:0:5": 70
}, 100);
assert.deepStrictEqual(legacy, [0], "legacy depths are not packed a second time");

const pan = mx.modPack({ 1: ["osc1_pan"], 2: [], 3: [] }, { "1:0:4": 50 }, 100);
assert.strictEqual(pan[0], 1);
assert.strictEqual(pan[1], 134, "osc 1 pan is prm 134");
assert.strictEqual(pan[2], 4);
assert.strictEqual(pan[4], -1);
assert.strictEqual(pan[5], 1);
assert.strictEqual(pan[6], 0, "pan is not a smoothed marker");

const marker = mx.modPack({ 1: ["play_pos"], 2: [], 3: [] }, { "1:0:4": -25 }, 200);
assert.strictEqual(marker[6], 1, "playhead modulation is smoothed");
assert.ok(Math.abs(marker[3] - (-0.5)) < 1e-9, "global amount 200% doubles the depth");

const silent = mx.modPack({ 1: ["osc1_pan"], 2: [], 3: [] }, { "1:0:4": 50 }, 0);
assert.strictEqual(silent[0], 0, "Global Amount 0% packs no routes, got " + silent[0]);

const depthRows = { 1: ["osc1_pan", "cell:1:0:4"], 2: [], 3: [] };
const depth = mx.modPack(depthRows, { "1:1:3": 40 }, 100);
assert.strictEqual(depth[0], 2, "a zero cell stays packed when another row targets it");
assert.strictEqual(depth[1], 134);
assert.strictEqual(depth[3], 0, "the audio route depth is zero");
assert.strictEqual(depth[7], 1000, "the second route modulates the first route's depth");

assert.strictEqual(mx.modEncode(mx.modDefaultRows(), {}), "", "defaults encode to nothing");
const polar = { "1:0:4": 1 };
const flipped = mx.modPack({ 1: ["osc1_pan"], 2: [], 3: [], 4: [] }, { "1:0:4": 50 }, 100, polar);
assert.strictEqual(flipped[2], 36, "unipolar cells pack source + 32");
const audio = mx.modPack({ 1: [], 2: [], 3: [], 4: ["pitch_st"] }, { "4:0:15": 25 }, 100);
assert.strictEqual(audio[2], 15, "audio-rate Osc 1 is source 15");
const round = {};
const roundRows = mx.modDefaultRows();
mx.modDecode(mx.modEncode({ 1: ["osc1_pan"], 2: [], 3: [], 4: [] }, { "1:0:4": 10 }, polar), roundRows, round, {});
assert.strictEqual(round["1:0:4"], 10);
assert.ok(mx.modEncode({ 1: ["osc1_pan"], 2: [], 3: [], 4: [] }, { "1:0:4": 10 }, polar).indexOf("u10") >= 0, "polarity rides in the cell text");
const decodedRows = mx.modDefaultRows();
const decoded = {};
mx.modDecode(mx.modEncode({ 1: ["osc1_pan"], 2: [], 3: [] }, { "1:0:0": 12.5 }), decodedRows, decoded);
assert.strictEqual(decodedRows[1][0], "osc1_pan");
assert.strictEqual(decoded["1:0:0"], 12.5);

assert.strictEqual(mx.modTarget("mod_global_time"), null);
assert.strictEqual(mx.modTarget("mod_global_amt"), null);
assert.ok(mx.modDenied("mode", { enums: ["A", "B"] }));
assert.ok(mx.modDenied("unison_voices", { unit: 0 }));

const gen = fs.readFileSync(path.join(__dirname, "..", "src", "sampler_core.genexpr"), "utf8");
assert.strictEqual((gen.match(/= voice_proc\(/g) || []).length, 1, "one voice_proc call");
assert.ok(gen.includes("pitchUse = pitch_st"), "pitch starts as the unmodulated value");
assert.ok(gen.includes("if (nRoutes > 0.5)"), "routes are skipped when the map is empty");
assert.ok(gen.includes("mod_restore("), "prm writes are restored");
assert.ok(gen.includes("stB + 63"), "osc 1 audio is stored for the next sample");
assert.ok(gen.includes("slot_out("), "slot type selects the modulator");
assert.strictEqual((gen.match(/mod_apply\(/g) || []).length, 3, "mod_apply is defined once and called twice");
const srcFn = gen.slice(gen.indexOf("mod_src("), gen.indexOf("mod_apply("));
assert.strictEqual((srcFn.match(/return /g) || []).length, 1, "mod_src has one return");
const applyFn = gen.slice(gen.indexOf("mod_apply("), gen.indexOf("mod_take("));
assert.strictEqual((applyFn.match(/return /g) || []).length, 1, "mod_apply has one return");
assert.ok(!gen.match(/\be\d/), "no e0..e9 identifiers");

console.log("sampler mod matrix: pack, identity, blob and gen bypass ok");
