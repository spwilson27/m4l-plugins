#!/usr/bin/env node
/**
 * PASS 1 bugsweep RED tests for devices/Reciprocator.amxd.
 *
 * Confirmed bug: scope buffer uses #0-recipscope in a top-level Live device.
 * Live does not expand #0 in a top-level M4L patcher (AGENTS.md Multiband Split /
 * Glitch / Delay+ / Amp+ / EnvTrig / Cepstra / Tiny Space), so every Reciprocator
 * instance in a Set shares one scope ring and paints the wrong telemetry.
 *
 * Expected to FAIL on current production sources. Do not weaken these checks —
 * pass 3 changes production (and tests/test_reciprocator.js #0- asserts) instead.
 *
 * Run: node tests/test_reciprocator_bugsweep.js
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const build = fs.readFileSync(path.join(ROOT, "scripts", "build_reciprocator.py"), "utf8");
const gen = fs.readFileSync(path.join(ROOT, "src", "reciprocator_core.genexpr"), "utf8");
const cfg = fs.readFileSync(path.join(ROOT, "src", "reciprocator_config.js"), "utf8");
const amxdPath = path.join(ROOT, "devices", "Reciprocator.amxd");

// Bug A: Live does not expand #0- in a top-level device patcher. Scope telemetry
// must use the M4L --- prefix (see AGENTS Delay+ / Multiband Split / Glitch / peers).
assert.ok(
    build.includes("buffer~ ---recipscope @samps 32"),
    "Bug A RED: build_reciprocator.py must declare buffer~ ---recipscope @samps 32 (not #0-recipscope)"
);
assert.ok(
    build.includes("scope ---recipscope"),
    "Bug A RED: gen bind message must be scope ---recipscope"
);
assert.ok(
    build.includes("setbuffer ---recipscope"),
    "Bug A RED: UI bind message must be setbuffer ---recipscope"
);
assert.ok(
    !/#0-recipscope/.test(build),
    "Bug A RED: build_reciprocator.py must not reference #0-recipscope"
);
assert.ok(
    !/#0-recipscope/.test(gen) && !/#0-recipscope/.test(cfg),
    "Bug A RED: src comments must not prescribe #0-recipscope once production uses ---recipscope"
);

const raw = fs.readFileSync(amxdPath);
const doc = JSON.parse(raw.slice(32).toString("utf8"));
const boxes = doc.patcher.boxes.map((b) => b.box);
const byId = new Map(boxes.map((b) => [b.id, b]));

const scope = byId.get("obj-scope");
assert.ok(scope, "Bug A RED: missing obj-scope");
assert.strictEqual(
    scope.text,
    "buffer~ ---recipscope @samps 32",
    "Bug A RED: scope buffer must use --- instance isolation; got " + scope.text
);

const msgGen = byId.get("obj-msg-gen-buf");
assert.ok(msgGen, "Bug A RED: missing obj-msg-gen-buf");
assert.strictEqual(
    msgGen.text,
    "scope ---recipscope",
    "Bug A RED: loadbang gen bind must be scope ---recipscope; got " + msgGen.text
);

const msgUi = byId.get("obj-msg-ui-buf");
assert.ok(msgUi, "Bug A RED: missing obj-msg-ui-buf");
assert.strictEqual(
    msgUi.text,
    "setbuffer ---recipscope",
    "Bug A RED: loadbang UI bind must be setbuffer ---recipscope; got " + msgUi.text
);

for (const box of boxes) {
    const t = box.text || "";
    assert.ok(
        !/#0-recipscope\b/.test(t),
        "Bug A RED: " + box.id + " must not use literal #0-recipscope (got " + t + ")"
    );
}

console.log("test_reciprocator_bugsweep: ok");
