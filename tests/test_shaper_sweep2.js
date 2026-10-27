#!/usr/bin/env node
"use strict";
/** Sweep 2 RED tests for Better Shaper (expected to FAIL until the lane fix). Run: node tests/test_shaper_sweep2.js */
const fs = require("fs"), path = require("path"), vm = require("vm");
const F = require("./face_fuzz_lib.js");
const { readAmxd } = require("./lint_lib.js");
const ROOT = path.resolve(__dirname, "..");
const patcher = readAmxd(fs.readFileSync(path.join(ROOT, "devices", "Better Shaper.amxd"))).patcher;
let fails = 0;
function check(name, ok, msg) { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + msg)); if (!ok) fails++; }

const boxes = [];
(function walk(p) { for (const { box: b } of p.boxes) { boxes.push(b); if (b.patcher) walk(b.patcher); } })(patcher);

// SH-1: per-instance buffer must use --- (Live does not expand #0 in a top-level device)
const hash0 = boxes.filter((b) => /#0/.test(b.text || "")).map((b) => `${b.id}: ${b.text}`);
check("SH-1 no #0 names in top-level patcher (buffer~/index~/loadmess)", hash0.length === 0, hash0.join("; "));

// SH-2: unique Live short names
const seen = {}, dup = [];
for (const b of boxes) {
    const v = b.saved_attribute_attributes && b.saved_attribute_attributes.valueof;
    if (!v || !v.parameter_shortname) continue;
    (seen[v.parameter_shortname] = seen[v.parameter_shortname] || []).push(b.id);
}
for (const k in seen) if (seen[k].length > 1) dup.push(`${k}: ${seen[k].join(",")}`);
check("SH-2 unique parameter short names", dup.length === 0, dup.join("; "));

// SH-3 / SH-4: key handling
const face = F.loadFace(["src/mseg_edit.js", "src/mseg_editor.js"].map((f) => path.join(ROOT, f)), { width: 262, height: 134, seed: 3 });
const ev = (s) => vm.runInContext(s, face.sandbox);
function keyDeletes(k, t) {
    ev("selectedIds = points.map(function(p){return p.id;})");
    const n0 = ev("points.length");
    F.call(face, "onkeydown", [k, t, 1, 0, 0, 0, 0, 0]);
    const n1 = ev("points.length");
    ev("points = [{id:1,x:0,y:0,curve:0,sCurve:0},{id:5,x:0.25,y:0.5,curve:0,sCurve:0},{id:6,x:0.5,y:1,curve:0,sCurve:0},{id:7,x:0.75,y:0.3,curve:0,sCurve:0},{id:4,x:1,y:1,curve:0,sCurve:0}]; selectedIds=[]");
    return n1 < n0;
}
check("SH-3 Escape (Max keycode -3, textcharacter 27) must not delete selected points", !keyDeletes(-3, 27), "Esc deleted the selection");
check("SH-4a typing '3' (keycode 51) must not delete selected points", !keyDeletes(51, "3"), "'3' deleted the selection");
check("SH-4b typing 'u' (keycode 117) must not delete selected points", !keyDeletes(117, "u"), "'u' deleted the selection");
check("SH-4c Delete (127) still deletes", keyDeletes(127, 127), "Delete no longer deletes");

// SH-5: percent LCD numboxes must be wide enough for Live to show the unit (Live smoke: Jitter/Smooth/Offset show "0.00", Phase "0.00 %")
const w = {};
for (const b of boxes) if (["obj-jitter", "obj-smooth", "obj-offset", "obj-phase"].includes(b.id)) w[b.id] = b.presentation_rect[2];
check("SH-5 Jitter/Smooth/Offset as wide as Phase (38px) so the % unit shows", w["obj-jitter"] >= 38 && w["obj-smooth"] >= 38 && w["obj-offset"] >= 38, JSON.stringify(w));
process.exit(fails ? 1 : 0);
