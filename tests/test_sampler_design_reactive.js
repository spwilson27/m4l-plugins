#!/usr/bin/env node
/**
 * Better Sampler "reactive" design: graph handles, the drawer, and that every parameter is reachable.
 * Run after `python3 scripts/build_sampler.py reactive`.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const raw = fs.readFileSync(path.join(ROOT, "devices", "Better Sampler Reactive.amxd"));
const patcher = JSON.parse(raw.slice(32).toString("utf8")).patcher;
const box = patcher.boxes.map((b) => b.box).find((b) => b.id === "obj-viz");

const emitted = [];
const noop = () => {};
const sb = {
    mgraphics: new Proxy({ size: [780, 169] }, { get: (t, k) => (k in t ? t[k] : noop) }),
    outlet: (...a) => emitted.push(a),
    notifyclients: noop, arrayfromargs: (a) => Array.from(a), post: noop,
    Buffer: function () { this.framecount = () => 96000; this.channelcount = () => 2; this.peek = (c, s, l) => new Float32Array(Math.max(1, l || 1)); this.poke = noop; },
    Task: function () { this.schedule = noop; this.cancel = noop; this.repeat = noop; },
    Math, Number, String, Array, Object, Float32Array, Uint8Array, JSON, Date,
};
vm.createContext(sb);
vm.runInContext(box.textfile.text, sb);
const FP = sb.FACE_PARAMS;
sb.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope", "#0-bspitch");
sb.sample_loaded("/Users/test/Pad.wav");
sb.sample_loaded("bang");

const params = () => emitted.filter((a) => a[1] === "param").map((a) => ({ key: a[2], v: a[3] }));
const zones = (kind, id) => sb.hitZones.filter((z) => z.kind === kind && (!id || z.id === id));
function dragHandle(id, dx, dy) {
    sb.paint();
    const z = zones("hdl", id)[0];
    assert.ok(z, `handle ${id} exists`);
    emitted.length = 0;
    sb.onclick(z.cx, z.cy, 1, 0, 0);
    sb.ondrag(z.cx + dx, z.cy + dy, 1, 0, 0);
    sb.ondrag(z.cx + dx, z.cy + dy, 0, 0, 0);
    sb.paint();
    return params();
}
const inRange = (p) => { const s = FP[p.key]; assert.ok(s, `known param ${p.key}`); assert.ok(p.v >= s.lo - 1e-6 && p.v <= s.hi + 1e-6, `${p.key}=${p.v} in ${s.lo}..${s.hi}`); };

// --- amp envelope handles ---
sb.set_show_inspector(0);
for (const [id, keys] of [["env:A", ["atk_ms"]], ["env:D", ["dec_ms"]], ["env:S", ["sus_lvl"]], ["env:R", ["rel_ms"]]]) {
    const before = {}; keys.forEach((k) => { before[k] = sb.paramValue(k); });
    const right = dragHandle(id, 14, id === "env:S" ? -12 : 0);
    right.forEach(inRange);
    assert.ok(right.some((p) => keys.includes(p.key)), `${id} writes ${keys}`);
    if (id !== "env:S") assert.ok(sb.paramValue(keys[0]) > before[keys[0]], `${id}: dragging right lengthens`);
    else assert.ok(sb.paramValue("sus_lvl") > before.sus_lvl, "S: dragging up raises sustain");
    // extremes stay in range
    dragHandle(id, 900, -900).forEach(inRange);
    dragHandle(id, -900, 900).forEach(inRange);
}
// --- mod envelope handles write the m* counterparts ---
sb.onclick(sb.hitZones.find((z) => z.action === "env_page" && z.page === 1).x + 2, 10, 1, 0, 0);
sb.paint();
for (const [id, key] of [["env:A", "matk_ms"], ["env:D", "mdec_ms"], ["env:S", "msus_lvl"], ["env:R", "mrel_ms"]]) {
    const ps = dragHandle(id, 10, 6);
    ps.forEach(inRange);
    assert.ok(ps.some((p) => p.key === key), `mod ${id} writes ${key}`);
    assert.ok(!ps.some((p) => ["atk_ms", "dec_ms", "sus_lvl", "rel_ms"].includes(p.key)), "mod handles leave the amp envelope alone");
}
sb.onclick(sb.hitZones.find((z) => z.action === "env_page" && z.page === 0).x + 2, 10, 1, 0, 0);
// --- double click resets ---
sb.setParamFromFace("atk_ms", 400); sb.paint();
{ const z = zones("hdl", "env:A")[0]; emitted.length = 0; sb.ondblclick(z.cx, z.cy); assert.strictEqual(sb.paramValue("atk_ms"), FP.atk_ms.init); }

// --- filter point: x = cutoff, y = resonance ---
{
    sb.paint();
    const before = { c: sb.paramValue("filt_cutoff"), r: sb.paramValue("filt_res") };
    const ps = dragHandle("filt", -40, -10);
    ps.forEach(inRange);
    assert.ok(ps.some((p) => p.key === "filt_cutoff") && sb.paramValue("filt_cutoff") < before.c, "filter point left lowers the cutoff");
    assert.ok(sb.paramValue("filt_res") > before.r, "filter point up raises resonance");
    dragHandle("filt", 900, -900).forEach(inRange);
    dragHandle("filt", -900, 900).forEach(inRange);
    sb.paint();
    const z = zones("hdl", "filt")[0]; sb.ondblclick(z.cx, z.cy);
    assert.strictEqual(sb.paramValue("filt_cutoff"), FP.filt_cutoff.init);
    assert.strictEqual(sb.paramValue("filt_res"), FP.filt_res.init);
}

// --- the drawer: open state is show_inspector, device width follows ---
emitted.length = 0;
sb.paint();
const tog = zones("act").find((z) => z.x > 520 && z.y < 20);
sb.onclick(tog.x + 2, tog.y + 2, 1, 0, 0);
assert.strictEqual(sb.showInspector, 1, "drawer toggle opens");
assert.ok(emitted.some((a) => a[1] === "setwidth_cmd" && a[2] === 780), "device widens to 780");
sb.paint();
sb.onclick(tog.x + 2, tog.y + 2, 1, 0, 0);
assert.ok(emitted.some((a) => a[1] === "setwidth_cmd" && a[2] === 560), "device narrows back to 560");

// --- every parameter reachable from some zone ---
const reach = new Set();
const regionKeys = { samp_start: ["samp_start"], samp_end: ["samp_end"], loop_start: ["loop_start"], loop_end: ["loop_end"], loop_xfade: ["loop_xfade"] };
const actionKeys = { sliced_set: ["sliced"], engine: ["mode"], reverse: ["reverse"], freeze: ["freeze"], filt_on: ["filt_on"], voicing: ["mono_legato"], inspector: ["show_inspector"] };
function collect() {
    for (const z of sb.hitZones) {
        if (z.key) reach.add(z.key);
        if (z.region) regionKeys[z.region].forEach((k) => reach.add(k));
        if (actionKeys[z.action]) actionKeys[z.action].forEach((k) => reach.add(k));
        if (z.kind === "wave") ["samp_start", "samp_end", "loop_start", "loop_end", "play_pos"].forEach((k) => reach.add(k));
        if (z.kind === "xfade") reach.add("loop_xfade");
        if (z.kind === "flag") reach.add("slice_at");
    }
    if (zones("act").some((z) => z.x > 520 && z.y < 20)) reach.add("show_inspector");   // the drawer toggle
    if (zones("hdl", "filt").length) ["filt_cutoff", "filt_res"].forEach((k) => reach.add(k));
    for (const z of zones("hdl")) if (z.id.startsWith("env:")) {
        const m = sb.envPage === 1 ? ["matk_ms", "mdec_ms", "msus_lvl", "mrel_ms"] : ["atk_ms", "dec_ms", "sus_lvl", "rel_ms"];
        m.forEach((k) => reach.add(k));
    }
}
sb.setParamFromFace("show_inspector", 1);
for (let mode = 0; mode < 5; mode++) for (const sliced of [0, 1]) for (let ch = 0; ch < 3; ch++) for (let tab = 0; tab < 4; tab++) for (let page = 0; page < 2; page++) {
    sb.setParamFromFace("mode", mode); sb.setParamFromFace("sliced", sliced);
    for (const k of ["rp_char", "sp_char", "cy_char"]) sb.setParamFromFace(k, Math.min(ch, FP[k].hi));
    sb.setParamFromFace("slice_at", ch % 2 ? 1 : 0);
    sb.setParamFromFace("loop_mode", 1);
    sb.drawerTab = tab; sb.envPage = page;
    sb.paint();
    collect();
}
// slice_at 2 / 3 / 4 amounts
for (const at of [2, 3, 4]) { sb.setParamFromFace("slice_at", at); sb.drawerTab = 3; sb.paint(); collect(); }
const missing = Object.keys(FP).filter((k) => !reach.has(k));
assert.deepStrictEqual(missing, [], `unreachable parameters: ${missing.join(", ")}`);

// --- every drawer zone is clickable / draggable without a bad value ---
for (let tab = 0; tab < 4; tab++) for (const mode of [0, 3, 4]) {
    sb.setParamFromFace("mode", mode); sb.drawerTab = tab; sb.paint();
    for (const z of sb.hitZones.slice()) {
        if (z.x < 560) continue;
        const cx = z.x + z.w / 2, cy = z.y + z.h / 2;
        emitted.length = 0;
        sb.paint();
        sb.onclick(cx, cy, 1, 0, 0); sb.ondrag(cx + 8, cy - 25, 1, 0, 0); sb.ondrag(cx + 8, cy - 25, 0, 0, 0); sb.ondblclick(cx, cy);
        params().forEach(inRange);
        if (sb.openMenu) sb.onclick(1, 1, 1, 0, 0);
    }
}
console.log("reactive design: handles, drawer and parameter reach ok");
