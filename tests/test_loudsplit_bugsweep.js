#!/usr/bin/env node
"use strict";
/**
 * Pass 1 bugsweep for devices/Loud Split.amxd (slug `loudsplit`): red tests only, no fixes.
 *
 * Bug: the Knee parameter help text in scripts/build_loudsplit.py tells the user that a Knee of
 * 0 is a hard switch, but the Knee range is 1..24 everywhere (LS_PARAMS in src/loudsplit_config.js,
 * the NUM table in the build script, and the clip(kneehi / kneelo, 1, 24) in the gen ctl hook in
 * src/loudsplit_core.genexpr). 0 can never be entered, and the hard-step branch of lsBandMasks
 * (knee <= 0.01) is unreachable from the device: the smoothest available knee (1 dB) is still a
 * crossfade, never a hard switch. The test below is a consistency check — it passes once EITHER
 * the help text stops claiming 0 OR the parameter range actually includes 0.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const cfg = require(path.join(ROOT, "src", "loudsplit_config.js"));
const BUILD_SRC = fs.readFileSync(path.join(ROOT, "scripts", "build_loudsplit.py"), "utf8");

// the help string of one parameter from NUM_HELP in the build script
function helpOf(key) {
    const m = new RegExp(`"${key}": "([^"]*)"`).exec(BUILD_SRC);
    assert.ok(m, `NUM_HELP carries ${key}`);
    return m[1];
}

// 1. The knee help text must not describe a value the parameter range excludes.
for (const key of ["hiknee", "loknee"]) {
    const help = helpOf(key);
    const spec = cfg.LS_PARAMS[key];
    const claimsZeroHardSwitch = /0\s*=\s*hard switch/.test(help);
    const rangeIncludesZero = spec[2] <= 0;
    assert.ok(!claimsZeroHardSwitch || rangeIncludesZero,
        `${key}: help text says "0 = hard switch" but the Knee range is ${spec[2]}..${spec[3]} dB, so 0 can never be set`);
}
console.log("[bugsweep] knee help text agrees with the knee range");

// 2. Anchor: at the minimum settable knee the band edge is still a smooth crossfade
//    (50 / 50 at the threshold centre), i.e. no hard switch exists on the device as shipped.
//    This documents the user-visible side of the same bug; it stays true under a help-text fix
//    and becomes the behaviour a range fix would change at knee 0 only.
{
    const out = [0, 0, 0];
    cfg.lsBandMasks(-30, -30, -85, cfg.LS_MIN_KNEE, cfg.LS_MIN_KNEE, out);
    assert.ok(Math.abs(out[2] - 0.5) < 1e-9 && Math.abs(out[1] - 0.5) < 1e-9,
        "minimum knee is a 50 / 50 crossfade at the Higher Threshold centre, not a hard step");
}
console.log("[bugsweep] minimum knee crossfade anchor");

console.log("All Loud Split bugsweep tests passed");
