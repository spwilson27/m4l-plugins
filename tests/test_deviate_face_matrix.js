"use strict";
/** Extras for the Deviate Matrix face: the 16-column history (cap, newest follows live metas, rejected hit = dark column), paint stays cheap. */
const fs = require("fs");
const path = require("path");
const T = require("./deviate_test_lib.js");
const F = require("./face_fuzz_lib.js");

const R = T.makeReporter("test_deviate_face_matrix");
const dir = process.env.DEVIATE_BUILD_DIR || (() => { const d = T.tmpDir("fmx"); T.buildInto(d); return d; })();
const dev = T.readDevice(path.join(dir, "Deviate Matrix.amxd"));
const b = dev.byId["obj-lay-matrix-viz"];
const rect = b.presentation_rect;
function load(state) {
    const face = F.loadFace(b.textfile.text, { width: rect[2], height: rect[3], id: b.id, filename: "m.js", seed: 3, globals: state ? { DV_PREVIEW_STATE: state } : {} });
    if (face.loadError) throw face.loadError;
    return face;
}
const vm = require("vm");
const run = (f, code) => vm.runInContext(code, f.sandbox);

let f = load({ kind: "hit" });
F.call(f, "preview", []);
R.ok(run(f, "mxColumns().length") === 16, "preview(hit) shows 16 columns");
R.ok(run(f, "mxColumns()[15].g") === 1, "accepted hit: newest column lit");
f = load({ kind: "hit", gate: 0 });
F.call(f, "preview", []);
R.ok(run(f, "mxColumns()[15].g") === 0, "Chance-rejected hit: newest column is dark");
f = load({ kind: "idle" });
F.call(f, "preview", []);
R.ok(run(f, "mxColumns().length") === 1, "idle: only the live (Value) column");
f = load({ kind: "hit" });
F.call(f, "preview", []);
run(f, "for (var q = 0; q < 40; q++) { dvTel.hitNew = true; onFrame(dvTel); }");
R.ok(run(f, "mxHist.length") === 16, "history capped at 16 draws");
run(f, "dvTel.metas[3] = 77; dvTel.hitNew = false;");
R.ok(run(f, "mxColumns()[15].m[3]") === 77, "newest column follows the live metas");
const _f = load({ kind: "hit" }); F.call(_f, "preview", []); let n = 0; const mg = _f.rec.mgraphics; for (const k of Object.keys(mg)) { const o = mg[k]; if (typeof o === "function" && k !== "text_measure" && k !== "init") mg[k] = function (...a) { n++; return o.apply(this, a); }; } const ts = []; for (let i = 0; i < 25; i++) { n = 0; const t0 = process.hrtime.bigint(); F.call(_f, "paint", []); ts.push(Number(process.hrtime.bigint() - t0) / 1e6); } ts.sort((a, c) => a - c); R.ok(n <= 700, `paint ${n} calls, median ${ts[12].toFixed(2)} ms`); console.log(`paint ${n} calls, median ${ts[12].toFixed(2)} ms`);
R.done();
