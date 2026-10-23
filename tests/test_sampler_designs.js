#!/usr/bin/env node
/**
 * Contract every Better Sampler design variant (scripts/sampler_designs/<slug>.json) must meet.
 * Run after `python3 scripts/build_sampler.py`:  node tests/test_sampler_designs.js [slug]
 *
 *  - device: 169 px high, devicewidth = spec width, one main v8ui (obj-viz) spanning max_width, the
 *    waveform drop zone inside it, side / inspector canvases off the face, deferred DSP patch embedded
 *  - face: paints in every engine (Repitch .. Fragments), Single and Sliced, Analyzed Root Key on/off,
 *    with and without a sample; every hit zone lies inside the canvas; there is a "wave" zone
 *  - interaction: clicking / dragging / double-clicking every zone never throws, and every emitted
 *    ["param", key, value] names a real parameter with a value inside its range
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const DESIGNS = path.join(ROOT, "scripts", "sampler_designs");
const only = process.argv[2];

function loadDevice(file) {
    const raw = fs.readFileSync(path.join(ROOT, "devices", file));
    return JSON.parse(raw.slice(32).toString("utf8")).patcher;
}

function makeSandbox(box) {
    const ctx = { emitted: [], audioOn: true };
    const noop = () => {};
    const mg = new Proxy({ size: [box.presentation_rect[2], box.presentation_rect[3]] }, {
        get: (t, k) => (k in t ? t[k] : noop),
    });
    const sb = {
        mgraphics: mg,
        outlet: (...a) => ctx.emitted.push(a),
        notifyclients: noop,
        arrayfromargs: (a) => Array.from(a),
        post: noop,
        Buffer: function () {
            this.framecount = () => 96000;
            this.channelcount = () => 2;
            this.peek = (ch, st, len) => {
                const n = Math.max(1, len || 1);
                const a = new Float32Array(n);
                for (let i = 0; i < n; i++) a[i] = 0.6 * Math.sin(((st || 0) + i) / 25) * Math.exp(-((st || 0) + i) / 60000);
                return a;
            };
            this.poke = noop;
        },
        Task: function () { this.schedule = noop; this.cancel = noop; this.repeat = noop; },
        Math, Number, String, Array, Object, Float32Array, Uint8Array, JSON, Date,
    };
    vm.createContext(sb);
    vm.runInContext(box.textfile.text, sb);
    ctx.sb = sb;
    return ctx;
}

const specs = fs.existsSync(DESIGNS) ? fs.readdirSync(DESIGNS).filter((f) => f.endsWith(".json")) : [];
let tested = 0;
for (const f of specs) {
    const slug = f.slice(0, -5);
    if (only && slug !== only) continue;
    const spec = JSON.parse(fs.readFileSync(path.join(DESIGNS, f), "utf8"));
    for (const k of ["title", "device", "face", "width", "drop"]) assert.ok(k in spec, `${slug}: spec has ${k}`);
    if (!fs.existsSync(path.join(ROOT, spec.face))) { console.log(`skip ${slug}: ${spec.face} missing`); continue; }
    const maxW = spec.max_width || spec.width;
    const p = loadDevice(spec.device);
    const boxes = p.boxes.map((b) => b.box);
    const byId = new Map(boxes.map((b) => [b.id, b]));

    // --- device structure ---
    assert.deepStrictEqual(p.openrect, [0, 0, spec.width, 169], `${slug}: openrect`);
    assert.strictEqual(p.devicewidth, spec.width, `${slug}: devicewidth`);
    const main = byId.get("obj-viz");
    assert.deepStrictEqual(main.presentation_rect, [0, 0, maxW, 169], `${slug}: main canvas spans max_width`);
    for (const id of ["obj-viz-side", "obj-viz-insp"]) assert.notStrictEqual(byId.get(id).presentation, 1, `${slug}: ${id} off the face`);
    const drop = byId.get("obj-drop-wave");
    const d = drop.presentation_rect;
    assert.ok(d[0] >= 0 && d[1] >= 0 && d[0] + d[2] <= maxW && d[1] + d[3] <= 169, `${slug}: drop zone inside the canvas`);
    assert.ok(main.textfile.text.includes("var GEN_DSP_TEXT"), `${slug}: deferred DSP patch embedded`);
    assert.ok(main.textfile.text.includes(`var FACE_DESIGN = ${JSON.stringify(slug)}`), `${slug}: FACE_DESIGN`);
    const live = boxes.filter((b) => /^live\./.test(b.maxclass) && b.presentation === 1 && b.id !== "obj-drop-wave");
    assert.deepStrictEqual(live.map((b) => b.id), [], `${slug}: no live.* widgets on the face`);

    // --- painting in every state ---
    const ctx = makeSandbox(main);
    const s = ctx.sb;
    const FP = s.FACE_PARAMS;
    s.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope", "#0-bspitch");
    s.paint();
    s.sample_loaded("/Users/test/Pad - Granular - F#.wav");
    s.sample_loaded("bang");
    const states = [];
    for (const sliced of [0, 1]) for (const mode of [0, 1, 2, 3, 4]) for (const dyn of [0, 1]) states.push({ sliced, mode, dyn });
    const checkZones = (label) => {
        assert.ok(s.hitZones.length > 0, `${slug} ${label}: has hit zones`);
        for (const z of s.hitZones) {
            assert.ok(z.x >= -1 && z.y >= -1 && z.x + z.w <= maxW + 1 && z.y + z.h <= 169 + 1,
                `${slug} ${label}: zone ${z.kind} ${z.key || z.action || ""} inside the canvas ${[z.x, z.y, z.w, z.h].map((v) => Math.round(v))}`);
        }
    };
    // set state as the face would (fromFace skips the stale-echo filter that can swallow set_*)
    const put = (k, v) => s.storeParam(k, v, true);
    for (const fold of maxW !== spec.width ? [0, 1] : [0]) {
        put("show_inspector", fold);
        for (const st of states) {
            put("sliced", st.sliced); put("mode", st.mode); put("root_dyn", st.dyn);
            s.paint();
            checkZones(JSON.stringify(Object.assign({ fold }, st)));
        }
    }
    // designs with a sidebar of folding sections (spec.folds = number of sections): every open/closed combination
    if (spec.folds && typeof s.setFoldMask === "function") {
        const nMasks = 1 << spec.folds;
        for (let m = 0; m < nMasks; m++) {
            ctx.emitted.length = 0;
            s.setFoldMask(m);
            const wc = ctx.emitted.filter((a) => a[1] === "setwidth_cmd").pop();
            assert.ok(wc, `${slug} fold ${m}: setwidth_cmd sent`);
            assert.ok(wc[2] >= 1 && wc[2] <= maxW, `${slug} fold ${m}: width ${wc[2]} within max_width`);
            if (m === (1 << spec.folds) - 1) assert.strictEqual(wc[2], maxW, `${slug}: everything open = max_width`);
            for (const st of [{ sliced: 0, mode: 0 }, { sliced: 1, mode: 3 }, { sliced: 0, mode: 4 }, { sliced: 0, mode: 1 }]) {
                put("sliced", st.sliced); put("mode", st.mode);
                s.paint();
                for (const z of s.hitZones) {
                    assert.ok(z.x >= -1 && z.y >= -1 && z.x + z.w <= wc[2] + 1 && z.y + z.h <= 170,
                        `${slug} fold ${m} ${JSON.stringify(st)}: zone ${z.kind} ${z.key || z.action || z.id || ""} inside the device width ${wc[2]}: ${[z.x, z.y, z.w, z.h].map((v) => Math.round(v))}`);
                }
            }
        }
        s.setFoldMask(s.DEFAULT_FOLD);
    }
    put("show_inspector", 0); put("sliced", 0); put("mode", 0); put("root_dyn", 0);
    s.paint();
    assert.ok(s.hitZones.some((z) => z.kind === "wave"), `${slug}: has a waveform zone`);

    // --- interaction on every zone in a few states ---
    const checkEmits = (label) => {
        for (const a of ctx.emitted) {
            if (a[1] !== "param") continue;
            const spec = FP[a[2]];
            assert.ok(spec, `${slug} ${label}: emitted unknown param ${a[2]}`);
            assert.ok(Number.isFinite(a[3]) && a[3] >= spec.lo - 1e-6 && a[3] <= spec.hi + 1e-6, `${slug} ${label}: ${a[2]} = ${a[3]} outside ${spec.lo}..${spec.hi}`);
        }
        ctx.emitted.length = 0;
    };
    const iStates = [{ sliced: 0, mode: 0 }, { sliced: 1, mode: 2 }, { sliced: 0, mode: 3 }, { sliced: 0, mode: 4 }, { sliced: 0, mode: 1 }];
    if (maxW !== spec.width) for (const m of [0, 3]) iStates.push({ sliced: 0, mode: m, fold: 1 });
    const foldStates = spec.folds ? [63, 1, 2, 4, 8, 16, 32] : [];
    for (const fm of foldStates) iStates.push({ sliced: 0, mode: fm === 2 ? 4 : (fm === 1 ? 3 : 0), foldMask: fm });
    for (const st of iStates) {
        put("show_inspector", st.fold || 0); put("sliced", st.sliced); put("mode", st.mode);
        if (st.foldMask !== undefined) s.setFoldMask(st.foldMask);
        ctx.emitted.length = 0;
        s.paint();
        const zones = s.hitZones.slice();
        for (const z of zones) {
            const cx = z.x + z.w / 2, cy = z.y + z.h / 2;
            s.paint();
            s.onclick(cx, cy, 1, 0, 0);
            s.ondrag(cx, cy - 20, 1, 0, 0);
            s.ondrag(cx + 15, cy - 40, 1, 0, 1);
            s.ondrag(cx + 15, cy - 40, 0, 0, 0);
            if (typeof s.onidle === "function") s.onidle(cx, cy);
            s.paint();
            s.ondblclick(cx, cy);
            s.paint();
            checkEmits(`${JSON.stringify(st)} zone ${z.kind} ${z.key || z.action || ""}`);
            if (s.openMenu) { s.onclick(1, 1, 1, 0, 0); }
        }
    }
    if (typeof s.onidleout === "function") s.onidleout();
    tested++;
    console.log(`[${slug}] ${spec.title}: ${spec.width}${maxW !== spec.width ? "-" + maxW : ""}x169, painted ${states.length * (maxW !== spec.width ? 2 : 1)} states, exercised zones ok`);
}
console.log(tested ? `All ${tested} sampler design(s) passed` : "no sampler designs found");
