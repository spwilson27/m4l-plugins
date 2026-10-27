#!/usr/bin/env node
/** Degrade - sweep 2 red tests (see sweep/degrade.md). Each check fails on the current code for the finding it names. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const failures = [];
function check(name, fn) {
    try { fn(); console.log(`PASS ${name}`); }
    catch (e) { failures.push(name); console.log(`RED  ${name}: ${e.message}`); }
}
function patcher() {
    const b = fs.readFileSync(path.join(ROOT, "devices", "Degrade.amxd"));
    return JSON.parse(b.slice(32).toString("utf8").replace(/[\0\s]+$/, "")).patcher;
}

// DEG-S2-01: Live does not expand #0 in a top-level device patcher, so every instance shares one scope buffer
// (meters / DSP-ready detection read another instance's gen). Names must use ---.
check("DEG-S2-01 no #0 buffer/message names in the device", () => {
    const bad = patcher().boxes.map((b) => b.box).filter((b) => /(^|\s)#0-/.test(b.text || ""));
    assert.deepStrictEqual(bad.map((b) => `${b.id}: ${b.text}`), [], "boxes use #0-");
});

// DEG-S2-01b: the deferred-DSP ready check must read the buffer name the patcher passed to the face (setbuffer),
// not a hard-coded literal name.
check("DEG-S2-01b dsp frame counter reads the instance buffer", () => {
    const src = ["degrade_config.js", "degrade_dsp.js", "degrade_ui.js"].map((f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8")).join("\n");
    const names = [];
    const sandbox = {
        Math, Number, Array, Object, console, Date,
        mgraphics: new Proxy({ size: [190, 136] }, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }),
        outlet() {}, notifyclients() {}, post() {},
        Buffer: function (n) { names.push(String(n)); this.peek = () => 1; this.framecount = () => 0; this.length = () => 0; },
    };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    sandbox.setbuffer("---degscope042");
    names.length = 0;
    sandbox.degDspFrames();
    assert.deepStrictEqual(names, ["---degscope042"], `degDspFrames opened ${JSON.stringify(names)}`);
});

// DEG-S3-01: the hero live.dial name / value text defaults to the Live theme text colour, which is nearly invisible on
// the device's fixed dark panel (seen in Live smoke screenshot). Dials must set a light textcolor (as Sand does).
check("DEG-S3-01 live.dial text colour readable on dark panel", () => {
    const dials = patcher().boxes.map((b) => b.box).filter((b) => b.maxclass === "live.dial");
    assert.ok(dials.length === 6, "premise: 6 hero dials");
    for (const d of dials) {
        const c = d.textcolor;
        assert.ok(Array.isArray(c) && (c[0] + c[1] + c[2]) / 3 > 0.6, `${d.id} textcolor ${JSON.stringify(c)}`);
    }
});

if (failures.length) { console.log(`\n${failures.length} red: ${failures.join(", ")}`); process.exit(1); }
console.log("All Degrade sweep2 checks passed");
