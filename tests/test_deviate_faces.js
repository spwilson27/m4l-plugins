"use strict";
/**
 * Per-face behaviour of the Deviate devices. Loops EVERY face module in scripts/deviate_faces with its freshly built device and
 * runs each canvas v8ui script in a vm sandbox (tests/face_fuzz_lib.js loadFace + tests/paint_bounds_lib.js recorder).
 *   node tests/test_deviate_faces.js
 *
 * What a canvas script may define for these checks (all optional; a missing one prints SKIP):
 *   var PAINT_REGIONS = [[x, y, w, h], ...] | [{x, y, w, h}, ...]    where drawing is legitimate (default: the whole canvas)
 *   var hitZones      = [[x, y, w, h], ...] | function () { return [...]; }   click / drag targets, canvas coordinates
 *   function preview()                                               deterministic preview state (calls dvPreviewBase())
 * and the layout dict's canvas entry may carry  "reactive": false  (a canvas that is not driven by telemetry, skips the diff checks)
 * or  "reactive": ["hit", "t", "b", "l", "ring", "metas", "gate"]  (only these diff checks are required).
 */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const T = require("./deviate_test_lib.js");
const F = require("./face_fuzz_lib.js");
const P = require("./paint_bounds_lib.js");
const CFG = require("../src/deviate_config.js");

const R = T.makeReporter("test_deviate_faces");
const S = CFG.DV_SCOPE;
const dir = T.tmpDir("faces");
const built = T.buildInto(dir);
const info = T.faceInfo();
const NAMES = ["scope", "ctl", "ir", "spec", "test", "state"];
const INTERACTIVE = new Set(["live.dial", "live.numbox", "live.text", "live.tab", "live.menu", "live.slider", "live.toggle", "live.button", "live.drop"]);

const fmt = (a) => (typeof a === "number" ? String(Math.round(a * 1000) / 1000) : typeof a === "string" ? a : JSON.stringify(a));
const rectsOf = (v) => (v || []).map((r) => (Array.isArray(r) ? { x: +r[0], y: +r[1], w: +r[2], h: +r[3] } : { x: +r.x, y: +r.y, w: +r.w, h: +r.h }));
const inter = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;

// ---- telemetry scenarios ------------------------------------------------------------------------------------------------------------
/** a scope buffer: dvPreviewTel(base) then mod(s) */
function tel(base, mod, frame) {
    const s = CFG.dvPreviewTel(base);
    if (mod) mod(s);
    s[S.FRAMES] = frame;
    return s;
}
const setMetas = (v) => (s) => { for (let i = 0; i < 8; i++) { s[S.METAS + i] = typeof v === "function" ? v(i) : v; s[S.DRAWS + i] = typeof v === "function" ? 100 - v(i) : 100 - v; } };
const SCENARIOS = [
    { name: "idle", base: { kind: "idle" } },
    { name: "hit at 0 ms", base: { kind: "hit", ageMs: 0 } },
    { name: "hit at 120 ms", base: { kind: "hit", ageMs: 120 } },
    { name: "mid-ring 600 ms", base: { kind: "ring", ageMs: 600 } },
    { name: "late ring 1900 ms", base: { kind: "ring", ageMs: 1900 } },
    { name: "all metas 0", base: { kind: "hit" }, mod: setMetas(0) },
    { name: "all metas 100", base: { kind: "hit" }, mod: setMetas(100) },
    { name: "all chains peak 1.0", base: { kind: "hit" }, mod: (s) => { s[S.PK_T] = s[S.PK_B] = s[S.PK_L] = s[S.PK_IN] = s[S.PK_OUT] = s[S.PK_DRY] = 1; } },
    { name: "Spectral mode", base: { kind: "hit", spectral: true } },
    { name: "Chance-rejected hit", base: { kind: "hit", gate: 0 } },
    { name: "extreme preview state", base: { kind: "extreme" } },
    { name: "DSP loading", base: { kind: "hit" }, dsp: "loading" },
    { name: "DSP failed", base: { kind: "hit" }, dsp: "failed" },
    { name: "short buffer", base: { kind: "hit" }, buffer: "short" },
    { name: "NaN-filled buffer", base: { kind: "hit" }, buffer: "nan" },
];

// ---- a face under test --------------------------------------------------------------------------------------------------------------
function boot(dev, canvas, extraGlobals) {
    const b = dev.byId[canvas.id];
    const rect = canvas.rect;
    const holder = { scope: null };
    function BufferMock(name) {
        this.name = name;
        this.framecount = () => 4096; this.channelcount = () => 1; this.length = () => 85; this.samplerate = () => 48000;
        this.poke = () => {}; this.send = () => {};
        this.peek = (ch, idx, count) => {
            let src = null;
            if (name === "scope") src = holder.scope;
            else if (name === "spec") { src = new Float32Array(CFG.DV_SPEC_N); for (let i = 0; i < src.length; i++) src[i] = 0.2 * Math.sin(i * 0.3) + 0.1 * Math.sin(i * 1.7); }
            const get = (i) => (src && i >= 0 && i < src.length ? src[i] : 0);
            if (count === undefined) return get(idx);
            if (name === "scope" && !src) return [];
            if (name === "scope" && src.length < 64) return Array.from(src);
            const out = new Array(count);
            for (let i = 0; i < count; i++) out[i] = get(idx + i);
            return out;
        };
    }
    const face = F.loadFace(b.textfile.text, {
        width: rect[2], height: rect[3], id: canvas.id, filename: canvas.id + ".js", seed: 3,
        globals: Object.assign({ Buffer: BufferMock }, extraGlobals || {}),
    });
    face.holder = holder; face.errors = []; face.log = []; face.redraws = 0; face.logging = true; face.fc = 0;
    if (face.loadError) { face.errors.push(`load: ${face.loadError.message}`); return face; }
    const mg = face.rec.mgraphics;
    for (const k of Object.keys(mg)) {
        const f = mg[k];
        if (typeof f !== "function" || k === "text_measure" || k === "init") continue;
        mg[k] = function (...a) {
            if (k === "redraw") face.redraws++;
            else if (face.logging) face.log.push(`${k}(${a.map(fmt).join(",")})`);
            return f.apply(this, a);
        };
    }
    return face;
}

function msg(face, name, args) {
    face.sandbox.messagename = name;
    const r = F.call(face, "anything", args || []);
    if (!r.ok) face.errors.push(`message ${name}: ${r.msg}`);
}
function bootReady(dev, canvas, extraGlobals, ready) {
    const face = boot(dev, canvas, extraGlobals);
    if (face.loadError) return face;
    const r = F.call(face, "names", NAMES);
    if (!r.ok) face.errors.push(`names(): ${r.msg}`);
    if (ready !== false) msg(face, "state", ["dsp", 1, "-"]);
    return face;
}
function feed(face, s) {
    face.holder.scope = s;
    face.sandbox.__t = 1; // keep the clock moving 33 ms per frame
    face.state.clock += 33;
    if (typeof face.sandbox.dvFrame !== "function") { face.errors.push("dvFrame missing (the prelude must be in the canvas script)"); return; }
    const r = F.call(face, "dvFrame", []);
    if (!r.ok) face.errors.push(`dvFrame: ${r.msg}`);
}
function paint(face, label) {
    face.rec.begin(label);
    face.log.length = 0;
    const r = F.call(face, "paint", []);
    face.rec.end();
    if (!r.ok) face.errors.push(`paint (${label}): ${r.msg}`);
    return face.log.slice();
}
function regionsOf(face, canvas) {
    const pr = face.sandbox.PAINT_REGIONS;
    const rs = pr ? rectsOf(pr) : [];
    return rs.length ? rs : [{ x: 0, y: 0, w: canvas.rect[2], h: canvas.rect[3] }];
}
function violations(face, canvas) {
    const v = P.checkRecording(face.rec, { regions: regionsOf(face, canvas) });
    face.rec.bad.length = 0;
    return v;
}
/** a fresh face, an idle frame, then the scenario's frame, then paint; returns the op stream */
function render(dev, canvas, sc, tag) {
    const face = bootReady(dev, canvas, null, !sc.dsp);
    if (face.loadError) return { face, stream: null };
    feed(face, tel({ kind: "idle" }, null, ++face.fc));
    if (sc.dsp === "loading") msg(face, "state", ["dsp", 0, "-"]);
    if (sc.dsp === "failed") msg(face, "state", ["dsp", 0, "boom"]);
    let s;
    if (sc.buffer === "short") s = new Float32Array(40);
    else if (sc.buffer === "nan") { s = new Float32Array(CFG.DV_SCOPE_SAMPS).fill(NaN); s[S.FRAMES] = ++face.fc; }
    else s = tel(sc.base, sc.mod, ++face.fc);
    feed(face, s);
    const stream = paint(face, tag || sc.name);
    return { face, stream: stream.join("|"), calls: stream.length };
}

// ---- main ---------------------------------------------------------------------------------------------------------------------------
for (const file of built) {
    const name = file.replace(/\.amxd$/, "");
    const faceKey = Object.keys(info.faces).find((f) => info.faces[f].device === name);
    const fi = info.faces[faceKey];
    const dev = T.readDevice(path.join(dir, file));
    const liveRects = dev.boxes.filter((b) => INTERACTIVE.has(b.maxclass) && b.presentation === 1 && !b.hidden && b.presentation_rect)
        .map((b) => ({ id: b.id, x: b.presentation_rect[0], y: b.presentation_rect[1], w: b.presentation_rect[2], h: b.presentation_rect[3] }));
    console.log(`\n== ${name}: ${fi.canvases.length} canvas(es), ${liveRects.length} live.* widgets, theme ${fi.theme}`);

    // themed face: no numeric colour literals in its own source files
    if (fi.theme === "ableton") {
        const files = [...new Set(fi.canvases.flatMap((c) => c.files))];
        for (const f of files) {
            const src = fs.readFileSync(path.join(T.ROOT, "src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
            const hits = src.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /set_source_rgba?\(\s*[0-9.]/.test(l) || /\[\s*[0-9]\.[0-9]+\s*,\s*[0-9]\.[0-9]+\s*,\s*[0-9]\.[0-9]+/.test(l));
            R.ok(hits.length === 0, `[${name}] themed face source src/${f} has no numeric colour literals${hits.length ? ": line " + hits.slice(0, 3).map((h) => h[0]).join(", ") : ""}`);
        }
    } else R.skip(`[${name}] numeric colour literal check: face theme is "${fi.theme}" (own palette)`);

    for (const canvas of fi.canvases) {
        const tag = `[${name}/${canvas.id}]`;
        const b = dev.byId[canvas.id];
        if (!b || !b.textfile) { R.ok(false, `${tag} canvas script missing in the device`); continue; }
        const probe = bootReady(dev, canvas);
        if (probe.loadError) { R.ok(false, `${tag} script loads: ${probe.loadError.message}`); continue; }
        R.ok(true, `${tag} script loads`);
        R.ok(probe.errors.length === 0, `${tag} names() / state messages do not throw${probe.errors.length ? ": " + probe.errors[0] : ""}`);
        const [cx, cy, cw, ch] = canvas.rect;
        const pr = probe.sandbox.PAINT_REGIONS;
        if (!pr) R.skip(`${tag} PAINT_REGIONS not defined: checking against the whole canvas ${cw}x${ch}`);

        // ---- paint scenarios
        let maxCalls = 0, maxCallsName = "";
        for (const sc of SCENARIOS) {
            const r = render(dev, canvas, sc);
            const f = r.face;
            const v = violations(f, canvas);
            const errs = f.errors.concat(v);
            R.ok(errs.length === 0, `${tag} paints "${sc.name}" without errors${errs.length ? ": " + errs.slice(0, 3).join(" | ") + (errs.length > 3 ? ` (+${errs.length - 3})` : "") : ""}`);
            if (r.calls > maxCalls) { maxCalls = r.calls; maxCallsName = sc.name; }
        }
        R.ok(maxCalls <= 700, `${tag} paint stays within 700 mgraphics calls (max ${maxCalls} in "${maxCallsName}")`);

        // ---- parameter extremes for every subscribed key
        {
            const f = bootReady(dev, canvas);
            feed(f, tel({ kind: "idle" }, null, ++f.fc));
            feed(f, tel({ kind: "hit" }, null, ++f.fc));
            const errs = [];
            const run = (label, setter) => {
                setter();
                paint(f, label);
                errs.push(...f.errors.splice(0), ...violations(f, canvas));
            };
            for (const k of canvas.keys) {
                const i = CFG.DV_PARAM_INDEX[k];
                const [lo, hi, init] = [CFG.DV_PARAMS[i][3], CFG.DV_PARAMS[i][4], CFG.DV_PARAMS[i][5]];
                run(`${k}=min`, () => msg(f, "set_" + k, [lo]));
                run(`${k}=max`, () => msg(f, "set_" + k, [hi]));
                msg(f, "set_" + k, [init]);
            }
            run("all min", () => canvas.keys.forEach((k) => msg(f, "set_" + k, [CFG.DV_PARAMS[CFG.DV_PARAM_INDEX[k]][3]])));
            run("all max", () => canvas.keys.forEach((k) => msg(f, "set_" + k, [CFG.DV_PARAMS[CFG.DV_PARAM_INDEX[k]][4]])));
            run("all wild", () => canvas.keys.forEach((k) => msg(f, "set_" + k, [1e6])));
            run("all NaN-ish", () => canvas.keys.forEach((k) => msg(f, "set_" + k, ["x"])));
            R.ok(errs.length === 0, `${tag} paints at parameter extremes (${canvas.keys.length} subscribed keys, min / max / wild)${errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""}`);
        }

        // ---- preview(): determinism and bounds
        if (typeof probe.sandbox.preview === "function") {
            for (const st of ["idle", "hit", "ring", "extreme", { kind: "hit", spectral: true }]) {
                const stName = typeof st === "string" ? st : JSON.stringify(st);
                const run1 = () => {
                    const f = boot(dev, canvas, { DV_PREVIEW_STATE: st });
                    const r = F.call(f, "preview", []);
                    if (!r.ok) f.errors.push(`preview: ${r.msg}`);
                    const stream = paint(f, "preview " + stName).join("|");
                    return { f, stream };
                };
                const a = run1(), c = run1();
                const errs = a.f.errors.concat(violations(a.f, canvas));
                R.ok(errs.length === 0, `${tag} preview(${stName}) paints without errors${errs.length ? ": " + errs.slice(0, 2).join(" | ") : ""}`);
                R.ok(a.stream === c.stream && a.stream.length > 0, `${tag} preview(${stName}) is deterministic (two runs give identical paint streams)`);
            }
        } else R.skip(`${tag} no preview() defined: determinism check`);

        // ---- hit zones
        let zones = probe.sandbox.hitZones;
        if (typeof zones === "function") { try { zones = zones(); } catch (e) { R.ok(false, `${tag} hitZones() threw ${e.message}`); zones = null; } }
        if (zones && zones.length !== undefined) {
            const rs = rectsOf(zones);
            const bad = rs.filter((z) => z.x < -0.01 || z.y < -0.01 || z.x + z.w > cw + 0.01 || z.y + z.h > ch + 0.01);
            R.ok(rs.length > 0 && bad.length === 0, `${tag} ${rs.length} hit zone(s) inside the ${cw}x${ch} canvas${bad.length ? ": " + JSON.stringify(bad[0]) : ""}`);
            const hit = [];
            for (const z of rs) for (const l of liveRects) if (inter({ x: z.x + cx, y: z.y + cy, w: z.w, h: z.h }, l)) hit.push(`${JSON.stringify(z)} x ${l.id}`);
            R.ok(hit.length === 0, `${tag} hit zones are disjoint from every live.* rect${hit.length ? ": " + hit.slice(0, 3).join("; ") : ""}`);
        } else R.skip(`${tag} no hitZones defined: hit-zone containment / disjointness`);

        // ---- idle redraws
        {
            const f = bootReady(dev, canvas);
            feed(f, tel({ kind: "idle" }, null, ++f.fc));
            const frozen = f.holder.scope;
            const tick = () => {
                f.state.clock += 100;
                F.call(f, "dvFrame", []);
                for (const t of f.state.tasks) if (t.fn !== f.sandbox.dvFrame && t.running) { try { t.fn.call(t.ctx); } catch (e) { f.errors.push("task: " + e.message); } }
            };
            for (let i = 0; i < 40; i++) tick(); // 4 s: well past the 3 s activity window
            f.redraws = 0;
            for (let i = 0; i < 20; i++) tick();
            R.ok(f.redraws <= 1 && f.errors.length === 0, `${tag} frozen FRAMES: ${f.redraws} redraw request(s) in 2 s once settled (<= 1)${f.errors.length ? " errors: " + f.errors[0] : ""}`);
            R.ok(frozen === f.holder.scope, `${tag} (scope buffer unchanged during the idle test)`);
        }

        // ---- reactivity by diffing paint streams
        const reactive = canvas.reactive;
        const want = (k) => reactive !== false && (!Array.isArray(reactive) || reactive.includes(k));
        const diff = (key, label, scA, scB) => {
            if (!want(key)) { R.skip(`${tag} reactivity "${label}": canvas declares reactive ${JSON.stringify(reactive)}`); return; }
            const a = render(dev, canvas, scA, label + " A"), c = render(dev, canvas, scB, label + " B");
            const errs = a.face.errors.concat(c.face.errors);
            R.ok(a.stream !== null && c.stream !== null && errs.length === 0, `${tag} reactivity "${label}" renders${errs.length ? ": " + errs[0] : ""}`);
            R.ok(a.stream !== c.stream, `${tag} paint stream changes with ${label} (${a.calls} vs ${c.calls} calls)`);
        };
        const ring = { kind: "ring", ageMs: 600 };
        diff("hit", "hit vs idle", { base: { kind: "idle" } }, { base: { kind: "hit", ageMs: 30 } });
        diff("t", "transient peak (pk.t)", { base: ring, mod: (s) => { s[S.PK_T] = 0.08; } }, { base: ring, mod: (s) => { s[S.PK_T] = 0.9; } });
        diff("b", "body peak (pk.b)", { base: ring, mod: (s) => { s[S.PK_B] = 0.08; } }, { base: ring, mod: (s) => { s[S.PK_B] = 0.9; } });
        diff("l", "long peak (pk.l)", { base: ring, mod: (s) => { s[S.PK_L] = 0.08; } }, { base: ring, mod: (s) => { s[S.PK_L] = 0.9; } });
        diff("ring", "ring envelope / Ring meta", { base: ring, mod: (s) => { s[S.RING_ENV] = 0.2; s[S.METAS + CFG.DV_RING_META] = 20; } },
            { base: ring, mod: (s) => { s[S.RING_ENV] = 0.8; s[S.METAS + CFG.DV_RING_META] = 80; } });
        diff("metas", "a new draw (all 8 metas)", { base: { kind: "hit" }, mod: setMetas((i) => 10 + i * 3) }, { base: { kind: "hit" }, mod: setMetas((i) => 90 - i * 3) });
        diff("gate", "Chance-rejected vs accepted hit", { base: { kind: "hit", gate: 1 } }, { base: { kind: "hit", gate: 0 } });

        // ---- paint budget
        {
            const f = bootReady(dev, canvas);
            feed(f, tel({ kind: "idle" }, null, ++f.fc));
            feed(f, tel({ kind: "hit", ageMs: 40 }, null, ++f.fc));
            f.logging = false;
            const times = [];
            for (let i = 0; i < 25; i++) {
                f.rec.begin("budget");
                const t0 = process.hrtime.bigint();
                F.call(f, "paint", []);
                times.push(Number(process.hrtime.bigint() - t0) / 1e6);
            }
            f.rec.bad.length = 0;
            times.sort((x, y) => x - y);
            const med = times[12];
            R.ok(med <= 3, `${tag} paint median ${med.toFixed(2)} ms over 25 paints (hard limit 3 ms)`);
            if (med > 1) console.log(`WARN ${tag} paint median ${med.toFixed(2)} ms exceeds the 1 ms target (mock mgraphics, host machine)`);
        }
    }

    // per-face extras
    const extra = path.join(T.ROOT, "tests", `test_deviate_face_${faceKey}.js`);
    if (fs.existsSync(extra)) {
        const r = cp.spawnSync("node", [extra], { cwd: T.ROOT, encoding: "utf8", env: Object.assign({}, process.env, { DEVIATE_BUILD_DIR: dir }) });
        R.ok(r.status === 0, `[${name}] extras tests/test_deviate_face_${faceKey}.js exit ${r.status}`);
        if (r.status !== 0) console.log((r.stdout + r.stderr).split("\n").slice(-15).join("\n"));
    } else R.skip(`[${name}] no per-face extras (tests/test_deviate_face_${faceKey}.js)`);
}

R.done();
