// Delay+ offline tests: config math, pairing, a sample-level reference of the cross-device
// latency-compensated loop, and structural checks of the built .amxd files.
// Run: node tests/test_delayplus.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const C = require("../src/delayplus_config.js");

const ROOT = path.join(__dirname, "..");
let failures = 0;
let passes = 0;

function test(name, fn) {
    try {
        fn();
        passes++;
        console.log("PASS " + name);
    } catch (err) {
        failures++;
        console.log("FAIL " + name + ": " + err.message);
    }
}

function near(a, b, tol, msg) {
    assert(Math.abs(a - b) <= tol, (msg || "") + ` expected ${b} got ${a}`);
}

// ---- config -------------------------------------------------------------------------------------
test("note values are ordered; 1/8 at 120 bpm is 250 ms, dotted 375, triplet 166.7", () => {
    for (let i = 1; i < C.DP_NOTE_BEATS.length; i++) assert(C.DP_NOTE_BEATS[i] > C.DP_NOTE_BEATS[i - 1]);
    const sync = (div, mode, offs) => ({ tmode: C.DP_TM.SYNC, div, mode, offs });
    near(C.dpSideMs(sync(3, 0, 0), 120), 250, 1e-9);
    near(C.dpSideMs(sync(3, 2, 0), 120), 375, 1e-9);
    near(C.dpSideMs(sync(3, 1, 0), 120), 500 / 3, 1e-9);
});

test("side time: free ms, offset in %, clamped to 1..8000 ms", () => {
    const time = (ms, offs) => ({ tmode: C.DP_TM.TIME, time: ms, offs });
    near(C.dpSideMs(time(300, 0), 120), 300, 1e-9);
    near(C.dpSideMs(time(300, 10), 120), 330, 1e-9);
    near(C.dpSideMs(time(300, -50), 120), 300 * 0.67, 1e-9); // offset clamps at -33%
    near(C.dpSideMs(time(0, 0), 120), 1, 0);
    near(C.dpSideMs({ tmode: C.DP_TM.SYNC, div: 8, mode: 2, offs: 33 }, 20), 8000, 0);
});

test("Fluid: note value times a free multiplier (0.02..50)", () => {
    near(C.dpSideMs({ tmode: C.DP_TM.FLUID, div: 3, fluid: 1.37 }, 120), 250 * 1.37, 1e-9);
    near(C.dpSideMs({ tmode: C.DP_TM.FLUID, div: 3, fluid: 20 }, 120), 5000, 1e-9);
    near(C.dpSideMs({ tmode: C.DP_TM.FLUID, div: 3, fluid: 0.02 }, 120), 5, 1e-9);
    near(C.dpSideMs({ tmode: C.DP_TM.FLUID, div: 3, fluid: 0.001 }, 120), 5, 1e-9); // clamps at 0.02
    near(C.dpSideMs({ tmode: C.DP_TM.FLUID, div: 3, fluid: 50 }, 120), 8000, 0); // 12.5 s -> the 8 s cap
});

test("Pitch / MIDI: one period of the note; folded to a whole multiple above the tank minimum", () => {
    assert.strictEqual(C.dpNoteName(60), "C3");
    assert.strictEqual(C.dpNoteName(57), "A2");
    assert.strictEqual(C.dpNoteName(0), "C-2");
    near(C.dpNotePeriodMs(69, 0), 1000 / 440, 1e-9);
    near(C.dpNotePeriodMs(57, 1200), 1000 / 440, 1e-9); // A2 (220 Hz) + an octave
    near(C.dpSideMs({ tmode: C.DP_TM.PITCH, note: 45, cents: 0 }, 120), 1000 / 110, 1e-9);
    // 220 Hz (4.545 ms) behind an 8 ms minimum loop: two periods (9.09 ms), still on A
    near(C.dpSideMs({ tmode: C.DP_TM.PITCH, note: 57, cents: 0 }, 120, { tminMs: 8 }), 2000 / 220, 1e-9);
    near(C.dpSideMs({ tmode: C.DP_TM.MIDI, note: 0, cents: 0 }, 120, { midiNote: 45 }), 1000 / 110, 1e-9);
    // highest note at its own pitch behind an 8 ms loop: 125 Hz -> B1 (123.5 Hz); C2 (130.8 Hz) folds
    assert.strictEqual(C.dpNoteName(C.dpMaxNote(8)), "B1");
    assert.strictEqual(C.dpMaxNote(0), 127);
    assert(C.dpPitchFolded({ tmode: C.DP_TM.PITCH, note: 48 }, { tminMs: 8 }));
    assert(!C.dpPitchFolded({ tmode: C.DP_TM.PITCH, note: 47 }, { tminMs: 8 }));
    assert(C.dpPitchFolded({ tmode: C.DP_TM.MIDI }, { tminMs: 8, midiNote: 60 }));
    assert(!C.dpPitchFolded({ tmode: C.DP_TM.MIDI }, { tminMs: 8, midiNote: -1 }));
    assert(!C.dpPitchFolded({ tmode: C.DP_TM.SYNC, note: 100 }, { tminMs: 8 }));
    // MIDI before any note arrives: the default note (A2)
    near(C.dpSideMs({ tmode: C.DP_TM.MIDI }, 120, { midiNote: -1 }), C.dpNotePeriodMs(C.DP_NOTE_DEFAULT, 0), 1e-9);
});

test("LFO rate: Hz, or one cycle per note value", () => {
    near(C.dpLfoHz(0, 3, 0, 120), 3, 0);
    near(C.dpLfoHz(1, 0, 3, 120), 2, 1e-9); // 1/4 at 120 bpm
    near(C.dpLfoHz(1, 0, 5, 120), 0.5, 1e-9); // 1 bar
});

test("effective times clamp at B + L + mod + 4", () => {
    const e = C.dpEffectiveTimes(1, 1, 48000, 32, 256, 0);
    assert(e.clamped);
    near(e.L, 32 + 256 + 4, 1e-9);
    const f = C.dpEffectiveTimes(100, 150, 48000, 32, 256, 0);
    assert(!f.clamped);
    near(f.L, 4800, 1e-9);
    near(f.R, 7200, 1e-9);
    near(C.dpEffectiveTimes(100, 100, 48000, 32, 256, 1).tmin, 32 + 256 + 384 + 4, 1e-9);
});

test("range warnings in each mode's own terms", () => {
    const ctx = { tminMs: 20 };
    // 120 bpm: 1/64 = 31.25 ms, 1/32 = 62.5 ms
    assert.strictEqual(C.dpSideWarn({ tmode: C.DP_TM.TIME, time: 10 }, 120, ctx), "MIN 20.0 ms");
    assert.strictEqual(C.dpSideWarn({ tmode: C.DP_TM.TIME, time: 300 }, 120, ctx), null);
    assert.strictEqual(C.dpSideWarn({ tmode: C.DP_TM.SYNC, div: 0, mode: 1 }, 120, ctx), null); // 1/64 T = 20.8 ms
    assert.strictEqual(C.dpSideWarn({ tmode: C.DP_TM.SYNC, div: 0, mode: 1 }, 120, { tminMs: 25 }), "MIN 1/32 T");
    assert.strictEqual(C.dpSideWarn({ tmode: C.DP_TM.SYNC, div: 8, mode: 2 }, 60, ctx), "MAX 1 D"); // 4 bars D = 24 s
    assert.strictEqual(C.dpSideWarn({ tmode: C.DP_TM.FLUID, div: 3, fluid: 0.02 }, 120, ctx), "MIN x0.08");
    assert.strictEqual(C.dpSideWarn({ tmode: C.DP_TM.FLUID, div: 3, fluid: 50 }, 120, ctx), "MAX x32.00");
    assert.strictEqual(C.dpSideWarn({ tmode: C.DP_TM.FLUID, div: 3, fluid: 1 }, 120, ctx), null);
    // 20 ms loop: 50 Hz is the top, so G0 (49 Hz) plays at pitch, A2 folds
    assert.strictEqual(C.dpSideWarn({ tmode: C.DP_TM.PITCH, note: 57 }, 120, ctx), "MAX G0");
    assert.strictEqual(C.dpSideWarn({ tmode: C.DP_TM.PITCH, note: 30 }, 120, ctx), null);
    assert.strictEqual(C.dpSideWarn({ tmode: C.DP_TM.MIDI }, 120, { tminMs: 20, midiNote: -1 }), null);
});

test("rack latency: the longest chain, racks inside racks too", () => {
    assert.strictEqual(C.dpDeviceLatency({ lat: 256 }), 256);
    // Limiter (64) inside a rack that reports 0
    assert.strictEqual(C.dpDeviceLatency({ lat: 0, chains: [[{ lat: 64 }]] }), 64);
    // two chains: 64 + 128 in series vs 100 -> 192
    assert.strictEqual(C.dpDeviceLatency({ lat: 0, chains: [[{ lat: 64 }, { lat: 128 }], [{ lat: 100 }]] }), 192);
    // nested rack inside a chain, plus a device after it
    assert.strictEqual(C.dpDeviceLatency({ lat: 0, chains: [[{ lat: 0, chains: [[{ lat: 256 }]] }, { lat: 32 }]] }), 288);
    // a rack that does report its latency keeps the larger value
    assert.strictEqual(C.dpDeviceLatency({ lat: 300, chains: [[{ lat: 64 }]] }), 300);
});

// Filter Display mouse: run the real script (config + spectrum + filter) against a stub mgraphics.
function loadFilterDisplay() {
    const vm = require("vm");
    const out = [];
    const noop = () => {};
    const mg = new Proxy({ size: [260, 66], text_measure: () => [10, 8] }, {
        get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; },
    });
    const ctx = { mgraphics: mg, outlet: (i, ...a) => out.push(a), post: noop, Math, Number, String, Array, JSON, isNaN };
    vm.createContext(ctx);
    const src = ["delayplus_config.js", "delayplus_spectrum.js", "delayplus_filter.js"]
        .map((f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8")).join("\n");
    vm.runInContext(src, ctx);
    const handle = (i) => {
        const w = 260, h = 66;
        const [px, py] = vm.runInContext(`fdHandle(${i}, ${w}, ${h})`, ctx);
        return [px, Math.max(7, Math.min(h - 7, py))];
    };
    return { ctx, out, handle, get: (k) => vm.runInContext(k, ctx) };
}

test("no Delay+ script redeclares Max's reserved v8ui globals", () => {
    // `var box = ...` in delayplus_filter.js crashed Live on the first mouse drag (Max reads its own
    // `box` accessor in pointer events). Same risk for the other built-ins Max provides.
    const reserved = ["box", "patcher", "max", "messagename", "inlet", "jsarguments"];
    for (const f of fs.readdirSync(path.join(ROOT, "src")).filter((n) => /^delayplus_.*\.js$/.test(n))) {
        const code = fs.readFileSync(path.join(ROOT, "src", f), "utf8");
        for (const r of reserved) {
            assert(!new RegExp("(^|\\n)\\s*(var|let|const|function)\\s+" + r + "\\b").test(code), `${f} declares ${r}`);
            assert(!new RegExp("(^|[^.\\w])" + r + "\\s*=[^=]").test(code), `${f} assigns ${r}`);
        }
    }
});

test("Filter Display: box-select both filters, drag one, both move together", () => {
    const d = loadFilterDisplay();
    const hp0 = d.get("hp"), lp0 = d.get("lp");
    // box over the whole display selects both handles
    d.ctx.onclick(1, 1, 1, 0, 0);
    d.ctx.ondrag(259, 65, 1, 0, 0);
    d.ctx.ondrag(259, 65, 0, 0, 0); // release
    assert.deepStrictEqual(Array.from(d.get("sel")), [1, 1]);
    // drag handle 1 by +26 px (1/10 of the width = 1/10 of the 3-decade range) and up 6 px
    const [x, y] = d.handle(0);
    d.ctx.onclick(x, y, 1, 0, 0);
    d.ctx.ondrag(x + 26, y - 6, 1, 0, 0);
    const ratio = Math.pow(1000, 0.1);
    near(d.get("hp") / hp0, ratio, 1e-9);
    near(d.get("lp") / lp0, ratio, 1e-9);
    near(d.get("hpres"), 0.1, 1e-9);
    near(d.get("lpres"), 0.1, 1e-9);
    // a click on empty space clears the selection; then a handle drag moves only that filter
    d.ctx.onclick(130, 2, 1, 0, 0);
    d.ctx.ondrag(130, 2, 0, 0, 0);
    assert.deepStrictEqual(Array.from(d.get("sel")), [0, 0]);
    const lpBefore = d.get("lp");
    const [x2, y2] = d.handle(0);
    d.ctx.onclick(x2, y2, 1, 0, 0);
    d.ctx.ondrag(x2 + 26, y2, 1, 0, 0);
    near(d.get("lp"), lpBefore, 0);
    // shift-click adds the other handle to the selection
    const [x3, y3] = d.handle(1);
    d.ctx.onclick(x3, y3, 1, 0, 1);
    assert.deepStrictEqual(Array.from(d.get("sel")), [1, 1]);
});

test("side labels", () => {
    assert.strictEqual(C.dpSideLabel({ tmode: C.DP_TM.SYNC, div: 3, mode: 0 }), "1/8");
    assert.strictEqual(C.dpSideLabel({ tmode: C.DP_TM.SYNC, div: 3, mode: 2 }), "1/8 D");
    assert.strictEqual(C.dpSideLabel({ tmode: C.DP_TM.TIME, time: 375 }), "375 ms");
    assert.strictEqual(C.dpSideLabel({ tmode: C.DP_TM.FLUID, div: 3, fluid: 1.37 }), "1/8 x1.37");
    assert.strictEqual(C.dpSideLabel({ tmode: C.DP_TM.PITCH, note: 45, cents: 12 }), "A1 +12 ct");
    assert.strictEqual(C.dpSideLabel({ tmode: C.DP_TM.MIDI, cents: 0 }, 57), "MIDI A2");
    assert.strictEqual(C.dpSideLabel({ tmode: C.DP_TM.MIDI }, -1), "MIDI -");
});

test("path parsing", () => {
    assert.deepStrictEqual(C.dpParseDevicePath("live_set tracks 0 devices 0 chains 1 devices 3"),
        { parent: "live_set tracks 0 devices 0 chains 1", index: 3 });
    assert.strictEqual(C.dpParseDevicePath("live_set tracks 0"), null);
    assert.deepStrictEqual(C.dpExtractIds(["id", 4, "id", 9]), [4, 9]);
});

test("pairing is bracket matching (nested pairs, extra devices, orphans)", () => {
    const r = ["start", null, "start", null, "end", null, "end"];
    assert.strictEqual(C.dpFindPartner(r, 0), 6);
    assert.strictEqual(C.dpFindPartner(r, 6), 0);
    assert.strictEqual(C.dpFindPartner(r, 2), 4);
    assert.strictEqual(C.dpFindPartner(r, 4), 2);
    assert.strictEqual(C.dpFindPartner(["start", null], 0), -1);
    assert.strictEqual(C.dpFindPartner([null, "end"], 1), -1);
    assert.strictEqual(C.dpFindPartner(["end", "start"], 1), -1);
    // two sequential pairs
    const s = ["start", "end", "start", null, "end"];
    assert.strictEqual(C.dpFindPartner(s, 2), 4);
    assert.strictEqual(C.dpFindPartner(s, 1), 0);
});

test("chain latency sums only the devices between the pair", () => {
    assert.strictEqual(C.dpChainLatency([0, 256, 100, 0, 999], 0, 3), 356);
    assert.strictEqual(C.dpChainLatency([0, 256, 100, 0], 3, 0), 356);
});

test("registry roles go stale", () => {
    const reg = { 4: { role: "start", t: 1000 } };
    assert.strictEqual(C.dpRoleOf(reg, 4, 2000), "start");
    assert.strictEqual(C.dpRoleOf(reg, 4, 1000 + C.DP_REG_STALE_MS + 1), null);
    assert.strictEqual(C.dpRoleOf(reg, 5, 2000), null);
});

// ---- reference simulation of the two-device loop --------------------------------------------------
// Model measured in Live 12 (1 and 3 pairs, ping-verified): Start and End each process whole
// vectors of V samples; End never runs ahead of Start in audio terms, Start may run up to two
// vectors ahead. Counters have an arbitrary offset K. Mirrors the gen cores:
//   End:   K = min(cS_latest - cE); dry read at Start index cE + K - L.
//   Start: Smax = max(cS - cE_latest); return read at End index s - Smax and added into the tank
//          at s - B - L with B = Smax - K; tap at s - T.
function simulate({ T, L, V, fb, chainGain, n, startOffset, seed }) {
    const M = 4194304;
    const RING = 65536;
    const TANK = 1 << 19;
    const wd = (x) => { let y = x % M; if (y >= M / 2) y -= M; if (y < -M / 2) y += M; return y; };
    const wrap = (x, m) => ((x % m) + m) % m;
    let rnd = seed;
    const rand = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
    const xferDry = new Float64Array(RING);
    const xferRet = new Float64Array(RING);
    const tank = new Float64Array(TANK);
    const startOut = new Float64Array(n + 4 * V);
    const hdr = { cS: startOffset, cE: 0, K: 0, B: V };
    let cS = startOffset;
    let cE = 0;
    let smax = -Infinity;
    let kmin = Infinity;
    let sFrames = 0;
    let eFrames = 0;
    const out = new Array(n).fill(null);
    const PRE = 4096;
    const input = (i) => (i === PRE ? 1 : 0);
    const frames = Math.floor(n / V);
    while (eFrames < frames) {
        const a = sFrames - eFrames;
        let doStart;
        if (a <= 0) doStart = true;
        else if (a >= 2) doStart = false;
        else doStart = rand() < 0.5;
        if (doStart) {
            for (let i = 0; i < V; i++) {
                const t = sFrames * V + i;
                cS = (cS + 1) % M;
                hdr.cS = cS;
                smax = Math.max(smax, wd(cS - hdr.cE));
                const K = Number.isFinite(kmin) ? kmin : 0;
                const B = Math.max(1, smax - K);
                hdr.B = B;
                const x = input(t);
                xferDry[wrap(cS, RING)] = x;
                tank[wrap(cS, TANK)] = x;
                tank[wrap(cS - B - L, TANK)] += xferRet[wrap(cS - smax, RING)] * fb;
                startOut[t] = tank[wrap(cS - T, TANK)];
            }
            sFrames++;
        } else {
            for (let i = 0; i < V; i++) {
                const t = eFrames * V + i;
                cE = (cE + 1) % M;
                hdr.cE = cE;
                kmin = Math.min(kmin, wd(hdr.cS - cE));
                hdr.K = kmin;
                const wet = t - L >= 0 ? startOut[t - L] * chainGain : 0;
                xferRet[wrap(cE, RING)] = wet;
                const dry = xferDry[wrap(cE + kmin - L, RING)];
                out[t] = { dry, wet };
            }
            eFrames++;
        }
    }
    return { out: out.slice(PRE), K: hdr.K, B: hdr.B };
}

for (const cfg of [
    { T: 1000, L: 0, V: 32, fb: 0.5, chainGain: 1 },
    { T: 1000, L: 256, V: 32, fb: 0.5, chainGain: 1 },
    { T: 777, L: 300, V: 64, fb: 0.6, chainGain: 0.8 },
    { T: 2000, L: 1500, V: 128, fb: 0.5, chainGain: 1 },
]) {
    for (const seed of [1, 7, 12345]) {
        test(`reference loop: echoes on n*T (T=${cfg.T}, L=${cfg.L}, V=${cfg.V}, seed ${seed})`, () => {
            const startOffset = 1000 + seed * 37;
            const sim = simulate({ ...cfg, n: cfg.T * 5 + cfg.L + 4096, startOffset, seed });
            assert.strictEqual(sim.K, startOffset, "K");
            assert(sim.B >= cfg.V && sim.B <= 2 * cfg.V, "B within 1..2 vectors: " + sim.B);
            // Output is compensated by L (Live's PDC delays the track by the chain latency).
            const off = cfg.L;
            const wet = sim.out.map((o) => (o ? o.wet : 0)).slice(off);
            const dry = sim.out.map((o) => (o ? o.dry : 0)).slice(off);
            near(dry[0], 1, 1e-12, "dry aligned");
            for (let k = 1; k <= 4; k++) {
                const expect = cfg.chainGain * Math.pow(cfg.fb * cfg.chainGain, k - 1);
                near(wet[k * cfg.T], expect, 1e-9, `echo ${k} at ${k * cfg.T}`);
                near(wet[k * cfg.T - 1], 0, 1e-12, `nothing before echo ${k}`);
            }
        });
    }
}

test("echo tap model", () => {
    const taps = C.dpEchoTaps(4800, 0.5, 1, 3, 48000);
    near(taps[0].ms, 100, 1e-9);
    near(taps[2].gain, 0.25, 1e-12);
});

// ---- built devices -----------------------------------------------------------------------------
function loadAmxd(name) {
    const p = path.join(ROOT, "devices", name + ".amxd");
    const buf = fs.readFileSync(p);
    assert.strictEqual(buf.slice(0, 4).toString(), "ampf");
    assert.strictEqual(buf.slice(8, 12).toString(), "aaaa");
    const len = buf.readUInt32LE(28);
    assert.strictEqual(32 + len, buf.length, "header length");
    return JSON.parse(buf.slice(32).toString("utf8")).patcher;
}

function rect(b) {
    return b.presentation_rect;
}

function overlaps(a, b) {
    return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

const devices = fs.readdirSync(path.join(ROOT, "devices"))
    .filter((f) => /^Delay\+( .*)?\.amxd$/.test(f))
    .map((f) => f.slice(0, -5));

for (const name of devices) {
    test(`${name}: 169 px, presentation, panels last, no live.* over v8ui, --- buffers`, () => {
        const p = loadAmxd(name);
        assert.strictEqual(p.openrect[3], 169);
        assert.strictEqual(p.openinpresentation, 1);
        const boxes = p.boxes.map((b) => b.box);
        const firstPanel = boxes.findIndex((b) => b.maxclass === "panel");
        if (firstPanel >= 0) {
            for (let i = firstPanel; i < boxes.length; i++) {
                assert.strictEqual(boxes[i].maxclass, "panel", "panels must be last");
                assert.strictEqual(boxes[i].background, 1);
            }
        }
        const uis = boxes.filter((b) => b.maxclass === "v8ui" && b.presentation);
        const lives = boxes.filter((b) => /^live\.(dial|numbox|text|tab|menu|slider)$/.test(b.maxclass) && b.presentation);
        // Widgets that start hidden may share a rect with a v8ui (the page and Time Mode switches send
        // `hidden` to both, so they are never clickable at the same time); visible ones never.
        for (const u of uis) for (const l of lives) {
            if (u.hidden || l.hidden) continue;
            assert(!overlaps(rect(u), rect(l)), `${l.varname} overlaps v8ui`);
        }
        for (const b of [...uis, ...lives]) {
            const r = rect(b);
            assert(r[1] >= 0 && r[1] + r[3] <= 169 && r[0] >= 0 && r[0] + r[2] <= p.devicewidth, `${b.id} in bounds`);
        }
        for (const b of boxes) {
            // Max for Live expands `---` to a per-device id; `#0` is only expanded inside abstractions
            // (in Live, a `#0-` name stayed literal and every instance shared the buffer).
            if (b.maxclass === "newobj" && /^buffer~ /.test(b.text)) assert(/^buffer~ ---/.test(b.text), b.text);
            if (/#0-/.test(b.text || "")) assert.fail("#0- name in " + b.id + ": " + b.text);
        }
        const code = uis[0].textfile.text;
        assert(/mgraphics\.relative_coords = 0/.test(code));
        assert(/function init_link/.test(code));
        assert(/function names/.test(code));
    });
}

for (const name of devices.filter((n) => n !== "Delay+ End")) {
    test(`${name}: every parameter reaches the face (set_*) and gen params reach gen`, () => {
        const p = loadAmxd(name);
        const boxes = p.boxes.map((b) => b.box);
        const code = boxes.find((b) => b.id === "obj-viz").textfile.text;
        const genCode = boxes.find((b) => b.id === "obj-gen").code;
        for (const b of boxes) {
            if (/^prepend set_/.test(b.text || "")) {
                const fn = b.text.split(" ")[1];
                assert(/function anything\(/.test(code) || new RegExp("function " + fn + "\\(").test(code), fn + " missing in UI");
            } else if (/^prepend /.test(b.text || "") && p.lines.some((l) => l.patchline.source[0] === b.id
                && l.patchline.destination[0] === "obj-gen")) {
                const prm = b.text.split(" ")[1];
                assert(new RegExp("Param " + prm + "\\(").test(genCode), prm + " missing in gen");
            }
        }
        assert(/function vizDraw/.test(code));
    });
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
