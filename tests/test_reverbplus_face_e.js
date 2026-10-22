#!/usr/bin/env node
"use strict";
// Reverb+ face `e` ("Direct manipulation") tests (auto-run by tests/test_reverbplus.js): parameter scales vs the build's table,
// handle positions and their inverses, readout, TAIL page layout, the display against a fake mgraphics (drags -> rpSend,
// double-click reset, page switch, Convolution swap), and the built device (every parameter presented or off-face, no live.* over
// the display, hairlines inside their panels, swap wiring, panels last).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8");
const code = [read("reverbplus_config.js"), read("reverbplus_face_common.js"), read("reverbplus_face_e_math.js"), read("reverbplus_face_e.js")].join("\n");
const C = require("../src/reverbplus_config.js");
const M = (() => {
    const ctx = { module: { exports: {} }, Math, Float32Array, Float64Array, Int32Array, Array, Number, String };
    vm.createContext(ctx);
    vm.runInContext(read("reverbplus_config.js") + "\n" + read("reverbplus_face_e_math.js"), ctx);
    return ctx.module.exports;
})();

let n = 0;
function test(name, fn) {
    try { fn(); n++; console.log("PASS " + name); } catch (e) { console.log("FAIL " + name + ": " + e.stack.split("\n").slice(0, 3).join(" | ")); process.exitCode = 1; }
}
const near = (a, b, eps, msg) => assert(Math.abs(a - b) <= eps, `${msg || ""} ${a} vs ${b}`);

function load() {
    const out = [];
    const calls = [];
    const mg = new Proxy({ size: [396, 161], text_measure: (t) => [String(t).length * 5, 8] }, {
        get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); return 0; }), set: (t, k, v) => { t[k] = v; return true; },
    });
    const ctx = {
        mgraphics: mg, outlet: (...a) => out.push(a), post: () => {}, Math, Number, String, Array, JSON, isNaN, Float32Array, Float64Array, Int32Array, Object,
        Date: { now: () => 100000 }, Buffer: function () { this.peek = () => []; }, Task: function () { this.repeat = () => {}; this.cancel = () => {}; },
        messagename: "", globalThis: {},
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    const msg = (name, ...args) => { ctx.messagename = name; ctx.anything(...args); };
    return { ctx, out, calls, msg, get: (e) => vm.runInContext(e, ctx), writes: () => out.filter((o) => o[0] === 0 && o[1] === "param").map((o) => [o[2], o[3]]) };
}

// ---- scales -----------------------------------------------------------------------------------------------------------------------
test("REP scales and defaults equal the build's parameter table", () => {
    const table = JSON.parse(execFileSync("python3", ["-c",
        "import sys,json; sys.path.insert(0,'scripts'); import build_reverbplus as b; print(json.dumps({k:[v[2],v[3],v[7],v[4]] for k,v in b.P.items()}))"], { cwd: ROOT }).toString());
    for (const [k, e] of Object.entries(M.REP)) assert.deepStrictEqual(Array.from(e), table[k], k);
});

test("rcPos / rcVal round trip for every handle and tail parameter", () => {
    for (const k of Object.keys(M.REP)) {
        for (const p of [0, 0.1, 0.37, 0.5, 0.9, 1]) near(M.rcPos(k, M.rcVal(k, p)), p, 1e-9, k);
        near(M.rcVal(k, 0), M.REP[k][0], 1e-9, k);
        near(M.rcVal(k, 1), M.REP[k][1], 1e-9, k);
    }
});

// ---- handles ------------------------------------------------------------------------------------------------------------------
const base = { decay: 2.5, damp: 7000, bassmult: 1.6, xover: 350, lowcut: 60, highcut: 16000, predelay: 20, irdecay: 100 };
const get = (k, d) => (k in base ? base[k] : d);

test("handle positions are inside the display and the drag inverse reproduces every parameter", () => {
    const L = M.rcLayout(396, 161);
    for (const algo of [0, 1, 2, 3, 4, 5]) {
        const hs = M.rcHandles(get, algo, 48000, null);
        assert.strictEqual(hs.length, 6);
        for (const h of hs) {
            assert(h.x >= 0 && h.x <= 396 && h.y >= 0 && h.y <= 161, `h${h.num} ${h.x},${h.y}`);
            // handles sit in their own zone
            if (h.num === 6) near(h.y, M.REG.rulerY, 0.01);
            if (h.num === 4 || h.num === 5) near(h.y, M.RCG.yFront, 0.01);
            if ((h.num === 2 || h.num === 3)) assert(h.y >= L.strip.y && h.y <= L.strip.y + L.strip.h);
            if (!h.vis) continue;
            const w = M.rcDragWrites(h.id, h.x, h.y, 48000, algo);
            for (const [k, v] of w) {
                if (k === "bassmult") near(v, base.bassmult, 0.02, k);
                else if (k === "damp" || k === "xover") near(Math.log(v), Math.log(base[k]), 0.02, k);
                else if (k === "lowcut" || k === "highcut") near(Math.log(v), Math.log(base[k]), 0.02, k);
                else near(v, base[k], Math.abs(base[k]) * 0.01 + 0.01, k);
            }
        }
    }
});

test("Convolution: handle 1 drives IR Decay, handle 3 is hidden, tank algorithms without bass controls grey node 3", () => {
    const conv = M.rcHandles(get, 5, 48000, () => 1);
    assert.strictEqual(conv[0].key, "irdecay");
    assert.strictEqual(conv[2].vis, false);
    assert.strictEqual(M.rcDragWrites(0, conv[0].x, 70, 48000, 5)[0][0], "irdecay");
    assert.strictEqual(M.rcResetWrites(0, 5)[0][0], "irdecay");
    assert.strictEqual(M.rcHandles(get, 0, 48000, null)[2].on, false);
    assert.strictEqual(M.rcHandles(get, 4, 48000, null)[2].on, false);
    assert.strictEqual(M.rcHandles(get, 1, 48000, null)[2].on, true);
});

test("drag endpoints: edges reach the parameter limits, clamps hold", () => {
    const w = (id, x, y, a) => Object.fromEntries(M.rcDragWrites(id, x, y, 48000, a === undefined ? 1 : a));
    assert.strictEqual(w(3, 0, 102).lowcut, 20);
    assert.strictEqual(w(4, 400, 102).highcut, 20000);
    assert.strictEqual(w(1, 400, 120).damp, 20000);
    assert.strictEqual(w(0, 100, -50).decay, 60);
    near(w(0, 100, 300).decay, 0.1, 1e-9);
    assert.strictEqual(w(2, 200, 0).bassmult, 4);
    assert.strictEqual(w(2, 200, 500).bassmult, 0.25);
    near(w(5, 0, 26).predelay, 0, 1e-9);
    near(w(5, 999, 26).predelay, 500, 1e-9);
    assert(w(2, 200, 120).xover >= 100 && w(2, 200, 120).xover <= 1000);
});

test("hit test picks the nearest active handle; hidden and inactive ones are skipped", () => {
    const hs = M.rcHandles(get, 1, 48000, null);
    assert.strictEqual(M.rcHitHandle(hs, hs[2].x + 2, hs[2].y - 2, 10), 2);
    assert.strictEqual(M.rcHitHandle(hs, 5, 5, 10), -1);
    const conv = M.rcHandles(get, 5, 48000, () => 1);
    assert.notStrictEqual(M.rcHitHandle(conv, conv[2].x, conv[2].y, 10), 2);
    const plate = M.rcHandles(get, 0, 48000, null);
    assert.notStrictEqual(M.rcHitHandle(plate, plate[2].x, plate[2].y, 6), 2);
});

test("readout bar: six cells inside the bar, texts per handle, Convolution swaps the first and blanks the third", () => {
    const L = M.rcLayout(396, 161);
    let right = 0;
    for (let i = 0; i < 6; i++) { const c = M.rcCellRect(L.bar, i); assert(c.x >= L.bar.x - 1e-9); right = Math.max(right, c.x + c.w); }
    near(right, L.bar.x + L.bar.w, 1e-9);
    const t = M.rcReadout(get, 1);
    assert.strictEqual(t[0].value, "2.50 s");
    assert.strictEqual(t[1].value, "7.00 kHz");
    assert.strictEqual(t[2].value, "x1.60 350 Hz");
    assert.strictEqual(t[3].value, "60 Hz");
    assert.strictEqual(t[5].value, "20.0 ms");
    const c = M.rcReadout(get, 5);
    assert.strictEqual(c[0].value, "100 %");
    assert.strictEqual(c[2].vis, false);
    assert(L.bar.y + L.bar.h <= 161 && L.strip.y + L.strip.h <= L.bar.y);
});

test("TAIL page: every row inside the display, no overlaps, titles and the divider inside, every key valid", () => {
    const T = M.rcTailLayout(396);
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const r of T.rows) {
        assert(r.x >= 0 && r.x + r.w <= 396 && r.y >= 16 && r.y + r.h <= 161, r.key);
        assert(r.key in M.REP || r.key === "loopclip", r.key);
    }
    for (let i = 0; i < T.rows.length; i++) for (let j = i + 1; j < T.rows.length; j++) assert(!ov(T.rows[i], T.rows[j]), `${T.rows[i].key} / ${T.rows[j].key}`);
    for (const t of T.titles) assert(t.x >= 0 && t.x + t.w <= 396 && t.y + 12 <= 161);
    assert(T.div.x > 0 && T.div.x < 396 && T.div.y1 <= 161);
    const keys = Array.from(T.rows.map((r) => r.key)).sort();
    assert.deepStrictEqual(keys, ["duck", "duckrel", "erlevel", "latelevel", "loopclip", "looplevel", "moddepth", "modrate", "output", "width"].sort());
    assert.strictEqual(M.rcTailHit(396, T.rows[0].x + 3, T.rows[0].y + 3).key, T.rows[0].key);
    assert.strictEqual(M.rcTailHit(396, 2, 2), null);
    const chips = T.rows.find((r) => r.kind === "chips");
    assert.strictEqual(M.rcTailHit(396, chips.x + chips.w - 2, chips.y + 3).chip, 2);
});

// ---- the display ------------------------------------------------------------------------------------------------------------------
function ready(f, algo) {
    f.msg("set_algo", algo === undefined ? 1 : algo);
    f.ctx.names("x", "h", "sc", "sp", "ir", "irs", "irv");
    f.msg("state", "dsp", 1, "-");
    f.msg("state", "link", 1, "linked", 256, 3);
    for (const [k, v] of Object.entries(base)) f.msg("set_" + k, v);
}

test("dragging a handle writes the parameter through rpSend; releasing stops; double-click resets", () => {
    const f = load();
    ready(f);
    const hs = f.get("rcHandleList(1, rcRtInfo())");
    const h = hs[0];
    f.ctx.onclick(h.x + 1, h.y + 1, 1);
    assert.strictEqual(f.get("RCS.sel"), 0);
    assert.strictEqual(f.writes().length, 0, "a plain click changes nothing");
    f.ctx.ondrag(h.x, h.y - 20, 1);
    let w = f.writes();
    assert.strictEqual(w[w.length - 1][0], "decay");
    assert(w[w.length - 1][1] > 2.5, "dragging up lengthens the decay");
    f.out.length = 0;
    f.ctx.ondrag(h.x, h.y - 20, 0);
    f.ctx.ondrag(h.x, h.y - 40, 1);
    assert.strictEqual(f.writes().length, 0, "no writes after release");
    f.ctx.ondblclick(h.x, h.y);
    assert.deepStrictEqual(f.writes(), [["decay", 2.5]]);
    // the node 3 drag writes both parameters
    f.out.length = 0;
    const n3 = f.get("rcHandleList(1, rcRtInfo())")[2];
    f.ctx.onclick(n3.x, n3.y, 1);
    f.ctx.ondrag(n3.x + 12, n3.y - 6, 1);
    assert.deepStrictEqual(f.writes().map((x) => x[0]), ["xover", "bassmult"]);
    f.ctx.ondrag(0, 0, 0);
    f.ctx.paint();
});

test("page tabs switch pages; the TAIL page drags bars, picks the clip chip, resets, and greys inactive rows", () => {
    const f = load();
    ready(f, 1);
    const L = f.get("rcLayout(396, 161)");
    f.ctx.onclick(L.tabs[1].x + 3, L.tabs[1].y + 3, 1);
    assert.strictEqual(f.get("RCS.page"), 1);
    const T = f.get("rcTailLayout(396)");
    const duck = T.rows.find((r) => r.key === "duck");
    f.ctx.onclick(duck.x + duck.w / 2, duck.y + 4, 1);
    f.ctx.ondrag(duck.x + duck.w - 1, duck.y + 4, 1);
    let w = f.writes();
    assert.strictEqual(w[w.length - 1][0], "duck");
    near(w[w.length - 1][1], 100, 1.5);
    f.ctx.ondrag(0, 0, 0);
    f.out.length = 0;
    const chips = T.rows.find((r) => r.kind === "chips");
    f.ctx.onclick(chips.x + chips.w - 2, chips.y + 3, 1);
    assert.deepStrictEqual(f.writes(), [["loopclip", 2]]);
    f.out.length = 0;
    f.ctx.ondblclick(duck.x + 5, duck.y + 4);
    assert.deepStrictEqual(f.writes(), [["duck", 0]]);
    // Early is inactive in Plate / Spring / Convolution: no write
    for (const algo of [0, 4, 5]) {
        f.msg("set_algo", algo);
        f.out.length = 0;
        const er = T.rows.find((r) => r.key === "erlevel");
        f.ctx.onclick(er.x + 20, er.y + 4, 1);
        assert.strictEqual(f.writes().length, 0, "erlevel inactive in " + algo);
    }
    f.ctx.paint();
    L.tabs[0] && f.ctx.onclick(L.tabs[0].x + 3, L.tabs[0].y + 3, 1);
    assert.strictEqual(f.get("RCS.page"), 0);
});

test("algorithm swap: outlet 1 sends hide_tank / hide_ir; Convolution drops node 3's selection and shows browse / clear actions", () => {
    const f = load();
    ready(f, 1);
    f.out.length = 0;
    f.msg("set_algo", 5);
    assert(f.out.some((o) => o[0] === 1 && o[1] === "hide_tank" && o[2] === 1));
    assert(f.out.some((o) => o[0] === 1 && o[1] === "hide_ir" && o[2] === 0));
    f.msg("set_algo", 1);
    f.ctx.vm_dummy = 0;
    f.get("RCS.sel = 2");
    f.msg("set_algo", 5);
    assert.strictEqual(f.get("RCS.sel"), -1);
    f.out.length = 0;
    const L = f.get("rcLayout(396, 161)");
    f.ctx.onclick(L.browse.x + 3, L.browse.y + 3, 1);
    assert(f.out.some((o) => o[1] === "cmd" && o[2] === "browse_ir"));
    f.out.length = 0;
    f.ctx.onclick(L.clear.x + 3, L.clear.y + 3, 1);
    assert(f.out.some((o) => o[1] === "cmd" && o[2] === "clear_ir"));
    f.msg("set_algo", 1);
    assert(f.out.some((o) => o[0] === 1 && o[1] === "hide_tank" && o[2] === 0));
    // every algorithm paints on both pages
    for (const algo of [0, 1, 2, 3, 4, 5]) for (const page of [0, 1]) { f.msg("set_algo", algo); f.get("RCS.page = " + page); f.ctx.paint(); }
});

test("the preview states paint (default, freeze, conv, tail, drag)", () => {
    for (const mode of ["", "freeze", "conv", "tail", "drag"]) {
        const f = load();
        f.ctx.globalThis = { process: { env: { RC_PREVIEW: mode } } };
        f.ctx.preview();
        f.ctx.paint();
    }
});

// ---- the built device --------------------------------------------------------------------------------------------------------------
test("built device: every parameter presented or off-face, nothing over the display, hairlines inside their panels, swap wiring, panels last, 169 px", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rp_e_"));
    execFileSync("python3", [path.join(ROOT, "scripts", "build_reverbplus.py"), "--variant", "e", "--no-sets", "--out-dir", tmp], { cwd: ROOT, stdio: "pipe" });
    const buf = fs.readFileSync(path.join(tmp, "Reverb+ E.amxd"));
    const doc = JSON.parse(buf.slice(32, 32 + buf.readUInt32LE(28)).toString("utf8"));
    const boxes = doc.patcher.boxes.map((b) => b.box);
    const lines = doc.patcher.lines.map((l) => l.patchline);
    const byId = (id) => boxes.find((b) => b.id === id);
    const W = doc.patcher.openrect[2];
    assert.strictEqual(doc.patcher.openrect[3], 169);
    assert.strictEqual(W, 600);
    const viz = byId("obj-lay-e-viz");
    assert(viz && viz.numoutlets === 2);
    const has = (a, ao, b, bi) => lines.some((l) => l.source[0] === a && l.source[1] === ao && l.destination[0] === b && l.destination[1] === bi);
    assert(has("obj-lay-e-viz", 1, "obj-lay-e-route", 0) && has("obj-lay-e-viz", 0, "obj-route-face", 0));
    // every parameter: a widget on the face or off-face (presentation 0)
    const P = JSON.parse(execFileSync("python3", ["-c", "import sys,json; sys.path.insert(0,'scripts'); import build_reverbplus as b; print(json.dumps(list(b.P)))"], { cwd: ROOT }).toString());
    const onFace = [], offFace = [];
    for (const k of P) {
        const b = byId("obj-ctrl-" + k);
        assert(b, "missing widget " + k);
        (b.presentation === 1 ? onFace : offFace).push(k);
    }
    assert.deepStrictEqual(onFace.sort(), ["algo", "diffusion", "drywet", "freeze", "irfile", "irreverse", "irstart", "irstretch", "loop", "looptime", "size"].sort());
    assert.strictEqual(onFace.length + offFace.length, P.length);
    for (const k of offFace) assert.strictEqual(byId("obj-ctrl-" + k).hidden, 1, k);
    // swap block: tank side visible at save, IR side hidden, twins at the same place
    const tank = ["size", "diffusion"], ir = ["irstretch", "irstart"];
    for (const k of tank) { assert(has("obj-lay-e-hide-tank", 0, "obj-ctrl-" + k, 0), k); assert(!byId("obj-ctrl-" + k).hidden, k); }
    for (const k of ir.concat(["irreverse", "irfile"])) { assert(has("obj-lay-e-hide-ir", 0, "obj-ctrl-" + k, 0), k); assert.strictEqual(byId("obj-ctrl-" + k).hidden, 1, k); }
    tank.forEach((k, i) => assert.deepStrictEqual(byId("obj-ctrl-" + ir[i]).presentation_rect, byId("obj-ctrl-" + k).presentation_rect));
    for (const id of ["obj-lay-e-hdr-space", "obj-lay-e-hint0", "obj-lay-e-hint1", "obj-lay-e-hint2"]) assert(has("obj-lay-e-hide-tank", 0, id, 0), id);
    for (const id of ["obj-lay-e-hdr-ir", "obj-lay-e-hdr-irfile"]) assert(has("obj-lay-e-hide-ir", 0, id, 0), id);
    // rule 4: no live.* (any maxclass but comments / lines, which do not take clicks) over the interactive display
    const ov = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    for (const b of boxes) {
        if (!String(b.maxclass).startsWith("live.") || b.presentation !== 1) continue;
        assert(!ov(b.presentation_rect, viz.presentation_rect), b.id + " over the display");
    }
    // visible controls (both algorithm states) do not overlap within a state, all inside the device
    const ctrl = boxes.filter((b) => /^live\.(numbox|text|menu|drop|dial)$/.test(b.maxclass) && b.presentation === 1);
    const state = (hideSide) => ctrl.filter((b) => !hideSide.includes(b.id.slice(9)));
    for (const hideSide of [ir.concat(["irreverse", "irfile"]), tank]) {
        const vis = ctrl.filter((b) => !hideSide.includes(b.id.slice("obj-ctrl-".length)));
        for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) assert(!ov(vis[i].presentation_rect, vis[j].presentation_rect), `${vis[i].id} / ${vis[j].id}`);
        assert(vis.length <= 9, "visible live controls per state: " + vis.length);
    }
    void state;
    for (const b of ctrl) assert(b.presentation_rect[0] + b.presentation_rect[2] <= W && b.presentation_rect[1] + b.presentation_rect[3] <= 169, b.id);
    // hairlines and labels sit inside one of the three column panels (left, display, right)
    const panels = ["obj-lay-e-left", "obj-lay-e-display", "obj-lay-e-right"].map((id) => byId(id).presentation_rect);
    const inside = (r, p) => r[0] >= p[0] - 1e-6 && r[1] >= p[1] - 1e-6 && r[0] + r[2] <= p[0] + p[2] + 1e-6 && r[1] + r[3] <= p[1] + p[3] + 1e-6;
    const lns = boxes.filter((b) => b.maxclass === "live.line");
    assert(lns.length >= 8);
    for (const b of lns.concat(boxes.filter((x) => x.maxclass === "live.comment"), ctrl)) assert(panels.some((p) => inside(b.presentation_rect, p)), b.id + " outside its panel");
    // panels: last, background, display / columns do not overlap each other
    const first = boxes.findIndex((b) => b.maxclass === "panel");
    assert(boxes.slice(first).every((b) => b.maxclass === "panel" && b.background === 1));
    for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) assert(!ov(panels[i], panels[j]));
    for (const b of boxes.filter((x) => x.maxclass === "live.numbox")) if (b.activeslidercolor) assert.strictEqual(b.activeslidercolor[3], 1, b.id);
    assert(Buffer.byteLength(viz.textfile.text) < 200000);
    assert(!/(^|\n)\s*(var|let|const)\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(viz.textfile.text));
});

console.log(`${n} passed`);
