#!/usr/bin/env node
"use strict";
// Sweep 2 red tests for Sand (see sweep/sand.md). Each check names its finding id.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const raw = fs.readFileSync(path.join(ROOT, "devices", "Sand.amxd"));
const patcher = JSON.parse(raw.slice(32).toString("utf8")).patcher;
const gen = fs.readFileSync(path.join(ROOT, "src", "sand_core.genexpr"), "utf8");
const ui = fs.readFileSync(path.join(ROOT, "src", "sand_ui.js"), "utf8");
const runner = fs.readFileSync(path.join(ROOT, "scripts", "run_sand_audio_tests.py"), "utf8");

let failed = 0;
function check(id, fn) {
    try { fn(); console.log("ok   " + id); } catch (e) { failed++; console.log("FAIL " + id + ": " + e.message); }
}

// SD-1 (S2): Live does not expand #0 in a top-level device patcher, so every Sand instance shares one scope buffer.
check("SD-1 no '#0' buffer / message names in the patcher", () => {
    const bad = patcher.boxes.map((b) => b.box).filter((b) => typeof b.text === "string" && b.text.includes("#0"));
    assert.deepStrictEqual(bad.map((b) => b.id + ": " + b.text), []);
});
check("SD-1b v8ui fallback buffer name is not a literal #0 name", () => {
    assert.ok(!/["']#0-sandwave["']/.test(ui), "src/sand_ui.js still falls back to '#0-sandwave'");
});

// SD-2 (S3): a gen Param called `mix` shadows the GenExpr mix() operator that the same core calls.
check("SD-2 gen has no Param/Data/History named mix", () => {
    assert.ok(!/^\s*(Param|Data|History)\s+mix\s*\(/m.test(gen), "Param mix(50) in src/sand_core.genexpr");
});

// SD-3 (S2, test infra): the audio runner must test the minified gen the device embeds.
check("SD-3 audio runner minifies the gen it tests", () => {
    assert.ok(/minify_gen/.test(runner));
});

// SD-4 (S2): one NaN input sample poisons the Histories (filter / compander / limiter / differentiator state): the wet path
// then stays NaN for the life of the instance and only the output fixnan keeps it silent. Needs input sanitising.
check("SD-4 wet path recovers after a single NaN input sample", () => {
    const gx = require("./genexpr_functions.js");
    globalThis.mix = (a, b, t) => a + (b - a) * t;
    globalThis.tanh = Math.tanh;
    const src = gen.replace(/\);\s*History/g, ");\n\tHistory");
    const f = gx.load(src);
    const sr = 48000;
    const coef = Math.exp(-6.283185 * 14000 / sr);
    const ci = Math.exp(-6.283185 * 8 / sr);
    let bad = 0;
    for (let i = 0; i < 5000; i++) {
        const x = i === 100 ? NaN : 0.3 * Math.sin(i * 0.03);
        const y = f.channel(x, 1, 1, Math.exp(2), 0.35, 0, coef, ci, 0, 2);
        if (i > 200 && !Number.isFinite(y)) bad++;
    }
    assert.strictEqual(bad, 0, bad + " non-finite wet samples after the NaN");
});

if (failed) { console.log(failed + " failing"); process.exit(1); }
