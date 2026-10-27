"use strict";
/**
 * Fuzzes the embedded v8ui script of EVERY v8ui in every built devices/*.amxd (tests/face_fuzz_lib.js).
 *
 *   node tests/test_face_fuzz.js [--steps N] [--seed S] [--device "Name.amxd"] [--verbose] [--strict-canvas]
 *
 * Per face: loads the script in a vm sandbox (canvas = presentation_rect w x h), runs a fixed-seed random sequence of paint /
 * onclick / ondrag / ondblclick / onwheel / onkeydown / onidle / set_<param> / other messages / getvalueof+setvalueof and checks:
 * no exception or timeout, no NaN / inf / absurd coordinates or outlet numbers, and drawing inside the canvas (canvas findings are
 * listed as warnings unless --strict-canvas; the exit status counts exception / timeout / nonfinite / absurd-param only).
 * Faces that cannot run in the generic sandbox are listed in SKIP with the reason.
 */
const fs = require("fs");
const path = require("path");
const F = require("./face_fuzz_lib.js");
const { readAmxd } = require("./lint_lib.js");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const STEPS = +opt("--steps", 150), SEED = +opt("--seed", 12345), ONLY = opt("--device", null);
const VERBOSE = argv.includes("--verbose"), STRICT_CANVAS = argv.includes("--strict-canvas");

// device -> face id -> reason (the face is not fuzzed)
const SKIP = {
};
// device -> face id -> extra sandbox globals / options for loadFace
const SETUP = {
};

/** Selectors the patcher can send to a v8ui: `prepend X`, message boxes ("X a b, Y c"), `loadmess X`. */
function messageSelectors(patcher) {
    const out = new Set();
    (function walk(pp) {
        for (const { box: b } of pp.boxes) {
            const t = (b.text || "").trim();
            let m;
            if (b.maxclass === "newobj" && (m = /^prepend\s+(\S+)/.exec(t))) out.add(m[1]);
            if (b.maxclass === "newobj" && (m = /^loadmess\s+(\S+)/.exec(t))) out.add(m[1]);
            if (b.maxclass === "message") for (const seg of t.split(/\s*[,;]\s*/)) { const w = /^([A-Za-z_]\w*)/.exec(seg); if (w) out.add(w[1]); }
            if (b.patcher) walk(b.patcher);
        }
    })(patcher);
    return [...out];
}

// device -> face id -> reason: canvas warnings are not reported (the shared script paints the whole device in device coordinates and the
// small v8ui is only a window onto it, AGENTS 14 "Canvas origins": a shrunk/side canvas keeps device coordinates and Max clips the rest)
const SAMPLER_WINDOW = "Better Sampler: one script paints in device coordinates; side / inspector / adsr / filter canvases are windows onto it (clipped by Max)";
const NOCANVAS = {
    "Better Sampler.amxd": { "obj-viz-side": SAMPLER_WINDOW, "obj-viz-insp": SAMPLER_WINDOW, "obj-viz-adsr": SAMPLER_WINDOW, "obj-viz-filt": SAMPLER_WINDOW },
    "Better Sampler Reactive 2.amxd": { "obj-viz-side": SAMPLER_WINDOW, "obj-viz-insp": SAMPLER_WINDOW },
};

const HARD = new Set(["exception", "timeout", "nonfinite", "absurd-param"]);
const t0 = Date.now();
let hardCount = 0, warnCount = 0, covered = 0, skipped = 0;
const skippedList = [];
const MIN_SIDE = 4; // parked (1x1, hidden) faces get a guessed canvas
const files = fs.readdirSync(path.join(ROOT, "devices")).filter((n) => n.endsWith(".amxd") && (!ONLY || n === ONLY)).sort();
for (const f of files) {
    const p = readAmxd(fs.readFileSync(path.join(ROOT, "devices", f))).patcher;
    const faces = p.boxes.map((b) => b.box).filter((b) => b.maxclass === "v8ui" && b.textfile && typeof b.textfile.text === "string");
    if (!faces.length) continue;
    console.log(f);
    const msgNames = messageSelectors(p);
    for (const b of faces) {
        const id = b.id;
        const r = b.presentation_rect || b.patching_rect;
        const why = SKIP[f] && SKIP[f][id];
        if (why) { skipped++; skippedList.push(`${f} / ${id}: ${why}`); console.log(`   SKIP ${id}: ${why}`); continue; }
        const setup = (SETUP[f] && SETUP[f][id]) || {};
        const t1 = Date.now();
        const allFail = [], handlerSet = new Set();
        let loadErr = null;
        for (const bufferMode of ["zeros", "unit"]) {
        const face = F.loadFace(b.textfile.text, Object.assign({ bufferMode, width: r[2] < MIN_SIDE ? 200 : Math.round(r[2]), height: r[3] < MIN_SIDE ? 100 : Math.round(r[3]), seed: SEED, id, varname: b.varname, outlets: b.numoutlets, filename: `${f}:${id}` }, setup));
        if (face.loadError) { loadErr = face.loadError; break; }
        const res = F.fuzz(face, { seed: SEED, steps: STEPS, messageNames: msgNames });
        for (const x of res.failures) if (!allFail.some((y) => y.kind === x.kind && y.msg === x.msg)) allFail.push(Object.assign({ buf: bufferMode }, x));
        face.handlers.forEach((h) => handlerSet.add(h));
        }
        if (loadErr) {
            hardCount++; console.log(`   FAIL ${id} [${r.map((x) => Math.round(x))}] script does not load: ${loadErr.message}`);
            continue;
        }
        const res = { failures: allFail };
        const face = { handlers: [...handlerSet] };
        covered++;
        const hard = res.failures.filter((x) => HARD.has(x.kind) || (STRICT_CANVAS && x.kind === "canvas"));
        const noCanvas = NOCANVAS[f] && NOCANVAS[f][id];
        const warn = res.failures.filter((x) => !hard.includes(x) && !(noCanvas && x.kind === "canvas"));
        hardCount += hard.length; warnCount += warn.length;
        console.log(`   ${hard.length ? "FAIL" : "ok  "} ${id} ${Math.round(r[2])}x${Math.round(r[3])}${r[2] < MIN_SIDE ? "(parked; canvas guessed 200x100)" : ""} handlers=${face.handlers.filter((h) => /^(paint|on)/.test(h)).length}+${face.handlers.filter((h) => /^set_/.test(h)).length}set  ${Date.now() - t1}ms${warn.length ? `  (${warn.length} warning(s))` : ""}`);
        for (const x of hard) console.log(`      [${x.kind}] ${x.msg}  {buffers: ${x.buf}}`);
        for (const x of (VERBOSE ? warn : warn.slice(0, 3))) console.log(`      (warn ${x.kind}) ${x.msg}`);
        if (!VERBOSE && warn.length > 3) console.log(`      ... ${warn.length - 3} more warnings (--verbose)`);
    }
}
console.log(`\n${covered} face(s) fuzzed, ${skipped} skipped, ${hardCount} failure(s), ${warnCount} warning(s), ${Date.now() - t0} ms`);
process.exit(hardCount ? 1 : 0);
