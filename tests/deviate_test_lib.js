"use strict";
/**
 * Shared helpers of tests/test_deviate.js and tests/test_deviate_faces.js (no assertions here).
 *
 *   buildInto(dir)        python3 scripts/build_deviate.py --no-sets --out-dir dir  (throws with the output on failure)
 *   faceInfo()            { faces: {<module>: {device, width, theme, canvases: [{id, rect, role, ignoreclick, presentation, hidden, keys,
 *                           files, reactive}]}}, hash }   derived from the face modules through scripts/build_deviate.py itself
 *   readDevice(path)      { type, errs, patcher, boxes, byId, lines }
 *   makeReporter(title)   { ok(cond, msg), skip(msg), note(msg), done() } : prints PASS / FAIL / SKIP lines, done() exits 1 on a failure
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const L = require("./lint_lib.js");

const ROOT = path.resolve(__dirname, "..");

function tmpDir(tag) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `dv_${tag}_`));
}

function buildInto(dir) {
    const r = cp.spawnSync("python3", ["scripts/build_deviate.py", "--no-sets", "--out-dir", dir], { cwd: ROOT, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`build_deviate.py failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
    return fs.readdirSync(dir).filter((f) => /^Deviate .*\.amxd$/.test(f)).sort();
}

const INFO_PY = `
import json, sys
sys.path.insert(0, "scripts")
import build_deviate as bd
out = {"faces": {}, "hash": bd.gen_header()[1], "params": bd.dump_params()}
for f in bd.discover_faces():
    mod, lay = bd.load_face(f)
    cs = []
    for c in lay["canvases"]:
        cs.append({"id": c["id"], "rect": list(c["rect"]), "role": c.get("role", "display"), "ignoreclick": bool(c.get("ignoreclick")),
                   "presentation": c.get("presentation", 1), "hidden": bool(c.get("hidden")), "keys": list(c.get("keys", [])),
                   "files": list(c.get("files", [])), "reactive": c.get("reactive", True)})
    out["faces"][f] = {"device": bd.device_name(mod), "width": lay["width"], "theme": lay["theme"], "canvases": cs}
json.dump(out, sys.stdout, default=str)
`;

let infoCache = null;
function faceInfo() {
    if (!infoCache) {
        const r = cp.spawnSync("python3", ["-c", INFO_PY], { cwd: ROOT, encoding: "utf8" });
        if (r.status !== 0) throw new Error(`face info failed:\n${r.stderr}`);
        infoCache = JSON.parse(r.stdout);
    }
    return infoCache;
}

function readDevice(file) {
    const a = L.readAmxd(fs.readFileSync(file));
    const boxes = a.patcher.boxes.map((b) => b.box);
    const byId = {};
    boxes.forEach((b) => { byId[b.id] = b; });
    return { type: a.type, errs: a.errs, patcher: a.patcher, boxes, byId, lines: a.patcher.lines.map((l) => l.patchline) };
}

function makeReporter(title) {
    const st = { pass: 0, fail: 0, skip: 0, t0: Date.now() };
    return {
        ok(cond, msg) {
            if (cond) { st.pass++; if (process.env.VERBOSE) console.log(`PASS ${msg}`); } else { st.fail++; console.log(`FAIL ${msg}`); }
            return !!cond;
        },
        skip(msg) { st.skip++; console.log(`SKIP ${msg}`); },
        note(msg) { console.log(`     ${msg}`); },
        done() {
            console.log(`\n${title}: ${st.pass} passed, ${st.fail} failed, ${st.skip} skipped, ${Date.now() - st.t0} ms`);
            process.exit(st.fail ? 1 : 0);
        },
        stats: st,
    };
}

module.exports = { ROOT, tmpDir, buildInto, faceInfo, readDevice, makeReporter };
