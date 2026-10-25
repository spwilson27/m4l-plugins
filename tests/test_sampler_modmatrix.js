"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mx = require("../src/sampler_modmatrix.js");

const rows = mx.modDefaultRows();
assert.ok(rows[1].indexOf("play_pos") < 0 && rows[1].indexOf("wt1_fx1") < 0, "Osc 1 Pos and Osc 1 Warp are not default rows");
assert.strictEqual(mx.modLabel("samp_gain"), "Amp", "hardcoded names stay short");
assert.strictEqual(mx.modLabel("filt_res"), "Resonance", "resonance is a word, not the parameter key");
assert.strictEqual(mx.modLabel("filt2_cutoff"), "Cutoff 2");
assert.ok(!mx.modLabel("grain_size").includes("_"), "an unnamed target is words, got " + mx.modLabel("grain_size"));
assert.ok(rows[2].indexOf("play_pos") < 0, "Osc 1 Pos is not a MIDI default row");
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
assert.strictEqual(flipped[2], 36, "bipolar cells pack source id + 32");
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
assert.strictEqual(mx.modSlotSignal(0, 0.2, 0.4, 0.8), 0.2, "type 0 keeps the native signal");
assert.strictEqual(mx.modSlotSignal(1, 0.2, 0.4, 0.8), 0.4, "type 1 selects the envelope");
assert.strictEqual(mx.modSlotSignal(2, 0.2, 0.4, 0.8), 0.8, "type 2 selects the MSEG sample");

const resRoute = mx.modPack({ 1: ["filt_res"], 2: [], 3: [], 4: [] }, { "1:0:4": 100 }, 100);
assert.strictEqual(resRoute[0], 1, "MSEG to filt_res packs one route");
assert.strictEqual(resRoute[1], 301, "filt_res is global index 1");
assert.strictEqual(resRoute[2], 4, "column MSEG is source 4");
assert.ok(Math.abs(resRoute[3] - 1) < 1e-9, "depth 100 at global 100% is full scale");
assert.strictEqual(resRoute[4], 0);
assert.strictEqual(resRoute[5], 0.95);
const resAtPeak = mx.modOffset(0.209, 0, 0.95, 1, 1);
assert.ok(Math.abs(resAtPeak - 0.95) < 1e-9, "a full MSEG adds the resonance span and clips");
const resAtZero = mx.modOffset(0.209, 0, 0.95, 1, 0);
assert.strictEqual(resAtZero, 0.209, "an MSEG sample of 0 leaves resonance alone");
const resEnv = mx.modOffset(0.209, 0, 0.95, 1, 0.7);
assert.ok(resEnv > 0.8, "a held envelope at sustain moves resonance");

for (const [key, t] of Object.entries(mx.MOD_TARGETS)) {
    if (t.op === "g") assert.ok(gen.includes("peek(mxG, " + t.ix + ")"), key + " is read from the global buffer");
    if (t.op === "b") assert.ok(gen.includes("peek(mxPrev, " + t.ix + ")"), key + " is read from the previous-sample buffer");
}
assert.ok(gen.includes("lfOff = peek(mxArg, 19)"), "a matrix route to lfo_filt is applied");
assert.ok(gen.includes("env3_final + peek(mxArg, 41)"), "a matrix route to env 3 final is applied");
assert.ok(gen.includes("peek(slbuf, 48 + si)"), "slot envelopes attack toward the drawn peak");
assert.ok(gen.includes("peek(msegw, si * 1024"), "each slot reads its own MSEG waveform");
assert.ok(gen.includes("poke(scope, out0, 224)") && gen.includes("poke(scope, out3, 227)"), "slot levels are on the scope");
assert.ok(gen.includes("poke(scope, resUse, 230)"), "resonance used by the filter is on the scope");
assert.ok(gen.includes("frame_pos("), "wavetable frames sum their matrix offset outside mod_apply");
assert.strictEqual((gen.match(/frame_pos\(/g) || []).length, 3, "frame_pos is defined once and called from both voice loops");
assert.ok(gen.includes("n2Frames, wt2Off"), "osc 2's frame offset is an argument of the one voice_proc call");
assert.ok(gen.includes("peek(prm, 74) + o2PosAdd"), "osc 2's frame is the knob plus that offset");
assert.ok(gen.includes("poke(scope, showWtAmp < 0 ? -1 : showWt1, 234)"), "the sounding osc 1 frame is on the scope");
assert.ok(gen.includes("poke(scope, showWtAmp < 0 ? -1 : showWt2, 235)"), "the sounding osc 2 frame is on the scope");
assert.strictEqual((gen.match(/voice_proc\(/g) || []).length, 2, "voice_proc still has one call site");
assert.ok(gen.includes("slot4Own = slotS4"), "the owning voice records slot 4's signal");
assert.strictEqual((gen.match(/mod_apply\(/g) || []).length, 3, "mod_apply is defined once and called twice");
const srcFn = gen.slice(gen.indexOf("mod_src("), gen.indexOf("mod_apply("));
assert.strictEqual((srcFn.match(/return /g) || []).length, 1, "mod_src has one return");
const applyFn = gen.slice(gen.indexOf("mod_apply("), gen.indexOf("mod_take("));
assert.strictEqual((applyFn.match(/return /g) || []).length, 1, "mod_apply has one return");
assert.ok(!gen.match(/\be\d/), "no e0..e9 identifiers");

console.log("sampler mod matrix: pack, identity, blob and gen bypass ok");
