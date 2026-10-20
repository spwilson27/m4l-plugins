#!/usr/bin/env node
/**
 * Verification suite for devices/Envelope Trigger.amxd (169 px tall, 228 px collapsed / 342 px open).
 *
 * Covers:
 *  1. Shared math: onset ratio, velocity map, plot mapping, note names, LOM value parsing
 *     (including v8 Max Dict callbacks), "MIDI To" menu ranges, and device widths
 *  2. GenExpr ordering & lexer safety (Buffer -> Param -> History before expressions, no e<digit>)
 *  3. .amxd binary header ("aaaa" Audio Effect), presentation geometry, no overlaps, panel z-order
 *  4. #0- instance isolation and `scope #0-trigscope` loadbang binding
 *  5. MIDI out graph: gate -> edge~ -> t b b -> snapshot~ velocity / note -> makenote -> pack
 *     -> midiformat -> midiout, plus channel & length inlets
 *  6. Native-style routing: hidden live.menus, live.thisdevice -> init_routing, settype / setchannel
 *  7. Collapsible MIDI To panel: strip -> Toggle live.text -> setwidth / hidden / strip face, with
 *     live.thisdevice re-applying the saved state through an `i` store, plus the envtrig-test hook
 *     (end-to-end: scripts/run_envtrig_ui_tests.py in Max, scripts/test_envtrig_live.js in Live)
 *  8. v8ui runtime: pixel coords, fire detection, threshold drag, mocked LOM routing, idle
 *     suppression, and the strip's click toggle
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const GEN_PATH = path.join(ROOT, "src", "envtrig_core.genexpr");
const STRIP_PATH = path.join(ROOT, "src", "envtrig_strip.js");
const cfg = require(path.join(ROOT, "src", "envtrig_config.js"));

// 1. Shared math
assert.ok(Math.abs(cfg.onsetRatio(1) - 1) < 1e-9, "Sens 100% must need no jump above the baseline");
assert.ok(Math.abs(cfg.linToDb(cfg.onsetRatio(0)) - 12) < 1e-6, "Sens 0% must need a 12 dB jump");
assert.strictEqual(cfg.velocityFromPeak(cfg.dbToLin(-24), -24, 40, 127), 40, "Hit at threshold maps to Vel Lo");
assert.strictEqual(cfg.velocityFromPeak(1.0, -24, 40, 127), 127, "0 dBFS hit maps to Vel Hi");
const midVel = cfg.velocityFromPeak(cfg.dbToLin(-12), -24, 1, 127);
assert.ok(midVel > 60 && midVel < 68, `Half-way hit should land mid-range, got ${midVel}`);
assert.strictEqual(cfg.velocityFromPeak(1.0, -24, 100, 20), 100, "Vel Hi below Vel Lo collapses to Vel Lo");
assert.strictEqual(cfg.noteName(36), "C1", "Note 36 is C1 in Live naming");
assert.strictEqual(cfg.noteName(60), "C3", "Note 60 is C3");
assert.ok(Math.abs(cfg.plot01ToDb(cfg.dbToPlot01(-30)) + 30) < 1e-9, "Plot mapping must round-trip");
assert.strictEqual(cfg.WIDTH_COLLAPSED, 228, "Collapsed width");
assert.strictEqual(cfg.WIDTH_EXPANDED, 342, "Expanded width");
assert.ok(cfg.SCOPE_RING_OFFSET + cfg.SCOPE_BLOCKS * 3 <= cfg.SCOPE_BUFFER_SAMPS, "Oscilloscope ring must fit in the scope buffer");

const types = [{ display_name: "1-Drums", identifier: 1 }, { display_name: "2-Bass", identifier: 2 }, { display_name: "No Output", identifier: 0 }];
assert.deepStrictEqual(cfg.lomValue(["available_routing_types", JSON.stringify({ available_routing_types: types })], "available_routing_types"), types, "lomValue must parse JSON string callbacks");
assert.deepStrictEqual(cfg.lomValue(["available_routing_types", { available_routing_types: types }], "available_routing_types"), types, "lomValue must accept parsed dict callbacks");
assert.deepStrictEqual(cfg.lomValue(JSON.stringify({ routing_type: types[0] }), "routing_type"), types[0], "lomValue must parse get() strings");
assert.strictEqual(cfg.lomValue(["id", 5], "routing_type"), null, "lomValue must ignore id callbacks");
// v8 observers pass a Max Dict handle, not data (regression: menus never filled in Live)
const maxDict = { name: "u095004770", quiet: 0, stringify: () => JSON.stringify({ available_routing_types: types }) };
assert.deepStrictEqual(cfg.lomValue(["available_routing_types", maxDict], "available_routing_types"), types, "lomValue must read v8 Dict callbacks");
assert.deepStrictEqual(cfg.lomValue([JSON.stringify({ routing_type: types[0] })], "routing_type"), types[0], "lomValue must parse v8 get() arrays");
assert.deepStrictEqual(cfg.routingTypeRange(types), ["1-Drums", "2-Bass", "No Output"]);
assert.deepStrictEqual(cfg.routingTypeRange([]), ["No Output", "-"]);
assert.deepStrictEqual(cfg.routingChannelState([]), { range: ["-", "-"], active: 0 });
assert.deepStrictEqual(cfg.routingChannelState([{ display_name: "Track In" }]), { range: ["Track In", "-"], active: 0 });
assert.strictEqual(cfg.routingChannelState([{ display_name: "Track In" }, { display_name: "1-Drum Rack" }]).active, 1);

// 2. GenExpr ordering & lexer checks
const gen = fs.readFileSync(GEN_PATH, "utf8");
assert.ok(!gen.match(/\be\d/), "Never use e0..e9 identifiers in GenExpr (parsed as Euler's constant)");
assert.ok(!/^Param hold\(/m.test(gen), "Never name a Param `hold`");
const bufAt = gen.indexOf("\nBuffer ");
const paramAt = gen.indexOf("\nParam ");
const histAt = gen.indexOf("\nHistory ");
const exprAt = gen.indexOf("\nsr = max(samplerate, 1);");
assert.ok(bufAt >= 0 && bufAt < paramAt && paramAt < histAt && histAt < exprAt, "Declarations must follow Buffer -> Param -> History order before expressions");
for (const p of ["thr", "sens", "holdms", "velmin", "velmax"]) {
    assert.ok(new RegExp(`^Param ${p}\\(`, "m").test(gen), `GenExpr must declare Param ${p}`);
}
for (const gone of ["mode", "thr1", "xlo", "xhi"]) {
    assert.ok(!new RegExp(`^Param ${gone}\\(`, "m").test(gen), `Single-band core must not declare Param ${gone}`);
}
assert.ok(/^out4 = vel;/m.test(gen) && !/^out5/m.test(gen), "GenExpr must expose 4 outlets (2 audio, gate, velocity)");
assert.ok(gen.includes("out1 = fixnan(in1);") && gen.includes("out2 = fixnan(in2);"), "Audio must pass through untouched");
assert.ok(gen.includes("base = 32 + head * 3;") && gen.includes("poke(scope, head, 6, 0);") && gen.includes("head = wrap(head + 1, 0, 256);"), "GenExpr must write the 256-block oscilloscope ring and its head");
assert.ok(gen.includes("blkFire = (blkCount == 0) ? onsetNow : max(blkFire, onsetNow);"), "Scope ticks are flagged at the onset");

function rectsOverlap(a, b) {
    return !(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]);
}

function makeMg(w, h, drawOps) {
    let pt = [0, 0];
    return {
        size: [w, h],
        segs: [],
        init() {}, redraw() { drawOps.push("redraw"); },
        set_source_rgba() {}, set_line_width() {}, rectangle() {}, arc() {},
        move_to(x, y) { pt = [x, y]; },
        line_to(x, y) { this.segs.push([pt[0], pt[1], x, y]); pt = [x, y]; },
        close_path() {}, fill() {}, stroke() {}, select_font_face() {}, set_font_size() {},
        save() {}, restore() {}, translate() {}, rotate() {},
        show_text(t) { drawOps.push("text:" + t); },
    };
}

const raw = fs.readFileSync(path.join(ROOT, "devices", "Envelope Trigger.amxd"));
assert.strictEqual(raw.slice(0, 4).toString("ascii"), "ampf", "Expected ampf header");
assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", "Expected aaaa audio-effect type");
assert.strictEqual(raw.slice(24, 28).toString("ascii"), "ptch", "Expected ptch chunk");
assert.strictEqual(raw.readUInt32LE(28), raw.length - 32, "Payload length mismatch");

const patcher = JSON.parse(raw.slice(32).toString("utf8")).patcher;
assert.strictEqual(patcher.openinpresentation, 1, "Must open in presentation mode");
assert.strictEqual(patcher.devicewidth, cfg.WIDTH_COLLAPSED, "Device starts collapsed");
assert.strictEqual(patcher.openrect[2], cfg.WIDTH_COLLAPSED, "openrect width matches the collapsed device");
assert.strictEqual(patcher.openrect[3], 169.0, "Expected height 169");

const boxes = patcher.boxes.map((b) => b.box);
const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
const lines = patcher.lines.map((l) => l.patchline);
const hasLine = (s, d, outlet, inlet) => lines.some(
    (l) => l.source[0] === s && l.destination[0] === d &&
        (outlet === undefined || l.source[1] === outlet) && (inlet === undefined || l.destination[1] === inlet)
);

for (const l of lines) {
    assert.ok(byId[l.source[0]], `Patchline from missing box ${l.source[0]}`);
    assert.ok(byId[l.destination[0]], `Patchline to missing box ${l.destination[0]}`);
    assert.ok(l.source[1] < byId[l.source[0]].numoutlets, `Bad outlet ${l.source[1]} on ${l.source[0]}`);
    assert.ok(l.destination[1] < byId[l.destination[0]].numinlets, `Bad inlet ${l.destination[1]} on ${l.destination[0]}`);
}

// No title bar, no band controls
assert.ok(!byId["obj-title"], "The device must not draw its own title");
for (const gone of ["obj-mode", "obj-ctrl-thr1", "obj-ctrl-xlo", "obj-ctrl-note1"]) assert.ok(!byId[gone], `Band control ${gone} must be gone`);

// 4. Core objects, buffer isolation & bindings
assert.strictEqual(byId["obj-gen"].code, gen, "Embedded GenExpr mismatch");
assert.strictEqual(byId["obj-gen"].numoutlets, 4, "gen.codebox~ needs 4 outlets");
for (const b of boxes) {
    if (b.text && b.text.startsWith("buffer~")) assert.ok(b.text.includes("#0-"), `buffer~ must use #0- prefix: ${b.text}`);
}
assert.strictEqual(byId["obj-msg-gen-buf"].text, "scope #0-trigscope");
assert.strictEqual(byId["obj-scope"].text, `buffer~ #0-trigscope @samps ${cfg.SCOPE_BUFFER_SAMPS}`, "Scope buffer holds the header plus the 256-block oscilloscope ring");
assert.ok(gen.includes(`base = ${cfg.SCOPE_RING_OFFSET} + head * 3;`) && gen.includes(`head = wrap(head + 1, 0, ${cfg.SCOPE_BLOCKS});`), "GenExpr ring layout must match envtrig_config.js");
assert.ok(/if \(thr != cacheThr\)/.test(gen) && /if \(sens != cacheSens\)/.test(gen) && /if \(sr != cacheSr\)/.test(gen), "pow/exp coefficients must be cached, not recomputed every sample");
assert.ok(hasLine("obj-loadbang", "obj-msg-gen-buf") && hasLine("obj-msg-gen-buf", "obj-gen"), "Missing scope bind wiring");
assert.ok(hasLine("obj-loadbang", "obj-msg-ui-buf") && hasLine("obj-msg-ui-buf", "obj-viz"), "Missing setbuffer wiring");
assert.ok(hasLine("obj-plugin", "obj-gen", 0, 0) && hasLine("obj-plugin", "obj-gen", 1, 1), "plugin~ must feed gen");
assert.ok(hasLine("obj-gen", "obj-plugout", 0, 0) && hasLine("obj-gen", "obj-plugout", 1, 1), "gen must feed plugout~");

const genParams = [["thr", false, "thr"], ["sens", true, "sens"], ["hold", false, "holdms"], ["velmin", false, "velmin"], ["velmax", false, "velmax"]];
for (const [key, isPct, genName] of genParams) {
    const ctrl = byId[`obj-ctrl-${key}`];
    const prep = byId[`obj-prep-${key}`];
    assert.ok(ctrl && prep && prep.text === `prepend ${genName}`, `Missing control chain for ${key}`);
    assert.ok(hasLine(prep.id, "obj-gen"), `${prep.id} not wired to gen`);
    if (isPct) assert.ok(hasLine(ctrl.id, `obj-scale-${key}`) && hasLine(`obj-scale-${key}`, prep.id), `${key} must scale by / 100.`);
    else assert.ok(hasLine(ctrl.id, prep.id), `${ctrl.id} not wired to ${prep.id}`);
}

// 3. Layout: detection dials sit under the graph; panel widgets live in the expanded area
const viz = byId["obj-viz"];
const vr = viz.presentation_rect;
for (const key of ["thr", "sens", "hold"]) {
    const d = byId[`obj-ctrl-${key}`];
    assert.strictEqual(d.maxclass, "live.dial", `${key} is a dial`);
    assert.ok(d.presentation_rect[1] >= vr[1] + vr[3], `${key} dial must sit under the graph`);
    assert.ok(d.presentation_rect[0] >= vr[0] && d.presentation_rect[0] + d.presentation_rect[2] <= vr[0] + vr[2], `${key} dial must sit within the graph's width`);
}
const strip = byId["obj-strip"];
assert.strictEqual(strip.maxclass, "v8ui");
assert.ok(strip.presentation_rect[0] + strip.presentation_rect[2] <= cfg.WIDTH_COLLAPSED, "Strip must be visible when collapsed");
const panelIds = boxes.filter((b) => b.presentation === 1 && b.presentation_rect[0] >= cfg.WIDTH_COLLAPSED).map((b) => b.id);
for (const id of ["obj-route-type", "obj-route-chan", "obj-ctrl-note", "obj-ctrl-chan", "obj-ctrl-len", "obj-ctrl-velmin", "obj-ctrl-velmax", "obj-panel-midi"]) {
    assert.ok(panelIds.includes(id), `${id} must live in the expandable panel`);
}
for (const id of panelIds) {
    assert.strictEqual(byId[id].hidden, 1, `${id} must start hidden (collapsed)`);
    assert.ok(hasLine("obj-prep-hidden", id), `${id} must receive hidden from the panel toggle`);
}

const interactive = boxes.filter((b) => b.presentation === 1 && b.maxclass.startsWith("live.") && b.maxclass !== "live.comment");
const canvases = [vr, strip.presentation_rect];
for (const w of interactive) {
    for (const c of canvases) assert.ok(!rectsOverlap(c, w.presentation_rect), `v8ui overlaps ${w.id}`);
}
for (let i = 0; i < interactive.length; i++) {
    for (let j = i + 1; j < interactive.length; j++) {
        assert.ok(!rectsOverlap(interactive[i].presentation_rect, interactive[j].presentation_rect), `${interactive[i].id} overlaps ${interactive[j].id}`);
    }
}
for (const b of boxes) {
    if (b.presentation === 1 && b.presentation_rect) {
        const r = b.presentation_rect;
        assert.ok(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= cfg.WIDTH_EXPANDED && r[1] + r[3] <= 169, `${b.id} outside ${cfg.WIDTH_EXPANDED}x169`);
    }
}
const panelIdx = boxes.map((b, i) => (b.maxclass === "panel" ? i : -1)).filter((i) => i >= 0);
const maxWidgetIdx = Math.max(...boxes.map((b, i) => (b.maxclass !== "panel" ? i : -1)));
assert.strictEqual(panelIdx.length, 2, "Expected main + MIDI To background panels");
for (const pi of panelIdx) {
    assert.strictEqual(boxes[pi].background, 1, "Panels must set background: 1");
    assert.ok(pi > maxWidgetIdx, "Panels must appear after all widgets");
}

// 5. MIDI out graph
assert.ok(hasLine("obj-gen", "obj-edge", 2, 0), "gen gate -> edge~");
assert.ok(hasLine("obj-gen", "obj-snap", 3, 0), "gen velocity -> snapshot~");
assert.ok(hasLine("obj-edge", "obj-trig", 0, 0), "edge~ rising -> t b b");
assert.ok(hasLine("obj-trig", "obj-snap", 1, 0), "t b b right (first) must sample velocity");
assert.ok(hasLine("obj-trig", "obj-note", 0, 0), "t b b left (second) must output the note");
assert.ok(hasLine("obj-snap", "obj-makenote", 0, 1), "velocity -> makenote velocity inlet");
assert.ok(hasLine("obj-note", "obj-makenote", 0, 0), "note -> makenote pitch inlet");
assert.ok(hasLine("obj-ctrl-note", "obj-note", 0, 1), "Note numbox stores into i");
assert.strictEqual(byId["obj-note"].text, "i 36", "Note store needs a default before the numbox reports");
assert.ok(hasLine("obj-makenote", "obj-pack-note", 0, 0) && hasLine("obj-makenote", "obj-pack-note", 1, 1), "makenote -> pack");
assert.ok(hasLine("obj-pack-note", "obj-midiformat", 0, 0) && hasLine("obj-midiformat", "obj-midiout", 0, 0), "pack -> midiformat -> midiout");
assert.ok(hasLine("obj-ctrl-chan", "obj-midiformat", 0, 6), "MIDI Ch sets midiformat channel inlet");
assert.ok(hasLine("obj-ctrl-len", "obj-makenote", 0, 2), "Length sets makenote duration");
assert.ok(hasLine("obj-viz", "obj-route-viz", 0, 0) && byId["obj-route-viz"].text === "route thr view", "Threshold drag / view route");
const viewToggle = byId["obj-view-toggle"];
assert.ok(viewToggle && viewToggle.maxclass === "live.text" && viewToggle.mode === 1 && !viewToggle.presentation, "Graph View is a hidden Toggle live.text");
assert.strictEqual(viewToggle.saved_attribute_attributes.valueof.parameter_invisible, 1, "Graph View is stored but not automatable");
assert.ok(hasLine("obj-route-viz", "obj-view-toggle", 1, 0) && hasLine("obj-view-toggle", "obj-ui-view") && hasLine("obj-ui-view", "obj-viz"), "View toggle round trip");
assert.ok(hasLine("obj-view-toggle", "obj-view-store", 0, 1) && hasLine("obj-thisdevice", "obj-view-store", 0, 0) && hasLine("obj-view-store", "obj-ui-view"), "Saved view re-applies on load via an i store");
assert.ok(!hasLine("obj-thisdevice", "obj-view-toggle"), "Never bang a Toggle live.text on load");
assert.ok(hasLine("obj-route-viz", "obj-prep-thr") && hasLine("obj-route-viz", "obj-set-thr") && hasLine("obj-set-thr", "obj-ctrl-thr"), "Threshold drag updates gen and dial");

// 6. Native-style routing menus
for (const id of ["obj-route-type", "obj-route-chan"]) {
    const v = byId[id].saved_attribute_attributes.valueof;
    assert.strictEqual(byId[id].maxclass, "live.menu");
    assert.strictEqual(v.parameter_invisible, 2, `${id} must be a hidden parameter`);
    assert.ok(!v.parameter_initial_enable, `${id} must not restore an initial value`);
}
assert.ok(hasLine("obj-thisdevice", "obj-msg-init-routing") && hasLine("obj-msg-init-routing", "obj-viz"), "live.thisdevice must init routing");
assert.ok(hasLine("obj-viz", "obj-route-type", 1, 0) && hasLine("obj-viz", "obj-route-chan", 2, 0), "viz outlets 1/2 drive the menus");
assert.ok(hasLine("obj-route-type", "obj-msg-settype") && hasLine("obj-msg-settype", "obj-viz"), "Type menu -> settype");
assert.ok(hasLine("obj-route-chan", "obj-msg-setchan") && hasLine("obj-msg-setchan", "obj-viz"), "Channel menu -> setchannel");

// 7. Collapsible panel wiring
const toggle = byId["obj-panel-toggle"];
assert.ok(toggle && toggle.maxclass === "live.text" && !toggle.presentation, "Panel state is a hidden live.text");
assert.strictEqual(toggle.saved_attribute_attributes.valueof.parameter_invisible, 1, "Panel state is stored but not automatable");
assert.strictEqual(toggle.saved_attribute_attributes.valueof.parameter_initial[0], 0, "Panel starts closed");
assert.strictEqual(toggle.mode, 1, "Panel state must be a Toggle live.text (Button mode never latches; regression)");
assert.ok(hasLine("obj-strip", "obj-panel-toggle"), "Strip clicks drive the toggle");
assert.ok(!hasLine("obj-thisdevice", "obj-panel-toggle"), "A load-time bang to a Toggle live.text flips it open (regression)");
assert.ok(hasLine("obj-panel-toggle", "obj-open-store", 0, 1) && hasLine("obj-thisdevice", "obj-open-store", 0, 0), "live.thisdevice re-applies the stored state via an i store");
assert.strictEqual(byId["obj-open-store"].text, "i 0");
assert.ok(hasLine("obj-panel-toggle", "obj-open-fan") && hasLine("obj-open-store", "obj-open-fan"), "Toggle and store both feed the fan-out");
assert.ok(hasLine("obj-open-fan", "obj-ui-open") && hasLine("obj-ui-open", "obj-strip"), "Fan-out -> strip face");
assert.strictEqual(byId["obj-expr-width"].text, `expr ${cfg.WIDTH_COLLAPSED} + $i1 * ${cfg.WIDTH_EXPANDED - cfg.WIDTH_COLLAPSED}`);
assert.ok(hasLine("obj-open-fan", "obj-expr-width") && hasLine("obj-expr-width", "obj-prep-setwidth") && hasLine("obj-prep-setwidth", "obj-thisdevice"), "Fan-out -> setwidth");
assert.strictEqual(byId["obj-prep-setwidth"].text, "prepend setwidth");
assert.ok(hasLine("obj-open-fan", "obj-eq-hidden") && hasLine("obj-eq-hidden", "obj-prep-hidden") && byId["obj-eq-hidden"].text === "== 0", "Fan-out -> hidden");
for (const id of panelIds) assert.ok(byId[id].varname, `${id} needs a scripting name for the test hook`);

// Test hook used by scripts/run_envtrig_ui_tests.py and scripts/test_envtrig_live.js
assert.strictEqual(byId["obj-r-test"].text, "receive envtrig-test");
assert.ok(hasLine("obj-r-test", "obj-strip"), "Test hook drives the strip");
assert.ok(hasLine("obj-expr-width", "obj-ui-width") && hasLine("obj-ui-width", "obj-strip"), "Strip mirrors the setwidth value");

// 8. Graph v8ui runtime
// Mock of buffer~ #0-trigscope (800 samples): header 0..6, oscilloscope ring from 32.
const scopeBufData = new Array(800).fill(0);
function setHeader(vals) { vals.forEach((v, i) => { scopeBufData[i] = v; }); }
const drawOps = [];
const emitted = [[], [], []];
const lomState = {
    available_routing_types: types,
    available_routing_channels: [{ display_name: "Track In", identifier: 1 }, { display_name: "1-Drum Rack", identifier: 2 }],
    routing_type: types[2],
    routing_channel: { display_name: "Track In", identifier: 1 },
};
const lomObjects = [];
// Live's v8 observers hand back a Max Dict handle; get() returns ["{json}"].
const asDict = (o) => ({ name: "u0001", quiet: 0, stringify: () => JSON.stringify(o) });
function LiveAPI(cb, p) {
    this.cb = cb;
    this.path = p;
    lomObjects.push(this);
    let prop = "";
    Object.defineProperty(this, "property", {
        set: (v) => { prop = v; cb([v, asDict({ [v]: lomState[v] })]); },
        get: () => prop,
    });
    this.get = (k) => [JSON.stringify({ [k]: lomState[k] })];
    this.set = (k, v) => {
        lomState[k] = v;
        for (const o of lomObjects) if (o.property === k) o.cb([k, asDict({ [k]: v })]);
    };
}
function Buffer() {
    this.peek = (ch, off, n) => scopeBufData.slice(off, off + n);
    this.poke = () => {};
}
function Task(fn) { this.fn = fn; this.repeat = () => {}; }
const mg = makeMg(vr[2], vr[3], drawOps);
const ui = new Function(
    "mgraphics", "Buffer", "Task", "outlet", "LiveAPI",
    viz.textfile.text + "\nreturn { loadbang, setbuffer, set_thr, set_note, set_view, init_routing, settype, setchannel, onclick, ondrag, pullScope, paint, bounds, histFire: () => histFire, flash: () => flash, lastVel: () => lastVel, view: () => view, scopeMax: () => scopeMax, scopeFire: () => scopeFire };"
)(mg, Buffer, Task, (o, m) => emitted[o].push(m), LiveAPI);
assert.strictEqual(mg.relative_coords, 0, "v8ui must disable relative_coords");
assert.strictEqual(mg.autofill, 0, "v8ui must disable autofill");

ui.setbuffer("1001-trigscope");
ui.loadbang();
ui.pullScope();
setHeader([0.6, 0.1, 1, 2, 0.6, 103]);
ui.pullScope();
assert.strictEqual(ui.histFire()[ui.histFire().length - 1], 103, "A new fire counter must record a velocity tick");
assert.ok(ui.flash() > 0.5 && ui.lastVel() === 103, "A fire must light the LED");
ui.pullScope();
assert.strictEqual(ui.histFire()[ui.histFire().length - 1], 0, "An unchanged counter must not refire");

ui.onclick(60, 40);
ui.ondrag(60, 30, 1);
assert.ok(emitted[0].some((m) => m[0] === "thr" && m[1] <= 0 && m[1] >= -60), "Dragging the graph must emit thr");
const before = emitted[0].length;
ui.ondrag(60, 30, 0);
ui.ondrag(60, 80, 1);
assert.strictEqual(emitted[0].length, before, "Mouse-up must end the threshold drag");
ui.set_note(36);
ui.paint();
assert.ok(drawOps.includes("text:C1 103"), "HUD must show the note and last velocity");

ui.init_routing();
assert.ok(lomObjects.every((o) => o.path === cfg.ROUTING_PATH), "Routing must target this_device midi_outputs 0");
assert.ok(emitted[1].some((m) => m[0] === "_parameter_range" && m.includes("1-Drums") && m.includes("2-Bass")), "Type menu must list routing types");
assert.ok(emitted[1].some((m) => m[0] === "setsymbol" && m[1] === "No Output"), "Type menu must show the current routing");
assert.ok(emitted[2].some((m) => m[0] === "active" && m[1] === 1), "Channel menu must enable for multi-channel targets");
ui.settype(0);
assert.strictEqual(lomState.routing_type.display_name, "1-Drums", "settype must set the LOM routing_type");
assert.ok(emitted[1].some((m) => m[0] === "setsymbol" && m[1] === "1-Drums"), "Type menu must follow routing changes");
ui.setchannel(1);
assert.strictEqual(lomState.routing_channel.display_name, "1-Drum Rack", "setchannel must set the LOM routing_channel");
ui.settype(99);
assert.strictEqual(lomState.routing_type.display_name, "1-Drums", "Out-of-range settype must be ignored");
drawOps.length = 0;
ui.paint();
assert.ok(drawOps.includes("text:> 1-Drums"), "HUD must show the MIDI To destination");

// Envelope view: fired-note ticks are thin, full-height lines
const gb = ui.bounds();
const fullHeight = (segs) => segs.filter((sg) => sg[0] === sg[2] && Math.abs(sg[1] - gb.y) < 1e-6 && Math.abs(sg[3] - (gb.y + gb.ph)) < 1e-6);
mg.segs.length = 0;
ui.paint();
assert.ok(fullHeight(mg.segs).length >= 1, "Envelope view must draw fired-note ticks at full height");

// Oscilloscope ring: block 5 (oldest-first index after the head) holds a 0.7 peak and an onset flag
setHeader([0.6, 0.1, 1, 9, 0.6, 103, 10]);
scopeBufData[32 + 15 * 3] = -0.6;
scopeBufData[32 + 15 * 3 + 1] = 0.7;
scopeBufData[32 + 15 * 3 + 2] = 1;
ui.pullScope();
assert.strictEqual(ui.scopeMax()[5], 0, "The envelope view must not copy the oscilloscope ring");
ui.set_view(1);
ui.pullScope();
assert.ok(Math.abs(ui.scopeMax()[5] - 0.7) < 1e-9, "Ring must be read oldest-first from the write head (block 15 -> column 5)");
assert.strictEqual(ui.scopeFire()[5], 1, "Ring onset flags must be read");

// View toggle: the left/right HUD segments pick envelope/scope and report it for the saved parameter
ui.set_view(0);
ui.onclick(25, 6);
assert.strictEqual(ui.view(), 1, "Right toggle segment selects the scope view");
assert.deepStrictEqual(emitted[0][emitted[0].length - 1], ["view", 1], "View changes are sent out for the Graph View parameter");
mg.segs.length = 0;
ui.paint();
const scopeTicks = fullHeight(mg.segs);
assert.ok(scopeTicks.length >= 1, "Scope view must draw onset ticks at full height");
ui.onclick(60, gb.y + gb.ph / 2 - 20);
ui.ondrag(60, gb.y + gb.ph / 2 - 20, 1);
const scopeThr = emitted[0].filter((m) => m[0] === "thr").pop()[1];
assert.ok(Math.abs(scopeThr - cfg.linToDb(20 / (gb.ph / 2))) < 0.15, "Scope view threshold drag maps linear amplitude to dB");
ui.onclick(10, 6);
assert.strictEqual(ui.view(), 0, "Left toggle segment selects the envelope view");
ui.set_view(1);
assert.strictEqual(ui.view(), 1, "set_view restores the saved view");
ui.set_view(0);

setHeader([0, 0, 1, 7, 0, 103, 10]);
for (let k = 0; k < 140; k++) ui.pullScope();
assert.strictEqual(ui.pullScope(), false, "pullScope must stop redrawing once silent history settles");
setHeader([0.3, 0, 1, 8, 0.3, 103, 10]);
assert.strictEqual(ui.pullScope(), true, "pullScope must resume when audio arrives");
setHeader([0, 0, 1, 8, 0, 103, 11]);
for (let k = 0; k < 140; k++) ui.pullScope();
setHeader([0, 0, 1, 8, 0, 103, 12]);
assert.strictEqual(ui.pullScope(), true, "A moving scope write head must keep redrawing");

// Strip v8ui runtime
const stripCode = fs.readFileSync(STRIP_PATH, "utf8");
const panelNames = panelIds.map((id) => byId[id].varname);
const namesMatch = strip.textfile.text.match(/^var PANEL_NAMES = (\[.*\]);\n\n/);
assert.ok(namesMatch, "Strip script must start with the PANEL_NAMES prefix");
assert.deepStrictEqual(JSON.parse(namesMatch[1]), panelNames, "PANEL_NAMES must list every panel widget's scripting name");
assert.strictEqual(strip.textfile.text.slice(namesMatch[0].length), stripCode, "Embedded strip script mismatch");
const stripOps = [];
const stripOut = [];
const smg = makeMg(strip.presentation_rect[2], strip.presentation_rect[3], stripOps);
const st = new Function("mgraphics", "outlet", strip.textfile.text + "\nreturn { set_open, onclick, test_click, paint };")(smg, (o, v) => stripOut.push(v));
assert.strictEqual(smg.relative_coords, 0, "Strip v8ui must disable relative_coords");
st.paint();
assert.ok(stripOps.includes("text:MIDI TO"), "Strip must label itself MIDI TO");
st.onclick();
assert.strictEqual(stripOut.pop(), 1, "Clicking a collapsed strip opens the panel");
st.set_open(1);
st.onclick();
assert.strictEqual(stripOut.pop(), 0, "Clicking an open strip collapses the panel");
st.test_click();
assert.strictEqual(stripOut.pop(), 0, "test_click behaves like a mouse click");

console.log("test_envtrig: ok");
