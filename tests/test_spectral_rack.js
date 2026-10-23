#!/usr/bin/env node
"use strict";
/**
 * Unit tests of the rack machinery functions (src/spectral_split_rack.genexpr): the counter arithmetic, the content alignment of two
 * instances' sample clocks (ss2_align / ss2_verify) with the buffer ring layout of the template, the zero fill and the overlap-add rows.
 * The per-sample template itself (src/spectral_split_rack_main.genexpr) is tested in real Max (scripts/run_transplit_audio_tests.py rack_*) and in Live.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { DataSim, load } = require("./genexpr_functions.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8");
const F = load(read("spectral_split_rack.genexpr"));
const RS = 8192, STRIDE = 7, HDR = 16, W = 64, BACK = 1500, SPAN = 2048;
const MOD = 4194304;
const mod = (x) => ((x % MOD) + MOD) % MOD;

// ---- counters
assert.strictEqual(F.ss2_wd(5, 3), 2);
assert.strictEqual(F.ss2_wd(3, 5), -2);
assert.strictEqual(F.ss2_wd(2, MOD - 3), 5, "wrap forward");
assert.strictEqual(F.ss2_wd(MOD - 3, 2), -5, "wrap backward");
assert.strictEqual(F.ss2_wd(1000, 1000), 0);
assert.strictEqual(F.ss2_wd(MOD / 2 - 1, 0), MOD / 2 - 1);
assert.strictEqual(F.ss2_wd(MOD / 2, 0), -MOD / 2, "half the range maps to the negative end");
assert.strictEqual(F.ss2_slot(0, RS, STRIDE, HDR), HDR);
assert.strictEqual(F.ss2_slot(RS + 3, RS, STRIDE, HDR), HDR + 3 * STRIDE);
assert.strictEqual(F.ss2_slot(MOD + 5, RS, STRIDE, HDR), HDR + 5 * STRIDE, "counters wrap at 2^22");
assert.strictEqual(F.ss2_slot(MOD - 1, RS, STRIDE, HDR), HDR + (RS - 1) * STRIDE, "2^22 is a multiple of the ring length");

// ---- two instances' rings with the same content at different counters
function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 2147483648) - 1; };
}
const f32 = Math.fround;
function makeRing() { return new DataSim(HDR + RS * STRIDE); }
// own counter runs 0..count-1 from `own0`; the leader sees sample j of the content at counter j + d (leader counter = own counter + d)
function fill(ring, startCounter, count, sample) {
    for (let i = 0; i < count; i++) ring.poke(f32(sample(i)), F.ss2_slot(mod(startCounter + i), RS, STRIDE, HDR), 0);
}
function scenario(d, ownNow, leadAhead, sample, opts) {
    // content index j = 0.. ; own counter of content j = own0 + j with own0 = ownNow - n + 1
    const n = 12000;
    const own = makeRing(), lead = makeRing();
    const own0 = mod(ownNow - n + 1);
    fill(own, own0, n, (i) => sample(i, own0));
    // the leader has the same content at counters own0 + d .., and has progressed `leadAhead` samples past the follower's now (it may be behind: negative)
    const have = n + leadAhead;
    fill(lead, mod(own0 + d), Math.max(0, Math.min(n + leadAhead, 20000)), (i) => sample(i, own0));
    const lfp = mod(own0 + d + have);
    return { own, lead, lfp, ownNow: mod(ownNow) };
}
const aw = new DataSim(64);
const noise = lcg(1);
const noiseTab = Array.from({ length: 40000 }, () => noise() * 0.5);
const sampleNoise = (i) => noiseTab[i % noiseTab.length];

for (const d of [0, 1, -1, 64, -64, 300, -1301, 2500, 123456, -987654, 2097151, -2097152, 4000000]) {
    for (const lead of [-512, -64, 0, 64, 448, 512]) {
        for (const ownNow of [20000, MOD - 5000 + 7, 3000000]) {
            const sc = scenario(d, ownNow, lead, sampleNoise);
            const got = F.ss2_align(sc.own, sc.lead, aw, sc.ownNow, sc.lfp, RS, STRIDE, HDR, W, BACK, SPAN);
            const want = ((d + MOD / 2) % MOD + MOD) % MOD - MOD / 2;
            assert.strictEqual(got, want, `align d=${d} lead=${lead} ownNow=${ownNow}: got ${got}`);
            assert.strictEqual(F.ss2_verify(sc.own, sc.lead, sc.ownNow, got, RS, STRIDE, HDR, 4, 1100), 1, `verify d=${d}`);
            assert.strictEqual(F.ss2_verify(sc.own, sc.lead, sc.ownNow, got + 1, RS, STRIDE, HDR, 4, 1100), -1, "a wrong offset mismatches");
        }
    }
}
console.log("[rack] align / verify find the counter offset from content at 13 offsets x 6 leader positions x 3 clocks");

// a lone impulse is found (its window is the only non-silent content)
{
    const T0 = 7000;                       // the impulse sits at own counter 7000
    const imp = (i, own0) => (mod(own0 + i) === T0 ? 0.5 : 0);
    let found = 0;
    for (let now = 8400; now < 8700; now += 64) {
        const sc = scenario(777, now, 100, imp);
        const got = F.ss2_align(sc.own, sc.lead, aw, sc.ownNow, sc.lfp, RS, STRIDE, HDR, W, BACK, SPAN);
        const inWindow = T0 >= now - BACK - (W - 1) && T0 <= now - BACK;
        if (inWindow) { assert.strictEqual(got, 777, `impulse in the window at now=${now}`); found++; }
        else assert.strictEqual(got, 8000000, `an impulse out of the window reads as silent (${got}) at now=${now}`);
    }
    assert.ok(found >= 1, "a lone impulse is aligned at least once while it crosses the window");
}
// silent and constant windows have nothing to match
{
    const sc = scenario(500, 20000, 0, () => 0);
    assert.strictEqual(F.ss2_align(sc.own, sc.lead, aw, sc.ownNow, sc.lfp, RS, STRIDE, HDR, W, BACK, SPAN), 8000000, "silent");
    const sc2 = scenario(500, 20000, 0, () => 0.25);
    assert.strictEqual(F.ss2_align(sc2.own, sc2.lead, aw, sc2.ownNow, sc2.lfp, RS, STRIDE, HDR, W, BACK, SPAN), 8000000, "constant");
    assert.strictEqual(F.ss2_verify(sc.own, sc.lead, sc.ownNow, 500, RS, STRIDE, HDR, 4, 1100), 0, "verify: silent window is skipped");
}
// different input: no match
{
    const sc = scenario(500, 20000, 0, sampleNoise);
    const other = lcg(99);
    const otherTab = Array.from({ length: 40000 }, () => other() * 0.5);
    const lead2 = makeRing();
    fill(lead2, mod(20000 - 12000 + 1 + 500), 12000, (i) => otherTab[i]);
    assert.strictEqual(F.ss2_align(sc.own, lead2, aw, sc.ownNow, sc.lfp, RS, STRIDE, HDR, W, BACK, SPAN), 9000000, "a different input matches nowhere");
    assert.strictEqual(F.ss2_verify(sc.own, lead2, sc.ownNow, 500, RS, STRIDE, HDR, 4, 1100), -1);
}
// an exactly periodic input matches at the nearest period: the offset is a multiple of the period away (the output is periodic too)
{
    const P = 500;
    const per = (i, own0) => 0.3 * Math.sin((2 * Math.PI * ((i + own0) % P)) / P) + 0.1 * (((i + own0) % P) / P);
    const sc = scenario(P * 7, 20000, 0, per);
    const got = F.ss2_align(sc.own, sc.lead, aw, sc.ownNow, sc.lfp, RS, STRIDE, HDR, W, BACK, SPAN);
    assert.ok(got < 7999999 && ((got - P * 7) % P + P) % P === 0, `periodic input: offset equals the true one modulo the period (${got})`);
}
console.log("[rack] silent / constant / impulse / different / periodic inputs behave");

// ---- zero fill, overlap-add rows
{
    const ring = makeRing();
    for (let i = 0; i < ring.size; i++) ring.a[i] = 1;
    F.ss2_zero(ring, MOD - 3, 8, RS, STRIDE, HDR);
    for (let i = 0; i < 8; i++) {
        const b = F.ss2_slot(mod(MOD - 3 + i), RS, STRIDE, HDR);
        assert.strictEqual(ring.peek(b, 0), 1, "the fingerprint field is kept");
        for (let f = 1; f < STRIDE; f++) assert.strictEqual(ring.peek(b + f, 0), 0, "output fields zeroed across the 2^22 wrap");
    }
    assert.strictEqual(ring.peek(F.ss2_slot(5, RS, STRIDE, HDR) + 1, 0), 1, "neighbouring slots untouched");
    const n = 16, acc = new DataSim(n, 4), st = new DataSim(8), fy = new DataSim(4096, 2), win = new DataSim(4096);
    for (let i = 0; i < n; i++) { fy.poke(i + 1, i, 0); fy.poke(-(i + 1), i, 1); win.poke(1.5, i); }
    st.poke(3, 0);
    F.ss2_ola(acc, 2, st, fy, win, n);
    assert.strictEqual(acc.peek(3, 2), 1, "row 2 (left) at write position + 0: fy 1 * win 1.5 * 2/3");
    assert.strictEqual(acc.peek(3, 3), -1, "row 3 (right)");
    assert.strictEqual(acc.peek(2, 2), 16, "wraps around the ring");
    assert.strictEqual(acc.peek(5, 0), 0, "other rows untouched");
    const y = F.ss2_out(acc, 2, st);
    assert.strictEqual(y, 1);
    assert.strictEqual(acc.peek(3, 2), 0, "ss2_out clears");
    F.ss2_clear(acc, 4, n);
    for (let r = 0; r < 4; r++) for (let i = 0; i < n; i++) assert.strictEqual(acc.peek(i, r), 0);
}

// ---- derived channel: last = input - the other channels (ss2_olas), against computing every channel (the template's @@DERIVE@@ path)
{
    const prep = (s) => s.replace(/(?<![.\w])poke\((\w+),\s*/g, "$1.poke(").replace(/\batan2\(/g, "Math.atan2(");
    const gx = load(prep(read("cepstrum_lib.genexpr")), prep(read("spectral_split_lib.genexpr")), prep(read("spectral_split_rack.genexpr")), prep(read("spectral_split_mida.genexpr")));
    const K = 3, n = 1024, N = 20000;
    const tab = new DataSim(4096, 3), win = new DataSim(4096), fx = new DataSim(4096, 2), fy = new DataSim(4096, 2), fz = new DataSim(4096, 2);
    const ringL = new DataSim(4096), ringR = new DataSim(4096), stt = new DataSim(8), ms = new DataSim(2049, 2), msa = new DataSim(2049, 2), mk = new DataSim(2049, K + 1);
    const accA = new DataSim(4096, 2 * (K + 1)), accB = new DataSim(4096, 2 * (K + 1));
    const xs = [], ys = [];
    const rnd = lcg(7);
    for (let i = 0; i < N; i++) { xs.push(0.3 * Math.sin(i * 0.07) + 0.2 * rnd()); ys.push(0.2 * Math.sin(i * 0.013) + 0.2 * rnd()); }
    const outA = [[], [], []], outB = [[], [], []];
    let frames = 0, worst = 0;
    for (let i = 0; i < N; i++) {
        gx.fft_init(tab);
        gx.stft_win(win, n);
        const rdy = gx.ss_in(ringL, ringR, stt, xs[i], ys[i], n);
        if (rdy > 0.5) {
            frames++;
            gx.ss_frame(fx, ringL, ringR, stt, win, n);
            gx.ss2_copy(fx, fz, n);
            gx.fft_run(fx, tab, n, 0);
            gx.ss_mid(fx, ms, n);
            gx.ss_mida(fx, msa, n);
            for (let k = 0; k <= n / 2; k++) assert.strictEqual(ms.peek(k, 0), msa.peek(k, 0), "ss_mida amplitude equals ss_mid amplitude");
            // masks that change every frame; the sum is 1, except in frames 20..24 where a gain breaks it (derive must be off there)
            const sum1 = !(frames >= 20 && frames <= 24);
            for (let k = 0; k <= n / 2; k++) {
                const a = Math.abs(Math.sin(k * 0.01 + frames)), b = Math.abs(Math.cos(k * 0.02 - frames * 0.3));
                const s = a + b + 1;
                mk.poke(a / s, k, 0); mk.poke(b / s, k, 1); mk.poke(1 / s * (sum1 ? 1 : 0.5), k, 2);
                mk.poke(sum1 ? 1 : (a + b + 0.5) / s, k, 3);
            }
            for (let c = 0; c <= K; c++) {
                gx.ss2_copy(fx, fy, n);
                gx.ss_apply(fy, mk, c, n);
                gx.fft_run(fy, tab, n, 1);
                gx.ss2_ola(accA, 2 * c, stt, fy, win, n);                // reference: every row from its own inverse transform
                if (sum1) {
                    if (c >= K - 1) gx.ss2_ola(accB, 2 * c, stt, fz, win, n);   // derived: last channel and the All row from the input frame
                    else { gx.ss2_ola(accB, 2 * c, stt, fy, win, n); gx.ss2_olas(accB, 2 * (K - 1), stt, fy, win, n); }
                } else {
                    gx.ss2_ola(accB, 2 * c, stt, fy, win, n);
                }
            }
        }
        for (let c = 0; c < K; c++) {
            const a = gx.ss2_out(accA, 2 * c, stt), b = gx.ss2_out(accB, 2 * c, stt);
            gx.ss2_out(accA, 2 * c + 1, stt); gx.ss2_out(accB, 2 * c + 1, stt);
            outA[c].push(a); outB[c].push(b);
            worst = Math.max(worst, Math.abs(a - b));
        }
        gx.ss2_out(accA, 2 * K, stt); gx.ss2_out(accB, 2 * K, stt); gx.ss2_out(accA, 2 * K + 1, stt); gx.ss2_out(accB, 2 * K + 1, stt);
    }
    // note: ss2_out advances nothing itself; ss_in moved the write position, so the row outputs above are all at the same position
    assert.ok(worst < 1e-12, `derived last channel equals the computed one, also across frames where the masks stop summing to 1 (max diff ${worst})`);
    console.log("[rack] derived last channel (input - other channels, per frame) equals the inverse-transformed one: max diff " + worst.toExponential(2));
}
console.log("All spectral rack function tests passed");
