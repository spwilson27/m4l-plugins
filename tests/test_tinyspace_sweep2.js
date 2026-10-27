#!/usr/bin/env node
/** Sweep 2 tests for Tiny Space (expected to FAIL until the fixes land). */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
let fails = 0;
function check(id, cond, msg) {
    if (!cond) { fails++; console.log("FAIL " + id + ": " + msg); } else console.log("ok   " + id);
}

// patcher JSON from the built device
const buf = fs.readFileSync(path.join(ROOT, "devices", "Tiny Space.amxd"));
const patcher = JSON.parse(buf.slice(32).toString("utf8")).patcher;
const boxes = patcher.boxes.map((b) => b.box);

// TS-S3-01: dial name / value text follows Live's theme text colour, which is dark on the
// forced-dark section panels (Live smoke screenshot: HP / LP / Size / Fbk / XFeed / Width / Mix
// labels and values are near invisible). Every live.dial must set a light textcolor.
{
    const dials = boxes.filter((b) => b.maxclass === "live.dial");
    const bad = dials.filter((b) => {
        const c = b.textcolor;
        return !(Array.isArray(c) && (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) > 0.55 && c[3] > 0.5);
    });
    check("TS-S3-01", dials.length >= 7 && bad.length === 0,
        bad.length + " of " + dials.length + " live.dial boxes have no light textcolor (" + bad.map((b) => b.varname).join(",") + ")");
}

// TS-S2-01b: the gen duck gain must be smoothed; duckG = clip(duck) is an unsmoothed step that
// hard-cuts the ringing tail on a seed / character change (click).
{
    const core = fs.readFileSync(path.join(ROOT, "src", "tinyspace_core.genexpr"), "utf8");
    check("TS-S2-01b", /duckG\s*=\s*slew\(/.test(core),
        "gen duck gain is not slewed: duckG = clip(duck, 0, 1) steps to 0 and cuts the tail");
}
process.exit(fails ? 1 : 0);
