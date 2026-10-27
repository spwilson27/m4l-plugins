"use strict";
// Roulette extras: the layout places the 8 Values, 8 Ranges, Reroll, Mix, Chance, Sens on the face, the wheel is a hit canvas, and the
// script keeps clear of Max globals / Math.random.
const fs = require("fs");
const path = require("path");
const T = require("./deviate_test_lib.js");
const R = T.makeReporter("test_deviate_face_roulette");
const src = fs.readFileSync(path.join(T.ROOT, "src", "deviate_face_roulette.js"), "utf8").replace(/\/\/.*$/gm, "");
R.ok(!/Math\.random/.test(src), "no Math.random");
R.ok(!/\bvar\s+(box|patcher|max|messagename|inlet|jsarguments)\b/.test(src), "no Max globals declared");
R.ok(/relative_coords/.test(fs.readFileSync(path.join(T.ROOT, "src", "deviate_face_common.js"), "utf8")), "prelude sets relative_coords");
const info = T.faceInfo().faces.roulette;
R.ok(!!info, "roulette face registered");
if (info) {
    R.ok(info.canvases.length === 1 && info.canvases[0].role === "hit", "one hit canvas");
    const off = info.off_face || {};
    const must = ["reroll", "mix", "chance", "sens"].concat(["snap", "pitch", "body", "motion", "space", "echo", "grit", "ring"].flatMap((k) => ["v_" + k, "r_" + k]));
    R.ok(must.every((k) => !(k in off)), "required controls are on the face");
}
R.done();
