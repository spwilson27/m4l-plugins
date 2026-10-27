"use strict";
// EQ+ sweep 2, stage B: red tests (no fixes). Each block fails on the current tree.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const failures = [];
function bug(id, name, fn) {
    try { fn(); console.log("[sweep2] ok: " + id + " " + name); }
    catch (e) { failures.push(id + " " + name + " -- " + e.message); console.log("[sweep2] FAIL: " + id + " " + name + " -- " + e.message); }
}
function readDevice() {
    const d = fs.readFileSync(path.join(ROOT, "devices", "EQ+.amxd"));
    return JSON.parse(d.slice(32).toString("utf8").replace(/\0+$/, ""));
}

// EQP-S2-01 (S2): per-instance buffers use #0-, which Live does not expand in a
// top-level device: every EQ+ instance shares one cfg / spec / ir buffer.
bug("EQP-S2-01", "no #0- buffer names in the built device (use ---)", function () {
    const boxes = readDevice().patcher.boxes.map((b) => b.box);
    const bad = boxes.filter((b) => /(buffer~|eqcfg|setbuffers)[^\n]*#0-/.test(b.text || ""));
    assert.strictEqual(bad.length, 0, "boxes using #0-: " + bad.map((b) => b.id + " '" + b.text + "'").join("; "));
});

// EQP-S2-02 (S2, infra): the audio runner shells out to node, which the VM lacks
// (AGENTS 1a), so the Max suite cannot run where Max is allowed to run.
bug("EQP-S2-02", "run_eqplus_audio_tests.py does not call node", function () {
    const s = fs.readFileSync(path.join(ROOT, "scripts", "run_eqplus_audio_tests.py"), "utf8");
    assert.ok(!/\[\s*"node"/.test(s), "runner invokes subprocess node (no node in the macos-01 VM)");
});

if (failures.length) {
    console.log("test_eqplus_sweep2: " + failures.length + " red test(s)");
    process.exit(1);
}
console.log("test_eqplus_sweep2: ok");
