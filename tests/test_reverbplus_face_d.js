#!/usr/bin/env node
"use strict";
// Reverb+ face `d` ("Display + grouped strip") tests (auto-run by tests/test_reverbplus.js): wide-display geometry, page /
// Convolution visibility logic (face outlet 1), the built device's wiring, parameter coverage, overlaps, bracket lines.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8");
const code = [read("reverbplus_config.js"), read("reverbplus_face_common.js"), read("reverbplus_face_d_math.js"), read("reverbplus_face_d.js")].join("\n");
const C = require("../src/reverbplus_config.js");
const M = (() => {
    const ctx = { module: { exports: {} }, Math, Float32Array, Float64Array, Int32Array, Array, Number, String };
    vm.createContext(ctx);
    vm.runInContext(read("reverbplus_config.js") + "\n" + read("reverbplus_face_d_math.js"), ctx);
    return ctx.module.exports;
})();

let n = 0;
function test(name, fn) {
    try { fn(); n++; console.log("PASS " + name); } catch (e) { console.log("FAIL " + name + ": " + e.stack.split("\n").slice(0, 3).join(" | ")); process.exitCode = 1; }
}

function load() {
    const calls = [];
    const out = [];
    const mg = new Proxy({ size: [624, 95], text_measure: (t) => [String(t).length * 5, 8] }, {
        get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); return 0; }), set: (t, k, v) => { t[k] = v; return true; },
    });
    function FakeBuffer() { this.peek = () => []; }
    function FakeTask() { this.repeat = () => {}; this.cancel = () => {}; this.schedule = () => {}; }
    const ctx = {
        mgraphics: mg, outlet: (...a) => out.push(a), post: () => {}, Math, Number, String, Array, JSON, isNaN, Float32Array, Float64Array, Int32Array,
        Object, Date: { now: () => 100000 }, Buffer: FakeBuffer, Task: FakeTask, messagename: "", globalThis: {},
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    const msg = (name, ...args) => { ctx.messagename = name; ctx.anything(...args); };
    return { ctx, calls, out, msg, get: (e) => vm.runInContext(e, ctx) };
}

/** Last value sent for every `g_<group>` / `act_<key>` message on outlet 1. */
function state(f) {
    const s = {};
    for (const o of f.out) if (o[0] === 1) s[o[1]] = o[2];
    return s;
}

// ---- geometry -----------------------------------------------------------------------------------------------------------
test("wide display: every hit / draw rectangle is inside the 624 x 95 v8ui and the plot, strip and IR buttons do not overlap", () => {
    const L = M.rcLayout(624, 95);
    const inside = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 624 && r.y + r.h <= 95;
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const k of ["info", "plot", "strip", "browse", "clear"]) assert(inside(L[k]), k);
    assert(!ov(L.plot, L.strip) && !ov(L.strip, L.browse) && !ov(L.strip, L.clear) && !ov(L.browse, L.clear));
    assert(!ov(L.plot, L.browse));
    // every waterfall row (front .. back) stays inside the plot
    for (let t = 0; t <= 1; t += 0.1) {
        const g = M.rcRowGeom(t);
        assert(g.base <= L.plot.y + L.plot.h - 8 && g.base - g.hmax >= L.plot.y, "row " + t.toFixed(1));
        assert(M.rcBandX(0, g.s) >= 0 && M.rcBandX(31, g.s) <= L.plot.w);
    }
    // the click inverse still finds the band under a row
    for (const b of [0, 10, 20, 31]) {
        const g = M.rcRowGeom(0.4);
        assert.strictEqual(M.rcHitBand(M.rcBandX(b, g.s), g.base - 3), b);
    }
    assert.strictEqual(M.rcStripBand(L.strip.x + 1), 0);
    assert.strictEqual(M.rcStripBand(L.strip.x + L.strip.w - 1), 31);
});

test("paint: every algorithm, frozen, with a band selected, Convolution without an IR", () => {
    for (let algo = 0; algo < 6; algo++) {
        const f = load();
        f.ctx.preview();
        f.msg("set_algo", algo);
        f.ctx.rpT.s = f.ctx.rpFakeScope(algo, 2.5);
        f.calls.length = 0;
        f.ctx.paint();
        assert(f.calls.length > 100, "algo " + algo);
        const xs = f.calls.filter((c) => c[0] === "show_text").length;
        assert(xs > 3);
    }
    const f = load();
    f.msg("set_algo", 5);
    f.calls.length = 0;
    f.ctx.paint();
    assert(f.calls.some((c) => c[0] === "show_text" && /click to load an impulse response/.test(c[1])));
    f.msg("set_algo", 1);
    f.msg("set_freeze", 1);
    f.ctx.rpT.s = f.ctx.rpFakeScope(1, 2);
    f.calls.length = 0;
    f.ctx.paint();
    assert(f.calls.some((c) => c[0] === "show_text" && c[1] === "FROZEN"));
});

test("clicks: a plot click picks a band, drag moves it, double-click clears, the strip picks too; no icons any more", () => {
    const f = load();
    f.ctx.preview();
    f.msg("set_algo", 1);
    f.out.length = 0;
    f.ctx.onclick(10, 4, 1); // where the icons used to be
    assert.strictEqual(f.out.filter((o) => o[0] === 0).length, 0, "nothing is sent to the parameters");
    f.ctx.onclick(RCGx("cx"), 76, 1);
    const b1 = f.get("RCS.band");
    assert(b1 >= 14 && b1 <= 17, "centre of the plot is about band 15: " + b1);
    f.ctx.ondrag(440, 76, 1);
    assert(f.get("RCS.band") > 25);
    f.ctx.ondrag(440, 76, 0);
    f.ctx.ondblclick();
    assert.strictEqual(f.get("RCS.band"), -1);
    const L = M.rcLayout(624, 95);
    f.ctx.onclick(L.strip.x + 3, L.strip.y + 10, 1);
    assert.strictEqual(f.get("RCS.band"), 0);
    f.ctx.onclick(RCGx("cx"), 76, 1);
    f.calls.length = 0;
    f.ctx.paint();
    assert(f.calls.some((c) => c[0] === "show_text" && /Hz\s+\d/.test(c[1])), "band readout in the right panel");
});
function RCGx(k) { return M.RCG[k]; }

test("Convolution: browse / clear and the empty plot send commands; other algorithms ignore them", () => {
    const f = load();
    f.ctx.preview();
    const L = M.rcLayout(624, 95);
    f.msg("set_algo", 5);
    f.msg("state", "ir", "idle", 0, 0, 0, 0, 0, "-");
    f.out.length = 0;
    f.ctx.onclick(L.browse.x + 4, L.browse.y + 4, 1);
    f.ctx.onclick(L.clear.x + 4, L.clear.y + 4, 1);
    f.ctx.onclick(240, 60, 1);
    assert.deepStrictEqual(f.out.filter((o) => o[0] === 0).map((o) => o[2]), ["browse_ir", "clear_ir", "browse_ir"]);
    f.msg("set_algo", 1);
    f.out.length = 0;
    f.ctx.onclick(L.browse.x + 4, L.browse.y + 4, 1);
    assert.strictEqual(f.out.filter((o) => o[0] === 0).length, 0);
});

// ---- page / Convolution visibility logic ---------------------------------------------------------------------------------------
const GROUPS = ["sp1", "sp1t", "sp1c", "sp2t", "sp2c", "tn1", "tn2", "lp1", "lp2", "mx1", "mx2"];
const shown = (st) => GROUPS.filter((g) => st["g_" + g] === 0).join(",");

test("visibility: tank algorithms show each group's page 1; a title click swaps only that group; Convolution swaps SPACE", () => {
    for (const algo of [0, 1, 2, 3, 4]) {
        const f = load();
        f.msg("set_algo", algo);
        assert.strictEqual(shown(state(f)), "sp1,sp1t,tn1,lp1,mx1", "algo " + algo);
        f.msg("set_pg_space", 1);
        assert.strictEqual(shown(state(f)), "sp2t,tn1,lp1,mx1");
        f.msg("set_pg_tone", 1);
        f.msg("set_pg_loop", 1);
        f.msg("set_pg_mix", 1);
        assert.strictEqual(shown(state(f)), "sp2t,tn2,lp2,mx2");
        f.msg("set_pg_space", 0);
        assert.strictEqual(shown(state(f)), "sp1,sp1t,tn2,lp2,mx2");
    }
    const f = load();
    f.msg("set_algo", 5);
    assert.strictEqual(shown(state(f)), "sp1,sp1c,tn1,lp1,mx1", "Convolution page 1: IR Stretch instead of Size");
    f.msg("set_pg_space", 1);
    assert.strictEqual(shown(state(f)), "sp2c,tn1,lp1,mx1", "Convolution page 2: IR controls instead of Diffusion / Mod");
    f.msg("set_algo", 2);
    assert.strictEqual(shown(state(f)), "sp2t,tn1,lp1,mx1");
});

test("visibility: messages go out once per change; a dsp state change re-sends everything", () => {
    const f = load();
    f.msg("set_algo", 1);
    const count = () => f.out.filter((o) => o[0] === 1).length;
    const c0 = count();
    assert.strictEqual(c0, 11 + 9, "every group and every activity flag once");
    f.msg("set_algo", 2);
    f.msg("set_pg_tone", 0);
    assert.strictEqual(count(), c0, "no repeat without a change");
    f.msg("set_pg_tone", 1);
    assert.strictEqual(count(), c0 + 2);
    f.msg("state", "dsp", 1, "-");
    assert.strictEqual(count(), c0 + 2 + 20, "forced re-send");
});

test("greying: the algorithm's inactive parameters (RP_INACTIVE) get act_<key> 0", () => {
    const f = load();
    for (let algo = 0; algo < 6; algo++) {
        f.out.length = 0;
        f.msg("set_algo", algo);
        f.msg("state", "dsp", 1, "-"); // force a full send each time
        const st = state(f);
        for (const k of ["decay", "freeze", "size", "diffusion", "modrate", "moddepth", "bassmult", "xover", "erlevel"]) {
            assert.strictEqual(st["act_" + k], C.RP_INACTIVE[algo].includes(k) ? 0 : 1, `algo ${algo} ${k}`);
        }
    }
});

// ---- the built device ---------------------------------------------------------------------------------------------------------
function build(env) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rp_d_"));
    execFileSync("python3", [path.join(ROOT, "scripts", "build_reverbplus.py"), "--variant", "d", "--no-sets", "--out-dir", tmp],
        { cwd: ROOT, stdio: "pipe", env: Object.assign({}, process.env, env || {}) });
    const buf = fs.readFileSync(path.join(tmp, "Reverb+ D.amxd"));
    const doc = JSON.parse(buf.slice(32, 32 + buf.readUInt32LE(28)).toString("utf8"));
    return { doc, boxes: doc.patcher.boxes.map((b) => b.box), lines: doc.patcher.lines.map((l) => l.patchline) };
}
const ov = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

test("built device: every parameter has a presented widget, 12 controls + 4 titles on page 1, 632 x 169, nothing overlaps, nothing over the display", () => {
    const { doc, boxes } = build();
    assert.strictEqual(doc.patcher.openrect[3], 169);
    assert.strictEqual(doc.patcher.devicewidth, 632);
    const ctrls = boxes.filter((b) => (b.id || "").startsWith("obj-ctrl-"));
    const keys = ctrls.map((b) => b.id.slice("obj-ctrl-".length));
    for (const k of ["algo", "predelay", "size", "decay", "diffusion", "damp", "bassmult", "xover", "modrate", "moddepth", "erlevel", "latelevel", "lowcut", "highcut",
        "width", "freeze", "loop", "looptime", "loopclip", "looplevel", "duck", "duckrel", "drywet", "output", "irstretch", "irstart", "irreverse", "irdecay", "irfile",
        "pg_space", "pg_tone", "pg_loop", "pg_mix"]) assert(keys.includes(k), k);
    for (const b of ctrls) assert.strictEqual(b.presentation, 1, b.id + " is on the face (nothing off-face)");
    const vis = ctrls.filter((b) => !b.hidden);
    const titles = vis.filter((b) => /obj-ctrl-pg_/.test(b.id));
    assert.strictEqual(titles.length, 4);
    assert.strictEqual(vis.length - titles.length, 12, "12 value controls on page 1");
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) assert(!ov(vis[i].presentation_rect, vis[j].presentation_rect), `${vis[i].id} / ${vis[j].id}`);
    const viz = boxes.find((b) => b.id === "obj-lay-d-viz");
    assert.deepStrictEqual(viz.presentation_rect, [4, 4, 624, 95]);
    for (const b of boxes) {
        if (!String(b.maxclass).startsWith("live.") || b.presentation !== 1 || b.maxclass === "live.comment" || b.maxclass === "live.line") continue;
        assert(!ov(b.presentation_rect, viz.presentation_rect), b.id + " over the display");
    }
    const first = boxes.findIndex((b) => b.maxclass === "panel");
    assert(boxes.slice(first).every((b) => b.maxclass === "panel" && b.background === 1), "panels last");
    // no colour attributes on the value widgets (Live theme); the title toggles are theme-bound
    for (const b of ctrls.filter((x) => x.maxclass === "live.dial")) assert(!b.activedialcolor && !b.activeneedlecolor, b.id);
});

test("built device: bracket lines, ticks and separators lie inside the controls row panel; titles sit centred in their bracket gap", () => {
    const { boxes } = build();
    const panel = boxes.find((b) => b.id === "obj-lay-d-row").presentation_rect;
    const lines = boxes.filter((b) => b.maxclass === "live.line");
    assert(lines.length >= 4 * 4 + 3, "4 groups x (2 bracket pieces + 2 ticks) + 3 separators: " + lines.length);
    for (const l of lines) {
        const r = l.presentation_rect;
        assert(r[0] >= panel[0] && r[1] >= panel[1] && r[0] + r[2] <= panel[0] + panel[2] && r[1] + r[3] <= panel[1] + panel[3], l.id + " inside the row panel");
        assert(Math.min(r[2], r[3]) >= 2, l.id + " at least 2 px thick (a 1 px live.line draws nothing)");
    }
    for (const g of ["space", "tone", "loop", "mix"]) {
        const L = boxes.find((b) => b.id === `obj-lay-d-br-${g}-l`).presentation_rect;
        const R = boxes.find((b) => b.id === `obj-lay-d-br-${g}-r`).presentation_rect;
        const T = boxes.find((b) => b.id === `obj-ctrl-pg_${g}`).presentation_rect;
        const gap = [L[0] + L[2], R[0]];
        assert(Math.abs((gap[0] + gap[1]) / 2 - (T[0] + T[2] / 2)) < 0.01, g + " title centred in the gap");
        assert(T[0] >= gap[0] && T[0] + T[2] <= gap[1], g + " title fits the gap");
    }
    // the dials of a group sit between its bracket ends; every separator lies in a gap between two groups
    const seps = lines.filter((l) => /-sep-/.test(l.id)).map((l) => l.presentation_rect[0]);
    const ticks = lines.filter((l) => /-tick-/.test(l.id)).map((l) => l.presentation_rect[0]).sort((a, b) => a - b);
    seps.forEach((x, i) => assert(x > ticks[2 * i + 1] && x < ticks[2 * i + 2], "separator " + i));
    const dials = boxes.filter((b) => b.maxclass === "live.dial" || b.maxclass === "live.menu" || b.maxclass === "live.text" && !/pg_/.test(b.id));
    for (const b of dials) {
        const r = b.presentation_rect;
        const g = lines.filter((l) => /-tick-/.test(l.id));
        const left = Math.max(...g.map((l) => l.presentation_rect[0]).filter((x) => x <= r[0] + 0.01));
        const right = Math.min(...g.map((l) => l.presentation_rect[0] + 2).filter((x) => x >= r[0] + r[2] - 0.01));
        assert(isFinite(left) && isFinite(right), b.id + " inside a bracket");
    }
});

test("built device: page wiring, saved visibility, page / algorithm states from the build environment", () => {
    for (const [page, expect] of [["", "sp1,sp1t,tn1,lp1,mx1"], ["space2", "sp2t,tn1,lp1,mx1"], ["tone2", "sp1,sp1t,tn2,lp1,mx1"], ["loop2", "sp1,sp1t,tn1,lp2,mx1"],
        ["mix2", "sp1,sp1t,tn1,lp1,mx2"], ["conv", "sp1,sp1c,tn1,lp1,mx1"], ["conv2", "sp2c,tn1,lp1,mx1"]]) {
        const { boxes, lines } = build({ REVERBPLUS_D_PAGE: page });
        const byId = (id) => boxes.find((b) => b.id === id);
        const has = (a, ao, b, bi) => lines.some((l) => l.source[0] === a && l.source[1] === ao && l.destination[0] === b && l.destination[1] === bi);
        assert(has("obj-lay-d-viz", 1, "obj-lay-d-route", 0));
        const route = byId("obj-lay-d-route");
        assert.strictEqual(route.numoutlets, 11 + 9 + 1);
        GROUPS.forEach((g, i) => {
            assert(has("obj-lay-d-route", i, `obj-lay-d-hide-${g}`, 0), g);
            assert(route.text.split(" ")[1 + i] === "g_" + g);
        });
        // every member of a group is wired to its prepend and carries the hidden flag the logic expects
        const shownSet = new Set(expect.split(","));
        for (const g of GROUPS) {
            const members = lines.filter((l) => l.source[0] === `obj-lay-d-hide-${g}`).map((l) => l.destination[0]);
            assert(members.length >= 1, g + " has members");
            for (const m of members) assert.strictEqual(byId(m).hidden === 1, !shownSet.has(g), `${page || "default"}: ${m} (${g})`);
        }
        const act = ["decay", "freeze", "size", "diffusion", "modrate", "moddepth", "bassmult", "xover", "erlevel"];
        act.forEach((k, j) => assert(has("obj-lay-d-route", 11 + j, `obj-lay-d-act-${k}`, 0) && has(`obj-lay-d-act-${k}`, 0, `obj-ctrl-${k}`, 0), "act " + k));
        const pgOn = { space2: "pg_space", tone2: "pg_tone", loop2: "pg_loop", mix2: "pg_mix", conv2: "pg_space" }[page];
        for (const k of ["pg_space", "pg_tone", "pg_loop", "pg_mix"]) {
            assert.deepStrictEqual(byId("obj-ctrl-" + k).saved_attribute_attributes.valueof.parameter_initial, [k === pgOn ? 1 : 0], page + " " + k);
        }
        // visible controls per page never overlap and stay in the row
        const vis = boxes.filter((b) => (b.id || "").startsWith("obj-ctrl-") && !b.hidden);
        for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) assert(!ov(vis[i].presentation_rect, vis[j].presentation_rect), `${page}: ${vis[i].id} / ${vis[j].id}`);
        // widgets of one group sit in a free slot: a page's twin groups never put two visible widgets in the same place
        const all = [...GROUPS].map((g) => lines.filter((l) => l.source[0] === `obj-lay-d-hide-${g}`).map((l) => byId(l.destination[0])));
        assert(all.every((a) => a.every((b) => b.presentation_rect[1] >= 100 && b.presentation_rect[1] + b.presentation_rect[3] <= 169)), "controls inside the row");
    }
});

test("built device: the Convolution swap keeps the Size / IR Stretch twins and SPACE page 2 twins in the same slots", () => {
    const { boxes } = build();
    const r = (id) => boxes.find((b) => b.id === id).presentation_rect;
    assert.deepStrictEqual(r("obj-ctrl-size"), r("obj-ctrl-irstretch"));
    assert.deepStrictEqual(r("obj-ctrl-diffusion"), r("obj-ctrl-irstart"));
    assert.deepStrictEqual(r("obj-ctrl-modrate"), r("obj-ctrl-irdecay"));
    // the display script is small and declares no Max globals
    const viz = boxes.find((b) => b.id === "obj-lay-d-viz");
    assert(Buffer.byteLength(viz.textfile.text) < 200000);
    assert(!/(^|\n)\s*(var|let|const)\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(viz.textfile.text));
});

console.log(`${n} passed`);
