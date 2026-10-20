#!/usr/bin/env node
"use strict";
// Prints the 256-point dB table of a Lifter curve preset, space separated.
// usage: lifter_curve_cli.js <flat|whisper|robot|body|comb>
// It runs the real src/lifter_ui.js, so the Max audio test and the device share one curve model.
const fs = require("fs");
const path = require("path");

const name = process.argv[2] || "flat";
const js = fs.readFileSync(path.join(__dirname, "..", "src", "lifter_ui.js"), "utf8");
const mg = { size: [316, 152], init() {}, redraw() {} };
const mk = new Function(
    "mgraphics", "inlets", "outlets", "outlet", "notifyclients",
    js + "\nreturn { applyPreset, curveTable };"
);
const ui = mk(mg, 1, 1, () => {}, () => {});
ui.applyPreset(name);
console.log(ui.curveTable().map((v) => v.toFixed(5)).join(" "));
