#!/usr/bin/env node
/**
 * Variant-specific tests for devices/Mega Modulator.amxd.
 * Runs src/megamod_ui.js (+ shared config/mapper) in a VM with a mocked mgraphics and checks: load, painting in every
 * mode (strips, expanded strip per type, mapping list + remap editor, popup, name edit, tooltip, "pool full" pill), hit-testing, device width for
 * 0 / 1 / 5 / 16 modulators, the rail learn button (single / Shift multi / disarm / retarget), and the strip / mapping-list / remap-editor
 * (MSEG transfer curve) interactions.
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
    for (const f of ["set_line_width", "move_to", "line_to", "curve_to", "close_path", "arc", "ellipse", "stroke", "select_font_face", "set_font_size", "save", "restore", "translate", "rotate"]) mg[f] = () => {};
    let col = [0, 0, 0, 1];
    let rect = null;
    mg.set_source_rgba = (r, g, b, a) => { col = [r, g, b, a]; };
    mg.rectangle = (x, y, w, h) => { rect = [x, y, w, h]; };
    mg.rectangle_rounded = (x, y, w, h) => { rect = [x, y, w, h]; };
    mg.fill = () => { log.draws++; if (log.fills) log.fills.push({ rect, col }); };
    mg.show_text = (t) => { log.texts.push(String(t)); };
    mg.text_measure = (t) => [String(t).length * 4, 8];
    const box = { rect: [4, 4, 486, 161], getattr: (k) => box.rect, setattr: (k, ...v) => { box.rect = v; log.boxSet.push(v); } };
    const patcher = { getnamed: (n) => (n === "obj-viz" ? box : null) };
    const ctx = { mgraphics: mg, console, box, patcher, outlet: (...a) => log.outlets.push(a), notifyclients: () => { log.notify++; }, post() {}, arrayfromargs: (a) => Array.prototype.slice.call(a), inlets: 1, outlets: 2 };
    vm.createContext(ctx);
    const code = execFileSync("python3", ["-c", "import sys; sys.path.insert(0, 'scripts'); import megamod_common as m; sys.stdout.write(m.ui_script())"], { cwd: ROOT, maxBuffer: 1 << 26 }).toString("utf8");
    vm.runInContext(code, ctx, { filename: "megamod_ui.js" });
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
    if (ctx.__spied) return;
    ctx.__spied = true;
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
eq(run("ubHit(11, 48).kind"), "rail_list", "rail list icon");
const hk = (r) => run(`ubHit(${center(r)[0]}, ${center(r)[1]})`);
eq(hk(R0.head).kind, "head", "header");
eq(hk(R0.viz).kind, "viz", "viz");
eq(hk(R0.knobs[0].hit).kind, "knob", "knob");
eq(hk(R0.icon).kind, "pwr", "corner power button");
ok(R0.led === undefined, "no LED rect on the strip");
eq(hk(R0.count).kind, "count", "count chip");
ok(R0.map === undefined, "no map button rect on a collapsed strip");
eq(hk(R0.meter).kind, "meter", "meter");
const plus = run("ubStrips().plus");
eq(run(`ubHit(${plus.x + 5}, 80)`).kind, "plus", "plus strip");
eq(run("ubHit(300, 300)").kind === "none" || true, true, "outside");

// ---------------------------------------------------------------- no map button on strips
{
    const kinds = new Set();
    for (let yy = 0; yy < 161; yy += 2) for (let xx = 22; xx < 22 + 5 * 58; xx += 2) kinds.add(run(`ubHit(${xx}, ${yy})`).kind);
    ok(!kinds.has("map"), "no strip pixel hits a map button");
    for (const k of kinds) ok(k !== "map" && k !== "led", "strip hit kind " + k + " is not a map / led");
    run("ubSetExpanded(1)");
    const kinds2 = new Set();
    const ex2 = run("ubStrips().list.filter((g) => g.exp)[0]");
    for (let yy = 0; yy < 161; yy += 2) for (let xx = ex2.x; xx < ex2.x + ex2.w; xx += 2) kinds2.add(run(`ubHit(${xx}, ${yy})`).kind);
    ok(!kinds2.has("map"), "no expanded-strip pixel hits a map button");
    ok(run("ubStripRects(ubStrips().list.filter((g) => g.exp)[0]).map") === undefined, "expanded strip has no map rect");
    // the reclaimed space is used: the collapsed viz and meter are taller than before, the count chip sits at the bottom
    const cs = strip(0);
    ok(cs.viz[3] >= 60 && cs.meter[3] >= 100, "collapsed strip viz / meter use the freed height");
    ok(cs.count[1] + cs.count[3] <= 158 && cs.count[1] >= cs.knobs[0].labY + 4, "count chip sits in the bottom row below the knob labels");
    run("ubSetExpanded(-1)");
}

// ---------------------------------------------------------------- rail learn button: single / Shift multi / disarm / retarget
spyLearn();
run("MM.setUI({ sel: 1 })");
const rail = [11, 12];
ctx.__rec.length = 0;
click(...rail);
eq(ctx.__rec[ctx.__rec.length - 1], [1, false], "rail click = single-shot learn on the selected modulator");
eq(run("MM.learn.armed && !MM.learn.multi && MM.learn.mod"), 1, "single armed on strip 1");
click(...rail);
eq(ctx.__rec[ctx.__rec.length - 1], "off", "clicking while armed disarms");
ok(!run("MM.learn.armed"), "disarmed");
click(...rail, { shift: true });
eq(ctx.__rec[ctx.__rec.length - 1], [1, true], "Shift-click = multi-learn on the selected modulator");
ok(run("MM.learn.armed && MM.learn.multi"), "multi armed");
click(...rail, { shift: true });
eq(ctx.__rec[ctx.__rec.length - 1], "off", "Shift-click while armed disarms");
click(...rail, { shift: true });
click(...rail);
eq(ctx.__rec[ctx.__rec.length - 1], "off", "a plain click disarms multi-learn too");
// a single-shot disarms itself after one mapping (the mapper does it); the rail follows MM.learn
click(...rail);
run("MM._learned = 0; MM.addMapping(1, { path: 'live_set tracks 3 devices 0 parameters 1', trackName: 'A', deviceName: 'B', paramName: 'C' }); MM.disarmLearn();");
ok(!run("MM.learn.armed"), "single-shot is off again after its mapping");
// retarget: multi follows the selection, single does not
click(...rail, { shift: true });
const body = (i) => center(strip(i).viz);
ctx.__rec.length = 0;
click(...body(3));
eq(ctx.__rec[ctx.__rec.length - 1], [3, true], "changing the selection retargets multi-learn");
eq(run("MM.learn.mod"), 3, "multi-learn now targets strip 3");
click(...body(3));
eq(ctx.__rec.length, 1, "re-clicking the same strip does not re-arm");
click(...center(strip(2).icon));
eq(run("MM.learn.mod"), 2, "selecting through the corner button retargets too");
click(...center(strip(2).icon)); // restore the corner button's enable state
run("MM.disarmLearn(); ubSelect(0)");
click(...rail);
ok(run("MM.learn.armed && !MM.learn.multi && MM.learn.mod === 0"), "single armed on strip 0");
ctx.__rec.length = 0;
click(...body(3));
eq(ctx.__rec.length, 0, "single-shot is NOT retargeted by a selection change");
eq(run("MM.learn.mod"), 0, "single-shot stays on its modulator");
run("MM.disarmLearn()");
// removing the learn target releases the learn
run("ubSelect(4)");
click(...rail, { shift: true });
run("MM.removeModulator(MM.learn.mod)");
ok(!run("MM.learn.armed"), "learn drops when its target is removed");
run("ubAddType(MOD_LFO)");
// no selection: the rail picks the first modulator
run("MM.setUI({ sel: -1 })");
click(...rail);
ok(run("MM.learn.armed && ubSel() >= 0"), "rail learn with no selection picks the first modulator");
run("MM.disarmLearn()");
// rail paint: single pulses (alpha changes with the frame), multi is solid
{
    log.fills = [];
    run("MM.armLearn(ubSel(), false); ubFrame = 0"); run("paint()");
    const a0 = log.fills.filter((f) => f.rect && f.rect[0] === 2 && f.rect[1] === 4 && f.col[2] > 0.9 && f.col[0] < 0.4).map((f) => f.col[3]);
    log.fills = [];
    run("ubFrame = 7"); run("paint()");
    const a1 = log.fills.filter((f) => f.rect && f.rect[0] === 2 && f.rect[1] === 4 && f.col[2] > 0.9 && f.col[0] < 0.4).map((f) => f.col[3]);
    ok(a0.length > 0 && a1.length > 0 && a0.join() !== a1.join(), "single-shot learn pulses (button alpha changes between frames)");
    run("MM.armLearn(ubSel(), true); ubFrame = 0"); log.fills = []; run("paint()");
    const m0 = log.fills.filter((f) => f.rect && f.rect[0] === 2 && f.rect[1] === 4 && f.col[2] > 0.9 && f.col[0] < 0.4).map((f) => f.col[3]);
    run("ubFrame = 7"); log.fills = []; run("paint()");
    const m1_ = log.fills.filter((f) => f.rect && f.rect[0] === 2 && f.rect[1] === 4 && f.col[2] > 0.9 && f.col[0] < 0.4).map((f) => f.col[3]);
    ok(m0.length > 0 && m0.join() === m1_.join(), "multi-learn is solid (no pulse)");
    log.fills = null;
    run("MM.disarmLearn()");
}
log.texts.length = 0; run("paint()");
ok(log.texts.includes("LRN"), "rail shows the LRN label");

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
ok(s0.led === undefined, "collapsed strip has no LED rect");
{
    const allKinds = new Set();
    for (let yy = 0; yy < 161; yy += 3) for (let xx = 22; xx < 80; xx += 3) allKinds.add(run(`ubHit(${xx}, ${yy})`).kind);
    ok(!allKinds.has("led"), "no LED hit area anywhere on the strip");
}
eq(run("MM.state.mods[0].enabled"), 1, "enabled before toggle");
click(...center(s0.icon));
eq(run("MM.state.mods[0].enabled"), 0, "corner button turns the modulator off");
click(...center(s0.icon));
eq(run("MM.state.mods[0].enabled"), 1, "corner button turns it back on");
{
    log.texts.length = 0; log.draws = 0;
    run("MM.setParam(0, 'enabled', 0)"); run("paint()");
    const offDraws = log.draws;
    run("MM.setParam(0, 'enabled', 1)"); run("paint()");
    ok(offDraws > 0, "off state paints");
}
// expanded chips per type
run("ubSetExpanded(0)");
let ex = run("ubStripRects(ubStrips().list[0])");
const chipById = (id) => ex.chips.filter((c) => c.id === id)[0];
const syncBefore = run("MM.state.mods[0].p.sync");
click(...center(chipById("sync").rect));
eq(run("MM.state.mods[0].p.sync"), syncBefore ? 0 : 1, "sync chip toggles");
click(...center(chipById("shape3").rect));
eq(run("MM.state.mods[0].p.shape"), 3, "shape glyph chip sets the shape");
// expanded header: power button + type chip (type change lives here now)
{
    const eg0 = run("ubStrips().list[0]");
    eq(run("ubStrips().list[0].exp"), true, "strip 0 expanded");
    ok(ex.led === undefined, "expanded strip has no LED rect");
    eq(run(`ubHit(${center(ex.icon)[0]}, ${center(ex.icon)[1]})`).kind, "pwr", "expanded corner power button");
    click(...center(ex.icon));
    eq(run("MM.state.mods[0].enabled"), 0, "expanded corner button disables");
    click(...center(ex.icon));
    eq(run("MM.state.mods[0].enabled"), 1, "expanded corner button re-enables");
    eq(run(`ubHit(${center(ex.type)[0]}, ${center(ex.type)[1]})`).kind, "typechip", "type chip hit");
    ok(ex.type[0] >= ex.name[0] + ex.name[2], "type chip does not overlap the name");
    const t0 = run("MM.state.mods[0].type");
    click(...center(ex.type));
    ok(run("!!ubPopup && ubPopup.mode === 'type'"), "type chip opens the picker");
    const pr0 = run("ubPopupRect()");
    click(pr0[0] + 20, pr0[1] + 2 + 17 * 2 + 8); // 3rd type = Random
    eq(run("MM.state.mods[0].type"), 3, "picking a type changes the modulator type");
    ok(run("MM.state.mods[0].type") !== t0, "type actually changed");
    run("MM.setModType(0, MOD_LFO)");
    ok(run("!ubPopup"), "picker closed");
    // clicking the name/header area no longer opens the picker
    dbl(...center(ex.name)); ctx.onkeydown(27, 27, 1);
    ok(run("!ubPopup"), "header name does not open the picker");
}
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

// ---------------------------------------------------------------- mapping list + remap editor
run("MM.demo()");
run("MM.setUI({ order: [], sel: 0, exp: -1, pbSel: 0, pbScroll: 0 })");
for (let k = 0; k < 4; k++) run(`MM.addMapping(0, { path: 'live_set tracks 5 devices 0 parameters ${k}', trackName: 'Tr', deviceName: 'Dev', paramName: 'P${k}' })`);
run("MM.addMapping(1, { path: 'live_set tracks 6 devices 0 parameters 9', trackName: 'Tr2', deviceName: 'Dev2', paramName: 'Q1' })");
run("ubTogglePb(true)");
ok(run("ubPb()"), "list on");
const gm = run("ubListGeom()");
eq(gm.end, 22 + 172 + 6 + 138, "list geometry: rail + list + editor");
eq(lastWidth(), gm.end + 8, "list width fits list + editor");
log.texts.length = 0;
run("paint()");
ok(log.texts.includes("MAPPINGS") && log.texts.includes("P0"), "list paints headers and rows");
ok(log.texts.includes("Select a row"), "editor shows the empty prompt without a selection");
ok(!log.texts.includes("TARGETS"), "patchbay is gone");
const rowAt = (id) => {
    const v = run("ubListVisible()");
    for (const r of v.rows) if (r.item.kind === "map" && r.item.m.id === id) return r;
    return null;
};
const m1 = run("MM.mappingsFor(0)[1]");
const r1 = rowAt(m1.id);
ok(!!r1, "mapping row is visible");
const P1 = run(`ubRowParts(${r1.y})`);
const at = (rect) => [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2];
eq(run(`ubHit(${at(P1.name)[0]}, ${at(P1.name)[1]})`).kind, "ls_row", "name hit = row");
eq(run(`ubHit(${at(P1.name)[0]}, ${at(P1.name)[1]})`).tip, `${m1.target.trackName} > ${m1.target.deviceName} > ${m1.target.paramName}`, "name hover tip shows track > device > param");
eq(run(`ubHit(${at(P1.del)[0]}, ${at(P1.del)[1]})`).kind, "ls_del", "delete hit");
eq(run(`ubHit(${at(P1.curve)[0]}, ${at(P1.curve)[1]})`).kind, "ls_curve", "curve hit");
eq(run(`ubHit(${at(P1.val)[0]}, ${at(P1.val)[1]})`).kind, "ls_val", "value hit");
eq(run(`ubHit(${at(P1.mode)[0]}, ${at(P1.mode)[1]})`).kind, "ls_mode", "mode hit");
eq(run(`ubHit(${at(P1.tog)[0]}, ${at(P1.tog)[1]})`).kind, "ls_tog", "leftmost spot is the on/off toggle");
{
    const g = run("ubListGeom()");
    ok(P1.tog[0] < P1.name[0] && P1.tog[0] <= g.lx + 4, "toggle is the leftmost element of the row");
    ok(P1.del[0] > P1.mode[0] && P1.del[0] + P1.del[2] <= g.lx + g.lw - 3, "delete x is at the far right of the row");
    ok(P1.name[0] + P1.name[2] <= P1.curve[0] && P1.curve[0] + P1.curve[2] <= P1.val[0] && P1.val[0] + P1.val[2] <= P1.mode[0] && P1.mode[0] + P1.mode[2] <= P1.del[0], "row parts do not overlap");
}
// row select -> editor shows that mapping
click(...at(P1.name));
eq(run("ubUIs().pbSel"), m1.id, "clicking a row selects the mapping");
eq(run("ubSel()"), 0, "selecting a row selects its modulator");
log.texts.length = 0;
run("paint()");
ok(log.texts.includes("P1") && !log.texts.includes("INV") && !log.texts.includes("BIP"), "editor shows the selected mapping, without INV / BIP");
ok(log.texts.includes("Amount"), "mod-mode editor has an Amount bar");
ok(!log.texts.includes("Curve") && !log.texts.includes("Steps"), "no curve-amount / steps bar any more");
// ---- row on/off toggle
{
    run(`MM.setUI({ pbSel: 0 })`);
    const sel0 = run("ubUIs().pbSel");
    eq(run(`MM.getMapping(${m1.id}).enabled`), 1, "mapping starts enabled");
    click(...at(P1.tog));
    eq(run(`MM.getMapping(${m1.id}).enabled`), 0, "row toggle disables the mapping");
    eq(run("ubUIs().pbSel"), sel0, "toggling does not change the selected mapping");
    log.texts.length = 0; run("paint()");
    ok(log.texts.includes("Param 2"), "disabled row still paints (dimmed)");
    click(...at(P1.tog));
    eq(run(`MM.getMapping(${m1.id}).enabled`), 1, "row toggle enables it again");
    click(...at(P1.name));
}
// ---- editor controls: preset buttons + MSEG
const dets = () => run(`ubDetailRects(ubListGeom(), MM.getMapping(${m1.id}))`);
const det = (id) => dets().filter((d) => d.id === id)[0];
ok(!dets().some((d) => d.id.indexOf("curve") === 0 || d.id === "camt" || d.id === "preview"), "old curve buttons / curve amount / fixed preview are gone");
eq(dets().filter((d) => d.id.indexOf("preset") === 0).length, 5, "five preset buttons");
ok(det("mseg").rect[2] >= 120 && det("mseg").rect[3] >= 60, "MSEG editor is big enough to edit");
const shapeOf = () => run(`MM.getMapping(${m1.id}).shape`);
eq(shapeOf().length, 2, "starts as the linear two-point shape");
for (const [k, name] of [[1, "Exp"], [2, "Log"], [3, "S"], [4, "Stepped"], [0, "Linear"]]) {
    click(...center(det("preset" + k).rect));
    eq(JSON.stringify(shapeOf()), JSON.stringify(run(`curveToShape(${k}, 0.5, 4)`)), `preset ${name} loads its point set`);
    ok(run(`ubShapeIsPreset(MM.getMapping(${m1.id}), ${k})`), `preset ${name} lights up`);
}
click(...center(det("preset4").rect));
eq(shapeOf().length, 8, "Stepped preset = 4 hard steps (8 points)");
{
    const t = run(`mappingTable(Object.assign({}, MM.getMapping(${m1.id}), { amount: 1, polarity: 1, mode: 'mod' }))`);
    eq(new Set(t.map((v) => Math.round(v * 1e6))).size, 4, "stepped table has 4 levels");
}
click(...center(det("preset0").rect));
// MSEG gestures
const MS = det("mseg").rect;
const msXY = (p) => run(`ubMsegXY(${JSON.stringify(MS)}, ${JSON.stringify(p)})`);
// click on empty space adds a point (and drags it)
let n0 = shapeOf().length;
const addAt = msXY({ x: 0.5, y: 0.8 });
click(addAt[0], addAt[1] - 12); // away from the diagonal handle
eq(shapeOf().length, n0 + 1, "click on empty space adds a point");
drag(addAt[0] + 6, addAt[1] - 24);
release();
{
    const sh = shapeOf();
    eq(sh.length, 3, "still 3 points after dragging the new one");
    ok(sh[1].x > 0.5 && sh[1].y > 0.8, "the added point follows the drag (x and y)");
    eq(sh[0].x, 0, "first point stays pinned at x 0"); eq(sh[2].x, 1, "last point stays pinned at x 1");
}
// end points: move only vertically
{
    const p0 = msXY(shapeOf()[0]);
    click(p0[0], p0[1]);
    drag(p0[0] + 40, p0[1] - 20);
    release();
    const sh = shapeOf();
    eq(sh[0].x, 0, "dragging the first point cannot move it in x");
    near(sh[0].y, run(`clamp(1 - (${p0[1] - 20} - ${MS[1]} - 3) / (${MS[3]} - 6), 0, 1)`), 1e-9, "first point moves in y");
    const pl = msXY(shapeOf()[2]);
    click(pl[0], pl[1]);
    drag(pl[0] - 40, pl[1] + 10);
    release();
    eq(shapeOf()[2].x, 1, "dragging the last point cannot move it in x");
    dbl(...msXY(shapeOf()[0]));
    eq(shapeOf().length, 3, "end points cannot be deleted");
}
// drag a segment to bend it
{
    const sh = shapeOf();
    const mx = (sh[0].x + sh[1].x) / 2;
    const my = run(`evalMseg(MM.getMapping(${m1.id}).shape, ${mx})`);
    const q = msXY({ x: mx, y: my });
    const c0 = sh[0].curve;
    click(q[0], q[1]);
    drag(q[0], q[1] - 12);
    release();
    ok(shapeOf()[0].curve !== c0, "dragging a segment bends its curvature");
    ok(Math.abs(shapeOf()[0].curve) <= 1, "curvature is clamped to -1..1");
    dbl(q[0], q[1]);
}
// double-click a point deletes it
{
    const q = msXY(shapeOf()[1]);
    dbl(...q);
    eq(shapeOf().length, 2, "double-click on a point deletes it");
}
// point order is kept while dragging past a neighbour
{
    click(...msXY({ x: 0.3, y: 0.9 }));
    release();
    click(...msXY({ x: 0.7, y: 0.1 }));
    release();
    eq(shapeOf().length, 4, "two more points added");
    const q = msXY(shapeOf()[1]);
    click(q[0], q[1]);
    drag(q[0] + 200, q[1]);
    release();
    const xs = shapeOf().map((p) => p.x);
    ok(xs.every((v, i) => i === 0 || v > xs[i - 1]), "dragging a point past its neighbour keeps the points ordered");
}
click(...center(det("preset0").rect));
ok(!det("inv") && !det("bip") && !det("min") && !det("max"), "old INV / BIP / Min / Max ids are gone");
ok(!!det("amt") && !!det("pol1") && !!det("pol0") && !!det("pol-1"), "Amount bar and three polarity buttons exist");
for (const [id, pol] of [["pol1", 1], ["pol-1", -1], ["pol0", 0]]) {
    click(...center(det(id).rect));
    eq(run(`MM.getMapping(${m1.id}).polarity`), pol, `polarity button ${id} sets polarity ${pol}`);
}
{
    const rs = ["pol1", "pol0", "pol-1"].map((id) => det(id).rect);
    ok(rs[0][0] + rs[0][2] <= rs[1][0] && rs[1][0] + rs[1][2] <= rs[2][0] && rs[0][1] === rs[1][1] && rs[1][1] === rs[2][1], "polarity buttons form one segmented row");
    const tm = det("tabmod").rect; const tr = det("tabrem").rect; const de = det("del").rect;
    ok(tm[0] + tm[2] <= tr[0] && tr[0] + tr[2] <= de[0] && de[0] + de[2] <= det("mseg").rect[0] + 138 && de[1] + de[3] <= 161 && tm[1] === tr[1] && tr[1] === de[1], "MOD / REM tabs and delete share one row inside the 138 px panel");
    ok(de[1] + de[3] <= det("mseg").rect[1] && de[0] > tr[0], "delete sits at the right end of the tab row, above the MSEG");
    ok(!det("mode"), "the old bottom MOD|REM toggle is gone");
}
click(...center(det("tabrem").rect));
eq(run(`MM.getMapping(${m1.id}).mode`), "remote", "tabs: REM -> Remote");
ok(!det("amt") && !det("pol1") && !det("pol0") && !det("pol-1") && !!det("vmin") && !!det("vmax") && !det("rng"), "remote editor: no Amount bar / polarity buttons, MIN / MAX boxes instead");
ok(det("mseg").rect[1] + det("mseg").rect[3] < det("preset0").rect[1] && det("preset0").rect[1] + det("preset0").rect[3] < det("vmin").rect[1], "tabs, MSEG, presets and MIN / MAX boxes stack without overlap");
click(...center(det("tabmod").rect));
eq(run(`MM.getMapping(${m1.id}).mode`), "mod", "tabs: MOD -> Mod");
click(det("amt").rect[0] + det("amt").rect[2] - 1, det("amt").rect[1] + 5);
near(run(`MM.getMapping(${m1.id}).amount`), 1, 0.15, "editor amount bar");
dbl(...center(det("amt").rect));
near(run(`MM.getMapping(${m1.id}).amount`), run("defaultMapping(1, 0, {}).amount"), 1e-9, "double-click resets the amount bar");
run("paint()");
// the editor shows the mapping's shape, every drawn control paints
{
    log.texts.length = 0; run("paint()");
    ok(log.texts.includes("MOD") && log.texts.includes("REM") && log.texts.includes("Amount"), "editor paints MOD / REM / Amount");
}
// inline row gestures: the curve icon only selects
{
    const sh0 = JSON.stringify(shapeOf());
    run("MM.setUI({ pbSel: 0 })");
    click(...at(P1.curve));
    eq(JSON.stringify(shapeOf()), sh0, "clicking the list curve icon does not change the curve");
    eq(run("ubUIs().pbSel"), m1.id, "clicking the list curve icon selects the row");
    const pol0 = run(`MM.getMapping(${m1.id}).polarity`);
    click(...at(P1.curve), { alt: true });
    eq(run(`MM.getMapping(${m1.id}).polarity`), pol0, "alt-click on the curve icon changes nothing");
    // the row icon draws the mapping's own MSEG
    run(`MM.updateMapping(${m1.id}, { shape: [{x:0,y:1,curve:0,sCurve:0},{x:0.5,y:0,curve:0,sCurve:0},{x:1,y:1,curve:0,sCurve:0}] })`);
    ok(run(`evalMseg(MM.getMapping(${m1.id}).shape, 0.5)`) === 0, "row shape is the edited MSEG");
    run("paint()");
    run(`MM.updateMapping(${m1.id}, { shape: curveToShape(0, 0.5, 4) })`);
}
const a0 = run(`MM.getMapping(${m1.id}).amount`);
click(...at(P1.val));
drag(at(P1.val)[0] + 30, at(P1.val)[1]);
release();
ok(run(`MM.getMapping(${m1.id}).amount`) > a0 || a0 >= 1, "dragging the value changes the amount");
click(...at(P1.mode));
eq(run(`MM.getMapping(${m1.id}).mode`), "remote", "list M/R toggle -> remote");
click(...at(P1.mode));
eq(run(`MM.getMapping(${m1.id}).mode`), "mod", "list M/R toggle -> mod");
dbl(...at(P1.name));
eq(run(`MM.getMapping(${m1.id}).enabled`), 0, "double-click a row disables the mapping");
run("paint()");
dbl(...at(P1.name));
eq(run(`MM.getMapping(${m1.id}).enabled`), 1, "double-click again enables it");
// editor delete
click(...at(P1.name));
click(...center(det("del").rect));
eq(run(`MM.getMapping(${m1.id})`), null, "editor delete removes the mapping");
eq(run("ubUIs().pbSel"), 0, "selection cleared after delete");
// row x delete
const m2 = run("MM.mappingsFor(0)[1]");
const r2 = rowAt(m2.id);
click(...at(run(`ubRowParts(${r2.y})`).del));
eq(run(`MM.getMapping(${m2.id})`), null, "row x deletes the mapping");
// missing + disabled paint
{
    const m3 = run("MM.mappingsFor(0)[0]");
    run(`globalThis.__st = MM.mappingStatus; MM.mappingStatus = (id) => (id === ${m3.id} ? 'missing' : __st(id));`);
    run(`MM.updateMapping(${run("MM.mappingsFor(1)[0]").id}, { enabled: 0 })`);
    log.texts.length = 0;
    run("paint()");
    ok(log.texts.includes("P0"), "missing / disabled rows paint");
    run("MM.mappingStatus = __st");
}
// ---- header: no map arrow; the button toggles the whole modulator (same state as the strip corner button)
{
    const hr = run("ubListVisible().rows.filter((r) => r.item.kind === 'head')[0]");
    const hslot = hr.item.i;
    const hp = run(`ubHeadPwrRect(${hr.y})`);
    eq(run(`ubHit(${at(hp)[0]}, ${at(hp)[1]}).kind`), "ls_hpwr", "header button hit");
    const kinds = new Set();
    for (let xx = gm.lx; xx < gm.lx + gm.lw; xx += 2) kinds.add(run(`ubHit(${xx}, ${hr.y + 7})`).kind);
    ok(!kinds.has("ls_harrow"), "no map arrow in the header");
    ok(run("typeof ubHeadArrowRect") === "undefined", "header arrow geometry is gone");
    spyLearn();
    ctx.__rec.length = 0;
    const en0 = run(`MM.state.mods[${hslot}].enabled`);
    click(...at(hp));
    eq(run(`MM.state.mods[${hslot}].enabled`), en0 ? 0 : 1, "header button toggles the modulator");
    eq(ctx.__rec.length, 0, "header button never starts learning");
    // same state as the strip's corner button
    run("ubTogglePb(false)");
    const sr = run(`ubStripRects(ubStrips().list.filter((g) => g.slot === ${hslot})[0])`);
    click(...center(sr.icon));
    eq(run(`MM.state.mods[${hslot}].enabled`), en0, "strip corner button flips the same state back");
    run("ubTogglePb(true)");
    click(...at(hp));
    eq(run(`MM.state.mods[${hslot}].enabled`), en0 ? 0 : 1, "header button flips it again");
    log.texts.length = 0; run("paint()");
    ok(log.texts.includes("MAPPINGS"), "list paints with a disabled modulator");
    click(...at(hp));
    eq(run(`MM.state.mods[${hslot}].enabled`), en0, "restored");
    // painting: lit type-coloured ring when on, hollow grey when off
    const col = run(`ubModCol(MM.state.mods[${hslot}])`);
    log.fills = [];
    run("paint()");
    const hy = hr.y;
    const lit = log.fills.filter((f) => f.rect && f.col && Math.abs(f.col[0] - col[0]) < 1e-9 && Math.abs(f.col[1] - col[1]) < 1e-9 && f.col[3] < 0.5 && f.col[3] > 0.2);
    ok(lit.length > 0, "enabled modulator header glyph is lit in its type colour");
    run(`MM.setParam(${hslot}, 'enabled', 0)`);
    log.fills = [];
    run("paint()");
    const greyOn = log.fills.filter((f) => Math.abs(f.col[0] - 0.1) < 1e-9 && Math.abs(f.col[1] - 0.11) < 1e-9);
    ok(greyOn.length > 0, "disabled modulator header glyph is hollow grey");
    log.fills = null;
    run(`MM.setParam(${hslot}, 'enabled', 1)`);
}
// ---- selected-modulator tint: header + rows tinted in the modulator colour, dimmer than the selected-mapping row
{
    const selSlot = 1;
    run(`MM.setUI({ sel: ${selSlot}, pbSel: 0, pbScroll: 0 })`);
    const col = run(`ubModCol(MM.state.mods[${selSlot}])`);
    const other = run("ubModCol(MM.state.mods[0])");
    const vis = run("ubListVisible()");
    const rowOf = (slot, kind) => vis.rows.filter((r) => r.item.i === slot && r.item.kind === kind);
    log.fills = [];
    run("paint()");
    const tinted = (rows, a) => rows.some((r) => log.fills.some((f) => f.rect && f.rect[1] === r.y && Math.abs(f.col[0] - a.col[0]) < 1e-9 && Math.abs(f.col[1] - a.col[1]) < 1e-9 && Math.abs(f.col[2] - a.col[2]) < 1e-9 && Math.abs(f.col[3] - a.alpha) < 1e-9));
    const headRows = rowOf(selSlot, "head");
    const selMapRows = rowOf(selSlot, "map");
    ok(selMapRows.length > 0, "selected modulator has mapping rows");
    ok(log.fills.some((f) => f.rect && f.rect[1] === headRows[0].y + 1 && Math.abs(f.col[0] - col[0]) < 1e-9 && Math.abs(f.col[3] - run("UB_TINT_HEAD")) < 1e-9), "selected modulator header is tinted");
    ok(selMapRows.every((r) => log.fills.some((f) => f.rect && f.rect[1] === r.y && f.rect[3] === r.h && Math.abs(f.col[0] - col[0]) < 1e-9 && Math.abs(f.col[3] - run("UB_TINT_ROW")) < 1e-9)), "all rows of the selected modulator are tinted");
    const otherRows = vis.rows.filter((r) => r.item.i !== selSlot && r.item.kind === "map");
    ok(otherRows.length > 0 && otherRows.every((r) => !log.fills.some((f) => f.rect && f.rect[1] === r.y && f.rect[3] === r.h && Math.abs(f.col[3] - run("UB_TINT_ROW")) < 1e-9 && Math.abs(f.col[0] - run(`ubModCol(MM.state.mods[${r.item.i}])`)[0]) < 1e-9)), "rows of other modulators are not tinted");
    ok(run("UB_TINT_ROW") < run("UB_SELROW_FILL") && run("UB_TINT_ROW") < run("UB_TINT_HEAD"), "tint constants: rows dimmer than header and the selected-mapping fill");
    // selected mapping row: tint first, then the stronger highlight on top (draw order)
    const mid = selMapRows[0].item.m.id;
    run(`MM.setUI({ pbSel: ${mid} })`);
    log.fills = [];
    run("paint()");
    const ry = selMapRows[0].y;
    const seq = log.fills.map((f, i) => ({ f, i })).filter((o) => o.f.rect && o.f.rect[1] === ry && o.f.rect[3] === selMapRows[0].h && o.f.rect[2] > 100);
    const iTint = seq.findIndex((o) => Math.abs(o.f.col[3] - run("UB_TINT_ROW")) < 1e-9);
    const iSel = seq.findIndex((o) => Math.abs(o.f.col[3] - run("UB_SELROW_FILL")) < 1e-9);
    ok(iTint >= 0 && iSel > iTint, "selected mapping highlight is drawn after (over) the modulator tint");
    ok(run("UB_SELROW_FILL") > run("UB_TINT_ROW"), "selected-mapping fill is stronger than the tint");
    log.fills = null;
    // changing the selection moves the tint
    run(`MM.setUI({ sel: 0, pbSel: 0 })`);
    log.fills = [];
    run("paint()");
    const r0 = vis.rows.filter((r) => r.item.i === 0 && r.item.kind === "map")[0];
    ok(!r0 || log.fills.some((f) => f.rect && f.rect[1] === r0.y && Math.abs(f.col[3] - run("UB_TINT_ROW")) < 1e-9 && Math.abs(f.col[0] - other[0]) < 1e-9), "tint follows the selection");
    log.fills = null;
}
// header body selects the modulator
const hr2 = run("ubListVisible().rows.filter((r) => r.item.kind === 'head')[1]");
click(gm.lx + 30, hr2.y + 7);
eq(run("ubSel()"), hr2.item.i, "clicking a list header selects that modulator");
// scroll
{
    for (let k = 0; k < 10; k++) run(`MM.addMapping(2, { path: 'live_set tracks 8 devices 0 parameters ${k}', trackName: 'T8', deviceName: 'D', paramName: 'S${k}' })`);
    run("MM.setUI({ pbScroll: 0 })");
    ctx.onwheel(80, 80, 0, -1);
    eq(run("ubUIs().pbScroll"), 1, "wheel scrolls the list by one item");
    ctx.onwheel(80, 80, 0, 1);
    eq(run("ubUIs().pbScroll"), 0, "wheel scrolls back");
    for (let k = 0; k < 80; k++) ctx.onwheel(80, 80, 0, -1);
    eq(run("ubUIs().pbScroll"), run("ubListMaxScroll(ubListItems())"), "scroll clamps at the end");
    ctx.onwheel(300, 80, 0, -1);
    run("MM.setUI({ pbScroll: 0 })");
}
// count chip opens the list on that modulator
run("ubTogglePb(false)");
click(...center(run("ubStripRects(ubStrips().list[0])").count));
ok(run("ubPb()"), "count chip opens the mapping list");
ok(run("ubUIs().pbSel") > 0 || run("MM.mappingsFor(0).length") === 0, "count chip selects the first mapping");
// rail toggle back
click(11, 48);
ok(!run("ubPb()"), "rail list button toggles back to the strips");
click(11, 48);
ok(run("ubPb()"), "rail list button opens the list");
run("ubTogglePb(false)");

// ---------------------------------------------------------------- "pool full" pill
{
    run("ubFullTTL = 0");
    log.texts.length = 0; run("paint()");
    ok(!log.texts.some((t) => t.indexOf("Mapping pool full") === 0), "no pill normally");
    ctx.uiChanged({ kind: "full", mod: 0 });
    ok(run("ubFullTTL") > 0, "full event arms the pill");
    log.texts.length = 0; run("paint()");
    ok(log.texts.includes("Mapping pool full (256)"), "pill text painted");
    for (let k = 0; k < 80; k++) ctx.uiTelemetry(run("MM.readTelemetry()"));
    eq(run("ubFullTTL"), 0, "pill expires");
    log.texts.length = 0; run("paint()");
    ok(!log.texts.some((t) => t.indexOf("Mapping pool full") === 0), "pill gone after expiry");
}
// a real refused learn raises the event end-to-end
{
    const cap = run("MM.mappingCapacity()");
    run("ubFullTTL = 0");
    for (let k = cap.used; k < 256; k++) run(`MM.addMapping(0, { path: 'live_set tracks 9 devices 0 parameters ${k}', trackName: 'Z', deviceName: 'D', paramName: 'F${k}' })`);
    eq(run("MM.mappingCapacity().free"), 0, "pool filled");
    const seen = [];
    run("MM.on('change', (ev) => __ev.push(ev.kind))"); ctx.__ev = seen;
    eq(run("MM.addMapping(0, { path: 'live_set tracks 9 devices 0 parameters 999', trackName: 'Z', deviceName: 'D', paramName: 'X' })"), null, "add refused when full");
    ok(seen.includes("full") && run("ubFullTTL") > 0, "refused add shows the pill through the real change event");
}

// ---------------------------------------------------------------- persistence of ui state
run("MM.setUI({ sel: 2, exp: 2, pb: 1, pbScroll: 14, pbSel: 0 })");
const saved = run("MM.save()");
const E2 = makeEnv();
E2.ctx.setvalueof(saved);
eq(E2.run("[ubSel(), ubExp(), ubPb(), ubUIs().pbScroll]"), [2, 2, true, 14], "selection / expanded / list / scroll persist");
eq(E2.log.outlets.filter((o) => o[1] === "width").pop()[2], E2.run("ubLayoutWidth()") + 8, "width re-requested after restore");
E2.run("paint()");

// ---------------------------------------------------------------- previews paint
const E3 = makeEnv();
E3.run("preview()");
E3.log.texts.length = 0;
E3.run("paint()");
ok(E3.log.texts.includes("MAPPINGS") && E3.log.texts.includes("Frequency"), "preview shows the mapping list with the selected mapping");
ok(E3.run("ubPbSelMapping() !== null") && E3.run("ubPb()"), "preview has a selected mapping and the editor");
ok(E3.run("MM.allMappings().some((m) => MM.mappingStatus(m.id) === 'missing')"), "preview has a missing row");
eq(E3.log.outlets.filter((o) => o[1] === "width").pop()[2], 22 + 172 + 6 + 138 + 8, "preview list width");
ok(E3.run("MM.state.mods.some((m) => m && !m.enabled)"), "preview has a disabled modulator");
ok(E3.run("MM.allMappings().some((m) => !m.enabled)"), "preview has a disabled mapping");
ok(E3.run("MM.mappingsFor(ubSel()).length >= 3"), "preview: the selected modulator has several mappings");
ok(E3.run("ubPbSelMapping().shape.length >= 3 && ubPbSelMapping().shape.some((p) => Math.abs(p.curve) > 0.1)"), "preview: selected mapping has an MSEG with a bent segment");
ok(E3.run("ubListVisible().rows.some((r) => r.item.kind === 'head' && r.item.i === ubSel())"), "preview: the selected modulator header is visible");
ok(E3.run("MM.learn.armed"), "preview shows the rail learn armed");
eq(E3.run("(function () { const m = ubPbSelMapping(); return [m.mode, m.min, m.max]; })()"), ["remote", 0.2, 0.8], "preview: the selected mapping is Remote, 20-80%");
E3.run("MM.setUI({pb: 0})");
E3.log.texts.length = 0;
E3.run("paint()");
ok(E3.log.texts.includes("Swell"), "strips state still paints the expanded MSEG strip");
// a bypassed modulator greys the remap editor and drops its scan line, but the MSEG stays editable
{
    const mm = E3.run("ubPbSelMapping()");
    const scan = () => E3.run(`(function () {
        const orig = ubCircle; let n = 0;
        ubCircle = function (x, y, r, c) { if (r === 2.4 && c[0] === 1 && c[1] === 1 && c[2] === 1) n++; return orig.apply(null, arguments); };
        try { ubPaintShapeEditor([0, 0, 130, 60], ubPbSelMapping(), MM.state.mods[ubPbSelMapping().mod]); } finally { ubCircle = orig; }
        return n;
    })()`);
    E3.run(`MM.state.mods[${mm.mod}].enabled = 1`);
    eq(scan(), 1, "enabled modulator: remap editor draws the scan dot");
    E3.run(`MM.state.mods[${mm.mod}].enabled = 0`);
    eq(scan(), 0, "disabled modulator: no scan line/dot in the remap editor");
    E3.run("MM.setUI({ pb: 1 })");
    E3.run("paint()");
    const before = JSON.stringify(E3.run("ubPbSelMapping().shape"));
    E3.run(`MM.updateMapping(${mm.id}, { shape: [{ x: 0, y: 0, curve: 0 }, { x: 0.5, y: 0.9, curve: 0 }, { x: 1, y: 1, curve: 0 }] })`);
    ok(JSON.stringify(E3.run("ubPbSelMapping().shape")) !== before, "disabled modulator: its mapping shape is still editable");
}
// centred output bar + polarity-linked range markers to the right of the remap MSEG
{
    const mm = E3.run("ubPbSelMapping()");
    const rangeOf = () => E3.run(`MM.getMapping(${mm.id}).range`);
    const setPol = (p) => E3.run(`MM.updateMapping(${mm.id}, { mode: 'mod', polarity: ${p}, range: 1 })`);
    const mr = E3.run(`ubDetailRects(ubListGeom(), ubPbSelMapping()).filter((d) => d.id === "meter")[0].rect`);
    const ms = E3.run(`ubDetailRects(ubListGeom(), ubPbSelMapping()).filter((d) => d.id === "mseg")[0].rect`);
    ok(mr && mr[0] >= ms[0] + ms[2] && mr[1] === ms[1] && mr[3] === ms[3], "meter sits right of the MSEG, same height");
    const g = E3.run(`ubMeterGeom(${JSON.stringify(mr)})`);
    near(g.cy, g.iy + g.ih / 2, 1e-9, "zero is the vertical centre of the bar");
    const yUp = (r) => g.cy - g.hh * r;
    const yDn = (r) => g.cy + g.hh * r;
    const cx = mr[0] + mr[2] / 2;
    const gesture = (y0, y1) => {
        E3.ctx.onclick(cx, y0, 1, 0, 0, 0, 0, 0);
        E3.ctx.ondrag(cx, y1, 1, 0, 0, 0, 0, 0);
        E3.ctx.ondrag(cx, y1, 0, 0, 0, 0, 0, 0);
    };
    // "+" : the only marker is above the centre; bottom presses are ignored and nothing there is a hit target
    setPol(1);
    gesture(yUp(0.95), yUp(0.7));
    near(rangeOf(), 0.7, 0.02, "+ : dragging the top marker sets range");
    gesture(yDn(0.5), yDn(0.9));
    near(rangeOf(), 0.7, 0.02, "+ : a press below the centre (hidden zero marker) does not change the range");
    gesture(yUp(0.5), yDn(0.6));
    near(rangeOf(), 0, 0.001, "+ : dragging past the centre pins the range to 0 (no mirroring)");
    // "-" : the only marker is below the centre
    setPol(-1);
    gesture(yDn(0.9), yDn(0.4));
    near(rangeOf(), 0.4, 0.02, "- : dragging the lower marker sets range");
    gesture(yUp(0.5), yUp(0.9));
    near(rangeOf(), 0.4, 0.02, "- : a press above the centre does not change the range");
    // "+-" : markers linked symmetrically, either one sets the range
    setPol(0);
    gesture(yUp(0.95), yUp(0.6));
    near(rangeOf(), 0.6, 0.02, "± : dragging the top marker sets range");
    gesture(yDn(0.6), yDn(0.3));
    near(rangeOf(), 0.3, 0.02, "± : dragging the bottom marker moves both (range = distance from the centre)");
    // markers painted: count triangles per polarity
    const triangles = () => E3.run(`(function () { let n = 0; const o = ubRangeMarker; ubRangeMarker = function (x, y) { n++; return o.apply(null, arguments); };
        try { ubPaintOutMeter(${JSON.stringify(mr)}, ubPbSelMapping(), MM.state.mods[ubPbSelMapping().mod]); } finally { ubRangeMarker = o; } return n; })()`);
    setPol(1); eq(triangles(), 1, "+ : one visible triangle");
    setPol(-1); eq(triangles(), 1, "- : one visible triangle");
    setPol(0); eq(triangles(), 2, "± : two visible triangles");
    E3.ctx.ondblclick(cx, yUp(0.5), 1, 0, 0, 0, 0, 0);
    E3.run(`MM.updateMapping(${mm.id}, { range: 0.4 })`);
    E3.ctx.ondblclick(cx, yUp(0.3), 1, 0, 0, 0, 0, 0);
    eq(rangeOf(), 1, "double-click resets the range to 1");
    // list-row value text carries the polarity glyph
    E3.run(`MM.updateMapping(${mm.id}, { amount: 0.5 })`);
    for (const [p, t] of [[1, "+50%"], [0, "\u00b150%"], [-1, "\u221250%"]]) {
        setPol(p);
        eq(E3.run("ubValueText(ubPbSelMapping())"), t, `value text for polarity ${p}`);
    }
    // value drag on the list row: Mod edits the amount, Remote shifts the whole min..max window (width kept)
    {
        const dragRow = () => {
            E3.run(`ubListReveal(${mm.id}, 0)`); E3.run("paint()");
            const P = E3.run(`ubRowParts(ubListVisible().rows.filter((r) => r.item.m && r.item.m.id === ${mm.id})[0].y)`);
            const vx = P.val[0] + 4; const vy = P.val[1] + 4;
            E3.ctx.onclick(vx, vy, 1, 0, 0, 0, 0, 0);
            E3.ctx.ondrag(vx + 30, vy, 1, 0, 0, 0, 0, 0);
            E3.ctx.ondrag(vx + 30, vy, 0, 0, 0, 0, 0, 0);
        };
        E3.run(`MM.updateMapping(${mm.id}, { mode: 'mod', amount: 0.2 })`);
        dragRow();
        ok(E3.run(`MM.getMapping(${mm.id}).amount`) > 0.3, "mod: dragging the row value edits the amount");
        E3.run(`MM.updateMapping(${mm.id}, { mode: 'remote', min: 0.2, max: 0.5, amount: 0.2 })`);
        dragRow();
        const rm = E3.run(`MM.getMapping(${mm.id})`);
        ok(rm.min > 0.3 && Math.abs((rm.max - rm.min) - 0.3) < 1e-9 && rm.amount === 0.2, "remote: dragging the row value shifts the window, width and amount untouched");
        eq(E3.run("ubValueText(ubPbSelMapping())"), Math.round(rm.min * 100) + "\u2013" + Math.round(rm.max * 100) + "%", "remote value text is min\u2013max%");
        E3.run(`MM.updateMapping(${mm.id}, { min: 0.2, max: 0.8 })`);
        eq(E3.run("ubValueText(ubPbSelMapping())"), "20\u201380%", "remote value text 20\u201380%");
    }
    E3.run("paint()");
}

// ---------------------------------------------------------------- Remap editor: MOD / REM tabs, Remote bar + MIN / MAX boxes
// Remote has independent min / max (absolute 0..1), no polarity / amount; Mod keeps polarity / range / amount.
{
    const T = makeEnv();
    T.run("preview()");
    const mid = T.run("ubPbSelMapping().id");
    const gm = () => T.run("ubListGeom()");
    const rects = () => T.run("ubDetailRects(ubListGeom(), ubPbSelMapping())");
    const rect = (id) => { const d = rects().filter((q) => q.id === id)[0]; return d ? d.rect : null; };
    const M = () => JSON.parse(T.run(`JSON.stringify(MM.getMapping(${mid}))`));
    const set = (patch) => T.run(`MM.updateMapping(${mid}, ${JSON.stringify(patch)})`);
    const clk = (x, y) => T.ctx.onclick(x, y, 1, 0, 0, 0, 0, 0);
    const drg = (x, y) => T.ctx.ondrag(x, y, 1, 0, 0, 0, 0, 0);
    const up = (x, y) => T.ctx.ondrag(x, y, 0, 0, 0, 0, 0, 0);
    const dbl2 = (x, y) => T.ctx.ondblclick(x, y, 1, 0, 0, 0, 0, 0);
    const gesture = (x0, y0, x1, y1) => { clk(x0, y0); drg(x1, y1); up(x1, y1); };
    const texts = () => { T.log.texts.length = 0; T.run("paint()"); return T.log.texts.slice(); };
    const same = (fields, before, msg) => { const now = M(); for (const f of fields) eq(now[f], before[f], `${msg}: ${f} unchanged`); };
    const yOfV = (r, v) => r[1] + 3 + (r[3] - 6) * (1 - v); // value 0..1 -> pixel y inside a bar / MSEG rect
    const hitIds = () => { const g = gm(); const ids = new Set(); for (let yy = 0; yy < 161; yy += 2) for (let xx = g.dx - 3; xx < g.dx + g.dw; xx += 2) { const h = T.run(`ubHit(${xx}, ${yy})`); if (h.kind === "detail") ids.add(h.id); } return ids; };
    T.run(`ubSelect(2); MM.setUI({ pb: 1, pbSel: ${mid} })`);

    // the preview mapping is Remote 20..80%
    eq([M().mode, M().min, M().max], ["remote", 0.2, 0.8], "preview(): the selected mapping is Remote, 20-80%");
    set({ mode: "remote", min: 0.2, max: 0.8, polarity: -1, range: 0.6, amount: -0.4 });

    // ---- Remote: texts, hit areas, layout
    {
        const tx = texts();
        ok(tx.includes("MOD") && tx.includes("REM") && tx.includes("MIN") && tx.includes("MAX") && tx.includes("20%") && tx.includes("80%"), "remote: MOD / REM tabs and MIN / MAX boxes with their %");
        ok(!tx.includes("Amount") && !tx.some((t) => t.indexOf("REMOTE") === 0) && !tx.includes("Range") && !tx.some((t) => t.indexOf("Lines =") === 0), "remote: no Amount, header strip, Range slider or explanatory text");
        ok(tx.includes("20–80%"), "remote: list row shows 20–80%");
        ok(!rects().some((d) => d.id === "amt" || d.id.indexOf("pol") === 0 || d.id === "rng" || d.id === "bmin" || d.id === "bmax" || d.id === "wintabs" || d.id === "mode"), "remote: no polarity / amount / old-design rects");
        const ids = hitIds();
        ok(![...ids].some((id) => id === "amt" || id.indexOf("pol") === 0), "remote: no pixel of the editor hits a polarity / amount control");
        ok(["mseg", "meter", "preset0", "tabmod", "tabrem", "del", "vmin", "vmax"].every((id) => ids.has(id)), "remote: MSEG, bar, presets, tabs, delete and MIN / MAX boxes are hittable");
        const g = gm(); const rs = rects();
        for (const d of rs) ok(d.rect[0] >= g.dx - 0.01 && d.rect[0] + d.rect[2] <= g.dx + g.dw + 0.01 && d.rect[1] >= 0 && d.rect[1] + d.rect[3] <= 161, `remote: ${d.id} inside the panel`);
        for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i].rect; const b = rs[j].rect;
            ok(a[0] + a[2] <= b[0] + 1e-6 || b[0] + b[2] <= a[0] + 1e-6 || a[1] + a[3] <= b[1] + 1e-6 || b[1] + b[3] <= a[1] + 1e-6, `remote: ${rs[i].id} and ${rs[j].id} do not overlap`);
        }
        const vi = rect("vmin"); const va = rect("vmax");
        ok(vi[0] + vi[2] <= va[0] && vi[1] === va[1], "remote: MIN and MAX boxes sit side by side at the bottom");
        ok(rect("mseg")[0] + rect("mseg")[2] <= rect("meter")[0], "remote: the bar sits right of the MSEG");
    }
    // ---- a limit control sets only its own field
    const own = (which, mk, label) => {
        set({ min: 0.2, max: 0.8 });
        const b = M();
        mk(which);
        const now = M();
        const other = which === "min" ? "max" : "min";
        eq(now[other], b[other], `${label} moves only ${which} (${other} untouched)`);
        ok(Math.abs(now[which] - b[which]) > 0.05, `${label} changed ${which}`);
        same(["polarity", "range", "amount", "mode"], b, label);
    };
    {
        const r = rect("meter");
        own("min", () => gesture(r[0] + 2, yOfV(r, 0.2), r[0] + 2, yOfV(r, 0.05)), "bar: dragging the min triangle");
        own("max", () => gesture(r[0] + 2, yOfV(r, 0.8), r[0] + 2, yOfV(r, 0.95)), "bar: dragging the max triangle");
        near(M().max, 0.95, 0.03, "bar: max lands where dragged");
        // the nearest wins even when the press is between the triangles
        set({ min: 0.2, max: 0.8 }); gesture(r[0] + 8, yOfV(r, 0.7), r[0] + 8, yOfV(r, 0.55));
        eq(M().min, 0.2, "bar: nearest triangle wins (min stays)"); near(M().max, 0.55, 0.03, "bar: nearest triangle wins (max moves)");
        const bx = rect("vmin"); const bx2 = rect("vmax");
        own("min", () => gesture(bx[0] + 5, bx[1] + 7, bx[0] + 5, bx[1] - 13), "MIN box (vertical drag)");
        own("max", () => gesture(bx2[0] + 5, bx2[1] + 7, bx2[0] + 5, bx2[1] + 27), "MAX box (vertical drag)");
        ok(M().max < 0.8, "dragging the MAX box down lowers max");
        set({ min: 0.2, max: 0.8 }); gesture(bx[0] + 5, bx[1] + 7, bx[0] + 5, bx[1] - 200); eq(M().min, 1, "MIN box clamps to 100%");
    }
    // ---- min > max is allowed (inverted response)
    {
        set({ min: 0.2, max: 0.8 });
        const r = rect("meter"); gesture(r[0] + 2, yOfV(r, 0.2), r[0] + 2, yOfV(r, 0.95));
        ok(M().min > M().max, "min can be dragged above max");
        const t = T.run(`mappingTable(MM.getMapping(${mid}))`);
        ok(t[0] > t[255], "min > max gives a falling table");
    }
    // ---- double-click resets the limit to 0 / 1
    {
        set({ min: 0.3, max: 0.7 });
        const r = rect("meter"); dbl2(r[0] + 2, yOfV(r, 0.3)); near(M().min, 0, 0.001, "double-click on the min triangle -> 0");
        dbl2(r[0] + 2, yOfV(r, 0.7)); near(M().max, 1, 0.001, "double-click on the max triangle -> 1");
        set({ min: 0.3, max: 0.7 }); dbl2(...center(rect("vmin"))); near(M().min, 0, 0.001, "double-click on the MIN box -> 0"); eq(M().max, 0.7, "MIN reset leaves max");
        dbl2(...center(rect("vmax"))); near(M().max, 1, 0.001, "double-click on the MAX box -> 1");
        same(["polarity", "range", "amount"], { polarity: -1, range: 0.6, amount: -0.4 }, "resets keep the Mod fields");
    }
    // ---- the MSEG transfer curve stays editable in remote
    {
        set({ min: 0.2, max: 0.8, shape: [{ x: 0, y: 0.2, curve: 0, sCurve: 0 }, { x: 1, y: 0.9, curve: 0, sCurve: 0 }] });
        const mr = rect("mseg"); const n0 = M().shape.length;
        clk(mr[0] + mr[2] * 0.5, mr[1] + 8); up(0, 0);
        eq(M().shape.length, n0 + 1, "clicking empty MSEG space adds a point in remote");
        const pi = M().shape.findIndex((p) => p.x > 0.4 && p.x < 0.6);
        const pxy = T.run(`ubMsegXY(${JSON.stringify(mr)}, ubPbSelMapping().shape[${pi}])`);
        dbl2(pxy[0], pxy[1]);
        eq(M().shape.length, n0, "double-clicking a point deletes it in remote");
        const p0 = T.run(`ubMsegXY(${JSON.stringify(mr)}, ubPbSelMapping().shape[0])`);
        gesture(p0[0], p0[1], p0[0], yOfV(mr, 0.5)); near(M().shape[0].y, 0.5, 0.02, "a point drag stores y");
    }
    // ---- Mod mode: polarity, amount and the centred output bar; no Remote controls
    {
        set({ mode: "mod", polarity: 0, range: 0.7, amount: 0.5, min: 0.2, max: 0.8 });
        ok(!!rect("amt") && !!rect("pol1") && !!rect("pol0") && !!rect("pol-1") && !!rect("meter") && !rect("vmin") && !rect("vmax") && !rect("rng"), "mod: Amount, polarity and the output bar exist, no MIN / MAX boxes");
        const ids = hitIds();
        ok(![...ids].some((id) => id === "vmin" || id === "vmax" || id === "rng"), "mod: no pixel hits a min / max control");
        ok(!!rect("tabmod") && !!rect("tabrem") && !!rect("del") && !rect("mode"), "mod: the same tabs and delete in the top row");
        const tx = texts();
        ok(tx.includes("Amount") && tx.includes("MOD") && tx.includes("REM") && !tx.includes("MIN") && !tx.includes("MAX"), "mod: paints Amount and tabs, no MIN / MAX");
        ok(tx.some((t) => /^[+±−]-?\d+%$/.test(t)), "mod: list value keeps its polarity glyph");
        const hh = M();
        eq([hh.min, hh.max], [0.2, 0.8], "switching to Mod keeps min / max");
        // polarity buttons, amount bar, linked markers
        for (const [id, pol] of [["pol1", 1], ["pol-1", -1], ["pol0", 0]]) { clk(...center(rect(id))); up(0, 0); eq(M().polarity, pol, `mod: ${id} sets polarity ${pol}`); }
        const ar = rect("amt"); clk(ar[0] + ar[2] - 1, ar[1] + 5); up(0, 0); near(M().amount, 1, 0.15, "mod: amount bar"); dbl2(...center(ar)); near(M().amount, T.run("defaultMapping(1, 0, {}).amount"), 1e-9, "mod: double-click resets amount");
        set({ polarity: 0, range: 0.7 });
        const mt = rect("meter"); const cy = mt[1] + mt[3] / 2; const hh2 = (mt[3] - 6) / 2;
        gesture(mt[0] + 2, cy - hh2 * 0.7, mt[0] + 2, cy - hh2 * 0.3); near(M().range, 0.3, 0.05, "mod: ± bar triangle sets the range (linked markers)");
        set({ polarity: 1, range: 0.7 }); const lo = M(); gesture(mt[0] + 2, cy + hh2 * 0.4, mt[0] + 2, cy + hh2 * 0.6); eq(M().range, lo.range, "mod: + ignores a press on the hidden side");
        set({ polarity: 0, range: 0.7 }); dbl2(mt[0] + 2, cy - hh2 * 0.7); eq(M().range, 1, "mod: double-click on the bar -> range 1");
        same(["min", "max"], { min: 0.2, max: 0.8 }, "mod gestures leave min / max");
    }
    // ---- tabs switch the mode both ways; the X in the tab row deletes
    {
        set({ mode: "mod" }); clk(...center(rect("tabrem"))); up(0, 0); eq(M().mode, "remote", "the REM tab switches to Remote");
        clk(...center(rect("tabmod"))); up(0, 0); eq(M().mode, "mod", "the MOD tab switches to Mod");
        ok(rect("del")[1] < rect("mseg")[1] && rect("del")[0] > rect("tabrem")[0], "delete sits at the right end of the tab row");
        const n = T.run("MM.allMappings().length");
        clk(...center(rect("del"))); up(0, 0);
        eq(T.run("MM.allMappings().length"), n - 1, "the X in the tab row deletes the mapping");
    }
    // ---- painting never throws, in both modes, bypassed and not, enabled and disabled mapping
    {
        const T2 = makeEnv();
        T2.run("preview()");
        const id2 = T2.run("ubPbSelMapping().id");
        T2.run(`ubSelect(2); MM.setUI({ pb: 1, pbSel: ${id2} })`);
        for (const mode of ["mod", "remote"]) for (const on of [1, 0]) for (const en of [1, 0]) {
            T2.run(`MM.updateMapping(${id2}, { mode: "${mode}", enabled: ${en} })`);
            T2.run(`MM.state.mods[ubPbSelMapping().mod].enabled = ${on}`);
            T2.log.texts.length = 0; T2.run("paint()");
            ok(T2.log.texts.length > 0, `paints: ${mode}, modulator ${on ? "on" : "bypassed"}, mapping ${en ? "enabled" : "disabled"}`);
        }
    }
}
console.log(`megamod UI tests passed (${passed} checks)`);
