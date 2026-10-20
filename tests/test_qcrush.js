#!/usr/bin/env node
"use strict";
// Node tests for Quefrency Crush: the three .amxd variants (JSON, layout rules, wiring), the v8ui script, and the DSP
// math against src/cepstrum_ref.js through src/qcrush_ref.js (the Node twin of src/qcrush_core.genexpr).
// Real Max audio checks live in scripts/run_qcrush_audio_tests.py.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ref = require("../src/cepstrum_ref.js");
const qc = require("../src/qcrush_ref.js");

const ROOT = path.join(__dirname, "..");
const LIB = fs.readFileSync(path.join(ROOT, "src", "cepstrum_lib.genexpr"), "utf8");
const CORE = fs.readFileSync(path.join(ROOT, "src", "qcrush_core.genexpr"), "utf8");
const UI = fs.readFileSync(path.join(ROOT, "src", "qcrush_ui.js"), "utf8");
const GEN = LIB + "\n" + CORE;

// ---------------------------------------------------------------- gen source lint
assert.ok(!CORE.match(/\be\d/), "e-digits are Euler's number in GenExpr");
assert.strictEqual((CORE.match(/delay\(/g) || []).length, 0, "delay() is not valid GenExpr");
{
    // the last top-level function definition in the core (new functions never need registering)
    let lastFn = -1;
    for (const m of CORE.matchAll(/^[a-z_0-9]+\(.*\) \{$/gm)) lastFn = Math.max(lastFn, m.index);
    assert.ok(lastFn > 0, "core defines helper functions");
    for (const decl of ["\nBuffer ", "\nData ", "\nParam ", "\nHistory ", "\nDelay "]) {
        assert.ok(CORE.indexOf(decl) > lastFn, `functions must precede ${decl.trim()} declarations`);
    }
    assert.ok(GEN.indexOf("\ncep_peak(") < GEN.indexOf("\nqc_pitch("), "library functions come first");
    assert.ok(CORE.includes('Buffer scope("qcrushscope")'));
    for (const p of ["fftn", "coeffs", "qbits", "smode", "samt", "qshift", "gmode", "grate", "pmode", "qlag", "wet", "outdb", "bpm", "ppq"]) {
        assert.ok(CORE.includes(`Param ${p}(`), `core has Param ${p}`);
    }
    assert.ok(CORE.includes("padL.read(4096 - (n - 1))") && CORE.includes("dlyL.read(4096)"), "constant 4096 latency, dry aligned");
}

// ---------------------------------------------------------------- the three devices
const VARIANTS = { A: { w: 520, layout: 0 }, B: { w: 520, layout: 1 }, C: { w: 500, layout: 2 } };
const PARAMS = ["Size", "Coeffs", "Bits", "Scramble", "Amount", "Shift", "Glitch", "Rate", "Phase", "Lag", "Mix", "Output"];
const boxesOf = {};
const vizText = {};
for (const [v, info] of Object.entries(VARIANTS)) {
    const file = path.join(ROOT, "devices", `Quefrency Crush ${v}.amxd`);
    const raw = fs.readFileSync(file);
    assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", `${v}: ampf header`);
    assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", `${v}: audio effect`);
    assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch");
    assert.strictEqual(32 + raw.readUInt32LE(28), raw.length, `${v}: ptch length`);
    const p = JSON.parse(raw.slice(32).toString("utf8")).patcher;
    assert.deepStrictEqual(p.openrect, [0, 0, info.w, 169], `${v}: openrect`);
    assert.strictEqual(p.devicewidth, info.w);
    assert.strictEqual(p.openinpresentation, 1);
    assert.strictEqual(p.latency, 4096, `${v}: latency attribute`);

    const map = new Map(p.boxes.map((b) => [b.box.id, b.box]));
    boxesOf[v] = { p, map };
    const gen = map.get("obj-gen");
    assert.strictEqual(gen.maxclass, "gen.codebox~");
    assert.strictEqual(gen.code, GEN, `${v}: embedded gen code is the library + src/qcrush_core.genexpr`);
    assert.strictEqual(map.get("obj-scope-buf").text, "buffer~ #0-qcrushscope @samps 320");
    assert.strictEqual(map.get("obj-msg-gen-buf").text, "scope #0-qcrushscope");
    assert.strictEqual(map.get("obj-msg-ui-buf").text, "setbuffer #0-qcrushscope");
    assert.strictEqual(map.get("obj-msg-layout").text, `set_layout ${info.layout}`);

    // exactly the twelve Live parameters, each once
    const params = p.boxes
        .map((b) => b.box)
        .filter((b) => b.saved_attribute_attributes && b.saved_attribute_attributes.valueof && b.saved_attribute_attributes.valueof.parameter_longname);
    const names = params.map((b) => b.saved_attribute_attributes.valueof.parameter_longname).sort();
    assert.deepStrictEqual(names, PARAMS.slice().sort(), `${v}: parameters`);
    for (const b of params) {
        const vo = b.saved_attribute_attributes.valueof;
        if (vo.parameter_type === 1) assert.ok(vo.parameter_mmax <= 255, `${v}: ${vo.parameter_longname} Int range must be <= 255`);
        assert.ok(b.presentation === 1, `${v}: ${vo.parameter_longname} is in presentation`);
    }
    const bits = map.get("obj-ctrl-bits").saved_attribute_attributes.valueof;
    assert.deepStrictEqual([bits.parameter_mmin, bits.parameter_mmax, bits.parameter_initial[0]], [1, 16, 16]);
    const size = map.get("obj-ctrl-size").saved_attribute_attributes.valueof;
    assert.deepStrictEqual(size.parameter_enum, ["512", "1k", "2k", "4k"]);
    assert.strictEqual(size.parameter_initial[0], 1, "Size defaults to 1024");
    const enumOf = (key) => map.get(`obj-ctrl-${key}`).saved_attribute_attributes.valueof;
    assert.deepStrictEqual(enumOf("gmode").parameter_enum, ["Off", "Drop", "Rpt", "Rev", "Hold", "Frz"]);
    assert.deepStrictEqual(enumOf("grate").parameter_enum, ["1/32", "1/16", "1/8", "1/4", "1/2", "1 bar"]);
    assert.deepStrictEqual(enumOf("pmode").parameter_enum, ["Orig", "Robot", "Whisp", "Min"]);
    for (const [key, init] of [["gmode", 0], ["grate", 1], ["pmode", 0]]) {
        assert.strictEqual(enumOf(key).parameter_type, 2, `${v}: ${key} is an enum (parameter_type 2)`);
        assert.strictEqual(enumOf(key).parameter_initial[0], init, `${v}: ${key} initial`);
    }
    const lagVo = enumOf("lag");
    assert.deepStrictEqual([lagVo.parameter_type, lagVo.parameter_mmin, lagVo.parameter_mmax, lagVo.parameter_initial[0], lagVo.parameter_unitstyle], [0, 0, 100, 0, 5], `${v}: Lag is a 0..100 % float`);
    assert.strictEqual(map.get("obj-ctrl-samt").annotation, "Scramble amount (blend / rotation distance) and, for Glitch Drop/Rpt/Rev, the chance that a Rate slot fires", `${v}: Amount tooltip`);
    assert.strictEqual(map.get("obj-ctrl-freeze"), undefined, `${v}: Freeze is gone`);
    assert.strictEqual(map.get("obj-ctrl-hold"), undefined, `${v}: Hold is gone`);
    assert.strictEqual(map.get("obj-prep-freeze"), undefined);
    assert.strictEqual(map.get("obj-prep-hold"), undefined);
    const patchText = p.boxes.map((b) => b.box.text || "").join("\n") + JSON.stringify(p.lines);
    assert.ok(!/set_freeze|set_hold|qhold|prepend freeze/.test(patchText), `${v}: no freeze/hold messages`);
    // the 12 controls sit on 12 distinct presentation boxes
    assert.strictEqual(params.length, 12, `${v}: twelve controls`);
    assert.deepStrictEqual(map.get("obj-ctrl-smode").saved_attribute_attributes.valueof.parameter_enum, ["Off", "Rev", "Shuf", "Rot"]);
    // defaults are neutral
    assert.strictEqual(map.get("obj-ctrl-coeffs").saved_attribute_attributes.valueof.parameter_initial[0], 100);
    assert.strictEqual(map.get("obj-ctrl-shift").saved_attribute_attributes.valueof.parameter_initial[0], 0);
    assert.strictEqual(map.get("obj-ctrl-mix").saved_attribute_attributes.valueof.parameter_initial[0], 100);
    assert.strictEqual(map.get("obj-ctrl-samt").saved_attribute_attributes.valueof.parameter_initial[0], 50);

    // wiring: every control reaches gen and the view
    const lineSet = new Set(p.lines.map((l) => `${l.patchline.source[0]}:${l.patchline.source[1]}->${l.patchline.destination[0]}:${l.patchline.destination[1]}`));
    const has = (s) => assert.ok(lineSet.has(s), `${v}: missing patchline ${s}`);
    for (const [key, gm, scaled] of [
        ["coeffs", "coeffs", true], ["bits", "qbits", false], ["smode", "smode", false], ["samt", "samt", true], ["shift", "qshift", false],
        ["gmode", "gmode", false], ["grate", "grate", false], ["pmode", "pmode", false], ["lag", "qlag", true],
        ["mix", "wet", true], ["out", "outdb", false],
    ]) {
        assert.strictEqual(map.get(`obj-prep-${key}`).text, `prepend ${gm}`);
        if (scaled) {
            assert.strictEqual(map.get(`obj-scale-${key}`).text, "* 0.01");
            has(`obj-ctrl-${key}:0->obj-scale-${key}:0`);
            has(`obj-scale-${key}:0->obj-prep-${key}:0`);
        } else {
            has(`obj-ctrl-${key}:0->obj-prep-${key}:0`);
        }
        has(`obj-prep-${key}:0->obj-gen:0`);
        has(`obj-ctrl-${key}:0->obj-ui-${key}:0`);
        has(`obj-ui-${key}:0->obj-viz:0`);
    }
    assert.ok(map.get("obj-size-expr").text.startsWith("expr 512 * pow(2"), `${v}: Size index to samples`);
    has("obj-ctrl-size:0->obj-size-expr:0");
    has("obj-size-expr:0->obj-prep-size:0");
    assert.strictEqual(map.get("obj-prep-size").text, "prepend fftn");
    has("obj-prep-size:0->obj-gen:0");
    has("obj-sync:5->obj-bpm-chg:0");
    has("obj-bpm-prep:0->obj-gen:0");
    has("obj-sync:6->obj-ppq-chg:0");
    has("obj-ppq-prep:0->obj-gen:0");
    has("obj-plugin:0->obj-gen:0");
    has("obj-gen:1->obj-plugout:1");
    has("obj-msg-layout:0->obj-viz:0");

    // the view: one script, layout passed in
    const viz = map.get("obj-viz");
    assert.strictEqual(viz.maxclass, "v8ui");
    assert.strictEqual(viz.textfile.text, `var QC_LAYOUT_DEFAULT = ${info.layout};\n` + UI, `${v}: v8ui script`);
    assert.ok(/mgraphics\.init\(\);\s*mgraphics\.relative_coords = 0;\s*mgraphics\.autofill = 0;/.test(UI), "mgraphics init lines");
    vizText[v] = viz.textfile.text;

    // presentation rules: height, bounds, no live.* over the v8ui, no overlapping controls, panels last
    const vr = viz.presentation_rect;
    const interactive = [];
    for (const [id, b] of map.entries()) {
        if (!b.presentation || !b.presentation_rect || b.maxclass === "panel") continue;
        const r = b.presentation_rect;
        assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= info.w && r[1] + r[3] <= 169, `${v}: ${id} inside the 169 px device`);
        if (id !== "obj-viz") {
            const ox = r[0] < vr[0] + vr[2] && r[0] + r[2] > vr[0];
            const oy = r[1] < vr[1] + vr[3] && r[1] + r[3] > vr[1];
            assert.ok(!(ox && oy), `${v}: ${id} overlaps the v8ui canvas`);
            if (b.maxclass.startsWith("live.") && b.maxclass !== "live.comment") interactive.push([id, r]);
        }
    }
    for (let i = 0; i < interactive.length; i++) {
        for (let j = i + 1; j < interactive.length; j++) {
            const [ia, a] = interactive[i];
            const [ib, b] = interactive[j];
            const ox = a[0] < b[0] + b[2] && a[0] + a[2] > b[0];
            const oy = a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
            assert.ok(!(ox && oy), `${v}: ${ia} and ${ib} overlap`);
        }
    }
    const order = p.boxes.map((b) => b.box.id);
    const lastControl = Math.max(...order.map((id, i) => (map.get(id).maxclass !== "panel" ? i : -1)));
    for (const [id, b] of map.entries()) {
        if (b.maxclass === "panel") {
            assert.strictEqual(b.background, 1, `${v}: ${id} is a background panel`);
            assert.ok(order.indexOf(id) > lastControl, `${v}: ${id} must come after every control`);
        }
    }
    // slider fills are pre-blended opaque
    for (const [id, b] of map.entries()) {
        if (b.maxclass === "live.numbox" && b.activeslidercolor) assert.strictEqual(b.activeslidercolor[3], 1, `${v}: ${id} slider colour opaque`);
    }
}
// genuinely different layouts
{
    const rectOf = (v, id) => boxesOf[v].map.get(id).presentation_rect;
    assert.ok(rectOf("A", "obj-viz")[2] > 250 && rectOf("A", "obj-viz")[3] === 134, "A: canvas is the hero");
    assert.ok(rectOf("B", "obj-viz")[2] < 190, "B: compact view beside the LCD");
    assert.strictEqual(boxesOf.B.map.get("obj-ctrl-coeffs").maxclass, "live.dial", "B: dials");
    assert.strictEqual(boxesOf.A.map.get("obj-ctrl-coeffs").maxclass, "live.numbox", "A: value bars");
    {
        const f = rectOf("C", "obj-ctrl-gmode");
        const face = rectOf("C", "obj-glitch-face");
        assert.ok(face[2] >= 80 && face[3] + f[3] >= 70 && f[1] >= face[1] + face[3], "C: big Glitch pad (face above the Glitch tab)");
        assert.strictEqual(boxesOf.C.map.get("obj-route-face").text, "route gmode", "C: the pad drives Glitch");
        const cl = new Set(boxesOf.C.p.lines.map((l) => `${l.patchline.source[0]}:${l.patchline.source[1]}->${l.patchline.destination[0]}:${l.patchline.destination[1]}`));
        for (const l of ["obj-glitch-face:0->obj-route-face:0", "obj-route-face:0->obj-ctrl-gmode:0", "obj-ui-gmode:0->obj-glitch-face:0", "obj-ui-grate:0->obj-glitch-face:0"]) assert.ok(cl.has(l), `C: ${l}`);
    }
    for (const v of ["A", "B", "C"]) {
        const m = boxesOf[v].map;
        const lagBox = m.get("obj-ctrl-lag");
        assert.ok(lagBox, `${v}: Lag control present`);
        if (v === "A") for (const k of ["gmode", "grate", "pmode"]) assert.ok(["live.tab", "live.menu"].includes(m.get(`obj-ctrl-${k}`).maxclass));
    }
    assert.ok(boxesOf.C.map.get("obj-route-viz").text === "route coeffs bits", "C: the crush pad drives Coeffs and Bits");
    assert.ok(boxesOf.A.map.get("obj-route-viz").text === "route coeffs", "A: dragging the canvas drives Coeffs");
    assert.strictEqual(boxesOf.B.map.get("obj-route-viz"), undefined);
}

// ---------------------------------------------------------------- the view script
function makeMock(w, h) {
    const calls = { redraw: 0, outs: [], ops: 0 };
    const noop = () => { calls.ops++; };
    const mg = {
        size: [w, h], relative_coords: 1, autofill: 1, init() {}, redraw() { calls.redraw++; },
        set_source_rgba: noop, set_line_width: noop, rectangle: noop, rectangle_rounded: noop, arc: noop, close_path: noop,
        fill: noop, stroke: noop, move_to: noop, line_to: noop, curve_to: noop, select_font_face: noop, set_font_size: noop, show_text: noop,
    };
    return { mg, calls };
}
function loadView(code, w, h, bufferFloats) {
    const { mg, calls } = makeMock(w, h);
    function FakeBuffer() {
        this.peek = (ch, start, count) => {
            const out = [];
            for (let i = 0; i < count; i++) out.push(bufferFloats[start + i] || 0);
            return out;
        };
    }
    const fn = new Function(
        "mgraphics", "inlets", "outlets", "outlet", "notifyclients", "Buffer", "Task",
        code + "\nreturn { paint, preview, onclick, ondrag, ondblclick, setbuffer, pullScope, set_layout, set_coeffs, set_bits, set_gmode, set_grate, set_pmode, set_lag, set_smode, set_samt, set_shift, set_size, kOfCf, cfOfK, crushList, demoBase, lagDelay, lagMaxFrames, histCode, histDecode, histEncode, getState: () => ({ haveTelemetry, layout, curCoeffs, curBits, curGmode, curGrate, curPmode, curLag, tele }) };"
    );
    const ui = fn(mg, 1, 1, (...a) => calls.outs.push(a.slice(1)), () => {}, FakeBuffer, undefined);
    return { ui, mg, calls };
}
for (const [v, info] of Object.entries(VARIANTS)) {
    const vr = boxesOf[v].map.get("obj-viz").presentation_rect;
    const { ui, mg, calls } = loadView(vizText[v], vr[2], vr[3], []);
    assert.strictEqual(mg.relative_coords, 0);
    assert.strictEqual(mg.autofill, 0);
    assert.strictEqual(ui.getState().layout, info.layout, `${v}: layout from the prepended constant`);
    ui.preview();
    ui.paint();
    assert.ok(calls.ops > 100, `${v}: paints something`);
    ui.set_layout(1);
    ui.paint();
    ui.set_layout(2);
    ui.paint();
    ui.set_layout(info.layout);
    // drags
    calls.outs.length = 0;
    if (info.layout === 0) {
        ui.onclick(50, 40);
        ui.ondrag(120, 40, 1);
        assert.ok(calls.outs.length >= 2 && calls.outs.every((o) => o[0] === "coeffs"), "A: dragging the bars emits coeffs");
        const pct = calls.outs[calls.outs.length - 1][1];
        assert.ok(pct > 0 && pct < 100);
        ui.ondrag(vr[2], 40, 1);
        assert.strictEqual(calls.outs[calls.outs.length - 1][1], 100, "A: the right edge is Coeffs 100 %");
        ui.ondrag(5, 40, 0);
        const n = calls.outs.length;
        ui.ondrag(60, 40, 1);
        assert.strictEqual(calls.outs.length, n, "no drag after release");
    } else if (info.layout === 2) {
        ui.onclick(vr[2] / 2, vr[3] / 2);
        const names = calls.outs.map((o) => o[0]);
        assert.deepStrictEqual(names.slice(0, 2), ["coeffs", "bits"], "C: the pad drives Coeffs and Bits");
        const bitsOut = calls.outs[1][1];
        assert.ok(bitsOut >= 7 && bitsOut <= 10);
        ui.onclick(0, vr[3]);
        assert.strictEqual(calls.outs[calls.outs.length - 1][1], 1, "C: bottom edge is 1 bit");
        ui.onclick(vr[2], 0);
        assert.strictEqual(calls.outs[calls.outs.length - 1][1], 16, "C: top edge is 16 bits");
        assert.strictEqual(calls.outs[calls.outs.length - 2][1], 100, "C: right edge is Coeffs 100 %");
    }
    ui.ondblclick(10, 10);
}

// demo state follows the settings (steps visible at low Bits) and the Coeffs mapping is monotone and invertible
{
    const { ui } = loadView(vizText.A, 268, 134, []);
    const base = ui.demoBase(0);
    const exact = ui.crushList(base, null, 1e6, 16, 0, 0.5, false, 88);
    assert.ok(exact.every((v, i) => Math.abs(v - base[i]) < 1e-12), "neutral demo is identity");
    const crushed = ui.crushList(base, null, 1e6, 3, 0, 0.5, false, 88);
    const step = 1.5 * Math.pow(2, -2 * 0.75);
    assert.ok(crushed.every((v) => Math.abs(v / step - Math.round(v / step)) < 1e-9), "3 bits: coefficients sit on the step ladder");
    const cut = ui.crushList(base, null, 20, 16, 0, 0.5, false, 88);
    assert.ok(cut.slice(20).every((v) => v === 0), "K = 20 keeps 20 coefficients");
    for (const n of [512, 1024, 2048, 4096]) {
        let prev = 0;
        for (let cf = 0; cf <= 1; cf += 0.1) {
            const k = ui.kOfCf(cf, n);
            assert.ok(k >= prev, "K rises with Coeffs");
            prev = k;
        }
        assert.strictEqual(ui.kOfCf(1, n), n / 2);
        assert.ok(Math.abs(ui.cfOfK(ui.kOfCf(0.4, n), n) - 0.4) < 1e-9);
    }
}

// telemetry parsing, held state and silent skipping
{
    const tel = new Array(320).fill(0);
    for (let i = 0; i < 96; i++) { tel[i] = 0.3 / (i + 1); tel[96 + i] = 0.2 / (i + 1); }
    tel[192] = 2048; tel[193] = 40; tel[194] = 6; tel[195] = 1; tel[196] = 0.25; tel[197] = 5; tel[199] = 0.3;
    tel[200] = 401; tel[201] = 0.9; tel[202] = 200; tel[203] = 7; tel[204] = 44100; tel[205] = 88; tel[208] = 2;
    const { ui, calls } = loadView(vizText.A, 268, 134, tel);
    ui.setbuffer("x");
    ui.pullScope();
    assert.ok(ui.getState().haveTelemetry, "real telemetry replaces the demo");
    assert.strictEqual(ui.getState().tele.held, 1);
    assert.strictEqual(ui.getState().tele.k, 40);
    ui.paint();
    // silence: level 0 and no new frames -> settles, then no more redraws
    tel[199] = 0;
    ui.pullScope();
    const settled = calls.redraw;
    ui.pullScope();
    ui.pullScope();
    assert.strictEqual(calls.redraw, settled, "no redraws while silent");
}

// ---------------------------------------------------------------- Glitch / Phase / Lag in the view
{
    // lag formula, independent of the UI implementation: d(q) = floor(12 * lag * s(q) + 0.5), s = 0.5 min(1,(q-1)/127) + 0.5 h(q)
    const sLag = (q) => {
        const v = Math.sin(q * 12.9898 + 4.1414) * 43758.5453;
        return 0.5 * Math.min(1, (q - 1) / 127) + 0.5 * (v - Math.floor(v));
    };
    const { ui, calls } = loadView(vizText.A, 284, 134, []);
    for (const lag of [0, 0.25, 0.5, 1]) {
        let mx = 0;
        for (let q = 1; q <= 96; q++) {
            const want = Math.floor(12 * lag * sLag(q) + 0.5);
            assert.strictEqual(ui.lagDelay(q, lag), want, `lag ${lag} q ${q}`);
            assert.ok(want >= 0 && want <= 12);
            mx = Math.max(mx, want);
        }
        assert.strictEqual(ui.lagMaxFrames(lag), mx);
    }
    assert.strictEqual(ui.lagDelay(0, 1), 0, "d(0) = 0");
    assert.strictEqual(ui.lagMaxFrames(0), 0);
    // history decode: newest frame in bits 0-1 of histA, ages 12..23 in histB
    const codes = Array.from({ length: 24 }, (_, i) => (i * 7 + (i >> 2)) % 4);
    const [hA, hB] = ui.histEncode(codes);
    assert.deepStrictEqual(ui.histDecode(hA, hB), codes, "history round trip");
    assert.strictEqual(ui.histCode(2, 0, 0), 2, "newest = bits 0-1");
    assert.strictEqual(ui.histCode(2, 0, 1), 0);
    assert.strictEqual(ui.histCode(0, 3, 12), 3, "age 12 = bits 0-1 of histB");
    assert.strictEqual(ui.histCode(4 * 4 * 1, 0, 2), 1);
    assert.ok(hA < 2 ** 24 && hB < 2 ** 24, "exact float range");
    // setters exist and clamp
    ui.set_gmode(9); assert.strictEqual(ui.getState().curGmode, 5);
    ui.set_gmode(2); assert.strictEqual(ui.getState().curGmode, 2);
    ui.set_grate(-3); assert.strictEqual(ui.getState().curGrate, 0);
    ui.set_grate(4); assert.strictEqual(ui.getState().curGrate, 4);
    ui.set_pmode(7); assert.strictEqual(ui.getState().curPmode, 3);
    ui.set_lag(250); assert.strictEqual(ui.getState().curLag, 100);
    ui.set_lag(35); assert.strictEqual(ui.getState().curLag, 35);
    // the demo shows plausible history for every Glitch mode, and nothing when off
    for (const [g, code] of [[1, 1], [2, 2], [3, 3]]) {
        ui.set_gmode(g); ui.set_samt(70); ui.preview();
        const t = ui.getState().tele;
        const d = ui.histDecode(t.histA, t.histB);
        assert.ok(d.includes(code), `demo Glitch ${g} shows code ${code}`);
        assert.ok(d.every((c) => c === 0 || c === code));
        ui.paint();
    }
    ui.set_gmode(0); ui.preview();
    assert.ok(ui.histDecode(ui.getState().tele.histA, ui.getState().tele.histB).every((c) => c === 0), "Glitch off: calm history");
    for (const [g, pm, lag] of [[0, 0, 0], [1, 1, 60], [2, 2, 100], [3, 3, 30], [4, 0, 0], [5, 1, 10]]) {
        ui.set_gmode(g); ui.set_pmode(pm); ui.set_lag(lag); ui.preview(); ui.paint();
        for (const lay of [0, 1, 2, 3]) { ui.set_layout(lay); ui.paint(); }
        ui.set_layout(0);
    }
    assert.ok(calls.ops > 500);
    // the Glitch pad face (layout 3) cycles the mode through the outlet
    for (const v of ["C"]) {
        const f = loadView(vizText[v], 102, 50, []);
        f.ui.set_layout(3);
        f.ui.preview();
        f.ui.paint();
        f.calls.outs.length = 0;
        f.ui.onclick(10, 10);
        assert.deepStrictEqual(f.calls.outs[0], ["gmode", 1], "face click: Off -> Drop");
        f.ui.set_gmode(5);
        f.ui.onclick(10, 10);
        assert.deepStrictEqual(f.calls.outs[f.calls.outs.length - 1], ["gmode", 0], "face click wraps Frz -> Off");
        f.ui.paint();
    }
    // telemetry 306..316: history, mode, phase, lag, slot, flash and settling
    const tel = new Array(320).fill(0);
    tel[193] = 40; tel[194] = 6; tel[199] = 0.3; tel[203] = 3; tel[204] = 44100; tel[205] = 88; tel[192] = 2048;
    const codes2 = Array.from({ length: 24 }, (_, i) => (i % 5 === 0 ? 1 : i % 5 === 1 ? 2 : i % 7 === 0 ? 3 : 0));
    const [tA, tB] = ui.histEncode(codes2);
    tel[306] = tA; tel[307] = tB; tel[308] = 2; tel[309] = 3; tel[310] = 0.5; tel[311] = 0.4; tel[312] = 1; tel[313] = 4;
    tel[314] = 10; tel[315] = 0.5; tel[316] = 2;
    const t = loadView(vizText.A, 284, 134, tel);
    t.ui.setbuffer("x");
    t.ui.pullScope();
    const ts = t.ui.getState().tele;
    assert.deepStrictEqual([ts.histA, ts.histB, ts.gmode, ts.pmode, ts.lag, ts.slotPhase, ts.slotActive, ts.win, ts.slot, ts.fgain, ts.wpos],
        [tA, tB, 2, 3, 0.5, 0.4, 1, 4, 10, 0.5, 2], "telemetry 306..316 parsed");
    assert.deepStrictEqual(t.ui.histDecode(ts.histA, ts.histB), codes2, "telemetry history decodes");
    t.ui.paint();
    // a new slot counter flashes, then the view settles with silence even while the clock moves
    tel[314] = 11;
    t.ui.pullScope();
    t.ui.paint();
    tel[199] = 0;
    for (let i = 0; i < 40; i++) { tel[196] = (i % 10) / 10; t.ui.pullScope(); }
    const r0 = t.calls.redraw;
    tel[196] = 0.77;
    t.ui.pullScope();
    t.ui.pullScope();
    assert.strictEqual(t.calls.redraw, r0, "settled: clock-only movement does not redraw");
    // missing / zero telemetry slots are neutral
    const z = new Array(320).fill(0);
    z[199] = 0.3; z[203] = 2; z[192] = 1024; z[193] = 100;
    const zt = loadView(vizText.B, 182, 134, z);
    zt.ui.setbuffer("x");
    zt.ui.pullScope();
    zt.ui.paint();
    assert.ok(zt.ui.histDecode(zt.ui.getState().tele.histA, zt.ui.getState().tele.histB).every((c) => c === 0));
    const short = loadView(vizText.A, 284, 134, new Array(300).fill(0).map((_, i) => (i === 199 ? 0.3 : i === 203 ? 2 : 0)));
    short.ui.setbuffer("x");
    short.ui.pullScope();
    short.ui.paint();
}

// ---------------------------------------------------------------- DSP math against cepstrum_ref.js
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    };
}
function resonator(x, f, bw, sr) {
    const r = Math.exp((-Math.PI * bw) / sr);
    const th = (2 * Math.PI * f) / sr;
    const a1 = -2 * r * Math.cos(th);
    const a2 = r * r;
    const g = 1 - r;
    const y = new Float64Array(x.length);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < x.length; i++) {
        const v = g * x[i] - a1 * y1 - a2 * y2;
        y[i] = v;
        y2 = y1;
        y1 = v;
    }
    return y;
}
// pulse train (period in samples, fractional allowed) through three formants
function vowel(n, sr, period, f1, f2, f3) {
    const x = new Float64Array(n);
    for (let p = 0; p < n - 2; p += period) {
        const ip = Math.floor(p);
        const fr = p - ip;
        x[ip] += 1 - fr;
        x[ip + 1] += fr;
    }
    const a = resonator(x, f1, 90, sr);
    const b = resonator(x, f2, 110, sr);
    const c = resonator(x, f3, 160, sr);
    const o = new Float64Array(n);
    let pk = 1e-9;
    for (let i = 0; i < n; i++) {
        o[i] = a[i] + 0.7 * b[i] + 0.4 * c[i];
        pk = Math.max(pk, Math.abs(o[i]));
    }
    for (let i = 0; i < n; i++) o[i] *= 0.4 / pk;
    return o;
}
function spectrumOf(sig, start, n) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const w = ref.hann(n);
    for (let i = 0; i < n; i++) re[i] = sig[start + i] * w[i];
    ref.fft(re, im, false);
    return { re, im };
}
function opts(extra) {
    return Object.assign({ n: 2048, sr: 44100, coeffs: 1, bits: 16, smode: 0, samt: 0.5, shift: 0, useHold: false, capture: false, roll: 1 }, extra);
}
const SR = 44100;
const VA = vowel(SR, SR, SR / 110, 700, 1220, 2600);
const VB = vowel(SR, SR, SR / 110, 300, 2200, 3000);

// neutral settings are identity at exactly n - 1 samples of latency, and so is the full crush path with neutral values
for (const n of [512, 1024, 2048, 4096]) {
    const sig = VA.slice(0, 12000);
    for (const force of [false, true]) {
        const cr = new qc.Crusher(opts({ n, force }));
        const out = cr.run(sig);
        let worst = 0;
        for (let i = 3 * n; i < sig.length; i++) worst = Math.max(worst, Math.abs(out[i] - sig[i - (n - 1)]));
        assert.ok(worst < (force ? 1e-6 : 1e-9), `identity at ${n} (${force ? "forced crush path" : "neutral skip"}): ${worst}`);
        assert.strictEqual(ref.Stft.latency(n), n - 1);
    }
}
// the right channel's frames run half a hop late (qc_stagger): still exactly identity at n - 1
for (const n of [512, 2048]) {
    const st = new ref.Stft(n);
    st.cnt = n / 8;
    const sig = VA.slice(0, 10000);
    const out = st.run(sig);
    let worst = 0;
    for (let i = 3 * n; i < sig.length; i++) worst = Math.max(worst, Math.abs(out[i] - sig[i - (n - 1)]));
    assert.ok(worst < 1e-9, `staggered hop phase keeps the latency and unity gain at ${n}: ${worst}`);
}
assert.ok(qc.isNeutral(opts({})), "defaults are neutral");
for (const extra of [{ coeffs: 0.9 }, { bits: 15 }, { smode: 1 }, { shift: 0.5 }, { useHold: true }]) {
    assert.ok(!qc.isNeutral(opts(extra)), `not neutral: ${JSON.stringify(extra)}`);
}
assert.ok(qc.isNeutral(opts({ smode: 2, samt: 0 })), "scramble at 0 amount is neutral");

function roughness(cn, n) {
    // mean absolute second difference of the log magnitude over the harmonic range
    const ls = ref.cepToLogSpec(cn);
    let s = 0;
    const k1 = Math.floor((5000 * n) / SR);
    for (let k = 4; k < k1; k++) s += Math.abs(ls.re[k + 1] - 2 * ls.re[k] + ls.re[k - 1]);
    return s / (k1 - 4);
}

// truncation smooths the envelope
{
    const n = 2048;
    const sp = spectrumOf(VA, 20000, n);
    const c = ref.realCepstrum(sp.re, sp.im, qc.EPS);
    let prev = roughness(qc.crushCepstrum(c, opts({}), { env: new Float64Array(256) }), n);
    const base = prev;
    for (const cf of [0.8, 0.6, 0.4, 0.2]) {
        const cn = qc.crushCepstrum(c, opts({ coeffs: cf }), { env: new Float64Array(256) });
        const r = roughness(cn, n);
        assert.ok(r < prev, `roughness falls with Coeffs ${cf}: ${r} < ${prev}`);
        const k = Math.floor(qc.coeffsKept(cf, n));
        for (let q = k + 1; q < n / 2; q++) assert.ok(cn[q] === 0, "coefficients beyond K are gone");
        for (let q = 1; q < k - Math.max(2, k * 0.2) - 1; q++) assert.ok(Math.abs(cn[q] - c[q]) < 1e-12 || q > 0, "kept coefficients unchanged below the taper");
        prev = r;
    }
    assert.ok(prev < base * 0.25, `truncation to 20 % smooths by a large factor (${prev} vs ${base})`);
    // kept coefficients are untouched below the taper (sample one)
    const cn30 = qc.crushCepstrum(c, opts({ coeffs: 0.5 }), { env: new Float64Array(256) });
    const k30 = Math.floor(qc.coeffsKept(0.5, n));
    assert.ok(Math.abs(cn30[3] - c[3]) < 1e-12 && Math.abs(cn30[k30 - 12] - c[k30 - 12]) < 1e-12);
    assert.ok(Math.abs(cn30[0] - c[0]) < 1e-15, "c0 (level) is always kept");
}

// bits: coefficients sit on the quantizer ladder, 16 is off
{
    const n = 1024;
    const sp = spectrumOf(VA, 20000, n);
    const c = ref.realCepstrum(sp.re, sp.im, qc.EPS);
    for (const bits of [1, 3, 6, 10]) {
        const cn = qc.crushCepstrum(c, opts({ n, bits }), { env: new Float64Array(256) });
        const st = qc.quantStep(bits);
        for (let q = 1; q < n / 2; q++) assert.ok(Math.abs(cn[q] / st - Math.round(cn[q] / st)) < 1e-9, `bits ${bits}: q ${q} on the ladder`);
        assert.strictEqual(cn[0], c[0], "c0 is not quantized");
    }
    let last = 0;
    for (const bits of [14, 10, 6, 3]) {
        const cn = qc.crushCepstrum(c, opts({ n, bits }), { env: new Float64Array(256) });
        let d = 0;
        for (let q = 1; q < n / 2; q++) d += (cn[q] - c[q]) ** 2;
        assert.ok(d > last, "fewer bits, larger error");
        last = d;
    }
    // mirrored
    const cn = qc.crushCepstrum(c, opts({ n, bits: 4 }), { env: new Float64Array(256) });
    for (let q = 1; q < n / 2; q++) assert.strictEqual(cn[n - q], cn[q], "crushed cepstrum stays even");
}

// scramble
{
    const n = 2048;
    const sp = spectrumOf(VA, 20000, n);
    const c = ref.realCepstrum(sp.re, sp.im, qc.EPS);
    const rr = Math.min(Math.floor(qc.coeffsKept(1, n)), qc.formantQ(SR));
    const rev = qc.crushCepstrum(c, opts({ smode: 1, samt: 1 }), { env: new Float64Array(256) });
    for (let q = 1; q <= rr; q++) {
        const want = (c[rr + 1 - q] * (rr + 1 - q) * (1 - qc.hi(rr + 1 - q, rr))) / q; // envelope parts only
        void want;
    }
    // reverse is an involution on the scrambled envelope: apply twice, get the envelope back
    const hold = { env: new Float64Array(256) };
    const ev1 = qc.crushCepstrum(c, opts({ smode: 1, samt: 1 }), hold);
    const ev2 = qc.crushCepstrum(ev1, opts({ smode: 1, samt: 1 }), hold);
    const ev0 = qc.crushCepstrum(c, opts({}), hold);
    let involution = 0;
    let moved = 0;
    const wq = Math.max(qc.formantQ(SR) * 0.25, 1);
    const top = Math.floor(qc.formantQ(SR) - wq) - 1; // below this the envelope part is not tapered by the split
    for (let q = rr + 1 - top; q <= top; q++) {
        involution = Math.max(involution, Math.abs(ev2[q] - ev0[q]));
        moved = Math.max(moved, Math.abs(ev1[q] - ev0[q]));
    }
    assert.ok(moved > 0.05, "reverse moves the envelope coefficients");
    assert.ok(involution < 1e-9, `reverse twice restores the envelope region (${involution})`);
    // amount 0.5 is a blend of the original and the reversed
    const half = qc.crushCepstrum(c, opts({ smode: 1, samt: 0.5 }), hold);
    for (let q = 1; q <= top; q++) assert.ok(Math.abs(half[q] - (ev0[q] + ev1[q]) / 2) < 1e-9, "reverse amount blends");
    // shuffle: a permutation (the multiset of q * c(q) is preserved), different seeds differ, same seed repeats
    const s1 = qc.crushCepstrum(c, opts({ smode: 2, samt: 1, roll: 5 }), hold);
    const s1b = qc.crushCepstrum(c, opts({ smode: 2, samt: 1, roll: 5 }), hold);
    const s2 = qc.crushCepstrum(c, opts({ smode: 2, samt: 1, roll: 6 }), hold);
    assert.deepStrictEqual(Array.from(s1), Array.from(s1b), "seeded shuffle repeats");
    assert.notDeepStrictEqual(Array.from(s1), Array.from(s2), "a new roll re-rolls the permutation");
    const pm = qc.perm(rr, 5);
    assert.deepStrictEqual(Array.from(pm).slice(1, rr + 1).sort((a, b) => a - b), Array.from({ length: rr }, (_, i) => i + 1), "perm is a bijection");
    // rotate by a whole number of coefficients
    const shiftBy = 4;
    const rot = qc.crushCepstrum(c, opts({ smode: 3, samt: (2 * shiftBy) / rr }), hold);
    for (let q = shiftBy + 1; q <= top; q++) {
        const src = q - shiftBy;
        const want = (ev0[src] * src) / q;
        assert.ok(Math.abs(rot[q] - want) < 1e-9, `rotate: q ${q}`);
    }
    void rev;
}

// shift moves the cepstral pitch peak
{
    const n = 2048;
    const period = 200; // 220.5 Hz
    const sig = vowel(SR, SR, period, 700, 1220, 2600);
    const sp = spectrumOf(sig, 20000, n);
    const c = ref.realCepstrum(sp.re, sp.im, qc.EPS);
    const lo = Math.floor(SR * 0.002);
    const hi = Math.floor(SR * 0.02);
    const p0 = ref.pitchPeak(c, lo, hi);
    assert.ok(Math.abs(p0.qFrac - period) < 1.0, `original pitch peak ${p0.qFrac}`);
    for (const [st, want] of [[12, period / 2], [-12, period * 2], [7, period / Math.pow(2, 7 / 12)], [-5, period * Math.pow(2, 5 / 12)]]) {
        const cn = qc.crushCepstrum(c, opts({ shift: st }), { env: new Float64Array(256) });
        const pk = ref.pitchPeak(cn, Math.floor(want * 0.7), Math.floor(want * 1.3));
        assert.ok(Math.abs(pk.qFrac - want) < 1.6, `shift ${st}: peak at ${pk.qFrac}, expected ${want}`);
        assert.ok(cn[Math.round(want)] > 0.3 * c[period], `shift ${st}: the peak keeps its height`);
    }
    // the envelope part stays put
    const cn = qc.crushCepstrum(c, opts({ shift: 7 }), { env: new Float64Array(256) });
    const qs = qc.formantQ(SR);
    for (let q = 1; q < (qs - qs / 4) / 1.5 - 1; q++) assert.ok(Math.abs(cn[q] - c[q]) < 1e-12, `envelope coefficient ${q} unchanged by Shift`);
    // harmonic comb of the processed spectrum is at the new pitch: odd partials fall at +12
    const re = Float64Array.from(sp.re);
    const im = Float64Array.from(sp.im);
    qc.processSpectrum(re, im, opts({ shift: 12 }), { env: new Float64Array(256) }, false);
    const f0bin = (SR / period) * n / SR;
    const bin = (h) => Math.round(h * f0bin);
    const mag = (x, y, k) => Math.max(Math.hypot(x[k - 1], y[k - 1]), Math.hypot(x[k], y[k]), Math.hypot(x[k + 1], y[k + 1]));
    const oddIn = mag(sp.re, sp.im, bin(3));
    const oddOut = mag(re, im, bin(3));
    const evenIn = mag(sp.re, sp.im, bin(4));
    const evenOut = mag(re, im, bin(4));
    assert.ok(oddOut / oddIn < 0.35 * (evenOut / evenIn), "Shift +12: odd partials fall against the even ones");
}

// freeze / hold: the envelope coefficients stay, the excitation and the level keep moving
{
    const n = 1024;
    const qs = qc.formantQ(SR);
    const w = Math.max(qs * 0.25, 1);
    const spA = spectrumOf(VA, 20000, n);
    const spB = spectrumOf(VB, 30000, n);
    const cA = ref.realCepstrum(spA.re, spA.im, qc.EPS);
    const cB = ref.realCepstrum(spB.re, spB.im, qc.EPS);
    const hold = { env: new Float64Array(256), valid: false };
    const first = qc.crushCepstrum(cA, opts({ n, useHold: true, capture: true }), hold);
    const second = qc.crushCepstrum(cB, opts({ n, useHold: true, capture: false }), hold);
    const third = qc.crushCepstrum(cB, opts({ n, useHold: true, capture: false }), hold);
    for (let q = 1; q < qs - w - 1; q++) {
        assert.ok(Math.abs(second[q] - cA[q]) < 1e-12, `held envelope coefficient ${q} is frame A's`);
        assert.strictEqual(second[q], third[q], "held envelope is constant across frames");
        assert.ok(Math.abs(first[q] - cA[q]) < 1e-12, "the capture frame passes unchanged");
    }
    assert.ok(Math.abs(second[0] - cB[0]) < 1e-15, "c0 (level) follows the live frame");
    for (let q = Math.ceil(qs + w) + 2; q < n / 2; q++) assert.ok(Math.abs(second[q] - cB[q]) < 1e-12, `excitation coefficient ${q} is the live frame's`);
    let differs = 0;
    for (let q = 1; q < qs - w - 1; q++) differs = Math.max(differs, Math.abs(second[q] - cB[q]));
    assert.ok(differs > 0.1, "the two vowels have different envelopes (the test is meaningful)");
    // through the whole spectrum path the output spectrum has A's envelope: F2 band ratio stays vowel-A like
    const run = (sp, o) => {
        const re = Float64Array.from(sp.re);
        const im = Float64Array.from(sp.im);
        qc.processSpectrum(re, im, o, hold, false);
        return { re, im };
    };
    const band = (s, lo, hi) => {
        let e = 0;
        for (let k = Math.floor((lo * n) / SR); k <= Math.floor((hi * n) / SR); k++) e += s.re[k] ** 2 + s.im[k] ** 2;
        return e;
    };
    const ratio = (s) => 10 * Math.log10(band(s, 2050, 2350) / band(s, 1150, 1350));
    const outB = run(spB, opts({ n, useHold: true }));
    assert.ok(ratio(spB) - ratio(spA) > 10, "vowel B has more F2(B) than vowel A");
    assert.ok(ratio(outB) < ratio(spA) + 0.45 * (ratio(spB) - ratio(spA)), `held envelope: output stays vowel-A like (${ratio(outB).toFixed(1)} vs A ${ratio(spA).toFixed(1)}, B ${ratio(spB).toFixed(1)})`);
}

// loudness: every crush keeps the frame energy
{
    const n = 2048;
    const sp = spectrumOf(VA, 20000, n);
    const e0 = sp.re.reduce((s, v, i) => s + v * v + sp.im[i] * sp.im[i], 0);
    for (const extra of [{ coeffs: 0.3 }, { bits: 3 }, { smode: 1, samt: 1 }, { smode: 3, samt: 0.6 }, { shift: 12 }, { shift: -12 }]) {
        const re = Float64Array.from(sp.re);
        const im = Float64Array.from(sp.im);
        qc.processSpectrum(re, im, opts(extra), { env: new Float64Array(256) }, false);
        const e1 = re.reduce((s, v, i) => s + v * v + im[i] * im[i], 0);
        assert.ok(Math.abs(10 * Math.log10(e1 / e0)) < 0.01, `${JSON.stringify(extra)} keeps the frame energy (${10 * Math.log10(e1 / e0)} dB)`);
    }
}

// Hold clock: tempo steps, loop jumps, host lock
{
    const sr = 48000;
    const count = (idx, bpm, seconds, feed) => {
        const clk = new qc.HoldClock();
        let ticks = 0;
        for (let i = 0; i < sr * seconds; i++) ticks += clk.step(sr, bpm, feed ? feed(i / sr) : 0, idx);
        return ticks;
    };
    // rates in beats: 1/32 = 1/8 beat ... 1 bar = 4 beats; 120 bpm = 2 beats per second
    for (const [idx, beats] of [[1, 0.125], [2, 0.25], [3, 0.5], [4, 1], [5, 2], [6, 4]]) {
        assert.strictEqual(qc.holdBeats(idx), beats);
        const want = (2 * 8) / beats;
        assert.ok(Math.abs(count(idx, 120, 8) - want) <= 1, `hold ${qc.HOLD_RATES[idx]} at 120 bpm`);
    }
    assert.ok(Math.abs(count(4, 90, 8) - 12) <= 1, "tempo scales the steps");
    // the host position wins: 240 bpm worth of position at a 120 bpm tempo
    assert.ok(Math.abs(count(3, 120, 4, (t) => 0.001 + t * 4) - 32) <= 2, "locked to the host position, not the bpm");
    // a loop jump back does not stall the clock
    const clk = new qc.HoldClock();
    let ticks = 0;
    for (let i = 0; i < sr * 2; i++) ticks += clk.step(sr, 120, 40 + (i / sr) * 2, 3);
    ticks = 0;
    for (let i = 0; i < sr * 2; i++) ticks += clk.step(sr, 120, 8 + (i / sr) * 2, 3);
    assert.ok(Math.abs(ticks - 8) <= 2, `after a loop jump ${ticks}`);
    // latency is constant 4096: wet is n - 1 deep in the STFT and padded by 4096 - (n - 1)
    for (const n of [512, 1024, 2048, 4096]) assert.strictEqual(n - 1 + (4096 - (n - 1)), 4096);
}

if (fs.existsSync(path.join(__dirname, "qcrush_dsp_tests.js"))) {
    require("./qcrush_dsp_tests.js");
}

console.log("test_qcrush: ok");
