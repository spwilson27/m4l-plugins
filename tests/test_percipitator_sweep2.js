#!/usr/bin/env node
// Sweep 2 red tests for Percipitator (PCP-S2-01, PCP-S2-02).
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
function check(name, ok, why) { console.log((ok ? "ok   - " : "FAIL - ") + name + (ok ? "" : "  (" + why + ")")); if (!ok) fails++; }

// PCP-S2-01: per-instance buffers must use --- (Live does not expand #0 in a top-level device)
const b = rd("scripts/build_percipitator.py");
check("PCP-S2-01 buffer~/messages use --- names", !/#0-percip/.test(b),
  "build still uses #0-percipwt / #0-percipscope: every instance shares one wavetable + telemetry buffer");

// PCP-S2-02: sidechain MIDI needs the device's MIDI input routed (default 'No Input' in Live)
const ui = rd("src/percipitator_ui.js") + rd("src/percipitator_dsp.js");
check("PCP-S2-02 MIDI input routing set up (midi_inputs)", /midi_inputs/.test(ui),
  "midiin exists but this_device midi_inputs 0 routing is never set; notes never arrive in Live");

console.log(fails ? "test_percipitator_sweep2: " + fails + " failing" : "test_percipitator_sweep2: all pass");
process.exit(fails ? 1 : 0);
