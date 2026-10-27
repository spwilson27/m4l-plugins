"use strict";
// Extras for Deviate Constellation: layout alignment (strips under their stars, nothing over the sky) and paint determinism / sparks.
const path = require("path");
const T = require("./deviate_test_lib.js");
const F = require("./face_fuzz_lib.js");
const CFG = require("../src/deviate_config.js");

const R = T.makeReporter("test_deviate_face_constellation");
const dir = process.env.DEVIATE_BUILD_DIR || T.tmpDir("constellation");
if (!process.env.DEVIATE_BUILD_DIR) T.buildInto(dir);
const dev = T.readDevice(path.join(dir, "Deviate Constellation.amxd"));
const sky = dev.byId["obj-lay-sky"];
R.ok(!!sky && sky.presentation_rect[2] === 424 && sky.presentation_rect[1] === 4, "sky canvas 424 wide at y 4");
const [sx, sy, sw, sh] = sky.presentation_rect;
const col = (i) => sx + (i + 0.5) * sw / 8;
CFG.DV_META_KEYS.forEach((k, i) => {
    for (const p of ["v", "r", "l"]) {
        const b = dev.byId[`obj-ctrl-${p}_${k}`];
        const ok = b && b.presentation === 1 && Math.abs(b.presentation_rect[0] + b.presentation_rect[2] / 2 - col(i)) < 6 && b.presentation_rect[1] >= sy + sh;
        R.ok(ok, `${p}_${k} sits under star ${i}`);
    }
});
for (const k of ["reroll", "mix", "chance", "sens"]) R.ok(dev.byId[`obj-ctrl-${k}`] && dev.byId[`obj-ctrl-${k}`].presentation === 1, `${k} is on the face`);

// paint streams: deterministic, and the sparks differ between ages
function stream(kind, age, gate) {
    const f = F.loadFace(dev.byId["obj-lay-sky"].textfile.text, { width: sw, height: sh, id: "sky", filename: "sky.js", seed: 1, globals: {} });
    const ops = [];
    for (const k of Object.keys(f.rec.mgraphics)) {
        const fn = f.rec.mgraphics[k];
        if (typeof fn === "function" && !["text_measure", "init", "redraw"].includes(k)) f.rec.mgraphics[k] = function (...a) { ops.push(k + a.join(",")); return fn.apply(this, a); };
    }
    f.sandbox.DV_PREVIEW_STATE = { kind, ageMs: age, gate };
    F.call(f, "preview", []);
    f.rec.begin("x"); F.call(f, "paint", []); f.rec.end();
    return ops.join("|");
}
R.ok(stream("hit", 30, 1) === stream("hit", 30, 1), "paint is deterministic");
R.ok(stream("hit", 30, 1) !== stream("hit", 400, 1), "sparks move with the hit age");
R.ok(stream("hit", 30, 1) !== stream("hit", 30, 0), "a rejected hit looks different");
R.done();
