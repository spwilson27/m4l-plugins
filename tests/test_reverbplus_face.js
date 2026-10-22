#!/usr/bin/env node
"use strict";
// Reverb+ face (scripts/reverbplus_layouts/base.py, "Hybrid tabs") tests (`node tests/test_reverbplus_face.js`): canvas
// geometry, the Tone tab's EQ maths and nodes, the Tail tab's bars (scales vs the build's parameter table, layout, drags), the
// tab / algorithm visibility rules, the display v8ui (incl. its idle redraw policy), the IR box v8uis against a fake mgraphics, and the
// built device (every parameter presented or off-face, the show / hide wiring, no overlap of interactive rects on any tab /
// algorithm, separators inside their panels).
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8");
const C = require("../src/reverbplus_config.js");
const M = (() => {
    const ctx = { module: { exports: {} }, Math, Float32Array, Float64Array, Int32Array, Array, Number, String };
    vm.createContext(ctx);
    vm.runInContext(read("reverbplus_config.js") + "\n" + read("reverbplus_face_math.js"), ctx);
    return ctx.module.exports;
})();

let n = 0;
function test(name, fn) {
    try { fn(); n++; console.log("PASS " + name); } catch (e) { console.log("FAIL " + name + ": " + e.stack.split("\n").slice(0, 3).join(" | ")); process.exitCode = 1; }
}

// ---- face harness ---------------------------------------------------------------------------------------------------------
function load(files, size, preamble) {
    const calls = [];
    const out = [];
    const clock = { now: 100000 };
    const bufs = {};
    const mg = new Proxy({ size: size, text_measure: (t) => [String(t).length * 5, 8] }, {
        get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); return 0; }), set: (t, k, v) => { t[k] = v; return true; },
    });
    function FakeBuffer(name) { this.peek = (ch, off, cnt) => (bufs[name] ? bufs[name].slice(off, off + cnt) : []); }
    function FakeTask(fn) { this.fn = fn; this.repeat = () => {}; this.cancel = () => {}; this.schedule = () => {}; }
    const ctx = {
        mgraphics: mg, outlet: (...a) => out.push(a), post: () => {}, Math, Number, String, Array, JSON, isNaN, Float32Array, Float64Array, Int32Array,
        Object, Date: { now: () => clock.now }, Buffer: FakeBuffer, Task: FakeTask, messagename: "", globalThis: {},
    };
    vm.createContext(ctx);
    vm.runInContext((preamble || "") + "\n" + [read("reverbplus_config.js"), read("reverbplus_face_common.js")].concat(files.map(read)).join("\n"), ctx);
    const msg = (name, ...args) => { ctx.messagename = name; ctx.anything(...args); };
    return { ctx, calls, out, msg, clock, bufs };
}
const loadViz = (h) => load(["reverbplus_face_math.js", "reverbplus_face.js"], [316, h || 104]);

function visState(f) {
    const st = {};
    for (const a of f.out) if (a[0] === 1 && String(a[1]).startsWith("g_")) st[a[1].slice(2)] = a[2];
    return st;
}

// ---- geometry -------------------------------------------------------------------------------------------------------------
test("display canvas: info row, waterfall, dry / wet strip and the EQ view fit 316 x 104 and the hit areas do not overlap", () => {
    const L = M.rcLayout(316, 104);
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const r of [L.info, L.plot, L.strip, L.tone]) assert(r.x >= 0 && r.y >= 0 && r.x + r.w <= 316 && r.y + r.h <= 104, JSON.stringify(r));
    assert(!ov(L.plot, L.strip) && !ov(L.info, L.plot) && !ov(L.info, L.strip));
    const g0 = M.rcRowGeom(0), g1 = M.rcRowGeom(1);
    assert(g0.base - g0.hmax >= L.plot.y && g1.base - g1.hmax >= L.plot.y, "ridges stay inside the plot");
    assert(g0.base <= L.plot.y + L.plot.h, "front row base inside the plot");
    const T = M.rbTailLayout(316);
    const boxes = T.rows.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })).concat(T.titles.map((t) => ({ x: t.x, y: t.y, w: t.w, h: 12 })));
    for (const r of boxes) assert(r.x >= 0 && r.y >= 12 && r.x + r.w <= 316 && r.y + r.h <= 135, JSON.stringify(r));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert(!ov(boxes[i], boxes[j]), `tail items ${i} / ${j} overlap`);
    assert(T.div.x > 154 && T.div.x < 166 && T.hint.y + 3 <= 135 && T.led.x + 6 <= 316);
});

// ---- Tone page maths ------------------------------------------------------------------------------------------------------
test("EQ view: x / y mappings invert, the filters are -3 dB at their cutoffs, the decay curve follows bass and damping", () => {
    for (const f of [20, 60, 350, 1000, 7000, 20000]) assert(Math.abs(M.rbToneF(M.rbToneX(f)) / f - 1) < 1e-9, "f " + f);
    for (const d of [-12, -3, 0, 6, 12]) assert(Math.abs(M.rbToneDb(M.rbToneY(d)) - d) < 1e-9);
    assert(M.rbToneX(20) === M.rcLayout(316, 104).tone.x && Math.abs(M.rbToneX(20000) - M.RBT.x1) < 1e-9);
    assert(Math.abs(M.rbFilterDb(60, 60, 1e9) + 3.01) < 0.02, "low cut -3 dB at its cutoff");
    assert(Math.abs(M.rbFilterDb(16000, 1, 16000) + 3.01) < 0.02, "high cut -3 dB at its cutoff");
    assert(Math.abs(M.rbFilterDb(1000, 60, 16000)) < 0.1, "flat in the middle");
    assert(M.rbFilterDb(30, 60, 16000) < -12 && M.rbFilterDb(20000, 60, 16000) < -3, "rolls off both ends");
    // bass multiplier raises decay below the crossover, damping lowers it above the HF Damp frequency
    assert(M.rbDecayDb(60, 2, 350, 20000) > 5 && Math.abs(M.rbDecayDb(5000, 2, 350, 20000)) < 0.8);
    assert(M.rbDecayDb(12000, 1, 350, 4000) < M.rbDecayDb(2000, 1, 350, 4000) - 3, "HF damping");
    assert(Math.abs(M.rbDecayDb(500, 1, 350, 20000)) < 0.5, "neutral bass and damping = flat");
});

test("EQ nodes: four on Hall (Low Cut, High Cut, HF Damp, Bass), three where Bass Mult does not apply; hit test and drag round-trip", () => {
    const p = { lowcut: 60, highcut: 16000, damp: 7000, bassmult: 1.6, xover: 350 };
    const nodes = M.rbNodes(p, true);
    assert.strictEqual(nodes.map((x) => x.key).join(), "lowcut,highcut,damp,bassmult");
    assert.strictEqual(M.rbNodes(p, false).length, 3);
    // the nodes stay apart in the default state (so a click picks one)
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(M.rbToneX(nodes[i].f) - M.rbToneX(nodes[j].f), M.rbToneY(nodes[i].db) - M.rbToneY(nodes[j].db));
        assert(d > 20, `nodes ${i} / ${j} are ${d} px apart`);
    }
    nodes.forEach((nd, i) => assert.strictEqual(M.rbHitNode(nodes, M.rbToneX(nd.f) + 2, M.rbToneY(nd.db) - 2, 9), i));
    assert.strictEqual(M.rbHitNode(nodes, 200, 20, 9), -1);
    // dragging a node onto its own position writes the same value back
    for (const nd of nodes) {
        const v = M.rbNodeDrag(nd, M.rbToneX(nd.f), M.rbToneY(nd.db));
        if (nd.key === "bassmult") { assert(Math.abs(v.bassmult - 1.6) < 1e-6 && Math.abs(v.xover - 350) < 1e-6, JSON.stringify(v)); }
        else assert(Math.abs(v[nd.key] / p[nd.key] - 1) < 1e-6, nd.key);
    }
    // limits
    assert.strictEqual(M.rbNodeDrag(nodes[0], M.RBT.x1, 50).lowcut, 1000);
    assert.strictEqual(M.rbNodeDrag(nodes[1], M.RBT.x0, 50).highcut, 1000);
    assert.strictEqual(M.rbNodeDrag(nodes[2], M.RBT.x1, 50).damp, 20000);
    const hi = M.rbNodeDrag(nodes[3], 100, M.rbToneY(-15));
    assert.strictEqual(hi.bassmult, 0.25);
    assert.strictEqual(M.rbNodeDrag(nodes[3], 100, M.rbToneY(15)).bassmult, 4);
});

// ---- visibility -----------------------------------------------------------------------------------------------------------
test("page / algorithm visibility follows RP_INACTIVE: tank controls hide in Convolution, IR controls only there, Bass only where it applies", () => {
    for (let algo = 0; algo < 6; algo++) {
        const off = C.RP_INACTIVE[algo];
        const v0 = M.rbVis(0, algo), v1 = M.rbVis(1, algo), v2 = M.rbVis(2, algo);
        assert.strictEqual(v0.tank, off.indexOf("size") < 0 && v0.rev);
        assert.strictEqual(v0.ir, algo === C.RP_ALGO.CONV);
        assert.strictEqual(v0.tank, !v0.ir);
        assert.strictEqual(v1.tonebass, off.indexOf("bassmult") < 0);
        assert.strictEqual(v0.freeze, off.indexOf("freeze") < 0);
        assert(v0.rev && !v0.tone && v1.tone && !v1.rev && !v1.tank && !v1.ir && !v2.rev && !v2.tone && !v2.tank && !v2.ir && !v2.tonebass);
        // the left column's second dial: Decay, or IR Decay in Convolution
        assert.strictEqual(v0.decay, algo !== C.RP_ALGO.CONV);
        assert.strictEqual(v0.irdecay, algo === C.RP_ALGO.CONV);
        assert.strictEqual(v0.decay, off.indexOf("decay") < 0);
        assert.strictEqual(v0.irdecay, off.indexOf("irdecay") < 0);
        // the hairline above the LCD row goes with the Tail tab's taller display
        assert(v0.lcdsep && v1.lcdsep && !v2.lcdsep);
        assert(!M.rbTall(0) && !M.rbTall(1) && M.rbTall(2));
    }
});

test("the layout module's static visibility equals rbVis for every page and algorithm (same table in both languages)", () => {
    const out = execFileSync("python3", ["-c",
        "import sys, json; sys.path.insert(0, 'scripts'); from reverbplus_layouts import base;" +
        "print(json.dumps({f'{p}{a}': base.visible_groups(p, a) for p in range(3) for a in range(6)}))"], { cwd: ROOT }).toString();
    const py = JSON.parse(out);
    for (let p = 0; p < 3; p++) for (let a = 0; a < 6; a++) assert.strictEqual(JSON.stringify(py[`${p}${a}`]), JSON.stringify(M.rbVis(p, a)), `page ${p} algo ${a}`);
});

// ---- the display v8ui -------------------------------------------------------------------------------------------------------
function setupLive(f, algo, page) {
    f.msg("set_algo", algo);
    f.msg("set_page", page);
    f.ctx.names("x", "h", "sc", "sp", "ir", "irs", "irv");
    f.msg("state", "dsp", 1, "-");
    f.msg("state", "link", 1, "linked", 256, 3);
}

test("display v8ui emits g_<group> hide flags and viz_tall for every page x algorithm, only on change", () => {
    const f = loadViz();
    const state = {};
    for (let algo = 0; algo < 6; algo++) for (let page = 0; page < 3; page++) {
        f.out.length = 0;
        f.msg("set_algo", algo);
        f.msg("set_page", page);
        Object.assign(state, visState(f));
        const want = M.rbVis(page, algo);
        for (const g of M.RB_GROUPS) assert.strictEqual(state[g], want[g] ? 0 : 1, `algo ${algo} page ${page} group ${g}`);
        const tall = f.out.filter((a) => a[0] === 1 && a[1] === "viz_tall");
        if (tall.length) assert.strictEqual(tall[tall.length - 1][2], page === 2 ? 1 : 0);
        assert.strictEqual(f.ctx.RCS.last.tall, page === 2 ? 1 : 0);
    }
    f.out.length = 0;
    f.msg("set_page", 2); f.msg("set_page", 2); f.msg("set_decay", 3);
    assert.strictEqual(visState(f).lcdsep, undefined, "an unchanged state emits nothing");
    assert(!f.out.some((a) => a[1] === "viz_tall"));
});

test("paint runs on every page / algorithm (idle and with telemetry) and the Tone / Tail pages draw their content", () => {
    for (let algo = 0; algo < 6; algo++) for (let page = 0; page < 3; page++) {
        const f = loadViz(page === 2 ? 135 : 104);
        setupLive(f, algo, page);
        f.ctx.rpT.s = activeScope(algo);
        f.ctx.rpT.active = true;
        f.ctx.paint();
        assert(f.calls.some((c) => c[0] === "show_text"), `text drawn: algo ${algo} page ${page}`);
        if (page === 1) assert(f.calls.filter((c) => c[0] === "ellipse").length >= (M.rbVis(1, algo).tonebass ? 4 : 3), "EQ nodes");
        if (page === 2) for (const t of ["MODULATION", "LEVELS", "DUCKING", "CLIP"]) assert(f.calls.some((c) => c[0] === "show_text" && c[1] === t), t);
    }
});

function activeScope(algo) {
    const s = C.RP_SCOPE;
    const a = new Float32Array(C.RP_SCOPE_SAMPS);
    a[s.FRAMES] = 5; a[s.SR] = 48000; a[s.ALGO] = algo; a[s.IN_PK] = 0.3; a[s.WET_PK] = 0.2; a[s.RT60_MID] = 2.5; a[s.RT60_LO] = 3; a[s.RT60_HI] = 1;
    a[s.LOOP_MS] = 120; a[s.CLAMPED] = 1; a[s.MIN_MS] = 8;
    return a;
}

test("Tone page: dragging a node sends the parameter through rpSend, double-click resets, Bass moves Crossover and Bass Mult", () => {
    const f = loadViz();
    setupLive(f, 1, 1);
    for (const [k, v] of [["lowcut", 60], ["highcut", 16000], ["damp", 7000], ["bassmult", 1.2], ["xover", 350]]) f.msg("set_" + k, v);
    f.out.length = 0;
    f.ctx.onclick(M.rbToneX(60), M.rbToneY(-3), 1);
    f.ctx.ondrag(M.rbToneX(200), M.rbToneY(-3), 1);
    const sent = f.out.filter((a) => a[0] === 0 && a[1] === "param");
    assert(sent.length >= 1 && sent[sent.length - 1][2] === "lowcut" && Math.abs(sent[sent.length - 1][3] / 200 - 1) < 0.03, JSON.stringify(sent));
    f.msg("set_lowcut", 200);
    f.out.length = 0;
    f.ctx.ondblclick(M.rbToneX(60), M.rbToneY(-3));
    assert(!f.out.some((a) => a[1] === "param"), "double-click away from a node does nothing");
    f.ctx.ondblclick(M.rbToneX(200), M.rbToneY(-3));
    assert(f.out.some((a) => a[1] === "param" && a[2] === "lowcut" && a[3] === 60), "double-click resets Low Cut to 60 Hz");
    // bass node
    f.out.length = 0;
    const p = { lowcut: 60, highcut: 16000, damp: 7000, bassmult: 1.2, xover: 350 };
    const bn = M.rbNodes(p, true)[3];
    f.ctx.onclick(M.rbToneX(bn.f), M.rbToneY(bn.db), 1);
    f.ctx.ondrag(M.rbToneX(200), M.rbToneY(bn.db + 3), 1);
    const keys = new Set(f.out.filter((a) => a[1] === "param").map((a) => a[2]));
    assert(keys.has("xover") && keys.has("bassmult"), [...keys].join());
    // a node press never starts a band pick on the Tone page, and Plate has no Bass node to grab
    const g = loadViz();
    setupLive(g, 0, 1);
    for (const [k, v] of [["lowcut", 60], ["highcut", 16000], ["damp", 7000], ["bassmult", 1.2], ["xover", 350]]) g.msg("set_" + k, v);
    g.out.length = 0;
    g.ctx.onclick(M.rbToneX(350), M.rbToneY(M.rbDecayDb(350, 1, 350, 7000)), 1);
    g.ctx.ondrag(M.rbToneX(500), 60, 1);
    assert(!g.out.some((a) => a[2] === "xover" || a[2] === "bassmult"), "Plate: no Bass node");
});

test("Reverb page: the display is not a control (clicks, drags and double-clicks send nothing); Convolution without an IR browses; the Tail page's empty space ignores clicks", () => {
    const f = loadViz();
    setupLive(f, 1, 0);
    f.out.length = 0;
    const g = M.rcRowGeom(0);
    f.ctx.onclick(M.rcBandX(10, g.s), g.base - 2, 1);
    f.ctx.ondrag(M.rcBandX(20, g.s), g.base - 2, 1);
    f.ctx.ondrag(M.rcBandX(20, g.s), g.base - 2, 0);
    f.ctx.ondblclick(1, 1);
    assert.strictEqual(f.out.filter((a) => a[0] === 0).length, 0);
    const c = loadViz();
    setupLive(c, 5, 0);
    c.msg("state", "ir", "idle", 0, 0, 0, 0, 0, "-");
    c.out.length = 0;
    c.ctx.onclick(100, 40, 1);
    assert.deepStrictEqual(c.out.filter((a) => a[0] === 0), [[0, "cmd", "browse_ir"]]);
    const l = loadViz(135);
    setupLive(l, 1, 2);
    l.ctx.onclick(100, 63, 1); // empty space between the Tail rows
    assert(!l.out.some((a) => a[0] === 0 && a[1] === "param"));
});

// ---- the Tail tab ---------------------------------------------------------------------------------------------------------------
test("REP scales and defaults equal the build's parameter table; rcPos / rcVal round-trip", () => {
    const table = JSON.parse(execFileSync("python3", ["-c",
        "import sys,json; sys.path.insert(0,'scripts'); import build_reverbplus as b; print(json.dumps({k:[v[2],v[3],v[7],v[4]] for k,v in b.P.items()}))"], { cwd: ROOT }).toString());
    for (const [k, e] of Object.entries(M.REP)) assert.deepStrictEqual(Array.from(e), table[k], k);
    for (const k of Object.keys(M.REP)) {
        for (const p of [0, 0.1, 0.37, 0.5, 0.9, 1]) assert(Math.abs(M.rcPos(k, M.rcVal(k, p)) - p) < 1e-9, k);
        assert(Math.abs(M.rcVal(k, 0) - M.REP[k][0]) < 1e-9 && Math.abs(M.rcVal(k, 1) - M.REP[k][1]) < 1e-9, k);
    }
    assert.strictEqual(M.rcFormatTail("modrate", 0.6), "0.60 Hz");
    assert.strictEqual(M.rcFormatTail("erlevel", -70), "Off");
});

test("Tail tab: nine bars / chips, each parameter once (Mod Depth is also in the Reverb LCD row, the rest are off the face); hit test picks them", () => {
    const T = M.rbTailLayout(316);
    const keys = T.rows.map((r) => r.key).sort();
    assert.strictEqual(JSON.stringify(keys), JSON.stringify(["duck", "duckrel", "erlevel", "latelevel", "loopclip", "looplevel", "moddepth", "modrate", "output"]));
    for (const r of T.rows) {
        assert(r.key in M.REP || r.key === "loopclip", r.key);
        const hit = M.rbTailHit(316, r.x + 3, r.y + 3);
        assert.strictEqual(hit && hit.key, r.key);
    }
    const chips = T.rows.find((r) => r.kind === "chips");
    assert.strictEqual(M.rbTailHit(316, chips.x + chips.w - 2, chips.y + 3).chip, 2);
    assert.strictEqual(M.rbTailHit(316, 2, 2), null);
});

test("Tail tab: dragging a bar writes the parameter through rpSend, release stops, double-click resets, chips set the clip mode, inactive rows are ignored", () => {
    const f = loadViz(135);
    setupLive(f, 1, 2);
    const T = M.rbTailLayout(316);
    const row = (k) => T.rows.find((r) => r.key === k);
    const mr = row("duck");
    f.out.length = 0;
    f.ctx.onclick(mr.x + 1 + (mr.w - 2) * 0.5, mr.y + 5, 1);
    f.ctx.ondrag(mr.x + 1 + (mr.w - 2) * 0.8, mr.y + 5, 1);
    const w = f.out.filter((a) => a[1] === "param");
    assert(w.length === 2 && w.every((a) => a[2] === "duck") && Math.abs(w[0][3] - 50) < 0.01 && Math.abs(w[1][3] - 80) < 0.01, JSON.stringify(w));
    f.ctx.ondrag(0, 0, 0);
    f.out.length = 0;
    f.ctx.ondrag(mr.x + 10, mr.y + 5, 1);
    assert.strictEqual(f.out.length, 0, "no write after release");
    const dr = row("duckrel");
    f.ctx.ondblclick(dr.x + 10, dr.y + 5);
    assert.deepStrictEqual(f.out.filter((a) => a[1] === "param").map((a) => a.slice(2)), [["duckrel", 250]]);
    const ch = row("loopclip");
    f.out.length = 0;
    f.ctx.onclick(ch.x + ch.w - 3, ch.y + 4, 1);
    assert.deepStrictEqual(f.out.filter((a) => a[1] === "param").map((a) => a.slice(2)), [["loopclip", 2]]);
    // Plate: Early does not apply (RP_INACTIVE) -> greyed and ignored
    const p = loadViz(135);
    setupLive(p, 0, 2);
    const er = row("erlevel");
    p.out.length = 0;
    p.ctx.onclick(er.x + 20, er.y + 5, 1);
    assert(!p.out.some((a) => a[1] === "param"), "Early is inactive in Plate");
    // a drag on the Tone / Reverb tabs never reaches the Tail bars
    const t = loadViz();
    setupLive(t, 1, 0);
    t.out.length = 0;
    t.ctx.onclick(mr.x + 20, mr.y + 5, 1); t.ctx.ondrag(mr.x + 40, mr.y + 5, 1);
    assert(!t.out.some((a) => a[1] === "param" && a[2] === "duck"));
});

test("latency warning: a LATENCY pill in the display header on every tab while the loop is clamped, nothing otherwise", () => {
    const shown = (clamped, paired, page) => {
        const f = loadViz(page === 2 ? 135 : 104);
        setupLive(f, 1, page);
        const s = activeScope(1);
        s[C.RP_SCOPE.PAIRED] = paired; s[C.RP_SCOPE.CLAMPED] = clamped; s[C.RP_SCOPE.MIN_MS] = 92;
        f.ctx.rpT.s = s;
        f.calls.length = 0;
        f.ctx.paint();
        return f.calls.some((c) => c[0] === "show_text" && c[1] === "LATENCY: LOOP 92.0 ms");
    };
    for (const page of [0, 1, 2]) assert(shown(1, 1, page), "page " + page);
    assert(!shown(0, 1, 0), "not while the loop follows Size");
    assert(!shown(1, 0, 0), "not while unpaired");
});

test("frame poll: only the Reverb tab samples spectra and always redraws; Tone / Tail redraw only when something they show changed", () => {
    const f = loadViz();
    setupLive(f, 1, 0);
    const sc = activeScope(1);
    f.bufs.sp = new Float32Array(C.RP_SPEC_SAMPS);
    f.ctx.rpT.s = sc; f.ctx.rpT.active = true;
    assert.strictEqual(f.ctx.onFrame(f.ctx.rpT), true, "Reverb tab redraws every frame");
    for (const page of [1, 2]) {
        f.msg("set_page", page);
        f.ctx.onFrame(f.ctx.rpT); // (the page switch itself redraws through set_page)
        assert.strictEqual(f.ctx.onFrame(f.ctx.rpT), false, "nothing changed on page " + page);
        sc[C.RP_SCOPE.CLAMPED] = 1 - sc[C.RP_SCOPE.CLAMPED];
        assert.strictEqual(f.ctx.onFrame(f.ctx.rpT), true, "the latency pill changed on page " + page);
        sc[C.RP_SCOPE.CLIP_DB] = -3;
        assert.strictEqual(f.ctx.onFrame(f.ctx.rpT), true, "the clip LED lights on page " + page);
        sc[C.RP_SCOPE.CLIP_DB] = 0;
        f.clock.now += 5000;
        f.ctx.onFrame(f.ctx.rpT);
        assert.strictEqual(f.ctx.onFrame(f.ctx.rpT), false, "idle again after the LED faded on page " + page);
    }
    f.ctx.rpT.active = false;
    assert.strictEqual(f.ctx.onFrame(f.ctx.rpT), false, "an idle device does not redraw");
});

test("IR box v8uis: the name field shows the file, the buttons browse and clear", () => {
    const nm = load(["reverbplus_face_ir.js"], [52, 15], 'var RBI_MODE = "name";');
    nm.msg("state", "ir", "ready", 1, 96000, 48000, 2, 0, "Cathedral.wav");
    nm.ctx.paint();
    assert(nm.calls.some((c) => c[0] === "show_text" && String(c[1]).indexOf("Cath") === 0));
    const b = load(["reverbplus_face_ir.js"], [26, 15], 'var RBI_MODE = "btn";');
    b.ctx.onclick(5, 7, 1);
    b.ctx.onclick(25, 7, 1);
    b.ctx.onclick(25, 7, 0);
    assert.deepStrictEqual(b.out, [[0, "cmd", "browse_ir"], [0, "cmd", "clear_ir"]]);
});

// ---- the built device -------------------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpb-"));
execFileSync("python3", ["scripts/build_reverbplus.py", "--no-sets", "--out-dir", tmp], { cwd: ROOT, stdio: "pipe" });
const dev = (() => {
    const buf = fs.readFileSync(path.join(tmp, "Reverb+.amxd"));
    return JSON.parse(buf.slice(32).toString("utf8")).patcher;
})();
const boxes = dev.boxes.map((b) => b.box);
const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
const DW = dev.devicewidth;

test("built device: 444 x 169, every parameter once (on the face or off_face), page tab is a hidden UI-state parameter, panels last", () => {
    assert.strictEqual(DW, 444);
    assert.deepStrictEqual(dev.openrect, [0, 0, 444, 169]);
    const keys = boxes.filter((b) => b.id.startsWith("obj-ctrl-")).map((b) => b.id.slice(9));
    for (const k of Object.keys(JSON.parse(execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'scripts'); import build_reverbplus as b; " +
        "from reverbplus_layouts import base as L; b.reset_registry(); L.layout(b); print(json.dumps({k: 1 for k in b.P}))"], { cwd: ROOT }).toString()))) {
        assert(keys.includes(k), "missing " + k);
    }
    assert.strictEqual(new Set(keys).size, keys.length);
    const page = byId["obj-ctrl-page"];
    assert.strictEqual(page.saved_attribute_attributes.valueof.parameter_invisible, 1);
    assert.deepStrictEqual(page.saved_attribute_attributes.valueof.parameter_enum, ["Reverb", "Tone", "Tail"]);
    const last = dev.boxes.slice(-4).map((b) => b.box);
    assert(last.every((b) => b.maxclass === "panel" && b.background === 1));
    const off = ["modrate", "erlevel", "latelevel", "duck", "duckrel", "output", "looplevel", "loopclip"];
    for (const k of off) assert.strictEqual(byId["obj-ctrl-" + k].presentation, 0, k + " is off the face");
    // Mod Depth: on the face in the Reverb tab's LCD row (after Diffusion, tank group) and also drawn on the Tail tab
    assert.strictEqual(byId["obj-ctrl-moddepth"].presentation, 1);
    assert.deepStrictEqual(byId["obj-ctrl-moddepth"].presentation_rect, [286, 142, 64, 15]);
    // the live.* controls use Live's theme (no static colour except the LCD value colours bound to the theme)
    // Input dial: left column, directly below Pre-Delay (hairline between), Decay moved down below it
    assert.deepStrictEqual(byId["obj-ctrl-input"].presentation_rect, [8, 58, 46, 46]);
    assert.strictEqual(byId["obj-ctrl-input"].presentation, 1);
    assert.deepStrictEqual(byId["obj-ctrl-decay"].presentation_rect, [8, 110, 46, 46]);
    assert.deepStrictEqual(byId["obj-ctrl-irdecay"].presentation_rect, [8, 110, 46, 46]);
    for (const k of ["predelay", "input", "width", "drywet", "algo"]) {
        assert(!Object.keys(byId["obj-ctrl-" + k]).some((a) => /color/.test(a) && a !== "saved_attribute_attributes"), k + " has static colours");
    }
});

// group membership from the wiring: route outlet i -> prepend hidden -> targets
const GROUPS = M.RB_GROUPS;
const members = (() => {
    const route = byId["obj-lay-route"];
    assert.strictEqual(route.text, "route " + GROUPS.map((g) => "g_" + g).join(" ") + " viz_tall");
    const out = {};
    for (const [i, g] of GROUPS.entries()) {
        const pid = `obj-lay-hide-${g}`;
        assert(dev.lines.some((l) => l.patchline.source[0] === "obj-lay-route" && l.patchline.source[1] === i && l.patchline.destination[0] === pid), g);
        out[g] = dev.lines.filter((l) => l.patchline.source[0] === pid).map((l) => l.patchline.destination[0]);
    }
    assert(dev.lines.some((l) => l.patchline.source[0] === "obj-lay-viz" && l.patchline.source[1] === 1 && l.patchline.destination[0] === "obj-lay-route"));
    // the Tail tab's taller display: route outlet viz_tall -> sel 0 1 -> presentation_rect messages -> the display
    const nG = GROUPS.length;
    const has = (a, ao, b) => dev.lines.some((l) => l.patchline.source[0] === a && l.patchline.source[1] === ao && l.patchline.destination[0] === b);
    assert(has("obj-lay-route", nG, "obj-lay-tall-sel") && has("obj-lay-tall-sel", 0, "obj-lay-tall-off") && has("obj-lay-tall-sel", 1, "obj-lay-tall-on"));
    assert(has("obj-lay-tall-off", 0, "obj-lay-viz") && has("obj-lay-tall-on", 0, "obj-lay-viz"));
    const rect = (id) => byId[id].text.split(" ").slice(1).map(Number);
    const base = byId["obj-lay-viz"].presentation_rect;
    assert.deepStrictEqual(rect("obj-lay-tall-off"), base);
    assert.deepStrictEqual(rect("obj-lay-tall-on").slice(0, 3), base.slice(0, 3));
    assert.strictEqual(rect("obj-lay-tall-on")[3], 135);
    assert(base[1] + 135 <= 158, "the taller display stays above the panel's bottom edge");
    return out;
})();

const rectOf = (b) => b.presentation_rect;
const ovl = (a, b) => a[0] < b[0] + b[2] - 1e-6 && b[0] < a[0] + a[2] - 1e-6 && a[1] < b[1] + b[3] - 1e-6 && b[1] < a[1] + a[3] - 1e-6;

function visibleBoxes(page, algo) {
    const v = M.rbVis(page, algo);
    if (M.rbTall(page)) {
        // the display grows over the LCD row (presentation_rect message): check against the grown rect
        const viz = byId["obj-lay-viz"];
        const grown = Object.assign({}, viz, { presentation_rect: [viz.presentation_rect[0], viz.presentation_rect[1], viz.presentation_rect[2], 135] });
        return visibleBoxes0(v).map((b) => (b.id === viz.id ? grown : b));
    }
    return visibleBoxes0(v);
}

function visibleBoxes0(v) {
    const hidden = new Set();
    for (const g of GROUPS) if (!v[g]) for (const id of members[g]) hidden.add(id);
    return boxes.filter((b) => b.presentation === 1 && !hidden.has(b.id));
}

test("every page x algorithm: no two visible live.* widgets overlap, none sits on an interactive v8ui, everything is inside the device", () => {
    const counts = {};
    for (let algo = 0; algo < 6; algo++) for (let page = 0; page < 3; page++) {
        const vis = visibleBoxes(page, algo);
        const controls = vis.filter((b) => /^live\./.test(b.maxclass) && !["live.comment", "live.line"].includes(b.maxclass));
        for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
            assert(!ovl(rectOf(controls[i]), rectOf(controls[j])), `page ${page} algo ${algo}: ${controls[i].id} overlaps ${controls[j].id}`);
        }
        const v8 = vis.filter((b) => b.maxclass === "v8ui" && !b.ignoreclick);
        for (const u of v8) for (const c of controls) assert(!ovl(rectOf(u), rectOf(c)), `page ${page} algo ${algo}: ${c.id} on ${u.id}`);
        // the IR name v8ui (ignoreclick) is under the transparent live.drop, which is in front of it
        const ids = dev.boxes.map((b) => b.box.id);
        assert(ids.indexOf("obj-lay-irname") < ids.indexOf("obj-ctrl-irfile"));
        for (const b of vis) assert(rectOf(b)[0] >= 0 && rectOf(b)[1] >= 0 && rectOf(b)[0] + rectOf(b)[2] <= DW && rectOf(b)[1] + rectOf(b)[3] <= 169, b.id);
        counts[`${page}/${algo}`] = controls.filter((b) => b.id !== "obj-ctrl-irfile" || true).length;
    }
    // report: visible live.* controls per page (Hall, Convolution)
    console.log(`  visible controls: Reverb ${counts["0/1"]} (Hall) / ${counts["0/5"]} (Conv), Tone ${counts["1/1"]} (Hall) / ${counts["1/0"]} (Plate), Tail ${counts["2/1"]}`);
    assert(counts["0/1"] <= 14 && counts["1/1"] <= 14 && counts["2/1"] <= 14, "about 8-14 controls at a time");
});

test("whole-face file drop target: one invisible ignoreclick dropfile over the full face (present in every algorithm), in front of every widget, on every page x algorithm", () => {
    const dfs = dev.boxes.map((b) => b.box).filter((b) => b.maxclass === "dropfile");
    assert.strictEqual(dfs.length, 1);
    const df = dfs[0];
    assert.strictEqual(df.ignoreclick, 1);
    assert.deepStrictEqual(rectOf(df), [0, 0, DW, 169]);
    const ids = dev.boxes.map((b) => b.box.id);
    for (let algo = 0; algo < 6; algo++) for (let page = 0; page < 3; page++) {
        for (const b of visibleBoxes(page, algo)) {
            if (b.id === df.id || b.maxclass === "panel") continue;
            assert(ids.indexOf(b.id) < ids.indexOf(df.id), `${b.id} (page ${page}, algo ${algo}) is behind the drop target`);
            // an interactive widget under it is only safe because the target ignores clicks
        }
    }
    // the target is not a live.* widget, so it cannot count as a rule-4 overlap, and it never hides (visible in every state)
    assert(!/^live\./.test(df.maxclass) && !df.hidden);
});

test("separators and labels sit inside the display / column panels; separators are thin; the LCD row is aligned", () => {
    const panels = boxes.filter((b) => b.maxclass === "panel" && b.id !== "obj-lay-body").map(rectOf);
    const inPanel = (r) => panels.some((p) => r[0] >= p[0] - 1e-6 && r[1] >= p[1] - 1e-6 && r[0] + r[2] <= p[0] + p[2] + 1e-6 && r[1] + r[3] <= p[1] + p[3] + 1e-6);
    for (const b of boxes.filter((x) => x.presentation === 1 && ["live.line", "live.comment"].includes(x.maxclass))) assert(inPanel(rectOf(b)), b.id + " " + rectOf(b));
    for (const b of boxes.filter((x) => x.maxclass === "live.line")) assert(Math.min(rectOf(b)[2], rectOf(b)[3]) === 2 && Math.max(rectOf(b)[2], rectOf(b)[3]) >= 26, b.id);
    // every LCD cell value shares one baseline; labels share another
    const cells = boxes.filter((b) => b.presentation === 1 && b.maxclass === "live.numbox" && rectOf(b)[1] === 142);
    assert(cells.length >= 9);
    for (const c of cells) assert.strictEqual(rectOf(byId[c.id.replace("obj-ctrl-", "obj-lay-lbl-")])[1], 131, c.id);
    // LCD value colours: bound to the theme, cyan for tank / filter, amber for decay / loop
    for (const c of cells) {
        const saa = c.saved_attribute_attributes;
        assert(/live_display_line_(one|two)/.test(saa.textcolor.expression) && /live_display_line_(one|two)/.test(saa.lcdcolor.expression), c.id);
    }
});

test("saved state: the Reverb page / Hall is the visible one, the others start hidden", () => {
    const v = M.rbVis(0, 1);
    for (const g of GROUPS) for (const id of members[g]) assert.strictEqual(byId[id].hidden ? 1 : 0, v[g] ? 0 : 1, `${g}: ${id}`);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${n} passed`);
