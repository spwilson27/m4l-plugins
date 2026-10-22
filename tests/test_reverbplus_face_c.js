#!/usr/bin/env node
"use strict";
// Reverb+ face `c` ("Essentials + More") tests (auto-run by tests/test_reverbplus.js): every parameter presented, the More swap
// logic for all six algorithms (visible / hidden / greyed sets), no overlap of the controls that are visible together, lines inside
// their panels, hero geometry (shifted layout, click mapping), head strip against a fake patcher, built device checks.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8");
const C = require("../src/reverbplus_config.js");

let n = 0;
function test(name, fn) {
    try { fn(); n++; console.log("PASS " + name); } catch (e) { console.log("FAIL " + name + ": " + e.stack.split("\n").slice(0, 3).join(" | ")); process.exitCode = 1; }
}

// ---- build the device into a temp dir and read it back ---------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rp_c_"));
execFileSync("python3", [path.join(ROOT, "scripts", "build_reverbplus.py"), "--variant", "c", "--no-sets", "--out-dir", tmp],
    { cwd: ROOT, env: Object.assign({}, process.env, { RP_C_PAGE: "" }), stdio: "pipe" });
const buf = fs.readFileSync(path.join(tmp, "Reverb+ C.amxd"));
const doc = JSON.parse(buf.slice(32).toString("utf8"));
const boxes = doc.patcher.boxes.map((b) => b.box);
const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
const byVar = Object.fromEntries(boxes.filter((b) => b.varname).map((b) => [b.varname, b]));
const head = byId["obj-lay-c-head"];
const hero = byId["obj-lay-c-viz"];
const headCode = head.textfile.text;
const heroCode = hero.textfile.text;

// ---- head strip harness ----------------------------------------------------------------------------------------------------
function loadHead() {
    const calls = [];
    const objs = {};
    const mkObj = (name, extra) => Object.assign({ name, attrs: {}, setattr(a, v) { this.attrs[a] = v; calls.push([name, a, v]); } }, extra || {});
    const names = Object.keys(byVar);
    for (const nm of names) objs[nm] = mkObj(nm);
    const heroObj = mkObj("hero", { maxclass: "v8ui", getattr: (a) => (a === "presentation_rect" ? hero.presentation_rect : null), nextobject: null });
    const other = { maxclass: "v8ui", getattr: () => [0, 0, 5, 5], nextobject: heroObj };
    const patcher = { getnamed: (nm) => objs[nm] || null, firstobject: other };
    const mg = new Proxy({ size: [122, 15], text_measure: (t) => [String(t).length * 5, 8] }, {
        get: (t, k) => (k in t ? t[k] : () => 0), set: (t, k, v) => { t[k] = v; return true; },
    });
    const ctx = { mgraphics: mg, outlet: () => {}, post: () => {}, Math, Number, String, Array, JSON, isNaN, Float32Array, Float64Array, Int32Array, Object,
        Date, patcher, messagename: "", globalThis: {} };
    vm.createContext(ctx);
    vm.runInContext(headCode, ctx);
    const msg = (name, ...args) => { ctx.messagename = name; ctx.anything(...args); };
    return { ctx, calls, objs, heroObj, msg, get: (e) => vm.runInContext(e, ctx) };
}

const L = JSON.parse(headCode.match(/var CC_LAYOUT = (\{.*\});/)[1]);

// visible set of a state, from the head script's own ccHidden
function hiddenFor(H, more, algo) { return H.get(`ccHidden(${more}, ${algo})`); }
function groupOf(name) { return Object.keys(L.groups).find((g) => L.groups[g].includes(name)); }
function visibleRects(H, more, algo) {
    const f = hiddenFor(H, more, algo);
    const out = [];
    for (const b of boxes) {
        if (b.presentation !== 1 || !b.presentation_rect) continue;
        const mc = String(b.maxclass);
        const g = groupOf(b.varname);
        let hidden = g ? f[g] : 0;
        if (b.id === "obj-lay-c-viz") hidden = f.hero;
        if (!hidden) out.push({ id: b.id, mc, r: b.presentation_rect, v8: mc === "v8ui", live: mc.startsWith("live.") && mc !== "live.comment" && mc !== "live.line" });
    }
    return out;
}
const overlaps = (a, b) => a[0] < b[0] + b[2] - 0.01 && b[0] < a[0] + a[2] - 0.01 && a[1] < b[1] + b[3] - 0.01 && b[1] < a[1] + a[3] - 0.01;

// ---- 1. contract -------------------------------------------------------------------------------------------------------------
test("every parameter (plus More) has exactly one obj-ctrl-<key>", () => {
    const keys = boxes.filter((b) => b.id.startsWith("obj-ctrl-")).map((b) => b.id.slice(9));
    const want = ["algo", "predelay", "size", "decay", "diffusion", "damp", "bassmult", "xover", "modrate", "moddepth", "erlevel", "latelevel",
        "lowcut", "highcut", "width", "freeze", "loop", "looptime", "loopclip", "looplevel", "duck", "duckrel", "drywet", "output",
        "irstretch", "irstart", "irreverse", "irdecay", "irfile", "more"];
    assert.deepStrictEqual(keys.sort(), want.sort());
});

test("device is 169 px high, at most 480 wide; More is a hidden UI-state parameter", () => {
    assert.ok(doc.patcher.devicewidth <= 480, "width " + doc.patcher.devicewidth);
    assert.strictEqual(doc.patcher.openrect[3], 169);
    const v = byId["obj-ctrl-more"].saved_attribute_attributes.valueof;
    assert.strictEqual(v.parameter_invisible, 1);
});

test("every name in CC_LAYOUT resolves to a box, and every key name to its live object", () => {
    for (const g of Object.keys(L.groups)) for (const nm of L.groups[g]) assert.ok(byVar[nm], g + ": " + nm);
    for (const k of Object.keys(L.keyNames)) assert.strictEqual(byVar[L.keyNames[k]].id, "obj-ctrl-" + k);
    assert.ok(Math.abs(L.heroRect[0] - hero.presentation_rect[0]) < 0.01 && L.heroRect[2] === hero.presentation_rect[2]);
});

// ---- 2. swap logic -----------------------------------------------------------------------------------------------------------
const H0 = loadHead();
for (let algo = 0; algo < 6; algo++) {
    test(`swap logic, algorithm ${C.RP_ALGOS[algo]}: essentials view`, () => {
        const f = hiddenFor(H0, 0, algo);
        assert.strictEqual(f.hero, 0);
        assert.deepStrictEqual([f.more, f.tank, f.ir], [1, 1, 1]);
        const v = visibleRects(H0, 0, algo);
        const lives = v.filter((x) => x.live).map((x) => x.id.slice(9));
        assert.deepStrictEqual(lives.sort(), ["algo", "damp", "decay", "drywet", "freeze", "loop", "more", "predelay", "size"].sort());
    });
    test(`swap logic, algorithm ${C.RP_ALGOS[algo]}: More view`, () => {
        const f = hiddenFor(H0, 1, algo);
        const conv = algo === C.RP_ALGO.CONV;
        assert.strictEqual(f.hero, 1);
        assert.strictEqual(f.more, 0);
        assert.strictEqual(f.tank, conv ? 1 : 0);
        assert.strictEqual(f.ir, conv ? 0 : 1);
        const lives = visibleRects(H0, 1, algo).filter((x) => x.live).map((x) => x.id.slice(9));
        for (const k of ["lowcut", "highcut", "looptime", "loopclip", "looplevel", "width", "duck", "duckrel", "output", "latelevel"]) assert.ok(lives.includes(k), k);
        for (const k of ["diffusion", "modrate", "moddepth", "erlevel"]) assert.strictEqual(lives.includes(k), !conv, k);
        for (const k of ["irstretch", "irstart", "irdecay", "irreverse", "irfile"]) assert.strictEqual(lives.includes(k), conv, k);
    });
    test(`no overlap of what is visible together, algorithm ${C.RP_ALGOS[algo]}`, () => {
        for (const more of [0, 1]) {
            const v = visibleRects(H0, more, algo);
            for (let i = 0; i < v.length; i++) {
                for (let j = i + 1; j < v.length; j++) {
                    const a = v[i], b = v[j];
                    if (!(a.live || a.v8) || !(b.live || b.v8)) continue;
                    if (a.id === "obj-lay-c-head" || b.id === "obj-lay-c-head") continue; // draw-only strip (ignoreclick)
                    assert.ok(!overlaps(a.r, b.r), `more=${more}: ${a.id} overlaps ${b.id}`);
                }
            }
        }
    });
}

test("the head strip is draw-only (ignoreclick) and holds no live.* over it", () => {
    assert.strictEqual(head.ignoreclick, 1);
    for (const b of boxes) if (String(b.maxclass).startsWith("live.") && b.presentation === 1 && b.maxclass !== "live.comment" && b.maxclass !== "live.line") {
        assert.ok(!overlaps(b.presentation_rect, head.presentation_rect), b.id + " over the head strip");
    }
});

test("saved state: essentials view (hero visible, grid hidden)", () => {
    assert.ok(!hero.hidden);
    for (const nm of [].concat(...Object.values(L.groups))) assert.strictEqual(byVar[nm].hidden, 1, nm + " should start hidden");
});

test("line / separator boxes lie inside their panels", () => {
    const panels = boxes.filter((b) => b.maxclass === "panel" && b.id !== "obj-lay-c-body");
    const inside = (r, p) => r[0] >= p[0] - 0.01 && r[1] >= p[1] - 0.01 && r[0] + r[2] <= p[0] + p[2] + 0.01 && r[1] + r[3] <= p[1] + p[3] + 0.01;
    const lines = boxes.filter((b) => b.maxclass === "live.line");
    assert.ok(lines.length >= 14);
    for (const l of lines) assert.ok(panels.some((p) => inside(l.presentation_rect, p.presentation_rect)), l.id + " " + l.presentation_rect);
    // grid items sit inside the display panel too
    const disp = byId["obj-lay-c-display"].presentation_rect;
    for (const nm of L.groups.more.concat(L.groups.tank, L.groups.ir)) assert.ok(inside(byVar[nm].presentation_rect, disp), nm);
});

// ---- 3. head strip behaviour -----------------------------------------------------------------------------------------------
test("head strip applies More + algorithm to a fake patcher (hero found by rect, hidden / active)", () => {
    const H = loadHead();
    H.msg("set_algo", 1);
    H.msg("set_more", 1);
    assert.strictEqual(H.heroObj.attrs.hidden, 1);
    assert.strictEqual(H.objs[L.groups.tank[0]].attrs.hidden, 0);
    assert.strictEqual(H.objs[L.groups.ir[0]].attrs.hidden, 1);
    assert.strictEqual(H.objs[L.groups.more[0]].attrs.hidden, 0);
    H.msg("set_algo", 5);
    assert.strictEqual(H.objs[L.groups.tank[0]].attrs.hidden, 1);
    assert.strictEqual(H.objs[L.groups.ir[0]].attrs.hidden, 0);
    // Convolution greys Size / Decay / Freeze / Diffusion, not Pre-Delay
    for (const k of ["size", "decay", "freeze", "diffusion", "bassmult"]) assert.strictEqual(H.objs[L.keyNames[k]].attrs.active, 0, k);
    for (const k of ["predelay", "damp", "drywet", "lowcut"]) assert.strictEqual(H.objs[L.keyNames[k]].attrs.active, 1, k);
    H.msg("set_algo", 0); // Plate: Bass Mult / Crossover / Early grey
    for (const k of ["bassmult", "xover", "erlevel"]) assert.strictEqual(H.objs[L.keyNames[k]].attrs.active, 0, k);
    assert.strictEqual(H.objs[L.keyNames.size].attrs.active, 1);
    H.msg("set_more", 0);
    assert.strictEqual(H.heroObj.attrs.hidden, 0);
    assert.strictEqual(H.objs[L.groups.more[0]].attrs.hidden, 1);
});

test("head strip: unchanged state makes no setattr call", () => {
    const H = loadHead();
    H.msg("set_algo", 1); H.msg("set_more", 1);
    const c = H.calls.length;
    H.msg("set_more", 1); H.msg("set_algo", 1);
    assert.strictEqual(H.calls.length, c);
});

test("head strip paints pills (no End) without throwing", () => {
    const H = loadHead();
    H.get("preview()");
    H.get("paint()");
    H.get("rpState.dsp.ready = 0; rpState.dsp.error = 'x'");
    H.get("paint()");
});

// ---- 4. hero (shifted copy of the waterfall) --------------------------------------------------------------------------------
function loadHero() {
    const calls = [];
    const out = [];
    const mg = new Proxy({ size: [hero.presentation_rect[2], hero.presentation_rect[3]], text_measure: (t) => [String(t).length * 5, 8] }, {
        get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); return 0; }), set: (t, k, v) => { t[k] = v; return true; },
    });
    function FakeTask(fn) { this.repeat = () => {}; this.cancel = () => {}; this.schedule = () => {}; }
    function FakeBuffer() { this.peek = () => []; }
    const ctx = { mgraphics: mg, outlet: (...a) => out.push(a), post: () => {}, Math, Number, String, Array, JSON, isNaN, Float32Array, Float64Array, Int32Array,
        Object, Date, Buffer: FakeBuffer, Task: FakeTask, messagename: "", globalThis: {} };
    vm.createContext(ctx);
    vm.runInContext(heroCode, ctx);
    const msg = (name, ...args) => { ctx.messagename = name; ctx.anything(...args); };
    return { ctx, calls, out, msg, get: (e) => vm.runInContext(e, ctx) };
}

test("hero: 320 x 144, no icon hits, plot / strip rectangles inside the shifted box", () => {
    assert.deepStrictEqual(hero.presentation_rect.slice(2), [320, 144]);
    const g = loadHero();
    const Lh = g.get("rcLayout(320, 161)");
    assert.strictEqual(Lh.icons.length, 0);
    const top = g.get("RCG.top");
    for (const k of ["plot", "strip"]) assert.ok(Lh[k].y - top >= 0 && Lh[k].y - top + Lh[k].h <= 144, k);
    assert.ok(Lh.strip.x >= 0 && Lh.strip.x + Lh.strip.w <= 320);
    assert.ok(Lh.browse.x + Lh.browse.w <= 320 && Lh.clear.x + Lh.clear.w <= 320);
});

test("hero: paint translates back to zero for every algorithm and for Freeze", () => {
    const g = loadHero();
    for (let a = 0; a < 6; a++) {
        g.get("preview()");
        g.get(`rpP.algo = ${a}`);
        g.calls.length = 0;
        g.get("paint()");
        const t = g.calls.filter((c) => c[0] === "translate").reduce((s, c) => s + c[2], 0);
        assert.strictEqual(t, 0, "algorithm " + a);
    }
});

test("hero: a click in the plot picks a band (mouse y shifted), browse / clear only in Convolution", () => {
    const g = loadHero();
    g.get("preview()");
    g.get("RCS.band = -1");
    g.get("onclick(160, 100, 1)"); // inside the plot (box y 100 = layout y 117)
    assert.ok(g.get("RCS.band") >= 0);
    g.get("onclick(160, 100, 1)");
    g.out.length = 0;
    const Lh = g.get("rcLayout(320, 161)");
    const top = g.get("RCG.top");
    g.get(`onclick(${Lh.browse.x + 2}, ${Lh.browse.y + 2 - top}, 1)`);
    assert.strictEqual(g.out.filter((o) => o[0] === 0 && o[1] === "cmd").length, 0, "no browse outside Convolution");
    g.get("rpP.algo = 5");
    g.get(`onclick(${Lh.browse.x + 2}, ${Lh.browse.y + 2 - top}, 1)`);
    assert.deepStrictEqual(g.out.find((o) => o[1] === "cmd").slice(1), ["cmd", "browse_ir"]);
    g.get(`onclick(${Lh.clear.x + 2}, ${Lh.clear.y + 2 - top}, 1)`);
    assert.ok(g.out.some((o) => o[2] === "clear_ir"));
});

test("hero: no algorithm icons are clickable and nothing is sent on a stray click", () => {
    const g = loadHero();
    g.get("preview()");
    g.out.length = 0;
    g.get("onclick(4, 2, 1)");
    assert.strictEqual(g.out.filter((o) => o[1] === "param").length, 0);
});

console.log(`\n${n} tests passed`);
