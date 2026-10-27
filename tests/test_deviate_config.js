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
check("param count 33", dump.length === 33 && C.DV_PARAMS.length === 33, `${dump.length}/${C.DV_PARAMS.length}`);
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
const slots = Object.entries(S).filter(([k]) => !["METAS", "DRAWS", "HIDDEN", "ECHO", "WAVE"].includes(k)).map(([, v]) => v);
check("scope scalar slots unique", new Set(slots).size === slots.length);
check("scope blocks do not overlap", S.METAS + 8 <= S.DRAWS && S.DRAWS + 8 <= S.PK_IN && S.HIDDEN + 64 <= S.ECHO);
check("scope fits", S.WAVE + C.DV_WAVE_BLOCKS * C.DV_WAVE_STRIDE === C.DV_SCOPE_SAMPS && S.ECHO + 32 <= S.WAVE);
check("echo offsets inside 32", Object.values(C.DV_ECHO).every((v) => v >= 0 && v < 32));
check("DV_HIDDEN fits its scope block", C.DV_HIDDEN.length <= 64);

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
check("env never exceeds 1, no pre-hit signal", C.dvRingEnv(-0.1, 1) === 0 && C.dvRingEnv(0, 1) === 1);
check("windows sum to 1 and gB >= 0", (() => { for (let t = 0; t < 0.5; t += 0.0005) for (const [a, b] of [[10, 120], [20, 180], [15, 150]]) { const w = C.dvWindows(t, a, b); if (w.gB < 0 || w.gT < 0 || w.gR < 0 || !near(w.gT + w.gB + w.gR, 1, 1e-12)) return false; } return true; })());
check("windows at 0: transient only; at 0.5 s: long only", (() => { const w0 = C.dvWindows(0, 15, 150), w1 = C.dvWindows(0.5, 15, 150); return w0.gT === 1 && w0.gR === 0 && w1.gT === 0 && w1.gR === 1; })());
check("latency 256 / 1279", C.dvLatency(0) === 256 && C.dvLatency(1) === 1279);

// ---- hidden table ---------------------------------------------------------------------------------------------------------
const H = C.DV_HIDDEN;
check("hidden ids unique", new Set(H.map((r) => r.id)).size === H.length);
check("hidden row count ~36 (30..48)", H.length >= 30 && H.length <= 48, String(H.length));
check("every meta feeds a row", [0, 1, 2, 3, 4, 5, 6, 7].every((m) => H.some((r) => r.meta === m)));
check("17 effects", Object.keys(C.DV_EFFECTS).length === 17, Object.keys(C.DV_EFFECTS).join());
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
check("hidden gen text is generated and stable", C.dvHiddenGen() === C.dvHiddenGen() && C.dvHiddenGen().includes("dv_hidden(mE, mT, hv)"));

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
