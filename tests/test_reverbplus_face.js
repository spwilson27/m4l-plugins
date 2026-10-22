#!/usr/bin/env node
"use strict";
// Reverb+ face `c` ("Decay Waterfall") tests (auto-run by tests/test_reverbplus.js): layout / hit rectangles, perspective
// geometry and its inverse, RT60-per-band curve, waterfall history and the expected-decay ghost, the impulse-response
// spectrogram, the v8ui against a fake mgraphics (telemetry -> rows, clicks -> rpSend, swap flags, freeze, idle), and the
// built device (swap block wiring, rule 4).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8");
const code = [read("reverbplus_config.js"), read("reverbplus_face_common.js"), read("reverbplus_face_math.js"), read("reverbplus_face.js")].join("\n");
const C = require("../src/reverbplus_config.js");
const M = (() => {
    const ctx = { module: { exports: {} }, Math, Float32Array, Float64Array, Int32Array, Array, Number, String };
    vm.createContext(ctx);
    // the config is a dependency of the math file (rpClamp ...): run both in one context, export the math ones
    vm.runInContext(read("reverbplus_config.js") + "\n" + read("reverbplus_face_math.js"), ctx);
    return ctx.module.exports;
})();

let n = 0;
function test(name, fn) {
    try { fn(); n++; console.log("PASS " + name); } catch (e) { console.log("FAIL " + name + ": " + e.stack.split("\n").slice(0, 3).join(" | ")); process.exitCode = 1; }
}

// ---- face harness -----------------------------------------------------------------------------------------------------
function load(opts) {
    const o = opts || {};
    const calls = [];
    const out = [];
    const clock = { now: 100000 };
    const bufs = o.bufs || {};
    const mg = new Proxy({ size: [340, 161], text_measure: (t) => [String(t).length * 5, 8] }, {
        get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); return 0; }), set: (t, k, v) => { t[k] = v; return true; },
    });
    const tasks = [];
    function FakeBuffer(name) {
        this.peek = (ch, off, cnt) => {
            const d = bufs[name];
            if (!d) return [];
            return Array.isArray(d) || d instanceof Float32Array ? d.slice(off, off + cnt) : d(off, cnt);
        };
    }
    function FakeTask(fn) { this.fn = fn; this.repeat = () => tasks.push(this); this.cancel = () => { const i = tasks.indexOf(this); if (i >= 0) tasks.splice(i, 1); }; this.schedule = () => {}; }
    const FakeDate = { now: () => clock.now };
    const ctx = {
        mgraphics: mg, outlet: (...a) => out.push(a), post: () => {}, Math, Number, String, Array, JSON, isNaN, Float32Array, Float64Array, Int32Array, Object, Date: FakeDate,
        Buffer: FakeBuffer, Task: FakeTask, messagename: "", globalThis: {},
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    const msg = (name, ...args) => { ctx.messagename = name; ctx.anything(...args); };
    return { ctx, calls, out, msg, clock, tasks, bufs, get: (e) => vm.runInContext(e, ctx) };
}

/** A spectrum buffer holding a decaying burst of noise-ish tones in the wet ring and a steady tone in the dry ring. */
function specBuffer(amp) {
    const b = new Float32Array(C.RP_SPEC_SAMPS);
    b[C.RP_SPEC.SR] = 48000;
    b[C.RP_SPEC.HEAD] = 0;
    for (let i = 0; i < C.RP_SPEC.N; i++) {
        b[C.RP_SPEC.WET + i] = amp * (Math.sin(i * 0.31) + 0.5 * Math.sin(i * 0.05));
        b[C.RP_SPEC.DRY + i] = 0.2 * Math.sin(i * 0.12);
    }
    return b;
}

function setupLive(f, algo) {
    f.msg("set_algo", algo === undefined ? 1 : algo);
    f.ctx.names("x", "h", "sc", "sp", "ir", "irs", "irv");
    f.msg("state", "dsp", 1, "-");
    f.msg("state", "link", 1, "linked", 256, 3);
}

function activeScope(algo) {
    const s = C.RP_SCOPE;
    const a = new Float32Array(C.RP_SCOPE_SAMPS);
    a[s.FRAMES] = 5; a[s.SR] = 48000; a[s.ALGO] = algo; a[s.IN_PK] = 0.3; a[s.WET_PK] = 0.2; a[s.RT60_MID] = 2.5; a[s.RT60_LO] = 3; a[s.RT60_HI] = 1;
    return a;
}

// ---- layout / geometry ----------------------------------------------------------------------------------------------------
test("hero layout: icons, plot, strip and IR buttons are inside the v8ui and do not overlap", () => {
    const L = M.rcLayout(340, 161);
    const rects = [...L.icons, L.plot, L.strip, L.browse, L.clear];
    for (const r of rects) assert(r.x >= 0 && r.y >= 0 && r.x + r.w <= 340 && r.y + r.h <= 161, JSON.stringify(r));
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const hit = [...L.icons, L.strip, L.browse, L.clear];
    for (let i = 0; i < hit.length; i++) for (let j = i + 1; j < hit.length; j++) assert(!ov(hit[i], hit[j]), `${i} overlaps ${j}`);
    for (const ic of L.icons) assert(!ov(ic, L.plot));
    assert(!ov(L.plot, L.strip) && !ov(L.plot, L.browse));
    assert(L.icons.every((r) => r.w >= 20 && r.h >= 14), "icon cells are big enough to click");
});

test("perspective: newest row is full size at the front, older rows are smaller and higher; click inverse finds the band", () => {
    const g0 = M.rcRowGeom(0), g1 = M.rcRowGeom(1);
    assert(g0.s === 1 && g1.s < 1 && g1.base < g0.base && g1.hmax < g0.hmax);
    for (const t of [0, 0.3, 0.7, 1]) {
        const g = M.rcRowGeom(t);
        for (const b of [0, 5, 15, 16, 31]) {
            const x = M.rcBandX(b, g.s);
            assert.strictEqual(M.rcHitBand(x, g.base), b, `t ${t} band ${b}`);
        }
    }
    assert.strictEqual(M.rcHitBand(-50, 80), 0);
    assert.strictEqual(M.rcHitBand(9999, 80), 31);
    assert.strictEqual(M.rcStripBand(6), 0);
    assert.strictEqual(M.rcStripBand(333), 31);
    // the geometry keeps the tallest ridge inside the plot (below the info row at y 30)
    assert(g0.base - g0.hmax >= 30 && g1.base - g1.hmax >= 30, "ridges stay under the info row");
});

test("band table matches rpSpectrum32 (40 Hz .. 18 kHz, 32 log bands)", () => {
    assert(Math.abs(M.rcBandEdges(0, 48000)[0] - 40) < 1e-9);
    assert(Math.abs(M.rcBandEdges(31, 48000)[1] - 18000) < 1e-6);
    assert(M.rcFreqPos(1000, 48000) > 0.5 && M.rcFreqPos(1000, 48000) < 0.8);
    // a sine in the middle of band 12 lands in band 12 of rpSpectrum32
    const buf = new Float32Array(C.RP_SPEC_SAMPS);
    buf[C.RP_SPEC.SR] = 48000;
    const f = M.rcBandHz(12, 48000);
    for (let i = 0; i < 4096; i++) buf[C.RP_SPEC.WET + i] = 0.5 * Math.sin(2 * Math.PI * f * i / 48000);
    const bands = C.rpSpectrum32(buf, C.RP_SPEC.WET);
    let pk = 0;
    for (let i = 0; i < 32; i++) if (bands[i] > bands[pk]) pk = i;
    assert.strictEqual(pk, 12);
});

// ---- RT60 curve ------------------------------------------------------------------------------------------------------------
test("RT60 per band: bass multiplier below the crossover, HF damping above, flat in the middle; Convolution interpolates", () => {
    const sr = 48000;
    const c = M.rcRt60Curve({ lo: 4, mid: 2, hi: 1 }, { conv: false, damp: 7000, xover: 350 }, sr);
    assert(c[0] > 3.2 && c[0] <= 4.05, "bass " + c[0]);
    const iMid = 16; // about 1 kHz
    assert(Math.abs(c[iMid] - 2) < 0.25, "mid " + c[iMid]);
    assert(c[31] < c[iMid] * 0.7, "treble shorter: " + c[31]);
    const flat = M.rcRt60Curve({ lo: 2, mid: 2, hi: 2 }, { conv: false, damp: 20000, xover: 350 }, sr);
    assert(flat[0] > 1.9 && flat[20] > 1.7, "no damping, no bass boost: " + flat[0] + " " + flat[20]);
    const cv = M.rcRt60Curve({ lo: 3, mid: 2, hi: 0.5 }, { conv: true, damp: 7000, xover: 350 }, sr);
    assert(Math.abs(cv[0] - 3) < 1e-6 && Math.abs(cv[31] - 0.5) < 1e-6 && cv[16] < 3 && cv[16] > 0.5);
});

// ---- history / ghost --------------------------------------------------------------------------------------------------------
test("history keeps 28 rows newest first; hit = loudest row; ghost falls 60 dB per RT60 and is empty before the hit", () => {
    const h = M.rcHistNew();
    assert.strictEqual(M.rcFindHit(h), -1);
    for (let i = 0; i < 40; i++) {
        const row = new Float32Array(32).fill(i === 10 ? -20 : -60 - i * 0.2);
        M.rcHistPush(h, row, 1000 + i * 150);
    }
    assert.strictEqual(h.rows.length, M.RC.ROWS);
    assert(h.t[0] > h.t[27], "newest first");
    assert(Math.abs(M.rcRowSec(h) - 0.15) < 1e-9);
    // the hit (i = 10) is row 29 of 40 -> dropped; hit among the kept rows: make a fresh history
    const h2 = M.rcHistNew();
    for (let i = 0; i < 20; i++) M.rcHistPush(h2, new Float32Array(32).fill(i === 10 ? -20 : -80), 1000 + i * 150);
    const hit = M.rcFindHit(h2);
    assert.strictEqual(hit, 9, "hit row index (19 - 10)");
    const rt = new Float32Array(32).fill(3);
    const g = M.rcGhost(h2, rt, hit, 0.15);
    assert(g[9] === null && g[12] === null && g[0] !== null);
    // row 0 is 9 rows = 1.35 s after the hit: -60 * 1.35 / 3 = -27 dB
    assert(Math.abs(g[0][5] - (-20 - 27)) < 1e-4, "" + g[0][5]);
    assert(Math.abs(g[8][5] - (-20 - 60 * 0.15 / 3)) < 1e-4);
    // a band with a shorter RT60 falls faster
    rt[7] = 1;
    assert(M.rcGhost(h2, rt, hit, 0.15)[0][7] < g[0][5] - 40);
    // band series is oldest first
    const s = M.rcBandSeries(h2, 3);
    assert.strictEqual(s.length, 20);
    assert(s[10] === -20 && s[0] === -80);
});

// ---- IR spectrogram ----------------------------------------------------------------------------------------------------------
test("IR spectrogram from the partition spectra: decaying noise IR gives rows that fall over time, 0 dB at the loudest cell", () => {
    const sr = 48000, len = 40000;
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
    const L = new Float64Array(len), R = new Float64Array(len);
    for (let i = 0; i < len; i++) { const e = Math.exp(-i / 9000); L[i] = rnd() * e; R[i] = rnd() * e; }
    const sp = C.rpIrSpectra(L, R, len);
    const mapH = M.rcIrMap(C.RP_CONV.NB1, C.RP_CONV.N1, sr), mapT = M.rcIrMap(C.RP_CONV.NB2, C.RP_CONV.N2, sr);
    const st = M.rcIrNew(len);
    const psd = new Float64Array(32);
    for (let p = 0; p < sp.nHead; p++) { M.rcIrPsd(sp.head, p * C.RP_CONV.NB1 * 4, mapH, C.RP_CONV.P1, psd); M.rcIrAdd(st, p * 128 + 64, psd); }
    for (let q = 0; q < sp.nTail; q++) { M.rcIrPsd(sp.tail, q * C.RP_CONV.NB2 * 4, mapT, C.RP_CONV.P2, psd); M.rcIrAdd(st, 4096 + q * 2048 + 1024, psd); }
    const rows = M.rcIrFinish(st);
    assert.strictEqual(rows.length, M.RC.IR_ROWS * 32);
    let mx = -1e9;
    for (const v of rows) mx = Math.max(mx, v);
    assert(Math.abs(mx) < 1e-6, "loudest cell is 0 dB: " + mx);
    const rowMean = (r) => { let s = 0; for (let b = 8; b < 28; b++) s += rows[r * 32 + b]; return s / 20; };
    assert(rowMean(0) > rowMean(12) + 8 && rowMean(12) > rowMean(26) + 8, `falls: ${rowMean(0)} ${rowMean(12)} ${rowMean(26)}`);
    assert(M.rcIrLevel01(0) === 1 && M.rcIrLevel01(-60) === 0);
    // expected slope: exp(-i/9000) in amplitude = 8.69 dB per 9000 samples -> row spacing 1428 samples = 1.38 dB
    const slope = (rowMean(4) - rowMean(20)) / 16;
    assert(Math.abs(slope - 8.686 * (len / 28 / 9000)) < 0.7, "slope " + slope);
});

// ---- the v8ui ----------------------------------------------------------------------------------------------------------------------
test("paint: every algorithm, with and without telemetry, with a band selected, frozen, and Convolution without an IR", () => {
    for (let algo = 0; algo < 6; algo++) {
        const f = load();
        f.ctx.preview();
        f.msg("set_algo", algo);
        f.ctx.rpT.s = f.ctx.rpFakeScope(algo, 2.5);
        f.calls.length = 0;
        f.ctx.paint();
        assert(f.calls.length > 100, "algo " + algo + " draws " + f.calls.length);
    }
    const f = load();
    f.msg("set_algo", 5);
    f.calls.length = 0;
    f.ctx.paint(); // no telemetry, no IR
    assert(f.calls.some((c) => c[0] === "show_text" && /click to load an impulse response/.test(c[1])));
    f.msg("set_algo", 1);
    f.msg("set_freeze", 1);
    f.ctx.rpT.s = f.ctx.rpFakeScope(1, 2);
    f.calls.length = 0;
    f.ctx.paint();
    assert(f.calls.some((c) => c[0] === "show_text" && c[1] === "FROZEN"));
});

test("telemetry -> rows: a moved frame while active samples the wet spectrum and pushes a row every 150 ms; silence and Freeze stop it", () => {
    const f = load({ bufs: { sp: specBuffer(0.3), sc: activeScope(1) } });
    setupLive(f);
    f.ctx.rpT.s = activeScope(1);
    f.ctx.rpT.active = true;
    f.ctx.onFrame(f.ctx.rpT);
    assert.strictEqual(f.get("RCS.hist.rows.length"), 1);
    f.clock.now += 50;
    f.ctx.onFrame(f.ctx.rpT);
    assert.strictEqual(f.get("RCS.hist.rows.length"), 1, "no second row within 150 ms");
    f.clock.now += 120;
    f.ctx.onFrame(f.ctx.rpT);
    assert.strictEqual(f.get("RCS.hist.rows.length"), 2);
    const wet = f.get("Array.from(RCS.hist.rows[0])");
    assert(wet.some((v) => v > -40), "the tones show up");
    assert(f.get("Array.from(RCS.dry)").some((v) => v > -40));
    // idle: no signal -> inactive -> nothing is sampled
    f.ctx.rpT.active = false;
    f.clock.now += 1000;
    f.ctx.onFrame(f.ctx.rpT);
    assert.strictEqual(f.get("RCS.hist.rows.length"), 2);
    // frozen: the plot stops scrolling
    f.ctx.rpT.active = true;
    f.msg("set_freeze", 1);
    f.clock.now += 1000;
    f.ctx.onFrame(f.ctx.rpT);
    assert.strictEqual(f.get("RCS.hist.rows.length"), 2, "frozen does not scroll");
    f.msg("set_freeze", 0);
    f.ctx.onFrame(f.ctx.rpT);
    assert.strictEqual(f.get("RCS.hist.rows.length"), 3);
});

test("clip LED lights from the telemetry's clip depth and holds about a second", () => {
    const f = load({ bufs: { sp: specBuffer(0.2) } });
    setupLive(f);
    f.msg("set_loop", 50);
    const s = activeScope(1);
    s[C.RP_SCOPE.CLIP_DB] = -3;
    f.ctx.rpT.s = s; f.ctx.rpT.active = true;
    f.ctx.onFrame(f.ctx.rpT);
    assert.strictEqual(f.get("RCS.clipAt"), f.clock.now);
    f.calls.length = 0;
    f.ctx.paint();
    assert(f.calls.some((c) => c[0] === "show_text" && c[1] === "CLIP"));
    assert(f.calls.some((c) => c[0] === "ellipse"), "LED drawn");
});

test("clicks: icons set Algorithm (rpSend), a plot click picks a band, drag moves it, double-click clears, strip picks too", () => {
    const f = load();
    f.ctx.preview();
    f.msg("set_algo", 1);
    f.out.length = 0;
    const L = M.rcLayout(340, 161);
    for (const ic of L.icons) {
        f.ctx.onclick(ic.x + ic.w / 2, ic.y + ic.h / 2, 1);
        assert.deepStrictEqual(f.out.pop(), [0, "param", "algo", ic.index]);
    }
    f.ctx.onclick(10, 10, 0); // mouse up: ignored
    assert.strictEqual(f.out.length, 0);
    f.ctx.onclick(170, 100, 1);
    const b1 = f.get("RCS.band");
    assert(b1 >= 14 && b1 <= 17, "centre of the plot is about band 15: " + b1);
    f.ctx.ondrag(300, 100, 1);
    assert(f.get("RCS.band") > 25);
    f.ctx.ondrag(300, 100, 0);
    f.ctx.ondrag(10, 100, 1); // drag after release does nothing
    assert(f.get("RCS.band") > 25);
    f.ctx.ondblclick();
    assert.strictEqual(f.get("RCS.band"), -1);
    f.ctx.onclick(L.strip.x + 3, L.strip.y + 10, 1);
    assert.strictEqual(f.get("RCS.band"), 0);
    f.ctx.onclick(L.strip.x + 3, L.strip.y + 10, 1); // same band again toggles off
    assert.strictEqual(f.get("RCS.band"), -1);
    // header info shows the band's frequency and both RT60s
    f.ctx.onclick(170, 100, 1);
    f.calls.length = 0;
    f.ctx.paint();
    assert(f.calls.some((c) => c[0] === "show_text" && /Hz\s+\d/.test(c[1])), "band info text");
});

test("Convolution: browse / clear buttons and the empty plot send commands; non-Convolution ignores them", () => {
    const f = load();
    f.ctx.preview();
    const L = M.rcLayout(340, 161);
    f.msg("set_algo", 5);
    f.msg("state", "ir", "idle", 0, 0, 0, 0, 0, "-");
    f.out.length = 0;
    f.ctx.onclick(L.browse.x + 4, L.browse.y + 4, 1);
    f.ctx.onclick(L.clear.x + 4, L.clear.y + 4, 1);
    f.ctx.onclick(170, 90, 1); // empty plot, no IR -> browse
    assert.deepStrictEqual(f.out.map((o) => o[2]), ["browse_ir", "clear_ir", "browse_ir"]);
    f.msg("state", "ir", "ready", 1, 96000, 48000, 2, 0, "Hall.wav");
    f.out.length = 0;
    f.ctx.onclick(170, 90, 1); // IR loaded -> band pick
    assert.strictEqual(f.out.length, 0);
    f.msg("set_algo", 1);
    f.ctx.onclick(L.browse.x + 4, L.browse.y + 4, 1);
    assert.strictEqual(f.out.filter((o) => o[1] === "cmd").length, 0);
});

test("swap block: outlet 1 hides the tank-only bars in Convolution and shows them again, once per change", () => {
    const f = load();
    f.msg("set_algo", 1);
    const sw = () => f.out.filter((o) => o[0] === 1).map((o) => o.slice(1).join(" "));
    assert.deepStrictEqual(sw(), ["hide_tank 0", "hide_ir 1"]);
    f.msg("set_algo", 2);
    assert.strictEqual(sw().length, 2, "no repeat while the side is unchanged");
    f.msg("set_algo", 5);
    assert.deepStrictEqual(sw().slice(2), ["hide_tank 1", "hide_ir 0"]);
    f.msg("set_algo", 0);
    assert.deepStrictEqual(sw().slice(4), ["hide_tank 0", "hide_ir 1"]);
});

test("IR spectrogram load: reads the partition spectra of the right bank in chunks, finishes, redraws", () => {
    const sr = 48000, len = 30000;
    const L = new Float64Array(len), R = new Float64Array(len);
    for (let i = 0; i < len; i++) { const e = Math.exp(-i / 7000); L[i] = Math.sin(i * 0.9) * e; R[i] = Math.sin(i * 0.9) * e; }
    const sp = C.rpIrSpectra(L, R, len);
    const bank = 1;
    const base = bank * C.RP_CONV.BANK_FLOATS;
    const irs = (off, cnt) => {
        const out = new Float32Array(cnt);
        for (let i = 0; i < cnt; i++) {
            const k = off + i - base;
            out[i] = k < 0 ? 0 : k < C.RP_CONV.HEAD_FLOATS ? (sp.head[k] || 0) : (sp.tail[k - C.RP_CONV.HEAD_FLOATS] || 0);
        }
        return out;
    };
    const hdr = new Float32Array(64);
    hdr[C.RP_HDR.IR_VER] = 4; hdr[C.RP_HDR.IR_BANK] = bank; hdr[C.RP_HDR.IR_NHEAD] = sp.nHead; hdr[C.RP_HDR.IR_NTAIL] = sp.nTail; hdr[C.RP_HDR.IR_LEN] = len;
    const f = load({ bufs: { h: hdr, irs } });
    f.ctx.rpT.s = activeScope(5);
    f.msg("set_algo", 5);
    f.ctx.names("x", "h", "sc", "sp", "ir", "irs", "irv");
    f.msg("state", "ir", "ready", 1, len, sr, 2, 0, "Test.wav");
    for (let i = 0; i < 200 && f.get("RCS.irRows === null"); i++) f.ctx.rcIrStep();
    assert(f.get("RCS.irRows !== null"), "spectrogram finished");
    assert.strictEqual(f.get("RCS.irVer"), 4);
    assert.strictEqual(f.get("RCS.irLen"), len);
    // the 0.9 rad/sample tone (about 6.9 kHz) is in the high bands, falling over the rows
    const rows = f.get("Array.from(RCS.irRows)");
    const band = 24;
    assert(rows[band] > rows[20 * 32 + band] + 10, "tone decays: " + rows[band] + " " + rows[20 * 32 + band]);
    f.calls.length = 0;
    f.ctx.paint();
    assert(f.calls.length > 200);
    // the same version is not computed twice
    f.msg("state", "ir", "ready", 1, len, sr, 2, 0, "Test.wav");
    assert.strictEqual(f.get("RCS.irBusy"), null);
});

test("an unreadable IR buffer does not throw or hang", () => {
    const hdr = new Float32Array(64);
    hdr[C.RP_HDR.IR_VER] = 1; hdr[C.RP_HDR.IR_BANK] = 0; hdr[C.RP_HDR.IR_NHEAD] = 4; hdr[C.RP_HDR.IR_NTAIL] = 3; hdr[C.RP_HDR.IR_LEN] = 20000;
    const f = load({ bufs: { h: hdr, irs: () => { throw new Error("nope"); } } });
    f.msg("set_algo", 5);
    f.ctx.names("x", "h", "sc", "sp", "ir", "irs", "irv");
    f.msg("state", "ir", "ready", 1, 20000, 48000, 2, 0, "x.wav");
    for (let i = 0; i < 5; i++) f.ctx.rcIrStep();
    f.ctx.paint();
});

// ---- the built device --------------------------------------------------------------------------------------------------------------
test("built device: swap block wiring, IR side hidden at save, tank side visible, no live.* over the hero, panels last, 169 px", () => {
    const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "rp_c_"));
    execFileSync("python3", [path.join(ROOT, "scripts", "build_reverbplus.py"), "--variant", "base", "--no-sets", "--out-dir", tmp], { cwd: ROOT, stdio: "pipe" });
    const buf = fs.readFileSync(path.join(tmp, "Reverb+.amxd"));
    const doc = JSON.parse(buf.slice(32, 32 + buf.readUInt32LE(28)).toString("utf8"));
    const boxes = doc.patcher.boxes.map((b) => b.box);
    const lines = doc.patcher.lines.map((l) => l.patchline);
    const byId = (id) => boxes.find((b) => b.id === id);
    assert.strictEqual(doc.patcher.openrect[3], 169);
    const viz = byId("obj-lay-base-viz");
    assert(viz && viz.numoutlets === 2);
    const has = (a, ao, b, bi) => lines.some((l) => l.source[0] === a && l.source[1] === ao && l.destination[0] === b && l.destination[1] === bi);
    assert(has("obj-lay-base-viz", 1, "obj-lay-base-route", 0) && has("obj-lay-base-viz", 0, "obj-route-face", 0));
    const tank = ["size", "diffusion", "modrate", "moddepth"], ir = ["irstretch", "irstart", "irdecay", "irreverse"];
    for (const k of tank) {
        assert(has("obj-lay-base-hide-tank", 0, "obj-ctrl-" + k, 0) && has("obj-lay-base-hide-tank", 0, "obj-lay-base-lbl-" + k, 0), "tank " + k);
        assert(!byId("obj-ctrl-" + k).hidden, k + " visible at save");
    }
    for (const k of ir) {
        assert(has("obj-lay-base-hide-ir", 0, "obj-ctrl-" + k, 0), "ir " + k);
        assert.strictEqual(byId("obj-ctrl-" + k).hidden, 1, k + " hidden at save");
    }
    // each IR widget sits exactly where its tank twin does
    tank.forEach((k, i) => assert.deepStrictEqual(byId("obj-ctrl-" + ir[i]).presentation_rect.slice(1, 2), byId("obj-ctrl-" + k).presentation_rect.slice(1, 2)));
    // the hidden Algorithm menu is off the face
    assert.strictEqual(byId("obj-ctrl-algo").presentation, 0);
    // rule 4
    const ov = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    for (const b of boxes) {
        if (!String(b.maxclass).startsWith("live.") || b.presentation !== 1 || b.maxclass === "live.comment") continue;
        assert(!ov(b.presentation_rect, viz.presentation_rect), b.id + " over the hero");
    }
    // bars: unique, all inside 692 x 169, none overlapping a visible neighbour
    const vis = boxes.filter((b) => /^live\.(numbox|text|menu|drop)$/.test(b.maxclass) && b.presentation === 1 && !b.hidden);
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) assert(!ov(vis[i].presentation_rect, vis[j].presentation_rect), `${vis[i].id} / ${vis[j].id}`);
    for (const b of vis) assert(b.presentation_rect[0] + b.presentation_rect[2] <= 692 && b.presentation_rect[1] + b.presentation_rect[3] <= 169, b.id);
    const first = boxes.findIndex((b) => b.maxclass === "panel");
    assert(boxes.slice(first).every((b) => b.maxclass === "panel" && b.background === 1));
    // every numbox pre-blends its slider colour (opaque, rule 8)
    for (const b of boxes.filter((x) => x.maxclass === "live.numbox")) assert.strictEqual(b.activeslidercolor[3], 1, b.id);
    assert(Buffer.byteLength(viz.textfile.text) < 200000);
    assert(!/(^|\n)\s*(var|let|const)\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(viz.textfile.text));
});

console.log(`${n} passed`);
