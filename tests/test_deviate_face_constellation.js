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

// regression: the label row (y >= 73) is clear of stars / sparks / halos, labels do not crowd, paint starts no Task and ignores the wall clock
const ROW = 73;
for (const [kind, age, gate] of [["hit", 30, 1], ["hit", 400, 0], ["extreme", 30, 1], ["idle", -1, 1]]) {
    const f = F.loadFace(dev.byId["obj-lay-sky"].textfile.text, { width: sw, height: sh, id: "sky", filename: "sky.js", seed: 1, globals: {} });
    const ops = [];
    for (const k of Object.keys(f.rec.mgraphics)) {
        const fn = f.rec.mgraphics[k];
        if (typeof fn === "function" && !["text_measure", "init", "redraw"].includes(k)) f.rec.mgraphics[k] = function (...a) { ops.push([k, ...a]); return fn.apply(this, a); };
    }
    let tasks = 0, nowCalls = 0;
    f.sandbox.Task = function () { if (!/m4lThemeWatch/.test(new Error().stack)) tasks++; // the shared theme wrapper's own watcher is not the face's
        this.schedule = () => {}; };
    const realNow = Date.now;
    f.sandbox.Date = { now() { nowCalls++; return realNow(); } };
    f.sandbox.DV_PREVIEW_STATE = { kind, ageMs: age, gate };
    F.call(f, "preview", []);
    tasks = 0;
    f.rec.begin("x"); F.call(f, "paint", []); f.rec.end();
    R.ok(tasks === 0, `${kind}: paint/preview create no Task`);
    R.ok(nowCalls === 0, `${kind}: paint/preview never read the wall clock`);
    const strip = ops.findIndex((o) => o[0] === "rectangle" && o[2] === ROW);
    R.ok(strip > 0, `${kind}: label strip drawn`);
    const before = ops.slice(0, strip);
    const bad = before.filter((o) => {
        if (o[0] === "ellipse") return o[2] + o[4] > ROW + 0.01;
        if (o[0] === "rectangle") return o[2] + o[4] > ROW + 0.01;
        if (o[0] === "move_to" || o[0] === "line_to") return o[2] > ROW + 0.01;
        return false;
    });
    R.ok(bad.length === 0, `${kind}: no star/spark/halo reaches the label row (${bad.length} offenders ${JSON.stringify(bad[0] || "")})`);
    let shown = 0, end = strip + 1;
    while (end < ops.length && shown < 8) { if (ops[end][0] === "show_text") shown++; end++; }
    const after = ops.slice(strip + 2, end).filter((o) => ["ellipse", "line_to", "stroke", "rectangle", "fill"].includes(o[0]));
    R.ok(after.length === 0, `${kind}: only text is drawn on the label strip`);
    // label widths: neighbours keep a gap in a 53 px column even at value 100
    const colW = sw / 8;
    const wmax = vm_eval(f, "(function(){var m=0,i;for(i=0;i<8;i++){var w=dvTextW(csLabel(i, " + colW + "),7,false);if(w>m)m=w;}return m;})()");
    R.ok(wmax <= colW - 6 + 0.01, `${kind}: widest label ${wmax.toFixed(1)} leaves a gap in a ${colW} px column`);
}
function vm_eval(f, code) { return require("vm").runInContext(code, f.sandbox); }
R.done();
