#!/usr/bin/env node
/** Sweep 2 red tests for Reciprocator. Run: node tests/test_reciprocator_sweep2.js */
"use strict";
const fs = require("fs");
const path = require("path");
const buf = fs.readFileSync(path.join(__dirname, "..", "devices", "Reciprocator.amxd"));
const p = JSON.parse(buf.slice(32).toString("utf8")).patcher;
let fails = 0;
function fail(m) { console.log("FAIL " + m); fails++; }

// RC-01 (S3): the four section panels are dark, but the live.dial name / value text has no
// textcolor, so Live draws it in the theme's text colour (dark on dark in Live's default
// light-text-on-grey theme: seen unreadable in the smoke screenshot).
for (const b of p.boxes.map((x) => x.box)) {
    if (b.maxclass !== "live.dial") continue;
    const t = b.textcolor;
    if (!t) { fail(`RC-01 ${b.id}: live.dial on a dark panel has no textcolor (name/value unreadable in Live)`); continue; }
    const lum = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
    if (lum < 0.55) fail(`RC-01 ${b.id}: textcolor too dark (${lum.toFixed(2)})`);
}
process.exit(fails ? 1 : 0);
