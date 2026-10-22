#!/usr/bin/env node
"use strict";
// Reverb+ face `a` ("Signal-flow sections") tests (auto-run by tests/test_reverbplus.js): display layout / hit rectangles with
// the overridden geometry, the display and the deco v8ui against a fake mgraphics, the deco geometry (RAD) against the built
// device, page logic for every algorithm (Convolution swaps the dials / MOD column and hides the tank-only values), no overlap
// of visible controls, no live.* over the interactive display, lines / wells / brackets inside their panels.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8");
const C = require("../src/reverbplus_config.js");
const heroCode = [read("reverbplus_config.js"), read("reverbplus_face_common.js"), read("reverbplus_face_math.js"), read("reverbplus_face_a.js")].join("\n");
const decoCode = [read("reverbplus_config.js"), read("reverbplus_face_common.js"), read("reverbplus_face_a_deco.js")].join("\n");

let n = 0;
function test(name, fn) {
    try { fn(); n++; console.log("PASS " + name); } catch (e) { console.log("FAIL " + name + ": " + e.stack.split("\n").slice(0, 3).join(" | ")); process.exitCode = 1; }
}

function load(code, size) {
    const calls = [], out = [], tasks = [];
    const mg = new Proxy({ size, text_measure: (t) => [String(t).length * 5, 8] }, {
        get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); return 0; }), set: (t, k, v) => { t[k] = v; return true; },
    });
    function FakeBuffer() { this.peek = () => []; }
    function FakeTask(fn) { this.fn = fn; this.repeat = () => tasks.push(this); this.cancel = () => {}; this.schedule = () => {}; }
    const ctx = {
        mgraphics: mg, outlet: (...a) => out.push(a), post: () => {}, Math, Number, String, Array, JSON, isNaN, Float32Array, Float64Array, Int32Array, Object,
        Date: { now: () => 100000 }, Buffer: FakeBuffer, Task: FakeTask, messagename: "", globalThis: {},
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return { ctx, calls, out, msg: (name, ...args) => { ctx.messagename = name; ctx.anything(...args); }, get: (e) => vm.runInContext(e, ctx) };
}

const ov = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const inside = (r, o) => r[0] >= o[0] - 1e-6 && r[1] >= o[1] - 1e-6 && r[0] + r[2] <= o[0] + o[2] + 1e-6 && r[1] + r[3] <= o[1] + o[3] + 1e-6;

function build(page) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rp_a_"));
    execFileSync("python3", [path.join(ROOT, "scripts", "build_reverbplus.py"), "--variant", "a", "--no-sets", "--out-dir", tmp],
        { cwd: ROOT, stdio: "pipe", env: Object.assign({}, process.env, { RA_PAGE: page }) });
    const buf = fs.readFileSync(path.join(tmp, "Reverb+ A.amxd"));
    const doc = JSON.parse(buf.slice(32, 32 + buf.readUInt32LE(28)).toString("utf8"));
    return { doc, boxes: doc.patcher.boxes.map((b) => b.box), lines: doc.patcher.lines.map((l) => l.patchline) };
}
const tank = build("tank");
const conv = build("conv");
const deco = load(decoCode, [586, 169]);
const RAD = JSON.parse(JSON.stringify(deco.get("RAD")));
const hero = load(heroCode, [210, 88]);

const TANK_ONLY = ["size", "decay", "diffusion", "modrate", "moddepth", "bassmult", "xover", "erlevel"];
const IR_ONLY = ["irstretch", "irstart", "irdecay", "irreverse", "irfile"];
const OFF = ["output", "duck", "duckrel"];
const byId = (d, id) => d.boxes.find((b) => b.id === id);
const visibleControls = (d) => d.boxes.filter((b) => /^live\.(dial|numbox|text|menu|drop)$/.test(b.maxclass) && b.presentation === 1 && !b.hidden);

// ---- display (hero) -------------------------------------------------------------------------------------------------------
test("display layout: plot, strip, browse / clear inside 210 x 88 and disjoint; ridges stay inside the plot", () => {
    const L = hero.ctx.rcaLayout(210, 88);
    const rects = [L.plot, L.strip, L.browse, L.clear].map((r) => [r.x, r.y, r.w, r.h]);
    for (const r of rects) assert(inside(r, [0, 0, 210, 88]), JSON.stringify(r));
    assert(!ov(rects[0], rects[1]) && !ov(rects[2], rects[0]) && !ov(rects[3], rects[0]) && !ov(rects[2], rects[3]));
    const RCG = hero.get("RCG");
    assert(RCG.x1 <= 210 && RCG.x0 >= 0);
    const g0 = hero.ctx.rcRowGeom(0), g1 = hero.ctx.rcRowGeom(1);
    assert(g0.base - g0.hmax >= L.plot.y && g1.base - g1.hmax >= L.plot.y, "ridges under the info row");
    assert(g0.base + 8 <= L.strip.y, "axis labels above the strip");
});

test("display: band inverse with the overridden geometry; clicks pick bands, strip picks bands, IR buttons only in Convolution", () => {
    for (const t of [0, 0.5, 1]) {
        const g = hero.ctx.rcRowGeom(t);
        for (const b of [0, 7, 31]) assert.strictEqual(hero.ctx.rcHitBand(hero.ctx.rcBandX(b, g.s), g.base), b);
    }
    const f = load(heroCode, [210, 88]);
    f.msg("set_algo", 1);
    f.ctx.onclick(100, 40, 1);
    assert(f.get("RCS.band") >= 0);
    f.ctx.onclick(100, 40, 1);
    assert.strictEqual(f.get("RCS.band"), -1, "second click on the same band clears it");
    f.ctx.onclick(100, 78, 1);
    assert(f.get("RCS.band") >= 0, "strip pick");
    const L = f.ctx.rcaLayout(210, 88);
    f.out.length = 0;
    f.ctx.onclick(L.browse.x + 3, L.browse.y + 3, 1);
    assert(!f.out.some((o) => o[0] === 0 && o[1] === "cmd"), "no browse in a tank algorithm");
    f.msg("set_algo", 5);
    f.ctx.onclick(L.browse.x + 3, L.browse.y + 3, 1);
    assert(f.out.some((o) => o[0] === 0 && o[1] === "cmd" && o[2] === "browse_ir"));
    f.ctx.onclick(L.clear.x + 3, L.clear.y + 3, 1);
    assert(f.out.some((o) => o[1] === "cmd" && o[2] === "clear_ir"));
    // no algorithm icons any more: a click in the old icon row sends nothing
    f.out.length = 0;
    f.ctx.onclick(10, 6, 1);
    assert(!f.out.some((o) => o[1] === "param" && o[2] === "algo"));
});

test("display: swap flags follow the algorithm (tank <-> Convolution) and every algorithm paints", () => {
    const f = load(heroCode, [210, 88]);
    for (let a = 0; a < 6; a++) {
        f.out.length = 0;
        f.msg("set_algo", a);
        f.ctx.preview();
        f.msg("set_algo", a);
        f.ctx.paint();
        const flags = f.out.filter((o) => o[0] === 1);
        const lastTank = flags.filter((o) => o[1] === "hide_tank").pop();
        assert(lastTank === undefined || lastTank[2] === (a === 5 ? 1 : 0), "algo " + a);
        assert.strictEqual(f.get("RCS.hideTank"), a === 5 ? 1 : 0);
        assert.strictEqual(f.get("RCS.hideIr"), a === 5 ? 0 : 1);
    }
});

test("display: frozen and idle states paint without throwing", () => {
    const f = load(heroCode, [210, 88]);
    f.ctx.preview();
    f.msg("set_freeze", 1);
    f.ctx.paint();
    f.msg("state", "dsp", 0, "-");
    f.ctx.paint();
});

// ---- deco v8ui ---------------------------------------------------------------------------------------------------------------
test("deco: paints in both pages; Convolution drops the tank-only wells / brackets and shows the IR column caption", () => {
    const wellDrawn = (d, r) => d.calls.some((c) => c[0] === "rectangle_rounded" && c[1] === r[0] && c[2] === r[1] && c[3] === r[2] && c[4] === r[3]);
    const texts = (d) => d.calls.filter((c) => c[0] === "show_text").map((c) => c[1]);
    const t = load(decoCode, [586, 169]);
    t.msg("set_algo", 1); t.ctx.preview(); t.msg("set_algo", 1); t.calls.length = 0; t.ctx.paint();
    for (const w of RAD.wells) if (!w.menu) assert(wellDrawn(t, w.r), "tank well " + w.key);
    assert(texts(t).includes("MOD") && !texts(t).includes("IMPULSE"));
    const c = load(decoCode, [586, 169]);
    c.msg("set_algo", 5); c.ctx.preview(); c.msg("set_algo", 5); c.calls.length = 0; c.ctx.paint();
    for (const w of RAD.wells) {
        if (w.menu) continue;
        assert.strictEqual(wellDrawn(c, w.r), w.page !== "tank", "conv well " + w.key);
    }
    assert(texts(c).includes("IMPULSE") && !texts(c).includes("MOD"));
    for (const s of RAD.sections) assert(texts(c).includes(s.title) && texts(t).includes(s.title));
});

test("deco: clip LED lights for about a second after the loop clip engages, MIN shows when the loop is clamped", () => {
    const d = load(decoCode, [586, 169]);
    d.msg("set_loop", 50);
    const s = new Float32Array(C.RP_SCOPE_SAMPS);
    s[C.RP_SCOPE.CLIP_DB] = -3; s[C.RP_SCOPE.CLAMPED] = 1; s[C.RP_SCOPE.MIN_MS] = 12.5;
    d.ctx.onFrame({ active: true, s });
    assert(d.get("RDS.clipAt") > 0);
    d.ctx.rpT.s = s;
    d.calls.length = 0; d.ctx.paint();
    assert(d.calls.some((c) => c[0] === "show_text" && String(c[1]).startsWith("MIN ")));
    d.msg("set_loop", 0);
    d.calls.length = 0; d.ctx.paint();
    assert(d.calls.some((c) => c[0] === "show_text" && c[1] === "loop off"));
});

test("deco geometry: wells, brackets, rules, separators, titles and the filter curve lie inside the panels", () => {
    const main = [4, 4, 494, 161], right = [502, 4, 80, 161];
    const inPanel = (r) => inside(r, main) || inside(r, right);
    for (const w of RAD.wells) assert(inPanel(w.r), w.key);
    for (const b of RAD.brackets) assert(inPanel([b.x, b.y0, 3, b.y1 - b.y0]));
    for (const r of RAD.rules) assert(inPanel([r.x0, r.y, r.x1 - r.x0, 0]));
    for (const x of RAD.seps) assert(x > main[0] && x < main[0] + main[2]);
    for (const s of RAD.sections) assert(inside([s.x, RAD.ruleY, s.w, 0], main), s.id);
    assert(inside([RAD.curve.x, RAD.curve.y, RAD.curve.w, RAD.curve.h], main));
    // the sections are ordered, do not overlap and each lies between its separators
    for (let i = 1; i < RAD.sections.length; i++) assert(RAD.sections[i].x >= RAD.sections[i - 1].x + RAD.sections[i - 1].w);
    assert(RAD.sections[0].x + RAD.sections[0].w < RAD.seps[0] && RAD.sections[1].x > RAD.seps[0] && RAD.sections[1].x + RAD.sections[1].w < RAD.seps[1]);
    assert(RAD.sections[2].x > RAD.seps[1] && RAD.sections[2].x + RAD.sections[2].w < RAD.seps[2] && RAD.sections[3].x > RAD.seps[2]);
    // a label sits left of its well and does not run into it (7.5 pt bold ~ 4.6 px per character)
    for (const w of RAD.wells) assert(w.lx + w.label.length * 4.6 <= w.r[0] + 2, "label " + w.label);
    assert.strictEqual(RAD.W, 586);
});

test("filter curve: -3 dB at the cut-offs, flat in between, steep outside", () => {
    const f = deco.ctx.radFilterDb;
    assert(Math.abs(f(60, 60, 16000)) < 3.2 && Math.abs(f(60, 60, 16000)) > 2.8);
    assert(Math.abs(f(1000, 60, 16000)) < 0.01);
    assert(f(20, 60, 16000) < -10 && f(20000, 60, 16000) < -3);
});

// ---- the built device ------------------------------------------------------------------------------------------------------------------
for (const [name, d] of [["tank", tank], ["conv", conv]]) {
    test(`built device (${name} page): every parameter presented or off the face, deco / display wiring, no overlap, panels last`, () => {
        assert.strictEqual(d.doc.patcher.openrect[3], 169);
        assert.strictEqual(d.doc.patcher.openrect[2], 586);
        const keys = d.boxes.filter((b) => /^obj-ctrl-/.test(b.id)).map((b) => b.id.slice(9));
        const expected = "algo predelay size decay diffusion damp bassmult xover modrate moddepth erlevel latelevel lowcut highcut width freeze loop looptime loopclip looplevel duck duckrel drywet output irstretch irstart irreverse irdecay irfile".split(" ");
        assert.deepStrictEqual(keys.slice().sort(), expected.slice().sort());
        for (const k of OFF) assert.strictEqual(byId(d, "obj-ctrl-" + k).presentation, 0, k + " off the face");
        for (const k of expected.filter((x) => !OFF.includes(x))) assert.strictEqual(byId(d, "obj-ctrl-" + k).presentation, 1, k + " on the face");
        const viz = byId(d, "obj-lay-a-viz"), dec = byId(d, "obj-lay-a-deco");
        assert(viz.numoutlets === 2 && dec.ignoreclick === 1);
        assert.deepStrictEqual(dec.presentation_rect, [0, 0, 586, 169]);
        const order = d.boxes.map((b) => b.id);
        assert(order.indexOf("obj-lay-a-deco") < order.indexOf("obj-lay-a-viz") && order.indexOf("obj-lay-a-viz") < order.indexOf("obj-ctrl-size"), "deco behind display behind controls");
        // visible control rule 4 + overlap
        for (const b of d.boxes) {
            if (!String(b.maxclass).startsWith("live.") || b.presentation !== 1 || b.maxclass === "live.comment" || b.hidden) continue;
            assert(!ov(b.presentation_rect, viz.presentation_rect), b.id + " over the display");
            assert(inside(b.presentation_rect, [0, 0, 586, 169]), b.id);
        }
        const vis = visibleControls(d);
        for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) assert(!ov(vis[i].presentation_rect, vis[j].presentation_rect), `${vis[i].id} / ${vis[j].id}`);
        // page visibility at save
        for (const k of TANK_ONLY) assert.strictEqual(!!byId(d, "obj-ctrl-" + k).hidden, name === "conv", k);
        for (const k of IR_ONLY) assert.strictEqual(!!byId(d, "obj-ctrl-" + k).hidden, name === "tank", k);
        const first = d.boxes.findIndex((b) => b.maxclass === "panel");
        assert(d.boxes.slice(first).every((b) => b.maxclass === "panel" && b.background === 1));
        assert(!/(^|\n)\s*(var|let|const)\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(dec.textfile.text + viz.textfile.text));
        // no colour attributes on live.* except the pre-blended numbox none: Live theme colours only
        for (const b of d.boxes.filter((x) => /^live\.(dial|menu|text)$/.test(x.maxclass))) {
            for (const a of ["activebgcolor", "activedialcolor", "textcolor", "bgcolor"]) assert(!(a in b), b.id + " has " + a);
        }
        console.log(`  (${name} page: ${vis.length} visible controls)`);
    });
}

test("built device: swap block wiring (tank-only <-> IR twins), Freeze greyed in Convolution, IR twins share their tank slot", () => {
    const { lines } = tank;
    const has = (a, ao, b, bi) => lines.some((l) => l.source[0] === a && l.source[1] === ao && l.destination[0] === b && l.destination[1] === bi);
    assert(has("obj-lay-a-viz", 1, "obj-lay-a-route", 0) && has("obj-lay-a-viz", 0, "obj-route-face", 0));
    for (const k of TANK_ONLY) assert(has("obj-lay-a-hide-tank", 0, "obj-ctrl-" + k, 0), "tank " + k);
    for (const k of IR_ONLY) assert(has("obj-lay-a-hide-ir", 0, "obj-ctrl-" + k, 0), "ir " + k);
    assert(has("obj-lay-a-route", 0, "obj-lay-a-frz-not", 0) && has("obj-lay-a-frz-not", 0, "obj-lay-a-frz-active", 0) && has("obj-lay-a-frz-active", 0, "obj-ctrl-freeze", 0));
    ["size:irstretch", "decay:irstart", "diffusion:irdecay"].forEach((p) => {
        const [a, b] = p.split(":");
        assert.deepStrictEqual(byId(tank, "obj-ctrl-" + a).presentation_rect, byId(tank, "obj-ctrl-" + b).presentation_rect);
    });
    // the MOD column and the IR column share the same area
    const mod = [byId(tank, "obj-ctrl-modrate").presentation_rect, byId(tank, "obj-ctrl-moddepth").presentation_rect];
    const ir = [byId(tank, "obj-ctrl-irreverse").presentation_rect, byId(tank, "obj-ctrl-irfile").presentation_rect];
    for (let i = 0; i < 2; i++) assert(ov(mod[i], ir[i]) && Math.abs(mod[i][1] - ir[i][1]) < 1e-6);
    // every deco well matches its live.* widget exactly
    for (const w of RAD.wells) assert.deepStrictEqual(byId(tank, "obj-ctrl-" + w.key).presentation_rect, w.r, w.key);
    // algorithm menu: in the SPACE title row, above the hairline
    const algo = byId(tank, "obj-ctrl-algo").presentation_rect;
    assert(algo[1] + algo[3] < RAD.ruleY && algo[0] >= RAD.sections[1].x && algo[0] + algo[2] <= RAD.sections[1].x + RAD.sections[1].w);
});

test("page logic: Convolution applies to algorithm 5 only; tank-only parameters are exactly those RP_INACTIVE drops in Convolution", () => {
    for (const k of TANK_ONLY) assert(C.RP_INACTIVE[5].includes(k), k);
    for (const k of ["irstretch", "irstart", "irdecay", "irreverse"]) assert(!C.RP_INACTIVE[5].includes(k) && C.RP_INACTIVE[1].includes(k));
    for (const a of [0, 1, 2, 3, 4]) for (const k of IR_ONLY.filter((x) => x !== "irfile")) assert(C.RP_INACTIVE[a].includes(k));
});

console.log(`${n} passed`);
