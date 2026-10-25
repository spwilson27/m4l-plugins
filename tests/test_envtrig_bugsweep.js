#!/usr/bin/env node
/**
 * PASS 1 bugsweep RED tests for devices/Envelope Trigger.amxd.
 *
 * These assertions document confirmed bugs and are expected to FAIL on the
 * current production sources. Do not "fix" this file by weakening checks —
 * PASS 2 should change production (and tests/test_envtrig.js) instead.
 *
 * Run: node tests/test_envtrig_bugsweep.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const build = fs.readFileSync(path.join(ROOT, "scripts", "build_envtrig.py"), "utf8");
const gen = fs.readFileSync(path.join(ROOT, "src", "envtrig_core.genexpr"), "utf8");
const cfg = fs.readFileSync(path.join(ROOT, "src", "envtrig_config.js"), "utf8");
const dsp = fs.readFileSync(path.join(ROOT, "src", "envtrig_dsp.js"), "utf8");

// Bug 1: Live does not expand #0- in a top-level device patcher. Scope telemetry
// must use the M4L --- prefix (see AGENTS Delay+ / Multiband Split / Glitch / Reverb+).
assert.ok(
    build.includes("buffer~ ---trigscope"),
    "build_envtrig.py must declare buffer~ ---trigscope (not #0-trigscope)"
);
assert.ok(
    build.includes('"scope ---trigscope"') || build.includes("scope ---trigscope"),
    "gen bind message must be scope ---trigscope"
);
assert.ok(
    build.includes("setbuffer ---trigscope"),
    "UI bind message must be setbuffer ---trigscope"
);
assert.ok(
    !build.includes("#0-trigscope"),
    "build_envtrig.py must not reference #0-trigscope"
);
assert.ok(
    !gen.includes("#0-trigscope") && !cfg.includes("#0-trigscope") && !dsp.includes("#0-trigscope"),
    "src comments/docs must not prescribe #0-trigscope once production uses ---trigscope"
);

console.log("test_envtrig_bugsweep: ok");
