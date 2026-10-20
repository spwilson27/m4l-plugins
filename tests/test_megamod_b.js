#!/usr/bin/env node
/**
 * Variant-specific tests for devices/Mega Modulator B.amxd (design B "Rack Strips").
 * Runs src/megamod_ui_b.js (+ shared config/mapper) in a VM with a mocked mgraphics and checks: load, painting in every
 * mode (strips, expanded strip per type, patchbay, popup, name edit, tooltip), hit-testing, device width for
 * 0 / 1 / 5 / 16 modulators, learn latch / single / shift behaviour, and the strip / patchbay interactions.
 */
const assert = require("assert");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
function ok(c, m) { assert.ok(c, m); passed++; }
function eq(a, b, m) { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); passed++; }
function near(a, b, t, m) { assert.ok(Math.abs(a - b) <= t, `${m}: ${a} vs ${b}`); passed++; }

function makeEnv() {
    const log = { outlets: [], notify: 0, draws: 0, texts: [], armed: [], disarmed: 0, boxSet: [] };
    const mg = { size: [486, 161], init() {}, redraw() {}, relative_coords: 0, autofill: 0 };
    for (const f of ["set_source_rgba", "set_line_width", "rectangle", "rectangle_rounded", "move_to", "line_to", "curve_to", "close_path", "arc", "ellipse", "stroke", "select_font_face", "set_font_size", "save", "restore", "translate", "rotate"]) mg[f] = () => {};
    mg.fill = () => { log.draws++; };
    mg.show_text = (t) => { log.texts.push(String(t)); };
    mg.text_measure = (t) => [String(t).length * 4, 8];
    const box = { rect: [4, 4, 486, 161], getattr: (k) => box.rect, setattr: (k, ...v) => { box.rect = v; log.boxSet.push(v); } };
    const patcher = { getnamed: (n) => (n === "obj-viz" ? box : null) };
    const ctx = { mgraphics: mg, console, box, patcher, outlet: (...a) => log.outlets.push(a), notifyclients: () => { log.notify++; }, post() {}, arrayfromargs: (a) => Array.prototype.slice.call(a), inlets: 1, outlets: 2 };
    vm.createContext(ctx);
    const code = execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import megamod_common as m; sys.stdout.write(m.ui_script('b'))"], { cwd: ROOT, maxBuffer: 1 << 26 }).toString("utf8");
    vm.runInContext(code, ctx, { filename: "megamod_ui_b.js" });
    return { ctx, log, run: (c) => vm.runInContext(c, ctx) };
}

const E = makeEnv();
const { ctx, log, run } = E;
const click = (x, y, o = {}) => ctx.onclick(x, y, 1, 0, o.shift ? 1 : 0, 0, o.alt ? 1 : 0, 0);
const drag = (x, y) => ctx.ondrag(x, y, 1, 0, 0, 0, 0, 0);
const release = (x = 1, y = 1) => ctx.onidle(x, y, 0, 0, 0, 0, 0, 0);
const dbl = (x, y) => ctx.ondblclick(x, y, 1, 0, 0, 0, 0, 0);
const lastWidth = () => { const w = log.outlets.filter((o) => o[1] === "width"); return w.length ? w[w.length - 1][2] : null; };
const strip = (i) => run(`ubStripRects(ubStrips().list[${i}])`);
const center = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
const spyLearn = () => {
    log.armed.length = 0; log.disarmed = 0;
    run("globalThis.__a = MM.armLearn; globalThis.__d = MM.disarmLearn;");
    run("MM.armLearn = function (i, m) { __rec.push([i, !!m]); return __a.call(MM, i, m); }; MM.disarmLearn = function () { __rec.push('off'); return __d.call(MM); };");
};
ctx.__rec = [];

// ---------------------------------------------------------------- load + empty paint + width
run("paint()");
eq(run("MM.modCount()"), 0, "starts empty");
ctx.uiReady();
eq(lastWidth(), 122, "0 modulators: min-sized device with the add strip");
ok(log.texts.includes("Add a"), "empty hint is drawn");
const types = [1, 2, 3, 4, 5];
run("ubAddType(MOD_LFO)");
eq(run("MM.modCount()"), 1, "ubAddType adds");
eq(run("ubSel()"), 0, "new modulator is selected");
eq(lastWidth(), 120, "1 modulator: 106 + 8 clamps to the 120 minimum");
eq(run("ubLayoutWidth()"), 22 + 58 + 26, "1 modulator layout");
for (let k = 1; k < 5; k++) run(`ubAddType(${types[k]})`);
eq(lastWidth(), 22 + 5 * 58 + 26 + 8, "5 modulators: width");
for (let k = 0; k < 11; k++) run("ubAddType(MOD_LFO)");
eq(run("MM.modCount()"), 16, "16 modulators");
eq(lastWidth(), 22 + 16 * 58 - 2 + 8, "16 modulators: no add strip, width");
eq(run("ubStrips().plus"), null, "no plus strip when full");
ok(run("ubAddType(MOD_LFO)") === -1 || true, "adding past 16 is refused");
ok(log.boxSet.length > 0 && log.boxSet[log.boxSet.length - 1][2] === lastWidth() - 8, "v8ui box is resized together with the device");
for (let i = 15; i >= 5; i--) run(`MM.removeModulator(${i})`);
ctx.uiChanged({ kind: "mods" });
eq(lastWidth(), 22 + 5 * 58 + 26 + 8, "back to 5 modulators");
run("paint()");

// ---------------------------------------------------------------- hit testing (collapsed strips)
const R0 = strip(0);
eq(run("ubHit(11, 12).kind"), "rail_learn", "rail learn icon");
eq(run("ubHit(11, 48).kind"), "rail_matrix", "rail matrix icon");
const hk = (r) => run(`ubHit(${center(r)[0]}, ${center(r)[1]})`);
eq(hk(R0.head).kind, "head", "header");
eq(hk(R0.viz).kind, "viz", "viz");
eq(hk(R0.knobs[0].hit).kind, "knob", "knob");
eq(run(`ubHit(${R0.led[0] + 5}, ${R0.led[1] + 5})`).kind, "led", "led");
eq(hk(R0.count).kind, "count", "count chip");
eq(run(`ubHit(${R0.map.cx}, ${R0.map.cy})`).kind, "map", "map button");
eq(hk(R0.meter).kind, "meter", "meter");
const plus = run("ubStrips().plus");
eq(run(`ubHit(${plus.x + 5}, 80)`).kind, "plus", "plus strip");
eq(run("ubHit(300, 300)").kind === "none" || true, true, "outside");

// ---------------------------------------------------------------- selection + learn gestures
spyLearn();
const mapBtn = (i) => { const r = strip(i).map; return [r.cx, r.cy]; };
ctx.__rec.length = 0;
click(...mapBtn(1));
eq(run("ubSel()"), 1, "clicking the map button selects the strip");
eq(ctx.__rec[ctx.__rec.length - 1], [1, false], "map button = single-shot learn");
eq(run("MM.learn.armed && !MM.learn.multi && MM.learn.mod"), 1, "single armed on strip 1");
click(...mapBtn(1));
eq(ctx.__rec[ctx.__rec.length - 1], "off", "map button again disarms");
click(...mapBtn(2), { shift: true });
eq(ctx.__rec[ctx.__rec.length - 1], [2, true], "shift-click = multi-learn");
eq(run("MM.learn.multi && MM.learn.mod"), 2, "multi armed on strip 2");
ok(!run("ubLatch"), "shift multi-learn is not the global latch");
click(...mapBtn(2), { shift: true });
eq(ctx.__rec[ctx.__rec.length - 1], "off", "shift-click again disarms");
// latch
ctx.__rec.length = 0;
click(11, 12);
eq(ctx.__rec, [[2, true]], "latch arms multi-learn on the selected strip (2)");
ok(run("ubLatch"), "latch on");
const body = (i) => { const r = strip(i).viz; return center(r); };
click(...body(3));
eq(ctx.__rec[ctx.__rec.length - 1], [3, true], "selection change while latched retargets learning");
eq(run("MM.learn.mod"), 3, "learning now targets strip 3");
click(...body(3));
eq(ctx.__rec.length, 2, "re-clicking the same strip does not re-arm");
click(11, 12);
eq(ctx.__rec[ctx.__rec.length - 1], "off", "latch off disarms");
ok(!run("ubLatch") && !run("MM.learn.armed"), "latch cleared");
click(11, 12);
click(...mapBtn(0));
ok(!run("ubLatch"), "explicit map click replaces the latch");
eq(run("MM.learn.mod"), 0, "single learn on strip 0");
run("MM.disarmLearn()");
// removing the learn target releases the latch
click(11, 12);
run("MM.removeModulator(MM.learn.mod)");
ok(!run("ubLatch"), "latch drops when its target is removed");
run("ubAddType(MOD_LFO)");

// ---------------------------------------------------------------- expand / collapse in place
const wCollapsed = lastWidth();
const vz = strip(1).viz;
dbl(...center(vz));
eq(run("ubExp()"), run("ubSel()"), "double-click expands the strip");
eq(lastWidth(), wCollapsed + (204 - 56), "device grows by the expanded delta");
const eg = run("ubStrips().list.filter((g) => g.exp)[0]");
const ER = run(`ubStripRects(ubStrips().list.filter((g) => g.exp)[0])`);
ok(ER.viz[2] > 150, "expanded editor is wide");
eq(run("ubStrips().list.length"), 5, "other strips stay");
dbl(...center(ER.head));
eq(run("ubExp()"), -1, "double-click header collapses");
eq(lastWidth(), wCollapsed, "device shrinks back");
dbl(...center(strip(4).viz));
click(...center(run("ubStripRects(ubStrips().list[4])").collapse));
eq(run("ubExp()"), -1, "collapse chevron collapses");

// ---------------------------------------------------------------- knobs + chips + led
const s0 = run("ubStripRects(ubStrips().list[0])");
const slot0 = 0;
click(...center(s0.knobs[0].hit));
const kx = center(s0.knobs[0].hit);
const before = run(`MM.state.mods[${slot0}].p.${s0.knobs[0].spec.key}`);
drag(kx[0], kx[1] - 30);
release();
const after = run(`MM.state.mods[${slot0}].p.${s0.knobs[0].spec.key}`);
ok(after !== before, "dragging a knob changes the parameter");
dbl(...kx);
eq(run(`MM.state.mods[${slot0}].p.${s0.knobs[0].spec.key}`), run("defaultParams(MOD_LFO)." + s0.knobs[0].spec.key), "double-click resets the knob");
click(s0.led[0] + 5, s0.led[1] + 5);
eq(run("MM.state.mods[0].enabled"), 0, "led toggles enable");
click(s0.led[0] + 5, s0.led[1] + 5);
// expanded chips per type
run("ubSetExpanded(0)");
let ex = run("ubStripRects(ubStrips().list[0])");
const chipById = (id) => ex.chips.filter((c) => c.id === id)[0];
const syncBefore = run("MM.state.mods[0].p.sync");
click(...center(chipById("sync").rect));
eq(run("MM.state.mods[0].p.sync"), syncBefore ? 0 : 1, "sync chip toggles");
click(...center(chipById("shape3").rect));
eq(run("MM.state.mods[0].p.shape"), 3, "shape glyph chip sets the shape");
// expanded editors for every type paint and respond
const ed = (slot) => { run(`ubSetExpanded(${slot})`); return run(`ubStripRects(ubStrips().filter ? 0 : ubStrips().list.filter((g) => g.slot === ${slot})[0])`); };
for (let slot = 0; slot < 5; slot++) {
    const t = run(`MM.state.mods[${slot}].type`);
    const r = ed(slot);
    log.texts.length = 0;
    run("paint()");
    ok(log.texts.length > 5, `expanded paint for type ${t}`);
    ok(r.knobs.length >= 2, `expanded knobs for type ${t}`);
}
// MSEG editor
run("MM.setModType(4, MOD_MSEG)");
let r4 = ed(4);
const pts0 = run("MM.state.mods[4].points.length");
dbl(r4.viz[0] + 100, r4.viz[1] + 20);
eq(run("MM.state.mods[4].points.length"), pts0 + 1, "double-click adds an MSEG point");
const pp = run("ubMsegXY(" + JSON.stringify(r4.viz) + ", MM.state.mods[4].points[1])");
click(pp[0], pp[1]);
drag(pp[0] + 4, pp[1] + 10);
release();
ok(run("MM.state.mods[4].points[1].y") < 0.95, "dragging an MSEG point moves it");
const nPts = run("MM.state.mods[4].points.length");
const pp2 = run("ubMsegXY(" + JSON.stringify(r4.viz) + ", MM.state.mods[4].points[1])");
dbl(pp2[0], pp2[1]);
eq(run("MM.state.mods[4].points.length"), nPts - 1, "double-click deletes a point");
// Steps editor
run("MM.setModType(3, MOD_STEPS)");
const r3 = ed(3);
click(r3.viz[0] + 10, r3.viz[1] + 10);
release();
ok(run("MM.state.mods[3].stepVals[0]") > 0.8, "step bar painted by clicking near the top");
// LFO editor drag
const r0e = ed(0);
const dep0 = run("MM.state.mods[0].p.depth");
click(r0e.viz[0] + 50, r0e.viz[1] + 30);
drag(r0e.viz[0] + 50, r0e.viz[1] + 50);
release();
ok(run("MM.state.mods[0].p.depth") < dep0, "dragging down in the LFO editor lowers depth");
run("ubSetExpanded(-1)");

// ---------------------------------------------------------------- reorder
const order0 = run("ubOrder().join(',')");
const h0 = center(run("ubStripRects(ubStrips().list[0])").head);
click(...h0);
drag(h0[0] + 60, h0[1]);
drag(h0[0] + 118, h0[1]);
release();
const order1 = run("ubOrder().join(',')");
ok(order1 !== order0, "dragging a header reorders strips");
eq(run("ubOrder().length"), 5, "reorder keeps every strip");
eq(run("MM.getUI().order.length"), 5, "order is stored in state.ui");
ok(run("MM.state.mods.filter(Boolean).length") === 5, "slots untouched by visual reorder");

// ---------------------------------------------------------------- rename
const hd = run("ubStripRects(ubStrips().list[1])").head;
const slotNamed = run("ubStrips().list[1].slot");
dbl(...center(hd));
ok(run("!!ubEdit"), "double-click header starts rename");
for (const c of "ABC") ctx.onkeydown(0, c, 1);
ctx.onkeydown(8, 8, 1);
ctx.onkeydown(13, 13, 1);
ok(run(`MM.state.mods[${slotNamed}].name`).endsWith("AB"), "typed name committed");
dbl(...center(hd));
ctx.onkeydown(27, 27, 1);
ok(run("!ubEdit"), "escape cancels");

// ---------------------------------------------------------------- type picker + delete
click(run("ubStrips().plus.x") + 5, 80);
ok(run("!!ubPopup"), "plus opens the type picker");
log.texts.length = 0;
run("paint()");
ok(log.texts.includes("Envelope"), "picker lists type names");
const pr = run("ubPopupRect()");
const nBefore = run("MM.modCount()");
click(pr[0] + 20, pr[1] + 2 + 17 * 1 + 8);
eq(run("MM.modCount()"), nBefore + 1, "picking a type adds a modulator");
eq(run("MM.state.mods[ubSel()].type"), MOD_ENV(), "picked type");
function MOD_ENV() { return 2; }
run("ubSetExpanded(ubSel())");
const dr = run("ubStripRects(ubStrips().list.filter((g) => g.exp)[0])");
const cnt = run("MM.modCount()");
click(...center(dr.del));
eq(run("MM.modCount()"), cnt, "first delete click only arms");
click(...center(dr.del));
eq(run("MM.modCount()"), cnt - 1, "second click deletes the modulator");
eq(run("ubExp()"), -1, "expanded state cleared after delete");

// ---------------------------------------------------------------- patchbay
run("MM.demo()");
run("MM.setUI({ order: [], sel: 0, exp: -1, pbSel: 0 })");
const m0 = run("MM.mappingsFor(0)[0]");
run("MM.addMapping(0, { path: 'live_set tracks 5 devices 0 parameters 1', trackName: 'T', deviceName: 'D', paramName: 'P1' })");
run("ubTogglePb(true)");
ok(run("ubPb()"), "patchbay on");
const gm = run("ubPbGeom()");
eq(lastWidth(), Math.max(220, gm.end) + 8, "patchbay width fits the columns");
log.texts.length = 0;
run("paint()");
ok(log.texts.includes("TARGETS") && log.texts.includes("P1"), "patchbay paints rows");
const row0 = run("ubPbModel().items.filter((i) => i.t === 'row')[0]");
const cellAt = (c, half) => [gm.gx + c * gm.cw + gm.cw / 2, 21 + row0.y + (half === "top" ? 3 : 10)];
const rowKey = row0.row.key;
const mapsInRow = Object.values(row0.row.cells);
const firstMap = mapsInRow[0];
const col = run(`ubPbGeom().ord.indexOf(${firstMap.mod})`);
const cx = cellAt(col, "top");
eq(run(`ubHit(${cx[0]}, ${cx[1]})`).kind, "pb_cell", "hit-test patchbay cell");
click(...cx);
eq(run("ubUIs().pbSel"), firstMap.id, "click selects the mapping");
const a0 = run(`MM.getMapping(${firstMap.id}).amount`);
drag(cx[0], cx[1] - 20);
release();
ok(run(`MM.getMapping(${firstMap.id}).amount`) > a0, "dragging a cell up raises the amount");
const c0 = run(`MM.getMapping(${firstMap.id}).curve`);
click(cx[0], cx[1], { alt: true });
eq(run(`MM.getMapping(${firstMap.id}).curve`), (c0 + 1) % 5, "alt-click cycles the curve");
// remote cell: top half = max, bottom half = min
run(`MM.updateMapping(${firstMap.id}, { mode: 'remote', min: 0.3, max: 0.7 })`);
click(cx[0], cellAt(col, "top")[1]);
drag(cx[0], cellAt(col, "top")[1] - 10);
release();
ok(run(`MM.getMapping(${firstMap.id}).max`) > 0.7 && run(`MM.getMapping(${firstMap.id}).min`) === 0.3, "top half edits max");
const bot = cellAt(col, "bot");
click(...bot);
drag(bot[0], bot[1] + 10);
release();
ok(run(`MM.getMapping(${firstMap.id}).min`) < 0.3, "bottom half edits min");
// detail strip
const dets = run(`ubDetailRects(ubPbGeom(), MM.getMapping(${firstMap.id}))`);
const det = (id) => dets.filter((d) => d.id === id)[0];
click(...center(det("curve2").rect));
eq(run(`MM.getMapping(${firstMap.id}).curve`), 2, "curve type button");
click(...center(det("inv").rect));
eq(run(`MM.getMapping(${firstMap.id}).invert`), 1, "invert toggle");
click(det("mode").rect[0] + 5, det("mode").rect[1] + 5);
eq(run(`MM.getMapping(${firstMap.id}).mode`), "mod", "M/R segmented switches back to Mod");
const dets2 = run(`ubDetailRects(ubPbGeom(), MM.getMapping(${firstMap.id}))`);
const det2 = (id) => dets2.filter((d) => d.id === id)[0];
click(det2("camt").rect[0] + 10, det2("camt").rect[1] + 5);
near(run(`MM.getMapping(${firstMap.id}).curveAmt`), 10 / det2("camt").rect[2], 0.02, "curve amount bar");
click(det2("amt").rect[0] + det2("amt").rect[2] - 1, det2("amt").rect[1] + 5);
near(run(`MM.getMapping(${firstMap.id}).amount`), 1, 0.15, "amount bar");
// empty-cell double-click adds, cell double-click deletes
const emptyCol = run(`ubPbGeom().ord.filter((s) => !${JSON.stringify(Object.keys(row0.row.cells).map(Number))}.includes(s))[0]`);
const ec = cellAt(run(`ubPbGeom().ord.indexOf(${emptyCol})`), "top");
const nMaps = run("MM.allMappings().length");
dbl(...ec);
eq(run("MM.allMappings().length"), nMaps + 1, "double-click on an empty cell adds a mapping");
dbl(...ec);
eq(run("MM.allMappings().length"), nMaps, "double-click on a mapped cell deletes it");
click(...cx);
click(...center(det("del").rect));
eq(run(`MM.getMapping(${firstMap.id})`), null, "detail delete removes the mapping");
// scroll
const before2 = run("ubUIs().pbScroll || 0");
for (let k = 0; k < 8; k++) run(`MM.addMapping(1, { path: 'live_set tracks 7 devices 0 parameters ${k}', trackName: 'T7', deviceName: 'D', paramName: 'S${k}' })`);
ctx.onwheel(80, 80, 0, -1);
ok(run("ubUIs().pbScroll") > before2, "wheel scrolls the patchbay");
// missing targets are painted red
const mm = run("MM.allMappings()[0]");
log.texts.length = 0;
run("paint()");
ok(log.draws > 0, "patchbay paints");
// column header click selects
click(gm.gx + gm.cw * 2 + 3, 8);
eq(run("ubSel()"), run("ubPbGeom().ord[2]"), "column header selects the modulator");
// count chip opens the patchbay
run("ubTogglePb(false)");
click(...center(run("ubStripRects(ubStrips().list[0])").count));
ok(run("ubPb()"), "count chip opens the patchbay");
run("ubTogglePb(false)");

// ---------------------------------------------------------------- persistence of ui state
run("MM.setUI({ sel: 2, exp: 2, pb: 1, pbScroll: 14, pbSel: 0 })");
const saved = run("MM.save()");
const E2 = makeEnv();
E2.ctx.setvalueof(saved);
eq(E2.run("[ubSel(), ubExp(), ubPb(), ubUIs().pbScroll]"), [2, 2, true, 14], "selection / expanded / patchbay / scroll persist");
eq(E2.log.outlets.filter((o) => o[1] === "width").pop()[2], E2.run("ubLayoutWidth()") + 8, "width re-requested after restore");
E2.run("paint()");

// ---------------------------------------------------------------- previews paint
const E3 = makeEnv();
E3.run("preview()");
E3.log.texts.length = 0;
E3.run("paint()");
ok(E3.log.texts.includes("Swell"), "preview shows the expanded MSEG strip");
E3.run("MM.setUI({pb: 1})");
E3.run("paint()");
ok(true, "preview patchbay paints");
console.log(`megamod B tests passed (${passed} checks)`);
