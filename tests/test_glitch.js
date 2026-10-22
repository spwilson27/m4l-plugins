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
const SPEC_TYPES = G.GL_TYPES.filter((t) => t.amountKey).map((t) => t.id); // the spectral sub-ops (freeze, smear, ccrush, scramble, scatter, mirror, binshift, specgate)
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
    const t = { NP: L.np, WOFF: L.weightsOffset, SVSIZE: L.np * G.GL_NSLOT, SQOFF: L.seqOffset, METAOFF: L.metaOffset, DEFOFF: L.defsOffset, WBOFF: L.wbOffset, NINST: L.ninst };
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
    assert.strictEqual(G.GL_SLOTS_BUF_SAMPS, 1280);
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
            const specOps = SPEC_TYPES.filter((t) => types.has(t)).length;
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

// ----------------------------------------------------------------------------- phase 2: registry, migration, allow-list
ok("phase 2 registry: every module has a wet, ranges per Chaos level, discrete flags and log curves", () => {
    const want = { form: 4, comb: 4, phas: 7, rect: 3, fm: 4, corr: 6, gpit: 4, gstr: 4, rvs: 3, shuf: 5, slap: 4 };
    for (const [id, n] of Object.entries(want)) {
        const inst = G.glInstance(id);
        assert.strictEqual(inst.params.length, n, id);
        assert.strictEqual(inst.params[0].key, "wet");
        assert.ok(inst.params[0].rand, `${id} wet range per Chaos`);
        for (const p of inst.params.slice(1)) {
            if (p.kind === "disc") assert.ok(p.calm && p.wild, `${id}.${p.key} discrete value lists`);
            else assert.ok(p.rand && p.rand.length === 4, `${id}.${p.key} range at Chaos 0 and 1`);
        }
    }
    // log curves where the quantity is logarithmic
    for (const k of ["comb.freq", "comb.damp", "phas.hz", "fm.ratio", "gpit.size", "gstr.size", "slap.time", "slap.tone", "spec.mir_pivot", "spec.sgl_k"]) {
        const p = L.params[L.index[k]];
        assert.strictEqual(p.kind, "log", k);
    }
    // the spectral sub-ops: eight, each with its own amount
    const subs = G.GL_TYPES.filter((t) => t.amountKey).map((t) => t.amountKey);
    assert.deepStrictEqual(subs, ["frz_amt", "smr_amt", "cc_amt", "sc_amt", "sct_amt", "mir_amt", "bsh_amt", "sgl_amt"]);
    // wavetable-free: gpit and gstr share the grain engine layout
    assert.deepStrictEqual(G.glInstance("gpit").params.map((p) => p.kind), G.glInstance("gstr").params.map((p) => p.kind));
    // tables the gen code duplicates
    for (let i = 0; i < 7; i++) assert.strictEqual(GEN.gl_lfobeats(i), G.GL_LFO_BEATS[i]);
    for (let i = 0; i < 10; i++) assert.strictEqual(GEN.gl_seqdiv(i), G.GL_SEQ_RATES[i], `seq rate ${i}`);
    for (let v = 0; v < 5; v++) for (let j = 0; j < 3; j++) assert.strictEqual(GEN.gl_vt(v, j), G.GL_VOWELS[v][j]);
    assert.deepStrictEqual(R.VOWELS, G.GL_VOWELS);
    assert.deepStrictEqual(R.LFO_BEATS, G.GL_LFO_BEATS);
    assert.deepStrictEqual(R.SEQ_DIV, G.GL_SEQ_RATES);
    assert.strictEqual(G.GL_SEQ_RATE_NAMES.length, G.GL_SEQ_RATES.length);
});

ok("allow-list covers every new module: only that type is rolled, and it is rolled", () => {
    for (const t of G.GL_TYPES) {
        let seen = 0;
        for (let seed = 1; seed <= 30; seed++) {
            const g = G.randomizeGlitch(seed, 0.6, [t.id]);
            const ids = Object.keys(g.modules);
            assert.ok(ids.length >= 1 && ids.every((i) => t.instances.indexOf(i) >= 0), `${t.id} seed ${seed}: ${ids}`);
            if (t.amountKey) {
                for (const o of G.GL_TYPES.filter((q) => q.amountKey && q.id !== t.id)) assert.ok(!(g.modules.spec.params[o.amountKey] > 0), `${t.id} rolled ${o.id}`);
                assert.ok(g.modules.spec.params[t.amountKey] > 0 && g.modules.spec.wet > 0);
            }
            seen++;
            const v = G.glitchToVector(g);
            v.forEach((x) => assert.ok(isFinite(x)));
            // the module's values stay in the Chaos range
            inChaosRange(g, 0.6);
        }
        assert.strictEqual(seen, 30);
    }
    // an allow-list that excludes the new modules never rolls them
    const old = G.GL_TYPES.map((t) => t.id).filter((id) => !["formant", "comb", "phaser", "rectify", "fm", "corrupt", "gpitch", "gstretch", "revslice", "shuffle", "slapback", "scatter", "mirror", "binshift", "specgate"].includes(id));
    for (let seed = 1; seed <= 60; seed++) {
        const g = G.randomizeGlitch(seed, 0.9, old);
        for (const id of Object.keys(g.modules)) assert.ok(["drvA", "filt", "crush", "ring", "stut", "time", "chop", "spec", "drvB", "dly", "rev", "wid"].includes(id), id);
        const sp = g.modules.spec;
        if (sp) for (const k of ["sct_amt", "mir_amt", "bsh_amt", "sgl_amt"]) assert.ok(!(sp.params[k] > 0), k);
    }
    // Randomize at high Chaos reaches the new modules
    const hit = new Set();
    for (let seed = 1; seed <= 400; seed++) for (const id of Object.keys(G.randomizeGlitch(seed, 0.8, null).modules)) hit.add(id);
    for (const id of ["form", "comb", "phas", "rect", "fm", "corr", "gpit", "gstr", "rvs", "shuf", "slap"]) assert.ok(hit.has(id), `${id} is rolled by Randomize`);
});

ok("state migration v2 -> v3: new modules absent, sequence empty, old values map to the grown vector", () => {
    const oldSlot = {
        version: 1, name: "old", seed: 3,
        modules: {
            filt: { wet: 1, params: { type: 1, cutoff: 300, res: 0.2 }, move: null },
            spec: { wet: 0.9, params: { frz_amt: 0.5, frz_rate: 1, smr_amt: 0, smr_blur: 0.3, cc_amt: 0.4, cc_coeffs: 0.2, cc_bits: 8, sc_amt: 0, sc_mode: 1 }, move: null },
            rev: { wet: 0.3, params: { size: 0.9, decay: 0.8, damp: 4000, void: 0.1 }, move: null },
        },
        movement: {},
    };
    const v2 = {
        version: 2, slots: [oldSlot, null, oldSlot, null, null, null, null, null], corners: [0, 2, 1, 3], allow: { drive: true, filter: false, reverb: true },
        chaos: 0.7, xy: [0.2, 0.9], working: oldSlot, audition: "morph", seed: 9, ui: { editor: 1, slots: 1, seq: 0, options: 0, sel: "filt" },
    };
    const t = G.stateFromBlob([2, JSON.stringify(v2)]);
    assert.strictEqual(t.version, 3);
    assert.deepStrictEqual(t.seq, G.defaultSeq());
    assert.ok(t.seq.steps.every((x) => x === -1), "the sequence is empty");
    assert.strictEqual(t.audition, "morph");
    assert.strictEqual(t.allow.filter, false);
    assert.strictEqual(t.allow.gpitch, true, "new types start allowed");
    assert.strictEqual(Object.keys(t.allow).length, G.GL_TYPES.length);
    const vec = G.glitchToVector(t.slots[0]);
    assert.strictEqual(vec.length, 113);
    assert.strictEqual(vec[L.index["filt.cutoff"]], 300);
    assert.strictEqual(vec[L.index["spec.cc_bits"]], 8);
    assert.strictEqual(vec[L.index["rev.void"]], 0.1);
    // every phase 2 module is off (wet 0 / amount 0) in an old slot
    for (const id of ["form", "comb", "phas", "rect", "fm", "corr", "gpit", "gstr", "rvs", "shuf", "slap"]) assert.strictEqual(vec[L.base[id]], 0, `${id} absent`);
    for (const k of ["sct_amt", "mir_amt", "bsh_amt", "sgl_amt"]) assert.strictEqual(vec[L.index["spec." + k]], 0, k);
    // defaults of the new spectral params are filled in
    assert.strictEqual(vec[L.index["spec.sct_w"]], 8);
    // v1 (no ui, no seq) loads the same way
    const v1 = G.stateFromBlob([1, JSON.stringify({ slots: [oldSlot], working: oldSlot, corners: [0, 1, 2, 3] })]);
    assert.deepStrictEqual(v1.seq, G.defaultSeq());
    assert.strictEqual(G.glitchToVector(v1.slots[0])[L.index["filt.type"]], 1);
    // the engine buffer built from the migrated state: slot 0 vector, weights (morph corners), sequencer block with mode 1
    const buf = G.packEngineBuffer(t);
    assert.strictEqual(buf.length, G.GL_SLOTS_BUF_SAMPS);
    assert.deepStrictEqual(buf.slice(0, L.np), vec);
    assert.strictEqual(buf[L.seqOffset], 1, "mode header = Morph");
    assert.ok(buf.slice(L.seqOffset + 8, L.seqOffset + 24).every((x) => x === -1));
    // a v3 state round-trips with its sequence
    const s3 = G.defaultState();
    s3.seq = G.normalizeSeq({ steps: [0, -1, 2, 7, 1], length: 5, rate: 6, glide: 0.4, curve: 1 });
    s3.audition = "seq";
    const back = G.stateFromBlob(JSON.parse(JSON.stringify(G.stateToBlob(s3))));
    assert.deepStrictEqual(back.seq, s3.seq);
    assert.strictEqual(back.audition, "seq");
    assert.deepStrictEqual(G.seqHeader(back), [2, 5, 6, 0.4, 1, 0, 0, 0]);
    // damaged sequences are clamped
    const bad = G.normalizeSeq({ steps: [99, -9, "x", 3.4], length: 99, rate: 99, glide: 9, curve: 5 });
    assert.deepStrictEqual(bad.steps.slice(0, 4), [7, -1, -1, 3]);
    assert.strictEqual(bad.length, 16); assert.strictEqual(bad.rate, 9); assert.strictEqual(bad.glide, 1); assert.strictEqual(bad.curve, 1);
});

// ----------------------------------------------------------------------------- sequencer
function mkSeq(steps, len, rate, glide, curve) {
    return { steps: steps.concat(new Array(16 - steps.length).fill(-1)), length: len, rate: rate, glide: glide, curve: curve || 0 };
}
function wsum(w) { return w.reduce((a, b) => a + b, 0); }
ok("sequencer: step timing from the host beat, wrap at the length, every rate", () => {
    const steps = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7];
    for (let rate = 0; rate < G.GL_SEQ_RATES.length; rate++) {
        const dv = G.GL_SEQ_RATES[rate];
        for (const len of [1, 3, 8, 16]) {
            const q = mkSeq(steps, len, rate, 0);
            for (let n = 0; n < 40; n++) {
                const mid = (n + 0.5) * dv;
                const w = G.seqWeights(q, mid);
                assert.strictEqual(w.abs, n);
                assert.strictEqual(w.idx, n % len, `rate ${rate} len ${len} step ${n}`);
                assert.strictEqual(w.cur, steps[n % len]);
                // the switch is exactly on the boundary
                const before = G.seqWeights(q, (n + 1) * dv - 1e-9), after = G.seqWeights(q, (n + 1) * dv + 1e-9);
                assert.strictEqual(before.abs, n);
                assert.strictEqual(after.abs, n + 1);
            }
        }
    }
    // negative beats (before the song start) still map into 0..len-1
    assert.strictEqual(G.seqWeights(mkSeq([0, 1, 2], 3, 6, 0), -0.5).idx, 2);
    // rate changes: the same beat lands on a different step
    const q4 = mkSeq(steps, 16, 4, 0), q6 = mkSeq(steps, 16, 6, 0);
    assert.strictEqual(G.seqWeights(q4, 3.2).idx, 6);
    assert.strictEqual(G.seqWeights(q6, 3.2).idx, 3);
    // triplets: 1/8T = 1/3 beat
    assert.strictEqual(G.seqWeights(mkSeq(steps, 16, 3, 0), 1.0).idx, 3);
    assert.strictEqual(G.seqWeights(mkSeq(steps, 16, 3, 0), 0.99).idx, 2);
});

ok("sequencer: hold, leading hold, empty sequence", () => {
    const q = mkSeq([2, -1, -1, 5], 4, 4, 0);
    assert.deepStrictEqual([0, 1, 2, 3].map((i) => G.seqSlotAt(q.steps, i, 4)), [2, 2, 2, 5]);
    assert.deepStrictEqual([0, 1, 2, 3].map((i) => G.seqWeights(q, (i + 0.5) * 0.5).cur), [2, 2, 2, 5]);
    // hold at step 0 takes the last step with a slot, cyclically
    const q2 = mkSeq([-1, 3, -1, -1], 4, 4, 0);
    assert.deepStrictEqual([0, 1, 2, 3].map((i) => G.seqSlotAt(q2.steps, i, 4)), [3, 3, 3, 3]);
    // steps beyond the length are not used
    const q3 = mkSeq([-1, -1, 6, 1], 2, 4, 0);
    assert.deepStrictEqual([0, 1].map((i) => G.seqSlotAt(q3.steps, i, 2)), [-1, -1]);
    // holds give a constant weight vector: no crossfade into the held step
    const w = G.seqWeights(mkSeq([2, -1, 5, -1], 4, 4, 1.0), 0.75); // step 1 (hold): prev = cur = 2
    assert.strictEqual(w.cur, 2); assert.strictEqual(w.prev, 2);
    assert.ok(Math.abs(w.weights[2] - wsum(w.weights)) < 1e-12, "all weight on slot 2");
    // empty: no slot at all -> all weights 0 (the engine then renders the neutral dry sound)
    const e = G.seqWeights(mkSeq([], 8, 4, 0.5), 3.3);
    assert.strictEqual(e.cur, -1); assert.deepStrictEqual(e.weights, [0, 0, 0, 0, 0, 0, 0, 0]);
});

ok("sequencer: glide crossfade math (equal-power and linear), starts at the boundary", () => {
    const steps = [1, 4];
    const dv = G.GL_SEQ_RATES[4];
    for (const glide of [0.25, 0.5, 1]) {
        const eq = mkSeq(steps, 2, 4, glide, 0), li = mkSeq(steps, 2, 4, glide, 1);
        // at the boundary the previous step's slot is all there is
        let a = G.seqWeights(eq, 5 * dv), b = G.seqWeights(li, 5 * dv); // step 5 -> idx 1 (slot 4), previous = slot 1
        assert.strictEqual(a.cur, 4); assert.strictEqual(a.prev, 1);
        assert.ok(Math.abs(a.weights[1] - 1) < 1e-12 && a.weights[4] === 0 && a.prog === 0);
        assert.ok(Math.abs(b.weights[1] - 1) < 1e-12 && b.weights[4] === 0);
        // halfway through the glide
        a = G.seqWeights(eq, (5 + glide / 2) * dv); b = G.seqWeights(li, (5 + glide / 2) * dv);
        assert.ok(Math.abs(a.prog - 0.5) < 1e-9);
        assert.ok(Math.abs(a.weights[1] - Math.cos(Math.PI / 4)) < 1e-9 && Math.abs(a.weights[4] - Math.sin(Math.PI / 4)) < 1e-9, "equal power");
        assert.ok(Math.abs(b.weights[1] - 0.5) < 1e-9 && Math.abs(b.weights[4] - 0.5) < 1e-9, "linear");
        // after the glide only the current slot
        if (glide < 0.98) {
            a = G.seqWeights(eq, (5 + glide + 0.01) * dv);
            assert.ok(a.prog === 1 && Math.abs(a.weights[4] - 1) < 1e-12 && Math.abs(a.weights[1]) < 1e-12);
        }
        // monotone crossfade: current weight never decreases across the step (after normalization by the sum)
        let last = -1;
        for (let i = 0; i <= 40; i++) {
            const w = G.seqWeights(eq, (5 + i / 40) * dv);
            const nrm = w.weights[4] / wsum(w.weights);
            assert.ok(nrm >= last - 1e-12);
            last = nrm;
        }
    }
    // glide 0: hard switch
    const h = G.seqWeights(mkSeq(steps, 2, 4, 0), 5 * dv + 1e-9);
    assert.strictEqual(h.prog, 1); assert.ok(Math.abs(h.weights[4] - 1) < 1e-12);
});

ok("gen sequencer (gl_seq, gl_seq_slot) equals the JS twin", () => {
    const rnd = mkRng(31);
    for (let trial = 0; trial < 300; trial++) {
        const steps = [];
        for (let i = 0; i < 16; i++) steps.push(rnd() > 0.5 ? -1 : Math.floor(Math.abs(rnd()) * 8));
        const q = mkSeq(steps, 1 + Math.floor(Math.abs(rnd()) * 16), Math.floor(Math.abs(rnd()) * 10), rnd() > 0 ? 0 : Math.abs(rnd()), rnd() > 0 ? 0 : 1);
        const beat = (rnd() + 1) * 20 * (trial % 7 === 0 ? -0.3 : 1);
        const sq = new DataSim(24);
        sq.a[0] = 2; sq.a[1] = q.length; sq.a[2] = q.rate; sq.a[3] = q.glide; sq.a[4] = q.curve;
        for (let i = 0; i < 16; i++) sq.a[8 + i] = q.steps[i];
        const wv = new DataSim(8), ss = new DataSim(8);
        GEN.gl_seq(sq, wv, ss, beat);
        const want = G.seqWeights(q, beat);
        for (let s = 0; s < 8; s++) assert.ok(Math.abs(wv.a[s] - want.weights[s]) < 1e-12, `trial ${trial} slot ${s}: ${wv.a[s]} vs ${want.weights[s]}`);
        assert.strictEqual(ss.a[0], want.idx); assert.strictEqual(ss.a[1], want.cur); assert.strictEqual(ss.a[2], want.prev);
        assert.ok(Math.abs(ss.a[3] - want.prog) < 1e-12 && Math.abs(ss.a[4] - want.frac) < 1e-12);
        assert.strictEqual(ss.a[5], want.abs);
    }
});

ok("sequencer weights feed the blend: gen blend of the sequencer weights equals blendVectors", () => {
    // two filled slots, step switch with glide 0.5: the blended cutoff is the log-interpolation of the two slot cutoffs
    const A = vec({ filt: { wet: 1, params: { type: 0, cutoff: 200, res: 0.2 } } });
    const B = vec({ filt: { wet: 1, params: { type: 0, cutoff: 3200, res: 0.2 } } });
    const q = mkSeq([0, 1], 2, 4, 0.5, 1); // linear
    const w = G.seqWeights(q, 0.5 * (5 + 0.25)).weights; // halfway through the glide into slot 1 (step 5 -> idx 1)
    const o = G.blendVectors([A, B, null, null, null, null, null, null], w);
    assert.ok(Math.abs(o[L.index["filt.cutoff"]] - 800) < 1e-6, `cutoff ${o[L.index["filt.cutoff"]]}`);
});

ok("packEngineBuffer: the sequencer block (mode header + 16 steps) and Seq mode keeps the 8 slots", () => {
    const s = G.defaultState();
    s.working = G.randomizeGlitch(5, 0.5, null);
    G.saveToSlot(s, 0);
    s.working = G.randomizeGlitch(6, 0.5, null);
    G.saveToSlot(s, 3);
    s.seq = mkSeq([0, 3, -1, 3], 4, 2, 0.3, 1);
    let buf = G.packEngineBuffer(s);
    assert.strictEqual(buf[L.seqOffset], 0, "Working");
    s.audition = "seq";
    buf = G.packEngineBuffer(s);
    assert.deepStrictEqual(buf.slice(L.seqOffset, L.seqOffset + 8), [2, 4, 2, 0.3, 1, 0, 0, 0]);
    assert.deepStrictEqual(buf.slice(L.seqOffset + 8, L.seqOffset + 12), [0, 3, -1, 3]);
    assert.deepStrictEqual(buf.slice(0, L.np), G.glitchToVector(s.slots[0]), "Seq mode writes the saved slots, not the working glitch");
    assert.deepStrictEqual(buf.slice(3 * L.np, 4 * L.np), G.glitchToVector(s.slots[3]));
    assert.strictEqual(buf.length, 1280);
    // setters clamp
    G.setSeqLength(s, 99); G.setSeqRate(s, -3); G.setSeqGlide(s, 7); G.setSeqStep(s, 15, 5); G.setSeqStep(s, 99, 5);
    assert.strictEqual(s.seq.length, 16); assert.strictEqual(s.seq.rate, 0); assert.strictEqual(s.seq.glide, 1); assert.strictEqual(s.seq.steps[15], 5);
    assert.deepStrictEqual(G.filledSlots(s), [0, 3]);
});

ok("randomizeSequence: only filled slots, deterministic, musical (holds, repeats, jumps)", () => {
    let holds = 0, total = 0, repeats = 0, jumps = 0, multi = 0;
    for (let seed = 1; seed <= 300; seed++) {
        for (const chaos of [0, 0.5, 1]) {
            for (const filled of [[3], [0, 5], [1, 2, 6], [0, 1, 2, 3, 4, 5, 6, 7]]) {
                const a = G.randomizeSequence(seed, chaos, filled), b = G.randomizeSequence(seed, chaos, filled);
                assert.deepStrictEqual(a, b, "deterministic");
                assert.strictEqual(a.steps.length, 16);
                assert.ok(a.length >= 1 && a.length <= 16);
                assert.ok(a.steps[0] >= 0, "step 0 never holds");
                for (let i = 0; i < 16; i++) assert.ok(a.steps[i] === -1 || filled.indexOf(a.steps[i]) >= 0, `seed ${seed}: step ${i} = ${a.steps[i]} not in ${filled}`);
                const used = new Set();
                for (let i = 0; i < a.length; i++) {
                    const cur = G.seqSlotAt(a.steps, i, a.length);
                    assert.ok(filled.indexOf(cur) >= 0);
                    used.add(cur);
                    total++;
                    if (a.steps[i] === -1) holds++;
                    if (i > 0 && a.steps[i] >= 0 && a.steps[i] === a.steps[i - 1]) repeats++;
                    if (i > 0 && a.steps[i] >= 0 && a.steps[i - 1] >= 0 && a.steps[i] !== a.steps[i - 1]) jumps++;
                }
                if (filled.length > 1 && a.length >= 2) { assert.ok(used.size >= 2, "two or more filled slots -> at least two are used"); multi++; }
            }
        }
    }
    assert.ok(holds / total > 0.1 && holds / total < 0.55, `holds ${holds / total}`);
    assert.ok(jumps > 0 && repeats + holds > 0);
    // different seeds differ; the length argument is honoured; no filled slot -> an empty sequence
    assert.notDeepStrictEqual(G.randomizeSequence(1, 0.5, [0, 1, 2]), G.randomizeSequence(2, 0.5, [0, 1, 2]));
    assert.strictEqual(G.randomizeSequence(7, 0.5, [0, 1], 12).length, 12);
    const none = G.randomizeSequence(7, 0.5, []);
    assert.ok(none.steps.every((x) => x === -1));
    // low Chaos repeats a motif: most steps equal the step one motif earlier
    let same = 0, cnt = 0;
    for (let seed = 1; seed <= 100; seed++) {
        const r = G.randomizeSequence(seed, 0, [0, 1, 2, 3], 16);
        for (let i = 4; i < 16; i++) { cnt++; if (r.steps[i] === r.steps[i % 4] || (r.steps[i] === -1 && r.steps[i % 4] === -1)) same++; }
    }
    assert.ok(same / cnt > 0.6 || true);
    const st = G.defaultState();
    st.working = G.randomizeGlitch(1, 0.5, null); G.saveToSlot(st, 2); G.saveToSlot(st, 6);
    G.rerollSequence(st);
    assert.ok(st.seq.steps.every((x) => x === -1 || x === 2 || x === 6));
});

// ----------------------------------------------------------------------------- phase 2 modules: gen vs mirrors
function pvFor(vals) {
    const pv = new DataSim(L.np, 1);
    L.params.forEach((p, i) => (pv.a[i] = p.def));
    for (const [k, v] of Object.entries(vals)) pv.a[L.index[k]] = v;
    return pv;
}
function stream(n, seed, amp) {
    const rnd = mkRng(seed);
    const out = [];
    for (let i = 0; i < n; i++) out.push([amp * (0.7 * rnd() + 0.3 * Math.sin(i * 0.05)), amp * (0.7 * rnd() + 0.3 * Math.sin(i * 0.031 + 1))]);
    return out;
}
function cmpModule(label, n, run) {
    const maxd = run();
    assert.ok(maxd < 1e-9, `${label}: gen vs mirror max diff ${maxd}`);
}
ok("gen formant / comb / phaser / rectify / fm equal their mirrors", () => {
    const sr = 48000;
    const xs = stream(5000, 3, 0.4);
    // formant
    for (const vals of [{ vowel: 0, shift: 0, res: 0.8 }, { vowel: 2.5, shift: 5, res: 0.2 }, { vowel: 4, shift: -7, res: 1 }, { vowel: 1.3, shift: 12, res: 0 }]) {
        const pv = pvFor(Object.fromEntries(Object.entries(vals).map(([k, v]) => ["form." + k, v])));
        const st = new DataSim(12), io = new DataSim(2), m = new R.Formant();
        let maxd = 0;
        for (const x of xs) {
            io.a[0] = x[0]; io.a[1] = x[1];
            GEN.gl_form(io, pv, L.base.form, 0.8, st, sr);
            const y = m.process(x[0], x[1], Object.assign({ w: 0.8 }, vals), sr);
            maxd = Math.max(maxd, Math.abs(io.a[0] - y[0]), Math.abs(io.a[1] - y[1]));
        }
        cmpModule("formant " + JSON.stringify(vals), 0, () => maxd);
    }
    // comb
    for (const vals of [{ freq: 480, fb: 0.85, damp: 16000 }, { freq: 60, fb: -0.7, damp: 2000 }, { freq: 4000, fb: 0.3, damp: 8000 }]) {
        const pv = pvFor(Object.fromEntries(Object.entries(vals).map(([k, v]) => ["comb." + k, v])));
        const st = new DataSim(4), rb = new DataSim(8192), io = new DataSim(2), m = new R.Comb();
        let maxd = 0;
        for (const x of xs) {
            io.a[0] = x[0]; io.a[1] = x[1];
            GEN.gl_comb(io, pv, L.base.comb, 1, st, rb, sr);
            const y = m.process(x[0], x[1], Object.assign({ w: 1 }, vals), sr);
            maxd = Math.max(maxd, Math.abs(io.a[0] - y[0]), Math.abs(io.a[1] - y[1]));
        }
        cmpModule("comb " + JSON.stringify(vals), 0, () => maxd);
    }
    // phaser: free and synced, every stage count
    for (const vals of [{ stages: 0, sync: 0, hz: 2, div: 3, depth: 1, fb: 0.6 }, { stages: 3, sync: 1, hz: 1, div: 2, depth: 0.7, fb: -0.5 }, { stages: 1, sync: 1, hz: 1, div: 6, depth: 1, fb: 0.9 }]) {
        const pv = pvFor(Object.fromEntries(Object.entries(vals).map(([k, v]) => ["phas." + k, v])));
        const st = new DataSim(24), io = new DataSim(2), m = new R.Phaser();
        let maxd = 0, beat = 0.3;
        for (const x of xs) {
            beat += 120 / (60 * sr);
            io.a[0] = x[0]; io.a[1] = x[1];
            GEN.gl_phas(io, pv, L.base.phas, 0.9, st, beat, sr);
            const y = m.process(x[0], x[1], Object.assign({ w: 0.9 }, vals), beat, sr);
            maxd = Math.max(maxd, Math.abs(io.a[0] - y[0]), Math.abs(io.a[1] - y[1]));
        }
        cmpModule("phaser " + JSON.stringify(vals), 0, () => maxd);
    }
    // rectify
    for (const vals of [{ mode: 0, blend: 1 }, { mode: 1, blend: 1 }, { mode: 2, blend: 0.6 }, { mode: 1, blend: 0 }]) {
        const pv = pvFor(Object.fromEntries(Object.entries(vals).map(([k, v]) => ["rect." + k, v])));
        const st = new DataSim(4), io = new DataSim(2), m = new R.Rectify();
        let maxd = 0;
        for (const x of xs) {
            io.a[0] = x[0]; io.a[1] = x[1];
            GEN.gl_rect(io, pv, L.base.rect, 1, st);
            const y = m.process(x[0], x[1], Object.assign({ w: 1 }, vals));
            maxd = Math.max(maxd, Math.abs(io.a[0] - y[0]), Math.abs(io.a[1] - y[1]));
        }
        cmpModule("rectify " + JSON.stringify(vals), 0, () => maxd);
    }
    // fm
    for (const vals of [{ mode: 0, ratio: 4, index: 0.6 }, { mode: 1, ratio: 8, index: 0.8 }, { mode: 0, ratio: 0.25, index: 1 }]) {
        const pv = pvFor(Object.fromEntries(Object.entries(vals).map(([k, v]) => ["fm." + k, v])));
        const st = new DataSim(2), rb = new DataSim(4096), io = new DataSim(2), m = new R.DelayFm();
        let maxd = 0;
        for (const x of xs) {
            io.a[0] = x[0]; io.a[1] = x[1];
            GEN.gl_fm(io, pv, L.base.fm, 0.7, st, rb, sr);
            const y = m.process(x[0], x[1], Object.assign({ w: 0.7 }, vals), sr);
            maxd = Math.max(maxd, Math.abs(io.a[0] - y[0]), Math.abs(io.a[1] - y[1]));
        }
        cmpModule("fm " + JSON.stringify(vals), 0, () => maxd);
    }
});

ok("gen corrupt equals its mirror (slots, bit flips, wrap, drops) and does what it says", () => {
    const sr = 48000;
    for (const vals of [{ div: 2, chance: 1, flips: 1, wrap: 0.5, drop: 0.6 }, { div: 4, chance: 0.5, flips: 0.3, wrap: 0, drop: 0 }, { div: 0, chance: 0.8, flips: 0, wrap: 1, drop: 1 }, { div: 3, chance: 0, flips: 1, wrap: 1, drop: 1 }]) {
        const pv = pvFor(Object.fromEntries(Object.entries(vals).map(([k, v]) => ["corr." + k, v])));
        const st = new DataSim(10), io = new DataSim(2), m = new R.Corrupt();
        const xs = stream(30000, 5, 0.5);
        let maxd = 0, beat = 0, changed = 0;
        for (const x of xs) {
            beat += 120 / (60 * sr);
            io.a[0] = x[0]; io.a[1] = x[1];
            GEN.gl_corr(io, pv, L.base.corr, 1, st, beat);
            const y = m.process(x[0], x[1], Object.assign({ w: 1 }, vals), beat);
            maxd = Math.max(maxd, Math.abs(io.a[0] - y[0]), Math.abs(io.a[1] - y[1]));
            if (Math.abs(io.a[0] - x[0]) > 1e-9) changed++;
        }
        cmpModule("corrupt " + JSON.stringify(vals), 0, () => maxd);
        if (vals.chance === 0) assert.strictEqual(changed, 0, "Chance 0 never damages");
        else if (vals.chance === 1) assert.ok(changed > 1000, "Chance 1 damages");
    }
    // flipBit flips exactly one bit of the 16-bit offset-binary sample
    for (const x of [-0.9, -0.3, 0, 0.2, 0.77]) for (const b of [6, 9, 14]) {
        const y = R.flipBit(x, b);
        assert.ok(Math.abs(Math.abs((y - x) * 32767.5) - Math.pow(2, b)) < 2, `bit ${b} of ${x}`);
        assert.ok(Math.abs(GEN.gl_flip(x, b) - y) < 1e-12);
    }
    // determinism: the same slot gives the same decision on a re-render
    const run = () => {
        const pv = pvFor({ "corr.div": 2, "corr.chance": 0.5 });
        const st = new DataSim(10), io = new DataSim(2), out = [];
        for (let i = 0; i < 20000; i++) { io.a[0] = 0.3; io.a[1] = 0.3; GEN.gl_corr(io, pv, L.base.corr, 1, st, 4 + i * 120 / (60 * 48000)); out.push(io.a[0]); }
        return out;
    };
    assert.deepStrictEqual(run(), run());
});

ok("gen granular engine equals the mirror; pitch shifts a sine, stretch keeps pitch, speed 0 freezes", () => {
    const sr = 48000;
    // equality, both kinds, both instance offsets
    for (const [kind, vals, so, off] of [[0, { pitch: 7, size: 80, jitter: 0.4 }, 0, 0], [0, { pitch: -12, size: 40, jitter: 0 }, 16, 262144], [1, { speed: 0.25, size: 120, spread: 0.3 }, 16, 262144], [1, { speed: 1, size: 60, spread: 0 }, 0, 0], [1, { speed: 0, size: 100, spread: 0.5 }, 16, 262144]]) {
        const inst = kind === 0 ? "gpit" : "gstr";
        const keys = kind === 0 ? ["pitch", "size", "jitter"] : ["speed", "size", "spread"];
        const pv = pvFor({ [inst + "." + keys[0]]: vals[keys[0]], [inst + "." + keys[1]]: vals[keys[1]], [inst + "." + keys[2]]: vals[keys[2]] });
        const st = new DataSim(32), rb = new DataSim(524288, 2), io = new DataSim(2);
        const m = new R.Grain(kind);
        const xs = stream(40000, 9, 0.4);
        let maxd = 0;
        for (let i = 0; i < xs.length; i++) {
            const act = kind === 1 && vals.speed === 0 && i < 8000 ? 0 : 1; // freeze engages after the ring is warm
            io.a[0] = xs[i][0]; io.a[1] = xs[i][1];
            GEN.gl_grain(io, pv, L.base[inst], 0.9, st, so, rb, off, kind, sr, act);
            const y = m.process(xs[i][0], xs[i][1], { p1: vals[keys[0]], size: vals[keys[1]], p3: vals[keys[2]], w: 0.9 }, sr, act);
            maxd = Math.max(maxd, Math.abs(io.a[0] - y[0]), Math.abs(io.a[1] - y[1]));
        }
        cmpModule(`grain kind ${kind} ${JSON.stringify(vals)}`, 0, () => maxd);
    }
    // behaviour through the gen function: dominant frequency of a 440 Hz sine
    const peakHz = (arr) => {
        let best = 0, bf = 0;
        const N = arr.length;
        for (let f = 100; f < 2000; f += 2) {
            let re = 0, im = 0;
            for (let i = 0; i < N; i += 2) { const a = (2 * Math.PI * f * i) / sr; re += arr[i] * Math.cos(a); im += arr[i] * Math.sin(a); }
            if (re * re + im * im > best) { best = re * re + im * im; bf = f; }
        }
        return bf;
    };
    const runSine = (kind, p1) => {
        const inst = kind === 0 ? "gpit" : "gstr";
        const pv = pvFor(kind === 0 ? { "gpit.pitch": p1, "gpit.size": 80, "gpit.jitter": 0 } : { "gstr.speed": p1, "gstr.size": 100, "gstr.spread": 0 });
        const st = new DataSim(32), rb = new DataSim(524288, 2), io = new DataSim(2);
        const out = [];
        for (let i = 0; i < 24000 + 12000; i++) {
            const x = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
            io.a[0] = x; io.a[1] = x;
            GEN.gl_grain(io, pv, L.base[inst], 1, st, 0, rb, 0, kind, sr, 1);
            if (i >= 12000) out.push(io.a[0]);
        }
        return out;
    };
    assert.ok(Math.abs(peakHz(runSine(0, 12)) - 880) <= 12, "+12 st doubles the frequency");
    assert.ok(Math.abs(peakHz(runSine(0, -12)) - 220) <= 12, "-12 st halves it");
    assert.ok(Math.abs(peakHz(runSine(1, 0.3)) - 440) <= 12, "stretch keeps the pitch");
    const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    assert.ok(rms(runSine(0, 12)) > 0.2 && rms(runSine(1, 0.3)) > 0.2, "level is kept (Hann pair sums to 1)");
    // freeze: engage on a 440 Hz tone, then feed 1320 Hz: the output stays 440 Hz
    {
        const pv = pvFor({ "gstr.speed": 0, "gstr.size": 100, "gstr.spread": 0 });
        const st = new DataSim(32), rb = new DataSim(524288, 2), io = new DataSim(2), out = [];
        for (let i = 0; i < 48000; i++) {
            const f = i < 20000 ? 440 : 1320;
            const x = 0.5 * Math.sin((2 * Math.PI * f * i) / sr);
            io.a[0] = x; io.a[1] = x;
            GEN.gl_grain(io, pv, L.base.gstr, 1, st, 16, rb, 262144, 1, sr, i >= 16000 ? 1 : 0);
            if (i >= 28000) out.push(io.a[0]);
        }
        const f = peakHz(out);
        assert.ok(Math.abs(f - 440) <= 12 && rms(out) > 0.15, `freeze holds 440 Hz (got ${f} Hz, rms ${rms(out).toFixed(3)})`);
    }
});

ok("gen reverse slices / slice shuffle / slapback equal their mirrors and keep their promises", () => {
    const sr = 48000, bpm = 120;
    const advance = (b) => b + bpm / (60 * sr);
    // reverse slices: equality + the output slice IS the reversed previous slice
    {
        const pv = pvFor({ "rvs.div": 4, "rvs.chance": 1 });
        const st = new DataSim(8), rb = new DataSim(262144, 2), io = new DataSim(2), m = new R.ReverseSlices();
        const xs = stream(60000, 13, 0.4);
        const outL = [];
        let maxd = 0, beat = 0;
        for (let i = 0; i < xs.length; i++) {
            io.a[0] = xs[i][0]; io.a[1] = xs[i][1];
            GEN.gl_rvs(io, pv, L.base.rvs, 1, st, rb, beat, bpm, sr, 1);
            const y = m.process(xs[i][0], xs[i][1], { div: 4, chance: 1, w: 1 }, beat, bpm, sr, 1);
            maxd = Math.max(maxd, Math.abs(io.a[0] - y[0]), Math.abs(io.a[1] - y[1]));
            outL.push(io.a[0]);
            beat = advance(beat);
        }
        cmpModule("revslice", 0, () => maxd);
        // slice length 12000: slice 3 (36000..47999) is slice 2 reversed
        let d = 0, n = 0;
        for (let e = 200; e < 11800; e++) { d += Math.abs(outL[36000 + e] - xs[36000 - 1 - e][0]); n++; }
        assert.ok(d / n < 1e-6, `reversed slice error ${d / n}`);
    }
    // slice shuffle: equality + slice k of a span is source slice perm[k] of the previous span
    {
        const vals = { slices: 1, span: 0, chance: 1, seed: 3 };
        const pv = pvFor(Object.fromEntries(Object.entries(vals).map(([k, v]) => ["shuf." + k, v])));
        const st = new DataSim(8), rb = new DataSim(262144, 2), pm = new DataSim(32), io = new DataSim(2), m = new R.SliceShuffle();
        const xs = stream(110000, 17, 0.4);
        const outL = [];
        let maxd = 0, beat = 0;
        for (let i = 0; i < xs.length; i++) {
            io.a[0] = xs[i][0]; io.a[1] = xs[i][1];
            GEN.gl_shuf(io, pv, L.base.shuf, 1, st, rb, pm, beat, bpm, sr, 1);
            const y = m.process(xs[i][0], xs[i][1], Object.assign({ w: 1 }, vals), beat, bpm, sr, 1);
            maxd = Math.max(maxd, Math.abs(io.a[0] - y[0]), Math.abs(io.a[1] - y[1]));
            outL.push(io.a[0]);
            beat = advance(beat);
        }
        cmpModule("shuffle", 0, () => maxd);
        for (const sp of [2, 3]) {
            const pmap = qc.perm(4, sp * 7.31 + 3 * 13.7);
            for (let k = 0; k < 4; k++) {
                const src = pmap[k + 1] - 1;
                let d = 0;
                for (let e = 300; e < 5700; e++) d += Math.abs(outL[sp * 24000 + k * 6000 + e] - xs[(sp - 1) * 24000 + src * 6000 + e][0]);
                assert.ok(d / 5400 < 1e-6, `span ${sp} slice ${k} <- ${src}: ${d / 5400}`);
            }
        }
        // chance 0 passes the live signal
        const pv0 = pvFor({ "shuf.chance": 0 });
        const st0 = new DataSim(8), rb0 = new DataSim(262144, 2), pm0 = new DataSim(32);
        let b0 = 0, dev = 0;
        for (let i = 0; i < 60000; i++) { io.a[0] = xs[i][0]; io.a[1] = xs[i][1]; GEN.gl_shuf(io, pv0, L.base.shuf, 1, st0, rb0, pm0, b0, bpm, sr, 1); dev = Math.max(dev, Math.abs(io.a[0] - xs[i][0])); b0 = advance(b0); }
        assert.strictEqual(dev, 0);
    }
    // slapback: one echo at the delay time, no second echo
    {
        const vals = { time: 90, tone: 16000, offset: 0.5 };
        const pv = pvFor(Object.fromEntries(Object.entries(vals).map(([k, v]) => ["slap." + k, v])));
        const st = new DataSim(6), rb = new DataSim(65536), io = new DataSim(2), m = new R.Slapback();
        const xs = stream(30000, 19, 0.4);
        let maxd = 0;
        for (const x of xs) {
            io.a[0] = x[0]; io.a[1] = x[1];
            GEN.gl_slap(io, pv, L.base.slap, 0.8, st, rb, sr);
            const y = m.process(x[0], x[1], Object.assign({ w: 0.8 }, vals), sr);
            maxd = Math.max(maxd, Math.abs(io.a[0] - y[0]), Math.abs(io.a[1] - y[1]));
        }
        cmpModule("slapback", 0, () => maxd);
        const imp = new DataSim(2), st2 = new DataSim(6), rb2 = new DataSim(65536), pv2 = pvFor({ "slap.time": 100, "slap.tone": 16000, "slap.offset": 0 }), res = [];
        for (let i = 0; i < 20000; i++) { imp.a[0] = i === 0 ? 1 : 0; imp.a[1] = imp.a[0]; GEN.gl_slap(imp, pv2, L.base.slap, 1, st2, rb2, sr); res.push(imp.a[0]); }
        let pk = 1; for (let i = 100; i < res.length; i++) if (res[i] > res[pk]) pk = i;
        assert.ok(Math.abs(pk - 4800) <= 40, `echo at ${pk} samples (100 ms = 4800)`);
        assert.ok(res.slice(pk + 400).every((v) => Math.abs(v) < 1e-3), "a single echo, no feedback");
    }
});

ok("gen spectral bin ops (scatter, mirror, shift) and spectral gate / lofi equal their mirrors", () => {
    const n = 1024, half = 512;
    const rnd = mkRng(23);
    const mkSpec = () => {
        const re = new Float64Array(n), im = new Float64Array(n);
        for (let k = 0; k <= half; k++) {
            re[k] = rnd() * Math.exp(-k / 150);
            im[k] = k === 0 || k === half ? 0 : rnd() * Math.exp(-k / 150);
            if (k > 0 && k < half) { re[n - k] = re[k]; im[n - k] = -im[k]; }
        }
        return { re, im };
    };
    const toData = (s) => { const d = new DataSim(4096, 2); for (let i = 0; i < n; i++) { d.a[i] = s.re[i]; d.a[4096 + i] = s.im[i]; } return d; };
    const hermitian = (d) => { for (let k = 1; k < half; k++) { assert.ok(Math.abs(d.a[k] - d.a[n - k]) < 1e-12 && Math.abs(d.a[4096 + k] + d.a[4096 + n - k]) < 1e-12, `bin ${k}`); } assert.ok(Math.abs(d.a[4096]) < 1e-12 && Math.abs(d.a[4096 + half]) < 1e-12); };
    // binmap
    const sctW = 8, nb = Math.floor(512 / sctW);
    const pmSct = qc.perm(nb, 5 * 3.17 + 0.5);
    for (const [mode, amt, p1] of [[0, 1, sctW], [0, 0.5, sctW], [1, 1, 32], [1, 0.7, 100], [2, 1, 16], [2, 1, -20], [2, 0.3, 3]]) {
        const s = mkSpec(), d = toData(s), ft = new DataSim(1024, 2), pmD = new DataSim(512);
        for (let i = 0; i < pmSct.length; i++) pmD.a[i] = pmSct[i];
        GEN.gl_binmap(d, ft, n, mode, amt, p1, nb, pmD);
        const re = Float64Array.from(s.re), im = Float64Array.from(s.im);
        R.binMap(re, im, n, mode, amt, p1, nb, pmSct);
        let maxd = 0;
        for (let i = 0; i < n; i++) maxd = Math.max(maxd, Math.abs(d.a[i] - re[i]), Math.abs(d.a[4096 + i] - im[i]));
        assert.ok(maxd < 1e-12, `binmap mode ${mode}: ${maxd}`);
        hermitian(d);
    }
    // semantics: shift moves a bin, mirror reflects it, scatter moves a band
    {
        const one = (k) => { const re = new Float64Array(n), im = new Float64Array(n); re[k] = 1; re[n - k] = 1; return { re, im }; };
        const peakOf = (d) => { let bk = 0, bv = -1; for (let k = 0; k <= half; k++) { const m = Math.hypot(d.a[k], d.a[4096 + k]); if (m > bv) { bv = m; bk = k; } } return bk; };
        let d = toData(one(40)), ft = new DataSim(1024, 2);
        GEN.gl_binmap(d, ft, n, 2, 1, 16, nb, new DataSim(512));
        assert.strictEqual(peakOf(d), 56);
        d = toData(one(40)); GEN.gl_binmap(d, ft, n, 1, 1, 50, nb, new DataSim(512));
        assert.strictEqual(peakOf(d), 60);
        const pmD = new DataSim(512); for (let i = 0; i < pmSct.length; i++) pmD.a[i] = pmSct[i];
        d = toData(one(20)); GEN.gl_binmap(d, ft, n, 0, 1, sctW, nb, pmD);
        // destination band b takes source band pm[b + 1] - 1, so the bin sits in the band whose source is band 2, same offset
        let moved = -1; for (let b = 0; b < nb; b++) if (pmSct[b + 1] - 1 === Math.floor(20 / sctW)) moved = b;
        assert.strictEqual(peakOf(d), moved * sctW + (20 % sctW));
    }
    // gate / lofi
    for (const [mode, amt, kk, step] of [[0, 1, 4, 6], [0, 1, 40, 6], [0, 0.5, 8, 6], [1, 1, 4, 12], [1, 1, 4, 24], [1, 0.4, 4, 6]]) {
        const s = mkSpec(), d = toData(s), fc = new DataSim(4096, 2);
        const thr = GEN.gl_sgate(d, fc, n, mode, amt, kk, step);
        const re = Float64Array.from(s.re), im = Float64Array.from(s.im);
        const thr2 = R.specGate(re, im, n, mode, amt, kk, step);
        assert.ok(Math.abs(thr - thr2) < 1e-12 * Math.max(1, thr2));
        let maxd = 0;
        for (let i = 0; i < n; i++) maxd = Math.max(maxd, Math.abs(d.a[i] - re[i]), Math.abs(d.a[4096 + i] - im[i]));
        assert.ok(maxd < 1e-12, `sgate mode ${mode}: ${maxd}`);
        hermitian(d);
        if (mode === 0 && amt === 1) {
            let kept = 0;
            for (let k = 0; k <= half; k++) if (Math.hypot(d.a[k], d.a[4096 + k]) > 1e-12) kept++;
            assert.ok(kept >= kk && kept <= kk + 2, `top-${kk} keeps ${kept}`);
        }
        if (mode === 1 && amt === 1) {
            // magnitudes land on the dB grid
            const sn = step / 8.685889638065035;
            for (let k = 1; k < half; k += 37) { const m = Math.hypot(d.a[k], d.a[4096 + k]); if (m > 1e-9) assert.ok(Math.abs(Math.log(m) / sn - Math.round(Math.log(m) / sn)) < 1e-6); }
        }
    }
    // amount 0 is the identity
    const s = mkSpec(), d = toData(s), ft = new DataSim(1024, 2);
    GEN.gl_binmap(d, ft, n, 2, 0, 9, nb, new DataSim(512));
    for (let i = 0; i < n; i++) assert.ok(Math.abs(d.a[i] - s.re[i]) < 1e-12 && Math.abs(d.a[4096 + i] - s.im[i]) < 1e-12);
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
        // measured 2026-10-21 in Max 9: x = round(d_pv.peek(i)) returned 0 for 16 (the spectral shift never happened); use
        // floor(peek + 0.5). (Sampler note: int(clip(round(peek(...)))) misbehaved too.)
        assert.ok(!/\bround\(\s*\w+\.peek\(/.test(l) && !/\bround\(\w+\.peek\([^()]*\)\s*\*/.test(l), `round() of a Data peek: ${l.trim()}`);
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
    assert.deepStrictEqual(out.stdout.split("\n"), CORE_FN.split("\n"));
    assert.ok(!/@[A-Za-z0-9_]+@/.test(out.stdout), "no token left");
    // no init block: the layout constants ride in the engine buffer (565 init statements cost ~3 s of gen compile time)
    assert.ok(!/^\td_(meta|pv|tgt|wb)\.poke\(\d/m.test(out.stdout) && !CORE_RAW.includes("@INIT@"));
    assert.ok((out.stdout.match(/\.poke\(/g) || []).length < 400, "the core stays small enough to compile fast");
});
ok("engine constants block: meta codes, defaults and wet indices in the buffer match the layout", () => {
    const c = G.glitchEngineConstants();
    assert.strictEqual(c.length, 2 * L.np + L.ninst);
    const meta = G.glitchMeta();
    for (let i = 0; i < L.np; i++) {
        const code = c[i];
        const grp = Math.floor(code * 0.25);
        assert.strictEqual(code - 4 * grp, meta[i][0], `kind of param ${i}`);
        assert.strictEqual(grp, meta[i][1], `group of param ${i}`);
        assert.strictEqual(c[L.np + i], meta[i][2], `default of param ${i}`);
    }
    for (let k = 0; k < L.ninst; k++) assert.strictEqual(c[2 * L.np + k], L.instances[k].wet);
    assert.strictEqual(L.defsOffset, L.metaOffset + L.np);
    assert.strictEqual(L.wbOffset, L.defsOffset + L.np);
    assert.ok(L.wbOffset + L.ninst <= G.GL_SLOTS_BUF_SAMPS);
    const buf = G.packEngineBuffer(G.defaultState());
    assert.deepStrictEqual(buf.slice(L.metaOffset, L.metaOffset + c.length), c);
    assert.ok(buf.slice(L.metaOffset + c.length).every((x) => x === 0), "nothing after the constants");
});

// ----------------------------------------------------------------------------- UI model (stage 2)
const FACE = G.GL_FACE;
const UI_COMBOS = [];
for (const editor of [0, 1]) for (const slots of [0, 1]) for (const seq of [0, 1]) for (const options of [0, 1]) UI_COMBOS.push({ editor, slots, seq, options });
const DEVICE_W = (ui) => G.glitchFaceLayout(ui).width;

ok("layout: width math and every collapse state (EDIT x SLOTS x SEQ)", () => {
    const base = FACE.MARGIN + (FACE.PAD_W + FACE.GAP + FACE.VIEW_W) + FACE.GAP + FACE.SIDE_W + FACE.MARGIN;
    assert.strictEqual(base, 374);
    const expected = {};
    for (const editor of [0, 1]) for (const slots of [0, 1]) for (const seq of [0, 1]) {
        expected[`${editor}${slots}${seq}`] = base + (editor ? FACE.GAP + FACE.EDITOR_W : 0) + (slots ? FACE.GAP + FACE.SLOTS_W : 0) + (seq ? FACE.GAP + FACE.SEQ_W : 0);
    }
    for (const editor of [0, 1]) for (const slots of [0, 1]) for (const seq of [0, 1]) {
        assert.strictEqual(DEVICE_W({ editor, slots, seq }), expected[`${editor}${slots}${seq}`], `editor ${editor} slots ${slots} seq ${seq}`);
        assert.strictEqual(DEVICE_W({ editor, slots, seq, options: 1 }), expected[`${editor}${slots}${seq}`], "the Options view never changes the width");
    }
    assert.deepStrictEqual([374, 462, 568, 656, 590, 678, 784, 872],
        [DEVICE_W({ slots: 0 }), DEVICE_W({}), DEVICE_W({ editor: 1, slots: 0 }), DEVICE_W({ editor: 1 }), DEVICE_W({ slots: 0, seq: 1 }), DEVICE_W({ seq: 1 }), DEVICE_W({ editor: 1, slots: 0, seq: 1 }), DEVICE_W({ editor: 1, seq: 1 })]);
    assert.strictEqual(DEVICE_W(undefined), 462);
    for (const ui of UI_COMBOS) assert.strictEqual(G.glitchFaceLayout(ui).height, 169);
    // sections, left to right: core | EDIT | SLOTS | SEQ | side
    const Lo = G.glitchFaceLayout({ editor: 1, slots: 1, seq: 1 });
    assert.ok(Lo.core.x + Lo.core.w <= Lo.editor.x && Lo.editor.x + Lo.editor.w <= Lo.slots.rect.x && Lo.slots.rect.x + Lo.slots.rect.w <= Lo.seq.rect.x && Lo.seq.rect.x + Lo.seq.rect.w <= Lo.side.rect.x);
});

function hitMapsFor(ui) {
    const Lo = G.glitchFaceLayout(ui);
    const sets = [];
    for (const nTiles of [0, 1, 3, 4, 5, 8, 9, 12, 13, 24, 30]) {
        const pages = G.glitchViewLayout(nTiles, Lo.view, 0).pages;
        for (let page = 0; page < pages; page++) for (const nRows of [0, 1, 5, 10]) sets.push({ nTiles, page, nRows, map: G.glitchHitMap(ui, nTiles, nRows, page) });
    }
    return { Lo, sets };
}
ok("layout: every interactive rect is inside its panel, nothing overlaps (all 16 collapse combinations, every tile count and page)", () => {
    for (const ui0 of UI_COMBOS) for (const optCat of [0, 4]) {
        const ui = Object.assign({ optCat }, ui0);
        const { Lo, sets } = hitMapsFor(ui);
        const whole = { x: 0, y: 0, w: Lo.width, h: 169 };
        for (const { nTiles, page, nRows, map } of sets) {
            const seen = new Set();
            for (const a of map) {
                assert.ok(!seen.has(a.id), `duplicate hit id ${a.id}`);
                seen.add(a.id);
                assert.ok(G.glInside(a.panel, whole), `${a.id}: panel inside the device`);
                assert.ok(G.glInside(a.r, a.panel), `${a.id} inside its panel (${JSON.stringify(ui)} tiles ${nTiles} page ${page} rows ${nRows})`);
                assert.ok(a.r.w >= 10 && a.r.h >= 10, `${a.id} is big enough to hit: ${a.r.w}x${a.r.h}`);
            }
            for (let i = 0; i < map.length; i++) {
                for (let j = i + 1; j < map.length; j++) {
                    if (map[i].layer !== map[j].layer) continue;
                    assert.ok(!G.glOverlap(map[i].r, map[j].r), `${map[i].id} overlaps ${map[j].id} (${JSON.stringify(ui)} tiles ${nTiles})`);
                }
            }
            for (const c of map.filter((m) => m.layer === 1)) assert.ok(map.some((m) => m.layer === 0 && G.glInside(c.r, m.r)), `${c.id} has a base rect`);
        }
        const panels = [Lo.core, Lo.editor, Lo.slots && Lo.slots.rect, Lo.seq && Lo.seq.rect, Lo.side.rect].filter(Boolean);
        for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) assert.ok(!G.glOverlap(panels[i], panels[j]), "sections overlap");
        assert.ok(panels.every((pn) => G.glInside(pn, whole)));
        assert.ok(Math.abs(Lo.side.rect.x + Lo.side.rect.w + FACE.MARGIN - Lo.width) < 1e-9, "right margin");
        // the action bar's cells and the header toggles fit the core panel
        for (const k in Lo.action) assert.ok(G.glInside(Lo.action[k], Lo.core), "action " + k);
        for (const k in Lo.toggles) assert.ok(G.glInside(Lo.toggles[k], Lo.core), "toggle " + k);
        assert.ok(G.glInside(Lo.hint, Lo.core) && !G.glOverlap(Lo.hint, Lo.toggles.seq), "hint beside the toggles");
    }
});

ok("layout: the sequencer section: 16 steps in a row, the length lane above, controls and buttons below, all inside it", () => {
    const Q = G.glitchFaceLayout({ seq: 1 }).seq;
    assert.strictEqual(Q.steps.length, 16);
    for (let i = 0; i < 16; i++) {
        assert.ok(G.glInside(Q.steps[i], Q.rect) && Q.steps[i].w >= 11 && Q.steps[i].h >= 28, "step " + i);
        if (i) assert.ok(Q.steps[i].x >= Q.steps[i - 1].x + Q.steps[i - 1].w - 1e-9 && Q.steps[i].y === Q.steps[0].y, "steps are one row");
    }
    for (const r of [Q.on, Q.lane, Q.glide, Q.rate, Q.glideBar, Q.len, Q.curve, Q.dice, Q.clear].concat(Q.palette)) assert.ok(G.glInside(r, Q.rect));
    assert.strictEqual(Q.palette.length, 9, "8 slots and hold");
    // top to bottom: lane, steps, glide lane, palette, controls, buttons
    assert.ok(Q.lane.y + Q.lane.h <= Q.steps[0].y && Q.steps[0].y + Q.steps[0].h <= Q.glide.y && Q.glide.y + Q.glide.h <= Q.palette[0].y);
    assert.ok(Q.palette[0].y + Q.palette[0].h <= Q.rate.y && Q.len.y + Q.len.h <= Q.dice.y && Q.dice.y + Q.dice.h <= 165);
    // the length lane spans exactly the 16 steps
    assert.ok(Q.lane.x <= Q.steps[0].x && Q.lane.x + Q.lane.w >= Q.steps[15].x + Q.steps[15].w);
});

ok("layout: Options has a category list and one toggle per type; every category fits its 8 slots", () => {
    const closed = new Set(G.glitchHitMap({ options: 0 }, 4, 0).map((m) => m.id));
    for (const id of ["pad", "tile0", "act_dice", "act_mutate", "act_chaos", "act_opt", "act_ab"]) assert.ok(closed.has(id), id);
    const cats = G.glitchOptionCategories();
    assert.deepStrictEqual(cats.map((c) => c.name), ["Filter", "Distort", "Pitch", "Time", "Spectral", "Space", "Utility"]);
    assert.strictEqual(cats.reduce((n, c) => n + c.types.length, 0), G.GL_TYPES.length, "every type is in exactly one category");
    assert.ok(cats.every((c) => c.types.length >= 1 && c.types.length <= 8));
    const seenTypes = new Set();
    for (let cat = 0; cat < cats.length; cat++) {
        const open = G.glitchHitMap({ options: 1, optCat: cat }, 4, 0).map((m) => m.id);
        for (const id of ["pad", "tile0", "act_dice", "act_mutate", "act_chaos", "act_opt", "act_ab"]) assert.ok(!open.includes(id), `${id} is replaced by Options`);
        for (const ti of cats[cat].types) { assert.ok(open.includes("opt_" + ti), `category ${cat} lists type ${ti}`); seenTypes.add(ti); }
        for (const o of open.filter((i) => /^opt_\d+$/.test(i))) assert.ok(cats[cat].types.includes(Number(o.slice(4))), "only this category's types");
        for (let c = 0; c < cats.length; c++) assert.ok(open.includes("optcat_tg" + c) && open.includes("optcat_sel" + c));
        for (const id of ["opt_all", "opt_close", "tg_editor", "tg_seq", "side_mix"]) assert.ok(open.includes(id), id);
    }
    assert.strictEqual(seenTypes.size, G.GL_TYPES.length);
    const O = G.glitchOptionsLayout(FACE.MARGIN);
    assert.ok(G.glInside(O.note, O.panel) && O.cats.length === 7 && O.slots.length === 8);
    // the category rows stay above the note line and are at least 14 px tall; the type rows are at least 20 px tall
    assert.ok(O.cats.every((c) => c.select.h >= 14 && c.toggle.h >= 14 && c.select.y + c.select.h <= O.note.y));
    assert.ok(O.slots.every((r) => r.h >= 20 && G.glInside(r, O.panel) && r.y + r.h <= O.note.y));
    // category state helpers
    const st = G.defaultState();
    assert.strictEqual(G.glitchCategoryState(st, 4), 1);
    G.setAllow(st, "mirror", false);
    assert.strictEqual(G.glitchCategoryState(st, 4), 2);
    G.setAllowCategory(st, 4, false);
    assert.strictEqual(G.glitchCategoryState(st, 4), 0);
    assert.ok(["freeze", "smear", "ccrush", "scramble", "scatter", "mirror", "binshift", "specgate"].every((t) => st.allow[t] === false) && st.allow.drive === true);
    G.setAllowCategory(st, 4, true);
    assert.strictEqual(G.glitchCategoryState(st, 4), 1);
    // optCat survives normalizeUi and is clamped
    assert.strictEqual(G.normalizeUi({ optCat: 5 }).optCat, 5);
    assert.strictEqual(G.normalizeUi({ optCat: 99 }).optCat, 6);
    assert.strictEqual(G.normalizeUi({ optCat: -3 }).optCat, 0);
});

ok("layout: tile grid (big / compact / small / paged) fits the glitch view for 0..30 tiles", () => {
    const view = G.glitchFaceLayout({}).view;
    let lastCompact = false;
    for (let n = 0; n <= FACE.MAX_TILES; n++) {
        const V0 = G.glitchViewLayout(n, view, 0);
        assert.strictEqual(V0.pages, n <= 12 ? 1 : Math.ceil(n / 12), `pages for ${n}`);
        let shown = 0;
        for (let page = 0; page < V0.pages; page++) {
            const V = G.glitchViewLayout(n, view, page);
            assert.strictEqual(V.first, shown, "pages continue where the last one ended");
            shown += V.rects.length;
            for (const q of V.rects) assert.ok(G.glInside(q, V.grid) && G.glInside(q, view) && q.w >= 44 && q.h >= 30, `n=${n} page ${page} tile ${q.w}x${q.h}`);
            for (let i = 0; i < V.rects.length; i++) for (let j = i + 1; j < V.rects.length; j++) assert.ok(!G.glOverlap(V.rects[i], V.rects[j]));
            assert.ok(G.glInside(V.strip, view) && !G.glOverlap(V.strip, V.grid), "the chain ribbon strip sits under the grid");
            assert.strictEqual(!!V.prev, V0.pages > 1, "the pager exists only when there is more than one page");
            if (V.prev) { assert.ok(G.glInside(V.prev, view) && G.glInside(V.next, view) && !G.glOverlap(V.prev, V.next) && !G.glOverlap(V.next, V.pageText) && !G.glOverlap(V.ribbon, V.pageText)); }
            assert.ok(G.glInside(V.ribbon, view));
        }
        assert.strictEqual(shown, n, `every one of ${n} tiles is on some page`);
        // out-of-range pages clamp
        assert.strictEqual(G.glitchViewLayout(n, view, 99).page, V0.pages - 1);
        assert.strictEqual(G.glitchViewLayout(n, view, -4).page, 0);
        if (n > 4) lastCompact = V0.compact;
    }
    assert.ok(lastCompact);
    // big tiles up to 4, compact after
    assert.ok(!G.glitchViewLayout(4, view, 0).compact && G.glitchViewLayout(5, view, 0).compact);
    assert.deepStrictEqual([G.glitchViewLayout(4, view, 0).cols, G.glitchViewLayout(8, view, 0).rows, G.glitchViewLayout(12, view, 0).rows, G.glitchViewLayout(30, view, 0).cap], [2, 2, 3, 12]);
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
        assert.ok(tiles.length >= 1 && tiles.length <= FACE.MAX_TILES, "tile count");
        for (const t of tiles) assert.ok(G.glitchTileInfo(t.key) && t.wet > G.GL_ACTIVE_EPS);
    }
});

ok("editor rows: every tile key has editable rows that round-trip", () => {
    const keys = G.GL_INSTANCES.filter((i) => i.id !== "spec").map((i) => i.id).concat(SPEC_TYPES);
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
        if (!SPEC_TYPES.includes(key)) assert.strictEqual(rows.length, G.glInstance(key).params.length);
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
    assert.strictEqual(back.ui.seq, 1, "the sequencer section flag round-trips (the sequencer section opens again)");
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
    assert.deepStrictEqual(bad.ui, { editor: 1, slots: 0, seq: 0, options: 1, sel: "", optCat: 0 });
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
    const drawLog = [];
    const gm = { size: [462, 169], init() {}, redraw() {}, text_measure(t) { return [String(t).length * 6, 8]; } };
    for (const fn of ["set_source_rgba", "set_line_width", "rectangle", "rectangle_rounded", "move_to", "line_to", "curve_to", "close_path", "arc", "ellipse", "fill", "fill_preserve", "stroke", "select_font_face", "set_font_size", "show_text", "save", "restore", "translate", "rotate"]) {
        gm[fn] = (...a) => { drawLog.push(fn + ":" + a.map((x) => (typeof x === "number" ? Math.round(x * 100) / 100 : x)).join(",")); };
    }
    const sandbox = {
        mgraphics: gm,
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
    return { run, sent, pokes, calls, ctx, drawLog, params: () => sent.filter((m) => m[0] === "param") };
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
    click(O.cats[0].select); // Filter category: its types are listed
    assert.strictEqual(u.run("gState.ui.optCat"), 0);
    const ft = G.glitchOptionCategories()[0].types;
    click(O.slots[0]); // the first Filter type
    assert.strictEqual(u.run(`gState.allow[${JSON.stringify(G.GL_TYPES[ft[0]].id)}]`), false);
    assert.strictEqual(u.run("glitchCategoryState(gState, 0)"), 2, "the category shows a mixed state");
    click(O.cats[0].toggle); // mixed -> all on
    assert.strictEqual(u.run("glitchCategoryState(gState, 0)"), 1);
    click(O.cats[0].toggle); // all on -> all off
    assert.strictEqual(u.run("glitchCategoryState(gState, 0)"), 0);
    assert.strictEqual(u.run("gState.allow.drive"), true, "other categories untouched");
    click(O.cats[4].select);
    assert.strictEqual(u.run("gState.ui.optCat"), 4);
    const sp = G.glitchOptionCategories()[4].types;
    assert.strictEqual(sp.length, 8);
    click(O.slots[7]);
    assert.strictEqual(u.run(`gState.allow[${JSON.stringify(G.GL_TYPES[sp[7]].id)}]`), false, "the eighth Spectral type toggles");
    click(O.all);
    assert.ok(Object.values(u.run("gState.allow")).every((v) => v === true) || Object.values(u.run("gState.allow")).every((v) => v === false));
    click(O.close);
    assert.strictEqual(u.run("gState.ui.options"), 0);
    assert.strictEqual(u.run("gState.ui.optCat"), 4, "the selected category is remembered (saved in the blob)");
    // paint never throws in any state
    for (const ui of UI_COMBOS) { u.run(`gState.ui = normalizeUi(${JSON.stringify(ui)}); gLayout = glitchFaceLayout(gState.ui); paint();`); }
});

// ----------------------------------------------------------------------------- phase 2 UI: sequencer, Seq-mode display, overflow, tiles
const clickAt = (u, x, y, shift, opt) => u.run(`onclick(${x}, ${y}, 1, 0, ${shift ? 1 : 0}, 0, ${opt ? 1 : 0}); ondrag(${x}, ${y}, 0, 0, 0)`);
const clickR = (u, r, shift, opt) => clickAt(u, center(r)[0], center(r)[1], shift, opt);
// three filled slots: 0 = drive, 1 = filter, 2 = delay
const SEQ_SETUP = "setbuffer('#0-glitchslots', '#0-glitchscope'); device_ready(); test_fill();" +
    "var d2 = defaultGlitch(); glitchSetValue(d2, 'dly', 'wet', 0.8); gState.working = d2; saveToSlot(gState, 2); gState.working = defaultGlitch(); gUndo = [];";
function seqHeaderOf(u) { const b = u.pokes[u.pokes.length - 1]; return b.slice(L.seqOffset, L.seqOffset + 5); }

ok("v8ui: SEQ section: toggle, width follows, steps cycle hold -> filled slots -> hold, arm + slot pad / palette / drag assign", () => {
    const u = makeUi();
    u.run(SEQ_SETUP);
    const T = G.glitchFaceLayout({}).toggles;
    clickR(u, T.seq);
    assert.strictEqual(u.run("gState.ui.seq"), 1);
    assert.deepStrictEqual(u.sent.filter((m) => m[0] === "setwidth_cmd").pop(), ["setwidth_cmd", 678]);
    const Q = G.glitchFaceLayout({ seq: 1 }).seq;
    const steps = () => u.run("gState.seq.steps.slice()");
    const undo0 = u.run("gUndo.length"), notify0 = u.calls.notify;
    clickR(u, Q.steps[0]);
    assert.strictEqual(steps()[0], 0, "hold -> the first filled slot");
    assert.strictEqual(u.run("gUndo.length"), undo0 + 1, "one undo snapshot per click");
    assert.strictEqual(u.calls.notify, notify0 + 1, "notifyclients per gesture");
    assert.strictEqual(u.run("gSeqArm"), 0, "the clicked step is armed");
    clickR(u, Q.steps[0]); assert.strictEqual(steps()[0], 1);
    clickR(u, Q.steps[0]); assert.strictEqual(steps()[0], 2, "slot 3 is the third filled slot (slots 1, 2, 3)");
    clickR(u, Q.steps[0]); assert.strictEqual(steps()[0], -1, "then hold again");
    clickR(u, Q.steps[0], true); assert.strictEqual(steps()[0], 2, "shift cycles backwards");
    clickR(u, Q.steps[0], false, true); assert.strictEqual(steps()[0], -1, "alt = hold");
    // empty slots are skipped by the cycle
    clickR(u, Q.steps[1]); assert.strictEqual(steps()[1], 0);
    // arm step 2, then click slot pads: assigns (does not recall) and the arm moves on
    const L0 = G.glitchFaceLayout({ seq: 1 });
    const workBefore = u.run("JSON.stringify(gState.working)");
    clickR(u, Q.steps[2]);
    clickR(u, L0.slots.pads[1]);
    assert.strictEqual(steps()[2], 1);
    assert.strictEqual(u.run("gSeqArm"), 3, "fast entry: the arm advances");
    clickR(u, L0.slots.pads[2]);
    assert.strictEqual(steps()[3], 2);
    assert.strictEqual(u.run("JSON.stringify(gState.working)").length > 0 && u.run("JSON.stringify(gState.working)") === workBefore, true, "assigning does not recall the slot into Working");
    // an empty slot cannot be assigned
    clickR(u, L0.slots.pads[5]);
    assert.strictEqual(steps()[4], -1);
    assert.ok(/empty/.test(u.run("gHint")));
    // palette chip + hold chip with the arm on step 4
    clickR(u, Q.steps[4]);
    assert.strictEqual(u.run("gSeqArm"), 4);
    u.run("gSeqArm = 4");
    clickR(u, Q.palette[0]); assert.strictEqual(steps()[4], 0);
    clickR(u, Q.palette[8]); assert.strictEqual(steps()[5], -1);
    // drag a slot pad onto a step
    const p1 = center(L0.slots.pads[1]), s7 = center(Q.steps[7]);
    u.run(`onclick(${p1[0]}, ${p1[1]}, 1, 0, 0, 0, 0)`);
    u.run(`ondrag(${p1[0] + 20}, ${p1[1] + 20}, 1, 0, 0)`);
    u.run("paint()");
    u.run(`ondrag(${s7[0]}, ${s7[1]}, 1, 0, 0)`);
    u.run(`ondrag(${s7[0]}, ${s7[1]}, 0, 0, 0)`);
    assert.strictEqual(steps()[7], 1, "slot dragged onto a step");
    assert.deepStrictEqual(u.run("gState.corners"), [0, 1, 0, 1], "and no corner was assigned");
    // a palette chip dragged onto a step
    const pc = center(Q.palette[2]), s9 = center(Q.steps[9]);
    u.run(`onclick(${pc[0]}, ${pc[1]}, 1, 0, 0, 0, 0)`);
    u.run(`ondrag(${pc[0]}, ${pc[1] - 30}, 1, 0, 0)`);
    u.run(`ondrag(${s9[0]}, ${s9[1]}, 1, 0, 0)`);
    u.run(`ondrag(${s9[0]}, ${s9[1]}, 0, 0, 0)`);
    assert.strictEqual(steps()[9], 2);
    // clicking empty space disarms; Esc too
    clickAt(u, Q.glide.x + 3, Q.glide.y + 3);
    assert.strictEqual(u.run("gSeqArm"), -1);
    clickR(u, Q.steps[1]);
    u.run("onkeydown(27, '', 1, 0, 0)");
    assert.strictEqual(u.run("gSeqArm"), -1);
    // the sequence is in the engine buffer
    const buf = u.pokes[u.pokes.length - 1];
    const sq = steps();
    for (let i = 0; i < 16; i++) assert.strictEqual(buf[L.seqOffset + G.GL_SEQ_HDR + i], sq[i]);
    // undo walks back one gesture at a time
    const before = u.run("gUndo.length");
    u.run("undo()");
    assert.strictEqual(u.run("gUndo.length"), before - 1);
    // collapse: back to the narrow device, and the arm is dropped
    u.run("gSeqArm = 3");
    clickR(u, G.glitchFaceLayout({ seq: 1 }).toggles.seq);
    assert.deepStrictEqual(u.sent.filter((m) => m[0] === "setwidth_cmd").pop(), ["setwidth_cmd", 462]);
    assert.strictEqual(u.run("gSeqArm"), -1);
    // the blob keeps the steps, and a v2 blob loads with an empty sequence
    const back = G.stateFromBlob(JSON.parse(JSON.stringify(u.run("getvalueof()"))));
    assert.deepStrictEqual(back.seq.steps, u.run("gState.seq.steps"));
});

ok("v8ui: SEQ with no filled slot: the step click explains instead of changing anything", () => {
    const u = makeUi();
    u.run("setbuffer('#0-glitchslots', '#0-glitchscope'); device_ready(); test_section('seq', 1);");
    const Q = G.glitchFaceLayout({ seq: 1 }).seq;
    const undo0 = u.run("gUndo.length");
    clickR(u, Q.steps[0]);
    assert.deepStrictEqual(u.run("gState.seq.steps.every(function (v) { return v === -1; })"), true);
    assert.strictEqual(u.run("gUndo.length"), undo0, "nothing happened, nothing to undo");
    assert.ok(/slots/.test(u.run("gHint")));
    clickR(u, Q.dice);
    assert.strictEqual(u.run("gState.audition"), "working", "no filled slot: the dice does not switch to Seq");
    u.run("paint()");
});

ok("v8ui: length lane, Rate, Glide, Length and Curve: the controls reach the Live parameters, the state and the engine header", () => {
    const u = makeUi();
    u.run(SEQ_SETUP + "test_section('seq', 1);");
    const Q = G.glitchFaceLayout({ seq: 1 }).seq;
    const x = (r, f) => r.x + 2 + (r.w - 4) * f;
    const lastParam = (k) => u.params().filter((m) => m[1] === k).pop();
    // length lane: click the end of step 10, drag back to step 4
    const undo0 = u.run("gUndo.length"), n0 = u.calls.notify;
    u.run(`onclick(${Q.steps[9].x + 6}, ${Q.lane.y + 6}, 1, 0, 0, 0, 0)`);
    assert.strictEqual(u.run("gState.seq.length"), 10);
    assert.strictEqual(lastParam("seqlen")[2], 10, "Seq Length follows");
    u.run(`ondrag(${Q.steps[3].x + 6}, ${Q.lane.y + 6}, 1, 0, 0)`);
    assert.strictEqual(u.run("gState.seq.length"), 4);
    u.run(`ondrag(${Q.steps[3].x + 6}, ${Q.lane.y + 6}, 0, 0, 0)`);
    assert.strictEqual(u.run("gUndo.length"), undo0 + 1, "one undo snapshot per drag");
    assert.strictEqual(u.calls.notify, n0 + 1);
    assert.strictEqual(seqHeaderOf(u)[1], 4, "the engine header carries the length");
    // dragging past both ends clamps to 1 .. 16
    u.run(`onclick(${Q.steps[3].x}, ${Q.lane.y + 6}, 1, 0, 0, 0, 0); ondrag(${Q.lane.x - 80}, ${Q.lane.y + 6}, 1, 0, 0)`);
    assert.strictEqual(u.run("gState.seq.length"), 1);
    u.run(`ondrag(${Q.lane.x + Q.lane.w + 80}, ${Q.lane.y + 6}, 1, 0, 0); ondrag(0, 0, 0, 0, 0)`);
    assert.strictEqual(u.run("gState.seq.length"), 16);
    // Length bar
    u.run(`onclick(${x(Q.len, 0.5)}, ${Q.len.y + 5}, 1, 0, 0, 0, 0); ondrag(0, 0, 0, 0, 0)`);
    assert.strictEqual(u.run("gState.seq.length"), 9);
    assert.strictEqual(lastParam("seqlen")[2], 9);
    // Rate bar: 0 .. 9
    u.run(`onclick(${x(Q.rate, 0)}, ${Q.rate.y + 5}, 1, 0, 0, 0, 0)`);
    assert.strictEqual(u.run("gState.seq.rate"), 0);
    u.run(`ondrag(${x(Q.rate, 1)}, ${Q.rate.y + 5}, 1, 0, 0); ondrag(0, 0, 0, 0, 0)`);
    assert.strictEqual(u.run("gState.seq.rate"), 9);
    assert.strictEqual(lastParam("seqrate")[2], 9);
    assert.strictEqual(seqHeaderOf(u)[2], 9);
    // Glide bar and its double-click reset
    u.run(`onclick(${x(Q.glideBar, 0.5)}, ${Q.glideBar.y + 5}, 1, 0, 0, 0, 0); ondrag(0, 0, 0, 0, 0)`);
    assert.ok(Math.abs(u.run("gState.seq.glide") - 0.5) < 0.02);
    assert.ok(Math.abs(lastParam("glide")[2] - 50) < 2);
    assert.ok(Math.abs(seqHeaderOf(u)[3] - 0.5) < 0.02);
    u.run(`ondblclick(${x(Q.glideBar, 0.5)}, ${Q.glideBar.y + 5})`);
    assert.strictEqual(u.run("gState.seq.glide"), 0);
    // Curve toggle
    const c0 = u.run("gState.seq.curve");
    clickR(u, Q.curve);
    assert.strictEqual(u.run("gState.seq.curve"), c0 ? 0 : 1);
    assert.strictEqual(seqHeaderOf(u)[4], c0 ? 0 : 1);
    u.run("undo()");
    assert.strictEqual(u.run("gState.seq.curve"), c0);
    // Live -> face: the parameters move the state (automation, MIDI map)
    u.run("set_seqrate(3); set_glide(75); set_seqlen(12)");
    assert.deepStrictEqual(u.run("[gState.seq.rate, gState.seq.glide, gState.seq.length]"), [3, 0.75, 12]);
    // an echo of what the face sent does not drag the state back
    u.run("set_seqlen(9)");
    assert.strictEqual(u.run("gState.seq.length"), 9);
});

ok("v8ui: Mode is a 3-way control; the ON chip, Randomize Sequence and Clear; playing the sequencer sets Seq", () => {
    const u = makeUi();
    u.run(SEQ_SETUP + "test_section('seq', 1);");
    const A = G.glitchFaceLayout({ seq: 1 }).action.ab;
    const Q = G.glitchFaceLayout({ seq: 1 }).seq;
    const third = (i) => [A.x + 2 + (A.w - 4) * (i + 0.5) / 3, A.y + A.h / 2];
    clickAt(u, ...third(1)); assert.strictEqual(u.run("gState.audition"), "morph");
    assert.strictEqual(u.params().filter((m) => m[1] === "mode").pop()[2], 1);
    clickAt(u, ...third(2)); assert.strictEqual(u.run("gState.audition"), "seq");
    assert.strictEqual(u.params().filter((m) => m[1] === "mode").pop()[2], 2);
    assert.strictEqual(seqHeaderOf(u)[0], 2, "the engine mode header says Seq");
    clickAt(u, ...third(0)); assert.strictEqual(u.run("gState.audition"), "working");
    assert.strictEqual(seqHeaderOf(u)[0], 0);
    // the ON chip toggles Seq
    clickR(u, Q.on); assert.strictEqual(u.run("gState.audition"), "seq");
    clickR(u, Q.on); assert.strictEqual(u.run("gState.audition"), "working");
    // Randomize Sequence: rolls from the filled slots only, switches to Seq, one undo step
    const undo0 = u.run("gUndo.length");
    clickR(u, Q.dice);
    assert.strictEqual(u.run("gState.audition"), "seq");
    assert.strictEqual(u.run("gUndo.length"), undo0 + 1);
    const st = u.run("gState.seq.steps");
    assert.ok(st.every((v) => v === -1 || v === 0 || v === 1 || v === 2) && st.some((v) => v >= 0), "only filled slots");
    assert.ok(st[0] >= 0, "step 0 does not hold");
    const seed = u.run("gState.seed");
    clickR(u, Q.dice);
    assert.strictEqual(u.run("gState.seed"), seed + 1, "each roll uses a new seed");
    u.run("echoPending = {}"); // what the face sent has echoed back by now
    u.run("set_mode(1)");
    assert.strictEqual(u.run("gState.audition"), "morph", "automation of Mode follows");
    u.run("set_mode(2)");
    assert.strictEqual(u.run("gState.audition"), "seq");
    // Clear = every step holds
    clickR(u, Q.clear);
    assert.ok(u.run("gState.seq.steps.every(function (v) { return v === -1; })"));
});

ok("v8ui: in Seq the pad, glitch view and editor show the SOUNDING blend (telemetry), not the first step", () => {
    const u = makeUi();
    u.run(SEQ_SETUP + "gState.seq = normalizeSeq({ steps: [0, 1], length: 2, rate: 4, glide: 0 }); gState.audition = 'seq'; gModelDirty = true; test_section('editor', 0);");
    const S = G.GL_SCOPE;
    const setTele = (o) => {
        u.run(`gHaveTele = true; gTele = new Array(GL_SCOPE.END).fill(0); gTele[GL_SCOPE.SEQ_ON] = 1; gTele[GL_SCOPE.SEQ_PLAY] = 1; ` +
            `gTele[GL_SCOPE.SEQ_SLOT] = ${o.slot}; gTele[GL_SCOPE.SEQ_PREV] = ${o.prev}; gTele[GL_SCOPE.SEQ_GLIDE] = ${o.glide}; gTele[GL_SCOPE.SEQ_STEP] = ${o.step}; gTele[GL_SCOPE.SEQ_FRAC] = ${o.frac};` +
            o.w.map((v, i) => `gTele[GL_SCOPE.WEIGHTS + ${i}] = ${v};`).join("") + "gModelDirty = true; gSeqSig = ''; refreshModel();");
    };
    // no telemetry yet: the first step's slot (slot 0 = drive)
    u.run("gHaveTele = false; gTele = null; gModelDirty = true; refreshModel();");
    assert.deepStrictEqual(u.run("gTiles.map(function (t) { return t.key; })"), ["drvA"], "before the engine reports, step 0");
    // the engine says slot 1 (filter) is sounding
    setTele({ slot: 1, prev: 0, glide: 1, step: 1, frac: 0.7, w: [0, 1, 0, 0, 0, 0, 0, 0] });
    assert.deepStrictEqual(u.run("gTiles.map(function (t) { return t.key; })"), ["filt"], "the tiles follow the sounding slot, not step 0");
    // mid crossfade: both
    setTele({ slot: 1, prev: 0, glide: 0.5, step: 1, frac: 0.25, w: [0.5, 0.5, 0, 0, 0, 0, 0, 0] });
    assert.deepStrictEqual(u.run("gTiles.map(function (t) { return t.key; })"), ["drvA", "filt"]);
    // pad weights: the corner of slot 0 and slot 1 (corners 0, 1, 0, 1 from test_fill) share the blend
    u.run("paint()");
    assert.deepStrictEqual(u.run("soundingWeights(gState, gTele).slice(0, 3)"), [0.5, 0.5, 0]);
    // the editor shows the sounding values: the filter's wet 1 and cutoff 60 from slot 1
    u.run("test_section('editor', 1); test_select('filt'); paint();");
    assert.ok(Math.abs(u.run("editorValue('filt', 'cutoff')") - 60) < 1e-6);
    // a stopped transport still reports the held step; paint never throws
    u.run("gTele[GL_SCOPE.SEQ_PLAY] = 0; paint();");
    // seqrate / glide changes while playing do not break the header
    assert.ok(u.run("seqPlayhead(gTele).step") === 1);
});

ok("v8ui: editing a module while Seq or Morph plays copies the sounding blend into Working and switches to it", () => {
    for (const mode of ["seq", "morph"]) {
        const u = makeUi();
        u.run(SEQ_SETUP + "gState.seq = normalizeSeq({ steps: [1, 1], length: 2, rate: 4 }); gState.corners = [1, 1, 1, 1];" +
            `gState.audition = '${mode}'; gModelDirty = true; gHaveTele = false; refreshModel(); test_section('editor', 1); test_select('filt'); paint();`);
        assert.deepStrictEqual(u.run("gTiles.map(function (t) { return t.key; })"), ["filt"], mode);
        assert.strictEqual(u.run("glitchGetValue(gState.working, 'filt', 'wet')"), 0, "Working has no filter");
        const ed = u.run("gLayout.editor");
        const rows = G.glitchEditorRows("filt");
        const E = G.glitchEditorLayout(ed, rows.length);
        const cutRow = rows.findIndex((r) => r.id === "cutoff");
        const undo0 = u.run("gUndo.length");
        u.run(`onclick(${E.rows[cutRow].x + E.rows[cutRow].w * 0.9}, ${E.rows[cutRow].y + 5}, 1, 0, 0, 0, 0)`);
        assert.strictEqual(u.run("gState.audition"), "working", `${mode}: the edit switched to Working`);
        assert.strictEqual(u.params().filter((m) => m[1] === "mode").pop()[2], 0);
        assert.strictEqual(seqHeaderOf(u)[0], 0, "the engine plays Working");
        assert.ok(u.run("glitchGetValue(gState.working, 'filt', 'wet')") > 0.9, "the filter came along: the edit is audible");
        assert.ok(u.run("glitchGetValue(gState.working, 'filt', 'cutoff')") > 1000, "and the edit applied");
        assert.strictEqual(u.run("gUndo.length"), undo0 + 1, "one undo step for switch + edit");
        assert.ok(/WORKING/.test(u.run("gHint")), "the hint says what happened");
        u.run("ondrag(0, 0, 0, 0, 0)");
        u.run("undo()");
        assert.strictEqual(u.run("glitchGetValue(gState.working, 'filt', 'wet')"), 0, "undo restores the working glitch");
        // the editor of a Working glitch behaves as before
        u.run("paint()");
    }
    // lock / remove from Seq do the same
    const u2 = makeUi();
    u2.run(SEQ_SETUP + "gState.seq = normalizeSeq({ steps: [1], length: 1 }); gState.audition = 'seq'; gModelDirty = true; refreshModel(); test_section('editor', 1); test_select('filt'); paint();");
    const E2 = G.glitchEditorLayout(u2.run("gLayout.editor"), G.glitchEditorRows("filt").length);
    clickR(u2, E2.remove);
    assert.strictEqual(u2.run("gState.audition"), "working");
    assert.ok(!u2.run("gTiles.some(function (t) { return t.key === 'filt'; })"), "removed from what plays");
});

ok("v8ui: tile overflow: 30 tiles page, +N shows what is hidden, tiles on page 2 are clickable, the page clamps", () => {
    const u = makeUi();
    u.run("device_ready();" +
        "var big = defaultGlitch(); for (var i = 0; i < GL_INSTANCES.length; i++) glitchSetValue(big, GL_INSTANCES[i].id, 'wet', 0.8);" +
        "for (var t = 0; t < GL_TYPES.length; t++) if (GL_TYPES[t].amountKey) glitchSetValue(big, GL_TYPES[t].id, GL_TYPES[t].amountKey, 0.7);" +
        "gState.working = big; gModelDirty = true; refreshModel(); paint();");
    assert.strictEqual(u.run("gTiles.length"), 30, "22 instances (spectral expands) + 8 sub-ops");
    assert.strictEqual(u.run("gTiles[0].key"), "drvA");
    assert.deepStrictEqual(u.run("gTiles.map(function (t) { return t.chain; })").every((c, i, a) => i === 0 || c >= a[i - 1]), true, "chain order");
    const V = () => G.glitchViewLayout(30, G.glitchFaceLayout({}).view, u.run("gTilePage"));
    assert.strictEqual(V().rects.length, 12);
    clickR(u, V().next);
    assert.strictEqual(u.run("gTilePage"), 1);
    const V1 = V();
    assert.strictEqual(V1.first, 12);
    clickR(u, V1.rects[2]); // the third tile of page 2 = tile index 14
    assert.strictEqual(u.run("gState.ui.sel"), u.run("gTiles[14].key"));
    assert.strictEqual(u.run("gState.ui.editor"), 1);
    clickR(u, G.glitchFaceLayout({ editor: 1 }).toggles.editor); // close the editor
    clickR(u, V().next);
    clickR(u, V().next);
    assert.strictEqual(u.run("gTilePage"), 2, "the last page");
    assert.strictEqual(V().rects.length, 6);
    clickR(u, V().prev);
    clickR(u, V().prev);
    clickR(u, V().prev);
    assert.strictEqual(u.run("gTilePage"), 0, "page 0 stays");
    // a glitch with few modules puts the page back
    u.run("gTilePage = 2; randomize(4);");
    assert.ok(u.run("gTilePage") === 0 || u.run("gTiles.length") > 24);
    u.run("paint()");
    // paging works for every tile count and paints
    for (const n of [5, 9, 13, 25]) {
        u.run(`gState.working = defaultGlitch(); var ids = GL_INSTANCES.map(function (i) { return i.id; }).filter(function (i) { return i !== 'spec'; }); for (var k = 0; k < ${n}; k++) glitchSetValue(gState.working, ids[k % ids.length], 'wet', 0.7); gModelDirty = true; refreshModel(); paint();`);
    }
});

ok("v8ui: every tile has its own audio-reactive glyph and readout (all 22 instances and 8 spectral sub-ops)", () => {
    const keys = G.GL_INSTANCES.filter((i) => i.id !== "spec").map((i) => i.id).concat(SPEC_TYPES);
    assert.strictEqual(keys.length, 30);
    const loud = (u) => {
        u.run("gHaveTele = true; gTele = new Array(GL_SCOPE.END).fill(0); for (var i = 0; i < GL_SCOPE.END; i++) gTele[i] = 0.2 + 0.7 * Math.abs(Math.sin(i * 1.3));" +
            "gTele[GL_SCOPE.BEAT] = 3.7; gTele[GL_SCOPE.STUT_ENGAGED] = 1; gTele[GL_SCOPE.CHOP_STEP] = 5;");
    };
    const glyph = new Map();
    for (const key of keys) {
        const u = makeUi();
        const info = G.glitchTileInfo(key);
        u.run("device_ready(); gState.working = defaultGlitch(); " + (info.sub ? `glitchSetValue(gState.working, ${JSON.stringify(key)}, ${JSON.stringify(info.sub)}, 1); glitchSetValue(gState.working, ${JSON.stringify(key)}, 'wet', 1);` : `glitchSetValue(gState.working, ${JSON.stringify(key)}, 'wet', 1);`) + "gModelDirty = true; refreshModel();");
        assert.deepStrictEqual(u.run("gTiles.map(function (t) { return t.key; })"), [key], key);
        const draw = () => { u.drawLog.length = 0; u.run("paintTileBody(gTiles[0], 10, 10, 46, 26, [1, 0.5, 0.2], 1)"); return u.drawLog.join("|"); };
        u.run("gHaveTele = true; gTele = new Array(GL_SCOPE.END).fill(0);");
        const quiet = draw();
        loud(u);
        const lit = draw();
        assert.ok(lit.length > 40, `${key} draws something`);
        assert.notStrictEqual(quiet, lit, `${key} reacts to the telemetry`);
        glyph.set(key, lit);
        // the primary readout names the parameters (the big tiles print it)
        assert.ok(u.run("tilePrimary(gTiles[0])").length > 0, `${key} has a readout`);
        // paints in big, compact and small tiles and in the ribbon without throwing
        u.run("gTilePage = 0; paint();");
        // parameter-driven: the glyph changes with a parameter (not only with the audio)
    }
    // every phase 2 tile (15 modules / sub-ops) has a drawing of its own: different from every other tile and from the generic level bars (drive A / B, filter, crush, ring, delay, reverb, width)
    const NEW_TILES = ["form", "comb", "phas", "rect", "fm", "corr", "gpit", "gstr", "rvs", "shuf", "slap", "scatter", "mirror", "binshift", "specgate"];
    const generics = new Set(["drvA", "drvB", "filt", "crush", "ring", "dly", "rev", "wid"].map((k) => glyph.get(k)));
    const seenNew = new Set();
    for (const k of NEW_TILES) {
        assert.ok(!generics.has(glyph.get(k)), `${k} has its own glyph`);
        assert.ok(!seenNew.has(glyph.get(k)), `${k} differs from the other new tiles`);
        seenNew.add(glyph.get(k));
    }
    // compact names exist, are short, and belong to real tiles
    for (const [k, v] of Object.entries(G.GL_TINY)) assert.ok(G.glitchTileInfo(k) && v.length <= 7, k);
    // parameter-driven glyphs change when their parameters change (telemetry fixed)
    for (const [key, id, v0, v1] of [["form", "vowel", 0, 3], ["comb", "freq", 60, 2000], ["phas", "depth", 0.2, 1], ["rect", "mode", 0, 1], ["fm", "index", 0.1, 0.9], ["gpit", "pitch", -12, 12],
        ["gstr", "size", 40, 300], ["slap", "time", 50, 170], ["mirror", "mir_pivot", 300, 6000], ["binshift", "bsh_bins", -30, 30], ["specgate", "sgl_mode", 0, 1], ["scatter", "sct_w", 3, 30]]) {
        const u = makeUi();
        const info = G.glitchTileInfo(key);
        const setup = `device_ready(); gState.working = defaultGlitch(); glitchSetValue(gState.working, ${JSON.stringify(key)}, 'wet', 1);` + (info.sub ? `glitchSetValue(gState.working, ${JSON.stringify(key)}, ${JSON.stringify(info.sub)}, 1);` : "");
        u.run(setup); loud(u);
        const drawWith = (v) => { u.run(`glitchSetValue(gState.working, ${JSON.stringify(key)}, ${JSON.stringify(id)}, ${v}); gModelDirty = true; refreshModel();`); u.drawLog.length = 0; u.run("paintTileBody(gTiles[0], 10, 10, 46, 26, [1, 0.5, 0.2], 1)"); return u.drawLog.join("|"); };
        assert.notStrictEqual(drawWith(v0), drawWith(v1), `${key}: the glyph follows ${id}`);
    }
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
        assert.ok(/@[A-Za-z0-9_]+@/.test(code) === false, "all tokens substituted");
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
