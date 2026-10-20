#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ref = require("../src/cepstrum_ref.js");
const lref = require("./lifter_ref.js");

const ROOT = path.join(__dirname, "..");
const LIB = fs.readFileSync(path.join(ROOT, "src", "cepstrum_lib.genexpr"), "utf8");
const CORE_PATH = path.join(ROOT, "src", "lifter_core.genexpr");
const UI_PATH = path.join(ROOT, "src", "lifter_ui.js");
const core = fs.readFileSync(CORE_PATH, "utf8");
const uiSrc = fs.readFileSync(UI_PATH, "utf8");
// build_lifter.py leaves cep_peak, cep_peak_conf and cep_peak_refine out of the embedded code
// (they break the Max compile next to this core); same pattern as strip_lib() there.
function stripLib(lib) {
    for (const name of ["cep_peak", "cep_peak_conf", "cep_peak_refine"]) {
        const m = new RegExp("\\n(//[^\\n]*\\n)*" + name + "\\([^\\n]*\\{\\n[\\s\\S]*?\\n\\}\\n").exec(lib);
        if (m) lib = lib.slice(0, m.index) + "\n" + lib.slice(m.index + m[0].length);
    }
    return lib;
}
const GEN = stripLib(LIB) + "\n" + core;
for (const gone of ["cep_peak(", "cep_peak_conf(", "cep_peak_refine("]) {
    assert.ok(!GEN.includes("\n" + gone), `${gone} is not embedded`);
    assert.ok(LIB.includes("\n" + gone), `${gone} still exists in the shared library`);
}
for (const kept of ["fft_init(", "fft_run(", "stft_in(", "stft_frame(", "stft_ola(", "stft_out(", "stft_win(", "cep_from_spec(", "cep_to_logmag("]) {
    assert.ok(GEN.includes("\n" + kept), `${kept} is embedded`);
}

// ------------------------------------------------------------------ gen source rules
assert.ok(!core.match(/\be\d/), "e-digits are Euler's number in GenExpr");
assert.ok(!core.match(/\bdelay\(/), "delay() is not valid GenExpr, use Delay");
const firstDecl = Math.min(...["\nParam ", "\nBuffer ", "\nData ", "\nHistory ", "\nDelay "].map((k) => GEN.indexOf(k)).filter((i) => i > 0));
for (const fn of ["lft_interp(", "lft_build(", "lft_apply(", "lft_remag(", "lft_pitch(", "lft_proc(", "lft_clear(", "lft_prep(", "lft_write(", "cep_from_spec(", "fft_run(", "stft_in("]) {
    const at = GEN.indexOf("\n" + fn);
    assert.ok(at > 0 && at < firstDecl, `${fn} must be defined before every Param/Buffer/Data/History/Delay`);
}
assert.ok(core.includes('Buffer lcurve("liftercurve");') && core.includes('Buffer lscope("lifterscope");'));
for (const name of ["sizei", "depthp", "smoothp", "wetp", "outdb", "trackp"]) {
    assert.ok(new RegExp(`Param ${name}\\(`).test(core), `Param ${name}`);
}
assert.ok(core.includes("padL.read(4096 - (n - 1))"), "constant 4096 sample latency pad");
assert.ok(core.includes("dryL.read(4096)"), "dry path delayed by the same 4096 samples");
assert.ok(core.includes("lft_proc(fx, fc, tab, csL"), "work functions are bare statements");
assert.ok(!/=\s*lft_(proc|apply|remag|build)\(/.test(core), "work function results must not be assigned (dead code removal)");
assert.ok(Math.abs(parseFloat(core.match(/\* (0\.1887\d+);/)[1]) - 1 / Math.log(200)) < 1e-12, "log axis constant is 1 / ln(200)");
assert.ok(core.includes("4.6, ndb") && lref.LIM === 4.6, "soft limit matches the reference");

// ------------------------------------------------------------------ devices
const BG = [0.052, 0.064, 0.082];
const blend = (c) => [0, 1, 2].map((i) => Math.round((c[i] * 0.38 + BG[i] * 0.62) * 1e4) / 1e4);
const expectVariants = {
    "Lifter A": { width: 448, viz: [10, 8, 316, 152] },
    "Lifter B": { width: 340, viz: [10, 8, 320, 82] },
    "Lifter C": { width: 340, viz: [10, 8, 206, 152] },
};
const paramSets = [];
const vizRects = new Set();
const widgetKinds = [];

function overlaps(a, b) {
    return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}

for (const [name, want] of Object.entries(expectVariants)) {
    const raw = fs.readFileSync(path.join(ROOT, "devices", name + ".amxd"));
    assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", `${name}: ampf header`);
    assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", `${name}: audio effect`);
    assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch");
    assert.strictEqual(32 + raw.readUInt32LE(28), raw.length, `${name}: ptch length`);
    const p = JSON.parse(raw.slice(32).toString("utf8")).patcher;

    assert.strictEqual(p.devicewidth, want.width, `${name}: width`);
    assert.deepStrictEqual(p.openrect, [0, 0, want.width, 169], `${name}: openrect height must be 169`);
    assert.strictEqual(p.openinpresentation, 1);
    assert.strictEqual(p.latency, 4096, `${name}: latency attribute`);

    const boxes = new Map(p.boxes.map((b) => [b.box.id, b.box]));
    const list = p.boxes.map((b) => b.box);

    // gen + v8ui are the source files
    assert.strictEqual(boxes.get("obj-gen").code, GEN, `${name}: gen code must equal lib + core`);
    assert.strictEqual(boxes.get("obj-viz").textfile.text, uiSrc, `${name}: v8ui script must equal src/lifter_ui.js`);
    assert.strictEqual(boxes.get("obj-gen").maxclass, "gen.codebox~");
    assert.strictEqual(boxes.get("obj-gen").numinlets, 2);

    // instance isolation and buffer binding
    assert.ok(boxes.get("obj-buf-curve").text.includes("#0-liftercurve"));
    assert.ok(boxes.get("obj-buf-scope").text.includes("#0-lifterscope"));
    assert.strictEqual(boxes.get("obj-msg-gen-curve").text, "lcurve #0-liftercurve");
    assert.strictEqual(boxes.get("obj-msg-gen-scope").text, "lscope #0-lifterscope");
    assert.strictEqual(boxes.get("obj-msg-ui-buf").text, "setbuffer #0-lifterscope #0-liftercurve");
    assert.strictEqual(boxes.get("obj-msg-ui-layout").text, "layout " + name.slice(-1).toLowerCase());
    for (const b of list) {
        if (b.maxclass === "newobj" || b.maxclass === "message") {
            if (/buffer~|send|receive|lcurve|lscope/.test(b.text || "") && !/^prepend/.test(b.text)) {
                assert.ok((b.text || "").includes("#0-"), `${name}: ${b.id} must use #0- naming`);
            }
        }
    }

    // v8ui: presentation rect, blob parameter
    const viz = boxes.get("obj-viz");
    assert.deepStrictEqual(viz.presentation_rect, want.viz, `${name}: canvas rect`);
    vizRects.add(want.viz.join(","));
    const vof = viz.saved_attribute_attributes.valueof;
    assert.strictEqual(vof.parameter_type, 3, `${name}: CurveData is a blob parameter`);
    assert.strictEqual(vof.parameter_longname, "CurveData");
    assert.strictEqual(viz.parameter_enable, 1);

    // parameters
    const live = list.filter((b) => (b.maxclass || "").startsWith("live.") && b.parameter_enable === 1);
    const byName = new Map(live.map((b) => [b.saved_attribute_attributes.valueof.parameter_longname, b]));
    paramSets.push([...byName.keys()].sort().join(","));
    widgetKinds.push([...byName.entries()].map(([k, b]) => `${k}:${b.maxclass}`).sort().join(","));
    const num = (n, lo, hi, init, unit) => {
        const b = byName.get(n);
        assert.ok(b, `${name}: missing ${n}`);
        const v = b.saved_attribute_attributes.valueof;
        assert.strictEqual(v.parameter_mmin, lo, `${name}: ${n} min`);
        assert.strictEqual(v.parameter_mmax, hi, `${name}: ${n} max`);
        assert.deepStrictEqual(v.parameter_initial, [init], `${name}: ${n} initial`);
        assert.strictEqual(v.parameter_unitstyle, unit, `${name}: ${n} unit`);
        assert.strictEqual(v.parameter_type, 0, `${name}: ${n} must be a float (never an Int above 255)`);
        return b;
    };
    num("Depth", -100, 100, 100, 5);
    num("Smooth", 0, 100, 20, 5);
    num("Mix", 0, 100, 100, 5);
    num("Output", -24, 24, 0, 4);
    const size = byName.get("Size").saved_attribute_attributes.valueof;
    assert.deepStrictEqual(size.parameter_enum, ["512", "1024", "2048", "4096"]);
    assert.deepStrictEqual(size.parameter_initial, [1]);
    assert.strictEqual(size.parameter_mmax, 3);
    assert.deepStrictEqual(byName.get("Track").saved_attribute_attributes.valueof.parameter_enum, ["Off", "On"]);
    assert.strictEqual(byName.get("Track").mode, 1, "Track is a toggle");
    assert.strictEqual(live.length, 6, `${name}: six Live parameters`);

    // pre-blended slider fills (Live paints alpha opaque)
    const accents = { Depth: [0.98, 0.74, 0.30], Smooth: [0.74, 0.58, 0.98], Mix: [0.30, 0.80, 0.96], Output: [0.76, 0.82, 0.90] };
    for (const pn of Object.keys(accents)) {
        const b = byName.get(pn);
        if (b.maxclass !== "live.numbox") continue;
        assert.ok([2, 3].includes(b.appearance));
        const c = b.activeslidercolor;
        assert.strictEqual(c[3], 1, `${name}: ${pn} slider fill is opaque`);
        assert.deepStrictEqual(c.slice(0, 3), blend(accents[pn]), `${name}: ${pn} activeslidercolor is 38 % accent + 62 % activebgcolor`);
        assert.deepStrictEqual(b.activebgcolor.slice(0, 3), BG);
    }
    for (const pn of ["Depth", "Output"]) {
        const b = byName.get(pn);
        if (b.maxclass === "live.numbox") assert.strictEqual(b.appearance, 3, `${name}: ${pn} is bipolar`);
    }

    // layout rules
    const pres = list.filter((b) => b.presentation === 1 && b.presentation_rect);
    for (const b of pres) {
        const r = b.presentation_rect;
        assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= want.width && r[1] + r[3] <= 169, `${name}: ${b.id} inside ${want.width}x169`);
    }
    const vr = viz.presentation_rect;
    const interactive = [];
    for (const b of pres) {
        if (b.id === "obj-viz" || b.maxclass === "panel") continue;
        assert.ok(!overlaps(b.presentation_rect, vr), `${name}: ${b.id} overlaps the v8ui canvas`);
        interactive.push(b);
    }
    for (let i = 0; i < interactive.length; i++) {
        for (let j = i + 1; j < interactive.length; j++) {
            assert.ok(!overlaps(interactive[i].presentation_rect, interactive[j].presentation_rect),
                `${name}: ${interactive[i].id} and ${interactive[j].id} overlap`);
        }
    }

    // background panels last and flagged
    const order = list.map((b) => b.id);
    const firstPanel = list.findIndex((b) => b.maxclass === "panel");
    for (let i = 0; i < list.length; i++) {
        if (list[i].maxclass === "panel") {
            assert.strictEqual(list[i].background, 1, `${name}: ${list[i].id} background`);
            assert.ok(i >= firstPanel);
        } else {
            assert.ok(i < firstPanel, `${name}: panels must be at the end of boxes`);
        }
    }
    assert.ok(order.indexOf("obj-panel-canvas") > order.indexOf("obj-viz"));

    // wiring: every control feeds gen and the v8ui
    const lines = new Set(p.lines.map((l) => `${l.patchline.source[0]}:${l.patchline.source[1]}->${l.patchline.destination[0]}:${l.patchline.destination[1]}`));
    for (const [id, prep] of [["depth", "depthp"], ["smooth", "smoothp"], ["mix", "wetp"], ["out", "outdb"], ["size", "sizei"], ["track", "trackp"]]) {
        assert.strictEqual(boxes.get(`obj-prep-${id}`).text, `prepend ${prep}`);
        for (const l of [`obj-${id}:0->obj-prep-${id}:0`, `obj-prep-${id}:0->obj-gen:0`, `obj-${id}:0->obj-ui-${id}:0`, `obj-ui-${id}:0->obj-viz:0`]) {
            assert.ok(lines.has(l), `${name}: missing ${l}`);
        }
    }
    for (const l of ["obj-plugin:0->obj-gen:0", "obj-plugin:1->obj-gen:1", "obj-gen:0->obj-plugout:0", "obj-gen:1->obj-plugout:1",
        "obj-msg-gen-curve:0->obj-gen:0", "obj-msg-gen-scope:0->obj-gen:0", "obj-msg-ui-buf:0->obj-viz:0", "obj-msg-ui-layout:0->obj-viz:0"]) {
        assert.ok(lines.has(l), `${name}: missing ${l}`);
    }
}
assert.strictEqual(new Set(paramSets).size, 1, "all three variants expose the same parameter set");
assert.strictEqual(vizRects.size, 3, "the three canvases differ");
assert.strictEqual(new Set(widgetKinds).size, 3, "the three variants use different widget mixes");

// ------------------------------------------------------------------ v8ui
function makeUi(size) {
    const cmds = [];
    const log = { notify: 0, redraw: 0, pokes: [], outlets: [] };
    const mg = {
        size, relative_coords: 1, autofill: 1,
        init() {}, redraw() { log.redraw++; },
        set_source_rgba() { cmds.push("rgba"); }, set_line_width() {},
        rectangle(x, y, w, h) { cmds.push(["rect", x, y, w, h]); },
        rectangle_rounded(x, y, w, h) { cmds.push(["rrect", x, y, w, h]); },
        arc(x, y, r) { cmds.push(["arc", x, y, r]); },
        move_to(x, y) { cmds.push(["pt", x, y]); }, line_to(x, y) { cmds.push(["pt", x, y]); },
        curve_to() {}, close_path() {}, fill() {}, stroke() {},
        select_font_face() {}, set_font_size() {}, show_text() { cmds.push("text"); },
    };
    const scope = { data: new Array(512).fill(0) };
    function Buffer(name) {
        this.name = name;
        this.peek = (ch, from, n) => (name.includes("scope") ? scope.data.slice(from, from + n) : []);
        this.poke = (ch, from, vals) => { log.pokes.push([name, vals.slice()]); };
    }
    let task = null;
    function Task(fn) {
        this.fn = fn;
        this.interval = 0;
        this.repeat = () => { task = this; };
        this.cancel = () => { task = null; };
    }
    const names = "paint, preview, layout, setbuffer, onclick, ondrag, ondblclick, onidle, onidleout, getvalueof, setvalueof, undo, redo, curveTable, curveAt, applyPreset, applyMacro, set_depth, set_size, set_track, pullScope, fillDemo, getLayout, knotHit, plotX, plotY, sameKnots, activePreset, sanitizeKnots";
    const fn = new Function(
        "mgraphics", "inlets", "outlets", "outlet", "notifyclients", "Buffer", "Task",
        uiSrc + `\nreturn { ${names}, getKnots: () => knots, setKnots: (k) => { knots = k; }, getUndo: () => undoStack.length, isDemo: () => demo, isSettled: () => settled, getBellW: () => bellW };`
    );
    const ui = fn(mg, 1, 1, (i, m) => log.outlets.push([i, m]), () => { log.notify++; }, Buffer, Task);
    ui.cmds = cmds;
    ui.log = log;
    ui.scope = scope;
    ui.mg = mg;
    ui.tick = () => task && task.fn();
    ui.hasTask = () => !!task;
    return ui;
}

const SIZES = { a: [316, 152], b: [320, 82], c: [206, 152] };
for (const [m, size] of Object.entries(SIZES)) {
    for (const viaMessage of [false, true]) {
        const ui = makeUi(size);
        assert.strictEqual(ui.mg.relative_coords, 0, "relative_coords must be 0 at load");
        assert.strictEqual(ui.mg.autofill, 0, "autofill must be 0 at load");
        if (viaMessage) ui.layout(m);
        ui.preview();
        ui.cmds.length = 0;
        ui.paint();
        assert.ok(ui.cmds.length > 100, `${m}: paint draws`);
        for (const c of ui.cmds) {
            if (!Array.isArray(c)) continue;
            for (const v of c.slice(1)) assert.ok(Number.isFinite(v), `${m}: finite coordinates`);
            if (c[0] === "pt") {
                assert.ok(c[1] >= -2 && c[1] <= size[0] + 2 && c[2] >= -2 && c[2] <= size[1] + 2, `${m}: point ${c[1]},${c[2]} inside the canvas`);
            }
        }
        const L = ui.getLayout();
        assert.strictEqual(L.mode, m, `layout ${m} (message ${viaMessage})`);
        assert.ok(L.plot[1] + L.plot[3] <= size[1] && L.tool[1] + L.tool[3] <= size[1], `${m}: regions inside the canvas`);
    }
}

// curve model and presets
{
    const ui = makeUi(SIZES.a);
    const t = ui.curveTable();
    assert.strictEqual(t.length, 256);
    ui.applyPreset("flat");
    assert.ok(ui.curveTable().every((v) => v === 0), "flat preset is 0 dB everywhere");
    ui.applyPreset("whisper");
    const w = ui.curveTable();
    const xAt = (ms) => Math.log(ms / 0.2) / Math.log(200);
    assert.ok(w[Math.round(xAt(5) * 255)] <= -23.9, "whisper cuts the pitch region by 24 dB");
    assert.ok(w[Math.round(xAt(0.3) * 255)] === 0 && w[255] === 0, "whisper keeps the envelope and the far end");
    ui.applyPreset("robot");
    assert.ok(ui.curveTable()[Math.round(xAt(5) * 255)] >= 17.9, "robot boosts the pitch peak");
    ui.applyPreset("body");
    assert.ok(ui.curveTable()[Math.round(xAt(20) * 255)] <= -23.9 && ui.curveTable()[0] === 0);
    ui.applyPreset("comb");
    assert.ok(ui.curveTable().some((v) => v > 8) && ui.curveTable().some((v) => v < -8));
    for (const name of ["flat", "whisper", "robot", "body", "comb"]) {
        ui.applyPreset(name);
        assert.strictEqual(ui.activePreset(), name);
        for (const v of ui.curveTable()) assert.ok(v >= -24 && v <= 24);
    }
}

// serialization versioning
{
    const ui = makeUi(SIZES.a);
    ui.applyPreset("robot");
    const s = ui.getvalueof();
    assert.strictEqual(s[0], 2, "getvalueof is versioned (first element)");
    assert.strictEqual(s.length, 3 + 2 * s[2]);
    const ui2 = makeUi(SIZES.a);
    ui2.setvalueof(s);
    assert.ok(ui2.sameKnots(ui2.getKnots(), ui.getKnots()), "round trip keeps the curve");
    assert.strictEqual(ui2.getBellW(), s[1]);
    // v1: [1, n, x0, y0, ...] still loads
    const ui3 = makeUi(SIZES.a);
    ui3.setvalueof(1, 3, 0, 0, 0.5, -12, 1, 6);
    assert.deepStrictEqual(ui3.getKnots(), [[0, 0], [0.5, -12], [1, 6]]);
    // unknown versions and junk are ignored; bad numbers are clamped and sorted
    const before = JSON.stringify(ui3.getKnots());
    ui3.setvalueof(9, 2, 0, 0, 1, 0);
    ui3.setvalueof("junk");
    ui3.setvalueof(2, 0.1, 1, 0.5, 0);
    assert.strictEqual(JSON.stringify(ui3.getKnots()), before, "unknown or truncated state leaves the curve alone");
    ui3.setvalueof([2, 0.2, 3, 1, 99, 0, -99, 0.5, 5]);
    const k = ui3.getKnots();
    assert.deepStrictEqual(k.map((p) => p[0]), [0, 0.5, 1]);
    assert.deepStrictEqual(k.map((p) => p[1]), [-24, 5, 24], "values clamp to +-24 dB and knots sort by x");
}

// editing: undo once per gesture, notify at the end, add / delete points
{
    const ui = makeUi(SIZES.a);
    ui.setbuffer("scopeBuf", "curveBuf");
    ui.applyPreset("flat");
    const L = ui.getLayout();
    const u0 = ui.getUndo();
    const n0 = ui.log.notify;
    const kx = ui.plotX(L, ui.getKnots()[1][0]);
    const ky = ui.plotY(L, ui.getKnots()[1][1]);
    ui.onclick(kx, ky);
    assert.strictEqual(ui.getUndo(), u0 + 1, "one undo state at gesture start");
    for (let i = 0; i < 10; i++) ui.ondrag(kx - 2 * i, ky + 4 * i, 1);
    assert.strictEqual(ui.getUndo(), u0 + 1, "no undo state per drag frame");
    assert.strictEqual(ui.log.notify, n0, "no notifyclients mid gesture");
    ui.ondrag(kx - 20, ky + 40, 0);
    assert.strictEqual(ui.log.notify, n0 + 1, "notifyclients at gesture end");
    assert.ok(ui.getKnots()[1][1] < 0 || ui.getKnots()[0][1] < 0, "the dragged point moved");
    const pokes = ui.log.pokes.filter((p) => p[0] === "curveBuf");
    assert.ok(pokes.length > 5 && pokes[pokes.length - 1][1].length === 256, "curve is written to the buffer");
    ui.undo();
    assert.ok(ui.curveTable().every((v) => v === 0), "undo restores the flat curve");
    ui.redo();
    assert.ok(ui.curveTable().some((v) => v !== 0), "redo restores the edit");

    ui.applyPreset("flat");
    const count = ui.getKnots().length;
    ui.ondblclick(ui.plotX(L, 0.5), ui.plotY(L, 10));
    assert.strictEqual(ui.getKnots().length, count + 1, "double-click on empty space adds a point");
    const added = ui.getKnots().findIndex((p) => Math.abs(p[0] - 0.5) < 0.02);
    assert.ok(added > 0 && Math.abs(ui.getKnots()[added][1] - 10) < 1);
    ui.ondblclick(ui.plotX(L, ui.getKnots()[added][0]), ui.plotY(L, ui.getKnots()[added][1]));
    assert.strictEqual(ui.getKnots().length, count, "double-click on a point deletes it");
    ui.ondblclick(ui.plotX(L, ui.getKnots()[0][0]), ui.plotY(L, ui.getKnots()[0][1]));
    ui.ondblclick(ui.plotX(L, ui.getKnots()[0][0]), ui.plotY(L, ui.getKnots()[0][1]));
    assert.ok(ui.getKnots().length >= 2, "a curve always keeps two points");

    // toolbar buttons
    const T = L.tool;
    ui.onclick(T[0] + 3 * 22 + 11, T[1] + 8); // whisper
    assert.strictEqual(ui.activePreset(), "whisper");
    ui.onclick(T[0] + 0 * 22 + 11, T[1] + 8); // undo
    assert.notStrictEqual(ui.activePreset(), "whisper");
}

// layout C: XY bell macro
{
    const ui = makeUi(SIZES.c);
    ui.layout("c");
    const L = ui.getLayout();
    const u0 = ui.getUndo();
    ui.onclick(ui.plotX(L, 0.6), ui.plotY(L, 15));
    ui.ondrag(ui.plotX(L, 0.65), ui.plotY(L, 12), 1);
    assert.strictEqual(ui.getUndo(), u0 + 1);
    const t = ui.curveTable();
    assert.ok(Math.max(...t) > 11 && Math.min(...t) >= -0.001, "the pad draws a bell");
    assert.ok(t[0] === 0 && t[255] === 0, "the bell leaves the ends alone");
    const n = ui.log.notify;
    ui.ondrag(0, 0, 0);
    assert.strictEqual(ui.log.notify, n + 1);
}

// telemetry: demo only before the first real telemetry, idle skipping
{
    const ui = makeUi(SIZES.a);
    ui.setbuffer("scopeBuf", "curveBuf");
    assert.ok(ui.hasTask(), "telemetry task runs");
    assert.ok(ui.isDemo(), "demo shows before telemetry");
    ui.tick();
    assert.ok(ui.isDemo(), "an unwritten scope buffer (sr = 0) keeps the demo");
    const d = ui.scope.data;
    d[389] = 44100; d[390] = 1024; d[386] = 1; d[385] = 0.9; d[384] = 220.5; d[387] = 0.3; d[388] = 0.2; d[392] = 0;
    for (let i = 0; i < 128; i++) d[i] = i === 40 ? 0.8 : 0.02;
    for (let i = 256; i < 384; i++) d[i] = -999;
    for (let i = 0; i < 64; i += 3) d[256 + i] = -30;
    ui.tick();
    assert.ok(!ui.isDemo(), "real telemetry replaces the demo");
    let r0 = ui.log.redraw;
    ui.tick();
    assert.strictEqual(ui.log.redraw, r0, "same hop counter: no redraw");
    d[386] = 2;
    ui.tick();
    assert.ok(ui.log.redraw > r0, "new hop: redraw");
    d[392] = 1; d[387] = 0; d[388] = 0;
    for (let i = 0; i < 80; i++) ui.tick();
    assert.ok(ui.isSettled(), "silence settles");
    r0 = ui.log.redraw;
    for (let i = 0; i < 10; i++) ui.tick();
    assert.strictEqual(ui.log.redraw, r0, "no redraws while silent and settled");
    d[392] = 0; d[386] = 3; d[387] = 0.4;
    ui.tick();
    assert.ok(!ui.isSettled() && ui.log.redraw > r0, "sound wakes the display");
    ui.cmds.length = 0;
    ui.paint();
    assert.ok(ui.cmds.length > 50);
}

// ------------------------------------------------------------------ DSP maths against cepstrum_ref.js
const sr = 44100;
function saw(len, f0, amp) {
    const x = new Float64Array(len);
    let ph = 0;
    for (let i = 0; i < len; i++) {
        ph += f0 / sr;
        ph -= Math.floor(ph);
        x[i] = amp * (ph * 2 - 1);
    }
    return x;
}
function noiseSine(len) {
    let s = 7;
    const x = new Float64Array(len);
    for (let i = 0; i < len; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        x[i] = 0.2 * (s / 2147483648 - 1) + 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr);
    }
    return x;
}
const tableOf = (name) => {
    const ui = makeUi(SIZES.a);
    ui.applyPreset(name);
    return ui.curveTable();
};
const FLAT = tableOf("flat");
const WHISPER = tableOf("whisper");
const ROBOT = tableOf("robot");

// a flat curve at 0 dB is the identity at every Size and Smooth, delayed N - 1 samples
for (const n of [512, 1024, 2048, 4096]) {
    for (const smooth of [0, 1]) {
        const x = noiseSine(n * 12);
        const L = lref.makeLifter(n, sr, FLAT, { depth: 1, smooth });
        const y = L.stft.run(x);
        let err = 0;
        for (let t = n * 6; t < x.length; t++) err = Math.max(err, Math.abs(y[t] - x[t - (n - 1)]));
        assert.ok(err < 1e-9, `flat curve identity at N=${n}, smooth ${smooth}: max error ${err}`);
    }
}
// Depth 0 is the identity for any curve
{
    const n = 2048;
    const x = saw(n * 10, 200, 0.25);
    const y = lref.makeLifter(n, sr, WHISPER, { depth: 0 }).stft.run(x);
    let err = 0;
    for (let t = n * 5; t < x.length; t++) err = Math.max(err, Math.abs(y[t] - x[t - (n - 1)]));
    assert.ok(err < 1e-9, `depth 0 identity: ${err}`);
}

// a pitch-region cut lowers the harmonic peak-to-valley ratio; Depth < 0 inverts the curve
{
    const x = saw(sr, 200, 0.25);
    for (const n of [1024, 2048, 4096]) {
        const dry = lref.peakToValley(x, 16384, 16384, 200, sr);
        const flat = lref.peakToValley(lref.makeLifter(n, sr, FLAT, {}).stft.run(x), 16384 + n, 16384, 200, sr);
        const whisper = lref.peakToValley(lref.makeLifter(n, sr, WHISPER, {}).stft.run(x), 16384 + n, 16384, 200, sr);
        const inverted = lref.peakToValley(lref.makeLifter(n, sr, WHISPER, { depth: -1 }).stft.run(x), 16384 + n, 16384, 200, sr);
        assert.ok(Math.abs(flat - dry) < 0.01, `N=${n}: flat keeps the ratio`);
        assert.ok(dry - whisper > 8, `N=${n}: whisper lowers peak-to-valley by ${(dry - whisper).toFixed(1)} dB (need 8)`);
        assert.ok(inverted > whisper + 6, `N=${n}: negative Depth inverts the cut (${inverted.toFixed(1)} vs ${whisper.toFixed(1)})`);
    }
}

// pitch peak of the sawtooth, with the octave check
{
    for (const n of [1024, 2048, 4096]) {
        const L = lref.makeLifter(n, sr, FLAT, {});
        L.stft.run(saw(n * 10, 200, 0.25));
        const q = L.state.pitch[L.state.pitch.length - 1];
        assert.ok(Math.abs(sr / q - 200) < 1.5, `N=${n}: pitch ${(sr / q).toFixed(2)} Hz`);
        assert.ok(L.state.conf[L.state.conf.length - 1] > 0.5);
    }
}

// Track: scaling q by qref / q_pitch moves the curve with the pitch
{
    const n = 4096;
    const qref = sr * 0.005;
    const g0 = lref.gainTable(ROBOT, n, sr, 1, 1);
    for (const qp of [qref * 0.5, qref * 2]) {
        const g = lref.gainTable(ROBOT, n, sr, qref / qp, 1);
        // the tracked table at q = qp equals the untracked table at the marker q = qref
        assert.ok(Math.abs(g[Math.round(qp)] - g0[Math.round(qref)]) < 0.02 * g0[Math.round(qref)], "pitch lands on the marker");
    }
    // robot boosts +18 dB at the marker and leaves low quefrency alone
    assert.ok(Math.abs(20 * Math.log10(g0[Math.round(qref)]) - 18) < 0.2);
    assert.ok(Math.abs(g0[3] - 1) < 1e-6);
}

// the log axis: 0.2 ms .. 40 ms whatever the Size
{
    const n = 2048;
    const g = lref.gainTable(Float64Array.from({ length: 256 }, (_, i) => i / 255 * 20), n, sr, 1, 1);
    const q = Math.round(sr * 0.0063); // 6.3 ms -> x = 0.65
    const want = 0.65 * 20;
    assert.ok(Math.abs(20 * Math.log10(g[q]) - want) < 0.4, "x = ln(q / (sr 0.2 ms)) / ln(200)");
}

console.log("test_lifter: ok");
