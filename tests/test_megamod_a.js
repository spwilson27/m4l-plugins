// Variant-specific VM tests for Mega Modulator UI A ("Tiles").
const vm = require("vm");
const path = require("path");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
let passed = 0;
function ok(c, m) { if (!c) { console.error("FAIL: " + m); process.exit(1); } passed++; }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

const log = { widths: [], notify: 0, cmds: 0 };
const mg = { size: [582, 161], init() {}, redraw() {}, relative_coords: 0, autofill: 0, text_measure: (t) => [String(t).length * 4, 8] };
for (const f of ["set_source_rgba", "set_line_width", "rectangle", "rectangle_rounded", "move_to", "line_to", "curve_to", "close_path", "arc", "ellipse", "fill", "fill_preserve", "stroke", "select_font_face", "set_font_size", "show_text", "save", "restore", "translate", "rotate"]) mg[f] = () => { log.cmds++; };
const ctx = {
    mgraphics: mg, console, inlets: 1, outlets: 2,
    outlet: (...a) => { if (a[1] === "width") log.widths.push(a[2]); },
    notifyclients: () => { log.notify++; }, post() {},
    arrayfromargs: (a) => Array.prototype.slice.call(a),
};
vm.createContext(ctx);
const src = execFileSync("python3", ["-c", "import sys; sys.path.insert(0,'scripts'); import megamod_common as m; sys.stdout.write(m.ui_script('a'))"], { cwd: ROOT, maxBuffer: 1 << 26 }).toString("utf8");
vm.runInContext(src, ctx, { filename: "megamod_ui_a.js" });
const run = (c) => vm.runInContext(c, ctx);
const click = (x, y, shift, extra) => run(`onclick(${x}, ${y}, 1, 0, ${shift ? 1 : 0}, 0, 0, ${extra && extra.ctrl ? 1 : 0})`);
const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];

// load + paint empty
run("paint()");
eq(run("uiWidth()"), 120, "0 mods: clamped min width");
eq(run("uiLayout().tiles"), 1, "0 mods: only the + tile");
// widths: 1, 5, 16 modulators (grid only)
run("MM.addModulator(MOD_LFO)");
eq(run("uiLayout().cols"), 1, "1 mod: 1 column (mod + plus tile)");
eq(run("uiWidth()"), 120, "1 mod width");
for (let k = 0; k < 4; k++) run("MM.addModulator(MOD_LFO)");
eq(run("uiLayout().cols"), 3, "5 mods: 6 tiles -> 3 columns");
eq(run("uiWidth()"), 3 + 3 * 79, "5 mods width");
for (let k = 0; k < 11; k++) run("MM.addModulator(MOD_ENV)");
eq(run("MM.modCount()"), 16, "16 mods");
eq(run("uiLayout().tiles"), 16, "16 mods: no + tile");
eq(run("uiWidth()"), 3 + 8 * 79, "16 mods width");
ok(run("uiGridHit(40, 40, uiLayout()).kind") === "tile", "16 mods: tile hit");
// width requests flow to the patch (uiChanged -> MM.requestWidth)
ok(log.widths.length > 0 && log.widths[log.widths.length - 1] === 3 + 8 * 79, "requestWidth tracks the grid");
// editor + inspector widths
run("MM.setUI({exp: 0, insp: 1})");
eq(run("uiWidth()"), 3 + 8 * 79 + 167 + 175, "16 mods + editor + inspector width");
eq(log.widths[log.widths.length - 1], 3 + 8 * 79 + 167 + 175, "width requested after ui change");
run("MM.setUI({exp: -1, insp: 0})");
for (let i = 15; i >= 1; i--) run(`MM.removeModulator(${i})`);
eq(run("uiWidth()"), 120, "back to 1 mod");

// hit-testing on a fresh 5 modulator demo state
run("MM.demo()");
run("MM.setUI({exp: -1, insp: 0})");
run("paint()");
const L = JSON.parse(run("JSON.stringify(uiLayout())"));
eq(L.slots, [0, 1, 2, 3, 4], "demo slots");
eq(L.tiles, 6, "demo tiles incl. plus");
const tr = (t) => JSON.parse(run(`JSON.stringify(uiTileRect(${t}))`));
const ar = (t) => JSON.parse(run(`JSON.stringify(uiArrowRect(uiTileRect(${t})))`));
eq(tr(1).x, tr(0).x, "column-major: tile 1 below tile 0");
ok(tr(1).y > tr(0).y, "tile 1 is in row 2");
ok(tr(2).x > tr(0).x, "tile 2 starts next column");
eq(run(`uiGridHit(${center(tr(3))[0]}, ${tr(3).y + 30}, uiLayout()).slot`), 3, "tile hit slot");
eq(run(`uiGridHit(${center(ar(2))[0]}, ${center(ar(2))[1]}, uiLayout()).kind`), "arrow", "arrow hit");
eq(run(`uiGridHit(${center(tr(5))[0]}, ${center(tr(5))[1]}, uiLayout()).kind`), "plus", "plus tile hit");
eq(run(`uiGridHit(${tr(0).x + 5}, ${tr(0).y + 5}, uiLayout()).kind`), "del", "delete corner hit");

// learn gestures
click(...center(ar(0)), false);
ok(run("MM.learn.armed && MM.learn.mod === 0 && !MM.learn.multi"), "click arrow = single-shot learn");
click(...center(ar(0)), false);
ok(!run("MM.learn.armed"), "click again disarms");
click(...center(ar(0)), true);
ok(run("MM.learn.armed && MM.learn.multi && MM.learn.mod === 0"), "shift-click = multi-learn");
run("paint()");
click(...center(ar(0)), false);
ok(!run("MM.learn.armed"), "click disarms multi-learn");
click(...center(ar(1)), true);
click(tr(3).x + 30, tr(3).y + 30, false);
ok(!run("MM.learn.armed"), "click elsewhere disarms");
click(...center(ar(1)), false);
run("onkeydown(27)");
ok(!run("MM.learn.armed"), "Esc disarms");

// + popup menu adds a modulator of the chosen type
const before = run("MM.modCount()");
click(...center(tr(5)), false);
ok(run("!!uiMenu"), "plus opens menu");
run("paint()");
const MR = JSON.parse(run("JSON.stringify(uiMenuRect(uiLayout()))"));
click(MR.x + 20, MR.y + 14 + 3 * 13 + 5, false); // 4th entry = Steps
eq(run("MM.modCount()"), before + 1, "menu adds modulator");
eq(run("MM.state.mods[5].type"), 4, "menu picked Steps");
ok(run("!uiMenu"), "menu closed");

// double-click opens/collapses the editor; persisted in state.ui
run("ondblclick(" + (tr(0).x + 30) + "," + (tr(0).y + 30) + ")");
eq(run("MM.getUI().exp"), 0, "dbl-click expands tile 0");
eq(run("uiLayout().ed !== null"), true, "editor present");
run("ondblclick(" + (tr(0).x + 30) + "," + (tr(0).y + 30) + ")");
eq(run("MM.getUI().exp"), -1, "dbl-click again collapses");

// editor widgets for every type + inspector: paint in all modes, drive controls
for (let slot = 0; slot < 6; slot++) {
    run(`MM.setUI({exp: ${slot}, insp: 1, scroll: 0})`);
    run("paint()");
    ok(run("uiCtl.length") > 3, `editor registers controls for slot ${slot}`);
}
run("MM.setUI({exp: 0, insp: 0})");
run("paint()");
// Hz/Sync segment: toggle sync off via the second... first segment
const hz = JSON.parse(run("JSON.stringify(uiCtl.filter(c => c.kind === 'seg')[0] && {x: uiCtl.filter(c => c.kind === 'seg')[0].x, y: uiCtl.filter(c => c.kind === 'seg')[0].y})"));
click(hz.x + 5, hz.y + 5, false);
eq(run("MM.state.mods[0].p.sync"), 0, "Hz segment turns sync off");
run("paint()");
// rate knob drag changes the rate
const k0 = run("MM.state.mods[0].p.rate");
const kn = JSON.parse(run("JSON.stringify(uiCtl.filter(c => c.kind === 'knob')[0])"));
click(kn.x + kn.w / 2, kn.y + kn.h / 2, false);
run(`ondrag(${kn.x + kn.w / 2}, ${kn.y + kn.h / 2 - 40}, 1, 0, 0)`);
run(`ondrag(${kn.x + kn.w / 2}, ${kn.y + kn.h / 2 - 40}, 0, 0, 0)`);
ok(run("MM.state.mods[0].p.rate") > k0, "knob drag up raises rate");
// shape glyph button
const shapes = JSON.parse(run("JSON.stringify(uiCtl.filter(c => c.kind === 'shape').map(c => ({x: c.x, y: c.y})))"));
click(shapes[3].x + 5, shapes[3].y + 5, false);
eq(run("MM.state.mods[0].p.shape"), 3, "shape glyph button sets shape");
// close glyph collapses
const cl = JSON.parse(run("JSON.stringify(uiCtl.filter(c => c.kind === 'close')[0])"));
click(cl.x + 5, cl.y + 5, false);
eq(run("MM.getUI().exp"), -1, "close glyph collapses editor");
// steps editor sets a step
run("MM.setUI({exp: 3})");
run("paint()");
const st = JSON.parse(run("JSON.stringify(uiCtl.filter(c => c.kind === 'steps')[0])"));
click(st.x + 5, st.y + 4, false);
ok(run("MM.state.mods[3].stepVals[0]") > 0.9, "steps editor click sets step 0 high");
// MSEG editor: add a point, delete via dbl-click
run("MM.setUI({exp: 4})");
run("paint()");
const ms = JSON.parse(run("JSON.stringify(uiCtl.filter(c => c.kind === 'mseg')[0])"));
const np = run("MM.state.mods[4].points.length");
click(ms.x + ms.w * 0.25, ms.y + 10, false);
eq(run("MM.state.mods[4].points.length"), np + 1, "mseg click adds a point");

// inspector: rows, mode toggle, curve cycling, delete, scroll
run("MM.setUI({exp: -1, insp: 1, scroll: 0})");
run("paint()");
const L2 = JSON.parse(run("JSON.stringify(uiLayout())"));
ok(L2.in && L2.in.w === 172, "inspector panel present");
const vis = JSON.parse(run("JSON.stringify(uiInspVisible(uiLayout().in).rows.map(r => ({k: r.item.kind, y: r.y, h: r.h, id: r.item.m && r.item.m.id})))"));
eq(vis[0].k, "head", "first inspector row is a modulator header");
const mapRow = vis.find((r) => r.k === "map");
const Rx = L2.in.x;
const h1 = JSON.parse(run(`JSON.stringify(uiInspHit(${Rx + 10}, ${mapRow.y + 5}, uiLayout()))`));
eq(h1.kind, "del", "x column is delete");
const id = mapRow.id;
const hm = run(`uiInspHit(${Rx + 160}, ${mapRow.y + 5}, uiLayout()).kind`);
eq(hm, "mode", "M/R toggle hit");
click(Rx + 160, mapRow.y + 5, false);
eq(run(`MM.getMapping(${id}).mode`), "remote", "M/R toggle flips mode");
const c0 = run(`MM.getMapping(${id}).curve`);
click(Rx + 94, mapRow.y + 5, false);
eq(run(`MM.getMapping(${id}).curve`), (c0 + 1) % 5, "curve click cycles type");
run(`ondrag(${Rx + 94}, ${mapRow.y + 5}, 0, 0, 0)`);
// value drag: remote -> right part edits max
const mx0 = run(`MM.getMapping(${id}).max`);
click(Rx + 140, mapRow.y + 5, false);
run(`ondrag(${Rx + 120}, ${mapRow.y + 5}, 1, 0, 0)`);
run(`ondrag(${Rx + 120}, ${mapRow.y + 5}, 0, 0, 0)`);
ok(run(`MM.getMapping(${id}).max`) !== mx0, "dragging value right half edits max (remote)");
const n0 = run("MM.allMappings().length");
click(Rx + 8, mapRow.y + 5, false);
eq(run("MM.allMappings().length"), n0 - 1, "x deletes mapping");
// header arrow arms learn
const hv = vis[0];
click(L2.in.x + L2.in.w - 20, hv.y + 7, true);
ok(run("MM.learn.armed && MM.learn.multi"), "inspector header arrow shift-click = multi-learn");
run("MM.disarmLearn()");
// scrolling: add many mappings
for (let k = 0; k < 40; k++) run(`MM.state.mappings.push(defaultMapping(MM.state.nextMapId++, 0, {path: 'p${k}', paramName: 'Param ${k}', deviceName: 'D', trackName: 'T'}))`);
run("paint()");
const total = run("uiInspItems().length");
ok(total > 40, "many inspector items");
run(`onwheel(${L2.in.x + 20}, ${L2.in.y + 60}, 0, -1)`);
eq(run("MM.getUI().scroll"), 1, "wheel scrolls inspector (persisted)");
run(`onwheel(${L2.in.x + 20}, ${L2.in.y + 60}, 0, 1)`);
eq(run("MM.getUI().scroll"), 0, "wheel scrolls back");
for (let k = 0; k < 200; k++) run(`onwheel(${L2.in.x + 20}, ${L2.in.y + 60}, 0, -1)`);
const sc = run("MM.getUI().scroll");
ok(sc > 0 && sc < total, "scroll clamped");
run("paint()");
// inspector toggle button
const L3 = JSON.parse(run("JSON.stringify(uiLayout())"));
const ib = JSON.parse(run("JSON.stringify(uiInspBtnRect(uiLayout()))"));
click(ib.x + 4, ib.y + 4, false);
eq(run("MM.getUI().insp"), 0, "inspector button toggles off");
click(ib.x + 4, ib.y + 4, false);
eq(run("MM.getUI().insp"), 1, "inspector button toggles on");
// delete tile via hover x
click(tr(0).x + 6, tr(0).y + 6, false);
eq(run("MM.state.mods[0]"), null, "tile x deletes the modulator");
// right-click (ctrl) deletes
click(tr(1).x + 30, tr(1).y + 30, false, { ctrl: true });
eq(run("MM.state.mods[2]"), null, "right-click deletes the modulator");
// preview + paint everywhere
run("preview()");
run("paint()");
ok(log.cmds > 1000, "painted");
run("onidle(40, 40)");
run("onidleout()");
run("uiTelemetry(MM.readTelemetry())");
console.log(`megamod A tests passed (${passed} checks)`);
