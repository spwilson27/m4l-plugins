"use strict";
// Sweep 2 red tests for Clip+ (each assertion is one finding; failing = the bug is present).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { makeRecorder, loadFace } = require("./paint_bounds_lib.js");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function patcher() {
    const b = fs.readFileSync(path.join(ROOT, "devices", "Clip+.amxd"));
    return JSON.parse(b.slice(32).toString("utf8").replace(/[\0\n\s]+$/, "")).patcher;
}
let fails = 0;
function check(id, fn) {
    try { fn(); console.log("ok   " + id); } catch (e) { fails++; console.log("FAIL " + id + ": " + e.message.split("\n")[0]); }
}

// CP-01: scripting names move with the Options column, but True Peak is not in the list csApplyLayout moves.
check("CP-01 Options column buttons all follow the layout (True Peak)", () => {
    const code = ["src/spectral_theme.js", "src/clipplus_curve.js", "src/clipplus_dsp.js", "src/clipplus_ui.js"].map(read).join("\n");
    const rec = makeRecorder(180, 157);
    const face = loadFace('var FACE_ROLE = "viz";\n' + code, rec);
    const rects = {};
    face.patcher.getnamed = (name) => ({ setattr(k, ...v) { if (k === "presentation_rect") rects[name] = v; } });
    face.set_showfilt(1);
    const names = ["Stereo Mode", "obj-btn-chmode", "Delta", "DC", "Oversample", "Hard Limit", "True Peak", "Show Meters"];
    const ref = rects["Hard Limit"];
    assert.ok(ref, "layout did not run");
    for (const n of names) assert.ok(rects[n] && rects[n][0] === ref[0], `${n} not moved with the Options column (x ${rects[n] ? rects[n][0] : "never set"}, Hard Limit x ${ref[0]})`);
});

// CP-02: obj-btn-chmode is a plain button but Live lists it as a parameter named "obj-btn-chmode"; sweeping it cycles Channel Mode.
check("CP-02 plain buttons are not Live parameters", () => {
    const p = patcher();
    const bad = [];
    for (const { box: b } of p.boxes) {
        if (!/^live\.(text|tab|menu|numbox|dial|toggle|button)$/.test(b.maxclass)) continue;
        const v = b.saved_attribute_attributes && b.saved_attribute_attributes.valueof;
        const off = b.parameter_enable === 0 || (v && v.parameter_enable === 0);
        if (!v && !off) bad.push(b.id);
    }
    assert.deepStrictEqual(bad, [], "live.* boxes that Live will expose as parameters without a name: " + bad.join(", "));
});

// CP-03: a literal #0 in buffer~ / message boxes of a top-level device is shared by all instances (AGENTS 15); verified in Live.
check("CP-03 per-instance scope buffer uses ---", () => {
    const p = patcher();
    const bad = p.boxes.filter(({ box: b }) => /#0/.test(b.text || "")).map(({ box: b }) => b.id + ": " + b.text);
    assert.deepStrictEqual(bad, [], "top-level #0 is not expanded in Live: " + bad.join("; "));
});

process.exit(fails ? 1 : 0);
