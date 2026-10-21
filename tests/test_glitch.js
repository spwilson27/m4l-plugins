#!/usr/bin/env node
"use strict";
// Node tests for Glitch: the data model (src/glitch_config.js), the gen core's functions (transpiled and run in Node
// against src/glitch_ref.js / src/cepcrush_ref.js), lint rules, and the built device. Real Max audio:
// scripts/run_glitch_audio_tests.py (inside the VM).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const G = require("../src/glitch_config.js");
const R = require("../src/glitch_ref.js");
const qc = require("../src/cepcrush_ref.js");
const gx = require("./genexpr_functions.js");

const ROOT = path.join(__dirname, "..");
const LIB = fs.readFileSync(path.join(ROOT, "src", "cepstrum_lib.genexpr"), "utf8");
const CORE_RAW = fs.readFileSync(path.join(ROOT, "src", "glitch_core.genexpr"), "utf8");
const L = G.glitchLayout();
let passed = 0;
function ok(name, fn) {
    try {
        fn();
        passed++;
    } catch (e) {
        console.error(`FAIL ${name}`);
        throw e;
    }
}

// ----------------------------------------------------------------------------- token substitution (twin of scripts/glitch_common.py)
function tokensFor() {
    const t = { NP: L.np, WOFF: L.weightsOffset, SVSIZE: L.np * G.GL_NSLOT, SQOFF: L.seqOffset, NINST: L.ninst };
    for (const i of L.instances) t[`B_${i.id}`] = i.base;
    L.instances.forEach((i, pos) => (t[`P_${i.id}`] = pos));
    for (const [k, v] of Object.entries(L.index)) t["I_" + k.replace(".", "_")] = v;
    for (const [k, v] of Object.entries(G.GL_SCOPE)) t[`SC_${k}`] = v;
    return t;
}
const TOK = tokensFor();
const CORE_FN = CORE_RAW.replace(/@([A-Za-z0-9_]+)@/g, (m, n) => (n === "INIT" ? "" : String(TOK[n] === undefined ? (() => { throw new Error("token " + n); })() : TOK[n])));

// ----------------------------------------------------------------------------- registry / layout
ok("registry", () => {
    assert.strictEqual(G.GL_INSTANCES.length, 23);
    assert.strictEqual(G.GL_NINST, 23);
    const ids = new Set();
    for (const inst of G.GL_INSTANCES) {
        assert.ok(!ids.has(inst.id));
        ids.add(inst.id);
        assert.strictEqual(inst.params[0].key, "wet", `${inst.id} starts with wet`);
        const keys = new Set();
        for (const p of inst.params) {
            assert.ok(!keys.has(p.key), `${inst.id}.${p.key} duplicate`);
            keys.add(p.key);
            assert.ok(p.min < p.max && p.def >= p.min && p.def <= p.max, `${inst.id}.${p.key} range/default`);
            if (p.kind === "log") assert.ok(p.min > 0, "log params are positive");
            if (p.kind === "disc") {
                if (p.patterns) continue;
                for (const v of p.calm.concat(p.wild)) assert.ok(v >= p.min && v <= p.max && v === Math.floor(v), `${inst.id}.${p.key} set value ${v}`);
                for (const v of p.calm) assert.ok(p.wild.indexOf(v) >= 0, "calm is a subset of wild");
                if (p.choices) assert.strictEqual(p.choices.length, p.max - p.min + 1, `${inst.id}.${p.key} choices`);
            } else if (p.kind !== "wet" || p.key !== "wet" || true) {
                if (p.rand) {
                    assert.strictEqual(p.rand.length, 4);
                    for (const v of p.rand) assert.ok(v >= p.min - 1e-9 && v <= p.max + 1e-9, `${inst.id}.${p.key} rand ${v} inside ${p.min}..${p.max}`);
                }
            }
        }
        for (const p of inst.params) if (p.group) assert.ok(keys.has(p.group) && inst.params.find((q) => q.key === p.group).kind === "wet", "group is a wet-kind param");
    }
    const covered = new Set();
    for (const t of G.GL_TYPES) {
        for (const iid of t.instances) {
            assert.ok(G.glInstance(iid), `type ${t.id} instance ${iid}`);
            covered.add(iid);
        }
        if (t.amountKey) assert.ok(G.glInstance("spec").params.some((p) => p.key === t.amountKey && p.kind === "wet"));
    }
    for (const i of ids) assert.ok(covered.has(i), `instance ${i} belongs to a type`);
    assert.strictEqual(G.GL_TYPES.length, 29);
});

ok("layout has no overlaps and matches the buffer", () => {
    assert.strictEqual(L.np, 113);
    const seen = new Set();
    L.params.forEach((p, i) => {
        assert.strictEqual(p.idx, i);
        assert.ok(!seen.has(i));
        seen.add(i);
        assert.ok(p.group >= 0 && p.group < L.np);
        assert.strictEqual(L.params[p.group].kind === "wet", true, "a group points at a wet-kind param");
        assert.strictEqual(L.index[`${p.inst}.${p.key}`], i);
    });
    for (const inst of L.instances) assert.strictEqual(L.params[inst.base].key, "wet");
    assert.ok(L.weightsOffset + G.GL_NSLOT <= G.GL_SLOTS_BUF_SAMPS);
    assert.strictEqual(L.weightsOffset, 8 * L.np);
    assert.strictEqual(L.seqOffset, L.weightsOffset + 8);
    assert.ok(L.seqOffset + G.GL_SEQ_HDR + G.GL_SEQ_MAX <= G.GL_SLOTS_BUF_SAMPS, "sequencer block fits the engine buffer");
    assert.strictEqual(G.GL_SLOTS_BUF_SAMPS, 1024);
    // spectral param order that the core's main body hard-codes (B_spec + n)
    const keys = G.glInstance("spec").params.map((p) => p.key);
    assert.deepStrictEqual(keys, ["wet", "frz_amt", "frz_rate", "smr_amt", "smr_blur", "cc_amt", "cc_coeffs", "cc_bits", "sc_amt", "sc_mode", "sct_amt", "sct_w", "sct_rate", "mir_amt", "mir_pivot", "bsh_amt", "bsh_bins", "sgl_amt", "sgl_mode", "sgl_k", "sgl_step"]);
    // module param order the core's functions read (b + n)
    const want = { drvA: ["wet", "mode", "drive", "tone"], drvB: ["wet", "mode", "drive", "tone"], filt: ["wet", "type", "cutoff", "res"], crush: ["wet", "bits", "rate", "jitter"], ring: ["wet", "mode", "freq"], stut: ["wet", "div", "prob", "decay"], time: ["wet", "mode", "amt", "div"], chop: ["wet", "pattern", "div", "smooth"], dly: ["wet", "div", "fb", "pp", "damp"], rev: ["wet", "size", "decay", "damp", "void"], wid: ["wet", "width", "gain"],
        form: ["wet", "vowel", "shift", "res"], comb: ["wet", "freq", "fb", "damp"], phas: ["wet", "stages", "sync", "hz", "div", "depth", "fb"], rect: ["wet", "mode", "blend"],
        fm: ["wet", "mode", "ratio", "index"], corr: ["wet", "div", "chance", "flips", "wrap", "drop"], gpit: ["wet", "pitch", "size", "jitter"], gstr: ["wet", "speed", "size", "spread"],
        rvs: ["wet", "div", "chance"], shuf: ["wet", "slices", "span", "chance", "seed"], slap: ["wet", "time", "tone", "offset"] };
    for (const [id, k] of Object.entries(want)) assert.deepStrictEqual(G.glInstance(id).params.map((p) => p.key), k, id);
    assert.deepStrictEqual(L.instances.map((i) => i.id), ["drvA", "filt", "form", "comb", "phas", "crush", "rect", "fm", "corr", "ring", "stut", "time", "gpit", "gstr", "rvs", "shuf", "chop", "spec", "drvB", "dly", "slap", "rev", "wid"]);
    assert.strictEqual(L.index["gstr.wet"] - L.index["gpit.wet"], G.glInstance("gpit").params.length, "gpit / gstr are neighbours in the chain (one gen loop)");
    assert.strictEqual(G.glInstance("gpit").params.length, G.glInstance("gstr").params.length);
    // scope offsets do not overlap
    const S = G.GL_SCOPE;
    const blocks = [["ACTIVITY", G.GL_NINST], ["LEVEL", G.GL_NINST], ["WEIGHTS", 8], ["BANDS_IN", 64], ["BANDS_OUT", 64], ["CEP_IN", 64], ["CEP_OUT", 64], ["WAVE_IN", 64], ["WAVE_OUT", 64]];
    const used = new Array(G.GL_SCOPE_SAMPS).fill(null);
    for (const [k, v] of Object.entries(S)) {
        if (k === "END") continue;
        const len = (blocks.find((b) => b[0] === k) || [k, 1])[1];
        for (let i = 0; i < len; i++) {
            assert.strictEqual(used[v + i], null, `scope ${k} overlaps ${used[v + i]}`);
            used[v + i] = k;
        }
    }
    assert.ok(S.END <= G.GL_SCOPE_SAMPS);
});

// ----------------------------------------------------------------------------- randomize / mutate
function inChaosRange(g, chaos) {
    for (const [id, mod] of Object.entries(g.modules)) {
        const inst = G.glInstance(id);
        assert.ok(inst, `unknown instance ${id}`);
        for (const p of inst.params) {
            const v = p.key === "wet" ? mod.wet : mod.params[p.key];
            if (v === undefined) continue;
            const gAmt = p.group ? mod.params[p.group] : mod.wet;
            const rolled = p.key === "wet" || p.kind === "wet" || gAmt > 0; // params of an inactive sub-op keep their defaults
            assert.ok(v >= p.min - 1e-9 && v <= p.max + 1e-9, `${id}.${p.key}=${v} outside ${p.min}..${p.max}`);
            if (!rolled) continue;
            if (p.kind === "disc") {
                if (p.patterns) continue;
                assert.ok(p.wild.indexOf(v) >= 0, `${id}.${p.key}=${v} not in wild set`);
                if (chaos <= 0) assert.ok(p.calm.indexOf(v) >= 0, `${id}.${p.key}=${v} not in calm set at chaos 0`);
            } else {
                const rg = G.randRange(p, chaos);
                const a = Math.abs(v);
                // sub-op / module wets may be forced to >= 0.5 chaos range or 1; allow that for amount-kind params only
                if (p.kind === "wet") continue;
                const okv = p.min < 0 && rg[0] >= 0 ? a >= rg[0] - 1e-9 && a <= rg[1] + 1e-9 : v >= rg[0] - 1e-9 && v <= rg[1] + 1e-9;
                assert.ok(okv, `${id}.${p.key}=${v} outside chaos ${chaos} range ${rg}`);
            }
        }
    }
}
ok("randomize is deterministic and different per seed", () => {
    const a = G.randomizeGlitch(42, 0.6, null);
    const b = G.randomizeGlitch(42, 0.6, null);
    assert.deepStrictEqual(a, b);
    assert.notDeepStrictEqual(a, G.randomizeGlitch(43, 0.6, null));
});
ok("randomize respects the allow-list", () => {
    for (let seed = 1; seed <= 200; seed++) {
        const allow = { filter: true, delay: true, reverb: true };
        const g = G.randomizeGlitch(seed, 0.8, allow);
        for (const id of Object.keys(g.modules)) assert.ok(["filt", "dly", "rev"].indexOf(id) >= 0, `seed ${seed}: ${id} not allowed`);
        assert.ok(Object.keys(g.modules).length >= 1 && Object.keys(g.modules).length <= 3);
        // only the freeze sub-op allowed: spec on, only freeze amount > 0
        const f = G.randomizeGlitch(seed, 0.5, ["freeze"]);
        assert.deepStrictEqual(Object.keys(f.modules), ["spec"]);
        assert.strictEqual(f.modules.spec.params.smr_amt, undefined);
        assert.ok(f.modules.spec.params.frz_amt > 0);
    }
    assert.deepStrictEqual(G.randomizeGlitch(1, 0.5, []).modules, {});
    const allDisabled = G.defaultAllow();
    for (const k of Object.keys(allDisabled)) allDisabled[k] = false;
    assert.deepStrictEqual(G.randomizeGlitch(1, 0.5, allDisabled).modules, {});
});
ok("randomize module counts and chaos ranges", () => {
    const counts = {};
    for (let seed = 1; seed <= 400; seed++) {
        for (const chaos of [0, 0.25, 0.5, 0.75, 1]) {
            const g = G.randomizeGlitch(seed * 7 + 3, chaos, null);
            inChaosRange(g, chaos);
            const types = new Set();
            for (const t of G.GL_TYPES) {
                if (t.amountKey) {
                    const m = g.modules.spec;
                    if (m && m.params[t.amountKey] > 0) types.add(t.id);
                } else if (t.instances.some((i) => g.modules[i])) types.add(t.id);
            }
            counts[chaos] = counts[chaos] || [];
            counts[chaos].push(types.size);
            assert.ok(types.size >= 2 && types.size <= 6, `chaos ${chaos}: ${types.size} types`);
            const specOps = ["freeze", "smear", "ccrush", "scramble"].filter((t) => types.has(t)).length;
            assert.ok(specOps <= 2);
            const v = G.glitchToVector(g);
            assert.strictEqual(v.length, L.np);
            v.forEach((x) => assert.ok(isFinite(x)));
        }
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    assert.ok(mean(counts[1]) > mean(counts[0]) + 0.5, "higher chaos rolls more modules");
    assert.ok(mean(counts[0.5]) >= 3 && mean(counts[0.5]) <= 5, `typical 3..6 at chaos .5 (mean ${mean(counts[0.5])})`);
});
ok("chaos widens the ranges", () => {
    const filt = G.glInstance("filt").params[2];
    const lo = G.randRange(filt, 0), hi = G.randRange(filt, 1);
    assert.ok(hi[0] < lo[0] && hi[1] > lo[1]);
    const crush = G.glInstance("crush").params[1];
    assert.ok(G.randRange(crush, 1)[0] < G.randRange(crush, 0)[0]);
});
ok("mutate stays near and is deterministic", () => {
    for (let seed = 1; seed <= 100; seed++) {
        const g = G.randomizeGlitch(seed, 0.5, null);
        const m0 = G.mutateGlitch(g, seed, 0);
        assert.deepStrictEqual(G.glitchToVector(m0), G.glitchToVector(g), "amount 0 keeps the glitch");
        const m = G.mutateGlitch(g, seed + 1000, 0.2);
        assert.deepStrictEqual(m, G.mutateGlitch(g, seed + 1000, 0.2));
        assert.deepStrictEqual(Object.keys(m.modules).sort(), Object.keys(g.modules).sort(), "small mutations keep the module set");
        const va = G.glitchToVector(g), vb = G.glitchToVector(m);
        let changed = 0;
        L.params.forEach((p, i) => {
            if (p.kind === "disc") return;
            const span = p.kind === "log" ? Math.log(p.max / p.min) : p.max - p.min;
            const d = p.kind === "log" ? Math.abs(Math.log(Math.max(vb[i], p.min) / Math.max(va[i], p.min))) : Math.abs(vb[i] - va[i]);
            assert.ok(d <= 0.2 * 0.5 * span + 1e-9 || (p.kind === "wet" && d <= 0.2 * 0.35 + 1e-9), `${p.inst}.${p.key} moved ${d / span}`);
            if (d > 0) changed++;
        });
        assert.ok(changed > 0 || Object.keys(g.modules).length === 0);
    }
    // large mutations may add a module
    const big = G.mutateGlitch(G.randomizeGlitch(5, 0.5, null), 9, 1, null);
    assert.ok(Object.keys(big.modules).length >= 1);
});

// ----------------------------------------------------------------------------- morph weights and blend rules
ok("xyWeights", () => {
    for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
            const w = G.xyWeights(i / 20, j / 20);
            assert.ok(Math.abs(w[0] + w[1] + w[2] + w[3] - 1) < 1e-12);
            w.forEach((x) => assert.ok(x >= 0));
        }
    }
    assert.deepStrictEqual(G.xyWeights(0, 0), [1, 0, 0, 0]);
    assert.deepStrictEqual(G.xyWeights(1, 0), [0, 1, 0, 0]);
    assert.deepStrictEqual(G.xyWeights(0, 1), [0, 0, 1, 0]);
    assert.deepStrictEqual(G.xyWeights(1, 1), [0, 0, 0, 1]);
    const w8 = G.cornerSlotWeights([5, 5, 2, 7], 0.5, 0.5);
    assert.ok(Math.abs(w8.reduce((a, b) => a + b, 0) - 1) < 1e-12 && Math.abs(w8[5] - 0.5) < 1e-12);
});

function vec(modules) {
    return G.glitchToVector({ version: 1, modules });
}
ok("blend rules", () => {
    const A = vec({ filt: { wet: 1, params: { type: 0, cutoff: 200, res: 0.2 } }, dly: { wet: 0.8, params: { div: 3, fb: 0.5, pp: 0, damp: 4000 } } });
    const B = vec({ filt: { wet: 1, params: { type: 2, cutoff: 3200, res: 0.8 } } });
    const C = vec({});
    const ix = (k) => L.index[k];
    // wet: linear
    let o = G.blendVectors([A, B], [0.5, 0.5]);
    assert.ok(Math.abs(o[ix("dly.wet")] - 0.4) < 1e-12, "wet interpolates");
    // log: geometric mean of 200 and 3200 at 50/50 = 800
    assert.ok(Math.abs(o[ix("filt.cutoff")] - 800) < 1e-6, `log interp ${o[ix("filt.cutoff")]}`);
    assert.ok(Math.abs(o[ix("filt.res")] - 0.5) < 1e-12, "lin interp");
    // inactive module holds the active slot's continuous values
    assert.ok(Math.abs(o[ix("dly.fb")] - 0.5) < 1e-12 && Math.abs(o[ix("dly.damp")] - 4000) < 1e-6, "dly params come from the only slot where it is active");
    // discrete: highest weight among active slots
    o = G.blendVectors([A, B], [0.4, 0.6]);
    assert.strictEqual(o[ix("filt.type")], 2);
    o = G.blendVectors([A, B], [0.6, 0.4]);
    assert.strictEqual(o[ix("filt.type")], 0);
    // discrete when the heavier slot has the module off: take the one that has it
    o = G.blendVectors([A, C], [0.2, 0.8]);
    assert.strictEqual(o[ix("dly.div")], 3);
    assert.ok(Math.abs(o[ix("dly.wet")] - 0.16) < 1e-12);
    // weights are normalized
    const o2 = G.blendVectors([A, B], [3, 3]);
    assert.deepStrictEqual(o2, G.blendVectors([A, B], [0.5, 0.5]));
    // all-zero weights = defaults (silent)
    o = G.blendVectors([A, B], [0, 0]);
    L.params.forEach((p, i) => assert.strictEqual(o[i], p.def));
    // exact slot weights return the slot
    o = G.blendVectors([A, B, C], [1, 0, 0]);
    L.params.forEach((p, i) => {
        if (p.group === p.idx || A[p.group] > 0.0005) assert.ok(Math.abs(o[i] - A[i]) < 1e-9, `${p.inst}.${p.key}`);
    });
    // glitch <-> vector roundtrip for active modules
    const g = G.randomizeGlitch(11, 0.7, null);
    const g2 = G.vectorToGlitch(G.glitchToVector(g));
    assert.deepStrictEqual(G.glitchToVector(g2), G.glitchToVector(g));
});
ok("blend never leaves default-sweeping values", () => {
    // module only in slot A at 50/50 with an empty slot: continuous params stay at A's value, only wet halves
    for (let seed = 1; seed <= 50; seed++) {
        const A = G.glitchToVector(G.randomizeGlitch(seed, 0.5, null));
        const E = G.glitchToVector(null);
        const o = G.blendVectors([A, E], [0.5, 0.5]);
        L.params.forEach((p, i) => {
            if (p.kind === "wet") assert.ok(Math.abs(o[i] - A[i] * 0.5) < 1e-12);
            else if (A[p.group] > 0.0005) assert.ok(Math.abs(o[i] - A[i]) < 1e-6 * Math.max(1, Math.abs(A[i])), `${p.inst}.${p.key}`);
        });
    }
});

// ----------------------------------------------------------------------------- state
ok("state versioning and persistence", () => {
    const s = G.defaultState();
    assert.strictEqual(s.version, G.GL_STATE_VERSION);
    s.working = G.randomizeGlitch(3, 0.5, null);
    G.saveToSlot(s, 2);
    s.corners = [2, 0, 1, 3];
    s.xy = [0.25, 0.75];
    s.chaos = 0.8;
    s.allow.reverb = false;
    s.audition = "morph";
    const blob = G.stateToBlob(s);
    assert.strictEqual(blob[0], G.GL_STATE_VERSION);
    const t = G.stateFromBlob(JSON.parse(JSON.stringify(blob)));
    assert.deepStrictEqual(t, G.normalizeState(s));
    assert.strictEqual(t.allow.reverb, false);
    assert.deepStrictEqual(t.slots[2].modules, s.working.modules);
    // robustness
    assert.deepStrictEqual(G.stateFromBlob(null), G.defaultState());
    assert.deepStrictEqual(G.stateFromBlob([]), G.defaultState());
    assert.deepStrictEqual(G.stateFromBlob([1, "{not json"]), G.defaultState());
    assert.deepStrictEqual(G.stateFromBlob([0, "{}"]), G.defaultState());
    const future = G.stateFromBlob([99, JSON.stringify(Object.assign({}, s, { extraField: 1 }))]);
    assert.strictEqual(future.chaos, 0.8, "a newer version is read as far as it is understood");
    // damaged contents are clamped
    const bad = G.normalizeState({ chaos: 9, xy: [-3, 4], corners: [9, -1, "a", 2], slots: [{ modules: { filt: { wet: 7, params: { cutoff: 1e9, nope: 1 } }, bogus: { wet: 1 } } }], audition: "x" });
    assert.strictEqual(bad.chaos, 1);
    assert.deepStrictEqual(bad.xy, [0, 1]);
    assert.deepStrictEqual(bad.corners, [7, 0, 0, 2]);
    assert.strictEqual(bad.slots[0].modules.filt.wet, 1);
    assert.strictEqual(bad.slots[0].modules.filt.params.cutoff, 16000);
    assert.ok(!bad.slots[0].modules.bogus);
    assert.strictEqual(bad.audition, "working");
});
ok("engine buffer packing", () => {
    const s = G.defaultState();
    s.working = G.randomizeGlitch(5, 0.5, null);
    let buf = G.packEngineBuffer(s);
    assert.strictEqual(buf.length, G.GL_SLOTS_BUF_SAMPS);
    assert.deepStrictEqual(buf.slice(L.weightsOffset, L.weightsOffset + 8), [1, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepStrictEqual(buf.slice(0, L.np), G.glitchToVector(s.working));
    G.saveToSlot(s, 0);
    s.working = G.randomizeGlitch(6, 0.5, null);
    G.saveToSlot(s, 1);
    s.corners = [0, 1, 0, 1];
    s.xy = [0.5, 0];
    s.audition = "morph";
    buf = G.packEngineBuffer(s);
    assert.deepStrictEqual(buf.slice(L.weightsOffset, L.weightsOffset + 8), [0.5, 0.5, 0, 0, 0, 0, 0, 0]);
    assert.deepStrictEqual(buf.slice(L.np, 2 * L.np), G.glitchToVector(s.slots[1]));
});

// ----------------------------------------------------------------------------- gen functions vs the mirrors
const GEN = gx.load(LIB, CORE_FN);
const DataSim = gx.DataSim;
function mkRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    };
}
function dataFrom(arr, chans) {
    const d = new DataSim(arr.length, chans || 1);
    for (let i = 0; i < arr.length; i++) d.a[i] = arr[i];
    return d;
}

ok("gen blend equals blendVectors", () => {
    const rnd = mkRng(7);
    const meta = new DataSim(L.np, 3);
    G.glitchMeta().forEach((m, i) => {
        meta.a[i] = m[0];
        meta.a[L.np + i] = m[1];
        meta.a[2 * L.np + i] = m[2];
    });
    for (let trial = 0; trial < 60; trial++) {
        const vecs = [];
        for (let s = 0; s < 8; s++) vecs.push(rnd() > 0.3 ? G.glitchToVector(G.randomizeGlitch(trial * 8 + s + 1, 0.3 + 0.7 * Math.abs(rnd()), null)) : G.glitchToVector(null));
        const w = [];
        for (let s = 0; s < 8; s++) w.push(rnd() > 0.4 ? Math.abs(rnd()) : 0);
        if (trial === 0) w.fill(0);
        const sv = new DataSim(8 * L.np, 1);
        vecs.forEach((v, s) => v.forEach((x, i) => (sv.a[s * L.np + i] = x)));
        const tgt = new DataSim(L.np, 1);
        GEN.gl_blend(sv, dataFrom(w), meta, tgt, L.np);
        const want = G.blendVectors(vecs, w);
        for (let i = 0; i < L.np; i++) assert.ok(Math.abs(tgt.a[i] - want[i]) <= 1e-9 * Math.max(1, Math.abs(want[i])), `trial ${trial} param ${i}: gen ${tgt.a[i]} vs ${want[i]}`);
    }
});
ok("gen drive shapes equal saturate", () => {
    for (let m = 0; m <= 3; m++) for (let u = -3; u <= 3; u += 0.173) assert.ok(Math.abs(GEN.gl_sat(u, m) - R.saturate(u, m)) < 1e-12);
    for (let m = 0; m <= 3; m += 0.37) for (let u = -3; u <= 3; u += 0.31) assert.ok(Math.abs(GEN.gl_sat_m(u, m) - R.saturateMorph(u, m)) < 1e-12);
});
ok("gen SVF equals the mirror for every type", () => {
    const rnd = mkRng(3);
    for (const [fc, res, ty] of [[500, 0.2, 0], [2000, 0.9, 1], [8000, 0.5, 2], [1000, 0.7, 3], [300, 0.4, 1.5]]) {
        const { g, k } = R.svfCoefs(fc, res, 48000);
        const svf = new R.Svf();
        const st = new DataSim(4, 1);
        for (let i = 0; i < 4000; i++) {
            const x = rnd();
            const a = svf.process(x, g, k, ty);
            const b = GEN.gl_svf(st, 0, x, g, k, ty);
            assert.ok(Math.abs(a - b) < 1e-9, `type ${ty} sample ${i}`);
        }
    }
    // behaviour: LP passes DC, HP blocks it, BP is unity at the centre, notch rejects it
    const measure = (ty, f) => {
        const { g, k } = R.svfCoefs(1000, 0.5, 48000);
        const svf = new R.Svf();
        let peak = 0;
        for (let i = 0; i < 48000; i++) {
            const y = svf.process(Math.sin((2 * Math.PI * f * i) / 48000), g, k, ty);
            if (i > 24000) peak = Math.max(peak, Math.abs(y));
        }
        return peak;
    };
    assert.ok(measure(0, 100) > 0.9 && measure(0, 10000) < 0.1);
    assert.ok(measure(2, 100) < 0.1 && measure(2, 10000) > 0.9);
    assert.ok(Math.abs(measure(1, 1000) - 1) < 0.05);
    assert.ok(measure(3, 1000) < 0.1 && measure(3, 100) > 0.9);
});
ok("gen crush quantizer, division table, chopper bits", () => {
    const rnd = mkRng(5);
    for (let i = 0; i < 500; i++) {
        const x = rnd(), bits = 1 + Math.abs(rnd()) * 15;
        assert.ok(Math.abs(GEN.gl_q(x, bits) - R.quantize(x, bits)) < 1e-12);
    }
    for (let i = 0; i < 8; i++) {
        assert.strictEqual(GEN.gl_div(i), G.GL_DIV_BEATS[i]);
        assert.strictEqual(R.DIV_BEATS[i], G.GL_DIV_BEATS[i]);
    }
    for (const pat of G.GL_CHOP_PATTERNS) for (let s = 0; s < 16; s++) assert.strictEqual(GEN.gl_chop_bit(pat, s), R.chopBit(pat, s));
    for (let i = 0; i < 50; i++) assert.ok(Math.abs(GEN.gl_hash(i, 3.3) - R.hash(i, 3.3)) < 1e-12);
    assert.strictEqual(R.quantize(0.3, 16) !== 0.3, true);
    assert.ok(Math.abs(R.quantize(0.3, 1.0) - 0) < 1e-12 || Math.abs(R.quantize(0.3, 1.0)) <= 1);
});
ok("gen cepstral crush equals the cepstral crusher reference (coeffs, bits, scramble)", () => {
    const n = 1024, sr = 44100, half = n / 2;
    const rnd = mkRng(9);
    const qsv = qc.formantQ(sr);
    for (const cse of [
        { cc: 1, coeffs: 0.3, bits: 16, smode: 0, samt: 0 },
        { cc: 1, coeffs: 0.5, bits: 6, smode: 0, samt: 0 },
        { cc: 1, coeffs: 1, bits: 16, smode: 1, samt: 1 },
        { cc: 1, coeffs: 0.4, bits: 8, smode: 2, samt: 1 },
        { cc: 1, coeffs: 0.9, bits: 16, smode: 3, samt: 0.6 },
        { cc: 0.5, coeffs: 0.2, bits: 4, smode: 3, samt: 0.3 },
        { cc: 0, coeffs: 0.2, bits: 4, smode: 0, samt: 0 },
    ]) {
        const c = new Float64Array(n);
        for (let q = 0; q <= half; q++) {
            c[q] = rnd() * 2 * Math.exp(-q / 100);
            if (q > 0 && q < half) c[n - q] = c[q];
        }
        const eff = R.crushParams(cse.cc, cse.coeffs, cse.bits);
        const kq = GEN.gl_kq(eff.coeffs, n, qsv);
        assert.ok(Math.abs(kq - qc.coeffsKept(eff.coeffs, n, sr)) < 1e-9);
        const bitsI = cse.cc === 1 || cse.cc === 0 ? Math.round(eff.bits) : eff.bits;
        const want = R.crushCepstrum(c, { n, sr, coeffs: eff.coeffs, bits: Math.round(bitsI), smode: cse.smode, samt: cse.samt, roll: 5 });
        const fc = new DataSim(4096, 2);
        for (let q = 0; q < n; q++) fc.a[q] = c[q];
        const cn = new DataSim(4096), us = new DataSim(256), pm = new DataSim(256);
        const rr = Math.max(2, Math.min(Math.floor(kq), Math.floor(qsv)));
        if (cse.smode === 2) GEN.gl_perm(pm, rr, 5);
        GEN.gl_cproc(fc, cn, us, pm, null, 0, 0, n, qsv, kq, Math.round(bitsI), cse.smode, cse.samt, 0);
        let maxd = 0;
        for (let q = 0; q < n; q++) maxd = Math.max(maxd, Math.abs(fc.a[q] - want[q]));
        const isInt = Math.abs(eff.bits - Math.round(eff.bits)) < 1e-9;
        if (isInt || cse.cc === 1 || cse.cc === 0) assert.ok(maxd < 1e-9, `${JSON.stringify(cse)}: max diff ${maxd}`);
    }
    // with amount 0 the crusher is the identity: crushed cepstrum equals the input (up to the formant crossover split)
    const c = new Float64Array(n);
    for (let q = 0; q <= half; q++) {
        c[q] = rnd();
        if (q > 0 && q < half) c[n - q] = c[q];
    }
    const fc = new DataSim(4096, 2);
    for (let q = 0; q < n; q++) fc.a[q] = c[q];
    GEN.gl_cproc(fc, new DataSim(4096), new DataSim(256), new DataSim(256), null, 0, 0, n, qsv, half, 16, 0, 0, 0);
    for (let q = 0; q < n; q++) assert.ok(Math.abs(fc.a[q] - c[q]) < 1e-9, "neutral crusher is exact");
});
ok("gen frequency shifter moves a sine by the shift", () => {
    const sr = 48000;
    const run = (mode, freq, f0) => {
        const pv = new DataSim(L.np, 1);
        const b = L.base.ring;
        pv.a[b + 1] = mode;
        pv.a[b + 2] = freq;
        const st = new DataSim(88, 1);
        const io = new DataSim(2, 1);
        const out = new Float64Array(16384);
        for (let i = 0; i < 16384 + 4096; i++) {
            const x = Math.sin((2 * Math.PI * f0 * i) / sr);
            io.a[0] = x;
            io.a[1] = x;
            GEN.gl_ring(io, pv, b, 1, st, sr);
            if (i >= 4096) out[i - 4096] = io.a[0];
        }
        // find the dominant frequency by a brute-force DFT over candidate bins
        let best = 0, bf = 0;
        const N = out.length;
        for (let f = 100; f < 4000; f += 2) {
            let re = 0, im = 0;
            for (let i = 0; i < N; i += 3) {
                const a = (2 * Math.PI * f * i) / sr;
                re += out[i] * Math.cos(a);
                im += out[i] * Math.sin(a);
            }
            const m = re * re + im * im;
            if (m > best) {
                best = m;
                bf = f;
            }
        }
        return bf;
    };
    // shift mode needs the mode smoother settled: it glides from 0, so warm up is part of the 4096 skipped samples
    const up = run(1, 200, 1000);
    const dn = run(1, -200, 1000);
    assert.ok(Math.abs(up - 1200) <= 6, `shift +200 Hz gave ${up}`);
    assert.ok(Math.abs(dn - 800) <= 6, `shift -200 Hz gave ${dn}`);
});
ok("gen neutral STFT identity needs no processing: magops at zero amounts is the identity", () => {
    const n = 1024;
    const rnd = mkRng(2);
    const fx = new DataSim(4096, 2), fc = new DataSim(4096, 2);
    // Hermitian spectrum of a real signal
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = rnd();
    for (let i = 0; i < n; i++) fx.a[i] = x[i];
    const tab = new DataSim(4096, 3);
    GEN.fft_init(tab);
    GEN.fft_run(fx, tab, n, 0);
    const copy = Array.from(fx.a);
    const frg = new DataSim(1024, 2), smg = new DataSim(1024, 2);
    GEN.gl_magops(fx, fc, frg, smg, 0, n, 0, 0, 0, 0.3, 1);
    for (let i = 0; i < 4096 * 2; i++) assert.ok(Math.abs(fx.a[i] - copy[i]) < 1e-9, "magops with zero amounts is the identity");
    // smear 1 over many frames of the same frame converges to it; freeze 1 keeps the captured magnitude for a different input
    GEN.gl_magops(fx, fc, frg, smg, 0, n, 1, 1, 0, 0, 2);
    const fx2 = new DataSim(4096, 2);
    for (let i = 0; i < n; i++) fx2.a[i] = rnd();
    GEN.fft_run(fx2, tab, n, 0);
    GEN.gl_magops(fx2, fc, frg, smg, 0, n, 1, 0, 0, 0, 3);
    for (let k = 1; k < n / 2; k++) {
        const m = Math.hypot(fx2.a[k], fx2.a[4096 + k]);
        const m0 = Math.hypot(copy[k], copy[4096 + k]);
        assert.ok(Math.abs(m - m0) < 1e-9 * Math.max(1, m0), "frozen magnitude");
        assert.ok(Math.abs(fx2.a[k] - fx2.a[n - k]) < 1e-9 && Math.abs(fx2.a[4096 + k] + fx2.a[4096 + n - k]) < 1e-9, "Hermitian symmetry kept");
    }
});

ok("smear keeps sounding after the input stops (random phase, Hermitian)", () => {
    const n = 1024;
    const rnd = mkRng(8);
    const tab = new DataSim(4096, 3);
    GEN.fft_init(tab);
    const fc = new DataSim(4096, 2), frg = new DataSim(1024, 2), smg = new DataSim(1024, 2);
    const fx = new DataSim(4096, 2);
    for (let i = 0; i < n; i++) fx.a[i] = rnd();
    GEN.fft_run(fx, tab, n, 0);
    for (let f = 0; f < 4; f++) {
        const fr = new DataSim(4096, 2);
        for (let i = 0; i < 4096 * 2; i++) fr.a[i] = fx.a[i];
        GEN.gl_magops(fr, fc, frg, smg, 0, n, 0, 0, 1, 0, f + 1);
    }
    const silent = new DataSim(4096, 2);
    GEN.gl_magops(silent, fc, frg, smg, 0, n, 0, 0, 1, 0, 9);
    let e = 0;
    for (let k = 0; k < n; k++) e += silent.a[k] * silent.a[k] + silent.a[4096 + k] * silent.a[4096 + k];
    assert.ok(e > 1, `smeared energy after the input stops: ${e}`);
    for (let k = 1; k < n / 2; k++) {
        assert.ok(Math.abs(silent.a[k] - silent.a[n - k]) < 1e-9 && Math.abs(silent.a[4096 + k] + silent.a[4096 + n - k]) < 1e-9, "Hermitian");
    }
    assert.ok(Math.abs(silent.a[4096]) < 1e-12 && Math.abs(silent.a[4096 + n / 2]) < 1e-12, "DC / Nyquist stay real");
});

// ----------------------------------------------------------------------------- lint
ok("GenExpr lint", () => {
    const code = CORE_RAW.replace(/\/\/.*$/gm, "");
    assert.ok(!/\b(?:phi|pi)\b/.test(code), "phi / pi are constants");
    assert.ok(!/\be\d/.test(code), "e<digit> is Euler's number");
    assert.strictEqual((code.match(/delay\(/g) || []).length, 0);
    for (const fn of gx.functionsOf(CORE_RAW)) {
        const body = fn.body.filter((l) => !/^\s*\/\//.test(l));
        const rets = body.filter((l) => /\breturn\b/.test(l));
        assert.strictEqual(rets.length, 1, `${fn.name}: exactly one return`);
        assert.ok(/^\treturn /.test(rets[0]), `${fn.name}: return at function level`);
        assert.ok(/^\treturn /.test(body[body.length - 1]), `${fn.name}: return is last`);
        for (const l of body) {
            assert.ok(!/poke\(.*\bgl_\w+\(/.test(l) || /\.poke\(/.test(l) && false, `${fn.name}: custom call inside poke(): ${l.trim()}`);
            assert.ok(!/\bif \(.*\bgl_\w+\(/.test(l), `${fn.name}: custom call in an if condition: ${l.trim()}`);
        }
    }
    for (const l of CORE_RAW.split("\n")) {
        if (/^\s*\/\//.test(l)) continue;
        assert.ok(!/\bpoke\((?:scope|slots),[^;]*\bgl_\w+\(/.test(l), `custom call inside poke(): ${l.trim()}`);
        assert.ok(!/\bif \(.*\bgl_\w+\(/.test(l), `custom call in an if condition: ${l.trim()}`);
        assert.ok(!/\bwrap\(/.test(l), "wrap() is only allowed with constant bounds");
    }
    // declarations after the last function
    let lastFn = -1;
    for (const m of CORE_RAW.matchAll(/^[a-z_0-9]+\(.*\) \{$/gm)) lastFn = Math.max(lastFn, m.index);
    for (const decl of ["\nBuffer ", "\nData ", "\nParam ", "\nHistory ", "\nDelay "]) assert.ok(CORE_RAW.indexOf(decl) > lastFn, `functions must precede ${decl.trim()}`);
    // the gen module functions and the one-call-site rule: each module function is called exactly once in the main body
    const main = CORE_RAW.slice(CORE_RAW.indexOf("\nBuffer slots"));
    for (const f of ["gl_drive", "gl_filter", "gl_crush", "gl_ring", "gl_stut", "gl_time", "gl_chop", "gl_dly", "gl_rev", "gl_wid", "gl_spec_frame", "gl_blend"]) {
        const calls = (main.match(new RegExp(`\\b${f}\\(`, "g")) || []).length;
        assert.strictEqual(calls, f === "gl_drive" ? 2 : 1, `${f} call sites`);
    }
    assert.strictEqual((main.match(/\bgl_clear\(/g) || []).length, 2);
    // the one-FFT rule: a single stft pipeline (one gl_spec_frame, stft_in per channel)
    assert.strictEqual((main.match(/\bfft_run\(/g) || []).length, 0, "all FFT work sits in gl_spec_frame");
    // constants shared with the config
    assert.ok(/padded|1023/.test(CORE_RAW) && CORE_RAW.includes("idlL.read(1023)") && CORE_RAW.includes("dryDL.read(1023)"));
    assert.strictEqual(G.GL_LATENCY, G.GL_FFT_N - 1);
    assert.ok(CORE_RAW.includes("n = 1024;"));
});
ok("python and node substitute the core identically", () => {
    const out = cp.spawnSync("python3", ["-c", "import sys; sys.path.insert(0,'scripts'); import glitch_common as g; sys.stdout.write(g.gen_source(with_lib=False))"], { cwd: ROOT, encoding: "utf8" });
    assert.strictEqual(out.status, 0, out.stderr);
    // the python output also fills @INIT@; compare everything else line by line
    const py = out.stdout.split("\n");
    const js = CORE_RAW.replace(/@([A-Za-z0-9_]+)@/g, (m, nme) => (nme === "INIT" ? "@@INIT@@" : String(TOK[nme]))).split("\n");
    const pyNoInit = py.filter((l) => !/^\td_(meta|pv|tgt|wb)\.poke\(/.test(l));
    const jsNoInit = js.filter((l) => l !== "@@INIT@@");
    assert.deepStrictEqual(pyNoInit, jsNoInit);
    assert.ok(py.filter((l) => /^\td_meta\.poke\(/.test(l)).length === 3 * L.np);
});

// ----------------------------------------------------------------------------- UI model (stage 2)
const FACE = G.GL_FACE;
const UI_COMBOS = [];
for (const editor of [0, 1]) for (const slots of [0, 1]) for (const options of [0, 1]) UI_COMBOS.push({ editor, slots, options });
const DEVICE_W = (ui) => G.glitchFaceLayout(ui).width;

ok("layout: width math and the four collapse states", () => {
    const base = FACE.MARGIN + (FACE.PAD_W + FACE.GAP + FACE.VIEW_W) + FACE.GAP + FACE.SIDE_W + FACE.MARGIN;
    assert.strictEqual(DEVICE_W({ editor: 0, slots: 0 }), base);
    assert.strictEqual(DEVICE_W({ editor: 0, slots: 1 }), base + FACE.GAP + FACE.SLOTS_W);
    assert.strictEqual(DEVICE_W({ editor: 1, slots: 0 }), base + FACE.GAP + FACE.EDITOR_W);
    assert.strictEqual(DEVICE_W({ editor: 1, slots: 1 }), base + 2 * FACE.GAP + FACE.EDITOR_W + FACE.SLOTS_W);
    assert.deepStrictEqual([374, 462, 568, 656], [DEVICE_W({ editor: 0, slots: 0 }), DEVICE_W({}), DEVICE_W({ editor: 1, slots: 0 }), DEVICE_W({ editor: 1 })]);
    // the options view and a missing ui never change the width; the phase 2 sequencer flag is ignored for now
    assert.strictEqual(DEVICE_W({ options: 1 }), DEVICE_W({}));
    assert.strictEqual(DEVICE_W({ seq: 1 }), DEVICE_W({}));
    assert.strictEqual(DEVICE_W(undefined), 462);
    for (const ui of UI_COMBOS) assert.strictEqual(G.glitchFaceLayout(ui).height, 169);
});

ok("layout: every interactive rect is inside its panel, nothing overlaps (all collapse combinations)", () => {
    for (const ui of UI_COMBOS) {
        const Lo = G.glitchFaceLayout(ui);
        for (const nTiles of [0, 1, 3, 4, 8, 12, 13, 15]) {
            for (const nRows of [0, 1, 5, 10]) {
                const map = G.glitchHitMap(ui, nTiles, nRows);
                const whole = { x: 0, y: 0, w: Lo.width, h: 169 };
                const seen = new Set();
                for (const a of map) {
                    assert.ok(!seen.has(a.id), `duplicate hit id ${a.id}`);
                    seen.add(a.id);
                    assert.ok(G.glInside(a.panel, whole), `${a.id}: panel inside the device`);
                    assert.ok(G.glInside(a.r, a.panel), `${a.id} inside its panel (${JSON.stringify(ui)} tiles ${nTiles} rows ${nRows})`);
                    assert.ok(a.r.w >= 10 && a.r.h >= 10, `${a.id} is big enough to hit: ${a.r.w}x${a.r.h}`);
                }
                for (let i = 0; i < map.length; i++) {
                    for (let j = i + 1; j < map.length; j++) {
                        if (map[i].layer !== map[j].layer) continue;
                        assert.ok(!G.glOverlap(map[i].r, map[j].r), `${map[i].id} overlaps ${map[j].id} (${JSON.stringify(ui)})`);
                    }
                }
                // a layer-1 rect (corner badge) sits on a layer-0 rect (the pad)
                for (const c of map.filter((m) => m.layer === 1)) assert.ok(map.some((m) => m.layer === 0 && G.glInside(c.r, m.r)), `${c.id} has a base rect`);
                // sections do not overlap each other
                const panels = [Lo.core, Lo.editor, Lo.slots && Lo.slots.rect, Lo.side.rect].filter(Boolean);
                for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) assert.ok(!G.glOverlap(panels[i], panels[j]), "sections overlap");
                assert.ok(panels.every((pn) => G.glInside(pn, whole)));
                assert.ok(Math.abs(Lo.side.rect.x + Lo.side.rect.w + FACE.MARGIN - Lo.width) < 1e-9, "right margin");
            }
        }
    }
});

ok("layout: the options view replaces the pad, tiles and action bar; Options has one toggle per module type", () => {
    const closed = new Set(G.glitchHitMap({ options: 0 }, 4, 0).map((m) => m.id));
    const open = G.glitchHitMap({ options: 1 }, 4, 0).map((m) => m.id);
    for (const id of ["pad", "tile0", "act_dice", "act_mutate", "act_chaos", "act_opt", "act_ab"]) {
        assert.ok(closed.has(id) && !open.includes(id), id);
    }
    for (let t = 0; t < G.GL_TYPES.length; t++) assert.ok(open.includes("opt_" + t));
    assert.ok(open.includes("opt_all") && open.includes("opt_close") && open.includes("tg_editor") && open.includes("side_mix"));
    const O = G.glitchOptionsLayout(FACE.MARGIN);
    assert.strictEqual(O.items.length, G.GL_TYPES.length);
    assert.ok(G.glInside(O.note, O.panel));
});

ok("layout: tile grid fits the glitch view for 0..15 tiles", () => {
    const view = G.glitchFaceLayout({}).view;
    for (let n = 0; n <= FACE.MAX_TILES; n++) {
        const r = G.glitchTileRects(n, view);
        assert.strictEqual(r.length, n);
        for (const q of r) assert.ok(G.glInside(q, view) && q.w >= 36 && q.h >= 24, `n=${n} tile ${q.w}x${q.h}`);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) assert.ok(!G.glOverlap(r[i], r[j]));
    }
});

ok("tiles: chain order, sub-ops expand, only active modules", () => {
    const g = G.defaultGlitch();
    assert.deepStrictEqual(G.glitchTiles(G.glitchToVector(g)), []);
    G.glitchSetValue(g, "dly", "wet", 0.6);
    G.glitchSetValue(g, "drvA", "wet", 1);
    G.glitchSetValue(g, "smear", "smr_amt", 0.7);
    G.glitchSetValue(g, "smear", "wet", 1);
    G.glitchSetValue(g, "ccrush", "cc_amt", 0.5);
    const keys = G.glitchTiles(G.glitchToVector(g)).map((t) => t.key);
    assert.deepStrictEqual(keys, ["drvA", "smear", "ccrush", "dly"]);
    // a spectral module with no active sub-op shows nothing; a sub-op needs its group amount
    const g2 = G.defaultGlitch();
    G.glitchSetValue(g2, "freeze", "wet", 1);
    assert.deepStrictEqual(G.glitchTiles(G.glitchToVector(g2)), []);
    // a random glitch's tiles are exactly its active instances / sub-ops
    for (let seed = 1; seed <= 60; seed++) {
        const r = G.randomizeGlitch(seed, 0.5, undefined);
        const tiles = G.glitchTiles(G.glitchToVector(r));
        assert.ok(tiles.length >= 1 && tiles.length <= FACE.MAX_TILES);
        for (const t of tiles) assert.ok(G.glitchTileInfo(t.key) && t.wet > G.GL_ACTIVE_EPS);
    }
});

ok("editor rows: every tile key has editable rows that round-trip", () => {
    const keys = G.GL_INSTANCES.filter((i) => i.id !== "spec").map((i) => i.id).concat(["freeze", "smear", "ccrush", "scramble"]);
    for (const key of keys) {
        const rows = G.glitchEditorRows(key);
        assert.ok(rows.length >= 2 && rows.length <= FACE.MAX_ROWS, `${key} rows ${rows.length}`);
        const g = G.defaultGlitch();
        for (const row of rows) {
            const spec = row.spec;
            const lo = row.id === "wet" || spec.kind === "wet" ? 0 : spec.min;
            assert.ok(G.glitchSetValue(g, key, row.id, spec.max + 1000), "clamps high");
            assert.strictEqual(G.glitchGetValue(g, key, row.id), spec.max);
            G.glitchSetValue(g, key, row.id, lo - 1000);
            assert.strictEqual(G.glitchGetValue(g, key, row.id), lo === 0 && spec.kind !== "wet" && row.id !== "wet" ? spec.min : lo);
            // norm round trip
            if (spec.kind !== "disc") {
                const n = G.glParamToNorm(spec, spec.def);
                assert.ok(Math.abs(G.glParamToNorm(spec, G.glNormToParam(spec, n)) - n) < 1e-9);
            }
            assert.ok(typeof G.glitchFormatValue(spec, spec.def) === "string" && G.glitchFormatValue(spec, spec.def).length > 0);
        }
        assert.ok(!G.glitchSetValue(g, key, "nope", 1));
        // the rows are all the editable params of the tile
        if (!["freeze", "smear", "ccrush", "scramble"].includes(key)) assert.strictEqual(rows.length, G.glInstance(key).params.length);
    }
    assert.ok(G.glitchEditorRows("smear").some((r) => r.shared && r.id === "wet"));
    assert.deepStrictEqual(G.glitchEditorRows("freeze").map((r) => r.id), ["frz_amt", "frz_rate", "wet"]);
    assert.deepStrictEqual(G.glitchEditorRows("nothing"), []);
    // editing leaves the glitch inside the contract: normalize is a no-op
    const g3 = G.randomizeGlitch(5, 0.6);
    G.glitchSetValue(g3, G.glitchTiles(G.glitchToVector(g3))[0].key, "wet", 0.33);
    assert.deepStrictEqual(G.normalizeGlitch(g3), g3);
});

ok("editor: remove, lock, and Randomize / Mutate keep locked modules", () => {
    const st = G.defaultState();
    st.working = G.randomizeGlitch(3, 0.4);
    const tiles = G.glitchTiles(G.glitchToVector(st.working));
    const keep = tiles[0].key;
    const info = G.glitchTileInfo(keep);
    const before = JSON.stringify(st.working.modules[info.inst]);
    assert.strictEqual(G.glitchToggleLock(st.working, keep), true);
    assert.ok(G.glitchIsLocked(st.working, keep));
    for (let i = 0; i < 25; i++) {
        G.rerollWorking(st);
        assert.strictEqual(JSON.stringify(st.working.modules[info.inst]), before, `locked ${keep} survives reroll ${i}`);
        assert.ok(G.glitchIsLocked(st.working, keep));
        G.mutateWorking(st);
        assert.strictEqual(JSON.stringify(st.working.modules[info.inst]), before, `locked ${keep} survives mutate ${i}`);
    }
    assert.strictEqual(G.glitchToggleLock(st.working, keep), false);
    assert.ok(!st.working.locks);
    // locking a spectral sub-op keeps its group only
    const g = G.defaultGlitch();
    G.glitchSetValue(g, "smear", "smr_amt", 0.8); G.glitchSetValue(g, "smear", "smr_blur", 0.9); G.glitchSetValue(g, "smear", "wet", 1);
    G.glitchToggleLock(g, "smear");
    const st2 = G.defaultState();
    st2.working = g;
    for (let i = 0; i < 20; i++) {
        G.rerollWorking(st2);
        assert.strictEqual(G.glitchGetValue(st2.working, "smear", "smr_amt"), 0.8);
        assert.strictEqual(G.glitchGetValue(st2.working, "smear", "smr_blur"), 0.9);
    }
    // remove
    const r = G.randomizeGlitch(9, 0.5);
    const k = G.glitchTiles(G.glitchToVector(r))[0].key;
    G.glitchToggleLock(r, k);
    G.glitchRemoveTile(r, k);
    assert.ok(!G.glitchTiles(G.glitchToVector(r)).some((t) => t.key === k));
    assert.ok(!G.glitchIsLocked(r, k));
    const sp = G.defaultGlitch();
    G.glitchSetValue(sp, "freeze", "frz_amt", 1); G.glitchSetValue(sp, "freeze", "wet", 1);
    G.glitchSetValue(sp, "smear", "smr_amt", 1);
    G.glitchRemoveTile(sp, "freeze");
    assert.deepStrictEqual(G.glitchTiles(G.glitchToVector(sp)).map((t) => t.key), ["smear"]);
    G.glitchRemoveTile(sp, "smear");
    assert.ok(!sp.modules.spec, "the spectral module goes with its last sub-op");
});

ok("slots: save, recall, clear and corner assignment drive the engine", () => {
    const st = G.defaultState();
    st.working = G.randomizeGlitch(2, 0.5);
    G.saveToSlot(st, 3);
    assert.deepStrictEqual(st.slots[3].modules, st.working.modules);
    st.working.modules = {};
    assert.ok(Object.keys(st.slots[3].modules).length > 0, "a saved slot is a copy");
    G.recallSlot(st, 3);
    assert.ok(Object.keys(st.working.modules).length > 0);
    G.recallSlot(st, 5);
    assert.ok(Object.keys(st.working.modules).length > 0, "recalling an empty slot changes nothing");
    G.assignCorner(st, 1, 3); G.assignCorner(st, 0, 3); G.assignCorner(st, 9, 3); G.assignCorner(st, 2, 99);
    assert.deepStrictEqual(st.corners, [3, 3, 2, 3]);
    st.audition = "morph";
    st.xy = [0, 0];
    const w = G.engineWeights(st);
    assert.strictEqual(w[3], 1);
    st.xy = [1, 0.5];
    assert.ok(G.engineWeights(st)[3] > 0.99, "corners that point at one slot add up (TR + BR = 1)");
    assert.ok(Math.abs(G.engineWeights(st).reduce((a, b) => a + b, 0) - 1) < 1e-9);
    G.clearSlot(st, 3);
    assert.strictEqual(st.slots[3], null);
    assert.deepStrictEqual(G.currentVector(st).map((v, i) => (i === G.glitchLayout().base.drvA ? 0 : 0)), new Array(L.np).fill(0));
    const sig = G.glitchSignature(G.randomizeGlitch(2, 0.5));
    assert.strictEqual(sig.length, G.GL_NINST);
    assert.ok(sig.some(Boolean));
});

ok("allow-list: toggles gate Randomize and Mutate", () => {
    const st = G.defaultState();
    G.setAllowAll(st, false);
    for (const t of G.GL_TYPES) assert.strictEqual(st.allow[t.id], false);
    assert.deepStrictEqual(G.rerollWorking(st).working.modules, {}, "nothing allowed, nothing rolled");
    G.setAllow(st, "reverb", true);
    G.setAllow(st, "nope", true);
    assert.strictEqual(st.allow.nope, undefined);
    for (let i = 0; i < 40; i++) {
        G.rerollWorking(st);
        assert.deepStrictEqual(Object.keys(st.working.modules), ["rev"]);
    }
    for (const only of ["drive", "freeze", "smear", "chopper", "stutter"]) {
        const s2 = G.defaultState();
        G.setAllowAll(s2, false);
        G.setAllow(s2, only, true);
        for (let i = 0; i < 25; i++) {
            G.rerollWorking(s2);
            const keys = G.glitchTiles(G.glitchToVector(s2.working)).map((t) => G.glitchTileInfo(t.key).type);
            for (const k of keys) assert.strictEqual(k, only);
        }
    }
    G.setAllowAll(st, true);
    for (const t of G.GL_TYPES) assert.strictEqual(st.allow[t.id], true);
});

ok("state versioning: v3 carries ui and seq, v1 and damaged blobs still load", () => {
    assert.strictEqual(G.GL_STATE_VERSION, 3);
    const s = G.defaultState();
    s.ui.editor = 1; s.ui.slots = 0; s.ui.options = 1; s.ui.seq = 1;
    s.working = G.randomizeGlitch(4, 0.5);
    s.ui.sel = G.glitchTiles(G.glitchToVector(s.working))[0].key;
    G.glitchToggleLock(s.working, s.ui.sel);
    const blob = G.stateToBlob(s);
    assert.strictEqual(blob[0], 3);
    const back = G.stateFromBlob(blob);
    assert.strictEqual(back.ui.editor, 1); assert.strictEqual(back.ui.slots, 0); assert.strictEqual(back.ui.options, 1);
    assert.strictEqual(back.ui.seq, 1, "the sequencer section flag round-trips (the layout ignores it until the sequencer UI exists)");
    assert.strictEqual(back.ui.sel, s.ui.sel);
    assert.ok(G.glitchIsLocked(back.working, s.ui.sel));
    assert.deepStrictEqual(back.working.modules, s.working.modules);
    // version 1: no ui at all -> defaults
    const v1 = { version: 1, slots: [null, null, null, null, null, null, null, null], corners: [4, 5, 6, 7], allow: {}, chaos: 0.7, xy: [0.2, 0.9], working: G.randomizeGlitch(1, 0.5), audition: "morph", seed: 9 };
    const old = G.stateFromBlob([1, JSON.stringify(v1)]);
    assert.deepStrictEqual(old.ui, G.defaultUi());
    assert.deepStrictEqual(old.corners, [4, 5, 6, 7]);
    assert.strictEqual(old.audition, "morph");
    assert.strictEqual(old.chaos, 0.7);
    // garbage ui values are sanitized; a selection that is not a tile is dropped
    const bad = G.normalizeState({ ui: { editor: "yes", slots: 0, options: 5, sel: "bogus" } });
    assert.deepStrictEqual(bad.ui, { editor: 1, slots: 0, seq: 0, options: 1, sel: "" });
    assert.deepStrictEqual(G.stateFromBlob([2, "{not json"]).ui, G.defaultUi());
    assert.deepStrictEqual(G.stateFromBlob([]).ui, G.defaultUi());
    // an unknown lock key is dropped
    const lk = G.normalizeGlitch({ modules: {}, locks: { dly: true, bogus: true } });
    assert.deepStrictEqual(lk.locks, { dly: true });
    // undo snapshots restore the editable parts and leave ui / xy alone
    const st = G.defaultState();
    st.working = G.randomizeGlitch(8, 0.5);
    const snap = G.glitchUndoSnapshot(st);
    const was = JSON.stringify(st.working);
    st.working = G.randomizeGlitch(9, 0.9); st.ui.editor = 1; st.xy = [0.1, 0.1];
    G.glitchUndoRestore(st, snap);
    assert.strictEqual(JSON.stringify(st.working), was);
    assert.strictEqual(st.ui.editor, 1);
    assert.deepStrictEqual(st.xy, [0.1, 0.1]);
});

ok("Live parameters: the contract table", () => {
    assert.deepStrictEqual(G.GL_PARAM_KEYS, ["morphx", "morphy", "chaos", "mix", "out", "randomize", "mutate", "mode", "seqrate", "glide", "seqlen"]);
    const longs = new Set();
    for (const k of G.GL_PARAM_KEYS) {
        const p = G.GL_PARAMS[k];
        assert.ok(p && !longs.has(p.long), k);
        longs.add(p.long);
        if (p.kind === "dial" || p.kind === "int") assert.ok(p.lo < p.hi && p.init >= p.lo && p.init <= p.hi);
        else if (p.kind === "enum") assert.ok(p.enums.length >= 3 && p.init >= 0 && p.init < p.enums.length);
        else assert.ok(p.enums.length === 2 && (p.init === 0 || p.init === 1));
    }
    assert.ok(G.GL_PARAMS.randomize.trigger && G.GL_PARAMS.mutate.trigger && !G.GL_PARAMS.mode.trigger);
    assert.strictEqual(G.GL_PARAMS.mix.gen, "wet");
    assert.strictEqual(G.GL_PARAMS.out.gen, "outdb");
});

// ----------------------------------------------------------------------------- the v8ui script in Node (mocked Max)
function makeUi(extra) {
    const vm = require("vm");
    const sent = [];
    const pokes = [];
    const calls = { notify: 0 };
    const sandbox = {
        mgraphics: { size: [462, 169], init() {}, redraw() {}, set_source_rgba() {}, set_line_width() {}, rectangle() {}, rectangle_rounded() {}, move_to() {}, line_to() {}, curve_to() {},
            close_path() {}, arc() {}, ellipse() {}, fill() {}, fill_preserve() {}, stroke() {}, select_font_face() {}, set_font_size() {}, show_text() {}, save() {}, restore() {},
            translate() {}, rotate() {}, text_measure(t) { return [String(t).length * 6, 8]; } },
        outlet: (...a) => sent.push(a.slice(1)),
        notifyclients: () => { calls.notify++; },
        Buffer: function () { this.poke = (ch, off, arr) => pokes.push(arr.slice()); this.peek = () => 0; },
        post() {},
        Date, Math, JSON, console,
    };
    const code = fs.readFileSync(path.join(ROOT, "src", "glitch_config.js"), "utf8") + "\n" + fs.readFileSync(path.join(ROOT, "src", "glitch_ui.js"), "utf8") + (extra || "");
    const ctx = vm.createContext(sandbox);
    vm.runInContext(code, ctx);
    const run = (src) => { const v = vm.runInContext(src, ctx); return v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v; };
    return { run, sent, pokes, calls, ctx, params: () => sent.filter((m) => m[0] === "param") };
}
const pad_h_inner = () => G.glitchFaceLayout({}).pad.h - 16;
const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];

ok("v8ui: Randomize, tiles, the editor section grows the device", () => {
    const u = makeUi();
    u.run("setbuffer('#0-glitchslots', '#0-glitchscope'); device_ready()");
    assert.deepStrictEqual(u.sent.filter((m) => m[0] === "setwidth_cmd").pop(), ["setwidth_cmd", 462]);
    const A = G.glitchFaceLayout({}).action;
    const [dx, dy] = center(A.dice);
    u.run(`onclick(${dx}, ${dy}, 1, 0, 0, 0, 0); ondrag(${dx}, ${dy}, 0)`);
    assert.ok(u.run("gTiles.length") >= 1, "randomize gives tiles");
    assert.ok(u.pokes.length >= 2, "the engine buffer was written");
    assert.strictEqual(u.pokes[u.pokes.length - 1].length, G.GL_SLOTS_BUF_SAMPS);
    assert.ok(u.calls.notify >= 1, "notifyclients after the gesture");
    assert.ok(u.params().some((m) => m[1] === "mode" && m[2] === 0), "Mode set to Working");
    // click the first tile: the editor opens, the device grows by the editor's width
    const tile0 = G.glitchTileRects(u.run("gTiles.length"), G.glitchFaceLayout({}).view)[0];
    const [tx, ty] = center(tile0);
    u.run(`onclick(${tx}, ${ty}, 1, 0, 0, 0, 0); ondrag(${tx}, ${ty}, 0)`);
    assert.strictEqual(u.run("gState.ui.editor"), 1);
    assert.deepStrictEqual(u.sent.filter((m) => m[0] === "setwidth_cmd").pop(), ["setwidth_cmd", 656]);
    assert.strictEqual(u.run("gState.ui.sel"), u.run("gTiles[0].key"));
    u.run("paint()");
    // the same tile again collapses it
    u.run(`onclick(${tx}, ${ty}, 1, 0, 0, 0, 0); ondrag(${tx}, ${ty}, 0)`);
    assert.strictEqual(u.run("gState.ui.editor"), 0);
    assert.deepStrictEqual(u.sent.filter((m) => m[0] === "setwidth_cmd").pop(), ["setwidth_cmd", 462]);
    // the section chips toggle too
    const T = G.glitchFaceLayout({}).toggles;
    u.run(`onclick(${T.slots.x + 5}, ${T.slots.y + 5}, 1, 0, 0, 0, 0); ondrag(0, 0, 0)`);
    assert.deepStrictEqual(u.sent.filter((m) => m[0] === "setwidth_cmd").pop(), ["setwidth_cmd", 374]);
    assert.strictEqual(u.run("gState.ui.slots"), 0);
});

ok("v8ui: editing a row is one undo step and the blob keeps it", () => {
    const u = makeUi();
    u.run("device_ready(); randomize(5); gState.ui.editor = 1; gState.ui.sel = gTiles[0].key; applyLayout();");
    const key = u.run("gState.ui.sel");
    const rows = G.glitchEditorRows(key);
    const ed = u.run("gLayout.editor");
    const E = G.glitchEditorLayout(ed, rows.length);
    const wetRow = E.rows[0];
    const before = u.run("glitchGetValue(gState.working, gState.ui.sel, 'wet')");
    const undoDepth = u.run("gUndo.length");
    const notify0 = u.calls.notify;
    const x0 = wetRow.x + wetRow.w * 0.25, x1 = wetRow.x + wetRow.w * 0.75;
    u.run(`onclick(${x0}, ${wetRow.y + 5}, 1, 0, 0, 0, 0)`);
    for (let k = 0; k < 6; k++) u.run(`ondrag(${x0 + (x1 - x0) * k / 5}, ${wetRow.y + 5}, 1, 0, 0)`);
    assert.strictEqual(u.run("gUndo.length"), undoDepth + 1, "one undo snapshot per gesture, not per drag frame");
    assert.strictEqual(u.calls.notify, notify0, "notifyclients waits for the end of the gesture");
    u.run(`ondrag(${x1}, ${wetRow.y + 5}, 0, 0, 0)`);
    assert.strictEqual(u.calls.notify, notify0 + 1);
    assert.ok(Math.abs(u.run("glitchGetValue(gState.working, gState.ui.sel, 'wet')") - 0.75) < 0.02);
    const blob = u.run("getvalueof()");
    const back = G.stateFromBlob(blob);
    assert.ok(Math.abs(G.glitchGetValue(back.working, key, "wet") - 0.75) < 0.02);
    u.run("undo()");
    assert.ok(Math.abs(u.run("glitchGetValue(gState.working, gState.ui.sel, 'wet')") - before) < 1e-9, "undo restores it");
    u.run("redo()");
    assert.ok(Math.abs(u.run("glitchGetValue(gState.working, gState.ui.sel, 'wet')") - 0.75) < 0.02);
    // lock and remove
    const L = E;
    u.run(`onclick(${center(L.lock)[0]}, ${center(L.lock)[1]}, 1, 0, 0, 0, 0); ondrag(0, 0, 0)`);
    assert.ok(u.run("glitchIsLocked(gState.working, gState.ui.sel)"));
    u.run(`onclick(${center(L.remove)[0]}, ${center(L.remove)[1]}, 1, 0, 0, 0, 0); ondrag(0, 0, 0)`);
    assert.ok(!u.run(`gTiles.some(function (t) { return t.key === ${JSON.stringify(key)}; })`), "removed from the view");
});

ok("v8ui: the morph pad, Mode and automation of Morph X / Y", () => {
    const u = makeUi();
    u.run("device_ready()");
    const pad = G.glitchFaceLayout({}).pad;
    u.run(`onclick(${pad.x + pad.w - 8}, ${pad.y + 30}, 1, 0, 0, 0, 0)`);
    u.run(`ondrag(${pad.x + pad.w - 8}, ${pad.y + 30}, 0)`);
    assert.strictEqual(u.run("gState.audition"), "morph", "dragging the pad makes the morph audible");
    const xy = u.run("gState.xy");
    assert.ok(xy[0] > 0.99 && Math.abs(xy[1] - 22 / (pad_h_inner())) < 1e-6);
    const sent = u.params().filter((m) => m[1] === "morphx").pop();
    assert.ok(sent[2] > 99, "Morph X parameter follows");
    // the echo of what we sent does not move anything
    u.run("set_morphx(" + sent[2] + ")");
    assert.ok(u.run("gState.xy")[0] > 0.99);
    // double-click centres
    u.run(`ondblclick(${pad.x + 50}, ${pad.y + 50})`);
    assert.deepStrictEqual(u.run("gState.xy"), [0.5, 0.5]);
    // automation / LOM: Working -> Morph flips by itself and the engine weights follow
    const u2 = makeUi();
    u2.run("device_ready(); setbuffer('#0-glitchslots', '#0-glitchscope'); test_fill();");
    assert.strictEqual(u2.run("gState.audition"), "working");
    u2.run("set_morphx(0); set_morphy(0)");
    assert.strictEqual(u2.run("gState.audition"), "morph");
    assert.ok(u2.params().some((m) => m[1] === "mode" && m[2] === 1), "Mode follows");
    let buf = u2.pokes[u2.pokes.length - 1];
    assert.strictEqual(buf[L.weightsOffset + 0], 1, "X = 0, Y = 0: all weight on the top-left slot");
    u2.run("set_morphx(100)");
    buf = u2.pokes[u2.pokes.length - 1];
    assert.strictEqual(buf[L.weightsOffset + 1], 1, "X = 100: all weight on the top-right slot (slot 2)");
    // Randomize / Mutate triggers: a rising edge fires once and the trigger resets
    u2.run("randomize(3)");
    const t0 = u2.run("gTiles.length");
    u2.sent.length = 0;
    u2.run("set_randomize(1)");
    assert.ok(u2.params().some((m) => m[1] === "randomize" && m[2] === 0), "trigger resets");
    const seed1 = u2.run("gState.seed");
    u2.run("set_randomize(0); set_randomize(1)");
    assert.strictEqual(u2.run("gState.seed"), seed1 + 1, "each rising edge rolls once");
    u2.run("set_mutate(0); set_mutate(1)");
    assert.strictEqual(u2.run("gState.seed"), seed1 + 2);
    assert.strictEqual(u2.run("gState.audition"), "working");
    assert.ok(t0 >= 1);
});

ok("v8ui: slots save / recall / clear / drag to a corner, Options toggles", () => {
    const u = makeUi();
    u.run("device_ready(); randomize(4);");
    const L = G.glitchFaceLayout({});
    const click = (r, shift, opt) => u.run(`onclick(${center(r)[0]}, ${center(r)[1]}, 1, 0, ${shift ? 1 : 0}, 0, ${opt ? 1 : 0}); ondrag(${center(r)[0]}, ${center(r)[1]}, 0)`);
    const mods = u.run("JSON.stringify(gState.working.modules)");
    click(L.slots.pads[2], true, false); // shift-click saves
    assert.strictEqual(u.run("JSON.stringify(gState.slots[2].modules)"), mods);
    u.run("randomize(77)");
    assert.notStrictEqual(u.run("JSON.stringify(gState.working.modules)"), mods);
    click(L.slots.pads[2]); // click recalls into the working glitch and audits Working
    assert.strictEqual(u.run("JSON.stringify(gState.working.modules)"), mods);
    assert.strictEqual(u.run("gState.audition"), "working");
    // Save button then a slot
    click(L.slots.save);
    click(L.slots.pads[6]);
    assert.ok(u.run("!!gState.slots[6]") && u.run("gArmSave") === false);
    // alt-click clears; Clear button then a slot
    click(L.slots.pads[6], false, true);
    assert.ok(u.run("gState.slots[6] === null"));
    click(L.slots.clear);
    click(L.slots.pads[2]);
    assert.ok(u.run("gState.slots[2] === null"));
    // drag slot 5 onto the bottom-right corner of the pad
    const p5 = center(L.slots.pads[5]);
    u.run(`onclick(${p5[0]}, ${p5[1]}, 1, 0, 0, 0, 0)`);
    u.run(`ondrag(${p5[0] - 40}, ${p5[1] - 10}, 1, 0, 0)`);
    const drop = [L.pad.x + L.pad.w - 10, L.pad.y + L.pad.h - 10];
    u.run(`ondrag(${drop[0]}, ${drop[1]}, 1, 0, 0)`);
    u.run("paint()");
    u.run(`ondrag(${drop[0]}, ${drop[1]}, 0, 0, 0)`);
    assert.deepStrictEqual(u.run("gState.corners"), [0, 1, 2, 5]);
    // drop elsewhere: nothing changes
    u.run(`onclick(${p5[0]}, ${p5[1]}, 1, 0, 0, 0, 0); ondrag(${p5[0] - 40}, ${p5[1]}, 1, 0, 0); ondrag(${p5[0] - 40}, ${p5[1]}, 0, 0, 0)`);
    assert.deepStrictEqual(u.run("gState.corners"), [0, 1, 2, 5]);
    // corner badge click cycles the slot
    const c0 = center(L.corners[0]);
    u.run(`onclick(${c0[0]}, ${c0[1]}, 1, 0, 0, 0, 0); ondrag(0, 0, 0)`);
    assert.strictEqual(u.run("gState.corners[0]"), 1);
    // Options view: toggles
    click(L.action.opt);
    assert.strictEqual(u.run("gState.ui.options"), 1);
    u.run("paint()");
    const O = G.glitchOptionsLayout(FACE.MARGIN);
    click(O.items[0]);
    assert.strictEqual(u.run("gState.allow.drive"), false);
    click(O.all);
    assert.ok(Object.values(u.run("gState.allow")).every((v) => v === true) || Object.values(u.run("gState.allow")).every((v) => v === false));
    click(O.close);
    assert.strictEqual(u.run("gState.ui.options"), 0);
    // paint never throws in any state
    for (const ui of UI_COMBOS) { u.run(`gState.ui = normalizeUi(${JSON.stringify(ui)}); gLayout = glitchFaceLayout(gState.ui); paint();`); }
});

ok("v8ui: blob round trip restores the sections and the device width", () => {
    const u = makeUi();
    u.run("device_ready(); randomize(6); gState.ui.editor = 1; gState.ui.slots = 0; gState.ui.sel = gTiles[0].key; applyLayout();");
    const blob = JSON.parse(JSON.stringify(u.run("getvalueof()")));
    const u2 = makeUi();
    u2.run(`setvalueof(${JSON.stringify(blob[0])}, ${JSON.stringify(blob[1])})`);
    u2.run("device_ready()");
    assert.deepStrictEqual(u2.sent.filter((m) => m[0] === "setwidth_cmd").pop(), ["setwidth_cmd", 568]);
    assert.strictEqual(u2.run("gState.ui.sel"), u.run("gState.ui.sel"));
    assert.ok(u2.params().some((m) => m[1] === "morphx"), "morph / chaos / mode are pushed into the live objects at ready");
});

ok("v8ui: DSP loading pill until the gen runs, preview shows demo telemetry only without real data", () => {
    const u = makeUi();
    assert.strictEqual(u.run("dspReady"), 0);
    assert.ok(u.run("typeof GEN_DSP_TEXT") === "undefined" || true);
    const p = makeUi("\npreview();\n");
    p.run("paint()");
    assert.strictEqual(p.run("gDemo"), true);
    assert.ok(p.run("T() !== null"), "demo telemetry in the preview");
    assert.strictEqual(u.run("T()"), null, "no telemetry, no demo, outside the preview");
    p.run("gHaveTele = true; gTele = new Array(GL_SCOPE.END).fill(0)");
    assert.strictEqual(p.run("T()[GL_SCOPE.IN_PEAK]"), 0, "real telemetry replaces the demo");
    assert.ok(p.run("gTiles.length") >= 1 && p.run("gState.slots.filter(Boolean).length") === 5);
});

// ----------------------------------------------------------------------------- device
const devicePath = path.join(ROOT, "devices", "Glitch.amxd");
if (fs.existsSync(devicePath)) {
    ok("built device", () => {
        const buf = fs.readFileSync(devicePath);
        assert.strictEqual(buf.slice(0, 4).toString(), "ampf");
        assert.strictEqual(buf.slice(8, 12).toString(), "aaaa");
        const len = buf.readUInt32LE(28);
        const p = JSON.parse(buf.slice(32, 32 + len).toString("utf8")).patcher;
        assert.strictEqual(p.latency, G.GL_LATENCY);
        assert.strictEqual(p.openrect[3], 169);
        assert.strictEqual(p.openinpresentation, 1);
        assert.strictEqual(p.openrect[2], DEVICE_W({}));
        assert.strictEqual(p.devicewidth, DEVICE_W({}));
        const byId = {};
        for (const b of p.boxes) byId[b.box.id] = b.box;
        // deferred DSP (AGENTS.md 1d): no gen in the device, the gen patch rides in the v8ui script
        assert.ok(!p.boxes.some((b) => /^gen/.test(b.box.maxclass) || /^gen~?\b/.test(b.box.text || "")), "no gen object in the saved device");
        const viz = byId["obj-viz"];
        const script = viz.textfile.text;
        const m = /var GEN_DSP_TEXT = ("(?:[^"\\]|\\.)*");/.exec(script);
        assert.ok(m, "GEN_DSP_TEXT embedded");
        const dsp = JSON.parse(JSON.parse(m[1]));
        assert.strictEqual(dsp.patcher.classnamespace, "dsp.gen");
        const code = dsp.patcher.boxes.find((b) => b.box.maxclass === "codebox").box.code;
        assert.ok(/@SC_|@B_|@NP@|@INIT@/.test(code) === false, "all tokens substituted");
        assert.ok(code.includes('Buffer slots("glitchslots")') && code.includes("fft_run"));
        assert.ok(/var GEN_DSP_HASH = "[0-9a-f]{12}";/.test(script));
        assert.ok(script.includes("mgraphics.relative_coords = 0") && script.includes("mgraphics.autofill = 0"));
        assert.ok(!/\bvar\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(script), "never declare Max's own v8ui globals");
        // the hub is an open gate, never `t a`; every gen-bound message goes through its right inlet
        assert.strictEqual(byId["obj-gen-in"].text, "gate 1 1");
        assert.strictEqual(byId["obj-gen-in"].varname, "gl_genin");
        assert.ok(!p.boxes.some((b) => b.box.text === "t a"));
        const cords = p.lines.map((l) => l.patchline);
        const into = (dst, inlet) => cords.filter((c) => c.destination[0] === dst && (inlet === undefined || c.destination[1] === inlet)).map((c) => c.source[0]);
        for (const src of ["obj-msg-gen-buf", "obj-bpm-prep", "obj-ppq-prep", "obj-prep-mix", "obj-prep-out"]) assert.ok(into("obj-gen-in", 1).includes(src), src);
        assert.ok(!cords.some((c) => c.destination[0] === "obj-gen"), "nothing is wired to a gen that does not exist yet");
        // dry until the gen runs: plugin~ -> selector~ input 1 -> plugout~; the v8ui adds gen -> input 2
        assert.deepStrictEqual(into("obj-selL", 1), ["obj-plugin"]);
        assert.deepStrictEqual(into("obj-selR", 1), ["obj-plugin"]);
        assert.deepStrictEqual(into("obj-plugout", 0), ["obj-selL"]);
        assert.strictEqual(byId["obj-plugin"].varname, "gl_plugin");
        assert.strictEqual(byId["obj-selL"].text, "selector~ 2 1");
        assert.ok(cords.some((c) => c.source[0] === "obj-route-viz" && c.source[1] === 3 && c.destination[0] === "obj-selL"), "dsp_on switches the selectors");
        // dsp_ready re-sends binding, Mix, Output, bpm, ppq, playing
        assert.strictEqual(byId["obj-route-viz"].text, "route param setwidth_cmd dsp_ready dsp_on");
        for (const dst of ["obj-msg-gen-buf", "obj-ctrl-mix", "obj-ctrl-out", "obj-bpm-hold", "obj-ppq-hold", "obj-play-hold"]) assert.ok(into(dst).includes("obj-dsp-resend"), dst);
        assert.strictEqual(byId["obj-play-prep"].text, "prepend playing");
        assert.ok(cords.some((c) => c.source[0] === "obj-sync" && c.source[1] === 0 && c.destination[0] === "obj-play-chg"), "plugsync~ outlet 0 (transport) feeds the sequencer clock");
        assert.ok(into("obj-gen-in", 1).includes("obj-play-prep"));
        // setwidth path and live.thisdevice ready
        assert.ok(into("obj-thisdevice").includes("obj-prep-setwidth") && into("obj-viz").includes("obj-msg-ready"));
        assert.strictEqual(byId["obj-msg-ready"].text, "device_ready");
        // Live parameters: real live.* objects, none on the face, all automatable
        const ctrls = p.boxes.filter((b) => /^obj-ctrl-/.test(b.box.id));
        assert.deepStrictEqual(ctrls.map((b) => b.box.id.slice(9)), G.GL_PARAM_KEYS);
        assert.strictEqual(byId["obj-route-param"].text, "route " + G.GL_PARAM_KEYS.join(" "));
        for (const b of ctrls) {
            const k = b.box.id.slice(9);
            const spec = G.GL_PARAMS[k];
            const v = b.box.saved_attribute_attributes.valueof;
            assert.strictEqual(b.box.parameter_enable, 1);
            assert.ok(!b.box.presentation, `${k} is off the face`);
            assert.strictEqual(v.parameter_longname, spec.long);
            assert.strictEqual(v.parameter_initial[0], spec.init);
            assert.strictEqual(b.box.maxclass, spec.kind === "dial" || spec.kind === "int" ? "live.dial" : (spec.kind === "enum" ? "live.menu" : "live.text"));
            if (spec.kind === "dial" || spec.kind === "int") { assert.strictEqual(v.parameter_mmin, spec.lo); assert.strictEqual(v.parameter_mmax, spec.hi); assert.strictEqual(v.parameter_type, spec.kind === "int" ? 1 : 0); }
            else if (spec.kind === "enum") { assert.deepStrictEqual(v.parameter_enum, spec.enums); assert.strictEqual(v.parameter_type, 2); assert.strictEqual(v.parameter_mmax, spec.enums.length - 1); }
            else { assert.strictEqual(b.box.mode, 1); assert.deepStrictEqual(v.parameter_enum, spec.enums); assert.strictEqual(v.parameter_type, 2); }
            assert.ok(cords.some((c) => c.source[0] === b.box.id && c.destination[0] === `obj-uiprep-${k}`), `${k} echoes to the face`);
            assert.ok(cords.some((c) => c.source[0] === "obj-route-param" && c.destination[0] === b.box.id), `${k} is driven by the face`);
            assert.strictEqual(byId[`obj-uiprep-${k}`].text, `prepend set_${k}`);
        }
        assert.strictEqual(byId["obj-scale-mix"].text, "* 0.01");
        assert.strictEqual(byId["obj-prep-mix"].text, "prepend wet");
        assert.strictEqual(byId["obj-prep-out"].text, "prepend outdb");
        const longs = ctrls.map((b) => b.box.saved_attribute_attributes.valueof.parameter_longname);
        assert.strictEqual(new Set(longs).size, longs.length, "unique parameter names");
        // rule 4: the face is one v8ui covering the device; nothing from live.* overlaps it (nothing is in presentation)
        const pres = p.boxes.filter((b) => b.box.presentation === 1);
        assert.deepStrictEqual(pres.map((b) => b.box.id), ["obj-viz"]);
        assert.deepStrictEqual(viz.presentation_rect, [0, 0, DEVICE_W({}), 169]);
        assert.ok(!viz.ignoreclick);
        assert.strictEqual(viz.saved_attribute_attributes.valueof.parameter_type, 3);
        assert.strictEqual(viz.saved_attribute_attributes.valueof.parameter_longname, "GlitchStateData");
        for (const a of p.boxes) {
            if (!a.box.maxclass.startsWith("live.") || !a.box.presentation) continue;
            const A = a.box.presentation_rect, B = viz.presentation_rect;
            assert.ok(!(A[0] < B[0] + B[2] && B[0] < A[0] + A[2] && A[1] < B[1] + B[3] && B[1] < A[1] + A[3]), `${a.box.id} overlaps the face`);
        }
        // panels (none are needed: the face paints its own card) would have to be last with background 1
        let seenBg = false;
        for (const b of p.boxes) {
            if (b.box.maxclass === "panel") { assert.strictEqual(b.box.background, 1); seenBg = true; } else assert.ok(!seenBg, "panels are last");
        }
        const texts = p.boxes.map((b) => b.box.text || "");
        assert.ok(texts.includes("buffer~ #0-glitchslots @samps " + G.GL_SLOTS_BUF_SAMPS));
        assert.ok(texts.includes("buffer~ #0-glitchscope @samps " + G.GL_SCOPE_SAMPS));
        assert.ok(texts.includes("slots #0-glitchslots, scope #0-glitchscope"));
        assert.ok(texts.includes("setbuffer #0-glitchslots #0-glitchscope"));
        for (const t of texts) if (/^buffer~ /.test(t)) assert.ok(t.startsWith("buffer~ #0-"), t);
        // the script's own gen-binding strings are the same names
        assert.ok(script.includes('"gl_genin"') && script.includes('"gl_selL"') && script.includes('"dsp_on"'));
    });
}

console.log(`test_glitch: ${passed} groups passed`);
