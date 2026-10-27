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

// regression: pure helpers pulled out of the face script
const vm = require("vm");
const raw = fs.readFileSync(path.join(T.ROOT, "src", "deviate_face_roulette.js"), "utf8");
function grab(name) {
    const i = raw.indexOf("function " + name + "(");
    let d = 0, j = raw.indexOf("{", i);
    for (let k = j; k < raw.length; k++) { if (raw[k] === "{") d++; else if (raw[k] === "}" && --d === 0) return raw.slice(i, k + 1); }
    return "";
}
const sb = {};
vm.createContext(sb);
vm.runInContext(["rlWrap", "rlBand", "rlHadHit", "rlPillRect"].map(grab).join("\n"), sb);
const eq = (a, b) => Math.abs(a - b) < 1e-9;
let b = sb.rlBand(0.5, 0.2);
R.ok(eq(b[1] - b[0], 0.4), "range band width = 2*Range");
b = sb.rlBand(0.1, 0.3);
R.ok(eq(b[0], 0) && eq(b[1], 0.4), "range band clamped at 0");
b = sb.rlBand(0.9, 0.3);
R.ok(eq(b[0], 0.6) && eq(b[1], 1), "range band clamped at 1");
R.ok(sb.rlHadHit(0, 0, -1e9) === false && sb.rlHadHit(1, 0, -1e9) && sb.rlHadHit(0, 3, -1e9) && sb.rlHadHit(0, 0, 100), "no ZERO before a hit");
R.ok(/hadHit && g === 0/.test(src) && /"READY"/.test(src), "ZERO needs a hit; READY before");
[-0.1, 0, 5, 7, 123.4, 6.2831853].forEach((a) => { const w = sb.rlWrap(a); R.ok(w >= 0 && w < Math.PI * 2, "rlBase wrap " + a); });
R.ok(/rlBase = rlWrap\(/.test(src), "rlBase assigned wrapped");
// DSP pill vs wheel disc (centre 76,79 r 75), widest text at a generous 0.62*size per char
[14, 10].forEach((n) => {
    const r = sb.rlPillRect(194, 157, 0.62 * 7 * n);
    const cx = Math.max(r[0], Math.min(76, r[0] + r[2])), cy = Math.max(r[1], Math.min(79, r[1] + r[3]));
    R.ok(Math.hypot(cx - 76, cy - 79) > 75 && r[0] + r[2] <= 194 && r[1] + r[3] <= 157, "DSP pill clear of wheel (" + n + " chars)");
});
R.done();
