#!/usr/bin/env node
/**
 * Writes tests/megamod_key_seed.json: the saved-state list (`setvalueof <list>`) used by
 * scripts/run_megamod_key_tests.py to give a fresh Mega Modulator three modulators (LFO, Envelope, Random)
 * with mappings (two on the LFO, one on the Envelope) and the LFO selected. Node is not installed in the
 * VM, so this runs on the host:  node scripts/megamod_key_seed.js
 */
const fs = require("fs");
const path = require("path");
const C = require(path.join(__dirname, "..", "src", "megamod_config.js"));

const s = C.defaultState();
s.mods[0] = C.makeModSlot(C.MOD_LFO, 0);
s.mods[1] = C.makeModSlot(C.MOD_ENV, 1);
s.mods[2] = C.makeModSlot(C.MOD_RANDOM, 2);
const tgt = (n, p) => ({ path: `live_set tracks 0 devices 0 parameters ${p}`, paramName: n, deviceName: "Device", trackName: "Track" });
s.mappings.push(C.defaultMapping(s.nextMapId++, 0, tgt("Param 1", 1)));
s.mappings.push(C.defaultMapping(s.nextMapId++, 0, tgt("Param 2", 2)));
s.mappings.push(C.defaultMapping(s.nextMapId++, 1, tgt("Param 3", 3)));
s.ui = { sel: 0 };
const list = C.serializeState(C.normalizeState ? C.normalizeState(s) : s);
const out = path.join(__dirname, "..", "tests", "megamod_key_seed.json");
fs.writeFileSync(out, JSON.stringify({ mods: 3, mappings: 3, list }) + "\n");
console.log("wrote", out, "(list items:", list.length + ")");
