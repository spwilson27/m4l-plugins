"use strict";
// Config contract tests: parameter table (Python P <-> DV_PARAMS), draw algorithm, Ring law, windows, hidden table invariants,
// blob codec, preview telemetry. Pure Node, < 2 s. Run through tests/test_deviate_dsp.js.
const { execFileSync } = require("child_process");
const path = require("path");
const C = require("../src/deviate_config.js");

const ROOT = path.resolve(__dirname, "..");
let fails = 0, passes = 0;
function check(name, ok, detail) {
    if (ok) passes++;
    else { fails++; console.log(`FAIL ${name}${detail ? "  " + detail : ""}`); }
}
const near = (a, b, e) => Math.abs(a - b) <= e;

// ---- parameter table -------------------------------------------------------------------------------------------
const dump = JSON.parse(execFileSync("python3", ["scripts/build_deviate.py", "--dump-params"], { cwd: ROOT, encoding: "utf8" }));
check("param count 35", dump.length === 35 && C.DV_PARAMS.length === 35, `${dump.length}/${C.DV_PARAMS.length}`);
dump.forEach((p, i) => {
    const m = C.DV_PARAMS[i];
    const same = m && m[0] === p.key && m[1] === p.long && m[2] === p.short && m[3] === p.min && m[4] === p.max && m[5] === p.init &&
        m[6] === p.type && m[7] === p.unit && m[8] === p.expo && (m[9] === p.gen || (m[9] === null && p.gen === null)) && m[10] === p.div;
    check(`DV_PARAMS[${i}] ${p.key} mirrors P`, same, JSON.stringify([m, p].map((x) => x && (Array.isArray(x) ? x : [x.key, x.long, x.short, x.min, x.max, x.init, x.type, x.unit, x.expo, x.gen, x.div]))));
    check(`${p.key} short name <= 8 and help >= 12`, p.short.length <= 8 && p.help.length >= 12);
    check(`${p.key} Int range`, !(p.type === 1 && p.max - p.min > 255));
    check(`DV_PARAM_INDEX ${p.key}`, C.DV_PARAM_INDEX[p.key] === i);
});
check("short names unique", new Set(dump.map((p) => p.short)).size === dump.length);
check("long names unique", new Set(dump.map((p) => p.long)).size === dump.length);
check("seed is a float parameter shown as Int", dump.find((p) => p.key === "seed").type === 0 && dump.find((p) => p.key === "seed").unit === 0);
check("order is forever (first 24 keys)", dump.slice(0, 24).map((p) => p.key).join() ===
    "v_snap,v_pitch,v_body,v_motion,v_space,v_echo,v_grit,v_ring,r_snap,r_pitch,r_body,r_motion,r_space,r_echo,r_grit,r_ring,sens,thresh,chance,mix,seed,drift,reroll,split");
check("value defaults 30,50,30,20,30,20,20,10", dump.slice(0, 8).map((p) => p.init).join() === "30,50,30,20,30,20,20,10");
check("every gen message is unique", (() => { const g = dump.map((p) => p.gen).filter(Boolean); return new Set(g).size === g.length; })());
check("DV_ENGINE_GEN split", C.DV_ENGINE_GEN.split === 1 && C.DV_ENGINE_GEN.reroll === 1);

// ---- scope layout ----------------------------------------------------------------------------------------------
const S = C.DV_SCOPE;
const slots = Object.entries(S).filter(([k]) => !["METAS", "DRAWS", "HIDDEN", "HIDDEN2", "ECHO", "WAVE"].includes(k)).map(([, v]) => v);
check("scope scalar slots unique", new Set(slots).size === slots.length);
check("scope blocks do not overlap", S.METAS + 8 <= S.DRAWS && S.DRAWS + 8 <= S.PK_IN && S.HIDDEN + 64 <= S.ECHO && S.ECHO + 32 <= S.HIDDEN2 && S.HIDDEN2 + 16 <= S.WAVE);
check("dvHiddenSlot: rows 0..63 at HIDDEN, 64.. at HIDDEN2", C.dvHiddenSlot(0) === S.HIDDEN && C.dvHiddenSlot(63) === S.HIDDEN + 63 && C.dvHiddenSlot(64) === S.HIDDEN2 && C.dvHiddenSlot(79) === S.HIDDEN2 + 15);
check("DV_MAP capacity 80 rows, bank stride 640, 1296 samples", C.DV_MAP.ROW_CAP === 80 && C.DV_MAP.BANK_STRIDE === 640 && C.DV_MAP.ROW_CAP * C.DV_MAP.STRIDE === C.DV_MAP.BANK_STRIDE && C.DV_MAP.SAMPS === 1296 && C.DV_MAP.BASE + 2 * C.DV_MAP.BANK_STRIDE === C.DV_MAP.SAMPS);
check("curve codes: sat is 4", C.DV_CURVE_CODE.sat === 4 && C.DV_CURVE_CODE.step === 3);
check("scope fits", S.WAVE + C.DV_WAVE_BLOCKS * C.DV_WAVE_STRIDE === C.DV_SCOPE_SAMPS && S.ECHO + 32 <= S.WAVE);
check("echo offsets inside 32", Object.values(C.DV_ECHO).every((v) => v >= 0 && v < 32));
check("DV_HIDDEN fits its scope blocks and the map", C.DV_HIDDEN.length <= C.DV_MAP.ROW_CAP && C.DV_HIDDEN.length <= 64 + 16);

// ---- hash / draw -----------------------------------------------------------------------------------------------
let sum = 0, n = 0;
const bins = new Array(10).fill(0);
for (let idx = 0; idx < 4000; idx++) for (let slot = 0; slot < 9; slot++) {
    const h = C.dvHash(idx * 4096 + (idx % 7), 3, slot);
    if (!(h >= 0 && h < 1)) check("hash in [0,1)", false, String(h));
    sum += h; n++; bins[Math.floor(h * 10)]++;
}
check("hash mean ~0.5", near(sum / n, 0.5, 0.01), String(sum / n));
check("hash uniform (10 bins within 8%)", bins.every((b) => Math.abs(b / n - 0.1) < 0.008), bins.join());
check("hash deterministic", C.dvHash(12345, 7, 2) === C.dvHash(12345, 7, 2));
check("hash depends on seed and slot", C.dvHash(5, 1, 0) !== C.dvHash(5, 2, 0) && C.dvHash(5, 1, 0) !== C.dvHash(5, 1, 1));
let corr = 0, m0 = 0, m1 = 0, a = [], b = [];
for (let i = 0; i < 3000; i++) { a.push(C.dvHash(i, 0, 0)); b.push(C.dvHash(i, 0, 1)); }
m0 = a.reduce((x, y) => x + y) / a.length; m1 = b.reduce((x, y) => x + y) / b.length;
let va = 0, vb = 0;
for (let i = 0; i < a.length; i++) { corr += (a[i] - m0) * (b[i] - m1); va += (a[i] - m0) ** 2; vb += (b[i] - m1) ** 2; }
check("hash slots independent (|r| < 0.06)", Math.abs(corr / Math.sqrt(va * vb)) < 0.06, String(corr / Math.sqrt(va * vb)));

function params(over) {
    return Object.assign(C.dvDefaultDrawParams(), over || {});
}
{ // draws within V +- R
    const p = params({ seed: 11 });
    p.v = [30, 50, 30, 20, 95, 5, 60, 10]; p.r = [50, 20, 100, 0, 30, 30, 100, 50];
    const st = C.dvNewState();
    let ok = true;
    for (let i = 0; i < 300; i++) {
        C.dvStep(st, p, "hit");
        for (let k = 0; k < 8; k++) {
            const lo = Math.max(0, p.v[k] - p.r[k]), hi = Math.min(100, p.v[k] + p.r[k]);
            if (st.T[k] < lo - 1e-9 || st.T[k] > hi + 1e-9) ok = false;
        }
    }
    check("draws within V +- R (clamped)", ok);
    check("Range 0 never varies", (() => { const s2 = C.dvNewState(); const q = params({ seed: 3 }); q.r = q.r.map(() => 0); for (let i = 0; i < 20; i++) C.dvStep(s2, q, "hit"); return s2.T.every((t, k) => t === q.v[k]); })());
}
{ // same seed same draws, different seed differs, two hits differ
    const run = (seed) => { const st = C.dvNewState(); const p = params({ seed }); const out = []; for (let i = 0; i < 4; i++) { C.dvStep(st, p, "hit"); out.push(st.T.slice()); } return out; };
    const r5 = run(5), r5b = run(5), r6 = run(6);
    check("seed reproducible", JSON.stringify(r5) === JSON.stringify(r5b));
    check("seed 6 differs", JSON.stringify(r5) !== JSON.stringify(r6));
    check("two hits differ", JSON.stringify(r5[0]) !== JSON.stringify(r5[1]));
}
{ // Lock holds through hits and rerolls; Value/Range edits ignored while locked
    const st = C.dvNewState(); const p = params({ seed: 2 });
    C.dvStep(st, p, "hit");
    const keep = st.T[2];
    p.lock = [0, 0, 1, 0, 0, 0, 0, 0]; p.v[2] = 90; p.r[2] = 0;
    for (let i = 0; i < 10; i++) C.dvStep(st, p, i % 3 ? "hit" : "reroll");
    check("Lock holds T through hits and rerolls", st.T[2] === keep);
    check("unlocked metas still change", st.T[0] !== C.dvDrawn(C.dvNewState(), p).T[0]);
}
{ // Chance statistics and the first-hit rule
    for (const chance of [0, 50, 100]) {
        const st = C.dvNewState(); const p = params({ seed: 9, chance });
        let drew = 0; const N = 4000;
        for (let i = 0; i < N; i++) { if (C.dvStep(st, p, "hit").drew) drew++; }
        const expect = chance === 0 ? 1 : chance === 100 ? N : 1 + (N - 1) * 0.5;
        const sigma = chance === 50 ? Math.sqrt(N * 0.25) : 0.5;
        check(`Chance ${chance}: ${drew} draws (expect ~${expect})`, Math.abs(drew - expect) <= 4 * sigma + 1);
    }
    const st = C.dvNewState();
    check("first hit always draws, even at Chance 0", C.dvStep(st, params({ chance: 0 }), "hit").drew === 1);
    check("a rejected hit still counts", (() => { const s2 = C.dvNewState(); const q = params({ chance: 0 }); C.dvStep(s2, q, "hit"); C.dvStep(s2, q, "hit"); return s2.hits === 2 && s2.serial === 1 && s2.gate === 0; })());
}
{ // Reroll: new draw for every unlocked meta (when Range > 0), no hit consumed
    const st = C.dvNewState(); const p = params({ seed: 4 }); p.v = p.v.map(() => 50); p.r = p.r.map(() => 40);
    C.dvStep(st, p, "hit");
    const before = st.T.slice(), hitsBefore = st.hits;
    C.dvStep(st, p, "reroll");
    check("Reroll changes every unlocked meta", st.T.every((t, k) => t !== before[k]), JSON.stringify([before, st.T]));
    check("Reroll consumes no hit", st.hits === hitsBefore && st.reroll === 1 && st.serial === 2);
}
{ // Drift: 0 jumps, 100 leaves <= 10 % after 4 hits
    const mk = (drift) => { const st = C.dvNewState(); const p = params({ seed: 8, drift }); C.dvStep(st, p, "hit"); const base = st.E.slice(); return { st, p, base }; };
    const a0 = mk(0);
    check("Drift 0: E equals T", a0.st.E.every((e, k) => e === a0.st.T[k]));
    const p = params({ seed: 8, drift: 100 }); p.r = p.r.map(() => 100);
    const st = C.dvNewState(); C.dvStep(st, p, "hit");
    const T1 = st.T.slice();
    p.lock = [1, 1, 1, 1, 1, 1, 1, 1]; // freeze T: only E converges
    for (let i = 0; i < 4; i++) C.dvStep(st, p, "hit");
    check("Drift 100: <= 10 % of the Value-to-draw gap left after 5 hits", st.E.every((e, k) => Math.abs(e - T1[k]) <= 0.1 * Math.abs(T1[k] - p.v[k]) + 1e-9));
    check("Drift kd", near(C.dvDriftK(100), 0.44, 1e-12) && C.dvDriftK(0) === 1);
    check("Drift 100 after 4 hits: residual factor 0.56^4 <= 0.1", Math.pow(1 - C.dvDriftK(100), 4) <= 0.1);
}
{ // transport reset: hits restart; same draws repeat
    const p = params({ seed: 21 });
    const s1 = C.dvNewState(); C.dvStep(s1, p, "hit");
    const s2 = C.dvNewState(); C.dvStep(s2, p, "hit");
    check("fresh state repeats the first draw", JSON.stringify(s1.T) === JSON.stringify(s2.T));
}

// ---- Ring law, windows, latency ----------------------------------------------------------------------------------------
check("Tr(0) 0.05, Tr(100) 1.83", near(C.dvRingTr(0), 0.05, 1e-12) && near(C.dvRingTr(100), 1.83, 1e-12));
check("Ring 100 is 2.0 s total", near(C.DV_RING_HOLD_S + C.dvRingTr(100) + C.DV_RING_FADE_S, 2.0, 1e-12));
check("env 1 for 150 ms, then decays, -66 dB at Tr", C.dvRingEnv(0.1, 1) === 1 && near(20 * Math.log10(C.dvRingEnv(0.15 + 1.83, 1.83)), -66, 0.01));
check("env exactly 0 after 2.0 s at Ring 100", C.dvRingEnv(2.0 + 1e-9, C.dvRingTr(100)) === 0 && C.dvRingEnv(2.5, 1.83) === 0);
check("env monotonic non-increasing", (() => { let prev = 2; for (let t = 0; t < 2.2; t += 0.001) { const e = C.dvRingEnv(t, 1.83); if (e > prev + 1e-12) return false; prev = e; } return true; })());
check("dvRingEnv takes a hold: 1 until it ends, Classic default unchanged, exact 0 after hold + Tr + 0.02", C.dvRingEnv(0.5, 1, 0.6) === 1 && C.dvRingEnv(0.5, 1) === C.dvRingEnv(0.5, 1, 0.15) && C.dvRingEnv(0.6 + 1 + 0.02 + 1e-9, 1, 0.6) === 0 && near(20 * Math.log10(C.dvRingEnv(0.6 + 1, 1, 0.6)), -66, 0.01));
check("env never exceeds 1, no pre-hit signal", C.dvRingEnv(-0.1, 1) === 0 && C.dvRingEnv(0, 1) === 1);
check("windows sum to 1 and gB >= 0", (() => { for (let t = 0; t < 0.5; t += 0.0005) for (const [a, b] of [[10, 120], [20, 180], [15, 150]]) { const w = C.dvWindows(t, a, b); if (w.gB < 0 || w.gT < 0 || w.gR < 0 || !near(w.gT + w.gB + w.gR, 1, 1e-12)) return false; } return true; })());
check("windows at 0: transient only; at 0.5 s: long only", (() => { const w0 = C.dvWindows(0, 15, 150), w1 = C.dvWindows(0.5, 15, 150); return w0.gT === 1 && w0.gR === 0 && w1.gT === 0 && w1.gR === 1; })());
check("latency 256 / 1279", C.dvLatency(0) === 256 && C.dvLatency(1) === 1279);

// ---- hidden table ---------------------------------------------------------------------------------------------------------
const H = C.DV_HIDDEN;
check("hidden ids unique", new Set(H.map((r) => r.id)).size === H.length);
check("hidden row count 72 (36 Classic + 28 Arch Mode + 8 extra), capacity 80", H.length === 72 && C.DV_HIDDEN_CLASSIC === 36 && H.length <= C.DV_MAP.ROW_CAP, String(H.length));
check("extra rows 64..71 are marked extra, in order", H.slice(64).map((r) => r.id).join() === "lfo_hz,lfo_depth,lfo_shape,lfo_tgt,tape_dir,dry_rep,env_hold_ms,snd_close_ms" && H.every((r, i) => !!r.extra === (i >= 64)));
check("extra rows hold the Classic constants", (() => { const c = Object.fromEntries(H.slice(64).map((r) => [r.id, [r.lo, r.hi]])); return JSON.stringify(c) === JSON.stringify({ lfo_hz: [1, 1], lfo_depth: [0, 0], lfo_shape: [0, 0], lfo_tgt: [0, 0], tape_dir: [0, 0], dry_rep: [0, 0], env_hold_ms: [150, 150], snd_close_ms: [200, 200] }); })());
check("DV_NONFX lfo, dry, env", C.DV_NONFX.join() === "lfo,dry,env");
check("every meta feeds a row", [0, 1, 2, 3, 4, 5, 6, 7].every((m) => H.some((r) => r.meta === m)));
check("21 effects (17 + tape, gate, zap, spec), no lfo / dry / env", Object.keys(C.DV_EFFECTS).length === 21 && C.DV_NONFX.every((f) => !(f in C.DV_EFFECTS)), Object.keys(C.DV_EFFECTS).join());
check("sat curve: 0 at u 0, hi at u >= 0.5, monotonic, 0.64 at 0.2", (() => {
    const row = { curve: "sat", lo: 0, hi: 1 }; let prev = -1;
    for (let u = 0; u <= 1.0001; u += 0.01) { const v = C.dvCurve(row, u); if (v < prev - 1e-12) return false; prev = v; }
    return C.dvCurve(row, 0) === 0 && near(C.dvCurve(row, 0.5), 1, 1e-12) && C.dvCurve(row, 1) === 1 && near(C.dvCurve(row, 0.2), 0.64, 1e-12) &&
        C.dvMapValue({ meta: 0, src: 0, curve: 4, lo: 2, hi: 6, jit: 1 }, [20, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]) === 2 + 4 * 0.64;
})());
const neutral = C.dvHiddenNeutral();
H.forEach((r, i) => {
    if (r.kind === "A") {
        const want = r.curve === "abs50" ? r.lo : r.curve === "log" ? r.lo : r.lo;
        const E0 = [0, 0, 0, 0, 0, 0, 0, 0]; E0[C.DV_PITCH_META] = 50;
        const v = C.dvHiddenFromMetas(E0, E0)[i];
        const pitchRow = r.meta === C.DV_PITCH_META;
        check(`A row ${r.id} neutral at meta 0 (Pitch: 50)`, pitchRow ? (r.curve === "abs50" ? v === 0 : v === 0) : near(v, want, 1e-12), `${v}`);
    }
    // monotone in the meta (abs50: on each side of 50), steps integer
    let up = true, down = true, prev = null;
    const seq = [];
    for (let m = 0; m <= 100; m += 1) { const E = [0, 0, 0, 0, 0, 0, 0, 0]; E[r.meta] = m; seq.push(C.dvHiddenFromMetas(E, E)[i]); }
    const halves = r.curve === "abs50" ? [seq.slice(0, 51), seq.slice(50)] : [seq];
    let mono = true;
    for (const h of halves) { const inc = h.every((v, k) => k === 0 || v >= h[k - 1] - 1e-12), dec = h.every((v, k) => k === 0 || v <= h[k - 1] + 1e-12); if (!inc && !dec) mono = false; }
    check(`row ${r.id} monotonic in its meta`, mono);
    if (r.kind === "D" || r.curve === "step") check(`row ${r.id} integer steps in range`, seq.every((v) => v === Math.floor(v) && v >= r.lo && v <= r.hi));
    check(`row ${r.id} stays inside lo..hi (+jitter)`, seq.every((v) => v >= Math.min(r.lo, r.hi) - 1e-9 && v <= Math.max(r.lo, r.hi) + 1e-9));
    if (r.jit) check(`row ${r.id} jitter factor within +-${r.jit}`, Math.abs(C.dvJitter(i) - 1) <= r.jit + 1e-12);
});
check("discrete rows read the undrifted draw T", (() => { const E = [0, 0, 0, 0, 0, 0, 0, 0], T = [0, 0, 100, 0, 100, 0, 100, 0]; const v = C.dvHiddenFromMetas(E, T); return v[C.DV_HIDDEN_INDEX.conv_ir] > 0 && v[C.DV_HIDDEN_INDEX.form_vowel] > 0 && v[C.DV_HIDDEN_INDEX.crush_bits] > 0 && v[C.DV_HIDDEN_INDEX.conv_wet] === 0; })());
check("Ring 100 hidden Tr = 1.83 s", near(C.dvHiddenFromMetas([0, 0, 0, 0, 0, 0, 0, 100], [0, 0, 0, 0, 0, 0, 0, 100])[C.DV_HIDDEN_INDEX.tr_s], 1.83, 1e-9));
check("Pitch 0 / 100 = -12 / +12 st", (() => { const lo = C.dvHiddenFromMetas([0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0])[C.DV_HIDDEN_INDEX.pitch_st]; const hi = C.dvHiddenFromMetas([0, 100, 0, 0, 0, 0, 0, 0], [0, 100, 0, 0, 0, 0, 0, 0])[C.DV_HIDDEN_INDEX.pitch_st]; return lo === -12 && hi === 12; })());
check("hidden gen text is generated and stable", C.dvHiddenGen() === C.dvHiddenGen() && C.dvHiddenGen().includes("dv_hidden(mE, mT, hv, mp)"));

// ---- Architecture (arch): the hidden map ---------------------------------------------------------------------------------------
{
    // Arch 0 is DV_HIDDEN exactly (the old inline formula: dvCurve of the jittered meta)
    const rng = C.dvRng(5);
    let w = 0;
    for (let t = 0; t < 300; t++) {
        const E = [], T = [];
        for (let i = 0; i < 8; i++) { E.push(rng() * 100); T.push(rng() * 100); }
        const hv = C.dvHiddenFromMetas(E, T);
        H.forEach((r, i) => { const u = Math.min(1, Math.max(0, (r.kind === "D" ? T : E)[r.meta] * 0.01 * C.dvJitter(i))); w = Math.max(w, Math.abs(hv[i] - C.dvCurve(r, u))); });
    }
    check("Arch 0 equals the original mapping", w === 0, String(w));
    check("dvArchMap is deterministic and cached", C.dvArchMap(417) === C.dvArchMap(417) && JSON.stringify(C.dvArchMap(417)) === JSON.stringify(C.dvArchMap(417.2)));
    const distinct = new Set();
    let bad = [];
    const idx = C.DV_HIDDEN_INDEX;
    for (let a = 0; a <= 1000; a++) {
        const mp = C.dvArchMap(a);
        distinct.add(JSON.stringify(C.dvArchSummary(mp)));
        // neutral at meta 0 (Pitch 50) for every Arch: every amount row sits at its Arch 0 neutral value
        const neu = C.dvHiddenNeutral(mp), neu0 = C.dvHiddenNeutral();
        H.forEach((r, i) => { if (r.kind === "A" && Math.abs(neu[i] - neu0[i]) > 1e-12) bad.push(`a${a} neutral ${r.id} ${neu[i]} vs ${neu0[i]}`); });
        // every meta Snap..Grit drives at least one effect family
        const sum = C.dvArchSummary(mp);
        for (let m = 0; m < 7; m++) if (!sum[m].length) bad.push(`a${a} meta ${m} drives nothing`);
        // tr_s never changes (Ring law, 2 s cap)
        const ts = mp[idx.tr_s], ts0 = C.dvArchMap(0)[idx.tr_s];
        if (ts.meta !== 7 || ts.lo !== ts0.lo || ts.hi !== ts0.hi || ts.curve !== ts0.curve || ts.jit !== 1) bad.push(`a${a} tr_s changed`);
        // values stay inside the safe envelopes for the extreme and random metas
        const probes = [[0, 0], [100, 100], [50, 50]];
        for (let k = 0; k < 6; k++) probes.push([rng() * 100, rng() * 100]);
        probes.forEach(([e, t]) => {
            const E = [0, 1, 2, 3, 4, 5, 6, 7].map(() => e), T = E.map(() => t);
            const hv = C.dvHiddenFromMetas(E, T, mp);
            H.forEach((r, i) => {
                const env = C.DV_ARCH_ENV[r.id], v = hv[i];
                if (!Number.isFinite(v)) { bad.push(`a${a} ${r.id} not finite`); return; }
                let lo, hi;
                if (r.id === "tr_s") { lo = 0.05; hi = 1.83; }
                else if (r.id === "pitch_st") { lo = -12; hi = 12; }
                else if (env && env.b) { lo = env.b[0]; hi = env.b[1]; }
                else if (env && env.abs) { lo = r.lo; hi = env.abs[1]; }
                else if (env && env.amax) { lo = r.lo; hi = env.cap !== undefined ? env.cap : r.lo + (r.hi - r.lo) * env.amax[1]; }
                else { lo = Math.min(r.lo, r.hi); hi = Math.max(r.lo, r.hi); }
                if (v < lo - 1e-9 || v > hi + 1e-9) bad.push(`a${a} ${r.id} ${v} outside ${lo}..${hi}`);
                if (r.kind === "D" && v !== Math.floor(v)) bad.push(`a${a} ${r.id} not integer ${v}`);
            });
        });
        if (bad.length > 5) break;
    }
    check("every Arch: neutral at meta 0, Snap..Grit drive something, tr_s fixed, values inside the safe envelopes", bad.length === 0, bad.slice(0, 5).join("; "));
    check("Arch values give many different layouts", distinct.size > 950, String(distinct.size));
    let counts = [];
    for (let a = 1; a <= 200; a++) counts.push(C.dvArchSummary(C.dvArchMap(a)).reduce((n, l) => n + l.length, 0));
    check("10..17 effect families in play", Math.min(...counts) >= 10 && Math.max(...counts) <= 17, `${Math.min(...counts)}..${Math.max(...counts)}`);
    // Classic Arch 1..1000 are what they were before the Arch Modes existed (rows 0..35; sha256 of the maps of commit d73175d)
    const crypto = require("crypto"), hsh = crypto.createHash("sha256");
    for (let a = 0; a <= 1000; a++) hsh.update(JSON.stringify(C.dvArchMap(a, 0).slice(0, C.DV_HIDDEN_CLASSIC)));
    check("Classic maps unchanged since the Arch Modes", hsh.digest("hex") === "130515c59320109cf0e2d24eb039ac31480b208df56433aa17c79927f20e60be");
    let cst = 0;
    for (let a = 0; a <= 1000; a++) { const mp = C.dvArchMap(a, 0); for (let i = C.DV_HIDDEN_CLASSIC; i < H.length; i++) if (mp[i].lo !== H[i].lo || mp[i].hi !== H[i].hi) cst++; }
    check("Classic keeps the appended rows at their constants", cst === 0, String(cst));
    const f = C.dvMapFloats(C.dvArchMap(3));
    check("dvMapFloats: STRIDE floats per row, fits a bank", f.length === H.length * C.DV_MAP.STRIDE && f.length <= C.DV_MAP.BANK_STRIDE && C.DV_MAP.BASE + 2 * C.DV_MAP.BANK_STRIDE <= C.DV_MAP.SAMPS);
    check("Classic Archs 0..1000 keep rows 64..71 at their constants (curve, meta untouched)", (() => { for (let a = 0; a <= 1000; a++) { const mp = C.dvArchMap(a, 0); for (let i = 64; i < 72; i++) if (mp[i].lo !== H[i].lo || mp[i].hi !== H[i].hi || mp[i].curve !== C.DV_CURVE_CODE[H[i].curve]) return false; } return true; })());
}

// ---- Arch Modes: Wonky (1), Natural (2), Glitch (3) ------------------------------------------------------------------------------
{
    const idx = C.DV_HIDDEN_INDEX, rng = C.dvRng(11);
    const neu0 = C.dvHiddenNeutral();
    const famMetaOf = (mp, fam) => { const r = mp[idx[{ zap: "zap_wet", pitch: "pitch_wet", form: "form_wet", ring: "ring_wet", res: "res_wet" }[fam]]]; return r && r.hi > r.lo ? r.meta : null; };
    for (const md of [1, 2, 3]) {
        const name = C.DV_MODES[md], def = C.DV_MODE_DEF[md];
        const bad = [], distinct = new Set(), counts = [];
        const famHas = {};
        for (let a = 0; a <= 1000; a++) {
            const mp = C.dvArchMap(a, md);
            distinct.add(JSON.stringify(mp));
            const sum = C.dvArchSummary(mp);
            counts.push(sum.reduce((n, l) => n + l.length, 0));
            sum.forEach((l) => l.forEach((f) => { famHas[f] = (famHas[f] || 0) + 1; }));
            const neu = C.dvHiddenNeutral(mp);
            H.forEach((r, i) => { if (r.kind === "A" && Math.abs(neu[i] - neu0[i]) > 1e-12) bad.push(`a${a} neutral ${r.id}`); });
            for (let m = 0; m < 7; m++) if (!sum[m].length) bad.push(`a${a} meta ${m} drives nothing`);
            const ts = mp[idx.tr_s];
            if (ts.meta !== 7 || ts.lo !== (def.trLo !== undefined ? def.trLo : 0.05) || ts.hi !== def.tr || ts.curve !== 1) bad.push(`a${a} tr_s`);
            const all = [].concat(...sum);
            if (md === 2 && !(all.includes("snap") && all.includes("res") && all.includes("conv"))) bad.push(`a${a} natural core families`);
            if (md === 2 && ["crush", "ring", "gate", "zap", "spec"].some((x) => all.includes(x))) bad.push(`a${a} natural has a glitch family`);
            if (md === 3 && !all.includes("spec")) bad.push(`a${a} glitch without spectral`);
            if (md !== 2 && def.sig[0].filter((x) => all.includes(x)).length < def.sig[1]) bad.push(`a${a} too few signature families`);
            const probes = [[0, 0], [100, 100], [50, 50], [rng() * 100, rng() * 100], [rng() * 100, rng() * 100]];
            probes.forEach(([e, t]) => {
                const E = [0, 1, 2, 3, 4, 5, 6, 7].map(() => e), T = E.map(() => t);
                const hv = C.dvHiddenFromMetas(E, T, mp);
                H.forEach((r, i) => {
                    const env = (def.env && def.env[r.id]) || C.DV_ARCH_ENV[r.id], v = hv[i];
                    if (!Number.isFinite(v)) { bad.push(`a${a} ${r.id} not finite`); return; }
                    if (r.extra) return; // checked below
                    if (mp[i].lo === mp[i].hi && Math.abs(v - neu0[i]) < 1e-12) return; // a family out of play keeps its Arch 0 neutral value
                    let lo, hi;
                    if (r.id === "tr_s") { lo = def.trLo !== undefined ? def.trLo : 0.05; hi = def.tr; }
                    else if (r.id === "pitch_st") { lo = -12; hi = 12; }
                    else if (r.id === "tape_st" && md === 2) { lo = -7; hi = 7; }
                    else if (env && env.b) { lo = env.b[0]; hi = env.b[1]; }
                    else if (env && env.abs) { lo = r.lo; hi = env.abs[1]; }
                    else if (env && env.top) { lo = r.lo; hi = env.top[1]; }
                    else if (env && env.amax) { lo = r.lo; hi = env.cap !== undefined ? env.cap : r.lo + (r.hi - r.lo) * env.amax[1]; }
                    else { lo = Math.min(r.lo, r.hi); hi = Math.max(r.lo, r.hi); }
                    if (env && env.set) { lo = Math.min(lo, ...env.set); hi = Math.max(hi, ...env.set); }
                    if (v < lo - 1e-9 || v > hi + 1e-9) bad.push(`a${a} ${r.id} ${v} outside ${lo}..${hi}`);
                    if (r.kind === "D" && v !== Math.floor(v)) bad.push(`a${a} ${r.id} not integer`);
                });
            });
            // ---- rows 64..71 ----
            const row = (id) => mp[idx[id]];
            const holdHi = Math.max(row("env_hold_ms").lo, row("env_hold_ms").hi), closeHi = Math.max(row("snd_close_ms").lo, row("snd_close_ms").hi);
            if (holdHi / 1000 + def.tr + 0.02 > 8.0 + 1e-9) bad.push(`a${a} hold ${holdHi} + Tr ${def.tr} > 8 s`);
            if (row("env_hold_ms").lo !== 150 || row("snd_close_ms").lo !== 200 || row("env_hold_ms").meta !== 7 || row("snd_close_ms").meta !== 7) bad.push(`a${a} hold/close lo/meta`);
            if (def.x.holdMax ? holdHi > def.x.holdMax + 1e-9 || closeHi > def.x.closeMax + 1e-9 : holdHi !== 150 || closeHi !== 200) bad.push(`a${a} hold/close top`);
            // dry_rep: bounded by 1.1 x the strongest in-play anchor, on its meta, neutral at meta 0 (Pitch 50)
            const dry = row("dry_rep");
            const anchors = def.x.dryAnchors.map((id) => row(id)).filter((rw) => rw.hi > rw.lo && !(rw.lo === rw.hi));
            const inPlayAnchors = def.x.dryAnchors.filter((id) => {
                const fx = H[idx[id]].fx; return all.includes(fx) && row(id).hi > row(id).lo;
            }).map((id) => row(id));
            const anchorHi = inPlayAnchors.length ? Math.max(...inPlayAnchors.map((rw) => rw.hi)) : 0;
            if (anchorHi === 0 ? (dry.lo !== 0 || dry.hi !== 0) : (dry.hi > 1.1 * anchorHi + 1e-9 || dry.hi < Math.min(def.x.dryHi[0], 1.1 * anchorHi) - 1e-9 || dry.hi > def.x.dryHi[1] + 1e-9)) bad.push(`a${a} dry_rep ${dry.hi} anchor ${anchorHi}`);
            if (dry.hi > 0) {
                const anchorRow = inPlayAnchors.find((rw) => rw.meta === dry.meta);
                if (!anchorRow) bad.push(`a${a} dry_rep meta ${dry.meta} is no anchor's meta`);
                const wantCurve = dry.meta === C.DV_PITCH_META ? C.DV_CURVE_CODE.abs50 : (def.sat ? C.DV_CURVE_CODE.sat : C.DV_CURVE_CODE.lin);
                if (dry.curve !== wantCurve) bad.push(`a${a} dry_rep curve`);
            }
            if (md === 2 && dry.hi > 0.3 + 1e-9) bad.push(`a${a} natural dry_rep ${dry.hi}`);
            // lfo: only with a target family in play, depth neutral at meta 0, sat (abs50 on Pitch)
            const dep = row("lfo_depth"), tgt = row("lfo_tgt"), hz = row("lfo_hz"), shp = row("lfo_shape");
            const tfx = ["zap", "pitch", "form", "ring", "res"];
            if (dep.hi > 0) {
                if (!def.x.lfoP) bad.push(`a${a} lfo in a mode without it`);
                if (tgt.lo !== tgt.hi || tgt.lo < 0 || tgt.lo > 4 || !all.includes(tfx[tgt.lo])) bad.push(`a${a} lfo_tgt ${tgt.lo} not in play`);
                else if (famMetaOf(mp, tfx[tgt.lo]) !== null && famMetaOf(mp, tfx[tgt.lo]) !== dep.meta) bad.push(`a${a} lfo_depth meta ${dep.meta} != target meta`);
                if (dep.lo !== 0 || dep.hi < 0.4 - 1e-9 || dep.hi > 1 + 1e-9) bad.push(`a${a} lfo_depth ${dep.hi}`);
                if (dep.curve !== (dep.meta === C.DV_PITCH_META ? C.DV_CURVE_CODE.abs50 : (def.sat ? C.DV_CURVE_CODE.sat : C.DV_CURVE_CODE.lin))) bad.push(`a${a} lfo_depth curve`);
                const lo = Math.min(hz.lo, hz.hi), hi = Math.max(hz.lo, hz.hi);
                if (lo < def.x.lfoHz[0] - 1e-9 || hi > def.x.lfoHz[1] + 1e-9 || Math.log(hi / lo) < 0.4 * Math.log(def.x.lfoHz[1] / def.x.lfoHz[0]) - 1e-9 || hz.meta !== dep.meta || hz.curve !== C.DV_CURVE_CODE.log) bad.push(`a${a} lfo_hz ${hz.lo}..${hz.hi}`);
                const n = Math.abs(shp.hi - shp.lo) + 1;
                if (shp.src !== 1 || n < 2 || n > 4 || Math.min(shp.lo, shp.hi) < 0 || Math.max(shp.lo, shp.hi) > 3) bad.push(`a${a} lfo_shape ${shp.lo}..${shp.hi}`);
            } else if (dep.hi !== 0 || tgt.hi !== 0 || hz.lo !== 1 || hz.hi !== 1 || shp.lo !== 0 || shp.hi !== 0) bad.push(`a${a} lfo off but not constant`);
            const td = row("tape_dir");
            if (td.hi !== td.lo) { if (!all.includes("tape") || td.lo !== 0 || td.hi !== 1 || td.src !== 1 || !def.x.tapeDirP) bad.push(`a${a} tape_dir`); }
            if (bad.length > 5) break;
        }
        check(`${name}: neutral at meta 0, every meta drives something, Tr top ${def.tr} s, mode families, values in the envelopes`, bad.length === 0, bad.slice(0, 5).join("; "));
        check(`${name}: 1001 different maps`, distinct.size === 1001, String(distinct.size));
        check(`${name}: families in play ${Math.min(...counts)}..${Math.max(...counts)}`, Math.min(...counts) >= 7 && Math.max(...counts) <= 17);
        check(`${name}: dvArchMap deterministic and cached`, C.dvArchMap(417, md) === C.dvArchMap(417.3, md) && C.dvArchMap(417, md) !== C.dvArchMap(417, 0));
        check(`${name}: Arch 0 is generated, not the factory map`, JSON.stringify(C.dvArchMap(0, md)) !== JSON.stringify(C.dvArchMap(0, 0)));
        console.log(`  ${name} families (Archs using each of 1001): ` + Object.entries(famHas).sort((x, y) => y[1] - x[1]).map(([f, n]) => f + " " + n).join(", "));
    }
    // Natural: Pitch tunes upward (resonator / comb pitch and grain shift rise with Pitch), the tape slows below 50
    let up = 0, n = 0;
    for (let a = 0; a <= 300; a++) {
        const mp = C.dvArchMap(a, 2);
        for (const id of ["res_f0", "comb_hz", "pitch_st", "tape_st"]) { const r = mp[idx[id]]; if (r.meta === C.DV_PITCH_META && r.lo !== r.hi) { n++; if (r.hi > r.lo) up++; } }
    }
    check("Natural: everything Pitch tunes rises with Pitch", n > 100 && up === n, `${up}/${n}`);
    check("dvModeTrMax: 1.83 Classic / Natural, 7.38 Wonky, 6.78 Glitch", C.dvModeTrMax(0) === 1.83 && C.dvModeTrMax(2) === 1.83 && C.dvModeTrMax(1) === 7.38 && C.dvModeTrMax(3) === 6.78);
    check("hold + Tr + 0.02 <= 8.0 at the maxima", 0.6 + C.dvModeTrMax(1) + 0.02 <= 8.0 + 1e-12 && 1.2 + C.dvModeTrMax(3) + 0.02 <= 8.0 + 1e-12);
    check("Wonky / Glitch Ring floor 0.45 / 0.7 s, Natural 0.05", C.dvArchMap(9, 1)[idx.tr_s].lo === 0.45 && C.dvArchMap(9, 3)[idx.tr_s].lo === 0.7 && C.dvArchMap(9, 2)[idx.tr_s].lo === 0.05);
    // sat on every non-Pitch amount row in Wonky / Glitch (log rows, abs50 rows aside); Natural none
    let satBad = 0, satSeen = 0, natSat = 0;
    for (let a = 0; a <= 300; a++) for (const md of [1, 2, 3]) {
        const mp = C.dvArchMap(a, md);
        H.forEach((r, i) => {
            if (r.extra || r.kind !== "A" || r.id === "pitch_st" || mp[i].lo === mp[i].hi) return;
            const isLog = mp[i].curve === C.DV_CURVE_CODE.log;
            if (mp[i].meta === C.DV_PITCH_META) { if (mp[i].curve !== C.DV_CURVE_CODE.abs50) satBad++; return; }
            if (md === 2) { if (mp[i].curve === C.DV_CURVE_CODE.sat) natSat++; return; }
            if (isLog) return;
            if (mp[i].curve !== C.DV_CURVE_CODE.sat) satBad++; else satSeen++;
        });
    }
    check("sat on every non-Pitch amount row in Wonky / Glitch, never in Natural", satBad === 0 && natSat === 0 && satSeen > 1000, `${satBad}/${natSat}/${satSeen}`);
    // the draws of rows 0..63 are unchanged by the extras: with an LFO map the family structure still matches the no-extras generator
    const lfoMaps = [1, 3].map((md) => { let n = 0; for (let a = 0; a <= 1000; a++) if (C.dvArchMap(a, md)[idx.lfo_depth].hi > 0) n++; return n; });
    check("LFO is chosen in a good share of Wonky (p 0.8) / Glitch (p 0.5) Archs", lfoMaps[0] > 500 && lfoMaps[1] > 200 && lfoMaps[0] > lfoMaps[1], lfoMaps.join());
    check("Natural never has an LFO or reversed tape", (() => { for (let a = 0; a <= 1000; a++) { const mp = C.dvArchMap(a, 2); if (mp[idx.lfo_depth].hi !== 0 || mp[idx.tape_dir].hi !== 0) return false; } return true; })());
}

// ---- blob ---------------------------------------------------------------------------------------------------------------------
{
    const st = C.dvNewState(); const p = params({ seed: 3 }); C.dvStep(st, p, "hit"); C.dvStep(st, p, "reroll");
    const secs = [{ tag: "UI", face: "Roulette", vals: [1, 2, 3] }, { tag: "XX", face: "Other", vals: [9] }];
    const enc = C.dvBlobEncode(st, secs);
    const dec = C.dvBlobDecode(enc);
    check("blob round trip", dec && dec.valid === 1 && dec.reroll === 1 && dec.T.every((t, k) => near(t, st.T[k], 0.006)) && dec.E.every((e, k) => near(e, st.E[k], 0.006)));
    check("blob keeps unknown trailing sections", dec && dec.sections.length === 2 && dec.sections[1].tag === "XX" && dec.sections[1].vals[0] === 9);
    check("blob re-encodes identically", JSON.stringify(C.dvBlobEncode(dec, dec.sections)) === JSON.stringify(enc));
    check("blob bad input -> defaults (null)", [null, undefined, [], [2, 0, 0, 0], new Array(20).fill("x"), [1, 0, 0, 0, NaN]].every((b) => C.dvBlobDecode(b) === null));
    check("blob truncated section stops cleanly", (() => { const e = enc.slice(0, enc.length - 2); const d = C.dvBlobDecode(e); return d && d.sections.length === 1; })());
    check("blob values clamp", (() => { const e = C.dvBlobEncode(st, []); e[4] = 99999; e[12] = -5; const d = C.dvBlobDecode(e); return d.T[0] === 100 && d.E[0] === 0; })());
    check("default initial blob decodes to an empty draw", (() => { const d = C.dvBlobDecode([1, 0, 0, 0].concat(new Array(16).fill(0))); return d && d.valid === 0; })());
}

// ---- preview telemetry -----------------------------------------------------------------------------------------------------------
for (const kind of ["idle", "hit", "ring", "extreme"]) {
    const a = C.dvPreviewTel(kind), b2 = C.dvPreviewTel(kind);
    check(`preview ${kind}: deterministic, finite, right size`, a.length === C.DV_SCOPE_SAMPS && a.every(Number.isFinite) && JSON.stringify(Array.from(a)) === JSON.stringify(Array.from(b2)));
}
check("preview states differ", JSON.stringify(Array.from(C.dvPreviewTel("idle"))) !== JSON.stringify(Array.from(C.dvPreviewTel("hit"))) &&
    C.dvPreviewTel("extreme")[S.HIT_GATE] === 0 && C.dvPreviewTel("idle")[S.ONSET_AGE] === -1);

{   // spike S1 findings the engine must keep
    const eng = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "deviate_engine.js"), "utf8");
    check("engine calls notifyclients() when the draw state moves (Live reads getvalueof only after it)", /notifyclients\(\)/.test(eng) && /dvStatePoll/.test(eng));
    check("engine brings every live.* to the front (canvases load in front of widgets)", /bringtofront/.test(eng) && /dvFrontControls/.test(eng));
    check("engine turns a Reroll press (a bare bang) into a 0 -> 1 -> 0 pulse for the gen", /"bang"/.test(eng) && /dvOnReroll/.test(eng));
}

console.log(`\ndeviate config: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
